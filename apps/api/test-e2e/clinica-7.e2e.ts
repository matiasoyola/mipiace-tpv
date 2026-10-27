// clinica-7 · la tabla «sabotaje → test rojo» del blindaje, contra
// Postgres de verdad.
//
// Por qué tiene que ser e2e y no puede vivir con un prisma falso: lo que
// se prueba aquí es que **EL MOTOR** lo rechaza, no que la aplicación se
// porte bien. Misma razón que clinica-1 y clinica-4: la aplicación no es la
// única puerta a Postgres, y una historia que solo es ilegible mientras el
// código se porte bien no es ilegible.
//
// Cada sabotaje entra por `$executeRawUnsafe`: SQL directo, como lo
// escribiría alguien con acceso al VPS.
//
// Las garantías, una por bloque:
//
//   1. La aceptación del contrato NO SE EDITA y NO SE BORRA. Revocar es una
//      fila nueva enlazada, y no se revoca a sí misma.
//   2. Las columnas cifradas SOLO ADMITEN CIPHERTEXT: un `UPDATE` que meta
//      «diabetes tipo 2» en `body_cifrado` lo rechaza el CHECK.
//   3. La clave de una clínica NO SE BORRA y NO SE RESUCITA: se re-envuelve
//      (sin tocar el canario) o se destruye (con su fecha).
//   4. Los triggers de inmutabilidad dejan pasar EXACTAMENTE el cifrado:
//      poner el cifrado y vaciar el claro, y nada más.
//   5. El código del enlace no se reescribe y sus fallos no bajan.
//   6. **LA BASE VOLCADA ENTERA NO CONTIENE NI UN TEXTO CLÍNICO EN
//      CLARO.** El grep del canario sobre el volcado, que es el sabotaje
//      que el prompt pide y el que de verdad contesta la pregunta.

import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { E2E_DATABASE_URL, e2eEnabled, SKIP_MESSAGE } from "./e2e-env.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  E2E_DATABASE_URL || "postgresql://e2e:e2e@127.0.0.1:5432/e2e";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET = "e".repeat(40);
process.env.JWT_REFRESH_SECRET = "f".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
process.env.CLINICAL_KEK = randomBytes(32).toString("base64");
process.env.CLINICAL_KEK_ID = "e2e";

const { getPrisma, shutdown } = await import("../src/context.js");
const { asegurarDek } = await import("../src/clinica/claves.js");
const { cifrarJson, sitioEntrada } = await import(
  "../src/clinica/cripto-campos.js"
);

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

/** Y uno que SÍ tiene que pasar. Falla con el mensaje de dentro. */
async function debePasar(sql: string): Promise<void> {
  await getPrisma().$executeRawUnsafe(sql);
}

const HUELLA = "a".repeat(64);
/** El texto que se busca en el volcado. Único y reconocible. */
const CANARIO = `CANARIO-CLINICA7-${randomUUID()}`;

