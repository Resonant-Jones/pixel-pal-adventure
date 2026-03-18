const assert = require("assert");

const { buildUserPrompt } = require("../ai/promptBuilder");

const prompt = buildUserPrompt({
  latestMessage: "hi",
  recentMessages: [],
  recentEvents: [],
  recentSummaries: [],
  recentReflexEvents: [],
  worldSnapshot: { captured_at: "now" },
  playerState: {},
  retryGuidance: "Avoid invalid coordinates."
});

assert.ok(prompt.includes("Retry guidance:"));
assert.ok(prompt.includes("Avoid invalid coordinates."));

console.log("promptBuilder tests passed");
