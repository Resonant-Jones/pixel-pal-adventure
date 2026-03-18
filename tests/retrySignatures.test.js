const assert = require("assert");

const {
  buildNormalizedFailureSignature,
  buildSignatureKey,
  classifyActionError,
  classifyConnectionError,
  classifyLlmError
} = require("../agent/retrySignatures");

const llm = classifyLlmError(new Error("MiniMax request timed out after 30000ms"));
assert.strictEqual(llm.errorCode, "timeout");
assert.strictEqual(llm.errorCategory, "network");

const action = classifyActionError(new Error("move_to action requires x, y, and z coordinates."));
assert.strictEqual(action.errorCode, "missing_required_input");

const conn = classifyConnectionError(new Error("Minecraft connection ended before the bot spawned."));
assert.strictEqual(conn.errorCode, "ended_pre_spawn");

const signature = buildNormalizedFailureSignature({
  retryDomain: "action",
  actionType: "move_to",
  error: new Error("move_to action requires x, y, and z coordinates."),
  provider: "groq"
});

assert.strictEqual(signature.retryDomain, "action");
assert.strictEqual(signature.actionType, "move_to");
assert.strictEqual(signature.errorCode, "missing_required_input");

const key = buildSignatureKey(signature);
assert.ok(key.includes("action|move_to|missing_required_input"));

console.log("retrySignatures tests passed");
