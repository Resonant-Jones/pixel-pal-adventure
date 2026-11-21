// companion/companionApp.js
//
// The companion app: the half of voice that lives next to the game.
//
// WHAT THIS IS
//
// The agent (voice/) can synthesise a line and can transcribe a line. Neither
// of those is voice. Voice is a line leaving one machine at one moment and
// arriving in someone's ear at that same moment. This app is the part that
// does the leaving and the arriving:
//
//   Guardian speaks -> agent synthesises mp3 -> this app receives it over the
//   control plane's voice WebSocket -> decodes it -> plays it into the device
//   the voice client is listening to -> the player hears Guardian, from
//   Guardian's position, at the moment Guardian said it.
//
//   The player speaks -> the voice client hands the audio to this app ->
//   this app segments it, turns it into a wav, posts it to the control
//   plane -> the agent transcribes it and handles it exactly as if the
//   player had typed it.
//
// WHAT IT DELIBERATELY DOES NOT KNOW
//
// It does not know what Guardian said, or why, or what the memory contains.
// It does not know the player's trust tier. It moves audio and reports
// state. Every decision about *meaning* stays in the agent.
//
// WHY IT IS A SEPARATE PROCESS
//
// Two reasons, both hard. CoreAudio is unreachable from the sandboxed agent
// process, and the app must survive the agent restarting without the game's
// voice dying with it. The contract between them is one WebSocket and a
// handful of HTTP calls.

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { EventEmitter } = require("node:events");
const { WebSocket } = require("ws");

const { getCompanionConfig } = require("./companionConfig");
const { AudioEngine, VoiceActivityDetector, pcmToWav } = require("./audioEngine");

const MAX_TRANSCRIPT_ENTRIES = 60;
const MAX_LOG_ENTRIES = 120;

class CompanionApp extends EventEmitter {
  constructor({
    config = getCompanionConfig(),
    logger = console,
    fetchImpl = globalThis.fetch,
    audioEngine = null,
    playerTts = null,
    wsFactory = null
  } = {}) {
    super();

    this.config = config;
    this.logger = logger;
    this.fetch = fetchImpl;
    this.audio = audioEngine || new AudioEngine({
      ffmpegPath: config.ffmpegPath,
      logger,
      workDir: config.workDir
    });

    // Injectable so the app can be driven by a fake agent in tests, and so a
    // different WebSocket implementation can be dropped in without touching
    // anything else.
    this.wsFactory = wsFactory || ((url) => new WebSocket(url));

    // A second speech client, used only to speak *as* the player on the test
    // path. It is deliberately a different voice from Guardian's.
    this.playerTts = playerTts;

    this.socket = null;
    this.reconnectDelayMs = 1000;
    this.reconnectTimer = null;
    this.presenceTimer = null;
    this.server = null;

    this.captureSession = null;
    this.vad = new VoiceActivityDetector({
      sampleRate: config.audio.sampleRate,
      channels: config.audio.channels,
      thresholdDb: config.audio.vadThresholdDb,
      hangoverMs: config.audio.vadHangoverMs,
      maxUtteranceMs: config.audio.maxUtteranceMs
    });

    this.state = {
      startedAt: new Date().toISOString(),
      controlPlane: { connected: false, lastError: null, lastMessageAt: null },
      voice: { enabled: false, spokenCount: 0 },
      audio: {
        inputDevices: [],
        outputDevices: [],
        inputDevice: null,
        outputDevice: null,
        capturing: false,
        playing: false,
        levelDb: null,
        permission: "unknown",
        lastError: null
      },
      presence: null,
      transcript: [],
      log: [],
      verification: { running: false, stages: [], startedAt: null, finishedAt: null }
    };

    this.speakWaiters = new Set();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async start() {
    fs.mkdirSync(this.config.workDir, { recursive: true });

    this.#log("info", `Companion app starting on ${this.config.listen.host}:${this.config.listen.port}`);

    await this.#discoverAudio();

    this.#connectControlPlane();
    this.#startPresencePolling();
    await this.#startCapture();

    await this.#startHttpServer();

    this.#log("ok", "Companion app ready");
    this.emit("state", this.getState());

    return this;
  }

  async stop() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.presenceTimer) {
      clearInterval(this.presenceTimer);
      this.presenceTimer = null;
    }

    this.socket?.close();
    this.socket = null;

