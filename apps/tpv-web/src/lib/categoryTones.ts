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
// ("Tonos para iconos de producto"). Fondo `-50`, texto `-700`. No se
// generan por interpolación: Tailwind necesita las clases literales en
// el fuente para incluirlas en el bundle.
export const TONE_STYLES: Record<CategoryTone, { chip: string }> = {
  amber: { chip: "bg-amber-50 border-amber-200 text-amber-700 hover:border-amber-400" },
  sky: { chip: "bg-sky-50 border-sky-200 text-sky-700 hover:border-sky-400" },
  red: { chip: "bg-red-50 border-red-200 text-red-700 hover:border-red-400" },
  green: {
    chip: "bg-emerald-50 border-emerald-200 text-emerald-700 hover:border-emerald-400",
  },
  rose: { chip: "bg-rose-50 border-rose-200 text-rose-700 hover:border-rose-400" },
  stone: {
    chip: "bg-stone-100 border-stone-300 text-stone-700 hover:border-stone-400",
  },
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
    if (words.some((w) => slug.includes(w))) return tone;
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

/** Icono Lucide de una categoría. Nunca devuelve null. */
export function iconNameForTag(tag: string, tone: CategoryTone): CategoryIconName {
  const slug = normalizeTag(tag);
  for (const { icon, words } of ICON_HINTS) {
    if (words.some((w) => slug.includes(w))) return icon;
  }
  return ICON_BY_TONE[tone];
}
