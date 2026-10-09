// Natural-language tagging and recall for places in the world.
//
// The child says "tag this spot as the diamond cave", and later "take me back
// to the diamond cave". Both are ordinary speech, not commands, so they are
// parsed here rather than requiring a slash command the child would have to
// memorise.
//
// Deliberately conservative: a phrase only counts as a tag or a recall when it
// clearly is one. Treating idle chat as a teleport request would fling the
// child across the map mid-sentence.

function normalizeText(message) {
  return String(message || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/g, "")
    .trim();
}

// Strip the leading article and filler so "the diamond cave" and "diamond
// cave" resolve to the same place.
function normalizeLabel(label) {
  return String(label || "")
    .toLowerCase()
    .replace(/^(?:the|a|an|my|our)\s+/g, "")
    .replace(/\b(?:place|spot|location|area|base|camp)\b/g, "")
    .replace(/[^\w\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TAG_PATTERNS = [
  /\b(?:tag|mark|label|flag)\s+(?:this|here|that)\s+(?:spot|place|location|area)?\s*(?:as|like)?\s*(.+)$/,
  /\b(?:remember|save|store)\s+(?:this|here|that)\s+(?:spot|place|location|area)?\s*(?:as|like)?\s*(.+)$/,
  /\b(?:call|name)\s+(?:this|here|that)\s+(?:spot|place|location|area)?\s*(.+)$/,
  /\b(?:tag|mark|label|flag)\s+(?:it|this spot|this place)\s+(?:as\s+)?(.+)$/
];

const GOTO_PATTERNS = [
  /\b(?:take|bring|send|teleport|port|warp|transport)\s+me\s+(?:back\s+)?to\s+(.+)$/,
  /\b(?:go|head|walk|come|travel)\s+(?:back\s+)?to\s+(.+)$/,
  /\b(?:return|back)\s+(?:me\s+)?to\s+(.+)$/,
  /\bwhere\s+(?:is|was)\s+(.+)$/,
  /\b(?:find|locate)\s+(?:me\s+)?(.+)$/,
  /\bteleport\s+(?:me\s+)?to\s+(.+)$/
];

// Phrases that look like a label but are really something else the model
// should answer conversationally.
const GOTO_FALSE_POSITIVES = [
  /^(?:bed|sleep|hell|the nether|the end|hiding|fishing|hunting|mining)$/,
  /^(?:to\s+)?(?:work|school|sleep)$/
];

function stripTrailingFiller(text) {
  return String(text || "")
    .replace(/\s+(?:please|now|ok|okay|thanks)$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Pull a useable label out of a captured group, rejecting fragments that are
// obviously not names ("to", "it", empty).
function cleanLabel(raw) {
  const label = stripTrailingFiller(
    String(raw || "")
      .replace(/^["'\s]+|["'\s]+$/g, "")
      .trim()
  );

  if (!label) {
    return null;
  }

  // Single filler words are not names.
  if (/^(?:it|that|this|here|there|somewhere|anywhere|me|us|back)$/.test(label)) {
    return null;
  }

  if (label.length > 64) {
    return label.slice(0, 64).trim();
  }

  return label;
}

function parseLocationIntent(message) {
  const text = normalizeText(message);
  if (!text) {
    return { kind: null, label: null };
  }

  // Bare tag with no name — "tag this spot" — must be checked BEFORE the
  // pattern list. Otherwise the greedy `(.+)$` captures the noun ("spot") and
  // the child ends up with a place called "spot" instead of being asked.
  if (/\b(?:tag|mark|label|flag|remember|save)\s+(?:this|here|that)\s*(?:spot|place|location|area)?$/.test(text)) {
    return { kind: "tag", label: null, raw: text, needsLabel: true };
  }

  // Tagging next: "remember this as the cave" also contains "this as", and
  // must never be read as a movement request.
  for (const pattern of TAG_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return { kind: "tag", label: cleanLabel(match[1]), raw: text };
    }
  }

  for (const pattern of GOTO_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const label = cleanLabel(match[1]);

      if (!label || GOTO_FALSE_POSITIVES.some((re) => re.test(normalizeLabel(label)))) {
        continue;
      }

      return { kind: "goto", label, raw: text };
    }
  }

  return { kind: null, label: null, raw: text };
}

// Score how well a stored label matches what the child just said. Higher is
// better; 0 means no match at all.
function scoreLabelMatch(query, candidate) {
  const a = normalizeLabel(query);
  const b = normalizeLabel(candidate);

  if (!a || !b) {
    return 0;
  }

  if (a === b) {
    return 100;
  }

  if (b.includes(a) || a.includes(b)) {
    return 70;
  }

  const aTokens = new Set(a.split(" ").filter(Boolean));
  const bTokens = new Set(b.split(" ").filter(Boolean));
  if (!aTokens.size || !bTokens.size) {
    return 0;
  }

  let shared = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      shared += 1;
    }
  }

  if (!shared) {
    return 0;
  }

  // Weight by how much of the spoken phrase was covered, so "cave" prefers
  // "the diamond cave" over "cave entrance near the village".
  const coverage = shared / aTokens.size;
  return Math.round(40 * coverage);
}

function findBestLabelMatch(query, candidates) {
  let best = null;

  for (const candidate of candidates || []) {
    const score = scoreLabelMatch(query, candidate.label || candidate.name);
    if (score > 0 && (!best || score > best.score)) {
      best = { score, anchor: candidate };
    }
  }

  // Below this we are guessing, and teleporting a child to the wrong place is
  // worse than admitting we do not know.
  return best && best.score >= 40 ? best : null;
}

module.exports = {
  parseLocationIntent,
  normalizeLabel,
  scoreLabelMatch,
  findBestLabelMatch
};