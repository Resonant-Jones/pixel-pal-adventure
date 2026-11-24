const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Shutting down must not throw.
//
// This was found live on 2026-11-24, and it was not a crash in the usual
// sense — it was a crash in the SHUTDOWN. The machine was restarting the
// whole stack, SurrealDB had been killed first, and then Guardian was
// stopped. The writes that close the session failed with "fetch failed",
// the exception escaped AgentRuntime.stop(), and the process died with an
// unhandled rejection and a non-zero exit.
//
// Why it matters more than a noisy log line: the launchd job restarts after
// a FAILED exit, so a clean shutdown that throws gets read as a crash and
// restarted, and a shutdown that throws while the database is down can
// crash-loop.
//
// The rule: a session that cannot be closed in a database that has gone
// away is a session that is over. Say so and carry on.

const agentRuntimeSource = fs.readFileSync(
  path.join(__dirname, "..", "agent", "agentRuntime.js"),
  "utf-8"
);

function testStopIsGuarded() {
  const stopIndex = agentRuntimeSource.indexOf("async stop() {");
  assert.ok(stopIndex > -1, "AgentRuntime.stop() must exist");

  // Everything from stop() to the end of the class. Searching the whole
  // file would find the same method names in start() and assert about the
  // wrong code.
  const stop = agentRuntimeSource.slice(stopIndex);

  // The two writes that close the session out must each be guarded.
  for (const call of ["pauseRunningJobs", "endSession"]) {
    const index = stop.indexOf(call);
    assert.ok(index > -1, `stop() should still call ${call}`);

    // The try comes before the call and the catch comes after it, so the
    // window has to span both.
    const around = stop.slice(Math.max(0, index - 400), index + 400);

    assert.match(
      around,
      /try\s*\{/,
      `${call} must be inside a try — a failed write during shutdown cannot be allowed to escape`
    );
    assert.match(
      around,
      /catch/,
      `${call} must have a catch that logs rather than rethrows`
    );
  }
}

function testTeardownIsGuarded() {
  const stopIndex = agentRuntimeSource.indexOf("async stop() {");
  assert.ok(stopIndex > -1, "AgentRuntime.stop() must exist");

  const stop = agentRuntimeSource.slice(stopIndex);
  const finallyIndex = stop.indexOf("} finally {");
  assert.ok(finallyIndex > -1, "stop() must have a finally block");

  const teardown = stop.slice(finallyIndex, finallyIndex + 1400);

  for (const call of ["disconnect", "surrealClient.close"]) {
    assert.ok(teardown.includes(call), `the teardown should still call ${call}`);

    const callIndex = teardown.indexOf(call);
    const around = teardown.slice(Math.max(0, callIndex - 300), callIndex + 400);

    assert.match(
      around,
      /try\s*\{/,
      `${call} must be guarded — a teardown that dies halfway leaves the bot in the world with no brain`
    );
    assert.match(around, /catch/, `${call} must have a catch`);
  }
}

// The companion app has the same rule: it opens the microphone, and a
// failure while shutting the audio down must not take the console with it.
function testCompanionStopIsGuarded() {
  const companionSource = fs.readFileSync(
    path.join(__dirname, "..", "companion", "companionApp.js"),
    "utf-8"
  );

  const index = companionSource.indexOf("async stop()");
  assert.ok(index > -1, "CompanionApp.stop() must exist");

  const stop = companionSource.slice(index, index + 2000);

  assert.ok(
    stop.includes("inputGuard.stop()"),
    "the console must stop the microphone watchdog on shutdown"
  );
  assert.ok(
    stop.includes("audio.stopAll()"),
    "the console must stop the audio engine on shutdown"
  );
}

console.log("agentShutdown");
testStopIsGuarded();
testTeardownIsGuarded();
testCompanionStopIsGuarded();
console.log("  all agent shutdown tests passed");
