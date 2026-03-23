# Operator Guide

This guide is for the person standing next to the runtime while it is running.

## Start The System

1. Start SurrealDB.

```bash
npm run db:start
```

2. Start the agent.

```bash
npm start
```

3. Optional: start the dashboard.

```bash
cd dashboard
npm run tauri:dev
```

If the dashboard is used, it can launch the runtime itself and connect to the local control plane automatically.

## Verify It Is Healthy

The healthy path usually looks like this:

- SurrealDB prints a successful connection and schema bootstrap.
- The bot spawns in the Minecraft world.
- The runtime reaches `ready`.
- `connectionHealth` is `healthy`.
- The event stream shows `session_start`, `world_entered`, `spawn`, and then chat or reflex activity.

Useful checks:

- `npm run db:ready`
- `GET /health` on the local control server
- `GET /ready` on the local control server
- Dashboard status indicators in `dashboard/src/components/BuilderMode.tsx`

## Observe Logs

Primary places to watch:

- agent stdout/stderr from `scripts/startAgent.js`
- SurrealDB logs
- the dashboard event feed
- the structured event stream in `control/localControlServer.js`

Useful file references:

- `scripts/startAgent.js`
- `agent/agentRuntime.js`
- `control/localControlServer.js`
- `dashboard/src/store/runtimeStore.ts`

## What Normal Looks Like

Normal behavior is:

- one active turn at a time
- short in-world replies
- occasional reflex messages, not constant chatter
- build jobs progressing only when a build was requested
- reconnects only when the Minecraft connection actually drops
- memory writes succeeding without repeated storage errors
- the dashboard event feed slowly advancing, not flooding

## Detect Retry Storms

Signs:

- repeated `retry_started` and `retry_stopped` events
- the same failure signature appearing again and again
- `runtimeState.retryState.loopDetected` becomes `true`
- the same turn keeps failing before any useful action executes

What to do:

- inspect the latest failure text
- check whether the provider or action layer is returning the same error repeatedly
- reduce `AGENT_RETRY_MAX_ATTEMPTS` temporarily if the loop is noisy
- look at `memory/learningStore.js` guidance summaries

## Detect Reconnect Loops

Signs:

- repeated `minecraft_reconnect_started`
- repeated `minecraft_reconnect_failed`
- `connectionHealth` stays `disconnected`
- `reconnectState.attemptCount` keeps climbing
- the bot never returns to `ready`

What to do:

- confirm the server is reachable
- confirm `MC_HOST`, `MC_PORT`, and `MC_AUTH`
- inspect Mineflayer errors in `minecraft/bot.js`
- inspect reconnect policy in `agent/agentRuntime.js`

## Identify Memory Write Failures

Signs:

- chat is happening, but `messages` or `events` do not grow
- the logs show `[memory] Failed to record event`
- learning summaries are stale or empty
- reflex triggers do not appear even though world signals are being seen

What to do:

- check the SurrealDB process first
- check `SURREAL_URL`, `SURREAL_NAMESPACE`, and `SURREAL_DATABASE`
- inspect `memory/surrealClient.js`
- inspect `schemas/surrealSchema.surql`

## Normal Operator Responses

- If the bot is merely quiet, check whether it is paused, backpressured, or disconnected before assuming it is broken.
- If the dashboard is stale, check the WebSocket connection and the control-plane token.
- If a build request is stuck, check materials, build-site selection, and build-job status.
- If a reflex seems too chatty, check the cooldown state in `reflex_state`.

## Known Risks / Gaps

- The runtime is intentionally chatty in logs but light on formal metrics.
- The dashboard is useful, but the control plane still has to be trusted as a local operator interface.
- Some failures only show up as structured event drift, not as obvious user-facing errors.
