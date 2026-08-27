// v1.11-addendum-2 · el título del resumen del día sale de la FECHA del
// turno, no de una constante.
//
// Antes era `title="Así fue el día de ayer"` fijo. Dos formas de mentir,
// las dos reales:
//   - Cualquier negocio con día de cierre. Sole libra domingo y lunes:
//     el martes por la mañana "ayer" es el sábado. Pasa cada semana.
//   - Un terminal que no abre en una temporada. El resumen de su último
//     día sí hay que enseñarlo — con su fecha bien dicha.
//
// Fecha de PARED local del dispositivo (que es la del negocio), y la
// distancia se mide en días de calendario, no en horas: el 25/10 dura 25
// horas y "ayer" seguiría siendo ayer.

/** Días de calendario entre dos instantes, por medianoche local. */
export function calendarDaysAgo(closedAt: Date, now: Date): number {
  const a = new Date(closedAt.getFullYear(), closedAt.getMonth(), closedAt.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * Título de la tarjeta del resumen para un turno cerrado.
 *
 * hoy → "Así fue el turno de hoy"
 * ayer → "Así fue el día de ayer"
 * esta semana → "Así fue el sábado 22 de agosto"
 * más atrás → "Así fue el 9 de julio de 2026"
 */
export function daySummaryTitle(
  closedAtIso: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!closedAtIso) return "Así fue el último turno";
  const closed = new Date(closedAtIso);
  if (Number.isNaN(closed.getTime())) return "Así fue el último turno";

  const days = calendarDaysAgo(closed, now);
  // Negativo = reloj del terminal atrasado respecto al server. No es
  // motivo para inventarse nada: es el turno de hoy.
  if (days <= 0) return "Así fue el turno de hoy";
  if (days === 1) return "Así fue el día de ayer";
  if (days <= 7) {
    return `Así fue el ${closed.toLocaleDateString("es-ES", {
      weekday: "long",
      day: "numeric",
      month: "long",
    })}`;
  }
  return `Así fue el ${closed.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })}`;
}
