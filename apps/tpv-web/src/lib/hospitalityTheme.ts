// v2-H1-venta-y-sala · el tema oscuro de la venta y la sala de
// HOSTELERÍA, en un módulo puro.
//
// Por qué existe. El 07-10-2026 Matías aplazó la implantación de La
// Maestranza tras ver la pantalla de venta en el D8: «veo poca
// usabilidad en todo, muy poca, tienes que poner demasiada atención para
// marcar las cosas», «lo tiene que leer un humano, a toda velocidad y en
// pleno estrés, y la única distinción es una pequeña línea de color, con
// el texto diminuto». El listón no es «mejor que antes»: es mejor que
// Toast, que es su referencia de limpio y claro.
//
// Lo que este módulo garantiza es que **el tema sale de tokens y nunca
// de hex sueltos** (`docs/design/tokens.md` §9, decisión 1 del bloque).
// Cada color y cada tamaño vive aquí una sola vez; los componentes los
// leen. Un sabotaje que baje el nombre de producto a 17 px cambia el
// número que entra en las funciones puras de `hospitalityGrid.ts` y el
// test cae — no hace falta mirar una captura.
//
// Dos avisos sobre la forma del módulo:
//
//   1. Los colores van como **hex literales** y se pintan por `style`,
//      no como clases de Tailwind. El JIT de Tailwind no compila
//      `bg-[${hex}]`, y el color de la familia es dinámico por
//      definición (sale del catálogo del comercio). Las clases arbitrarias
//      sólo funcionarían con una allowlist de los nueve tonos escrita a
//      mano en el fuente, que es la copia del número que v1.23 ya
//      aprendió a evitar.
//   2. Las ALTURAS que sí son fijas van como clase literal cuando
//      existen en la escala (`h-touch-pad`), y como constante cuando no
//      (`tap-cobrar-hosteleria`). Ninguna va como `h-[NNpx]` escrito en
//      un componente: hay test que lo prohíbe.

// ──────────────────────────────────────────────────────────────────────
// Superficies y texto · tokens.md §9.1
// ──────────────────────────────────────────────────────────────────────

/**
 * Fondo de la pantalla. Casi negro y no negro puro: con `#000` el texto
 * claro produce halo en el WebView 101 del D8.
 */
export const DARK_CANVAS = "#0E1013";

/** La comanda. Un peldaño por encima del fondo. */
export const DARK_PANEL = "#171A1F";

/** Botones en reposo (cantidad no elegida, chip de zona no elegido). */
export const DARK_SURFACE = "#1C2026";

/** Separadores, botón de volver, franja de la barra del mapa. */
export const DARK_SURFACE_RAISED = "#23272E";

/**
 * Las teclas `−` / `+` de la línea sin enviar. Suben otro peldaño porque
 * son lo único que se pulsa DENTRO de una lista: con el tono de
 * `DARK_SURFACE` se leían como fondo de la fila, no como teclas.
 */
export const DARK_SURFACE_KEY = "#2C313A";

/** Texto sobre relleno claro (producto sobre su familia, mesa libre). */
export const DARK_INK = "#15171B";

/** Texto principal. */
export const DARK_TEXT = "#F1F3F5";

/** Texto de botón en reposo. */
export const DARK_TEXT_SOFT = "#E4E7EB";

/**
 * Eyebrows, meta y líneas ya enviadas.
 *
 * **Nunca un importe ni un nombre de producto**: el §4 del principio de
 * venta bajo estrés prohíbe el gris claro para información que se usa, y
 * eso era justo el defecto de la pantalla que Matías rechazó.
 */
export const DARK_TEXT_MUTED = "#8B93A1";

/**
 * Enlaces. Coral aclarado porque el `#E97058` sobre `#0E1013` no llega a
 * 4,5:1 en texto pequeño.
 */
export const DARK_LINK = "#F2A08F";

/** `mipiace.coral` de tokens.md §2, sin cambios. */
export const CORAL = "#E97058";

/** Blanco puro: sólo sobre coral y sobre el relleno de mesa ocupada. */
export const DARK_ON_CORAL = "#FFFFFF";

/**
 * Destaque de la línea recién añadida en «Sin enviar». Coral al 16 %:
 * suficiente para verlo con el rabillo del ojo, lo bastante poco para
 * que dos cañas seguidas no dejen media comanda en coral.
 */
export const DARK_LINE_HIGHLIGHT = "rgba(233,112,88,0.16)";

/**
 * Fondo de la insignia `×N` dentro del botón de producto. Más oscura que
 * el canvas a propósito: va encima de un relleno pastel y necesita ser
 * lo más contrastado de ese botón.
 */
export const DARK_QTY_BADGE = "#15171B";

