#!/usr/bin/env bash
# A3-distribución · publicar una APK en el VPS.
#
# LO EJECUTA MATÍAS DESDE EL MAC. Cowork no tiene red, así que este script no
# se prueba end-to-end desde la sesión de Claude: se escribe para que lo corra
# una persona con acceso SSH al VPS.
#
# Qué hace:
#   1. Comprueba que el APK local coincide con su propio sidecar .sha256.
#   2. Lo sube por scp a un fichero temporal DENTRO del directorio destino.
#   3. Recalcula el SHA-256 EN EL VPS y aborta si no coincide con el local.
#   4. Regenera releases.json con la entrada nueva.
#   5. Mueve las dos cosas a su sitio con `mv` sobre el mismo filesystem.
#
# Es idempotente: republicar la misma versión sobreescribe el binario y
# reemplaza su entrada en el índice, sin duplicarla.
#
# Uso:
#   infra/publicar-apk.sh apps/tpv-android/build-releases/mipiacetpv-1.10.2-11002.apk
#   MIPIACETPV_SSH=root@76.13.142.28 infra/publicar-apk.sh <apk>
#
# NOTA sobre latest.json: NO se escribe ningún fichero. La API deriva
# `/apk/latest.json` de releases.json ordenando por versionCode
# (apps/api/src/releases/store.ts). Un latest.json en disco sería un segundo
# origen de la misma verdad y acabaría desincronizado el día que alguien
# despublique una versión a mano.
set -euo pipefail

SSH_TARGET="${MIPIACETPV_SSH:-root@76.13.142.28}"
REMOTE_DIR="${MIPIACETPV_RELEASES_DIR:-/opt/mipiacetpv/releases}"

die() { echo "ERROR: $*" >&2; exit 1; }

[ $# -eq 1 ] || die "uso: $(basename "$0") <ruta-al-apk>"

APK="$1"
[ -f "$APK" ] || die "no encuentro el APK: $APK"
SIDECAR="$APK.sha256"
[ -f "$SIDECAR" ] || die "falta el sidecar $SIDECAR.
       Lo emite apps/tpv-android/scripts/build-release-apk.sh junto al APK. Sin
       él no sé de qué commit ni de qué versión sale este binario."

APK_NAME="$(basename "$APK")"

sha256_local() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    die "no encuentro ni shasum ni sha256sum en local."
  fi
}

# El sidecar lleva una línea de comentario con los metadatos y otra con el
# hash en formato shasum. Se extraen por separado.
SHA_SIDECAR="$(awk '!/^#/{print $1; exit}' "$SIDECAR")"
GIT_SHA="$(sed -n 's/^# gitSha=\([^ ]*\).*/\1/p' "$SIDECAR")"
VERSION_NAME="$(sed -n 's/^#.*versionName=\([^ ]*\).*/\1/p' "$SIDECAR")"
VERSION_CODE="$(sed -n 's/^#.*versionCode=\([^ ]*\).*/\1/p' "$SIDECAR")"

[ -n "$SHA_SIDECAR" ] || die "el sidecar no tiene línea de hash."
[ -n "$GIT_SHA" ] || die "el sidecar no lleva gitSha. ¿Es de un build anterior a A3?"
[ -n "$VERSION_NAME" ] || die "el sidecar no lleva versionName."
[ -n "$VERSION_CODE" ] || die "el sidecar no lleva versionCode."

# El APK local puede haberse corrompido desde que se construyó (copia a medias,
# disco). Si no cuadra con su propio sidecar, no se sube.
SHA_LOCAL="$(sha256_local "$APK")"
[ "$SHA_LOCAL" = "$SHA_SIDECAR" ] || die "el APK local NO coincide con su sidecar.
       sidecar: $SHA_SIDECAR
       fichero: $SHA_LOCAL
       Reconstruye con build-release-apk.sh."

SIZE="$(wc -c < "$APK" | tr -d ' ')"
PUBLISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

case "$GIT_SHA" in
  *-dirty)
    echo "AVISO: este build salió de un árbol SUCIO ($GIT_SHA)." >&2
    echo "       Su commit no identifica lo que lleva dentro. Publícalo sólo si" >&2
    echo "       sabes exactamente por qué." >&2
    ;;
esac

cat <<INFO
==> Publicando
    fichero    $APK_NAME
    versión    $VERSION_NAME (versionCode $VERSION_CODE)
    commit     $GIT_SHA
    tamaño     $SIZE bytes
    SHA-256    $SHA_LOCAL
    destino    $SSH_TARGET:$REMOTE_DIR
INFO

echo "==> 1/4 asegurando el directorio remoto"
ssh "$SSH_TARGET" "mkdir -p '$REMOTE_DIR'"

