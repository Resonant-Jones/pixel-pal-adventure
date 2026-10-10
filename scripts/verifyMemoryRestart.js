#!/usr/bin/env node
// Isolated persistence proof with synthetic data. Never opens the family's DB
// or Minecraft world. Requires the installed SurrealDB executable.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { setTimeout: wait } = require("node:timers/promises");
const { SurrealClient } = require("../memory/surrealClient");
const { AnchorStore } = require("../memory/anchorStore");
const { JobStore } = require("../memory/jobStore");
const { ActionExecutor } = require("../agent/actionExecutor");

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function main() {
  const local = path.resolve(__dirname, "..", ".local");
  await fs.mkdir(local, { recursive: true });
  const directory = await fs.mkdtemp(path.join(local, "campaign-memory-proof-"));
  const port = await availablePort();
  let child = null;
  let client = null;
  let exitPromise = null;
  const config = { url: `http://127.0.0.1:${port}`, namespace: "campaign_test", database: "synthetic", username: "test", password: "test" };
  async function start() {
    let failure;
    child = spawn("surreal", ["start", "--bind", `127.0.0.1:${port}`, "--user", "test", "--pass", "test", "--default-namespace", config.namespace, "--default-database", config.database, `surrealkv://${path.join(directory, "db")}`], { stdio: ["ignore", "ignore", "ignore"] });
    child.once("error", (error) => { failure = error; });
    exitPromise = new Promise((resolve) => child.once("close", resolve));
    for (let attempt = 0; attempt < 100; attempt++) {
      if (failure) throw failure;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error("Isolated SurrealDB exited before readiness.");
      try {
        const response = await fetch(`${config.url}/health`, { signal: AbortSignal.timeout(500) });
        if (response.ok) return;
      } catch (_) { /* wait for this specific child */ }
      await wait(100);
    }
    throw new Error("Isolated SurrealDB did not become ready.");
  }
  async function stop() {
    if (client) { await client.close(); client = null; }
    if (!child) return;
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    let timeout;
    try {
      await Promise.race([exitPromise, new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Isolated DB has not stopped; preserving its test directory.")), 10000);
      })]);
      child = null;
    } finally { clearTimeout(timeout); }
  }
  const silent = { info() {}, warn() {}, error() {} };
  let savedJobId;
  try {
    await start();
    client = new SurrealClient(config, silent);
    const anchors = new AnchorStore(client);
    const jobs = new JobStore(client);
    const context = { worldId: "synthetic-world", sessionId: "first-session", threadId: "synthetic-player-thread" };
    const teleports = [];
    const botAdapter = {
      bot: { game: { dimension: "overworld" } },
      getPlayerEntity: () => ({ position: { x: 100, y: 65, z: -200 } }),
      say: async () => {},
      teleportPlayer: async (username, position) => { teleports.push({ username, position }); return { teleported: true }; }
    };
    const executor = () => new ActionExecutor({ botAdapter, anchorStore: new AnchorStore(client), getWorldContext: () => context, primaryPlayer: "SyntheticPlayer" });
    await executor().execute({ action: { type: "tag_location", label: "diamond cave" } });
    // Competing exact labels must not override the intended player's memory.
    for (const [worldId, taggedBy, threadId] of [
      [context.worldId, "AnotherPlayer", context.threadId],
      ["another-world", "SyntheticPlayer", context.threadId],
      [context.worldId, "SyntheticPlayer", "another-thread"]
    ]) {
      await anchors.createAnchor({ worldId, label: "diamond cave", type: "point", source: "player_tag", payload: { taggedBy, threadId, dimension: "overworld", position: { x: 999, y: 65, z: 999 } } });
    }
    const job = await jobs.createJob({ ...context, type: "build_structure", payload: { current_index: 7 } });
    savedJobId = String(job.id);
    await jobs.markRunning(savedJobId);
    await stop();
    await start();
    client = new SurrealClient(config, silent);
    context.sessionId = "after-restart";
    const result = await executor().execute({ action: { type: "goto_location", label: "diamond cave" } });
    assert.equal(result.anchor.found, true);
    assert.deepEqual(teleports, [{ username: "SyntheticPlayer", position: { x: 100, y: 65, z: -200 } }]);
    const restartedJobs = new JobStore(client);
    const paused = await restartedJobs.pauseRunningJobs(context.worldId);
    assert.equal(paused.length, 1);
    assert.equal(String(paused[0].id), savedJobId);
    assert.equal(paused[0].payload.current_index, 7);
    const resumable = await restartedJobs.getNextBuildJob(context.worldId);
    assert.equal(String(resumable.id), savedJobId);
    botAdapter.bot.game.dimension = "the_nether";
    await assert.rejects(executor().execute({ action: { type: "goto_location", label: "diamond cave" } }), /another dimension/);
    assert.equal(teleports.length, 1);
    console.log("PASS: synthetic location survives a real isolated SurrealDB restart.");
    console.log("PASS: player, thread, world and dimension boundaries hold; running build checkpoints survive restart.");
    console.log("This proves database persistence and action routing, not live Minecraft teleportation or an iPad session.");
  } finally {
    await stop();
    if (!child) await fs.rm(directory, { recursive: true, force: true });
  }
}
main().then(() => process.exit(0)).catch((error) => { console.error(`Memory proof failed: ${error.message}`); process.exit(1); });
