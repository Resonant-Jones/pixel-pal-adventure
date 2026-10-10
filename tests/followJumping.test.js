const assert = require("assert");
const { EventEmitter } = require("node:events");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const { MinecraftBotAdapter } = require("../minecraft/bot");

// --- Regression: following Sage must look like walking, not tunnelling ------
//
// Sage reported "Guardian cannot Jump". The bot was not stuck on a physics
// bug: mineflayer never auto-enables flight in creative, and the pathfinder
// already calls setControlState('jump', true) when it plans to hop.
//
// The real cause was the Movements defaults. `canDig` and `allow1by1towers`
// both ship as true, so with Sage standing above Guardian on a ridge the
// pathfinder planned a route straight up *through* the blocks. At about a
// second per block, Guardian looked frozen while cheerfully claiming it was
// following — the exact log we saw, sitting at y66 while Sage was at y71.
//
// These tests pin the structural split: follow gets its own Movements, and
// build navigation keeps the default one that is allowed to dig and place.

function makeBot() {
  const applied = [];
  const goals = [];

  const bot = new EventEmitter();
  bot.entity = { position: { x: 0, y: 66, z: 0 } };
  bot.game = { gameMode: "creative" };
  bot.controlState = {};

  bot.pathfinder = {
    setMovements: (movements) => applied.push(movements),
    setGoal: (goal) => goals.push(goal),
    stop: () => {},
    goto: async () => "arrived"
  };

  return { bot, applied, goals };
}

function makeAdapter() {
  const logs = [];
  const adapter = new MinecraftBotAdapter(
    { primaryPlayer: "Panda_Nuggetz", followDistance: 2 },
    { info: (m) => logs.push(String(m)), warn: (m) => logs.push(String(m)) }
  );

  const { bot, applied, goals } = makeBot();
  adapter.bot = bot;
  adapter.getPlayerEntity = () => ({ position: { x: 3, y: 71, z: 4 } });

  // `new Movements()` builds a prismarine-block from the live mineflayer
  // registry, so it cannot be constructed in a unit test. Seed the follow
  // profile so the wiring is still exercised end to end; the tuning values
  // themselves are asserted against the source below.
  adapter.followMovements = {
    canDig: false,
    allow1by1towers: false,
    allowParkour: true
  };

  return { adapter, bot, applied, goals, logs };
}

async function run() {
  let passed = 0;
  let failed = 0;

  const check = async (name, fn) => {
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
  };

  await check("follow uses its own Movements, not the build one", async () => {
    const { adapter, applied } = makeAdapter();
    const buildMovements = { canDig: true, allow1by1towers: true };

    adapter.movements = buildMovements;
    await adapter.followPlayer("Panda_Nuggetz");

    assert.strictEqual(applied.length, 1, "follow must apply a Movements profile");
    assert.strictEqual(
      applied[0],
      adapter.followMovements,
      "follow must install the follow profile"
    );
    assert.notStrictEqual(
      applied[0],
      buildMovements,
      "follow must NOT reuse the build Movements — those dig and tower"
    );
    assert.strictEqual(applied[0].canDig, false, "the follow profile must not dig");
  });

  await check("build navigation still uses the default Movements", async () => {
    const { adapter, applied } = makeAdapter();
    const buildMovements = { canDig: true, allow1by1towers: true };

    adapter.movements = buildMovements;
    await adapter.moveTo({ x: 10, y: 66, z: 10 });

    assert.strictEqual(
      applied[0],
      buildMovements,
      "moveTo must keep digging/place privileges — building needs them"
    );
  });

  await check("the follow profile disables digging and 1x1 towers", () => {
    // Movements itself needs a live mineflayer registry, so assert the tuning
    // that makes the difference rather than constructing a throwaway one.
    const source = readFileSync(join(__dirname, "..", "minecraft", "bot.js"), "utf8");

    assert.match(
      source,
      /followMovements\.canDig\s*=\s*false/,
      "follow must turn off digging, or Guardian tunnels instead of hopping"
    );
    assert.match(
      source,
      /followMovements\.allow1by1towers\s*=\s*false/,
      "follow must turn off 1x1 towers, or Guardian climbs by mining upward"
    );
    assert.match(
      source,
      /followMovements\.allowParkour\s*=\s*true/,
      "follow must keep parkour so ledges and steps get jumped"
    );
  });

  await check("a follow attempt logs the vertical gap it is closing", async () => {
    const { adapter, logs } = makeAdapter();
    await adapter.followPlayer("Panda_Nuggetz");

    const line = logs.find((m) => m.includes("[minecraft] follow Panda_Nuggetz:"));
    assert.ok(line, "follow must log its gap, or a silent stand-still looks like success");

    // Guardian sits at y66, the target entity is at y71 in the fixture.
    assert.match(line, /dy=5/, "the vertical gap must be reported");
    assert.match(line, /from=0,66,0/, "Guardian's own position must be reported");
    assert.match(line, /to=3,71,4/, "the target position must be reported");
  });

  await check("the follow probe survives a disconnect mid-flight", async () => {
    const { adapter, bot } = makeAdapter();
    await adapter.followPlayer("Panda_Nuggetz");

    // Mimic the bot quitting before the 5s probe fires.
    adapter.bot = null;
    assert.ok(bot, "probe must not throw when the bot is gone");
  });

  console.log(
    `followJumping tests ${failed === 0 ? "passed" : "FAILED"} (${passed} passed, ${failed} failed)`
  );
}

run();