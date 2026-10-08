// clinica-3 · EL MAPA DE LOS DOS PIES, con zonas táctiles.
//
// Es el mapa del mockup validado (`docs/mockups/clinica-3-sesion.html`):
// el contorno del pie y once elipses por pie, **el IZQUIERDO espejado**.
// Se toca la zona y se elige qué tiene.
//
// (Decía «el derecho espejado» hasta clinica-6, y el código hacía eso: era
// el fallo de píxeles que dejaba los dedos gordos hacia fuera. Ver el
// porqué entero en `Pie`, abajo.)
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
// El ancho es un TOPE y no un fijo (`max-width`), así que si la columna es
// más estrecha el pie se encoge CON ella y el mínimo baja. Por eso en móvil
// los pies no van uno al lado del otro: **bajan a una fila cada uno**
// (prompt §5). Y por eso la tarjeta del mapa lleva `px-3` por debajo de
// 640: a 320 px de pantalla, con los 16 de página y los 20 de tarjeta a
// cada lado quedaban 248 y la zona bajaba a 45,1 px — pasaba el 44 del
// prompt y no el 48 de la casa. Con 12 quedan exactamente 264.
//
// ── `unaFilaDesdeLg`: los dos pies SIEMPRE juntos (clinica-6) ────────
//
// El `flex-wrap` de aquí abajo parte la fila cuando los dos pies no caben,
// y eso es lo correcto en móvil. En un iPad apaisado NO lo es: a 1024 la
// historia viva dejaba el pie derecho bajo el pliegue, y había que hacer
// scroll para ver el estado completo del pie — justo lo que esa pantalla
// existe para no pedir. La maqueta validada los pone siempre lado a lado.
//
// Con la prop puesta, de `lg` para arriba la fila NO se parte. Lo que la
// hace caber de verdad no es esta clase: es que quien la usa le reserve
// `ANCHO_DE_LOS_DOS_PIES_PX` (536) más el padding de su tarjeta. Esta
// clase es la GARANTÍA de que, si alguien estrecha la columna, los pies se
// encogen juntos en vez de irse uno debajo del otro sin avisar.
//
// La sesión de clinica-5 NO la pasa, y no le hace falta: su columna son
// 584 px desde clinica-3 (§7.2) y ahí los dos caben a 264.
//
// **Esto se mide en la captura, no se deduce**: el test del mapa calcula
// sobre el ancho NOMINAL, y el ancho nominal estaba bien. Quien lo cazó fue
// `medidas-del-mapa.json` del bucle visual.
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
  HUECO_ENTRE_PIES_PX,
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
  /**
   * clinica-5 · la CAPA DE SENSIBILIDAD de la sesión por tipos: aquí el
   * paciente NO siente el monofilamento, según la última exploración.
   *
   * Rojo y no naranja a propósito: en esta capa el naranja ya significa
   * «lesión marcada hoy», y dos cosas distintas del mismo color sobre el
   * mismo dibujo es la clase de confusión que sobra en el pie de un
   * diabético.
   */
  | "sinSensibilidad"
  /**
   * clinica-6 · los tres estados del PIE VIVO de la historia. Son los
   * colores del mockup validado (rojo / ámbar / verde) y no los corales
   * de la sesión, y la diferencia es de significado: en la sesión el
   * color dice «marcado hoy», y aquí dice «cómo va esto».
   */
  | "activa"
  | "mejorando"
  | "curada"
  /** Sin nada. */
  | "libre";

const RELLENO: Record<EstadoDeZona, string> = {
  hoy: "fill-mipiace-coral stroke-mipiace-coral-dark",
  anterior: "fill-mipiace-coral-soft stroke-mipiace-coral",
  elegida: "fill-white stroke-mipiace-ink",
  sinSensibilidad: "fill-red-500 stroke-red-700",
  activa: "fill-red-600 stroke-red-800",
  mejorando: "fill-amber-500 stroke-amber-600",
  curada: "fill-emerald-500 stroke-emerald-700",
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
  /** clinica-6 · de `lg` para arriba, los dos pies en UNA fila pase lo que
   *  pase. Ver la cabecera. */
  unaFilaDesdeLg?: boolean;
}) {
  return (
    // El hueco sale del paquete (8 px y no 12): es lo que hace que dos pies
    // de 264 quepan en 536 + el padding de la tarjeta.
    <div
      className={`flex flex-wrap justify-center ${
        props.unaFilaDesdeLg ? "lg:flex-nowrap" : ""
      }`}
      style={{ gap: HUECO_ENTRE_PIES_PX }}
      data-test="mapa-los-dos-pies"
    >
      {PIES.map((pie) => (
        <div
          key={pie}
          // `min-w-0` para que, con la fila sin partir, los dos pies se
          // ENCOJAN juntos si la columna no da: el mínimo de un flex item
          // es `auto`, y sin esto desbordarían la tarjeta en vez de
          // ajustarse. Con la columna bien reservada no llega a pasar.
          className="flex min-w-0 flex-col items-center text-[12px] text-slate-500"
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
  // ── El pie que se espeja es el IZQUIERDO ──────────────────────────
  //
  // `CONTORNO_DEL_PIE` dibuja un pie con el dedo gordo a la izquierda del
  // lienzo, y los TRES mockups validados (clinica-3, la sesión v2 y la
  // historia viva) espejan el IZQUIERDO para que, con los dos pies uno al
  // lado del otro, **los dedos gordos queden hacia dentro** — que es como
  // se ve un par de pies de frente.
  //
  // Hasta clinica-6 aquí se espejaba el derecho, así que los dedos gordos
  // salían hacia fuera: un fallo de píxeles de clinica-3 que ninguna suite
  // podía ver (el test del mapa mide tamaños, no lados). Se arregla en el
  // sitio ÚNICO donde se dibuja el pie, porque dos pantallas que no se
  // pongan de acuerdo en cuál es el pie izquierdo son peores que las dos
  // equivocadas igual.
  //
  // Se espeja el GRUPO entero (contorno y zonas juntos) para que las zonas
  // no se puedan desalinear del contorno ni por un píxel.
  const flip =
    props.pie === "L" ? `translate(${VIEWBOX.ancho},0) scale(-1,1)` : undefined;
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

/** La leyenda del mapa. Tres variantes, una por capa. */
export function LeyendaDelMapa(props: {
  modo: "sesion" | "exploracion" | "sensibilidad";
}) {
  const items =
    props.modo === "sesion"
      ? ([
          ["bg-mipiace-coral-soft border border-mipiace-coral", "Visita anterior"],
          ["bg-mipiace-coral", "Hoy"],
        ] as const)
      : props.modo === "sensibilidad"
        ? // clinica-5 · la capa de la sesión por tipos: se LEE, no se
          // toca. Lo que se ve es la última exploración, y cambiarla es
          // hacer una exploración nueva en su pestaña — que es lo que
          // significa «la siguiente parte de la última» (clinica-3).
          ([
            ["bg-red-500", "No siente el monofilamento · última exploración"],
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
