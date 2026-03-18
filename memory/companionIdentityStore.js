const { getStatementRows } = require("./surrealClient");

function toRecord(identity = {}) {
  return {
    display_name: identity.displayName,
    avatar_icon_id: identity.avatarIconId,
    personality_preset: identity.personalityPreset,
    tone_intensity: identity.toneIntensity,
    chat_verbosity: identity.chatVerbosity,
    identity_revision: identity.identityRevision,
    updated_at: identity.updatedAt
  };
}

function fromRecord(record) {
  if (!record) {
    return null;
  }

  return {
    displayName: record.display_name,
    avatarIconId: record.avatar_icon_id,
    personalityPreset: record.personality_preset,
    toneIntensity: record.tone_intensity,
    chatVerbosity: record.chat_verbosity,
    identityRevision: record.identity_revision,
    updatedAt: record.updated_at
  };
}

class CompanionIdentityStore {
  constructor(client) {
    this.client = client;
  }

  async getActiveIdentity(identityId = "guardian") {
    const [selected] = await this.client.query(
      'SELECT * FROM type::record("companion_identity", $identityId);',
      { identityId }
    );

    return fromRecord(getStatementRows(selected)[0] || null);
  }

  async upsertActiveIdentity(identity, identityId = "guardian") {
    const [updated] = await this.client.query(
      'UPSERT type::record("companion_identity", $identityId) CONTENT $identity RETURN AFTER;',
      {
        identityId,
        identity: toRecord(identity)
      }
    );

    return fromRecord(getStatementRows(updated)[0] || null);
  }
}

module.exports = {
  CompanionIdentityStore
};
