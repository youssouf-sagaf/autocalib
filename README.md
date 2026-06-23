# autocalib

Cocoparks monorepo for parking calibration: satellite-based absolute slot maps (SAM3), camera bbox generation, and slot–camera pairing.

| Package | Role |
|---------|------|
| `autoabsmap` | Detect and geolocate slots from imagery |
| `autocalib-api` | FastAPI — jobs, SSE, B2B sync |
| `autocalib-frontend` | Operator UI (absmap, calib, pairing) |
| `absolutemap-gen` | R&D archive (read-only) |
| `calib_gen` / `pairing` | In progress — see their `docs/` |

Full architecture: [`plan_architecture.md`](plan_architecture.md)

## Local dev

```bash
cd autocalib-api && pip install -e "../autoabsmap" -e ".[dev]"
cd autocalib-frontend && npm install && npm run dev
```

Copy `.env` from `.env.example` (Mapbox, Firebase, B2B). Do not commit `.env`.

## GPU deploy (Cloud Run)

Requires `gcloud auth login` and `.env` at repo root.

```bash
./scripts/deploy-cloudrun-gpu.sh              # build + deploy (after code changes)
./scripts/deploy-cloudrun-gpu.sh --deploy-only   # redeploy existing image only
./scripts/deploy-cloudrun-gpu.sh --full       # first deploy or env/GPU change
```

After frontend or API changes, run **without** `--deploy-only` so Cloud Build produces a new image.