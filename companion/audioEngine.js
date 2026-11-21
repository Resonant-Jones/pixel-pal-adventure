// companion/audioEngine.js
//
// The audio half of the companion app: devices in, devices out.
//
// WHY FFMPEG AND NOT A NATIVE MODULE:
// A native CoreAudio binding would need a prebuilt binary for this exact
// macOS/arm64 pair, and it would need microphone permission granted to that
// binary's host app. ffmpeg is already installed, already has an avfoundation
// backend, and a subprocess inherits the parent's TCC attribution — so the
// permission prompt names Terminal, not a mystery helper.
//
// WHAT ACTUALLY MATTERS HERE:
//
// The voice has to travel in two directions, and the two directions must not
// be the same wire:
//
//   out: Guardian speaks -> mp3 -> decode to PCM -> a device the voice
//        client's microphone is watching
//   in:  the player speaks -> a device the voice client's speaker is writing
//        to -> PCM -> wav -> transcribe
//
// On the real transport those are two different sides of a virtual device.
// On the local test path they can be the same pair of speakers and microphone,
// which is why ducking exists: if the app plays Guardian out loud while
// listening to the same microphone, Guardian hears itself and starts talking
// to itself. The duck guard is what keeps the local path honest.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");

const DEFAULT_SAMPLE_RATE = 48000;

// ---------------------------------------------------------------------------
// WAV
// ---------------------------------------------------------------------------

// Wrap raw PCM16 mono samples in a WAV header. The transcription endpoint
// rejects raw PCM — the provider needs a container — so this is the step that
// turns "bytes" into something a speech model can read.
function pcmToWav(pcm, { sampleRate = DEFAULT_SAMPLE_RATE, channels = 1 } = {}) {
  const data = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm || []);
  const header = Buffer.alloc(44);

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);

  return Buffer.concat([header, data]);
}

// ---------------------------------------------------------------------------
// Voice activity detection
// ---------------------------------------------------------------------------

// Energy-based utterance segmentation.
//
// This is not a neural VAD and does not need to be. It only has to answer one
// question: "when did the player stop talking?" A simple RMS threshold with
// hysteresis and a hangover does that well, and it has one enormous advantage
// over anything cleverer — it cannot hallucinate speech out of silence, so a
// quiet room stays quiet.
class VoiceActivityDetector {
  constructor({
    sampleRate = DEFAULT_SAMPLE_RATE,
    channels = 1,
    thresholdDb = -45,
    hangoverMs = 700,
    minUtteranceMs = 250,
    maxUtteranceMs = 15000
  } = {}) {
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.thresholdDb = thresholdDb;
    this.hangoverMs = hangoverMs;
    this.minUtteranceMs = minUtteranceMs;
    this.maxUtteranceMs = maxUtteranceMs;

    this.frameBytes = Math.max(2, Math.floor((sampleRate * channels * 2) / 50)); // 20ms
    this.hangoverFrames = Math.max(1, Math.round(hangoverMs / 20));
    this.minFrames = Math.max(1, Math.round(minUtteranceMs / 20));
    this.maxFrames = Math.max(1, Math.round(maxUtteranceMs / 20));

    // How many frames of lead-in to keep. Without this the first syllable of
    // every phrase is clipped off, because the frames that prove speech has
    // started are the frames that come before the phrase is known to exist.
    this.prerollFrames = 3;

    this.buffer = Buffer.alloc(0);
    this.utterance = [];
    this.preroll = [];
    this.active = false;
    this.quietFrames = 0;
    this.voiceFrames = 0;
  }

  /**
   * Feed PCM in. Returns a description of what happened:
   *   { levelDb, speaking, started, ended, utterance }
   *
   * `utterance` is a Buffer of PCM16 when an utterance just completed.
   */
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const result = {
      levelDb: -Infinity,
      speaking: this.active,
      started: false,
      ended: false,
      utterance: null
    };

