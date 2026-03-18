const assert = require("assert");

const { getOllamaConfig, validateOllamaConfig } = require("../config/ollama");

const config = getOllamaConfig({});
assert.strictEqual(config.baseUrl, "http://127.0.0.1:11434/v1");

let threw = false;
try {
  validateOllamaConfig({ baseUrl: config.baseUrl, model: "" });
} catch (error) {
  threw = true;
}

assert.ok(threw, "Expected validation to throw when model is missing");

console.log("ollamaConfig tests passed");
