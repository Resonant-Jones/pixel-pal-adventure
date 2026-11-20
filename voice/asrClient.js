// voice/asrClient.js
//
// MiniMax speech-to-text.
//
//   POST {baseUrl}/speech_to_text
//   Authorization: Bearer <key>
//   multipart/form-data: model, file, response_format=json, timestamp_level=word
//
//   -> { text: "..." }   (the exact envelope has moved between API versions,
//                         so several shapes are accepted below)
//
// LANDMINE: the file must be a real container (wav/mp3/flac/ogg/aac/m4a).
// Raw PCM without a container is rejected. If the companion app captures
// audio it must write a container before handing it over.

const { getVoiceConfig, validateVoiceConfig } = require("./voiceConfig");

// Read the transcript out of whichever envelope the API returned. Older and
// newer versions disagree about where the text lives, and a silent failure
// here means the companion appears deaf rather than broken.
function extractTranscript(payload) {
  if (!payload) return "";

  if (typeof payload.text === "string" && payload.text.trim()) {
    return payload.text.trim();
  }

  if (typeof payload.data?.text === "string" && payload.data.text.trim()) {
    return payload.data.text.trim();
  }

  if (typeof payload.result?.text === "string" && payload.result.text.trim()) {
    return payload.result.text.trim();
  }

  if (Array.isArray(payload.subtitles) && payload.subtitles.length) {
    const joined = payload.subtitles
      .map((segment) => (typeof segment === "string" ? segment : segment?.text))
      .filter(Boolean)
      .join(" ")
      .trim();
    if (joined) return joined;
  }

  return "";
}

class MiniMaxAsrClient {
  constructor({ env = process.env, fetchImpl = globalThis.fetch, logger = console } = {}) {
    this.config = validateVoiceConfig(getVoiceConfig(env));
    this.fetch = fetchImpl;
    this.logger = logger;
  }

  get enabled() {
    return Boolean(this.config?.enabled);
  }

  /**
   * Transcribe an audio buffer.
   *
   * @param {Buffer} buffer
   * @param {{ filename?: string, mimeType?: string }} [options]
   * @returns {Promise<{ text: string, raw: unknown }>}
   */
  async transcribe(buffer, options = {}) {
    if (!buffer || !buffer.length) {
      throw new Error("ASR: refusing to transcribe empty audio.");
    }

    if (!this.config.enabled) {
      throw new Error("ASR: voice is disabled. Set VOICE_ENABLED=true in .env.");
    }

    const filename = options.filename || "capture.wav";
    const mimeType = options.mimeType || mimeForFilename(filename);

    const form = new FormData();
    form.append("model", this.config.asrModel);
    form.append("file", new Blob([buffer], { type: mimeType }), filename);
    form.append("response_format", "json");
    form.append("timestamp_level", "word");
    form.append("stream", "false");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let response;
    try {
      response = await this.fetch(`${this.config.baseUrl}/speech_to_text`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`
        },
        body: form,
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`ASR: request timed out after ${this.config.timeoutMs}ms.`);
      }
      throw new Error(`ASR: request failed: ${error?.message || error}`);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const detail = await safeText(response);
      throw new Error(`ASR: HTTP ${response.status} — ${detail}`);
    }

    const payload = await response.json();

    const statusCode = payload?.base_resp?.status_code;
    if (statusCode !== undefined && statusCode !== 0) {
      throw new Error(
        `ASR: provider error ${statusCode} — ${payload?.base_resp?.status_msg || "unknown"}`
      );
    }

    return { text: extractTranscript(payload), raw: payload };
  }
}

function mimeForFilename(filename) {
  const lower = String(filename).toLowerCase();
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".flac")) return "audio/flac";
  if (lower.endsWith(".ogg") || lower.endsWith(".opus")) return "audio/ogg";
  if (lower.endsWith(".m4a") || lower.endsWith(".aac")) return "audio/mp4";
  return "audio/wav";
}

async function safeText(response) {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return "<no body>";
  }
}

module.exports = { MiniMaxAsrClient, extractTranscript };
