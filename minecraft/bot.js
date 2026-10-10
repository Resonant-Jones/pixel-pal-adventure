const { EventEmitter } = require("events");
const { setTimeout: wait } = require("node:timers/promises");

const minecraftData = require("minecraft-data");
const ping = require("minecraft-protocol/src/ping");
const mineflayer = require("mineflayer");
const { Vec3 } = require("vec3");
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");

const { captureWorldSnapshot } = require("./worldSnapshot");

const { GoalBlock, GoalFollow, GoalNear } = goals;

const { FLOODGATE_USERNAME_PREFIXES, playerNameCandidates, resolvePlayerEntity, matchesPlayerName } = require("./playerIdentity");

function normalizeMinecraftVersion(version) {
  if (version === undefined || version === null || version === "") {
    return undefined;
  }

  return String(version).trim();
}

function getMinecraftDataVersion(version) {
  const normalizedVersion = normalizeMinecraftVersion(version);

  if (!normalizedVersion) {
    return null;
  }

  try {
    const versionData = minecraftData(normalizedVersion);
    return versionData?.version?.minecraftVersion || null;
  } catch (error) {
    return null;
  }
}

function getVersionCandidates(serverVersionName, protocolVersion) {
  const candidates = [];
  const pushCandidate = (candidate) => {
    if (!candidate?.minecraftVersion) {
      return;
    }

    if (!candidates.some((entry) => entry.minecraftVersion === candidate.minecraftVersion)) {
      candidates.push(candidate);
    }
  };

  const versionsByProtocol =
    minecraftData.postNettyVersionsByProtocolVersion?.pc?.[protocolVersion] || [];

  for (const candidate of versionsByProtocol) {
    pushCandidate(candidate);
  }

  const guessedVersions = [serverVersionName]
    .concat(String(serverVersionName || "").match(/((\d+\.)+\d+)/g) || [])
    .map((version) => minecraftData.versionsByMinecraftVersion?.pc?.[version])
    .filter(Boolean)
    .sort((left, right) => right.version - left.version);

  for (const candidate of guessedVersions) {
    pushCandidate(candidate);
  }

  return candidates;
}

function resolveSupportedMinecraftVersion({
  configuredVersion,
  serverVersionName,
  protocolVersion
}) {
  const normalizedConfiguredVersion = normalizeMinecraftVersion(configuredVersion);

  if (normalizedConfiguredVersion) {
    const supportedConfiguredVersion = getMinecraftDataVersion(normalizedConfiguredVersion);

    if (!supportedConfiguredVersion) {
      const error = new Error(
        `Configured MC_VERSION "${normalizedConfiguredVersion}" is not supported by the installed minecraft-data package.`
      );
      error.code = "unsupported_minecraft_version";
      error.configuredVersion = normalizedConfiguredVersion;
      throw error;
    }

    return supportedConfiguredVersion;
  }

  const candidates = getVersionCandidates(serverVersionName, protocolVersion);

  for (const candidate of candidates) {
    const supportedVersion = getMinecraftDataVersion(candidate.minecraftVersion);

    if (supportedVersion) {
      return supportedVersion;
    }
  }

  const error = new Error(
    `Installed Prismarine data does not support Minecraft server version "${serverVersionName}" (protocol ${protocolVersion}).`
  );
  error.code = "unsupported_minecraft_version";
  error.serverVersionName = serverVersionName;
  error.protocolVersion = protocolVersion;
  error.candidates = candidates.map((candidate) => candidate.minecraftVersion);
  throw error;
}

