import type { StartupSettingsManifest, StartupSecrets, SettingsValidationResult } from "../../../shared/contracts";
import type { ShellRuntimeStatus } from "../store/shellSettingsStore";

interface PreflightLaunchProps {
  manifest: StartupSettingsManifest | null;
  secrets: StartupSecrets | null;
  validation: SettingsValidationResult | null;
  runtimeStatus: ShellRuntimeStatus;
  settingsLoaded: boolean;
  settingsError: string | null;
  launchError: string | null;
  mergedFrom: string[];
  onLaunch: (profileId: string | null) => void;
  onOpenSettings: () => void;
  launching: boolean;
}

export function PreflightLaunch({
  manifest,
  secrets,
  validation,
  runtimeStatus,
  settingsLoaded,
  settingsError,
  launchError,
  mergedFrom,
  onLaunch,
  onOpenSettings,
  launching
}: PreflightLaunchProps) {
  if (!settingsLoaded) {
    return (
      <div className="preflight">
        <div className="panel">
          <p className="eyebrow">Loading settings...</p>
          {settingsError && <div className="banner">{settingsError}</div>}
        </div>
      </div>
    );
  }

  if (!manifest) {
    return (
      <div className="preflight">
        <div className="panel">
          <p className="eyebrow">No Settings Found</p>
          <p>Could not load settings manifest.</p>
          {settingsError && <div className="banner">{settingsError}</div>}
          <button className="primary" onClick={onOpenSettings}>
            Open Settings
          </button>
        </div>
      </div>
    );
  }

  const activeProfile = manifest.profiles.find((p) => p.id === manifest.activeProfileId);
  const hasSecrets =
    (secrets?.groqApiKey && secrets.groqApiKey.length > 0) ||
    (secrets?.minimaxApiKey && secrets.minimaxApiKey.length > 0) ||
    (secrets?.ollamaApiKey && secrets.ollamaApiKey.length > 0);

  return (
    <div className="preflight">
      <section className="panel hero">
        <div>
          <p className="eyebrow">Ready to Launch</p>
          <h1>{manifest.baseSettings.companionName}</h1>
          <p className="preview">
            {manifest.baseSettings.companionRole} for {manifest.baseSettings.primaryPlayer}
          </p>
        </div>
        <div className="avatar-card">
          {manifest.baseSettings.companionName.slice(0, 1).toUpperCase()}
        </div>
      </section>

      {validation && !validation.valid && (
        <div className="banner">
          <p>Configuration has errors that may prevent startup:</p>
          <ul>
            {validation.errors.map((err, i) => (
              <li key={i}>
                {err.path}: {err.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="panel">
        <p className="eyebrow">Launch Profile</p>
        <div className="status-grid">
          <div>
            <p className="eyebrow">Active Profile</p>
            <h3>{activeProfile?.name || "Default"}</h3>
            {activeProfile?.description && <p>{activeProfile.description}</p>}
          </div>
          <div>
            <p className="eyebrow">Provider</p>
            <h3>{manifest.baseSettings.llmProvider}</h3>
          </div>
          <div>
            <p className="eyebrow">Minecraft</p>
            <h3>
              {manifest.baseSettings.minecraft.host}:{manifest.baseSettings.minecraft.port}
            </h3>
          </div>
        </div>
      </section>

      <section className="panel">
        <p className="eyebrow">Configuration Status</p>
        <div className="status-grid">
          <div>
            <p className="eyebrow">Secrets</p>
            <p>{hasSecrets ? "Configured" : "Missing"}</p>
          </div>
          <div>
            <p className="eyebrow">Merged From</p>
            <p>{mergedFrom.length > 0 ? mergedFrom.join(" → ") : "defaults only"}</p>
          </div>
          <div>
            <p className="eyebrow">Manifest</p>
            <p>v{manifest.version || "?"}</p>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="button-row">
          <button className="primary" onClick={() => onLaunch(manifest.activeProfileId)} disabled={launching}>
            {launching ? "Launching..." : "Launch Guardian"}
          </button>
          <button className="secondary" onClick={onOpenSettings}>
            Settings
          </button>
        </div>
      </section>

      {settingsError && (
        <div className="banner">{settingsError}</div>
      )}

      {launchError && (
        <div className="banner">{launchError}</div>
      )}
    </div>
  );
}