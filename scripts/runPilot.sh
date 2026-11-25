#!/usr/bin/env bash
#
# scripts/runPilot.sh
#
# The pilot, in the foreground, as a launchd job.
#
# WHY A WRAPPER AND NOT node DIRECTLY
#
# launchd gives a job a minimal PATH — /usr/bin:/bin:/usr/sbin:/sbin — and on
# this machine node is NOT in /opt/homebrew/bin. It is in ~/.local/bin. A
# plist that points straight at /opt/homebrew/bin/node fails to exec and the
# job exits with EX_CONFIG (78), which is what happened the first time.
#
# The wrapper sets the PATH the way the other service wrappers do, and then
# execs node. The job's stdout and stderr go to the log files the plist
# names.
#
# WHY THE PILOT NEEDS A REAL USER SESSION
#
# It restarts the world with `launchctl kickstart`, and launchctl refuses to
# mutate another job from inside the agent's sandbox. Running as its own
# LaunchAgent in the GUI session is what gives it that authority.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PATH="/opt/homebrew/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

NODE="$(command -v node || true)"

if [ -z "$NODE" ]; then
  echo "pilot: node is not on PATH" >&2
  exit 78
fi

exec "$NODE" "$ROOT/scripts/pilot.js" "$@"
