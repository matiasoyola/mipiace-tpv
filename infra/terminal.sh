#!/usr/bin/env bash
# A5 · Frente 5 · la escalada: shell de verdad contra un terminal.
#
# Generaliza `~/bin/tpv.sh`, que tenía la IP de casa quemada (192.168.5.75) y
# sólo servía para un terminal. Aquí el terminal se resuelve POR NOMBRE contra
# el inventario del frente 2 (GET /super-admin/devices), que es el único sitio
# donde ya está escrito qué terminales existen y en qué IP se vio a cada uno.
#
#   infra/terminal.sh estado
#   infra/terminal.sh connect "barra de Sirope"
#   infra/terminal.sh mirror  "barra de Sirope"
#   infra/terminal.sh logs    "barra de Sirope"
#   infra/terminal.sh install "barra de Sirope" apps/tpv-android/build-releases/....apk
#
# ── CUÁNDO USAR ESTO Y CUÁNDO NO ──────────────────────────────────────────
# Esto es LA ESCALADA, no el camino normal. Para ver si un terminal está vivo,
# qué versión lleva, cuánta cola tiene o para pedirle una captura está el panel
# (frentes 2 y 3), que funciona detrás de cualquier router y sin instalar nada.
# Aquí se baja sólo cuando hace falta un shell: un `adb install -r` para
# actualizar sin desplazarse, o un logcat que el volcado de logs no cubre.
#
# ── EL PERMISO DE RED LOCAL DE macOS (esto muerde de verdad) ──────────────
# macOS bloquea la red local al proceso que arranca el servidor de adb si ese
# proceso no tiene el permiso concedido. El síntoma NO es un error de permisos:
# es `No route to host` o `Operation timed out` contra TODA la LAN, incluidas
# IPs que responden al ping desde la misma máquina.
#
# El servidor de adb hay que arrancarlo DESDE Terminal.app (o iTerm), a mano,
# una vez:
#
#     adb start-server
#
# y conceder el permiso cuando macOS lo pregunte (Ajustes → Privacidad y
# seguridad → Red local). Un `adb start-server` lanzado desde un editor, desde
# un agente o desde un cron hereda el bloqueo y NO funciona, aunque `adb` sea
# el mismo binario. Verificado el 2026-09-05 desde esta sesión: `adb connect`
# a un terminal de la misma subred devolvió `Operation timed out`.
set -euo pipefail

API_URL="${MIPIACETPV_API_URL:-https://api.mipiacetpv.com}"
ADB="${ADB:-/Users/matiasoyolasanchez/adb35/platform-tools/adb}"
SCRCPY="${SCRCPY:-/usr/local/bin/scrcpy}"
PORT="${TERMINAL_ADB_PORT:-5555}"

die() { echo "ERROR: $*" >&2; exit 1; }

command -v jq >/dev/null 2>&1 || die "hace falta jq (brew install jq)."
[ -x "$ADB" ] || die "no encuentro adb en $ADB (exporta ADB=/ruta/al/adb)."

# ── El inventario ──────────────────────────────────────────────────────────
#
# El token de super-admin es el mismo que usa el panel. Se coge de la variable
# de entorno y NO se escribe en ningún sitio: ni en un fichero, ni en el
# historial (por eso no es un argumento), ni en la salida.
inventario() {
  [ -n "${MIPIACETPV_SA_TOKEN:-}" ] \
    || die "falta MIPIACETPV_SA_TOKEN (token de super-admin).
       Sácalo del panel y expórtalo en la sesión:
           export MIPIACETPV_SA_TOKEN='...'
       No lo pases como argumento: acabaría en el historial del shell."
  curl -fsS -H "Authorization: Bearer $MIPIACETPV_SA_TOKEN" \
    "$API_URL/super-admin/devices" \
    || die "no he podido leer el inventario de $API_URL. ¿Token caducado?"
}

