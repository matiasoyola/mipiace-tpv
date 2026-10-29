// clinica-11 · EL PRIMER COBRO DEL DÍA ABRE LA CAJA. EN UNA CLÍNICA.
//
// Los dos lados de la misma frase, y hacen falta los dos:
//
//   · en una CLÍNICA, un cobro con la caja cerrada abre el turno solo, con
//     el fondo que dejó el último cierre, a nombre de quien cobra y con
//     `open_reason = AUTO_CLINICA`;
//   · en HOSTELERÍA (y en retail, y en una residencia) el mismo cobro
//     sigue recibiendo el `409 SHIFT_NOT_OPEN` de siempre. Ahí hay
//     mostrador y el fondo de caja lo declara una persona.
//
// Sabotajes (vistos en rojo, tabla en el `-done`):
//   · cambiar `esVerticalClinica` a `clinicalRecordsEnabled === true` sin
//     el `residenciaEnabled !== true` → rojo (la residencia abriría turno
//     sola);
//   · quitar el `openReason: "AUTO_CLINICA"` del `create` → rojo;
//   · devolver `cashCounted ?? 0` en vez del teórico → rojo.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import { Prisma } from "@mipiacetpv/db";
import { beforeEach, describe, expect, it } from "vitest";

import { checkoutAppointment } from "../src/agenda/checkout.js";
import type { AgendaStore } from "../src/agenda/store.js";
import type { AppointmentView } from "../src/agenda/types.js";
import { esVerticalClinica } from "../src/lib/vertical-clinica.js";
import {
  abrirTurnoDeClinica,
  fondoDelUltimoCierre,
} from "../src/shift/apertura-automatica.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const REGISTER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PODOLOGA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const QUIROPODIA = "33333333-3333-4333-8333-333333333333";

// ── El doble de Prisma: turnos, pagos y el tenant ────────────────────
//
// Sólo lo que toca este camino. Los turnos son filas de verdad (se crean,
// se cierran y se leen por `registerId`) porque lo que hay que medir es
// qué fila queda escrita.

interface FilaDeTurno {
  id: string;
  registerId: string;
  userId: string;
  openedAt: Date;
  closedAt: Date | null;
  cashOpening: Prisma.Decimal;
  cashCounted: Prisma.Decimal | null;
  openReason: string;
  lastActivityAt: Date;
}

interface Vertical {
  clinicalRecordsEnabled: boolean;
  residenciaEnabled: boolean;
}

let turnos: FilaDeTurno[] = [];
/** Los borradores que el cobro de la cita deja escritos. */
let ticketsCreados = new Map<string, Record<string, unknown>>();
/** Pagos en efectivo por turno, para el teórico del último cierre. */
let efectivoPorTurno: Record<string, number> = {};
let vertical: Vertical = {
  clinicalRecordsEnabled: true,
  residenciaEnabled: false,
};
let tenantConsultado = 0;

function sembrarCierre(input: {
  cashOpening: number;
  cashCounted: number | null;
  efectivo: number;
  closedAt: Date;
}): string {
  const id = randomUUID();
  turnos.push({
    id,
    registerId: REGISTER,
    userId: PODOLOGA,
    openedAt: new Date(input.closedAt.getTime() - 8 * 3600_000),
    closedAt: input.closedAt,
    cashOpening: new Prisma.Decimal(input.cashOpening),
    cashCounted:
      input.cashCounted == null ? null : new Prisma.Decimal(input.cashCounted),
    openReason: "MANUAL",
    lastActivityAt: input.closedAt,
  });
  efectivoPorTurno[id] = input.efectivo;
  return id;
}

