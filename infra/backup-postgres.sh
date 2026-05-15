#!/usr/bin/env bash
# backup-postgres.sh · backup diario de la BD productiva
#
# Pensado para correr desde cron en el VPS. Toma un dump de Postgres,
# lo comprime, lo guarda en /opt/mipiacetpv/backups con timestamp, y
# borra los backups más antiguos de 30 días.
#
# Crontab sugerido (editar con `crontab -e`):
#   0 4 * * * /opt/mipiacetpv/infra/backup-postgres.sh >> /var/log/mipiacetpv-backup.log 2>&1
#
# Backblaze opcional: si tienes b2 CLI instalado y configurado, el script
# sube el backup a un bucket. Si no, solo guarda local.

set -euo pipefail

REPO_DIR="${MIPIACETPV_REPO_DIR:-/opt/mipiacetpv}"
ENV_FILE="$REPO_DIR/infra/.env.production"
BACKUP_DIR="$REPO_DIR/backups"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
B2_BUCKET="${MIPIACETPV_B2_BUCKET:-}"

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/mipiacetpv-$TIMESTAMP.sql.gz"

cd "$REPO_DIR"

echo "[backup] Dumping postgres → $BACKUP_FILE"
docker compose --env-file "$ENV_FILE" -f infra/docker-compose.prod.yml exec -T postgres \
  pg_dump -U mipiacetpv -d mipiacetpv --no-owner --clean --if-exists \
  | gzip -9 > "$BACKUP_FILE"

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[backup] OK ($SIZE)"

# Subida opcional a Backblaze B2
if [ -n "$B2_BUCKET" ] && command -v b2 >/dev/null 2>&1; then
  echo "[backup] Subiendo a B2 bucket $B2_BUCKET…"
  b2 upload-file "$B2_BUCKET" "$BACKUP_FILE" "postgres/$(basename "$BACKUP_FILE")"
fi

# Retención: borrar backups más antiguos
echo "[backup] Purgando backups locales > $RETENTION_DAYS días…"
find "$BACKUP_DIR" -name "mipiacetpv-*.sql.gz" -mtime "+$RETENTION_DAYS" -delete

echo "[backup] Done."
