#!/usr/bin/env bash
# Build del APK firmado de mipiacetpv para INSTALACIÓN DIRECTA (sideload) en los
# terminales de los pilotos (AP12-1506 de 15", AP11-1006 de 10,1"). Alternativa
# a Play: no hay revisión ni closed-testing; instalas el .apk en el terminal hoy.
#
# Gemelo de build-release-aab.sh pero con assembleRelease (APK) en vez de
# bundleRelease (.aab). Misma firma, mismo VITE_API_URL de producción.
#
# A3-distribución: el APK dejó de ser un artefacto suelto en app/build/outputs
# para convertirse en algo que se PUBLICA (infra/publicar-apk.sh) y se descarga
# desde mipiacetpv.com/apk. Eso obliga a cuatro cosas que antes no hacía:
#   - Nombre determinista y huella: quien descarga tiene que poder cotejar el
#     SHA-256 antes de instalar, y el nombre tiene que decir qué versión es.
#   - Registrar el commit del que sale. En soporte la pregunta no es "¿qué
#     versión tiene el terminal?" sino "¿qué commit tiene el terminal?".
#   - Abortar si el APK no está firmado. Antes se asumía; un APK sin firmar no
#     instala en el terminal y el fallo aparecía a 40 km del Mac.
#   - Abortar si el backend de producción no quedó embebido (hallazgo A2). Un
#     APK que apunta a localhost instala perfectamente y no sirve para nada.
#
# Uso:
#   apps/tpv-android/scripts/build-release-apk.sh 1.10.2   # → versionCode 11002
#   apps/tpv-android/scripts/build-release-apk.sh          # → 1.0.0 / code 1
#   VERSION_NAME=1.0.1 VERSION_CODE=2 apps/tpv-android/scripts/build-release-apk.sh
#   ALLOW_DIRTY=1 apps/tpv-android/scripts/build-release-apk.sh 1.10.2
#
# Requisitos: keystore.properties relleno (ver keystore.properties.example) y
# toolchain Android (JAVA_HOME openjdk@17 + ANDROID_HOME commandlinetools).
set -euo pipefail

# --- Backend de producción (hallazgo A2: sin esto el WebView va a localhost) ---
export VITE_API_URL="${VITE_API_URL:-https://api.mipiacetpv.com}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ANDROID_DIR="$ROOT/apps/tpv-android/android"
WEB_DIST="$ROOT/apps/tpv-web/dist"
OUT_DIR="$ROOT/apps/tpv-android/build-releases"

export JAVA_HOME="${JAVA_HOME:-/usr/local/opt/openjdk@17}"
export ANDROID_HOME="${ANDROID_HOME:-/usr/local/share/android-commandlinetools}"

die() { echo "ERROR: $*" >&2; exit 1; }

