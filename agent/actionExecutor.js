const { compileStructure } = require("../builder/structureCompiler");
const { normalizeStyleName } = require("../builder/styleProfiles");

function sanitizeChat(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function shouldSuppressChatMessage(text) {
  const normalized = String(text || "").trim();

  if (!normalized) {
    return false;
  }

  if (normalized.startsWith("{") || normalized.startsWith("```")) {
    return true;
  }

  return /"message"\s*:|"action"\s*:|"type"\s*:\s*"[^"]+"/i.test(normalized);
}

function normalizeAction(action, primaryPlayer) {
  const normalized = action && typeof action === "object" ? { ...action } : { type: action };
  const type = String(normalized.type || "none").toLowerCase();

  if (type === "follow") {
    normalized.type = "follow_player";
  } else {
    normalized.type = type;
  }

  if (!normalized.player && !normalized.targetPlayer && normalized.type === "follow_player") {
    normalized.player = primaryPlayer;
  }

  return normalized;
}

function normalizeCoordinates(target) {
  if (!target) {
    return null;
  }

  if (Array.isArray(target) && target.length >= 3) {
    return {
      x: Math.floor(Number(target[0])),
      y: Math.floor(Number(target[1])),
      z: Math.floor(Number(target[2]))
    };
  }

  if (typeof target === "string") {
    const pieces = target
      .split(",")
      .map((piece) => piece.trim())
      .filter(Boolean);

    if (pieces.length >= 3) {
      return normalizeCoordinates(pieces);
    }

    return null;
  }

  if (typeof target === "object") {
    const { x, y, z } = target;

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

class ActionExecutor {
  constructor({
    botAdapter,
    jobStore,
    getWorldContext,
    primaryPlayer = "Sage",
    companionName = "Guardian",
    allowAutoGiveBuildMaterials = false,
    debugBuildPlans = false,
    logger = console
  }) {
    this.botAdapter = botAdapter;
    this.jobStore = jobStore;
    this.getWorldContext = getWorldContext;
    this.primaryPlayer = primaryPlayer;
    this.companionName = companionName;
    this.allowAutoGiveBuildMaterials = allowAutoGiveBuildMaterials;
    this.debugBuildPlans = debugBuildPlans;
    this.logger = logger;
  }

  createComposeAction(action) {
    if (action.type === "compose_structure") {
      return action;
    }

    if (action.type === "build_structure") {
      return {
        ...action,
        type: "compose_structure",
        style: normalizeStyleName(action.structure || action.template || "cabin")
      };
    }

    return null;
  }

  async execute(response) {
    const action = normalizeAction(response.action, this.primaryPlayer);
    const rawMessage = sanitizeChat(response.message);
    let message = shouldSuppressChatMessage(rawMessage) ? "" : rawMessage;
    const execution = {
      actionType: action.type,
      actionTarget: null,
      messageSent: false,
      messageSuppressed: shouldSuppressChatMessage(rawMessage)
    };

    switch (action.type) {
      case "follow_player": {
        const targetPlayer = action.player || action.targetPlayer || this.primaryPlayer;
        await this.botAdapter.followPlayer(targetPlayer);
        execution.actionTarget = targetPlayer;
        break;
      }

      case "stop_following": {
        await this.botAdapter.stopFollowing();
        execution.actionTarget = action.player || this.primaryPlayer;
        break;
      }

      case "move_to": {
        const coordinates = normalizeCoordinates(action.target || action.position || action.coordinates);
        if (!coordinates) {
          throw new Error("move_to action requires x, y, and z coordinates.");
        }

        const result = await this.botAdapter.moveTo(coordinates);
        execution.actionTarget = coordinates;
        execution.move = result;
        if (result?.message) {
          message = sanitizeChat(result.message);
        }
        break;
      }

      case "look_at": {
        const target = action.player || action.targetPlayer || action.target || action.position || this.primaryPlayer;
        await this.botAdapter.lookAt(target);
        execution.actionTarget = target;
        break;
      }

      case "dig_block": {
        const coordinates = normalizeCoordinates(action.target || action.position || action.coordinates);
        if (!coordinates) {
          throw new Error("dig_block action requires x, y, and z coordinates.");
        }

        const result = await this.botAdapter.digBlock(coordinates);
        execution.actionTarget = coordinates;
        execution.dig = result;
        if (result.message) {
          message = sanitizeChat(result.message);
        }
        break;
      }

      case "place_block": {
        const coordinates = normalizeCoordinates(action.target || action.position || action.coordinates);
        const blockName = String(action.block || action.item || "").trim();
        if (!coordinates || !blockName) {
          throw new Error("place_block action requires coordinates and a block name.");
        }

        const result = await this.botAdapter.placeBlock(blockName, coordinates);
        execution.actionTarget = coordinates;
        execution.place = result;
        if (result.message) {
          message = sanitizeChat(result.message);
        }
        break;
      }

      case "inventory_status": {
        const result = this.botAdapter.getInventorySummary();
        execution.inventory = result.items;
        if (!message) {
          message = sanitizeChat(result.summary);
        }
        break;
      }

      case "compose_structure":
      case "build_structure": {
        if (!this.jobStore || typeof this.getWorldContext !== "function") {
          throw new Error("Build composition requires job storage and world context.");
        }

        const composeAction = this.createComposeAction(action);
        const direction = composeAction.direction || this.botAdapter.getFacingDirection(this.primaryPlayer);
        const compiled = compileStructure({
          ...composeAction,
          direction
        });
        const location = normalizeCoordinates(
          composeAction.location || composeAction.target || composeAction.position || composeAction.coordinates
        );
        const worldContext = this.getWorldContext();

        if (!worldContext?.worldId || !worldContext?.sessionId) {
          throw new Error("Cannot create a build job before world context is ready.");
        }

        const job = await this.jobStore.createJob({
          worldId: worldContext.worldId,
          sessionId: worldContext.sessionId,
          threadId: worldContext.threadId,
          type: "build_structure",
          payload: {
            plan: compiled,
            requestedBy: composeAction.player || this.primaryPlayer,
            location,
            current_index: 0,
            allowAutoGiveBuildMaterials: this.allowAutoGiveBuildMaterials
          }
        });

        execution.actionTarget = location || null;
        execution.build = {
          jobId: String(job.id),
          style: compiled.style,
          palette: compiled.paletteName,
          size: compiled.size,
          summary: compiled.summary,
          materials: compiled.materials,
          footprint: compiled.footprint
        };

        if (this.debugBuildPlans) {
          this.logger.info("[build] Job created", execution.build);
        }

        if (!message) {
          message = sanitizeChat(`I'll build a ${compiled.summary}.`);
        }
        break;
      }

      case "chat":
      case "none":
        break;

      default:
        execution.actionType = "none";
        break;
    }

    if (message) {
      await this.botAdapter.say(message);
      execution.messageSent = true;
    }

    return execution;
  }
}

module.exports = {
  ActionExecutor
};
