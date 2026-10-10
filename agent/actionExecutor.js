const { compileStructure } = require("../builder/structureCompiler");
const { normalizeStyleName } = require("../builder/styleProfiles");
const { findBestLabelMatch } = require("./locationIntent");
const { anchorBelongsTo } = require("../memory/anchorStore");

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
    anchorStore = null,
    getWorldContext,
    isBuildMutationAllowed = () => false,
    getPresenceController = () => null,
    primaryPlayer = "Sage",
    companionName = "Guardian",
    allowAutoGiveBuildMaterials = false,
    debugBuildPlans = false,
    logger = console
  }) {
    this.botAdapter = botAdapter;
    this.jobStore = jobStore;
    this.anchorStore = anchorStore;
    this.getWorldContext = getWorldContext;
    this.isBuildMutationAllowed = isBuildMutationAllowed;
    this.getPresenceController = getPresenceController;
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

  // Where the player is standing right now, or null if not visible.
  // Distinct from resolveBuildHereLocation, which snaps down to the ground
  // beneath the player; a tag should record the spot at the player's own feet.
  resolvePlayerPosition() {
    const entity =
      typeof this.botAdapter.getPlayerEntity === "function"
        ? this.botAdapter.getPlayerEntity(this.primaryPlayer)
        : null;
    const position = entity?.position;

    if (!position) {
      return null;
    }

    return {
      x: Math.floor(position.x),
      y: Math.floor(position.y),
      z: Math.floor(position.z)
    };
  }

  // Turn a targetless build request into a concrete place to build.
  //
  // Uses the player's own position rather than the bot's, so a kid asking
  // "build me a house here" gets a house in front of HIM, not wherever the bot
  // happens to be wandering. Nudges one block forward so the structure does not
  // spawn inside the player, then drops to the first solid ground underneath so
  // it never tries to build in mid-air over water.
  resolveBuildHereLocation() {
    const playerEntity =
      typeof this.botAdapter.getPlayerEntity === "function"
        ? this.botAdapter.getPlayerEntity(this.primaryPlayer)
        : null;
    const entity = playerEntity || this.botAdapter.bot?.entity || null;

    const position = entity?.position;
    if (!position) {
      return null;
    }

    const x = Math.floor(position.x);
    const y = Math.floor(position.y);
    const z = Math.floor(position.z);

    return {
      x,
      y: Math.max(1, y - 1),
      z,
      source: "player_position"
    };
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
        this.getPresenceController()?.resume();
        execution.actionTarget = targetPlayer;
        break;
      }

      case "stop_following": {
        this.getPresenceController()?.hold();
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
        const location = normalizeCoordinates(
          composeAction.location || composeAction.target || composeAction.position || composeAction.coordinates
        );
        const hasBuildBounds = Boolean(
          composeAction.size || composeAction.bounds || composeAction.template || composeAction.structure
        );

        // "Build me a house" carries no coordinates, and that is not an error —
        // the player is standing somewhere. Resolve "here" to their live
        // position instead of throwing and losing the turn. Without this the
        // kid asks for a house and gets "I lost the thread for a moment."
        const resolvedLocation = location || this.resolveBuildHereLocation();

        if (!resolvedLocation) {
          throw new Error("compose_structure action requires a target location.");
        }

        if (!hasBuildBounds) {
          throw new Error("compose_structure action requires build bounds.");
        }

        const direction = composeAction.direction || this.botAdapter.getFacingDirection(this.primaryPlayer);
        const compiled = compileStructure({
          ...composeAction,
          direction
        });
        const worldContext = this.getWorldContext();

        if (!worldContext?.worldId || !worldContext?.sessionId) {
          throw new Error("Cannot create a build job before world context is ready.");
        }

        if (!this.isBuildMutationAllowed()) {
          throw new Error("compose_structure action requires build mutation permission.");
        }

        const job = await this.jobStore.createJob({
          worldId: worldContext.worldId,
          sessionId: worldContext.sessionId,
          threadId: worldContext.threadId,
          type: "build_structure",
          payload: {
            plan: compiled,
            requestedBy: composeAction.player || this.primaryPlayer,
            location: resolvedLocation,
            current_index: 0,
            allowAutoGiveBuildMaterials: this.allowAutoGiveBuildMaterials
          }
        });

        execution.actionTarget = resolvedLocation || null;
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

      // Save where the player is standing under a name they chose.
      case "tag_location": {
        if (!this.anchorStore) {
          throw new Error("Tagging a location requires anchor storage.");
        }

        const label = String(action.label || action.name || "").trim();
        if (!label) {
          throw new Error("tag_location requires a label.");
        }

        // The PLAYER's position, not the bot's. "Tag this spot" means where
        // the child is standing, and the bot is often a few blocks away.
        const position = this.resolvePlayerPosition();
        if (!position) {
          throw new Error("Cannot tag a location: the player is not visible.");
        }

        const worldContext = this.getWorldContext();
        if (!worldContext?.worldId) {
          throw new Error("Cannot tag a location before world context is ready.");
        }

        const now = new Date().toISOString();
        const anchor = await this.anchorStore.createAnchor({
          id: `anchor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          worldId: worldContext.worldId,
          label,
          type: "point",
          source: "player_tag",
          payload: {
            position,
            taggedBy: this.primaryPlayer,
            threadId: worldContext.threadId,
            dimension: this.botAdapter.bot?.game?.dimension || "overworld"
          },
          createdAt: now,
          updatedAt: now
        });

        execution.actionTarget = position;
        execution.anchor = { id: anchor?.id || null, label, position };
        if (!message) {
          message = sanitizeChat(`Tagged — I'll remember "${label}" right here.`);
        }
        break;
      }

      // Send the player to a previously tagged location.
      case "goto_location": {
        if (!this.anchorStore) {
          throw new Error("Recalling a location requires anchor storage.");
        }

        const query = String(action.label || action.query || "").trim();
        if (!query) {
          throw new Error("goto_location requires a label to look up.");
        }

        const worldContext = this.getWorldContext();
        if (!worldContext?.worldId) throw new Error("Cannot recall a location before world context is ready.");
        const anchors = ((await this.anchorStore.listAnchors(worldContext.worldId)) || [])
          .filter((anchor) => anchorBelongsTo(anchor, { ...worldContext, primaryPlayer: this.primaryPlayer }));
        const match = findBestLabelMatch(query, anchors);

        if (!match) {
          execution.anchor = { found: false, query };
          if (!message) {
            const known = anchors.map((a) => a.label).filter(Boolean).slice(0, 5);
            message = sanitizeChat(
              known.length
                ? `I don't know "${query}" yet. I know: ${known.join(", ")}.`
                : `I don't know "${query}" yet — tag it first and I'll remember it.`
            );
          }
          break;
        }

        const position = match.anchor.payload?.position;
        if (!position) {
          throw new Error(`"${match.anchor.label}" has no saved position.`);
        }

        const dimension = this.botAdapter.bot?.game?.dimension || "overworld";
        if (match.anchor.payload?.dimension && match.anchor.payload.dimension !== dimension) {
          throw new Error(`"${match.anchor.label}" is in another dimension. Return there before recalling it.`);
        }

        const result = await this.botAdapter.teleportPlayer(this.primaryPlayer, position);

        execution.actionTarget = position;
        execution.anchor = { found: true, label: match.anchor.label, score: match.score };
        execution.teleport = result;
        if (!message) {
          message = sanitizeChat(`${match.anchor.label} — bringing you back now.`);
        }
        break;
      }

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
