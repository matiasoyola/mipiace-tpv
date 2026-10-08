// clinica-4 · la tabla «sabotaje → test rojo» del consentimiento, la foto
// y la entrega, contra Postgres de verdad.
//
// Por qué tiene que ser e2e y no puede vivir con un prisma falso: lo que
// se prueba aquí es que **el MOTOR** lo rechaza, no que la aplicación se
// porte bien. Misma razón que `clinica-historia.e2e.ts` de clinica-1: la
// aplicación no es la única puerta a Postgres, y un consentimiento que
// sólo es inalterable mientras el código se porte bien no es inalterable.
// El día que a Mi Piace le pidan la historia de un paciente en un juzgado,
// lo que la defiende es el trigger.
//
// Cada sabotaje entra por `$executeRawUnsafe`: SQL directo, como lo
// escribiría alguien con acceso al VPS.
//
// Las garantías, una por bloque:
//
//   1. Un consentimiento firmado NO SE EDITA y NO SE BORRA.
//   2. Un PACIENTE con consentimiento NO SE BORRA (el CASCADE → RESTRICT
//      de S3), y tampoco su tenant ni el sanitario que informó.
//   3. Revocar es una FILA NUEVA enlazada, y no se revoca a sí misma.
//   4. Media plantilla no entra; un representante sin relación, tampoco;
//      un consentimiento clínico sin informante, tampoco.
//   5. Una foto NO SE BORRA y NO SE REESCRIBE: sólo se retira, una vez.
//   6. Una CITA CON FOTOS no se puede borrar (el SET NULL es un UPDATE
//      sobre una fila que el guard protege — la misma garantía más fuerte
//      que clinica-3 §6.1 descubrió).
//   7. La entrega de un informe es SÓLO INSERCIONES.
//   8. Y el alta manual del spa SIGUE ENTRANDO: sin plantilla, sin huella
//      y sin firmante.

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

const HUELLA = "a".repeat(64);

