# HANDOFF — minecraft-ai-companion

**Written:** 2026-10-09
**For:** another agent picking this up cold
**Author's note:** you have no prior context on this project. Section 2 is the
part that will save you the most time. Read it before touching anything.

---

## Campaign checkpoint — 2026-10-09

The active goal is **Guardian's First Real Adventure**: two observed 30-minute
Bedrock/iPad sessions, including one after a stack restart, with working chat,
follow/stop, saved-location recall, controlled survival, and the child's verbatim
feedback. The parent said the iPad sessions will happen later; prepare code and
the play checklist now. **The campaign is not complete.**

Current source baseline is `7e53c73` on `codex/Feedback-Middleware`. The campaign
changes are uncommitted. No production services were restarted during this work,
and no provider API request was made. Frontend components were left alone.

Preparation changes:

- Shared player-name resolution now covers adapter events, runtime chat/direct
  commands, first greeting, presence, and world snapshots. Exact online names
  take precedence if both bare and prefixed candidates exist.
- `stop following` cancels the dynamic path goal and releases movement controls
  immediately, then remains in effect through presence ticks and task completion.
- Survival can abort an ongoing fight/eating action for urgent danger, owns
  movement until the threat clears (including cooldowns), and releases controls
  afterward. Dangerous
  flee-only mobs take priority over a closer melee target. Interrupted builds
  pause with their checkpoint and `SURVIVAL_INTERRUPTED` diagnostics.
- Duplicate login is classified even during a reconnect attempt. Back-to-back
  loss events share one guarded retry; stale socket events cannot discard the
  replacement. Halts preserve their visible status. Ordinary recovery restarts
  the background loops and stops at configured attempt limits. Paper's translated
  `multiplayer.disconnect.duplicate_login` reason is recognized; English-only
  classification missed this actual 1.21.11 packet during an isolated rehearsal.
- Default observation and model context are player/world/thread scoped. Saved
  locations check ownership and refuse cross-dimension recall. Unowned legacy
  anchors/summaries remain stored but are excluded from automatic recall.
- The restart job query uses double-quoted SurrealQL values. The crossplay
  verifier reports local prerequisites and runtime authentication uncertainty,
  rather than treating an append-only log's mtime as boot time.

See `documents/documentation/operator/operator-guide.md` for the two-session
checklist, parent-only recovery/duplicate test, evidence format, and model data
boundary. Keep all remaining live gates explicit.

---

## 1. What this is

An AI Minecraft companion for a 10-year-old. The goal is a "shadow" that plays
alongside him — remembers conversations and significant places across worlds,
builds with him, has dry wit, and eventually supports turn-based voice.

**The player plays Bedrock on an iPad.** That single constraint has driven
almost every architectural decision, because mineflayer is Java-only. Geyser +
Floodgate translate Bedrock↔Java on the local Paper server, so the kid's client
never changes and the bot stays mineflayer-native.

The child is a **co-designer, not a passenger**. Involve him in decisions and
ask for his feedback *while he is playing* — post-hoc design conversations are
much worse than a kid saying "why did it do that?" in the moment.

### Repo

| | |
|---|---|
| Project root | `/Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion` |
| Git remote | `git@github.com:Resonant-Jones/pixel-pal-adventure.git` |
| Branch | `codex/Feedback-Middleware` |
| HEAD at handoff | `0705ab0` |

The **outer** directory `MineCraft_Companion/` is **not** a git repo. Only the
inner `minecraft-ai-companion/` is. The `package.json` at the outer level is a
local convenience wrapper and is untracked — it will not survive a fresh clone.

### Ignored on purpose

`memory-bank/` and `.github/*.chatmode.md` are **VS Code Copilot artifacts**.
Do not read, maintain, or "clean up" them. They are noise for this project.

Also gitignored: `.env`, `minecraft-server/`, `.local/`, `.npm-cache/`,
`node_modules/`.

