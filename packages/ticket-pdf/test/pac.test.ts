// calidad-1 · **EL PAC Y EL SANEADO QUE LO SALVA.**
//
// Dos cosas, y la segunda es la que importa:
//
//   1. el PAC y el informe son el mismo documento con dos niveles de
//      detalle, y la verificación de eficacia **sólo sale en el
//      informe**: el PAC es el plan que se manda fuera;
//   2. **un carácter que la fuente no sabe escribir NO revienta el
//      documento.** `pdf-lib` lanza con `WinAnsi cannot encode "→"`, y
//      el día que eso pasara sería el día en que hay que mandarle el PAC
//      a AENOR.

import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { saneado } from "../src/documento-a4.js";
import { renderPacPdf, type PacParaPdf } from "../src/pac.js";

const require = createRequire(import.meta.url);
const pdfParseCrudo: (
  data: Uint8Array | Buffer,
) => Promise<{ text: string; numpages: number }> = require(
  "pdf-parse/lib/pdf-parse.js",
);
const pdfParse: typeof pdfParseCrudo = (data) =>
  pdfParseCrudo(new Uint8Array(data));

async function texto(datos: PacParaPdf): Promise<string> {
  const bytes = await renderPacPdf(datos);
  const { text } = await pdfParse(Buffer.from(bytes));
  return text.replace(/\s+/g, " ");
}

const BASE: PacParaPdf = {
  modo: "PAC",
  centro: {
    nombre: "Jardín de Gredos, S.A.",
    nif: "A45080173",
    direccion: "Urb. Buen Suceso s/n · 45634 Buenaventura (Toledo)",
  },
  filtro: "1 no conformidad(es) · origen: Auditoría externa",
  generadoEl: "2026-10-23",
  noConformidades: [
    {
      referencia: "NC-2026-01",
      clase: "No conformidad menor",
      origen: "Auditoría externa",
      origenDetalle: "AENOR · informe nº 24",
      proceso: "Calidad, medición y mejora",
      clausula: "4.4.1",
      detectada: "2026-07-21",
      estado: "Con acciones en curso",
      descripcion: "Dos mapas de procesos que no cuadran.",
      causa: "El mapa vive en dos documentos distintos.",
      acciones: [
        {
          que: "Un mapa único en el sistema.",
          responsable: "Calidad",
          plazo: "2026-10-31",
          estado: "Cerrada el 2026-10-28",
          evidencia: "Captura del mapa",
        },
      ],
      verificaciones: [
        {
          fecha: "2026-11-30",
          por: "Pilar",
          resultado: "Eficaz",
          nota: "Tres meses después sigue habiendo un solo mapa.",
        },
      ],
      cerrada: null,
    },
  ],
};

describe("el saneado para WinAnsi", () => {
  it("cambia la flecha por `->` en vez de reventar", () => {
    // El caso real: `sourceNote` de una auditoría interna decía
    // «Calidad → Dirección» y el PAC contestaba 500.
    expect(saneado("Calidad → Dirección")).toBe("Calidad -> Dirección");
  });

  it("y las comillas, los guiones largos y los puntos suspensivos", () => {
    expect(saneado("“esto” y ‘aquello’")).toBe('"esto" y \'aquello\'');
    expect(saneado("uno—dos–tres")).toBe("uno-dos-tres");
    expect(saneado("espera…")).toBe("espera...");
  });

  it("deja intacto lo que la fuente SÍ sabe escribir", () => {
    // Acentos, eñes, el signo de interrogación de apertura y el euro.
    const bueno = "Atención · ¿Qué pasó? · 1.234,56 € · niño";
    expect(saneado(bueno)).toBe(bueno);
  });

  it("y lo que no tiene equivalente sale como `?`, NO desaparece", () => {
    // Un carácter que se borra en silencio de un documento legal es peor
    // que uno que se ve raro: el feo se arregla, el que falta no se ve.
    expect(saneado("riesgo 🔥 alto")).toContain("?");
    expect(saneado("riesgo 🔥 alto")).not.toBe("riesgo  alto");
  });
});

describe("el PAC", () => {
  it("es un PDF de verdad y lleva el filtro impreso", async () => {
    const t = await texto(BASE);
    expect(t).toContain("Plan de acciones correctivas");
    // Un PAC que no dice de qué auditoría es y entre qué fechas es un
    // papel que el año que viene nadie sabe colocar.
    expect(t).toContain("origen: Auditoría externa");
    expect(t).toContain("Generado el 2026-10-23");
    expect(t).toContain("NC-2026-01");
    expect(t).toContain("4.4.1");
    expect(t).toContain("Un mapa único en el sistema.");
    expect(t).toContain("Responsable: Calidad");
  });

  it("**no revienta con una flecha dentro**", async () => {
    const t = await texto({
      ...BASE,
      noConformidades: [
        {
          ...BASE.noConformidades[0]!,
          origenDetalle: "Auditoría interna · Calidad → Dirección",
          descripcion: "El flujo prescribe → prepara → administra se rompe.",
        },
      ],
    });
    expect(t).toContain("Calidad -> Dirección");
    expect(t).toContain("prescribe -> prepara -> administra");
  });

  it("el PAC NO lleva la verificación de eficacia; el informe SÍ", async () => {
    // Lo que se manda fuera es el plan. Un «no eficaz» en el PAC que se
    // entrega sería contar el final antes de llegar.
    const pac = await texto(BASE);
    expect(pac).not.toContain("Eficacia");
    expect(pac).not.toContain("Tres meses después");

    const informe = await texto({ ...BASE, modo: "INFORME" });
    expect(informe).toContain("Informe de no conformidades");
    expect(informe).toContain("Tres meses después");
    // Y el recuento del periodo, que en el PAC estorba.
    expect(informe).toContain("Resumen del periodo");
    expect(informe).toContain("Por clase");
  });

  it("y un filtro sin resultados IMPRIME IGUAL", async () => {
    // Un PAC vacío es un documento válido —«no hay hallazgos abiertos de
    // esta auditoría»— y no imprimirlo obligaría a la dirección a
    // explicarlo de palabra, que es lo que este bloque viene a quitar.
    const t = await texto({ ...BASE, noConformidades: [] });
    expect(t).toContain("No hay ninguna no conformidad que cumpla este filtro");
  });
});
