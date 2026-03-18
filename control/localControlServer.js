const http = require("http");
const { URL } = require("url");

const { WebSocketServer } = require("ws");

function json(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json"
  });
  response.end(JSON.stringify(body));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let data = "";

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      data += chunk;
    });
    request.on("end", () => {
      if (!data.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function buildAuthChecker(token) {
  return (requestUrl, headers = {}) => {
    if (!token) {
      return false;
    }

    const authorization = headers.authorization || headers.Authorization || "";
    if (authorization === `Bearer ${token}`) {
      return true;
    }

    const parsed = new URL(requestUrl, "http://127.0.0.1");
    return parsed.searchParams.get("token") === token;
  };
}

class LocalControlServer {
  constructor({
    runtime,
    eventBus,
    host = "127.0.0.1",
    port = 8787,
    authToken = "",
    logger = console
  }) {
    this.runtime = runtime;
    this.eventBus = eventBus;
    this.host = host;
    this.port = port;
    this.authToken = authToken;
    this.logger = logger;
    this.server = null;
    this.websocketServer = null;
    this.clients = new Set();
    this.ready = false;
    this.heartbeatTimer = null;
    this.isAuthorized = buildAuthChecker(authToken);
    this.onRuntimeEvent = (event) => {
      const serialized = JSON.stringify(event);
      for (const client of this.clients) {
        if (client.readyState === client.OPEN) {
          client.send(serialized);
        }
      }
    };
  }

  isReady() {
    return this.ready;
  }

  markReady() {
    this.ready = true;
  }

  markNotReady() {
    this.ready = false;
  }

  async handleRequest(request, response) {
    const requestUrl = new URL(request.url || "/", `http://${this.host}:${this.port}`);

    if (requestUrl.pathname === "/health") {
      json(response, 200, { ok: true, alive: true });
      return;
    }

    if (requestUrl.pathname === "/ready") {
      json(response, 200, {
        ok: true,
        ready: this.ready,
        authTokenLoaded: Boolean(this.authToken),
        projectorReady: Boolean(this.runtime?.getRuntimeSnapshot)
      });
      return;
    }

    if (!this.isAuthorized(request.url || "/", request.headers || {})) {
      json(response, 401, { ok: false, error: "unauthorized" });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/state") {
      json(response, 200, this.runtime.getRuntimeSnapshot());
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/config") {
      json(response, 200, this.runtime.getConfigSnapshot());
      return;
    }

    if (request.method === "PATCH" && requestUrl.pathname === "/config") {
      const body = await readJsonBody(request);
      const result = await this.runtime.applyConfigPatch(body);
      json(response, 200, result);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/learning/what-worked") {
      const summary = await this.runtime.queryWhatWorked({
        source: "dashboard"
      });
      json(response, 200, summary);
      return;
    }

    if (request.method === "POST" && requestUrl.pathname.startsWith("/command/")) {
      const body = await readJsonBody(request);
      const type = requestUrl.pathname.replace("/command/", "").replace(/-/g, "_");
      const result = await this.runtime.executeControlCommand({
        type,
        ...body
      });
      json(response, 200, result);
      return;
    }

    json(response, 404, { ok: false, error: "not_found" });
  }

  async listen() {
    if (this.server) {
      return this.server;
    }

    this.server = http.createServer((request, response) => {
      void this.handleRequest(request, response).catch((error) => {
        this.logger.error("[control] Request failed:", error);
        json(response, 500, { ok: false, error: error.message });
      });
    });

    this.websocketServer = new WebSocketServer({ noServer: true });
    this.server.on("upgrade", (request, socket, head) => {
      const requestUrl = new URL(request.url || "/", `http://${this.host}:${this.port}`);
      if (requestUrl.pathname !== "/events" || !this.isAuthorized(request.url || "/", request.headers || {})) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      this.websocketServer.handleUpgrade(request, socket, head, (websocket) => {
        this.clients.add(websocket);
        websocket.on("close", () => {
          this.clients.delete(websocket);
        });

        const snapshotEvent = this.eventBus.createSnapshotEvent(this.runtime.getRuntimeSnapshot());
        websocket.send(JSON.stringify(snapshotEvent));
      });
    });

    this.eventBus.on("event", this.onRuntimeEvent);

    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, this.host, () => {
        this.server.off("error", reject);
        resolve();
      });
    });

    this.ready = false;
    this.heartbeatTimer = setInterval(() => {
      const snapshot = this.runtime.getRuntimeSnapshot();
      this.eventBus.emitEvent("runtime_heartbeat", {
        snapshotVersion: snapshot.snapshotVersion,
        lastSequence: snapshot.lastSequence,
        connectionHealth: snapshot.state.connectionHealth
      });
    }, 5000);

    return this.server;
  }

  async close() {
    this.ready = false;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.websocketServer) {
      for (const client of this.clients) {
        client.close();
      }
      this.clients.clear();
      this.websocketServer.close();
      this.websocketServer = null;
    }

    if (this.server) {
      const server = this.server;
      this.server = null;
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }

    this.eventBus.off("event", this.onRuntimeEvent);
  }
}

module.exports = {
  LocalControlServer
};