---

## 2. Landmines — read before you debug anything

These are hard-won. Each one cost hours. Skipping ahead to "optimizing" or
"cleaning up" in these areas will reintroduce a bug that is invisible when it
happens.

### 2.1 SurrealDB 3.x record IDs have angle brackets

`surreal` 3.x returns record IDs like `⟨abc123⟩`. This code stores them as
strings. Therefore **every UPDATE targeted by an id must wrap it**:

```js
await db.query(`UPDATE type::record($jobId) SET ...`, { jobId })
```

**Also: never write single-quoted SurrealQL strings.** Use double quotes.

> Symptom when broken: `UPDATE $jobId` hard-throws on every call. This looks
> exactly like "the database is empty" or "protocol drift". Neither.

### 2.2 Query results nest differently than you expect

SurrealDB returns `[[rows]]` from `db.query()` with multiple statements and
`[rows]` with one. `getStatementRows()` in `memory/surrealClient.js` flattens
**both**. Do not "simplify" it to handle only one shape.

### 2.3 `getNextBuildJob` — check the destructuring

In `memory/jobStore.js` this function destructures its **outer array**. This
was the actual reason five queued builds were never picked up. Before blaming
the network, the protocol, or the database, read this function carefully.

### 2.4 The three misdiagnoses (so you don't repeat them)

This database problem was misdiagnosed three times in a row before being found:
1. "The database is empty."
2. "Protocol break after the SurrealDB upgrade."
3. "I broke `RELATE` myself." *(I had. Reverted.)*

The real cause was §2.3. **When something is mysteriously empty or broken,
verify the query is returning rows before theorizing about why.**

### 2.5 `deepseek-flash` is a reasoning model

Reasoning tokens consume `max_tokens` and return **empty content**. The symptom
is a model that appears lobotomized. The fix is in `config/deepseek.js`:

```js
extraBody: { thinking: { type: "disabled" } }
```

Verified live: 12 tokens returned vs 136 consumed. If replies go empty again,
check this first.

### 2.6 Two agents must never share a username

Two Guardians on one account produce an infinite mutual-kick storm. **Observed
twice:** ~2,200 join/leave cycles in one run, and **25,186 duplicate-login
events** in a single 19-second burst on 2026-10-09.

Closing the laptop lid is enough to trigger it. Suspending the process leaves
the server holding the stale session; on wake both copies reconnect and start
kicking each other.

The first fix classified `duplicate_login` as fatal — and **it did not work**,
because it was only ever unit-tested on the classifier, never on the runtime
sequence. Two defects combined:

1. The `end` listener discarded the kick reason and substituted a generic
   `Error("Minecraft connection ended.")`, so the classifier could not see a
   duplicate login at all.
2. The halt path set `reconnectInFlight = false`, which **cleared the very
   in-flight guard the next call checks** — so the `end` that fires immediately
   after every kick sailed past the guard and reconnected. The halt undid itself
   one tick later.

Now fixed by a sticky `duplicateSessionHalted` latch plus reason propagation
through `end`. Guarded by `tests/duplicateLoginStorm.test.js`, which drives the
real `handleConnectionLoss` through the real kicked→halt→end sequence.

> **The lesson generalises:** a green test suite proved nothing here, because
> the test exercised the classifier while the bug lived in the wiring. When a
> fix is "already in," reproduce the failure end to end before assuming it was
> only ever the classifier.
>
> Keep both guards: `duplicateSessionHalted` in the runtime, and the
> `CONTROL_PORT` check in `startStack.js`.

### 2.6b The primary player name was simply wrong

`.env` had `PRIMARY_PLAYER=Panda_Nuggetz`. That is not an account on this
server. This world has **two** real players:

| Account | Who | Bedrock name Paper sees |
|---|---|---|
| **PandaNuggetz120** | Resonant Jones (the parent) | `.PandaNuggetz120` |
| **SageTheMage5388** | his son, aged 10 | `.SageTheMage5388` |

