// F1 · fichar desde el móvil, contra Postgres de verdad.
//
// Por qué e2e: la mitad de lo que hay que probar aquí lo garantizan los
// índices parciales y los triggers de la migración —un tramo abierto por
// empleado, un móvil activo por empleado, la hora que sólo se mueve por
// la vía de corrección— y ninguno existe con un prisma falso.
//
// Lo que este banco fija:
//
//   1. El enlace empareja UNA vez. Reenviado, caducado o de un empleado de
//      baja, no vale. Emparejar un móvil nuevo revoca el anterior.
//   2. El toque entra con SU hora aunque llegue tres horas tarde, y el
//      servidor guarda las dos.
//   3. Un token no ve nada de otro empleado ni de otro tenant.
//   4. La salida olvidada se PREGUNTA: el tramo sigue abierto, cerrarlo
//      por la vía normal se rechaza, y contestarlo deja una corrección
//      OLVIDO con el original intacto.
//   5. Sin el módulo encendido, nada de esto existe.

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

const { getPrisma, shutdown } = await import("../src/context.js");
const { registerFichajeRoutes } = await import("../src/fichaje/routes.js");
const { generatePairingToken } = await import("../src/fichaje/auth.js");
const { localDate, localToUtc } = await import("../src/fichaje/time.js");

