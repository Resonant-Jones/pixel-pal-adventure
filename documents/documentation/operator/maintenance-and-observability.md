# Maintenance And Observability

The system is observable through logs, the control plane, SurrealDB, and the dashboard event feed. There is not yet a separate metrics backend, so maintenance is mostly about watching the right signals and keeping the data trail clean.

## Signals To Watch

| Signal | Why it matters | Where it appears |
| --- | --- | --- |
| Runtime lifecycle | Tells you whether the process is booting, ready, reconnecting, stopping, or erroring | `agent/runtimeState.js`, dashboard status |
| Connection health | Shows whether the Minecraft edge is healthy | `agent/runtimeState.js`, dashboard diagnostics |
| Retry outcome | Reveals repeated turn failures and loop detection | `agent/retryCoordinator.js`, `memory/learningStore.js` |
| Reconnect count | Reveals server instability or auth problems | `agent/runtimeState.js`, `control/localControlServer.js` events |
| Backpressure / queue depth | Reveals the runtime is saturated | `agent/agentRuntime.js`, dashboard queue view |
| Memory write errors | Reveals durability problems | agent logs and SurrealDB logs |
| Build job status | Reveals whether build work is moving | `jobs` table, dashboard logs |

## Good Places To Improve Instrumentation

- `agent/agentRuntime.js`
  - turn duration
  - retry attempt duration
  - reconnect duration
  - queue depth changes

- `minecraft/bot.js`
  - connect latency
  - pathfinding failures
  - block placement success / failure counts

- `memory/surrealClient.js`
  - query latency
  - schema bootstrap timing
  - write failure counts

- `ai/*Client.js`
  - provider latency
  - parse mode distribution
  - timeout counts

- `builder/buildWorker.js`
  - material shortage counts
  - build-site rejection reasons
  - completion progress

## Suggested Health Checks

1. `GET /health` should return `ok: true`.
2. `GET /ready` should return `ready: true` once the bot is spawned and the runtime is accepting work.
3. `/state` should show a healthy lifecycle and a non-null world/session after startup.
4. The dashboard should receive a `runtime_snapshot` event and then a steady stream of ordered events.
5. The SurrealDB data set should keep growing during normal play.

## Weekly Review Ritual

Use a short weekly pass to answer these questions:

- Did the runtime spend time in reconnecting or error more than expected?
- Are the same retry signatures repeating?
- Are build jobs getting stuck in pending or failed?
- Did the event stream stop growing even though players were active?
- Did `what worked` summaries change in a way that makes sense?
- Are any live config changes drifting away from the saved default profile?

## Operational Hygiene

- Keep `.env.example` in sync with any new startup-only settings.
- Keep `shared/contracts/*` synchronized with the dashboard and runtime state.
- Keep `schemas/surrealSchema.surql` synchronized with the store payloads.
- Prefer adding a new event type over silently mutating an existing one.

## Known Risks / Gaps

- There is no dedicated metrics system yet, so logs and the event stream are the main truth source.
- Some of the most important failure modes are still visible only through manual inspection of structured JSON events.
- If the dashboard and runtime contracts drift, observability can become misleading even when the process is healthy.
