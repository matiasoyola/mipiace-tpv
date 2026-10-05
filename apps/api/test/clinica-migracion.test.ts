// clinica-1 · guardia de regresión sobre las dos migraciones.
//
// La suite no levanta Postgres, así que aquí se fija el CONTRATO del SQL y
// el comportamiento real va en `test-e2e/clinica-historia.e2e.ts`. Mismo
// papel que `catalogo-local-migracion.test.ts` y
// `verifactu-1b-migracion.test.ts`.
//
// Lo que se pone rojo si alguien lo toca:
//
//   1. Las dos migraciones son ADITIVAS: ni un DROP, ni un TRUNCATE, ni
//      un DELETE. Es lo que garantiza que Sole no nota nada.
//   2. Las capabilities nacen APAGADAS. Un `DEFAULT true` en
//      `clinical_records_enabled` encendería el módulo clínico —y el
//      escondite de la ficha técnica— en los 15 clientes de hoy.
//   3. Las cuatro tablas clínicas cuelgan de `tenants` y de `clients` con
//      **RESTRICT**. Un `CASCADE` aquí es la historia clínica borrándose
//      con la ficha del paciente, que es la garantía número uno del
//      bloque.
//   4. El índice único de `clinical_access` es PARCIAL. Sin el
//      `WHERE revoked_at IS NULL`, una revocación bloquearía para siempre
//      el acceso que una cita nueva tiene que devolver.
//   5. La autoría es NOT NULL en las dos tablas de historia.
//   6. El `ALTER TYPE ... ADD VALUE 'CLINICIAN'` va en la PRIMERA
//      migración y el CHECK que lo nombra en la SEGUNDA. Juntos, Postgres
//      aborta con «unsafe use of new value of enum type».
//   7. Los cuatro triggers existen y están colgados de la tabla que les
//      toca.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const DIR = "../../../packages/db/prisma/migrations";

function leer(nombre: string): { sql: string; statements: string } {
  const sql = readFileSync(
    new URL(`${DIR}/${nombre}/migration.sql`, import.meta.url),
    "utf8",
  );
  // Sólo las sentencias: los comentarios de estas migraciones hablan
  // largo de RESTRICT, de CASCADE y de borrar, y harían pasar los asserts
  // por lo que EXPLICAN en vez de por lo que ejecutan.
  const statements = sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
  return { sql, statements };
}

const modulo = leer("20261005000000_clinica_1_modulo");
const historia = leer("20261005010000_clinica_1_historia");

