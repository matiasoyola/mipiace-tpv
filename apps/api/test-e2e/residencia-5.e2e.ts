// residencia-5 · **EL RELEVO, EL PANEL Y LAS OBLIGACIONES, CONTRA
// POSTGRES.**
//
// Monta las rutas, como `residencia-3` y `residencia-4` y por lo mismo: lo
// que hay que ver es el camino completo —el turno acaba, el sistema
// congela el parte solo, la auxiliar lo lee en la sala con su PIN y lo
// confirma, y el panel de dirección lo enseña— y eso no se ve mirando el
// esquema.
//
// Las garantías, una por bloque:
//
//    1. **El parte se genera solo.** Lo que pasó en el turno sale en él,
//       por planta y residente, y lo que no pasó también («no se hizo»).
//    2. **Un turno sin novedades se genera y se confirma igual.**
//    3. **El congelado NO cambia**: ni por la ruta ni por SQL.
//    4. **El confirmado exige una confirmación por zona con contenido**, o
//       una de alcance total. La DUE confirma el suyo.
//    5. **Una auxiliar no ve zonas que no son suyas** (D-51).
//    6. **Confirmar dos veces no duplica**, y la hora que manda es la de
//       la tablet.
//    7. **«Llegó después del relevo»**: un registro que sube con el parte
//       ya congelado se añade aparte, con su hora, y **deshace el «no
//       hecho»** en todo lo que se calcule después.
//    8. **Las obligaciones**: cada periodicidad genera lo suyo, la
//       vigencia avisa a 60 días, marcar hecha firma y una vencida sale en
//       el panel. Y una hecha no vuelve a pendiente sin corrección.
//    9. **Los indicadores** contra un mes sembrado, con el resultado
//       calculado a mano.
//   10. **El panel** contesta las cinco preguntas en una llamada.
//   11. **La tabla de sabotajes** contra el motor.
//   12. Y **los cruces**: un TERMINAL contra la sala, una puerta
//       confirmando, la sala contra las rutas de la puerta, un tenant sin
//       residencia.

import { createHash, randomBytes, randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { E2E_DATABASE_URL, e2eEnabled, SKIP_MESSAGE } from "./e2e-env.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  E2E_DATABASE_URL || "postgresql://e2e:e2e@127.0.0.1:5432/e2e";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET = "g".repeat(40);
process.env.JWT_REFRESH_SECRET = "h".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

// El Redis en memoria de la suite. Ver `redis-falso.ts` para por qué hace
// falta y por qué no está copiado aquí.
vi.mock("../src/context.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/context.js")>();
  const { redisFalso } = await import("./redis-falso.js");
  const falso = redisFalso();
  return {
    ...original,
    getRedis: () => falso as unknown as ReturnType<typeof original.getRedis>,
  };
});

const { getPrisma, shutdown } = await import("../src/context.js");
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
const { registerResidenciaResidentesRoutes } = await import(
  "../src/residencia/residentes-routes.js"
);
const { registerResidenciaSalaRoutes } = await import(
  "../src/residencia/sala-routes.js"
);
const { registerResidenciaPanelRoutes } = await import(
  "../src/residencia/panel-routes.js"
);
const { registerResidenciaObligacionesRoutes } = await import(
  "../src/residencia/obligaciones-routes.js"
);
const { registerResidenciaGuardiaRoutes } = await import(
  "../src/residencia/guardia-routes.js"
);
// El PIN de cuidado se pone desde la ficha (residencia-3).
const { registerResidenciaFichaRoutes } = await import(
  "../src/residencia/ficha-routes.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");
const { olvidarClaves } = await import("../src/clinica/claves.js");
const { olvidarEstado } = await import("../src/clinica/contrato.js");
const { construirParte, congelarParte, ventanaDelTurno } = await import(
  "../src/residencia/relevo.js"
);
const { pasadaDeRelevo } = await import("../src/residencia/pasada-de-relevo.js");
const { parteDeResidencia } = await import("../src/residencia/exportacion.js");
const { ocurrenciasDeObligacion, wallTimeToUtc } = await import(
  "@mipiacetpv/residencia-plan"
);

const PIN_ANA = "4071"; // auxiliar, PRIMERA planta
const PIN_MARI = "7788"; // auxiliar, SEGUNDA planta
const PIN_ROSA = "9182"; // DUE, alcance total
const PIN_PILAR = "3344"; // dirección

/** El canario de este fichero: si aparece en claro en un volcado, el
 *  bloque no sirve. Es el texto de «algo no va bien», que entra en el
 *  parte y por tanto en `handovers.content_cifrado`. */
const CANARIO = "CANARIO-RELEVO-no-ha-querido-desayunar-y-esta-callada";

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

/** Y uno que tiene que PASAR. */
async function debePasar(sql: string): Promise<void> {
  await getPrisma().$executeRawUnsafe(sql);
}

