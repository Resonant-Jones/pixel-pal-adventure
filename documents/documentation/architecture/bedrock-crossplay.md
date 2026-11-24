# Bedrock crossplay — what is installed, what is missing, and what to say

**Written:** 2026-11-23. **Revised:** 2026-11-24, with every version claim
below verified against the running server, the upstream release notes, and the
published plugin binaries rather than inferred.

**Status:** the bridge is installed and listening. Crossplay has still never
been confirmed at runtime — no iPad has ever joined — and the gap is now
precisely known: **the iPad cannot join today, and the reason is a version
chain, not a decision.**

---

## 1. The short answer

**No, Bedrock was not shut out.** Nothing was removed and nothing was
disabled to make the Java-first version work. The bridge is installed, it is
running, and it is listening for Bedrock players right now.

What is missing is **a plugin for voice**, not the game. Bedrock projection —
the son joining from his iPad and playing the same world Guardian is in —
was never traded away.

But there is a third thing, which the first draft of this document did not
know about, and it is the thing that matters:

> **The iPad cannot join today.** The installed Geyser speaks Bedrock
> 26.30–26.52. The current Bedrock client is 26.65, with 26.66 next. The
> server says so itself, on every boot, in its own log.

## 2. Is there an update to Minecraft?

Yes — and it is not the one anyone would hope for.

| | current | released |
|---|---|---|
| Bedrock | 26.65 (26.66 next, 26.70 in development) | 26.65 on 2026-11-16 |
| Java | 26.3 | Paper 26.3 STABLE, rebuilt 2026-11-24 |

**And there is still no built-in voice chat in Bedrock.** Native Bedrock
voice chat remains an open feature request on Minecraft's own feedback
board, not a shipped feature. Whatever a third-party assistant says about
that, it is right: Geyser bridges *gameplay*, not the microphone.

The update that actually bites is this one:

> **Bedrock 26.60 (27 October 2026) made NetherNet mandatory.** Current
> Bedrock clients no longer negotiate over RakNet alone. The installed
> Geyser is configured `transport: raknet`, so the transport change is no
> longer a nicety — it is required.

## 3. The version chain, exactly

This is the part worth understanding, because every link is a real
dependency and they pull in one direction.

```
Bedrock client on the iPad         26.65 / 26.66
        │
        │  must be spoken by Geyser
        ▼
Geyser (installed: 2.11.3)         Bedrock 26.30 – 26.52   ✗ TOO OLD
Geyser (current release)            Bedrock 26.40 – 26.65   ✓ but speaks
        │                                                      Java 26.3
        │  must be spoken by Paper
        ▼
Paper (installed: 1.21.11)         Java 1.21               ✗ TOO OLD
Paper (current release)             26.3 STABLE             ✓
        │
        │  must be spoken by the bot's client
        ▼
minecraft-data (newest release)     tops out at 26.1        ✗ TOO OLD
```

The last link is the one that is usually missed. **minecraft-data — the
protocol table mineflayer uses — still tops out at `26.1` (protocol 775) even
at the newest release** (verified by reading `data/pc/common/versions.json`
and the `data/pc/` directory listing from master; the list ends
`1.21.11, 26.1`, and `data/pc/26.1` is the newest protocol directory that
exists). So Guardian's bot cannot speak to a Paper 26.2 or 26.3 server
directly, and the newest protocol it *can* speak is one version below the
newest protocol it would need.

### The translation plugin is not the one you would guess

This is worth getting right, because the obvious answer is the wrong one.

| plugin | direction | what it is for |
|---|---|---|
| **ViaVersion** | **new client → old server** | a 26.3 player joining a 1.21 server |
| **ViaBackwards** | **old client → new server** | a 1.21 bot joining a 26.3 server |
| ViaRewind | very old client → new server | 1.7-era clients |

We need the **second** one. Installing ViaVersion alone does nothing here,
and the symptom is misleading: the server still refuses the client with
"Outdated client! Please use version X", which looks exactly like the
plugin not being installed at all.

### The way out

ViaBackwards 5.12.2's release notes carry a `26.3->26.2` mapping. The
client side needs protocol 776.

So the migration is:

1. Paper 1.21.11 → **26.3** (stable; build 261 was rebuilt 2026-11-24).
   Paper 26.2 is also stable; **26.1 has no published builds at all.**
2. Geyser 2.11.3 → current release (Bedrock 26.40–26.65, Java 26.3).
3. `transport: raknet` → `both`, with `webrtc-port: 19133` — NetherNet is
   mandatory for Bedrock 26.60+.
4. ViaVersion → **ViaBackwards** 5.12.2, alongside ViaVersion.
5. mineflayer 4.37.0 → **4.39.0** with minecraft-data **3.119.0**, which
   brings protocol 775 (26.1) — and, when it lands, 776 (26.2).

## 3b. What was tested, and what the result was

