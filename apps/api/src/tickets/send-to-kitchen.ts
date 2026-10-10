// v1.4-Impresoras-Fase-1 Lote 4 · enviar comanda a cocina/barra/salón.
// kds-1-cocina · el motor pasa a ser el envío POR DIFERENCIAS.
//
//   POST /tickets/:ticketId/send-to-kitchen[?fallback=pdf]
//
// Antes (v1.4-Bar-Operativa-MVP Lote 2) este endpoint generaba un PDF por
// sección y el TPV los abría en pestañas. Con Fase 1 de Impresoras se
// reemplazó por ESC/POS plano sobre TCP. Con kds-1 lo que cambia no es el
// transporte sino QUÉ se manda: la diferencia y no la mesa entera, con un
// id de envío idempotente y con tarjetas para las secciones que tienen
// pantalla. Todo eso vive en `kitchen/envio.ts`.
//
// El TPV llama al endpoint hermano `/send-to-kitchen/escpos`, que es
// exactamente lo mismo sin el query param — los dos son alias del mismo
// `enviarComanda`.

import type { FastifyInstance } from "fastify";

import { KitchenSection, Prisma } from "@mipiacetpv/db";
import {
  renderKitchenTicketPdf,
  type KitchenLine,
  type KitchenTicketDocument,
} from "@mipiacetpv/ticket-pdf";

import { getPrisma } from "../context.js";
import { requireCashierSession } from "../shift/cashier-session.js";
import { cashierLabelFrom } from "../users/display.js";
import { dispatchKitchenTicket, notasDeModificadores } from "./kitchen-dispatch.js";
import { ensureCajaEnabled } from "../lib/caja-gate.js";
import { resolverSeccion } from "../kitchen/destinos.js";

interface ProductWithTags {
  id: string;
  tags: string[];
}

/** El esquema del cuerpo, compartido por las dos URL hermanas. */
export const ENVIO_BODY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    // kds-1-cocina · UUID v4 generado EN EL TERMINAL antes de mandar. Es
    // la llave de idempotencia: un reintento de red con el mismo id
    // devuelve el mismo resultado sin duplicar la comanda ni reimprimir.
    // Opcional porque un TPV viejo no lo manda, y entonces el servidor
    // genera uno que no protege de nada pero deja la fila completa.
    clientSendId: { type: "string", format: "uuid" },
    // El camarero tocó «Urgente» junto a «Enviar» (decisión 3).
    urgent: { type: "boolean" },
    // kds-2-wifi · CUÁNDO SE PULSÓ «ENVIAR», sellado en el terminal.
    //
    // Hasta aquí, `KitchenOrder.sentAt` era «cuándo se enteró el
    // servidor». Con el camino directo eso deja de ser lo mismo: sin
    // internet la comanda llega a la cocina por la wifi y el servidor no
    // la ve hasta que el outbox puede subirla, que pueden ser horas. Y
    // entonces pasaban dos cosas malas:
    //
    //   · la cocina marcaba «Lista» a las 13:20 y el servidor creaba la
    //     tarjeta a las 14:00 → `ready_at < sent_at` → el CHECK
    //     `kitchen_orders_cronologia` la rechazaba y **el «Lista» del
    //     cocinero se perdía**;
    //   · el semáforo contaba desde las 14:00, así que una mesa que
    //     llevaba una hora esperando entraba en verde a 0 min.
    //
    // Mismo sello y mismo motivo que `occurredAt` del outbox en v1.11.
    // Acotado en el servidor: ver `acotarSentAt` en `kitchen/envio.ts`.
    sentAt: { type: "string", format: "date-time" },
  },
} as const;

export async function registerSendToKitchenRoute(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    "/tickets/:ticketId/send-to-kitchen",
    {
      preHandler: [requireCashierSession, ensureCajaEnabled],
      schema: {
        params: {
          type: "object",
          required: ["ticketId"],
          properties: { ticketId: { type: "string", format: "uuid" } },
        },
        querystring: {
          type: "object",
          properties: {
            fallback: { type: "string", enum: ["pdf"] },
          },
        },
        body: ENVIO_BODY_SCHEMA,
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { ticketId } = request.params as { ticketId: string };
      const { fallback } = request.query as { fallback?: "pdf" };
      const body = (request.body ?? {}) as {
        clientSendId?: string;
        urgent?: boolean;
        sentAt?: string;
      };

      if (fallback === "pdf") {
        return handleLegacyPdfFallback(request, reply, ticketId, cashier);
      }

      return responderEnvio(reply, ticketId, {
        tenantId: cashier.tid,
        registerId: cashier.rid,
        cashierId: cashier.sub,
      }, body);
    },
  );
}

/**
 * La traducción de `Envio` a HTTP, compartida por las dos URL.
 *
 * El 409 de «falta impresora» ya no existe: una sección sin destino se
 * marca como enviada y el envío sigue (decisión 2). El 409 que SÍ hay es
 * nuevo y es otra cosa — dos peticiones del mismo `clientSendId` en vuelo
 * a la vez.
 */
export async function responderEnvio(
  reply: import("fastify").FastifyReply,
  ticketId: string,
  ctx: { tenantId: string; registerId: string; cashierId: string },
  body: { clientSendId?: string; urgent?: boolean; sentAt?: string },
): Promise<unknown> {
  const result = await dispatchKitchenTicket(ticketId, ctx, {
    clientSendId: body.clientSendId,
    urgent: body.urgent,
    // kds-2-wifi · el sello del terminal. Se pasa TAL CUAL; quien decide
    // si creérselo es `acotarSentAt`, en el servidor.
    sentAt: body.sentAt,
  });
  if (result.kind !== "ok") {
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
      case "in-flight":
        return reply.code(409).send({
          error: "DISPATCH_IN_FLIGHT",
          message: "Ese envío ya está en curso. Reintenta en un momento.",
        });
    }
  }
  return reply.code(result.http).send(result.body);
}

