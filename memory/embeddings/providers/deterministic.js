// memory/embeddings/providers/deterministic.js
//
// The embedder that always works.
//
// WHY THIS EXISTS
//
// A memory system whose retrieval depends on somebody else's billing state
// is a memory system that silently stops working. This provider needs no key,
// no network, no model and no GPU, so it can never be the reason a memory
// goes missing.
//
// WHAT IT IS, HONESTLY
//
// Hashed character n-grams and word tokens, L2 normalised. That gives
// LEXICAL similarity: two texts score highly when they share wording. It does
// not know that "the cat sat on the mat" and "a feline rested on a rug" mean
// the same thing. It is not semantic, and calling it that would be a lie.
//
// It is however a real baseline, and it is the right thing to fall back to
// when a chosen provider is down: the worst case is that recall is duller,
// not that it is gone.

const { assertVector, l2Normalize, fnv1a } = require("../base");

const DIMENSION = 256;

function embed(text) {
  const value = String(text || "").toLowerCase().trim();
  const vector = new Array(DIMENSION).fill(0);

  if (!value) {
    return vector;
  }

  // Character n-grams catch typos and morphology that word tokens miss.
  const padded = ` ${value} `;
  for (let size = 3; size <= 4; size += 1) {
    for (let i = 0; i + size <= padded.length; i += 1) {
      vector[fnv1a(padded.slice(i, i + size)) % DIMENSION] += 1;
    }
  }

  // Whole words, weighted up: an exact word match is a stronger signal than
  // an incidental trigram.
  for (const word of padded.split(/\s+/)) {
    if (word) {
      vector[fnv1a(`w:${word}`) % DIMENSION] += 3;
    }
  }

  return l2Normalize(vector);
}

class DeterministicEmbedder {
  constructor() {
    this.name = "deterministic";
    this.modelName = "hashed-ngram-v1";
    this.dimension = DIMENSION;
    this.local = true;
    this.free = true;
  }

  async embed(text) {
    return assertVector(embed(text), this.name);
  }

  async embedBatch(texts) {
    const list = Array.isArray(texts) ? texts : [];
    return list.map((text) => embed(text));
  }
}

module.exports = {
  DeterministicEmbedder,
  DIMENSION
};
