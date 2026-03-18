const { getStatementRows } = require("./surrealClient");

function distanceBetween(left, right) {
  const dx = Number(left.x) - Number(right.x);
  const dy = Number(left.y) - Number(right.y);
  const dz = Number(left.z) - Number(right.z);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

class EventStore {
  constructor(client) {
    this.client = client;
  }

  async recordEvent({
    threadId,
    worldId = null,
    sessionId = null,
    type,
    description,
    location = null,
    actor = "system",
    snapshot = null,
    metadata = {},
    timestamp = new Date().toISOString()
  }) {
    const event = {
      thread_id: threadId,
      world_id: worldId,
      session_id: sessionId,
      type,
      description,
      location,
      actor,
      snapshot,
      metadata,
      timestamp
    };

    const [created] = await this.client.query(
      "CREATE events CONTENT $event RETURN AFTER;",
      { event }
    );

    return getStatementRows(created)[0] || event;
  }

  async getRecentEvents(threadId, limit = 6, options = {}) {
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

    if (options.types?.length) {
      filters.push("type INSIDE $types");
      parameters.types = options.types;
    }

    const [selected] = await this.client.query(
      `SELECT * FROM events WHERE ${filters.join(" AND ")} ORDER BY timestamp DESC LIMIT $limit;`,
      parameters
    );

    return getStatementRows(selected).slice().reverse();
  }

  async getRecentAdventureSummaries(threadId, limit = 3, options = {}) {
    if (!threadId || limit <= 0) {
      return [];
    }

    const parameters = {
      threadId,
      limit
    };
    const filters = ['thread_id = $threadId', 'type = "adventure_summary"'];

    if (options.worldId) {
      filters.push("world_id = $worldId");
      parameters.worldId = options.worldId;
    }

    const [selected] = await this.client.query(
      `SELECT * FROM events WHERE ${filters.join(" AND ")} ORDER BY timestamp DESC LIMIT $limit;`,
      parameters
    );

    return getStatementRows(selected).slice().reverse();
  }

  async getLatestAdventureSummary(threadId, options = {}) {
    if (!threadId) {
      return null;
    }

    const parameters = {
      threadId
    };
    const filters = ['thread_id = $threadId', 'type = "adventure_summary"'];

    if (options.worldId) {
      filters.push("world_id = $worldId");
      parameters.worldId = options.worldId;
    }

    const [selected] = await this.client.query(
      `SELECT * FROM events WHERE ${filters.join(" AND ")} ORDER BY timestamp DESC LIMIT 1;`,
      parameters
    );

    return getStatementRows(selected)[0] || null;
  }

  async getRecentReflexEvents(threadId, limit = 6, options = {}) {
    return this.getRecentEvents(threadId, limit, {
      ...options,
      types: ["reflex_triggered"]
    });
  }

  async findNearbyMemoryHints(worldId, location, radius = 24, limit = 3) {
    if (!worldId || !location) {
      return [];
    }

    const [selected] = await this.client.query(
      'SELECT * FROM events WHERE world_id = $worldId AND type INSIDE ["named_location", "discovery", "structure_build"] ORDER BY timestamp DESC LIMIT 100;',
      {
        worldId
      }
    );

    return getStatementRows(selected)
      .filter((event) => event.location && ["x", "y", "z"].every((key) => Number.isFinite(Number(event.location[key]))))
      .map((event) => ({
        ...event,
        distance: distanceBetween(event.location, location)
      }))
      .filter((event) => event.distance <= radius)
      .sort((left, right) => left.distance - right.distance)
      .slice(0, limit);
  }
}

module.exports = {
  EventStore
};
