// verifactu-1b · guardia de regresión sobre la migración corregida.
//
// La migración de verifactu-1 se corrigió EN SU SITIO (no ha corrido en
// producción). Este fichero fija lo que esa corrección no puede dejar de
// hacer nunca, en el orden en que tiene que hacerlo — la suite no levanta
// Postgres, así que aquí se fija el CONTRATO del SQL y el comportamiento
// real va en `test-e2e/verifactu-modo-prueba.e2e.ts`. Mismo papel que
// `catalogo-local-migracion.test.ts`.
//
// Lo que se pone rojo si alguien lo toca:
//
//   1. `devices.kind` existe, es NOT NULL y su DEFAULT es TERMINAL. Con
//      DEFAULT TEST, ningún terminal emparejado relevaría a nadie y dos
//      tablets acabarían escribiendo en la misma cadena.
//   2. El backfill marca TEST por los DOS marcadores del modo prueba. Si
//      marcara de menos, volvemos al fallo que abre este bloque.
//   3. La columna y el backfill van ANTES de la precondición, del índice y
//      del trigger. Si fueran después, la precondición abortaría contando
//      dispositivos técnicos y el `ALTER TABLE` ni llegaría a correr.
//   4. El índice único parcial filtra `kind = 'TERMINAL'`.
//   5. El trigger no releva a nadie si el que entra no es un TERMINAL, y no
//      releva a nadie que no sea un TERMINAL.
//   6. La precondición cuenta sólo TERMINAL y sigue agrupando por `r.id`.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const MIGRATION = new URL(
  "../../../packages/db/prisma/migrations/20260924000000_verifactu_1_registro/migration.sql",
  import.meta.url,
);

const sql = readFileSync(MIGRATION, "utf8");

// Sólo las sentencias: los comentarios de esta migración hablan largo y
// tendido de TERMINAL, de TEST y del modo prueba, y harían pasar los asserts
// por lo que EXPLICAN en vez de por lo que ejecutan.
const statements = sql
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");

/** Posición de la primera aparición. -1 si no está. */
function pos(needle: string | RegExp): number {
  if (typeof needle === "string") return statements.indexOf(needle);
  return statements.search(needle);
}

describe("verifactu-1b · el tipo del dispositivo", () => {
  it("crea el enum DeviceKind con sus dos valores", () => {
    expect(statements).toMatch(
      /CREATE TYPE "DeviceKind" AS ENUM \('TERMINAL', 'TEST'\);/,
    );
  });

  it("añade devices.kind NOT NULL con DEFAULT 'TERMINAL'", () => {
    // El DEFAULT es el backfill de todo lo que ya existe: un terminal
    // emparejado con un código lo es. Con DEFAULT 'TEST' nadie relevaría a
    // nadie y dos tablets escribirían en la misma cadena.
    expect(statements).toMatch(
      /ALTER TABLE "devices"\s*\n\s*ADD COLUMN "kind" "DeviceKind" NOT NULL DEFAULT 'TERMINAL';/,
    );
  });

  it("marca TEST por los DOS marcadores del modo prueba", () => {
    const backfill = statements.match(
      /UPDATE devices\s*\n\s*SET kind = 'TEST'\s*\n\s*WHERE[\s\S]*?;/,
    );
    expect(backfill, "falta el backfill de devices.kind").not.toBeNull();
    const texto = backfill![0];
    expect(texto).toContain("user_agent = 'internal/mipiacetpv-test'");
    expect(texto).toContain("name = 'mipiacetpv · modo prueba'");
    // OR y no AND: el `user_agent` sólo se escribe al CREAR el device, así
    // que uno reaprovisionado por una versión vieja puede llevar sólo el
    // nombre. Con AND se marcaría de menos y volveríamos al fallo.
    expect(texto).toMatch(/\bOR\b/);
    expect(texto).not.toMatch(/\bAND\b/);
  });
});

describe("verifactu-1b · el orden importa", () => {
  it("la columna y el backfill van ANTES de la precondición", () => {
    const columna = pos('ADD COLUMN "kind" "DeviceKind"');
    const backfill = pos("SET kind = 'TEST'");
    const precondicion = pos("VERIFACTU_PRECONDICION");
    expect(columna).toBeGreaterThan(-1);
    expect(backfill).toBeGreaterThan(columna);
    // Si la precondición fuese antes, abortaría contando dispositivos
    // técnicos y el ALTER TABLE ni llegaría a correr.
    expect(precondicion).toBeGreaterThan(backfill);
  });

  it("y antes del índice único y del trigger", () => {
    const backfill = pos("SET kind = 'TEST'");
    expect(pos('CREATE UNIQUE INDEX "devices_one_active_per_register_key"')).toBeGreaterThan(
      backfill,
    );
    expect(pos("CREATE FUNCTION mipiacetpv_devices_revoke_previous")).toBeGreaterThan(
      backfill,
    );
  });
});

describe("verifactu-1b · las tres piezas filtran por tipo", () => {
  it("el índice único de «un terminal activo por caja» sólo mira TERMINAL", () => {
    expect(statements).toMatch(
      /CREATE UNIQUE INDEX "devices_one_active_per_register_key"\s*\n\s*ON "devices"\("register_id"\)\s*\n\s*WHERE "revoked_at" IS NULL AND "kind" = 'TERMINAL';/,
    );
  });

  it("el trigger ni releva siendo TEST ni releva a un TEST", () => {
    const fn = statements.slice(
      pos("CREATE FUNCTION mipiacetpv_devices_revoke_previous"),
      pos('CREATE TRIGGER "devices_revoke_previous"'),
    );
    expect(fn.length).toBeGreaterThan(0);
    // (a) el que ENTRA: si no es un terminal, no releva a nadie. Sin esto,
    // activar el modo prueba revoca el terminal real del cliente.
    expect(fn).toMatch(/IF NEW\.kind <> 'TERMINAL' THEN\s*\n\s*RETURN NEW;/);
    // (b) el que SALE: emparejar una tablet nueva no apaga el modo prueba.
    expect(fn).toMatch(/WHERE register_id = NEW\.register_id[\s\S]*?AND kind = 'TERMINAL';/);
  });

  it("la precondición cuenta sólo TERMINAL y sigue agrupando por r.id", () => {
    const bloque = statements.slice(pos("DO $do$"), pos("VERIFACTU_PRECONDICION"));
    expect(bloque).toContain("d.kind = 'TERMINAL'");
    // Agrupar por nombre sumaría comercios distintos que se llaman igual
    // («Tienda principal / Caja 1»). `r.id` es lo único que identifica una
    // caja.
    expect(bloque).toContain("GROUP BY s.name, r.name, r.id");
  });
});

describe("verifactu-1b · lo que la corrección NO puede haber roto", () => {
  it("sigue siendo aditiva: ni un DROP ni un TRUNCATE", () => {
    expect(statements).not.toMatch(/\bDROP\s+(TABLE|COLUMN|TYPE)\b/i);
    expect(statements).not.toMatch(/\bTRUNCATE\b/i);
  });

  it("la precondición sigue abortando, no revocando", () => {
    expect(statements).toContain("RAISE EXCEPTION");
    // Una migración que apaga un terminal en mitad de un servicio es peor
    // que una migración que no corre.
    const bloque = statements.slice(pos("DO $do$"), pos("VERIFACTU_PRECONDICION"));
    expect(bloque).not.toMatch(/UPDATE\s+devices/i);
  });
});
