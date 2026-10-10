#!/usr/bin/env node

// Head-to-head provider benchmark for Guardian.
//
// Answers the question "is Groq faster/better than DeepSeek for in-game turns?"
// with measurements instead of vibes, by sending the REAL system and user prompt
// through the REAL client (ai/groqClient.js) that the agent uses at runtime.
//
// It does not touch the running stack, SurrealDB, or any saved state. It only
// makes chat/completions calls, which cost a fraction of a cent at these rates.
//
// Usage:
//   node scripts/benchmarkProviders.js                    # both providers, 3 turns each
//   node scripts/benchmarkProviders.js --runs 5
//   node scripts/benchmarkProviders.js --only groq
//   node scripts/benchmarkProviders.js --only deepseek --runs 1
//
// The metric that actually decides this is parseMode, not latency:
//   "structured"        -> the model honoured the JSON contract, actions run
//   "freeform_fallback" -> it chatted but emitted no JSON, so NO action executes
//   "rejected"          -> it emitted broken JSON, turn is discarded
// A provider can be the fastest thing on earth and still never build anything.

require("dotenv").config();

const { GroqClient } = require("../ai/groqClient");
const { getGroqConfig, validateGroqConfig } = require("../config/groq");
const { getDeepSeekConfig, validateDeepSeekConfig } = require("../config/deepseek");
const { buildSystemPrompt, buildUserPrompt, DEFAULT_ALLOWED_ACTIONS } = require("../ai/promptBuilder");

const RUNS = 3;

// A realistic mid-session turn: chat history, an adventure memory, a saved
// location, live world state, and a build request. Sized like the real thing.
const SCENARIO = {
  latestMessage: "come build me a little cabin here, and remember this spot as the river camp",
  recentMessages: [
    { timestamp: "2026-10-10T14:02:11Z", speaker: "SageTheMage", content: "yo guardian wanna come look at this cave i found" },
    { timestamp: "2026-10-10T14:02:14Z", speaker: "Guardian", content: "Diamonds at y=-50? That's a good find. I'll come down." },
    { timestamp: "2026-10-10T14:03:02Z", speaker: "SageTheMage", content: "thats way better than the one we lost to a creeper" },
    { timestamp: "2026-10-10T14:03:09Z", speaker: "Guardian", content: "That one had its own gravity, that lava did." }
  ],
  recentEvents: [
    { timestamp: "2026-10-10T14:03:30Z", actor: "SageTheMage", type: "player_chat", description: "come build me a little cabin here" },
    { timestamp: "2026-10-10T14:03:31Z", actor: "Guardian", type: "location_tagged", description: "labelled this spot river camp" },
    { timestamp: "2026-10-10T14:03:40Z", actor: "Guardian", type: "block_placed", description: "placed oak_log at 12,64,-8" }
  ],
  recentSummaries: [
    { timestamp: "2026-10-09T18:20:00Z", description: "Explored a limestone cave system, found a diamond vein at y=-50, lost a creeper hole to lava." }
  ],
  recentReflexEvents: [
    { timestamp: "2026-10-10T14:01:00Z", description: "noticed Sage digging straight and mentioned diamonds sit below y=-16" }
  ],
  spatialReferences: [
    { label: "the cave", x: 128, y: -50, z: -64, source: "player" },
    { label: "river camp", x: 12, y: 64, z: -8, source: "player" }
  ],
  worldSnapshot: {
    time_of_day: "day",
    biome: "plains",
    player_position: { x: 12, y: 64, z: -8 },
    nearby_players: ["SageTheMage"],
    nearby_mobs: [],
    nearby_entities: [],
    light_level: 15,
    weather: "clear"
  },
  playerState: { health: 20, hunger: 18, position: { x: 12, y: 64, z: -8 }, inventory: ["oak_log", "stone_axe"] }
};

function buildTurn(env) {
  const systemPrompt = buildSystemPrompt({
    companionName: env.MC_BOT_USERNAME || "Guardian",
    primaryPlayer: env.MC_PRIMARY_PLAYER || env.PRIMARY_PLAYER || "SageTheMage",
    role: env.COMPANION_ROLE || "Guardian is a friend who plays Minecraft",
    personality: env.COMPANION_PERSONALITY || "Quick, dry-funny, curious, loyal."
  });

  const userPrompt = buildUserPrompt({
    latestMessage: SCENARIO.latestMessage,
    allowedActions: DEFAULT_ALLOWED_ACTIONS,
    ...SCENARIO
  });

  return { systemPrompt, userPrompt };
}

