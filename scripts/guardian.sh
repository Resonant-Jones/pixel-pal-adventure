#!/usr/bin/env bash
#
# scripts/guardian.sh
#
# The `guardian` command.
#
# Brings the whole stack up and leaves it up:
#
#   SurrealDB   8001   the memory
#   Paper      25565   the world   (+ Bedrock on UDP 19132)
#   Guardian    8787   the companion in the world and the control plane
#   Console     8788   the voice link and the Memory panel
#
# It is idempotent: anything already listening is left alone, and anything
# that is not running is started. Run it as often as you like.
#
#   guardian              bring everything up, then print the status
#   guardian --status     just print the status
#   guardian --stop       stop the four services
#   guardian --restart    stop them and bring them up again
#
# WHY FOUR LAUNCHD JOBS AND NOT ONE PROCESS
#
# The world has to keep running when this terminal closes, and it has to
# keep running when a coding session ends. So every piece is a launchd job
# in the GUI session, not a child of this script. `launchctl submit` no
# longer works on macOS 27.2, so these are real plists.
#
# The order matters: SurrealDB first (the agent connects to it at startup),
# then Paper (the agent joins the world), then the agent, then the console.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOMAIN="gui/$(id -u)"
AGENTS_DIR="$HOME/Library/LaunchAgents"

SURREAL_PORT=8001
MC_PORT=25565
CONTROL_PORT=8787
CONSOLE_PORT=8788
BEDROCK_PORT=19132

LABELS=("com.guardian.surreal" "com.guardian.paper" "com.guardian.agent" "com.guardian.companion" "com.guardian.pilot" "com.guardian.bedrockwatch")

C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_CYAN=$'\033[36m'; C_RED=$'\033[31m'

