// clinica-2 · guardia de regresión sobre las dos migraciones de la
// valoración.
//
// Mismo papel y misma mecánica que `clinica-migracion.test.ts`: la suite
// no levanta Postgres, así que aquí se fija el CONTRATO del SQL y el
// comportamiento real va en `test-e2e/clinica-valoracion.e2e.ts`.
//
// Lo que se pone rojo si alguien lo toca:
//
//   1. Las dos migraciones son ADITIVAS. Es lo que garantiza que Sole y
//      los otros catorce no notan nada.
//   2. Las dos columnas nuevas nacen en `false`. Un `DEFAULT true` en
//      `primera_valoracion` haría que CUALQUIER cita de cualquier cliente
//      mandara emails.
//   3. El actor de sistema NO PUEDE TENER CREDENCIALES, por CHECK y en
//      los dos sentidos.
//   4. Las dos tablas nuevas cuelgan de `tenants` y de `clients` con
//      RESTRICT, y la autoría de una corrección es NOT NULL.
//   5. El índice de «una valoración abierta» es PARCIAL. Sin el
//      `WHERE status <> 'VALIDADA'`, una validada bloquearía el repaso que
//      la decisión de producto 7 exige.
//   6. Validar exige las TRES confirmaciones por CHECK, no por un `if`.
//   7. El token se guarda hasheado y con caducidad obligatoria.
//   8. El `ALTER TYPE ... ADD VALUE 'INITIAL_ASSESSMENT'` va en la PRIMERA
//      migración y el trigger que lo nombra en la SEGUNDA. Juntos,
//      Postgres aborta con «unsafe use of new value of enum type».
//   9. Los cuatro triggers existen y cuelgan de la tabla que les toca.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const DIR = "../../../packages/db/prisma/migrations";

function leer(nombre: string): { sql: string; statements: string } {
  const sql = readFileSync(
    new URL(`${DIR}/${nombre}/migration.sql`, import.meta.url),
    "utf8",
  );
  // Sólo las sentencias: los comentarios de estas migraciones hablan largo
  // de borrar, de CASCADE y de DROP, y harían pasar los asserts por lo que
  // EXPLICAN en vez de por lo que ejecutan.
  const statements = sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
  return { sql, statements };
}

const tipos = leer("20261006000000_clinica_2_tipos");
const valoracion = leer("20261006010000_clinica_2_valoracion");

