import type { HoldedClient } from "./client.js";

// Tipo de IVA tal como Holded lo devuelve en /invoicing/v1/taxes (spike
// §03.A confirmó 103 elementos en sandbox; §11 confirmó el shape
// completo). Campos relevantes:
//
//   - `key`     · slug estable ("s_iva_21", "tax_49_sales", "s_rec_0").
//                 Es el campo que `Product.taxes[]` referencia (spike §11
//                 cross-match `key` = 1/1). Siempre poblado.
//   - `id`      · UUID-like ("69b7f6b4170c9d1c8c042921"). Sólo se puebla
//                 para taxes custom creados por el dueño; los del catálogo
//                 estándar Holded vienen con `id: ""` (¡vacío!). NO usar
//                 como clave primaria.
//   - `amount`  · porcentaje como STRING ("21", "5.2", "0"). Hay que
//                 parsearlo a número (`Number(amount)`).
//   - `name`    · etiqueta humana ("IVA 21%", "REC 0%").
//   - `scope`   · "sales" | "purchases". Filtrable si queremos sólo IVA
//                 de venta.
//   - `group`   · "iva" | "receq" (recargo de equivalencia).
//   - `type`    · "percentage" (otros valores no observados).
//
// `rate` se exponía antes como campo opcional asumiendo que Holded lo
// devolvía como number — falso. Lo dejamos calculado (derivado de
// `amount`) por compatibilidad con callers anteriores.
export interface HoldedTax {
  id?: string;
  key: string;
  name?: string;
  amount?: string;
  scope?: "sales" | "purchases" | string;
  group?: "iva" | "receq" | string;
  type?: string;
  status?: boolean;
  visible?: boolean;
  // Derivado en `listTaxes` (parseado de `amount`). null si no se pudo.
  rate?: number | null;
  [extra: string]: unknown;
}

export async function listTaxes(client: HoldedClient): Promise<HoldedTax[]> {
  const result = await client.request<unknown>("/invoicing/v1/taxes");
  if (!Array.isArray(result)) {
    throw new TypeError("GET /invoicing/v1/taxes no devolvió array");
  }
  // Normalización: parseamos `amount` (string) → `rate` (number | null)
  // una sola vez para que el resolver no se preocupe.
  return (result as Array<Record<string, unknown>>).map((raw) => {
    const tax: HoldedTax = { ...(raw as HoldedTax) };
    if (typeof tax.rate !== "number" || !Number.isFinite(tax.rate)) {
      tax.rate = parseAmount(raw.amount);
    }
    return tax;
  });
}

function parseAmount(amount: unknown): number | null {
  if (typeof amount === "number" && Number.isFinite(amount)) return amount;
  if (typeof amount === "string" && amount.length > 0) {
    const n = Number(amount);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// "s_iva_21" → 21. Devuelve null si el id no encaja con el patrón.
// Sólo cubre la familia general `s_iva_<rate>`. Holded usa otros
// prefijos (`s_iva_red_*`, `s_iva_super_red_*`, equivalencias regionales,
// taxes custom `tax_NN_sales`) que NO matchean este regex; para esos
// casos hay que usar el rate numérico devuelto por
// `/invoicing/v1/taxes` (ver `buildTaxRateResolver`).
export function parseTaxRateFromId(taxId: string | undefined): number | null {
  if (!taxId) return null;
  const m = taxId.match(/^s_iva_(\d+)$/);
  return m && m[1] ? Number(m[1]) : null;
}

// Construye un resolver `(taxId) → rate | null` a partir del listado
// que devuelve `/invoicing/v1/taxes`. El identificador que los
// productos guardan en `taxes[]` es el `key` del tax (spike §11). Pero
// también indexamos por `id` como segunda vía por si Holded cambia el
// shape en el futuro o aparece una cuenta donde los productos
// referencian el id en vez del key. Como último recurso, regex
// `parseTaxRateFromId` (cubre `s_iva_21` aunque no estuviera en el
// listado). Si nada matchea, devuelve null — la línea NO debe
// persistirse como `taxRate = 0` silencioso (eso provoca el silent
// reject de §1.1).
export function buildTaxRateResolver(
  taxes: HoldedTax[],
): (taxId: string | undefined) => number | null {
  const map = new Map<string, number>();
  for (const t of taxes) {
    const rate =
      typeof t.rate === "number" && Number.isFinite(t.rate)
        ? t.rate
        : parseAmount(t.amount);
    if (rate === null) continue;
    if (typeof t.key === "string" && t.key.length > 0 && !map.has(t.key)) {
      map.set(t.key, rate);
    }
    if (typeof t.id === "string" && t.id.length > 0 && !map.has(t.id)) {
      map.set(t.id, rate);
    }
  }
  return (taxId) => {
    if (!taxId) return null;
    const fromMap = map.get(taxId);
    if (typeof fromMap === "number") return fromMap;
    return parseTaxRateFromId(taxId);
  };
}
