// catalogo-servicios-csv · las tres columnas nuevas del fichero de alta.
//
// El fichero de alta del super-admin tiene que poder cargar el catálogo
// REAL de la clínica de Rosario: 17 servicios sanitarios, exentos de IVA y
// con duración de agenda. Antes de este bloque el parser sólo conocía
// cinco columnas y cada servicio entraba como producto, al 0 % SUJETO y
// sin duración: mal en el papel, mal en el registro y fuera de la agenda.
//
// Lo que se fija aquí, cada cosa con su sabotaje (§ «Cómo se da por
// hecho» del prompt del bloque):
//
//   1. **El fichero de ayer entra igual que ayer.** Sabotaje: hacer
//      obligatoria cualquiera de las tres columnas. Rojo con el CSV real
//      de La Maestranza, que no las trae.
//   2. **`tipo = SERVICE` nace `kind = SERVICE`.** Sabotaje: ignorar la
//      columna `tipo`.
//   3. **`exencion = E1` nace exento.** Sabotaje: ignorar la columna
//      `exencion` — se ve en que el producto sale sujeto al 0 %, que vale
//      los mismos cero euros y es otra operación ante la AEAT.
//   4. **`E1` con IVA 10 es fila RECHAZADA.** Sabotaje: aceptarla. La
//      negativa la pone `validateLocalProduct`, que es la misma función
//      que usa el alta de una ficha desde el panel: aquí no hay una
//      segunda validación de la exención (decisión 2 del bloque).
//   5. **`SERVICE` sin duración es fila RECHAZADA.** Sabotaje: dejarla
//      pasar con `durationMin` nulo — sería un servicio que la dueña no
//      puede reservar y que en DRAFT nadie puede arreglar.
//   6. **`PRODUCT` con duración es fila RECHAZADA.** Sabotaje: ignorar la
//      columna en los productos. Una crema no se reserva: la duración ahí
//      es una columna mal puesta, y callarla deja al implantador creyendo
//      que ha cargado un servicio.
//   7. **El rango de la duración es el del PUT del panel.** Sabotaje:
//      escribir otro número aquí en vez de usar `normalizeDurationMin`.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseCatalogoCsv } from "../src/catalog/csv-catalogo.js";
import {
  DURATION_MAX,
  DURATION_MIN,
  normalizeDurationMin,
} from "../src/services/scheduling-rules.js";

// Los DOS catálogos REALES, leídos de los ficheros que el implantador va
// a subir. No se copian aquí a mano: una copia se queda vieja el día que
// alguien corrija un precio o una duración, y entonces el test pasaría
// verificando un catálogo que ya no es el del comercio.
const CSV_MAESTRANZA = readFileSync(
  new URL("../../../docs/implantaciones/maestranza/catalogo-tpv.csv", import.meta.url),
  "utf8",
);
const CSV_ROSARIO = readFileSync(
  new URL("../../../docs/implantaciones/rosario/catalogo-tpv.csv", import.meta.url),
  "utf8",
);

const CABECERA = "sku,nombre,precio_con_iva,iva,categoria,tipo,exencion,duracion_min";
const csv = (...filas: string[]): string => [CABECERA, ...filas].join("\n");

describe("catalogo-servicios-csv · el fichero de ayer entra igual que ayer", () => {
  // LA promesa de compatibilidad, y la que no se puede comprobar con un
  // CSV de mentira: el fichero de La Maestranza son 128 líneas con
  // comillas, acentos y una infusión con comas dentro del nombre.
  const { buenas, malas } = parseCatalogoCsv(CSV_MAESTRANZA);

  it("las 128 filas entran y ninguna es mala", () => {
    expect(malas).toEqual([]);
    expect(buenas).toHaveLength(128);
  });

  it("todas nacen PRODUCT, sujetas y sin duración", () => {
    expect(buenas.every((f) => f.fields.kind === "PRODUCT")).toBe(true);
    // Sujeta, no exenta: `null` en la causa. Un `""` o un `"E1"` aquí
    // cambiaría el desglose de los 128 productos de un bar.
    expect(buenas.every((f) => f.fields.exemptionCause === null)).toBe(true);
    expect(buenas.every((f) => f.duracionMin === null)).toBe(true);
  });

  it("y el café con leche sigue valiendo 1,60 € de carta y 1,4545 guardado", () => {
    const cafe = buenas.find((f) => f.fields.sku === "CAF-001")!;
    expect(cafe.precioConIva).toBe(1.6);
    expect(cafe.fields.basePrice).toBe(1.4545);
    expect(cafe.fields.taxRate).toBe(10);
  });
});

