const assert = require("assert");

const { BuildWorker } = require("../builder/buildWorker");
const { compileStructure } = require("../builder/structureCompiler");

// --- Regression: one blocked block must not zero the whole build -------------
//
// Every build failure in this world ended the same way: zero blocks placed,
// NO_PROGRESS_LIMIT. The footprint inspection listed obstructions, so the first
// unplaceable position aborted the entire job and retried the same index.
//
// That is a guaranteed deadlock. Retrying an identical step either works on the
// first try or never works at all, so a position that is unreachable (buried,
// enclosed) blocks the structure forever. One buried block in a 6x5 footprint
// zeroed out a whole house.
//
// `blocked` must now SKIP and keep going. `needs_materials` still pauses and
// retries, because restocking genuinely can fix that one.

function makeWorker(placeBlockImpl) {
  const worker = Object.create(BuildWorker.prototype);

  worker.logger = { warn: () => {}, info: () => {}, error: () => {} };
  worker.skippedPlacements = [];
  worker.safeSay = async () => {};
  worker.safeRecordEvent = async () => {};
  worker.eventStore = { recordEvent: async () => {} };
  worker.getWorldContext = () => ({ worldId: "w", sessionId: "s" });
  worker.evaluateBuildProgress = () => ({ placed: 1, total: 1, ratio: 1 });
  worker.pauseAndReport = async () => {
    throw new Error("PAUSED");
  };
  worker.releasePresence = () => {};
  worker.claimPresence = () => {};

  const placements = [];

  worker.botAdapter = {
    stopPathing: () => {},
    getMissingMaterials: () => [],
    provisionBuildMaterials: async () => ({ provided: true, commands: [] }),
    placeBlock: async (block, absolute) => {
      placements.push(absolute);
      return placeBlockImpl(block, absolute, placements.length);
    },
    getSnapshot: () => ({ position: { x: 0, y: 64, z: 0 } }),
    // inspectFootprint needs a live bot; every position reads as air so the
    // site gate is satisfied and the placement loop is what these tests exercise.
    bot: {
      blockAt: () => ({ name: "air", boundingBox: "empty", diggable: true })
    }
  };

  worker.jobStore = {
    updateJob: async () => {},
    markRunning: async () => {},
    pauseJob: async () => {},
    getNextBuildJob: async () => null,
    failJob: async (id, payload) => {
      worker._failed = payload;
    },
    completeJob: async (id, payload) => {
      worker._completed = payload;
    }
  };

  return { worker, placements };
}

// Use a genuinely compiled plan rather than a hand-rolled stub: the placement
// count has to be real for "every position is still attempted" to mean anything.
const PLAN = compileStructure({ size: { width: 3, depth: 3, height: 2 }, direction: "north" });
const EXPECTED_PLACEMENTS = require("../builder/buildWorker").__testPlacements
  ? require("../builder/buildWorker").__testPlacements(PLAN)
  : null;

function makeJob() {
  return {
    id: "job:test",
    status: "running",
    payload: { current_index: 0, origin: { x: 0, y: 64, z: 0 }, plan: PLAN }
  };
}

console.log("buildWorker blocked-skip tests");

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

  await check("one blocked block does not abort the build", async () => {
    let call = 0;
    const { worker, placements } = makeWorker(() => {
      call += 1;
      // The middle placement is unreachable; everything else is fine.
      if (call === 3) {
        return { status: "blocked", message: "cannot reach" };
      }
      return { status: "placed" };
    });

    await worker.executeJob(makeJob(), { worldId: "w", sessionId: "s" });

    assert.ok(
      placements.length > 10,
      `every position must still be attempted, got ${placements.length}`
    );
    assert.strictEqual(worker._completed.completed, true, "the job must complete");
    assert.strictEqual(worker._completed.skipped, 1, "and record exactly one skip");
  });

  await check("skipped blocks are recorded with their position", async () => {
    let call = 0;
    const { worker } = makeWorker(() => {
      call += 1;
      return call === 2 ? { status: "blocked", message: "unreachable" } : { status: "placed" };
    });

    await worker.executeJob(makeJob(), { worldId: "w", sessionId: "s" });

    assert.strictEqual(worker.skippedPlacements.length, 1);
    assert.ok(
      typeof worker.skippedPlacements[0].block === "string",
      "must record which block was skipped"
    );
    assert.ok(worker.skippedPlacements[0].position, "must record where it was skipped");
  });

  await check("the completion message admits the gap", async () => {
    let said = "";
    let call = 0;
    const { worker } = makeWorker(() => {
      call += 1;
      return call === 1 ? { status: "blocked" } : { status: "placed" };
    });
    worker.safeSay = async (line) => {
      said = line;
    };

    await worker.executeJob(makeJob(), { worldId: "w", sessionId: "s" });

    assert.ok(/couldn't get to/i.test(said), `must disclose the skip, said: "${said}"`);
  });

  await check("missing materials still pauses and retries", async () => {
    // The distinction that matters: restocking CAN fix this one, so pausing is
    // correct behaviour and must not be converted into a silent skip.
    const { worker, placements } = makeWorker(() => ({
      status: "needs_materials",
      message: "out of cobblestone"
    }));

    let paused = false;
    worker.pauseAndReport = async (job, context, detail) => {
      paused = true;
      worker._pauseDetail = detail;
    };

    await worker.executeJob(makeJob(), { worldId: "w", sessionId: "s" });

    assert.ok(paused, "must pause instead of skipping");
    assert.strictEqual(
      worker._pauseDetail.diagnosticCode,
      "MISSING_MATERIALS",
      "and classify it as a materials problem"
    );
    assert.strictEqual(placements.length, 1, "must stop at the first missing material");
    assert.strictEqual(worker.skippedPlacements.length, 0, "and must not count it as skipped");
  });

  await check("a build with nothing blocked reports no skips", async () => {
    const { worker } = makeWorker(() => ({ status: "placed" }));

    await worker.executeJob(makeJob(), { worldId: "w", sessionId: "s" });

    assert.strictEqual(worker._completed.skipped, 0);
  });

  await check("skips do not leak between jobs", async () => {
    let call = 0;
    const { worker } = makeWorker(() => {
      call += 1;
      return call === 1 ? { status: "blocked" } : { status: "placed" };
    });

    await worker.executeJob(makeJob(), { worldId: "w", sessionId: "s" });
    assert.strictEqual(worker._completed.skipped, 1);

    await worker.executeJob(makeJob(), { worldId: "w", sessionId: "s" });
    assert.strictEqual(
      worker._completed.skipped,
      0,
      "a second, clean build must not inherit the first job's skips"
    );
  });

  console.log(`buildWorker blocked-skip tests ${failed === 0 ? "passed" : "FAILED"} (${passed} passed, ${failed} failed)`);
}

run();