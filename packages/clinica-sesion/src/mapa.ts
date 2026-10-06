// clinica-3 · EL MAPA DE LOS DOS PIES, versionado.
//
// Las zonas táctiles sobre las que la podóloga marca qué tiene el paciente
// y, en la exploración, dónde no siente el monofilamento. Once zonas por
// pie: cada dedo, bajo el dedo gordo, bajo el 2.º, bajo 3.º–5.º, el arco,
// el borde exterior y el talón (decisión de producto 2, Matías 06-10-2026).
//
// ── Por qué está versionado, igual que el cuestionario ────────────────
//
// Misma razón exacta que `CUESTIONARIO_V1` de clinica-2: una sesión guarda
// CON QUÉ VERSIÓN del mapa se marcó. El día que el mapa gane una zona
// («bajo el 4.º dedo») o se le cambie un nombre, lo marcado hace dos años
// sigue leyéndose bien. Sin la versión, una lesión apuntada en «arco» se
// pintaría con la geometría de hoy y nadie sabría si es el mismo sitio.
//
// En un registro legal eso no es un detalle de interfaz: es la diferencia
// entre «tenía una úlcera bajo el dedo gordo» y «tenía una úlcera en algún
// sitio del pie».
//
// Y es dato en CÓDIGO y no una tabla: editar las listas desde pantalla
// está fuera de alcance por el prompt. Una tabla sin pantalla que la edite
// no es más flexible que una constante — es la misma rigidez con una
// migración de por medio y sin revisión de código. El día que haya
// pantalla, esta constante pasa a ser la fila `version = 1`.
//
// ── Por qué la GEOMETRÍA vive aquí y no sólo en la pantalla ───────────
//
// Porque una zona sin sitio en el pie no es una zona. Si la lista de ids
// viviera aquí y las elipses en el `.tsx`, el día que alguien añada
// `m4` a la lista tendría una zona que la API acepta, que entra en la
// historia y que **no se puede tocar en ninguna pantalla**: una lesión
// registrada en un sitio que no existe. Juntas, añadir una zona es un solo
// cambio y el typecheck lo pide completo.
//
// La API no mira la geometría (sólo valida ids y escribe etiquetas); la
// pantalla la usa tal cual. Es dato de presentación compartido, como el
// `color` de un profesional en la agenda.

/** Los dos pies. El mapa es simétrico: la pantalla espeja el derecho. */
export type Pie = "L" | "R";

export const PIES: readonly Pie[] = ["L", "R"] as const;

/** Cómo se lee cada pie en una frase. En la historia se escribe entero. */
export const NOMBRE_DEL_PIE: Record<Pie, string> = {
  L: "Pie izquierdo",
  R: "Pie derecho",
};

/** Y la forma corta, para la lista de marcas de la pantalla. */
export const NOMBRE_CORTO_DEL_PIE: Record<Pie, string> = {
  L: "Pie izq.",
  R: "Pie der.",
};

