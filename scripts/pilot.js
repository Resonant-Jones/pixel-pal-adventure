#!/usr/bin/env node

// scripts/pilot.js
//
// Keeps the world alive.
//
// THE PROBLEM THIS EXISTS TO SOLVE
//
// A Minecraft server can stop ticking without exiting. Its own watchdog
// notices — "The server has not responded for X seconds!" — and writes a
// thread dump, and then the server thread stays parked forever. The JVM is
// still alive and still holding the port.
//
// launchd cannot see that. `KeepAlive` restarts a job that EXITS, and this
// job never exits. So the world goes down and stays down, with every port
// open and nothing wrong to look at.
//
// That is not hypothetical. On 2026-11-25 the world went down at 01:48 and
// stayed down for nearly nine hours. Paper's watchdog fired at 01:48 and
// again at 02:18; the server thread was parked in
// MinecraftServer.runServer → recordTaskExecutionTimeWhileWaiting →
// LockSupport.parkNanos and never came back. The console connected the
// whole time. The agent could not get in.
//
// A STATUS PING CANNOT DETECT THIS
//
// The server-list request is served OFF the main server thread, so it
// answers perfectly even when the server cannot let a single player in.
// Verified on the hung server: `ping` returned "Paper 1.21.11, players: 0"
// while the world was unreachable and Guardian was being turned away.
//
// SO THE PROBE IS THE AGENT
//
// The agent is already a player. It is already trying to get in. It already
// knows the difference between "the world is fine" and "the world is not
// serving me", and it already reports it.
//
// The rule lives in scripts/worldState.js, because it was written twice
// before — once here and once inline in guardian.sh — and the two copies
// disagreed. One of them looked for a connectionHealth of "connected",
// which this agent never reports.
//
// THE RULE
//
//   the agent is ALIVE and gave up trying to get in  →  the world is broken
//   the agent is ALIVE and still trying              →  leave it alone
//   the agent is DEAD                                →  launchd's problem
//
// "Still trying" is deliberately separate from "gave up". The agent has a
// retry budget and it is right to use it: a Paper server that is booting
// normally leaves the agent reconnecting for thirty seconds, and restarting
// a healthy server that is still starting would be the pilot causing the
// outage it is meant to prevent.
//
// TWO ACTIONS, AND THE ORDER MATTERS
//
// The agent, having exhausted its own reconnect attempts, STAYS OUT. Its
// reconnect machinery only runs again when something asks it to. Nothing
// does, on its own.
//
// So the pilot has to ask. But asking and restarting the world are very
// different in weight:
//
//   1. NUDGE. Ask the agent to try again, through the control plane's
//      existing `/command/reconnect`. Cheap. If the world was merely
//      awkward for a moment, this is enough and nothing is disturbed.
//
//   2. RESTART THE WORLD. Only if nudging did not work. This is the
//      expensive one, and it is the only one that can fix a server whose
//      main thread has stopped.
//
// Doing them in that order matters: nudging first means a transient
// hiccup costs nothing but a request, and the world is only restarted when
// it is genuinely not serving.
//
// RESTARTING PAPER IS NOT SOMETHING THE AGENT CAN DO
//
// The agent runs in the same sandbox as everything else. `launchctl
// kickstart` needs a real user session, so this program runs as its own
// launchd job, outside the agent's sandbox, where it can.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");

require("dotenv").config({ path: path.join(ROOT, ".env") });

const { readVerdict } = require("./worldState");

const PAPER_LABEL = "com.guardian.paper";
const DOMAIN = `gui/${process.env.GUARDIAN_UID || process.getuid()}`;