function fakePrisma() {
  return {
    shift: {
      findFirst: async ({ where, orderBy }: any) => {
        let filas = turnos.filter((t) => t.registerId === where.registerId);
        if (where.closedAt === null) filas = filas.filter((t) => t.closedAt == null);
        if (where.closedAt?.not === null) {
          filas = filas.filter((t) => t.closedAt != null);
        }
        if (where.id) filas = filas.filter((t) => t.id === where.id);
        const clave = orderBy?.closedAt ? "closedAt" : "openedAt";
        filas = [...filas].sort(
          (a, b) =>
            (b[clave]?.getTime() ?? 0) - (a[clave]?.getTime() ?? 0),
        );
        return filas[0] ?? null;
      },
      findMany: async () => [],
      create: async ({ data }: any) => {
        const fila: FilaDeTurno = {
          id: randomUUID(),
          registerId: data.registerId,
          userId: data.userId,
          openedAt: data.openedAt,
          closedAt: null,
          cashOpening: data.cashOpening,
          cashCounted: null,
          openReason: data.openReason ?? "MANUAL",
          lastActivityAt: data.lastActivityAt,
        };
        turnos.push(fila);
        return fila;
      },
    },
    ticketPayment: {
      groupBy: async ({ where }: any) => {
        // Sólo las ventas del turno (los cobros de deuda no se siembran).
        if (where.collectedInShiftId !== null) return [];
        const id = where.ticket?.shiftId as string | undefined;
        const importe = id ? (efectivoPorTurno[id] ?? 0) : 0;
        if (importe === 0) return [];
        return [{ method: "CASH", _sum: { amount: importe } }];
      },
    },
    refund: { groupBy: async () => [] },
    ticket: {
      aggregate: async () => ({ _count: { _all: 0 }, _sum: { total: null } }),
      findUnique: async ({ where }: any) => ticketsCreados.get(where.id) ?? null,
    },
    tenant: {
      findUnique: async () => {
        tenantConsultado += 1;
        return { ...vertical };
      },
    },
    product: {
      findMany: async () => [
        {
          id: QUIROPODIA,
          holdedProductId: "H-QUIRO",
          sku: "SVC-QUIRO",
          name: "Quiropodia",
          basePrice: new Prisma.Decimal(25),
          taxRate: new Prisma.Decimal(0),
          exemptionCause: "E5",
        },
      ],
    },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        ticket: {
          create: async ({ data }: any) => {
            const lineas = (data.lines?.create ?? []) as any[];
            ticketsCreados.set(data.id, {
              id: data.id,
              externalId: data.externalId,
              status: data.status,
              shiftId: data.shiftId,
              total: data.total,
              totalTax: data.totalTax,
              totalDiscount: data.totalDiscount,
              lines: lineas.map((l, i) => ({ id: `l${i}`, ...l })),
            });
            return {};
          },
        },
      }),
  } as any;
}

beforeEach(() => {
  turnos = [];
  ticketsCreados = new Map();
  efectivoPorTurno = {};
  vertical = { clinicalRecordsEnabled: true, residenciaEnabled: false };
  tenantConsultado = 0;
});

// ── Qué es una clínica ───────────────────────────────────────────────

describe("clinica-11 · esVerticalClinica", () => {
  it("una consulta de podología sí", () => {
    expect(
      esVerticalClinica({
        clinicalRecordsEnabled: true,
        residenciaEnabled: false,
      }),
    ).toBe(true);
  });

  it("UNA RESIDENCIA NO, aunque tenga la historia clínica encendida", () => {
    // `residenciaEnabled` enciende la clínica por diseño (residencia-1) y
    // hay un CHECK que lo obliga. Una residencia tiene mostrador, relevo y
    // turno: su caja no se abre sola.
    expect(
      esVerticalClinica({
        clinicalRecordsEnabled: true,
        residenciaEnabled: true,
      }),
    ).toBe(false);
  });

  it("un bar o una librería no", () => {
    expect(
      esVerticalClinica({
        clinicalRecordsEnabled: false,
        residenciaEnabled: false,
      }),
    ).toBe(false);
  });

  it("un tenant parcial (el doble de un test) tampoco", () => {
    expect(esVerticalClinica({})).toBe(false);
    expect(esVerticalClinica(null)).toBe(false);
  });
});

// ── El fondo ─────────────────────────────────────────────────────────

