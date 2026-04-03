function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function detectBuildIntent(message) {
  const text = normalizeText(message);
  if (!text) {
    return false;
  }

  if (/\b(build|construct|make)\b/.test(text)) {
    return true;
  }

  return false;
}

function routeBuildLane({
  message,
  intentSignal = null,
  buildStatus = null,
  buildMode = "hybrid",
  mutationPolicy = { allowMutationDuringBuild: false }
} = {}) {
  const wantsBuild = detectBuildIntent(message);
  const needsClarification = Boolean(intentSignal?.needsClarification);

  if (needsClarification) {
    return {
      lane: "social",
      reason: "intent_clarification",
      clarification: intentSignal?.suggestedQuestion || null,
      readiness: intentSignal?.readiness || "not_executable"
    };
  }

  if (buildStatus?.active && wantsBuild && !mutationPolicy.allowMutationDuringBuild) {
    return {
      lane: "social",
      reason: "mutation_gate",
      clarification: "I am already building. Do you want me to pause and change the plan?",
      readiness: "not_executable"
    };
  }

  if (!wantsBuild) {
    return {
      lane: "social",
      reason: "social_only"
    };
  }

  const lane = "task";
  let buildLane = "template";

  if (buildMode === "emergent_only") {
    buildLane = "emergent";
  } else if (buildMode === "template_only") {
    buildLane = "template";
  } else {
    buildLane = "template";
  }

  return {
    lane,
    buildLane,
    reason: "build_request"
  };
}

module.exports = {
  routeBuildLane
};
