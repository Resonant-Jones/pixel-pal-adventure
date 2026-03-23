# Runtime Components

This document breaks down the process-level and service-level dependencies that the agent relies on.

## Process Responsibilities

| Process / component | Responsibility | Code path |
| --- | --- | --- |
| Node agent process | Owns startup, runtime orchestration, retries, reconnects, and shutdown | `scripts/startAgent.js`, `agent/agentRuntime.js` |
| Mineflayer bot | Joins Minecraft, observes the world, and executes movement/chat/block actions | `minecraft/bot.js` |
| SurrealDB | Durable memory, jobs, identity, and retry learning | `memory/*`, `schemas/surrealSchema.surql` |
| Model provider | OpenAI-compatible chat completions and summaries | `ai/*Client.js` |
| Local control plane | Exposes runtime state and commands to the dashboard | `control/localControlServer.js` |
| Dashboard | Human operator surface and local runtime bootstrap | `dashboard/src-tauri/src/main.rs`, `dashboard/src/store/runtimeStore.ts` |

## External Services And Dependencies

### SurrealDB

`memory/surrealClient.js` connects to SurrealDB and bootstraps `schemas/surrealSchema.surql` on first connect.

Supported URL shapes in code:

- `http://...`
- `https://...`
- `ws://...`
- `wss://...`
- `mem://...`
- `rocksdb://...`
- `surrealkv://...`
- `surrealkv+versioned://...`

The default local setup uses `http://127.0.0.1:8000` plus `npm run db:start`.

### Model Providers

The runtime supports OpenAI-compatible `/chat/completions` endpoints through three client wrappers:

- `ai/minimaxClient.js`
- `ai/groqClient.js`
- `ai/ollamaClient.js`

They all:

- send the system prompt and user prompt as a two-message chat
- parse structured JSON replies for turn execution
- provide a low-temperature `summarizeAdventure()` path
- normalize malformed or fenced model output

### Minecraft Server / Client Assumptions

`minecraft/bot.js` assumes:

- a Mineflayer-compatible Minecraft Java server
- the bot can authenticate as `MC_AUTH`
- the world is reachable at `MC_HOST:MC_PORT`
- the bot can see and pathfind with `mineflayer-pathfinder`
- the primary player is identifiable by name

The adapter uses the Mineflayer bot entity as the source of world position, inventory, block access, and pathing.

### Control Plane And Dashboard

The dashboard launches the agent through Tauri using `dashboard/src-tauri/src/main.rs`.

- It picks a free localhost port.
- It generates a random auth token.
- It passes `GUARDIAN_CONTROL_HOST`, `GUARDIAN_CONTROL_PORT`, and `GUARDIAN_CONTROL_TOKEN` to `scripts/startAgent.js`.
- `control/localControlServer.js` exposes `/state`, `/config`, `/learning/what-worked`, and `/command/*` behind that token.

## SurrealDB Usage

The runtime does not use an ORM. It writes records directly with `CREATE`, `UPDATE`, `UPSERT`, and `RELATE`.

Important schema bootstrapping lives in `memory/surrealClient.js`:

- the database connection is opened once
- the schema file is read from `schemas/surrealSchema.surql`
- the schema is executed before the stores are used

`schemas/surrealSchema.surql` also defines event triggers that create reflex jobs from events. That means the database is part of the automation runtime, not just a passive store.

## Config / Env Requirements

Minimum viable startup usually needs:

- Minecraft host and port
- primary player name
- bot username
- one model provider and its credentials
- SurrealDB URL, namespace, and database

The exact variable list is documented in [configuration.md](configuration.md).

## Known Risks / Gaps

- The runtime is single-process and single-node by design. There is no leader election or multi-agent coordination layer in this repo.
- The dashboard and runtime share a local trust boundary. The token protects the control plane, but this is still a local operator tool, not a public API.
- Provider clients assume OpenAI-compatible responses. Non-compatible providers need an adapter layer before they can be dropped in.
