// Endpoints de tickets (B4 §1).
//
//   POST /tickets             — registra ticket cobrado y encola sync a Holded.
//   GET  /tickets/:id         — devuelve ticket con líneas/pagos/sync status.
//   GET  /tickets             — búsqueda con filtros.
//   POST /tickets/:id/resend-email — encola un job para reenviar el PDF.
//   POST /tickets/:id/gift-receipt-intent — marca giftReceiptIntentAt (B5 imprime).
//
// Middleware: requireCashierSession (B3). El JWT de la sesión lleva
// tid/rid/did, así que no necesitamos un X-Device-Token extra: la
// sesión ya pasó por device + PIN.

import { randomUUID } from "node:crypto";

import { Prisma, TicketStatus } from "@mipiacetpv/db";
import type { FastifyInstance } from "fastify";

import { getPrisma } from "../context.js";
import { enqueueTicketUpload } from "../queues/ticket-upload.js";
import { enqueueRefundUpload } from "../queues/refund-upload.js";
import { enqueueTicketEmail } from "../queues/ticket-email.js";
import { requireCashierSession } from "../shift/cashier-session.js";
import {
  PAYMENT_TOLERANCE_EUR,
  TOTAL_TOLERANCE_EUR,
  computeTicket,
  paymentsClose,
  totalsClose,
} from "./totals.js";

const UUID_V4 =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";

interface TicketLineBody {
  productId?: string;
  variantId?: string;
  holdedProductId?: string;
  nameSnapshot: string;
  sku: string;
  units: number;
  unitPrice: number;
  discountPct: number;
  taxRate: number;
  modifiers?: string[];
}

interface TicketPaymentBody {
  method: "CASH" | "CARD" | "BIZUM" | "VOUCHER" | "OTHER";
  amount: number;
  meta?: Record<string, unknown>;
}

interface CreateTicketBody {
  externalId: string;
  registerId: string;
  shiftId: string;
  lines: TicketLineBody[];
  payments: TicketPaymentBody[];
  contactHoldedId?: string;
  notes?: string;
  cashAmount?: number;
  printIntent?: boolean;
  emailIntent?: string;
  giftReceiptIntent?: boolean;
}

