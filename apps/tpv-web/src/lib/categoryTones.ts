// v1.14-la-comanda-se-ve · hallazgo M2 de la auditoría del 2026-09-01.
//
// Los chips de categoría eran ocho rectángulos idénticos con texto. Para
// elegir en un segundo con una mano ocupada, el texto es el peor canal:
// obliga a leer ocho etiquetas en vez de reconocer una forma y un color.
//
// El sistema visual (`docs/design/tokens.md` §2) ya define seis tonos de
// categoría y estaban SIN USAR. Este módulo los reparte y **persiste el
// reparto por tenant**: el color de "Cafés" tiene que ser el mismo el
// lunes que el martes, porque lo que se aprende es la posición y el
// color, no el nombre. Un reparto que cambia cada sync es peor que no
// tener color.
//
// El coral NO está en esta paleta a propósito: queda reservado para la
// categoría SELECCIONADA (hallazgo m2). Si un chip en reposo fuese
// coral, la señal de "esta es la que estás mirando" se pierde.

import { getCachedTenantId } from "./catalog.js";

export type CategoryTone = "amber" | "sky" | "red" | "green" | "rose" | "stone";

// Orden estable de reparto. Es el mismo de tokens.md §2 y el orden en
// que se asignan los tonos a categorías nuevas cuando la heurística por
// nombre no acierta.
export const CATEGORY_TONES: readonly CategoryTone[] = [
  "amber",
  "sky",
  "red",
  "green",
  "rose",
  "stone",
] as const;

// Clases Tailwind por tono, copiadas de `docs/design/tokens.md` §2
// ("Tonos para iconos de producto"). No se generan por interpolación:
// Tailwind necesita las clases literales en el fuente para incluirlas en
// el bundle.
//
// v1.14.1-el-catalogo-manda §2 · **el tono ya no pinta el fondo del
// chip**. En v1.14 el fondo del chip llevaba el tono, y sobre la captura
// del AP11 eso resultó ser ruido, no información: los tonos se reparten
// por orden alfabético y en la pantalla real salían Bollería amarillo,
// Café rojo, Croissantysandwich verde e Infusiones amarillo otra vez.
// Cuatro fondos de color que no significan nada compiten con la única
// señal que sí importa en esa fila, que es cuál está seleccionado. El
// tono se conserva donde informa sin gritar —el icono— y el fondo del
// chip pasa a neutro.
//
// `band` es el acento de 4 px de la tarjeta de producto (§1): es lo
// único que queda del antiguo bloque de 125 px de icono placeholder.
export const TONE_STYLES: Record<
  CategoryTone,
  { icon: string; band: string }
> = {
  amber: { icon: "text-amber-600", band: "bg-amber-400" },
  sky: { icon: "text-sky-600", band: "bg-sky-400" },
  red: { icon: "text-red-600", band: "bg-red-400" },
  green: { icon: "text-emerald-600", band: "bg-emerald-400" },
  rose: { icon: "text-rose-600", band: "bg-rose-400" },
  stone: { icon: "text-stone-500", band: "bg-stone-400" },
};

