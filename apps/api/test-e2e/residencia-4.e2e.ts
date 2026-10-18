// residencia-4 · **LA GRAVEDAD, EL LIBRO Y EL AVISO, CONTRA POSTGRES.**
//
// Monta las rutas, como `residencia-3.e2e.ts` y por lo mismo: lo que hay
// que ver es el camino completo —la auxiliar teclea 38,6 en la puerta, el
// servidor declara la incidencia, le pone nivel y el móvil de guardia la
// recibe y la acusa, y la puerta lo pinta— y eso no se ve mirando el
// esquema.
//
// Las garantías, una por bloque:
//
//    1. **La tablet y el servidor dan el mismo nivel.** Las reglas que
//       viajan en `/puerta/arranque` ejecutadas con `gravedadDe` dan lo
//       mismo que el servidor al derivar. Es la pieza que el test de oro
//       (`test/residencia-4-gravedad.test.ts`) no puede probar.
//    2. Una constante que cruza umbral **declara la incidencia sola**.
//    3. **Tres tomas de fiebre en un turno son UNA incidencia**, sube de
//       N1 a N2 y avisa una vez más.
//    4. Un lote repetido **no deriva dos veces**.
//    5. Fuera de rango **no se guarda**.
//    6. «Algo no va bien» con tipo, y el botón de la enfermera.
//    7. **El escalado, con reloj falso**: sin nadie de guardia, al
//       momento; con enfermera que no acusa, a los 5 min; acuse antes, no
//       escala; N3/N4, los dos a la vez.
//    8. **El aviso que llega tarde** sale con su hora original y su
//       retraso a la vista.
//    9. La pasada de **ausencias** no duplica cada día.
//   10. El **cierre** (D-27, D-28) y la **constancia de familia** (D-34).
//   11. La **excepción de umbral**: sólo `MEDICO`, sustituye, caducada
//       vuelve la de serie.
//   12. La **tabla de sabotajes** contra el motor.
//   13. Y los cruces: un TERMINAL contra las rutas de guardia, una puerta
//       acusando un aviso, un tenant sin residencia.

import { createHash, randomBytes, randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
// La misma razón, el mismo mock y la misma lección que `residencia-3`
// (§18 de su done): el PIN pasa por el rate-limit, que vive en Redis, y
// el job `e2e` de CI **sólo levanta Postgres**. Con el cliente de
// `context.ts` (`maxRetriesPerRequest: null`, lo exige BullMQ), un
// comando contra un Redis que no está no falla: espera para siempre. Son
// 48 minutos de runner y un log de `ECONNREFUSED`.
//
// Se sustituye el TRANSPORTE, no el limitador: la ruta y `rate-limit.ts`
// siguen siendo los de verdad.
vi.mock("../src/context.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/context.js")>();
  // residencia-5 · el doble vive en `redis-falso.ts`, no inline. Tres
  // copias de un Redis falso son tres sitios donde `expire` puede
  // comportarse distinto, y entonces un rate-limit que falla en un bloque
  // pasa en el de al lado. El `vi.mock` sigue aquí porque es por fichero.
  const { redisFalso } = await import("./redis-falso.js");
  const falso = redisFalso();
  return {
    ...original,
    getRedis: () => falso as unknown as ReturnType<typeof original.getRedis>,
  };
});

const { getPrisma, getRedis, shutdown } = await import("../src/context.js");
const { cargarCatalogoDeSerie } = await import(
  "../src/residencia/catalogo/cargar-catalogo.js"
);
const { cargarPlantillaDeGravedad } = await import(
  "../src/residencia/catalogo/cargar-plantilla.js"
);
const { sembrarResidencia } = await import("../src/residencia/semilla.js");
const { registerResidenciaPuertaRegistroRoutes } = await import(
  "../src/residencia/puerta-registro-routes.js"
);
const { registerResidenciaIncidenciasRoutes } = await import(
  "../src/residencia/incidencias-routes.js"
);
const { registerResidenciaGuardiaRoutes } = await import(
  "../src/residencia/guardia-routes.js"
);
const { registerResidenciaResidentesRoutes } = await import(
  "../src/residencia/residentes-routes.js"
);
const { registerResidenciaFichaRoutes } = await import(
  "../src/residencia/ficha-routes.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");
const { olvidarClaves } = await import("../src/clinica/claves.js");
const { olvidarEstado } = await import("../src/clinica/contrato.js");
const { pasadaDeGuardia } = await import(
  "../src/residencia/pasada-de-guardia.js"
);
const { pasadaDeAusencias } = await import("../src/residencia/derivacion.js");
const { parteDeResidencia } = await import("../src/residencia/exportacion.js");
const { gravedadDe } = await import("@mipiacetpv/residencia-plan");

const PIN_ANA = "4071"; // auxiliar, zona primera planta
const PIN_ROSA = "9182"; // DUE, alcance total — la del móvil de enfermería
const PIN_PILAR = "3344"; // dirección — el móvil de responsable
const PIN_SOTO = "5566"; // médico — el único que pauta un umbral

/** El canario de este fichero: si aparece en un volcado, el bloque no
 *  sirve. Es el texto de una acción, que va cifrado (D-63). */
const CANARIO = "CANARIO-ACCION-paracetamol-y-la-vuelvo-a-mirar";

/**
 * La primera fila de una consulta que TIENE que traer alguna.
 *
 * Existe para que un `SELECT` que no devuelve nada falle aquí, con el
 * nombre de lo que faltaba, en vez de tres líneas más abajo con un
 * «cannot read property of undefined». Y de paso evita el `!` repetido
 * doce veces, que es ruido que se lee peor que una función con nombre.
 */
function primera<T>(filas: T[], que = "la fila"): T {
  const f = filas[0];
  if (f === undefined) throw new Error(`No se encontró ${que}.`);
  return f;
}