The original `Panda_Nuggetz` was nearly the parent's name — right stem, wrong
underscore, missing the `120` suffix. Whoever configured this earlier had partial
information too, and **every name-matched behaviour silently no-opped**.

`MC_RESPOND_TO_ALL=true` is now set, which affects **chat observation only** —
follow, anchors and `/tp` still key off `PRIMARY_PLAYER`. That is deliberate: on
a private two-player world, "anyone" means the two of them, and it lets Sage
talk to the companion without a config change.

When Sage actually plays, set `PRIMARY_PLAYER=SageTheMage5388` so the companion
follows and tags for him rather than the parent.

Bedrock gamertags routinely carry numeric suffixes, so matching also accepts a
configured stem against a real player **only when the remainder is digits** —
`SageTheMage` resolves `SageTheMage5388`, but never `SageTheMageEvil`.

**Never hardcode a guessed gamertag.** Read it from the join log first.

### 2.6c The agent kept no log at all

Everything went to the launching terminal and was lost with the scrollback.
Diagnosing "why did the bot die" was impossible because the evidence had never
been written down — three deaths in a single boot could not be explained.

Console output is now teed to `.local/logs/agent.log`: rotated at 8 MB, flushed
before exit, and a broken log file can never take the agent down. **Read this
file first for any behavioural question.**

### 2.6d The bot fought with no armour

`equipBestWeapon()` and `equipBestFood()` existed; nothing ever equipped armour.
Skeletons were the largest single cause of death (22 of 52) because they shoot
from well outside the 3.5-block melee range — the bot closed the distance eating
arrows. `equipBestArmor()` now runs before every engagement, per slot.

This only equips what is already in the inventory. There is **no crafting plan
and no supply chain**, so a bot that loses its armour does not replace it.

### 2.6e The agent used a `console.log` you cannot find afterwards

Corollary to 2.6c. If a change appears to do nothing, check whether its evidence
goes to a file at all before concluding it did not run.

### 2.6f ViaVersion is a HARD dependency, not an optional extra

Geyser emulates a **Java 26.2** client. Paper here is **1.21.11** (protocol 774),
because mineflayer tops out there. Those two facts together mean Geyser cannot
connect on its own — the server rejects the emulated client as too new.

Without ViaVersion the player sees, verbatim:

```
This server does not support Java Edition 26.2, which is required for Geyser to
connect. The server needs to update or have the ViaVersion plugin installed.
```

And the server log shows only:

```
Geyser-Spigot: Your server software does not support the Java version that
Geyser requires (26.2, 26.1.1, 26.1.2).
```

**Do not "fix" this by upgrading Paper.** That breaks mineflayer and therefore
the entire companion. ViaVersion 5.12.1 is the bridge: it lets a 26.2-protocol
client join a 1.21.11 server. It lists both versions in its manifest.

The failure is confusingly *late*: Floodgate authenticates the player
successfully first, logs `Player connected with username …`, and only then the
version check kicks them. So the log will show a successful Bedrock login
immediately before the disconnect. Do not read that as success.

### 2.7 Floodgate renames the player

Floodgate 2.x defaults `username-prefix` to `"."`. A player configured as
`Panda_Nuggetz` arrives at Paper as **`.Panda_Nuggetz`**.

This silently killed follow, facing, tag-location and `/tp`, because lookup was
an exact key match returning `null` with no error anywhere. Now resolved
tolerantly via `resolvePlayerEntity()` in `minecraft/bot.js`. **Keep both
directions** — it also has to work if the prefix is set to `""`.

### 2.8 `/tp` is resolved by the server, not by us

It needs the **resolved server-side name**. It does not accept the configured
name.

---

## 3. Current state

### Verified in campaign preparation