describe.skipIf(!e2eEnabled)("e2e · fichar desde el móvil", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let app: FastifyInstance;
  let tenantId = "";
  let otroTenantId = "";
  let marta = "";
  let luis = "";
  let ajeno = "";

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await registerFichajeRoutes(app);
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
    // Tenant nuevo por caso: los triggers impiden limpiar fichajes, así
    // que la única forma honesta de aislar es un tenant desechable.
    if (tenantId) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM tenants WHERE id IN ('${tenantId}', '${otroTenantId}')`,
      );
    }
    tenantId = randomUUID();
    otroTenantId = randomUUID();
    await prisma.tenant.createMany({
      data: [
        { id: tenantId, name: `Colegio ${tenantId.slice(0, 8)}`, fichajeEnabled: true },
        {
          id: otroTenantId,
          name: `Otro ${otroTenantId.slice(0, 8)}`,
          fichajeEnabled: true,
        },
      ],
    });
    const m = await prisma.employee.create({
      data: { tenantId, name: "Marta" },
      select: { id: true },
    });
    const l = await prisma.employee.create({
      data: { tenantId, name: "Luis" },
      select: { id: true },
    });
    const a = await prisma.employee.create({
      data: { tenantId: otroTenantId, name: "Ajena" },
      select: { id: true },
    });
    marta = m.id;
    luis = l.id;
    ajeno = a.id;
  });

  // ── utilidades ───────────────────────────────────────────────────────

  async function enlace(
    employeeId: string,
    opts: { expiresAt?: Date; tenantId?: string } = {},
  ): Promise<string> {
    const { plain, hash } = generatePairingToken();
    await prisma.employeePairingToken.create({
      data: {
        tenantId: opts.tenantId ?? tenantId,
        employeeId,
        tokenHash: hash,
        expiresAt: opts.expiresAt ?? new Date(Date.now() + 7 * 86_400_000),
      },
    });
    return plain;
  }

  async function emparejar(employeeId: string, opts = {}): Promise<string> {
    const token = await enlace(employeeId, opts);
    const res = await app.inject({
      method: "POST",
      url: "/fichaje/v1/pair",
      payload: { token } as never,
    });
    expect(res.statusCode).toBe(201);
    return res.json().employeeToken as string;
  }

  function conToken(token: string) {
    return { [`x-employee-token`]: token };
  }

  // ── emparejar ────────────────────────────────────────────────────────

  it("el enlace empareja el móvil y deja de valer", async () => {
    const token = await enlace(marta);
    const primera = await app.inject({
      method: "POST",
      url: "/fichaje/v1/pair",
      payload: { token } as never,
    });
    expect(primera.statusCode).toBe(201);
    expect(primera.json().employee.name).toBe("Marta");
    expect(primera.json().employeeToken).toHaveLength(43);

    // Reenviado por WhatsApp a las dos horas: ya no vale.
    const segunda = await app.inject({
      method: "POST",
      url: "/fichaje/v1/pair",
      payload: { token } as never,
    });
    expect(segunda.statusCode).toBe(404);
    expect(segunda.json().error).toBe("INVALID_PAIRING_LINK");
  });

  it("un enlace caducado no empareja", async () => {
    const token = await enlace(marta, {
      expiresAt: new Date(Date.now() - 60_000),
    });
    const res = await app.inject({
      method: "POST",
      url: "/fichaje/v1/pair",
      payload: { token } as never,
    });
    expect(res.statusCode).toBe(404);
  });

  it("emparejar un móvil nuevo REVOCA el anterior", async () => {
    const viejo = await emparejar(marta);
    const nuevo = await emparejar(marta);
    expect(nuevo).not.toBe(viejo);

    const conViejo = await app.inject({
      method: "GET",
      url: "/fichaje/v1/me",
      headers: conToken(viejo),
    });
    expect(conViejo.statusCode).toBe(401);
    expect(conViejo.json().error).toBe("EMPLOYEE_DEVICE_REVOKED");

    const conNuevo = await app.inject({
      method: "GET",
      url: "/fichaje/v1/me",
      headers: conToken(nuevo),
    });
    expect(conNuevo.statusCode).toBe(200);

    // Y en la base sigue habiendo UNO activo, no dos.
    const activos = await prisma.employeeDevice.count({
      where: { employeeId: marta, revokedAt: null },
    });
    expect(activos).toBe(1);
  });

  it("el móvil de un empleado de baja deja de valer", async () => {
    const token = await emparejar(marta);
    await prisma.employee.update({
      where: { id: marta },
      data: { active: false, deactivatedAt: new Date() },
    });
    const res = await app.inject({
      method: "GET",
      url: "/fichaje/v1/me",
      headers: conToken(token),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("EMPLOYEE_INACTIVE");
  });

  it("sin el módulo encendido no se empareja ni se ficha", async () => {
    const token = await emparejar(marta);
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { fichajeEnabled: false },
    });

    const me = await app.inject({
      method: "GET",
      url: "/fichaje/v1/me",
      headers: conToken(token),
    });
    expect(me.statusCode).toBe(403);
    expect(me.json().error).toBe("FICHAJE_DISABLED");

    const nuevoEnlace = await enlace(marta);
    const pair = await app.inject({
      method: "POST",
      url: "/fichaje/v1/pair",
      payload: { token: nuevoEnlace } as never,
    });
    expect(pair.statusCode).toBe(403);
  });

  // ── fichar ───────────────────────────────────────────────────────────

  async function entrar(token: string, deviceAt: Date, externalId = randomUUID()) {
    return app.inject({
      method: "POST",
      url: "/fichaje/v1/entries",
      headers: conToken(token),
      payload: { externalId, deviceAt: deviceAt.toISOString() } as never,
    });
  }

  async function salir(
    token: string,
    entryId: string,
    deviceAt: Date,
    externalId = randomUUID(),
  ) {
    return app.inject({
      method: "POST",
      url: `/fichaje/v1/entries/${entryId}/close`,
      headers: conToken(token),
      payload: { externalId, deviceAt: deviceAt.toISOString() } as never,
    });
  }

  it("entrada y salida: un tramo completo", async () => {
    const token = await emparejar(marta);
    const ahora = new Date();
    const hace4h = new Date(ahora.getTime() - 4 * 3_600_000);
    const e = await entrar(token, hace4h);
    expect(e.statusCode).toBe(201);
    const entryId = e.json().entry.id;
    expect(e.json().entry.open).toBe(true);

    const s = await salir(token, entryId, ahora);
    expect(s.statusCode).toBe(200);
    expect(s.json().entry.open).toBe(false);
    expect(s.json().entry.minutes).toBe(240);
  });

  it("estando dentro, volver a entrar no abre un segundo tramo", async () => {
    const token = await emparejar(marta);
    const e1 = await entrar(token, new Date());
    const e2 = await entrar(token, new Date());
    expect(e2.statusCode).toBe(409);
    expect(e2.json().error).toBe("ENTRY_ALREADY_OPEN");
    expect(e2.json().openEntryId).toBe(e1.json().entry.id);
  });

  it("el mismo toque reenviado por la cola NO crea otro tramo", async () => {
    const token = await emparejar(marta);
    const externalId = randomUUID();
    const t = new Date();
    const primera = await entrar(token, t, externalId);
    const reenvio = await entrar(token, t, externalId);
    expect(primera.statusCode).toBe(201);
    expect(reenvio.statusCode).toBe(200);
    expect(reenvio.json().duplicate).toBe(true);
    expect(reenvio.json().entry.id).toBe(primera.json().entry.id);
  });

  // La razón de ser de la cola offline: colegio con sótano.
  it("un toque que llega tres horas tarde guarda LA HORA DEL TOQUE", async () => {
    const token = await emparejar(marta);
    const toque = new Date(Date.now() - 3 * 3_600_000);
    const res = await entrar(token, toque);
    expect(res.statusCode).toBe(201);
    expect(res.json().entry.startedAt).toBe(toque.toISOString());
    // Y marcado, para que la empresa lo vea.
    expect(res.json().entry.offline).toBe(true);

    const fila = await prisma.timeEntry.findUniqueOrThrow({
      where: { id: res.json().entry.id },
      select: { startedAt: true, startedDeviceAt: true, startedServerAt: true },
    });
    // Las dos horas, cada una en su sitio. La que cuenta es la del toque.
    expect(fila.startedAt.toISOString()).toBe(toque.toISOString());
    expect(fila.startedDeviceAt!.toISOString()).toBe(toque.toISOString());
    expect(fila.startedServerAt.getTime()).toBeGreaterThan(toque.getTime());
  });

  it("un toque inmediato NO se marca como sin conexión", async () => {
    const token = await emparejar(marta);
    const res = await entrar(token, new Date());
    expect(res.json().entry.offline).toBe(false);
  });

  // ── aislamiento ──────────────────────────────────────────────────────

  it("el token de un empleado no ve el fichaje de otro", async () => {
    const tokenMarta = await emparejar(marta);
    const tokenLuis = await emparejar(luis);
    const deMarta = await entrar(tokenMarta, new Date());
    const entryId = deMarta.json().entry.id;

    // 404 y no 403: un 403 confirmaría que ese fichaje existe.
    const cerrar = await salir(tokenLuis, entryId, new Date());
    expect(cerrar.statusCode).toBe(404);

    const historial = await app.inject({
      method: "GET",
      url: `/fichaje/v1/entries/${entryId}/corrections`,
      headers: conToken(tokenLuis),
    });
    expect(historial.statusCode).toBe(404);

    const corregir = await app.inject({
      method: "POST",
      url: `/fichaje/v1/entries/${entryId}/corrections`,
      headers: conToken(tokenLuis),
      payload: {
        field: "started_at",
        value: new Date().toISOString(),
        reasonCode: "ERROR_HORA",
      } as never,
    });
    expect(corregir.statusCode).toBe(404);
  });

  it("el token de un tenant no ve nada de otro tenant", async () => {
    const tokenMarta = await emparejar(marta);
    const tokenAjena = await emparejar(ajeno, { tenantId: otroTenantId });
    const deMarta = await entrar(tokenMarta, new Date());

    const res = await salir(tokenAjena, deMarta.json().entry.id, new Date());
    expect(res.statusCode).toBe(404);

    const mes = await app.inject({
      method: "GET",
      url: "/fichaje/v1/entries",
      headers: conToken(tokenAjena),
    });
    expect(mes.statusCode).toBe(200);
    expect(mes.json().days).toEqual([]);
  });

  it("dos empleados pueden estar dentro a la vez", async () => {
    const tokenMarta = await emparejar(marta);
    const tokenLuis = await emparejar(luis);
    expect((await entrar(tokenMarta, new Date())).statusCode).toBe(201);
    expect((await entrar(tokenLuis, new Date())).statusCode).toBe(201);
  });

  // ── la salida olvidada ───────────────────────────────────────────────

  /** Siembra un tramo con horas de pared EXACTAS, saltándose la API.
   *  Los casos que afirman sobre "08:02" o "15:00" no pueden depender de
   *  a qué hora del día se corra la suite: la ruta de fichar acota el
   *  futuro a propósito (`resolveTapTime`), así que un 14:00 tecleado a
   *  las 11:00 se convertiría —con razón— en las 11:00. */
  async function sembrarTramo(
    employeeId: string,
    dia: string,
    entrada: string,
    salida: string | null,
  ): Promise<string> {
    const row = await prisma.timeEntry.create({
      data: {
        tenantId,
        employeeId,
        startedAt: localToUtc(dia, entrada),
        startedServerAt: localToUtc(dia, entrada),
        startSource: "MOBILE",
        ...(salida
          ? {
              endedAt: localToUtc(dia, salida),
              endedServerAt: localToUtc(dia, salida),
              endSource: "MOBILE" as const,
            }
          : {}),
      },
      select: { id: true },
    });
    return row.id;
  }

  async function tramoDeAyer(employeeId: string): Promise<string> {
    const ayer = localToUtc(
      localDate(new Date(Date.now() - 86_400_000)),
      "08:00",
    );
    const row = await prisma.timeEntry.create({
      data: {
        tenantId,
        employeeId,
        startedAt: ayer,
        startedDeviceAt: ayer,
        startedServerAt: ayer,
        startSource: "MOBILE",
      },
      select: { id: true },
    });
    return row.id;
  }

  it("al abrir la pantalla, la salida olvidada es lo PRIMERO que sale", async () => {
    const token = await emparejar(marta);
    const entryId = await tramoDeAyer(marta);

    const me = await app.inject({
      method: "GET",
      url: "/fichaje/v1/me",
      headers: conToken(token),
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().pendingExit).not.toBeNull();
    expect(me.json().pendingExit.entryId).toBe(entryId);
    // Sin historial de salidas, NO se propone hora. No se inventa nada.
    expect(me.json().pendingExit.suggestedEndAt).toBeNull();
  });

  it("con historial, propone la mediana de sus últimas salidas", async () => {
    const token = await emparejar(marta);
    // Tres jornadas cerradas a las 17:30, en días pasados.
    for (const dias of [5, 4, 3]) {
      const dia = localDate(new Date(Date.now() - dias * 86_400_000));
      await prisma.timeEntry.create({
        data: {
          tenantId,
          employeeId: marta,
          startedAt: localToUtc(dia, "08:00"),
          startedServerAt: localToUtc(dia, "08:00"),
          startSource: "MOBILE",
          endedAt: localToUtc(dia, "17:30"),
          endedServerAt: localToUtc(dia, "17:30"),
          endSource: "MOBILE",
        },
      });
    }
    await tramoDeAyer(marta);

    const me = await app.inject({
      method: "GET",
      url: "/fichaje/v1/me",
      headers: conToken(token),
    });
    const sugerida = me.json().pendingExit.suggestedEndAt;
    expect(sugerida).not.toBeNull();
    const ayer = localDate(new Date(Date.now() - 86_400_000));
    expect(new Date(sugerida).toISOString()).toBe(
      localToUtc(ayer, "17:30").toISOString(),
    );
  });

  it("la salida olvidada NO se cierra con el toque normal", async () => {
    const token = await emparejar(marta);
    const entryId = await tramoDeAyer(marta);
    const res = await salir(token, entryId, new Date());
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("PENDING_EXIT_REQUIRES_REASON");
    // Y sigue abierto: nunca se cierra solo.
    const fila = await prisma.timeEntry.findUniqueOrThrow({
      where: { id: entryId },
      select: { endedAt: true },
    });
    expect(fila.endedAt).toBeNull();
  });

  it("contestarla deja una corrección OLVIDO y el tramo cerrado", async () => {
    const token = await emparejar(marta);
    const entryId = await tramoDeAyer(marta);
    const ayer = localDate(new Date(Date.now() - 86_400_000));
    const salida = localToUtc(ayer, "17:30");

    const res = await app.inject({
      method: "POST",
      url: `/fichaje/v1/entries/${entryId}/corrections`,
      headers: conToken(token),
      payload: {
        field: "ended_at",
        value: salida.toISOString(),
        reasonCode: "OLVIDO",
      } as never,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().entry.open).toBe(false);
    expect(res.json().entry.corrected).toBe(true);
    expect(res.json().entry.minutes).toBe(9 * 60 + 30);

    const historial = await app.inject({
      method: "GET",
      url: `/fichaje/v1/entries/${entryId}/corrections`,
      headers: conToken(token),
    });
    const [c] = historial.json().corrections;
    expect(c.reasonCode).toBe("OLVIDO");
    expect(c.author).toBe("Marta");
    expect(c.authorKind).toBe("EMPLOYEE");
    // El original sigue ahí: no había salida, y eso es lo que dice.
    expect(c.oldValue).toBeNull();

    // Y ya puede fichar normal.
    const me = await app.inject({
      method: "GET",
      url: "/fichaje/v1/me",
      headers: conToken(token),
    });
    expect(me.json().pendingExit).toBeNull();
    expect(me.json().openEntry).toBeNull();
  });

  // ── corregir ─────────────────────────────────────────────────────────

  it("el empleado corrige su hora y el original queda en la traza", async () => {
    const token = await emparejar(marta);
    // Ayer, para que "15:00" sea siempre pasado: corregir al futuro está
    // prohibido a propósito, y el reloj de la suite no decide este caso.
    const hoy = localDate(new Date(Date.now() - 86_400_000));
    const entryId = await sembrarTramo(marta, hoy, "08:02", "14:00");

    const res = await app.inject({
      method: "POST",
      url: `/fichaje/v1/entries/${entryId}/corrections`,
      headers: conToken(token),
      payload: {
        field: "ended_at",
        value: localToUtc(hoy, "15:00").toISOString(),
        reasonCode: "ERROR_HORA",
      } as never,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().entry.endedLocal).toBe("15:00");

    const historial = await app.inject({
      method: "GET",
      url: `/fichaje/v1/entries/${entryId}/corrections`,
      headers: conToken(token),
    });
    const [c] = historial.json().corrections;
    // La traza guarda INSTANTES (UTC), no horas de pared: es lo único que
    // sobrevive al cambio de hora. El "14:00" que leyó el empleado se
    // reconstruye al pintarlo.
    expect(new Date(c.oldValue).toISOString()).toBe(
      localToUtc(hoy, "14:00").toISOString(),
    );
    expect(new Date(c.newValue).toISOString()).toBe(
      localToUtc(hoy, "15:00").toISOString(),
    );
  });

  it('"Otro" sin texto no se escribe', async () => {
    const token = await emparejar(marta);
    const hoy = localDate(new Date(Date.now() - 86_400_000));
    const entryId = await sembrarTramo(marta, hoy, "08:00", "14:00");

    const res = await app.inject({
      method: "POST",
      url: `/fichaje/v1/entries/${entryId}/corrections`,
      headers: conToken(token),
      payload: {
        field: "started_at",
        value: localToUtc(hoy, "09:00").toISOString(),
        reasonCode: "OTRO",
      } as never,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("CORRECTION_REJECTED");
    // La hora no se ha movido.
    const fila = await prisma.timeEntry.findUniqueOrThrow({
      where: { id: entryId },
      select: { startedAt: true },
    });
    expect(fila.startedAt.toISOString()).toBe(
      localToUtc(hoy, "08:00").toISOString(),
    );
  });

  it("un motivo inventado ni llega al motor", async () => {
    const token = await emparejar(marta);
    const e = await entrar(token, new Date());
    const res = await app.inject({
      method: "POST",
      url: `/fichaje/v1/entries/${e.json().entry.id}/corrections`,
      headers: conToken(token),
      payload: {
        field: "started_at",
        value: new Date().toISOString(),
        reasonCode: "PORQUE_SI",
      } as never,
    });
    expect(res.statusCode).toBe(400);
  });

  it("una hora que todavía no ha pasado no se escribe", async () => {
    const token = await emparejar(marta);
    const e = await entrar(token, new Date(Date.now() - 3_600_000));
    const res = await app.inject({
      method: "POST",
      url: `/fichaje/v1/entries/${e.json().entry.id}/corrections`,
      headers: conToken(token),
      payload: {
        field: "ended_at",
        value: new Date(Date.now() + 6 * 3_600_000).toISOString(),
        reasonCode: "OLVIDO",
      } as never,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("CORRECTION_IN_FUTURE");
  });

  it("más de 30 días atrás sólo lo corrige la empresa", async () => {
    const token = await emparejar(marta);
    const viejo = new Date(Date.now() - 40 * 86_400_000);
    const row = await prisma.timeEntry.create({
      data: {
        tenantId,
        employeeId: marta,
        startedAt: viejo,
        startedServerAt: viejo,
        startSource: "MOBILE",
        endedAt: new Date(viejo.getTime() + 8 * 3_600_000),
        endedServerAt: new Date(viejo.getTime() + 8 * 3_600_000),
        endSource: "MOBILE",
      },
      select: { id: true },
    });
    const res = await app.inject({
      method: "POST",
      url: `/fichaje/v1/entries/${row.id}/corrections`,
      headers: conToken(token),
      payload: {
        field: "ended_at",
        value: new Date(viejo.getTime() + 9 * 3_600_000).toISOString(),
        reasonCode: "ERROR_HORA",
      } as never,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("CORRECTION_TOO_OLD");
    expect(res.json().message).toMatch(/tu empresa/i);
  });

  // ── mis fichajes ─────────────────────────────────────────────────────

  it("el mes sale agrupado por día, con totales y marcas", async () => {
    const token = await emparejar(marta);
    const hoy = localDate(new Date());
    await sembrarTramo(marta, hoy, "08:00", "14:00");
    await sembrarTramo(marta, hoy, "16:00", "19:00");

    const res = await app.inject({
      method: "GET",
      url: `/fichaje/v1/entries?month=${hoy.slice(0, 7)}`,
      headers: conToken(token),
    });
    expect(res.statusCode).toBe(200);
    const dia = res.json().days.find((d: any) => d.date === hoy);
    expect(dia.entries).toHaveLength(2);
    expect(dia.totalMinutes).toBe(9 * 60);
    expect(res.json().timeZone).toBe("Europe/Madrid");
  });
});
