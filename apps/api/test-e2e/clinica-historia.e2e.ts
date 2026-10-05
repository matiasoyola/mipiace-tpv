// clinica-1 · la tabla «sabotaje → test rojo» de la historia clínica,
// contra Postgres de verdad.
//
// Por qué tiene que ser e2e y no puede vivir con un prisma falso: lo que
// se prueba aquí es que **el MOTOR** lo rechaza, no que la aplicación se
// porte bien. Misma razón exacta de `sello-de-la-venta.e2e.ts` (ADR-015
// §1) y de `f2-registro-inalterable.e2e.ts` (ADR-018): la aplicación no
// es la única puerta a Postgres, y una historia clínica que sólo es
// inalterable mientras el código se porte bien no es inalterable. El día
// que a Mi Piace le pidan la historia de un paciente en un juzgado, lo que
// la defiende es el trigger.
//
// Por eso cada sabotaje entra por `$executeRawUnsafe`: SQL directo, como
// lo escribiría alguien con acceso al VPS.
//
// Las garantías, una por bloque:
//
//   1. La historia NO SE BORRA — ni la entrada, ni la anotación, ni el
//      paciente que la tiene, ni el tenant.
//   2. La historia NO SE EDITA. Se le añaden anotaciones.
//   3. El registro de accesos es SÓLO INSERCIONES.
//   4. El acceso no se borra: se revoca, y la revocación no se deshace.
//   5. Un acceso vigente por (sanitario, paciente), y una revocación NO
//      bloquea el que devuelve una cita nueva.
//   6. `CLINICIAN` implica sanitario, por CHECK.

import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { E2E_DATABASE_URL, e2eEnabled, SKIP_MESSAGE } from "./e2e-env.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  E2E_DATABASE_URL || "postgresql://e2e:e2e@127.0.0.1:5432/e2e";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET = "e".repeat(40);
process.env.JWT_REFRESH_SECRET = "f".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

const { getPrisma, shutdown } = await import("../src/context.js");

