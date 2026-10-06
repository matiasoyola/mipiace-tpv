// clinica-3 · EL MAPA DE LOS DOS PIES, con zonas táctiles.
//
// Es el mapa del mockup validado (`docs/mockups/clinica-3-sesion.html`):
// el contorno del pie y once elipses por pie, el derecho espejado. Se toca
// la zona y se elige qué tiene.
//
// ── Por qué SVG y no once botones absolutos ──────────────────────────
//
// Porque las zonas tienen que caer DONDE ESTÁ la parte del pie, y eso es
// geometría. Con `div`s posicionados en porcentajes, cada cambio del
// contorno obligaría a recalcular once pares de coordenadas a mano y el
// pie dejaría de escalar en bloque. Con un `viewBox`, el pie entero escala
// y las zonas van pegadas a él por construcción.
//
// Y son `<ellipse>` y no `<path>` recortados porque el objetivo táctil
// tiene que ser MEDIBLE: un radio en unidades del viewBox por la escala
// del SVG es una multiplicación, y eso es lo que permite afirmar «ninguna
// zona baja de 48 px» y comprobarlo en la captura.
//
// ── El objetivo táctil ───────────────────────────────────────────────
//
// `ANCHO_DEL_PIE_PX` (264) viene del paquete compartido, al lado del radio
// mínimo (22 unidades sobre un viewBox de 240). La cuenta: 2 × 22 × 264/240
// = 48,4 px, que es el peldaño `touch` de la casa (`docs/design/tokens.md`
// §4) y pasa de sobra el ≥ 44 px que pide el prompt.
//
// El ancho es un TOPE y no un fijo (`max-width`), así que a 320 px el pie
// se encoge con la pantalla... y ahí el mínimo bajaría. Por eso en móvil
// los pies no van uno al lado del otro: **bajan a una fila cada uno**
// (prompt §5), y una fila de 320 px menos los márgenes da 288, que es más
// que 264. O sea: el pie nunca se pinta por debajo de su ancho nominal, y
// el mínimo táctil se cumple en los tres tamaños del bucle visual.
//
// ── La accesibilidad del mapa ────────────────────────────────────────
//
// Cada zona es un `<ellipse role="button">` con su `aria-label` completo
// («Pie izquierdo · Dedo gordo») y `tabIndex`, así que se recorre con
// teclado y un lector de pantalla la nombra entera. Un mapa que sólo
// funciona con el dedo deja fuera a quien lo necesite — y en una pantalla
// donde lo que se marca es una úlcera, eso no es un detalle.

import {
  ANCHO_DEL_PIE_PX,
  CONTORNO_DEL_PIE,
  NOMBRE_DEL_PIE,
  PIES,
  VIEWBOX,
  claveDeZona,
  type MapaDelPie as MapaVersionado,
  type Pie,
} from "@mipiacetpv/clinica-sesion";

/** Cómo se pinta una zona. El orden del `switch` es el de prioridad. */
export type EstadoDeZona =
  /** Marcada HOY: naranja pleno. */
  | "hoy"
  /** Lo de la visita anterior: naranja suave. */
  | "anterior"
  /** Seleccionada para elegir lesión: borde oscuro. */
  | "elegida"
  /** Sin nada. */
  | "libre";

const RELLENO: Record<EstadoDeZona, string> = {
  hoy: "fill-mipiace-coral stroke-mipiace-coral-dark",
  anterior: "fill-mipiace-coral-soft stroke-mipiace-coral",
  elegida: "fill-white stroke-mipiace-ink",
  libre: "fill-white stroke-slate-300",
};

export function MapaDelPie(props: {
  mapa: MapaVersionado;
  /** Qué estado tiene cada clave (`"L:h"`). Lo decide quien llama: la
   *  sesión mira marcas de hoy y de la anterior, la exploración mira
   *  puntos sin sensibilidad. Esta pieza no sabe de lesiones. */
  estadoDe: (clave: string) => EstadoDeZona;
  /** `true` sobre la zona que está abierta en el panel de abajo. */
  seleccionada: string | null;
  onTocar: (clave: string) => void;
  /** Por si el mapa se pinta sólo para mirar (una sesión ya cerrada). */
  soloLectura?: boolean;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-3">
      {PIES.map((pie) => (
        <div
          key={pie}
          className="flex flex-col items-center text-[12px] text-slate-500"
        >
          <Pie
            pie={pie}
            mapa={props.mapa}
            estadoDe={props.estadoDe}
            seleccionada={props.seleccionada}
            onTocar={props.onTocar}
            soloLectura={props.soloLectura ?? false}
          />
          {pie === "L" ? "Izquierdo" : "Derecho"}
        </div>
      ))}
    </div>
  );
}

