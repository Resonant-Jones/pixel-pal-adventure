// companion/ui/app.js
//
// The companion app's front end.
//
// It is deliberately dumb. It renders whatever state the app hands it and
// posts three intents back: say something, speak as the player, run the
// check. It makes no decisions about voice, trust or the game.
//
// State arrives over a server-sent event stream, with a polling fallback for
// the case where the stream cannot be established.

const $ = (id) => document.getElementById(id);

const state = {
  transcript: [],
  log: [],
  stages: [],
  verificationRunning: false
};

let lastTranscriptKey = "";
let lastLogKey = "";
let lastStagesKey = "";

function start() {
  wireButtons();
  connectStream();
  pollOnce();
}

// ---------------------------------------------------------------- transport

function connectStream() {
  if (typeof EventSource === "undefined") {
    setInterval(pollOnce, 1000);
    return;
  }

  let source;
  try {
    source = new EventSource("/api/events");
  } catch {
    setInterval(pollOnce, 1000);
    return;
  }

  source.onmessage = (event) => {
    try {
      apply(JSON.parse(event.data));
    } catch {
      // A malformed frame is not worth taking the page down for.
    }
  };

  source.onerror = () => {
    source.close();
    // The stream drops when the app restarts. Fall back to polling so the
    // panel keeps working rather than freezing on a stale frame.
    setInterval(pollOnce, 1000);
  };
}

async function pollOnce() {
  try {
    const response = await fetch("/api/state");
    if (response.ok) {
      apply(await response.json());
    }
  } catch {
    // The app is down. The page shows the last known state.
  }
}

// ------------------------------------------------------------------ render

function apply(next) {
  state.transcript = next.transcript || [];
  state.log = next.log || [];
  state.stages = next.verification?.stages || [];
  state.verificationRunning = Boolean(next.verification?.running);

  renderPills(next);
  renderFacts(next);
  renderMeter(next);
  renderTranscript();
  renderStages();
  renderLog();
}

function renderPills(next) {
  const control = next.controlPlane || {};
  const voice = next.voice || {};
  const audio = next.audio || {};

  setPill("agent", control.connected, control.connected ? "agent" : "agent offline");
  setPill("voice", voice.enabled, voice.enabled ? "voice on" : "voice off");

  const output = audio.outputDevice;
  const outputOk = Boolean(output && output.index !== null && output.index !== undefined);
  setPill(
    "audio",
    outputOk,
    outputOk ? `voice out: ${output.name || `device ${output.index}`}` : "no output device"
  );

  const input = audio.inputDevice;
  const inputOk = Boolean(input && input.index !== null && input.index !== undefined);
  setPill(
    "capture",
    audio.capturing ? "ok" : inputOk ? "warn" : "bad",
    audio.capturing ? "listening" : inputOk ? "not listening" : "no input device"
  );
}

function setPill(key, state, label) {
  const pill = document.querySelector(`[data-pill="${key}"]`);
  if (!pill) return;

  const value = state === true ? "ok" : state === false ? "bad" : "warn";
  pill.dataset.state = value;
  pill.querySelector("span").textContent = label;
}

function renderFacts(next) {
  const control = next.controlPlane || {};
  const voice = next.voice || {};
  const audio = next.audio || {};
  const presence = next.presence;

  $("fact-agent").textContent = control.connected
    ? "connected"
    : control.lastError || "not connected";

  $("fact-voice").textContent = voice.enabled ? "enabled" : "disabled";
  $("fact-spoken").textContent = String(voice.spokenCount ?? 0);

  $("fact-input").textContent = describeDevice(audio.inputDevice);
  $("fact-output").textContent = describeDevice(audio.outputDevice);
  $("fact-permission").textContent = audio.permission || "unknown";

  if (presence) {
    const g = presence.guardian?.position;
    $("fact-guardian").textContent = g ? `${g.x}, ${g.y}, ${g.z}` : "unknown";
    $("fact-dimension").textContent = presence.dimension || "unknown";

    const nearest = (presence.players || [])[0];
    $("fact-nearest").textContent = nearest
      ? `${nearest.name} · ${nearest.distance ?? "?"} blocks${nearest.approved ? "" : " · guest"}`
      : "nobody online";
  } else {
    $("fact-guardian").textContent = "unknown";
    $("fact-dimension").textContent = "unknown";
    $("fact-nearest").textContent = "unknown";
  }
}

function describeDevice(device) {
  if (!device) return "not configured";
  if (device.index === null || device.index === undefined) {
    return `${device.name} (not found)`;
  }
  return device.name ? `${device.name}` : `device ${device.index}`;
}

function renderMeter(next) {
  const level = next.audio?.levelDb;
  const fill = $("level-fill");
  const label = $("level-label");

  if (level === null || level === undefined || !Number.isFinite(level)) {
    fill.style.width = "0%";
    label.textContent = "quiet";
    return;
  }

  // -60 dBFS is silence, -20 is loud. Map that band onto the bar.
  const pct = Math.max(0, Math.min(100, ((level + 60) / 40) * 100));
  fill.style.width = `${pct}%`;
  label.textContent = `${level.toFixed(1)} dB`;
}

