export interface StartupBaseSettings {
  primaryPlayer: string;
  companionName: string;
  companionRole: string;
  companionPersonality: string;
  llmProvider: "minimax" | "groq" | "ollama";
  minecraft: {
    host: string;
    port: number;
    auth: string;
    version?: string;
    followDistance: number;
    respondToAllPlayers: boolean;
  };
  agent: {
    memoryWindow: number;
    eventWindow: number;
    summaryInterval: number;
    summaryWindow: number;
    summaryContextLimit: number;
    maxPendingTurns: number;
    reflexObservationIntervalMs: number;
    reflexWorkerIntervalMs: number;
    buildWorkerIntervalMs: number;
    reflexGlobalCooldownMs: number;
    reflexTriggerCooldownMs: number;
    reflexIdleThresholdMs: number;
    allowAutoGiveBuildMaterials: boolean;
    debugBuildPlans: boolean;
  };
  retry: {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    jitter: number;
    graphFromAttempt: number;
    loopThreshold: number;
  };
  reconnect: {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    jitter: number;
  };
}

export interface LaunchProfile {
  id: string;
  name: string;
  description?: string;
  isDefault?: boolean;
  overrides: Partial<StartupBaseSettings>;
  createdAt: string;
  updatedAt: string;
}

export interface StartupSettingsManifest {
  version: string;
  activeProfileId: string | null;
  profiles: LaunchProfile[];
  baseSettings: StartupBaseSettings;
  lastMergedAt: string;
}

export interface EffectiveStartupSettings extends StartupBaseSettings {
  activeProfileId: string | null;
  activeProfileName: string | null;
  mergedFrom: ("defaults" | "manifest" | "profile" | "env")[];
}

export interface StartupSecrets {
  minimaxApiKey?: string;
  groqApiKey?: string;
  ollamaApiKey?: string;
  surrealPassword?: string;
}

export interface SettingsValidationResult {
  valid: boolean;
  errors: Array<{
    path: string;
    message: string;
  }>;
  warnings: Array<{
    path: string;
    message: string;
  }>;
}

export interface ShellRuntimeStatus {
  running: boolean;
  profileId: string | null;
  profileName: string | null;
  uptimeMs: number | null;
  pid: number | null;
}

export const CODE_DEFAULTS: StartupBaseSettings = {
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