const { getStatementRows } = require("./surrealClient");

function nowIso() {
  return new Date().toISOString();
}

function buildRecordId(worldId, triggerType) {
  return `${worldId}:${triggerType}`;
}

class ReflexStateStore {
  constructor(client) {
    this.client = client;
  }

  async getState(worldId, triggerType) {
    if (!worldId || !triggerType) {
      return null;
    }

    const [selected] = await this.client.query(
      'SELECT * FROM type::record("reflex_state", $recordId);',
      {
        recordId: buildRecordId(worldId, triggerType)
      }
    );

    return getStatementRows(selected)[0] || null;
  }

  async upsertState({
    worldId,
    triggerType,
    lastReflexAt,
    lastEventAt,
    lastSignature,
    updatedAt = nowIso()
  }) {
    if (!worldId || !triggerType) {
      throw new Error("worldId and triggerType are required.");
    }

    const recordId = buildRecordId(worldId, triggerType);
    const existing = await this.getState(worldId, triggerType);
    const state = {
      world_id: worldId,
      trigger_type: triggerType,
      updated_at: updatedAt
    };

    if (lastReflexAt !== undefined) {
      state.last_reflex_at = lastReflexAt;
    }

    if (lastEventAt !== undefined) {
      state.last_event_at = lastEventAt;
    }

    if (lastSignature !== undefined) {
      state.last_signature = lastSignature;
    }

    if (!existing) {
      const [created] = await this.client.query(
        'CREATE type::record("reflex_state", $recordId) CONTENT $state RETURN AFTER;',
        {
          recordId,
          state
        }
      );

      return getStatementRows(created)[0] || state;
    }

    const [updated] = await this.client.query(
      'UPDATE type::record("reflex_state", $recordId) MERGE $state RETURN AFTER;',
      {
        recordId,
        state
      }
    );

    return getStatementRows(updated)[0] || state;
  }
}

module.exports = {
  ReflexStateStore
};
