// memory/embeddings/registry.js
//
// The catalogue a user picks from, and the thing that turns a choice into a
// working embedder.
//
// THE RULE THIS MODULE ENFORCES
//
// A provider is offered if it can be *made* to work by a user, not only if
// it happens to work on this machine right now. "OpenAI" is always offered,
// even with no key, because the user can paste one into the panel. What
// changes is the status beside it: ready, needs a key, or broken.
//
// That distinction is the whole point. A list that only shows what happens
// to be configured right now is deep settings with extra steps: the user
// cannot see the option they want, only the one that is already on.
//
// The probe is equally the point. Nobody should have to read a provider's
// error message to find out it does not work. "OpenAI — no API key", "MiniMax
// — rate limited (1002)", "Codexify — backend unreachable" are answers. A
// stack trace is not.

const { EmbeddingError } = require("./base");
const { DeterministicEmbedder } = require("./providers/deterministic");
const { CodexifyEmbedder } = require("./providers/codexify");
const { OpenAiCompatibleEmbedder } = require("./providers/openaiCompatible");
const { MiniMaxEmbedder } = require("./providers/minimax");
const { credentialFor } = require("./credentials");

// The catalogue. Ordered the way a person would choose: free and local
// first, then the providers that cost money, then the fallback that cannot
// fail.
const PROVIDERS = [
  {
    id: "codexify",
    label: "Codexify",
    blurb: "The local model Codexify already runs. Free, on this machine, and the same vectors Codexify stores.",
    local: true,
    free: true,
    requiresKey: false,
    defaultModel: "BAAI/bge-large-en-v1.5",
    fields: ["baseUrl"],
    keyEnvNames: ["CODEXIFY_API_KEY", "GUARDIAN_API_KEY"],
    notes: "Runs bge-large-en-v1.5 through the Codexify backend. Point it at your server and Guardian uses the server's model from anywhere."
  },
  {
    id: "deterministic",
    label: "Built-in (offline)",
    blurb: "Always works. No key, no network, no cost. Finds matching wording, not matching meaning.",
    local: true,
    free: true,
    requiresKey: false,
    defaultModel: "hashed-ngram-v1",
    fields: [],
    keyEnvNames: [],
    notes: "The floor under the memory. If a chosen provider breaks, Guardian falls back to this and says so."
  },
  {
    id: "openai",
    label: "OpenAI",
    blurb: "text-embedding-3-small by default. Costs a fraction of a cent per thousand memories.",
    local: false,
    free: false,
    requiresKey: true,
    defaultModel: "text-embedding-3-small",
    fields: ["apiKey", "model"],
    keyEnvNames: ["OPENAI_API_KEY"],
    notes: "Best quality of the hosted options for long text."
  },
  {
    id: "compatible",
    label: "Another provider",
    blurb: "Any service that speaks the OpenAI embeddings API — Together, Groq, Voyage, Jina, LM Studio, vLLM.",
    local: false,
    free: false,
    requiresKey: true,
    defaultModel: "",
    fields: ["apiKey", "baseUrl", "model"],
    keyEnvNames: ["COMPATIBLE_EMBED_API_KEY"],
    notes: "Point it at a base URL and a model name. This is the 'their provider of choice' option."
  },
  {
    id: "minimax",
    label: "MiniMax",
    blurb: "The embo-01 model, on the key already in your .env.",
    local: false,
    free: false,
    requiresKey: true,
    defaultModel: "embo-01",
    fields: ["apiKey", "model"],
    keyEnvNames: ["MINIMAX_API_KEY"],
    notes: "Your key may not have an embedding quota at all — MiniMax does not publish one. The probe will tell you."
  }
];

const PROVIDER_IDS = PROVIDERS.map((provider) => provider.id);

// Which environment variable carries each provider's key. This is the map
// that makes a typed key usable by a provider that expects to read its
// key from the environment.
const PROVIDER_KEY_ENV = {
  openai: "OPENAI_API_KEY",
  compatible: "COMPATIBLE_EMBED_API_KEY",
  minimax: "MINIMAX_API_KEY",
  codexify: "CODEXIFY_API_KEY"
};

