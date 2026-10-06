// El desglose de IVA CUADRADO: el que se imprime y el que va al registro
// de facturación, que tienen que ser el mismo número.
//
// Antes de V1-verifactu esto vivía dentro de `buildTicketReceipt`: el
// renderer de ESC/POS repartía el céntimo residual (v1.9.4) para que la
// suma de las líneas impresas diera exactamente el TOTAL. Funcionaba, pero
// era suyo.
//
// Ahora hay un segundo consumidor con un requisito más duro: el campo
// `CuotaTotal` del registro de facturación de la AEAT, que entra en la
// huella. Si la cuota del papel y la del registro difirieran en un céntimo,
// el cliente cotejaría su factura en la sede electrónica y no cuadraría —
// y la huella estaría calculada sobre un importe que nadie imprimió.
//
// Por eso el reparto sale aquí, a un sitio del que tiran los dos.
//
// bloque ticket-con-iva · LA BASE IMPONIBLE TIENE UN ÚNICO VALOR.
//
// Hasta este bloque el céntimo residual se repartía entre el `subtotal`
// Y las cuotas. El comentario de abajo ya decía que «el céntimo se
// reparte donde nace, que es el redondeo de la cuota» — y el código no
// lo cumplía con el subtotal. Resultado en producción (06-10-2026, venta
// de 14,60 € al 10 %): el mismo papel imprimía «IVA 10 % s/13,26 €» y
// «Subtotal 13,27 €». Dos valores para la misma base imponible.
//
// No era sólo fealdad. `generarRegistroDeVenta` (apps/tpv-web/src/lib/
// fiscal.ts) informa `BaseImponibleOimporteNoSujeto` con la base de cada
// tramo y `ImporteTotal` con el total: si el céntimo se iba al subtotal,
// Σ BaseImponible + Σ CuotaRepercutida se separaba del ImporteTotal
// declarado. Es la validación §17 del documento de validaciones de la
// AEAT, y la cumplíamos por los pelos sólo porque admite ±10,00 €.
//
// La regla, ahora: **subtotal impreso = Σ bases de los tramos**, siempre.
// El residuo para que `Σ bases + Σ cuotas === total` se reparte SÓLO
// entre las cuotas, que es donde nace el redondeo. `total` sigue siendo
// entrada autoritativa y no se recalcula.

import { round2 } from "./precios.js";

export interface BucketIva {
  /** Porcentaje: 21, 10, 4, 0. */
  rate: number;
  /** Base imponible del tramo. */
  base: number;
  /** Cuota del tramo, SIN cuadrar. */
  tax: number;
}

export interface DesgloseCuadrado {
  /** Neto que se imprime como «Subtotal». Desde el bloque ticket-con-iva
   *  es, por construcción, Σ `base` de `buckets`: el documento no tiene
   *  dos valores para la base imponible. */
  subtotal: number;
  /** Los mismos tramos, con la cuota ya cuadrada. */
  buckets: BucketIva[];
  /** Σ de las cuotas cuadradas. Es el `CuotaTotal` del registro. */
  cuotaTotal: number;
  /** El total, que es ENTRADA y no se recalcula nunca. */
  total: number;
}

/**
 * Cuadra el desglose contra el total, con la base imponible intacta.
 *
 * Garantiza tres cosas, todas al céntimo:
 *
 *   1. `subtotal === Σ buckets[].base` — la base imponible del documento
 *      tiene UN valor, el mismo en la línea «Subtotal», en cada línea
 *      «IVA X % s/base» y en el `BaseImponibleOimporteNoSujeto` del
 *      registro de facturación.
 *   2. `subtotal + Σ buckets[].tax === total`.
 *   3. `total` entra y sale igual: es autoritativo y no se recalcula.
 *
 * El residuo de redondeo va ENTERO a las cuotas, que es donde nace: la
 * cuota de un tramo es `base × tipo / 100`, un producto que casi nunca
 * cae en un número exacto de céntimos. La base, en cambio, es una suma
 * de importes de línea — no hay nada que redondear en ella, y moverla
 * cambiaría lo que la factura dice de la operación.
 *
 * Desplazar un céntimo en la cuota está dentro de lo que admite la AEAT:
 * la validación §15.7 del documento de validaciones VERI*FACTU exige
 * `[CuotaRepercutida] = ([BaseImponibleOimporteNoSujeto] × TipoImpositivo)
 * / 100 +/- 10,00 euros`. Ver `docs/blocks/ticket-con-iva-done.md`.
 */
