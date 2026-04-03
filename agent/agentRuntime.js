const { buildContext, buildAdventureSummaryContext } = require("./contextBuilder");
const { CommandService } = require("./commandService");
const { parseBuildRequest } = require("../builder/requestParser");
const { ReflexClassifier } = require("../reflex/reflexClassifier");
const { ReflexWorker } = require("../reflex/reflexWorker");
const { createRuntimeState, createTaskState, updateRuntimeState } = require("./runtimeState");
const { resolveWorldIdentity } = require("../reflex/worldIdentity");
const { StateProjector } = require("./stateProjector");
const { BuildWorker } = require("../builder/buildWorker");
const { FeedbackBroker } = require("../middleware/feedbackBroker");
const { analyzeIntent } = require("./intentCoach");
const { routeBuildLane } = require("./buildLaneRouter");
const { RetryCoordinator } = require("./retryCoordinator");
const { buildIdentityPromptProfile, resolveIdentityPreset } = require("./identityPresets");
const { buildNormalizedFailureSignature, classifyConnectionError } = require("./retrySignatures");
const { formatAnchorSummary } = require("../memory/anchorStore");
const {
  RETRY_DOMAINS,
  RETRY_TERMINAL_OUTCOMES,
  createNormalizedFailureSignature,
  createRetryAttemptEnvelope,
  createRetryOutcomeEnvelope
} = require("../structures/retrySchemas");

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeCommandText(text, companionName) {
  const collapsed = String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/g, "");

  if (!collapsed) {
    return "";
  }

  return collapsed.replace(new RegExp(`^${escapeRegex(companionName.toLowerCase())}[,:\\s-]*`), "").trim();
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

class AgentRuntime {
  constructor({
    botAdapter,
    messageStore,
    eventStore,
    worldStore,
    sessionStore,
    jobStore,
    reflexStateStore,
    companionIdentityStore = null,
    anchorStore = null,
    profileStore = null,
    learningStore,
    llmClient,
    actionExecutor,
    surrealClient,
    threadId,
    llmProvider = "minimax",
    retryConfig = {},
    reconnectConfig = {},
    primaryPlayer = "Sage",
    companionName = "Guardian",
    companionRole = "AI companion for Sage",
    companionPersonality = "Warm, observant, concise, and practical.",
    memoryWindow = 12,
    eventWindow = 6,
    summaryInterval = 24,
    summaryWindow = 24,
    summaryContextLimit = 3,
    maxPendingTurns = 4,
    respondToAllPlayers = false,
    reflexObservationIntervalMs = 5000,
    reflexWorkerIntervalMs = 1000,
    buildWorkerIntervalMs = 1000,
    reflexGlobalCooldownMs = 60000,
    reflexTriggerCooldownMs = 180000,
    reflexIdleThresholdMs = 90000,
    allowAutoGiveBuildMaterials = false,
    debugBuildPlans = false,
    logger = console
  }) {
    this.botAdapter = botAdapter;
    this.messageStore = messageStore;
    this.eventStore = eventStore;
    this.worldStore = worldStore;
    this.sessionStore = sessionStore;
    this.jobStore = jobStore;
    this.reflexStateStore = reflexStateStore;
    this.companionIdentityStore = companionIdentityStore;
    this.anchorStore = anchorStore;
    this.profileStore = profileStore;
    this.learningStore = learningStore || null;
    this.llmClient = llmClient;
    this.actionExecutor = actionExecutor;
    this.surrealClient = surrealClient;
    this.threadId = threadId;
    this.llmProvider = llmProvider;
    this.retryCoordinator = new RetryCoordinator({ ...retryConfig, logger });
    this.primaryPlayer = primaryPlayer;
    this.companionName = companionName;
    this.companionRole = companionRole;
    this.companionPersonality = companionPersonality;
    this.memoryWindow = memoryWindow;
    this.eventWindow = eventWindow;
    this.summaryInterval = summaryInterval;
    this.summaryWindow = summaryWindow;
    this.summaryContextLimit = summaryContextLimit;
    this.maxPendingTurns = maxPendingTurns;
    this.respondToAllPlayers = respondToAllPlayers;
    this.reflexObservationIntervalMs = reflexObservationIntervalMs;
    this.reflexWorkerIntervalMs = reflexWorkerIntervalMs;
    this.buildWorkerIntervalMs = buildWorkerIntervalMs;
    this.reflexGlobalCooldownMs = reflexGlobalCooldownMs;
    this.reflexTriggerCooldownMs = reflexTriggerCooldownMs;
    this.reflexIdleThresholdMs = reflexIdleThresholdMs;
    this.allowAutoGiveBuildMaterials = allowAutoGiveBuildMaterials;
    this.debugBuildPlans = debugBuildPlans;
    this.logger = logger;
    this.feedbackBroker = new FeedbackBroker({ logger });
    this.bound = false;
    this.readyForTurns = false;
    this.observedChatCount = 0;
    this.lastSummaryObservedChatCount = 0;
    this.pendingTurns = 0;
    this.summaryInFlight = null;
    this.turnQueue = Promise.resolve();
    this.currentWorld = null;
    this.currentSession = null;
    this.isNewWorld = false;
    this.reflexObservationTimer = null;
    this.reflexWorkerTimer = null;
    this.buildWorkerTimer = null;
    this.reflexScanInFlight = null;
    this.turnCounter = 0;
    this.latestTurnId = null;
    this.activeTurnId = null;
    this.shuttingDown = false;
    this.runtimeUnavailable = false;
    this.connectionInterrupted = false;
    this.reconnectInFlight = null;
    this.reconnectGate = null;
    this.reconnectResolver = null;
    this.reconnectMaxAttempts = reconnectConfig.maxAttempts || 5;
    this.reconnectBaseDelayMs = reconnectConfig.baseDelayMs || 1000;
    this.reconnectMaxDelayMs = reconnectConfig.maxDelayMs || 15000;
    this.reconnectJitter = reconnectConfig.jitter ?? 0.25;
    this.turnTaskIds = new Map();
    this.runtimeState = createRuntimeState({
      threadId: this.threadId,
      primaryPlayer: this.primaryPlayer,
      llmProvider: this.llmProvider,
      companionName: this.companionName,
      minecraft: this.botAdapter.config,
      controlPlane: {
        host: process.env.GUARDIAN_CONTROL_HOST || "127.0.0.1",
        port: Number(process.env.GUARDIAN_CONTROL_PORT || 8787),
        authTokenLoaded: Boolean(process.env.GUARDIAN_CONTROL_TOKEN)
      }
    });
    this.runtimeState = updateRuntimeState(this.runtimeState, {
      liveConfig: {
        followDistance: Number(this.botAdapter.config.followDistance || 2),
        safetyConstraints: {
          ...this.runtimeState.liveConfig.safetyConstraints,
          allowAutoGiveBuildMaterials: Boolean(this.allowAutoGiveBuildMaterials)
        },
        activeIdentityPreset: "friendly_builder"
      },
      staticConfig: {
        ...this.runtimeState.staticConfig,
        startupOnly: {
          providerBootstrapConfigured: Boolean(this.llmProvider),
          surrealConfigured: Boolean(this.surrealClient)
        }
      }
    });
    this.commandService = new CommandService({
      logger: this.logger
    });
    this.stateProjector = new StateProjector({
      getState: () => this.runtimeState,
      getLastSequence: () => this.runtimeState.lastSequence
    });

    this.reflexClassifier = new ReflexClassifier({
      botAdapter: this.botAdapter,
      eventStore: this.eventStore,
      threadId: this.threadId,
      primaryPlayer: this.primaryPlayer,
      companionName: this.companionName,
      getWorldContext: () => this.getWorldContext(),
      idleThresholdMs: this.reflexIdleThresholdMs,
      logger: this.logger
    });

    this.reflexWorker = new ReflexWorker({
      botAdapter: this.botAdapter,
      eventStore: this.eventStore,
      jobStore: this.jobStore,
      reflexStateStore: this.reflexStateStore,
      threadId: this.threadId,
      companionName: this.companionName,
      getWorldContext: () => this.getWorldContext(),
      globalCooldownMs: this.reflexGlobalCooldownMs,
      perTriggerCooldownMs: this.reflexTriggerCooldownMs,
      getReflexPolicy: () => ({
        enabled: Boolean(this.runtimeState.liveConfig.narrativeReflexEnabled),
        highSalienceOnly: Boolean(this.runtimeState.liveConfig.highSalienceOnly)
      }),
      logger: this.logger
    });

    this.buildWorker = new BuildWorker({
      botAdapter: this.botAdapter,
      jobStore: this.jobStore,
      eventStore: this.eventStore,
      threadId: this.threadId,
      primaryPlayer: this.primaryPlayer,
      companionName: this.companionName,
      getWorldContext: () => ({
        ...this.getWorldContext(),
        threadId: this.threadId
      }),
      allowAutoGiveBuildMaterials: this.allowAutoGiveBuildMaterials,
      debugBuildPlans: this.debugBuildPlans,
      logger: this.logger
    });

    this.registerCommandHandlers();
  }