// Legacy: genera PDFs por sección sin pasar por impresoras físicas. Útil
// mientras un piloto no tiene las impresoras desplegadas (el cajero abre
// cada PDF en pestaña e imprime con el flujo del navegador).
//
// kds-1-cocina · también va POR DIFERENCIAS y también marca `sentUnits`.
// No se dejó como estaba a propósito: si este camino bajara
// `lastSentRevision` sin tocar `sentUnits`, el siguiente envío por ESC/POS
// volvería a mandar la mesa entera y la invariante central del bloque
// tendría un agujero del tamaño de un query param.
//
// Lo que NO hace es crear tarjetas de pantalla: es un fallback de papel
// para un piloto sin impresoras, y un piloto sin impresoras no tiene
// pantalla de cocina. Si la tuviera, usaría la URL normal.
async function handleLegacyPdfFallback(
  request: import("fastify").FastifyRequest,
  reply: import("fastify").FastifyReply,
  ticketId: string,
  cashier: { tid: string; rid: string; sub: string },
): Promise<unknown> {
  const prisma = getPrisma();
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, tenantId: cashier.tid, status: "DRAFT" },
    select: {
      id: true,
      tableId: true,
      registerId: true,
      diners: true,
      notes: true,
      lastSentRevision: true,
      table: { select: { id: true, name: true } },
      register: { select: { storeId: true } },
      lines: {
        select: {
          id: true,
          productId: true,
          nameSnapshot: true,
          units: true,
          sentUnits: true,
          course: true,
          seat: true,
          modifiers: true,
        },
      },
    },
  });
  if (!ticket) {
    return reply.code(404).send({
      error: "TICKET_NOT_FOUND_OR_NOT_DRAFT",
      message: "Sólo se envían comandas de un ticket DRAFT.",
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
      error: "EMPTY_TICKET",
      message: "El ticket no tiene líneas. Añade alguna antes de enviar.",
    });
  }

  const productIds = ticket.lines
    .map((l) => l.productId)
    .filter((x): x is string => x != null);
  const [products, tagMappings] = await Promise.all([
    productIds.length > 0
      ? prisma.product.findMany({
          where: { id: { in: productIds }, tenantId: cashier.tid },
          select: { id: true, tags: true },
        })
      : Promise.resolve([] as ProductWithTags[]),
    prisma.tagSection.findMany({
      where: { tenantId: cashier.tid },
      select: { slug: true, section: true },
    }),
  ]);
  const productTagMap = new Map<string, string[]>(
    products.map((p) => [p.id, p.tags]),
  );
  const tagToSection = new Map<string, KitchenSection>(
    tagMappings.map((m) => [m.slug, m.section]),
  );

  const grouped = new Map<KitchenSection, KitchenLine[]>();
  const marcadas = new Map<string, number>();
  for (const line of ticket.lines) {
    const pendiente =
      Math.round((Number(line.units) - Number(line.sentUnits)) * 1000) / 1000;
    if (pendiente <= 0) continue;
    const section = resolverSeccion(line.productId, productTagMap, tagToSection);
    const kl: KitchenLine = {
      units: pendiente,
      description: line.nameSnapshot,
      notes: notasDeModificadores(line.modifiers),
    };
    const bucket = grouped.get(section);
    if (bucket) bucket.push(kl);
    else grouped.set(section, [kl]);
    marcadas.set(line.id, Number(line.units));
  }

  if (grouped.size === 0) {
    return reply.code(200).send({
      revision: ticket.lastSentRevision,
      sentAt: new Date().toISOString(),
      nothingNew: true,
      sections: [],
    });
  }

  const revision = ticket.lastSentRevision + 1;
  const issuedAt = new Date();
  const cashierUser = await prisma.user.findUniqueOrThrow({
    where: { id: cashier.sub },
    select: { email: true, alias: true },
  });
  const cashierLabel = cashierLabelFrom(cashierUser);

  const sections: Array<{
    section: KitchenSection;
    lineCount: number;
    pdfBase64: string;
  }> = [];
  for (const sec of ["BARRA", "COCINA", "SALON"] as KitchenSection[]) {
    const lines = grouped.get(sec);
    if (!lines || lines.length === 0) continue;
    const doc: KitchenTicketDocument = {
      section: sec,
      tableName: ticket.table?.name ?? null,
      revision,
      issuedAt,
      cashierLabel,
      diners: ticket.diners,
      ticketNotes: ticket.notes,
      lines,
    };
    const bytes = await renderKitchenTicketPdf(doc);
    sections.push({
      section: sec,
      lineCount: lines.length,
      pdfBase64: Buffer.from(bytes).toString("base64"),
    });
  }

  await prisma.$transaction(async (tx) => {
    for (const [lineId, total] of marcadas) {
      await tx.ticketLine.update({
        where: { id: lineId },
        data: { sentUnits: new Prisma.Decimal(total) },
      });
    }
    await tx.ticketCourse.createMany({
      data: [
        { ticketId: ticket.id, course: 1, firedAt: issuedAt, firedByUserId: cashier.sub },
      ],
      skipDuplicates: true,
    });
    await tx.ticket.update({
      where: { id: ticket.id },
      data: { lastSentAt: issuedAt, lastSentRevision: revision },
    });
  });

  request.log.info(
    { tenantId: cashier.tid, ticketId, sections: sections.length },
    "send-to-kitchen LEGACY PDF fallback",
  );

  return reply.code(200).send({
    revision,
    sentAt: issuedAt.toISOString(),
    nothingNew: false,
    sections,
  });
}