const CHECK_INTERVAL_MS = 60_000;
// How long to let a nudge work before concluding the world is at fault.
//
// This has to cover the agent's OWN retry budget, because the nudge starts
// a fresh one. The agent makes `maxAttempts` attempts (5 by default), each
// one costing a connect timeout plus a backoff, so its budget runs for a
// couple of minutes. If the pilot stopped waiting sooner, it would see the
// agent still "recovering" and stand down — and because the nudge resets
// that budget, the agent would never reach "locked out" again and the world
// would never be restarted.
//
// Four minutes was that budget plus slack, and the slack turned out to be
// too thin.
//
// Measured on 2026-11-25 against a Paper server frozen with SIGSTOP: the
// agent's budget after a nudge ran 2m32s (five attempts at ~30s each — a
// status ping that times out at 10s, plus a handshake that times out at
// 20s). The theoretical worst case, with the backoff jittered to its
// maximum, is 4m04s — which is LONGER than the four-minute grace.
//
// And that is not a cosmetic overrun. If the grace expires while the agent
// is still "recovering", the pilot stands down. The next episode nudges
// again, which resets the budget, which puts the agent back in
// "recovering". The deadlock this whole design exists to avoid comes
// straight back, and it comes back silently.
//
// Six minutes puts a full minute of slack under the worst case. It costs
// nothing in the normal path, because the wait ends the moment the agent
// gives up rather than running to the full grace.
const NUDGE_GRACE_MS = 6 * 60_000;
// How long to wait for the world to come back and take the agent with it.
const RECOVERY_TIMEOUT_MS = 5 * 60_000;
// After a world restart, leave it alone for a while.
const RESTART_COOLDOWN_MS = 10 * 60_000;
// Consecutive checks that must agree before an episode starts. One is usually
// just a server that is restarting.
const MISSES_BEFORE_ACTION = 2;

let misses = 0;
let lastRestartAt = 0;
let episode = null;

function log(message) {
  console.log(`[pilot] ${message}`);
}

// --- the two actions -------------------------------------------------------
//
// Both are separate functions so the whole pilot can be exercised against
// fakes. The behaviour that matters is the ORDER and the CONDITIONS, and
// neither is testable if the actions are buried in a loop.

// Tell the agent to try to get back in.
//
// The agent gave up. Its reconnect loop only runs when something asks it to,
// and the only thing that asks it to is a connection-loss event or this
// command. Without this the world comes back and Guardian does not, which
// looks exactly like the watchdog failing.
async function nudgeAgent(reason = "pilot_world_restarted") {
  const token = process.env.GUARDIAN_CONTROL_TOKEN || "";
  const port = process.env.GUARDIAN_CONTROL_PORT || 8787;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/command/reconnect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ reason }),
      signal: AbortSignal.timeout(8000)
    });

    const ok = response.status === 200;
    log(`asked the agent to try again — ${ok ? "ok" : `HTTP ${response.status}`}`);
    return ok;
  } catch (error) {
    log(`could not reach the agent to ask it to try again: ${error?.message || error}`);
    return false;
  }
}

// Restart the world.
//
// This is the expensive action, and it only happens when nudging has failed.
//
// Two launchctl steps, because "kickstart" alone is not enough. The job has
// to be LOADED before it can be kicked, and it is quite possible for it not
// to be: a server started by hand, a job that was booted out, a machine
// that came back from a sleep with a half-loaded domain.
//
// This is not hypothetical. On 2026-11-25 the pilot detected a hung world,
// nudged the agent, decided the world was broken, and then tried to restart
// a job that was not loaded:
//
//   could not restart com.guardian.paper: Could not find service
//   "com.guardian.paper" in domain for user gui: 501
//
// So: bootstrap if it is missing, then kickstart. The kickstart is what
// stops the old instance and starts a new one; the bootstrap is what makes
// the job exist to be kicked.
function restartPaper(reason) {
  log(`the world is not serving the agent (${reason}) — restarting ${PAPER_LABEL}`);

  const domain = DOMAIN;

  if (!jobIsLoaded(domain, PAPER_LABEL)) {
    const plist = path.join(ROOT, "scripts", `${PAPER_LABEL}.plist`);

    if (!fs.existsSync(plist)) {
      log(`could not restart ${PAPER_LABEL}: ${plist} is missing`);
      return false;
    }

    const bootstrap = spawnSync("launchctl", ["bootstrap", domain, plist], { encoding: "utf8" });

    if (bootstrap.status !== 0) {
      log(
        `could not load ${PAPER_LABEL}: ${
          (bootstrap.stderr || bootstrap.stdout || "").trim() || `exit ${bootstrap.status}`
        }`
      );
      return false;
    }

    log(`loaded ${PAPER_LABEL}`);
  }

  const result = spawnSync("launchctl", ["kickstart", "-k", `${domain}/${PAPER_LABEL}`], {
    encoding: "utf8"
  });

  if (result.status === 0) {
    log(`restarted ${PAPER_LABEL}`);
    return true;
  }

  log(
    `could not restart ${PAPER_LABEL}: ${
      (result.stderr || result.stdout || "").trim() || `exit ${result.status}`
    }`
  );
  return false;
}

