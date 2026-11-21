const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const { getCompanionConfig } = require("../companion/companionConfig");
const { AudioEngine, VoiceActivityDetector, pcmToWav, rmsDb } = require("../companion/audioEngine");
const { CompanionApp, voiceMatches, contentWords } = require("../companion/companionApp");

// The companion app, tested without touching a provider, a microphone, or a
// real Minecraft server.
//
// What this file exists to protect:
//
// 1. The app degrades. A missing device, a dead agent, a failed decode must
//    never throw into the game or lose the line Guardian already said.
// 2. The duck guard works. If the app plays Guardian out loud while listening
//    to the same microphone, Guardian must not hear itself.
// 3. The acceptance comparison is about words, not about strings. Speech
//    recognition returns "what are you building today", not the exact
//    characters that were spoken, and a test that demands an exact match
//    fails for the wrong reason.

// ---------------------------------------------------------------- helpers

function makeConfig(overrides = {}) {
  const base = getCompanionConfig(
    {
      GUARDIAN_CONTROL_TOKEN: "test-token",
      COMPANION_APP_PORT: "0",
      COMPANION_APP_HOST: "127.0.0.1"
    },
    { root: fs.mkdtempSync(path.join(os.tmpdir(), "companion-test-")) }
  );

  return {
    ...base,
    ...overrides,
    controlPlane: { ...base.controlPlane, ...(overrides.controlPlane || {}) },
    audio: { ...base.audio, ...(overrides.audio || {}) }
  };
}

// A PCM frame of a given amplitude, at the given sample rate.
function tone({ milliseconds = 100, amplitude = 0.3, sampleRate = 48000 } = {}) {
  const samples = Math.floor((sampleRate * milliseconds) / 1000);
  const buffer = Buffer.alloc(samples * 2);

  for (let i = 0; i < samples; i += 1) {
    buffer.writeInt16LE(Math.round(amplitude * 32767), i * 2);
  }

  return buffer;
}

function silence({ milliseconds = 100, sampleRate = 48000 } = {}) {
  return tone({ milliseconds, amplitude: 0, sampleRate });
}

// ------------------------------------------------------------- config

async function testConfig() {
  const config = getCompanionConfig({
    GUARDIAN_CONTROL_TOKEN: "abc",
    COMPANION_AUDIO_OUTPUT: "2",
    COMPANION_AUDIO_INPUT: "BlackHole 2ch",
    COMPANION_APP_PORT: "9000"
  });

  assert.equal(config.controlPlane.token, "abc");
  assert.equal(config.controlPlane.wsUrl, "ws://127.0.0.1:8787/voice");
  assert.equal(config.listen.port, 9000);

  // A device can be an index or a name. Both have to work, because an index
  // is unambiguous and a name is readable, and a config file should be able
  // to use either.
  assert.equal(config.audio.outputDevice.index, 2);
  assert.equal(config.audio.outputDevice.name, null);
  assert.equal(config.audio.inputDevice.index, null);
  assert.equal(config.audio.inputDevice.name, "BlackHole 2ch");

  const bare = getCompanionConfig({});
  assert.equal(bare.audio.outputDevice, null);
  assert.equal(bare.audio.inputDevice, null);
  assert.equal(bare.listen.port, 8788);

  console.log("  ✓ config reads devices as either an index or a name");
}

// ------------------------------------------------------------------ vad

