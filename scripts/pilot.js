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
// serving me", and it already reports it: `connectionHealth` and
// `lifecycle` in the control plane's state.
//
// The rule this program implements:
//
//   the agent is ALIVE and cannot join the world  →  the world is broken
//   the agent is DEAD                                →  launchd's problem
//
// Which means this program never restarts the agent, and never restarts
// Paper because the agent is unhealthy. It only acts when the agent is
// demonstrably alive and demonstrably locked out.
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

const CONTROL_URL = `http://127.0.0.1:${process.env.GUARDIAN_CONTROL_PORT || 8787}`;
const TOKEN = process.env.GUARDIAN_CONTROL_TOKEN || "";
const PAPER_LABEL = "com.guardian.paper";
const DOMAIN = `gui/${process.env.GUARDIAN_UID || process.getuid()}`;

const CHECK_INTERVAL_MS = 60_000;
// How many consecutive bad checks before acting. The agent retries on its own
// schedule, and a single failed check is usually just a server restarting.
const MISSES_BEFORE_RESTART = 3;
// After restarting Paper, it needs time to boot and the agent needs time to
// get back in. Checking during that window would restart it again.
const RESTART_COOLDOWN_MS = 10 * 60_000;

let misses = 0;
let lastRestartAt = 0;

function log(message) {
  console.log(`[pilot] ${message}`);
}

async function readAgentState() {
  const response = await fetch(`${CONTROL_URL}/state`, {
    headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
    signal: AbortSignal.timeout(8000)
  });

  if (!response.ok) {
    return { reachable: false, reason: `HTTP ${response.status}` };
  }

  const payload = await response.json();
  return { reachable: true, state: payload?.state || {} };
}

// The agent is healthy when it is connected to the world and its lifecycle
// is not an error. Both signals are checked because they can disagree: a
// reconnection in progress has a good connection and a stale lifecycle.
function agentIsLockedOut(state) {
  const connection = state?.connectionHealth;
  const lifecycle = state?.lifecycle;

  if (connection === "connected") {
    return false;
  }

  return lifecycle === "error" || connection === "disconnected" || connection === "reconnecting";
}

function restartPaper(reason) {
  log(`the world is not serving the agent (${reason}) — restarting ${PAPER_LABEL}`);

  const result = spawnSync("launchctl", ["kickstart", "-k", `${DOMAIN}/${PAPER_LABEL}`], {
    encoding: "utf8"
  });

  if (result.status === 0) {
    log(`restarted ${PAPER_LABEL}`);
  } else {
    log(`could not restart ${PAPER_LABEL}: ${(result.stderr || result.stdout || "").trim() || `exit ${result.status}`}`);
  }

  lastRestartAt = Date.now();
  misses = 0;
}

async function tick() {
  let reading;

  try {
    reading = await readAgentState();
  } catch (error) {
    // The agent is not answering. That is the agent's problem, and launchd's
    // job for it — restarting the world because the agent is down would be
    // restarting the wrong thing.
    log(`the agent is not answering (${error?.message || error}) — leaving the world alone`);
    misses = 0;
    return;
  }

  if (!reading.reachable) {
    log(`the agent's control plane is not reachable (${reading.reason}) — leaving the world alone`);
    misses = 0;
    return;
  }

  const state = reading.state;

  if (!agentIsLockedOut(state)) {
    if (misses > 0) {
      log(`the agent is back in the world`);
      misses = 0;
    }
    return;
  }

  misses += 1;
  log(`the agent is alive but locked out (${misses}/${MISSES_BEFORE_RESTART}) — connection=${state.connectionHealth} lifecycle=${state.lifecycle}`);

  if (misses < MISSES_BEFORE_RESTART) {
    return;
  }

  if (Date.now() - lastRestartAt < RESTART_COOLDOWN_MS) {
    return;
  }

  restartPaper(`connection=${state.connectionHealth} lifecycle=${state.lifecycle}`);
}

log(`watching the world through the agent — checking every ${CHECK_INTERVAL_MS / 1000}s`);

(async () => {
  // Give the agent a moment to come up before judging it.
  await new Promise((resolve) => setTimeout(resolve, 30_000));
  await tick();
  setInterval(() => {
    tick().catch((error) => log(`check failed: ${error?.message || error}`));
  }, CHECK_INTERVAL_MS);
})();
