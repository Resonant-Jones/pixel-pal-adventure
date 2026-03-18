import type { CompanionIdentity } from "./identity";

export type AutonomyLevel = "guided" | "balanced" | "independent";
export type BehaviorMode = "careful" | "balanced" | "creative";
export type ToolPermissionMode = "restricted" | "standard" | "expanded";

export interface ChildFriendlyUiSettings {
  kidModeEnabled: boolean;
  largeTextEnabled: boolean;
  simplifiedStatusFeed: boolean;
}

export interface SafetyConstraints {
  allowDestructiveActions: boolean;
  allowAutoGiveBuildMaterials: boolean;
  requireConfirmationForRiskyActions: boolean;
}

export interface RuntimeLiveConfig {
  autonomyLevel: AutonomyLevel;
  verbosity: "quiet" | "balanced" | "detailed";
  behaviorMode: BehaviorMode;
  toolPermissions: ToolPermissionMode;
  followDistance: number;
  childFriendlyUi: ChildFriendlyUiSettings;
  safetyConstraints: SafetyConstraints;
  activeIdentityPreset: CompanionIdentity["personalityPreset"];
}

export interface RuntimeStaticConfig {
  threadId: string;
  primaryPlayer: string;
  llmProvider: string;
  minecraft: {
    host: string;
    port: number;
    username: string;
    version?: string;
    auth: string;
  };
  controlPlane: {
    host: string;
    port: number;
    authTokenLoaded: boolean;
  };
  startupOnly: {
    providerBootstrapConfigured: boolean;
    surrealConfigured: boolean;
  };
}

export interface RuntimeConfigRevisions {
  configRevision: number;
  identityRevision: number;
  profileRevision?: number | null;
}

export interface AgentConfigPatch {
  liveConfig?: Partial<RuntimeLiveConfig>;
  identity?: Partial<Omit<CompanionIdentity, "identityRevision" | "updatedAt">>;
  profileId?: string | null;
  profileName?: string;
  persistProfile?: boolean;
  expectedConfigRevision?: number;
  expectedIdentityRevision?: number;
  expectedProfileRevision?: number | null;
}

export interface ConfigApplyResult {
  applied: Partial<AgentConfigPatch>;
  rejected: Array<{
    path: string;
    reason: string;
    requiresRestart: boolean;
  }>;
  requiresRestart: string[];
  revisions: RuntimeConfigRevisions;
}
