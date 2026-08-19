// Test del puente cita → caja (B-koibox-4, ADR-K8 §5). Verifica que
// "Cobrar en caja" abre un ticket DRAFT PRE-POBLADO con las líneas de
// servicio del visit (resueltas por serviceId = product.id) SIN re-teclear,
// que es idempotente (segundo checkout devuelve el mismo ticket) y que
// alimenta el camino de cobro existente sin tocarlo.

import { randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);

import { Prisma } from "@mipiacetpv/db";
import { describe, expect, it } from "vitest";

import { checkoutAppointment } from "../src/agenda/checkout.js";
import type { AgendaStore } from "../src/agenda/store.js";
import type { AppointmentView } from "../src/agenda/types.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const REGISTER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CASHIER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CORTE = "33333333-3333-4333-8333-333333333333";
const TINTE = "44444444-4444-4444-8444-444444444444";

// Store mínimo: sólo lo que usa checkout (getAppointmentView, linkTicket,
// setStatus). El resto lanza (no debería llamarse).
function makeStore(appt: AppointmentView): {
  store: AgendaStore;
  get: () => AppointmentView;
} {
  let current = appt;
  const store = {
    async getAppointmentView(_t: string, id: string) {
      return id === current.id ? current : null;
    },
    async linkTicket(_t: string, _id: string, ticketId: string) {
      current = { ...current, ticketId };
    },
    async setStatus(_t: string, _id: string, status: AppointmentView["status"]) {
      current = { ...current, status };
      return current;
    },
  } as unknown as AgendaStore;
  return { store, get: () => current };
}

// Fake prisma-lite con lo que toca checkout: product.findMany, shift.findFirst,
// $transaction, ticket.create, ticket.findUnique.
function makeFakePrisma(products: Array<{
  id: string;
  holdedProductId: string;
  sku: string | null;
  name: string;
  basePrice: number;
  taxRate: number;
}>) {
  const tickets = new Map<string, unknown>();
  const create = (data: Record<string, unknown>) => {
    const lines =
      (data.lines as { create?: Record<string, unknown>[] } | undefined)
        ?.create ?? [];
    tickets.set(data.id as string, {
      id: data.id,
      externalId: data.externalId,
      status: data.status,
      total: data.total,
      totalTax: data.totalTax,
      totalDiscount: data.totalDiscount,
      lines: lines.map((l, i) => ({ id: `line-${i}`, ...l })),
    });
    return {};
  };
  return {
    product: {
      findMany: async () =>
        products.map((p) => ({
          id: p.id,
          holdedProductId: p.holdedProductId,
          sku: p.sku,
          name: p.name,
          basePrice: new Prisma.Decimal(p.basePrice),
          taxRate: new Prisma.Decimal(p.taxRate),
        })),
    },
    shift: {
      findFirst: async () => ({ id: "shift-1" }),
    },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({ ticket: { create: async (args: { data: Record<string, unknown> }) => create(args.data) } }),
    ticket: {
      findUnique: async (args: { where: { id: string } }) =>
        tickets.get(args.where.id) ?? null,
    },
  } as never;
}

function apptWith(items: Array<{ serviceId: string }>): AppointmentView {
  const id = randomUUID();
  return {
    id,
    clientId: null,
    status: "CONFIRMED",
    source: "PRESENCIAL",
    start: "2026-08-10T07:00:00.000Z",
    end: "2026-08-10T08:15:00.000Z",
    ticketId: null,
    notes: null,
    items: items.map((it, i) => ({
      id: `${id}-item-${i}`,
      serviceId: it.serviceId,
      durationMin: 30,
      sortOrder: i,
      startOffsetMin: i * 30,
    })),
    assignments: [],
  };
}

describe("cita → caja (ticket pre-poblado)", () => {
  it("abre un DRAFT con una línea por servicio del visit (corte+tinte)", async () => {
    const appt = apptWith([{ serviceId: CORTE }, { serviceId: TINTE }]);
    const { store, get } = makeStore(appt);
    const prisma = makeFakePrisma([
      { id: CORTE, holdedProductId: "H-CORTE", sku: "SVC-CORTE", name: "Corte", basePrice: 20, taxRate: 21 },
      { id: TINTE, holdedProductId: "H-TINTE", sku: "SVC-TINTE", name: "Tinte", basePrice: 40, taxRate: 21 },
    ]);
    const result = await checkoutAppointment(
      prisma,
      store,
      { tenantId: TENANT, registerId: REGISTER, cashierUserId: CASHIER },
      appt.id,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alreadyLinked).toBe(false);
    expect(result.ticket.status).toBe("DRAFT");
    // Dos líneas, en orden, resueltas por serviceId → sku de servicio.
    expect(result.ticket.lines.map((l) => l.sku)).toEqual([
      "SVC-CORTE",
      "SVC-TINTE",
    ]);
    expect(result.ticket.lines.map((l) => l.nameSnapshot)).toEqual([
      "Corte",
      "Tinte",
    ]);
    // Total = 20 + 40 con IVA 21% = 72.60.
    expect(result.ticket.total).toBe("72.6");
    // La cita quedó enlazada al ticket y "en sala".
    expect(get().ticketId).toBe(result.ticket.id);
    expect(get().status).toBe("IN_SERVICE");
  });

  it("es idempotente: segundo checkout devuelve el mismo ticket (GET-back)", async () => {
    const appt = apptWith([{ serviceId: CORTE }]);
    const { store } = makeStore(appt);
    const prisma = makeFakePrisma([
      { id: CORTE, holdedProductId: "H-CORTE", sku: "SVC-CORTE", name: "Corte", basePrice: 20, taxRate: 21 },
    ]);
    const first = await checkoutAppointment(
      prisma,
      store,
      { tenantId: TENANT, registerId: REGISTER, cashierUserId: CASHIER },
      appt.id,
    );
    const second = await checkoutAppointment(
      prisma,
      store,
      { tenantId: TENANT, registerId: REGISTER, cashierUserId: CASHIER },
      appt.id,
    );
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.alreadyLinked).toBe(true);
      expect(second.ticket.id).toBe(first.ticket.id);
    }
  });

  it("rechaza el checkout de un servicio sin SKU (no cobrable)", async () => {
    const appt = apptWith([{ serviceId: CORTE }]);
    const { store } = makeStore(appt);
    const prisma = makeFakePrisma([
      { id: CORTE, holdedProductId: "H-CORTE", sku: null, name: "Corte", basePrice: 20, taxRate: 21 },
    ]);
    const result = await checkoutAppointment(
      prisma,
      store,
      { tenantId: TENANT, registerId: REGISTER, cashierUserId: CASHIER },
      appt.id,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("SERVICE_NOT_SELLABLE");
  });
});
