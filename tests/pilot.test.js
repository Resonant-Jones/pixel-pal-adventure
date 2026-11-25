const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// The pilot's decision logic.
//
// Two things here are worth proving, and neither is about the launchd
// plumbing:
//
//   1. The pilot NUDGES before it restarts the world. The nudge is free;
//      the restart is not. A nudge that works means the world was merely
//      awkward for a moment, and the world should not be disturbed.
//
//   2. The pilot never restarts the world for a reason that is not the
//      world. An agent that is still trying, or an agent that is not
//      answering at all, must be left alone.
//
// The actions are injected, so the sequence can be observed exactly.

const pilot = require("../scripts/pilot");

console.log("pilot");

// A fake world: an agent that reports whatever the test says, and a record
// of what the pilot did to it.
//
// The clock is fake too. Real waits would make this test take minutes and
// prove nothing extra — what is being proved is the ORDER.
//
// `verdicts` may be a list or a function of the call history, so a test can
// say "stays locked_out until the world is restarted".
function makeWorld(verdicts) {
  const calls = [];
  let index = 0;
  let clock = 0;

  return {
    calls,
    deps: {
      read: async () => {
        const list = typeof verdicts === "function" ? verdicts(calls, index) : verdicts;
        const verdict = list[Math.min(index, list.length - 1)];
        index += 1;
        return { verdict, reason: "test" };
      },
      nudge: async () => {
        calls.push("nudge");
        return true;
      },
      restart: () => {
        calls.push("restart");
        return true;
      },
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      graceMs: 60_000,
      recoveryMs: 60_000,
      cooldownMs: 0
    }
  };
}

async function testNudgeComesFirst() {
  // The agent is out, and the nudge fixes it.
  const world = makeWorld(["locked_out", "in_world", "in_world", "in_world"]);

  const result = await pilot.runEpisode(world.deps);

  assert.deepEqual(
    world.calls,
    ["nudge"],
    "a nudge that works must NOT restart the world — that would be a needless outage"
  );
  assert.equal(result.restarted, false);
  assert.equal(result.recovered, true);
}

async function testRestartOnlyAfterTheNudgeFails() {
  // The agent is out and stays out until the world is restarted.
  const world = makeWorld((calls) =>
    calls.includes("restart") ? ["in_world", "in_world"] : ["locked_out", "locked_out"]
  );

  const result = await pilot.runEpisode(world.deps);

  assert.equal(world.calls[0], "nudge", "the nudge is always first");
  assert.ok(world.calls.includes("restart"), "when nudging does not work, the world must be restarted");
  assert.equal(
    world.calls[world.calls.length - 1],
    "restart",
    "the restart comes after the nudge, never before"
  );
  assert.equal(result.restarted, true);
  assert.equal(result.recovered, true);
}

async function testNoRestartWhileTheAgentIsStillTrying() {
  const world = makeWorld(["recovering", "recovering", "recovering"]);

  const result = await pilot.runEpisode(world.deps);

  assert.deepEqual(
    world.calls,
    ["nudge"],
    "an agent that is still trying must not trigger a world restart"
  );
  assert.equal(result.restarted, false);
}

async function testNoRestartForAnUnreachableAgent() {
  const world = makeWorld(["unknown", "unknown", "unknown", "unknown"]);

  const result = await pilot.runEpisode(world.deps);

  assert.deepEqual(
    world.calls,
    ["nudge"],
    "an agent that cannot be reached is not evidence that the world is broken"
  );
  assert.equal(result.restarted, false);
}

async function testAFailedRestartIsRetriedNotGivenUpOn() {
  // If the restart itself fails, the episode reports that it did not
  // recover — so the next tick tries again rather than waiting out a
  // cooldown for a failure that may have been transient.
  const world = makeWorld(["locked_out", "locked_out", "locked_out", "locked_out"]);
  world.deps.restart = () => {
    world.calls.push("restart-failed");
    return false;
  };

  const result = await pilot.runEpisode(world.deps);

  assert.deepEqual(world.calls, ["nudge", "restart-failed"]);
  assert.equal(result.restarted, false, "a failed restart did not restart anything");
  assert.equal(result.recovered, false);
}

// The pilot must not be able to reach the "restart" path without going
// through the nudge. That ordering is the whole safety property.
async function testTheRestartIsUnreachableWithoutANudge() {
  const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "pilot.js"), "utf8");

  const episode = source.slice(source.indexOf("async function runEpisode"));
  const restartIndex = episode.indexOf("restart(verdict.reason)");
  const nudgeIndex = episode.indexOf('nudge("pilot_nudge")');

  assert.ok(nudgeIndex > -1, "the episode nudges");
  assert.ok(restartIndex > -1, "the episode can restart");
  assert.ok(
    nudgeIndex < restartIndex,
    "the nudge must come before the restart in the source, not just at runtime"
  );
}

