// v1.10-offline-un-terminal §1. Paquete offline de autenticación:
// GET /shift/offline-bundle devuelve roster (con pinHash) + config +
// shiftState a un device ya bootstrapeado. Mockea Prisma en memoria.

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeUser {
  id: string;
  tenantId: string;
  email: string;
  alias: string | null;
  pinHash: string | null;
  role: "OWNER" | "MANAGER" | "CASHIER";
}

const users = new Map<string, FakeUser>();
const devices = new Map<
  string,
  { id: string; tenantId: string; registerId: string; deviceTokenHash: string; revokedAt: Date | null }
>();
const shifts: Array<{
  id: string;
  registerId: string;
  openedAt: Date;
  closedAt: Date | null;
  lastActivityAt: Date;
  cashOpening: { toString(): string };
  userId: string;
}> = [];

const fakePrisma = {
  tenant: {
    findUniqueOrThrow: vi.fn(async () => ({
      cashierSessionTtlMinutes: 720,
      cashierAutoLogoutMinutes: 10,
    })),
  },
  user: {
    findMany: vi.fn(async ({ where }: any) => {
      const out: FakeUser[] = [];
      for (const u of users.values()) {
        if (where.tenantId && u.tenantId !== where.tenantId) continue;
        if (where.role?.in && !where.role.in.includes(u.role)) continue;
        // where.pinHash.not === null → sólo con pinHash
        if (where.pinHash && where.pinHash.not === null && u.pinHash == null) continue;
        out.push(u);
      }
      return out;
    }),
  },
  device: {
    findUnique: vi.fn(async ({ where }: { where: { deviceTokenHash: string } }) => {
      for (const d of devices.values()) {
        if (d.deviceTokenHash === where.deviceTokenHash) return d;
      }
      return null;
    }),
  },
  shift: {
    findFirst: vi.fn(async ({ where }: any) => {
      const matching = shifts
        .filter((s) => s.registerId === where.registerId)
        .sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
      return matching[0] ?? null;
    }),
  },
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({}),
  shutdown: async () => undefined,
}));

const { registerCashierAuthRoutes } = await import("../src/shift/cashier-auth.js");
const { hashPassword } = await import("../src/auth/passwords.js");
const { hashDeviceToken } = await import("../src/devices/auth.js");

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const REGISTER_ID = "00000000-0000-0000-0000-0000000000aa";
const DEVICE_ID = "00000000-0000-0000-0000-0000000000bb";
const DEVICE_TOKEN = "tok_" + randomBytes(24).toString("base64url");

beforeEach(async () => {
  users.clear();
  devices.clear();
  shifts.length = 0;
  vi.clearAllMocks();
  users.set("u-owner", {
    id: "u-owner",
    tenantId: TENANT_ID,
    email: "owner@test.com",
    alias: "Dueña",
    pinHash: await hashPassword("4242"),
    role: "OWNER",
  });
  users.set("u-cashier", {
    id: "u-cashier",
    tenantId: TENANT_ID,
    email: "lucia@test.com",
    alias: null,
    pinHash: await hashPassword("1234"),
    role: "CASHIER",
  });
  // Sin PIN: no debe aparecer en el roster.
  users.set("u-nopin", {
    id: "u-nopin",
    tenantId: TENANT_ID,
    email: "nopin@test.com",
    alias: null,
    pinHash: null,
    role: "CASHIER",
  });
  devices.set(DEVICE_ID, {
    id: DEVICE_ID,
    tenantId: TENANT_ID,
    registerId: REGISTER_ID,
    deviceTokenHash: hashDeviceToken(DEVICE_TOKEN),
    revokedAt: null,
  });
});

async function buildApp() {
  const app = Fastify();
  await registerCashierAuthRoutes(app);
  return app;
}

describe("GET /shift/offline-bundle", () => {
  it("device válido → roster (con pinHash) + config + shiftState", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/shift/offline-bundle",
      headers: { "x-device-token": DEVICE_TOKEN },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.registerId).toBe(REGISTER_ID);
    expect(body.config.cashierSessionTtlMinutes).toBe(720);
    expect(body.config.cashierAutoLogoutMinutes).toBe(10);
    // Sólo los 2 con pinHash; el sin PIN queda fuera.
    expect(body.roster).toHaveLength(2);
    for (const r of body.roster) {
      expect(typeof r.pinHash).toBe("string");
      expect(r.pinHash.startsWith("$argon2")).toBe(true);
    }
    expect(body.shiftState.kind).toBe("needsShiftOpen");
  });

  it("shiftState refleja un turno abierto hoy → reanudar", async () => {
    shifts.push({
      id: "shift-1",
      registerId: REGISTER_ID,
      openedAt: new Date(),
      closedAt: null,
      lastActivityAt: new Date(),
      cashOpening: { toString: () => "100" },
      userId: "u-cashier",
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/shift/offline-bundle",
      headers: { "x-device-token": DEVICE_TOKEN },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().shiftState.kind).toBe("reanudar");
  });

  it("falta X-Device-Token → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/shift/offline-bundle" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("DEVICE_TOKEN_REQUIRED");
  });

  it("device revocado → 401 DEVICE_REVOKED", async () => {
    devices.get(DEVICE_ID)!.revokedAt = new Date();
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/shift/offline-bundle",
      headers: { "x-device-token": DEVICE_TOKEN },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("DEVICE_REVOKED");
  });
});
