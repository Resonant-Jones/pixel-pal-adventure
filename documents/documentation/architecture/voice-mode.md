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
| Control plane surface | **working** | `WS /voice`, `POST /voice/transcribe`, `POST /voice/say`, `GET /voice/spoken`, `GET /voice/audio/:id`. All five verified against the live stack. |
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

## 4. The companion app — specification, not a build

Ground rule 4: the frontend is your work. This is the contract it must meet.

### Transport

WebSocket to `ws://127.0.0.1:8787/voice?token=<GUARDIAN_CONTROL_TOKEN>`.

The token is a stable UUID in `.env` (`GUARDIAN_CONTROL_TOKEN`). It was
previously random per start, which would have meant reconfiguring the app every
time Guardian restarted; it is now stable.

### Messages the agent sends you

```jsonc
// on connect — catch-up, so a reconnect does not lose the last few lines
{ "type": "voice_ready", "enabled": true, "spoken": [ /* recent lines */ ] }

// whenever Guardian says something
{
  "type": "speak",
  "id": "voice-1795212745434-7ok3cg",
  "text": "Still in the cave, still losing arguments with skeletons.",
  "reason": "say",          // why the line was said
  "durationMs": 8748,
  "format": "mp3",
  "audioUrl": "/voice/audio/voice-1795212745434-7ok3cg"
}
```

`audioUrl` is relative — fetch it from the same host with the same bearer
token.

### Messages you send the agent

None required. The app posts captured audio; the agent does not need to be
told what the player said.

### HTTP endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/voice/spoken` | Recent spoken lines, with ids and durations. Also what a parent reads. |
| `GET` | `/voice/audio/:id` | The staged mp3. `audio/mpeg`, `audio/wav` or `audio/flac`. |
| `POST` | `/voice/say` | Body `{ "text": "...", "reason": "..." }`. Makes Guardian speak on demand. |
| `POST` | `/voice/transcribe` | Raw audio body, `?speaker=Panda_Nuggetz&filename=capture.wav`. Transcribes, feeds the agent as chat, returns `{ transcript, speaker, message }`. |

`/voice/transcribe` accepts a raw container (wav/mp3/flac/ogg/aac/m4a) — raw
PCM with no container is rejected by the provider. Max body 12 MB.

### Behaviour the app must implement

1. **Play into a virtual microphone, not the speakers.** The son's iPad needs
   to hear Guardian. On macOS that means a virtual audio device — BlackHole
   (`brew install blackhole-2ch`) is the standard — with the app's output
   routed to it and the BVC client's input set to it. Without this, Guardian's
   voice comes out of the Mac's speakers and the iPad hears silence.
2. **Capture the player's voice** from the BVC client's output, again through
   the virtual device, and POST it to `/voice/transcribe`.
3. **Do not play Guardian's voice out loud on the Mac** — it would double up
   with the voice the son hears.
4. **Never block the game on voice.** If the app or the voice server is down,
   the son still has chat, and nothing about the failure should be visible to
   him.

---

## 5. What is left, and who does it

| # | Step | Owner | Notes |
|---|---|---|---|
| 1 | Install the BVC Paper plugin | me | `bvc-paper-plugin-1.0.0-beta.15.jar` is **staged and hash-verified**. Needs a Paper restart — `scripts/restartPaper.sh`, which is yours to run because the agent cannot signal Paper. |
| 2 | Install the Simple Voice Chat Paper plugin | me | This is what lets your son hear Guardian **from his Java desktop client** as well as the iPad. The BVC↔SVC bridge is automatic in embedded mode. |
| 3 | Write `plugins/BedrockVoiceChat/config.yml` | me | Embedded mode: `use-embedded-server: true` plus the `embedded-config` block. No separate server, no Docker, no extra port. |
| 4 | **Get a domain and a valid certificate** | **you** | The one genuinely hard requirement. Assigned hostname (no domain, Patreon/YouTube-gated) or a domain with Cloudflare DNS-01. Self-signed is refused outright. |
| 5 | Install BlackHole | me | `brew install blackhole-2ch`, then wire the device in Audio MIDI Setup. |
| 6 | Build the companion app | **you** | The contract is §4. It is a small local app: one WebSocket, one HTTP POST, and audio routing. |
| 7 | Install the voice client on his clients | **you** | Java desktop: the Simple Voice Chat mod. iPad: the BVC app from TestFlight. |
| 8 | The first spoken conversation | both of you | The acceptance test. It has not happened yet, and nothing above proves it will. |

Steps 4, 6 and 7 need you. Everything else is mine.

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

- **Voice has never been heard by the son.** Every claim above is about
  synthesis, transport plumbing and the control plane. The first real
  conversation is unverified.
- **BVC's client app for macOS is TestFlight only**, not a direct download.
  That means an Apple ID on this Mac, and it means the companion app may have
  to be a thin wrapper around the BVC client rather than a standalone thing.
- **The Bedrock iPad client is still unproven.** Geyser authentication has
  never been confirmed at runtime. Until an iPad actually joins the server,
  the whole crossplay chain — and therefore the whole voice chain — is a
  theory with good documentation behind it.
- **Every TTS call costs money** and there is a 60 RPM ceiling. In-game chat
  is nowhere near that. If Guardian starts talking far more often than once a
  sentence per exchange, that ceiling becomes visible.