describe("catalogo-servicios-csv · el catálogo REAL de Rosario", () => {
  const { buenas, malas } = parseCatalogoCsv(CSV_ROSARIO);

  it("las 17 filas entran y ninguna es mala", () => {
    expect(malas).toEqual([]);
    expect(buenas).toHaveLength(17);
  });

  it("los 17 son SERVICIOS exentos con su duración", () => {
    expect(buenas.every((f) => f.fields.kind === "SERVICE")).toBe(true);
    expect(buenas.every((f) => f.fields.exemptionCause === "E1")).toBe(true);
    expect(buenas.every((f) => f.fields.taxRate === 0)).toBe(true);
    expect(buenas.every((f) => typeof f.duracionMin === "number")).toBe(true);
  });

  it("la quiropodia básica son 30 minutos y 25 € que la paciente paga enteros", () => {
    const q = buenas.find((f) => f.fields.sku === "POD-002")!;
    expect(q.duracionMin).toBe(30);
    expect(q.precioConIva).toBe(25);
    // DECISIÓN 6 del bloque, comprobada y no de palabra: el precio de un
    // exento es lo que paga el paciente. Con `iva = 0` la conversión
    // bruto→neto divide por 1, así que el neto guardado y el precio de la
    // hoja de Rosario son el MISMO número. Si algún día alguien mete un
    // IVA aquí, este test canta.
    expect(q.fields.basePrice).toBe(25);
  });

  it("las cirugías largas caben: 120 y 180 minutos", () => {
    const duraciones = new Map(buenas.map((f) => [f.fields.sku, f.duracionMin]));
    expect(duraciones.get("POD-015")).toBe(120);
    expect(duraciones.get("POD-016")).toBe(180);
    expect(duraciones.get("POD-017")).toBe(120);
  });

  it("una entrega de órtesis a 0 € también entra: gratis no es inválido", () => {
    const entrega = buenas.find((f) => f.fields.sku === "POD-011")!;
    expect(entrega.precioConIva).toBe(0);
    expect(entrega.fields.basePrice).toBe(0);
    expect(entrega.duracionMin).toBe(10);
  });

  it("la familia de agenda sale de la primera categoría de la fila", () => {
    // La ruta se la pone a `service_scheduling.family`; aquí lo que se
    // fija es que la categoría llega en los tags y en qué orden.
    const q = buenas.find((f) => f.fields.sku === "POD-002")!;
    expect(q.fields.tags[0]).toBe("quiropodia");
  });
});

describe("catalogo-servicios-csv · la columna tipo", () => {
  it("SERVICE nace kind = SERVICE", () => {
    const { buenas } = parseCatalogoCsv(csv("POD-001,Consulta,20.00,0,consulta,SERVICE,E1,20"));
    expect(buenas[0]!.fields.kind).toBe("SERVICE");
  });

  it("vacía nace PRODUCT", () => {
    const { buenas } = parseCatalogoCsv(csv("CRE-001,Crema urea,12.00,21,mostrador,,,"));
    expect(buenas[0]!.fields.kind).toBe("PRODUCT");
  });

  it("PRODUCT escrito en minúsculas también vale: un CSV a mano no respeta cajas", () => {
    const { buenas } = parseCatalogoCsv(csv("POD-001,Consulta,20.00,0,consulta,service,E1,20"));
    expect(buenas[0]!.fields.kind).toBe("SERVICE");
  });

  it("un tipo que no es ninguno de los dos RECHAZA la fila", () => {
    // Y no cae a PRODUCT: «SERVICIO» escrito a mano es un servicio que
    // habría entrado como producto y que la agenda no vería.
    const { buenas, malas } = parseCatalogoCsv(
      csv("POD-001,Consulta,20.00,0,consulta,SERVICIO,E1,20"),
    );
    expect(buenas).toEqual([]);
    expect(malas[0]!.motivo).toContain('El tipo "SERVICIO" no vale');
    expect(malas[0]!.motivo).toContain("PRODUCT o SERVICE");
  });
});

