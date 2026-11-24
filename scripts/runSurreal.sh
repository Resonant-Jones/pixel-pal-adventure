#!/usr/bin/env bash
#
# scripts/runSurreal.sh
#
# SurrealDB, in the foreground, as a launchd job.
#
# WHY FOREGROUND
#
# A launchd job supervises one process. If this script backgrounded Surreal
# and exited, launchd would see the job exit and — with KeepAlive — restart
# it, which would start a second Surreal against the same data directory and
# the same port. So Surreal is the process launchd is watching.
#
# WHY IT CHECKS THE PORT FIRST
#
# If something is already serving 8001, this exits cleanly rather than
# fighting for the port. The job is configured to restart only after a
# FAILED exit, so a clean exit leaves the job stopped and the other server
# in charge. Without that, two launchd jobs would take turns killing each
# other.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PATH="/opt/homebrew/bin:/Users/resonant_jones/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

SURREAL_PORT="${SURREAL_PORT:-8001}"

# Wait for the port to be free before deciding somebody else owns it — the
# previous database is often still shutting down. See scripts/portwait.sh.
source "$ROOT/scripts/portwait.sh"

if ! wait_for_port_free "$SURREAL_PORT" 30; then
  echo "surreal: something is still serving $SURREAL_PORT — leaving it alone."
  exit 0
fi

mkdir -p "$ROOT/.local/logs" "$ROOT/.local/guardian-memory"

exec surreal start \
  --bind "127.0.0.1:$SURREAL_PORT" \
  --user root \
  --pass secret \
  --default-namespace minecraft \
  --default-database companion \
  "surrealkv://$ROOT/.local/guardian-memory"
