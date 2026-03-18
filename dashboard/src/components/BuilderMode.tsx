import { useState } from "react";
import type { RuntimeEvent, RuntimeState } from "../../../shared/contracts";

interface BuilderModeProps {
  runtimeState: RuntimeState | null;
  rawEvents: RuntimeEvent[];
  whatWorkedSummary: string | null;
  onRefreshWhatWorked: () => void;
  onApplyProfile: (profileId: string) => void;
  onSaveDefault: () => void;
}

type BuilderTab = "status" | "config" | "learning" | "logs" | "diagnostics";

export function BuilderMode({
  runtimeState,
  rawEvents,
  whatWorkedSummary,
  onRefreshWhatWorked,
  onApplyProfile,
  onSaveDefault
}: BuilderModeProps) {
  const [tab, setTab] = useState<BuilderTab>("status");

  return (
    <div className="mode builder-mode">
      <section className="panel">
        <div className="mode-switch">
          {(["status", "config", "learning", "logs", "diagnostics"] as BuilderTab[]).map((nextTab) => (
            <button
              key={nextTab}
              className={tab === nextTab ? "primary" : "secondary"}
              onClick={() => setTab(nextTab)}
            >
              {nextTab[0].toUpperCase()}
              {nextTab.slice(1)}
            </button>
          ))}
        </div>
      </section>

      {tab === "status" ? (
        <section className="panel status-grid">
          <div>
            <p className="eyebrow">Runtime health</p>
            <h2>{runtimeState?.lifecycle || "booting"}</h2>
            <p>Provider: {runtimeState?.staticConfig.llmProvider || "unknown"}</p>
            <p>Connection: {runtimeState?.connectionHealth || "disconnected"}</p>
          </div>
          <div>
            <p className="eyebrow">World / session</p>
            <p>World: {runtimeState?.world.worldId || "none"}</p>
            <p>Session: {runtimeState?.world.sessionId || "none"}</p>
            <p>Current task: {runtimeState?.activeTask?.label || "idle"}</p>
          </div>
          <div>
            <p className="eyebrow">Connection state</p>
            <p>Reconnect status: {runtimeState?.reconnectState.status || "idle"}</p>
            <p>Reconnect attempts: {runtimeState?.reconnectState.attemptCount ?? 0}</p>
            <p>Retry turn: {runtimeState?.retryState.activeTurnId || "none"}</p>
          </div>
        </section>
      ) : null}

      {tab === "config" ? (
        <section className="panel status-grid">
          <div>
            <p className="eyebrow">Live behavior</p>
            <p>Autonomy: {runtimeState?.liveConfig.autonomyLevel || "balanced"}</p>
            <p>Behavior: {runtimeState?.liveConfig.behaviorMode || "balanced"}</p>
            <p>Verbosity: {runtimeState?.liveConfig.verbosity || "balanced"}</p>
          </div>
          <div>
            <p className="eyebrow">Identity</p>
            <p>Name: {runtimeState?.identity.displayName || "Guardian"}</p>
            <p>Preset: {runtimeState?.identity.personalityPreset || "friendly_builder"}</p>
            <p>Chat: {runtimeState?.identity.chatVerbosity || "balanced"}</p>
          </div>
          <div>
            <p className="eyebrow">Revision tracking</p>
            <p>Config: {runtimeState?.revisions.configRevision ?? 0}</p>
            <p>Identity: {runtimeState?.revisions.identityRevision ?? 0}</p>
            <p>Profile: {runtimeState?.revisions.profileRevision ?? 0}</p>
          </div>
          <div>
            <p className="eyebrow">Profiles</p>
            <div className="button-row">
              <button className="secondary" onClick={() => onApplyProfile("builder")}>
                Builder
              </button>
              <button className="secondary" onClick={() => onApplyProfile("explorer")}>
                Explorer
              </button>
              <button className="secondary" onClick={() => onApplyProfile("helper")}>
                Helper
              </button>
              <button className="secondary" onClick={() => onApplyProfile("careful")}>
                Careful
              </button>
            </div>
            <div className="button-row">
              <button className="primary" onClick={onSaveDefault}>
                Save as default
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {tab === "learning" ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Learning</p>
              <h3>What worked</h3>
            </div>
            <button className="secondary" onClick={onRefreshWhatWorked}>
              Refresh
            </button>
          </div>
          <p>{whatWorkedSummary || runtimeState?.latestLearningSummary?.summary || "No learning summary yet."}</p>
        </section>
      ) : null}

      {tab === "logs" ? (
        <section className="panel">
          <p className="eyebrow">Structured event stream</p>
          <div className="log-list">
            {rawEvents.length ? (
              rawEvents.map((event) => (
                <article key={event.eventId} className="log-entry">
                  <header>
                    <strong>{event.type}</strong>
                    <span>{event.timestamp}</span>
                  </header>
                  <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                </article>
              ))
            ) : (
              <p>No runtime events yet.</p>
            )}
          </div>
        </section>
      ) : null}

      {tab === "diagnostics" ? (
        <section className="panel status-grid">
          <div>
            <p className="eyebrow">Diagnostics</p>
            <p>Loop detected: {runtimeState?.retryState.loopDetected ? "yes" : "no"}</p>
            <p>Latest outcome: {runtimeState?.retryState.lastOutcome || "none"}</p>
            <p>Last reconnect error: {runtimeState?.reconnectState.lastErrorCode || "none"}</p>
          </div>
          <div>
            <p className="eyebrow">Queue</p>
            <p>Queued tasks: {runtimeState?.queuedTasks.length ?? 0}</p>
            <p>Interrupted tasks: {runtimeState?.interruptedTasks.length ?? 0}</p>
            <p>Anchor: {runtimeState?.activeAnchor?.description || "none"}</p>
          </div>
          <div>
            <p className="eyebrow">Provider</p>
            <p>LLM provider: {runtimeState?.staticConfig.llmProvider || "unknown"}</p>
            <p>Minecraft host: {runtimeState?.staticConfig.minecraft.host || "127.0.0.1"}</p>
            <p>Follow distance: {runtimeState?.liveConfig.followDistance ?? 2}</p>
          </div>
        </section>
      ) : null}
    </div>
  );
}
