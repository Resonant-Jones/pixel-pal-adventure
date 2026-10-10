const assert = require("assert");

const { MinecraftBotAdapter } = require("../minecraft/bot");

// --- Regression: the bot fought with no armour --------------------------------
//
// Skeletons were the single largest cause of Guardian's deaths (22 of 52),
// ahead of zombies. A skeleton shoots from well outside the 3.5-block melee
// range, so the bot spent the whole approach eating arrows. The adapter had
// equipBestWeapon() and equipBestFood() but nothing that ever equipped armour,
// so it closed to melee range wearing nothing.
//
// These pin the new primitive. They do not prove the bot survives more often —
// that needs the live log, which is why the agent now persists one.

let passed = 0;
let failed = 0;
const queue = [];

function test(name, fn) {
  queue.push([name, fn]);
}

// Sequential, awaited. A harness that fires async tests without awaiting them
// reports success for assertions that never ran.
async function runAll() {
  for (const [name, fn] of queue) {
    try {
      await fn();
      passed += 1;
      console.log(`  ✓ ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`  ✗ ${name}`);
      console.log(`      ${error.message}`);
      process.exitCode = 1;
    }
  }

  console.log(`equipArmor tests ${failed === 0 ? "passed" : "FAILED"} (${passed} passed, ${failed} failed)`);
}

function makeAdapter(items = [], equipImpl) {
  const adapter = Object.create(MinecraftBotAdapter.prototype);
  const equipped = [];

  adapter.inventory = { items };
  adapter.logger = { warn: () => {}, error: () => {}, info: () => {} };
  adapter.findInventoryItem = (item) => items.find((candidate) => candidate.name === item.name) || null;
  adapter.findInventoryItemLowestDurability = (names) => {
    for (const name of names) {
      const found = adapter.findInventoryItem({ name });
      if (found) return found;
    }
    return null;
  };
  adapter.bot = {
    inventory: { slots: [], getEquipmentDestSlot: () => -1 },
    equip: equipImpl || (async (item, destination) => equipped.push(`${item.name}->${destination}`))
  };

  adapter._equipped = equipped;
  return adapter;
}

test("equips each armour slot from the best tier available", async () => {
  const adapter = makeAdapter([
    { name: "leather_helmet" },
    { name: "iron_helmet" },
    { name: "leather_chestplate" },
    { name: "iron_chestplate" },
    { name: "iron_boots" }
  ]);

  const result = await adapter.equipBestArmor();

  assert.deepStrictEqual(result, {
    head: "iron_helmet",
    torso: "iron_chestplate",
    feet: "iron_boots"
  }, "must prefer the better tier and skip empty slots");
});

test("returns null when nothing wearable is carried", async () => {
  const adapter = makeAdapter([{ name: "cooked_beef" }, { name: "stone_sword" }]);

  assert.strictEqual(await adapter.equipBestArmor(), null, "no armour means no change");
});

test("prefers netherite over everything", async () => {
  const adapter = makeAdapter([
    { name: "diamond_chestplate" },
    { name: "iron_chestplate" },
    { name: "netherite_chestplate" }
  ]);

  const result = await adapter.equipBestArmor();

  assert.strictEqual(result.torso, "netherite_chestplate");
});

test("one failing slot does not prevent the others", async () => {
  const adapter = makeAdapter(
    [{ name: "iron_helmet" }, { name: "iron_chestplate" }, { name: "iron_boots" }],
    async (item) => {
      if (item.name === "iron_helmet") throw new Error("nope");
    }
  );

  const result = await adapter.equipBestArmor();

  assert.ok(result && result.torso === "iron_chestplate", "torso must still equip");
  assert.ok(result && result.feet === "iron_boots", "boots must still equip");
  assert.ok(!result || !result.head, "the failed slot is simply absent");
});

test("a disconnected bot is a no-op, not a crash", async () => {
  const adapter = Object.create(MinecraftBotAdapter.prototype);
  adapter.logger = { warn: () => {} };

  assert.strictEqual(await adapter.equipBestArmor(), null, "no bot means no inventory");
});

test("survival equips armour before it swings", async () => {
  const { SurvivalController } = require("../survival/survivalController");
  const order = [];

  const controller = Object.create(SurvivalController.prototype);
  controller.logger = { warn: () => {}, info: () => {} };
  controller.cooldowns = { fleeUntil: 0, attackUntil: 0 };
  controller.stats = { fights: 0, kills: 0, flees: 0, deaths: 0 };
  controller.record = () => {};
  controller.botAdapter = {
    equipBestArmor: async () => { order.push("armour"); return { head: "iron_helmet" }; },
    attackEntity: async () => { order.push("attack"); return { killed: false }; }
  };
  controller.isDangerousThreat = () => false;

  await controller.act({ action: "fight", threat: { entity: { id: 1 } } });

  assert.deepStrictEqual(order, ["armour", "attack"], "armour must go on before the first swing");
});

test("armour failure never blocks the fight", async () => {
  const { SurvivalController } = require("../survival/survivalController");
  const order = [];

  const controller = Object.create(SurvivalController.prototype);
  controller.logger = { warn: () => {}, info: () => {} };
  controller.cooldowns = { fleeUntil: 0, attackUntil: 0 };
  controller.stats = { fights: 0, kills: 0, flees: 0, deaths: 0 };
  controller.record = () => {};
  controller.botAdapter = {
    equipBestArmor: async () => { throw new Error("inventory exploded"); },
    attackEntity: async () => { order.push("attack"); return { killed: false }; }
  };
  controller.isDangerousThreat = () => false;

  await controller.act({ action: "fight", threat: { entity: { id: 1 } } });

  assert.deepStrictEqual(order, ["attack"], "a broken equip must not cost the fight");
});

runAll();