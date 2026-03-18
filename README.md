# Minecraft AI Companion

Lightweight Minecraft Java companion for Sage, built around Mineflayer, SurrealDB, and an OpenAI-compatible LLM provider (MiniMax, Groq, or Ollama). The bot joins the world as a normal player, chats in-world, captures a lightweight world snapshot for context, and persists memory across restarts without vector infrastructure.

## What this build covers

- Mineflayer bot login and in-world chat loop
- LLM reasoning through the OpenAI-compatible chat endpoint
- SurrealDB-backed message and event memory with timestamps
- Recent-window memory retrieval for low-resource contextual replies
- Periodic adventure memory distillation into compact `adventure_summary` events
- World/session-aware persistence through `worlds`, `sessions`, `jobs`, and `reflex_state`
- Database-driven reflexes for danger, discoveries, dusk, idleness, and remembered places without an LLM call
- Lightweight world snapshots: player position, health, hunger, time of day, nearby entities, nearby blocks, focused player state
- Structured actions: `follow_player`, `stop_following`, `move_to`, `look_at`, `chat`
- Structured build/inventory actions: `compose_structure`, `build_structure`, `inventory_status`, `dig_block`, `place_block`
- Direct Sage control commands: `follow me`, `stop following`, `build a cozy cabin`, `build a bridge`, `what do you have`, `what worked`
- Deterministic `thread_id` scoping so memory survives restarts and can later map cleanly into Codexify

## Minimal Viable Network

Nodes:
- Sage's Minecraft client
- Minecraft world host or LAN server
- Guardian runtime (Node.js + Mineflayer)
- Local or home-server SurrealDB
- LLM API (MiniMax, Groq, or Ollama)

Trust boundaries:
- Device boundary: Sage client vs home server runtime
- Network boundary: local Minecraft traffic vs outbound LLM API calls
- Identity boundary: by default only `PRIMARY_PLAYER` is treated as the trusted primary speaker
- Persistence boundary: SurrealDB is the source of truth for remembered messages and events

Threat model for v1:
- Designed for honest-but-buggy local components
- Not hardened against malicious Minecraft players or a compromised host
- Secrets stay in env vars; access control is enforced in code through player filtering, not prompt text

## Resource posture

This implementation keeps retrieval simple:
- message context is a recent window, not semantic search
- event context is a small recent tail, not a heavy analytics pipeline
- SurrealDB acts as event store, message memory, and lightweight graph substrate

That keeps the system aligned with a modest iMac or Mac Mini setup.

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Start SurrealDB in a separate terminal with persistent on-disk storage:

```bash
npm run db:start
```

This stores the local database under `.local/guardian-memory`.

3. Copy `.env.example` to `.env` and set at least:
- `LLM_PROVIDER` if you want Groq or Ollama (`minimax` is the default)
- `MINIMAX_API_KEY` (MiniMax) or `GROQ_API_KEY` + `GROQ_BASE_URL` + `GROQ_MODEL` (Groq) or `OLLAMA_MODEL` (+ optional `OLLAMA_BASE_URL`)
- `MC_HOST`
- `MC_PORT`
- `PRIMARY_PLAYER`
- `MC_BOT_USERNAME`

4. Start the agent:

```bash
npm start
```

Optional readiness check:

```bash
npm run db:ready
```

## Core environment settings

Minecraft:
- `MC_HOST`, `MC_PORT`: server or LAN host to join
- `MC_AUTH`: `offline` for local/LAN or `microsoft` for authenticated servers
- `PRIMARY_PLAYER`: trusted primary user, defaults to `Sage`
- `MC_PRIMARY_PLAYER`: legacy alias for `PRIMARY_PLAYER`
- `MC_BOT_USERNAME`: in-game bot username, defaults to `Guardian`
- `MC_THREAD_ID`: optional explicit memory scope override

LLM provider:
- `LLM_PROVIDER`: `minimax` (default), `groq`, or `ollama`

MiniMax:
- `MINIMAX_API_KEY`
- `MINIMAX_BASE_URL`: defaults to `https://api.minimax.io/v1`
- `MINIMAX_MODEL`: defaults to `MiniMax-M2.5`

Groq:
- `GROQ_API_KEY`
- `GROQ_BASE_URL`: defaults to `https://api.groq.com/openai/v1`
- `GROQ_MODEL`: defaults to `qwen/qwen3-32b`

Ollama:
- `OLLAMA_BASE_URL`: defaults to `http://127.0.0.1:11434/v1`
- `OLLAMA_MODEL`: local Ollama model name (required)
- `OLLAMA_API_KEY`: optional, defaults to `ollama`

SurrealDB:
- `SURREAL_URL`: defaults to `http://127.0.0.1:8000`
- `SURREAL_NAMESPACE`
- `SURREAL_DATABASE`
- `SURREAL_USERNAME`
- `SURREAL_PASSWORD`