# El temporal va DENTRO del directorio destino a propósito: así el `mv` final
# es sobre el mismo filesystem y por tanto atómico. Un /tmp del VPS podría ser
# otra partición, y entonces `mv` sería copiar — con una ventana en la que el
# fichero está a medias y la API podría servirlo.
TMP_REMOTE="$REMOTE_DIR/.$APK_NAME.subiendo"

echo "==> 2/4 subiendo por scp"
scp "$APK" "$SSH_TARGET:$TMP_REMOTE"

echo "==> 3/4 verificando el SHA-256 EN EL VPS"
SHA_REMOTE="$(ssh "$SSH_TARGET" "sha256sum '$TMP_REMOTE' | awk '{print \$1}'")"
if [ "$SHA_REMOTE" != "$SHA_LOCAL" ]; then
  ssh "$SSH_TARGET" "rm -f '$TMP_REMOTE'"
  die "el SHA-256 remoto NO coincide: la subida se corrompió.
       local:  $SHA_LOCAL
       remoto: $SHA_REMOTE
       El temporal se ha borrado. Vuelve a intentarlo."
fi
echo "    OK · $SHA_REMOTE"

echo "==> 4/4 actualizando el índice y moviendo a su sitio"
# El índice se regenera con python3 en el VPS (no con jq, que no damos por
# instalado). Idempotente: si ya existe una entrada con este versionCode, se
# reemplaza en vez de duplicarse.
ssh "$SSH_TARGET" REMOTE_DIR="$REMOTE_DIR" APK_NAME="$APK_NAME" \
  TMP_REMOTE="$TMP_REMOTE" VERSION_NAME="$VERSION_NAME" \
  VERSION_CODE="$VERSION_CODE" SHA="$SHA_LOCAL" SIZE="$SIZE" \
  PUBLISHED_AT="$PUBLISHED_AT" GIT_SHA="$GIT_SHA" 'bash -s' <<'REMOTE'
set -euo pipefail
INDEX="$REMOTE_DIR/releases.json"
TMP_INDEX="$REMOTE_DIR/.releases.json.nuevo"

python3 - "$INDEX" "$TMP_INDEX" <<'PY'
import json, os, sys

index_path, tmp_path = sys.argv[1], sys.argv[2]

def apartar(motivo):
    """Un indice ilegible NO se sobreescribe en silencio.

    Regenerar desde cero despublicaria todas las versiones anteriores sin que
    nadie se entere: la consola las dejaria de listar y los codigos ya
    emitidos apuntarian a versiones que el indice ya no conoce. Se aparta con
    marca de tiempo para poder recuperarlas a mano.
    """
    respaldo = index_path + ".corrupto." + os.environ["PUBLISHED_AT"].replace(":", "")
    os.rename(index_path, respaldo)
    sys.stderr.write(
        "AVISO: releases.json %s. Se ha apartado en %s y se genera uno nuevo\n"
        "       SOLO con esta version. Revisa el respaldo: las versiones que\n"
        "       hubiera dentro ya no estan publicadas.\n" % (motivo, respaldo)
    )

data = []
if os.path.exists(index_path):
    try:
        with open(index_path) as fh:
            data = json.load(fh)
    except json.JSONDecodeError:
        apartar("no es JSON valido")
        data = []
    else:
        if not isinstance(data, list):
            apartar("no contiene una lista")
            data = []

entry = {
    "versionCode": int(os.environ["VERSION_CODE"]),
    "versionName": os.environ["VERSION_NAME"],
    "fileName": os.environ["APK_NAME"],
    "sha256": os.environ["SHA"],
    "size": int(os.environ["SIZE"]),
    "publishedAt": os.environ["PUBLISHED_AT"],
    "gitSha": os.environ["GIT_SHA"],
}

# Idempotencia: fuera cualquier entrada con este versionCode antes de anadir.
data = [r for r in data if r.get("versionCode") != entry["versionCode"]]
data.append(entry)
data.sort(key=lambda r: r.get("versionCode", 0), reverse=True)

with open(tmp_path, "w") as fh:
    json.dump(data, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
PY

# Los dos movimientos, ya con todo verificado. Mismo filesystem = atomicos.
mv "$TMP_REMOTE" "$REMOTE_DIR/$APK_NAME"
mv "$TMP_INDEX" "$INDEX"
chmod 644 "$REMOTE_DIR/$APK_NAME" "$INDEX"

echo "    indice: $(python3 -c "import json;print(len(json.load(open('$INDEX'))))" ) version(es) publicada(s)"
REMOTE

cat <<FIN

════════════════════════════════════════════════════════════════════
  Publicado
════════════════════════════════════════════════════════════════════
  $VERSION_NAME ($VERSION_CODE) · commit $GIT_SHA

  Comprueba que la API la ve:
      curl -s https://api.mipiacetpv.com/apk/latest.json

  Y que la página carga:
      curl -sI https://mipiacetpv.com/apk

  Genera el código de instalación en:
      https://admin.mipiacetpv.com/superadmin/descargas
════════════════════════════════════════════════════════════════════
FIN
