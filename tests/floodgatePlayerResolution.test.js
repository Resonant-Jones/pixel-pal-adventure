// Geyser + Floodgate let a Bedrock client join this Paper server. Floodgate 2.x
// defaults `username-prefix` to ".", so a player configured as "Panda_Nuggetz"
// actually arrives as ".Panda_Nuggetz".
//
// Exact-key player lookup returns null in that case, and every behaviour built
// on it degrades silently: no follow, no facing, no tag-the-here, no /tp. These
// tests pin the tolerant resolution so that cannot regress.

const {
  playerNameCandidates,
  resolvePlayerEntity,
} = require("../minecraft/bot");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${name}`);
    console.log(`      ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "assertion failed");
  }
}

function fakeEntity(label) {
  return { label, position: { offset: () => ({ label }) } };
}

function fakeBot(playerNames) {
  const players = {};

  for (const name of playerNames) {
    players[name] = { entity: fakeEntity(name) };
  }

  return { players };
}

console.log("floodgate player resolution tests");

test("a bare configured name still resolves when the server has it bare", () => {
  const bot = fakeBot(["Panda_Nuggetz"]);
  const resolved = resolvePlayerEntity(bot, "Panda_Nuggetz");

  assert(resolved.entity, "expected to find the bare name");
  assert(resolved.name === "Panda_Nuggetz", `expected "Panda_Nuggetz", got "${resolved.name}"`);
});

test("a bare configured name resolves against Floodgate's default dot prefix", () => {
  const bot = fakeBot([".Panda_Nuggetz"]);
  const resolved = resolvePlayerEntity(bot, "Panda_Nuggetz");

  assert(resolved.entity, "expected to find the dotted name");
  assert(resolved.name === ".Panda_Nuggetz", `expected ".Panda_Nuggetz", got "${resolved.name}"`);
});

test("a configured name that already carries a prefix resolves to the bare name", () => {
  const bot = fakeBot(["Panda_Nuggetz"]);
  const resolved = resolvePlayerEntity(bot, ".Panda_Nuggetz");

  assert(resolved.entity, "expected to strip the prefix");
  assert(resolved.name === "Panda_Nuggetz", `expected "Panda_Nuggetz", got "${resolved.name}"`);
});

test("legacy asterisk prefix and other Floodgate prefixes both resolve", () => {
  for (const prefix of [".", "*", "+", "-"]) {
    const bot = fakeBot([`${prefix}Panda_Nuggetz`]);
    const resolved = resolvePlayerEntity(bot, "Panda_Nuggetz");

    assert(resolved.entity, `expected prefix "${prefix}" to resolve`);
    assert(resolved.name === `${prefix}Panda_Nuggetz`, `expected "${prefix}Panda_Nuggetz"`);
  }
});

test("the exact configured name wins over a prefixed decoy", () => {
  // Both players are online. Preferring the real match keeps behaviour stable
  // instead of depending on object key order.
  const bot = fakeBot([".Panda_Nuggetz", "Panda_Nuggetz"]);
  const resolved = resolvePlayerEntity(bot, "Panda_Nuggetz");

  assert(resolved.name === "Panda_Nuggetz", `expected exact match, got "${resolved.name}"`);
});

test("an absent player resolves to null rather than throwing", () => {
  const resolved = resolvePlayerEntity(fakeBot(["Someone_Else"]), "Panda_Nuggetz");

  assert(resolved.entity === null, "expected null entity");
  assert(resolved.name === null, "expected null name");
});

test("a disconnected bot resolves to null rather than throwing", () => {
  const resolved = resolvePlayerEntity(undefined, "Panda_Nuggetz");

  assert(resolved.entity === null, "expected null entity for a missing bot");
});

test("a player entry with no entity is skipped, not returned", () => {
  const bot = { players: { ".Panda_Nuggetz": { entity: null }, "*Panda_Nuggetz": { entity: fakeEntity("hit") } } };
  const resolved = resolvePlayerEntity(bot, "Panda_Nuggetz");

  assert(resolved.entity, "expected to skip the empty entry and find the next match");
  assert(resolved.name === "*Panda_Nuggetz", `expected "*Panda_Nuggetz", got "${resolved.name}"`);
});

test("candidate generation is symmetric and rejects junk input", () => {
  assert(playerNameCandidates("Panda_Nuggetz")[0] === "Panda_Nuggetz", "configured name comes first");
  assert(playerNameCandidates(".Panda_Nuggetz").includes("Panda_Nuggetz"), "strips a known prefix");
  assert(playerNameCandidates("").length === 0, "empty string yields nothing");
  assert(playerNameCandidates("   ").length === 0, "whitespace yields nothing");
  assert(playerNameCandidates(null).length === 0, "null yields nothing");
  assert(playerNameCandidates(undefined).length === 0, "undefined yields nothing");
  assert(playerNameCandidates(42).length === 0, "non-string yields nothing");
});

test("a single-character name is not treated as a bare prefix", () => {
  // "." alone is a prefix with no name behind it; stripping it would leave "".
  const candidates = playerNameCandidates(".");

  assert(candidates.includes("."), "expected the literal dot to survive");
  assert(!candidates.includes(""), "must never produce an empty name to look up");
});

console.log(failed === 0 ? "floodgate player resolution tests passed" : `${failed} test(s) failed`);

if (failed > 0) {
  process.exitCode = 1;
}