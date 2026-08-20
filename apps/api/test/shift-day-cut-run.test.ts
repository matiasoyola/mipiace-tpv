// v1.11-cierre-de-dia · la pasada del corte de día y el rescate de las
// ventas que llegan tarde, contra un prisma falso.
//
// Cubre los dos criterios de "funciona" que no son de UI:
//   - a la hora de corte, el turno de ayer aparece cerrado solo, con su Z;
//   - un terminal que estuvo offline no pierde ventas ni duplica el cierre.

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
process.env.Z_REPORT_STORAGE_ROOT = "/tmp/z-reports-test-v1-11";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { runShiftDayCut } from "../src/shift/day-cut-run.js";
import { resolveShiftForSale } from "../src/shift/impute.js";

const REGISTER = "reg-1";

interface FakeShiftRow {
  id: string;
  registerId: string;
  userId: string;
  openedAt: Date;
  closedAt: Date | null;
  closeReason: "MANUAL" | "AUTO_DAY_CUT";
  cashOpening: { toString: () => string };
  cashCounted?: unknown;
  closedByUserId?: string | null;
  zReportPdfPath?: string | null;
  zReportStale?: boolean;
  summaryAckAt?: Date | null;
  register: {
    id: string;
    name: string;
    store: {
      id: string;
      name: string;
      tenantId: string;
      tenant: { id: string; dayCutHour: number };
    };
  };
}

function decimal(n: number) {
  return { toString: () => String(n), valueOf: () => n };
}

function makeShift(over: Partial<FakeShiftRow> & { id: string; openedAt: Date }): FakeShiftRow {
  return {
    registerId: REGISTER,
    userId: "user-1",
    closedAt: null,
    closeReason: "MANUAL",
    cashOpening: decimal(50),
    register: {
      id: REGISTER,
      name: "Caja 1",
      store: {
        id: "store-1",
        name: "Peluquería Sole",
        tenantId: "tenant-1",
        tenant: { id: "tenant-1", dayCutHour: 5 },
      },
    },
    ...over,
  };
}

// Prisma falso mínimo: sólo lo que tocan `runShiftDayCut` y
// `resolveShiftForSale`. Guardamos los updates para asertar sobre ellos.
function fakePrisma(shifts: FakeShiftRow[]) {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  return {
    updates,
    shifts,
    client: {
      shift: {
        findMany: vi.fn(async (args?: { where?: Record<string, unknown> }) => {
          const where = args?.where ?? {};
          return shifts.filter((s) => {
            if ("closedAt" in where && where.closedAt === null && s.closedAt !== null) {
              return false;
            }
            if (where.registerId && s.registerId !== where.registerId) return false;
            const openedAt = where.openedAt as { gte?: Date } | undefined;
            if (openedAt?.gte && s.openedAt.getTime() < openedAt.gte.getTime()) {
              return false;
            }
            return true;
          });
        }),
        findFirst: vi.fn(async (args?: { where?: Record<string, unknown> }) => {
          const where = args?.where ?? {};
          return (
            shifts.find((s) => {
              if (where.id && s.id !== where.id) return false;
              if (where.registerId && s.registerId !== where.registerId) return false;
              if ("closedAt" in where && where.closedAt === null && s.closedAt !== null) {
                return false;
              }
              return true;
            }) ?? null
          );
        }),
        update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          updates.push({ id: args.where.id, data: args.data });
          const s = shifts.find((x) => x.id === args.where.id);
          if (s) Object.assign(s, args.data);
          return s;
        }),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      ticket: {
        count: vi.fn(async () => 12),
        groupBy: vi.fn(async () => []),
        aggregate: vi.fn(async () => ({ _count: { _all: 0 }, _sum: { total: null } })),
      },
      refund: {
        count: vi.fn(async () => 0),
        groupBy: vi.fn(async () => []),
      },
      ticketPayment: {
        groupBy: vi.fn(async (args: { where: Record<string, unknown> }) => {
          // Ventas del turno: 120 € en efectivo, 300 € en tarjeta. La otra
          // query (cobros de deuda, v1.8-Fiado) no devuelve nada.
          if ("ticket" in args.where) {
            return [
              { method: "CASH", _sum: { amount: 120 } },
              { method: "CARD", _sum: { amount: 300 } },
            ];
          }
          return [];
        }),
      },
      user: {
        findUnique: vi.fn(async () => ({ email: "sole@example.com", alias: "Sole" })),
        findUniqueOrThrow: vi.fn(async () => ({
          email: "sole@example.com",
          alias: "Sole",
        })),
      },
    },
  };
}

const log = { info: vi.fn(), error: vi.fn() };

beforeEach(() => {
  log.info.mockClear();
  log.error.mockClear();
});