  registerCommandHandlers() {
    this.commandService
      .register("pause", async (command) => {
        this.readyForTurns = false;
        this.setRuntimeState({
          lifecycle: "paused"
        });
        return {
          command,
          outcome: "succeeded"
        };
      })
      .register("resume", async (command) => {
        this.readyForTurns = true;
        this.setRuntimeState({
          lifecycle: this.runtimeUnavailable ? "reconnecting" : "ready"
        });
        return {
          command,
          outcome: "succeeded"
        };
      })
      .register("reconnect", async (command) => {
        void this.handleConnectionLoss(command.reason || "manual_reconnect", new Error("Manual reconnect requested."));
        return {
          command,
          outcome: "succeeded",
          deferred: true
        };
      })
      .register("what_worked", async (command) => {
        const summary = await this.queryWhatWorked({
          source: "runtime"
        });
        return {
          command,
          outcome: "succeeded",
          summary
        };
      })
      .register("create_anchor_from_player_position", async (command) => {
        const created = await this.createAnchorFromRuntime(command);
        return {
          command,
          outcome: "succeeded",
          ...created
        };
      })
      .register("create_anchor_from_look_direction", async (command) => {
        const created = await this.createAnchorFromRuntime(command);
        return {
          command,
          outcome: "succeeded",
          ...created
        };
      })
      .register("create_anchor_from_marker_block", async (command) => {
        const created = await this.createAnchorFromRuntime(command);
        return {
          command,
          outcome: "succeeded",
          ...created
        };
      })
      .register("create_area_anchor_from_corners", async (command) => {
        const created = await this.createAnchorFromRuntime(command);
        return {
          command,
          outcome: "succeeded",
          ...created
        };
      })
      .register("run_task", async (command) => {
        const turnId = this.createTurnId();
        this.latestTurnId = turnId;
        const task = this.queueTurnTask({
          turnId,
          label: command.taskText,
          commandId: command.commandId,
          anchorId: command.anchorId || null
        });

        this.turnQueue = this.turnQueue
          .then(() =>
            this.processTurn(
              {
                username: command.requestedBy || this.primaryPlayer,
                message: command.taskText,
                directMention: true
              },
              turnId,
              {
                commandId: command.commandId,
                anchorId: command.anchorId || null,
                requestedBy: command.requestedBy || this.primaryPlayer
              }
            )
          )
          .catch((error) =>
            this.handleTurnError(error, {
              username: command.requestedBy || this.primaryPlayer,
              message: command.taskText
            })
          );

        return {
          command,
          outcome: "succeeded",
          task
        };
      });
  }

  setRuntimeState(patch = {}, options = {}) {
    this.runtimeState = updateRuntimeState(this.runtimeState, patch);
    if (!options.silent) {
      this.emitRuntimeEvent("runtime_state_changed", {
        state: this.stateProjector.projectRuntimeState()
      });
    }
    return this.runtimeState;
  }

  getRuntimeState() {
    return this.stateProjector.projectRuntimeState();
  }

  getRuntimeSnapshot() {
    return this.stateProjector.projectSnapshot();
  }

  bumpRuntimeSequence() {
    this.runtimeState = updateRuntimeState(this.runtimeState, {
      lastSequence: Number(this.runtimeState.lastSequence || 0) + 1
    });

    return this.runtimeState.lastSequence;
  }

  queueTurnTask({ turnId, label, commandId = null, anchorId = null }) {
    const task = createTaskState({
      label,
      commandId,
      turnId,
      anchorId,
      status: "queued"
    });

    this.turnTaskIds.set(turnId, task.taskId);
    this.setRuntimeState({
      queuedTasks: [...this.runtimeState.queuedTasks, task]
    });

    return task;
  }

  startTurnTask(turnId) {
    const taskId = this.turnTaskIds.get(turnId);
    const queuedTasks = [];
    let activeTask = null;

    for (const task of this.runtimeState.queuedTasks) {
      if (task.taskId === taskId) {
        activeTask = {
          ...task,
          status: "running",
          updatedAt: new Date().toISOString()
        };
      } else {
        queuedTasks.push(task);
      }
    }

    if (!activeTask) {
      return null;
    }

    this.setRuntimeState({
      activeTask,
      queuedTasks
    });
    this.emitRuntimeEvent("task_started", {
      taskId: activeTask.taskId,
      label: activeTask.label,
      commandId: activeTask.commandId || undefined
    }, {
      turnId
    });

    return activeTask;
  }

  completeTurnTask(turnId, interrupted = false) {
    const taskId = this.turnTaskIds.get(turnId);
    const activeTask =
      this.runtimeState.activeTask && this.runtimeState.activeTask.taskId === taskId
        ? this.runtimeState.activeTask
        : null;

    if (interrupted && activeTask) {
      this.setRuntimeState({
        activeTask: null,
        interruptedTasks: [
          ...this.runtimeState.interruptedTasks,
          {
            ...activeTask,
            status: "interrupted",
            updatedAt: new Date().toISOString()
          }
        ]
      });
      this.emitRuntimeEvent("task_failed", {
        taskId: activeTask.taskId,
        outcome: "interrupted",
        summary: "Task interrupted by connection loss."
      }, {
        turnId
      });
    } else if (activeTask) {
      this.setRuntimeState({
        activeTask: null
      });
      this.emitRuntimeEvent("task_completed", {
        taskId: activeTask.taskId,
        outcome: "succeeded",
        summary: activeTask.label
      }, {
        turnId
      });
    }

    this.turnTaskIds.delete(turnId);
  }

  attachRuntimeEventBus(eventBus) {
    this.runtimeEventBus = eventBus;
  }

  emitRuntimeEvent(type, payload, options = {}) {
    if (!this.runtimeEventBus) {
      return null;
    }

    const envelope = this.runtimeEventBus.emitEvent(type, payload, options);
    this.runtimeState.lastSequence = envelope.sequence;
    this.runtimeState.updatedAt = new Date().toISOString();
    return envelope;
  }

  getConfigSnapshot() {
    return {
      staticConfig: this.runtimeState.staticConfig,
      liveConfig: this.runtimeState.liveConfig,
      identity: this.runtimeState.identity,
      revisions: this.runtimeState.revisions
    };
  }

  async loadActiveIdentity() {
    if (!this.companionIdentityStore) {
      return this.runtimeState.identity;
    }

    const storedIdentity = await this.companionIdentityStore.getActiveIdentity();
    if (!storedIdentity) {
      await this.companionIdentityStore.upsertActiveIdentity(this.runtimeState.identity);
      return this.runtimeState.identity;
    }

    this.setRuntimeState({
      identity: storedIdentity,
      liveConfig: {
        ...this.runtimeState.liveConfig,
        activeIdentityPreset: storedIdentity.personalityPreset
      },
      revisions: {
        ...this.runtimeState.revisions,
        identityRevision: storedIdentity.identityRevision
      }
    });

    return this.runtimeState.identity;
  }

  async ensureDefaultProfiles() {
    if (!this.profileStore) {
      return;
    }

    const profiles = [
      {
        profileId: "builder",
        name: "Builder",
        identity: {
          ...this.runtimeState.identity,
          personalityPreset: "friendly_builder"
        },
        liveConfig: {
          ...this.runtimeState.liveConfig,
          behaviorMode: "balanced",
          autonomyLevel: "balanced"
        }
      },
      {
        profileId: "explorer",
        name: "Explorer",
        identity: {
          ...this.runtimeState.identity,
          personalityPreset: "brave_explorer"
        },
        liveConfig: {
          ...this.runtimeState.liveConfig,
          behaviorMode: "creative",
          autonomyLevel: "independent"
        }
      },
      {
        profileId: "helper",
        name: "Helper",
        identity: {
          ...this.runtimeState.identity,
          personalityPreset: "calm_teacher"
        },
        liveConfig: {
          ...this.runtimeState.liveConfig,
          behaviorMode: "balanced",
          autonomyLevel: "guided"
        }
      },
      {
        profileId: "careful",
        name: "Careful",
        identity: {
          ...this.runtimeState.identity,
          personalityPreset: "quiet_genius"
        },
        liveConfig: {
          ...this.runtimeState.liveConfig,
          behaviorMode: "careful",
          autonomyLevel: "guided"
        }
      }
    ];

    for (const profile of profiles) {
      const existing = await this.profileStore.getProfile(profile.profileId);
      if (!existing) {
        await this.profileStore.saveProfile(profile);
      }
    }
  }

  getIdentityPromptProfile() {
    return buildIdentityPromptProfile(this.runtimeState.identity);
  }

