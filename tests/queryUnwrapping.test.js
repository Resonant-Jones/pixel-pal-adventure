const assert = require("assert");
const fs = require("node:fs");
const path = require("node:path");

const { getStatementRows } = require("../memory/surrealClient");

// --- Regression: query results must be unwrapped correctly --------------------
//
// This was the bug that stopped every build. `client.query()` returns one
// entry per statement: `[[row, row, ...]]`. getNextBuildJob assigned the whole
// result instead of destructuring, so `jobs` became `[[row, ...]]` — one
// element, itself an array. Every `job.status` read undefined, the filter
// dropped all five queued builds, and the worker returned null forever while
// jobs sat in `pending`. The bot cheerfully said it was building the whole time.

const clientSource = fs.readFileSync(
  path.join(__dirname, "..", "memory", "surrealClient.js"),
  "utf-8"
);

// The helper must flatten the double-wrapped shape.
assert.deepStrictEqual(
  getStatementRows([[{ status: "pending" }, { status: "paused" }]]).map((r) => r.status),
  ["pending", "paused"],
  "must flatten [[rows]] into rows"
);

// ...and still handle the already-destructured shape used by every other store.
assert.deepStrictEqual(
  getStatementRows([{ status: "pending" }]).map((r) => r.status),
  ["pending"],
  "must pass through [rows] unchanged"
);

assert.deepStrictEqual(getStatementRows(null), [], "null must yield no rows");
assert.deepStrictEqual(getStatementRows([]), [], "empty must yield no rows");
console.log("  ✓ getStatementRows handles both shapes");

// No store may assign a raw query result into a variable it later treats as rows.
const storeDir = path.join(__dirname, "..", "memory");
const offenders = [];
for (const file of fs.readdirSync(storeDir).filter((f) => f.endsWith(".js"))) {
  const src = fs.readFileSync(path.join(storeDir, file), "utf-8");
  // `x = await this.client.query(` without a surrounding [ ]
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    const m = line.match(/^\s*(?!const\s*\[)([A-Za-z_$][\w$]*)\s*=\s*await\s+this\.client\.query\(/);
    if (m) offenders.push(`${file}:${i + 1} -> ${m[1]}`);
  });
}

assert.strictEqual(
  offenders.length,
  0,
  `query results must be destructured before use; found: ${offenders.join(", ")}`
);
console.log("  ✓ no store assigns an un-destructured query result");

// Guard the specific method that failed.
const jobStoreSource = fs.readFileSync(path.join(storeDir, "jobStore.js"), "utf-8");
assert.ok(
  /\[selected\]\s*=\s*await\s+this\.client\.query\(/.test(jobStoreSource),
  "getNextBuildJob must destructure its query result"
);
console.log("  ✓ getNextBuildJob destructures");

console.log("query unwrapping regression tests passed");