// Is this launchd job loaded in the domain?
function jobIsLoaded(domain, label) {
  const result = spawnSync("launchctl", ["print", `${domain}/${label}`], { encoding: "utf8" });
  return result.status === 0;
}

// --- the recovery episode --------------------------------------------------

// One episode of getting the agent back in.
//
//   nudge → wait → if still out, restart the world → wait → nudge → wait
//
// The point of nudging first is that it is free, and it fixes the common
// case where the agent gave up on a world that was merely slow to answer.
//
// The dependencies are injectable so the ORDER can be tested without a
// launchd job and without a running world. That order is the thing worth
// proving: nudge first, restart only if the nudge did not work.
async function runEpisode(deps = {}) {
  const {
    read: read = readVerdict,
    nudge = nudgeAgent,
    restart = restartPaper,
    now = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    graceMs = NUDGE_GRACE_MS,
    recoveryMs = RECOVERY_TIMEOUT_MS,
    cooldownMs = RESTART_COOLDOWN_MS,
    // When the world was last restarted. Injectable so the cooldown can be
    // exercised without waiting ten minutes for a real one to expire.
    getLastRestartAt = () => lastRestartAt,
    setLastRestartAt = (value) => {
      lastRestartAt = value;
    }
  } = deps;

  const started = now();
  log("the agent has given up trying to get in — asking it to try once more");

  await nudge("pilot_nudge");

  // Wait for the nudge to finish its story.
  //
  // The nudge starts the agent's OWN retry budget, and that budget has two
  // possible endings: the agent gets back in, or it spends every attempt
  // and gives up again. Both are worth waiting for.
  //
  // "recovering" in the middle means the agent is still working through its
  // attempts — that is NOT a reason to stop waiting, and it is NOT a reason
  // to give up on the world either. It is the nudge doing its job.
  //
  // The old logic stood down on "recovering", which was a deadlock: the
  // nudge resets the retry budget, so the agent never reaches "locked out"
  // again, so the pilot never restarts the world, so the agent stays out.
  const graceDeadline = now() + graceMs;

  while (now() < graceDeadline) {
    await sleep(5000);

    const verdict = await read();

    if (verdict.verdict === "in_world") {
      log("the agent is back in the world — no restart was needed");
      return { restarted: false, recovered: true };
    }

    // The agent spent its whole budget and still cannot get in. The world
    // is what is broken.
    if (verdict.verdict === "locked_out") {
      break;
    }
  }

  // Re-read after the loop, so the decision uses the latest state.
  const verdict = await read();

  if (verdict.verdict === "in_world") {
    log("the agent is back in the world — no restart was needed");
    return { restarted: false, recovered: true };
  }

  if (verdict.verdict === "recovering") {
    // Still working through its attempts when the grace ran out. That is not
    // a failure and not a success — the next tick will pick this up again.
    log("the agent is still trying — standing down for now");
    return { restarted: false, recovered: false };
  }

  // "unknown" means the agent could not be reached at all — it is not
  // answering, or another session owns the world. That is NOT evidence that
  // the world is broken, and restarting it here would be restarting the
  // wrong thing on no evidence at all.
  if (verdict.verdict !== "locked_out") {
    log(`${verdict.verdict} — leaving the world alone`);
    return { restarted: false, recovered: false };
  }

  log("the agent is still out — the world is what is broken");

  // The cooldown exists so a world that keeps dying cannot be restarted
  // every minute. But it must never be a SILENT stand-down: an operator
  // reading the log has to be able to tell the difference between "the
  // pilot decided to wait" and "the pilot forgot".
  //
  // This is not theoretical. It is what happened on 2026-11-25 at 13:18:40,
  // when a restart nine minutes earlier was still inside the cooldown: the
  // pilot logged that the world was broken and then said nothing at all for
  // four minutes, which looks exactly like a watchdog that has given up.
  const sinceRestart = now() - getLastRestartAt();

  if (sinceRestart < cooldownMs) {
    const waitSeconds = Math.ceil((cooldownMs - sinceRestart) / 1000);
    log(
      `not restarting yet — the world was restarted ${Math.round(sinceRestart / 1000)}s ago ` +
        `and the cooldown is ${Math.round(cooldownMs / 1000)}s. Trying again in ${waitSeconds}s.`
    );
    return { restarted: false, recovered: false };
  }

  if (!restart(verdict.reason)) {
    // The restart failed. Try again on the next tick rather than waiting a
    // full cooldown for a failure that may have been transient.
    return { restarted: false, recovered: false };
  }

  setLastRestartAt(now());

  // The world needs time to boot. Nudge again once it is up — but do not
  // hammer the endpoint while Paper is still starting.
  const recoveryDeadline = now() + recoveryMs;

  while (now() < recoveryDeadline) {
    await sleep(5000);

    const state = await read();

    if (state.verdict === "in_world") {
      log("the world is back and the agent is in it");
      return { restarted: true, recovered: true };
    }

    // Keep nudging, but not in a tight loop — the agent's own reconnect
    // takes a while, and hammering the endpoint would just queue reconnects.
    //
    // Nudge on "locked_out" and on "recovering" both. After a restart the
    // agent is usually "recovering" — it is working through a fresh retry
    // budget against a world that is still booting — and waiting for it to
    // reach "locked_out" first would waste the whole budget before it ever
    // tried the new server.
    if (state.verdict === "locked_out" || state.verdict === "recovering") {
      await nudge("pilot_world_restarted");
    }
  }

  log(`the world came back but the agent has not rejoined yet (${Math.round((now() - started) / 1000)}s)`);
  return { restarted: true, recovered: false };
}