describe("catalogo-servicios-csv · la columna exencion", () => {
  it("E1 nace exento, no sujeto al 0 %", () => {
    const { buenas } = parseCatalogoCsv(csv("POD-001,Consulta,20.00,0,consulta,SERVICE,E1,20"));
    expect(buenas[0]!.fields.exemptionCause).toBe("E1");
    expect(buenas[0]!.fields.taxRate).toBe(0);
  });

  it("vacía nace SUJETA, con la causa en null", () => {
    const { buenas } = parseCatalogoCsv(csv("CAF-001,Café,1.60,10,cafés,PRODUCT,,"));
    expect(buenas[0]!.fields.exemptionCause).toBeNull();
  });

  it("un 0 % SIN exencion sigue siendo un 0 % sujeto", () => {
    // Los dos valen cero euros de cuota y son DOS operaciones distintas
    // ante la AEAT (`docs/blocks/iva-exento-sanitario-done.md` §1). El
    // parser no puede «ayudar» convirtiendo uno en el otro.
    const { buenas } = parseCatalogoCsv(csv("X-1,Algo al cero,5.00,0,varios,PRODUCT,,"));
    expect(buenas[0]!.fields.taxRate).toBe(0);
    expect(buenas[0]!.fields.exemptionCause).toBeNull();
  });

  it("E1 con IVA 10 RECHAZA la fila, con la frase de las reglas del producto", () => {
    const { buenas, malas } = parseCatalogoCsv(
      csv("POD-002,Quiropodia,25.00,10,quiropodia,SERVICE,E1,30"),
    );
    expect(buenas).toEqual([]);
    // La frase la redacta `validateLocalProduct`, la MISMA función que usa
    // el alta de una ficha desde el panel. Si alguien escribiera aquí una
    // segunda validación de la exención, este mensaje cambiaría.
    expect(malas[0]!.motivo).toBe(
      "Un producto exento · sanitario no lleva IVA: su tipo tiene que ser 0 %.",
    );
  });

  it("E2 RECHAZA la fila: no se puede declarar en régimen general", () => {
    // Validaciones AEAT §15.5. La columna de la base admite los seis
    // códigos de la lista L10; la aplicación sólo deja declarar cuatro.
    const { buenas, malas } = parseCatalogoCsv(csv("X-1,Exportación,10.00,0,varios,PRODUCT,E2,"));
    expect(buenas).toEqual([]);
    expect(malas[0]!.motivo).toContain("régimen general");
  });

  it("un código que no está en la lista L10 RECHAZA la fila", () => {
    const { buenas, malas } = parseCatalogoCsv(csv("X-1,Qué es esto,10.00,0,varios,PRODUCT,E9,"));
    expect(buenas).toEqual([]);
    expect(malas[0]!.motivo).toContain("E1–E6");
  });

  it("e1 en minúsculas vale: lo que importa es el código, no la caja", () => {
    const { buenas } = parseCatalogoCsv(csv("POD-001,Consulta,20.00,0,consulta,SERVICE,e1,20"));
    expect(buenas[0]!.fields.exemptionCause).toBe("E1");
  });
});

