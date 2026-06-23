# ── Stage 1: Build frontend ──────────────────────────────────────────
FROM node:20-slim AS frontend-build

ARG VITE_MAPBOX_TOKEN=""
ARG VITE_API_URL=""
ARG VITE_FIREBASE_API_KEY=""
ARG VITE_AUTH_DOMAIN=""
ARG VITE_DATABASE_URL=""
ARG VITE_PROJECT_ID=""
ARG VITE_STORAGE_BUCKET=""
ARG VITE_MESSAGING_SENDER_ID=""
ARG VITE_ID=""
ARG VITE_MEASUREMENT_ID=""
ARG VITE_B2B_BASE_URL=""

ENV VITE_MAPBOX_TOKEN=$VITE_MAPBOX_TOKEN \
    VITE_API_URL=$VITE_API_URL \
    VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY \
    VITE_AUTH_DOMAIN=$VITE_AUTH_DOMAIN \
    VITE_DATABASE_URL=$VITE_DATABASE_URL \
    VITE_PROJECT_ID=$VITE_PROJECT_ID \
    VITE_STORAGE_BUCKET=$VITE_STORAGE_BUCKET \
    VITE_MESSAGING_SENDER_ID=$VITE_MESSAGING_SENDER_ID \
    VITE_ID=$VITE_ID \
    VITE_MEASUREMENT_ID=$VITE_MEASUREMENT_ID \
    VITE_B2B_BASE_URL=$VITE_B2B_BASE_URL

WORKDIR /frontend
COPY autocalib-frontend/package.json autocalib-frontend/package-lock.json ./
RUN npm ci
COPY autocalib-frontend/ ./
RUN npx vite build --outDir dist

# ── Stage 2: Python runtime (CUDA / NVIDIA) ──────────────────────────
# PyTorch CUDA 12.4 — no GPU needed at build time. Runtime GPU: Cloud Run L4
# (europe-west4) or any host with nvidia-container-toolkit + --gpus all.
FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libgdal-dev \
    libgeos-dev \
    libgl1 \
    libglib2.0-0 \
    libxcb1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Torch is preinstalled with CUDA in the base image — skip the generic PyPI line.
COPY requirements.txt /app/requirements.txt
RUN grep -v '^torch' /app/requirements.txt > /app/requirements-no-torch.txt \
    && pip install --no-cache-dir -r /app/requirements-no-torch.txt

# Copy source code (no pip install — PYTHONPATH resolves imports)
COPY autoabsmap/  /app/autoabsmap/
COPY calib_gen/   /app/calib_gen/
COPY pairing/     /app/pairing/
COPY autocalib-api/app/ /app/app/
COPY autocalib-api/config/ /app/config/

# Frontend static build
COPY --from=frontend-build /frontend/dist /app/static

RUN mkdir -p /app/sessions

ENV PYTHONPATH="/app"
# Default cuda for GPU runtimes (Cloud Run L4, nvidia-container-toolkit).
# docker-compose overrides SAM3_DEVICE=auto on the CPU-only build VM.
ENV SAM3_DEVICE=cuda
ENV NVIDIA_VISIBLE_DEVICES=all
ENV NVIDIA_DRIVER_CAPABILITIES=compute,utility
ENV HF_HOME="/root/.cache/huggingface"
ENV TRANSFORMERS_CACHE="/root/.cache/huggingface"
ENV HUGGINGFACE_HUB_CACHE="/root/.cache/huggingface/hub"
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
