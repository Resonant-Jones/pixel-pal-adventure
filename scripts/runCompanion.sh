#!/usr/bin/env bash
#
# Run the companion app outside the agent sandbox.
#
# WHY THIS EXISTS
#
# The companion app has to open CoreAudio. Inside the agent's sandbox,
# AVFoundation cannot even enumerate the devices — ffmpeg fails with
# "Error opening input: Input/output error" — so an app started from there
# would look like it was listening while capturing nothing, and would look
# like it was speaking while playing silence. That is worse than not running.
#
# So the app runs as your own process, with your own permissions, and the
# agent talks to it over a WebSocket and a handful of HTTP calls.
#
# USAGE
#
#   ./scripts/runCompanion.sh              run in the foreground
#   ./scripts/runCompanion.sh --check      report the audio route and exit
#
# BACKGROUND
#
#   launchctl submit -l com.guardian.companion -- /bin/bash "$PWD/scripts/runCompanion.sh"
#   launchctl remove  com.guardian.companion        # stop it again
#
# launchd is used rather than a nohup'd background job because the app has to
# survive the agent session that started it. A nohup'd child dies with its
# shell; a launchd job does not.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# launchd gives a minimal PATH. ffmpeg and node both live outside it.
export PATH="/opt/homebrew/bin:/Users/resonant_jones/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
export COMPANION_FFMPEG="${COMPANION_FFMPEG:-/opt/homebrew/bin/ffmpeg}"

mkdir -p "$ROOT/.local/logs"

# In the foreground you want to see it. Under launchd there is no terminal to
# see, so it goes to a log instead of disappearing.
if [ -t 1 ]; then
  exec node "$ROOT/scripts/startCompanion.js" "$@"
else
  exec node "$ROOT/scripts/startCompanion.js" "$@" >> "$ROOT/.local/logs/companion.log" 2>&1
fi