async function testVoiceActivity() {
  const vad = new VoiceActivityDetector({
    sampleRate: 48000,
    thresholdDb: -45,
    hangoverMs: 200,
    minUtteranceMs: 100,
    maxUtteranceMs: 5000
  });

  // Silence must not become an utterance. This is the failure that turns a
  // quiet room into a stream of empty transcriptions.
  let ended = null;
  for (let i = 0; i < 10; i += 1) {
    const result = vad.push(silence({ milliseconds: 20 }));
    if (result.ended) ended = result;
  }
  assert.equal(ended, null, "silence must not produce an utterance");

  // A phrase followed by a pause must be detected, and only once.
  const phrase = tone({ milliseconds: 400, amplitude: 0.4 });
  let started = false;
  let utterances = 0;
  let captured = null;

  for (const chunk of [phrase, silence({ milliseconds: 300 })]) {
    const result = vad.push(chunk);
    if (result.started) started = true;
    if (result.ended) {
      utterances += 1;
      captured = result.utterance;
    }
  }

  assert.equal(started, true, "a loud phrase must start an utterance");
  assert.equal(utterances, 1, "one phrase must produce exactly one utterance");
  assert.ok(captured && captured.length > 0, "the utterance must carry audio");
  assert.ok(rmsDb(captured) > -45, "the captured audio must actually be loud");

  // The detector must not fire twice on the same phrase.
  const after = vad.push(silence({ milliseconds: 300 }));
  assert.equal(after.ended, false, "the same phrase must not be counted twice");

  // A single loud frame is a noise, not a phrase. Two loud frames in a row
  // are a phrase, and the lead-in must be kept so the first syllable is not
  // clipped off.
  const isolated = new VoiceActivityDetector({ sampleRate: 48000, thresholdDb: -45, hangoverMs: 200 });
  const slam = isolated.push(tone({ milliseconds: 20, amplitude: 0.9 }));
  assert.equal(slam.started, false, "one loud frame must not start a phrase");

  const pair = isolated.push(tone({ milliseconds: 20, amplitude: 0.9 }));
  assert.equal(pair.started, true, "two loud frames must start a phrase");

  console.log("  ✓ voice activity finds one utterance and ignores silence");
}

// ------------------------------------------------------------------ wav

async function testWavHeader() {
  const pcm = tone({ milliseconds: 100 });
  const wav = pcmToWav(pcm, { sampleRate: 48000, channels: 1 });

  assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(wav.subarray(8, 12).toString("ascii"), "WAVE");
  assert.equal(wav.subarray(12, 16).toString("ascii"), "fmt ");
  assert.equal(wav.readUInt16LE(20), 1, "must be PCM");
  assert.equal(wav.readUInt16LE(22), 1, "must be mono");
  assert.equal(wav.readUInt32LE(24), 48000, "sample rate must survive");
  assert.equal(wav.readUInt16LE(34), 16, "must be 16-bit");
  assert.equal(wav.readUInt32LE(40), pcm.length, "the data length must be right");
  assert.equal(wav.length, 44 + pcm.length);

  console.log("  ✓ wav wrapping produces a valid header");
}

// ------------------------------------------------------- acceptance match

async function testVoiceMatching() {
  // The words are right even though the string is different. This is what a
  // speech recogniser actually returns.
  const ok = voiceMatches(
    "Guardian, what are you building today?",
    "guardian what are you building today"
  );
  assert.equal(ok.ok, true, "matching words must pass");

  // Right words, wrong order, still right.
  assert.equal(
    voiceMatches("what are you building today", "today you building what are").ok,
    true
  );

  // Different words must fail, even if the length is similar.
  assert.equal(
    voiceMatches("what are you building today", "the weather is quite pleasant today").ok,
    false
  );

  // Nothing heard must fail.
  assert.equal(voiceMatches("hello there", "").ok, false);

  // Stop words are not content. "the" appearing or not is not a difference.
  assert.deepEqual(contentWords("the cat and the hat"), ["cat", "hat"]);

  console.log("  ✓ the acceptance comparison is about words, not strings");
}

// ------------------------------------------------------------ duck guard

async function testDuckGuard() {
  const engine = new AudioEngine({ logger: { warn() {}, log() {}, error() {} } });

  // A capture session that swallows audio while ducked. This is the guard
  // that stops Guardian hearing itself on a same-machine acoustic loop.
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.on("data", () => {});
  child.kill = () => {};

  const { CaptureSession } = require("../companion/audioEngine");
  const session = new CaptureSession({ child, source: "device", label: "test" });

  const heard = [];
  session.on("pcm", (chunk) => heard.push(chunk));

  session.setDucked(true);
  child.stdout.emit("data", Buffer.from([1, 2, 3]));
  assert.equal(heard.length, 0, "ducked audio must be dropped");

  session.setDucked(false);
  child.stdout.emit("data", Buffer.from([1, 2, 3]));
  assert.equal(heard.length, 1, "audio must flow again once un-ducked");

  void engine;
  console.log("  ✓ the duck guard drops guardian's own voice");
}

// ------------------------------------------------------- the app itself

