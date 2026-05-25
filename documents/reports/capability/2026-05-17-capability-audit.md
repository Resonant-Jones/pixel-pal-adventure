# Capability Audit - 2026-05-17

## Executive Summary
This week’s material change is verification quality: the targeted unit tests pass and `npm run check` now completes successfully, which clears the prior `tsc` blocker and raises confidence in the typed contract layer. The system is still mostly implemented rather than live-validated, and the biggest unresolved risk remains the same as last week: we do not have direct evidence of a real Minecraft session proving the full chat-to-action-to-retry-to-reconnect loop under live conditions.

## Capability Snapshot

| Area | Status | Confidence | Trend | Score (/5) |
| --- | --- | --- | --- | --- |
| Runtime Architecture | Verified | Medium-High | Unchanged | 4 |
| Control Plane | Implemented | Medium | Unchanged | 3 |
| Desktop Dashboard | Implemented | Medium | Unchanged | 3 |
| Identity + Profiles | Implemented | Medium | Unchanged | 3 |
| Anchors + Task Targeting | Implemented | Medium | Unchanged | 3 |
| Retry + Learning | Verified | Medium-High | Unchanged | 4 |
| Reconnect + Recovery | Implemented | Medium | Unchanged | 3 |
| Safety + Correctness | Implemented | Medium | Unchanged | 3 |
| Testing + Verification | Verified | High | Improved | 4 |
| Operator Readiness | Implemented | Medium | Improved | 3 |

## Detailed Findings

### 1. Runtime Architecture

**Current state**

The runtime architecture is real and cohesive: `scripts/startAgent.js` assembles the headless runtime, `agent/agentRuntime.js` owns turn serialization and lifecycle, `agent/runtimeState.js` models runtime-owned authority and projection state, and `agent/stateProjector.js` provides a safe snapshot for the dashboard. Command routing is explicit through `agent/commandService.js`, and the control plane only talks to the runtime through a constrained API.

**Evidence**

- [`scripts/startAgent.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/scripts/startAgent.js)
- [`agent/agentRuntime.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/agentRuntime.js)
- [`agent/runtimeState.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/runtimeState.js)
- [`agent/stateProjector.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/stateProjector.js)
- [`agent/commandService.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/commandService.js)
- [`documents/documentation/architecture/runtime-lifecycle.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/architecture/runtime-lifecycle.md)

**What changed this week**

No obvious architectural refactor landed in the code I inspected. The improvement is verification, not shape: the runtime contract layer now passes `npm run check`, so the architecture is less theoretical than last week.

**What is still unverified**

We still do not have a live Minecraft session proving that the runtime can accept a turn, execute an action, recover from interruption, and preserve its state model across reconnects.

**Sharpest risk**

The runtime is structurally strong, but the whole design still depends on a live edge case we have not proven: the full orchestration path under actual game conditions.

### 2. Control Plane

**Current state**

The local control plane is implemented as a Node HTTP server with a WebSocket event stream. It exposes `/health`, `/ready`, `/state`, `/config`, `/learning/what-worked`, and `/command/*`, and it uses bearer-token or query-token auth. The event bus emits ordered events and the dashboard can reconnect.

**Evidence**

