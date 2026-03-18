const { EventEmitter } = require("events");
const crypto = require("crypto");

class RuntimeEventBus extends EventEmitter {
  constructor({ getSnapshotVersion = () => null } = {}) {
    super();
    this.getSnapshotVersion = getSnapshotVersion;
    this.sequence = 0;
  }

  currentSequence() {
    return this.sequence;
  }

  createEvent(type, payload, options = {}) {
    const envelope = {
      type,
      eventId: crypto.randomUUID(),
      sequence: options.advanceSequence === false ? this.sequence : ++this.sequence,
      timestamp: options.timestamp || new Date().toISOString(),
      correlationId: options.correlationId,
      turnId: options.turnId,
      attemptId: options.attemptId,
      retryDomain: options.retryDomain,
      normalizedSignature: options.normalizedSignature,
      payload,
      metadata: options.metadata || undefined
    };

    return envelope;
  }

  emitEvent(type, payload, options = {}) {
    const envelope = this.createEvent(type, payload, options);
    this.emit("event", envelope);
    return envelope;
  }

  createSnapshotEvent(snapshot) {
    return this.createEvent(
      "runtime_snapshot",
      snapshot,
      {
        advanceSequence: false
      }
    );
  }
}

module.exports = {
  RuntimeEventBus
};
