const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  PROVIDER_IDS,
  createEmbedder,
  getProviderDescriptor,
  listProviders,
  probeEmbedder,
  providerEnv
} = require("../memory/embeddings/registry");
const { EmbeddingError, assertVector, cosineSimilarity, l2Normalize } = require("../memory/embeddings/base");
const { DeterministicEmbedder } = require("../memory/embeddings/providers/deterministic");
const { UiPreferenceStore } = require("../memory/uiPreferenceStore");
const { storeCredential, readAll, credentialFor } = require("../memory/embeddings/credentials");

// The embedder is a user-facing picker, not deep settings.
//
// The requirement was, in the owner's words: "a user can pick and choose an
// embedder though openai or their provider of choice or a local option
// without digging into deep settings".
//
// That has three consequences, and each one is a bug if it fails:
//
//   1. EVERY provider is listed, including the ones with no key yet. A list
//      that shows only what happens to be configured right now cannot be
//      used to pick something new.
//
//   2. A typed key must reach the provider it was typed for. The credentials
//      are stored per provider, so a probe of "openai" has to see the OpenAI
//      key even while the active choice is a different provider. Reading the
//      ACTIVE provider's key here is a real bug: it makes every freshly
//      typed key look like "no key" at exactly the moment it is wanted.
//
//   3. A failure is an answer, not a stack trace. "No API key" with a
//      remedy beats an HTTP status.

// ------------------------------------------------------- the catalogue rule

function testEveryProviderIsListed() {
  const catalogue = listProviders({});

  assert.ok(
    catalogue.length >= 5,
    "the picker must offer the local option, OpenAI, another provider, and MiniMax"
  );

  // The providers a user would want to pick, even with nothing configured.
  for (const id of ["codexify", "deterministic", "openai", "compatible", "minimax"]) {
    assert.ok(
      catalogue.some((provider) => provider.id === id),
      `"${id}" must always be offered — a provider you cannot see is one you cannot pick`
    );
  }

  // With no keys at all, the ones that need a key must SAY SO rather than
  // being hidden or shown as ready.
  const openai = catalogue.find((provider) => provider.id === "openai");
  assert.equal(openai.configured, false);
  assert.equal(openai.needsKey, true);

  // The offline floor needs nothing and must never claim it needs something.
  const offline = catalogue.find((provider) => provider.id === "deterministic");
  assert.equal(offline.needsKey, false);
  assert.equal(offline.configured, true);
}

function testDescriptorReadsTheEnvironment() {
  const withKey = getProviderDescriptor("openai", { OPENAI_API_KEY: "sk-test" });
  assert.equal(withKey.configured, true);
  assert.equal(withKey.needsKey, false);

  const withoutKey = getProviderDescriptor("openai", {});
  assert.equal(withoutKey.configured, false);
  assert.equal(withoutKey.needsKey, true);

  assert.equal(getProviderDescriptor("nonsense", {}), null);
}

// -------------------------------------------- the credential must reach its provider

function testProviderEnvTargetsTheRightProvider() {
  const credentialsFile = path.join(__dirname, "..", ".local", "test-credentials.json");

  try {
    storeCredential("openai", "sk-openai-value", credentialsFile);
    storeCredential("compatible", "sk-compatible-value", credentialsFile);

    // The key for a provider goes under that provider's variable name.
    const openaiEnv = providerEnv("openai", { env: {}, credentialsFile });
    assert.equal(openaiEnv.OPENAI_API_KEY, "sk-openai-value");
    assert.equal(openaiEnv.COMPATIBLE_EMBED_API_KEY, undefined);

    const compatibleEnv = providerEnv("compatible", { env: {}, credentialsFile });
    assert.equal(compatibleEnv.COMPATIBLE_EMBED_API_KEY, "sk-compatible-value");
    assert.equal(compatibleEnv.OPENAI_API_KEY, undefined);

    // And this is the regression: asking for OpenAI's environment while the
    // active choice is something else must still find OpenAI's key. The old
    // code read the ACTIVE provider's credential here, which made a typed
    // key look absent precisely when it was being typed.
    const stored = readAll(credentialsFile);
    assert.equal(stored.openai.apiKey, "sk-openai-value");
    assert.equal(credentialFor("openai", {}, credentialsFile), "sk-openai-value");

    // A provider with no key gets no key — and no empty string is injected,
    // because "has a key" and "has an empty key" are different states.
    const empty = providerEnv("minimax", { env: {}, credentialsFile });
    assert.equal(empty.MINIMAX_API_KEY, undefined);
  } finally {
    fs.rmSync(credentialsFile, { force: true });
  }
}

// ------------------------------------------------------ the floor never breaks

async function testDeterministicAlwaysWorks() {
  const embedder = new DeterministicEmbedder();
  const first = await embedder.embed("Guardian remembers building a thing.");
  const second = await embedder.embed("Guardian remembers building a thing.");

  assert.ok(Array.isArray(first));
  assert.ok(first.length > 0, "the floor must produce a vector");
  assert.equal(first.length, second.length, "the floor must have a fixed dimension");
  assert.deepEqual(first, second, "the same text must give the same vector, every time");

  // Different text, different vector. A floor that gave one answer to
  // everything would find everything and mean nothing.
  const other = await embedder.embed("something else entirely");
  assert.notDeepEqual(first, other);

  // And it is honest about what it is.
  assert.equal(embedder.name, "deterministic");
  assert.match(String(embedder.modelName || ""), /hashed/i);
}