// Heurística de tokens.md: "café/cervezas → amber; agua/refrescos azules
// → sky; refrescos rojos → red; ensaladas/vegetales → green; postres →
// rose; servicios sin almacén → stone". Se aplica sobre el slug del tag
// normalizado (sin tildes, minúsculas), que es como llegan de Holded.
//
// No es adivinación fina: es un primer reparto razonable para que un bar
// típico abra el TPV y ya vea los cafés en ámbar. Lo que no encaja cae
// al reparto por orden, y en cuanto se asigna queda persistido.
const TONE_HINTS: ReadonlyArray<{ tone: CategoryTone; words: string[] }> = [
  { tone: "amber", words: ["cafe", "cerveza", "birra", "tostada", "desayuno", "bolleria", "croissant", "panaderia"] },
  { tone: "sky", words: ["agua", "refresco", "bebida", "soft", "zumo", "batido", "hielo", "coctel"] },
  { tone: "red", words: ["vino", "copa", "licor", "destilado", "carne", "brasa", "parrilla"] },
  { tone: "green", words: ["ensalada", "verdura", "vegetal", "vegano", "sano", "entrante", "tapa"] },
  { tone: "rose", words: ["postre", "dulce", "helado", "tarta", "pasteleria", "chocolate"] },
  { tone: "stone", words: ["servicio", "corte", "peluqueria", "extra", "otros", "varios", "menu"] },
  // clinica-8 (fase B, 19) · lo clínico, en azul. Lo mismo que los
  // iconos: al final, para no mover el reparto de los quince comercios
  // de hoy. Y en `sky` y no en ámbar porque el ámbar es el del café y lo
  // que se quería quitar era precisamente eso.
  {
    tone: "sky",
    words: ["quiropodia", "podolog", "cirugia", "cirugía", "biomecanic", "biomecánic", "ortesis", "órtesis", "consulta", "cura"],
  },
];

// Iconos Lucide por categoría. Mismo criterio: heurística por palabra
// con fallback por tono, para que ninguna categoría se quede sin icono
// (un chip con icono y otro sin él lee peor que ocho chips sin icono).
// Los nombres se exportan como string y `SalePage` los resuelve contra
// su propio import — así este módulo sigue siendo puro y testeable sin
// montar React.
export type CategoryIconName =
  | "Coffee"
  | "Beer"
  | "Wine"
  | "GlassWater"
  | "CupSoda"
  | "Croissant"
  | "Sandwich"
  | "Salad"
  | "Soup"
  | "Pizza"
  | "Beef"
  | "Fish"
  | "Cake"
  | "Cookie"
  | "Utensils"
  | "Scissors"
  | "Shirt"
  | "Sparkles"
  // clinica-8 (fase B, 19) · los de clínica. «Venta: iconos de taza»
  // (auditoría del 18-10, punto 28): en la rejilla de Rosario,
  // «Quiropodia», «Cirugía» y «Biomecánica» salían con una TAZA DE CAFÉ.
  // No es una errata del catálogo: ninguna de las tres casa con las
  // pistas de hostelería, así que caían al icono por tono, y el tono por
  // defecto del primer reparto es ámbar → `Coffee`.
  | "Footprints"
  | "Stethoscope"
  | "Syringe"
  | "Activity"
  | "Bandage"
  | "HeartPulse"
  | "Package";

