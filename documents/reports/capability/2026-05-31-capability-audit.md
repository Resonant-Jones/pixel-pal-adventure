# Capability Audit - 2026-05-31

## Executive Summary
The capability surface is effectively unchanged from the 2026-05-24 audit: the runtime, control plane, dashboard, identity, anchors, retry, reconnect, and persistence seams still exist in code, and `npm run check` still passes. The biggest unresolved risk remains the same as last week: there is still no direct evidence of a live Minecraft session validating the full chat-to-action-to-retry-to-reconnect loop under real runtime conditions.

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

The headless runtime separation is still real and explicit. `scripts/startAgent.js` boots the process, `agent/agentRuntime.js` owns lifecycle and turn orchestration, `agent/runtimeState.js` carries runtime-owned authority and revisioned state, `agent/stateProjector.js` produces UI-facing projections, and `agent/commandService.js` keeps command routing constrained instead of exposing direct mutation.

**Evidence**

- [`scripts/startAgent.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/scripts/startAgent.js)
- [`agent/agentRuntime.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/agentRuntime.js)
- [`agent/runtimeState.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/runtimeState.js)
- [`agent/stateProjector.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/stateProjector.js)
- [`agent/commandService.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/commandService.js)
- [`documents/documentation/architecture/runtime-lifecycle.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/architecture/runtime-lifecycle.md)

**What changed this week**

No source-level change surfaced in the runtime architecture. The only measurable improvement is that the same contract surface still passes `npm run check`.

**What is still unverified**

No live Minecraft session proved the full turn lifecycle, including interruption and recovery.

**Sharpest risk or limitation**

The runtime design is coherent, but its real-world behavior under a live bot session is still not proven.

### 2. Control Plane

**Current state**

The local control plane remains implemented as a Node HTTP server with a WebSocket event bus. It still exposes health, readiness, state, config, learning, and command endpoints, and it still relies on token-based authorization. The snapshot/event model is present, but it is still only validated through code inspection and repo checks here.

**Evidence**

- [`control/localControlServer.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/control/localControlServer.js)
- [`control/runtimeEventBus.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/control/runtimeEventBus.js)
- [`dashboard/src/lib/runtimeClient.ts`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/dashboard/src/lib/runtimeClient.ts)
- [`README.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/README.md)

**What changed this week**

No new endpoint or event-stream behavior showed up in the codebase.

**What is still unverified**

The HTTP and WebSocket paths still have no live dashboard-session proof in this audit.

**Sharpest risk or limitation**

If the control plane degrades, operator visibility and commandability fall together.

### 3. Desktop Dashboard

**Current state**

The Tauri dashboard remains an operator shell, with the runtime store able to bootstrap the runtime, connect to the event stream, patch config, and send dashboard commands. Kid Mode and Builder Mode are still distinct surfaces, and the store still handles reconnect logic when the socket drops.

**Evidence**

- [`dashboard/src/store/runtimeStore.ts`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/dashboard/src/store/runtimeStore.ts)
- [`dashboard/src/components/KidMode.tsx`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/dashboard/src/components/KidMode.tsx)
- [`dashboard/src/components/BuilderMode.tsx`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/dashboard/src/components/BuilderMode.tsx)
- [`dashboard/src-tauri/src/main.rs`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/dashboard/src-tauri/src/main.rs)

**What changed this week**

No visible dashboard expansion landed in the source tree.

**What is still unverified**

The Tauri shell and runtime bootstrap path still lack live proof in a real Minecraft + dashboard session.

**Sharpest risk or limitation**

The dashboard can appear healthy while the underlying runtime is degraded or disconnected.

### 4. Identity + Profiles

**Current state**

Identity remains separated from live runtime state. The repo still supports bounded identity presets, persisted companion identity, and saved profiles that package identity and live config together. Runtime state continues to carry identity and profile revisions so UI consumers can tell deliberate profile changes from ordinary churn.

**Evidence**

- [`agent/identityPresets.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/identityPresets.js)
- [`memory/companionIdentityStore.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/memory/companionIdentityStore.js)
- [`memory/profileStore.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/memory/profileStore.js)
- [`shared/contracts/identity.ts`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/shared/contracts/identity.ts)
- [`agent/runtimeState.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/runtimeState.js)

**What changed this week**

No meaningful identity-model expansion surfaced.

**What is still unverified**

Profile switching has not been proven in a live gameplay session.

**Sharpest risk or limitation**

If the model ignores the identity prompt, the system has limited self-detection for that failure.

### 5. Anchors + Task Targeting

**Current state**

Anchor persistence and summarization are still implemented. The store can create, list, and fetch anchors, and runtime code can resolve anchors into task targets for downstream work.

**Evidence**

- [`memory/anchorStore.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/memory/anchorStore.js)
- [`agent/agentRuntime.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/agentRuntime.js)
- [`shared/contracts/anchors.ts`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/shared/contracts/anchors.ts)
- [`documents/documentation/architecture/data-flow.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/architecture/data-flow.md)

