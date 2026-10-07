// bloque iva-exento-sanitario · el tramo (tasa, causa) y el cuadre.
//
// Lo que se fija aquí es la aritmética, con el barrido que el bloque
// ticket-con-iva dejó montado como patrón: invariantes sobre mil tickets
// generados con un LCG determinista, no sobre tres ejemplos elegidos.
//
// Las cuatro invariantes de ticket-con-iva siguen valiendo —son la regla
// de la base única, que este bloque no puede romper— y hay dos más:
//
//   5. Un tramo exento tiene cuota 0 SIEMPRE, y nunca recibe céntimos de
//      reparto.
//   6. El importe declarado de un tramo exento es, al céntimo, la suma de
//      los importes de sus líneas.

import { describe, expect, it } from "vitest";

import { cuadrarDesglose, type BucketIva } from "../src/desglose.js";
import {
  admitidaEnRegimenGeneral,
  CAUSAS_EXENCION,
  CAUSAS_REGIMEN_GENERAL,
  claveTramo,
  compararTramos,
  DESCRIPCION_L10,
  esCausaExencion,
  leerClaveTramo,
  leyendaExencion,
  PRESENTACION,
} from "../src/exencion.js";
import { round2 } from "../src/precios.js";

describe("iva-exento-sanitario · la lista L10", () => {
  it("son los seis códigos del IVA, con su descripción literal", () => {
    // Literal del diseño de registro (`DsRegistroVeriFactu.xlsx`, hoja
    // `6)Listas`). Si alguien los reescribe «mejor», el registro deja de
    // poder cotejarse contra la fuente.
    expect(CAUSAS_EXENCION).toEqual(["E1", "E2", "E3", "E4", "E5", "E6"]);
    expect(DESCRIPCION_L10.E1).toBe("Exenta por el artículo 20");
    expect(DESCRIPCION_L10.E2).toBe("Exenta por el artículo 21");
    expect(DESCRIPCION_L10.E3).toBe("Exenta por el artículo 22");
    expect(DESCRIPCION_L10.E4).toBe("Exenta por los artículos 23 y 24");
    expect(DESCRIPCION_L10.E5).toBe("Exenta por el artículo 25");
    expect(DESCRIPCION_L10.E6).toBe("Exenta por otros");
  });

  it("y E7/E8 NO están: son del IGIC y este SIF no emite IGIC", () => {
    // Validaciones §15.5: «Si Impuesto = "03" (IGIC), el valor de
    // OperacionExenta deberá estar contenido en lista L10 y adicionalmente
    // podrá contener los valores "E7" y "E8"». `Impuesto` es siempre "01".
    expect(esCausaExencion("E7")).toBe(false);
    expect(esCausaExencion("E8")).toBe(false);
  });

  it("el régimen general admite cuatro, no seis (§15.5)", () => {
    expect(CAUSAS_REGIMEN_GENERAL).toEqual(["E1", "E4", "E5", "E6"]);
    expect(admitidaEnRegimenGeneral("E2")).toBe(false);
    expect(admitidaEnRegimenGeneral("E3")).toBe(false);
  });

  it("E1 se presenta como la exención sanitaria", () => {
    expect(PRESENTACION.E1.etiqueta).toBe("Exento · sanitario");
    expect(PRESENTACION.E1.referencia).toBe("art. 20.Uno.3º Ley 37/1992");
  });

  it("y `esCausaExencion` no se come un string parecido", () => {
    for (const malo of ["", "e1", "E", "E10", "S1", null, undefined, 1]) {
      expect(esCausaExencion(malo), String(malo)).toBe(false);
    }
  });
});

