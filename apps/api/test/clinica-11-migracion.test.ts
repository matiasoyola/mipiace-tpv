// clinica-11 · EL CONTRATO DEL SQL.
//
// Mismo guardia que `pin-1-migracion.test.ts` y por la misma razón: lo
// que esta migración garantiza vive en el SQL, y si alguien acepta el
// «¿quitar el DEFAULT?» de `prisma migrate dev` el esquema sigue
// pareciendo correcto y lo que se va es el despliegue sin dolor.
//
// Lo que este fichero guarda:
//
//   · la columna nace NOT NULL **con DEFAULT 'MANUAL'**. Las dos cosas a
//     la vez: sin el DEFAULT, un `ALTER TABLE … ADD COLUMN … NOT NULL`
//     sobre una tabla con turnos dentro **falla**, y con la columna
//     nullable habría un tercer estado («no se sabe por qué se abrió»)
//     que no necesita existir;
//   · el DEFAULT es `MANUAL` y no `AUTO_CLINICA`: todos los turnos
//     abiertos hasta hoy los abrió una persona declarando un fondo de
//     caja. Lo contrario sería escribir una mentira en 15 cajas;
//   · la migración es ADITIVA: ni un DROP, ni un UPDATE a las filas de
//     hoy, ni un `ALTER TABLE … DISABLE TRIGGER`;
//   · y que el esquema de Prisma declara lo mismo.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const DIR = path.join(REPO_ROOT, "packages/db/prisma/migrations");
const NOMBRE = "20261029000000_clinica_11_apertura_automatica";
const SQL = readFileSync(path.join(DIR, NOMBRE, "migration.sql"), "utf8");
const SCHEMA = readFileSync(
  path.join(REPO_ROOT, "packages/db/prisma/schema.prisma"),
  "utf8",
);

/** El SQL sin comentarios: lo que de verdad corre. */
function soloSql(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
}
const CODIGO = soloSql(SQL);

describe("la migración de clinica-11", () => {
  it("es UNA sola, y del bloque", () => {
    const mias = readdirSync(DIR).filter((n) => n.includes("clinica_11"));
    expect(mias).toEqual([NOMBRE]);
  });

  it("crea el enum con sus dos valores y ninguno más", () => {
    expect(CODIGO).toMatch(
      /CREATE TYPE "ShiftOpenReason" AS ENUM \('MANUAL', 'AUTO_CLINICA'\)/,
    );
  });

  it("la columna es NOT NULL y trae su DEFAULT 'MANUAL'", () => {
    // Las dos cosas a la vez. Sin DEFAULT, el ADD COLUMN NOT NULL falla
    // sobre una tabla con filas; sin NOT NULL habría un tercer estado que
    // no significa nada.
    const alter = /ADD COLUMN "open_reason" "ShiftOpenReason" NOT NULL DEFAULT 'MANUAL'/;
    expect(CODIGO).toMatch(alter);
  });

  it("el default es MANUAL: lo de ayer lo abrió una persona", () => {
    expect(CODIGO).not.toMatch(/DEFAULT 'AUTO_CLINICA'/);
  });

  it("es aditiva: ni un DROP, ni un UPDATE, ni un trigger apagado", () => {
    expect(CODIGO).not.toMatch(/\bDROP\b/i);
    expect(CODIGO).not.toMatch(/\bUPDATE\b/i);
    expect(CODIGO).not.toMatch(/DISABLE TRIGGER/i);
    expect(CODIGO).not.toMatch(/\bDELETE\b/i);
  });

  it("y toca UNA tabla: `shifts`", () => {
    const tablas = [...CODIGO.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]);
    expect([...new Set(tablas)]).toEqual(["shifts"]);
  });

  it("el esquema de Prisma declara lo mismo", () => {
    expect(SCHEMA).toMatch(/enum ShiftOpenReason \{\s*\n\s*MANUAL\s*\n\s*AUTO_CLINICA\s*\n\}/);
    expect(SCHEMA).toMatch(
      /openReason\s+ShiftOpenReason\s+@default\(MANUAL\) @map\("open_reason"\)/,
    );
  });
});
