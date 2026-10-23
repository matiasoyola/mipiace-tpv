// alta-minima · LOS NOMBRES DEL LISTADO Y EL PEGADO DE «AÑADIR VARIOS».
//
// Tres cosas y sus bordes:
//
//   · `claveDeNombre`, que es lo que decide si un nombre YA EXISTE. Si
//     esto y el servidor no coincidieran, la vista previa mentiría.
//   · `enFormatoDeNombre`, que es sólo para enseñar.
//   · `lineasPegadas`, con los sabotajes del bloque dentro: líneas
//     vacías, tabuladores sueltos y repetidos en el mismo pegado.

import { describe, expect, it } from "vitest";

import {
  claveDeNombre,
  enFormatoDeNombre,
  lineasPegadas,
} from "../src/nombres.js";

describe("alta-minima · `claveDeNombre`", () => {
  it("sin tildes, sin mayúsculas y sin dobles espacios", () => {
    expect(claveDeNombre("ABEL RAMOS DOBLADO")).toBe("ABEL RAMOS DOBLADO");
    expect(claveDeNombre("Abel Ramos Doblado")).toBe("ABEL RAMOS DOBLADO");
    expect(claveDeNombre("  Abel   Ramos  Doblado ")).toBe("ABEL RAMOS DOBLADO");
    expect(claveDeNombre("ABEL RÁMOS DÓBLADO")).toBe("ABEL RAMOS DOBLADO");
  });

  it("la Ñ y la Ü también · una tabla de `á→a` se las habría comido", () => {
    expect(claveDeNombre("Begoña Agüero")).toBe(claveDeNombre("BEGONA AGUERO"));
    expect(claveDeNombre("MUÑOZ")).toBe("MUNOZ");
  });

  it("el mismo nombre escrito de dos maneras da UNA clave", () => {
    expect(claveDeNombre("Mª ÁNGELES  LÓPEZ")).toBe(
      claveDeNombre("mª angeles lopez"),
    );
  });

  it("NO adivina el orden de los apellidos · son dos personas", () => {
    // Deliberado (decisión 7): fusionar a dos residentes por un apellido
    // parecido parte dos historias clínicas. Un duplicado que se cuela se
    // arregla en la ficha.
    expect(claveDeNombre("RAMOS DOBLADO, ABEL")).not.toBe(
      claveDeNombre("ABEL RAMOS DOBLADO"),
    );
  });
});

describe("alta-minima · `enFormatoDeNombre`", () => {
  it("«ABEL RAMOS DOBLADO» → «Abel Ramos Doblado»", () => {
    expect(enFormatoDeNombre("ABEL RAMOS DOBLADO")).toBe("Abel Ramos Doblado");
  });

  it("las partículas se quedan en minúscula", () => {
    expect(enFormatoDeNombre("ABEL DE LA FUENTE")).toBe("Abel de la Fuente");
    expect(enFormatoDeNombre("MARIA DEL CARMEN RUIZ")).toBe(
      "Maria del Carmen Ruiz",
    );
  });

  it("pero la PRIMERA palabra sí, aunque sea una partícula", () => {
    expect(enFormatoDeNombre("DEL RIO MUÑOZ")).toBe("Del Rio Muñoz");
  });

  it("un nombre escrito a mano NO se toca", () => {
    // Convertirlo haría «de la Torre» → «De La Torre», que está peor que
    // el original.
    expect(enFormatoDeNombre("Mª Ángeles de la Torre")).toBe(
      "Mª Ángeles de la Torre",
    );
    expect(enFormatoDeNombre("Abel Ramos Doblado")).toBe("Abel Ramos Doblado");
  });

  it("los dobles espacios se cierran igual", () => {
    expect(enFormatoDeNombre("  ABEL   RAMOS  ")).toBe("Abel Ramos");
  });

  it("vacío es vacío, sin reventar", () => {
    expect(enFormatoDeNombre("")).toBe("");
    expect(enFormatoDeNombre("   ")).toBe("");
  });
});