function renderTranscript() {
  const key = state.transcript
    .map((entry) => `${entry.direction}:${entry.id || entry.at}:${entry.text}`)
    .join("|");

  if (key === lastTranscriptKey) return;
  lastTranscriptKey = key;

  const list = $("transcript");
  const empty = $("transcript-empty");
  list.textContent = "";

  if (!state.transcript.length) {
    empty.hidden = false;
    return;
  }

  empty.hidden = true;

  for (const entry of state.transcript) {
    list.appendChild(renderEntry(entry));
  }

  list.scrollTop = list.scrollHeight;
}

function renderEntry(entry) {
  const item = document.createElement("li");
  item.className = `entry ${entry.direction === "guardian" ? "guardian" : "player"}`;

  const head = document.createElement("div");
  head.className = "entry-head";

  const who = document.createElement("span");
  who.textContent = entry.direction === "guardian" ? "Guardian" : entry.speaker || "player";
  head.appendChild(who);

  if (entry.direction === "guardian") {
    if (entry.reason) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = entry.reason;
      head.appendChild(tag);
    }

    if (entry.id) {
      const play = document.createElement("button");
      play.className = "play";
      play.type = "button";
      play.textContent = "▸ hear";
      play.addEventListener("click", () => playLine(entry.id, play));
      head.appendChild(play);
    }
  } else if (entry.approved === false) {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = "guest";
    head.appendChild(tag);
  }

  const time = document.createElement("time");
  time.textContent = formatTime(entry.at);
  head.appendChild(time);

  const text = document.createElement("p");
  text.className = "entry-text";
  text.textContent = entry.text || "";

  item.appendChild(head);
  item.appendChild(text);

  return item;
}

function playLine(id, button) {
  const audio = new Audio(`/api/audio/${encodeURIComponent(id)}`);
  button.textContent = "▸ hear";

  audio.addEventListener("playing", () => {
    button.textContent = "■ stop";
  });
  audio.addEventListener("ended", () => {
    button.textContent = "▸ hear";
  });
  audio.addEventListener("error", () => {
    button.textContent = "▸ hear";
  });

  audio.play().catch(() => {
    button.textContent = "▸ hear";
  });
}

function renderStages() {
  const key = state.stages.map((stage) => `${stage.name}:${stage.ok}`).join("|");
  if (key === lastStagesKey) return;
  lastStagesKey = key;

  const list = $("stages");
  list.textContent = "";

  for (const stage of state.stages) {
    const item = document.createElement("li");
    item.className = "stage";
    item.dataset.state = stage.ok ? "ok" : "bad";

    const dot = document.createElement("i");
    const body = document.createElement("div");

    const name = document.createElement("b");
    name.textContent = stage.name;
    body.appendChild(name);

    const detail = document.createElement("span");
    detail.textContent = stage.detail || "";
    body.appendChild(detail);

    item.appendChild(dot);
    item.appendChild(body);
    list.appendChild(item);
  }
}

function renderLog() {
  const key = `${state.log.length}:${state.log[state.log.length - 1]?.at || ""}`;
  if (key === lastLogKey) return;
  lastLogKey = key;

  const list = $("events");
  list.textContent = "";

  for (const entry of state.log.slice(-60)) {
    const item = document.createElement("li");
    item.className = "event";
    item.dataset.level = entry.level;

    const time = document.createElement("time");
    time.textContent = formatTime(entry.at);

    const level = document.createElement("span");
    level.className = "lvl";
    level.textContent = entry.level;

    const message = document.createElement("span");
    message.className = "msg";
    message.textContent = entry.message;

    item.appendChild(time);
    item.appendChild(level);
    item.appendChild(message);
    list.appendChild(item);
  }

  list.parentElement.scrollTop = list.parentElement.scrollHeight;
}

// ------------------------------------------------------------------ actions

function wireButtons() {
  $("btn-say").addEventListener("click", () => post("/api/say", { text: $("say-text").value }));
  $("btn-player").addEventListener("click", () =>
    post("/api/player-say", { text: $("player-text").value })
  );
  $("btn-verify").addEventListener("click", () => post("/api/verify", {}));

  for (const id of ["say-text", "player-text"]) {
    $(id).addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        $(id === "say-text" ? "btn-say" : "btn-player").click();
      }
    });
  }
}

async function post(url, body) {
  const button = url === "/api/verify" ? $("btn-verify") : url === "/api/say" ? $("btn-say") : $("btn-player");
  const original = button.textContent;

  button.disabled = true;
  button.textContent = "…";

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
  } catch (error) {
    const hint = document.createElement("span");
    hint.className = "note";
    hint.style.color = "#b84a2a";
    hint.textContent = `That did not work: ${error.message}`;
    button.parentElement.appendChild(hint);
    setTimeout(() => hint.remove(), 6000);
  } finally {
    button.disabled = false;
    button.textContent = original;
    pollOnce();
  }
}

function formatTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

start();
