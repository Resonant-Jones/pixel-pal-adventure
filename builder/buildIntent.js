function normalizeText(message) {
  return String(message || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const BUILD_VERB_PATTERN = /\b(build|construct|make|create)\b/;
const NEGATION_PATTERN = /\b(?:don't|do not|never|no|not|without|avoid|stop)\b/;
const HYPOTHETICAL_PATTERN = /\b(?:maybe|later|someday|eventually|perhaps|could|would|might|should|what if|if we)\b/;
const ANCHOR_REFERENCE_PATTERN = /\b(?:anchor|this anchor|that anchor|the anchor|marked place|target anchor)\b/;
const STRUCTURE_CUE_PATTERN = /\b(bridge|tower|camp|hut|cabin|house|home|shelter|base|template|blueprint|prebuilt|quick build)\b/;
// A child nudging a stalled build says "keep going" or "finish it", not
// "build me a house". Without this, a resume nudge reads as a fresh build
// request and queues a duplicate job — the reported "forgot what it was
// doing" behaviour.
const RESUME_PATTERN =
  /\b(?:keep going|keep building|carry on|continue|resume|finish it|finish that|go on|carry on building|keep at it|keep working on it|build it|make it|try again|retry)\b/;
const PAUSE_PATTERN = /\b(?:pause|stop building|hold on|wait|hold up|come back to this)\b/;
// "here", "near me", "under us" — a kid pointing at the ground and saying
// "build me a house" means right where they are standing, not "give me GPS
// coordinates". These phrases confirm the target is the player's position.
const HERE_PATTERN =
  /\b(?:here|right here|over here|around here|near me|by me|under us|underneath us|beneath us|at my feet|where i am|where we are)\b/;
const COORDINATE_PATTERN =
  /\b(?:x\s*(-?\d+)\s*y\s*(-?\d+)\s*z\s*(-?\d+)|at\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)|at\s+(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+))\b/i;

function normalizeCoordinateTriple(x, y, z) {
  const values = [x, y, z].map((value) => Number(value));
  if (values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  return {
    x: Math.floor(values[0]),
    y: Math.floor(values[1]),
    z: Math.floor(values[2])
  };
}

function extractCoordinateTarget(text) {
  const match = String(text || "").match(COORDINATE_PATTERN);
  if (!match) {
    return null;
  }

  const groups = match.slice(1).filter((value) => value !== undefined);
  if (groups.length < 3) {
    return null;
  }

  return normalizeCoordinateTriple(groups[0], groups[1], groups[2]);
}

function extractTargetReference(text, resolvedAnchor = null) {
  const normalized = normalizeText(text);

  if (resolvedAnchor?.target) {
    const anchorTarget = normalizeCoordinateTriple(
      resolvedAnchor.target.x,
      resolvedAnchor.target.y,
      resolvedAnchor.target.z
    );

    if (anchorTarget) {
      if (ANCHOR_REFERENCE_PATTERN.test(normalized) || /\b(here|there|this spot|that spot|this location|that location)\b/.test(normalized)) {
        return {
          ...anchorTarget,
          source: "anchor",
          anchorId: resolvedAnchor.anchor?.id || null
        };
      }
    }
  }

  const coordinateTarget = extractCoordinateTarget(normalized);
  if (coordinateTarget) {
    return {
      ...coordinateTarget,
      source: "coordinates",
      anchorId: null
    };
  }

  if (resolvedAnchor?.target) {
    const anchorTarget = normalizeCoordinateTriple(
      resolvedAnchor.target.x,
      resolvedAnchor.target.y,
      resolvedAnchor.target.z
    );

    if (anchorTarget && ANCHOR_REFERENCE_PATTERN.test(normalized)) {
      return {
        ...anchorTarget,
        source: "anchor",
        anchorId: resolvedAnchor.anchor?.id || null
      };
    }
  }

  return null;
}

function hasStructureCue(text) {
  return STRUCTURE_CUE_PATTERN.test(normalizeText(text));
}

function classifyBuildRequest(message, { resolvedAnchor = null } = {}) {
  const text = normalizeText(message);
  const hasBuildVerb = BUILD_VERB_PATTERN.test(text);
  const hasNegation = hasBuildVerb && NEGATION_PATTERN.test(text);
  const hasHypothetical = hasBuildVerb && HYPOTHETICAL_PATTERN.test(text);
  const target = extractTargetReference(text, resolvedAnchor);
  const hasTarget = Boolean(target);
  const boundedStructure = hasStructureCue(text);
  const explicitBuildIntent = hasBuildVerb && !hasNegation && !hasHypothetical;

  // No coordinates and no anchor is NOT a reason to refuse. The player is
  // always standing somewhere, so "build me a house" resolves to a build at
  // their feet. Previously this forced a clarification loop a 10-year-old has
  // no way out of: he cannot type "anchor" and does not know what one is.
  const wantsBuildHere = HERE_PATTERN.test(text);
  const implicitTarget = explicitBuildIntent && boundedStructure && !hasTarget;

  // Pause wins over resume so "stop, don't keep going" is never read as a nudge.
  // A bare "stop" is too weak to match PAUSE_PATTERN, so a negation anywhere in
  // the sentence also suppresses resume — otherwise "don't keep going" is read
  // as an instruction to continue, which is the exact confusion this guards.
  const isPause =
    PAUSE_PATTERN.test(text) ||
    (RESUME_PATTERN.test(text) && NEGATION_PATTERN.test(text));
  const isResume =
    !isPause && RESUME_PATTERN.test(text) && !explicitBuildIntent;

  return {
    text,
    hasBuildVerb,
    hasNegation,
    hasHypothetical,
    hasStructureCue: boundedStructure,
    target,
    hasTarget,
    wantsBuildHere,
    implicitTarget,
    // The worker resolves "here" to a real position at execution time.
    targetMode: hasTarget ? "explicit" : "player_position",
    explicitBuildIntent,
    isPauseRequest: isPause,
    isResumeRequest: isResume,
    // A resume nudge is actionable even though it names no new structure, so
    // it must survive the shouldBuild gate and reach the lane router.
    shouldBuild:
      (explicitBuildIntent && hasTarget && boundedStructure) || isResume || implicitTarget,
    shouldResume: isResume,
    shouldPause: isPause,
    // A build verb with no recognisable shape is unbuildable no matter how
    // well-targeted it is, so it always deserves a question — anchor or not.
    needsClarification: explicitBuildIntent && !boundedStructure && !isResume
  };
}

module.exports = {
  classifyBuildRequest,
  extractTargetReference,
  hasStructureCue,
  normalizeText
};
