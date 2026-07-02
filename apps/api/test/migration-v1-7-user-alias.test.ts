// v1.7-alias-cajeros: guardia de regresión sobre la migración. La
// suite no levanta Postgres real (Prisma va mockeado), así que fijamos
// el contrato del SQL: aditiva (sin DROP/NOT NULL) y con backfill
// local-part-del-email truncado a 40, como pide el bloque.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const MIGRATION = new URL(
  "../../../packages/db/prisma/migrations/20260702000000_v1_7_user_alias/migration.sql",
  import.meta.url,
);

describe("migración v1_7_user_alias", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("añade la columna alias como nullable (aditiva)", () => {
    expect(sql).toMatch(/ALTER TABLE "users" ADD COLUMN "alias" TEXT;/);
    expect(sql).not.toMatch(/NOT NULL/i);
    expect(sql).not.toMatch(/DROP/i);
  });

  it("backfill: local-part del email truncada a 40 chars", () => {
    expect(sql).toMatch(
      /UPDATE "users" SET "alias" = LEFT\(SPLIT_PART\("email", '@', 1\), 40\);/,
    );
  });

  it("sin unique: la unicidad por tenant la valida la API", () => {
    expect(sql).not.toMatch(/UNIQUE/i);
    expect(sql).not.toMatch(/CREATE INDEX/i);
  });
});
