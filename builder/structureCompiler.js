const { countMaterials, expandPrimitives } = require("./primitiveExecutor");
const { resolveStylePlan } = require("./styleProfiles");

function describePlan(style, size, paletteName, features) {
  const featureText = features.length ? ` with ${features.join(", ").replace(/_/g, " ")}` : "";
  return `${size} ${paletteName} ${style}${featureText}`;
}

function buildCabinPrimitives(plan) {
  const { dimensions, palette, features } = plan;
  const width = dimensions.width;
  const depth = dimensions.depth;
  const wallHeight = dimensions.wallHeight;
  const frontDoorX = Math.floor(width / 2);
  const primitives = [
    {
      type: "fill_rect",
      start: { x: 0, y: 0, z: 0 },
      end: { x: width - 1, y: 0, z: depth - 1 },
      block: palette.floor
    },
    {
      type: "hollow_box",
      origin: { x: 0, y: 1, z: 0 },
      width,
      height: wallHeight,
      depth,
      wallBlock: palette.wall,
      roofBlock: palette.wall,
      floorBlock: palette.floor
    },
    {
      type: "void_rect",
      start: { x: frontDoorX, y: 1, z: depth - 1 },
      end: { x: frontDoorX, y: 2, z: depth - 1 }
    }
  ];

  if (features.includes("windows")) {
    const windowZ = Math.max(1, Math.floor(depth / 2) - 1);
    primitives.push(
      {
        type: "void_rect",
        start: { x: 0, y: 2, z: windowZ },
        end: { x: 0, y: 2, z: windowZ + 1 }
      },
      {
        type: "void_rect",
        start: { x: width - 1, y: 2, z: windowZ },
        end: { x: width - 1, y: 2, z: windowZ + 1 }
      },
      {
        type: "window_strip",
        start: { x: 0, y: 2, z: windowZ },
        end: { x: 0, y: 2, z: windowZ + 1 },
        block: palette.window
      },
      {
        type: "window_strip",
        start: { x: width - 1, y: 2, z: windowZ },
        end: { x: width - 1, y: 2, z: windowZ + 1 },
        block: palette.window
      }
    );
  }

  if (features.includes("gable_roof")) {
    primitives.push({
      type: "roof_gable",
      origin: { x: 0, y: wallHeight + 1, z: 0 },
      width,
      depth,
      block: palette.roof
    });
  }

  return primitives;
}

function buildTowerPrimitives(plan) {
  const { dimensions, palette, features } = plan;
  const width = plan.size === "large" ? 7 : 5;
  const depth = width;
  const height = dimensions.towerHeight;
  const frontDoorX = Math.floor(width / 2);
  const primitives = [
    {
      type: "fill_rect",
      start: { x: 0, y: 0, z: 0 },
      end: { x: width - 1, y: 0, z: depth - 1 },
      block: palette.floor
    },
    {
      type: "hollow_box",
      origin: { x: 0, y: 1, z: 0 },
      width,
      height,
      depth,
      wallBlock: palette.wall,
      roofBlock: palette.roof,
      floorBlock: palette.floor
    },
    {
      type: "void_rect",
      start: { x: frontDoorX, y: 1, z: depth - 1 },
      end: { x: frontDoorX, y: 2, z: depth - 1 }
    }
  ];

  if (features.includes("windows")) {
    primitives.push(
      {
        type: "void_rect",
        start: { x: 0, y: 3, z: 2 },
        end: { x: 0, y: 3, z: 2 }
      },
      {
        type: "point",
        position: { x: 0, y: 3, z: 2 },
        block: palette.window
      }
    );
  }

  if (features.includes("platform")) {
    primitives.push({
      type: "fill_rect",
      start: { x: 0, y: height, z: 0 },
      end: { x: width - 1, y: height, z: depth - 1 },
      block: palette.roof
    });
  }

  return primitives;
}

function buildBridgePrimitives(plan) {
  const { dimensions, palette, features } = plan;

  return [
    {
      type: "bridge_span",
      origin: { x: 0, y: 0, z: 0 },
      length: dimensions.bridgeLength,
      width: 3,
      deckBlock: palette.floor,
      railBlock: palette.railing,
      supportBlock: palette.accent,
      withRailings: features.includes("railings"),
      withSupports: features.includes("supports")
    }
  ];
}

function buildCampPrimitives(plan) {
  const { palette, features } = plan;
  const primitives = [
    {
      type: "fill_rect",
      start: { x: 0, y: 0, z: 0 },
      end: { x: 2, y: 0, z: 2 },
      block: palette.floor
    }
  ];

  if (features.includes("lean_to")) {
    primitives.push(
      {
        type: "pillar",
        base: { x: 0, y: 1, z: 0 },
        height: 2,
        block: palette.accent
      },
      {
        type: "pillar",
        base: { x: 2, y: 1, z: 0 },
        height: 2,
        block: palette.accent
      },
      {
        type: "fill_rect",
        start: { x: 0, y: 3, z: 0 },
        end: { x: 2, y: 3, z: 2 },
        block: palette.roof
      }
    );
  }

  if (features.includes("campfire")) {
    primitives.push({
      type: "point",
      position: { x: 1, y: 1, z: 4 },
      block: palette.campfire
    });
  }

  if (features.includes("seats")) {
    primitives.push(
      {
        type: "point",
        position: { x: 0, y: 1, z: 4 },
        block: palette.seat
      },
      {
        type: "point",
        position: { x: 2, y: 1, z: 4 },
        block: palette.seat
      }
    );
  }

  return primitives;
}

function compilePrimitives(plan) {
  switch (plan.style) {
    case "tower":
      return buildTowerPrimitives(plan);
    case "bridge":
      return buildBridgePrimitives(plan);
    case "camp":
      return buildCampPrimitives(plan);
    case "hut":
    case "cabin":
    default:
      return buildCabinPrimitives(plan);
  }
}

function buildCompletionMessage(plan) {
  switch (plan.style) {
    case "bridge":
      return "The bridge is finished.";
    case "tower":
      return "The tower is finished.";
    case "camp":
      return "Camp is ready.";
    case "hut":
    case "cabin":
    default:
      return "The build is ready.";
  }
}

function compileStructure(input = {}) {
  const plan = resolveStylePlan(input);
  const primitives = compilePrimitives(plan);
  const expanded = expandPrimitives(primitives, {
    direction: plan.direction
  });
  const materials = countMaterials(expanded.placements);
  const summary = describePlan(plan.style, plan.size, plan.paletteName, plan.features);

  return {
    ...plan,
    primitives,
    materials,
    footprint: expanded.footprint,
    summary,
    completionMessage: buildCompletionMessage(plan)
  };
}

module.exports = {
  compileStructure
};
