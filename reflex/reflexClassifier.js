const HOSTILE_ENTITY_NAMES = new Set([
  "creeper",
  "zombie",
  "skeleton",
  "spider",
  "enderman",
  "witch",
  "slime",
  "phantom",
  "drowned",
  "husk",
  "stray",
  "pillager",
  "vindicator",
  "evoker",
  "ravager",
  "hoglin",
  "zoglin",
  "blaze",
  "ghast",
  "magma_cube"
]);

const RARE_BIOMES = new Set([
  "mushroom_fields",
  "ice_spikes",
  "eroded_badlands",
  "badlands",
  "wooded_badlands",
  "cherry_grove"
]);

function nowIso() {
  return new Date().toISOString();
}

function toBlockPosition(position) {
  if (!position) {
    return null;
  }

  return {
    x: Math.floor(Number(position.x)),
    y: Math.floor(Number(position.y)),
    z: Math.floor(Number(position.z))
  };
}

function distanceBetween(left, right) {
  const dx = Number(left.x) - Number(right.x);
  const dy = Number(left.y) - Number(right.y);
  const dz = Number(left.z) - Number(right.z);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function toBucket(position, size = 16) {
  return `${Math.floor(position.x / size)}:${Math.floor(position.y / size)}:${Math.floor(position.z / size)}`;
}

function isAir(block) {
  return !block || ["air", "cave_air", "void_air"].includes(block.name);
}

function getEntityName(entity) {
  return String(entity?.name || entity?.displayName || entity?.username || entity?.type || "").toLowerCase();
}

function isHostile(entity) {
  return HOSTILE_ENTITY_NAMES.has(getEntityName(entity));
}

function normalizeHintName(event) {
  if (event?.metadata?.name) {
    return event.metadata.name;
  }

  if (event?.description) {
    return event.description;
  }

  return "this place";
}

class ReflexClassifier {
  constructor({
    botAdapter,
    eventStore,
    threadId,
    primaryPlayer = "Sage",
    companionName = "Guardian",
    getWorldContext,
    idleThresholdMs = 90000,
    logger = console
  }) {
    this.botAdapter = botAdapter;
    this.eventStore = eventStore;
    this.threadId = threadId;
    this.primaryPlayer = primaryPlayer;
    this.companionName = companionName;
    this.getWorldContext = getWorldContext;
    this.idleThresholdMs = idleThresholdMs;
    this.logger = logger;
    this.lastPrimaryActivityAt = Date.now();
    this.lastSignalSignatures = new Map();
  }

  markPrimaryActivity() {
    this.lastPrimaryActivityAt = Date.now();
  }

  async scan(reason = "periodic") {
    const context = this.getWorldContext();
    if (!context?.worldId || !context?.sessionId || !this.botAdapter.bot?.entity?.position) {
      return [];
    }

    const snapshot = this.botAdapter.getSnapshot();
    const detections = await this.collectDetections(snapshot, reason);
    const activeTypes = new Set();
    const recorded = [];

    for (const detection of detections) {
      activeTypes.add(detection.type);

      if (this.lastSignalSignatures.get(detection.type) === detection.signature) {
        continue;
      }

      this.lastSignalSignatures.set(detection.type, detection.signature);

      const event = await this.eventStore.recordEvent({
        threadId: this.threadId,
        worldId: context.worldId,
        sessionId: context.sessionId,
        type: detection.type,
        description: detection.description,
        actor: detection.actor || this.primaryPlayer,
        location: detection.location,
        snapshot,
        metadata: {
          signature: detection.signature,
          reason,
          ...detection.metadata
        }
      });

      recorded.push(event);
    }

    for (const type of Array.from(this.lastSignalSignatures.keys())) {
      if (!activeTypes.has(type)) {
        this.lastSignalSignatures.delete(type);
      }
    }

    return recorded;
  }

  async collectDetections(snapshot, reason) {
    const detections = [];
    const bot = this.botAdapter.bot;
    const referencePosition = this.getReferencePosition();

    const creeper = this.findNearestEntity((entity) => getEntityName(entity) === "creeper", referencePosition, 10);
    if (creeper) {
      detections.push({
        type: "creeper_nearby",
        description: "Creeper detected nearby",
        location: toBlockPosition(creeper.position),
        actor: this.primaryPlayer,
        metadata: {
          entity: "creeper",
          distance: Math.round(distanceBetween(creeper.position, referencePosition) * 10) / 10
        },
        signature: `creeper:${toBucket(toBlockPosition(creeper.position))}`
      });
    }

    const hostile = this.findNearestEntity((entity) => isHostile(entity), referencePosition, 12);
    if (hostile) {
      detections.push({
        type: "mob_nearby",
        description: `${getEntityName(hostile)} detected nearby`,
        location: toBlockPosition(hostile.position),
        actor: this.primaryPlayer,
        metadata: {
          entity: getEntityName(hostile),
          distance: Math.round(distanceBetween(hostile.position, referencePosition) * 10) / 10
        },
        signature: `mob:${getEntityName(hostile)}:${toBucket(toBlockPosition(hostile.position))}`
      });
    }

    if (snapshot.time_of_day === "dusk") {
      detections.push({
        type: "night_approaching",
        description: "Night is approaching",
        location: snapshot.position,
        actor: this.companionName,
        metadata: {
          day: snapshot.day
        },
        signature: `night:${snapshot.day}:${snapshot.time_of_day}`
      });
    }

    const villager = this.findNearestEntity((entity) => getEntityName(entity) === "villager", bot.entity.position, 32);
    if (villager) {
      detections.push({
        type: "village_found",
        description: "Village signs detected nearby",
        location: toBlockPosition(villager.position),
        actor: this.primaryPlayer,
        metadata: {
          trigger: "villager_entity"
        },
        signature: `village:${toBucket(toBlockPosition(villager.position))}`
      });
    }

    const cave = this.detectCaveEntrance();
    if (cave) {
      detections.push({
        type: "cave_found",
        description: "Possible cave entrance nearby",
        location: cave,
        actor: this.primaryPlayer,
        metadata: {
          trigger: "air_cavity"
        },
        signature: `cave:${toBucket(cave)}`
      });
    }

    const interestingTerrain = this.detectInterestingTerrain();
    if (interestingTerrain) {
      detections.push({
        type: "interesting_terrain",
        description: "Buildable terrain nearby",
        location: interestingTerrain,
        actor: this.primaryPlayer,
        metadata: {
          trigger: "flat_terrain"
        },
        signature: `terrain:${toBucket(interestingTerrain)}`
      });
    }

    if (typeof snapshot.health === "number" && snapshot.health <= 8) {
      detections.push({
        type: "player_health_low",
        description: "Guardian health is low",
        location: snapshot.position,
        actor: this.botAdapter.config.username,
        metadata: {
          health: snapshot.health
        },
        signature: `health_low:${snapshot.health <= 4 ? "critical" : "low"}:${toBucket(snapshot.position)}`
      });
    }

    if (Date.now() - this.lastPrimaryActivityAt >= this.idleThresholdMs) {
      detections.push({
        type: "player_idle",
        description: "Primary player appears idle",
        location: snapshot.position,
        actor: this.primaryPlayer,
        metadata: {
          idle_ms: Date.now() - this.lastPrimaryActivityAt
        },
        signature: `idle:${toBucket(snapshot.position)}`
      });
    }

    const rareBiome = this.detectRareBiome();
    if (rareBiome) {
      detections.push({
        type: "rare_biome_found",
        description: `Rare biome detected: ${rareBiome}`,
        location: snapshot.position,
        actor: this.primaryPlayer,
        metadata: {
          biome: rareBiome
        },
        signature: `biome:${rareBiome}:${toBucket(snapshot.position)}`
      });
    }

    const memoryHint = await this.detectMemoryProximity(snapshot.position);
    if (memoryHint) {
      detections.push({
        type: "memory_proximity",
        description: `Near remembered place: ${normalizeHintName(memoryHint)}`,
        location: snapshot.position,
        actor: this.primaryPlayer,
        metadata: {
          memory_hint: {
            id: String(memoryHint.id),
            type: memoryHint.type,
            name: normalizeHintName(memoryHint),
            distance: Math.round(memoryHint.distance * 10) / 10
          }
        },
        signature: `memory:${String(memoryHint.id)}:${toBucket(snapshot.position)}`
      });
    }

    return detections;
  }

  getReferencePosition() {
    const playerEntity = this.botAdapter.getPlayerEntity(this.primaryPlayer);
    if (playerEntity?.position) {
      return playerEntity.position;
    }

    return this.botAdapter.bot?.entity?.position || null;
  }

  findNearestEntity(predicate, origin, radius) {
    if (!origin) {
      return null;
    }

    return Object.values(this.botAdapter.bot?.entities || {})
      .filter((entity) => entity?.position && predicate(entity))
      .map((entity) => ({
        entity,
        distance: distanceBetween(entity.position, origin)
      }))
      .filter((candidate) => candidate.distance <= radius)
      .sort((left, right) => left.distance - right.distance)[0]?.entity || null;
  }

  detectCaveEntrance() {
    const bot = this.botAdapter.bot;
    const origin = bot?.entity?.position;
    if (!bot || !origin || typeof bot.blockAt !== "function") {
      return null;
    }

    for (let dx = -6; dx <= 6; dx += 2) {
      for (let dz = -6; dz <= 6; dz += 2) {
        const candidate = origin.offset(dx, 0, dz);
        const belowOne = bot.blockAt(candidate.offset(0, -1, 0));
        const belowThree = bot.blockAt(candidate.offset(0, -3, 0));
        const side = bot.blockAt(candidate.offset(1, -1, 0));

        if (!isAir(belowOne) && isAir(belowThree) && side && /stone|deepslate|dirt|grass_block/.test(side.name)) {
          return toBlockPosition(candidate);
        }
      }
    }

    return null;
  }

  detectInterestingTerrain() {
    const bot = this.botAdapter.bot;
    const origin = bot?.entity?.position;
    const spawn = bot?.spawnPoint;
    if (!bot || !origin || !spawn || typeof bot.blockAt !== "function") {
      return null;
    }

    if (distanceBetween(origin, spawn) < 80) {
      return null;
    }

    const center = toBlockPosition(origin);
    const heights = [];

    for (let dx = -2; dx <= 2; dx += 1) {
      for (let dz = -2; dz <= 2; dz += 1) {
        const surface = bot.blockAt(origin.offset(dx, -1, dz));
        const above = bot.blockAt(origin.offset(dx, 0, dz));

        if (!surface || isAir(surface) || !above || !isAir(above)) {
          return null;
        }

        if (/water|lava/.test(surface.name)) {
          return null;
        }

        heights.push(surface.position.y);
      }
    }

    const minHeight = Math.min(...heights);
    const maxHeight = Math.max(...heights);
    if (maxHeight - minHeight > 1) {
      return null;
    }

    return center;
  }

  detectRareBiome() {
    const bot = this.botAdapter.bot;
    if (!bot || typeof bot.biomeAt !== "function" || !bot.entity?.position) {
      return null;
    }

    const biome = bot.biomeAt(bot.entity.position);
    const biomeName = typeof biome === "string" ? biome : biome?.name || biome?.displayName || null;
    const normalized = String(biomeName || "").toLowerCase().replace(/^minecraft:/, "");

    if (!normalized || !RARE_BIOMES.has(normalized)) {
      return null;
    }

    return normalized;
  }

  async detectMemoryProximity(position) {
    const context = this.getWorldContext();
    if (!context?.worldId || !position) {
      return null;
    }

    const hints = await this.eventStore.findNearbyMemoryHints(context.worldId, position, 20, 1);
    return hints[0] || null;
  }
}

module.exports = {
  ReflexClassifier
};
