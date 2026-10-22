// residencia-6 (D-68) · EL CONTRATO DEL SQL, leído del fichero.
//
// Hermano de `residencia-3/4/5-migracion.test.ts` y con el mismo encargo:
// no prueba «que la migración corra» —eso lo hace el e2e, que la aplica—
// sino **lo que promete**.
//
// Una columna, y aun así hay cuatro cosas que fijar:
//
//   · que es **ADITIVA**: una columna con DEFAULT y un CHECK. Ni un
//     `DROP`, ni un `DELETE`, ni un `UPDATE … SET` sobre datos;
//   · que el único `ALTER TABLE` nombra **`care_pins` y nada más**;
//   · que la columna es **`NOT NULL` con DEFAULT 4**, porque el default
//     es la decisión: las filas que ya estaban se quedan de cuatro y una
//     DUE que ya tuviera PIN queda «por renovar». El lado seguro;
//   · que el CHECK lleva su **`IS NOT NULL` delante del `BETWEEN`** — un
//     CHECK que da NULL *pasa*, y es la lección que residencia-2 pagó en
//     `care_plan_items`;
//   · y que **no se guarda nada derivado de los dígitos** del PIN: ni una
//     columna de prefijo, ni un índice por él. Eso es la mitad de D-68 y
//     es lo que un bloque futuro podría añadir «para buscar más rápido»
//     sin darse cuenta de que anula la decisión.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "packages",
  "db",
  "prisma",
  "migrations",
);

const PIN = readFileSync(
  join(RAIZ, "20261020000000_residencia_6_pin_por_alcance", "migration.sql"),
  "utf8",
);

/** El SQL sin comentarios: el `down` va comentado en la cabecera y lleva
 *  `DROP COLUMN` dentro. */
function soloSql(texto: string): string {
  return texto
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
}

const SQL = soloSql(PIN);

describe("la migración del PIN por alcance es ADITIVA", () => {
  it("ni un DROP, ni un DELETE, ni un TRUNCATE", () => {
    expect(SQL).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(SQL).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(SQL).not.toMatch(/\bTRUNCATE\b/i);
    expect(SQL).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it("y ni un UPDATE sobre datos", () => {
    // El `DEFAULT` rellena las filas que ya estaban; un `UPDATE … SET`
    // aquí sería alguien decidiendo a mano el largo de un PIN que no
    // puede leer.
    expect(SQL).not.toMatch(/\bUPDATE\s+"?care_pins"?\s+SET\b/i);
  });

  it("el único ALTER TABLE es sobre `care_pins`", () => {
    const tablas = [...SQL.matchAll(/ALTER\s+TABLE\s+"([a-z_]+)"/gi)].map(
      (m) => m[1],
    );
    expect(tablas.length).toBeGreaterThan(0);
    expect([...new Set(tablas)]).toEqual(["care_pins"]);
  });
});

describe("la columna `pin_length`", () => {
  it("es NOT NULL con DEFAULT 4", () => {
    // El DEFAULT **es** la decisión: lo que ya estaba se puso cuando el
    // único largo era cuatro, así que a una DUE con PIN le queda «por
    // renovar» y no entra. El otro lado —asumir que estaban bien— es
    // dejar entrar con cuatro cifras a quien lo ve todo.
    expect(SQL).toMatch(
      /ADD\s+COLUMN\s+"pin_length"\s+integer\s+NOT\s+NULL\s+DEFAULT\s+4/i,
    );
  });

  it("y su CHECK lleva el IS NOT NULL DELANTE del BETWEEN", () => {
    // Un CHECK que se evalúa a NULL **pasa**. La columna es `NOT NULL`,
    // así que hoy no puede darse; el `IS NOT NULL` escrito es lo que hace
    // que siga siendo verdad si mañana alguien la hace opcional.
    const check = SQL.match(
      /ADD\s+CONSTRAINT\s+"care_pins_pin_length_valido"\s+CHECK\s*\(([\s\S]*?)\)\s*;/i,
    );
    expect(check, "no está el CHECK del largo").not.toBeNull();
    const cuerpo = check![1]!;
    expect(cuerpo).toMatch(/"pin_length"\s+IS\s+NOT\s+NULL/i);
    expect(cuerpo).toMatch(/"pin_length"\s+BETWEEN\s+4\s+AND\s+8/i);
    // Y en ese orden: el `IS NOT NULL` detrás de un `OR` no protege nada.
    expect(cuerpo.indexOf("IS NOT NULL")).toBeLessThan(
      cuerpo.indexOf("BETWEEN"),
    );
    expect(cuerpo).not.toMatch(/\bOR\b/i);
  });
});

describe("NADA derivado de los dígitos del PIN (la mitad de D-68)", () => {
  it("no hay columna ni índice de prefijo", () => {
    // Una huella de los cuatro primeros dígitos de un PIN de seis
    // reduciría el ataque a 10 000 + 100 combinaciones y anularía la
    // decisión. Esto está aquí para que la idea no entre «para buscar más
    // rápido» en un bloque futuro.
    for (const prohibido of [
      "prefijo",
      "prefix",
      "pin_prefix",
      "pin_prefijo",
      "lookup_corto",
      "primeros",
    ]) {
      expect(SQL.toLowerCase(), prohibido).not.toContain(prohibido);
    }
  });

  it("la única columna nueva es `pin_length`", () => {
    const columnas = [...SQL.matchAll(/ADD\s+COLUMN\s+"([a-z_]+)"/gi)].map(
      (m) => m[1],
    );
    expect(columnas).toEqual(["pin_length"]);
  });
});

describe("el `down` está escrito, y es completo", () => {
  it("está en la cabecera, comentado, y nombra el CHECK y la columna", () => {
    expect(PIN).toContain("EL `down`");
    expect(PIN).toContain('DROP CONSTRAINT "care_pins_pin_length_valido"');
    expect(PIN).toContain('DROP COLUMN "pin_length"');
  });
});
