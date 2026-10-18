// residencia-3 · **LA PUERTA, CONTRA POSTGRES DE VERDAD.**
//
// Este fichero **monta las rutas**, como `residencia-1b.e2e.ts` y por lo
// mismo: lo que hay que ver es el camino completo —se teclea el PIN, la
// tablet manda un lote, la base guarda ciphertext inmutable, la pantalla
// vuelve a leer lo mismo— y eso no se ve mirando sólo el esquema.
//
// Y lo que SÓLO contesta Postgres, que es la mitad del bloque:
//
//   · un registro de cuidado **no se borra** y **no se edita**;
//   · la **anulación** es la única transición que pasa;
//   · el **claro no cabe** en la columna del valor;
//   · **una fila por ocurrencia**, con sus dos `COALESCE`;
//   · y un `SELECT` en crudo no enseña ni el valor ni la nota.
//
// Las garantías, una por bloque:
//
//    1. El PIN: lo resuelve, lo firma, y un PIN repetido no se puede poner.
//    2. «Como siempre» escribe N filas (N = dimensiones `OBS` activas).
//    3. «No como siempre» con una cambiada escribe 1 + (N−1).
//    4. Repetir en el turno CORRIGE, no duplica.
//    5. Un envío repetido NO duplica (idempotencia por el uuid de la tablet).
//    6. `recordedAt` fuera de límites se rechaza con su código.
//    7. Un registro SIN TURNO se guarda, con su aviso.
//    8. Anular: sólo lo propio y sólo en la ventana.
//    9. Corregir crea fila nueva y la vieja se queda.
//   10. Lo cifrado se escribe cifrado, y un valor movido de fila no se
//       descifra.
//   11. La foto sin consentimiento no se sirve.
//   12. Una puerta no ve otra habitación, y fuera de zona no se ven datos.
//   13. La tabla de SABOTAJES contra el motor.

import { createHash, randomBytes, randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// clinica-8 · la versión es la VIGENTE, no un `1` escrito a mano: al sacar
// la v2 del contrato de encargado, una aceptación de la versión vieja deja
// el módulo clínico en SOLO LECTURA (423) y este fichero entero se va a
// rojo. Es la garantía de clinica-7 funcionando; con la constante, la
// próxima versión no vuelve a costar una pasada.
import { VERSION_VIGENTE } from "@mipiacetpv/contrato-encargado";

import { E2E_DATABASE_URL, e2eEnabled, SKIP_MESSAGE } from "./e2e-env.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  E2E_DATABASE_URL || "postgresql://e2e:e2e@127.0.0.1:5432/e2e";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET = "g".repeat(40);
process.env.JWT_REFRESH_SECRET = "h".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

// ── Redis, en memoria · POR QUÉ ──────────────────────────────────────
//
// El rate-limit del PIN de la puerta habla con Redis, y el job `e2e` de
// CI sólo levanta Postgres («preferible mantener la suite autocontenida»,
// .github/workflows/ci.yml). El cliente de `context.ts` va con
// `maxRetriesPerRequest: null` —lo exige BullMQ para reconectar limpio—,
// así que sin Redis el primer `inspect` del PIN **no falla: espera para
// siempre**. Resultado medido en el run 38776991509: 51 de los 60 casos
// de este fichero murieron uno a uno al timeout de 60 s y el job tardó
// 48 minutos en vez de dos.
//
// Lo que se sustituye es el TRANSPORTE, no el limitador: `rate-limit.ts`
// y la ruta siguen siendo los de verdad —contador, candado, TTL y los
// umbrales por puerta—, sólo que las claves viven en un Map con TTL
// (mismo patrón que `test/rate-limit-caracterizacion.test.ts`). Mockear
// `rate-limit.js` entero, como hace `holded-desconectar.e2e.ts`, aquí
// dejaría el candado del PIN sin NINGUNA prueba en todo el repo: la ruta
// de la puerta no tiene test de unidad que lo cubra.
vi.mock("../src/context.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/context.js")>();

  interface Clave {
    valor: string;
    caducaEn: number | null;
  }
  const claves = new Map<string, Clave>();

  /** La clave si no ha caducado. Caducar borra, como hace Redis. */
  function viva(key: string): Clave | null {
    const c = claves.get(key);
    if (!c) return null;
    if (c.caducaEn !== null && c.caducaEn <= Date.now()) {
      claves.delete(key);
      return null;
    }
    return c;
  }

  const falso = {
    async incr(key: string) {
      const c = viva(key);
      const valor = c ? Number(c.valor) + 1 : 1;
      claves.set(key, { valor: String(valor), caducaEn: c?.caducaEn ?? null });
      return valor;
    },
    async decr(key: string) {
      const c = viva(key);
      const valor = c ? Number(c.valor) - 1 : -1;
      claves.set(key, { valor: String(valor), caducaEn: c?.caducaEn ?? null });
      return valor;
    },
    async get(key: string) {
      return viva(key)?.valor ?? null;
    },
    async set(key: string, valor: string, _ex?: string, segundos?: number) {
      claves.set(key, {
        valor,
        caducaEn: segundos == null ? null : Date.now() + segundos * 1000,
      });
      return "OK";
    },
    async ttl(key: string) {
      const c = viva(key);
      if (!c) return -2;
      if (c.caducaEn === null) return -1;
      return Math.ceil((c.caducaEn - Date.now()) / 1000);
    },
    async expire(key: string, segundos: number) {
      const c = viva(key);
      if (!c) return 0;
      claves.set(key, { valor: c.valor, caducaEn: Date.now() + segundos * 1000 });
      return 1;
    },
    async del(...keys: string[]) {
      let n = 0;
      for (const k of keys) if (claves.delete(k)) n += 1;
      return n;
    },
    async flushall() {
      claves.clear();
      return "OK";
    },
    async ping() {
      return "PONG";
    },
    disconnect() {},
  };

  return {
    ...original,
    getRedis: () => falso as unknown as ReturnType<typeof original.getRedis>,
  };
});

const { getPrisma, getRedis, shutdown } = await import("../src/context.js");
const { cargarCatalogoDeSerie } = await import(
  "../src/residencia/catalogo/cargar-catalogo.js"
);
const { sembrarResidencia } = await import("../src/residencia/semilla.js");
const { registerResidenciaPuertaRegistroRoutes } = await import(
  "../src/residencia/puerta-registro-routes.js"
);
const { registerResidenciaFichaRoutes } = await import(
  "../src/residencia/ficha-routes.js"
);
const { registerResidenciaResidentesRoutes } = await import(
  "../src/residencia/residentes-routes.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");
const { dekDe, olvidarClaves } = await import("../src/clinica/claves.js");
const { olvidarEstado } = await import("../src/clinica/contrato.js");
const { cifrarValor, descifrarValor } = await import("../src/clinica/cripto.js");
const { sitioValorDeRegistro, sitioNotaDeRegistro } = await import(
  "../src/clinica/cripto-campos.js"
);
const { VENTANA_DE_ANULACION_MS } = await import(
  "../src/residencia/registro.js"
);

/** El texto de la nota que se teclea. Es el canario de este fichero: si
 *  aparece en un volcado, el bloque no sirve. */
const CANARIO_NOTA = "CANARIO-NOTA-le-huele-raro-el-pie";

const PIN_ANA = "4071";
const PIN_ROSA = "9182";

/**
 * residencia-4 · vacía el libro de incidencias de un centro.
 *
 * Hace falta aquí desde ese bloque: lo que este fichero registra deriva
 * incidencias, y sus FKs a `care_records` son RESTRICT. Los dos triggers
 * se apartan porque una incidencia es inmutable y una acción es
 * append-only — que es justo lo que esos bloques prometen.
 */
async function limpiarElLibro(t: string): Promise<void> {
  const prisma = getPrisma();
  for (const [tabla, trigger] of [
    ["family_communications", "family_communications_append_only"],
    ["incident_actions", "incident_actions_append_only"],
    ["incidents", "incidents_inmutable"],
  ] as const) {
    await prisma.$executeRawUnsafe(`ALTER TABLE ${tabla} DISABLE TRIGGER ${trigger}`);
  }
  await prisma.$executeRawUnsafe(`DELETE FROM guard_alerts WHERE tenant_id = '${t}'`);
  await prisma.$executeRawUnsafe(`DELETE FROM family_communications WHERE tenant_id = '${t}'`);
  await prisma.$executeRawUnsafe(`DELETE FROM incident_actions WHERE tenant_id = '${t}'`);
  await prisma.$executeRawUnsafe(`DELETE FROM incident_links WHERE tenant_id = '${t}'`);
  await prisma.$executeRawUnsafe(`DELETE FROM incidents WHERE tenant_id = '${t}'`);
  for (const [tabla, trigger] of [
    ["family_communications", "family_communications_append_only"],
    ["incident_actions", "incident_actions_append_only"],
    ["incidents", "incidents_inmutable"],
  ] as const) {
    await prisma.$executeRawUnsafe(`ALTER TABLE ${tabla} ENABLE TRIGGER ${trigger}`);
  }
}

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