  async applyConfigPatch(patch = {}) {
    const applied = {};
    const rejected = [];
    const requiresRestart = [];
    const nextLiveConfig = {
      ...this.runtimeState.liveConfig
    };
    let nextIdentity = {
      ...this.runtimeState.identity
    };
    let configRevision = this.runtimeState.revisions.configRevision;
    let identityRevision = this.runtimeState.revisions.identityRevision;
    let profileRevision = this.runtimeState.revisions.profileRevision;

    if (patch.profileId && this.profileStore) {
      const profile = await this.profileStore.getProfile(patch.profileId);
      if (profile) {
        nextLiveConfig.autonomyLevel = profile.live_config?.autonomyLevel || nextLiveConfig.autonomyLevel;
        nextLiveConfig.behaviorMode = profile.live_config?.behaviorMode || nextLiveConfig.behaviorMode;
        nextLiveConfig.verbosity = profile.live_config?.verbosity || nextLiveConfig.verbosity;
        nextLiveConfig.followDistance = profile.live_config?.followDistance || nextLiveConfig.followDistance;
        nextIdentity = {
          ...nextIdentity,
          ...profile.identity,
          updatedAt: new Date().toISOString()
        };
        applied.profileId = patch.profileId;
      } else {
        rejected.push({
          path: "profileId",
          reason: `Unknown profile "${patch.profileId}".`,
          requiresRestart: false
        });
      }
    }

    const updateLiveField = (path, value, apply) => {
      try {
        apply(value);
        applied.liveConfig = applied.liveConfig || {};
        applied.liveConfig[path] = value;
      } catch (error) {
        rejected.push({
          path: `liveConfig.${path}`,
          reason: error.message,
          requiresRestart: false
        });
      }
    };

    if (patch.liveConfig) {
      if (patch.liveConfig.followDistance !== undefined) {
        updateLiveField("followDistance", patch.liveConfig.followDistance, (value) => {
          const distance = Number(value);
          if (!Number.isFinite(distance) || distance < 1 || distance > 12) {
            throw new Error("followDistance must be between 1 and 12.");
          }

          nextLiveConfig.followDistance = distance;
          this.botAdapter.config.followDistance = distance;
        });
      }

      if (patch.liveConfig.autonomyLevel !== undefined) {
        updateLiveField("autonomyLevel", patch.liveConfig.autonomyLevel, (value) => {
          nextLiveConfig.autonomyLevel = String(value);
        });
      }

      if (patch.liveConfig.verbosity !== undefined) {
        updateLiveField("verbosity", patch.liveConfig.verbosity, (value) => {
          nextLiveConfig.verbosity = String(value);
        });
      }

      if (patch.liveConfig.behaviorMode !== undefined) {
        updateLiveField("behaviorMode", patch.liveConfig.behaviorMode, (value) => {
          nextLiveConfig.behaviorMode = String(value);
        });
      }

      if (patch.liveConfig.toolPermissions !== undefined) {
        updateLiveField("toolPermissions", patch.liveConfig.toolPermissions, (value) => {
          nextLiveConfig.toolPermissions = String(value);
        });
      }

      if (patch.liveConfig.buildMode !== undefined) {
        updateLiveField("buildMode", patch.liveConfig.buildMode, (value) => {
          const normalized = String(value);
          if (!["template_only", "hybrid", "emergent_only"].includes(normalized)) {
            throw new Error("buildMode must be template_only, hybrid, or emergent_only.");
          }
          nextLiveConfig.buildMode = normalized;
        });
      }

      if (patch.liveConfig.narrativeReflexEnabled !== undefined) {
        updateLiveField("narrativeReflexEnabled", patch.liveConfig.narrativeReflexEnabled, (value) => {
          nextLiveConfig.narrativeReflexEnabled = Boolean(value);
        });
      }

      if (patch.liveConfig.highSalienceOnly !== undefined) {
        updateLiveField("highSalienceOnly", patch.liveConfig.highSalienceOnly, (value) => {
          nextLiveConfig.highSalienceOnly = Boolean(value);
        });
      }

      if (patch.liveConfig.allowMutationDuringBuild !== undefined) {
        updateLiveField("allowMutationDuringBuild", patch.liveConfig.allowMutationDuringBuild, (value) => {
          nextLiveConfig.allowMutationDuringBuild = Boolean(value);
        });
      }

      if (patch.liveConfig.childFriendlyUi) {
        nextLiveConfig.childFriendlyUi = {
          ...nextLiveConfig.childFriendlyUi,
          ...patch.liveConfig.childFriendlyUi
        };
        applied.liveConfig = {
          ...applied.liveConfig,
          childFriendlyUi: nextLiveConfig.childFriendlyUi
        };
      }

      if (patch.liveConfig.safetyConstraints) {
        nextLiveConfig.safetyConstraints = {
          ...nextLiveConfig.safetyConstraints,
          ...patch.liveConfig.safetyConstraints
        };
        this.allowAutoGiveBuildMaterials = Boolean(nextLiveConfig.safetyConstraints.allowAutoGiveBuildMaterials);
        this.buildWorker.allowAutoGiveBuildMaterials = this.allowAutoGiveBuildMaterials;
        applied.liveConfig = {
          ...applied.liveConfig,
          safetyConstraints: nextLiveConfig.safetyConstraints
        };
      }

      if (patch.liveConfig.activeIdentityPreset) {
        const presetKey = patch.liveConfig.activeIdentityPreset;
        nextLiveConfig.activeIdentityPreset = presetKey;
        nextIdentity = {
          ...nextIdentity,
          personalityPreset: presetKey,
          updatedAt: new Date().toISOString()
        };
        applied.liveConfig = {
          ...applied.liveConfig,
          activeIdentityPreset: presetKey
        };
      }
    }

    if (patch.identity) {
      nextIdentity = {
        ...nextIdentity,
        ...patch.identity,
        updatedAt: new Date().toISOString()
      };
      applied.identity = patch.identity;
    }

    if (applied.liveConfig) {
      configRevision += 1;
    }

    if (applied.identity || (applied.liveConfig && applied.liveConfig.activeIdentityPreset)) {
      nextIdentity.identityRevision = identityRevision + 1;
      identityRevision = nextIdentity.identityRevision;
      if (this.companionIdentityStore) {
        await this.companionIdentityStore.upsertActiveIdentity(nextIdentity);
      }
    }

    if (patch.persistProfile && this.profileStore) {
      const profileName = patch.profileName || patch.profileId || "default";
      const saved = await this.profileStore.saveProfile({
        profileId: patch.profileId || profileName.toLowerCase().replace(/\s+/g, "_"),
        name: profileName,
        identity: nextIdentity,
        liveConfig: nextLiveConfig,
        uiDefaults: nextLiveConfig.childFriendlyUi
      });
      profileRevision = Number(profileRevision || 0) + 1;
      applied.profileId = saved.profile_id || patch.profileId || profileName;
    }

    this.setRuntimeState({
      liveConfig: nextLiveConfig,
      identity: nextIdentity,
      revisions: {
        ...this.runtimeState.revisions,
        configRevision,
        identityRevision,
        profileRevision
      }
    });

    const result = {
      applied,
      rejected,
      requiresRestart,
      revisions: {
        configRevision,
        identityRevision,
        profileRevision
      }
    };

    this.emitRuntimeEvent("config_applied", result);
    return result;
  }

  async resolveAnchorTarget(anchorId) {
    if (!anchorId || !this.anchorStore) {
      return null;
    }

    const anchor = await this.anchorStore.getAnchor(anchorId);
    if (!anchor) {
      return null;
    }

    if (anchor.type === "point") {
      return {
        anchor,
        target: anchor.payload.position
      };
    }

    if (anchor.type === "area") {
      const { cornerA, cornerB } = anchor.payload;
      return {
        anchor,
        target: {
          x: Math.floor((cornerA.x + cornerB.x) / 2),
          y: Math.floor((cornerA.y + cornerB.y) / 2),
          z: Math.floor((cornerA.z + cornerB.z) / 2)
        }
      };
    }

    if (anchor.type === "path") {
      return {
        anchor,
        target: anchor.payload.points?.[0] || null
      };
    }

    if (anchor.type === "facing") {
      return {
        anchor,
        target: anchor.payload.origin
      };
    }

    return {
      anchor,
      target: null
    };
  }

  async createAnchorFromRuntime(command) {
    if (!this.anchorStore || !this.currentWorld?.world_id) {
      throw new Error("Anchor storage is not available.");
    }

    const snapshot = this.botAdapter.getSnapshot();
    const position = snapshot.position || { x: 0, y: 0, z: 0 };
    let anchor = null;

    if (command.type === "create_anchor_from_player_position") {
      anchor = await this.anchorStore.createAnchor({
        worldId: this.currentWorld.world_id,
        label: command.label,
        type: "point",
        source: "player_position",
        payload: {
          position
        }
      });
    } else if (command.type === "create_anchor_from_look_direction") {
      anchor = await this.anchorStore.createAnchor({
        worldId: this.currentWorld.world_id,
        label: command.label,
        type: "facing",
        source: "look_direction",
        payload: {
          origin: position,
          direction: snapshot.lookVector || { x: 0, y: 0, z: 1 },
          maxDistance: command.maxDistance || null
        }
      });
    } else if (command.type === "create_anchor_from_marker_block") {
      anchor = await this.anchorStore.createAnchor({
        worldId: this.currentWorld.world_id,
        label: command.label,
        type: "point",
        source: "marker_block",
        payload: {
          position
        }
      });
    } else if (command.type === "create_area_anchor_from_corners") {
      anchor = await this.anchorStore.createAnchor({
        worldId: this.currentWorld.world_id,
        label: command.label,
        type: "area",
        source: "area_corners",
        payload: {
          cornerA: command.cornerA,
          cornerB: command.cornerB
        }
      });
    }

    if (!anchor) {
      throw new Error(`Unsupported anchor command "${command.type}".`);
    }

    const summary = formatAnchorSummary(anchor);
    this.setRuntimeState({
      activeAnchor: summary
    });

    return {
      anchor,
      summary
    };
  }

  async executeControlCommand(command) {
    const result = await this.commandService.execute(command, {
      runtime: this
    });
    return result;
  }

