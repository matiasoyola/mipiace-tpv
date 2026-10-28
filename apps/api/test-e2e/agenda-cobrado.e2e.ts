// agenda-1 · LO COBRADO DE CADA CITA, CONTRA POSTGRES DE VERDAD.
//
// `cobradoPorCitaDe` es SQL en crudo, y el SQL en crudo **no lo prueba
// ningún test de unidad**: aquí es el único sitio donde se ve si la
// consulta existe, si devuelve lo que dice y si cuenta lo que debe.
//
// Lo escribió un rojo. La primera versión comparaba
// `t.status = ANY($4::text[])` contra `tickets.status`, que es un ENUM de
// Postgres: no existe el operador `"TicketStatus" = text`, la consulta
// revienta y **`GET /agenda` contesta 500** — la agenda entera caída, con
// 6.968 tests de unidad en verde y `tsc` limpio.
//
// ── Las tres cosas que se fijan, y por qué cada una ──────────────────
//
//   1. una cita cobrada aparece con LOS CÉNTIMOS DEL TICKET. No del
//      catálogo: sumar el precio de los servicios RESERVADOS es cobrar la
//      previsión en vez del trabajo, que es lo que clinica-8 cerró.
//   2. una cita cuyo borrador sigue en DRAFT **no** aparece. Un DRAFT es
//      un cobro empezado y no terminado — es justo lo que
//      `sesionesPorCobrar` cuenta como PENDIENTE. Sumarlo diría que hay
//      dinero que no hay.
//   3. **una cuenta EN ENSAYO no enseña dinero.** Antes de que el comercio
//      arranque (`fiscal_go_live_at` nulo) todo cobro nace `TEST`
//      (`esCobroDeEnsayo`, ADR-021) y `purgeTestData` lo borra al activar:
//      nunca fue dinero. Esta tercera la aprendió el banco a golpes — el
//      e2e de cita→caja monta un tenant en ensayo, así que su ticket era
//      `TEST` y la cifra salía vacía con la consulta bien.
//
// Tenant propio y no el de `cita-a-caja.e2e.ts`: aquel fichero encadena
// nueve tests sobre el mismo ticket y censa borradores huérfanos, así que
// cualquier cita o ticket de más le descuadra las cuentas.

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

// El borde con Redis/Holded. Aquí no se prueba el ERP.
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
const { registerTicketRoutes } = await import("../src/tickets/routes.js");
const { registerAgendaRoutes } = await import("../src/agenda/routes.js");
const { registerErrorHandler } = await import("../src/lib/error-handler.js");
const { registerLenientJsonParser } = await import("../src/lib/lenient-json.js");
const { signCashierSession } = await import("../src/shift/cashier-session.js");
const { createAgendaStore } = await import("../src/agenda/store.js");

