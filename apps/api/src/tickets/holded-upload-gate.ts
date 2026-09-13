// v1.8-Fiado (variante B) · el corazón conmutable.
//
// UN ÚNICO punto de decisión sobre si un ticket se encola a Holded ya o
// no. Lo usan TODOS los caminos que encolan uploads (checkout de venta
// rápida, checkout de mesa, y el saldo de un fiado). Mantenerlo aquí es
// lo que hace que pasar de variante B a variante A sea un cambio de una
// línea (ver docs/design/fiado.md §7 y el done.md).
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
// Sin clave de Holded no hay destino. No se crea la fila y no se encola
// el job: se loguea una línea y se sigue. Es la diferencia entre "ha
// fallado al subir" y "no hay nada que subir".
//
// Esto además es lo que sostiene el forward-only del bloque: si un día
// ese tenant conecta Holded, no queremos que aparezcan documentos
// fiscales con fecha pasada. Al no dejar filas PENDING detrás, no hay
// nada que un sweeper futuro pueda barrer hacia arriba — la decisión
// queda garantizada por la ausencia de datos, no por acordarse.

import { TicketStatus } from "@mipiacetpv/db";

/**
 * ¿Debe encolarse la subida de este ticket a Holded?
 *
 * Dos condiciones, y las dos tienen que cumplirse:
 *
 *  1. El estado no es `ON_CREDIT` (variante B del fiado: un fiado con
 *     deuda viva no sube hasta saldarse; saldado ya está en PAID).
 *  2. El tenant tiene clave de Holded. Sin clave no hay destino.
 *
 * `tenantHasHoldedKey` es OBLIGATORIO a propósito: podría haber sido
 * opcional con default `true` para no tocar las tres llamadas, pero
 * entonces una llamada nueva que se olvidara de pasarlo volvería a
 * encolar contra el vacío en silencio. Que el compilador lo pida es la
 * garantía de que nadie lo olvide.
 */
export function shouldEnqueueHoldedUpload(
  status: TicketStatus,
  tenantHasHoldedKey: boolean,
): boolean {
  if (!tenantHasHoldedKey) return false;
  return status !== TicketStatus.ON_CREDIT;
}

/**
 * Lo mismo para una DEVOLUCIÓN. Un refund no tiene `TicketStatus`, así
 * que la única condición es la clave: sin Holded no hay abono que subir.
 *
 * Vive aquí y no como un `if` suelto en la ruta por lo mismo que su
 * hermana: que exista UN fichero donde esté escrito quién sube a Holded
 * y quién no. El gate del refund de prueba se queda donde está — ése es
 * fiscal y sagrado, y su sitio es la ruta.
 */
export function shouldEnqueueHoldedRefundUpload(tenantHasHoldedKey: boolean): boolean {
  return tenantHasHoldedKey;
}

/**
 * En qué estado nace un ticket que se acaba de cobrar.
 *
 * `PENDING_SYNC` significa literalmente "esperando a subir a Holded". En
 * un comercio sin Holded no hay nada que esperar, y dejarlo ahí tenía
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
 */
export function paidTicketStatus(tenantHasHoldedKey: boolean): TicketStatus {
  return tenantHasHoldedKey ? TicketStatus.PENDING_SYNC : TicketStatus.PAID;
}
