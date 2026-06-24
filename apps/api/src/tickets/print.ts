// v1.4-Impresoras-Fase-1 Lote 2 · endpoint de impresión ESC/POS.
//
//   POST /tickets/:ticketId/print/escpos?target=usb|wifi[&printerConfigId=...]
//
//   - target=usb  → devuelve el binary ESC/POS en el body
//                   (Content-Type: application/octet-stream). El TPV
//                   lo mete en `device.transferOut()` con WebUSB.
//   - target=wifi → carga el PrinterConfig por `printerConfigId` (o,
//                   si no se pasa, el primero ACTIVO sin sección del
//                   register), abre socket TCP a ip:port y manda el
//                   binary. Devuelve `{ok, printedAt}` o `{ok:false, error}`.
//
// Auth: requireCashierSession. Lo dispara el TPV tras cobrar (o por
// reimpresión manual).

import { loadEnv } from "../env.js";
import {
  buildTicketReceipt,
  sendOverTcp,
  type TicketLineEscpos,
  type TicketPaymentEscpos,
  type TicketReceiptInput,
} from "@mipiacetpv/escpos-builder";
import type { FastifyInstance } from "fastify";

import { getPrisma } from "../context.js";
import { requireCashierSession } from "../shift/cashier-session.js";

interface PrintQuery {
  target: "usb" | "wifi";
  printerConfigId?: string;
}

export async function registerTicketPrintRoute(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    "/tickets/:ticketId/print/escpos",
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
          required: ["target"],
          properties: {
            target: { type: "string", enum: ["usb", "wifi"] },
            printerConfigId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { ticketId } = request.params as { ticketId: string };
      const { target, printerConfigId } = request.query as PrintQuery;
      const prisma = getPrisma();
      const env = loadEnv();

      const ticket = await loadTicketForPrint(prisma, ticketId, cashier.tid);
      if (!ticket) {
        return reply.code(404).send({
          error: "TICKET_NOT_FOUND",
          message: "Ticket no encontrado.",
        });
      }
      if (ticket.registerId !== cashier.rid) {
        return reply.code(403).send({
          error: "REGISTER_MISMATCH",
          message: "El ticket no pertenece a tu caja.",
        });
      }

      const bytes = buildTicketReceipt(
        ticketToEscposInput(ticket, env.PUBLIC_TICKET_URL),
      );

      if (target === "usb") {
        request.log.info(
          {
            tenantId: cashier.tid,
            registerId: cashier.rid,
            ticketId,
            target: "usb",
            bytes: bytes.length,
          },
          "tickets.print.escpos USB ok",
        );
        return reply
          .header("Content-Type", "application/octet-stream")
          .header("Content-Length", String(bytes.length))
          .header("Cache-Control", "no-store")
          .send(Buffer.from(bytes));
      }

      // WIFI: encontrar PrinterConfig y mandar TCP.
      const cfg = await resolveWifiPrinter(
        prisma,
        cashier.rid,
        printerConfigId ?? null,
        null, // sin sección — es ticket de cobro
      );
      if (!cfg) {
        return reply.code(409).send({
          error: "PRINTER_NOT_CONFIGURED",
          message:
            "Falta configurar una impresora WIFI activa para el ticket de cobro en este register (admin → Impresoras).",
        });
      }

      try {
        await sendOverTcp({
          host: cfg.ipAddress!,
          port: cfg.port ?? 9100,
          timeoutMs: cfg.timeoutMs,
          payload: bytes,
        });
        await prisma.printerConfig.update({
          where: { id: cfg.id },
          data: {
            lastPrintOkAt: new Date(),
            lastErrorAt: null,
            lastErrorMsg: null,
          },
        });
        request.log.info(
          {
            tenantId: cashier.tid,
            registerId: cashier.rid,
            printerConfigId: cfg.id,
            ticketId,
            target: "wifi",
            ok: true,
          },
          "tickets.print.escpos WIFI ok",
        );
        return reply
          .code(200)
          .send({ ok: true, printedAt: new Date().toISOString() });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Error desconocido";
        await prisma.printerConfig.update({
          where: { id: cfg.id },
          data: {
            lastErrorAt: new Date(),
            lastErrorMsg: message.slice(0, 500),
          },
        });
        request.log.warn(
          {
            tenantId: cashier.tid,
            printerConfigId: cfg.id,
            ticketId,
            target: "wifi",
            ok: false,
            error: message,
          },
          "tickets.print.escpos WIFI fail",
        );
        return reply.code(502).send({
          ok: false,
          error: "PRINT_FAILED",
          message,
        });
      }
    },
  );
}

