#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$ROOT_DIR/.venv"
ENV_FILE="$ROOT_DIR/.env"

# Colors
PURPLE='\033[0;35m'
GREEN='\033[0;32m'
GRAY='\033[0;90m'
NC='\033[0m'

log() { echo -e "${PURPLE}[autoabsmap]${NC} $1"; }

# ---------- Cleanup on exit ----------
cleanup() {
    log "Shutting down…"
    [ -n "${BACKEND_PID:-}" ] && kill "$BACKEND_PID" 2>/dev/null
    [ -n "${FRONTEND_PID:-}" ] && kill "$FRONTEND_PID" 2>/dev/null
    wait 2>/dev/null
    log "Done."
}
trap cleanup EXIT INT TERM

# ---------- Pre-checks ----------
if [ ! -d "$VENV_DIR" ]; then
    echo "ERROR: .venv not found at $VENV_DIR" >&2; exit 1
fi

# shellcheck source=/dev/null
source "$VENV_DIR/bin/activate"
log "Python: $(python --version 2>&1)"

# Load root .env into shell environment (backend settings)
if [ -f "$ENV_FILE" ]; then
    set -a; source "$ENV_FILE"; set +a
    log "Loaded env from $ENV_FILE"
fi

# Pipeline uses PyTorch only — prevent transformers from loading broken TF
export USE_TF=0
export USE_TORCH=1

# ---------- Kill stale processes ----------
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
sleep 0.5

# ---------- Backend ----------
log "Starting backend on ${GREEN}http://localhost:8000${NC}"
PYTHONPATH="$ROOT_DIR:$ROOT_DIR/autoabsmap-api" \
    uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload \
    --reload-dir "$ROOT_DIR/autoabsmap-api" \
    --reload-dir "$ROOT_DIR/autoabsmap" \
    2>&1 | sed "s/^/  ${GRAY}[api]${NC} /" &
BACKEND_PID=$!

# Wait for backend to be ready
for i in $(seq 1 20); do
    if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
        log "Backend ready ✓"
        break
    fi
    sleep 0.5
done

# ---------- Frontend ----------
log "Starting frontend on ${GREEN}http://localhost:5173${NC}"
cd "$ROOT_DIR/autoabsmap-frontend"
npx vite --host 2>&1 | sed "s/^/  ${GRAY}[web]${NC} /" &
FRONTEND_PID=$!

# ---------- Ready ----------
echo ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "  Backend  → ${GREEN}http://localhost:8000${NC}"
log "  Frontend → ${GREEN}http://localhost:5173${NC}"
log "  Health   → http://localhost:8000/health"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "  ${GRAY}Logs:${NC}"
log "    backend  → logs/backend.log"
log "    requests → logs/requests.log"
log "    frontend → logs/front.log"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "Press Ctrl+C to stop all services"
echo ""

wait