describe.skipIf(!e2eEnabled)("e2e · lo cobrado de cada cita", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  const store = createAgendaStore(prisma);

  let app: FastifyInstance;
  let tenantId: string;
  let cashierId: string;
  let token: string;
  let servicioId: string;

  const auth = () => ({ authorization: `Bearer ${token}` });

  /** El día del banco. Las citas van a horas que no se solapan. */
  const DIA = "2026-09-17";

  async function crearCita(horaUtc: string): Promise<string> {
    const start = new Date(`${DIA}T${horaUtc}:00.000Z`);
    const item = {
      serviceId: servicioId,
      durationMin: 30,
      bufferBeforeMin: 0,
      bufferAfterMin: 0,
      staffRequired: 1,
      sortOrder: 0,
      startOffsetMin: 0,
    };
    const view = await store.insertHold({
      tenantId,
      externalId: randomUUID(),
      clientId: null,
      source: "PRESENCIAL",
      status: "CONFIRMED",
      pendingUntil: null,
      notes: null,
      timeslotStart: start,
      timeslotEnd: new Date(start.getTime() + 30 * 60_000),
      items: [item],
      assignments: [
        {
          appointmentItemIndex: 0,
          reservableType: "STAFF",
          staffUserId: cashierId,
          resourceId: null,
          startsAt: start,
          endsAt: new Date(start.getTime() + 30 * 60_000),
        },
      ],
    });
    return view.id;
  }

  /** Abre el borrador de la cita y devuelve su id. */
  async function abrirBorrador(apptId: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: `/agenda/appointments/${apptId}/checkout`,
      headers: auth(),
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { ticket: { id: string } }).ticket.id;
  }

  /** Lo cobrado del día, tal como lo manda `GET /agenda`. */
  async function cobradoDelDia(): Promise<Record<string, number>> {
    const res = await app.inject({
      method: "GET",
      url: `/agenda?date=${DIA}`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { cobradoPorCita: Record<string, number> })
      .cobradoPorCita;
  }

  async function estadoDelTicket(id: string): Promise<string> {
    const rows = await prisma.$queryRaw<Array<{ status: string }>>`
      SELECT status::text AS status FROM tickets WHERE id = ${id}::uuid
    `;
    return rows[0]!.status;
  }

  beforeAll(async () => {
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    registerLenientJsonParser(app);
    await registerTicketRoutes(app);
    await registerAgendaRoutes(app);
    await app.ready();

    const tenant = await prisma.tenant.create({
      data: {
        name: "Clínica cobrado e2e",
        agendaEnabled: true,
        // ADR-021 · LA CUENTA YA ARRANCÓ. Sin esto el comercio está en
        // ENSAYO y todo cobro nace `TEST` (`esCobroDeEnsayo`), que es el
        // caso del tercer test — y el que hizo fallar la primera versión
        // de este banco cuando vivía en `cita-a-caja.e2e.ts`.
        facturaDesde: new Date("2026-01-01T00:00:00.000Z"),
      },
      select: { id: true },
    });
    tenantId = tenant.id;

    const local = await prisma.store.create({
      data: { tenantId, name: "Local e2e" },
      select: { id: true },
    });
    const register = await prisma.register.create({
      data: { storeId: local.id, name: "Caja 1" },
      select: { id: true },
    });

    const cashier = await prisma.user.create({
      data: {
        tenantId,
        email: `rosario+${randomUUID()}@e2e.local`,
        alias: "Rosario",
        role: "CASHIER",
      },
      select: { id: true },
    });
    cashierId = cashier.id;

    await prisma.shift.create({
      data: { registerId: register.id, userId: cashierId, cashOpening: "50" },
      select: { id: true },
    });

    // 20,6612 netos al 21 % = 25,00 € con IVA, que son 2500 céntimos.
    const servicio = await prisma.product.create({
      data: {
        tenantId,
        holdedProductId: `h-quiro-${randomUUID()}`,
        name: "Quiropodia básica",
        sku: "SVC-QUIRO",
        basePrice: "20.6612",
        taxRate: "21",
        kind: "SERVICE",
      },
      select: { id: true },
    });
    servicioId = servicio.id;

    token = signCashierSession(
      {
        sub: cashierId,
        tid: tenantId,
        did: randomUUID(),
        rid: register.id,
        role: "CASHIER",
      },
      720,
    );
  });

  afterAll(async () => {
    await app?.close();
    await shutdown();
  });

  it("1 · una cita cobrada sale con los céntimos DEL TICKET", async () => {
    const apptId = await crearCita("08:00");
    const draftId = await abrirBorrador(apptId);

    const cobro = await app.inject({
      method: "POST",
      url: `/tickets/${draftId}/checkout`,
      headers: auth(),
      payload: {
        externalId: randomUUID(),
        payments: [{ method: "CASH", amount: 25 }],
      },
    });
    expect(cobro.statusCode).toBe(200);

    // La cuenta ya arrancó, así que el ticket es dinero de verdad y no un
    // ensayo. Si esto cambiara, el test de abajo diría por qué.
    expect(["PAID", "PENDING_SYNC", "SYNCED", "SYNC_FAILED"]).toContain(
      await estadoDelTicket(draftId),
    );

    const cobrado = await cobradoDelDia();
    expect(cobrado[apptId]).toBe(2500);
  });

  it("2 · una cita con el borrador en DRAFT no cuenta como cobrada", async () => {
    const apptId = await crearCita("09:00");
    const draftId = await abrirBorrador(apptId);
    expect(await estadoDelTicket(draftId)).toBe("DRAFT");

    const cobrado = await cobradoDelDia();
    expect(cobrado[apptId]).toBeUndefined();
  });

  it("3 · una cita SIN ticket tampoco: no está en el mapa, y no es 0 €", async () => {
    // La diferencia importa en la pantalla: «no está» se pinta «Hecha» o
    // «Por llegar», y un 0 se pintaría «Cobrada · 0 €».
    const apptId = await crearCita("10:00");
    const cobrado = await cobradoDelDia();
    expect(Object.prototype.hasOwnProperty.call(cobrado, apptId)).toBe(false);
  });

  it("4 · EN ENSAYO no se enseña dinero: el cobro nace TEST", async () => {
    // ADR-021 · antes de que el comercio arranque, todo cobro es un
    // ensayo: nace `TEST` y `purgeTestData` lo borra al activar. Nunca fue
    // dinero, así que la cifra del día no lo cuenta.
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { facturaDesde: null },
    });

    const apptId = await crearCita("11:00");
    const draftId = await abrirBorrador(apptId);
    const cobro = await app.inject({
      method: "POST",
      url: `/tickets/${draftId}/checkout`,
      headers: auth(),
      payload: {
        externalId: randomUUID(),
        payments: [{ method: "CASH", amount: 25 }],
      },
    });
    expect(cobro.statusCode).toBe(200);
    expect(await estadoDelTicket(draftId)).toBe("TEST");

    const cobrado = await cobradoDelDia();
    expect(cobrado[apptId]).toBeUndefined();

    // Y la del test 1, que se cobró con la cuenta arrancada, sigue ahí: lo
    // que se descarta es el ensayo, no el día entero.
    expect(Object.values(cobrado)).toEqual([2500]);

    // Se deja como estaba para quien venga detrás.
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { facturaDesde: new Date("2026-01-01T00:00:00.000Z") },
    });
  });
});
