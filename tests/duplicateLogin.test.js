const assert = require("assert");

const { classifyConnectionError, isDuplicateLoginKick } = require("../agent/retrySignatures");

// --- Regression: a duplicate login must never trigger a reconnect ------------
//
// Closing a laptop suspends the process. On wake the bot reconnects, but the
// server may still hold the stale session and kick the new one as a duplicate
// login. If a second agent copy is running, the pair settle into an infinite
// mutual-kick storm — observed at ~2200 join/leave cycles in one run, which is
// what a 1.8 MB log full of "You logged in from another location" looks like.
//
// The fix is classification: a duplicate login is FATAL, not transient. The
// kicked instance must stop, not retry.

const duplicateMessages = [
  "Minecraft connection was kicked: You logged in from another location",
  "Minecraft connection was kicked: {\"text\":\"You logged in from another location\"}",
  "you are already connected",
  "Already logged in!",
  "duplicate login detected",
  'Minecraft connection was kicked: {"translate":"multiplayer.disconnect.duplicateLogin"}',
  'Minecraft connection was kicked: {"type":"compound","value":{"translate":{"type":"string","value":"multiplayer.disconnect.duplicate_login"}}}'
];

for (const message of duplicateMessages) {
  assert.strictEqual(
    isDuplicateLoginKick(new Error(message)),
    true,
    `must recognise duplicate login: "${message}"`
  );

  const classified = classifyConnectionError(new Error(message));
  assert.strictEqual(
    classified.errorCode,
    "duplicate_login",
    `"${message}" must classify as duplicate_login, not the generic kicked`
  );
  assert.strictEqual(
    classified.errorCategory,
    "fatal",
    "duplicate login must be fatal so the reconnect loop refuses it"
  );
}

console.log("  ✓ duplicate-login kicks are recognised and classed fatal");

// --- Ordinary drops must STILL reconnect -------------------------------------
//
// The guard must be narrow. Wifi blips, restarts and timeouts are exactly what
// the reconnect logic exists for, and must not be caught by it.

const transientMessages = [
  "Minecraft connection ended before the bot spawned.",
  "Minecraft connection ended.",
  "read ECONNRESET",
  "socket hang up",
  "Minecraft connection was kicked: Server closed"
];

for (const message of transientMessages) {
  assert.strictEqual(
    isDuplicateLoginKick(new Error(message)),
    false,
    `transient failure must NOT be treated as a duplicate login: "${message}"`
  );

  const classified = classifyConnectionError(new Error(message));
  assert.notStrictEqual(
    classified.errorCategory,
    "fatal",
    `"${message}" must stay recoverable so reconnect still works`
  );
}

console.log("  ✓ ordinary drops still reconnect");

// A plain kick that is not a duplicate login keeps its own classification.
assert.strictEqual(
  classifyConnectionError(new Error("Minecraft connection was kicked: Flying is not enabled")).errorCode,
  "kicked",
  "non-duplicate kicks keep the kicked code"
);

assert.strictEqual(isDuplicateLoginKick(null), false, "null must be safe");
assert.strictEqual(isDuplicateLoginKick({}), false, "an empty error must be safe");

console.log("  ✓ non-duplicate kicks are unaffected");
console.log("duplicateLogin tests passed");
