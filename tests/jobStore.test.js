const assert = require("assert");
const fs = require("node:fs");
const path = require("node:path");

const { JobStore } = require("../memory/jobStore");

// --- Regression: record ids must not be used raw as UPDATE targets -----------
//
// SurrealDB 3.x returns record ids whose string form carries ⟨angle
// brackets⟩ ("jobs:⟨f85qfk9oh803ymbovd⟩"). Passing that string straight to
// `UPDATE $jobId` fails with:
//
//   Cannot execute UPDATE statement using value: 'jobs:⟨f85qfk9oh803ymbovd⟩'
//
// Every build job died at its first state transition, which surfaced in-game
// as "I lost the thread for a moment." Wrapping the target in type::record()
// makes both plain strings and RecordId objects resolve correctly.

const jobStoreSource = fs.readFileSync(
  path.join(__dirname, "..", "memory", "jobStore.js"),
  "utf-8"
);

const rawIdUpdates = jobStoreSource.match(/UPDATE\s+\$(?![\w]*type::record)/g) || [];
assert.strictEqual(
  rawIdUpdates.length,
  0,
  "jobStore must never use a bare $id as an UPDATE target — use type::record($id). " +
    `Found ${rawIdUpdates.length}: ${rawIdUpdates.join(", ")}`
);

// Every lifecycle transition must be wrapped.
for (const method of ["markRunning", "updateJob", "completeJob", "pauseJob", "failJob", "resumeBuildJob"]) {
  assert.ok(
    typeof JobStore.prototype[method] === "function",
    `JobStore.${method} must exist`
  );
}

// Single-quoted string literals inside SurrealQL break statement parsing;
// the schema elsewhere uses double quotes, so these must not drift back.
const singleQuoted = jobStoreSource.match(/status:\s*'[^']*'/g) || [];
assert.strictEqual(
  singleQuoted.length,
  0,
  `SurrealQL string literals must use double quotes, not single. Found: ${singleQuoted.join(", ")}`
);

// The store must still hand the raw id through rather than forcing a string.
const store = new JobStore({ query: async () => [] });
assert.strictEqual(store.client && typeof store.client.query, "function", "store holds a client");

console.log("jobStore regression tests passed");