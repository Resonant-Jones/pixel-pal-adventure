function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getSurrealConfig(env = process.env) {
  return {
    url: env.SURREAL_URL || "http://127.0.0.1:8000",
    namespace: env.SURREAL_NAMESPACE || "minecraft",
    database: env.SURREAL_DATABASE || "companion",
    username: env.SURREAL_USERNAME || "",
    password: env.SURREAL_PASSWORD || "",
    connectTimeoutMs: parseNumber(env.SURREAL_CONNECT_TIMEOUT_MS, 10000)
  };
}

function validateSurrealConfig(config) {
  if (!config.url) {
    throw new Error("SurrealDB URL missing. Set SURREAL_URL before starting the agent.");
  }

  if (!config.namespace) {
    throw new Error("SurrealDB namespace missing.");
  }

  if (!config.database) {
    throw new Error("SurrealDB database missing.");
  }
}

module.exports = {
  getSurrealConfig,
  validateSurrealConfig
};