// ──────────────────────────────────────────────────────────────────────
// Estados de mesa · tokens.md §9.2
// ──────────────────────────────────────────────────────────────────────

/**
 * Mesa libre: **lo más claro de la sala**, al revés que en la pantalla
 * clara (donde era blanca con borde fino y desaparecía). En un bar lo
 * que se busca de un vistazo es dónde sentar a cuatro.
 */
export const TABLE_FREE_FILL = "#E9ECEF";
export const TABLE_FREE_TEXT = DARK_INK;

/** Mesa ocupada: coral pleno, importe grande y minutos. */
export const TABLE_BUSY_FILL = CORAL;
export const TABLE_BUSY_TEXT = DARK_ON_CORAL;

/**
 * Pide la cuenta. Ámbar propio y no el `amber-*` de Tailwind: sobre
 * carbón los ámbar de la escala clara se van a marrón. Sigue siendo el
 * ámbar de «atención / pidiendo cuenta» de tokens.md §2.
 */
export const TABLE_BILLING_FILL = "#E2B23A";
export const TABLE_BILLING_TEXT = "#1B1500";

/** El aro de «+45 min sin atender», que se suma al relleno de ocupada. */
export const TABLE_LATE_RING = TABLE_BILLING_FILL;
export const TABLE_LATE_RING_WIDTH = 4;

/** Franja del mostrador de la zona BARRA. */
export const BAR_COUNTER_FILL = DARK_SURFACE_RAISED;

// ──────────────────────────────────────────────────────────────────────
// Paleta de familia · 9 tonos · tokens.md §9.3
// ──────────────────────────────────────────────────────────────────────

export type FamilyTone =
  | "cafes"
  | "desayunos"
  | "cervezas"
  | "refrescos"
  | "vinos"
  | "licores"
  | "raciones"
  | "bocadillos"
  | "platos";

/**
 * Orden estable de reparto. Es el de la maqueta que Matías revisó y el
 * orden en que se asignan tonos a categorías nuevas cuando la pista por
 * nombre no acierta.
 */
export const FAMILY_TONES: readonly FamilyTone[] = [
  "cafes",
  "desayunos",
  "cervezas",
  "refrescos",
  "vinos",
  "licores",
  "raciones",
  "bocadillos",
  "platos",
] as const;

/**
 * El relleno de cada tono.
 *
 * Nueve y no los seis de `categoryTones.ts` porque una carta de bar
 * tiene nueve familias (La Maestranza tiene nueve exactas) y con seis
 * tonos dos familias vecinas comparten color, que es lo contrario de lo
 * que el color viene a hacer aquí.
 *
 * Pastel claro con texto `DARK_INK`: es lo que da contraste de texto
 * sobre un relleno saturado sin pedir blanco (el blanco sobre pastel no
 * llega a 4,5:1).
 *
 * El coral NO está en la paleta, por la misma razón que no estaba en la
 * de seis: lo lleva «Ahora», que es la vista especial.
 */
export const FAMILY_FILL: Record<FamilyTone, string> = {
  cafes: "#F3B992",
  desayunos: "#CACD8C",
  cervezas: "#E1C487",
  refrescos: "#86D5EE",
  vinos: "#D8B8F1",
  licores: "#A7C9FF",
  raciones: "#96D9B4",
  bocadillos: "#F3B1CF",
  platos: "#B0D49D",
};

/** Texto sobre cualquier relleno de familia. */
export const FAMILY_TEXT = DARK_INK;

// ──────────────────────────────────────────────────────────────────────
// Escala TPV · tokens.md §3.1
//
// Los mínimos son del prompt del bloque; lo que se pinta está igual o
// por encima. Las funciones puras de `hospitalityGrid.ts` comen estos
// números, así que bajarlos pone un test en rojo.
// ──────────────────────────────────────────────────────────────────────

/** Nombre de producto en la cuadrícula normal (hasta 20 productos). */
export const PRODUCT_NAME_PX = 24;

/**
 * Suelo del nombre de producto cuando la familia es grande y la
 * cuadrícula se aprieta. **Nunca por debajo**: §3b del bloque prohíbe la
 * paginación, no el tamaño legible — si una familia no cabe con 20 px y
 * 64 px de alto, el bloque lo dice con su número en vez de partirla.
 */
export const PRODUCT_NAME_MIN_PX = 20;

/** Línea de comanda ya enviada a cocina. Atenuada, pero legible. */
export const SENT_LINE_NAME_PX = 21;
export const SENT_LINE_AMOUNT_PX = 20;

/** Línea de comanda sin enviar. Es la que se corrige, así que destaca. */
export const PENDING_LINE_NAME_PX = 23;
export const PENDING_LINE_AMOUNT_PX = 23;
export const PENDING_LINE_QTY_PX = 24;

