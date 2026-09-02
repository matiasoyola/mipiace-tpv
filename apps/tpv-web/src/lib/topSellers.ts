// v1.14-la-comanda-se-ve §4 · los más vendidos para el estado vacío del
// ticket.
//
// El ranking lo calcula la API (`GET /tpv/catalog/top-sellers`), que es
// quien tiene los tickets. Aquí sólo se pide, se cachea en memoria por
// turno y se resuelve contra el catálogo local — así el estado vacío se
// pinta sin esperar a la red en la segunda mesa y las siguientes, y
// offline degrada a "no se pinta", nunca a un error.

import { apiWithCashier } from "../api.js";
import type { CatalogProduct } from "./catalog.js";

export interface TopSellersResponse {
  source: "shift" | "month";
  items: Array<{ productId: string; units: number }>;
}

// Cache por turno. El ranking del turno cambia con cada cobro, pero no
// tanto como para pagar una petición por cada mesa que se abre: 2
// minutos es más que suficiente en hora punta y evita el goteo.
const TTL_MS = 120_000;

let cache: { key: string; at: number; value: TopSellersResponse } | null = null;

export function clearTopSellersCache(): void {
  cache = null;
}

export async function fetchTopSellers(
  shiftId: string | null,
  limit = 5,
): Promise<TopSellersResponse> {
  const key = `${shiftId ?? "-"}:${limit}`;
  if (cache && cache.key === key && Date.now() - cache.at < TTL_MS) {
    return cache.value;
  }
  const params = new URLSearchParams({ limit: String(limit) });
  if (shiftId) params.set("shiftId", shiftId);
  const res = (await apiWithCashier(
    `/tpv/catalog/top-sellers?${params.toString()}`,
  )) as TopSellersResponse;
  const value: TopSellersResponse = {
    source: res?.source === "shift" ? "shift" : "month",
    items: Array.isArray(res?.items) ? res.items : [],
  };
  cache = { key, at: Date.now(), value };
  return value;
}

/**
 * Cruza el ranking con el catálogo local y devuelve productos pintables
 * en el orden del ranking. Lo que no esté en el catálogo cacheado se
 * cae: es preferible enseñar tres atajos buenos que cinco con huecos.
 */
export function resolveTopSellers(
  ranking: TopSellersResponse | null,
  catalog: CatalogProduct[],
  limit = 5,
): CatalogProduct[] {
  if (!ranking || ranking.items.length === 0) return [];
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const out: CatalogProduct[] = [];
  for (const item of ranking.items) {
    const p = byId.get(item.productId);
    if (p) out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * v1.14.1-el-catalogo-manda §3 · cuántos atajos de "lo que más sale"
 * caben en el panel del ticket para un ticket de `lineCount` líneas.
 *
 * En v1.14 los atajos eran SÓLO el estado vacío. Sobre la captura del
 * AP11 se vio el problema siguiente: con una línea el desglose es un
 * desierto de ~220 px y el panel no parece un ticket, parece roto. Este
 * bloque llena ese hueco con lo mismo que llena el vacío, porque es lo
 * mismo que hace falta: añadir el segundo café sin volver a buscarlo en
 * la rejilla de la izquierda.
 *
 * Los números NO salen de sumar sobre el papel: salen de medir el panel
 * en el navegador a 1280 × 800, y la primera versión de este bloque los
 * calculó mal. La lista mide 304 px con `py-3`, cada línea del ticket 90
 * y cada atajo hasta 71 (el nombre va a `line-clamp-2`, así que 71 es un
 * techo, no una media). El bloque de atajos cuesta 16 px de separación
 * más 27 de rótulo antes del primer atajo.
 *
 *   0 líneas → 280 px libres → los cinco. Es el estado vacío (v1.14 §4).
 *   1 línea  → 190 px libres → 114 de una fila de dos. Caben.
 *   2 líneas → 100 px libres → 114 de una fila de dos. **No caben.**
 *   3+       → no sobra nada → ninguno.
 *
 * A partir de tres líneas el ticket es lo que hay que ver: **el atajo
 * desaparece en cuanto compite con las líneas**, que son el contenido.
 *
 * Con una línea caben 190 px y dos filas de atajos piden 193: se quedan
 * en UNA fila. Que falte por tres píxeles no es motivo para apretar los
 * márgenes hasta que entren — v1.14 ya cortó por abajo el quinto atajo
 * del estado vacío haciendo exactamente eso, y un atajo cortado es peor
 * que un atajo que no está. Con dos líneas la fila pide 114 sobre 100
 * disponibles, así que tampoco se pinta.
 *
 * El corte va por número de líneas y no por medida del DOM a propósito.
 * Medir obligaría a un efecto tras el layout y el bloque entraría y
 * saldría con cada pulsación, que es peor que no tenerlo. Con el número
 * de líneas la decisión es determinista, se testea sin navegador y se
 * equivoca del lado bueno: de menos, nunca de más.
 *
 * Es la ÚNICA regla: la usan tanto la carga del ranking como el pintado.
 * Si fueran dos, un día el panel pediría atajos que nadie ha cargado —o
 * al revés— y el síntoma sería un hueco silencioso.
 */
export function topSellersSlotsFor(lineCount: number): number {
  if (lineCount <= 0) return 5;
  if (lineCount === 1) return 2;
  return 0;
}
