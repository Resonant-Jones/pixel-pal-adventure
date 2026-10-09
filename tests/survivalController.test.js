const assert = require("assert");

const { SurvivalController } = require("../survival/survivalController");

// Survival is the one subsystem where a wrong decision is immediately visible:
// the companion dies. These tests pin the priority ladder so a future edit
// cannot quietly make it melee a creeper or eat while being eaten.

function makeController(overrides = {}) {
  const events = [];

  const botAdapter = {
    vitals: { isAlive: true, health: 20, food: 20, position: { x: 0, y: 64, z: 0 } },
    threat: null,
    calls: { flee: [], fight: [], eat: [] },
    getVitals() {
      return this.vitals;
    },
    findNearestHostile() {
      return this.threat;
    },
    async fleeFrom(position, options) {
      this.calls.flee.push({ position, options });
      return { fled: true };
    },
    async attackEntity(entity, options) {
      this.calls.fight.push({ entity, options });
      return { attacked: true, killed: true, swings: 3 };
    },
    async consumeFood() {
      this.calls.eat.push({});
      return { ate: true, item: "bread" };
    },
    releaseMovementControls() {},
    ...overrides.botAdapter
  };

  const controller = new SurvivalController({
    botAdapter,
    logger: { warn() {}, info() {} },
    onEvent: (e) => events.push(e),
    ...overrides.controller
  });

  return { controller, botAdapter, events };
}

const assess = (vitals, threat) => ({ ok: true, vitals, threat });

const threatAt = (name, distance) => ({ name, distance, entity: { id: name, position: { x: 0, y: 64, z: 0 } } });

// --- priority ladder ---------------------------------------------------------

function testPriority() {
  const { controller } = makeController();

  const cases = [
    ["healthy and safe does nothing", { health: 20, food: 20 }, null, "none", "safe"],
    ["hungry with no threat eats", { health: 20, food: 8 }, null, "eat", "hungry"],
    ["zombie in range is fought", { health: 20, food: 20 }, threatAt("zombie", 6), "fight", "defend_self"],
    ["skeleton in range is fought", { health: 20, food: 20 }, threatAt("skeleton", 9), "fight", "defend_self"],
    ["critical health outranks fighting", { health: 5, food: 20 }, threatAt("zombie", 5), "flee", "critical_health"],
    ["critical health with no threat eats", { health: 5, food: 5 }, null, "eat", "critical_health"],
    ["low health flees a mob in its face", { health: 12, food: 20 }, threatAt("zombie", 3), "flee", "outmatched"]
  ];

  for (const [label, vitals, threat, action, reason] of cases) {
    const decision = controller.decide(assess(vitals, threat));
    assert.strictEqual(decision.action, action, `${label}: expected ${action}, got ${decision.action}`);
    assert.strictEqual(decision.reason, reason, `${label}: reason`);
  }

  console.log("  ✓ priority ladder holds");
}

// --- never melee an exploder -------------------------------------------------

function testCreepersAreNeverMeleed() {
  const { controller } = makeController();

  for (const distance of [1, 3, 6, 10, 12]) {
    const decision = controller.decide(assess({ health: 20, food: 20 }, threatAt("creeper", distance)));
    assert.strictEqual(
      decision.action,
      "flee",
      `a creeper at ${distance} blocks must be fled, not fought (got ${decision.action})`
    );
  }

  console.log("  ✓ creepers are always fled, never meleed");
}

// --- hostile classification --------------------------------------------------

function testHostileClassification() {
  const { controller } = makeController();

  for (const name of ["zombie", "creeper", "skeleton", "enderman", "witch", "phantom"]) {
    assert.strictEqual(controller.isHostileName(name), true, `${name} must be hostile`);
    assert.strictEqual(controller.isHostileName(`minecraft:${name}`), true, `namespaced ${name} must be hostile`);
  }

  // The companion must never pick a fight the child did not ask for.
  for (const name of ["chicken", "cow", "villager", "pig", "player", "item", "armor_stand", ""]) {
    assert.strictEqual(controller.isHostileName(name), false, `${name} must NOT be treated as hostile`);
  }

  console.log("  ✓ only genuine hostiles are targeted");
}

// --- the controller actually acts -------------------------------------------

async function testActionsAreExecuted() {
  const { controller, botAdapter, events } = makeController();

  botAdapter.vitals = { isAlive: true, health: 20, food: 20, position: { x: 0, y: 64, z: 0 } };
  botAdapter.threat = threatAt("zombie", 5);

  await controller.tick();
  assert.strictEqual(botAdapter.calls.fight.length, 1, "must fight the zombie");

  botAdapter.threat = threatAt("creeper", 4);
  await controller.tick();
  assert.strictEqual(botAdapter.calls.flee.length, 1, "must flee the creeper");

  assert.ok(events.length >= 2, "each action must emit an event for narration");
  assert.ok(
    events.some((e) => e.action === "fight" && e.mob === "zombie"),
    "fight event must name the mob"
  );

  console.log("  ✓ actions execute and emit narratable events");
}

// --- cooldowns prevent thrashing --------------------------------------------

async function testCooldowns() {
  const { controller, botAdapter } = makeController();

  botAdapter.vitals = { isAlive: true, health: 20, food: 20, position: { x: 0, y: 64, z: 0 } };
  botAdapter.threat = threatAt("zombie", 5);

  await controller.tick();
  const afterFirst = botAdapter.calls.fight.length;

  // Immediate re-tick must not fire a second attack mid-swing.
  await controller.tick();
  assert.strictEqual(
    botAdapter.calls.fight.length,
    afterFirst,
    "must not stack attacks inside the cooldown window"
  );

  console.log("  ✓ cooldowns stop it thrashing");
}

// --- dead bot is safe --------------------------------------------------------

async function testNoBotIsSafe() {
  const { controller, botAdapter } = makeController();
  botAdapter.getVitals = () => null;

  const result = await controller.tick();
  assert.strictEqual(result, null, "no bot means nothing to do");
  assert.strictEqual(controller.decide({ ok: false }).action, "none");

  console.log("  ✓ a disconnected bot is a no-op, not a crash");
}

// --- death is recorded -------------------------------------------------------

async function testDeathIsRecorded() {
  const { controller, events } = makeController();

  await controller.notify("death");

  assert.strictEqual(controller.getStats().deaths, 1, "death must be counted");
  assert.ok(
    events.some((e) => e.action === "died"),
    "death must emit an event so the model can acknowledge it"
  );

  console.log("  ✓ deaths are recorded");
}

// --- disabled means disabled -------------------------------------------------

async function testDisable() {
  const { controller, botAdapter } = makeController();
  botAdapter.vitals = { isAlive: true, health: 5, food: 5, position: { x: 0, y: 64, z: 0 } };
  botAdapter.threat = threatAt("zombie", 2);

  controller.setEnabled(false);
  await controller.tick();
  await controller.notify("hurt");

  assert.strictEqual(botAdapter.calls.flee.length, 0, "disabled controller must not act");
  assert.strictEqual(botAdapter.calls.fight.length, 0, "disabled controller must not fight");

  console.log("  ✓ can be disabled without acting");
}

(async () => {
  console.log("survivalController tests");

  testPriority();
  testCreepersAreNeverMeleed();
  testHostileClassification();
  await testActionsAreExecuted();
  await testCooldowns();
  await testNoBotIsSafe();
  await testDeathIsRecorded();
  await testDisable();

  console.log("survivalController tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});