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
    expectedReason: "build_requires_shape",
    expectedClarification: true
  },
  {
    message: "build something cool at this anchor",
    resolvedAnchor: {
      anchor: { id: "anchor-1" },
      target: { x: 10, y: 64, z: -20 }
    },
    expectedLane: "social",
    expectedReason: "build_requires_shape",
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

// --- Bug 4 regression: a paused build must still hold the gate ---------------
//
// Previously `active` meant `status === "running"` only, so the instant a
// build paused the mutation gate swung open and the next "build a house"
// queued a second competing job on the same site. getActiveBuildStatus() now
// counts "paused" as active, and a resume nudge routes to the task lane
// instead of composing a brand-new structure.

const pausedBuild = { active: true, state: "paused", lane: "template", jobId: "job-1", progress: 40 };
const runningBuild = { active: true, state: "running", lane: "template", jobId: "job-2", progress: 10 };

const gateCases = [
  {
    label: "duplicate build is gated while paused",
    message: "build a house at 10 64 -20",
    buildStatus: pausedBuild,
    expectedLane: "social",
    expectedReason: "mutation_gate"
  },
  {
    label: "duplicate build is gated while running",
    message: "build a house at 10 64 -20",
    buildStatus: runningBuild,
    expectedLane: "social",
    expectedReason: "mutation_gate"
  },
  {
    label: "resume nudge enters the task lane while paused",
    message: "keep going",
    buildStatus: pausedBuild,
    expectedLane: "task",
    expectedReason: "resume_build_request",
    expectedAction: "resume_build"
  },
  {
    label: "resume nudge enters the task lane while running",
    message: "finish it",
    buildStatus: runningBuild,
    expectedLane: "task",
    expectedReason: "resume_build_request",
    expectedAction: "resume_build"
  },
  {
    label: "pause request enters the task lane",
    message: "pause",
    buildStatus: runningBuild,
    expectedLane: "task",
    expectedReason: "pause_build_request",
    expectedAction: "pause_build"
  },
  {
    label: "resume with nothing active stays social",
    message: "keep going",
    buildStatus: null,
    expectedLane: "social",
    expectedReason: "resume_without_active_build"
  },
  {
    label: "no build at all leaves plain chat social",
    message: "keep going",
    buildStatus: null,
    expectedLane: "social",
    expectedReason: "resume_without_active_build"
  }
];

for (const testCase of gateCases) {
  const result = routeBuildLane({
    message: testCase.message,
    buildStatus: testCase.buildStatus,
    buildMode: "template_only"
  });

  assert.strictEqual(result.lane, testCase.expectedLane, testCase.label);
  assert.strictEqual(result.reason, testCase.expectedReason, testCase.label);

  if (testCase.expectedAction) {
    assert.strictEqual(result.action, testCase.expectedAction, testCase.label);
  }
}

// "stop, don't keep going" must read as a pause, never as a nudge to continue.
const stopPhrase = routeBuildLane({
  message: "stop, don't keep going",
  buildStatus: runningBuild,
  buildMode: "template_only"
});
assert.strictEqual(stopPhrase.action, "pause_build", "'don't keep going' must not resume");

console.log("buildLaneRouter gate tests passed");

// --- "Build me a house" must not demand GPS coordinates ----------------------
//
// This was the single worst failure a child could hit: Guardian replied "give
// me an anchor or coordinates" to a perfectly clear request. A kid does not
// know what an anchor is, and the player is always standing somewhere, so a
// targetless build request now resolves to a build at their feet.

const buildHereCases = [
  "hey build me a house",
  "build me a house right here",
  "make a small wooden house",
  "build me a tower here",
  "make me a bridge near me"
];

for (const message of buildHereCases) {
  const result = routeBuildLane({ message, buildMode: "template_only" });

  assert.strictEqual(result.lane, "task", `"${message}" should reach the task lane`);
  assert.strictEqual(result.reason, "build_here_request", `"${message}" reason`);
  assert.strictEqual(result.target, null, `"${message}" has no explicit target`);
  assert.strictEqual(result.targetMode, "player_position", `"${message}" target mode`);
}

// An explicit coordinate still wins and must NOT be treated as "here".
const explicit = routeBuildLane({
  message: "build a house at 10 64 -20",
  buildMode: "template_only"
});
assert.strictEqual(explicit.reason, "build_request");
assert.strictEqual(explicit.targetMode, "explicit");
assert.deepStrictEqual(explicit.target, {
  x: 10,
  y: 64,
  z: -20,
  source: "coordinates",
  anchorId: null
});

// Naming no shape at all still asks a question — but a useful one, not a
// request for coordinates.
const shapeless = routeBuildLane({ message: "can you build", buildMode: "template_only" });
assert.strictEqual(shapeless.lane, "social");
assert.strictEqual(shapeless.reason, "build_requires_shape");
assert.ok(/house/i.test(shapeless.clarification), "should ask what to build");

console.log("buildLaneRouter build-here tests passed");

// --- The clarification must offer only words the parser accepts ---------------
//
// THE LOOP THIS TEST EXISTS FOR
//
// The vocabulary of buildable shapes was thirteen words, and the agent's
// clarifying question was a string literal that offered four of them:
//
//   "Sure — what should I build? A house, a tower, a bridge, or a wall?"
//
// "wall" was not one of the thirteen. So the agent asked a child to choose
// from four options, one of which returned the conversation to exactly the
// same question. There was no way out of it.
//
// The rule now is structural: every word the offer contains must be a shape
// the parser recognises. If the offer names something the parser would
// reject, the conversation loops, and a child has no way to say "stop asking,
// just build it".

const { STRUCTURE_NOUNS } = require("../builder/buildIntent");
const { classifyBuildRequest } = require("../builder/buildIntent");

const shapelessAgain = routeBuildLane({ message: "build something cool", buildMode: "template_only" });
assert.strictEqual(shapelessAgain.reason, "build_requires_shape");

// Pull the offered words out of the sentence itself, so the test tracks the
// message rather than a copy of it.
const STOP_WORDS = new Set(["a", "or", "sure", "what", "should", "i", "build", "me"]);
const offered = (shapelessAgain.clarification.match(/\b[a-z]+\b/gi) || [])
  .map((word) => word.toLowerCase())
  .filter((word) => !STOP_WORDS.has(word));

assert.ok(offered.length > 0, "the clarification must actually offer something");

for (const word of offered) {
  const request = classifyBuildRequest(`build me a ${word}`);

  assert.ok(
    request.hasStructureCue,
    `the clarification offers "${word}", but the parser does not recognise it as a shape — ` +
      "answering the question would ask the same question again"
  );

  assert.strictEqual(
    request.needsClarification,
    false,
    `the clarification offers "${word}", but asking for it still needs clarification — ` +
      "that is the loop"
  );
}

// --- The words a ten-year-old actually says must reach the task lane ---------
//
// "build a small wooden platform" was asked for live on 2026-11-25 and came
// back as "what should I build?". These are the everyday shapes that were
// missing from the vocabulary.

const kidShapes = [
  "platform", "wall", "fence", "path", "road", "floor", "roof", "deck",
  "pillar", "arch", "gate", "stairs", "ladder", "farm", "garden", "shed",
  "workshop", "garage", "barn", "castle", "palace", "dungeon", "monument",
  "statue", "pyramid", "dome", "treehouse", "village", "rocket", "spaceship",
  "robot", "dragon"
];

for (const shape of kidShapes) {
  const result = routeBuildLane({ message: `build me a ${shape}`, buildMode: "template_only" });

  assert.strictEqual(
    result.lane,
    "task",
    `"build me a ${shape}" should reach the task lane, not ask a question`
  );
  assert.strictEqual(
    result.reason,
    "build_here_request",
    `"build me a ${shape}" reason`
  );
}

// Plurals have to work, because "build me two houses" is a normal sentence.
const plural = routeBuildLane({ message: "build me two houses", buildMode: "template_only" });
assert.strictEqual(plural.lane, "task", "plurals must be recognised too");

// --- ...but ordinary English words must not become shapes --------------------
//
// "well" and "mine" were deliberately left out of the vocabulary. "build it
// well" is a sentence, not a request for a well.

for (const phrase of ["build it well", "make this mine"]) {
  const request = classifyBuildRequest(phrase);

  assert.strictEqual(
    request.hasStructureCue,
    false,
    `"${phrase}" must not be read as naming a structure`
  );
}

console.log("buildLaneRouter clarification-loop tests passed");
