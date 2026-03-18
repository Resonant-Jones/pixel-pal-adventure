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

function buildRuntimeConfig(env = process.env) {
  const primaryPlayer = env.PRIMARY_PLAYER || env.MC_PRIMARY_PLAYER || "Sage";
  const companionName = env.MC_BOT_USERNAME || env.COMPANION_NAME || "Guardian";
  const host = env.MC_HOST || "127.0.0.1";
  const port = parseNumber(env.MC_PORT, 25565);

  return {
    primaryPlayer,
    companionName,
    companionRole: env.COMPANION_ROLE || "AI companion for Sage",
    companionPersonality:
      env.COMPANION_PERSONALITY ||
      "Warm, observant, concise, practical, and grounded in the Minecraft world.",
    threadId:
      env.MC_THREAD_ID || `minecraft:${host}:${port}:${primaryPlayer.toLowerCase().replace(/\s+/g, "-")}`,
    memoryWindow: parseNumber(env.AGENT_MEMORY_WINDOW, 12),
    eventWindow: parseNumber(env.AGENT_EVENT_WINDOW, 6),
    summaryInterval: parseNumber(env.AGENT_SUMMARY_INTERVAL, 24),
    summaryWindow: parseNumber(env.AGENT_SUMMARY_WINDOW, 24),
    summaryContextLimit: parseNumber(env.AGENT_SUMMARY_CONTEXT_LIMIT, 3),
    maxPendingTurns: parseNumber(env.AGENT_MAX_PENDING_TURNS, 4),
    reflexObservationIntervalMs: parseNumber(env.AGENT_REFLEX_INTERVAL_MS, 5000),
    reflexWorkerIntervalMs: parseNumber(env.AGENT_REFLEX_WORKER_INTERVAL_MS, 1000),
    buildWorkerIntervalMs: parseNumber(env.AGENT_BUILD_WORKER_INTERVAL_MS, 1000),
    reflexGlobalCooldownMs: parseNumber(env.AGENT_REFLEX_GLOBAL_COOLDOWN_MS, 60000),
    reflexTriggerCooldownMs: parseNumber(env.AGENT_REFLEX_TRIGGER_COOLDOWN_MS, 180000),
    reflexIdleThresholdMs: parseNumber(env.AGENT_REFLEX_IDLE_THRESHOLD_MS, 90000),
    allowAutoGiveBuildMaterials: parseBoolean(env.ALLOW_AUTO_GIVE_BUILD_MATERIALS, false),
    debugBuildPlans: parseBoolean(env.AGENT_BUILD_DEBUG, false),
    respondToAllPlayers: parseBoolean(env.MC_RESPOND_TO_ALL, false),
    minecraft: {
      host,
      port,
      username: companionName,
      version: env.MC_VERSION || undefined,
      auth: env.MC_AUTH || "offline",
      primaryPlayer,
      followDistance: parseNumber(env.MC_FOLLOW_DISTANCE, 2)
    },
    retry: {
      maxAttempts: parseNumber(env.AGENT_RETRY_MAX_ATTEMPTS, 3),
      baseDelayMs: parseNumber(env.AGENT_RETRY_BASE_DELAY_MS, 500),
      maxDelayMs: parseNumber(env.AGENT_RETRY_MAX_DELAY_MS, 5000),
      jitter: parseNumber(env.AGENT_RETRY_JITTER, 0.25),
      graphFromAttempt: parseNumber(env.AGENT_RETRY_GRAPH_FROM_ATTEMPT, 2),
      loopThreshold: parseNumber(env.AGENT_RETRY_LOOP_THRESHOLD, 3)
    },
    reconnect: {
      maxAttempts: parseNumber(env.MC_RECONNECT_MAX_ATTEMPTS, 5),
      baseDelayMs: parseNumber(env.MC_RECONNECT_BASE_DELAY_MS, 1000),
      maxDelayMs: parseNumber(env.MC_RECONNECT_MAX_DELAY_MS, 15000),
      jitter: parseNumber(env.MC_RECONNECT_JITTER, 0.25)
    },
    controlPlane: {
      host: env.GUARDIAN_CONTROL_HOST || "127.0.0.1",
      port: parseNumber(env.GUARDIAN_CONTROL_PORT, 8787),
      token: env.GUARDIAN_CONTROL_TOKEN || crypto.randomUUID()
    }
  };
}

async function main() {
  const runtimeConfig = buildRuntimeConfig();
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
