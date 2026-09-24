// Los tres ejemplos oficiales de la AEAT, literales.
//
// Fuente: «Detalle de las especificaciones técnicas para generación de la
// huella o hash de los registros de facturación», v0.1.2 del 27-08-2024,
// apartado 6 («EJEMPLOS»). Casos 6.1, 6.2 y 6.3.
//
// Esto no es un test de regresión: es el criterio de corrección. Si una
// huella de este fichero no sale idéntica, la implementación está mal —
// da igual lo razonable que parezca el cambio que la rompió.

import { describe, expect, it } from "vitest";

import {
  buildHuellaInputAlta,
  buildHuellaInputAnulacion,
  hasWebCrypto,
  huellaCoincide,
  huellaSha256,
} from "../src/huella.js";

// §6.1 — primer registro de facturación (de alta) de un SIF.
const CASO_1_CADENA =
  "IDEmisorFactura=89890001K&NumSerieFactura=12345678/G33&" +
  "FechaExpedicionFactura=01-01-2024&TipoFactura=F1&CuotaTotal=12.35&" +
  "ImporteTotal=123.45&Huella=&" +
  "FechaHoraHusoGenRegistro=2024-01-01T19:20:30+01:00";
const CASO_1_HUELLA =
  "3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60";

// §6.2 — alta con registro anterior existente.
const CASO_2_CADENA =
  "IDEmisorFactura=89890001K&NumSerieFactura=12345679/G34&" +
  "FechaExpedicionFactura=01-01-2024&TipoFactura=F1&CuotaTotal=12.35&" +
  `ImporteTotal=123.45&Huella=${CASO_1_HUELLA}&` +
  "FechaHoraHusoGenRegistro=2024-01-01T19:20:35+01:00";
const CASO_2_HUELLA =
  "F7B94CFD8924EDFF273501B01EE5153E4CE8F259766F88CF6ACB8935802A2B97";

// §6.3 — anulación con registro anterior existente.
const CASO_3_CADENA =
  "IDEmisorFacturaAnulada=89890001K&NumSerieFacturaAnulada=12345679/G34&" +
  "FechaExpedicionFacturaAnulada=01-01-2024&" +
  `Huella=${CASO_2_HUELLA}&` +
  "FechaHoraHusoGenRegistro=2024-01-01T19:20:40+01:00";
const CASO_3_HUELLA =
  "177547C0D57AC74748561D054A9CEC14B4C4EA23D1BEFD6F2E69E3A388F90C68";

describe("los ejemplos oficiales de la AEAT", () => {
  it("6.1 · primer registro de alta: la cadena y la huella", async () => {
    const cadena = buildHuellaInputAlta({
      idEmisorFactura: "89890001K",
      numSerieFactura: "12345678/G33",
      fechaExpedicionFactura: "01-01-2024",
      tipoFactura: "F1",
      cuotaTotal: "12.35",
      importeTotal: "123.45",
      huellaAnterior: null,
      fechaHoraHusoGenRegistro: "2024-01-01T19:20:30+01:00",
    });
    expect(cadena).toBe(CASO_1_CADENA);
    expect(await huellaSha256(cadena)).toBe(CASO_1_HUELLA);
  });

  it("6.2 · alta encadenada: la cadena y la huella", async () => {
    const cadena = buildHuellaInputAlta({
      idEmisorFactura: "89890001K",
      numSerieFactura: "12345679/G34",
      fechaExpedicionFactura: "01-01-2024",
      tipoFactura: "F1",
      cuotaTotal: "12.35",
      importeTotal: "123.45",
      huellaAnterior: CASO_1_HUELLA,
      fechaHoraHusoGenRegistro: "2024-01-01T19:20:35+01:00",
    });
    expect(cadena).toBe(CASO_2_CADENA);
    expect(await huellaSha256(cadena)).toBe(CASO_2_HUELLA);
  });

  it("6.3 · anulación encadenada: la cadena y la huella", async () => {
    const cadena = buildHuellaInputAnulacion({
      idEmisorFacturaAnulada: "89890001K",
      numSerieFacturaAnulada: "12345679/G34",
      fechaExpedicionFacturaAnulada: "01-01-2024",
      huellaAnterior: CASO_2_HUELLA,
      fechaHoraHusoGenRegistro: "2024-01-01T19:20:40+01:00",
    });
    expect(cadena).toBe(CASO_3_CADENA);
    expect(await huellaSha256(cadena)).toBe(CASO_3_HUELLA);
  });

  it("los tres encadenan de verdad: la huella de cada uno está dentro del siguiente", () => {
    expect(CASO_2_CADENA).toContain(`Huella=${CASO_1_HUELLA}&`);
    expect(CASO_3_CADENA).toContain(`Huella=${CASO_2_HUELLA}&`);
  });
});

