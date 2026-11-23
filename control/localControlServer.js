const http = require("http");
const { URL } = require("url");

const fs = require("fs");
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

// Read a raw request body. Used for captured audio, which arrives as binary
// rather than JSON. The size cap matters: this is a local server but it is
// reachable by anything on the loopback interface, including a companion app
// that has gone wrong.
function readBinaryBody(request, limitBytes = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > limitBytes) {
        reject(new Error("body_too_large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => resolve(Buffer.concat(chunks)));
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
    voiceService = null,
    logger = console
  }) {
    this.runtime = runtime;
    this.eventBus = eventBus;
    this.voiceService = voiceService;
    this.host = host;
    this.port = port;
    this.authToken = authToken;
    this.logger = logger;
    this.server = null;
    this.websocketServer = null;
    this.clients = new Set();
    this.voiceClients = new Set();
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
    this.onVoiceSpeak = (entry) => {
      const payload = {
        type: "speak",
        id: entry.id,
        text: entry.text,
        reason: entry.reason,
        durationMs: entry.durationMs,
        format: entry.format,
        audioUrl: `/voice/audio/${entry.id}`
      };
      const serialized = JSON.stringify(payload);
      for (const client of this.voiceClients) {
        if (client.readyState === client.OPEN) {
          client.send(serialized);
        }
      }
    };
    this.voiceService?.on?.("speak", this.onVoiceSpeak);
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

    if (request.method === "GET" && requestUrl.pathname === "/voice/spoken") {
      json(response, 200, {
        ok: true,
        enabled: Boolean(this.voiceService?.enabled),
        spoken: this.runtime?.listSpokenLines?.(50) || []
      });
      return;
    }

    // Where everyone is standing. The companion app polls this so the voice
    // it places is placed where Guardian actually is.
    if (request.method === "GET" && requestUrl.pathname === "/voice/presence") {
      json(response, 200, {
        ok: true,
        ...(this.runtime?.getVoicePresence?.() || {})
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/voice/say") {
      const body = await readJsonBody(request);
      const result = await this.runtime.speakLine(body.text || "", {
        reason: body.reason || "control"
      });
      json(response, 200, { ok: true, ...result });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/voice/transcribe") {
      const audio = await readBinaryBody(request);
      const filename = requestUrl.searchParams.get("filename") || "capture.wav";
      const speaker = requestUrl.searchParams.get("speaker") || null;

      // feed=0 transcribes without handing the line to the agent.
      //
      // The companion app needs this to check that the audio it is about to
      // put on the wire actually carries the words Guardian said. Feeding that
      // same audio to the agent would make Guardian answer its own voice,
      // which is a conversation with itself and not a test of anything.
      const feed = requestUrl.searchParams.get("feed") !== "0";

      const transcribed = await this.voiceService.transcribe(audio, { filename, speaker });

      if (!transcribed.ok) {
        json(response, 400, { ok: false, error: transcribed.error || transcribed.skipped });
        return;
      }

      if (!feed) {
        json(response, 200, {
          ok: true,
          transcript: transcribed.text,
          speaker: transcribed.speaker,
          fed: false
        });
        return;
      }

      const handled = await this.runtime.handleVoiceInput({
        speaker: transcribed.speaker,
        text: transcribed.text
      });

      json(response, 200, { ok: true, transcript: transcribed.text, ...handled });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname.startsWith("/voice/audio/")) {
      const id = requestUrl.pathname.replace("/voice/audio/", "");
      const audioPath = this.voiceService?.getAudioPath?.(id);

      if (!audioPath || !fs.existsSync(audioPath)) {
        json(response, 404, { ok: false, error: "not_found" });
        return;
      }

      const extension = audioPath.split(".").pop();
      const contentType = extension === "wav"
        ? "audio/wav"
        : extension === "flac"
          ? "audio/flac"
          : "audio/mpeg";

      response.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": fs.statSync(audioPath).size
      });
      fs.createReadStream(audioPath).pipe(response);
      return;
    }

    // Which embedder Guardian's memory uses.
    //
    // This is a picker, not a configuration file. The catalogue always lists
    // every provider a user could pick — including the ones that need a key
    // they have not entered yet — and each one carries its own status, so the
    // user can see what is available rather than reading a stack trace to
    // find out what is not.
    if (request.method === "GET" && requestUrl.pathname === "/memory/embedder") {
      json(response, 200, {
        ok: true,
        ...(this.runtime?.getEmbeddingStatus?.() || { providers: [], current: null, status: null })
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/memory/embedder/probe") {
      const body = await readJsonBody(request);
      const probe = await this.runtime.probeEmbedder(body);
      json(response, 200, { ok: probe.ok, probe });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/memory/embedder") {
      const body = await readJsonBody(request);

      try {
        const result = await this.runtime.setEmbedder(body);
        json(response, result.ok ? 200 : 422, { ...result, ok: result.ok });
      } catch (error) {
        json(response, 400, {
          ok: false,
          error: error?.message || String(error),
          code: error?.code || "embedding_failed",
          remedy: error?.remedy || null
        });
      }
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
      const isEvents = requestUrl.pathname === "/events";
      const isVoice = requestUrl.pathname === "/voice";

      if ((!isEvents && !isVoice) || !this.isAuthorized(request.url || "/", request.headers || {})) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      this.websocketServer.handleUpgrade(request, socket, head, (websocket) => {
        if (isVoice) {
          this.voiceClients.add(websocket);
          websocket.on("close", () => {
            this.voiceClients.delete(websocket);
          });

          // Catch the companion app up on what Guardian already said, so a
          // reconnect does not lose the last few lines.
          websocket.send(
            JSON.stringify({
              type: "voice_ready",
              enabled: Boolean(this.voiceService?.enabled),
              spoken: this.runtime?.listSpokenLines?.(20) || []
            })
          );
          return;
        }

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
      for (const client of this.voiceClients) {
        client.close();
      }
      this.voiceClients.clear();
      this.websocketServer.close();
      this.websocketServer = null;
    }

    this.voiceService?.off?.("speak", this.onVoiceSpeak);

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
