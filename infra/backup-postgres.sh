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

# v1.5-consistencia-A §5.4 · verificación de integridad: un dump
# truncado (disco lleno, contenedor parado a medias) comprime "bien"
# pero no descomprime. Si gzip -t falla, borramos el archivo corrupto
# y salimos con error para que el cron lo registre — un backup corrupto
# es peor que no tener backup, porque da falsa confianza.
if ! gzip -t "$BACKUP_FILE"; then
  echo "[backup] ERROR: el dump $BACKUP_FILE está corrupto (gzip -t falló). Borrado. Revisa espacio en disco y estado del contenedor postgres." >&2
  rm -f "$BACKUP_FILE"
  exit 1
fi

# Checksum junto al archivo — permite verificar integridad tras
# descargar de B2 o copiar entre máquinas.
sha256sum "$BACKUP_FILE" > "$BACKUP_FILE.sha256"

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[backup] OK ($SIZE)"

# Subida opcional a Backblaze B2 — retry ×3 con sleep (los cortes de
# red transitorios a B2 no deben dejar el backup solo en local).
if [ -n "$B2_BUCKET" ] && command -v b2 >/dev/null 2>&1; then
  echo "[backup] Subiendo a B2 bucket $B2_BUCKET…"
  for FILE in "$BACKUP_FILE" "$BACKUP_FILE.sha256"; do
    UPLOADED=0
    for ATTEMPT in 1 2 3; do
      if b2 upload-file "$B2_BUCKET" "$FILE" "postgres/$(basename "$FILE")"; then
        UPLOADED=1
        break
      fi
      echo "[backup] Subida de $(basename "$FILE") falló (intento $ATTEMPT/3), reintentando en $((ATTEMPT * 30))s…" >&2
      sleep $((ATTEMPT * 30))
    done
    if [ "$UPLOADED" -ne 1 ]; then
      echo "[backup] ERROR: no se pudo subir $(basename "$FILE") a B2 tras 3 intentos. El backup queda solo en local." >&2
      exit 1
    fi
  done
fi

# Retención: borrar backups más antiguos (y sus checksums)
echo "[backup] Purgando backups locales > $RETENTION_DAYS días…"
find "$BACKUP_DIR" -name "mipiacetpv-*.sql.gz" -mtime "+$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name "mipiacetpv-*.sql.gz.sha256" -mtime "+$RETENTION_DAYS" -delete

echo "[backup] Done."