// The verdict routing in the main loop: only "locked_out" may start an
// episode.
async function testOnlyLockedOutStartsAnEpisode() {
  const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "pilot.js"), "utf8");
  const loop = source.slice(source.indexOf("async function tick()"));

  // Every verdict is handled before the episode starts.
  const inWorld = loop.indexOf('verdict.verdict === "in_world"');
  const recovering = loop.indexOf('verdict.verdict === "recovering"');
  const unknown = loop.indexOf('verdict.verdict === "unknown"');
  const episodeStart = loop.indexOf("runEpisode()");

  assert.ok(inWorld > -1 && recovering > -1 && unknown > -1, "all verdicts are handled");
  assert.ok(
    episodeStart > Math.max(inWorld, recovering, unknown),
    "the other verdicts must return before an episode can start"
  );
}

// THE DEADLOCK THIS TEST EXISTS FOR
//
// The first version of the episode waited a fixed 90 seconds for the nudge
// to work, and then stood down if the agent was still "recovering". That was
// a deadlock, and it was silent:
//
//   the nudge starts the agent's OWN retry budget
//     -> the agent is "recovering" for the whole budget
//     -> the pilot waits 90s, sees "recovering", stands down
//     -> the agent spends its budget and reaches "locked out"
//     -> the next episode nudges again, resetting the budget
//     -> the agent never reaches "locked out" while the pilot is watching
//     -> the world is never restarted
//
// The world could hang forever with the pilot running and saying nothing.
//
// The fix is to wait long enough for the agent's budget to run out, and to
// treat "the agent gave up again" as the signal to restart the world.
//
// The verdict sequence below is the real one: recovering for the whole
// budget, then locked_out.
async function testThePilotWaitsForTheAgentsOwnBudget() {
  const graceMs = 6 * 60_000;
  const readsInGrace = Math.ceil(graceMs / 5000);

  const world = makeWorld((calls, index) =>
    calls.includes("restart")
      ? ["in_world", "in_world"]
      : index < readsInGrace
        ? ["recovering"]
        : ["locked_out"]
  );

  world.deps.graceMs = graceMs;

  const result = await pilot.runEpisode(world.deps);

  assert.ok(
    world.calls.includes("restart"),
    "the pilot must restart the world once the agent has spent its budget, not give up"
  );
  assert.equal(result.restarted, true);
}

async function testTheGraceIsLongEnoughForTheRetryBudget() {
  const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "pilot.js"), "utf8");

  // The agent's own numbers, so the two cannot drift apart silently.
  const agentSource = fs.readFileSync(
    path.join(__dirname, "..", "agent", "agentRuntime.js"),
    "utf8"
  );
  const botSource = fs.readFileSync(
    path.join(__dirname, "..", "minecraft", "bot.js"),
    "utf8"
  );

  const maxAttempts = Number(
    (agentSource.match(/reconnectMaxAttempts = reconnectConfig\.maxAttempts \|\| (\d+)/) || [])[1]
  );
  const maxDelay = Number(
    (agentSource.match(/reconnectMaxDelayMs = reconnectConfig\.maxDelayMs \|\| (\d+)/) || [])[1]
  );
  const pingTimeout = Number(
    (botSource.match(/const PING_TIMEOUT_MS = ([\d_]+)/) || [])[1]?.replace(/_/g, "")
  );
  const connectTimeout = Number(
    (botSource.match(/const CONNECT_TIMEOUT_MS = ([\d_]+)/) || [])[1]?.replace(/_/g, "")
  );

  assert.equal(maxAttempts, 5, "the agent's retry budget changed — recheck the grace period");
  assert.equal(maxDelay, 15000, "the agent's backoff changed — recheck the grace period");
  assert.ok(pingTimeout > 0, "the ping timeout could not be read — recheck the grace period");
  assert.ok(connectTimeout > 0, "the connect timeout could not be read — recheck the grace period");

  // One attempt costs the status ping, and — if the ping answers but the
  // handshake does not — the connect as well. Take the worse case.
  const attemptMs = pingTimeout + connectTimeout;

  // And the backoff is jittered, so the WORST case is not maxDelay — it is
  // maxDelay plus the jitter, which is a quarter of it.
  const jitter = Number((agentSource.match(/reconnectJitter = reconnectConfig\.jitter \?\? ([\d.]+)/) || [])[1]);
  const worstDelay = maxDelay * (1 + jitter);
  const budgetMs = maxAttempts * (attemptMs + worstDelay);

  const grace = Number((source.match(/const NUDGE_GRACE_MS = (\d+) \* 60_000/) || [])[1]);
  assert.ok(
    grace * 60_000 > budgetMs,
    `the grace period (${grace * 60_000}ms) must exceed the agent's retry budget (${budgetMs}ms), ` +
      "or the pilot stands down before the agent can finish trying"
  );

  // And it must exceed it by a MARGIN, not by a hair.
  //
  // Measured on 2026-11-25 against a frozen server, the agent's budget after
  // a nudge ran 2m32s. The theoretical worst case is 4m04s, and the grace
  // used to be four minutes — so on a slower machine, or with the backoff
  // jittered up, the grace would expire while the agent was still
  // "recovering". The pilot would then stand down, the next episode would
  // nudge again, and the deadlock the whole design exists to avoid would
  // come back — silently.
  assert.ok(
    grace * 60_000 - budgetMs >= 60_000,
    `the grace period (${grace * 60_000}ms) must exceed the agent's worst-case retry budget ` +
      `(${budgetMs}ms) by at least a minute, or a slow machine reintroduces the deadlock`
  );
}

