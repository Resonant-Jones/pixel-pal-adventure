# Capability Audit — 2026-04-27

## Executive Summary

This is the baseline capability audit for the Minecraft Agent Runtime / Guardian Console project. The system has a structurally coherent design with well-defined layers: runtime orchestration, Mineflayer edge, SurrealDB persistence, model provider integration, and a Tauri dashboard. The implementation is largely complete across the intended surface, but live gameplay validation is absent. Most capabilities exist in code and compile successfully; runtime behavior under real Minecraft conditions has not been verified. The biggest unresolved risk is that the entire execution chain—bot connection, LLM response, action execution, retry, and reconnect—has never been observed in a live game session.

---

## Capability Snapshot

| Area | Status | Confidence | Trend | Score /5 |
|------|--------|------------|-------|----------|
| Runtime Architecture | Implemented | Medium | New | 3 |
| Control Plane | Implemented | Medium | New | 3 |
| Desktop Dashboard | Implemented | Medium | New | 3 |
| Identity + Profiles | Implemented | Medium | New | 3 |
| Anchors + Task Targeting | Implemented | Medium | New | 3 |
| Retry + Learning | Implemented | Medium | New | 3 |
| Reconnect + Recovery | Implemented | Medium | New | 3 |
| Safety + Correctness | Implemented | Low-Medium | New | 2 |
| Testing + Verification | Partial | Medium | New | 2 |
| Operator Readiness | Implemented | Medium | New | 3 |

---

## Detailed Findings

### 1. Runtime Architecture

**Status: Implemented — not live-validated**

`agent/agentRuntime.js` is the core state machine. It owns turn serialization, background loops, event binding, chat observation, and turn routing. The design separates concerns cleanly: `agentRuntime` decides, `commandService` dispatches, `stateProjector` clones, `runtimeState` defines the shape, and `actionExecutor` translates replies into Minecraft actions.

Key design elements:
- Headless runtime with no GUI dependency — boots from `scripts/startAgent.js`
- Turn serialization via a promise chain (`turnQueue`)
- Backpressure via `maxPendingTurns` with explicit drop behavior
- Adventure distillation triggered every N observed chats
- Command handlers registered for: pause, resume, reconnect, what_worked, run_task, anchor creation

**Evidence:** `agentRuntime.js` lines 1–2621, `runtimeState.js`, `stateProjector.js`, `commandService.js`, `agent/actionExecutor.js`

**What's implemented:** Complete runtime state machine, turn lifecycle, config patching, runtime event emission, background loop management.

**What's not verified:** No evidence of the runtime starting and completing a turn against a real Minecraft server. TypeScript type-check is listed in `package.json` but not yet executed as part of a CI pipeline. The build verification is `node --check` against individual files only.

**Sharpest risk:** The entire execution chain from chat message to bot action to learning record has never been run in a real game session.

---

### 2. Control Plane

**Status: Implemented — not live-validated**

`control/localControlServer.js` implements an HTTP REST surface with WebSocket streaming. Endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Liveness |
| `/ready` | GET | Readiness with auth check |
| `/state` | GET | Full runtime snapshot |
| `/config` | GET/PATCH | Config read and patch |
| `/learning/what-worked` | GET | Learning query |
| `/command/*` | POST | Command dispatch |
| `/events` | WS | Event stream |

Auth is token-based via `Authorization: Bearer <token>` header or `?token=` query param. Event bus uses monotonic sequence numbers. Dashboard reconnect logic is implemented in `runtimeStore.ts` with 1500ms backoff.

**Evidence:** `control/localControlServer.js`, `control/runtimeEventBus.js`, `dashboard/src/lib/runtimeClient.ts`

**What's implemented:** All listed endpoints, WebSocket event stream, heartbeat timer, reconnect scheduling.

**What's not verified:** No evidence that the control server has been hit by a real dashboard session. No health-check logs or connection logs in the repo. The WebSocket handshake and reconnection behavior have not been exercised.

**Sharpest risk:** The control plane is the only operator surface — if it breaks, there is no visibility into the runtime.

---

### 3. Desktop Dashboard

**Status: Implemented — not live-validated**

`dashboard/src/App.tsx` renders either `KidMode` or `BuilderMode` based on the runtime store state. The Tauri app is built (`guardian_dashboard` binary exists at `dashboard/src-tauri/target/release/`), confirming the Rust backend compiles.

