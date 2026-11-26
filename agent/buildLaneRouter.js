const { classifyBuildRequest, STRUCTURE_NOUNS } = require("../builder/buildIntent");

// What to offer when a build request names no recognisable shape.
//
// THE OFFER MUST NOT CONTAIN A WORD THE PARSER WOULD REJECT.
//
// This list used to be a string literal:
//
//   "Sure — what should I build? A house, a tower, a bridge, or a wall?"
//
// and "wall" was not a shape the parser accepted. So the agent asked a child
// to choose from four options, one of which sent the conversation straight
// back to the same question. The child had no way out of it.
//
// The suggestions are filtered against the parser's own vocabulary, so the
// two cannot drift apart again. Adding a word to STRUCTURE_NOUNS makes it
// offerable; there is no second list to forget to update.
const BUILD_SUGGESTIONS = ["house", "tower", "bridge", "wall", "castle", "treehouse"];

function buildClarification() {
  const offerable = BUILD_SUGGESTIONS.filter((word) => STRUCTURE_NOUNS.includes(word));
  const words = (offerable.length ? offerable : STRUCTURE_NOUNS).slice(0, 4);

  if (words.length === 1) {
    return `Sure — what should I build? A ${words[0]}?`;
  }

  const last = words[words.length - 1];
  const rest = words.slice(0, -1).map((word) => `a ${word}`).join(", ");
  return `Sure — what should I build? ${rest}, or a ${last}?`;
}

function routeBuildLane({
  message,
  resolvedAnchor = null,
  intentSignal = null,
  buildStatus = null,
  buildMode = "hybrid",
  mutationPolicy = { allowMutationDuringBuild: false }
} = {}) {
  const buildRequest = classifyBuildRequest(message, { resolvedAnchor });

  // A resume nudge ("keep going", "finish it") must re-enter the task lane even
  // while a build is active — the mutation gate exists to stop a *second* build
  // from starting, not to stop the current one from continuing.
  if (buildRequest.shouldResume && buildStatus?.active) {
    return {
      lane: "task",
      buildLane: buildStatus.lane === "emergent" ? "emergent" : "template",
      reason: "resume_build_request",
      action: "resume_build",
      buildStatus
    };
  }

  // Pause takes priority over everything else, including the gate.
  if (buildRequest.shouldPause && buildStatus?.active) {
    return {
      lane: "task",
      buildLane: buildStatus.lane === "emergent" ? "emergent" : "template",
      reason: "pause_build_request",
      action: "pause_build",
      buildStatus
    };
  }

  // Bug 4 fix: buildStatus.active now covers "paused" as well as "running",
  // so a stalled build keeps the gate shut instead of letting a duplicate
  // structure be queued on top of it.
  if (buildStatus?.active && buildRequest.shouldBuild && !mutationPolicy.allowMutationDuringBuild) {
    return {
      lane: "social",
      reason: "mutation_gate",
      clarification: "I am already building. Do you want me to pause and change the plan?",
      readiness: intentSignal?.readiness || "not_executable"
    };
  }

  if (!buildRequest.explicitBuildIntent && !buildRequest.shouldResume) {
    return {
      lane: "social",
      reason: buildRequest.hasNegation
        ? "negative_build_instruction"
        : buildRequest.hasHypothetical
          ? "hypothetical_build_language"
          : "social_only"
    };
  }

  if (buildRequest.shouldResume && !buildStatus?.active) {
    // Nothing to resume — fall back to a social answer rather than inventing
    // a build the player did not ask for.
    return {
      lane: "social",
      reason: "resume_without_active_build"
    };
  }

  if (buildRequest.needsClarification) {
    return {
      lane: "social",
      reason: "build_requires_shape",
      clarification: buildClarification()
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
    reason: buildRequest.implicitTarget ? "build_here_request" : "build_request",
    action: "compose_structure",
    // null means "where the player is standing right now"; the runtime
    // resolves it to a live position when the job is created.
    target: buildRequest.target || null,
    targetMode: buildRequest.targetMode || "player_position"
  };
}

module.exports = {
  routeBuildLane
};
