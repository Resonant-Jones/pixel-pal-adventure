const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  resolveAccount,
  writeOperators,
  offlinePlayerUuid
} = require("../scripts/serverOperators");

// --- Regression: operators that silently do nothing ---------------------------
//
// Two separate mistakes made a child unable to run a single command, and both
// looked completely healthy in the file:
//
//   1. Writing a computed offline-mode UUID for a Bedrock account. Floodgate
//      issues 00000000-0000-0000-0009-<xuid> instead, so the entry matched
//      nothing. Paper keys operators by UUID, not by name.
//
//   2. Prefixing EVERY configured name with Floodgate's dot. "Panda_Nuggetz" is
//      a Java account; turning it into ".Panda_Nuggetz" matches no account, and
//      removes permissions the player legitimately had.
//
// These pin the resolution rules so neither can come back.

let passed = 0;
let failed = 0;
const queue = [];

function test(name, fn) {
  queue.push([name, fn]);
}

// The real usercache from this world, which contains both account types.
const REAL_CACHE = new Map([
  ["Panda_Nuggetz", "48ecc859-adee-3507-ab98-c535ce76d123"],
  ["Guardian", "1e885736-6516-33bc-8cdc-09987f03d5f7"],
  [".PandaNuggetz120", "00000000-0000-0000-0009-01f3ac1e1299"]
]);

function tempServer(cache = REAL_CACHE) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ops-test-"));
  const entries = Array.from(cache, ([name, uuid]) => ({ name, uuid }));
  fs.writeFileSync(path.join(dir, "usercache.json"), JSON.stringify(entries));
  return dir;
}

const quiet = { log: () => {}, warn: () => {} };

test("a Java name resolves exactly, with NO Floodgate prefix added", () => {
  const resolved = resolveAccount(REAL_CACHE, "Panda_Nuggetz");

  assert.strictEqual(resolved.name, "Panda_Nuggetz", "must not become .Panda_Nuggetz");
  assert.strictEqual(resolved.uuid, "48ecc859-adee-3507-ab98-c535ce76d123");
});

test("a bare gamertag resolves to its Floodgate-prefixed account", () => {
  const resolved = resolveAccount(REAL_CACHE, "PandaNuggetz120");

  assert.strictEqual(resolved.name, ".PandaNuggetz120", "must find the Floodgate account");
  assert.strictEqual(resolved.uuid, "00000000-0000-0000-0009-01f3ac1e1299");
});

test("an already-prefixed name resolves to itself", () => {
  const resolved = resolveAccount(REAL_CACHE, ".PandaNuggetz120");

  assert.strictEqual(resolved.name, ".PandaNuggetz120");
});

test("an account that has never joined resolves to nothing, not to a guess", () => {
  const resolved = resolveAccount(REAL_CACHE, "SageTheMage5388");

  assert.strictEqual(resolved.uuid, null, "must not invent a UUID");
  assert.strictEqual(resolved.name, "");
  assert.strictEqual(resolved.pending, "SageTheMage5388", "and must report what is missing");
});

test("the exact match wins over a Floodgate alias", () => {
  // Both exist. Prefixing blindly would pick the wrong one.
  const cache = new Map([
    ["Player", "exact-uuid"],
    [".Player", "floodgate-uuid"]
  ]);

  assert.strictEqual(resolveAccount(cache, "Player").name, "Player");
  assert.strictEqual(resolveAccount(cache, "Player").uuid, "exact-uuid");
});

test("writeOperators records real UUIDs for every account type", () => {
  const dir = tempServer();

  const { operators, unknown } = writeOperators({
    serverDir: dir,
    env: {
      MC_BOT_USERNAME: "Guardian",
      PRIMARY_PLAYER: "Panda_Nuggetz",
      COMPANION_PLAYERS: "Panda_Nuggetz,PandaNuggetz120"
    },
    logger: quiet
  });

  const byName = Object.fromEntries(operators.map((o) => [o.name, o.uuid]));

  assert.deepStrictEqual(unknown, [], "nothing should be unresolved here");
  assert.strictEqual(byName["Panda_Nuggetz"], "48ecc859-adee-3507-ab98-c535ce76d123");
  assert.strictEqual(byName[".PandaNuggetz120"], "00000000-0000-0000-0009-01f3ac1e1299");
  assert.strictEqual(byName.Guardian, "1e885736-6516-33bc-8cdc-09987f03d5f7");

  // The bot must not be duplicated when it is also listed as a companion.
  assert.strictEqual(operators.filter((o) => o.name === "Guardian").length, 1);

  const written = JSON.parse(fs.readFileSync(path.join(dir, "ops.json"), "utf8"));
  assert.strictEqual(written.length, 3, "all three accounts must reach disk");
  assert.ok(written.every((o) => o.level === 4), "all at level 4");
});

test("an unresolved account is reported loudly and does not block the others", () => {
  const dir = tempServer();
  const warnings = [];

  const { operators, unknown } = writeOperators({
    serverDir: dir,
    env: {
      MC_BOT_USERNAME: "Guardian",
      PRIMARY_PLAYER: "Panda_Nuggetz",
      COMPANION_PLAYERS: "Panda_Nuggetz,SageTheMage5388"
    },
    logger: { log: () => {}, warn: (m) => warnings.push(m) }
  });

  assert.deepStrictEqual(unknown, ["SageTheMage5388"]);
  assert.ok(warnings.some((w) => w.includes("SageTheMage5388")), "must warn by name");
  assert.ok(
    operators.some((o) => o.name === "Panda_Nuggetz"),
    "the resolvable account must still be written"
  );
});

test("a missing usercache on a fresh install still yields the computable bot", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ops-empty-"));

  const { operators } = writeOperators({
    serverDir: dir,
    env: { MC_BOT_USERNAME: "Guardian", PRIMARY_PLAYER: "Panda_Nuggetz" },
    logger: quiet
  });

  const bot = operators.find((o) => o.name === "Guardian");

  assert.ok(bot, "the Java bot is computable and must always be present");
  assert.strictEqual(bot.uuid, offlinePlayerUuid("Guardian"));
  assert.strictEqual(bot.uuid, "1e885736-6516-33bc-8cdc-09987f03d5f7", "validated against the live server");
});

async function runAll() {
  for (const [name, fn] of queue) {
    try {
      await fn();
      passed += 1;
      console.log(`  ✓ ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`  ✗ ${name}`);
      console.log(`      ${error.message}`);
      process.exitCode = 1;
    }
  }

  console.log(`serverOperators tests ${failed === 0 ? "passed" : "FAILED"} (${passed} passed, ${failed} failed)`);
}

runAll();