class FakeSocket {
  constructor() {
    this.handlers = {};
    this.OPEN = 1;
    this.readyState = 1;
    this.sent = [];
  }

  on(event, handler) {
    this.handlers[event] = handler;
  }

  send(data) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.handlers.close?.();
  }

  fire(event, ...args) {
    this.handlers[event]?.(...args);
  }
}

async function testAppAgainstFakeAgent() {
  const requests = [];
  const played = [];

  const spoken = [];
  const transcribed = [];

  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || "GET" });

    const body = async () => ({ json: async () => ({}) });

    if (String(url).endsWith("/ready")) {
      return { ok: true, status: 200, json: async () => ({ ok: true, ready: true }) };
    }

    if (String(url).endsWith("/voice/spoken")) {
      return { ok: true, status: 200, json: async () => ({ ok: true, enabled: true, spoken: [] }) };
    }

    if (String(url).endsWith("/voice/presence")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          dimension: "overworld",
          guardian: { name: "Guardian", position: { x: 10, y: 64, z: -3 } },
          players: [{ name: "Panda_Nuggetz", distance: 4, position: { x: 12, y: 64, z: -3 }, approved: true }],
          primaryPlayer: "Panda_Nuggetz"
        })
      };
    }

    if (String(url).includes("/voice/audio/")) {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => Buffer.alloc(4096, 7)
      };
    }

    if (String(url).endsWith("/voice/say")) {
      const id = "voice-test-1";
      spoken.push({ id });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, id, format: "mp3", durationMs: 1500, text: "hello" })
      };
    }

    if (String(url).includes("/voice/transcribe")) {
      // What a recogniser actually returns: no punctuation, no capitals, and
      // function words kept or dropped arbitrarily. The comparison has to
      // survive that.
      const text = String(url).includes("feed=0")
        ? "voice link check if you can hear this the link is open"
        : "guardian what are you building today";
      transcribed.push({ url: String(url), text });

      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, transcript: text, speaker: "Panda_Nuggetz", fed: !String(url).includes("feed=0") })
      };
    }

    void body;
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };

  const audioEngine = {
    listInputDevices: async () => [{ index: 0, name: "Test Mic" }],
    probeOutputDevices: async () => [{ index: 1, ok: true }],
    decodeToPcm: async () => Buffer.alloc(4800, 1),
    playPcm: async (pcm, options) => {
      played.push({ bytes: pcm.length, deviceIndex: options.deviceIndex });
      return { ok: true };
    },
    startCapture: () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.kill = () => {};
      const session = new (require("../companion/audioEngine").CaptureSession)({
        child,
        source: "device",
        label: "test"
      });
      return session;
    },
    stopAll() {}
  };

  const config = makeConfig({
    audio: { outputDevice: { index: 1, name: null }, inputDevice: { index: 0, name: "Test Mic" } }
  });

  const socket = new FakeSocket();
  const app = new CompanionApp({
    config,
    fetchImpl,
    audioEngine,
    wsFactory: () => socket,
    playerTts: {
      speak: async (text) => ({
        audio: Buffer.alloc(2048, 3),
        durationMs: 900,
        format: "mp3",
        voiceId: "test-player",
        text
      })
    },
    logger: { log() {}, warn() {}, error() {} }
  });

  await app.start();

  socket.fire("open");
  assert.equal(app.getState().controlPlane.connected, true, "the app must notice it is connected");

  socket.fire("message", Buffer.from(JSON.stringify({ type: "voice_ready", enabled: true, spoken: [] })));
  assert.equal(app.getState().voice.enabled, true);

  // A spoken line must become a transcript entry and must reach the audio
  // device. This is the whole outbound path.
  socket.fire(
    "message",
    Buffer.from(
      JSON.stringify({
        type: "speak",
        id: "voice-test-1",
        text: "Still in the cave, still losing arguments with skeletons.",
        reason: "say",
        durationMs: 3000,
        format: "mp3",
        audioUrl: "/voice/audio/voice-test-1"
      })
    )
  );

  await new Promise((resolve) => setTimeout(resolve, 120));

  const state = app.getState();
  const guardianEntries = state.transcript.filter((entry) => entry.direction === "guardian");
  assert.ok(guardianEntries.length >= 1, "the spoken line must appear in the transcript");
  assert.match(guardianEntries[guardianEntries.length - 1].text, /cave/);

  assert.equal(played.length, 1, "the audio must have been played");
  assert.equal(played[0].deviceIndex, 1, "the audio must go to the configured device");

  // Presence must be polled so the voice can be placed.
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.ok(app.getState().presence, "presence must be polled");
  assert.equal(app.getState().presence.guardian.position.x, 10);

  // Asking Guardian to speak goes through the agent, not around it.
  await app.say("hello from the console");
  assert.ok(
    requests.some((request) => request.url.endsWith("/voice/say")),
    "saying a line must use the agent's endpoint"
  );

  // A voice check must be able to run and must reach a verdict.
  const verdict = await app.runVerification({ playerLine: "Guardian, what are you building today?" });
  assert.equal(verdict.finishedAt !== null, true, "the check must finish");
  assert.ok(verdict.stages.length >= 6, "the check must cover the whole path");

  const audioStage = verdict.stages.find((stage) => stage.name === "audio carries guardian's words");
  assert.ok(audioStage, "the check must verify the audio carries the words");
  assert.equal(audioStage.ok, true, `the audio check failed: ${audioStage.detail}`);

  const playerStage = verdict.stages.find((stage) => stage.name === "player speech reaches the agent");
  assert.ok(playerStage, "the check must verify the inbound path");
  assert.equal(playerStage.ok, true, `the inbound check failed: ${playerStage.detail}`);

  await app.stop();
  console.log("  ✓ the app carries a line out loud and a line back in");
}

