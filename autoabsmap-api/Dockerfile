FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgdal-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY ../autoabsmap /opt/autoabsmap
RUN pip install --no-cache-dir -e /opt/autoabsmap 2>/dev/null || true

COPY app/ ./app/

ENV PYTHONPATH="/app:/opt"

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
