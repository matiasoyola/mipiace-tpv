// v1.4-Impresoras-Fase-1 Lote 2 · endpoint de impresión ESC/POS.
//
//   POST /tickets/:ticketId/print/escpos?target=usb|wifi[&printerConfigId=...][&copy=true]
//
//   - target=usb  → devuelve el binary ESC/POS en el body
//                   (Content-Type: application/octet-stream). El TPV
//                   lo mete en `device.transferOut()` con WebUSB.
//   - target=wifi → carga el PrinterConfig por `printerConfigId` (o,
//                   si no se pasa, el primero ACTIVO sin sección del
//                   register), abre socket TCP a ip:port y manda el
//                   binary. Devuelve `{ok, printedAt}` o `{ok:false, error}`.
//
//   - copy=true   → el papel lleva "COPIA - no fiscal" (v1.10.2). Lo usa
//                   la reimpresión desde el detalle de ticket, que antes
//                   pasaba por /reprint (PrintIntent que nadie consumía).
//
// Auth: requireCashierSession. Lo dispara el TPV tras cobrar (o por
// reimpresión manual).

import { loadEnv } from "../env.js";
import {
  ticketToEscposInput,
  type TicketForPrint,
} from "./escpos-input.js";
// Se re-exporta porque `test/ticket-net-unit-price.test.ts` lo importa
// desde aquí desde v1.8, y ese test es una red de seguridad del precio
// unitario que no tiene por qué moverse por un refactor de este bloque.
export { ticketToEscposInput };
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
import { cashierLabelFrom } from "../users/display.js";
import { loadTicketDocument } from "./build-document.js";
import { changeFromCash } from "@mipiacetpv/ticket-model";
import type { TicketTotals, TicketVerifactu } from "@mipiacetpv/ticket-model";
import { ensureCajaEnabled } from "../lib/caja-gate.js";

interface PrintQuery {
  target: "usb" | "wifi";
  printerConfigId?: string;
  // v1.10.2-impresion-honesta · reimpresión: marca el papel como copia.
  copy?: boolean;
}

export async function registerTicketPrintRoute(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    "/tickets/:ticketId/print/escpos",
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
          required: ["target"],
          properties: {
            target: { type: "string", enum: ["usb", "wifi"] },
            printerConfigId: { type: "string", format: "uuid" },
            copy: { type: "boolean", default: false },
          },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { ticketId } = request.params as { ticketId: string };
      const { target, printerConfigId, copy } = request.query as PrintQuery;
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

      // v1.9.10 · el desglose de IVA por tipo lo calcula el modelo
      // compartido (mismo que usa el PDF/ticket digital). Lo cargamos y se
      // lo pasamos al builder térmico para que imprima "IVA X% s/base" +
      // Subtotal, cuadrado al céntimo. DEFENSIVO: imprimir el ticket es más
      // importante que el desglose — si armar el documento falla por lo que
      // sea, el ticket sale igual que hasta ahora (sin desglose).
      let ticketTotals: TicketTotals | null = null;
      // V1-verifactu · el número fiscal y el QR tributario salen del MISMO
      // documento que el desglose. No se vuelven a componer aquí: el papel
      // y el PDF tienen que decir lo mismo, y la forma de garantizarlo es
      // que salgan del mismo sitio.
      let verifactu: TicketVerifactu | null = null;
      try {
        const doc = await loadTicketDocument({ prisma, ticketId });
        ticketTotals = doc?.totals ?? null;
        verifactu = doc?.verifactu ?? null;
      } catch (err) {
        request.log.warn(
          {
            ticketId,
            error: err instanceof Error ? err.message : String(err),
          },
          "tickets.print.escpos: no se pudo armar el desglose IVA; se imprime sin desglose",
        );
      }
      const bytes = buildTicketReceipt(
        ticketToEscposInput(
          ticket,
          env.PUBLIC_TICKET_URL,
          ticketTotals,
          copy === true,
          verifactu,
        ),
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

async function loadTicketForPrint(
  prisma: ReturnType<typeof getPrisma>,
  ticketId: string,
  tenantId: string,
): Promise<TicketForPrint | null> {
  const ticket = await prisma.ticket.findFirst({
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
      status: true,
      creditPending: true,
      contactHoldedId: true,
      table: { select: { name: true } },
      user: { select: { email: true, alias: true } },
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
  if (!ticket) return null;
  // v1.8-Fiado · si es un fiado con deuda viva, hidratamos el nombre del
  // deudor desde el contacto para la leyenda PENDIENTE DE PAGO.
  let debtorName: string | null = null;
  if (
    ticket.creditPending != null &&
    Number(ticket.creditPending) > 0 &&
    ticket.contactHoldedId
  ) {
    const contact = await prisma.contact.findFirst({
      where: { tenantId, holdedContactId: ticket.contactHoldedId },
      select: { name: true },
    });
    debtorName = contact?.name ?? null;
  }
  return { ...ticket, debtorName } as TicketForPrint;
}

// Convierte el ticket cargado en input para el builder ESC/POS. Vive
// en el endpoint (no en el package) porque depende del shape Prisma y
// de la lógica de "dónde sacar la dirección" — el package es agnóstico.

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
