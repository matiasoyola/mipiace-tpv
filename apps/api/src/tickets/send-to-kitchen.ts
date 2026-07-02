// v1.4-Impresoras-Fase-1 Lote 4 · enviar comanda a cocina/barra/salón.
//
// Antes (v1.4-Bar-Operativa-MVP Lote 2) este endpoint generaba un PDF
// por sección y el TPV los abría en pestañas para imprimir desde el
// navegador. Con Fase 1 de Impresoras (spike 2026-06-02 + POS-80
// confirmando que rasterizar PDF satura el buffer) lo reemplazamos
// por ESC/POS plano sobre TCP a cada impresora WIFI.
//
//   POST /tickets/:ticketId/send-to-kitchen[?fallback=pdf]
//     → por defecto: agrupa líneas por sección, manda comanda
//       ESC/POS por TCP a la impresora WIFI configurada de cada
//       sección. Devuelve `{revision, sentAt, sections:[{section,
//       ok, lineCount, error?}]}`.
//     → `?fallback=pdf`: ruta legacy que aún genera los PDFs en
//       base64. Pensada como red de seguridad mientras se despliegan
//       las impresoras en cuentas piloto. Se removerá en una fase
//       posterior.
//
// El TPV (Lote 3 de Impresoras-Fase-1) llama al endpoint hermano
// `/send-to-kitchen/escpos` que es exactamente lo mismo sin el
// query param fallback — ambos son alias del mismo `dispatchKitchenTicket`.

import type { FastifyInstance } from "fastify";

import { KitchenSection } from "@mipiacetpv/db";
import {
  renderKitchenTicketPdf,
  type KitchenLine,
  type KitchenTicketDocument,
} from "@mipiacetpv/ticket-pdf";

import { getPrisma } from "../context.js";
import { requireCashierSession } from "../shift/cashier-session.js";
import { cashierLabelFrom } from "../users/display.js";
import { dispatchKitchenTicket } from "./kitchen-dispatch.js";

interface ProductWithTags {
  id: string;
  tags: string[];
}

export async function registerSendToKitchenRoute(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    "/tickets/:ticketId/send-to-kitchen",
    {
      preHandler: requireCashierSession,
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
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { ticketId } = request.params as { ticketId: string };
      const { fallback } = request.query as { fallback?: "pdf" };

      if (fallback === "pdf") {
        return handleLegacyPdfFallback(request, reply, ticketId, cashier);
      }

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

// Legacy: genera PDFs por sección sin pasar por impresoras físicas.
// Útil mientras un piloto no tiene las impresoras desplegadas (el
// cajero abre cada PDF en pestaña e imprime con el flujo del navegador).
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
  for (const line of ticket.lines) {
    const section = resolveSection(line.productId, productTagMap, tagToSection);
    const kl: KitchenLine = {
      units: Number(line.units),
      description: line.nameSnapshot,
      notes: extractNotes(line.modifiers),
    };
    const bucket = grouped.get(section);
    if (bucket) bucket.push(kl);
    else grouped.set(section, [kl]);
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

  await prisma.ticket.update({
    where: { id: ticket.id },
    data: { lastSentAt: issuedAt, lastSentRevision: revision },
  });

  request.log.info(
    {
      tenantId: cashier.tid,
      ticketId,
      sections: sections.length,
    },
    "send-to-kitchen LEGACY PDF fallback",
  );

  return reply.code(200).send({
    revision,
    sentAt: issuedAt.toISOString(),
    sections,
  });
}

function resolveSection(
  productId: string | null,
  productTagMap: Map<string, string[]>,
  tagToSection: Map<string, KitchenSection>,
): KitchenSection {
  if (!productId) return "SALON";
  const tags = productTagMap.get(productId) ?? [];
  for (const t of tags) {
    const sec = tagToSection.get(t);
    if (sec) return sec;
  }
  return "SALON";
}

function extractNotes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      out.push(entry);
      continue;
    }
    if (entry && typeof entry === "object") {
      const e = entry as { label?: unknown; groupName?: unknown };
      const label = typeof e.label === "string" ? e.label : null;
      const group = typeof e.groupName === "string" ? e.groupName : null;
      if (label && group) out.push(`${group}: ${label}`);
      else if (label) out.push(label);
    }
  }
  return out;
}