export async function registerTicketRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /tickets ───────────────────────────────────────────────────
  app.post(
    "/tickets",
    {
      preHandler: requireCashierSession,
      schema: {
        body: {
          type: "object",
          required: ["externalId", "registerId", "shiftId", "lines", "payments"],
          additionalProperties: false,
          properties: {
            externalId: { type: "string", pattern: UUID_V4 },
            registerId: { type: "string", format: "uuid" },
            shiftId: { type: "string", format: "uuid" },
            contactHoldedId: { type: "string", maxLength: 64 },
            notes: { type: "string", maxLength: 1000 },
            cashAmount: { type: "number", minimum: 0 },
            printIntent: { type: "boolean" },
            emailIntent: { type: "string", maxLength: 320 },
            giftReceiptIntent: { type: "boolean" },
            lines: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                required: ["nameSnapshot", "sku", "units", "unitPrice", "discountPct", "taxRate"],
                additionalProperties: false,
                properties: {
                  productId: { type: "string", format: "uuid" },
                  variantId: { type: "string", format: "uuid" },
                  holdedProductId: { type: "string", maxLength: 64 },
                  nameSnapshot: { type: "string", minLength: 1, maxLength: 300 },
                  sku: { type: "string", minLength: 1, maxLength: 64 },
                  units: { type: "number", exclusiveMinimum: 0, maximum: 99999 },
                  unitPrice: { type: "number", minimum: 0, maximum: 100000 },
                  discountPct: { type: "number", minimum: 0, maximum: 100 },
                  taxRate: { type: "number", minimum: 0, maximum: 100 },
                  modifiers: {
                    type: "array",
                    items: { type: "string", maxLength: 80 },
                    maxItems: 10,
                  },
                },
              },
            },
            payments: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                required: ["method", "amount"],
                additionalProperties: false,
                properties: {
                  method: {
                    type: "string",
                    enum: ["CASH", "CARD", "BIZUM", "VOUCHER", "OTHER"],
                  },
                  amount: { type: "number", minimum: 0, maximum: 1_000_000 },
                  meta: { type: "object", additionalProperties: true },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const body = request.body as CreateTicketBody;
      const prisma = getPrisma();

      // 1. Idempotencia: ¿ya existe este externalId? Si sí, devolvemos
      //    el ticket existente con 200 (cliente puede reintentar tras un
      //    timeout sin generar duplicados). Spike §04.F.
      const existing = await prisma.ticket.findUnique({
        where: { externalId: body.externalId },
        include: ticketInclude(),
      });
      if (existing) {
        if (existing.tenantId !== cashier.tid) {
          return reply.code(409).send({
            error: "EXTERNAL_ID_CONFLICT",
            message: "Este externalId ya pertenece a otro tenant.",
          });
        }
        return reply.code(200).send({
          ticket: serializeTicket(existing),
          duplicate: true,
        });
      }

      // 2. Caja y turno pertenecen al tenant + cashier.rid.
      if (body.registerId !== cashier.rid) {
        return reply.code(403).send({
          error: "REGISTER_MISMATCH",
          message: "La caja del ticket no coincide con tu sesión.",
        });
      }
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

      // 3. Validaciones de totales y pagos.
      const totals = computeTicket(
        body.lines.map((l) => ({
          units: l.units,
          unitPrice: l.unitPrice,
          discountPct: l.discountPct,
          taxRate: l.taxRate,
        })),
      );
      const paymentsSum = body.payments.reduce((acc, p) => acc + p.amount, 0);
      if (!paymentsClose(paymentsSum, totals.total)) {
        return reply.code(400).send({
          error: "PAYMENTS_MISMATCH",
          message: `Σ payments (${paymentsSum.toFixed(2)}) no coincide con total (${totals.total.toFixed(2)})`,
          tolerance: PAYMENT_TOLERANCE_EUR,
        });
      }
      // El servidor confía en lo calculado por él mismo (no hay total
      // en el body — sólo líneas y pagos). El recálculo es la línea de
      // defensa: si payments no cierran, rechazamos.
      void TOTAL_TOLERANCE_EUR; // documentado, sin uso runtime aquí.

      // 4. Skus no vacíos.
      for (const l of body.lines) {
        if (!l.sku || l.sku.trim() === "") {
          return reply.code(400).send({
            error: "LINE_WITHOUT_SKU",
            message:
              "Una línea sin SKU no es vendible vía Holded. Usa el comodín TPV-OTROS-{IVA}.",
            line: l.nameSnapshot,
          });
        }
      }

      // 5. Internal number atómico (incrementa register.ticketCounter).
      const next = await prisma.register.update({
        where: { id: cashier.rid },
        data: { ticketCounter: { increment: 1 } },
        select: { ticketCounter: true },
      });
      const internalNumber = String(next.ticketCounter).padStart(6, "0");

      // 6. Persiste todo en transacción.
      const ticket = await prisma.$transaction(async (tx) => {
        const t = await tx.ticket.create({
          data: {
            tenantId: cashier.tid,
            registerId: cashier.rid,
            shiftId: body.shiftId,
            userId: cashier.sub,
            internalNumber,
            externalId: body.externalId,
            contactHoldedId: body.contactHoldedId ?? null,
            status: TicketStatus.PENDING_SYNC,
            total: new Prisma.Decimal(totals.total),
            totalTax: new Prisma.Decimal(totals.tax),
            totalDiscount: new Prisma.Decimal(totals.discount),
            notes: body.notes ?? null,
            cashAmount:
              body.cashAmount != null ? new Prisma.Decimal(body.cashAmount) : null,
            printIntent: body.printIntent ?? true,
            emailIntent: body.emailIntent ?? null,
            giftReceiptIntentAt: body.giftReceiptIntent ? new Date() : null,
            paidAt: new Date(),
            lines: {
              create: body.lines.map((l, i) => ({
                productId: l.productId ?? null,
                variantId: l.variantId ?? null,
                holdedProductId: l.holdedProductId ?? null,
                sku: l.sku,
                nameSnapshot: l.nameSnapshot,
                units: new Prisma.Decimal(l.units),
                unitPrice: new Prisma.Decimal(l.unitPrice),
                discountPct: new Prisma.Decimal(l.discountPct),
                taxRate: new Prisma.Decimal(l.taxRate),
                subtotal: new Prisma.Decimal(totals.lines[i]!.subtotal),
                total: new Prisma.Decimal(totals.lines[i]!.total),
                modifiers:
                  l.modifiers && l.modifiers.length > 0
                    ? (l.modifiers as unknown as object)
                    : Prisma.JsonNull,
              })),
            },
            payments: {
              create: body.payments.map((p) => ({
                method: p.method,
                amount: new Prisma.Decimal(p.amount),
                meta: p.meta ? (p.meta as object) : Prisma.JsonNull,
              })),
            },
          },
          include: ticketInclude(),
        });
        await tx.shift.update({
          where: { id: body.shiftId },
          data: { lastActivityAt: new Date() },
        });
        await tx.holdedUpload.upsert({
          where: { externalId: body.externalId },
          create: {
            externalId: body.externalId,
            tenantId: cashier.tid,
            kind: "TICKET",
            status: "PENDING",
          },
          update: {},
        });
        return t;
      });

      // 7. Encolar upload-ticket (idempotente; jobId determinista).
      try {
        await enqueueTicketUpload(body.externalId);
      } catch (err) {
        request.log.error(
          { externalId: body.externalId },
          `enqueue ticket upload falló: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // Si el cajero introdujo un email, encolamos el reenvío al
      // confirmar la sync (el worker upload-ticket dispara el email job
      // tras pasar a SYNCED). Lo dejamos PENDING aquí.
      if (body.emailIntent) {
        try {
          await prisma.ticketEmailJob.create({
            data: {
              id: randomUUID(),
              ticketId: ticket.id,
              toEmail: body.emailIntent,
              requestedByUserId: cashier.sub,
              status: "PENDING",
            },
          });
        } catch (err) {
          request.log.warn(
            { ticketId: ticket.id },
            `no se pudo registrar email intent: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      return reply.code(201).send({
        ticket: serializeTicket(ticket),
        syncStatus: ticket.status,
      });
    },
  );

  // ── GET /tickets/:id ────────────────────────────────────────────────
  app.get(
    "/tickets/:ticketId",
    {
      preHandler: requireCashierSession,
      schema: {
        params: {
          type: "object",
          required: ["ticketId"],
          properties: { ticketId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { ticketId } = request.params as { ticketId: string };
      const prisma = getPrisma();
      const ticket = await prisma.ticket.findFirst({
        where: { id: ticketId, tenantId: cashier.tid },
        include: ticketInclude(),
      });
      if (!ticket) {
        return reply
          .code(404)
          .send({ error: "TICKET_NOT_FOUND", message: "Ticket no encontrado" });
      }
      return { ticket: serializeTicket(ticket) };
    },
  );

  // ── GET /tickets ────────────────────────────────────────────────────
  app.get(
    "/tickets",
    {
      preHandler: requireCashierSession,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            q: { type: "string", maxLength: 64 },
            from: { type: "string", format: "date-time" },
            to: { type: "string", format: "date-time" },
            status: {
              type: "string",
              enum: [
                "DRAFT",
                "PAID",
                "PENDING_SYNC",
                "SYNCED",
                "SYNC_FAILED",
                "VOIDED",
              ],
            },
            registerId: { type: "string", format: "uuid" },
            shiftId: { type: "string", format: "uuid" },
            method: {
              type: "string",
              enum: ["CASH", "CARD", "BIZUM", "VOUCHER", "OTHER"],
            },
            cursor: { type: "string", format: "uuid" },
            limit: { type: "integer", minimum: 1, maximum: 100 },
          },
        },
      },
    },
    async (request) => {
      const cashier = request.cashier!;
      const q = request.query as {
        q?: string;
        from?: string;
        to?: string;
        status?: TicketStatus;
        registerId?: string;
        shiftId?: string;
        method?: string;
        cursor?: string;
        limit?: number;
      };
      const prisma = getPrisma();
      const limit = q.limit ?? 25;
      const where: Prisma.TicketWhereInput = {
        tenantId: cashier.tid,
      };
      if (q.status) where.status = q.status;
      if (q.registerId) where.registerId = q.registerId;
      if (q.shiftId) where.shiftId = q.shiftId;
      if (q.from || q.to) {
        where.createdAt = {};
        if (q.from) where.createdAt.gte = new Date(q.from);
        if (q.to) where.createdAt.lte = new Date(q.to);
      }
      if (q.q) {
        // Búsqueda: número interno (correlativo), externalId completo,
        // o docNumber fiscal.
        where.OR = [
          { internalNumber: q.q },
          { holdedDocNumber: q.q },
          { externalId: q.q as string },
        ];
      }
      if (q.method) {
        where.payments = { some: { method: q.method as "CASH" } };
      }
      const tickets = await prisma.ticket.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        include: ticketInclude(),
      });
      const hasMore = tickets.length > limit;
      const items = (hasMore ? tickets.slice(0, limit) : tickets).map(
        serializeTicket,
      );
      return {
        items,
        nextCursor: hasMore ? items[items.length - 1]!.id : null,
      };
    },
  );

  // ── POST /tickets/:id/resend-email ──────────────────────────────────
  app.post(
    "/tickets/:ticketId/resend-email",
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
          required: ["email"],
          additionalProperties: false,
          properties: { email: { type: "string", maxLength: 320 } },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { ticketId } = request.params as { ticketId: string };
      const { email } = request.body as { email: string };
      const prisma = getPrisma();
      const ticket = await prisma.ticket.findFirst({
        where: { id: ticketId, tenantId: cashier.tid },
        select: { id: true, status: true, holdedDocumentId: true },
      });
      if (!ticket) {
        return reply
          .code(404)
          .send({ error: "TICKET_NOT_FOUND", message: "Ticket no encontrado" });
      }
      const job = await prisma.ticketEmailJob.create({
        data: {
          id: randomUUID(),
          ticketId: ticket.id,
          toEmail: email,
          requestedByUserId: cashier.sub,
          status: "PENDING",
        },
        select: { id: true },
      });
      try {
        await enqueueTicketEmail(job.id);
      } catch (err) {
        request.log.warn(
          { ticketId, jobId: job.id },
          `enqueue ticket email falló: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return reply.code(202).send({ jobId: job.id });
    },
  );

  // ── POST /tickets/:id/gift-receipt-intent ───────────────────────────
  app.post(
    "/tickets/:ticketId/gift-receipt-intent",
    {
      preHandler: requireCashierSession,
      schema: {
        params: {
          type: "object",
          required: ["ticketId"],
          properties: { ticketId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { ticketId } = request.params as { ticketId: string };
      const prisma = getPrisma();
      const ticket = await prisma.ticket.findFirst({
        where: { id: ticketId, tenantId: cashier.tid },
        select: { id: true, status: true },
      });
      if (!ticket) {
        return reply
          .code(404)
          .send({ error: "TICKET_NOT_FOUND", message: "Ticket no encontrado" });
      }
      // Núcleo §11: ticket regalo sólo aplica a tickets SYNCED. En B4
      // sólo guardamos intent — B5 hará la impresión real.
      await prisma.ticket.update({
        where: { id: ticketId },
        data: { giftReceiptIntentAt: new Date() },
      });
      return reply.code(200).send({ ok: true });
    },
  );

  // ── POST /refunds ───────────────────────────────────────────────────
  app.post(
    "/refunds",
    {
      preHandler: requireCashierSession,
      schema: {
        body: {
          type: "object",
          required: ["externalId", "originalTicketId", "lines"],
          additionalProperties: false,
          properties: {
            externalId: { type: "string", pattern: UUID_V4 },
            originalTicketId: { type: "string", format: "uuid" },
            method: {
              type: "string",
              enum: ["CASH", "CARD", "BIZUM", "VOUCHER", "OTHER"],
            },
            reason: { type: "string", maxLength: 500 },
            lines: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                required: ["ticketLineId", "units"],
                additionalProperties: false,
                properties: {
                  ticketLineId: { type: "string", format: "uuid" },
                  units: { type: "number", exclusiveMinimum: 0, maximum: 99999 },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const body = request.body as {
        externalId: string;
        originalTicketId: string;
        method?: "CASH" | "CARD" | "BIZUM" | "VOUCHER" | "OTHER";
        reason?: string;
        lines: Array<{ ticketLineId: string; units: number }>;
      };
      const prisma = getPrisma();

      // Idempotencia.
      const existing = await prisma.refund.findUnique({
        where: { externalId: body.externalId },
        include: refundInclude(),
      });
      if (existing) {
        return reply.code(200).send({ refund: serializeRefund(existing), duplicate: true });
      }

      const ticket = await prisma.ticket.findFirst({
        where: { id: body.originalTicketId, tenantId: cashier.tid },
        include: { lines: true, payments: true, refunds: { include: { lines: true } } },
      });
      if (!ticket) {
        return reply
          .code(404)
          .send({ error: "TICKET_NOT_FOUND", message: "Ticket original no encontrado" });
      }
      if (ticket.status !== TicketStatus.SYNCED && ticket.status !== TicketStatus.PAID) {
        return reply.code(409).send({
          error: "TICKET_NOT_REFUNDABLE",
          message:
            "Sólo se puede devolver un ticket cobrado y sincronizado con Holded.",
        });
      }

      // Validar unidades por línea: nunca exceder unidades originales
      // menos las ya devueltas en refunds previos.
      const alreadyRefunded = new Map<string, number>();
      for (const r of ticket.refunds) {
        for (const rl of r.lines) {
          alreadyRefunded.set(
            rl.ticketLineId,
            (alreadyRefunded.get(rl.ticketLineId) ?? 0) + Number(rl.units),
          );
        }
      }
      const refundLinesData: Array<{
        ticketLineId: string;
        units: number;
        nameSnapshot: string;
        sku: string;
        unitPrice: number;
        taxRate: number;
        discountPct: number;
        total: number;
      }> = [];
      for (const rl of body.lines) {
        const original = ticket.lines.find((l) => l.id === rl.ticketLineId);
        if (!original) {
          return reply.code(400).send({
            error: "REFUND_LINE_NOT_FOUND",
            message: `La línea ${rl.ticketLineId} no pertenece al ticket original.`,
          });
        }
        const previouslyRefunded = alreadyRefunded.get(rl.ticketLineId) ?? 0;
        const maxRefundable = Number(original.units) - previouslyRefunded;
        if (rl.units > maxRefundable + 1e-9) {
          return reply.code(400).send({
            error: "REFUND_EXCEEDS_ORIGINAL",
            message: `No puedes devolver más unidades de las vendidas (${maxRefundable} máx).`,
            ticketLineId: rl.ticketLineId,
          });
        }
        const unitPrice = Number(original.unitPrice);
        const discountPct = Number(original.discountPct);
        const taxRate = Number(original.taxRate);
        const grossPerUnit = unitPrice * (1 - discountPct / 100);
        const lineTotal = Math.round(grossPerUnit * rl.units * (1 + taxRate / 100) * 100) / 100;
        refundLinesData.push({
          ticketLineId: rl.ticketLineId,
          units: rl.units,
          nameSnapshot: original.nameSnapshot,
          sku: original.sku,
          unitPrice,
          taxRate,
          discountPct,
          total: lineTotal,
        });
      }

      const total = Math.round(refundLinesData.reduce((acc, l) => acc + l.total, 0) * 100) / 100;
      // tax aprox: total - (total / (1+max(taxRate)/100)). Mejor: línea-a-línea.
      const tax = Math.round(
        refundLinesData.reduce((acc, l) => {
          const subtotal = (l.total * 100) / (100 + Number(l.taxRate));
          return acc + (l.total - subtotal);
        }, 0) * 100,
      ) / 100;

      // Método por defecto: el del cobro original (primer payment).
      const methodFromPayment = ticket.payments[0]?.method ?? null;
      const method = body.method ?? methodFromPayment;

      // Internal number del refund: prefijo "R-" + correlativo register.
      const next = await prisma.register.update({
        where: { id: ticket.registerId },
        data: { ticketCounter: { increment: 1 } },
        select: { ticketCounter: true },
      });
      const internalNumber = `R-${String(next.ticketCounter).padStart(6, "0")}`;

      // Find an open shift on this register for the actor (refund is
      // attributed to the actor's current shift if there is one).
      const openShift = await prisma.shift.findFirst({
        where: { registerId: ticket.registerId, closedAt: null },
        select: { id: true },
      });

      const refund = await prisma.$transaction(async (tx) => {
        const r = await tx.refund.create({
          data: {
            tenantId: cashier.tid,
            originalTicketId: ticket.id,
            userId: cashier.sub,
            registerId: ticket.registerId,
            shiftId: openShift?.id ?? null,
            internalNumber,
            externalId: body.externalId,
            status: TicketStatus.PENDING_SYNC,
            reason: body.reason ?? null,
            method,
            total: new Prisma.Decimal(total),
            totalTax: new Prisma.Decimal(tax),
            lines: {
              create: refundLinesData.map((l) => ({
                ticketLineId: l.ticketLineId,
                units: new Prisma.Decimal(l.units),
                total: new Prisma.Decimal(l.total),
                nameSnapshot: l.nameSnapshot,
                sku: l.sku,
                unitPrice: new Prisma.Decimal(l.unitPrice),
                taxRate: new Prisma.Decimal(l.taxRate),
                discountPct: new Prisma.Decimal(l.discountPct),
              })),
            },
          },
          include: refundInclude(),
        });
        await tx.holdedUpload.upsert({
          where: { externalId: body.externalId },
          create: {
            externalId: body.externalId,
            tenantId: cashier.tid,
            kind: "REFUND",
            status: "PENDING",
          },
          update: {},
        });
        return r;
      });

      try {
        await enqueueRefundUpload(body.externalId);
      } catch (err) {
        request.log.error(
          { externalId: body.externalId },
          `enqueue refund upload falló: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return reply.code(201).send({ refund: serializeRefund(refund) });
    },
  );
}

function ticketInclude() {
  return {
    lines: true,
    payments: true,
    refunds: { select: { id: true, externalId: true, total: true, createdAt: true, status: true } },
    register: { select: { id: true, name: true, store: { select: { name: true } } } },
  } as const;
}

function refundInclude() {
  return {
    lines: true,
  } as const;
}

type DbTicket = Awaited<ReturnType<ReturnType<typeof getPrisma>["ticket"]["findUniqueOrThrow"]>> & {
  lines: Array<unknown>;
  payments: Array<unknown>;
  refunds: Array<unknown>;
  register?: { id: string; name: string; store: { name: string } };
};

function serializeTicket(t: DbTicket): Record<string, unknown> {
  const ticket = t as unknown as {
    id: string;
    internalNumber: string;
    externalId: string;
    status: TicketStatus;
    total: { toString(): string };
    totalTax: { toString(): string };
    totalDiscount: { toString(): string };
    cashAmount: { toString(): string } | null;
    notes: string | null;
    contactHoldedId: string | null;
    registerId: string;
    shiftId: string;
    userId: string;
    holdedDocumentId: string | null;
    holdedDocNumber: string | null;
    holdedPdfUrl: string | null;
    printIntent: boolean;
    emailIntent: string | null;
    giftReceiptIntentAt: Date | null;
    syncError: unknown;
    createdAt: Date;
    paidAt: Date | null;
    syncedAt: Date | null;
    lines: Array<{
      id: string;
      productId: string | null;
      variantId: string | null;
      holdedProductId: string | null;
      sku: string;
      nameSnapshot: string;
      units: { toString(): string };
      unitPrice: { toString(): string };
      discountPct: { toString(): string };
      taxRate: { toString(): string };
      subtotal: { toString(): string };
      total: { toString(): string };
      modifiers: unknown;
    }>;
    payments: Array<{
      id: string;
      method: string;
      amount: { toString(): string };
      meta: unknown;
    }>;
    refunds: Array<{
      id: string;
      externalId: string;
      total: { toString(): string };
      createdAt: Date;
      status: string;
    }>;
    register?: { id: string; name: string; store: { name: string } };
  };
  return {
    id: ticket.id,
    internalNumber: ticket.internalNumber,
    externalId: ticket.externalId,
    status: ticket.status,
    total: Number(ticket.total.toString()),
    totalTax: Number(ticket.totalTax.toString()),
    totalDiscount: Number(ticket.totalDiscount.toString()),
    cashAmount: ticket.cashAmount ? Number(ticket.cashAmount.toString()) : null,
    notes: ticket.notes,
    contactHoldedId: ticket.contactHoldedId,
    registerId: ticket.registerId,
    shiftId: ticket.shiftId,
    userId: ticket.userId,
    holdedDocumentId: ticket.holdedDocumentId,
    holdedDocNumber: ticket.holdedDocNumber,
    holdedPdfUrl: ticket.holdedPdfUrl,
    printIntent: ticket.printIntent,
    emailIntent: ticket.emailIntent,
    giftReceiptIntentAt: ticket.giftReceiptIntentAt?.toISOString() ?? null,
    syncError: ticket.syncError,
    createdAt: ticket.createdAt.toISOString(),
    paidAt: ticket.paidAt?.toISOString() ?? null,
    syncedAt: ticket.syncedAt?.toISOString() ?? null,
    register: ticket.register
      ? {
          id: ticket.register.id,
          name: ticket.register.name,
          storeName: ticket.register.store.name,
        }
      : undefined,
    lines: ticket.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      variantId: l.variantId,
      holdedProductId: l.holdedProductId,
      sku: l.sku,
      nameSnapshot: l.nameSnapshot,
      units: Number(l.units.toString()),
      unitPrice: Number(l.unitPrice.toString()),
      discountPct: Number(l.discountPct.toString()),
      taxRate: Number(l.taxRate.toString()),
      subtotal: Number(l.subtotal.toString()),
      total: Number(l.total.toString()),
      modifiers: Array.isArray(l.modifiers) ? (l.modifiers as string[]) : [],
    })),
    payments: ticket.payments.map((p) => ({
      id: p.id,
      method: p.method,
      amount: Number(p.amount.toString()),
      meta: p.meta,
    })),
    refunds: ticket.refunds.map((r) => ({
      id: r.id,
      externalId: r.externalId,
      total: Number(r.total.toString()),
      createdAt: r.createdAt.toISOString(),
      status: r.status,
    })),
  };
}

