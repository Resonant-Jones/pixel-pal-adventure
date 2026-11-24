#!/usr/bin/env bash
# scripts/portwait.sh
#
# Shared by the service wrappers. Sourced, not executed.
#
# WHY THIS EXISTS
#
# Every wrapper asks the same question before it starts: "is somebody already
# serving my port?" The naive answer — yes, so stand down — is wrong in one
# very common case: the previous instance is still shutting down and has not
# released the port yet.
#
# That race is not theoretical. Stopping the world and immediately starting
# it again produced exactly this: the new job found 25565 still open, stood
# down cleanly, and then the old server died — leaving nothing serving the
# port at all, with a launchd job that had already given up.
#
# So: wait for the port to be RELEASED before deciding somebody else owns it.
# If it frees up, start. If it is still held after the wait, then it really
# is another server and standing down is right.

# Is something listening on this TCP port?
port_is_open() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1
}

# Wait for a port to be free, then report whether it is free.
#
#   wait_for_port_free <port> [seconds]
#
# Returns 0 when the port is free (or became free), 1 when it is still held.
wait_for_port_free() {
  local port="$1"
  local timeout="${2:-30}"
  local waited=0

  while [ "$waited" -lt "$timeout" ]; do
    if ! port_is_open "$port"; then
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done

  return 1
}

# Is a port open AND staying open?
#
#   port_stays_open <port> [seconds]
#
# A bound port is not the same as a healthy service: the previous instance
# of a server can still hold its port for a second or two while it dies.
# A port that stays open for a few seconds is a live service; one that
# closes during the window is a corpse, and the caller should start a
# replacement rather than report "already up".
port_stays_open() {
  local port="$1"
  local seconds="${2:-3}"
  local waited=0

  while [ "$waited" -lt "$seconds" ]; do
    if ! port_is_open "$port"; then
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done

  return 0
}
