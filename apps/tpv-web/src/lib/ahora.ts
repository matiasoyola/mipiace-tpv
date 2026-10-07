// v2-H1-venta-y-sala §3/§4 · la vista «Ahora» en el terminal.
//
// «Ahora» es la PRIMERA pestaña de la venta de hostelería y la que abre
// por defecto (decisión 4): lo más pedido en este comercio en esta
// franja horaria. Es la ÚNICA vista que se reordena sola — dentro de una
// familia el orden no cambia nunca, porque lo que el camarero aprende es
// la posición.
//
// El ranking lo calcula la API (`GET /tpv/catalog/now`), que es quien
// tiene los tickets. Aquí sólo se pide, se cachea y se resuelve contra
// el catálogo local.
//
// LAS TRES CAÍDAS, en orden, porque son el requisito y no un detalle:
//
//   1. **Respuesta fresca** (menos de `TTL_MS`): la de memoria.
//   2. **Sin red, con respuesta guardada**: la última que se recibió,
//      leída de `localStorage`. v1.10 asume un terminal y asume que se
//      queda sin red; «Ahora» no puede ser la pestaña que se rompe
//      cuando se cae el router, porque es la que abre.
//   3. **Sin red y sin nada guardado** (terminal recién emparejado que
//      arranca offline): `null`, y quien pinta cae **al orden de
//      familias** — los primeros de cada familia, calculados en local.
//      Nunca una rejilla vacía.
//
// El caso 3 duplica en el cliente el relleno que el servidor ya hace,
// y eso es deliberado: son dos sitios porque son dos situaciones
// (el servidor rellena cuando el comercio no tiene ventas, el cliente
// cuando no hay servidor). La regla de reparto es la MISMA y vive en
// `fillFromFamilies`, así que lo que el camarero ve offline está en el
// mismo sitio que lo que ve online.

import { apiWithCashier } from "../api.js";
import type { CatalogProduct } from "./catalog.js";

export interface AhoraResponse {
  /**
   * `sales` = los veinte salen de ventas en esta franja.
   * `mixed`  = hubo ventas pero no llegaban a veinte.
   * `families` = este comercio no tiene ventas en esta franja.
   */
  source: "sales" | "mixed" | "families";
  bandHours: number;
  windowDays: number;
  items: Array<{ productId: string; units: number }>;
}

/** Cuántos productos pinta «Ahora». Es el 4 × 5 de la maqueta. */
export const AHORA_LIMIT = 20;

/**
 * Cuánto dura la respuesta en memoria.
 *
 * Cinco minutos, no dos como `topSellers`. La diferencia tiene motivo:
 * el ranking del turno cambia con cada cobro, pero la franja horaria de
 * los últimos 28 días no se mueve por tres cañas más — lo que la cambia
 * es que pase la hora. Y «Ahora» se pide al entrar en CADA mesa, que en
 * hora punta son decenas de veces: con dos minutos sería un goteo
 * constante de peticiones para una respuesta que no ha cambiado.
 *
 * Que la vista se reordene sola NO significa que se reordene mientras el
 * camarero la está mirando: eso es justo lo que rompería el
 * reconocimiento por posición. Cinco minutos es suficientemente rápido
 * para cruzar del desayuno al aperitivo y suficientemente lento para que
 * la rejilla no baile entre dos mesas seguidas.
 */
const TTL_MS = 300_000;

const STORAGE_KEY = "mipiacetpv-ahora";

let cache: { at: number; value: AhoraResponse } | null = null;

export function clearAhoraCache(): void {
  cache = null;
}

function isAhoraResponse(v: unknown): v is AhoraResponse {
  if (!v || typeof v !== "object") return false;
  const r = v as Partial<AhoraResponse>;
  return Array.isArray(r.items);
}

function normalize(raw: unknown): AhoraResponse {
  const r = (raw ?? {}) as Partial<AhoraResponse>;
  const source =
    r.source === "sales" || r.source === "mixed" || r.source === "families"
      ? r.source
      : "families";
  return {
    source,
    bandHours: typeof r.bandHours === "number" ? r.bandHours : 1,
    windowDays: typeof r.windowDays === "number" ? r.windowDays : 28,
    items: Array.isArray(r.items)
      ? r.items.filter(
          (i): i is { productId: string; units: number } =>
            !!i && typeof i.productId === "string",
        )
      : [],
  };
}

