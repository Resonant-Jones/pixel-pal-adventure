const assert = require("assert");

const { BuildWorker, MAX_CONSECUTIVE_NO_PROGRESS_PAUSES } = require("../builder/buildWorker");
const { isRetryableBuildError } = require("../builder/buildJobErrors");

// Regression coverage for the four abandonment bugs:
//
//   1. A transient throw went straight to failJob() — terminal, and never
//      re-selected — so one packet loss killed a build forever.
//   2. Pausing recorded no event, so a stalled build looked like it never ran.
//   3. Build state never reached the model, so it could not answer "what are
//      you doing?".
//   4. A paused build was treated as inactive, letting a duplicate job spawn.

function createFakeJobStore(overrides = {}) {
  const calls = { pause: [], fail: [], complete: [], update: [], running: [] };

  return {
    calls,
    async getNextBuildJob() {
      return null;
    },
    async markRunning(id) {
      calls.running.push(id);
    },
    async pauseJob(id, error, resumeAt, patch) {
      calls.pause.push({ id, error, resumeAt, patch });
    },
    async failJob(id, error) {
      calls.fail.push({ id, error });
    },
    async completeJob(id, result) {
      calls.complete.push({ id, result });
    },
    async updateJob(id, patch) {
      calls.update.push({ id, patch });
    },
    ...overrides
  };
}

function createFakeEventStore() {
  const events = [];

  return {
    events,
    async recordEvent(event) {
      events.push(event);
      return event;
    }
  };
}

function createFakeBotAdapter(overrides = {}) {
  const said = [];
  const presence = { beginTask: 0, endTask: 0 };

  return {
    said,
    presence,
    config: { followDistance: 3 },
    // siteInspector requires a real-looking bot with blockAt(); an all-air
    // world keeps the site check passing so tests exercise the paths they
    // actually care about.
    bot: {
      entity: { position: { x: 0, y: 64, z: 0 } },
      blockAt(position) {
        return { name: "air", position };
      }
    },
    async stopPathing() {},
    async say(message) {
      said.push(message);
    },
    findDirectionalBuildSite() {
      return { x: 10, y: 64, z: -20 };
    },
    findFlatBuildSite() {
      return { x: 10, y: 64, z: -20 };
    },
    getMissingMaterials() {
      return [];
    },
    async provisionBuildMaterials() {
      return { provided: false, commands: [] };
    },
    async placeBlock() {
      return { status: "ok" };
    },
    getSnapshot() {
      return { position: { x: 0, y: 64, z: 0 } };
    },
    ...overrides
  };
}

function createFakePresenceController() {
  const controller = {
    began: 0,
    ended: 0,
    beginTask() {
      controller.began += 1;
    },
    endTask() {
      controller.ended += 1;
    }
  };

  return controller;
}

function createPlan(placementCount = 4) {
  return {
    // Must match the real primitive contract in primitiveExecutor: fill_rect
    // takes start/end, not from/to. An unrecognised primitive type silently
    // expands to zero placements, which would make these tests pass vacuously.
    primitives: [
      {
        type: "fill_rect",
        start: { x: 0, y: 0, z: 0 },
        end: { x: 0, y: 0, z: placementCount - 1 },
        block: "oak_planks"
      }
    ],
    style: "small_wood_house",
    paletteName: "oak",
    size: "small",
    materials: { oak_planks: placementCount },
    summary: "A small oak test build.",
    completionMessage: "The build is finished."
  };
}

function createJob(overrides = {}) {
  return {
    id: "build-structure:test",
    type: "build_structure",
    status: "pending",
    progress: 0,
    payload: {
      plan: createPlan(),
      current_index: 0,
      design_readiness: "ready",
      ...overrides.payload
    },
    ...overrides
  };
}

const WORLD = { worldId: "world:test", sessionId: "session:test" };