describe("alta-minima · `lineasPegadas` · el caso de Jardín de Gredos", () => {
  it("una columna de nombres, tal como sale de Excel", () => {
    const r = lineasPegadas("ABEL RAMOS DOBLADO\nBEGOÑA AGÜERO\nCARMEN DEL RIO\n");
    expect(r.lineas.map((l) => l.nombre)).toEqual([
      "ABEL RAMOS DOBLADO",
      "BEGOÑA AGÜERO",
      "CARMEN DEL RIO",
    ]);
    expect(r.lineas.every((l) => l.placeType == null)).toBe(true);
    expect(r.rotas).toEqual([]);
    expect(r.repetidasEnElPegado).toEqual([]);
  });

  it("dos columnas: el tipo de plaza detrás de un TABULADOR", () => {
    const r = lineasPegadas("ABEL RAMOS\tCONCERTADA\nBEGOÑA AGÜERO\tprivada");
    expect(r.lineas.map((l) => [l.nombre, l.placeType])).toEqual([
      ["ABEL RAMOS", "CONCERTADA"],
      ["BEGOÑA AGÜERO", "PRIVADA"],
    ]);
  });

  it("los tres finales de línea · Excel en Windows trae `\\r\\n`", () => {
    expect(lineasPegadas("A\r\nB\rC\nD").lineas.map((l) => l.nombre)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
  });

  it("SABOTAJE · las líneas vacías se ignoran en silencio", () => {
    // Copiar una columna arrastra la línea en blanco del final casi
    // siempre. Contestar «la 44 está vacía» a quien pegó bien 43 enseña a
    // no leer los avisos.
    const r = lineasPegadas("\n\nABEL RAMOS\n\n   \nBEGOÑA AGÜERO\n\n");
    expect(r.lineas.map((l) => l.nombre)).toEqual(["ABEL RAMOS", "BEGOÑA AGÜERO"]);
    expect(r.rotas).toEqual([]);
  });

  it("SABOTAJE · un tabulador con PLAZA y sin nombre se cuenta como roto", () => {
    // Ahí hay una celda que alguien creía que tenía algo.
    const r = lineasPegadas("ABEL RAMOS\n\tCONCERTADA\nBEGOÑA AGÜERO");
    expect(r.lineas.map((l) => l.nombre)).toEqual(["ABEL RAMOS", "BEGOÑA AGÜERO"]);
    expect(r.rotas.map((x) => x.numero)).toEqual([2]);
    expect(r.rotas[0]!.motivo).toContain("no trae nombre");
  });

  it("SABOTAJE · una línea de SÓLO tabuladores se ignora, no se delata", () => {
    // Es una fila vacía de Excel con dos columnas, no una celda que
    // alguien creyera llena: la diferencia con el caso de arriba es que
    // aquí no hay NADA que avisar. Delatarla sería el mismo aviso inútil
    // que delatar la línea en blanco del final.
    const r = lineasPegadas("ABEL RAMOS\n\t\t\n \t \nBEGOÑA AGÜERO");
    expect(r.lineas.map((l) => l.nombre)).toEqual(["ABEL RAMOS", "BEGOÑA AGÜERO"]);
    expect(r.rotas).toEqual([]);
  });

  it("y el número de línea es el REAL, contando las vacías", () => {
    // Para que el mensaje mande a la dirección a la línea que ve en su
    // Excel, no a la que quedó después de filtrar.
    const r = lineasPegadas("\n\n\tPRIVADA");
    expect(r.rotas[0]!.numero).toBe(3);
  });

  it("SABOTAJE · repetido DENTRO del mismo pegado: se queda el primero", () => {
    const r = lineasPegadas(
      "ABEL RAMOS\tCONCERTADA\nBEGOÑA AGÜERO\nabel  ramos\nABEL RÁMOS\tPRIVADA",
    );
    expect(r.lineas.map((l) => l.nombre)).toEqual(["ABEL RAMOS", "BEGOÑA AGÜERO"]);
    expect(r.repetidasEnElPegado.map((l) => l.numero)).toEqual([3, 4]);
    // El primero manda, con SU tipo de plaza.
    expect(r.lineas[0]!.placeType).toBe("CONCERTADA");
  });

  it("pegar nada no es un error", () => {
    expect(lineasPegadas("")).toEqual({
      lineas: [],
      rotas: [],
      repetidasEnElPegado: [],
    });
  });

  it("la clave viaja con la línea · es la que casa con lo que ya existe", () => {
    expect(lineasPegadas("ABEL RÁMOS").lineas[0]!.clave).toBe("ABEL RAMOS");
  });
});
