// v1.8-Fiado (variante B) · el corazón conmutable.
//
// UN ÚNICO punto de decisión sobre si un ticket se encola a Holded ya o
// no. Lo usan TODOS los caminos que encolan uploads (checkout de venta
// rápida, checkout de mesa, devolución, y el saldo de un fiado).
// Mantenerlo aquí es lo que hace que pasar de variante B a variante A
// sea un cambio de una línea (ver docs/design/fiado.md §7 y el done.md).
//
//   Variante B (actual): un fiado (ON_CREDIT) NO se sube a Holded hasta
//   que se salda. Al saldarse pasa a PAID y ahí sí se encola (create +
//   pay por el total, fecha = día del saldo).
//
//   Variante A (si el asesor la exige): el documento se emite el día de
//   la venta con pago pendiente. Para conmutar, cambiar
//   `shouldEnqueueHoldedUpload` para que devuelva `true` también en
//   ON_CREDIT, y hacer que el worker suba con `skipPay` mientras la
//   deuda siga viva (el pay llegaría al cobrar). NINGÚN otro sitio del
//   código decide esto — es el único gate.
//
// ── catalogo-local · la segunda razón para no encolar ──────────────────
//
// Hasta este bloque el gate decidía SÓLO por estado del ticket, y eso
// dejaba roto al tenant que tiene caja y no tiene Holded — que ya existe
// desde H1, ADR-016 §5 lo llama "caja local". Lo que pasaba: cobraba
// bien, se le creaba la fila `HoldedUpload` PENDING, se encolaba el job,
// y `uploadTicket` lo tumbaba con `no_holded_key` dejando el ticket en
// SYNC_FAILED. Resultado: vendía perfectamente y tenía la bandeja de
// errores del panel encendida con todos sus tickets, para siempre.
//
// Sin destino en Holded no se crea la fila y no se encola el job: se
// loguea una línea y se sigue. Es la diferencia entre "ha fallado al
// subir" y "no hay nada que subir".
//
// Esto además es lo que sostiene el forward-only del bloque: si un día
// ese tenant conecta Holded, no queremos que aparezcan documentos
// fiscales con fecha pasada. Al no dejar filas PENDING detrás, no hay
// nada que un sweeper futuro pueda barrer hacia arriba — la decisión
// queda garantizada por la ausencia de datos, no por acordarse.
//
// ── addendum 3 · por qué el predicado ya no es un booleano ─────────────
//
// La primera versión de este gate preguntaba `tenantHasHoldedKey`, y esa
// señal significa DOS cosas que hay que tratar distinto:
//
//   · "no usa Holded y no lo va a usar"  → correcto por diseño.
//   · "usa Holded y aún no lo ha conectado" → ANOMALÍA: un cliente que
//     compró el ERP está cobrando antes de enchufarlo, y esas ventas no
//     llegarán nunca a su contabilidad.
//
// Las dos HACEN lo mismo (no encolar, nacer PAID) y no SIGNIFICAN lo
// mismo, así que no pueden compartir la línea de log. Por eso el
// predicado es un valor de tres estados y no un `boolean`: el tipo
// obliga a mirar los tres casos, y un `if` con dos ramas no puede
// "olvidarse" del de en medio sin que el compilador lo cante.
//
//   holdedEnabled = false               → NONE              · no encola · PAID
//   holdedEnabled = true, SIN clave aún → NOT_CONNECTED_YET · no encola · PAID
//   holdedEnabled = true, CON clave     → READY             · encola    · PENDING_SYNC
//
// Lo que NO se hace, y por qué: la fila de en medio no se manda a
// PENDING_SYNC. Sería lo intuitivo ("que espere y suba cuando llegue la
// clave"), pero NO HAY SWEEPER que recoja `PENDING_SYNC` — se comprobó
// al escribir este bloque —, así que el ticket se quedaría ahí para
// siempre y arrastraría tres consecuencias visibles para el cliente: no
// se podría devolver (`POST /tickets/:id/refunds` exige `SYNCED` o
// `PAID`), el corte y el Z lo contarían como incidencia pendiente cada
// día, y el cliente cerraría en falso. `PAID` + warning es peor de lo
// ideal y mejor que todo lo demás. Un sweeper que suba lo cobrado antes
// de conectar es un bloque aparte, y tendría que resolver primero la
// pregunta fiscal de las fechas pasadas.