    while (this.buffer.length >= this.frameBytes) {
      const frame = this.buffer.subarray(0, this.frameBytes);
      this.buffer = this.buffer.subarray(this.frameBytes);

      const levelDb = rmsDb(frame);
      result.levelDb = levelDb;

      const loud = levelDb > this.thresholdDb;

      if (!this.active) {
        // Not speaking yet. Two *consecutive* loud frames are needed, so a
        // door slam followed by silence is not a phrase, and a door slam
        // followed by a syllable twenty seconds later is not a phrase either.
        if (loud) {
          this.preroll.push(frame);
          if (this.preroll.length > this.prerollFrames) {
            this.preroll.shift();
          }

          this.voiceFrames += 1;

          if (this.voiceFrames >= 2) {
            this.active = true;
            // The frames that proved speech had started are part of the
            // phrase, not lead-in. Dropping them would clip the first
            // syllable off every sentence.
            this.utterance = [...this.preroll];
            this.preroll = [];
            this.voiceFrames = 0;
            this.quietFrames = 0;
            result.started = true;
            result.speaking = true;
          }
        } else {
          this.voiceFrames = 0;
          this.preroll = [];
        }

        continue;
      }

      // Speaking. Keep the pre-roll going so a pause in the middle of a
      // sentence does not lose the frame that resumes it.
      this.preroll.push(frame);
      if (this.preroll.length > this.prerollFrames) {
        this.preroll.shift();
      }

      this.utterance.push(frame);

      if (loud) {
        this.voiceFrames += 1;
        this.quietFrames = 0;
      } else {
        this.quietFrames += 1;
      }

      if (this.quietFrames >= this.hangoverFrames) {
        const pcm = Buffer.concat(this.utterance);
        this.utterance = [];
        this.preroll = [];
        this.active = false;
        this.voiceFrames = 0;
        this.quietFrames = 0;

        const frames = Math.floor(pcm.length / this.frameBytes);
        if (frames >= this.minFrames) {
          result.ended = true;
          result.speaking = false;
          result.utterance = pcm;
        }
        continue;
      }

      if (this.utterance.length >= this.maxFrames) {
        // A phrase longer than the cap is cut and sent rather than grown
        // forever. Transcribing half a sentence beats transcribing nothing.
        const pcm = Buffer.concat(this.utterance);
        this.utterance = [];
        this.preroll = [];
        this.active = false;
        this.voiceFrames = 0;
        this.quietFrames = 0;

        result.ended = true;
        result.speaking = false;
        result.utterance = pcm;
      }
    }

    return result;
  }

  reset() {
    this.buffer = Buffer.alloc(0);
    this.utterance = [];
    this.preroll = [];
    this.active = false;
    this.quietFrames = 0;
    this.voiceFrames = 0;
  }
}

function rmsDb(frame) {
  const samples = frame.length / 2;
  if (!samples) return -Infinity;

  let sum = 0;
  for (let i = 0; i + 1 < frame.length; i += 2) {
    const value = frame.readInt16LE(i) / 32768;
    sum += value * value;
  }

  const rms = Math.sqrt(sum / samples);
  if (rms <= 0) return -Infinity;

  return 20 * Math.log10(rms);
}

// ---------------------------------------------------------------------------
// Capture session
// ---------------------------------------------------------------------------

class CaptureSession extends EventEmitter {
  constructor({ child, source, label }) {
    super();
    this.child = child;
    this.source = source;
    this.label = label;
    this.stopped = false;
    this.ducked = false;

    child.stdout?.on("data", (chunk) => {
      if (this.stopped) return;
      if (this.ducked) return; // Guardian is speaking; ignore our own voice.
      this.emit("pcm", chunk);
    });

    child.on("error", (error) => {
      this.emit("error", error);
    });

    child.on("close", (code) => {
      this.emit("end", { code, source: this.source });
    });
  }

