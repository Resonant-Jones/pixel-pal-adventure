const { expandPrimitives } = require("./primitiveExecutor");

function materialRequirements(materials = {}) {
  return Object.entries(materials).map(([item, count]) => ({ item, count }));
}

function percentage(completed, total) {
  if (!total) {
    return 100;
  }

  return Math.min(100, Math.round((completed / total) * 100));
}

function formatMissingMaterials(missing, commands = []) {
  const summary = missing.map((item) => `${item.missing} ${item.item}`).join(", ");
  if (!commands.length) {
    return `I need ${summary} before I can keep building.`;
  }

  const commandText = commands.slice(0, 2).join(" then ");
  return `I need ${summary}. Try ${commandText}`;
}

class BuildWorker {
  constructor({
    botAdapter,
    jobStore,
    eventStore,
    threadId,
    primaryPlayer = "Sage",
    companionName = "Guardian",
    getWorldContext,
    allowAutoGiveBuildMaterials = false,
    debugBuildPlans = false,
    logger = console
  }) {
    this.botAdapter = botAdapter;
    this.jobStore = jobStore;
    this.eventStore = eventStore;
    this.threadId = threadId;
    this.primaryPlayer = primaryPlayer;
    this.companionName = companionName;
    this.getWorldContext = getWorldContext;
    this.allowAutoGiveBuildMaterials = allowAutoGiveBuildMaterials;
    this.debugBuildPlans = debugBuildPlans;
    this.logger = logger;
    this.running = false;
  }

  async runOnce() {
    if (this.running) {
      return false;
    }

    const context = this.getWorldContext();
    if (!context?.worldId || !context?.sessionId) {
      return false;
    }

    const job = await this.jobStore.getNextBuildJob(context.worldId);
    if (!job) {
      return false;
    }

    this.running = true;

    try {
      await this.jobStore.markRunning(job.id);
      await this.executeJob(job, context);
      return true;
    } catch (error) {
      this.logger.error("[build] Worker failed:", error);
      await this.jobStore.failJob(job.id, {
        message: error.message
      });
      return false;
    } finally {
      this.running = false;
    }
  }

  async executeJob(job, context) {
    const plan = job.payload?.plan;
    if (!plan?.primitives?.length) {
      await this.jobStore.failJob(job.id, {
        message: "Build job is missing a compiled plan."
      });
      return;
    }

    const expanded = expandPrimitives(plan.primitives, {
      direction: plan.direction
    });
    const placementPlan = {
      placements: expanded.placements,
      footprint: expanded.footprint
    };
    const requestedBy = job.payload?.requestedBy || this.primaryPlayer;
    const origin =
      job.payload?.origin ||
      job.payload?.location ||
      this.botAdapter.findDirectionalBuildSite(placementPlan, requestedBy) ||
      this.botAdapter.findFlatBuildSite(placementPlan, requestedBy, 12);

    if (!origin) {
      await this.botAdapter.say("I couldn't find a clear place nearby to build that.");
      await this.jobStore.failJob(job.id, {
        message: "No valid build site found."
      });
      return;
    }

    if (this.debugBuildPlans) {
      this.logger.info("[build] Plan", {
        jobId: String(job.id),
        style: plan.style,
        palette: plan.paletteName,
        size: plan.size,
        materials: plan.materials,
        footprint: plan.footprint,
        primitives: plan.primitives.length
      });
    }

    const requirements = materialRequirements(plan.materials);
    let missing = this.botAdapter.getMissingMaterials(requirements);

    if (missing.length) {
      const provision = await this.botAdapter.provisionBuildMaterials(missing, {
        autoGive: this.allowAutoGiveBuildMaterials && requestedBy === this.primaryPlayer
      });

      if (provision.provided) {
        missing = this.botAdapter.getMissingMaterials(requirements);
      }

      if (missing.length) {
        await this.botAdapter.say(formatMissingMaterials(missing, provision.commands));
        await this.jobStore.failJob(job.id, {
          message: "Missing materials.",
          missing,
          commands: provision.commands
        });
        return;
      }
    }

    const startIndex = Number(job.payload?.current_index || 0);

    for (let index = startIndex; index < expanded.placements.length; index += 1) {
      const placement = expanded.placements[index];
      const absolute = {
        x: origin.x + placement.x,
        y: origin.y + placement.y,
        z: origin.z + placement.z
      };

      const result = await this.botAdapter.placeBlock(placement.block, absolute);

      if (result.status === "needs_materials" || result.status === "blocked") {
        await this.botAdapter.say(result.message || "I got stuck while building.");
        await this.jobStore.failJob(job.id, {
          message: result.message || "Blocked during build.",
          placement: absolute,
          current_index: index
        });
        return;
      }

      if (index === startIndex || index % 8 === 0 || index === expanded.placements.length - 1) {
        await this.jobStore.updateJob(job.id, {
          progress: percentage(index + 1, expanded.placements.length),
          payload: {
            ...job.payload,
            origin,
            current_index: index + 1
          }
        });
      }
    }

    await this.eventStore.recordEvent({
      threadId: this.threadId,
      worldId: context.worldId,
      sessionId: context.sessionId,
      type: "structure_build",
      description: plan.summary,
      actor: this.companionName,
      location: origin,
      snapshot: this.botAdapter.getSnapshot(),
      metadata: {
        jobId: String(job.id),
        style: plan.style,
        palette: plan.paletteName,
        size: plan.size,
        materials: plan.materials
      }
    });

    await this.botAdapter.say(plan.completionMessage || "The build is finished.");
    await this.jobStore.completeJob(job.id, {
      origin,
      completed: true,
      style: plan.style,
      materials: plan.materials
    });
  }
}

module.exports = {
  BuildWorker
};
