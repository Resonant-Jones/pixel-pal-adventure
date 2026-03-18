const crypto = require("crypto");

const { getStatementRows } = require("./surrealClient");

class SessionStore {
  constructor(client) {
    this.client = client;
  }

  async createSession({
    sessionId = crypto.randomUUID(),
    worldId,
    threadId,
    primaryPlayer,
    startTime = new Date().toISOString()
  }) {
    if (!worldId) {
      throw new Error("worldId is required.");
    }

    const sessionRecord = {
      session_id: sessionId,
      world_id: worldId,
      thread_id: threadId,
      primary_player: primaryPlayer,
      start_time: startTime
    };

    const [created] = await this.client.query(
      'CREATE type::record("sessions", $sessionId) CONTENT $sessionRecord RETURN AFTER;',
      {
        sessionId,
        sessionRecord
      }
    );

    return getStatementRows(created)[0] || sessionRecord;
  }

  async endSession(sessionId, endTime = new Date().toISOString()) {
    if (!sessionId) {
      return null;
    }

    const [updated] = await this.client.query(
      'UPDATE type::record("sessions", $sessionId) MERGE { end_time: $endTime } RETURN AFTER;',
      {
        sessionId,
        endTime
      }
    );

    return getStatementRows(updated)[0] || null;
  }
}

module.exports = {
  SessionStore
};
