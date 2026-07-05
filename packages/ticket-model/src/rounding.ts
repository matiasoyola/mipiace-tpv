// v1.9.4 · Cuadre al céntimo del desglose IVA impreso.
//
// Contexto del bug (Sirope, ticket #000005): las líneas del desglose
// ("IVA X% s/base" + "Subtotal") se redondean cada una por separado a 2
// decimales, mientras que el TOTAL del ticket lo calcula `computeTicket`
// (totals.ts) agregando netos por bucket y redondeando UNA vez. Ambos
// son correctos, pero la SUMA de las líneas impresas puede diferir del
// TOTAL en ±0,01 (raramente ±0,02). El cliente que suma el papel a mano
// ve un céntimo bailando.
//
// Solución (método del resto mayor / largest remainder, a.k.a. Hamilton):
// repartimos ese ±céntimo residual entre los componentes del desglose
// (subtotal + cada IVA) de forma que la suma de los importes IMPRESOS
// coincida exactamente con el TOTAL, que es ENTRADA y nunca se recalcula
// aquí. El céntimo se asigna al componente con mayor resto decimal;
// empate → al de mayor importe.
//
// Puro, sin dependencias: se importa tanto desde apps/api (worker email,
// endpoint print) como desde apps/tpv-web (descarga PDF en el browser).

export interface RoundingComponent {
  // Clave estable para que el renderer mapee el resultado de vuelta a su
  // línea ("subtotal", "tax:0", "tax:1"...). No se imprime.
  key: string;
  // Importe SIN redondear (en la divisa, no en céntimos). Para el IVA es
  // `base * rate / 100`; para el subtotal, el neto. El resto decimal de
  // este valor decide quién se lleva el céntimo residual.
  amount: number;
}

export interface AllocatedComponent {
  key: string;
  // Importe redondeado a 2 decimales, listo para imprimir. La suma de
  // todos los `amount` devueltos == `total` exacto.
  amount: number;
}

// Reparte el residuo de redondeo para que Σ importes impresos == total.
//
// `components`: importes sin redondear (subtotal + IVAs).
// `total`: total del ticket ya redondeado (autoritativo, no se toca).
//
// Devuelve los importes a imprimir en el mismo orden de entrada. Si
// `components` está vacío devuelve []. El total NUNCA se recalcula: sólo
// se usa como objetivo del cuadre.
export function allocateRoundingRemainder(
  components: RoundingComponent[],
  total: number,
): AllocatedComponent[] {
  if (components.length === 0) return [];

  const target = Math.round(total * 100);

  // Trabajamos en céntimos enteros. `floor` con epsilon para absorber el
  // error binario (ej. 20 llega como 19.999999 y no debe caer a 19).
  const parts = components.map((c) => {
    const rawCents = c.amount * 100;
    const floor = Math.floor(rawCents + 1e-6);
    const remainder = Math.max(0, rawCents - floor);
    return { key: c.key, amount: c.amount, cents: floor, remainder };
  });

  const sumFloor = parts.reduce((acc, p) => acc + p.cents, 0);
  let diff = target - sumFloor;

  if (diff > 0) {
    // Faltan céntimos: se los llevan los de mayor resto decimal (empate
    // → mayor importe). Estos son justo los que "querían" redondear hacia
    // arriba, así que el resultado coincide con el redondeo natural salvo
    // en el céntimo de frontera.
    const order = [...parts].sort(
      (a, b) => b.remainder - a.remainder || b.amount - a.amount,
    );
    for (let i = 0; i < diff && i < order.length; i++) {
      order[i]!.cents += 1;
    }
  } else if (diff < 0) {
    // Sobran céntimos: se los quitamos a los de menor resto decimal
    // (empate → menor importe), simétrico al caso anterior.
    const need = -diff;
    const order = [...parts].sort(
      (a, b) => a.remainder - b.remainder || a.amount - b.amount,
    );
    for (let i = 0; i < need && i < order.length; i++) {
      order[i]!.cents -= 1;
    }
  }

  return parts.map((p) => ({ key: p.key, amount: p.cents / 100 }));
}
