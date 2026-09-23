// GET /tickets/:ticketId/digital — payload del ticket digital
// para la pantalla post-cobro de la PWA (B-Print fase 1 · Frente 5).
//
// Devuelve en una sola llamada todo lo que la pantalla "Ticket emitido"
// necesita:
//   - `document`: el TicketDocument listo para renderTicketPdf en el
//     browser (con fechas ISO; el cliente las re-hidrata).
//   - `ticketDelivery`: la config de la tienda (botones, captions).
//   - `publicSlug` para el QR / link de descarga.
//   - `email`: el estado REAL del envío (`PENDING` / `SENT` / `FAILED`),
//     derivado en `email-status.ts`. Es lo que pinta el badge desde el
//     bloque de Sole: al salir del cobro el envío está encolado, no
//     enviado, y la pantalla dice "Se enviará a …".
//   - `emailedTo`: el destinatario del último job. SE MANTIENE por
//     compatibilidad — el TPV lleva su propio bundle desde A4 y un AP12
//     sin APK nueva sigue leyendo este campo. Los bundles nuevos usan
//     `email`, que es el que no miente.

import type { FastifyInstance } from "fastify";

import { DEFAULT_TICKET_DELIVERY } from "../admin/ticket-delivery.js";
import { getPrisma } from "../context.js";
import { requireCashierSession } from "../shift/cashier-session.js";
import { loadTicketDocument } from "./build-document.js";
import {
  deriveTicketEmailState,
  EMAIL_JOB_SELECT,
} from "./email-status.js";
import { ensureCajaEnabled } from "../lib/caja-gate.js";

export async function registerTicketDigitalRoute(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/tickets/:ticketId/digital",
    {
      preHandler: [requireCashierSession, ensureCajaEnabled],
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
          emailIntent: true,
          emailFailedAt: true,
          emailJobs: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: EMAIL_JOB_SELECT,
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
        email: deriveTicketEmailState({
          jobs: ticket.emailJobs,
          emailIntent: ticket.emailIntent,
          emailFailedAt: ticket.emailFailedAt,
        }),
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
