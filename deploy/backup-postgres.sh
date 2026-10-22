#!/usr/bin/env bash
# Sauvegarde quotidienne chiffrée : PostgreSQL + médias (cachets, signatures,
# photos). À lancer en cron root, ex. :
#   15 2 * * * /opt/bko-quad/deploy/backup-postgres.sh >> /var/log/bko-backup.log 2>&1
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/deploy/.env.production"
COMPOSE=(docker compose -f "$ROOT/docker-compose.prod.yml" --env-file "$ENV_FILE")
BACKUP_DIR="${BACKUP_DIR:-/var/backups/bko-quad}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

test -f "$ENV_FILE" || { echo "ERREUR : $ENV_FILE absent." >&2; exit 1; }
command -v gpg >/dev/null || { echo "ERREUR : gpg requis." >&2; exit 1; }
command -v docker >/dev/null || { echo "ERREUR : docker requis." >&2; exit 1; }

# Lecture littérale : ne pas "sourcer" le .env (les clés générées peuvent
# contenir $, ` ou # que le shell interpréterait).
BACKUP_PASSPHRASE="$(sed -n 's/^BACKUP_PASSPHRASE=//p' "$ENV_FILE" | head -n1 | tr -d '\r')"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE manquant dans deploy/.env.production}"

umask 077
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
PASS_FILE="$(mktemp)"
trap 'rm -f "$PASS_FILE"' EXIT
printf '%s' "$BACKUP_PASSPHRASE" > "$PASS_FILE"

echo "[$(date -Is)] sauvegarde PostgreSQL"
"${COMPOSE[@]}" exec -T db sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges' \
  | gpg --batch --yes --pinentry-mode loopback --symmetric --cipher-algo AES256 \
      --passphrase-file "$PASS_FILE" \
      --output "$BACKUP_DIR/bko-db-$STAMP.dump.gpg"

echo "[$(date -Is)] sauvegarde des médias"
"${COMPOSE[@]}" exec -T web tar -czf - -C /app/media . \
  | gpg --batch --yes --pinentry-mode loopback --symmetric --cipher-algo AES256 \
      --passphrase-file "$PASS_FILE" \
      --output "$BACKUP_DIR/bko-media-$STAMP.tar.gz.gpg"

find "$BACKUP_DIR" -type f -name '*.gpg' -mtime "+$RETENTION_DAYS" -delete
echo "[$(date -Is)] OK : $BACKUP_DIR/bko-*-$STAMP.*"
