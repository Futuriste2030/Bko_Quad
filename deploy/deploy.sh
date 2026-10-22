#!/usr/bin/env bash
# Déploiement / mise à jour de BKO Quad Hub sur le VPS.
# Usage : sudo -E ./deploy/deploy.sh
# Prérequis : Docker + plugin compose, deploy/.env.production rempli, Nginx prêt.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f "$ROOT/docker-compose.prod.yml" --env-file "$ROOT/deploy/.env.production")
test -f "$ROOT/deploy/.env.production" || {
  echo "ERREUR : deploy/.env.production absent (copier .env.production.example)." >&2
  exit 1
}

echo "==> Récupération du code"
git pull --ff-only

echo "==> Build de l'image (frontend + Django)"
"${COMPOSE[@]}" build --pull

echo "==> Démarrage / mise à jour des conteneurs"
"${COMPOSE[@]}" up -d --remove-orphans

echo "==> Attente de la sonde locale"
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8003/healthz >/dev/null 2>&1; then
    echo "Hub prêt : $(curl -fsS http://127.0.0.1:8003/healthz)"
    exit 0
  fi
  sleep 3
done

echo "ERREUR : le Hub ne répond pas sur 127.0.0.1:8003." >&2
"${COMPOSE[@]}" ps >&2
"${COMPOSE[@]}" logs --tail=80 web >&2
exit 1
