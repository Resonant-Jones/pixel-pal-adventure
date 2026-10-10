const { expandPrimitives } = require("./primitiveExecutor");
const { evaluateBuildProgress, buildFeedbackPacket } = require("./buildFeedback");
const { inspectFootprint } = require("./siteInspector");
const {
  RETRYABLE_DELAY_MS,
  isRetryableBuildError,
  describeBuildError
} = require("./buildJobErrors");

const BUILD_SITE_RETRY_DELAY_MS = 30000;
const BUILD_BLOCKED_RETRY_DELAY_MS = 30000;
const BUILD_MATERIAL_RETRY_DELAY_MS = 120000;

// Recovery contract: a build may pause at most this many consecutive times
// without any meaningful world progress. On the next pause it fails loudly
// with a recorded reason instead of stalling forever. The child must never
// experience a bot that quietly gives up.
const MAX_CONSECUTIVE_NO_PROGRESS_PAUSES = 3;

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

function toIso(value = new Date()) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
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
    presenceController = null,
    maxConsecutiveNoProgressPauses = MAX_CONSECUTIVE_NO_PROGRESS_PAUSES,
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
    this.presenceController = presenceController;
    this.maxConsecutiveNoProgressPauses = maxConsecutiveNoProgressPauses;
    this.logger = logger;
    this.running = false;
  }

  async runOnce() {
    if (this.running || this.botAdapter?.survivalLease) {
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
      // Bug 1 fix: a dropped connection must not permanently kill a build.
      // Route transport failures back to `paused` so the worker resumes the
      // job from its checkpoint instead of abandoning it forever.
      if (isRetryableBuildError(error)) {
        const classification = describeBuildError(error);
        this.logger.warn?.(
          "[build] Retryable failure, pausing job instead of failing:",
          error?.message || error
        );
        await this.handleRetryableFailure(job, context, error, classification);
        return false;
      }

      this.logger.error("[build] Worker failed:", error);
      await this.safeRecordEvent(context, "build_failed", {
        description: `Build failed: ${error.message}`,
        metadata: {
          jobId: String(job.id),
          diagnostic_code: "UNHANDLED_BUILD_ERROR"
        }
      });
      await this.jobStore.failJob(job.id, {
        message: error.message
      });
      this.releasePresence();
      return false;
    } finally {
      this.running = false;
    }
  }

  async handleRetryableFailure(job, context, error, classification) {
    const diagnosticCode = error.code === "survival_interrupted" ? "SURVIVAL_INTERRUPTED" : "CONNECTION_LOST";
    const reason = error.code === "survival_interrupted" ? "self-preservation" : "connection loss";
    const resumeAt = toIso(Date.now() + RETRYABLE_DELAY_MS);

    try {
      await this.jobStore.pauseJob(
        job.id,
        {
          message: error.message,
          diagnostic_code: diagnosticCode,
          error_code: classification?.errorCode || null,
          error_category: classification?.errorCategory || null
        },
        resumeAt,
        {
          payload: {
            ...job.payload,
            current_index: Number(job.payload?.current_index || 0),
            design_readiness: job.payload?.design_readiness || "ready",
            consecutive_no_progress_pauses: Number(
              job.payload?.consecutive_no_progress_pauses || 0
            ),
            last_failure: {
              diagnostic_code: diagnosticCode,
              message: error.message,
              error_code: classification?.errorCode || null
            }
          }
        }
      );
    } catch (pauseError) {
      this.logger.error(`[build] Could not pause job after ${reason}:`, pauseError);
    }

    await this.safeRecordEvent(context, "build_paused", {
      description: `Build paused after ${reason}: ${error.message}`,
      metadata: {
        jobId: String(job.id),
        diagnostic_code: diagnosticCode,
        error_code: classification?.errorCode || null,
        current_index: Number(job.payload?.current_index || 0),
        resume_at: resumeAt
      }
    });

    this.releasePresence();
  }

  async safeRecordEvent(context, type, fields = {}) {
    if (!this.eventStore?.recordEvent) {
      return null;
    }

    try {
      return await this.eventStore.recordEvent({
        threadId: this.threadId,
        worldId: context.worldId,
        sessionId: context.sessionId,
        type,
        actor: this.companionName,
        snapshot: this.safeSnapshot(),
        ...fields
      });
    } catch (error) {
      this.logger.warn?.(`[build] Failed to record ${type} event:`, error?.message || error);
      return null;
    }
  }

  safeSnapshot() {
    try {
      return this.botAdapter.getSnapshot();
    } catch (error) {
      return null;
    }
  }

  // The bot must never be left with no pathfinding goal after a task ends.
  releasePresence() {
    try {
      this.presenceController?.endTask?.();
    } catch (error) {
      this.logger.warn?.("[build] presence release failed:", error?.message || error);
    }
  }

  claimPresence() {
    try {
      this.presenceController?.beginTask?.();
    } catch (error) {
      this.logger.warn?.("[build] presence claim failed:", error?.message || error);
    }
  }

  // Track how many pauses in a row produced no world progress so the job can
  // fail loudly instead of retrying forever.
  async recordPause(context, job, { diagnosticCode, message, extra = {}, origin = null }) {
    const currentIndex = Number(job.payload?.current_index || 0);
    const previousProgressAt = job.payload?.progress_marker?.last_meaningful_progress_at || null;
    const progressedSinceLastPause =
      previousProgressAt && job.payload?.last_pause_at
        ? new Date(previousProgressAt) > new Date(job.payload.last_pause_at)
        : Boolean(previousProgressAt);

    const consecutivePauses = progressedSinceLastPause
      ? 0
      : Number(job.payload?.consecutive_no_progress_pauses || 0) + 1;

    const pausePayload = {
      ...job.payload,
      current_index: currentIndex,
      origin: origin || job.payload?.origin || null,
      design_readiness: job.payload?.design_readiness || "ready",
      consecutive_no_progress_pauses: consecutivePauses,
      last_pause_at: toIso(),
      last_failure: {
        diagnostic_code: diagnosticCode,
        message
      },
      ...extra
    };

    // Recovery contract: third consecutive stall is terminal, but loudly.
    if (consecutivePauses >= this.maxConsecutiveNoProgressPauses) {
      await this.safeRecordEvent(context, "build_failed", {
        description: `Build gave up after ${consecutivePauses} stalled attempts: ${message}`,
        location: origin || job.payload?.origin || null,
        metadata: {
          jobId: String(job.id),
          diagnostic_code: "NO_PROGRESS_LIMIT",
          consecutive_no_progress_pauses: consecutivePauses,
          last_diagnostic_code: diagnosticCode,
          current_index: currentIndex
        }
      });

      await this.safeSay(
        `I'm stuck on this one — ${consecutivePauses} tries with no luck. Want to try a different spot?`
      );

      await this.jobStore.failJob(job.id, {
        message: `No build progress after ${consecutivePauses} consecutive attempts.`,
        diagnostic_code: "NO_PROGRESS_LIMIT",
        consecutive_no_progress_pauses: consecutivePauses,
        last_diagnostic_code: diagnosticCode
      });

      this.releasePresence();
      return { failed: true, consecutivePauses };
    }

    return { failed: false, consecutivePauses, pausePayload };
  }

  async safeSay(message) {
    if (!message) {
      return;
    }

    try {
      await this.botAdapter.say(message);
    } catch (error) {
      this.logger.warn?.("[build] say failed:", error?.message || error);
    }
  }

  async executeJob(job, context) {
    if (typeof this.botAdapter.stopPathing === "function") {
      this.botAdapter.stopPathing();
    }

    this.claimPresence();

    const plan = job.payload?.plan;
    if (!plan?.primitives?.length) {
      await this.safeRecordEvent(context, "build_failed", {
        description: "Build job is missing a compiled plan.",
        metadata: {
          jobId: String(job.id),
          diagnostic_code: "MISSING_PLAN"
        }
      });
      await this.jobStore.failJob(job.id, {
        message: "Build job is missing a compiled plan.",
        diagnostic_code: "MISSING_PLAN"
      });
      this.releasePresence();
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
      await this.safeSay("I couldn't find a clear place nearby to build that.");
      await this.pauseAndReport(job, context, {
        diagnosticCode: "NO_BUILD_SITE",
        message: "No valid build site found.",
        resumeDelayMs: BUILD_SITE_RETRY_DELAY_MS
      });
      return;
    }

    const siteInspection = inspectFootprint(this.botAdapter, origin, placementPlan.footprint);
    if (!siteInspection.ok) {
      await this.safeSay("That spot is too cluttered for the build.");
      await this.pauseAndReport(job, context, {
        diagnosticCode: "SITE_OBSTRUCTED",
        message: "Build site rejected.",
        resumeDelayMs: BUILD_SITE_RETRY_DELAY_MS,
        origin,
        extra: { inspection: siteInspection }
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
        await this.safeSay(formatMissingMaterials(missing, provision.commands));
        await this.pauseAndReport(job, context, {
          diagnosticCode: "MISSING_MATERIALS",
          message: "Missing materials.",
          resumeDelayMs: BUILD_MATERIAL_RETRY_DELAY_MS,
          origin,
          extra: { missing, commands: provision.commands }
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
        const diagnosticCode =
          result.status === "needs_materials" ? "MISSING_MATERIALS" : "BLOCKED_PLACEMENT";

        await this.safeSay(result.message || "I got stuck while building.");
        await this.pauseAndReport(job, context, {
          diagnosticCode,
          message: result.message || "Blocked during build.",
          resumeDelayMs:
            result.status === "needs_materials"
              ? BUILD_MATERIAL_RETRY_DELAY_MS
              : BUILD_BLOCKED_RETRY_DELAY_MS,
          origin,
          forcedIndex: index,
          extra: { placement: absolute }
        });
        return;
      }

      if (index === startIndex || index % 8 === 0 || index === expanded.placements.length - 1) {
        const progress = evaluateBuildProgress({
          botAdapter: this.botAdapter,
          origin,
          placements: expanded.placements
        });
        const feedbackPacket = buildFeedbackPacket(progress);

        await this.jobStore.updateJob(job.id, {
          progress: percentage(index + 1, expanded.placements.length),
          payload: {
            ...job.payload,
            origin,
            current_index: index + 1,
            design_readiness: job.payload?.design_readiness || "ready",
            feedback_summary: feedbackPacket?.summary || null,
            feedback_packet: feedbackPacket || null,
            progress_marker: {
              completion_percent: progress.completion_percent,
              missing_blocks_count: progress.missing_blocks_count,
              wrong_blocks_count: progress.wrong_blocks_count,
              last_meaningful_progress_at: progress.last_meaningful_progress_at
            }
          }
        });

        // Keep the in-memory job payload in step with what we just wrote, so
        // a later pause in this same run sees an accurate checkpoint.
        job.payload = {
          ...job.payload,
          origin,
          current_index: index + 1,
          progress_marker: {
            completion_percent: progress.completion_percent,
            missing_blocks_count: progress.missing_blocks_count,
            wrong_blocks_count: progress.wrong_blocks_count,
            last_meaningful_progress_at: progress.last_meaningful_progress_at
          }
        };
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

    await this.safeSay(plan.completionMessage || "The build is finished.");
    await this.jobStore.completeJob(job.id, {
      origin,
      completed: true,
      style: plan.style,
      materials: plan.materials
    });

    this.releasePresence();
  }

  // Single funnel for every pause path so the event is always recorded and the
  // no-progress contract is always applied. Bug 2 fix: pauses were previously
  // invisible — the only build event ever emitted was `structure_build` on
  // success, so a stalled build looked like it never happened.
  async pauseAndReport(job, context, {
    diagnosticCode,
    message,
    resumeDelayMs,
    origin = null,
    forcedIndex = null,
    extra = {}
  }) {
    const jobWithIndex = forcedIndex === null
      ? job
      : { ...job, payload: { ...job.payload, current_index: forcedIndex } };

    const outcome = await this.recordPause(context, jobWithIndex, {
      diagnosticCode,
      message,
      origin,
      extra
    });

    if (outcome.failed) {
      return outcome;
    }

    const resumeAt = toIso(Date.now() + resumeDelayMs);

    await this.jobStore.pauseJob(
      job.id,
      {
        message,
        diagnostic_code: diagnosticCode,
        ...extra
      },
      resumeAt,
      {
        payload: {
          ...outcome.pausePayload,
          resume_at: resumeAt
        }
      }
    );

    await this.safeRecordEvent(context, "build_paused", {
      description: `Build paused (${diagnosticCode}): ${message}`,
      location: origin || job.payload?.origin || null,
      metadata: {
        jobId: String(job.id),
        diagnostic_code: diagnosticCode,
        message,
        current_index: Number(outcome.pausePayload.current_index || 0),
        consecutive_no_progress_pauses: outcome.consecutivePauses,
        resume_at: resumeAt,
        missing: extra.missing || null,
        placement: extra.placement || null
      }
    });

    this.releasePresence();

    return outcome;
  }
}

module.exports = {
  BuildWorker,
  MAX_CONSECUTIVE_NO_PROGRESS_PAUSES
};
