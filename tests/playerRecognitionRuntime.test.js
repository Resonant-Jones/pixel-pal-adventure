const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Vec3 } = require("vec3");
const { AgentRuntime } = require("../agent/agentRuntime");
const { ActionExecutor } = require("../agent/actionExecutor");
const { captureWorldSnapshot } = require("../minecraft/worldSnapshot");
const { matchesPlayerName } = require("../minecraft/playerIdentity");

async function fixture(serverName) {
  const adapter = new EventEmitter();
  const player = { position: new Vec3(20, 64, 0) };
  adapter.config = { username: "Guardian", primaryPlayer: "Panda_Nuggetz" };
  adapter.bot = { entity: { position: new Vec3(0, 64, 0) }, players: { [serverName]: { entity: player } } };
  adapter.getSnapshot = () => captureWorldSnapshot(adapter.bot, { focusPlayer: "Panda_Nuggetz" });
  adapter.followed = [];
  adapter.said = [];
  adapter.followPlayer = async (name) => { adapter.followed.push(name); };
  adapter.stopFollowing = async () => {};
  adapter.say = async (message) => { adapter.said.push(message); };
  // start() installs the actual private event bindings before connecting.
  // Stop there so this regression needs neither a server nor credentials.
  adapter.connect = async () => { throw new Error("fixture connection boundary"); };
  const observed = [];
  let runtime;
  const executor = new ActionExecutor({
    botAdapter: adapter,
    primaryPlayer: "Panda_Nuggetz",
    getPresenceController: () => runtime.presenceController
  });
  runtime = new AgentRuntime({
    botAdapter: adapter,
    actionExecutor: executor,
    threadId: "test:player",
    primaryPlayer: "Panda_Nuggetz",
    messageStore: { storeMessage: async (message) => observed.push(message) },
    eventStore: { recordEvent: async () => {} },
    logger: { info() {}, warn() {}, error() {} }
  });
  await assert.rejects(runtime.start(), /fixture connection boundary/);
  runtime.readyForTurns = true;
  runtime.storeCompanionResponse = async () => {};
  runtime.maybeDistillAdventure = async () => {};
  runtime.reasoned = [];
  runtime.processTurn = async (payload) => { runtime.reasoned.push(payload.message); };
  const errors = [];
  runtime.handleTurnError = async (error) => errors.push(error);
  async function chat(message) {
    adapter.emit("chat", { username: serverName, message, directMention: false });
    // Drain asynchronous storage and the turn queue, without timing sleeps.
    await new Promise(setImmediate);
    await runtime.turnQueue;
    assert.deepEqual(errors, []);
  }
  return { runtime, adapter, observed, chat };
}

async function main() {
  for (const name of ["Panda_Nuggetz", ".Panda_Nuggetz", "*Panda_Nuggetz"]) {
    const { runtime, adapter, observed, chat } = await fixture(name);
    await chat("hello there");
    assert.deepEqual(runtime.reasoned, ["hello there"]);
    assert.equal(adapter.said.length, 1, "greet once without a model call");
    assert.equal(observed[0].speaker, name, "preserve the server name as evidence");
    assert.equal(adapter.getSnapshot().player_state.visible, true);
    assert.equal(adapter.getSnapshot().player_state.server_name, name);
    assert.deepEqual(adapter.getSnapshot().player_state.position, { x: 20, y: 64, z: 0 });
    assert.equal(await runtime.presenceController.tick(), true, "automatic following resolves aliases");
    await chat("stop following");
    assert.equal(runtime.presenceController.holding, true);
    runtime.presenceController.beginTask();
    runtime.presenceController.endTask();
    assert.equal(runtime.presenceController.holding, true, "task completion preserves the player's explicit stop");
    assert.equal(await runtime.presenceController.tick(), false, "stop remains in effect");
    await chat("follow me");
    assert.equal(runtime.presenceController.holding, false);
    assert.equal(adapter.followed.at(-1), "Panda_Nuggetz");
    assert.deepEqual(runtime.reasoned, ["hello there"], "direct commands bypass reasoning");
    assert.equal(adapter.said.filter((text) => text.startsWith("Hi ")).length, 1);
    assert.equal(runtime.getDirectCommand({ username: "Other", message: "follow me" }), null);
    assert.equal(runtime.shouldRespond({ username: "Other", message: "hello" }), false);
    assert.equal(runtime.shouldObserve({ username: "Other", directMention: true }), false, "a mention does not grant access to the child's memory lane");
    // Run one ordinary turn through the actual context -> model -> executor
    // path. The model here is synthetic; this makes no provider API request.
    runtime.currentWorld = { world_id: "synthetic-world" };
    runtime.currentSession = { session_id: "synthetic-session" };
    runtime.messageStore.getRecentMessages = async () => [];
    runtime.eventStore.getRecentEvents = async () => [];
    runtime.eventStore.getRecentAdventureSummaries = async () => [];
    runtime.eventStore.getRecentReflexEvents = async () => [];
    let modelCalls = 0;
    runtime.llmClient = { complete: async () => {
      modelCalls++;
      return { message: "Ready when you are.", action: { type: "chat" } };
    } };
    runtime.processTurn = AgentRuntime.prototype.processTurn;
    await chat("hello again");
    assert.equal(modelCalls, 1);
    assert.equal(adapter.said.at(-1), "Ready when you are.");
  }
  const bot = { players: { Panda_Nuggetz: {}, ".Panda_Nuggetz": {} } };
  assert.equal(matchesPlayerName(bot, "Panda_Nuggetz", ".Panda_Nuggetz"), false);
  assert.equal(matchesPlayerName(bot, "Panda_Nuggetz", "Panda_Nuggetz"), true);
  assert.equal(matchesPlayerName({ players: {} }, "Panda_Nuggetz", ".Panda_Nuggetz"), true);
  assert.equal(matchesPlayerName(bot, "Panda_Nuggetz", ""), false);
  console.log("player recognition runtime tests passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
