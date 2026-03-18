import type { ConfigApplyResult } from "./config";
import type {
  LearningEventSummary,
  NormalizedFailureSignature,
  RetryDomain,
  RuntimeSnapshot,
  RuntimeState,
  TerminalOutcome
} from "./runtime";

export interface RuntimeEventEnvelope {
  eventId: string;
  sequence: number;
  timestamp: string;
  correlationId?: string;
  turnId?: string;
  attemptId?: string;
  retryDomain?: RetryDomain;
  normalizedSignature?: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeSnapshotEvent extends RuntimeEventEnvelope {
  type: "runtime_snapshot";
  payload: RuntimeSnapshot;
}

export interface RuntimeStateChangedEvent extends RuntimeEventEnvelope {
  type: "runtime_state_changed";
  payload: {
    state: RuntimeState;
  };
}

export interface RuntimeHeartbeatEvent extends RuntimeEventEnvelope {
  type: "runtime_heartbeat";
  payload: {
    snapshotVersion: string;
    lastSequence: number;
    connectionHealth: RuntimeState["connectionHealth"];
  };
}

export interface ConfigAppliedEvent extends RuntimeEventEnvelope {
  type: "config_applied";
  payload: ConfigApplyResult;
}

export interface RetryStartedEvent extends RuntimeEventEnvelope {
  type: "retry_started";
  payload: {
    turnId: string;
    attemptId: string;
    attemptIndex: number;
    retryDomain: RetryDomain;
    signature?: NormalizedFailureSignature;
  };
}

export interface RetryLoopDetectedEvent extends RuntimeEventEnvelope {
  type: "retry_loop_detected";
  payload: {
    turnId: string;
    retryDomain: RetryDomain;
    signature: string;
    threshold: number;
  };
}

export interface TaskStartedEvent extends RuntimeEventEnvelope {
  type: "task_started";
  payload: {
    taskId: string;
    label: string;
    commandId?: string;
  };
}

export interface TaskCompletedEvent extends RuntimeEventEnvelope {
  type: "task_completed";
  payload: {
    taskId: string;
    outcome: Extract<TerminalOutcome, "succeeded">;
    summary?: string;
  };
}

export interface TaskFailedEvent extends RuntimeEventEnvelope {
  type: "task_failed";
  payload: {
    taskId: string;
    outcome: Exclude<TerminalOutcome, "succeeded">;
    summary: string;
  };
}

export interface TurnSupersededEvent extends RuntimeEventEnvelope {
  type: "turn_superseded";
  payload: {
    turnId: string;
    supersededByCommandId: string;
    outcome: "superseded";
  };
}

export interface MinecraftReconnectStartedEvent extends RuntimeEventEnvelope {
  type: "minecraft_reconnect_started";
  payload: {
    attemptCount: number;
    maxAttempts: number;
    reason: string;
  };
}

export interface MinecraftReconnectSucceededEvent extends RuntimeEventEnvelope {
  type: "minecraft_reconnect_succeeded";
  payload: {
    attemptCount: number;
  };
}

export interface MinecraftReconnectFailedEvent extends RuntimeEventEnvelope {
  type: "minecraft_reconnect_failed";
  payload: {
    attemptCount: number;
    maxAttempts: number;
    errorCode: string;
  };
}

export interface GraphQueryEvent extends RuntimeEventEnvelope {
  type: "graph_query";
  payload: {
    scope: "world_thread" | "world" | "local_fallback";
    summaryCount: number;
  };
}

export interface GraphGuidanceUsedEvent extends RuntimeEventEnvelope {
  type: "graph_guidance_used";
  payload: {
    turnId: string;
    attemptId: string;
    summary: LearningEventSummary | null;
  };
}

export type RuntimeEvent =
  | RuntimeSnapshotEvent
  | RuntimeStateChangedEvent
  | RuntimeHeartbeatEvent
  | ConfigAppliedEvent
  | RetryStartedEvent
  | RetryLoopDetectedEvent
  | TaskStartedEvent
  | TaskCompletedEvent
  | TaskFailedEvent
  | TurnSupersededEvent
  | MinecraftReconnectStartedEvent
  | MinecraftReconnectSucceededEvent
  | MinecraftReconnectFailedEvent
  | GraphQueryEvent
  | GraphGuidanceUsedEvent;
