const assert = require("assert");

const {
  matchesByNumericSuffix,
  resolveOnlinePlayerName,
  matchesPlayerName,
  stripFloodgatePrefix
} = require("../minecraft/playerIdentity");

// --- The configured player is a stem, the real one has digits -----------------
//
// Bedrock gamertags routinely carry a numeric suffix ("SageTheMage1847") and the
// person setting this up usually remembers only the stem. Exact matching then
// fails on the one player the companion exists for: no follow, no reply, no tag
// recall — and it looks like the software is broken rather than misconfigured.
//
// The fallback is allowed ONLY when the extra characters are digits. Without
// that restriction "SageTheMage" would also bind to "SageTheMageTwo", which
// would be genuinely unsafe on a shared server.

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${error.message}`);
    process.exitCode = 1;
  }
}

test("a bare stem matches the digits the operator forgot", () => {
  assert.strictEqual(matchesByNumericSuffix("SageTheMage", "SageTheMage1847"), true);
  assert.strictEqual(matchesByNumericSuffix("SageTheMage", "SageTheMage1"), true);
  assert.strictEqual(matchesByNumericSuffix("SageTheMage", "SageTheMage99999999"), true);
});

test("a stem matches through the Floodgate prefix in either position", () => {
  assert.strictEqual(matchesByNumericSuffix("SageTheMage", ".SageTheMage1847"), true);
  assert.strictEqual(matchesByNumericSuffix(".SageTheMage", "SageTheMage1847"), true);
  assert.strictEqual(matchesByNumericSuffix(".SageTheMage", ".SageTheMage1847"), true);
  assert.strictEqual(matchesByNumericSuffix("SageTheMage", "*SageTheMage77"), true);
});

test("a non-numeric remainder never matches", () => {
  assert.strictEqual(matchesByNumericSuffix("SageTheMage", "SageTheMageTwo"), false);
  assert.strictEqual(matchesByNumericSuffix("SageTheMage", "SageTheMageEvil"), false);
  assert.strictEqual(matchesByNumericSuffix("SageTheMage", "SageTheMage_1847"), false);
  assert.strictEqual(matchesByNumericSuffix("SageTheMage", "SageTheMage1847b"), false);
  assert.strictEqual(matchesByNumericSuffix("SageTheMage", "SageTheMage 1847"), false);
});

test("unrelated or shorter names never match", () => {
  assert.strictEqual(matchesByNumericSuffix("SageTheMage", "SomeoneElse"), false);
  assert.strictEqual(matchesByNumericSuffix("SageTheMage", "SageTheMage"), false, "no suffix is not a suffix match");
  assert.strictEqual(matchesByNumericSuffix("SageTheMage", "Sage"), false, "a shorter stem is not a match");
  assert.strictEqual(matchesByNumericSuffix("", "SageTheMage1"), false);
  assert.strictEqual(matchesByNumericSuffix("SageTheMage", ""), false);
  assert.strictEqual(matchesByNumericSuffix(null, null), false);
});

test("a prefix of the stem never matches", () => {
  assert.strictEqual(matchesByNumericSuffix("Sage", "SageTheMage1847"), false);
});

test("stripping the prefix leaves a bare Floodgate dot alone", () => {
  assert.strictEqual(stripFloodgatePrefix("."), ".", "a lone prefix has no name behind it");
  assert.strictEqual(stripFloodgatePrefix(".Sage"), "Sage");
  assert.strictEqual(stripFloodgatePrefix("Sage"), "Sage");
  assert.strictEqual(stripFloodgatePrefix(null), "");
});

test("resolveOnlinePlayerName prefers an exact online match", () => {
  const bot = { players: { "SageTheMage": {}, ".SageTheMage1847": {} } };
  const resolved = resolveOnlinePlayerName(bot, "SageTheMage");

  assert.strictEqual(resolved.name, "SageTheMage", "exact wins over the decoy");
  assert.strictEqual(resolved.exact, true);
});

test("resolveOnlinePlayerName falls back to the numeric-suffix player", () => {
  const bot = { players: { ".SageTheMage1847": {} } };
  const resolved = resolveOnlinePlayerName(bot, "SageTheMage");

  assert.strictEqual(resolved.name, ".SageTheMage1847", "must report the real online name");
  assert.strictEqual(resolved.exact, false, "and mark it as a fallback so it gets pinned");
});

test("resolveOnlinePlayerName ignores an unrelated online player", () => {
  const bot = { players: { ".SomeOtherPlayer": {} } };
  const resolved = resolveOnlinePlayerName(bot, "SageTheMage");

  assert.strictEqual(resolved.name, null);
  assert.strictEqual(resolved.exact, false);
});

test("chat matches the stem even before the entity is online", () => {
  // Chat can arrive before the player is in the entity list; matching must not
  // depend on visibility.
  assert.strictEqual(matchesPlayerName({}, "SageTheMage", "SageTheMage1847"), true);
  assert.strictEqual(matchesPlayerName({}, "SageTheMage", ".SageTheMage1847"), true);
  assert.strictEqual(matchesPlayerName({}, "SageTheMage", "SomeoneElse"), false);
});

test("an exact online name still beats the stem fallback", () => {
  const bot = { players: { "SageTheMage": {}, ".SageTheMage1847": {} } };

  assert.strictEqual(matchesPlayerName(bot, "SageTheMage", "SageTheMage"), true);
  assert.strictEqual(
    matchesPlayerName(bot, "SageTheMage", ".SageTheMage1847"),
    false,
    "once an exact player is online, a different player must not be accepted"
  );
});

console.log(
  failedOrOk(process.exitCode) ? "playerStemMatching tests passed" : "playerStemMatching tests FAILED"
);

function failedOrOk(exitCode) {
  return !exitCode;
}