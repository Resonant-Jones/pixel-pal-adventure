const { DEFAULT_COOLDOWN_SECONDS } = require("./feedbackTypes");

class FeedbackCooldowns {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.lastEmitted = new Map();
  }

  getKey(packet) {
    const type = packet?.type || "unknown";
    const source = packet?.source || "unknown";
    const code = packet?.diagnostic_code || "";
    return `${type}:${source}:${code}`;
  }

  getCooldownMs(packet) {
    const seconds =
      typeof packet?.cooldown_seconds === "number"
        ? packet.cooldown_seconds
        : DEFAULT_COOLDOWN_SECONDS[packet?.type] || 0;
    return Math.max(0, seconds * 1000);
  }

  canEmit(packet) {
    if (!packet) {
      return false;
    }

    const key = this.getKey(packet);
    const cooldownMs = this.getCooldownMs(packet);
    if (!cooldownMs) {
      return true;
    }

    const last = this.lastEmitted.get(key) || 0;
    return this.now() - last >= cooldownMs;
  }

  markEmitted(packet) {
    if (!packet) {
      return;
    }

    const key = this.getKey(packet);
    this.lastEmitted.set(key, this.now());
  }
}

module.exports = {
  FeedbackCooldowns
};
