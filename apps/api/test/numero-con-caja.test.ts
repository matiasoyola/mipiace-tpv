// hierro-sirope (G) · DE QUÉ CAJA ES ESTE #000001.
//
// El 18-10 se creó la Caja 2 de Cafetería Sirope y su primer ticket salió
// con el número #000001 mientras la Caja 1 iba por el #000028 — los dos en
// la misma lista, sin nada que los distinguiera salvo el texto pequeño de
// debajo (captura 30). Cuando la Caja 2 llegue al 28 habrá dos #000028.
//
// Lo que NO se toca: la numeración. Es correlativa POR CAJA a propósito y
// tiene implicaciones fiscales (cada caja es un SIF con su serie y su
// cadena, ADR-019). Lo que cambia es cómo se ESCRIBE y cómo se busca.
//
// Fila de la tabla de sabotajes: «la etiqueta de G».

import { describe, expect, it } from "vitest";

import {
  etiquetaDeCaja,
  etiquetaDesdeNombre,
  numeroConCaja,
  parsearBusquedaDeTicket,
} from "@mipiacetpv/ticket-model";

describe("hierro-sirope G · la etiqueta de la caja", () => {
  it("es la serie fiscal cuando la caja ya emite: la misma letra que su factura", () => {
    expect(etiquetaDeCaja({ fiscalSeries: "C2", name: "Caja 2" })).toBe("C2");
    expect(etiquetaDeCaja({ fiscalSeries: "c1", name: "Lo que sea" })).toBe("C1");
  });

  it("y mientras no emite, sale del nombre que el cajero lee al vincular", () => {
    expect(etiquetaDeCaja({ fiscalSeries: null, name: "Caja 2" })).toBe("C2");
    expect(etiquetaDeCaja({ fiscalSeries: "   ", name: "Caja 1" })).toBe("C1");
    expect(etiquetaDesdeNombre("Terraza 1")).toBe("T1");
    expect(etiquetaDesdeNombre("caja 12")).toBe("C12");
  });

  it("un nombre sin número no se abrevia a ciegas", () => {
    // Inventarse una inicial para «Barra» y «Bar de arriba» daría la misma
    // etiqueta a dos cajas distintas, que es peor que una etiqueta larga.
    expect(etiquetaDesdeNombre("Barra")).toBe("BARRA");
    expect(etiquetaDesdeNombre("")).toBe("CAJA");
  });
});

describe("hierro-sirope G · cómo se escribe el número", () => {
  it("con una sola caja, el número de siempre", () => {
    expect(numeroConCaja("000001", null)).toBe("000001");
  });

  it("con dos, la caja delante", () => {
    expect(numeroConCaja("000001", "C2")).toBe("C2·000001");
  });
});

describe("hierro-sirope G · la búsqueda", () => {
  it("«000001» busca en TODAS las cajas", () => {
    // Quien teclea un número a secas se lo está leyendo a un cliente por
    // teléfono y no sabe de qué caja es. Devolverle la mitad es la peor
    // respuesta.
    expect(parsearBusquedaDeTicket("000001")).toEqual({
      caja: null,
      numero: "000001",
    });
  });

  it("«C2·000001» acota a esa caja, con cualquier separador", () => {
    for (const q of ["C2·000001", "C2 000001", "C2-000001", "c2/000001"]) {
      expect(parsearBusquedaDeTicket(q)).toEqual({
        caja: "C2",
        numero: "000001",
      });
    }
  });

  it("y lo que no tenga esa forma sale tal cual", () => {
    // Un docNumber de Holded o un externalId no son «caja + número».
    expect(parsearBusquedaDeTicket("FS-2026-0042")).toEqual({
      caja: null,
      numero: "FS-2026-0042",
    });
    expect(
      parsearBusquedaDeTicket("8f14e45f-ceea-467a-9f3a-1b2c3d4e5f60"),
    ).toEqual({
      caja: null,
      numero: "8f14e45f-ceea-467a-9f3a-1b2c3d4e5f60",
    });
  });
});