import { TicketStatus } from "@mipiacetpv/db";

/**
 * ¿Hay destino en Holded para lo que se acaba de cobrar, y de qué tipo?
 *
 * - `NONE`: el comercio no usa Holded (`holdedEnabled = false`). No hay
 *   destino y no lo habrá. Correcto por diseño.
 * - `NOT_CONNECTED_YET`: está previsto que lo use pero todavía no lo ha
 *   conectado. Hay destino en el futuro y estas ventas no llegarán a él.
 * - `READY`: previsto y conectado. Comportamiento de siempre.
 */
export type HoldedDestination = "NONE" | "NOT_CONNECTED_YET" | "READY";

/**
 * Traduce las dos columnas del tenant al destino.
 *
 * `holdedEnabled !== false` y no `!holdedEnabled`: la columna es
 * `@default(true)` y sólo un `false` explícito la apaga (mismo criterio
 * que `cajaEnabled` en `lib/caja-gate.ts`). Un tenant leído de una base
 * vieja, o un `select` al que se le olvide la columna, se comporta como
 * el de siempre en vez de dejar de subir en silencio.
 */
export function holdedDestination(tenant: {
  holdedEnabled?: boolean | null;
  holdedApiKeyCiphertext?: string | null;
}): HoldedDestination {
  if (tenant.holdedEnabled === false) return "NONE";
  return tenant.holdedApiKeyCiphertext != null ? "READY" : "NOT_CONNECTED_YET";
}

/**
 * ¿Debe encolarse la subida de este ticket a Holded?
 *
 * Dos condiciones, y las dos tienen que cumplirse:
 *
 *  1. El estado no es `ON_CREDIT` (variante B del fiado: un fiado con
 *     deuda viva no sube hasta saldarse; saldado ya está en PAID).
 *  2. El destino está `READY`. Sin clave conectada no hay a dónde subir,
 *     y sin `holdedEnabled` no lo habrá nunca.
 *
 * `destination` es OBLIGATORIO a propósito: podría haber sido opcional
 * con default `READY` para no tocar las cuatro llamadas, pero entonces
 * una llamada nueva que se olvidara de pasarlo volvería a encolar contra
 * el vacío en silencio. Que el compilador lo pida es la garantía de que
 * nadie lo olvide.
 */
export function shouldEnqueueHoldedUpload(
  status: TicketStatus,
  destination: HoldedDestination,
): boolean {
  if (destination !== "READY") return false;
  return status !== TicketStatus.ON_CREDIT;
}

/**
 * Lo mismo para una DEVOLUCIÓN. Un refund no tiene `TicketStatus`, así
 * que la única condición es el destino: sin Holded no hay abono que
 * subir.
 *
 * Vive aquí y no como un `if` suelto en la ruta por lo mismo que su
 * hermana: que exista UN fichero donde esté escrito quién sube a Holded
 * y quién no. El gate del refund de prueba se queda donde está — ése es
 * fiscal y sagrado, y su sitio es la ruta.
 */
export function shouldEnqueueHoldedRefundUpload(
  destination: HoldedDestination,
): boolean {
  return destination === "READY";
}

