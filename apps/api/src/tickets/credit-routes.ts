// v1.8-Fiado (variante B) · endpoints de deuda a crédito.
//
//   GET  /credits                        — deudas vivas agregadas por contacto.
//   POST /tickets/:id/credit-payments    — cobro (total o parcial) de un fiado.
//   POST /tickets/:id/credit-void        — anular un fiado no saldado (PIN encargado).
//
// La venta fiada nace en POST /tickets (creditSale:true) como ON_CREDIT
// con creditPending=total y SIN subir a Holded. Aquí vive el otro lado:
// consultar la deuda, cobrarla e imputar el ingreso al turno del cobro
// (no al de la venta — arqueo Z multi-día, ver shift/z-report.ts), y al
// saldarse encolar la subida normal a Holded (create+pay por el total,
// fecha = día del saldo).

import { Prisma, PaymentMethod, TicketStatus } from "@mipiacetpv/db";
import { buildCreditPaymentReceipt } from "@mipiacetpv/escpos-builder";
import type { FastifyInstance } from "fastify";

import { verifyManagerAuthorization } from "../auth/manager-authorization.js";
import { getPrisma } from "../context.js";
import { enqueueTicketUpload } from "../queues/ticket-upload.js";
import { requireCashierSession } from "../shift/cashier-session.js";
import { shouldEnqueueHoldedUpload } from "./holded-upload-gate.js";

// Tolerancia monetaria: la deuda vive con precisión de 4 decimales pero
// los cobros llegan en euros/céntimos. Media de céntimo evita que un
// redondeo deje 0,0001 € de deuda fantasma o dispare un falso sobrepago.
const MONEY_EPS = 0.005;

const UUID_V4 =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";

interface CreditPaymentBody {
  externalId: string;
  shiftId: string;
  amount: number;
  method: "CASH" | "CARD" | "BIZUM" | "VOUCHER" | "OTHER";
  cashAmount?: number;
}

interface CreditVoidBody {
  authorizationToken: string;
  reason: string;
}

