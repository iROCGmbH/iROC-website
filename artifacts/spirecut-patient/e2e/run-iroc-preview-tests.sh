#!/usr/bin/env bash
# Builds all iROC web apps, starts their production previews, runs the shared
# hard-reload 404 checks, then tears down every preview server.
set -euo pipefail

IROC_APP_PORT=5906
IROC_PORTAL_PORT=5907
IROC_WEBSITE_PORT=5908
PATIENT_PORT=5905

PREVIEW_PIDS=()

cleanup() {
  for pid in "${PREVIEW_PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

echo "=== Building iROC web apps ==="
PORT=$PATIENT_PORT BASE_PATH=/spirecut-patient/ \
  pnpm --filter @workspace/spirecut-patient run build
PORT=$IROC_APP_PORT BASE_PATH=/iroc-app/ \
  pnpm --filter @workspace/iroc-app run build
PORT=$IROC_PORTAL_PORT BASE_PATH=/iroc-portal/ \
  pnpm --filter @workspace/iroc-portal run build
PORT=$IROC_WEBSITE_PORT BASE_PATH=/ \
  pnpm --filter @workspace/iroc-website run build

start_preview() {
  local package_name="$1"
  local port="$2"
  local base_path="$3"

  PORT="$port" BASE_PATH="$base_path" \
    pnpm --filter "$package_name" exec vite preview \
      --config vite.config.ts --host 0.0.0.0 --port "$port" &
  PREVIEW_PIDS+=("$!")
}

echo "=== Starting iROC production previews ==="
start_preview @workspace/spirecut-patient "$PATIENT_PORT" /spirecut-patient/
start_preview @workspace/iroc-app "$IROC_APP_PORT" /iroc-app/
start_preview @workspace/iroc-portal "$IROC_PORTAL_PORT" /iroc-portal/
start_preview @workspace/iroc-website "$IROC_WEBSITE_PORT" /

wait_for_preview() {
  local port="$1"
  local path="$2"

  for _ in $(seq 1 15); do
    if [ "$(curl -s -o /dev/null -w "%{http_code}" \
      "http://localhost:$port$path" || true)" = "200" ]; then
      return 0
    fi
    sleep 1
  done

  echo "ERROR: preview on port $port did not become ready" >&2
  return 1
}

wait_for_preview "$PATIENT_PORT" /spirecut-patient/
wait_for_preview "$IROC_APP_PORT" /iroc-app/
wait_for_preview "$IROC_PORTAL_PORT" /iroc-portal/
wait_for_preview "$IROC_WEBSITE_PORT" /

echo "=== Running iROC hard-reload 404 checks against direct Vite previews ==="
PLAYWRIGHT_BASE_URL="http://localhost:80" \
  PLAYWRIGHT_APP_BASE_URL="http://localhost:$IROC_APP_PORT" \
  PLAYWRIGHT_APP_DIRECT_PREVIEW="1" \
  PLAYWRIGHT_PORTAL_BASE_URL="http://localhost:$IROC_PORTAL_PORT" \
  PLAYWRIGHT_WEBSITE_BASE_URL="http://localhost:$IROC_WEBSITE_PORT" \
  pnpm --filter @workspace/spirecut-patient exec playwright test \
    --config playwright.config.js e2e/iroc-apps-not-found-hard-reload.spec.js \
    --reporter=list

echo "=== Running mobile startup and PWA checks against direct Vite previews ==="
PLAYWRIGHT_BASE_URL="http://localhost:80" \
  PLAYWRIGHT_WEBSITE_BASE_URL="http://localhost:$IROC_WEBSITE_PORT" \
  PLAYWRIGHT_PATIENT_BASE_URL="http://localhost:$PATIENT_PORT" \
  pnpm --filter @workspace/spirecut-patient exec playwright test \
    --config playwright.config.js e2e/startup-performance.spec.js \
    --reporter=list

echo "=== Running Reports comparison PDF check against direct iROC preview ==="
PLAYWRIGHT_BASE_URL="http://localhost:80" \
  PLAYWRIGHT_APP_BASE_URL="http://localhost:$IROC_APP_PORT" \
  pnpm --filter @workspace/spirecut-patient exec playwright test \
    --config playwright.config.js e2e/reports-print-pdf.spec.js \
    --reporter=list

echo "=== Running iROC hard-reload 404 checks through the mounted artifact paths ==="
# Defaults to Replit's local path router. Set PLAYWRIGHT_MOUNTED_BASE_URL to a
# deployed origin when validating a published deployment instead.
PLAYWRIGHT_MOUNTED_BASE_URL="${PLAYWRIGHT_MOUNTED_BASE_URL:-http://localhost:80}" \
  PLAYWRIGHT_BASE_URL="${PLAYWRIGHT_MOUNTED_BASE_URL:-http://localhost:80}" \
  pnpm --filter @workspace/spirecut-patient exec playwright test \
    --config playwright.config.js e2e/iroc-apps-not-found-hard-reload.spec.js \
    --reporter=list