describe.skipIf(!e2eEnabled)("e2e · la puerta de la habitación", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let app: FastifyInstance;
  let tenantId = "";
  let directoraId = "";
  let anaId = "";
  let rosaId = "";
  let plantaId = "";
  let otraPlantaId = "";
  let hab112 = "";
  let hab201 = "";
  let cama112A = "";
  let cama112B = "";
  let cama201A = "";
  let carmenId = "";
  let luisId = "";
  let manuelId = "";
  let tablet112 = "";
  let token112 = "";
  let tablet201 = "";
  let token201 = "";
  let turnos: Array<{ id: string; code: string }> = [];
  let comoDirectora: Record<string, string> = {};

  /** Entra con un PIN y devuelve las cabeceras de la puerta. */
  async function entrar(
    pin: string,
    token = token112,
  ): Promise<Record<string, string>> {
    const r = await app.inject({
      method: "POST",
      url: "/residencia/puerta/pin",
      headers: { "x-device-token": token },
      payload: { pin },
    });
    expect(r.statusCode, r.body).toBe(200);
    const body = r.json();
    expect(body.token, r.body).toBeTruthy();
    return {
      "x-device-token": token,
      authorization: `Bearer ${body.token}`,
    };
  }

  /** Manda un lote. Devuelve la respuesta cruda. */
  function mandar(
    cabeceras: Record<string, string>,
    registros: unknown[],
  ): Promise<Awaited<ReturnType<typeof app.inject>>> {
    return app.inject({
      method: "POST",
      url: "/residencia/puerta/registros",
      headers: cabeceras,
      payload: { registros },
    });
  }

  /** Un registro, con los valores por defecto del turno de mañana. */
  function registro(p: Record<string, unknown> = {}): Record<string, unknown> {
    const manana = turnos.find((t) => t.code === "M")!;
    return {
      id: randomUUID(),
      clientId: carmenId,
      controlCode: "ANIMO",
      recordedAt: new Date().toISOString(),
      centerShiftId: manana.id,
      careDay: new Date().toISOString().slice(0, 10),
      valor: { tipo: "ORDINAL", opcion: "COMO_SIEMPRE" },
      ...p,
    };
  }

  /**
   * Las dimensiones `OBS` activas con «como siempre», como las ve la
   * tablet: **su código y el código de SU valor de normalidad**.
   *
   * Se leen de la base y no se fija el número a mano: el día que el
   * catálogo gane una dimensión, N cambia solo.
   *
   * Y traen el `asUsual` porque **no todas dicen `COMO_SIEMPRE`**: el de
   * dolor es `SIN_DOLOR` y el de piel y descanso es `BIEN` (residencia-2
   * §4: ninguna etiqueta de esta capa emite un juicio absoluto, y «sin
   * dolor» dice qué es la normalidad de esa dimensión). Mandar
   * `COMO_SIEMPRE` para las siete dejaba tres fuera con
   * `OPCION_DESCONOCIDA` — y eso lo encontró este test, no el pensarlo.
   */
  async function dimensiones(): Promise<
    Array<{ code: string; asUsual: string }>
  > {
    return prisma.$queryRawUnsafe<Array<{ code: string; asUsual: string }>>(
      `SELECT ct.code AS code, o.code AS "asUsual" FROM control_types ct
       JOIN control_type_options o ON o.control_type_id = ct.id AND o.is_as_usual
       WHERE ct.superseded_at IS NULL AND ct.layer = 'OBS'
         AND (ct.scope = 'STANDARD' OR ct.tenant_id = '${tenantId}')
       ORDER BY ct.sort_order`,
    );
  }

  beforeAll(async () => {
    await cargarCatalogoDeSerie();

    tenantId = randomUUID();
    directoraId = randomUUID();
    anaId = randomUUID();
    rosaId = randomUUID();

    await prisma.$executeRawUnsafe(
      `INSERT INTO tenants (id, name, residencia_enabled, clinical_records_enabled, crm_enabled, agenda_enabled, caja_enabled, updated_at)
       VALUES ('${tenantId}', 'Jardín de Gredos', true, true, true, true, false, now())`,
    );
    for (const [u, alias, rol] of [
      [directoraId, "Pilar", "OWNER"],
      [anaId, "Ana", "CLINICIAN"],
      [rosaId, "Rosa", "CLINICIAN"],
    ] as const) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO users (id, tenant_id, email, alias, role, is_clinician, clinical_scope)
         VALUES ('${u}', '${tenantId}', '${alias.toLowerCase()}@gredos.es', '${alias}', '${rol}', true, 'SELECTION')`,
      );
    }
    await sembrarResidencia(prisma as never, tenantId);
    // Los roles de cuidado: la directora `DIRECCION` (alcance total), Ana
    // `AUXILIAR` (alcance por zona) y Rosa `DUE` (alcance total).
    for (const [u, code] of [
      [directoraId, "DIRECCION"],
      [anaId, "AUXILIAR"],
      [rosaId, "DUE"],
    ] as const) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO care_role_assignments (id, tenant_id, user_id, care_role_id, from_at, granted_by_user_id)
         SELECT '${randomUUID()}', '${tenantId}', '${u}', id, now() - interval '400 days', '${directoraId}'
         FROM care_roles WHERE tenant_id = '${tenantId}' AND code = '${code}'`,
      );
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO clinical_processor_agreements (id, tenant_id, version, text_sha256, user_id, at)
       VALUES ('${randomUUID()}', '${tenantId}', ${VERSION_VIGENTE}, '${"a".repeat(64)}', '${directoraId}', now())`,
    );

    plantaId = randomUUID();
    otraPlantaId = randomUUID();
    hab112 = randomUUID();
    hab201 = randomUUID();
    cama112A = randomUUID();
    cama112B = randomUUID();
    cama201A = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO floors (id, tenant_id, name, sort_order, updated_at)
       VALUES ('${plantaId}', '${tenantId}', 'Primera', 1, now()),
              ('${otraPlantaId}', '${tenantId}', 'Segunda', 2, now())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO rooms (id, tenant_id, floor_id, number, active, updated_at)
       VALUES ('${hab112}', '${tenantId}', '${plantaId}', '112', true, now()),
              ('${hab201}', '${tenantId}', '${otraPlantaId}', '201', true, now())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO beds (id, tenant_id, room_id, label, active, updated_at)
       VALUES ('${cama112A}', '${tenantId}', '${hab112}', 'A', true, now()),
              ('${cama112B}', '${tenantId}', '${hab112}', 'B', true, now()),
              ('${cama201A}', '${tenantId}', '${hab201}', 'A', true, now())`,
    );
    // Ana cubre la PRIMERA planta, y nada más. De aquí sale D-51.
    await prisma.$executeRawUnsafe(
      `INSERT INTO care_zone_assignments (id, tenant_id, user_id, floor_id, from_at, granted_by_user_id)
       VALUES ('${randomUUID()}', '${tenantId}', '${anaId}', '${plantaId}', now() - interval '30 days', '${directoraId}')`,
    );

    comoDirectora = {
      authorization: `Bearer ${signAccessToken({ sub: directoraId, tid: tenantId, role: "OWNER" })}`,
    };

    app = Fastify({ logger: false });
    await registerResidenciaPuertaRegistroRoutes(app);
    await registerResidenciaFichaRoutes(app);
    await registerResidenciaResidentesRoutes(app);
    await app.ready();

    // Los residentes, por la ruta de verdad (así se les precarga el plan).
    for (const [nombre, cama] of [
      ["Carmen", cama112A],
      ["Luis", cama112B],
      ["Manuel", cama201A],
    ] as const) {
      const r = await app.inject({
        method: "POST",
        url: "/residencia/residentes",
        headers: comoDirectora,
        payload: {
          firstName: nombre,
          lastName: "Núñez",
          admissionDate: "2026-09-01",
          dependencyLevel: "DEPENDIENTE",
          placeType: "PRIVADA",
          bedId: cama,
        },
      });
      expect(r.statusCode, r.body).toBe(201);
      const id = r.json().residente.clientId as string;
      if (nombre === "Carmen") carmenId = id;
      if (nombre === "Luis") luisId = id;
      if (nombre === "Manuel") manuelId = id;
    }

    // Las dos tablets.
    for (const [hab, slot] of [
      [hab112, "112"],
      [hab201, "201"],
    ] as const) {
      const id = randomUUID();
      const token = randomBytes(24).toString("hex");
      await prisma.$executeRawUnsafe(
        `INSERT INTO devices (id, tenant_id, kind, room_id, register_id, name, device_token_hash)
         VALUES ('${id}', '${tenantId}', 'ROOM', '${hab}', NULL, 'Puerta ${slot}',
                 '${createHash("sha256").update(token, "utf8").digest("hex")}')`,
      );
      if (slot === "112") {
        tablet112 = id;
        token112 = token;
      } else {
        tablet201 = id;
        token201 = token;
      }
    }

    const filasDeTurno = await prisma.$queryRawUnsafe<
      Array<{ id: string; code: string }>
    >(`SELECT id, code FROM center_shifts WHERE tenant_id = '${tenantId}'`);
    turnos = filasDeTurno;

    // Los PIN, por la ruta de verdad.
    for (const [u, pin] of [
      [anaId, PIN_ANA],
      [rosaId, PIN_ROSA],
    ] as const) {
      const r = await app.inject({
        method: "PUT",
        url: `/residencia/personal/${u}/pin-de-puerta`,
        headers: comoDirectora,
        payload: { pin },
      });
      expect(r.statusCode, r.body).toBe(200);
    }
  });

  afterAll(async () => {
    await app?.close();
    const t = tenantId;
    // residencia-4 · EL LIBRO CUELGA DE LOS REGISTROS.
    //
    // Desde ese bloque, un «algo no va bien» deriva una incidencia N1 y
    // la incidencia apunta al registro con `incidents_source_record_id_
    // fkey`, que es RESTRICT. Así que el libro se vacía ANTES —y con sus
    // dos triggers apartados, porque las incidencias son inmutables y las
    // acciones append-only—. Lo encontró este `afterAll` al no poder
    // borrar lo que este fichero había creado, que es otra garantía del
    // bloque nuevo funcionando.
    await limpiarElLibro(t);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE care_records DISABLE TRIGGER care_records_inmutable`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM care_records WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE care_records ENABLE TRIGGER care_records_inmutable`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM care_pins WHERE tenant_id = '${t}'`);
    // El registro de accesos ANTES de las tablets, y con su trigger
    // apartado: `clinical_access_log.device_id` es `SetNull`, así que
    // borrar un dispositivo intenta un UPDATE sobre una tabla que es SÓLO
    // INSERCIONES. Lo encontró este `afterAll` al no poder limpiar, y es
    // otra garantía funcionando — revocar un aparato no borra la línea de
    // quién abrió una historia desde él.
    await prisma.$executeRawUnsafe(
      `ALTER TABLE clinical_access_log DISABLE TRIGGER clinical_access_log_append_only`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM clinical_access_log WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE clinical_access_log ENABLE TRIGGER clinical_access_log_append_only`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM devices WHERE tenant_id = '${t}'`);
    // Un consentimiento firmado NO SE BORRA (clinica-4): para retirarlo se
    // firma una revocación. Otro trigger que hay que apartar para limpiar,
    // y otra garantía funcionando — lo encontró el `afterAll` de este
    // fichero al no poder borrar lo que había creado.
    await prisma.$executeRawUnsafe(
      `ALTER TABLE client_consents DISABLE TRIGGER client_consents_append_only`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM client_consents WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE client_consents ENABLE TRIGGER client_consents_append_only`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM care_plan_items WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM care_plan_template_items WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM center_control_settings WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM center_moments WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM center_shifts WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE clinical_processor_agreements DISABLE TRIGGER clinical_processor_agreements_append_only`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM clinical_processor_agreements WHERE tenant_id = '${t}'`,
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE clinical_processor_agreements ENABLE TRIGGER clinical_processor_agreements_append_only`,
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE clinical_tenant_keys DISABLE TRIGGER clinical_tenant_keys_guard`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM clinical_tenant_keys WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE clinical_tenant_keys ENABLE TRIGGER clinical_tenant_keys_guard`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM care_zone_assignments WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM care_role_assignments WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM bed_assignments WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM beds WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM rooms WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM floors WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM resident_profiles WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM clients WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE care_roles DISABLE TRIGGER care_roles_de_serie_son_fijos`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM care_roles WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE care_roles ENABLE TRIGGER care_roles_de_serie_son_fijos`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM users WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM tenants WHERE id = '${t}'`);
    await shutdown();
  });

  beforeEach(async () => {
    olvidarClaves();
    olvidarEstado();
    // Los intentos fallidos de un caso no cuentan en el siguiente: el
    // candado del PIN se prueba donde toca y no por acumulación.
    await getRedis().flushall();
    await limpiarElLibro(tenantId);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE care_records DISABLE TRIGGER care_records_inmutable`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM care_records WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE care_records ENABLE TRIGGER care_records_inmutable`,
    );
  });

  // ══ 1 · EL PIN ═══════════════════════════════════════════════════
  describe("el PIN", () => {
    it("lo resuelve y devuelve quién es y con qué rol", async () => {
      const r = await app.inject({
        method: "POST",
        url: "/residencia/puerta/pin",
        headers: { "x-device-token": token112 },
        payload: { pin: PIN_ANA },
      });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().usuario.nombre).toBe("Ana");
      expect(r.json().rol.code).toBe("AUXILIAR");
      // Y la ventana de inactividad la dice el servidor: un minuto.
      expect(r.json().inactividadSegundos).toBe(60);
    });

    it("un PIN que no es de nadie da 401 con la MISMA frase que uno malo", async () => {
      // Decir cuál de las dos es permite barrer el espacio de cuatro
      // cifras aprendiendo qué PIN existen.
      const r = await app.inject({
        method: "POST",
        url: "/residencia/puerta/pin",
        headers: { "x-device-token": token112 },
        payload: { pin: "0000" },
      });
      expect(r.statusCode).toBe(401);
      expect(r.json().message).toBe("Ese PIN no es correcto.");
    });

    it("UN PIN REPETIDO NO SE PUEDE PONER, y no dice de quién es", async () => {
      // Es lo que hace que teclear cuatro cifras identifique a alguien. Y
      // no se dice quién lo tiene: eso sería regalar el PIN de otra
      // persona a quien abre la pantalla de Personal.
      const r = await app.inject({
        method: "PUT",
        url: `/residencia/personal/${rosaId}/pin-de-puerta`,
        headers: comoDirectora,
        payload: { pin: PIN_ANA },
      });
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json().error).toBe("PIN_YA_USADO");
      expect(r.json().message).not.toContain("Ana");
    });

    it("y el PIN NO SALE de la API: ni su hash, ni su huella", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/residencia/puerta/arranque",
        headers: { "x-device-token": token112 },
      });
      expect(r.statusCode, r.body).toBe(200);
      // El roster lleva la HUELLA (que es lo que resuelve el PIN sin red) y
      // nunca el hash de la contraseña.
      expect(r.body).not.toContain("$argon2");
      expect(r.body).not.toContain(PIN_ANA);
    });

    it("quien no tiene rol de cuidado vigente recibe 403, NO «PIN incorrecto»", async () => {
      // El PIN es bueno; lo que falta es el rol. Decirle «PIN incorrecto»
      // la dejaría tecleándolo otra vez en el pasillo.
      await prisma.$executeRawUnsafe(
        `UPDATE care_role_assignments SET revoked_at = now()
         WHERE tenant_id = '${tenantId}' AND user_id = '${rosaId}'`,
      );
      const r = await app.inject({
        method: "POST",
        url: "/residencia/puerta/pin",
        headers: { "x-device-token": token112 },
        payload: { pin: PIN_ROSA },
      });
      expect(r.statusCode, r.body).toBe(403);
      expect(r.json().error).toBe("SIN_ROL_DE_CUIDADO");
      await prisma.$executeRawUnsafe(
        `UPDATE care_role_assignments SET revoked_at = NULL
         WHERE tenant_id = '${tenantId}' AND user_id = '${rosaId}'`,
      );
    });

    it("A LOS DIEZ FALLOS LA TABLET SE CANDA, y la de al lado no", async () => {
      // Los diez intentos y los dos minutos de candado son de esta
      // puerta y no los del login de cajero (5 → 15 min): el motivo está
      // escrito en `puerta-registro-routes.ts`. Aquí se vigila que la
      // ruta los use —y que el acierto limpie el contador—, que es lo
      // único que no comprueba `rate-limit-caracterizacion.test.ts`.
      const malo = (token = token112) =>
        app.inject({
          method: "POST",
          url: "/residencia/puerta/pin",
          headers: { "x-device-token": token },
          payload: { pin: "0001" },
        });

      for (let i = 1; i <= 9; i += 1) {
        const r = await malo();
        expect(r.statusCode, r.body).toBe(401);
        expect(r.json().attemptsRemaining, `intento ${i}`).toBe(10 - i);
      }
      // El décimo falla y, de paso, echa el candado.
      const decimo = await malo();
      expect(decimo.statusCode, decimo.body).toBe(401);
      expect(decimo.json().attemptsRemaining).toBe(0);

      // Y a partir de ahí **ni el PIN bueno entra**: el candado se mira
      // antes de resolver nada.
      const conElBueno = await app.inject({
        method: "POST",
        url: "/residencia/puerta/pin",
        headers: { "x-device-token": token112 },
        payload: { pin: PIN_ANA },
      });
      expect(conElBueno.statusCode, conElBueno.body).toBe(429);
      expect(conElBueno.json().error).toBe("PUERTA_PIN_BLOQUEADO");
      expect(conElBueno.json().retryAfterSeconds).toBeLessThanOrEqual(120);
      expect(conElBueno.json().message).toContain("usa otra puerta");

      // Lo que NO se bloquea es la residencia entera: el candado es por
      // tablet, y la frase de arriba manda a la auxiliar a la de al lado.
      await entrar(PIN_ANA, token201);
    });

    it("y un ACIERTO limpia el contador: los fallos no se acumulan", async () => {
      const malo = () =>
        app.inject({
          method: "POST",
          url: "/residencia/puerta/pin",
          headers: { "x-device-token": token112 },
          payload: { pin: "0001" },
        });

      for (let i = 0; i < 9; i += 1) expect((await malo()).statusCode).toBe(401);
      await entrar(PIN_ANA);
      // Si el acierto no limpiara, el siguiente fallo sería el décimo y
      // dejaría la tablet candada.
      const r = await malo();
      expect(r.statusCode, r.body).toBe(401);
      expect(r.json().attemptsRemaining).toBe(9);
    });
  });

  // ══ 2, 3 y 4 · «COMO SIEMPRE» ════════════════════════════════════
  describe("«como siempre» y «no como siempre»", () => {
    it("«COMO SIEMPRE» ESCRIBE N FILAS, una por dimensión OBS activa", async () => {
      const cabeceras = await entrar(PIN_ANA);
      const dims = await dimensiones();
      expect(dims.length).toBeGreaterThanOrEqual(7);

      const r = await mandar(
        cabeceras,
        dims.map((d) =>
          registro({
            controlCode: d.code,
            occurrenceAt: null,
            valor: { tipo: "ORDINAL", opcion: d.asUsual },
          }),
        ),
      );
      expect(r.statusCode, r.body).toBe(200);
      expect(
        r.json().registros.filter((x: { estado: string }) => x.estado === "guardado"),
      ).toHaveLength(dims.length);

      const filas = await prisma.$queryRawUnsafe<Array<{ control_code: string }>>(
        `SELECT control_code FROM care_records WHERE client_id = '${carmenId}' ORDER BY control_code`,
      );
      expect(filas.map((f) => f.control_code).sort()).toEqual(
        dims.map((d) => d.code).sort(),
      );
    });

    it("«NO COMO SIEMPRE» con UNA cambiada escribe 1 + (N−1)", async () => {
      const cabeceras = await entrar(PIN_ANA);
      const dims = await dimensiones();
      const r = await mandar(
        cabeceras,
        dims.map((d) =>
          registro({
            controlCode: d.code,
            occurrenceAt: null,
            valor: {
              tipo: "ORDINAL",
              opcion: d.code === "ANIMO" ? "APAGADO" : d.asUsual,
            },
          }),
        ),
      );
      expect(r.statusCode, r.body).toBe(200);
      const filas = await prisma.$queryRawUnsafe<
        Array<{ control_code: string; value_cifrado: string }>
      >(
        `SELECT control_code, value_cifrado FROM care_records WHERE client_id = '${carmenId}'`,
      );
      expect(filas).toHaveLength(dims.length);
      // Y el valor de la cambiada es el que se eligió, descifrado.
      const dek = await dekDe(tenantId, prisma);
      const animo = await prisma.$queryRawUnsafe<
        Array<{ id: string; value_cifrado: string }>
      >(
        `SELECT id, value_cifrado FROM care_records WHERE client_id = '${carmenId}' AND control_code = 'ANIMO'`,
      );
      const valor = JSON.parse(
        descifrarValor(
          animo[0]!.value_cifrado,
          dek,
          sitioValorDeRegistro(tenantId, animo[0]!.id),
        ),
      );
      expect(valor).toEqual({
        tipo: "ORDINAL",
        opcion: "APAGADO",
        comoSiempre: false,
      });
    });

    it("REPETIRLO EN EL MISMO TURNO CORRIGE, no duplica", async () => {
      const cabeceras = await entrar(PIN_ANA);
      const primero = await mandar(cabeceras, [registro()]);
      expect(primero.statusCode, primero.body).toBe(200);
      const idPrimero = primero.json().registros[0].id;

      const segundo = await mandar(
        cabeceras,
        [registro({ valor: { tipo: "ORDINAL", opcion: "APAGADO" } })],
      );
      expect(segundo.statusCode, segundo.body).toBe(200);
      expect(segundo.json().registros[0].estado).toBe("corrige");
      expect(segundo.json().registros[0].corrigeA).toBe(idPrimero);

      // DOS filas, no una ni tres: la corregida se queda donde está.
      const filas = await prisma.$queryRawUnsafe<
        Array<{ id: string; corrects_record_id: string | null }>
      >(
        `SELECT id, corrects_record_id FROM care_records
         WHERE client_id = '${carmenId}' AND control_code = 'ANIMO'`,
      );
      expect(filas).toHaveLength(2);
      expect(filas.filter((f) => f.corrects_record_id != null)).toHaveLength(1);
    });

    it("y la TERCERA corrige a la segunda: la cadena es una línea", async () => {
      const cabeceras = await entrar(PIN_ANA);
      const uno = await mandar(cabeceras, [registro()]);
      const dos = await mandar(
        cabeceras,
        [registro({ valor: { tipo: "ORDINAL", opcion: "APAGADO" } })],
      );
      const tres = await mandar(
        cabeceras,
        [registro({ valor: { tipo: "ORDINAL", opcion: "INQUIETO" } })],
      );
      expect(tres.json().registros[0].corrigeA).toBe(dos.json().registros[0].id);
      expect(dos.json().registros[0].corrigeA).toBe(uno.json().registros[0].id);
    });

    it("una COMIDA del mismo turno con otra ocurrencia es OTRA fila", async () => {
      // Tres cambios posturales de un turno son tres cosas y no una
      // repetida. Es la columna `occurrence_at` trabajando.
      const cabeceras = await entrar(PIN_ANA);
      const a = await mandar(cabeceras, [
        registro({
          controlCode: "CAMBIO_POSTURAL",
          valor: { tipo: "BOOL", hecho: true },
          occurrenceAt: "2026-10-15T08:00:00.000Z",
        }),
      ]);
      const b = await mandar(cabeceras, [
        registro({
          controlCode: "CAMBIO_POSTURAL",
          valor: { tipo: "BOOL", hecho: true },
          occurrenceAt: "2026-10-15T11:00:00.000Z",
        }),
      ]);
      expect(a.json().registros[0].estado).toBe("guardado");
      expect(b.json().registros[0].estado).toBe("guardado");
      const filas = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM care_records WHERE client_id = '${carmenId}' AND control_code = 'CAMBIO_POSTURAL'`,
      );
      expect(filas).toHaveLength(2);
    });
  });

  // ══ 5 · IDEMPOTENCIA ═════════════════════════════════════════════
  describe("el envío idempotente", () => {
    it("EL MISMO LOTE DOS VECES NO DUPLICA NADA", async () => {
      const cabeceras = await entrar(PIN_ANA);
      const lote = [
        registro(),
        registro({
          controlCode: "PIEL",
          valor: { tipo: "ORDINAL", opcion: "BIEN" },
        }),
      ];
      const primero = await mandar(cabeceras, lote);
      expect(primero.statusCode, primero.body).toBe(200);
      const segundo = await mandar(cabeceras, lote);
      expect(segundo.statusCode, segundo.body).toBe(200);
      expect(
        segundo.json().registros.map((x: { estado: string }) => x.estado),
      ).toEqual(["ya-estaba", "ya-estaba"]);

      const filas = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM care_records WHERE client_id = '${carmenId}'`,
      );
      expect(Number(filas[0]!.n)).toBe(2);
    });

    it("y un reenvío TARDÍO —fuera del margen— tampoco lo pierde ni lo rechaza", async () => {
      // La idempotencia se comprueba ANTES del límite de los siete días: si
      // no, un reintento tardío convertiría en «rechazado» algo que YA está
      // guardado, y la tablet lo borraría de su cola creyendo que no llegó.
      const cabeceras = await entrar(PIN_ANA);
      const uno = registro();
      expect((await mandar(cabeceras, [uno])).statusCode).toBe(200);
      const viejo = {
        ...uno,
        recordedAt: new Date(Date.now() - 20 * 24 * 3600_000).toISOString(),
      };
      const r = await mandar(cabeceras, [viejo]);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().registros[0].estado).toBe("ya-estaba");
    });
  });

  // ══ 6 · LOS LÍMITES DEL INSTANTE ═════════════════════════════════
  describe("el instante de la tablet", () => {
    it("UN RELOJ PUESTO EN MAÑANA: el lote entero se rechaza con 409", async () => {
      const cabeceras = await entrar(PIN_ANA);
      const r = await mandar(cabeceras, [
        registro({
          recordedAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
        }),
      ]);
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json().error).toBe("LOTE_RECHAZADO");
      expect(r.json().registros[0].codigo).toBe("REGISTRO_EN_EL_FUTURO");
    });

    it("y uno de hace un mes, también", async () => {
      const cabeceras = await entrar(PIN_ANA);
      const r = await mandar(cabeceras, [
        registro({
          recordedAt: new Date(Date.now() - 20 * 24 * 3600_000).toISOString(),
        }),
      ]);
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json().registros[0].codigo).toBe("REGISTRO_DEMASIADO_VIEJO");
    });

    it("UN LOTE CON UNO MALO GUARDA LOS BUENOS, y lo dice", async () => {
      // Siete filas de un «como siempre» no se pierden porque una
      // dimensión se desactivara mientras la tablet estaba sin red.
      const cabeceras = await entrar(PIN_ANA);
      const r = await mandar(cabeceras, [
        registro(),
        registro({ controlCode: "NO_EXISTE_ESTE_CONTROL" }),
        registro({
          controlCode: "PIEL",
          valor: { tipo: "ORDINAL", opcion: "BIEN" },
        }),
      ]);
      expect(r.statusCode, r.body).toBe(200);
      const estados = r.json().registros.map((x: { estado: string }) => x.estado);
      expect(estados).toEqual(["guardado", "rechazado", "guardado"]);
      expect(r.json().registros[1].codigo).toBe("CONTROL_DESCONOCIDO");
    });
  });

  // ══ 7 · SIN TURNO ════════════════════════════════════════════════
  it("UN REGISTRO SIN TURNO SE GUARDA, con su aviso", async () => {
    // residencia-1 §11.5: un cuidado hecho se apunta. Rechazarlo sería
    // perder un cuidado por un hueco en el cuadrante.
    const cabeceras = await entrar(PIN_ANA);
    const r = await mandar(cabeceras, [registro({ centerShiftId: null })]);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().registros[0].estado).toBe("guardado");

    const vista = await app.inject({
      method: "GET",
      url: `/residencia/residentes/${carmenId}/registros?dia=${new Date()
        .toISOString()
        .slice(0, 10)}`,
      headers: comoDirectora,
    });
    expect(vista.statusCode, vista.body).toBe(200);
    expect(vista.json().sinTurno).toHaveLength(1);
    expect(vista.json().sinTurno[0].sinTurno).toBe(true);
  });

  it("pero un TURNO QUE NO ES DE ESTE CENTRO no cuela", async () => {
    const cabeceras = await entrar(PIN_ANA);
    const r = await mandar(cabeceras, [
      registro({ centerShiftId: randomUUID() }),
    ]);
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json().registros[0].codigo).toBe("TURNO_DESCONOCIDO");
  });

  // ══ 8 y 9 · ANULAR Y CORREGIR ════════════════════════════════════
  describe("anular y corregir", () => {
    it("ANULA lo propio, y la fila SE QUEDA con quién y cuándo", async () => {
      const cabeceras = await entrar(PIN_ANA);
      const r = await mandar(cabeceras, [registro()]);
      const id = r.json().registros[0].id;

      const anular = await app.inject({
        method: "POST",
        url: `/residencia/puerta/registros/${id}/anular`,
        headers: cabeceras,
      });
      expect(anular.statusCode, anular.body).toBe(200);

      const filas = await prisma.$queryRawUnsafe<
        Array<{ voided_at: Date | null; voided_by_user_id: string | null }>
      >(
        `SELECT voided_at, voided_by_user_id FROM care_records WHERE id = '${id}'`,
      );
      expect(filas).toHaveLength(1);
      expect(filas[0]!.voided_at).not.toBeNull();
      expect(filas[0]!.voided_by_user_id).toBe(anaId);
    });

    it("SÓLO QUIEN LO FIRMÓ: la DUE no deshace lo de la auxiliar", async () => {
      const deAna = await entrar(PIN_ANA);
      const r = await mandar(deAna, [registro()]);
      const id = r.json().registros[0].id;

      const deRosa = await entrar(PIN_ROSA);
      const anular = await app.inject({
        method: "POST",
        url: `/residencia/puerta/registros/${id}/anular`,
        headers: deRosa,
      });
      expect(anular.statusCode, anular.body).toBe(403);
      expect(anular.json().error).toBe("SOLO_QUIEN_LO_FIRMO");
      expect(anular.json().message).toContain("corrígelo");
    });

    it("y SÓLO EN LA VENTANA: pasada, se corrige", async () => {
      const cabeceras = await entrar(PIN_ANA);
      const r = await mandar(cabeceras, [registro()]);
      const id = r.json().registros[0].id;
      // Se envejece la fila a mano, apartando el trigger: lo que se está
      // probando es la ventana de la ruta, no el trigger.
      await prisma.$executeRawUnsafe(
        `ALTER TABLE care_records DISABLE TRIGGER care_records_inmutable`,
      );
      await prisma.$executeRawUnsafe(
        `UPDATE care_records SET recorded_at = now() - interval '${
          VENTANA_DE_ANULACION_MS / 1000 + 60
        } seconds' WHERE id = '${id}'`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE care_records ENABLE TRIGGER care_records_inmutable`,
      );

      const anular = await app.inject({
        method: "POST",
        url: `/residencia/puerta/registros/${id}/anular`,
        headers: cabeceras,
      });
      expect(anular.statusCode, anular.body).toBe(409);
      expect(anular.json().error).toBe("FUERA_DE_LA_VENTANA");
    });

    it("ANULAR DOS VECES no se puede", async () => {
      const cabeceras = await entrar(PIN_ANA);
      const r = await mandar(cabeceras, [registro()]);
      const id = r.json().registros[0].id;
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/residencia/puerta/registros/${id}/anular`,
            headers: cabeceras,
          })
        ).statusCode,
      ).toBe(200);
      const otra = await app.inject({
        method: "POST",
        url: `/residencia/puerta/registros/${id}/anular`,
        headers: cabeceras,
      });
      expect(otra.statusCode).toBe(409);
      expect(otra.json().error).toBe("YA_ESTABA_ANULADO");
    });

    it("tras ANULAR, registrar otra vez vuelve a dejar algo VIGENTE", async () => {
      const cabeceras = await entrar(PIN_ANA);
      const r = await mandar(cabeceras, [registro()]);
      const id = r.json().registros[0].id;
      await app.inject({
        method: "POST",
        url: `/residencia/puerta/registros/${id}/anular`,
        headers: cabeceras,
      });
      const otra = await mandar(cabeceras, [registro()]);
      expect(otra.statusCode, otra.body).toBe(200);
      // Corrige a la anulada: la cadena sigue siendo una línea y la cola es
      // la nueva, que no está anulada.
      expect(otra.json().registros[0].corrigeA).toBe(id);

      const vista = await app.inject({
        method: "GET",
        url: `/residencia/residentes/${carmenId}/registros`,
        headers: comoDirectora,
      });
      const todos = vista
        .json()
        .porTurno.flatMap(
          (t: { registros: Array<{ vigente: boolean; anulado: boolean }> }) =>
            t.registros,
        );
      expect(
        todos.filter((x: { vigente: boolean }) => x.vigente),
      ).toHaveLength(1);
      // Y LA ANULADA SE QUEDA, con su etiqueta: nada se borra.
      expect(todos.filter((x: { anulado: boolean }) => x.anulado)).toHaveLength(1);
    });
  });

  // ══ 10 · LO CIFRADO ══════════════════════════════════════════════
  describe("el valor y la nota, cifrados", () => {
    it("SE ESCRIBEN CIFRADOS, y el claro no está en ninguna parte", async () => {
      const cabeceras = await entrar(PIN_ANA);
      const r = await mandar(cabeceras, [
        registro({
          controlCode: "ALGO_NO_VA_BIEN",
          valor: { tipo: "NOTA" },
          nota: CANARIO_NOTA,
          occurrenceAt: null,
        }),
      ]);
      expect(r.statusCode, r.body).toBe(200);

      const filas = await prisma.$queryRawUnsafe<
        Array<{ value_cifrado: string; note_cifrado: string | null }>
      >(
        `SELECT value_cifrado, note_cifrado FROM care_records WHERE client_id = '${carmenId}'`,
      );
      expect(filas[0]!.value_cifrado.startsWith("c1:")).toBe(true);
      expect(filas[0]!.note_cifrado?.startsWith("c1:")).toBe(true);

      // Y EL CANARIO, buscado en TODAS las tablas del esquema.
      const tablas = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      const apariciones: string[] = [];
      for (const { table_name } of tablas) {
        const hay = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
          `SELECT count(*) AS n FROM "${table_name}" t
           WHERE t::text LIKE '%${CANARIO_NOTA}%'`,
        );
        if (Number(hay[0]!.n) > 0) apariciones.push(table_name);
      }
      expect(apariciones).toEqual([]);
    });

    it("y la pantalla LO VUELVE A LEER igual", async () => {
      const cabeceras = await entrar(PIN_ANA);
      await mandar(cabeceras, [
        registro({
          controlCode: "ALGO_NO_VA_BIEN",
          valor: { tipo: "NOTA" },
          nota: CANARIO_NOTA,
          occurrenceAt: null,
        }),
      ]);
      const vista = await app.inject({
        method: "GET",
        url: `/residencia/residentes/${carmenId}/registros`,
        headers: comoDirectora,
      });
      const todos: Array<{ nota: string | null }> = vista
        .json()
        .porTurno.flatMap((t: { registros: Array<{ nota: string | null }> }) =>
          t.registros,
        );
      expect(todos.map((x) => x.nota)).toContain(CANARIO_NOTA);
    });

    it("UN VALOR MOVIDO A OTRA FILA NO SE DESCIFRA, y sale el hueco marcado", async () => {
      const cabeceras = await entrar(PIN_ANA);
      const r = await mandar(cabeceras, [
        registro(),
        registro({
          controlCode: "PIEL",
          valor: { tipo: "ORDINAL", opcion: "BIEN" },
        }),
      ]);
      expect(r.statusCode, r.body).toBe(200);
      const [a, b] = r.json().registros as Array<{ id: string }>;
      const dek = await dekDe(tenantId, prisma);
      // El valor de `a`, cifrado con el sitio de `a`, puesto en la fila `b`.
      const suyo = await prisma.$queryRawUnsafe<Array<{ value_cifrado: string }>>(
        `SELECT value_cifrado FROM care_records WHERE id = '${a!.id}'`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE care_records DISABLE TRIGGER care_records_inmutable`,
      );
      await prisma.$executeRawUnsafe(
        `UPDATE care_records SET value_cifrado = '${suyo[0]!.value_cifrado}' WHERE id = '${b!.id}'`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE care_records ENABLE TRIGGER care_records_inmutable`,
      );
      // No «se descifra mal»: no se descifra. El AAD lleva el id de la fila.
      expect(() =>
        descifrarValor(
          suyo[0]!.value_cifrado,
          dek,
          sitioValorDeRegistro(tenantId, b!.id),
        ),
      ).toThrow(/no se descifra/);

      const vista = await app.inject({
        method: "GET",
        url: `/residencia/residentes/${carmenId}/registros`,
        headers: comoDirectora,
      });
      const todos: Array<{ valor: unknown }> = vista
        .json()
        .porTurno.flatMap((t: { registros: Array<{ valor: unknown }> }) =>
          t.registros,
        );
      // Y la ficha SE SIGUE SIRVIENDO: una fila ilegible no deja a un
      // residente sin su hoja del turno.
      expect(vista.statusCode).toBe(200);
      expect(todos.some((x) => (x.valor as { ilegible?: boolean }).ilegible)).toBe(
        true,
      );
    });

    it("y una NOTA copiada a la columna del VALOR tampoco: son dos sitios", async () => {
      const cabeceras = await entrar(PIN_ANA);
      const r = await mandar(cabeceras, [
        registro({
          controlCode: "ALGO_NO_VA_BIEN",
          valor: { tipo: "NOTA" },
          nota: CANARIO_NOTA,
          occurrenceAt: null,
        }),
      ]);
      const id = r.json().registros[0].id as string;
      const dek = await dekDe(tenantId, prisma);
      const fila = await prisma.$queryRawUnsafe<Array<{ note_cifrado: string }>>(
        `SELECT note_cifrado FROM care_records WHERE id = '${id}'`,
      );
      // La nota se descifra en SU sitio…
      expect(
        descifrarValor(
          fila[0]!.note_cifrado,
          dek,
          sitioNotaDeRegistro(tenantId, id),
        ),
      ).toBe(CANARIO_NOTA);
      // …y NO en el del valor, aunque sea la misma fila y la misma clave.
      expect(() =>
        descifrarValor(
          fila[0]!.note_cifrado,
          dek,
          sitioValorDeRegistro(tenantId, id),
        ),
      ).toThrow(/no se descifra/);
    });
  });

  // ══ 11 · LA FOTO Y SU CONSENTIMIENTO ═════════════════════════════
  describe("la foto del residente (D-64)", () => {
    /** Un JPEG de verdad, mínimo: la firma más un byte. La ruta comprueba
     *  la firma del fichero y no lo que diga quien lo manda. */
    const JPEG = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.alloc(64, 7),
    ]).toString("base64");

    beforeEach(async () => {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE client_consents DISABLE TRIGGER client_consents_append_only`,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM client_consents WHERE tenant_id = '${tenantId}'`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE client_consents ENABLE TRIGGER client_consents_append_only`,
      );
      await prisma.$executeRawUnsafe(
        `UPDATE resident_profiles SET photo_file_name = NULL, photo_sha256 = NULL,
           photo_bytes = NULL, photo_mime_type = NULL, photo_uploaded_at = NULL,
           photo_uploaded_by_user_id = NULL
         WHERE tenant_id = '${tenantId}'`,
      );
    });

    it("SIN CONSENTIMIENTO, la puerta NO la sirve: 404 y las iniciales", async () => {
      // 404 y no 403: un 403 diría «esta persona tiene foto y no te la
      // damos», y en una tablet de pasillo eso ya es decir algo de ella.
      const subir = await app.inject({
        method: "PUT",
        url: `/residencia/residentes/${carmenId}/foto`,
        headers: comoDirectora,
        payload: { jpegBase64: JPEG },
      });
      expect(subir.statusCode, subir.body).toBe(200);

      const r = await app.inject({
        method: "GET",
        url: `/residencia/puerta/residentes/${carmenId}/foto`,
        headers: { "x-device-token": token112 },
      });
      expect(r.statusCode).toBe(404);
      expect(r.json().error).toBe("SIN_FOTO");

      // Y el arranque lo dice, para que la tablet no la pida: `tieneFoto`
      // es «hay fichero Y consentimiento».
      const arranque = await app.inject({
        method: "GET",
        url: "/residencia/puerta/arranque",
        headers: { "x-device-token": token112 },
      });
      const carmen = arranque
        .json()
        .ocupantes.find((o: { clientId: string }) => o.clientId === carmenId);
      expect(carmen.tieneFoto).toBe(false);
    });

    it("CON CONSENTIMIENTO, sí", async () => {
      await app.inject({
        method: "PUT",
        url: `/residencia/residentes/${carmenId}/foto`,
        headers: comoDirectora,
        payload: { jpegBase64: JPEG },
      });
      const c = await app.inject({
        method: "POST",
        url: `/residencia/residentes/${carmenId}/consentimiento-imagen`,
        headers: comoDirectora,
        payload: { signer: "PACIENTE" },
      });
      expect(c.statusCode, c.body).toBe(201);

      const r = await app.inject({
        method: "GET",
        url: `/residencia/puerta/residentes/${carmenId}/foto`,
        headers: { "x-device-token": token112 },
      });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.headers["content-type"]).toContain("image/jpeg");
      expect(r.headers["x-huella-cuadra"]).toBe("si");
    });

    it("y RETIRARLO la vuelve a esconder, dejando rastro", async () => {
      await app.inject({
        method: "PUT",
        url: `/residencia/residentes/${carmenId}/foto`,
        headers: comoDirectora,
        payload: { jpegBase64: JPEG },
      });
      await app.inject({
        method: "POST",
        url: `/residencia/residentes/${carmenId}/consentimiento-imagen`,
        headers: comoDirectora,
        payload: { signer: "PACIENTE" },
      });
      const retirar = await app.inject({
        method: "POST",
        url: `/residencia/residentes/${carmenId}/consentimiento-imagen/retirar`,
        headers: comoDirectora,
        payload: { motivo: "lo pidió la hija" },
      });
      expect(retirar.statusCode, retirar.body).toBe(200);

      const r = await app.inject({
        method: "GET",
        url: `/residencia/puerta/residentes/${carmenId}/foto`,
        headers: { "x-device-token": token112 },
      });
      expect(r.statusCode).toBe(404);

      // DOS filas: la que concedía y la que revoca. No se desmarca un
      // booleano — queda quién lo pidió y cuándo.
      const filas = await prisma.$queryRawUnsafe<
        Array<{ n: bigint }>
      >(
        `SELECT count(*) AS n FROM client_consents WHERE client_id = '${carmenId}' AND kind = 'IMAGE'`,
      );
      expect(Number(filas[0]!.n)).toBe(2);
    });

    it("y el JPEG del volumen está CIFRADO: no empieza por la firma de un JPEG", async () => {
      await app.inject({
        method: "PUT",
        url: `/residencia/residentes/${carmenId}/foto`,
        headers: comoDirectora,
        payload: { jpegBase64: JPEG },
      });
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const { loadEnv } = await import("../src/env.js");
      const fila = await prisma.$queryRawUnsafe<
        Array<{ photo_file_name: string }>
      >(
        `SELECT photo_file_name FROM resident_profiles WHERE client_id = '${carmenId}'`,
      );
      const enDisco = await readFile(
        join(loadEnv().CLINICAL_FILES_DIR, "residentes", fila[0]!.photo_file_name),
      );
      expect(enDisco.subarray(0, 4).toString("latin1")).toBe("MPC1");
    });
  });

  // ══ 12 · LA HABITACIÓN Y LA ZONA ═════════════════════════════════
  describe("una puerta no ve otra habitación", () => {
    it("la 112 no registra nada del residente de la 201", async () => {
      const cabeceras = await entrar(PIN_ANA);
      const r = await mandar(cabeceras, [registro({ clientId: manuelId })]);
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json().registros[0].codigo).toBe("RESIDENTE_DE_OTRA_HABITACION");
    });

    it("ni sirve su foto", async () => {
      const r = await app.inject({
        method: "GET",
        url: `/residencia/puerta/residentes/${manuelId}/foto`,
        headers: { "x-device-token": token112 },
      });
      expect(r.statusCode).toBe(404);
    });

    it("y «lo que toca» de la 112 sólo trae a los de la 112", async () => {
      const cabeceras = await entrar(PIN_ANA);
      const r = await app.inject({
        method: "GET",
        url: "/residencia/puerta/lo-que-toca",
        headers: cabeceras,
      });
      expect(r.statusCode, r.body).toBe(200);
      const ids = r
        .json()
        .residentes.map((x: { clientId: string }) => x.clientId);
      expect(ids.sort()).toEqual([carmenId, luisId].sort());
    });

    it("FUERA DE SU ZONA no se ven datos, y la frase lo dice (D-51)", async () => {
      // Ana cubre la primera planta. La 201 está en la segunda.
      const cabeceras = await entrar(PIN_ANA, token201);
      const r = await app.inject({
        method: "GET",
        url: "/residencia/puerta/lo-que-toca",
        headers: cabeceras,
      });
      expect(r.statusCode, r.body).toBe(403);
      expect(r.json().error).toBe("HABITACION_FUERA_DE_TU_ZONA");
      expect(r.json().message).toContain("no es de tu zona");
      // Y el cuerpo NO lleva ningún residente.
      expect(r.body).not.toContain(manuelId);
    });

    it("pero la DUE, con alcance total, entra en las dos", async () => {
      const cabeceras = await entrar(PIN_ROSA, token201);
      const r = await app.inject({
        method: "GET",
        url: "/residencia/puerta/lo-que-toca",
        headers: cabeceras,
      });
      expect(r.statusCode, r.body).toBe(200);
      expect(
        r.json().residentes.map((x: { clientId: string }) => x.clientId),
      ).toEqual([manuelId]);
    });

    it("una sesión de la 112 NO sirve en la 201", async () => {
      const cabeceras = await entrar(PIN_ROSA, token112);
      const r = await app.inject({
        method: "GET",
        url: "/residencia/puerta/lo-que-toca",
        headers: { ...cabeceras, "x-device-token": token201 },
      });
      expect(r.statusCode, r.body).toBe(403);
      expect(r.json().error).toBe("PUERTA_SESION_DE_OTRA_HABITACION");
    });

    it("y abrir «lo que toca» DEJA SU LÍNEA en el registro de accesos, por residente", async () => {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE clinical_access_log DISABLE TRIGGER clinical_access_log_append_only`,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM clinical_access_log WHERE tenant_id = '${tenantId}'`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE clinical_access_log ENABLE TRIGGER clinical_access_log_append_only`,
      );
      const cabeceras = await entrar(PIN_ANA);
      await app.inject({
        method: "GET",
        url: "/residencia/puerta/lo-que-toca",
        headers: cabeceras,
      });
      const filas = await prisma.$queryRawUnsafe<
        Array<{ client_id: string; user_id: string; device_id: string; action: string }>
      >(
        `SELECT client_id, user_id, device_id, action FROM clinical_access_log
         WHERE tenant_id = '${tenantId}' ORDER BY at`,
      );
      // Una por residente, con LA PERSONA del PIN y la tablet.
      expect(filas).toHaveLength(2);
      expect(filas.every((f) => f.user_id === anaId)).toBe(true);
      expect(filas.every((f) => f.device_id === tablet112)).toBe(true);
      expect(filas.map((f) => f.client_id).sort()).toEqual(
        [carmenId, luisId].sort(),
      );
    });

    it("y la DENEGADA también deja la suya", async () => {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE clinical_access_log DISABLE TRIGGER clinical_access_log_append_only`,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM clinical_access_log WHERE tenant_id = '${tenantId}'`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE clinical_access_log ENABLE TRIGGER clinical_access_log_append_only`,
      );
      const cabeceras = await entrar(PIN_ANA, token201);
      await app.inject({
        method: "GET",
        url: "/residencia/puerta/lo-que-toca",
        headers: cabeceras,
      });
      const filas = await prisma.$queryRawUnsafe<Array<{ outcome: string }>>(
        `SELECT outcome FROM clinical_access_log WHERE tenant_id = '${tenantId}'`,
      );
      expect(filas).toHaveLength(1);
      expect(filas[0]!.outcome).toBe("DENIED");
    });
  });

  // ══ 13 · LA TABLA DE SABOTAJES CONTRA EL MOTOR ═══════════════════
  describe("sabotajes · lo que SÓLO contesta Postgres", () => {
    async function unaFila(): Promise<string> {
      const cabeceras = await entrar(PIN_ANA);
      const r = await mandar(cabeceras, [registro()]);
      expect(r.statusCode, r.body).toBe(200);
      return r.json().registros[0].id as string;
    }

    it("SABOTAJE · BORRAR UNA FILA por SQL falla", async () => {
      const id = await unaFila();
      const msg = await debeFallar(`DELETE FROM care_records WHERE id = '${id}'`);
      expect(msg).toContain("RESIDENCIA_VIOLADA");
      expect(msg).toContain("no se borra");
    });

    it("SABOTAJE · EDITAR SU VALOR falla", async () => {
      const id = await unaFila();
      const msg = await debeFallar(
        `UPDATE care_records SET value_cifrado = 'c1:AAAA' WHERE id = '${id}'`,
      );
      expect(msg).toContain("no se edita");
      expect(msg).toContain("OTRA fila");
    });

    it("SABOTAJE · cambiarle el RESIDENTE falla", async () => {
      const id = await unaFila();
      const msg = await debeFallar(
        `UPDATE care_records SET client_id = '${luisId}' WHERE id = '${id}'`,
      );
      expect(msg).toContain("no se edita");
    });

    it("SABOTAJE · ESCRIBIR EL VALOR EN CLARO falla · el claro NO CABE", async () => {
      const id = await unaFila();
      const msg = await debeFallar(
        `UPDATE care_records SET value_cifrado = 'como siempre' WHERE id = '${id}'`,
      );
      // El trigger corta antes que el CHECK, y las dos cosas son correctas:
      // lo que importa es que no entra. Se comprueba el CHECK por separado
      // en un INSERT.
      expect(msg).toMatch(/no se edita|care_records_value_cifrado_formato/);
    });

    it("…y en un INSERT, lo corta el CHECK de formato", async () => {
      const manana = turnos.find((t) => t.code === "M")!;
      const asignacion = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM care_role_assignments WHERE user_id = '${anaId}' LIMIT 1`,
      );
      const control = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM control_types WHERE code = 'ANIMO' AND superseded_at IS NULL LIMIT 1`,
      );
      const msg = await debeFallar(
        `INSERT INTO care_records (id, tenant_id, client_id, control_type_id, control_code,
           value_cifrado, recorded_by_user_id, care_role_assignment_id, device_id,
           recorded_at, center_shift_id, care_day)
         VALUES ('${randomUUID()}', '${tenantId}', '${carmenId}', '${control[0]!.id}', 'ANIMO',
                 'como siempre', '${anaId}', '${asignacion[0]!.id}', '${tablet112}',
                 now(), '${manana.id}', '2026-10-15')`,
      );
      expect(msg).toContain("care_records_value_cifrado_formato");
    });

    it("SABOTAJE · DES-ANULAR falla", async () => {
      const cabeceras = await entrar(PIN_ANA);
      const r = await mandar(cabeceras, [registro()]);
      const id = r.json().registros[0].id;
      await app.inject({
        method: "POST",
        url: `/residencia/puerta/registros/${id}/anular`,
        headers: cabeceras,
      });
      const msg = await debeFallar(
        `UPDATE care_records SET voided_at = NULL, voided_by_user_id = NULL WHERE id = '${id}'`,
      );
      expect(msg).toContain("ya está anulado");
    });

    it("SABOTAJE · un UPDATE que no anula nada falla", async () => {
      const id = await unaFila();
      const msg = await debeFallar(
        `UPDATE care_records SET voided_by_user_id = '${anaId}' WHERE id = '${id}'`,
      );
      // El CHECK de la anulación completa o el trigger: las dos lo paran.
      expect(msg).toMatch(/anulacion_completa|lo único que se puede cambiar/);
    });

    it("SABOTAJE · DOS FILAS PARA LA MISMA OCURRENCIA · el índice lo para", async () => {
      // Y es el caso de los dos `COALESCE`: la observación diaria va con
      // `occurrence_at` a NULL y el turno puesto. Sin los centinelas, los
      // NULL serían distintos entre sí y las dos entrarían.
      const id = await unaFila();
      const fila = await prisma.$queryRawUnsafe<
        Array<Record<string, unknown>>
      >(`SELECT * FROM care_records WHERE id = '${id}'`);
      const f = fila[0]!;
      const msg = await debeFallar(
        `INSERT INTO care_records (id, tenant_id, client_id, control_type_id, control_code,
           value_cifrado, recorded_by_user_id, care_role_assignment_id, device_id,
           recorded_at, center_shift_id, care_day)
         VALUES ('${randomUUID()}', '${tenantId}', '${carmenId}', '${f.control_type_id}', 'ANIMO',
                 'c1:AAAA', '${anaId}', '${f.care_role_assignment_id}', '${tablet112}',
                 now(), '${f.center_shift_id}', '${f.care_day}')`,
      );
      // El mensaje de Prisma trae LA CLAVE y no el nombre del índice, así
      // que se afirma sobre la clave: es además lo que de verdad dice qué
      // invariante saltó, con los dos `COALESCE` a la vista.
      expect(msg).toContain("already exists");
      expect(msg).toContain("COALESCE(center_shift_id");
      expect(msg).toContain("-infinity");
    });

    it("…y una CORRECCIÓN sí entra: la cadena puede crecer", async () => {
      const id = await unaFila();
      const fila = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT * FROM care_records WHERE id = '${id}'`,
      );
      const f = fila[0]!;
      await prisma.$executeRawUnsafe(
        `INSERT INTO care_records (id, tenant_id, client_id, control_type_id, control_code,
           value_cifrado, recorded_by_user_id, care_role_assignment_id, device_id,
           recorded_at, center_shift_id, care_day, corrects_record_id)
         VALUES ('${randomUUID()}', '${tenantId}', '${carmenId}', '${f.control_type_id}', 'ANIMO',
                 'c1:AAAA', '${anaId}', '${f.care_role_assignment_id}', '${tablet112}',
                 now(), '${f.center_shift_id}', '${f.care_day}', '${id}')`,
      );
      const n = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM care_records WHERE client_id = '${carmenId}'`,
      );
      expect(Number(n[0]!.n)).toBe(2);
    });

    it("SABOTAJE · DOS CORRECCIONES de la misma fila · el índice lo para", async () => {
      const id = await unaFila();
      const fila = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT * FROM care_records WHERE id = '${id}'`,
      );
      const f = fila[0]!;
      const insertar = (nuevo: string) =>
        `INSERT INTO care_records (id, tenant_id, client_id, control_type_id, control_code,
           value_cifrado, recorded_by_user_id, care_role_assignment_id, device_id,
           recorded_at, center_shift_id, care_day, corrects_record_id)
         VALUES ('${nuevo}', '${tenantId}', '${carmenId}', '${f.control_type_id}', 'ANIMO',
                 'c1:AAAA', '${anaId}', '${f.care_role_assignment_id}', '${tablet112}',
                 now(), '${f.center_shift_id}', '${f.care_day}', '${id}')`;
      await prisma.$executeRawUnsafe(insertar(randomUUID()));
      const msg = await debeFallar(insertar(randomUUID()));
      expect(msg).toContain("already exists");
      expect(msg).toContain("corrects_record_id");
    });

    it("SABOTAJE · UNA FILA QUE SE CORRIGE A SÍ MISMA falla", async () => {
      const id = await unaFila();
      const msg = await debeFallar(
        `UPDATE care_records SET corrects_record_id = id WHERE id = '${id}'`,
      );
      expect(msg).toMatch(/no_se_corrige_a_si_misma|no se edita/);
    });

    it("SABOTAJE · UN RESIDENTE CON REGISTROS NO SE BORRA · LA FK SOLA", async () => {
      await unaFila();
      // Al residente lo protegen cinco FKs (el perfil, el plan, la cama, el
      // registro de accesos y ésta), y la primera que salta no es la de
      // este bloque. Lo que se prueba aquí es que **`care_records` lo
      // impide por sí sola**: se apartan las otras cuatro y sigue sin
      // poder borrarse. Es la misma forma que `residencia-1b.e2e.ts` usó
      // para «la FK DEL PLAN sola también lo impide».
      //
      // Todo dentro de UNA transacción interactiva que acaba lanzando, así
      // que al salir no queda nada apartado: el `DELETE` final revienta y
      // Postgres deshace los cuatro de antes. Sin eso, este test se
      // llevaría a doña Carmen por delante y los siguientes mirarían una
      // ficha que ya no está.
      let msg = "";
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `ALTER TABLE clinical_access_log DISABLE TRIGGER clinical_access_log_append_only`,
          );
          await tx.$executeRawUnsafe(
            `DELETE FROM clinical_access_log WHERE client_id = '${carmenId}'`,
          );
          await tx.$executeRawUnsafe(
            `DELETE FROM care_plan_items WHERE client_id = '${carmenId}'`,
          );
          await tx.$executeRawUnsafe(
            `DELETE FROM bed_assignments WHERE client_id = '${carmenId}'`,
          );
          await tx.$executeRawUnsafe(
            `DELETE FROM resident_profiles WHERE client_id = '${carmenId}'`,
          );
          await tx.$executeRawUnsafe(
            `DELETE FROM clients WHERE id = '${carmenId}'`,
          );
        });
      } catch (err) {
        msg = err instanceof Error ? err.message : String(err);
      }
      expect(msg, "el motor ACEPTÓ borrar al residente").not.toBe("");
      expect(msg).toContain("care_records_client_id_fkey");

      // Y sigue ahí, con su cama y su plan.
      const sigue = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM resident_profiles WHERE client_id = '${carmenId}'`,
      );
      expect(Number(sigue[0]!.n)).toBe(1);
    });

    it("SABOTAJE · UN TURNO CON REGISTROS TAMPOCO", async () => {
      // residencia-1 decisión 8 dejó dicho que un turno se podía borrar
      // «porque nada apunta todavía a un turno». Ya apunta algo.
      await unaFila();
      const manana = turnos.find((t) => t.code === "M")!;
      const msg = await debeFallar(
        `DELETE FROM center_shifts WHERE id = '${manana.id}'`,
      );
      expect(msg).toMatch(/care_records|Foreign key constraint/);
    });

    it("SABOTAJE · NI LA VERSIÓN DEL CONTROL con la que se registró", async () => {
      await unaFila();
      const control = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT control_type_id AS id FROM care_records WHERE client_id = '${carmenId}' LIMIT 1`,
      );
      const msg = await debeFallar(
        `DELETE FROM control_types WHERE id = '${control[0]!.id}'`,
      );
      expect(msg).toMatch(/care_records|Foreign key constraint/);
    });

    it("SABOTAJE · NI LA ASIGNACIÓN DE ROL con la que se firmó", async () => {
      await unaFila();
      const asignacion = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT care_role_assignment_id AS id FROM care_records WHERE client_id = '${carmenId}' LIMIT 1`,
      );
      const msg = await debeFallar(
        `DELETE FROM care_role_assignments WHERE id = '${asignacion[0]!.id}'`,
      );
      expect(msg).toMatch(/care_records|Foreign key constraint/);
    });

    it("SABOTAJE · MEDIA NOTA DE VOZ no entra", async () => {
      const id = await unaFila();
      const msg = await debeFallar(
        `UPDATE care_records SET voice_file_name = 'x.webm' WHERE id = '${id}'`,
      );
      expect(msg).toMatch(/voz_completa|no se edita/);
    });

    it("SABOTAJE · UN DÍA DEL CENTRO CON OTRA FORMA no entra", async () => {
      const manana = turnos.find((t) => t.code === "M")!;
      const asignacion = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM care_role_assignments WHERE user_id = '${anaId}' LIMIT 1`,
      );
      const control = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM control_types WHERE code = 'PIEL' AND superseded_at IS NULL LIMIT 1`,
      );
      const msg = await debeFallar(
        `INSERT INTO care_records (id, tenant_id, client_id, control_type_id, control_code,
           value_cifrado, recorded_by_user_id, care_role_assignment_id, device_id,
           recorded_at, center_shift_id, care_day)
         VALUES ('${randomUUID()}', '${tenantId}', '${carmenId}', '${control[0]!.id}', 'PIEL',
                 'c1:AAAA', '${anaId}', '${asignacion[0]!.id}', '${tablet112}',
                 now(), '${manana.id}', '15/10/2026')`,
      );
      expect(msg).toContain("care_records_dia_formato");
    });

    it("SABOTAJE · UN CONSENTIMIENTO DE IMAGEN «CLÍNICO» no entra", async () => {
      const msg = await debeFallar(
        `INSERT INTO client_consents (id, tenant_id, client_id, kind, clinical)
         VALUES ('${randomUUID()}', '${tenantId}', '${carmenId}', 'IMAGE', true)`,
      );
      expect(msg).toMatch(
        /client_consents_imagen_no_es_clinica|violates check constraint|check constraint/,
      );
    });

    it("SABOTAJE · DOS PERSONAS CON EL MISMO PIN · el índice lo para", async () => {
      const filas = await prisma.$queryRawUnsafe<
        Array<{ pin_lookup: string }>
      >(`SELECT pin_lookup FROM care_pins WHERE user_id = '${anaId}'`);
      const msg = await debeFallar(
        `UPDATE care_pins SET pin_lookup = '${filas[0]!.pin_lookup}' WHERE user_id = '${rosaId}'`,
      );
      expect(msg).toContain("already exists");
      expect(msg).toContain("pin_lookup");
    });

    it("SABOTAJE · MEDIA FOTO en la ficha no entra", async () => {
      // Se parte de una ficha SIN foto. Con una foto completa puesta,
      // cambiarle el nombre del fichero deja las cinco columnas con valor
      // y el CHECK pasa — correctamente, porque sigue siendo una foto
      // completa (apunta a un fichero que no existe, y eso lo detecta la
      // huella al servirla, no un CHECK).
      await prisma.$executeRawUnsafe(
        `UPDATE resident_profiles SET photo_file_name = NULL, photo_sha256 = NULL,
           photo_bytes = NULL, photo_mime_type = NULL, photo_uploaded_at = NULL,
           photo_uploaded_by_user_id = NULL
         WHERE client_id = '${carmenId}'`,
      );
      const msg = await debeFallar(
        `UPDATE resident_profiles SET photo_file_name = 'x.jpg' WHERE client_id = '${carmenId}'`,
      );
      expect(msg).toMatch(
        /resident_profiles_foto_completa|violates check constraint|check constraint/,
      );
    });
  });

  // ══ Y UN TERMINAL CONTRA LA PUERTA ═══════════════════════════════
  it("UN TERMINAL NO ENTRA EN LAS RUTAS DE LA PUERTA", async () => {
    // Al revés que residencia-1 (que probó `/puerta/me`), aquí son las
    // rutas que escriben. La puerta de auth es la misma y por eso basta
    // una: `requirePuertaDevice`.
    const tienda = randomUUID();
    const caja = randomUUID();
    const terminal = randomUUID();
    const tokenTerminal = randomBytes(24).toString("hex");
    await prisma.$executeRawUnsafe(
      `INSERT INTO stores (id, tenant_id, name) VALUES ('${tienda}', '${tenantId}', 'Cafetería')`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO registers (id, store_id, name)
       VALUES ('${caja}', '${tienda}', 'Caja 1')`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO devices (id, tenant_id, kind, room_id, register_id, device_token_hash)
       VALUES ('${terminal}', '${tenantId}', 'TERMINAL', NULL, '${caja}',
               '${createHash("sha256").update(tokenTerminal, "utf8").digest("hex")}')`,
    );
    for (const url of [
      "/residencia/puerta/arranque",
      "/residencia/puerta/lo-que-toca",
    ]) {
      const r = await app.inject({
        method: "GET",
        url,
        headers: { "x-device-token": tokenTerminal },
      });
      expect(r.statusCode, `${url} · ${r.body}`).toBe(403);
      expect(r.json().error).toBe("NOT_A_ROOM_DEVICE");
    }
    const pin = await app.inject({
      method: "POST",
      url: "/residencia/puerta/pin",
      headers: { "x-device-token": tokenTerminal },
      payload: { pin: PIN_ANA },
    });
    expect(pin.statusCode).toBe(403);

    await prisma.$executeRawUnsafe(`DELETE FROM devices WHERE id = '${terminal}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM registers WHERE id = '${caja}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM stores WHERE id = '${tienda}'`);
  });

  // ══ Y EL CONTRATO DE ENCARGADO ═══════════════════════════════════
  it("CON EL CONTRATO NO VIGENTE, la puerta no escribe: 423", async () => {
    const cabeceras = await entrar(PIN_ANA);
    await prisma.$executeRawUnsafe(
      `INSERT INTO clinical_processor_agreements (id, tenant_id, version, text_sha256, user_id, at, revokes_agreement_id)
       SELECT '${randomUUID()}', '${tenantId}', 1, '${"a".repeat(64)}', '${directoraId}', now(), id
       FROM clinical_processor_agreements
       WHERE tenant_id = '${tenantId}' AND revokes_agreement_id IS NULL LIMIT 1`,
    );
    olvidarEstado();
    const r = await mandar(cabeceras, [registro()]);
    expect(r.statusCode, r.body).toBe(423);

    // Y LEER **SÍ** sigue funcionando, y es la decisión de clinica-7 tal
    // cual: «leer y exportar siguen funcionando con el contrato revocado,
    // porque lo que hay en la historia se escribió con el contrato
    // aceptado y la Ley 41/2002 obliga a conservarla y a dársela a quien
    // la pida». Lo que el 423 apaga es `WRITE`.
    //
    // En la puerta eso significa algo concreto y correcto: con el contrato
    // revocado la auxiliar sigue viendo lo que toca y lo que está hecho
    // —puede hacer su trabajo— y lo que no puede es apuntar nada nuevo.
    const leer = await app.inject({
      method: "GET",
      url: "/residencia/puerta/lo-que-toca",
      headers: cabeceras,
    });
    expect(leer.statusCode, leer.body).toBe(200);

    // Se devuelve el contrato para los tests que vengan después.
    await prisma.$executeRawUnsafe(
      `ALTER TABLE clinical_processor_agreements DISABLE TRIGGER clinical_processor_agreements_append_only`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM clinical_processor_agreements
       WHERE tenant_id = '${tenantId}' AND revokes_agreement_id IS NOT NULL`,
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE clinical_processor_agreements ENABLE TRIGGER clinical_processor_agreements_append_only`,
    );
    olvidarEstado();
  });
});