describe("clinica-11 · el fondo que dejó el último cierre", () => {
  it("sin ningún cierre, cero: es el primer día de la clínica", async () => {
    expect(await fondoDelUltimoCierre(fakePrisma(), REGISTER)).toBe(0);
  });

  it("si alguien CONTÓ el cajón, el fondo es lo que contó", async () => {
    sembrarCierre({
      cashOpening: 50,
      cashCounted: 143.5,
      efectivo: 80,
      closedAt: new Date("2026-10-28T19:00:00.000Z"),
    });
    expect(await fondoDelUltimoCierre(fakePrisma(), REGISTER)).toBe(143.5);
  });

  it("si NO lo contó —el cierre por defecto desde v1.11— es el teórico", async () => {
    // 50 de fondo + 80 cobrados en efectivo = 130 en el cajón.
    sembrarCierre({
      cashOpening: 50,
      cashCounted: null,
      efectivo: 80,
      closedAt: new Date("2026-10-28T19:00:00.000Z"),
    });
    expect(await fondoDelUltimoCierre(fakePrisma(), REGISTER)).toBe(130);
  });

  it("manda el ÚLTIMO cierre, no el primero", async () => {
    sembrarCierre({
      cashOpening: 0,
      cashCounted: 999,
      efectivo: 0,
      closedAt: new Date("2026-10-20T19:00:00.000Z"),
    });
    sembrarCierre({
      cashOpening: 10,
      cashCounted: 42,
      efectivo: 0,
      closedAt: new Date("2026-10-28T19:00:00.000Z"),
    });
    expect(await fondoDelUltimoCierre(fakePrisma(), REGISTER)).toBe(42);
  });

  it("nunca negativo: un fondo de caja negativo no se puede contar", async () => {
    // Más devoluciones en efectivo que ventas. El teórico sale negativo y
    // lo que se abre es a cero.
    sembrarCierre({
      cashOpening: 0,
      cashCounted: null,
      efectivo: -30,
      closedAt: new Date("2026-10-28T19:00:00.000Z"),
    });
    expect(await fondoDelUltimoCierre(fakePrisma(), REGISTER)).toBe(0);
  });
});

// ── La apertura ──────────────────────────────────────────────────────

describe("clinica-11 · abrirTurnoDeClinica", () => {
  it("abre con el fondo del último cierre, a nombre de quien cobra y marcado", async () => {
    sembrarCierre({
      cashOpening: 20,
      cashCounted: 95,
      efectivo: 70,
      closedAt: new Date("2026-10-28T19:00:00.000Z"),
    });
    const prisma = fakePrisma();
    const turno = await abrirTurnoDeClinica({
      prisma,
      registerId: REGISTER,
      userId: PODOLOGA,
      ahora: new Date("2026-10-29T08:05:00.000Z"),
    });
    expect(turno.recienAbierto).toBe(true);
    const fila = turnos.find((t) => t.id === turno.id)!;
    expect(Number(fila.cashOpening.toString())).toBe(95);
    expect(fila.userId).toBe(PODOLOGA);
    // EL RASTRO. Sin esto, el Z de una clínica y el de un bar dicen lo
    // mismo y no es verdad: en uno alguien contó el cajón, en el otro no.
    expect(fila.openReason).toBe("AUTO_CLINICA");
    expect(fila.closedAt).toBeNull();
  });

  it("dos cobros seguidos no abren dos turnos", async () => {
    const prisma = fakePrisma();
    const a = await abrirTurnoDeClinica({
      prisma,
      registerId: REGISTER,
      userId: PODOLOGA,
    });
    const b = await abrirTurnoDeClinica({
      prisma,
      registerId: REGISTER,
      userId: PODOLOGA,
    });
    expect(b.id).toBe(a.id);
    expect(b.recienAbierto).toBe(false);
    expect(turnos.filter((t) => t.closedAt == null)).toHaveLength(1);
  });

  it("deja su línea en el log, con el fondo dentro", async () => {
    const lineas: Array<{ obj: object; msg: string }> = [];
    await abrirTurnoDeClinica({
      prisma: fakePrisma(),
      registerId: REGISTER,
      userId: PODOLOGA,
      log: { info: (obj, msg) => lineas.push({ obj, msg }) },
    });
    expect(lineas).toHaveLength(1);
    expect(lineas[0]!.obj).toMatchObject({
      event: "shift.auto_open_clinica",
      registerId: REGISTER,
      userId: PODOLOGA,
      cashOpening: 0,
    });
  });
});

