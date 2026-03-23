# Configuration

The runtime is environment-driven. Some settings are startup-only, while others can be patched live through the dashboard.

## Startup-Only Settings

These are read during bootstrap and generally require a restart to change.

| Variables | Effect | Code path |
| --- | --- | --- |
| `MC_HOST`, `MC_PORT`, `MC_VERSION`, `MC_AUTH` | Minecraft connection target and auth mode | `scripts/startAgent.js`, `minecraft/bot.js` |
| `PRIMARY_PLAYER`, `MC_PRIMARY_PLAYER`, `MC_BOT_USERNAME`, `MC_THREAD_ID`, `COMPANION_ROLE`, `COMPANION_PERSONALITY`, `MC_RESPOND_TO_ALL`, `MC_FOLLOW_DISTANCE` | Identity defaults, prompt persona, memory lane, and pathing defaults | `scripts/startAgent.js`, `agent/agentRuntime.js` |
| `LLM_PROVIDER` | Provider selection | `scripts/startAgent.js` |
| `MINIMAX_*`, `GROQ_*`, `OLLAMA_*` | Provider credentials and request tuning | `config/*.js`, `ai/*Client.js` |
| `SURREAL_URL`, `SURREAL_NAMESPACE`, `SURREAL_DATABASE`, `SURREAL_USERNAME`, `SURREAL_PASSWORD`, `SURREAL_CONNECT_TIMEOUT_MS` | Persistence target and auth | `config/surreal.js`, `memory/surrealClient.js` |
| `AGENT_RETRY_*` | Turn retry policy | `scripts/startAgent.js`, `agent/retryCoordinator.js` |
| `MC_RECONNECT_*` | Minecraft reconnect policy | `scripts/startAgent.js`, `agent/agentRuntime.js` |
| `GUARDIAN_CONTROL_HOST`, `GUARDIAN_CONTROL_PORT`, `GUARDIAN_CONTROL_TOKEN` | Control-plane binding and auth | `scripts/startAgent.js`, `control/localControlServer.js` |

## Live-Patched Settings

The dashboard can patch these at runtime through `control/localControlServer.js`:

- `liveConfig.followDistance`
- `liveConfig.autonomyLevel`
- `liveConfig.verbosity`
- `liveConfig.behaviorMode`
- `liveConfig.toolPermissions`
- `liveConfig.childFriendlyUi`
- `liveConfig.safetyConstraints`
- `liveConfig.activeIdentityPreset`
- identity fields such as `displayName`, `avatarIconId`, `personalityPreset`, `toneIntensity`, and `chatVerbosity`
- saved profiles via `profileId` / `persistProfile`

## Safe Defaults Versus Risky Settings

| Setting | Safer default | Risk if raised or loosened |
| --- | --- | --- |
| `MC_RESPOND_TO_ALL` | `false` | The bot responds to non-primary players and widens the trust boundary |
| `ALLOW_AUTO_GIVE_BUILD_MATERIALS` | `false` | The build worker can auto-provision materials in creative mode |
| `AGENT_MAX_PENDING_TURNS` | small value | Larger queues can hide backpressure and increase lag |
| `AGENT_RETRY_MAX_ATTEMPTS` | low value | Higher values can create retry storms |
| `MC_RECONNECT_MAX_ATTEMPTS` | moderate value | Higher values can mask a dead server and delay operator intervention |
| `AGENT_REFLEX_*` intervals | modest cadence | Too aggressive values can create chatter or job spam |

## Important Runtime Knobs

### Context And Memory

- `AGENT_MEMORY_WINDOW`
- `AGENT_EVENT_WINDOW`
- `AGENT_SUMMARY_INTERVAL`
- `AGENT_SUMMARY_WINDOW`
- `AGENT_SUMMARY_CONTEXT_LIMIT`

### Background Workers

- `AGENT_REFLEX_INTERVAL_MS`
- `AGENT_REFLEX_WORKER_INTERVAL_MS`
- `AGENT_BUILD_WORKER_INTERVAL_MS`
- `AGENT_REFLEX_GLOBAL_COOLDOWN_MS`
- `AGENT_REFLEX_TRIGGER_COOLDOWN_MS`
- `AGENT_REFLEX_IDLE_THRESHOLD_MS`

### Build Behavior

- `ALLOW_AUTO_GIVE_BUILD_MATERIALS`
- `AGENT_BUILD_DEBUG`
- `MC_FOLLOW_DISTANCE`

### Retry / Reconnect

- `AGENT_RETRY_MAX_ATTEMPTS`
- `AGENT_RETRY_BASE_DELAY_MS`
- `AGENT_RETRY_MAX_DELAY_MS`
- `AGENT_RETRY_JITTER`
- `AGENT_RETRY_GRAPH_FROM_ATTEMPT`
- `AGENT_RETRY_LOOP_THRESHOLD`
- `MC_RECONNECT_MAX_ATTEMPTS`
- `MC_RECONNECT_BASE_DELAY_MS`
- `MC_RECONNECT_MAX_DELAY_MS`
- `MC_RECONNECT_JITTER`

## Configuration Drift To Watch

- `threadId` defaults to a derived value when `MC_THREAD_ID` is not set. That is convenient, but it means changing the host, port, or primary player changes the memory lane.
- `llmProvider` changes prompt and output behavior, not just credentials.
- `SURREAL_URL` controls the protocol shape. A local `http://` path behaves differently from an embedded `surrealkv://` setup.
- Dashboard patches do not replace startup-only environment values.

## Known Risks / Gaps

- There is no single config manifest enforced at compile time; the runtime depends on `.env.example`, config loaders, and operator discipline.
- Live config changes are intentionally narrow. Anything that affects process wiring, persistence, or transport usually still needs a restart.
- Provider aliases (`OPENAI_*`) are convenient, but they can hide which actual provider is in use if the environment gets messy.
