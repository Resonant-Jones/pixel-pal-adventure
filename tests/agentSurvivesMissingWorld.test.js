const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { AgentRuntime } = require("../agent/agentRuntime");
const { ActionExecutor } = require("../agent/actionExecutor");

// The agent must SURVIVE a world that is not there.
//
// WHY THIS MATTERS MORE THAN IT LOOKS
//
// The pilot — the watchdog that notices a hung Minecraft server — watches
// the agent's state to find out whether the world is serving. That works
// because the agent is a player: it is already trying to get in, and it
// already reports the difference between "the world is fine" and "the world
// is not serving me".
//
// But a failed connect used to be FATAL. The agent exited, launchd
// restarted it, it failed again, and the loop went on forever with the
// agent never reaching the world and never reporting that it could not.
//
// And an agent that is DEAD cannot report that it is locked out. So a hung
// world looked exactly like a dead agent, and the pilot — correctly, by its
// own rules — declined to restart anything. The world stayed broken.
//
// The rule: a world that is not there is a condition to REPORT, not a
// reason to die.

function makeRuntime({ connectError = "the world is not there", attempts = 1 } = {}) {
  const adapter = new EventEmitter();
  adapter.config = { username: "Guardian", primaryPlayer: "Panda_Nuggetz" };
  adapter.bot = { entity: { position: { x: 0, y: 64, z: 0 } }, players: {} };
  adapter.getSnapshot = () => ({ position: { x: 0, y: 64, z: 0 }, player_state: { visible: false } });
  adapter.say = async () => {};
  adapter.followPlayer = async () => {};
  adapter.stopFollowing = async () => {};

  let connectCalls = 0;
  adapter.connect = async () => {
    connectCalls += 1;
    throw new Error(connectError);
  };

  let runtime;
  const executor = new ActionExecutor({
    botAdapter: adapter,
    primaryPlayer: "Panda_Nuggetz",
    getPresenceController: () => runtime.presenceController
  });

  runtime = new AgentRuntime({
    botAdapter: adapter,
    actionExecutor: executor,
    threadId: "test:survive",
    primaryPlayer: "Panda_Nuggetz",
    messageStore: { storeMessage: async () => {} },
    eventStore: { recordEvent: async () => {} },
    logger: { info() {}, warn() {}, error() {} },
    reconnectConfig: { maxAttempts: attempts, baseDelayMs: 0, maxDelayMs: 0 }
  });

  return { runtime, adapter, connectCalls: () => connectCalls };
}

async function testAFailedConnectDoesNotKillTheAgent() {
  const { runtime } = makeRuntime();

  // The whole point: this must not throw.
  await runtime.start();

  assert.equal(runtime.runtimeState.lifecycle, "error",
    "the agent reports that it is not in the world");
  assert.equal(runtime.runtimeState.connectionHealth, "disconnected");
  assert.equal(runtime.readyForTurns, false,
    "an agent that is not in the world does not answer turns");
}

async function testTheAgentRetriesBeforeGivingUp() {
  const { runtime, connectCalls } = makeRuntime({ attempts: 3 });

  await runtime.start();

  assert.equal(connectCalls(), 3, "the agent tries every attempt in its budget");
  assert.equal(runtime.runtimeState.lifecycle, "error");
  assert.equal(runtime.runtimeState.reconnectState.attemptCount, 3,
    "the state says how many attempts it made");
  assert.equal(runtime.runtimeState.reconnectState.status, "failed");
}

async function testTheAgentStaysAliveToBeAsked() {
  const { runtime } = makeRuntime();

  await runtime.start();

  // The control plane reads the agent's state. If the agent had exited, that
  // read would fail, and the pilot would have nothing to act on.
  const snapshot = runtime.getRuntimeSnapshot();
  assert.equal(snapshot.state.lifecycle, "error");
  assert.equal(snapshot.state.connectionHealth, "disconnected");
}

async function testAGoodConnectStillWorks() {
  const adapter = new EventEmitter();
  adapter.config = { username: "Guardian", primaryPlayer: "Panda_Nuggetz" };
  adapter.bot = { entity: { position: { x: 0, y: 64, z: 0 } }, players: {} };
  adapter.getSnapshot = () => ({ position: { x: 0, y: 64, z: 0 }, player_state: { visible: false } });
  adapter.say = async () => {};

  let calls = 0;
  adapter.connect = async () => {
    calls += 1;
    return adapter.bot;
  };

  // The rest of start() needs a world context and a memory lane, so this
  // checks only the connection half.
  const runtime = new AgentRuntime({
    botAdapter: adapter,
    actionExecutor: new ActionExecutor({
      botAdapter: adapter,
      primaryPlayer: "Panda_Nuggetz",
      getPresenceController: () => runtime.presenceController
    }),
    threadId: "test:good",
    primaryPlayer: "Panda_Nuggetz",
    messageStore: { storeMessage: async () => {} },
    eventStore: { recordEvent: async () => {} },
    logger: { info() {}, warn() {}, error() {} }
  });

  const joined = await runtime.connectWithRetries("startup");

  assert.equal(joined, true, "a healthy world is joined");
  assert.equal(calls, 1, "and it takes exactly one attempt");
  assert.equal(runtime.runtimeState.lifecycle, "ready");
  assert.equal(runtime.runtimeState.connectionHealth, "healthy");
}

async function main() {
  await testAFailedConnectDoesNotKillTheAgent();
  await testTheAgentRetriesBeforeGivingUp();
  await testTheAgentStaysAliveToBeAsked();
  await testAGoodConnectStillWorks();

  console.log("agent survives a world that is not there — all tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