function Pie(props: {
  pie: Pie;
  mapa: MapaVersionado;
  estadoDe: (clave: string) => EstadoDeZona;
  seleccionada: string | null;
  onTocar: (clave: string) => void;
  soloLectura: boolean;
}) {
  // El derecho es el izquierdo espejado, que es lo que un pie es. Se
  // espeja el GRUPO entero (contorno y zonas juntos) para que las zonas no
  // se puedan desalinear del contorno ni por un píxel.
  const flip =
    props.pie === "R" ? `translate(${VIEWBOX.ancho},0) scale(-1,1)` : undefined;
  return (
    <svg
      viewBox={`0 0 ${VIEWBOX.ancho} ${VIEWBOX.alto}`}
      // El ancho NOMINAL como tope, y `width:100%` para que no desborde
      // una columna estrecha. Ver la cabecera sobre por qué en móvil los
      // pies van en filas separadas.
      style={{ width: "100%", maxWidth: ANCHO_DEL_PIE_PX }}
      className="h-auto select-none"
      role="group"
      aria-label={`Mapa del ${NOMBRE_DEL_PIE[props.pie].toLowerCase()}`}
    >
      <g transform={flip}>
        <path
          d={CONTORNO_DEL_PIE}
          className="fill-mipiace-stone stroke-slate-300"
          strokeWidth={2}
        />
        {props.mapa.zonas.map((z) => {
          const clave = claveDeZona(props.pie, z.id);
          const estado = props.estadoDe(clave);
          const elegida = props.seleccionada === clave;
          return (
            <ellipse
              key={clave}
              cx={z.cx}
              cy={z.cy}
              rx={z.rx}
              ry={z.ry}
              data-zona={clave}
              className={[
                RELLENO[estado],
                elegida ? "stroke-mipiace-ink" : "",
                props.soloLectura ? "" : "cursor-pointer",
                "transition-[fill] duration-150 motion-reduce:transition-none",
              ].join(" ")}
              strokeWidth={elegida ? 3 : estado === "libre" ? 1.5 : 2}
              // Un `ellipse` no es focusable ni pulsable por sí solo: el
              // rol, el tabIndex y el `onKeyDown` lo convierten en un
              // botón de verdad para el teclado y para un lector de
              // pantalla. Sin esto el mapa sería sólo para dedos.
              role={props.soloLectura ? "img" : "button"}
              tabIndex={props.soloLectura ? -1 : 0}
              aria-label={`${NOMBRE_DEL_PIE[props.pie]} · ${z.label}`}
              aria-pressed={
                props.soloLectura ? undefined : estado === "hoy"
              }
              onClick={
                props.soloLectura ? undefined : () => props.onTocar(clave)
              }
              onKeyDown={
                props.soloLectura
                  ? undefined
                  : (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        props.onTocar(clave);
                      }
                    }
              }
            />
          );
        })}
      </g>
    </svg>
  );
}

/** La leyenda del mapa. Dos variantes, una por pestaña. */
export function LeyendaDelMapa(props: { modo: "sesion" | "exploracion" }) {
  const items =
    props.modo === "sesion"
      ? ([
          ["bg-mipiace-coral-soft border border-mipiace-coral", "Visita anterior"],
          ["bg-mipiace-coral", "Hoy"],
        ] as const)
      : ([["bg-mipiace-coral", "No siente el monofilamento"]] as const);
  return (
    <div className="flex gap-4 flex-wrap justify-center text-[12px] text-slate-500 mt-2.5">
      {items.map(([clase, texto]) => (
        <span key={texto} className="inline-flex items-center gap-1.5">
          <i className={`inline-block w-3 h-3 rounded-md ${clase}`} />
          {texto}
        </span>
      ))}
    </div>
  );
}