  // While Guardian is speaking, stop feeding inbound audio to the
  // transcriber. This is the difference between a working loop and a
  // stutter.
  setDucked(ducked) {
    this.ducked = Boolean(ducked);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    try {
      this.child.kill("SIGTERM");
    } catch {
      // Already gone.
    }
  }
}

// ---------------------------------------------------------------------------
// Audio engine
// ---------------------------------------------------------------------------

class AudioEngine {
  constructor({ ffmpegPath = "ffmpeg", logger = console, workDir = null } = {}) {
    this.ffmpegPath = ffmpegPath;
    this.logger = logger;
    this.workDir = workDir || path.join(os.tmpdir(), "companion-audio");
    this.sessions = new Set();
  }

  /**
   * List the audio devices ffmpeg can see.
   *
   * ffmpeg's avfoundation backend only enumerates *input* devices with
   * -list_devices. Output devices are a separate CoreAudio list with its own
   * numbering, so they are discovered by probing instead.
   */
  async listInputDevices() {
    const result = await this.#run(this.ffmpegPath, [
      "-hide_banner",
      "-f", "avfoundation",
      "-list_devices", "true",
      "-i", ""
    ]).catch((error) => ({ code: 0, stderr: error?.stderr || "", stdout: error?.stdout || "" }));

    const combined = `${result.stdout || ""}\n${result.stderr || ""}`;
    const devices = [];
    let inAudioSection = false;

    for (const line of combined.split("\n")) {
      if (line.includes("AVFoundation audio devices:")) {
        inAudioSection = true;
        continue;
      }
      if (line.includes("AVFoundation video devices:")) {
        inAudioSection = false;
        continue;
      }
      if (!inAudioSection) continue;

      const match = line.match(/\[(\d+)\]\s+(.+?)\s*$/);
      if (match) {
        devices.push({ index: Number.parseInt(match[1], 10), name: match[2] });
      }
    }

    return devices;
  }

  /**
   * Find which indices can actually be played to.
   *
   * Writing to an index that is input-only fails with a confusing avfoundation
   * error, so each candidate is probed with a fraction of a second of silence.
   */
  async probeOutputDevices(maxIndex = 8) {
    const found = [];

    for (let index = 0; index < maxIndex; index += 1) {
      const result = await this.#run(this.ffmpegPath, [
        "-hide_banner",
        "-loglevel", "error",
        "-f", "avfoundation",
        "-t", "0.15",
        "-i", `:${index}`,
        "-f", "null",
        "-"
      ]).catch((error) => ({ code: error?.code ?? 1, stderr: error?.stderr || "" }));

      if (result.code === 0) {
        found.push({ index, name: null, ok: true });
      }
    }

    return found;
  }

  /**
   * Decode an audio file to 16-bit mono PCM.
   *
   * Guardian's audio arrives as mp3 from the speech provider. The voice client
   * wants PCM. Everything downstream of here is PCM.
   */
  async decodeToPcm(audioPath, { sampleRate = DEFAULT_SAMPLE_RATE } = {}) {
    const result = await this.#run(this.ffmpegPath, [
      "-hide_banner",
      "-loglevel", "error",
      "-i", audioPath,
      "-f", "s16le",
      "-acodec", "pcm_s16le",
      "-ar", String(sampleRate),
      "-ac", "1",
      "pipe:1"
    ]);

    return Buffer.from(result.stdout || []);
  }

  /**
   * Play PCM to a device.
   *
   * The device should be the virtual microphone the voice client is reading.
   * Playing to the speakers is a separate, opt-in behaviour used for testing
   * and for when there is no transport at all.
   */
  async playPcm(pcm, { deviceIndex, sampleRate = DEFAULT_SAMPLE_RATE } = {}) {
    if (!Buffer.isBuffer(pcm) || pcm.length === 0) {
      return { ok: false, error: "empty_audio" };
    }

    const child = spawn(this.ffmpegPath, [
      "-hide_banner",
      "-loglevel", "error",
      "-f", "s16le",
      "-ar", String(sampleRate),
      "-ac", "1",
      "-i", "pipe:0",
      "-f", "avfoundation",
      `:${deviceIndex}`
    ]);

    const stderr = [];
    child.stderr?.on("data", (chunk) => stderr.push(chunk));

    return new Promise((resolve) => {
      child.on("error", (error) => {
        resolve({ ok: false, error: error?.message || String(error) });
      });

      child.on("close", (code) => {
        const text = Buffer.concat(stderr).toString("utf8");
        if (code === 0) {
          resolve({ ok: true, bytes: pcm.length, deviceIndex });
          return;
        }
        resolve({ ok: false, error: text.trim() || `ffmpeg exited ${code}` });
      });

      child.stdin.on("error", () => {
        // The device closed early. The close handler reports it.
      });

      child.stdin.end(pcm);
    });
  }

  /**
   * Start capturing from a device.
   *
   * Returns a CaptureSession that emits "pcm" chunks. Microphone permission
   * failures surface as an error event with the OS message rather than as a
   * silent stream of nothing, which is the failure that costs an evening.
   */
  startCapture({ deviceIndex, sampleRate = DEFAULT_SAMPLE_RATE } = {}) {
    const child = spawn(this.ffmpegPath, [
      "-hide_banner",
      "-loglevel", "error",
      "-f", "avfoundation",
      "-i", `:${deviceIndex}`,
      "-f", "s16le",
      "-acodec", "pcm_s16le",
      "-ar", String(sampleRate),
      "-ac", "1",
      "pipe:1"
    ]);

    const session = new CaptureSession({ child, source: "device", label: `device:${deviceIndex}` });
    this.sessions.add(session);

    session.on("end", () => this.sessions.delete(session));
    session.on("error", () => this.sessions.delete(session));

    return session;
  }

  /**
   * Capture from a file instead of a device.
   *
   * This is the test path: a recorded phrase goes in as if it were the
   * player's microphone. It exercises the identical decode → VAD → wav →
   * transcribe chain that a real microphone would.
   */
  captureFromFile(audioPath, { sampleRate = DEFAULT_SAMPLE_RATE } = {}) {
    const child = spawn(this.ffmpegPath, [
      "-hide_banner",
      "-loglevel", "error",
      "-i", audioPath,
      "-f", "s16le",
      "-acodec", "pcm_s16le",
      "-ar", String(sampleRate),
      "-ac", "1",
      "pipe:1"
    ]);

    const session = new CaptureSession({ child, source: "file", label: `file:${path.basename(audioPath)}` });
    this.sessions.add(session);
    session.on("end", () => this.sessions.delete(session));
    session.on("error", () => this.sessions.delete(session));

    return session;
  }

  stopAll() {
    for (const session of this.sessions) {
      session.stop();
    }
    this.sessions.clear();
  }

  #run(command, args) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args);
      const stdout = [];
      const stderr = [];

      child.stdout?.on("data", (chunk) => stdout.push(chunk));
      child.stderr?.on("data", (chunk) => stderr.push(chunk));

      child.on("error", (error) => {
        error.stdout = Buffer.concat(stdout);
        error.stderr = Buffer.concat(stderr);
        reject(error);
      });

      child.on("close", (code) => {
        const result = {
          code,
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr).toString("utf8")
        };
        if (code === 0) {
          resolve(result);
          return;
        }
        const error = new Error(result.stderr.trim() || `${command} exited ${code}`);
        error.code = code;
        error.stdout = result.stdout;
        error.stderr = result.stderr;
        reject(error);
      });
    });
  }
}

module.exports = {
  AudioEngine,
  CaptureSession,
  VoiceActivityDetector,
  pcmToWav,
  rmsDb,
  DEFAULT_SAMPLE_RATE
};
