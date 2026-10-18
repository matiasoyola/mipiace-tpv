// auditoria-sirope (#17) · ¿SE PUEDE DEVOLVER ESTE TICKET?
//
// ── Por qué esto existe ───────────────────────────────────────────────
//
// La pregunta se contestaba en DOS sitios con DOS respuestas distintas, y
// la diferencia dejó a Cafetería Sirope sin poder devolver nada el 18-10:
//
//   · El servidor (`tickets/routes.ts`) acepta `SYNCED`, `PAID` y `TEST`.
//   · El TPV (`TicketsHistoryPage.tsx`) sólo pintaba el botón con `SYNCED`,
//     o con `TEST` + el MODO PRUEBA ANTIGUO (el cajero técnico del
//     super-admin, `isTestModeActive()`).
//
// Las dos formas de cobrar que tiene una cuenta de hoy caían en el hueco:
//
//   · Cuenta SIN Holded: el ticket nace `PAID` (`paidTicketStatus`) y no
//     pasa nunca por `SYNCED`. Botón invisible.
//   · Cuenta EN ENSAYO (ADR-021): el ticket nace `TEST` sin que haya
//     ninguna sesión de cajero técnico. Botón invisible.
//
// El servidor habría devuelto el dinero en los dos casos. No había forma
// de pedírselo.
//
// ── La regla, en una frase ────────────────────────────────────────────
//
// Se devuelve lo que se COBRÓ DE VERDAD (`SYNCED`, `PAID`) y lo que se
// cobró DE MENTIRA A PROPÓSITO (`TEST`, pero sólo donde el ensayo tiene
// sentido: cuenta en ensayo o sesión de prueba). Lo demás no:
//
//   · `DRAFT` / `ON_CREDIT` → no ha salido dinero de la caja.
//   · `VOIDED` → ya se deshizo.
//   · `PENDING_SYNC` → se cobró, pero la devolución se calcula sobre el
//     documento de Holded, que todavía no existe. Es el estado que el TPV
//     atraviesa en segundos; el cajero reintenta y ya está. (Mismo
//     criterio que tenía el servidor antes de este bloque: no se amplía
//     aquí lo que nunca aceptó.)
//   · `SYNC_FAILED` → hay que arreglar la sincronización primero.
//
// Vive en `ticket-model` y no en `apps/api` porque los tres que la
// preguntan —el TPV, el servidor y el panel— ya dependen de este paquete.

/** Los estados de un ticket, como los nombra `TicketStatus` en
 *  `schema.prisma`. Se escriben aquí como unión de literales y no se
 *  importa el enum de Prisma para que el TPV pueda usar la regla sin
 *  arrastrar el cliente de la base de datos al navegador. El servidor pasa
 *  su enum tal cual: los valores coinciden. */
export type EstadoDeTicket =
  | "DRAFT"
  | "PAID"
  | "PENDING_SYNC"
  | "SYNCED"
  | "SYNC_FAILED"
  | "VOIDED"
  | "TEST"
  | "ON_CREDIT";

/**
 * El contexto de quien pregunta. Los dos campos son obligatorios: un
 * `select` que se olvide de `facturaDesde` leería «no está en ensayo» y
 * volvería a esconder el botón, que es justo el fallo que este módulo
 * viene a cerrar.
 */
export interface ContextoDeDevolucion {
  /** La CUENTA está en ensayo: `facturaDesde == null` (`enEnsayo()` en
   *  `apps/api/src/fiscal/mode.ts`; en el TPV, `getCachedEnsayo()`). */
  enEnsayo: boolean;
  /** La SESIÓN es del cajero técnico del super-admin: un JWT con
   *  `purpose: "test-cashier"` (`isTestModeActive()` en el TPV). */
  sesionDePrueba: boolean;
}

/** Por qué NO se puede devolver. El TPV lo usa para decir en voz alta lo
 *  que antes callaba escondiendo el botón. */
export type MotivoNoDevolvible =
  | "NO_COBRADO"
  | "YA_ANULADO"
  | "PENDIENTE_DE_SINCRONIZAR"
  | "SINCRONIZACION_FALLIDA"
  | "DE_PRUEBA_FUERA_DE_ENSAYO";

const COBRADOS_DE_VERDAD: ReadonlySet<string> = new Set(["SYNCED", "PAID"]);

/**
 * ¿Es devolvible? La misma función que mira el servidor antes de aceptar
 * el refund y el TPV antes de pintar el botón.
 */
export function esDevolvible(
  status: EstadoDeTicket,
  ctx: ContextoDeDevolucion,
): boolean {
  return motivoNoDevolvible(status, ctx) == null;
}

/** `null` si se puede devolver; si no, por qué no. */
export function motivoNoDevolvible(
  status: EstadoDeTicket,
  ctx: ContextoDeDevolucion,
): MotivoNoDevolvible | null {
  if (COBRADOS_DE_VERDAD.has(status)) return null;
  if (status === "TEST") {
    // Un ticket `TEST` sólo se devuelve donde se emitió: en el ensayo de
    // la cuenta o en la sesión del cajero técnico. Fuera de ahí es un
    // resto de una prueba anterior y devolverlo movería caja de verdad.
    return ctx.enEnsayo || ctx.sesionDePrueba
      ? null
      : "DE_PRUEBA_FUERA_DE_ENSAYO";
  }
  if (status === "VOIDED") return "YA_ANULADO";
  if (status === "PENDING_SYNC") return "PENDIENTE_DE_SINCRONIZAR";
  if (status === "SYNC_FAILED") return "SINCRONIZACION_FALLIDA";
  return "NO_COBRADO";
}

/**
 * Lo que se le dice a un humano. Antes el servidor contestaba siempre
 * «Sólo se puede devolver un ticket cobrado y sincronizado con Holded» —
 * mentira en una cuenta sin Holded, que no sincroniza nada con nadie, y
 * desconcertante en una cuenta en ensayo.
 */
export function mensajeNoDevolvible(motivo: MotivoNoDevolvible): string {
  switch (motivo) {
    case "NO_COBRADO":
      return "Este ticket todavía no está cobrado: no hay nada que devolver.";
    case "YA_ANULADO":
      return "Este ticket ya está anulado.";
    case "PENDIENTE_DE_SINCRONIZAR":
      return "Este ticket se está sincronizando. Espera unos segundos y vuelve a intentarlo.";
    case "SINCRONIZACION_FALLIDA":
      return "Este ticket no se pudo sincronizar. Arregla la sincronización antes de devolverlo.";
    case "DE_PRUEBA_FUERA_DE_ENSAYO":
      return "Este ticket es de una prueba anterior y esta cuenta ya factura: no se devuelve.";
  }
}
