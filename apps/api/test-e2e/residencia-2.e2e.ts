// residencia-2 · la tabla «sabotaje → test rojo» del catálogo y del plan,
// contra Postgres de verdad.
//
// Por qué tiene que ser e2e y no puede vivir con un prisma falso: lo que
// se prueba aquí es que **EL MOTOR** lo rechaza, no que la aplicación se
// porte bien. Misma razón exacta que `residencia-1.e2e.ts`: la aplicación
// no es la única puerta a Postgres, y una regla que sólo se cumple
// mientras el código se porte bien no es una regla.
//
// Por eso cada sabotaje entra por `$executeRawUnsafe`: SQL directo, como
// lo escribiría alguien con acceso al VPS a las nueve de la noche.
//
// Las garantías, una por bloque:
//
//   1. El ALCANCE: un control de serie no tiene centro y uno de centro sí.
//      Las DOS mitades.
//   2. UNA SOLA VERSIÓN VIGENTE por código, y hacen falta los dos índices
//      parciales porque en Postgres los NULL son distintos entre sí.
//   3. La FRECUENCIA es coherente con su tipo, en las cuatro tablas.
//   4. Como mucho UN «como siempre» por control.
//   5. UNA LÍNEA VIVA por (residente, control), y el HISTÓRICO cabe.
//   6. `source_level` sólo existe en las líneas de plantilla — que es lo
//      que sostiene «las manuales no se tocan».
//   7. El plan NO SE BORRA: ni con el residente, ni con el tenant.
//   8. Y el SEED del catálogo de serie de verdad: publica una versión
//      nueva sin editar la anterior, y reconduce el ajuste del centro que
//      se queda inválido **dejándolo anotado**.

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
const { cargarCatalogoDeSerie } = await import(
  "../src/residencia/catalogo/cargar-catalogo.js"
);
const { sembrarResidencia } = await import("../src/residencia/semilla.js");

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

