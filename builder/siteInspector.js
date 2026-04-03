function isAirBlock(block) {
  return !block || ["air", "cave_air", "void_air"].includes(block.name);
}

function isLiquidBlock(block) {
  return Boolean(block?.name && /(water|lava)/.test(block.name));
}

function isReplaceableBlock(block) {
  return (
    isAirBlock(block) ||
    Boolean(
      block?.name &&
        [
          "grass",
          "tall_grass",
          "short_grass",
          "fern",
          "large_fern",
          "vine",
          "snow",
          "snow_layer",
          "dead_bush"
        ].includes(block.name)
    )
  );
}

function toBlockPosition(position) {
  return {
    x: Math.floor(Number(position.x)),
    y: Math.floor(Number(position.y)),
    z: Math.floor(Number(position.z))
  };
}

function inspectFootprint(botAdapter, origin, footprint, options = {}) {
  if (!botAdapter?.bot || !origin || !footprint) {
    return {
      ok: false,
      reason: "missing_context",
      obstructed_positions: []
    };
  }

  const width = Number(footprint.width || 0);
  const depth = Number(footprint.depth || 0);
  const baseY = Math.floor(Number(origin.y));
  const obstructed = [];
  const liquids = [];

  for (let dx = 0; dx < width; dx += 1) {
    for (let dz = 0; dz < depth; dz += 1) {
      const target = {
        x: Math.floor(origin.x + dx),
        y: baseY,
        z: Math.floor(origin.z + dz)
      };
      const block = botAdapter.bot.blockAt(target);
      if (!block) {
        obstructed.push(target);
        continue;
      }

      if (isLiquidBlock(block)) {
        liquids.push(toBlockPosition(block.position));
      }

      if (!isReplaceableBlock(block)) {
        obstructed.push(target);
      }
    }
  }

  return {
    ok: obstructed.length === 0,
    obstructed_positions: obstructed,
    liquid_positions: liquids,
    footprint: {
      width,
      depth,
      y: baseY
    },
    inspected_at: new Date().toISOString(),
    sample: options.sample || "footprint"
  };
}

module.exports = {
  inspectFootprint
};