function pingServer({ host, port }) {
  return new Promise((resolve, reject) => {
    ping({ host, port }, (error, response) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(response);
    });
  });
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeChat(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function createOperationTimeoutError(operationName, timeoutMs) {
  const error = new Error(`Operation ${operationName} timed out after ${timeoutMs}ms.`);
  error.code = "operation_timeout";
  error.operation = operationName;
  error.timeoutMs = timeoutMs;
  return error;
}

// ---------------------------------------------------------------------------
// Survival constants
// ---------------------------------------------------------------------------

// Mobs that will attack the companion or the child. Passive animals, villagers,
// and other players are deliberately absent — the companion must never pick a
// fight the child did not ask for.
const HOSTILE_MOBS = new Set([
  "zombie", "husk", "drowned", "skeleton", "stray", "bogged", "creeper",
  "spider", "cave_spider", "enderman", "witch", "slime", "magma_cube",
  "blaze", "ghast", "piglin", "piglin_brute", "hoglin", "zoglin",
  "wither_skeleton", "phantom", "pillager", "vindicator", "evoker",
  "ravager", "guardian", "elder_guardian", "shulker", "silverfish",
  "endermite", "vex", "warden", "breeze"
]);

// Exploders and ranged mobs you cannot trade hits with safely. Backing off is
// almost always better than swinging: a creeper detonating next to the child
// does far more damage than any sword stroke prevents.
const FLEE_ONLY_MOBS = new Set(["creeper", "ghast", "blaze", "witch", "ravager"]);

// Best-first. Only the first match in inventory is equipped.
const WEAPON_PRIORITY = [
  "netherite_sword", "diamond_sword", "iron_sword", "stone_sword", "wooden_sword",
  "netherite_axe", "diamond_axe", "iron_axe", "stone_axe", "wooden_axe"
];

const FOOD_PRIORITY = [
  "golden_apple", "cooked_beef", "cooked_porkchop", "cooked_mutton",
  "cooked_chicken", "cooked_rabbit", "cooked_salmon", "cooked_cod",
  "bread", "baked_potato", "apple", "carrot", "melon_slice",
  "sweet_berries", "dried_kelp"
];

// Armour, best tier first. The bot has no crafting plan and no supply chain, so
// this only ever equips what is already in its inventory — which is the point:
// it was previously fighting skeletons and creepers with nothing on but a sword.
//
// Skeletons were the single largest cause of death (22 of 52), and they shoot
// from well outside the 3.5-block melee range. Without armour the bot closes the
// distance while eating arrows, and loses the fight it should have been winning.
const ARMOR_PRIORITY = {
  head: ["netherite_helmet", "diamond_helmet", "iron_helmet", "golden_helmet", "leather_helmet", "chainmail_helmet", "turtle_helmet"],
  torso: ["netherite_chestplate", "diamond_chestplate", "iron_chestplate", "golden_chestplate", "leather_chestplate", "chainmail_chestplate"],
  legs: ["netherite_leggings", "diamond_leggings", "iron_leggings", "golden_leggings", "leather_leggings", "chainmail_leggings"],
  feet: ["netherite_boots", "diamond_boots", "iron_boots", "golden_boots", "leather_boots", "chainmail_boots"]
};

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
    const { entity } = resolvePlayerEntity(bot, target);

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
    this.botOperationQueue = Promise.resolve();
    this.activeBotOperation = null;
    this.survivalLease = null;
    this.survivalEpoch = 0;
  }

  assertTaskMovementAllowed(epoch = this.survivalEpoch, bot = this.bot) {
    if (bot !== this.bot) {
      const error = new Error("Task interrupted because its Minecraft connection ended.");
      error.code = "not_connected";
      throw error;
    }
    if (this.survivalLease || epoch !== this.survivalEpoch) {
      const error = new Error("Task interrupted for self-preservation.");
      error.code = "survival_interrupted";
      throw error;
    }
  }

  beginSurvival() {
    const lease = { bot: this.bot, epoch: ++this.survivalEpoch };
    this.survivalLease = lease;
    // Unlike pathfinder.stop(), setGoal(null) clears the goal immediately.
    // This also rejects an outstanding goto() so its build can checkpoint.
    try {
      lease.bot?.pathfinder?.setGoal(null);
      lease.bot?.stopDigging?.();
      this.releaseMovementControls(lease.bot);
    } catch (error) {
      this.endSurvival(lease);
      throw error;
    }
    return lease;
  }

  endSurvival(lease) {
    if (this.survivalLease !== lease) return;
    this.releaseMovementControls(lease.bot);
    this.survivalLease = null;
  }

  async #runWithTimeout(operationName, operation, timeoutMs) {
    const epoch = this.survivalEpoch;
    const bot = this.bot;
    this.assertTaskMovementAllowed(epoch, bot);
    let timeoutId = null;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        if (epoch === this.survivalEpoch && bot === this.bot) this.stopPathing();
        reject(createOperationTimeoutError(operationName, timeoutMs));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([Promise.resolve().then(() => {
        this.assertTaskMovementAllowed(epoch, bot);
        return operation();
      }), timeoutPromise]);
      this.assertTaskMovementAllowed(epoch, bot);
      return result;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  async #withBotOperation(operationName, operation, timeoutMs = 60000) {
    const run = async () => {
      const previousOperation = this.activeBotOperation;
      this.activeBotOperation = operationName;

      try {
        return await this.#runWithTimeout(operationName, operation, timeoutMs);
      } finally {
        this.activeBotOperation = previousOperation;
      }
    };

    const queued = this.botOperationQueue.then(run, run);
    this.botOperationQueue = queued.catch(() => {});
    return queued;
  }

  async connect() {
    if (this.bot) {
      return this.bot;
    }

    const serverInfo = await pingServer({
      host: this.config.host,
      port: this.config.port
    });
    const resolvedVersion = resolveSupportedMinecraftVersion({
      configuredVersion: this.config.version,
      serverVersionName: serverInfo?.version?.name,
      protocolVersion: serverInfo?.version?.protocol
    });

    this.logger.info(
      `[minecraft] Resolved ${this.config.host}:${this.config.port} version ${serverInfo?.version?.name || "unknown"} (protocol ${
        serverInfo?.version?.protocol ?? "unknown"
      }) to Mineflayer profile ${resolvedVersion}`
    );

    return new Promise((resolve, reject) => {
      let settled = false;
      const bot = mineflayer.createBot({
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        version: resolvedVersion,
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
        isPrimaryPlayer: matchesPlayerName(bot, this.config.primaryPlayer, username),
        directMention: new RegExp(`\\b${escapeRegex(this.config.username)}\\b`, "i").test(message)
      });
    });

    bot.on("entityMoved", (entity) => {
      if (matchesPlayerName(bot, this.config.primaryPlayer, entity?.username)) {
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
      if (this.bot && this.bot !== bot) return;
      this.logger.error("[minecraft] Bot error:", error);
      this.lastDisconnectReason = error?.message || String(error);
      this.emit("botError", error);

      if (!isSettled()) {
        markSettled();
        reject(error);
      }
    });

    bot.on("kicked", (reason) => {
      if (this.bot && this.bot !== bot) return;
      const message = typeof reason === "string" ? reason : JSON.stringify(reason);
      const error = new Error(`Minecraft connection was kicked: ${message}`);
      this.logger.error("[minecraft] Bot kicked:", message);
      this.lastDisconnectReason = message;
      this.emit("botError", error);

      if (!isSettled()) {
        markSettled();
        reject(error);
      }
    });

    bot.on("end", () => {
      if (this.bot && this.bot !== bot) return;
      this.bot = null;
      this.movements = null;

      // `end` fires immediately after every `kicked`, carrying no reason of its
      // own. Hand the last known reason along, otherwise the consumer sees a
      // bare "connection ended" and cannot tell a duplicate-login kick from an
      // ordinary disconnect — which is the difference between halting and
      // reconnecting into a fight.
      const lastReason = this.lastDisconnectReason || "Minecraft connection ended.";
      this.lastDisconnectReason = null;
      this.emit("end", lastReason);
      this.logger.warn("[minecraft] Connection ended:", lastReason);

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
    return resolvePlayerEntity(this.bot, username).entity;
  }

  // The name the server actually knows this player by. Server-side commands
  // such as `/tp` must use this, not the configured name, or they target a
  // player that does not exist.
  getServerPlayerName(username) {
    return resolvePlayerEntity(this.bot, username).name;
  }

  async followPlayer(username = this.config.primaryPlayer) {
    if (!this.bot) {
      throw new Error("Bot is not connected.");
    }

    const perform = async () => {
      const entity = this.getPlayerEntity(username);

      if (!entity) {
        throw new Error(`Player ${username} is not visible to the bot.`);
      }

      this.stopPathing();
      this.bot.pathfinder.setMovements(this.movements || new Movements(this.bot));
      this.bot.pathfinder.setGoal(new GoalFollow(entity, this.config.followDistance || 2), true);
    };

    if (this.activeBotOperation) {
      return this.#runWithTimeout("follow_player", perform, 5000);
    }

    return this.#withBotOperation("follow_player", perform, 5000);
  }

  async stopFollowing() {
    if (this.survivalLease) return;
    if (!this.bot) {
      throw new Error("Bot is not connected.");
    }

    const perform = async () => {
      // stop() waits for a path node. An explicit player stop must cancel the
      // dynamic goal now, even if the player moves before the next tick.
      this.bot.pathfinder.setGoal(null);
      this.releaseMovementControls();
    };

    if (this.activeBotOperation) {
      return this.#runWithTimeout(
        "stop_following",
        perform,
        5000
      );
    }

    return this.#withBotOperation(
      "stop_following",
      perform,
      5000
    );
  }

  async moveTo(position) {
    if (!this.bot) {
      throw new Error("Bot is not connected.");
    }

    const perform = async () => {
      const epoch = this.survivalEpoch;
      const bot = this.bot;
      this.assertTaskMovementAllowed(epoch, bot);
      const target = normalizeBlockPosition(position);

      if (!target) {
        throw new Error("Invalid move_to coordinates.");
      }

      this.bot.pathfinder.setMovements(this.movements || new Movements(this.bot));
      this.stopPathing();

      try {
        await this.bot.pathfinder.goto(new GoalBlock(target.x, target.y, target.z));
        return {
          status: "arrived",
          position: target
        };
      } catch (error) {
        this.assertTaskMovementAllowed(epoch, bot);
        this.stopPathing();
        return {
          status: "blocked",
          position: target,
          message: `I couldn't reach ${target.x}, ${target.y}, ${target.z} right now.`
        };
      }
    };

    if (this.activeBotOperation) {
      return this.#runWithTimeout("move_to", perform, 15000);
    }

    return this.#withBotOperation("move_to", perform, 15000);
  }

  async goNear(position, range = 3) {
    if (!this.bot) {
      throw new Error("Bot is not connected.");
    }

    const perform = async () => {
      const epoch = this.survivalEpoch;
      const bot = this.bot;
      this.assertTaskMovementAllowed(epoch, bot);
      const target = normalizeBlockPosition(position);
      if (!target) {
        throw new Error("Invalid coordinates.");
      }

      this.bot.pathfinder.setMovements(this.movements || new Movements(this.bot));
      this.stopPathing();

      try {
        await this.bot.pathfinder.goto(new GoalNear(target.x, target.y, target.z, range));
        return {
          status: "arrived",
          position: target
        };
      } catch (error) {
        this.assertTaskMovementAllowed(epoch, bot);
        this.stopPathing();
        return {
          status: "blocked",
          position: target,
          message: `I couldn't reach ${target.x}, ${target.y}, ${target.z} right now.`
        };
      }
    };

    if (this.activeBotOperation) {
      return this.#runWithTimeout("go_near", perform, 30000);
    }

    return this.#withBotOperation("go_near", perform, 30000);
  }

  async lookAt(target) {
    if (!this.bot) {
      throw new Error("Bot is not connected.");
    }

    const perform = async () => {
      const lookTarget = resolveLookTarget(this.bot, target);

      if (!lookTarget) {
        throw new Error("Unable to resolve a target for look_at.");
      }

      await this.bot.lookAt(lookTarget, true);
    };

    if (this.activeBotOperation) {
      return this.#runWithTimeout("look_at", perform, 10000);
    }

    return this.#withBotOperation("look_at", perform, 10000);
  }

  stopPathing() {
    if (this.survivalLease) return;
    if (typeof this.bot?.pathfinder?.stop === "function") {
      this.bot.pathfinder.stop();
      return;
    }

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

    const perform = async () => {
      const normalized = String(command || "").trim();
      if (!normalized.startsWith("/")) {
        throw new Error("Commands must start with '/'.");
      }

      this.bot.chat(normalized);
    };

    if (this.activeBotOperation) {
      return this.#runWithTimeout("run_command", perform, 10000);
    }

    return this.#withBotOperation("run_command", perform, 10000);
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

    const perform = async () => {
      const epoch = this.survivalEpoch;
      const bot = this.bot;
      this.assertTaskMovementAllowed(epoch, bot);
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

      this.stopPathing();
      let approach = null;
      try {
        approach = await this.goNear(target, 3);
      } catch (error) {
        this.assertTaskMovementAllowed(epoch, bot);
        approach = {
          status: "blocked",
          position: target,
          message: error.message || `I couldn't reach ${target.x}, ${target.y}, ${target.z} right now.`
        };
      }

      this.assertTaskMovementAllowed(epoch, bot);
      if (approach?.status === "blocked") {
        return approach;
      }

      try {
        await this.bot.dig(block);
      } catch (error) {
        this.assertTaskMovementAllowed(epoch, bot);
        return {
          status: "blocked",
          position: target,
          message: `I couldn't dig ${block.displayName || block.name} there.`
        };
      }

      return {
        status: "dug",
        position: target
      };
    };

    if (this.activeBotOperation) {
      return this.#runWithTimeout("dig_block", perform, 30000);
    }

    return this.#withBotOperation("dig_block", perform, 30000);
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
    const perform = async () => {
      const epoch = this.survivalEpoch;
      const bot = this.bot;
      this.assertTaskMovementAllowed(epoch, bot);
      const targetVec = toVec3(this.bot, position);
      const block = targetVec ? this.bot.blockAt(targetVec) : null;

      if (!block || isAirBlock(block)) {
        return true;
      }

      if (!isReplaceableBlock(block) || !block.diggable) {
        return false;
      }

      this.stopPathing();
      let approach = null;
      try {
        approach = await this.goNear(position, 3);
      } catch (error) {
        this.assertTaskMovementAllowed(epoch, bot);
        approach = {
          status: "blocked",
          message: error.message || "I couldn't reach that spot right now."
        };
      }

      this.assertTaskMovementAllowed(epoch, bot);
      if (approach?.status === "blocked") {
        return false;
      }

      try {
        await this.bot.dig(block);
      } catch (error) {
        this.assertTaskMovementAllowed(epoch, bot);
        return false;
      }

      return true;
    };

    if (this.activeBotOperation) {
      return this.#runWithTimeout("clear_block_for_placement", perform, 30000);
    }

    return this.#withBotOperation("clear_block_for_placement", perform, 30000);
  }

  async placeBlock(blockName, position) {
    if (!this.bot) {
      throw new Error("Bot is not connected.");
    }

    const perform = async () => {
      const epoch = this.survivalEpoch;
      const bot = this.bot;
      this.assertTaskMovementAllowed(epoch, bot);
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
        let cleared = false;
        try {
          cleared = await this.clearBlockForPlacement(target);
        } catch (error) {
        this.assertTaskMovementAllowed(epoch, bot);
          cleared = false;
        }

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

      this.stopPathing();
      let approach = null;
      try {
        approach = await this.goNear(target, 4);
      } catch (error) {
        this.assertTaskMovementAllowed(epoch, bot);
        approach = {
          status: "blocked",
          position: target,
          message: error.message || `I couldn't reach ${target.x}, ${target.y}, ${target.z} right now.`
        };
      }

      this.assertTaskMovementAllowed(epoch, bot);
      if (approach?.status === "blocked") {
        return approach;
      }

      try {
        await this.bot.equip(item, "hand");
      } catch (error) {
        this.assertTaskMovementAllowed(epoch, bot);
        return {
          status: "blocked",
          position: target,
          message: `I couldn't equip ${blockName} right now.`
        };
      }

      try {
        this.assertTaskMovementAllowed(epoch, bot);
        await this.bot.placeBlock(reference.block, reference.faceVector);
      } catch (error) {
        this.assertTaskMovementAllowed(epoch, bot);
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
    };

    if (this.activeBotOperation) {
      return this.#runWithTimeout("place_block", perform, 45000);
    }

    return this.#withBotOperation("place_block", perform, 45000);
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

    const perform = async () => {
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

      this.stopPathing();

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

        let result;
        try {
          result = await this.placeBlock(placement.block, target);
        } catch (error) {
          result = {
            status: "blocked",
            message: error.message || "I got stuck while placing a block.",
            position: target
          };
        }

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
    };

    const timeoutMs = Math.max(120000, (template?.placements?.length || 0) * 3000);

    if (this.activeBotOperation) {
      return this.#runWithTimeout("build_structure", perform, timeoutMs);
    }

    return this.#withBotOperation("build_structure", perform, timeoutMs);
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

  // -------------------------------------------------------------------------
  // Survival primitives
  //
  // These deliberately bypass #withBotOperation. That queue exists to stop two
  // *tasks* fighting over the bot, but a zombie does not wait in line behind a
  // build. Getting this wrong is what made the companion stand still and be
  // eaten: reaction has to preempt whatever it was doing.
  // -------------------------------------------------------------------------

  getVitals() {
    const bot = this.bot;
    if (!bot?.entity) {
      return null;
    }

    const pos = bot.entity.position;
    return {
      isAlive: bot.health !== 0,
      health: typeof bot.health === "number" ? bot.health : null,
      food: typeof bot.food === "number" ? bot.food : null,
      position: pos ? { x: pos.x, y: pos.y, z: pos.z } : null,
      gameMode: bot.game?.gameMode || null
    };
  }

  // Nearest hostile mob within range, or null. Ignores anything with a
  // different mob name than the known hostile set.
  findNearestHostile(range = 12, { fleeOnly = false } = {}) {
    const bot = this.bot;
    if (!bot?.entity?.position) {
      return null;
    }

    const origin = bot.entity.position;
    let best = null;
    let bestDistance = Infinity;

    for (const entity of Object.values(bot.entities || {})) {
      if (!entity || entity === bot.entity || !entity.position) {
        continue;
      }

      const name = String(entity.name || entity.displayName || "").toLowerCase().replace(/^minecraft:/, "");
      if (!HOSTILE_MOBS.has(name)) {
        continue;
      }
      if (fleeOnly && !["creeper", "ghast", "blaze", "witch", "ravager"].includes(name)) continue;

      const distance = origin.distanceTo(entity.position);
      if (distance <= range && distance < bestDistance) {
        best = { entity, name, distance };
        bestDistance = distance;
      }
    }

    return best;
  }

  findNearestEntityByName(names, range = 12) {
    const bot = this.bot;
    if (!bot?.entity?.position) {
      return null;
    }

    const wanted = new Set(names.map((n) => String(n).toLowerCase()));
    const origin = bot.entity.position;
    let best = null;
    let bestDistance = Infinity;

    for (const entity of Object.values(bot.entities || {})) {
      if (!entity || entity === bot.entity || !entity.position) {
        continue;
      }

      const name = String(entity.name || entity.displayName || "").toLowerCase().replace(/^minecraft:/, "");
      if (!wanted.has(name)) {
        continue;
      }

      const distance = origin.distanceTo(entity.position);
      if (distance <= range && distance < bestDistance) {
        best = { entity, name, distance };
        bestDistance = distance;
      }
    }

    return best;
  }

  findInventoryItemLowestDurability(names) {
    for (const name of names) {
      const item = this.findInventoryItem(name);
      if (item) {
        return item;
      }
    }

    return null;
  }

  async equipBestWeapon() {
    const item = this.findInventoryItemLowestDurability(WEAPON_PRIORITY);
    if (!item) {
      return null;
    }

    try {
      await this.bot.equip(item, "hand");
      return item.name;
    } catch (error) {
      this.logger.warn?.("[survival] equip weapon failed:", error?.message || error);
      return null;
    }
  }

  // Wear the best armour available, slot by slot. Each slot is independent: one
  // failure must not prevent the remaining three from being equipped.
  async equipBestArmor() {
    const bot = this.bot;

    if (!bot?.inventory) {
      return null;
    }

    const equipped = {};

    for (const [slot, names] of Object.entries(ARMOR_PRIORITY)) {
      try {
        const item = this.findInventoryItemLowestDurability(names);

        if (!item) {
          continue;
        }

        // Already wearing something better in this slot? Leave it alone.
        const worn = bot.inventory.slots[bot.inventory.getEquipmentDestSlot?.(slot) ?? -1];
        const wornName = worn?.name || null;

        if (wornName && names.includes(wornName)) {
          continue;
        }

        await bot.equip(item, slot);
        equipped[slot] = item.name;
      } catch (error) {
        this.logger.warn?.(
          `[survival] equip ${slot} failed:`,
          error?.message || error
        );
      }
    }

    const slots = Object.keys(equipped);

    return slots.length ? equipped : null;
  }

  async equipBestFood() {
    const item = this.findInventoryItemLowestDurability(FOOD_PRIORITY);
    if (!item) {
      return null;
    }

    try {
      await this.bot.equip(item, "hand");
      return item.name;
    } catch (error) {
      this.logger.warn?.("[survival] equip food failed:", error?.message || error);
      return null;
    }
  }

  // Swing at a specific entity until it dies, leaves range, or we run out of
  // time. Returns a small report so the caller does not have to guess.
  async attackEntity(entity, { maxDurationMs = 6000, range = 3.5, signal } = {}) {
    const bot = this.bot;
    if (!bot?.entity || !entity) {
      return { attacked: false, killed: false, reason: "not_connected" };
    }
    let swings = 0;
    const interrupted = () => signal?.aborted || this.bot !== bot || bot.health === 0;
    const cancelled = () => ({ attacked: swings > 0, killed: false, swings, interrupted: true, reason: "interrupted" });
    try {
      if (interrupted()) return cancelled();
      await this.equipBestWeapon();
      const deadline = Date.now() + maxDurationMs;
      while (Date.now() < deadline) {
        if (interrupted()) return cancelled();
        const target = bot.entities?.[entity.id];
        if (!target || !target.isValid) {
          return { attacked: swings > 0, killed: false, swings, reason: "target_gone" };
        }
        const distance = bot.entity.position.distanceTo(target.position);
        if (distance > 24) {
          return { attacked: swings > 0, killed: false, swings, reason: "target_escaped" };
        }
        await bot.lookAt(target.position.offset(0, target.height ? target.height * 0.8 : 1, 0), true);
        if (interrupted()) return cancelled();
        if (distance > range) {
          bot.setControlState("forward", true);
          await wait(120, undefined, { signal });
          bot.setControlState("forward", false);
        } else {
          bot.attack(target);
          swings += 1;
          await wait(625, undefined, { signal });
        }
      }
      return { attacked: swings > 0, killed: false, swings, reason: "timeout" };
    } catch (error) {
      return interrupted() ? cancelled() : { attacked: swings > 0, killed: false, swings, reason: error.message };
    } finally {
      this.releaseMovementControls(bot);
    }
  }

  // Sprint directly away from a threat. Cheaper and more reliable than pathing
  // when the only goal is "not here".
  async fleeFrom(position, { durationMs = 2500, signal } = {}) {
    const bot = this.bot;
    if (!bot?.entity?.position || !position) {
      return { fled: false, reason: "not_connected" };
    }
    const interrupted = () => signal?.aborted || this.bot !== bot || bot.health === 0;
    const origin = bot.entity.position;
    try {
      if (interrupted()) return { fled: false, interrupted: true };
      const away = new Vec3(origin.x + (origin.x - position.x), origin.y + 1, origin.z + (origin.z - position.z));
      await bot.lookAt(away, true);
      if (interrupted()) return { fled: false, interrupted: true };
      bot.setControlState("sprint", true);
      bot.setControlState("forward", true);
      const deadline = Date.now() + durationMs;
      while (Date.now() < deadline && !interrupted()) {
        bot.setControlState("jump", true);
        await wait(200, undefined, { signal });
        if (interrupted()) break;
        bot.setControlState("jump", false);
        await wait(200, undefined, { signal });
      }
      return { fled: !interrupted(), interrupted: Boolean(interrupted()) };
    } catch (error) {
      return { fled: false, interrupted: Boolean(interrupted()), reason: error?.message || String(error) };
    } finally {
      this.releaseMovementControls(bot);
    }
  }

  // Eat whatever is edible. Vanilla only lets you eat below a food threshold,
  // so a failure here usually just means "not hungry enough".
  async consumeFood({ signal } = {}) {
    const bot = this.bot;
    if (!bot?.entity) return { ate: false, reason: "not_connected" };
    const interrupted = () => signal?.aborted || this.bot !== bot || bot.health === 0;
    if (interrupted()) return { ate: false, interrupted: true };
    const item = await this.equipBestFood();
    if (!item) return { ate: false, reason: "no_food" };
    if (interrupted()) return { ate: false, interrupted: true };
    let onAbort;
    try {
      const cancelled = new Promise((resolve) => {
        onAbort = () => {
          try { bot.deactivateItem?.(); } catch (_) { /* disconnected */ }
          resolve({ ate: false, interrupted: true });
        };
        signal?.addEventListener("abort", onAbort, { once: true });
      });
      return await Promise.race([
        Promise.resolve(bot.consume()).then(() => ({ ate: true, item })),
        cancelled
      ]);
    } catch (error) {
      return { ate: false, reason: error?.message || String(error), item };
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  // Teleport a player to a saved location.
  //
  // Requires the bot to be opped (it is, level 4). The coordinates are placed
  // mid-block (+0.5) so the player lands on top of the block rather than
  // inside it, which is the difference between arriving and suffocating.
  async teleportPlayer(username, position) {
    if (!this.bot) {
      throw new Error("Bot is not connected.");
    }

    const target = username || this.config.primaryPlayer;
    const x = Number(position?.x);
    const y = Number(position?.y);
    const z = Number(position?.z);

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new Error("Teleport requires finite x, y, and z coordinates.");
    }

    // `/tp` is resolved by the server, not by us, so it needs the name the
    // server actually has on file (Floodgate may have prefixed it). When the
    // player is offline there is nothing to resolve against, so fall back to
    // the configured name rather than sending a literal "null".
    const serverName = this.getServerPlayerName(target) || target;
    const command = `/tp ${serverName} ${x + 0.5} ${y} ${z + 0.5}`;
    await this.runCommand(command);

    return { teleported: true, player: serverName, command, position: { x, y, z } };
  }

  // Emergency brake. Used when a survival reaction has to take the controls
  // away from whatever task currently holds them.
  releaseMovementControls(bot = this.bot) {
    if (!bot) {
      return;
    }

    for (const control of ["forward", "back", "left", "right", "jump", "sprint", "sneak"]) {
      try {
        bot.setControlState(control, false);
      } catch (_error) {
        // A disconnected bot throws on control writes; nothing to do.
      }
    }
  }
}

module.exports = {
  MinecraftBotAdapter,
  resolveSupportedMinecraftVersion,
  playerNameCandidates,
  resolvePlayerEntity,
  FLOODGATE_USERNAME_PREFIXES
};
