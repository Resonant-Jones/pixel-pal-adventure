#!/usr/bin/env node

// Minimal test runner. The suite is plain node:assert scripts with no external
// dependency, which keeps `npm test` working with nothing installed.
//
// Every test file must exit 0. A file that throws takes the whole run down,
// because the failures are sequential scripts rather than isolated specs.

const { execFileSync } = require("node:child_process");
const { readdirSync } = require("node:fs");
const path = require("node:path");

const testsDir = __dirname;
const files = readdirSync(testsDir)
  .filter((name) => name.endsWith(".test.js"))
  .sort();

if (!files.length) {
  console.error("No test files found.");
  process.exit(1);
}

let failed = 0;

for (const file of files) {
  process.stdout.write(`\n--- ${file}\n`);

  try {
    execFileSync(process.execPath, [path.join(testsDir, file)], {
      stdio: "inherit"
    });
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${file}`);
  }
}

console.log("");
if (failed) {
  console.error(`${failed} of ${files.length} test file(s) failed.`);
  process.exit(1);
}

console.log(`All ${files.length} test files passed.`);