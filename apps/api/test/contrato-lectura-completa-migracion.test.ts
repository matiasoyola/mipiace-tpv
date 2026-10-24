// contrato-lectura-completa · EL CONTRATO DEL SQL DE LA COLUMNA NUEVA.
//
// Mismo guardia que `residencia-migracion.test.ts` y por la misma razón:
// lo que esta migración garantiza vive en el SQL, y Prisma no sabe
// declararlo. Si alguien acepta el «¿añadir NOT NULL?» de
// `prisma migrate dev`, el esquema sigue pareciendo correcto y la
// invariante se va sin que nada se ponga rojo.
//
// Lo que este fichero guarda:
//
//   · la columna es NULLABLE y sin DEFAULT — es lo que deja las
//     aceptaciones ya guardadas sin tocar y sin inventarse que no se
//     leyeron;
//   · el CHECK de coherencia existe y está escrito con `IS NULL` /
//     `IS NOT NULL`, no con `=`: un CHECK que evalúa a NULL PASA, así que
//     una comparación sobre una columna nula no cierra nada;
//   · la migración es ADITIVA: ni un DROP, ni un UPDATE a las filas de
//     hoy, ni un `ALTER TABLE ... DISABLE TRIGGER`;
//   · y que el esquema de Prisma declara lo mismo.
//
// Lo que NO se puede guardar desde aquí: que el CHECK y el trigger se
// cumplan de verdad contra Postgres. Eso se midió a mano en la pasada del
// bloque (los cinco casos están en el `-done`).

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
const NOMBRE = "20261024010000_contrato_lectura_completa";
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

describe("la migración de contrato-lectura-completa", () => {
  it("es UNA sola, y del bloque", () => {
    const mias = readdirSync(DIR).filter((n) =>
      n.includes("contrato_lectura_completa"),
    );
    expect(mias).toEqual([NOMBRE]);
  });

  it("añade `texto_recorrido_en` NULLABLE y SIN DEFAULT", () => {
    expect(CODIGO).toContain(
      'ADD COLUMN "texto_recorrido_en" TIMESTAMPTZ',
    );
    // Lo que NO puede llevar. Un `DEFAULT false` (o un NOT NULL, que lo
    // exigiría) escribiría en las aceptaciones de hoy «no recorrió el
    // texto», y eso no se sabe: cuando se aceptaron, nadie lo medía.
    expect(CODIGO).not.toMatch(/texto_recorrido_en[^;]*NOT NULL/);
    expect(CODIGO).not.toMatch(/texto_recorrido_en[^;]*DEFAULT/);
  });

  it("el CHECK de coherencia existe y no se escribe con `=`", () => {
    expect(CODIGO).toContain(
      'CONSTRAINT "clinical_processor_agreements_recorrido_coherente"',
    );
    const check = CODIGO.slice(CODIGO.indexOf("recorrido_coherente"));
    const hasta = check.slice(0, check.indexOf(";"));
    // Todas las ramas con `IS NULL` / `IS NOT NULL`: un CHECK que da NULL
    // pasa, así que `"texto_recorrido_en" = NULL` no cerraría nada.
    expect(hasta).toContain('"texto_recorrido_en" IS NULL');
    expect(hasta).toContain('"revokes_agreement_id" IS NOT NULL');
    expect(hasta).not.toMatch(/"texto_recorrido_en"\s*=/);
  });

  it("es ADITIVA: no borra, no reescribe filas y no apaga el trigger", () => {
    expect(CODIGO).not.toMatch(/\bDROP\b/);
    expect(CODIGO).not.toMatch(/\bUPDATE\b/);
    expect(CODIGO).not.toMatch(/\bDELETE\b/);
    // El trigger de solo-inserción de la tabla no se toca: un ADD COLUMN
    // nullable es DDL y no despierta un trigger FOR EACH ROW.
    expect(CODIGO).not.toMatch(/DISABLE TRIGGER/);
  });

  it("y el esquema de Prisma declara lo mismo", () => {
    const modelo = SCHEMA.slice(
      SCHEMA.indexOf("model ClinicalProcessorAgreement"),
    );
    const hasta = modelo.slice(0, modelo.indexOf("\n}"));
    expect(hasta).toContain(
      'textoRecorridoEn DateTime? @map("texto_recorrido_en") @db.Timestamptz()',
    );
  });
});
