# Capability Audit - 2026-05-24

## Executive Summary
This week looks materially unchanged in shipped capability, but the verification posture remains solid: `npm run check` passes in this workspace, and the core runtime, control plane, dashboard, identity, retry, and persistence seams still exist in code with coherent contracts. The biggest unresolved risk is still the same one carried forward from the prior audit: we do not have direct evidence of a live Minecraft session proving the full chat-to-action-to-retry-to-reconnect loop under real runtime conditions.

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
| Testing + Verification | Verified | High | Unchanged | 4 |
| Operator Readiness | Implemented | Medium | Unchanged | 3 |

## Detailed Findings

### 1. Runtime Architecture

**Current state**

The runtime architecture is still real and well-factored. `scripts/startAgent.js` bootstraps the headless agent, `agent/agentRuntime.js` owns lifecycle and turn orchestration, `agent/runtimeState.js` holds runtime-owned authority and revisioned state, and `agent/stateProjector.js` exposes a projection for the dashboard. Command routing remains explicit through `agent/commandService.js`, so the control plane only reaches the runtime through constrained endpoints rather than direct internal mutation.

**Evidence**

- [`scripts/startAgent.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/scripts/startAgent.js)
- [`agent/agentRuntime.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/agentRuntime.js)
- [`agent/runtimeState.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/runtimeState.js)
- [`agent/stateProjector.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/stateProjector.js)
- [`agent/commandService.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/commandService.js)
- [`documents/documentation/architecture/runtime-lifecycle.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/architecture/runtime-lifecycle.md)

**What changed this week**

No material architecture change was visible in the source tree I inspected. The practical improvement is verification, not topology: the contract surface still passes `npm run check`.

**What is still unverified**

There is still no live Minecraft session proving that a turn can be accepted, executed, interrupted, recovered, and resumed across reconnects.

**Sharpest risk or limitation**

The runtime design is coherent, but it still depends on a game-session path that has not been live-validated.

### 2. Control Plane

**Current state**

The local control plane is implemented as a Node HTTP server with a WebSocket event stream. It exposes `/health`, `/ready`, `/state`, `/config`, `/learning/what-worked`, and `/command/*`, with bearer-token or query-token authorization. The event bus emits ordered events, and dashboard reconnects can resume from a snapshot.

**Evidence**

- [`control/localControlServer.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/control/localControlServer.js)
- [`control/runtimeEventBus.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/control/runtimeEventBus.js)
- [`dashboard/src/lib/runtimeClient.ts`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/dashboard/src/lib/runtimeClient.ts)
- [`README.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/README.md)

**What changed this week**

No new control-plane feature stood out. The path still looks stable and internally consistent.

**What is still unverified**

The HTTP and WebSocket endpoints have not been exercised in a live dashboard session during this audit.

**Sharpest risk or limitation**

If the control plane fails, operator visibility and commandability disappear together.

### 3. Desktop Dashboard

**Current state**

The Tauri dashboard remains implemented as an operator shell with a runtime store that can bootstrap the runtime, connect to the event stream, patch config, and send dashboard commands. Kid Mode and Builder Mode still exist as distinct UI modes. The store also handles reconnect behavior when the socket drops.

**Evidence**

- [`dashboard/src/store/runtimeStore.ts`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/dashboard/src/store/runtimeStore.ts)
- [`dashboard/src/components/KidMode.tsx`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/dashboard/src/components/KidMode.tsx)
- [`dashboard/src/components/BuilderMode.tsx`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/dashboard/src/components/BuilderMode.tsx)
- [`dashboard/src-tauri/src/main.rs`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/dashboard/src-tauri/src/main.rs)

**What changed this week**

No visible dashboard expansion landed in the code I reviewed.

**What is still unverified**

The Tauri shell and runtime bootstrap path still lack live proof in a real Minecraft + dashboard session.

**Sharpest risk or limitation**

The dashboard can look healthy while the underlying bot path is degraded or misconfigured.

### 4. Identity + Profiles

**Current state**

Identity remains separated from live runtime state. The code supports bounded identity presets, persisted companion identity, and saved profiles that package identity and live config together. Runtime state also carries identity and profile revisions so UI consumers can distinguish intentional profile change from ordinary churn.

**Evidence**

- [`agent/identityPresets.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/identityPresets.js)
- [`memory/companionIdentityStore.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/memory/companionIdentityStore.js)
- [`memory/profileStore.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/memory/profileStore.js)
- [`shared/contracts/identity.ts`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/shared/contracts/identity.ts)
- [`agent/runtimeState.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/runtimeState.js)

**What changed this week**

I did not find a meaningful identity-model expansion this week.

**What is still unverified**

Profile switching has not been proven in a live gameplay session.

**Sharpest risk or limitation**

If the model ignores the identity prompt, the system has limited self-detection for that failure.

### 5. Anchors + Task Targeting

**Current state**

Anchor persistence and summarization are implemented. The store can create, list, and fetch anchors, and runtime code can resolve anchors into task targets for downstream work.

**Evidence**

- [`memory/anchorStore.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/memory/anchorStore.js)
- [`agent/agentRuntime.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/agentRuntime.js)
- [`shared/contracts/anchors.ts`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/shared/contracts/anchors.ts)
- [`documents/documentation/architecture/data-flow.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/architecture/data-flow.md)