describe.skipIf(!e2eEnabled)(
  "e2e · clinica-4 · el consentimiento, la foto y la entrega",
  () => {
    if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

    const prisma = getPrisma();
    let tenantId = "";
    let sanitariaId = "";
    let pacienteId = "";
    let citaId = "";
    let consentId = "";
    let fotoId = "";

    beforeAll(async () => {
      tenantId = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO tenants (id, name, clinical_records_enabled, crm_enabled, agenda_enabled, updated_at)
         VALUES ('${tenantId}', 'Clínica del Pie ${tenantId.slice(0, 8)}', true, true, true, now())`,
      );
    });

    afterAll(async () => {
      // LIMPIEZA EN ESTE ORDEN, y es parte de lo que se prueba: con las
      // FKs en RESTRICT no se puede empezar por el tenant, y los triggers
      // rechazan el DELETE — hay que desactivarlos. Que limpiar sea
      // incómodo es exactamente la garantía funcionando.
      for (const [tabla, trigger] of [
        ["client_consents", "client_consents_append_only"],
        ["clinical_photos", "clinical_photos_guard"],
        [
          "clinical_report_deliveries",
          "clinical_report_deliveries_append_only",
        ],
      ]) {
        await prisma.$executeRawUnsafe(
          `ALTER TABLE ${tabla} DISABLE TRIGGER ${trigger}`,
        );
      }
      // Las revocaciones primero: apuntan a otra fila con RESTRICT.
      await prisma.$executeRawUnsafe(
        `DELETE FROM client_consents WHERE tenant_id = '${tenantId}' AND revokes_consent_id IS NOT NULL`,
      );
      for (const t of [
        "client_consents",
        "clinical_photos",
        "clinical_report_deliveries",
      ]) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM ${t} WHERE tenant_id = '${tenantId}'`,
        );
      }
      for (const [tabla, trigger] of [
        ["client_consents", "client_consents_append_only"],
        ["clinical_photos", "clinical_photos_guard"],
        [
          "clinical_report_deliveries",
          "clinical_report_deliveries_append_only",
        ],
      ]) {
        await prisma.$executeRawUnsafe(
          `ALTER TABLE ${tabla} ENABLE TRIGGER ${trigger}`,
        );
      }
      await prisma.$executeRawUnsafe(
        `DELETE FROM appointment_items WHERE appointment_id IN (SELECT id FROM appointments WHERE tenant_id = '${tenantId}')`,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM appointments WHERE tenant_id = '${tenantId}'`,
      );
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
      pacienteId = randomUUID();
      citaId = randomUUID();
      consentId = randomUUID();
      fotoId = randomUUID();

      await prisma.$executeRawUnsafe(
        `INSERT INTO users (id, tenant_id, email, alias, role, is_clinician, clinician_license, clinical_scope)
         VALUES ('${sanitariaId}', '${tenantId}', 'lucia-${sanitariaId.slice(0, 8)}@c.es', 'Lucía', 'CLINICIAN', true, '28/1234', 'ALL')`,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO clients (id, tenant_id, first_name, last_name, updated_at)
         VALUES ('${pacienteId}', '${tenantId}', 'Carmen', 'Rodríguez', now())`,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO appointments (id, tenant_id, client_id, status, timeslot, updated_at)
         VALUES ('${citaId}', '${tenantId}', '${pacienteId}', 'CONFIRMED',
                 tstzrange(now(), now() + interval '30 minutes'), now())`,
      );
      // El consentimiento clínico firmado, con todo congelado.
      await prisma.$executeRawUnsafe(
        `INSERT INTO client_consents
           (id, tenant_id, client_id, kind, template_id, template_version,
            text_sha256, pdf_sha256, pdf_file_name, clinical, signer,
            informer_user_id, created_by_user_id)
         VALUES ('${consentId}', '${tenantId}', '${pacienteId}', 'TREATMENT',
                 'cirugia-ungueal', 1, '${HUELLA}', '${HUELLA}',
                 '${randomUUID()}-aaaaaaaaaaaa.pdf', true, 'PACIENTE',
                 '${sanitariaId}', '${sanitariaId}')`,
      );
      // Y una foto.
      await prisma.$executeRawUnsafe(
        `INSERT INTO clinical_photos
           (id, tenant_id, client_id, appointment_id, zona, mapa_version,
            file_name, sha256, bytes, mime_type, author_user_id)
         VALUES ('${fotoId}', '${tenantId}', '${pacienteId}', '${citaId}',
                 'L:h', 1, '${randomUUID()}-bbbbbbbbbbbb.jpg', '${HUELLA}',
                 1234, 'image/jpeg', '${sanitariaId}')`,
      );
    });

    // ── 1 · el consentimiento no se edita ni se borra ────────────────

    it("un UPDATE del consentimiento falla", async () => {
      const msg = await debeFallar(
        `UPDATE client_consents SET revoke_reason = 'trucado' WHERE id = '${consentId}'`,
      );
      expect(msg).toContain("HISTORIA_VIOLADA");
      expect(msg).toContain("no se edita");
    });

    it("y cambiarle la HUELLA del PDF, también", async () => {
      // Es el caso que de verdad importa: si la huella se pudiera
      // reescribir, se podría cambiar el PDF del volumen y volver a
      // cuadrar la fila. La huella no demostraría nada.
      const msg = await debeFallar(
        `UPDATE client_consents SET pdf_sha256 = '${"b".repeat(64)}' WHERE id = '${consentId}'`,
      );
      expect(msg).toContain("HISTORIA_VIOLADA");
    });

    it("un DELETE del consentimiento falla", async () => {
      const msg = await debeFallar(
        `DELETE FROM client_consents WHERE id = '${consentId}'`,
      );
      expect(msg).toContain("HISTORIA_VIOLADA");
      expect(msg).toContain("no se borra");
      expect(msg).toContain("se firma una revocación");
    });

    // ── 2 · el paciente con consentimiento no se borra ───────────────

    it("BORRAR AL PACIENTE con un consentimiento firmado falla", async () => {
      // El CASCADE → RESTRICT de S3, condición 1. Antes de este bloque,
      // un paciente con sólo un consentimiento (sin sesiones, que sí son
      // RESTRICT desde clinica-1) se podía borrar y se llevaba el
      // documento por delante.
      const msg = await debeFallar(
        `DELETE FROM clients WHERE id = '${pacienteId}'`,
      );
      expect(msg).toContain("client_consents_client_id_fkey");
    });

    it("borrar el TENANT con consentimientos dentro, también", async () => {
      const msg = await debeFallar(
        `DELETE FROM tenants WHERE id = '${tenantId}'`,
      );
      expect(msg).toMatch(/client_consents|clinical_photos/);
    });

    it("y borrar al SANITARIO que informó, también", async () => {
      // Una fila firmada sin informante no es prueba de nada: la ley pide
      // que informe el profesional, y el profesional tiene que constar.
      const msg = await debeFallar(
        `DELETE FROM users WHERE id = '${sanitariaId}'`,
      );
      expect(msg).toMatch(/client_consents_informer_user_id_fkey|clinical_photos_author_user_id_fkey/);
    });

    // ── 3 · revocar es una fila nueva ────────────────────────────────

    it("la revocación entra como fila nueva y la original NO cambia", async () => {
      const revocacionId = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO client_consents
           (id, tenant_id, client_id, kind, template_id, template_version,
            text_sha256, clinical, informer_user_id, revokes_consent_id,
            revoke_reason)
         VALUES ('${revocacionId}', '${tenantId}', '${pacienteId}', 'TREATMENT',
                 'cirugia-ungueal', 1, '${HUELLA}', true, '${sanitariaId}',
                 '${consentId}', 'La paciente se lo pensó mejor')`,
      );
      const filas = await prisma.$queryRawUnsafe<
        Array<{ id: string; revokes_consent_id: string | null }>
      >(
        `SELECT id, revokes_consent_id FROM client_consents
          WHERE client_id = '${pacienteId}' ORDER BY granted_at`,
      );
      expect(filas).toHaveLength(2);
      expect(filas.filter((f) => f.revokes_consent_id != null)).toHaveLength(1);
    });

    it("una fila NO se revoca a sí misma", async () => {
      const id = randomUUID();
      const msg = await debeFallar(
        `INSERT INTO client_consents (id, tenant_id, client_id, kind, revokes_consent_id)
         VALUES ('${id}', '${tenantId}', '${pacienteId}', 'TREATMENT', '${id}')`,
      );
      expect(msg).toContain("client_consents_revoca_distinta");
    });

    it("y la revocación no puede apuntar al vacío", async () => {
      const msg = await debeFallar(
        `INSERT INTO client_consents (id, tenant_id, client_id, kind, revokes_consent_id)
         VALUES ('${randomUUID()}', '${tenantId}', '${pacienteId}', 'TREATMENT', '${randomUUID()}')`,
      );
      expect(msg).toContain("client_consents_revokes_consent_id_fkey");
    });

    // ── 4 · los CHECK de la fila ─────────────────────────────────────

    it("MEDIA PLANTILLA no entra", async () => {
      const msg = await debeFallar(
        `INSERT INTO client_consents (id, tenant_id, client_id, kind, template_id)
         VALUES ('${randomUUID()}', '${tenantId}', '${pacienteId}', 'TREATMENT', 'anestesia-local')`,
      );
      expect(msg).toContain("client_consents_plantilla_completa");
    });

    it("un REPRESENTANTE sin relación no entra", async () => {
      const msg = await debeFallar(
        `INSERT INTO client_consents (id, tenant_id, client_id, kind, signer, signer_name)
         VALUES ('${randomUUID()}', '${tenantId}', '${pacienteId}', 'TREATMENT', 'REPRESENTANTE', 'Ana')`,
      );
      expect(msg).toContain("client_consents_firmante_valido");
    });

    it("«firma el paciente» CON nombre de representante tampoco", async () => {
      const msg = await debeFallar(
        `INSERT INTO client_consents (id, tenant_id, client_id, kind, signer, signer_name, signer_relation)
         VALUES ('${randomUUID()}', '${tenantId}', '${pacienteId}', 'TREATMENT', 'PACIENTE', 'Ana', 'hija')`,
      );
      expect(msg).toContain("client_consents_firmante_valido");
    });

    it("y un consentimiento CLÍNICO sin informante, tampoco", async () => {
      const msg = await debeFallar(
        `INSERT INTO client_consents (id, tenant_id, client_id, kind, clinical)
         VALUES ('${randomUUID()}', '${tenantId}', '${pacienteId}', 'TREATMENT', true)`,
      );
      expect(msg).toContain("client_consents_clinica_exige_informante");
    });

    // ── 5 · la foto no se borra: se retira ───────────────────────────

    it("un DELETE de la foto falla", async () => {
      const msg = await debeFallar(
        `DELETE FROM clinical_photos WHERE id = '${fotoId}'`,
      );
      expect(msg).toContain("HISTORIA_VIOLADA");
      expect(msg).toContain("no se borra");
    });

    it("cambiarle la zona, el fichero o la huella falla", async () => {
      for (const campo of [
        "zona = 'R:talon'",
        `file_name = '${randomUUID()}-cccccccccccc.jpg'`,
        `sha256 = '${"c".repeat(64)}'`,
        "mapa_version = 2",
      ]) {
        const msg = await debeFallar(
          `UPDATE clinical_photos SET ${campo} WHERE id = '${fotoId}'`,
        );
        expect(msg, campo).toContain("no se reescribe");
      }
    });

    it("RETIRARLA sí pasa, y la fila sigue ahí", async () => {
      await prisma.$executeRawUnsafe(
        `UPDATE clinical_photos
            SET withdrawn_at = now(), withdrawn_by_user_id = '${sanitariaId}',
                withdraw_reason = 'Salió en blanco'
          WHERE id = '${fotoId}'`,
      );
      const filas = await prisma.$queryRawUnsafe<
        Array<{ id: string; withdraw_reason: string | null }>
      >(`SELECT id, withdraw_reason FROM clinical_photos WHERE id = '${fotoId}'`);
      expect(filas).toHaveLength(1);
      expect(filas[0]!.withdraw_reason).toBe("Salió en blanco");
    });

    it("y DESHACER la retirada falla", async () => {
      await prisma.$executeRawUnsafe(
        `UPDATE clinical_photos
            SET withdrawn_at = now(), withdrawn_by_user_id = '${sanitariaId}',
                withdraw_reason = 'Salió en blanco'
          WHERE id = '${fotoId}'`,
      );
      const msg = await debeFallar(
        `UPDATE clinical_photos SET withdrawn_at = NULL, withdrawn_by_user_id = NULL, withdraw_reason = NULL WHERE id = '${fotoId}'`,
      );
      expect(msg).toContain("ya está retirada");
    });

    it("una retirada A MEDIAS no entra", async () => {
      const msg = await debeFallar(
        `INSERT INTO clinical_photos
           (id, tenant_id, client_id, zona, mapa_version, file_name, sha256,
            bytes, mime_type, author_user_id, withdrawn_at)
         VALUES ('${randomUUID()}', '${tenantId}', '${pacienteId}', 'L:h', 1,
                 '${randomUUID()}-dddddddddddd.jpg', '${HUELLA}', 10,
                 'image/jpeg', '${sanitariaId}', now())`,
      );
      expect(msg).toContain("clinical_photos_retirada_completa");
    });

    it("dos filas con el MISMO fichero no entran", async () => {
      const nombre = `${randomUUID()}-eeeeeeeeeeee.jpg`;
      await prisma.$executeRawUnsafe(
        `INSERT INTO clinical_photos
           (id, tenant_id, client_id, zona, mapa_version, file_name, sha256,
            bytes, mime_type, author_user_id)
         VALUES ('${randomUUID()}', '${tenantId}', '${pacienteId}', 'L:h', 1,
                 '${nombre}', '${HUELLA}', 10, 'image/jpeg', '${sanitariaId}')`,
      );
      const msg = await debeFallar(
        `INSERT INTO clinical_photos
           (id, tenant_id, client_id, zona, mapa_version, file_name, sha256,
            bytes, mime_type, author_user_id)
         VALUES ('${randomUUID()}', '${tenantId}', '${pacienteId}', 'R:h', 1,
                 '${nombre}', '${HUELLA}', 10, 'image/jpeg', '${sanitariaId}')`,
      );
      // El mensaje llega con LA CLAVE que choca y no con el nombre del
      // índice: Prisma no reenvía el nombre en un 23505 por
      // `$executeRawUnsafe` (el hallazgo de clinica-3 §6.3). La clave dice
      // más, además: «este fichero ya tiene su fila».
      expect(msg).toContain("23505");
      expect(msg).toContain("Key (file_name)");
    });

    // ── 6 · la cita con fotos no se borra ────────────────────────────

    it("BORRAR LA CITA de una foto falla, y es una garantía más fuerte", async () => {
      // La FK dice `ON DELETE SET NULL` —la foto sobreviviría a su cita— y
      // ese SET NULL es un UPDATE sobre una fila que el guard protege. El
      // resultado es más fuerte que lo que la columna declara: una cita
      // con fotos no se puede borrar. Es el mismo descubrimiento que
      // clinica-3 §6.1 hizo con `clinical_entries`.
      const msg = await debeFallar(
        `DELETE FROM appointments WHERE id = '${citaId}'`,
      );
      expect(msg).toContain("HISTORIA_VIOLADA");
      expect(msg).toContain("no se reescribe");
    });

    // ── 7 · la entrega del informe ───────────────────────────────────

    it("la entrega es de SOLO INSERCIÓN", async () => {
      const entregaId = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO clinical_report_deliveries
           (id, tenant_id, client_id, report, channel, recipient,
            recipient_email, pdf_sha256, user_id)
         VALUES ('${entregaId}', '${tenantId}', '${pacienteId}', 'COMPLETA',
                 'EMAIL', 'PACIENTE', 'carmen@ejemplo.com', '${HUELLA}',
                 '${sanitariaId}')`,
      );
      const porUpdate = await debeFallar(
        `UPDATE clinical_report_deliveries SET recipient_email = 'otro@x.es' WHERE id = '${entregaId}'`,
      );
      expect(porUpdate).toContain("sólo inserciones");
      const porDelete = await debeFallar(
        `DELETE FROM clinical_report_deliveries WHERE id = '${entregaId}'`,
      );
      expect(porDelete).toContain("sólo inserciones");
    });

    it("un informe que no existe no se puede apuntar", async () => {
      const msg = await debeFallar(
        `INSERT INTO clinical_report_deliveries
           (id, tenant_id, client_id, report, channel, recipient, pdf_sha256, user_id)
         VALUES ('${randomUUID()}', '${tenantId}', '${pacienteId}', 'TODO',
                 'PRINT', 'PACIENTE', '${HUELLA}', '${sanitariaId}')`,
      );
      expect(msg).toContain("clinical_report_deliveries_report_valido");
    });

    it("por email sin dirección, y en papel CON dirección: las dos fallan", async () => {
      const sinEmail = await debeFallar(
        `INSERT INTO clinical_report_deliveries
           (id, tenant_id, client_id, report, channel, recipient, pdf_sha256, user_id)
         VALUES ('${randomUUID()}', '${tenantId}', '${pacienteId}', 'RESUMEN',
                 'EMAIL', 'PACIENTE', '${HUELLA}', '${sanitariaId}')`,
      );
      expect(sinEmail).toContain("clinical_report_deliveries_email_segun_canal");
      const conEmail = await debeFallar(
        `INSERT INTO clinical_report_deliveries
           (id, tenant_id, client_id, report, channel, recipient, recipient_email, pdf_sha256, user_id)
         VALUES ('${randomUUID()}', '${tenantId}', '${pacienteId}', 'RESUMEN',
                 'PRINT', 'PACIENTE', 'x@y.es', '${HUELLA}', '${sanitariaId}')`,
      );
      expect(conEmail).toContain(
        "clinical_report_deliveries_email_segun_canal",
      );
    });

    // ── 8 · el spa sigue dando de alta su consentimiento ─────────────

    it("EL ALTA MANUAL del spa sigue entrando, sin plantilla", async () => {
      // Lo que hoy funciona en la ficha del cliente sigue funcionando
      // (S3, condición 1). Sin plantilla, sin huella, sin firmante y sin
      // informante: una fila como las que ya hay en producción.
      const id = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO client_consents (id, tenant_id, client_id, kind, doc_ref)
         VALUES ('${id}', '${tenantId}', '${pacienteId}', 'DATA', 'papel en el archivador')`,
      );
      const filas = await prisma.$queryRawUnsafe<
        Array<{ template_id: string | null; clinical: boolean }>
      >(
        `SELECT template_id, clinical FROM client_consents WHERE id = '${id}'`,
      );
      expect(filas[0]!.template_id).toBeNull();
      // Y `clinical` nace en false: el del spa no pasa por el control de
      // acceso de la historia.
      expect(filas[0]!.clinical).toBe(false);
    });

    it("y los consentimientos de un servicio nacen VACÍOS", async () => {
      const productId = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO products (id, tenant_id, holded_product_id, name, kind, base_price, tax_rate)
         VALUES ('${productId}', '${tenantId}', 'h-${productId.slice(0, 8)}', 'Cirugía de uña', 'SERVICE', 60, 0)`,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO service_scheduling (product_id, tenant_id, duration_min, updated_at)
         VALUES ('${productId}', '${tenantId}', 45, now())`,
      );
      const filas = await prisma.$queryRawUnsafe<
        Array<{ consentimientos: string[] }>
      >(
        `SELECT consentimientos FROM service_scheduling WHERE product_id = '${productId}'`,
      );
      expect(filas[0]!.consentimientos).toEqual([]);

      // Y el tope de la lista, que es lo que para un psql de implantación.
      const msg = await debeFallar(
        `UPDATE service_scheduling SET consentimientos = ARRAY['a','b','c','d','e','f'] WHERE product_id = '${productId}'`,
      );
      expect(msg).toContain("service_scheduling_consentimientos_tope");

      await prisma.$executeRawUnsafe(
        `UPDATE service_scheduling SET consentimientos = ARRAY['cirugia-ungueal','anestesia-local'] WHERE product_id = '${productId}'`,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM service_scheduling WHERE product_id = '${productId}'`,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM products WHERE id = '${productId}'`,
      );
    });
  },
);
