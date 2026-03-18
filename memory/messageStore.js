const { getStatementRows } = require("./surrealClient");

class MessageStore {
  constructor(client) {
    this.client = client;
  }

  async storeMessage({
    threadId,
    worldId = null,
    sessionId = null,
    speaker,
    content,
    source = "minecraft",
    timestamp = new Date().toISOString(),
    metadata = {}
  }) {
    const message = {
      thread_id: threadId,
      world_id: worldId,
      session_id: sessionId,
      speaker,
      content,
      source,
      timestamp,
      metadata
    };

    const [created] = await this.client.query(
      "CREATE messages CONTENT $message RETURN AFTER;",
      { message }
    );

    return getStatementRows(created)[0] || message;
  }

  async getRecentMessages(threadId, limit = 12, options = {}) {
    if (!threadId || limit <= 0) {
      return [];
    }

    const filters = ["thread_id = $threadId"];
    const parameters = {
      threadId,
      limit
    };

    if (options.worldId) {
      filters.push("world_id = $worldId");
      parameters.worldId = options.worldId;
    }

    const [selected] = await this.client.query(
      `SELECT * FROM messages WHERE ${filters.join(" AND ")} ORDER BY timestamp DESC LIMIT $limit;`,
      parameters
    );

    return getStatementRows(selected).slice().reverse();
  }

  async countMessages(threadId, options = {}) {
    if (!threadId) {
      return 0;
    }

    const filters = ["thread_id = $threadId"];
    const parameters = {
      threadId
    };

    if (options.worldId) {
      filters.push("world_id = $worldId");
      parameters.worldId = options.worldId;
    }

    if (options.excludedSpeaker) {
      filters.push("speaker != $excludedSpeaker");
      parameters.excludedSpeaker = options.excludedSpeaker;
    }

    const [selected] = await this.client.query(
      `SELECT id FROM messages WHERE ${filters.join(" AND ")};`,
      parameters
    );

    return getStatementRows(selected).length;
  }

  async ensureCharacter({ id, name, role, personality }) {
    const character = {
      name,
      role,
      personality,
      updated_at: new Date().toISOString()
    };

    const [updated] = await this.client.query(
      'UPSERT type::record("characters", $id) CONTENT $character RETURN AFTER;',
      {
        id,
        character
      }
    );

    return getStatementRows(updated)[0] || character;
  }
}

module.exports = {
  MessageStore
};