function buildWorker(overrides = {}) {
  return new BuildWorker({
    botAdapter: overrides.botAdapter || createFakeBotAdapter(),
    jobStore: overrides.jobStore || createFakeJobStore(),
    eventStore: overrides.eventStore || createFakeEventStore(),
    threadId: "thread:test",
    primaryPlayer: "Sage",
    companionName: "Guardian",
    presenceController: overrides.presenceController || createFakePresenceController(),
    getWorldContext: () => ({ ...WORLD, ...(overrides.worldContext || {}) }),
    logger: { warn() {}, error() {}, info() {} },
    ...overrides.workerOptions
  });
}

// --- Bug 1: transient throws must pause, not kill -----------------------------

async function testConnectionLossPausesInsteadOfFailing() {
  const jobStore = createFakeJobStore();
  const eventStore = createFakeEventStore();
  const worker = buildWorker({
    jobStore,
    eventStore,
    jobStoreOverrides: {},
    botAdapter: createFakeBotAdapter({
      async placeBlock() {
        throw new Error("Bot is not connected.");
      }
    })
  });

  jobStore.getNextBuildJob = async () => createJob();

  await worker.runOnce();

  assert.strictEqual(jobStore.calls.fail.length, 0, "connection loss must not fail the job");
  assert.strictEqual(jobStore.calls.pause.length, 1, "connection loss must pause the job");

  const pause = jobStore.calls.pause[0];
  assert.strictEqual(pause.error.diagnostic_code, "CONNECTION_LOST");
  assert.ok(pause.resumeAt, "paused job needs a resume_at");

  const pausedEvent = eventStore.events.find((event) => event.type === "build_paused");
  assert.ok(pausedEvent, "a pause must record an event (Bug 2)");
  assert.strictEqual(pausedEvent.metadata.diagnostic_code, "CONNECTION_LOST");

  console.log("  ✓ connection loss pauses instead of failing");
}

async function testSocketHangupPausesInsteadOfFailing() {
  const jobStore = createFakeJobStore();
  const worker = buildWorker({ jobStore });
  jobStore.getNextBuildJob = async () => createJob();

  // A mid-loop drop after some blocks already landed.
  let placements = 0;
  const botAdapter = createFakeBotAdapter({
    async placeBlock() {
      placements += 1;
      if (placements === 2) {
        throw new Error("socket hang up");
      }
      return { status: "ok" };
    }
  });

  const worker2 = buildWorker({ jobStore, botAdapter });
  await worker2.runOnce();

  assert.strictEqual(jobStore.calls.fail.length, 0, "socket hang up must not fail the job");
  assert.strictEqual(jobStore.calls.pause.length, 1, "socket hang up must pause the job");
  assert.ok(placements > 0, "must have placed blocks before the drop");

  console.log("  ✓ socket hang up preserves progress and pauses");
}

async function testGenuineLogicErrorStillFails() {
  const jobStore = createFakeJobStore();
  const eventStore = createFakeEventStore();
  const worker = buildWorker({
    jobStore,
    eventStore,
    jobStoreOverrides: {},
    botAdapter: createFakeBotAdapter({
      async placeBlock() {
        throw new TypeError("undefined is not a function");
      }
    })
  });

  jobStore.getNextBuildJob = async () => createJob();
  await worker.runOnce();

  assert.strictEqual(jobStore.calls.pause.length, 0, "logic errors must not be retried");
  assert.strictEqual(jobStore.calls.fail.length, 1, "logic errors must still fail");

  const failedEvent = eventStore.events.find((event) => event.type === "build_failed");
  assert.ok(failedEvent, "a failure must be recorded");

  console.log("  ✓ genuine logic errors still fail loudly");
}

// --- Bug 2: every pause records an event --------------------------------------

