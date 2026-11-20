const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { MiniMaxTtsClient } = require("../voice/ttsClient");
const { MiniMaxAsrClient, extractTranscript } = require("../voice/asrClient");
const { VoiceService, truncate } = require("../voice/voiceService");
const { getVoiceConfig, validateVoiceConfig } = require("../voice/voiceConfig");

// The voice layer, tested without touching the provider.
//
// The one thing this file exists to protect: a voice failure must NEVER take
// the game down. The line was already said in chat by the time the audio is
// requested, so losing the audio is a degraded experience, not a crash.

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function makeEnv(overrides = {}) {
  return {
    MINIMAX_API_KEY: "test-key",
    MINIMAX_BASE_URL: "https://api.minimax.io/v1",
    VOICE_ENABLED: "true",
    ...overrides
  };
}

async function testConfig() {
  const config = getVoiceConfig(makeEnv());
  assert.equal(config.enabled, true);
  assert.equal(config.baseUrl, "https://api.minimax.io/v1");
  assert.ok(config.ttsVoiceId, "a default voice must exist");
  assert.equal(config.ttsModel, "speech-2.8-turbo");

  const off = getVoiceConfig(makeEnv({ VOICE_ENABLED: "false" }));
  assert.equal(off.enabled, false);

  // A missing key must fail loudly when voice is actually on, and stay quiet
  // when it is off.
  assert.throws(
    () => validateVoiceConfig(getVoiceConfig(makeEnv({ MINIMAX_API_KEY: "" }))),
    /MINIMAX_API_KEY/
  );
  assert.doesNotThrow(() =>
    validateVoiceConfig(getVoiceConfig(makeEnv({ MINIMAX_API_KEY: "", VOICE_ENABLED: "false" })))
  );

  console.log("  ✓ voice config reads the environment and fails loudly");
}

async function testTtsRequestShape() {
  let captured = null;

  const client = new MiniMaxTtsClient({
    env: makeEnv(),
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return jsonResponse({
        data: { audio: "4d5033", status: 2 },
        extra_info: { audio_length: 1500, audio_size: 3 },
        base_resp: { status_code: 0, status_msg: "success" }
      });
    }
  });

  const result = await client.speak("hello there");

  assert.equal(captured.url, "https://api.minimax.io/v1/t2a_v2");
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.headers.Authorization, "Bearer test-key");
  assert.equal(captured.body.model, "speech-2.8-turbo");
  assert.equal(captured.body.text, "hello there");
  assert.equal(captured.body.stream, false);
  assert.equal(captured.body.output_format, "hex");
  assert.equal(captured.body.voice_setting.voice_id, config_voice_id());
  assert.equal(captured.body.audio_setting.format, "mp3");

  assert.ok(Buffer.isBuffer(result.audio));
  assert.equal(result.durationMs, 1500);

  console.log("  ✓ the TTS request matches the documented wire format");
}

function config_voice_id() {
  return getVoiceConfig(makeEnv()).ttsVoiceId;
}

async function testTtsFailures() {
  // A provider error arrives as HTTP 200 with a non-zero base_resp code. Reading
  // only the HTTP status would read a failure as a success.
  const providerError = new MiniMaxTtsClient({
    env: makeEnv(),
    fetchImpl: async () =>
      jsonResponse({
        data: { audio: null },
        base_resp: { status_code: 2054, status_msg: "voice id not exist" }
      })
  });

  await assert.rejects(() => providerError.speak("hi"), /2054/);

  const httpError = new MiniMaxTtsClient({
    env: makeEnv(),
    fetchImpl: async () => jsonResponse({ error: "nope" }, 500)
  });

  await assert.rejects(() => httpError.speak("hi"), /HTTP 500/);

  const noAudio = new MiniMaxTtsClient({
    env: makeEnv(),
    fetchImpl: async () =>
      jsonResponse({ data: { audio: null }, base_resp: { status_code: 0, status_msg: "success" } })
  });

  await assert.rejects(() => noAudio.speak("hi"), /no audio/);

  await assert.rejects(() => providerError.speak("   "), /empty text/);

  const disabled = new MiniMaxTtsClient({
    env: makeEnv({ VOICE_ENABLED: "false" }),
    fetchImpl: async () => {
      throw new Error("must not be called");
    }
  });

  await assert.rejects(() => disabled.speak("hi"), /disabled/);

  console.log("  ✓ a provider error is never mistaken for a success");
}

