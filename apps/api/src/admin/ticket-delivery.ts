// Endpoints admin de "Comunicación de ticket" por tienda
// (B-Print fase 1 · Frente 6).
//
//   GET   /admin/stores/:storeId/ticket-delivery   → requireOwnerOrManager
//   PATCH /admin/stores/:storeId/ticket-delivery   → requireOwner
//   GET   /admin/stores/:storeId/email-failures    → requireOwnerOrManager
//
// Sole (23-09-2026) · el último es el resumen para el propietario: los
// tickets de esta tienda cuyo email no salió. Vive AQUÍ, pegado a la
// configuración que lo gobierna, y no en `/admin/tickets-errors`, que
// se llama "Sincronización con Holded", filtra SYNC_FAILED y está
// marcada `superAdminOnly` — Sole no la vería nunca, y el email de este
// bloque no depende de Holded. El sitio principal donde esto se ve es
// el histórico del TPV, que es donde la peluquería trabaja; esto es el
// resumen de quien manda.
//
// La forma del JSON es libre en BD; aquí lo validamos contra un
// esquema cerrado. Si la tienda nunca ha sido tocada (jsonb null),
// devolvemos los defaults — el TPV no necesita saber si la tienda
// "está configurada" o "tiene defaults".

import type { FastifyInstance } from "fastify";

import { requireOwner, requireOwnerOrManager } from "../auth/middleware.js";
import { getPrisma } from "../context.js";
import { ensureCajaEnabled } from "../lib/caja-gate.js";
import {
  deriveTicketEmailState,
  EMAIL_JOB_SELECT,
} from "../tickets/email-status.js";

export interface TicketDeliverySettings {
  emailAutoIfCustomerHasEmail: boolean;
  showQrButton: boolean;
  showDownloadButton: boolean;
  showViewButton: boolean;
  emailSubject: string;
  emailBody: string;
  qrCaption: string;
}

export const DEFAULT_TICKET_DELIVERY: TicketDeliverySettings = {
  emailAutoIfCustomerHasEmail: true,
  showQrButton: true,
  showDownloadButton: true,
  showViewButton: true,
  emailSubject: "Tu ticket de {tienda} · {numero}",
  emailBody:
    "Hola,\n\nAdjuntamos tu ticket en PDF. ¡Gracias por tu visita!\n\n— {tienda}",
  qrCaption: "Escanea para descargar tu ticket",
};

function normaliseSettings(raw: unknown): TicketDeliverySettings {
  const r = (raw ?? {}) as Partial<TicketDeliverySettings>;
  return {
    emailAutoIfCustomerHasEmail:
      typeof r.emailAutoIfCustomerHasEmail === "boolean"
        ? r.emailAutoIfCustomerHasEmail
        : DEFAULT_TICKET_DELIVERY.emailAutoIfCustomerHasEmail,
    showQrButton:
      typeof r.showQrButton === "boolean"
        ? r.showQrButton
        : DEFAULT_TICKET_DELIVERY.showQrButton,
    showDownloadButton:
      typeof r.showDownloadButton === "boolean"
        ? r.showDownloadButton
        : DEFAULT_TICKET_DELIVERY.showDownloadButton,
    showViewButton:
      typeof r.showViewButton === "boolean"
        ? r.showViewButton
        : DEFAULT_TICKET_DELIVERY.showViewButton,
    emailSubject:
      typeof r.emailSubject === "string" && r.emailSubject.trim().length > 0
        ? r.emailSubject
        : DEFAULT_TICKET_DELIVERY.emailSubject,
    emailBody:
      typeof r.emailBody === "string" && r.emailBody.trim().length > 0
        ? r.emailBody
        : DEFAULT_TICKET_DELIVERY.emailBody,
    qrCaption:
      typeof r.qrCaption === "string" && r.qrCaption.trim().length > 0
        ? r.qrCaption
        : DEFAULT_TICKET_DELIVERY.qrCaption,
  };
}

export async function registerAdminTicketDeliveryRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/admin/stores/:storeId/ticket-delivery",
    {
      preHandler: [requireOwnerOrManager, ensureCajaEnabled],
      schema: {
        params: {
          type: "object",
          required: ["storeId"],
          properties: { storeId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { storeId } = request.params as { storeId: string };
      const prisma = getPrisma();
      const store = await prisma.store.findFirst({
        where: { id: storeId, tenantId: auth.tenantId, deletedAt: null },
        select: { ticketDelivery: true },
      });
      if (!store) {
        return reply.code(404).send({
          error: "STORE_NOT_FOUND",
          message: "Tienda no encontrada",
        });
      }
      return reply.code(200).send({
        ticketDelivery: normaliseSettings(store.ticketDelivery),
      });
    },
  );

  app.patch(
    "/admin/stores/:storeId/ticket-delivery",
    {
      preHandler: [requireOwner, ensureCajaEnabled],
      schema: {
        params: {
          type: "object",
          required: ["storeId"],
          properties: { storeId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            emailAutoIfCustomerHasEmail: { type: "boolean" },
            showQrButton: { type: "boolean" },
            showDownloadButton: { type: "boolean" },
            showViewButton: { type: "boolean" },
            emailSubject: { type: "string", minLength: 1, maxLength: 300 },
            emailBody: { type: "string", minLength: 1, maxLength: 4000 },
            qrCaption: { type: "string", minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { storeId } = request.params as { storeId: string };
      const body = request.body as Partial<TicketDeliverySettings>;
      const prisma = getPrisma();

      const store = await prisma.store.findFirst({
        where: { id: storeId, tenantId: auth.tenantId, deletedAt: null },
        select: { ticketDelivery: true },
      });
      if (!store) {
        return reply.code(404).send({
          error: "STORE_NOT_FOUND",
          message: "Tienda no encontrada",
        });
      }

      const current = normaliseSettings(store.ticketDelivery);
      const next: TicketDeliverySettings = {
        ...current,
        ...body,
      };
      const validated = normaliseSettings(next);
      await prisma.store.update({
        where: { id: storeId },
        data: { ticketDelivery: validated as unknown as object },
      });
      return reply.code(200).send({ ticketDelivery: validated });
    },
  );

  // ── GET /admin/stores/:storeId/email-failures ───────────────────────
  // Los tickets de esta tienda cuyo envío por email no salió. Se mira
  // `email_failed_at` (la marca del ticket) y no el estado del job
  // porque es la que ya existía antes de este bloque: los tickets del
  // 17-09 la tienen puesta con el job todavía en PENDING.
  app.get(
    "/admin/stores/:storeId/email-failures",
    {
      preHandler: [requireOwnerOrManager, ensureCajaEnabled],
      schema: {
        params: {
          type: "object",
          required: ["storeId"],
          properties: { storeId: { type: "string", format: "uuid" } },
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { storeId } = request.params as { storeId: string };
      const { limit } = request.query as { limit?: number };
      const prisma = getPrisma();
      const store = await prisma.store.findFirst({
        where: { id: storeId, tenantId: auth.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!store) {
        return reply.code(404).send({
          error: "STORE_NOT_FOUND",
          message: "Tienda no encontrada",
        });
      }

      const tickets = await prisma.ticket.findMany({
        where: {
          tenantId: auth.tenantId,
          emailFailedAt: { not: null },
          register: { storeId },
        },
        select: {
          id: true,
          internalNumber: true,
          total: true,
          createdAt: true,
          emailIntent: true,
          emailFailedAt: true,
          register: { select: { name: true } },
          emailJobs: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: EMAIL_JOB_SELECT,
          },
        },
        orderBy: { emailFailedAt: "desc" },
        take: limit ?? 20,
      });

      return reply.code(200).send({
        items: tickets
          .map((t) => ({
            id: t.id,
            internalNumber: t.internalNumber,
            total: Number(t.total.toString()),
            createdAt: t.createdAt.toISOString(),
            registerName: t.register.name,
            email: deriveTicketEmailState({
              jobs: t.emailJobs,
              emailIntent: t.emailIntent,
              emailFailedAt: t.emailFailedAt,
            }),
          }))
          // Un ticket que ya se reenvió bien lleva la marca vieja puesta
          // (no se limpia: es la huella de lo que pasó) pero su último
          // job está DONE. Enseñarlo aquí sería pedirle al propietario
          // que persiga algo que ya está resuelto.
          .filter((t) => t.email.status === "FAILED"),
      });
    },
  );
}
