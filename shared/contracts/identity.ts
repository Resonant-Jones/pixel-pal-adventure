export type PersonalityPreset =
  | "friendly_builder"
  | "brave_explorer"
  | "calm_teacher"
  | "funny_helper"
  | "quiet_genius";

export type ChatVerbosity = "quiet" | "balanced" | "talkative";

export interface CompanionIdentity {
  displayName: string;
  avatarIconId: string;
  personalityPreset: PersonalityPreset;
  toneIntensity: number;
  chatVerbosity: ChatVerbosity;
  identityRevision: number;
  updatedAt: string;
}

export interface IdentityProfile {
  id: string;
  name: string;
  identity: CompanionIdentity;
  createdAt: string;
  updatedAt: string;
}