- **27/27 test files pass.** `npm test` auto-discovers `tests/*.test.js`.
- **`npm run check` passes** (TypeScript plus source syntax checks).
- `npm run verify:memory`: a synthetic location survives an actual isolated
  SurrealDB process restart; player/thread/world/dimension boundaries hold;
  a running build retains its checkpoint and is selected after restart.
  This uses a temporary database, not the family's stored data.
- `npm run verify:adventure`: production adapter/runtime methods connect to
  their own cached Paper 1.21.11 on a free loopback port in a fresh flat world.
  A synthetic Java player observes physical follow/stop and actual tag/recall
  teleportation. A controlled zombie fight is interrupted for a creeper;
  server-observed retreat exceeds eight blocks without a death. Threat removal
  releases controls. An ordinary kick reconnects, and Paper's actual translated
  duplicate-login packet halts the runtime without another login attempt during
  a bounded observation window. These are isolated Java-server results: memory
  and model responses are synthetic; no Geyser, iPad, family world, or provider
  request participates. The script preserves source hashes/results/console
  output under `.local/campaign-adventure-proof-*` and removes its own cached
  binaries/world only after its test server stops.
- Simulated raw mineflayer events exercise production adapter/runtime wiring:
  ordinary disconnect recovery, bounded exhaustion, duplicate kick followed by
  end, duplicate kick during retry, and stale socket events after recovery.
- Survival tests exercise real controller/adapter methods through the runtime's
  event handlers during an active fight, including a farther-away creeper and
  critical health. These regression tests supplement the isolated mob encounter;
  they do not prove behavior in the family's world.
- Fresh local crossplay check: **11 checks passed, 0 failed, 1 unverified**.
  Paper listens on TCP 25565; Geyser listens on UDP 19132; plugin startup lines
  and Floodgate key presence were checked. Disk auth-type is `floodgate`.

The prior handoff's DeepSeek content and family-DB round-trip evidence were not
rerun in this campaign preparation. Do not describe them as fresh verification.

Latest isolated adventure receipt: `.local/campaign-adventure-proof-WhLHCs/`
(`results.json`, `proof-context.json`, `console.log`), recorded at
2026-10-09 22:36 EDT / 2026-10-10 02:36 UTC. Stop drift was 0.33 blocks across
30 physics ticks, corroborated by the second client. The interrupted fight
retreated 8.53 server-observed blocks with health 20 and zero deaths. Recovery
used one attempt; duplicate halt kept Guardian at two total connection attempts
(initial plus recovery) during an 821 ms no-retry window. The scoped regression
tests also exercise repeated loss events after halt. Receipt source hashes
match the current uncommitted runtime code. Both fresh-world rehearsal runs
stopped their own servers and removed their generated worlds/caches.

### NOT verified — and this distinction matters

| Thing | Status |
|---|---|
| Son joining from the iPad | No live session observed; parent will arrange it later. |
| Two 30-minute play sessions | Neither completed or recorded. |
| Survival in the family's world | Regression and isolated flat-world encounter passed; iPad play remains unobserved. |
| Location tag/recall by a person | Isolated DB restart and actual synthetic Java-player teleport passed; child use remains unobserved. |
| Duplicate-login halt on the family server/lid-close | Simulated wiring and actual isolated Paper kick passed; family-server/lid-close proof pending. |
| Effective Geyser authentication | Disk configuration confirmed; runtime mode unproven until fresh startup/client login. |
| Child's design feedback | No answers captured yet. |

### Immediate next step

At the fresh check, Guardian's HTTP control plane on 8787 was not reachable;
Paper and Geyser remained running. The edited source is therefore not claimed
as running in the family's world. Start one Guardian from the updated checkout
for the next session. Use the parent's graceful restart script if Paper must
reload its configuration. Then prove the iPad login and the play checklist.

A log append changes `latest.log`'s mtime, so that timestamp cannot prove a
restart or active authentication configuration. `verifyCrossplay.sh` deliberately
keeps this unverified; exit 0 means local prerequisites passed, not iPad success.