say()  { printf '%s\n' "$*"; }
log()  { printf '%s[guardian]%s %s\n' "$C_DIM" "$C_RESET" "$*"; }
ok()   { printf '%s[guardian]%s %s✓%s %s\n' "$C_DIM" "$C_RESET" "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s[guardian]%s %s!%s %s\n' "$C_DIM" "$C_RESET" "$C_YELLOW" "$C_RESET" "$*"; }
fail() { printf '%s[guardian]%s %s✗%s %s\n' "$C_DIM" "$C_RESET" "$C_RED" "$C_RESET" "$*" >&2; }

# Is something listening on this port?
source "$ROOT/scripts/portwait.sh"

port_open() {
  port_is_open "$1"
}

# A service is only "already up" if its port stays up. A bound port can be
# a server that is still dying, and reporting that as healthy leaves the
# stack with nothing serving it.
service_is_healthy() {
  port_stays_open "$1" 3
}

wait_for_port() {
  # Each on its own line, on purpose. In a single `local a=1 b=$((a+1))`,
  # every right-hand side is expanded BEFORE any assignment happens, so the
  # arithmetic sees the OUTER value — and with `set -u` an unset outer
  # variable is a fatal "timeout: unbound variable". That one line took the
  # whole command down on its very first wait.
  local port="$1"
  local label="$2"
  local timeout="${3:-90}"
  local deadline=$(( SECONDS + timeout ))

  while [ $SECONDS -lt $deadline ]; do
    if port_open "$port"; then
      return 0
    fi
    sleep 1
  done

  return 1
}

# Is this launchd job loaded?
job_loaded() {
  launchctl print "$DOMAIN/$1" >/dev/null 2>&1
}

install_plists() {
  mkdir -p "$AGENTS_DIR" "$ROOT/.local/logs"

  for label in "${LABELS[@]}"; do
    local src="$ROOT/scripts/$label.plist"
    local dst="$AGENTS_DIR/$label.plist"

    if [ ! -f "$src" ]; then
      warn "missing $src — skipping $label"
      continue
    fi

    # Written every run, so a moved checkout or an edited plist takes effect
    # on the next `guardian`.
    cp "$src" "$dst"
  done
}

# Make sure the job is LOADED, without disturbing anything that is running.
#
# A job that is loaded but stood down (its wrapper exited cleanly because
# something else was already serving the port) still comes back at next
# login, which is the whole point of installing it. So the job is always
# bootstrapped — but it is never kicked while something is healthy, because
# that would drop Guardian out of the world and back in for no reason.
ensure_job_loaded() {
  local label="$1"

  if ! job_loaded "$label"; then
    launchctl bootstrap "$DOMAIN" "$AGENTS_DIR/$label.plist" >/dev/null 2>&1 || {
      fail "could not bootstrap $label"
      return 1
    }
  fi

  launchctl enable "$DOMAIN/$label" >/dev/null 2>&1 || true
}

# Start a job that is not currently serving its port.
start_job() {
  local label="$1"

  ensure_job_loaded "$label" || return 1
  launchctl kickstart -k "$DOMAIN/$label" >/dev/null 2>&1 || true
}

stop_job() {
  local label="$1"
  launchctl bootout "$DOMAIN/$label" >/dev/null 2>&1 || true
  say "  stopped $label"
}

# The `guardian` command itself, on the PATH.
install_shim() {
  local shim="$HOME/.local/bin/guardian"

  mkdir -p "$HOME/.local/bin"

  if [ -f "$shim" ] && grep -q "minecraft-ai-companion" "$shim" 2>/dev/null; then
    return 0
  fi

  cat > "$shim" <<EOF
#!/bin/sh
# The guardian command — starts the Minecraft companion stack.
exec "$ROOT/scripts/guardian.sh" "\$@"
EOF

  chmod +x "$shim"
  ok "installed the guardian command (~/.local/bin/guardian)"
}

# The address the iPad should be pointed at.
#
# `ipconfig getifaddr` is not usable here — it fails with an os/kern error
# from a sandboxed shell — so this asks node, which reads the same
# interfaces without needing the privileged helper. A VPN interface (utun)
# is not the answer; en0 is.
lan_address() {
  node -e '
    const os = require("os");
    const interfaces = os.networkInterfaces();
    const first = (name) => {
      for (const entry of interfaces[name] || []) {
        if (entry.family === "IPv4" && !entry.internal) return entry.address;
      }
      return null;
    };

    const preferred = first("en0") || first("en1");
    if (preferred) {
      process.stdout.write(preferred);
      process.exit(0);
    }

    for (const [name, entries] of Object.entries(interfaces)) {
      if (name.startsWith("utun") || name.startsWith("awdl") || name.startsWith("llw")) continue;
      for (const entry of entries || []) {
        if (entry.family === "IPv4" && !entry.internal) {
          process.stdout.write(entry.address);
          process.exit(0);
        }
      }
    }
  ' 2>/dev/null
}

# What the AGENT sees of the world: in_world, locked_out, recovering, unknown.
#
# The rule lives in scripts/worldState.js and is asked by running it. It was
# written inline here once and the two copies disagreed — this one looked for
# a connectionHealth of "connected", which the agent never reports, so the
# "the world is serving" branch could never fire.
agent_world_state() {
  local token
  token="$(grep -m1 '^GUARDIAN_CONTROL_TOKEN=' "$ROOT/.env" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'")"

  if [ -n "$token" ]; then
    GUARDIAN_CONTROL_TOKEN="$token" node "$ROOT/scripts/worldState.js" 2>/dev/null
  else
    node "$ROOT/scripts/worldState.js" 2>/dev/null
  fi
}