- [`control/localControlServer.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/control/localControlServer.js)
- [`control/runtimeEventBus.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/control/runtimeEventBus.js)
- [`dashboard/src/lib/runtimeClient.ts`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/dashboard/src/lib/runtimeClient.ts)
- [`documents/documentation/CODEMAP.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/CODEMAP.md)

**What changed this week**

The control plane itself does not look materially changed, but its dependent contracts are now checked by a passing repo-wide typecheck.

**What is still unverified**

The HTTP and WebSocket endpoints have not been exercised in a live dashboard session during this audit, so the operational behavior of auth, reconnect, and snapshot replay remains unproven.

**Sharpest risk**

If the control plane fails, operator visibility and commandability disappear together.

### 3. Desktop Dashboard

**Current state**

The Tauri dashboard is implemented with a runtime store that can bootstrap the runtime, connect to the event stream, patch config, and send dashboard commands. The UI still splits operator views into Kid Mode and Builder Mode. The store also schedules reconnect attempts when the socket drops.

**Evidence**

- [`dashboard/src/store/runtimeStore.ts`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/dashboard/src/store/runtimeStore.ts)
- [`dashboard/src/store/shellSettingsStore.ts`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/dashboard/src/store/shellSettingsStore.ts)
- [`dashboard/src/components/KidMode.tsx`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/dashboard/src/components/KidMode.tsx)
- [`dashboard/src/components/BuilderMode.tsx`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/dashboard/src/components/BuilderMode.tsx)
- [`dashboard/src-tauri/src/main.rs`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/dashboard/src-tauri/src/main.rs)

**What changed this week**

No new dashboard capability stood out in the code diff I inspected. The main improvement is that the surrounding typed contracts now pass verification, which lowers the odds of store/runtime mismatch.

**What is still unverified**

The Tauri shell and runtime bootstrap path have not been proven in a live Minecraft + dashboard session in this audit.

**Sharpest risk**

The dashboard can present a healthy-looking surface even when the underlying bot path is degraded or misconfigured.

### 4. Identity + Profiles

**Current state**

Identity is modeled separately from live runtime state. The code has bounded identity presets, persisted companion identity, and saved profiles that bundle identity and live config. The runtime state carries identity revisions so the operator surface can tell profile changes from ordinary runtime churn.

**Evidence**

- [`agent/identityPresets.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/identityPresets.js)
- [`memory/companionIdentityStore.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/memory/companionIdentityStore.js)
- [`memory/profileStore.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/memory/profileStore.js)
- [`shared/contracts/identity.ts`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/shared/contracts/identity.ts)
- [`agent/runtimeState.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/runtimeState.js)

**What changed this week**

The code surface looks stable rather than newly expanded. The important improvement is that the repo-wide check now validates the contract layer around these profile and identity seams.

**What is still unverified**

We still have no proof that profile switching actually produces the intended behavior in a live game session.

**Sharpest risk**

If the model ignores the identity prompt, the system currently has limited self-detection for that failure.

### 5. Anchors + Task Targeting

**Current state**

Anchor storage and resolution exist. The repository supports multiple anchor types, persists them in SurrealDB, and resolves them into runtime targets for commands and build work. The dashboard exposes anchor-oriented controls.

**Evidence**

- [`memory/anchorStore.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/memory/anchorStore.js)
- [`agent/agentRuntime.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/agentRuntime.js)
- [`shared/contracts/anchors.ts`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/shared/contracts/anchors.ts)
- [`dashboard/src/components/KidMode.tsx`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/dashboard/src/components/KidMode.tsx)
- [`documents/documentation/architecture/data-flow.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/architecture/data-flow.md)

**What changed this week**

No clear functional change in the anchor path was visible. The main difference is broader repository verification rather than new anchor capability.

**What is still unverified**

The full anchor flow, from creation to runtime resolution to successful world targeting, has not been exercised in live gameplay.

**Sharpest risk**

Anchor resolution still depends on the runtime and store agreeing on the exact anchor shape and type semantics.

### 6. Retry + Learning

**Current state**

Retry learning is one of the stronger parts of the project. The code normalizes failures into retry domains, tracks attempts and outcomes, persists learning events, and synthesizes guidance for later attempts and for the `what_worked` query. The retry coordinator has explicit loop detection and terminal outcomes.

**Evidence**