---

## 4. Architecture

```
minecraft-ai-companion/
├── agent/        runtime orchestration (15 files) — the conductor
├── ai/           LLM clients (4) — GroqClient is reused for DeepSeek
├── builder/      build pipeline (9) — structureCompiler → buildWorker
├── memory/       SurrealDB stores (11)
├── minecraft/    mineflayer adapter (2)
├── reflex/       autonomous chatter (4)
├── survival/     deterministic combat (1)
├── control/      local HTTP control plane on 8787
├── config/       provider config (5)
└── scripts/      startAgent / startStack / startPaperServer
```

**Key architectural decision — survival contains no LLM.** `survivalController.js`
runs a deterministic priority ladder (critical → threat → hungry → idle). The
model narrates *afterwards*. It never participates in the reaction path. Do not
"improve" this by routing combat decisions through the model — latency would
make the bot die.

**Creepers, ghasts, blazes, witches and ravagers are always fled**, never meleed.

**Location tag/recall runs before the model** — zero LLM calls, refuses to guess
below a fuzzy-match threshold of 40.

### Runtime topology

```
iPad (Bedrock) ──UDP 19132──> Geyser+Floodgate ──┐
                                                 ├──> Paper 1.21.11 (25565)
Guardian (mineflayer bot) ─────TCP 25565─────────┘
                    │
                    ├──> SurrealDB 3.0.4 (127.0.0.1:8001)
                    └──> DeepSeek API (deepseek-flash)
```

---

## 5. Environment

```bash
cd /Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion

npm test        # 27 test files
npm run verify:memory # isolated real SurrealDB restart proof (synthetic data)
npm run verify:adventure # isolated Paper physics/runtime rehearsal (synthetic Java player)
npm run check   # typecheck + syntax

node scripts/startStack.js   # bring up Surreal + Paper + Guardian
./scripts/restartPaper.sh    # graceful Paper restart (SIGTERM, world-saving)
./scripts/verifyCrossplay.sh # read-only: can a Bedrock client reach us right now?
```

`restartPaper.sh --dry-run` prints what it would do and changes nothing.

### Ports — do not change these casually

| Port | What | Note |
|---|---|---|
| 25565 | Paper (Java) | |
| 19132 | Geyser (Bedrock UDP) | |
| 8001 | SurrealDB | **Not 8000.** Another local service (`Whoosh'd`) owns 8000. Never kill it to reclaim the port. |
| 8787 | Agent control plane | Presence = Guardian is running. |

LAN address is derived from the default route (currently `192.168.4.26`).
Tailscale is also up for off-LAN access.

### Sandbox constraints you will hit

These are environment restrictions, not bugs. Do not fight them:

- Writes succeed **only inside this project directory**. `/tmp` and other home
  paths fail with `Operation not permitted` (macOS TCC).
- `ps` and `pgrep` are blocked.
- **Paper cannot be signalled by the agent.** It is spawned detached with stdin
  ignored, and RCON is disabled, so there is no way to ask it to stop. This is
  why `restartPaper.sh` exists and must be run by the human.
- No DeepSeek/Pi subagent workers — a lockfile EPERM blocks all worker
  invocation.

### Security rules

- **Never print secrets.** `.env` holds the DeepSeek API key and the control-plane
  bearer token. Grep for keys by *variable name*, never dump the file.
- `.env` is gitignored. Verify with `git check-ignore -v .env` before any commit.
- `minecraft-server/plugins/floodgate/key.pem` is a **credential** — it is what
  binds a Bedrock client to this server. Do not commit or share it. It lives
  under the gitignored `minecraft-server/`.
- Install plugins **hash-verified** against the official GeyserMC build API.

---

## 6. Prioritized next work

### 6.1 Finish crossplay — *blocking, do first*

The whole reason Geyser was installed. One restart away.

