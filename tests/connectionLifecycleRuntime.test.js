const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Vec3 } = require("vec3");
// Replace only network creation and pathfinder setup. Both adapter lifecycle
// wiring and runtime private event bindings remain the production methods.
const pingPath = require.resolve("minecraft-protocol/src/ping");
require(pingPath);
require.cache[pingPath].exports = (_options, callback) => callback(null, { version: { name: "1.21.11", protocol: 774 } });
const mineflayer = require("mineflayer");
const pathfinder = require("mineflayer-pathfinder");
pathfinder.Movements = class {};
const { MinecraftBotAdapter } = require("../minecraft/bot");
const { AgentRuntime } = require("../agent/agentRuntime");
const silent = { info() {}, warn() {}, error() {} };
const DUPLICATE = "You logged in from another location";
const PAPER_DUPLICATE = { type: "compound", value: { translate: { type: "string", value: "multiplayer.disconnect.duplicate_login" } } };

async function fixture() {
  const bots = [];
  let nextConnection = "spawn";
  mineflayer.createBot = () => {
    const bot = new EventEmitter();
    Object.assign(bot, {
      username: "Guardian",
      entity: { position: new Vec3(0, 64, 0) },
      loadPlugin() {},
      pathfinder: { setGoal() {}, setMovements() {} },
      end: () => bot.emit("end")
    });
    bots.push(bot);
    setImmediate(() => {
      if (nextConnection === "spawn") bot.emit("spawn");
      else {
        bot.emit("kicked", nextConnection === "duplicate" ? PAPER_DUPLICATE : "Temporary server shutdown");
        bot.emit("end");
      }
    });
    return bot;
  };
  const adapter = new MinecraftBotAdapter({ username: "Guardian", primaryPlayer: "Panda_Nuggetz", host: "127.0.0.1", port: 25565, version: "1.21.11" }, silent);
  const runtime = new AgentRuntime({
    botAdapter: adapter, logger: silent, threadId: "test", primaryPlayer: "Panda_Nuggetz",
    messageStore: { ensureCharacter: async () => {}, countMessages: async () => 0 },
    eventStore: { getLatestAdventureSummary: async () => null },
    reconnectConfig: { maxAttempts: 3 }
  });
  runtime.initializeWorldContext = async () => {
    runtime.currentWorld = { world_id: "synthetic" };
    runtime.currentSession = { session_id: "synthetic-session" };
  };
  runtime.loadActiveIdentity = async () => {};
  runtime.ensureDefaultProfiles = async () => {};
  runtime.safeRecordEvent = async () => {};
  runtime.loopStarts = 0;
  runtime.loopStops = 0;
  runtime.startBackgroundLoops = () => { runtime.loopStarts++; };
  runtime.stopBackgroundLoops = () => { runtime.loopStops++; };
  runtime.runReflexScan = async () => [];
  runtime.computeReconnectDelay = () => 0;
  await runtime.start();
  return { runtime, adapter, bots, setNext: (mode) => { nextConnection = mode; } };
}

async function main() {
  {
    const { runtime, adapter, bots } = await fixture();
    const chats = [];
    let activity = 0;
    runtime.handleChat = async (payload) => chats.push(payload);
    runtime.reflexClassifier.markPrimaryActivity = () => { activity++; };
    bots[0].players = { ".Panda_Nuggetz": { entity: { position: new Vec3(2, 64, 0) } } };
    bots[0].emit("chat", ".Panda_Nuggetz", "hello");
    bots[0].emit("entityMoved", { username: ".Panda_Nuggetz", position: new Vec3(3, 64, 0) });
    assert.equal(chats[0].isPrimaryPlayer, true);
    assert.equal(chats[0].username, ".Panda_Nuggetz");
    assert.equal(activity, 2, "raw chat and movement both identify the Bedrock player");
    await adapter.disconnect();
    await runtime.reconnectInFlight;
  }
  for (const reason of [DUPLICATE, PAPER_DUPLICATE]) {
    const { runtime, bots } = await fixture();
    bots[0].emit("kicked", reason);
    bots[0].emit("end");
    await new Promise(setImmediate);
    assert.equal(runtime.duplicateSessionHalted, true);
    assert.equal(runtime.runtimeState.lifecycle, "halted", "end must preserve the halted status");
    assert.equal(runtime.runtimeState.connectionHealth, "duplicate_session");
    for (let count = 0; count < 25; count++) bots[0].emit("end");
    bots[0].emit("error", new Error("late error after halt"));
    await new Promise(setImmediate);
    assert.equal(bots.length, 1, "kicked plus repeated end must never reconnect");
    assert.equal(runtime.runtimeState.connectionHealth, "duplicate_session");
  }
  {
    const { runtime, bots } = await fixture();
    bots[0].emit("error", new Error("ECONNRESET"));
    bots[0].emit("end");
    await runtime.reconnectInFlight;
    assert.equal(bots.length, 2, "back-to-back loss events create exactly one replacement");
    assert.equal(runtime.runtimeState.lifecycle, "ready");
    assert.equal(runtime.loopStarts, 2, "recovery restarts background loops");
    bots[0].emit("end");
    assert.equal(runtime.botAdapter.bot, bots[1], "late end from old socket cannot discard the replacement");
    bots[0].emit("kicked", DUPLICATE);
    bots[0].emit("error", new Error("old socket error"));
    assert.equal(runtime.duplicateSessionHalted, false, "stale socket events cannot halt a healthy replacement");
  }
  {
    const { runtime, bots, setNext } = await fixture();
    setNext("duplicate");
    bots[0].emit("end");
    await runtime.reconnectInFlight;
    assert.equal(bots.length, 2, "duplicate during retry must halt before another attempt");
    assert.equal(runtime.runtimeState.lifecycle, "halted");
    assert.equal(runtime.duplicateSessionHalted, true);
  }
  {
    const { runtime, bots, setNext } = await fixture();
    setNext("drop");
    bots[0].emit("end");
    await runtime.reconnectInFlight;
    assert.equal(bots.length, 4, "initial connection plus the configured three attempts");
    assert.equal(runtime.runtimeState.reconnectState.attemptCount, 3);
    assert.equal(runtime.runtimeState.lifecycle, "error");
    assert.equal(runtime.runtimeUnavailable, true);
  }
  console.log("connection lifecycle runtime tests passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