// ------------------------------------------------------- failure is quiet

async function testFailuresAreQuiet() {
  const failing = async () => ({
    ok: false,
    status: 500,
    json: async () => ({ ok: false, error: "agent is down" })
  });

  const config = makeConfig({ audio: { outputDevice: null, inputDevice: null } });

  const app = new CompanionApp({
    config,
    fetchImpl: failing,
    audioEngine: {
      listInputDevices: async () => [],
      probeOutputDevices: async () => [],
      decodeToPcm: async () => Buffer.alloc(0),
      playPcm: async () => ({ ok: false, error: "no device" }),
      startCapture: () => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.kill = () => {};
        return new (require("../companion/audioEngine").CaptureSession)({ child, source: "device", label: "t" });
      },
      stopAll() {}
    },
    wsFactory: () => new FakeSocket(),
    logger: { log() {}, warn() {}, error() {} }
  });

  await app.start();

  // A dead agent must not throw out of start().
  const verdict = await app.runVerification();
  assert.equal(verdict.finishedAt !== null, true, "a failed check must still finish");
  assert.equal(verdict.passed, false, "a dead agent must not pass the check");

  // No output device must not throw when Guardian speaks.
  const socket = new FakeSocket();
  const app2 = new CompanionApp({
    config,
    fetchImpl: failing,
    audioEngine: {
      listInputDevices: async () => [],
      probeOutputDevices: async () => [],
      decodeToPcm: async () => Buffer.alloc(0),
      playPcm: async () => ({ ok: false, error: "no device" }),
      startCapture: () => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.kill = () => {};
        return new (require("../companion/audioEngine").CaptureSession)({ child, source: "device", label: "t" });
      },
      stopAll() {}
    },
    wsFactory: () => socket,
    logger: { log() {}, warn() {}, error() {} }
  });

  await app2.start();
  socket.fire("open");
  socket.fire(
    "message",
    Buffer.from(
      JSON.stringify({
        type: "speak",
        id: "voice-x",
        text: "a line with nowhere to go",
        reason: "say",
        durationMs: 1000,
        format: "mp3",
        audioUrl: "/voice/audio/voice-x"
      })
    )
  );

  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.ok(app2.getState().transcript.length >= 1, "the line must still be recorded");

  await app.stop();
  await app2.stop();

  console.log("  ✓ a dead agent or a missing device never takes the app down");
}

// ------------------------------------------------------------------ run

async function main() {
  console.log("companion app");

  await testConfig();
  await testVoiceActivity();
  await testWavHeader();
  await testVoiceMatching();
  await testDuckGuard();
  await testAppAgainstFakeAgent();
  await testFailuresAreQuiet();

  console.log("  all companion tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
