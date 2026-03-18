function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function getMiniMaxConfig(env = process.env) {
  const baseUrl = stripTrailingSlash(
    env.MINIMAX_BASE_URL || env.OPENAI_BASE_URL || "https://api.minimax.io/v1"
  );

  return {
    apiKey: env.MINIMAX_API_KEY || env.OPENAI_API_KEY || "",
    baseUrl,
    model: env.MINIMAX_MODEL || "MiniMax-M2.5",
    temperature: parseNumber(env.MINIMAX_TEMPERATURE, 0.6),
    maxTokens: parseNumber(env.MINIMAX_MAX_TOKENS, 220),
    timeoutMs: parseNumber(env.MINIMAX_TIMEOUT_MS, 30000)
  };
}

function validateMiniMaxConfig(config) {
  if (!config.apiKey) {
    throw new Error(
      "MiniMax API key missing. Set MINIMAX_API_KEY or OPENAI_API_KEY before starting the agent."
    );
  }

  if (!config.baseUrl) {
    throw new Error("MiniMax base URL missing.");
  }
}

module.exports = {
  getMiniMaxConfig,
  validateMiniMaxConfig
};