/** Un UPDATE/DELETE tiene que FALLAR. Devuelve el mensaje de Postgres. */
async function debeFallar(sql: string): Promise<string> {
  const prisma = getPrisma();
  try {
    await prisma.$executeRawUnsafe(sql);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error(`El motor ACEPTÓ lo que no debía:\n${sql}`);
}

describe.skipIf(!e2eEnabled)("e2e · la historia clínica no se borra ni se edita", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let tenantId = "";
  let duenaId = "";
  let sanitariaId = "";
  let pacienteId = "";
  let entryId = "";

  beforeAll(async () => {
    tenantId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO tenants (id, name, clinical_records_enabled, crm_enabled, agenda_enabled, updated_at)
       VALUES ('${tenantId}', 'Clínica del Pie ${tenantId.slice(0, 8)}', true, true, true, now())`,
    );
  });

  afterAll(async () => {
    // LIMPIEZA A PROPÓSITO EN ESTE ORDEN, y es parte de lo que se prueba:
    // con las FKs en RESTRICT no se puede empezar por el tenant. Hay que
    // retirar la historia a mano —saltándose los triggers con un DELETE
    // que el propio trigger rechaza, así que se desactiva— y sólo
    // entonces se va el tenant. Que limpiar sea incómodo es exactamente
    // la garantía funcionando.
    await prisma.$executeRawUnsafe(
      `ALTER TABLE clinical_addenda DISABLE TRIGGER clinical_addenda_inmutable`,
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE clinical_entries DISABLE TRIGGER clinical_entries_inmutable`,
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE clinical_access_log DISABLE TRIGGER clinical_access_log_append_only`,
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE clinical_access DISABLE TRIGGER clinical_access_guard`,
    );
    for (const t of [
      "clinical_addenda",
      "clinical_entries",
      "clinical_access_log",
      "clinical_access",
    ]) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM ${t} WHERE tenant_id = '${tenantId}'`,
      );
    }
    await prisma.$executeRawUnsafe(
      `ALTER TABLE clinical_addenda ENABLE TRIGGER clinical_addenda_inmutable`,
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE clinical_entries ENABLE TRIGGER clinical_entries_inmutable`,
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE clinical_access_log ENABLE TRIGGER clinical_access_log_append_only`,
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE clinical_access ENABLE TRIGGER clinical_access_guard`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM tenants WHERE id = '${tenantId}'`,
    );
    await shutdown();
  });

  beforeEach(async () => {
    duenaId = randomUUID();
    sanitariaId = randomUUID();
    pacienteId = randomUUID();
    entryId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO users (id, tenant_id, email, alias, role, is_clinician, clinician_license, clinical_scope)
       VALUES
         ('${duenaId}', '${tenantId}', 'pilar-${duenaId.slice(0, 8)}@c.es', 'Pilar', 'OWNER', false, NULL, 'SELECTION'),
         ('${sanitariaId}', '${tenantId}', 'lucia-${sanitariaId.slice(0, 8)}@c.es', 'Lucía', 'CLINICIAN', true, '28/1234', 'SELECTION')`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO clients (id, tenant_id, first_name, last_name, updated_at)
       VALUES ('${pacienteId}', '${tenantId}', 'Antonio', 'Gil', now())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO clinical_entries (id, tenant_id, client_id, author_user_id, kind, body)
       VALUES ('${entryId}', '${tenantId}', '${pacienteId}', '${sanitariaId}', 'NOTE',
               '{"texto":"Hiperqueratosis plantar derecha"}'::jsonb)`,
    );
  });

  // ── 1 · no se borra ────────────────────────────────────────────────

  it("un DELETE a mano sobre una entrada falla, y dice qué hacer", async () => {
    const msg = await debeFallar(
      `DELETE FROM clinical_entries WHERE id = '${entryId}'`,
    );
    expect(msg).toContain("HISTORIA_VIOLADA");
    expect(msg).toContain("no se borra");
    // El mensaje no se queda en la negativa: dice cuál es la vía.
    expect(msg).toContain("anotaciones");
  });

  it("un DELETE sobre una anotación falla igual", async () => {
    const addId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO clinical_addenda (id, tenant_id, entry_id, author_user_id, body)
       VALUES ('${addId}', '${tenantId}', '${entryId}', '${sanitariaId}', '{"texto":"Era la zona 3"}'::jsonb)`,
    );
    const msg = await debeFallar(
      `DELETE FROM clinical_addenda WHERE id = '${addId}'`,
    );
    expect(msg).toContain("HISTORIA_VIOLADA");
  });

  it("BORRAR AL PACIENTE con historia falla: lo niega la FK, no un `if`", async () => {
    const msg = await debeFallar(
      `DELETE FROM clients WHERE id = '${pacienteId}'`,
    );
    // Error de FK (23503), no de trigger: la garantía está en el modelo.
    expect(msg).toMatch(/clinical_entries_client_id_fkey|violates foreign key/i);
  });

  it("y BORRAR EL TENANT con historia, también", async () => {
    const msg = await debeFallar(`DELETE FROM tenants WHERE id = '${tenantId}'`);
    expect(msg).toMatch(/violates foreign key|clinical_/i);
  });

  it("borrar al AUTOR de una entrada falla: la autoría no se queda muda", async () => {
    const msg = await debeFallar(`DELETE FROM users WHERE id = '${sanitariaId}'`);
    expect(msg).toMatch(/violates foreign key|clinical_/i);
  });

  // ── 2 · no se edita ────────────────────────────────────────────────

  it("un UPDATE del cuerpo de una entrada falla, y propone la anotación", async () => {
    const msg = await debeFallar(
      `UPDATE clinical_entries SET body = '{"texto":"otra cosa"}'::jsonb WHERE id = '${entryId}'`,
    );
    expect(msg).toContain("HISTORIA_VIOLADA");
    expect(msg).toContain("no se edita");
    expect(msg).toContain("anotación");
  });

  it("tampoco se le cambia el paciente ni el autor", async () => {
    for (const sql of [
      `UPDATE clinical_entries SET client_id = '${randomUUID()}' WHERE id = '${entryId}'`,
      `UPDATE clinical_entries SET author_user_id = '${duenaId}' WHERE id = '${entryId}'`,
      `UPDATE clinical_entries SET created_at = now() - interval '1 year' WHERE id = '${entryId}'`,
    ]) {
      expect(await debeFallar(sql)).toContain("HISTORIA_VIOLADA");
    }
  });

  it("CORREGIR SÍ SE PUEDE, y es añadir: la anotación entra y la entrada no cambia", async () => {
    // El caso canónico. El fallo típico de esto no es quedarse corto: es
    // pasarse de estricto y que la sanitaria no pueda corregir nada.
    const addId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO clinical_addenda (id, tenant_id, entry_id, author_user_id, body)
       VALUES ('${addId}', '${tenantId}', '${entryId}', '${duenaId}', '{"texto":"Revisado"}'::jsonb)`,
    );
    const rows = await prisma.$queryRawUnsafe<Array<{ body: unknown }>>(
      `SELECT body FROM clinical_entries WHERE id = '${entryId}'`,
    );
    expect(rows[0]!.body).toEqual({
      texto: "Hiperqueratosis plantar derecha",
    });
    const adds = await prisma.$queryRawUnsafe<Array<{ author_user_id: string }>>(
      `SELECT author_user_id FROM clinical_addenda WHERE entry_id = '${entryId}'`,
    );
    expect(adds).toHaveLength(1);
    expect(adds[0]!.author_user_id).toBe(duenaId);
  });

  it("una entrada sin cuerpo útil no entra: el CHECK la rechaza", async () => {
    for (const body of ["'{}'::jsonb", `'"texto"'::jsonb`, "'null'::jsonb"]) {
      const msg = await debeFallar(
        `INSERT INTO clinical_entries (tenant_id, client_id, author_user_id, kind, body)
         VALUES ('${tenantId}', '${pacienteId}', '${sanitariaId}', 'NOTE', ${body})`,
      );
      expect(msg).toMatch(/clinical_entries_body_object|violates check/i);
    }
  });

  it("una entrada SIN AUTOR no entra", async () => {
    const msg = await debeFallar(
      `INSERT INTO clinical_entries (tenant_id, client_id, author_user_id, kind, body)
       VALUES ('${tenantId}', '${pacienteId}', NULL, 'NOTE', '{"t":"x"}'::jsonb)`,
    );
    // 23502 (not_null_violation). Prisma no deja pasar el nombre de la
    // columna en el mensaje, así que se comprueba el código y que la fila
    // que rebota es la que trae el autor a NULL.
    expect(msg).toContain("23502");
    expect(msg).toContain('{\"t\": \"x\"}');
  });

  // ── 3 · el registro es sólo inserciones ────────────────────────────

  it("el registro de accesos no se edita ni se borra", async () => {
    const logId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO clinical_access_log (id, tenant_id, user_id, client_id, action, outcome, route)
       VALUES ('${logId}', '${tenantId}', '${sanitariaId}', '${pacienteId}', 'READ', 'ALLOWED',
               'GET /clinica/clients/x/entries')`,
    );
    for (const sql of [
      `UPDATE clinical_access_log SET outcome = 'DENIED' WHERE id = '${logId}'`,
      `UPDATE clinical_access_log SET at = now() - interval '1 day' WHERE id = '${logId}'`,
      `DELETE FROM clinical_access_log WHERE id = '${logId}'`,
    ]) {
      const msg = await debeFallar(sql);
      expect(msg).toContain("HISTORIA_VIOLADA");
      expect(msg).toContain("sólo inserciones");
    }
  });

  it("los DENEGADOS se guardan igual que los permitidos", async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO clinical_access_log (tenant_id, user_id, client_id, action, outcome)
       VALUES ('${tenantId}', '${duenaId}', '${pacienteId}', 'READ', 'DENIED')`,
    );
    const rows = await prisma.$queryRawUnsafe<Array<{ outcome: string }>>(
      `SELECT outcome FROM clinical_access_log
        WHERE tenant_id = '${tenantId}' AND user_id = '${duenaId}'`,
    );
    expect(rows[0]!.outcome).toBe("DENIED");
  });

  // ── 4 y 5 · el acceso ─────────────────────────────────────────────

  it("un acceso no se borra: se revoca, y la revocación no se deshace", async () => {
    const accId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO clinical_access (id, tenant_id, clinician_user_id, client_id, source)
       VALUES ('${accId}', '${tenantId}', '${sanitariaId}', '${pacienteId}', 'APPOINTMENT')`,
    );
    expect(
      await debeFallar(`DELETE FROM clinical_access WHERE id = '${accId}'`),
    ).toContain("no se borra");

    // Revocar SÍ se puede: es el camino bueno.
    await prisma.$executeRawUnsafe(
      `UPDATE clinical_access SET revoked_at = now(), revoked_by_user_id = '${duenaId}'
        WHERE id = '${accId}'`,
    );

    // Y a partir de ahí no se mueve.
    expect(
      await debeFallar(
        `UPDATE clinical_access SET revoked_at = NULL, revoked_by_user_id = NULL WHERE id = '${accId}'`,
      ),
    ).toContain("no se deshace");
    expect(
      await debeFallar(
        `UPDATE clinical_access SET source = 'MANUAL' WHERE id = '${accId}'`,
      ),
    ).toContain("no se reescribe");
  });

  it("UN acceso vigente por (sanitario, paciente): el segundo rebota", async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO clinical_access (tenant_id, clinician_user_id, client_id, source)
       VALUES ('${tenantId}', '${sanitariaId}', '${pacienteId}', 'APPOINTMENT')`,
    );
    const msg = await debeFallar(
      `INSERT INTO clinical_access (tenant_id, clinician_user_id, client_id, source)
       VALUES ('${tenantId}', '${sanitariaId}', '${pacienteId}', 'APPOINTMENT')`,
    );
    // 23505 (unique_violation). Prisma reescribe el mensaje de Postgres,
    // así que lo que se comprueba es la CLAVE que choca — que es
    // exactamente la del índice parcial.
    expect(msg).toMatch(/23505|already exists|one_live_key/i);
    expect(msg).toContain("clinician_user_id, client_id");
  });

  it("REVOCADO Y VUELTO A ASIGNAR: la cita nueva SÍ crea otra fila", async () => {
    // El comportamiento que el prompt pide con estas palabras: «si tras
    // una revocación se le asigna una cita nueva con ese paciente,
    // recupera el acceso; la revocación queda en el histórico». Lo hace
    // posible que el índice único sea PARCIAL.
    const primero = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO clinical_access (id, tenant_id, clinician_user_id, client_id, source)
       VALUES ('${primero}', '${tenantId}', '${sanitariaId}', '${pacienteId}', 'APPOINTMENT')`,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE clinical_access SET revoked_at = now(), revoked_by_user_id = '${duenaId}'
        WHERE id = '${primero}'`,
    );
    // Esto es lo que hace el enganche de la agenda, literalmente.
    const insertados = await prisma.$executeRawUnsafe(
      `INSERT INTO clinical_access (tenant_id, clinician_user_id, client_id, source, granted_at)
       VALUES ('${tenantId}', '${sanitariaId}', '${pacienteId}', 'APPOINTMENT', now())
       ON CONFLICT ("clinician_user_id", "client_id") WHERE "revoked_at" IS NULL
       DO NOTHING`,
    );
    expect(insertados).toBe(1);
    // Dos filas: la revocada se queda en el histórico.
    const todas = await prisma.$queryRawUnsafe<Array<{ revoked_at: Date | null }>>(
      `SELECT revoked_at FROM clinical_access
        WHERE clinician_user_id = '${sanitariaId}' AND client_id = '${pacienteId}'
        ORDER BY granted_at`,
    );
    expect(todas).toHaveLength(2);
    expect(todas[0]!.revoked_at).not.toBeNull();
    expect(todas[1]!.revoked_at).toBeNull();
  });

  it("MOVER una cita conservando a su profesional NO crea filas nuevas", async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO clinical_access (tenant_id, clinician_user_id, client_id, source)
       VALUES ('${tenantId}', '${sanitariaId}', '${pacienteId}', 'APPOINTMENT')`,
    );
    const insertados = await prisma.$executeRawUnsafe(
      `INSERT INTO clinical_access (tenant_id, clinician_user_id, client_id, source, granted_at)
       VALUES ('${tenantId}', '${sanitariaId}', '${pacienteId}', 'APPOINTMENT', now())
       ON CONFLICT ("clinician_user_id", "client_id") WHERE "revoked_at" IS NULL
       DO NOTHING`,
    );
    expect(insertados).toBe(0);
  });

  it("un acceso de la AGENDA no puede llevar firma, y uno A MANO tiene que llevarla", async () => {
    expect(
      await debeFallar(
        `INSERT INTO clinical_access (tenant_id, clinician_user_id, client_id, source, granted_by_user_id)
         VALUES ('${tenantId}', '${sanitariaId}', '${pacienteId}', 'APPOINTMENT', '${duenaId}')`,
      ),
    ).toMatch(/clinical_access_source_grantor|violates check/i);
    expect(
      await debeFallar(
        `INSERT INTO clinical_access (tenant_id, clinician_user_id, client_id, source, granted_by_user_id)
         VALUES ('${tenantId}', '${sanitariaId}', '${pacienteId}', 'MANUAL', NULL)`,
      ),
    ).toMatch(/clinical_access_source_grantor|violates check/i);
  });

  it("una revocación sin firma no entra", async () => {
    const accId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO clinical_access (id, tenant_id, clinician_user_id, client_id, source)
       VALUES ('${accId}', '${tenantId}', '${sanitariaId}', '${pacienteId}', 'APPOINTMENT')`,
    );
    expect(
      await debeFallar(
        `UPDATE clinical_access SET revoked_at = now() WHERE id = '${accId}'`,
      ),
    ).toMatch(/clinical_access_revocation_signed|violates check/i);
  });

  // ── 6 · CLINICIAN implica sanitario ───────────────────────────────

  it("no existe un CLINICIAN sin la marca sanitaria: lo niega el CHECK", async () => {
    expect(
      await debeFallar(
        `UPDATE users SET is_clinician = false WHERE id = '${sanitariaId}'`,
      ),
    ).toMatch(/users_clinician_implies_flag|violates check/i);
    expect(
      await debeFallar(
        // El `id` explícito no es adorno: `users.id` lleva su uuid del
        // cliente de Prisma (`@default(uuid())`), NO un DEFAULT de la
        // base. Sin él, el INSERT falla por el NOT NULL del id y el test
        // pasaría por el motivo equivocado.
        `INSERT INTO users (id, tenant_id, email, role, is_clinician)
         VALUES ('${randomUUID()}', '${tenantId}', 'falso-${randomUUID().slice(0, 8)}@c.es', 'CLINICIAN', false)`,
      ),
    ).toMatch(/users_clinician_implies_flag|violates check/i);
  });

  it("un colegiado en blanco no se guarda", async () => {
    expect(
      await debeFallar(
        `UPDATE users SET clinician_license = '   ' WHERE id = '${sanitariaId}'`,
      ),
    ).toMatch(/users_clinician_license_not_blank|violates check/i);
  });
});