describe("clinica-1 · las dos migraciones son aditivas", () => {
  it.each([
    ["modulo", modulo.statements],
    ["historia", historia.statements],
  ])("%s: ni un DROP, ni un TRUNCATE, ni un DELETE", (_n, statements) => {
    expect(statements).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(statements).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(statements).not.toMatch(/\bTRUNCATE\b/i);
    expect(statements).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it("y ninguna hace UPDATE masivo: el backfill ES el DEFAULT", () => {
    // Desde PG 11 un `ADD COLUMN ... NOT NULL DEFAULT <constante>` no
    // reescribe la tabla. Un UPDATE aquí sería un bloqueo largo sobre
    // `users` en producción, y para nada.
    expect(modulo.statements).not.toMatch(/\bUPDATE\b/i);
  });
});

describe("clinica-1 · las capabilities nacen apagadas", () => {
  it("clinical_records_enabled es NOT NULL DEFAULT false", () => {
    expect(modulo.statements).toMatch(
      /ADD COLUMN "clinical_records_enabled" BOOLEAN NOT NULL DEFAULT false/,
    );
    // Un `DEFAULT true` encendería el módulo —y el escondite de la ficha
    // técnica— en los 15 clientes de hoy.
    expect(modulo.statements).not.toMatch(
      /"clinical_records_enabled"[^;]*DEFAULT true/,
    );
  });

  it("is_clinician es NOT NULL DEFAULT false: hoy nadie es sanitario", () => {
    expect(modulo.statements).toMatch(
      /ADD COLUMN "is_clinician" BOOLEAN NOT NULL DEFAULT false/,
    );
  });

  it("clinical_scope nace en SELECTION: lo seguro es lo restrictivo", () => {
    expect(modulo.statements).toMatch(
      /ADD COLUMN "clinical_scope" "ClinicalScope" NOT NULL DEFAULT 'SELECTION'/,
    );
    expect(modulo.statements).not.toMatch(/"clinical_scope"[^;]*DEFAULT 'ALL'/);
  });
});

describe("clinica-1 · el valor del enum y su CHECK van en migraciones distintas", () => {
  it("el ADD VALUE está en la primera", () => {
    expect(modulo.statements).toMatch(
      /ALTER TYPE "UserRole" ADD VALUE 'CLINICIAN';/,
    );
  });

  it("y la primera NO nombra 'CLINICIAN' en ninguna otra sentencia", () => {
    // Postgres permite el ADD VALUE dentro de una transacción (PG 12+)
    // SÓLO si el valor nuevo no se USA en la misma. Un CHECK, un INSERT o
    // un DEFAULT que lo mencione aborta la migración entera con «unsafe
    // use of new value of enum type».
    const sinElAddValue = modulo.statements.replace(
      /ALTER TYPE "UserRole" ADD VALUE 'CLINICIAN';/,
      "",
    );
    expect(sinElAddValue).not.toContain("CLINICIAN");
  });

  it("el CHECK «CLINICIAN implica sanitario» está en la segunda", () => {
    expect(historia.statements).toMatch(
      /ADD CONSTRAINT "users_clinician_implies_flag"\s*\n?\s*CHECK \("role" <> 'CLINICIAN' OR "is_clinician"\)/,
    );
  });
});

describe("clinica-1 · lo clínico NO SE BORRA: RESTRICT y no CASCADE", () => {
  const TABLAS = [
    "clinical_access",
    "clinical_access_log",
    "clinical_entries",
    "clinical_addenda",
  ] as const;

  it.each(TABLAS)("%s cuelga de tenants con ON DELETE RESTRICT", (tabla) => {
    expect(historia.statements).toMatch(
      new RegExp(
        `"${tabla}_tenant_id_fkey"\\s*\\n?\\s*FOREIGN KEY \\("tenant_id"\\) REFERENCES "tenants"\\("id"\\)\\s*\\n?\\s*ON DELETE RESTRICT`,
      ),
    );
  });

  it.each(["clinical_access", "clinical_access_log", "clinical_entries"] as const)(
    "%s cuelga de clients con ON DELETE RESTRICT",
    (tabla) => {
      expect(historia.statements).toMatch(
        new RegExp(
          `"${tabla}_client_id_fkey"\\s*\\n?\\s*FOREIGN KEY \\("client_id"\\) REFERENCES "clients"\\("id"\\)\\s*\\n?\\s*ON DELETE RESTRICT`,
        ),
      );
    },
  );

  it("NINGUNA FK clínica a tenants o clients es CASCADE", () => {
    // El sabotaje de la garantía nº 1: cambiar un RESTRICT por un CASCADE
    // deja la historia clínica colgando del borrado de la ficha.
    const fks = historia.statements.match(
      /FOREIGN KEY \("(?:tenant_id|client_id)"\) REFERENCES "(?:tenants|clients)"\("id"\)\s*\n?\s*ON DELETE \w+/g,
    );
    expect(fks).not.toBeNull();
    expect(fks!.length).toBe(7);
    for (const fk of fks!) {
      expect(fk).toContain("ON DELETE RESTRICT");
    }
  });

  it("la autoría es NOT NULL y RESTRICT en las dos tablas de historia", () => {
    // Una línea de historia sin autor no es historia clínica, es una nota
    // anónima.
    expect(historia.statements).toMatch(/"author_user_id" UUID NOT NULL/);
    expect(
      (historia.statements.match(/"author_user_id" UUID NOT NULL/g) ?? [])
        .length,
    ).toBe(2);
    expect(
      (
        historia.statements.match(
          /FOREIGN KEY \("author_user_id"\) REFERENCES "users"\("id"\)\s*\n?\s*ON DELETE RESTRICT/g,
        ) ?? []
      ).length,
    ).toBe(2);
  });
});

describe("clinica-1 · el índice único del acceso es PARCIAL", () => {
  it("un acceso vigente por (sanitario, paciente), sólo entre los no revocados", () => {
    expect(historia.statements).toMatch(
      /CREATE UNIQUE INDEX "clinical_access_one_live_key"\s*\n?\s*ON "clinical_access"\("clinician_user_id", "client_id"\)\s*\n?\s*WHERE "revoked_at" IS NULL;/,
    );
  });

  it("sin el WHERE, una revocación bloquearía el acceso que devuelve una cita", () => {
    // Éste es el sabotaje: quitar el `WHERE revoked_at IS NULL` y el
    // `ON CONFLICT` del enganche deja de insertar tras una revocación.
    const indice = historia.statements.slice(
      historia.statements.indexOf('"clinical_access_one_live_key"'),
    );
    expect(indice.slice(0, 200)).toContain("WHERE");
  });
});

describe("clinica-1 · los triggers que lo hacen cumplir", () => {
  it.each([
    ["clinical_access_guard", "clinical_access"],
    ["clinical_access_log_append_only", "clinical_access_log"],
    ["clinical_entries_inmutable", "clinical_entries"],
    ["clinical_addenda_inmutable", "clinical_addenda"],
  ])("%s está colgado de %s", (trigger, tabla) => {
    expect(historia.statements).toMatch(
      new RegExp(
        `CREATE TRIGGER "${trigger}"\\s*\\n?\\s*BEFORE UPDATE OR DELETE ON "${tabla}"`,
      ),
    );
  });

  it("los cuatro son BEFORE UPDATE **OR DELETE**: editar y borrar, los dos", () => {
    const triggers =
      historia.statements.match(/CREATE TRIGGER[\s\S]*?EXECUTE FUNCTION/g) ?? [];
    expect(triggers.length).toBe(4);
    for (const t of triggers) {
      expect(t).toContain("BEFORE UPDATE OR DELETE");
    }
  });

  it("el del registro NO tiene la escapatoria de «el padre ya no existe»", () => {
    // S1 y F1 la llevan porque sus FKs son CASCADE y la cascada del
    // borrado del tenant pasa por el trigger. Aquí las FKs son RESTRICT,
    // así que esa cascada no puede ocurrir: la escapatoria sería una
    // puerta abierta sin nadie que la usara.
    const fn = historia.statements.slice(
      historia.statements.indexOf(
        "mipiacetpv_clinical_access_log_append_only() RETURNS trigger",
      ),
    );
    const cuerpo = fn.slice(0, fn.indexOf("CREATE TRIGGER"));
    expect(cuerpo).not.toContain("NOT EXISTS");
    expect(cuerpo).toContain("RAISE EXCEPTION");
  });

  it("cada mensaje de los triggers dice qué hacer, no sólo que no se puede", () => {
    const mensajes =
      historia.statements.match(/'HISTORIA_VIOLADA:[^']*'/g) ?? [];
    expect(mensajes.length).toBeGreaterThanOrEqual(5);
    for (const m of mensajes) {
      expect(m.length).toBeGreaterThan(60);
    }
  });
});
