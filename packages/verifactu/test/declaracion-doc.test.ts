// declaracion-responsable · docs/legal/declaracion-responsable.md está al día.
//
// El .md es la CUARTA superficie del mismo texto (JSON, PDF, pantalla, doc) y
// la única que no se pinta desde el código en tiempo de ejecución: si se
// escribiera a mano, sería la primera en desincronizarse. Se genera, y este
// test lo vuelve a generar y compara byte a byte.
//
// Sabotajes que este fichero pone en rojo (tabla del done):
//   · editar el .md a mano
//   · cambiar una constante de productor.ts (o el texto de declaracion.ts) sin
//     regenerar el .md
//   · borrar el .md

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  generarMarkdown,
  RUTA_DOC,
} from "../../../scripts/generar-declaracion-responsable.js";
import { PRODUCTOR_NIF, PRODUCTOR_NOMBRE_RAZON } from "../src/productor.js";

describe("docs/legal/declaracion-responsable.md", () => {
  it("es exactamente lo que genera el script", () => {
    const enDisco = readFileSync(RUTA_DOC, "utf8");
    expect(
      enDisco,
      "el .md no coincide con su fuente. Ejecuta `pnpm docs:declaracion`.",
    ).toBe(generarMarkdown());
  });

  it("lleva los datos del productor, los de productor.ts", () => {
    const enDisco = readFileSync(RUTA_DOC, "utf8");
    expect(enDisco).toContain(PRODUCTOR_NOMBRE_RAZON);
    expect(enDisco).toContain(PRODUCTOR_NIF);
  });

  it("lleva los doce apartados y el anexo", () => {
    const enDisco = readFileSync(RUTA_DOC, "utf8");
    for (const clave of [
      "1.a)",
      "1.b)",
      "1.c)",
      "1.d)",
      "1.e)",
      "1.f)",
      "1.g)",
      "1.h)",
      "1.i)",
      "1.j)",
      "1.k)",
      "1.l)",
      "2.a)",
      "2.b)",
    ]) {
      expect(enDisco, `el .md no lleva ${clave}`).toContain(clave);
    }
  });

  it("dice que se genera, para que nadie lo edite a mano", () => {
    expect(readFileSync(RUTA_DOC, "utf8")).toContain("ESTE FICHERO SE GENERA");
  });

  it("no finge una versión ni una fecha del repo", () => {
    // El .md no puede llevar la versión desplegada: es del repo. Si alguien
    // hornea un sha o una fecha aquí, el documento miente en cuanto se
    // despliegue otra cosa.
    const enDisco = readFileSync(RUTA_DOC, "utf8");
    expect(enDisco).toContain("«la versión en ejecución»");
    expect(enDisco).toContain("«la fecha de la versión en ejecución»");
    expect(enDisco).not.toContain("no disponible en esta build");
  });

  it("manda a la copia que vale, la que sirve el sistema", () => {
    // El art. 15 habla del documento DENTRO del sistema informático. Un .md
    // en un repo privado no cumple nada; el fichero tiene que decirlo.
    const enDisco = readFileSync(RUTA_DOC, "utf8");
    expect(enDisco).toContain("/legal/declaracion-responsable");
    expect(enDisco).toContain("/legal/declaracion-responsable.pdf");
  });
});
