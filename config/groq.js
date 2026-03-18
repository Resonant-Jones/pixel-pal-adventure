function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function getGroqConfig(env = process.env) {
  const baseUrl = stripTrailingSlash(
    env.GROQ_BASE_URL || env.OPENAI_BASE_URL || "https://api.groq.com/openai/v1"
  );

  return {
    apiKey: env.GROQ_API_KEY || env.OPENAI_API_KEY || "",
    baseUrl,
    model: env.GROQ_MODEL || env.OPENAI_MODEL || "qwen/qwen3-32b",
    temperature: parseNumber(env.GROQ_TEMPERATURE, 0.6),
    maxTokens: parseNumber(env.GROQ_MAX_TOKENS, 220),
    timeoutMs: parseNumber(env.GROQ_TIMEOUT_MS, 30000)
  };
}

function validateGroqConfig(config) {
  if (!config.apiKey) {
    throw new Error("Groq API key missing. Set GROQ_API_KEY or OPENAI_API_KEY before starting the agent.");
  }

  if (!config.baseUrl) {
    throw new Error("Groq base URL missing. Set GROQ_BASE_URL or OPENAI_BASE_URL.");
  }

  if (!config.model) {
    throw new Error("Groq model missing. Set GROQ_MODEL or OPENAI_MODEL.");
  }
}

module.exports = {
  getGroqConfig,
  validateGroqConfig
};
