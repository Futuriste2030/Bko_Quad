#!/usr/bin/env bash
# Restauration PostgreSQL depuis une sauvegarde chiffrée.
# ATTENTION : écrase la base de production.
# Usage : sudo RESTORE_CONFIRM=YES ./deploy/restore-postgres.sh /var/backups/bko-quad/bko-db-....dump.gpg
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/deploy/.env.production"
COMPOSE=(docker compose -f "$ROOT/docker-compose.prod.yml" --env-file "$ENV_FILE")
DUMP="${1:-}"

test "$DUMP" = "" && { echo "Usage : $0 <sauvegarde.dump.gpg>" >&2; exit 1; }
test -f "$DUMP" || { echo "ERREUR : fichier introuvable : $DUMP" >&2; exit 1; }
test "${RESTORE_CONFIRM:-}" = "YES" || {
  echo "ERREUR : ajoutez RESTORE_CONFIRM=YES pour confirmer l'écrasement." >&2
  exit 1
}

BACKUP_PASSPHRASE="$(sed -n 's/^BACKUP_PASSPHRASE=//p' "$ENV_FILE" | head -n1 | tr -d '\r')"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE manquant}"

umask 077
TMP_DUMP="$(mktemp)"
PASS_FILE="$(mktemp)"
trap 'rm -f "$TMP_DUMP" "$PASS_FILE"' EXIT
printf '%s' "$BACKUP_PASSPHRASE" > "$PASS_FILE"
gpg --batch --yes --pinentry-mode loopback --decrypt \
  --passphrase-file "$PASS_FILE" --output "$TMP_DUMP" "$DUMP"

echo "==> Arrêt de web/worker/beat pendant la restauration"
"${COMPOSE[@]}" stop web worker beat

echo "==> Restauration dans PostgreSQL"
"${COMPOSE[@]}" cp "$TMP_DUMP" db:/tmp/bko-restore.dump
"${COMPOSE[@]}" exec -T db sh -c \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner \
   --no-privileges /tmp/bko-restore.dump && rm -f /tmp/bko-restore.dump'

echo "==> Redémarrage"
"${COMPOSE[@]}" up -d web worker beat
echo "Restauration terminée."
