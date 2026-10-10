const assert = require("assert");

// The old fallback said this for EVERY possible failure. The point of this test
// is that it must never come back.
const FORBIDDEN = "I lost the thread for a moment";

// Load the module and pull the helper out of the file, since it is internal.
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "agent", "agentRuntime.js"),
  "utf-8"
);

const start = source.indexOf("function describeTurnFailure");
const end = source.indexOf("\nfunction normalizeBlockPosition", start);

assert.ok(start > -1 && end > start, "describeTurnFailure must exist");

// eslint-disable-next-line no-new-func
const describeTurnFailure = new Function(
  `${source.slice(start, end)}; return describeTurnFailure;`
)();

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
    process.exitCode = 1;
  }
}

test("missing materials says so, in plain language", () => {
  const reply = describeTurnFailure(new Error("Missing materials."));

  assert.ok(!reply.includes(FORBIDDEN), "must not use the old non-answer");
  assert.ok(/blocks/i.test(reply), "must name the actual problem");
  assert.ok(/restock/i.test(reply), "and say what happens next");
});

test("an obstructed site tells him to move somewhere else", () => {
  const reply = describeTurnFailure(new Error("SITE_OBSTRUCTED"));

  assert.ok(/open ground|somewhere/i.test(reply), "must suggest a real remedy");
  assert.ok(!reply.includes(FORBIDDEN));
});

test("a compose_structure permission throw is recognised as a build failure", () => {
  const reply = describeTurnFailure(
    new Error("compose_structure action requires build mutation permission.")
  );

  assert.ok(!reply.includes(FORBIDDEN), "must not leak an internal rule name");
  assert.ok(/build/i.test(reply), "must read as a build problem, not a mystery");
});

test("a bare build_structure failure never claims retrying will help", () => {
  const reply = describeTurnFailure(new Error("build_structure failed"));
  const generic = describeTurnFailure(new Error("ECONNRESET"));

  for (const message of [reply, generic]) {
    assert.ok(
      !/ask me again in a second/i.test(message),
      "must not promise that repeating the request fixes it"
    );
  }
});

test("unknown failures stay honest and short", () => {
  const reply = describeTurnFailure(new Error("something odd"));

  assert.ok(reply.length < 120, `chat lines must stay short, got ${reply.length}`);
  assert.ok(!reply.includes(FORBIDDEN));
});

test("a null or empty error is handled safely", () => {
  assert.strictEqual(typeof describeTurnFailure(null), "string");
  assert.strictEqual(typeof describeTurnFailure(undefined), "string");
  assert.strictEqual(typeof describeTurnFailure({}), "string");
});

test("no reply ever contains a raw stack trace or internal identifier", () => {
  const errors = [
    new Error("Error: /Users/x/y.js:12 throw boom"),
    new Error("postgres ECONNREFUSED 127.0.0.1:8001"),
    new Error("jargon_diagnostic_code_9000")
  ];

  for (const error of errors) {
    const reply = describeTurnFailure(error);

    // A real stack frame looks like "\n    at name (file:1:2)" or bare "file:1:2".
    assert.ok(!/\s+at\s+\w|\d:\d+/.test(reply), `no stack frames: ${reply}`);
    assert.ok(!/\/[a-z]+\/.*\.js/.test(reply), `no file paths: ${reply}`);
    assert.ok(!reply.includes("ECONNREFUSED"), `no infra jargon: ${reply}`);
  }
});

console.log(`turnFailureMessage tests ${failed === 0 ? "passed" : "FAILED"} (${passed} passed, ${failed} failed)`);