// B-reservas-8 · EL CANJE en caja: marcar una línea, desmarcarla y
// consumir al cobrar.
//
// ── El importe de la línea, que es el frente P5 ────────────────────────
//
// `LINEA_CERO` (el default) deja la línea del servicio a **0 €**: la
// clienta ya pagó al comprar el bono, así que aquí no entra dinero. La
// alternativa `PRORRATEO` hace que la línea DECLARE lo que vale una sesión
// (`valor_carta / sesiones`), que es lo que haría falta si la asesoría dice
// que el IVA se devenga al canjear y no al vender.
//
// **Lo que este bloque NO decide**: con `PRORRATEO`, el ticket de canje
// tiene un total distinto de cero y alguien tiene que decir cómo se liquida
// (no con el método `VOUCHER`, que queda para los cheques por importe de
// B-cheques: una sesión no es un pago, es una línea). Esa pregunta es parte
// de P5 y está escrita como pregunta en el ADR. Por eso `PRORRATEO` existe
// y tiene test, pero no es el default — y por eso `bonosEnabled` no se
// enciende en ninguna cuenta real hasta que P5 esté contestado.
//
// ── Por qué 0 € y no un descuento del 100 % ────────────────────────────
//
// Porque no es un descuento. Un `discountPct = 100` entraría en
// `totalDiscount`, en la línea «Descuentos» del cierre y en el umbral que
// pide PIN de encargado (`discountThresholdPct`): cobrar tres sesiones de
// bono en un ticket haría saltar la autorización del encargado por un
// descuento que nadie ha dado. El bono se ve en la línea porque la línea
// dice con qué bono se paga (`ticket_lines.voucher_id`), no porque su
// precio esté rebajado.

/** Los dos modos del frente P5. Texto y no enum, igual que en la base. */
export type ModoCanje = "LINEA_CERO" | "PRORRATEO";

/**
 * Lo que vale la línea del servicio al consumir una sesión, en céntimos.
 *
 * Función pura y con test por los dos lados: es LA pieza parametrizada del
 * frente P5 y tiene que poder cambiarse con un ajuste, no con un despliegue.
 *
 * El prorrateo se redondea al céntimo con `Math.round`, y el redondeo se
 * reparte: la última sesión de un bono de 3 sesiones a 100 € (33,33 + 33,33
 * + 33,33 = 99,99) deja un céntimo sin declarar. Queda dicho: cuál de las
 * dos cifras es la correcta es exactamente lo que P5 tiene que contestar, y
 * repartir el céntimo antes de saberlo sería inventarse la respuesta.
 */
export function importeDeLaLineaCents(
  modo: ModoCanje,
  bono: { valorCartaCents: number; sesionesTotal: number },
): number {
  if (modo === "LINEA_CERO") return 0;
  if (bono.sesionesTotal <= 0) return 0;
  return Math.round(bono.valorCartaCents / bono.sesionesTotal);
}
