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
    logger: { info() {}, warn() {}, error() {} },
    // One attempt, no backoff: the point here is the SHAPE of the failure,
    // not how long it takes to give up.
    reconnectConfig: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 }
  });

  // A failed connect must NOT be fatal.
  //
  // It used to be, and that broke the watchdog: the pilot watches the
  // agent's state to find out whether the world is serving, and an agent
  // that exits on a failed connect takes its own liveness signal with it.
  // A hung world then looks exactly like a dead agent, and nothing restarts
  // it. The agent has to survive the world being absent and say so.
  await runtime.start();

  assert.equal(runtime.runtimeState.lifecycle, "error",
    "a failed join leaves the agent reporting that it is not in the world");
  assert.equal(runtime.runtimeState.connectionHealth, "disconnected");
  assert.equal(runtime.readyForTurns, false,
    "an agent that is not in the world does not answer turns");

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
    // An unapproved player is now answered in the BOUNDED tier rather than
    // ignored. They get a warm reply, and nothing else: no child memory lane,
    // no saved places, no ability to make the companion act. They are neither
    // trusted nor silenced.
    assert.equal(runtime.shouldRespond({ username: "Other", message: "hello" }), true,
      "an unapproved player gets a bounded reply, not the full companion");
    assert.equal(runtime.resolveSpeakerTrustTier("Other"), "guest");
    assert.equal(runtime.resolveSpeakerTrustTier("Panda_Nuggetz"), "approved");
    // A mention still does not make them a known player, so it still cannot
    // reach the child's memory lane. It only reaches the guest's own scope.
    assert.equal(runtime.shouldObserve({ username: "Other", directMention: true }), true);
    assert.equal(runtime.isApprovedPlayer("Other"), false,
      "a mention does not grant access to the child's memory lane");
    assert.equal(runtime.getDirectCommand({ username: "Other", message: "follow me" }), null,
      "a guest still cannot issue direct commands");

    // Presence is not trust.
    //
    // On 2026-11-20 the trust list and the "who is online" list were the same
    // list, so any stranger who connected became trusted on the spot. That is
    // how an unapproved guest heard "The half-finished cabin was Panda's".
    runtime.botAdapter.bot.players.StrangerOnline = { entity: { position: new Vec3(5, 64, 0) } };
    assert.equal(runtime.isApprovedPlayer("StrangerOnline"), false,
      "being online does not make a player trusted");
    assert.ok(runtime.getKnownPlayers().includes("StrangerOnline"),
      "but they are still visible, so Guardian can address them");
    assert.equal(runtime.resolveSpeakerTrustTier("StrangerOnline"), "guest",
      "and they stay on the guest tier");

    // A second, known player is a full participant: they can use direct commands
    // and their messages stay in the conversation lane. Restricting this to the
    // primary player is what made a friend invisible and the bot seem aloof.
    runtime.companionPlayers = ["Panda_Nuggetz", ".Marallren"];
    assert.notEqual(runtime.getDirectCommand({ username: ".Marallren", message: "follow me" }), null,
      "a known second player may use direct commands");
    assert.equal(runtime.getDirectCommand({ username: "Stranger", message: "follow me" }), null,
      "an unknown player still cannot");
    assert.equal(runtime.shouldObserve({ username: ".Marallren", message: "hi" }), true);
    assert.ok(runtime.getKnownPlayers().includes(".Marallren"), "the roster names the second player");
    assert.ok(runtime.isApprovedPlayer(".Marallren"), "and resolves their Floodgate spelling");
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
