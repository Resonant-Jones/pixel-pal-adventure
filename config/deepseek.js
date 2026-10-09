function parseNumber(value, fallback) {
  // An empty string is "unset", not zero. `Number("")` is 0 and would
  // otherwise silently pin temperature to 0 (fully deterministic, dull) or
  // maxTokens to 0 (no output at all) whenever a .env line is left blank.
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

// DeepSeek is OpenAI-compatible (https://api-docs.deepseek.com), so it reuses
// the same chat/completions client as the other OpenAI-shaped providers.
// Defaults follow DeepSeek's published endpoints and model names.
//
// Note on model choice: `deepseek-flash` is the fast/cheap default and is the
// right pick for in-game chat, where a turn must land in under a second.
// `deepseek-v4-pro` is the stronger reasoning model but slower and dearer —
// better suited to offline analysis than to a kid waiting on a reply.
function getDeepSeekConfig(env = process.env) {
  const baseUrl = stripTrailingSlash(env.DEEPSEEK_BASE_URL || "https://api.deepseek.com");

  return {
    apiKey: env.DEEPSEEK_API_KEY || "",
    baseUrl,
    model: env.DEEPSEEK_MODEL || "deepseek-flash",
    temperature: parseNumber(env.DEEPSEEK_TEMPERATURE, 0.8),
    // In-game chat is one or two sentences; anything more is wasted spend.
    maxTokens: parseNumber(env.DEEPSEEK_MAX_TOKENS, 600),
    timeoutMs: parseNumber(env.DEEPSEEK_TIMEOUT_MS, 30000),
    providerLabel: "DeepSeek",
    // `deepseek-flash` is a reasoning model: it spends part of max_tokens on
    // hidden reasoning BEFORE emitting any visible content. Verified against
    // the live API — the same prompt cost 122 reasoning + 14 content tokens
    // with thinking on, versus 12 total with it off.
    //
    // Left enabled, a short max_tokens gets consumed entirely by reasoning and
    // the API returns an empty message. The runtime classifies that as
    // "non_retryable" and the companion simply says nothing — which is exactly
    // what "it feels lobotomized" looks like from inside the game.
    //
    // Turn-based in-game banter does not need chain-of-thought, and a child
    // waiting on a reply does not want it. Set DEEPSEEK_THINKING=enabled to
    // trade latency for depth.
    extraBody:
      String(env.DEEPSEEK_THINKING || "disabled").toLowerCase() === "enabled"
        ? { thinking: { type: "enabled" } }
        : { thinking: { type: "disabled" } }
  };
}

function validateDeepSeekConfig(config) {
  if (!config.apiKey) {
    throw new Error(
      "DeepSeek API key missing. Set DEEPSEEK_API_KEY before starting the agent."
    );
  }

  if (!config.baseUrl) {
    throw new Error("DeepSeek base URL missing. Set DEEPSEEK_BASE_URL.");
  }

  if (!config.model) {
    throw new Error("DeepSeek model missing. Set DEEPSEEK_MODEL.");
  }
}

module.exports = {
  getDeepSeekConfig,
  validateDeepSeekConfig
};