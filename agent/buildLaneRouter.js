const { classifyBuildRequest } = require("../builder/buildIntent");

function routeBuildLane({
  message,
  resolvedAnchor = null,
  intentSignal = null,
  buildStatus = null,
  buildMode = "hybrid",
  mutationPolicy = { allowMutationDuringBuild: false }
} = {}) {
  const buildRequest = classifyBuildRequest(message, { resolvedAnchor });

  if (buildStatus?.active && buildRequest.shouldBuild && !mutationPolicy.allowMutationDuringBuild) {
    return {
      lane: "social",
      reason: "mutation_gate",
      clarification: "I am already building. Do you want me to pause and change the plan?",
      readiness: intentSignal?.readiness || "not_executable"
    };
  }

  if (!buildRequest.explicitBuildIntent) {
    return {
      lane: "social",
      reason: buildRequest.hasNegation
        ? "negative_build_instruction"
        : buildRequest.hasHypothetical
          ? "hypothetical_build_language"
          : "social_only"
    };
  }

  if (buildRequest.needsClarification) {
    return {
      lane: "social",
      reason: buildRequest.hasTarget ? "build_requires_bounds" : "build_requires_target",
      clarification: buildRequest.hasTarget
        ? "If you want me to build there, tell me what shape to make, like a hut, tower, or bridge."
        : "If you want me to build, give me a target like an anchor or coordinates."
    };
  }

  if (!buildRequest.shouldBuild) {
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
    reason: "build_request",
    target: buildRequest.target
  };
}

module.exports = {
  routeBuildLane
};