1. `./scripts/restartPaper.sh`
2. `./scripts/verifyCrossplay.sh` — local checks must pass; runtime auth remains
   explicitly unverified until the successful iPad login.
3. Son joins on the iPad: **Play → Servers → Add Server**, address = the LAN IP
   the verifier prints, port **19132**.
4. **Watch what he does.** He plays explore/adventure, not constant action;
   puzzles; wants action "spiky and manageable" — bursts, not attrition.

**Acceptance:** a Bedrock client connects and appears in the player list. Note
the name it arrives under (`.Panda_Nuggetz` or bare) — that confirms §2.7 in the
real world.

**Then ask him:** what should Guardian be called, what should it remember, and
what should it do when he's not talking to it. Capture the answers verbatim.

### 6.2 M2 — semantic memory

Currently zero. The companion remembers build jobs and location tags but has no
semantic recall across sessions. This is the difference between "a bot that
reacts" and "a companion that knows you".

Direction: embeddings/vector search over conversation history, cross-world
landmarks, and a notion of which memories are worth keeping. The schema already
has `learningStore` groundwork; `memory-bank/` is **not** where this lives.

### 6.3 Nightly "compound over time" work

The user wants a world that is *always on*, doing scheduled work that
accumulates rather than free-roaming autonomy. Unspecified so far — this needs
design, not just implementation.

Related: the always-on deployment target is undecided. Options are the second Mac
as a home server, or supervised on this machine. Note `caffeinate -s` is
recommended for always-on but **is not implemented**.

### 6.4 Guardian is dying constantly

`logs/latest.log` is full of `Guardian was slain by Zombie`, `shot by Skeleton`,
`blown up by Creeper`.

These predate the survival controller, so this is untested rather than broken.
But there is a real design problem underneath: Guardian is opped at level 4,
which **bypasses `spawn-protection=16`**, so the bot fights in the open at night
with nothing between it and a creeper. The moment it starts dying in front of
your son is the moment it matters.

Prefer observing it live over pre-optimizing. Fix what actually kills it.

### 6.5 Cross-dimension teleport

`/tp` is same-dimension only. `goto_location` to a Nether or End anchor fails.

### 6.6 Voice (M4)

Turn-based STT/TTS. Entirely unbuilt. Geyser improves the odds that this is even
practical on Bedrock, since the protocol path is now bridged.

---

## 7. Ground rules

1. **Demonstrate milestones live. Never infer them from source that reads
   correctly.** This is the project's repeated failure mode.
2. **Surgical refactors.** mineflayer, SurrealDB and the agent/memory/ai split
   are deliberate. Preserve them.
3. **Deterministic where it matters.** Reaction paths get no LLM.
4. **Frontend is the user's own work.** Do not hand them built UI components.
   Provide specs, layout, interaction rules and constraints — they will build it.
5. **Model/provider changes are `.env` + restart.** No hot reload, deliberately.
6. **Before any destructive git command, capture `git status --short` as a
   baseline.** Use path-scoped operations only — never a tree-wide
   `git restore --source=HEAD --staged --worktree .`. Doing that once silently
   destroyed six files of uncommitted work, unrecoverably.
7. **Sleep handling:** Ctrl+C before closing the lid.

---

## 8. Original handoff provenance

These are the original handoff's checks, retained as historical provenance.
The campaign checkpoint and §3 distinguish fresh checks from earlier evidence:

| Claim | How |
|---|---|
| 21/21 tests | `npm test` |
| typecheck clean | `npm run check` |
| Geyser listening | `verifyCrossplay.sh` → `lsof` UDP 19132 |
| Floodgate key | `verifyCrossplay.sh` → file exists |
| DeepSeek content | live API call, 12 tokens vs 136 |
| DB round-trip | live SurrealDB instance |

Claims in the "NOT verified" table are **not** evidence of failure — they are
the absence of evidence. Treat them as untested.
