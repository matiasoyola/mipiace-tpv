// S1-sello · el guardia de la lista de columnas económicas.
//
// La lista vive en UN sitio (`packages/db/src/sealed-fields.ts`) y de ahí
// salen dos cosas que tienen que decir lo mismo: el payload que se
// hashea y el cuerpo del trigger de Postgres. Este fichero es lo que
// impide que se separen, y lo que impide que una columna de importe
// nueva se quede fuera del sello por descuido.
//
// Los dos sabotajes que cubre:
//
//   · quitar una columna de importe de la lista  → rojo aquí;
//   · tocar la lista y no regenerar la migración → rojo aquí.
//
// Sin esto, el sello se degradaría en silencio: seguiría existiendo,
// seguiría verificando, y ya no cubriría lo que dice cubrir.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildSealedGuardSql,
  NOT_SEALED_MONEY_COLUMNS,
  PRISMA_FIELD_BY_COLUMN,
  SEALED_COLUMNS,
  SEALED_DECIMAL_SCALE,
  SEALED_TABLES,
} from "@mipiacetpv/db";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const SCHEMA_PATH = path.join(REPO_ROOT, "packages/db/prisma/schema.prisma");
const MIGRATION_PATH = path.join(
  REPO_ROOT,
  "packages/db/prisma/migrations/20260909000000_s1_sello_de_la_venta/migration.sql",
);

/** El `@@map` de un modelo Prisma → el bloque de líneas del modelo. */
function readModelBlocks(schema: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(schema)) !== null) {
    const body = m[2]!;
    const mapped = body.match(/@@map\("([^"]+)"\)/);
    out.set(mapped ? mapped[1]! : m[1]!, body);
  }
  return out;
}

/** Columnas DECIMAL del modelo, en nombre SQL, con su escala. */
function moneyColumns(body: string): Array<{ column: string; scale: number }> {
  const out: Array<{ column: string; scale: number }> = [];
  for (const line of body.split("\n")) {
    const dec = line.match(/@db\.Decimal\((\d+),\s*(\d+)\)/);
    if (!dec) continue;
    const field = line.trim().split(/\s+/)[0]!;
    const mapped = line.match(/@map\("([^"]+)"\)/);
    out.push({ column: mapped ? mapped[1]! : field, scale: Number(dec[2]) });
  }
  return out;
}

const schema = readFileSync(SCHEMA_PATH, "utf8");
const models = readModelBlocks(schema);

describe("S1-sello · la lista de columnas económicas", () => {
  it("cubre TODAS las columnas de importe de las tres tablas económicas", () => {
    const huerfanas: string[] = [];
    for (const table of SEALED_TABLES) {
      const body = models.get(table);
      expect(body, `no encuentro el modelo mapeado a ${table}`).toBeTruthy();
      for (const { column } of moneyColumns(body!)) {
        const sealed = SEALED_COLUMNS[table]!.includes(column);
        const excusada = `${table}.${column}` in NOT_SEALED_MONEY_COLUMNS;
        if (!sealed && !excusada) huerfanas.push(`${table}.${column}`);
      }
    }
    // Si esto se pone rojo: o la columna nueva entra en SEALED_COLUMNS
    // (y se regenera la migración), o se añade a NOT_SEALED_MONEY_COLUMNS
    // con el motivo escrito. Lo que no se puede es dejarla sin decidir.
    expect(huerfanas).toEqual([]);
  });

  it("declara la escala decimal exacta de cada columna monetaria sellada", () => {
    for (const table of SEALED_TABLES) {
      const body = models.get(table)!;
      for (const { column, scale } of moneyColumns(body)) {
        if (!SEALED_COLUMNS[table]!.includes(column)) continue;
        // La escala es lo que hace que 12.3 y 12.3000 den el mismo hash.
        expect(SEALED_DECIMAL_SCALE[column], `escala de ${table}.${column}`).toBe(
          scale,
        );
      }
    }
  });

  it("cada columna sellada tiene su campo Prisma declarado", () => {
    for (const table of SEALED_TABLES) {
      for (const column of SEALED_COLUMNS[table]!) {
        expect(
          PRISMA_FIELD_BY_COLUMN[column],
          `falta el campo Prisma de ${table}.${column}`,
        ).toBeTruthy();
      }
    }
  });

  it("cada excusa de NOT_SEALED_MONEY_COLUMNS apunta a una columna que existe", () => {
    for (const key of Object.keys(NOT_SEALED_MONEY_COLUMNS)) {
      const [table, column] = key.split(".") as [string, string];
      const body = models.get(table);
      expect(body, `${key}: la tabla ${table} no existe`).toBeTruthy();
      expect(
        moneyColumns(body!).some((c) => c.column === column),
        `${key}: la columna ya no es de importe (o no existe): borra la excusa`,
      ).toBe(true);
      expect(NOT_SEALED_MONEY_COLUMNS[key]!.length).toBeGreaterThan(20);
    }
  });

  it("la migración lleva EXACTAMENTE el bloque que genera la lista", () => {
    const migration = readFileSync(MIGRATION_PATH, "utf8");
    // Byte a byte. Si alguien toca la lista y no regenera el .sql, el
    // trigger de producción vigilaría un conjunto de columnas distinto
    // del que entra en el hash — el peor fallo posible de este bloque,
    // porque no se notaría hasta que hiciera falta.
    expect(migration).toContain(buildSealedGuardSql());
  });

  it("credit_pending está fuera del sello, con el motivo escrito (ADR-015 §5.1)", () => {
    expect(SEALED_COLUMNS.tickets).not.toContain("credit_pending");
    expect(NOT_SEALED_MONEY_COLUMNS["tickets.credit_pending"]).toMatch(/§5\.1/);
  });
});
