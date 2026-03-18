const {
  RETRY_TERMINAL_OUTCOMES,
  RETRY_STOP_REASONS
} = require("../structures/retrySchemas");
const { buildNormalizedFailureSignature, buildSignatureKey } = require("./retrySignatures");

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function computeBackoffDelay({ baseDelayMs, maxDelayMs, attemptIndex, jitter }) {
  const exponent = Math.max(0, attemptIndex - 1);
  const raw = baseDelayMs * Math.pow(2, exponent);
  const capped = clamp(raw, baseDelayMs, maxDelayMs);
  const jitterAmount = capped * jitter * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(capped + jitterAmount));
}

class RetryCoordinator {
  constructor({
    maxAttempts = 3,
    loopThreshold = 3,
    baseDelayMs = 500,
    maxDelayMs = 5000,
    jitter = 0.25,
    graphFromAttempt = 2,
    logger = console
  } = {}) {
    this.maxAttempts = maxAttempts;
    this.loopThreshold = loopThreshold;
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.jitter = jitter;
    this.graphFromAttempt = graphFromAttempt;
    this.logger = logger;
  }

  async run({
    turnId,
    commandId = null,
    threadId,
    worldId,
    provider = null,
    attempt,
    getGuidance = null,
    isSuperseded = null,
    isShuttingDown = null,
    isRuntimeUnavailable = null
  }) {
    let attemptIndex = 0;
    let repeatCount = 0;
    let lastSignatureKey = null;
    const history = [];

    while (attemptIndex < this.maxAttempts) {
      attemptIndex += 1;

      if (typeof isShuttingDown === "function" && isShuttingDown()) {
        return {
          ok: false,
          terminalOutcome: RETRY_TERMINAL_OUTCOMES.ABANDONED,
          stopReason: RETRY_STOP_REASONS.RUNTIME_SHUTDOWN,
          attempts: attemptIndex,
          history
        };
      }

      if (typeof isRuntimeUnavailable === "function" && isRuntimeUnavailable()) {
        return {
          ok: false,
          terminalOutcome: RETRY_TERMINAL_OUTCOMES.INTERRUPTED,
          stopReason: RETRY_STOP_REASONS.RUNTIME_UNAVAILABLE,
          attempts: attemptIndex,
          history
        };
      }

      if (typeof isSuperseded === "function" && isSuperseded()) {
        return {
          ok: false,
          terminalOutcome: RETRY_TERMINAL_OUTCOMES.SUPERSEDED,
          stopReason: RETRY_STOP_REASONS.SUPERSEDED,
          attempts: attemptIndex,
          history
        };
      }

      const guidance =
        attemptIndex >= this.graphFromAttempt && typeof getGuidance === "function"
          ? await getGuidance()
          : null;

      const result = await attempt({ attemptIndex, guidance });

      if (result && result.ok) {
        return {
          ok: true,
          value: result.value,
          terminalOutcome: RETRY_TERMINAL_OUTCOMES.SUCCEEDED,
          attempts: attemptIndex,
          history
        };
      }

      const retryDomain = result?.retryDomain || "action";
      const signature = buildNormalizedFailureSignature({
        retryDomain,
        actionType: result?.actionType || "none",
        error: result?.error,
        provider: result?.provider || provider || null,
        operationSubtype: result?.operationSubtype || null
      });
      const signatureKey = buildSignatureKey(signature);

      history.push({
        turnId,
        commandId,
        threadId,
        worldId,
        attemptIndex,
        retryDomain,
        signature
      });

      if (signatureKey === lastSignatureKey) {
        repeatCount += 1;
      } else {
        repeatCount = 1;
        lastSignatureKey = signatureKey;
      }

      if (result?.nonRetryable) {
        return {
          ok: false,
          terminalOutcome: RETRY_TERMINAL_OUTCOMES.NON_RETRYABLE,
          stopReason: RETRY_STOP_REASONS.NON_RETRYABLE,
          attempts: attemptIndex,
          signature,
          history
        };
      }

      if (retryDomain === "connection" && result?.interrupted) {
        return {
          ok: false,
          terminalOutcome: RETRY_TERMINAL_OUTCOMES.INTERRUPTED,
          stopReason: RETRY_STOP_REASONS.RUNTIME_UNAVAILABLE,
          attempts: attemptIndex,
          signature,
          history
        };
      }

      if (repeatCount >= this.loopThreshold) {
        return {
          ok: false,
          terminalOutcome: RETRY_TERMINAL_OUTCOMES.FAILED,
          stopReason: RETRY_STOP_REASONS.LOOP_DETECTED,
          attempts: attemptIndex,
          signature,
          history
        };
      }

      if (attemptIndex >= this.maxAttempts) {
        return {
          ok: false,
          terminalOutcome: RETRY_TERMINAL_OUTCOMES.FAILED,
          stopReason: RETRY_STOP_REASONS.MAX_ATTEMPTS,
          attempts: attemptIndex,
          signature,
          history
        };
      }

      const delayMs = computeBackoffDelay({
        baseDelayMs: this.baseDelayMs,
        maxDelayMs: this.maxDelayMs,
        attemptIndex,
        jitter: this.jitter
      });

      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return {
      ok: false,
      terminalOutcome: RETRY_TERMINAL_OUTCOMES.FAILED,
      stopReason: RETRY_STOP_REASONS.MAX_ATTEMPTS,
      attempts: attemptIndex,
      history
    };
  }
}

module.exports = {
  RetryCoordinator,
  computeBackoffDelay
};
