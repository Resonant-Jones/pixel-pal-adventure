#!/usr/bin/env node

require("dotenv").config();

const crypto = require("crypto");

const { AgentRuntime } = require("../agent/agentRuntime");
const { ActionExecutor } = require("../agent/actionExecutor");
const { MiniMaxClient } = require("../ai/minimaxClient");
const { GroqClient } = require("../ai/groqClient");
const { OllamaClient } = require("../ai/ollamaClient");
const { LocalControlServer } = require("../control/localControlServer");
const { RuntimeEventBus } = require("../control/runtimeEventBus");
const { getMiniMaxConfig, validateMiniMaxConfig } = require("../config/minimax");
const { getGroqConfig, validateGroqConfig } = require("../config/groq");
const { getOllamaConfig, validateOllamaConfig } = require("../config/ollama");
const { getSurrealConfig, validateSurrealConfig } = require("../config/surreal");
const { AnchorStore } = require("../memory/anchorStore");
const { CompanionIdentityStore } = require("../memory/companionIdentityStore");
const { EventStore } = require("../memory/eventStore");
const { JobStore } = require("../memory/jobStore");
const { LearningStore } = require("../memory/learningStore");
const { MessageStore } = require("../memory/messageStore");
const { ProfileStore } = require("../memory/profileStore");
const { ReflexStateStore } = require("../memory/reflexStateStore");
const { SessionStore } = require("../memory/sessionStore");
const { SurrealClient } = require("../memory/surrealClient");
const { WorldStore } = require("../memory/worldStore");
const { MinecraftBotAdapter } = require("../minecraft/bot");
const { loadOrCreateManifest, resolveEffectiveSettings } = require("./loadSettingsManifest");

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return String(value).toLowerCase() === "true";
}

function normalizeProvider(value) {
  if (!value) {
    return "minimax";
  }

  return String(value).trim().toLowerCase();
}

function buildLlmClient(env = process.env) {
  const provider = normalizeProvider(env.LLM_PROVIDER);

  if (provider === "minimax") {
    const minimaxConfig = getMiniMaxConfig(env);
    validateMiniMaxConfig(minimaxConfig);
    return {
      provider,
      client: new MiniMaxClient(minimaxConfig)
    };
  }

  if (provider === "groq") {
    const groqConfig = getGroqConfig(env);
    validateGroqConfig(groqConfig);
    return {
      provider,
      client: new GroqClient(groqConfig)
    };
  }

  if (provider === "ollama") {
    const ollamaConfig = getOllamaConfig(env);
    validateOllamaConfig(ollamaConfig);
    return {
      provider,
      client: new OllamaClient(ollamaConfig)
    };
  }

  throw new Error(`Unsupported LLM_PROVIDER "${provider}". Use "minimax", "groq", or "ollama".`);
}

function buildRuntimeConfig(effectiveSettings, env = process.env) {
  const host = effectiveSettings.minecraft.host;
  const port = effectiveSettings.minecraft.port;
  const primaryPlayer = effectiveSettings.primaryPlayer;

  return {
    primaryPlayer,
    companionName: effectiveSettings.companionName,
    companionRole: effectiveSettings.companionRole,
    companionPersonality: effectiveSettings.companionPersonality,
    threadId:
      env.MC_THREAD_ID || `minecraft:${host}:${port}:${primaryPlayer.toLowerCase().replace(/\s+/g, "-")}`,
    memoryWindow: effectiveSettings.agent.memoryWindow,
    eventWindow: effectiveSettings.agent.eventWindow,
    summaryInterval: effectiveSettings.agent.summaryInterval,
    summaryWindow: effectiveSettings.agent.summaryWindow,
    summaryContextLimit: effectiveSettings.agent.summaryContextLimit,
    maxPendingTurns: effectiveSettings.agent.maxPendingTurns,
    reflexObservationIntervalMs: effectiveSettings.agent.reflexObservationIntervalMs,
    reflexWorkerIntervalMs: effectiveSettings.agent.reflexWorkerIntervalMs,
    buildWorkerIntervalMs: effectiveSettings.agent.buildWorkerIntervalMs,
    reflexGlobalCooldownMs: effectiveSettings.agent.reflexGlobalCooldownMs,
    reflexTriggerCooldownMs: effectiveSettings.agent.reflexTriggerCooldownMs,
    reflexIdleThresholdMs: effectiveSettings.agent.reflexIdleThresholdMs,
    allowAutoGiveBuildMaterials: effectiveSettings.agent.allowAutoGiveBuildMaterials,
    debugBuildPlans: effectiveSettings.agent.debugBuildPlans,
    respondToAllPlayers: effectiveSettings.minecraft.respondToAllPlayers,
    minecraft: {
      host,
      port,
      username: effectiveSettings.companionName,
      version: effectiveSettings.minecraft.version,
      auth: effectiveSettings.minecraft.auth,
      primaryPlayer,
      followDistance: effectiveSettings.minecraft.followDistance
    },
    retry: {
      maxAttempts: effectiveSettings.retry.maxAttempts,
      baseDelayMs: effectiveSettings.retry.baseDelayMs,
      maxDelayMs: effectiveSettings.retry.maxDelayMs,
      jitter: effectiveSettings.retry.jitter,
      graphFromAttempt: effectiveSettings.retry.graphFromAttempt,
      loopThreshold: effectiveSettings.retry.loopThreshold
    },
    reconnect: {
      maxAttempts: effectiveSettings.reconnect.maxAttempts,
      baseDelayMs: effectiveSettings.reconnect.baseDelayMs,
      maxDelayMs: effectiveSettings.reconnect.maxDelayMs,
      jitter: effectiveSettings.reconnect.jitter
    },
    controlPlane: {
      host: env.GUARDIAN_CONTROL_HOST || "127.0.0.1",
      port: parseNumber(env.GUARDIAN_CONTROL_PORT, 8787),
      token: env.GUARDIAN_CONTROL_TOKEN || crypto.randomUUID()
    }
  };
}

