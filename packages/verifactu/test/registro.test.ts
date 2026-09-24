// El registro de facturación completo, de alta y de anulación.

import { describe, expect, it } from "vitest";

import type { CabezaDeCadena } from "../src/cadena.js";
import { buildHuellaInputAlta, huellaSha256 } from "../src/huella.js";
import {
  buildRegistroAlta,
  buildRegistroAnulacion,
  descripcionOperacionPorVertical,
} from "../src/registro.js";

const BASE = {
  version: "1.16.0",
  numeroInstalacion: "3f7c1f6e-2b4a-4a8e-9c1d-5e6f7a8b9c0d",
  idEmisorFactura: "B45902186",
  nombreRazonEmisor: "PELUQUERÍA SOLE SL",
  numSerieFactura: "C1/000001",
  fechaExpedicion: "2026-09-24",
  descripcionOperacion: "Prestación de servicios",
  desglose: [{ tipoImpositivo: 21, baseImponible: 10, cuotaRepercutida: 2.1 }],
  cuotaTotal: 2.1,
  importeTotal: 12.1,
  cabeza: null,
  fechaHoraHusoGenRegistro: "2026-09-24T10:00:00+02:00",
};

describe("buildRegistroAlta", () => {
  it("emite una factura simplificada F2 con los nombres del anexo", async () => {
    const { registro } = await buildRegistroAlta(BASE);
    expect(registro.IDVersion).toBe("1.0");
    expect(registro.TipoFactura).toBe("F2");
    expect(registro.TipoHuella).toBe("01");
    expect(registro.IDFactura).toEqual({
      IDEmisorFactura: "B45902186",
      NumSerieFactura: "C1/000001",
      FechaExpedicionFactura: "24-09-2026",
    });
    expect(registro.CuotaTotal).toBe("2.10");
    expect(registro.ImporteTotal).toBe("12.10");
  });

  it("la huella del registro es la de su propia cadena de entrada", async () => {
    const { registro, huellaInput, huella } = await buildRegistroAlta(BASE);
    expect(registro.Huella).toBe(huella);
    expect(await huellaSha256(huellaInput)).toBe(huella);
  });

  it("la cadena de entrada es la que dicta el documento de la huella", async () => {
    const { huellaInput } = await buildRegistroAlta(BASE);
    expect(huellaInput).toBe(
      buildHuellaInputAlta({
        idEmisorFactura: "B45902186",
        numSerieFactura: "C1/000001",
        fechaExpedicionFactura: "24-09-2026",
        tipoFactura: "F2",
        cuotaTotal: "2.10",
        importeTotal: "12.10",
        huellaAnterior: null,
        fechaHoraHusoGenRegistro: "2026-09-24T10:00:00+02:00",
      }),
    );
  });

  it("el primero de la cadena lleva PrimerRegistro = S", async () => {
    const { registro } = await buildRegistroAlta(BASE);
    expect(registro.Encadenamiento).toEqual({ PrimerRegistro: "S" });
  });

  it("el primero también lleva su Huella calculada", async () => {
    // v0.1.2 §5: «incluso en el caso de que sea el primer registro (…)
    // también será necesario generar el contenido del campo Huella».
    const { registro } = await buildRegistroAlta(BASE);
    expect(registro.Huella).toMatch(/^[0-9A-F]{64}$/);
  });

  it("el siguiente apunta al anterior por identificación y huella", async () => {
    const primero = await buildRegistroAlta(BASE);
    const cabeza: CabezaDeCadena = {
      chainIndex: 1,
      idEmisorFactura: "B45902186",
      numSerieFactura: "C1/000001",
      fechaExpedicion: "2026-09-24",
      huella: primero.huella,
      fechaHoraHusoGenRegistro: BASE.fechaHoraHusoGenRegistro,
      huellaInput: primero.huellaInput,
      ultimoNumero: 1,
      serie: "C1",
    };
    const segundo = await buildRegistroAlta({
      ...BASE,
      numSerieFactura: "C1/000002",
      cabeza,
      fechaHoraHusoGenRegistro: "2026-09-24T10:05:00+02:00",
    });
    expect(segundo.registro.Encadenamiento).toEqual({
      RegistroAnterior: {
        IDEmisorFactura: "B45902186",
        NumSerieFactura: "C1/000001",
        FechaExpedicionFactura: "24-09-2026",
        Huella: primero.huella,
      },
    });
    expect(segundo.huellaInput).toContain(`Huella=${primero.huella}&`);
    expect(segundo.huella).not.toBe(primero.huella);
  });

  it("el desglose lleva IVA, régimen general y sujeta no exenta", async () => {
    const { registro } = await buildRegistroAlta({
      ...BASE,
      desglose: [
        { tipoImpositivo: 21, baseImponible: 10, cuotaRepercutida: 2.1 },
        { tipoImpositivo: 10, baseImponible: 5, cuotaRepercutida: 0.5 },
      ],
      cuotaTotal: 2.6,
      importeTotal: 17.6,
    });
    expect(registro.Desglose.DetalleDesglose).toEqual([
      {
        Impuesto: "01",
        ClaveRegimen: "01",
        CalificacionOperacion: "S1",
        TipoImpositivo: "21.00",
        BaseImponibleOimporteNoSujeto: "10.00",
        CuotaRepercutida: "2.10",
      },
      {
        Impuesto: "01",
        ClaveRegimen: "01",
        CalificacionOperacion: "S1",
        TipoImpositivo: "10.00",
        BaseImponibleOimporteNoSujeto: "5.00",
        CuotaRepercutida: "0.50",
      },
    ]);
  });

  it("no informa lo que una simplificada no tiene", async () => {
    const { registro } = await buildRegistroAlta(BASE);
    const claves = Object.keys(registro);
    expect(claves).not.toContain("Destinatarios");
    expect(claves).not.toContain("FacturaSimplificadaArt7273");
    expect(claves).not.toContain("Macrodato");
    expect(claves).not.toContain("Tercero");
    // La firma XAdES es obligatoria para conservación y requerimiento,
    // no para remisión. Este SIF es SOLO VERI*FACTU.
    expect(claves).not.toContain("Signature");
  });

  it("rechaza un desglose vacío o de más de doce tramos", async () => {
    await expect(buildRegistroAlta({ ...BASE, desglose: [] })).rejects.toThrow(
      RangeError,
    );
    await expect(
      buildRegistroAlta({
        ...BASE,
        desglose: Array.from({ length: 13 }, (_, i) => ({
          tipoImpositivo: i,
          baseImponible: 1,
          cuotaRepercutida: 0,
        })),
      }),
    ).rejects.toThrow(RangeError);
  });

  it("recorta la razón social y la descripción a lo que admite el anexo", async () => {
    const { registro } = await buildRegistroAlta({
      ...BASE,
      nombreRazonEmisor: "X".repeat(200),
      descripcionOperacion: "Y".repeat(700),
    });
    expect(registro.NombreRazonEmisor).toHaveLength(120);
    expect(registro.DescripcionOperacion).toHaveLength(500);
  });

  it("la cuota total es la que se le pasa, no la suma del desglose", async () => {
    // El reparto del céntimo de redondeo lo resuelve el ticket
    // (`allocateRoundingRemainder`). Volver a sumar aquí podría dar un
    // céntimo distinto del que ve el cliente en el papel.
    const { registro } = await buildRegistroAlta({
      ...BASE,
      desglose: [
        { tipoImpositivo: 21, baseImponible: 3.33, cuotaRepercutida: 0.7 },
        { tipoImpositivo: 21, baseImponible: 3.34, cuotaRepercutida: 0.7 },
      ],
      cuotaTotal: 1.39,
      importeTotal: 8.06,
    });
    expect(registro.CuotaTotal).toBe("1.39");
  });
});

