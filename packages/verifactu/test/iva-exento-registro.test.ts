// bloque iva-exento-sanitario · el registro de facturación de una
// operación EXENTA, contrastado con las fuentes de la AEAT.
//
// Las tres fuentes, y las tres dicen lo mismo:
//
//   1. Diseño de registro `DsRegistroVeriFactu.xlsx`, hoja
//      `2)D. Registro Facturación Alta`: `CalificacionOperacion¹` y
//      `OperacionExenta¹` llevan el fondo coloreado que la hoja
//      `7)Leyenda` define como «Campo de selección (alternativo)», y los
//      dos el superíndice 1 de «Campo obligatorio» — exactamente uno.
//   2. `SuministroInformacion.xsd`, `DetalleType`: `<choice>` entre los
//      dos, sin `minOccurs`.
//   3. Validaciones v1.2.2 (08-04-2026) §15.5: «Si el campo
//      OperacionExenta está cumplimentado no se pueden informar ninguno
//      de estos campos: TipoImpositivo, CuotaRepercutida,
//      TipoRecargoEquivalencia y CuotaRecargoEquivalencia.»
//
// Y la que contradice el enunciado del bloque, también de §15.5: «Si
// Impuesto = "01" (IVA), "03" (IGIC) o no se cumplimenta (considerándose
// "01" - IVA), y ClaveRegimen es igual a "01", no pueden marcarse los
// valores de OperacionExenta "E2" y "E3".»

import { describe, expect, it } from "vitest";

import { buildRegistroAlta, type BucketDesglose } from "../src/registro.js";
import { buildHuellaInputAlta, huellaSha256 } from "../src/huella.js";
import {
  type DetalleDesgloseExenta,
  type DetalleDesgloseSujeta,
  MAX_DETALLE_DESGLOSE,
} from "../src/tipos.js";

const BASE = {
  version: "1.0.0-test",
  numeroInstalacion: "CAJA-1",
  idEmisorFactura: "00000000T",
  nombreRazonEmisor: "PODOLOGÍA ROSARIO",
  numSerieFactura: "C1/000042",
  fechaExpedicion: "2026-10-07",
  descripcionOperacion: "Prestación de servicios",
  cabeza: null,
  fechaHoraHusoGenRegistro: "2026-10-07T10:42:00+02:00",
};

const EXENTO: BucketDesglose = {
  tipoImpositivo: 0,
  baseImponible: 35,
  cuotaRepercutida: 0,
  causaExencion: "E1",
};

const SUJETO_21: BucketDesglose = {
  tipoImpositivo: 21,
  baseImponible: 9.92,
  cuotaRepercutida: 2.08,
};

function alta(desglose: BucketDesglose[], cuotaTotal: number, importeTotal: number) {
  return buildRegistroAlta({ ...BASE, desglose, cuotaTotal, importeTotal });
}