describe("clinica-2 · las dos migraciones son aditivas", () => {
  it.each([
    ["tipos", tipos.statements],
    ["valoracion", valoracion.statements],
  ])("%s: ni un DROP, ni un TRUNCATE, ni un DELETE", (_n, statements) => {
    expect(statements).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(statements).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(statements).not.toMatch(/\bDROP\s+TYPE\b/i);
    expect(statements).not.toMatch(/\bTRUNCATE\b/i);
    expect(statements).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it("y ninguna hace UPDATE masivo: el backfill ES el DEFAULT", () => {
    // Desde PG 11 un `ADD COLUMN ... NOT NULL DEFAULT <constante>` no
    // reescribe la tabla. Un UPDATE aquí sería un bloqueo largo sobre
    // `users` y sobre `service_scheduling` en producción, y para nada.
    expect(tipos.statements).not.toMatch(/\bUPDATE\b/i);
    expect(valoracion.statements).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
  });
});

describe("clinica-2 · las columnas nuevas nacen apagadas", () => {
  it("primera_valoracion es NOT NULL DEFAULT false", () => {
    expect(tipos.statements).toMatch(
      /ADD COLUMN "primera_valoracion" BOOLEAN NOT NULL DEFAULT false/,
    );
    // Un `DEFAULT true` haría que cualquier cita de cualquiera de los
    // quince clientes de hoy intentara mandar un email del test.
    expect(tipos.statements).not.toMatch(
      /"primera_valoracion"[^;]*DEFAULT true/,
    );
  });

  it("is_system_actor es NOT NULL DEFAULT false", () => {
    expect(tipos.statements).toMatch(
      /ADD COLUMN "is_system_actor" BOOLEAN NOT NULL DEFAULT false/,
    );
    expect(tipos.statements).not.toMatch(/"is_system_actor"[^;]*DEFAULT true/);
  });

  it("y el estado de una valoración nace PENDIENTE_PACIENTE", () => {
    expect(valoracion.statements).toMatch(
      /"status"\s+"ClinicalAssessmentStatus" NOT NULL\s*\n?\s*DEFAULT 'PENDIENTE_PACIENTE'/,
    );
  });
});

describe("clinica-2 · el actor de sistema no puede autenticarse", () => {
  it("el CHECK prohíbe password Y pin", () => {
    expect(tipos.statements).toMatch(
      /CONSTRAINT "users_system_actor_no_credentials"/,
    );
    expect(tipos.statements).toMatch(/"password_hash" IS NULL/);
    expect(tipos.statements).toMatch(/"pin_hash" IS NULL/);
  });

  it("y está escrito EN LOS DOS SENTIDOS: también prohíbe marcar a quien ya tiene credenciales", () => {
    // `NOT is_system_actor OR (…)` es la forma que cubre las dos
    // direcciones: ni se crea un actor con PIN, ni se le pone la marca a la
    // fila de la propietaria. Un CHECK escrito sólo sobre el INSERT dejaría
    // abierto el camino por el que esto se rompería de verdad: un UPDATE.
    expect(tipos.statements).toMatch(
      /CHECK\s*\(\s*\n?\s*NOT "is_system_actor"/,
    );
  });
});

describe("clinica-2 · lo clínico no se borra", () => {
  it("las dos tablas nuevas cuelgan de tenants y de clients con RESTRICT", () => {
    for (const fk of [
      'CONSTRAINT "clinical_assessments_tenant_id_fkey"',
      'CONSTRAINT "clinical_assessments_client_id_fkey"',
      'CONSTRAINT "clinical_assessment_corrections_tenant_id_fkey"',
      'CONSTRAINT "clinical_assessment_corrections_assessment_id_fkey"',
    ]) {
      expect(valoracion.statements).toContain(fk);
    }
  });

  it("NINGUNA FK de este bloque es CASCADE", () => {
    // La garantía número uno: una valoración no se va con la ficha del
    // paciente. Se cuentan las FKs y se comprueba que ninguna lo es.
    const fks = valoracion.statements.match(/FOREIGN KEY[^,]*?ON DELETE \w+/gs) ?? [];
    expect(fks.length).toBeGreaterThanOrEqual(8);
    expect(fks.filter((f) => /ON DELETE CASCADE/.test(f))).toEqual([]);
  });

  it("la autoría de una corrección es NOT NULL y RESTRICT", () => {
    // Una corrección anónima sobre una historia clínica no existe.
    expect(valoracion.statements).toMatch(/"author_user_id" UUID NOT NULL/);
    expect(valoracion.statements).toMatch(
      /"clinical_assessment_corrections_author_user_id_fkey"[\s\S]{0,200}ON DELETE RESTRICT/,
    );
  });

  it("y el appointment_id es SET NULL: la cita se puede ir, la valoración no", () => {
    expect(valoracion.statements).toMatch(
      /"clinical_assessments_appointment_id_fkey"[\s\S]{0,200}ON DELETE SET NULL/,
    );
  });
});

describe("clinica-2 · una valoración abierta por paciente, y los repasos caben", () => {
  it("el índice único es PARCIAL", () => {
    expect(valoracion.statements).toMatch(
      /CREATE UNIQUE INDEX "clinical_assessments_one_open_key"\s*\n?\s*ON "clinical_assessments"\("client_id"\)\s*\n?\s*WHERE "status" <> 'VALIDADA'/,
    );
  });

  it("y sin el WHERE no cabría el repaso de la decisión 7", () => {
    // Si alguien quita el `WHERE`, una valoración validada bloquea para
    // siempre la siguiente — y «la valoración se repasa creando una nueva»
    // deja de ser posible. Este assert existe para que quitarlo se vea.
    const linea = valoracion.statements.match(
      /CREATE UNIQUE INDEX "clinical_assessments_one_open_key"[\s\S]*?;/,
    )?.[0];
    expect(linea).toBeDefined();
    expect(linea).toMatch(/WHERE/);
  });
});

describe("clinica-2 · validar exige las tres confirmaciones, por CHECK", () => {
  it("el CHECK nombra las tres y la firma", () => {
    const check = valoracion.statements.match(
      /CONSTRAINT "clinical_assessments_validada_firmada"[\s\S]*?\)\n        \),/,
    )?.[0];
    expect(check).toBeDefined();
    for (const col of [
      '"validated_at" IS NOT NULL',
      '"validated_by_user_id" IS NOT NULL',
      '"confirmed_allergies"',
      '"confirmed_medication"',
      '"confirmed_alerts"',
    ]) {
      expect(check).toContain(col);
    }
  });

  it("y no se firma sin validar", () => {
    expect(valoracion.statements).toMatch(
      /CONSTRAINT "clinical_assessments_sin_validar_sin_firma"/,
    );
  });

  it("una RESPONDIDA tiene respuestas y una PENDIENTE no", () => {
    expect(valoracion.statements).toMatch(
      /CONSTRAINT "clinical_assessments_respuestas_segun_estado"/,
    );
  });

  it("el origen y quién lo pidió van atados", () => {
    // Igual que `clinical_access_source_grantor` en clinica-1: un test que
    // mandó alguien lleva su nombre, uno que salió de una cita no.
    expect(valoracion.statements).toMatch(
      /CONSTRAINT "clinical_assessments_source_pedida_por"/,
    );
    expect(valoracion.statements).toMatch(
      /"source" = 'MANUAL'\s+AND "requested_by_user_id" IS NOT NULL/,
    );
    expect(valoracion.statements).toMatch(
      /"source" = 'APPOINTMENT' AND "requested_by_user_id" IS NULL/,
    );
  });
});

describe("clinica-2 · el enlace", () => {
  it("la columna guarda un HASH, no el token", () => {
    // El nombre de la columna lo dice, y es lo que impide que alguien la
    // rellene con el token en claro «porque es más fácil de depurar».
    expect(valoracion.statements).toMatch(/"link_token_hash"\s+TEXT/);
    expect(valoracion.statements).not.toMatch(/"link_token"\s+TEXT/);
  });

  it("un token sin caducidad no cabe", () => {
    expect(valoracion.statements).toMatch(
      /CONSTRAINT "clinical_assessments_enlace_caduca"[\s\S]{0,160}"link_expires_at" IS NOT NULL/,
    );
  });

  it("el token es único: dos valoraciones no comparten enlace", () => {
    expect(valoracion.statements).toMatch(
      /CREATE UNIQUE INDEX "clinical_assessments_link_token_hash_key"/,
    );
  });

  it("y el sello del enlace sólo existe si hubo respuestas", () => {
    expect(valoracion.statements).toMatch(
      /CONSTRAINT "clinical_assessments_enlace_usado_para_responder"/,
    );
  });
});

describe("clinica-2 · el valor del enum va en la PRIMERA migración", () => {
  it("el ALTER TYPE está en `tipos` y no en `valoracion`", () => {
    expect(tipos.statements).toMatch(
      /ALTER TYPE "ClinicalEntryKind" ADD VALUE 'INITIAL_ASSESSMENT'/,
    );
    expect(valoracion.statements).not.toMatch(/ADD VALUE 'INITIAL_ASSESSMENT'/);
  });

  it("y el trigger que lo NOMBRA está en la segunda", () => {
    // Juntos, Postgres aborta la migración con «unsafe use of new value of
    // enum type»: prohíbe usar un valor de enum en la misma transacción en
    // que se añade. Es la misma lección que clinica-1 ya pagó.
    expect(valoracion.statements).toMatch(/'INITIAL_ASSESSMENT'/);
    expect(valoracion.statements).toMatch(
      /mipiacetpv_clinical_assessment_entry_kind/,
    );
  });

  it("los tipos NUEVOS sí caben en la misma migración que los usa", () => {
    // La prohibición es sólo para `ALTER TYPE ... ADD VALUE`. Un
    // `CREATE TYPE` y el índice parcial que compara contra uno de sus
    // valores van juntos sin problema, y así está.
    expect(valoracion.statements).toMatch(
      /CREATE TYPE "ClinicalAssessmentStatus"/,
    );
    expect(valoracion.statements).toMatch(/WHERE "status" <> 'VALIDADA'/);
  });
});

describe("clinica-2 · los cuatro triggers", () => {
  it.each([
    ["clinical_assessments_guard", "clinical_assessments"],
    ["clinical_assessments_entry_kind", "clinical_assessments"],
    [
      "clinical_assessment_corrections_append_only",
      "clinical_assessment_corrections",
    ],
    [
      "clinical_assessment_corrections_sobre_respondida",
      "clinical_assessment_corrections",
    ],
  ])("%s cuelga de %s", (trigger, tabla) => {
    const m = valoracion.statements.match(
      new RegExp(`CREATE TRIGGER "${trigger}"[\\s\\S]*?EXECUTE FUNCTION`),
    );
    expect(m, `falta el trigger ${trigger}`).not.toBeNull();
    expect(m![0]).toContain(`ON "${tabla}"`);
  });

  it("la guarda cubre UPDATE y DELETE, y la de la clase cubre INSERT", () => {
    expect(valoracion.statements).toMatch(
      /CREATE TRIGGER "clinical_assessments_guard"\s*\n?\s*BEFORE UPDATE OR DELETE/,
    );
    expect(valoracion.statements).toMatch(
      /CREATE TRIGGER "clinical_assessments_entry_kind"\s*\n?\s*BEFORE INSERT OR UPDATE/,
    );
  });

  it("y los mensajes llevan el prefijo que el error-handler reconoce", () => {
    // `error-handler.ts::negativaClinica()` los reconoce por
    // `HISTORIA_VIOLADA` y devuelve 409 con una frase de persona. Sin el
    // prefijo, el cliente recibiría «Error de base de datos (P2010)».
    const raises = valoracion.statements.match(/RAISE EXCEPTION\s*\n?\s*'[^']+'/g) ?? [];
    expect(raises.length).toBeGreaterThanOrEqual(10);
    for (const r of raises) expect(r).toContain("HISTORIA_VIOLADA");
  });

  it("y todos levantan 23514, que es lo que el handler mira", () => {
    const errcodes = valoracion.statements.match(/USING ERRCODE = '(\d+)'/g) ?? [];
    expect(errcodes.length).toBeGreaterThanOrEqual(10);
    for (const e of errcodes) expect(e).toContain("23514");
  });
});

describe("clinica-2 · el down está escrito", () => {
  it.each([
    ["tipos", tipos.sql],
    ["valoracion", valoracion.sql],
  ])("%s dice cómo se echa atrás, y qué NO se puede deshacer", (_n, sql) => {
    expect(sql).toMatch(/El `down`, pensado/);
    expect(sql).toMatch(/DROP/);
  });

  it("y el de `tipos` avisa de que un valor de enum no se quita", () => {
    expect(tipos.sql).toMatch(/DROP VALUE` no\s*\n?--\s*-- existe|no existe en Postgres/);
  });
});