describe("buildRegistroAnulacion", () => {
  const ANULA = {
    version: "1.16.0",
    numeroInstalacion: "3f7c1f6e-2b4a-4a8e-9c1d-5e6f7a8b9c0d",
    idEmisorFacturaAnulada: "B45902186",
    nombreRazonEmisor: "PELUQUERÍA SOLE SL",
    numSerieFacturaAnulada: "C1/000001",
    fechaExpedicionFacturaAnulada: "2026-09-24",
    cabeza: null,
    fechaHoraHusoGenRegistro: "2026-09-24T11:00:00+02:00",
  };

  it("usa los campos con sufijo Anulada y no lleva importes", async () => {
    const { registro } = await buildRegistroAnulacion(ANULA);
    expect(registro.IDFactura).toEqual({
      IDEmisorFacturaAnulada: "B45902186",
      NumSerieFacturaAnulada: "C1/000001",
      FechaExpedicionFacturaAnulada: "24-09-2026",
    });
    const claves = Object.keys(registro);
    expect(claves).not.toContain("ImporteTotal");
    expect(claves).not.toContain("CuotaTotal");
    expect(claves).not.toContain("Desglose");
  });

  it("la anulación normal NO informa SinRegistroPrevio", async () => {
    const { registro } = await buildRegistroAnulacion(ANULA);
    expect(Object.keys(registro)).not.toContain("SinRegistroPrevio");
  });

  it("la anulación de un alta que nunca existió informa SinRegistroPrevio = S", async () => {
    const { registro } = await buildRegistroAnulacion({
      ...ANULA,
      sinRegistroPrevio: true,
    });
    expect(registro.SinRegistroPrevio).toBe("S");
  });

  it("la genera el expedidor, con sus datos en Generador", async () => {
    const { registro } = await buildRegistroAnulacion(ANULA);
    expect(registro.GeneradoPor).toBe("E");
    expect(registro.Generador).toEqual({
      NombreRazon: "PELUQUERÍA SOLE SL",
      NIF: "B45902186",
    });
  });

  it("encadena igual que un alta: la huella del anterior entra en la suya", async () => {
    const alta = await buildRegistroAlta(BASE);
    const { registro, huellaInput, huella } = await buildRegistroAnulacion({
      ...ANULA,
      cabeza: {
        chainIndex: 1,
        idEmisorFactura: "B45902186",
        numSerieFactura: "C1/000001",
        fechaExpedicion: "2026-09-24",
        huella: alta.huella,
        fechaHoraHusoGenRegistro: BASE.fechaHoraHusoGenRegistro,
        huellaInput: alta.huellaInput,
        ultimoNumero: 1,
        serie: "C1",
      },
    });
    expect(huellaInput).toContain(`Huella=${alta.huella}&`);
    expect(registro.Huella).toBe(huella);
    expect(await huellaSha256(huellaInput)).toBe(huella);
  });
});

describe("descripcionOperacionPorVertical", () => {
  it("dice algo cierto para cada vertical, y algo por defecto para lo demás", () => {
    expect(descripcionOperacionPorVertical("HOSPITALITY")).toBe(
      "Servicios de hostelería y restauración",
    );
    expect(descripcionOperacionPorVertical("SERVICES")).toBe(
      "Prestación de servicios",
    );
    expect(descripcionOperacionPorVertical("RETAIL")).toBe("Venta al por menor");
    expect(descripcionOperacionPorVertical(null)).toBe("Venta al por menor");
  });
});