function resolveProvider(which, env) {
  if (which === "groq") {
    const config = getGroqConfig(env);
    validateGroqConfig(config);
    return { which, config, client: new GroqClient(config) };
  }

  if (which === "deepseek") {
    const config = getDeepSeekConfig(env);
    validateDeepSeekConfig(config);
    return { which, config, client: new GroqClient(config) };
  }

  throw new Error(`Unknown provider "${which}"`);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function summarize(name, results) {
  const ok = results.filter((r) => r.ok);
  const failures = results.filter((r) => !r.ok);
  const latencies = ok.map((r) => r.latencyMs);
  const byMode = ok.reduce((acc, r) => {
    acc[r.parseMode] = (acc[r.parseMode] || 0) + 1;
    return acc;
  }, {});

  const promptTokens = ok.reduce((sum, r) => sum + (r.usage?.prompt_tokens || 0), 0);
  const completionTokens = ok.reduce((sum, r) => sum + (r.usage?.completion_tokens || 0), 0);

  console.log(`\n── ${name} ──`);
  console.log(`  ok            ${ok.length}/${results.length}`);
  if (failures.length) {
    console.log(`  failures      ${failures.map((f) => `${f.error}${f.status ? ` [${f.status}]` : ""}`).join("; ")}`);
  }
  if (!ok.length) return null;

  console.log(`  latency       median ${Math.round(median(latencies))}ms   min ${Math.min(...latencies)}ms   max ${Math.max(...latencies)}ms`);
  console.log(`  parseMode     ${Object.entries(byMode).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  console.log(`  actions       ${ok.map((r) => r.actionType).join(", ")}`);
  console.log(`  tokens        prompt ${promptTokens}  completion ${completionTokens}  (per call: ~${Math.round(promptTokens / ok.length)} in / ~${Math.round(completionTokens / ok.length)} out)`);
  ok.slice(0, 2).forEach((r, i) => {
    console.log(`  reply[${i}]     "${String(r.message).replace(/\s+/g, " ").slice(0, 150)}"`);
  });

  const avgIn = Math.round(promptTokens / ok.length);
  const declaredOut = ok[0]?.declaredMaxTokens || 0;
  const chargedPerCall = avgIn + declaredOut;

  return { avgIn, declaredOut, chargedPerCall, byMode, medianLatency: median(latencies) };
}

async function runProvider(which, env, runs) {
  const { config, client } = resolveProvider(which, env);
  console.log(`\n${"=".repeat(64)}`);
  console.log(`  ${which}: ${config.model}  (temp=${config.temperature} max_tokens=${config.maxTokens})`);
  console.log(`${"=".repeat(64)}`);

  const results = [];

  for (let i = 0; i < runs; i += 1) {
    const { systemPrompt, userPrompt } = buildTurn(env);
    const started = Date.now();

    try {
      const reply = await client.complete({ systemPrompt, userPrompt });
      const latencyMs = Date.now() - started;

      results.push({
        ok: true,
        latencyMs,
        parseMode: reply.parseMode,
        actionType: reply.action?.type,
        message: reply.message,
        usage: reply.providerResponse?.usage,
        declaredMaxTokens: config.maxTokens
      });

      console.log(`  run ${i + 1}: ${latencyMs}ms  parseMode=${reply.parseMode}  action=${reply.action?.type}`);
    } catch (error) {
      const latencyMs = Date.now() - started;
      const status = error.message.match(/\((\d{3})\)/)?.[1] || null;
      results.push({ ok: false, latencyMs, error: error.message.slice(0, 120), status });
      console.log(`  run ${i + 1}: ${latencyMs}ms  FAILED ${status || ""} ${error.message.slice(0, 120)}`);
    }
  }

  return summarize(which, results);
}

(async () => {
  const args = process.argv.slice(2);
  const runs = Number(args[args.indexOf("--runs") + 1]) || RUNS;
  const onlyIdx = args.indexOf("--only");
  const only = onlyIdx !== -1 ? args[onlyIdx + 1] : null;

  const env = process.env;
  const { systemPrompt } = buildTurn(env);
  console.log(`Guardian provider benchmark — ${runs} run(s) per provider`);
  console.log(`system prompt: ${systemPrompt.length} chars (~${Math.round(systemPrompt.length / 4)} tokens)`);
  console.log(`NOTE: live API calls. Real cost, but well under a cent at these rates.`);

  const targets = only ? [only] : ["deepseek", "groq"];
  const summaries = {};

  for (const which of targets) {
    try {
      summaries[which] = await runProvider(which, env, runs);
    } catch (error) {
      console.log(`\n── ${which} ──\n  SKIPPED: ${error.message}`);
    }
  }

  if (summaries.deepseek && summaries.groq) {
    const d = summaries.deepseek;
    const g = summaries.groq;

    console.log(`\n${"=".repeat(64)}`);
    console.log("  VERDICT");
    console.log(`${"=".repeat(64)}`);

    const dStructured = d.byMode.structured || 0;
    const gStructured = g.byMode.structured || 0;
    console.log(`  JSON contract honoured   deepseek ${dStructured}  vs  groq ${gStructured}`);

    if (d.medianLatency && g.medianLatency) {
      const ratio = g.medianLatency / d.medianLatency;
      console.log(`  median latency           deepseek ${Math.round(d.medianLatency)}ms  vs  groq ${Math.round(g.medianLatency)}ms  (groq is ${ratio.toFixed(2)}x)`);
    }

    console.log(`\n  Groq free-plan headroom (8,000 TPM / 200,000 TPD):`);
    console.log(`    charged per call  ~${g.chargedPerCall} (${g.avgIn} input + ${g.declaredOut} declared output)`);
    console.log(`    => ~${Math.floor(8000 / g.chargedPerCall)} calls/minute, ~${Math.floor(200000 / g.chargedPerCall)} calls/day`);
    console.log(`    Groq bills TPM against the DECLARED max_tokens, not what it generates.`);
    console.log(`    Lowering GROQ_MAX_TOKENS is the single biggest lever here.`);

    console.log(`\n  DeepSeek has no hard rate limit and bills ~$0.15/$0.60 per 1M tokens,`);
    console.log(`  so it does not degrade under a burst of in-game chatter.`);
  }

  console.log();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});