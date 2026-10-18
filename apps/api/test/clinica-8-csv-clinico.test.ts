// clinica-8 · LAS CUATRO COLUMNAS QUE DEJAN LA CLÍNICA LISTA PARA COBRAR.
//
// `catalogo-servicios-csv` dejó fuera las marcas de clínica a propósito
// («nacen en su default y se ponen en el panel»). La auditoría del 18-10
// midió lo que eso significa en el hierro: el CSV de Rosario cargado, los
// 17 servicios exentos y reservables, y la primera sesión cerrando a
// 0,00 € con «no hay servicio en su categoría». El catálogo estaba; la
// clínica no podía cobrar.
//
// Lo que este banco fija:
//
//   1. el CSV REAL de Rosario entra con sus cinco categorías tipadas, sus
//      tres niveles y su primera valoración;
//   2. el fichero de La Maestranza —que no trae ninguna de las cuatro—
//      entra exactamente igual que antes de este bloque;
//   3. y cada negativa dice qué arreglar: un nivel repetido, una categoría
//      que se contradice, un nivel fuera de la quiropodia, un sí/no que no
//      lo es, y las cuatro columnas en una fila de PRODUCTO.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseCatalogoCsv } from "../src/catalog/csv-catalogo.js";

const CSV_ROSARIO = fileURLToPath(
  new URL("../../../docs/implantaciones/rosario/catalogo-tpv.csv", import.meta.url),
);
const CSV_MAESTRANZA = fileURLToPath(
  new URL(
    "../../../docs/implantaciones/maestranza/catalogo-tpv.csv",
    import.meta.url,
  ),
);

const CABECERA =
  "sku,nombre,precio_con_iva,iva,categoria,tipo,exencion,duracion_min," +
  "tipo_visita,primera_valoracion,tratamiento_sesion,nivel_quiropodia";

function unaFila(resto: string): ReturnType<typeof parseCatalogoCsv> {
  return parseCatalogoCsv(`${CABECERA}\n${resto}`);
}

describe("clinica-8 · el CSV real de Rosario, con las marcas de clínica", () => {
  const r = parseCatalogoCsv(readFileSync(CSV_ROSARIO, "utf8"));

  it("entran las 17 filas y no se salta ninguna", () => {
    expect(r.malas).toEqual([]);
    expect(r.buenas).toHaveLength(17);
  });

  it("las cinco categorías salen con su tipo de visita", () => {
    // Es el mapa que hace que la sesión ofrezca la tarjeta de cada tipo.
    // Sin él, los 17 servicios entran y la sesión no ofrece ninguna.
    expect(new Map(r.tiposDeVisita.map((t) => [t.slug, t.visitType]))).toEqual(
      new Map([
        ["consulta", "GENERAL"],
        ["quiropodia", "QUIROPODIA"],
        ["cirugía", "CIRUGIA"],
        ["biomecánica", "BIOMECANICA"],
        ["órtesis", "GENERAL"],
      ]),
    );
  });

  it("los TRES niveles de quiropodia, uno por servicio", () => {
    const niveles = r.buenas
      .filter((f) => f.clinica?.nivelQuiropodia != null)
      .map((f) => [f.fields.sku, f.clinica!.nivelQuiropodia]);
    expect(niveles).toEqual([
      ["POD-002", 1],
      ["POD-003", 2],
      ["POD-004", 3],
    ]);
  });

  it("y una primera valoración, que es con la que se cita la primera visita", () => {
    const primeras = r.buenas
      .filter((f) => f.clinica?.primeraValoracion)
      .map((f) => f.fields.sku);
    expect(primeras).toEqual(["POD-001"]);
  });

  it("los tratamientos de la sesión son los 16 que no son la valoración", () => {
    expect(r.buenas.filter((f) => f.clinica?.tratamientoSesion)).toHaveLength(16);
  });
});

describe("clinica-8 · el fichero de ayer entra IGUAL", () => {
  it("el CSV real de La Maestranza no trae ninguna de las cuatro y se carga entero", () => {
    // La misma promesa que `catalogo-servicios-csv` hizo con sus tres
    // columnas, y por la misma razón: un bloque que invalide los CSV de
    // ayer obliga a rehacerlos antes de poder usar nada.
    const r = parseCatalogoCsv(readFileSync(CSV_MAESTRANZA, "utf8"));
    expect(r.malas).toEqual([]);
    expect(r.buenas.length).toBeGreaterThan(100);
    expect(r.tiposDeVisita).toEqual([]);
    expect(r.buenas.every((f) => f.clinica === null)).toBe(true);
  });
});

