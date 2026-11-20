// voice/ttsClient.js
//
// MiniMax text-to-speech.
//
// The wire format is fixed by the API and is easy to get subtly wrong, so it
// is pinned here with the response shape documented inline:
//
//   POST {baseUrl}/t2a_v2
//   Authorization: Bearer <key>
//   { model, text, stream:false, output_format:"hex",
//     voice_setting:{ voice_id, speed, vol, pitch },
//     audio_setting:{ sample_rate, bitrate, format, channel:1 } }
//
//   -> { data: { audio: "<hex>", status: 2 },
//        extra_info: { audio_length, audio_size, ... },
//        base_resp: { status_code: 0, status_msg: "success" } }
//
// LANDMINE: `data` is documented as possibly null and `base_resp.status_code`
// is NOT an HTTP status. A 200 can still carry a provider error. Always read
// base_resp, never just the HTTP code.

const { getVoiceConfig, validateVoiceConfig } = require("./voiceConfig");

class MiniMaxTtsClient {
  constructor({ env = process.env, fetchImpl = globalThis.fetch, logger = console } = {}) {
    this.config = validateVoiceConfig(getVoiceConfig(env));
    this.fetch = fetchImpl;
    this.logger = logger;
  }

  get enabled() {
    return Boolean(this.config?.enabled);
  }

  /**
   * Synthesise one line.
   *
   * @param {string} text
   * @param {{ format?: string }} [options]
   * @returns {Promise<{ audio: Buffer, durationMs: number, format: string, voiceId: string }>}
   */
  async speak(text, options = {}) {
    const line = String(text || "").trim();

    if (!line) {
      throw new Error("TTS: refusing to synthesise empty text.");
    }

    if (!this.config.enabled) {
      throw new Error("TTS: voice is disabled. Set VOICE_ENABLED=true in .env.");
    }

    const format = options.format || this.config.ttsFormat;
    const body = {
      model: this.config.ttsModel,
      text: line,
      stream: false,
      output_format: "hex",
      language_boost: "English",
      voice_setting: {
        voice_id: this.config.ttsVoiceId,
        speed: this.config.ttsSpeed,
        vol: this.config.ttsVolume,
        pitch: this.config.ttsPitch
      },
      audio_setting: {
        sample_rate: this.config.ttsSampleRate,
        bitrate: this.config.ttsBitrate,
        format,
        channel: 1
      }
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let response;
    try {
      response = await this.fetch(`${this.config.baseUrl}/t2a_v2`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`TTS: request timed out after ${this.config.timeoutMs}ms.`);
      }
      throw new Error(`TTS: request failed: ${error?.message || error}`);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const detail = await safeText(response);
      throw new Error(`TTS: HTTP ${response.status} — ${detail}`);
    }

    const payload = await response.json();

    // A 200 is not a success. The provider reports its own status code.
    const statusCode = payload?.base_resp?.status_code;
    if (statusCode !== undefined && statusCode !== 0) {
      throw new Error(
        `TTS: provider error ${statusCode} — ${payload?.base_resp?.status_msg || "unknown"}`
      );
    }

    const hex = payload?.data?.audio;
    if (!hex) {
      throw new Error("TTS: provider returned no audio.");
    }

    const audio = Buffer.from(hex, "hex");

    return {
      audio,
      durationMs: Number(payload?.extra_info?.audio_length) || 0,
      format,
      voiceId: this.config.ttsVoiceId,
      model: this.config.ttsModel
    };
  }
}

async function safeText(response) {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return "<no body>";
  }
}

module.exports = { MiniMaxTtsClient };
