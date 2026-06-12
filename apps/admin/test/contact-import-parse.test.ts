// v1.0-pilotos · Lote 6 (#22): parser de archivos del importador de
// clientes (lado admin). CSV propio; el xlsx (exceljs) se valida con
// la cuenta piloto — aquí cubrimos la normalización y los errores.

import { describe, expect, it } from "vitest";

import {
  buildErrorsCsv,
  buildTemplateCsv,
  ContactImportParseError,
  parseCsv,
} from "../src/lib/contactImportParse.js";

describe("parseCsv", () => {
  it("CSV con ';' (Excel español) y cabeceras con acentos", () => {
    const out = parseCsv(
      "Nombre;NIF;Email;Teléfono\r\nMaría García;12345678Z;maria@x.es;600111222\r\nBar Pepe SL;B12345674;;\r\n",
    );
    expect(out.rows).toEqual([
      { name: "María García", nif: "12345678Z", email: "maria@x.es", phone: "600111222" },
      { name: "Bar Pepe SL", nif: "B12345674", email: null, phone: null },
    ]);
    expect(out.skippedEmpty).toBe(0);
  });

  it("CSV con ',' y comillas (nombre con coma y comilla escapada)", () => {
    const out = parseCsv(
      'nombre,nif,email,telefono\n"García, S.L. ""La Buena""",B12345674,info@g.es,912\n',
    );
    expect(out.rows[0]!.name).toBe('García, S.L. "La Buena"');
  });

  it("BOM de Excel no rompe la primera cabecera", () => {
    const out = parseCsv("﻿nombre;nif\nAna;12345678Z\n");
    expect(out.rows[0]!.name).toBe("Ana");
  });

  it("columnas en otro orden y alias (correo, dni, movil)", () => {
    const out = parseCsv("dni;movil;correo;nombre\n12345678Z;600;a@b.es;Ana\n");
    expect(out.rows[0]).toEqual({
      name: "Ana",
      nif: "12345678Z",
      email: "a@b.es",
      phone: "600",
    });
  });

  it("fila sin nombre pero con datos → se omite y se cuenta", () => {
    const out = parseCsv("nombre;nif\nAna;12345678Z\n;B12345674\n");
    expect(out.rows).toHaveLength(1);
    expect(out.skippedEmpty).toBe(1);
  });

  it("sin columna nombre → error claro", () => {
    expect(() => parseCsv("nif;email\n123;a@b.es\n")).toThrow(
      ContactImportParseError,
    );
  });

  it("archivo vacío → error", () => {
    expect(() => parseCsv("")).toThrow(ContactImportParseError);
  });

  it("más de 2.000 filas → error con el recuento", () => {
    const lines = ["nombre"];
    for (let i = 0; i < 2_001; i += 1) lines.push(`c${i}`);
    expect(() => parseCsv(lines.join("\n"))).toThrow(/Máximo 2000|Máximo 2.000/);
  });
});

describe("plantilla y CSV de errores", () => {
  it("la plantilla se puede re-parsear (round-trip)", () => {
    const out = parseCsv(buildTemplateCsv());
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]!.nif).toBe("12345678Z");
  });

  it("el CSV de errores escapa comillas y puntos y coma", () => {
    const csv = buildErrorsCsv([
      { row: 3, name: 'Pepe "El Rápido"; SL', nif: null, reason: "NIF inválido: X" },
    ]);
    expect(csv).toContain('"Pepe ""El Rápido""; SL"');
    expect(csv.split("\r\n")).toHaveLength(2);
  });
});
