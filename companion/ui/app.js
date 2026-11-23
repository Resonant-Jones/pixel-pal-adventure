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
  verificationRunning: false,
  // The embedder picker. `embedder` is the catalogue the agent reports;
  // `embedderSelection` is what the user has picked in this panel. They are
  // separate on purpose: the selection is a pending intent until it is
  // probed and used, and the panel must be able to show a provider the
  // agent has never heard of.
  embedder: null,
  embedderSelection: null,
  embedderProbes: {},
  embedderBusy: false,
  // What the user has typed, per provider. The panel re-renders on every
  // state change, and a re-render that drops a half-typed API key is the
  // kind of thing that makes a person give up on the panel entirely. The
  // draft is the truth; the inputs are a view of it.
  embedderDraft: {}
};

let lastTranscriptKey = "";
let lastLogKey = "";
let lastStagesKey = "";
let lastEmbedderKey = "";

function start() {
  wireButtons();
  connectStream();
  pollOnce();
  loadEmbedder();
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
  const outputOk = Boolean(output && (output.name || (output.index !== null && output.index !== undefined)));
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

  // The state arrives as a word, not a boolean. Comparing it to `true` would
  // make every labelled state fall through to the warning colour, which is
  // exactly what a healthy link should not look like.
  const value = state === "ok" || state === true ? "ok" : state === "bad" || state === false ? "bad" : "warn";
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

  $("fact-input").textContent = describeDevice(audio.inputDevice, { requireIndex: true });
  $("fact-output").textContent = describeDevice(audio.outputDevice, { requireIndex: false });
  $("fact-permission").textContent = audio.permission || "unknown";
  $("fact-guard").textContent = describeGuard(audio.inputGuard);

  if (presence) {
    const g = presence.guardian?.position;
    $("fact-guardian").textContent = g ? `${g.x}, ${g.y}, ${g.z}` : "unknown";
    $("fact-dimension").textContent = presence.dimension || "unknown";

    const nearest = (presence.players || [])[0];
    $("fact-nearest").textContent = nearest
      ? `${nearest.name} · ${nearest.inView ? `${nearest.distance ?? "?"} blocks` : "heard recently"}${nearest.approved ? "" : " · guest"}`
      : "nobody online";

    // Who Guardian is talking to. "nobody" is the important word here: it is
    // the answer when the room is empty, and Guardian is quiet in that case.
    $("fact-audience").textContent = presence.audience === "present"
      ? (nearest ? nearest.name : "somebody")
      : "nobody — the room is empty";
  } else {
    $("fact-guardian").textContent = "unknown";
    $("fact-dimension").textContent = "unknown";
    $("fact-nearest").textContent = "unknown";
  }
}

// The input device must resolve to a real index — an unmatched name means
// the microphone is not there. The output device may legitimately be a name
// only: macOS playback goes through audiotoolbox, which cannot list its
// devices, so a name is how you say which one you mean.
function describeDevice(device, { requireIndex = true } = {}) {
  if (!device) return "not configured";
  if (device.index === null || device.index === undefined) {
    return requireIndex ? `${device.name} (not found)` : device.name;
  }
  return device.name ? `${device.name}` : `device ${device.index}`;
}

// The system default input, and whether the watchdog is holding it.
//
// "held" means the guard is running and the machine's own microphone is the
// system default. "watching" means the guard is running but has not had to
// move anything yet — which is the same answer, said quietly.
function describeGuard(guard) {
  if (!guard) {
    return "not watched";
  }

  if (!guard.available) {
    return "guard not built";
  }

  if (!guard.running) {
    return guard.error ? "guard stopped" : "guard not running";
  }

  if (guard.moves > 0) {
    const times = guard.moves === 1 ? "once" : `${guard.moves} times`;
    return `held on ${guard.device} (took it back ${times})`;
  }

  return `held on ${guard.device}`;
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

// ----------------------------------------------------------------- embedder
//
// The Memory panel.
//
// The rule it follows: a user should never have to open a dotfile to choose
// how Guardian understands memory, and should never have to read a stack
// trace to find out that a choice does not work.
//
// So the catalogue always shows every provider — including the ones with no
// key yet, because a list that hides them is deep settings with extra steps.
// Each card states what is known about that provider: "needs a key", "key
// saved", "in use", or the reason a test failed.
//
// Two buttons, and the order matters. "Test it" never changes anything.
// "Use this one" tests first, and refuses to switch if the test fails.

async function loadEmbedder() {
  try {
    const response = await fetch("/api/memory/embedder");
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload.providers) {
      state.embedder = payload;
      if (!state.embedderSelection) {
        state.embedderSelection = payload.current?.provider || payload.providers[0]?.id || null;
      }
      renderEmbedder();
    } else {
      showEmbedderResult("The agent is not reachable, so the list cannot be loaded.", "bad");
    }
  } catch {
    showEmbedderResult("The agent is not reachable, so the list cannot be loaded.", "bad");
  }
}