describe("iva-exento-sanitario · la clave del tramo", () => {
  it("el 0 % sujeto y el exento son claves DISTINTAS", () => {
    expect(claveTramo(0, null)).not.toBe(claveTramo(0, "E1"));
  });

  it("y el viaje de ida y vuelta es exacto", () => {
    for (const rate of [0, 4, 10, 21, 7.5]) {
      for (const causa of [null, "E1", "E6"] as const) {
        expect(leerClaveTramo(claveTramo(rate, causa))).toEqual({
          rate,
          causa,
        });
      }
    }
  });

  it("un código DESCONOCIDO sigue separando su tramo", () => {
    // Deliberado: la clave es de agrupación, no de declaración. Agrupar un
    // código no reconocido como sujeto sería meter una operación exenta en
    // un tramo al 21 %, que es el fallo que la clave compuesta evita.
    expect(claveTramo(0, "E9")).not.toBe(claveTramo(0, null));
    // Y al leerla, un código fuera de L10 se devuelve como «sin causa»:
    // quien declara valida aparte.
    expect(leerClaveTramo(claveTramo(0, "E9")).causa).toBeNull();
  });

  it("los exentos se imprimen PRIMERO (el orden del mockup)", () => {
    const tramos = [
      { rate: 21 },
      { rate: 0, exemptionCause: "E1" as const },
      { rate: 10 },
      { rate: 0 },
    ];
    expect([...tramos].sort(compararTramos)).toEqual([
      { rate: 0, exemptionCause: "E1" },
      { rate: 0 },
      { rate: 10 },
      { rate: 21 },
    ]);
  });
});

describe("iva-exento-sanitario · la leyenda", () => {
  const quiro = { description: "Quiropodia", exemptionCause: "E1" as const };
  const vendaje = { description: "Vendaje", exemptionCause: "E1" as const };
  const crema = { description: "Crema urea 20%" };

  it("sin línea exenta no hay leyenda", () => {
    expect(leyendaExencion([crema])).toBeNull();
    expect(leyendaExencion([])).toBeNull();
  });

  it("todo exento: «Operación exenta de IVA», sin sujeto", () => {
    expect(leyendaExencion([quiro])).toEqual({
      titulo: "Operación exenta de IVA",
      referencia: "art. 20.Uno.3º Ley 37/1992",
    });
    // También con DOS líneas exentas y ninguna sujeta: lo está la factura
    // entera, así que no hace falta decir qué lo está.
    expect(leyendaExencion([quiro, vendaje])?.titulo).toBe(
      "Operación exenta de IVA",
    );
  });

  it("mixta con UNA exenta: el nombre de la línea delante", () => {
    expect(leyendaExencion([quiro, crema])?.titulo).toBe(
      "Quiropodia: operación exenta de IVA",
    );
  });

  it("mixta con VARIAS: el plural de la causa", () => {
    expect(leyendaExencion([quiro, vendaje, crema])?.titulo).toBe(
      "Servicios sanitarios: operación exenta de IVA",
    );
  });

  it("con dos causas distintas se citan las dos referencias", () => {
    // Hoy inalcanzable (sólo E1 sale del catálogo), y el día que no lo
    // sea, lo que no se puede es citar un precepto que no ampara media
    // factura.
    const l = leyendaExencion([
      quiro,
      { description: "Entrega intracomunitaria", exemptionCause: "E5" },
      crema,
    ])!;
    expect(l.titulo).toBe("Operaciones exentas: operación exenta de IVA");
    expect(l.referencia).toBe("art. 20.Uno.3º Ley 37/1992 · art. 25 Ley 37/1992");
  });
});

