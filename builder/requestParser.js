const {
  normalizePaletteName,
  normalizeSizeName,
  normalizeStyleName
} = require("./styleProfiles");

function normalizeText(message) {
  return String(message || "")
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

function parseBuildRequest(message, primaryPlayer = "Sage") {
  const text = normalizeText(message);
  const hasStructureCue = /\b(bridge|tower|camp|hut|cabin|house|home|shelter|base)\b/.test(text);
  const hasTemplateCue = /\b(template|blueprint|prebuilt|quick build)\b/.test(text);

  if (!hasTemplateCue) {
    return null;
  }

  if (!/\b(build|construct)\b/.test(text) && !(/\bmake\b/.test(text) && hasStructureCue)) {
    return null;
  }

  const style = normalizeStyleName(detectStyle(text));
  const palette = normalizePaletteName(detectPalette(text, style === "tower" ? "stone" : style === "camp" ? "spruce" : "oak"));
  const size = normalizeSizeName(detectSize(text, style === "bridge" ? "medium" : "small"));
  const features = detectFeatures(text, style);

  return {
    type: "compose_structure",
    style,
    palette,
    size,
    features,
    player: primaryPlayer
  };
}

module.exports = {
  parseBuildRequest
};