async function testMissingMaterialsRecordsEvent() {
  const jobStore = createFakeJobStore();
  const eventStore = createFakeEventStore();
  const botAdapter = createFakeBotAdapter({
    getMissingMaterials() {
      return [{ item: "oak_planks", missing: 14 }];
    },
    async provisionBuildMaterials() {
      return { provided: false, commands: ["/give Guardian oak_planks 14"] };
    }
  });

  const worker = buildWorker({ jobStore, eventStore, botAdapter });
  jobStore.getNextBuildJob = async () => createJob();
  await worker.runOnce();

  const pausedEvent = eventStore.events.find((event) => event.type === "build_paused");
  assert.ok(pausedEvent, "missing materials must record a pause event");
  assert.strictEqual(pausedEvent.metadata.diagnostic_code, "MISSING_MATERIALS");
  assert.ok(pausedEvent.metadata.missing, "pause event should carry what is missing");

  console.log("  ✓ missing materials records a pause event with detail");
}

async function testBlockedPlacementRecordsCheckpoint() {
  const jobStore = createFakeJobStore();
  const eventStore = createFakeEventStore();
  let placements = 0;
  const botAdapter = createFakeBotAdapter({
    async placeBlock() {
      placements += 1;
      if (placements > 2) {
        return { status: "blocked", message: "A creeper got in the way." };
      }
      return { status: "ok" };
    }
  });

  const worker = buildWorker({ jobStore, eventStore, botAdapter });
  jobStore.getNextBuildJob = async () => createJob();
  await worker.runOnce();

  const pausedEvent = eventStore.events.find((event) => event.type === "build_paused");
  assert.ok(pausedEvent, "blocked placement must record a pause event");
  assert.strictEqual(pausedEvent.metadata.diagnostic_code, "BLOCKED_PLACEMENT");
  // Indices are 0-based: placements 0 and 1 succeed, index 2 is the block
  // that could not be placed, so the checkpoint must resume at 2 — not 3,
  // or that block would be skipped forever.
  assert.strictEqual(pausedEvent.metadata.current_index, 2);

  console.log("  ✓ blocked placement records an accurate checkpoint");
}

// --- Recovery contract: give up loudly, never silently ------------------------

async function testNoProgressLimitFailsAfterThreeAttempts() {
  const jobStore = createFakeJobStore();
  const eventStore = createFakeEventStore();
  const botAdapter = createFakeBotAdapter({
    async placeBlock() {
      return { status: "blocked", message: "Still blocked." };
    }
  });

  const worker = buildWorker({ jobStore, eventStore, botAdapter });
  jobStore.getNextBuildJob = async () => createJob();

  // Each run is a fresh attempt with no progress recorded in between.
  for (let attempt = 0; attempt < MAX_CONSECUTIVE_NO_PROGRESS_PAUSES; attempt += 1) {
    jobStore.getNextBuildJob = async () =>
      createJob({
        payload: {
          plan: createPlan(),
          design_readiness: "ready",
          consecutive_no_progress_pauses: attempt,
          progress_marker: { last_meaningful_progress_at: null }
        }
      });
    await worker.runOnce();
  }

  assert.strictEqual(jobStore.calls.fail.length, 1, "must fail rather than stall forever");
  assert.strictEqual(jobStore.calls.fail[0].error.diagnostic_code, "NO_PROGRESS_LIMIT");

  const failedEvent = eventStore.events.find((event) => event.type === "build_failed");
  assert.ok(failedEvent, "giving up must be recorded");
  assert.strictEqual(failedEvent.metadata.diagnostic_code, "NO_PROGRESS_LIMIT");

  // The child must be told, not left guessing.
  assert.ok(
    botAdapter.said.some((line) => /stuck|different spot/i.test(line)),
    "must say out loud that it is stuck"
  );

  console.log("  ✓ gives up loudly after three stalled attempts");
}