describe("catalogo-servicios-csv · la columna duracion_min", () => {
  it("un SERVICE sin duración RECHAZA la fila y dice por qué", () => {
    const { buenas, malas } = parseCatalogoCsv(
      csv("POD-002,Quiropodia,25.00,0,quiropodia,SERVICE,E1,"),
    );
    expect(buenas).toEqual([]);
    expect(malas[0]!.motivo).toContain("no se puede reservar");
  });

  it("un PRODUCT con duración RECHAZA la fila: una crema no se reserva", () => {
    const { buenas, malas } = parseCatalogoCsv(csv("CRE-001,Crema urea,12.00,21,mostrador,,,30"));
    expect(buenas).toEqual([]);
    expect(malas[0]!.motivo).toContain("no lleva duracion_min");
    // Y el motivo nombra la causa probable, que es lo que el implantador
    // tiene que arreglar en su Excel.
    expect(malas[0]!.motivo).toContain("pon SERVICE en la columna tipo");
  });

  it("una duración de cero RECHAZA la fila", () => {
    const { malas } = parseCatalogoCsv(csv("POD-001,Consulta,20.00,0,consulta,SERVICE,E1,0"));
    expect(malas[0]!.motivo).toContain(`entre ${DURATION_MIN} y ${DURATION_MAX}`);
  });

  it("una duración de más de un día RECHAZA la fila", () => {
    const { malas } = parseCatalogoCsv(csv("POD-001,Consulta,20.00,0,consulta,SERVICE,E1,1441"));
    expect(malas[0]!.motivo).toContain(`entre ${DURATION_MIN} y ${DURATION_MAX}`);
  });

  it("media hora escrita «30,5» RECHAZA la fila: la agenda cuenta minutos enteros", () => {
    // La columna es `Int`: un 30,5 lo guardaría Postgres redondeando en
    // silencio, con la cita descolocada respecto a lo que la dueña
    // escribió.
    const { malas } = parseCatalogoCsv(csv('POD-001,Consulta,20.00,0,consulta,SERVICE,E1,"30,5"'));
    expect(malas[0]!.motivo).toContain("minutos enteros");
  });

  it("una duración que no es un número lo dice así, y no «entre 1 y 1440»", () => {
    const { malas } = parseCatalogoCsv(
      csv("POD-001,Consulta,20.00,0,consulta,SERVICE,E1,media hora"),
    );
    expect(malas[0]!.motivo).toContain("no es un número");
  });
});

describe("catalogo-servicios-csv · la regla de la duración es UNA", () => {
  // La MISMA función que valida el `PUT /services/:productId/scheduling`
  // del panel. Si el parser llevara su propio rango, un servicio que el
  // fichero acepta podría ser uno que el panel no deja guardar — o al
  // revés, que es peor: entraría por el fichero y la dueña no podría
  // corregirlo.
  it("el rango es el del panel: 1 a 1440 minutos", () => {
    expect(DURATION_MIN).toBe(1);
    expect(DURATION_MAX).toBe(1440);
    expect(normalizeDurationMin(0).ok).toBe(false);
    expect(normalizeDurationMin(1).ok).toBe(true);
    expect(normalizeDurationMin(1440).ok).toBe(true);
    expect(normalizeDurationMin(1441).ok).toBe(false);
  });

  it("y rechaza lo que no es un entero", () => {
    expect(normalizeDurationMin(30.5).ok).toBe(false);
    expect(normalizeDurationMin("treinta").ok).toBe(false);
    expect(normalizeDurationMin(Number.NaN).ok).toBe(false);
  });
});

describe("catalogo-servicios-csv · el fichero mixto de una clínica", () => {
  // El caso de Rosario del día que venda crema en el mostrador: el mismo
  // fichero con un servicio exento y un producto sujeto al 21 %.
  const { buenas, malas } = parseCatalogoCsv(
    csv(
      "POD-002,Quiropodia básica,25.00,0,quiropodia,SERVICE,E1,30",
      "CRE-001,Crema urea 20%,12.00,21,mostrador,PRODUCT,,",
    ),
  );

  it("entran los dos, cada uno con lo suyo", () => {
    expect(malas).toEqual([]);
    expect(buenas).toHaveLength(2);
    expect(buenas[0]!.fields).toMatchObject({
      kind: "SERVICE",
      exemptionCause: "E1",
      taxRate: 0,
      basePrice: 25,
    });
    expect(buenas[0]!.duracionMin).toBe(30);
    expect(buenas[1]!.fields).toMatchObject({
      kind: "PRODUCT",
      exemptionCause: null,
      taxRate: 21,
    });
    expect(buenas[1]!.duracionMin).toBeNull();
    // 12 € de mostrador al 21 % → 9,9174 neto. El TPV volverá a pintar 12.
    expect(buenas[1]!.fields.basePrice).toBe(9.9174);
  });
});
