# Troubleshooting Runbook

This is the practical recovery path for the most likely failures.

## Minecraft Connection Refused

- **Symptom:** the bot never spawns, or the runtime logs a connection failure right after startup.
- **Likely cause:** wrong host, wrong port, server down, firewall block, or auth mismatch.
- **Confirm:** verify the Minecraft server is listening, ping the host from the runtime machine, and check `MC_HOST`, `MC_PORT`, and `MC_AUTH`.
- **Mitigate:** fix the connection target, restart the runtime, and retry once the server is reachable.
- **Inspect:** `minecraft/bot.js`, `agent/agentRuntime.js`, `scripts/startAgent.js`, `.env`

## Bot Disconnect Loops

- **Symptom:** the runtime keeps reconnecting, then disconnects again a few seconds later.
- **Likely cause:** unstable server, version mismatch, auth problem, or a kicked session.
- **Confirm:** look for repeated `minecraft_reconnect_started` and `minecraft_reconnect_failed` events.
- **Mitigate:** stabilize the server, lower reconnect noise if needed, and verify the protocol/auth settings.
- **Inspect:** `minecraft/bot.js`, `agent/agentRuntime.js`, `agent/retrySignatures.js`, `config/*`

## Memory Write Failures

- **Symptom:** the bot chats, but messages and events stop appearing in SurrealDB.
- **Likely cause:** SurrealDB is down, the URL is wrong, the schema did not bootstrap, or the payload shape drifted.
- **Confirm:** check `npm run db:ready`, inspect SurrealDB logs, and look for `[memory] Failed to record event`.
- **Mitigate:** fix the database process or config, then restart the runtime so the schema can be re-applied.
- **Inspect:** `memory/surrealClient.js`, `memory/messageStore.js`, `memory/eventStore.js`, `schemas/surrealSchema.surql`

## Schema / Type Mismatch Failures

- **Symptom:** the dashboard shows blanks, the runtime throws on a config patch, or a query stops matching records.
- **Likely cause:** the JS runtime, dashboard contracts, and SurrealDB schema disagree about a field name or type.
- **Confirm:** compare the payload shape in the logs with the shared contracts and schema definition.
- **Mitigate:** align the shape in `shared/contracts/*`, the relevant store, and `schemas/surrealSchema.surql`.
- **Inspect:** `shared/contracts/*`, `agent/runtimeState.js`, `control/localControlServer.js`, `dashboard/src/store/runtimeStore.ts`

## Model / Provider Failures

- **Symptom:** turns fail before a reply is produced, or the response is malformed JSON / empty content.
- **Likely cause:** provider outage, timeout, bad API key, wrong base URL, or prompt/output mismatch.
- **Confirm:** reproduce a single request, inspect the provider client error, and check the provider-specific environment variables.
- **Mitigate:** fix credentials or provider availability, then restart the runtime if the provider config changed.
- **Inspect:** `ai/minimaxClient.js`, `ai/groqClient.js`, `ai/ollamaClient.js`, `ai/promptBuilder.js`, `config/*.js`

## Stalled Runtime Behavior

- **Symptom:** the runtime is up, but it appears to do nothing.
- **Likely cause:** it is paused, waiting on reconnect, backpressured, or blocked on a background loop.
- **Confirm:** inspect `/state` or the dashboard snapshot for `runtimeState.lifecycle`, `connectionHealth`, `retryState`, and `reconnectState`; `pendingTurns` is an internal counter that shows up indirectly through backpressure behavior.
- **Mitigate:** clear the reason for the stall rather than restarting blindly.
- **Inspect:** `agent/agentRuntime.js`, `agent/runtimeState.js`, `agent/stateProjector.js`, `dashboard/src/components/BuilderMode.tsx`

## Runaway Retries

- **Symptom:** the runtime keeps retrying the same turn and never settles.
- **Likely cause:** a repeated action failure, a provider formatting issue, or a connection failure that keeps looking retryable.
- **Confirm:** inspect the failure signature and whether the same `retryDomain` repeats.
- **Mitigate:** lower retry attempts temporarily, fix the root cause, and watch for `retry_loop_detected`.
- **Inspect:** `agent/retryCoordinator.js`, `agent/retrySignatures.js`, `structures/retrySchemas.js`, `memory/learningStore.js`

## Build Job Problems

- **Symptom:** a build request is accepted but never completes, or the bot says it lacks materials.
- **Likely cause:** no valid build site, missing materials, or a blocked placement.
- **Confirm:** inspect the build job in `jobs` and the `buildWorker` logs.
- **Mitigate:** provide materials, pick a clearer anchor, or lower the structure size.
- **Inspect:** `builder/buildWorker.js`, `builder/structureCompiler.js`, `minecraft/bot.js`, `memory/jobStore.js`

## Known Risks / Gaps

- Many failures are classified by heuristics, so operator judgment still matters.
- The runtime may recover on its own after a reconnect or retry. Prefer confirming state before restarting a healthy process.
- Some partial failures only show up in the data trail, not as immediate user-visible errors.
