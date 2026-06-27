const assert = require("assert");

const { buildUserPrompt } = require("../ai/promptBuilder");

const prompt = buildUserPrompt({
  latestMessage: "build a hut at this anchor",
  operatorInstruction: null,
  spatialReferences: [{ source: "anchor", x: 10, y: 64, z: -20, anchorId: "anchor-1" }],
  allowedActions: ["chat", "compose_structure"],
  recentMessages: [],
  recentEvents: [],
  recentSummaries: [],
  recentReflexEvents: [],
  worldSnapshot: { captured_at: "now" },
  playerState: {},
  retryGuidance: "Avoid invalid coordinates."
});

assert.ok(prompt.includes("Latest player message:"));
assert.ok(prompt.includes("Operator instruction:"));
assert.ok(prompt.includes("None separate from the user message."));
assert.ok(prompt.includes("Spatial references:"));
assert.ok(prompt.includes("anchor-1"));
assert.ok(prompt.includes("Allowed actions:"));
assert.ok(prompt.includes("- chat"));
assert.ok(prompt.includes("- compose_structure"));
assert.ok(prompt.includes("Retry guidance:"));
assert.ok(prompt.includes("Avoid invalid coordinates."));

console.log("promptBuilder tests passed");
