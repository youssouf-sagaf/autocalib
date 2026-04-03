# ── Stage 1: Build frontend ──────────────────────────────────────────
FROM node:20-slim AS frontend-build

WORKDIR /frontend
COPY autoabsmap-frontend/package.json ./
RUN npm install
COPY autoabsmap-frontend/ ./
RUN npm run build

# ── Stage 2: Python runtime ─────────────────────────────────────────
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgdal-dev \
    libgeos-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install autoabsmap core package
COPY autoabsmap/ /app/autoabsmap/
RUN pip install --no-cache-dir /app/autoabsmap/

# Install API dependencies
COPY autoabsmap-api/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy API code
COPY autoabsmap-api/app/ /app/app/

# Copy frontend build into static/ (served by FastAPI)
COPY --from=frontend-build /frontend/dist /app/static

ENV PYTHONPATH="/app"
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
