// Formateador único de importes de la app (v1.10.3 · hallazgo #6 de la
// simulación de hora punta del 2026-08-20).
//
// Hasta ahora cada pantalla llevaba su propia copia de
// `const formatEur = (n) => n.toFixed(2).replace(".", ",") + " €"`, y
// unas cuantas (modal de cobro, agrupar mesas, partir cuenta, arqueo)
// pintaban directamente `n.toFixed(2) + " €"` → "3.50 €" con punto,
// frente a "3,50 €" en el resto. Un solo sitio, una sola forma.
//
// Convención: coma decimal, 2 decimales siempre, espacio fino antes
// del símbolo (locale es-ES). Sin separador de millares: en un TPV de
// hostelería los importes no llegan a cuatro cifras y el separador
// añade ruido en tipografías `tabular-nums` estrechas.

// Importe sin símbolo: "3,50". Útil para rellenar <input> de importe.
export function formatAmount(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  // `-0` existe en JS y `(-0).toFixed(2)` da "0.00", pero un
  // `-0.004` redondea a "-0.00". Normalizamos a cero.
  const safe = Math.abs(v) < 0.005 ? 0 : v;
  return safe.toFixed(2).replace(".", ",");
}

// Importe con símbolo: "3,50 €".
export function formatEur(n: number): string {
  return formatAmount(n) + " €";
}

// Lectura tolerante de lo que teclea el cajero: acepta coma o punto
// como separador decimal, espacios y el símbolo €. Devuelve 0 para
// cualquier cosa que no sea un número (nunca NaN: la suma de pagos no
// puede envenenarse porque una fila esté a medio escribir).
export function parseAmount(s: string): number {
  const clean = String(s ?? "")
    .replace(/[€\s ]/g, "")
    .trim();
  if (!clean) return 0;
  const lastComma = clean.lastIndexOf(",");
  const lastDot = clean.lastIndexOf(".");
  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    // Vienen los dos: el ÚLTIMO manda como separador decimal y el
    // otro era de millares ("1.234,50" y "1,234.50" dan 1234.5).
    const decimalSep = lastComma > lastDot ? "," : ".";
    const thousandSep = decimalSep === "," ? "." : ",";
    normalized = clean.split(thousandSep).join("").replace(decimalSep, ".");
  } else {
    normalized = clean.replace(",", ".");
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}
