// Endpoint público GET /tickets/:publicSlug/pdf (B-Print fase 1, F3).
//
// Sin auth — la URL es una capability de 64 bits (16 chars hex) que
// viaja en el QR / email. Si el slug no existe o el ticket está DRAFT
// (no emitido todavía) devolvemos 404 — la misma respuesta para los
// dos casos evita filtrar la existencia del slug a un escáner.
// B-Hardening A · S4: corregido el comentario que decía "~96 bits".
//
// Cache HTTP `private, max-age=3600` porque el PDF es el mismo todo
// el tiempo y el cliente que lo abrió hace 30 min lo puede volver a
// pintar sin pegarle al backend.

import type { FastifyInstance } from "fastify";

import { getPrisma } from "../context.js";
import { renderTicketPdf } from "@mipiacetpv/ticket-pdf";
import { loadTicketDocument } from "./build-document.js";

const SLUG_PATTERN = /^[0-9a-f]{16}$/;

export async function registerPublicTicketPdfRoute(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/tickets/:publicSlug/pdf",
    {
      schema: {
        params: {
          type: "object",
          required: ["publicSlug"],
          properties: {
            publicSlug: { type: "string", minLength: 16, maxLength: 16 },
          },
        },
      },
    },
    async (request, reply) => {
      const { publicSlug } = request.params as { publicSlug: string };
      if (!SLUG_PATTERN.test(publicSlug)) {
        return reply.code(404).send({ error: "TICKET_NOT_FOUND" });
      }
      const prisma = getPrisma();
      // findFirst con select sólo del estado nos permite responder 404
      // rápido sin cargar todas las relaciones cuando el slug no
      // existe (~99% de los hits no autorizados).
      const stub = await prisma.ticket.findUnique({
        where: { publicSlug },
        select: { status: true },
      });
      if (!stub || stub.status === "DRAFT") {
        return reply.code(404).send({ error: "TICKET_NOT_FOUND" });
      }

      const doc = await loadTicketDocument({ prisma, publicSlug });
      if (!doc) {
        return reply.code(404).send({ error: "TICKET_NOT_FOUND" });
      }

      const pdfBytes = await renderTicketPdf(doc);
      const internalNumber = doc.ticket.internalNumber;
      reply.header("Content-Type", "application/pdf");
      reply.header(
        "Content-Disposition",
        `inline; filename="ticket-${internalNumber}.pdf"`,
      );
      reply.header("Cache-Control", "private, max-age=3600");
      return reply.send(Buffer.from(pdfBytes));
    },
  );
}
