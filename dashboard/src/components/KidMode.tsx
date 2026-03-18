import type { CompanionIdentity, RuntimeState } from "../../../shared/contracts";

interface KidModeProps {
  runtimeState: RuntimeState | null;
  friendlyFeed: string[];
  onRename: (name: string) => void;
  onPreset: (preset: CompanionIdentity["personalityPreset"]) => void;
  onVerbosity: (value: CompanionIdentity["chatVerbosity"]) => void;
  onToneIntensity: (value: number) => void;
  onBehaviorMode: (value: "careful" | "balanced" | "creative") => void;
  onAutonomyLevel: (value: "guided" | "balanced" | "independent") => void;
  onRuntimeVerbosity: (value: "quiet" | "balanced" | "detailed") => void;
  onRunTask: (taskText: string) => void;
  onStop: () => void;
  onAnchorCommand: (type: "look" | "marker" | "area") => void;
}

const PRESETS: Array<{ value: CompanionIdentity["personalityPreset"]; label: string }> = [
  { value: "friendly_builder", label: "Friendly Builder" },
  { value: "brave_explorer", label: "Brave Explorer" },
  { value: "calm_teacher", label: "Calm Teacher" },
  { value: "funny_helper", label: "Funny Helper" },
  { value: "quiet_genius", label: "Quiet Genius" }
];

export function KidMode({
  runtimeState,
  friendlyFeed,
  onRename,
  onPreset,
  onVerbosity,
  onToneIntensity,
  onBehaviorMode,
  onAutonomyLevel,
  onRuntimeVerbosity,
  onRunTask,
  onStop,
  onAnchorCommand
}: KidModeProps) {
  const identity = runtimeState?.identity;
  const anchorSummary = runtimeState?.activeAnchor?.description || "No build spot picked yet.";
  const liveConfig = runtimeState?.liveConfig;

  return (
    <div className="mode kid-mode">
      <section className="panel hero">
        <div>
          <p className="eyebrow">My Helper</p>
          <h1>{identity?.displayName || "Guardian"}</h1>
          <p className="preview">
            {identity?.displayName || "Guardian"} is ready to help with building, exploring, and staying safe.
          </p>
        </div>
        <div className="avatar-card">{(identity?.displayName || "G").slice(0, 1)}</div>
      </section>

      <section className="panel grid-two">
        <label className="field">
          <span>Assistant name</span>
          <input
            defaultValue={identity?.displayName || "Guardian"}
            onBlur={(event) => onRename(event.target.value)}
            placeholder="Guardian"
          />
        </label>

        <label className="field">
          <span>Personality</span>
          <select
            value={identity?.personalityPreset || "friendly_builder"}
            onChange={(event) => onPreset(event.target.value as CompanionIdentity["personalityPreset"])}
          >
            {PRESETS.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>How talkative?</span>
          <select
            value={identity?.chatVerbosity || "balanced"}
            onChange={(event) => onVerbosity(event.target.value as CompanionIdentity["chatVerbosity"])}
          >
            <option value="quiet">Quiet</option>
            <option value="balanced">Balanced</option>
            <option value="talkative">Talkative</option>
          </select>
        </label>

        <label className="field">
          <span>Tone intensity</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={identity?.toneIntensity ?? 0.5}
            onChange={(event) => onToneIntensity(Number(event.target.value))}
          />
        </label>
      </section>

      <section className="panel">
        <p className="eyebrow">Mood / Style</p>
        <div className="grid-two">
          <label className="field">
            <span>Careful ↔ Creative</span>
            <select
              value={liveConfig?.behaviorMode || "balanced"}
              onChange={(event) => onBehaviorMode(event.target.value as "careful" | "balanced" | "creative")}
            >
              <option value="careful">Careful</option>
              <option value="balanced">Balanced</option>
              <option value="creative">Creative</option>
            </select>
          </label>
          <label className="field">
            <span>Quiet ↔ Talkative</span>
            <select
              value={liveConfig?.verbosity || "balanced"}
              onChange={(event) => onRuntimeVerbosity(event.target.value as "quiet" | "balanced" | "detailed")}
            >
              <option value="quiet">Quiet</option>
              <option value="balanced">Balanced</option>
              <option value="detailed">Talkative</option>
            </select>
          </label>
          <label className="field">
            <span>Guided ↔ Independent</span>
            <select
              value={liveConfig?.autonomyLevel || "balanced"}
              onChange={(event) => onAutonomyLevel(event.target.value as "guided" | "balanced" | "independent")}
            >
              <option value="guided">Guided</option>
              <option value="balanced">Balanced</option>
              <option value="independent">Independent</option>
            </select>
          </label>
        </div>
      </section>

      <section className="panel">
        <p className="eyebrow">What should I do?</p>
        <div className="task-row">
          <textarea id="kid-task-input" rows={4} placeholder="Build a tree house near the river." />
          <div className="button-row">
            <button
              className="primary"
              onClick={() => {
                const element = document.getElementById("kid-task-input") as HTMLTextAreaElement | null;
                onRunTask(element?.value || "");
              }}
            >
              Run
            </button>
            <button className="secondary" onClick={onStop}>
              Stop
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <p className="eyebrow">Build Here</p>
        <div className="button-row">
          <button className="secondary" onClick={() => onAnchorCommand("look")}>
            Use where I’m looking
          </button>
          <button className="secondary" onClick={() => onAnchorCommand("marker")}>
            Use marker block
          </button>
          <button className="secondary" onClick={() => onAnchorCommand("area")}>
            Use selected area
          </button>
        </div>
        <p className="anchor-summary">{anchorSummary}</p>
      </section>

      <section className="panel">
        <p className="eyebrow">Recent activity</p>
        <ul className="feed">
          {friendlyFeed.length ? friendlyFeed.map((item, index) => <li key={`${item}-${index}`}>{item}</li>) : <li>Nothing to show yet.</li>}
        </ul>
      </section>
    </div>
  );
}