`KidMode.tsx` exposes: companion name, personality preset (5 presets), verbosity, tone intensity, behavior mode, autonomy level, task input, anchor commands (look/marker/area), and a friendly activity feed.

`BuilderMode.tsx` exposes: status tab (lifecycle, world/session, reconnect state), config tab (live behavior, identity, revisions, profile application), learning tab (what worked), logs tab (raw event stream), and diagnostics tab (loop detection, queue state, provider info).

`shellSettingsStore.ts` handles settings loading, saving, runtime start/stop/restart via Tauri invoke.

**Evidence:** `dashboard/src/App.tsx`, `dashboard/src/components/KidMode.tsx`, `dashboard/src/components/BuilderMode.tsx`, `dashboard/src/store/runtimeStore.ts`, `dashboard/src/store/shellSettingsStore.ts`, `dashboard/src-tauri/tauri.conf.json`

**What's implemented:** Full dashboard UI, Tauri backend with runtime lifecycle management, WebSocket subscription, config patching.

**What's not verified:** The Tauri binary has not been run with a live Minecraft server. `start_runtime` via Tauri invoke has not been exercised. Profile switching end-to-end has not been tested.

**Sharpest risk:** Dashboard can show the runtime as "connected" while the underlying bot is misconfigured, giving false confidence.

---

### 4. Identity + Profiles

**Status: Implemented — not live-validated**

`agent/identityPresets.js` defines 5 bounded presets: `friendly_builder`, `brave_explorer`, `calm_teacher`, `funny_helper`, `quiet_genius`. The `buildIdentityPromptProfile()` function assembles display name, role, personality with verbosity and tone hints.

`memory/companionIdentityStore.js` persists the active identity to SurrealDB with revision tracking. `memory/profileStore.js` seeds 4 profiles (builder, explorer, helper, careful) and supports save/load. `AgentRuntime.loadActiveIdentity()` restores identity on startup; `ensureDefaultProfiles()` seeds defaults.

The config patch system supports profile switching via `profileId` in the patch payload, applying identity and liveConfig together with a single revision increment.

**Evidence:** `agent/identityPresets.js`, `memory/companionIdentityStore.js`, `memory/profileStore.js`, `agentRuntime.js` lines 480–610 (load/ensure), lines 700–770 (applyConfigPatch)

**What's implemented:** 5 presets, identity persistence, 4 seeded profiles, profile-based config switching, revision tracking.

**What's not verified:** Profile switching has not been exercised in a live session. The identity profile content has not been validated against actual model behavior in-game.

**Sharpest risk:** Profile presets are hardcoded string objects — if the model's instruction-following degrades, there is no signal from the system itself that the preset is not taking effect.

---

### 5. Anchors + Task Targeting

**Status: Implemented — not live-validated**

`memory/anchorStore.js` supports point, area, path, and facing anchor types. Creation is wired through the command service (`create_anchor_from_player_position`, `create_anchor_from_look_direction`, `create_anchor_from_marker_block`, `create_area_anchor_from_corners`). `AgentRuntime.resolveAnchorTarget()` resolves anchors to world coordinates for injection into action targets.

`agentRuntime.js` lines 830–900 implement `resolveAnchorTarget` and `createAnchorFromRuntime`. The anchor summary is projected to runtime state (`activeAnchor`) and surfaced in both KidMode and BuilderMode.

**Evidence:** `memory/anchorStore.js`, `agentRuntime.js` (createAnchorFromRuntime, resolveAnchorTarget), `dashboard/src/components/KidMode.tsx` (anchor command buttons)

**What's implemented:** All 4 anchor types, storage, command dispatch, target resolution, UI for anchor commands.

**What's not verified:** Anchors have not been created and used to target a build in a live Minecraft session. The anchor resolution pipeline (store → runtime → context → action) has never been end-to-end executed.

**Sharpest risk:** Anchor type detection (`type` field inspection) is implemented in the store but the resolution logic branches on `anchor.type` string — if the type field ever mismatches the actual payload shape, the target will be null and silently fail.

---

### 6. Retry + Learning

**Status: Implemented — not live-validated**

