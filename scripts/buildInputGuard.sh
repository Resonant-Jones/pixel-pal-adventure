#!/usr/bin/env bash
#
# scripts/buildInputGuard.sh
#
# Compiles the microphone watchdog.
#
# The watchdog is a small Swift program because it has to ask CoreAudio
# directly — ffmpeg can list input devices but cannot *set* the system
# default, and the thing we need to set is the system default.
#
# Usage:  ./scripts/buildInputGuard.sh
#
# It lands in .local/bin/, which is gitignored, because a compiled binary
# does not belong in the repository.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$ROOT/companion/guardDefaultInput.swift"
OUT_DIR="$ROOT/.local/bin"
OUT="$OUT_DIR/guard-default-input"

if ! command -v swiftc >/dev/null 2>&1; then
  echo "swiftc is not on PATH — install the Xcode command line tools." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

# The build writes temporary files into TMPDIR, and the sandbox that runs
# this script may not have a writable one. Point it at the project instead.
export TMPDIR="${TMPDIR_OVERRIDE:-$ROOT/.local/tmp}"
mkdir -p "$TMPDIR"

swiftc -O -o "$OUT" "$SOURCE"

echo "built $OUT"
"$OUT" --list || true