**What changed this week**

No clear anchor-flow change surfaced in the source I inspected.

**What is still unverified**

The full anchor lifecycle, from creation to runtime resolution to successful world targeting, has not been exercised in live gameplay.

**Sharpest risk or limitation**

Anchor resolution still depends on runtime and store agreement about shape and semantics.

### 6. Retry + Learning

**Current state**

Retry learning is still one of the stronger capability seams. The runtime normalizes failures into retry domains, tracks attempts and outcomes, persists learning events, and synthesizes guidance for later attempts and for the `what_worked` query. The retry coordinator also has explicit loop detection and terminal outcomes.

**Evidence**

- [`agent/retryCoordinator.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/retryCoordinator.js)
- [`agent/retrySignatures.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/retrySignatures.js)
- [`structures/retrySchemas.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/structures/retrySchemas.js)
- [`memory/learningStore.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/memory/learningStore.js)
- [`tests/retryCoordinator.test.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/tests/retryCoordinator.test.js)
- [`tests/learningStore.test.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/tests/learningStore.test.js)

**What changed this week**

No new retry logic landed in the code I inspected. The verification posture remains strong because the repo-wide check still passes.

**What is still unverified**

Guidance injection during a real turn, with real model outputs and real Minecraft failures, is still unproven.

**Sharpest risk or limitation**

Retry guidance is only as good as the error normalization; unknown failures can still fall through.

### 7. Reconnect + Recovery

**Current state**

Reconnect handling still exists in the runtime: connection loss marks the bot unavailable, new turns can be gated, reconnect attempts use backoff with jitter, and explicit reconnect events are emitted. Interrupted tasks are tracked in runtime state.

**Evidence**

- [`agent/agentRuntime.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/agentRuntime.js)
- [`minecraft/bot.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/minecraft/bot.js)
- [`control/runtimeEventBus.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/control/runtimeEventBus.js)
- [`documents/documentation/architecture/runtime-lifecycle.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/architecture/runtime-lifecycle.md)

**What changed this week**

No obvious reconnect-path improvement surfaced in the source I reviewed.

**What is still unverified**

No live disconnect/reconnect cycle was proven in this audit.

**Sharpest risk or limitation**

Reconnect is a critical recovery path with no live proof yet.

### 8. Safety + Correctness

**Current state**

Safety logic exists in code: config patching validates key fields, runtime state separates static config from live config, and retry logic inspects current world state before certain reattempts. Risky toggles are still named explicitly in live config.

**Evidence**

- [`agent/agentRuntime.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/agentRuntime.js)
- [`agent/runtimeState.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/runtimeState.js)
- [`shared/contracts/config.ts`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/shared/contracts/config.ts)
- [`builder/buildWorker.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/builder/buildWorker.js)
- [`documents/documentation/architecture/state-and-identity.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/architecture/state-and-identity.md)

**What changed this week**

The config and contract layer remains covered by `npm run check`, which keeps this safety seam from drifting silently.

**What is still unverified**

World-state validation before replay is still limited, and live config changes still lack end-to-end proof that they are safe in every turn state.

**Sharpest risk or limitation**

Static versus live config is separated in code, but the runtime can still change behavior mid-turn without a stronger transactional boundary.

### 9. Testing + Verification

**Current state**

The repository still has a solid unit-level verification slice, and `npm run check` passes in this workspace. The checked surface includes the TypeScript contract layer and a broad set of runtime seams such as retry coordination, retry signatures, learning storage, prompt building, Surreal client behavior, and bot adapter logic.

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

The verification signal stayed green. I ran `npm run check` in this workspace and it completed successfully.

**What is still unverified**

There are still no integration tests for the runtime/control-plane/dashboard handshake, and no gameplay-level validation.

**Sharpest risk or limitation**

The suite is solid at the unit level but still thin at the system level.

### 10. Operator Readiness

**Current state**

Operator docs are present and reasonably useful. The README explains startup, environment variables, expected healthy signals, and basic troubleshooting, and the architecture docs describe runtime lifecycle, data flow, persistence, networking, and configuration. That said, operator readiness is still mostly “good local documentation” rather than “field-proven operations.”

