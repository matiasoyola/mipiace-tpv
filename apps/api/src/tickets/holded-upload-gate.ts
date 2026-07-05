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

import { TicketStatus } from "@mipiacetpv/db";

/**
 * ¿Debe encolarse la subida de este ticket a Holded?
 *
 * Variante B: todo se encola EXCEPTO los fiados con deuda viva
 * (ON_CREDIT). Un fiado saldado ya está en PAID → se encola normal.
 */
export function shouldEnqueueHoldedUpload(status: TicketStatus): boolean {
  return status !== TicketStatus.ON_CREDIT;
}
