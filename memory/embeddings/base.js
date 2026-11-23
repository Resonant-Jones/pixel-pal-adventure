// memory/embeddings/base.js
//
// The interface Guardian's memory speaks, and the rules every provider obeys.
//
// WHY THIS MIRRORS CODEXIFY
//
// Codexify's MemoryOS defines this exact shape in
// `guardian/memoryos/embedders/base.py`: a `name`, `embed(text)` and
// `embed_batch(texts)`. Guardian uses the same contract on purpose, so the
// same provider produces the same vector in either place. That is what makes
// memory portable between this laptop and the server, instead of two systems
// that quietly disagree about what a thing means.
//
// WHAT AN EMBEDDER MUST ANSWER
//
// A provider that cannot say who it is, which model it loaded and how many
// dimensions it produces cannot be shown in a picker. So those three
// questions are part of the contract, not extras.
//
// A picker is the whole point of this file. "Embeddings are configured in
// .env" is deep settings. "Here are the four things you can use, here is
// which of them work right now, here is how many dimensions each one
// produces" is a setting.

class EmbeddingError extends Error {
  constructor(message, { provider = null, code = "embedding_failed", cause = null, remedy = null } = {}) {
    super(message);
    this.name = "EmbeddingError";
    this.provider = provider;
    this.code = code;
    this.remedy = remedy;

    if (cause) {
      this.cause = cause;
    }
  }
}

// A vector must be a flat array of finite numbers. A provider that returns
// nulls, strings or nested arrays has failed in a way that will surface three
// layers later as a silent "no results" — so it fails here, loudly.
function assertVector(vector, provider) {
  if (!Array.isArray(vector)) {
    throw new EmbeddingError(
      `The embedder returned ${typeof vector} instead of a vector.`,
      { provider, code: "bad_vector" }
    );
  }

  if (!vector.length) {
    throw new EmbeddingError("The embedder returned an empty vector.", { provider, code: "empty_vector" });
  }

  for (const value of vector) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new EmbeddingError("The embedder returned a vector with a non-numeric value.", {
        provider,
        code: "bad_vector"
      });
    }
  }

  return vector;
}

// Unit length. Cosine similarity is a dot product on normalised vectors, and
// a provider that forgets to normalise makes every distance wrong in a way
// that is very hard to see.
function l2Normalize(vector) {
  let sum = 0;
  for (const value of vector) {
    sum += value * value;
  }

  if (sum === 0) {
    return vector.slice();
  }

  const norm = Math.sqrt(sum);
  return vector.map((value) => value / norm);
}

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let i = 0; i < left.length; i += 1) {
    dot += left[i] * right[i];
    leftNorm += left[i] * left[i];
    rightNorm += right[i] * right[i];
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

// FNV-1a. Small, fast, and stable across runs and machines — which is the
// only property the deterministic fallback really needs.
function fnv1a(text) {
  let hash = 0x811c9dc5;

  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash >>> 0;
}

module.exports = {
  EmbeddingError,
  assertVector,
  l2Normalize,
  cosineSimilarity,
  fnv1a
};