  async queryWhatWorked({ source = "runtime" } = {}) {
    const worldContext = this.getWorldContext();
    const fallbackSummary = {
      summary: "No recent successful recoveries recorded yet.",
      events: []
    };
    let local = fallbackSummary;
    let scope = "world_thread";

    if (this.learningStore) {
      local = await this.learningStore.getRecentOutcomeSummary({
        threadId: this.threadId,
        worldId: worldContext.worldId
      });

      if (!local.events.length) {
        local = await this.learningStore.getRecentOutcomeSummary({
          threadId: this.threadId,
          worldId: null
        });
        scope = "local_fallback";
      }
    }

    return {
      summary: local.summary,
      events: local.events.slice(0, source === "dashboard" ? 3 : 0),
      scope
    };
  }

  getBlockAtPosition(position) {
    const normalized = normalizeBlockPosition(position);
    if (!normalized || !this.botAdapter?.bot?.entity?.position) {
      return null;
    }

    const target = this.botAdapter.bot.entity.position.clone();
    target.x = normalized.x;
    target.y = normalized.y;
    target.z = normalized.z;
    return this.botAdapter.bot.blockAt(target);
  }

  isActionRetrySafe(action) {
    const actionType = String(action?.type || "none").toLowerCase();

    if (["follow_player", "stop_following", "move_to", "look_at", "chat", "inventory_status", "none"].includes(actionType)) {
      return true;
    }

    if (actionType === "dig_block") {
      const block = this.getBlockAtPosition(action.target || action.position || action.coordinates);
      return Boolean(block && !["air", "cave_air", "void_air"].includes(block.name));
    }

    if (actionType === "place_block") {
      const block = this.getBlockAtPosition(action.target || action.position || action.coordinates);
      return !block || ["air", "cave_air", "void_air"].includes(block.name);
    }

    if (["compose_structure", "build_structure"].includes(actionType)) {
      return Boolean(this.getWorldContext().worldId);
    }

    return false;
  }

  getWorldContext() {
    return {
      worldId: this.currentWorld?.world_id || null,
      sessionId: this.currentSession?.session_id || null
    };
  }

  createTurnId() {
    this.turnCounter += 1;
    return `turn-${Date.now()}-${this.turnCounter}`;
  }

  createAttemptId(turnId, attemptIndex) {
    return `${turnId}:attempt:${attemptIndex}`;
  }

  async awaitRuntimeAvailability() {
    if (!this.runtimeUnavailable) {
      return true;
    }

    if (this.reconnectGate) {
      await this.reconnectGate;
    }

    return !this.runtimeUnavailable;
  }