describe("iva-exento-sanitario · el cuadre con tramos exentos", () => {
  it("el tramo exento tiene cuota 0 y el residuo va a las cuotas sujetas", () => {
    const c = cuadrarDesglose({
      subtotal: 0,
      buckets: [
        { rate: 0, base: 35, tax: 0, exemptionCause: "E1" },
        { rate: 21, base: 9.92, tax: 2.0832 },
      ],
      total: 47,
    });
    expect(c.buckets[0]).toEqual({
      rate: 0,
      base: 35,
      tax: 0,
      exemptionCause: "E1",
    });
    expect(c.buckets[1]).toEqual({ rate: 21, base: 9.92, tax: 2.08 });
    expect(c.subtotal).toBe(44.92);
    expect(c.cuotaTotal).toBe(2.08);
  });

  it("y el residuo cae en la cuota sujeta aunque sea de varios céntimos", () => {
    // Un tramo exento y uno sujeto cuya cuota cruda no cuadra con el
    // total: el desajuste tiene que irse ENTERO a la cuota.
    const c = cuadrarDesglose({
      subtotal: 0,
      buckets: [
        { rate: 0, base: 35, tax: 0, exemptionCause: "E1" },
        { rate: 10, base: 20, tax: 1.9 },
      ],
      total: 57.05,
    });
    expect(c.buckets[0]!.tax).toBe(0);
    expect(c.buckets[0]!.base).toBe(35);
    expect(c.buckets[1]!.tax).toBe(2.05);
    expect(round2(c.subtotal + c.cuotaTotal)).toBe(57.05);
  });

  it("SIN tramo sujeto el residuo cae en el IMPORTE exento, y tiene que caer", () => {
    // No hay ninguna cuota donde ponerlo, y en una factura íntegramente
    // exenta `ImporteTotal = Σ BaseImponibleOimporteNoSujeto` (§17) sin
    // margen que gastar: el importe declarado TIENE que ser el cobrado.
    // Un céntimo entre lo que pagó la paciente y lo que se declara no es
    // un redondeo, es una factura que no cuadra consigo misma.
    const c = cuadrarDesglose({
      subtotal: 0,
      buckets: [
        { rate: 0, base: 11.11, tax: 0, exemptionCause: "E1" },
        { rate: 0, base: 11.11, tax: 0, exemptionCause: "E1" },
        { rate: 0, base: 11.11, tax: 0, exemptionCause: "E1" },
      ],
      total: 33.34,
    });
    expect(c.cuotaTotal).toBe(0);
    expect(c.subtotal).toBe(33.34);
    expect(round2(c.buckets.reduce((a, b) => a + b.base, 0))).toBe(33.34);
    // Y todas las cuotas siguen siendo 0: el residuo NO se ha colado como
    // cuota de un tramo exento.
    expect(c.buckets.every((b) => b.tax === 0)).toBe(true);
  });

  it("un 0 % sujeto y un exento se mantienen como DOS tramos al cuadrar", () => {
    const c = cuadrarDesglose({
      subtotal: 0,
      buckets: [
        { rate: 0, base: 3, tax: 0 },
        { rate: 0, base: 35, tax: 0, exemptionCause: "E1" },
      ],
      total: 38,
    });
    expect(c.buckets).toHaveLength(2);
    expect(c.buckets[0]!.exemptionCause).toBe("E1");
    expect(c.buckets[1]!.exemptionCause).toBeUndefined();
  });
});

// ── El barrido ─────────────────────────────────────────────────────────

/** LCG determinista y calentado, el mismo patrón que
 *  `apps/api/test/ticket-con-iva.test.ts`: un barrido que falla una vez
 *  cada cien ejecuciones no es una red de seguridad, es una lotería. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  for (let i = 0; i < 50; i += 1) next();
  return next;
}

interface TicketSintetico {
  buckets: BucketIva[];
  total: number;
  hayExento: boolean;
  haySujeto: boolean;
  importeExento: number;
}

/** Mil tickets con tramos exentos y sujetos mezclados, con el total
 *  calculado como lo calcula `computeTicket` —agregando por tramo y
 *  redondeando una sola vez— para que el residuo exista de verdad. */
function barrido(n: number): TicketSintetico[] {
  const rnd = lcg(20261007);
  const out: TicketSintetico[] = [];
  for (let i = 0; i < n; i += 1) {
    const nLineas = 1 + Math.floor(rnd() * 8);
    const netoPorTramo = new Map<string, number>();
    for (let j = 0; j < nLineas; j += 1) {
      // Un tercio de las líneas son exentas.
      const exenta = rnd() < 0.34;
      const rate = exenta ? 0 : [0, 4, 10, 21][Math.floor(rnd() * 4)]!;
      const causa = exenta ? "E1" : null;
      const units = 1 + Math.floor(rnd() * 4);
      // Precio que paga el paciente, de 0,50 a 40,00 en pasos de 5 cts.
      const bruto = 0.5 + Math.floor(rnd() * 790) * 0.05;
      const neto = bruto / (1 + rate / 100);
      const descuento = [0, 0, 0, 5, 15, 33][Math.floor(rnd() * 6)]!;
      const netoLinea = neto * (1 - descuento / 100) * units;
      const clave = claveTramo(rate, causa);
      netoPorTramo.set(clave, (netoPorTramo.get(clave) ?? 0) + netoLinea);
    }
    let totalCrudo = 0;
    const buckets: BucketIva[] = [];
    let importeExento = 0;
    for (const [clave, neto] of netoPorTramo) {
      const { rate, causa } = leerClaveTramo(clave);
      const cuota = causa ? 0 : neto * (rate / 100);
      totalCrudo += neto + cuota;
      buckets.push({
        rate,
        base: round2(neto),
        tax: round2(cuota),
        ...(causa ? { exemptionCause: causa } : {}),
      });
      if (causa) importeExento += round2(neto);
    }
    out.push({
      buckets,
      total: round2(totalCrudo),
      hayExento: buckets.some((b) => b.exemptionCause),
      haySujeto: buckets.some((b) => !b.exemptionCause),
      importeExento: round2(importeExento),
    });
  }
  return out;
}

