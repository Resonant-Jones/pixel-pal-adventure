const assert = require("assert");

const { buildUserPrompt, buildSystemPrompt } = require("../ai/promptBuilder");

const prompt = buildUserPrompt({
  latestMessage: "build a hut at this anchor",
  speakerName: ".Marallren",
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

assert.ok(prompt.includes("sent by: .Marallren"), "the prompt must name who is speaking");
assert.ok(prompt.includes("Operator instruction:"));
assert.ok(prompt.includes("None separate from the user message."));
assert.ok(prompt.includes("Spatial references:"));
assert.ok(prompt.includes("anchor-1"));
assert.ok(prompt.includes("Allowed actions:"));
assert.ok(prompt.includes("- chat"));
assert.ok(prompt.includes("- compose_structure"));
assert.ok(prompt.includes("Retry guidance:"));
assert.ok(prompt.includes("Avoid invalid coordinates."));

// A speaker must never be silently dropped. Without the name the model has no way
// to tell two players apart and answers everyone as the primary player.
const unnamed = buildUserPrompt({
  latestMessage: "make a village house",
  recentMessages: [],
  recentEvents: [],
  recentSummaries: [],
  recentReflexEvents: [],
  worldSnapshot: {},
  playerState: {}
});
assert.ok(!/\bsent by:/.test(unnamed), "no speaker means no invented name");
assert.ok(unnamed.includes("do not guess a name"));

// The system prompt must not present one player as the only possible speaker.
const rostered = buildSystemPrompt({
  companionName: "Guardian",
  primaryPlayer: "Panda_Nuggetz",
  knownPlayers: ["Panda_Nuggetz", ".Marallren", "Panda_Nuggetz"]
});
assert.ok(rostered.includes(".Marallren"), "the roster must list other players");
assert.ok(rostered.includes("is NOT the only person"), "must not imply a single player");
assert.ok(!rostered.includes("Panda_Nuggetz, .Marallren, .Marallren"), "roster must dedupe");

console.log("promptBuilder tests passed");
