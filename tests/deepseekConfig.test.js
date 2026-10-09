const assert = require("assert");

const { getDeepSeekConfig, validateDeepSeekConfig } = require("../config/deepseek");

// DeepSeek is wired as a first-class provider because the MiniMax Coding Plan
// rejects general chat with HTTP 405 ("Coding Plan is currently only available
// for Coding Agents"), which silently killed most turns and made the companion
// read as dull. Its API is OpenAI-compatible, so it reuses the same client.

const tests = [
  {
    name: "defaults match DeepSeek's published endpoints",
    env: { DEEPSEEK_API_KEY: "sk-test" },
    expect(config) {
      assert.strictEqual(config.baseUrl, "https://api.deepseek.com");
      assert.strictEqual(config.model, "deepseek-flash");
      assert.strictEqual(config.apiKey, "sk-test");
      assert.strictEqual(config.providerLabel, "DeepSeek");
    }
  },
  {
    name: "env overrides win",
    env: {
      DEEPSEEK_API_KEY: "sk-2",
      DEEPSEEK_BASE_URL: "https://proxy.example.com/",
      DEEPSEEK_MODEL: "deepseek-v4-pro",
      DEEPSEEK_MAX_TOKENS: "900",
      DEEPSEEK_TEMPERATURE: "0.3"
    },
    expect(config) {
      assert.strictEqual(config.baseUrl, "https://proxy.example.com", "trailing slash stripped");
      assert.strictEqual(config.model, "deepseek-v4-pro");
      assert.strictEqual(config.maxTokens, 900);
      assert.strictEqual(config.temperature, 0.3);
    }
  },
  {
    name: "invalid numbers fall back rather than poisoning the request",
    env: { DEEPSEEK_API_KEY: "sk-test", DEEPSEEK_MAX_TOKENS: "lots", DEEPSEEK_TEMPERATURE: "" },
    expect(config) {
      assert.strictEqual(config.maxTokens, 600);
      assert.strictEqual(config.temperature, 0.8);
    }
  }
];

for (const test of tests) {
  const config = getDeepSeekConfig(test.env);
  test.expect(config);
  validateDeepSeekConfig(config);
  console.log(`  ✓ ${test.name}`);
}

assert.throws(
  () => validateDeepSeekConfig(getDeepSeekConfig({})),
  /DeepSeek API key missing/,
  "a missing key must fail loudly, never fall through to another provider"
);
console.log("  ✓ a missing key fails loudly");

// --- Reasoning must be off by default ---------------------------------------
//
// deepseek-flash spends part of max_tokens on hidden reasoning before emitting
// any visible content. Verified live: the same prompt cost 122 reasoning + 14
// content tokens with thinking on, versus 12 total with it off. Left on, a
// short budget can be fully consumed by reasoning and the API returns an empty
// message — which the runtime treats as non_retryable, so the companion goes
// silent mid-conversation.

const defaultConfig = getDeepSeekConfig({ DEEPSEEK_API_KEY: "sk-test" });
assert.deepStrictEqual(
  defaultConfig.extraBody,
  { thinking: { type: "disabled" } },
  "thinking must default to disabled so replies are never swallowed by reasoning"
);
console.log("  ✓ thinking is disabled by default");

const thinkingOn = getDeepSeekConfig({
  DEEPSEEK_API_KEY: "sk-test",
  DEEPSEEK_THINKING: "enabled"
});
assert.deepStrictEqual(
  thinkingOn.extraBody,
  { thinking: { type: "enabled" } },
  "DEEPSEEK_THINKING=enabled must opt back in"
);
console.log("  ✓ reasoning can be opted into explicitly");

// With reasoning off, the token budget buys visible content only — this must
// stay comfortably above a two-sentence reply.
assert.ok(
  defaultConfig.maxTokens >= 400,
  `maxTokens must leave room for a real reply, got ${defaultConfig.maxTokens}`
);
console.log("  ✓ token budget allows a full reply");

console.log("deepSeekConfig tests passed");