  computeReconnectDelay(attemptIndex) {
    const exponent = Math.max(0, attemptIndex - 1);
    const raw = this.reconnectBaseDelayMs * Math.pow(2, exponent);
    const capped = Math.min(Math.max(raw, this.reconnectBaseDelayMs), this.reconnectMaxDelayMs);
    const jitterAmount = capped * this.reconnectJitter * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(capped + jitterAmount));
  }

  async handleConnectionLoss(reason, error) {
    if (this.shuttingDown) {
      return;
    }

    this.runtimeUnavailable = true;
    this.connectionInterrupted = true;
    this.setRuntimeState({
      lifecycle: "reconnecting",
      connectionHealth: "disconnected",
      reconnectState: {
        ...this.runtimeState.reconnectState,
        status: "running",
        lastStartedAt: new Date().toISOString()
      }
    });

    if (this.activeTurnId) {
      this.completeTurnTask(this.activeTurnId, true);
    }

    if (!this.reconnectGate) {
      this.reconnectGate = new Promise((resolve) => {
        this.reconnectResolver = resolve;
      });
    }

    if (this.reconnectInFlight) {
      return;
    }

    const classification = classifyConnectionError(error || {});

    await this.safeRecordEvent({
      threadId: this.threadId,
      type: "minecraft_reconnect_started",
      description: `Reconnect started (${reason})`,
      actor: this.companionName,
      location: this.botAdapter.getSnapshot().position,
      snapshot: this.botAdapter.getSnapshot(),
      metadata: {
        reconnect: {
          status: "started",
          reason,
          errorCode: classification.errorCode,
          errorCategory: classification.errorCategory
        }
      }
    });
    this.emitRuntimeEvent("minecraft_reconnect_started", {
      attemptCount: this.runtimeState.reconnectState.attemptCount,
      maxAttempts: this.reconnectMaxAttempts,
      reason
    });

    this.reconnectInFlight = this.runReconnectLoop(reason).finally(() => {
      this.reconnectInFlight = null;
    });
  }

  async runReconnectLoop(reason) {
    let lastError = null;

    for (let attemptIndex = 1; attemptIndex <= this.reconnectMaxAttempts; attemptIndex += 1) {
      try {
        await this.botAdapter.connect();
        await this.initializeWorldContext();
        this.runtimeUnavailable = false;
        this.connectionInterrupted = false;
        this.setRuntimeState({
          lifecycle: "ready",
          connectionHealth: "healthy",
          reconnectState: {
            ...this.runtimeState.reconnectState,
            status: "idle",
            attemptCount: attemptIndex,
            lastCompletedAt: new Date().toISOString(),
            lastErrorCode: null
          }
        });

        if (this.reconnectResolver) {
          this.reconnectResolver(true);
        }
        this.reconnectGate = null;
        this.reconnectResolver = null;

        await this.safeRecordEvent({
          threadId: this.threadId,
          type: "minecraft_reconnect_succeeded",
          description: `Reconnect succeeded (${reason})`,
          actor: this.companionName,
          location: this.botAdapter.getSnapshot().position,
          snapshot: this.botAdapter.getSnapshot(),
          metadata: {
            reconnect: {
              status: "succeeded",
              reason,
              attempts: attemptIndex
            }
          }
        });
        this.emitRuntimeEvent("minecraft_reconnect_succeeded", {
          attemptCount: attemptIndex
        });

        return true;
      } catch (error) {
        lastError = error;
        this.setRuntimeState({
          reconnectState: {
            ...this.runtimeState.reconnectState,
            status: "running",
            attemptCount: attemptIndex,
            lastErrorCode: classifyConnectionError(error).errorCode
          }
        });
        const delayMs = this.computeReconnectDelay(attemptIndex);
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    if (this.reconnectResolver) {
      this.reconnectResolver(false);
    }
    this.reconnectGate = null;
    this.reconnectResolver = null;

    const classification = classifyConnectionError(lastError || {});

    await this.safeRecordEvent({
      threadId: this.threadId,
      type: "minecraft_reconnect_failed",
      description: `Reconnect failed (${reason})`,
      actor: this.companionName,
      location: this.botAdapter.getSnapshot().position,
      snapshot: this.botAdapter.getSnapshot(),
      metadata: {
        reconnect: {
          status: "failed",
          reason,
          attempts: this.reconnectMaxAttempts,
          errorCode: classification.errorCode,
          errorCategory: classification.errorCategory
        }
      }
    });
    this.emitRuntimeEvent("minecraft_reconnect_failed", {
      attemptCount: this.reconnectMaxAttempts,
      maxAttempts: this.reconnectMaxAttempts,
      errorCode: classification.errorCode
    });

    this.setRuntimeState({
      lifecycle: "error",
      connectionHealth: "disconnected",
      reconnectState: {
        ...this.runtimeState.reconnectState,
        status: "failed",
        attemptCount: this.reconnectMaxAttempts,
        lastCompletedAt: new Date().toISOString(),
        lastErrorCode: classification.errorCode
      }
    });

    return false;
  }

  async start() {
    this.setRuntimeState({
      lifecycle: "starting",
      connectionHealth: "degraded"
    });
    this.#bindEvents();
    await this.botAdapter.connect();
    await this.initializeWorldContext();
    await this.loadActiveIdentity();
    await this.ensureDefaultProfiles();
    const identityProfile = this.getIdentityPromptProfile();

    await this.messageStore.ensureCharacter({
      id: this.companionName.toLowerCase(),
      name: identityProfile.displayName,
      role: identityProfile.role,
      personality: identityProfile.personality
    });

    const worldContext = this.getWorldContext();
    const [observedChatCount, latestSummary] = await Promise.all([
      this.messageStore.countMessages(this.threadId, {
        worldId: worldContext.worldId,
        excludedSpeaker: this.companionName
      }),
      this.eventStore.getLatestAdventureSummary(this.threadId, {
        worldId: worldContext.worldId
      })
    ]);

    this.observedChatCount = observedChatCount;
    this.lastSummaryObservedChatCount = latestSummary?.metadata?.observedChatCount || 0;
    this.readyForTurns = true;
    this.setRuntimeState({
      lifecycle: "ready",
      connectionHealth: "healthy",
      world: {
        worldId: this.currentWorld?.world_id || null,
        sessionId: this.currentSession?.session_id || null,
        serverAddress: this.currentWorld?.server_address || this.runtimeState.world.serverAddress,
        dimension: this.currentWorld?.dimension || null
      }
    });

    const snapshot = this.botAdapter.getSnapshot();

    await this.safeRecordEvent({
      threadId: this.threadId,
      type: "session_start",
      description: `${this.companionName} connected to ${this.botAdapter.config.host}:${this.botAdapter.config.port}`,
      actor: this.companionName,
      location: snapshot.position,
      snapshot,
      metadata: {
        worldId: worldContext.worldId,
        sessionId: worldContext.sessionId
      }
    });

    await this.safeRecordEvent({
      threadId: this.threadId,
      type: this.isNewWorld ? "new_world_detected" : "world_entered",
      description: this.isNewWorld ? "Guardian detected a new world" : "Guardian returned to a known world",
      actor: this.companionName,
      location: snapshot.position,
      snapshot,
      metadata: {
        worldId: worldContext.worldId,
        sessionId: worldContext.sessionId,
        serverAddress: this.currentWorld?.server_address,
        dimension: this.currentWorld?.dimension
      }
    });

    await this.safeRecordEvent({
      threadId: this.threadId,
      type: "spawn",
      description: `${this.companionName} joined the world`,
      actor: this.companionName,
      location: snapshot.position,
      snapshot
    });

    this.startBackgroundLoops();
    void this.runReflexScan("startup");
  }

  async initializeWorldContext() {
    const identity = resolveWorldIdentity(this.botAdapter);
    const existingWorld = await this.worldStore.getWorld(identity.worldId);

    this.currentWorld = await this.worldStore.upsertWorld({
      worldId: identity.worldId,
      serverAddress: identity.serverAddress,
      spawnLocation: identity.spawnLocation,
      dimension: identity.dimension,
      serverBrand: identity.serverBrand
    });
    this.isNewWorld = !existingWorld;

    await this.jobStore.pauseRunningJobs(identity.worldId);

    this.currentSession = await this.sessionStore.createSession({
      worldId: identity.worldId,
      threadId: this.threadId,
      primaryPlayer: this.primaryPlayer
    });
    this.setRuntimeState({
      world: {
        worldId: this.currentWorld?.world_id || null,
        sessionId: this.currentSession?.session_id || null,
        serverAddress: this.currentWorld?.server_address || null,
        dimension: this.currentWorld?.dimension || null
      }
    });
  }

  startBackgroundLoops() {
    if (!this.reflexObservationTimer) {
      this.reflexObservationTimer = setInterval(() => {
        void this.runReflexScan("interval");
      }, this.reflexObservationIntervalMs);
    }

    if (!this.reflexWorkerTimer) {
      this.reflexWorkerTimer = setInterval(() => {
        void this.reflexWorker.runOnce();
      }, this.reflexWorkerIntervalMs);
    }

    if (!this.buildWorkerTimer) {
      this.buildWorkerTimer = setInterval(() => {
        void this.buildWorker.runOnce();
      }, this.buildWorkerIntervalMs);
    }
  }

  stopBackgroundLoops() {
    if (this.reflexObservationTimer) {
      clearInterval(this.reflexObservationTimer);
      this.reflexObservationTimer = null;
    }

    if (this.reflexWorkerTimer) {
      clearInterval(this.reflexWorkerTimer);
      this.reflexWorkerTimer = null;
    }

    if (this.buildWorkerTimer) {
      clearInterval(this.buildWorkerTimer);
      this.buildWorkerTimer = null;
    }
  }

  async runReflexScan(reason) {
    if (!this.readyForTurns) {
      return [];
    }

    if (this.reflexScanInFlight) {
      return this.reflexScanInFlight;
    }

    this.reflexScanInFlight = this.reflexClassifier
      .scan(reason)
      .catch((error) => {
        this.logger.error("[reflex] Classification failed:", error);
        return [];
      })
      .finally(() => {
        this.reflexScanInFlight = null;
      });

    return this.reflexScanInFlight;
  }

  #bindEvents() {
    if (this.bound) {
      return;
    }

    this.bound = true;

    this.botAdapter.on("spawn", () => {
      this.setRuntimeState({
        lifecycle: this.runtimeState.lifecycle === "reconnecting" ? "ready" : this.runtimeState.lifecycle,
        connectionHealth: "healthy"
      });
      if (this.readyForTurns) {
        void this.runReflexScan("spawn");
      }
    });

    this.botAdapter.on("chat", (payload) => {
      if (payload.username === this.primaryPlayer) {
        this.reflexClassifier.markPrimaryActivity();
      }

      void this.handleChat(payload);
    });

    this.botAdapter.on("entityMoved", (payload) => {
      if (payload.username === this.primaryPlayer) {
        this.reflexClassifier.markPrimaryActivity();
      }
    });

    this.botAdapter.on("nearbyEntityChanged", () => {
      if (this.readyForTurns) {
        void this.runReflexScan("nearby_entity_changed");
      }
    });

    this.botAdapter.on("timeUpdate", () => {
      if (this.readyForTurns) {
        void this.runReflexScan("time_update");
      }
    });

    this.botAdapter.on("botError", (error) => {
      this.setRuntimeState({
        connectionHealth: "degraded"
      });
      void this.handleConnectionLoss("bot_error", error);
    });

    this.botAdapter.on("end", () => {
      this.setRuntimeState({
        lifecycle: this.shuttingDown ? this.runtimeState.lifecycle : "reconnecting",
        connectionHealth: "disconnected"
      });
      void this.handleConnectionLoss("end", new Error("Minecraft connection ended."));
    });
  }

  async handleChat(payload) {
    try {
      if (!this.readyForTurns || !this.shouldObserve(payload)) {
        return;
      }

      const observedSnapshot = this.botAdapter.getSnapshot();
      const directCommand = this.getDirectCommand(payload);
      const eligibleForReasoning = !directCommand && this.shouldRespond(payload);
      const willTriggerReasoning = eligibleForReasoning && this.pendingTurns < this.maxPendingTurns;
      const turnId = willTriggerReasoning ? this.createTurnId() : null;
      const directCommandTurnId = directCommand ? this.createTurnId() : null;
      const observedTurnId = turnId || directCommandTurnId || null;

      if (turnId) {
        this.latestTurnId = turnId;
        this.queueTurnTask({
          turnId,
          label: payload.message
        });
      }

      await this.recordObservedChat(payload, observedSnapshot, {
        directCommand: directCommand?.type || null,
        triggeredReasoning: willTriggerReasoning,
        turnId: observedTurnId
      });

      if (directCommand) {
        if (directCommand.type === "what_worked") {
          await this.executeWhatWorked(payload, observedSnapshot, directCommandTurnId);
        } else {
          await this.executeDirectCommand(payload, directCommand, observedSnapshot);
        }
        void this.maybeDistillAdventure();
        return;
      }

      if (!eligibleForReasoning) {
        void this.maybeDistillAdventure();
        return;
      }

      if (!willTriggerReasoning) {
        await this.safeRecordEvent({
          threadId: this.threadId,
          type: "backpressure",
          description: `Dropped queued message from ${payload.username}`,
          actor: this.companionName,
          location: this.botAdapter.getSnapshot().position,
          snapshot: this.botAdapter.getSnapshot(),
          metadata: {
            message: payload.message,
            directMention: payload.directMention
          }
        });

        await this.botAdapter.say("I am catching up. Give me a second.");
        void this.maybeDistillAdventure();
        return;
      }

      this.pendingTurns += 1;

      this.turnQueue = this.turnQueue
        .then(() => this.processTurn(payload, turnId))
        .catch((error) => this.handleTurnError(error, payload))
        .finally(() => {
          this.pendingTurns = Math.max(0, this.pendingTurns - 1);
        });

      return this.turnQueue;
    } catch (error) {
      await this.handleTurnError(error, payload);
    }
  }

  shouldObserve(payload) {
    if (!payload?.username) {
      return false;
    }

    if (payload.username === this.companionName) {
      return false;
    }

    if (this.botAdapter.bot && payload.username === this.botAdapter.bot.username) {
      return false;
    }

    return true;
  }

  shouldRespond(payload) {
    if (!this.shouldObserve(payload)) {
      return false;
    }

    if (this.respondToAllPlayers) {
      return true;
    }

    return payload.username === this.primaryPlayer || payload.directMention;
  }

  async getActiveBuildStatus(worldId) {
    if (!this.jobStore || !worldId) {
      return null;
    }

    const job = await this.jobStore.getActiveBuildJob(worldId);
    if (!job) {
      return null;
    }

    return {
      active: ["running", "paused", "pending"].includes(job.status),
      jobId: String(job.id),
      lane: job.type === "build_emergent" ? "emergent" : "template",
      progress: job.progress || 0,
      feedbackSummary: job.payload?.feedback_summary || null,
      designReadiness: job.payload?.design_readiness || null
    };
  }

  buildFeedbackPackets({ intentSignal, buildStatus } = {}) {
    const packets = [];

    if (intentSignal?.needsClarification) {
      packets.push({
        type: "intent_signal",
        priority: "medium",
        source: "chat",
        summary: intentSignal.summary || "Intent needs clarification.",
        diagnostic_code: intentSignal.diagnostic_code || null,
        speakable_summary: intentSignal.suggestedQuestion || null,
        cooldown_seconds: 0,
        metadata: {}
      });
    }

    if (buildStatus?.feedbackSummary) {
      packets.push({
        type: "build_progress",
        priority: "low",
        source: "build",
        summary: buildStatus.feedbackSummary,
        cooldown_seconds: 20,
        metadata: {
          jobId: buildStatus.jobId,
          lane: buildStatus.lane,
          progress: buildStatus.progress
        }
      });
    }

    return packets;
  }

  getDirectCommand(payload) {
    if (payload?.username !== this.primaryPlayer) {
      return null;
    }

    const normalized = normalizeCommandText(payload.message, this.companionName);

    if (normalized === "follow me") {
      return {
        message: `On your heels, ${this.primaryPlayer}.`,
        action: {
          type: "follow_player",
          player: this.primaryPlayer
        }
      };
    }

    if (normalized === "stop following") {
      return {
        message: "Stopping here.",
        action: {
          type: "stop_following",
          player: this.primaryPlayer
        }
      };
    }

    if (
      normalized === "inventory" ||
      normalized === "check inventory" ||
      normalized.includes("what do you have") ||
      normalized.includes("what are you carrying") ||
      normalized.includes("what's in your inventory")
    ) {
      return {
        message: "",
        action: {
          type: "inventory_status"
        }
      };
    }

    if (normalized === "what worked" || normalized === "what works") {
      return {
        type: "what_worked"
      };
    }

    return null;
  }

  async recordObservedChat(payload, observedSnapshot, metadata = {}) {
    const worldContext = this.getWorldContext();

    await this.messageStore.storeMessage({
      threadId: this.threadId,
      worldId: worldContext.worldId,
      sessionId: worldContext.sessionId,
      speaker: payload.username,
      content: payload.message,
      source: "minecraft",
      metadata: {
        directMention: payload.directMention,
        directCommand: metadata.directCommand || null,
        triggeredReasoning: Boolean(metadata.triggeredReasoning),
        turnId: metadata.turnId || null,
        snapshot: observedSnapshot
      }
    });

    this.observedChatCount += 1;

    await this.eventStore.recordEvent({
      threadId: this.threadId,
      worldId: worldContext.worldId,
      sessionId: worldContext.sessionId,
      type: "chat_observed",
      description: payload.message,
      actor: payload.username,
      location: observedSnapshot.position,
      snapshot: observedSnapshot,
      metadata: {
        directMention: payload.directMention,
        directCommand: metadata.directCommand || null,
        triggeredReasoning: Boolean(metadata.triggeredReasoning),
        turnId: metadata.turnId || null
      }
    });
  }

  async executeDirectCommand(payload, directCommand, observedSnapshot) {
    const directTask = createTaskState({
      label: directCommand.action?.type || directCommand.type || "direct_command",
      status: "running"
    });
    this.setRuntimeState({
      activeTask: directTask
    });

    const reply = {
      message: directCommand.message || "",
      action: directCommand.action
    };

    const execution = await this.actionExecutor.execute(reply);

    await this.storeCompanionResponse({
      reply,
      execution,
      snapshot: observedSnapshot,
      eventType: "direct_command_executed",
      metadata: {
        commandType: directCommand.action?.type || "none",
        requestedBy: payload.username,
        trigger: "direct_command"
      }
    });

    this.setRuntimeState({
      activeTask: null
    });
  }

  async executeWhatWorked(payload, observedSnapshot, turnId = null) {
    const result = await this.queryWhatWorked({
      source: "runtime"
    });
    const { summary, scope } = result;
    const isSuccessfulLearningOutcome = (event) =>
      ["succeeded", "success"].includes(event.terminal_outcome);

    await this.botAdapter.say(summary);
    this.setRuntimeState({
      latestLearningSummary: this.learningStore
        ? {
            retryDomain: "action",
            normalizedSignature: "what_worked",
            successCount: Array.isArray(result.events)
              ? result.events.filter(isSuccessfulLearningOutcome).length
              : 0,
            failureCount: Array.isArray(result.events)
              ? result.events.filter((event) => !isSuccessfulLearningOutcome(event)).length
              : 0,
            latestTimestamp: new Date().toISOString(),
            summary
          }
        : this.runtimeState.latestLearningSummary
    });

    await this.safeRecordEvent({
      threadId: this.threadId,
      type: "graph_query",
      description: "what_worked",
      actor: this.companionName,
      location: observedSnapshot.position,
      snapshot: observedSnapshot,
      metadata: {
        turnId,
        scope,
        query: "what_worked",
        requestedBy: payload?.username || null
      }
    });
    this.emitRuntimeEvent("graph_query", {
      scope,
      summaryCount: 1
    }, {
      turnId
    });
  }

  async processTurn(payload, turnId, options = {}) {
    const observedSnapshot = this.botAdapter.getSnapshot();
    const worldContext = this.getWorldContext();
    this.activeTurnId = turnId;
    this.startTurnTask(turnId);
    this.setRuntimeState({
      retryState: {
        ...this.runtimeState.retryState,
        activeTurnId: turnId,
        activeAttempt: null,
        loopDetected: false
      }
    });
    let lastFailureSignature = null;
    const identityProfile = this.getIdentityPromptProfile();
    const resolvedAnchor = options.anchorId ? await this.resolveAnchorTarget(options.anchorId) : null;
    if (resolvedAnchor?.anchor) {
      this.setRuntimeState({
        activeAnchor: formatAnchorSummary(resolvedAnchor.anchor)
      });
    }

    try {
      const runtimeAvailable = await this.awaitRuntimeAvailability();
      if (!runtimeAvailable) {
        this.completeTurnTask(turnId, true);
        await this.safeRecordEvent({
          threadId: this.threadId,
          type: "retry_stopped",
          description: "Retry stopped: runtime unavailable",
          actor: this.companionName,
          location: observedSnapshot.position,
          snapshot: observedSnapshot,
          metadata: {
            turnId,
            stopReason: "runtime_unavailable"
          }
        });
        return;
      }

      const intentSignal = analyzeIntent(payload.message, this.primaryPlayer);
      const buildStatus = await this.getActiveBuildStatus(worldContext.worldId);
      if (buildStatus) {
        this.setRuntimeState({
          buildStatus: {
            jobId: buildStatus.jobId || null,
            lane: buildStatus.lane || null,
            progress: Number.isFinite(Number(buildStatus.progress)) ? Number(buildStatus.progress) : null,
            feedbackSummary: buildStatus.feedbackSummary || null,
            designReadiness: buildStatus.designReadiness || null
          }
        });
      }
      const feedbackPackets = this.buildFeedbackPackets({
        intentSignal,
        buildStatus
      });
      const feedbackSummaries = this.feedbackBroker.collectSummaries({
        packets: feedbackPackets
      });
      const laneDecision = routeBuildLane({
        message: payload.message,
        intentSignal,
        buildStatus,
        buildMode: this.runtimeState.liveConfig.buildMode || "hybrid",
        mutationPolicy: {
          allowMutationDuringBuild: Boolean(this.runtimeState.liveConfig.allowMutationDuringBuild)
        }
      });

      if (laneDecision?.readiness) {
        this.setRuntimeState({
          buildStatus: {
            ...(this.runtimeState.buildStatus || {
              jobId: null,
              lane: null,
              progress: null,
              feedbackSummary: null,
              designReadiness: null
            }),
            designReadiness: laneDecision.readiness
          }
        });
      }

      if (laneDecision?.clarification) {
        const reply = {
          message: laneDecision.clarification,
          action: { type: "none" },
          task: {
            summary: "Clarification requested before build.",
            diagnostic_code: laneDecision.reason || "clarification_required",
            recommended_next_step: "clarify_request"
          }
        };
        const execution = await this.actionExecutor.execute(reply);
        await this.storeCompanionResponse({
          reply,
          execution,
          snapshot: observedSnapshot,
          eventType: "clarification_requested",
          metadata: {
            trigger: "lane_router",
            laneDecision
          }
        });
        this.completeTurnTask(turnId);
        return;
      }

      const parsedBuild = parseBuildRequest(payload.message, this.primaryPlayer);
      if (parsedBuild && laneDecision?.buildLane === "template") {
        const reply = {
          message: "",
          action: parsedBuild
        };
        const execution = await this.actionExecutor.execute(reply);
        await this.storeCompanionResponse({
          reply,
          execution,
          snapshot: observedSnapshot,
          eventType: "direct_command_executed",
          metadata: {
            trigger: "lane_router",
            laneDecision
          }
        });
        this.completeTurnTask(turnId);
        return;
      }

      const feedbackSummary =
        laneDecision?.lane === "task" ? feedbackSummaries.taskSummary : feedbackSummaries.socialSummary;
    const createSuccessSignature = ({ retryDomain, actionType, provider, operationSubtype }) =>
      createNormalizedFailureSignature({
        retryDomain,
        actionType,
        errorCode: "success",
        errorCategory: "success",
        provider,
        operationSubtype,
        signatureVersion: "v1"
      });

    const isNonRetryableSignature = (signature) => {
      const nonRetryableCodes = new Set([
        "missing_required_input",
        "invalid_coordinates",
        "invalid_command",
        "unknown_structure",
        "invalid_target",
        "permission_refusal",
        "safety_refusal",
        "auth_failure",
        "bootstrap_failure"
      ]);
      return nonRetryableCodes.has(signature?.errorCode);
    };

    const recordAttemptOutcome = async ({
      attemptId,
      attemptIndex,
      retryDomain,
      signature,
      actionType,
      provider,
      operationSubtype,
      terminalOutcome,
      metadata = {}
    }) => {
      this.setRuntimeState({
        retryState: {
          ...this.runtimeState.retryState,
          activeAttempt: {
            attemptId,
            turnId,
            retryDomain,
            attemptIndex,
            signature: signature?.signature || null,
            startedAt: this.runtimeState.retryState.activeAttempt?.startedAt || new Date().toISOString(),
            lastUpdatedAt: new Date().toISOString()
          }
        }
      });

      const attemptEnvelope = createRetryAttemptEnvelope({
        turnId,
        attemptId,
        commandId: options.commandId || null,
        threadId: this.threadId,
        worldId: worldContext.worldId,
        retryDomain,
        signature,
        actionType,
        provider,
        operationSubtype,
        metadata: {
          attemptIndex,
          ...metadata
        }
      });

      const outcomeEnvelope = createRetryOutcomeEnvelope({
        turnId,
        attemptId,
        commandId: options.commandId || null,
        threadId: this.threadId,
        worldId: worldContext.worldId,
        retryDomain,
        signature,
        actionType,
        provider,
        operationSubtype,
        terminalOutcome,
        metadata: {
          attemptIndex,
          ...metadata
        }
      });

      await this.recordRetryEvents({
        attemptEnvelope,
        outcomeEnvelope,
        worldContext
      });
    };

    const runResult = await this.retryCoordinator.run({
      turnId,
      threadId: this.threadId,
      worldId: worldContext.worldId,
      provider: this.llmProvider,
      getGuidance: async () => {
        if (!this.learningStore || !lastFailureSignature) {
          return null;
        }
        const { guidance } = await this.learningStore.getOutcomeGuidance({
          threadId: this.threadId,
          worldId: worldContext.worldId,
          retryDomain: lastFailureSignature.retryDomain,
          actionType: lastFailureSignature.actionType,
          signature: lastFailureSignature
        });
        return guidance;
      },
      isSuperseded: () => this.latestTurnId && this.latestTurnId !== turnId,
      isShuttingDown: () => this.shuttingDown,
      isRuntimeUnavailable: () => this.runtimeUnavailable,
      attempt: async ({ attemptIndex, guidance }) => {
        const attemptId = this.createAttemptId(turnId, attemptIndex);
        let context = null;
        let reply = null;
        let execution = null;

        try {
          context = await buildContext({
            messageStore: this.messageStore,
            eventStore: this.eventStore,
            bot: this.botAdapter.bot,
            threadId: this.threadId,
            worldId: worldContext.worldId,
            latestMessage: resolvedAnchor?.anchor
              ? `${payload.message}\nTarget anchor: ${formatAnchorSummary(resolvedAnchor.anchor)?.description || resolvedAnchor.anchor.label}`
              : payload.message,
            primaryPlayer: this.primaryPlayer,
            companionName: identityProfile.displayName,
            role: identityProfile.role,
            personality: identityProfile.personality,
            memoryWindow: this.memoryWindow,
            eventWindow: this.eventWindow,
            summaryContextLimit: this.summaryContextLimit,
            retryGuidance: guidance || null,
            feedbackSummary
          });
        } catch (error) {
          const signature = buildNormalizedFailureSignature({
            retryDomain: RETRY_DOMAINS.ACTION,
            actionType: "context_build",
            error
          });
          lastFailureSignature = signature;

          await recordAttemptOutcome({
            attemptId,
            attemptIndex,
            retryDomain: RETRY_DOMAINS.ACTION,
            signature,
            actionType: "context_build",
            provider: this.llmProvider,
            operationSubtype: "context",
            terminalOutcome: RETRY_TERMINAL_OUTCOMES.FAILED
          });

          return {
            ok: false,
            retryDomain: RETRY_DOMAINS.ACTION,
            actionType: "context_build",
            error,
            nonRetryable: isNonRetryableSignature(signature)
          };
        }

        try {
          reply = await this.llmClient.complete({
            systemPrompt: context.systemPrompt,
            userPrompt: context.userPrompt
          });
        } catch (error) {
          const signature = buildNormalizedFailureSignature({
            retryDomain: RETRY_DOMAINS.LLM,
            actionType: "chat",
            error,
            provider: this.llmProvider
          });
          lastFailureSignature = signature;

          await recordAttemptOutcome({
            attemptId,
            attemptIndex,
            retryDomain: RETRY_DOMAINS.LLM,
            signature,
            actionType: "chat",
            provider: this.llmProvider,
            operationSubtype: "request",
            terminalOutcome: RETRY_TERMINAL_OUTCOMES.FAILED
          });

          return {
            ok: false,
            retryDomain: RETRY_DOMAINS.LLM,
            actionType: "chat",
            error,
            provider: this.llmProvider,
            nonRetryable: isNonRetryableSignature(signature)
          };
        }

        try {
          if (resolvedAnchor?.target && reply?.action && !reply.action.target && !reply.action.location) {
            reply.action.target = resolvedAnchor.target;
            reply.action.location = resolvedAnchor.target;
            reply.action.anchorId = resolvedAnchor.anchor.id;
          }

          execution = await this.actionExecutor.execute(reply);
        } catch (error) {
          const connectionInterrupted = this.runtimeUnavailable || this.connectionInterrupted;
          const retryDomain = connectionInterrupted ? RETRY_DOMAINS.CONNECTION : RETRY_DOMAINS.ACTION;
          const actionRetrySafe = connectionInterrupted ? false : this.isActionRetrySafe(reply?.action);
          const signature = buildNormalizedFailureSignature({
            retryDomain,
            actionType: reply?.action?.type || "none",
            error
          });
          lastFailureSignature = signature;

          await recordAttemptOutcome({
            attemptId,
            attemptIndex,
            retryDomain,
            signature,
            actionType: reply?.action?.type || "none",
            provider: this.llmProvider,
            operationSubtype: "execution",
            terminalOutcome: connectionInterrupted
              ? RETRY_TERMINAL_OUTCOMES.INTERRUPTED
              : RETRY_TERMINAL_OUTCOMES.FAILED
          });

          return {
            ok: false,
            retryDomain,
            actionType: reply?.action?.type || "none",
            error,
            nonRetryable: isNonRetryableSignature(signature) || !actionRetrySafe,
            interrupted: connectionInterrupted
          };
        }

        if (!execution.messageSent && (reply.parseMode === "suppressed_structured_leak" || reply.parseMode === "rejected")) {
          await this.botAdapter.say("I got a little tangled. Ask me again.");
          execution.messageSent = true;
          execution.fallbackMessage = "I got a little tangled. Ask me again.";
        }

        const successSignature =
          lastFailureSignature ||
          createSuccessSignature({
            retryDomain: RETRY_DOMAINS.ACTION,
            actionType: reply?.action?.type || "none",
            provider: this.llmProvider,
            operationSubtype: "execution"
          });

        await recordAttemptOutcome({
          attemptId,
          attemptIndex,
          retryDomain: successSignature.retryDomain,
          signature: successSignature,
          actionType: reply?.action?.type || "none",
          provider: this.llmProvider,
          operationSubtype: "execution",
          terminalOutcome: RETRY_TERMINAL_OUTCOMES.SUCCESS
        });

        return {
          ok: true,
          value: {
            reply,
            execution,
            context,
            attemptId
          }
        };
      }
    });

    if (!runResult.ok) {
      this.setRuntimeState({
        retryState: {
          ...this.runtimeState.retryState,
          activeAttempt: null,
          activeTurnId: null,
          loopDetected: runResult.stopReason === "loop_detected",
          lastOutcome:
            runResult.stopReason === "non_retryable"
              ? "non_retryable"
              : runResult.stopReason === "superseded"
                ? "superseded"
                : runResult.stopReason === "runtime_unavailable"
                  ? "interrupted"
                  : "failed"
        }
      });
      if (runResult.stopReason === "loop_detected") {
        this.emitRuntimeEvent("retry_loop_detected", {
          turnId,
          retryDomain: lastFailureSignature?.retryDomain || "action",
          signature: lastFailureSignature?.signature || "unknown",
          threshold: this.retryCoordinator.loopThreshold
        }, {
          turnId,
          retryDomain: lastFailureSignature?.retryDomain || "action",
          normalizedSignature: lastFailureSignature?.signature || "unknown"
        });
      }
      if (runResult.stopReason === "superseded") {
        this.emitRuntimeEvent("turn_superseded", {
          turnId,
          supersededByCommandId: options.commandId || "newer_foreground_command",
          outcome: "superseded"
        }, {
          turnId,
          correlationId: options.commandId || undefined
        });
      }

      await this.safeRecordEvent({
        threadId: this.threadId,
        type: "retry_stopped",
        description: `Retry stopped: ${runResult.stopReason || "unknown"}`,
        actor: this.companionName,
        location: observedSnapshot.position,
        snapshot: observedSnapshot,
        metadata: {
          turnId,
          attempts: runResult.attempts,
          terminalOutcome: runResult.terminalOutcome,
          stopReason: runResult.stopReason || null
        }
      });

      if (
        runResult.stopReason === "superseded" ||
        runResult.stopReason === "runtime_shutdown" ||
        runResult.stopReason === "runtime_unavailable"
      ) {
        this.completeTurnTask(turnId, runResult.stopReason === "runtime_unavailable");
        return;
      }

      this.completeTurnTask(turnId);
      await this.handleTurnError(
        new Error(`Retry stopped: ${runResult.stopReason || runResult.terminalOutcome || "unknown"}`),
        payload
      );
      return;
    }

    const { reply, execution, context, attemptId } = runResult.value;

    await this.storeCompanionResponse({
      reply,
      execution,
      snapshot: context.worldSnapshot || observedSnapshot,
      metadata: {
        trigger: "llm",
        llmProvider: this.llmProvider,
        parseMode: reply.parseMode || null,
        rawReply: reply.raw || null,
        turnId,
        attemptId
      }
    });
    this.completeTurnTask(turnId);
    this.setRuntimeState({
      retryState: {
        ...this.runtimeState.retryState,
        activeTurnId: null,
        activeAttempt: null,
        lastOutcome: "succeeded"
      }
    });

    void this.maybeDistillAdventure();
    } finally {
      if (this.activeTurnId === turnId) {
        this.activeTurnId = null;
      }
    }
  }

  async storeCompanionResponse({
    reply,
    execution,
    snapshot,
    eventType = "companion_response",
    metadata = {}
  }) {
    const worldContext = this.getWorldContext();

    await this.messageStore.storeMessage({
      threadId: this.threadId,
      worldId: worldContext.worldId,
      sessionId: worldContext.sessionId,
      speaker: this.companionName,
      content: reply.message || "",
      source: "minecraft",
      metadata: {
        action: reply.action,
        task: reply.task || null,
        execution,
        snapshot,
        ...metadata
      }
    });

    await this.eventStore.recordEvent({
      threadId: this.threadId,
      worldId: worldContext.worldId,
      sessionId: worldContext.sessionId,
      type: eventType,
      description: reply.message || execution.actionType,
      actor: this.companionName,
      location: snapshot.position,
      snapshot,
      metadata: {
        action: reply.action,
        task: reply.task || null,
        execution,
        ...metadata
      }
    });
  }

  async recordRetryEvents({ attemptEnvelope, outcomeEnvelope, worldContext }) {
    const snapshot = this.botAdapter.getSnapshot();

    let attemptEvent = null;
    let outcomeEvent = null;

    if (this.learningStore) {
      attemptEvent = await this.learningStore.recordLearningEvent({
        eventType: attemptEnvelope.kind,
        turnId: attemptEnvelope.turnId,
        attemptId: attemptEnvelope.attemptId,
        commandId: attemptEnvelope.commandId,
        threadId: attemptEnvelope.threadId,
        worldId: attemptEnvelope.worldId,
        sessionId: worldContext.sessionId,
        retryDomain: attemptEnvelope.retryDomain,
        signature: attemptEnvelope.signature,
        actionType: attemptEnvelope.actionType,
        provider: attemptEnvelope.provider,
        operationSubtype: attemptEnvelope.operationSubtype,
        status: "attempted",
        metadata: attemptEnvelope.metadata
      });

      outcomeEvent = await this.learningStore.recordLearningEvent({
        eventType: outcomeEnvelope.kind,
        turnId: outcomeEnvelope.turnId,
        attemptId: outcomeEnvelope.attemptId,
        commandId: outcomeEnvelope.commandId,
        threadId: outcomeEnvelope.threadId,
        worldId: outcomeEnvelope.worldId,
        sessionId: worldContext.sessionId,
        retryDomain: outcomeEnvelope.retryDomain,
        signature: outcomeEnvelope.signature,
        actionType: outcomeEnvelope.actionType,
        provider: outcomeEnvelope.provider,
        operationSubtype: outcomeEnvelope.operationSubtype,
        terminalOutcome: outcomeEnvelope.terminalOutcome,
        status: "outcome",
        metadata: outcomeEnvelope.metadata
      });
    }

    if (this.learningStore && attemptEvent?.id && outcomeEvent?.id) {
      await this.learningStore.relateAttemptOutcome({
        attemptId: attemptEvent.id,
        outcomeId: outcomeEvent.id,
        threadId: attemptEnvelope.threadId,
        worldId: attemptEnvelope.worldId,
        turnId: attemptEnvelope.turnId
      });
    }

    await this.safeRecordEvent({
      threadId: attemptEnvelope.threadId,
      type: "retry_attempt",
      description: `Retry attempt ${attemptEnvelope.attemptId}`,
      actor: this.companionName,
      location: snapshot.position,
      snapshot,
      metadata: {
        envelope: attemptEnvelope
      }
    });
    this.emitRuntimeEvent("retry_started", {
      turnId: attemptEnvelope.turnId,
      attemptId: attemptEnvelope.attemptId,
      attemptIndex: attemptEnvelope.metadata.attemptIndex,
      retryDomain: attemptEnvelope.retryDomain,
      signature: attemptEnvelope.signature
    }, {
      turnId: attemptEnvelope.turnId,
      attemptId: attemptEnvelope.attemptId,
      retryDomain: attemptEnvelope.retryDomain,
      normalizedSignature: attemptEnvelope.signature?.signature || undefined
    });

    await this.safeRecordEvent({
      threadId: outcomeEnvelope.threadId,
      type: "retry_outcome",
      description: `Retry outcome ${outcomeEnvelope.terminalOutcome}`,
      actor: this.companionName,
      location: snapshot.position,
      snapshot,
      metadata: {
        envelope: outcomeEnvelope
      }
    });
  }

  maybeDistillAdventure() {
    if (this.summaryInFlight) {
      return this.summaryInFlight;
    }

    const unsummarizedChats = this.observedChatCount - this.lastSummaryObservedChatCount;

    if (unsummarizedChats < this.summaryInterval) {
      return Promise.resolve(null);
    }

    this.summaryInFlight = this.distillAdventure()
      .catch((error) => {
        this.logger.error("[memory] Adventure distillation failed:", error);
        return null;
      })
      .finally(() => {
        this.summaryInFlight = null;
      });

    return this.summaryInFlight;
  }

  async distillAdventure() {
    const worldContext = this.getWorldContext();
    const coveredObservedChatCount = this.observedChatCount;
    const identityProfile = this.getIdentityPromptProfile();
    const summaryContext = await buildAdventureSummaryContext({
      messageStore: this.messageStore,
      eventStore: this.eventStore,
      threadId: this.threadId,
      worldId: worldContext.worldId,
      companionName: identityProfile.displayName,
      primaryPlayer: this.primaryPlayer,
      summaryWindow: this.summaryWindow,
      summaryEventWindow: this.eventWindow * 2
    });

    if (!summaryContext.recentMessages.length) {
      this.lastSummaryObservedChatCount = coveredObservedChatCount;
      return null;
    }

    const { summary } = await this.llmClient.summarizeAdventure({
      systemPrompt: summaryContext.systemPrompt,
      userPrompt: summaryContext.userPrompt
    });

    if (!summary) {
      return null;
    }

    const snapshot = this.botAdapter.getSnapshot();
    const summaryEvent = await this.eventStore.recordEvent({
      threadId: this.threadId,
      worldId: worldContext.worldId,
      sessionId: worldContext.sessionId,
      type: "adventure_summary",
      description: summary,
      actor: this.companionName,
      location: snapshot.position,
      snapshot,
      metadata: {
        observedChatCount: coveredObservedChatCount,
        summaryWindow: this.summaryWindow,
        trigger: "periodic_distillation",
        llmProvider: this.llmProvider
      }
    });

    this.lastSummaryObservedChatCount = coveredObservedChatCount;
    return summaryEvent;
  }

  async handleTurnError(error, payload) {
    this.logger.error("[agent] Turn failed:", error);
    if (this.runtimeState.activeTask) {
      this.emitRuntimeEvent("task_failed", {
        taskId: this.runtimeState.activeTask.taskId,
        outcome: "failed",
        summary: error.message
      }, {
        turnId: this.activeTurnId || undefined
      });
    }
    this.setRuntimeState({
      activeTask: null,
      retryState: {
        ...this.runtimeState.retryState,
        activeTurnId: null,
        activeAttempt: null,
        lastOutcome: "failed"
      }
    });

    await this.safeRecordEvent({
      threadId: this.threadId,
      type: "turn_error",
      description: error.message,
      actor: this.companionName,
      location: this.botAdapter.getSnapshot().position,
      snapshot: this.botAdapter.getSnapshot(),
      metadata: {
        username: payload?.username,
        message: payload?.message
      }
    });

    try {
      await this.botAdapter.say("I lost the thread for a moment. Ask me again in a second.");
    } catch (chatError) {
      this.logger.error("[agent] Failed to send fallback chat:", chatError);
    }
  }

  async safeRecordEvent(event) {
    try {
      const worldContext = this.getWorldContext();
      await this.eventStore.recordEvent({
        worldId: worldContext.worldId,
        sessionId: worldContext.sessionId,
        ...event
      });
    } catch (error) {
      this.logger.error("[memory] Failed to record event:", error);
    }
  }

  async stop() {
    this.shuttingDown = true;
    this.readyForTurns = false;
    this.stopBackgroundLoops();
    this.setRuntimeState({
      lifecycle: "stopping",
      connectionHealth: "disconnected"
    });

    try {
      await this.safeRecordEvent({
        threadId: this.threadId,
        type: "session_end",
        description: `${this.companionName} disconnected`,
        actor: this.companionName,
        location: this.botAdapter.getSnapshot().position,
        snapshot: this.botAdapter.getSnapshot()
      });

      if (this.currentWorld?.world_id) {
        await this.jobStore.pauseRunningJobs(this.currentWorld.world_id);
      }

      if (this.currentSession?.session_id) {
        await this.sessionStore.endSession(this.currentSession.session_id);
      }
    } finally {
      await this.botAdapter.disconnect();
      await this.surrealClient.close();
      this.setRuntimeState({
        lifecycle: "stopped"
      });
    }
  }
}

module.exports = {
  AgentRuntime
};
