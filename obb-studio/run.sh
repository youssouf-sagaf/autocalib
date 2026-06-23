#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$ROOT/.." && pwd)"
FRONTEND_DIR="$ROOT/frontend"
ENV_FILE="$ROOT/.env"
ROOT_ENV="$REPO_ROOT/.env"

PURPLE='\033[0;35m'
GREEN='\033[0;32m'
GRAY='\033[0;90m'
NC='\033[0m'

log() { echo -e "${PURPLE}[obb-studio]${NC} $1"; }

cleanup() {
  log "Shutting down…"
  [ -n "${BACKEND_PID:-}" ] && kill "$BACKEND_PID" 2>/dev/null || true
  [ -n "${FRONTEND_PID:-}" ] && kill "$FRONTEND_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  log "Done."
}
trap cleanup EXIT INT TERM

# Python: prefer obb-studio venv, else repo .venv, else PATH
if [[ -f "$ROOT/.venv/bin/activate" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT/.venv/bin/activate"
elif [[ -f "$REPO_ROOT/.venv/bin/activate" ]]; then
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.venv/bin/activate"
fi

export PYTHONPATH="${ROOT}:${REPO_ROOT}:${PYTHONPATH:-}"

if [[ -f "$ROOT_ENV" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_ENV"
  set +a
  log "Loaded env from $ROOT_ENV"
fi
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ENV_FILE"
  set +a
  log "Loaded env from $ENV_FILE"
fi

# Frontend Mapbox token (Vite) from backend imagery token if unset
export VITE_MAPBOX_TOKEN="${VITE_MAPBOX_TOKEN:-${IMAGERY_MAPBOX_ACCESS_TOKEN:-}}"

PORT="${OBB_STUDIO_API_PORT:-8100}"
FE_PORT="${OBB_STUDIO_FE_PORT:-5174}"

lsof -ti:"$PORT" | xargs kill -9 2>/dev/null || true
lsof -ti:"$FE_PORT" | xargs kill -9 2>/dev/null || true
sleep 0.5

log "Starting API on ${GREEN}http://localhost:${PORT}${NC}"
uvicorn app.api.main:app --host 0.0.0.0 --port "$PORT" \
  2>&1 | sed "s/^/  ${GRAY}[api]${NC} /" &
BACKEND_PID=$!

for _ in $(seq 1 30); do
  if curl -sf "http://localhost:${PORT}/health" >/dev/null 2>&1; then
    log "API ready ✓"
    break
  fi
  sleep 0.5
done

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  log "Installing frontend dependencies…"
  (cd "$FRONTEND_DIR" && npm install)
fi

log "Starting frontend on ${GREEN}http://localhost:${FE_PORT}${NC}"
(
  cd "$FRONTEND_DIR"
  export VITE_API_BASE_URL="http://localhost:${PORT}"
  npx vite --host --port "$FE_PORT" --open
) 2>&1 | sed "s/^/  ${GRAY}[web]${NC} /" &
FRONTEND_PID=$!

echo ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "  API      → ${GREEN}http://localhost:${PORT}${NC}"
log "  Frontend → ${GREEN}http://localhost:${FE_PORT}${NC}"
log "  Docs     → http://localhost:${PORT}/docs"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "Press Ctrl+C to stop all services"
echo ""

wait