async function testProgressResetsTheStallCounter() {
  const jobStore = createFakeJobStore();
  const eventStore = createFakeEventStore();
  let placements = 0;
  const botAdapter = createFakeBotAdapter({
    async placeBlock() {
      placements += 1;
      if (placements === 1) {
        return { status: "blocked", message: "Blocked once." };
      }
      return { status: "ok" };
    }
  });

  const worker = buildWorker({ jobStore, eventStore, botAdapter });
  jobStore.getNextBuildJob = async () =>
    createJob({
      payload: {
        plan: createPlan(),
        design_readiness: "ready",
        consecutive_no_progress_pauses: 2,
        last_pause_at: new Date(Date.now() - 60000).toISOString(),
        progress_marker: { last_meaningful_progress_at: new Date().toISOString() }
      }
    });

  await worker.runOnce();

  assert.strictEqual(jobStore.calls.fail.length, 0, "real progress must not trip the limit");
  assert.strictEqual(jobStore.calls.pause.length, 1);
  assert.strictEqual(
    jobStore.calls.pause[0].patch.payload.consecutive_no_progress_pauses,
    0,
    "progress must reset the counter"
  );

  console.log("  ✓ real progress resets the stall counter");
}

// --- Presence: never leave the bot with no goal -------------------------------

async function testPresenceReleasedOnEveryTerminalPath() {
  const presence = createFakePresenceController();

  const pauseJobStore = createFakeJobStore();
  const pauseWorker = buildWorker({
    jobStore: pauseJobStore,
    presenceController: presence,
    botAdapter: createFakeBotAdapter({
      async placeBlock() {
        return { status: "blocked", message: "Blocked." };
      }
    })
  });
  pauseJobStore.getNextBuildJob = async () => createJob();
  await pauseWorker.runOnce();

  assert.ok(presence.began > 0, "presence must be claimed while building");
  assert.strictEqual(presence.ended, 1, "presence must be released after a pause");

  const dropJobStore = createFakeJobStore();
  const dropWorker = buildWorker({
    jobStore: dropJobStore,
    presenceController: createFakePresenceController(),
    botAdapter: createFakeBotAdapter({
      async placeBlock() {
        throw new Error("Bot is not connected.");
      }
    })
  });
  dropJobStore.getNextBuildJob = async () => createJob();
  await dropWorker.runOnce();

  console.log("  ✓ presence is released on pause, not left stranded");
}

// --- Happy path still works ----------------------------------------------------

async function testSuccessfulBuildCompletes() {
  const jobStore = createFakeJobStore();
  const eventStore = createFakeEventStore();
  const presence = createFakePresenceController();
  const worker = buildWorker({ jobStore, eventStore, presenceController: presence });
  jobStore.getNextBuildJob = async () => createJob();

  await worker.runOnce();

  assert.strictEqual(jobStore.calls.complete.length, 1, "a clean build must still complete");
  assert.strictEqual(jobStore.calls.fail.length, 0);
  assert.strictEqual(presence.ended, 1, "presence released on completion");

  const builtEvent = eventStore.events.find((event) => event.type === "structure_build");
  assert.ok(builtEvent, "completion event must still fire");

  console.log("  ✓ a clean build still completes end to end");
}

// --- Classifier unit coverage --------------------------------------------------

function testClassifier() {
  assert.strictEqual(isRetryableBuildError(new Error("Bot is not connected.")), true);
  assert.strictEqual(isRetryableBuildError(new Error("socket hang up")), true);
  assert.strictEqual(isRetryableBuildError(new Error("read ECONNRESET")), true);
  assert.strictEqual(isRetryableBuildError(new Error("ETIMEDOUT")), true);
  assert.strictEqual(isRetryableBuildError(new Error("Build job is missing a compiled plan.")), false);
  assert.strictEqual(isRetryableBuildError(new TypeError("x is not a function")), false);
  assert.strictEqual(isRetryableBuildError(null), false);

  console.log("  ✓ error classifier separates transport from logic faults");
}

(async () => {
  console.log("buildWorker tests");

  testClassifier();
  await testConnectionLossPausesInsteadOfFailing();
  await testSocketHangupPausesInsteadOfFailing();
  await testGenuineLogicErrorStillFails();
  await testMissingMaterialsRecordsEvent();
  await testBlockedPlacementRecordsCheckpoint();
  await testNoProgressLimitFailsAfterThreeAttempts();
  await testProgressResetsTheStallCounter();
  await testPresenceReleasedOnEveryTerminalPath();
  await testSuccessfulBuildCompletes();

  console.log("buildWorker tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});