#!/usr/bin/env bash
#
# scripts/runAgent.sh
#
# Run Guardian outside the agent sandbox.
#
# WHY A LAUNCH AGENT AND NOT A BACKGROUND JOB
#
# The agent used to be started as a background task by the coding session.
# That has a hard ceiling: background tasks are capped at an hour, and when
# the cap fires the agent is sent SIGTERM and leaves the world. The world
# survives — Paper, SurrealDB and the companion app all keep running — but
# Guardian is no longer in it, and nothing restarts it.
#
# launchd has no such ceiling, and a bootstrapped LaunchAgent comes back on
# login as well as after a crash. `launchctl submit` used to be the way to
# do this and no longer works on macOS 27.2, so this is a real plist now.
#
# USAGE
#
#   ./scripts/runAgent.sh              run in the foreground
#   ./scripts/runAgent.sh --check      report the configuration and exit

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# launchd gives a minimal PATH. node and ffmpeg both live outside it.
export PATH="/opt/homebrew/bin:/Users/resonant_jones/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

mkdir -p "$ROOT/.local/logs"

# In the foreground you want to see it. Under launchd there is no terminal to
# see, so it goes to a log instead of disappearing.
if [ -t 1 ]; then
  exec node "$ROOT/scripts/startAgent.js" "$@"
else
  exec node "$ROOT/scripts/startAgent.js" "$@" >> "$ROOT/.local/logs/agent.log" 2>&1
fi
