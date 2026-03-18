const { getStatementRows } = require("./surrealClient");

function toIso() {
  return new Date().toISOString();
}

class ProfileStore {
  constructor(client) {
    this.client = client;
  }

  async saveProfile({
    profileId,
    name,
    identity,
    liveConfig,
    preferredAnchorBehavior = null,
    uiDefaults = null,
    timestamp = toIso()
  }) {
    const id = profileId || name.toLowerCase().replace(/\s+/g, "_");
    const payload = {
      profile_id: id,
      name,
      identity,
      live_config: liveConfig,
      preferred_anchor_behavior: preferredAnchorBehavior,
      ui_defaults: uiDefaults,
      created_at: timestamp,
      updated_at: timestamp
    };

    const [updated] = await this.client.query(
      'UPSERT type::record("saved_profiles", $profileId) CONTENT $payload RETURN AFTER;',
      {
        profileId: id,
        payload
      }
    );

    return getStatementRows(updated)[0] || payload;
  }

  async getProfile(profileId) {
    if (!profileId) {
      return null;
    }

    const [selected] = await this.client.query(
      'SELECT * FROM type::record("saved_profiles", $profileId);',
      { profileId }
    );

    return getStatementRows(selected)[0] || null;
  }

  async listProfiles() {
    const [selected] = await this.client.query(
      "SELECT * FROM saved_profiles ORDER BY name ASC;"
    );

    return getStatementRows(selected);
  }
}

module.exports = {
  ProfileStore
};
