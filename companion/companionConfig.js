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

      // Play Guardian's voice out loud as well as to the transport. Off by
      // default: once the transport works the son hears it, and a second copy
      // on the desk is just noise.
      speakToSpeakers: readBool(env.COMPANION_AUDIO_SPEAKERS, false),

      // Drop inbound audio while Guardian is speaking. Without this, a
      // same-machine acoustic loop turns Guardian into a stutter that talks to
      // itself. Real transports separate the two legs, so this only bites on
      // the local test path — but it must exist, or the local test path lies.
      duckOnPlayback: readBool(env.COMPANION_AUDIO_DUCK, true),

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
    playerVoice: {
      voiceId: env.COMPANION_PLAYER_VOICE || "English_energetic_young_man",
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