function serializeRefund(r: Record<string, unknown>): Record<string, unknown> {
  const refund = r as unknown as {
    id: string;
    internalNumber: string;
    externalId: string;
    status: TicketStatus;
    method: string | null;
    total: { toString(): string };
    totalTax: { toString(): string };
    holdedDocumentId: string | null;
    holdedDocNumber: string | null;
    reason: string | null;
    createdAt: Date;
    syncedAt: Date | null;
    lines: Array<{
      id: string;
      ticketLineId: string;
      nameSnapshot: string;
      sku: string;
      units: { toString(): string };
      unitPrice: { toString(): string };
      taxRate: { toString(): string };
      discountPct: { toString(): string };
      total: { toString(): string };
    }>;
  };
  return {
    id: refund.id,
    internalNumber: refund.internalNumber,
    externalId: refund.externalId,
    status: refund.status,
    method: refund.method,
    total: Number(refund.total.toString()),
    totalTax: Number(refund.totalTax.toString()),
    reason: refund.reason,
    holdedDocumentId: refund.holdedDocumentId,
    holdedDocNumber: refund.holdedDocNumber,
    createdAt: refund.createdAt.toISOString(),
    syncedAt: refund.syncedAt?.toISOString() ?? null,
    lines: refund.lines.map((l) => ({
      id: l.id,
      ticketLineId: l.ticketLineId,
      nameSnapshot: l.nameSnapshot,
      sku: l.sku,
      units: Number(l.units.toString()),
      unitPrice: Number(l.unitPrice.toString()),
      discountPct: Number(l.discountPct.toString()),
      taxRate: Number(l.taxRate.toString()),
      total: Number(l.total.toString()),
    })),
  };
}
