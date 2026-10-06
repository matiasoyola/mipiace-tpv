// clinica-2 · la tabla «sabotaje → test rojo» de la valoración, contra
// Postgres de verdad.
//
// Por qué tiene que ser e2e y no puede vivir con un Prisma falso: lo que se
// prueba aquí es que **el MOTOR** lo rechaza, no que la aplicación se porte
// bien. Misma razón exacta que `clinica-historia.e2e.ts` de clinica-1 y que
// `sello-de-la-venta.e2e.ts` (ADR-015 §1): la aplicación no es la única
// puerta a Postgres, y una valoración que sólo es inalterable mientras el
// código se porte bien no es inalterable.
//
// Por eso cada sabotaje entra por `$executeRawUnsafe`: SQL directo, como lo
// escribiría alguien con acceso al VPS.
//
// Las garantías, una por bloque:
//
//   1. EL ACTOR DEL PACIENTE no puede autenticarse. Nunca, y en los dos
//      sentidos.
//   2. LO QUE CONTESTÓ EL PACIENTE no se edita ni se borra.
//   3. UNA SOLA VALORACIÓN ABIERTA por paciente — y los repasos caben.
//   4. EL ESTADO SÓLO AVANZA, y una VALIDADA queda congelada.
//   5. EL ENLACE es de un solo uso y no se reabre con un UPDATE.
//   6. VALIDAR exige las TRES confirmaciones y la firma.
//   7. LAS CORRECCIONES son append-only, y no se corrige ni lo no
//      contestado ni lo validado.
//   8. NADA DE ESTO SE BORRA: ni la valoración, ni el paciente que la
//      tiene, ni el actor que la escribió.

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

