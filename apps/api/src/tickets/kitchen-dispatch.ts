// v1.4-Impresoras-Fase-1 Lote 4 · lógica compartida del envío de
// comandas (kitchen ticket).
//
// Vive aquí para que tanto `send-to-kitchen.ts` (URL legacy) como
// `send-to-kitchen-escpos.ts` (URL nueva introducida en Lote 2)
// hagan lo mismo: agrupar por sección, validar printers, mandar
// ESC/POS por TCP. Sólo el envoltorio HTTP cambia entre ambos.

import { KitchenSection } from "@mipiacetpv/db";
import {
  buildKitchenComanda,
  sendOverTcp,
  type KitchenLineEscpos,
} from "@mipiacetpv/escpos-builder";

import { getPrisma } from "../context.js";
import { getStoreEventBus } from "../realtime/store-event-bus.js";

export interface DispatchCtx {
  tenantId: string;
  registerId: string;
  cashierId: string;
}

export interface DispatchResult {
  status: "ok" | "partial-fail" | "missing-printer";
  http: number;
  body: {
    revision: number;
    sentAt: string;
    sections: Array<{
      section: KitchenSection;
      ok: boolean;
      lineCount: number;
      error?: string;
    }>;
    error?: string;
    message?: string;
    missingSection?: KitchenSection;
  };
}

interface ProductWithTags {
  id: string;
  tags: string[];
}

export async function dispatchKitchenTicket(
  ticketId: string,
  ctx: DispatchCtx,
): Promise<DispatchResult | { kind: "not-found" } | { kind: "register-mismatch" } | { kind: "empty" }> {
  const prisma = getPrisma();
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, tenantId: ctx.tenantId, status: "DRAFT" },
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
  if (!ticket) return { kind: "not-found" };
  if (ticket.registerId !== ctx.registerId) return { kind: "register-mismatch" };
  if (ticket.lines.length === 0) return { kind: "empty" };

  const productIds = ticket.lines
    .map((l) => l.productId)
    .filter((x): x is string => x != null);
  const [products, tagMappings, allPrinters] = await Promise.all([
    productIds.length > 0
      ? prisma.product.findMany({
          where: { id: { in: productIds }, tenantId: ctx.tenantId },
          select: { id: true, tags: true },
        })
      : Promise.resolve([] as ProductWithTags[]),
    prisma.tagSection.findMany({
      where: { tenantId: ctx.tenantId },
      select: { slug: true, section: true },
    }),
    prisma.printerConfig.findMany({
      where: {
        registerId: ctx.registerId,
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

  const printerBySection = new Map<KitchenSection, (typeof allPrinters)[number]>();
  for (const p of allPrinters) {
    if (p.section) printerBySection.set(p.section, p);
  }
  for (const sec of grouped.keys()) {
    if (!printerBySection.has(sec)) {
      return {
        status: "missing-printer",
        http: 409,
        body: {
          revision: ticket.lastSentRevision,
          sentAt: new Date().toISOString(),
          sections: [],
          error: "PRINTER_NOT_CONFIGURED_FOR_SECTION",
          message: `Falta configurar impresora WIFI para la sección ${sec} en este register.`,
          missingSection: sec,
        },
      };
    }
  }

  const revision = ticket.lastSentRevision + 1;
  const issuedAt = new Date();
  const cashierUser = await prisma.user.findUniqueOrThrow({
    where: { id: ctx.cashierId },
    select: { email: true },
  });
  const cashierLabel =
    cashierUser.email.split("@")[0] ?? cashierUser.email;

  const sections: DispatchResult["body"]["sections"] = [];
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

  return {
    status: anyOk ? "ok" : "partial-fail",
    http: anyOk ? 200 : 502,
    body: {
      revision: anyOk ? revision : ticket.lastSentRevision,
      sentAt: issuedAt.toISOString(),
      sections,
    },
  };
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
