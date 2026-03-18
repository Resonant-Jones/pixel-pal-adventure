const { getStatementRows } = require("./surrealClient");

class WorldStore {
  constructor(client) {
    this.client = client;
  }

  async getWorld(worldId) {
    if (!worldId) {
      return null;
    }

    const [selected] = await this.client.query('SELECT * FROM type::record("worlds", $worldId);', {
      worldId
    });

    return getStatementRows(selected)[0] || null;
  }

  async upsertWorld({
    worldId,
    serverAddress,
    spawnLocation,
    dimension,
    serverBrand,
    firstSeen = new Date().toISOString(),
    lastSeen = new Date().toISOString()
  }) {
    if (!worldId) {
      throw new Error("worldId is required.");
    }

    const existing = await this.getWorld(worldId);

    if (!existing) {
      const world = {
        world_id: worldId,
        server_address: serverAddress,
        spawn_location: spawnLocation,
        dimension,
        server_brand: serverBrand,
        first_seen: firstSeen,
        last_seen: lastSeen
      };

      const [created] = await this.client.query(
        'CREATE type::record("worlds", $worldId) CONTENT $world RETURN AFTER;',
        {
          worldId,
          world
        }
      );

      return getStatementRows(created)[0] || world;
    }

    const [updated] = await this.client.query(
      'UPDATE type::record("worlds", $worldId) MERGE $world RETURN AFTER;',
      {
        worldId,
        world: {
          world_id: worldId,
          server_address: serverAddress,
          spawn_location: spawnLocation,
          dimension,
          server_brand: serverBrand,
          last_seen: lastSeen
        }
      }
    );

    return getStatementRows(updated)[0] || existing;
  }
}

module.exports = {
  WorldStore
};
