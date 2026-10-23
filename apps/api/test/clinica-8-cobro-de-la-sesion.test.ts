// clinica-8 · UNA SOLA VERDAD EN EL COBRO.
//
// Lo que la auditoría del 18-10 midió, con la paciente ya fuera: la cita se
// dio como «Quiropodia completa · 26 €», la sesión se cerró sin una sola
// línea cobrable, y «Cobrar en caja» abrió un ticket de **26 €**. Se cobró
// la previsión, no el trabajo — y nadie lo vio, porque los importes
// cuadran.
//
// La causa estaba en una respuesta de dos valores: `lineasDeLaSesionCerrada`
// devolvía `null` tanto para «aquí no hay nada clínico» como para «la
// sesión cerrada no dejó nada que cobrar», y el cobro no podía
// distinguirlos. Ahora son tres, y este banco fija qué hace el cobro con
// cada uno.
//
// La otra mitad —que la lectura rota siga cayendo al camino de siempre—
// está aquí también, y es la que protege «cobrar siempre se puede».

import { randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);

import { Prisma } from "@mipiacetpv/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LineasDeLaSesion } from "../src/clinica/lineas-de-la-sesion.js";

// Lo que la sesión cerrada contesta, puesto por cada caso.
const sesion = vi.hoisted(() => ({ dice: null as LineasDeLaSesion | null }));
vi.mock("../src/clinica/lineas-de-la-sesion.js", () => ({
  lineasDeLaSesionCerrada: async () => sesion.dice,
}));

const { checkoutAppointment } = await import("../src/agenda/checkout.js");
type AgendaStore = import("../src/agenda/store.js").AgendaStore;
type AppointmentView = import("../src/agenda/types.js").AppointmentView;

const TENANT = "11111111-1111-4111-8111-111111111111";
const REGISTER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CASHIER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
/** El servicio con el que se dio la cita: la PREVISIÓN. */
const RESERVADO = "33333333-3333-4333-8333-333333333333";
/** El que de verdad se hizo en la consulta. */
const HECHO = "44444444-4444-4444-8444-444444444444";

function makeStore(appt: AppointmentView): AgendaStore {
  let current = appt;
  return {
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
}

function makeFakePrisma() {
  const tickets = new Map<string, any>();
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
      findMany: async (args: any) =>
        (args.where.id.in as string[]).map((id) => ({
          id,
          holdedProductId: null,
          sku: id === RESERVADO ? "SVC-COMPLETA" : "SVC-CURA",
          name: id === RESERVADO ? "Quiropodia completa" : "Cura",
          basePrice: new Prisma.Decimal(id === RESERVADO ? 26 : 13),
          taxRate: new Prisma.Decimal(0),
          exemptionCause: "E1",
        })),
    },
    shift: { findFirst: async () => ({ id: "shift-1" }) },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        ticket: {
          create: async (args: { data: Record<string, unknown> }) =>
            create(args.data),
        },
      }),
    ticket: {
      findUnique: async (args: { where: { id: string } }) =>
        tickets.get(args.where.id) ?? null,
    },
  } as never;
}

function citaDe(serviceId: string): AppointmentView {
  const id = randomUUID();
  return {
    id,
    clientId: null,
    status: "CONFIRMED",
    source: "PRESENCIAL",
    start: "2026-10-19T08:00:00.000Z",
    end: "2026-10-19T08:30:00.000Z",
    ticketId: null,
    voucherId: null,
    notes: null,
    items: [
      {
        id: `${id}-item-0`,
        serviceId,
        durationMin: 30,
        sortOrder: 0,
        startOffsetMin: 0,
      },
    ],
    assignments: [],
  };
}

async function cobrar() {
  const appt = citaDe(RESERVADO);
  return checkoutAppointment(
    makeFakePrisma(),
    makeStore(appt),
    { tenantId: TENANT, registerId: REGISTER, cashierUserId: CASHIER },
    appt.id,
  );
}

beforeEach(() => {
  sesion.dice = null;
});

describe("clinica-8 · con sesión cerrada manda la SESIÓN, no la cita", () => {
  it("lo que se hizo es lo que se cobra", async () => {
    sesion.dice = { lineas: [{ serviceId: HECHO }] };
    const r = await cobrar();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ticket.lines.map((l) => l.sku)).toEqual(["SVC-CURA"]);
    expect(r.ticket.total).toBe("13");
    expect(r.sesionSinCobro).toBeUndefined();
  });

  it("SIN NADA QUE COBRAR: el borrador sale VACÍO y lo dice", async () => {
    // Éste es el caso del 18-10. Antes de este bloque salía con la
    // «Quiropodia completa · 26 €» de la cita, que es lo que NO se hizo.
    sesion.dice = { sinNadaQueCobrar: true };
    const r = await cobrar();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sesionSinCobro).toBe(true);
    expect(r.ticket.lines).toEqual([]);
    expect(r.ticket.total).toBe("0");
  });

  it("y el servicio RESERVADO no se cuela por ningún lado", async () => {
    // El sabotaje que esto caza: volver a `tratamientos ?? appt.items`.
    sesion.dice = { sinNadaQueCobrar: true };
    const r = await cobrar();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.stringify(r.ticket)).not.toContain("SVC-COMPLETA");
    expect(JSON.stringify(r.ticket)).not.toContain("Quiropodia completa");
  });
});

describe("clinica-8 · y lo de siempre no cambia", () => {
  it("sin sesión clínica, se cobran los servicios de la cita", async () => {
    sesion.dice = null;
    const r = await cobrar();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ticket.lines.map((l) => l.sku)).toEqual(["SVC-COMPLETA"]);
    expect(r.ticket.total).toBe("26");
    expect(r.sesionSinCobro).toBeUndefined();
  });

  it("una cita SIN servicios y sin sesión sigue siendo 409 APPOINTMENT_EMPTY", async () => {
    // El borrador vacío sólo es legítimo por el camino clínico. Una cita
    // sin nada que cobrar y sin consulta detrás no es una consulta que
    // pasó: es una cita vacía.
    sesion.dice = null;
    const appt = citaDe(RESERVADO);
    const r = await checkoutAppointment(
      makeFakePrisma(),
      makeStore({ ...appt, items: [] }),
      { tenantId: TENANT, registerId: REGISTER, cashierUserId: CASHIER },
      appt.id,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("APPOINTMENT_EMPTY");
  });
});
