// scripts/worldState.js
//
// One rule for "is the world actually serving?"
//
// WHY THIS EXISTS
//
// A Minecraft server can stop ticking without exiting. Its JVM stays alive,
// it keeps holding the port, and a status ping answers perfectly — while not
// a single player can get in.
//
// That happened on 2026-11-25: the world went down at 01:48 and stayed down
// for nearly nine hours. Paper's watchdog noticed and wrote a thread dump
// (server thread TIMED_WAITING in MinecraftServer.runServer), and then the
// thread stayed parked forever. launchd could not see it, because KeepAlive
// restarts a job that EXITS and this job never exited.
//
// A STATUS PING CANNOT DETECT IT
//
// The server-list request is served OFF the main server thread, so it
// answers perfectly on a server that cannot let anyone in. Verified on the
// hung server: "PING OK -> version: Paper 1.21.11 players: 0".
//
// SO THE PROBE IS THE AGENT
//
// The agent is already a player. It is already trying to get in. And it
// already reports the difference, in `connectionHealth` and `lifecycle`.
//
// This module is the ONLY place that rule lives, because it was written
// twice — once in the pilot and once inline in guardian.sh — and the two
// copies disagreed: the first checked for a connectionHealth of "connected",
// which this agent never reports. The values are:
//
//   healthy             the bot is in the world
//   degraded            a bot error happened; it may well recover
//   disconnected        the connection ended
//   duplicate_session   another Guardian owns the world — NOT a broken world
//
// and lifecycle:
//
//   ready      in the world and working
//   booting    starting up
//   starting   starting up
//   reconnecting  trying to get back in after a drop
//   error      gave up after exhausting its reconnect attempts
//   halted     stopped on purpose (duplicate session)
//   paused / stopped / stopping
//
// THE VERDICTS
//
//   in_world    the world is serving
//   locked_out  the agent gave up trying to get in — the world is broken
//   recovering   the agent is still trying — leave it alone
//   unknown     the agent did not answer, or said something unexpected
//
// "recovering" is deliberately distinct from "locked_out". The agent has a
// retry budget, and it is right to use it: a Paper server that is booting
// normally leaves the agent reconnecting for thirty seconds, and restarting
// a healthy server that is still starting would be the pilot causing the
// outage it is meant to prevent.
//
// The agent only reaches "error" after exhausting its own attempts, so
// "locked_out" means the world has had its chance.

const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

// The control plane needs its bearer token. Loading .env here rather than
// in the caller means this module works the same whether it is required by
// the pilot or run directly from guardian.sh — and the version that ran
// directly reported "unknown" because the token was simply not there.
require("dotenv").config({ path: path.join(ROOT, ".env") });

const CONTROL_PORT = Number(process.env.GUARDIAN_CONTROL_PORT || 8787);
const CONTROL_URL = `http://127.0.0.1:${CONTROL_PORT}`;

/**
 * Classify the agent's view of the world.
 *
 * @param {object} state  the agent's runtime state
 * @returns {{verdict: string, reason: string}}
 */
function classify(state) {
  if (!state || typeof state !== "object") {
    return { verdict: "unknown", reason: "no state" };
  }

  const lifecycle = state.lifecycle;
  const connection = state.connectionHealth;

  // Another Guardian owns the world. That is not a broken world, and
  // restarting it would be exactly wrong.
  if (connection === "duplicate_session" || lifecycle === "halted") {
    return { verdict: "unknown", reason: "another session owns the world" };
  }

  if (connection === "healthy") {
    return { verdict: "in_world", reason: `lifecycle=${lifecycle}` };
  }

  // It gave up trying to get back in. The world is what failed it.
  if (lifecycle === "error" && connection === "disconnected") {
    return { verdict: "locked_out", reason: `lifecycle=${lifecycle} connection=${connection}` };
  }

  // Still trying. This is what a booting server looks like from in here.
  if (lifecycle === "reconnecting" || connection === "disconnected" || connection === "degraded") {
    return { verdict: "recovering", reason: `lifecycle=${lifecycle} connection=${connection}` };
  }

  if (lifecycle === "booting" || lifecycle === "starting") {
    return { verdict: "recovering", reason: `lifecycle=${lifecycle}` };
  }

  return { verdict: "unknown", reason: `lifecycle=${lifecycle} connection=${connection}` };
}

/**
 * Ask the agent what it sees of the world.
 *
 * @param {{token?: string, timeoutMs?: number}} options
 */
async function readVerdict({ token = process.env.GUARDIAN_CONTROL_TOKEN || "", timeoutMs = 8000 } = {}) {
  let response;

  try {
    response = await fetch(`${CONTROL_URL}/state`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    return { verdict: "unknown", reason: `the agent did not answer: ${error?.message || error}` };
  }

  if (!response.ok) {
    return { verdict: "unknown", reason: `the agent answered HTTP ${response.status}` };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return { verdict: "unknown", reason: "the agent answered with something unreadable" };
  }

  return classify(payload?.state || {});
}

// Run directly: print the verdict. This is how guardian.sh asks.
if (require.main === module) {
  readVerdict()
    .then((result) => {
      console.log(result.verdict);
      process.exit(0);
    })
    .catch(() => {
      console.log("unknown");
      process.exit(0);
    });
}

module.exports = {
  classify,
  readVerdict,
  CONTROL_URL
};
