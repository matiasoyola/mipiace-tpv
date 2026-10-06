// bloque ticket-con-iva · la conversión neto→bruto, en UN solo sitio.
//
// El modelo de datos guarda NETO con 4 decimales (`Decimal(12,4)`, ver
// `totals.ts` de la API y el comentario de b30): es lo que Holded
// factura y lo que permite que el total del TPV y el de Holded coincidan
// al céntimo. Pero el precio que el cliente conoce es el BRUTO — el de
// la carta del bar, el de la etiqueta del estante — y es el que tiene
// que leerse en el ticket.
//
// La fórmula vivía repetida: `netToGross` en `apps/tpv-web/src/lib/cart.ts`
// (capa de entrada del cajero, v1.6-Precio-Sobre-Total) y, desde este
// bloque, la necesitan también el papel ESC/POS y el PDF. Tres copias de
// un redondeo es el mismo error que teníamos con el desglose: tarde o
// temprano una se mueve y el papel deja de decir lo que dice la pantalla.

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Bruto (IVA incluido) a partir del neto, redondeado al céntimo.
 *
 * Es el importe que ve el cajero al teclear un precio sobre total
 * (v1.6-Precio-Sobre-Total) y el que se imprime como unitario en el
 * ticket desde el bloque ticket-con-iva. `grossToNet`, aquí abajo,
 * garantiza el round-trip contra esta función: para un bruto tecleado
 * por el cajero, `netToGross(grossToNet(g, r), r) === round2(g)`.
 */
export function netToGross(net: number, taxRate: number): number {
  return round2(net * (1 + taxRate / 100));
}

/**
 * Neto (4 decimales, la precisión de `Decimal(12,4)` de b30) a partir del
 * bruto. Garantiza el round-trip contra `netToGross`: para cualquier bruto
 * de los tipos españoles reales, `netToGross(grossToNet(g, r), r)` vuelve a
 * ser `round2(g)`.
 *
 * 4 decimales bastan siempre (el error de redondear el neto es < 0,00006 €
 * en bruto, muy lejos del medio céntimo), pero se deja una corrección
 * defensiva de ±0,0001 por si el punto flotante desvía el borde.
 *
 * Es el camino de entrada del precio: el cajero teclea el bruto
 * (v1.6-Precio-Sobre-Total) o el propietario da de alta el producto con su
 * precio de carta, y lo que se persiste es este neto.
 */
export function grossToNet(gross: number, taxRate: number): number {
  const factor = 1 + taxRate / 100;
  const target = round2(gross);
  let net = Math.round((target / factor) * 10000) / 10000;
  if (netToGross(net, taxRate) !== target) {
    for (const delta of [0.0001, -0.0001, 0.0002, -0.0002]) {
      const cand = Math.round((net + delta) * 10000) / 10000;
      if (netToGross(cand, taxRate) === target) {
        net = cand;
        break;
      }
    }
  }
  return net;
}
