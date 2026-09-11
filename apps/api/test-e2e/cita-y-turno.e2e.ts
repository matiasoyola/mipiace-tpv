// B-reservas-5 Frente T · el cobro de un borrador va al turno de SU
// INSTANTE, no al turno en el que se abrió el papel.
//
// POR QUÉ ESTE FICHERO EXISTE. Sole no cierra el turno a mano: lo cierra
// al día siguiente para poder abrir. Desde v1.11 el corte de las 05:00 se
// lo cierra solo (`AUTO_DAY_CUT`) y archiva el Z. Y B-5 deja vivo el
// borrador de la cita al pulsar "Volver a la agenda". Con esas dos cosas
// juntas, el camino real de Sole es:
//
//   "Cobrar en caja" → "Volver a la agenda" → corte de las 05:00 → cobro
//   al día siguiente
//
// Antes de B-5 la cita se cobraba por `POST /tickets`, que imputa el
// turno por `occurredAt` desde v1.11. Al pasar a
// `POST /tickets/:id/checkout` eso se perdió: el borrador fija su
// `shiftId` al ABRIRSE y el checkout no lo tocaba. La venta se sellaba
// (S1) en el turno de ayer, con el Z ya archivado y SIN Z correctivo, y
// el arqueo de hoy esperaba menos efectivo del que hay en el cajón. Sólo
// se corrige por `ticket_corrections`.
//
// Lo que se prueba aquí, contra Postgres de verdad porque es una
// afirmación sobre la BD (los triggers de S1 y el `EXCLUDE` de la agenda
// no existen en el harness fake del repo):
//
//   1. cita abierta en A → corte → se abre B → cobro → el ticket cuenta
//      en B, sellado, y A NO recibe Z correctivo
//   2. el mismo cobro llegando por el outbox con `occurredAt` ANTERIOR al
//      corte → cuenta en A, y A recibe su Z correctivo
//   3. A cerrado A MANO y sin turno nuevo → 409 SHIFT_NOT_OPEN con algo
//      que hacer, y el borrador y la cita intactos. En cita y en mesa: es
//      un solo camino y un solo copy.
//
// REGLA, heredada de v1.13: cada aserción va contra la BD por SQL.

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
const { registerTicketRoutes } = await import("../src/tickets/routes.js");
const { registerAgendaRoutes } = await import("../src/agenda/routes.js");
const { registerErrorHandler } = await import("../src/lib/error-handler.js");
const { registerLenientJsonParser } = await import("../src/lib/lenient-json.js");
const { signCashierSession } = await import("../src/shift/cashier-session.js");
const { createAgendaStore } = await import("../src/agenda/store.js");
const { runDayCutPass } = await import("../src/shift/day-cut-pass.js");
const { lastDayCutBefore } = await import("../src/shift/day-cut.js");
const { generatePublicSlug } = await import("../src/tickets/public-slug.js");

const silentLog = { info: () => {}, error: () => {} };

