// auditoria-sirope (#3) · LOS BILLETES SUMAN.
//
// Los atajos de efectivo de la hoja de cobro (5 · 10 · 20 · 50 · 100)
// SUSTITUÍAN el importe: tocar 5 y después 10 dejaba 10. Es una decisión
// de v1.3 («el piloto se confundía al ver 10 + tap 20 = 30») y el 18-10
// se vio por qué no aguanta en una barra: lo que el cliente pone encima
// del mostrador son VARIOS billetes, y el cajero los va tocando según los
// deja. 10 + 5 son 15, no 5.
//
// La regla tiene dos mitades, y la primera es la que salva la decisión
// vieja:
//
//   1. El PRIMER billete sustituye. La hoja llega con el importe exacto
//      puesto (3,00 €): si el primer toque sumara, un billete de 10 sobre
//      una cuenta de 3 daría 13 € entregados y un cambio de 10. Eso es lo
//      que confundía al piloto de v1.3.
//   2. A partir de ahí, SUMAN. Es la entrega que el cajero está
//      componiendo con lo que tiene en la mano.
//
// «C» deja el importe a cero y vuelve a empezar: el siguiente billete
// suma sobre cero, que es él mismo.

/** Redondeo a céntimo: los billetes son enteros, pero el importe de
 *  partida es el total de la cuenta y puede traer decimales. */
function aCentimos(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * El importe de efectivo después de tocar un billete.
 *
 * `yaCompuesto` es «el cajero ya empezó a componer la entrega»: lo
 * enciende el primer billete y lo apaga todo lo que vuelve a poner un
 * importe de la casa — cambiar de método, «Importe exacto», «C» o
 * teclearlo a mano.
 */
export function importeTrasBillete(opts: {
  actual: number;
  billete: number;
  yaCompuesto: boolean;
}): number {
  if (!opts.yaCompuesto) return aCentimos(opts.billete);
  return aCentimos(opts.actual + opts.billete);
}
