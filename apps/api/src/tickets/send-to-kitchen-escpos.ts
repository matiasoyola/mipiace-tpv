// v1.4-Impresoras-Fase-1 Lote 2 (refactor Lote 4) · enviar comandas vía
// ESC/POS WIFI. kds-1-cocina · y a la PANTALLA, y por diferencias.
//
//   POST /tickets/:ticketId/send-to-kitchen/escpos
//
// Mismo comportamiento que `/send-to-kitchen` (sin fallback PDF). Se
// mantiene como URL hermana para que el TPV pueda llamar a la versión
// «limpia» sin riesgo de degradación accidental al endpoint legacy.
// Toda la lógica vive en `kitchen/envio.ts`; la traducción a HTTP, en
// `send-to-kitchen.ts`.
//
// El nombre ya no es exacto —esta URL manda a pantallas tanto como a
// impresoras— y se queda igual a propósito: es la que el TPV desplegado
// llama, y renombrarla obligaría a desplegar las dos cosas a la vez.

import type { FastifyInstance } from "fastify";

import { requireCashierSession } from "../shift/cashier-session.js";
import { ensureCajaEnabled } from "../lib/caja-gate.js";
import { ENVIO_BODY_SCHEMA, responderEnvio } from "./send-to-kitchen.js";

export async function registerSendToKitchenEscposRoute(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    "/tickets/:ticketId/send-to-kitchen/escpos",
    {
      preHandler: [requireCashierSession, ensureCajaEnabled],
      schema: {
        params: {
          type: "object",
          required: ["ticketId"],
          properties: { ticketId: { type: "string", format: "uuid" } },
        },
        body: ENVIO_BODY_SCHEMA,
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { ticketId } = request.params as { ticketId: string };
      const body = (request.body ?? {}) as {
        clientSendId?: string;
        urgent?: boolean;
        sentAt?: string;
      };
      return responderEnvio(
        reply,
        ticketId,
        {
          tenantId: cashier.tid,
          registerId: cashier.rid,
          cashierId: cashier.sub,
        },
        body,
      );
    },
  );
}
