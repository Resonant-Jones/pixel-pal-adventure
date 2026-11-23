// memory/embeddings/providers/openaiCompatible.js
//
// Any provider that speaks the OpenAI embeddings API.
//
// This one file covers OpenAI itself and every "their provider of choice"
// that copies its shape — Together, Groq, Voyage, Jina, Together's
// compatibility endpoint, LM Studio, llama.cpp's server, vLLM, and anything
// else that answers `POST /v1/embeddings` with `{data:[{embedding:[...]}]}`.
//
// One implementation, many providers, because the shape really is that
// common, and because a user who says "my provider" should not have to
// wait for a bespoke adapter to be written for it.

const { EmbeddingError, assertVector } = require("../base");

const DEFAULT_TIMEOUT_MS = 30000;

class OpenAiCompatibleEmbedder {
  constructor({
    env = process.env,
    name = "openai",
    baseUrl = null,
    apiKey = null,
    model = null,
    defaultModel = "text-embedding-3-small",
    keyEnvName = "OPENAI_API_KEY",
    timeoutMs = DEFAULT_TIMEOUT_MS
  } = {}) {
    this.name = name;
    this.modelName = model || defaultModel;
    this.dimension = null;
    this.local = false;
    this.free = false;

    this.baseUrl = String(baseUrl || env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    this.apiKey = apiKey || env[keyEnvName] || "";
    this.timeoutMs = timeoutMs;
  }

  async embedBatch(texts) {
    const list = Array.isArray(texts) ? texts : [];
    if (!list.length) {
      return [];
    }

    if (!this.apiKey) {
      throw new EmbeddingError(`No API key for the "${this.name}" embedder.`, {
        provider: this.name,
        code: "missing_key",
        remedy: "Paste the key in the Memory panel, or set it in .env."
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response;
    try {
      response = await fetch(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({ model: this.modelName, input: list }),
        signal: controller.signal
      });
    } catch (error) {
      throw new EmbeddingError(
        `Could not reach ${this.baseUrl}: ${error?.message || error}`,
        {
          provider: this.name,
          code: error?.name === "AbortError" ? "timeout" : "unreachable",
          cause: error,
          remedy: "Check the base URL and that the provider is reachable."
        }
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();

    if (!response.ok) {
      throw new EmbeddingError(`${this.name} returned ${response.status}: ${text.slice(0, 200)}`, {
        provider: this.name,
        code: `http_${response.status}`,
        remedy:
          response.status === 401
            ? "The API key was rejected."
            : response.status === 429
              ? "The provider is rate-limiting. This one will work again shortly."
              : null
      });
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new EmbeddingError(`${this.name} returned something that is not JSON.`, {
        provider: this.name,
        code: "bad_response"
      });
    }

    const data = payload?.data;
    if (!Array.isArray(data) || data.length !== list.length) {
      throw new EmbeddingError(`${this.name} returned a different number of vectors than texts sent.`, {
        provider: this.name,
        code: "bad_response"
      });
    }

    return data.map((entry) => {
      const vector = Array.isArray(entry) ? entry : entry?.embedding;
      assertVector(vector, this.name);
      this.dimension = vector.length;
      return vector;
    });
  }

  async embed(text) {
    const [vector] = await this.embedBatch([text]);
    return vector || [];
  }
}

module.exports = {
  OpenAiCompatibleEmbedder
};