const ICON_HINTS: ReadonlyArray<{ icon: CategoryIconName; words: string[] }> = [
  { icon: "Coffee", words: ["cafe", "infusion", "te", "desayuno"] },
  { icon: "Beer", words: ["cerveza", "birra", "cana"] },
  { icon: "Wine", words: ["vino", "copa", "licor", "destilado", "coctel"] },
  { icon: "GlassWater", words: ["agua", "botella"] },
  { icon: "CupSoda", words: ["refresco", "bebida", "zumo", "batido", "soft"] },
  { icon: "Croissant", words: ["bolleria", "croissant", "panaderia", "pan"] },
  { icon: "Sandwich", words: ["bocadillo", "sandwich", "montadito", "hamburguesa"] },
  { icon: "Salad", words: ["ensalada", "verdura", "vegetal", "vegano"] },
  { icon: "Soup", words: ["sopa", "crema", "caldo", "cuchara"] },
  { icon: "Pizza", words: ["pizza", "pasta", "italiano"] },
  { icon: "Beef", words: ["carne", "brasa", "parrilla", "chuleta"] },
  { icon: "Fish", words: ["pescado", "marisco", "fritura"] },
  { icon: "Cake", words: ["postre", "tarta", "pasteleria", "dulce"] },
  { icon: "Cookie", words: ["galleta", "snack", "chocolate", "chuche"] },
  { icon: "Utensils", words: ["comida", "cocina", "plato", "menu", "racion", "tapa", "entrante"] },
  { icon: "Scissors", words: ["corte", "peluqueria", "pelo", "barba"] },
  { icon: "Shirt", words: ["ropa", "textil", "moda", "camiseta"] },
  { icon: "Sparkles", words: ["belleza", "estetica", "tratamiento", "servicio"] },
  // clinica-8 (fase B, 19) · las de clínica van DESPUÉS de las de
  // hostelería a propósito. Las palabras no chocan entre sí —no hay
  // ninguna categoría que sea «café» y «quiropodia» a la vez— y poner
  // las nuevas al final deja intacto el reparto de los quince comercios
  // de hoy, que es lo que no se puede mover: el icono de una categoría
  // se aprende y cambiarlo cuesta un segundo por toque durante días.
  {
    icon: "Footprints",
    words: ["quiropodia", "podolog", "pie", "pies", "una", "uñas", "callo", "helom", "papiloma"],
  },
  { icon: "Syringe", words: ["cirugia", "cirugía", "fenol", "infiltra", "avulsion"] },
  { icon: "Activity", words: ["biomecanic", "biomecánic", "pisada", "ortesis", "órtesis", "plantilla"] },
  { icon: "Bandage", words: ["cura", "herida", "ulcera", "úlcera", "apósito", "aposito", "vendaje"] },
  { icon: "HeartPulse", words: ["riesgo", "diabet", "exploracion", "exploración", "seguimiento"] },
  { icon: "Stethoscope", words: ["consulta", "revision", "revisión", "valoracion", "valoración", "diagnostic"] },
];

const ICON_BY_TONE: Record<CategoryTone, CategoryIconName> = {
  amber: "Coffee",
  sky: "CupSoda",
  red: "Wine",
  green: "Salad",
  rose: "Cake",
  stone: "Package",
};

const STORAGE_PREFIX = "mipiacetpv-category-tones";

