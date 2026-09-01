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