/** Un INSERT/UPDATE/DELETE tiene que FALLAR. Devuelve el mensaje real. */
async function debeFallar(sql: string): Promise<string> {
  const prisma = getPrisma();
  try {
    await prisma.$executeRawUnsafe(sql);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error(`El motor ACEPTÓ lo que no debía:\n${sql}`);
}

describe.skipIf(!e2eEnabled)("e2e · la valoración inicial no se reescribe", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let tenantId = "";
  let sanitariaId = "";
  let recepcionId = "";
  let actorPacienteId = "";
  let pacienteId = "";
  let valoracionId = "";
  let entryId = "";

  beforeAll(async () => {
    tenantId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO tenants (id, name, clinical_records_enabled, crm_enabled, agenda_enabled, updated_at)
       VALUES ('${tenantId}', 'Clínica del Pie ${tenantId.slice(0, 8)}', true, true, true, now())`,
    );
  });

  afterAll(async () => {
    // LIMPIEZA EN ESTE ORDEN, y es parte de lo que se prueba: con las FKs
    // en RESTRICT y los triggers puestos no se puede empezar por el
    // tenant. Que limpiar sea incómodo es la garantía funcionando.
    const triggers: Array<[string, string]> = [
      ["clinical_assessment_corrections", "clinical_assessment_corrections_append_only"],
      ["clinical_assessments", "clinical_assessments_guard"],
      ["clinical_entries", "clinical_entries_inmutable"],
      ["clinical_access_log", "clinical_access_log_append_only"],
      ["clinical_access", "clinical_access_guard"],
    ];
    for (const [tabla, trg] of triggers) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${tabla} DISABLE TRIGGER ${trg}`,
      );
    }
    for (const t of [
      "clinical_assessment_corrections",
      "clinical_assessments",
      "clinical_addenda",
      "clinical_entries",
      "clinical_access_log",
      "clinical_access",
    ]) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM ${t} WHERE tenant_id = '${tenantId}'`,
      );
    }
    for (const [tabla, trg] of triggers) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${tabla} ENABLE TRIGGER ${trg}`,
      );
    }
    await prisma.$executeRawUnsafe(
      `DELETE FROM clients WHERE tenant_id = '${tenantId}'`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM users WHERE tenant_id = '${tenantId}'`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM tenants WHERE id = '${tenantId}'`,
    );
    await shutdown();
  });

  beforeEach(async () => {
    sanitariaId = randomUUID();
    recepcionId = randomUUID();
    actorPacienteId = randomUUID();
    pacienteId = randomUUID();
    valoracionId = randomUUID();
    entryId = randomUUID();

    await prisma.$executeRawUnsafe(
      `INSERT INTO users (id, tenant_id, email, alias, role, is_clinician, clinician_license, clinical_scope)
       VALUES
         ('${sanitariaId}', '${tenantId}', 'lucia-${sanitariaId.slice(0, 8)}@c.es', 'Lucía', 'CLINICIAN', true, '28/1234', 'ALL'),
         ('${recepcionId}', '${tenantId}', 'marta-${recepcionId.slice(0, 8)}@c.es', 'Marta', 'CASHIER', false, NULL, 'SELECTION')`,
    );
    // El actor «paciente por enlace»: sin password y sin PIN.
    await prisma.$executeRawUnsafe(
      `INSERT INTO users (id, tenant_id, email, alias, role, is_system_actor)
       VALUES ('${actorPacienteId}', '${tenantId}', 'paciente-${actorPacienteId.slice(0, 8)}@enlace.local', 'Paciente (por enlace)', 'CASHIER', true)`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO clients (id, tenant_id, first_name, last_name, updated_at)
       VALUES ('${pacienteId}', '${tenantId}', 'Carmen', 'Rodríguez', now())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO clinical_assessments
         (id, tenant_id, client_id, questionnaire_version, channel, source,
          requested_by_user_id, link_token_hash, link_expires_at)
       VALUES ('${valoracionId}', '${tenantId}', '${pacienteId}', 1, 'EMAIL', 'MANUAL',
               '${recepcionId}', '${randomBytes(32).toString("hex")}', now() + interval '30 days')`,
    );
  });

  /** Mueve la valoración a RESPONDIDA con su entrada de historia. */
  async function responder(): Promise<void> {
    await prisma.$executeRawUnsafe(
      `INSERT INTO clinical_entries
         (id, tenant_id, client_id, author_user_id, kind, body)
       VALUES ('${entryId}', '${tenantId}', '${pacienteId}', '${actorPacienteId}',
               'INITIAL_ASSESSMENT',
               '{"valoracion":{"version":1,"canal":"EMAIL","respondioPor":"PACIENTE"},"respuestas":{"diab":"SI","antic":"NO_SE"},"detalles":{}}')`,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE clinical_assessments
          SET status = 'RESPONDIDA', entry_id = '${entryId}',
              answered_at = now(), answered_by = 'PACIENTE', link_used_at = now()
        WHERE id = '${valoracionId}'`,
    );
  }

  /** …y a VALIDADA, con las tres confirmaciones y su firma. */
  async function validar(): Promise<void> {
    await prisma.$executeRawUnsafe(
      `UPDATE clinical_assessments
          SET status = 'VALIDADA', confirmed_allergies = true,
              confirmed_medication = true, confirmed_alerts = true,
              validated_at = now(), validated_by_user_id = '${sanitariaId}'
        WHERE id = '${valoracionId}'`,
    );
  }

  // ── 1 · el actor del paciente no puede autenticarse ────────────────

  describe("1 · EL ACTOR «paciente por enlace» no puede entrar", () => {
    it("no se le puede CREAR con un PIN", async () => {
      const msg = await debeFallar(
        `INSERT INTO users (id, tenant_id, email, role, is_system_actor, pin_hash)
         VALUES ('${randomUUID()}', '${tenantId}', 'x-${randomUUID()}@enlace.local', 'CASHIER', true, 'hash')`,
      );
      expect(msg).toMatch(/users_system_actor_no_credentials/);
    });

    it("ni con una CONTRASEÑA", async () => {
      const msg = await debeFallar(
        `INSERT INTO users (id, tenant_id, email, role, is_system_actor, password_hash)
         VALUES ('${randomUUID()}', '${tenantId}', 'y-${randomUUID()}@enlace.local', 'CASHIER', true, 'hash')`,
      );
      expect(msg).toMatch(/users_system_actor_no_credentials/);
    });

    it("ni se le pueden poner DESPUÉS — que es el camino peligroso", async () => {
      const msg = await debeFallar(
        `UPDATE users SET pin_hash = 'hash' WHERE id = '${actorPacienteId}'`,
      );
      expect(msg).toMatch(/users_system_actor_no_credentials/);
    });

    it("ni se puede MARCAR como actor a alguien que ya tiene credenciales", async () => {
      await prisma.$executeRawUnsafe(
        `UPDATE users SET pin_hash = 'hash' WHERE id = '${recepcionId}'`,
      );
      const msg = await debeFallar(
        `UPDATE users SET is_system_actor = true WHERE id = '${recepcionId}'`,
      );
      expect(msg).toMatch(/users_system_actor_no_credentials/);
    });
  });

  // ── 2 · lo que contestó el paciente ────────────────────────────────

  describe("2 · LO QUE CONTESTÓ EL PACIENTE no se toca", () => {
    it("un UPDATE del cuerpo de la entrada falla", async () => {
      await responder();
      const msg = await debeFallar(
        `UPDATE clinical_entries SET body = '{"respuestas":{"diab":"NO"}}'
          WHERE id = '${entryId}'`,
      );
      expect(msg).toMatch(/HISTORIA_VIOLADA.*no se edita/s);
    });

    it("un DELETE de la entrada falla", async () => {
      await responder();
      const msg = await debeFallar(
        `DELETE FROM clinical_entries WHERE id = '${entryId}'`,
      );
      expect(msg).toMatch(/HISTORIA_VIOLADA.*no se borra/s);
    });

    it("y la valoración no puede reescribir CÓMO contestó", async () => {
      await responder();
      const msg = await debeFallar(
        `UPDATE clinical_assessments SET answered_by = 'FAMILIAR'
          WHERE id = '${valoracionId}'`,
      );
      expect(msg).toMatch(/no se reescribe/);
    });

    it("ni apuntar a OTRA entrada", async () => {
      await responder();
      const otra = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO clinical_entries (id, tenant_id, client_id, author_user_id, kind, body)
         VALUES ('${otra}', '${tenantId}', '${pacienteId}', '${actorPacienteId}', 'INITIAL_ASSESSMENT', '{"x":1}')`,
      );
      const msg = await debeFallar(
        `UPDATE clinical_assessments SET entry_id = '${otra}' WHERE id = '${valoracionId}'`,
      );
      expect(msg).toMatch(/no se reescribe/);
    });

    it("una entrada NOTE no puede ser «las respuestas» de una valoración", async () => {
      // La FK garantiza que la entrada existe; no que sea una valoración.
      // Sin el trigger, un `entry_id` equivocado haría que la pantalla
      // pintara otra cosa como si fueran las respuestas del paciente.
      const nota = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO clinical_entries (id, tenant_id, client_id, author_user_id, kind, body)
         VALUES ('${nota}', '${tenantId}', '${pacienteId}', '${sanitariaId}', 'NOTE', '{"nota":"x"}')`,
      );
      const msg = await debeFallar(
        `UPDATE clinical_assessments
            SET status = 'RESPONDIDA', entry_id = '${nota}',
                answered_at = now(), answered_by = 'PACIENTE'
          WHERE id = '${valoracionId}'`,
      );
      expect(msg).toMatch(/no es una valoración inicial \(es NOTE\)/);
    });

    it("ni la entrada de OTRO paciente", async () => {
      const otroPaciente = randomUUID();
      const suEntrada = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO clients (id, tenant_id, first_name, last_name, updated_at)
         VALUES ('${otroPaciente}', '${tenantId}', 'Antonio', 'Gil', now())`,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO clinical_entries (id, tenant_id, client_id, author_user_id, kind, body)
         VALUES ('${suEntrada}', '${tenantId}', '${otroPaciente}', '${actorPacienteId}', 'INITIAL_ASSESSMENT', '{"x":1}')`,
      );
      const msg = await debeFallar(
        `UPDATE clinical_assessments
            SET status = 'RESPONDIDA', entry_id = '${suEntrada}',
                answered_at = now(), answered_by = 'PACIENTE'
          WHERE id = '${valoracionId}'`,
      );
      expect(msg).toMatch(/es de otro paciente/);
    });

    it("y una RESPONDIDA sin entrada no cabe: sería decir que contestó y no enseñar nada", async () => {
      const msg = await debeFallar(
        `UPDATE clinical_assessments SET status = 'RESPONDIDA' WHERE id = '${valoracionId}'`,
      );
      expect(msg).toMatch(/clinical_assessments_respuestas_segun_estado/);
    });
  });

  // ── 3 · una abierta por paciente, y los repasos caben ──────────────

  describe("3 · UNA SOLA VALORACIÓN ABIERTA por paciente", () => {
    it("dos abiertas a la vez: la segunda la rechaza el ÍNDICE", async () => {
      const msg = await debeFallar(
        `INSERT INTO clinical_assessments
           (id, tenant_id, client_id, questionnaire_version, channel, source, requested_by_user_id)
         VALUES ('${randomUUID()}', '${tenantId}', '${pacienteId}', 1, 'TABLET', 'MANUAL', '${recepcionId}')`,
      );
      // Prisma no reenvía el NOMBRE del índice en un 23505, sólo la clave
      // que choca. Se comprueban la clave y el código, que es lo que hay.
      expect(msg).toMatch(/Code: `23505`/);
      expect(msg).toContain(`Key (client_id)=(${pacienteId}) already exists`);
    });

    it("PERO TRAS VALIDAR sí cabe un repaso (decisión de producto 7)", async () => {
      await responder();
      await validar();
      const repaso = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO clinical_assessments
           (id, tenant_id, client_id, questionnaire_version, channel, source, requested_by_user_id,
            link_token_hash, link_expires_at)
         VALUES ('${repaso}', '${tenantId}', '${pacienteId}', 1, 'EMAIL', 'MANUAL', '${recepcionId}',
                 '${randomBytes(32).toString("hex")}', now() + interval '30 days')`,
      );
      const filas = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM clinical_assessments WHERE client_id = '${pacienteId}'`,
      );
      expect(Number(filas[0]!.n)).toBe(2);
    });

    it("y dos VALIDADAS también: la historia guarda todos los repasos", async () => {
      await responder();
      await validar();
      const segunda = randomUUID();
      const suEntrada = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO clinical_assessments
           (id, tenant_id, client_id, questionnaire_version, channel, source, requested_by_user_id)
         VALUES ('${segunda}', '${tenantId}', '${pacienteId}', 1, 'TABLET', 'MANUAL', '${recepcionId}')`,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO clinical_entries (id, tenant_id, client_id, author_user_id, kind, body)
         VALUES ('${suEntrada}', '${tenantId}', '${pacienteId}', '${actorPacienteId}', 'INITIAL_ASSESSMENT', '{"respuestas":{}}')`,
      );
      await prisma.$executeRawUnsafe(
        `UPDATE clinical_assessments
            SET status = 'VALIDADA', entry_id = '${suEntrada}', answered_at = now(),
                answered_by = 'PACIENTE', confirmed_allergies = true,
                confirmed_medication = true, confirmed_alerts = true,
                validated_at = now(), validated_by_user_id = '${sanitariaId}'
          WHERE id = '${segunda}'`,
      );
      const filas = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM clinical_assessments
          WHERE client_id = '${pacienteId}' AND status = 'VALIDADA'`,
      );
      expect(Number(filas[0]!.n)).toBe(2);
    });
  });

  // ── 4 · el estado sólo avanza ──────────────────────────────────────

  describe("4 · EL ESTADO SÓLO AVANZA", () => {
    it("de RESPONDIDA no se vuelve a PENDIENTE", async () => {
      await responder();
      const msg = await debeFallar(
        `UPDATE clinical_assessments
            SET status = 'PENDIENTE_PACIENTE', entry_id = NULL, answered_at = NULL,
                answered_by = NULL, link_used_at = NULL
          WHERE id = '${valoracionId}'`,
      );
      expect(msg).toMatch(/no vuelve atrás/);
    });

    it("de VALIDADA no se vuelve a RESPONDIDA: des-validar no existe", async () => {
      await responder();
      await validar();
      const msg = await debeFallar(
        `UPDATE clinical_assessments SET status = 'RESPONDIDA' WHERE id = '${valoracionId}'`,
      );
      expect(msg).toMatch(/ya está validada y no se edita/);
    });

    it("y una VALIDADA queda CONGELADA: ni una confirmación se desmarca", async () => {
      await responder();
      await validar();
      const msg = await debeFallar(
        `UPDATE clinical_assessments SET confirmed_alerts = false WHERE id = '${valoracionId}'`,
      );
      expect(msg).toMatch(/ya está validada y no se edita/);
    });

    it("la identidad no se reescribe: ni de qué paciente es, ni con qué versión", async () => {
      for (const sql of [
        `UPDATE clinical_assessments SET client_id = '${randomUUID()}' WHERE id = '${valoracionId}'`,
        `UPDATE clinical_assessments SET questionnaire_version = 2 WHERE id = '${valoracionId}'`,
        `UPDATE clinical_assessments SET source = 'APPOINTMENT' WHERE id = '${valoracionId}'`,
        `UPDATE clinical_assessments SET created_at = now() - interval '1 year' WHERE id = '${valoracionId}'`,
      ]) {
        const msg = await debeFallar(sql);
        expect(msg).toMatch(/HISTORIA_VIOLADA/);
      }
    });
  });

  // ── 5 · el enlace ──────────────────────────────────────────────────

  describe("5 · EL ENLACE es de un solo uso", () => {
    it("un enlace ya usado NO se reabre con un UPDATE", async () => {
      await responder();
      const msg = await debeFallar(
        `UPDATE clinical_assessments SET link_used_at = NULL WHERE id = '${valoracionId}'`,
      );
      expect(msg).toMatch(/ya se usó y no se reabre/);
    });

    it("ni se le mueve la fecha de uso", async () => {
      await responder();
      const msg = await debeFallar(
        `UPDATE clinical_assessments SET link_used_at = now() - interval '1 day'
          WHERE id = '${valoracionId}'`,
      );
      expect(msg).toMatch(/ya se usó y no se reabre/);
    });

    it("un token SIN CADUCIDAD no cabe", async () => {
      const msg = await debeFallar(
        `UPDATE clinical_assessments SET link_expires_at = NULL WHERE id = '${valoracionId}'`,
      );
      expect(msg).toMatch(/clinical_assessments_enlace_caduca/);
    });

    it("y un enlace «usado» sin respuestas tampoco", async () => {
      const msg = await debeFallar(
        `UPDATE clinical_assessments SET link_used_at = now() WHERE id = '${valoracionId}'`,
      );
      expect(msg).toMatch(/clinical_assessments_enlace_usado_para_responder/);
    });

    it("dos valoraciones no comparten token", async () => {
      const hash = randomBytes(32).toString("hex");
      await prisma.$executeRawUnsafe(
        `UPDATE clinical_assessments SET link_token_hash = '${hash}' WHERE id = '${valoracionId}'`,
      );
      await responder();
      await validar();
      const msg = await debeFallar(
        `INSERT INTO clinical_assessments
           (id, tenant_id, client_id, questionnaire_version, channel, source, requested_by_user_id,
            link_token_hash, link_expires_at)
         VALUES ('${randomUUID()}', '${tenantId}', '${pacienteId}', 1, 'EMAIL', 'MANUAL', '${recepcionId}',
                 '${hash}', now() + interval '1 day')`,
      );
      expect(msg).toMatch(/Code: `23505`/);
      expect(msg).toContain("Key (link_token_hash)=(");
    });
  });

  // ── 6 · validar ────────────────────────────────────────────────────

  describe("6 · VALIDAR exige las tres confirmaciones y la firma", () => {
    it("con DOS confirmaciones, el motor la rechaza", async () => {
      await responder();
      const msg = await debeFallar(
        `UPDATE clinical_assessments
            SET status = 'VALIDADA', confirmed_allergies = true, confirmed_medication = true,
                validated_at = now(), validated_by_user_id = '${sanitariaId}'
          WHERE id = '${valoracionId}'`,
      );
      expect(msg).toMatch(/clinical_assessments_validada_firmada/);
    });

    it("con las tres y SIN FIRMA, tampoco", async () => {
      await responder();
      const msg = await debeFallar(
        `UPDATE clinical_assessments
            SET status = 'VALIDADA', confirmed_allergies = true,
                confirmed_medication = true, confirmed_alerts = true
          WHERE id = '${valoracionId}'`,
      );
      expect(msg).toMatch(/clinical_assessments_validada_firmada/);
    });

    it("firmar SIN validar tampoco cabe: sería una firma que no significa nada", async () => {
      await responder();
      const msg = await debeFallar(
        `UPDATE clinical_assessments
            SET validated_at = now(), validated_by_user_id = '${sanitariaId}'
          WHERE id = '${valoracionId}'`,
      );
      expect(msg).toMatch(/clinical_assessments_sin_validar_sin_firma/);
    });

    it("ni una fecha sin autor", async () => {
      await responder();
      const msg = await debeFallar(
        `UPDATE clinical_assessments
            SET status = 'VALIDADA', confirmed_allergies = true, confirmed_medication = true,
                confirmed_alerts = true, validated_at = now()
          WHERE id = '${valoracionId}'`,
      );
      expect(msg).toMatch(/clinical_assessments_firma_completa/);
    });

    it("ni validar ANTES de que el paciente conteste", async () => {
      await responder();
      const msg = await debeFallar(
        `UPDATE clinical_assessments
            SET status = 'VALIDADA', confirmed_allergies = true, confirmed_medication = true,
                confirmed_alerts = true,
                validated_at = now() - interval '2 days', validated_by_user_id = '${sanitariaId}'
          WHERE id = '${valoracionId}'`,
      );
      expect(msg).toMatch(/clinical_assessments_validada_despues/);
    });

    it("con las TRES y la firma, SÍ", async () => {
      await responder();
      await validar();
      const filas = await prisma.$queryRawUnsafe<
        Array<{ status: string; validated_by_user_id: string }>
      >(
        `SELECT status, validated_by_user_id FROM clinical_assessments WHERE id = '${valoracionId}'`,
      );
      expect(filas[0]).toMatchObject({
        status: "VALIDADA",
        validated_by_user_id: sanitariaId,
      });
    });
  });

  // ── 7 · las correcciones ───────────────────────────────────────────

  describe("7 · LAS CORRECCIONES son append-only", () => {
    async function corregir(valor: string): Promise<string> {
      const id = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO clinical_assessment_corrections
           (id, tenant_id, assessment_id, question_id, value, author_user_id)
         VALUES ('${id}', '${tenantId}', '${valoracionId}', 'antic', '${valor}', '${sanitariaId}')`,
      );
      return id;
    }

    it("corregir dos veces deja DOS filas: manda la última y las dos se quedan", async () => {
      await responder();
      await corregir("SI");
      await corregir("NO");
      const filas = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM clinical_assessment_corrections
          WHERE assessment_id = '${valoracionId}'`,
      );
      expect(Number(filas[0]!.n)).toBe(2);
    });

    it("un UPDATE de una corrección falla", async () => {
      await responder();
      const id = await corregir("SI");
      const msg = await debeFallar(
        `UPDATE clinical_assessment_corrections SET value = 'NO' WHERE id = '${id}'`,
      );
      expect(msg).toMatch(/HISTORIA_VIOLADA.*no se edita/s);
    });

    it("un DELETE de una corrección falla", async () => {
      await responder();
      const id = await corregir("SI");
      const msg = await debeFallar(
        `DELETE FROM clinical_assessment_corrections WHERE id = '${id}'`,
      );
      expect(msg).toMatch(/HISTORIA_VIOLADA.*no se borra/s);
    });

    it("no se corrige lo que NADIE HA CONTESTADO", async () => {
      const msg = await debeFallar(
        `INSERT INTO clinical_assessment_corrections
           (id, tenant_id, assessment_id, question_id, value, author_user_id)
         VALUES ('${randomUUID()}', '${tenantId}', '${valoracionId}', 'diab', 'SI', '${sanitariaId}')`,
      );
      expect(msg).toMatch(/todavía no la ha contestado el paciente/);
    });

    it("NI LO VALIDADO: si no, la firma protegería la cáscara y no el contenido", async () => {
      // La fila de la valoración está congelada por su guarda, pero la
      // lista de correcciones es la que decide qué vale HOY. Sin este
      // trigger, validar no protegería las alertas.
      await responder();
      await validar();
      const msg = await debeFallar(
        `INSERT INTO clinical_assessment_corrections
           (id, tenant_id, assessment_id, question_id, value, author_user_id)
         VALUES ('${randomUUID()}', '${tenantId}', '${valoracionId}', 'diab', 'NO', '${sanitariaId}')`,
      );
      expect(msg).toMatch(/ya está validada y no se corrige/);
    });

    it("una corrección de otro negocio no entra", async () => {
      await responder();
      const otroTenant = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO tenants (id, name, updated_at) VALUES ('${otroTenant}', 'Otro', now())`,
      );
      const msg = await debeFallar(
        `INSERT INTO clinical_assessment_corrections
           (id, tenant_id, assessment_id, question_id, value, author_user_id)
         VALUES ('${randomUUID()}', '${otroTenant}', '${valoracionId}', 'diab', 'SI', '${sanitariaId}')`,
      );
      expect(msg).toMatch(/no son del mismo negocio/);
      await prisma.$executeRawUnsafe(
        `DELETE FROM tenants WHERE id = '${otroTenant}'`,
      );
    });

    it("una corrección con la pregunta en blanco no entra", async () => {
      await responder();
      const msg = await debeFallar(
        `INSERT INTO clinical_assessment_corrections
           (id, tenant_id, assessment_id, question_id, value, author_user_id)
         VALUES ('${randomUUID()}', '${tenantId}', '${valoracionId}', '   ', 'SI', '${sanitariaId}')`,
      );
      expect(msg).toMatch(/question_not_blank/);
    });
  });

  // ── 8 · nada de esto se borra ──────────────────────────────────────

  describe("8 · NADA DE ESTO SE BORRA", () => {
    it("una valoración no se borra", async () => {
      const msg = await debeFallar(
        `DELETE FROM clinical_assessments WHERE id = '${valoracionId}'`,
      );
      expect(msg).toMatch(/una valoración inicial no se borra/);
    });

    it("BORRAR AL PACIENTE con valoración falla", async () => {
      const msg = await debeFallar(
        `DELETE FROM clients WHERE id = '${pacienteId}'`,
      );
      expect(msg).toMatch(/clinical_assessments_client_id_fkey/);
    });

    it("BORRAR AL ACTOR que escribió las respuestas falla", async () => {
      await responder();
      const msg = await debeFallar(
        `DELETE FROM users WHERE id = '${actorPacienteId}'`,
      );
      expect(msg).toMatch(/clinical_entries_author_user_id_fkey/);
    });

    it("BORRAR A QUIEN MANDÓ el test falla", async () => {
      const msg = await debeFallar(
        `DELETE FROM users WHERE id = '${recepcionId}'`,
      );
      expect(msg).toMatch(/clinical_assessments_requested_by_user_id_fkey/);
    });

    it("BORRAR A QUIEN VALIDÓ falla", async () => {
      await responder();
      await validar();
      const msg = await debeFallar(
        `DELETE FROM users WHERE id = '${sanitariaId}'`,
      );
      expect(msg).toMatch(/clinical_assessments_validated_by_user_id_fkey/);
    });

    it("BORRAR EL TENANT con valoraciones falla", async () => {
      const msg = await debeFallar(
        `DELETE FROM tenants WHERE id = '${tenantId}'`,
      );
      // Cuál de las FKs clínicas salta depende de lo que haya en la base;
      // lo que se fija es que ALGUNA lo impide, y que es una FK clínica.
      expect(msg).toMatch(/violates foreign key constraint "clinical_\w+_tenant_id_fkey"/);
    });

    /**
     * Una cita del paciente y una valoración atada A ELLA DESDE EL INSERT,
     * que es lo que hace producción: el enganche de `agenda/store.ts` crea
     * la valoración con su `appointment_id` puesto, y nadie la ata después.
     *
     * La del `beforeEach` ocupa el hueco de «una abierta por paciente», así
     * que primero se valida — por el mismo camino de la decisión 7.
     */
    async function conCita(desdeHoras: number): Promise<[string, string]> {
      const citaId = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO appointments (id, tenant_id, mode, client_id, timeslot, status, source, updated_at)
         VALUES ('${citaId}', '${tenantId}', 'APPOINTMENT', '${pacienteId}',
                 tstzrange(now() + interval '${desdeHoras} hours',
                           now() + interval '${desdeHoras + 1} hours', '[)'),
                 'CONFIRMED', 'PRESENCIAL', now())`,
      );
      await responder();
      await validar();
      const suValoracion = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO clinical_assessments
           (id, tenant_id, client_id, appointment_id, questionnaire_version,
            channel, source, requested_by_user_id)
         VALUES ('${suValoracion}', '${tenantId}', '${pacienteId}', '${citaId}', 1,
                 'EMAIL', 'APPOINTMENT', NULL)`,
      );
      return [citaId, suValoracion];
    }

    it("PERO la cita SÍ se puede ir, y la valoración se queda entera", async () => {
      // `ON DELETE SET NULL`: la valoración pierde el enlace a la cita, no
      // el contenido. Es la única excepción que la guarda deja pasar, y sin
      // esa rendija borrar una cita con valoración fallaría con un mensaje
      // de trigger en vez de dejar la valoración huérfana y entera.
      const [citaId, suValoracion] = await conCita(1);
      await prisma.$executeRawUnsafe(
        `DELETE FROM appointments WHERE id = '${citaId}'`,
      );
      const filas = await prisma.$queryRawUnsafe<
        Array<{ appointment_id: string | null; status: string }>
      >(
        `SELECT appointment_id, status FROM clinical_assessments
          WHERE id = '${suValoracion}'`,
      );
      expect(filas[0]).toEqual({
        appointment_id: null,
        status: "PENDIENTE_PACIENTE",
      });
    });

    it("…y NO se puede ATAR ni MOVER a otra cita: la valoración no viaja", async () => {
      // Las dos direcciones están cerradas y ninguna hace falta: el
      // enganche de la agenda crea la valoración con su cita dentro. Dejar
      // abierto el NULL→valor permitiría colgar una valoración de la cita
      // de otra persona con un solo UPDATE.
      const [, suValoracion] = await conCita(2);
      const otraCita = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO appointments (id, tenant_id, mode, client_id, timeslot, status, source, updated_at)
         VALUES ('${otraCita}', '${tenantId}', 'APPOINTMENT', '${pacienteId}',
                 tstzrange(now() + interval '9 hours', now() + interval '10 hours', '[)'),
                 'CONFIRMED', 'PRESENCIAL', now())`,
      );
      const mover = await debeFallar(
        `UPDATE clinical_assessments SET appointment_id = '${otraCita}'
          WHERE id = '${suValoracion}'`,
      );
      expect(mover).toMatch(/no se mueve de cita/);

      const atar = await debeFallar(
        `UPDATE clinical_assessments SET appointment_id = '${otraCita}'
          WHERE id = '${valoracionId}'`,
      );
      expect(atar).toMatch(/no se mueve de cita/);
    });
  });
});