// ── El cobro de la cita, que es EL cobro de una consulta ─────────────

function citaDeQuiropodia(): AppointmentView {
  const id = randomUUID();
  return {
    id,
    clientId: null,
    status: "CONFIRMED",
    source: "PRESENCIAL",
    start: "2026-10-29T08:00:00.000Z",
    end: "2026-10-29T08:45:00.000Z",
    ticketId: null,
    voucherId: null,
    notes: null,
    items: [
      {
        id: `${id}-item-0`,
        serviceId: QUIROPODIA,
        durationMin: 45,
        sortOrder: 0,
        startOffsetMin: 0,
      },
    ],
    assignments: [],
  };
}

function storeDe(appt: AppointmentView): AgendaStore {
  let actual = appt;
  return {
    async getAppointmentView(_t: string, id: string) {
      return id === actual.id ? actual : null;
    },
    async linkTicket(_t: string, _id: string, ticketId: string) {
      actual = { ...actual, ticketId };
    },
    async setStatus(_t: string, _id: string, status: AppointmentView["status"]) {
      actual = { ...actual, status };
      return actual;
    },
  } as unknown as AgendaStore;
}

describe("clinica-11 · «Cobrar en caja» con la caja cerrada", () => {
  const ctx = {
    tenantId: TENANT,
    registerId: REGISTER,
    cashierUserId: PODOLOGA,
  };

  it("EN UNA CLÍNICA abre el turno solo y el cobro sigue", async () => {
    sembrarCierre({
      cashOpening: 0,
      cashCounted: 60,
      efectivo: 60,
      closedAt: new Date("2026-10-28T19:00:00.000Z"),
    });
    const appt = citaDeQuiropodia();
    const res = await checkoutAppointment(
      fakePrisma(),
      storeDe(appt),
      ctx,
      appt.id,
    );
    expect(res.ok).toBe(true);
    const abiertos = turnos.filter((t) => t.closedAt == null);
    expect(abiertos).toHaveLength(1);
    expect(abiertos[0]!.openReason).toBe("AUTO_CLINICA");
    expect(Number(abiertos[0]!.cashOpening.toString())).toBe(60);
  });

  it("EN HOSTELERÍA el 409 de siempre: ahí el fondo lo declara una persona", async () => {
    vertical = { clinicalRecordsEnabled: false, residenciaEnabled: false };
    const appt = citaDeQuiropodia();
    const res = await checkoutAppointment(
      fakePrisma(),
      storeDe(appt),
      ctx,
      appt.id,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(409);
    expect(res.error).toBe("SHIFT_NOT_OPEN");
    // Y no se ha escrito ningún turno.
    expect(turnos).toHaveLength(0);
  });

  it("EN UNA RESIDENCIA tampoco, aunque tenga la clínica encendida", async () => {
    vertical = { clinicalRecordsEnabled: true, residenciaEnabled: true };
    const appt = citaDeQuiropodia();
    const res = await checkoutAppointment(
      fakePrisma(),
      storeDe(appt),
      ctx,
      appt.id,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("SHIFT_NOT_OPEN");
    expect(turnos).toHaveLength(0);
  });

  it("con turno abierto no se abre ninguno: el borrador va al que ya estaba", async () => {
    const yaAbierto = randomUUID();
    turnos.push({
      id: yaAbierto,
      registerId: REGISTER,
      userId: PODOLOGA,
      openedAt: new Date("2026-10-29T07:00:00.000Z"),
      closedAt: null,
      cashOpening: new Prisma.Decimal(0),
      cashCounted: null,
      openReason: "MANUAL",
      lastActivityAt: new Date("2026-10-29T07:00:00.000Z"),
    });
    const appt = citaDeQuiropodia();
    const res = await checkoutAppointment(
      fakePrisma(),
      storeDe(appt),
      ctx,
      appt.id,
    );
    expect(res.ok).toBe(true);
    expect(turnos).toHaveLength(1);
    expect([...ticketsCreados.values()][0]!.shiftId).toBe(yaAbierto);
  });
});