interface TicketForPrint {
  id: string;
  registerId: string;
  internalNumber: string;
  publicSlug: string;
  total: { toString(): string };
  cashAmount: { toString(): string } | null;
  notes: string | null;
  paidAt: Date | null;
  createdAt: Date;
  table: { name: string } | null;
  user: { email: string };
  register: {
    name: string;
    store: {
      name: string;
      fiscalAddress: unknown;
    };
  };
  tenant: {
    name: string;
    receiptFooter: string | null;
    fiscalProfile: unknown;
  };
  lines: Array<{
    nameSnapshot: string;
    units: { toString(): string };
    unitPrice: { toString(): string };
    unitPriceOverride: { toString(): string } | null;
    total: { toString(): string };
  }>;
  payments: Array<{
    method: string;
    amount: { toString(): string };
  }>;
}

async function loadTicketForPrint(
  prisma: ReturnType<typeof getPrisma>,
  ticketId: string,
  tenantId: string,
): Promise<TicketForPrint | null> {
  return prisma.ticket.findFirst({
    where: { id: ticketId, tenantId },
    select: {
      id: true,
      registerId: true,
      internalNumber: true,
      publicSlug: true,
      total: true,
      cashAmount: true,
      notes: true,
      paidAt: true,
      createdAt: true,
      table: { select: { name: true } },
      user: { select: { email: true } },
      register: {
        select: {
          name: true,
          store: { select: { name: true, fiscalAddress: true } },
        },
      },
      tenant: {
        select: {
          name: true,
          receiptFooter: true,
          fiscalProfile: true,
        },
      },
      lines: {
        orderBy: { id: "asc" },
        select: {
          nameSnapshot: true,
          units: true,
          unitPrice: true,
          unitPriceOverride: true,
          total: true,
        },
      },
      payments: {
        select: { method: true, amount: true },
      },
    },
  });
}

// Convierte el ticket cargado en input para el builder ESC/POS. Vive
// en el endpoint (no en el package) porque depende del shape Prisma y
// de la lógica de "dónde sacar la dirección" — el package es agnóstico.
export function ticketToEscposInput(
  ticket: TicketForPrint,
  publicTicketUrlBase: string,
): TicketReceiptInput {
  const lines: TicketLineEscpos[] = ticket.lines.map((l) => {
    const baseUnit = Number(l.unitPrice.toString());
    const override = l.unitPriceOverride != null
      ? Number(l.unitPriceOverride.toString())
      : null;
    return {
      description: l.nameSnapshot,
      units: Number(l.units.toString()),
      unitPrice: override ?? baseUnit,
      lineTotal: Number(l.total.toString()),
    };
  });

  // Pagos: cash con cambio si hay cashAmount > amount.
  const payments: TicketPaymentEscpos[] = ticket.payments.map((p) => {
    const amount = Number(p.amount.toString());
    const base: TicketPaymentEscpos = {
      label: methodLabel(p.method),
      amount,
    };
    if (p.method === "CASH" && ticket.cashAmount != null) {
      const cash = Number(ticket.cashAmount.toString());
      if (cash > amount) {
        base.cashChange = +(cash - amount).toFixed(2);
      }
    }
    return base;
  });

  const issuedAt = ticket.paidAt ?? ticket.createdAt;

  const fiscal = extractFiscal(ticket.tenant.fiscalProfile);

  return {
    legalName: fiscal.legalName,
    taxId: fiscal.taxId,
    fiscalAddress: fiscal.address,
    phone: fiscal.phone,
    businessName:
      ticket.register.store.name && ticket.register.store.name.length > 0
        ? ticket.register.store.name
        : ticket.tenant.name,
    businessAddress: formatAddress(ticket.register.store.fiscalAddress),
    internalNumber: ticket.internalNumber,
    issuedAt,
    cashierLabel: shortLabel(ticket.user.email),
    tableName: ticket.table?.name ?? null,
    lines,
    total: Number(ticket.total.toString()),
    payments,
    notes: ticket.notes ? [ticket.notes] : [],
    publicTicketUrl: `${publicTicketUrlBase}/tickets/${ticket.publicSlug}/pdf`,
    footer: ticket.tenant.receiptFooter,
  };
}

