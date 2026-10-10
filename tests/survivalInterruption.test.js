const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Vec3 } = require("vec3");
const { MinecraftBotAdapter } = require("../minecraft/bot");
const { AgentRuntime } = require("../agent/agentRuntime");
const { SurvivalController } = require("../survival/survivalController");
const { PresenceController } = require("../agent/presenceController");
const { BuildWorker } = require("../builder/buildWorker");

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const silent = { info() {}, warn() {}, error() {} };

function fixture() {
  const adapter = new MinecraftBotAdapter({ primaryPlayer: "Panda_Nuggetz" }, silent);
  const bot = new EventEmitter();
  const swung = deferred();
  const fleeing = deferred();
  const calls = [];
  const zombie = { id: 2, name: "zombie", isValid: true, position: new Vec3(2, 64, 0) };
  Object.assign(bot, {
    entity: { position: new Vec3(0, 64, 0) },
    health: 20, food: 20,
    entities: { 2: zombie },
    players: { ".Panda_Nuggetz": { entity: { position: new Vec3(20, 64, 0) } } },
    pathfinder: { setGoal: (goal) => calls.push(["goal", goal]) },
    lookAt: async () => {},
    setControlState: (control, value) => {
      calls.push([control, value]);
      if (control === "sprint" && value) fleeing.resolve();
    },
    attack: () => { calls.push(["attack"]); swung.resolve(); }
  });
  adapter.bot = bot;
  adapter.equipBestWeapon = async () => {};
  const events = [];
  const controller = new SurvivalController({ botAdapter: adapter, logger: silent, onEvent: (e) => events.push(e) });
  const runtime = Object.create(AgentRuntime.prototype);
  Object.assign(runtime, { botAdapter: adapter, survivalController: controller, logger: silent });
  runtime.attachBotEventHandlers();
  return { adapter, bot, calls, swung, fleeing, controller, events };
}

async function testPreemption(reason) {
  const { adapter, bot, calls, swung, fleeing, controller, events } = fixture();
  const running = controller.tick();
  await swung.promise;
  assert.equal(controller.busy, true);
  if (reason === "creeper") {
    // The zombie is closer: escape priority must still see the creeper.
    const creeper = { id: 3, name: "creeper", isValid: true, position: new Vec3(5, 64, 0) };
    bot.entities[3] = creeper;
    bot.emit("entitySpawn", creeper);
  } else {
    bot.health = 5;
    bot.emit("health");
  }
  await fleeing.promise;
  assert.equal(calls.filter(([kind]) => kind === "attack").length, 1, "no second swing after danger");
  const presence = new PresenceController({ botAdapter: adapter, primaryPlayer: "Panda_Nuggetz" });
  assert.equal(await presence.tick(), false, "following cannot override escape");
  await assert.rejects(adapter.moveTo({ x: 2, y: 64, z: 2 }), { code: "survival_interrupted" });
  controller.setEnabled(false);
  await running;
  assert.equal(adapter.survivalLease, null);
  assert.equal(controller.busy, false);
  assert.ok(events.some((event) => event.action === "fight" && event.outcome.interrupted));
  assert.ok(events.some((event) => event.action === "flee"));
  for (const control of ["forward", "jump", "sprint"]) {
    assert.equal(calls.filter(([name]) => name === control).at(-1)[1], false);
  }
}

async function testDeathCancels() {
  const { bot, adapter, controller, swung, calls } = fixture();
  const running = controller.tick();
  await swung.promise;
  bot.health = 0;
  bot.emit("death");
  await running;
  assert.equal(controller.stats.deaths, 1);
  assert.equal(adapter.getVitals().isAlive, false);
  assert.equal(calls.filter(([kind]) => kind === "attack").length, 1);
  assert.equal(adapter.survivalLease, null);
}

async function testOldNavigationCannotResume() {
  const { adapter, bot, calls } = fixture();
  let rejectPath;
  const started = deferred();
  bot.pathfinder.setMovements = () => {};
  adapter.movements = {};
  bot.pathfinder.goto = () => {
    started.resolve();
    return new Promise((_, reject) => { rejectPath = reject; });
  };
  bot.pathfinder.setGoal = (goal) => {
    calls.push(["goal", goal]);
    if (rejectPath) rejectPath(new Error("GoalChanged"));
  };
  const navigation = adapter.goNear({ x: 20, y: 64, z: 0 });
  const rejected = assert.rejects(navigation, { code: "survival_interrupted" });
  await started.promise;
  const lease = adapter.beginSurvival();
  adapter.endSurvival(lease);
  await rejected;
  assert.equal(adapter.survivalLease, null);
  assert.equal(adapter.activeBotOperation, null);
}

async function testBuildPauses() {
  const pauses = [];
  const job = { id: "job:1", payload: { current_index: 7 } };
  const worker = new BuildWorker({
    botAdapter: {}, logger: silent, threadId: "t", getWorldContext: () => ({ worldId: "w", sessionId: "s" }),
    jobStore: {
      getNextBuildJob: async () => job,
      markRunning: async () => {},
      pauseJob: async (...args) => pauses.push(args),
      failJob: async () => assert.fail("survival interruption must preserve the job")
    }
  });
  worker.executeJob = async () => { throw Object.assign(new Error("Task interrupted for self-preservation."), { code: "survival_interrupted" }); };
  assert.equal(await worker.runOnce(), false);
  assert.equal(pauses[0][1].diagnostic_code, "SURVIVAL_INTERRUPTED");
  assert.equal(pauses[0][3].payload.current_index, 7);
}

async function testCooldownDoesNotResumeFollowingIntoDanger() {
  const { adapter, bot, controller } = fixture();
  bot.entities = { 3: { id: 3, name: "creeper", isValid: true, position: new Vec3(5, 64, 0) } };
  const flee = adapter.fleeFrom.bind(adapter);
  adapter.fleeFrom = (position, options) => flee(position, { ...options, durationMs: 0 });
  const presence = new PresenceController({ botAdapter: adapter, primaryPlayer: "Panda_Nuggetz" });
  await controller.tick();
  assert.ok(adapter.survivalLease, "escape completing does not mean the threat has gone");
  assert.equal(await presence.tick(), false);
  await controller.tick();
  assert.ok(adapter.survivalLease, "flee cooldown must not hand movement back to following");
  bot.entities = {};
  await controller.tick();
  assert.equal(adapter.survivalLease, null);
  let followed = false;
  adapter.followPlayer = async () => { followed = true; };
  assert.equal(await presence.tick(), true);
  assert.equal(followed, true);
}

async function main() {
  await testPreemption("creeper");
  await testPreemption("health");
  await testDeathCancels();
  await testOldNavigationCannotResume();
  await testBuildPauses();
  await testCooldownDoesNotResumeFollowingIntoDanger();
  console.log("survival interruption tests passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
