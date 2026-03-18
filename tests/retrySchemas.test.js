const assert = require("assert");

const {
  RETRY_DOMAINS,
  RETRY_TERMINAL_OUTCOMES,
  RETRY_STOP_REASONS,
  createNormalizedFailureSignature,
  createRetryAttemptEnvelope,
  createRetryOutcomeEnvelope
} = require("../structures/retrySchemas");

const signature = createNormalizedFailureSignature({
  retryDomain: RETRY_DOMAINS.LLM,
  actionType: "chat",
  errorCode: "timeout",
  provider: "groq"
});

assert.strictEqual(signature.retryDomain, "llm");
assert.strictEqual(signature.actionType, "chat");
assert.strictEqual(signature.errorCode, "timeout");
assert.strictEqual(signature.provider, "groq");
assert.strictEqual(signature.signatureVersion, "v1");

const attempt = createRetryAttemptEnvelope({
  turnId: "turn-1",
  attemptId: "attempt-1",
  threadId: "thread-1",
  worldId: "world-1",
  retryDomain: RETRY_DOMAINS.ACTION,
  signature,
  actionType: "move_to"
});

assert.strictEqual(attempt.kind, "retry_attempt");
assert.strictEqual(attempt.retryDomain, "action");
assert.strictEqual(attempt.actionType, "move_to");
assert.ok(attempt.timestamp);

const outcome = createRetryOutcomeEnvelope({
  turnId: "turn-1",
  attemptId: "attempt-1",
  threadId: "thread-1",
  worldId: "world-1",
  retryDomain: RETRY_DOMAINS.ACTION,
  signature,
  actionType: "move_to",
  terminalOutcome: RETRY_TERMINAL_OUTCOMES.SUCCESS
});

assert.strictEqual(outcome.kind, "retry_outcome");
assert.strictEqual(outcome.terminalOutcome, "success");
assert.ok(RETRY_STOP_REASONS.NON_RETRYABLE);

console.log("retrySchemas tests passed");
