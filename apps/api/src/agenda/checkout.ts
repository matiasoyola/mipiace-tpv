// Puente cita → caja (ADR-K8 §5). La métrica única del MVP: nº de citas del
// día cerradas en caja desde la agenda SIN re-teclear el ticket.
//
// "Cobrar en caja" abre/enlaza un ticket DRAFT PRE-POBLADO con las líneas de
// servicio del visit (cada `appointment_item` → `ticket_line`, resuelto por
// `serviceId` = product.id, NUNCA por sku ad-hoc). Usa el CAMINO DE COBRO
// EXISTENTE INTACTO (GET-back, tolerancia 5 cts, `/pay` idempotente,
// ADR-010): este módulo ALIMENTA ese camino, NO lo toca. `appointment.
// ticketId` enlaza ambos; el front, al cerrar el ticket por el camino
// normal, hace `PATCH /agenda/appointments/:id { status: COMPLETED }` (no se
// puede enganchar en el cobro sin tocarlo). El DRAFT que se crea aquí es
// idéntico al que abre una mesa (`tables/operativa.ts::getOrCreateDraftTicket`).

import { randomUUID } from "node:crypto";

import { Prisma } from "@mipiacetpv/db";
import type { PrismaClient } from "@mipiacetpv/db";

import { generatePublicSlug } from "../tickets/public-slug.js";
import { computeTicket } from "../tickets/totals.js";
import type { AgendaStore } from "./store.js";

export type CheckoutResult =
  | { ok: true; ticket: SerializedCheckoutTicket; alreadyLinked: boolean }
  | { ok: false; status: number; error: string; message: string };

export interface SerializedCheckoutTicket {
  id: string;
  externalId: string;
  status: string;
  total: string;
  totalTax: string;
  totalDiscount: string;
  lines: Array<{
    id: string;
    productId: string | null;
    holdedProductId: string | null;
    sku: string;
    nameSnapshot: string;
    units: string;
    unitPrice: string;
    discountPct: string;
    taxRate: string;
    subtotal: string;
    total: string;
  }>;
}

export interface CheckoutContext {
  tenantId: string;
  registerId: string;
  cashierUserId: string;
}