function testVectorHelpers() {
  assert.throws(() => assertVector(null, "test"), EmbeddingError);
  assert.throws(() => assertVector([], "test"), EmbeddingError);
  assert.throws(() => assertVector([1, "two"], "test"), EmbeddingError);
  assert.throws(() => assertVector([1, Number.NaN], "test"), EmbeddingError);
  assert.deepEqual(assertVector([1, 2, 3], "test"), [1, 2, 3]);

  const unit = l2Normalize([3, 4]);
  assert.ok(Math.abs(Math.hypot(...unit) - 1) < 1e-9, "a normalised vector has unit length");

  assert.ok(Math.abs(cosineSimilarity([1, 0], [1, 0]) - 1) < 1e-9);
  assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-9);
  assert.equal(cosineSimilarity([1, 0], [1, 0, 0]), 0, "mismatched dimensions score zero");
}

// -------------------------------------------------------- failures are answers

async function testFailuresAreAnswers() {
  // No key: a sentence with a remedy, not a stack trace.
  const missingKey = await probeEmbedder("openai", { env: {} });
  assert.equal(missingKey.ok, false);
  assert.equal(missingKey.code, "missing_key");
  assert.ok(missingKey.error, "a failure must say what happened");
  assert.ok(missingKey.remedy, "a failure must say what to do about it");
  assert.doesNotMatch(
    missingKey.error,
    /at Object\.|at Module\./,
    "the user must not be shown a stack trace"
  );

  // An unknown provider names the ones that exist.
  const unknown = await probeEmbedder("not-a-provider", { env: {} });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, "unknown_provider");
  for (const id of PROVIDER_IDS) {
    assert.ok(unknown.remedy.includes(id), `the remedy should mention "${id}"`);
  }

  // An unreachable backend: the address has to appear in the answer, because
  // the address is the thing the user is allowed to change.
  const unreachable = await probeEmbedder("codexify", {
    env: {},
    baseUrl: "http://127.0.0.1:1"
  });
  assert.equal(unreachable.ok, false);
  assert.ok(["unreachable", "timeout"].includes(unreachable.code), `unexpected code ${unreachable.code}`);
  assert.ok(unreachable.error.includes("127.0.0.1:1"), "the address must be in the answer");
  assert.ok(unreachable.remedy, "an unreachable backend must come with a way forward");

  // And the floor still works after all that.
  const floor = await probeEmbedder("deterministic", { env: {} });
  assert.equal(floor.ok, true);
  assert.equal(floor.provider, "deterministic");
  assert.ok(floor.dimension > 0);
  assert.ok(floor.latencyMs >= 0);
}

function testCreateEmbedderRejectsUnknown() {
  assert.throws(
    () => createEmbedder("nope", { env: {} }),
    (error) => error instanceof EmbeddingError && error.code === "unknown_provider"
  );
}

// ------------------------------------------------------- the choice is kept

async function testPreferenceKeepsTheAddress() {
  // The address travels with the choice. "The address is not the forever
  // address" means the address the user typed has to survive a restart
  // along with the provider, or the picker would ask for it every time.
  const queries = [];
  const rows = new Map();

  const client = {
    query: async (statement, params) => {
      queries.push({ statement, params });

      if (statement.includes("UPSERT")) {
        const row = { key: params.key, value: params.payload.value, updated_at: params.payload.updated_at };
        rows.set(params.key, row);
        return [[row]];
      }

      if (statement.includes("SELECT")) {
        return [[rows.get(params.key)].filter(Boolean)];
      }

      return [[]];
    }
  };

  const store = new UiPreferenceStore(client);

  await store.set("memory.embedder", {
    provider: "codexify",
    model: "BAAI/bge-large-en-v1.5",
    baseUrl: "http://the-server:8888"
  });

  const upsert = queries.find((entry) => entry.statement.includes("UPSERT"));
  assert.ok(upsert, "the preference must be written");
  assert.ok(
    upsert.statement.includes('type::record("ui_preferences", $key)'),
    "the preference must target a record, not a raw string"
  );
  assert.equal(upsert.params.key, "memory.embedder");
  assert.equal(upsert.params.payload.value.baseUrl, "http://the-server:8888");
  assert.ok(upsert.params.payload.updated_at, "the preference must say when it changed");

  const stored = await store.get("memory.embedder");
  assert.equal(stored.value.provider, "codexify");
  assert.equal(stored.value.baseUrl, "http://the-server:8888");
}

// ------------------------------------------------------------------ run

async function main() {
  console.log("embedderPicker");

  testEveryProviderIsListed();
  testDescriptorReadsTheEnvironment();
  testProviderEnvTargetsTheRightProvider();
  await testDeterministicAlwaysWorks();
  testVectorHelpers();
  await testFailuresAreAnswers();
  testCreateEmbedderRejectsUnknown();
  await testPreferenceKeepsTheAddress();

  console.log("  all embedder picker tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
