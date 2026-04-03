const crypto = require("crypto");

function nowIso() {
  return new Date().toISOString();
}

function createDefaultIdentity({
  displayName = "Guardian",
  personalityPreset = "friendly_builder"
} = {}) {
  return {
    displayName,
    avatarIconId: "guardian-default",
    personalityPreset,
    toneIntensity: 0.5,
    chatVerbosity: "balanced",
    identityRevision: 1,
    updatedAt: nowIso()
  };
}

function createRuntimeState({
  threadId,
  primaryPlayer,
  llmProvider,
  companionName = "Guardian",
  minecraft = {},
  controlPlane = {}
}) {
  return {
    lifecycle: "booting",
    world: {
      worldId: null,
      sessionId: null,
      serverAddress: minecraft.host ? `${minecraft.host}:${minecraft.port || 25565}` : null,
      dimension: null
    },
    liveConfig: {
      autonomyLevel: "balanced",
      verbosity: "balanced",
      behaviorMode: "balanced",
      toolPermissions: "standard",
      followDistance: Number(minecraft.followDistance || 2),
      buildMode: "hybrid",
      narrativeReflexEnabled: false,
      highSalienceOnly: true,
      allowMutationDuringBuild: false,
      childFriendlyUi: {
        kidModeEnabled: true,
        largeTextEnabled: true,
        simplifiedStatusFeed: true
      },
      safetyConstraints: {
        allowDestructiveActions: false,
        allowAutoGiveBuildMaterials: false,
        requireConfirmationForRiskyActions: true
      },
      activeIdentityPreset: "friendly_builder"
    },
    staticConfig: {
      threadId,
      primaryPlayer,
      llmProvider,
      minecraft: {
        host: minecraft.host || "127.0.0.1",
        port: Number(minecraft.port || 25565),
        username: minecraft.username || companionName,
        version: minecraft.version,
        auth: minecraft.auth || "offline"
      },
      controlPlane: {
        host: controlPlane.host || "127.0.0.1",
        port: Number(controlPlane.port || 8787),
        authTokenLoaded: Boolean(controlPlane.authTokenLoaded)
      },
      startupOnly: {
        providerBootstrapConfigured: Boolean(llmProvider),
        surrealConfigured: false
      }
    },
    identity: createDefaultIdentity({
      displayName: companionName,
      personalityPreset: "friendly_builder"
    }),
    activeAnchor: null,
    activeTask: null,
    queuedTasks: [],
    interruptedTasks: [],
    retryState: {
      activeTurnId: null,
      activeAttempt: null,
      loopDetected: false,
      lastOutcome: null
    },
    buildStatus: null,
    reconnectState: {
      status: "idle",
      attemptCount: 0,
      maxAttempts: 5,
      lastStartedAt: null,
      lastCompletedAt: null,
      lastErrorCode: null
    },
    connectionHealth: "disconnected",
    revisions: {
      configRevision: 1,
      identityRevision: 1,
      profileRevision: null
    },
    latestLearningSummary: null,
    lastSequence: 0,
    updatedAt: nowIso()
  };
}

function cloneState(state) {
  return structuredClone(state);
}

function updateRuntimeState(state, patch = {}) {
  const next = {
    ...state,
    ...patch,
    updatedAt: patch.updatedAt || nowIso()
  };

  if (patch.world) {
    next.world = {
      ...state.world,
      ...patch.world
    };
  }

  if (patch.liveConfig) {
    next.liveConfig = {
      ...state.liveConfig,
      ...patch.liveConfig
    };
  }

  if (patch.staticConfig) {
    next.staticConfig = {
      ...state.staticConfig,
      ...patch.staticConfig
    };
  }

  if (patch.identity) {
    next.identity = {
      ...state.identity,
      ...patch.identity,
      updatedAt: patch.identity.updatedAt || nowIso()
    };
  }

  if (patch.retryState) {
    next.retryState = {
      ...state.retryState,
      ...patch.retryState
    };
  }

  if (patch.reconnectState) {
    next.reconnectState = {
      ...state.reconnectState,
      ...patch.reconnectState
    };
  }

  if (patch.revisions) {
    next.revisions = {
      ...state.revisions,
      ...patch.revisions
    };
  }

  return next;
}

function createTaskState({ label, commandId = null, turnId = null, anchorId = null, status = "queued" }) {
  const timestamp = nowIso();
  return {
    taskId: crypto.randomUUID(),
    commandId,
    turnId,
    label,
    status,
    anchorId,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

module.exports = {
  cloneState,
  createDefaultIdentity,
  createRuntimeState,
  createTaskState,
  nowIso,
  updateRuntimeState
};
