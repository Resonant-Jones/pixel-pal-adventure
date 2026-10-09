#!/usr/bin/env bash
#
# Read-only check that Bedrock crossplay is actually live.
#
# Installing Geyser and Floodgate is not the same as having them working. This
# answers the question that matters: can a Bedrock client on the iPad reach the
# world right now, and as which username?
#
# This script changes nothing and signals nothing. Safe to run at any time,
# including while the server is up.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT/minecraft-server"
PLUGINS="$SERVER_DIR/plugins"
MC_PORT="${PAPER_PORT:-25565}"
BEDROCK_PORT="${BEDROCK_PORT:-19132}"

PASS=0
FAIL=0

ok()   { printf '\033[0;32m  ✓\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf '\033[0;31m  ✗\033[0m %s\n' "$1"; FAIL=$((FAIL + 1)); }
info() { printf '\033[0;36m  ·\033[0m %s\n' "$1"; }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

echo ""
echo "══════════════════════════════════════════════════════"
echo "  Bedrock crossplay check"
echo "══════════════════════════════════════════════════════"

head_ "1. Plugins on disk"

for jar in Geyser-Spigot.jar floodgate-spigot.jar; do
  if [ -f "$PLUGINS/$jar" ]; then
    ok "$jar present ($(du -h "$PLUGINS/$jar" | cut -f1))"
  else
    bad "$jar missing from $PLUGINS"
  fi
done

head_ "2. Paper is up"

if timeout 10 lsof -nP -iTCP:"$MC_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  ok "Paper listening on $MC_PORT"
else
  bad "nothing listening on $MC_PORT — is the server running?"
fi

head_ "3. Geyser loaded (Bedrock port $BEDROCK_PORT)"

UDP_HITS="$(timeout 10 lsof -nP -iUDP:"$BEDROCK_PORT" 2>/dev/null || true)"
if [ -n "$UDP_HITS" ]; then
  ok "UDP $BEDROCK_PORT is bound"
  printf '%s\n' "$UDP_HITS" | sed 's/^/      /'
else
  bad "nothing bound to UDP $BEDROCK_PORT — Geyser is not listening for Bedrock"
fi

if [ -f "$SERVER_DIR/logs/latest.log" ]; then
  if grep -qiE 'Geyser.*(Listening|started|loaded)|Listening on Bedrock' "$SERVER_DIR/logs/latest.log"; then
    ok "Geyser reports itself started in the server log"
    grep -iE 'Listening on Bedrock|Geyser.*(started|loaded)' "$SERVER_DIR/logs/latest.log" | tail -n 2 | sed 's/^/      /'
  else
    bad "no Geyser startup line in latest.log — did the plugins actually load?"
  fi

  if grep -qiE 'Floodgate.*(started|loaded|key)' "$SERVER_DIR/logs/latest.log"; then
    ok "Floodgate reports itself started"
  else
    bad "no Floodgate startup line in latest.log"
  fi

  if grep -qiE '(ERROR|SEVERE).*(Geyser|Floodgate)' "$SERVER_DIR/logs/latest.log"; then
    warn_lines="$(grep -iE '(ERROR|SEVERE).*(Geyser|Floodgate)' "$SERVER_DIR/logs/latest.log" | tail -n 3)"
    bad "Geyser/Floodgate errors in the log:"
    printf '%s\n' "$warn_lines" | sed 's/^/      /'
  fi
fi

head_ "4. Floodgate key pair"

KEY="$(find "$PLUGINS" -name 'key.pem' -maxdepth 3 2>/dev/null | head -n 1 || true)"
if [ -n "$KEY" ]; then
  ok "key.pem generated at ${KEY#$ROOT/}"
  info "this key is what binds the Bedrock client to this server — treat it as a credential"
else
  bad "no key.pem yet — it is generated on the first boot after installation"
fi

head_ "5. Effective configuration"

GEYSER_CFG="$PLUGINS/Geyser-Spigot/config.yml"
if [ -f "$GEYSER_CFG" ]; then
  ok "Geyser config present"
  AUTH="$(awk '/^remote:/{r=1;next} /^  auth-type:/{if(r){print $2;exit}}' "$GEYSER_CFG" 2>/dev/null)"
  AUTH2="$(awk '/^[a-z-]+:/{sect=$1} /^  auth-type:/{if(sect=="/remote:"||sect=="/java:"){print $2;exit}}' "$GEYSER_CFG" 2>/dev/null)"
  RESOLVED="${AUTH:-${AUTH2:-unknown}}"
  if [ "$RESOLVED" = "floodgate" ]; then
    ok "auth-type is floodgate (Bedrock players need no Java account)"
  else
    bad "auth-type is '$RESOLVED' — should be 'floodgate' for a Bedrock-only player"
  fi
  BP="$(awk '/^bedrock:/{f=1;next} /^  port:/{if(f){print $2;exit}}' "$GEYSER_CFG" 2>/dev/null)"
  if [ -n "$BP" ]; then
    info "Geyser bedrock.port = $BP"
  fi
else
  bad "no Geyser config.yml — the plugin has not completed a boot yet"
fi

FG_CFG="$PLUGINS/floodgate/config.yml"
if [ -f "$FG_CFG" ]; then
  ok "Floodgate config present"
  PREFIX="$(grep -E '^username-prefix:' "$FG_CFG" | head -n 1 | sed -E 's/^username-prefix:[[:space:]]*//' | tr -d '"'"'" | head -n 1)"
  if [ -z "$PREFIX" ]; then
    PREFIX="<empty>"
  fi
  info "username-prefix = '$PREFIX'"
  if [ "$PREFIX" = "<empty>" ]; then
    info "Bedrock names arrive unchanged, matching ops.json and PRIMARY_PLAYER"
  else
    info "Bedrock players arrive as '${PREFIX}<name>' — player lookup tolerates this"
  fi
else
  bad "no Floodgate config.yml"
fi

head_ "6. Address for the iPad"

# `ipconfig getifaddr` is the tidy way to do this but it fails outright in a
# restricted shell, so fall back to parsing ifconfig. Prefer whichever
# non-loopback IPv4 address owns the default route — that is the one the iPad
# can actually reach.
LAN_IP=""
DEFAULT_IFACE="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}' | head -n 1)"

if [ -n "$DEFAULT_IFACE" ]; then
  info "default route goes out $DEFAULT_IFACE"
  LAN_IP="$(ifconfig "$DEFAULT_IFACE" 2>/dev/null | awk '/inet /{print $2;exit}')"
fi

if [ -z "$LAN_IP" ]; then
  LAN_IP="$(ifconfig 2>/dev/null | awk '/inet /{print $2}' | grep -vE '^(127\.|169\.254\.)' | head -n 1)"
fi

if [ -n "$LAN_IP" ]; then
  ok "LAN address: $LAN_IP"
  printf '\n      On the iPad:  Play → Servers → Add Server\n'
  printf '      Server Address: %s\n' "$LAN_IP"
  printf '      Port:           %s\n' "$BEDROCK_PORT"
  printf '\n'
  info "the iPad must be on this same Wi-Fi network"
else
  bad "could not determine a LAN address"
fi

# Tailscale lives in 100.64.0.0/10, which is what distinguishes it from the
# handful of other utun interfaces macOS keeps around.
TS_IP="$(ifconfig 2>/dev/null | grep -oE 'inet 100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9.]+' | awk '{print $2}' | head -n 1)"
if [ -n "$TS_IP" ]; then
  info "Tailscale address $TS_IP also reaches this server from off-LAN"
fi

echo ""
echo "══════════════════════════════════════════════════════"
printf '  %s passed, %s failed\n' "$PASS" "$FAIL"
echo "══════════════════════════════════════════════════════"
echo ""

[ "$FAIL" -eq 0 ] || exit 1