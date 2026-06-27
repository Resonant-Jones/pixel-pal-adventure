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

  return {
    text,
    hasBuildVerb,
    hasNegation,
    hasHypothetical,
    hasStructureCue: boundedStructure,
    target,
    hasTarget,
    explicitBuildIntent,
    shouldBuild: explicitBuildIntent && hasTarget && boundedStructure,
    needsClarification: explicitBuildIntent && (!hasTarget || !boundedStructure)
  };
}

module.exports = {
  classifyBuildRequest,
  extractTargetReference,
  hasStructureCue,
  normalizeText
};