describe("clinica-8 · lo que el fichero NO deja pasar", () => {
  it("dos servicios que dicen ser el MISMO nivel: la segunda fila se queda fuera", () => {
    // El índice único parcial de clinica-5 lo rechazaría al escribir, y
    // la carga es todo o nada: no entraría ni una fila. Decirlo en la
    // vista previa es la diferencia entre arreglar una celda y no saber
    // por qué no entra nada.
    const r = unaFila(
      "A-1,Quiropodia básica,25,0,quiropodia,SERVICE,,30,QUIROPODIA,no,si,2\n" +
        "A-2,Quiropodia completa,26,0,quiropodia,SERVICE,,30,QUIROPODIA,no,si,2",
    );
    expect(r.buenas.map((f) => f.fields.sku)).toEqual(["A-1"]);
    expect(r.malas[0]!.motivo).toContain("El nivel 2 de quiropodia ya es el de la línea 2");
  });

  it("una categoría que se contradice entre dos filas: la segunda se queda fuera", () => {
    const r = unaFila(
      "A-1,Cura,13,0,cirugía,SERVICE,,15,CIRUGIA,no,si,\n" +
        "A-2,Quiropodia,25,0,cirugía,SERVICE,,30,QUIROPODIA,no,si,",
    );
    expect(r.buenas.map((f) => f.fields.sku)).toEqual(["A-1"]);
    expect(r.malas[0]!.motivo).toContain(
      'La categoría "cirugía" ya es CIRUGIA en la línea 2',
    );
    // Y el mapa se queda con el primero: una categoría, un tipo.
    expect(r.tiposDeVisita).toEqual([{ slug: "cirugía", visitType: "CIRUGIA" }]);
  });

  it("un nivel de quiropodia en una categoría que NO es quiropodia", () => {
    // Es la tercera negativa de S5 (`NIVEL_SIN_QUIROPODIA`), dicha en la
    // vista previa en vez de llegar como un 409 con el fichero a medias.
    const r = unaFila("A-1,Cura,13,0,cirugía,SERVICE,,15,CIRUGIA,no,si,2");
    expect(r.buenas).toEqual([]);
    expect(r.malas[0]!.motivo).toContain(
      "Un nivel de quiropodia sólo vale en un servicio de quiropodia",
    );
  });

  it("un tipo de visita que no existe", () => {
    const r = unaFila("A-1,Masaje,30,0,masajes,SERVICE,,30,PODOLOGIA,no,si,");
    expect(r.malas[0]!.motivo).toContain('El tipo de visita "PODOLOGIA" no vale');
  });

  it("un nivel que no es 1, 2 ni 3", () => {
    const r = unaFila("A-1,Quiropodia,25,0,quiropodia,SERVICE,,30,QUIROPODIA,no,si,4");
    expect(r.malas[0]!.motivo).toContain('El nivel de quiropodia "4" no vale');
  });

  it("un sí/no que no es ni una cosa ni la otra NO se lee como «no»", () => {
    // «tratamiento_sesion = nop» leído como «no» es un botón que no sale
    // en la sesión y nadie sabe por qué.
    const r = unaFila("A-1,Quiropodia,25,0,quiropodia,SERVICE,,30,QUIROPODIA,no,nop,");
    expect(r.buenas).toEqual([]);
    expect(r.malas[0]!.motivo).toContain("no es un sí ni un no en tratamiento_sesion");
  });

  it("las cuatro columnas en una fila de PRODUCTO rechazan la fila", () => {
    // Una crema no es el nivel de nada. Callarlo dejaría al implantador
    // creyendo que ha configurado la quiropodia.
    const r = unaFila("CRE-1,Crema urea,12,21,mostrador,PRODUCT,,,,no,si,");
    expect(r.buenas).toEqual([]);
    expect(r.malas[0]!.motivo).toContain("son de servicios");
  });

  it("un tipo de visita sin categoría en la fila", () => {
    const r = unaFila("A-1,Quiropodia,25,0,,SERVICE,,30,QUIROPODIA,no,si,");
    expect(r.malas[0]!.motivo).toContain("El tipo de visita es de la CATEGORÍA");
  });
});

describe("clinica-8 · las formas de escribir un sí y un no", () => {
  it.each([
    ["si", true],
    ["sí", true],
    ["SI", true],
    ["x", true],
    ["1", true],
    ["true", true],
    ["no", false],
    ["0", false],
    ["", false],
  ])("«%s» → %s", (valor, esperado) => {
    const r = unaFila(
      `A-1,Consulta,20,0,consulta,SERVICE,,20,GENERAL,${valor},si,`,
    );
    expect(r.buenas[0]!.clinica!.primeraValoracion).toBe(esperado);
  });

  it("y el vacío es «no», que es el default de la columna en la base", () => {
    // Pero la fila SÍ trae marcas (el tipo de visita), así que `clinica`
    // no es `null`: lo que se escribe es `false`, no «no me lo han dicho».
    const r = unaFila("A-1,Consulta,20,0,consulta,SERVICE,,20,GENERAL,,,");
    expect(r.buenas[0]!.clinica).toEqual({
      primeraValoracion: false,
      tratamientoSesion: false,
      nivelQuiropodia: null,
    });
  });
});
