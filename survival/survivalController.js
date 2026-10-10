// Survival controller — self-preservation and self-healing.
//
// WHY THIS IS SEPARATE FROM THE AGENT RUNTIME
//
// The language model is the wrong tool for staying alive. A creeper fuse is
// about 1.5 seconds; a round trip to an LLM is at least a second on a good day
// and can be tens of seconds under load. A companion that asks a model "should
// I move?" before moving is a companion that dies.
//
// So survival is local, deterministic, and synchronous. The model never
// participates in the reaction — but it is *told* what happened afterwards, so
// it can narrate it. Acting is the reflex layer's job; talking about it is the
// model's job.
//
// PRIORITY LADDER (highest first, one action per tick)
//
//   1. CRITICAL  health at or below criticalHealth  -> flee, then eat
//   2. THREAT    hostile within threatRange          -> flee or fight
//   3. HUNGRY    food at or below foodLow            -> eat
//   4. (idle)    nothing to do                       -> stay out of the way
//
// The passive/idle case is intentionally a no-op: presence and following are
// owned by PresenceController, and two systems steering movement is how you
// get a bot that twitches.

const DEFAULTS = {
  tickMs: 500,
  threatRange: 12,
  panicRange: 4.5,
  criticalHealth: 8,
  lowHealth: 14,
  foodLow: 14,
  attackCooldownMs: 1200,
  fleeCooldownMs: 3000,
  eatCooldownMs: 4000,
  narrateCooldownMs: 15000
};

class SurvivalController {
  static HOSTILE_MOBS = new Set([
    "zombie", "husk", "drowned", "skeleton", "stray", "bogged", "creeper",
    "spider", "cave_spider", "enderman", "witch", "slime", "magma_cube",
    "blaze", "ghast", "piglin", "piglin_brute", "hoglin", "zoglin",
    "wither_skeleton", "phantom", "pillager", "vindicator", "evoker",
    "ravager", "guardian", "elder_guardian", "shulker", "silverfish",
    "endermite", "vex", "warden", "breeze"
  ]);

  constructor({
    botAdapter,
    logger = console,
    onEvent = null,
    primaryPlayer = null,
    enabled = true,
    tickMs = DEFAULTS.tickMs,
    thresholds = {}
  } = {}) {
    this.botAdapter = botAdapter;
    this.logger = logger;
    this.onEvent = onEvent;
    this.primaryPlayer = primaryPlayer;
    this.enabled = enabled;
    this.tickMs = tickMs;

    this.thresholds = {
      threatRange: thresholds.threatRange ?? DEFAULTS.threatRange,
      panicRange: thresholds.panicRange ?? DEFAULTS.panicRange,
      criticalHealth: thresholds.criticalHealth ?? DEFAULTS.criticalHealth,
      lowHealth: thresholds.lowHealth ?? DEFAULTS.lowHealth,
      foodLow: thresholds.foodLow ?? DEFAULTS.foodLow
    };

    this.cooldowns = {
      attackUntil: 0,
      fleeUntil: 0,
      eatUntil: 0,
      narrateUntil: 0
    };

    this.timer = null;
    this.busy = false;
    this.activeAction = null;
    this.actionAbort = null;
    this.movementLease = null;
    this.rerunRequested = false;
    this.stopped = false;
    this.lastAction = null;
    this.stats = { fights: 0, kills: 0, flees: 0, meals: 0, deaths: 0 };
  }

  // --- assessment ---------------------------------------------------------

  assess() {
    const vitals = this.botAdapter?.getVitals?.();
    if (!vitals?.isAlive) {
      return { ok: false, reason: "no_bot", vitals: null, threat: null };
    }

    const dangerous = this.botAdapter.findNearestHostile?.(this.thresholds.threatRange, { fleeOnly: true });
    const threat = dangerous && this.constructor.shouldFleeOnly(dangerous.name)
      ? dangerous
      : this.botAdapter.findNearestHostile?.(this.thresholds.threatRange) || null;

    return { ok: true, vitals, threat };
  }

  isCritical(vitals) {
    return typeof vitals.health === "number" && vitals.health <= this.thresholds.criticalHealth;
  }

  isHungry(vitals) {
    // Vanilla stops natural regeneration below 18 food; below 6 you cannot
    // even sprint, which makes fleeing impossible. Treat both as urgent.
    return typeof vitals.food === "number" && vitals.food <= this.thresholds.foodLow;
  }

