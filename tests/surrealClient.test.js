const assert = require("assert");

const { sanitizeSurrealValue } = require("../memory/surrealClient");

class FakeRecordId {
  constructor(table, id) {
    Object.defineProperty(this, "table", {
      value: table,
      enumerable: false
    });
    Object.defineProperty(this, "id", {
      value: id,
      enumerable: false
    });
  }
}

const recordId = new FakeRecordId("jobs", "abc123");

const sanitized = sanitizeSurrealValue({
  profileId: "builder",
  jobId: recordId,
  preferred_anchor_behavior: null,
  ui_defaults: undefined,
  nested: {
    signature_version: null,
    retained: "yes"
  },
  list: [null, { optional: null, kept: 1 }]
});

assert.deepStrictEqual(sanitized, {
  profileId: "builder",
  jobId: recordId,
  nested: {
    retained: "yes"
  },
  list: [null, { kept: 1 }]
});

console.log("surrealClient tests passed");
