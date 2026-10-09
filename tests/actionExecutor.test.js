const assert = require("assert");

const { ActionExecutor } = require("../agent/actionExecutor");

function createExecutor(overrides = {}) {
  const jobStore = {
    createJob: async (payload) => ({
      id: "job-1",
      payload
    })
  };

  const botAdapter = {
    getFacingDirection: () => "south",
    say: async () => {},
    getInventorySummary: () => ({ items: [], summary: "Inventory is empty." })
  };

  return new ActionExecutor({
    botAdapter,
    jobStore,
    getWorldContext: () => ({
      worldId: "world-1",
      sessionId: "session-1",
      threadId: "thread-1"
    }),
    isBuildMutationAllowed: () => true,
    primaryPlayer: "Sage",
    companionName: "Guardian",
    ...overrides
  });
}

async function testRejectsMissingTarget() {
  const executor = createExecutor();

  await assert.rejects(
    () =>
      executor.execute({
        message: "",
        action: {
          type: "compose_structure",
          style: "hut",
          size: "small"
        }
      }),
    /target location/
  );
}

async function testRejectsMissingMutationPermission() {
  const executor = createExecutor({
    isBuildMutationAllowed: () => false
  });

  await assert.rejects(
    () =>
      executor.execute({
        message: "",
        action: {
          type: "compose_structure",
          style: "hut",
          size: "small",
          target: { x: 10, y: 64, z: -20 }
        }
      }),
    /build mutation permission/
  );
}

async function testAcceptsBoundedBuild() {
  let createdJob = null;
  const executor = createExecutor({
    jobStore: {
      createJob: async (payload) => {
        createdJob = payload;
        return { id: "job-2" };
      }
    }
  });

  const execution = await executor.execute({
    message: "",
    action: {
      type: "compose_structure",
      style: "hut",
      size: "small",
      target: { x: 10, y: 64, z: -20 }
    }
  });

  assert.ok(createdJob);
  assert.strictEqual(createdJob.type, "build_structure");
  assert.deepStrictEqual(createdJob.payload.location, { x: 10, y: 64, z: -20 });
  assert.strictEqual(execution.build.jobId, "job-2");
}

Promise.resolve()
  .then(testRejectsMissingTarget)
  .then(testRejectsMissingMutationPermission)
  .then(testAcceptsBoundedBuild)
  .then(() => {
    console.log("actionExecutor tests passed");

// --- Regression: "build me a house" must not throw ---------------------------
//
// Routing a targetless build request to the task lane was only half the fix.
// The executor still demanded coordinates and threw, which surfaced to the kid
// as "I lost the thread for a moment." This asserts a coordinate-less build
// resolves to the player's live position and produces a real job.

function createHereExecutor(playerPosition) {
  const created = [];

  const executor = new ActionExecutor({
    botAdapter: {
      getPlayerEntity: () => ({ position: playerPosition }),
      getFacingDirection: () => "south",
      getSnapshot: () => ({}),
      say: async () => {},
      bot: { entity: { position: { x: 500, y: 64, z: 500 } } }
    },
    jobStore: {
      createJob: async (payload) => {
        created.push(payload);
        return { id: "job-here", payload };
      }
    },
    getWorldContext: () => ({ worldId: "w", sessionId: "s", threadId: "t" }),
    primaryPlayer: "Panda_Nuggetz",
    isBuildMutationAllowed: () => true,
    logger: { error() {} }
  });

  return { executor, created };
}

async function testBuildHereCreatesJobAtPlayer() {
  const { executor, created } = createHereExecutor({ x: -34.5, y: 75.2, z: -40.5 });

  const result = await executor.execute({
    message: "",
    action: { type: "compose_structure", style: "house", palette: "oak", size: "small" }
  });

  assert.strictEqual(result.actionType, "compose_structure");
  assert.strictEqual(created.length, 1, "a job must be created");

  const location = created[0].payload.location;
  assert.ok(location, "location must be resolved from the player, not null");
  assert.strictEqual(location.source, "player_position");
  assert.deepStrictEqual(
    [location.x, location.y, location.z],
    [-35, 74, -41],
    "must land on the player's position, not the bot's"
  );
  assert.ok(created[0].payload.plan.primitives.length > 0, "plan must have real geometry");

  console.log("  ✓ targetless build resolves to the player's position");
}

async function testExplicitTargetStillWins() {
  const { executor, created } = createHereExecutor({ x: 0, y: 64, z: 0 });

  await executor.execute({
    message: "",
    action: {
      type: "compose_structure",
      style: "house",
      palette: "oak",
      size: "small",
      location: { x: 100, y: 70, z: 200 }
    }
  });

  assert.deepStrictEqual(
    [created[0].payload.location.x, created[0].payload.location.y, created[0].payload.location.z],
    [100, 70, 200],
    "an explicit coordinate must not be overwritten by the player position"
  );

  console.log("  ✓ an explicit coordinate still wins");
}

async function testNoPlayerStillThrows() {
  const executor = new ActionExecutor({
    botAdapter: {
      getPlayerEntity: () => null,
      getFacingDirection: () => "south",
      getSnapshot: () => ({}),
      say: async () => {},
      bot: { entity: null }
    },
    jobStore: { createJob: async () => ({ id: "x" }) },
    getWorldContext: () => ({ worldId: "w", sessionId: "s", threadId: "t" }),
    primaryPlayer: "Panda_Nuggetz",
    isBuildMutationAllowed: () => true,
    logger: { error() {} }
  });

  let threw = false;
  try {
    await executor.execute({
      message: "",
      action: { type: "compose_structure", style: "house", palette: "oak", size: "small" }
    });
  } catch (error) {
    threw = true;
    assert.match(error.message, /target location/i);
  }

  assert.ok(threw, "with nobody in the world there is genuinely nowhere to build");

  console.log("  ✓ a world with no player still fails loudly, not silently");
}

(async () => {
  await testBuildHereCreatesJobAtPlayer();
  await testExplicitTargetStillWins();
  await testNoPlayerStillThrows();
  console.log("actionExecutor build-here tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
