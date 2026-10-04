#!/usr/bin/env bash
# Monta el vídeo del banco: un MP4 por capítulo y uno completo.
#
#   pnpm --filter @mipiacetpv/e2e-ui run video     # graba (BANCO_VIDEO=1)
#   apps/e2e-ui/video/montar.sh                    # monta
#
# De dónde sale cada trozo: Playwright escribe un `video.webm` por test en
# `apps/e2e-ui/resultados/<carpeta-del-test>/`. Los trozos de un capítulo se
# ordenan por FECHA DEL FICHERO y no por nombre de carpeta: el nombre lo
# slugifica Playwright a partir del título, y alfabéticamente el capítulo 1
# quedaría «TPV sin agenda → TPV con agenda → la dueña la enciende», que
# cuenta la película al revés. La fecha es el orden en que pasaron.
#
# Las PORTADAS y las cortinillas no las pinta ffmpeg: las pinta el navegador
# dentro del propio vídeo. Cada capítulo abre con un `portada()` a pantalla
# completa inyectado por su spec (`lib/rotulo.ts`), y el capítulo 1 abre con
# «La agenda, de cero a un día normal», que es la portada del vídeo entero.
#
# No es un apaño: es mejor. El ffmpeg de este Mac viene SIN el filtro
# `drawtext` (sin libfreetype: «No such filter: drawtext»), y aunque lo
# trajera, un rótulo pintado por el navegador sale con la tipografía y los
# colores de la app en vez de con otros.
#
# Los vídeos NO entran en git (pesan): salen a
# ~/Developer/Claude/Projects/mipiacetpv-media/agenda/.
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTADOS="$AQUI/../resultados"
SALIDA="${BANCO_VIDEO_SALIDA:-$HOME/Developer/Claude/Projects/mipiacetpv-media/agenda}"
TRABAJO="$(mktemp -d)"
trap 'rm -rf "$TRABAJO"' EXIT

# 1080p: el vídeo de Playwright es 1920×1200 (el AP11 a deviceScaleFactor
# 1,5) y las vistas de panel y móvil vienen con otra forma. Se escala sin
# deformar y se rellena con negro hasta 1920×1080.
# `lanczos` porque esto AMPLÍA: cada pantalla graba a su tamaño CSS
# (1280×800 el TPV, 390×844 el móvil) y de ahí a 1080p hay que subir.
ESCALA="scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,fps=25,format=yuv420p"

CAPITULOS=(
  "01:encender:Capítulo 1 · Encender la agenda"
  "02:servicios:Capítulo 2 · Los servicios y su duración"
  "03:equipo:Capítulo 3 · El equipo"
  "04:horario:Capítulo 4 · El horario del centro"
  "05:salud:Capítulo 5 · ¿Está la agenda sana?"
  "06:reservar:Capítulo 6 · Reservar, y los no"
  "07:el-dia:Capítulo 7 · Un día normal"
  "08:cobrar:Capítulo 8 · Cobrar la cita"
  "09:cerrar-el-dia:Capítulo 9 · Cerrar el día"
  "10:sin-red:Capítulo 10 · Sin red"
)

if [ ! -d "$RESULTADOS" ]; then
  echo "No hay $RESULTADOS. Graba primero:" >&2
  echo "  pnpm --filter @mipiacetpv/e2e-ui run video" >&2
  exit 1
fi

mkdir -p "$SALIDA"
: > "$TRABAJO/completo.txt"
echo "Montando en $SALIDA"

# La duración, en «m:ss». Redondea con awk y no con `printf '%.0f'`: el bash
# de este Mac tiene la coma decimal del locale y «27.680000» le parece un
# número inválido.
duracion() {
  ffprobe -v error -show_entries format=duration -of csv=p=0 "$1" |
    awk '{ s = int($1 + 0.5); printf "%d:%02d", int(s / 60), s % 60 }'
}

for entrada in "${CAPITULOS[@]}"; do
  IFS=":" read -r num nombre titulo <<< "$entrada"
  # `titulo` es sólo la etiqueta del listado: el rótulo ya va dentro del vídeo.

  # Los trozos del capítulo, por fecha de fichero = orden de ejecución.
  # Sin `mapfile`: el bash de macOS es el 3.2 y no lo tiene.
  trozos=()
  while IFS= read -r linea; do
    [ -n "$linea" ] && trozos+=("$linea")
  done < <(
    find "$RESULTADOS" -type f -name "video.webm" -path "*/${num}-*" 2>/dev/null |
      while IFS= read -r f; do stat -f "%m %N" "$f"; done |
      sort -n | cut -d" " -f2-
  )
  if [ "${#trozos[@]}" -eq 0 ]; then
    echo "  · $num-$nombre: sin vídeo (¿no se grabó?)" >&2
    continue
  fi

  : > "$TRABAJO/$num.txt"
  i=0
  for t in "${trozos[@]}"; do
    i=$((i + 1))
    normalizado="$TRABAJO/$num-$i.mp4"
    ffmpeg -nostdin -loglevel error -y -i "$t" -vf "$ESCALA" \
      -r 25 -c:v libx264 -preset medium -crf 21 -an "$normalizado"
    echo "file '$normalizado'" >> "$TRABAJO/$num.txt"
  done

  CAP="$SALIDA/$num-$nombre.mp4"
  ffmpeg -nostdin -loglevel error -y -f concat -safe 0 -i "$TRABAJO/$num.txt" \
    -c copy "$CAP"
  printf "  · %-22s %6s  (%d trozo%s)\n" \
    "$num-$nombre.mp4" "$(duracion "$CAP")" \
    "${#trozos[@]}" "$([ "${#trozos[@]}" -eq 1 ] || echo s)"

  echo "file '$CAP'" >> "$TRABAJO/completo.txt"
done

COMPLETO="$SALIDA/agenda-completo.mp4"
ffmpeg -nostdin -loglevel error -y -f concat -safe 0 -i "$TRABAJO/completo.txt" \
  -c copy "$COMPLETO"
printf "\n  = %-22s %6s\n" "agenda-completo.mp4" "$(duracion "$COMPLETO")"