async function testAsrTranscriptShapes() {
  // The response envelope has moved between API versions. A silent failure
  // here means the companion appears deaf rather than broken.
  assert.equal(extractTranscript({ text: "hello" }), "hello");
  assert.equal(extractTranscript({ data: { text: "hello" } }), "hello");
  assert.equal(extractTranscript({ result: { text: "hello" } }), "hello");
  assert.equal(
    extractTranscript({ subtitles: [{ text: "hello" }, { text: "there" }] }),
    "hello there"
  );
  assert.equal(extractTranscript({}), "");
  assert.equal(extractTranscript(null), "");

  const client = new MiniMaxAsrClient({
    env: makeEnv(),
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.minimax.io/v1/speech_to_text");
      assert.equal(options.method, "POST");
      return jsonResponse({ text: "hey guardian", duration: 1.2 });
    }
  });

  const result = await client.transcribe(Buffer.from("RIFFfake"));
  assert.equal(result.text, "hey guardian");

  await assert.rejects(() => client.transcribe(Buffer.alloc(0)), /empty audio/);

  console.log("  ✓ the transcript is read from every known envelope shape");
}

async function testTruncate() {
  assert.equal(truncate("short line", 220), "short line");
  assert.equal(truncate("one two three four", 8), "one two");
  // Never cut mid-word when a space is available.
  assert.ok(!truncate("alpha beta gamma delta", 12).endsWith("gam"));
  console.log("  ✓ a long line is cut on a word boundary");
}

async function testServiceNeverThrows() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guardian-voice-"));
  const spoken = [];

  const service = new VoiceService({
    env: makeEnv(),
    audioDir: dir,
    ttsClient: {
      speak: async (text) => ({
        audio: Buffer.from("ID3fake"),
        durationMs: 1234,
        format: "mp3",
        voiceId: "English_FriendlyPerson",
        model: "speech-2.8-turbo"
      })
    },
    asrClient: { transcribe: async () => ({ text: "i heard you" }) },
    logger: { warn() {} }
  });

  service.on("speak", (entry) => spoken.push(entry));

  const said = await service.speak("Hello there, friend", { reason: "reply" });
  assert.equal(said.ok, true);
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].text, "Hello there, friend");
  assert.equal(spoken[0].reason, "reply");
  assert.equal(spoken[0].durationMs, 1234);
  assert.ok(fs.existsSync(spoken[0].audioPath), "the audio is staged for the companion app");

  // A provider failure must degrade, not throw. The line was already said in
  // chat; losing the audio is not a reason to take the game down.
  const broken = new VoiceService({
    env: makeEnv(),
    audioDir: dir,
    ttsClient: { speak: async () => { throw new Error("provider exploded"); } },
    logger: { warn() {} }
  });

  const failed = await broken.speak("this will not work");
  assert.equal(failed.ok, false);
  assert.equal(failed.skipped, "synthesis_failed");
  assert.match(failed.error, /provider exploded/);

  const heard = await service.transcribe(Buffer.from("RIFFfake"), { speaker: "Panda_Nuggetz" });
  assert.equal(heard.ok, true);
  assert.equal(heard.text, "i heard you");
  assert.equal(heard.speaker, "Panda_Nuggetz");

  // Disabled voice must be inert, not an error.
  const off = new VoiceService({ env: makeEnv({ VOICE_ENABLED: "false" }), audioDir: dir });
  assert.equal((await off.speak("hello")).ok, false);
  assert.equal((await off.transcribe(Buffer.from("x"))).ok, false);

  fs.rmSync(dir, { recursive: true, force: true });

  console.log("  ✓ the voice service degrades instead of crashing the game");
}

async function testHistory() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guardian-voice-"));
  const service = new VoiceService({
    env: makeEnv(),
    audioDir: dir,
    ttsClient: {
      speak: async () => ({
        audio: Buffer.from("x"),
        durationMs: 10,
        format: "mp3",
        voiceId: "v",
        model: "m"
      })
    },
    logger: { warn() {} }
  });

  for (let i = 0; i < 3; i += 1) {
    await service.speak(`line ${i}`);
  }

  const history = service.listSpoken(2);
  assert.equal(history.length, 2);
  assert.equal(history[1].text, "line 2");

  fs.rmSync(dir, { recursive: true, force: true });
  console.log("  ✓ spoken lines are kept for the companion app and for parents");
}

async function main() {
  console.log("voice tests");
  await testConfig();
  await testTtsRequestShape();
  await testTtsFailures();
  await testAsrTranscriptShapes();
  await testTruncate();
  await testServiceNeverThrows();
  await testHistory();
  console.log("voice tests passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
