// B-reservas-5 · el puente cita→caja contra Postgres de verdad.
//
// POR QUÉ ESTE FICHERO EXISTE. Los tests de agenda del repo corren sobre
// un prisma falso y un `AgendaStore` en memoria (B4 §Decisiones 1: "el
// harness del repo es fake-prisma"). Ahí los TRIGGERS DE S1 NO EXISTEN, y
// el criterio de este bloque —"en BD hay UN SOLO ticket para esa cita,
// `paid_at` puesto y cero borradores sobrantes"— es una afirmación sobre
// la base de datos, no sobre la lógica. Con un prisma falso se estaría
// probando exactamente lo contrario de lo que cierra el bloque
// (`s1-sello-de-la-venta-done.md` §3, misma frase).
//
// Lo que se prueba, en un solo camino, el de Sole:
//
//   1. cita de dos servicios (corte + tinte) → "Cobrar en caja"
//   2. el borrador nace pre-poblado, con serviceId y SIN sku ad-hoc, y la
//      cita queda enlazada y en sala
//   3. volver a pulsar devuelve EL MISMO borrador (no un segundo)
//   4. el cobro paga ESE borrador: un ticket, el mismo id, con paid_at
//   5. y queda SELLADO por S1 — el enlace de la cita apunta al registro
//      protegido, que es lo que antes no pasaba
//   6. la cita pasa a COMPLETED
//   7. una cita ya cobrada NO se vuelve a cobrar
//   8. el censo de huérfanos ve el bug cuando el bug existe, y no lo ve
//      cuando no
//
// REGLA, heredada de v1.13: cada aserción va contra la BD por SQL, no
// contra la respuesta del API. Si el test puede pasar con la BD vacía, no
// es un e2e.

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

