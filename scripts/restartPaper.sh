#!/usr/bin/env bash
#
# Gracefully restart Paper so newly-dropped plugins load, then bring the stack
# back up.
#
# Why this exists: Paper is spawned detached with stdin ignored
# (scripts/startStack.js), and RCON is disabled, so there is no way to ask a
# running server to shut itself down. SIGTERM is the only graceful path, and
# the agent sandbox cannot signal that process. So this runs in your own
# Terminal, where the signal is permitted.
#
# SIGTERM is a *graceful* shutdown: Paper flushes chunks and saves the world
# before exiting. A SIGKILL would risk world corruption, so this script refuses
# to escalate.
#
# Usage:
#   ./scripts/restartPaper.sh --dry-run   show what it would do, change nothing
#   ./scripts/restartPaper.sh             stop Paper, wait, relaunch the stack

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT/minecraft-server"
MC_PORT="${PAPER_PORT:-25565}"
DRY_RUN=0

# Resolve one argument at a time and echo it, so an empty expansion is visible
# in the output rather than silently producing an empty loop.
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      sed -n '3,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

say()  { printf '\033[0;36m[restart]\033[0m %s\n' "$1"; }
ok()   { printf '\033[0;32m[restart] ✓\033[0m %s\n' "$1"; }
warn() { printf '\033[0;33m[restart] !\033[0m %s\n' "$1"; }
die()  { printf '\033[0;31m[restart] ✗\033[0m %s\n' "$1" >&2; exit 1; }

paper_pid() {
  # -t gives a bare PID with no header. Guard it: a wedged lsof must not hang.
  timeout 10 lsof -nP -tiTCP:"$MC_PORT" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

port_open() {
  timeout 10 lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

echo ""
say "Paper restart — port $MC_PORT, server dir $SERVER_DIR"

[ -d "$SERVER_DIR" ] || die "no minecraft-server directory at $SERVER_DIR"

PID="$(paper_pid)"

if [ -z "$PID" ]; then
  warn "no Paper listening on $MC_PORT — nothing to stop"
else
  ok "Paper is running as PID $PID"

  if [ "$DRY_RUN" -eq 1 ]; then
    say "would send SIGTERM to PID $PID and wait for a graceful shutdown"
  else
    say "sending SIGTERM (graceful — Paper will save the world before exiting)"
    kill -TERM "$PID" 2>/dev/null || die "could not signal PID $PID — is this your Terminal?"

    say "waiting for shutdown (world save included), up to 120s"
    WAITED=0
    while [ "$WAITED" -lt 120 ]; do
      if ! kill -0 "$PID" 2>/dev/null; then
        break
      fi
      sleep 2
      WAITED=$((WAITED + 2))
      printf '\r[restart]   %ss elapsed…' "$WAITED"
    done
    printf '\r\033[K'

    if kill -0 "$PID" 2>/dev/null; then
      die "Paper (PID $PID) did not exit within 120s. Not escalating to SIGKILL — that risks the world. Check the server terminal."
    fi

    ok "Paper exited cleanly after ${WAITED}s"

    # Confirm the shutdown was graceful rather than a crash-and-restart.
    if tail -n 40 "$SERVER_DIR/logs/latest.log" 2>/dev/null | grep -qiE 'Closing Server|Saving worlds|ThreadedAnvilChunkStorage.*All chunks are saved'; then
      ok "server log confirms a clean save-and-close"
    else
      warn "could not confirm a clean save in the tail of latest.log — worth a glance"
    fi
  fi
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo ""
  say "dry run complete — nothing was changed"
  exit 0
fi

echo ""
say "bringing the stack back up (Guardian runs in the foreground)"
say "Ctrl+C here stops Guardian. Paper and SurrealDB stay detached."
echo ""

cd "$ROOT"
exec node scripts/startStack.js