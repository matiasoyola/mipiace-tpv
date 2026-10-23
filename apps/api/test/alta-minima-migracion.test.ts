// alta-minima · EL CONTRATO DEL SQL DE LA MIGRACIÓN.
//
// Mismo guardia que `residencia-migracion.test.ts` y por la misma razón:
// lo que esta migración garantiza **sólo existe en el SQL**, y si alguien
// acepta el «¿borrar?» de `prisma migrate dev`, el esquema sigue
// pareciendo correcto y la invariante se va sin que nada se ponga rojo.
//
// Lo que este fichero guarda:
//
//   · que las TRES columnas pierden el `NOT NULL` y ninguna otra;
//   · que `resident_profiles_alta_coherente` se REESCRIBE con su
//     `"admission_date" IS NULL` delante — **un CHECK que da NULL pasa**,
//     así que sin ese `IS NULL` la mitad de «una fecha de alta anterior
//     al ingreso es un error de dedo» se apagaría sola para las fichas
//     nuevas, y en verde;
//   · que se parte de la ÚLTIMA definición del CHECK (la de
//     residencia-1b, que amplió la primera mitad a la columna cifrada) y
//     no de la primera;
//   · que el `down` está escrito y FALLA con un mensaje si hay filas a
//     NULL, en vez de inventarle una fecha de ingreso a nadie;
//   · que la migración es ADITIVA y **no toca ninguna tabla de
//     historia-1**, que va en otra rama;
//   · y que el `schema.prisma` lo dice igual.

import { readFileSync } from "node:fs";
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
const SQL = readFileSync(
  path.join(DIR, "20261023000000_alta_minima/migration.sql"),
  "utf8",
);
const CIFRADO = readFileSync(
  path.join(DIR, "20261015010000_residencia_1b_cifrado/migration.sql"),
  "utf8",
);
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

const CORRE = soloSql(SQL);
/** Y el revés: sólo los comentarios, que es donde vive el `down`. */
const COMENTARIOS = SQL.split("\n")
  .filter((l) => l.trimStart().startsWith("--"))
  .join("\n");

/** El SQL en una línea, para comprobar condiciones partidas en varias. */
const APLASTADO = CORRE.replace(/\s+/g, " ");

describe("alta-minima · las tres columnas pierden el NOT NULL", () => {
  it("las tres, nombradas", () => {
    for (const col of ["admission_date", "dependency_level", "place_type"]) {
      expect(APLASTADO).toContain(`ALTER COLUMN "${col}" DROP NOT NULL`);
    }
  });

  it("y NINGUNA otra columna lo pierde", () => {
    const sueltas = [...CORRE.matchAll(/ALTER COLUMN "([a-z_]+)"\s+DROP NOT NULL/g)].map(
      (m) => m[1],
    );
    expect(new Set(sueltas)).toEqual(
      new Set(["admission_date", "dependency_level", "place_type"]),
    );
  });

  it("ni una columna gana NOT NULL · eso rompería filas que ya están", () => {
    expect(CORRE).not.toContain("SET NOT NULL");
  });
});

describe("alta-minima · el CHECK que podía quedarse en NULL", () => {
  it("la condición de las fechas lleva su `admission_date IS NULL` DELANTE", () => {
    // Sin esto, con `admission_date` a NULL la comparación da NULL, y un
    // CHECK que da NULL **pasa**: la comprobación seguiría ahí sin
    // comprobar nada, y no se vería.
    expect(APLASTADO).toContain(
      '"discharge_date" IS NULL OR "admission_date" IS NULL OR "discharge_date" >= "admission_date"',
    );
  });

  it("y conserva la mitad que residencia-1b le añadió · la columna CIFRADA", () => {
    // Se parte de la ÚLTIMA definición, no de la primera. Un `DROP` +
    // `ADD` desde la de residencia-1 habría borrado esta mitad en
    // silencio: el motivo de alta cifrado dejaría de exigir fecha.
    expect(APLASTADO).toContain(
      '("discharge_reason" IS NULL AND "discharge_reason_cifrado" IS NULL) OR "discharge_date" IS NOT NULL',
    );
    // Y la de 1b la tenía: esto es lo que ata las dos definiciones.
    expect(CIFRADO.replace(/\s+/g, " ")).toContain(
      '("discharge_reason" IS NULL AND "discharge_reason_cifrado" IS NULL) OR "discharge_date" IS NOT NULL',
    );
  });

  it("se REEMPLAZA el de residencia-1b · un DROP y un ADD del mismo nombre", () => {
    expect(CORRE).toContain(
      'DROP CONSTRAINT "resident_profiles_alta_coherente"',
    );
    expect(CORRE).toContain(
      'ADD CONSTRAINT "resident_profiles_alta_coherente"',
    );
    // Uno de cada: dos CHECK con el mismo nombre no se pueden crear, y
    // dos nombres distintos dejarían el viejo vivo.
    expect(
      [...CORRE.matchAll(/ADD CONSTRAINT "resident_profiles_alta_coherente"/g)],
    ).toHaveLength(1);
  });

  it("y NO toca el CHECK de la identificación, que es de otro bloque", () => {
    expect(CORRE).not.toContain("resident_profiles_identificacion_not_blank");
  });
});

