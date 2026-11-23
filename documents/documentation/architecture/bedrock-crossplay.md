# Bedrock crossplay — what is installed, what is missing, and what to say

**Written:** 2026-11-23
**Status:** the bridge is installed and listening. Two gaps are known and
neither of them is "we turned Bedrock off". Crossplay has still never been
confirmed at runtime — no iPad has ever joined.

---

## 1. The short answer

**No, Bedrock was not shut out.** Nothing was removed and nothing was
disabled to make the Java-first version work. The bridge is installed, it is
running, and it is listening for Bedrock players right now.

What is missing is **a plugin for voice**, not the game. Bedrock projection —
the son joining from his iPad and playing the same world Guardian is in — is
still entirely possible and was never traded away.

Two real gaps are known, and they are version work rather than decisions:

1. The installed Geyser is behind the current Bedrock client version.
2. The transport is set to RakNet only; current Bedrock clients prefer
   NetherNet signaling.

## 2. What is installed and running

Checked live on 2026-11-23 against the running server:

```
minecraft-server/plugins/Geyser-Spigot.jar        47,170,037 bytes
minecraft-server/plugins/floodgate-spigot.jar    11,561,096 bytes
minecraft-server/plugins/floodgate/key.pem       present
```

Geyser-Spigot v2.11.3-SNAPSHOT (build b1249), Floodgate 2.2.5-SNAPSHOT.

The server log, on every start:

```
[14:21:36 INFO]: [Geyser-Spigot] Started Geyser on UDP port 19132
```

The Paper JVM holds the port:

```
COMMAND   PID    FD   TYPE  DEVICE  NODE  NAME
java    53672   169u  IPv6  ...     0t0   UDP *:19132
```

`Geyser-Spigot/config.yml`:

```yaml
bedrock:
  address: 0.0.0.0
  port: 19132
  transport: raknet
  webrtc-port: 0
```

And `server.properties` has `enforce-secure-profile=false`, which is what a
Bedrock client needs.

**TCP 19132 is refused and that is correct.** Bedrock speaks RakNet over
UDP; there is no TCP listener on that port. The Bedrock port is UDP 19132
and the Java port is TCP 25565.

## 3. Gap one — the Geyser build is behind the Bedrock client

Geyser tells us this itself, on every start:

```
[14:21:36 INFO]: [Geyser-Spigot] There's a new Geyser update available to
support Bedrock version 26.66. Download it here: https://geysermc.org/download
```

Upstream, the current Geyser supports **Bedrock 26.40–26.65** and Java
26.3 ([supported versions](https://geysermc.org/wiki/geyser/supported-versions/);
the download page's latest build is 11/20/2026). Geyser 2.12.1 was the
first release to accept Bedrock 26.60, and later builds added 26.61–26.65.

**What this means in practice:** if the iPad has updated to a Bedrock
version newer than the installed Geyser understands, the connection will be
refused at the protocol level — the client connects and is turned away,
which looks to a child like "the server is broken" and is the worst kind of
failure to debug blind.

**This is the one thing to check on the iPad:** what Bedrock version is it
on? If it is on 26.66 or newer, Geyser must be updated before the son tries
to join. Updating Geyser means downloading the current jar, replacing
`Geyser-Spigot.jar`, and restarting Paper — and a newer Geyser may want a
newer Paper to go with it, which is a larger job.

## 4. Gap two — RakNet only, where Bedrock now prefers NetherNet

The config sets `transport: raknet`. The same config file offers
`nethernet` and `both`, so **this build supports NetherNet** — it is simply
not switched on. NetherNet is "the new connection method for Bedrock
Edition" per Geyser's own comment in that file.

The transport in use must differ from the Bedrock port when both are run in
parallel, so the change is:

```yaml
bedrock:
  transport: both
  webrtc-port: 19133      # must differ from 19132
```

and UDP 19133 has to be free and reachable.

**Not changed yet, deliberately.** It cannot be verified until Paper
restarts, and the agent cannot restart Paper — that is a human step
(`scripts/restartPaper.sh`). A change to a working server's transport that
cannot be tested should be made together with the restart and watched, not
made blind.

## 5. What was actually blocked, and why

The thing that is *not* installed is the **Bedrock Voice Chat plugin**, and
that is a voice problem, not a game problem:

- Bedrock clients cannot load Java voice mods (Simple Voice Chat is a
  Fabric/Forge mod). Geyser emulates a vanilla Java client, so a Bedrock
  player arrives with no voice mod: allowed in, but silent.
- Bedrock Voice Chat has a Paper plugin that serves Bedrock clients and
  bridges to Simple Voice Chat for Java clients — one voice system for both.

Its blockers are real and none of them are about wanting Java only:

- It needs a **domain and a valid TLS certificate**. Self-signed is
  refused.
- It needs **BlackHole** for local DNS, and installing BlackHole needs an
  admin password.
- The BVC app has to go on the son's iPad — and **which iPad is the son's is
  still unknown** ("Chris's iPad (3)" and "Krista's iPad (2)" are both on
  the network).

None of that stops the son from *playing*. It stops him from *talking*.

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
> Two small jobs before it works, and neither is anything to do with
> choosing one over the other:
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
| Geyser updated past the Bedrock client version | **not done** — needs the iPad's version first |
| Transport switched to `both` | **not done** — needs a Paper restart to verify |
| Bedrock Voice Chat plugin + BlackHole | **not done** — needs TLS + a domain + an admin password + the BVC app on the iPad |