// Abre (o devuelve si ya existe) el ticket pre-poblado de una cita.
export async function checkoutAppointment(
  prisma: PrismaClient,
  store: AgendaStore,
  ctx: CheckoutContext,
  appointmentId: string,
): Promise<CheckoutResult> {
  const appt = await store.getAppointmentView(ctx.tenantId, appointmentId);
  if (!appt) {
    return {
      ok: false,
      status: 404,
      error: "APPOINTMENT_NOT_FOUND",
      message: "Cita no encontrada.",
    };
  }
  if (appt.status === "CANCELLED" || appt.status === "NO_SHOW") {
    return {
      ok: false,
      status: 409,
      error: "APPOINTMENT_NOT_CHECKOUTABLE",
      message: "La cita está cancelada o marcada como no-show.",
    };
  }

  // Idempotencia: si ya hay ticket enlazado, devolverlo (GET-back del DRAFT).
  if (appt.ticketId) {
    const existing = await loadTicket(prisma, appt.ticketId);
    if (existing) return { ok: true, ticket: existing, alreadyLinked: true };
  }

  if (appt.items.length === 0) {
    return {
      ok: false,
      status: 409,
      error: "APPOINTMENT_EMPTY",
      message: "La cita no tiene servicios que cobrar.",
    };
  }

  // Cargar los productos-servicio del visit (serviceId = product.id).
  const serviceIds = [...new Set(appt.items.map((i) => i.serviceId))];
  const products = await prisma.product.findMany({
    where: { tenantId: ctx.tenantId, id: { in: serviceIds }, kind: "SERVICE" },
    select: {
      id: true,
      holdedProductId: true,
      sku: true,
      name: true,
      basePrice: true,
      taxRate: true,
    },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  // Turno abierto de la caja del cajero (mismo criterio que abrir mesa).
  const shift = await prisma.shift.findFirst({
    where: { registerId: ctx.registerId, closedAt: null },
    select: { id: true },
    orderBy: { openedAt: "desc" },
  });
  if (!shift) {
    return {
      ok: false,
      status: 409,
      error: "SHIFT_NOT_OPEN",
      message: "No hay turno abierto en esta caja.",
    };
  }

  // Construir las líneas (una por item, en orden). units=1, sin descuento.
  const lineInputs: Array<{
    productId: string;
    holdedProductId: string;
    sku: string;
    nameSnapshot: string;
    unitPrice: number;
    taxRate: number;
  }> = [];
  for (const item of appt.items) {
    const p = byId.get(item.serviceId);
    if (!p) {
      return {
        ok: false,
        status: 409,
        error: "SERVICE_NOT_FOUND",
        message: "Un servicio de la cita ya no existe en el catálogo.",
      };
    }
    if (!p.sku || p.sku.trim() === "") {
      // El camino de cobro exige sku no vacío en la línea (Product
      // sellableViaTpv). Un servicio sin sku no es cobrable.
      return {
        ok: false,
        status: 409,
        error: "SERVICE_NOT_SELLABLE",
        message: `El servicio "${p.name}" no tiene SKU y no se puede cobrar.`,
      };
    }
    lineInputs.push({
      productId: p.id,
      holdedProductId: p.holdedProductId,
      sku: p.sku,
      nameSnapshot: p.name,
      unitPrice: Number(p.basePrice),
      taxRate: Number(p.taxRate),
    });
  }

  const totals = computeTicket(
    lineInputs.map((l) => ({
      units: 1,
      unitPrice: l.unitPrice,
      discountPct: 0,
      taxRate: l.taxRate,
    })),
  );

  const ticketId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.ticket.create({
      data: {
        id: ticketId,
        tenantId: ctx.tenantId,
        registerId: ctx.registerId,
        shiftId: shift.id,
        userId: ctx.cashierUserId,
        // internalNumber se asigna al cobrar (PAID); en DRAFT, placeholder
        // único (mismo patrón que abrir mesa).
        internalNumber: `D-${randomUUID()}`,
        externalId: randomUUID(),
        publicSlug: generatePublicSlug(),
        status: "DRAFT",
        total: new Prisma.Decimal(totals.total),
        totalTax: new Prisma.Decimal(totals.tax),
        totalDiscount: new Prisma.Decimal(totals.discount),
        printIntent: true,
        lines: {
          create: lineInputs.map((l, i) => {
            const cl = totals.lines[i]!;
            return {
              productId: l.productId,
              holdedProductId: l.holdedProductId,
              sku: l.sku,
              nameSnapshot: l.nameSnapshot,
              units: new Prisma.Decimal(1),
              unitPrice: new Prisma.Decimal(l.unitPrice),
              discountPct: new Prisma.Decimal(0),
              taxRate: new Prisma.Decimal(l.taxRate),
              subtotal: new Prisma.Decimal(cl.subtotal),
              total: new Prisma.Decimal(cl.total),
            };
          }),
        },
      },
    });
  });

  await store.linkTicket(ctx.tenantId, appointmentId, ticketId);
  // Marcar la cita "en sala" al abrir el cobro (si aún no lo está). El paso a
  // COMPLETED lo hace el front al confirmarse el pago por el camino normal.
  if (appt.status === "PENDING" || appt.status === "CONFIRMED") {
    await store.setStatus(ctx.tenantId, appointmentId, "IN_SERVICE");
  }

  const ticket = await loadTicket(prisma, ticketId);
  if (!ticket) throw new Error("ticket vanished after create");
  return { ok: true, ticket, alreadyLinked: false };
}

async function loadTicket(
  prisma: PrismaClient,
  ticketId: string,
): Promise<SerializedCheckoutTicket | null> {
  const t = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      externalId: true,
      status: true,
      total: true,
      totalTax: true,
      totalDiscount: true,
      lines: {
        select: {
          id: true,
          productId: true,
          holdedProductId: true,
          sku: true,
          nameSnapshot: true,
          units: true,
          unitPrice: true,
          discountPct: true,
          taxRate: true,
          subtotal: true,
          total: true,
        },
      },
    },
  });
  if (!t) return null;
  return {
    id: t.id,
    externalId: t.externalId,
    status: t.status,
    total: t.total.toString(),
    totalTax: t.totalTax.toString(),
    totalDiscount: t.totalDiscount.toString(),
    lines: t.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      holdedProductId: l.holdedProductId,
      sku: l.sku,
      nameSnapshot: l.nameSnapshot,
      units: l.units.toString(),
      unitPrice: l.unitPrice.toString(),
      discountPct: l.discountPct.toString(),
      taxRate: l.taxRate.toString(),
      subtotal: l.subtotal.toString(),
      total: l.total.toString(),
    })),
  };
}