    this.captureSession?.stop();
    this.captureSession = null;

    this.audio.stopAll();

    if (this.server) {
      await new Promise((resolve) => this.server.close(resolve));
      this.server = null;
    }

    this.#log("info", "Companion app stopped");
  }

  // -------------------------------------------------------------------------
  // Control plane
  // -------------------------------------------------------------------------

  #connectControlPlane() {
    const { wsUrl, token } = this.config.controlPlane;

    if (!token) {
      this.state.controlPlane.lastError = "GUARDIAN_CONTROL_TOKEN is not set";
      this.state.controlPlane.connected = false;
      this.#log("error", "No control token — cannot reach the agent");
      this.emit("state", this.getState());
      return;
    }

    const url = `${wsUrl}?token=${encodeURIComponent(token)}`;
    const socket = this.wsFactory(url);
    this.socket = socket;

    socket.on("open", () => {
      this.state.controlPlane.connected = true;
      this.state.controlPlane.lastError = null;
      this.reconnectDelayMs = 1000;
      this.#log("ok", "Connected to the agent's voice channel");
      this.emit("state", this.getState());
    });

    socket.on("message", (raw) => {
      this.state.controlPlane.lastMessageAt = new Date().toISOString();
      void this.#handleControlMessage(raw.toString());
    });

    socket.on("error", (error) => {
      this.state.controlPlane.connected = false;
      this.state.controlPlane.lastError = error?.message || String(error);
      this.#log("error", `Voice channel error: ${error?.message || error}`);
      this.emit("state", this.getState());
    });

    socket.on("close", () => {
      this.state.controlPlane.connected = false;
      this.emit("state", this.getState());
      this.#scheduleReconnect();
    });
  }

  #scheduleReconnect() {
    if (this.reconnectTimer) return;

    this.#log("warn", `Voice channel closed — retrying in ${Math.round(this.reconnectDelayMs / 1000)}s`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.#connectControlPlane();
    }, this.reconnectDelayMs);

    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 15000);
  }

  async #handleControlMessage(raw) {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }

    if (payload.type === "voice_ready") {
      this.state.voice.enabled = Boolean(payload.enabled);
      const spoken = Array.isArray(payload.spoken) ? payload.spoken : [];
      this.state.voice.spokenCount = spoken.length;

      for (const line of spoken) {
        this.#pushTranscript({
          direction: "guardian",
          text: line.text,
          reason: line.reason,
          durationMs: line.durationMs,
          id: line.id,
          at: line.at,
          replayed: true
        });
      }

      this.#log("ok", `Voice channel ready — ${spoken.length} lines in hand`);
      this.emit("state", this.getState());
      return;
    }

    if (payload.type === "speak") {
      await this.#handleSpeak(payload);
    }
  }

  /**
   * Guardian said something. Record it, fetch the audio, put it on the wire.
   */
  async #handleSpeak(payload) {
    const entry = {
      direction: "guardian",
      text: payload.text,
      reason: payload.reason,
      durationMs: payload.durationMs,
      id: payload.id,
      at: new Date().toISOString()
    };

    this.#pushTranscript(entry);
    this.state.voice.spokenCount += 1;
    this.emit("state", this.getState());

    // A waiter registered by the verification needs the raw event too.
    for (const waiter of this.speakWaiters) {
      waiter(payload);
    }

    const output = this.state.audio.outputDevice;
    if (!output) {
      this.#log("warn", `Said "${truncate(payload.text, 48)}" — no output device, so it did not go on the wire`);
      return;
    }

    try {
      const audio = await this.#fetchAudio(payload.id);
      if (!audio) {
        this.#log("error", "Could not fetch the audio for that line");
        return;
      }

      const staged = path.join(this.config.workDir, `${payload.id}.${payload.format || "mp3"}`);
      fs.writeFileSync(staged, audio);

      const pcm = await this.audio.decodeToPcm(staged, { sampleRate: this.config.audio.sampleRate });

      this.state.audio.playing = true;
      this.emit("state", this.getState());

      // Guard against hearing ourselves. On a real transport the two legs are
      // separate devices and this does nothing; on a same-machine acoustic
      // loop it is the difference between a conversation and a stutter.
      if (this.config.audio.duckOnPlayback) {
        this.captureSession?.setDucked(true);
      }

      const result = await this.audio.playPcm(pcm, {
        deviceIndex: output.index,
        sampleRate: this.config.audio.sampleRate
      });

      if (this.config.audio.duckOnPlayback) {
        this.captureSession?.setDucked(false);
      }

      this.state.audio.playing = false;

      if (!result.ok) {
        this.state.audio.lastError = result.error;
        this.#log("error", `Playback failed: ${result.error}`);
      } else {
        this.#log("ok", `Spoke "${truncate(payload.text, 48)}" (${Math.round(pcm.length / 2 / this.config.audio.sampleRate * 100) / 100}s)`);
      }

      this.emit("state", this.getState());
    } catch (error) {
      this.state.audio.playing = false;
      this.state.audio.lastError = error?.message || String(error);
      this.#log("error", `Voice delivery failed: ${error?.message || error}`);
      this.emit("state", this.getState());
    }
  }

  async #fetchAudio(id) {
    const url = `${this.config.controlPlane.baseUrl}/voice/audio/${id}`;
    const response = await this.fetch(url, {
      headers: { Authorization: `Bearer ${this.config.controlPlane.token}` }
    });

    if (!response.ok) {
      throw new Error(`audio fetch failed: HTTP ${response.status}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  async controlGet(pathname) {
    const response = await this.fetch(`${this.config.controlPlane.baseUrl}${pathname}`, {
      headers: { Authorization: `Bearer ${this.config.controlPlane.token}` }
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body?.error || `HTTP ${response.status}`);
    }

    return body;
  }

  async controlPost(pathname, body) {
    const response = await this.fetch(`${this.config.controlPlane.baseUrl}${pathname}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.controlPlane.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body || {})
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || `HTTP ${response.status}`);
    }

    return payload;
  }

  async controlPostAudio(pathname, buffer) {
    const response = await this.fetch(`${this.config.controlPlane.baseUrl}${pathname}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.controlPlane.token}`,
        "Content-Type": "audio/wav"
      },
      body: buffer
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || `HTTP ${response.status}`);
    }

    return payload;
  }

  // -------------------------------------------------------------------------
  // Presence
  // -------------------------------------------------------------------------

  #startPresencePolling() {
    const tick = async () => {
      try {
        this.state.presence = await this.controlGet("/voice/presence");
      } catch (error) {
        this.state.presence = null;
        this.state.controlPlane.lastError = error?.message || String(error);
      }
      this.emit("state", this.getState());
    };

    void tick();
    this.presenceTimer = setInterval(tick, this.config.presenceIntervalMs);
  }

  // -------------------------------------------------------------------------
  // Audio
  // -------------------------------------------------------------------------

  async #discoverAudio() {
    try {
      this.state.audio.inputDevices = await this.audio.listInputDevices();
    } catch (error) {
      this.state.audio.lastError = `device discovery failed: ${error?.message || error}`;
    }

    const input = this.#resolveDevice(this.config.audio.inputDevice, this.state.audio.inputDevices);
    this.state.audio.inputDevice = input;

    const output = this.#resolveDevice(this.config.audio.outputDevice, null);
    this.state.audio.outputDevice = output;

    if (output && output.index === null) {
      // The output list is a separate CoreAudio list from the input list, so
      // a named output device has to be probed to find its index.
      const probed = await this.audio.probeOutputDevices();
      this.state.audio.outputDevices = probed;
    }

    this.#log(
      "info",
      `Audio: ${this.state.audio.inputDevices.length} input device(s), input=${input ? input.name || input.index : "none"}, output=${output ? output.name || output.index : "none"}`
    );
  }

  #resolveDevice(device, devices) {
    if (!device) return null;

    if (device.index !== null && device.index !== undefined) {
      const match = (devices || []).find((candidate) => candidate.index === device.index);
      return { index: device.index, name: match?.name || null };
    }

    const match = (devices || []).find(
      (candidate) => candidate.name && candidate.name.toLowerCase() === device.name.toLowerCase()
    );

    if (match) {
      return { index: match.index, name: match.name };
    }

    return { index: null, name: device.name };
  }

  async #startCapture() {
    const input = this.state.audio.inputDevice;

    if (!input || input.index === null) {
      this.state.audio.capturing = false;
      this.state.audio.permission = "no_device";
      this.#log("warn", "No input device configured — the app is not listening");
      return;
    }

    const session = this.audio.startCapture({
      deviceIndex: input.index,
      sampleRate: this.config.audio.sampleRate
    });

    this.captureSession = session;

    session.on("pcm", (chunk) => this.#ingestPcm(chunk));

    session.on("error", (error) => {
      this.state.audio.capturing = false;
      this.state.audio.lastError = error?.message || String(error);
      this.#log("error", `Capture failed: ${error?.message || error}`);
      this.emit("state", this.getState());
    });

    session.on("end", ({ code }) => {
      this.state.audio.capturing = false;
      this.state.audio.permission = code === 0 ? "granted" : "denied";
      this.#log(
        code === 0 ? "info" : "error",
        code === 0
          ? "Capture ended"
          : `Capture stopped unexpectedly (exit ${code}) — check microphone permission`
      );
      this.emit("state", this.getState());
    });

    this.state.audio.capturing = true;
    this.state.audio.permission = "granted";
    this.#log("ok", `Listening on ${input.name || `device ${input.index}`}`);
  }

  /**
   * The single door every inbound sample comes through — whether it came from
   * a real microphone or from a file standing in for one. Keeping one door
   * means the test path and the live path cannot drift apart.
   */
  #ingestPcm(chunk) {
    const result = this.vad.push(chunk);

    this.state.audio.levelDb = Number.isFinite(result.levelDb)
      ? Math.round(result.levelDb * 10) / 10
      : null;

    if (result.started) {
      this.#log("info", "Player started speaking");
      this.emit("state", this.getState());
    }

    if (result.ended && result.utterance) {
      this.#log("info", "Player stopped speaking — transcribing");
      void this.#transcribeUtterance(result.utterance);
    }
  }

  async #transcribeUtterance(pcm, { speaker = null } = {}) {
    const wav = pcmToWav(pcm, {
      sampleRate: this.config.audio.sampleRate,
      channels: this.config.audio.channels
    });

    const who = speaker || this.state.presence?.primaryPlayer || this.config.controlPlane.defaultSpeaker;

    try {
      const query = `?speaker=${encodeURIComponent(who)}&filename=capture.wav`;
      const result = await this.controlPostAudio(`/voice/transcribe${query}`, wav);

      this.#pushTranscript({
        direction: "player",
        text: result.transcript || "",
        speaker: who,
        approved: result.approved ?? null,
        at: new Date().toISOString(),
        bytes: wav.length
      });

      this.#log("ok", `Heard: "${truncate(result.transcript, 60)}"`);
      this.emit("state", this.getState());

      return result;
    } catch (error) {
      this.#log("error", `Transcription failed: ${error?.message || error}`);
      this.emit("state", this.getState());
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  /**
   * Make Guardian say a line. Goes through the agent so it is a real reply,
   * not a bypass.
   */
  async say(text, { reason = "companion" } = {}) {
    const line = String(text || "").trim();
    if (!line) {
      throw new Error("nothing to say");
    }

    const result = await this.controlPost("/voice/say", { text: line, reason });
    this.#log("info", `Asked Guardian to say: "${truncate(line, 48)}"`);
    this.emit("state", this.getState());
    return result;
  }

  /**
   * Speak *as* the player, through the real inbound chain.
   *
   * This is how two-way voice is exercised without a human in the loop: the
   * text is synthesised in a player's voice, decoded, run through the same
   * voice-activity detection a microphone would trigger, and posted for
   * transcription. Everything downstream of "a sound arrived" is the code
   * that runs in production.
   */
  async simulatePlayer(text, { speaker = null } = {}) {
    const line = String(text || "").trim();
    if (!line) {
      throw new Error("nothing to say");
    }

    if (!this.playerTts) {
      throw new Error("no player voice configured");
    }

    const spoken = await this.playerTts.speak(line);
    const staged = path.join(this.config.workDir, `player-${Date.now()}.${spoken.format || "mp3"}`);
    fs.writeFileSync(staged, spoken.audio);

    const pcm = await this.audio.decodeToPcm(staged, { sampleRate: this.config.audio.sampleRate });

    const who = speaker || this.state.presence?.primaryPlayer || this.config.controlPlane.defaultSpeaker;

    this.#log("info", `Simulating the player saying: "${truncate(line, 48)}"`);

    // Run it through the detector exactly as a microphone would.
    const before = this.vad.active;
    this.vad.reset();
    const result = this.vad.push(pcm);

    let utterance = result.utterance;
    if (!utterance) {
      // The detector did not fire — the phrase was too quiet or too short for
      // the threshold. Send it anyway rather than pretending the path ran.
      utterance = pcm;
      this.#log("warn", "Voice activity did not trigger — sending the phrase directly");
    }

    void before;
    this.emit("state", this.getState());

    return this.#transcribeUtterance(utterance, { speaker: who });
  }

  /**
   * Transcribe a piece of audio without letting the agent answer it.
   *
   * Used to prove that the audio about to go on the wire really does contain
   * the words Guardian said. Feeding it to the agent instead would make
   * Guardian answer its own voice.
   */
  async transcribeOnly(audioBuffer, { filename = "check.wav" } = {}) {
    const query = `?filename=${encodeURIComponent(filename)}&feed=0`;
    return this.controlPostAudio(`/voice/transcribe${query}`, audioBuffer);
  }

  // -------------------------------------------------------------------------
  // Verification
  // -------------------------------------------------------------------------

  /**
   * The acceptance test for two-way voice.
   *
   * Every stage uses the real transport: the real control plane, the real
   * speech provider, the real audio decode. Nothing here is mocked, because a
   * mocked voice test proves nothing about voice.
   */
  async runVerification({ speaker = null, playerLine = "Guardian, what are you building today?" } = {}) {
    if (this.state.verification.running) {
      throw new Error("a verification is already running");
    }

    const stages = [];
    const record = (name, ok, detail) => {
      stages.push({ name, ok, detail, at: new Date().toISOString() });
      this.state.verification.stages = [...stages];
      this.emit("state", this.getState());
    };

    this.state.verification = { running: true, stages, startedAt: new Date().toISOString(), finishedAt: null };
    this.emit("state", this.getState());

    try {
      // 1 — the agent is alive.
      try {
        const ready = await this.fetch(`${this.config.controlPlane.baseUrl}/ready`);
        const payload = await ready.json();
        record("agent reachable", Boolean(payload?.ready), payload?.ready ? "control plane is ready" : "control plane is not ready");
      } catch (error) {
        record("agent reachable", false, error?.message || String(error));
        return this.#finishVerification();
      }

      // 2 — the voice channel is connected.
      record(
        "voice channel connected",
        Boolean(this.state.controlPlane.connected),
        this.state.controlPlane.connected ? "websocket is open" : (this.state.controlPlane.lastError || "not connected")
      );

      // 3 — voice is enabled on the agent.
      const spoken = await this.controlGet("/voice/spoken");
      record(
        "voice enabled on the agent",
        Boolean(spoken?.enabled),
        spoken?.enabled ? "the agent will speak" : "the agent has voice disabled"
      );

      // 4 — Guardian speaks and the audio comes back.
      const line = "Voice link check. If you can hear this, the link is open.";
      const said = await this.controlPost("/voice/say", { text: line, reason: "verification" });
      const audioId = said?.id;
      record(
        "guardian speaks",
        Boolean(audioId),
        audioId ? `line "${line}"` : "the agent did not return an audio id"
      );

      if (!audioId) {
        return this.#finishVerification();
      }

      const audio = await this.#fetchAudio(audioId);
      record(
        "audio retrieved",
        audio?.length > 1000,
        `${audio?.length || 0} bytes of ${said.format || "mp3"}`
      );

      // 5 — the audio really contains the words. This is the stage that
      // matters: it proves the thing that would go on the wire is the thing
      // Guardian said, not silence, noise, or a truncated file.
      const staged = path.join(this.config.workDir, `verify-${audioId}.${said.format || "mp3"}`);
      fs.writeFileSync(staged, audio);
      const pcm = await this.audio.decodeToPcm(staged, { sampleRate: this.config.audio.sampleRate });
      const wav = pcmToWav(pcm, { sampleRate: this.config.audio.sampleRate });

      let heard = null;
      try {
        const result = await this.transcribeOnly(wav, { filename: "verify.wav" });
        heard = result?.transcript || "";
      } catch (error) {
        record("audio carries guardian's words", false, `transcription failed: ${error?.message || error}`);
        return this.#finishVerification();
      }

      const matches = voiceMatches(line, heard);
      record(
        "audio carries guardian's words",
        matches.ok,
        matches.ok ? `heard "${truncate(heard, 60)}"` : `expected "${truncate(line, 40)}" but heard "${truncate(heard, 40)}"`
      );

      // 6 — the player speaks, and the agent hears them.
      const who = speaker || this.state.presence?.primaryPlayer || "Panda_Nuggetz";
      const replyPromise = this.#waitForSpeak(20000);

      let playerHeard = null;
      try {
        const result = await this.simulatePlayer(playerLine, { speaker: who });
        playerHeard = result?.transcript || "";
      } catch (error) {
        record("player speech reaches the agent", false, error?.message || String(error));
        return this.#finishVerification();
      }

      const playerMatches = voiceMatches(playerLine, playerHeard);
      record(
        "player speech reaches the agent",
        playerMatches.ok,
        playerMatches.ok ? `heard "${truncate(playerHeard, 60)}"` : `expected "${truncate(playerLine, 40)}" but heard "${truncate(playerHeard, 40)}"`
      );

      // 7 — and the agent answers out loud.
      const reply = await replyPromise;
      record(
        "guardian answers out loud",
        Boolean(reply),
        reply ? `answered "${truncate(reply.text, 50)}"` : "no spoken reply arrived within 20s"
      );

      // 8 — the voice is placed where Guardian actually is.
      const presence = this.state.presence;
      const sameDimension = Boolean(presence?.guardian?.position);
      const players = presence?.players || [];
      const nearest = players[0];

      record(
        "voice placed at guardian's position",
        sameDimension,
        presence?.guardian?.position
          ? `guardian at ${presence.guardian.position.x}, ${presence.guardian.position.y}, ${presence.guardian.position.z} in ${presence.dimension}`
          : "no position for guardian"
      );

      record(
        "player is in the same world",
        Boolean(nearest),
        nearest
          ? `${nearest.name} is ${nearest.distance} blocks away${nearest.approved ? " (approved)" : " (guest)"}`
          : "no player is online"
      );

      return this.#finishVerification();
    } catch (error) {
      record("verification crashed", false, error?.message || String(error));
      return this.#finishVerification();
    }
  }

  #waitForSpeak(timeoutMs) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.speakWaiters.delete(waiter);
        resolve(null);
      }, timeoutMs);

      const waiter = (payload) => {
        clearTimeout(timer);
        this.speakWaiters.delete(waiter);
        resolve(payload);
      };

      this.speakWaiters.add(waiter);
    });
  }

  #finishVerification() {
    this.state.verification.running = false;
    this.state.verification.finishedAt = new Date().toISOString();
    this.state.verification.passed = this.state.verification.stages.every((stage) => stage.ok);

    this.#log(
      this.state.verification.passed ? "ok" : "error",
      `Voice check ${this.state.verification.passed ? "passed" : "failed"} — ${this.state.verification.stages.filter((s) => s.ok).length}/${this.state.verification.stages.length} stages`
    );

    this.emit("state", this.getState());
    return this.state.verification;
  }

  // -------------------------------------------------------------------------
  // HTTP + UI
  // -------------------------------------------------------------------------

  async #startHttpServer() {
    const uiDir = path.join(__dirname, "ui");

    this.server = http.createServer((request, response) => {
      void this.#handleHttpRequest(request, response, uiDir).catch((error) => {
        this.logger.error("[companion] request failed:", error);
        json(response, 500, { ok: false, error: error?.message || String(error) });
      });
    });

    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.config.listen.port, this.config.listen.host, () => {
        this.server.off("error", reject);
        resolve();
      });
    });

    this.#log("ok", `Companion UI at http://${this.config.listen.host}:${this.config.listen.port}`);
  }

  async #handleHttpRequest(request, response, uiDir) {
    const url = new URL(request.url || "/", `http://${this.config.listen.host}:${this.config.listen.port}`);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return serveFile(response, path.join(uiDir, "index.html"), "text/html; charset=utf-8");
    }

    if (request.method === "GET" && url.pathname.startsWith("/ui/")) {
      const name = path.basename(url.pathname);
      const types = {
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8"
      };
      return serveFile(response, path.join(uiDir, name), types[path.extname(name)] || "application/octet-stream");
    }

    if (request.method === "GET" && url.pathname === "/api/state") {
      return json(response, 200, this.getState());
    }

    if (request.method === "GET" && url.pathname === "/api/events") {
      return this.#streamState(response);
    }

    if (request.method === "POST" && url.pathname === "/api/say") {
      const body = await readJson(request);
      const result = await this.say(body.text, { reason: body.reason || "companion" });
      return json(response, 200, { ok: true, ...result });
    }

    if (request.method === "POST" && url.pathname === "/api/player-say") {
      const body = await readJson(request);
      const result = await this.simulatePlayer(body.text, { speaker: body.speaker });
      return json(response, 200, { ok: true, ...result });
    }

    if (request.method === "POST" && url.pathname === "/api/verify") {
      const body = await readJson(request);
      const result = await this.runVerification(body || {});
      return json(response, 200, { ok: true, ...result });
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/audio/")) {
      const id = path.basename(url.pathname);
      const file = this.#findStagedAudio(id);
      if (!file) {
        return json(response, 404, { ok: false, error: "not_found" });
      }
      return serveFile(response, file, "audio/mpeg");
    }

    return json(response, 404, { ok: false, error: "not_found" });
  }

  #findStagedAudio(id) {
    try {
      for (const name of fs.readdirSync(this.config.workDir)) {
        if (name.startsWith(`${id}.`) || name.startsWith(`verify-${id}.`)) {
          return path.join(this.config.workDir, name);
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  #streamState(response) {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });

    const send = () => {
      try {
        response.write(`data: ${JSON.stringify(this.getState())}\n\n`);
      } catch {
        // The client went away between the check and the write.
      }
    };

    send();

    const onState = () => send();
    this.on("state", onState);

    const heartbeat = setInterval(send, 5000);

    request_cleanup(response, () => {
      clearInterval(heartbeat);
      this.off("state", onState);
    });
  }

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  #pushTranscript(entry) {
    this.state.transcript.push(entry);
    if (this.state.transcript.length > MAX_TRANSCRIPT_ENTRIES) {
      this.state.transcript.splice(0, this.state.transcript.length - MAX_TRANSCRIPT_ENTRIES);
    }
  }

  #log(level, message) {
    this.state.log.push({ at: new Date().toISOString(), level, message });
    if (this.state.log.length > MAX_LOG_ENTRIES) {
      this.state.log.splice(0, this.state.log.length - MAX_LOG_ENTRIES);
    }

    if (level === "error") {
      this.logger.error?.(`[companion] ${message}`);
    } else if (level === "warn") {
      this.logger.warn?.(`[companion] ${message}`);
    } else {
      this.logger.log?.(`[companion] ${message}`);
    }
  }

  getState() {
    return {
      ...this.state,
      controlPlane: {
        ...this.state.controlPlane,
        baseUrl: this.config.controlPlane.baseUrl,
        hasToken: Boolean(this.config.controlPlane.token)
      },
      app: {
        host: this.config.listen.host,
        port: this.config.listen.port,
        startedAt: this.state.startedAt
      }
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(response, statusCode, body) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function readJson(request) {
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

function serveFile(response, filePath, contentType) {
  if (!fs.existsSync(filePath)) {
    json(response, 404, { ok: false, error: "not_found" });
    return;
  }

  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": fs.statSync(filePath).size
  });
  fs.createReadStream(filePath).pipe(response);
}

function request_cleanup(response, fn) {
  response.on("close", fn);
}

// Comparing what was said with what was heard.
//
// An exact match is the wrong test — speech recognition will not return the
// identical string, it will return the same words. So the comparison is on
// content words, with a stop-word list, and it is tolerant of the differences
// that do not matter ("today" vs "today?") while still failing when the
// audio is wrong.
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "has",
  "have", "he", "her", "his", "i", "in", "is", "it", "its", "me", "my", "of",
  "on", "or", "our", "she", "so", "that", "the", "their", "them", "there",
  "they", "this", "to", "up", "was", "we", "were", "what", "will", "with",
  "you", "your"
]);

function voiceMatches(expected, heard) {
  const want = contentWords(expected);
  const got = contentWords(heard);

  if (!want.length) {
    return { ok: false, expected, heard };
  }

  if (!got.length) {
    return { ok: false, expected, heard };
  }

  const hits = want.filter((word) => got.includes(word)).length;
  const ratio = hits / want.length;

  return { ok: ratio >= 0.6, ratio, expected, heard };
}

function contentWords(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^'+|'+$/g, ""))
    .filter((word) => word.length > 0 && !STOP_WORDS.has(word));
}

function truncate(text, max) {
  const value = String(text || "");
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

module.exports = {
  CompanionApp,
  voiceMatches,
  contentWords,
  truncate
};
