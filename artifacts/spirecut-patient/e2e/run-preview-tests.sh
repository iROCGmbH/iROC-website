#!/usr/bin/env bash
# Builds the app from source, starts vite preview, runs the Playwright
# not-found E2E tests against it, then tears down regardless of outcome.
set -euo pipefail

PREVIEW_PORT=5905
BASE_PATH=/spirecut-patient/

cd "$(dirname "$0")/.."

# Always kill the preview server on exit (success, failure, or signal).
PREVIEW_PID=""
cleanup() {
  if [ -n "$PREVIEW_PID" ]; then
    kill "$PREVIEW_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "=== Building production bundle ==="
PORT=$PREVIEW_PORT BASE_PATH=$BASE_PATH npx vite build --config vite.config.ts

echo "=== Starting vite preview on port $PREVIEW_PORT ==="
PORT=$PREVIEW_PORT BASE_PATH=$BASE_PATH npx vite preview \
  --config vite.config.ts --host 0.0.0.0 --port "$PREVIEW_PORT" &
PREVIEW_PID=$!

# Wait up to 15 s for the preview server to become ready.
READY=0
for i in $(seq 1 15); do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PREVIEW_PORT$BASE_PATH" || true)
  if [ "$HTTP_CODE" = "200" ]; then
    echo "=== Preview server ready (attempt $i) ==="
    READY=1
    break
  fi
  sleep 1
done

if [ "$READY" -ne 1 ]; then
  echo "ERROR: preview server did not become ready in time" >&2
  exit 1
fi

echo "=== Running Playwright tests against vite preview ==="
PLAYWRIGHT_BASE_URL="http://localhost:$PREVIEW_PORT" npx playwright test \
  e2e/not-found-hard-reload.spec.js --reporter=list
