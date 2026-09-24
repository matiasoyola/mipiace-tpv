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

import { allocateRoundingRemainder } from "./rounding.js";

export interface BucketIva {
  /** Porcentaje: 21, 10, 4, 0. */
  rate: number;
  /** Base imponible del tramo. */
  base: number;
  /** Cuota del tramo, SIN cuadrar. */
  tax: number;
}

export interface DesgloseCuadrado {
  /** Neto que se imprime como «Subtotal». */
  subtotal: number;
  /** Los mismos tramos, con la cuota ya cuadrada. */
  buckets: BucketIva[];
  /** Σ de las cuotas cuadradas. Es el `CuotaTotal` del registro. */
  cuotaTotal: number;
  /** El total, que es ENTRADA y no se recalcula nunca. */
  total: number;
}

/**
 * Reparte el céntimo residual entre el subtotal y las cuotas, de forma que
 * `subtotal + Σ cuotas === total` exactamente.
 *
 * `total` es autoritativo: entra y sale igual. Lo que se ajusta es el
 * desglose, que es lo que se redondeó por tramos.
 */
export function cuadrarDesglose(input: {
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
  const repartido = allocateRoundingRemainder(
    [
      { key: "subtotal", amount: input.subtotal },
      ...input.buckets.map((b, i) => ({ key: `tax:${i}`, amount: b.tax })),
    ],
    input.total,
  );
  const porClave = new Map(repartido.map((p) => [p.key, p.amount]));
  const buckets = input.buckets.map((b, i) => ({
    rate: b.rate,
    // La BASE no se toca: es lo que se vendió a ese tipo, y cuadrarla
    // cambiaría lo que dice la factura de la operación. El céntimo se
    // reparte donde nace, que es el redondeo de la cuota.
    base: b.base,
    tax: porClave.get(`tax:${i}`) ?? b.tax,
  }));
  return {
    subtotal: porClave.get("subtotal") ?? input.subtotal,
    buckets,
    cuotaTotal:
      Math.round(buckets.reduce((acc, b) => acc + b.tax, 0) * 100) / 100,
    total: input.total,
  };
}
