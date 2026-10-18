// B-reservas-8 · la caducidad de un bono, en MESES DE CALENDARIO.
//
// `07` pieza 18, y es una de las trampas que el spa pagó: **seis meses no
// son 183 días.** Un bono vendido el 31 de agosto con seis meses caduca el
// 28 de febrero (o el 29, si el año es bisiesto), no el 1 de marzo ni el 2.
// Y «caduca el día X» incluye el día X ENTERO en hora del centro.
//
// ── Cómo se guarda, que es la decisión ─────────────────────────────────
//
// `Voucher.expiresAt` es el INSTANTE EN QUE DEJA DE VALER, exclusivo: el
// arranque del día siguiente al último día bueno, en hora del centro. Así
//
//     caducado  ⟺  ahora >= expiresAt
//
// es una comparación y no un razonamiento sobre husos y horas de pared, y
// el día que se PINTA se deriva (`diaDeCaducidad`). La alternativa —guardar
// la fecha inclusiva y convertir en cada comparación— reparte la regla del
// borde entre todos los llamantes, y el borde es justo donde falla.
//
// Nada de `now()` de Postgres: el negocio se fecha desde el código (regla
// del bloque, y `05` §8.6 — con todo en UTC, una venta a las 00:30 salía
// con el día anterior).

import { diaSiguiente, sumarMesesDeCalendario } from "@mipiacetpv/bonos";

import { CENTER_TZ, utcToWallDate, wallTimeToUtc } from "../agenda/time.js";

/**
 * El instante en que un bono vendido `ahora` deja de valer, dado un plazo
 * en meses de calendario. `null` (sin plazo) → `null`: sin caducidad.
 *
 * Se razona en la fecha de PARED del centro y se devuelve un instante UTC.
 */
export function calcularCaducidad(
  ahora: Date,
  meses: number | null | undefined,
  tz: string = CENTER_TZ,
): Date | null {
  if (meses == null) return null;
  const diaDeVenta = utcToWallDate(ahora, tz);
  const ultimoDiaBueno = sumarMesesDeCalendario(diaDeVenta, meses);
  // El arranque del día SIGUIENTE: el último día bueno entra entero.
  return wallTimeToUtc(diaSiguiente(ultimoDiaBueno), "00:00", tz);
}

/**
 * El día que se PINTA («caduca el 28-feb»), derivado del instante
 * exclusivo. Un milisegundo antes del corte sigue siendo el último día
 * bueno, y eso es justo lo que se quiere enseñar.
 */
export function diaDeCaducidad(
  expiresAt: Date | null | undefined,
  tz: string = CENTER_TZ,
): string | null {
  if (expiresAt == null) return null;
  return utcToWallDate(new Date(expiresAt.getTime() - 1), tz);
}

/** ¿Está caducado este bono a `ahora`? Sin plazo, nunca. */
export function estaCaducado(
  expiresAt: Date | null | undefined,
  ahora: Date,
): boolean {
  if (expiresAt == null) return false;
  return ahora.getTime() >= expiresAt.getTime();
}

/**
 * PROLONGAR la caducidad: el mismo cálculo de meses de calendario, pero
 * contado desde el día en que caducaba (o desde hoy si no caducaba, que es
 * lo que hace el encargado cuando le pone fecha a un bono que no la tenía).
 *
 * Deja línea en el libro con motivo — eso lo hace la ruta; aquí sólo está
 * la aritmética.
 */
export function prolongarCaducidad(
  expiresAt: Date | null,
  mesesMas: number,
  ahora: Date,
  tz: string = CENTER_TZ,
): Date {
  const desde = diaDeCaducidad(expiresAt, tz) ?? utcToWallDate(ahora, tz);
  const nuevoUltimoDia = sumarMesesDeCalendario(desde, mesesMas);
  return wallTimeToUtc(diaSiguiente(nuevoUltimoDia), "00:00", tz);
}