describe("iva-exento-sanitario · el DetalleDesglose exento", () => {
  it("lleva OperacionExenta y el importe, y NADA más", async () => {
    const { registro } = await alta([EXENTO], 0, 35);
    expect(registro.Desglose.DetalleDesglose).toEqual([
      {
        Impuesto: "01",
        ClaveRegimen: "01",
        OperacionExenta: "E1",
        BaseImponibleOimporteNoSujeto: "35.00",
      },
    ]);
  });

  it("y las claves prohibidas están AUSENTES, no a undefined", async () => {
    // Lo que se guarda en `fiscal_records.payload` es lo que V2
    // serializará a XML SIN VOLVER A TOCARLO (FAQ §5). Una clave a
    // `undefined` desaparece al serializar, sí — pero la próxima persona
    // que lea el objeto en un depurador verá un campo que «está» y lo
    // tratará como informado.
    const { registro } = await alta([EXENTO], 0, 35);
    const d = registro.Desglose.DetalleDesglose[0]!;
    expect("CalificacionOperacion" in d).toBe(false);
    expect("TipoImpositivo" in d).toBe(false);
    expect("CuotaRepercutida" in d).toBe(false);
    expect("TipoRecargoEquivalencia" in d).toBe(false);
    expect("CuotaRecargoEquivalencia" in d).toBe(false);
  });

  it("el TIPO de TS hace imposible mezclar las dos formas", () => {
    // Esta comprobación la hace el compilador y no el runtime; el test
    // existe para que el `@ts-expect-error` se ponga ROJO si alguien
    // vuelve a juntar las dos formas en una interfaz de campos
    // opcionales. Sin él, `DetalleDesglose` podría relajarse sin que nada
    // se quejara, y «declarar un E1 con TipoImpositivo» volvería a
    // compilar — y a pasar los tests de importes, porque los importes
    // cuadran.
    const exento: DetalleDesgloseExenta = {
      Impuesto: "01",
      ClaveRegimen: "01",
      OperacionExenta: "E1",
      BaseImponibleOimporteNoSujeto: "35.00",
    };
    // @ts-expect-error · un tramo exento NO puede llevar TipoImpositivo (§15.5)
    exento.TipoImpositivo = "0.00";
    // @ts-expect-error · ni CuotaRepercutida (§15.5)
    exento.CuotaRepercutida = "0.00";
    // @ts-expect-error · ni CalificacionOperacion (el `<choice>` del XSD)
    exento.CalificacionOperacion = "S1";

    const sujeto: DetalleDesgloseSujeta = {
      Impuesto: "01",
      ClaveRegimen: "01",
      CalificacionOperacion: "S1",
      TipoImpositivo: "21.00",
      BaseImponibleOimporteNoSujeto: "9.92",
      CuotaRepercutida: "2.08",
    };
    // @ts-expect-error · y un tramo sujeto no puede llevar OperacionExenta
    sujeto.OperacionExenta = "E1";
    expect(exento.OperacionExenta).toBe("E1");
    expect(sujeto.CalificacionOperacion).toBe("S1");
  });

  it("E2 y E3 se rechazan con ClaveRegimen 01 (§15.5)", async () => {
    for (const codigo of ["E2", "E3"]) {
      await expect(
        alta([{ ...EXENTO, causaExencion: codigo }], 0, 35),
      ).rejects.toThrow(/§15\.5/);
    }
  });

  it("y E1, E4, E5 y E6 pasan", async () => {
    for (const codigo of ["E1", "E4", "E5", "E6"]) {
      const { registro } = await alta(
        [{ ...EXENTO, causaExencion: codigo }],
        0,
        35,
      );
      expect(
        (registro.Desglose.DetalleDesglose[0] as DetalleDesgloseExenta)
          .OperacionExenta,
        codigo,
      ).toBe(codigo);
    }
  });

  it("el tope de doce tramos sigue vigente, mezclando formas", async () => {
    const trece: BucketDesglose[] = [
      EXENTO,
      ...Array.from({ length: MAX_DETALLE_DESGLOSE }, (_, i) => ({
        tipoImpositivo: i,
        baseImponible: 1,
        cuotaRepercutida: 0,
      })),
    ];
    await expect(alta(trece, 0, 47)).rejects.toThrow(/13 tramos/);
  });
});

describe("iva-exento-sanitario · CuotaTotal e ImporteTotal", () => {
  it("§16 · el tramo exento NO suma a CuotaTotal", async () => {
    // «Se validará que [CuotaTotal] sea igual a Ʃ (CuotaRepercutida +
    // CuotaRecargoEquivalencia) de todas las líneas de detalle de
    // desglose», y un tramo exento no informa `CuotaRepercutida`.
    const { registro } = await alta([EXENTO, SUJETO_21], 2.08, 47);
    const suma = registro.Desglose.DetalleDesglose.reduce(
      (acc, d) => acc + Number(d.CuotaRepercutida ?? 0),
      0,
    );
    expect(Number(registro.CuotaTotal)).toBe(suma);
    expect(registro.CuotaTotal).toBe("2.08");
  });

  it("y en una factura íntegramente exenta CuotaTotal es 0,00", async () => {
    const { registro } = await alta([EXENTO], 0, 35);
    expect(registro.CuotaTotal).toBe("0.00");
  });

  it("§17 · ImporteTotal = Σ (base + cuota), exacto en los dos casos", async () => {
    for (const [desglose, cuota, total] of [
      [[EXENTO], 0, 35],
      [[EXENTO, SUJETO_21], 2.08, 47],
    ] as const) {
      const { registro } = await alta([...desglose], cuota, total);
      const suma = registro.Desglose.DetalleDesglose.reduce(
        (acc, d) =>
          acc +
          Number(d.BaseImponibleOimporteNoSujeto) +
          Number(d.CuotaRepercutida ?? 0),
        0,
      );
      // Sin gastar nada del margen de ±10,00 € que el §17 admite.
      expect(Math.round(suma * 100) / 100).toBe(Number(registro.ImporteTotal));
    }
  });
});

