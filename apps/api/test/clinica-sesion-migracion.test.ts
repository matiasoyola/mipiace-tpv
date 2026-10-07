// clinica-3 · guardia de regresión sobre las dos migraciones de la sesión.
//
// Mismo papel y misma mecánica que `clinica-migracion.test.ts` (clinica-1)
// y `clinica-valoracion-migracion.test.ts` (clinica-2): la suite no levanta
// Postgres, así que aquí se fija el CONTRATO del SQL y el comportamiento
// real va en `test-e2e/clinica-sesion.e2e.ts`.
//
// Lo que se pone rojo si alguien lo toca:
//
//   1. Las dos migraciones son ADITIVAS. Es lo que garantiza que Sole y
//      los otros catorce no notan nada — y en este bloque importa el doble,
//      porque lo que más se toca es la caja y la usan clientes reales.
//   2. La columna nueva nace en `false`. Un `DEFAULT true` en
//      `tratamiento_sesion` convertiría TODOS los servicios de los quince
//      tenants en tratamientos de sesión.
//   3. **El índice de «una sesión por cita» es ÚNICO y PARCIAL.** Es la
//      garantía del «cerrar dos veces = un cobro». Sin el `WHERE kind =
//      'TREATMENT_SESSION'`, la exploración y las anotaciones de la misma
//      cita chocarían con la sesión; sin el `UNIQUE`, no hay garantía
//      ninguna.
//   4. Los DOS valores del enum van en la PRIMERA migración y el índice
//      que los nombra en la SEGUNDA. Juntos, Postgres aborta con «unsafe
//      use of new value of enum type».
//   5. Este bloque NO crea ninguna tabla. Si alguien añade una, este test
//      lo canta — y la conversación que toca es por qué no bastan los
//      `kind` y los triggers que ya hay.
//   6. Y no se toca ni un trigger, ni una FK, ni un CHECK de lo que ya
//      existía: la inmutabilidad de clinica-1 es la que firma la sesión.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const DIR = "../../../packages/db/prisma/migrations";

function leer(nombre: string): { sql: string; statements: string } {
  const sql = readFileSync(
    new URL(`${DIR}/${nombre}/migration.sql`, import.meta.url),
    "utf8",
  );
  // Sólo las sentencias: los comentarios de estas migraciones hablan largo
  // de DROP, de tablas y de borrar historia, y harían pasar los asserts
  // por lo que EXPLICAN en vez de por lo que ejecutan. Es la misma lección
  // que clinica-1 dejó escrita sobre los asertos de texto: hay que contar
  // lo que corre, no buscar en lo que se lee.
  const statements = sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
  return { sql, statements };
}

const tipos = leer("20261007000000_clinica_3_tipos");
const sesion = leer("20261007010000_clinica_3_sesion");

