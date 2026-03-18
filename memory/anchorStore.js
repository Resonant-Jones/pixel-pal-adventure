const crypto = require("crypto");

const { getStatementRows } = require("./surrealClient");

function toRecord(anchor = {}) {
  return {
    anchor_id: anchor.id,
    world_id: anchor.worldId,
    label: anchor.label,
    type: anchor.type,
    source: anchor.source,
    payload: anchor.payload,
    created_at: anchor.createdAt,
    updated_at: anchor.updatedAt
  };
}

function fromRecord(record) {
  if (!record) {
    return null;
  }

  return {
    id: record.anchor_id,
    worldId: record.world_id,
    label: record.label,
    type: record.type,
    source: record.source,
    payload: record.payload,
    createdAt: record.created_at,
    updatedAt: record.updated_at
  };
}

function formatAnchorSummary(anchor) {
  if (!anchor) {
    return null;
  }

  if (anchor.type === "point") {
    const position = anchor.payload?.position;
    return {
      id: anchor.id,
      label: anchor.label,
      type: anchor.type,
      description: position ? `${anchor.label} at ${position.x}, ${position.y}, ${position.z}` : anchor.label
    };
  }

  if (anchor.type === "area") {
    return {
      id: anchor.id,
      label: anchor.label,
      type: anchor.type,
      description: `${anchor.label} area`
    };
  }

  if (anchor.type === "facing") {
    return {
      id: anchor.id,
      label: anchor.label,
      type: anchor.type,
      description: `${anchor.label} facing target`
    };
  }

  return {
    id: anchor.id,
    label: anchor.label,
    type: anchor.type,
    description: `${anchor.label} path`
  };
}

class AnchorStore {
  constructor(client) {
    this.client = client;
  }

  async createAnchor(anchor) {
    const timestamp = new Date().toISOString();
    const record = {
      id: anchor.id || crypto.randomUUID(),
      worldId: anchor.worldId,
      label: anchor.label,
      type: anchor.type,
      source: anchor.source,
      payload: anchor.payload,
      createdAt: anchor.createdAt || timestamp,
      updatedAt: anchor.updatedAt || timestamp
    };

    const [created] = await this.client.query("CREATE anchors CONTENT $anchor RETURN AFTER;", {
      anchor: toRecord(record)
    });

    return fromRecord(getStatementRows(created)[0] || null);
  }

  async getAnchor(anchorId) {
    const [selected] = await this.client.query("SELECT * FROM anchors WHERE anchor_id = $anchorId LIMIT 1;", {
      anchorId
    });

    return fromRecord(getStatementRows(selected)[0] || null);
  }

  async listAnchors(worldId) {
    if (!worldId) {
      return [];
    }

    const [selected] = await this.client.query(
      "SELECT * FROM anchors WHERE world_id = $worldId ORDER BY created_at DESC;",
      { worldId }
    );

    return getStatementRows(selected).map(fromRecord);
  }
}

module.exports = {
  AnchorStore,
  formatAnchorSummary
};
