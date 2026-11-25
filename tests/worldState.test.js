const assert = require("node:assert/strict");

const { classify } = require("../scripts/worldState");

// The rule for "is the world actually serving?"
//
// This rule was written twice before — once in the pilot and once inline in
// guardian.sh — and the two copies disagreed. One of them looked for a
// connectionHealth of "connected", which this agent NEVER reports: the real
// values are "healthy", "degraded", "disconnected" and "duplicate_session".
// So the "the world is serving" branch could never fire, and the status
// line was structurally incapable of saying the world was fine.
//
// Hence: one module, and these tests pin every value it can see.

console.log("worldState");

function testHealthyMeansInWorld() {
  assert.equal(
    classify({ lifecycle: "ready", connectionHealth: "healthy" }).verdict,
    "in_world",
    "a healthy connection means the world is serving"
  );

  // The agent re-spawns into a reconnecting lifecycle before it settles.
  assert.equal(
    classify({ lifecycle: "reconnecting", connectionHealth: "healthy" }).verdict,
    "in_world",
    "a healthy connection wins even mid-reconnect"
  );
}

function testGivenUpMeansLockedOut() {
  const verdict = classify({ lifecycle: "error", connectionHealth: "disconnected" });

  assert.equal(
    verdict.verdict,
    "locked_out",
    "the agent exhausting its reconnect attempts means the world is broken"
  );
  assert.match(verdict.reason, /error/, "the reason should say what was seen");
}

function testStillTryingIsNotLockedOut() {
  // THIS IS THE ONE THAT MATTERS MOST.
  //
  // A Paper server that is booting normally leaves the agent
  // "reconnecting" for about thirty seconds. If that counted as
  // "locked_out", the pilot would restart a healthy server that was still
  // starting — it would cause the outage it exists to prevent.
  const reconnecting = classify({ lifecycle: "reconnecting", connectionHealth: "disconnected" });
  assert.equal(
    reconnecting.verdict,
    "recovering",
    "the agent still trying must not be treated as the world being broken"
  );

  const degraded = classify({ lifecycle: "ready", connectionHealth: "degraded" });
  assert.equal(degraded.verdict, "recovering", "a bot error may well recover on its own");

  const booting = classify({ lifecycle: "booting", connectionHealth: "degraded" });
  assert.equal(booting.verdict, "recovering", "an agent that is still starting is not a failure");

  const starting = classify({ lifecycle: "starting", connectionHealth: "degraded" });
  assert.equal(starting.verdict, "recovering", "neither is an agent that has just started");
}

function testDuplicateSessionIsNotAWorldProblem() {
  // Another Guardian owns the world. That is not a broken world, and
  // restarting it would be exactly wrong.
  const verdict = classify({ lifecycle: "halted", connectionHealth: "duplicate_session" });

  assert.equal(
    verdict.verdict,
    "unknown",
    "another session owns the world — the world is not broken"
  );
  assert.match(verdict.reason, /another session/, "the reason should say why");
}

function testUnknownStates() {
  assert.equal(classify(null).verdict, "unknown");
  assert.equal(classify(undefined).verdict, "unknown");
  assert.equal(classify({}).verdict, "unknown");
  assert.equal(classify("nonsense").verdict, "unknown");
  assert.equal(classify({ lifecycle: "paused", connectionHealth: "healthy" }).verdict, "in_world");
  assert.equal(classify({ lifecycle: "stopped", connectionHealth: "disconnected" }).verdict, "recovering");
}

// The real values, so a future change to the agent's vocabulary breaks this
// test rather than silently breaking the pilot.
function testTheAgentsActualVocabulary() {
  const HEALTHY = ["healthy"];
  const NOT_HEALTHY = ["degraded", "disconnected", "duplicate_session"];

  for (const value of HEALTHY) {
    assert.equal(
      classify({ lifecycle: "ready", connectionHealth: value }).verdict,
      "in_world",
      `"${value}" should mean the world is serving`
    );
  }

  for (const value of NOT_HEALTHY) {
    assert.notEqual(
      classify({ lifecycle: "ready", connectionHealth: value }).verdict,
      "in_world",
      `"${value}" must never be reported as a serving world`
    );
  }

  // And there is no such thing as "connected". If the agent ever grows one,
  // this fails and the rule gets revisited rather than silently misreading it.
  assert.equal(
    classify({ lifecycle: "ready", connectionHealth: "connected" }).verdict,
    "unknown",
    '"connected" is not a value this agent reports — if it appears, revisit the rule'
  );
}

testHealthyMeansInWorld();
testGivenUpMeansLockedOut();
testStillTryingIsNotLockedOut();
testDuplicateSessionIsNotAWorldProblem();
testUnknownStates();
testTheAgentsActualVocabulary();

console.log("  all world-state tests passed");