`agent/retryCoordinator.js` implements an exponential-backoff retry loop with loop detection, guidance injection from attempt 2 onward, and five terminal outcome types. `agent/retrySignatures.js` classifies errors into retry domains (llm/action/connection) with error codes, categories, and subtypes, producing a normalized signature string.

`memory/learningStore.js` stores retry attempt and outcome events in SurrealDB, relates them via edges, and synthesizes guidance via scoped bucket queries (world+thread+signature → world+signature → world+action → local_fallback).

`structures/retrySchemas.js` defines the schemas: `createNormalizedFailureSignature`, `createRetryAttemptEnvelope`, `createRetryOutcomeEnvelope`. These are used in both the learning store and the runtime event emission.

The `what_worked` command wires directly into the learning store and speaks a summary in-game. Guidance injection works by querying the learning store on attempt index >= graphFromAttempt.

**Evidence:** `agent/retryCoordinator.js`, `agent/retrySignatures.js`, `memory/learningStore.js`, `structures/retrySchemas.js`, `tests/retryCoordinator.test.js`, `tests/learningStore.test.js`, `tests/retrySchemas.test.js`

**What's implemented:** Retry loop, signature classification, guidance injection, learning store with scoped queries, what_worked command, graph edges, schema definitions.

**What's verified:** Unit tests exist for `RetryCoordinator` (non-retryable, loop stop, success), `LearningStore` (relateAttemptOutcome), `retrySchemas` (envelope creation, signature construction). All 3 tests pass.

**What's not verified:** The guidance query pipeline (learning store → runtime → LLM context) has never been exercised with real data in a live session. The guidance format has not been validated against actual model behavior. Unknown error strings will fall into the "unknown" bucket, which may bypass guidance entirely.

**Sharpest risk:** The guidance synthesis produces text from structured data but the LLM has no contract for how to interpret it. If the guidance string is noisy, the retry will degrade rather than improve.

---

### 7. Reconnect + Recovery

**Status: Implemented — not live-validated**

`agentRuntime.js` `handleConnectionLoss()` sets `runtimeUnavailable = true`, emits a reconnect_started event, and triggers `runReconnectLoop()` which implements exponential backoff with jitter. Connection loss is caught via `botError` and `end` events from the bot adapter. Interrupted turns are tracked via `interruptedTasks` in runtime state. A reconnect gate (`reconnectGate` promise) blocks new turns until the reconnect completes or fails.

The reconnect loop records `minecraft_reconnect_started`, `minecraft_reconnect_succeeded`, and `minecraft_reconnect_failed` events. The runtime state reflects `lifecycle`, `connectionHealth`, and `reconnectState` (status, attemptCount, lastErrorCode).

**Evidence:** `agentRuntime.js` (handleConnectionLoss, runReconnectLoop, computeReconnectDelay), `minecraft/bot.js` (end event emission), `control/runtimeEventBus.js` (reconnect event emission)

**What's implemented:** Connection loss detection, exponential backoff reconnect, reconnect gate, interrupted task tracking, lifecycle events.

**What's not verified:** The reconnect loop has never been triggered against a real Minecraft server disconnect. The `botAdapter.connect()` method has not been exercised in a live session. The reconnect loop has not been tested with a real bot object that actually disconnects.

**Sharpest risk:** If `botAdapter.connect()` throws for reasons not classified in `retrySignatures.js`, the reconnect loop will log the error code and fail. Unknown error strings during reconnection may prevent the system from recovering gracefully.

---

### 8. Safety + Correctness

**Status: Implemented — weakly verified**

Config patching is gated: `applyConfigPatch()` validates `followDistance` (1–12), `buildMode` (template_only/hybrid/emergent_only), rejects unknown profiles, and applies revision tracking. Static vs live config is separated in `runtimeState.js` (`staticConfig` vs `liveConfig`), though both are served via `getConfigSnapshot()`.

`isActionRetrySafe()` in `agentRuntime.js` determines whether a failed action can be safely retried: dig and place check current block state at the target coordinate; compose_structure/build_structure check worldId existence.

Safety constraints in `liveConfig` include `allowDestructiveActions`, `allowAutoGiveBuildMaterials`, `requireConfirmationForRiskyActions`. These are applied in the build worker and action executor.

