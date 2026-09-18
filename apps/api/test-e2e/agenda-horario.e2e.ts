// B-reservas-7a · el horario del centro contra Postgres DE VERDAD.
//
// POR QUÉ ESTE FICHERO EXISTE. Tres cosas de este bloque no las decide el
// código, y las tres viven en la base de datos o en la puerta de la API:
//
//   1. **Los CHECK de la migración.** `agenda_slot_minutes IN (15,30)`, el
//      `@@unique` de `(tenant_id, date)` y el CHECK de coherencia de
//      `center_days` (cerrado ⇒ sin horas). Están escritos; que Postgres
//      los aplique de verdad no lo prueba ningún test en memoria.
//   2. **El techo tiene que valer por la PUERTA de la API**, con el motor
//      que construye `routes.ts` y la retícula que lee el gate — no un
//      motor inyectado en un test. La fuga de D-4b era exactamente ésa.
//   3. **La ausencia de DÍA ENTERO en el cambio de hora.** El rango que
//      acaba guardado en el `tstzrange` tiene que durar 25 horas el 25-10 y
//      23 el 29-03. Eso sólo se puede medir sobre la columna real.
//
// El centro es GENÉRICO: abre de martes a sábado de 9:00 a 20:00 y cierra
// el domingo. No es el de nadie.