print_status() {
  local lan
  lan="$(lan_address)"

  say ""
  say "${C_BOLD}${C_CYAN}  Guardian is live.${C_RESET}"
  say ""

  local state
  for entry in "SurrealDB:$SURREAL_PORT" "Minecraft:$MC_PORT" "Guardian:$CONTROL_PORT" "Console:$CONSOLE_PORT"; do
    state="${entry%%:*}"; local port="${entry##*:}"
    if port_open "$port"; then
      ok "$(printf '%-11s' "$state") http://127.0.0.1:$port"
    else
      warn "$(printf '%-11s' "$state") not running (port $port)"
    fi
  done

  # The Bedrock watcher has no port, so it does not fit the loop above. It
  # gets its own line anyway: it is the difference between watching for the
  # iPad and not watching for it, and "not running" is worth saying out loud.
  if job_loaded "com.guardian.bedrockwatch"; then
    ok "$(printf '%-11s' "Bedrock") watcher running — waiting for the iPad to join"
  else
    warn "$(printf '%-11s' "Bedrock") watcher not running"
  fi

  say ""
  say "  ${C_BOLD}Java / desktop${C_RESET}"
  say "    connect to  ${C_CYAN}127.0.0.1:$MC_PORT${C_RESET}"

  # Is the world actually SERVING, or just holding the port?
  #
  # A Minecraft server can stop ticking without exiting. Its JVM stays
  # alive, the port stays open, and a status ping answers perfectly — while
  # not a single player can get in. A port check cannot tell that apart
  # from a healthy server.
  #
  # The agent can: it is a player, it is trying to get in, and it reports
  # the difference. So the status line below is the agent's view of the
  # world, not a guess from the outside.
  local world_state
  world_state="$(agent_world_state)"

  case "$world_state" in
    in_world)
      ok "the world is serving — Guardian is in it"
      ;;
    locked_out)
      fail "the world is NOT serving — Guardian gave up trying to get in."
      say "    ${C_DIM}The server has stopped ticking. The pilot will restart it;${C_RESET}"
      say "    ${C_DIM}or run 'guardian --restart' now.${C_RESET}"
      ;;
    recovering)
      warn "Guardian is still trying to get in — the world may be starting up."
      ;;
    unknown)
      warn "could not tell whether the world is serving — the agent did not answer"
      ;;
  esac

  say ""
  say "  ${C_BOLD}Bedrock / iPad${C_RESET}"
  if [ -n "$lan" ]; then
    say "    Servers → Add Server → ${C_CYAN}$lan${C_RESET}  port ${C_CYAN}$BEDROCK_PORT${C_RESET}"
    say "    ${C_DIM}via Geyser + Floodgate. No Java account needed.${C_RESET}"
  else
    say "    ${C_YELLOW}No LAN address found — the iPad cannot be told where to connect.${C_RESET}"
  fi

  say ""
  say "  ${C_DIM}guardian --status    what is running${C_RESET}"
  say "  ${C_DIM}guardian --stop      stop it all${C_RESET}"
  say ""
}