// --- the main loop ---------------------------------------------------------

async function tick() {
  // Do not start a second episode while one is running.
  if (episode) {
    return;
  }

  const verdict = await readVerdict();

  if (verdict.verdict === "in_world") {
    if (misses > 0) {
      log("the agent is back in the world");
      misses = 0;
    }
    return;
  }

  if (verdict.verdict === "recovering") {
    // The agent is still trying to get in. A server that is booting looks
    // exactly like this. Leave it alone.
    if (misses > 0) {
      log(`the agent is back to trying (${verdict.reason})`);
      misses = 0;
    }
    return;
  }

  if (verdict.verdict === "unknown") {
    // The agent is not answering, or another session owns the world. Either
    // way it is not the world's fault, and restarting the world would be
    // restarting the wrong thing.
    log(`${verdict.reason} — leaving the world alone`);
    misses = 0;
    return;
  }

  // locked_out.
  misses += 1;
  log(`the agent gave up trying to get in (${misses}/${MISSES_BEFORE_ACTION}) — ${verdict.reason}`);

  if (misses < MISSES_BEFORE_ACTION) {
    return;
  }

  misses = 0;

  episode = runEpisode().catch((error) => {
    log(`the recovery attempt failed: ${error?.message || error}`);
    return { restarted: false, recovered: false };
  });

  await episode;
  episode = null;
}

async function main() {
  log(`watching the world through the agent — checking every ${CHECK_INTERVAL_MS / 1000}s`);

  // Give the agent a moment to come up before judging it.
  await new Promise((resolve) => setTimeout(resolve, 30_000));
  await tick();

  setInterval(() => {
    tick().catch((error) => log(`check failed: ${error?.message || error}`));
  }, CHECK_INTERVAL_MS);
}

if (require.main === module) {
  main().catch((error) => {
    log(`the pilot stopped: ${error?.message || error}`);
    process.exit(1);
  });
}

module.exports = {
  nudgeAgent,
  restartPaper,
  runEpisode,
  tick,
  DOMAIN,
  PAPER_LABEL,
  MISSES_BEFORE_ACTION,
  NUDGE_GRACE_MS,
  RECOVERY_TIMEOUT_MS,
  RESTART_COOLDOWN_MS
};
