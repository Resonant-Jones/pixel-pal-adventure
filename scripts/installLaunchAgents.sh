#!/usr/bin/env bash
#
# scripts/installLaunchAgents.sh
#
# Installs the Guardian launchd jobs and starts them.
#
# This is a thin delegate to `guardian`, which is the command you actually
# use. It is kept as a file because the earlier name was in someone's notes
# and because "install the jobs" is a useful thing to say on its own.
#
# Usage:
#   ./scripts/installLaunchAgents.sh          install and start everything
#   ./scripts/installLaunchAgents.sh --remove stop everything and uninstall
#
# It has to run OUTSIDE the agent's sandbox, because it writes to
# ~/Library/LaunchAgents. From inside the sandbox the write is refused and
# the bootstrap fails with a permissions error that says nothing useful.
#
# The `guardian` command itself is installed into ~/.local/bin, which is
# already on your PATH, so after one run the whole thing is just:
#
#     guardian

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

exec "$ROOT/scripts/guardian.sh" "$@"