# ─── Versionado determinista (A3-distribución, decisión 5) ──────────────────
#
# versionName = versión del TPV que se empaqueta, sin la `v`  → "1.10.2"
# versionCode = MAJOR*10000 + MINOR*100 + PATCH               → 11002
#
# Monótono mientras MINOR y PATCH no lleguen a 100 — de ahí la validación de
# rango. Si algún día hay una 1.100.0, su código colisionaría con el de la
# 2.0.0 y Android trataría la nueva versión como una degradación (se niega a
# instalar encima). Preferimos que el build pete aquí a descubrirlo en el bar.
derive_version_code() {
  local name="$1"
  local major minor patch
  IFS='.' read -r major minor patch <<<"$name"
  # 10# fuerza base decimal: sin él, un "08" se interpretaría como octal.
  (( 10#$minor < 100 )) || die "MINOR=$minor >= 100 rompe la fórmula del versionCode (decisión 5)."
  (( 10#$patch < 100 )) || die "PATCH=$patch >= 100 rompe la fórmula del versionCode (decisión 5)."
  echo $(( 10#$major * 10000 + 10#$minor * 100 + 10#$patch ))
}

[ $# -le 1 ] || die "uso: $(basename "$0") [versión]   (ej: $(basename "$0") 1.10.2)"

if [ $# -eq 1 ]; then
  # Aceptamos "1.10.2" y "v1.10.2": los tags del repo llevan la v, la versión
  # que Android enseña al usuario no.
  ARG_NAME="${1#v}"
  [[ "$ARG_NAME" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
    || die "versión '$1' no es MAJOR.MINOR.PATCH (ej: 1.10.2)."
  ARG_CODE="$(derive_version_code "$ARG_NAME")"

  # Retrocompatibilidad con las env vars, pero sin ambigüedad: si alguien pasa
  # las dos cosas y no coinciden, el nombre del fichero y lo que Android
  # registra dentro dirían versiones distintas. Eso no se avisa, se para.
  if [ -n "${VERSION_NAME:-}" ] && [ "$VERSION_NAME" != "$ARG_NAME" ]; then
    die "VERSION_NAME=$VERSION_NAME contradice el argumento '$ARG_NAME'. Usa uno u otro."
  fi
  if [ -n "${VERSION_CODE:-}" ] && [ "$VERSION_CODE" != "$ARG_CODE" ]; then
    die "VERSION_CODE=$VERSION_CODE contradice el derivado de '$ARG_NAME' ($ARG_CODE). Usa uno u otro."
  fi
  VERSION_NAME="$ARG_NAME"
  VERSION_CODE="$ARG_CODE"
else
  VERSION_NAME="${VERSION_NAME:-1.0.0}"
  VERSION_CODE="${VERSION_CODE:-1}"
fi

# ─── El nombre del fichero tiene que pasar el filtro de la API ──────────────
#
# El APK se llamará mipiacetpv-$VERSION_NAME-$VERSION_CODE.apk y ese nombre
# acaba TAL CUAL en el campo `fileName` de releases.json. La API sólo admite
# ahí `[A-Za-z0-9._-]` (FILE_NAME_RE en apps/api/src/releases/store.ts, porque
# el nombre viaja crudo dentro de Content-Disposition).
#
# Ese filtro está sólo en el lado que LEE, y descarta la entrada en silencio:
# un VERSION_NAME con un `+` o un espacio compila, firma, sube y escribe la
# entrada sin un solo error, y luego /apk/latest.json sigue anunciando la
# versión ANTERIOR porque la nueva no pasa el validador. Nadie sabe por qué.
# Se para aquí, antes de dos minutos de Vite y un gradle.
#
# La ruta del argumento ya obliga a MAJOR.MINOR.PATCH; ésta es la que cubre
# las env vars, que no validaban nada.
APK_NAME="mipiacetpv-${VERSION_NAME}-${VERSION_CODE}.apk"
[[ "$APK_NAME" =~ ^[A-Za-z0-9._-]{1,120}$ ]] || die "el nombre del APK quedaría '$APK_NAME',
       y la API sólo admite [A-Za-z0-9._-] en el fileName de releases.json.
       Con este nombre el APK se publicaría y latest.json se quedaría EN
       SILENCIO en la versión anterior. Revisa VERSION_NAME='$VERSION_NAME' y
       VERSION_CODE='$VERSION_CODE'."

# ─── Trazabilidad de build (A3-distribución) ────────────────────────────────
#
# Dos APKs con el mismo versionName pueden salir de árboles distintos si
# alguien reconstruyó con cambios locales encima. El sha corto viaja al sidecar
# y de ahí a releases.json (campo `gitSha`), para que en soporte se sepa qué
# commit tiene el terminal en la mano y no sólo qué versión.
#
# Por defecto el árbol tiene que estar limpio: un APK construido sobre cambios
# sin commitear no es reproducible y su sha no identifica nada. ALLOW_DIRTY=1
# permite el build de urgencia, pero lo marca `-dirty` para siempre — la marca
# viaja al sidecar, a releases.json y a la consola. Un build feo y honesto vale
# más que uno limpio y mentiroso.
#
# Va ANTES del build de tpv-web a propósito: fallar rápido, no tras dos minutos
# de Vite y un cap sync.
command -v git >/dev/null 2>&1 || die "git no disponible: no puedo registrar el commit del build."
git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1 \
  || die "$ROOT no es un repo git: no puedo registrar el commit del build."

GIT_SHA="$(git -C "$ROOT" rev-parse --short HEAD)"
GIT_DIRTY="$(git -C "$ROOT" status --porcelain)"
if [ -n "$GIT_DIRTY" ]; then
  if [ "${ALLOW_DIRTY:-0}" = "1" ]; then
    GIT_SHA="${GIT_SHA}-dirty"
    echo "AVISO: árbol sucio y ALLOW_DIRTY=1 → el build queda marcado como $GIT_SHA" >&2
    sed 's/^/         /' <<<"$GIT_DIRTY" >&2
  else
    die "el árbol de trabajo tiene cambios sin commitear:
$(sed 's/^/         /' <<<"$GIT_DIRTY")
       Un APK construido sobre esto no es reproducible y su sha no identifica
       nada. Commitea, o repite con ALLOW_DIRTY=1 para marcarlo como -dirty."
  fi
fi

# ─── Utilidades de toolchain ────────────────────────────────────────────────

# macOS trae `shasum`, la mayoría de Linux `sha256sum`.
sha256_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    die "no encuentro ni shasum ni sha256sum para calcular la huella."
  fi
}

# apksigner vive en build-tools/<versión>/. Cogemos la más alta disponible
# (sort -V, orden de versión y no alfabético: 34.0.0 > 9.0.0).
find_apksigner() {
  local dir
  [ -d "$ANDROID_HOME/build-tools" ] || return 1
  for dir in $(ls -1 "$ANDROID_HOME/build-tools" 2>/dev/null | sort -Vr); do
    if [ -x "$ANDROID_HOME/build-tools/$dir/apksigner" ]; then
      echo "$ANDROID_HOME/build-tools/$dir/apksigner"
      return 0
    fi
  done
  return 1
}

[ -f "$ANDROID_DIR/keystore.properties" ] \
  || die "falta $ANDROID_DIR/keystore.properties (copia keystore.properties.example y rellénalo)."

echo "==> VITE_API_URL=$VITE_API_URL  version=$VERSION_NAME ($VERSION_CODE)  commit=$GIT_SHA"

echo "==> 1/6 build tpv-web (dist con backend de producción)"
VITE_API_URL="$VITE_API_URL" pnpm --filter @mipiacetpv/tpv-web build

echo "==> 2/6 verificar que el backend quedó embebido en el dist"
# Hallazgo A2. tpv-web lee el backend con `import.meta.env.VITE_API_URL` a
# través de un cast (apps/tpv-web/src/api.ts:15), así que Vite no sustituye esa
# clave suelta sino el objeto `import.meta.env` entero — y ese objeto puede
# caer en cualquier chunk, no necesariamente en index-*.js. Por eso el grep va
# sobre TODOS los .js del dist. -F porque la URL es literal: los '.' de un
# regex casarían cualquier carácter.
if ! grep -rqF -- "$VITE_API_URL" "$WEB_DIST/assets/"*.js 2>/dev/null; then
  die "'$VITE_API_URL' NO aparece en $WEB_DIST/assets/*.js.
       El APK quedaría sin backend (hallazgo A2): instala bien y no hace login,
       ni baja catálogo, ni cobra. Revisa que VITE_API_URL llegó al build."
fi
echo "    OK · '$VITE_API_URL' presente en el bundle"

echo "==> 3/6 cap sync android (copia dist + plugins al proyecto nativo)"
( cd "$ROOT/apps/tpv-android" && pnpm exec cap sync android )

echo "==> 4/6 verificar el bundle YA SINCRONIZADO al proyecto nativo"
# El paso 2 valida el dist; éste valida lo que Capacitor copió de verdad. Son
# comprobaciones distintas: un `cap sync` que falla a medias, o un
# assets/public/ viejo de un build anterior, dejarían el dist correcto y el APK
# apuntando a otro sitio. Lo que se empaqueta es esto, no el dist.
SYNCED_ASSETS="$ANDROID_DIR/app/src/main/assets/public/assets"
if ! grep -rqF -- "$VITE_API_URL" "$SYNCED_ASSETS"/*.js 2>/dev/null; then
  die "'$VITE_API_URL' NO aparece en $SYNCED_ASSETS/*.js.
       El dist estaba bien pero lo sincronizado al proyecto nativo no lo está."
fi
echo "    OK · '$VITE_API_URL' presente en los assets del proyecto nativo"

echo "==> 5/6 gradlew assembleRelease (APK firmado)"
( cd "$ANDROID_DIR" && ./gradlew assembleRelease -PversionName="$VERSION_NAME" -PversionCode="$VERSION_CODE" )

GRADLE_APK="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
[ -f "$GRADLE_APK" ] || die "gradle terminó pero no encuentro $GRADLE_APK."

echo "==> 6/6 verificar firma, renombrar y calcular huella"

# --- Firma ---------------------------------------------------------------
# Antes este script sólo IMPRIMÍA cómo verificar la firma y daba el build por
# bueno. Un APK sin firmar (keystore.properties a medias, variable perdida) se
# genera igual y falla al instalar, ya en el bar. Aquí se aborta.
if APKSIGNER="$(find_apksigner)"; then
  echo "    verificando con $APKSIGNER"
  "$APKSIGNER" verify --print-certs "$GRADLE_APK" \
    || die "el APK NO está correctamente firmado. No se publica."
else
  # jarsigner no devuelve código de error en todas las versiones cuando el jar
  # está sin firmar: se limita a escribir "jar is unsigned". Por eso miramos la
  # salida y no sólo el exit code.
  echo "    apksigner no disponible en $ANDROID_HOME/build-tools; uso jarsigner"
  command -v jarsigner >/dev/null 2>&1 \
    || die "ni apksigner ni jarsigner disponibles: no puedo verificar la firma."
  JARSIGNER_OUT="$(jarsigner -verify -verbose -certs "$GRADLE_APK" 2>&1)" || true
  grep -q "jar verified" <<<"$JARSIGNER_OUT" \
    || die "el APK NO está correctamente firmado (jarsigner no dice 'jar verified'). No se publica.
$JARSIGNER_OUT"
  grep -E "Signer|jar verified" <<<"$JARSIGNER_OUT" || true
fi
echo "    OK · firmado"

# --- Renombrado a la carpeta de publicación ------------------------------
# Fuera de app/build/outputs: ese directorio lo borra `gradlew clean` y todos
# los builds escriben ahí el mismo app-release.apk, así que dos versiones
# seguidas se pisan y luego es imposible saber cuál es cuál. build-releases/
# está en .gitignore (ver apps/tpv-android/.gitignore).
mkdir -p "$OUT_DIR"
# APK_NAME se calculó y validó arriba, antes de compilar.
APK="$OUT_DIR/$APK_NAME"
cp "$GRADLE_APK" "$APK"

# --- Huella y sidecar ----------------------------------------------------
# El sidecar cumple DOS papeles a la vez:
#   1. Verificable con `shasum -a 256 -c <fichero>.sha256` tal cual, que es lo
#      que hará un humano en el VPS.
#   2. Portador del gitSha hacia releases.json, que lee infra/publicar-apk.sh.
# La línea de metadatos va como comentario para no romper (1). Comprobado:
# `shasum -a 256 -c` (macOS) la ignora en silencio; `sha256sum -c` (GNU, el del
# VPS) avisa "1 line is improperly formatted" pero devuelve 0 y valida bien.
# publicar-apk.sh compara los hashes por extracción, no con -c, para que el
# camino normal salga sin ese aviso.
SHA256="$(sha256_of "$APK")"
{
  printf '# gitSha=%s versionName=%s versionCode=%s\n' "$GIT_SHA" "$VERSION_NAME" "$VERSION_CODE"
  printf '%s  %s\n' "$SHA256" "$APK_NAME"
} > "$APK.sha256"

APK_SIZE="$(wc -c < "$APK" | tr -d ' ')"

echo
echo "════════════════════════════════════════════════════════════════════"
echo "  APK firmado y listo para publicar"
echo "════════════════════════════════════════════════════════════════════"
echo "  fichero      $APK"
echo "  versión      $VERSION_NAME (versionCode $VERSION_CODE)"
echo "  commit       $GIT_SHA"
echo "  tamaño       $APK_SIZE bytes"
echo "  SHA-256      $SHA256"
echo "  sidecar      $APK.sha256"
echo "════════════════════════════════════════════════════════════════════"
echo
echo "Publicar en el VPS (desde el Mac, Cowork no tiene red):"
echo "    infra/publicar-apk.sh \"$APK\""
echo
echo "Instalar por cable (terminal con depuración USB activada):"
echo "    adb install -r \"$APK\""