describe.skipIf(!e2eEnabled)(
  "e2e · el cobro del borrador se imputa al turno de su instante",
  () => {
    if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

    const prisma = getPrisma();
    const store = createAgendaStore(prisma);
    let app: FastifyInstance;

    let tenantId = "";
    let storeId = "";
    let cashierId = "";
    let corteId = "";

    // Caja 1: el camino de Sole (corte de día en medio del borrador).
    let registerId = "";
    let token = "";
    let shiftA = "";
    let shiftB = "";
    let cutAt = new Date();

    // Caja 2: el cierre A MANO, que NO es el corte automático.
    let register2Id = "";
    let token2 = "";
    let shiftC = "";

    // Las dos citas que quedan abiertas cruzando el corte.
    let apptTemprana = "";
    let draftTemprano = "";
    let apptTardia = "";
    let draftTardio = "";

    const auth = (t: string) => ({ authorization: `Bearer ${t}` });

    // ── aserciones contra la BD ───────────────────────────────────────

    async function ticketRow(id: string): Promise<{
      status: string;
      shift_id: string;
      internal_number: string;
      paid_at: Date | null;
      sealed_at: Date | null;
    }> {
      const rows = await prisma.$queryRaw<
        Array<{
          status: string;
          shift_id: string;
          internal_number: string;
          paid_at: Date | null;
          sealed_at: Date | null;
        }>
      >`
        SELECT status::text AS status, shift_id::text AS shift_id,
               internal_number, paid_at, sealed_at
          FROM tickets WHERE id = ${id}::uuid
      `;
      expect(rows).toHaveLength(1);
      return rows[0]!;
    }

    /** Lo que el arqueo de ese turno cuenta como cobrado: la suma de los
     *  pagos de sus ventas. Es la pregunta del cajón, no la del ORM. */
    async function cobradoEnTurno(shiftId: string): Promise<number> {
      const rows = await prisma.$queryRaw<Array<{ suma: string | null }>>`
        SELECT COALESCE(SUM(p.amount), 0)::text AS suma
          FROM ticket_payments p
          JOIN tickets t ON t.id = p.ticket_id
         WHERE t.shift_id = ${shiftId}::uuid
           AND p.collected_in_shift_id IS NULL
      `;
      return Number(rows[0]!.suma ?? 0);
    }

    /** Los Z archivados de un turno: uno por cierre, más uno por cada
     *  corrección. `reason = 'LATE_SALE'` es exactamente "entró una venta
     *  después de que yo cerrase". */
    async function zetasDelTurno(
      shiftId: string,
    ): Promise<Array<{ sequence: number; reason: string }>> {
      const rows = await prisma.$queryRaw<
        Array<{ sequence: number; reason: string }>
      >`
        SELECT sequence, reason FROM shift_z_reports
         WHERE shift_id = ${shiftId}::uuid ORDER BY sequence
      `;
      return rows.map((r) => ({ sequence: Number(r.sequence), reason: r.reason }));
    }

    async function shiftRow(
      id: string,
    ): Promise<{ closed_at: Date | null; close_reason: string | null; z_report_stale: boolean }> {
      const rows = await prisma.$queryRaw<
        Array<{ closed_at: Date | null; close_reason: string | null; z_report_stale: boolean }>
      >`
        SELECT closed_at, close_reason::text AS close_reason, z_report_stale
          FROM shifts WHERE id = ${id}::uuid
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

    async function ticketCounterDe(registerId_: string): Promise<number> {
      const rows = await prisma.$queryRaw<Array<{ ticket_counter: number }>>`
        SELECT ticket_counter FROM registers WHERE id = ${registerId_}::uuid
      `;
      return Number(rows[0]!.ticket_counter);
    }

    // ── siembra ───────────────────────────────────────────────────────

    async function crearCita(horaUtc: string): Promise<string> {
      const start = new Date(`2026-09-11T${horaUtc}:00.000Z`);
      const items = [
        {
          serviceId: corteId,
          durationMin: 30,
          bufferBeforeMin: 0,
          bufferAfterMin: 0,
          staffRequired: 1,
          sortOrder: 0,
          startOffsetMin: 0,
        },
      ];
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
        items,
        assignments: items.map((it, i) => ({
          appointmentItemIndex: i,
          reservableType: "STAFF" as const,
          staffUserId: cashierId,
          resourceId: null,
          startsAt: start,
          endsAt: new Date(start.getTime() + it.durationMin * 60_000),
        })),
      });
      return view.id;
    }

    async function abrirCobroDeCita(
      appointmentId: string,
      t: string,
    ): Promise<string> {
      const res = await app.inject({
        method: "POST",
        url: `/agenda/appointments/${appointmentId}/checkout`,
        headers: auth(t),
        payload: {},
      });
      expect(res.statusCode).toBe(201);
      return (res.json() as { ticket: { id: string } }).ticket.id;
    }

    beforeAll(async () => {
      app = Fastify({ logger: false });
      registerErrorHandler(app);
      registerLenientJsonParser(app);
      await registerTicketRoutes(app);
      await registerAgendaRoutes(app);
      await app.ready();

      const tenant = await prisma.tenant.create({
        // `dayCutHour: 5` es lo que tiene Sole: el corte de las cinco.
        data: { name: "Peluquería Sole (turno)", agendaEnabled: true, dayCutHour: 5 },
        select: { id: true },
      });
      tenantId = tenant.id;

      const store_ = await prisma.store.create({
        data: { tenantId, name: "Local turno" },
        select: { id: true },
      });
      storeId = store_.id;

      const register = await prisma.register.create({
        data: { storeId, name: "Caja Sole" },
        select: { id: true },
      });
      registerId = register.id;
      const register2 = await prisma.register.create({
        data: { storeId, name: "Caja cierre a mano" },
        select: { id: true },
      });
      register2Id = register2.id;

      const cashier = await prisma.user.create({
        data: {
          tenantId,
          email: `sole-turno+${randomUUID()}@e2e.local`,
          alias: "Sole",
          role: "CASHIER",
        },
        select: { id: true },
      });
      cashierId = cashier.id;

      const corte = await prisma.product.create({
        data: {
          tenantId,
          holdedProductId: `h-corte-turno-${randomUUID()}`,
          name: "Corte de pelo",
          sku: "SVC-CORTE-T",
          basePrice: "14.8760",
          taxRate: "21",
          kind: "SERVICE",
        },
        select: { id: true },
      });
      corteId = corte.id;

      token = signCashierSession(
        { sub: cashierId, tid: tenantId, did: randomUUID(), rid: registerId, role: "CASHIER" },
        720,
      );
      token2 = signCashierSession(
        { sub: cashierId, tid: tenantId, did: randomUUID(), rid: register2Id, role: "CASHIER" },
        720,
      );
    });

    afterAll(async () => {
      await app?.close();
      await shutdown();
    });

    it("0 · dos citas se quedan abiertas en el turno A, que cruza el corte", async () => {
      const a = await prisma.shift.create({
        data: { registerId, userId: cashierId, cashOpening: "50" },
        select: { id: true },
      });
      shiftA = a.id;
      // El turno de AYER. Sin esto no ha cruzado ningún corte y la pasada
      // no lo tocaría: es la única forma de que el corte sea real aquí.
      await prisma.$executeRaw`
        UPDATE shifts SET opened_at = now() - interval '30 hours' WHERE id = ${shiftA}::uuid
      `;

      apptTemprana = await crearCita("08:00");
      draftTemprano = await abrirCobroDeCita(apptTemprana, token);
      apptTardia = await crearCita("09:00");
      draftTardio = await abrirCobroDeCita(apptTardia, token);

      // Los dos borradores nacen en A: el borrador fija su turno al
      // ABRIRSE, que es de donde sale todo este frente.
      expect((await ticketRow(draftTemprano)).shift_id).toBe(shiftA);
      expect((await ticketRow(draftTardio)).shift_id).toBe(shiftA);
      expect(await cobradoEnTurno(shiftA)).toBeCloseTo(0, 2);
    });

    it("1 · corte de día, turno nuevo, y el cobro cuenta en el turno NUEVO", async () => {
      const now = new Date();
      cutAt = lastDayCutBefore(now, 5);

      // La pasada de verdad, la misma que corre el worker.
      const pass = await runDayCutPass({ prisma, log: silentLog, now });
      expect(pass.shifts.failed).toBe(0);
      expect(pass.shifts.closed.map((c) => c.shiftId)).toContain(shiftA);

      const cerrado = await shiftRow(shiftA);
      expect(cerrado.closed_at).not.toBeNull();
      expect(cerrado.close_reason).toBe("AUTO_DAY_CUT");
      // El Z de A ya está archivado. Ése es el documento que una venta
      // tardía dejaría mintiendo.
      expect(await zetasDelTurno(shiftA)).toEqual([{ sequence: 1, reason: "CLOSE" }]);

      // El corte NO abre el turno siguiente (v1.11): lo abre la cajera al
      // llegar, que es cuando sabe el fondo de caja.
      const b = await prisma.shift.create({
        data: { registerId, userId: cashierId, cashOpening: "50" },
        select: { id: true },
      });
      shiftB = b.id;

      // Y ahora Sole cobra la cita de ayer. Camino online: el cuerpo no
      // lleva `occurredAt` y el instante es AHORA.
      const res = await app.inject({
        method: "POST",
        url: `/tickets/${draftTemprano}/checkout`,
        headers: auth(token),
        payload: {
          externalId: randomUUID(),
          payments: [{ method: "CASH", amount: 18 }],
          cashAmount: 20,
        },
      });
      expect(res.statusCode).toBe(200);

      // LA AFIRMACIÓN DEL FRENTE: la venta está en B, no en A.
      const t = await ticketRow(draftTemprano);
      expect(t.shift_id).toBe(shiftB);
      expect(t.status).not.toBe("DRAFT");
      expect(t.paid_at).not.toBeNull();
      expect(t.internal_number).not.toMatch(/^D-/);
      // Sellada por S1 en el turno correcto, no en el de ayer.
      expect(t.sealed_at).not.toBeNull();

      // El arqueo: el efectivo lo espera B, que es donde está el dinero.
      expect(await cobradoEnTurno(shiftB)).toBeCloseTo(18, 2);
      expect(await cobradoEnTurno(shiftA)).toBeCloseTo(0, 2);

      // Y A NO recibe Z correctivo: nada entró en A después de cerrarlo.
      expect(await zetasDelTurno(shiftA)).toEqual([{ sequence: 1, reason: "CLOSE" }]);
      expect((await shiftRow(shiftA)).z_report_stale).toBe(false);

      // La cita sigue enlazada a su ticket.
      expect((await appointmentRow(apptTemprana)).ticket_id).toBe(draftTemprano);
    });

    it("2 · el cobro que llega por el outbox con su instante de ayer cuenta en A, con Z correctivo", async () => {
      // El outbox sella `occurredAt` al ENCOLAR (cuando la cajera pulsó
      // Cobrar), no al subir. Aquí: pulsó ANTES del corte y el terminal
      // estaba sin red. El servidor tiene que creer al instante, no al
      // reloj de la subida.
      const occurredAt = new Date(cutAt.getTime() - 60 * 60 * 1000);

      const res = await app.inject({
        method: "POST",
        url: `/tickets/${draftTardio}/checkout`,
        headers: auth(token),
        payload: {
          externalId: randomUUID(),
          occurredAt: occurredAt.toISOString(),
          payments: [{ method: "CASH", amount: 18 }],
          cashAmount: 18,
        },
      });
      expect(res.statusCode).toBe(200);

      // La venta es de ayer y va a ayer.
      const t = await ticketRow(draftTardio);
      expect(t.shift_id).toBe(shiftA);
      expect(t.sealed_at).not.toBeNull();

      // El arqueo de A la cuenta; el de B no se mueve.
      expect(await cobradoEnTurno(shiftA)).toBeCloseTo(18, 2);
      expect(await cobradoEnTurno(shiftB)).toBeCloseTo(18, 2);

      // Y el Z de A deja de mentir: uno correctivo, y el anterior marcado
      // como corregido (que es lo que `z_report_stale` significa desde S1).
      expect(await zetasDelTurno(shiftA)).toEqual([
        { sequence: 1, reason: "CLOSE" },
        { sequence: 2, reason: "LATE_SALE" },
      ]);
      expect((await shiftRow(shiftA)).z_report_stale).toBe(true);
    });

    it("3 · turno cerrado A MANO y sin turno nuevo: 409 con algo que hacer, y nada se toca", async () => {
      const c = await prisma.shift.create({
        data: { registerId: register2Id, userId: cashierId, cashOpening: "50" },
        select: { id: true },
      });
      shiftC = c.id;

      const appt = await crearCita("11:00");
      const draft = await abrirCobroDeCita(appt, token2);
      expect((await ticketRow(draft)).shift_id).toBe(shiftC);

      // Una persona cerró el turno. No hubo automatismo que sorprendiera
      // a nadie: aquí el 409 histórico se mantiene a propósito.
      await prisma.shift.update({
        where: { id: shiftC },
        data: { closedAt: new Date(), closeReason: "MANUAL", cashCounted: "50" },
      });

      const contadorAntes = await ticketCounterDe(register2Id);
      const res = await app.inject({
        method: "POST",
        url: `/tickets/${draft}/checkout`,
        headers: auth(token2),
        payload: {
          externalId: randomUUID(),
          payments: [{ method: "CASH", amount: 18 }],
        },
      });
      expect(res.statusCode).toBe(409);
      const body = res.json() as { error: string; message: string };
      expect(body.error).toBe("SHIFT_NOT_OPEN");
      // El copy tiene que decirle a la cajera QUÉ HACER. "El turno no está
      // abierto" a secas la deja mirando la pantalla.
      expect(body.message).toContain("Abre turno para cobrar");

      // Y no se ha tocado nada: la tx entera se deshizo.
      const t = await ticketRow(draft);
      expect(t.status).toBe("DRAFT");
      expect(t.paid_at).toBeNull();
      expect(t.sealed_at).toBeNull();
      expect(t.internal_number).toMatch(/^D-/);
      expect(t.shift_id).toBe(shiftC);
      // El número de serie no se quema por un cobro que no ocurrió.
      expect(await ticketCounterDe(register2Id)).toBe(contadorAntes);
      // La cita sigue enlazada: la cajera abre turno y vuelve a Cobrar.
      const a = await appointmentRow(appt);
      expect(a.ticket_id).toBe(draft);
      expect(a.status).toBe("IN_SERVICE");
    });

    it("4 · el MISMO copy en mesa: es un solo camino de cobro", async () => {
      // La mesa no es otro endpoint ni otro mensaje. Si alguien redacta
      // el 409 sólo para la cita, esto se pone rojo.
      const mesa = await prisma.table.create({
        data: { storeId, name: `Mesa ${randomUUID().slice(0, 8)}`, capacity: 2 },
        select: { id: true },
      });
      const draftMesa = await prisma.ticket.create({
        data: {
          tenantId,
          registerId: register2Id,
          shiftId: shiftC,
          userId: cashierId,
          tableId: mesa.id,
          internalNumber: `D-${randomUUID()}`,
          externalId: randomUUID(),
          publicSlug: generatePublicSlug(),
          status: "DRAFT",
          total: "18.00",
          totalTax: "3.12",
          totalDiscount: "0",
          lines: {
            create: [
              {
                sku: "SVC-CORTE-T",
                nameSnapshot: "Corte de pelo",
                units: "1",
                unitPrice: "14.8760",
                discountPct: "0",
                taxRate: "21",
                subtotal: "14.876",
                total: "18.00",
              },
            ],
          },
        },
        select: { id: true },
      });

      const res = await app.inject({
        method: "POST",
        url: `/tickets/${draftMesa.id}/checkout`,
        headers: auth(token2),
        payload: {
          externalId: randomUUID(),
          payments: [{ method: "CASH", amount: 18 }],
        },
      });
      expect(res.statusCode).toBe(409);
      const body = res.json() as { error: string; message: string };
      expect(body.error).toBe("SHIFT_NOT_OPEN");
      expect(body.message).toContain("Abre turno para cobrar");

      const t = await ticketRow(draftMesa.id);
      expect(t.status).toBe("DRAFT");
      expect(t.sealed_at).toBeNull();
    });
  },
);
