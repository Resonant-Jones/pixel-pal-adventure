const { buildSignatureString, createNormalizedFailureSignature } = require("../structures/retrySchemas");

const DEFAULT_SIGNATURE_VERSION = "v1";

function normalizeToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_\-]/g, "");
}

function classifyLlmError(error) {
  const code = normalizeToken(error?.code);
  const message = String(error?.message || "").toLowerCase();

  if (code === "etimedout" || message.includes("timed out")) {
    return { errorCode: "timeout", errorCategory: "network", operationSubtype: "request" };
  }

  if (message.includes("request failed") || code === "econnreset") {
    return { errorCode: "request_failed", errorCategory: "network", operationSubtype: "request" };
  }

  if (message.includes("invalid json")) {
    return { errorCode: "invalid_json", errorCategory: "parse", operationSubtype: "parse" };
  }

  if (message.includes("no assistant message")) {
    return { errorCode: "empty_response", errorCategory: "content", operationSubtype: "response" };
  }

  return { errorCode: "unknown_error", errorCategory: "unknown", operationSubtype: null };
}

function classifyActionError(error) {
  const message = String(error?.message || "").toLowerCase();

  if (message.includes("requires") || message.includes("required")) {
    return { errorCode: "missing_required_input", errorCategory: "validation", operationSubtype: "input" };
  }

  if (message.includes("not connected")) {
    return { errorCode: "not_connected", errorCategory: "connection", operationSubtype: "execution" };
  }

  if (message.includes("not visible")) {
    return { errorCode: "target_not_visible", errorCategory: "state", operationSubtype: "target" };
  }

  if (message.includes("invalid") && message.includes("coordinates")) {
    return { errorCode: "invalid_coordinates", errorCategory: "validation", operationSubtype: "input" };
  }

  if (message.includes("unknown structure")) {
    return { errorCode: "unknown_structure", errorCategory: "validation", operationSubtype: "input" };
  }

  if (message.includes("commands must start")) {
    return { errorCode: "invalid_command", errorCategory: "validation", operationSubtype: "input" };
  }

  if (message.includes("unable to resolve") && message.includes("look_at")) {
    return { errorCode: "invalid_target", errorCategory: "validation", operationSubtype: "target" };
  }

  if (message.includes("no path") || message.includes("path")) {
    return { errorCode: "path_unreachable", errorCategory: "navigation", operationSubtype: "movement" };
  }

  return { errorCode: "unknown_error", errorCategory: "unknown", operationSubtype: null };
}

function classifyConnectionError(error) {
  const message = String(error?.message || "").toLowerCase();

  // A duplicate-login kick is NOT a transient fault, and treating it as one is
  // catastrophic: two agents sharing a username each kick the other, every
  // kick triggers a reconnect, and the pair settle into an infinite mutual-kick
  // storm. Observed in the wild at ~2200 join/leave cycles.
  //
  // This must be checked before the generic "kicked" branch so the specific
  // cause wins over the category.
  if (isDuplicateLoginKick(error)) {
    return { errorCode: "duplicate_login", errorCategory: "fatal", operationSubtype: "disconnect" };
  }

  if (message.includes("kicked")) {
    return { errorCode: "kicked", errorCategory: "connection", operationSubtype: "disconnect" };
  }

  if (message.includes("ended before the bot spawned")) {
    return { errorCode: "ended_pre_spawn", errorCategory: "connection", operationSubtype: "disconnect" };
  }

  if (message.includes("connection ended")) {
    return { errorCode: "connection_ended", errorCategory: "connection", operationSubtype: "disconnect" };
  }

  return { errorCode: "unknown_error", errorCategory: "unknown", operationSubtype: null };
}

// True when the server dropped us because the SAME account connected twice.
//
// Mineflayer surfaces this as a kick reason string, and the exact wording
// varies by server software and version, so match on the phrases that are
// stable rather than one exact sentence.
function isDuplicateLoginKick(error) {
  const message = String(error?.message || error || "").toLowerCase();

  const phrases = [
    "you logged in from another location",
    "logged in from another location",
    "you are already connected",
    "already logged in",
    "duplicate login",
    "another location"
  ];

  return phrases.some((phrase) => message.includes(phrase));
}

function buildNormalizedFailureSignature({
  retryDomain,
  actionType = "none",
  error,
  provider = null,
  operationSubtype = null,
  signatureVersion = DEFAULT_SIGNATURE_VERSION
}) {
  let classified = { errorCode: "unknown_error", errorCategory: "unknown", operationSubtype: null };

  if (retryDomain === "llm") {
    classified = classifyLlmError(error);
  } else if (retryDomain === "action") {
    classified = classifyActionError(error);
  } else if (retryDomain === "connection") {
    classified = classifyConnectionError(error);
  }

  const normalizedActionType = normalizeToken(actionType) || "none";
  const normalizedProvider = provider ? normalizeToken(provider) : null;
  const normalizedSubtype = operationSubtype || classified.operationSubtype || null;

  return createNormalizedFailureSignature({
    retryDomain,
    actionType: normalizedActionType,
    errorCode: classified.errorCode,
    errorCategory: classified.errorCategory,
    provider: normalizedProvider,
    operationSubtype: normalizedSubtype,
    signatureVersion
  });
}

function buildSignatureKey(signature) {
  return signature?.signature || buildSignatureString(signature);
}

module.exports = {
  buildNormalizedFailureSignature,
  buildSignatureKey,
  classifyLlmError,
  classifyActionError,
  classifyConnectionError,
  isDuplicateLoginKick
};
