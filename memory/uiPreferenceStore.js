// memory/uiPreferenceStore.js
//
// User preferences that outlive a restart.
//
// WHY A TABLE AND NOT A DOTFILE
//
// A preference the user changes from a screen belongs with the other
// preferences, not in a file someone has to remember to edit. `ui_preferences`
// already exists in the schema and is schemaless, with a unique index on
// `key` — it was defined for exactly this and nothing was writing to it.
//
// KEYS
//
//   "memory.embedder"  -> { provider, model, updated_at }

const { getStatementRows } = require("./surrealClient");

class UiPreferenceStore {
  constructor(client) {
    this.client = client;
  }

  async get(key) {
    if (!key) {
      return null;
    }

    const [selected] = await this.client.query(
      'SELECT * FROM type::record("ui_preferences", $key);',
      { key }
    );

    const rows = getStatementRows(selected);
    return rows[0] || null;
  }

  async set(key, value) {
    if (!key) {
      throw new Error("A preference needs a key.");
    }

    const payload = {
      key,
      value,
      updated_at: new Date().toISOString()
    };

    const [updated] = await this.client.query(
      'UPSERT type::record("ui_preferences", $key) CONTENT $payload RETURN AFTER;',
      { key, payload }
    );

    return getStatementRows(updated)[0] || payload;
  }

  async remove(key) {
    if (!key) {
      return false;
    }

    const [removed] = await this.client.query(
      'DELETE type::record("ui_preferences", $key) RETURN BEFORE;',
      { key }
    );

    return getStatementRows(removed).length > 0;
  }
}

module.exports = {
  UiPreferenceStore
};
