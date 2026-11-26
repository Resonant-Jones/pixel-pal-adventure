#!/usr/bin/env bash
#
# scripts/runBedrockWatch.sh
#
# The Bedrock watcher, in the foreground, as a launchd job.
#
# Same shape as runPilot.sh: launchd gives a job a minimal PATH, so the
# wrapper sets the PATH the other service wrappers use and then execs the
# watcher. The watcher itself is pure bash and needs nothing from PATH, but
# the wrapper keeps the two jobs consistent — and `tail` and `grep` are
# genuinely on the minimal PATH today, which is not a promise anyone should
# rely on forever.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PATH="/opt/homebrew/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

exec /bin/bash "$ROOT/scripts/watchBedrock.sh" "$@"