describe.skipIf(!e2eEnabled)("e2e · el relevo, el panel y las obligaciones", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let app: FastifyInstance;
  let tenantId = "";
  let otroTenant = "";
  let pilarId = "";
  let anaId = "";
  let mariId = "";
  let rosaId = "";
  let planta1 = "";
  let planta2 = "";
  let hab112 = "";
  let hab201 = "";
  let carmenId = "";
  let antonioId = "";
  let token112 = "";
  let tokenSala = "";
  let tokenTerminal = "";
  let tokenGuardia = "";
  let turnos: Array<{ id: string; code: string; starts_at: string; ends_at: string }> = [];
  let comoPilar: Record<string, string> = {};
  /** El día del centro que se usa de escenario: AYER. */
  let ayer = "";

  // ── Ayudas ────────────────────────────────────────────────────────

  async function entrarEnLaSala(pin: string): Promise<Record<string, string>> {
    const r = await app.inject({
      method: "POST",
      url: "/residencia/sala/pin",
      headers: { "x-device-token": tokenSala },
      payload: { pin },
    });
    expect(r.statusCode, r.body).toBe(200);
    return {
      "x-device-token": tokenSala,
      authorization: `Bearer ${r.json().token}`,
    };
  }

  function turno(code: string) {
    const t = turnos.find((x) => x.code === code)!;
    return { id: t.id, code: t.code, name: code, startsAt: t.starts_at, endsAt: t.ends_at };
  }

  /** Los partes congelados de este centro. */
  async function partes(): Promise<
    Array<{
      id: string;
      care_day: string;
      code: string;
      lineas: number;
      sin_novedades: boolean;
      confirmed_at: Date | null;
    }>
  > {
    return prisma.$queryRawUnsafe(
      `SELECT h.id, h.care_day, s.code, h.lineas, h.sin_novedades, h.confirmed_at
       FROM handovers h JOIN center_shifts s ON s.id = h.center_shift_id
       WHERE h.tenant_id = '${tenantId}' ORDER BY h.frozen_at`,
    );
  }

  beforeAll(async () => {
    await cargarCatalogoDeSerie();
    await cargarPlantillaDeGravedad();

    tenantId = randomUUID();
    otroTenant = randomUUID();
    pilarId = randomUUID();
    anaId = randomUUID();
    mariId = randomUUID();
    rosaId = randomUUID();

    await prisma.$executeRawUnsafe(
      `INSERT INTO tenants (id, name, residencia_enabled, clinical_records_enabled, crm_enabled, agenda_enabled, caja_enabled, updated_at)
       VALUES ('${tenantId}', 'Jardín de Gredos', true, true, true, true, false, now())`,
    );
    // Un tenant SIN residencia, para el cruce de siempre.
    await prisma.$executeRawUnsafe(
      `INSERT INTO tenants (id, name, residencia_enabled, clinical_records_enabled, caja_enabled, updated_at)
       VALUES ('${otroTenant}', 'Bar Manolo', false, false, true, now())`,
    );
    for (const [u, alias, rol] of [
      [pilarId, "Pilar", "OWNER"],
      [anaId, "Ana", "CLINICIAN"],
      [mariId, "Mari", "CLINICIAN"],
      [rosaId, "Rosa", "CLINICIAN"],
    ] as const) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO users (id, tenant_id, email, alias, role, is_clinician, clinical_scope)
         VALUES ('${u}', '${tenantId}', '${alias.toLowerCase()}@gredos.es', '${alias}', '${rol}', true, 'SELECTION')`,
      );
    }
    await sembrarResidencia(prisma as never, tenantId);
    for (const [u, code] of [
      [pilarId, "DIRECCION"],
      [anaId, "AUXILIAR"],
      [mariId, "AUXILIAR"],
      [rosaId, "DUE"],
    ] as const) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO care_role_assignments (id, tenant_id, user_id, care_role_id, from_at, granted_by_user_id)
         SELECT '${randomUUID()}', '${tenantId}', '${u}', id, now() - interval '400 days', '${pilarId}'
         FROM care_roles WHERE tenant_id = '${tenantId}' AND code = '${code}'`,
      );
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO clinical_processor_agreements (id, tenant_id, version, text_sha256, user_id, at)
       VALUES ('${randomUUID()}', '${tenantId}', 1, '${"a".repeat(64)}', '${pilarId}', now())`,
    );

    // ── DOS plantas: es lo que hace que «cada zona con contenido
    //    necesita su confirmación» se pueda probar.
    planta1 = randomUUID();
    planta2 = randomUUID();
    hab112 = randomUUID();
    hab201 = randomUUID();
    const cama112 = randomUUID();
    const cama201 = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO floors (id, tenant_id, name, sort_order, updated_at)
       VALUES ('${planta1}', '${tenantId}', 'Primera', 1, now()),
              ('${planta2}', '${tenantId}', 'Segunda', 2, now())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO rooms (id, tenant_id, floor_id, number, active, updated_at)
       VALUES ('${hab112}', '${tenantId}', '${planta1}', '112', true, now()),
              ('${hab201}', '${tenantId}', '${planta2}', '201', true, now())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO beds (id, tenant_id, room_id, label, active, updated_at)
       VALUES ('${cama112}', '${tenantId}', '${hab112}', 'A', true, now()),
              ('${cama201}', '${tenantId}', '${hab201}', 'A', true, now())`,
    );
    // Ana cubre la primera; Mari, la segunda.
    await prisma.$executeRawUnsafe(
      `INSERT INTO care_zone_assignments (id, tenant_id, user_id, floor_id, from_at, granted_by_user_id)
       VALUES ('${randomUUID()}', '${tenantId}', '${anaId}', '${planta1}', now() - interval '30 days', '${pilarId}'),
              ('${randomUUID()}', '${tenantId}', '${mariId}', '${planta2}', now() - interval '30 days', '${pilarId}')`,
    );

    comoPilar = {
      authorization: `Bearer ${signAccessToken({ sub: pilarId, tid: tenantId, role: "OWNER" })}`,
    };

    app = Fastify({ logger: false });
    await registerResidenciaPuertaRegistroRoutes(app);
    await registerResidenciaIncidenciasRoutes(app);
    await registerResidenciaResidentesRoutes(app);
    await registerResidenciaGuardiaRoutes(app);
    await registerResidenciaSalaRoutes(app);
    await registerResidenciaPanelRoutes(app);
    await registerResidenciaObligacionesRoutes(app);
    await registerResidenciaFichaRoutes(app);
    await app.ready();

    for (const [nombre, cama] of [
      ["Carmen", cama112],
      ["Antonio", cama201],
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
      else antonioId = id;
    }

    // La puerta de la 112.
    token112 = randomBytes(24).toString("hex");
    await prisma.$executeRawUnsafe(
      `INSERT INTO devices (id, tenant_id, kind, room_id, register_id, name, device_token_hash)
       VALUES ('${randomUUID()}', '${tenantId}', 'ROOM', '${hab112}', NULL, 'Puerta 112',
               '${createHash("sha256").update(token112, "utf8").digest("hex")}')`,
    );

    // ── LA TABLET DE LA SALA, POR LA RUTA DE VERDAD ────────────────
    //
    // Se empareja con `POST /devices/pair` y no con un INSERT, que es
    // justo lo que residencia-4 NO hizo con los móviles de guardia — y por
    // eso su fallo (el canal que no se copiaba) no salió hasta este
    // bloque. Aquí se prueba el camino que la APK usa.
    {
      const codigo = await app.inject({
        method: "POST",
        url: "/residencia/sala/pairing-codes",
        headers: comoPilar,
        payload: {},
      });
      expect(codigo.statusCode, codigo.body).toBe(201);
      expect(codigo.json().kind).toBe("HANDOVER");
      const { registerDeviceRoutes } = await import("../src/devices/routes.js");
      const emparejador = Fastify({ logger: false });
      await registerDeviceRoutes(emparejador);
      await emparejador.ready();
      const par = await emparejador.inject({
        method: "POST",
        url: "/devices/pair",
        payload: { code: codigo.json().code, deviceName: "Tablet de la sala" },
      });
      expect(par.statusCode, par.body).toBe(201);
      expect(par.json().kind).toBe("HANDOVER");
      tokenSala = par.json().deviceToken as string;
      await emparejador.close();
    }

    // Un TERMINAL y un móvil de guardia, para los cruces.
    const storeId = randomUUID();
    const registerId = randomUUID();
    tokenTerminal = randomBytes(24).toString("hex");
    tokenGuardia = randomBytes(24).toString("hex");
    await prisma.$executeRawUnsafe(
      `INSERT INTO stores (id, tenant_id, name) VALUES ('${storeId}', '${tenantId}', 'Office')`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO registers (id, store_id, name) VALUES ('${registerId}', '${storeId}', 'Caja')`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO devices (id, tenant_id, kind, register_id, name, device_token_hash)
       VALUES ('${randomUUID()}', '${tenantId}', 'TERMINAL', '${registerId}', 'Terminal',
               '${createHash("sha256").update(tokenTerminal, "utf8").digest("hex")}')`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO devices (id, tenant_id, kind, room_id, register_id, guard_channel, name, device_token_hash)
       VALUES ('${randomUUID()}', '${tenantId}', 'GUARD', NULL, NULL, 'ENFERMERIA', 'Móvil',
               '${createHash("sha256").update(tokenGuardia, "utf8").digest("hex")}')`,
    );

    turnos = await prisma.$queryRawUnsafe(
      `SELECT id, code, starts_at, ends_at FROM center_shifts WHERE tenant_id = '${tenantId}'`,
    );

    for (const [u, pin] of [
      [anaId, PIN_ANA],
      [mariId, PIN_MARI],
      [rosaId, PIN_ROSA],
      [pilarId, PIN_PILAR],
    ] as const) {
      const r = await app.inject({
        method: "PUT",
        url: `/residencia/personal/${u}/pin-de-puerta`,
        headers: comoPilar,
        payload: { pin },
      });
      expect(r.statusCode, r.body).toBe(200);
    }

    ayer = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10);
  });

  afterAll(async () => {
    await app?.close();
    const t = tenantId;
    for (const [tabla, trigger] of [
      ["handover_late_additions", "handover_late_additions_append_only"],
      ["handover_ack_zones", "handover_ack_zones_append_only"],
      ["handover_acks", "handover_acks_append_only"],
      ["handover_zones", "handover_zones_append_only"],
      ["handovers", "handovers_inmutable"],
      ["incident_actions", "incident_actions_append_only"],
      ["incidents", "incidents_inmutable"],
      ["care_records", "care_records_inmutable"],
    ] as const) {
      await prisma.$executeRawUnsafe(`ALTER TABLE ${tabla} DISABLE TRIGGER ${trigger}`);
    }
    for (const tabla of [
      "handover_late_additions",
      "handover_ack_zones",
      "handover_acks",
      "handover_zones",
      "handovers",
      "duty_occurrences",
      "management_duties",
      "indicator_targets",
      "guard_alerts",
      "guard_shift_sessions",
      "center_guard_settings",
      "family_communications",
      "incident_actions",
      "incident_links",
      "incidents",
      "care_records",
      "care_pins",
      "care_plan_items",
      "care_zone_assignments",
      "care_role_assignments",
      "bed_assignments",
    ]) {
      await prisma.$executeRawUnsafe(`DELETE FROM ${tabla} WHERE tenant_id = '${t}'`);
    }
    for (const [tabla, trigger] of [
      ["handover_late_additions", "handover_late_additions_append_only"],
      ["handover_ack_zones", "handover_ack_zones_append_only"],
      ["handover_acks", "handover_acks_append_only"],
      ["handover_zones", "handover_zones_append_only"],
      ["handovers", "handovers_inmutable"],
      ["incident_actions", "incident_actions_append_only"],
      ["incidents", "incidents_inmutable"],
      ["care_records", "care_records_inmutable"],
    ] as const) {
      await prisma.$executeRawUnsafe(`ALTER TABLE ${tabla} ENABLE TRIGGER ${trigger}`);
    }
    await prisma.$executeRawUnsafe(
      `ALTER TABLE client_consents DISABLE TRIGGER client_consents_append_only`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM client_consents WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE client_consents ENABLE TRIGGER client_consents_append_only`,
    );
    // El registro de accesos ANTES de los clientes: su FK es `RESTRICT`
    // (clinica-1) porque es la prueba de quién miró. Y es append-only,
    // así que hay que apartar su trigger — lo mismo que hace
    // `clinica-7.e2e.ts` en su limpieza.
    await prisma.$executeRawUnsafe(
      `ALTER TABLE clinical_access_log DISABLE TRIGGER clinical_access_log_append_only`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM clinical_access_log WHERE tenant_id = '${t}'`,
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE clinical_access_log ENABLE TRIGGER clinical_access_log_append_only`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM resident_profiles WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM clients WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM devices WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM pairing_codes WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM beds WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM rooms WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM floors WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM center_shifts WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM center_moments WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(
      `DELETE FROM care_plan_template_items WHERE tenant_id = '${t}'`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM center_control_settings WHERE tenant_id = '${t}'`,
    );
    // Los roles de SERIE no se borran: lo para
    // `care_roles_de_serie_son_fijos` (residencia-1). Se aparta igual que
    // residencia-4 en su limpieza.
    await prisma.$executeRawUnsafe(
      `ALTER TABLE care_roles DISABLE TRIGGER care_roles_de_serie_son_fijos`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM care_roles WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE care_roles ENABLE TRIGGER care_roles_de_serie_son_fijos`,
    );
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
    await prisma.$executeRawUnsafe(`DELETE FROM users WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM registers WHERE store_id IN (SELECT id FROM stores WHERE tenant_id = '${t}')`);
    await prisma.$executeRawUnsafe(`DELETE FROM stores WHERE tenant_id = '${t}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM tenants WHERE id IN ('${t}', '${otroTenant}')`);
    olvidarClaves();
    olvidarEstado();
    await shutdown();
  });

  // ══ 1 · EL PARTE SE GENERA SOLO ══════════════════════════════════

  describe("el parte de un turno", () => {
    it("un turno SIN NOVEDADES se genera, y lo dice", async () => {
      // El turno de noche de ayer: nadie registró nada, nadie declaró
      // nada. El parte existe igual y dice «sin novedades» — el
      // denominador cuenta tanto como lo que pasa (D-16).
      //
      // **Salvo el «no hecho»**: el plan de un dependiente tiene cuidados
      // de noche, así que para que esto sea de verdad «sin novedades» hay
      // que mirar un turno sin plan. Se usa el de noche de ANTEAYER, antes
      // del ingreso de los residentes (01-09 es su `admissionDate`, así
      // que aquí se usa una ventana anterior a cualquier línea del plan).
      const anteayer = new Date(Date.now() - 48 * 3600_000).toISOString().slice(0, 10);
      // Las líneas del plan nacen con el ingreso de hoy, así que un día de
      // hace tres meses no tiene ninguna ocurrencia.
      const haceTresMeses = new Date(Date.now() - 90 * 24 * 3600_000)
        .toISOString()
        .slice(0, 10);
      void anteayer;
      const parte = await construirParte(prisma, {
        tenantId,
        turno: turno("N"),
        careDay: haceTresMeses,
        corte: ventanaDelTurno(turno("N"), haceTresMeses).hasta,
        ahora: new Date(),
      });
      expect(parte.sinNovedades).toBe(true);
      expect(parte.lineas).toBe(0);
      expect(parte.zonas).toEqual([]);
    });

    it("y lo que PASÓ sale por planta y residente", async () => {
      // La mañana de ayer: una caída N3 de doña Carmen (primera planta) y
      // una avería del office (de nadie → zona del centro).
      const manana = turno("M");
      const { desde } = ventanaDelTurno(manana, ayer);
      const aLas = (h: number, m: number): Date =>
        new Date(desde.getTime() + (h * 60 + m) * 60_000);

      const rolAna = primera(
        await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT a.id FROM care_role_assignments a JOIN care_roles r ON r.id = a.care_role_id
           WHERE a.user_id = '${anaId}' AND r.code = 'AUXILIAR'`,
        ),
        "el rol de Ana",
      ).id;

      for (const [cliente, tipo, nivel, subject, minutos] of [
        [carmenId, "CAIDA", "N3", "RESIDENT", 160],
        [null, "AVERIA", "N2", "MAINTENANCE", 80],
      ] as const) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO incidents (id, tenant_id, subject, client_id, origin, incident_type,
             severity, template_version, opened_at, created_at, opened_by_user_id,
             opened_by_care_role_assignment_id, center_shift_id, care_day, open)
           VALUES ('${randomUUID()}', '${tenantId}', '${subject}',
                   ${cliente == null ? "NULL" : `'${cliente}'`},
                   'DECLARED', '${tipo}', '${nivel}', 1,
                   '${aLas(2, minutos % 60).toISOString()}',
                   '${aLas(2, minutos % 60).toISOString()}',
                   '${anaId}', '${rolAna}', '${manana.id}', '${ayer}', true)`,
        );
      }

      const parte = await construirParte(prisma, {
        tenantId,
        turno: manana,
        careDay: ayer,
        corte: ventanaDelTurno(manana, ayer).hasta,
        ahora: new Date(),
      });

      expect(parte.sinNovedades).toBe(false);
      // Tres zonas: las dos plantas (por el «no hecho» del plan) y la del
      // centro (la avería).
      const nombres = parte.zonas.map((z) => z.nombre);
      expect(nombres).toContain("Primera");
      expect(nombres).toContain("Del centro");

      const primeraPlanta = parte.zonas.find((z) => z.floorId === planta1)!;
      const carmen = primeraPlanta.residentes.find((r) => r.clientId === carmenId)!;
      expect(carmen.habitacion).toBe("112");
      // La caída, con su nivel y arriba: el orden es por urgencia.
      expect(carmen.lineas[0]!.clase).toBe("INCIDENCIA_NUEVA");
      expect(carmen.lineas[0]!.nivel).toBe("N3");
      expect(carmen.lineas[0]!.texto).toContain("Caída");
      // Y lo que no se hizo, debajo.
      expect(carmen.lineas.some((l) => l.clase === "NO_HECHO")).toBe(true);

      // La avería es de la zona del centro y NO de ningún residente.
      const centro = parte.zonas.find((z) => z.floorId === null)!;
      expect(centro.residentes).toEqual([]);
      expect(centro.sueltas[0]!.texto).toContain("Avería");
    });

    it("el corte NO pasa del final del turno", async () => {
      // La tarea puede correr a las 15:00:04 y el parte de la mañana acaba
      // a las 15:00 en punto. Sin esto, el parte se llevaría los cuatro
      // segundos de propina y dejaría de ser «lo que pasó en el turno».
      const manana = turno("M");
      const { hasta } = ventanaDelTurno(manana, ayer);
      const parte = await construirParte(prisma, {
        tenantId,
        turno: manana,
        careDay: ayer,
        corte: new Date(hasta.getTime() + 4000),
        ahora: new Date(),
      });
      expect(parte.corte).toBe(hasta.toISOString());
    });
  });

  // ══ 2 · CONGELAR ════════════════════════════════════════════════

  describe("congelar el parte", () => {
    it("la pasada congela los turnos cerrados de las últimas 24 h", async () => {
      // Y no «el que acaba de cerrar»: un despliegue de siete minutos a
      // las 15:00 dejaría al centro sin el parte de la mañana para
      // siempre.
      const r = await pasadaDeRelevo({ prisma, ahora: new Date() });
      expect(r.errores).toBe(0);
      const congelados = await partes();
      // Los turnos cerrados de las últimas 24 h: al menos dos.
      expect(congelados.length).toBeGreaterThanOrEqual(2);
      expect(congelados.some((p) => p.care_day === ayer)).toBe(true);
    });

    it("correrla DOS VECES no congela dos partes", async () => {
      const antes = (await partes()).length;
      await pasadaDeRelevo({ prisma, ahora: new Date() });
      expect((await partes()).length).toBe(antes);
    });

    it("y el contenido va CIFRADO: el canario no aparece en claro", async () => {
      // Se escribe un «algo no va bien» con el canario dentro, se congela
      // el parte de ese turno y se busca el canario en TODAS las columnas
      // de texto de la base.
      const manana = turno("M");
      const cabeceras = {
        "x-device-token": token112,
        authorization: `Bearer ${
          (
            await app.inject({
              method: "POST",
              url: "/residencia/puerta/pin",
              headers: { "x-device-token": token112 },
              payload: { pin: PIN_ANA },
            })
          ).json().token
        }`,
      };
      // **Dentro de la ventana de la mañana**, no «ahora»: la suite puede
      // correr a las ocho de la tarde, y un registro de las 20:10
      // adscrito al turno de mañana no cae en su ventana — así que no
      // saldría en el parte de la mañana y el canario no estaría donde el
      // test lo busca. Es el mismo cuidado que el sembrador.
      const hoy = new Date().toISOString().slice(0, 10);
      const alasDiez = wallTimeToUtc(hoy, "10:00");
      const r = await app.inject({
        method: "POST",
        url: "/residencia/puerta/registros",
        headers: cabeceras,
        payload: {
          registros: [
            {
              id: randomUUID(),
              clientId: carmenId,
              controlCode: "ALGO_NO_VA_BIEN",
              recordedAt: alasDiez.toISOString(),
              centerShiftId: manana.id,
              careDay: hoy,
              valor: { tipo: "NOTA" },
              nota: CANARIO,
            },
          ],
        },
      });
      // 200 o 201: la ruta del lote contesta 200 cuando lo que entra
      // declara una incidencia (residencia-4) y 201 cuando no. Lo que
      // importa aquí es que se guardó.
      expect([200, 201], r.body).toContain(r.statusCode);

      // El parte de HOY de ese turno, con el corte en «ahora» para que el
      // registro entre.
      const parte = await construirParte(prisma, {
        tenantId,
        turno: manana,
        careDay: hoy,
        corte: new Date(),
        ahora: new Date(),
      });
      const texto = JSON.stringify(parte);
      // Está en el parte en claro EN MEMORIA —es lo que la sala pinta—…
      expect(texto).toContain(CANARIO);

      // …y en la base, en ninguna columna de texto.
      const columnas = await prisma.$queryRawUnsafe<
        Array<{ table_name: string; column_name: string }>
      >(
        `SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND data_type IN ('text','character varying')`,
      );
      for (const c of columnas) {
        const filas = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
          `SELECT count(*)::bigint AS n FROM "${c.table_name}"
           WHERE "${c.column_name}" LIKE '%${CANARIO}%'`,
        );
        expect(
          Number(primera(filas).n),
          `${c.table_name}.${c.column_name} lleva el canario EN CLARO`,
        ).toBe(0);
      }
    });
  });

  // ══ 3 · LA SALA ═════════════════════════════════════════════════

  describe("la tablet de la sala", () => {
    it("en reposo NO enseña nada de salud", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/residencia/sala/me",
        headers: { "x-device-token": tokenSala },
      });
      expect(r.statusCode, r.body).toBe(200);
      const crudo = r.body;
      // Ni un nombre de residente, ni un nivel, ni una línea del parte.
      expect(crudo).not.toContain("Carmen");
      expect(crudo).not.toContain("Antonio");
      expect(crudo).not.toContain("N3");
      expect(crudo).not.toContain(CANARIO);
      // Lo que SÍ: centro, turno, hora y el recuento de zonas.
      const j = r.json();
      expect(j.centro.nombre).toBe("Jardín de Gredos");
      expect(j.relevo).not.toBeNull();
      expect(typeof j.relevo.zonasPorConfirmar).toBe("number");
    });

    it("el PIN abre el parte, y la DUE lo ve ENTERO", async () => {
      const comoRosa = await entrarEnLaSala(PIN_ROSA);
      const r = await app.inject({
        method: "GET",
        url: "/residencia/sala/relevo",
        headers: comoRosa,
      });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().alcanceTotal).toBe(true);
      const zonas = r.json().relevo.parte.zonas as Array<{ floorId: string | null }>;
      // La DUE ve las dos plantas y la del centro.
      expect(zonas.some((z) => z.floorId === planta1)).toBe(true);
      expect(zonas.some((z) => z.floorId === null)).toBe(true);
    });

    it("una auxiliar NO ve zonas que no son suyas (D-51)", async () => {
      const comoAna = await entrarEnLaSala(PIN_ANA);
      const r = await app.inject({
        method: "GET",
        url: "/residencia/sala/relevo",
        headers: comoAna,
      });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().alcanceTotal).toBe(false);
      const zonas = r.json().relevo.parte.zonas as Array<{ floorId: string | null }>;
      expect(zonas.every((z) => z.floorId === planta1)).toBe(true);
      // Ni el nombre de Antonio, que es de la segunda planta.
      expect(r.body).not.toContain("Antonio");
      // Ni la zona del centro: lo del centro no es de ninguna auxiliar.
      expect(zonas.some((z) => z.floorId === null)).toBe(false);
    });

    it("«Leído y recibido» firma persona, capacidad y hora", async () => {
      const comoAna = await entrarEnLaSala(PIN_ANA);
      const elParte = primera(await partes(), "un parte congelado");
      const r = await app.inject({
        method: "POST",
        url: `/residencia/sala/relevo/${elParte.id}/confirmar`,
        headers: comoAna,
        payload: {},
      });
      expect(r.statusCode, r.body).toBe(201);
      const fila = primera(
        await prisma.$queryRawUnsafe<
          Array<{
            user_id: string;
            care_role_assignment_id: string;
            alcance_total: boolean;
            at: Date;
          }>
        >(
          `SELECT user_id, care_role_assignment_id, alcance_total, at
           FROM handover_acks WHERE handover_id = '${elParte.id}'`,
        ),
        "la confirmación",
      );
      expect(fila.user_id).toBe(anaId);
      expect(fila.care_role_assignment_id).not.toBeNull();
      expect(fila.alcance_total).toBe(false);
      // Y las zonas que abarcaba.
      const zonas = await prisma.$queryRawUnsafe<Array<{ floor_id: string }>>(
        `SELECT z.floor_id FROM handover_ack_zones z
         JOIN handover_acks a ON a.id = z.ack_id
         WHERE a.handover_id = '${elParte.id}'`,
      );
      expect(zonas.map((z) => z.floor_id)).toEqual([planta1]);
    });

    it("con la primera planta confirmada, el parte NO está confirmado todavía", async () => {
      // La segunda planta tiene contenido y la zona del centro también.
      const elParte = primera(await partes());
      const fila = primera(
        await prisma.$queryRawUnsafe<Array<{ confirmed_at: Date | null }>>(
          `SELECT confirmed_at FROM handovers WHERE id = '${elParte.id}'`,
        ),
      );
      expect(fila.confirmed_at).toBeNull();
    });

    it("y la DUE, con alcance total, lo confirma ENTERO (D-58)", async () => {
      const comoRosa = await entrarEnLaSala(PIN_ROSA);
      const elParte = primera(await partes());
      const r = await app.inject({
        method: "POST",
        url: `/residencia/sala/relevo/${elParte.id}/confirmar`,
        headers: comoRosa,
        payload: {},
      });
      expect(r.statusCode, r.body).toBe(201);
      expect(r.json().confirmado).toBe(true);
      const fila = primera(
        await prisma.$queryRawUnsafe<Array<{ confirmed_at: Date | null }>>(
          `SELECT confirmed_at FROM handovers WHERE id = '${elParte.id}'`,
        ),
      );
      expect(fila.confirmed_at).not.toBeNull();
    });

    it("confirmar DOS VECES no duplica, y contesta la que había", async () => {
      const comoAna = await entrarEnLaSala(PIN_ANA);
      const elParte = primera(await partes());
      const r = await app.inject({
        method: "POST",
        url: `/residencia/sala/relevo/${elParte.id}/confirmar`,
        headers: comoAna,
        payload: {},
      });
      // 200 y no 201: ya estaba. La cola necesita un 2xx para borrar el
      // item; un error la dejaría reintentando para siempre.
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().yaEstaba).toBe(true);
      const n = primera(
        await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
          `SELECT count(*)::bigint AS n FROM handover_acks
           WHERE handover_id = '${elParte.id}' AND user_id = '${anaId}'`,
        ),
      );
      expect(Number(n.n)).toBe(1);
    });

    it("la confirmación que llegó SIN RED sale con SU hora, no con la de llegada", async () => {
      // La tablet la encoló a las 15:04 y el wifi volvió a las 15:51. Los
      // dos instantes quedan, y el que manda es el de la tablet.
      const comoMari = await entrarEnLaSala(PIN_MARI);
      const elParte = primera(await partes());
      const hace47min = new Date(Date.now() - 47 * 60_000);
      const r = await app.inject({
        method: "POST",
        url: `/residencia/sala/relevo/${elParte.id}/confirmar`,
        headers: comoMari,
        payload: { at: hace47min.toISOString() },
      });
      expect(r.statusCode, r.body).toBe(201);
      const fila = primera(
        await prisma.$queryRawUnsafe<Array<{ at: Date; received_at: Date }>>(
          `SELECT at, received_at FROM handover_acks
           WHERE handover_id = '${elParte.id}' AND user_id = '${mariId}'`,
        ),
      );
      expect(fila.at.toISOString()).toBe(hace47min.toISOString());
      // Y el de llegada es de ahora: los dos se separan, que es lo que
      // hace visible el punto muerto del wifi.
      expect(fila.received_at.getTime() - fila.at.getTime()).toBeGreaterThan(
        40 * 60_000,
      );
    });

    it("una confirmación del FUTURO se rechaza", async () => {
      const comoAna = await entrarEnLaSala(PIN_ANA);
      const elParte = primera(await partes());
      const r = await app.inject({
        method: "POST",
        url: `/residencia/sala/relevo/${elParte.id}/confirmar`,
        headers: comoAna,
        payload: { at: new Date(Date.now() + 3 * 3600_000).toISOString() },
      });
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toBe("CONFIRMACION_EN_EL_FUTURO");
    });
  });

  // ══ 4 · LO QUE LLEGÓ DESPUÉS ════════════════════════════════════

  describe("«llegó después del relevo»", () => {
    it("el parte de la mañana de ayer se congela (fuera de la ventana de rescate)", async () => {
      // La pasada mira **las últimas 24 h** de turnos cerrados, y la
      // mañana de ayer acabó hace más de eso si la suite corre por la
      // tarde. No es un fallo: es el límite de la ventana de rescate, y
      // aquí se congela a mano para poder probar el añadido tardío.
      //
      // En producción no pasa nunca: la pasada corre cada minuto, así que
      // un turno se congela a los sesenta segundos de cerrar.
      const r = await congelarParte(prisma, {
        tenantId,
        turno: turno("M"),
        careDay: ayer,
        ahora: ventanaDelTurno(turno("M"), ayer).hasta,
      });
      // `null` si la pasada ya lo había congelado (la suite puede correr
      // por la mañana): las dos cosas valen.
      if (r != null) expect(r.lineas).toBeGreaterThan(0);
      const hay = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*)::bigint AS n FROM handovers h
         JOIN center_shifts s ON s.id = h.center_shift_id
         WHERE h.tenant_id = '${tenantId}' AND h.care_day = '${ayer}' AND s.code = 'M'`,
      );
      expect(Number(primera(hay).n)).toBe(1);
    });

    it("un registro que sube con el parte ya congelado se añade APARTE", async () => {
      const elParte = primera(
        await prisma.$queryRawUnsafe<
          Array<{ id: string; care_day: string; frozen_at: Date; code: string }>
        >(
          `SELECT h.id, h.care_day, h.frozen_at, s.code FROM handovers h
           JOIN center_shifts s ON s.id = h.center_shift_id
           WHERE h.tenant_id = '${tenantId}' AND h.care_day = '${ayer}' AND s.code = 'M'`,
        ),
        "el parte de la mañana de ayer",
      );
      const manana = turno("M");
      const { desde } = ventanaDelTurno(manana, ayer);
      // Un cambio postural de las 14:50 que llega DESPUÉS de congelar.
      //
      // Con su **ocurrencia**, que es lo que lo empareja con lo que
      // tocaba: sin `occurrence_at`, `loQueNoSeHizo` no puede cruzarlo y
      // el «no hecho» no se deshace. Es exactamente lo que la puerta
      // escribe (`ocurrenciaDe`, residencia-3), y la ocurrencia se saca
      // de `queToca` para no inventarse una hora que el plan no tiene.
      const laOcurrencia = await (async (): Promise<Date> => {
        const { queToca, deColumnas } = await (async () => ({
          queToca: (await import("@mipiacetpv/residencia-plan")).queToca,
          deColumnas: (await import("../src/residencia/frecuencia-columnas.js"))
            .deColumnas,
        }))();
        const plan = await prisma.carePlanItem.findMany({
          where: { tenantId, clientId: carmenId, controlCode: "CAMBIO_POSTURAL" },
          select: {
            id: true,
            clientId: true,
            controlCode: true,
            fromAt: true,
            toAt: true,
            frequencyKind: true,
            shiftCodes: true,
            momentCodes: true,
            weekdays: true,
            everyNDays: true,
            everyNHours: true,
            monthDay: true,
          },
        });
        const turnosParaToca = turnos.map((t) => ({
          id: t.id,
          code: t.code,
          name: t.code,
          startsAt: t.starts_at,
          endsAt: t.ends_at,
        }));
        const ocurrencias = queToca(
          plan.map((l) => ({
            id: l.id,
            clientId: l.clientId,
            controlCode: l.controlCode,
            frecuencia: deColumnas(l as never),
            fromAt: l.fromAt,
            toAt: l.toAt,
          })),
          [],
          turnosParaToca,
          [],
          desde,
          ventanaDelTurno(manana, ayer).hasta,
        );
        expect(ocurrencias.length, "el plan no agenda cambios posturales").toBeGreaterThan(0);
        return ocurrencias[0]!.at;
      })();
      const id = randomUUID();
      const control = primera(
        await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM control_types WHERE code = 'CAMBIO_POSTURAL' AND superseded_at IS NULL`,
        ),
      ).id;
      const rolAna = primera(
        await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT a.id FROM care_role_assignments a JOIN care_roles r ON r.id = a.care_role_id
           WHERE a.user_id = '${anaId}' AND r.code = 'AUXILIAR'`,
        ),
      ).id;
      const device = primera(
        await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM devices WHERE tenant_id = '${tenantId}' AND kind = 'ROOM'`,
        ),
      ).id;
      const dek = primera(
        await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
          `SELECT count(*)::bigint AS n FROM clinical_tenant_keys WHERE tenant_id = '${tenantId}'`,
        ),
      );
      expect(Number(dek.n)).toBe(1);
      const { cifrarJson, sitioValorDeRegistro } = await import(
        "../src/clinica/cripto-campos.js"
      );
      const { asegurarDek } = await import("../src/clinica/claves.js");
      const clave = await asegurarDek(tenantId, prisma);
      const valor = cifrarJson(
        { tipo: "BOOL", hecho: true },
        clave,
        sitioValorDeRegistro(tenantId, id),
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO care_records (id, tenant_id, client_id, control_type_id, control_code,
           occurrence_at, value_cifrado, recorded_by_user_id, care_role_assignment_id,
           device_id, recorded_at, received_at, center_shift_id, care_day)
         VALUES ('${id}', '${tenantId}', '${carmenId}', '${control}', 'CAMBIO_POSTURAL',
                 '${laOcurrencia.toISOString()}',
                 '${valor}', '${anaId}', '${rolAna}', '${device}',
                 '${new Date(desde.getTime() + 6 * 3600_000 + 50 * 60_000).toISOString()}',
                 '${new Date(elParte.frozen_at.getTime() + 20 * 60_000).toISOString()}',
                 '${manana.id}', '${ayer}')`,
      );

      const r = await pasadaDeRelevo({ prisma, ahora: new Date() });
      expect(r.tardios).toBeGreaterThanOrEqual(1);

      const tardios = await prisma.$queryRawUnsafe<
        Array<{ kind: string; care_record_id: string | null; occurred_at: Date; arrived_at: Date }>
      >(
        `SELECT kind, care_record_id, occurred_at, arrived_at
         FROM handover_late_additions WHERE handover_id = '${elParte.id}'`,
      );
      const suyo = tardios.find((t) => t.care_record_id === id)!;
      expect(suyo.kind).toBe("CARE_RECORD");
      // «Pasó a las 14:50, lo supimos a las 15:20»: las dos horas.
      expect(suyo.arrived_at.getTime()).toBeGreaterThan(suyo.occurred_at.getTime());
    });

    it("y la pasada NO lo duplica al correr otra vez", async () => {
      const antes = primera(
        await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
          `SELECT count(*)::bigint AS n FROM handover_late_additions WHERE tenant_id = '${tenantId}'`,
        ),
      );
      await pasadaDeRelevo({ prisma, ahora: new Date() });
      const despues = primera(
        await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
          `SELECT count(*)::bigint AS n FROM handover_late_additions WHERE tenant_id = '${tenantId}'`,
        ),
      );
      expect(Number(despues.n)).toBe(Number(antes.n));
    });

    it("el parte congelado NO cambia por el añadido tardío", async () => {
      // Es la decisión 2 entera: lo congelado es la evidencia de lo que se
      // supo, y un parte que se reescribiera no probaría nada.
      const elParte = primera(
        await prisma.$queryRawUnsafe<Array<{ id: string; lineas: number; content_cifrado: string }>>(
          `SELECT h.id, h.lineas, h.content_cifrado FROM handovers h
           JOIN center_shifts s ON s.id = h.center_shift_id
           WHERE h.tenant_id = '${tenantId}' AND h.care_day = '${ayer}' AND s.code = 'M'`,
        ),
      );
      const { leerParteCongelado } = await import("../src/residencia/relevo.js");
      const contenido = await leerParteCongelado(prisma, tenantId, elParte.id);
      expect(contenido).not.toBeNull();
      // La línea del cambio postural de las 14:50 sigue diciendo «no se
      // hizo» en el parte congelado…
      const todas = contenido!.zonas.flatMap((z) =>
        z.residentes.flatMap((r) => r.lineas),
      );
      expect(todas.some((l) => l.clase === "NO_HECHO")).toBe(true);
      expect(elParte.lineas).toBe(contenido!.lineas);
    });

    it("…y un cálculo POSTERIOR ya dice que SÍ se hizo", async () => {
      // El registro tardío **deshace el «no hecho»** en todo lo que se
      // calcule después. Las dos cosas son verdad y las dos hacen falta.
      const manana = turno("M");
      const ahora = await construirParte(prisma, {
        tenantId,
        turno: manana,
        careDay: ayer,
        corte: ventanaDelTurno(manana, ayer).hasta,
        ahora: new Date(),
      });
      const deCarmen = ahora.zonas
        .flatMap((z) => z.residentes)
        .find((r) => r.clientId === carmenId);
      const noHechas = (deCarmen?.lineas ?? []).filter((l) => l.clase === "NO_HECHO");
      const congelado = await (
        await import("../src/residencia/relevo.js")
      ).leerParteCongelado(
        prisma,
        tenantId,
        primera(
          await prisma.$queryRawUnsafe<Array<{ id: string }>>(
            `SELECT h.id FROM handovers h JOIN center_shifts s ON s.id = h.center_shift_id
             WHERE h.tenant_id = '${tenantId}' AND h.care_day = '${ayer}' AND s.code = 'M'`,
          ),
        ).id,
      );
      const noHechasAntes = (congelado!.zonas
        .flatMap((z) => z.residentes)
        .find((r) => r.clientId === carmenId)?.lineas ?? []
      ).filter((l) => l.clase === "NO_HECHO");
      expect(noHechas.length).toBeLessThan(noHechasAntes.length);
    });
  });

  // ══ 5 · LAS OBLIGACIONES ════════════════════════════════════════

  describe("las obligaciones de dirección", () => {
    it("la plantilla del bloque C se carga de una vez", async () => {
      const r = await app.inject({
        method: "POST",
        url: "/residencia/obligaciones/cargar-plantilla",
        headers: comoPilar,
        payload: {},
      });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().creadas).toBeGreaterThan(20);
      expect(r.json().problemas).toEqual([]);
    });

    it("y pulsarlo DOS VECES no duplica ni pisa nada", async () => {
      const antes = primera(
        await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
          `SELECT count(*)::bigint AS n FROM management_duties WHERE tenant_id = '${tenantId}'`,
        ),
      );
      // Se cambia el día de las nóminas a mano…
      await debePasar(
        `UPDATE management_duties SET month_day = 28
         WHERE tenant_id = '${tenantId}' AND name = 'Nóminas'`,
      );
      const r = await app.inject({
        method: "POST",
        url: "/residencia/obligaciones/cargar-plantilla",
        headers: comoPilar,
        payload: {},
      });
      expect(r.statusCode).toBe(200);
      expect(r.json().creadas).toBe(0);
      const despues = primera(
        await prisma.$queryRawUnsafe<Array<{ n: bigint; dia: number }>>(
          `SELECT count(*)::bigint AS n,
                  max(month_day) FILTER (WHERE name = 'Nóminas') AS dia
           FROM management_duties WHERE tenant_id = '${tenantId}'`,
        ),
      );
      expect(Number(despues.n)).toBe(Number(antes.n));
      // …y el botón NO se lo devuelve al 25.
      expect(Number(despues.dia)).toBe(28);
      // Se deja como estaba: el test de abajo compara las ocurrencias
      // guardadas con lo que el generador dice para la periodicidad de
      // AHORA, y editar por SQL no regenera nada (ni debe).
      await debePasar(
        `UPDATE management_duties SET month_day = 25
         WHERE tenant_id = '${tenantId}' AND name = 'Nóminas'`,
      );
    });

    it("cada periodicidad genera sus ocurrencias", async () => {
      // La aritmética está probada como tabla en el paquete puro; aquí se
      // comprueba que lo que se GUARDÓ tiene las fechas que la función
      // dice, obligación por obligación.
      const duties = await prisma.$queryRawUnsafe<
        Array<{
          id: string;
          name: string;
          periodicity: string;
          weekday: number | null;
          month_day: number | null;
          month: number | null;
          anchor_year: number | null;
          valid_until: string | null;
          starts_on: string;
        }>
      >(
        `SELECT id, name, periodicity, weekday, month_day, month, anchor_year,
                valid_until, starts_on
         FROM management_duties WHERE tenant_id = '${tenantId}'`,
      );
      expect(duties.length).toBeGreaterThan(20);
      const hoy = new Date().toISOString().slice(0, 10);
      const { addDays } = await import("@mipiacetpv/residencia-plan");
      for (const d of duties) {
        const esperadas = ocurrenciasDeObligacion(
          {
            periodicity: d.periodicity as never,
            weekday: d.weekday,
            monthDay: d.month_day,
            month: d.month,
            anchorYear: d.anchor_year,
            validUntil: d.valid_until,
            startsOn: d.starts_on,
          },
          addDays(hoy, -31),
          addDays(hoy, 90),
        );
        const guardadas = await prisma.$queryRawUnsafe<Array<{ due_on: string }>>(
          `SELECT due_on FROM duty_occurrences WHERE duty_id = '${d.id}' ORDER BY due_on`,
        );
        expect(guardadas.map((g) => g.due_on), d.name).toEqual(esperadas);
      }
    });

    it("marcar hecha FIRMA con persona y capacidad (D-31)", async () => {
      const oc = primera(
        await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT o.id FROM duty_occurrences o JOIN management_duties d ON d.id = o.duty_id
           WHERE o.tenant_id = '${tenantId}' AND d.name = 'Registro diario de jornada'
             AND o.done_at IS NULL ORDER BY o.due_on LIMIT 1`,
        ),
        "una ocurrencia pendiente",
      );
      const r = await app.inject({
        method: "POST",
        url: `/residencia/ocurrencias/${oc.id}/hecha`,
        headers: comoPilar,
        payload: { nota: "Revisado el registro del día." },
      });
      expect(r.statusCode, r.body).toBe(200);
      const fila = primera(
        await prisma.$queryRawUnsafe<
          Array<{
            done_at: Date | null;
            done_by_user_id: string | null;
            done_by_care_role_assignment_id: string | null;
          }>
        >(
          `SELECT done_at, done_by_user_id, done_by_care_role_assignment_id
           FROM duty_occurrences WHERE id = '${oc.id}'`,
        ),
      );
      expect(fila.done_at).not.toBeNull();
      expect(fila.done_by_user_id).toBe(pilarId);
      expect(fila.done_by_care_role_assignment_id).not.toBeNull();
    });

    it("marcarla dos veces contesta la que había", async () => {
      const oc = primera(
        await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM duty_occurrences WHERE tenant_id = '${tenantId}'
             AND done_at IS NOT NULL LIMIT 1`,
        ),
      );
      const r = await app.inject({
        method: "POST",
        url: `/residencia/ocurrencias/${oc.id}/hecha`,
        headers: comoPilar,
        payload: {},
      });
      expect(r.statusCode, r.body).toBe(200);
    });

    it("una hecha vuelve a pendiente SÓLO con corrección firmada", async () => {
      const oc = primera(
        await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM duty_occurrences WHERE tenant_id = '${tenantId}'
             AND done_at IS NOT NULL LIMIT 1`,
        ),
      );
      // Sin motivo: 400, y lo para el esquema de la ruta.
      const sinMotivo = await app.inject({
        method: "POST",
        url: `/residencia/ocurrencias/${oc.id}/corregir`,
        headers: comoPilar,
        payload: {},
      });
      expect(sinMotivo.statusCode).toBe(400);

      const r = await app.inject({
        method: "POST",
        url: `/residencia/ocurrencias/${oc.id}/corregir`,
        headers: comoPilar,
        payload: { motivo: "Me equivoqué de día." },
      });
      expect(r.statusCode, r.body).toBe(200);
      const fila = primera(
        await prisma.$queryRawUnsafe<
          Array<{
            done_at: Date | null;
            corrected_at: Date | null;
            correction_reason: string | null;
          }>
        >(
          `SELECT done_at, corrected_at, correction_reason
           FROM duty_occurrences WHERE id = '${oc.id}'`,
        ),
      );
      expect(fila.done_at).toBeNull();
      expect(fila.corrected_at).not.toBeNull();
      expect(fila.correction_reason).toBe("Me equivoqué de día.");
    });

    it("una por VIGENCIA avisa a 60 días y no se repite", async () => {
      const dentroDe45 = new Date(Date.now() + 45 * 24 * 3600_000)
        .toISOString()
        .slice(0, 10);
      const r = await app.inject({
        method: "POST",
        url: "/residencia/obligaciones",
        headers: comoPilar,
        payload: {
          name: "Formación de PRL de Ana",
          family: "PERSONAL",
          periodicity: "VALIDITY",
          validUntil: dentroDe45,
          consequence: "LEGAL",
          responsibleLabel: "Dirección",
        },
      });
      expect(r.statusCode, r.body).toBe(201);
      // UNA ocurrencia, la de su caducidad: caduca, no se repite.
      expect(r.json().ocurrencias).toBe(1);

      const panel = await app.inject({
        method: "GET",
        url: "/residencia/panel",
        headers: comoPilar,
      });
      expect(panel.statusCode, panel.body).toBe(200);
      const proximas = panel.json().obligaciones.proximas as Array<{
        nombre: string;
        diasRestantes: number;
      }>;
      const suya = proximas.find((p) => p.nombre === "Formación de PRL de Ana");
      expect(suya, "la vigencia no sale en los próximos 60 días").toBeDefined();
      expect(suya!.diasRestantes).toBeLessThanOrEqual(60);
    });

    it("y una VENCIDA sale en el panel, en su sitio", async () => {
      const hace10 = new Date(Date.now() - 10 * 24 * 3600_000)
        .toISOString()
        .slice(0, 10);
      await debePasar(
        `INSERT INTO duty_occurrences (tenant_id, duty_id, due_on)
         SELECT '${tenantId}', id, '${hace10}' FROM management_duties
         WHERE tenant_id = '${tenantId}' AND name = 'Certificado anual del mantenedor de PCI'`,
      );
      const panel = await app.inject({
        method: "GET",
        url: "/residencia/panel",
        headers: comoPilar,
      });
      const vencidas = panel.json().obligaciones.vencidas as Array<{
        nombre: string;
        consequence: string;
        diasRestantes: number;
      }>;
      const pci = vencidas.find((v) =>
        v.nombre.includes("Certificado anual del mantenedor"),
      );
      expect(pci, "la vencida no sale en el panel").toBeDefined();
      expect(pci!.diasRestantes).toBeLessThan(0);
      // Y lo LEGAL va arriba.
      expect(vencidas[0]!.consequence).toBe("LEGAL");
    });

    it("una obligación con dos responsables NO entra por la ruta", async () => {
      const r = await app.inject({
        method: "POST",
        url: "/residencia/obligaciones",
        headers: comoPilar,
        payload: {
          name: "Dos dueños",
          family: "CALIDAD",
          periodicity: "DAILY",
          consequence: "INTERNO",
          responsibleLabel: "Calidad",
          responsibleUserId: pilarId,
        },
      });
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toBe("OBLIGACION_INVALIDA");
    });

    it("y una mensual SIN día del mes tampoco", async () => {
      const r = await app.inject({
        method: "POST",
        url: "/residencia/obligaciones",
        headers: comoPilar,
        payload: {
          name: "Sin día",
          family: "CALIDAD",
          periodicity: "MONTHLY",
          consequence: "INTERNO",
          responsibleLabel: "Calidad",
        },
      });
      expect(r.statusCode).toBe(400);
    });

    /** Marca una ocurrencia como hecha y devuelve su id. La necesitan los
     *  tres tests de la evidencia, y no se puede reutilizar la de arriba
     *  porque el test de la corrección la deja pendiente a propósito. */
    async function unaHecha(): Promise<string> {
      const oc = primera(
        await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM duty_occurrences WHERE tenant_id = '${tenantId}'
             AND done_at IS NULL AND corrected_at IS NULL ORDER BY due_on LIMIT 1`,
        ),
        "una ocurrencia pendiente",
      );
      const r = await app.inject({
        method: "POST",
        url: `/residencia/ocurrencias/${oc.id}/hecha`,
        headers: comoPilar,
        payload: {},
      });
      expect(r.statusCode, r.body).toBe(200);
      return oc.id;
    }

    it("la evidencia NO se puede adjuntar a algo que no está hecho", async () => {
      const oc = primera(
        await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM duty_occurrences WHERE tenant_id = '${tenantId}'
             AND done_at IS NULL LIMIT 1`,
        ),
      );
      const r = await app.inject({
        method: "POST",
        url: `/residencia/ocurrencias/${oc.id}/evidencia`,
        headers: comoPilar,
        payload: { pdfBase64: Buffer.from("%PDF-1.4 x").toString("base64") },
      });
      expect(r.statusCode).toBe(409);
      expect(r.json().error).toBe("EVIDENCIA_EXIGE_HECHA");
    });

    it("y lo que no es un PDF tampoco", async () => {
      const id = await unaHecha();
      const r = await app.inject({
        method: "POST",
        url: `/residencia/ocurrencias/${id}/evidencia`,
        headers: comoPilar,
        payload: { pdfBase64: Buffer.from("<html>pwn</html>").toString("base64") },
      });
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toBe("EVIDENCIA_INVALIDA");
    });

    it("el certificado SÍ, y se sirve con su huella", async () => {
      const id = await unaHecha();
      const pdf = Buffer.concat([
        Buffer.from("%PDF-1.4\n"),
        Buffer.from("certificado del mantenedor\n"),
      ]);
      const r = await app.inject({
        method: "POST",
        url: `/residencia/ocurrencias/${id}/evidencia`,
        headers: comoPilar,
        payload: { pdfBase64: pdf.toString("base64") },
      });
      expect(r.statusCode, r.body).toBe(201);
      const leido = await app.inject({
        method: "GET",
        url: `/residencia/ocurrencias/${id}/evidencia`,
        headers: comoPilar,
      });
      expect(leido.statusCode).toBe(200);
      expect(leido.headers["x-huella-cuadra"]).toBe("1");
      expect(leido.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
      const fila = primera(
        await prisma.$queryRawUnsafe<Array<{ evidence_file_name: string }>>(
          `SELECT evidence_file_name FROM duty_occurrences WHERE id = '${id}'`,
        ),
      );
      expect(fila.evidence_file_name).toMatch(/\.pdf$/);
    });
  });

  // ══ 6 · LOS INDICADORES Y EL PANEL ══════════════════════════════

  describe("los indicadores y el panel", () => {
    it("los seis se calculan, y los que no tienen dato lo dicen", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/residencia/indicadores",
        headers: comoPilar,
      });
      expect(r.statusCode, r.body).toBe(200);
      const codigos = (r.json().indicadores as Array<{ code: string }>).map(
        (i) => i.code,
      );
      expect(codigos).toEqual([
        "SIN_DEPOSICION",
        "VISITA_MEDICA",
        "GIMNASIA",
        "ESTIMULACION_COGNITIVA",
        "ACTIVIDADES_SOCIOCULTURALES",
        "AVERIAS_24H",
      ]);
      // Y los once que faltan están NOMBRADOS.
      expect((r.json().sinDato as unknown[]).length).toBe(11);
    });

    it("la visita médica, calculada a mano: 0 de 2 residentes = 0 %", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/residencia/indicadores",
        headers: comoPilar,
      });
      const visita = (r.json().indicadores as Array<{ code: string; valor: number | null; dentro: boolean | null }>).find(
        (i) => i.code === "VISITA_MEDICA",
      )!;
      // Dos residentes, ninguno con visita médica registrada este mes.
      expect(visita.valor).toBe(0);
      expect(visita.dentro).toBe(false);
    });

    it("la avería abierta cuenta como FUERA de plazo", async () => {
      // Una avería sin cerrar no es una avería rápida: lo contrario haría
      // que un centro que no cierra ninguna saliera con el 0 %, el mejor
      // resultado posible por no hacer nada.
      const r = await app.inject({
        method: "GET",
        url: "/residencia/indicadores",
        headers: comoPilar,
      });
      const averias = (r.json().indicadores as Array<{ code: string; valor: number | null }>).find(
        (i) => i.code === "AVERIAS_24H",
      )!;
      expect(averias.valor).toBe(100);
    });

    it("el umbral del CENTRO gana al de serie, y se puede volver", async () => {
      const puesto = await app.inject({
        method: "PUT",
        url: "/residencia/indicadores/GIMNASIA",
        headers: comoPilar,
        payload: { target: 80, comparison: "AT_LEAST" },
      });
      expect(puesto.statusCode, puesto.body).toBe(200);
      let r = await app.inject({
        method: "GET",
        url: "/residencia/indicadores",
        headers: comoPilar,
      });
      let gim = (r.json().indicadores as Array<{ code: string; umbral: number; umbralDelCentro: boolean }>).find(
        (i) => i.code === "GIMNASIA",
      )!;
      expect(gim.umbral).toBe(80);
      expect(gim.umbralDelCentro).toBe(true);

      await app.inject({
        method: "DELETE",
        url: "/residencia/indicadores/GIMNASIA",
        headers: comoPilar,
      });
      r = await app.inject({
        method: "GET",
        url: "/residencia/indicadores",
        headers: comoPilar,
      });
      gim = (r.json().indicadores as Array<{ code: string; umbral: number; umbralDelCentro: boolean }>).find(
        (i) => i.code === "GIMNASIA",
      )!;
      expect(gim.umbral).toBe(73.5);
      expect(gim.umbralDelCentro).toBe(false);
    });

    it("un umbral de un indicador que no existe NO se guarda", async () => {
      const r = await app.inject({
        method: "PUT",
        url: "/residencia/indicadores/INVENTADO",
        headers: comoPilar,
        payload: { target: 10, comparison: "AT_MOST" },
      });
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toBe("INDICADOR_DESCONOCIDO");
    });

    it("el panel contesta las CINCO preguntas en UNA llamada", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/residencia/panel",
        headers: comoPilar,
      });
      expect(r.statusCode, r.body).toBe(200);
      const p = r.json();
      // 1 · qué hay abierto hoy
      expect(p.abierto.porNivel.map((n: { nivel: string }) => n.nivel)).toEqual([
        "N4",
        "N3",
        "N2",
        "N1",
        "N0",
      ]);
      expect(p.abierto.total).toBeGreaterThanOrEqual(2);
      // La caída es de residente y no tiene constancia de familia: no se
      // puede cerrar hasta decidirlo (D-34).
      expect(p.abierto.sinConstanciaDeFamilia).toBeGreaterThanOrEqual(1);
      expect(p.abierto.esperandoCierreDeOtro).toBeGreaterThanOrEqual(1);
      // 2 · los relevos
      expect(p.relevos.ultimo).not.toBeNull();
      // 3 · las obligaciones
      expect(Array.isArray(p.obligaciones.vencidas)).toBe(true);
      // 4 · el turno en curso, por planta
      expect(p.turno.plantas.length).toBeGreaterThanOrEqual(2);
      // 5 · los indicadores
      expect(p.indicadores).toHaveLength(6);
    });

    it("y un ENCARGADO sin rol directivo no entra", async () => {
      // La pantalla de inicio de un centro de residencia enseña el estado
      // clínico del centro entero de un vistazo. Eso es de dirección.
      const manager = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO users (id, tenant_id, email, alias, role, is_clinician)
         VALUES ('${manager}', '${tenantId}', 'encargado@gredos.es', 'Encargado', 'MANAGER', false)`,
      );
      const r = await app.inject({
        method: "GET",
        url: "/residencia/panel",
        headers: {
          authorization: `Bearer ${signAccessToken({ sub: manager, tid: tenantId, role: "MANAGER" })}`,
        },
      });
      expect(r.statusCode).toBe(403);
      expect(r.json().error).toBe("PANEL_ES_DE_DIRECCION");
    });
  });

  // ══ 7 · LA DEVOLUCIÓN DEL ART. 28.3.g ═══════════════════════════

  describe("la devolución del art. 28.3.g", () => {
    it("lleva lo que de cada residente salió en cada parte, y quién lo recibió", async () => {
      const parte = await parteDeResidencia(prisma, { tenantId, clientId: carmenId });
      expect(parte.json).not.toBeNull();
      const j = parte.json as {
        relevos: Array<{
          dia: string;
          turno: string;
          confirmadoPor: Array<{ nombre: string; conElRol: string }>;
          lineas: Array<{ clase: string; texto: string }>;
        }>;
        llegoDespuesDelRelevo: Array<{ resumen: string | null }>;
      };
      expect(j.relevos.length).toBeGreaterThanOrEqual(1);
      const conCaida = j.relevos.find((r) =>
        r.lineas.some((l) => l.texto.includes("Caída")),
      );
      expect(conCaida, "la caída de doña Carmen no sale en ningún parte").toBeDefined();
      // Y quién lo recibió: es la evidencia que este bloque añade.
      const alguno = j.relevos.find((r) => r.confirmadoPor.length > 0);
      expect(alguno, "ningún parte lleva quién lo recibió").toBeDefined();
      expect(alguno!.confirmadoPor[0]!.conElRol).toBeTruthy();
      // Y lo suyo que llegó después, descifrado.
      expect(j.llegoDespuesDelRelevo.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ══ 8 · LA TABLA DE SABOTAJES ═══════════════════════════════════

  describe("la tabla de sabotajes", () => {
    it("editar un parte congelado por SQL", async () => {
      const p = primera(await partes());
      const msg = await debeFallar(
        `UPDATE handovers SET lineas = 0 WHERE id = '${p.id}'`,
      );
      expect(msg).toContain("un parte congelado no se edita");
    });

    it("cambiarle el contenido cifrado", async () => {
      const p = primera(await partes());
      const msg = await debeFallar(
        `UPDATE handovers SET content_cifrado = 'c1:AAAA' WHERE id = '${p.id}'`,
      );
      expect(msg).toContain("no se edita");
    });

    it("borrar un parte congelado", async () => {
      const p = primera(await partes());
      const msg = await debeFallar(`DELETE FROM handovers WHERE id = '${p.id}'`);
      expect(msg).toContain("no se borra");
    });

    it("des-confirmar un parte ya confirmado", async () => {
      const p = primera(
        await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM handovers WHERE tenant_id = '${tenantId}'
             AND confirmed_at IS NOT NULL LIMIT 1`,
        ),
        "un parte confirmado",
      );
      const msg = await debeFallar(
        `UPDATE handovers SET confirmed_at = NULL WHERE id = '${p.id}'`,
      );
      expect(msg).toContain("una confirmación no se retira");
    });

    it("borrar una confirmación", async () => {
      const a = primera(
        await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM handover_acks WHERE tenant_id = '${tenantId}' LIMIT 1`,
        ),
        "una confirmación",
      );
      const msg = await debeFallar(`DELETE FROM handover_acks WHERE id = '${a.id}'`);
      expect(msg).toContain("no se borra");
    });

    it("editar una confirmación", async () => {
      const a = primera(
        await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM handover_acks WHERE tenant_id = '${tenantId}' LIMIT 1`,
        ),
      );
      const msg = await debeFallar(
        `UPDATE handover_acks SET alcance_total = true WHERE id = '${a.id}'`,
      );
      expect(msg).toContain("no se edita");
    });

    it("quitarle una ZONA a una confirmación", async () => {
      // Cambiaría lo que aquella persona dijo que había leído.
      const z = primera(
        await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT z.id FROM handover_ack_zones z
           WHERE z.tenant_id = '${tenantId}' LIMIT 1`,
        ),
        "una zona de confirmación",
      );
      const msg = await debeFallar(`DELETE FROM handover_ack_zones WHERE id = '${z.id}'`);
      expect(msg).toContain("no se borra");
    });

    it("borrar una ZONA del parte", async () => {
      // Haría que un parte con contenido en dos plantas pareciera tener
      // contenido en una, y una confirmación de esa planta lo daría por
      // confirmado entero.
      const z = primera(
        await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM handover_zones WHERE tenant_id = '${tenantId}' LIMIT 1`,
        ),
      );
      const msg = await debeFallar(`DELETE FROM handover_zones WHERE id = '${z.id}'`);
      expect(msg).toContain("no se borra");
    });

    it("DOS zonas «del centro» en el mismo parte", async () => {
      // Sobre un parte que YA tiene la del centro: en otro, el `INSERT`
      // sería legítimo y lo que probaría el test es nada.
      const p = primera(
        await prisma.$queryRawUnsafe<Array<{ handover_id: string }>>(
          `SELECT handover_id FROM handover_zones
           WHERE tenant_id = '${tenantId}' AND floor_id IS NULL LIMIT 1`,
        ),
        "un parte con zona del centro",
      );
      const msg = await debeFallar(
        `INSERT INTO handover_zones (tenant_id, handover_id, floor_id, lineas)
         VALUES ('${tenantId}', '${p.handover_id}', NULL, 1)`,
      );
      // El índice parcial: en Postgres los NULL son distintos entre sí,
      // así que sin él entrarían DOS filas «del centro».
      // Prisma no siempre trae el nombre del índice en el mensaje, pero
      // sí la CLAVE que chocó: `(handover_id)` a secas es el índice
      // parcial de la zona del centro — el de las plantas es
      // `(handover_id, floor_id)`.
      expect(msg).toContain("Key (handover_id)=");
    });

    it("una zona del parte SIN contenido", async () => {
      const p = primera(await partes());
      const msg = await debeFallar(
        `INSERT INTO handover_zones (tenant_id, handover_id, floor_id, lineas)
         VALUES ('${tenantId}', '${p.id}', '${planta1}', 0)`,
      );
      expect(msg).toContain("handover_zones_con_contenido");
    });

    it("un parte «sin novedades» CON líneas", async () => {
      const msg = await debeFallar(
        `INSERT INTO handovers (id, tenant_id, center_shift_id, care_day, generated_at,
           frozen_at, content_cifrado, lineas, sin_novedades)
         VALUES ('${randomUUID()}', '${tenantId}', '${turno("T").id}', '1999-01-01',
                 now(), now(), 'c1:AAAA', 9, true)`,
      );
      expect(msg).toContain("handovers_recuento_coherente");
    });

    it("un parte con el contenido EN CLARO", async () => {
      const msg = await debeFallar(
        `INSERT INTO handovers (id, tenant_id, center_shift_id, care_day, generated_at,
           frozen_at, content_cifrado, lineas)
         VALUES ('${randomUUID()}', '${tenantId}', '${turno("T").id}', '1999-01-02',
                 now(), now(), '{"zonas":[]}', 0)`,
      );
      expect(msg).toContain("handovers_content_cifrado_formato");
    });

    it("un añadido tardío que apunta a DOS fuentes", async () => {
      const p = primera(await partes());
      const inc = primera(
        await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM incidents WHERE tenant_id = '${tenantId}' LIMIT 1`,
        ),
      );
      const reg = primera(
        await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM care_records WHERE tenant_id = '${tenantId}' LIMIT 1`,
        ),
      );
      const msg = await debeFallar(
        `INSERT INTO handover_late_additions (id, tenant_id, handover_id, kind,
           care_record_id, incident_id, occurred_at, arrived_at, resumen_cifrado)
         VALUES ('${randomUUID()}', '${tenantId}', '${p.id}', 'INCIDENT',
                 '${reg.id}', '${inc.id}', now(), now(), 'c1:AAAA')`,
      );
      expect(msg).toContain("handover_late_additions_fuente_coherente");
    });

    it("un añadido tardío que llegó ANTES de pasar", async () => {
      const p = primera(await partes());
      const inc = primera(
        await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM incidents WHERE tenant_id = '${tenantId}' LIMIT 1`,
        ),
      );
      const msg = await debeFallar(
        `INSERT INTO handover_late_additions (id, tenant_id, handover_id, kind,
           incident_id, occurred_at, arrived_at, resumen_cifrado)
         VALUES ('${randomUUID()}', '${tenantId}', '${p.id}', 'INCIDENT',
                 '${inc.id}', now(), now() - interval '1 hour', 'c1:AAAA')`,
      );
      expect(msg).toContain("handover_late_additions_instantes_ordenados");
    });

    /** Una ocurrencia marcada hecha para sabotearla. No se reutiliza una
     *  de arriba: los tests de la evidencia y de la corrección dejan unas
     *  hechas y otras pendientes, y un sabotaje que depende del orden de
     *  los tests no prueba nada. */
    async function hechaParaSabotear(): Promise<string> {
      const oc = primera(
        await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM duty_occurrences WHERE tenant_id = '${tenantId}'
             AND done_at IS NULL AND corrected_at IS NULL ORDER BY due_on DESC LIMIT 1`,
        ),
        "una ocurrencia pendiente",
      );
      const r = await app.inject({
        method: "POST",
        url: `/residencia/ocurrencias/${oc.id}/hecha`,
        headers: comoPilar,
        payload: {},
      });
      expect(r.statusCode, r.body).toBe(200);
      return oc.id;
    }

    it("una ocurrencia HECHA devuelta a pendiente por SQL", async () => {
      const id = await hechaParaSabotear();
      const msg = await debeFallar(
        `UPDATE duty_occurrences SET done_at = NULL, done_by_user_id = NULL,
           done_by_care_role_assignment_id = NULL WHERE id = '${id}'`,
      );
      expect(msg).toContain("corrección firmada");
    });

    it("…y CON la corrección firmada, sí", async () => {
      const oc = { id: await hechaParaSabotear() };
      await debePasar(
        `UPDATE duty_occurrences SET done_at = NULL, done_by_user_id = NULL,
           done_by_care_role_assignment_id = NULL,
           corrected_at = now(), corrected_by_user_id = '${pilarId}',
           correction_reason = 'por SQL, con firma'
         WHERE id = '${oc.id}'`,
      );
    });

    it("cambiarle el DÍA a una ocurrencia", async () => {
      const oc = primera(
        await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM duty_occurrences WHERE tenant_id = '${tenantId}' LIMIT 1`,
        ),
      );
      const msg = await debeFallar(
        `UPDATE duty_occurrences SET due_on = '2030-01-01' WHERE id = '${oc.id}'`,
      );
      expect(msg).toContain("no cambia de obligación ni de día");
    });

    it("una obligación con DOS responsables, por SQL", async () => {
      const msg = await debeFallar(
        `INSERT INTO management_duties (tenant_id, name, family, periodicity, month_day,
           consequence, responsible_label, responsible_user_id, starts_on, updated_at)
         VALUES ('${tenantId}', 'Dos dueños por SQL', 'CALIDAD', 'MONTHLY', 1,
                 'INTERNO', 'Calidad', '${pilarId}', '2026-01-01', now())`,
      );
      expect(msg).toContain("management_duties_responsable");
    });

    it("una SEMANAL con día del MES", async () => {
      const msg = await debeFallar(
        `INSERT INTO management_duties (tenant_id, name, family, periodicity, weekday,
           month_day, consequence, responsible_label, starts_on, updated_at)
         VALUES ('${tenantId}', 'Semanal con día del mes', 'CALIDAD', 'WEEKLY', 1,
                 15, 'INTERNO', 'Calidad', '2026-01-01', now())`,
      );
      expect(msg).toContain("management_duties_periodicidad_coherente");
    });

    it("una TRIMESTRAL anclada en abril", async () => {
      // El mes de anclaje de una trimestral es 1, 2 o 3: con abril, los
      // otros tres caerían en julio, octubre y enero del año siguiente.
      const msg = await debeFallar(
        `INSERT INTO management_duties (tenant_id, name, family, periodicity, month,
           month_day, consequence, responsible_label, starts_on, updated_at)
         VALUES ('${tenantId}', 'Trimestral en abril', 'CALIDAD', 'QUARTERLY', 4,
                 15, 'INTERNO', 'Calidad', '2026-01-01', now())`,
      );
      expect(msg).toContain("management_duties_periodicidad_coherente");
    });
  });

  // ══ 9 · LOS CRUCES ══════════════════════════════════════════════

  describe("los cruces entre modos", () => {
    it("un TERMINAL contra las rutas de la SALA → 403", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/residencia/sala/me",
        headers: { "x-device-token": tokenTerminal },
      });
      expect(r.statusCode).toBe(403);
      expect(r.json().error).toBe("NOT_A_HANDOVER_DEVICE");
    });

    it("una PUERTA contra las rutas de la sala → 403", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/residencia/sala/arranque",
        headers: { "x-device-token": token112 },
      });
      expect(r.statusCode).toBe(403);
      expect(r.json().error).toBe("NOT_A_HANDOVER_DEVICE");
    });

    it("un MÓVIL DE GUARDIA contra las rutas de la sala → 403", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/residencia/sala/me",
        headers: { "x-device-token": tokenGuardia },
      });
      expect(r.statusCode).toBe(403);
      expect(r.json().error).toBe("NOT_A_HANDOVER_DEVICE");
    });

    it("y una PUERTA CONFIRMANDO un relevo → 403", async () => {
      // La puerta no confirma relevos: la reunión de cambio de turno pasa
      // en la sala, no en el pasillo de la 112.
      const p = primera(await partes());
      const sesion = await app.inject({
        method: "POST",
        url: "/residencia/puerta/pin",
        headers: { "x-device-token": token112 },
        payload: { pin: PIN_ANA },
      });
      const r = await app.inject({
        method: "POST",
        url: `/residencia/sala/relevo/${p.id}/confirmar`,
        headers: {
          "x-device-token": token112,
          authorization: `Bearer ${sesion.json().token}`,
        },
        payload: {},
      });
      expect(r.statusCode).toBe(403);
      expect(r.json().error).toBe("NOT_A_HANDOVER_DEVICE");
    });

    it("la tablet de la SALA contra las rutas de la puerta → 403", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/residencia/puerta/arranque",
        headers: { "x-device-token": tokenSala },
      });
      expect(r.statusCode).toBe(403);
      expect(r.json().error).toBe("NOT_A_ROOM_DEVICE");
    });

    it("y contra las de guardia → 403", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/residencia/guardia/me",
        headers: { "x-device-token": tokenSala },
      });
      expect(r.statusCode).toBe(403);
      expect(r.json().error).toBe("NOT_A_GUARD_DEVICE");
    });

    it("una tablet de sala CON canal de guardia no entra en la base", async () => {
      // El CHECK de residencia-4 ya lo decía y no se tocó. Se mide en vez
      // de suponerlo: una escapatoria «inalcanzable» no está cerrada hasta
      // que se prueba.
      const msg = await debeFallar(
        `INSERT INTO devices (id, tenant_id, kind, guard_channel, name, device_token_hash)
         VALUES ('${randomUUID()}', '${tenantId}', 'HANDOVER', 'ENFERMERIA', 'Mezcla',
                 '${createHash("sha256").update(randomUUID()).digest("hex")}')`,
      );
      expect(msg).toContain("devices_guard_canal");
    });

    it("una tablet de sala CON habitación tampoco", async () => {
      const msg = await debeFallar(
        `INSERT INTO devices (id, tenant_id, kind, room_id, name, device_token_hash)
         VALUES ('${randomUUID()}', '${tenantId}', 'HANDOVER', '${hab112}', 'Mezcla',
                 '${createHash("sha256").update(randomUUID()).digest("hex")}')`,
      );
      expect(msg).toContain("devices_register_o_habitacion");
    });

    it("un tenant SIN residencia no ve nada del panel: 404", async () => {
      const dueno = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO users (id, tenant_id, email, alias, role)
         VALUES ('${dueno}', '${otroTenant}', 'manolo@bar.es', 'Manolo', 'OWNER')`,
      );
      for (const url of [
        "/residencia/panel",
        "/residencia/relevos",
        "/residencia/obligaciones",
        "/residencia/indicadores",
      ]) {
        const r = await app.inject({
          method: "GET",
          url,
          headers: {
            authorization: `Bearer ${signAccessToken({ sub: dueno, tid: otroTenant, role: "OWNER" })}`,
          },
        });
        // **404 y no 403**: un 403 le diría a un bar que este módulo
        // existe y que alguien guarda aquí quién vive en qué habitación.
        expect(r.statusCode, url).toBe(404);
      }
      await prisma.$executeRawUnsafe(`DELETE FROM users WHERE id = '${dueno}'`);
    });
  });
});
