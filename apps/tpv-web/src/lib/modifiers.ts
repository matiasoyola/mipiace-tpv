// B-Bar-Modifiers · catálogo de modificadores en el TPV.
//
// El dataset típico de un bar es pequeño (<100 modifiers); cargamos
// todo en memoria al primer mount de SalePage y reusamos hasta que el
// usuario refresque el catálogo manualmente. No necesita IndexedDB —
// si el navegador recarga, se vuelve a pedir.

import { apiWithCashier } from "../api.js";

export interface CatalogModifier {
  id: string;
  label: string;
  priceDeltaCents: number;
  sortOrder: number;
  isDefault: boolean;
}

export interface CatalogModifierGroup {
  id: string;
  name: string;
  exclusive: boolean;
  required: boolean;
  sortOrder: number;
  productIds: string[];
  modifiers: CatalogModifier[];
}

export async function loadModifierGroups(): Promise<CatalogModifierGroup[]> {
  const res = await apiWithCashier<{ groups: CatalogModifierGroup[] }>(
    "/tpv/catalog/modifier-groups",
  );
  return res.groups;
}

// Indexa los grupos por productId para que el TPV pueda preguntar
// rápidamente "¿este producto tiene modifiers?" al pulsar un tile.
export function buildGroupsByProduct(
  groups: CatalogModifierGroup[],
): Map<string, CatalogModifierGroup[]> {
  const byProduct = new Map<string, CatalogModifierGroup[]>();
  for (const group of groups) {
    for (const productId of group.productIds) {
      let list = byProduct.get(productId);
      if (!list) {
        list = [];
        byProduct.set(productId, list);
      }
      list.push(group);
    }
  }
  // Ordenar por sortOrder dentro de cada producto.
  for (const list of byProduct.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder);
  }
  return byProduct;
}
