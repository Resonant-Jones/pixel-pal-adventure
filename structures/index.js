const smallWoodHouse = require("./small_wood_house.json");
const bridge = require("./bridge.json");
const welcomeHut = require("./welcome_hut.json");
const retrySchemas = require("./retrySchemas");

const STRUCTURES = {
  small_wood_house: smallWoodHouse,
  bridge,
  welcome_hut: welcomeHut
};

function normalizeStructureName(name) {
  const normalized = String(name || "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .trim();

  if (["house", "home", "hut", "cabin", "shelter", "base"].includes(normalized)) {
    return "small_wood_house";
  }

  return normalized;
}

function rotatePlacement(placement, direction, footprint) {
  const normalizedDirection = direction || "south";

  switch (normalizedDirection) {
    case "north":
      return {
        ...placement,
        x: footprint.width - 1 - placement.x,
        z: footprint.depth - 1 - placement.z
      };
    case "east":
      return {
        ...placement,
        x: footprint.depth - 1 - placement.z,
        z: placement.x
      };
    case "west":
      return {
        ...placement,
        x: placement.z,
        z: footprint.width - 1 - placement.x
      };
    case "south":
    default:
      return { ...placement };
  }
}

function rotateFootprint(footprint, direction) {
  const normalizedDirection = direction || "south";

  if (normalizedDirection === "east" || normalizedDirection === "west") {
    return {
      width: footprint.depth,
      depth: footprint.width,
      height: footprint.height
    };
  }

  return { ...footprint };
}

function getStructureTemplate(name, direction = "south") {
  const normalizedName = normalizeStructureName(name);
  const baseTemplate = STRUCTURES[normalizedName];

  if (!baseTemplate) {
    return null;
  }

  return {
    ...baseTemplate,
    name: normalizedName,
    direction,
    footprint: rotateFootprint(baseTemplate.footprint, direction),
    placements: baseTemplate.placements
      .map((placement) => rotatePlacement(placement, direction, baseTemplate.footprint))
      .sort((left, right) => left.y - right.y || left.z - right.z || left.x - right.x)
  };
}

module.exports = {
  getStructureTemplate,
  normalizeStructureName,
  ...retrySchemas
};
