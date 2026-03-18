import type { AgentConfigPatch, DashboardCommand, RuntimeEvent, RuntimeSnapshot } from "../../../shared/contracts";

export interface RuntimeBootstrap {
  host: string;
  port: number;
  token: string;
  status: "starting" | "running";
}

async function request<T>(bootstrap: RuntimeBootstrap, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`http://${bootstrap.host}:${bootstrap.port}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${bootstrap.token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {})
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${path}`);
  }

  return response.json() as Promise<T>;
}

export async function waitForRuntimeReady(bootstrap: RuntimeBootstrap, timeoutMs = 30000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const ready = await request<{ ready: boolean }>(bootstrap, "/ready");
    if (ready.ready) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error("Runtime did not become ready in time.");
}

export function connectRuntimeEvents(
  bootstrap: RuntimeBootstrap,
  handlers: {
    onSnapshot: (snapshot: RuntimeSnapshot) => void;
    onEvent: (event: RuntimeEvent) => void;
    onClose: () => void;
  }
): WebSocket {
  const socket = new WebSocket(`ws://${bootstrap.host}:${bootstrap.port}/events?token=${bootstrap.token}`);

  socket.addEventListener("message", (message) => {
    const event = JSON.parse(message.data) as RuntimeEvent;
    if (event.type === "runtime_snapshot") {
      handlers.onSnapshot(event.payload as RuntimeSnapshot);
      return;
    }

    handlers.onEvent(event);
  });

  socket.addEventListener("close", () => {
    handlers.onClose();
  });

  return socket;
}

export async function getRuntimeSnapshot(bootstrap: RuntimeBootstrap) {
  return request<RuntimeSnapshot>(bootstrap, "/state");
}

export async function getRuntimeConfig(bootstrap: RuntimeBootstrap) {
  return request(bootstrap, "/config");
}

export async function patchRuntimeConfig(bootstrap: RuntimeBootstrap, patch: AgentConfigPatch) {
  return request(bootstrap, "/config", {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export async function sendDashboardCommand(bootstrap: RuntimeBootstrap, command: DashboardCommand) {
  const route = command.type.replace(/_/g, "-");
  return request(bootstrap, `/command/${route}`, {
    method: "POST",
    body: JSON.stringify(command)
  });
}

export async function fetchWhatWorked(bootstrap: RuntimeBootstrap) {
  return request<{ summary: string; events: unknown[]; scope: string }>(bootstrap, "/learning/what-worked");
}
