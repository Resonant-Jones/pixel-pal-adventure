#!/usr/bin/env bash
#
# scripts/installCompanionAgent.sh
#
# Installs the companion app as a LaunchAgent and starts it.
#
# This has to run OUTSIDE the agent's sandbox, because it writes to
# ~/Library/LaunchAgents. From inside the sandbox the write is refused and
# the bootstrap fails with a permissions error that says nothing useful.
#
# Usage:
#   ./scripts/installCompanionAgent.sh          install and start
#   ./scripts/installCompanionAgent.sh --remove remove and stop
#
# After this, the app is running as your own process with your own
# permissions, which is what lets it see CoreAudio at all.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.guardian.companion"
PLIST_SRC="$ROOT/scripts/$LABEL.plist"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

if [ "${1:-}" = "--remove" ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST_DST"
  echo "removed $LABEL"
  exit 0
fi

if [ ! -f "$PLIST_SRC" ]; then
  echo "missing $PLIST_SRC" >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/.local/logs"

# Replace the plist rather than patch it, so a moved checkout does not leave
# a job pointing at a path that no longer exists.
cp "$PLIST_SRC" "$PLIST_DST"

# An existing job is stopped first, or the bootstrap below refuses.
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true

launchctl bootstrap "$DOMAIN" "$PLIST_DST"
launchctl enable "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl kickstart -k "$DOMAIN/$LABEL" 2>/dev/null || true

echo "installed and started $LABEL"
echo "  plist:  $PLIST_DST"
echo "  log:    $ROOT/.local/logs/companion.log"
echo "  stop:   launchctl bootout $DOMAIN/$LABEL"