/** Un INSERT/UPDATE/DELETE que tiene que FALLAR. Devuelve el mensaje. */
async function debeFallar(sql: string): Promise<string> {
  const prisma = getPrisma();
  try {
    await prisma.$executeRawUnsafe(sql);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error(`El motor ACEPTÓ lo que no debía:\n${sql}`);
}

describe.skipIf(!e2eEnabled)("e2e · gravedad, incidencias y el aviso", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let app: FastifyInstance;
  let tenantId = "";
  let pilarId = "";
  let anaId = "";
  let rosaId = "";
  let sotoId = "";
  let plantaId = "";
  let hab112 = "";
  let cama112A = "";
  let cama112B = "";
  let carmenId = "";
  let luisId = "";
  let tablet112 = "";
  let token112 = "";
  /** Los dos móviles de guardia. */
  let movilEnfermeria = "";
  let tokenEnfermeria = "";
  let movilResponsable = "";
  let tokenResponsable = "";
  /** Y un TERMINAL, para el sabotaje del cruce. */
  let tokenTerminal = "";
  let turnos: Array<{ id: string; code: string }> = [];
  let comoPilar: Record<string, string> = {};

  // ── Ayudas ────────────────────────────────────────────────────────

  async function entrarEnLaPuerta(
    pin = PIN_ANA,
  ): Promise<Record<string, string>> {
    const r = await app.inject({
      method: "POST",
      url: "/residencia/puerta/pin",
      headers: { "x-device-token": token112 },
      payload: { pin },
    });
    expect(r.statusCode, r.body).toBe(200);
    return {
      "x-device-token": token112,
      authorization: `Bearer ${r.json().token}`,
    };
  }

  /** Coge un móvil de guardia con un PIN. */
  async function ponerseDeGuardia(
    token: string,
    pin: string,
  ): Promise<Record<string, string>> {
    const r = await app.inject({
      method: "POST",
      url: "/residencia/guardia/pin",
      headers: { "x-device-token": token },
      payload: { pin },
    });
    expect(r.statusCode, r.body).toBe(200);
    return {
      "x-device-token": token,
      authorization: `Bearer ${r.json().token}`,
    };
  }

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

  /** Una constante, con los valores por defecto del turno de mañana. */
  function medida(p: Record<string, unknown> = {}): Record<string, unknown> {
    const manana = turnos.find((t) => t.code === "M")!;
    return {
      id: randomUUID(),
      clientId: carmenId,
      controlCode: "TEMPERATURA",
      recordedAt: new Date().toISOString(),
      centerShiftId: manana.id,
      careDay: new Date().toISOString().slice(0, 10),
      valor: { tipo: "NUMERIC", numero: 38.6 },
      ...p,
    };
  }

  /** Lo que hay en el libro de este centro. */
  async function incidencias(): Promise<
    Array<{
      id: string;
      incident_type: string;
      severity: string;
      open: boolean;
      client_id: string | null;
    }>
  > {
    return prisma.$queryRawUnsafe(
      `SELECT id, incident_type, severity, open, client_id FROM incidents
       WHERE tenant_id = '${tenantId}' ORDER BY opened_at`,
    );
  }

  async function avisos(): Promise<
    Array<{
      id: string;
      channel: string;
      state: string;
      severity: string;
      escalate_at: Date | null;
      escalated_from_id: string | null;
    }>
  > {
    return prisma.$queryRawUnsafe(
      `SELECT a.id, a.channel, a.state, a.severity, a.escalate_at, a.escalated_from_id
       FROM guard_alerts a WHERE a.tenant_id = '${tenantId}' ORDER BY a.created_at`,
    );
  }

  beforeAll(async () => {
    await cargarCatalogoDeSerie();
    await cargarPlantillaDeGravedad();

    tenantId = randomUUID();
    pilarId = randomUUID();
    anaId = randomUUID();
    rosaId = randomUUID();
    sotoId = randomUUID();

    await prisma.$executeRawUnsafe(
      `INSERT INTO tenants (id, name, residencia_enabled, clinical_records_enabled, crm_enabled, agenda_enabled, caja_enabled, updated_at)
       VALUES ('${tenantId}', 'Jardín de Gredos', true, true, true, true, false, now())`,
    );
    for (const [u, alias, rol] of [
      [pilarId, "Pilar", "OWNER"],
      [anaId, "Ana", "CLINICIAN"],
      [rosaId, "Rosa", "CLINICIAN"],
      [sotoId, "Soto", "CLINICIAN"],
    ] as const) {
      // residencia-5 · **el correo lleva el id del tenant dentro.**
      // `users.email` es único GLOBAL y los tres ficheros de residencia
      // corren a la vez contra la misma base: con `pilar@gredos.es` a
      // secas, el que llegaba segundo reventaba en su `beforeAll` y sus
      // tests se saltaban en verde. Pasaba ya con dos ficheros y era
      // cuestión de en qué orden los arrancara vitest.
      await prisma.$executeRawUnsafe(
        `INSERT INTO users (id, tenant_id, email, alias, role, is_clinician, clinical_scope)
         VALUES ('${u}', '${tenantId}', '${alias.toLowerCase()}-${tenantId.slice(0, 8)}@gredos.es', '${alias}', '${rol}', true, 'SELECTION')`,
      );
    }
    await sembrarResidencia(prisma as never, tenantId);
    for (const [u, code] of [
      [pilarId, "DIRECCION"],
      [anaId, "AUXILIAR"],
      [rosaId, "DUE"],
      [sotoId, "MEDICO"],
    ] as const) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO care_role_assignments (id, tenant_id, user_id, care_role_id, from_at, granted_by_user_id)
         SELECT '${randomUUID()}', '${tenantId}', '${u}', id, now() - interval '400 days', '${pilarId}'
         FROM care_roles WHERE tenant_id = '${tenantId}' AND code = '${code}'`,
      );
    }
    // El MÉDICO necesita colegiado: lo pide `care_roles.requires_license`
    // en la ruta de asignación, y aquí se inserta en crudo. Se deja dicho
    // para que nadie crea que la ruta no lo exige.
    await prisma.$executeRawUnsafe(
      `INSERT INTO clinical_processor_agreements (id, tenant_id, version, text_sha256, user_id, at)
       VALUES ('${randomUUID()}', '${tenantId}', 1, '${"a".repeat(64)}', '${pilarId}', now())`,
    );

    plantaId = randomUUID();
    hab112 = randomUUID();
    cama112A = randomUUID();
    cama112B = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO floors (id, tenant_id, name, sort_order, updated_at)
       VALUES ('${plantaId}', '${tenantId}', 'Primera', 1, now())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO rooms (id, tenant_id, floor_id, number, active, updated_at)
       VALUES ('${hab112}', '${tenantId}', '${plantaId}', '112', true, now())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO beds (id, tenant_id, room_id, label, active, updated_at)
       VALUES ('${cama112A}', '${tenantId}', '${hab112}', 'A', true, now()),
              ('${cama112B}', '${tenantId}', '${hab112}', 'B', true, now())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO care_zone_assignments (id, tenant_id, user_id, floor_id, from_at, granted_by_user_id)
       VALUES ('${randomUUID()}', '${tenantId}', '${anaId}', '${plantaId}', now() - interval '30 days', '${pilarId}')`,
    );

    comoPilar = {
      authorization: `Bearer ${signAccessToken({ sub: pilarId, tid: tenantId, role: "OWNER" })}`,
    };

    app = Fastify({ logger: false });
    await registerResidenciaPuertaRegistroRoutes(app);
    await registerResidenciaIncidenciasRoutes(app);
    await registerResidenciaGuardiaRoutes(app);
    await registerResidenciaResidentesRoutes(app);
    await registerResidenciaFichaRoutes(app);
    await app.ready();

    for (const [nombre, cama] of [
      ["Carmen", cama112A],
      ["Luis", cama112B],
    ] as const) {
      const r = await app.inject({
        method: "POST",
        url: "/residencia/residentes",
        headers: comoPilar,
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
      else luisId = id;
    }

    // La tablet de la 112.
    tablet112 = randomUUID();
    token112 = randomBytes(24).toString("hex");
    await prisma.$executeRawUnsafe(
      `INSERT INTO devices (id, tenant_id, kind, room_id, register_id, name, device_token_hash)
       VALUES ('${tablet112}', '${tenantId}', 'ROOM', '${hab112}', NULL, 'Puerta 112',
               '${createHash("sha256").update(token112, "utf8").digest("hex")}')`,
    );

    // Los dos móviles de guardia, por la ruta de verdad: así se prueba
    // de paso que el canal lo decide el CÓDIGO y no el aparato.
    for (const canal of ["ENFERMERIA", "RESPONSABLE"] as const) {
      const r = await app.inject({
        method: "POST",
        url: "/residencia/guardia/pairing-codes",
        headers: comoPilar,
        payload: { canal },
      });
      expect(r.statusCode, r.body).toBe(201);
      expect(r.json().canal).toBe(canal);
      const id = randomUUID();
      const token = randomBytes(24).toString("hex");
      await prisma.$executeRawUnsafe(
        `INSERT INTO devices (id, tenant_id, kind, room_id, register_id, guard_channel, name, device_token_hash)
         VALUES ('${id}', '${tenantId}', 'GUARD', NULL, NULL, '${canal}', 'Móvil ${canal}',
                 '${createHash("sha256").update(token, "utf8").digest("hex")}')`,
      );
      if (canal === "ENFERMERIA") {
        movilEnfermeria = id;
        tokenEnfermeria = token;
      } else {
        movilResponsable = id;
        tokenResponsable = token;
      }
    }

    // Y un TERMINAL, que no es de ninguna de las dos cosas. Necesita una
    // caja: el CHECK `devices_register_o_habitacion` lo exige.
    const storeId = randomUUID();
    const registerId = randomUUID();
    tokenTerminal = randomBytes(24).toString("hex");
    await prisma.$executeRawUnsafe(
      `INSERT INTO stores (id, tenant_id, name)
       VALUES ('${storeId}', '${tenantId}', 'Office')`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO registers (id, store_id, name)
       VALUES ('${registerId}', '${storeId}', 'Caja')`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO devices (id, tenant_id, kind, register_id, name, device_token_hash)
       VALUES ('${randomUUID()}', '${tenantId}', 'TERMINAL', '${registerId}', 'Terminal',
               '${createHash("sha256").update(tokenTerminal, "utf8").digest("hex")}')`,
    );

    turnos = await prisma.$queryRawUnsafe<Array<{ id: string; code: string }>>(
      `SELECT id, code FROM center_shifts WHERE tenant_id = '${tenantId}'`,
    );

    for (const [u, pin] of [
      [anaId, PIN_ANA],
      [rosaId, PIN_ROSA],
      [pilarId, PIN_PILAR],
      [sotoId, PIN_SOTO],
    ] as const) {
      const r = await app.inject({
        method: "PUT",
        url: `/residencia/personal/${u}/pin-de-puerta`,
        headers: comoPilar,
        payload: { pin },
      });
      expect(r.statusCode, r.body).toBe(200);
    }
  });

  afterAll(async () => {
    await app?.close();
    const t = tenantId;
    for (const [tabla, trigger] of [
      ["family_communications", "family_communications_append_only"],
      ["incident_actions", "incident_actions_append_only"],
      ["incidents", "incidents_inmutable"],
      ["care_records", "care_records_inmutable"],
    ] as const) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${tabla} DISABLE TRIGGER ${trigger}`,
      );
    }
    await prisma.$executeRawUnsafe(`DELETE FROM guard_alerts WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM guard_shift_sessions WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM center_guard_settings WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM family_communications WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM incident_actions WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM incident_links WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM incidents WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(
      `DELETE FROM resident_threshold_rules WHERE override_id IN
         (SELECT id FROM resident_threshold_overrides WHERE tenant_id = '${t}')`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM resident_threshold_overrides WHERE tenant_id = '${t}'`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM care_records WHERE tenant_id = '${t}'`);
    for (const [tabla, trigger] of [
      ["family_communications", "family_communications_append_only"],
      ["incident_actions", "incident_actions_append_only"],
      ["incidents", "incidents_inmutable"],
      ["care_records", "care_records_inmutable"],
    ] as const) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${tabla} ENABLE TRIGGER ${trigger}`,
      );
    }
    await prisma.$executeRawUnsafe(`DELETE FROM care_pins WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE clinical_access_log DISABLE TRIGGER clinical_access_log_append_only`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM clinical_access_log WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE clinical_access_log ENABLE TRIGGER clinical_access_log_append_only`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM devices WHERE tenant_id = '${t}'`);
    // Los códigos de emparejamiento: los crearon Pilar y la ruta de
    // guardia, y su FK a `users` es RESTRICT. Antes de los usuarios.
    await prisma.$executeRawUnsafe(`DELETE FROM pairing_codes WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM registers WHERE store_id IN (SELECT id FROM stores WHERE tenant_id = '${t}')`);
    await prisma.$executeRawUnsafe(`DELETE FROM stores WHERE tenant_id = '${t}'`);
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
    // ── residencia-5 · LOS PARTES DE RELEVO DE ESTE CENTRO ────────
    //
    // Y no los crea este fichero: los congela **la pasada**, que desde
    // residencia-5 hace tres cosas en vez de dos (`pasada-de-relevo.ts`)
    // y recorre TODOS los centros con residencia encendida. Así que un
    // tenant de este fichero acaba con partes congelados aunque aquí
    // nadie hable de relevos — y sin esta limpieza, el `DELETE FROM
    // center_shifts` de abajo rebota contra `handovers_center_shift_id_fkey`.
    for (const [tabla, trigger] of [
      ["handover_late_additions", "handover_late_additions_append_only"],
      ["handover_ack_zones", "handover_ack_zones_append_only"],
      ["handover_acks", "handover_acks_append_only"],
      ["handover_zones", "handover_zones_append_only"],
      ["handovers", "handovers_inmutable"],
    ] as const) {
      await prisma.$executeRawUnsafe(`ALTER TABLE ${tabla} DISABLE TRIGGER ${trigger}`);
      await prisma.$executeRawUnsafe(`DELETE FROM ${tabla} WHERE tenant_id = '${t}'`);
      await prisma.$executeRawUnsafe(`ALTER TABLE ${tabla} ENABLE TRIGGER ${trigger}`);
    }
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
    await getRedis().flushall();
    for (const [tabla, trigger] of [
      ["family_communications", "family_communications_append_only"],
      ["incident_actions", "incident_actions_append_only"],
      ["incidents", "incidents_inmutable"],
      ["care_records", "care_records_inmutable"],
    ] as const) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${tabla} DISABLE TRIGGER ${trigger}`,
      );
    }
    await prisma.$executeRawUnsafe(`DELETE FROM guard_alerts WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM guard_shift_sessions WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM family_communications WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM incident_actions WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM incident_links WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM incidents WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM care_records WHERE tenant_id = '${tenantId}'`);
    for (const [tabla, trigger] of [
      ["family_communications", "family_communications_append_only"],
      ["incident_actions", "incident_actions_append_only"],
      ["incidents", "incidents_inmutable"],
      ["care_records", "care_records_inmutable"],
    ] as const) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${tabla} ENABLE TRIGGER ${trigger}`,
      );
    }
    await prisma.$executeRawUnsafe(
      `DELETE FROM resident_threshold_rules WHERE override_id IN
         (SELECT id FROM resident_threshold_overrides WHERE tenant_id = '${tenantId}')`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM resident_threshold_overrides WHERE tenant_id = '${tenantId}'`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM center_guard_settings WHERE tenant_id = '${tenantId}'`,
    );
  });

  // ══ 1 · LA TABLET Y EL SERVIDOR ══════════════════════════════════
  describe("la tablet y el servidor dan el MISMO nivel", () => {
    it("para toda la tabla del §3, con las reglas que viajan en el arranque", async () => {
      // Esta es la pieza que el test de oro no puede probar: que las
      // reglas que la tablet se lleva en `/puerta/arranque` son las
      // mismas que el servidor usa al derivar. Lo que podría divergir es
      // el mapeo de filas de Postgres a reglas.
      const arranque = await app.inject({
        method: "GET",
        url: "/residencia/puerta/arranque",
        headers: { "x-device-token": token112 },
      });
      expect(arranque.statusCode, arranque.body).toBe(200);
      const reglas = arranque.json().plantilla.reglas;
      expect(reglas.length).toBeGreaterThan(0);

      const cabeceras = await entrarEnLaPuerta();
      const casos: Array<[string, number, string | null]> = [
        ["TEMPERATURA", 37.4, null],
        ["TEMPERATURA", 37.5, "N1"],
        ["TEMPERATURA", 38.0, "N2"],
        ["TEMPERATURA", 39.5, "N3"],
        ["SATURACION_O2", 92, null],
        ["SATURACION_O2", 91, "N2"],
        ["SATURACION_O2", 87, "N3"],
        ["TA_SISTOLICA", 90, "N2"],
        ["TA_SISTOLICA", 91, null],
        ["TA_SISTOLICA", 180, "N2"],
        ["GLUCEMIA", 70, null],
        ["GLUCEMIA", 69, "N2"],
        ["GLUCEMIA", 49, "N3"],
        ["GLUCEMIA", 301, "N2"],
        ["PULSO", 180, null],
      ];

      for (const [control, numero, esperado] of casos) {
        // Lo que la TABLET pintaría, con `gravedadDe` y las reglas del
        // arranque.
        const enLaTablet = gravedadDe(control, numero, reglas)?.nivel ?? null;
        expect(enLaTablet, `${control} ${numero} en la tablet`).toBe(esperado);

        // Y lo que el SERVIDOR dice al derivar. Cada caso con un
        // residente limpio de incidencias para que la deduplicación no
        // mezcle: se borra el libro entre uno y otro.
        // Las acciones son APPEND-ONLY y las incidencias INMUTABLES:
        // limpiar entre casos exige apartar los dos triggers, que es
        // otra garantía funcionando (lo encontró este bucle al no poder
        // borrar lo que acababa de crear).
        await prisma.$executeRawUnsafe(
          `ALTER TABLE incident_actions DISABLE TRIGGER incident_actions_append_only`,
        );
        await prisma.$executeRawUnsafe(
          `ALTER TABLE incidents DISABLE TRIGGER incidents_inmutable`,
        );
        await prisma.$executeRawUnsafe(`DELETE FROM incident_actions WHERE tenant_id = '${tenantId}'`);
        await prisma.$executeRawUnsafe(`DELETE FROM guard_alerts WHERE tenant_id = '${tenantId}'`);
        await prisma.$executeRawUnsafe(`DELETE FROM incidents WHERE tenant_id = '${tenantId}'`);
        await prisma.$executeRawUnsafe(
          `ALTER TABLE incidents ENABLE TRIGGER incidents_inmutable`,
        );
        await prisma.$executeRawUnsafe(
          `ALTER TABLE incident_actions ENABLE TRIGGER incident_actions_append_only`,
        );

        const r = await mandar(cabeceras, [medida({ controlCode: control, valor: { tipo: "NUMERIC", numero } })]);
        expect(r.statusCode, r.body).toBe(200);
        const enElServidor = r.json().registros[0].incidencia?.nivel ?? null;
        expect(enElServidor, `${control} ${numero} en el servidor`).toBe(esperado);
      }
    });
  });

  // ══ 2 · LA CONSTANTE DECLARA LA INCIDENCIA SOLA ══════════════════
  describe("38,6 en la puerta", () => {
    it("se guarda, abre una incidencia FIEBRE N2 y suena en enfermería", async () => {
      // El móvil de enfermería, cogido. Sin él, el aviso escalaría al
      // momento a dirección — que es el caso del bloque 7.
      await ponerseDeGuardia(tokenEnfermeria, PIN_ROSA);

      const cabeceras = await entrarEnLaPuerta();
      const r = await mandar(cabeceras, [medida()]);
      expect(r.statusCode, r.body).toBe(200);
      const res = r.json().registros[0];
      expect(res.estado).toBe("guardado");
      expect(res.incidencia.tipo).toBe("FIEBRE");
      expect(res.incidencia.nivel).toBe("N2");
      expect(res.incidencia.creada).toBe(true);
      expect(res.incidencia.avisadoEn).toEqual(["ENFERMERIA"]);

      // Y la incidencia apunta a la MEDIDA que la abrió: sin ella,
      // «fiebre» no dice a cuánto estaba.
      const inc = primera(
        await prisma.$queryRawUnsafe<
          Array<{ origin: string; source_record_id: string; template_version: number }>
        >(`SELECT origin, source_record_id, template_version FROM incidents WHERE tenant_id = '${tenantId}'`),
        "la incidencia derivada",
      );
      expect(inc.origin).toBe("DERIVED_THRESHOLD");
      expect(inc.source_record_id).toBe(res.id);
      expect(inc.template_version).toBeGreaterThanOrEqual(1);
    });

    it("y el móvil de enfermería lo ve con la habitación, el residente y el número", async () => {
      const guardia = await ponerseDeGuardia(tokenEnfermeria, PIN_ROSA);
      const cabeceras = await entrarEnLaPuerta();
      await mandar(cabeceras, [medida()]);

      const r = await app.inject({
        method: "GET",
        url: "/residencia/guardia/avisos",
        headers: guardia,
      });
      expect(r.statusCode, r.body).toBe(200);
      const a = primera(r.json().avisos as Array<Record<string, any>>, "el aviso");
      expect(a.nivel).toBe("N2");
      expect(a.incidencia.habitacion.numero).toBe("112");
      expect(a.incidencia.residente.nombre).toBe("Carmen Núñez");
      expect(a.incidencia.medida).toEqual({
        control: "TEMPERATURA",
        numero: 38.6,
        unidad: "°C",
      });
    });

    it("36,4 no abre nada: el caso normal no cuesta ni una fila del libro", async () => {
      const cabeceras = await entrarEnLaPuerta();
      const r = await mandar(cabeceras, [
        medida({ valor: { tipo: "NUMERIC", numero: 36.4 } }),
      ]);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().registros[0].incidencia).toBeUndefined();
      expect(await incidencias()).toHaveLength(0);
    });
  });

  // ══ 3 · TRES TOMAS SON UNA INCIDENCIA ════════════════════════════
  describe("tres tomas de fiebre en un turno", () => {
    it("son UNA incidencia, sube de N1 a N2 y avisa UNA vez más", async () => {
      await ponerseDeGuardia(tokenEnfermeria, PIN_ROSA);
      const cabeceras = await entrarEnLaPuerta();

      // 37,6 → N1. No suena.
      const r1 = await mandar(cabeceras, [
        medida({ valor: { tipo: "NUMERIC", numero: 37.6 } }),
      ]);
      expect(r1.json().registros[0].incidencia.nivel).toBe("N1");
      expect(r1.json().registros[0].incidencia.avisadoEn).toEqual([]);

      // 38,2 → sube a N2 y AHORA sí suena.
      const r2 = await mandar(cabeceras, [
        medida({ valor: { tipo: "NUMERIC", numero: 38.2 } }),
      ]);
      const i2 = r2.json().registros[0].incidencia;
      expect(i2.creada).toBe(false);
      expect(i2.subioNivel).toBe(true);
      expect(i2.nivel).toBe("N2");
      expect(i2.avisadoEn).toEqual(["ENFERMERIA"]);

      // 38,4 → sigue siendo N2: no sube y NO vuelve a sonar.
      const r3 = await mandar(cabeceras, [
        medida({ valor: { tipo: "NUMERIC", numero: 38.4 } }),
      ]);
      const i3 = r3.json().registros[0].incidencia;
      expect(i3.creada).toBe(false);
      expect(i3.subioNivel).toBe(false);
      expect(i3.avisadoEn).toEqual([]);

      // UNA incidencia, con sus tres medidas dentro.
      const libro = await incidencias();
      expect(libro).toHaveLength(1);
      expect(libro[0]!.severity).toBe("N2");
      const acciones = await prisma.$queryRawUnsafe<Array<{ kind: string }>>(
        `SELECT kind FROM incident_actions WHERE incident_id = '${libro[0]!.id}' ORDER BY at`,
      );
      expect(acciones.map((a) => a.kind)).toEqual([
        "EVIDENCE",
        "EVIDENCE",
        "SEVERITY",
        "EVIDENCE",
      ]);
      // Y UN aviso, no tres. Lo clava el índice `(incident, channel)`.
      expect(await avisos()).toHaveLength(1);
    });

    it("y la fiebre de OTRO residente es OTRA incidencia", async () => {
      const cabeceras = await entrarEnLaPuerta();
      await mandar(cabeceras, [medida()]);
      await mandar(cabeceras, [medida({ clientId: luisId })]);
      expect(await incidencias()).toHaveLength(2);
    });
  });

  // ══ 4 · UN LOTE REPETIDO NO DERIVA DOS VECES ═════════════════════
  describe("el mismo lote dos veces", () => {
    it("no duplica el registro NI deriva dos veces", async () => {
      // Con la enfermera de guardia, para que el aviso sea UNO y lo que
      // se esté contando sea la idempotencia y no el escalado.
      await ponerseDeGuardia(tokenEnfermeria, PIN_ROSA);
      const cabeceras = await entrarEnLaPuerta();
      const uno = medida();
      const a = await mandar(cabeceras, [uno]);
      expect(a.json().registros[0].estado).toBe("guardado");
      const b = await mandar(cabeceras, [uno]);
      // `ya-estaba`: la idempotencia se comprueba antes que nada y **no
      // vuelve a derivar**, porque `paraDerivar` sólo viene puesto
      // cuando la fila entró de verdad.
      expect(b.json().registros[0].estado).toBe("ya-estaba");
      expect(b.json().registros[0].incidencia).toBeUndefined();
      expect(await incidencias()).toHaveLength(1);
      expect(await avisos()).toHaveLength(1);
    });
  });

  // ══ 5 · FUERA DE RANGO ═══════════════════════════════════════════
  describe("384 °C", () => {
    it("NO se guarda, y la frase pregunta «38,4 o 384»", async () => {
      const cabeceras = await entrarEnLaPuerta();
      const r = await mandar(cabeceras, [
        medida({ valor: { tipo: "NUMERIC", numero: 384 } }),
      ]);
      // Nada entró, así que el lote entero es 409 y la cola lo deja
      // visible.
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json().registros[0].codigo).toBe("VALOR_FUERA_DE_RANGO");
      expect(r.json().registros[0].mensaje).toContain("Repite la toma");
      expect(await incidencias()).toHaveLength(0);
    });
  });

  // ══ 6 · «ALGO NO VA BIEN» CON TIPO ═══════════════════════════════
  describe("«algo no va bien»", () => {
    it("a secas vale N1 y no suena (D-13)", async () => {
      const cabeceras = await entrarEnLaPuerta();
      const r = await mandar(cabeceras, [
        medida({ controlCode: "ALGO_NO_VA_BIEN", valor: { tipo: "NOTA" } }),
      ]);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().registros[0].incidencia.nivel).toBe("N1");
      expect(r.json().registros[0].incidencia.avisadoEn).toEqual([]);
    });

    it("una CAÍDA CON GOLPE es N3 y suena en los DOS canales a la vez", async () => {
      await ponerseDeGuardia(tokenEnfermeria, PIN_ROSA);
      const cabeceras = await entrarEnLaPuerta();
      const r = await mandar(cabeceras, [
        medida({
          controlCode: "ALGO_NO_VA_BIEN",
          valor: { tipo: "NOTA", evento: "CAIDA", matiz: "CON_GOLPE" },
        }),
      ]);
      const i = r.json().registros[0].incidencia;
      expect(i.nivel).toBe("N3");
      expect(i.tipo).toBe("CAIDA");
      expect(i.avisadoEn.sort()).toEqual(["ENFERMERIA", "RESPONSABLE"]);
      // Y NO escala: ya han sonado los dos.
      const as = await avisos();
      expect(as.every((a) => a.escalate_at == null)).toBe(true);
    });

    it("y SIN GOLPE es N1", async () => {
      const cabeceras = await entrarEnLaPuerta();
      const r = await mandar(cabeceras, [
        medida({
          controlCode: "ALGO_NO_VA_BIEN",
          valor: { tipo: "NOTA", evento: "CAIDA", matiz: "SIN_GOLPE" },
        }),
      ]);
      expect(r.json().registros[0].incidencia.nivel).toBe("N1");
    });

    it("el SEGUNDO vómito del turno sube a N2", async () => {
      const cabeceras = await entrarEnLaPuerta();
      const uno = await mandar(cabeceras, [
        medida({
          controlCode: "ALGO_NO_VA_BIEN",
          valor: { tipo: "NOTA", evento: "VOMITO" },
        }),
      ]);
      expect(uno.json().registros[0].incidencia.nivel).toBe("N1");
      const dos = await mandar(cabeceras, [
        medida({
          controlCode: "ALGO_NO_VA_BIEN",
          valor: { tipo: "NOTA", evento: "VOMITO" },
        }),
      ]);
      expect(dos.json().registros[0].incidencia.nivel).toBe("N2");
      expect(dos.json().registros[0].incidencia.subioNivel).toBe(true);
      expect(await incidencias()).toHaveLength(1);
    });

    it("«no lo encontramos» es N4", async () => {
      const cabeceras = await entrarEnLaPuerta();
      const r = await mandar(cabeceras, [
        medida({
          controlCode: "ALGO_NO_VA_BIEN",
          valor: { tipo: "NOTA", evento: "NO_LOCALIZADO" },
        }),
      ]);
      expect(r.json().registros[0].incidencia.nivel).toBe("N4");
    });
  });

  // ══ 7 · EL BOTÓN DE LA ENFERMERA ═════════════════════════════════
  describe("«no puede esperar: avisar a la enfermera»", () => {
    it("fuerza N2 sobre un registro que no graduaba nada", async () => {
      const cabeceras = await entrarEnLaPuerta();
      const r = await mandar(cabeceras, [
        medida({
          valor: { tipo: "NUMERIC", numero: 36.8 },
          avisarEnfermera: true,
        }),
      ]);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().registros[0].incidencia.nivel).toBe("N2");
      expect(r.json().registros[0].incidencia.avisadoEn.length).toBeGreaterThan(0);
    });

    it("y NO baja un N3", async () => {
      const cabeceras = await entrarEnLaPuerta();
      const r = await mandar(cabeceras, [
        medida({
          controlCode: "ALGO_NO_VA_BIEN",
          valor: { tipo: "NOTA", evento: "CAIDA", matiz: "CON_GOLPE" },
          avisarEnfermera: true,
        }),
      ]);
      expect(r.json().registros[0].incidencia.nivel).toBe("N3");
    });

    it("también sobre un «hecho», que por sí solo no deriva nada", async () => {
      const cabeceras = await entrarEnLaPuerta();
      const r = await mandar(cabeceras, [
        medida({
          controlCode: "HIGIENE_PERSONAL",
          valor: { tipo: "BOOL", hecho: true },
          avisarEnfermera: true,
        }),
      ]);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().registros[0].incidencia.nivel).toBe("N2");
    });
  });

  // ══ 8 · EL ESCALADO, CON RELOJ FALSO ═════════════════════════════
  describe("el escalado (D-66)", () => {
    it("SIN NADIE DE GUARDIA en enfermería, suena en responsable AL MOMENTO", async () => {
      const cabeceras = await entrarEnLaPuerta();
      const r = await mandar(cabeceras, [medida()]);
      expect(r.json().registros[0].incidencia.avisadoEn.sort()).toEqual([
        "ENFERMERIA",
        "RESPONSABLE",
      ]);
      const as = await avisos();
      expect(as).toHaveLength(2);
      const enf = as.find((a) => a.channel === "ENFERMERIA")!;
      const resp = as.find((a) => a.channel === "RESPONSABLE")!;
      // El de enfermería queda `ESCALATED` y **no se cancela**: si la
      // enfermera aparece y lo acusa, sigue valiendo.
      expect(enf.state).toBe("ESCALATED");
      expect(resp.escalated_from_id).toBe(enf.id);
      expect(resp.escalate_at).toBeNull();
    });

    it("CON enfermera de guardia, espera 5 min y NO escala antes", async () => {
      await ponerseDeGuardia(tokenEnfermeria, PIN_ROSA);
      const cabeceras = await entrarEnLaPuerta();
      await mandar(cabeceras, [medida()]);

      const antes = await avisos();
      expect(antes).toHaveLength(1);
      expect(antes[0]!.channel).toBe("ENFERMERIA");
      expect(antes[0]!.escalate_at).not.toBeNull();

      // A los 4 minutos: no escala.
      const cuatro = new Date(Date.now() + 4 * 60_000);
      await pasadaDeGuardia({ prisma, ahora: cuatro });
      expect(await avisos()).toHaveLength(1);

      // A los 6: sí.
      const seis = new Date(Date.now() + 6 * 60_000);
      await pasadaDeGuardia({ prisma, ahora: seis });
      const despues = await avisos();
      expect(despues).toHaveLength(2);
      expect(despues.find((a) => a.channel === "RESPONSABLE")).toBeTruthy();
      expect(despues.find((a) => a.channel === "ENFERMERIA")!.state).toBe(
        "ESCALATED",
      );
    });

    it("y si la enfermera ACUSA antes, NO escala nunca", async () => {
      const guardia = await ponerseDeGuardia(tokenEnfermeria, PIN_ROSA);
      const cabeceras = await entrarEnLaPuerta();
      await mandar(cabeceras, [medida()]);

      const aviso = primera(await avisos(), "el aviso");
      const ack = await app.inject({
        method: "POST",
        url: `/residencia/guardia/avisos/${aviso.id}/acuse`,
        headers: guardia,
      });
      expect(ack.statusCode, ack.body).toBe(200);
      expect(ack.json().acusadoPor).toBe("Rosa");

      // Diez minutos después: sigue habiendo UN aviso.
      await pasadaDeGuardia({ prisma, ahora: new Date(Date.now() + 10 * 60_000) });
      const despues = await avisos();
      expect(despues).toHaveLength(1);
      expect(despues[0]!.state).toBe("ACKED");
    });

    it("la pasada es IDEMPOTENTE: correrla dos veces no abre dos avisos", async () => {
      await ponerseDeGuardia(tokenEnfermeria, PIN_ROSA);
      const cabeceras = await entrarEnLaPuerta();
      await mandar(cabeceras, [medida()]);
      const seis = new Date(Date.now() + 6 * 60_000);
      await pasadaDeGuardia({ prisma, ahora: seis });
      await pasadaDeGuardia({ prisma, ahora: seis });
      await pasadaDeGuardia({ prisma, ahora: new Date(Date.now() + 20 * 60_000) });
      expect(await avisos()).toHaveLength(2);
    });

    it("y los minutos los decide EL CENTRO", async () => {
      await app.inject({
        method: "PUT",
        url: "/residencia/guardia/configuracion",
        headers: comoPilar,
        payload: { minutosDeEscalado: 2 },
      });
      await ponerseDeGuardia(tokenEnfermeria, PIN_ROSA);
      const cabeceras = await entrarEnLaPuerta();
      await mandar(cabeceras, [medida()]);
      // A los 3 minutos ya escala, porque el centro dijo 2.
      await pasadaDeGuardia({ prisma, ahora: new Date(Date.now() + 3 * 60_000) });
      expect(await avisos()).toHaveLength(2);
    });
  });

  // ══ 9 · «SIN RED NO SE FINGE» ════════════════════════════════════
  describe("un lote que llega TARDE", () => {
    it("el aviso sale con su hora ORIGINAL y el retraso se ve", async () => {
      await ponerseDeGuardia(tokenEnfermeria, PIN_ROSA);
      const cabeceras = await entrarEnLaPuerta();
      // La tablet lo apuntó hace dos horas y lo sube ahora: es lo que
      // pasa cuando vuelve el wifi.
      const haceDosHoras = new Date(Date.now() - 2 * 3600_000);
      const r = await mandar(cabeceras, [
        medida({ recordedAt: haceDosHoras.toISOString() }),
      ]);
      expect(r.statusCode, r.body).toBe(200);

      const guardia = { "x-device-token": tokenEnfermeria };
      const sesion = await ponerseDeGuardia(tokenEnfermeria, PIN_ROSA);
      const lista = await app.inject({
        method: "GET",
        url: "/residencia/guardia/avisos",
        headers: sesion,
      });
      const a = primera(lista.json().avisos as Array<Record<string, any>>, "el aviso");
      // Los DOS instantes: la hora original y la de salida. El móvil los
      // resta y pinta «llegó 120 min más tarde».
      const apuntado = new Date(a.apuntadoEn).getTime();
      const salido = new Date(a.salidoEn).getTime();
      expect(salido - apuntado).toBeGreaterThan(100 * 60_000);
      expect(guardia["x-device-token"]).toBe(tokenEnfermeria);
    });
  });

  // ══ 10 · LAS AUSENCIAS ═══════════════════════════════════════════
  describe("la pasada de ausencias (D-20)", () => {
    /** Un registro viejo, para que el residente «lleve tiempo aquí». */
    async function registroViejo(clientId: string, dias: number, control: string) {
      const dia = new Date(Date.now() - dias * 86400_000)
        .toISOString()
        .slice(0, 10);
      const id = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO care_records (id, tenant_id, client_id, control_type_id, control_code,
            value_cifrado, recorded_by_user_id, care_role_assignment_id, device_id,
            recorded_at, care_day, occurrence_at)
         SELECT '${id}', '${tenantId}', '${clientId}', ct.id, '${control}',
                'c1:AAAA', '${anaId}',
                (SELECT id FROM care_role_assignments WHERE user_id = '${anaId}' LIMIT 1),
                '${tablet112}', now() - interval '${dias} days', '${dia}',
                now() - interval '${dias} days'
         FROM control_types ct WHERE ct.code = '${control}' AND ct.superseded_at IS NULL LIMIT 1`,
      );
    }

    it("sin deposición más de tres días abre UNA incidencia N1", async () => {
      // Carmen lleva aquí (hay registros de hace diez días) y no tiene
      // ninguna deposición en los tres últimos.
      await registroViejo(carmenId, 10, "HIGIENE_PERSONAL");
      await registroViejo(luisId, 10, "HIGIENE_PERSONAL");
      // Luis sí la tuvo hoy, así que no le toca.
      await registroViejo(luisId, 0, "DEPOSICION");

      const res = await pasadaDeAusencias(prisma, tenantId, new Date());
      expect(res.sinDeposicion).toContain(carmenId);
      expect(res.sinDeposicion).not.toContain(luisId);

      const libro = await incidencias();
      const suya = libro.filter((i) => i.incident_type === "SIN_DEPOSICION");
      expect(suya).toHaveLength(1);
      expect(suya[0]!.severity).toBe("N1");
    });

    it("y NO DUPLICA cada día: la pasada corre otra vez y sigue habiendo una", async () => {
      await registroViejo(carmenId, 10, "HIGIENE_PERSONAL");
      await pasadaDeAusencias(prisma, tenantId, new Date());
      await pasadaDeAusencias(prisma, tenantId, new Date(Date.now() + 3600_000));
      await pasadaDeAusencias(prisma, tenantId, new Date(Date.now() + 86400_000));
      const libro = await incidencias();
      expect(libro.filter((i) => i.incident_type === "SIN_DEPOSICION")).toHaveLength(1);
    });

    it("un residente que ingresó AYER no lleva tres días sin deposición", async () => {
      // Sin registros viejos: nadie debería salir.
      const res = await pasadaDeAusencias(prisma, tenantId, new Date());
      expect(res.sinDeposicion).toEqual([]);
    });
  });

  // ══ 11 · EL CIERRE (D-27, D-28) ══════════════════════════════════
  describe("el cierre", () => {
    /** Abre una incidencia de residente del nivel que haga falta. */
    async function abrir(numero: number): Promise<string> {
      const cabeceras = await entrarEnLaPuerta();
      const r = await mandar(cabeceras, [
        medida({ valor: { tipo: "NUMERIC", numero } }),
      ]);
      return r.json().registros[0].incidencia.id as string;
    }

    async function dejarConstancia(id: string) {
      const r = await app.inject({
        method: "POST",
        url: `/residencia/incidencias/${id}/familia`,
        headers: comoPilar,
        payload: {
          clase: "NO_COMUNICADO",
          contenido: "se le dirá cuando la vea la médica esta tarde",
        },
      });
      expect(r.statusCode, r.body).toBe(201);
    }

    it("una incidencia de residente NO SE CIERRA sin constancia de familia", async () => {
      const id = await abrir(38.6);
      const r = await app.inject({
        method: "POST",
        url: `/residencia/incidencias/${id}/cerrar`,
        headers: comoPilar,
        payload: {},
      });
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json().error).toBe("SIN_CONSTANCIA_DE_FAMILIA");
    });

    it("…y con ella sí, y queda marcada como AUTOCIERRE si la cierra quien la abrió", async () => {
      const id = await abrir(38.6);
      await dejarConstancia(id);
      // La abrió Ana (la auxiliar que firmó el registro), así que Pilar
      // no es «la misma persona»: no es autocierre.
      const r = await app.inject({
        method: "POST",
        url: `/residencia/incidencias/${id}/cerrar`,
        headers: comoPilar,
        payload: {},
      });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().selfClosed).toBe(false);
      const inc = primera(
        await prisma.$queryRawUnsafe<Array<{ open: boolean }>>(
          `SELECT open FROM incidents WHERE id = '${id}'`,
        ),
        "la incidencia",
      );
      expect(inc.open).toBe(false);
    });

    it("un N3 NO lo cierra quien lo abrió (D-28)", async () => {
      // Lo abre Pilar desde el admin, y lo intenta cerrar Pilar.
      const abierto = await app.inject({
        method: "POST",
        url: "/residencia/incidencias",
        headers: comoPilar,
        payload: {
          sujeto: "RESIDENT",
          clientId: carmenId,
          evento: "CAIDA",
          matiz: "CON_GOLPE",
          descripcion: "se cayó en el baño",
        },
      });
      expect(abierto.statusCode, abierto.body).toBe(201);
      expect(abierto.json().nivel).toBe("N3");
      const id = abierto.json().id as string;
      await dejarConstancia(id);

      const r = await app.inject({
        method: "POST",
        url: `/residencia/incidencias/${id}/cerrar`,
        headers: comoPilar,
        payload: {},
      });
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json().error).toBe("CIERRE_EXIGE_OTRA_PERSONA");
      expect(r.json().message).toContain("se queda abierta");
    });

    it("y cerrarla CANCELA lo que quede sonando", async () => {
      const id = await abrir(38.6);
      await dejarConstancia(id);
      expect((await avisos()).some((a) => a.state !== "CANCELLED")).toBe(true);
      await app.inject({
        method: "POST",
        url: `/residencia/incidencias/${id}/cerrar`,
        headers: comoPilar,
        payload: {},
      });
      const as = await avisos();
      expect(as.every((a) => a.state === "CANCELLED")).toBe(true);
    });

    it("una AVERÍA SIN RIESGO nace cerrada: N0 no abre nada (D-27)", async () => {
      const r = await app.inject({
        method: "POST",
        url: "/residencia/incidencias",
        headers: comoPilar,
        payload: {
          sujeto: "MAINTENANCE",
          evento: "AVERIA",
          matiz: "SIN_RIESGO",
          descripcion: "la bombilla del pasillo",
        },
      });
      expect(r.statusCode, r.body).toBe(201);
      expect(r.json().nivel).toBe("N0");
      const inc = primera(
        await prisma.$queryRawUnsafe<Array<{ open: boolean; self_closed: boolean }>>(
          `SELECT open, self_closed FROM incidents WHERE id = '${r.json().id}'`,
        ),
        "la avería",
      );
      expect(inc.open).toBe(false);
      // Y NO se marca como autocierre: en un N0 no hay nada que cerrar.
      expect(inc.self_closed).toBe(false);
      expect(await avisos()).toHaveLength(0);
    });

    it("y una avería PELIGROSA es N2 y suena", async () => {
      const r = await app.inject({
        method: "POST",
        url: "/residencia/incidencias",
        headers: comoPilar,
        payload: {
          sujeto: "MAINTENANCE",
          evento: "AVERIA",
          matiz: "PELIGROSA",
          descripcion: "el asidero del baño de la 112 está suelto",
        },
      });
      expect(r.json().nivel).toBe("N2");
      expect(r.json().avisadoEn.length).toBeGreaterThan(0);
      // Una avería NO exige constancia de familia: no es de nadie.
      const cerrar = await app.inject({
        method: "POST",
        url: `/residencia/incidencias/${r.json().id}/cerrar`,
        headers: comoPilar,
        payload: { nota: "cambiado el asidero" },
      });
      expect(cerrar.statusCode, cerrar.body).toBe(200);
    });
  });

  // ══ 12 · LA EXCEPCIÓN DE UMBRAL (D-22) ═══════════════════════════
  describe("la excepción de umbral", () => {
    const comoSoto = () => ({
      authorization: `Bearer ${signAccessToken({ sub: sotoId, tid: tenantId, role: "CLINICIAN" })}`,
    });
    const comoRosa = () => ({
      authorization: `Bearer ${signAccessToken({ sub: rosaId, tid: tenantId, role: "CLINICIAN" })}`,
    });

    it("sólo la pauta un MEDICO: la DUE recibe la frase", async () => {
      const r = await app.inject({
        method: "POST",
        url: `/residencia/residentes/${carmenId}/umbrales`,
        headers: comoRosa(),
        payload: {
          control: "TEMPERATURA",
          motivo: "paliativo",
          reglas: [{ comparador: "GTE", valor: 38.5, nivel: "N2", tipo: "FIEBRE" }],
        },
      });
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json().error).toBe("EXCEPCION_ES_DEL_MEDICO");
    });

    it("el médico sí, y SUSTITUYE a la de serie", async () => {
      const crear = await app.inject({
        method: "POST",
        url: `/residencia/residentes/${carmenId}/umbrales`,
        headers: comoSoto(),
        payload: {
          control: "TEMPERATURA",
          motivo: "paliativo, febrícula basal de 37,8",
          reglas: [{ comparador: "GTE", valor: 38.5, nivel: "N2", tipo: "FIEBRE" }],
        },
      });
      expect(crear.statusCode, crear.body).toBe(201);

      const cabeceras = await entrarEnLaPuerta();
      // 38,2: de serie sería N2. Con la pauta, nada.
      const a = await mandar(cabeceras, [
        medida({ valor: { tipo: "NUMERIC", numero: 38.2 } }),
      ]);
      expect(a.json().registros[0].incidencia).toBeUndefined();
      // 38,6: sí.
      const b = await mandar(cabeceras, [
        medida({ valor: { tipo: "NUMERIC", numero: 38.6 } }),
      ]);
      expect(b.json().registros[0].incidencia.nivel).toBe("N2");
      // Y la de LUIS, que no tiene pauta, sigue graduando de serie.
      const c = await mandar(cabeceras, [
        medida({ clientId: luisId, valor: { tipo: "NUMERIC", numero: 38.2 } }),
      ]);
      expect(c.json().registros[0].incidencia.nivel).toBe("N2");
    });

    it("CADUCADA, vuelve la de serie sin que nadie haga nada", async () => {
      const crear = await app.inject({
        method: "POST",
        url: `/residencia/residentes/${carmenId}/umbrales`,
        headers: comoSoto(),
        payload: {
          control: "TEMPERATURA",
          motivo: "mientras dure el proceso",
          // Caducó ayer.
          desde: new Date(Date.now() - 10 * 86400_000).toISOString(),
          hasta: new Date(Date.now() - 86400_000).toISOString(),
          reglas: [{ comparador: "GTE", valor: 38.5, nivel: "N2", tipo: "FIEBRE" }],
        },
      });
      expect(crear.statusCode, crear.body).toBe(201);
      const cabeceras = await entrarEnLaPuerta();
      const r = await mandar(cabeceras, [
        medida({ valor: { tipo: "NUMERIC", numero: 38.2 } }),
      ]);
      expect(r.json().registros[0].incidencia.nivel).toBe("N2");
    });

    it("y el motivo va CIFRADO: el claro no está en ninguna tabla", async () => {
      const canario = "CANARIO-PAUTA-paliativo-con-febricula";
      const r = await app.inject({
        method: "POST",
        url: `/residencia/residentes/${carmenId}/umbrales`,
        headers: comoSoto(),
        payload: {
          control: "GLUCEMIA",
          motivo: canario,
          reglas: [],
        },
      });
      expect(r.statusCode, r.body).toBe(201);
      const fila = primera(
        await prisma.$queryRawUnsafe<Array<{ reason_cifrado: string }>>(
          `SELECT reason_cifrado FROM resident_threshold_overrides WHERE id = '${r.json().id}'`,
        ),
        "la excepción",
      );
      expect(fila.reason_cifrado.startsWith("c1:")).toBe(true);
      expect(fila.reason_cifrado).not.toContain(canario);
      // Y se lee descifrado por la ruta.
      const leido = await app.inject({
        method: "GET",
        url: `/residencia/residentes/${carmenId}/umbrales`,
        headers: comoSoto(),
      });
      expect(leido.json().excepciones[0].motivo).toBe(canario);
    });

    it("DOS excepciones que se SOLAPAN no entran, y lo dice el motor", async () => {
      const una = {
        control: "TEMPERATURA",
        motivo: "la primera",
        desde: new Date(Date.now() - 86400_000).toISOString(),
        hasta: new Date(Date.now() + 10 * 86400_000).toISOString(),
        reglas: [],
      };
      const a = await app.inject({
        method: "POST",
        url: `/residencia/residentes/${carmenId}/umbrales`,
        headers: comoSoto(),
        payload: una,
      });
      expect(a.statusCode, a.body).toBe(201);
      const b = await app.inject({
        method: "POST",
        url: `/residencia/residentes/${carmenId}/umbrales`,
        headers: comoSoto(),
        payload: { ...una, motivo: "la segunda" },
      });
      // Lo rechaza el EXCLUDE: dos vigencias solapadas dejarían «¿qué
      // umbral rige hoy?» en manos del orden de la base.
      expect(b.statusCode).toBe(500);
    });
  });

  // ══ 13 · EL LIBRO Y LA FAMILIA ═══════════════════════════════════
  describe("el libro", () => {
    it("la lista trae las ABIERTAS por defecto y NO descifra la descripción", async () => {
      const cabeceras = await entrarEnLaPuerta();
      await mandar(cabeceras, [medida()]);
      const r = await app.inject({
        method: "GET",
        url: "/residencia/incidencias",
        headers: comoPilar,
      });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().incidencias).toHaveLength(1);
      expect(r.json().incidencias[0].nombreDelTipo).toBe("Fiebre");
      expect(r.body).not.toContain("descripcion");
    });

    it("la ficha trae la cronología, los avisos y la constancia", async () => {
      const cabeceras = await entrarEnLaPuerta();
      const puesto = await mandar(cabeceras, [medida()]);
      const id = puesto.json().registros[0].incidencia.id;

      await app.inject({
        method: "POST",
        url: `/residencia/incidencias/${id}/acciones`,
        headers: comoPilar,
        payload: { texto: CANARIO },
      });
      await app.inject({
        method: "POST",
        url: `/residencia/incidencias/${id}/familia`,
        headers: comoPilar,
        payload: {
          clase: "COMUNICADO",
          via: "TELEFONO",
          contacto: "su hija",
          contenido: "le hemos contado lo de la fiebre",
          respuesta: "dice que viene mañana",
        },
      });

      const r = await app.inject({
        method: "GET",
        url: `/residencia/incidencias/${id}`,
        headers: comoPilar,
      });
      expect(r.statusCode, r.body).toBe(200);
      const ficha = r.json();
      expect(ficha.acciones.some((a: { texto: string }) => a.texto === CANARIO)).toBe(
        true,
      );
      expect(ficha.familia[0].contenido).toBe("le hemos contado lo de la fiebre");
      expect(ficha.familia[0].respuesta).toBe("dice que viene mañana");
      expect(ficha.puedeCerrarse).toBe(true);
    });

    it("y una CAÍDA se enlaza con la AVERÍA que la causó (D-35)", async () => {
      const caida = await app.inject({
        method: "POST",
        url: "/residencia/incidencias",
        headers: comoPilar,
        payload: {
          sujeto: "RESIDENT",
          clientId: carmenId,
          evento: "CAIDA",
          matiz: "SIN_GOLPE",
          descripcion: "se cayó al agarrarse",
        },
      });
      const averia = await app.inject({
        method: "POST",
        url: "/residencia/incidencias",
        headers: comoPilar,
        payload: {
          sujeto: "MAINTENANCE",
          evento: "AVERIA",
          matiz: "PELIGROSA",
          descripcion: "el asidero estaba suelto",
        },
      });
      const enlace = await app.inject({
        method: "POST",
        url: `/residencia/incidencias/${caida.json().id}/enlaces`,
        headers: comoPilar,
        payload: { otraId: averia.json().id },
      });
      expect(enlace.statusCode, enlace.body).toBe(201);

      // Y se ve desde LOS DOS lados: el par se guarda una vez y ordenado.
      for (const id of [caida.json().id, averia.json().id]) {
        const f = await app.inject({
          method: "GET",
          url: `/residencia/incidencias/${id}`,
          headers: comoPilar,
        });
        expect(f.json().enlaces).toHaveLength(1);
      }

      // Enlazarlas otra vez no duplica.
      const otra = await app.inject({
        method: "POST",
        url: `/residencia/incidencias/${averia.json().id}/enlaces`,
        headers: comoPilar,
        payload: { otraId: caida.json().id },
      });
      expect(otra.statusCode).toBe(200);
      expect(otra.json().yaEstaba).toBe(true);
    });

    it("el texto de una acción va CIFRADO y el canario no está en ninguna tabla", async () => {
      const cabeceras = await entrarEnLaPuerta();
      const puesto = await mandar(cabeceras, [medida()]);
      const id = puesto.json().registros[0].incidencia.id;
      await app.inject({
        method: "POST",
        url: `/residencia/incidencias/${id}/acciones`,
        headers: comoPilar,
        payload: { texto: CANARIO },
      });

      const tablas = await prisma.$queryRawUnsafe<Array<{ tabla: string; columna: string }>>(
        `SELECT table_name AS tabla, column_name AS columna
         FROM information_schema.columns
         WHERE table_schema = 'public' AND data_type IN ('text','character varying')`,
      );
      const apariciones: string[] = [];
      for (const { tabla, columna } of tablas) {
        const { n } = primera(
          await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
            `SELECT count(*)::bigint AS n FROM "${tabla}" WHERE "${columna}" LIKE '%${CANARIO}%'`,
          ),
          "el conteo",
        );
        if (Number(n) > 0) apariciones.push(`${tabla}.${columna}`);
      }
      expect(apariciones).toEqual([]);
    });
  });

  // ══ 14 · LA TABLA DE SABOTAJES ═══════════════════════════════════
  describe("SABOTAJES", () => {
    let id = "";
    let accionId = "";

    beforeEach(async () => {
      const cabeceras = await entrarEnLaPuerta();
      const r = await mandar(cabeceras, [medida()]);
      id = r.json().registros[0].incidencia.id;
      accionId = primera(
        await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM incident_actions WHERE incident_id = '${id}' LIMIT 1`,
        ),
        "la acción de evidencia",
      ).id;
    });

    it("BORRAR UNA INCIDENCIA por SQL falla", async () => {
      const msg = await debeFallar(`DELETE FROM incidents WHERE id = '${id}'`);
      expect(msg).toContain("una incidencia no se borra");
    });

    it("CAMBIARLE EL NIVEL por SQL… sí se puede, y por eso el nivel no es el sabotaje", async () => {
      // El trigger DEJA cambiar `severity`: es la transición legítima
      // («el nivel cambia por acción firmada»). Lo que no se puede es
      // cambiar lo que PASÓ, y eso es lo de abajo. Se deja escrito para
      // que nadie crea que falta una comprobación.
      await prisma.$executeRawUnsafe(
        `UPDATE incidents SET severity = 'N3' WHERE id = '${id}'`,
      );
      const i = primera(
        await prisma.$queryRawUnsafe<Array<{ severity: string }>>(
          `SELECT severity FROM incidents WHERE id = '${id}'`,
        ),
        "la incidencia",
      );
      expect(i.severity).toBe("N3");
    });

    it("…pero CAMBIARLE EL RESIDENTE falla", async () => {
      const msg = await debeFallar(
        `UPDATE incidents SET client_id = '${luisId}' WHERE id = '${id}'`,
      );
      expect(msg).toContain("una incidencia no se edita");
    });

    it("…y cambiarle EL TIPO también", async () => {
      const msg = await debeFallar(
        `UPDATE incidents SET incident_type = 'CAIDA' WHERE id = '${id}'`,
      );
      expect(msg).toContain("una incidencia no se edita");
    });

    it("…y quién la abrió, también", async () => {
      const msg = await debeFallar(
        `UPDATE incidents SET opened_by_user_id = '${pilarId}' WHERE id = '${id}'`,
      );
      expect(msg).toContain("una incidencia no se edita");
    });

    it("UNA CERRADA no se reabre", async () => {
      await prisma.$executeRawUnsafe(
        `UPDATE incidents SET open = false, closed_at = now(),
            closed_by_user_id = '${pilarId}',
            closed_by_care_role_assignment_id =
              (SELECT id FROM care_role_assignments WHERE user_id = '${pilarId}' LIMIT 1)
         WHERE id = '${id}'`,
      );
      const msg = await debeFallar(
        `UPDATE incidents SET open = true, closed_at = NULL,
            closed_by_user_id = NULL, closed_by_care_role_assignment_id = NULL
         WHERE id = '${id}'`,
      );
      expect(msg).toContain("una incidencia cerrada no se reabre");
    });

    it("UNA ACCIÓN no se edita", async () => {
      const msg = await debeFallar(
        `UPDATE incident_actions SET text_cifrado = 'c1:AAAA' WHERE id = '${accionId}'`,
      );
      expect(msg).toContain("no se edita");
    });

    it("…ni se borra", async () => {
      const msg = await debeFallar(
        `DELETE FROM incident_actions WHERE id = '${accionId}'`,
      );
      expect(msg).toContain("no se borra");
    });

    it("UNA ACCIÓN EN CLARO no cabe", async () => {
      const msg = await debeFallar(
        `INSERT INTO incident_actions (id, tenant_id, incident_id, kind, text_cifrado, by_user_id, by_care_role_assignment_id)
         VALUES ('${randomUUID()}', '${tenantId}', '${id}', 'NOTE', 'le dimos paracetamol', '${pilarId}',
                 (SELECT id FROM care_role_assignments WHERE user_id = '${pilarId}' LIMIT 1))`,
      );
      expect(msg).toContain("incident_actions_text_cifrado_formato");
    });

    it("UNA CONSTANCIA DE FAMILIA no se edita ni se borra", async () => {
      const c = await app.inject({
        method: "POST",
        url: `/residencia/incidencias/${id}/familia`,
        headers: comoPilar,
        payload: { clase: "NO_COMUNICADO", contenido: "se le dirá mañana" },
      });
      const cid = c.json().id;
      expect(
        await debeFallar(`DELETE FROM family_communications WHERE id = '${cid}'`),
      ).toContain("no se borra");
      expect(
        await debeFallar(
          `UPDATE family_communications SET content_cifrado = 'c1:AAAA' WHERE id = '${cid}'`,
        ),
      ).toContain("no se edita");
    });

    it("UN «NO COMUNICADO» CON VÍA no entra", async () => {
      const msg = await debeFallar(
        `INSERT INTO family_communications (id, tenant_id, incident_id, kind, channel, content_cifrado, at, by_user_id, by_care_role_assignment_id)
         VALUES ('${randomUUID()}', '${tenantId}', '${id}', 'NO_COMUNICADO', 'TELEFONO', 'c1:AAAA', now(), '${pilarId}',
                 (SELECT id FROM care_role_assignments WHERE user_id = '${pilarId}' LIMIT 1))`,
      );
      expect(msg).toContain("family_communications_via_coherente");
    });

    it("DOS AVISOS DEL MISMO CANAL para la misma incidencia no entran", async () => {
      const msg = await debeFallar(
        `INSERT INTO guard_alerts (id, tenant_id, incident_id, channel, severity, queued_at)
         VALUES ('${randomUUID()}', '${tenantId}', '${id}', 'ENFERMERIA', 'N2', now())`,
      );
      expect(msg).toContain("already exists");
    });

    it("UN ACUSE A MEDIAS no entra", async () => {
      const a = primera(await avisos(), "el aviso");
      const msg = await debeFallar(
        `UPDATE guard_alerts SET acked_at = now() WHERE id = '${a.id}'`,
      );
      expect(msg).toContain("guard_alerts_acuse_completo");
    });

    it("UNA INCIDENCIA CERRADA SIN AUTOR no entra", async () => {
      const msg = await debeFallar(
        `UPDATE incidents SET open = false, closed_at = now() WHERE id = '${id}'`,
      );
      expect(msg).toContain("incidents_cierre_completo");
    });

    it("UNA DE RESIDENTE SIN RESIDENTE no entra", async () => {
      const msg = await debeFallar(
        `INSERT INTO incidents (id, tenant_id, subject, origin, incident_type, severity, opened_at,
            opened_by_user_id, opened_by_care_role_assignment_id, care_day)
         VALUES ('${randomUUID()}', '${tenantId}', 'RESIDENT', 'DECLARED', 'CAIDA', 'N1', now(), '${pilarId}',
                 (SELECT id FROM care_role_assignments WHERE user_id = '${pilarId}' LIMIT 1), '2026-10-18')`,
      );
      expect(msg).toContain("incidents_sujeto_coherente");
    });

    it("UNA REGLA DE GRAVEDAD DE CENTRO no entra (D-21)", async () => {
      const msg = await debeFallar(
        `INSERT INTO severity_rules (id, scope, version, kind, control_code, comparator, value, severity, incident_type, valid_from)
         VALUES ('${randomUUID()}', 'CENTER', 1, 'THRESHOLD', 'TEMPERATURA', 'GTE', 36, 'N4', 'FIEBRE', now())`,
      );
      expect(msg).toContain("severity_rules_solo_estandar");
    });

    it("UN MÓVIL DE GUARDIA SIN CANAL no entra", async () => {
      const msg = await debeFallar(
        `INSERT INTO devices (id, tenant_id, kind, name, device_token_hash)
         VALUES ('${randomUUID()}', '${tenantId}', 'GUARD', 'sin canal', '${"f".repeat(64)}')`,
      );
      expect(msg).toContain("devices_guard_canal");
    });

    it("UNA PUERTA CON CANAL DE GUARDIA tampoco", async () => {
      const msg = await debeFallar(
        `INSERT INTO devices (id, tenant_id, kind, room_id, guard_channel, name, device_token_hash)
         VALUES ('${randomUUID()}', '${tenantId}', 'ROOM', '${hab112}', 'ENFERMERIA', 'puerta rara', '${"e".repeat(64)}')`,
      );
      expect(msg).toContain("devices_guard_canal");
    });

    it("DOS GUARDIAS VIVAS EN EL MISMO MÓVIL no entran", async () => {
      await ponerseDeGuardia(tokenEnfermeria, PIN_ROSA);
      const msg = await debeFallar(
        `INSERT INTO guard_shift_sessions (id, tenant_id, device_id, channel, user_id, care_role_assignment_id, started_at, care_day)
         VALUES ('${randomUUID()}', '${tenantId}', '${movilEnfermeria}', 'ENFERMERIA', '${pilarId}',
                 (SELECT id FROM care_role_assignments WHERE user_id = '${pilarId}' LIMIT 1), now(), '2026-10-18')`,
      );
      expect(msg).toContain("already exists");
    });

    it("UN ENLACE AL REVÉS no entra: el par va ordenado", async () => {
      const otra = await app.inject({
        method: "POST",
        url: "/residencia/incidencias",
        headers: comoPilar,
        payload: { sujeto: "MAINTENANCE", evento: "AVERIA", matiz: "PELIGROSA" },
      });
      const [a, b] = [id, otra.json().id as string].sort();
      const msg = await debeFallar(
        `INSERT INTO incident_links (id, tenant_id, a_id, b_id)
         VALUES ('${randomUUID()}', '${tenantId}', '${b}', '${a}')`,
      );
      expect(msg).toContain("incident_links_ordenado");
    });
  });

  // ══ 15 · LOS CRUCES ══════════════════════════════════════════════
  describe("los cruces que no pueden pasar", () => {
    it("UN TERMINAL no entra en las rutas de guardia", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/residencia/guardia/me",
        headers: { "x-device-token": tokenTerminal },
      });
      expect(r.statusCode).toBe(403);
      expect(r.json().error).toBe("NOT_A_GUARD_DEVICE");
    });

    it("UNA PUERTA tampoco", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/residencia/guardia/me",
        headers: { "x-device-token": token112 },
      });
      expect(r.statusCode).toBe(403);
      expect(r.json().error).toBe("NOT_A_GUARD_DEVICE");
    });

    it("y UN MÓVIL DE GUARDIA no entra en las de la puerta", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/residencia/puerta/arranque",
        headers: { "x-device-token": tokenEnfermeria },
      });
      expect(r.statusCode).toBe(403);
      expect(r.json().error).toBe("NOT_A_ROOM_DEVICE");
    });

    it("UNA PUERTA NO ACUSA UN AVISO", async () => {
      const cabeceras = await entrarEnLaPuerta();
      await mandar(cabeceras, [medida()]);
      const a = primera(await avisos(), "el aviso");
      const r = await app.inject({
        method: "POST",
        url: `/residencia/guardia/avisos/${a.id}/acuse`,
        headers: cabeceras,
      });
      expect(r.statusCode).toBe(403);
      expect(r.json().error).toBe("NOT_A_GUARD_DEVICE");
    });

    it("EL MÓVIL DE ENFERMERÍA no acusa un aviso de RESPONSABLE", async () => {
      const guardia = await ponerseDeGuardia(tokenEnfermeria, PIN_ROSA);
      const cabeceras = await entrarEnLaPuerta();
      await mandar(cabeceras, [
        medida({
          controlCode: "ALGO_NO_VA_BIEN",
          valor: { tipo: "NOTA", evento: "NO_LOCALIZADO" },
        }),
      ]);
      const resp = (await avisos()).find((a) => a.channel === "RESPONSABLE")!;
      const r = await app.inject({
        method: "POST",
        url: `/residencia/guardia/avisos/${resp.id}/acuse`,
        headers: guardia,
      });
      expect(r.statusCode).toBe(403);
      expect(r.json().error).toBe("AVISO_DE_OTRO_CANAL");
    });

    it("y la PUERTA ve el acuse de su incidencia", async () => {
      const guardia = await ponerseDeGuardia(tokenEnfermeria, PIN_ROSA);
      const cabeceras = await entrarEnLaPuerta();
      const puesto = await mandar(cabeceras, [medida()]);
      const incId = puesto.json().registros[0].incidencia.id;
      const a = primera(await avisos(), "el aviso");
      await app.inject({
        method: "POST",
        url: `/residencia/guardia/avisos/${a.id}/acuse`,
        headers: guardia,
      });
      const r = await app.inject({
        method: "GET",
        url: `/residencia/puerta/incidencias/${incId}`,
        headers: cabeceras,
      });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().avisos[0].acusadoPor).toBe("Rosa");
      // El NOMBRE del rol, que es el de la semilla del centro — no su
      // código. «Lo acusó Rosa, como DUE (enfermería)» es la evidencia;
      // «lo acusó Rosa» no lo es (rama de controles §8).
      expect(r.json().avisos[0].acusadoComo).toContain("DUE");
      // Y NI UNA PALABRA de lo que le pasa: la puerta no descifra la
      // descripción aquí.
      expect(r.body).not.toContain("descripcion");
    });
  });

  // ══ 16 · LA DEVOLUCIÓN DEL ART. 28.3.g ═══════════════════════════
  describe("la devolución del art. 28.3.g", () => {
    it("lleva las incidencias, las acciones, la familia y las excepciones", async () => {
      const cabeceras = await entrarEnLaPuerta();
      const puesto = await mandar(cabeceras, [medida()]);
      const id = puesto.json().registros[0].incidencia.id;
      await app.inject({
        method: "POST",
        url: `/residencia/incidencias/${id}/acciones`,
        headers: comoPilar,
        payload: { texto: CANARIO },
      });
      await app.inject({
        method: "POST",
        url: `/residencia/incidencias/${id}/familia`,
        headers: comoPilar,
        payload: { clase: "NO_COMUNICADO", contenido: "se le dirá mañana" },
      });

      const parte = await parteDeResidencia(prisma, {
        tenantId,
        clientId: carmenId,
      });
      const json = parte.json as {
        incidencias: Array<{
          tipo: string;
          nivel: string;
          acciones: Array<{ texto: string | null }>;
          comunicacionesALaFamilia: Array<{ contenido: string | null }>;
          avisos: Array<{ canal: string; acusadoPor: string | null }>;
        }>;
        excepcionesDeUmbral: unknown[];
      };
      expect(json.incidencias).toHaveLength(1);
      expect(json.incidencias[0]!.tipo).toBe("FIEBRE");
      // DESCIFRADO: es la devolución de SUS datos.
      expect(
        json.incidencias[0]!.acciones.some((a) => a.texto === CANARIO),
      ).toBe(true);
      expect(json.incidencias[0]!.comunicacionesALaFamilia[0]!.contenido).toBe(
        "se le dirá mañana",
      );
      // Y los avisos, incluidos los que nadie acusó: es la prueba de que
      // sonó y de que no fue nadie.
      expect(json.incidencias[0]!.avisos.length).toBeGreaterThan(0);
      expect(json.incidencias[0]!.avisos[0]!.acusadoPor).toBeNull();
    });
  });
});
