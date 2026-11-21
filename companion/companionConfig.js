// companion/companionConfig.js
//
// Configuration for the companion app — the piece of software that carries
// Guardian's voice into the game.
//
// WHY A SEPARATE APP, AND WHY IT IS NOT PART OF THE AGENT:
//
// The agent half of voice (voice/) synthesises and transcribes. It knows
// nothing about speakers, microphones or transports. The companion app half
// knows about audio devices and transports. It knows nothing about the game.
//
// The split is not tidiness, it is a hard requirement: the app has to touch
// CoreAudio, and CoreAudio is unreachable from a sandboxed process. The agent
// also has to survive the app crashing, and the app has to survive the agent
// restarting. Two processes, one HTTP/WebSocket contract between them.
//
// Everything here is configuration, not policy. Where a decision matters, it
// lives in the agent (voice/voiceConfig.js) and this file only reads it.

const path = require("node:path");

const DEFAULT_SAMPLE_RATE = 48000;
const DEFAULT_PORT = 8788;
const DEFAULT_HOST = "127.0.0.1";

function getCompanionConfig(env = process.env, options = {}) {
  const root = options.root || path.resolve(__dirname, "..");

  const controlPort = readInt(env.GUARDIAN_CONTROL_PORT, 8787);
  const controlHost = env.GUARDIAN_CONTROL_HOST || "127.0.0.1";
  const controlToken = String(env.GUARDIAN_CONTROL_TOKEN || "").trim();

  return {
    enabled: readBool(env.COMPANION_APP_ENABLED, true),

    // Where the agent is. The app never assumes 127.0.0.1 — the point of a
    // separate process is that it can sit on another machine from the agent.
    controlPlane: {
      host: controlHost,
      port: controlPort,
      token: controlToken,
      baseUrl: `http://${controlHost}:${controlPort}`,
      wsUrl: `ws://${controlHost}:${controlPort}/voice`,
      // Who a captured voice is assumed to belong to when the app has not
      // been told otherwise. The agent applies the real trust tier to this
      // name, so a wrong guess here is a wrong tier, not a wrong decision.
      defaultSpeaker: env.COMPANION_DEFAULT_SPEAKER || "Panda_Nuggetz"
    },

    // Where the app's own UI and API live.
    listen: {
      host: env.COMPANION_APP_HOST || DEFAULT_HOST,
      port: readInt(env.COMPANION_APP_PORT, DEFAULT_PORT)
    },

    audio: {
      // Where Guardian's voice goes. A virtual device (BlackHole) is the
      // correct answer — the voice must enter the voice client's input, not
      // the speakers. When it is unset the app still works, it just does not
      // put the voice on the wire.
      outputDevice: readDevice(env.COMPANION_AUDIO_OUTPUT),

      // Where the player's voice comes from.
      inputDevice: readDevice(env.COMPANION_AUDIO_INPUT),

      // Devices that must never be used as a capture device.
      //
      // An iPhone or iPad is not a microphone for this system. It belongs to
      // the son, and on macOS a Continuity input can also carry the machine's
      // own audio straight back in — which is a loop, not a microphone.
      //
      // The list is matched loosely against the device name, so "Resonant
      // Jones's iPhone" is caught as well as "iPhone".
      blockedInputs: readList(env.COMPANION_AUDIO_BLOCKED, ["iphone", "ipad"]),

      // How often to check whether the configured device is still the one we
      // are actually using. The device list reorders whenever something
      // connects or disconnects, and a pinned index would silently become a
      // different microphone.
      devicePollMs: readInt(env.COMPANION_AUDIO_POLL_MS, 5000),

      // There is deliberately no separate "play out loud" switch. The output
      // device IS the transport: on the real setup it is a virtual device the
      // voice client reads, and on the local test path it is the speakers.
      // One device, one meaning, no way to accidentally play the same line
      // twice.

      // Drop inbound audio while Guardian is speaking. Without this, a
      // same-machine acoustic loop turns Guardian into a stutter that talks to
      // itself. Real transports separate the two legs, so this only bites on
      // the local test path — but it must exist, or the local test path lies.
      duckOnPlayback: readBool(env.COMPANION_AUDIO_DUCK, true),

      // How long to keep listening-blind after Guardian stops speaking.
      //
      // The tail of a line does not end when the audio ends. On the local
      // test path Guardian's voice comes out of the speakers and the built-in
      // microphone hears the reverberation of it, which would be transcribed
      // and sent back as if the player had said it — and then Guardian would
      // answer its own voice, which is the loop this whole guard exists to
      // stop. On the real transport the two legs are different devices and
      // this does nothing.
      duckTailMs: readInt(env.COMPANION_AUDIO_DUCK_TAIL_MS, 1500),

      sampleRate: readInt(env.COMPANION_AUDIO_SAMPLE_RATE, DEFAULT_SAMPLE_RATE),
      channels: 1,

      // Energy threshold for deciding the player started speaking, in dBFS.
      // -45 is quiet-room speech on a decent mic.
      vadThresholdDb: readNumber(env.COMPANION_VAD_THRESHOLD_DB, -45),

      // How long a pause must be before a phrase counts as finished.
      vadHangoverMs: readInt(env.COMPANION_VAD_HANGOVER_MS, 700),

      // Longest single phrase the app will send for transcription.
      maxUtteranceMs: readInt(env.COMPANION_MAX_UTTERANCE_MS, 15000)
    },

    // The app can speak *as* the player to exercise the inbound path without
    // a human in the loop. That is a test affordance, so it is a separate
    // voice from Guardian's.
    //
    // The id must be one MiniMax actually serves: an unknown id fails with
    // provider error 2054 "voice id not exist", which looks like a network
    // problem and is not one. `node scripts/voiceSay.js --list` prints the
    // live list.
    playerVoice: {
      voiceId: env.COMPANION_PLAYER_VOICE || "English_Strong-WilledBoy",
      speed: readNumber(env.COMPANION_PLAYER_VOICE_SPEED, 1)
    },

    // How often to ask the agent where everyone is standing.
    presenceIntervalMs: readInt(env.COMPANION_PRESENCE_INTERVAL_MS, 2000),

    // Where staged audio and scratch files go.
    workDir: env.COMPANION_WORK_DIR || path.join(root, ".local", "companion"),

    ffmpegPath: env.COMPANION_FFMPEG || "ffmpeg"
  };
}

function readBool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).trim().toLowerCase() === "true";
}

function readInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readNumber(value, fallback) {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readList(value, fallback = []) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// A device is either an index into the avfoundation list or a name to match.
// Names are friendlier in a config file, indices are unambiguous, so both work.
function readDevice(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    return { index: Number.parseInt(raw, 10), name: null };
  }

  return { index: null, name: raw };
}

module.exports = {
  getCompanionConfig,
  DEFAULT_SAMPLE_RATE,
  DEFAULT_PORT
};
