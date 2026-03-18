const crypto = require("crypto");

const { cloneState } = require("./runtimeState");

function buildKidFriendlySummaries(state) {
  const summaries = [];

  if (state.activeTask) {
    summaries.push(`Working on: ${state.activeTask.label}`);
  } else if (state.lifecycle === "ready") {
    summaries.push(`${state.identity.displayName} is ready to help.`);
  } else {
    summaries.push(`${state.identity.displayName} is getting ready.`);
  }

  if (state.activeAnchor) {
    summaries.push(`Build target: ${state.activeAnchor.description}`);
  }

  if (state.connectionHealth === "degraded") {
    summaries.push("Connection looks a little shaky.");
  }

  return summaries;
}

class StateProjector {
  constructor({ getState, getSnapshotVersion, getLastSequence } = {}) {
    this.getState = getState;
    this.getSnapshotVersion = getSnapshotVersion || (() => this.snapshotVersion);
    this.getLastSequence = getLastSequence || (() => this.getState()?.lastSequence || 0);
    this.snapshotVersion = crypto.randomUUID();
  }

  rotateSnapshotVersion() {
    this.snapshotVersion = crypto.randomUUID();
    return this.snapshotVersion;
  }

  projectRuntimeState() {
    return cloneState(this.getState());
  }

  projectSnapshot() {
    return {
      snapshotVersion: this.getSnapshotVersion(),
      lastSequence: this.getLastSequence(),
      state: this.projectRuntimeState()
    };
  }

  projectKidSummary() {
    return buildKidFriendlySummaries(this.getState());
  }
}

module.exports = {
  StateProjector,
  buildKidFriendlySummaries
};
