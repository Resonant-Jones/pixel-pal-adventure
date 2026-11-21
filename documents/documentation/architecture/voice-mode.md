# Voice Mode — architecture and the companion app contract

**Written:** 2026-11-20
**Status:** agent side built and verified live. Transport and the family-side
install are the remaining work.

---

## 1. The constraint that shapes everything

Your son plays **Bedrock on an iPad**. Guardian is a **Java** bot on a Paper
server that Geyser fronts for Bedrock clients.

**Bedrock clients cannot use Java voice mods.** This is not a configuration
problem, it is structural:

- Simple Voice Chat is a client-side mod (Fabric/NeoForge/Forge/Quilt). Bedrock
  cannot load Java mods.
- Geyser emulates a *vanilla* Java client, so a Bedrock player arrives at the
  server as a Java player without the mod: allowed in, but no voice. They hear
  nobody and nobody hears them.
- Simple Voice Chat's own FAQ states that voice inside Bedrock is impossible
  because of this.

So the obvious answer — install Simple Voice Chat on the Paper server — gets
your son a silent server. That is the trap.

### The route that works

**Bedrock Voice Chat (BVC).** From its own documentation:

- *"Does it work with Geyser? Yes. Install the Java mod. The mod detects
  Floodgate automatically."*
- *"The Java mod sends positions for all players in the same way."*
- *"Use external mode on a Geyser server."*
- The Paper plugin can run the BVC server **inside** your Minecraft server,
  which is the right call for an always-on family server on one machine.

That last point is the whole answer. BVC's Paper mod reports the position of
**every player on the server** — including the mineflayer bot that is Guardian.
The voice server therefore knows where Guardian is standing, and the son's iPad
places Guardian's voice at Guardian's actual position in the world.

**That is what "synchronized in the game" means, and it comes for free from the
mod rather than from anything I have to build.**

### The good news about your son playing Java

The son plays Java on the desktop as well as Bedrock on the iPad, and that
materially simplifies the transport.

**BVC bridges to Simple Voice Chat.** From the BVC wiki: *"Bedrock Voice Chat
connects to Simple Voice Chat (SVC). Java players on Simple Voice Chat and
players on the BVC app can then hear each other in the same world."* And with
an embedded server, *"BVC configures the bridge automatically."*

So one server-side setup serves **both** of his clients:

