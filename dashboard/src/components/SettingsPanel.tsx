import { useState, useEffect } from "react";
import type { StartupSettingsManifest, StartupSecrets, SettingsValidationResult } from "../../../shared/contracts";
import type { SettingsLoadResult } from "../store/shellSettingsStore";

type SettingsTab =
  | "minecraft"
  | "companion"
  | "provider"
  | "surrealdb"
  | "memory"
  | "retry"
  | "secrets"
  | "profiles"
  | "runtime";

interface SettingsPanelProps {
  manifest: StartupSettingsManifest;
  secrets: StartupSecrets | null;
  validation: SettingsValidationResult | null;
  mergedFrom: string[];
  runtimeRunning: boolean;
  onSave: (manifest: StartupSettingsManifest) => Promise<void>;
  onSaveSecrets: (secrets: StartupSecrets) => Promise<void>;
  onClose: () => void;
  onRestartNow: (profileId: string | null) => void;
  onRestartLater: () => void;
  pendingRestart: boolean;
}

export function SettingsPanel({
  manifest,
  secrets,
  validation,
  mergedFrom,
  runtimeRunning,
  onSave,
  onSaveSecrets,
  onClose,
  onRestartNow,
  onRestartLater,
  pendingRestart
}: SettingsPanelProps) {
  const [tab, setTab] = useState<SettingsTab>("minecraft");
  const [localManifest, setLocalManifest] = useState<StartupSettingsManifest>(manifest);
  const [localSecrets, setLocalSecrets] = useState<StartupSecrets>(
    secrets || {
      minimaxApiKey: "",
      groqApiKey: "",
      ollamaApiKey: "",
      surrealPassword: ""
    }
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLocalManifest(manifest);
  }, [manifest]);

  useEffect(() => {
    if (secrets) {
      setLocalSecrets(secrets);
    }
  }, [secrets]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(localManifest);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSecrets = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSaveSecrets(localSecrets);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const updateBase = (path: string, value: unknown) => {
    const parts = path.split(".");
    setLocalManifest((prev) => {
      const next = { ...prev };
      let obj: Record<string, unknown> = next;
      for (let i = 0; i < parts.length - 1; i++) {
        obj = obj[parts[i]] as Record<string, unknown>;
      }
      obj[parts[parts.length - 1]] = value;
      return next;
    });
  };

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "minecraft", label: "Minecraft" },
    { id: "companion", label: "Companion" },
    { id: "provider", label: "Provider" },
    { id: "surrealdb", label: "SurrealDB" },
    { id: "memory", label: "Memory" },
    { id: "retry", label: "Retry" },
    { id: "secrets", label: "Secrets" },
    { id: "profiles", label: "Profiles" },
    { id: "runtime", label: "Runtime" }
  ];

  return (
    <div className="settings-overlay">
      <div className="settings-modal">
        <header className="settings-header">
          <h2>Settings</h2>
          <button className="secondary" onClick={onClose}>
            Close
          </button>
        </header>

        {pendingRestart && (
          <div className="banner">
            <p>Settings changed. Restart now to apply changes?</p>
            <div className="button-row">
              <button className="primary" onClick={() => onRestartNow(manifest.activeProfileId)}>
                Restart Now
              </button>
              <button className="secondary" onClick={onRestartLater}>
                Restart Later
              </button>
            </div>
          </div>
        )}

        {error && <div className="banner">{error}</div>}

        <nav className="settings-tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "primary" : "secondary"}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="settings-content">
          {tab === "minecraft" && (
            <section className="panel">
              <p className="eyebrow">Minecraft Connection</p>
              <div className="grid-two">
                <label className="field">
                  <span>Server Host</span>
                  <input
                    type="text"
                    value={localManifest.baseSettings.minecraft.host}
                    onChange={(e) =>
                      setLocalManifest({
                        ...localManifest,
                        baseSettings: {
                          ...localManifest.baseSettings,
                          minecraft: { ...localManifest.baseSettings.minecraft, host: e.target.value }
                        }
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Server Port</span>
                  <input
                    type="number"
                    value={localManifest.baseSettings.minecraft.port}
                    onChange={(e) =>
                      setLocalManifest({
                        ...localManifest,
                        baseSettings: {
                          ...localManifest.baseSettings,
                          minecraft: {
                            ...localManifest.baseSettings.minecraft,
                            port: parseInt(e.target.value) || 25565
                          }
                        }
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Auth Mode</span>
                  <select
                    value={localManifest.baseSettings.minecraft.auth}
                    onChange={(e) =>
                      setLocalManifest({
                        ...localManifest,
                        baseSettings: {
                          ...localManifest.baseSettings,
                          minecraft: { ...localManifest.baseSettings.minecraft, auth: e.target.value }
                        }
                      })
                    }
                  >
                    <option value="offline">Offline</option>
                    <option value="online">Online</option>
                    <option value="microsoft">Microsoft</option>
                  </select>
                </label>
                <label className="field">
                  <span>Follow Distance</span>
                  <input
                    type="number"
                    value={localManifest.baseSettings.minecraft.followDistance}
                    onChange={(e) =>
                      setLocalManifest({
                        ...localManifest,
                        baseSettings: {
                          ...localManifest.baseSettings,
                          minecraft: {
                            ...localManifest.baseSettings.minecraft,
                            followDistance: parseInt(e.target.value) || 2
                          }
                        }
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Primary Player</span>
                  <input
                    type="text"
                    value={localManifest.baseSettings.primaryPlayer}
                    onChange={(e) =>
                      setLocalManifest({
                        ...localManifest,
                        baseSettings: { ...localManifest.baseSettings, primaryPlayer: e.target.value }
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Respond to All Players</span>
                  <select
                    value={String(localManifest.baseSettings.minecraft.respondToAllPlayers)}
                    onChange={(e) =>
                      setLocalManifest({
                        ...localManifest,
                        baseSettings: {
                          ...localManifest.baseSettings,
                          minecraft: {
                            ...localManifest.baseSettings.minecraft,
                            respondToAllPlayers: e.target.value === "true"
                          }
                        }
                      })
                    }
                  >
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </label>
              </div>
            </section>
          )}

          {tab === "companion" && (
            <section className="panel">
              <p className="eyebrow">Companion Identity</p>
              <div className="grid-two">
                <label className="field">
                  <span>Companion Name</span>
                  <input
                    type="text"
                    value={localManifest.baseSettings.companionName}
                    onChange={(e) =>
                      setLocalManifest({
                        ...localManifest,
                        baseSettings: { ...localManifest.baseSettings, companionName: e.target.value }
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Companion Role</span>
                  <input
                    type="text"
                    value={localManifest.baseSettings.companionRole}
                    onChange={(e) =>
                      setLocalManifest({
                        ...localManifest,
                        baseSettings: { ...localManifest.baseSettings, companionRole: e.target.value }
                      })
                    }
                  />
                </label>
              </div>
              <label className="field">
                <span>Companion Personality</span>
                <textarea
                  rows={4}
                  value={localManifest.baseSettings.companionPersonality}
                  onChange={(e) =>
                    setLocalManifest({
                      ...localManifest,
                      baseSettings: { ...localManifest.baseSettings, companionPersonality: e.target.value }
                    })
                  }
                />
              </label>
            </section>
          )}

          {tab === "provider" && (
            <section className="panel">
              <p className="eyebrow">Model Provider</p>
              <label className="field">
                <span>LLM Provider</span>
                <select
                  value={localManifest.baseSettings.llmProvider}
                  onChange={(e) =>
                    setLocalManifest({
                      ...localManifest,
                      baseSettings: {
                        ...localManifest.baseSettings,
                        llmProvider: e.target.value as "minimax" | "groq" | "ollama"
                      }
                    })
                  }
                >
                  <option value="groq">Groq</option>
                  <option value="minimax">MiniMax</option>
                  <option value="ollama">Ollama</option>
                </select>
              </label>
              <p className="muted">Configure API keys in the Secrets tab.</p>
            </section>
          )}

          {tab === "surrealdb" && (
            <section className="panel">
              <p className="eyebrow">SurrealDB Connection</p>
              <p className="muted">SurrealDB settings are configured via environment variables.</p>
              <p className="muted">URL: {process.env.SURREAL_URL || "http://127.0.0.1:8000"}</p>
            </section>
          )}

          {tab === "memory" && (
            <section className="panel">
              <p className="eyebrow">Memory & Runtime</p>
              <div className="grid-two">
                <label className="field">
                  <span>Memory Window</span>
                  <input
                    type="number"
                    value={localManifest.baseSettings.agent.memoryWindow}
                    onChange={(e) =>
                      setLocalManifest({
                        ...localManifest,
                        baseSettings: {
                          ...localManifest.baseSettings,
                          agent: { ...localManifest.baseSettings.agent, memoryWindow: parseInt(e.target.value) || 12 }
                        }
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Event Window</span>
                  <input
                    type="number"
                    value={localManifest.baseSettings.agent.eventWindow}
                    onChange={(e) =>
                      setLocalManifest({
                        ...localManifest,
                        baseSettings: {
                          ...localManifest.baseSettings,
                          agent: { ...localManifest.baseSettings.agent, eventWindow: parseInt(e.target.value) || 6 }
                        }
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Max Pending Turns</span>
                  <input
                    type="number"
                    value={localManifest.baseSettings.agent.maxPendingTurns}
                    onChange={(e) =>
                      setLocalManifest({
                        ...localManifest,
                        baseSettings: {
                          ...localManifest.baseSettings,
                          agent: { ...localManifest.baseSettings.agent, maxPendingTurns: parseInt(e.target.value) || 4 }
                        }
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Allow Auto-Give Materials</span>
                  <select
                    value={String(localManifest.baseSettings.agent.allowAutoGiveBuildMaterials)}
                    onChange={(e) =>
                      setLocalManifest({
                        ...localManifest,
                        baseSettings: {
                          ...localManifest.baseSettings,
                          agent: {
                            ...localManifest.baseSettings.agent,
                            allowAutoGiveBuildMaterials: e.target.value === "true"
                          }
                        }
                      })
                    }
                  >
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </label>
              </div>
            </section>
          )}

          {tab === "retry" && (
            <section className="panel">
              <p className="eyebrow">Retry & Reconnect</p>
              <div className="grid-two">
                <label className="field">
                  <span>Max Retry Attempts</span>
                  <input
                    type="number"
                    value={localManifest.baseSettings.retry.maxAttempts}
                    onChange={(e) =>
                      setLocalManifest({
                        ...localManifest,
                        baseSettings: {
                          ...localManifest.baseSettings,
                          retry: { ...localManifest.baseSettings.retry, maxAttempts: parseInt(e.target.value) || 3 }
                        }
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Base Delay (ms)</span>
                  <input
                    type="number"
                    value={localManifest.baseSettings.retry.baseDelayMs}
                    onChange={(e) =>
                      setLocalManifest({
                        ...localManifest,
                        baseSettings: {
                          ...localManifest.baseSettings,
                          retry: { ...localManifest.baseSettings.retry, baseDelayMs: parseInt(e.target.value) || 500 }
                        }
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Max Delay (ms)</span>
                  <input
                    type="number"
                    value={localManifest.baseSettings.retry.maxDelayMs}
                    onChange={(e) =>
                      setLocalManifest({
                        ...localManifest,
                        baseSettings: {
                          ...localManifest.baseSettings,
                          retry: { ...localManifest.baseSettings.retry, maxDelayMs: parseInt(e.target.value) || 5000 }
                        }
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Reconnect Max Attempts</span>
                  <input
                    type="number"
                    value={localManifest.baseSettings.reconnect.maxAttempts}
                    onChange={(e) =>
                      setLocalManifest({
                        ...localManifest,
                        baseSettings: {
                          ...localManifest.baseSettings,
                          reconnect: {
                            ...localManifest.baseSettings.reconnect,
                            maxAttempts: parseInt(e.target.value) || 5
                          }
                        }
                      })
                    }
                  />
                </label>
              </div>
            </section>
          )}

          {tab === "secrets" && (
            <section className="panel">
              <p className="eyebrow">API Keys & Secrets</p>
              <p className="muted">Leave blank to preserve existing values. Clear explicitly to remove.</p>
              <div className="grid-two">
                <label className="field">
                  <span>Groq API Key</span>
                  <input
                    type="password"
                    placeholder={localSecrets?.groqApiKey ? "••••••••" : "Enter API key"}
                    value={localSecrets?.groqApiKey || ""}
                    onChange={(e) =>
                      setLocalSecrets({ ...localSecrets, groqApiKey: e.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>MiniMax API Key</span>
                  <input
                    type="password"
                    placeholder={localSecrets?.minimaxApiKey ? "••••••••" : "Enter API key"}
                    value={localSecrets?.minimaxApiKey || ""}
                    onChange={(e) =>
                      setLocalSecrets({ ...localSecrets, minimaxApiKey: e.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>Ollama API Key</span>
                  <input
                    type="password"
                    placeholder={localSecrets?.ollamaApiKey ? "••••••••" : "Enter API key"}
                    value={localSecrets?.ollamaApiKey || ""}
                    onChange={(e) =>
                      setLocalSecrets({ ...localSecrets, ollamaApiKey: e.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>SurrealDB Password</span>
                  <input
                    type="password"
                    placeholder={localSecrets?.surrealPassword ? "••••••••" : "Enter password"}
                    value={localSecrets?.surrealPassword || ""}
                    onChange={(e) =>
                      setLocalSecrets({ ...localSecrets, surrealPassword: e.target.value })
                    }
                  />
                </label>
              </div>
              <button className="primary" onClick={handleSaveSecrets} disabled={saving}>
                {saving ? "Saving..." : "Save Secrets"}
              </button>
            </section>
          )}

          {tab === "profiles" && (
            <section className="panel">
              <p className="eyebrow">Launch Profiles</p>
              <div className="profiles-list">
                {localManifest.profiles.map((profile) => (
                  <div key={profile.id} className="profile-card">
                    <div className="profile-info">
                      <strong>{profile.name}</strong>
                      {profile.description && <p>{profile.description}</p>}
                      {profile.isDefault && <span className="badge">Default</span>}
                    </div>
                    <button
                      className={localManifest.activeProfileId === profile.id ? "primary" : "secondary"}
                      onClick={() =>
                        setLocalManifest({
                          ...localManifest,
                          activeProfileId: profile.id
                        })
                      }
                    >
                      {localManifest.activeProfileId === profile.id ? "Active" : "Select"}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {tab === "runtime" && (
            <section className="panel">
              <p className="eyebrow">Runtime Controls</p>
              <p>Runtime Status: {runtimeRunning ? "Running" : "Stopped"}</p>
              {mergedFrom.length > 0 && (
                <p className="muted">
                  Settings merged from: {mergedFrom.join(" → ")}
                </p>
              )}
              {validation && !validation.valid && (
                <div className="banner">
                  <p>Validation errors:</p>
                  <ul>
                    {validation.errors.map((err, i) => (
                      <li key={i}>
                        {err.path}: {err.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {validation && validation.warnings.length > 0 && (
                <div className="banner" style={{ background: "rgba(184, 164, 42, 0.12)", color: "#b84a2a" }}>
                  <p>Warnings:</p>
                  <ul>
                    {validation.warnings.map((warn, i) => (
                      <li key={i}>
                        {warn.path}: {warn.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}
        </div>

        <footer className="settings-footer">
          <button className="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </footer>
      </div>
    </div>
  );
}