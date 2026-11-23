# The microphone watchdog — keeping AxisNode on its own microphone

**Written:** 2026-11-23
**Status:** built and verified live. The macOS switch does not exist; the
outcome is enforced instead.

---

## 1. The report

> *"My iPhone keeps activating as a 'Microphone' for AxisNode even though
> AxisNode has a Built in Microphone."*

What is actually happening: macOS is exposing the iPhone as a **Continuity
Camera**, and a Continuity Camera brings its microphone with it. The device
list on this machine is:

```
  * 77  in   MacBook Air Microphone
    70  out  MacBook Air Speakers
    82  in   ScoutNode Microphone
```

`ScoutNode` is the family iPhone (model `iPhone17,1`). Its microphone is a
real, selectable input, and macOS selects it when the Continuity Camera is in
use.

## 2. There is no switch

macOS 27.2 has no setting for this. The System Settings search was run three
ways — "iPhone", "Camera", "Continuity" — and returned:

- iPhone Mirroring, iPhone Widgets
- Handoff, AirDrop, AirPlay Receiver
- Notifications, Hearing Devices
- Accessibility pointer options, Privacy camera

There is no Control for it, and there is no writable `defaults` key either:
the state belongs to the Continuity capture subsystem, not to a preference
anyone can read or set.

**So the outcome is enforced rather than the switch flipped.** A watchdog
watches the system default input and puts it back on the pinned device.

## 3. What it does and does not do

**Does:** keeps the *system default input* on `MacBook Air Microphone`.

**Does not:** stop the iPhone being a camera, stop macOS offering the phone's
microphone, or affect what Guardian captures.

That last one matters, and it is the stricter of the two protections:

| | rule | where |
|---|---|---|
| system default | held on the built-in microphone | `companion/guardDefaultInput.swift` |
| Guardian's capture | device pinned **by name**, iPhone/iPad **refused outright** | `companion/deviceResolver.js` |

Guardian never asks the system default for anything. It asks for
`MacBook Air Microphone` by name, and if that name is absent it reports the
device missing rather than silently substituting whatever took its place. An
iPhone or iPad input is refused by name — they belong to the son, and a
Continuity input carries the machine's own audio back in, which is a loop
rather than a microphone.

**It is a convenience, not a security boundary.** Anyone who can run code as
this user can run the watchdog's inverse. The real privacy protection is the
name-pinned capture, which does not depend on this.

**It is reversible.** Stop the watchdog and macOS does whatever it liked
before. The cost is that if you are in a call using the iPhone as a camera,
the input goes back to the Mac's own microphone — usually what you want, but
it is a behaviour change.

## 4. The verification

The only way to know the watchdog puts the input back is to let something
take the input away and watch it take it back. Measured on this machine,
outside the sandbox (CoreAudio is not visible to a sandboxed process):

```
$ guard-default-input --set "ScoutNode Microphone"
guard: default input is now "ScoutNode Microphone"

$ guard-default-input --list
    77  in   MacBook Air Microphone
    70  out  MacBook Air Speakers
  * 82  in   ScoutNode Microphone
default input: ScoutNode Microphone

$ guard-default-input --once --ensure "MacBook Air Microphone"
guard: default input was "ScoutNode Microphone" — moved back to "MacBook Air Microphone"
(exit 1 — moved back)

$ guard-default-input --list
  * 77  in   MacBook Air Microphone
    70  out  MacBook Air Speakers
    82  in   ScoutNode Microphone
default input: MacBook Air Microphone
```

The machine was left on its own microphone.

## 5. One bug worth remembering

The first version asked `AudioObjectHasProperty(device,
kAudioObjectPropertyScopeInput)` whether a device was an input. On this
machine that answers **no for every device** — including the built-in
microphone — so the watchdog filtered out everything it was supposed to hold
on to and printed *"no input device named 'MacBook Air Microphone' — nothing
to hold on to"* while that device was sitting there, selected, as the system
default.

The reliable test is the streams: a device is an input device if any of its
streams has direction 1. The stream selectors are not bridged into Swift, so
their four-character codes are spelled out in the source (`'stm#'`, `'sdir'`).
The `--list` output is self-checking: the built-in microphone and the phone's
microphone must read `in` and the speakers must read `out`. If the codes were
wrong, nothing would read `in` — which is exactly the failure the rewrite was
written to end.

## 6. Where the code is

```
companion/guardDefaultInput.swift   the watchdog
companion/inputGuard.js             spawns it, restarts it if it dies, reports status
companion/companionApp.js           starts it on boot, stops it on shutdown
scripts/buildInputGuard.sh          builds it into .local/bin/
scripts/com.guardian.agent.plist     Guardian as a LaunchAgent
scripts/com.guardian.companion.plist the companion app as a LaunchAgent
scripts/installLaunchAgents.sh      installs and starts both
tests/inputGuard.test.js            a missing binary must not take the app down
```

The binary lives in `.local/bin/` because a compiled binary does not belong
in the repository. If it is missing, the companion app says so and carries on
— a convenience that takes the app down with it would be worse than not
having it.

**Both the agent and the console run as LaunchAgents**, because they have to
survive the coding session that started them. A background task has a
one-hour ceiling, and when the ceiling fires the agent is sent SIGTERM and
leaves the world while Paper, SurrealDB and the console all keep running — a
failure that looks partial and that nothing restarts.

**The app has to run outside the agent's sandbox**, because CoreAudio is not
visible from inside it: AVFoundation cannot even enumerate the devices, so an
app started from there would look like it was listening while capturing
nothing. That is why it is a LaunchAgent.

`launchctl submit` — the way it used to be started — no longer works on
macOS 27.2: it exits 1 with a usage message for every command, including
`/usr/bin/true`. It is now a real plist bootstrapped into the GUI session,
which is also better, because a submitted job died with the session that
made it and this one comes back on login.

```
./scripts/installLaunchAgents.sh            install and start both
./scripts/installLaunchAgents.sh --remove   stop and uninstall both
```

The console shows the watchdog under **The link → Audio route → system
microphone**: `held on MacBook Air Microphone`, or `held on MacBook Air
Microphone (took it back 3 times)` if it had to intervene.
