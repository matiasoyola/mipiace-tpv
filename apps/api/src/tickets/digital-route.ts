// GET /tickets/:ticketId/digital — payload del ticket digital
// para la pantalla post-cobro de la PWA (B-Print fase 1 · Frente 5).
//
// Devuelve en una sola llamada todo lo que la pantalla "Ticket emitido"
// necesita:
//   - `document`: el TicketDocument listo para renderTicketPdf en el
//     browser (con fechas ISO; el cliente las re-hidrata).
//   - `ticketDelivery`: la config de la tienda (botones, captions).
//   - `publicSlug` para el QR / link de descarga.
//   - `emailedTo`: email al que se envió automáticamente (si lo hubo).

import type { FastifyInstance } from "fastify";

import { DEFAULT_TICKET_DELIVERY } from "../admin/ticket-delivery.js";
import { getPrisma } from "../context.js";
import { requireCashierSession } from "../shift/cashier-session.js";
import { loadTicketDocument } from "./build-document.js";

export async function registerTicketDigitalRoute(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/tickets/:ticketId/digital",
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
        select: {
          id: true,
          publicSlug: true,
          status: true,
          register: {
            select: { store: { select: { ticketDelivery: true } } },
          },
          emailJobs: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { toEmail: true },
          },
        },
      });
      if (!ticket) {
        return reply
          .code(404)
          .send({ error: "TICKET_NOT_FOUND", message: "Ticket no encontrado" });
      }
      const doc = await loadTicketDocument({ prisma, ticketId });
      if (!doc) {
        return reply
          .code(404)
          .send({ error: "TICKET_NOT_FOUND", message: "Ticket no encontrado" });
      }
      const delivery =
        (ticket.register.store.ticketDelivery as Record<string, unknown> | null) ??
        DEFAULT_TICKET_DELIVERY;
      return reply.code(200).send({
        publicSlug: ticket.publicSlug,
        emailedTo: ticket.emailJobs[0]?.toEmail ?? null,
        ticketDelivery: { ...DEFAULT_TICKET_DELIVERY, ...delivery },
        document: {
          ...doc,
          ticket: {
            ...doc.ticket,
            issuedAt: doc.ticket.issuedAt.toISOString(),
          },
        },
      });
    },
  );
}
