import type { HoldedClient } from "./client.js";

// Tipo de IVA tal como Holded lo devuelve en /invoicing/v1/taxes
// (spike §03.A confirmó el endpoint correcto y 103 elementos en sandbox).
// El identificador (`s_iva_21`) y el rate numérico (21) permiten mapeo
// bidireccional.
export interface HoldedTax {
  id: string; // "s_iva_21"
  name?: string;
  rate?: number; // 21
  // Algunos tipos llevan rate como string. Mantenemos `raw` para inspección.
  [extra: string]: unknown;
}

export async function listTaxes(client: HoldedClient): Promise<HoldedTax[]> {
  const result = await client.request<unknown>("/invoicing/v1/taxes");
  if (!Array.isArray(result)) {
    throw new TypeError("GET /invoicing/v1/taxes no devolvió array");
  }
  return result as HoldedTax[];
}

// "s_iva_21" → 21. Devuelve null si el id no encaja con el patrón.
// Sólo cubre la familia general `s_iva_<rate>`. Holded usa otros prefijos
// (`s_iva_red_*`, `s_iva_super_red_*`, equivalencias regionales) que NO
// matchean este regex; para esos casos hay que usar el rate numérico
// devuelto por `/invoicing/v1/taxes` (ver `buildTaxRateResolver`).
export function parseTaxRateFromId(taxId: string | undefined): number | null {
  if (!taxId) return null;
  const m = taxId.match(/^s_iva_(\d+)$/);
  return m && m[1] ? Number(m[1]) : null;
}

// Construye un resolver `(taxId) → rate | null` a partir del listado que
// devuelve `/invoicing/v1/taxes`. El rate del propio Holded tiene
// preferencia sobre el regex (cubre alias regionales y tipos reducidos
// que el regex no entiende). Si no encuentra el id ni en el array ni en
// el regex, devuelve null — la línea NO debe persistirse como
// `taxRate = 0` silencioso (eso provoca el silent reject de §1.1).
export function buildTaxRateResolver(
  taxes: HoldedTax[],
): (taxId: string | undefined) => number | null {
  const map = new Map<string, number>();
  for (const t of taxes) {
    if (!t.id) continue;
    if (typeof t.rate === "number" && Number.isFinite(t.rate)) {
      map.set(t.id, t.rate);
      continue;
    }
    const fallback = parseTaxRateFromId(t.id);
    if (fallback !== null) map.set(t.id, fallback);
  }
  return (taxId) => {
    if (!taxId) return null;
    const fromMap = map.get(taxId);
    if (typeof fromMap === "number") return fromMap;
    return parseTaxRateFromId(taxId);
  };
}
