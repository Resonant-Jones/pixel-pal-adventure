# The `guardian` command — starting the whole thing

**Written:** 2026-11-24
**Status:** built and verified cold. One command brings up all four services.

---

## 1. What you type

```
guardian
```

That is it. It brings up SurrealDB, the Minecraft server, Guardian and the
console, leaves them running, and prints where everything is.

```
  guardian              bring everything up, then print the status
  guardian --status     just print the status
  guardian --stop       stop the four services
  guardian --restart    stop them and bring them up again
  guardian --remove     stop them and uninstall the launchd jobs
```

It is idempotent. Anything already running is left alone — including a
Guardian that is in the middle of something, which is not kicked and
restarted. Run it as often as you like.

The command lives at `~/.local/bin/guardian`, which is already on your PATH.
It is a two-line shim; the real thing is `scripts/guardian.sh` in the repo.

## 2. The four services

| service | port | what it is | launchd label |
|---|---|---|---|
| SurrealDB | 8001 | the memory | `com.guardian.surreal` |
| Paper | 25565 | the world (+ Bedrock on UDP 19132) | `com.guardian.paper` |
| Guardian | 8787 | the companion in the world, and the control plane | `com.guardian.agent` |
| Console | 8788 | the voice link and the Memory panel | `com.guardian.companion` |

They are started in that order, because each depends on the one before it:
the agent connects to the database at startup, and joins the world.

**Why launchd and not one process.** The world has to keep running when the
terminal closes and when a coding session ends. A child of either does not.
`launchctl submit` — the way this used to be started — no longer works on
macOS 27.2: it exits 1 with a usage message for every command, including
`/usr/bin/true`. So each service is a real plist bootstrapped into the GUI
session, which also means they come back on login.

## 3. The rule that keeps them from fighting each other

Every wrapper asks "is somebody already serving my port?" before it starts,
and the answer has to be *no* — but the naive version of that question gets
it wrong in a very common case: **the previous instance is still shutting
down and has not released the port yet.**

That race was not theoretical. Stopping the world and immediately starting
it again produced exactly this: the new Paper job found 25565 still open,
stood down cleanly, and then the old server died — leaving nothing serving
the port, with a launchd job that had already given up.

So the rule is two-sided:

- **The wrapper waits for the port to be released** before deciding someone
  else owns it. If it frees up, start. If it is still held after the wait,
  then it really is another server and standing down is right.
  (`scripts/portwait.sh`)
- **The job restarts only after a FAILED exit.** `KeepAlive` is
  `SuccessfulExit: false`, so a wrapper that exits cleanly — because
  something else is serving — leaves the job quiet instead of taking turns
  killing the other server every ten seconds.

And the `guardian` command does not treat a bound port as a healthy service.
A port that stays open for three seconds is a live service; one that closes
during that window is a corpse, and the command starts a replacement rather
than reporting "already up".

## 4. Two bugs this shook out

Both were found by running it, not by reading it.

**A bash scoping bug that killed the command on its first wait.**

```bash
local port="$1" label="$2" timeout="${3:-90}" deadline=$(( SECONDS + timeout ))
```

In a single `local` statement every right-hand side is expanded *before* any
assignment happens, so `$(( SECONDS + timeout ))` reads the **outer**
`timeout` — which is unset — and under `set -u` that is a fatal
`timeout: unbound variable`. The command died on its very first wait, so it
never started Paper, the agent or the console.

The fix is one assignment per line, with the reason written next to it so
nobody "tidies" it back.

**Guardian crashed during shutdown when the database was gone.**

Stopping the stack killed SurrealDB first and then Guardian. The writes that
close the session failed with `fetch failed`, the exception escaped
`AgentRuntime.stop()`, and the process died with an unhandled rejection and a
non-zero exit — which the launchd job, configured to restart after a failed
exit, read as a crash.

The rule now: **shutting down must not throw.** A session that cannot be
closed in a database that has gone away is a session that is over. The
teardown in the `finally` block is guarded the same way, because a shutdown
that dies halfway leaves the bot in the world with no brain — which looks
exactly like a crash to whatever is supervising it.

Pinned by `tests/agentShutdown.test.js`.

## 5. Installing it elsewhere

```bash
cd /Users/resonant_jones/Keep/MineCraft_Companion/minecraft-ai-companion
./scripts/installLaunchAgents.sh      # same thing; guardian installs itself
```

The install has to run **outside the agent's sandbox**, because it writes to
`~/Library/LaunchAgents` and the sandbox refuses that with
`Operation not permitted`. From inside the agent's sandbox, the launchd jobs
cannot be installed at all.

