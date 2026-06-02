// v1.4-Impresoras-Fase-1 Lote 2 (refactor Lote 4) · enviar comandas
// vía ESC/POS WIFI.
//
//   POST /tickets/:ticketId/send-to-kitchen/escpos
//
// Mismo comportamiento que `/send-to-kitchen` (sin fallback PDF). Se
// mantiene como URL hermana para que el TPV pueda llamar a la versión
// "limpia" sin riesgo de degradación accidental al endpoint legacy.
// Toda la lógica vive en `kitchen-dispatch.ts`.

import type { FastifyInstance } from "fastify";

import { requireCashierSession } from "../shift/cashier-session.js";
import { dispatchKitchenTicket } from "./kitchen-dispatch.js";

export async function registerSendToKitchenEscposRoute(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    "/tickets/:ticketId/send-to-kitchen/escpos",
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
      const result = await dispatchKitchenTicket(ticketId, {
        tenantId: cashier.tid,
        registerId: cashier.rid,
        cashierId: cashier.sub,
      });
      if ("kind" in result) {
        switch (result.kind) {
          case "not-found":
            return reply.code(404).send({
              error: "TICKET_NOT_FOUND_OR_NOT_DRAFT",
              message: "Sólo se envían comandas de un ticket DRAFT.",
            });
          case "register-mismatch":
            return reply.code(403).send({
              error: "REGISTER_MISMATCH",
              message: "El ticket no pertenece a tu caja.",
            });
          case "empty":
            return reply.code(400).send({
              error: "EMPTY_TICKET",
              message: "El ticket no tiene líneas. Añade alguna antes de enviar.",
            });
        }
      }
      return reply.code(result.http).send(result.body);
    },
  );
}
