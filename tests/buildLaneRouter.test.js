const assert = require("assert");

const { routeBuildLane } = require("../agent/buildLaneRouter");

const cases = [
  {
    message: "remember that tower we built at 10 64 -20",
    expectedLane: "social",
    expectedReason: "social_only"
  },
  {
    message: "don't build near spawn",
    expectedLane: "social",
    expectedReason: "negative_build_instruction"
  },
  {
    message: "maybe later we should build a bridge",
    expectedLane: "social",
    expectedReason: "hypothetical_build_language"
  },
  {
    message: "this cave needs a base",
    expectedLane: "social",
    expectedReason: "social_only"
  },
  {
    message: "x 10 y 64 z -20 is where the house was",
    expectedLane: "social",
    expectedReason: "social_only"
  },
  {
    message: "build something cool",
    expectedLane: "social",
    expectedReason: "build_requires_target",
    expectedClarification: true
  },
  {
    message: "build something cool at this anchor",
    resolvedAnchor: {
      anchor: { id: "anchor-1" },
      target: { x: 10, y: 64, z: -20 }
    },
    expectedLane: "social",
    expectedReason: "build_requires_bounds",
    expectedClarification: true
  },
  {
    message: "build a small wooden hut at this anchor",
    resolvedAnchor: {
      anchor: { id: "anchor-1" },
      target: { x: 10, y: 64, z: -20 }
    },
    expectedLane: "task",
    expectedBuildLane: "template",
    expectedReason: "build_request"
  }
];

for (const testCase of cases) {
  const result = routeBuildLane({
    message: testCase.message,
    resolvedAnchor: testCase.resolvedAnchor || null,
    buildMode: "template_only"
  });

  assert.strictEqual(result.lane, testCase.expectedLane, testCase.message);
  assert.strictEqual(result.reason, testCase.expectedReason, testCase.message);

  if (testCase.expectedClarification) {
    assert.ok(result.clarification, testCase.message);
  }

  if (testCase.expectedBuildLane) {
    assert.strictEqual(result.buildLane, testCase.expectedBuildLane, testCase.message);
    assert.deepStrictEqual(result.target, { x: 10, y: 64, z: -20, source: "anchor", anchorId: "anchor-1" });
  }
}

console.log("buildLaneRouter tests passed");