/** Total a cobrar. */
export const TOTAL_PX = 46;

/** Los dos botones del pie de la comanda. */
export const COBRAR_LABEL_PX = 22;
export const ENVIAR_LABEL_PX = 20;

/** Nombre de familia en la barra de familias. */
export const FAMILY_LABEL_PX = 21;

/** Nombre e importe en la tarjeta de mesa del mapa. */
export const TABLE_NAME_PX = 28;
export const TABLE_AMOUNT_PX = 22;

/** Eyebrow de sección: «EN COCINA», «SIN ENVIAR», «BARRA». */
export const EYEBROW_PX = 11;
export const EYEBROW_TRACKING = "0.1em";

// ──────────────────────────────────────────────────────────────────────
// Objetivos táctiles · tokens.md §4
// ──────────────────────────────────────────────────────────────────────

/**
 * El suelo táctil de esta pantalla. `ux-principles` §1.2 pedía 64 px en
 * la pantalla principal de venta y `tokens.md` §4 abre la escala en 48;
 * el prompt del bloque fija **56 en tablet**, que es `touch-pad`. Nada
 * por debajo: hay test de tamaño sobre `getComputedStyle`.
 */
export const MIN_TOUCH_PX = 56;

/** Alto del botón de familia. */
export const FAMILY_BUTTON_PX = 76;

/** La tecla `−` / `+` de una línea sin enviar: un pulso de dedo. */
export const STEPPER_KEY_PX = 56;

/** Las teclas de la fila «Cantidad 1-6». */
export const QTY_KEY_WIDTH_PX = 64;
export const QTY_KEY_HEIGHT_PX = 56;

/**
 * `tap-cobrar-hosteleria` de tokens.md §4. 68 px, cuatro por encima de
 * `touch-lg`, y con nombre propio porque la escala se cierra en 64 y el
 * cuarto peldaño se discute en el token antes de implementarse.
 */
export const COBRAR_HEIGHT_PX = 68;

/** «Enviar» comparte alto con «Cobrar»; la jerarquía la hacen ancho y relleno. */
export const ENVIAR_HEIGHT_PX = 68;

/**
 * Ancho de la comanda.
 *
 * Sube de los 360 px del panel claro a **420** porque la decisión 3d
 * mete un `−` y un `+` de 56 px a los lados de la cantidad en cada línea
 * sin enviar. La cuenta de la fila: 8 de padding + 56 + 10 + 30 de
 * cantidad + 10 + 56 + 10 + nombre + 10 + importe + 8. Con 360 el
 * nombre se quedaba en ~60 px o el importe se salía de la tarjeta, que
 * es el fallo que v1.22 arregló en el mapa y que no se va a repetir
 * aquí: **el nombre se recorta con ellipsis, el importe nunca**.
 */
export const ORDER_PANEL_WIDTH = 420;

/** El borde de 1 px que separa la comanda del catálogo. */
export const ORDER_PANEL_BORDER = 1;

// ──────────────────────────────────────────────────────────────────────
// Animación · tokens.md §8 y restricción del bloque
// ──────────────────────────────────────────────────────────────────────

/**
 * Lo ÚNICO que se anima en estas dos pantallas: el feedback de pulsado
 * del sistema visual. Nada de transiciones de entrada, nada de escalas
 * al hover (no hay hover en táctil).
 */
export const PRESS_FEEDBACK_CLASS =
  "transition-transform duration-[120ms] active:scale-[0.97]";

// ──────────────────────────────────────────────────────────────────────
// Reparto tono ↔ familia, estable y persistido
// ──────────────────────────────────────────────────────────────────────

/**
 * Pistas por nombre de categoría, sobre el slug normalizado (sin tildes,
 * en minúsculas), que es como llegan los tags de Holded.
 *
 * No es adivinación fina: es un primer reparto razonable para que un bar
 * típico abra el TPV y ya vea los cafés en su tono. Lo que no encaja cae
 * al tono menos usado, y en cuanto se asigna queda escrito.
 */
