#!/usr/bin/env bash
#
# scripts/installLaunchAgents.sh
#
# Installs Guardian and its console as LaunchAgents, and starts them.
#
# This has to run OUTSIDE the agent's sandbox, because it writes to
# ~/Library/LaunchAgents. From inside the sandbox the write is refused and
# the bootstrap fails with a permissions error that says nothing useful.
#
# Usage:
#   ./scripts/installLaunchAgents.sh          install and start both
#   ./scripts/installLaunchAgents.sh --remove remove and stop both
#
# TWO JOBS, ONE INSTALLER
#
#   com.guardian.agent      Guardian: the bot in the world and the control
#                           plane on 8787.
#   com.guardian.companion  The console and the voice link on 8788, which
#                           opens the microphone.
#
# They are a pair: the console talks to the agent's control plane, so the
# agent goes first and the console follows.
#
# WHY NOT A BACKGROUND JOB
#
# A background task started by a coding session has a one-hour ceiling, and
# when the ceiling fires the agent is sent SIGTERM and leaves the world. The
# world survives — Paper, SurrealDB and the console all keep running — so
# the failure looks partial and nothing restarts it. launchd has no such
# ceiling, and these jobs also come back on login.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOMAIN="gui/$(id -u)"

LABELS=("com.guardian.agent" "com.guardian.companion")

install_one() {
  local label="$1"
  local src="$ROOT/scripts/$label.plist"
  local dst="$HOME/Library/LaunchAgents/$label.plist"

  if [ ! -f "$src" ]; then
    echo "missing $src" >&2
    return 1
  fi

  mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/.local/logs"

  # Replace the plist rather than patch it, so a moved checkout does not
  # leave a job pointing at a path that no longer exists.
  cp "$src" "$dst"

  # An existing job is stopped first, or the bootstrap below refuses.
  launchctl bootout "$DOMAIN/$label" 2>/dev/null || true

  launchctl bootstrap "$DOMAIN" "$dst"
  launchctl enable "$DOMAIN/$label" 2>/dev/null || true
  launchctl kickstart -k "$DOMAIN/$label" 2>/dev/null || true

  echo "installed and started $label"
}

if [ "${1:-}" = "--remove" ]; then
  for label in "${LABELS[@]}"; do
    launchctl bootout "$DOMAIN/$label" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/$label.plist"
    echo "removed $label"
  done
  exit 0
fi

for label in "${LABELS[@]}"; do
  install_one "$label"
done

echo
echo "  agent:    http://127.0.0.1:8787  (control plane)"
echo "  console:  http://127.0.0.1:8788  (voice link + Memory panel)"
echo "  log:      $ROOT/.local/logs/agent.log"
echo "  stop:     launchctl bootout $DOMAIN/com.guardian.agent"