function renderEmbedder() {
  const payload = state.embedder;
  if (!payload) return;

  const key = JSON.stringify({
    current: payload.current,
    status: payload.status,
    providers: payload.providers.map((p) => [p.id, p.active, p.keyStored]),
    selection: state.embedderSelection,
    probes: Object.keys(state.embedderProbes).sort(),
    busy: state.embedderBusy
  });

  if (key === lastEmbedderKey) return;
  lastEmbedderKey = key;

  renderProviderList(payload);
  renderEmbedderDetail(payload);
}

function renderProviderList(payload) {
  const list = $("embedder-providers");
  list.textContent = "";

  for (const provider of payload.providers) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "provider";
    item.setAttribute("role", "radio");
    item.setAttribute("aria-checked", String(provider.id === state.embedderSelection));

    if (provider.id === state.embedderSelection) {
      item.dataset.selected = "true";
    }

    const head = document.createElement("div");
    head.className = "provider-head";

    const dot = document.createElement("i");
    dot.dataset.state = providerStatus(provider);

    const label = document.createElement("b");
    label.textContent = provider.label;

    head.appendChild(dot);
    head.appendChild(label);

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = providerBadge(provider);
    badge.dataset.state = providerStatus(provider);
    head.appendChild(badge);

    const blurb = document.createElement("span");
    blurb.className = "provider-blurb";
    blurb.textContent = provider.blurb;

    item.appendChild(head);
    item.appendChild(blurb);

    item.addEventListener("click", () => {
      state.embedderSelection = provider.id;
      renderEmbedder();
    });

    list.appendChild(item);
  }
}

// What is known about a provider right now. Deliberately conservative: a
// provider with a key saved has NOT been tested, and the panel must not
// imply that it has.
function providerStatus(provider) {
  if (provider.active) {
    return "ok";
  }

  const probe = state.embedderProbes[provider.id];
  if (probe) {
    return probe.ok ? "ok" : "bad";
  }

  if (provider.needsKey) {
    return "warn";
  }

  return "idle";
}

function providerBadge(provider) {
  if (provider.active) {
    return "in use";
  }

  const probe = state.embedderProbes[provider.id];
  if (probe) {
    if (probe.ok) {
      return probe.dimension ? `${probe.dimension} dims` : "works";
    }
    return probe.code || "failed";
  }

  if (provider.needsKey) {
    return "needs a key";
  }

  if (provider.keyStored) {
    return "key saved";
  }

  return provider.local ? "local" : "not tested";
}

function renderEmbedderDetail(payload) {
  const provider = payload.providers.find((item) => item.id === state.embedderSelection);

  if (!provider) {
    $("embedder-title").textContent = "—";
    $("embedder-blurb").textContent = "";
    $("embedder-notes").textContent = "";
    $("embedder-fields").textContent = "";
    $("embedder-badge").hidden = true;
    return;
  }

  $("embedder-title").textContent = provider.label;
  $("embedder-blurb").textContent = provider.blurb;
  $("embedder-notes").textContent = provider.notes || "";

  const badge = $("embedder-badge");
  badge.hidden = false;
  badge.textContent = providerBadge(provider);
  badge.dataset.state = providerStatus(provider);

  const current = payload.current?.provider === provider.id;
  $("embedder-current").textContent = current
    ? `Guardian is using this one now.`
    : `Guardian is using ${providerName(payload.current?.provider)} now.`;

  renderEmbedderFields(provider, payload);

  const use = $("btn-embedder-use");
  use.disabled = state.embedderBusy || current;
  use.textContent = current ? "Already in use" : "Use this one";
}

function providerName(id) {
  const provider = (state.embedder?.providers || []).find((item) => item.id === id);
  return provider ? provider.label : "nothing yet";
}

// The fields a provider needs, and nothing more. A provider that needs no
// key gets no key box; a provider that talks to an address gets an address
// box. The panel should not look the same for all of them.
function renderEmbedderFields(provider, payload) {
  const container = $("embedder-fields");
  container.textContent = "";

  const current = payload.current?.provider === provider.id ? payload.current : null;
  const fields = provider.fields || [];
  const draft = embedderDraft(provider.id);

  if (!fields.length) {
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = "This one needs nothing from you.";
    container.appendChild(note);
    return;
  }

  for (const field of fields) {
    const label = document.createElement("label");
    label.className = "field";

    const caption = document.createElement("span");
    caption.textContent = fieldCaption(field);

    const input = document.createElement("input");
    input.type = field === "apiKey" ? "password" : field === "baseUrl" ? "url" : "text";
    input.id = `embedder-${field}`;
    input.dataset.field = field;
    input.autocomplete = "off";
    input.spellcheck = false;

    if (field === "apiKey") {
      input.placeholder = provider.keyStored ? "key saved — type to replace" : "paste the key";
      input.value = draft.apiKey || "";
    } else if (field === "baseUrl") {
      input.placeholder = provider.id === "codexify" ? "http://127.0.0.1:8888" : "https://…";
      input.value = draft.baseUrl !== undefined ? draft.baseUrl : current?.baseUrl || "";
    } else {
      input.placeholder = provider.defaultModel || "model name";
      input.value =
        draft.model !== undefined ? draft.model : current?.model || provider.defaultModel || "";
    }

    // Seed the draft with what is on screen, so the draft and the field
    // never disagree. A field showing an address the request does not send
    // is a field that lies.
    if (draft[field] === undefined) {
      draft[field] = input.value;
    }

    input.addEventListener("input", () => {
      draft[input.dataset.field] = input.value;
    });

    label.appendChild(caption);
    label.appendChild(input);
    container.appendChild(label);
  }
}

