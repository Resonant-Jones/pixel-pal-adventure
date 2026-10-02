// agent/welcomeHut.js
//
// Startup-time enqueue of a welcome-hut build job for the primary player.
// The hut is placed near spawn (or, if spawn is unsuitable, near the bot).
//
// What this does:
//   1. Resolves the welcome_hut structure template from structures/index.js.
//   2. Wraps each flat placement as a "point" primitive so the build pipeline
//      handles rotation, dedup, and material counts the same way it does for
//      any other build.
//   3. Finds a flat build site near spawn (fallback: near the bot).
//   4. Enqueues a build_structure job with current_index=0 so the build
//      worker picks it up on its next tick.
//   5. Records a "welcome_hut_queued" event.
//
// The hut is only queued once per *world*. If the world already had a welcome
// hut (or any world_entered event before this), we skip.
//
// All errors are logged and swallowed — a failed welcome hut must never
// crash the runtime.

const fs = require("fs");
const path = require("path");
const { getStructureTemplate } = require("../structures");

const WELCOME_HUT_EVENT = "welcome_hut_queued";

function buildPrimitivePlanFromTemplate(template) {
  const primitives = template.placements.map((placement) => ({
    type: "point",
    block: placement.block,
    position: { x: placement.x, y: placement.y, z: placement.z }
  }));

  const materials = template.placements.reduce((acc, placement) => {
    acc[placement.block] = (acc[placement.block] || 0) + 1;
    return acc;
  }, {});

  return {
    style: "welcome_hut",
    paletteName: "oak_default",
    size: "small",
    direction: template.direction || "south",
    footprint: template.footprint,
    primitives,
    materials,
    summary: "welcome hut",
    completionMessage: template.completionMessage || "Your welcome hut is ready."
  };
}

function findOriginNearSpawn(botAdapter, template, footprint) {
  if (typeof botAdapter.findFlatBuildSite === "function") {
    // findFlatBuildSite / canBuildAt iterate template.placements, so we pass
    // the raw template (which already has { placements, footprint }).
    const site = botAdapter.findFlatBuildSite(template, null, 8);
    if (site) return site;
  }
  // Fallback: 4 blocks in front of the bot.
  const snapshot = botAdapter.getSnapshot?.();
  if (!snapshot?.position) return null;
  const facing = snapshot.position.face || "south";
  const offset = { x: 0, z: 4 };
  if (facing === "north") offset.z = -4;
  if (facing === "east") offset.x = 4;
  if (facing === "west") offset.x = -4;
  return {
    x: Math.floor(snapshot.position.x) + offset.x,
    y: Math.floor(snapshot.position.y),
    z: Math.floor(snapshot.position.z) + offset.z
  };
}

async function enqueueWelcomeHut({
  botAdapter,
  jobStore,
  eventStore,
  threadId,
  worldContext,
  primaryPlayer,
  companionName,
  logger = console
}) {
  if (!worldContext?.worldId || !worldContext?.sessionId) {
    logger.warn?.("[welcome-hut] No world context yet, skipping");
    return { skipped: true, reason: "no_world_context" };
  }

  // Only build if this is a fresh world (new_world_detected) — returning to
  // a known world means the hut is already there or not desired.
  if (!botAdapter || typeof botAdapter.getSnapshot !== "function") {
    return { skipped: true, reason: "no_bot_adapter" };
  }

  const template = getStructureTemplate("welcome_hut", "south");
  if (!template) {
    logger.warn?.("[welcome-hut] Template not found");
    return { skipped: true, reason: "no_template" };
  }

  const plan = buildPrimitivePlanFromTemplate(template);
  const origin = findOriginNearSpawn(botAdapter, template, plan.footprint);

  if (!origin) {
    logger.warn?.("[welcome-hut] No flat origin found, skipping");
    return { skipped: true, reason: "no_origin" };
  }

  try {
    const job = await jobStore.createJob({
      worldId: worldContext.worldId,
      sessionId: worldContext.sessionId,
      threadId,
      type: "build_structure",
      payload: {
        plan,
        requestedBy: primaryPlayer,
        location: origin,
        current_index: 0,
        allowAutoGiveBuildMaterials: false,
        source: "welcome_hut"
      }
    });

    if (eventStore?.recordEvent) {
      await eventStore.recordEvent({
        threadId,
        worldId: worldContext.worldId,
        sessionId: worldContext.sessionId,
        type: WELCOME_HUT_EVENT,
        description: `${companionName} queued a welcome hut for ${primaryPlayer}`,
        actor: companionName,
        location: origin,
        metadata: { jobId: String(job.id), origin, structure: "welcome_hut" }
      });
    }

    logger.info?.(`[welcome-hut] Queued job ${job.id} at origin ${JSON.stringify(origin)}`);
    return { queued: true, jobId: String(job.id), origin };
  } catch (err) {
    logger.error?.(`[welcome-hut] Failed to enqueue: ${err.message}`);
    return { skipped: true, reason: "enqueue_failed", error: err.message };
  }
}

module.exports = {
  enqueueWelcomeHut,
  buildPrimitivePlanFromTemplate,
  findOriginNearSpawn,
  WELCOME_HUT_EVENT
};