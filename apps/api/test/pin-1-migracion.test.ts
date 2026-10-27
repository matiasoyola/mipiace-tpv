// pin-1 · EL CONTRATO DEL SQL.
//
// Mismo guardia que `contrato-lectura-completa-migracion.test.ts` y por
// la misma razón: lo que esta migración garantiza vive en el SQL, y
// Prisma no sabe declararlo. Si alguien acepta el «¿añadir NOT NULL?» o
// el «¿poner un DEFAULT?» de `prisma migrate dev`, el esquema sigue
// pareciendo correcto y lo que se va es el despliegue sin dolor.
//
// Lo que este fichero guarda:
//
//   · `pin_provisional_at` es NULLABLE y **sin DEFAULT** — es lo que
//     deja los PIN de hoy valiendo como PROPIOS. Un `DEFAULT now()`
//     obligaría a 21 personas de una residencia y a la barra entera de
//     un bar a elegir PIN nuevo el día del despliegue;
//   · el CHECK de coherencia existe y está escrito con `IS NULL` /
//     `IS NOT NULL` — **un CHECK que evalúa a NULL PASA**, así que una
//     comparación con `=` sobre una columna nullable no cierra nada;
//   · la migración es ADITIVA: ni un DROP, ni un UPDATE a las filas de
//     hoy, ni un `ALTER TABLE … DISABLE TRIGGER`;
//   · `pin_changes` no tiene NINGUNA columna donde quepa el PIN;
//   · y que el esquema de Prisma declara lo mismo.
//
// Lo que NO se puede guardar desde aquí: que el CHECK se cumpla de
// verdad contra Postgres. Eso se midió a mano en la pasada del bloque
// (los casos están en el `-done`).

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
const NOMBRE = "20261027020000_pin_1_mi_pin";
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

describe("la migración de pin-1", () => {
  it("es UNA sola, y del bloque", () => {
    const mias = readdirSync(DIR).filter((n) => n.includes("pin_1_mi_pin"));
    expect(mias).toEqual([NOMBRE]);
  });

  it("añade la columna de la marca", () => {
    expect(CODIGO).toContain(
      'ALTER TABLE "users" ADD COLUMN "pin_provisional_at" TIMESTAMPTZ',
    );
  });

  it("y la deja NULLABLE y SIN DEFAULT: nadie se queda fuera", () => {
    // El sabotaje más caro del bloque: un `NOT NULL DEFAULT now()`
    // marcaría como PROVISIONALES los PIN de los quince terminales en
    // producción, y el día del despliegue nadie entra sin elegir otro.
    const linea = CODIGO.split("\n").find((l) =>
      l.includes('ADD COLUMN "pin_provisional_at"'),
    )!;
    expect(linea).not.toMatch(/NOT NULL/);
    expect(linea).not.toMatch(/DEFAULT/);
  });

  it("el CHECK existe y está escrito con IS NULL / IS NOT NULL", () => {
    expect(CODIGO).toContain('"users_pin_provisional_exige_pin"');
    const check = CODIGO.slice(
      CODIGO.indexOf("users_pin_provisional_exige_pin"),
    ).split(";")[0]!;
    expect(check).toContain('"pin_provisional_at" IS NULL');
    expect(check).toContain('"pin_hash" IS NOT NULL');
    // Una comparación con `=` sobre una columna nullable evalúa a NULL,
    // y un CHECK que da NULL **pasa**. A ojo no se ve.
    expect(check).not.toMatch(/"pin_provisional_at"\s*=/);
    expect(check).not.toMatch(/"pin_hash"\s*=/);
  });

  it("es ADITIVA: ni DROP, ni UPDATE, ni DELETE a las filas de hoy", () => {
    expect(CODIGO).not.toMatch(/\bDROP\b/);
    // Anclado a principio de sentencia y no `\bUPDATE\b` a secas: las
    // tres FKs llevan `ON UPDATE CASCADE`, que no toca ninguna fila. Lo
    // que esto prohíbe es una SENTENCIA `UPDATE` o `DELETE` — o sea,
    // tocar los PIN que ya existen.
    expect(CODIGO).not.toMatch(/^\s*UPDATE\s/m);
    expect(CODIGO).not.toMatch(/^\s*DELETE\s/m);
  });

  it("ni desactiva triggers", () => {
    expect(CODIGO).not.toMatch(/DISABLE TRIGGER/);
  });

  it("crea `pin_changes` con sus dos enums y sus tres FKs", () => {
    expect(CODIGO).toContain('CREATE TYPE "PinChangeKind"');
    expect(CODIGO).toContain('CREATE TYPE "PinChangeSource"');
    expect(CODIGO).toContain('CREATE TABLE "pin_changes"');
    expect(CODIGO).toContain('"pin_changes_tenant_id_fkey"');
    expect(CODIGO).toContain('"pin_changes_target_user_id_fkey"');
    expect(CODIGO).toContain('"pin_changes_actor_user_id_fkey"');
  });

  it("el actor es SET NULL y el objetivo CASCADE", () => {
    // Dar de baja a la encargada que puso un PIN provisional no puede
    // borrar que se puso (SET NULL). Y el historial de una CREDENCIAL se
    // va con su dueña (CASCADE), igual que `care_pins`.
    const target = CODIGO.slice(
      CODIGO.indexOf("pin_changes_target_user_id_fkey"),
    ).split(";")[0]!;
    expect(target).toContain("ON DELETE CASCADE");
    const actor = CODIGO.slice(
      CODIGO.indexOf("pin_changes_actor_user_id_fkey"),
    ).split(";")[0]!;
    expect(actor).toContain("ON DELETE SET NULL");
  });

  it("`pin_changes` no tiene NINGUNA columna donde quepa un PIN", () => {
    // El punto 7 dice «sin el PIN». La forma de que eso sea verdad para
    // siempre es que no haya dónde ponerlo.
    const tabla = CODIGO.slice(
      CODIGO.indexOf('CREATE TABLE "pin_changes"'),
    ).split(");")[0]!;
    expect(tabla).not.toMatch(/pin_hash/);
    expect(tabla).not.toMatch(/"pin"/);
    expect(tabla).not.toMatch(/hash/);
  });
});

describe("y el esquema de Prisma declara lo mismo", () => {
  it("la columna es opcional y mapea a `pin_provisional_at`", () => {
    expect(SCHEMA).toMatch(
      /pinProvisionalAt\s+DateTime\?\s+@map\("pin_provisional_at"\)/,
    );
  });

  it("sin `@default`: el default de la base es «no hay marca»", () => {
    const linea = SCHEMA.split("\n").find((l) =>
      l.includes("pinProvisionalAt"),
    )!;
    expect(linea).not.toContain("@default");
  });

  it("el modelo `PinChange` existe y mapea a `pin_changes`", () => {
    expect(SCHEMA).toMatch(/model PinChange \{/);
    expect(SCHEMA).toContain('@@map("pin_changes")');
  });

  it("los dos enums llevan exactamente los valores del SQL", () => {
    const kind = SCHEMA.slice(SCHEMA.indexOf("enum PinChangeKind")).split("}")[0]!;
    expect(kind).toContain("PROPIO");
    expect(kind).toContain("PROVISIONAL");
    const source = SCHEMA.slice(SCHEMA.indexOf("enum PinChangeSource")).split(
      "}",
    )[0]!;
    for (const v of ["PANEL", "TPV", "PERSONAL", "SOPORTE"]) {
      expect(source, v).toContain(v);
    }
  });
});
