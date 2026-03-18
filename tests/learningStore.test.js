const assert = require("assert");

const { summarizeGuidance, summarizeWhatWorked, sortOutcomes } = require("../memory/learningStore");

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

console.log("learningStore tests passed");