/**
 * En qué estado nace un ticket que se acaba de cobrar.
 *
 * `PENDING_SYNC` significa literalmente "esperando a subir a Holded". Si
 * no hay destino conectado no hay nada que esperar, y dejarlo ahí tenía
 * tres consecuencias, todas visibles para el cliente:
 *
 *   1. **No podría devolver nada.** `POST /tickets/:id/refunds` exige
 *      `SYNCED` o `PAID` (`tickets/routes.ts`). Sus tickets no llegarían
 *      nunca a ninguno de los dos.
 *   2. **Cerraría el día en falso.** El corte y el Z cuentan los
 *      `PENDING_SYNC` como incidencias pendientes de sincronizar
 *      (`shift/routes.ts`, `shift/day-cut-run.ts`). Cada día cerraría
 *      con todos sus tickets marcados como pendientes, para siempre.
 *   3. Antes de este bloque acababan en `SYNC_FAILED`, que es peor
 *      todavía: encendía la bandeja de errores del panel.
 *
 * `PAID` ya existe, ya lo aceptan todos esos sitios y significa
 * exactamente lo que pasó: cobrado, y nada pendiente. Es el mismo
 * criterio que `InitialSyncStatus.NOT_APPLICABLE` en ADR-016 §4 — el
 * estado que no aplica se dice en el estado, no con un flag aparte —,
 * sólo que aquí el valor que hacía falta ya estaba inventado.
 *
 * `NONE` y `NOT_CONNECTED_YET` nacen los dos `PAID`. Que hagan lo mismo
 * no los vuelve el mismo caso: se distinguen en el log, no en el estado
 * (ver `logHoldedUploadSkipped`).
 */
export function paidTicketStatus(destination: HoldedDestination): TicketStatus {
  return destination === "READY"
    ? TicketStatus.PENDING_SYNC
    : TicketStatus.PAID;
}

/** Lo mínimo de un logger de Fastify que este módulo necesita. */
export interface HoldedGateLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

/**
 * La línea de log de un cobro que NO se encoló, con el nivel que le
 * corresponde a cada motivo.
 *
 * Vive aquí y no en los handlers a propósito: son CUATRO caminos de
 * cobro (venta rápida, mesa, devolución, saldo de fiado) y si cada uno
 * escribe su `if` a mano, el día que alguien toque el criterio lo
 * cambiará en tres de los cuatro. Que la diferencia info/warning esté en
 * un solo sitio es lo mismo que buscaba el gate entero.
 *
 * - `NONE` → **info**. Correcto por diseño: no hay destino y no lo
 *   habrá. Se loguea igualmente porque el criterio 2 del bloque pide que
 *   se VEA en los logs que no se intenta subir; un silencio sin línea es
 *   indistinguible de un olvido.
 * - `NOT_CONNECTED_YET` → **warning**, con el id del ticket. Un cliente
 *   que compró el ERP está cobrando antes de conectarlo y esas ventas no
 *   llegarán nunca a su contabilidad. Eso no puede pasar en silencio: es
 *   justo lo que el bloque prohíbe en la puerta del §3 ("que falle
 *   ruidosamente, nunca en silencio"). `onboarding-health` lo canta
 *   además en el panel del super-admin, para que no dependa de que
 *   alguien esté mirando los logs ese día.
 * - `READY` → no se llama nunca (si está READY, se encoló). Si llegara,
 *   no se escribe nada: mejor ninguna línea que una que mentiría.
 */
export function logHoldedUploadSkipped(
  log: HoldedGateLogger,
  destination: HoldedDestination,
  fields: { externalId: string; tenantId: string; camino: string },
): void {
  const { camino, ...ids } = fields;
  if (destination === "NONE") {
    log.info(
      { ...ids, camino, motivo: "holded_no_habilitado" },
      `${camino} no encolado a Holded: el comercio no usa Holded`,
    );
    return;
  }
  if (destination === "NOT_CONNECTED_YET") {
    log.warn(
      { ...ids, camino, motivo: "holded_sin_conectar" },
      `${camino} COBRADO ANTES de conectar Holded: no se subirá nunca a su contabilidad`,
    );
  }
}
