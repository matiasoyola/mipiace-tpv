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
#
# ── clinica-4 · LOS FICHEROS CLÍNICOS TAMBIÉN ─────────────────────────
#
# Desde clinica-4 la copia se lleva ADEMÁS el volumen de ficheros clínicos
# (las fotos de los pies y los PDF de los consentimientos firmados). No es
# un extra: **una historia clínica cuyas fotos no se pueden recuperar no se
# conserva cinco años**, y la Ley 41/2002 no distingue entre la fila y el
# fichero al que apunta. Un dump de Postgres solo dejaría filas que
# prometen documentos que no están.
#
# Va en ESTE script y no en un hermano por una razón concreta: las dos
# mitades tienen que ser del MISMO instante. Con dos crons, una restauración
# puede acabar con filas de las 04:00 y ficheros de las 05:00 — o sea, con
# consentimientos firmados cuyo PDF no existe todavía.
#
# Si falla la parte de los ficheros, el script SALE CON ERROR aunque el
# dump esté bien, por lo mismo que el `gzip -t`: media copia da falsa
# confianza, que es peor que no tener copia.

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

# ── clinica-4 · los ficheros clínicos, del mismo instante ─────────────
#
# Se leen DESDE EL CONTENEDOR de la API, que es quien tiene el volumen
# montado: así no hace falta saber cómo se llama el volumen (el prefijo
# depende del nombre del proyecto de compose) ni levantar un contenedor
# extra. Mismo patrón que el `pg_dump` de arriba: `exec -T` y una tubería.
CLINICAL_DIR="${MIPIACETPV_CLINICAL_DIR:-/var/lib/mipiacetpv/clinical-files}"
CLINICAL_FILE="$BACKUP_DIR/mipiacetpv-clinico-$TIMESTAMP.tar.gz"

echo "[backup] Empaquetando ficheros clínicos ($CLINICAL_DIR) → $CLINICAL_FILE"
# `|| true` en el mkdir de dentro: la primera noche de una clínica recién
# encendida el directorio puede no existir todavía, y eso NO es un fallo —
# lo que no puede pasar es que un directorio vacío tumbe la copia de la
# base. Lo que sí es un fallo es que el tar se rompa a medias, y eso lo
# caza el `gzip -t` de después.
docker compose --env-file "$ENV_FILE" -f infra/docker-compose.prod.yml exec -T api \
  sh -c "mkdir -p '$CLINICAL_DIR' 2>/dev/null || true; tar -czf - -C '$CLINICAL_DIR' ." \
  > "$CLINICAL_FILE"

if ! gzip -t "$CLINICAL_FILE"; then
  echo "[backup] ERROR: el paquete de ficheros clínicos $CLINICAL_FILE está corrupto (gzip -t falló). Borrado. La copia de la base SÍ está, pero una historia sin sus fotos no sirve: revísalo." >&2
  rm -f "$CLINICAL_FILE"
  exit 1
fi

sha256sum "$CLINICAL_FILE" > "$CLINICAL_FILE.sha256"
CLINICAL_SIZE=$(du -h "$CLINICAL_FILE" | cut -f1)
echo "[backup] Ficheros clínicos OK ($CLINICAL_SIZE)"

# Y a B2 con el mismo retry que el dump, si está configurado.
if [ -n "$B2_BUCKET" ] && command -v b2 >/dev/null 2>&1; then
  echo "[backup] Subiendo los ficheros clínicos a B2 bucket $B2_BUCKET…"
  for FILE in "$CLINICAL_FILE" "$CLINICAL_FILE.sha256"; do
    UPLOADED=0
    for ATTEMPT in 1 2 3; do
      if b2 upload-file "$B2_BUCKET" "$FILE" "clinico/$(basename "$FILE")"; then
        UPLOADED=1
        break
      fi
      echo "[backup] Subida de $(basename "$FILE") falló (intento $ATTEMPT/3), reintentando en $((ATTEMPT * 30))s…" >&2
      sleep $((ATTEMPT * 30))
    done
    if [ "$UPLOADED" -ne 1 ]; then
      echo "[backup] ERROR: no se pudo subir $(basename "$FILE") a B2 tras 3 intentos. Queda solo en local." >&2
      exit 1
    fi
  done
fi

# Retención: borrar backups más antiguos (y sus checksums)
echo "[backup] Purgando backups locales > $RETENTION_DAYS días…"
find "$BACKUP_DIR" -name "mipiacetpv-*.sql.gz" -mtime "+$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name "mipiacetpv-*.sql.gz.sha256" -mtime "+$RETENTION_DAYS" -delete
# clinica-4 · los paquetes de ficheros clínicos, con la MISMA retención
# local que el dump: las dos mitades caducan juntas, porque restaurar una
# sin la otra no sirve. (La retención LEGAL de la historia no es ésta: es
# la de producción, cinco años como mínimo. Esto es cuántas copias se
# guardan en el VPS.)
find "$BACKUP_DIR" -name "mipiacetpv-clinico-*.tar.gz" -mtime "+$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name "mipiacetpv-clinico-*.tar.gz.sha256" -mtime "+$RETENTION_DAYS" -delete

echo "[backup] Done."