  // A fight is worth taking only when we are healthy enough to win it and the
  // mob is one you can actually trade hits with.
  shouldFlee(threat, vitals) {
    if (!threat) {
      return false;
    }

    const { shouldFleeOnly } = this.constructor;

    if (shouldFleeOnly(threat.name)) {
      // Always break off. Meleeing an exploder is a losing trade for a bot
      // with no knockback discipline: it walks into blast radius and detonates.
      // Real players kill creepers by hit-and-retreat; until the companion can
      // do that reliably, backing off is the correct answer at any range.
      return true;
    }

    if (this.isCritical(vitals)) {
      return true;
    }

    // Low health plus a mob already in our face is a losing trade.
    if (typeof vitals.health === "number" && vitals.health <= this.thresholds.lowHealth) {
      return threat.distance <= this.thresholds.panicRange;
    }

    return false;
  }

  static shouldFleeOnly(name) {
    return [
      "creeper", "ghast", "blaze", "witch", "ravager"
    ].includes(String(name || "").toLowerCase());
  }

  // entitySpawn fires for every animal and item too. Filtering here keeps the
  // reaction loop from waking up every time a chicken loads.
  isHostileName(name) {
    const normalized = String(name || "").toLowerCase().replace(/^minecraft:/, "");
    return this.constructor.HOSTILE_MOBS.has(normalized);
  }

  // Decide without acting. Pure, so it can be tested directly.
  decide(assessment, now = Date.now()) {
    if (!assessment?.ok) {
      return { action: "none", reason: "no_bot" };
    }

    const { vitals, threat } = assessment;

    // 1. Critical health outranks everything, including hunger.
    if (this.isCritical(vitals)) {
      if (threat && now >= this.cooldowns.fleeUntil) {
        return { action: "flee", reason: "critical_health", threat, urgent: true };
      }

      if (this.isHungry(vitals) && now >= this.cooldowns.eatUntil) {
        return { action: "eat", reason: "critical_health", urgent: true };
      }

      if (threat) {
        return { action: "flee", reason: "critical_health_forced", threat, urgent: true };
      }
    }

    // 2. A hostile in range.
    if (threat) {
      if (this.shouldFlee(threat, vitals)) {
        if (now >= this.cooldowns.fleeUntil) {
          return { action: "flee", reason: "outmatched", threat };
        }
        return { action: "none", reason: "flee_on_cooldown" };
      }

      if (now >= this.cooldowns.attackUntil) {
        return { action: "fight", reason: "defend_self", threat };
      }

      return { action: "none", reason: "attack_on_cooldown" };
    }

    // 3. Nothing trying to kill us — top up.
    if (this.isHungry(vitals) && now >= this.cooldowns.eatUntil) {
      return { action: "eat", reason: "hungry" };
    }

    return { action: "none", reason: "safe" };
  }

  // --- action -------------------------------------------------------------

  async act(action, signal) {
    const now = Date.now();

    try {
      if (action.action === "flee") {
        this.cooldowns.fleeUntil = now + DEFAULTS.fleeCooldownMs;
        this.cooldowns.attackUntil = Math.max(this.cooldowns.attackUntil, now + DEFAULTS.attackCooldownMs);
        this.stats.flees += 1;

        const threatPosition = action.threat?.entity?.position;
        const result = await this.botAdapter.fleeFrom(threatPosition, {
          durationMs: action.urgent ? 3500 : 2500,
          signal
        });

        this.record(action, result);
        return result;
      }

      if (action.action === "fight") {
        // Hold the flee cooldown open so we do not oscillate between charging
        // and running on alternating ticks.
        this.cooldowns.attackUntil = now + DEFAULTS.attackCooldownMs;
        this.stats.fights += 1;

        // Put on armour before swinging. Skeletons shoot from well outside
        // melee range, so charging one bare-handed is how the bot used to lose
        // a fight it should have won. Cheap, idempotent, and never fatal to the
        // action itself if it throws.
        try {
          await this.botAdapter.equipBestArmor?.();
        } catch (error) {
          this.logger.warn?.("[survival] equip armour failed:", error?.message || error);
        }

        const result = await this.botAdapter.attackEntity(action.threat.entity, {
          maxDurationMs: 6000,
          signal
        });

        if (result?.killed) {
          this.stats.kills += 1;
        }

        this.record(action, result);
        return result;
      }

      if (action.action === "eat") {
        this.cooldowns.eatUntil = now + DEFAULTS.eatCooldownMs;
        const result = await this.botAdapter.consumeFood({ signal });

        if (result?.ate) {
          this.stats.meals += 1;
        }

        this.record(action, result);
        return result;
      }
    } catch (error) {
      this.logger.warn?.(`[survival] ${action.action} failed:`, error?.message || error);
      this.record(action, { ok: false, error: error?.message || String(error) });
      return { ok: false };
    }

    return { ok: true, skipped: true };
  }