This is not a plan; these are measurements, taken on a **copy** of the world
on ports 25566/25567. The live world and the live server were not touched.

**The world survives the Paper jump. That is the good news.**

```
[INFO]: [WorldFolderMigration] Starting upgrade for world "world"
[INFO]: [WorldFolderMigration] Applying file structure changes for world "world"
[INFO]: [WorldFolderMigration] Done applying file structure changes...
[INFO]: [VanillaWorldMigration] Completed Vanilla import for world 'world'
[INFO]: Preparing level "world"
[INFO]: Done (36.465s)! For help, type "help"
```

Paper 26.3 restructures the world into `dimensions/minecraft/overworld/`
and runs the data converters. All nine overworld region files, the entity
region files, the player data and the nether came across. 29 MB before,
31 MB after. Paper 26.2 loads the same migrated world.

**The bot does not follow. That is the bad news, and it is precise.**

| attempt | client | server | result |
|---|---|---|---|
| ViaVersion 5.12.1 | 774 (1.21.11) | 777 (26.3) | refused — "Outdated client" |
| ViaVersion 5.12.2 | 775 (26.1) | 777 (26.3) | refused — "Outdated client" |
| ViaBackwards 5.12.2 | 775 (26.1) | 777 (26.3) | refused — "Outdated client" |
| ViaBackwards 5.12.2 | 775 (26.1) | 776 (26.2) | refused — "Outdated client" |

**The gap is exactly one protocol version wide, and it is upstream.**

- ViaBackwards 5.12.2 can put a **776 (26.2)** client onto a **777 (26.3)**
  server. It will not go down to 775.
- minecraft-data's newest release speaks **775 (26.1)** and has no data for
  776. There is no 26.2 directory in `data/pc/`.

So there is no client/server pair available today that both sides support.
It closes when either:

- **minecraft-data ships 26.2 protocol data** — then the bot speaks 776 and
  ViaBackwards translates it onto 26.3. A data-generation PR.
- **ViaBackwards adds a `26.3->26.1` mapping** — then the bot stays at 775.
  A protocol-mapping PR.

Both are the kind of change those projects ship every few weeks, and both
are on the critical path of a project that is actively releasing (Geyser
rebuilt today; Paper rebuilt today; ViaVersion and ViaBackwards released
2026-10-27).

**Which means: the iPad is not blocked by anything we chose. It is blocked
by a one-version gap between two upstream projects, and the world is ready
to move the moment that closes.**

## 4. What is installed and running

Checked live on 2026-11-24 against the running server:

```
minecraft-server/plugins/Geyser-Spigot.jar        47,170,037 bytes
minecraft-server/plugins/floodgate-spigot.jar    11,561,096 bytes
minecraft-server/plugins/floodgate/key.pem       present
```

Geyser-Spigot v2.11.3-SNAPSHOT (build b1249), Floodgate 2.2.5-SNAPSHOT,
ViaVersion 5.12.1. Paper 1.21.11 build 132.

The server log, on every start:

```
[INFO]: [Geyser-Spigot] Started Geyser on UDP port 19132
[INFO]: [Geyser-Spigot] There's a new Geyser update available to support
        Bedrock version 26.66. Download it here: https://geysermc.org/download
```

`Geyser-Spigot/config.yml`:

```yaml
bedrock:
  address: 0.0.0.0
  port: 19132
  transport: raknet        # ← must become "both" for Bedrock 26.60+
  webrtc-port: 0           # ← must become 19133 when both run in parallel
```

And `server.properties` has `enforce-secure-profile=false`, which is what a
Bedrock client needs.

**TCP 19132 is refused and that is correct.** Bedrock speaks over UDP;
there is no TCP listener on that port. The Bedrock port is UDP 19132 and
the Java port is TCP 25565.

## 5. Voice: what is actually installable

### Bedrock Voice Chat — the Paper plugin gate, re-verified

The latest BVC release is **v1.0.0-beta.27** (2 November 2026). Every
Paper plugin build was downloaded and its `plugin.yml` read directly:

| build | api-version | loads on Paper 1.21.11 |
|---|---|---|
| beta.15 | `1.21` | **yes** |
| beta.16 | `26.2` | no |
| beta.17 | `26.2` | no |
| beta.19 | `26.2` | no |
| beta.20 | `26.2` | no |
| beta.21 | `26.2` | no |
| beta.23 | `26.2` | no |
| beta.25 | `26.2` | no |
| beta.26 | `26.2` | no |
| beta.27 | `26.2` | no |

Paper refuses a plugin whose declared api-version is newer than the
server's. **beta.15 is the newest Bedrock Voice Chat build that will load
on Paper 1.21.11**, and it is the one to install if we stay on 1.21.11.

beta.15's own support matrix targets **Bedrock 26.30.x** — exactly the range
our Geyser speaks — so the two are aligned. The iOS app is distributed
through TestFlight, not as a release asset:
`https://testflight.apple.com/join/JSG7bVqC`.

