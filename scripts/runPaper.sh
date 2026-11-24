#!/usr/bin/env bash
#
# scripts/runPaper.sh
#
# The Minecraft server, in the foreground, as a launchd job.
#
# Same shape as runSurreal.sh: launchd supervises one process, so the server
# runs in the foreground and this script checks the port before starting.
#
# OPS ARE WRITTEN HERE, NOT IN THE PLIST
#
# Paper reads ops.json ONCE, at boot. Writing it after the server starts
# does nothing at all — so it has to happen immediately before the spawn, or
# the bot and the player are not operators and cannot build near spawn.
# startStack.js does the same thing for the same reason.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT/minecraft-server"
cd "$ROOT"

export PATH="/opt/homebrew/bin:/Users/resonant_jones/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

MC_PORT="${PAPER_PORT:-25565}"

# Wait for the port to be free before deciding somebody else owns it — the
# previous server is often still shutting down. See scripts/portwait.sh.
source "$ROOT/scripts/portwait.sh"

if ! wait_for_port_free "$MC_PORT" 30; then
  echo "paper: something is still serving $MC_PORT — leaving it alone."
  exit 0
fi

if [ ! -d "$SERVER_DIR" ]; then
  echo "paper: no minecraft-server/ directory — run 'npm run mc:server' once to download the server."
  exit 1
fi

JAR="$(ls -1 "$SERVER_DIR"/paper-*.jar 2>/dev/null | sort | tail -1)"

if [ -z "$JAR" ]; then
  echo "paper: no paper-*.jar in minecraft-server/ — run 'npm run mc:server' once to download the server."
  exit 1
fi

JAVA="$(command -v java || true)"

if [ -z "$JAVA" ]; then
  echo "paper: no 'java' on PATH — install a JDK 17 or newer."
  exit 1
fi

mkdir -p "$ROOT/.local/logs"

# Ops are read once, at boot. This has to happen here, immediately before
# the spawn, and it must never be skipped.
node -e '
  require("dotenv").config({ path: process.argv[1] + "/.env" });
  const { writeOperators } = require(process.argv[1] + "/scripts/serverOperators.js");
  writeOperators({
    serverDir: process.argv[2],
    env: process.env,
    logger: { log: () => {}, warn: (m) => console.warn("[ops]", m) }
  });
' "$ROOT" "$SERVER_DIR"

cd "$SERVER_DIR"

exec "$JAVA" -Xms1G -Xmx2G -jar "$JAR" --nogui