describe("runShiftDayCut · el turno de ayer se cierra solo", () => {
  it("cierra el turno que cruzó el corte y deja cashCounted en NULL", async () => {
    const ayer = makeShift({
      id: "ayer",
      openedAt: new Date("2026-08-10T07:00:00.000Z"),
    });
    const db = fakePrisma([ayer]);
    const now = new Date("2026-08-11T03:00:30.000Z"); // 05:00:30 local

    const res = await runShiftDayCut({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: db.client as any,
      log,
      now,
    });

    expect(res.closed).toHaveLength(1);
    expect(res.failed).toBe(0);
    const update = db.updates.find((u) => u.id === "ayer");
    expect(update?.data.closeReason).toBe("AUTO_DAY_CUT");
    expect(update?.data.closedAt).toEqual(now);
    // Nadie contó: el descuadre es DESCONOCIDO, no cero.
    expect(update?.data.cashCounted).toBeUndefined();
    // Sin persona que cierre — el Z lo dice, no se le atribuye a nadie.
    expect(update?.data.closedByUserId).toBeNull();
    // El resumen queda pendiente de enseñarse por la mañana.
    expect(update?.data.summaryAckAt).toBeNull();
    // Y el teórico sale del desglose real: 50 de fondo + 120 en efectivo.
    expect(res.closed[0]!.cashTheoretical).toBe(170);
    expect(res.closed[0]!.netSales).toBe(420);
  });

  it("no toca el turno abierto DESPUÉS del corte de hoy", async () => {
    const hoy = makeShift({
      id: "hoy",
      openedAt: new Date("2026-08-11T04:00:00.000Z"), // 06:00 local
    });
    const db = fakePrisma([hoy]);
    const res = await runShiftDayCut({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: db.client as any,
      log,
      now: new Date("2026-08-11T09:00:00.000Z"),
    });
    expect(res.closed).toHaveLength(0);
    expect(db.updates).toHaveLength(0);
  });

  it("un turno que falla no impide cerrar los demás", async () => {
    const roto = makeShift({
      id: "roto",
      openedAt: new Date("2026-08-10T07:00:00.000Z"),
    });
    const bueno = makeShift({
      id: "bueno",
      openedAt: new Date("2026-08-10T08:00:00.000Z"),
    });
    const db = fakePrisma([roto, bueno]);
    db.client.shift.update.mockImplementationOnce(async () => {
      throw new Error("deadlock");
    });
    const res = await runShiftDayCut({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: db.client as any,
      log,
      now: new Date("2026-08-11T03:00:30.000Z"),
    });
    expect(res.failed).toBe(1);
    expect(res.closed).toHaveLength(1);
    expect(res.closed[0]!.shiftId).toBe("bueno");
  });
});

describe("resolveShiftForSale · el outbox de un terminal que estuvo offline", () => {
  const ayerCerrado = () =>
    makeShift({
      id: "ayer",
      openedAt: new Date("2026-08-10T07:00:00.000Z"),
      closedAt: new Date("2026-08-11T03:00:00.000Z"),
      closeReason: "AUTO_DAY_CUT",
    });

  it("camino normal: turno abierto → mismo shiftId, sin imputar", async () => {
    const abierto = makeShift({ id: "hoy", openedAt: new Date("2026-08-11T07:00:00.000Z") });
    const db = fakePrisma([abierto]);
    const res = await resolveShiftForSale({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: db.client as any,
      registerId: REGISTER,
      requestedShiftId: "hoy",
      occurredAt: new Date("2026-08-11T10:00:00.000Z"),
    });
    expect(res).toEqual({ ok: true, shiftId: "hoy", imputed: false, stale: false });
  });

  it("venta de anoche sobre un turno auto-cerrado → va al turno de anoche y marca el Z desfasado", async () => {
    const db = fakePrisma([ayerCerrado()]);
    const res = await resolveShiftForSale({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: db.client as any,
      registerId: REGISTER,
      requestedShiftId: "ayer",
      occurredAt: new Date("2026-08-10T21:40:00.000Z"),
    });
    expect(res).toEqual({ ok: true, shiftId: "ayer", imputed: false, stale: true });
  });

  it("venta POSTERIOR al corte → al turno abierto ahora, no al cerrado", async () => {
    const hoy = makeShift({ id: "hoy", openedAt: new Date("2026-08-11T07:00:00.000Z") });
    const db = fakePrisma([ayerCerrado(), hoy]);
    const res = await resolveShiftForSale({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: db.client as any,
      registerId: REGISTER,
      requestedShiftId: "ayer",
      occurredAt: new Date("2026-08-11T09:00:00.000Z"),
    });
    expect(res).toEqual({ ok: true, shiftId: "hoy", imputed: true, stale: false });
  });

  it("sin occurredAt (cliente viejo) y sin turno abierto → se acepta en el auto-cerrado antes que perderla", async () => {
    const db = fakePrisma([ayerCerrado()]);
    const res = await resolveShiftForSale({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: db.client as any,
      registerId: REGISTER,
      requestedShiftId: "ayer",
      occurredAt: null,
    });
    expect(res).toEqual({ ok: true, shiftId: "ayer", imputed: false, stale: true });
  });

  it("un cierre MANUAL mantiene el 409 de siempre", async () => {
    const manual = makeShift({
      id: "manual",
      openedAt: new Date("2026-08-10T07:00:00.000Z"),
      closedAt: new Date("2026-08-10T20:00:00.000Z"),
      closeReason: "MANUAL",
    });
    const db = fakePrisma([manual]);
    const res = await resolveShiftForSale({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: db.client as any,
      registerId: REGISTER,
      requestedShiftId: "manual",
      occurredAt: new Date("2026-08-11T09:00:00.000Z"),
    });
    expect(res).toEqual({ ok: false, error: "SHIFT_NOT_OPEN" });
  });

  it("turno inexistente → SHIFT_NOT_FOUND", async () => {
    const db = fakePrisma([]);
    const res = await resolveShiftForSale({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: db.client as any,
      registerId: REGISTER,
      requestedShiftId: "fantasma",
      occurredAt: null,
    });
    expect(res).toEqual({ ok: false, error: "SHIFT_NOT_FOUND" });
  });
});
