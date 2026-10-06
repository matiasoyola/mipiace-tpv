// bloque ticket-con-iva · los totales de línea que se IMPRIMEN.
//
// El ticket del bar tiene que leerse como la carta: si el café con leche
// cuesta 1,60 €, la línea dice «1 x 1,60 € ... 1,60 €». Hasta este bloque
// el unitario salía en NETO (1,45 €) porque es lo que guarda el modelo
// (`Decimal(12,4)`, b30) y el total de la línea en BRUTO — el cliente del
// Bar La Maestranza no podía cuadrar su ticket.
//
// Pasar todo a bruto abre un problema de suma que el mundo neto no tenía:
// el total del ticket NO es Σ de los brutos de línea. `computeTicket`
// (apps/api/src/tickets/totals.ts) agrega los netos crudos por tramo de
// IVA y redondea UNA vez al final — esquema fiscal correcto y el que
// reproduce Holded. El bruto de cada línea, en cambio, se redondea por
// línea. Las dos cosas son correctas y pueden diferir en ±0,01 (con
// muchas líneas, ±0,02).
//
// Y un ticket en el que la columna de la derecha no suma el TOTAL es un
// ticket roto, dé igual lo buena que sea la aritmética fiscal que hay
// detrás. Así que se cuadra, con el mismo método del resto mayor que
// cuadra el desglose (`allocateRoundingRemainder`, v1.9.4) y contra el
// mismo objetivo: el TOTAL, que es autoritativo y no se recalcula nunca.
//
// Qué NO se cuadra, y por qué: el unitario. `units x unitario` no tiene
// por qué dar el total de la línea en cuanto hay más de una unidad o un
// descuento — es aritmética de dos decimales sobre un neto de cuatro, y
// forzarla mentiría sobre el precio de la carta, que es el dato que el
// cliente reconoce. Lo que tiene que sumar es la columna de totales.

import { round2 } from "./precios.js";
import { allocateRoundingRemainder } from "./rounding.js";

/**
 * Los totales de línea CON IVA, ajustados para que Σ === `total`.
 *
 * Devuelve un array del mismo largo y en el mismo orden. El céntimo
 * residual se lo lleva la línea con mayor resto decimal; a igualdad de
 * resto (el caso normal, porque los importes llegan ya redondeados al
 * céntimo), la línea de mayor importe — donde menos se nota.
 *
 * Con una sola línea el resultado es `[total]`: una línea que no sume el
 * total del ticket no tiene ninguna lectura honesta.
 *
 * LÍMITE, y es deliberado: el ajuste es de como mucho UN CÉNTIMO POR
 * LÍNEA. Eso es todo lo que el redondeo por línea puede producir —el
 * error de redondear un importe a dos decimales es < 0,005 €— así que un
 * desajuste mayor no viene del redondeo: viene de que los importes de
 * línea y el total no son de la misma venta. Repartir ahí un euro entre
 * las líneas no arreglaría nada y sí falsearía los importes. En ese caso
 * se imprimen los importes tal como llegan, redondeados al céntimo, y la
 * columna no suma — que es la verdad de lo que hay en los datos.
 */
export function cuadrarLineasImpresas(
  totalesDeLinea: number[],
  total: number,
): number[] {
  if (totalesDeLinea.length === 0) return [];
  const enCentimos = totalesDeLinea.map((n) => Math.round(n * 100));
  const desajuste =
    Math.round(total * 100) - enCentimos.reduce((acc, c) => acc + c, 0);
  if (Math.abs(desajuste) > totalesDeLinea.length) {
    return totalesDeLinea.map((n) => round2(n));
  }
  const repartido = allocateRoundingRemainder(
    totalesDeLinea.map((amount, i) => ({ key: String(i), amount })),
    total,
  );
  return repartido.map((p) => p.amount);
}
