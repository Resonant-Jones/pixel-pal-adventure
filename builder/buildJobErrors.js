const {
  classifyActionError,
  classifyConnectionError
} = require("../agent/retrySignatures");

// A build job must never die because the network hiccuped. Anything that looks
// like a transport problem is retryable and routes to `paused` with a short
// resume_at, so the worker picks the job back up instead of abandoning it.
//
// The bug this replaces: every throw in buildWorker.runOnce() went straight to
// failJob(), which is terminal and is never re-selected by getNextBuildJob().
// One dropped packet mid-build permanently killed the structure.

const RETRYABLE_ERROR_CATEGORIES = new Set([
  "connection",
  "network",
  "navigation"
]);

const RETRYABLE_ERROR_CODES = new Set([
  "not_connected",
  "connection_ended",
  "kicked",
  "ended_pre_spawn",
  "timeout",
  "request_failed",
  "path_unreachable"
]);

const RETRYABLE_MESSAGE_FRAGMENTS = [
  "not connected",
  "bot is not connected",
  "connection ended",
  "socket hang up",
  "econnreset",
  "econnrefused",
  "epipe",
  "etimedout",
  "timeout",
  "timed out",
  "read econnreset",
  "disconnected",
  "keep-alive",
  "keepalive"
];

const RETRYABLE_DELAY_MS = 15000;

// Belt-and-braces: a wrapped error may not carry a category at all, so fall
// back to sniffing the message before declaring something terminal.
function isRetryableBuildError(error) {
  if (!error) {
    return false;
  }

  const message = String(error.message || error || "").toLowerCase();

  if (RETRYABLE_MESSAGE_FRAGMENTS.some((fragment) => message.includes(fragment))) {
    return true;
  }

  if (error.code && RETRYABLE_ERROR_CODES.has(String(error.code).toLowerCase())) {
    return true;
  }

  const actionClassification = classifyActionError(error);
  if (RETRYABLE_ERROR_CATEGORIES.has(actionClassification.errorCategory)) {
    return true;
  }

  const connectionClassification = classifyConnectionError(error);
  if (RETRYABLE_ERROR_CATEGORIES.has(connectionClassification.errorCategory)) {
    return true;
  }

  return false;
}

function describeBuildError(error) {
  const actionClassification = classifyActionError(error);
  const connectionClassification = classifyConnectionError(error);

  if (RETRYABLE_ERROR_CATEGORIES.has(connectionClassification.errorCategory)) {
    return connectionClassification;
  }

  if (RETRYABLE_ERROR_CATEGORIES.has(actionClassification.errorCategory)) {
    return actionClassification;
  }

  return {
    errorCode: actionClassification.errorCode || "unknown_error",
    errorCategory: actionClassification.errorCategory || "unknown",
    operationSubtype: actionClassification.operationSubtype || null
  };
}

module.exports = {
  RETRYABLE_DELAY_MS,
  isRetryableBuildError,
  describeBuildError
};