Three things are new since April and worth knowing:

- **BVC now ships a macOS client** (`bvc-client-macos-arm64.app.zip`). That
  matters: it means Guardian's speech could be piped *into* the voice space
  rather than heard through the air of the room.
- **darwin-arm64 native libraries** are published for the Paper plugin, and
  the "bundled" plugin jar embeds them.
- **BVC Registry** — upstream are building a way for players to acquire
  domain names and TLS certificates through BVC. That could replace the
  BlackHole-and-admin-password step entirely.

### VoiceCraft — the option worth evaluating

| | Bedrock players | proximity | extra app |
|---|---|---|---|
| Simple Voice Chat | **no, not via Geyser either** | yes | mod on the PC |
| Bedrock Voice Chat | yes (Paper + Geyser supported) | yes | app on phone or PC |
| VoiceCraft | yes, **and via Geyser on a Java server** | yes | app on phone or PC |

VoiceCraft has client apps for Windows, macOS, Linux, Android and iOS, and
a **GeyserVoice** bridge for Paper that puts Java players and Bedrock
players in one voice space — the thing Simple Voice Chat can never do on a
Geyser server, and the thing this server actually is. v1.7.2, stable
(28 September 2026); the iOS audio bug was fixed in 1.7.1.

It needs a reachable UDP port per voice adapter, so it is one more port
either way.

### What ChatGPT got right, and what it missed

The advice was: *"test the simple version first — Sage plays on the iPad
and the MacBook's existing Guardian console handles the mic and speaker in
the same room."*

That is **correct, and it is already built on our side.** The companion
app captures on `MacBook Air Microphone` and plays through
`MacBook Air Speakers`; Guardian's voice is a bot in the same world. Nothing
needs installing for that test.

It is also **blocked at the door** by the version chain in §3 — which is
the thing neither the advice nor the original document knew.

What was missed, in order of how much it matters:

1. **The Geyser version gap.** The single fact that decides whether any of
   this works.
2. **VoiceCraft**, which is a better architectural fit for a Java server
   than BVC is.
3. **The macOS client**, and therefore the architecture where Guardian
   speaks *into* the voice space at its actual position in the world,
   rather than being heard across a room.

## 6. The version, for the son

Plain, and true:

> **"You can still play on the iPad."**
>
> The bridge that lets the iPad and the computer join the same world is
> installed and switched on — it was never taken away. What isn't finished
> is the *talking* part: Minecraft's own chat works on the iPad today, but
> for voice on the iPad there's one more piece of software to install, and
> it needs a proper internet address and a security certificate so that
> nobody else can listen in.
>
> One thing has to be updated first, and it isn't hard: Minecraft on the
> iPad updated itself, and the piece that connects it to our world hasn't
> caught up yet. After that, the two small jobs before voice works are:
>
> 1. The bridge software is a version behind the newest Minecraft Bedrock.
>    If your iPad has updated, it has to be updated too — otherwise the
>    iPad asks to join and the server says no without saying why.
> 2. The way modern Bedrock connects is slightly different from the way
>    this one is set up. That's a one-line change, and it needs the server
>    restarted to take effect.

## 7. The open items, honestly

| item | status |
|---|---|
| Geyser + Floodgate installed and listening | done, verified live |
| Java port 25565 / Bedrock port UDP 19132 | done, verified live |
| Crossplay confirmed with a real iPad | **never done — no iPad has joined** |
| Which iPad is the son's | **unknown** ("Chris's iPad (3)" vs "Krista's iPad (2)") |
| What Bedrock version is the iPad on | **unknown** — decides whether the migration is needed at all |
| The world survives Paper 26.3 | **done — verified by running it on a copy** |
| The bot can follow the server | **NOT yet — blocked by a one-version upstream gap** |
| Geyser updated + `transport: both` + NetherNet | **not done** — needs the Paper bump first |
| BVC beta.15 (if we stay on 1.21.11) | **not done** — needs TLS + a domain + the app on the iPad |
| VoiceCraft evaluation | **not done** — arguably the better fit |
| Bedrock Voice Chat plugin + BlackHole | **not done** — needs TLS + a domain + an admin password |

## 8. Two test servers are still running

The verification in §3b left two Paper instances alive on **127.0.0.1:25566**
and **127.0.0.1:25567**, against copies of the world in
`.local/worldtest/`. They are harmless — localhost only, a copy of the
world, and the live server was never touched — but they should not be left
running:

```bash
kill $(lsof -nP -i TCP:25566 -t) $(lsof -nP -i TCP:25567 -t)
```

The agent's sandbox could not signal them (both were started by
backgrounded tasks, so `kill` returned "Operation not permitted"), and the
Terminal was on another Space at the time, so this one is left to a shell
with the user's own permissions.