import { randomBytes, randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { E2E_DATABASE_URL, e2eEnabled, SKIP_MESSAGE } from "./e2e-env.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  E2E_DATABASE_URL || "postgresql://e2e:e2e@127.0.0.1:5432/e2e";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET = "e".repeat(40);
process.env.JWT_REFRESH_SECRET = "f".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

vi.mock("../src/queues/ticket-upload.js", () => ({
  enqueueTicketUpload: async () => {},
}));
vi.mock("../src/queues/refund-upload.js", () => ({
  enqueueRefundUpload: async () => {},
}));
vi.mock("../src/queues/ticket-email.js", () => ({
  enqueueTicketEmail: async () => {},
}));

const { getPrisma, shutdown } = await import("../src/context.js");
const { registerAgendaRoutes } = await import("../src/agenda/routes.js");
const { registerAgendaHoursRoutes } = await import("../src/agenda/hours.js");
const { registerStaffRoutes } = await import("../src/staff/routes.js");
const { registerErrorHandler } = await import("../src/lib/error-handler.js");
const { registerLenientJsonParser } = await import("../src/lib/lenient-json.js");
const { signCashierSession } = await import("../src/shift/cashier-session.js");
const { signAccessToken } = await import("../src/auth/tokens.js");
const { utcToWallTime, wallTimeToUtc } = await import("../src/agenda/time.js");
const { isoWeekday } = await import("../src/agenda/center-hours.js");

describe.skipIf(!e2eEnabled)(
  "e2e · el horario del centro contra Postgres real",
  () => {
    if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

    const prisma = getPrisma();
    let app: FastifyInstance;

    let tenantId = "";
    let sinConfigurarId = "";
    let anaId = "";
    let corteId = "";
    // El centro de control tiene su PROPIO catálogo: pedirle huecos con el
    // servicio del otro tenant no probaría nada (el aislamiento por fila
    // devolvería cero y el test pasaría por la razón equivocada).
    let corteSinConfigurarId = "";
    let cajeraToken = "";
    let ownerToken = "";
    let sinConfigurarToken = "";

    const auth = (t: string) => ({ authorization: `Bearer ${t}` });

    // Las fechas del caso se calculan a partir de HOY + 30 días, para que
    // el suelo de 6a no tenga nada que ver: la agenda de dentro de un mes
    // está entera por delante del reloj, se corra la suite a la hora que
    // se corra.
    function enDias(n: number): string {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    }
    /** Una fecha futura que caiga en el día de la semana pedido (ISO). */
    function proximoDia(weekday: number, desde = 30): string {
      for (let i = desde; i < desde + 8; i++) {
        const d = enDias(i);
        if (isoWeekday(d) === weekday) return d;
      }
      throw new Error("no se encontró la fecha");
    }

    let MARTES = "";
    let DOMINGO = "";
    let SABADO = "";

    async function sembrarCentro(): Promise<void> {
      await prisma.centerHours.deleteMany({ where: { tenantId } });
      await prisma.centerHours.createMany({
        data: [2, 3, 4, 5, 6].map((weekday) => ({
          tenantId,
          weekday,
          openTime: "09:00",
          closeTime: "20:00",
          validFrom: new Date("2020-01-01T00:00:00.000Z"),
        })),
      });
    }

    async function huecosDe(date: string, token = cajeraToken) {
      const res = await app.inject({
        method: "POST",
        url: "/agenda/availability",
        headers: auth(token),
        payload: {
          items: [
            {
              serviceId:
                token === sinConfigurarToken ? corteSinConfigurarId : corteId,
            },
          ],
          from: date,
          to: date,
        },
      });
      expect(res.statusCode).toBe(200);
      return (
        res.json() as { slots: Array<{ start: string }> }
      ).slots.map((s) => utcToWallTime(new Date(s.start)));
    }

    beforeAll(async () => {
      app = Fastify({ logger: false });
      registerErrorHandler(app);
      registerLenientJsonParser(app);
      await registerStaffRoutes(app);
      await registerAgendaRoutes(app);
      await registerAgendaHoursRoutes(app);
      await app.ready();

      MARTES = proximoDia(2);
      DOMINGO = proximoDia(7);
      SABADO = proximoDia(6);

      const tenant = await prisma.tenant.create({
        data: { name: "Centro e2e 7a", agendaEnabled: true },
        select: { id: true },
      });
      tenantId = tenant.id;

      // El centro de control: MISMO catálogo y MISMO turno, pero sin
      // configurar nada de este bloque. Es la prueba de que un tenant que
      // no toca nada se comporta exactamente como antes.
      const otro = await prisma.tenant.create({
        data: { name: "Centro e2e sin configurar", agendaEnabled: true },
        select: { id: true },
      });
      sinConfigurarId = otro.id;

      for (const tid of [tenantId, sinConfigurarId]) {
        const store_ = await prisma.store.create({
          data: { tenantId: tid, name: "Local e2e" },
          select: { id: true },
        });
        const register = await prisma.register.create({
          data: { storeId: store_.id, name: "Caja 1" },
          select: { id: true },
        });
        const cashier = await prisma.user.create({
          data: {
            tenantId: tid,
            email: `caja+${randomUUID()}@e2e.local`,
            alias: "Caja",
            role: "CASHIER",
          },
          select: { id: true },
        });
        const owner = await prisma.user.create({
          data: {
            tenantId: tid,
            email: `owner+${randomUUID()}@e2e.local`,
            alias: "Owner",
            role: "OWNER",
          },
          select: { id: true },
        });
        const corte = await prisma.product.create({
          data: {
            tenantId: tid,
            holdedProductId: `h-corte-${randomUUID()}`,
            name: "Corte de pelo",
            sku: "SVC-CORTE",
            basePrice: "14.8760",
            taxRate: "21",
            kind: "SERVICE",
          },
          select: { id: true },
        });
        await prisma.serviceScheduling.create({
          data: { productId: corte.id, tenantId: tid, durationMin: 30 },
        });
        const ana = await prisma.user.create({
          data: {
            tenantId: tid,
            email: `ana+${randomUUID()}@e2e.local`,
            alias: "Ana",
            role: "CASHIER",
          },
          select: { id: true },
        });
        await prisma.staffProfile.create({
          data: { userId: ana.id, tenantId: tid, displayName: "Ana", active: true },
        });
        await prisma.staffSkill.create({
          data: { userId: ana.id, tenantId: tid, serviceId: corte.id },
        });
        // El turno ANCHO que hoy abre el centro de par en par: 09:00–22:30
        // todos los días. Es el caso del criterio de hecho.
        await prisma.staffShift.create({
          data: {
            userId: ana.id,
            tenantId: tid,
            rrule: "FREQ=DAILY",
            startTime: "09:00",
            endTime: "22:30",
            validFrom: new Date("2020-01-01T00:00:00.000Z"),
          },
        });
        const token = signCashierSession(
          {
            sub: cashier.id,
            tid,
            did: randomUUID(),
            rid: register.id,
            role: "CASHIER",
          },
          720,
        );
        if (tid === tenantId) {
          anaId = ana.id;
          corteId = corte.id;
          cajeraToken = token;
          ownerToken = signAccessToken({ sub: owner.id, tid, role: "OWNER" });
        } else {
          corteSinConfigurarId = corte.id;
          sinConfigurarToken = token;
        }
      }

      await sembrarCentro();
    });

    afterAll(async () => {
      await app?.close();
      await shutdown();
    });

    // ── 1 · El techo, por la puerta de la API ───────────────────────

    it("1 · con el centro de 9 a 20 y el turno hasta las 22:30, nada después de las 20:00", async () => {
      const horas = await huecosDe(MARTES);
      expect(horas[0]).toBe("09:00");
      expect(horas[horas.length - 1]).toBe("19:30");
      expect(horas).not.toContain("20:00");
      expect(horas).not.toContain("22:00");
    });

    it("2 · el domingo da CERO huecos aunque Ana tenga turno", async () => {
      expect(await huecosDe(DOMINGO)).toEqual([]);
    });

    it("3 · un tenant SIN configurar da exactamente lo de siempre", async () => {
      // Mismo catálogo, mismo turno, cero filas de horario: el turno
      // entero, hasta las 22:00. Ésta es la prueba de la compatibilidad.
      const horas = await huecosDe(MARTES, sinConfigurarToken);
      expect(horas[0]).toBe("09:00");
      expect(horas[horas.length - 1]).toBe("22:00");
      // Y el domingo sigue abriendo, porque su techo no existe.
      expect((await huecosDe(DOMINGO, sinConfigurarToken)).length)
        .toBeGreaterThan(0);
    });

    // ── 2 · Los días especiales ─────────────────────────────────────

    it("4 · un festivo con nombre da cero huecos · invariante 13", async () => {
      const alta = await app.inject({
        method: "POST",
        url: "/admin/agenda/hours/days",
        headers: auth(ownerToken),
        payload: { date: MARTES, closed: true, name: "Virgen del Prado" },
      });
      expect(alta.statusCode).toBe(201);
      expect(await huecosDe(MARTES)).toEqual([]);
    });

    it("5 · y la rejilla dice «Cerrado · ese nombre»", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/agenda?date=${MARTES}`,
        headers: auth(cajeraToken),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        slotMinutes: number;
        days: Array<{
          date: string;
          closed: { name: string | null } | null;
          staffOpen: Record<string, unknown[]>;
        }>;
      };
      expect(body.days[0]!.closed).toEqual({ name: "Virgen del Prado" });
      expect(body.days[0]!.staffOpen[anaId]).toEqual([]);
    });

    it("6 · quitar el festivo devuelve los huecos", async () => {
      const lista = await app.inject({
        method: "GET",
        url: "/admin/agenda/hours",
        headers: auth(ownerToken),
      });
      const { days } = lista.json() as {
        days: Array<{ id: string; date: string }>;
      };
      const festivo = days.find((d) => d.date === MARTES)!;
      const del = await app.inject({
        method: "DELETE",
        url: `/admin/agenda/hours/days/${festivo.id}`,
        headers: auth(ownerToken),
      });
      expect(del.statusCode).toBe(200);
      expect((await huecosDe(MARTES)).length).toBeGreaterThan(0);
    });

    it("7 · el sábado de boda de 8:30 a 14:00, con refuerzo, ofrece las 8:30", async () => {
      const alta = await app.inject({
        method: "POST",
        url: "/admin/agenda/hours/days",
        headers: auth(ownerToken),
        payload: {
          date: SABADO,
          closed: false,
          name: "boda Marta",
          openTime: "08:30",
          closeTime: "14:00",
        },
      });
      expect(alta.statusCode).toBe(201);

      // Sin refuerzo NO ofrece las 8:30: el techo recorta el turno, no lo
      // crea. Ana entra a las 9:00.
      expect(await huecosDe(SABADO)).not.toContain("08:30");

      // La pantalla lo detecta…
      const cob = await app.inject({
        method: "GET",
        url: `/admin/agenda/hours/coverage?date=${SABADO}&time=08:30`,
        headers: auth(ownerToken),
      });
      expect(cob.statusCode).toBe(200);
      const coverage = cob.json() as {
        covered: boolean;
        candidates: Array<{ userId: string }>;
      };
      expect(coverage.covered).toBe(false);
      expect(coverage.candidates.map((c) => c.userId)).toContain(anaId);

      // …y el refuerzo de un día, con la API de turnos de B3.
      const refuerzo = await app.inject({
        method: "POST",
        url: `/staff/${anaId}/shifts`,
        headers: auth(ownerToken),
        payload: {
          rrule: "FREQ=WEEKLY;BYDAY=SA",
          startTime: "08:30",
          endTime: "14:00",
          validFrom: SABADO,
          validUntil: SABADO,
          kind: "REINFORCEMENT",
        },
      });
      expect(refuerzo.statusCode).toBe(201);

      const horas = await huecosDe(SABADO);
      expect(horas[0]).toBe("08:30");
      // Y SUSTITUYE al horario semanal: nada por la tarde.
      expect(horas).not.toContain("15:00");
      expect(horas[horas.length - 1]).toBe("13:30");
    });

    // ── 3 · La retícula ─────────────────────────────────────────────

    it("8 · con la retícula a 30 no hay ningún inicio a y cuarto", async () => {
      const put = await app.inject({
        method: "PUT",
        url: "/admin/agenda/hours/slot",
        headers: auth(ownerToken),
        payload: { slotMinutes: 30 },
      });
      expect(put.statusCode).toBe(200);
      const horas = await huecosDe(MARTES);
      expect(horas.length).toBeGreaterThan(0);
      for (const h of horas) expect(["00", "30"]).toContain(h.slice(3));
    });

    it("9 · y el alta a las 10:15 se rechaza con la frase de la media hora", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/agenda/appointments",
        headers: auth(cajeraToken),
        payload: {
          items: [{ serviceId: corteId }],
          start: wallTimeToUtc(MARTES, "10:15").toISOString(),
          source: "PRESENCIAL",
        },
      });
      expect(res.statusCode).toBe(409);
      const body = res.json() as { error: string; message: string };
      expect(body.error).toBe("BOOKING_OFF_GRID");
      expect(body.message).toContain("cada media hora");
    });

    it("10 · el GET del día lleva la retícula, para que el front no la invente", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/agenda?date=${MARTES}`,
        headers: auth(cajeraToken),
      });
      expect((res.json() as { slotMinutes: number }).slotMinutes).toBe(30);
    });

    it("11 · POSTGRES rechaza una retícula que no es 15 ni 30", async () => {
      // El CHECK de la migración, ejecutándose. La ruta sólo admite 15 y
      // 30; esto prueba la última línea de defensa.
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE tenants SET agenda_slot_minutes = 20 WHERE id = $1::uuid`,
          tenantId,
        ),
      ).rejects.toThrow();
      // Y se deja como estaba para los casos que siguen.
      const t = await prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { agendaSlotMinutes: true },
      });
      expect(t.agendaSlotMinutes).toBe(30);
    });

    // ── 4 · Las ausencias ───────────────────────────────────────────

    it("12 · una ausencia puesta desde la agenda quita esos huecos", async () => {
      // Se vuelve a 15 para que las 09:00–10:30 se lean igual que en el
      // Excel de Sole.
      await app.inject({
        method: "PUT",
        url: "/admin/agenda/hours/slot",
        headers: auth(ownerToken),
        payload: { slotMinutes: 15 },
      });
      const alta = await app.inject({
        method: "POST",
        url: "/agenda/blocks",
        headers: auth(cajeraToken), // la pone la CAJERA, no el owner
        payload: {
          scope: "STAFF",
          staffUserId: anaId,
          date: MARTES,
          startTime: "09:00",
          endTime: "10:30",
          reason: "ISA NO",
        },
      });
      expect(alta.statusCode).toBe(201);
      const horas = await huecosDe(MARTES);
      expect(horas).not.toContain("09:00");
      expect(horas).not.toContain("10:00");
      expect(horas[0]).toBe("10:30");
    });

    it("13 · y se pinta en su columna con su id y su motivo", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/agenda?date=${MARTES}`,
        headers: auth(cajeraToken),
      });
      const body = res.json() as {
        days: Array<{
          absences: Array<{
            id: string;
            staffUserId: string;
            startTime: string;
            endTime: string;
            reason: string;
          }>;
        }>;
      };
      expect(body.days[0]!.absences).toHaveLength(1);
      expect(body.days[0]!.absences[0]).toMatchObject({
        staffUserId: anaId,
        startTime: "09:00",
        endTime: "10:30",
        reason: "ISA NO",
      });
      // El id hace falta para poder quitarla tocándola.
      expect(body.days[0]!.absences[0]!.id).toBeTruthy();

      const borrado = await app.inject({
        method: "DELETE",
        url: `/agenda/blocks/${body.days[0]!.absences[0]!.id}`,
        headers: auth(cajeraToken),
      });
      expect(borrado.statusCode).toBe(200);
      expect(await huecosDe(MARTES)).toContain("09:00");
    });

    it("14 · la ausencia de DÍA ENTERO dura 25 h el 25-10 y 23 h el 29-03", async () => {
      // El rango que acaba en el `tstzrange`: se mide sobre la columna.
      for (const [fecha, horas] of [
        ["2026-10-25", 25],
        ["2027-03-28", 23],
      ] as const) {
        const alta = await app.inject({
          method: "POST",
          url: "/agenda/blocks",
          headers: auth(cajeraToken),
          payload: {
            scope: "STAFF",
            staffUserId: anaId,
            date: fecha,
            startTime: "00:00",
            endTime: "24:00",
            reason: "Ana libre",
          },
        });
        expect(alta.statusCode).toBe(201);
        const { id } = alta.json() as { id: string };
        const rows = await prisma.$queryRawUnsafe<
          Array<{ horas: string }>
        >(
          `SELECT EXTRACT(EPOCH FROM (upper(slot) - lower(slot))) / 3600 AS horas
             FROM booking_blocks WHERE id = $1::uuid`,
          id,
        );
        expect(Number(rows[0]!.horas)).toBe(horas);
      }
    });

    // ── 5 · Las citas ya dadas no se mueven ─────────────────────────

    it("15 · el simulacro dice qué citas quedarían fuera, y no toca ninguna", async () => {
      // Una cita legal a las 19:30, dentro del horario de hoy.
      const alta = await app.inject({
        method: "POST",
        url: "/agenda/appointments",
        headers: auth(cajeraToken),
        payload: {
          items: [{ serviceId: corteId }],
          start: wallTimeToUtc(MARTES, "19:30").toISOString(),
          source: "PRESENCIAL",
        },
      });
      expect(alta.statusCode).toBe(201);
      const citaId = (alta.json() as { appointment: { id: string } })
        .appointment.id;

      // Acortar el horario a las 14:00 la dejaría fuera.
      const impacto = await app.inject({
        method: "POST",
        url: "/admin/agenda/hours/impact",
        headers: auth(ownerToken),
        payload: {
          week: [2, 3, 4, 5, 6].map((weekday) => ({
            weekday,
            openTime: "09:00",
            closeTime: "14:00",
          })),
        },
      });
      expect(impacto.statusCode).toBe(200);
      const body = impacto.json() as {
        count: number;
        appointments: Array<{ id: string; wallTime: string; reason: string }>;
      };
      expect(body.appointments.map((a) => a.id)).toContain(citaId);
      expect(
        body.appointments.find((a) => a.id === citaId)!.reason,
      ).toBe("OUT_OF_HOURS");

      // Y NADA se ha tocado: el simulacro no escribe.
      const sigue = await prisma.$queryRawUnsafe<
        Array<{ status: string }>
      >(
        `SELECT status::text AS status FROM appointments WHERE id = $1::uuid`,
        citaId,
      );
      expect(sigue[0]!.status).toBe("CONFIRMED");
    });

    it("16 · guardar el horario corto TAMPOCO la cancela ni la mueve", async () => {
      const antes = await prisma.$queryRawUnsafe<
        Array<{ status: string; starts: Date }>
      >(
        `SELECT status::text AS status, lower(timeslot) AS starts
           FROM appointments WHERE tenant_id = $1::uuid
          ORDER BY lower(timeslot)`,
        tenantId,
      );
      const put = await app.inject({
        method: "PUT",
        url: "/admin/agenda/hours/week",
        headers: auth(ownerToken),
        payload: {
          rows: [2, 3, 4, 5, 6].map((weekday) => ({
            weekday,
            openTime: "09:00",
            closeTime: "14:00",
          })),
        },
      });
      expect(put.statusCode).toBe(200);
      const despues = await prisma.$queryRawUnsafe<
        Array<{ status: string; starts: Date }>
      >(
        `SELECT status::text AS status, lower(timeslot) AS starts
           FROM appointments WHERE tenant_id = $1::uuid
          ORDER BY lower(timeslot)`,
        tenantId,
      );
      expect(despues).toEqual(antes);
      // La agenda ya no OFRECE las 19:30, pero la cita sigue ahí.
      expect(await huecosDe(MARTES)).not.toContain("19:30");
      await sembrarCentro();
    });

    // ── 6 · Los CHECK de la migración ───────────────────────────────

    it("17 · POSTGRES rechaza un día especial cerrado CON horas", async () => {
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO center_days
             (id, tenant_id, date, closed, name, open_time, close_time, created_at, updated_at)
           VALUES (gen_random_uuid(), $1::uuid, DATE '2029-01-01', true, 'raro', '09:00', '14:00', now(), now())`,
          tenantId,
        ),
      ).rejects.toThrow();
    });

    it("18 · POSTGRES rechaza un día especial sin nombre", async () => {
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO center_days
             (id, tenant_id, date, closed, name, created_at, updated_at)
           VALUES (gen_random_uuid(), $1::uuid, DATE '2029-01-02', true, '   ', now(), now())`,
          tenantId,
        ),
      ).rejects.toThrow();
    });

    it("19 · POSTGRES rechaza DOS días especiales en la misma fecha", async () => {
      await prisma.$executeRawUnsafe(
        `INSERT INTO center_days
           (id, tenant_id, date, closed, name, created_at, updated_at)
         VALUES (gen_random_uuid(), $1::uuid, DATE '2029-02-01', true, 'uno', now(), now())`,
        tenantId,
      );
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO center_days
             (id, tenant_id, date, closed, name, created_at, updated_at)
           VALUES (gen_random_uuid(), $1::uuid, DATE '2029-02-01', true, 'dos', now(), now())`,
          tenantId,
        ),
      ).rejects.toThrow();
    });

    it("20 · y el mismo día especial en OTRO centro sí entra: multi-tenant por fila", async () => {
      const res = await prisma.$executeRawUnsafe(
        `INSERT INTO center_days
           (id, tenant_id, date, closed, name, created_at, updated_at)
         VALUES (gen_random_uuid(), $1::uuid, DATE '2029-02-01', true, 'suyo', now(), now())`,
        sinConfigurarId,
      );
      expect(res).toBe(1);
      // Y el centro sin configurar SIGUE sin techo el resto de días: un
      // día especial suelto no le inventa una semana tipo.
      const horas = await huecosDe(MARTES, sinConfigurarToken);
      expect(horas[horas.length - 1]).toBe("22:00");
    });

    it("21 · el gate de agenda corta las rutas de horario", async () => {
      const apagado = await prisma.tenant.create({
        data: { name: "Centro apagado", agendaEnabled: false },
        select: { id: true },
      });
      const u = await prisma.user.create({
        data: {
          tenantId: apagado.id,
          email: `off+${randomUUID()}@e2e.local`,
          alias: "Owner",
          role: "OWNER",
        },
        select: { id: true },
      });
      const t = signAccessToken({ sub: u.id, tid: apagado.id, role: "OWNER" });
      const res = await app.inject({
        method: "GET",
        url: "/admin/agenda/hours",
        headers: auth(t),
      });
      expect(res.statusCode).toBe(403);
      expect((res.json() as { error: string }).error).toBe("AGENDA_DISABLED");
    });
  },
);
