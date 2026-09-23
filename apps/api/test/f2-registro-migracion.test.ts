// F1 · guardia de regresión sobre la migración del registro de jornada.
//
// La prueba DE VERDAD de que el motor rechaza el cambio está en
// `test-e2e/f2-registro-inalterable.e2e.ts`, contra Postgres real. Éste es
// el guardia que no necesita base de datos: corre en `pnpm test`, en el
// portátil de cualquiera y en CI sin servicios.
//
// Lo que fija: que las piezas que hacen inalterable el registro SIGUEN
// ESTANDO. Quitar un trigger es un `git rm` de tres líneas que ningún
// test de comportamiento con un prisma falso detectaría, porque un prisma
// falso no tiene triggers.
//
// Sabotajes que este fichero pone en rojo (§3 del done):
//   · quitar el trigger append-only de las correcciones (nº 1)
//   · quitar el índice parcial de "un tramo abierto por empleado" (nº 2)
//   · quitar el CHECK del motivo (nº 3)
//   · quitar el índice parcial de "un móvil activo por empleado" (nº 5)
//   · quitar el guard de borrado de los fichajes

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const MIGRATION = new URL(
  "../../../packages/db/prisma/migrations/20260923010000_fichaje_1_registro/migration.sql",
  import.meta.url,
);

const sql = readFileSync(MIGRATION, "utf8");
// Sólo las sentencias: los comentarios de esta migración hablan de DROP,
// de borrar y de reabrir, y harían pasar los asserts por lo que explican
// en vez de por lo que ejecutan. Mismo criterio que `h1-migracion-caja`.
const statements = sql
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");

describe("F1 · migración fichaje_1_registro · es aditiva", () => {
  it("no borra nada de lo que ya existe", () => {
    // Los únicos DROP admisibles serían de objetos propios, y no hay
    // ninguno: esta migración sólo crea.
    expect(statements).not.toMatch(/\bDROP\b/i);
    expect(statements).not.toMatch(/ALTER COLUMN/i);
  });

  it("sólo crea tablas suyas", () => {
    const creadas = [...statements.matchAll(/CREATE TABLE "([a-z_]+)"/g)].map(
      (m) => m[1],
    );
    expect(new Set(creadas)).toEqual(
      new Set([
        "employees",
        "employee_devices",
        "employee_pairing_tokens",
        "time_entries",
        "time_entry_corrections",
      ]),
    );
  });

  it("las únicas tablas que ALTERA son las suyas (ninguna)", () => {
    const alteradas = [...statements.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map(
      (m) => m[1],
    );
    expect(alteradas).toEqual([]);
  });
});

describe("F1 · migración fichaje_1_registro · las invariantes las garantiza la BASE", () => {
  it("un tramo abierto por empleado: índice parcial único", () => {
    expect(statements).toMatch(
      /CREATE UNIQUE INDEX "time_entries_one_open_key"\s*\n?\s*ON "time_entries"\("employee_id"\) WHERE "ended_at" IS NULL;/,
    );
  });

  it("un móvil activo por empleado: índice parcial único", () => {
    expect(statements).toMatch(
      /CREATE UNIQUE INDEX "employee_devices_one_active_key"\s*\n?\s*ON "employee_devices"\("employee_id"\) WHERE "revoked_at" IS NULL;/,
    );
  });

  it("un tramo no termina antes de empezar", () => {
    expect(statements).toMatch(/time_entries_ended_after_started/);
    expect(statements).toMatch(/CHECK \("ended_at" IS NULL OR "ended_at" > "started_at"\)/);
  });

  it("si hay salida, hay procedencia de la salida", () => {
    expect(statements).toMatch(/time_entries_end_provenance/);
  });
});

describe("F1 · migración fichaje_1_registro · la traza", () => {
  it("el motivo es un enum cerrado EN LA BASE, no sólo en el schema de la ruta", () => {
    expect(statements).toMatch(
      /CREATE TYPE "TimeEntryCorrectionReason" AS ENUM \('OLVIDO', 'ERROR_HORA', 'OTRO'\);/,
    );
  });

  it('el motivo "Otro" exige texto, por CHECK', () => {
    expect(statements).toMatch(/time_entry_corrections_otro_needs_text/);
    expect(statements).toMatch(
      /CHECK \("reason_code" <> 'OTRO' OR btrim\(coalesce\("reason_text", ''\)\) <> ''\)/,
    );
  });

  it("sólo las horas son corregibles, por CHECK", () => {
    expect(statements).toMatch(/CHECK \("field" IN \('started_at', 'ended_at'\)\)/);
  });

  it("quien firma tiene que existir como tal", () => {
    expect(statements).toMatch(/time_entry_corrections_author_id/);
  });

  it("la tabla de correcciones es append-only, por trigger", () => {
    expect(statements).toMatch(
      /CREATE TRIGGER "time_entry_corrections_append_only"\s*\n?\s*BEFORE UPDATE OR DELETE ON "time_entry_corrections"/,
    );
  });

  it("la corrección y el cambio son la misma transacción (txid_current)", () => {
    expect(statements).toMatch(/txid = txid_current\(\)/);
    expect(statements).toMatch(/txid_current\(\)\s*\)/);
  });
});

describe("F1 · migración fichaje_1_registro · los guardas", () => {
  it("las horas de un fichaje van por trigger BEFORE UPDATE", () => {
    expect(statements).toMatch(
      /CREATE TRIGGER "time_entries_registro_guard"\s*\n?\s*BEFORE UPDATE ON "time_entries"/,
    );
  });

  it("un fichaje no se borra: trigger BEFORE DELETE", () => {
    expect(statements).toMatch(
      /CREATE TRIGGER "time_entries_delete_guard"\s*\n?\s*BEFORE DELETE ON "time_entries"/,
    );
  });

  it("un empleado con fichajes tampoco: trigger BEFORE DELETE", () => {
    expect(statements).toMatch(
      /CREATE TRIGGER "employees_delete_guard"\s*\n?\s*BEFORE DELETE ON "employees"/,
    );
  });

  it("la función de corrección es SECURITY DEFINER con search_path fijado", () => {
    expect(statements).toMatch(
      /CREATE FUNCTION record_time_entry_correction\([\s\S]*?LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp/,
    );
  });

  // La escapatoria de S1, y la única: el padre ya no existe, así que esto
  // es su cascada y no alguien limpiando el registro.
  it("la única escapatoria del borrado es que el tenant ya no exista", () => {
    const guards = statements.match(
      /CREATE FUNCTION mipiacetpv_time_entries_delete_guard[\s\S]*?\$fn\$;/,
    );
    expect(guards).toBeTruthy();
    expect(guards![0]).toMatch(/NOT EXISTS \(SELECT 1 FROM tenants WHERE id = OLD\.tenant_id\)/);
    // Y ninguna otra: ni un estado, ni un flag, ni un "si es de prueba".
    expect(guards![0].match(/RETURN OLD;/g)).toHaveLength(1);
  });
});