| Where he plays | What he installs | What he needs |
|---|---|---|
| **Java desktop** | the Simple Voice Chat client mod | Fabric/NeoForge/Forge/Quilt — a modded client profile |
| **Bedrock iPad** | the BVC app | TestFlight, one pairing step |
| **This Mac** (Guardian's voice) | the BVC macOS client | already staged and hash-verified |

And the server side is just two Paper plugins: BVC, plus Simple Voice Chat,
with BVC in embedded mode so the bridge wires itself up.

The desktop route is probably the easier of the two for him — a mod install on
a client he already runs, rather than TestFlight on a tablet. It is also the
route where proximity voice works most naturally, because SVC is a Java-native
proximity system and the BVC bridge maps positions across.

`VoiceCraft` remains the fallback: wider platform support, a Paper bridge of
its own, and it works with Geyser. It is the option to reach for if SVC turns
out to be awkward to install on his desktop client.

### What this means operationally

Voice always has **a companion piece of software running next to the game**.
That is not a workaround; it is the shape of every working Bedrock voice
product. BVC needs these parts, all mandatory:

| Part | Where | Who installs it | Verified |
|---|---|---|---|
| BVC Paper plugin | `minecraft-server/plugins/` | me — one jar, hash-verified | **staged**, sha256 `c372018c…` |
| BVC voice server | inside the Paper JVM (embedded mode) | me — no separate service | paper config |
| A valid TLS certificate | DNS for a domain | **you** — see below | — |
| BVC client app | the son's iPad | **you** — TestFlight | iOS build is TestFlight-only |
| BVC client app | this Mac, as Guardian's voice body | me / you | **staged**, sha256 `1761255d…` |

Both artifacts are already downloaded and hash-verified in
`.local/voice/plugins/`:

```
bvc-paper-plugin-1.0.0-beta.15.jar    50,752,616 bytes
bvc-client-macos-arm64.app.zip        20,777,067 bytes
```

**The plugin version is not a detail — it is a hard constraint.**
Paper here is **1.21.11**, because mineflayer tops out there (HANDOFF §2.6f).
BVC's plugin declares an `api-version`, and Paper refuses any plugin newer than
itself. Reading the `plugin.yml` out of each release:

| Release | api-version | Loads on Paper 1.21.11? |
|---|---|---|
| beta.10, beta.13, **beta.15** | `1.21` | **yes** |
| beta.16 → beta.27 | `26.2` | no — rejected at load |

So **beta.15** is the newest usable build, and beta.27 (the current release)
would be refused by the server. Upgrading Paper to satisfy the plugin is not an
option: that breaks mineflayer, and therefore Guardian.

### The TLS requirement — the real cost of this route

> *"Bedrock Voice Chat requires a valid TLS certificate. The client apps check
> it the same way a browser does. **Self-signed certificates will not work.** The
> app refuses the connection, and you cannot turn this check off."*

That is the part worth knowing before committing to this route. Three options,
one only:

1. **An assigned hostname** — BVC gives you a name and renews its own
   certificate. No domain to buy. Availability is limited to some Patreon and
   YouTube members, and it is documented as a development feature.
2. **ACME DNS-01** — you need a domain and a supported DNS provider. Cloudflare
   (scoped API token, DNS-edit permission on that one zone — *not* the global
   API key) or acme-dns. **DNS-01 does not need port 80 open**, so the server
   can stay behind NAT.
3. **Your own PEM files** — `fullchain.pem` plus the key. Use the full chain: a
   certificate without the intermediate works on a machine that already cached
   it and fails on a new phone.

Also required:

- `enforce-secure-profile=false` in `server.properties` if you want in-game chat
  to sync through the BVC app.
- The plugin keeps its certificate authority in `plugins/BedrockVoiceChat/`.
  **Back that directory up** — deleting it invalidates every client certificate
  the server has issued.

### The macOS client is a direct download

The website lists macOS as TestFlight-only, but the GitHub release carries
`bvc-client-macos-arm64.app.zip` — a signed `.app` bundle, already staged and
hash-verified. **No TestFlight needed on this Mac.** The iOS build has no
release asset, so the son's iPad is the one app that must come from TestFlight.

---

## 2. Architecture

```
  son's iPad (Bedrock)                     this Mac
  ┌──────────────────────┐                ┌────────────────────────────────────┐
  │ Minecraft Bedrock    │                │  Paper 1.21.11                     │
  │ + BVC client app     │                │   ├─ Guardian (mineflayer) : body   │
  │                      │                │   ├─ Geyser + Floodgate             │
  │  hears Guardian's    │◀── UDP voice ─▶│   ├─ BVC Paper plugin ──┐           │
  │  voice, positioned   │                │   └─ BVC voice server ◀─┘           │
  │  at Guardian's spot  │                │                                    │
  │                      │                │  agent/agentRuntime                 │
  │  speaks ─────────────┼── UDP voice ──▶│   ├─ turns, memory, trust tier      │
  │                      │                │   ├─ voice/voiceService  ← TTS/ASR  │
  └──────────────────────┘                │   └─ control plane :8787            │
                                          │        ├─ WS /voice  ─┐            │
                                          │        └─ /voice/*    │            │
                                          │                     ▼            │
                                          │        companion app (yours)       │
                                          └────────────────────────────────────┘
```

The companion app on this Mac is the piece that makes two-way voice work:

- **Outbound**: Guardian speaks → `voiceService` synthesises → the app plays
  the mp3 into a virtual microphone → BVC sends it → the son's iPad hears it.
- **Inbound**: the son speaks → BVC delivers it to the app → the app captures
  it → `POST /voice/transcribe` → MiniMax speech-to-text → the transcript is
  fed to the agent as ordinary chat, under the ordinary trust tier.

Voice is a different **sensor**, not a different **privilege**. A voice message
from an unapproved player gets exactly the bounded tier a typed one gets.

---

## 3. What is built and verified (2026-11-20)

| Piece | State | Evidence |
|---|---|---|
| MiniMax text-to-speech | **working** | `speech-2.8-turbo`, voice `English_FriendlyPerson`. Live: 3.3s–10.5s of audio per line, 32 kHz mono mp3, valid per `ffprobe`. |
| MiniMax speech-to-text | **working** | `asr-1.0`. Live round trip: synthesised speech transcribed back correctly. Note the docs say STT is **paid accounts only** — this key works. |
| Voice hub | **working** | `voice/voiceService.js` — synthesise, transcribe, publish as events, stage audio, keep a history. |
| Hook onto speech | **working** | `botAdapter.say()` is wrapped, so chat replies, reflex messages, build feedback and the greeting are all spoken. Nothing can be forgotten in a new code path. |
| Control plane surface | **working** | `WS /voice`, `POST /voice/transcribe`, `POST /voice/say`, `GET /voice/spoken`, `GET /voice/audio/:id`, `GET /voice/presence`. All verified against the live stack. |
| **Companion app** | **working** | `companion/` — plays Guardian's voice out and carries the player's voice in, with a console at `http://127.0.0.1:8788`. Runs outside the agent sandbox; the sandbox cannot open CoreAudio. See §4. |
| **Two-way voice, end to end** | **working** | The voice check (§4) passes **10/10** against the live stack: Guardian's synthesised audio is transcribed back word for word by the real speech provider, a simulated player's phrase is transcribed and answered, and the reply lands in the world chat as the same line. |
| Failure behaviour | **working** | A provider failure degrades to "no audio"; it never takes the game down. The line was already said in chat by then. |
| Regression cover | **working** | `tests/voice.test.js`, 7 assertions groups, no provider calls. `npm test` is 35/35. |

### Two things that did not work, and what they taught

**Ollama is broken on this macOS build.** It is installed and crashes with a
native ggml backtrace on both `serve` and `pull`. Local embeddings via Ollama
are not available here.

**MiniMax `/v1/embeddings` exists but is not usable on this account.** The
endpoint answers HTTP 200 with `base_resp.status_code 1002 "rate limit
exceeded(RPM)"` on every attempt, including after a 70-second cooldown. Their
published rate-limits table has **no embeddings row at all** — only LLM, Video,
Image, Speech and Music — so the endpoint is not a published product on
`api.minimax.io`. Hence the semantic-memory work does not depend on it: full-text
search and graph traversal are native to SurrealDB and need no provider.

---

## 4. The companion app — built

**Status: built and verified live (2026-11-20).**

Ground rule 4 said the frontend is the owner's work. That still holds for the
dashboard. But the companion app is not a dashboard: it is the piece of
software that carries Guardian's voice, and without it there is no voice at
all — only synthesis and transcription.

### Where it lives

```
companion/
  companionApp.js     the orchestrator: control-plane client, audio, HTTP, UI
  companionConfig.js  configuration, read from .env
  audioEngine.js      ffmpeg-backed device I/O, WAV, voice activity detection
  ui/                 the console (index.html, app.js, styles.css)
agent/voicePresence.js  who is in the world, and where
scripts/runCompanion.sh  the launcher — runs OUTSIDE the agent sandbox
scripts/startCompanion.js
```

### Why it is a separate process

Two reasons, and neither is tidiness:

1. **CoreAudio is unreachable from the agent's sandbox.** Inside it,
   AVFoundation cannot even enumerate the devices — ffmpeg fails with
   `Error opening input: Input/output error`. An app started from there
   would look like it was listening while capturing nothing, and would look
   like it was speaking while playing silence. That is worse than not
   running.
2. **The app has to survive the agent restarting.** The contract between
   them is one WebSocket and a handful of HTTP calls, so either side can
   die and come back.

### The audio path, and a landmine in it

`ffmpeg`'s **avfoundation** device is an *input* device only — there is no
avfoundation muxer. Writing to one fails with:

```
Requested output format 'avfoundation' is not known.
Error initializing the muxer for :0: Invalid argument
```

macOS playback goes through **`audiotoolbox`**, which is output-only and
cannot list its devices either. So:

| Direction | ffmpeg device | Notes |
|---|---|---|
| capture (player speaks) | `avfoundation` | can list devices |
| playback (Guardian speaks) | `audiotoolbox` | cannot list devices; name it or use an index |

The two lists are different CoreAudio lists with different numbering. An
index past the end of the audiotoolbox list falls back to the default output
device rather than failing, so a probe proves "a device opens", not "this is
the device you asked for".

### Which microphone, and which speakers

**Devices are chosen by name, never by index.**

Audio device lists are not stable. They reorder whenever something connects or
disconnects — an iPhone waking up nearby, AirPods pairing, a USB microphone
being unplugged, a virtual node appearing. A device pinned by index therefore
silently becomes a *different* device without anything failing.

That was not theoretical. The link was configured with `COMPANION_AUDIO_INPUT=0`
and spent its life listening to **"ScoutNode Microphone"**, a virtual device
belonging to something else on the machine, while the configuration said
"index 0" and the operator believed it was on the laptop's own microphone.
The device list reordered during the same session, which is how it was
noticed.

Both ffmpeg sides accept a device name:

```
capture:  ffmpeg -f avfoundation -i ":MacBook Air Microphone" ...
playback: ffmpeg -f s16le -i pipe:0 -f audiotoolbox "MacBook Air Speakers"
```

So:

```
COMPANION_AUDIO_INPUT="MacBook Air Microphone"
COMPANION_AUDIO_OUTPUT="MacBook Air Speakers"
```

**An iPhone or iPad is refused outright** (`COMPANION_AUDIO_BLOCKED`,
default `iphone,ipad`). It belongs to the son, and on macOS a Continuity
input can carry the machine's own audio back in — which is a loop, not a
microphone. The refusal is logged, not silent.

The app also **watches the device list** (`COMPANION_AUDIO_POLL_MS`, default
5s) and re-resolves by name. If the configured device disappears, capture
stops and says so; it does not fall back to whatever took its place.

`node scripts/startCompanion.js --check` prints the devices and the
resolution:

```
voice in:      MacBook Air Microphone (index 0)
voice out:     MacBook Air Speakers
blocked:       iphone, ipad
```

### The duck guard

A same-machine acoustic loop — Guardian's voice out of the speakers, the
microphone listening — makes Guardian hear itself and start talking to
itself. The app drops inbound audio while Guardian is speaking. On the real
transport the two legs are separate devices and the guard does nothing; on
the local test path it is the difference between a conversation and a
stutter.

### What it does

- **Outbound.** The agent's voice WebSocket says Guardian spoke. The app
  fetches the mp3, decodes it to PCM, and plays it into the configured
  output device — which is the transport (a virtual device the voice client
  reads), or the speakers on the local test path.
- **Inbound.** The player's voice arrives from a capture device, is
  segmented by energy, wrapped in a WAV, and posted for transcription. The
  agent then handles it exactly as if it had been typed — voice is a
  different sensor, not a different privilege.
- **Presence.** It polls `/voice/presence` so the voice it places is placed
  where Guardian actually is.

### The console

`http://127.0.0.1:8788` — the link's health, the audio route, where everyone
is, the conversation in both directions with an audition button per line,
and a **voice check** that runs the whole path and reports a verdict per
stage.

The visual language is the project's own: warm paper, deep green, ink. It is
a starting point for the owner's design system, not a decision.

### The voice check

`POST /api/verify` (or the button) runs ten stages against the live stack.
Nothing is mocked — a mocked voice test proves nothing about voice.

```
  ok   | agent reachable                | control plane is ready
  ok   | voice channel connected        | websocket is open
  ok   | voice enabled on the agent     | the agent will speak
  ok   | guardian speaks                | line "Voice link check…"
  ok   | audio retrieved                | 66228 bytes of mp3
  ok   | audio carries guardian's words | heard "Voice link check. If you can hear this, the link is open."
  ok   | player speech reaches the agent | heard "Guardian, what are you building today?"
  ok   | guardian answers out loud      | answered "Still the TNT pile, Panda — paused and 61 TNT sho…"
  ok   | voice placed at guardian's position | guardian at -23, 6, -36 in overworld
  ok   | player is in the same world    | Panda_Nuggetz · heard recently, out of view (approved)
```

The comparison is on **content words**, not on strings. A recogniser returns
"what are you building today", not the exact characters that were spoken,
and a test that demands an exact match fails for the wrong reason.

### Two additions to the agent side

- `GET /voice/presence` → `runtime.getVoicePresence()`: where Guardian and
  each player are. **"Who is online" and "where are they" are different
  questions.** The server's tab list answers the first and the loaded entity
  answers the second, and an entity only exists when the player is close
  enough to be seen. A player who is out of view has a *null* distance, not
  a made-up one.
- `POST /voice/transcribe?feed=0` → transcribes **without** handing the line
  to the agent. Without it, the only way to check that the audio about to go
  on the wire carries the right words is to make Guardian answer its own
  voice.

### Two bugs the live run found

- **A provider rate limit killed the app.** MiniMax's ASR returned HTTP 429
  (`conn limit`); the floating promise waiting on it rejected; Node's
  default for an unhandled rejection is to throw. The app died
  mid-conversation. Now every awaited path handles its own failures, the
  transcription retries with backoff, and `scripts/startCompanion.js`
  installs `unhandledRejection` and `uncaughtException` handlers so the app
  loses a log line instead of the process.
- **The simulated-player path shared a voice detector with the live
  microphone.** The room noise and the test phrase interleaved inside one
  state machine, and the test phrase was never recognised. Two detectors,
  two streams.

### Running it

```bash
./scripts/runCompanion.sh                 # foreground
./scripts/runCompanion.sh --check         # report the audio route and exit

# as a background service that survives the agent session:
launchctl submit -l com.guardian.companion -- /bin/bash "$PWD/scripts/runCompanion.sh"
launchctl remove com.guardian.companion          # stop it again
```

Devices are configured in `.env` and are avfoundation indices:

```
COMPANION_AUDIO_INPUT=0
COMPANION_AUDIO_OUTPUT=0
```

When Bedrock Voice Chat is wired up, the **output becomes the virtual
device** (BlackHole) instead, so Guardian's voice enters the voice client's
input rather than coming out of the speakers.

---

## 5. What is left, and who does it

| # | Step | Owner | Notes |
|---|---|---|---|
| 1 | Install the BVC Paper plugin | me | `bvc-paper-plugin-1.0.0-beta.15.jar` is **staged and hash-verified**. Needs a Paper restart — `scripts/restartPaper.sh`, which is yours to run because the agent cannot signal Paper. |
| 2 | Install the Simple Voice Chat Paper plugin | me | This is what lets your son hear Guardian **from his Java desktop client** as well as the iPad. The BVC↔SVC bridge is automatic in embedded mode. |
| 3 | Write `plugins/BedrockVoiceChat/config.yml` | me | Embedded mode: `use-embedded-server: true` plus the `embedded-config` block. No separate server, no Docker, no extra port. |
| 4 | **Get a domain and a valid certificate** | **you** | The one genuinely hard requirement. Assigned hostname (no domain, Patreon/YouTube-gated) or a domain with Cloudflare DNS-01. Self-signed is refused outright. |
| 5 | Install BlackHole | me | `brew install blackhole-2ch`, then wire the device in Audio MIDI Setup. **This needs an admin password — it is the step the agent sandbox cannot take.** |
| 6 | Point the companion app at BlackHole | me | One line in `.env`: `COMPANION_AUDIO_OUTPUT=BlackHole 2ch`, then restart the app. |
| 7 | Install the voice client on his clients | **you** | Java desktop: the Simple Voice Chat mod. iPad: the BVC app from TestFlight. |
| 8 | **Which iPad is his?** | **you** | Two are connected: "Chris's iPad (3)" (iPad mini A17 Pro) and "Krista's iPad (2)" (iPad Pro 12.9). The BVC app has to go on the right one. |
| 9 | The first spoken conversation | both of you | The acceptance test. **The two-way loop is now proven end to end** (§4, the voice check, 10/10). What has not happened is the son hearing it, because the transport needs steps 1–5 and 7. |

Steps 4, 7 and 8 need you. Everything else is mine.

### The plan if TLS is the blocker

If a domain and certificate turn out to be a line under the bus, there is a
fallback that needs neither: **the companion app carries Guardian's voice over
the LAN to the son's iPad directly**, without BVC at all.

The agent side is already built and does not care how the audio travels. The
companion app would play Guardian's mp3 into a virtual mic and the iPad would
receive it through whatever local mechanism you choose. The cost is that it is
*not* Bedrock-native voice: no proximity, no in-client mute, and the iPad
usually cannot hear another device's microphone directly, so this route needs
its own transport and is less likely to feel native to a kid.

That is why BVC is the recommended route despite the certificate: it is the one
that behaves like a real game feature rather than a side channel.

---

## 6. Honest limits

- **The son has never heard Guardian's voice.** The two-way loop is proven
  end to end against the real speech provider and the real world (§4, 10/10
  stages), and the audio that would go on the wire is verified word for word.
  What is missing is the last hop — the transport, which needs a certificate,
  two plugin installs and a client on his iPad. Everything before that hop is
  built and checked.
- **The voice was not heard *in* Minecraft by a player.** The in-game half is
  proven — Guardian's spoken line is the same line that appears in the world
  chat, at the same moment, and a player in the world was answered by voice.
  What was not run is the real Minecraft client with a voice client on it.
- **There is no virtual audio device on this machine.** BlackHole is not
  installed, so the local route plays to the built-in speakers and captures
  from the built-in microphone. The duck guard keeps that from becoming a
  feedback loop, but the *real* transport needs the virtual device, and
  installing it needs an admin password.
- **The Bedrock iPad client is still unproven.** Geyser authentication has
  never been confirmed at runtime. Until an iPad actually joins the server,
  the whole crossplay chain — and therefore the whole voice chain over BVC —
  is a theory with good documentation behind it.
- **Every TTS call costs money** and there is a 60 RPM ceiling. In-game chat
  is nowhere near that. If Guardian starts talking far more often than once a
  sentence per exchange, that ceiling becomes visible. The ASR has a tighter
  limit still, and it has already returned `conn limit` once during a test.
