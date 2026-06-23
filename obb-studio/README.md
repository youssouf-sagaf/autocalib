# OBB Studio

Python backend + React UI for Cocoparks OBB annotation, dataset export, and YOLO-OBB training.

## Prerequisites

- Python 3.11+ with deps from the **monorepo venv** (`autocalib/requirements.txt`)
- Node 20+ (frontend only)

No `pip install -e` for local packages — `run.sh` adds source dirs to `PYTHONPATH`:

- `obb-studio/` → `import app`
- `autocalib/` (repo root) → `import autoabsmap`

## Setup (once)

```bash
# From autocalib repo root — shared venv + third-party deps only
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Frontend deps
cd obb-studio/frontend && npm install && cd ..

# Optional: obb-studio/.env (Mapbox token); run.sh also loads ../.env
cp obb-studio/.env.example obb-studio/.env
```

## Run

```bash
cd obb-studio
./run
```

- API → http://localhost:8100
- UI → http://localhost:5174 (browser opens)
- Ctrl+C stops both

## Imagery sources

`POST /api/crops/fetch`: `mapbox` (default), `ign-current`, `ign-pleiades-2026`

## Flow

1. Draw ROI → Fetch tile
2. Annotate OBBs or mark tile **background**
3. Create dataset → export YOLO
4. Train (default base weights: **yolo11s-obb.pt** via Ultralytics) → metrics SSE  
   On success, `weights/best.pt` is renamed to `weights/best_YYYYMMDDTHHMMSSZ.pt`.
5. Evaluate