/** Sin tildes y en minúsculas: los tags de Holded llegan como vengan. */
export function normalizeTag(tag: string): string {
  return tag
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function storageKey(tenantId: string | null): string {
  // Sin tenant cacheado (primer arranque, aún sin sync) el reparto vive
  // en una clave neutra. En cuanto llega el tenantId, el siguiente
  // reparto se guarda en su clave; el usuario ve como mucho un cambio
  // de color en el primer arranque de su vida.
  return tenantId ? `${STORAGE_PREFIX}:${tenantId}` : `${STORAGE_PREFIX}:anon`;
}

function isTone(v: unknown): v is CategoryTone {
  return typeof v === "string" && (CATEGORY_TONES as readonly string[]).includes(v);
}

/** Lee el reparto persistido. `{}` si no hay nada o el JSON está roto. */
export function loadToneAssignments(
  tenantId: string | null = getCachedTenantId(),
): Record<string, CategoryTone> {
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
    const out: Record<string, CategoryTone> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (isTone(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveToneAssignments(
  assignments: Record<string, CategoryTone>,
  tenantId: string | null = getCachedTenantId(),
): void {
  try {
    localStorage.setItem(storageKey(tenantId), JSON.stringify(assignments));
  } catch {
    /* cuota llena o almacenamiento bloqueado: el reparto se recalcula
       igual en memoria, sólo se pierde la estabilidad entre sesiones */
  }
}

function hintedTone(tag: string): CategoryTone | null {
  const slug = normalizeTag(tag);
  for (const { tone, words } of TONE_HINTS) {
    // clinica-8 (fase B, 19) · la misma regla que los iconos: ver `casa`.
    if (words.some((w) => casa(slug, w))) return tone;
  }
  return null;
}

/**
 * Reparto tono↔categoría para los tags dados.
 *
 * Estable por construcción: lo ya asignado NUNCA se reasigna, y lo nuevo
 * se asigna en orden alfabético (no en el orden en que Holded devuelva
 * los productos ese día). Primero se intenta la heurística por nombre;
 * si ese tono ya está muy cargado respecto al resto, cae al tono menos
 * usado. Con más de seis categorías los tonos se repiten — es
 * inevitable con seis tonos, y sigue siendo mejor que ocho grises.
 *
 * Efecto secundario deliberado: persiste el reparto resultante.
 */
export function resolveToneAssignments(
  tags: string[],
  tenantId: string | null = getCachedTenantId(),
): Record<string, CategoryTone> {
  const stored = loadToneAssignments(tenantId);
  const assignments: Record<string, CategoryTone> = { ...stored };
  const counts = new Map<CategoryTone, number>(CATEGORY_TONES.map((t) => [t, 0]));
  for (const tag of tags) {
    const tone = assignments[tag];
    if (tone) counts.set(tone, (counts.get(tone) ?? 0) + 1);
  }

  const pending = tags.filter((t) => !assignments[t]).sort();
  if (pending.length === 0) return assignments;

  const leastUsed = (): CategoryTone => {
    let best = CATEGORY_TONES[0]!;
    for (const tone of CATEGORY_TONES) {
      if ((counts.get(tone) ?? 0) < (counts.get(best) ?? 0)) best = tone;
    }
    return best;
  };

  for (const tag of pending) {
    const hint = hintedTone(tag);
    const min = counts.get(leastUsed()) ?? 0;
    // La pista manda salvo que ese tono ya vaya un peldaño por delante
    // del menos usado: así un catálogo con "Cafés", "Café con leche" y
    // "Cafetería" no se pinta entero en ámbar.
    const tone = hint && (counts.get(hint) ?? 0) <= min ? hint : leastUsed();
    assignments[tag] = tone;
    counts.set(tone, (counts.get(tone) ?? 0) + 1);
  }

  saveToneAssignments(assignments, tenantId);
  return assignments;
}

/**
 * ¿Casa esta palabra con este slug?
 *
 * clinica-8 (fase B, 19) · **una palabra de dos o tres letras tiene que
 * ser el slug ENTERO.** Con `includes` a secas, la pista «te» del té se
 * comía media lista: «orTEsis» → taza de café, y «corTEs» de la
 * peluquería también. Es un fallo que estaba desde v1.14 y que el
 * catálogo de Rosario destapa, porque «órtesis» es una de sus cinco
 * categorías.
 *
 * El corte en cuatro letras no es un número redondo elegido a gusto: es
 * el único tramo donde `includes` miente. De cuatro para arriba las
 * palabras de la lista («cafe», «vino», «pan» no, pero «pizza» sí) son
 * raíces de verdad y acertar por subcadena es lo que hace que
 * «panaderia» y «panes» caigan en la misma. Por debajo son sílabas.
 */
function casa(slug: string, palabra: string): boolean {
  if (palabra.length <= 3) return slug === palabra;
  return slug.includes(palabra);
}

/**
 * Icono Lucide de una categoría. Nunca devuelve null.
 *
 * clinica-8 (fase B, 19) · `porDefecto` es lo que se usa cuando ninguna
 * palabra casa. Sin él, el respaldo es el icono del TONO, y el tono se
 * reparte por orden: en una clínica, la primera categoría del catálogo
 * se lleva ámbar y ámbar es `Coffee`. Una taza de café encima de
 * «Cirugía».
 *
 * `SalePage` le pasa el estetoscopio en un comercio con historia
 * clínica. No se adivina aquí dentro: este módulo es puro y no sabe de
 * qué negocio es el catálogo que le dan.
 */
export function iconNameForTag(
  tag: string,
  tone: CategoryTone,
  porDefecto?: CategoryIconName,
): CategoryIconName {
  const slug = normalizeTag(tag);
  for (const { icon, words } of ICON_HINTS) {
    if (words.some((w) => casa(slug, w))) return icon;
  }
  return porDefecto ?? ICON_BY_TONE[tone];
}
