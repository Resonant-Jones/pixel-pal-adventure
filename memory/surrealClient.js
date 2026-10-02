const fs = require("fs");
const path = require("path");

const { getSurrealConfig } = require("../config/surreal");

function isEmbeddedUrl(url) {
  return (
    url.startsWith("mem://") ||
    url.startsWith("rocksdb://") ||
    url.startsWith("surrealkv://") ||
    url.startsWith("surrealkv+versioned://")
  );
}

function normalizeSurrealUrl(url) {
  if (!url) {
    return "http://127.0.0.1:8000";
  }

  if (isEmbeddedUrl(url)) {
    return url;
  }

  return url.replace(/\/+$/, "");
}

function loadSurrealSdk() {
  try {
    return require("surrealdb");
  } catch (sdkError) {
    try {
      return require("surrealdb.js");
    } catch (legacyError) {
      const error = new Error(
        "Unable to load the SurrealDB SDK. Run `npm install` before starting the agent."
      );
      error.cause = sdkError || legacyError;
      throw error;
    }
  }
}

function getStatementRows(statement) {
  if (Array.isArray(statement)) {
    return statement;
  }

  return statement?.result || [];
}

function isPlainObject(value) {
  if (!value || typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeSurrealValue(value) {
  if (value === null) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.map((entry) =>
      entry && typeof entry === "object" ? sanitizeSurrealValue(entry) : entry
    );
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const sanitized = {};
  for (const [key, entry] of Object.entries(value)) {
    const nextValue = sanitizeSurrealValue(entry);
    if (nextValue !== undefined) {
      sanitized[key] = nextValue;
    }
  }

  return sanitized;
}

class SurrealClient {
  constructor(config = getSurrealConfig(), logger = console) {
    this.config = config;
    this.logger = logger;
    this.db = null;
    this.connecting = null;
    this.schemaBootstrapped = false;
  }

  async connect() {
    if (this.db) {
      return this.db;
    }

    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = this.#openConnection().catch((error) => {
      this.db = null;
      this.connecting = null;
      throw error;
    });
    return this.connecting;
  }

  async #openConnection() {
    const { Surreal } = loadSurrealSdk();
    const db = new Surreal();
    const url = normalizeSurrealUrl(this.config.url);
    const auth =
      this.config.username && this.config.password
        ? {
            username: this.config.username,
            password: this.config.password
          }
        : undefined;

    await db.connect(url, {
      namespace: this.config.namespace,
      database: this.config.database,
      authentication: auth,
      reconnect: {
        enabled: url.startsWith("ws://") || url.startsWith("wss://"),
        attempts: -1,
        retryDelay: 250,
        retryDelayMax: 5000,
        retryDelayMultiplier: 2,
        retryDelayJitter: 0.25
      }
    });

    this.db = db;
    this.connecting = null;
    await this.bootstrapSchema();
    this.logger.info(
      `[memory] Connected to SurrealDB ${url} (${this.config.namespace}/${this.config.database})`
    );
    return this.db;
  }

  async bootstrapSchema() {
    if (this.schemaBootstrapped) {
      return;
    }

    const db = await this.connect();
    const schemaPath = path.join(__dirname, "..", "schemas", "surrealSchema.surql");
    const schema = fs.readFileSync(schemaPath, "utf8");

    if (schema.trim()) {
      try {
        await db.query(schema);
      } catch (error) {
        // Schema bootstrap is best-effort. SurrealDB occasionally returns
        // transaction conflicts when the schema is already applied by another
        // caller; that's fine — we treat the schema as loaded and move on.
        // Any *other* schema error is logged but never fatal; the runtime
        // can still operate against whatever schema is already in place.
        this.logger.warn?.(
          `[memory] Schema bootstrap warning (${error?.message || error}); continuing with existing schema if any`
        );
        this.schemaBootstrapped = true;
        return;
      }
    }

    this.schemaBootstrapped = true;
  }

  async query(statement, variables = {}) {
    const db = await this.connect();
    try {
      return await db.query(statement, sanitizeSurrealValue(variables));
    } catch (error) {
      // JWT session tokens expire. When that happens the server returns 401.
      // Drop the cached handle so the next connect() re-signs in, then retry
      // the original statement exactly once. We deliberately do NOT call
      // connect() recursively here — that re-enters bootstrapSchema and
      // risks a schema transaction conflict.
      if (this.#isAuthError(error)) {
        this.logger.warn?.("[memory] SurrealDB auth expired; reconnecting and retrying once");
        await this.#reauthenticate();
        const fresh = await this.connect();
        return fresh.query(statement, sanitizeSurrealValue(variables));
      }
      throw error;
    }
  }

  #isAuthError(error) {
    if (!error) return false;
    const status = error.status || error.response?.status || error.cause?.status;
    if (status === 401) return true;
    const message = String(error.message || "");
    return /token has expired|unauthorized|invalid token|not enough permissions/i.test(message);
  }

  async #reauthenticate() {
    // Close the dead connection (capture it BEFORE nulling this.db), then
    // drop cached state. We deliberately preserve schemaBootstrapped = true
    // because the schema is already applied in SurrealDB; re-bootstrapping
    // is what caused a TransactionConflict crash previously.
    const oldDb = this.db;
    this.db = null;
    this.connecting = null;
    if (oldDb?.close) {
      try { await oldDb.close(); } catch (_e) { /* best effort */ }
    }
  }

  async close() {
    if (!this.db) {
      return;
    }

    const db = this.db;
    this.db = null;
    this.connecting = null;
    this.schemaBootstrapped = false;
    await db.close();
  }
}

module.exports = {
  SurrealClient,
  getStatementRows,
  normalizeSurrealUrl,
  sanitizeSurrealValue
};
