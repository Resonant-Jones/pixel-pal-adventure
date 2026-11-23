// memory/embeddings/providers/minimax.js
//
// MiniMax's embedding endpoint.
//
// THE REQUEST SHAPE, WHICH IS NOT THE OBVIOUS ONE
//
// MiniMax does not use `input`. It uses `texts`, and it also requires a
// `type`:
//
//   { "model": "embo-01", "type": "symmetric", "texts": ["..."] }
//
// Sending `input` comes back as
// `2013 invalid params, binding: expr_path=texts, cause=missing required
// parameter`. Sending `texts` without `type` comes back with the same code
// pointing at `type`. Getting this wrong looks exactly like a broken
// service, which is why it is written down here.
//
// THE RESPONSE
//
// `{ "vectors": [[...]], "base_resp": { "status_code": 0, "status_msg": "success" } }`
//
// and the status code is the real one: a provider error arrives as HTTP 200
// with a non-zero `base_resp.status_code`. A 429 here means the account has
// no embedding quota — MiniMax's published rate-limit table has no
// embeddings row at all — so the error has to be read out of the body, not
// off the status line.

const { EmbeddingError, assertVector } = require("../base");

const DEFAULT_BASE_URL = "https://api.minimax.io/v1";
const DEFAULT_TIMEOUT_MS = 30000;

// "symmetric" because a memory store puts text in and queries text out of the
// SAME space. "db" and "query" are two different spaces, and mixing them
// gives silently bad retrieval.
const DEFAULT_TYPE = "symmetric";

class MiniMaxEmbedder {
  constructor({
    env = process.env,
    baseUrl = null,
    apiKey = null,
    model = null,
    type = null,
    timeoutMs = DEFAULT_TIMEOUT_MS
  } = {}) {
    this.name = "minimax";
    this.modelName = model || env.MINIMAX_EMBED_MODEL || "embo-01";
    this.dimension = null;
    this.local = false;
    this.free = false;

    this.baseUrl = String(baseUrl || env.MINIMAX_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.apiKey = apiKey || env.MINIMAX_API_KEY || "";
    this.type = type || env.MINIMAX_EMBED_TYPE || DEFAULT_TYPE;
    this.timeoutMs = timeoutMs;
  }

  async embedBatch(texts) {
    const list = Array.isArray(texts) ? texts : [];
    if (!list.length) {
      return [];
    }

    if (!this.apiKey) {
      throw new EmbeddingError("No API key for the MiniMax embedder.", {
        provider: this.name,
        code: "missing_key",
        remedy: "Paste the key in the Memory panel, or set MINIMAX_API_KEY in .env."
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
        body: JSON.stringify({
          model: this.modelName,
          type: this.type,
          texts: list
        }),
        signal: controller.signal
      });
    } catch (error) {
      throw new EmbeddingError(`Could not reach MiniMax: ${error?.message || error}`, {
        provider: this.name,
        code: error?.name === "AbortError" ? "timeout" : "unreachable",
        cause: error
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();

    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      // fall through to the status check below
    }

    if (!response.ok) {
      throw new EmbeddingError(`MiniMax returned ${response.status}: ${text.slice(0, 200)}`, {
        provider: this.name,
        code: `http_${response.status}`
      });
    }

    const statusCode = payload?.base_resp?.status_code;
    if (statusCode !== undefined && statusCode !== 0) {
      const message = payload?.base_resp?.status_msg || `status ${statusCode}`;

      throw new EmbeddingError(`MiniMax's embedding backend refused: ${message}`, {
        provider: this.name,
        code: statusCode === 1002 ? "rate_limited" : "provider_error",
        remedy:
          statusCode === 1002
            ? "MiniMax is rate-limiting this account. Embeddings may not be provisioned on this key at all."
            : null
      });
    }

    const vectors = payload?.vectors;
    if (!Array.isArray(vectors) || vectors.length !== list.length) {
      throw new EmbeddingError("MiniMax returned a different number of vectors than texts sent.", {
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
  MiniMaxEmbedder,
  DEFAULT_TYPE
};