describe("iva-exento-sanitario · barrido de 1.000 tickets", () => {
  const tickets = barrido(1000);

  it("el barrido es VARIADO de verdad", () => {
    // Sin esto el barrido pasaría con cualquier implementación. Es la
    // misma guardia que ticket-con-iva puso sobre el suyo.
    expect(tickets.filter((t) => t.hayExento).length).toBeGreaterThan(600);
    expect(tickets.filter((t) => t.hayExento && t.haySujeto).length).toBeGreaterThan(400);
    expect(tickets.filter((t) => t.hayExento && !t.haySujeto).length).toBeGreaterThan(30);
    // Y en bastantes el céntimo residual EXISTE: Σ bases + Σ cuotas crudas
    // no cuadra con el total.
    const conResiduo = tickets.filter((t) => {
      const bases = t.buckets.reduce((a, b) => a + Math.round(b.base * 100), 0);
      const cuotas = t.buckets.reduce((a, b) => a + Math.round(b.tax * 100), 0);
      return Math.round(t.total * 100) !== bases + cuotas;
    });
    expect(conResiduo.length).toBeGreaterThan(100);
  });

  it("las SEIS invariantes se cumplen en los 1.000", () => {
    for (const [i, t] of tickets.entries()) {
      const c = cuadrarDesglose({
        subtotal: 0,
        buckets: t.buckets,
        total: t.total,
      });
      const sumaBases = round2(c.buckets.reduce((a, b) => a + b.base, 0));
      // 1 · la base imponible del documento tiene UN valor.
      expect(c.subtotal, `#${i} subtotal === Σ bases`).toBe(sumaBases);
      // 2 · el papel suma el total.
      expect(round2(c.subtotal + c.cuotaTotal), `#${i} §17`).toBe(t.total);
      // 3 · el total entra y sale igual.
      expect(c.total, `#${i} total autoritativo`).toBe(t.total);
      // 4 · §15.7 en los tramos SUJETOS.
      for (const b of c.buckets.filter((x) => x.exemptionCause == null)) {
        const esperada = (b.base * b.rate) / 100;
        expect(Math.abs(b.tax - esperada), `#${i} §15.7`).toBeLessThan(10);
      }
      // 5 · un tramo exento tiene cuota 0 SIEMPRE.
      for (const b of c.buckets.filter((x) => x.exemptionCause != null)) {
        expect(b.tax, `#${i} cuota exenta`).toBe(0);
      }
      // 6 · con tramo sujeto donde poner el residuo, el importe exento es
      //     EXACTAMENTE la suma de sus líneas y no se le toca un céntimo.
      if (t.haySujeto && t.hayExento) {
        const exento = round2(
          c.buckets
            .filter((b) => b.exemptionCause != null)
            .reduce((a, b) => a + b.base, 0),
        );
        expect(exento, `#${i} importe exento intacto`).toBe(t.importeExento);
      }
      // 7 · y `cuotaTotal` es Σ de las cuotas impresas (§16).
      expect(
        round2(c.buckets.reduce((a, b) => a + b.tax, 0)),
        `#${i} §16`,
      ).toBe(c.cuotaTotal);
    }
  });
});
