const assert = require("assert");
const { EventEmitter } = require("node:events");

const { AgentRuntime } = require("../agent/agentRuntime");

// --- Regression: reactions must be event-driven, not polled -------------------
//
// Mineflayer already emits health, damage, spawn and death as they happen. The
// runtime previously ignored all of it and polled every 5 seconds — roughly
// three times longer than a creeper fuse. These tests pin the subscription so
// reactions stay instant and, just as importantly, stay quiet when nothing
// relevant happened.

function makeRuntime() {
  const bot = new EventEmitter();
  bot.entity = { position: { x: 0, y: 64, z: 0 } };

  const notified = [];

  const runtime = Object.create(AgentRuntime.prototype);
  runtime.botAdapter = { bot };
  runtime.logger = { info: () => {}, warn: () => {} };
  runtime.survivalController = {
    isHostileName: (name) => ["zombie", "creeper", "skeleton"].includes(String(name)),
    notify: async (reason) => { notified.push(reason); }
  };

  return { runtime, bot, notified };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

async function testSubscribesToAllSignals() {
  const { runtime, bot } = makeRuntime();

  assert.strictEqual(runtime.attachBotEventHandlers(), true, "must attach");

  for (const event of ["entityHurt", "health", "entitySpawn", "death", "spawn"]) {
    assert.strictEqual(bot.listenerCount(event), 1, `must subscribe to ${event}`);
  }

  console.log("  ✓ subscribes to the full mineflayer signal set");
}

async function testReactsToOwnDamageOnly() {
  const { runtime, bot, notified } = makeRuntime();
  runtime.attachBotEventHandlers();

  // Damage to us — the most urgent signal there is.
  bot.emit("entityHurt", bot.entity);
  await settle();
  assert.deepStrictEqual(notified, ["hurt"], "must react to taking damage");

  // Damage to anything else must not trigger a survival response.
  const before = notified.length;
  bot.emit("entityHurt", { position: { x: 1, y: 64, z: 1 } });
  await settle();
  assert.strictEqual(notified.length, before, "must ignore damage to other entities");

  console.log("  ✓ reacts to its own damage, ignores everything else's");
}

async function testIgnoresPassiveSpawns() {
  const { runtime, bot, notified } = makeRuntime();
  runtime.attachBotEventHandlers();

  // entitySpawn fires for every animal and dropped item. Waking the survival
  // loop for a chicken would make the companion twitch constantly.
  for (const passive of ["chicken", "cow", "villager", "item", "pig"]) {
    bot.emit("entitySpawn", { name: passive });
  }
  await settle();
  assert.deepStrictEqual(notified, [], "passive spawns must not wake the survival loop");

  // A hostile must.
  bot.emit("entitySpawn", { name: "zombie" });
  await settle();
  assert.deepStrictEqual(notified, ["hostile_spawn"], "a hostile spawn must wake the loop");

  console.log("  ✓ ignores passive spawns, reacts to hostile ones");
}

async function testDeathReachesTheLoop() {
  const { runtime, bot, notified } = makeRuntime();
  runtime.attachBotEventHandlers();

  bot.emit("health");
  bot.emit("death");
  await settle();

  assert.deepStrictEqual(notified, ["health", "death"], "death must reach the controller");

  console.log("  ✓ death reaches the controller");
}

async function testDetachUnbindsFully() {
  const { runtime, bot, notified } = makeRuntime();
  runtime.attachBotEventHandlers();
  runtime.detachBotEventHandlers();

  for (const event of ["entityHurt", "health", "entitySpawn", "death"]) {
    assert.strictEqual(bot.listenerCount(event), 0, `${event} must be unbound after detach`);
  }

  const before = notified.length;
  bot.emit("entityHurt", bot.entity);
  bot.emit("health");
  await settle();
  assert.strictEqual(notified.length, before, "a detached runtime must not react");

  console.log("  ✓ detach unbinds every listener");
}

async function testReattachDoesNotDuplicate() {
  const { runtime, bot, notified } = makeRuntime();

  // Reconnect swaps the bot object, so handlers get re-attached. Doing that
  // twice on the same emitter must not double-fire.
  runtime.attachBotEventHandlers();
  runtime.attachBotEventHandlers();

  assert.strictEqual(bot.listenerCount("entityHurt"), 1, "must not stack listeners on re-attach");

  bot.emit("entityHurt", bot.entity);
  await settle();
  assert.strictEqual(notified.length, 1, "a single hit must produce a single reaction");

  console.log("  ✓ re-attaching never double-fires");
}

async function testMissingBotIsSafe() {
  const runtime = Object.create(AgentRuntime.prototype);
  runtime.botAdapter = { bot: null };
  runtime.logger = { info: () => {}, warn: () => {} };
  runtime.survivalController = { isHostileName: () => false, notify: async () => {} };

  assert.strictEqual(runtime.attachBotEventHandlers(), false, "no bot must be a no-op");
  assert.doesNotThrow(() => runtime.detachBotEventHandlers(), "detach with nothing attached");

  console.log("  ✓ a missing bot is a no-op");
}

(async () => {
  console.log("botEventWiring tests");

  await testSubscribesToAllSignals();
  await testReactsToOwnDamageOnly();
  await testIgnoresPassiveSpawns();
  await testDeathReachesTheLoop();
  await testDetachUnbindsFully();
  await testReattachDoesNotDuplicate();
  await testMissingBotIsSafe();

  console.log("botEventWiring tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});