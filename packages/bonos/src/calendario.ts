// B-reservas-8 · aritmética de MESES DE CALENDARIO.
//
// `07` pieza 18, una de las trampas que el spa pagó: **seis meses no son
// 183 días.** Un bono vendido el 31 de agosto con seis meses caduca el 28 de
// febrero (o el 29, si el año es bisiesto), no el 1 de marzo ni el 2.
//
// Aquí sólo está el calendario —sin husos, sin instantes y sin `Date` de
// zona—. La conversión a un instante UTC en hora del centro vive en la API
// (`vouchers/caducidad.ts`), que es la que conoce la zona del negocio.

/** El último día de un mes (1-12) de un año. */
function ultimoDiaDelMes(anio: number, mes1a12: number): number {
  // Día 0 del mes siguiente = último día de éste. `Date.UTC` sirve: aquí se
  // cuenta calendario, no instantes.
  return new Date(Date.UTC(anio, mes1a12, 0)).getUTCDate();
}

/**
 * Suma `meses` de calendario a una fecha de pared `YYYY-MM-DD`, recortando
 * el día al último del mes destino.
 *
 *   31-ago + 6 → 28-feb (o 29-feb en bisiesto)
 *   31-ene + 1 → 28-feb
 *   15-mar + 3 → 15-jun
 */
export function sumarMesesDeCalendario(fecha: string, meses: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const totalMes = y! * 12 + (m! - 1) + meses;
  const anio = Math.floor(totalMes / 12);
  const mes = (totalMes % 12) + 1;
  const dia = Math.min(d!, ultimoDiaDelMes(anio, mes));
  return `${String(anio).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** La fecha de pared del día siguiente a `fecha` (`YYYY-MM-DD`). */
export function diaSiguiente(fecha: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** «28-feb-2027» para pintar. Formato corto español, sin hora: la hora de
 *  una caducidad no se enseña nunca porque el día entra entero. */
const MESES_CORTOS = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

export function fechaCorta(fecha: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  return `${d}-${MESES_CORTOS[m! - 1]}-${y}`;
}
