// enlaces-publicos · la tabla «sabotaje → test rojo» de la puerta común,
// contra Postgres de verdad.
//
// Por qué tiene que ser e2e y no puede vivir con un Prisma falso: lo que
// se prueba aquí es que **el MOTOR** lo rechaza, no que la aplicación se
// porte bien. Misma razón exacta que `clinica-valoracion.e2e.ts` de
// clinica-2 y que `sello-de-la-venta.e2e.ts` (ADR-015 §1): la aplicación
// no es la única puerta a Postgres, y un enlace que sólo es de un uso
// mientras el código se porte bien no es de un uso.
//
// Por eso cada sabotaje entra por `$executeRawUnsafe`: SQL directo, como
// lo escribiría alguien con acceso al VPS.
//
// Las garantías, una por bloque:
//
//   1. LA COLUMNA NO ADMITE UN TOKEN EN CLARO. 64 hex y nada más.
//   2. LOS USOS no pasan del tope, no bajan y un anulado no se gasta.
//   3. UN ANULADO NO SE DES-ANULA, y LA CADUCIDAD NO SE ALARGA.
//   4. UN ENLACE NO SE BORRA, y su identidad no se reescribe.
//   5. UN SOLO ENLACE VIVO por (`purpose`, objetivo) — y los anulados y
//      los gastados no bloquean al siguiente.
//   6. EL BACKFILL DE CLINICA-2 mapea lo que tiene que mapear, es
//      idempotente, y apunta a la VALORACIÓN y no a la cita.
//   7. ANULAR LA CITA **no** toca el enlace de la valoración.
//   8. Nada de esto se va con una cascada.

import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

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

/** Una huella cualquiera, con la forma que la columna exige. */
function huella(): string {
  return randomBytes(32).toString("hex");
}

