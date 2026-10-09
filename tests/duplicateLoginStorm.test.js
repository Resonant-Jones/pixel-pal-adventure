const assert = require("assert");
const { EventEmitter } = require("node:events");

const { AgentRuntime } = require("../agent/agentRuntime");

// --- Regression: the duplicate-login halt must survive the `end` that follows --
//
// This is the second duplicate-login storm, and it happened DESPITE the first
// fix — because the first fix was only ever unit-tested on the classifier.
//
// A kick fires `kicked` and then `end`, back to back:
//   1. `kicked` carries "You logged in from another location" → halt. Correct.
//   2. `end` fires immediately after, carrying no reason of its own.
//
// Two separate defects combined here:
//
//   (a) The `end` listener discarded the reason and substituted a generic
//       Error("Minecraft connection ended."), so the classifier could not see a
//       duplicate login — it looked like an ordinary disconnect.
//   (b) The halt path set `reconnectInFlight = false`. That cleared the very
//       in-flight guard the next `end` call checks, so the `end` call sailed
//       straight through into a reconnect.
//
// So the halt undid itself one tick later, and two agents kicked each other to
// 25,186 login cycles in a single afternoon. Closing the lid is enough to
// trigger it: the suspended process wakes, the stale session is still held, and
// both copies reconnect.
//
// The tests below drive the real method through the real sequence.

function makeRuntime() {
  const runtime = Object.create(AgentRuntime.prototype);

  runtime.shuttingDown = false;
  runtime.duplicateSessionHalted = false;
  runtime.runtimeUnavailable = false;
  runtime.connectionInterrupted = false;
  runtime.reconnectInFlight = null;
  runtime.reconnectMaxAttempts = 5;
  runtime.threadId = "test";
  runtime.companionName = "Guardian";
  runtime.activeTurnId = null;
  runtime.runtimeState = { reconnectState: { attemptCount: 0 }, lifecycle: "ready" };

  runtime.botAdapter = {
    config: { username: "Guardian" },
    getSnapshot: () => ({ position: { x: 0, y: 64, z: 0 } })
  };

  runtime.events = [];
  runtime.setRuntimeState = (patch) => {
    runtime.runtimeState = { ...runtime.runtimeState, ...patch };
  };
  runtime.safeRecordEvent = async (event) => { runtime.events.push(event.type); };
  runtime.emitRuntimeEvent = () => {};
  runtime.stopBackgroundLoops = () => { runtime.loopsStopped = true; };
  runtime.completeTurnTask = () => {};
  runtime.initializeWorldContext = async () => {};

  // Counts reconnect attempts. This is the thing that must never happen twice.
  runtime.reconnectAttempts = 0;
  runtime.runReconnectLoop = async () => {
    runtime.reconnectAttempts += 1;
    return true;
  };

  runtime.logs = [];
  runtime.logger = {
    info: () => {},
    warn: (msg) => runtime.logs.push(["warn", msg]),
    error: (msg) => runtime.logs.push(["error", msg])
  };

  return runtime;
}

const DUP = "Minecraft connection was kicked: You logged in from another location";

async function testTransientDropStillReconnects() {
  const runtime = makeRuntime();

  await runtime.handleConnectionLoss("end", new Error("Minecraft connection ended."));

  assert.strictEqual(
    runtime.reconnectAttempts,
    1,
    "an ordinary disconnect must still reconnect — the halt guard must be narrow"
  );

  console.log("  ✓ ordinary disconnects still reconnect");
}

async function testDuplicateKickHalts() {
  const runtime = makeRuntime();

  await runtime.handleConnectionLoss("bot_error", new Error(DUP));

  assert.strictEqual(runtime.reconnectAttempts, 0, "a duplicate login must never reconnect");
  assert.strictEqual(runtime.duplicateSessionHalted, true, "the halt must be latched");
  assert.ok(runtime.loopsStopped, "background loops must be stopped");

  console.log("  ✓ a duplicate-login kick halts instead of reconnecting");
}

async function testEndAfterHaltDoesNotResume() {
  const runtime = makeRuntime();

  // The real sequence: kicked first, then end.
  await runtime.handleConnectionLoss("bot_error", new Error(DUP));
  assert.strictEqual(runtime.reconnectAttempts, 0, "the kick itself must not reconnect");

  // And now the `end` that mineflayer always fires right afterwards. This is
  // the call that used to undo the halt and restart the storm.
  await runtime.handleConnectionLoss("end", new Error("Minecraft connection ended."));

  assert.strictEqual(
    runtime.reconnectAttempts,
    0,
    "the `end` following a duplicate-login halt must NOT reconnect — this is the storm"
  );
  assert.strictEqual(runtime.duplicateSessionHalted, true, "the latch must survive");

  console.log("  ✓ the `end` after a halt cannot resurrect the storm");
}

async function testRepeatedEventsStayHalted() {
  const runtime = makeRuntime();

  await runtime.handleConnectionLoss("bot_error", new Error(DUP));

  // Keep hammering it the way a flapping network or a second live agent would.
  for (let i = 0; i < 25; i += 1) {
    await runtime.handleConnectionLoss("end", new Error("Minecraft connection ended."));
  }

  assert.strictEqual(
    runtime.reconnectAttempts,
    0,
    "25 further connection losses must produce zero reconnect attempts"
  );

  console.log("  ✓ repeated connection losses never break the latch");
}

async function testEndCarryingTheDuplicateReasonHalts() {
  const runtime = makeRuntime();

  // Defence in depth: even if the `kicked` event is missed entirely, the reason
  // now survives the trip through `end` and is recognised on its own.
  await runtime.handleConnectionLoss("end", new Error(DUP));

  assert.strictEqual(runtime.reconnectAttempts, 0, "the reason must survive the `end` hop");
  assert.strictEqual(runtime.duplicateSessionHalted, true, "and must halt on its own");

  console.log("  ✓ a duplicate reason arriving via `end` still halts");
}

async function testEndListenerPreservesAdapterReason() {
  const runtime = makeRuntime();
  const adapter = new EventEmitter();
  adapter.config = { username: "Guardian" };
  runtime.botAdapter = adapter;

  // Wire the runtime the same way the agent does at boot.
  runtime.attachAdapterListenersForTest
    ? runtime.attachAdapterListenersForTest()
    : attachEndListener(runtime);

  adapter.emit("end", "You logged in from another location");
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.strictEqual(
    runtime.reconnectAttempts,
    0,
    "the `end` listener must forward the adapter's reason, not invent one"
  );

  console.log("  ✓ the `end` listener forwards the real reason");
}

function attachEndListener(runtime) {
  runtime.botAdapter.on("end", (lastReason) => {
    const detail = lastReason || "Minecraft connection ended.";
    void runtime.handleConnectionLoss("end", new Error(detail));
  });
}

async function main() {
  await testTransientDropStillReconnects();
  await testDuplicateKickHalts();
  await testEndAfterHaltDoesNotResume();
  await testRepeatedEventsStayHalted();
  await testEndCarryingTheDuplicateReasonHalts();
  await testEndListenerPreservesAdapterReason();

  console.log("duplicateLoginStorm tests passed");
}

main().catch((error) => {
  console.error(`duplicateLoginStorm tests FAILED: ${error.message}`);
  process.exitCode = 1;
});