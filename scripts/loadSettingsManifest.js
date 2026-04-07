const fs = require("fs");
const path = require("path");

const MANIFEST_FILENAME = "guardian-shell.settings.json";
const LOCAL_DIR = ".local";
const MANIFEST_PATH = path.join(LOCAL_DIR, MANIFEST_FILENAME);

const CODE_DEFAULTS = {
  primaryPlayer: "Sage",
  companionName: "Guardian",
  companionRole: "AI companion",
  companionPersonality: "Warm, observant, concise, practical, and grounded in the Minecraft world.",
  llmProvider: "groq",
  minecraft: {
    host: "127.0.0.1",
    port: 25565,
    auth: "offline",
    followDistance: 2,
    respondToAllPlayers: false
  },
  agent: {
    memoryWindow: 12,
    eventWindow: 6,
    summaryInterval: 24,
    summaryWindow: 24,
    summaryContextLimit: 3,
    maxPendingTurns: 4,
    reflexObservationIntervalMs: 5000,
    reflexWorkerIntervalMs: 1000,
    buildWorkerIntervalMs: 1000,
    reflexGlobalCooldownMs: 60000,
    reflexTriggerCooldownMs: 180000,
    reflexIdleThresholdMs: 90000,
    allowAutoGiveBuildMaterials: false,
    debugBuildPlans: false
  },
  retry: {
    maxAttempts: 3,
    baseDelayMs: 500,
    maxDelayMs: 5000,
    jitter: 0.25,
    graphFromAttempt: 2,
    loopThreshold: 3
  },
  reconnect: {
    maxAttempts: 5,
    baseDelayMs: 1000,
    maxDelayMs: 15000,
    jitter: 0.25
  }
};

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] !== null && typeof source[key] === "object" && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}

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
    return "groq";
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "minimax" || normalized === "groq" || normalized === "ollama") {
    return normalized;
  }
  return "groq";
}

