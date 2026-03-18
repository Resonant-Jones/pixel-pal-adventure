import { useEffect, useMemo, useState } from "react";
import { KidMode } from "./components/KidMode";
import { BuilderMode } from "./components/BuilderMode";
import { runtimeStore } from "./store/runtimeStore";

function buildCommandId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function App() {
  const [, forceRender] = useState(0);
  const [whatWorkedSummary, setWhatWorkedSummary] = useState<string | null>(null);

  useEffect(() => runtimeStore.subscribe(() => forceRender((value) => value + 1)), []);
  useEffect(() => {
    void runtimeStore.bootstrapRuntime();
  }, []);

  const state = runtimeStore.getState();
  const runtimeState = state.runtimeState;
  const identity = runtimeState?.identity;
  const activeMode = state.mode;

  const connectionBanner = useMemo(() => {
    if (state.connectionStatus === "degraded") {
      return "Connection looks shaky. Trying to reconnect.";
    }

    if (state.connectionStatus === "error") {
      return state.error || "The dashboard hit an error.";
    }

    return null;
  }, [state.connectionStatus, state.error]);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <p className="eyebrow">Guardian Console Alpha</p>
        <h1>{identity?.displayName || "Guardian"}</h1>
        <p className="sidebar-copy">
          Local-first control for the Minecraft runtime, with Kid Mode for simple tasks and Builder Mode for debugging.
        </p>

        <div className="mode-switch">
          <button className={activeMode === "kid" ? "primary" : "secondary"} onClick={() => runtimeStore.setMode("kid")}>
            Kid Mode
          </button>
          <button className={activeMode === "builder" ? "primary" : "secondary"} onClick={() => runtimeStore.setMode("builder")}>
            Builder Mode
          </button>
        </div>

        <div className="status-pill">
          <span>{state.connectionStatus}</span>
          <span>{runtimeState?.world.worldId || "no world"}</span>
        </div>
      </aside>

      <section className="content">
        {connectionBanner ? <div className="banner">{connectionBanner}</div> : null}

        {activeMode === "kid" ? (
          <KidMode
            runtimeState={runtimeState}
            friendlyFeed={state.friendlyFeed}
            onRename={(name) =>
              void runtimeStore.patchConfig({
                identity: {
                  displayName: name
                }
              })
            }
            onPreset={(preset) =>
              void runtimeStore.patchConfig({
                liveConfig: {
                  activeIdentityPreset: preset
                }
              })
            }
            onVerbosity={(chatVerbosity) =>
              void runtimeStore.patchConfig({
                identity: {
                  chatVerbosity
                }
              })
            }
            onToneIntensity={(toneIntensity) =>
              void runtimeStore.patchConfig({
                identity: {
                  toneIntensity
                }
              })
            }
            onBehaviorMode={(behaviorMode) =>
              void runtimeStore.patchConfig({
                liveConfig: {
                  behaviorMode
                }
              })
            }
            onAutonomyLevel={(autonomyLevel) =>
              void runtimeStore.patchConfig({
                liveConfig: {
                  autonomyLevel
                }
              })
            }
            onRuntimeVerbosity={(verbosity) =>
              void runtimeStore.patchConfig({
                liveConfig: {
                  verbosity
                }
              })
            }
            onRunTask={(taskText) =>
              void runtimeStore.sendCommand({
                type: "run_task",
                commandId: buildCommandId("task"),
                timestamp: new Date().toISOString(),
                taskText,
                requestedBy: runtimeState?.staticConfig.primaryPlayer || "Sage",
                anchorId: runtimeState?.activeAnchor?.id || null
              })
            }
            onStop={() =>
              void runtimeStore.sendCommand({
                type: "pause",
                commandId: buildCommandId("pause"),
                timestamp: new Date().toISOString()
              })
            }
            onAnchorCommand={(kind) => {
              if (kind === "look") {
                void runtimeStore.sendCommand({
                  type: "create_anchor_from_look_direction",
                  commandId: buildCommandId("anchor"),
                  timestamp: new Date().toISOString(),
                  label: "Look Target"
                });
                return;
              }

              if (kind === "marker") {
                void runtimeStore.sendCommand({
                  type: "create_anchor_from_marker_block",
                  commandId: buildCommandId("anchor"),
                  timestamp: new Date().toISOString(),
                  label: "Marker Block",
                  markerBlockName: "gold_block"
                });
                return;
              }

              void runtimeStore.sendCommand({
                type: "create_area_anchor_from_corners",
                commandId: buildCommandId("anchor"),
                timestamp: new Date().toISOString(),
                label: "Build Area",
                cornerA: { x: 0, y: 64, z: 0 },
                cornerB: { x: 4, y: 64, z: 4 }
              });
            }}
          />
        ) : (
          <BuilderMode
            runtimeState={runtimeState}
            rawEvents={state.rawEvents}
            whatWorkedSummary={whatWorkedSummary}
            onRefreshWhatWorked={() => {
              void runtimeStore.refreshWhatWorked().then((result) => {
                setWhatWorkedSummary(result?.summary || null);
              });
            }}
            onApplyProfile={(profileId) =>
              void runtimeStore.patchConfig({
                profileId
              })
            }
            onSaveDefault={() =>
              void runtimeStore.patchConfig({
                profileId: "default",
                profileName: "Default",
                persistProfile: true
              })
            }
          />
        )}
      </section>
    </main>
  );
}
