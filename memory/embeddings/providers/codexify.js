// memory/embeddings/providers/codexify.js
//
// The embedder that already exists: Codexify's own.
//
// WHAT THIS IS
//
// Codexify runs MemoryOS with a local `BAAI/bge-large-en-v1.5` model, and it
// exposes that model over HTTP:
//
//   POST {base}/api/embeddings
//   { "texts": ["..."], "embedder": "local", "model": "..." }
//   -> { "provider": "local", "model": "...", "vectors": [[...], ...] }
//
//   GET {base}/api/health/embedder
//   -> { "status": "ok", "embedder": { ... } }
//
// So the "local" option in Guardian's picker is not a new implementation. It
// is Codexify, asked for a vector. Which means:
//
//   * the vectors are the SAME vectors Codexify stores, so a memory written
//     on the laptop and a memory written on the server are comparable
//   * the cost is zero and nothing leaves the house
//   * it works for both clients, because it is one endpoint on the server
//
// The base URL defaults to the Codexify backend on this machine. Point it at
// the server instead and Guardian uses the server's model, from anywhere.
//
// AUTH
//
// Codexify's API takes `X-Guardian-Key`. The bearer form is sent too, since
// a proxy in front of it may prefer that.

const { EmbeddingError, assertVector } = require("../base");

const DEFAULT_BASE_URL = "http://127.0.0.1:8888";
const DEFAULT_TIMEOUT_MS = 30000;

class CodexifyEmbedder {
  constructor({ env = process.env, baseUrl = null, apiKey = null, model = null, provider = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.name = "codexify";
    this.modelName = model || env.CODEXIFY_EMBED_MODEL || "BAAI/bge-large-en-v1.5";
    this.dimension = null; // learned from the first response
    this.local = true;
    this.free = true;

    this.baseUrl = String(baseUrl || env.CODEXIFY_EMBED_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.apiKey = apiKey || env.CODEXIFY_API_KEY || env.GUARDIAN_API_KEY || "";
    // Which backend Codexify should use. Empty means "whatever Codexify is
    // configured with", which is the point — one place decides.
    this.provider = provider || env.CODEXIFY_EMBEDDER || "";
    this.timeoutMs = timeoutMs;
  }

  async embedBatch(texts) {
    const list = Array.isArray(texts) ? texts : [];
    if (!list.length) {
      return [];
    }

    const body = { texts: list };
    if (this.provider) {
      body.embedder = this.provider;
    }
    if (this.modelName) {
      body.model = this.modelName;
    }

    const headers = { "Content-Type": "application/json" };
    if (this.apiKey) {
      headers["X-Guardian-Key"] = this.apiKey;
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response;
    try {
      response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (error) {
      throw new EmbeddingError(
        `Could not reach Codexify at ${this.baseUrl}: ${error?.message || error}`,
        {
          provider: this.name,
          code: error?.name === "AbortError" ? "timeout" : "unreachable",
          cause: error,
          remedy: `Start the Codexify backend, or point CODEXIFY_EMBED_BASE_URL at the server (currently ${this.baseUrl}).`
        }
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();

    if (!response.ok) {
      throw new EmbeddingError(`Codexify returned ${response.status}: ${text.slice(0, 200)}`, {
        provider: this.name,
        code: `http_${response.status}`,
        remedy:
          response.status === 401
            ? "The Codexify API key is missing or wrong."
            : response.status === 503
              ? "Codexify has no embedding backend configured."
              : null
      });
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new EmbeddingError("Codexify returned something that is not JSON.", {
        provider: this.name,
        code: "bad_response"
      });
    }

    // The endpoint reports provider status inside the body rather than as an
    // HTTP error. A provider that is misconfigured comes back 200 with a
    // complaint in the payload, and treating that as success would store
    // empty vectors and never find anything again.
    const providerStatus = payload?.base_resp?.status_code;
    if (providerStatus !== undefined && providerStatus !== 0) {
      throw new EmbeddingError(
        `Codexify's embedding backend refused: ${payload?.base_resp?.status_msg || providerStatus}`,
        { provider: this.name, code: "provider_error" }
      );
    }

    const vectors = payload?.vectors;
    if (!Array.isArray(vectors) || vectors.length !== list.length) {
      throw new EmbeddingError("Codexify returned a different number of vectors than texts sent.", {
        provider: this.name,
        code: "bad_response"
      });
    }

    for (const vector of vectors) {
      assertVector(vector, this.name);
      this.dimension = vector.length;
    }

    return vectors;
  }

  async embed(text) {
    const [vector] = await this.embedBatch([text]);
    return vector || [];
  }
}

module.exports = {
  CodexifyEmbedder,
  DEFAULT_BASE_URL
};