describe.skipIf(!e2eEnabled)("e2e · el catálogo de controles y el plan", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let tenantId = "";
  let otroTenantId = "";
  let carmenId = "";
  let directoraId = "";

  /** Una fila mínima de `control_types`, para no repetir veinte columnas. */
  function insertarControl(opts: {
    id?: string;
    scope: "STANDARD" | "CENTER";
    tenantId?: string | null;
    code: string;
    version?: number;
    supersededAt?: string | null;
    kind?: string;
    extra?: string;
  }): string {
    const id = opts.id ?? randomUUID();
    const tenant = opts.tenantId === undefined || opts.tenantId === null
      ? "NULL"
      : `'${opts.tenantId}'`;
    const kind = opts.kind ?? "ON_DEMAND";
    const superseded = opts.supersededAt ? `'${opts.supersededAt}'` : "NULL";
    return `INSERT INTO control_types
      (id, scope, tenant_id, code, version, name, layer, nature, value_domain,
       allowed_frequencies, allowed_care_role_codes,
       default_frequency_kind, valid_from, superseded_at, updated_at${opts.extra ? ", " + opts.extra.split("=")[0]!.trim() : ""})
      VALUES ('${id}', '${opts.scope}', ${tenant}, '${opts.code}', ${opts.version ?? 1},
       'Control de prueba', 'EXEC', 'SCHEDULED', 'BOOL',
       ARRAY['${kind}']::"CareFrequencyKind"[], ARRAY['AUXILIAR'],
       '${kind}', now(), ${superseded}, now()${opts.extra ? ", " + opts.extra.split("=").slice(1).join("=").trim() : ""})`;
  }

  beforeAll(async () => {
    tenantId = randomUUID();
    otroTenantId = randomUUID();
    carmenId = randomUUID();
    directoraId = randomUUID();
    for (const t of [tenantId, otroTenantId]) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO tenants (id, name, residencia_enabled, clinical_records_enabled, crm_enabled, agenda_enabled, caja_enabled, updated_at)
         VALUES ('${t}', 'Centro ${t.slice(0, 8)}', true, true, true, true, false, now())`,
      );
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO users (id, tenant_id, email, alias, role, is_clinician, clinical_scope)
       VALUES ('${directoraId}', '${tenantId}', 'dir-${directoraId.slice(0, 8)}@gredos.es', 'Pilar', 'OWNER', true, 'SELECTION')`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO clients (id, tenant_id, first_name, last_name, updated_at)
       VALUES ('${carmenId}', '${tenantId}', 'Carmen', 'Núñez', now())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO resident_profiles (client_id, tenant_id, admission_date, dependency_level, place_type, updated_at)
       VALUES ('${carmenId}', '${tenantId}', '2026-10-14', 'DEPENDIENTE', 'PRIVADA', now())`,
    );
  });

  afterAll(async () => {
    // El orden importa y es parte de lo que se prueba: `care_plan_items`
    // es RESTRICT al residente y al tenant, así que no se puede empezar
    // por el tenant. Que limpiar sea incómodo es la garantía funcionando.
    for (const t of [tenantId, otroTenantId]) {
      await prisma.$executeRawUnsafe(`DELETE FROM care_plan_items WHERE tenant_id = '${t}'`);
      await prisma.$executeRawUnsafe(`DELETE FROM care_plan_template_items WHERE tenant_id = '${t}'`);
      await prisma.$executeRawUnsafe(`DELETE FROM center_control_settings WHERE tenant_id = '${t}'`);
      await prisma.$executeRawUnsafe(`DELETE FROM center_moments WHERE tenant_id = '${t}'`);
      await prisma.$executeRawUnsafe(`DELETE FROM control_types WHERE tenant_id = '${t}'`);
      await prisma.$executeRawUnsafe(`DELETE FROM care_role_assignments WHERE tenant_id = '${t}'`);
      await prisma.$executeRawUnsafe(
        `ALTER TABLE care_roles DISABLE TRIGGER care_roles_de_serie_son_fijos`,
      );
      await prisma.$executeRawUnsafe(`DELETE FROM care_roles WHERE tenant_id = '${t}'`);
      await prisma.$executeRawUnsafe(
        `ALTER TABLE care_roles ENABLE TRIGGER care_roles_de_serie_son_fijos`,
      );
      await prisma.$executeRawUnsafe(`DELETE FROM center_shifts WHERE tenant_id = '${t}'`);
      await prisma.$executeRawUnsafe(`DELETE FROM resident_profiles WHERE tenant_id = '${t}'`);
      await prisma.$executeRawUnsafe(`DELETE FROM clients WHERE tenant_id = '${t}'`);
      await prisma.$executeRawUnsafe(`DELETE FROM users WHERE tenant_id = '${t}'`);
      await prisma.$executeRawUnsafe(`DELETE FROM tenants WHERE id = '${t}'`);
    }
    await shutdown();
  });

  beforeEach(async () => {
    // Todo limpio en cada caso: los índices parciales son globales por
    // tabla, y un residuo haría pasar o fallar el siguiente por razones
    // que no son el caso.
    await prisma.$executeRawUnsafe(`DELETE FROM care_plan_items WHERE tenant_id IN ('${tenantId}', '${otroTenantId}')`);
    await prisma.$executeRawUnsafe(`DELETE FROM care_plan_template_items WHERE tenant_id IN ('${tenantId}', '${otroTenantId}')`);
    await prisma.$executeRawUnsafe(`DELETE FROM center_control_settings WHERE tenant_id IN ('${tenantId}', '${otroTenantId}')`);
    await prisma.$executeRawUnsafe(`DELETE FROM control_types WHERE code LIKE 'E2E_%'`);
  });

  // ══ 1 · EL ALCANCE ═══════════════════════════════════════════════════
  describe("el alcance · un control de serie no tiene centro, uno de centro sí", () => {
    it("un `STANDARD` CON tenant → rechazado", async () => {
      const msg = await debeFallar(
        insertarControl({ scope: "STANDARD", tenantId, code: "E2E_MAL" }),
      );
      expect(msg).toContain("control_types_scope_exige_tenant");
    });

    it("SABOTAJE · un `CENTER` SIN tenant → rechazado", async () => {
      // Ésta es la mitad que parece sobrar y es la que sostiene el índice
      // parcial de «una vigente del centro»: un `CENTER` sin tenant se
      // saldría de él (los NULL son distintos entre sí) y podría haber dos
      // vigentes del mismo código en el mismo centro.
      const msg = await debeFallar(
        insertarControl({ scope: "CENTER", tenantId: null, code: "E2E_MAL2" }),
      );
      expect(msg).toContain("control_types_scope_exige_tenant");
    });

    it("los dos BIEN escritos entran", async () => {
      await prisma.$executeRawUnsafe(
        insertarControl({ scope: "STANDARD", code: "E2E_DE_SERIE" }),
      );
      await prisma.$executeRawUnsafe(
        insertarControl({ scope: "CENTER", tenantId, code: "E2E_PROPIO" }),
      );
      const filas = await prisma.$queryRawUnsafe<Array<{ code: string }>>(
        `SELECT code FROM control_types WHERE code LIKE 'E2E_%' ORDER BY code`,
      );
      expect(filas.map((f) => f.code)).toEqual(["E2E_DE_SERIE", "E2E_PROPIO"]);
    });

    it("UN CONTROL PROPIO NO SALE EN OTRO CENTRO", async () => {
      // Es la otra mitad de D-21: lo de serie baja a todos, lo del centro
      // no baja a ninguno. Lo garantiza la columna, no una ruta.
      await prisma.$executeRawUnsafe(
        insertarControl({ scope: "CENTER", tenantId, code: "E2E_SOLO_MIO" }),
      );
      const delOtro = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM control_types
         WHERE code = 'E2E_SOLO_MIO' AND (scope = 'STANDARD' OR tenant_id = '${otroTenantId}')`,
      );
      expect(Number(delOtro[0]!.n)).toBe(0);
    });

    it("la versión no puede ser 0", async () => {
      const msg = await debeFallar(
        insertarControl({ scope: "STANDARD", code: "E2E_V0", version: 0 }),
      );
      expect(msg).toContain("control_types_version_positiva");
    });
  });

  // ══ 2 · UNA SOLA VERSIÓN VIGENTE ═════════════════════════════════════
  describe("una sola versión vigente por código", () => {
    it("SABOTAJE · DOS VIGENTES de un control DE SERIE → rechazado", async () => {
      // Sin el índice parcial de `STANDARD` por separado, las dos filas
      // tendrían `tenant_id` NULL y serían dos claves distintas: las dos
      // entrarían, y la puerta pediría la temperatura con dos rangos de
      // referencia distintos.
      await prisma.$executeRawUnsafe(
        insertarControl({ scope: "STANDARD", code: "E2E_DOS", version: 1 }),
      );
      const msg = await debeFallar(
        insertarControl({ scope: "STANDARD", code: "E2E_DOS", version: 2 }),
      );
      expect(msg).toContain("Key (code)=(E2E_DOS) already exists");
    });

    it("SABOTAJE · DOS VIGENTES de un control DEL CENTRO → rechazado", async () => {
      await prisma.$executeRawUnsafe(
        insertarControl({ scope: "CENTER", tenantId, code: "E2E_DOSC", version: 1 }),
      );
      const msg = await debeFallar(
        insertarControl({ scope: "CENTER", tenantId, code: "E2E_DOSC", version: 2 }),
      );
      expect(msg).toContain("already exists");
    });

    it("…pero el HISTÓRICO cabe: jubilar la anterior deja entrar la siguiente", async () => {
      await prisma.$executeRawUnsafe(
        insertarControl({
          scope: "STANDARD",
          code: "E2E_HIST",
          version: 1,
          supersededAt: "2026-10-15T00:00:00Z",
        }),
      );
      await prisma.$executeRawUnsafe(
        insertarControl({ scope: "STANDARD", code: "E2E_HIST", version: 2 }),
      );
      const filas = await prisma.$queryRawUnsafe<Array<{ version: number }>>(
        `SELECT version FROM control_types WHERE code = 'E2E_HIST' ORDER BY version`,
      );
      expect(filas.map((f) => f.version)).toEqual([1, 2]);
    });

    it("y la MISMA versión dos veces tampoco · (código, versión) es único", async () => {
      await prisma.$executeRawUnsafe(
        insertarControl({
          scope: "STANDARD",
          code: "E2E_REP",
          version: 1,
          supersededAt: "2026-10-15T00:00:00Z",
        }),
      );
      const msg = await debeFallar(
        insertarControl({
          scope: "STANDARD",
          code: "E2E_REP",
          version: 1,
          supersededAt: "2026-10-16T00:00:00Z",
        }),
      );
      expect(msg).toContain("already exists");
    });
  });

  // ══ 3 · LA FRECUENCIA COHERENTE ══════════════════════════════════════
  describe("la frecuencia es coherente con su tipo", () => {
    it("SABOTAJE · `EVERY_N_HOURS` SIN HORAS → rechazado", async () => {
      // Sería una línea de plan que la puerta leería y no sabría cuándo
      // pedir: el cambio postural de un dependiente, en silencio.
      const msg = await debeFallar(
        `INSERT INTO control_types
          (id, scope, tenant_id, code, version, name, layer, nature, value_domain,
           allowed_frequencies, allowed_care_role_codes, default_frequency_kind,
           valid_from, updated_at)
         VALUES ('${randomUUID()}', 'STANDARD', NULL, 'E2E_SINHORAS', 1, 'X', 'EXEC',
           'SCHEDULED', 'BOOL', ARRAY['EVERY_N_HOURS']::"CareFrequencyKind"[],
           ARRAY['AUXILIAR'], 'EVERY_N_HOURS', now(), now())`,
      );
      expect(msg).toContain("control_types_frecuencia_coherente");
    });

    it("SABOTAJE · `MONTHLY` el día 31 → rechazado", async () => {
      // No tocaría en febrero, abril, junio, septiembre ni noviembre, y
      // nadie lo notaría hasta la auditoría.
      const msg = await debeFallar(
        `INSERT INTO control_types
          (id, scope, tenant_id, code, version, name, layer, nature, value_domain,
           allowed_frequencies, allowed_care_role_codes, default_frequency_kind,
           default_month_day, default_shift_codes, valid_from, updated_at)
         VALUES ('${randomUUID()}', 'STANDARD', NULL, 'E2E_D31', 1, 'X', 'EXEC',
           'SCHEDULED', 'BOOL', ARRAY['MONTHLY']::"CareFrequencyKind"[],
           ARRAY['AUXILIAR'], 'MONTHLY', 31, ARRAY['M'], now(), now())`,
      );
      expect(msg).toContain("control_types_frecuencia_coherente");
    });

    it("SABOTAJE · «a demanda» CON TURNOS puestos → rechazado", async () => {
      // Es el error de quien cambia de tipo y se deja el campo anterior:
      // un control que dice «no tiene agenda» y «toca en la mañana».
      const msg = await debeFallar(
        `INSERT INTO center_control_settings
          (id, tenant_id, control_code, frequency_kind, shift_codes, care_role_codes, updated_at)
         VALUES ('${randomUUID()}', '${tenantId}', 'E2E_X', 'ON_DEMAND',
           ARRAY['M'], ARRAY['AUXILIAR'], now())`,
      );
      expect(msg).toContain("center_control_settings_frecuencia_coherente");
    });

    it("SABOTAJE · `DAILY` con DOS turnos → rechazado · «una vez al día» es una", async () => {
      const msg = await debeFallar(
        `INSERT INTO care_plan_items
          (id, tenant_id, client_id, control_code, frequency_kind, shift_codes,
           from_at, source, source_level)
         VALUES ('${randomUUID()}', '${tenantId}', '${carmenId}', 'E2E_X', 'DAILY',
           ARRAY['M','T'], now(), 'PROFILE_TEMPLATE', 'DEPENDIENTE')`,
      );
      expect(msg).toContain("care_plan_items_frecuencia_coherente");
    });

    it("SABOTAJE · un día de la semana que no existe (el 8) → rechazado", async () => {
      const msg = await debeFallar(
        `INSERT INTO care_plan_template_items
          (id, tenant_id, dependency_level, control_code, frequency_kind,
           weekdays, shift_codes, updated_at)
         VALUES ('${randomUUID()}', '${tenantId}', 'VALIDO', 'E2E_X', 'WEEKDAYS',
           ARRAY[8], ARRAY['M'], now())`,
      );
      expect(msg).toContain("care_plan_template_items_frecuencia_coherente");
    });

    it("la frecuencia de serie TIENE que estar entre las permitidas", async () => {
      const msg = await debeFallar(
        `INSERT INTO control_types
          (id, scope, tenant_id, code, version, name, layer, nature, value_domain,
           allowed_frequencies, allowed_care_role_codes, default_frequency_kind,
           default_shift_codes, valid_from, updated_at)
         VALUES ('${randomUUID()}', 'STANDARD', NULL, 'E2E_NOPERM', 1, 'X', 'EXEC',
           'SCHEDULED', 'BOOL', ARRAY['MONTHLY']::"CareFrequencyKind"[],
           ARRAY['AUXILIAR'], 'DAILY', ARRAY['M'], now(), now())`,
      );
      expect(msg).toContain("control_types_default_entre_permitidas");
    });
  });

  // ══ 4 · UN SOLO «COMO SIEMPRE» ═══════════════════════════════════════
  describe("como mucho un «como siempre» por control (D-16)", () => {
    it("SABOTAJE · DOS opciones marcadas → rechazado", async () => {
      // Con dos, el toque de «como siempre» tendría que elegir, y «algo»
      // acabaría siendo el orden de la lista.
      const id = randomUUID();
      await prisma.$executeRawUnsafe(
        insertarControl({ id, scope: "STANDARD", code: "E2E_ORD" }),
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO control_type_options (id, control_type_id, code, label, sort_order, is_as_usual)
         VALUES ('${randomUUID()}', '${id}', 'BIEN', 'Bien', 10, true)`,
      );
      const msg = await debeFallar(
        `INSERT INTO control_type_options (id, control_type_id, code, label, sort_order, is_as_usual)
         VALUES ('${randomUUID()}', '${id}', 'REGULAR', 'Regular', 20, true)`,
      );
      expect(msg).toContain("Key (control_type_id)");
    });

    it("…y NINGUNA también vale: una comida no tiene «como siempre»", async () => {
      // «Todo» no es «como siempre», es «hoy se lo comió todo». Si lo
      // llevara, la ingesta del centro entero saldría «todo» cada día.
      const id = randomUUID();
      await prisma.$executeRawUnsafe(
        insertarControl({ id, scope: "STANDARD", code: "E2E_COMIDA" }),
      );
      for (const [code, label] of [
        ["TODO", "Todo"],
        ["MITAD", "La mitad"],
      ]) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO control_type_options (id, control_type_id, code, label, sort_order, is_as_usual)
           VALUES ('${randomUUID()}', '${id}', '${code}', '${label}', 10, false)`,
        );
      }
      const n = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM control_type_options WHERE control_type_id = '${id}'`,
      );
      expect(Number(n[0]!.n)).toBe(2);
    });
  });

  // ══ 5 · UNA LÍNEA VIVA POR (RESIDENTE, CONTROL) ══════════════════════
  describe("el plan de un residente", () => {
    const linea = (opts: {
      code?: string;
      toAt?: string | null;
      source?: string;
      level?: string | null;
      kind?: string;
    } = {}) =>
      `INSERT INTO care_plan_items
        (id, tenant_id, client_id, control_code, frequency_kind, every_n_hours,
         from_at, to_at, source, source_level)
       VALUES ('${randomUUID()}', '${tenantId}', '${carmenId}',
         '${opts.code ?? "E2E_POSTURAL"}', '${opts.kind ?? "EVERY_N_HOURS"}', 3,
         '2026-10-14T00:00:00Z', ${opts.toAt ? `'${opts.toAt}'` : "NULL"},
         '${opts.source ?? "PROFILE_TEMPLATE"}',
         ${opts.level === null ? "NULL" : `'${opts.level ?? "DEPENDIENTE"}'`})`;

    it("SABOTAJE · DOS LÍNEAS VIVAS del mismo control → rechazado", async () => {
      // Dos respuestas a «¿cada cuánto se le cambia de postura?», y la
      // puerta tendría que elegir.
      await prisma.$executeRawUnsafe(linea());
      const msg = await debeFallar(linea());
      expect(msg).toContain("Key (client_id, control_code)");
    });

    it("…y el HISTÓRICO cabe: tres cerradas y una viva", async () => {
      // Con un índice TOTAL esto no sería «menos correcto»: sería
      // imposible, y el plan de marzo irreconstruible.
      await prisma.$executeRawUnsafe(linea({ toAt: "2026-11-01T00:00:00Z" }));
      await prisma.$executeRawUnsafe(linea({ toAt: "2026-12-01T00:00:00Z" }));
      await prisma.$executeRawUnsafe(linea({ toAt: "2027-01-01T00:00:00Z" }));
      await prisma.$executeRawUnsafe(linea());
      const filas = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM care_plan_items WHERE client_id = '${carmenId}'`,
      );
      expect(Number(filas[0]!.n)).toBe(4);
      const vivas = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM care_plan_items WHERE client_id = '${carmenId}' AND to_at IS NULL`,
      );
      expect(Number(vivas[0]!.n)).toBe(1);
    });

    it("SABOTAJE · una línea MANUAL con nivel puesto → rechazado", async () => {
      // Es lo que sostiene «las manuales no se tocan»: si cupiera, el
      // recálculo del cambio de nivel la cerraría.
      const msg = await debeFallar(linea({ source: "MANUAL", level: "DEPENDIENTE" }));
      expect(msg).toContain("care_plan_items_origen_coherente");
    });

    it("SABOTAJE · una de PLANTILLA sin nivel → rechazado", async () => {
      // La otra mitad: sin nivel, el recálculo no sabría qué plantilla la
      // puso y cerraría líneas que siguen vigentes.
      const msg = await debeFallar(linea({ source: "PROFILE_TEMPLATE", level: null }));
      expect(msg).toContain("care_plan_items_origen_coherente");
    });

    it("SABOTAJE · una línea cerrada ANTES de abrirse → rechazado", async () => {
      const msg = await debeFallar(linea({ toAt: "2026-01-01T00:00:00Z" }));
      expect(msg).toContain("care_plan_items_vigencia_ordenada");
    });

    it("SABOTAJE · un cierre SIN AUTOR pero con fecha sí vale; al revés NO", async () => {
      // La implicación va en un solo sentido: un cierre disparado por un
      // script no tiene usuario y eso es legítimo; un autor sin fecha de
      // cierre es un cierre que no cerró nada.
      await prisma.$executeRawUnsafe(linea({ toAt: "2026-11-01T00:00:00Z" }));
      const msg = await debeFallar(
        `INSERT INTO care_plan_items
          (id, tenant_id, client_id, control_code, frequency_kind, from_at,
           source, source_level, closed_by_user_id)
         VALUES ('${randomUUID()}', '${tenantId}', '${carmenId}', 'E2E_OTRO',
           'ON_DEMAND', now(), 'PROFILE_TEMPLATE', 'DEPENDIENTE', '${directoraId}')`,
      );
      expect(msg).toContain("care_plan_items_cierre_con_autor");
    });

    it("UN RESIDENTE CON PLAN NO SE BORRA", async () => {
      // Salta `resident_profiles_client_id_fkey`, que es de residencia-1 y
      // va primero. Cualquiera de las dos es la garantía: lo que importa
      // es que el residente NO se borra.
      await prisma.$executeRawUnsafe(linea());
      const msg = await debeFallar(`DELETE FROM clients WHERE id = '${carmenId}'`);
      expect(msg).toMatch(
        /resident_profiles_client_id_fkey|care_plan_items_client_id_fkey/,
      );
    });

    it("…y la FK DEL PLAN sola también lo impide", async () => {
      // Aislado del perfil para que sea el plan quien frene: un cliente
      // sin `resident_profiles` y con una línea de plan. Si la FK del plan
      // fuera `Cascade`, aquí el borrado pasaría y se llevaría el plan de
      // alguien por delante.
      const suelto = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO clients (id, tenant_id, first_name, last_name, updated_at)
         VALUES ('${suelto}', '${tenantId}', 'Cliente', 'Suelto', now())`,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO care_plan_items
          (id, tenant_id, client_id, control_code, frequency_kind, from_at, source, source_level)
         VALUES ('${randomUUID()}', '${tenantId}', '${suelto}', 'E2E_SUELTO',
           'ON_DEMAND', now(), 'PROFILE_TEMPLATE', 'VALIDO')`,
      );
      const msg = await debeFallar(`DELETE FROM clients WHERE id = '${suelto}'`);
      expect(msg).toContain("care_plan_items_client_id_fkey");
      // Y se limpia por el único camino que hay: cerrando la línea antes.
      await prisma.$executeRawUnsafe(
        `DELETE FROM care_plan_items WHERE client_id = '${suelto}'`,
      );
      await prisma.$executeRawUnsafe(`DELETE FROM clients WHERE id = '${suelto}'`);
    });

    it("…ni con el tenant", async () => {
      await prisma.$executeRawUnsafe(linea());
      const msg = await debeFallar(`DELETE FROM tenants WHERE id = '${tenantId}'`);
      // Puede saltar por `resident_profiles` o por `care_plan_items`:
      // las dos son RESTRICT al tenant y cualquiera de las dos es la
      // garantía. Lo que importa es que NO se borra.
      expect(msg).toMatch(/care_plan_items_tenant_id_fkey|resident_profiles_tenant_id_fkey/);
    });

    it("y dar de baja a la DUE que lo ajustó NO borra la línea · SetNull", async () => {
      // Dar de baja a quien ajustó el plan no puede borrar el hecho de que
      // lo ajustó. (Se comprueba el SetNull sobre el autor del cierre, que
      // es la columna que la ruta rellena.)
      await prisma.$executeRawUnsafe(
        `INSERT INTO care_plan_items
          (id, tenant_id, client_id, control_code, frequency_kind, from_at,
           source, source_level, created_by_user_id)
         VALUES ('${randomUUID()}', '${tenantId}', '${carmenId}', 'E2E_FIRMA',
           'ON_DEMAND', now(), 'PROFILE_TEMPLATE', 'DEPENDIENTE', '${directoraId}')`,
      );
      const otro = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO users (id, tenant_id, email, alias, role, clinical_scope)
         VALUES ('${otro}', '${tenantId}', 'due-${otro.slice(0, 8)}@gredos.es', 'Marta', 'CASHIER', 'SELECTION')`,
      );
      await prisma.$executeRawUnsafe(
        `UPDATE care_plan_items SET created_by_user_id = '${otro}' WHERE control_code = 'E2E_FIRMA'`,
      );
      await prisma.$executeRawUnsafe(`DELETE FROM users WHERE id = '${otro}'`);
      const filas = await prisma.$queryRawUnsafe<
        Array<{ created_by_user_id: string | null }>
      >(`SELECT created_by_user_id FROM care_plan_items WHERE control_code = 'E2E_FIRMA'`);
      expect(filas).toHaveLength(1);
      expect(filas[0]!.created_by_user_id).toBeNull();
    });
  });

  // ══ 6 · LOS MOMENTOS ═════════════════════════════════════════════════
  describe("los momentos del día", () => {
    it("SABOTAJE · una hora que no existe → rechazada", async () => {
      // `queToca` parte la cadena por los dos puntos: un «25:00» daría una
      // ocurrencia a una hora imposible.
      const msg = await debeFallar(
        `INSERT INTO center_moments (id, tenant_id, code, name, at_time, updated_at)
         VALUES ('${randomUUID()}', '${tenantId}', 'E2E_M', 'X', '25:00', now())`,
      );
      expect(msg).toContain("center_moments_hora_valida");
    });

    it("SABOTAJE · «9:00» sin el cero delante → rechazada", async () => {
      const msg = await debeFallar(
        `INSERT INTO center_moments (id, tenant_id, code, name, at_time, updated_at)
         VALUES ('${randomUUID()}', '${tenantId}', 'E2E_M2', 'X', '9:00', now())`,
      );
      expect(msg).toContain("center_moments_hora_valida");
    });
  });

  // ══ 7 · LA SEMILLA DEL CENTRO, de verdad ═════════════════════════════
  describe("la semilla del centro", () => {
    it("siembra los momentos, un ajuste por control y las tres plantillas", async () => {
      await prisma.$executeRawUnsafe(
        `DELETE FROM center_shifts WHERE tenant_id = '${otroTenantId}'`,
      );
      await sembrarResidencia(prisma as never, otroTenantId);

      const cuenta = async (tabla: string) => {
        const r = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
          `SELECT count(*) AS n FROM ${tabla} WHERE tenant_id = '${otroTenantId}'`,
        );
        return Number(r[0]!.n);
      };
      expect(await cuenta("center_moments")).toBe(5);
      expect(await cuenta("center_control_settings")).toBeGreaterThan(30);
      expect(await cuenta("care_plan_template_items")).toBeGreaterThan(40);

      // Y es idempotente: apagar y volver a encender no duplica nada.
      await sembrarResidencia(prisma as never, otroTenantId);
      expect(await cuenta("center_moments")).toBe(5);
    });

    it("y el cambio postural cada 3 h está SÓLO en la del dependiente", async () => {
      await sembrarResidencia(prisma as never, otroTenantId);
      const filas = await prisma.$queryRawUnsafe<
        Array<{ dependency_level: string; every_n_hours: number }>
      >(
        `SELECT dependency_level, every_n_hours FROM care_plan_template_items
         WHERE tenant_id = '${otroTenantId}' AND control_code = 'CAMBIO_POSTURAL'`,
      );
      expect(filas).toHaveLength(1);
      expect(filas[0]!.dependency_level).toBe("DEPENDIENTE");
      expect(filas[0]!.every_n_hours).toBe(3);
    });
  });

  // ══ 8 · EL SEED DEL CATÁLOGO · versiones y reconducción ══════════════
  describe("el seed del catálogo de serie", () => {
    const UNO = {
      code: "E2E_SEED",
      version: 1,
      name: "Control del seed",
      layer: "EXEC" as const,
      nature: "SCHEDULED" as const,
      valueDomain: "BOOL" as const,
      allowedFrequencies: ["DAILY", "EVERY_SHIFT"] as const,
      defaultFrequency: { kind: "DAILY" as const, shiftCodes: ["M"] },
      allowedCareRoleCodes: ["AUXILIAR", "DUE"],
      sortOrder: 1,
    };

    it("inserta lo que falta", async () => {
      const r = await cargarCatalogoDeSerie([{ ...UNO }] as never);
      expect(r.insertados).toEqual(["E2E_SEED"]);
      const filas = await prisma.$queryRawUnsafe<
        Array<{ version: number; superseded_at: Date | null }>
      >(`SELECT version, superseded_at FROM control_types WHERE code = 'E2E_SEED'`);
      expect(filas).toEqual([{ version: 1, superseded_at: null }]);
    });

    it("correr DOS VECES el mismo fichero no escribe nada", async () => {
      await cargarCatalogoDeSerie([{ ...UNO }] as never);
      const r = await cargarCatalogoDeSerie([{ ...UNO }] as never);
      expect(r.insertados).toEqual([]);
      expect(r.versionesNuevas).toEqual([]);
    });

    it("UNA VERSIÓN NUEVA se publica y la anterior se JUBILA, no se edita", async () => {
      await cargarCatalogoDeSerie([{ ...UNO }] as never);
      const r = await cargarCatalogoDeSerie([
        { ...UNO, version: 2, name: "Control del seed, v2" },
      ] as never);
      expect(r.versionesNuevas).toEqual(["E2E_SEED@2"]);

      const filas = await prisma.$queryRawUnsafe<
        Array<{ version: number; name: string; superseded_at: Date | null }>
      >(
        `SELECT version, name, superseded_at FROM control_types
         WHERE code = 'E2E_SEED' ORDER BY version`,
      );
      expect(filas).toHaveLength(2);
      // La 1 se queda con SU nombre: lo registrado con ella sigue
      // apuntando a ella, y «¿qué decía la guía cuando se apuntó esto?» se
      // puede contestar tres años después.
      expect(filas[0]!.name).toBe("Control del seed");
      expect(filas[0]!.superseded_at).not.toBeNull();
      expect(filas[1]!.name).toBe("Control del seed, v2");
      expect(filas[1]!.superseded_at).toBeNull();
    });

    it("si el texto cambia SIN subir la versión, avisa y NO propaga", async () => {
      // Una versión publicada no se edita (decisión de producto 5): la
      // alternativa —pisar la fila— haría que el histórico cambiara de
      // significado hacia atrás.
      await cargarCatalogoDeSerie([{ ...UNO }] as never);
      const r = await cargarCatalogoDeSerie([
        { ...UNO, name: "Otro nombre a traición" },
      ] as never);
      expect(r.cambiadosSinSubirVersion).toEqual(["E2E_SEED"]);
      const filas = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT name FROM control_types WHERE code = 'E2E_SEED'`,
      );
      expect(filas).toEqual([{ name: "Control del seed" }]);
    });

    it("UNA VERSIÓN NUEVA CONSERVA el ajuste del centro si sigue valiendo", async () => {
      await cargarCatalogoDeSerie([{ ...UNO }] as never);
      // El centro elige «cada turno», que la versión 1 permite.
      await prisma.$executeRawUnsafe(
        `INSERT INTO center_control_settings
          (id, tenant_id, control_code, frequency_kind, shift_codes, care_role_codes, updated_at)
         VALUES ('${randomUUID()}', '${tenantId}', 'E2E_SEED', 'EVERY_SHIFT',
           ARRAY['M','T'], ARRAY['DUE'], now())`,
      );
      // La versión 2 sigue permitiéndola.
      const r = await cargarCatalogoDeSerie([{ ...UNO, version: 2 }] as never);
      expect(r.ajustesReconducidos).toEqual([]);
      const filas = await prisma.$queryRawUnsafe<
        Array<{ frequency_kind: string; reconducted_at: Date | null }>
      >(
        `SELECT frequency_kind, reconducted_at FROM center_control_settings
         WHERE tenant_id = '${tenantId}' AND control_code = 'E2E_SEED'`,
      );
      expect(filas[0]!.frequency_kind).toBe("EVERY_SHIFT");
      expect(filas[0]!.reconducted_at).toBeNull();
    });

    it("…y lo RECONDUCE, ANOTÁNDOLO, si la versión nueva retira esa frecuencia", async () => {
      await cargarCatalogoDeSerie([{ ...UNO }] as never);
      await prisma.$executeRawUnsafe(
        `INSERT INTO center_control_settings
          (id, tenant_id, control_code, frequency_kind, shift_codes, care_role_codes, updated_at)
         VALUES ('${randomUUID()}', '${tenantId}', 'E2E_SEED', 'EVERY_SHIFT',
           ARRAY['M','T'], ARRAY['DUE'], now())`,
      );
      // La versión 2 retira `EVERY_SHIFT`.
      const r = await cargarCatalogoDeSerie([
        { ...UNO, version: 2, allowedFrequencies: ["DAILY"] },
      ] as never);
      expect(r.ajustesReconducidos).toEqual([`${tenantId}:E2E_SEED`]);

      const filas = await prisma.$queryRawUnsafe<
        Array<{
          frequency_kind: string;
          shift_codes: string[];
          reconducted_at: Date | null;
          reconducted_from_version: number | null;
          reconducted_reason: string | null;
        }>
      >(
        `SELECT frequency_kind, shift_codes, reconducted_at, reconducted_from_version, reconducted_reason
         FROM center_control_settings WHERE tenant_id = '${tenantId}' AND control_code = 'E2E_SEED'`,
      );
      // Llevado a la de serie de la versión nueva…
      expect(filas[0]!.frequency_kind).toBe("DAILY");
      expect(filas[0]!.shift_codes).toEqual(["M"]);
      // …y ANOTADO, que es la mitad de la decisión: reconducir en silencio
      // es cambiar el plan de 49 personas sin decírselo a nadie.
      expect(filas[0]!.reconducted_at).not.toBeNull();
      expect(filas[0]!.reconducted_from_version).toBe(1);
      expect(filas[0]!.reconducted_reason).toContain("EVERY_SHIFT");
    });

    it("…y si retira un ROL, lo QUITA y conserva los que siguen valiendo", async () => {
      // El centro había estrechado la lista a propósito; devolverla entera
      // a la de serie sería ensancharla, que es lo que la frontera
      // prohíbe.
      await cargarCatalogoDeSerie([{ ...UNO }] as never);
      await prisma.$executeRawUnsafe(
        `INSERT INTO center_control_settings
          (id, tenant_id, control_code, frequency_kind, shift_codes, care_role_codes, updated_at)
         VALUES ('${randomUUID()}', '${tenantId}', 'E2E_SEED', 'DAILY',
           ARRAY['M'], ARRAY['AUXILIAR','DUE'], now())`,
      );
      const r = await cargarCatalogoDeSerie([
        { ...UNO, version: 2, allowedCareRoleCodes: ["DUE"] },
      ] as never);
      expect(r.ajustesReconducidos).toEqual([`${tenantId}:E2E_SEED`]);
      const filas = await prisma.$queryRawUnsafe<
        Array<{ care_role_codes: string[]; reconducted_reason: string }>
      >(
        `SELECT care_role_codes, reconducted_reason FROM center_control_settings
         WHERE tenant_id = '${tenantId}' AND control_code = 'E2E_SEED'`,
      );
      expect(filas[0]!.care_role_codes).toEqual(["DUE"]);
      expect(filas[0]!.reconducted_reason).toContain("AUXILIAR");
    });

    it("un fichero MAL ESCRITO para el arranque en seco y no carga nada a medias", async () => {
      // Un catálogo con la mitad de los controles es un centro al que le
      // falta la mitad del plan, y eso se nota el primer turno pero no en
      // el arranque.
      await expect(
        cargarCatalogoDeSerie([
          { ...UNO, code: "E2E_MALO", defaultFrequency: { kind: "EVERY_N_HOURS" } },
        ] as never),
      ).rejects.toThrow(/cada cuántas horas/i);
      const filas = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM control_types WHERE code = 'E2E_MALO'`,
      );
      expect(Number(filas[0]!.n)).toBe(0);
    });
  });
});
