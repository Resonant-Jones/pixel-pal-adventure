const SIZE_PRESETS = {
  tiny: { width: 4, depth: 5, wallHeight: 2, towerHeight: 5, bridgeLength: 6 },
  small: { width: 5, depth: 6, wallHeight: 3, towerHeight: 7, bridgeLength: 8 },
  medium: { width: 7, depth: 8, wallHeight: 4, towerHeight: 10, bridgeLength: 12 },
  large: { width: 9, depth: 10, wallHeight: 5, towerHeight: 14, bridgeLength: 16 }
};

const PALETTES = {
  oak: {
    wall: "oak_planks",
    floor: "oak_planks",
    roof: "oak_planks",
    accent: "oak_log",
    railing: "oak_fence",
    window: "glass",
    door: "oak_door",
    seat: "oak_log",
    campfire: "campfire"
  },
  spruce: {
    wall: "spruce_planks",
    floor: "spruce_planks",
    roof: "spruce_planks",
    accent: "spruce_log",
    railing: "spruce_fence",
    window: "glass",
    door: "spruce_door",
    seat: "spruce_log",
    campfire: "campfire"
  },
  birch: {
    wall: "birch_planks",
    floor: "birch_planks",
    roof: "birch_planks",
    accent: "birch_log",
    railing: "birch_fence",
    window: "glass",
    door: "birch_door",
    seat: "birch_log",
    campfire: "campfire"
  },
  stone: {
    wall: "stone_bricks",
    floor: "cobblestone",
    roof: "stone_bricks",
    accent: "cobblestone",
    railing: "cobblestone_wall",
    window: "glass",
    door: "oak_door",
    seat: "cobblestone",
    campfire: "campfire"
  },
  deepslate: {
    wall: "deepslate_bricks",
    floor: "cobbled_deepslate",
    roof: "deepslate_tiles",
    accent: "polished_deepslate",
    railing: "cobbled_deepslate_wall",
    window: "glass",
    door: "oak_door",
    seat: "cobbled_deepslate",
    campfire: "campfire"
  }
};

const STYLE_DEFAULTS = {
  cabin: {
    palette: "oak",
    size: "small",
    features: ["door", "windows", "gable_roof"]
  },
  hut: {
    palette: "oak",
    size: "small",
    features: ["door", "windows", "gable_roof"]
  },
  tower: {
    palette: "stone",
    size: "medium",
    features: ["door", "windows", "platform"]
  },
  bridge: {
    palette: "oak",
    size: "medium",
    features: ["railings", "supports"]
  },
  camp: {
    palette: "spruce",
    size: "small",
    features: ["campfire", "seats", "lean_to"]
  }
};

function uniq(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeStyleName(style) {
  const normalized = String(style || "")
    .toLowerCase()
    .replace(/[^a-z_ ]/g, "")
    .trim()
    .replace(/\s+/g, "_");

  if (["house", "home", "shelter", "cabin"].includes(normalized)) {
    return "cabin";
  }

  if (normalized === "small_wood_house") {
    return "cabin";
  }

  if (normalized === "watch_tower") {
    return "tower";
  }

  if (normalized === "campfire_camp") {
    return "camp";
  }

  return STYLE_DEFAULTS[normalized] ? normalized : "cabin";
}

function normalizePaletteName(palette, fallback = "oak") {
  const normalized = String(palette || "")
    .toLowerCase()
    .replace(/[^a-z_ ]/g, "")
    .trim()
    .replace(/\s+/g, "_");

  if (!normalized) {
    return fallback;
  }

  if (normalized === "cobble") {
    return "stone";
  }

  if (normalized === "dark_oak") {
    return "spruce";
  }

  return PALETTES[normalized] ? normalized : fallback;
}

function normalizeSizeName(size, fallback = "small") {
  const normalized = String(size || "")
    .toLowerCase()
    .trim();

  if (["tiny", "compact"].includes(normalized)) {
    return "tiny";
  }

  if (["small", "cozy"].includes(normalized)) {
    return "small";
  }

  if (["big", "wide", "tall", "large"].includes(normalized)) {
    return "large";
  }

  return SIZE_PRESETS[normalized] ? normalized : fallback;
}

function normalizeDirection(direction, fallback = "south") {
  const normalized = String(direction || "")
    .toLowerCase()
    .trim();

  return ["north", "south", "east", "west"].includes(normalized) ? normalized : fallback;
}

function resolveStylePlan(input = {}) {
  const style = normalizeStyleName(input.style || input.structure || input.template);
  const defaults = STYLE_DEFAULTS[style] || STYLE_DEFAULTS.cabin;
  const size = normalizeSizeName(input.size, defaults.size);
  const paletteName = normalizePaletteName(input.palette, defaults.palette);
  const direction = normalizeDirection(input.direction, input.style === "bridge" ? "south" : "south");
  const features = uniq([...(defaults.features || []), ...(Array.isArray(input.features) ? input.features : [])]).map(
    (feature) => String(feature).toLowerCase().replace(/\s+/g, "_")
  );

  return {
    style,
    size,
    direction,
    paletteName,
    palette: PALETTES[paletteName],
    features,
    dimensions: SIZE_PRESETS[size]
  };
}

module.exports = {
  PALETTES,
  SIZE_PRESETS,
  STYLE_DEFAULTS,
  normalizeDirection,
  normalizePaletteName,
  normalizeSizeName,
  normalizeStyleName,
  resolveStylePlan
};