describe("iva-exento-sanitario · la HUELLA no cambia de fórmula", () => {
  // El bloque lo pedía comprobado y no de palabra. La huella se calcula
  // sobre ocho campos (`buildHuellaInputAlta`) y NINGUNO es del desglose:
  // IDEmisorFactura, NumSerieFactura, FechaExpedicionFactura, TipoFactura,
  // CuotaTotal, ImporteTotal, Huella anterior y FechaHoraHusoGenRegistro.
  it("dos registros con el MISMO total y desgloses distintos tienen la MISMA huella", async () => {
    // Uno exento de 35,00 € y otro sujeto al 0 % de 35,00 €: el mismo
    // `CuotaTotal` (0,00) y el mismo `ImporteTotal` (35,00), con
    // `DetalleDesglose` completamente distintos.
    const exenta = await alta([EXENTO], 0, 35);
    const sujetaAlCero = await alta(
      [{ tipoImpositivo: 0, baseImponible: 35, cuotaRepercutida: 0 }],
      0,
      35,
    );
    expect(exenta.huella).toBe(sujetaAlCero.huella);
    expect(exenta.huellaInput).toBe(sujetaAlCero.huellaInput);
    // Y el desglose, en cambio, NO es el mismo: la huella no distingue
    // estas dos facturas, y eso no es un fallo — es que la AEAT no la hizo
    // depender del desglose. Lo que las distingue es el registro, que
    // viaja completo.
    expect(exenta.registro.Desglose).not.toEqual(sujetaAlCero.registro.Desglose);
  });

  it("y la huella es la de la fórmula de siempre, recalculada a mano", async () => {
    const { registro, huella, huellaInput } = await alta([EXENTO], 0, 35);
    const esperado = buildHuellaInputAlta({
      idEmisorFactura: "00000000T",
      numSerieFactura: "C1/000042",
      fechaExpedicionFactura: "07-10-2026",
      tipoFactura: "F2",
      cuotaTotal: "0.00",
      importeTotal: "35.00",
      huellaAnterior: null,
      fechaHoraHusoGenRegistro: "2026-10-07T10:42:00+02:00",
    });
    expect(huellaInput).toBe(esperado);
    expect(huella).toBe(await huellaSha256(esperado));
    expect(registro.Huella).toBe(huella);
    // Y la cadena de entrada no menciona el desglose por ninguna parte.
    expect(huellaInput).not.toContain("OperacionExenta");
    expect(huellaInput).not.toContain("E1");
  });

  it("el encadenamiento sigue siendo el de siempre con una factura exenta", async () => {
    const primero = await alta([EXENTO], 0, 35);
    const segundo = await buildRegistroAlta({
      ...BASE,
      numSerieFactura: "C1/000043",
      desglose: [EXENTO],
      cuotaTotal: 0,
      importeTotal: 35,
      cabeza: {
        chainIndex: 1,
        idEmisorFactura: "00000000T",
        numSerieFactura: "C1/000042",
        fechaExpedicion: "2026-10-07",
        huella: primero.huella,
        fechaHoraHusoGenRegistro: BASE.fechaHoraHusoGenRegistro,
        huellaInput: primero.huellaInput,
        ultimoNumero: 42,
        serie: "C1",
      },
    });
    expect(segundo.registro.Encadenamiento).toEqual({
      RegistroAnterior: {
        IDEmisorFactura: "00000000T",
        NumSerieFactura: "C1/000042",
        FechaExpedicionFactura: "07-10-2026",
        Huella: primero.huella,
      },
    });
    expect(segundo.huella).not.toBe(primero.huella);
  });
});