// The two timeouts have to be short, or the whole recovery takes so long
// that the world looks fine.
async function testTheConnectTimeoutsAreShort() {
  const botSource = fs.readFileSync(
    path.join(__dirname, "..", "minecraft", "bot.js"),
    "utf8"
  );

  const pingTimeout = Number(
    (botSource.match(/const PING_TIMEOUT_MS = ([\d_]+)/) || [])[1]?.replace(/_/g, "")
  );
  const connectTimeout = Number(
    (botSource.match(/const CONNECT_TIMEOUT_MS = ([\d_]+)/) || [])[1]?.replace(/_/g, "")
  );

  // The default ping timeout is 120 seconds. Measured against a Paper server
  // frozen the way the 2026-11-25 outage froze it, the ping took 120066ms to
  // give up. Five of those is a ten-minute retry budget, during which the
  // watchdog correctly saw "the agent is still trying" and correctly stood
  // down — and the world stayed broken for ten minutes.
  assert.ok(
    pingTimeout <= 15_000,
    `the ping timeout (${pingTimeout}ms) must be short — the default is 120s, which makes the ` +
      "whole recovery chain five times too slow"
  );

  assert.ok(
    connectTimeout <= 30_000,
    `the connect timeout (${connectTimeout}ms) must be short — a connect that never times ` +
      "out is a connect that never finishes"
  );
}

// A COOLDOWN STAND-DOWN MUST BE LOUD.
//
// The pilot decided the world was broken, found itself inside the cooldown
// window, and returned without a word. On 2026-11-25 that produced this in
// the log:
//
//   the agent is still out — the world is what is broken
//
// ...and then nothing at all for four minutes.
//
// A silent stand-down is indistinguishable from a watchdog that has given
// up, which is the one thing a watchdog must never look like. The reason
// for waiting belongs in the log, with the time left on it.
async function testTheCooldownStandDownSaysWhy() {
  const world = makeWorld(["locked_out", "locked_out", "locked_out", "locked_out"]);
  world.deps.cooldownMs = 10 * 60_000;
  // The fake clock starts at zero, so this reads as "the world was restarted
  // just now" — squarely inside the cooldown.
  world.deps.getLastRestartAt = () => 0;

  const lines = [];
  const originalLog = console.log;
  console.log = (message) => {
    lines.push(String(message));
  };

  let result;

  try {
    result = await pilot.runEpisode(world.deps);
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(
    world.calls,
    ["nudge"],
    "the cooldown must not restart the world — that is the whole point of a cooldown"
  );
  assert.equal(result.restarted, false);
  assert.equal(result.recovered, false);

  const said = lines.join("\n");
  assert.match(
    said,
    /cooldown/i,
    "the pilot must say that it is waiting on a cooldown, not fall silent"
  );
  assert.match(
    said,
    /\d+s/,
    "the pilot must say how long it intends to wait"
  );
}

// The other half of the same rule: once the cooldown has expired, the pilot
// must restart the world again without complaint.
async function testTheCooldownExpiresAndTheWorldIsRestarted() {
  const world = makeWorld((calls) =>
    calls.includes("restart") ? ["in_world", "in_world"] : ["locked_out", "locked_out"]
  );
  world.deps.cooldownMs = 10 * 60_000;
  world.deps.getLastRestartAt = () => -10 * 60_000; // long expired

  const result = await pilot.runEpisode(world.deps);

  assert.ok(world.calls.includes("restart"), "an expired cooldown must not hold the world down");
  assert.equal(result.restarted, true);
}

async function main() {
  await testNudgeComesFirst();
  await testRestartOnlyAfterTheNudgeFails();
  await testNoRestartWhileTheAgentIsStillTrying();
  await testNoRestartForAnUnreachableAgent();
  await testAFailedRestartIsRetriedNotGivenUpOn();
  await testTheRestartIsUnreachableWithoutANudge();
  await testOnlyLockedOutStartsAnEpisode();
  await testThePilotWaitsForTheAgentsOwnBudget();
  await testTheGraceIsLongEnoughForTheRetryBudget();
  await testTheConnectTimeoutsAreShort();
  await testTheCooldownStandDownSaysWhy();
  await testTheCooldownExpiresAndTheWorldIsRestarted();

  console.log("  all pilot tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