describe.skipIf(!e2eEnabled)("e2e · el enlace público no se revive", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let tenantId = "";
  let recepcionId = "";
  let pacienteId = "";
  let valoracionId = "";
  let enlaceId = "";

  beforeAll(async () => {
    tenantId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO tenants (id, name, clinical_records_enabled, crm_enabled, agenda_enabled, updated_at)
       VALUES ('${tenantId}', 'Clínica de los Enlaces ${tenantId.slice(0, 8)}', true, true, true, now())`,
    );
  });

  afterAll(async () => {
    // LIMPIEZA EN ESTE ORDEN, y es parte de lo que se prueba: con la guarda
    // puesta, los enlaces no se borran. Que limpiar sea incómodo es la
    // garantía funcionando.
    const triggers: Array<[string, string]> = [
      ["public_links", "public_links_guard"],
      ["clinical_assessments", "clinical_assessments_guard"],
      ["clinical_entries", "clinical_entries_inmutable"],
    ];
    for (const [tabla, trg] of triggers) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${tabla} DISABLE TRIGGER ${trg}`,
      );
    }
    for (const t of ["public_links", "clinical_assessments", "clinical_entries"]) {
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
    // Cada caso con su objetivo y su enlace nuevos, y la limpieza del
    // anterior con la guarda apagada (borrar un enlace es justo lo que la
    // guarda prohíbe).
    await prisma.$executeRawUnsafe(
      `ALTER TABLE public_links DISABLE TRIGGER public_links_guard`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM public_links WHERE tenant_id = '${tenantId}'`,
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE public_links ENABLE TRIGGER public_links_guard`,
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE clinical_assessments DISABLE TRIGGER clinical_assessments_guard`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM clinical_assessments WHERE tenant_id = '${tenantId}'`,
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE clinical_assessments ENABLE TRIGGER clinical_assessments_guard`,
    );

    recepcionId = randomUUID();
    pacienteId = randomUUID();
    valoracionId = randomUUID();
    enlaceId = randomUUID();

    await prisma.$executeRawUnsafe(
      `INSERT INTO users (id, tenant_id, email, alias, role, is_clinician, clinical_scope)
       VALUES ('${recepcionId}', '${tenantId}', 'marta-${recepcionId.slice(0, 8)}@c.es', 'Marta', 'CASHIER', false, 'SELECTION')`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO clients (id, tenant_id, first_name, last_name, updated_at)
       VALUES ('${pacienteId}', '${tenantId}', 'Carmen', 'Rodríguez', now())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO clinical_assessments
         (id, tenant_id, client_id, questionnaire_version, channel, source, requested_by_user_id)
       VALUES ('${valoracionId}', '${tenantId}', '${pacienteId}', 1, 'EMAIL', 'MANUAL', '${recepcionId}')`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO public_links
         (id, tenant_id, purpose, target_type, target_id, token_hash,
          expires_at, max_uses, created_by_user_id)
       VALUES ('${enlaceId}', '${tenantId}', 'VALORACION', 'CLINICAL_ASSESSMENT',
               '${valoracionId}', '${huella()}', now() + interval '30 days', 1,
               '${recepcionId}')`,
    );
  });

  /** Mete un enlace con los campos que se le pasen. */
  function insertarEnlace(campos: {
    id?: string;
    purpose?: string;
    targetId?: string;
    tokenHash?: string;
    expiresAt?: string;
    maxUses?: number;
    usedCount?: number;
    revokedAt?: string;
  }): string {
    const id = campos.id ?? randomUUID();
    return `INSERT INTO public_links
         (id, tenant_id, purpose, target_type, target_id, token_hash,
          expires_at, max_uses, used_count, revoked_at)
       VALUES ('${id}', '${tenantId}', '${campos.purpose ?? "VALORACION"}',
               'CLINICAL_ASSESSMENT', '${campos.targetId ?? valoracionId}',
               '${campos.tokenHash ?? huella()}',
               ${campos.expiresAt ?? "now() + interval '1 day'"},
               ${campos.maxUses ?? 1}, ${campos.usedCount ?? 0},
               ${campos.revokedAt ?? "NULL"})`;
  }

  // ── 1 · la columna no admite un token en claro ──────────────────────

  describe("LA COLUMNA NO ADMITE UN TOKEN EN CLARO", () => {
    it("un base64url de 43 caracteres NO CABE", async () => {
      // Es la garantía número uno del bloque, y está en el motor: «lo
      // guardo en claro, que es más fácil de depurar» lo rechaza Postgres
      // y no una revisión de código.
      const enClaro = randomBytes(32).toString("base64url");
      expect(enClaro).toHaveLength(43);
      const msg = await debeFallar(
        insertarEnlace({ tokenHash: enClaro, targetId: randomUUID() }),
      );
      expect(msg).toContain("public_links_token_hash_es_sha256");
    });

    it("ni un hex en MAYÚSCULAS, ni uno de 63, ni uno de 65", async () => {
      for (const malo of [
        randomBytes(32).toString("hex").toUpperCase(),
        huella().slice(0, 63),
        `${huella()}a`,
      ]) {
        const msg = await debeFallar(
          insertarEnlace({ tokenHash: malo, targetId: randomUUID() }),
        );
        expect(msg).toContain("public_links_token_hash_es_sha256");
      }
    });

    it("y dos enlaces no comparten huella: resolver un token no es ambiguo", async () => {
      const compartida = huella();
      await prisma.$executeRawUnsafe(
        insertarEnlace({ tokenHash: compartida, targetId: randomUUID() }),
      );
      const msg = await debeFallar(
        insertarEnlace({ tokenHash: compartida, targetId: randomUUID() }),
      );
      // El mensaje de un único en Postgres nombra LAS COLUMNAS de la clave,
      // no el índice (es lo que `clinica-valoracion.e2e.ts` ya afirmaba
      // así). La columna es lo que importa: la huella.
      expect(msg).toContain("Code: `23505`");
      expect(msg).toContain("Key (token_hash)=(");
    });
  });

  // ── 2 · los usos ────────────────────────────────────────────────────

  describe("LOS USOS no pasan del tope, y no bajan", () => {
    it("un UPDATE que deja el contador POR ENCIMA del tope falla", async () => {
      // «Dejarlo usar una vez más» es exactamente este UPDATE.
      const msg = await debeFallar(
        `UPDATE public_links SET used_count = 2 WHERE id = '${enlaceId}'`,
      );
      expect(msg).toMatch(
        /public_links_usos_dentro_del_tope|ENLACE_VIOLADO/,
      );
    });

    it("ni nace una fila gastada por encima del tope", async () => {
      const msg = await debeFallar(
        insertarEnlace({ maxUses: 1, usedCount: 2, targetId: randomUUID() }),
      );
      expect(msg).toContain("public_links_usos_dentro_del_tope");
    });

    it("y el contador NO BAJA: bajarlo es dejarlo usar otra vez", async () => {
      await prisma.$executeRawUnsafe(
        `UPDATE public_links SET used_count = 1 WHERE id = '${enlaceId}'`,
      );
      const msg = await debeFallar(
        `UPDATE public_links SET used_count = 0 WHERE id = '${enlaceId}'`,
      );
      expect(msg).toContain("ENLACE_VIOLADO");
      expect(msg).toMatch(/no bajan/);
    });

    it("un enlace ANULADO no se gasta", async () => {
      await prisma.$executeRawUnsafe(
        `UPDATE public_links SET revoked_at = now() WHERE id = '${enlaceId}'`,
      );
      const msg = await debeFallar(
        `UPDATE public_links SET used_count = 1 WHERE id = '${enlaceId}'`,
      );
      expect(msg).toContain("ENLACE_VIOLADO");
    });

    it("y un enlace que no se puede usar ni una vez no cabe", async () => {
      const msg = await debeFallar(
        insertarEnlace({ maxUses: 0, targetId: randomUUID() }),
      );
      expect(msg).toContain("public_links_max_uses_positivo");
    });
  });

  // ── 3 · no se des-anula, y la caducidad no se alarga ────────────────

  describe("UN ANULADO NO SE DES-ANULA, y LA CADUCIDAD NO SE ALARGA", () => {
    it("un UPDATE que pone `revoked_at = NULL` falla", async () => {
      // «Recepción anuló este enlace» tiene que ser definitivo.
      await prisma.$executeRawUnsafe(
        `UPDATE public_links SET revoked_at = now() WHERE id = '${enlaceId}'`,
      );
      const msg = await debeFallar(
        `UPDATE public_links SET revoked_at = NULL WHERE id = '${enlaceId}'`,
      );
      expect(msg).toContain("ENLACE_VIOLADO");
      expect(msg).toMatch(/no se des-anula/);
    });

    it("y moverle la fecha de anulación tampoco", async () => {
      await prisma.$executeRawUnsafe(
        `UPDATE public_links SET revoked_at = now() WHERE id = '${enlaceId}'`,
      );
      const msg = await debeFallar(
        `UPDATE public_links SET revoked_at = now() + interval '1 day' WHERE id = '${enlaceId}'`,
      );
      expect(msg).toContain("ENLACE_VIOLADO");
    });

    it("ESTIRAR LA CADUCIDAD falla: revivir un caducado sería un UPDATE", async () => {
      const msg = await debeFallar(
        `UPDATE public_links SET expires_at = now() + interval '10 years' WHERE id = '${enlaceId}'`,
      );
      expect(msg).toContain("ENLACE_VIOLADO");
      expect(msg).toMatch(/cuándo caduca/);
    });

    it("y acortarla tampoco: la caducidad no se toca, se crea otro enlace", async () => {
      const msg = await debeFallar(
        `UPDATE public_links SET expires_at = now() - interval '1 day' WHERE id = '${enlaceId}'`,
      );
      expect(msg).toContain("ENLACE_VIOLADO");
    });

    it("lo que SÍ se puede es anularlo y sumarle un uso", async () => {
      // Las dos únicas escrituras que la puerta hace sobre una fila ya
      // creada. Si la guarda las frenara, el bloque no funcionaría.
      await prisma.$executeRawUnsafe(
        `UPDATE public_links SET used_count = 1 WHERE id = '${enlaceId}'`,
      );
      const otro = randomUUID();
      await prisma.$executeRawUnsafe(
        insertarEnlace({ id: otro, targetId: randomUUID() }),
      );
      await prisma.$executeRawUnsafe(
        `UPDATE public_links SET revoked_at = now() WHERE id = '${otro}'`,
      );
      const filas = await prisma.$queryRawUnsafe<
        Array<{ used_count: number; revoked_at: Date | null }>
      >(
        `SELECT used_count, revoked_at FROM public_links WHERE id IN ('${enlaceId}', '${otro}') ORDER BY id`,
      );
      expect(filas).toHaveLength(2);
    });
  });

  // ── 4 · no se borra, y la identidad no se reescribe ─────────────────

  describe("UN ENLACE NO SE BORRA, y su identidad no se reescribe", () => {
    it("un DELETE falla: se revoca, y la revocación queda escrita", async () => {
      const msg = await debeFallar(
        `DELETE FROM public_links WHERE id = '${enlaceId}'`,
      );
      expect(msg).toContain("ENLACE_VIOLADO");
      expect(msg).toMatch(/no se borra/);
    });

    it.each([
      ["el purpose", `purpose = 'MI_CITA'`],
      ["el tipo de objetivo", `target_type = 'APPOINTMENT'`],
      ["a qué apunta", `target_id = gen_random_uuid()`],
      ["su huella", `token_hash = repeat('b', 64)`],
      ["su tope", `max_uses = 99`],
      ["quién lo creó", `created_by_user_id = NULL`],
      ["cuándo nació", `created_at = now() - interval '1 year'`],
    ])("cambiarle %s falla", async (_n, set) => {
      const msg = await debeFallar(
        `UPDATE public_links SET ${set} WHERE id = '${enlaceId}'`,
      );
      expect(msg).toContain("ENLACE_VIOLADO");
      expect(msg).toMatch(/no se reescribe/);
    });

    it("y el de otro negocio tampoco: el tenant va en la identidad", async () => {
      const msg = await debeFallar(
        `UPDATE public_links SET tenant_id = gen_random_uuid() WHERE id = '${enlaceId}'`,
      );
      expect(msg).toContain("ENLACE_VIOLADO");
    });
  });

  // ── 5 · un solo enlace vivo ─────────────────────────────────────────

  describe("UN SOLO ENLACE VIVO por (purpose, objetivo)", () => {
    it("un segundo enlace vivo del mismo objetivo FALLA", async () => {
      // De aquí sale la decisión S1.5 sin un solo `if`: reenviar sin
      // revocar el anterior no cuela.
      const msg = await debeFallar(insertarEnlace({}));
      expect(msg).toContain("Code: `23505`");
      expect(msg).toContain("Key (purpose, target_id)=(VALORACION,");
    });

    it("el anterior ANULADO no bloquea al siguiente: eso es rotar", async () => {
      await prisma.$executeRawUnsafe(
        `UPDATE public_links SET revoked_at = now() WHERE id = '${enlaceId}'`,
      );
      await prisma.$executeRawUnsafe(insertarEnlace({}));
      const vivos = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM public_links
          WHERE target_id = '${valoracionId}' AND revoked_at IS NULL`,
      );
      expect(Number(vivos[0]!.n)).toBe(1);
    });

    it("y el anterior GASTADO tampoco", async () => {
      await prisma.$executeRawUnsafe(
        `UPDATE public_links SET used_count = 1 WHERE id = '${enlaceId}'`,
      );
      await prisma.$executeRawUnsafe(insertarEnlace({}));
      const n = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM public_links WHERE target_id = '${valoracionId}'`,
      );
      expect(Number(n[0]!.n)).toBe(2);
    });

    it("un enlace CADUCADO SÍ bloquea, y es deliberado", async () => {
      // El camino que da un enlace nuevo tiene que revocar el viejo
      // explícitamente. Si un caducado saliera del índice, «reenviar»
      // podría dejar enlaces sin anular y la anulación dejaría de ser la
      // única forma de retirar uno.
      const caducado = randomUUID();
      const otroObjetivo = randomUUID();
      await prisma.$executeRawUnsafe(
        insertarEnlace({
          id: caducado,
          targetId: otroObjetivo,
          expiresAt: "now() - interval '1 day'",
        }),
      );
      const msg = await debeFallar(
        insertarEnlace({ targetId: otroObjetivo }),
      );
      expect(msg).toContain("Code: `23505`");
      expect(msg).toContain(`Key (purpose, target_id)=(VALORACION, ${otroObjetivo}`);
    });

    it("y dos `purpose` distintos sobre el mismo objetivo SÍ caben", async () => {
      // Lo necesitará «mi cita»: una cita puede tener a la vez su enlace de
      // «mi cita» y el de la encuesta post-visita.
      await prisma.$executeRawUnsafe(
        insertarEnlace({ purpose: "PRUEBA_DE_OTRO_PURPOSE" }),
      );
      const n = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM public_links
          WHERE target_id = '${valoracionId}' AND revoked_at IS NULL`,
      );
      expect(Number(n[0]!.n)).toBe(2);
    });
  });

  // ── 6 · el backfill de clinica-2 ────────────────────────────────────

  describe("EL BACKFILL DE CLINICA-2", () => {
    // EL BACKFILL DE VERDAD, LEÍDO DE LA MIGRACIÓN.
    //
    // No una copia a mano: una copia se queda atrás, y entonces estos
    // casos prueban lo que yo escribí aquí en vez de lo que el motor va a
    // ejecutar en producción. Se extrae el `INSERT … SELECT` del fichero y
    // se corre tal cual.
    //
    // (La migración ya corrió una vez en el `globalSetup` sobre una base
    // vacía, así que no movió ninguna fila. Correrla aquí con filas
    // delante es lo que prueba el mapeo — y que sea idempotente es
    // justamente lo que permite correrla dos veces.)
    const BACKFILL = (() => {
      const sql = readFileSync(
        new URL(
          "../../../packages/db/prisma/migrations/20261008000000_enlaces_publicos/migration.sql",
          import.meta.url,
        ),
        "utf8",
      )
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("--"))
        .join("\n");
      const m = sql.match(/INSERT INTO "public_links"[\s\S]*?DO NOTHING/);
      if (!m) throw new Error("no se encontró el backfill en la migración");
      return m[0];
    })();

    /** Una valoración de clinica-2, con sus columnas viejas puestas. */
    async function valoracionDeClinica2(opts: {
      usada?: boolean;
      pedidaPor?: string | null;
    }): Promise<{ id: string; hash: string }> {
      const id = randomUUID();
      const hash = huella();
      const source = opts.pedidaPor === null ? "APPOINTMENT" : "MANUAL";
      const pedidaPor =
        opts.pedidaPor === null ? "NULL" : `'${opts.pedidaPor ?? recepcionId}'`;
      // Una valoración con `link_used_at` tiene que estar RESPONDIDA: lo
      // exige el CHECK `clinical_assessments_enlace_usado_para_responder`.
      const respondida = opts.usada
        ? `, status = 'RESPONDIDA', answered_at = now(), answered_by = 'PACIENTE', link_used_at = now()`
        : "";
      await prisma.$executeRawUnsafe(
        `INSERT INTO clinical_assessments
           (id, tenant_id, client_id, questionnaire_version, channel, source,
            requested_by_user_id, link_token_hash, link_expires_at)
         VALUES ('${id}', '${tenantId}', '${pacienteId}', 1, 'EMAIL', '${source}',
                 ${pedidaPor}, '${hash}', now() + interval '12 days')`,
      );
      if (opts.usada) {
        const entryId = randomUUID();
        await prisma.$executeRawUnsafe(
          `INSERT INTO clinical_entries (id, tenant_id, client_id, author_user_id, kind, body)
           VALUES ('${entryId}', '${tenantId}', '${pacienteId}', '${recepcionId}',
                   'INITIAL_ASSESSMENT', '{"respuestas":{}}')`,
        );
        await prisma.$executeRawUnsafe(
          `UPDATE clinical_assessments SET entry_id = '${entryId}' ${respondida}
            WHERE id = '${id}'`,
        );
      }
      return { id, hash };
    }

    beforeEach(async () => {
      // Este bloque parte de la valoración SIN enlace en la tabla común:
      // el `beforeEach` de arriba ya metió uno, y lo que se prueba aquí es
      // lo que hace el backfill con las columnas viejas.
      await prisma.$executeRawUnsafe(
        `ALTER TABLE public_links DISABLE TRIGGER public_links_guard`,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM public_links WHERE tenant_id = '${tenantId}'`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE public_links ENABLE TRIGGER public_links_guard`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE clinical_assessments DISABLE TRIGGER clinical_assessments_guard`,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM clinical_assessments WHERE tenant_id = '${tenantId}'`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE clinical_assessments ENABLE TRIGGER clinical_assessments_guard`,
      );
    });

    it("mueve la huella TAL CUAL: el enlace que está en un buzón sigue abriendo", async () => {
      const v = await valoracionDeClinica2({});
      await prisma.$executeRawUnsafe(BACKFILL);
      const filas = await prisma.$queryRawUnsafe<
        Array<{
          purpose: string;
          target_type: string;
          target_id: string;
          token_hash: string;
          max_uses: number;
          used_count: number;
          revoked_at: Date | null;
          created_by_user_id: string | null;
        }>
      >(`SELECT * FROM public_links WHERE tenant_id = '${tenantId}'`);
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({
        purpose: "VALORACION",
        target_type: "CLINICAL_ASSESSMENT",
        target_id: v.id,
        token_hash: v.hash,
        max_uses: 1,
        used_count: 0,
        revoked_at: null,
        created_by_user_id: recepcionId,
      });
    });

    it("apunta a LA VALORACIÓN y no a la cita", async () => {
      const v = await valoracionDeClinica2({});
      await prisma.$executeRawUnsafe(BACKFILL);
      const [fila] = await prisma.$queryRawUnsafe<
        Array<{ target_id: string }>
      >(`SELECT target_id FROM public_links WHERE tenant_id = '${tenantId}'`);
      expect(fila!.target_id).toBe(v.id);
    });

    it("un enlace YA GASTADO sigue gastado", async () => {
      await valoracionDeClinica2({ usada: true });
      await prisma.$executeRawUnsafe(BACKFILL);
      const [fila] = await prisma.$queryRawUnsafe<
        Array<{ used_count: number; max_uses: number }>
      >(
        `SELECT used_count, max_uses FROM public_links WHERE tenant_id = '${tenantId}'`,
      );
      expect(fila!.used_count).toBe(1);
      expect(fila!.max_uses).toBe(1);
    });

    it("la que salió de una cita nace SIN autor: no la pidió nadie", async () => {
      await valoracionDeClinica2({ pedidaPor: null });
      await prisma.$executeRawUnsafe(BACKFILL);
      const [fila] = await prisma.$queryRawUnsafe<
        Array<{ created_by_user_id: string | null }>
      >(
        `SELECT created_by_user_id FROM public_links WHERE tenant_id = '${tenantId}'`,
      );
      expect(fila!.created_by_user_id).toBeNull();
    });

    it("y es IDEMPOTENTE: correrlo dos veces no duplica ni revienta", async () => {
      await valoracionDeClinica2({});
      await prisma.$executeRawUnsafe(BACKFILL);
      await prisma.$executeRawUnsafe(BACKFILL);
      await prisma.$executeRawUnsafe(BACKFILL);
      const n = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM public_links WHERE tenant_id = '${tenantId}'`,
      );
      expect(Number(n[0]!.n)).toBe(1);
    });

    it("una valoración SIN enlace no genera fila", async () => {
      await prisma.$executeRawUnsafe(
        `INSERT INTO clinical_assessments
           (id, tenant_id, client_id, questionnaire_version, channel, source, requested_by_user_id)
         VALUES ('${randomUUID()}', '${tenantId}', '${pacienteId}', 1, 'TABLET', 'MANUAL', '${recepcionId}')`,
      );
      await prisma.$executeRawUnsafe(BACKFILL);
      const n = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM public_links WHERE tenant_id = '${tenantId}'`,
      );
      expect(Number(n[0]!.n)).toBe(0);
    });
  });

  // ── 7 · la cita ─────────────────────────────────────────────────────

  describe("ANULAR LA CITA no toca el enlace de la valoración", () => {
    it("borrar la cita deja la valoración huérfana y SU ENLACE INTACTO", async () => {
      // Precisión de clínica en el S1: el enlace apunta a la valoración, no
      // a la cita. El paciente puede estar contestándola, y la valoración
      // sirve igual para su siguiente cita. Si el enlace apuntara a la
      // cita, el `ON DELETE` se lo habría llevado.
      // La cita PRIMERO: la guarda de clinica-2 no deja mover una
      // valoración de cita («lo escrito queda donde se escribió»), así que
      // la valoración nace ya con su `appointment_id`. Es también el caso
      // real: la cita de primera valoración es la que crea la valoración.
      const citaId = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO appointments
           (id, tenant_id, client_id, timeslot, status, updated_at)
         VALUES ('${citaId}', '${tenantId}', '${pacienteId}',
                 tstzrange(now() + interval '2 days',
                           now() + interval '2 days' + interval '30 minutes', '[)'),
                 'CONFIRMED', now())`,
      );
      // La del `beforeEach` ocupa el «una abierta por paciente», así que
      // ésta se valida antes de crear la de la cita… o más simple: se usa
      // la que ya hay y se le pone la cita AL NACER. Se rehace entera.
      await prisma.$executeRawUnsafe(
        `ALTER TABLE public_links DISABLE TRIGGER public_links_guard`,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM public_links WHERE tenant_id = '${tenantId}'`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE public_links ENABLE TRIGGER public_links_guard`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE clinical_assessments DISABLE TRIGGER clinical_assessments_guard`,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM clinical_assessments WHERE tenant_id = '${tenantId}'`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE clinical_assessments ENABLE TRIGGER clinical_assessments_guard`,
      );

      const conCita = randomUUID();
      const suEnlace = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO clinical_assessments
           (id, tenant_id, client_id, appointment_id, questionnaire_version,
            channel, source, requested_by_user_id)
         VALUES ('${conCita}', '${tenantId}', '${pacienteId}', '${citaId}', 1,
                 'EMAIL', 'APPOINTMENT', NULL)`,
      );
      await prisma.$executeRawUnsafe(
        insertarEnlace({ id: suEnlace, targetId: conCita }),
      );

      // SE ANULA LA CITA (se borra, que es el caso extremo).
      await prisma.$executeRawUnsafe(
        `DELETE FROM appointments WHERE id = '${citaId}'`,
      );

      // La valoración queda huérfana de cita y entera…
      const [v] = await prisma.$queryRawUnsafe<
        Array<{ appointment_id: string | null }>
      >(
        `SELECT appointment_id FROM clinical_assessments WHERE id = '${conCita}'`,
      );
      expect(v!.appointment_id).toBeNull();

      // …y SU ENLACE, intacto. Ni anulado ni gastado: el paciente puede
      // estar contestándolo, y la valoración sirve igual para su siguiente
      // cita.
      const [l] = await prisma.$queryRawUnsafe<
        Array<{ revoked_at: Date | null; used_count: number; target_id: string }>
      >(
        `SELECT revoked_at, used_count, target_id FROM public_links WHERE id = '${suEnlace}'`,
      );
      expect(l!.revoked_at).toBeNull();
      expect(l!.used_count).toBe(0);
      expect(l!.target_id).toBe(conCita);
    });
  });

  // ── 8 · nada se va con una cascada ──────────────────────────────────

  describe("Nada de esto se va con una cascada", () => {
    it("el negocio no se puede borrar mientras tenga enlaces", async () => {
      const msg = await debeFallar(
        `DELETE FROM tenants WHERE id = '${tenantId}'`,
      );
      expect(msg).toMatch(/public_links_tenant_id_fkey|violates foreign key/);
    });

    it("ni la persona que creó uno", async () => {
      const msg = await debeFallar(
        `DELETE FROM users WHERE id = '${recepcionId}'`,
      );
      expect(msg).toMatch(
        /public_links_created_by_user_id_fkey|violates foreign key/,
      );
    });
  });
});
