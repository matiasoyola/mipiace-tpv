// H1 · guardia de regresión sobre la migración de "la caja es un módulo".
//
// La suite no levanta Postgres (Prisma va mockeado en casi todos los
// bancos), así que aquí fijamos el CONTRATO del SQL. Lo que esta
// migración no puede dejar de hacer nunca:
//
//   1. Ser aditiva. Ni un DROP, ni un ALTER de columna existente.
//   2. Backfillar a `true`. Un tenant de hoy tiene caja; si el DEFAULT
//      se cambiara a `false` —o desapareciera— Sole, Thalía, Cachitos y
//      La Maestranza se quedarían sin caja el día del despliegue. Es el
//      sabotaje nº 6 de la tabla del bloque.
//   3. Añadir NOT_APPLICABLE al enum, en su propio statement y antes de
//      cualquier cosa que lo lea.
//
// El e2e (`h1-empresa-sin-caja.e2e.ts`) lo prueba además contra Postgres
// real; este test es la puerta que no necesita base de datos.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const MIGRATION = new URL(
  "../../../packages/db/prisma/migrations/20260912000000_h1_la_caja_es_un_modulo/migration.sql",
  import.meta.url,
);

describe("migración h1_la_caja_es_un_modulo", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  // Sólo las sentencias: los comentarios hablan de DROP y de NOT_APPLICABLE
  // y harían pasar (o fallar) los asserts por lo que explican, no por lo
  // que ejecutan.
  const statements = sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

  it("añade caja_enabled NOT NULL con DEFAULT true (el backfill es el default)", () => {
    expect(statements).toMatch(
      /ALTER TABLE "tenants" ADD COLUMN "caja_enabled" BOOLEAN NOT NULL DEFAULT true;/,
    );
  });

  it("NO deja la caja apagada por defecto: nada de DEFAULT false", () => {
    expect(statements).not.toMatch(/caja_enabled.*DEFAULT\s+false/i);
  });

  it("añade NOT_APPLICABLE al enum InitialSyncStatus", () => {
    expect(statements).toMatch(
      /ALTER TYPE "InitialSyncStatus" ADD VALUE IF NOT EXISTS 'NOT_APPLICABLE';/,
    );
  });

  it("el ADD VALUE del enum va antes que el ADD COLUMN", () => {
    expect(statements.indexOf("ADD VALUE")).toBeLessThan(
      statements.indexOf("ADD COLUMN"),
    );
  });

  it("es aditiva: ni DROP ni UPDATE masivo ni ALTER COLUMN", () => {
    expect(statements).not.toMatch(/\bDROP\b/i);
    expect(statements).not.toMatch(/\bUPDATE\b/i);
    expect(statements).not.toMatch(/ALTER COLUMN/i);
  });

  it("no toca ninguna tabla que no sea tenants", () => {
    const tablesTouched = [...statements.matchAll(/ALTER TABLE "(\w+)"/g)].map(
      (m) => m[1],
    );
    expect(new Set(tablesTouched)).toEqual(new Set(["tenants"]));
  });
});
