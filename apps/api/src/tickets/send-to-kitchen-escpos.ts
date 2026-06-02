// v1.4-Impresoras-Fase-1 Lote 2 · enviar comandas vía ESC/POS WIFI.
//
//   POST /tickets/:ticketId/send-to-kitchen/escpos
//     → carga el ticket DRAFT con sus líneas y agrupa por sección
//       (BARRA/COCINA/SALON) usando el mapa tag_sections del tenant.
//     → por cada sección con líneas, busca el PrinterConfig WIFI
//       activo con esa sección en el register.
//     → genera la comanda ESC/POS (`buildKitchenComanda`) y la manda
//       por TCP a ip:port. Si falla, se marca el error en el config
//       pero seguimos con el resto de secciones (mejor que tirar todo).
//     → marca el ticket con lastSentAt + lastSentRevision++.
//     → emite WS `ticket.sent_to_kitchen` con el desglose.
//     → devuelve `{ revision, sentAt, sections: [{section, ok, lines, error?}] }`.
//
// Coexiste con el endpoint antiguo `send-to-kitchen` (PDF) durante
// Lote 2. En Lote 4 ese endpoint se reescribe para llamar a esta
// misma lógica internamente y devolver el mismo shape de respuesta.

import { KitchenSection } from "@mipiacetpv/db";
import {
  buildKitchenComanda,
  sendOverTcp,
  type KitchenLineEscpos,
} from "@mipiacetpv/escpos-builder";
import type { FastifyInstance } from "fastify";

import { getPrisma } from "../context.js";
import { getStoreEventBus } from "../realtime/store-event-bus.js";
import { requireCashierSession } from "../shift/cashier-session.js";

interface ProductWithTags {
  id: string;
  tags: string[];
}

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
      const [products, tagMappings, allPrinters] = await Promise.all([
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
        prisma.printerConfig.findMany({
          where: {
            registerId: cashier.rid,
            active: true,
            mode: "WIFI",
            section: { not: null },
          },
          select: {
            id: true,
            section: true,
            ipAddress: true,
            port: true,
            timeoutMs: true,
          },
        }),
      ]);

      const productTagMap = new Map<string, string[]>(
        products.map((p) => [p.id, p.tags]),
      );
      const tagToSection = new Map<string, KitchenSection>(
        tagMappings.map((m) => [m.slug, m.section]),
      );

      const grouped = new Map<KitchenSection, KitchenLineEscpos[]>();
      for (const line of ticket.lines) {
        const section = resolveSection(line.productId, productTagMap, tagToSection);
        const kl: KitchenLineEscpos = {
          units: Number(line.units),
          description: line.nameSnapshot,
          notes: extractNotes(line.modifiers),
        };
        const bucket = grouped.get(section);
        if (bucket) bucket.push(kl);
        else grouped.set(section, [kl]);
      }

      // Si falta una impresora para alguna sección con líneas, fallamos
      // con 409 *antes* de mandar nada: el camarero ve un error claro
      // ("Falta configurar impresora para BARRA"), evitamos imprimir
      // mitades raras.
      const printerBySection = new Map<KitchenSection, (typeof allPrinters)[number]>();
      for (const p of allPrinters) {
        if (p.section) printerBySection.set(p.section, p);
      }
      for (const sec of grouped.keys()) {
        if (!printerBySection.has(sec)) {
          return reply.code(409).send({
            error: "PRINTER_NOT_CONFIGURED_FOR_SECTION",
            message: `Falta configurar impresora WIFI para la sección ${sec} en este register.`,
            missingSection: sec,
          });
        }
      }

      const revision = ticket.lastSentRevision + 1;
      const issuedAt = new Date();

      const cashierUser = await prisma.user.findUniqueOrThrow({
        where: { id: cashier.sub },
        select: { email: true },
      });
      const cashierLabel =
        cashierUser.email.split("@")[0] ?? cashierUser.email;

      const sections: Array<{
        section: KitchenSection;
        ok: boolean;
        lineCount: number;
        error?: string;
      }> = [];

      // Orden estable: BARRA → COCINA → SALON.
      for (const sec of ["BARRA", "COCINA", "SALON"] as KitchenSection[]) {
        const lines = grouped.get(sec);
        if (!lines || lines.length === 0) continue;
        const printer = printerBySection.get(sec)!;
        const bytes = buildKitchenComanda({
          section: sec,
          tableName: ticket.table?.name ?? null,
          revision,
          issuedAt,
          cashierLabel,
          diners: ticket.diners,
          ticketNotes: ticket.notes,
          lines,
        });
        try {
          await sendOverTcp({
            host: printer.ipAddress!,
            port: printer.port ?? 9100,
            timeoutMs: printer.timeoutMs,
            payload: bytes,
          });
          await prisma.printerConfig.update({
            where: { id: printer.id },
            data: {
              lastPrintOkAt: new Date(),
              lastErrorAt: null,
              lastErrorMsg: null,
            },
          });
          sections.push({ section: sec, ok: true, lineCount: lines.length });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Error desconocido";
          await prisma.printerConfig.update({
            where: { id: printer.id },
            data: {
              lastErrorAt: new Date(),
              lastErrorMsg: message.slice(0, 500),
            },
          });
          sections.push({
            section: sec,
            ok: false,
            lineCount: lines.length,
            error: message,
          });
        }
      }

      // Sólo actualizamos lastSentAt si al menos UNA sección imprimió
      // OK. Si todas fallaron, dejamos el ticket como antes para que
      // el camarero pueda reintentar (botón "Reenviar comanda").
      const anyOk = sections.some((s) => s.ok);
      if (anyOk) {
        await prisma.ticket.update({
          where: { id: ticket.id },
          data: { lastSentAt: issuedAt, lastSentRevision: revision },
        });
      }

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

      return reply.code(anyOk ? 200 : 502).send({
        revision: anyOk ? revision : ticket.lastSentRevision,
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