describe("clinica-3 · las dos migraciones son aditivas", () => {
  it.each([
    ["tipos", tipos.statements],
    ["sesion", sesion.statements],
  ])("%s: ni un DROP, ni un TRUNCATE, ni un DELETE", (_n, statements) => {
    expect(statements).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(statements).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(statements).not.toMatch(/\bDROP\s+TYPE\b/i);
    expect(statements).not.toMatch(/\bDROP\s+INDEX\b/i);
    expect(statements).not.toMatch(/\bDROP\s+TRIGGER\b/i);
    expect(statements).not.toMatch(/\bTRUNCATE\b/i);
    expect(statements).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it("y ninguna hace UPDATE: el backfill ES el DEFAULT", () => {
    // Desde PG 11 un `ADD COLUMN ... NOT NULL DEFAULT <constante>` no
    // reescribe la tabla. Un UPDATE aquí sería un bloqueo largo sobre
    // `service_scheduling` en producción, y para nada.
    expect(tipos.statements).not.toMatch(/\bUPDATE\b/i);
    expect(sesion.statements).not.toMatch(/\bUPDATE\b/i);
  });

  it("este bloque NO CREA NINGUNA TABLA, y es la decisión de fondo", () => {
    // La exploración y la sesión son entradas de `clinical_entries` con su
    // `kind`. La inmutabilidad, la autoría NOT NULL, el RESTRICT del
    // paciente y el enlace a la cita ya están ahí desde clinica-1; una
    // tabla propia habría tenido que volver a montar las cuatro, y la
    // quinta vez que se monta una garantía es la vez en que una sale
    // distinta.
    expect(tipos.statements).not.toMatch(/\bCREATE\s+TABLE\b/i);
    expect(sesion.statements).not.toMatch(/\bCREATE\s+TABLE\b/i);
  });

  it("ni toca un trigger, una FK o un CHECK de lo que ya existía", () => {
    for (const s of [tipos.statements, sesion.statements]) {
      expect(s).not.toMatch(/\bCREATE\s+(OR REPLACE\s+)?TRIGGER\b/i);
      expect(s).not.toMatch(/\bCREATE\s+(OR REPLACE\s+)?FUNCTION\b/i);
      expect(s).not.toMatch(/\bADD\s+CONSTRAINT\b/i);
      expect(s).not.toMatch(/\bALTER\s+CONSTRAINT\b/i);
    }
  });
});

describe("clinica-3 · la columna nueva nace apagada", () => {
  it("tratamiento_sesion es NOT NULL DEFAULT false", () => {
    expect(tipos.statements).toMatch(
      /ADD COLUMN "tratamiento_sesion" BOOLEAN NOT NULL DEFAULT false/,
    );
  });

  it("y NO es DEFAULT true — eso convertiría cada servicio de cada tenant en un tratamiento", () => {
    expect(tipos.statements).not.toMatch(
      /"tratamiento_sesion"[^;]*DEFAULT true/,
    );
  });

  it("vive en service_scheduling, al lado de primera_valoracion", () => {
    // Misma forma y mismo sitio que la marca de clinica-2, a propósito: la
    // podóloga mantiene UNA pantalla y no dos. Y en la extensión de agenda
    // y no en `products`, porque esto es agenda y no catálogo de Holded
    // (ADR-R1).
    expect(tipos.statements).toMatch(
      /ALTER TABLE "service_scheduling"\s*\n?\s*ADD COLUMN "tratamiento_sesion"/,
    );
    expect(tipos.statements).not.toMatch(/ALTER TABLE "products"/i);
  });
});

describe("clinica-3 · UNA SESIÓN POR CITA, por índice y no por un `if`", () => {
  it("el índice es ÚNICO", () => {
    expect(sesion.statements).toMatch(
      /CREATE UNIQUE INDEX "clinical_entries_una_sesion_por_cita"/,
    );
  });

  it("y es PARCIAL por las dos mitades que hacen trabajo", () => {
    // `kind = 'TREATMENT_SESSION'` · la misma cita puede tener su
    // exploración y todas las anotaciones que haga falta.
    // `appointment_id IS NOT NULL` · `appointment_id` es ON DELETE SET
    // NULL, así que el índice tiene que decir «una sesión por cita que
    // EXISTE».
    const bloque = /CREATE UNIQUE INDEX "clinical_entries_una_sesion_por_cita"[\s\S]*?;/.exec(
      sesion.statements,
    );
    expect(bloque).not.toBeNull();
    expect(bloque![0]).toMatch(/ON "clinical_entries"\("appointment_id"\)/);
    expect(bloque![0]).toMatch(/WHERE "kind" = 'TREATMENT_SESSION'/);
    expect(bloque![0]).toMatch(/AND "appointment_id" IS NOT NULL/);
  });

  it("y NO es un índice total: eso impediría la exploración de la misma cita", () => {
    expect(sesion.statements).not.toMatch(
      /CREATE UNIQUE INDEX "clinical_entries_una_sesion_por_cita"\s*\n?\s*ON "clinical_entries"\("appointment_id"\);/,
    );
  });

  it("y NO hay CHECK «una sesión tiene cita»: convertiría el SET NULL en un error duro", () => {
    // La regla «la sesión se abre desde la cita» vive en la ruta, que es
    // donde nace. Un CHECK aquí haría que borrar una cita con sesión
    // fallara con un mensaje de constraint en vez de dejar la sesión
    // huérfana y legible — y lo que la ley protege es que se siga
    // leyendo.
    expect(sesion.statements).not.toMatch(/TREATMENT_SESSION' OR "appointment_id" IS NOT NULL/);
  });
});

describe("clinica-3 · el índice de «la última de este kind»", () => {
  it("existe y lleva el kind EN MEDIO", () => {
    // Sin `kind` entre el cliente y la fecha, «la última sesión de este
    // paciente» obliga a leer todas sus entradas. Con él, es un salto al
    // final del índice. Son las DOS consultas que la pantalla hace al
    // abrirse (la sesión anterior y la última exploración).
    expect(sesion.statements).toMatch(
      /CREATE INDEX "clinical_entries_tenant_id_client_id_kind_created_at_idx"\s*\n?\s*ON "clinical_entries"\("tenant_id", "client_id", "kind", "created_at" DESC\)/,
    );
  });

  it("y NO sustituye al de clinica-1", () => {
    // Aquél sigue siendo el de «la historia de este paciente, lo más
    // reciente primero», que es la ruta paginada.
    expect(sesion.statements).not.toMatch(
      /clinical_entries_tenant_id_client_id_created_at_idx/,
    );
  });
});

describe("clinica-3 · por qué son DOS migraciones", () => {
  it("los dos valores del enum van en la PRIMERA", () => {
    expect(tipos.statements).toMatch(
      /ALTER TYPE "ClinicalEntryKind" ADD VALUE 'FOOT_EXAM'/,
    );
    expect(tipos.statements).toMatch(
      /ALTER TYPE "ClinicalEntryKind" ADD VALUE 'TREATMENT_SESSION'/,
    );
  });

  it("y el índice que los NOMBRA en la SEGUNDA", () => {
    // Postgres prohíbe USAR un valor de enum en la misma transacción en
    // que se añade, y Prisma corre cada migración en una transacción.
    // Juntas, la migración aborta con «unsafe use of new value of enum
    // type». Es la tercera vez que esta casa lo paga: clinica-1 con
    // 'CLINICIAN', clinica-2 con 'INITIAL_ASSESSMENT'.
    expect(sesion.statements).toMatch(/'TREATMENT_SESSION'/);
    expect(sesion.statements).not.toMatch(/ALTER TYPE/i);
    expect(tipos.statements).not.toMatch(/'TREATMENT_SESSION'[\s\S]*WHERE/);
  });

  it("la de tipos va ANTES por nombre, que es el orden en que Prisma las aplica", () => {
    expect("20261007000000_clinica_3_tipos" < "20261007010000_clinica_3_sesion").toBe(
      true,
    );
  });
});

describe("clinica-3 · el `down` está escrito, incluido lo que no se puede deshacer", () => {
  it("las dos cabeceras lo dicen", () => {
    // En el SQL ENTERO (comentarios incluidos): aquí lo que se comprueba
    // es justamente que la explicación esté escrita.
    for (const [nombre, m] of [
      ["tipos", tipos],
      ["sesion", sesion],
    ] as const) {
      expect(m.sql, nombre).toMatch(/El `down`/);
    }
  });

  it("y la de tipos avisa de que un valor de enum no se quita", () => {
    expect(tipos.sql).toMatch(/DROP VALUE/);
    expect(tipos.sql).toMatch(/no se echa atrás/i);
  });

  it("mientras la de la sesión SÍ es reversible del todo: son dos índices", () => {
    expect(sesion.sql).toMatch(/Reversible por completo/);
  });
});
