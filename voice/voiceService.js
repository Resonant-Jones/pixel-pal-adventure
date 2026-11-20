// voice/voiceService.js
//
// The voice hub. Transport-agnostic on purpose.
//
// Guardian's voice has to travel to the player somehow, and the transport is
// still being chosen. What is certain is the shape of the problem:
//
//   out: the companion says a line  ->  synthesise to audio  ->  hand it to
//        whatever is carrying the voice (Bedrock Voice Chat client, a local
//        speaker, a future in-game client)
//   in:  the player says something   ->  a companion app captures it  ->
//        transcribe  ->  hand the text to the agent as if it were chat
//
// So this module does the two things that are transport-independent —
// synthesise, and transcribe — and publishes them as events. The transport
// subscribes. Nothing here knows about Bedrock, Discord, or microphones.
//
// WHY THIS EXISTS (the constraint that shaped it):
// Bedrock clients cannot use Java voice mods. Simple Voice Chat's own FAQ
// says voice inside Bedrock is impossible because Bedrock cannot load Java
// mods, and Geyser emulates a *vanilla* Java client — a Bedrock player
// arrives as a Java player without the mod, so they hear nobody and nobody
// hears them.
//
// The route that DOES work with Geyser is Bedrock Voice Chat, whose Paper mod
// reports the position of every player — including the mineflayer bot — to a
// separate voice server. That is what makes Guardian's voice arrive from
// Guardian's actual position in the world rather than from nowhere.
//
// So the voice always has a companion piece of software running next to the
// game. This module is the agent-side half of that arrangement; the
// companion app is the other half.

const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { MiniMaxTtsClient } = require("./ttsClient");
const { MiniMaxAsrClient } = require("./asrClient");
const { getVoiceConfig } = require("./voiceConfig");

class VoiceService extends EventEmitter {
  constructor({
    env = process.env,
    ttsClient = null,
    asrClient = null,
    logger = console,
    audioDir = null
  } = {}) {
    super();

    this.config = getVoiceConfig(env);
    this.logger = logger;
    this.ttsClient = ttsClient || new MiniMaxTtsClient({ env, logger });
    this.asrClient = asrClient || new MiniMaxAsrClient({ env, logger });
    this.audioDir = audioDir || this.config.audioDir || defaultAudioDir();

    // Recent spoken lines, newest last. The control plane serves these so the
    // companion app can catch up after a reconnect, and so a parent can read
    // what Guardian actually said out loud.
    this.history = [];
    this.maxHistory = 50;
  }

  get enabled() {
    return Boolean(this.config?.enabled);
  }

  /**
   * Say a line.
   *
   * The line is truncated to the configured maximum: in-game chat is one or
   * two sentences, and a lecture delivered in voice is unbearable in a way
   * that a lecture in chat is merely tedious.
   */
  async speak(text, { reason = "reply", speaker = null } = {}) {
    if (!this.enabled) {
      return { ok: false, skipped: "voice_disabled" };
    }

    const line = truncate(String(text || "").trim(), this.config.maxChars);

    if (!line) {
      return { ok: false, skipped: "empty" };
    }

    let result;
    try {
      result = await this.ttsClient.speak(line);
    } catch (error) {
      // A voice failure must NEVER take the game down. The line was already
      // said in chat; losing the audio is a degraded experience, not a crash.
      this.logger.warn?.(`[voice] synthesis failed: ${error?.message || error}`);
      this.emit("voice_error", { reason, error: error?.message || String(error) });
      return { ok: false, skipped: "synthesis_failed", error: error?.message || String(error) };
    }

    const id = `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let audioPath = null;

    try {
      fs.mkdirSync(this.audioDir, { recursive: true });
      audioPath = path.join(this.audioDir, `${id}.${result.format}`);
      fs.writeFileSync(audioPath, result.audio);
    } catch (error) {
      this.logger.warn?.(`[voice] could not stage audio: ${error?.message || error}`);
    }

    const entry = {
      id,
      text: line,
      reason,
      speaker,
      durationMs: result.durationMs,
      format: result.format,
      voiceId: result.voiceId,
      audioPath,
      at: new Date().toISOString()
    };

    this.history.push(entry);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // The transport listens for this. It decides whether the audio reaches a
    // Bedrock voice client, a speaker, or nowhere at all.
    this.emit("speak", entry);

    return { ok: true, ...entry };
  }

  /**
   * Transcribe captured audio.
   *
   * @param {Buffer} buffer
   * @param {{ filename?: string, speaker?: string }} [options]
   */
  async transcribe(buffer, options = {}) {
    if (!this.enabled) {
      return { ok: false, skipped: "voice_disabled" };
    }

    let result;
    try {
      result = await this.asrClient.transcribe(buffer, options);
    } catch (error) {
      this.logger.warn?.(`[voice] transcription failed: ${error?.message || error}`);
      this.emit("voice_error", { reason: "transcribe", error: error?.message || String(error) });
      return { ok: false, skipped: "transcription_failed", error: error?.message || String(error) };
    }

    const text = String(result.text || "").trim();

    if (!text) {
      return { ok: false, skipped: "empty_transcript" };
    }

    const entry = {
      text,
      speaker: options.speaker || null,
      at: new Date().toISOString()
    };

    this.emit("heard", entry);

    return { ok: true, ...entry };
  }

  listSpoken(limit = 20) {
    return this.history.slice(-limit);
  }

  getAudioPath(id) {
    const entry = this.history.find((item) => item.id === id);
    return entry?.audioPath || null;
  }
}

function truncate(text, maxChars) {
  const value = String(text || "");
  if (!Number.isFinite(maxChars) || maxChars <= 0 || value.length <= maxChars) {
    return value;
  }

  // Cut on a word boundary so the line does not end mid-word.
  const cut = value.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

function defaultAudioDir() {
  return path.resolve(__dirname, "..", ".local", "voice");
}

module.exports = { VoiceService, truncate };