bring_up() {
  install_shim
  install_plists

  # SurrealDB. The agent connects to it at startup, so it goes first.
  if service_is_healthy "$SURREAL_PORT"; then
    ok "SurrealDB already up on $SURREAL_PORT — leaving it alone."
    ensure_job_loaded "com.guardian.surreal"
  else
    log "starting SurrealDB…"
    start_job "com.guardian.surreal"
    if wait_for_port "$SURREAL_PORT" "SurrealDB" 45; then
      ok "SurrealDB up on $SURREAL_PORT."
    else
      fail "SurrealDB did not come up. See $ROOT/.local/logs/surreal.log"
      return 1
    fi
  fi

  # The world. Paper takes 20-60 seconds to boot.
  #
  # A PORT CHECK IS NOT ENOUGH HERE. A server whose main thread has stopped
  # ticking holds the port and answers status pings perfectly, while
  # turning every player away. So when the agent is already running and
  # says it is locked out, the world is broken — and the port check is
  # overruled.
  #
  # "unknown" means the agent is not up yet, which is the normal case
  # during a cold start, and the port check is all there is to go on.
  local world_state
  world_state="$(agent_world_state)"

  if [ "$world_state" = "locked_out" ]; then
    warn "the world is holding its port but not serving — restarting it."
    start_job "com.guardian.paper"
    if wait_for_port "$MC_PORT" "Minecraft" 150; then
      ok "Minecraft server restarted on $MC_PORT."
    else
      fail "The Minecraft server did not come back up. See $ROOT/.local/logs/paper.log"
      return 1
    fi
  elif service_is_healthy "$MC_PORT"; then
    ok "Minecraft server already up on $MC_PORT — leaving it alone."
    ensure_job_loaded "com.guardian.paper"
  else
    log "starting the Minecraft server (this takes 30-60s)…"
    start_job "com.guardian.paper"
    if wait_for_port "$MC_PORT" "Minecraft" 150; then
      ok "Minecraft server up on $MC_PORT."
    else
      fail "The Minecraft server did not come up. See $ROOT/.local/logs/paper.log"
      return 1
    fi
  fi

  # The agent in the world.
  if service_is_healthy "$CONTROL_PORT"; then
    ok "Guardian already up on $CONTROL_PORT — leaving it alone."
    ensure_job_loaded "com.guardian.agent"
  else
    log "starting Guardian…"
    start_job "com.guardian.agent"
    if wait_for_port "$CONTROL_PORT" "Guardian" 60; then
      ok "Guardian up on $CONTROL_PORT."
    else
      fail "Guardian did not come up. See $ROOT/.local/logs/agent.log"
      return 1
    fi
  fi

  # The console.
  if service_is_healthy "$CONSOLE_PORT"; then
    ok "Console already up on $CONSOLE_PORT — leaving it alone."
    ensure_job_loaded "com.guardian.companion"
  else
    log "starting the console…"
    start_job "com.guardian.companion"
    if wait_for_port "$CONSOLE_PORT" "Console" 45; then
      ok "Console up on $CONSOLE_PORT."
    else
      fail "The console did not come up. See $ROOT/.local/logs/companion.log"
      return 1
    fi
  fi

  # The pilot: the thing that notices when the world stops serving.
  #
  # It goes last on purpose. It watches the agent, so it has nothing to say
  # until the agent is up — and it is the one job here that can restart
  # another one, so it wants everything else settled first.
  ensure_job_loaded "com.guardian.pilot"
  launchctl kickstart -k "$DOMAIN/com.guardian.pilot" >/dev/null 2>&1 || true
  ok "Pilot watching — it restarts the world if the agent gets locked out."

  # The Bedrock watcher: it waits for the iPad to join.
  #
  # It goes last with the pilot for the same kind of reason — it only has
  # something to say once the world is up. It never touches the world; it
  # only reads the server log, and it says so every thirty seconds so that
  # "nothing happened" is distinguishable from "it stopped watching".
  ensure_job_loaded "com.guardian.bedrockwatch"
  launchctl kickstart -k "$DOMAIN/com.guardian.bedrockwatch" >/dev/null 2>&1 || true
  ok "Bedrock watcher running — it will log the moment the iPad tries to join."
}

stop_all() {
  say ""
  log "stopping…"
  for label in "${LABELS[@]}"; do
    stop_job "$label"
  done
  say ""
}

# Stop everything and uninstall the jobs. The `guardian` command itself is
# left in place — it is two lines, and leaving it means putting the stack
# back is just `guardian` again.
remove_all() {
  stop_all
  log "uninstalling the launchd jobs…"
  for label in "${LABELS[@]}"; do
    rm -f "$AGENTS_DIR/$label.plist"
    say "  removed $label.plist"
  done
  say ""
  say "  the guardian command is still in ~/.local/bin/guardian — run it to put it back."
  say ""
}

case "${1:-}" in
  --status)
    print_status
    ;;
  --stop)
    stop_all
    ;;
  --remove)
    remove_all
    ;;
  --restart)
    stop_all
    bring_up
    print_status
    ;;
  ""|--start)
    bring_up
    print_status
    ;;
  -h|--help)
    sed -n '4,30p' "$0" | sed 's/^# \{0,1\}//'
    ;;
  *)
    fail "unknown option: $1"
    say "try: guardian --status | --stop | --restart"
    exit 1
    ;;
esac