/** La última respuesta recibida, para cuando no hay red. */
export function loadStoredAhora(): AhoraResponse | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isAhoraResponse(parsed) ? normalize(parsed) : null;
  } catch {
    return null;
  }
}

function storeAhora(value: AhoraResponse): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* cuota llena: se pierde sólo la caída nº 2 (offline con respuesta
       guardada); la nº 3 sigue cubriendo el caso */
  }
}

/**
 * Pide «Ahora», con las tres caídas de la cabecera.
 *
 * **No lanza.** Un fallo de red en esta llamada no puede dejar la
 * pantalla de venta sin pintar: la vista que abre por defecto tiene que
 * abrir siempre. Devuelve `null` sólo cuando no hay ni red ni nada
 * guardado, y entonces quien pinta cae al orden de familias.
 */
export async function fetchAhora(
  limit = AHORA_LIMIT,
): Promise<AhoraResponse | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    const res = await apiWithCashier(`/tpv/catalog/now?limit=${limit}`);
    const value = normalize(res);
    cache = { at: Date.now(), value };
    storeAhora(value);
    return value;
  } catch {
    // Caída 2 y 3. El `catch` es ancho a propósito: aquí no hay ningún
    // error que merezca romper la venta, y distinguir un 500 de un
    // `status: 0` no cambiaría lo que se hace.
    const stored = loadStoredAhora();
    if (stored) {
      cache = { at: Date.now(), value: stored };
      return stored;
    }
    return null;
  }
}

/**
 * El relleno por familias, en el cliente.
 *
 * MISMA regla que `firstOfEachFamily` del servidor: los primeros de cada
 * familia, en el orden del catálogo, repartiendo **por turnos** (uno de
 * cada familia, luego el segundo de cada una…).
 *
 * Por turnos y no familia a familia: con nueve familias y veinte huecos,
 * volcarlas en orden dejaría «Ahora» con los veinte productos de las dos
 * primeras familias alfabéticas. Un camarero que abre el TPV sin red
 * vería veinte cafés y ninguna caña, y pensaría que el catálogo está mal
 * cargado.
 *
 * `familyOf` se pasa en vez de leer `p.tags[0]` aquí dentro para que sea
 * la MISMA función que decide de qué familia es el botón en la rejilla:
 * si este módulo agrupara por un criterio y la rejilla por otro, el
 * relleno saldría de una familia y el botón se pintaría del color de
 * otra.
 */
export function fillFromFamilies(
  catalog: CatalogProduct[],
  familyOf: (p: CatalogProduct) => string,
  limit = AHORA_LIMIT,
  exclude: ReadonlySet<string> = new Set(),
): CatalogProduct[] {
  const byFamily = new Map<string, CatalogProduct[]>();
  for (const p of catalog) {
    if (exclude.has(p.id)) continue;
    const family = familyOf(p);
    const bucket = byFamily.get(family);
    if (bucket) bucket.push(p);
    else byFamily.set(family, [p]);
  }
  const families = [...byFamily.keys()].sort();
  const out: CatalogProduct[] = [];
  let round = 0;
  while (out.length < limit) {
    let added = false;
    for (const family of families) {
      if (out.length >= limit) break;
      const p = byFamily.get(family)?.[round];
      if (!p) continue;
      out.push(p);
      added = true;
    }
    if (!added) break; // se agotó el catálogo antes que los huecos
    round += 1;
  }
  return out;
}

/**
 * Los productos de «Ahora», pintables y en orden.
 *
 * Cruza el ranking con el catálogo local y, si se queda corto —porque no
 * hay ranking (offline sin nada guardado) o porque el ranking trae
 * productos que este terminal no tiene cacheados—, completa con el orden
 * de familias.
 *
 * Completar y no devolver lo que salga: «Ahora» es la vista que abre, y
 * una rejilla con catorce botones y seis huecos se lee como una pantalla
 * a medio cargar.
 */
export function resolveAhora(
  ranking: AhoraResponse | null,
  catalog: CatalogProduct[],
  familyOf: (p: CatalogProduct) => string,
  limit = AHORA_LIMIT,
): CatalogProduct[] {
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const out: CatalogProduct[] = [];
  const seen = new Set<string>();
  for (const item of ranking?.items ?? []) {
    const p = byId.get(item.productId);
    if (!p || seen.has(p.id)) continue;
    out.push(p);
    seen.add(p.id);
    if (out.length >= limit) break;
  }
  if (out.length >= limit) return out;
  return [
    ...out,
    ...fillFromFamilies(catalog, familyOf, limit - out.length, seen),
  ];
}
