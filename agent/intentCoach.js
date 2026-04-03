function normalizeText(message) {
  return String(message || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function detectHedging(text) {
  return /\b(maybe|kinda|kind of|sort of|something|cool|maybe something)\b/.test(text);
}

function detectBuildVerb(text) {
  return /\b(build|construct|make|create)\b/.test(text);
}

function detectDesignIntent(text) {
  return /\b(idea|ideas|design|plan|style|look like|what if)\b/.test(text);
}

function analyzeIntent(message, primaryPlayer = "Sage") {
  const text = normalizeText(message);
  if (!text) {
    return {
      needsClarification: false,
      readiness: "ready"
    };
  }

  const mentionsBuild = detectBuildVerb(text);
  const wantsIdeas = detectDesignIntent(text) || /\bidea\b/.test(text);
  const hedging = detectHedging(text);

  if (mentionsBuild && (hedging || wantsIdeas)) {
    return {
      needsClarification: true,
      readiness: "not_executable",
      summary: "Intent unclear: build request needs clarification.",
      diagnostic_code: "INTENT_AMBIGUOUS_BUILD",
      suggestedQuestion: `It sounds like you want a small build, ${primaryPlayer}. Do you want ideas first, or do you want me to build it? You can also say: \"Build a small base by the water.\"`
    };
  }

  if (!mentionsBuild && hedging) {
    return {
      needsClarification: true,
      readiness: "not_executable",
      summary: "Intent unclear: needs clarification.",
      diagnostic_code: "INTENT_AMBIGUOUS",
      suggestedQuestion: `I can help, ${primaryPlayer}. Do you want me to build something, or just suggest ideas?`
    };
  }

  return {
    needsClarification: false,
    readiness: "ready"
  };
}

module.exports = {
  analyzeIntent
};
