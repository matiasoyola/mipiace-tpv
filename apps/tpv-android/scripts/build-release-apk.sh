#!/usr/bin/env bash
# Build del APK firmado de mipiacetpv para INSTALACIÓN DIRECTA (sideload) en los
# terminales AP12 de los pilotos. Alternativa rápida a Play: no hay revisión ni
# closed-testing; instalas el .apk en el terminal hoy.
#
# Gemelo de build-release-aab.sh pero con assembleRelease (APK) en vez de
# bundleRelease (.aab). Misma firma, mismo VITE_API_URL de producción.
#
# Uso:
#   apps/tpv-android/scripts/build-release-apk.sh                 # 1.0.0 / code 1
#   VERSION_NAME=1.0.1 VERSION_CODE=2 apps/tpv-android/scripts/build-release-apk.sh
#
# Requisitos: keystore.properties relleno (ver keystore.properties.example) y
# toolchain Android (JAVA_HOME openjdk@17 + ANDROID_HOME commandlinetools).
set -euo pipefail

# --- Backend de producción (hallazgo A2: sin esto el WebView va a localhost) ---
export VITE_API_URL="${VITE_API_URL:-https://api.mipiacetpv.com}"

VERSION_NAME="${VERSION_NAME:-1.0.0}"
VERSION_CODE="${VERSION_CODE:-1}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ANDROID_DIR="$ROOT/apps/tpv-android/android"

export JAVA_HOME="${JAVA_HOME:-/usr/local/opt/openjdk@17}"
export ANDROID_HOME="${ANDROID_HOME:-/usr/local/share/android-commandlinetools}"

if [ ! -f "$ANDROID_DIR/keystore.properties" ]; then
  echo "ERROR: falta $ANDROID_DIR/keystore.properties (copia keystore.properties.example y rellenalo)." >&2
  exit 1
fi

echo "==> VITE_API_URL=$VITE_API_URL  version=$VERSION_NAME ($VERSION_CODE)"

echo "==> 1/3 build tpv-web (dist con backend de produccion)"
VITE_API_URL="$VITE_API_URL" pnpm --filter @mipiacetpv/tpv-web build

echo "==> 2/3 cap sync android (copia dist + plugins al proyecto nativo)"
( cd "$ROOT/apps/tpv-android" && pnpm exec cap sync android )

echo "==> 3/3 gradlew assembleRelease (APK firmado)"
( cd "$ANDROID_DIR" && ./gradlew assembleRelease -PversionName="$VERSION_NAME" -PversionCode="$VERSION_CODE" )

APK="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
echo
echo "==> APK firmado en:"
echo "    $APK"
echo
echo "Instalar en el terminal AP12 (conectado por USB, depuracion USB activada):"
echo "    adb install -r \"$APK\""
echo "O copia el .apk al terminal y abrelo (permitir 'instalar apps desconocidas')."
echo
echo "Verifica la firma:  jarsigner -verify -verbose -certs \"$APK\""
