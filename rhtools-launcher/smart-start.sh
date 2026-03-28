#!/usr/bin/env bash
# Dev: Vite on 5174 + Electron with RHTools Launcher main.
# Run from repo root: ./rhtools-launcher/smart-start.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMPDIR="${TMPDIR:-/tmp}"
LOG="$TMPDIR/rhtools-launcher-vite.log"

echo "Starting Vite for rhtools-launcher..."
(cd "$ROOT/rhtools-launcher" && npm run renderer:dev >"$LOG" 2>&1) &
VITE_PID=$!
sleep 3
PORT=$(grep -oP 'Local:\s+http://localhost:\K\d+' "$LOG" | head -1 || true)
if [[ -z "${PORT:-}" ]]; then
  echo "Could not detect Vite port. Log:"
  cat "$LOG"
  kill "$VITE_PID" 2>/dev/null || true
  exit 1
fi
echo "Vite on port $PORT — starting Electron..."
export ELECTRON_START_URL="http://localhost:$PORT"
(
  cd "$ROOT/rhtools-launcher"
  export ELECTRON_RUN_AS_NODE=
  "$ROOT/node_modules/.bin/electron" . --xdg-portal-required-version=4
) || true
kill "$VITE_PID" 2>/dev/null || true
echo "Done."