**What changed this week**

No clear anchor-flow change surfaced in the code I inspected.

**What is still unverified**

The full anchor lifecycle, from creation to runtime resolution to successful world targeting, still has not been exercised in live gameplay.

**Sharpest risk or limitation**

Anchor resolution still depends on runtime and store agreement about shape and semantics.

### 6. Retry + Learning

**Current state**

Retry learning remains one of the strongest seams. The runtime still normalizes failures into retry domains, tracks attempts and outcomes, persists learning events, and synthesizes guidance for later attempts and for the `what_worked` query. The retry coordinator also still has explicit loop detection and terminal outcomes.

**Evidence**

- [`agent/retryCoordinator.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/retryCoordinator.js)
- [`agent/retrySignatures.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/retrySignatures.js)
- [`structures/retrySchemas.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/structures/retrySchemas.js)
- [`memory/learningStore.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/memory/learningStore.js)
- [`tests/retryCoordinator.test.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/tests/retryCoordinator.test.js)
- [`tests/learningStore.test.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/tests/learningStore.test.js)

**What changed this week**

No new retry logic landed. The verification signal stayed green because `npm run check` completed successfully.

**What is still unverified**

Guidance injection during a real turn, with real model output and real Minecraft failure modes, is still unproven.

**Sharpest risk or limitation**

Retry guidance is only as strong as error normalization; unknown failures can still fall through.

### 7. Reconnect + Recovery

**Current state**

Reconnect handling still exists in the runtime: connection loss marks the bot unavailable, new turns can be gated, reconnect attempts use backoff with jitter, and explicit reconnect events are emitted. Interrupted tasks are tracked in runtime state.

**Evidence**

- [`agent/agentRuntime.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/agentRuntime.js)
- [`minecraft/bot.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/minecraft/bot.js)
- [`control/runtimeEventBus.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/control/runtimeEventBus.js)
- [`documents/documentation/architecture/runtime-lifecycle.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/architecture/runtime-lifecycle.md)

**What changed this week**

No obvious reconnect-path improvement surfaced in the source.

**What is still unverified**

No live disconnect/reconnect cycle was proven in this audit.

**Sharpest risk or limitation**

Reconnect is a critical recovery path with no live proof yet.

### 8. Safety + Correctness

**Current state**

Safety logic still exists in code: config patching validates key fields, runtime state separates static config from live config, and retry logic inspects current world state before certain reattempts. Risky toggles remain named explicitly in live config.

**Evidence**

- [`agent/agentRuntime.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/agentRuntime.js)
- [`agent/runtimeState.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/runtimeState.js)
- [`shared/contracts/config.ts`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/shared/contracts/config.ts)
- [`builder/buildWorker.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/builder/buildWorker.js)
- [`documents/documentation/architecture/state-and-identity.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/architecture/state-and-identity.md)

**What changed this week**

The same contract layer still passes `npm run check`, which keeps this seam from drifting silently.

**What is still unverified**

World-state validation before replay remains limited, and live config changes still lack end-to-end safety proof across turn states.

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

The verification signal stayed green again: `npm run check` completed successfully during this audit.

**What is still unverified**

There are still no integration tests for the runtime/control-plane/dashboard handshake, and no gameplay-level validation.

**Sharpest risk or limitation**

The suite is solid at the unit level but still thin at the system level.

### 10. Operator Readiness

**Current state**

Operator documentation, environment guidance, and troubleshooting notes remain in place. The README describes startup, environment variables, expected healthy signals, and the main component split, while the docs set out runtime lifecycle, persistence, networking, and operator runbooks.

**Evidence**