- [`agent/retryCoordinator.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/retryCoordinator.js)
- [`agent/retrySignatures.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/retrySignatures.js)
- [`structures/retrySchemas.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/structures/retrySchemas.js)
- [`memory/learningStore.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/memory/learningStore.js)
- [`tests/retryCoordinator.test.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/tests/retryCoordinator.test.js)
- [`tests/learningStore.test.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/tests/learningStore.test.js)
- [`tests/retrySchemas.test.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/tests/retrySchemas.test.js)

**What changed this week**

The verification bar went up. The retry tests passed, and the surrounding project check now passes too, so the retry learning code is not just present but currently validated at the unit-contract level.

**What is still unverified**

The end-to-end behavior of guidance injection during a real turn, with real model outputs and real Minecraft failures, is still unproven.

**Sharpest risk**

Retry guidance is only as good as the error normalization. Unknown failures can still fall through the cracks.

### 7. Reconnect + Recovery

**Current state**

Reconnect handling exists in the runtime: connection loss marks the bot unavailable, turns are gated, reconnect attempts use backoff with jitter, and explicit reconnect events are emitted. Interrupted tasks are tracked in runtime state.

**Evidence**

- [`agent/agentRuntime.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/agentRuntime.js)
- [`minecraft/bot.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/minecraft/bot.js)
- [`control/runtimeEventBus.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/control/runtimeEventBus.js)
- [`documents/documentation/architecture/runtime-lifecycle.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/architecture/runtime-lifecycle.md)

**What changed this week**

No obvious code-path improvement surfaced here. The adjacent verification work does increase confidence that the reconnect-related state and contracts are internally consistent.

**What is still unverified**

No live disconnect/reconnect cycle was proven in this audit.

**Sharpest risk**

Reconnect remains a critical recovery path with no live proof. That is the point where “implemented” and “operationally credible” diverge most sharply.

### 8. Safety + Correctness

**Current state**

There is real safety logic: config patching validates key fields, runtime state separates static config from live config, and retry safety checks inspect current world state before reattempting certain actions. The project also keeps several risky toggles explicitly named in live config.

**Evidence**

- [`agent/agentRuntime.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/agentRuntime.js)
- [`agent/runtimeState.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/runtimeState.js)
- [`shared/contracts/config.ts`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/shared/contracts/config.ts)
- [`builder/buildWorker.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/builder/buildWorker.js)
- [`documents/documentation/architecture/state-and-identity.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/architecture/state-and-identity.md)

**What changed this week**

The config and contract layer is now verified by the successful repo check, which makes safety-sensitive field handling less brittle than before.

**What is still unverified**

World-state validation before replay is still limited, and live config changes still apply without live-session proof that they are safe under every turn state.

**Sharpest risk**

Static versus live config is separated in code, but the runtime can still change behavior mid-turn without a stronger transactional boundary.

### 9. Testing + Verification

**Current state**

This is the clearest week-over-week improvement. The project now has a green slice of unit tests covering retry coordination, learning store behavior, retry schema construction, retry signature normalization, bot adapter behavior, Surreal client behavior, prompt building, and Ollama config handling. The repo-wide `npm run check` also passes, which means the TypeScript contract layer is no longer blocked by a missing `tsc`.

**Evidence**

- [`tests/minecraftBotAdapter.test.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/tests/minecraftBotAdapter.test.js)
- [`tests/retrySchemas.test.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/tests/retrySchemas.test.js)
- [`tests/retrySignatures.test.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/tests/retrySignatures.test.js)
- [`tests/surrealClient.test.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/tests/surrealClient.test.js)
- [`tests/promptBuilder.test.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/tests/promptBuilder.test.js)
- [`tests/ollamaConfig.test.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/tests/ollamaConfig.test.js)
- [`tests/retryCoordinator.test.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/tests/retryCoordinator.test.js)
- [`tests/learningStore.test.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/tests/learningStore.test.js)
- [`package.json`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/package.json)

**What changed this week**

`npm run check` succeeded in this workspace. That is the single biggest audit signal this week because last week’s note recorded `tsc` as missing and therefore left the typed contract surface unverified.

**What is still unverified**

There are still no integration tests for the runtime/control-plane/dashboard handshake, and no gameplay-level validation.

**Sharpest risk**

The test suite is solid at the unit level but still thin at the system level.

### 10. Operator Readiness

**Current state**

The repo has strong docs, a clear code map, a useful README, environment guidance, troubleshooting pages, and a local startup story. The operator surfaces are explicit about how to start the runtime, connect the dashboard, and inspect state. Observability is mostly event-driven and log-based rather than metrics-heavy.

**Evidence**

- [`README.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/README.md)
- [`documents/documentation/CODEMAP.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/CODEMAP.md)
- [`documents/documentation/operator/operator-guide.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/operator/operator-guide.md)
- [`documents/documentation/operator/runbook-troubleshooting.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/operator/runbook-troubleshooting.md)
- [`documents/documentation/operator/maintenance-and-observability.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/operator/maintenance-and-observability.md)

**What changed this week**

Operator readiness improved slightly because the repo is now mechanically healthier: the typed check passes and the test slice is green.

**What is still unverified**

We still lack direct evidence that a fresh operator can start the stack cleanly and see the documented normal signals in a live environment.