const TONE_HINTS: ReadonlyArray<{ tone: FamilyTone; words: string[] }> = [
  { tone: "cafes", words: ["cafe", "infusion", "te", "cortado", "capuchino", "colacao"] },
  { tone: "desayunos", words: ["desayuno", "tostada", "bolleria", "croissant", "pincho", "panaderia", "pan"] },
  { tone: "cervezas", words: ["cerveza", "birra", "cana", "tercio", "botellin", "barril"] },
  { tone: "refrescos", words: ["refresco", "agua", "zumo", "batido", "bebida", "soft", "gaseosa"] },
  { tone: "vinos", words: ["vino", "copa", "tinto", "blanco", "cava", "vermut"] },
  { tone: "licores", words: ["licor", "destilado", "combinado", "coctel", "copas", "whisky", "ron", "gin"] },
  { tone: "raciones", words: ["racion", "tapa", "entrante", "picoteo", "aperitivo", "frito"] },
  { tone: "bocadillos", words: ["bocadillo", "bocata", "montado", "sandwich", "hamburguesa", "perrito"] },
  { tone: "platos", words: ["plato", "menu", "carne", "pescado", "pasta", "arroz", "postre", "ensalada"] },
];

/**
 * Clave de almacén. Mismo criterio que `categoryTones.ts`: el reparto se
 * persiste **por tenant**, porque el color de «Cafés» tiene que ser el
 * mismo el lunes y el martes. Un reparto que cambia con cada sync es
 * peor que no tener color — lo que se aprende es el color y la posición,
 * no el nombre.
 *
 * Clave propia y no la de `categoryTones`: son dos paletas distintas
 * (seis tonos de icono contra nueve rellenos) y mezclarlas haría que
 * activar el tema oscuro reasignara los iconos del TPV claro.
 */
const STORAGE_PREFIX = "mipiacetpv-family-tones";

function storageKey(tenantId: string | null): string {
  return tenantId ? `${STORAGE_PREFIX}:${tenantId}` : `${STORAGE_PREFIX}:anon`;
}

/** Sin tildes y en minúsculas: los tags de Holded llegan como vengan. */
export function normalizeFamilyTag(tag: string): string {
  return tag
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isFamilyTone(v: unknown): v is FamilyTone {
  return typeof v === "string" && (FAMILY_TONES as readonly string[]).includes(v);
}

export function loadFamilyTones(
  tenantId: string | null,
): Record<string, FamilyTone> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(storageKey(tenantId));
  } catch {
    return {};
  }
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, FamilyTone> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (isFamilyTone(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveFamilyTones(
  assignments: Record<string, FamilyTone>,
  tenantId: string | null,
): void {
  try {
    localStorage.setItem(storageKey(tenantId), JSON.stringify(assignments));
  } catch {
    /* cuota llena o almacenamiento bloqueado: el reparto se recalcula en
       memoria, sólo se pierde la estabilidad entre sesiones */
  }
}

function hintedTone(tag: string): FamilyTone | null {
  const slug = normalizeFamilyTag(tag);
  for (const { tone, words } of TONE_HINTS) {
    if (words.some((w) => slug.includes(w))) return tone;
  }
  return null;
}

/**
 * Reparto tono ↔ familia para los tags dados.
 *
 * **Estable por construcción**: lo ya asignado NUNCA se reasigna, y lo
 * nuevo se asigna en orden alfabético —no en el orden en que Holded
 * devuelva los productos ese día—. Primero la pista por nombre; si ese
 * tono ya va por delante del menos usado, cae al menos usado, para que
 * un catálogo con «Cafés», «Café con leche» y «Cafetería» no se pinte
 * entero del mismo color.
 *
 * Efecto secundario deliberado: persiste el reparto resultante.
 */
export function resolveFamilyTones(
  tags: string[],
  tenantId: string | null,
): Record<string, FamilyTone> {
  const stored = loadFamilyTones(tenantId);
  const assignments: Record<string, FamilyTone> = { ...stored };
  const counts = new Map<FamilyTone, number>(FAMILY_TONES.map((t) => [t, 0]));
  for (const tag of tags) {
    const tone = assignments[tag];
    if (tone) counts.set(tone, (counts.get(tone) ?? 0) + 1);
  }

  const pending = tags.filter((t) => !assignments[t]).sort();
  if (pending.length === 0) return assignments;

  const leastUsed = (): FamilyTone => {
    let best = FAMILY_TONES[0]!;
    for (const tone of FAMILY_TONES) {
      if ((counts.get(tone) ?? 0) < (counts.get(best) ?? 0)) best = tone;
    }
    return best;
  };

  for (const tag of pending) {
    const hint = hintedTone(tag);
    const min = counts.get(leastUsed()) ?? 0;
    const tone = hint && (counts.get(hint) ?? 0) <= min ? hint : leastUsed();
    assignments[tag] = tone;
    counts.set(tone, (counts.get(tone) ?? 0) + 1);
  }

  saveFamilyTones(assignments, tenantId);
  return assignments;
}

/** El relleno de una familia, con el tono ya resuelto. */
export function familyFillFor(
  tag: string,
  assignments: Record<string, FamilyTone>,
): string {
  const tone = assignments[tag];
  return FAMILY_FILL[tone ?? "cafes"];
}
