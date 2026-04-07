import { invoke } from "@tauri-apps/api/core";
import type { StartupSettingsManifest, StartupSecrets, SettingsValidationResult } from "../../../shared/contracts";

export interface SettingsLoadResult {
  manifest: StartupSettingsManifest;
  validation: SettingsValidationResult;
  merged_from: string[];
}

export interface ShellRuntimeStatus {
  running: boolean;
  profile_id: string | null;
  profile_name: string | null;
  uptime_ms: number | null;
  pid: number | null;
}

export interface ShellUiState {
  settingsLoaded: boolean;
  settingsLoading: boolean;
  settingsError: string | null;
  manifest: StartupSettingsManifest | null;
  validation: SettingsValidationResult | null;
  mergedFrom: string[];
  secrets: StartupSecrets | null;
  runtimeStatus: ShellRuntimeStatus;
  settingsPanelOpen: boolean;
  pendingRestart: boolean;
  pendingRestartProfileId: string | null;
}

const INITIAL_STATE: ShellUiState = {
  settingsLoaded: false,
  settingsLoading: false,
  settingsError: null,
  manifest: null,
  validation: null,
  mergedFrom: [],
  secrets: null,
  runtimeStatus: {
    running: false,
    profile_id: null,
    profile_name: null,
    uptime_ms: null,
    pid: null
  },
  settingsPanelOpen: false,
  pendingRestart: false,
  pendingRestartProfileId: null
};

type Listener = () => void;

class ShellSettingsStore {
  private state: ShellUiState = INITIAL_STATE;
  private listeners = new Set<Listener>();

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState() {
    return this.state;
  }

  private setState(patch: Partial<ShellUiState>) {
    this.state = {
      ...this.state,
      ...patch
    };

    for (const listener of this.listeners) {
      listener();
    }
  }

  async loadSettings() {
    this.setState({ settingsLoading: true, settingsError: null });

    try {
      const result = await invoke<SettingsLoadResult>("load_shell_settings");
      this.setState({
        settingsLoaded: true,
        settingsLoading: false,
        manifest: result.manifest,
        validation: result.validation,
        mergedFrom: result.merged_from
      });
    } catch (error) {
      this.setState({
        settingsLoading: false,
        settingsError: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async saveSettings(manifest: StartupSettingsManifest) {
    this.setState({ settingsLoading: true, settingsError: null });

    try {
      await invoke("save_shell_settings", { manifest });
      this.setState({
        manifest,
        settingsLoading: false,
        pendingRestart: true,
        pendingRestartProfileId: manifest.activeProfileId
      });
    } catch (error) {
      this.setState({
        settingsLoading: false,
        settingsError: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async loadSecrets() {
    try {
      const secrets = await invoke<StartupSecrets>("load_shell_secrets");
      this.setState({ secrets });
    } catch (error) {
      console.error("Failed to load secrets:", error);
    }
  }

  async saveSecrets(secrets: StartupSecrets) {
    try {
      await invoke("save_shell_secrets", { secrets });
      this.setState({ secrets });
    } catch (error) {
      console.error("Failed to save secrets:", error);
      throw error;
    }
  }

  async getRuntimeStatus() {
    try {
      const status = await invoke<ShellRuntimeStatus>("get_runtime_status");
      this.setState({ runtimeStatus: status });
      return status;
    } catch (error) {
      console.error("Failed to get runtime status:", error);
      return INITIAL_STATE.runtimeStatus;
    }
  }

  async startRuntime(profileId?: string) {
    try {
      const bootstrap = await invoke<{
        host: string;
        port: number;
        token: string;
        status: string;
        profile_id: string | null;
        profile_name: string | null;
      }>("start_runtime", { profileId: profileId || null });

      await this.getRuntimeStatus();
      this.setState({ pendingRestart: false, pendingRestartProfileId: null });
      return bootstrap;
    } catch (error) {
      this.setState({
        settingsError: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async restartRuntime(profileId?: string) {
    try {
      const bootstrap = await invoke<{
        host: string;
        port: number;
        token: string;
        status: string;
        profile_id: string | null;
        profile_name: string | null;
      }>("restart_runtime", { profileId: profileId || null });

      await this.getRuntimeStatus();
      this.setState({ pendingRestart: false, pendingRestartProfileId: null });
      return bootstrap;
    } catch (error) {
      this.setState({
        settingsError: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async stopRuntime() {
    try {
      await invoke("stop_runtime");
      await this.getRuntimeStatus();
    } catch (error) {
      this.setState({
        settingsError: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  openSettingsPanel() {
    this.setState({ settingsPanelOpen: true });
  }

  closeSettingsPanel() {
    this.setState({ settingsPanelOpen: false });
  }

  clearPendingRestart() {
    this.setState({ pendingRestart: false, pendingRestartProfileId: null });
  }

  clearError() {
    this.setState({ settingsError: null });
  }
}

export const shellSettingsStore = new ShellSettingsStore();