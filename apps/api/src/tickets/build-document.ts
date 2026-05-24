// Carga un ticket completo de BD (con relaciones necesarias para el
// `TicketDocument`) y lo transforma con `buildTicketDocument`. Vive
// aquí — no en `packages/ticket-model` — porque depende de Prisma y
// de la heurística de cargar tenant/store/register/cashier desde sus
// tablas. El package se mantiene tipo-puro y agnóstico.

import {
  buildTicketDocument,
  type BuildTicketDocumentInput,
  type TicketDocument,
} from "@mipiacetpv/ticket-model";
import { type PrismaClient } from "@mipiacetpv/db";

export interface LoadTicketDocumentOptions {
  prisma: PrismaClient;
  ticketId?: string;
  publicSlug?: string;
  // Si el caller ya resolvió el email del cliente (vía Contact lookup
  // o el `emailIntent` del cajero) lo pasamos aquí. El builder lo
  // pinta en la sección "Cliente".
  overrideCustomerEmail?: string;
}

export async function loadTicketDocument(
  opts: LoadTicketDocumentOptions,
): Promise<TicketDocument | null> {
  const { prisma } = opts;
  const where = opts.publicSlug
    ? { publicSlug: opts.publicSlug }
    : { id: opts.ticketId! };
  const ticket = await prisma.ticket.findFirst({
    where,
    include: {
      tenant: {
        select: { name: true, fiscalProfile: true, businessType: true },
      },
      register: {
        select: {
          name: true,
          store: {
            select: { name: true, fiscalAddress: true },
          },
        },
      },
      user: { select: { email: true } },
      lines: { orderBy: { id: "asc" } },
      payments: true,
    },
  });
  if (!ticket) return null;

  // Si el ticket lleva `contactHoldedId`, hidratamos su nombre/email
  // desde la cache local de contactos. No bloqueamos si falla — el
  // ticket digital sigue siendo válido sin sección cliente.
  let customerName: string | undefined;
  let customerEmail: string | undefined = opts.overrideCustomerEmail;
  let customerTaxId: string | undefined;
  if (ticket.contactHoldedId) {
    const contact = await prisma.contact.findFirst({
      where: { tenantId: ticket.tenantId, holdedContactId: ticket.contactHoldedId },
      select: { name: true, email: true, nif: true },
    });
    if (contact) {
      customerName = contact.name || undefined;
      customerEmail = customerEmail ?? contact.email ?? undefined;
      customerTaxId = contact.nif || undefined;
    }
  }
  // El cajero puede haber introducido un email manual en el checkout
  // (sin contacto vinculado). Lo usamos como fallback.
  if (!customerEmail && ticket.emailIntent) {
    customerEmail = ticket.emailIntent;
  }

  const input: BuildTicketDocumentInput = {
    tenant: {
      name: ticket.tenant.name,
      fiscalProfile: ticket.tenant.fiscalProfile as
        | BuildTicketDocumentInput["tenant"]["fiscalProfile"]
        | null,
      // v1.3-Servicios-Pinta · Lote 2: el renderer rotula la cabecera
      // según la vertical (SERVICES → COMPROBANTE).
      businessType: ticket.tenant.businessType,
    },
    store: {
      name: ticket.register.store.name,
      fiscalAddress: ticket.register.store.fiscalAddress as
        | BuildTicketDocumentInput["store"]["fiscalAddress"]
        | null,
    },
    register: { name: ticket.register.name },
    cashier: { email: ticket.user.email, name: null },
    ticket: {
      internalNumber: ticket.internalNumber,
      publicSlug: ticket.publicSlug,
      paidAt: ticket.paidAt,
      createdAt: ticket.createdAt,
      cashAmount: ticket.cashAmount,
      total: ticket.total,
      // v1.3-Servicios-Pinta · Lote 3: profesional que atendió.
      attendedBy: ticket.attendedBy ?? undefined,
      lines: ticket.lines.map((l) => ({
        nameSnapshot: l.nameSnapshot,
        sku: l.sku,
        units: l.units,
        unitPrice: l.unitPrice,
        discountPct: l.discountPct,
        taxRate: l.taxRate,
        subtotal: l.subtotal,
        total: l.total,
      })),
      payments: ticket.payments.map((p) => ({
        method: p.method,
        amount: p.amount,
      })),
    },
    customer:
      customerName || customerEmail || customerTaxId
        ? { name: customerName, email: customerEmail, taxId: customerTaxId }
        : null,
  };

  return buildTicketDocument(input);
}
