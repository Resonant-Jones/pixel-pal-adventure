// voice/voiceConfig.js
//
// Configuration for Guardian's voice.
//
// This module deliberately knows nothing about HOW the voice travels. The
// transport (Bedrock Voice Chat, a local companion app, a future in-game
// client) is a separate concern; this is only "what voice, at what speed,
// with which provider".
//
// Why the provider is MiniMax: the account already has a key in .env, the
// speech models are the good ones, and the same key covers text-to-speech,
// speech-to-text and embeddings. Nothing else needs to be provisioned.
//
// LANDMINE: model/provider changes are .env + restart. There is no hot reload,
// deliberately.

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

// Voice candidates worth auditioning for Guardian. Guardian is meant to sound
// like a kid's best friend who happens to be very good with blocks: quick,
// dry, curious, loyal. Not a narrator, not a customer service desk.
//
// These ids and descriptions come from MiniMax's live GET /v1/get_voice —
// they are not guessed, and an unknown id fails with "voice id not exist".
//
//   English_FriendlyPerson      — the default. "A friendly and natural-sounding
//                                 adult male voice... like an approachable
//                                 guy-next-door." A friend, not a narrator.
//   English_Comedian            — "a breezy young adult male comedian with a
//                                 British accent, delivering lines with a light
//                                 and humorous touch." Best for the dry wit;
//                                 costs a British accent.
//   English_Jovialman           — cheerful, good-natured, general American.
//   English_Strong-WilledBoy    — determined, slightly older-sounding, British.
//   English_PlayfulGirl         — playful youth voice; a different character.
//   English_Deep-VoicedGentleman — deep and wise; too much gravitas for a peer.
//
// Run `node scripts/voiceSay.js "hello" --voice <id>` to audition one.
const DEFAULT_VOICE_ID = "English_FriendlyPerson";

function getVoiceConfig(env = process.env) {
  const baseUrl = stripTrailingSlash(
    env.MINIMAX_BASE_URL || env.OPENAI_BASE_URL || "https://api.minimax.io/v1"
  );

  return {
    // Off by default. Voice costs money per call and adds a dependency on the
    // audio path working; it should be switched on deliberately.
    enabled: parseBoolean(env.VOICE_ENABLED, false),

    apiKey: env.MINIMAX_API_KEY || env.OPENAI_API_KEY || "",
    baseUrl,

    // speech-2.8-turbo over speech-2.8-hd: in-game latency matters more than
    // fidelity, and a half-second of dead air breaks the illusion that
    // Guardian is a person standing there.
    ttsModel: env.VOICE_TTS_MODEL || "speech-2.8-turbo",
    ttsVoiceId: env.VOICE_ID || DEFAULT_VOICE_ID,
    ttsSpeed: parseNumber(env.VOICE_SPEED, 1.05),
    ttsVolume: parseNumber(env.VOICE_VOL, 1),
    ttsPitch: parseNumber(env.VOICE_PITCH, 0),
    ttsFormat: env.VOICE_FORMAT || "mp3",
    ttsSampleRate: parseNumber(env.VOICE_SAMPLE_RATE, 32000),
    ttsBitrate: parseNumber(env.VOICE_BITRATE, 128000),

    asrModel: env.VOICE_ASR_MODEL || "asr-1.0",

    timeoutMs: parseNumber(env.VOICE_TIMEOUT_MS, 30000),

    // Where synthesised audio is staged for the companion app to fetch.
    audioDir: env.VOICE_AUDIO_DIR || "",

    // A cap on how long a spoken line may be. In-game chat is one or two
    // sentences; anything longer is a lecture, and a lecture in voice is
    // unbearable.
    maxChars: parseNumber(env.VOICE_MAX_CHARS, 220)
  };
}

function validateVoiceConfig(config) {
  if (!config?.enabled) {
    return config;
  }

  if (!config.apiKey) {
    throw new Error(
      "Voice is enabled but MINIMAX_API_KEY is missing. Set it in .env, or set VOICE_ENABLED=false."
    );
  }

  return config;
}

module.exports = {
  DEFAULT_VOICE_ID,
  getVoiceConfig,
  validateVoiceConfig,
  parseBoolean,
  parseNumber
};
