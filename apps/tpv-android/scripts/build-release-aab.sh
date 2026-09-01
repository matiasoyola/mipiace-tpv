#!/usr/bin/env bash
# Build del .aab firmado de mipiacetpv para Play Store (canal interno/cerrado).
#
# CRÍTICO (hallazgo A2): el APK/AAB empaqueta el dist de Vite de tpv-web. Sin
# VITE_API_URL apuntando al backend de producción, el WebView resuelve contra
# https://localhost y la app queda SIN backend (ni login, ni catálogo, ni
# cobros). Por eso este script FIJA VITE_API_URL antes de construir el web.
#
# Uso:
#   apps/tpv-android/scripts/build-release-aab.sh                 # 1.0.0 / code 1
#   VERSION_NAME=1.0.1 VERSION_CODE=2 apps/tpv-android/scripts/build-release-aab.sh
#
# Requisitos: keystore.properties relleno (ver keystore.properties.example) y
# toolchain Android (JAVA_HOME openjdk@17 + ANDROID_HOME commandlinetools).
set -euo pipefail

# --- Backend de producción (cambiar aquí si algún día hay staging) ---
export VITE_API_URL="${VITE_API_URL:-https://api.mipiacetpv.com}"
# Nota: tpv-web sólo consume VITE_API_URL para el backend. VITE_BUILD_HASH lo
# resuelve Vite del git HEAD; VITE_SENTRY_DSN es opcional. VITE_TPV_URL NO se
# consume en el código actual (grep en apps/tpv-web/src): no hace falta fijarlo.

# --- Destino del bundle (hallazgo A4) ---
# Gemelo de build-release-apk.sh. Con VITE_TARGET=android, tpv-web no genera
# Service Worker: dentro de la APK/AAB los assets ya son locales y el SW no
# aporta offline, pero SÍ se registra contra el origen real (server.hostname),
# baja el sw.js del VPS y a partir de ahí el terminal sirve producción para
# siempre. No es sobreescribible.
export VITE_TARGET="android"

VERSION_NAME="${VERSION_NAME:-1.0.0}"
VERSION_CODE="${VERSION_CODE:-1}"

# Raíz del monorepo (dos niveles por encima de este script).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ANDROID_DIR="$ROOT/apps/tpv-android/android"

# --- Toolchain (mismos valores que A0-done.md) ---
export JAVA_HOME="${JAVA_HOME:-/usr/local/opt/openjdk@17}"
export ANDROID_HOME="${ANDROID_HOME:-/usr/local/share/android-commandlinetools}"

if [ ! -f "$ANDROID_DIR/keystore.properties" ]; then
  echo "ERROR: falta $ANDROID_DIR/keystore.properties (copia keystore.properties.example y rellénalo)." >&2
  exit 1
fi

echo "==> VITE_API_URL=$VITE_API_URL  VITE_TARGET=$VITE_TARGET  version=$VERSION_NAME ($VERSION_CODE)"

echo "==> 1/3 build tpv-web (dist con backend de producción, sin Service Worker)"
VITE_API_URL="$VITE_API_URL" VITE_TARGET="$VITE_TARGET" pnpm --filter @mipiacetpv/tpv-web build

# Hallazgo A4: un sw.js aquí significa que el build volvió a generar Service
# Worker y que el .aab acabaría sirviendo producción en el terminal.
if [ -e "$ROOT/apps/tpv-web/dist/sw.js" ] || [ -e "$ROOT/apps/tpv-web/dist/registerSW.js" ]; then
  echo "ERROR: el dist de Android contiene un Service Worker (hallazgo A4)." >&2
  echo "       Revisa que VITE_TARGET=android llegó al build." >&2
  exit 1
fi

echo "==> 2/3 cap sync android (copia dist + plugins al proyecto nativo)"
( cd "$ROOT/apps/tpv-android" && pnpm exec cap sync android )

echo "==> 3/3 gradlew bundleRelease (.aab firmado)"
( cd "$ANDROID_DIR" && ./gradlew bundleRelease -PversionName="$VERSION_NAME" -PversionCode="$VERSION_CODE" )

AAB="$ANDROID_DIR/app/build/outputs/bundle/release/app-release.aab"
echo
echo "==> .aab firmado en:"
echo "    $AAB"
echo "Verifica la firma:  jarsigner -verify -verbose -certs \"$AAB\""
