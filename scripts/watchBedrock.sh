#!/usr/bin/env bash
#
# scripts/watchBedrock.sh
#
# Watch the live server for anything Bedrock-shaped, and prove you are alive
# while you wait.
#
# WHY THIS IS ITS OWN JOB
#
# The crossplay question — "can the son's iPad actually join the world?" —
# has never been answered, because the iPad has never joined. Every attempt
# so far has been a person opening Minecraft on the device and watching.
#
# That is fine until the watching has to outlive a session. This started as a
# background task in an agent session, which died every hour and had to be
# re-armed. A watcher whose lifetime is shorter than the thing it is
# waiting for is not a watcher.
#
# IT SAYS WHEN IT IS ALIVE
#
# The first version wrote to stdout only, so a pipeline that died at startup
# looked exactly like a server that never received a connection. For a thing
# whose whole job is to tell you "nothing happened", that is a bad property.
# It cannot tell you nothing happened unless it can also tell you it is
# still watching. So: every match is appended to the log, and a heartbeat
# line is appended every 30 seconds. A gap in the heartbeat is itself
# evidence.
#
# Usage:  bash scripts/watchBedrock.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/minecraft-server/logs/latest.log"
OUT="$ROOT/.local/logs/bedrock-watch.log"

# Bedrock-specific lines, plus anything that says a player joined or left.
# "Geyser" and "Floodgate" cover the bridge's own refusals, which are the
# interesting ones: they say WHY a client was turned away.
PAT='Geyser|Floodgate|floodgate|Bedrock|Panda_Nuggetz|joined the game|logged in with entity|Proxy|disconnect'

mkdir -p "$(dirname "$OUT")"

say() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$OUT"; }

if [ ! -f "$SRC" ]; then
  say "WATCHER START — $SRC does not exist yet; waiting for it"
fi

say "WATCHER START — tailing $SRC"
say "WATCHER START — pattern: $PAT"

cleanup() {
  say "WATCHER STOP"
}
trap cleanup EXIT INT TERM

# The heartbeat runs on its own clock so it keeps ticking whether or not
# anything matches, and so a dead tail shows up as a heartbeat gap.
(
  while true; do
    sleep 30
    say "HEARTBEAT — watcher alive"
  done
) &
HEARTBEAT=$!

# `tail -F` follows the file through Paper's log rotation, so the watcher
# survives a server restart.
tail -n 0 -F "$SRC" 2>>"$OUT" | grep --line-buffered -iE "$PAT" | while IFS= read -r line; do
  say "MATCH — $line"
done

kill "$HEARTBEAT" 2>/dev/null
