#!/usr/bin/env bash
# clinica-7 · EL SIMULACRO DE RESTAURACIÓN.
#
#   infra/simulacro-de-restauracion.sh <copia.sql.gz.age> <clinico.tar.gz.age>
#
# Decisión 20. Restaura una copia **cifrada** en una base de prueba con la
# clave privada de `age`, y después comprueba las tres cosas que de verdad
# contestan «esta copia sirve»:
#
#   1. la copia se DESCIFRA con la privada;
#   2. la base restaurada tiene la fila CANARIO de cada clínica, y la
#      `CLINICAL_KEK` la DESCIFRA;
#   3. un FICHERO clínico del paquete se descifra y su huella cuadra con la
#      que dice su fila.
#
# ── Por qué las tres y no solo la primera ────────────────────────────
#
# Porque «el `.age` se abre» no es «la copia sirve». Una copia que se
# descifra y cuyas claves de clínica no se pueden desenvolver es una copia
# de datos ilegibles: están todos los bytes y no hay historia. Y una copia
# cuyas filas se leen pero cuyos ficheros no descifran es una historia sin
# sus fotos, que la Ley 41/2002 no considera conservada.
#
# Las tres juntas son la pregunta entera: **¿puedo volver a abrir la
# historia de una paciente a partir de esto?**
#
# ── Y por qué un simulacro y no «confiar en el script de copia» ──────
#
# Porque una copia sin restaurar es una esperanza. El script de copia dice
# que escribió un fichero; esto dice que del fichero sale una historia.
# Son dos afirmaciones distintas y solo la segunda importa el día que haga
# falta.
#
# ── Lo que NO toca ───────────────────────────────────────────────────
#
# La base de producción. Crea una base nueva (`mipiacetpv_simulacro`), la
# usa y la BORRA al final. Si el script se corta a la mitad, la base de
# prueba se queda y el siguiente la recrea.

set -euo pipefail

COPIA_SQL="${1:-}"
COPIA_CLINICA="${2:-}"
BASE="${MIPIACETPV_SIMULACRO_DB:-mipiacetpv_simulacro}"
# El contenedor de Postgres. En el VPS es el del compose; en el Mac de
# desarrollo es el de `docker-compose.yml` de la raíz.
PG="${MIPIACETPV_PG_CONTAINER:-mipiacetpv-postgres}"
PGUSER="${MIPIACETPV_PGUSER:-mipiacetpv}"
# Dónde está la privada de `age`. **NO en el VPS**: esto se lanza desde el
# portátil de Matías con la clave que tiene guardada, o se le pega la ruta a
# un fichero temporal que se borra después.
AGE_IDENTITY="${MIPIACETPV_BACKUP_AGE_IDENTITY:-}"
TRABAJO="$(mktemp -d)"

rojo() { printf '\033[31m%s\033[0m\n' "$1"; }
verde() { printf '\033[32m%s\033[0m\n' "$1"; }

limpiar() {
  rm -rf "$TRABAJO"
}
trap limpiar EXIT

if [ -z "$COPIA_SQL" ] || [ -z "$COPIA_CLINICA" ]; then
  cat >&2 <<AYUDA
Uso: $0 <copia.sql.gz.age> <clinico.tar.gz.age>

Y hacen falta dos cosas en el entorno:

  MIPIACETPV_BACKUP_AGE_IDENTITY  la ruta al fichero con la clave PRIVADA
                                  de age (la que NO está en el VPS)
  CLINICAL_KEK                    la clave maestra, para desenvolver las
                                  claves de cada clínica
  CLINICAL_KEK_ID                 su id

Ejemplo:
  export MIPIACETPV_BACKUP_AGE_IDENTITY=~/claves/age-mipiace.txt
  export CLINICAL_KEK="…"  CLINICAL_KEK_ID="kek-2026-10"
  $0 backups/mipiacetpv-20261015-040001.sql.gz.age \\
     backups/mipiacetpv-clinico-20261015-040001.tar.gz.age
AYUDA
  exit 1
fi

for v in AGE_IDENTITY CLINICAL_KEK CLINICAL_KEK_ID; do
  if [ -z "${!v:-}" ]; then
    rojo "Falta $v. Lanza el script sin argumentos para ver la ayuda."
    exit 1
  fi
done
if ! command -v age >/dev/null 2>&1; then
  rojo "'age' no está instalado (brew install age · apt install age)."
  exit 1
fi

echo "══ SIMULACRO DE RESTAURACIÓN · $(date '+%Y-%m-%d %H:%M:%S %z')"
echo "   dump:     $COPIA_SQL"
echo "   ficheros: $COPIA_CLINICA"
echo "   base:     $BASE"
echo

