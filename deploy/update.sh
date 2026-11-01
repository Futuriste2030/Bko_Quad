#!/usr/bin/env bash
set -euo pipefail

cd /var/www/Bko_Quad

echo "==> Git pull"
git pull origin master

echo "==> Rebuild + restart (Docker)"
docker compose -f docker-compose.prod.yml up -d --build

echo "==> Terminé. Videz le cache navigateur / réinstallez la PWA."