function migrateFromEnv(env = process.env) {
  const baseSettings = {
    primaryPlayer: env.PRIMARY_PLAYER || env.MC_PRIMARY_PLAYER || CODE_DEFAULTS.primaryPlayer,
    companionName: env.MC_BOT_USERNAME || env.COMPANION_NAME || CODE_DEFAULTS.companionName,
    companionRole: env.COMPANION_ROLE || CODE_DEFAULTS.companionRole,
    companionPersonality: env.COMPANION_PERSONALITY || CODE_DEFAULTS.companionPersonality,
    llmProvider: normalizeProvider(env.LLM_PROVIDER),
    minecraft: {
      host: env.MC_HOST || CODE_DEFAULTS.minecraft.host,
      port: parseNumber(env.MC_PORT, CODE_DEFAULTS.minecraft.port),
      auth: env.MC_AUTH || CODE_DEFAULTS.minecraft.auth,
      version: env.MC_VERSION || undefined,
      followDistance: parseNumber(env.MC_FOLLOW_DISTANCE, CODE_DEFAULTS.minecraft.followDistance),
      respondToAllPlayers: parseBoolean(env.MC_RESPOND_TO_ALL, CODE_DEFAULTS.minecraft.respondToAllPlayers)
    },
    agent: {
      memoryWindow: parseNumber(env.AGENT_MEMORY_WINDOW, CODE_DEFAULTS.agent.memoryWindow),
      eventWindow: parseNumber(env.AGENT_EVENT_WINDOW, CODE_DEFAULTS.agent.eventWindow),
      summaryInterval: parseNumber(env.AGENT_SUMMARY_INTERVAL, CODE_DEFAULTS.agent.summaryInterval),
      summaryWindow: parseNumber(env.AGENT_SUMMARY_WINDOW, CODE_DEFAULTS.agent.summaryWindow),
      summaryContextLimit: parseNumber(env.AGENT_SUMMARY_CONTEXT_LIMIT, CODE_DEFAULTS.agent.summaryContextLimit),
      maxPendingTurns: parseNumber(env.AGENT_MAX_PENDING_TURNS, CODE_DEFAULTS.agent.maxPendingTurns),
      reflexObservationIntervalMs: parseNumber(env.AGENT_REFLEX_INTERVAL_MS, CODE_DEFAULTS.agent.reflexObservationIntervalMs),
      reflexWorkerIntervalMs: parseNumber(env.AGENT_REFLEX_WORKER_INTERVAL_MS, CODE_DEFAULTS.agent.reflexWorkerIntervalMs),
      buildWorkerIntervalMs: parseNumber(env.AGENT_BUILD_WORKER_INTERVAL_MS, CODE_DEFAULTS.agent.buildWorkerIntervalMs),
      reflexGlobalCooldownMs: parseNumber(env.AGENT_REFLEX_GLOBAL_COOLDOWN_MS, CODE_DEFAULTS.agent.reflexGlobalCooldownMs),
      reflexTriggerCooldownMs: parseNumber(env.AGENT_REFLEX_TRIGGER_COOLDOWN_MS, CODE_DEFAULTS.agent.reflexTriggerCooldownMs),
      reflexIdleThresholdMs: parseNumber(env.AGENT_REFLEX_IDLE_THRESHOLD_MS, CODE_DEFAULTS.agent.reflexIdleThresholdMs),
      allowAutoGiveBuildMaterials: parseBoolean(env.ALLOW_AUTO_GIVE_BUILD_MATERIALS, CODE_DEFAULTS.agent.allowAutoGiveBuildMaterials),
      debugBuildPlans: parseBoolean(env.AGENT_BUILD_DEBUG, CODE_DEFAULTS.agent.debugBuildPlans)
    },
    retry: {
      maxAttempts: parseNumber(env.AGENT_RETRY_MAX_ATTEMPTS, CODE_DEFAULTS.retry.maxAttempts),
      baseDelayMs: parseNumber(env.AGENT_RETRY_BASE_DELAY_MS, CODE_DEFAULTS.retry.baseDelayMs),
      maxDelayMs: parseNumber(env.AGENT_RETRY_MAX_DELAY_MS, CODE_DEFAULTS.retry.maxDelayMs),
      jitter: parseNumber(env.AGENT_RETRY_JITTER, CODE_DEFAULTS.retry.jitter),
      graphFromAttempt: parseNumber(env.AGENT_RETRY_GRAPH_FROM_ATTEMPT, CODE_DEFAULTS.retry.graphFromAttempt),
      loopThreshold: parseNumber(env.AGENT_RETRY_LOOP_THRESHOLD, CODE_DEFAULTS.retry.loopThreshold)
    },
    reconnect: {
      maxAttempts: parseNumber(env.MC_RECONNECT_MAX_ATTEMPTS, CODE_DEFAULTS.reconnect.maxAttempts),
      baseDelayMs: parseNumber(env.MC_RECONNECT_BASE_DELAY_MS, CODE_DEFAULTS.reconnect.baseDelayMs),
      maxDelayMs: parseNumber(env.MC_RECONNECT_MAX_DELAY_MS, CODE_DEFAULTS.reconnect.maxDelayMs),
      jitter: parseNumber(env.MC_RECONNECT_JITTER, CODE_DEFAULTS.reconnect.jitter)
    }
  };

  const defaultProfile = {
    id: "default",
    name: "Default",
    description: "Default launch profile",
    isDefault: true,
    overrides: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  return {
    version: "1.0.0",
    activeProfileId: "default",
    profiles: [defaultProfile],
    baseSettings,
    lastMergedAt: new Date().toISOString()
  };
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return null;
  }
  try {
    const content = fs.readFileSync(MANIFEST_PATH, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error(`[settings] Failed to parse manifest at ${MANIFEST_PATH}:`, error.message);
    return null;
  }
}

function saveManifest(manifest) {
  if (!fs.existsSync(LOCAL_DIR)) {
    fs.mkdirSync(LOCAL_DIR, { recursive: true });
  }
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf-8");
}

function applyEnvOverrides(settings, env = process.env) {
  const overrides = {};

  if (env.PRIMARY_PLAYER || env.MC_PRIMARY_PLAYER) {
    overrides.primaryPlayer = env.PRIMARY_PLAYER || env.MC_PRIMARY_PLAYER;
  }
  if (env.MC_BOT_USERNAME || env.COMPANION_NAME) {
    overrides.companionName = env.MC_BOT_USERNAME || env.COMPANION_NAME;
  }
  if (env.LLM_PROVIDER) {
    overrides.llmProvider = normalizeProvider(env.LLM_PROVIDER);
  }
  if (env.MC_HOST) {
    overrides.minecraft = { ...settings.minecraft, host: env.MC_HOST };
  }
  if (env.MC_PORT) {
    overrides.minecraft = { ...settings.minecraft, port: parseNumber(env.MC_PORT, settings.minecraft.port) };
  }
  if (env.MC_AUTH) {
    overrides.minecraft = { ...settings.minecraft, auth: env.MC_AUTH };
  }
  if (env.MC_FOLLOW_DISTANCE) {
    overrides.minecraft = { ...settings.minecraft, followDistance: parseNumber(env.MC_FOLLOW_DISTANCE, settings.minecraft.followDistance) };
  }
  if (env.MC_RESPOND_TO_ALL) {
    overrides.minecraft = { ...settings.minecraft, respondToAllPlayers: parseBoolean(env.MC_RESPOND_TO_ALL) };
  }
  if (env.AGENT_MEMORY_WINDOW) {
    overrides.agent = { ...settings.agent, memoryWindow: parseNumber(env.AGENT_MEMORY_WINDOW, settings.agent.memoryWindow) };
  }
  if (env.AGENT_EVENT_WINDOW) {
    overrides.agent = { ...(overrides.agent || settings.agent), eventWindow: parseNumber(env.AGENT_EVENT_WINDOW, settings.agent.eventWindow) };
  }
  if (env.AGENT_MAX_PENDING_TURNS) {
    overrides.agent = { ...(overrides.agent || settings.agent), maxPendingTurns: parseNumber(env.AGENT_MAX_PENDING_TURNS, settings.agent.maxPendingTurns) };
  }

  return deepMerge(settings, overrides);
}

function resolveEffectiveSettings(manifest, requestedProfileId = null, env = process.env) {
  const mergedFrom = ["defaults"];
  let settings = deepMerge({}, CODE_DEFAULTS);

  if (manifest) {
    settings = deepMerge(settings, manifest.baseSettings);
    mergedFrom.push("manifest");
  }

  const profileId = requestedProfileId || manifest?.activeProfileId || env.GUARDIAN_PROFILE || "default";
  const profile = manifest?.profiles?.find((p) => p.id === profileId);

  if (profile) {
    settings = deepMerge(settings, profile.overrides);
    mergedFrom.push("profile");
  }

  const hasEnvOverrides = env.PRIMARY_PLAYER || env.MC_PRIMARY_PLAYER || env.MC_BOT_USERNAME ||
    env.COMPANION_NAME || env.LLM_PROVIDER || env.MC_HOST || env.MC_PORT || env.MC_AUTH ||
    env.MC_FOLLOW_DISTANCE || env.MC_RESPOND_TO_ALL || env.AGENT_MEMORY_WINDOW ||
    env.AGENT_EVENT_WINDOW || env.AGENT_MAX_PENDING_TURNS;

  if (hasEnvOverrides) {
    settings = applyEnvOverrides(settings, env);
    mergedFrom.push("env");
  }

  return {
    ...settings,
    activeProfileId: profileId,
    activeProfileName: profile?.name || null,
    mergedFrom
  };
}

function loadOrCreateManifest(env = process.env) {
  const manifest = loadManifest();

  if (manifest) {
    return manifest;
  }

  console.log("[settings] No manifest found, migrating from .env...");
  const migrated = migrateFromEnv(env);
  saveManifest(migrated);
  console.log(`[settings] Migrated settings to ${MANIFEST_PATH}`);
  return migrated;
}

function validateManifest(manifest) {
  const errors = [];
  const warnings = [];

  if (!manifest.version) {
    errors.push({ path: "version", message: "Manifest version is required" });
  }

  if (!manifest.baseSettings) {
    errors.push({ path: "baseSettings", message: "Base settings are required" });
  }

  if (manifest.baseSettings) {
    if (!manifest.baseSettings.primaryPlayer) {
      errors.push({ path: "baseSettings.primaryPlayer", message: "Primary player is required" });
    }
    if (!manifest.baseSettings.companionName) {
      errors.push({ path: "baseSettings.companionName", message: "Companion name is required" });
    }
    if (!["minimax", "groq", "ollama"].includes(manifest.baseSettings.llmProvider)) {
      errors.push({ path: "baseSettings.llmProvider", message: "LLM provider must be minimax, groq, or ollama" });
    }
  }

  if (manifest.activeProfileId && !manifest.profiles?.find((p) => p.id === manifest.activeProfileId)) {
    warnings.push({ path: "activeProfileId", message: `Active profile "${manifest.activeProfileId}" not found in profiles list` });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

function getSecretFieldsFromEnv(env = process.env) {
  return {
    minimaxApiKey: env.MINIMAX_API_KEY || "",
    groqApiKey: env.GROQ_API_KEY || "",
    ollamaApiKey: env.OLLAMA_API_KEY || "",
    surrealPassword: env.SURREAL_PASSWORD || ""
  };
}

function mergeSecrets(existing, updates) {
  const result = { ...existing };
  for (const key of Object.keys(updates)) {
    if (updates[key] !== "" && updates[key] !== null && updates[key] !== undefined) {
      result[key] = updates[key];
    }
  }
  return result;
}

module.exports = {
  CODE_DEFAULTS,
  MANIFEST_PATH,
  LOCAL_DIR,
  loadOrCreateManifest,
  loadManifest,
  saveManifest,
  resolveEffectiveSettings,
  validateManifest,
  getSecretFieldsFromEnv,
  mergeSecrets,
  deepMerge
};
