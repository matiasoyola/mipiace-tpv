// F1 · el panel de la empresa, contra Postgres de verdad.
//
// Lo que este banco fija:
//
//   1. El OWNER da de alta un empleado, le genera el enlace y ve si tiene
//      móvil y desde cuándo. Generar uno nuevo mata el anterior.
//   2. "Hoy" contesta las tres preguntas de la pantalla: quién está
//      dentro, quién no ha fichado y qué hay que mirar (sin salida,
//      corregido, enviado sin conexión).
//   3. La empresa corrige SIN la ventana de 30 días del empleado, y
//      añade un fichaje que falta con motivo obligatorio.
//   4. Sin el módulo, ninguna de estas rutas existe. Con la CAJA apagada,
//      todas siguen funcionando — que es el cliente 0 entero.
//   5. Un OWNER de otra empresa no ve ni toca nada de ésta.

import { randomBytes, randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { E2E_DATABASE_URL, e2eEnabled, SKIP_MESSAGE } from "./e2e-env.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  E2E_DATABASE_URL || "postgresql://e2e:e2e@127.0.0.1:5432/e2e";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET = "e".repeat(40);
process.env.JWT_REFRESH_SECRET = "f".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
process.env.PUBLIC_ADMIN_URL = "https://admin.mipiacetpv.com";

const { getPrisma, shutdown } = await import("../src/context.js");
const { registerFichajeRoutes } = await import("../src/fichaje/routes.js");
const { registerFichajeAdminRoutes } = await import(
  "../src/fichaje/admin-routes.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");
const { localDate, localToUtc } = await import("../src/fichaje/time.js");

describe.skipIf(!e2eEnabled)("e2e · el panel del control horario", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let app: FastifyInstance;
  let tenantId = "";
  let otroTenantId = "";
  let ownerId = "";
  let otroOwnerId = "";

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await registerFichajeRoutes(app);
    await registerFichajeAdminRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      `DELETE FROM tenants WHERE id IN ('${tenantId}', '${otroTenantId}')`,
    );
    await app.close();
    await shutdown();
  });

  beforeEach(async () => {
    if (tenantId) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM tenants WHERE id IN ('${tenantId}', '${otroTenantId}')`,
      );
    }
    tenantId = randomUUID();
    otroTenantId = randomUUID();
    ownerId = randomUUID();
    otroOwnerId = randomUUID();
    // EL CLIENTE 0: colegio sin caja, sin Holded, con el control horario
    // como único módulo.
    await prisma.tenant.createMany({
      data: [
        {
          id: tenantId,
          name: `Colegio ${tenantId.slice(0, 8)}`,
          fichajeEnabled: true,
          cajaEnabled: false,
          holdedEnabled: false,
          initialSyncStatus: "NOT_APPLICABLE",
        },
        {
          id: otroTenantId,
          name: `Otro ${otroTenantId.slice(0, 8)}`,
          fichajeEnabled: true,
        },
      ],
    });
    await prisma.user.createMany({
      data: [
        {
          id: ownerId,
          tenantId,
          email: `owner-${ownerId.slice(0, 8)}@colegio.test`,
          role: "OWNER",
          alias: "Secretaría",
        },
        {
          id: otroOwnerId,
          tenantId: otroTenantId,
          email: `owner-${otroOwnerId.slice(0, 8)}@otro.test`,
          role: "OWNER",
        },
      ],
    });
  });

  function auth(userId = ownerId, tid = tenantId, role: "OWNER" | "MANAGER" = "OWNER") {
    return {
      authorization: `Bearer ${signAccessToken({ sub: userId, tid, role })}`,
    };
  }

  async function altaEmpleado(name: string, headers = auth()): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/admin/fichaje/employees",
      headers,
      payload: { name } as never,
    });
    expect(res.statusCode).toBe(201);
    return res.json().employee.id as string;
  }

  // ── empleados y el enlace ────────────────────────────────────────────

  it("el OWNER da de alta un empleado y le genera el enlace", async () => {
    const id = await altaEmpleado("Marta");

    const link = await app.inject({
      method: "POST",
      url: `/admin/fichaje/employees/${id}/pairing-links`,
      headers: auth(),
    });
    expect(link.statusCode).toBe(201);
    expect(link.json().url).toMatch(
      /^https:\/\/admin\.mipiacetpv\.com\/fichar\?p=[\w-]{43}$/,
    );
    // Siete días.
    const dias =
      (new Date(link.json().expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(6.9);
    expect(dias).toBeLessThan(7.1);

    // Y el panel ve que hay un enlace pendiente y todavía ningún móvil.
    const lista = await app.inject({
      method: "GET",
      url: "/admin/fichaje/employees",
      headers: auth(),
    });
    const marta = lista.json().employees.find((e: any) => e.id === id);
    expect(marta.device).toBeNull();
    expect(marta.pendingLink).not.toBeNull();
  });

  it("generar un enlace nuevo mata el anterior", async () => {
    const id = await altaEmpleado("Marta");
    const primero = await app.inject({
      method: "POST",
      url: `/admin/fichaje/employees/${id}/pairing-links`,
      headers: auth(),
    });
    const segundo = await app.inject({
      method: "POST",
      url: `/admin/fichaje/employees/${id}/pairing-links`,
      headers: auth(),
    });
    const tokenViejo = new URL(primero.json().url).searchParams.get("p")!;
    const tokenNuevo = new URL(segundo.json().url).searchParams.get("p")!;

    const conViejo = await app.inject({
      method: "POST",
      url: "/fichaje/v1/pair",
      payload: { token: tokenViejo } as never,
    });
    expect(conViejo.statusCode).toBe(404);

    const conNuevo = await app.inject({
      method: "POST",
      url: "/fichaje/v1/pair",
      payload: { token: tokenNuevo } as never,
    });
    expect(conNuevo.statusCode).toBe(201);
  });

  it("el panel ve el móvil emparejado y desde cuándo, y lo puede revocar", async () => {
    const id = await altaEmpleado("Marta");
    const link = await app.inject({
      method: "POST",
      url: `/admin/fichaje/employees/${id}/pairing-links`,
      headers: auth(),
    });
    const token = new URL(link.json().url).searchParams.get("p")!;
    const pair = await app.inject({
      method: "POST",
      url: "/fichaje/v1/pair",
      payload: { token } as never,
    });
    const employeeToken = pair.json().employeeToken;

    const lista = await app.inject({
      method: "GET",
      url: "/admin/fichaje/employees",
      headers: auth(),
    });
    const marta = lista.json().employees.find((e: any) => e.id === id);
    expect(marta.device).not.toBeNull();
    expect(marta.device.pairedAt).toBeTruthy();

    const revoke = await app.inject({
      method: "POST",
      url: `/admin/fichaje/employees/${id}/devices/revoke`,
      headers: auth(),
    });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json().revoked).toBe(1);

    const me = await app.inject({
      method: "GET",
      url: "/fichaje/v1/me",
      headers: { "x-employee-token": employeeToken },
    });
    expect(me.statusCode).toBe(401);
  });

  it("la baja DESACTIVA, revoca el móvil y no toca los registros", async () => {
    const id = await altaEmpleado("Marta");
    await prisma.timeEntry.create({
      data: {
        tenantId,
        employeeId: id,
        startedAt: localToUtc(localDate(new Date()), "08:00"),
        startedServerAt: new Date(),
        startSource: "PANEL",
      },
    });
    await prisma.employeeDevice.create({
      data: { tenantId, employeeId: id, deviceTokenHash: `h-${id}` },
    });

    const baja = await app.inject({
      method: "PATCH",
      url: `/admin/fichaje/employees/${id}`,
      headers: auth(),
      payload: { active: false } as never,
    });
    expect(baja.statusCode).toBe(200);
    expect(baja.json().employee.active).toBe(false);

    const activos = await prisma.employeeDevice.count({
      where: { employeeId: id, revokedAt: null },
    });
    expect(activos).toBe(0);
    const fichajes = await prisma.timeEntry.count({ where: { employeeId: id } });
    expect(fichajes).toBe(1);
  });

  it("a un empleado de baja no se le genera enlace", async () => {
    const id = await altaEmpleado("Marta");
    await app.inject({
      method: "PATCH",
      url: `/admin/fichaje/employees/${id}`,
      headers: auth(),
      payload: { active: false } as never,
    });
    const res = await app.inject({
      method: "POST",
      url: `/admin/fichaje/employees/${id}/pairing-links`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(409);
  });

  // ── Hoy ──────────────────────────────────────────────────────────────

  it("Hoy: quién está dentro, quién no ha fichado y los avisos", async () => {
    const marta = await altaEmpleado("Marta");
    const luis = await altaEmpleado("Luis");
    const ana = await altaEmpleado("Ana");
    const hoy = localDate(new Date());
    const ayer = localDate(new Date(Date.now() - 86_400_000));

    // Marta está dentro desde esta mañana.
    await prisma.timeEntry.create({
      data: {
        tenantId,
        employeeId: marta,
        startedAt: localToUtc(hoy, "08:00"),
        startedServerAt: new Date(),
        startSource: "MOBILE",
      },
    });
    // Luis se dejó ayer sin cerrar.
    await prisma.timeEntry.create({
      data: {
        tenantId,
        employeeId: luis,
        startedAt: localToUtc(ayer, "08:00"),
        startedServerAt: localToUtc(ayer, "08:00"),
        startSource: "MOBILE",
      },
    });
    // Ana no ha aparecido.

    const res = await app.inject({
      method: "GET",
      url: "/admin/fichaje/today",
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.date).toBe(hoy);
    expect(body.inside.map((x: any) => x.employeeName)).toEqual(["Marta"]);
    expect(body.notClockedIn.map((x: any) => x.employeeName).sort()).toEqual([
      "Ana",
      "Luis",
    ]);
    expect(body.alerts.missingExit).toHaveLength(1);
    expect(body.alerts.missingExit[0].employeeName).toBe("Luis");
  });

  it("Hoy marca lo que llegó sin conexión", async () => {
    const marta = await altaEmpleado("Marta");
    const hace3h = new Date(Date.now() - 3 * 3_600_000);
    await prisma.timeEntry.create({
      data: {
        tenantId,
        employeeId: marta,
        startedAt: hace3h,
        startedDeviceAt: hace3h,
        // Llegó al servidor tres horas después del toque.
        startedServerAt: new Date(),
        startSource: "MOBILE",
      },
    });
    const res = await app.inject({
      method: "GET",
      url: "/admin/fichaje/today",
      headers: auth(),
    });
    expect(res.json().alerts.sentOffline).toHaveLength(1);
  });

  // ── corregir y añadir desde el panel ─────────────────────────────────

  it("la empresa corrige un fichaje de hace tres meses (no tiene ventana)", async () => {
    const marta = await altaEmpleado("Marta");
    const viejo = new Date(Date.now() - 90 * 86_400_000);
    const entry = await prisma.timeEntry.create({
      data: {
        tenantId,
        employeeId: marta,
        startedAt: viejo,
        startedServerAt: viejo,
        startSource: "MOBILE",
        endedAt: new Date(viejo.getTime() + 8 * 3_600_000),
        endedServerAt: viejo,
        endSource: "MOBILE",
      },
      select: { id: true },
    });

    const res = await app.inject({
      method: "POST",
      url: `/admin/fichaje/entries/${entry.id}/corrections`,
      headers: auth(),
      payload: {
        field: "ended_at",
        value: new Date(viejo.getTime() + 9 * 3_600_000).toISOString(),
        reasonCode: "ERROR_HORA",
      } as never,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().entry.minutes).toBe(9 * 60);
    expect(res.json().entry.corrected).toBe(true);

    const historial = await app.inject({
      method: "GET",
      url: `/admin/fichaje/entries/${entry.id}/corrections`,
      headers: auth(),
    });
    const [c] = historial.json().corrections;
    expect(c.kind).toBe("CAMBIO");
    expect(c.authorKind).toBe("PANEL");
    // El alias del usuario del panel, congelado en la traza.
    expect(c.author).toBe("Secretaría");
  });

  it("añade un fichaje que falta, con motivo, y queda marcado como del panel", async () => {
    const marta = await altaEmpleado("Marta");
    const ayer = localDate(new Date(Date.now() - 86_400_000));

    const res = await app.inject({
      method: "POST",
      url: "/admin/fichaje/entries",
      headers: auth(),
      payload: {
        employeeId: marta,
        startedAt: localToUtc(ayer, "08:00").toISOString(),
        endedAt: localToUtc(ayer, "15:00").toISOString(),
        reasonCode: "OTRO",
        reasonText: "Se dejó el móvil en casa",
      } as never,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().entry.startSource).toBe("PANEL");
    expect(res.json().entry.endSource).toBe("PANEL");
    expect(res.json().entry.minutes).toBe(7 * 60);
    // Sin hora de dispositivo: nadie tocó nada, y no se inventa.
    expect(res.json().entry.offline).toBe(false);

    const historial = await app.inject({
      method: "GET",
      url: `/admin/fichaje/entries/${res.json().entry.id}/corrections`,
      headers: auth(),
    });
    const [c] = historial.json().corrections;
    expect(c.reasonCode).toBe("OTRO");
    expect(c.reasonText).toBe("Se dejó el móvil en casa");
    // Un alta manual pasa por la MISMA función y el MISMO motivo que una
    // corrección, así que su traza tiene el mismo valor a los dos lados:
    // lo que cambia no es la hora, es que la jornada aparece. `kind` lo
    // dice para que el historial y el PDF no pinten "08:00 → 08:00".
    expect(c.kind).toBe("ALTA");
    expect(c.oldValue).toBe(c.newValue);
  });

  it('añadir con "Otro" y sin texto no se escribe', async () => {
    const marta = await altaEmpleado("Marta");
    const ayer = localDate(new Date(Date.now() - 86_400_000));
    const res = await app.inject({
      method: "POST",
      url: "/admin/fichaje/entries",
      headers: auth(),
      payload: {
        employeeId: marta,
        startedAt: localToUtc(ayer, "08:00").toISOString(),
        endedAt: localToUtc(ayer, "15:00").toISOString(),
        reasonCode: "OTRO",
      } as never,
    });
    expect(res.statusCode).toBe(400);
    const n = await prisma.timeEntry.count({ where: { employeeId: marta } });
    expect(n).toBe(0);
  });

  it("añadir un segundo tramo sin salida choca con la invariante", async () => {
    const marta = await altaEmpleado("Marta");
    const hoy = localDate(new Date());
    await prisma.timeEntry.create({
      data: {
        tenantId,
        employeeId: marta,
        startedAt: localToUtc(hoy, "08:00"),
        startedServerAt: new Date(),
        startSource: "MOBILE",
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/admin/fichaje/entries",
      headers: auth(),
      payload: {
        employeeId: marta,
        startedAt: localToUtc(hoy, "10:00").toISOString(),
        reasonCode: "OLVIDO",
      } as never,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("ENTRY_ALREADY_OPEN");
  });

  // ── Registro ─────────────────────────────────────────────────────────

  it("el registro sale por empleado, con total diario y total del mes", async () => {
    const marta = await altaEmpleado("Marta");
    const luis = await altaEmpleado("Luis");
    const hoy = localDate(new Date());
    const ayer = localDate(new Date(Date.now() - 86_400_000));
    for (const [emp, dia, de, a] of [
      [marta, ayer, "08:00", "14:00"],
      [marta, hoy, "08:00", "15:00"],
      [luis, hoy, "09:00", "13:00"],
    ] as const) {
      await prisma.timeEntry.create({
        data: {
          tenantId,
          employeeId: emp,
          startedAt: localToUtc(dia, de),
          startedServerAt: localToUtc(dia, de),
          startSource: "MOBILE",
          endedAt: localToUtc(dia, a),
          endedServerAt: localToUtc(dia, a),
          endSource: "MOBILE",
        },
      });
    }

    const res = await app.inject({
      method: "GET",
      url: `/admin/fichaje/entries?month=${hoy.slice(0, 7)}`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const bloqueMarta = body.blocks.find((b: any) => b.employeeName === "Marta");
    // Sólo si los dos días caen en el mismo mes; si no, el bloque trae uno.
    expect(bloqueMarta.totalMinutes).toBeGreaterThanOrEqual(7 * 60);

    // Filtrado por empleado.
    const soloLuis = await app.inject({
      method: "GET",
      url: `/admin/fichaje/entries?month=${hoy.slice(0, 7)}&employeeId=${luis}`,
      headers: auth(),
    });
    expect(soloLuis.json().blocks).toHaveLength(1);
    expect(soloLuis.json().blocks[0].totalMinutes).toBe(4 * 60);
  });

  // ── las puertas ──────────────────────────────────────────────────────

  it("sin el módulo, ninguna de estas rutas existe", async () => {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { fichajeEnabled: false },
    });
    for (const url of [
      "/admin/fichaje/employees",
      "/admin/fichaje/today",
      "/admin/fichaje/entries",
    ]) {
      const res = await app.inject({ method: "GET", url, headers: auth() });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("FICHAJE_DISABLED");
    }
  });

  // EL CLIENTE 0. Si esto se pusiera rojo, el colegio no tendría producto.
  it("con la CAJA apagada todo sigue funcionando", async () => {
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { cajaEnabled: true, holdedEnabled: true },
    });
    expect(tenant.cajaEnabled).toBe(false);
    expect(tenant.holdedEnabled).toBe(false);

    const id = await altaEmpleado("Marta");
    const link = await app.inject({
      method: "POST",
      url: `/admin/fichaje/employees/${id}/pairing-links`,
      headers: auth(),
    });
    expect(link.statusCode).toBe(201);
    const hoy = await app.inject({
      method: "GET",
      url: "/admin/fichaje/today",
      headers: auth(),
    });
    expect(hoy.statusCode).toBe(200);
  });

  it("el OWNER de otra empresa no ve ni toca nada de ésta", async () => {
    const marta = await altaEmpleado("Marta");
    const otro = auth(otroOwnerId, otroTenantId);

    const lista = await app.inject({
      method: "GET",
      url: "/admin/fichaje/employees",
      headers: otro,
    });
    expect(lista.json().employees).toEqual([]);

    const link = await app.inject({
      method: "POST",
      url: `/admin/fichaje/employees/${marta}/pairing-links`,
      headers: otro,
    });
    expect(link.statusCode).toBe(404);

    const baja = await app.inject({
      method: "PATCH",
      url: `/admin/fichaje/employees/${marta}`,
      headers: otro,
      payload: { active: false } as never,
    });
    expect(baja.statusCode).toBe(404);
  });

  it("el MANAGER también gestiona: en un colegio es la secretaría", async () => {
    const managerId = randomUUID();
    await prisma.user.create({
      data: {
        id: managerId,
        tenantId,
        email: `mgr-${managerId.slice(0, 8)}@colegio.test`,
        role: "MANAGER",
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/admin/fichaje/employees",
      headers: auth(managerId, tenantId, "MANAGER"),
      payload: { name: "Marta" } as never,
    });
    expect(res.statusCode).toBe(201);
  });
});
