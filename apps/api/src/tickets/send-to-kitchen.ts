// v1.4-Bar-Operativa-MVP Lote 2 · enviar comanda a cocina/barra/salón.
//
//   POST /tickets/:ticketId/send-to-kitchen
//     → carga el ticket DRAFT con sus líneas, productos y tags.
//     → cruza cada línea con el mapa tag_sections del tenant.
//     → genera un PDF por sección con líneas (KitchenTicketDocument).
//     → marca el ticket con lastSentAt + lastSentRevision++.
//     → emite WS `ticket.sent_to_kitchen` con el desglose por sección.
//     → devuelve `{ revision, sections: [{ section, lineCount, pdfBase64 }] }`.
//
// El TPV abre cada PDF en un iframe / nueva pestaña para imprimirlo
// con la impresora del register. Cuando llegue el agente local
// (v1.5), reemplazaremos la apertura en pestaña por un POST al
// agente que reparte por impresora física de cada sección.

import type { FastifyInstance } from "fastify";

import { KitchenSection } from "@mipiacetpv/db";
import {
  renderKitchenTicketPdf,
  type KitchenLine,
  type KitchenTicketDocument,
} from "@mipiacetpv/ticket-pdf";

import { getPrisma } from "../context.js";
import { getStoreEventBus } from "../realtime/store-event-bus.js";
import { requireCashierSession } from "../shift/cashier-session.js";

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
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { ticketId } = request.params as { ticketId: string };
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

      // Cargamos en paralelo: tags de cada producto y mapa
      // tag → section del tenant. Productos sin productId (líneas
      // libres TPV-OTROS) caen siempre a SALON.
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

      // Agrupamos líneas por sección. Conservamos el orden original
      // dentro de cada sección (el camarero las añadió en ese orden,
      // mejor para que la cocina sirva en secuencia).
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
        select: { email: true },
      });
      const cashierLabel = cashierUser.email.split("@")[0] ?? cashierUser.email;

      const sections: Array<{
        section: KitchenSection;
        lineCount: number;
        pdfBase64: string;
      }> = [];

      // Orden estable de impresión: BARRA → COCINA → SALON. Es el
      // orden en que el camarero normalmente reparte los papeles.
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

      if (ticket.tableId) {
        getStoreEventBus().broadcast(ticket.register.storeId, {
          type: "ticket.sent_to_kitchen" as const,
          ticketId: ticket.id,
          tableId: ticket.tableId,
          revision,
          sections: sections.map((s) => ({
            section: s.section,
            lineCount: s.lineCount,
          })),
          byEmail: cashierUser.email,
          at: issuedAt.toISOString(),
        } as never);
      }

      return reply.code(200).send({
        revision,
        sentAt: issuedAt.toISOString(),
        sections,
      });
    },
  );
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

// Extrae las "notas" imprimibles del snapshot de modifiers de una
// línea. Soporta los dos shapes históricos del campo:
//   - Legacy: string[] tipeado por el cajero ("Sin azúcar").
//   - Estructurado (B-Bar-Modifiers): array de
//     `{ groupName, label, priceDeltaCents }`.
// En ambos casos imprimimos el texto plano para que la cocina lo lea.
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
