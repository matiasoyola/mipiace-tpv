// v1.4-Bar-Operativa-MVP Lote 4 · split bill Modo A: partir importe.
//
//   POST /tickets/:ticketId/partial-payment
//     Body: { amount, method, cashAmount?, meta? }
//     → registra un cobro parcial sobre un ticket DRAFT.
//     → devuelve `{ partialId, collected, remaining, total }`.
//
// El ticket NO se cierra aquí — incluso si el partial llega a saldar
// el total, el cierre fiscal (cambio de status a PAID + sync Holded)
// se hace por el flujo regular `/checkout` para no duplicar la lógica
// del salesreceipt y la cola BullMQ. El TPV, al ver `remaining<=0`
// tras un partial, llama a `/checkout` con un body especial:
//   `{ payments: [], usePartialPayments: true }`
// y el checkout suma los partials y los usa como `TicketPayment`
// del cobro final.

import type { FastifyInstance } from "fastify";

import { Prisma } from "@mipiacetpv/db";

import { getPrisma } from "../context.js";
import { requireCashierSession } from "../shift/cashier-session.js";
import {
  PAYMENT_TOLERANCE_EUR,
  computeTicket,
} from "./totals.js";

const PAYMENT_METHODS = ["CASH", "CARD", "BIZUM", "VOUCHER", "OTHER"] as const;

export async function registerPartialPaymentRoute(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    "/tickets/:ticketId/partial-payment",
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
          required: ["amount", "method"],
          additionalProperties: false,
          properties: {
            amount: { type: "number", exclusiveMinimum: 0, maximum: 1_000_000 },
            method: { type: "string", enum: PAYMENT_METHODS as unknown as string[] },
            cashAmount: { type: "number", minimum: 0, maximum: 1_000_000 },
            meta: { type: "object", additionalProperties: true },
          },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { ticketId } = request.params as { ticketId: string };
      const body = request.body as {
        amount: number;
        method: (typeof PAYMENT_METHODS)[number];
        cashAmount?: number;
        meta?: Record<string, unknown>;
      };
      const prisma = getPrisma();

      const ticket = await prisma.ticket.findFirst({
        where: { id: ticketId, tenantId: cashier.tid, status: "DRAFT" },
        include: {
          lines: {
            select: {
              units: true,
              unitPrice: true,
              discountPct: true,
              taxRate: true,
              modifiers: true,
            },
          },
          partialPayments: { select: { amount: true } },
        },
      });
      if (!ticket) {
        return reply.code(404).send({
          error: "TICKET_NOT_FOUND_OR_NOT_DRAFT",
          message:
            "Sólo se pueden añadir cobros parciales a tickets en DRAFT.",
        });
      }
      if (ticket.registerId !== cashier.rid) {
        return reply.code(403).send({
          error: "REGISTER_MISMATCH",
          message: "El ticket no pertenece a tu caja.",
        });
      }
      if (ticket.lines.length === 0) {
        return reply.code(400).send({
          error: "TICKET_EMPTY",
          message: "Añade líneas antes de cobrar parcialmente.",
        });
      }

      const totals = computeTicket(
        ticket.lines.map((l) => ({
          units: Number(l.units),
          unitPrice:
            Number(l.unitPrice) + readUnitPriceDeltaCents(l.modifiers) / 100,
          discountPct: Number(l.discountPct),
          taxRate: Number(l.taxRate),
        })),
      );
      const total = Math.round(totals.total * 100) / 100;
      const collected =
        Math.round(
          ticket.partialPayments.reduce(
            (acc, p) => acc + Number(p.amount),
            0,
          ) * 100,
        ) / 100;
      const remaining = Math.round((total - collected) * 100) / 100;

      // Tolerancia: el cajero podría meter 19,99€ cuando quedan 20€
      // por redondeo del display — aceptamos el exceso siempre que
      // esté dentro de tolerancia. Si supera, devolvemos 400 con
      // breakdown para que el TPV pinte un mensaje específico.
      if (body.amount > remaining + PAYMENT_TOLERANCE_EUR) {
        return reply.code(400).send({
          error: "AMOUNT_EXCEEDS_REMAINING",
          message: `El importe (${body.amount.toFixed(2)} €) supera el pendiente (${remaining.toFixed(2)} €).`,
          total,
          collected,
          remaining,
        });
      }

      const created = await prisma.ticketPartialPayment.create({
        data: {
          ticketId: ticket.id,
          amount: new Prisma.Decimal(body.amount),
          method: body.method,
          cashierId: cashier.sub,
          cashAmount:
            body.cashAmount != null
              ? new Prisma.Decimal(body.cashAmount)
              : null,
          meta:
            body.meta !== undefined
              ? (body.meta as Prisma.InputJsonValue)
              : Prisma.JsonNull,
        },
        select: { id: true },
      });

      const newCollected = Math.round((collected + body.amount) * 100) / 100;
      const newRemaining = Math.round((total - newCollected) * 100) / 100;

      return reply.code(201).send({
        partialId: created.id,
        total,
        collected: newCollected,
        remaining: newRemaining < 0 ? 0 : newRemaining,
        // Si tras este cobro el pendiente entra en tolerancia, el TPV
        // sabe que el siguiente paso es invocar /checkout para cerrar
        // el ticket usando los partials acumulados.
        readyToClose: newRemaining <= PAYMENT_TOLERANCE_EUR,
      });
    },
  );
}

// Igual que en upload-ticket / operativa: lee el delta total de
// unitPrice (céntimos) del snapshot estructurado de modifiers.
function readUnitPriceDeltaCents(raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  let sum = 0;
  for (const entry of raw) {
    if (
      entry &&
      typeof entry === "object" &&
      "priceDeltaCents" in entry &&
      typeof (entry as { priceDeltaCents?: unknown }).priceDeltaCents === "number"
    ) {
      sum += (entry as { priceDeltaCents: number }).priceDeltaCents;
    }
  }
  return sum;
}
