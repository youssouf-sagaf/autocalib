#!/usr/bin/env bash
# Build autocalib GPU image (Cloud Build) and deploy to Cloud Run (NVIDIA L4).
#
# Prerequisites:
#   - gcloud auth login, project access (default: cv-cocoparks)
#   - .env at repo root (Vite build-args + optional runtime overrides)
#   - Source Cloud Run service for runtime env clone (default: autocalib @ europe-west9)
#
# Usage:
#   ./scripts/deploy-cloudrun-gpu.sh              # build + deploy (use after code changes)
#   ./scripts/deploy-cloudrun-gpu.sh --deploy-only   # redeploy existing image only (no rebuild)
#   ./scripts/deploy-cloudrun-gpu.sh --full       # first deploy or env/GPU config change
#   ./scripts/deploy-cloudrun-gpu.sh --build-only
#
# Overrides:
#   GCP_PROJECT=cv-cocoparks RUN_REGION=europe-west4 SERVICE_NAME=autocalib-gpu
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

GCP_PROJECT="${GCP_PROJECT:-cv-cocoparks}"
RUN_REGION="${RUN_REGION:-europe-west4}"
SERVICE_NAME="${SERVICE_NAME:-autocalib-gpu}"
IMAGE="${IMAGE:-europe-west4-docker.pkg.dev/${GCP_PROJECT}/autocalib/autocalib-gpu:latest}"
ENV_SOURCE_SERVICE="${ENV_SOURCE_SERVICE:-autocalib}"
ENV_SOURCE_REGION="${ENV_SOURCE_REGION:-europe-west9}"
ENV_FILE="${ENV_FILE:-}"

DO_BUILD=true
DO_DEPLOY=true
DEPLOY_MODE="update"

usage() {
  sed -n '2,16p' "$0"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --update)
      DEPLOY_MODE="update"
      shift
      ;;
    --full)
      DEPLOY_MODE="full"
      shift
      ;;
    --build-only)
      DO_DEPLOY=false
      shift
      ;;
    --deploy-only)
      DO_BUILD=false
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "$ROOT_DIR/.env" ]]; then
  echo "[deploy-gpu] Missing .env at repo root (required for Vite build-args)." >&2
  exit 1
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "[deploy-gpu] gcloud CLI not found." >&2
  exit 1
fi

gcloud config set project "$GCP_PROJECT" >/dev/null

build_image() {
  echo "[deploy-gpu] Cloud Build → ${IMAGE}"
  GCP_PROJECT="$GCP_PROJECT" python3 - "$ROOT_DIR/.env" "$IMAGE" <<'PY'
import os
import pathlib
import subprocess
import sys

env_path = pathlib.Path(sys.argv[1])
image = sys.argv[2]
project = os.environ.get("GCP_PROJECT", "cv-cocoparks")
env: dict[str, str] = {}
for line in env_path.read_text().splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    env[key.strip()] = value.strip()

vite_keys = [
    "VITE_MAPBOX_TOKEN",
    "VITE_API_URL",
    "VITE_FIREBASE_API_KEY",
    "VITE_AUTH_DOMAIN",
    "VITE_DATABASE_URL",
    "VITE_PROJECT_ID",
    "VITE_STORAGE_BUCKET",
    "VITE_MESSAGING_SENDER_ID",
    "VITE_ID",
    "VITE_MEASUREMENT_ID",
    "VITE_B2B_BASE_URL",
]
subs = [f"_IMAGE={image}"]
for key in vite_keys:
    subs.append(f"_{key}={env.get(key, '')}")

cmd = [
    "gcloud",
    "builds",
    "submit",
    f"--project={project}",
    "--config=cloudbuild.gpu.yaml",
    f"--substitutions={','.join(subs)}",
    ".",
]
print("[deploy-gpu] gcloud builds submit …")
subprocess.run(cmd, check=True, cwd=env_path.parent)
PY
}

