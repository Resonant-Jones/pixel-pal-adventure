import { useEffect, useMemo, useState } from "react";
import { KidMode } from "./components/KidMode";
import { BuilderMode } from "./components/BuilderMode";
import { SettingsPanel } from "./components/SettingsPanel";
import { PreflightLaunch } from "./components/PreflightLaunch";
import { runtimeStore } from "./store/runtimeStore";
import { shellSettingsStore } from "./store/shellSettingsStore";

function buildCommandId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function App() {
  const [, forceRender] = useState(0);
  const [launching, setLaunching] = useState(false);
  const [showPreflight, setShowPreflight] = useState(true);
  const [launchError, setLaunchError] = useState<string | null>(null);

  useEffect(() => {
    const unsubShell = shellSettingsStore.subscribe(() => forceRender((v) => v + 1));
    const unsubRuntime = runtimeStore.subscribe(() => forceRender((v) => v + 1));

    void shellSettingsStore.loadSettings();
    void shellSettingsStore.loadSecrets();
    void shellSettingsStore.getRuntimeStatus();

    return () => {
      unsubShell();
      unsubRuntime();
    };
  }, []);

  const shellState = shellSettingsStore.getState();
  const runtimeState = runtimeStore.getState();
  const identity = runtimeState.runtimeState?.identity;
  const activeMode = runtimeState.mode;
  const runtimeRunning = shellState.runtimeStatus.running;

  const connectionBanner = useMemo(() => {
    if (runtimeState.connectionStatus === "degraded") {
      return "Connection looks shaky. Trying to reconnect.";
    }

    if (runtimeState.connectionStatus === "error") {
      return runtimeState.error || "The dashboard hit an error.";
    }

    return null;
  }, [runtimeState.connectionStatus, runtimeState.error]);

  const handleLaunch = async (profileId: string | null) => {
    setLaunchError(null);
    setLaunching(true);
    try {
      await shellSettingsStore.startRuntime(profileId || undefined);
      const bootstrap = await runtimeStore.bootstrapRuntimeWithShell(profileId);
      setShowPreflight(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLaunchError(message);
      console.error("Launch failed:", error);
    } finally {
      setLaunching(false);
    }
  };

  const handleOpenSettings = () => {
    shellSettingsStore.openSettingsPanel();
  };

  const handleCloseSettings = () => {
    shellSettingsStore.closeSettingsPanel();
  };

  const handleSaveSettings = async (manifest: typeof shellState.manifest) => {
    if (!manifest) return;
    await shellSettingsStore.saveSettings(manifest);
  };

  const handleSaveSecrets = async (secrets: typeof shellState.secrets) => {
    if (!secrets) return;
    await shellSettingsStore.saveSecrets(secrets);
  };

  const handleRestartNow = async (profileId: string | null) => {
    await shellSettingsStore.restartRuntime(profileId || undefined);
    shellSettingsStore.clearPendingRestart();
  };

  const handleRestartLater = () => {
    shellSettingsStore.clearPendingRestart();
  };

  if (shellState.settingsPanelOpen && shellState.manifest) {
    return (
      <SettingsPanel
        manifest={shellState.manifest}
        secrets={shellState.secrets}
        validation={shellState.validation}
        mergedFrom={shellState.mergedFrom}
        runtimeRunning={runtimeRunning}
        onSave={handleSaveSettings}
        onSaveSecrets={handleSaveSecrets}
        onClose={handleCloseSettings}
        onRestartNow={handleRestartNow}
        onRestartLater={handleRestartLater}
        pendingRestart={shellState.pendingRestart}
      />
    );
  }

  if (showPreflight && !runtimeRunning) {
    return (
      <main className="app-shell">
        <aside className="sidebar">
          <p className="eyebrow">Guardian Console Alpha</p>
          <h1>{shellState.manifest?.baseSettings.companionName || "Guardian"}</h1>
          <p className="sidebar-copy">
            Settings-first Guardian Shell. Configure your settings below and launch when ready.
          </p>

          <div className="mode-switch">
            <button className="secondary" onClick={() => runtimeStore.setMode("kid")}>
              Kid Mode
            </button>
            <button className="secondary" onClick={() => runtimeStore.setMode("builder")}>
              Builder Mode
            </button>
          </div>

          <div className="status-pill">
            <span>offline</span>
            <span>not running</span>
          </div>
        </aside>

        <section className="content">
          <PreflightLaunch
            manifest={shellState.manifest}
            secrets={shellState.secrets}
            validation={shellState.validation}
            runtimeStatus={shellState.runtimeStatus}
            settingsLoaded={shellState.settingsLoaded}
            settingsError={shellState.settingsError}
            launchError={launchError}
            mergedFrom={shellState.mergedFrom}
            onLaunch={handleLaunch}
            onOpenSettings={handleOpenSettings}
            launching={launching}
          />
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <p className="eyebrow">Guardian Console Alpha</p>
        <h1>{identity?.displayName || shellState.manifest?.baseSettings.companionName || "Guardian"}</h1>
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
          <span>{runtimeState.connectionStatus}</span>
          <span>{runtimeState.runtimeState?.world.worldId || "no world"}</span>
        </div>

        <div className="sidebar-actions">
          <button className="secondary" onClick={handleOpenSettings}>
            Settings
          </button>
          {runtimeRunning && (
            <button className="secondary" onClick={() => void shellSettingsStore.stopRuntime()}>
              Stop Runtime
            </button>
          )}
        </div>

        {shellState.pendingRestart && (
          <div className="banner">
            <p>Restart needed</p>
            <button className="primary" onClick={() => handleRestartNow(shellState.pendingRestartProfileId)}>
              Restart Now
            </button>
          </div>
        )}
      </aside>

      <section className="content">
        {connectionBanner ? <div className="banner">{connectionBanner}</div> : null}

        {activeMode === "kid" ? (
          <KidMode
            runtimeState={runtimeState.runtimeState}
            friendlyFeed={runtimeState.friendlyFeed}
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
                requestedBy: runtimeState.runtimeState?.staticConfig.primaryPlayer || "Sage",
                anchorId: runtimeState.runtimeState?.activeAnchor?.id || null
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
            runtimeState={runtimeState.runtimeState}
            rawEvents={runtimeState.rawEvents}
            whatWorkedSummary={null}
            onRefreshWhatWorked={() => {
              void runtimeStore.refreshWhatWorked().then((result) => {
                // Handle what worked result
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