# Resuelve un nombre (o trozo de nombre) a la IP local que el terminal reportó
# en su último latido. Case-insensitive y por subcadena: "sirope" basta.
#
# Se busca en el nombre del device, en el de la caja y en el de la tienda,
# porque un terminal sin `name` propio se identifica por dónde está.
resolver_ip() {
  local patron="$1"
  inventario | jq -r --arg p "$patron" '
    .devices
    | map(select(
        ((.name // "") + " " + (.registerName // "") + " " + (.storeName // "") + " " + (.tenantName // ""))
        | ascii_downcase | contains($p | ascii_downcase)
      ))
    | if length == 0 then
        "SIN_COINCIDENCIA"
      elif length > 1 then
        "AMBIGUO:" + (map((.name // .registerName) + " [" + (.storeName // "?") + "]") | join(" · "))
      else
        (.[0].heartbeat.localIp // "SIN_IP")
      end'
}

listar() {
  inventario | jq -r '
    "ÚLTIMA APK PUBLICADA: " +
      (if .latestRelease then .latestRelease.versionName + " (" + (.latestRelease.versionCode|tostring) + ")" else "ninguna" end),
    "",
    (.devices[] |
      ((if .online then "●" else "○" end) + " " +
       ((.name // .registerName // .id)) +
       "  [" + (.storeName // "?") + " · " + (.tenantName // "?") + "]" +
       "  v" + (.heartbeat.appVersionName // "?") +
       (if .outdated then " ⚠ DESACTUALIZADO" else "" end) +
       "  ip=" + (.heartbeat.localIp // "?") +
       "  cola=" + ((.heartbeat.outboxPending // 0)|tostring) +
       (if .revokedAt then "  ⛔ REVOCADO" else "" end)))'
}

# `estado` sin argumento lista la flota; con argumento, resuelve uno.
ip_de() {
  local patron="$1" ip
  ip="$(resolver_ip "$patron")"
  case "$ip" in
    SIN_COINCIDENCIA) die "ningún terminal coincide con '$patron'. Pruébalo con: $(basename "$0") estado" ;;
    SIN_IP) die "el terminal '$patron' existe pero nunca reportó IP local: no se ha anunciado todavía, o el último latido es de antes de A5." ;;
    AMBIGUO:*) die "'$patron' coincide con varios: ${ip#AMBIGUO:}" ;;
    "") die "respuesta vacía del inventario." ;;
  esac
  echo "$ip"
}

conectar() {
  local ip="$1"
  # Cinco intentos: el AP11 se cae de la red cuando está ocioso y vuelve al
  # tocarlo, así que el primer intento falla a menudo y el segundo entra.
  # Si fallan los cinco, el problema es otro (adbd caído, o el permiso de red
  # local de macOS).
  local i
  for i in 1 2 3 4 5; do
    if "$ADB" connect "$ip:$PORT" 2>&1 | grep -qE "connected to"; then
      if "$ADB" devices | grep -q "$ip:$PORT[[:space:]]*device"; then
        echo "OK · conectado a $ip:$PORT"
        return 0
      fi
    fi
    echo "    intento $i sin éxito..." >&2
    sleep 2
  done
  die "no he podido conectar con $ip:$PORT tras 5 intentos.

       Por orden de probabilidad:
       1. El terminal está ocioso y se ha caído de la red. Tócale la pantalla
          y repite. (Es el comportamiento conocido del AP11.)
       2. adbd no está escuchando en el puerto. El interruptor de depuración
          por red del menú de fábrica puede VERSE activado con adbd caído:
          comprueba el puerto, no el interruptor. Requiere \`adb tcpip $PORT\`
          por cable, y NO sobrevive a un reinicio sin root.
       3. El servidor de adb no tiene permiso de Red Local de macOS. Arráncalo
          A MANO desde Terminal.app con \`adb start-server\` y concede el
          permiso. Desde un editor o un agente da 'Operation timed out' contra
          toda la LAN."
}

[ $# -ge 1 ] || {
  cat >&2 <<USO
uso: $(basename "$0") <orden> [terminal] [args]

  estado                    lista la flota (online, versión, IP, cola)
  estado   <terminal>       resuelve un terminal a su IP
  connect  <terminal>       conecta adb por red
  mirror   <terminal>       scrcpy (ver y tocar la pantalla)
  logs     <terminal>       logcat de nuestra app
  install  <terminal> <apk> adb install -r  (actualizar sin desplazarse)

El <terminal> es un trozo del nombre del device, de la caja, de la tienda o de
la cuenta: "sirope" basta. Sale del inventario del panel, no de una IP a mano.
USO
  exit 1
}

ORDEN="$1"; shift || true

case "$ORDEN" in
  estado)
    if [ $# -eq 0 ]; then listar; else echo "$(ip_de "$1")"; fi
    ;;
  connect)
    [ $# -ge 1 ] || die "uso: $(basename "$0") connect <terminal>"
    conectar "$(ip_de "$1")"
    ;;
  mirror)
    [ $# -ge 1 ] || die "uso: $(basename "$0") mirror <terminal>"
    [ -x "$SCRCPY" ] || die "no encuentro scrcpy en $SCRCPY."
    IP="$(ip_de "$1")"; conectar "$IP"
    PATH="$(dirname "$ADB"):$PATH" "$SCRCPY" -s "$IP:$PORT" \
      --window-title "TPV $1" --max-size 1280
    ;;
  logs)
    [ $# -ge 1 ] || die "uso: $(basename "$0") logs <terminal>"
    IP="$(ip_de "$1")"; conectar "$IP"
    # Sólo lo nuestro: un logcat entero de un Android de fábrica es ilegible.
    "$ADB" -s "$IP:$PORT" logcat -v time \
      Capacitor:V CapacitorConsole:V MainActivity:V WebViewRescue:V SupportAgent:V "*:S"
    ;;
  install)
    [ $# -ge 2 ] || die "uso: $(basename "$0") install <terminal> <apk>"
    APK="$2"
    [ -f "$APK" ] || die "no encuentro el APK: $APK"
    IP="$(ip_de "$1")"; conectar "$IP"
    # -r: reinstalar conservando datos. Es la clave de todo el frente: sin -r
    # se pierde el localStorage y con él la VINCULACIÓN del terminal, que es
    # exactamente el incidente del 2026-09-04 por otra puerta.
    echo "==> adb install -r (conserva datos: la vinculación vive en localStorage)"
    "$ADB" -s "$IP:$PORT" install -r "$APK"
    ;;
  *)
    die "orden desconocida: $ORDEN"
    ;;
esac
