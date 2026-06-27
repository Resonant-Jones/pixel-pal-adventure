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
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
