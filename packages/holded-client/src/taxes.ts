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
export function parseTaxRateFromId(taxId: string | undefined): number | null {
  if (!taxId) return null;
  const m = taxId.match(/^s_iva_(\d+)$/);
  return m && m[1] ? Number(m[1]) : null;
}
