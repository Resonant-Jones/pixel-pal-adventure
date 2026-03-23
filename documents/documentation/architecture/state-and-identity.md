# State And Identity

The runtime uses several identity scopes. Some are durable, some are only in memory, and some are derived from the world itself.

## Identity Scopes

| Scope | What it identifies | Source | Durability |
| --- | --- | --- | --- |
| `thread_id` | The memory lane for one operator/world stream | `MC_THREAD_ID` or derived from host, port, and primary player | Durable |
| `world_id` | The current Minecraft world identity | `reflex/worldIdentity.js` hash of server address, spawn point, dimension, and server brand | Durable |
| `session_id` | One connected runtime session inside a world | `memory/sessionStore.js` | Durable |
| `turn_id` | One reasoning turn | `agent/agentRuntime.js#createTurnId()` | Transient + recorded in events |
| `attempt_id` | One retry attempt within a turn | `agent/agentRuntime.js#createAttemptId()` | Transient + recorded in learning events |
| `command_id` | One dashboard command or direct runtime command | Dashboard or `CommandService` | Durable in events |
| `signature` | One normalized failure shape for retry learning | `agent/retrySignatures.js` + `structures/retrySchemas.js` | Durable in learning events |

## World Identity

`reflex/worldIdentity.js` computes the world key from:

- server address
- spawn point
- dimension
- server brand

That keeps a world identity stable enough to survive restarts while still distinguishing different servers or dimensions.

## Runtime State

The live in-memory state is defined in `agent/runtimeState.js` and projected for the dashboard by `agent/stateProjector.js`.

### Transient State

- `lifecycle`
- `connectionHealth`
- `world`
- `activeTask`
- `queuedTasks`
- `interruptedTasks`
- `retryState`
- `reconnectState`
- `latestLearningSummary`
- `lastSequence`
- `updatedAt`

### Durable State

- `worlds`
- `sessions`
- `messages`
- `events`
- `learning_events`
- `learning_edges`
- `jobs`
- `reflex_state`
- `companion_identity`
- `saved_profiles`
- `anchors`

## Revision Counters

`agent/runtimeState.js` and `shared/contracts/config.ts` track revision numbers so the dashboard can tell whether config or identity changed:

- `configRevision`
- `identityRevision`
- `profileRevision`

These are incremented in `agent/agentRuntime.js#applyConfigPatch()`.

## Retry Signatures

Retry signatures are normalized so the runtime can learn from repeated failures without depending on exact stack traces.

The signature includes:

- retry domain: `llm`, `action`, or `connection`
- action type
- error code
- error category
- provider
- operation subtype
- signature version

`agent/retryCoordinator.js` uses those signatures to detect loops. `memory/learningStore.js` stores them in `learning_events` and queries them back for guidance.

## Learning State

The runtime keeps learning in two places:

- Durable history in `learning_events` and `learning_edges`
- The latest summary in `runtimeState.latestLearningSummary`

`agent/agentRuntime.js#queryWhatWorked()` uses the learning store to answer the operator's "what worked" command and to seed retry guidance during later attempts.

## Transient Versus Durable Boundaries

Keep this split in mind when changing code:

- If the runtime crashes, transient state disappears.
- If SurrealDB is healthy, durable state survives.
- The dashboard should treat runtime snapshots as a projection, not the original source of truth.

## Known Risks / Gaps

- World identity can change if the spawn point or server branding changes, even when the operator thinks they are still on the same "world."
- Retry signatures are intentionally compact and heuristic; they are useful for local guidance, not forensic-grade failure analysis.
- The runtime currently does not persist every transient field, so the dashboard snapshot is best treated as a live view, not an audit log.
