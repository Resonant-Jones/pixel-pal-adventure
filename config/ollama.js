function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function getOllamaConfig(env = process.env) {
  const baseUrl = stripTrailingSlash(
    env.OLLAMA_BASE_URL || env.OPENAI_BASE_URL || "http://127.0.0.1:11434/v1"
  );

  return {
    apiKey: env.OLLAMA_API_KEY || env.OPENAI_API_KEY || "ollama",
    baseUrl,
    model: env.OLLAMA_MODEL || env.OPENAI_MODEL || "",
    temperature: parseNumber(env.OLLAMA_TEMPERATURE, 0.6),
    maxTokens: parseNumber(env.OLLAMA_MAX_TOKENS, 220),
    timeoutMs: parseNumber(env.OLLAMA_TIMEOUT_MS, 30000)
  };
}

function validateOllamaConfig(config) {
  if (!config.baseUrl) {
    throw new Error("Ollama base URL missing. Set OLLAMA_BASE_URL.");
  }

  if (!config.model) {
    throw new Error("Ollama model missing. Set OLLAMA_MODEL.");
  }
}

module.exports = {
  getOllamaConfig,
  validateOllamaConfig
};
