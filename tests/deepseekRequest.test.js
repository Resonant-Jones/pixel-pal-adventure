// Integration check: stand up a local server that impersonates DeepSeek and
// assert the model name from .env actually reaches the wire. Uses no network
// and no real key, so it is safe to run anywhere.
const assert = require("assert");
const http = require("node:http");

const { GroqClient } = require("../ai/groqClient");
const { getDeepSeekConfig } = require("../config/deepseek");

async function captureRequest(configOverrides, label, expectModel) {
  let captured = null;

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        captured = { url: req.url, auth: req.headers.authorization, body: JSON.parse(body) };
      } catch (e) {
        captured = { url: req.url, auth: req.headers.authorization, raw: body };
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  const env = { DEEPSEEK_API_KEY: "sk-test", ...configOverrides };
  const config = getDeepSeekConfig(env);
  config.baseUrl = `http://127.0.0.1:${port}`;

  const client = new GroqClient(config);
  await client.complete({ systemPrompt: "sys", userPrompt: "hello" });

  await new Promise((resolve) => server.close(resolve));

  assert.ok(captured, `${label}: server saw no request`);
  assert.strictEqual(captured.url, "/chat/completions", `${label}: wrong endpoint path`);
  assert.strictEqual(captured.auth, "Bearer sk-test", `${label}: auth header wrong`);
  assert.strictEqual(
    captured.body.model,
    expectModel,
    `${label}: model sent to the API was "${captured.body.model}", expected "${expectModel}"`
  );

  console.log(
    `  ✓ ${label} → POST ${captured.url} model="${captured.body.model}" ` +
      `temp=${captured.body.temperature} max_tokens=${captured.body.max_tokens}`
  );
  return captured;
}

(async () => {
  console.log("deepseek request-shape tests");

  await captureRequest({}, "default (no overrides)", "deepseek-flash");
  await captureRequest({ DEEPSEEK_MODEL: "deepseek-v4-pro" }, "pro model override", "deepseek-v4-pro");
  await captureRequest({ DEEPSEEK_MODEL: "deepseek-v4-flash" }, "legacy flash name", "deepseek-v4-flash");

  console.log("deepseek request-shape tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});