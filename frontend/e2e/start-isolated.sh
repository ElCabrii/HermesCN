#!/usr/bin/env bash
# Start an isolated backend + Vite dev server for the Playwright E2E suite.
#
# The backend runs on a non-default port with a unique temporary state
# directory so the suite never touches real user state. The Vite dev server
# proxies /api, /static, /health to that backend.
#
# Usage: e2e/start-isolated.sh
#   (run from the repo root; the frontend must already have `pnpm install`)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FRONTEND="$ROOT/frontend"

# Unique temporary state for this run.
E2E_HOME="$(mktemp -d /tmp/hermes-e2e-home.XXXXXX)"
E2E_STATE="$(mktemp -d /tmp/hermes-e2e-state.XXXXXX)"
E2E_PORT="${HERMES_E2E_PORT:-8790}"
VITE_PORT="${HERMES_E2E_VITE_PORT:-5173}"

echo "[e2e] backend home: $E2E_HOME"
echo "[e2e] backend state: $E2E_STATE"
echo "[e2e] backend port: $E2E_PORT"

# Start the Python backend with isolated state.
HERMES_HOME="$E2E_HOME" \
HERMES_WEBUI_STATE_DIR="$E2E_STATE" \
HERMES_WEBUI_PORT="$E2E_PORT" \
  python3 "$ROOT/server.py" > /tmp/hermes-e2e-backend.log 2>&1 &
BACKEND_PID=$!

# Wait for /health.
for _ in $(seq 1 30); do
  if curl -s -o /dev/null "http://127.0.0.1:$E2E_PORT/health"; then
    break
  fi
  sleep 1
done

# Start the Vite dev server proxying to the isolated backend.
cd "$FRONTEND"
HERMES_WEBUI_PROXY_TARGET="http://127.0.0.1:$E2E_PORT" \
  pnpm dev --host 127.0.0.1 --port "$VITE_PORT" > /tmp/hermes-e2e-vite.log 2>&1 &
VITE_PID=$!

# Forward signals so playwright can tear both down.
trap 'kill "$BACKEND_PID" "$VITE_PID" 2>/dev/null || true' EXIT INT TERM

wait "$VITE_PID"