`guardian` installs its own shim into `~/.local/bin` on first run, and
refreshes the five plists every time so an edited plist or a moved checkout
takes effect on the next `guardian`.

## 5a. The pilot — the job that notices when the world stops

**`com.guardian.pilot`** (`scripts/pilot.js`) watches the world through the
agent and restarts it if the agent is alive but cannot get in.

### Why it exists

On 2026-11-25 the world went down at 01:48 and stayed down for nearly nine
hours. Paper's own watchdog noticed —

```
[02:18:47 ERROR]: The server has not responded for -5 seconds! Creating thread dump
[02:18:50 ERROR]: Current Thread: Server thread
[02:18:50 ERROR]:   State: TIMED_WAITING
[02:18:50 ERROR]:   net.minecraft.server.MinecraftServer.runServer
[02:18:50 ERROR]:   net.minecraft.server.MinecraftServer.recordTaskExecutionTimeWhileWaiting
```

— and then the server thread stayed parked forever. The JVM was still alive
and still holding port 25565.

**launchd could not see that.** `KeepAlive` restarts a job that *exits*, and
this job never exited. So every port stayed open, the console connected the
whole time, Guardian was simply turned away at the door, and nothing in the
system was watching for that.

### Why a status ping cannot detect it

The server-list request is served **off** the main server thread, so it
answers perfectly on a server that cannot let a single player in. Verified
on the hung server:

```
PING OK -> version: Paper 1.21.11 players: 0
```

A world that no one could enter answered the ping without complaint.

### So the probe is the agent

The agent is already a player. It is already trying to get in. It already
reports the difference, in `connectionHealth` and `lifecycle` on the control
plane's `/state`.

The rule the pilot implements:

| the agent | the pilot does |
|---|---|
| alive and connected | nothing — the world is fine |
| alive and still trying | nothing — it may be a server that is booting |
| alive and gave up | **nudge it**, and restart the world only if that fails |
| not answering | nothing — that is the agent's problem, and launchd's job |

It never restarts the agent, and never restarts the world because the agent
is unhealthy. It only acts when the agent is demonstrably alive and
demonstrably locked out.

It runs as its own launchd job, outside the agent's sandbox, because
restarting a launchd service needs a real user session.

### Two actions, and the order matters

The agent, having exhausted its own reconnect attempts, **stays out**. Its
reconnect machinery only runs again when something asks it to, and nothing
does on its own. So the pilot has to ask. But asking and restarting the
world are very different in weight:

1. **Nudge.** Ask the agent to try again, through the control plane's
   existing `/command/reconnect`. Cheap. If the world was merely awkward for
   a moment, this is enough and nothing is disturbed.
2. **Restart the world.** Only if nudging did not work. Expensive, and the
   only thing that can fix a server whose main thread has stopped.

Nudging first means a transient hiccup costs one request, and the world is
only restarted when it is genuinely not serving.

**This is not hypothetical.** On 2026-11-25 the world recovered on its own at
16:44 — Paper's thread came back — and Guardian still did not come back,
because it had given up and nothing re-triggered it. The nudge is what closes
that gap.

### Waiting out a cooldown, out loud

After a restart the pilot will not restart the world again for ten minutes.
That is there so a world that keeps dying cannot be restarted every minute.

The first version of that wait was silent, and silence is the one thing a
watchdog must never be. It logged that the world was broken and then said
nothing at all — which to an operator reading the log is indistinguishable
from a watchdog that has given up. It now says what it is waiting for and
how long is left:

```
[pilot] not restarting yet — the world was restarted 545s ago and the cooldown
        is 600s. Trying again in 55s.
```

If you see that line and the world really is down, the fix is
`guardian --restart`.

### The status line tells the truth

`guardian --status` now reports the world from the agent's view, not from a
port check:

```
[guardian] ✓ Minecraft   http://127.0.0.1:25565
[guardian] ✗ the world is NOT serving — Guardian is alive but locked out.
```

The first line says the port is open. The second says whether that means
anything. They disagree exactly when the server has stopped ticking.

## 6. Where the logs are

```
.local/logs/surreal.out     SurrealDB
.local/logs/paper.out       the Minecraft server (this is the launchd job's)
.local/logs/paper.log       the older server's log, from before it was a job
.local/logs/agent.log       Guardian
.local/logs/companion.log   the console
.local/logs/pilot.log       the pilot
.local/logs/pilot.err       the pilot's errors
```

`paper.out` and `paper.log` are both Paper logs; the split is because the
server used to be started by `startStack.js` (which wrote `paper.log`) and is
now a launchd job (which writes `paper.out`).