describe.skipIf(!e2eEnabled)("e2e · cita → caja contra Postgres real", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  const store = createAgendaStore(prisma);
  let app: FastifyInstance;

  let tenantId = "";
  let registerId = "";
  let cashierId = "";
  let shiftId = "";
  let token = "";
  let corteId = "";
  let tinteId = "";

  // La cita del camino principal y su borrador.
  let apptId = "";
  let draftId = "";

  const auth = () => ({ authorization: `Bearer ${token}` });

  // ── aserciones contra la BD ─────────────────────────────────────────

  interface TicketRow {
    id: string;
    status: string;
    total: string;
    internal_number: string;
    paid_at: Date | null;
    sealed_at: Date | null;
    sealed_hash: string | null;
    table_id: string | null;
  }

  async function ticketRow(id: string): Promise<TicketRow> {
    const rows = await prisma.$queryRaw<TicketRow[]>`
      SELECT id::text AS id, status::text AS status, total::text AS total,
             internal_number, paid_at, sealed_at, sealed_hash,
             table_id::text AS table_id
        FROM tickets WHERE id = ${id}::uuid
    `;
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  async function appointmentRow(
    id: string,
  ): Promise<{ status: string; ticket_id: string | null }> {
    const rows = await prisma.$queryRaw<
      Array<{ status: string; ticket_id: string | null }>
    >`
      SELECT status::text AS status, ticket_id::text AS ticket_id
        FROM appointments WHERE id = ${id}::uuid
    `;
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  /** Todos los tickets del tenant que NO son el borrador enlazado. Es la
   *  forma directa de preguntar "¿el cobro abrió un ticket nuevo?". */
  async function ticketsDelTenant(): Promise<
    Array<{ id: string; status: string; total: string }>
  > {
    return prisma.$queryRaw`
      SELECT id::text AS id, status::text AS status, total::text AS total
        FROM tickets WHERE tenant_id = ${tenantId}::uuid
       ORDER BY created_at
    `;
  }

  async function draftsHuerfanos(): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*) AS n
        FROM appointments a
        JOIN tickets d ON d.id = a.ticket_id
       WHERE a.tenant_id = ${tenantId}::uuid AND d.status = 'DRAFT'
    `;
    return Number(rows[0]!.n);
  }

  async function lineasDelTicket(
    id: string,
  ): Promise<Array<{ sku: string; product_id: string | null; holded_product_id: string; name_snapshot: string; total: string }>> {
    return prisma.$queryRaw`
      SELECT sku, product_id::text AS product_id,
             holded_product_id, name_snapshot, total::text AS total
        FROM ticket_lines WHERE ticket_id = ${id}::uuid
       ORDER BY id
    `;
  }

  // ── siembra ─────────────────────────────────────────────────────────

  // `horaUtc` existe porque el anti-solape es DE VERDAD aquí: dos citas
  // de la misma profesional a la misma hora las rechaza el EXCLUDE USING
  // gist, no el código. Con el store en memoria de los tests de B4 esto
  // no se habría notado.
  async function crearCita(
    servicios: string[],
    horaUtc = "08:00",
  ): Promise<string> {
    const start = new Date(`2026-09-10T${horaUtc}:00.000Z`);
    let offset = 0;
    const items = servicios.map((serviceId, i) => {
      const it = {
        serviceId,
        durationMin: 30,
        bufferBeforeMin: 0,
        bufferAfterMin: 0,
        staffRequired: 1,
        sortOrder: i,
        startOffsetMin: offset,
      };
      offset += 30;
      return it;
    });
    const view = await store.insertHold({
      tenantId,
      externalId: randomUUID(),
      clientId: null,
      source: "PRESENCIAL",
      status: "CONFIRMED",
      pendingUntil: null,
      notes: null,
      timeslotStart: start,
      timeslotEnd: new Date(start.getTime() + offset * 60_000),
      items,
      assignments: items.map((it, i) => ({
        appointmentItemIndex: i,
        reservableType: "STAFF",
        staffUserId: cashierId,
        resourceId: null,
        // Slots que no se solapan entre sí: el EXCLUDE es real aquí.
        startsAt: new Date(start.getTime() + it.startOffsetMin * 60_000),
        endsAt: new Date(
          start.getTime() + (it.startOffsetMin + it.durationMin) * 60_000,
        ),
      })),
    });
    return view.id;
  }

  beforeAll(async () => {
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    registerLenientJsonParser(app);
    await registerTicketRoutes(app);
    await registerAgendaRoutes(app);
    await app.ready();

    const tenant = await prisma.tenant.create({
      // El gate del módulo. Sin esto todas las rutas dan 403
      // AGENDA_DISABLED, que es como está hoy producción.
      data: { name: "Peluquería e2e", agendaEnabled: true },
      select: { id: true },
    });
    tenantId = tenant.id;

    const store_ = await prisma.store.create({
      data: { tenantId, name: "Local e2e" },
      select: { id: true },
    });
    const register = await prisma.register.create({
      data: { storeId: store_.id, name: "Caja 1" },
      select: { id: true },
    });
    registerId = register.id;

    const cashier = await prisma.user.create({
      data: {
        tenantId,
        email: `sole+${randomUUID()}@e2e.local`,
        alias: "Sole",
        role: "CASHIER",
      },
      select: { id: true },
    });
    cashierId = cashier.id;

    const shift = await prisma.shift.create({
      data: {
        registerId,
        userId: cashierId,
        cashOpening: "50",
      },
      select: { id: true },
    });
    shiftId = shift.id;

    // Los servicios. `serviceId` = `product.id` (memoria
    // holded-services-serviceid): la línea de la cita se resuelve por
    // producto, nunca por un sku inventado.
    const corte = await prisma.product.create({
      data: {
        tenantId,
        holdedProductId: `h-corte-${randomUUID()}`,
        name: "Corte de pelo",
        sku: "SVC-CORTE",
        basePrice: "14.8760",
        taxRate: "21",
        kind: "SERVICE",
      },
      select: { id: true },
    });
    corteId = corte.id;
    const tinte = await prisma.product.create({
      data: {
        tenantId,
        holdedProductId: `h-tinte-${randomUUID()}`,
        name: "Tinte completo",
        sku: "SVC-TINTE",
        basePrice: "37.1900",
        taxRate: "21",
        kind: "SERVICE",
      },
      select: { id: true },
    });
    tinteId = tinte.id;

    token = signCashierSession(
      {
        sub: cashierId,
        tid: tenantId,
        did: randomUUID(),
        rid: registerId,
        role: "CASHIER",
      },
      720,
    );
  });

  afterAll(async () => {
    await app?.close();
    await shutdown();
  });

  it("1 · 'Cobrar en caja' abre un borrador pre-poblado y enlaza la cita", async () => {
    apptId = await crearCita([corteId, tinteId]);

    const res = await app.inject({
      method: "POST",
      url: `/agenda/appointments/${apptId}/checkout`,
      headers: auth(),
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    draftId = (res.json() as { ticket: { id: string } }).ticket.id;

    // Contra la BD: el borrador existe, es DRAFT, no es de ninguna mesa.
    const t = await ticketRow(draftId);
    expect(t.status).toBe("DRAFT");
    expect(t.table_id).toBeNull();
    // Un borrador NO está sellado. El sello es de la venta, no del papel
    // en curso (ADR-015 §3).
    expect(t.sealed_at).toBeNull();

    // Las dos líneas, por producto y con el enlace a Holded puesto. Esto
    // es lo que el mapeo a mano del front perdía (ponía holdedProductId
    // a null).
    //
    // HALLAZGO, no arreglado en este bloque: el ORDEN de las líneas de un
    // ticket no está definido en ninguna parte. `ticketInclude()` pide
    // `lines: true` sin `orderBy`, y `ticket_lines` no tiene columna de
    // orden (ADR-015 §4.1 lo da por bueno para el sello, que ordena por
    // `id`). El `sortOrder` del visit no llega al ticket. Es preexistente
    // y afecta a toda venta, no sólo a las citas; por eso aquí se afirma
    // el CONTENIDO y no la secuencia.
    const lineas = await lineasDelTicket(draftId);
    expect(lineas.map((l) => l.sku).sort()).toEqual(["SVC-CORTE", "SVC-TINTE"]);
    expect(lineas.map((l) => l.product_id).sort()).toEqual(
      [corteId, tinteId].sort(),
    );
    for (const l of lineas) expect(l.holded_product_id).toBeTruthy();

    // 14,8760 + 37,1900 = 52,066 neto → 62,9999 ≈ 63,00 con IVA 21%.
    expect(Number(t.total)).toBeCloseTo(63, 2);

    // La cita quedó enlazada y en sala.
    const a = await appointmentRow(apptId);
    expect(a.ticket_id).toBe(draftId);
    expect(a.status).toBe("IN_SERVICE");
  });

  it("2 · volver a pulsar devuelve EL MISMO borrador, no un segundo", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/agenda/appointments/${apptId}/checkout`,
      headers: auth(),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ticket: { id: string } }).ticket.id).toBe(draftId);

    // Y en la BD sigue habiendo UN solo ticket.
    expect(await ticketsDelTenant()).toHaveLength(1);
  });

  it("3 · EL TEST DEL BLOQUE: el cobro paga ESE borrador y no crea otro", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${draftId}/checkout`,
      headers: auth(),
      payload: {
        externalId: randomUUID(),
        payments: [{ method: "CASH", amount: 63 }],
        cashAmount: 70,
      },
    });
    expect(res.statusCode).toBe(200);

    // UN SOLO TICKET en todo el tenant, y es el borrador de la cita.
    const todos = await ticketsDelTenant();
    expect(todos).toHaveLength(1);
    expect(todos[0]!.id).toBe(draftId);

    const t = await ticketRow(draftId);
    expect(t.status).not.toBe("DRAFT");
    expect(t.paid_at).not.toBeNull();
    // El número de serie se asigna AL COBRAR: el borrador no quema serie.
    expect(t.internal_number).not.toMatch(/^D-/);

    // La cita sigue apuntando al mismo ticket: el enlace no se rompió.
    expect((await appointmentRow(apptId)).ticket_id).toBe(draftId);

    // Cero borradores sobrantes. Es literalmente el criterio del bloque.
    expect(await draftsHuerfanos()).toBe(0);
  });

  it("4 · y ese ticket queda SELLADO por S1 (el enlace apunta al registro protegido)", async () => {
    const t = await ticketRow(draftId);
    expect(t.sealed_at).not.toBeNull();
    expect(t.sealed_hash).toMatch(/^[0-9a-f]{64}$/);

    // El motor lo protege de verdad: esto revienta, y revienta en la BD.
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE tickets SET total = total + 1 WHERE id = '${draftId}'`,
      ),
    ).rejects.toThrow();

    // Y la vuelta de v1.15: lo aplicado son 63,00 y lo entregado, 70,00.
    const pagos = await prisma.$queryRaw<Array<{ amount: string }>>`
      SELECT amount::text AS amount FROM ticket_payments
       WHERE ticket_id = ${draftId}::uuid
    `;
    expect(pagos).toHaveLength(1);
    expect(Number(pagos[0]!.amount)).toBeCloseTo(63, 2);
    const cash = await prisma.$queryRaw<Array<{ cash_amount: string }>>`
      SELECT cash_amount::text AS cash_amount FROM tickets
       WHERE id = ${draftId}::uuid
    `;
    expect(Number(cash[0]!.cash_amount)).toBeCloseTo(70, 2);
  });

  it("5 · la cita pasa a COMPLETED (el PATCH que dispara el front)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/agenda/appointments/${apptId}`,
      headers: auth(),
      payload: { status: "COMPLETED" },
    });
    expect(res.statusCode).toBe(200);
    expect((await appointmentRow(apptId)).status).toBe("COMPLETED");
  });

  it("6 · una cita YA COBRADA no se vuelve a cobrar", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/agenda/appointments/${apptId}/checkout`,
      headers: auth(),
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: string; ticketId?: string };
    expect(body.error).toBe("APPOINTMENT_ALREADY_PAID");
    expect(body.ticketId).toBe(draftId);
    // Y no ha aparecido un segundo ticket por el intento.
    expect(await ticketsDelTenant()).toHaveLength(1);
  });

  it("7 · el censo de huérfanos: cero cuando el ciclo se cerró bien", async () => {
    expect(await draftsHuerfanos()).toBe(0);
  });

  it("8 · y lo ve cuando el bug existe (el estado que dejaba B4)", async () => {
    // Se reproduce a mano el estado anterior al bloque: abrir el borrador
    // de la cita y cobrar por OTRO lado (POST /tickets), que es lo que
    // hacía el front.
    const otra = await crearCita([corteId], "12:00");
    const abierto = await app.inject({
      method: "POST",
      url: `/agenda/appointments/${otra}/checkout`,
      headers: auth(),
      payload: {},
    });
    expect(abierto.statusCode).toBe(201);
    const huerfano = (abierto.json() as { ticket: { id: string } }).ticket.id;

    const nuevo = await app.inject({
      method: "POST",
      url: "/tickets",
      headers: auth(),
      payload: {
        externalId: randomUUID(),
        registerId,
        shiftId,
        lines: [
          {
            nameSnapshot: "Corte de pelo",
            sku: "SVC-CORTE",
            units: 1,
            unitPrice: 14.876,
            discountPct: 0,
            taxRate: 21,
          },
        ],
        payments: [{ method: "CASH", amount: 18 }],
      },
    });
    expect(nuevo.statusCode).toBe(201);

    // El estado que el censo tiene que ver: un DRAFT vivo enlazado a una
    // cita, con el dinero en otro ticket.
    expect(await draftsHuerfanos()).toBe(1);
    expect((await ticketRow(huerfano)).status).toBe("DRAFT");
    expect((await appointmentRow(otra)).ticket_id).toBe(huerfano);
    // Dos tickets del ciclo bueno + los dos de este: el nuevo NO se
    // enlazó a la cita, que es exactamente el bug.
    const todos = await ticketsDelTenant();
    expect(todos.length).toBe(3);
  });
});