**Evidence:** `agentRuntime.js` (applyConfigPatch, isActionRetrySafe), `runtimeState.js` (staticConfig vs liveConfig separation), `builder/buildWorker.js` (allowAutoGiveBuildMaterials gating), `shared/contracts/config.ts`

**What's not verified:** World-state validation before replay is limited: `isActionRetrySafe` checks the current block state but does not validate that the world has not materially changed since the original action was planned. The "requires restart" field in `applyConfigPatch` is always an empty array — no fields actually require restart, which means config changes apply immediately even if the runtime should be paused for them.

**Sharpest risk:** Live config changes apply immediately without runtime restart. If `behaviorMode` or `autonomyLevel` changes mid-turn, the active turn's context was built with the old config — no invalidation or rollback occurs.

---

### 9. Testing + Verification

**Status: Partial — weakly verified**

Tests exist in `tests/`:
- `retryCoordinator.test.js` — passes (non-retryable, loop stop, success)
- `learningStore.test.js` — passes (relateAttemptOutcome)
- `retrySchemas.test.js` — passes (envelope creation)
- `minecraftBotAdapter.test.js` — passes (version resolution, disconnect)
- `retrySignatures.test.js` — exists
- `promptBuilder.test.js` — exists
- `surrealClient.test.js` — exists

No integration tests. No tests that start the runtime against a mock Minecraft server. No tests for the control plane. No tests for the dashboard. No tests for the build worker or structure compiler.

`package.json` defines `npm run check` which runs type-checking on all source files. This has not been verified in this audit (requires successful node_modules installation and tsc).

**Evidence:** `tests/` directory, `package.json` scripts

**What's verified:** 3 of 8 test files produce passing output. 5 test files were not executed in this audit due to environment constraints (missing SurrealDB connection).

**Sharpest risk:** The tests cover isolated units (retry schema construction, learning store graph relations, bot adapter version resolution) but nothing that exercises the full runtime path. A broken bot adapter, a broken model client, or a broken build worker would not be caught by the current test suite.

---

### 10. Operator Readiness

**Status: Implemented — not verified**

Documentation exists: architecture docs (data-flow, runtime-lifecycle, state-and-identity, system-overview), infrastructure docs (configuration, networking, persistence, runtime-components), operator docs (operator-guide, runbook-troubleshooting, maintenance-and-observability). The `CODEMAP.md` is thorough and accurate.

`.env.example` exists with all documented environment variables. Start scripts are `npm run db:start`, `npm start`, `npm run tauri:dev`.

Observability surfaces: structured event log to SurrealDB, runtime state projection to dashboard, WebSocket event stream with sequence numbers, `what_worked` in-game command, retry history in learning store.

**Evidence:** `documents/documentation/`, `.env.example`, `package.json` scripts, `control/localControlServer.js` (event emission), `memory/eventStore.js`

**What's implemented:** Complete documentation set, environment template, startup scripts, event logging, WebSocket event stream, learning summary.

**What's not verified:** A new operator following the README has never been observed starting the system. The startup script (`scripts/startAgent.js`) has not been executed against a real SurrealDB or Minecraft server in a controlled test.

**Sharpest risk:** The operator guide and troubleshooting runbook contain no references to actual error logs or trace output from the system — they describe intended behavior, not observed behavior.

---

## Implemented vs Verified vs Live-Validated

### Implemented but not verified
- Full runtime state machine (turn execution, config patching, profile switching)
- Control plane HTTP/WebSocket server
- Tauri dashboard with Kid Mode and Builder Mode
- 5 identity presets, 4 seeded profiles
- 4 anchor types with storage and resolution
- Retry loop with guidance injection
- Learning store with scoped bucket queries and `what_worked`
- Minecraft reconnect coordinator with backoff
- Build worker with material provisioning and site inspection
- Reflex classifier (8 detection types) and worker (cooldown management)
- SurrealDB schema with 13 tables and 4 event triggers

### Verified (unit test, not runtime)
- `RetryCoordinator` non-retryable, loop stop, success paths
- `LearningStore` attempt-outcome relation
- `retrySchemas` envelope creation
- `MinecraftBotAdapter` version resolution and disconnect

### Live-validated
**None.** No evidence exists that any component of this system has been exercised in a real Minecraft session. No gameplay logs, no adventure summaries, no runtime snapshots from live operation, no build completion records, no reflex triggers from live world state.

---

