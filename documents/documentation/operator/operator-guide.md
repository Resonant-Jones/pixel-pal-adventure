# Operator Guide

This guide is for the person standing next to the runtime while it is running.

## Campaign: Guardian's First Real Adventure

The campaign finishes after two observed 30-minute iPad sessions, one after a
stack restart, with working chat, follow/stop, location tag/recall, controlled
survival reactions, and recorded feedback from the child. Preparation tests do
not replace these sessions. Neither session has been completed yet.

### Before the first session

From the repository root:

```bash
npm test
npm run check
npm run verify:memory
npm run verify:adventure
./scripts/verifyCrossplay.sh
```

`verify:memory` starts its own temporary SurrealDB on a free loopback port,
uses synthetic data, restarts that database, and removes its own temporary
directory after shutdown. It never opens the family's database or world.

`verify:adventure` needs Java and the already cached, EULA-accepted Paper
1.21.11 build 132 installation under `minecraft-server/`. It downloads nothing
and starts a separate server on a free loopback port in a fresh flat world.
Synthetic Java clients exercise chat delivery, physical follow/stop, actual
location teleportation, a zombie fight interrupted by a creeper, reconnect,
and duplicate-login halt. A second client observes movement; respawning
elsewhere does not count as an escape. Model responses and memory stores are
fixtures. This does not prove Bedrock authentication, natural replies, durable
memory, or your son's play experience. Receipts with source hashes, observations,
and console output remain in `.local/campaign-adventure-proof-*`; the script
removes its own world/cache after graceful shutdown. It never joins, restarts,
or alters the family server. Allow roughly 300 MB of temporary disk space and
1 GB of JVM memory for this optional rehearsal.

The crossplay verifier checks listeners, plugin files, and disk configuration.
It deliberately reports effective authentication as unverified. Log modification
times cannot prove when configuration was loaded, and an update-check warning
is not a plugin startup failure. A successful iPad login is still required.

Guardian must run the edited source. Stop its existing terminal process with
Ctrl+C before starting one copy. If Geyser configuration changed since Paper
started, run `./scripts/restartPaper.sh` in the parent's Terminal; it saves the
world and then launches the stack. If Paper is already configured and only
Guardian needs starting, run `node scripts/startStack.js`. Never start two
stacks with the same bot username. Stop Guardian before closing the laptop lid.

On the iPad, use **Play → Servers → Add Server**, the LAN address printed by
the verifier, and port **19132**. Keep both devices on the same Wi-Fi. Record
the name Paper actually sees, including any Floodgate prefix.

### Session one: recognize, follow, remember

1. Record start time and confirm the iPad player appears in Paper's player
   list or join log. This proves an actual connection rather than an open port.
2. Send ordinary chat without mentioning Guardian. Confirm a short reply.
3. Say `follow me`, walk away, then say `stop following`. Continue walking and
   confirm it stays stopped. Say `follow me` again and confirm it resumes.
4. Stand at a memorable, safe spot and say `tag this spot as the diamond cave`.
   Move elsewhere and say `take me back to the diamond cave`. Confirm the player
   arrives at the tagged position. Request an unknown place and confirm refusal.
5. Spend the rest of the 30 minutes exploring together. Note delays, repetition,
   unwanted movement, deaths, or building that interferes with play.
6. Record end time and ask: "What should Guardian be called?", "What should it
   remember?", and "What should it do when you're not talking to it?" Write the
   answers verbatim, without turning them into a feature proposal yet.

### Session two: restart and danger

1. With the child disconnected, stop Guardian and gracefully stop Paper and
   SurrealDB using their owning terminals. Confirm shutdown and world saving.
   Restart the same stack with the same world, database path, and player
   configuration. Record which services were actually restarted.
2. Rejoin from the iPad and repeat ordinary chat and follow/stop. Recall the
   previously tagged diamond cave before tagging any new spot. Confirm its
   original position survived.
3. In a parent-controlled encounter away from valued builds, observe Guardian
   facing an ordinary hostile, then a creeper while occupied. Confirm retreat
   takes priority, following does not steer it back into danger, and movement
   resumes afterward. Record the actual outcome, including a death or a failed
   escape. Code-level reaction events alone do not prove successful survival.
4. Complete 30 minutes of play and capture the child's exact feedback again.

Use a separate parent-only test for connection recovery and one controlled
duplicate-login attempt. The second login must be a single Minecraft client,
not another auto-reconnecting Guardian stack. Expect the original Guardian to
halt once, preserve the duplicate-session status, and make no further login
attempts. Close the extra client before restarting the original Guardian.
Record live observations separately from the simulated lifecycle test results.

### Evidence to record in HANDOFF.md

For each session, record the date, start/end times, actual server-side player
name, source revision or uncommitted changes used, services restarted, results
of each interaction, encounter outcomes, and the child's verbatim feedback.
Mark failed or unobserved items explicitly. Never include credentials, tokens,
or Floodgate key contents. The campaign remains incomplete until every live
acceptance item is demonstrated.

### Memory and trust boundaries

Paper owns live game state; local SurrealDB owns durable memories. The Mac
runs Guardian, Paper, and SurrealDB. The iPad crosses the LAN/device boundary
through Geyser and Floodgate. Name aliases are a compatibility rule based on
Paper's player list, not a cryptographic account identity. This deployment
assumes trusted family devices; its offline Java login mode is not a permission
boundary against malicious network peers.

Default chat observation is limited to the configured primary player. Model
context is filtered by player/companion, world, and memory thread. Enabling
`RESPOND_TO_ALL_PLAYERS` explicitly expands observation. Saved location recall
checks player, world, and thread ownership. Existing player-owned tags without
thread metadata remain readable by that player; unowned operator anchors and
unowned legacy summaries remain stored but are excluded from automatic recall.
Cross-dimension recall refuses to teleport using same-dimension coordinates.

When an external model is selected, the formatted current message, scoped chat
history, events, owned summaries, feedback/build status, and world snapshot
leave the Mac. The snapshot can contain nearby player names and coordinates.
Periodic adventure summarization also sends scoped messages and events. Local
storage does not make these model requests local. Deterministic follow, location
commands, and survival reactions do not require a model call. Provider changes
remain startup configuration plus restart; this campaign does not add semantic
memory, voice, scheduled world work, or frontend components.

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
