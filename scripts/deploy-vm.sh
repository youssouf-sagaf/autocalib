#!/usr/bin/env bash
# Pull GHCR image and restart autocalib on the VM (Plan A).
# Scaffold — run manually after CI/CD setup: docs/deploy/README.md
#
# Usage:
#   IMAGE_TAG=staging-abc1234 ./scripts/deploy-vm.sh staging
#   IMAGE_TAG=prod-abc1234    ./scripts/deploy-vm.sh prod
set -euo pipefail

ENVIRONMENT="${1:?Usage: deploy-vm.sh staging|prod}"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

IMAGE_TAG="${IMAGE_TAG:?Set IMAGE_TAG (e.g. staging-abc1234 or prod-abc1234)}"
GHCR_IMAGE="${GHCR_IMAGE:-ghcr.io/REPLACE_ORG/autocalib}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

case "$ENVIRONMENT" in
  staging)
    SERVICE=autocalib-staging
    HEALTH_PORT=8001
    ;;
  prod)
    SERVICE=autocalib-prod
    HEALTH_PORT=8000
    ;;
  *)
    echo "Unknown environment: $ENVIRONMENT (expected staging|prod)" >&2
    exit 1
    ;;
esac

echo "[deploy] ${ENVIRONMENT}: ${GHCR_IMAGE}:${IMAGE_TAG}"

export GHCR_IMAGE IMAGE_TAG

docker compose -f "$COMPOSE_FILE" pull "$SERVICE"
docker compose -f "$COMPOSE_FILE" up -d "$SERVICE"

echo "[deploy] Waiting for health on :${HEALTH_PORT}…"
for _ in $(seq 1 60); do
  if curl -sf "http://localhost:${HEALTH_PORT}/health" >/dev/null 2>&1; then
    echo "[deploy] OK — ${ENVIRONMENT} healthy"
    exit 0
  fi
  sleep 5
done

echo "[deploy] Health check timed out (ML prewarm may need up to 10 min on cold start)" >&2
docker compose -f "$COMPOSE_FILE" ps "$SERVICE"
exit 1
