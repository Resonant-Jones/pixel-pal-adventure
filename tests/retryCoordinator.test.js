const assert = require("assert");

const { RetryCoordinator } = require("../agent/retryCoordinator");

async function testNonRetryable() {
  const coordinator = new RetryCoordinator({ maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 });
  const result = await coordinator.run({
    turnId: "turn-1",
    threadId: "thread-1",
    worldId: "world-1",
    attempt: async () => ({
      ok: false,
      retryDomain: "action",
      actionType: "move_to",
      error: new Error("move_to action requires x, y, and z coordinates."),
      nonRetryable: true
    })
  });

  assert.strictEqual(result.terminalOutcome, "non_retryable");
}

async function testLoopStop() {
  const coordinator = new RetryCoordinator({ maxAttempts: 5, loopThreshold: 3, baseDelayMs: 0, maxDelayMs: 0 });
  let count = 0;

  const result = await coordinator.run({
    turnId: "turn-2",
    threadId: "thread-2",
    worldId: "world-2",
    attempt: async () => {
      count += 1;
      return {
        ok: false,
        retryDomain: "llm",
        actionType: "chat",
        error: new Error("MiniMax request timed out after 30000ms")
      };
    }
  });

  assert.strictEqual(result.terminalOutcome, "loop_stopped");
  assert.ok(count >= 3);
}

async function testSuccess() {
  const coordinator = new RetryCoordinator({ maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 });
  let attempts = 0;

  const result = await coordinator.run({
    turnId: "turn-3",
    threadId: "thread-3",
    worldId: "world-3",
    attempt: async () => {
      attempts += 1;
      if (attempts < 2) {
        return {
          ok: false,
          retryDomain: "action",
          actionType: "move_to",
          error: new Error("Bot is not connected.")
        };
      }
      return { ok: true, value: { ok: true } };
    }
  });

  assert.strictEqual(result.terminalOutcome, "success");
  assert.strictEqual(attempts, 2);
}

Promise.resolve()
  .then(testNonRetryable)
  .then(testLoopStop)
  .then(testSuccess)
  .then(() => {
    console.log("retryCoordinator tests passed");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
