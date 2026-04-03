const { renderReflexMessage } = require("./reflexTemplates");

function parseTime(value) {
  return value ? new Date(value).getTime() : 0;
}

class ReflexWorker {
  constructor({
    botAdapter,
    eventStore,
    jobStore,
    reflexStateStore,
    threadId,
    companionName = "Guardian",
    getWorldContext,
    globalCooldownMs = 60000,
    perTriggerCooldownMs = 180000,
    getReflexPolicy = () => ({ enabled: true, highSalienceOnly: false }),
    logger = console
  }) {
    this.botAdapter = botAdapter;
    this.eventStore = eventStore;
    this.jobStore = jobStore;
    this.reflexStateStore = reflexStateStore;
    this.threadId = threadId;
    this.companionName = companionName;
    this.getWorldContext = getWorldContext;
    this.globalCooldownMs = globalCooldownMs;
    this.perTriggerCooldownMs = perTriggerCooldownMs;
    this.getReflexPolicy = getReflexPolicy;
    this.logger = logger;
    this.running = false;
  }

  isHighSalience(job) {
    const reflexType = job?.payload?.reflex_type || "";
    return ["creeper_nearby", "mob_nearby", "player_health_low"].includes(reflexType);
  }

  async runOnce() {
    if (this.running) {
      return false;
    }

    const context = this.getWorldContext();
    if (!context?.worldId || !context?.sessionId) {
      return false;
    }

    const job = await this.jobStore.getNextPendingReflexJob(context.worldId);
    if (!job) {
      return false;
    }

    this.running = true;

    try {
      await this.jobStore.markRunning(job.id);

      const policy = this.getReflexPolicy();
      if (!policy?.enabled) {
        await this.jobStore.completeJob(job.id, {
          suppressed: true,
          reason: "narrative_reflex_disabled"
        });
        await this.markObserved(job, context.worldId);
        return true;
      }

      if (policy?.highSalienceOnly && !this.isHighSalience(job)) {
        await this.jobStore.completeJob(job.id, {
          suppressed: true,
          reason: "low_salience"
        });
        await this.markObserved(job, context.worldId);
        return true;
      }

      const suppressed = await this.shouldSuppress(job, context.worldId);
      if (suppressed) {
        await this.jobStore.completeJob(job.id, {
          suppressed: true,
          reason: suppressed.reason
        });
        await this.markObserved(job, context.worldId);
        return true;
      }

      const message = renderReflexMessage(job);
      if (!message) {
        await this.jobStore.completeJob(job.id, {
          suppressed: true,
          reason: "no_template"
        });
        await this.markObserved(job, context.worldId);
        return true;
      }

      await this.botAdapter.say(message);

      await this.eventStore.recordEvent({
        threadId: this.threadId,
        worldId: context.worldId,
        sessionId: context.sessionId,
        type: "reflex_triggered",
        description: message,
        actor: this.companionName,
        location: job.payload?.location || this.botAdapter.getSnapshot().position,
        snapshot: this.botAdapter.getSnapshot(),
        metadata: {
          jobId: String(job.id),
          reflexType: job.payload?.reflex_type,
          sourceEventId: job.payload?.source_event_id,
          jobType: job.type
        }
      });

      await this.markTriggered(job, context.worldId);
      await this.jobStore.completeJob(job.id, {
        suppressed: false,
        message
      });

      return true;
    } catch (error) {
      this.logger.error("[reflex] Worker failed:", error);
      await this.jobStore.failJob(job.id, {
        message: error.message
      });
      return false;
    } finally {
      this.running = false;
    }
  }

  async shouldSuppress(job, worldId) {
    const now = Date.now();
    const reflexType = job.payload?.reflex_type || "unknown";
    const globalState = await this.reflexStateStore.getState(worldId, "__global__");
    const triggerState = await this.reflexStateStore.getState(worldId, reflexType);

    const lastGlobal = parseTime(globalState?.last_reflex_at);
    if (lastGlobal && now - lastGlobal < this.globalCooldownMs) {
      return {
        reason: "global_cooldown"
      };
    }

    const lastTrigger = parseTime(triggerState?.last_reflex_at);
    if (lastTrigger && now - lastTrigger < this.perTriggerCooldownMs) {
      return {
        reason: "trigger_cooldown"
      };
    }

    return null;
  }

  async markObserved(job, worldId) {
    const nowIso = new Date().toISOString();
    const reflexType = job.payload?.reflex_type || "unknown";
    const signature = job.payload?.metadata?.signature || null;

    await Promise.all([
      this.reflexStateStore.upsertState({
        worldId,
        triggerType: reflexType,
        lastEventAt: nowIso,
        lastSignature: signature,
        updatedAt: nowIso
      }),
      this.reflexStateStore.upsertState({
        worldId,
        triggerType: "__global__",
        lastEventAt: nowIso,
        updatedAt: nowIso
      })
    ]);
  }

  async markTriggered(job, worldId) {
    const nowIso = new Date().toISOString();
    const reflexType = job.payload?.reflex_type || "unknown";
    const signature = job.payload?.metadata?.signature || null;

    await Promise.all([
      this.reflexStateStore.upsertState({
        worldId,
        triggerType: reflexType,
        lastReflexAt: nowIso,
        lastEventAt: nowIso,
        lastSignature: signature,
        updatedAt: nowIso
      }),
      this.reflexStateStore.upsertState({
        worldId,
        triggerType: "__global__",
        lastReflexAt: nowIso,
        lastEventAt: nowIso,
        updatedAt: nowIso
      })
    ]);
  }
}

module.exports = {
  ReflexWorker
};