describe.skipIf(!e2eEnabled)("e2e · clinica-7 · el blindaje", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let tenantId = "";
  let otroTenantId = "";
  let duenaId = "";
  let pacienteId = "";
  let aceptacionId = "";
  let entradaId = "";

  beforeAll(async () => {
    tenantId = randomUUID();
    otroTenantId = randomUUID();
    duenaId = randomUUID();
    pacienteId = randomUUID();

    for (const t of [tenantId, otroTenantId]) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO tenants (id, name, clinical_records_enabled, crm_enabled, agenda_enabled, updated_at)
         VALUES ('${t}', 'Clínica ${t.slice(0, 8)}', true, true, true, now())`,
      );
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO users (id, tenant_id, email, password_hash, role, is_clinician, clinical_scope)
       VALUES ('${duenaId}', '${tenantId}', 'duena-${duenaId}@c.es', 'x', 'OWNER', true, 'ALL')`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO clients (id, tenant_id, first_name, last_name, updated_at)
       VALUES ('${pacienteId}', '${tenantId}', 'Carmen', 'Rodríguez', now())`,
    );

    // La aceptación del contrato.
    aceptacionId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO clinical_processor_agreements
         (id, tenant_id, version, text_sha256, user_id)
       VALUES ('${aceptacionId}', '${tenantId}', 1, '${HUELLA}', '${duenaId}')`,
    );

    // Y UNA ENTRADA DE HISTORIA CIFRADA DE VERDAD, con el canario dentro.
    // Cifrada con la DEK de esta clínica y su AAD, por el MISMO código que
    // la API: es lo que hace que el grep del volcado pruebe algo.
    entradaId = randomUUID();
    const dek = await asegurarDek(tenantId, prisma);
    const cuerpo = { texto: CANARIO, dolor: 7 };
    const cifrado = cifrarJson(cuerpo, dek, sitioEntrada(tenantId, entradaId));
    await prisma.$executeRawUnsafe(
      `INSERT INTO clinical_entries
         (id, tenant_id, client_id, author_user_id, kind, body, body_cifrado)
       VALUES ('${entradaId}', '${tenantId}', '${pacienteId}', '${duenaId}',
               'NOTE', '{"cifrado": true}'::jsonb, '${cifrado}')`,
    );
  });

  afterAll(async () => {
    // LIMPIEZA, y que sea incómoda es la garantía funcionando: con los
    // triggers puestos no se puede borrar nada de esto.
    for (const [tabla, trigger] of [
      ["clinical_processor_agreements", "clinical_processor_agreements_append_only"],
      ["clinical_entries", "clinical_entries_inmutable"],
      ["clinical_tenant_keys", "clinical_tenant_keys_guard"],
    ]) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${tabla} DISABLE TRIGGER ${trigger}`,
      );
    }
    await prisma.$executeRawUnsafe(
      `DELETE FROM clinical_processor_agreements WHERE tenant_id = '${tenantId}' AND revokes_agreement_id IS NOT NULL`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM clinical_processor_agreements WHERE tenant_id = '${tenantId}'`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM clinical_entries WHERE tenant_id = '${tenantId}'`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM clinical_tenant_keys WHERE tenant_id IN ('${tenantId}', '${otroTenantId}')`,
    );
    for (const [tabla, trigger] of [
      ["clinical_processor_agreements", "clinical_processor_agreements_append_only"],
      ["clinical_entries", "clinical_entries_inmutable"],
      ["clinical_tenant_keys", "clinical_tenant_keys_guard"],
    ]) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${tabla} ENABLE TRIGGER ${trigger}`,
      );
    }
    await prisma.$executeRawUnsafe(
      `DELETE FROM clients WHERE tenant_id = '${tenantId}'`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM users WHERE tenant_id = '${tenantId}'`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM tenants WHERE id IN ('${tenantId}', '${otroTenantId}')`,
    );
    await shutdown();
  });

  // ── 1 · EL CONTRATO: SOLO INSERCIONES ─────────────────────────────

  describe("la aceptación del contrato no se edita ni se borra", () => {
    it("UPDATE de la versión → rechazado", async () => {
      const msg = await debeFallar(
        `UPDATE clinical_processor_agreements SET version = 2 WHERE id = '${aceptacionId}'`,
      );
      expect(msg).toContain("CONTRATO_VIOLADO");
      expect(msg).toContain("no se edita");
    });

    it("UPDATE de la huella del texto → rechazado", async () => {
      // El peor de todos: cambiar la huella es decir que se aceptó otro
      // texto.
      const msg = await debeFallar(
        `UPDATE clinical_processor_agreements SET text_sha256 = '${"b".repeat(64)}' WHERE id = '${aceptacionId}'`,
      );
      expect(msg).toContain("CONTRATO_VIOLADO");
    });

    it("DELETE → rechazado", async () => {
      const msg = await debeFallar(
        `DELETE FROM clinical_processor_agreements WHERE id = '${aceptacionId}'`,
      );
      expect(msg).toContain("no se borra");
    });

    it("una huella que no es SHA-256 → rechazada por el CHECK", async () => {
      const msg = await debeFallar(
        `INSERT INTO clinical_processor_agreements (tenant_id, version, text_sha256, user_id)
         VALUES ('${tenantId}', 1, 'NO-ES-UNA-HUELLA', '${duenaId}')`,
      );
      expect(msg).toContain("clinical_processor_agreements_sha256");
    });

    it("el TEXTO del contrato no cabe en la columna de la huella", async () => {
      // CHAR(64): miles de caracteres no entran. «Lo guardo entero, que es
      // más fácil» lo rechaza Postgres y no una revisión de código.
      const msg = await debeFallar(
        `INSERT INTO clinical_processor_agreements (tenant_id, version, text_sha256, user_id)
         VALUES ('${tenantId}', 1, '${"x".repeat(200)}', '${duenaId}')`,
      );
      expect(msg.toLowerCase()).toMatch(/too long|value too long|check/);
    });

    it("una versión 0 → rechazada", async () => {
      const msg = await debeFallar(
        `INSERT INTO clinical_processor_agreements (tenant_id, version, text_sha256, user_id)
         VALUES ('${tenantId}', 0, '${HUELLA}', '${duenaId}')`,
      );
      expect(msg).toContain("version_positiva");
    });

    it("una fila que se revoca A SÍ MISMA → rechazada", async () => {
      const id = randomUUID();
      const msg = await debeFallar(
        `INSERT INTO clinical_processor_agreements (id, tenant_id, version, text_sha256, user_id, revokes_agreement_id)
         VALUES ('${id}', '${tenantId}', 1, '${HUELLA}', '${duenaId}', '${id}')`,
      );
      expect(msg).toContain("revoca_distinta");
    });

    it("y REVOCAR SÍ entra: es una fila nueva enlazada", async () => {
      await debePasar(
        `INSERT INTO clinical_processor_agreements (tenant_id, version, text_sha256, user_id, revokes_agreement_id)
         VALUES ('${tenantId}', 1, '${HUELLA}', '${duenaId}', '${aceptacionId}')`,
      );
      const filas = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM clinical_processor_agreements WHERE tenant_id = '${tenantId}'`,
      );
      expect(Number(filas[0]!.n)).toBe(2);
    });

    it("el usuario que aceptó NO SE BORRA", async () => {
      // RESTRICT. Una aceptación sin autor no demuestra nada.
      const msg = await debeFallar(
        `DELETE FROM users WHERE id = '${duenaId}'`,
      );
      expect(msg.toLowerCase()).toContain("foreign key");
    });
  });

  // ── 2 · LAS COLUMNAS CIFRADAS SOLO ADMITEN CIPHERTEXT ─────────────

  describe("las columnas cifradas no admiten texto en claro", () => {
    const EN_CLARO = "diabetes tipo 2 mal controlada";
    // Una fila SIN cifrar todavía, que es la que ejercita el CHECK.
    //
    // Sobre una fila ya cifrada el trigger rechaza antes (reescribir un
    // ciphertext no es una transición legítima), así que el CHECK ni
    // llegaría a correr. Lo encontró la primera pasada de este fichero: el
    // mensaje que salía era `HISTORIA_VIOLADA` y no el del CHECK.
    //
    // Las DOS garantías existen y son distintas: el trigger impide que una
    // fila escrita cambie, y el CHECK impide que **el texto en claro
    // quepa** — también en un INSERT, donde no hay trigger que valga.
    let sinCifrar = "";

    beforeAll(async () => {
      sinCifrar = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO clinical_entries
           (id, tenant_id, client_id, author_user_id, kind, body)
         VALUES ('${sinCifrar}', '${tenantId}', '${pacienteId}', '${duenaId}',
                 'NOTE', '{"texto": "sin cifrar"}'::jsonb)`,
      );
    });

    it("`clinical_entries.body_cifrado` con texto en claro → rechazado", async () => {
      const msg = await debeFallar(
        `UPDATE clinical_entries SET body_cifrado = '${EN_CLARO}' WHERE id = '${sinCifrar}'`,
      );
      expect(msg).toContain("body_cifrado_formato");
    });

    it("y sin el prefijo de versión, tampoco", async () => {
      // Base64 válido pero sin `c1:`: es lo que saldría de un script que
      // cifrara con otro formato.
      const msg = await debeFallar(
        `UPDATE clinical_entries SET body_cifrado = 'ZGlhYmV0ZXM=' WHERE id = '${sinCifrar}'`,
      );
      expect(msg).toContain("body_cifrado_formato");
    });

    it("y en un INSERT tampoco cabe: ahí no hay trigger que lo pare", async () => {
      // El CHECK es la garantía que cubre lo que el trigger no ve. Un
      // `INSERT` con el cuerpo en claro en la columna cifrada es
      // exactamente lo que haría un script nuevo mal escrito.
      const msg = await debeFallar(
        `INSERT INTO clinical_entries
           (tenant_id, client_id, author_user_id, kind, body, body_cifrado)
         VALUES ('${tenantId}', '${pacienteId}', '${duenaId}', 'NOTE',
                 '{"x": 1}'::jsonb, '${EN_CLARO}')`,
      );
      expect(msg).toContain("body_cifrado_formato");
    });

    it("las TREINTA columnas cifradas tienen su CHECK de formato", async () => {
      // Que no falte ninguna. Una columna cifrada sin CHECK es una columna
      // donde el texto en claro cabe.
      //
      // ── NUEVE, QUINCE, DIECISIETE, VEINTIDÓS, VEINTICUATRO Y AHORA TREINTA ──
      //
      // Nueve de clinica-7, seis de residencia-1b (D-63), dos del
      // registro de cuidados (residencia-3), cinco del libro de
      // incidencias (residencia-4), dos del relevo (residencia-5), seis
      // del expediente de una no conformidad (calidad-1) y dos de la ficha
      // de personal (personal-1). Están
      // aquí a propósito en vez de en una lista aparte: esta aserción es EL INVENTARIO de lo que el
      // motor sostiene cifrado en toda la casa. Partirla en dos habría sido
      // dos listas que pueden dejar de cubrirse, y lo que hace falta saber
      // es «¿falta alguna?», no «¿falta alguna de la clínica?».
      //
      // El mismo inventario, por el otro lado, lo fija
      // `test/residencia-1b-cifrado.test.ts`: allí se cuentan los CHECK
      // sobre el SQL de las migraciones y se comparan con los `sitio*` de
      // `cripto-campos.ts`. Entre los dos queda cubierto que la columna
      // tiene CHECK, que el CHECK está en el esquema de verdad y que
      // alguien sabe qué AAD le toca.
      const filas = await prisma.$queryRawUnsafe<Array<{ conname: string }>>(
        `SELECT conname FROM pg_constraint
         WHERE contype = 'c' AND conname LIKE '%cifrad%formato'
            OR conname LIKE '%cifrada_formato'`,
      );
      const nombres = filas.map((f) => f.conname).sort();
      expect(nombres).toEqual(
        [
          "appointments_notes_cifradas_formato",
          "client_consents_revoke_reason_cifrado_formato",
          "client_technical_notes_body_cifrado_formato",
          "clients_notes_cifradas_formato",
          "clinical_addenda_body_cifrado_formato",
          "clinical_assessment_corrections_cifrada_formato",
          "clinical_entries_body_cifrado_formato",
          "clinical_photos_withdraw_reason_cifrado_formato",
          "clinical_photos_zona_cifrada_formato",
          // residencia-1b
          "bed_assignments_reason_cifrado_formato",
          "care_plan_items_close_reason_cifrado_formato",
          "care_plan_items_reason_cifrado_formato",
          "resident_profiles_discharge_reason_cifrado_formato",
          "resident_profiles_dni_cifrado_formato",
          "resident_profiles_nss_cifrado_formato",
          // residencia-3 · el valor del registro y el texto de la nota.
          // Dos columnas lógicas distintas: con el mismo nombre, el texto
          // de «algo no va bien» se podría copiar a la columna del valor y
          // descifraría.
          "care_records_note_cifrado_formato",
          "care_records_value_cifrado_formato",
          // residencia-4 · el libro de incidencias. Cinco columnas
          // lógicas y no tres: con el mismo nombre, lo que se le dijo a
          // la familia se podría copiar al motivo de no habérselo dicho.
          "family_communications_content_cifrado_formato",
          "family_communications_response_cifrado_formato",
          "incident_actions_text_cifrado_formato",
          "incidents_description_cifrado_formato",
          "resident_threshold_overrides_reason_cifrado_formato",
          // residencia-5 · el parte de relevo congelado y el resumen de
          // lo que llegó después de congelarlo. Dos tablas y dos columnas
          // lógicas, por lo mismo que las cinco de arriba.
          "handover_late_additions_resumen_cifrado_formato",
          "handovers_content_cifrado_formato",
          // calidad-1 · el expediente de una no conformidad. Seis
          // columnas lógicas y no tres, por lo mismo que las cinco del
          // libro: con el mismo nombre, la causa de una NC se podría
          // copiar a su descripción y descifraría.
          //
          // Y lo que NO está aquí, declarado: la descripción de un
          // RIESGO, que va en claro a propósito — describe algo que
          // puede pasar en el centro, no algo que le pasó a alguien.
          "corrective_action_evidences_note_cifrado_formato",
          "corrective_actions_closing_note_cifrado_formato",
          "corrective_actions_what_cifrado_formato",
          "effectiveness_verifications_note_cifrado_formato",
          "non_conformities_cause_cifrado_formato",
          "non_conformities_description_cifrado_formato",
          // personal-1 · el DNI/NIE y el nº de afiliación a la Seguridad
          // Social de la FICHA DE PERSONAL. Dos columnas lógicas y no una
          // «identificación», por lo mismo que las de arriba: con el
          // mismo nombre lógico, el nº de afiliación se podría copiar a la
          // columna del DNI y descifraría.
          //
          // Y lo que NO está aquí, declarado: la categoría profesional, la
          // jornada contratada y las fechas de alta y de fin. Van en claro
          // a propósito — son del puesto, no de la persona, y es lo que
          // permite que el cuadrante las cuente sin tocar una clave.
          //
          // Nótese lo que esto significa: un tenant **sin clínica** que
          // guarde un DNI de su plantilla tiene desde ese momento una
          // `clinical_tenant_keys`. Ver el done de personal-1.
          "employees_dni_cifrado_formato",
          "employees_nss_cifrado_formato",
        ].sort(),
      );
    });
  });

  // ── 3 · LA CLAVE DE UNA CLÍNICA ───────────────────────────────────

  describe("la clave de una clínica no se borra ni se resucita", () => {
    it("una DEK EN CLARO no cabe en `dek_wrapped`", async () => {
      // 32 bytes en base64 no empiezan por `v1:`. Es lo que impide que un
      // script la guarde sin envolver.
      const msg = await debeFallar(
        `UPDATE clinical_tenant_keys SET dek_wrapped = '${randomBytes(32).toString("base64")}' WHERE tenant_id = '${tenantId}'`,
      );
      expect(msg).toContain("clinical_tenant_keys_envuelta");
    });

    it("re-envolver SIN tocar el canario → pasa", async () => {
      await debePasar(
        `UPDATE clinical_tenant_keys SET kek_id = 'e2e-2', dek_wrapped = 'v1:OTRACOSA', rewrapped_at = now() WHERE tenant_id = '${tenantId}'`,
      );
    });

    it("re-envolver CAMBIANDO EL CANARIO → rechazado", async () => {
      // El sabotaje que importa: un canario distinto significa que la DEK
      // es otra, y entonces todo lo escrito antes queda ilegible.
      const msg = await debeFallar(
        `UPDATE clinical_tenant_keys SET dek_wrapped = 'v1:X', canary = 'c1:OTRO' WHERE tenant_id = '${tenantId}'`,
      );
      expect(msg).toContain("no cambia el canario");
    });

    it("MEDIA DESTRUCCIÓN (la fecha sin borrar la clave) → rechazada", async () => {
      const msg = await debeFallar(
        `UPDATE clinical_tenant_keys SET destroyed_at = now() WHERE tenant_id = '${tenantId}'`,
      );
      expect(msg).toMatch(/destruir la clave|destruida_entera/);
    });

    it("DELETE de la clave → rechazado: destruir deja fecha", async () => {
      const msg = await debeFallar(
        `DELETE FROM clinical_tenant_keys WHERE tenant_id = '${tenantId}'`,
      );
      expect(msg).toContain("no se borra con un DELETE");
    });

    it("destruir de verdad → pasa, y RESUCITARLA → rechazado", async () => {
      await debePasar(
        `UPDATE clinical_tenant_keys
         SET destroyed_at = now(), dek_wrapped = NULL, canary = NULL,
             destroyed_reason = 'fin de contrato'
         WHERE tenant_id = '${tenantId}'`,
      );
      const msg = await debeFallar(
        `UPDATE clinical_tenant_keys
         SET destroyed_at = NULL, dek_wrapped = 'v1:X', canary = 'c1:Y'
         WHERE tenant_id = '${tenantId}'`,
      );
      expect(msg).toContain("no se deshace");
    });

    it("y la clínica con clave NO SE BORRA", async () => {
      const msg = await debeFallar(
        `DELETE FROM tenants WHERE id = '${tenantId}'`,
      );
      expect(msg.toLowerCase()).toContain("foreign key");
    });
  });

  // ── 4 · LOS TRIGGERS DEJAN PASAR EXACTAMENTE EL CIFRADO ───────────

  describe("la historia solo admite UNA transición: cifrar el cuerpo", () => {
    let otraEntrada = "";

    beforeAll(async () => {
      otraEntrada = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO clinical_entries
           (id, tenant_id, client_id, author_user_id, kind, body)
         VALUES ('${otraEntrada}', '${tenantId}', '${pacienteId}', '${duenaId}',
                 'NOTE', '{"texto": "en claro, de antes del cifrado"}'::jsonb)`,
      );
    });

    it("poner el cifrado donde no lo había → pasa", async () => {
      await debePasar(
        `UPDATE clinical_entries SET body_cifrado = 'c1:AAAABBBBCCCC==' WHERE id = '${otraEntrada}'`,
      );
    });

    it("vaciar el claro al centinela → pasa", async () => {
      await debePasar(
        `UPDATE clinical_entries SET body = '{"cifrado": true}'::jsonb WHERE id = '${otraEntrada}'`,
      );
    });

    it("CAMBIAR EL CUERPO aprovechando la rendija → rechazado", async () => {
      const msg = await debeFallar(
        `UPDATE clinical_entries SET body = '{"texto": "OTRA COSA"}'::jsonb WHERE id = '${otraEntrada}'`,
      );
      expect(msg).toContain("HISTORIA_VIOLADA");
    });

    it("CAMBIAR EL AUTOR con el cifrado puesto → rechazado", async () => {
      const msg = await debeFallar(
        `UPDATE clinical_entries SET author_user_id = '${duenaId}', body_cifrado = 'c1:ZZZZ' WHERE id = '${otraEntrada}'`,
      );
      expect(msg).toContain("HISTORIA_VIOLADA");
    });

    it("REESCRIBIR el cifrado ya puesto → rechazado", async () => {
      // Es lo que hace que el script sea idempotente por el `WHERE … IS
      // NULL` y no por confianza: reescribir un ciphertext sería cambiar la
      // historia.
      const msg = await debeFallar(
        `UPDATE clinical_entries SET body_cifrado = 'c1:DDDDEEEE' WHERE id = '${otraEntrada}'`,
      );
      expect(msg).toContain("HISTORIA_VIOLADA");
    });

    it("y el DELETE sigue rechazado", async () => {
      const msg = await debeFallar(
        `DELETE FROM clinical_entries WHERE id = '${otraEntrada}'`,
      );
      expect(msg).toContain("no se borra");
    });
  });

  // ── 5 · EL CÓDIGO DEL ENLACE ──────────────────────────────────────

  describe("el código del enlace no se reescribe y sus fallos no bajan", () => {
    let enlaceId = "";

    beforeAll(async () => {
      enlaceId = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO public_links
           (id, tenant_id, purpose, target_type, target_id, token_hash,
            code_hash, expires_at, max_uses)
         VALUES ('${enlaceId}', '${tenantId}', 'INFORME_CLINICO',
                 'CLINICAL_REPORT_DELIVERY', '${randomUUID()}',
                 '${"c".repeat(64)}', '${"d".repeat(64)}', now() + interval '7 days', 3)`,
      );
    });

    afterAll(async () => {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE public_links DISABLE TRIGGER public_links_guard`,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM public_links WHERE tenant_id = '${tenantId}'`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE public_links ENABLE TRIGGER public_links_guard`,
      );
    });

    it("el CÓDIGO EN CLARO no cabe en `code_hash`", async () => {
      const msg = await debeFallar(
        `INSERT INTO public_links (tenant_id, purpose, target_type, target_id, token_hash, code_hash, expires_at, max_uses)
         VALUES ('${tenantId}', 'INFORME_CLINICO', 'X', '${randomUUID()}', '${"e".repeat(64)}', '042318', now() + interval '1 day', 3)`,
      );
      expect(msg).toContain("code_hash_es_sha256");
    });

    it("CAMBIAR el código de un enlace → rechazado: es la cerradura", async () => {
      const msg = await debeFallar(
        `UPDATE public_links SET code_hash = '${"f".repeat(64)}' WHERE id = '${enlaceId}'`,
      );
      expect(msg).toContain("ENLACE_VIOLADO");
      expect(msg).toContain("su código");
    });

    it("subir los fallos → pasa", async () => {
      await debePasar(
        `UPDATE public_links SET code_failures = 3 WHERE id = '${enlaceId}'`,
      );
    });

    it("BAJAR los fallos → rechazado: sería regalar intentos", async () => {
      const msg = await debeFallar(
        `UPDATE public_links SET code_failures = 0 WHERE id = '${enlaceId}'`,
      );
      expect(msg).toContain("no bajan");
    });
  });

  // ── 6 · EL `pg_dump` NO LLEVA NI UN TEXTO CLÍNICO EN CLARO ────────

  describe("la base volcada entera no contiene texto clínico en claro", () => {
    it("el canario de una entrada cifrada NO aparece en el volcado", async () => {
      // ES EL SABOTAJE QUE EL PROMPT PIDE, y el que de verdad contesta la
      // pregunta del bloque: «si se filtra una copia, ¿se lee una
      // historia?».
      //
      // ── Por qué NO se llama a `pg_dump` ───────────────────────────
      //
      // El prompt dice «grep de un texto canario sobre un `pg_dump`», y el
      // volcado se hace **desde el propio servidor** en vez de con el
      // binario. Dos razones, y la segunda es la que decide:
      //
      //   1. `pg_dump` no está instalado en el Mac de desarrollo, y en CI
      //      depende de la imagen. Un test que se salta cuando falta la
      //      herramienta es un test que miente en verde — exactamente lo
      //      que `e2e-env.ts` dice que no se hace.
      //   2. Y volcando desde el servidor se mira MÁS: `t::text` de cada
      //      fila de **cada tabla del esquema** incluye todas las
      //      columnas, también las que nadie listó. Un `pg_dump` con
      //      `--exclude-table` mal puesto dejaría el test verde sin mirar
      //      la tabla que importa.
      //
      // Lo que se recorre es el esquema entero, no las tablas clínicas: el
      // canario podría haberse colado en una columna de otro módulo, y ése
      // es justo el caso que nadie buscaría a mano.
      const tablas = await prisma.$queryRawUnsafe<Array<{ t: string }>>(
        `SELECT table_name AS t FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
         ORDER BY table_name`,
      );
      expect(tablas.length).toBeGreaterThan(20);

      const trozos: string[] = [];
      for (const { t } of tablas) {
        const filas = await prisma.$queryRawUnsafe<
          Array<{ v: string | null }>
        >(`SELECT string_agg(x::text, E'\n') AS v FROM "${t}" x`);
        const v = filas[0]?.v;
        if (v) trozos.push(v);
      }
      const dump = trozos.join("\n");

      // El canario NO está.
      expect(dump).not.toContain(CANARIO);

      // Y LO QUE SÍ ESTÁ es su ciphertext: así el test demuestra que
      // miró en el sitio bueno. Sin esta mitad, un `pg_dump` vacío o de
      // otra base pasaría igual.
      const fila = await prisma.$queryRawUnsafe<
        Array<{ body_cifrado: string }>
      >(
        `SELECT body_cifrado FROM clinical_entries WHERE id = '${entradaId}'`,
      );
      const cifrado = fila[0]!.body_cifrado;
      expect(cifrado.startsWith("c1:")).toBe(true);
      expect(dump).toContain(cifrado.slice(0, 40));
    });

    it("y el claro de esa fila es el centinela, no el cuerpo", async () => {
      const fila = await prisma.$queryRawUnsafe<Array<{ body: unknown }>>(
        `SELECT body FROM clinical_entries WHERE id = '${entradaId}'`,
      );
      expect(fila[0]!.body).toEqual({ cifrado: true });
    });
  });
});
