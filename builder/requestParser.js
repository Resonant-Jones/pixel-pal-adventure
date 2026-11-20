const {
  normalizePaletteName,
  normalizeSizeName,
  normalizeStyleName
} = require("./styleProfiles");
const { classifyBuildRequest, hasStructureCue } = require("./buildIntent");
const { PILE_BLOCKS } = require("./chaosProfiles");

// Chaos detection runs FIRST. "build a house of tnt" contains a normal shape
// cue, and if the normal cue wins the request quietly becomes a cabin — which
// is the wrong answer to a kid who wanted a tnt pile.
//
// Order matters inside this list. The CONTENT noun beats the SHAPE word: "a
// junk pile" is a heap of junk, not a pile of one item, while "a pile of dirt"
// is a pile. So the named material is checked before the generic shape.
function detectChaosStyle(text) {
  const normalized = String(text || "").toLowerCase();

  if (/\btnt\b[^.]*\bmaze\b|\bmaze\b[^.]*\btnt\b/.test(normalized)) {
    return "tnt_maze";
  }

  if (/\bchests?\b[^.]*\bmaze\b|\bmaze\b[^.]*\bchests?\b/.test(normalized)) {
    return "chest_maze";
  }

  if (/\bmaze\b|\blabyrinth\b/.test(normalized)) {
    return "tnt_maze";
  }

  if (/\bfloating\b/.test(normalized)) {
    return "floating_pile";
  }

  if (/\bredstone\b/.test(normalized)) {
    return "redstone_junk";
  }

  // Named material before generic shape. The \w* suffix matters: a kid says
  // "messy" and "piles", not "mess" and "pile".
  if (/\b(junk|scrap|mess|garbage)\w*\b/.test(normalized)) {
    return "scrap_heap";
  }

  if (/\btnt\b/.test(normalized)) {
    return "tnt_pile";
  }

  if (/\bchests?\b/.test(normalized)) {
    return "item_pile";
  }

  if (/\b(pile|stack|heap)\w*\b/.test(normalized)) {
    return "item_pile";
  }

  if (/\b(broken|glitch|weird|chaos|silly|pointless)\w*\b/.test(normalized)) {
    return "scrap_heap";
  }

  if (/\b(shouldn't|should not|doesn't work|does not work|not work)\b/.test(normalized)) {
    return "scrap_heap";
  }

  return null;
}

// "a pile of dirt" is dirt, not a pile of whatever. The item travels through
// the features list because that is the channel the plan already has.
function detectPileItem(text, style) {
  if (style !== "item_pile") {
    return [];
  }

  const normalized = String(text || "").toLowerCase();

  return PILE_BLOCKS.filter((block) => normalized.includes(block.replace("_block", "")));
}

function detectStyle(text) {
  if (/\bbridge\b/.test(text)) {
    return "bridge";
  }

  if (/\btower\b/.test(text)) {
    return "tower";
  }

  if (/\bcamp\b/.test(text)) {
    return "camp";
  }

  if (/\bhut\b/.test(text)) {
    return "hut";
  }

  if (/\b(cabin|house|home|shelter|base)\b/.test(text)) {
    return "cabin";
  }

  return "cabin";
}

function detectPalette(text, fallback) {
  if (/\bdeepslate\b/.test(text)) {
    return "deepslate";
  }

  if (/\b(stone|cobble|cobblestone)\b/.test(text)) {
    return "stone";
  }

  if (/\bspruce\b/.test(text)) {
    return "spruce";
  }

  if (/\bbirch\b/.test(text)) {
    return "birch";
  }

  if (/\boak\b/.test(text)) {
    return "oak";
  }

  return fallback;
}

function detectSize(text, fallback) {
  if (/\b(tiny|compact)\b/.test(text)) {
    return "tiny";
  }

  if (/\b(small|cozy)\b/.test(text)) {
    return "small";
  }

  if (/\b(large|big|wide|tall)\b/.test(text)) {
    return "large";
  }

  if (/\bmedium\b/.test(text)) {
    return "medium";
  }

  return fallback;
}

function detectFeatures(text, style) {
  const features = [];

  if (/\bcozy\b/.test(text)) {
    features.push("windows", "gable_roof");
  }

  if (/\bwindow/.test(text)) {
    features.push("windows");
  }

  if (/\b(door|entry|entrance)\b/.test(text)) {
    features.push("door");
  }

  if (/\b(gable|sloped|pitched)\b/.test(text)) {
    features.push("gable_roof");
  }

  if (/\brailing/.test(text)) {
    features.push("railings");
  }

  if (/\bsupport/.test(text)) {
    features.push("supports");
  }

  if (/\bcampfire/.test(text)) {
    features.push("campfire");
  }

  if (/\bseat/.test(text)) {
    features.push("seats");
  }

  if (style === "bridge" && /\bacross\b/.test(text)) {
    features.push("railings");
  }

  return Array.from(new Set(features));
}

function parseBuildRequest(message, primaryPlayer = "Sage", resolvedAnchor = null) {
  const request = classifyBuildRequest(message, { resolvedAnchor });
  const text = request.text;
  const boundedStructure = hasStructureCue(text);

  if (!request.shouldBuild) {
    return null;
  }

  if (!boundedStructure) {
    return null;
  }

  const chaosStyle = detectChaosStyle(text);
  const style = chaosStyle || normalizeStyleName(detectStyle(text));
  const palette = normalizePaletteName(detectPalette(text, style === "tower" ? "stone" : style === "camp" ? "spruce" : "oak"));
  const size = normalizeSizeName(detectSize(text, style === "bridge" ? "medium" : "small"));
  const features = [...detectFeatures(text, style), ...detectPileItem(text, style)];

  return {
    type: "compose_structure",
    style,
    palette,
    size,
    features,
    player: primaryPlayer,
    target: request.target || undefined,
    location: request.target || undefined,
    anchorId: request.target?.source === "anchor" ? request.target.anchorId || resolvedAnchor?.anchor?.id || null : resolvedAnchor?.anchor?.id || null
  };
}

module.exports = {
  detectChaosStyle,
  detectPileItem,
  parseBuildRequest
};