function embedderDraft(providerId) {
  if (!state.embedderDraft[providerId]) {
    state.embedderDraft[providerId] = {};
  }

  return state.embedderDraft[providerId];
}

function fieldCaption(field) {
  if (field === "apiKey") return "API key";
  if (field === "baseUrl") return "Address";
  if (field === "model") return "Model";
  return field;
}

// What the panel sends. The key is only sent when the user typed one, so
// an empty box never wipes a key that is already saved. The address and the
// model are sent whenever they are set, because for those the panel IS the
// place the answer lives.
function embedderPayload() {
  const payload = { provider: state.embedderSelection };
  const draft = embedderDraft(state.embedderSelection);

  if (draft.apiKey && draft.apiKey.trim()) {
    payload.apiKey = draft.apiKey.trim();
  }

  if (draft.baseUrl && draft.baseUrl.trim()) {
    payload.baseUrl = draft.baseUrl.trim();
  }

  if (draft.model && draft.model.trim()) {
    payload.model = draft.model.trim();
  }

  return payload;
}

async function testEmbedder() {
  if (!state.embedderSelection || state.embedderBusy) return;

  state.embedderBusy = true;
  renderEmbedder();
  showEmbedderResult("Testing…", "run");

  try {
    const response = await fetch("/api/memory/embedder/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(embedderPayload())
    });

    const payload = await response.json().catch(() => ({}));
    const probe = payload.probe || payload;

    state.embedderProbes[state.embedderSelection] = probe;

    if (probe.ok) {
      const ms = probe.latencyMs ? ` in ${probe.latencyMs}ms` : "";
      showEmbedderResult(
        `It works. ${probe.provider} answered with ${probe.dimension} dimensions${ms}.`,
        "ok"
      );
    } else {
      showEmbedderResult(
        [probe.error || "It did not work.", probe.remedy].filter(Boolean).join(" "),
        "bad"
      );
    }
  } catch (error) {
    showEmbedderResult(`The agent is not reachable: ${error.message}`, "bad");
  } finally {
    state.embedderBusy = false;
    lastEmbedderKey = "";
    renderEmbedder();
  }
}

async function useEmbedder() {
  if (!state.embedderSelection || state.embedderBusy) return;

  state.embedderBusy = true;
  renderEmbedder();
  showEmbedderResult("Testing and switching…", "run");

  try {
    const response = await fetch("/api/memory/embedder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(embedderPayload())
    });

    const payload = await response.json().catch(() => ({}));
    const probe = payload.probe || {};

    if (payload.ok) {
      state.embedderProbes[payload.provider || state.embedderSelection] = probe;
      showEmbedderResult(
        `Guardian is using ${providerName(payload.provider)} now. ${probe.dimension ? `${probe.dimension} dimensions.` : ""}`,
        "ok"
      );
      await loadEmbedder();
    } else {
      const detail = payload.probe || payload;
      state.embedderProbes[state.embedderSelection] = detail;
      showEmbedderResult(
        [
          detail.error || payload.error || "It did not work.",
          detail.remedy || payload.remedy
        ]
          .filter(Boolean)
          .join(" "),
        "bad"
      );
    }
  } catch (error) {
    showEmbedderResult(`The agent is not reachable: ${error.message}`, "bad");
  } finally {
    state.embedderBusy = false;
    lastEmbedderKey = "";
    renderEmbedder();
  }
}

function showEmbedderResult(message, kind) {
  const element = $("embedder-result");
  element.hidden = false;
  element.textContent = message;
  element.dataset.state = kind;
}

// ------------------------------------------------------------------ actions

function wireButtons() {
  $("btn-say").addEventListener("click", () => post("/api/say", { text: $("say-text").value }));
  $("btn-player").addEventListener("click", () =>
    post("/api/player-say", { text: $("player-text").value })
  );
  $("btn-verify").addEventListener("click", () => post("/api/verify", {}));

  $("btn-embedder-test").addEventListener("click", () => testEmbedder());
  $("btn-embedder-use").addEventListener("click", () => useEmbedder());

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
  // 24-hour. A "PM" in the log column pushes the message into a second line
  // and the log is the one place that must stay scannable.
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

start();