export interface ZonaDelPie {
  /** Corto y estable: viaja dentro del `body` de la historia PARA SIEMPRE.
   *  Renombrar uno rompe la lectura de lo ya marcado; para cambiar una
   *  zona se saca una versión nueva del mapa. */
  id: string;
  /** Cómo se llama en la pantalla y en la historia. */
  label: string;
  /**
   * La elipse táctil sobre el contorno del pie, en el sistema del
   * `viewBox` (240 × 400). `rx`/`ry` son RADIOS, así que el objetivo mide
   * `2·rx × 2·ry` unidades.
   *
   * **El mínimo es 22**, o sea 44 unidades de diámetro, y a la escala a
   * la que la pantalla pinta el pie (264 px para un viewBox de 240 →
   * ×1,1) eso son 48,4 px reales: el peldaño `touch` de la casa
   * (`docs/design/tokens.md` §4). El prompt del bloque pide ≥ 44 px y se
   * mide EN LA CAPTURA, no aquí — pero el suelo de este fichero es lo
   * que hace que la captura pueda salir bien.
   */
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/** El radio mínimo admitido. Un test lo comprueba zona por zona. */
export const RADIO_MINIMO = 22;

/** El `viewBox` del contorno. La pantalla no elige otro. */
export const VIEWBOX = { ancho: 240, alto: 400 } as const;

/**
 * El ancho al que la pantalla pinta cada pie, en px.
 *
 * No es decoración: es el número que convierte el radio mínimo de 22
 * unidades en 48,4 px de dedo. Vive aquí, junto a la geometría que
 * escala, para que nadie pueda encoger el pie sin ver el mínimo táctil al
 * lado.
 */
export const ANCHO_DEL_PIE_PX = 264;

/**
 * El contorno del pie IZQUIERDO. El derecho es el mismo espejado
 * (`transform="translate(240,0) scale(-1,1)"`), que es lo que un pie es.
 */
export const CONTORNO_DEL_PIE =
  "M28 104 Q120 82 236 112 Q246 190 222 270 Q206 372 140 390 Q78 398 58 352 " +
  "Q44 306 52 262 Q58 214 30 168 Q14 128 28 104Z";

export interface MapaDelPie {
  version: number;
  zonas: readonly ZonaDelPie[];
}

// ── La versión 1 ──────────────────────────────────────────────────────
//
// Las once zonas del mockup validado (`docs/mockups/clinica-3-sesion.html`),
// con su geometría carácter por carácter. El orden es el del pie: los cinco
// dedos de dentro a fuera, las tres zonas de debajo de los dedos, el arco,
// el borde exterior y el talón. Es el orden en que la podóloga lo mira, y
// el orden en que sale la lista de marcas.
export const MAPA_PIE_V1: MapaDelPie = {
  version: 1,
  zonas: [
    { id: "h", label: "Dedo gordo", cx: 42, cy: 48, rx: 26, ry: 28 },
    { id: "d2", label: "2.º dedo", cx: 94, cy: 34, rx: 22, ry: 22 },
    { id: "d3", label: "3.er dedo", cx: 140, cy: 40, rx: 22, ry: 22 },
    { id: "d4", label: "4.º dedo", cx: 182, cy: 56, rx: 22, ry: 22 },
    { id: "d5", label: "5.º dedo", cx: 216, cy: 82, rx: 22, ry: 22 },
    { id: "m1", label: "Bajo el dedo gordo", cx: 62, cy: 138, rx: 36, ry: 28 },
    { id: "m2", label: "Bajo el 2.º dedo", cx: 124, cy: 132, rx: 26, ry: 28 },
    { id: "m35", label: "Bajo 3.º–5.º dedo", cx: 184, cy: 146, rx: 34, ry: 28 },
    { id: "arco", label: "Arco", cx: 88, cy: 232, rx: 34, ry: 42 },
    { id: "lat", label: "Borde exterior", cx: 176, cy: 232, rx: 28, ry: 42 },
    { id: "talon", label: "Talón", cx: 124, cy: 336, rx: 52, ry: 42 },
  ],
};

export const VERSION_DEL_MAPA = MAPA_PIE_V1.version;

const POR_VERSION: Record<number, MapaDelPie> = {
  [MAPA_PIE_V1.version]: MAPA_PIE_V1,
};

/**
 * El mapa con el que se marcó una sesión. `undefined` para una versión
 * que este despliegue no conoce — quien llama decide qué hacer, y lo que
 * NO se hace nunca es caer a «la de ahora»: pintar una marca vieja con la
 * geometría nueva es mentir sobre dónde estaba la lesión.
 */
export function mapaDeVersion(version: number): MapaDelPie | undefined {
  return POR_VERSION[version];
}

/** La zona, por id, dentro de una versión. */
export function zonaDe(
  id: string,
  version: number = VERSION_DEL_MAPA,
): ZonaDelPie | undefined {
  return mapaDeVersion(version)?.zonas.find((z) => z.id === id);
}

// ── La clave de una zona marcada ──────────────────────────────────────
//
// `"L:h"`, `"R:talon"`. Una sola cadena y no un par `{pie, zona}` porque
// lo que se guarda es un DICCIONARIO de marcas, y un objeto no puede ser
// clave de un objeto. Es la misma forma que usa el mockup.

/** `"L:h"` a partir de sus dos mitades. */
export function claveDeZona(pie: Pie, zonaId: string): string {
  return `${pie}:${zonaId}`;
}

/** Y al revés. `null` si la clave no es de este mapa. */
export function partirClave(
  clave: string,
  version: number = VERSION_DEL_MAPA,
): { pie: Pie; zona: ZonaDelPie } | null {
  const corte = clave.indexOf(":");
  if (corte < 0) return null;
  const pie = clave.slice(0, corte);
  if (pie !== "L" && pie !== "R") return null;
  const zona = zonaDe(clave.slice(corte + 1), version);
  if (!zona) return null;
  return { pie, zona };
}

/**
 * Cómo se lee una zona marcada en la historia: «Pie izq. · Dedo gordo».
 *
 * Devuelve la clave tal cual si no la reconoce, en vez de reventar o
 * esconderla: una marca de una versión que este despliegue no conoce
 * tiene que SEGUIR VIÉNDOSE en la historia. Lo que no se puede es pintarla
 * en el sitio equivocado del mapa, y eso lo impide `mapaDeVersion`.
 */
export function nombreDeZona(
  clave: string,
  version: number = VERSION_DEL_MAPA,
): string {
  const p = partirClave(clave, version);
  if (!p) return clave;
  return `${NOMBRE_CORTO_DEL_PIE[p.pie]} · ${p.zona.label}`;
}

/** Todas las claves válidas de una versión, los dos pies. */
export function clavesDelMapa(
  version: number = VERSION_DEL_MAPA,
): readonly string[] {
  const mapa = mapaDeVersion(version);
  if (!mapa) return [];
  return PIES.flatMap((pie) => mapa.zonas.map((z) => claveDeZona(pie, z.id)));
}
