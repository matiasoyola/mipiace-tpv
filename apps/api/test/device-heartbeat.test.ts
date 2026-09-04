// A5 · Frente 1 · lo que el servidor decide sobre el latido de un terminal.
//
// Dos cosas NO se las creemos al terminal, y aquí se prueba por qué:
//
//   - `outboxStuckSince`: el terminal sólo dice cuántos elementos tiene
//     pendientes. Desde cuándo los arrastra lo lleva el servidor, que es el que
//     no pierde la memoria cuando la app se reinicia.
//   - el desvío de reloj: se calcula contra la hora del servidor, y se acota,
//     porque un terminal con el reloj a 1970 tras quedarse sin batería es un
//     caso real en estos cacharros y no puede desbordar la columna.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DeviceStatusSchema,
  computeClockSkewSeconds,
  nextOutboxStuckSince,
  recordHeartbeat,
} from "../src/devices/heartbeat.js";

const DEVICE = randomUUID();

interface Row {
  outboxStuckSince: Date | null;
  [k: string]: unknown;
}

let row: Row | null;
const lastSeen: { at: Date | null } = { at: null };

const fakePrisma = {
  deviceHeartbeat: {
    findUnique: vi.fn(async () => row),
    upsert: vi.fn(async ({ create, update }: any) => {
      row = (row ? { ...row, ...update } : { ...create }) as Row;
      return row;
    }),
  },
  device: {
    update: vi.fn(async ({ data }: any) => {
      lastSeen.at = data.lastSeenAt;
      return {};
    }),
  },
} as any;

beforeEach(() => {
  row = null;
  lastSeen.at = null;
  vi.clearAllMocks();
});

describe("nextOutboxStuckSince", () => {
  const T1 = new Date("2026-09-04T10:00:00.000Z");
  const T2 = new Date("2026-09-04T13:00:00.000Z");

  it("cola vacía → no hay atasco", () => {
    expect(nextOutboxStuckSince(0, null, T1)).toBeNull();
  });

  it("cola vacía OLVIDA el atasco anterior: ya subió todo", () => {
    expect(nextOutboxStuckSince(0, T1, T2)).toBeNull();
  });

  it("primer latido con cola → el atasco empieza ahora", () => {
    expect(nextOutboxStuckSince(2, null, T1)).toEqual(T1);
  });

  it("cola que sigue llena CONSERVA el instante original", () => {
    // Ésta es la razón de que exista la columna: si se pisara en cada latido,
    // el panel diría siempre «atascada hace 30 s» y no habría forma de saber
    // que ese terminal lleva desde las diez de la mañana sin subir nada.
    expect(nextOutboxStuckSince(5, T1, T2)).toEqual(T1);
  });
});

describe("computeClockSkewSeconds", () => {
  const AHORA = new Date("2026-09-04T12:00:00.000Z");

  it("sin hora del terminal, no hay desvío que calcular", () => {
    expect(computeClockSkewSeconds(undefined, AHORA)).toBeNull();
  });

  it("terminal adelantado 90 s → +90", () => {
    expect(
      computeClockSkewSeconds("2026-09-04T12:01:30.000Z", AHORA),
    ).toBe(90);
  });

  it("terminal atrasado 5 min → -300", () => {
    expect(computeClockSkewSeconds("2026-09-04T11:55:00.000Z", AHORA)).toBe(-300);
  });

  it("reloj a 1970 (terminal sin batería) se acota y no desborda el INTEGER", () => {
    const skew = computeClockSkewSeconds("1970-01-01T00:00:00.000Z", AHORA)!;
    expect(skew).toBeLessThan(0);
    expect(Math.abs(skew)).toBeLessThanOrEqual(2_147_483_647);
  });
});

describe("DeviceStatusSchema", () => {
  it("acepta un latido vacío: un terminal siempre puede anunciarse", () => {
    expect(DeviceStatusSchema.safeParse({}).success).toBe(true);
  });

  it("rechaza un campo desconocido en vez de tragárselo", () => {
    // `.strict()`: una errata en el nombre de un campo tiene que verse, no
    // guardarse en silencio como si el terminal no lo hubiera mandado.
    expect(DeviceStatusSchema.safeParse({ outbox_pending: 3 }).success).toBe(false);
  });

  it("rechaza tipos que no son", () => {
    expect(DeviceStatusSchema.safeParse({ outboxPending: "tres" }).success).toBe(
      false,
    );
  });
});

describe("recordHeartbeat", () => {
  it("arrastra el atasco entre latidos y lo borra al vaciarse la cola", async () => {
    const t1 = new Date("2026-09-04T10:00:00.000Z");
    const t2 = new Date("2026-09-04T13:00:00.000Z");
    const t3 = new Date("2026-09-04T13:30:00.000Z");

    await recordHeartbeat({
      prisma: fakePrisma,
      deviceId: DEVICE,
      status: { outboxPending: 4 },
      now: t1,
    });
    expect(row!.outboxStuckSince).toEqual(t1);

    await recordHeartbeat({
      prisma: fakePrisma,
      deviceId: DEVICE,
      status: { outboxPending: 4 },
      now: t2,
    });
    expect(row!.outboxStuckSince, "3 h después sigue siendo el mismo atasco").toEqual(
      t1,
    );

    await recordHeartbeat({
      prisma: fakePrisma,
      deviceId: DEVICE,
      status: { outboxPending: 0 },
      now: t3,
    });
    expect(row!.outboxStuckSince).toBeNull();
  });

  it("toca lastSeenAt con la hora del servidor, no con la del terminal", async () => {
    const ahora = new Date("2026-09-04T12:00:00.000Z");
    await recordHeartbeat({
      prisma: fakePrisma,
      deviceId: DEVICE,
      status: { deviceTime: "2026-09-04T09:00:00.000Z" },
      now: ahora,
    });
    expect(lastSeen.at).toEqual(ahora);
    expect(row!.clockSkewSeconds).toBe(-3 * 3600);
  });
});
