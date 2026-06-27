# Capability Audit - 2026-06-14

## Executive Summary
The project remains broadly in the same state as the 2026-06-07 audit: the runtime, control plane, dashboard, identity/profile layer, anchors, retry/learning, reconnect, and safety seams are implemented in code and the repo-wide check still passes, but there is still no direct evidence of a live Minecraft or dashboard session validating the full loop. The main unresolved risk is unchanged: system-level behavior is still inferred from source and unit checks, not from real gameplay or operator sessions.

## Capability Snapshot

| Area | Status | Confidence | Trend | Score (/5) |
| --- | --- | --- | --- | --- |
| Runtime Architecture | Implemented | Medium-High | Unchanged | 4 |
| Control Plane | Implemented | Medium | Unchanged | 3 |
| Desktop Dashboard | Implemented | Medium | Unchanged | 3 |
| Identity + Profiles | Implemented | Medium | Unchanged | 3 |
| Anchors + Task Targeting | Implemented | Medium | Unchanged | 3 |
| Retry + Learning | Verified | Medium-High | Unchanged | 4 |
| Reconnect + Recovery | Implemented | Medium | Unchanged | 3 |
| Safety + Correctness | Implemented | Medium | Unchanged | 3 |
| Testing + Verification | Verified | High | Unchanged | 4 |
| Operator Readiness | Implemented | Medium | Unchanged | 3 |

## Detailed Findings

### 1. Runtime Architecture

**Current state**

The headless runtime separation is still explicit. `scripts/startAgent.js` bootstraps the runtime, `agent/agentRuntime.js` owns turn orchestration, `agent/runtimeState.js` carries runtime-owned state and revisions, `agent/stateProjector.js` projects UI-facing snapshots, and `agent/commandService.js` keeps command routing constrained instead of exposing direct mutation.

**Evidence**