function methodLabel(method: string): string {
  switch (method) {
    case "CASH":
      return "Efectivo";
    case "CARD":
      return "Tarjeta";
    case "BIZUM":
      return "Bizum";
    case "VOUCHER":
      return "Vale";
    default:
      return "Otro";
  }
}

function shortLabel(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return email;
  return email.slice(0, at);
}

function formatAddress(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const street = typeof a.address === "string" ? a.address : null;
  const city = typeof a.city === "string" ? a.city : null;
  const zip = typeof a.postalCode === "string" ? a.postalCode : null;
  const parts = [street, [zip, city].filter(Boolean).join(" ").trim()].filter(
    (s) => s && s.length > 0,
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

// Extrae la cabecera fiscal del `fiscalProfile` (jsonb libre del
// onboarding/Holded o editado a mano). `address` puede venir como string
// o como objeto estructurado (Holded a veces lo devuelve así), igual que
// en el renderer del PDF. Devuelve null en los campos vacíos para que el
// builder los omita.
function extractFiscal(raw: unknown): {
  legalName: string | null;
  taxId: string | null;
  address: string | null;
  phone: string | null;
} {
  if (!raw || typeof raw !== "object") {
    return { legalName: null, taxId: null, address: null, phone: null };
  }
  const fp = raw as Record<string, unknown>;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
  let address: string | null = null;
  if (typeof fp.address === "string") {
    address = str(fp.address);
  } else if (fp.address && typeof fp.address === "object") {
    address = formatAddress(fp.address);
  }
  return {
    legalName: str(fp.legalName),
    taxId: str(fp.taxId),
    address,
    phone: str(fp.phone),
  };
}

// Resuelve qué PrinterConfig usar para una impresión WIFI. Si el caller
// pasó un `printerConfigId`, lo respetamos (validando que pertenezca al
// register). En caso contrario buscamos el primer config activo del
// register con la `section` deseada (`null` = ticket de cobro).
export async function resolveWifiPrinter(
  prisma: ReturnType<typeof getPrisma>,
  registerId: string,
  printerConfigId: string | null,
  section: "BARRA" | "COCINA" | "SALON" | null,
): Promise<{
  id: string;
  ipAddress: string | null;
  port: number | null;
  timeoutMs: number;
  mode: "USB" | "WIFI";
} | null> {
  if (printerConfigId) {
    const cfg = await prisma.printerConfig.findFirst({
      where: {
        id: printerConfigId,
        registerId,
        active: true,
        mode: "WIFI",
      },
      select: {
        id: true,
        ipAddress: true,
        port: true,
        timeoutMs: true,
        mode: true,
      },
    });
    return cfg;
  }
  return prisma.printerConfig.findFirst({
    where: {
      registerId,
      active: true,
      mode: "WIFI",
      section,
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      ipAddress: true,
      port: true,
      timeoutMs: true,
      mode: true,
    },
  });
}