write_env_file() {
  local out="$1"
  echo "[deploy-gpu] Runtime env → ${out} (clone ${ENV_SOURCE_SERVICE}@${ENV_SOURCE_REGION} + GPU overrides)"
  python3 - "$out" "$GCP_PROJECT" "$ENV_SOURCE_SERVICE" "$ENV_SOURCE_REGION" "$ROOT_DIR/.env" <<'PY'
import json
import pathlib
import subprocess
import sys

out_path, project, source_service, source_region, dotenv_path = sys.argv[1:6]

raw = subprocess.check_output(
    [
        "gcloud",
        "run",
        "services",
        "describe",
        source_service,
        f"--region={source_region}",
        f"--project={project}",
        "--format=json",
    ],
    text=True,
)
service = json.loads(raw)
env_map: dict[str, str] = {}
for item in service["spec"]["template"]["spec"]["containers"][0].get("env", []):
    name = item.get("name")
    if not name:
        continue
    if "value" in item:
        env_map[name] = item["value"]
    # Skip secret refs — keep only plain values from the source service.

# Optional overrides from local .env (runtime keys only, not VITE_*).
dotenv: dict[str, str] = {}
for line in pathlib.Path(dotenv_path).read_text().splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    key, value = key.strip(), value.strip()
    if key.startswith("VITE_"):
        continue
    dotenv[key] = value
env_map.update(dotenv)

# GPU service defaults
env_map["SAM3_DEVICE_PREFERENCE"] = "cuda"
env_map["SAM3_DEVICE"] = "cuda"
env_map["PREWARM_ML_MODELS"] = "true"
env_map["HF_HOME"] = "/root/.cache/huggingface"

try:
    import yaml  # type: ignore
except ImportError:
    # PyYAML is optional; write a minimal YAML file manually.
    lines = []
    for key, value in env_map.items():
        escaped = value.replace("\\", "\\\\").replace('"', '\\"')
        lines.append(f'{key}: "{escaped}"')
    pathlib.Path(out_path).write_text("\n".join(lines) + "\n")
else:
    pathlib.Path(out_path).write_text(yaml.safe_dump(env_map, sort_keys=False))
PY
}

deploy_service_update() {
  echo "[deploy-gpu] Cloud Run update → ${SERVICE_NAME} (image only, env unchanged)"
  gcloud run deploy "$SERVICE_NAME" \
    --project="$GCP_PROJECT" \
    --region="$RUN_REGION" \
    --image="$IMAGE"

  print_service_url_and_health
}

deploy_service_full() {
  local env_yaml
  env_yaml="$(mktemp)"
  trap 'rm -f "$env_yaml"' RETURN

  if [[ -n "$ENV_FILE" ]]; then
    env_yaml="$ENV_FILE"
    echo "[deploy-gpu] Using env file: ${env_yaml}"
  else
    write_env_file "$env_yaml"
  fi

  echo "[deploy-gpu] Cloud Run deploy (full) → ${SERVICE_NAME} (${RUN_REGION})"
  gcloud run deploy "$SERVICE_NAME" \
    --project="$GCP_PROJECT" \
    --region="$RUN_REGION" \
    --image="$IMAGE" \
    --platform=managed \
    --allow-unauthenticated \
    --port=8000 \
    --cpu=4 \
    --memory=16Gi \
    --gpu=1 \
    --gpu-type=nvidia-l4 \
    --no-cpu-throttling \
    --no-gpu-zonal-redundancy \
    --timeout=600 \
    --max-instances="${MAX_INSTANCES:-2}" \
    --concurrency="${CONCURRENCY:-4}" \
    --env-vars-file="$env_yaml" \
    --labels="purpose=gpu,service=autocalib"

  print_service_url_and_health
}

print_service_url_and_health() {
  local url
  url="$(gcloud run services describe "$SERVICE_NAME" \
    --project="$GCP_PROJECT" \
    --region="$RUN_REGION" \
    --format='value(status.url)')"

  echo "[deploy-gpu] Service URL: ${url}"
  echo "[deploy-gpu] Waiting for health (auth token)…"
  for _ in $(seq 1 36); do
    if curl -sf -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
      "${url}/health" >/dev/null 2>&1; then
      echo "[deploy-gpu] OK — healthy"
      echo "[deploy-gpu] App: ${url}/absmap"
      return 0
    fi
    sleep 10
  done

  echo "[deploy-gpu] Health check timed out (SAM3 prewarm can take several minutes on cold start)." >&2
  echo "[deploy-gpu] Logs: gcloud run services logs read ${SERVICE_NAME} --region=${RUN_REGION} --limit=50" >&2
  return 1
}

if $DO_BUILD; then
  build_image
fi

if $DO_DEPLOY; then
  if [[ "$DEPLOY_MODE" == "full" ]]; then
    deploy_service_full
  else
    deploy_service_update
  fi
fi

echo "[deploy-gpu] Done."
