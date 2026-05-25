// v1.3-Thalia Lote 4 · helpers puros para arqueos por denominaciones.
// El cliente envía `denominations` como Record<string, number> donde
// la llave es el valor del billete/moneda en euros como string ("500",
// "0.50", "0.01"). El backend siempre re-calcula el total — el cliente
// no es de fiar para auditoría fiscal.
//
// Definimos aquí la lista canónica de denominaciones aceptadas para
// validar en el endpoint (rechazar llaves extra) y para poder iterar
// en orden de mayor a menor en el frontend cuando muestra la tabla.

export const ALLOWED_DENOMINATIONS: readonly string[] = [
  "500",
  "200",
  "100",
  "50",
  "20",
  "10",
  "5",
  "2",
  "1",
  "0.50",
  "0.20",
  "0.10",
  "0.05",
  "0.02",
  "0.01",
];

const DENOMINATION_SET = new Set(ALLOWED_DENOMINATIONS);

export interface CashCountValidation {
  ok: boolean;
  total: number;
  // Llave inválida o conteo no-entero → primer error visible en el
  // error que devolvemos al frontend. No acumulamos varios para no
  // gastar bytes en errores que sólo el cliente puede generar
  // (la UI valida lo mismo antes de mandar).
  error?: string;
}

// Acepta el body crudo, valida llaves y cuenta. Redondea a 2 decimales
// para evitar errores binarios al multiplicar (`0.1 * 3 !== 0.3`).
export function validateAndSumDenominations(
  raw: unknown,
): CashCountValidation {
  if (!raw || typeof raw !== "object") {
    return { ok: false, total: 0, error: "denominations debe ser un objeto" };
  }
  let totalCents = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (!DENOMINATION_SET.has(key)) {
      return {
        ok: false,
        total: 0,
        error: `denominación no soportada: "${key}"`,
      };
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return {
        ok: false,
        total: 0,
        error: `el conteo de "${key}" debe ser numérico`,
      };
    }
    if (value < 0 || !Number.isInteger(value)) {
      return {
        ok: false,
        total: 0,
        error: `el conteo de "${key}" debe ser entero >= 0`,
      };
    }
    // Trabajamos en céntimos para evitar errores binarios. La llave en
    // euros se convierte a céntimos multiplicando por 100 y redondeando
    // (Math.round porque "0.05" * 100 = 5.000000000000001 en JS).
    const denomCents = Math.round(Number(key) * 100);
    totalCents += denomCents * value;
  }
  return { ok: true, total: totalCents / 100 };
}
