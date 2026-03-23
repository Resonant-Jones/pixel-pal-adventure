# Networking And Connectivity

The runtime has four important network edges:

1. Minecraft server/client traffic
2. Model provider API calls
3. SurrealDB access
4. Local control-plane traffic for the dashboard

## Minecraft Connection Expectations

`minecraft/bot.js` expects a Mineflayer-compatible Minecraft Java server reachable at `MC_HOST:MC_PORT`.

Relevant settings:

- `MC_HOST`
- `MC_PORT`
- `MC_AUTH`
- `MC_VERSION`
- `MC_FOLLOW_DISTANCE`

The adapter emits:

- `spawn` when the bot enters the world
- `chat` for in-world messages
- `entityMoved`, `entitySpawn`, `entityGone`, and `timeUpdate` for world signals
- `botError` and `end` when the connection breaks

## Reconnect Behavior

`agent/agentRuntime.js` owns reconnect policy.

When the connection breaks:

- the runtime marks itself unavailable
- the active turn is interrupted
- new turns wait behind a reconnect gate
- reconnect attempts use exponential backoff with jitter
- success creates a fresh session for the same world

Relevant env vars:

- `MC_RECONNECT_MAX_ATTEMPTS`
- `MC_RECONNECT_BASE_DELAY_MS`
- `MC_RECONNECT_MAX_DELAY_MS`
- `MC_RECONNECT_JITTER`

## ECONNREFUSED And Similar Errors

`ECONNREFUSED` usually means one of these is wrong:

- the host is wrong
- the port is wrong
- the Minecraft server is not running
- the firewall is blocking the connection
- the server is not reachable from the runtime machine

The code path to inspect first is:

- `minecraft/bot.js`
- `agent/agentRuntime.js`
- `.env` values for `MC_HOST`, `MC_PORT`, and `MC_AUTH`

**Working Theory:** not every refusal will surface with the exact string `ECONNREFUSED`. Some failures bubble up through Mineflayer as connection-end or kick errors, so the runtime's string-based classification may need operator interpretation.

## Timeout And Retry Considerations

- Model clients have their own `*_TIMEOUT_MS` settings.
- `agent/retryCoordinator.js` handles turn-level retry backoff.
- `agent/agentRuntime.js` gates reconnects independently of turn retries.
- SurrealDB reconnect behavior only turns on for `ws://` and `wss://` URLs in `memory/surrealClient.js`; the default local `http://` path does not use that transport-level reconnect knob.

## Operator Checks When Host / Port / Server State Is Wrong

1. Confirm the Minecraft server is actually running.
2. Confirm the runtime can reach the server host from the same machine or network segment.
3. Confirm the server version matches the configured `MC_VERSION`, or leave version unset if Mineflayer should auto-negotiate.
4. Confirm `MC_AUTH` matches the server's auth mode.
5. Confirm the bot username is not already in use.
6. Confirm the firewall and LAN routing rules allow the connection.

## Control Plane Connectivity

`control/localControlServer.js` binds to localhost by default:

- host: `127.0.0.1`
- port: `8787`

When launched from the dashboard, `dashboard/src-tauri/src/main.rs` passes a random port and auth token to the runtime. The dashboard then talks to the control server over local HTTP and WebSocket connections.

## Known Risks / Gaps

- Connection classification is heuristic. Unfamiliar error messages can land in the unknown bucket.
- There is no network retry queue for outbound model calls beyond the provider client timeout and the turn retry loop.
- The control plane is local-first, not multi-tenant or externally hardened.