Runtime:
- `AGENT_MEMORY_WINDOW`: recent message count, default `12`
- `AGENT_EVENT_WINDOW`: recent event count, default `6`
- `AGENT_SUMMARY_INTERVAL`: observed chat messages between summary jobs, default `24`
- `AGENT_SUMMARY_WINDOW`: recent message window used for distillation, default `24`
- `AGENT_SUMMARY_CONTEXT_LIMIT`: number of stored summaries injected into future context, default `3`
- `AGENT_MAX_PENDING_TURNS`: queued chat turns before backpressure, default `4`
- `AGENT_REFLEX_INTERVAL_MS`: observation cadence for reflex classification, default `5000`
- `AGENT_REFLEX_WORKER_INTERVAL_MS`: polling interval for pending reflex jobs, default `1000`
- `AGENT_BUILD_WORKER_INTERVAL_MS`: polling interval for pending build jobs, default `1000`
- `AGENT_REFLEX_GLOBAL_COOLDOWN_MS`: minimum time between any reflex chats, default `60000`
- `AGENT_REFLEX_TRIGGER_COOLDOWN_MS`: minimum time between reflexes of the same type, default `180000`
- `AGENT_REFLEX_IDLE_THRESHOLD_MS`: idle threshold before `player_idle`, default `90000`
- `ALLOW_AUTO_GIVE_BUILD_MATERIALS`: in creative mode, let Guardian issue `/give Guardian ...` for missing build materials, default `false`
- `AGENT_BUILD_DEBUG`: log compiled build plans and material bills, default `false`
- `AGENT_RETRY_MAX_ATTEMPTS`: max per-turn attempts, default `3`
- `AGENT_RETRY_BASE_DELAY_MS`: retry backoff base delay, default `500`
- `AGENT_RETRY_MAX_DELAY_MS`: retry backoff max delay, default `5000`
- `AGENT_RETRY_JITTER`: retry backoff jitter, default `0.25`
- `AGENT_RETRY_GRAPH_FROM_ATTEMPT`: attempt index to inject retry guidance, default `2`
- `AGENT_RETRY_LOOP_THRESHOLD`: repeated failure threshold before stopping, default `3`

Reconnect:
- `MC_RECONNECT_MAX_ATTEMPTS`: reconnect attempts before giving up, default `5`
- `MC_RECONNECT_BASE_DELAY_MS`: reconnect backoff base delay, default `1000`
- `MC_RECONNECT_MAX_DELAY_MS`: reconnect backoff max delay, default `15000`
- `MC_RECONNECT_JITTER`: reconnect jitter, default `0.25`

## Data model

Tables:
- `worlds`: current world identity and last-seen metadata
- `sessions`: per-run session lifecycle for the active world
- `messages`: `thread_id`, `world_id`, `session_id`, `speaker`, `content`, `source`, `timestamp`, `metadata`
- `events`: `thread_id`, `world_id`, `session_id`, `type`, `description`, `location`, `actor`, `timestamp`, `snapshot`, `metadata`
- `characters`: companion identity and personality metadata
- `jobs`: queued deterministic reflex work
- `reflex_state`: cooldown tracking for automatic reflex chat

The runtime stores user chat, bot replies, world/session lifecycle events, reflex detections, reflex-triggered chat, and periodic `adventure_summary` distillations. Retrieval is intentionally recent-window based, with recent reflex history and the last few summaries injected as compact long-term memory.

Build composition:
- natural build requests are interpreted into `compose_structure`
- the compiler expands that into geometry primitives and a bill of materials
- a background build worker turns those into deterministic placement jobs
- supported v1 styles: `cabin`, `hut`, `tower`, `bridge`, `camp`

## Runtime flow

```text
Minecraft chat
  -> store inbound message
  -> capture world snapshot
  -> classify reflex events and let Surreal create reflex jobs
  -> execute pending reflex jobs without an LLM call
  -> load recent messages + recent events
  -> call LLM provider
  -> execute action
  -> store reply and action event
```

## Failure modes and mitigations

1. LLM latency or bursty chat
   Mitigation: turns are serialized and capped with a small queue to avoid runaway overlap.

2. SurrealDB unavailable
   Mitigation: startup fails early instead of silently running without persistence.

3. Player not visible for a movement action
   Mitigation: the action layer throws, the turn is logged, and the bot sends a fallback reply.

4. Minecraft disconnects
   Mitigation: session lifecycle events are recorded and shutdown is graceful.

5. World state drift between prompt and action
   Mitigation: movement actions are lightweight and non-blocking; later hardening can add revalidation before high-impact actions.

## Deployment notes

Local mode:
- Minecraft client and agent on Sage's machine
- SurrealDB local to the same machine

Home server mode:
- Minecraft server, agent, and SurrealDB on Mac Mini
- Sage joins from iMac client
- Set `MC_HOST` to the server address and keep `SURREAL_URL` local to the runtime host

## Codexify path

The runtime is intentionally modular:
- `minecraft/` handles protocol edges
- `memory/` owns persistence
- `ai/` owns LLM prompting and parsing
- `agent/` owns orchestration and action execution

That gives a clean seam to later replace the prompt/runtime layer with Codexify while preserving the Minecraft edge and Surreal memory model.