/**
 * The environment a provider should be built with.
 *
 * It takes the provider it is FOR, and it puts that provider's key under
 * that provider's variable name. This matters more than it looks: the
 * credentials are stored per provider, so a probe of "openai" must see the
 * OpenAI key even while the active choice is something else entirely.
 * Reading the active choice's key here would make every freshly typed key
 * look like "no key" at exactly the moment it was most wanted.
 */
function providerEnv(providerId, { env = process.env, credentialsFile } = {}) {
  const provider = String(providerId || "").trim().toLowerCase();
  const next = { ...env };

  if (!provider) {
    return next;
  }

  const key = credentialFor(provider, env, credentialsFile);
  const name = PROVIDER_KEY_ENV[provider];

  if (key && name) {
    next[name] = key;
  }

  return next;
}

function getProviderDescriptor(providerId, env = process.env) {
  const id = String(providerId || "").trim().toLowerCase();
  const descriptor = PROVIDERS.find((provider) => provider.id === id);

  if (!descriptor) {
    return null;
  }

  const hasKey = descriptor.keyEnvNames.some((name) => Boolean(String(env[name] || "").trim()));

  return {
    ...descriptor,
    configured: descriptor.requiresKey ? hasKey : true,
    needsKey: descriptor.requiresKey && !hasKey
  };
}

// The catalogue for the picker.
function listProviders(env = process.env) {
  return PROVIDERS.map((provider) => getProviderDescriptor(provider.id, env));
}

/**
 * Build a working embedder from a choice.
 *
 * @param {string} providerId
 * @param {object} options  { apiKey, baseUrl, model, env }
 */
function createEmbedder(providerId, options = {}) {
  const env = options.env || process.env;
  const id = String(providerId || "").trim().toLowerCase();

  switch (id) {
    case "deterministic":
      return new DeterministicEmbedder();

    case "codexify":
      return new CodexifyEmbedder({
        env,
        baseUrl: options.baseUrl || null,
        apiKey: options.apiKey || null,
        model: options.model || null,
        provider: options.backend || null
      });

    case "openai":
      return new OpenAiCompatibleEmbedder({
        env,
        name: "openai",
        baseUrl: options.baseUrl || null,
        apiKey: options.apiKey || null,
        model: options.model || null,
        defaultModel: "text-embedding-3-small",
        keyEnvName: "OPENAI_API_KEY"
      });

    case "compatible":
      return new OpenAiCompatibleEmbedder({
        env,
        name: "compatible",
        baseUrl: options.baseUrl || null,
        apiKey: options.apiKey || null,
        model: options.model || null,
        defaultModel: "",
        keyEnvName: "COMPATIBLE_EMBED_API_KEY"
      });

    case "minimax":
      return new MiniMaxEmbedder({
        env,
        baseUrl: options.baseUrl || null,
        apiKey: options.apiKey || null,
        model: options.model || null
      });

    default:
      throw new EmbeddingError(`Unknown embedder "${providerId}".`, {
        code: "unknown_provider",
        remedy: `Choose one of: ${PROVIDER_IDS.join(", ")}.`
      });
  }
}

/**
 * Test a provider without committing to it.
 *
 * This is what makes the picker honest. It embeds one short piece of text
 * and reports what came back: the provider, the model, the dimension, how
 * long it took, or the exact reason it did not work.
 */
async function probeEmbedder(providerId, options = {}) {
  const startedAt = Date.now();

  let embedder;
  try {
    embedder = createEmbedder(providerId, options);
  } catch (error) {
    return {
      ok: false,
      provider: providerId,
      error: error?.message || String(error),
      code: error?.code || "unknown_provider",
      remedy: error?.remedy || null
    };
  }

  try {
    const vector = await embedder.embed(options.probeText || "Guardian remembers building a thing.");

    return {
      ok: true,
      provider: embedder.name,
      model: embedder.modelName || null,
      dimension: vector?.length || null,
      latencyMs: Date.now() - startedAt,
      sample: Array.isArray(vector) ? vector.slice(0, 4) : null
    };
  } catch (error) {
    return {
      ok: false,
      provider: embedder.name,
      model: embedder.modelName || null,
      error: error?.message || String(error),
      code: error?.code || "embedding_failed",
      remedy: error?.remedy || null
    };
  }
}

module.exports = {
  PROVIDERS,
  PROVIDER_IDS,
  PROVIDER_KEY_ENV,
  createEmbedder,
  getProviderDescriptor,
  listProviders,
  probeEmbedder,
  providerEnv
};