**Sharpest risk**

The docs are good enough to onboard someone, but the repo still does not prove the onboarding path end-to-end.

## Implemented vs Verified vs Live-Validated

### Implemented but not verified

- Dashboard Tauri startup against a real Minecraft server
- Control-plane auth and WebSocket reconnect in a real operator session
- Profile switching in live gameplay
- Anchor creation and targeting in live gameplay
- Reconnect recovery after an actual disconnect
- End-to-end gameplay replay of retry guidance injection

### Verified but not live-validated

- Retry coordinator behavior under unit tests
- Learning store relationship and summarization helpers
- Retry schema construction and retry signature normalization
- Minecraft bot adapter disconnect behavior
- Surreal client and prompt builder unit behavior
- Repo-wide check and TypeScript contract validation

### Live-validated capabilities

- None proven in this audit

## Regressions / Drift

No clear code regression surfaced relative to the 2026-04-27 audit. The main drift is positive: the previously noted `tsc`/`npm run check` blocker has cleared, so the verification story is stronger than it was last week. The remaining drift risk is conceptual, not a new bug: live gameplay behavior is still unproven, so the project can look more finished than it actually is.

## Top 5 Capability Gains This Week

1. `npm run check` now passes, which validates the contract layer instead of leaving it blocked by environment/tooling.
2. The unit-test slice is green across retry, learning, bot adapter, prompt, and config seams.
3. The retry and learning subsystem now has better audit confidence because its core helpers are test-backed.
4. Operator docs sit on top of a healthier codebase, so onboarding guidance is less likely to diverge from what the repo can actually run.
5. The audit itself can now distinguish “implemented” from “verified” more sharply because the repository has a stronger verification signal.

## Top 5 Capability Gaps Next

1. Live Minecraft session validation of the full chat-to-action loop.
2. Live reconnect/disconnect recovery proof.
3. Dashboard-to-control-plane end-to-end proof in a real operator session.
4. Profile switching and anchor targeting in actual gameplay.
5. Integration coverage that exercises runtime, control plane, and dashboard together.

## Recommended Next Week Focus

### 3 highest-value validation tasks

1. Run the runtime against a real or tightly controlled Minecraft target and capture a complete turn, including one successful action and one learning event.
2. Force a disconnect and verify reconnect behavior, interrupted task handling, and emitted reconnect events.
3. Boot the dashboard against the local control plane and confirm state, config, and command paths from the operator surface.

### 3 highest-value implementation tasks

1. Add a minimal integration harness for runtime + control plane.
2. Add a replayable test seam for reconnect and interrupted-turn handling.
3. Add explicit profile/anchor end-to-end acceptance checks at the contract level.

### 3 cleanup or hardening tasks

1. Add clearer runtime logs for control-plane auth and reconnect failure reasons.
2. Tighten contract tests around snapshot and config shape drift.
3. Document the exact “normal startup” signals with one concrete verified run once that exists.

## Scorecard

- **Architecture Maturity: 4/5**  
  The system is clearly decomposed into runtime, control plane, memory, Minecraft edge, and dashboard layers with explicit contracts. It is still one step short of a fully operational architecture because live behavior has not been proven.

- **Runtime Reliability: 3/5**  
  Retry, reconnect, and queueing logic are implemented and some of it is test-backed, but the lack of live gameplay proof keeps reliability below the “verified” threshold.

- **Desktop Readiness: 3/5**  
  The Tauri shell and dashboard stores are present and structurally coherent, but there is no live proof that the operator experience works against the current runtime.

- **Operator Visibility: 3/5**  
  The repo has good docs, an event stream, and a control plane, but observability is still mostly log-and-snapshot driven rather than deeply instrumented.

- **Test Coverage Confidence: 4/5**  
  The existing unit tests cover important seams and now pass alongside repo-wide checks. The remaining gap is integration depth, not basic contract hygiene.

- **Live Validation Confidence: 1/5**  
  There is still no direct evidence of live Minecraft execution, reconnect recovery, or operator-session proof in this audit.

- **Overall Capability Readiness: 3/5**  
  The project is meaningfully implemented and increasingly verified, but it is not yet operationally credible in the live sense because the hardest end-to-end flows remain unproven.

## Final Judgment

Structurally strong, operationally immature.
