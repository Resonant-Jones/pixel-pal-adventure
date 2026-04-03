const { FeedbackCooldowns } = require("./feedbackCooldowns");
const { pickHighest } = require("./salienceScorer");

class FeedbackBroker {
  constructor({ cooldowns = new FeedbackCooldowns(), logger = console } = {}) {
    this.cooldowns = cooldowns;
    this.logger = logger;
  }

  applyCooldowns(packets = []) {
    const eligible = [];
    for (const packet of packets) {
      if (!packet) {
        continue;
      }

      if (!this.cooldowns.canEmit(packet)) {
        continue;
      }

      eligible.push(packet);
    }

    return eligible;
  }

  summarizeForLane(packets = [], lane = "social") {
    const eligible = this.applyCooldowns(packets);
    if (!eligible.length) {
      return "";
    }

    const selected = pickHighest(eligible);
    if (!selected) {
      return "";
    }

    this.cooldowns.markEmitted(selected);

    if (lane === "social") {
      return String(selected.speakable_summary || selected.summary || "").trim();
    }

    return String(selected.summary || "").trim();
  }

  collectSummaries({ packets = [], taskLane = true, socialLane = true } = {}) {
    return {
      taskSummary: taskLane ? this.summarizeForLane(packets, "task") : "",
      socialSummary: socialLane ? this.summarizeForLane(packets, "social") : ""
    };
  }
}

module.exports = {
  FeedbackBroker
};
