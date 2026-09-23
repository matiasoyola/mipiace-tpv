// Sole · qué hacer con el email que llega en un cobro.
//
// La regla de este bloque, y es una sola frase: **un email malo no tumba
// una venta.** Cuando el cobro llega a la API el dinero ya ha cambiado de
// manos — la clienta ya ha pasado la tarjeta. Devolver un 400 por el
// campo de email dejaría la venta fuera del sistema para arreglar un
// campo opcional, que es peor incidente que el que arregla.
//
// Así que el email se cae solo: no se persiste, no se encola, y la
// respuesta lo dice para que el TPV pueda enseñarlo. El resto del cobro
// sigue su camino exacto.
//
// El contraste con `resend-email` es deliberado y está en el mismo
// bloque: ahí NO hay dinero de por medio, la petición existe sólo para
// mandar el email, y un email inválido sí es un 400 — rechazar la
// petición es justamente lo que el cajero necesita saber.

import { normalizeEmail, validEmailOrNull } from "@mipiacetpv/util-validation";

export interface EmailIntentDecision {
  /** Lo que se persiste y se encola. `null` = no hay email en esta venta. */
  email: string | null;
  /**
   * Poblado sólo cuando el cajero SÍ escribió algo y ese algo no era un
   * email. Viaja en la respuesta del cobro para que el TPV pueda decir
   * "no se enviará" en vez de callarse. Un campo vacío no es un rechazo:
   * es una venta sin email, y no se avisa de nada.
   */
  rejected: { reason: "INVALID_EMAIL"; value: string } | null;
}

export function decideEmailIntent(
  raw: string | null | undefined,
): EmailIntentDecision {
  const trimmed = normalizeEmail(raw);
  if (trimmed.length === 0) return { email: null, rejected: null };
  const email = validEmailOrNull(trimmed);
  if (email) return { email, rejected: null };
  return {
    email: null,
    // El valor vuelve tal cual lo tecleó el cajero (recortado): el TPV lo
    // pinta para que Ana vea QUÉ se descartó y pueda reenviarlo corregido
    // desde el histórico sin tener que acordarse de lo que escribió.
    rejected: { reason: "INVALID_EMAIL", value: trimmed },
  };
}
