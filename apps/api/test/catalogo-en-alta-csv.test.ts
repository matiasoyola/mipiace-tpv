// catalogo-en-alta · el fichero de catálogo, leído.
//
// Lo que se prueba aquí es la **vista previa**: qué entra, qué no y con
// qué motivo. Importa porque es lo único que el implantador va a mirar
// antes de confirmar, delante del dueño, y porque una fila que entra
// callada con el precio mal se descubre cobrando.
//
// El caso que justifica el parser propio está en el primer test: el
// catálogo real de La Maestranza trae
//
//     CAF-007,"Infusión (manzanilla, poleo, tila…)",1.60,10,cafés
//
// y con `split(",")` esa línea tiene seis campos y precio `poleo`.

import { describe, expect, it } from "vitest";

import {
  CsvInvalidoError,
  parseCatalogoCsv,
  parseCsvLine,
} from "../src/catalog/csv-catalogo.js";

const CABECERA = "sku,nombre,precio_con_iva,iva,categoria";

function csv(...filas: string[]): string {
  return [CABECERA, ...filas].join("\n");
}

describe("catalogo-en-alta · partir una línea", () => {
  it("un nombre entrecomillado con comas dentro es UN campo", () => {
    expect(parseCsvLine('CAF-007,"Infusión (manzanilla, poleo, tila…)",1.60,10,cafés')).toEqual([
      "CAF-007",
      "Infusión (manzanilla, poleo, tila…)",
      "1.60",
      "10",
      "cafés",
    ]);
  });

  it("dos comillas seguidas dentro del campo son una comilla", () => {
    expect(parseCsvLine('A,"Vino ""Reserva""",10,21,vinos')).toEqual([
      "A",
      'Vino "Reserva"',
      "10",
      "21",
      "vinos",
    ]);
  });

  it("un campo vacío es un campo, no una ausencia", () => {
    expect(parseCsvLine("A,,1,10,")).toEqual(["A", "", "1", "10", ""]);
  });
});

describe("catalogo-en-alta · el fichero entero", () => {
  it("lee la fila buena y convierte el precio a neto", () => {
    const { buenas, malas } = parseCatalogoCsv(csv("CAF-001,Café con leche,1.60,10,cafés"));
    expect(malas).toEqual([]);
    expect(buenas).toHaveLength(1);
    expect(buenas[0]).toMatchObject({
      linea: 2,
      precioConIva: 1.6,
      fields: {
        sku: "CAF-001",
        name: "Café con leche",
        basePrice: 1.4545,
        taxRate: 10,
        tags: ["cafés"],
        kind: "PRODUCT",
        active: true,
      },
    });
  });

  it("la coma decimal entrecomillada vale: es lo que escribe un Excel español", () => {
    const { buenas } = parseCatalogoCsv(csv('A-1,Caña,"2,50",10,cervezas'));
    expect(buenas[0]?.precioConIva).toBe(2.5);
    expect(buenas[0]?.fields.basePrice).toBe(2.2727);
  });

  it("la coma decimal SIN comillas no entra: desplazaría todas las columnas", () => {
    // El caso que encontró este test y que vale el fichero entero:
    // `2,50` sin comillas son dos campos, así que leído por posición
    // sale un producto válido de 2 € al 50 % de IVA con la categoría
    // "10". Válido, callado y mal cobrado en todas las filas.
    const { buenas, malas } = parseCatalogoCsv(csv("A-1,Caña,2,50,10,cervezas"));
    expect(buenas).toEqual([]);
    expect(malas[0]?.motivo).toContain("6 columnas");
    expect(malas[0]?.motivo).toContain('entrecomíllalo ("2,50")');
  });

  it("una fila a la que le FALTA una columna tampoco entra", () => {
    const { buenas, malas } = parseCatalogoCsv(csv("A-1,Caña,2.50,10"));
    expect(buenas).toEqual([]);
    expect(malas[0]?.motivo).toContain("4 columnas");
  });

  it("el separador de miles NO se adivina: se rechaza con su motivo", () => {
    // `1.234` puede ser mil doscientos treinta y cuatro o uno con 234.
    // Un precio adivinado se cobra.
    const { buenas, malas } = parseCatalogoCsv(csv('V-1,Caja de vino,"1.234,50",21,vinos'));
    expect(buenas).toEqual([]);
    expect(malas[0]?.motivo).toContain("no es un número");
  });

  it("sin SKU no entra: es la llave del casamiento con Holded", () => {
    const { buenas, malas } = parseCatalogoCsv(csv(",Sin referencia,2.00,10,raciones"));
    expect(buenas).toEqual([]);
    expect(malas[0]).toMatchObject({ linea: 2, motivo: "El SKU es obligatorio." });
  });

  it("un SKU con espacios dentro no entra", () => {
    const { malas } = parseCatalogoCsv(csv("CAF 001,Café,1.60,10,cafés"));
    expect(malas[0]?.motivo).toContain("no puede llevar espacios");
  });

  it("repetido en el MISMO fichero: entra el primero y el motivo dice dónde estaba", () => {
    const { buenas, malas } = parseCatalogoCsv(
      csv("CAF-001,Café con leche,1.60,10,cafés", "CAF-001,Otro precio,1.70,10,cafés"),
    );
    expect(buenas).toHaveLength(1);
    expect(buenas[0]?.precioConIva).toBe(1.6);
    expect(malas[0]).toMatchObject({ linea: 3 });
    expect(malas[0]?.motivo).toContain("ya está en la línea 2");
  });

  it("el IVA fuera de rango no entra", () => {
    const { malas } = parseCatalogoCsv(csv("X-1,Imposible,3.00,150,raciones"));
    expect(malas[0]?.motivo).toContain("entre 0 y 100");
  });

  it("varias categorías separadas por punto y coma", () => {
    const { buenas } = parseCatalogoCsv(csv("R-1,Patatas alioli,6.00,10,raciones;para compartir"));
    expect(buenas[0]?.fields.tags).toEqual(["raciones", "para compartir"]);
  });

  it("las líneas en blanco se ignoran y no desplazan el número de línea", () => {
    const { buenas } = parseCatalogoCsv(
      [CABECERA, "", "A-1,Uno,1.00,10,x", "", "B-1,Dos,2.00,10,x"].join("\n"),
    );
    expect(buenas.map((b) => b.linea)).toEqual([3, 5]);
  });

  it("el BOM del Excel de Windows no rompe la cabecera", () => {
    const { buenas } = parseCatalogoCsv("﻿" + csv("A-1,Uno,1.00,10,x"));
    expect(buenas).toHaveLength(1);
  });

  it("otra cabecera es un fichero equivocado, no 128 filas malas", () => {
    // Un CSV de contactos subido por error tiene que decir "has subido
    // otra cosa", no enseñar una vista previa con todo en rojo.
    expect(() => parseCatalogoCsv("nombre,nif,email\nPepe,12345678Z,p@p.es")).toThrow(
      CsvInvalidoError,
    );
    try {
      parseCatalogoCsv("nombre,nif,email\nPepe,12345678Z,p@p.es");
    } catch (err) {
      expect((err as Error).message).toContain("sku");
    }
  });

  it("sólo la cabecera: no hay nada que cargar", () => {
    expect(() => parseCatalogoCsv(CABECERA)).toThrow(CsvInvalidoError);
  });

  it("el fichero vacío no es una carga de cero productos", () => {
    expect(() => parseCatalogoCsv("   ")).toThrow(CsvInvalidoError);
  });
});