**Evidence**

- [`README.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/README.md)
- [`documents/documentation/architecture/runtime-lifecycle.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/architecture/runtime-lifecycle.md)
- [`documents/documentation/infrastructure/networking-and-connectivity.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/infrastructure/networking-and-connectivity.md)
- [`documents/documentation/infrastructure/configuration.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/infrastructure/configuration.md)
- [`documents/documentation/operator/runbook-troubleshooting.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/operator/runbook-troubleshooting.md)

**What changed this week**

No new operator surface stood out, but the docs remain aligned with the code paths I reviewed.

**What is still unverified**

Local startup and diagnosis are documented, but not live-audited as an operator workflow in this report.

**Sharpest risk or limitation**

The system is explainable on paper, but the operator experience is still only partially proven under live usage.

## Implemented vs Verified vs Live-Validated

**Implemented but not verified**

- Dashboard bootstrap from Tauri into the runtime control plane.
- Local control-plane endpoints and auth handling in `control/localControlServer.js`.
- Identity presets, profile persistence, and anchor persistence.
- Reconnect recovery, interrupted-turn handling, and live config patching.
- Builder and reflex background workers.

**Verified but not live-validated**

- `npm run check` passes in this workspace.
- Retry coordinator behavior is covered by unit tests.
- Learning store behavior is covered by unit tests.
- Surreal client, prompt builder, and selected adapter/config seams are covered by tests.
- Runtime, config, and dashboard contracts are syntactically and type-checked.

**Live-validated capabilities**

- None observed in this audit.

## Regressions / Drift

No concrete regression surfaced in the code or checks I reviewed. The main drift risk is quieter than a bug: the project still accumulates implemented capability faster than it accumulates live proof, so the gap between “present in code” and “safe to trust in gameplay” remains open.

## Top 5 Capability Gains This Week

1. The repository still passes `npm run check`, which keeps the contract layer honest.
2. Retry learning remains backed by unit tests rather than just design intent.
3. The runtime/control-plane/dashboard split is still clean enough to reason about locally.
4. Identity, profile, and live-config separation is still explicit in runtime state.
5. The docs remain aligned with the code paths and operator workflow.

## Top 5 Capability Gaps Next

1. Live Minecraft session proof of the full turn loop.
2. Live reconnect and recovery validation under a real disconnect.
3. Runtime/control-plane/dashboard integration testing.
4. Verified anchor creation and target resolution in-game.
5. Stronger proof that live config patches cannot create unsafe mid-turn behavior.

## Recommended Next Week Focus

**Highest-value validation tasks**

1. Run a real Minecraft session and capture the chat-to-action-to-persistence path.
2. Force a disconnect and verify reconnect, interrupted turn handling, and event stream recovery.
3. Exercise the dashboard bootstrap path against a running runtime and confirm state sync.

**Highest-value implementation tasks**

1. Add at least one integration test for the control-plane snapshot/event handshake.
2. Add a focused end-to-end path for anchor creation and resolution.
3. Tighten world-state validation before retry replay on risky actions.

**Cleanup / hardening tasks**

1. Expand operator runbook steps for the most common boot and reconnect failures.
2. Add explicit health/readiness notes for the dashboard client reconnect path.
3. Reduce any ambiguity around which config fields are startup-only versus live-patchable.

## Scorecard

- **Architecture Maturity: 4/5**  
  The runtime is modular, authority is reasonably bounded, and the code clearly separates runtime, memory, control plane, and dashboard concerns. It is still not live-validated, so this stays below 5.

- **Runtime Reliability: 3/5**  
  Retry and reconnect logic exist, but the project still lacks direct live proof that the whole loop behaves correctly under game conditions.

- **Desktop Readiness: 3/5**  
  The Tauri dashboard is real and capable, but it has not been proven in a live operator workflow during this audit.

- **Operator Visibility: 3/5**  
  Health, readiness, snapshots, and event streaming are in place, along with decent docs. The missing piece is live operational proof.

- **Test Coverage Confidence: 4/5**  
  The project has a meaningful unit-tested core and a passing repo-wide check. Integration and gameplay-level coverage are still sparse.

- **Live Validation Confidence: 1/5**  
  I found no direct evidence of live Minecraft runtime validation in this audit.

- **Overall Capability Readiness: 3/5**  
  The system is implemented and reasonably verified, but it is still operationally immature because the live gameplay loop remains unproven.

## Final Judgment

Structurally strong, operationally immature.

This report compares against [`2026-05-17-capability-audit.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/reports/capability/2026-05-17-capability-audit.md). The comparison is mostly unchanged rather than improved: the codebase remains coherent and verified at the unit/contract level, but live runtime credibility is still the main gap.
