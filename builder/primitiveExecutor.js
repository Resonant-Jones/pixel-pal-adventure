function makeKey(position) {
  return `${position.x}:${position.y}:${position.z}`;
}

function point(x, y, z) {
  return { x, y, z };
}

function expandRange(start, end) {
  const values = [];
  const step = start <= end ? 1 : -1;

  for (let current = start; step > 0 ? current <= end : current >= end; current += step) {
    values.push(current);
  }

  return values;
}

function calculateRawFootprint(placements) {
  const additions = placements.filter((placement) => !placement.remove);

  if (!additions.length) {
    return {
      width: 0,
      depth: 0,
      height: 0
    };
  }

  const xs = additions.map((placement) => placement.x);
  const ys = additions.map((placement) => placement.y);
  const zs = additions.map((placement) => placement.z);

  return {
    width: Math.max(...xs) - Math.min(...xs) + 1,
    depth: Math.max(...zs) - Math.min(...zs) + 1,
    height: Math.max(...ys) - Math.min(...ys) + 1
  };
}

function rotatePosition(position, direction, footprint) {
  switch (direction) {
    case "north":
      return {
        x: footprint.width - 1 - position.x,
        y: position.y,
        z: footprint.depth - 1 - position.z
      };
    case "east":
      return {
        x: footprint.depth - 1 - position.z,
        y: position.y,
        z: position.x
      };
    case "west":
      return {
        x: position.z,
        y: position.y,
        z: footprint.width - 1 - position.x
      };
    case "south":
    default:
      return { ...position };
  }
}

function expandFillRect(primitive, remove = false) {
  const placements = [];

  for (const x of expandRange(primitive.start.x, primitive.end.x)) {
    for (const y of expandRange(primitive.start.y, primitive.end.y)) {
      for (const z of expandRange(primitive.start.z, primitive.end.z)) {
        placements.push({
          x,
          y,
          z,
          block: primitive.block,
          remove
        });
      }
    }
  }

  return placements;
}

function expandWall(primitive) {
  return expandFillRect(primitive, false);
}

function expandPillar(primitive) {
  const placements = [];

  for (let dy = 0; dy < primitive.height; dy += 1) {
    placements.push({
      x: primitive.base.x,
      y: primitive.base.y + dy,
      z: primitive.base.z,
      block: primitive.block
    });
  }

  return placements;
}

function expandHollowBox(primitive) {
  const placements = [];
  const maxX = primitive.origin.x + primitive.width - 1;
  const maxY = primitive.origin.y + primitive.height - 1;
  const maxZ = primitive.origin.z + primitive.depth - 1;

  for (let x = primitive.origin.x; x <= maxX; x += 1) {
    for (let y = primitive.origin.y; y <= maxY; y += 1) {
      for (let z = primitive.origin.z; z <= maxZ; z += 1) {
        const onBoundary =
          x === primitive.origin.x ||
          x === maxX ||
          y === primitive.origin.y ||
          y === maxY ||
          z === primitive.origin.z ||
          z === maxZ;

        if (!onBoundary) {
          continue;
        }

        const block =
          y === primitive.origin.y
            ? primitive.floorBlock || primitive.block
            : y === maxY
              ? primitive.roofBlock || primitive.block
              : primitive.wallBlock || primitive.block;

        placements.push({ x, y, z, block });
      }
    }
  }

  return placements;
}

function expandPoint(primitive) {
  return [
    {
      x: primitive.position.x,
      y: primitive.position.y,
      z: primitive.position.z,
      block: primitive.block
    }
  ];
}

function expandRoofGable(primitive) {
  const placements = [];
  const half = Math.ceil(primitive.width / 2);

  for (let layer = 0; layer < half; layer += 1) {
    const leftX = primitive.origin.x + layer;
    const rightX = primitive.origin.x + primitive.width - 1 - layer;

    for (let z = primitive.origin.z; z < primitive.origin.z + primitive.depth; z += 1) {
      placements.push({
        x: leftX,
        y: primitive.origin.y + layer,
        z,
        block: primitive.block
      });

      placements.push({
        x: rightX,
        y: primitive.origin.y + layer,
        z,
        block: primitive.block
      });
    }
  }

  return placements;
}

function expandBridgeSpan(primitive) {
  const placements = [];
  const length = primitive.length;
  const width = primitive.width || 3;
  const deckStart = primitive.origin;
  const railBlock = primitive.railBlock;
  const supportBlock = primitive.supportBlock;

  placements.push(
    ...expandFillRect({
      start: deckStart,
      end: {
        x: deckStart.x + width - 1,
        y: deckStart.y,
        z: deckStart.z + length - 1
      },
      block: primitive.deckBlock
    })
  );

  if (primitive.withRailings && railBlock) {
    placements.push(
      ...expandFillRect({
        start: point(deckStart.x, deckStart.y + 1, deckStart.z),
        end: point(deckStart.x, deckStart.y + 1, deckStart.z + length - 1),
        block: railBlock
      }),
      ...expandFillRect({
        start: point(deckStart.x + width - 1, deckStart.y + 1, deckStart.z),
        end: point(deckStart.x + width - 1, deckStart.y + 1, deckStart.z + length - 1),
        block: railBlock
      })
    );
  }

  if (primitive.withSupports && supportBlock) {
    for (let offset = 0; offset < length; offset += 3) {
      placements.push(
        ...expandPillar({
          base: point(deckStart.x, deckStart.y - 1, deckStart.z + offset),
          height: 2,
          block: supportBlock
        }),
        ...expandPillar({
          base: point(deckStart.x + width - 1, deckStart.y - 1, deckStart.z + offset),
          height: 2,
          block: supportBlock
        })
      );
    }
  }

  return placements;
}

function expandPrimitive(primitive) {
  switch (primitive.type) {
    case "fill_rect":
      return expandFillRect(primitive);
    case "void_rect":
      return expandFillRect(primitive, true);
    case "wall":
      return expandWall(primitive);
    case "pillar":
      return expandPillar(primitive);
    case "hollow_box":
      return expandHollowBox(primitive);
    case "window_strip":
      return expandFillRect(primitive);
    case "point":
      return expandPoint(primitive);
    case "roof_gable":
      return expandRoofGable(primitive);
    case "bridge_span":
      return expandBridgeSpan(primitive);
    default:
      return [];
  }
}

function expandPrimitives(primitives = [], options = {}) {
  const direction = options.direction || "south";
  const rawPlacements = primitives.flatMap((primitive) => expandPrimitive(primitive));
  const rawFootprint = calculateRawFootprint(rawPlacements);
  const rotatedPlacements = rawPlacements.map((placement) => {
    const rotated = rotatePosition(placement, direction, rawFootprint);
    return {
      ...placement,
      x: rotated.x,
      y: rotated.y,
      z: rotated.z
    };
  });

  const map = new Map();

  for (const placement of rotatedPlacements) {
    const key = makeKey(placement);
    if (placement.remove) {
      map.delete(key);
      continue;
    }

    map.set(key, {
      x: placement.x,
      y: placement.y,
      z: placement.z,
      block: placement.block
    });
  }

  const placements = Array.from(map.values()).sort(
    (left, right) => left.y - right.y || left.z - right.z || left.x - right.x
  );

  return {
    placements,
    footprint: calculateRawFootprint(placements)
  };
}

function countMaterials(placements = []) {
  return placements.reduce((materials, placement) => {
    materials[placement.block] = (materials[placement.block] || 0) + 1;
    return materials;
  }, {});
}

module.exports = {
  countMaterials,
  expandPrimitives
};