export function cuadrarDesglose(input: {
  /** El neto que calculó el caller agregando líneas. Se usa SÓLO cuando
   *  no hay tramos (un documento sin líneas no tiene base imponible que
   *  sumar). Con tramos, el subtotal sale de las bases — pasar aquí otro
   *  número no lo cambia, y es a propósito: dos fuentes para la base
   *  imponible es exactamente el bug que este bloque cierra. */
  subtotal: number;
  buckets: BucketIva[];
  total: number;
}): DesgloseCuadrado {
  if (input.buckets.length === 0) {
    return {
      subtotal: input.subtotal,
      buckets: [],
      cuotaTotal: 0,
      total: input.total,
    };
  }
  // Las bases, al céntimo. Los callers ya las pasan redondeadas
  // (`buildTicketDocument`, `computeCartTaxBuckets`); redondear aquí
  // otra vez es gratis y hace que la invariante se cumpla incluso si
  // mañana alguien pasa el neto crudo del bucket.
  const bases = input.buckets.map((b) => round2(b.base));
  const subtotal = round2(bases.reduce((acc, b) => acc + b, 0));
  // Lo que les queda a las cuotas para que el papel sume el total.
  const objetivoCuotas = Math.round(input.total * 100) - Math.round(subtotal * 100);
  const cuotas = repartirCuotas(
    input.buckets.map((b) => b.tax),
    objetivoCuotas,
  );
  const buckets = input.buckets.map((b, i) => ({
    rate: b.rate,
    base: bases[i]!,
    tax: cuotas[i]!,
  }));
  return {
    subtotal,
    buckets,
    // Σ de las cuotas repartidas, que por construcción es `objetivoCuotas`.
    // Se vuelve a sumar en vez de devolver el objetivo para que, si alguien
    // toca el reparto, el `CuotaTotal` del registro siga siendo la suma de
    // las cuotas que imprime el papel y no un número paralelo.
    cuotaTotal: round2(buckets.reduce((acc, b) => acc + b.tax, 0)),
    total: input.total,
  };
}

/**
 * Reparte `objetivoCentimos` entre las cuotas de los tramos por el método
 * del resto mayor (Hamilton), de forma que la suma dé el objetivo EXACTO.
 *
 * No se reutiliza `allocateRoundingRemainder` (v1.9.4) y la razón es su
 * límite: ésa ajusta como mucho un céntimo por componente, que es todo lo
 * que hacía falta cuando repartía entre el subtotal y las cuotas de un
 * desglose recién calculado. Aquí el desajuste puede ser de varios
 * céntimos con un tramo solo donde colocarlos.
 *
 * De dónde salen esos céntimos: la base de un tramo es la suma de los
 * importes de línea YA REDONDEADOS al céntimo (`TicketLine.subtotal`,
 * que es lo que se persiste y lo que el ticket desglosa), mientras que el
 * total viene de agregar los netos CRUDOS de cuatro decimales y redondear
 * una sola vez al final (`computeTicket`, b30 — es el esquema que
 * reproduce la aritmética de Holded). Las dos cosas son correctas y en un
 * ticket de quince líneas pueden separarse media docena de céntimos.
 *
 * Ese desajuste tiene que caer en algún sitio, y cae en la cuota: es el
 * único de los tres números —base, cuota, total— que no es ni lo que se
 * vendió ni lo que se cobró, sino un producto calculado. Sigue estando a
 * tres órdenes de magnitud de la tolerancia que admite la AEAT (±10,00 €
 * en §15.7); el barrido de `apps/api/test/ticket-con-iva.test.ts` fija el
 * máximo que se ha observado.
 */
function repartirCuotas(
  cuotasCrudas: number[],
  objetivoCentimos: number,
): number[] {
  const parts = cuotasCrudas.map((t) => {
    const crudo = t * 100;
    // `floor` con epsilon para absorber el error binario (ej. 20 llega como
    // 19.999999 y no debe caer a 19), igual que en `rounding.ts`.
    const suelo = Math.floor(crudo + 1e-6);
    return { cents: suelo, resto: Math.max(0, crudo - suelo) };
  });
  const n = parts.length;
  let diff = objetivoCentimos - parts.reduce((acc, p) => acc + p.cents, 0);
  if (diff !== 0) {
    // Primero el reparto plano, para que ningún tramo cargue con el
    // desajuste de los demás.
    const plano = Math.trunc(diff / n);
    if (plano !== 0) {
      for (const p of parts) p.cents += plano;
      diff -= plano * n;
    }
    // Y lo que queda (|diff| < n) al de mayor resto decimal; empate, al de
    // mayor importe. Simétrico cuando sobran céntimos.
    const orden = [...parts].sort((a, b) =>
      diff > 0
        ? b.resto - a.resto || b.cents - a.cents
        : a.resto - b.resto || a.cents - b.cents,
    );
    for (let i = 0; i < Math.abs(diff); i++) {
      orden[i]!.cents += diff > 0 ? 1 : -1;
    }
  }
  return parts.map((p) => p.cents / 100);
}