- [`scripts/startAgent.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/scripts/startAgent.js)
- [`agent/agentRuntime.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/agentRuntime.js)
- [`agent/runtimeState.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/runtimeState.js)
- [`agent/stateProjector.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/stateProjector.js)
- [`agent/commandService.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/commandService.js)
- [`shared/contracts/runtime.ts`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/shared/contracts/runtime.ts)

**What changed this week**

No source-level architecture change surfaced. The repo-wide `npm run check` still passes, which confirms the existing contract surface remains coherent.

**What is still unverified**

The full turn lifecycle is still not proven in a live Minecraft session, including interruption and recovery under real network conditions.

**Sharpest risk or limitation**

The architecture is coherent on paper and in code, but not yet proven under live runtime pressure.

### 2. Control Plane

**Current state**

The local control plane remains a Node HTTP server plus WebSocket event bus. It exposes `/health`, `/ready`, `/state`, `/config`, `/learning/what-worked`, and `/command/*` endpoints with token-based authorization, and it sends a snapshot event to new event-stream clients.

**Evidence**

- [`control/localControlServer.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/control/localControlServer.js)
- [`control/runtimeEventBus.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/control/runtimeEventBus.js)
- [`dashboard/src/lib/runtimeClient.ts`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/dashboard/src/lib/runtimeClient.ts)
- [`shared/contracts/events.ts`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/shared/contracts/events.ts)

**What changed this week**

No new endpoint or event-stream behavior appeared in the inspected source.

**What is still unverified**

There is still no live proof of the dashboard-to-control-plane handshake in a real runtime session.

**Sharpest risk or limitation**

Control-plane failure would collapse both operator visibility and remote commandability.

### 3. Desktop Dashboard

**Current state**

The Tauri dashboard is implemented as an operator shell that can bootstrap the runtime, connect to the event stream, patch config, send commands, and switch between Kid Mode and Builder Mode. The store also contains reconnect behavior when the socket drops.

**Evidence**

- [`dashboard/src/store/runtimeStore.ts`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/dashboard/src/store/runtimeStore.ts)
- [`dashboard/src/components/KidMode.tsx`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/dashboard/src/components/KidMode.tsx)
- [`dashboard/src/components/BuilderMode.tsx`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/dashboard/src/components/BuilderMode.tsx)
- [`dashboard/src-tauri/src/main.rs`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/dashboard/src-tauri/src/main.rs)
- [`dashboard/src/lib/runtimeClient.ts`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/dashboard/src/lib/runtimeClient.ts)

**What changed this week**

No material dashboard expansion surfaced in the source tree. Generated Tauri schema artifacts are present, but they do not by themselves prove runtime behavior.

**What is still unverified**

The Tauri shell and runtime bootstrap path still lack live proof in a real Minecraft + dashboard session.

**Sharpest risk or limitation**

The dashboard can present a healthy-looking shell while the runtime is degraded or disconnected.

### 4. Identity + Profiles

**Current state**

Identity is still separated from live runtime state. The project supports bounded identity presets, persisted companion identity, and profile records that package identity together with live config. Runtime state carries identity and profile revisions so UI consumers can tell deliberate profile changes from normal churn.

**Evidence**

- [`agent/identityPresets.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/identityPresets.js)
- [`memory/companionIdentityStore.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/memory/companionIdentityStore.js)
- [`memory/profileStore.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/memory/profileStore.js)
- [`shared/contracts/identity.ts`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/shared/contracts/identity.ts)
- [`shared/contracts/runtime.ts`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/shared/contracts/runtime.ts)

**What changed this week**

No meaningful identity-model expansion surfaced.

**What is still unverified**

Profile switching has not been proven in a live gameplay session.

**Sharpest risk or limitation**

If the model ignores the identity prompt, the system has limited self-detection for that failure.

### 5. Anchors + Task Targeting

**Current state**

Anchor persistence remains implemented with point, area, facing, and path types. The store can create, fetch, and list anchors, and the runtime can format anchor summaries for downstream task targeting.

**Evidence**

- [`shared/contracts/anchors.ts`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/shared/contracts/anchors.ts)
- [`memory/anchorStore.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/memory/anchorStore.js)
- [`agent/agentRuntime.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/agentRuntime.js)
- [`documents/documentation/architecture/data-flow.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/architecture/data-flow.md)

**What changed this week**

No clear anchor-flow change surfaced in the inspected code.

**What is still unverified**

The full anchor lifecycle, from creation to runtime resolution to successful world targeting, still has not been exercised in live gameplay.

**Sharpest risk or limitation**

Anchor resolution still depends on runtime and store agreement about shape and semantics.

### 6. Retry + Learning

**Current state**

Retry learning remains one of the strongest implemented seams. The retry coordinator normalizes failures into retry domains, tracks attempts and terminal outcomes, applies backoff with jitter, and stops on loop detection or non-retryable failures. The learning store persists learning events and can summarize what worked.

**Evidence**

- [`agent/retryCoordinator.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/retryCoordinator.js)
- [`agent/retrySignatures.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/retrySignatures.js)
- [`structures/retrySchemas.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/structures/retrySchemas.js)
- [`memory/learningStore.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/memory/learningStore.js)
- [`tests/retryCoordinator.test.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/tests/retryCoordinator.test.js)
- [`tests/learningStore.test.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/tests/learningStore.test.js)

**What changed this week**

No new retry logic landed. The implemented behavior remains covered by unit tests and the repo check.

**What is still unverified**

Guidance injection during a real turn, with real model output and real Minecraft failure modes, is still unproven.

**Sharpest risk or limitation**

Retry guidance is only as strong as error normalization; unknown failures can still fall through.

### 7. Reconnect + Recovery

**Current state**

Reconnect handling still exists in the runtime and bot adapter. Connection loss marks the runtime unavailable, reconnect attempts use backoff and jitter, and explicit reconnect-related events are part of the shared contract.

**Evidence**

- [`agent/agentRuntime.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/agentRuntime.js)
- [`minecraft/bot.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/minecraft/bot.js)
- [`shared/contracts/events.ts`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/shared/contracts/events.ts)
- [`shared/contracts/runtime.ts`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/shared/contracts/runtime.ts)

**What changed this week**

No obvious reconnect-path improvement surfaced in the source.

**What is still unverified**

No live disconnect/reconnect cycle was proven in this audit.

**Sharpest risk or limitation**

Reconnect is a critical recovery path with no live proof yet.

### 8. Safety + Correctness

**Current state**

Safety logic still exists in code: config patching validates key fields, runtime state separates static and live config, and retry logic inspects current world state before certain reattempts. The live config also keeps explicitly named risky toggles.

**Evidence**

- [`agent/agentRuntime.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/agentRuntime.js)
- [`agent/runtimeState.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/runtimeState.js)
- [`shared/contracts/config.ts`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/shared/contracts/config.ts)
- [`builder/buildWorker.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/builder/buildWorker.js)
- [`documents/documentation/architecture/state-and-identity.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/architecture/state-and-identity.md)

**What changed this week**

The same contract layer still passes `npm run check`, which reduces the chance of silent shape drift.

**What is still unverified**

World-state validation before replay remains limited, and live config changes still lack end-to-end safety proof across turn states.

**Sharpest risk or limitation**

Static versus live config is separated in code, but the runtime can still change behavior mid-turn without a stronger transactional boundary.

### 9. Testing + Verification

**Current state**

The repository still has a strong unit-level verification slice, and `npm run check` passes in this workspace. The checked surface includes the TypeScript contract layer plus runtime seams such as retry coordination, retry signatures, learning storage, prompt building, Surreal client behavior, and bot adapter logic.

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

The verification signal stayed green again: `npm run check` completed successfully during this audit.

**What is still unverified**

There are still no integration tests for the runtime/control-plane/dashboard handshake, and no gameplay-level validation.

**Sharpest risk or limitation**

The suite is solid at the unit level but still thin at the system level.

### 10. Operator Readiness

**Current state**

Operator documentation is present for architecture, runtime lifecycle, data flow, persistence, configuration, networking, operator workflow, troubleshooting, and observability. The dashboard also exposes status, config, learning, logs, and diagnostics panels, which helps local diagnosis even when runtime behavior is not live-validated.

**Evidence**

- [`README.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/README.md)
- [`documents/documentation/architecture/system-overview.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/architecture/system-overview.md)
- [`documents/documentation/architecture/runtime-lifecycle.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/architecture/runtime-lifecycle.md)
- [`documents/documentation/infrastructure/runtime-components.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/infrastructure/runtime-components.md)
- [`documents/documentation/operator/operator-guide.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/operator/operator-guide.md)
- [`documents/documentation/operator/runbook-troubleshooting.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/operator/runbook-troubleshooting.md)
- [`documents/documentation/operator/maintenance-and-observability.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/operator/maintenance-and-observability.md)
- [`dashboard/src/components/BuilderMode.tsx`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/dashboard/src/components/BuilderMode.tsx)

**What changed this week**

No clear operator-facing feature expansion surfaced in the code inspection.

**What is still unverified**

Local startup and diagnosis are documented, but not proven end-to-end in a real operator workflow during this audit.

**Sharpest risk or limitation**

The project is reasonably observable on paper, but the practical startup path still depends on correct local setup and unstated runtime conditions.

## Implemented vs Verified vs Live-Validated

### Implemented but not verified

- Dashboard bootstrap, config patching, and reconnect behavior are implemented in code, but not live-tested in this audit.
- Anchor creation and runtime targeting are implemented, but the full world-targeting path is not proven in a real Minecraft session.
- Identity/profile persistence is implemented, but profile switching has not been live-validated.
- Reconnect recovery logic exists, but disconnect/reconnect behavior has not been exercised live.

### Verified but not live-validated

- `npm run check` passes, so the repo’s source-level contracts and checked runtime files are syntactically and type-wise healthy in this workspace.
- Retry coordinator behavior is unit-tested for non-retryable failures, loop stopping, and eventual success.
- Learning store behavior is covered by tests and code inspection, but not by a live runtime workflow.

### Live-validated capabilities

- None observed in this audit.

## Regressions / Drift

I did not find a material regression relative to `2026-06-07-capability-audit.md`. The capability surface appears stable, and the main difference is the presence of generated Tauri schema artifacts under `dashboard/src-tauri/gen/schemas/`, which is build-adjacent evidence but not capability growth by itself. The unresolved carryover items from last week remain unresolved: no live Minecraft session proof, no live dashboard session proof, and no system-level recovery proof.

## Top 5 Capability Gains This Week

1. The project still has a coherent runtime/control/dashboard split with explicit contracts, which keeps the architecture debuggable.
2. Retry and learning remain the strongest operational seam, with both normalization and tests in place.
3. The control plane exposes a complete local operator surface for state, config, learning, and commands.
4. The dashboard includes distinct Kid Mode and Builder Mode surfaces, which makes operator intent clearer.
5. The documentation set is broad enough to support local diagnosis without guessing at the intended shape.

## Top 5 Capability Gaps Next

1. Live Minecraft session validation of the full runtime loop.
2. End-to-end dashboard validation against a running runtime.
3. Reconnect and recovery proof under actual disconnect conditions.
4. Gameplay-level validation of anchors, retries, and learning guidance.
5. Stronger integration tests across runtime, control plane, and dashboard.

## Recommended Next Week Focus

### Highest-value validation tasks

1. Run a real local Minecraft session and capture the full turn lifecycle, including at least one normal action and one retry path.
2. Exercise dashboard bootstrap against a live runtime and confirm the event stream, state snapshot, and command path.
3. Force a controlled disconnect and verify reconnect events, queue behavior, and recovery state in the runtime snapshot.

### Highest-value implementation tasks

1. Add an integration test for the control-plane `/ready` + `/state` + event-stream handshake.
2. Add a runtime-level test for reconnect gating and interrupted-task handling.
3. Add a dashboard store test for reconnect and snapshot replay behavior.

### Cleanup or hardening tasks

1. Tighten docs around what is verified versus what is only implemented.
2. Add more explicit operator-facing error messages for auth and readiness failures.
3. Consider a small “startup health checklist” in the dashboard to reduce ambiguous local setup failures.

## Scorecard

- **Architecture Maturity: 4/5**  
  The runtime/control/dashboard split is clean, contract-driven, and well separated. It is still missing live proof, so this stays below fully mature.

- **Runtime Reliability: 3/5**  
  Retry and reconnect logic are implemented, but reliability is inferred from code and tests rather than real operational runs.

- **Desktop Readiness: 3/5**  
  The Tauri shell and mode surfaces are real, but there is still no live proof that the dashboard consistently supervises a real runtime.

- **Operator Visibility: 3/5**  
  The control plane, logs, diagnostics, and docs are good, but visibility has not been validated under live failure conditions.

- **Test Coverage Confidence: 4/5**  
  The repo has meaningful unit coverage around the strongest seams and the check suite passes. The gap is still system-level integration.

- **Live Validation Confidence: 0/5**  
  No live runtime, gameplay, or dashboard session evidence was observed in this audit.

- **Overall Capability Readiness: 3/5**  
  The project is implemented in a way that could become operationally credible, but it remains structurally immature at the live-validation layer.

## Final Judgment

Structurally strong, operationally immature

