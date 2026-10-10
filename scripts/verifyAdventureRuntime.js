#!/usr/bin/env node
// Rehearse production runtime methods on an isolated cached Paper 1.21.11.
// All players, memory, and model responses are synthetic. This is not an iPad
// session, family-world test, persistence proof, or natural-language evaluation.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const net = require("node:net");
const { createHash } = require("node:crypto");
const { setTimeout: wait } = require("node:timers/promises");
const mineflayer = require("mineflayer");
const { AgentRuntime } = require("../agent/agentRuntime");
const { ActionExecutor } = require("../agent/actionExecutor");
const { MinecraftBotAdapter } = require("../minecraft/bot");

let context;
const results = [];
const logger = { info() {}, warn: (...args) => console.log("WARN", ...args), error: (...args) => console.log("ERROR", ...args) };
let paper;
let runtime;
let player;
let duplicate;
let log = "";
let closed;
let stopping = false;

async function until(label, predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (paper && paper.exitCode !== null && !stopping) throw new Error(`Paper exited during ${label}`);
    if (predicate()) return;
    await wait(50);
  }
  throw new Error(`Timed out: ${label}`);
}
function record(stage, evidence) {
  const result = { stage, at: new Date().toISOString(), evidence };
  results.push(result);
  console.log(JSON.stringify(result));
  fs.writeFileSync(path.join(context.directory, "results.json"), JSON.stringify(results, null, 2));
}
function command(text) {
  if (!paper || paper.exitCode !== null) throw new Error("No live test Paper process");
  paper.stdin.write(`${text}\n`);
}
function position(bot) {
  const p = bot.entity.position;
  return { x: p.x, y: p.y, z: p.z };
}
async function teleport(name, bot, x, y, z) {
  command(`tp ${name} ${x} ${y} ${z}`);
  await until(`teleport ${name}`, () => bot.entity?.position?.distanceTo({ x, y, z }) < 1);
}
function memoryFixture() {
  const messages = [];
  const events = [];
  const anchors = [];
  const recent = (rows, threadId, limit, options) => rows.filter((row) => row.thread_id === threadId && row.world_id === options.worldId).slice(-limit);
  return {
    anchors,
    surrealClient: { close: async () => {} },
    messageStore: {
      ensureCharacter: async () => {}, countMessages: async () => 0,
      storeMessage: async (m) => { messages.push({ ...m, thread_id: m.threadId, world_id: m.worldId, timestamp: new Date().toISOString() }); },
      getRecentMessages: async (t, l, o) => recent(messages, t, l, o)
    },
    eventStore: {
      recordEvent: async (e) => { const row = { ...e, thread_id: e.threadId, world_id: e.worldId, timestamp: new Date().toISOString() }; events.push(row); return row; },
      getRecentEvents: async (t, l, o) => recent(events, t, l, o),
      getLatestAdventureSummary: async () => null,
      getRecentAdventureSummaries: async () => [], getRecentReflexEvents: async () => [],
      findNearbyMemoryHints: async () => []
    },
    jobStore: {
      pauseRunningJobs: async () => [], getNextBuildJob: async () => null,
      getNextPendingReflexJob: async () => null, getActiveBuildJob: async () => null
    },
    worldStore: { getWorld: async () => ({}), upsertWorld: async (w) => ({ world_id: w.worldId, server_address: w.serverAddress, dimension: w.dimension }) },
    sessionStore: { createSession: async () => ({ session_id: "isolated-session" }), endSession: async () => {} },
    anchorStore: { createAnchor: async (a) => { anchors.push(a); return a; }, listAnchors: async () => anchors }
  };
}
async function cleanup() {
  if (stopping) return;
  stopping = true;
  try { await runtime?.stop(); } catch (e) { console.log("cleanup runtime:", e.message); }
  duplicate?.end();
  player?.end();
  if (paper && paper.exitCode === null) {
    paper.stdin.write("stop\n");
    let timer;
    try { await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Test Paper did not stop gracefully")), 20000); })]); }
    finally { clearTimeout(timer); }
  }
  if (context && (!paper || paper.exitCode !== null || paper.signalCode !== null)) {
    // Preserve the small receipt and console output, remove only this run's
    // cached binaries/worlds/config after its own child has stopped.
    for (const entry of fs.readdirSync(context.directory)) {
      if (!["proof-context.json", "results.json", "failure.txt", "console.log"].includes(entry)) fs.rmSync(path.join(context.directory, entry), { recursive: true, force: true });
    }
  }
}
process.once("SIGINT", () => { void cleanup().then(() => process.exit(130)); });


async function prepareIsolatedServer() {
  const root = path.resolve(__dirname, "..");
  const cached = path.join(root, "minecraft-server");
  const jar = path.join(cached, "paper-1.21.11-132.jar");
  for (const required of [jar, path.join(cached, "versions", "1.21.11", "paper-1.21.11.jar"), ...["libraries", "cache"].map((name) => path.join(cached, name))]) {
    assert.ok(fs.existsSync(required), `Missing cached Paper prerequisite: ${required}. This verifier never downloads a server.`);
  }
  const eula = fs.readFileSync(path.join(cached, "eula.txt"), "utf8");
  assert.match(eula, /^eula=true\s*$/m, "Paper EULA must already be accepted in the local installation.");
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const local = path.join(root, ".local");
  fs.mkdirSync(local, { recursive: true });
  const directory = fs.mkdtempSync(path.join(local, "campaign-adventure-proof-"));
  context = { directory, port, jar, sourceHashes: {}, syntheticPlayer: "CampaignPlayer", transport: "Java loopback; no Geyser or iPad", model: "synthetic; no provider request", memory: "in-memory fixture; persistence proved by verify:memory" };
  for (const file of ["minecraft/bot.js", "minecraft/playerIdentity.js", "agent/agentRuntime.js", "agent/actionExecutor.js", "agent/retrySignatures.js", "agent/presenceController.js", "survival/survivalController.js", "scripts/verifyAdventureRuntime.js"]) {
    context.sourceHashes[file] = createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex");
  }
  fs.writeFileSync(path.join(directory, "proof-context.json"), JSON.stringify(context, null, 2));
  // Copy only the cached installation binaries. Never copy worlds, plugins,
  // credentials, .env, or the Floodgate key.
  for (const name of ["libraries", "versions", "cache"]) {
    fs.cpSync(path.join(cached, name), path.join(directory, name), { recursive: true });
  }
  fs.writeFileSync(path.join(directory, "eula.txt"), eula);
  fs.writeFileSync(path.join(directory, "server.properties"), [
    `server-port=${port}`, "server-ip=127.0.0.1", "online-mode=false",
    "enforce-secure-profile=false", "level-name=campaign-test-world",
    "level-type=minecraft:flat",
    'generator-settings={"layers":[{"block":"minecraft:bedrock","height":1},{"block":"minecraft:dirt","height":2},{"block":"minecraft:grass_block","height":1}],"biome":"minecraft:plains"}',
    "generate-structures=false", "gamemode=survival", "difficulty=normal",
    "spawn-protection=0", "view-distance=3", "simulation-distance=3",
    "max-players=4", "enable-rcon=false", "enable-query=false",
    "management-server-enabled=false", "allow-nether=false", "pause-when-empty-seconds=-1", ""
  ].join("\n"));
  fs.mkdirSync(path.join(directory, "config"), { recursive: true });
  fs.writeFileSync(path.join(directory, "config", "paper-global.yml"), "_version: 31\nspark:\n  enabled: false\n");
}

async function main() {
  await prepareIsolatedServer();
  console.log("Starting isolated cached Paper", context.directory, context.port);
  const output = fs.createWriteStream(path.join(context.directory, "console.log"));
  paper = spawn("java", ["-Xms512M", "-Xmx1G", "-jar", context.jar, "--nogui"], { cwd: context.directory, stdio: ["pipe", "pipe", "pipe"] });
  closed = new Promise((resolve) => paper.once("close", resolve));
  paper.once("error", (e) => { log += `\n${e.message}`; });
  for (const stream of [paper.stdout, paper.stderr]) stream.on("data", (data) => { log += data.toString(); output.write(data); });
  await until("Paper startup", () => /Done \([^)]+\)!/.test(log), 90000);
  record("isolated Paper ready", { port: context.port, pid: paper.pid });
  command("time set day");
  command("gamerule minecraft:spawn_mobs false");
  command("kill @e[type=!minecraft:player]");
  command("forceload add -48 -48 48 48");
  command("fill -48 79 -48 48 79 48 minecraft:stone");
  command("setworldspawn 0 80 0");
  await until("test arena", () => /Successfully filled|No blocks were filled/.test(log));

  player = mineflayer.createBot({ host: "127.0.0.1", port: context.port, username: "CampaignPlayer", version: "1.21.11", auth: "offline" });
  const heard = [];
  player.on("chat", (name, message) => heard.push({ name, message }));
  player.on("error", (e) => console.log("player error:", e.message));
  await until("synthetic player spawn", () => player.entity?.position);
  command("gamemode creative CampaignPlayer");
  await teleport("CampaignPlayer", player, 0.5, 80, 0.5);
  const adapter = new MinecraftBotAdapter({ host: "127.0.0.1", port: context.port, username: "CampaignGuardian", primaryPlayer: "CampaignPlayer", version: "1.21.11", followDistance: 3 }, logger);
  const connect = adapter.connect.bind(adapter);
  let connectionAttempts = 0;
  adapter.connect = async () => { connectionAttempts++; return connect(); };
  const memory = memoryFixture();
  const executor = new ActionExecutor({ botAdapter: adapter, anchorStore: memory.anchorStore, primaryPlayer: "CampaignPlayer", companionName: "CampaignGuardian", getWorldContext: () => runtime.getWorldContext(), getPresenceController: () => runtime.presenceController });
  runtime = new AgentRuntime({ ...memory, botAdapter: adapter, actionExecutor: executor, threadId: "isolated-physics-proof", primaryPlayer: "CampaignPlayer", companionName: "CampaignGuardian", logger, llmClient: { complete: async () => ({ message: "Ready when you are.", action: { type: "chat" } }) }, summaryInterval: 100000, reconnectConfig: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 300 } });
  runtime.survivalController.setEnabled(false);
  const survivalReports = [];
  const onSurvivalEvent = runtime.survivalController.onEvent;
  runtime.survivalController.onEvent = (event) => {
    survivalReports.push(event);
    onSurvivalEvent?.(event);
  };
  runtime.runtimeState.liveConfig.narrativeReflexEnabled = false;
  await runtime.start();
  command("op CampaignGuardian");
  await teleport("CampaignGuardian", adapter.bot, 0.5, 80, 5.5);
  await until("visible primary player entity", () => adapter.getPlayerEntity("CampaignPlayer"));
  player.chat("hello there");
  await until("ordinary chat reply", () => heard.some((item) => item.name === "CampaignGuardian" && item.message === "Ready when you are."));
  record("ordinary chat", { replyObservedByPlayer: true, model: "synthetic, no provider request" });

  player.chat("follow me");
  await until("follow command", () => heard.some((item) => /On your heels/.test(item.message)));
  await teleport("CampaignPlayer", player, 15.5, 80, 0.5);
  await until("physical following", () => player.players.CampaignGuardian?.entity?.position.distanceTo(player.entity.position) < 5 && adapter.bot.entity.position.distanceTo(player.entity.position) < 5, 20000);
  record("follow", { distance: adapter.bot.entity.position.distanceTo(player.entity.position), serverObservedDistance: player.players.CampaignGuardian.entity.position.distanceTo(player.entity.position) });
  player.chat("stop following");
  await until("stop command", () => runtime.presenceController.explicitHold);
  await until("path stopped", () => !adapter.bot.pathfinder.isMoving());
  const held = adapter.bot.entity.position.clone();
  const serverHeld = player.players.CampaignGuardian.entity.position.clone();
  await teleport("CampaignPlayer", player, 28.5, 80, 0.5);
  const ticks = [];
  const tick = () => ticks.push(adapter.bot.entity.position.clone());
  adapter.bot.on("physicsTick", tick);
  await until("held position over physics ticks", () => ticks.length >= 30);
  adapter.bot.removeListener("physicsTick", tick);
  assert.ok(adapter.bot.entity.position.distanceTo(held) < 1, "stop must hold position");
  assert.ok(player.players.CampaignGuardian.entity.position.distanceTo(serverHeld) < 1, "server must observe Guardian staying stopped");
  record("stop following", { physicsTicks: ticks.length, movement: adapter.bot.entity.position.distanceTo(held), serverObservedMovement: player.players.CampaignGuardian.entity.position.distanceTo(serverHeld) });

  player.chat("tag this spot as the test camp");
  await until("location saved", () => memory.anchors.length === 1);
  await teleport("CampaignPlayer", player, 5.5, 80, 5.5);
  player.chat("take me back to the test camp");
  await until("real teleport recall", () => player.entity.position.x > 28 && player.entity.position.z < 1);
  record("location recall", { actualPlayerPosition: position(player), database: "in-memory fixture; persistence proved separately" });

  command("give CampaignGuardian minecraft:iron_sword");
  await until("weapon inventory", () => adapter.bot.inventory.items().some((item) => item.name === "iron_sword"));
  await teleport("CampaignGuardian", adapter.bot, 0.5, 80, 0.5);
  await until("server observes combat position", () => player.players.CampaignGuardian?.entity?.position.distanceTo({ x: 0.5, y: 80, z: 0.5 }) < 1);
  runtime.survivalController.setEnabled(true);
  let hurtMob = false;
  command("time set midnight");
  adapter.bot.on("entityHurt", (entity) => { if (entity.name === "zombie" && runtime.survivalController.activeAction === "fight") hurtMob = true; });
  command('summon minecraft:zombie 2.5 80 0.5 {NoAI:1b,PersistenceRequired:1b,Health:100.0f,Tags:["campaign_probe"]}');
  await until("server acknowledges zombie damage", () => hurtMob);
  const fleeStart = adapter.bot.entity.position.clone();
  const serverFleeStart = player.players.CampaignGuardian.entity.position.clone();
  const deathsBefore = runtime.survivalController.stats.deaths;
  command(`summon minecraft:creeper ${fleeStart.x + 3} 80 ${fleeStart.z} {PersistenceRequired:1b,Tags:["campaign_probe"]}`);
  await until("escape movement", () => survivalReports.some((event) => event.action === "fight" && event.outcome?.interrupted) && runtime.survivalController.stats.flees > 0 && adapter.bot.entity.position.distanceTo(fleeStart) > 8 && player.players.CampaignGuardian?.entity?.position.distanceTo(serverFleeStart) > 8, 10000);
  assert.equal(runtime.survivalController.stats.deaths, deathsBefore, "respawning elsewhere must not count as escape");
  assert.ok(adapter.bot.health > 0, "Guardian must be alive after escape");
  record("combat interrupted for creeper", { interruptedFightRecorded: true, actualEscapeDistance: adapter.bot.entity.position.distanceTo(fleeStart), serverObservedEscapeDistance: player.players.CampaignGuardian.entity.position.distanceTo(serverFleeStart), health: adapter.bot.health, deathCount: runtime.survivalController.stats.deaths });
  command('kill @e[tag=campaign_probe]');
  await until("survival relinquishes movement", () => !adapter.survivalLease, 10000);
  assert.ok(["forward", "back", "left", "right", "jump", "sprint", "sneak"].every((control) => adapter.bot.getControlState(control) === false));
  record("survival release", { controlsReleasedAfterThreatCleared: true });

  const original = adapter.bot;
  command("kick CampaignGuardian Controlled reconnect rehearsal");
  await until("live reconnect", () => adapter.bot && adapter.bot !== original && runtime.runtimeState.lifecycle === "ready", 20000);
  record("reconnect", { newConnection: true, attempts: runtime.runtimeState.reconnectState.attemptCount });
  duplicate = mineflayer.createBot({ host: "127.0.0.1", port: context.port, username: "CampaignGuardian", version: "1.21.11", auth: "offline" });
  duplicate.on("error", (e) => console.log("duplicate client:", e.message));
  await until("duplicate login halt", () => runtime.duplicateSessionHalted && runtime.runtimeState.lifecycle === "halted");
  const connectionCount = connectionAttempts;
  const noRetryWindowMs = runtime.computeReconnectDelay(3) + 500;
  await wait(noRetryWindowMs);
  assert.equal(connectionAttempts, connectionCount, "halt must not attempt another server login");
  record("duplicate login", { halted: true, connectionHealth: runtime.runtimeState.connectionHealth, guardianConnectionAttempts: connectionAttempts, noRetryWindowMs });
  console.log("PASS: isolated Java server rehearsal. This is not a Bedrock/iPad session or a natural-language quality test.");
}
main().then(cleanup).then(() => process.exit(0)).catch(async (error) => {
  console.error("FAIL:", error.message);
  console.error("Synthetic player visibility:", Boolean(runtime?.botAdapter?.getPlayerEntity("CampaignPlayer")));
  console.error("Recent test-server output:", log.slice(-2400));
  if (context) fs.writeFileSync(path.join(context.directory, "failure.txt"), error.stack || error.message);
  try { await cleanup(); } catch (cleanupError) { console.error(cleanupError.message); }
  process.exit(1);
});