export async function registerCreditRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /credits ────────────────────────────────────────────────────
  // Deudas vivas agregadas por contacto. Búsqueda por nombre (BD local,
  // sin llamar a Holded) y paginado por contacto. Cada contacto trae el
  // detalle de sus tickets fiados.
  app.get(
    "/credits",
    {
      preHandler: requireCashierSession,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            search: { type: "string", maxLength: 120 },
            page: { type: "integer", minimum: 1 },
            pageSize: { type: "integer", minimum: 1, maximum: 100 },
          },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const prisma = getPrisma();
      const q = request.query as { search?: string; page?: number; pageSize?: number };
      const page = q.page ?? 1;
      const pageSize = q.pageSize ?? 20;
      const search = q.search?.trim();

      // Tickets con deuda viva del tenant. El índice parcial
      // (tenant_id, contact_holded_id) WHERE credit_pending > 0 sirve
      // esta consulta.
      const debts = await prisma.ticket.findMany({
        where: {
          tenantId: cashier.tid,
          creditPending: { gt: 0 },
        },
        select: {
          id: true,
          internalNumber: true,
          contactHoldedId: true,
          total: true,
          creditPending: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      });

      // Hidratar nombres de contacto desde la cache local. Un fiado
      // SIEMPRE tiene contacto (validado en checkout), pero blindamos el
      // null por si un dato viejo se colara.
      const contactIds = [
        ...new Set(debts.map((d) => d.contactHoldedId).filter((c): c is string => !!c)),
      ];
      const contacts = contactIds.length
        ? await prisma.contact.findMany({
            where: { tenantId: cashier.tid, holdedContactId: { in: contactIds } },
            select: { holdedContactId: true, name: true },
          })
        : [];
      const nameById = new Map(contacts.map((c) => [c.holdedContactId, c.name ?? ""]));

      // Agrupar por contacto.
      const groups = new Map<
        string,
        {
          contactHoldedId: string;
          name: string;
          balance: number;
          tickets: Array<{
            id: string;
            internalNumber: string;
            total: number;
            creditPending: number;
            createdAt: Date;
          }>;
        }
      >();
      for (const d of debts) {
        const key = d.contactHoldedId ?? "__sin_contacto__";
        let g = groups.get(key);
        if (!g) {
          g = {
            contactHoldedId: key,
            name: nameById.get(key) ?? "(sin nombre)",
            balance: 0,
            tickets: [],
          };
          groups.set(key, g);
        }
        g.balance += Number(d.creditPending);
        g.tickets.push({
          id: d.id,
          internalNumber: d.internalNumber,
          total: Number(d.total),
          creditPending: Number(d.creditPending),
          createdAt: d.createdAt,
        });
      }

      let list = [...groups.values()];
      // Búsqueda por nombre de contacto (case-insensitive, local).
      if (search) {
        const needle = search.toLowerCase();
        list = list.filter((g) => g.name.toLowerCase().includes(needle));
      }
      // Mayor deuda primero — es lo que el cajero quiere ver arriba.
      list.sort((a, b) => b.balance - a.balance);

      const totalContacts = list.length;
      const start = (page - 1) * pageSize;
      const pageItems = list.slice(start, start + pageSize).map((g) => ({
        ...g,
        balance: round2(g.balance),
        ticketCount: g.tickets.length,
      }));

      return reply.code(200).send({
        contacts: pageItems,
        page,
        pageSize,
        totalContacts,
      });
    },
  );

  // ── POST /tickets/:id/credit-payments ───────────────────────────────
  // Cobro de un fiado (total o parcial). Idempotente por externalId del
  // cobro. Decrementa creditPending con guardia de no-sobrepago. Si la
  // deuda llega a 0 → status PAID + encolar subida a Holded.
  app.post(
    "/tickets/:ticketId/credit-payments",
    {
      preHandler: requireCashierSession,
      schema: {
        params: {
          type: "object",
          required: ["ticketId"],
          properties: { ticketId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["externalId", "shiftId", "amount", "method"],
          additionalProperties: false,
          properties: {
            externalId: { type: "string", pattern: UUID_V4 },
            shiftId: { type: "string", format: "uuid" },
            amount: { type: "number", exclusiveMinimum: 0, maximum: 1_000_000 },
            method: {
              type: "string",
              enum: ["CASH", "CARD", "BIZUM", "VOUCHER", "OTHER"],
            },
            cashAmount: { type: "number", minimum: 0 },
          },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const prisma = getPrisma();
      const { ticketId } = request.params as { ticketId: string };
      const body = request.body as CreditPaymentBody;

      // Idempotencia: si ya persistimos un cobro con este externalId,
      // devolvemos el estado actual del ticket (reintento de red).
      const existingPayment = await prisma.ticketPayment.findUnique({
        where: { externalId: body.externalId },
        select: { id: true, ticketId: true, amount: true, method: true },
      });
      if (existingPayment) {
        const t = await prisma.ticket.findFirst({
          where: { id: existingPayment.ticketId, tenantId: cashier.tid },
          select: { id: true, status: true, creditPending: true },
        });
        return reply.code(200).send({
          duplicate: true,
          settled: t?.status === TicketStatus.PAID || t?.status === TicketStatus.SYNCED,
          ticket: t
            ? { id: t.id, status: t.status, creditPending: numOrNull(t.creditPending) }
            : null,
          payment: {
            id: existingPayment.id,
            amount: Number(existingPayment.amount),
            method: existingPayment.method,
          },
        });
      }

      // Turno del cobro debe estar abierto en esta caja (imputación Z).
      const shift = await prisma.shift.findFirst({
        where: { id: body.shiftId, registerId: cashier.rid, closedAt: null },
        select: { id: true },
      });
      if (!shift) {
        return reply.code(409).send({
          error: "SHIFT_NOT_OPEN",
          message: "El turno no está abierto en esta caja.",
        });
      }

      const ticket = await prisma.ticket.findFirst({
        where: { id: ticketId, tenantId: cashier.tid },
        select: {
          id: true,
          status: true,
          creditPending: true,
          externalId: true,
          internalNumber: true,
          contactHoldedId: true,
        },
      });
      if (!ticket) {
        return reply.code(404).send({ error: "TICKET_NOT_FOUND", message: "Ticket no encontrado." });
      }
      if (ticket.status !== TicketStatus.ON_CREDIT || ticket.creditPending == null) {
        return reply.code(409).send({
          error: "NOT_ON_CREDIT",
          message: "Este ticket no es un fiado con deuda viva.",
        });
      }
      const pending = Number(ticket.creditPending);
      // Guardia de no-sobrepago: no se puede cobrar más de lo que se debe.
      if (body.amount > pending + MONEY_EPS) {
        return reply.code(409).send({
          error: "CREDIT_OVERPAY",
          message: `El cobro (${body.amount.toFixed(2)} €) supera la deuda pendiente (${pending.toFixed(2)} €).`,
          pending: round2(pending),
        });
      }

      const newPending = round4(pending - body.amount);
      const settled = newPending <= MONEY_EPS;
      const now = new Date();

      const result = await prisma.$transaction(async (tx) => {
        await tx.ticketPayment.create({
          data: {
            ticketId: ticket.id,
            method: body.method as PaymentMethod,
            amount: new Prisma.Decimal(body.amount),
            externalId: body.externalId,
            collectedInShiftId: body.shiftId,
            meta: {
              collectedAt: now.toISOString(),
              collectedBy: cashier.userId,
            },
          },
        });
        const updated = await tx.ticket.update({
          where: { id: ticket.id },
          data: settled
            ? {
                creditPending: new Prisma.Decimal(0),
                status: TicketStatus.PAID,
                // Fecha fiscal = día del saldo (variante B): Holded recibe
                // el documento con esta fecha cuando el worker lo suba.
                paidAt: now,
              }
            : { creditPending: new Prisma.Decimal(newPending) },
          select: { id: true, status: true, creditPending: true, externalId: true },
        });
        // Al saldar, crear la fila de upload (el gate ya lo autoriza en
        // PAID). Antes de esto un fiado nunca tuvo HoldedUpload.
        if (settled && shouldEnqueueHoldedUpload(updated.status)) {
          await tx.holdedUpload.upsert({
            where: { externalId: ticket.externalId },
            create: {
              externalId: ticket.externalId,
              tenantId: cashier.tid,
              kind: "TICKET",
              status: "PENDING",
            },
            update: {},
          });
        }
        return updated;
      });

      // Encolar la subida fuera de la tx (sólo al saldar).
      if (settled && shouldEnqueueHoldedUpload(result.status)) {
        try {
          await enqueueTicketUpload(ticket.externalId);
        } catch (err) {
          request.log.error(
            { externalId: ticket.externalId },
            `enqueue upload al saldar fiado falló: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // Datos del justificante de cobro (recibo simple no fiscal). El TPV
      // los usa para imprimir el recibo con buildCreditPaymentReceipt.
      let debtorName: string | null = null;
      if (ticket.contactHoldedId) {
        const contact = await prisma.contact.findFirst({
          where: { tenantId: cashier.tid, holdedContactId: ticket.contactHoldedId },
          select: { name: true },
        });
        debtorName = contact?.name ?? null;
      }
      const remaining = settled ? 0 : round2(newPending);

      return reply.code(201).send({
        settled,
        ticket: {
          id: result.id,
          status: result.status,
          internalNumber: ticket.internalNumber,
          creditPending: numOrNull(result.creditPending),
        },
        payment: { amount: round2(body.amount), method: body.method },
        receipt: {
          debtorName,
          internalNumber: ticket.internalNumber,
          amount: round2(body.amount),
          method: body.method,
          remaining,
          collectedAt: now.toISOString(),
        },
      });
    },
  );

  // ── POST /tickets/:id/credit-void ───────────────────────────────────
  // Anular un fiado NO saldado. PIN de encargado (manager-auth, purpose
  // credit-void), motivo obligatorio. Sin acción Holded: nunca se subió.
  // Si ya tiene cobros parciales → 409 (v1 no automatiza la devolución
  // del dinero ya cobrado; hay que resolverlo a mano primero).
  app.post(
    "/tickets/:ticketId/credit-void",
    {
      preHandler: requireCashierSession,
      schema: {
        params: {
          type: "object",
          required: ["ticketId"],
          properties: { ticketId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["authorizationToken", "reason"],
          additionalProperties: false,
          properties: {
            authorizationToken: { type: "string", minLength: 1, maxLength: 2048 },
            reason: { type: "string", minLength: 1, maxLength: 300 },
          },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const prisma = getPrisma();
      const { ticketId } = request.params as { ticketId: string };
      const body = request.body as CreditVoidBody;

      // Autorización de encargado (mismo mecanismo que discount-override,
      // purpose distinto). Un token de descuento NO sirve aquí.
      let auth;
      try {
        auth = verifyManagerAuthorization(body.authorizationToken);
      } catch {
        return reply.code(403).send({
          error: "MANAGER_AUTHORIZATION_INVALID",
          message: "La autorización del encargado ha caducado o no es válida.",
        });
      }
      if (auth.tid !== cashier.tid) {
        return reply.code(403).send({
          error: "MANAGER_AUTHORIZATION_INVALID",
          message: "La autorización no pertenece a este comercio.",
        });
      }
      if (auth.purpose !== "credit-void") {
        return reply.code(403).send({
          error: "MANAGER_AUTHORIZATION_INVALID",
          message: "La autorización no aplica a anular fiados.",
        });
      }

      const ticket = await prisma.ticket.findFirst({
        where: { id: ticketId, tenantId: cashier.tid },
        select: {
          id: true,
          status: true,
          creditPending: true,
          _count: { select: { payments: true } },
        },
      });
      if (!ticket) {
        return reply.code(404).send({ error: "TICKET_NOT_FOUND", message: "Ticket no encontrado." });
      }
      if (ticket.status !== TicketStatus.ON_CREDIT) {
        return reply.code(409).send({
          error: "NOT_ON_CREDIT",
          message: "Sólo se puede anular un fiado con deuda viva.",
        });
      }
      // Con cobros parciales, anular dejaría dinero cobrado sin doc.
      // v1 no lo automatiza: primero se devuelve el efectivo a mano.
      if (ticket._count.payments > 0) {
        return reply.code(409).send({
          error: "CREDIT_HAS_PAYMENTS",
          message:
            "Este fiado ya tiene cobros parciales. Devuelve primero el dinero cobrado; anular no lo reembolsa.",
        });
      }

      const manager = await prisma.user.findFirst({
        where: { id: auth.sub, tenantId: cashier.tid, role: { in: ["MANAGER", "OWNER"] } },
        select: { email: true },
      });

      await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          status: TicketStatus.VOIDED,
          creditPending: new Prisma.Decimal(0),
          // Auditoría de la anulación. syncError es el sink JSON a nivel
          // ticket; un VOIDED nunca sincroniza, así que no colisiona con
          // errores de sync reales ni aparece en la bandeja de errores.
          syncError: {
            creditVoid: {
              reason: body.reason,
              authorizedBy: manager?.email ?? auth.sub,
              voidedBy: cashier.userId,
              at: new Date().toISOString(),
            },
          },
        },
      });

      request.log.info(
        {
          event: "credit_void.granted",
          tenantId: cashier.tid,
          ticketId: ticket.id,
          authorizedBy: manager?.email ?? auth.sub,
          reason: body.reason,
        },
        "Fiado anulado por encargado",
      );

      return reply.code(200).send({ ticket: { id: ticket.id, status: TicketStatus.VOIDED } });
    },
  );

  // ── POST /tickets/:id/credit-receipt/escpos ─────────────────────────
  // Justificante de cobro (recibo simple NO fiscal) en bytes ESC/POS para
  // que el TPV lo mande a la impresora USB. Se construye server-side
  // (mismo patrón que /print/escpos) por el cobro identificado con su
  // externalId. El "saldo restante" es el creditPending ACTUAL del ticket
  // (el recibo se imprime justo tras cobrar, así que coincide).
  app.post(
    "/tickets/:ticketId/credit-receipt/escpos",
    {
      preHandler: requireCashierSession,
      schema: {
        params: {
          type: "object",
          required: ["ticketId"],
          properties: { ticketId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["paymentExternalId"],
          additionalProperties: false,
          properties: {
            paymentExternalId: { type: "string", pattern: UUID_V4 },
          },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const prisma = getPrisma();
      const { ticketId } = request.params as { ticketId: string };
      const { paymentExternalId } = request.body as { paymentExternalId: string };

      const ticket = await prisma.ticket.findFirst({
        where: { id: ticketId, tenantId: cashier.tid },
        select: {
          id: true,
          internalNumber: true,
          creditPending: true,
          contactHoldedId: true,
          register: { select: { store: { select: { name: true } } } },
        },
      });
      if (!ticket) {
        return reply.code(404).send({ error: "TICKET_NOT_FOUND", message: "Ticket no encontrado." });
      }
      const payment = await prisma.ticketPayment.findUnique({
        where: { externalId: paymentExternalId },
        select: { ticketId: true, amount: true, method: true, meta: true },
      });
      if (!payment || payment.ticketId !== ticket.id) {
        return reply.code(404).send({ error: "PAYMENT_NOT_FOUND", message: "Cobro no encontrado." });
      }

      let debtorName: string | null = null;
      if (ticket.contactHoldedId) {
        const contact = await prisma.contact.findFirst({
          where: { tenantId: cashier.tid, holdedContactId: ticket.contactHoldedId },
          select: { name: true },
        });
        debtorName = contact?.name ?? null;
      }
      const meta = (payment.meta ?? {}) as { collectedAt?: string };
      const collectedAt = meta.collectedAt ? new Date(meta.collectedAt) : new Date();

      const bytes = buildCreditPaymentReceipt({
        businessName: ticket.register.store.name,
        internalNumber: ticket.internalNumber,
        debtorName,
        collectedAt,
        amount: Number(payment.amount),
        methodLabel: METHOD_LABELS[payment.method] ?? payment.method,
        remaining: ticket.creditPending != null ? Number(ticket.creditPending) : 0,
      });

      return reply
        .header("content-type", "application/octet-stream")
        .send(Buffer.from(bytes));
    },
  );
}

const METHOD_LABELS: Record<string, string> = {
  CASH: "Efectivo",
  CARD: "Tarjeta",
  BIZUM: "Bizum",
  VOUCHER: "Vale",
  OTHER: "Otro",
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
function numOrNull(v: Prisma.Decimal | null): number | null {
  return v == null ? null : Number(v);
}
