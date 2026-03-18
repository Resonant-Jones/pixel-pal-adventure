import { invoke } from "@tauri-apps/api/core";
import type { AgentConfigPatch, CompanionIdentity, DashboardCommand, RuntimeEvent, RuntimeSnapshot, RuntimeState } from "../../../shared/contracts";
import { connectRuntimeEvents, fetchWhatWorked, getRuntimeSnapshot, patchRuntimeConfig, sendDashboardCommand, waitForRuntimeReady, type RuntimeBootstrap } from "../lib/runtimeClient";
import { toFriendlyEventText } from "../lib/eventText";

type Listener = () => void;

export interface RuntimeUiState {
  bootstrap: RuntimeBootstrap | null;
  snapshot: RuntimeSnapshot | null;
  runtimeState: RuntimeState | null;
  connectionStatus: "booting" | "connecting" | "connected" | "degraded" | "disconnected" | "error";
  rawEvents: RuntimeEvent[];
  friendlyFeed: string[];
  error: string | null;
  mode: "kid" | "builder";
}

const INITIAL_STATE: RuntimeUiState = {
  bootstrap: null,
  snapshot: null,
  runtimeState: null,
  connectionStatus: "booting",
  rawEvents: [],
  friendlyFeed: [],
  error: null,
  mode: "kid"
};

class RuntimeStore {
  private state: RuntimeUiState = INITIAL_STATE;
  private listeners = new Set<Listener>();
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState() {
    return this.state;
  }

  private setState(patch: Partial<RuntimeUiState>) {
    this.state = {
      ...this.state,
      ...patch
    };

    for (const listener of this.listeners) {
      listener();
    }
  }

  setMode(mode: "kid" | "builder") {
    this.setState({ mode });
  }

  async bootstrapRuntime() {
    this.setState({ connectionStatus: "connecting", error: null });
    const bootstrap = await invoke<RuntimeBootstrap>("ensure_runtime");
    await waitForRuntimeReady(bootstrap);
    const snapshot = await getRuntimeSnapshot(bootstrap);
    this.applySnapshot(snapshot, bootstrap);
    this.connectEvents(bootstrap);
  }

  private applySnapshot(snapshot: RuntimeSnapshot, bootstrap = this.state.bootstrap) {
    this.setState({
      bootstrap: bootstrap || null,
      snapshot,
      runtimeState: snapshot.state,
      connectionStatus: "connected"
    });
  }

  private applyEvent(event: RuntimeEvent) {
    if (!this.state.snapshot) {
      return;
    }

    if (event.sequence <= this.state.snapshot.lastSequence) {
      return;
    }

    const nextSnapshot: RuntimeSnapshot = {
      ...this.state.snapshot,
      lastSequence: event.sequence,
      state: event.type === "runtime_state_changed" ? event.payload.state : this.state.runtimeState || this.state.snapshot.state
    };
    const nextFeed = [toFriendlyEventText(event), ...this.state.friendlyFeed].slice(0, 10);
    const nextEvents = [event, ...this.state.rawEvents].slice(0, 100);

    this.setState({
      snapshot: nextSnapshot,
      runtimeState: nextSnapshot.state,
      rawEvents: nextEvents,
      friendlyFeed: nextFeed,
      connectionStatus: event.type === "runtime_heartbeat" ? "connected" : this.state.connectionStatus
    });
  }

  private connectEvents(bootstrap: RuntimeBootstrap) {
    this.socket?.close();
    this.socket = connectRuntimeEvents(bootstrap, {
      onSnapshot: (snapshot) => {
        this.applySnapshot(snapshot, bootstrap);
      },
      onEvent: (event) => {
        this.applyEvent(event);
      },
      onClose: () => {
        this.setState({ connectionStatus: "degraded" });
        this.scheduleReconnect();
      }
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || !this.state.bootstrap) {
      return;
    }

    this.reconnectTimer = window.setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        if (!this.state.bootstrap) {
          return;
        }

        await waitForRuntimeReady(this.state.bootstrap, 5000);
        const snapshot = await getRuntimeSnapshot(this.state.bootstrap);
        this.applySnapshot(snapshot, this.state.bootstrap);
        this.connectEvents(this.state.bootstrap);
      } catch (error) {
        this.setState({
          connectionStatus: "degraded",
          error: error instanceof Error ? error.message : String(error)
        });
        this.scheduleReconnect();
      }
    }, 1500);
  }

  async patchConfig(patch: AgentConfigPatch) {
    if (!this.state.bootstrap) {
      return;
    }

    await patchRuntimeConfig(this.state.bootstrap, patch);
  }

  async sendCommand(command: DashboardCommand) {
    if (!this.state.bootstrap) {
      return;
    }

    await sendDashboardCommand(this.state.bootstrap, command);
  }

  async refreshWhatWorked() {
    if (!this.state.bootstrap) {
      return null;
    }

    return fetchWhatWorked(this.state.bootstrap);
  }
}

export const runtimeStore = new RuntimeStore();