## Regressions / Drift

This is a baseline audit — no prior report exists. No regressions can be identified.

---

## Top 5 Capability Gains This Week

This is a baseline audit. No week-over-week comparison exists.

---

## Top 5 Capability Gaps Next

1. **Live gameplay validation** — Run the full runtime against a real Minecraft server. Observe at least: bot connects, observes chat, generates a reply, executes an action, records an event in SurrealDB. Without this, everything below is hypothetical.

2. **TypeScript type-check completion** — Run `npm run check` successfully across all source files. The type contracts in `shared/contracts/` are manually synchronized with the runtime state shape in `runtimeState.js`; drift is likely.

3. **Control plane end-to-end** — Start the dashboard, launch the runtime via Tauri invoke, observe the WebSocket stream populate with runtime events, patch a config value, and verify it applied.

4. **Build worker execution** — Issue a build command (e.g., "build a small wooden cabin"), verify the build job is queued, the worker finds a site, materials are checked, blocks are placed, and a `structure_build` event is recorded.

5. **Learning store signal** — After several turns, query `what_worked` and verify the learning store returns a meaningful summary. If the store remains empty or returns "No recent successes," the learning pipeline is broken.

---

## Recommended Next Week Focus

### 3 Highest-Value Validation Tasks
1. Start the runtime with a real Minecraft server (local or LAN) and observe the startup sequence: bot connect → world context init → session/event records → runtime ready.
2. Send a simple chat message ("hello") and observe whether the system generates a reply and records it in SurrealDB.
3. Run `npm run check` and fix all type errors.

### 3 Highest-Value Implementation Tasks
1. Add a smoke test that starts the runtime with mocked bot adapter and SurrealDB client, exercises one turn, and verifies event records.
2. Implement `restartRequired` classification in `applyConfigPatch` for fields that need runtime pause/resume (e.g., LLM provider change).
3. Add a build completion test: mock the bot to return success for block placement, verify `structure_build` event is recorded.

### 3 Cleanup or Hardening Tasks
1. Audit `agent/retrySignatures.js` for unknown error strings that will fall into the "unknown" bucket. Add logging when unknown classification occurs.
2. Remove `restartRequired` array from `applyConfigPatch` — it is always empty and gives false confidence that some fields require restart.
3. Add a warning log when `runtimeState.liveConfig` is patched mid-turn, so the operator can observe config drift during active processing.

---

## Scorecard

| Score | Justification |
|-------|---------------|
| Architecture Maturity — 3 | Clean separation of concerns across 10 modules. Turn lifecycle, background workers, and config management are well-structured. Not scored 4 because the architecture has not been exercised against real runtime conditions. |
| Runtime Reliability — 3 | Retry loop, reconnect coordinator, backpressure, and interrupted task handling are all implemented with clear state transitions. Not scored 4 because none of these mechanisms have been tested against actual bot connection loss or LLM failure. |
| Desktop Readiness — 3 | Tauri app compiles and produces a binary. Kid Mode and Builder Mode cover the intended operator surface. Not scored 4 because the Tauri app has not been launched against a live runtime process. |
| Operator Visibility — 3 | Event stream, runtime state projection, structured logging, learning summary, and diagnostics tabs provide good visibility. Not scored 4 because none of these surfaces have been observed operating. |
| Test Coverage Confidence — 2 | 3 of 8 test files produce passing output. Coverage is limited to isolated units. No integration or runtime tests. Not scored higher because the current test suite would not catch a broken runtime. |
| Live Validation Confidence — 1 | No evidence of any component being exercised in a real Minecraft session. Zero gameplay logs, zero live runtime snapshots, zero adventure summaries, zero structure build records. |
| Overall Capability Readiness — 3 | The system is architecturally coherent and largely implemented. It is not ready for operational use because critical paths have never been validated. |

---

## Final Judgment

**Baseline established.** The codebase is structurally well-organized with clear layer separation, complete documentation, a compiled Tauri binary, and a defined operational surface. The retry system, learning store, anchor mechanism, and control plane are all implemented with credible internal logic. However, zero live validation exists. The system could be entirely non-functional in a real game session — broken bot adapter, broken model client, broken build worker, or broken learning store — and no signal would exist to detect it. Next week should focus on live validation of the startup path, a single turn execution, and type-check completion.