  // Emit a structured event so the model can *narrate* what the body just did.
  // This is the seam that keeps the companion feeling alive without putting an
  // LLM in the reaction path.
  record(action, result) {
    const event = {
      type: "survival_action",
      action: action.action,
      reason: action.reason,
      mob: action.threat?.name || null,
      distance: action.threat?.distance ?? null,
      outcome: result || null,
      at: new Date().toISOString()
    };

    this.lastAction = event;

    try {
      this.onEvent?.(event);
    } catch (error) {
      this.logger.warn?.("[survival] event handler failed:", error?.message || error);
    }
  }

  // --- loop ---------------------------------------------------------------

  async tick() {
    if (!this.enabled || this.stopped) {
      return null;
    }

    if (this.busy) {
      const assessment = this.assess();
      const urgent = assessment.ok && (
        (assessment.threat && this.shouldFlee(assessment.threat, assessment.vitals)) ||
        (this.activeAction === "fight" && this.isCritical(assessment.vitals))
      );
      if (urgent && ["fight", "eat"].includes(this.activeAction)) {
        this.rerunRequested = true;
        this.actionAbort?.abort();
      }
      return null;
    }

    this.busy = true;

    try {
      let result = null;
      do {
        this.rerunRequested = false;
        const decision = this.decide(this.assess());
        if (decision.action === "none") break;
        if (!this.movementLease) this.movementLease = this.botAdapter.beginSurvival?.() || null;
        this.activeAction = decision.action;
        this.actionAbort = new AbortController();
        result = await this.act(decision, this.actionAbort.signal);
      } while (this.rerunRequested && this.enabled && !this.stopped);
      return result;
    } catch (error) {
      this.logger.warn?.("[survival] tick failed:", error?.message || error);
      return null;
    } finally {
      this.actionAbort = null;
      this.activeAction = null;
      this.busy = false;
      // Cooldown is a rate limit, not permission to walk back into a threat.
      // Keep movement until the next assessment finds the encounter over.
      let threatRemains = false;
      if (this.enabled && !this.stopped && this.movementLease) {
        try {
          const assessment = this.assess();
          threatRemains = assessment.ok && Boolean(assessment.threat);
        } catch (_) { /* release on an unavailable bot */ }
      }
      if (!threatRemains) this.releaseMovement();
    }
  }

  // Immediate, out-of-band trigger for mineflayer events (took damage, health
  // changed, died). Runs ahead of the tick so a hit is answered at once rather
  // than up to tickMs later.
  async notify(reason) {
    if (!this.enabled) {
      return null;
    }

    if (reason === "death") {
      this.rerunRequested = false;
      this.actionAbort?.abort();
      this.stats.deaths += 1;
      this.lastAction = { type: "survival_action", action: "died", reason, at: new Date().toISOString() };
      try {
        this.onEvent?.(this.lastAction);
      } catch (_error) {
        // Death notification is best-effort.
      }
      return null;
    }

    return this.tick();
  }

  start() {
    this.stopped = false;
    if (this.timer) {
      return this.timer;
    }

    this.timer = setInterval(() => {
      void this.tick().catch((error) => {
        this.logger.warn?.("[survival] loop error:", error?.message || error);
      });
    }, this.tickMs);

    if (typeof this.timer.unref === "function") {
      this.timer.unref();
    }

    return this.timer;
  }

  stop() {
    this.stopped = true;
    this.rerunRequested = false;
    this.actionAbort?.abort();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (!this.busy) this.releaseMovement();
  }

  setEnabled(value) {
    this.enabled = Boolean(value);
    if (!this.enabled) {
      this.rerunRequested = false;
      this.actionAbort?.abort();
      if (!this.busy) this.releaseMovement();
    }
    return this.enabled;
  }

  releaseMovement() {
    if (this.movementLease) {
      this.botAdapter.endSurvival?.(this.movementLease);
      this.movementLease = null;
    }
  }

  getStats() {
    return { ...this.stats, lastAction: this.lastAction };
  }
}

module.exports = {
  SurvivalController,
  DEFAULTS
};