# ── 1 · DESCIFRAR ────────────────────────────────────────────────────
echo "── 1 · descifrar las dos mitades con la privada de age"
age -d -i "$AGE_IDENTITY" -o "$TRABAJO/dump.sql.gz" "$COPIA_SQL"
age -d -i "$AGE_IDENTITY" -o "$TRABAJO/clinico.tar.gz" "$COPIA_CLINICA"
gzip -t "$TRABAJO/dump.sql.gz"
# El paquete de ficheros se comprueba con `tar -tzf` y NO con `gzip -t`, y
# por dos razones. La primera es que es una comprobación MÁS fuerte: lee el
# archivo entero, valida el CRC del gzip al pasar y además valida la
# estructura del tar — `gzip -t` solo mira la capa de fuera.
#
# La segunda la encontró este simulacro al correrlo: el `gzip` de macOS
# **devuelve 2** sobre un `.tar.gz` («trailing garbage ignored», por los
# bloques de ceros con los que tar termina), y con `set -e` eso abortaba el
# simulacro sobre un paquete perfectamente bueno. El de Linux no avisa, así
# que en el VPS no se habría visto nunca — y el simulacro se lanza desde el
# portátil.
tar -tzf "$TRABAJO/clinico.tar.gz" > /dev/null
verde "   ✔ las dos se descifran y descomprimen"

# ── 2 · RESTAURAR ────────────────────────────────────────────────────
echo "── 2 · restaurar en $BASE"
docker exec "$PG" psql -U "$PGUSER" -d postgres -q \
  -c "DROP DATABASE IF EXISTS $BASE;" -c "CREATE DATABASE $BASE;"
gunzip -c "$TRABAJO/dump.sql.gz" \
  | docker exec -i "$PG" psql -U "$PGUSER" -d "$BASE" -q -v ON_ERROR_STOP=0 \
  > "$TRABAJO/restore.log" 2>&1 || true
# El dump lleva `--clean --if-exists`, así que suelta avisos de `DROP` sobre
# objetos que no existen en una base nueva. Eso NO es un fallo; lo que sí
# lo es es que no haya quedado ninguna tabla.
TABLAS=$(docker exec "$PG" psql -U "$PGUSER" -d "$BASE" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")
if [ "$TABLAS" -lt 20 ]; then
  rojo "   ✖ la base restaurada tiene $TABLAS tablas. Algo ha ido mal:"
  tail -30 "$TRABAJO/restore.log" >&2
  exit 1
fi
verde "   ✔ $TABLAS tablas restauradas"

# ── 3 · LOS FICHEROS ─────────────────────────────────────────────────
echo "── 3 · desempaquetar los ficheros clínicos"
mkdir -p "$TRABAJO/clinical-files"
tar -xzf "$TRABAJO/clinico.tar.gz" -C "$TRABAJO/clinical-files"
CUANTOS=$(find "$TRABAJO/clinical-files" -type f | wc -l | tr -d ' ')
verde "   ✔ $CUANTOS fichero(s) clínico(s)"

# ── 4 · EL CANARIO Y UN FICHERO, con la API de verdad ───────────────
#
# Esto es la parte que ninguna otra herramienta puede hacer: usa el MISMO
# código que la API para desenvolver las DEK, descifrar el canario y
# descifrar un fichero. Si el formato cambiara y nadie actualizara el
# simulacro, el simulacro se pondría rojo — que es lo que tiene que pasar.
echo "── 4 · descifrar el canario de cada clínica y un fichero"
REPO_DIR="${MIPIACETPV_REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO_DIR"
DATABASE_URL="postgresql://$PGUSER:${MIPIACETPV_PGPASSWORD:-mipiacetpv_dev}@localhost:${MIPIACETPV_PGPORT:-5432}/$BASE?schema=public" \
CLINICAL_FILES_DIR="$TRABAJO/clinical-files" \
  pnpm --filter @mipiacetpv/api exec tsx src/scripts/comprobar-restauracion.ts \
  || { rojo "   ✖ la comprobación del canario o del fichero ha fallado"; exit 1; }

# ── 5 · Y LA BASE DE PRUEBA, FUERA ──────────────────────────────────
echo "── 5 · borrar la base de prueba"
docker exec "$PG" psql -U "$PGUSER" -d postgres -q -c "DROP DATABASE IF EXISTS $BASE;"

echo
verde "══ SIMULACRO SUPERADO · $(date '+%Y-%m-%d %H:%M:%S %z')"
echo "   Esta copia sirve: se descifra, se restaura, las claves de cada"
echo "   clínica se desenvuelven y de ella sale una historia legible."
