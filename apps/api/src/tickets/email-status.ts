// Sole · en qué estado está de verdad el email de un ticket.
//
// Antes de este bloque el TPV pintaba "Enviado por email a …" en cuanto
// existía una fila en `ticket_email_jobs`. Existir un job no es haberse
// enviado: el badge se pinta ~200 ms después del cobro y el worker no ha
// corrido todavía. El 17-09 eso hizo que Ana leyera "Enviado" sobre un
// envío que falló tres veces esa misma tarde.
//
// El criterio del bloque: **el TPV no miente.** Si dice "enviado", se ha
// enviado; si todavía no puede saberlo, dice que se enviará; y si salió
// mal, lo dice con el motivo. Esa decisión se toma AQUÍ, una vez, y la
// consumen el histórico del TPV, la pantalla post-cobro y el resumen del
// panel — para que los tres no puedan discrepar.

export type TicketEmailStatus = "SENT" | "PENDING" | "FAILED" | "SKIPPED_TEST";

export interface TicketEmailState {
  /** A quién iba (o a quién iría). Alimenta el reenvío prellenado. */
  to: string | null;
  /** `null` = este ticket no tiene ningún envío detrás. */
  status: TicketEmailStatus | null;
  /** Sólo en FAILED, y en lenguaje de persona. */
  reason: string | null;
  /** Cuándo se envió / cuándo falló / cuándo se encoló. ISO. */
  at: string | null;
}

export interface EmailJobShape {
  toEmail: string;
  status: string;
  sentAt: Date | null;
  createdAt: Date;
  lastError: unknown;
}

// Lo que ve Ana cuando el envío sale mal. Ni códigos, ni inglés, ni el
// volcado del error de SMTP: una frase que le diga si tiene que corregir
// algo ella o si toca esperar.
const MOTIVO_DIRECCION = "La dirección no es válida";
const MOTIVO_RECHAZO = "El servidor de correo la rechazó";
const MOTIVO_SIN_RESPUESTA = "No hubo respuesta del servidor de correo";
const MOTIVO_TICKET = "El ticket ya no existe";
const MOTIVO_GENERICO = "No se pudo enviar";

/**
 * Traduce el `last_error` del job a una frase. Es lo único que se
 * enseña: el detalle técnico se queda en el JSON para quien depure.
 */
export function humanEmailFailureReason(lastError: unknown): string {
  if (!lastError || typeof lastError !== "object") return MOTIVO_GENERICO;
  const err = lastError as { reason?: unknown; message?: unknown };
  const reason = typeof err.reason === "string" ? err.reason : "";
  if (reason === "invalid_email") return MOTIVO_DIRECCION;
  if (reason === "ticket_not_found") return MOTIVO_TICKET;

  const message = typeof err.message === "string" ? err.message : "";
  // El orden importa: los errores de red se miran PRIMERO. Un
  // "connect ETIMEDOUT 10.0.0.1:587" lleva dentro el 587 del puerto, y
  // buscando "5xx" antes se clasificaba como rechazo del servidor — o
  // sea, se le decía a Ana que corrigiera una dirección que estaba bien.
  if (
    /timeout|etimedout|econnrefused|econnreset|enotfound|socket|network|dns/i.test(
      message,
    )
  ) {
    return MOTIVO_SIN_RESPUESTA;
  }
  // Los 5xx de SMTP y los "mailbox unavailable" son rechazos del otro
  // lado: el email está mal escrito o la cuenta ya no existe. Ahí Ana
  // puede hacer algo — corregir la dirección y reenviar. El código va
  // al principio de la respuesta o tras un espacio ("550 5.1.1 …"),
  // nunca pegado a dos puntos como un puerto.
  if (
    /(^|\s)5\d\d([\s-]|$)|rejected|rechaz|mailbox|recipient|no such user/i.test(
      message,
    )
  ) {
    return MOTIVO_RECHAZO;
  }
  return MOTIVO_GENERICO;
}

/**
 * El estado del envío de UN ticket, a partir de su último job.
 *
 * `emailFailedAt` entra en la cuenta porque es la marca que dejaba el
 * worker antes de este bloque: un ticket del 17-09 tiene la marca del
 * ticket puesta y el job todavía en PENDING (el worker nunca escribía
 * el estado terminal). Sin esto, esos tickets seguirían diciendo
 * "pendiente" para siempre.
 */
export function deriveTicketEmailState(args: {
  jobs: EmailJobShape[];
  emailIntent: string | null;
  emailFailedAt: Date | null;
}): TicketEmailState {
  // El más reciente manda: un reenvío correcto tapa un fallo anterior,
  // que es exactamente lo que pasó con el 000257 cuando se arregló a
  // mano el 18-09.
  const job = [...args.jobs].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )[0];

  if (!job) {
    // Sin job no ha habido envío. `to` se queda con lo que el cajero
    // tecleó para que el reenvío del histórico nazca prellenado.
    return {
      to: args.emailIntent,
      status: null,
      reason: null,
      at: null,
    };
  }

  if (job.status === "DONE") {
    return {
      to: job.toEmail,
      status: "SENT",
      reason: null,
      at: (job.sentAt ?? job.createdAt).toISOString(),
    };
  }
  if (job.status === "SKIPPED_TEST") {
    return {
      to: job.toEmail,
      status: "SKIPPED_TEST",
      reason: null,
      at: (job.sentAt ?? job.createdAt).toISOString(),
    };
  }
  if (job.status === "FAILED") {
    return {
      to: job.toEmail,
      status: "FAILED",
      reason: humanEmailFailureReason(job.lastError),
      at: (args.emailFailedAt ?? job.createdAt).toISOString(),
    };
  }

  // PENDING en la fila. Dos casos distintos con el mismo valor guardado:
  if (args.emailFailedAt && args.emailFailedAt > job.createdAt) {
    // El ticket está marcado como fallido DESPUÉS de crearse este job:
    // es un envío de antes de este bloque que agotó sus tres intentos y
    // se quedó con la fila sin actualizar. Decir "pendiente" sería la
    // misma mentira, sólo que en el otro sentido.
    return {
      to: job.toEmail,
      status: "FAILED",
      reason: humanEmailFailureReason(job.lastError),
      at: args.emailFailedAt.toISOString(),
    };
  }
  return {
    to: job.toEmail,
    status: "PENDING",
    reason: null,
    at: job.createdAt.toISOString(),
  };
}

/** Lo que se pide a Prisma para poder derivar el estado. */
export const EMAIL_JOB_SELECT = {
  toEmail: true,
  status: true,
  sentAt: true,
  createdAt: true,
  lastError: true,
} as const;