async function main() {
  const manifest = loadOrCreateManifest();
  const requestedProfileId = process.env.GUARDIAN_PROFILE || null;
  const effectiveSettings = resolveEffectiveSettings(manifest, requestedProfileId);

  console.log(`[settings] Using profile: ${effectiveSettings.activeProfileName || effectiveSettings.activeProfileId}`);
  console.log(`[settings] Merged from: ${effectiveSettings.mergedFrom.join(" -> ")}`);

  const runtimeConfig = buildRuntimeConfig(effectiveSettings);
  process.env.GUARDIAN_CONTROL_HOST = runtimeConfig.controlPlane.host;
  process.env.GUARDIAN_CONTROL_PORT = String(runtimeConfig.controlPlane.port);
  process.env.GUARDIAN_CONTROL_TOKEN = runtimeConfig.controlPlane.token;
  const surrealConfig = getSurrealConfig();

  validateSurrealConfig(surrealConfig);

  const { provider: llmProvider, client: llmClient } = buildLlmClient();

  const surrealClient = new SurrealClient(surrealConfig);
  const anchorStore = new AnchorStore(surrealClient);
  const companionIdentityStore = new CompanionIdentityStore(surrealClient);
  const messageStore = new MessageStore(surrealClient);
  const eventStore = new EventStore(surrealClient);
  const learningStore = new LearningStore(surrealClient);
  const profileStore = new ProfileStore(surrealClient);
  const worldStore = new WorldStore(surrealClient);
  const sessionStore = new SessionStore(surrealClient);
  const jobStore = new JobStore(surrealClient);
  const reflexStateStore = new ReflexStateStore(surrealClient);
  const botAdapter = new MinecraftBotAdapter(runtimeConfig.minecraft);
  let runtime = null;
  const actionExecutor = new ActionExecutor({
    botAdapter,
    jobStore,
    getWorldContext: () => ({
      worldId: runtime?.getWorldContext().worldId || null,
      sessionId: runtime?.getWorldContext().sessionId || null,
      threadId: runtimeConfig.threadId
    }),
    isBuildMutationAllowed: () => Boolean(runtime?.getRuntimeState()?.liveConfig?.allowMutationDuringBuild),
    primaryPlayer: runtimeConfig.primaryPlayer,
    companionName: runtimeConfig.companionName,
    allowAutoGiveBuildMaterials: runtimeConfig.allowAutoGiveBuildMaterials,
    debugBuildPlans: runtimeConfig.debugBuildPlans
  });

  runtime = new AgentRuntime({
    botAdapter,
    messageStore,
    eventStore,
    worldStore,
    sessionStore,
    jobStore,
    reflexStateStore,
    companionIdentityStore,
    anchorStore,
    profileStore,
    learningStore,
    llmClient,
    actionExecutor,
    surrealClient,
    threadId: runtimeConfig.threadId,
    primaryPlayer: runtimeConfig.primaryPlayer,
    companionName: runtimeConfig.companionName,
    companionRole: runtimeConfig.companionRole,
    companionPersonality: runtimeConfig.companionPersonality,
    memoryWindow: runtimeConfig.memoryWindow,
    eventWindow: runtimeConfig.eventWindow,
    summaryInterval: runtimeConfig.summaryInterval,
    summaryWindow: runtimeConfig.summaryWindow,
    summaryContextLimit: runtimeConfig.summaryContextLimit,
    maxPendingTurns: runtimeConfig.maxPendingTurns,
    reflexObservationIntervalMs: runtimeConfig.reflexObservationIntervalMs,
    reflexWorkerIntervalMs: runtimeConfig.reflexWorkerIntervalMs,
    buildWorkerIntervalMs: runtimeConfig.buildWorkerIntervalMs,
    reflexGlobalCooldownMs: runtimeConfig.reflexGlobalCooldownMs,
    reflexTriggerCooldownMs: runtimeConfig.reflexTriggerCooldownMs,
    reflexIdleThresholdMs: runtimeConfig.reflexIdleThresholdMs,
    allowAutoGiveBuildMaterials: runtimeConfig.allowAutoGiveBuildMaterials,
    debugBuildPlans: runtimeConfig.debugBuildPlans,
    respondToAllPlayers: runtimeConfig.respondToAllPlayers,
    llmProvider,
    retryConfig: runtimeConfig.retry,
    reconnectConfig: runtimeConfig.reconnect
  });
  const eventBus = new RuntimeEventBus({
    getSnapshotVersion: () => runtime?.stateProjector?.snapshotVersion || null
  });
  runtime.attachRuntimeEventBus(eventBus);
  const controlServer = new LocalControlServer({
    runtime,
    eventBus,
    host: runtimeConfig.controlPlane.host,
    port: runtimeConfig.controlPlane.port,
    authToken: runtimeConfig.controlPlane.token
  });

  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log(`[agent] ${signal} received, shutting down Guardian.`);
    await controlServer.close();
    await runtime.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  await controlServer.listen();
  await runtime.start();
  controlServer.markReady();

  console.log(
    `[agent] ${runtimeConfig.companionName} online on ${runtimeConfig.minecraft.host}:${runtimeConfig.minecraft.port} (${llmProvider})`
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[agent] Failed to start:", error);
    process.exit(1);
  });
}
