const assert = require("assert");
const { RecordId } = require("surrealdb");

const {
  LearningStore,
  summarizeGuidance,
  summarizeWhatWorked,
  sortOutcomes
} = require("../memory/learningStore");

const signature = { actionType: "move_to" };
const events = [
  {
    terminal_outcome: "failed",
    error_code: "invalid_coordinates",
    timestamp: "2025-01-01T00:00:00.000Z"
  },
  {
    terminal_outcome: "success",
    timestamp: "2025-01-02T00:00:00.000Z"
  },
  {
    terminal_outcome: "failed",
    error_code: "not_connected",
    timestamp: "2025-01-03T00:00:00.000Z"
  }
];

const sorted = sortOutcomes(events);
assert.strictEqual(sorted[0].terminal_outcome, "success");

const summary = summarizeGuidance(sorted, signature);
assert.ok(summary.includes("Recent successes"));
assert.ok(summary.includes("Recent failure patterns"));

const whatWorked = summarizeWhatWorked(sorted);
assert.ok(whatWorked.includes("Recent successes"));

async function testRelateAttemptOutcome() {
  const calls = [];
  const client = {
    async query(statement, variables) {
      calls.push({ statement, variables });
      return [
        {
          result: [
            {
              id: new RecordId("learning_edges", "edge-1")
            }
          ]
        }
      ];
    }
  };

  const store = new LearningStore(client);
  const attemptRef = new RecordId("learning_events", "attempt1");
  const outcomeRef = "learning_events:outcome1";

  await store.relateAttemptOutcome({
    attemptId: attemptRef,
    outcomeId: outcomeRef,
    threadId: "thread-1",
    worldId: "world-1",
    turnId: "turn-1"
  });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].statement, "RELATE $attempt->learning_edges->$outcome CONTENT $edge RETURN AFTER;");
  assert.ok(calls[0].variables.attempt instanceof RecordId);
  assert.strictEqual(String(calls[0].variables.attempt), String(attemptRef));
  assert.ok(calls[0].variables.outcome instanceof RecordId);
  assert.strictEqual(String(calls[0].variables.outcome), outcomeRef);
  assert.strictEqual(calls[0].variables.edge.attempt_id, String(attemptRef));
}

Promise.resolve()
  .then(testRelateAttemptOutcome)
  .then(() => {
    console.log("learningStore tests passed");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
