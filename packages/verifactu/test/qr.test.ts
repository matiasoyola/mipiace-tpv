// El QR tributario, contra los ejemplos del documento de la AEAT
// (v0.5.0, §4 y §8).

import { describe, expect, it } from "vitest";

import {
  buildQrUrl,
  LEYENDA_ENCIMA_DEL_QR,
  LEYENDA_VERIFACTU,
  QR_BASE_URL,
  QR_LADO_MAX_MM,
  QR_LADO_MIN_MM,
  QR_NIVEL_CORRECCION,
  serieEsValidaParaQr,
} from "../src/qr.js";

describe("las URLs base", () => {
  it("son las del documento, y pruebas NO es producción", () => {
    expect(QR_BASE_URL.PRUEBAS).toBe(
      "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR",
    );
    expect(QR_BASE_URL.PRODUCCION).toBe(
      "https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR",
    );
    expect(QR_BASE_URL.PRUEBAS).not.toBe(QR_BASE_URL.PRODUCCION);
  });

  it("son las de facturas VERIFICABLES, no las de ValidarQRNoVerifactu", () => {
    // Emitir con la URL de «no verificable» diría al cliente, en el propio
    // QR, que este sistema no remite — que es lo contrario de lo que el
    // ticket afirma justo debajo con la leyenda VERI*FACTU.
    expect(QR_BASE_URL.PRUEBAS).not.toContain("NoVerifactu");
    expect(QR_BASE_URL.PRODUCCION).not.toContain("NoVerifactu");
  });
});

describe("buildQrUrl", () => {
  it("§8.3 · el ejemplo de producción del documento", () => {
    expect(
      buildQrUrl({
        entorno: "PRODUCCION",
        nif: "89890001K",
        numSerieFactura: "12345678-G33",
        fechaExpedicion: "01-09-2024",
        importeTotal: "241.4",
      }),
    ).toBe(
      "https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR" +
        "?nif=89890001K&numserie=12345678-G33&fecha=01-09-2024&importe=241.4",
    );
  });

  it("§4 · codifica el & de una serie, que si no parte la URL", () => {
    expect(
      buildQrUrl({
        entorno: "PRUEBAS",
        nif: "89890001K",
        numSerieFactura: "12345678&G33",
        fechaExpedicion: "01-01-2024",
        importeTotal: "241.4",
      }),
    ).toBe(
      "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR" +
        "?nif=89890001K&numserie=12345678%26G33&fecha=01-01-2024&importe=241.4",
    );
  });

  it("codifica la barra de nuestra serie", () => {
    const url = buildQrUrl({
      entorno: "PRUEBAS",
      nif: "B45902186",
      numSerieFactura: "C1/000123",
      fechaExpedicion: "24-09-2026",
      importeTotal: "12.50",
    });
    expect(url).toContain("numserie=C1%2F000123");
  });

  it("lleva los cuatro parámetros obligatorios y ninguno más", () => {
    const url = buildQrUrl({
      entorno: "PRUEBAS",
      nif: "B45902186",
      numSerieFactura: "C1/000123",
      fechaExpedicion: "24-09-2026",
      importeTotal: "12.50",
    });
    const query = url.slice(url.indexOf("?") + 1);
    expect(query.split("&").map((p) => p.split("=")[0])).toEqual([
      "nif",
      "numserie",
      "fecha",
      "importe",
    ]);
    // §7: «este parámetro nunca podrá incorporarse en la URL que va en el
    // código QR de la factura».
    expect(url).not.toContain("formato=");
  });

  it("no arrastra espacios de los valores", () => {
    const url = buildQrUrl({
      entorno: "PRUEBAS",
      nif: " B45902186 ",
      numSerieFactura: " C1/000123 ",
      fechaExpedicion: " 24-09-2026 ",
      importeTotal: " 12.50 ",
    });
    expect(url).not.toContain("%20");
  });
});

describe("las exigencias físicas del art. 21.1", () => {
  it("el tamaño está entre 30x30 y 40x40 mm y la corrección es M", () => {
    expect(QR_LADO_MIN_MM).toBe(30);
    expect(QR_LADO_MAX_MM).toBe(40);
    expect(QR_NIVEL_CORRECCION).toBe("M");
  });
});

describe("las leyendas del art. 20.1.b y §3", () => {
  it("son las literales de la norma", () => {
    expect(LEYENDA_ENCIMA_DEL_QR).toBe("QR tributario:");
    expect(LEYENDA_VERIFACTU).toBe("VERI*FACTU");
  });
});

describe("serieEsValidaParaQr", () => {
  it("acepta lo que cabe en ASCII 32-126", () => {
    expect(serieEsValidaParaQr("C1")).toBe(true);
    expect(serieEsValidaParaQr("CAJA-1")).toBe(true);
  });

  it("rechaza vacía, demasiado larga y con caracteres fuera de ASCII", () => {
    expect(serieEsValidaParaQr("   ")).toBe(false);
    expect(serieEsValidaParaQr("A".repeat(61))).toBe(false);
    // Una «ñ» en la serie no la rechaza el QR al cobrar: hay que
    // rechazarla al configurar la caja.
    expect(serieEsValidaParaQr("PEÑA")).toBe(false);
  });
});
