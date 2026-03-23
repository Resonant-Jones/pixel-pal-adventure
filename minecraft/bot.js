const { EventEmitter } = require("events");

const mineflayer = require("mineflayer");
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");

const { captureWorldSnapshot } = require("./worldSnapshot");

const { GoalBlock, GoalFollow, GoalNear } = goals;

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeChat(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function normalizeBlockPosition(position) {
  if (!position) {
    return null;
  }

  if (Array.isArray(position) && position.length >= 3) {
    return {
      x: Math.floor(Number(position[0])),
      y: Math.floor(Number(position[1])),
      z: Math.floor(Number(position[2]))
    };
  }

  if (typeof position === "object") {
    const { x, y, z } = position;

    if ([x, y, z].every((value) => Number.isFinite(Number(value)))) {
      return {
        x: Math.floor(Number(x)),
        y: Math.floor(Number(y)),
        z: Math.floor(Number(z))
      };
    }
  }

  return null;
}

function distanceBetween(left, right) {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

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

function toVec3(bot, position) {
  const normalized = normalizeBlockPosition(position);

  if (!bot?.entity?.position || !normalized) {
    return null;
  }

  const vector = bot.entity.position.clone();
  vector.x = normalized.x;
  vector.y = normalized.y;
  vector.z = normalized.z;
  return vector;
}

function formatMaterialList(materials) {
  return materials.map((material) => `${material.missing} ${material.item}`).join(", ");
}

function resolveLookTarget(bot, target) {
  if (!bot?.entity?.position) {
    return null;
  }

  if (typeof target === "string") {
    const entity = bot.players?.[target]?.entity || null;
    return entity ? entity.position.offset(0, entity.height || 1.6, 0) : null;
  }

  const coordinates = normalizeBlockPosition(target);

  if (!coordinates) {
    return null;
  }

  const lookTarget = bot.entity.position.clone();
  lookTarget.x = coordinates.x;
  lookTarget.y = coordinates.y;
  lookTarget.z = coordinates.z;
  return lookTarget;
}

class MinecraftBotAdapter extends EventEmitter {
  constructor(config, logger = console) {
    super();
    this.config = config;
    this.logger = logger;
    this.bot = null;
    this.movements = null;
  }

  async connect() {
    if (this.bot) {
      return this.bot;
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const bot = mineflayer.createBot({
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        version: this.config.version || undefined,
        auth: this.config.auth || "offline"
      });

      this.bot = bot;
      bot.loadPlugin(pathfinder);
      this.#wireLifecycle(bot, reject, () => settled, () => {
        settled = true;
      });

      bot.once("spawn", () => {
        this.movements = new Movements(bot);
        bot.pathfinder.setMovements(this.movements);
        this.logger.info(
          `[minecraft] ${bot.username} spawned on ${this.config.host}:${this.config.port}`
        );

        this.emit("spawn", this.getSnapshot());

        if (!settled) {
          settled = true;
          resolve(bot);
        }
      });
    });
  }

  #wireLifecycle(bot, reject, isSettled, markSettled) {
    bot.on("chat", (username, message) => {
      this.emit("chat", {
        username,
        message,
        timestamp: new Date().toISOString(),
        isPrimaryPlayer: username === this.config.primaryPlayer,
        directMention: new RegExp(`\\b${escapeRegex(this.config.username)}\\b`, "i").test(message)
      });
    });

    bot.on("entityMoved", (entity) => {
      if (entity?.username === this.config.primaryPlayer) {
        this.emit("entityMoved", {
          username: entity.username,
          timestamp: new Date().toISOString(),
          position: {
            x: Math.floor(entity.position.x),
            y: Math.floor(entity.position.y),
            z: Math.floor(entity.position.z)
          }
        });
      }
    });

    const emitNearbyEntityChanged = (entity, changeType) => {
      if (!entity?.position || !bot?.entity?.position) {
        return;
      }

      if (entity.id === bot.entity?.id) {
        return;
      }

      if (distanceBetween(entity.position, bot.entity.position) > 16) {
        return;
      }

      this.emit("nearbyEntityChanged", {
        changeType,
        entityName: entity.username || entity.displayName || entity.name || entity.type,
        entityType: entity.name || entity.type,
        timestamp: new Date().toISOString(),
        position: {
          x: Math.floor(entity.position.x),
          y: Math.floor(entity.position.y),
          z: Math.floor(entity.position.z)
        }
      });
    };

    bot.on("entitySpawn", (entity) => {
      emitNearbyEntityChanged(entity, "spawn");
    });

    bot.on("entityGone", (entity) => {
      emitNearbyEntityChanged(entity, "gone");
    });

    bot.on("time", () => {
      this.emit("timeUpdate", {
        timestamp: new Date().toISOString(),
        rawTime: bot.time?.timeOfDay || null,
        day: bot.time?.day || null
      });
    });

    bot.on("error", (error) => {
      this.logger.error("[minecraft] Bot error:", error);
      this.emit("botError", error);

      if (!isSettled()) {
        markSettled();
        reject(error);
      }
    });

    bot.on("kicked", (reason) => {
      const message = typeof reason === "string" ? reason : JSON.stringify(reason);
      const error = new Error(`Minecraft connection was kicked: ${message}`);
      this.logger.error("[minecraft] Bot kicked:", message);
      this.emit("botError", error);

      if (!isSettled()) {
        markSettled();
        reject(error);
      }
    });

    bot.on("end", () => {
      this.bot = null;
      this.movements = null;
      this.emit("end");
      this.logger.warn("[minecraft] Connection ended.");

      if (!isSettled()) {
        markSettled();
        reject(new Error("Minecraft connection ended before the bot spawned."));
      }
    });
  }

  async say(text) {
    if (!this.bot) {
      throw new Error("Bot is not connected.");
    }

    const message = sanitizeChat(text);

    if (!message) {
      return;
    }

    this.bot.chat(message);
  }

  getPlayerEntity(username) {
    return this.bot?.players?.[username]?.entity || null;
  }

  async followPlayer(username = this.config.primaryPlayer) {
    if (!this.bot) {
      throw new Error("Bot is not connected.");
    }

    const entity = this.getPlayerEntity(username);

    if (!entity) {
      throw new Error(`Player ${username} is not visible to the bot.`);
    }

    this.bot.pathfinder.setMovements(this.movements || new Movements(this.bot));
    this.bot.pathfinder.setGoal(new GoalFollow(entity, this.config.followDistance || 2), true);
  }

  async stopFollowing() {
    if (!this.bot) {
      throw new Error("Bot is not connected.");
    }

    this.stopPathing();
  }

  async moveTo(position) {
    if (!this.bot) {
      throw new Error("Bot is not connected.");
    }

    const target = normalizeBlockPosition(position);

    if (!target) {
      throw new Error("Invalid move_to coordinates.");
    }

    this.bot.pathfinder.setMovements(this.movements || new Movements(this.bot));
    this.bot.pathfinder.setGoal(new GoalBlock(target.x, target.y, target.z), false);
  }

  async goNear(position, range = 3) {
    if (!this.bot) {
      throw new Error("Bot is not connected.");
    }

    const target = normalizeBlockPosition(position);
    if (!target) {
      throw new Error("Invalid coordinates.");
    }

    this.bot.pathfinder.setMovements(this.movements || new Movements(this.bot));
    await this.bot.pathfinder.goto(new GoalNear(target.x, target.y, target.z, range));
  }

  async lookAt(target) {
    if (!this.bot) {
      throw new Error("Bot is not connected.");
    }

    const lookTarget = resolveLookTarget(this.bot, target);

    if (!lookTarget) {
      throw new Error("Unable to resolve a target for look_at.");
    }

    await this.bot.lookAt(lookTarget, true);
  }

  stopPathing() {
    this.bot?.pathfinder?.setGoal(null);
  }

  getFacingDirection(username = this.config.primaryPlayer) {
    const entity = this.getPlayerEntity(username) || this.bot?.entity || null;
    const yaw = Number(entity?.yaw || 0);
    const normalized = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

    if (normalized < Math.PI / 4 || normalized >= (Math.PI * 7) / 4) {
      return "south";
    }

    if (normalized < (Math.PI * 3) / 4) {
      return "west";
    }

    if (normalized < (Math.PI * 5) / 4) {
      return "north";
    }

    return "east";
  }

  getInventoryCounts() {
    const counts = new Map();

    for (const item of this.bot?.inventory?.items?.() || []) {
      counts.set(item.name, (counts.get(item.name) || 0) + item.count);
    }

    return counts;
  }

  getInventorySummary(limit = 8) {
    const counts = Array.from(this.getInventoryCounts().entries())
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));

    return {
      items: counts,
      summary: counts.length
        ? `I have ${counts
            .slice(0, limit)
            .map((item) => `${item.count} ${item.name}`)
            .join(", ")}.`
        : "My inventory is empty."
    };
  }

  countInventoryItem(itemName) {
    return this.getInventoryCounts().get(itemName) || 0;
  }

  isCreativeMode() {
    return this.bot?.game?.gameMode === "creative";
  }

  async runCommand(command) {
    if (!this.bot) {
      throw new Error("Bot is not connected.");
    }

    const normalized = String(command || "").trim();
    if (!normalized.startsWith("/")) {
      throw new Error("Commands must start with '/'.");
    }

    this.bot.chat(normalized);
  }

  buildGiveCommands(missing = [], username = this.config.username) {
    const commands = [];

    for (const item of missing) {
      let remaining = Number(item.missing || item.count || 0);

      while (remaining > 0) {
        const chunk = Math.min(remaining, 64);
        commands.push(`/give ${username} ${item.item} ${chunk}`);
        remaining -= chunk;
      }
    }

    return commands;
  }

  async provisionBuildMaterials(missing = [], options = {}) {
    const commands = this.buildGiveCommands(missing, options.username || this.config.username);

    if (!commands.length) {
      return {
        provided: true,
        commands: []
      };
    }

    if (!(options.autoGive && this.isCreativeMode())) {
      return {
        provided: false,
        commands
      };
    }

    for (const command of commands) {
      await this.runCommand(command);
    }

    return {
      provided: true,
      commands
    };
  }

  getMissingMaterials(requirements = []) {
    return requirements
      .map((requirement) => {
        const available = this.countInventoryItem(requirement.item);
        const missing = Math.max(0, requirement.count - available);

        return {
          item: requirement.item,
          required: requirement.count,
          available,
          missing
        };
      })
      .filter((requirement) => requirement.missing > 0);
  }

  findInventoryItem(itemName) {
    return (
      this.bot?.inventory?.items?.().find((item) => item.name === itemName) || null
    );
  }

  async digBlock(position) {
    if (!this.bot) {
      throw new Error("Bot is not connected.");
    }

    const target = normalizeBlockPosition(position);
    const targetVec = toVec3(this.bot, target);
    const block = targetVec ? this.bot.blockAt(targetVec) : null;

    if (!target || !targetVec || !block || isAirBlock(block)) {
      return {
        status: "skipped",
        position: target,
        message: "That spot is already clear."
      };
    }

    if (!block.diggable) {
      return {
        status: "blocked",
        position: target,
        message: `I can't dig ${block.displayName || block.name} there.`
      };
    }

    await this.goNear(target, 3);
    await this.bot.dig(block);

    return {
      status: "dug",
      position: target
    };
  }

  findPlacementReference(targetVec) {
    const offsets = [
      { dx: 0, dy: -1, dz: 0 },
      { dx: 1, dy: 0, dz: 0 },
      { dx: -1, dy: 0, dz: 0 },
      { dx: 0, dy: 0, dz: 1 },
      { dx: 0, dy: 0, dz: -1 },
      { dx: 0, dy: 1, dz: 0 }
    ];

    for (const offset of offsets) {
      const referenceVec = targetVec.offset(offset.dx, offset.dy, offset.dz);
      const referenceBlock = this.bot.blockAt(referenceVec);

      if (!referenceBlock || isAirBlock(referenceBlock) || referenceBlock.boundingBox !== "block") {
        continue;
      }

      return {
        block: referenceBlock,
        faceVector: targetVec.minus(referenceBlock.position)
      };
    }

    return null;
  }

  async clearBlockForPlacement(position) {
    const targetVec = toVec3(this.bot, position);
    const block = targetVec ? this.bot.blockAt(targetVec) : null;

    if (!block || isAirBlock(block)) {
      return true;
    }

    if (!isReplaceableBlock(block) || !block.diggable) {
      return false;
    }

    await this.goNear(position, 3);
    await this.bot.dig(block);
    return true;
  }

  async placeBlock(blockName, position) {
    if (!this.bot) {
      throw new Error("Bot is not connected.");
    }

    const target = normalizeBlockPosition(position);
    const targetVec = toVec3(this.bot, target);
    const item = this.findInventoryItem(blockName);

    if (!target || !targetVec) {
      throw new Error("Invalid place_block coordinates.");
    }

    if (!item) {
      return {
        status: "needs_materials",
        position: target,
        message: `I need ${blockName} in my inventory first.`
      };
    }

    const existing = this.bot.blockAt(targetVec);
    if (existing?.name === blockName) {
      return {
        status: "already_placed",
        position: target
      };
    }

    if (existing && !isAirBlock(existing)) {
      const cleared = await this.clearBlockForPlacement(target);
      if (!cleared) {
        return {
          status: "blocked",
          position: target,
          message: `I can't clear ${existing.displayName || existing.name} from that spot.`
        };
      }
    }

    const reference = this.findPlacementReference(targetVec);
    if (!reference) {
      return {
        status: "blocked",
        position: target,
        message: "I need a solid block next to that spot before I can place anything there."
      };
    }

    await this.goNear(target, 4);
    await this.bot.equip(item, "hand");

    try {
      await this.bot.placeBlock(reference.block, reference.faceVector);
    } catch (error) {
      const afterAttempt = this.bot.blockAt(targetVec);
      if (afterAttempt?.name === blockName) {
        return {
          status: "placed",
          position: target,
          block: blockName
        };
      }

      return {
        status: "blocked",
        position: target,
        message: `I couldn't place ${blockName} there.`
      };
    }

    return {
      status: "placed",
      position: target,
      block: blockName
    };
  }

  canBuildAt(template, origin) {
    if (!this.bot) {
      return false;
    }

    for (const placement of template.placements) {
      const target = {
        x: origin.x + placement.x,
        y: origin.y + placement.y,
        z: origin.z + placement.z
      };
      const targetVec = toVec3(this.bot, target);
      const block = targetVec ? this.bot.blockAt(targetVec) : null;

      if (!block) {
        return false;
      }

      if (!isReplaceableBlock(block) && block.name !== placement.block) {
        return false;
      }

      if (placement.y === 0) {
        const below = this.bot.blockAt(targetVec.offset(0, -1, 0));
        if (!below || isAirBlock(below) || isLiquidBlock(below)) {
          return false;
        }
      }
    }

    return true;
  }

  findFlatBuildSite(template, anchorUsername = this.config.primaryPlayer, radius = 10) {
    if (!this.bot?.entity?.position || typeof this.bot.blockAt !== "function") {
      return null;
    }

    const anchor = this.getPlayerEntity(anchorUsername) || this.bot.entity;
    const centerX = Math.floor(anchor.position.x);
    const centerY = Math.floor(anchor.position.y);
    const centerZ = Math.floor(anchor.position.z);
    const candidates = [];

    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        const distance = Math.sqrt(dx * dx + dz * dz);
        if (distance < 4) {
          continue;
        }

        candidates.push({
          x: centerX + dx - Math.floor(template.footprint.width / 2),
          y: centerY,
          z: centerZ + dz - Math.floor(template.footprint.depth / 2),
          distance
        });
      }
    }

    candidates.sort((left, right) => left.distance - right.distance);

    for (const candidate of candidates) {
      if (this.canBuildAt(template, candidate)) {
        return {
          x: candidate.x,
          y: candidate.y,
          z: candidate.z
        };
      }
    }

    return null;
  }

  findDirectionalBuildSite(template, username = this.config.primaryPlayer) {
    if (!this.bot?.entity?.position) {
      return null;
    }

    const anchor = this.getPlayerEntity(username) || this.bot.entity;
    const centerX = Math.floor(anchor.position.x);
    const centerY = Math.floor(anchor.position.y);
    const centerZ = Math.floor(anchor.position.z);
    const direction = template.direction || this.getFacingDirection(username);
    const halfWidth = Math.floor(template.footprint.width / 2);
    let origin = null;

    switch (direction) {
      case "north":
        origin = { x: centerX - halfWidth, y: centerY, z: centerZ - template.footprint.depth - 1 };
        break;
      case "east":
        origin = { x: centerX + 2, y: centerY, z: centerZ - halfWidth };
        break;
      case "west":
        origin = { x: centerX - template.footprint.width - 1, y: centerY, z: centerZ - halfWidth };
        break;
      case "south":
      default:
        origin = { x: centerX - halfWidth, y: centerY, z: centerZ + 2 };
        break;
    }

    return this.canBuildAt(template, origin) ? origin : null;
  }

  async buildStructure(template, options = {}) {
    if (!this.bot) {
      throw new Error("Bot is not connected.");
    }

    if (!template?.placements?.length) {
      throw new Error("Unknown structure template.");
    }

    const origin =
      normalizeBlockPosition(options.location) ||
      this.findDirectionalBuildSite(template, options.player || this.config.primaryPlayer) ||
      this.findFlatBuildSite(template, options.player || this.config.primaryPlayer, options.radius || 10);

    if (!origin) {
      return {
        status: "no_site",
        message: "I couldn't find a clear place nearby to build that."
      };
    }

    const requirements = Array.from(
      template.placements.reduce((counts, placement) => {
        counts.set(placement.block, (counts.get(placement.block) || 0) + 1);
        return counts;
      }, new Map())
    ).map(([item, count]) => ({ item, count }));

    const missing = this.getMissingMaterials(requirements);
    if (missing.length) {
      return {
        status: "needs_materials",
        origin,
        missing,
        message: `I need ${formatMaterialList(missing)} to build that.`
      };
    }

    let placed = 0;

    for (const placement of template.placements) {
      const target = {
        x: origin.x + placement.x,
        y: origin.y + placement.y,
        z: origin.z + placement.z
      };

      const result = await this.placeBlock(placement.block, target);

      if (result.status === "blocked" || result.status === "needs_materials") {
        return {
          status: result.status,
          origin,
          placed,
          message: result.message
        };
      }

      if (result.status === "placed" || result.status === "already_placed") {
        placed += 1;
      }
    }

    return {
      status: "completed",
      origin,
      placed,
      structure: template.name,
      message:
        template.name === "bridge"
          ? "Bridge is up."
          : "Shelter is ready."
    };
  }

  getSnapshot() {
    return captureWorldSnapshot(this.bot, { focusPlayer: this.config.primaryPlayer });
  }

  getWorldIdentitySignals() {
    return {
      serverAddress: `${this.config.host}:${this.config.port}`,
      spawnPoint: this.bot?.spawnPoint
        ? {
            x: Math.floor(this.bot.spawnPoint.x),
            y: Math.floor(this.bot.spawnPoint.y),
            z: Math.floor(this.bot.spawnPoint.z)
          }
        : null,
      dimension: this.bot?.game?.dimension || "unknown",
      serverBrand: this.bot?.game?.serverBrand || "unknown"
    };
  }

  async disconnect() {
    if (!this.bot) {
      return;
    }

    const bot = this.bot;
    this.stopPathing();
    this.bot = null;
    try {
      if (typeof bot.end === "function") {
        await Promise.resolve(bot.end("Guardian signing off"));
        return;
      }

      if (typeof bot.quit === "function") {
        await Promise.resolve(bot.quit("Guardian signing off"));
      }
    } catch (error) {
      this.logger.warn("[minecraft] Bot quit failed during disconnect:", error.message);
    }
  }
}

module.exports = {
  MinecraftBotAdapter
};
