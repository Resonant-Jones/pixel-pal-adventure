// The "shadow" seam.
//
// Before this existed, follow behaviour was reachable only when the model
// happened to emit a follow_player action. That made presence a model
// decision: whenever the model chose some other action — or failed to answer
// at all — the bot had no pathfinding goal and simply stood still.
//
// Presence must not be delegated to the LLM. This controller owns follow
// distance, idle re-engagement, and returning to the player after a task
// ends. The model can *ask* it to hold position, but it can never leave the
// bot stranded with no goal.

const DEFAULT_FOLLOW_DISTANCE = 3;
const DEFAULT_TICK_MS = 1000;
const DEFAULT_REENGAGE_AFTER_MS = 2000;

function toFiniteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

class PresenceController {
  constructor({
    botAdapter,
    primaryPlayer = "Sage",
    followDistance = DEFAULT_FOLLOW_DISTANCE,
    tickMs = DEFAULT_TICK_MS,
    reengageAfterMs = DEFAULT_REENGAGE_AFTER_MS,
    logger = console
  }) {
    this.botAdapter = botAdapter;
    this.primaryPlayer = primaryPlayer;
    this.followDistance = toFiniteNumber(followDistance, DEFAULT_FOLLOW_DISTANCE);
    this.tickMs = toFiniteNumber(tickMs, DEFAULT_TICK_MS);
    this.reengageAfterMs = toFiniteNumber(reengageAfterMs, DEFAULT_REENGAGE_AFTER_MS);

    // "auto" follows the primary player. "hold" is an explicit stand-still
    // request (build in progress, player said wait). "idle" means the last
    // task finished and we have not re-engaged yet.
    this.mode = "idle";
    this.holding = false;
    this.following = false;
    this.lastReengageAt = 0;
    this.timer = null;
    this.logger = logger;
  }

  setFollowDistance(distance) {
    const parsed = toFiniteNumber(distance, null);
    if (parsed !== null && parsed > 0) {
      this.followDistance = parsed;
      // botAdapter.followPlayer() takes only a username and reads its range
      // from config, so the controller's distance has to be pushed down there.
      if (this.botAdapter?.config) {
        this.botAdapter.config.followDistance = parsed;
      }
    }
    return this.followDistance;
  }

  isConnected() {
    return Boolean(this.botAdapter?.bot?.entity);
  }

  // Called when a task starts (build, reflex, movement). Stops following so
  // the bot does not walk away from its own work.
  beginTask() {
    this.holding = true;
    this.mode = "hold";
    this.following = false;
    this.safeStopFollowing();
  }

  // Called when a task ends for any reason: success, pause, or failure. This
  // is the fix for the reported "bot stands staring at nothing" behaviour.
  endTask() {
    this.holding = false;
    this.mode = "auto";
    this.lastReengageAt = Date.now();
    this.following = false;
    this.safeStopFollowing();
  }

  hold() {
    this.holding = true;
    this.mode = "hold";
  }

  resume() {
    this.holding = false;
    this.mode = "auto";
    this.lastReengageAt = Date.now();
  }

  playerEntity() {
    if (!this.isConnected()) {
      return null;
    }

    const target = this.botAdapter.bot.players?.[this.primaryPlayer];
    return target?.entity || null;
  }

  distanceToPlayer() {
    const entity = this.playerEntity();
    const self = this.botAdapter?.bot?.entity;

    if (!entity?.position || !self?.position) {
      return null;
    }

    return entity.position.distanceTo(self.position);
  }

  shouldReengage() {
    if (this.holding || !this.isConnected()) {
      return false;
    }

    if (Date.now() - this.lastReengageAt < this.reengageAfterMs) {
      return false;
    }

    const distance = this.distanceToPlayer();

    // Null distance means the player entity is not visible yet. Give it a
    // moment rather than spamming follow attempts.
    if (distance === null) {
      return Date.now() - this.lastReengageAt > this.reengageAfterMs * 3;
    }

    return distance > this.followDistance + 1;
  }

  safeStopFollowing() {
    try {
      if (typeof this.botAdapter?.stopFollowing === "function") {
        this.botAdapter.stopFollowing();
      } else if (typeof this.botAdapter?.stopPathing === "function") {
        this.botAdapter.stopPathing();
      }
    } catch (error) {
      this.logger.warn?.("[presence] stopFollowing failed:", error?.message || error);
    }
  }

  async tick() {
    if (this.holding || !this.isConnected()) {
      return false;
    }

    if (!this.shouldReengage()) {
      return false;
    }

    const entity = this.playerEntity();
    if (!entity) {
      return false;
    }

    try {
      await this.botAdapter.followPlayer(this.primaryPlayer);
      this.following = true;
      this.lastReengageAt = Date.now();
      return true;
    } catch (error) {
      // A follow attempt failing is normal while the bot is mid-reconnect.
      this.following = false;
      this.logger.warn?.("[presence] re-engage failed:", error?.message || error);
      return false;
    }
  }

  start() {
    if (this.timer) {
      return this.timer;
    }

    this.timer = setInterval(() => {
      void this.tick().catch((error) => {
        this.logger.warn?.("[presence] tick failed:", error?.message || error);
      });
    }, this.tickMs);

    // Do not hold the process open on shutdown.
    if (typeof this.timer.unref === "function") {
      this.timer.unref();
    }

    return this.timer;
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

module.exports = {
  PresenceController,
  DEFAULT_FOLLOW_DISTANCE,
  DEFAULT_TICK_MS,
  DEFAULT_REENGAGE_AFTER_MS
};