describe("alta-minima · el `down` está escrito y se niega a inventar datos", () => {
  it("comprueba las tres columnas antes de volver a NOT NULL", () => {
    for (const col of ["admission_date", "dependency_level", "place_type"]) {
      expect(COMENTARIOS).toContain(`"${col}" IS NULL`);
    }
  });

  it("LEVANTA con un mensaje en vez de rellenar nada", () => {
    // Inventarle una fecha de ingreso a 43 residentes es escribir un dato
    // falso en la ficha de una persona, y eso luego sale en un informe a
    // la Consejería.
    expect(COMENTARIOS).toContain("RAISE EXCEPTION");
    expect(COMENTARIOS).toContain("No se puede bajar alta-minima");
    // Y el `down` no rellena: ni un UPDATE en los comentarios.
    expect(COMENTARIOS).not.toMatch(/UPDATE "resident_profiles"\s+SET/);
  });

  it("y devuelve el CHECK a su forma de residencia-1b", () => {
    expect(COMENTARIOS.replace(/\s+/g, " ")).toContain(
      '"discharge_date" IS NULL OR "discharge_date" >= "admission_date"',
    );
  });
});

describe("alta-minima · la migración es ADITIVA", () => {
  it("ni un DROP TABLE, ni un DELETE, ni un TRUNCATE, ni un UPDATE", () => {
    for (const prohibido of [
      "DROP TABLE",
      "DROP COLUMN",
      "DELETE FROM",
      "TRUNCATE",
      "UPDATE ",
      "CREATE TABLE",
    ]) {
      expect(CORRE).not.toContain(prohibido);
    }
  });

  it("TODOS los `ALTER TABLE` son de `resident_profiles`", () => {
    const tablas = [...CORRE.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map((m) => m[1]);
    expect(tablas.length).toBeGreaterThan(0);
    expect(new Set(tablas)).toEqual(new Set(["resident_profiles"]));
  });

  it("NO crea tablas · el ingreso guiado es historia-1, en otra rama", () => {
    // Lo que este bloque promete para no pisar a historia-1: «la
    // migración sólo cambia nulabilidad; no añade tablas».
    expect(CORRE).not.toMatch(/CREATE (TABLE|TYPE|INDEX)/);
    expect(CORRE).not.toContain("admission_checklist");
  });
});

describe("alta-minima · y el schema de Prisma lo dice igual", () => {
  it("los tres campos son opcionales", () => {
    expect(SCHEMA).toContain('admissionDate          DateTime? @map("admission_date")');
    expect(SCHEMA).toContain('dependencyLevel DependencyLevel? @map("dependency_level")');
    expect(SCHEMA).toContain('placeType       PlaceType?       @map("place_type")');
  });

  it("pero `bed_assignments.from_at` NO · una ocupación sin fecha no responde «¿dónde dormía en marzo?»", () => {
    const bloque = SCHEMA.slice(
      SCHEMA.indexOf("model BedAssignment {"),
      SCHEMA.indexOf("model BedAssignment {") + 2000,
    );
    expect(bloque).toMatch(/fromAt\s+DateTime\s+@map\("from_at"\)/);
  });
});