- [`README.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/README.md)
- [`documents/documentation/architecture/runtime-lifecycle.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/architecture/runtime-lifecycle.md)
- [`documents/documentation/infrastructure/persistence.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/infrastructure/persistence.md)
- [`documents/documentation/operator/runbook-troubleshooting.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/operator/runbook-troubleshooting.md)
- [`documents/documentation/operator/maintenance-and-observability.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/operator/maintenance-and-observability.md)

**What changed this week**

I did not find a material operator-readiness expansion in the code or docs I reviewed.

**What is still unverified**

The local startup and diagnosis flow still lacks live operational proof in this audit.

**Sharpest risk or limitation**

Documentation is decent, but it still outruns runtime proof.

## Implemented vs Verified vs Live-Validated

**Implemented but not verified**

- Dashboard bootstrap and reconnect behavior in the Tauri store.
- Control-plane HTTP and WebSocket endpoints.
- Identity/profile persistence and anchor persistence.
- Reconnect and recovery logic for Mineflayer disconnects.
- Config patch safety and runtime state separation.

**Verified but not live-validated**

- `npm run check` passes in this workspace.
- Unit-level retry, learning, Surreal, config, and prompt-building coverage exists.
- Contract shape for runtime, control, identity, anchors, and config is stable enough to lint/typecheck cleanly.

**Live-validated capabilities**

- None observed in this audit.
- I did not find direct evidence of a live Minecraft session, live dashboard session, or live reconnect/recovery exercise.

## Regressions / Drift

I did not find a code regression or a capability drift in the source tree. The only meaningful change relative to the previous audit is the absence of new capability growth: this week is essentially unchanged from 2026-05-24, and the report history now includes a new dated audit artifact rather than new shipped behavior. The same unresolved carryover items remain open, especially live session validation and system-level integration proof.

## Top 5 Capability Gains This Week

1. The weekly verification posture stayed green: `npm run check` passed again.
2. The report history is up to date, with a new dated audit record for traceability.
3. The runtime/control-plane/dashboard/identity/retry seams remain coherent and internally consistent.
4. The codebase still exposes explicit recovery, reconnect, and backpressure hooks rather than hiding them.
5. Operator documentation still maps the runtime shape clearly enough to support local diagnosis.

## Top 5 Capability Gaps Next

1. Live Minecraft session validation of the full chat-to-action-to-retry-to-reconnect loop.
2. Live dashboard session proof for runtime bootstrap, event streaming, and reconnect.
3. Integration coverage for the control-plane snapshot/event handshake.
4. End-to-end proof that anchor creation resolves correctly into world targeting.
5. Real gameplay validation that retry guidance is injected and used as intended.

## Recommended Next Week Focus

**3 highest-value validation tasks**

1. Exercise the full runtime loop in a real Minecraft session and capture evidence of command, retry, and reconnect behavior.
2. Validate dashboard reconnect against a live control plane and confirm snapshot resumption.
3. Prove anchor creation, resolution, and task targeting end to end in gameplay.

**3 highest-value implementation tasks**

1. Add an integration test for the control-plane snapshot/event handshake.
2. Add an end-to-end path for anchor creation and runtime resolution.
3. Add stronger runtime markers for interrupted-turn recovery and reconnect resumption.

**3 cleanup or hardening tasks**

1. Tighten operator docs around what is verified versus what is only implemented.
2. Add explicit health/readiness notes for dashboard reconnect and bootstrap behavior.
3. Improve observability around retry guidance injection and reconnect transitions.

## Scorecard

- **Architecture Maturity: 4/5**  
  The layering is clean, explicit, and stable, but the architecture is still mostly proven by code and checks rather than live gameplay.

- **Runtime Reliability: 3/5**  
  Retry and reconnect logic exist and are structured, but live recovery behavior is still unproven.

- **Desktop Readiness: 3/5**  
  The Tauri shell and runtime store are present and functional in code, but they are not yet live-validated here.

- **Operator Visibility: 3/5**  
  The control plane, event bus, and docs provide reasonable visibility, but the system still lacks live operational proof.

- **Test Coverage Confidence: 4/5**  
  `npm run check` passes and the repo has focused unit coverage across key seams, though integration coverage is still thin.

- **Live Validation Confidence: 1/5**  
  I found no direct evidence of live Minecraft or dashboard validation during this audit.

- **Overall Capability Readiness: 3/5**  
  The system is implemented and internally coherent, but it is still operationally immature because live validation is missing.

## Final Judgment

Structurally strong, operationally immature.

The previous audit was `documents/reports/capability/2026-05-24-capability-audit.md`. This audit does not show material capability growth over that baseline; it mainly confirms that the implemented surface and verification posture are holding steady without live runtime proof.
