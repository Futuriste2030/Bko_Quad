# BKO Quad Hub — image de production (frontend Vite + Django/Gunicorn).
# WhiteNoise sert le build React et les statiques Django ; /media/ reste sur
# un volume Docker, servi par Django derrière Nginx.

# ---------- Build frontend ----------
FROM node:22-slim AS front
WORKDIR /front
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---------- Runtime Django ----------
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libjpeg62-turbo \
    zlib1g \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
COPY VERSION ./VERSION
COPY --from=front /front/dist ./frontend_dist

# collectstatic avec le stockage WhiteNoise (manifest) : clé factice de build,
# remplacée au runtime par le vrai .env de production.
RUN DJANGO_DEBUG=0 \
    DJANGO_SECRET_KEY=build-only-key-not-used-at-runtime \
    DJANGO_ALLOWED_HOSTS=app.bkoquad.ml,localhost,127.0.0.1 \
    python manage.py collectstatic --noinput

RUN useradd --create-home --no-log-init appuser \
    && mkdir -p /app/media /app/staticfiles \
    && chown -R appuser:appuser /app/media /app/staticfiles /app/frontend_dist
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=4)"]

CMD ["sh", "-c", "python manage.py migrate --noinput && exec gunicorn config.wsgi:application --workers 3 --bind 0.0.0.0:8000 --timeout 120 --access-logfile - --error-logfile - --forwarded-allow-ips='*'"]
