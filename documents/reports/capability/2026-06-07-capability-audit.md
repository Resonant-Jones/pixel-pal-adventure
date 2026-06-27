# Capability Audit - 2026-06-07

## Executive Summary
The capability surface is effectively unchanged from the 2026-05-31 audit: the headless runtime, control plane, dashboard, identity/profile layer, anchors, retry/learning loop, reconnect path, and safety seams are still present in code, and `npm run check` still passes. The biggest unresolved risk remains the same as prior weeks: there is still no direct evidence of a live Minecraft session validating the full chat-to-action-to-retry-to-reconnect loop under real runtime conditions.

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

The runtime separation is still explicit and coherent. `scripts/startAgent.js` boots the process, `agent/agentRuntime.js` owns lifecycle and turn orchestration, `agent/runtimeState.js` carries runtime-owned authority and revisioned state, `agent/stateProjector.js` produces UI-facing projections, and `agent/commandService.js` keeps command routing constrained instead of exposing direct mutation.

**Evidence**

- [`scripts/startAgent.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/scripts/startAgent.js)
- [`agent/agentRuntime.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/agentRuntime.js)
- [`agent/runtimeState.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/runtimeState.js)
- [`agent/stateProjector.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/stateProjector.js)
- [`agent/commandService.js`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/agent/commandService.js)
- [`README.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/README.md)

**What changed this week**

No source-level change surfaced in the runtime architecture. The only measurable confirmation is that the same contract surface still passes `npm run check`.

**What is still unverified**

No live Minecraft session proved the full turn lifecycle, including interruption and recovery.

**Sharpest risk or limitation**

The runtime design is coherent, but its real-world behavior under a live bot session is still not proven.

### 2. Control Plane

**Current state**

The local control plane remains a Node HTTP server with a WebSocket event bus. It still exposes health, readiness, state, config, learning, and command endpoints, and it still relies on token-based authorization. The snapshot/event model is present, but it is still validated through code inspection and repo checks only.

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

Identity remains separated from live runtime state. The repo still supports bounded identity presets, persisted companion identity, and saved profiles that package identity and live config together. Runtime state continues to carry identity and profile revisions so UI consumers can distinguish deliberate profile changes from ordinary churn.

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
- [`README.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/README.md)

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

Operator docs are present and useful, including startup, environment, architecture, troubleshooting, and observability guidance. The repo also keeps the startup manifest and Tauri shell logic in place, so a local operator can inspect and steer the runtime without a central service.

**Evidence**

- [`README.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/README.md)
- [`documents/documentation/operator/operator-guide.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/operator/operator-guide.md)
- [`documents/documentation/operator/runbook-troubleshooting.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/operator/runbook-troubleshooting.md)
- [`documents/documentation/operator/maintenance-and-observability.md`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/documents/documentation/operator/maintenance-and-observability.md)
- [`dashboard/src-tauri/src/main.rs`](/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion/dashboard/src-tauri/src/main.rs)

**What changed this week**

No obvious operator-facing documentation or startup-path expansion landed in the source tree.

**What is still unverified**

The ease of local startup, diagnosis, and recovery remains a code-and-doc claim rather than a live operator proof.

**Sharpest risk or limitation**

Documentation coverage is decent, but it still outruns runtime validation.

## Implemented vs Verified vs Live-Validated

**Implemented but not verified**

- Tauri dashboard bootstrap and shell supervision
- Local HTTP/WebSocket control plane
- Identity presets and profile persistence
- Anchor create/list/read persistence
- Reconnect coordinator and interrupted-turn handling
- Config patch validation and live/static config separation

**Verified but not live-validated**

- Retry loop detection and terminal outcomes
- Learning-store writes and `what_worked` summaries
- Unit-level bot adapter, prompt, config, and Surreal client checks
- TypeScript contract checks and broad `npm run check` coverage

**Live-validated capabilities**

- None observed in this audit. There is still no direct evidence of a live Minecraft session or a full end-to-end gameplay loop.

## Regressions / Drift

- No source regression was visible in the repo paths reviewed.
- The main drift risk is interpretive, not code-level: the system still looks capable on paper, but there is still no live proof that the full runtime loop behaves correctly under Minecraft conditions.
- `documents/reports/capability/2026-05-31-capability-audit.md` was present as an untracked file in the working tree during this audit, which is a documentation hygiene issue but not a runtime regression.

## Top 5 Capability Gains This Week

1. The codebase still preserves the full runtime/control/dashboard split without ambiguity.
2. The retry and learning surface remains the strongest verified logic seam.
3. `npm run check` still passes, so the typed/contracts and syntax surface remain coherent.
4. The dashboard store still contains explicit reconnect behavior instead of relying on manual refresh.
5. Operator documentation remains present enough to support local diagnosis, even if it does not prove runtime behavior.

## Top 5 Capability Gaps Next

1. Live Minecraft validation of the full chat-to-action-to-retry-to-reconnect loop.
2. End-to-end proof that the dashboard can supervise a real runtime session without desync.
3. Replay and recovery safety proof under interrupted turns and reconnect churn.
4. Integration coverage across control plane, runtime, and dashboard.
5. Stronger evidence that config/profile changes are safe across live turn boundaries.

## Recommended Next Week Focus

**Highest-value validation tasks**

1. Run a real Minecraft session and record the full event trail for one turn, one retry, and one reconnect path.
2. Exercise the dashboard against a live runtime and verify `/ready`, `/state`, `/events`, and command dispatch in one session.
3. Prove profile switching and identity rendering in a real runtime snapshot, not just in code.

**Highest-value implementation tasks**

1. Add an end-to-end integration test harness for runtime + control plane + dashboard client wiring.
2. Add explicit recovery-state events for interrupted turns so reconnect behavior is easier to inspect.
3. Tighten config patch boundaries so live-turn mutations are more obviously isolated.

**Cleanup or hardening tasks**

1. Add one or two operator runbook examples that map to the current event names.
2. Improve logging around reconnect backoff and retry terminal outcomes.
3. Clarify which settings are startup-only versus runtime-mutable in the operator docs.

## Scorecard

- **Architecture Maturity: 4/5**  
  The separation between runtime, memory, control plane, and dashboard is real and coherent, but it still needs live proof before it can be called operationally mature.

- **Runtime Reliability: 3/5**  
  Retry, reconnect, and interruption handling are present, but their behavior under live Minecraft conditions is still unproven.

- **Desktop Readiness: 3/5**  
  The Tauri shell and runtime store are functional in code, yet this audit still lacks a real desktop-session validation trail.

- **Operator Visibility: 3/5**  
  Docs, readiness endpoints, and event streaming exist, but observability is still mostly a code-path claim rather than a proven operator workflow.

- **Test Coverage Confidence: 4/5**  
  `npm run check` passes and the repository has meaningful unit coverage across core seams, but the system-level gap remains large.

- **Live Validation Confidence: 0/5**  
  There is still no direct evidence of a live Minecraft or dashboard runtime session validating the full capability stack.

- **Overall Capability Readiness: 3/5**  
  The system is structurally solid and clearly beyond concept stage, but it is still operationally immature because the hardest parts have not been live-validated.

## Final Judgment

**Structurally strong, operationally immature**

The repo still shows a real, well-factored capability surface, but the absence of live runtime proof keeps it below alpha credibility.