describe("las reglas de formato del §3", () => {
  it("un campo sin valor deja el nombre y el = , no se omite", () => {
    const cadena = buildHuellaInputAlta({
      idEmisorFactura: "89890001K",
      numSerieFactura: "A/000001",
      fechaExpedicionFactura: "01-01-2024",
      tipoFactura: "F2",
      cuotaTotal: "0.00",
      importeTotal: "0.00",
      huellaAnterior: null,
      fechaHoraHusoGenRegistro: "2024-01-01T19:20:30+01:00",
    });
    expect(cadena).toContain("&Huella=&");
    expect(cadena.split("&")).toHaveLength(8);
  });

  it("los valores van sin espacios al inicio ni al final", async () => {
    const conEspacios = buildHuellaInputAlta({
      idEmisorFactura: "  89890001K ",
      numSerieFactura: "  12345678/G33  ",
      fechaExpedicionFactura: " 01-01-2024 ",
      tipoFactura: " F1 ",
      cuotaTotal: " 12.35",
      importeTotal: "123.45 ",
      huellaAnterior: null,
      fechaHoraHusoGenRegistro: " 2024-01-01T19:20:30+01:00 ",
    });
    expect(conEspacios).toBe(CASO_1_CADENA);
    expect(await huellaSha256(conEspacios)).toBe(CASO_1_HUELLA);
  });

  it("la salida es hexadecimal, en mayúsculas, de 64 caracteres", async () => {
    const huella = await huellaSha256("lo que sea");
    expect(huella).toMatch(/^[0-9A-F]{64}$/);
  });

  it("la cadena se codifica en UTF-8, no en latin-1", async () => {
    // «ñ» son dos bytes en UTF-8 y uno en latin-1. La razón social de un
    // comercio español las lleva; si alguien cambiara la codificación, la
    // huella cambiaría y la AEAT rechazaría el registro.
    expect(await huellaSha256("ñ")).toBe(
      "024BB90888CA89A15A19E9BDD8C712BFB070465FCE1EF25E43C170EA44FC5E5F",
    );
    // La misma cadena en latin-1 daría esta otra, que es la que NO debe
    // salir nunca.
    expect(await huellaSha256("ñ")).not.toBe(
      "D4F09E5C5AF99A24C7E304CA7997D26CB00901697DE08A49BE0D46AB5839B614",
    );
  });
});

describe("huellaCoincide", () => {
  it("acepta la huella correcta aunque venga en minúsculas o con espacios", async () => {
    expect(await huellaCoincide(CASO_1_CADENA, CASO_1_HUELLA)).toBe(true);
    expect(
      await huellaCoincide(CASO_1_CADENA, ` ${CASO_1_HUELLA.toLowerCase()} `),
    ).toBe(true);
  });

  it("rechaza una huella de un carácter distinto", async () => {
    const manipulada = `0${CASO_1_HUELLA.slice(1)}`;
    expect(await huellaCoincide(CASO_1_CADENA, manipulada)).toBe(false);
  });
});

describe("hasWebCrypto", () => {
  it("dice que sí en este entorno", () => {
    expect(hasWebCrypto()).toBe(true);
  });
});
