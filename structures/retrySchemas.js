const RETRY_DOMAINS = Object.freeze({
  LLM: "llm",
  ACTION: "action",
  CONNECTION: "connection"
});

function normalizeToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_\-]/g, "");
}

function buildSignatureString(signature = {}) {
  return [
    signature.retryDomain || "unknown",
    signature.actionType || "none",
    signature.errorCode || signature.errorCategory || "unknown",
    signature.provider || "none",
    signature.operationSubtype || "none",
    signature.signatureVersion || "v1"
  ]
    .map(normalizeToken)
    .join("|");
}

const RETRY_TERMINAL_OUTCOMES = Object.freeze({
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  INTERRUPTED: "interrupted",
  SUPERSEDED: "superseded",
  ABANDONED: "abandoned",
  NON_RETRYABLE: "non_retryable",
});

const RETRY_STOP_REASONS = Object.freeze({
  MAX_ATTEMPTS: "max_attempts",
  LOOP_DETECTED: "loop_detected",
  NON_RETRYABLE: "non_retryable",
  RUNTIME_SHUTDOWN: "runtime_shutdown",
  SUPERSEDED: "superseded",
  RUNTIME_UNAVAILABLE: "runtime_unavailable"
});

function createNormalizedFailureSignature({
  retryDomain,
  actionType,
  errorCode,
  errorCategory,
  provider = null,
  operationSubtype = null,
  signatureVersion = "v1"
}) {
  return {
    retryDomain,
    actionType,
    errorCode: errorCode || null,
    errorCategory: errorCategory || null,
    provider,
    operationSubtype,
    signatureVersion,
    signature: buildSignatureString({
      retryDomain,
      actionType,
      errorCode: errorCode || null,
      errorCategory: errorCategory || null,
      provider,
      operationSubtype,
      signatureVersion
    })
  };
}

function createRetryAttemptEnvelope({
  turnId,
  attemptId,
  commandId = null,
  threadId,
  worldId = null,
  retryDomain,
  signature,
  actionType = "none",
  provider = null,
  operationSubtype = null,
  timestamp = new Date().toISOString(),
  metadata = {}
}) {
  return {
    kind: "retry_attempt",
    turnId,
    attemptId,
    commandId,
    threadId,
    worldId,
    retryDomain,
    signature,
    actionType,
    provider,
    operationSubtype,
    timestamp,
    metadata
  };
}

function createRetryOutcomeEnvelope({
  turnId,
  attemptId,
  commandId = null,
  threadId,
  worldId = null,
  retryDomain,
  signature,
  actionType = "none",
  provider = null,
  operationSubtype = null,
  terminalOutcome,
  timestamp = new Date().toISOString(),
  metadata = {}
}) {
  return {
    kind: "retry_outcome",
    turnId,
    attemptId,
    commandId,
    threadId,
    worldId,
    retryDomain,
    signature,
    actionType,
    provider,
    operationSubtype,
    terminalOutcome,
    timestamp,
    metadata
  };
}

module.exports = {
  RETRY_DOMAINS,
  RETRY_TERMINAL_OUTCOMES,
  RETRY_STOP_REASONS,
  buildSignatureString,
  createNormalizedFailureSignature,
  createRetryAttemptEnvelope,
  createRetryOutcomeEnvelope
};
