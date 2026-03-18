function roundNumber(value) {
  return Math.round(Number(value) * 10) / 10;
}

function toBlockPosition(position) {
  if (!position) {
    return null;
  }

  return {
    x: Math.floor(position.x),
    y: Math.floor(position.y),
    z: Math.floor(position.z)
  };
}

function distanceBetween(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function classifyTimeOfDay(rawTime) {
  if (typeof rawTime !== "number") {
    return "unknown";
  }

  const time = ((rawTime % 24000) + 24000) % 24000;

  if (time < 1000) {
    return "sunrise";
  }

  if (time < 6000) {
    return "morning";
  }

  if (time < 12000) {
    return "day";
  }

  if (time < 13500) {
    return "dusk";
  }

  if (time < 18000) {
    return "night";
  }

  if (time < 22000) {
    return "midnight";
  }

  return "dawn";
}

function summarizeEntities(bot, origin, radius = 24, limit = 6) {
  if (!bot || !origin) {
    return [];
  }

  return Object.values(bot.entities || {})
    .filter((entity) => {
      if (!entity || !entity.position) {
        return false;
      }

      if (bot.entity && entity.id === bot.entity.id) {
        return false;
      }

      return distanceBetween(entity.position, origin) <= radius;
    })
    .sort((left, right) => distanceBetween(left.position, origin) - distanceBetween(right.position, origin))
    .slice(0, limit)
    .map((entity) => ({
      name: entity.username || entity.displayName || entity.name || entity.type,
      kind: entity.type,
      distance: roundNumber(distanceBetween(entity.position, origin)),
      position: toBlockPosition(entity.position)
    }));
}

function summarizeBlocks(bot, origin, radius = 2, limit = 8) {
  if (!bot || !origin || typeof bot.blockAt !== "function") {
    return [];
  }

  const uniqueBlocks = new Map();

  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        const block = bot.blockAt(origin.offset(dx, dy, dz));

        if (!block || !block.name || ["air", "cave_air", "void_air"].includes(block.name)) {
          continue;
        }

        const key = block.name;
        const candidate = {
          name: block.name,
          distance: roundNumber(distanceBetween(block.position, origin)),
          position: toBlockPosition(block.position)
        };

        const existing = uniqueBlocks.get(key);
        if (!existing || candidate.distance < existing.distance) {
          uniqueBlocks.set(key, candidate);
        }
      }
    }
  }

  return Array.from(uniqueBlocks.values())
    .sort((left, right) => left.distance - right.distance)
    .slice(0, limit);
}

function summarizePlayerState(bot, focusPlayer) {
  if (!focusPlayer) {
    return null;
  }

  const target = bot?.players?.[focusPlayer]?.entity || null;

  return {
    name: focusPlayer,
    visible: Boolean(target),
    distance:
      target && bot?.entity?.position ? roundNumber(distanceBetween(target.position, bot.entity.position)) : null,
    position: target ? toBlockPosition(target.position) : null
  };
}

function captureWorldSnapshot(bot, options = {}) {
  const snapshot = {
    captured_at: new Date().toISOString(),
    dimension: bot?.game?.dimension || "unknown",
    position: null,
    player_position: null,
    health: null,
    player_health: null,
    food: null,
    player_hunger: null,
    time_of_day: "unknown",
    raw_time: null,
    day: null,
    is_raining: Boolean(bot?.isRaining),
    nearby_entities: [],
    nearby_blocks: [],
    player_state: null
  };

  if (!bot?.entity?.position) {
    return snapshot;
  }

  const radius = options.radius || 24;
  const maxEntities = Math.min(options.maxEntities || 10, 10);
  const maxBlocks = options.maxBlocks || 8;

  snapshot.position = toBlockPosition(bot.entity.position);
  snapshot.player_position = snapshot.position;
  snapshot.health = typeof bot.health === "number" ? bot.health : null;
  snapshot.player_health = snapshot.health;
  snapshot.food = typeof bot.food === "number" ? bot.food : null;
  snapshot.player_hunger = snapshot.food;
  snapshot.raw_time = typeof bot.time?.timeOfDay === "number" ? bot.time.timeOfDay : null;
  snapshot.day = typeof bot.time?.day === "number" ? bot.time.day : null;
  snapshot.time_of_day = classifyTimeOfDay(snapshot.raw_time);
  snapshot.nearby_entities = summarizeEntities(bot, bot.entity.position, radius, maxEntities);
  snapshot.nearby_blocks = summarizeBlocks(bot, bot.entity.position, 2, maxBlocks);
  snapshot.player_state = summarizePlayerState(bot, options.focusPlayer);

  return snapshot;
}

function formatWorldSnapshot(snapshot) {
  return JSON.stringify(snapshot, null, 2);
}

module.exports = {
  captureWorldSnapshot,
  formatWorldSnapshot
};
