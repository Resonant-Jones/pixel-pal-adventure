import type { AnchorSummary } from "./anchors";
import type {
  RuntimeConfigRevisions,
  RuntimeLiveConfig,
  RuntimeStaticConfig
} from "./config";
import type { CompanionIdentity } from "./identity";

export type RuntimeLifecycleState =
  | "booting"
  | "starting"
  | "ready"
  | "paused"
  | "reconnecting"
  | "stopping"
  | "stopped"
  | "error";

export type ConnectionHealth = "healthy" | "degraded" | "disconnected";
export type RetryDomain = "llm" | "action" | "connection";
export type TerminalOutcome =
  | "succeeded"
  | "failed"
  | "interrupted"
  | "superseded"
  | "abandoned"
  | "non_retryable";

export interface NormalizedFailureSignature {
  retryDomain: RetryDomain;
  actionType: string;
  errorCode: string;
  provider?: string;
  operationSubtype?: string;
  signatureVersion?: string;
  signature: string;
}

export interface WorldSessionState {
  worldId: string | null;
  sessionId: string | null;
  serverAddress: string | null;
  dimension: string | null;
}

export interface TaskState {
  taskId: string;
  commandId?: string;
  turnId?: string;
  label: string;
  status: "queued" | "running" | "paused" | "interrupted";
  anchorId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RetryAttemptState {
  attemptId: string;
  turnId: string;
  commandId?: string;
  retryDomain: RetryDomain;
  attemptIndex: number;
  signature?: string;
  startedAt: string;
  lastUpdatedAt: string;
}

export interface RetryState {
  activeTurnId: string | null;
  activeAttempt: RetryAttemptState | null;
  loopDetected: boolean;
  lastOutcome: TerminalOutcome | null;
}

export interface ReconnectState {
  status: "idle" | "running" | "failed";
  attemptCount: number;
  maxAttempts: number;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastErrorCode: string | null;
}

export interface LearningEventSummary {
  retryDomain: RetryDomain;
  normalizedSignature: string;
  successCount: number;
  failureCount: number;
  latestTimestamp: string | null;
  summary: string;
}

export interface BuildStatusSummary {
  jobId: string | null;
  lane: "template" | "emergent" | null;
  state: "running" | "paused" | "pending" | "completed" | "failed" | null;
  progress: number | null;
  feedbackSummary: string | null;
  designReadiness: "not_executable" | "ready" | null;
}

export interface RuntimeState {
  lifecycle: RuntimeLifecycleState;
  world: WorldSessionState;
  liveConfig: RuntimeLiveConfig;
  staticConfig: RuntimeStaticConfig;
  identity: CompanionIdentity;
  activeAnchor: AnchorSummary | null;
  activeTask: TaskState | null;
  queuedTasks: TaskState[];
  interruptedTasks: TaskState[];
  retryState: RetryState;
  reconnectState: ReconnectState;
  connectionHealth: ConnectionHealth;
  revisions: RuntimeConfigRevisions;
  latestLearningSummary: LearningEventSummary | null;
  buildStatus: BuildStatusSummary | null;
  lastSequence: number;
  updatedAt: string;
}

export interface RuntimeSnapshot {
  snapshotVersion: string;
  lastSequence: number;
  state: RuntimeState;
}
