// B3 §1. Emparejamiento de dispositivo:
//   - owner genera código (201)
//   - pair sin auth con código válido (201) → emite deviceToken
//   - pair con código caducado/consumido/desconocido → 404
//   - revoke device

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
process.env.PUBLIC_ADMIN_URL = "http://localhost:5173";

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakePairing {
  id: string;
  tenantId: string;
  registerId: string;
  code: string;
  createdByUserId: string;
  expiresAt: Date;
  consumedAt: Date | null;
  consumedByDeviceId: string | null;
}

interface FakeDevice {
  id: string;
  tenantId: string;
  registerId: string;
  name: string | null;
  deviceTokenHash: string;
  revokedAt: Date | null;
  userAgent: string | null;
  lastSeenAt: Date | null;
  lastKnownIpCountry: string | null;
  lastEmailAlertAt: Date | null;
  pairedAt: Date;
}

const registers = new Map<string, { id: string; tenantId: string; name: string; storeName: string }>();
const pairingCodes = new Map<string, FakePairing>();
const devices = new Map<string, FakeDevice>();

const fakePrisma = {
  register: {
    findFirst: vi.fn(async ({ where }: any) => {
      for (const r of registers.values()) {
        if (where.id && r.id !== where.id) continue;
        if (where.store?.tenantId && r.tenantId !== where.store.tenantId) continue;
        return r;
      }
      return null;
    }),
  },
  pairingCode: {
    findUnique: vi.fn(async ({ where }: any) => {
      const key = `${where.tenantId_code.tenantId}/${where.tenantId_code.code}`;
      return pairingCodes.get(key) ?? null;
    }),
    findMany: vi.fn(async ({ where }: any) => {
      const now = new Date();
      const out: FakePairing[] = [];
      for (const p of pairingCodes.values()) {
        if (where.code && p.code !== where.code) continue;
        if (where.consumedAt === null && p.consumedAt != null) continue;
        if (where.expiresAt?.gt && p.expiresAt <= where.expiresAt.gt) continue;
        if (where.tenantId && p.tenantId !== where.tenantId) continue;
        out.push(p);
      }
      // Resolver `select.register` mínimo si nos lo piden
      return out.map((p) => ({
        ...p,
        register: {
          id: p.registerId,
          name: registers.get(p.registerId)?.name ?? "?",
          store: { name: registers.get(p.registerId)?.storeName ?? "?" },
        },
      })) as any;
    }),
    create: vi.fn(async ({ data, select }: any) => {
      const id = `code-${pairingCodes.size + 1}`;
      const row: FakePairing = {
        id,
        tenantId: data.tenantId,
        registerId: data.registerId,
        code: data.code,
        createdByUserId: data.createdByUserId,
        expiresAt: data.expiresAt,
        consumedAt: null,
        consumedByDeviceId: null,
      };
      pairingCodes.set(`${data.tenantId}/${data.code}`, row);
      return select ? { code: row.code, expiresAt: row.expiresAt } : row;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      for (const p of pairingCodes.values()) {
        if (p.id === where.id) {
          if (data.consumedAt) p.consumedAt = data.consumedAt;
          if (data.consumedByDeviceId) p.consumedByDeviceId = data.consumedByDeviceId;
          return p;
        }
      }
      throw new Error("not found");
    }),
    // Claim atómico de v1.3-hotfix11 (single-use pairing code).
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const p of pairingCodes.values()) {
        if (where.id && p.id !== where.id) continue;
        if (where.consumedAt === null && p.consumedAt != null) continue;
        if (where.expiresAt?.gt && p.expiresAt <= where.expiresAt.gt) continue;
        if (data.consumedAt) p.consumedAt = data.consumedAt;
        count++;
      }
      return { count };
    }),
    delete: vi.fn(async ({ where }: any) => {
      const key = `${where.tenantId_code.tenantId}/${where.tenantId_code.code}`;
      pairingCodes.delete(key);
      return null;
    }),
  },
  device: {
    create: vi.fn(async ({ data, select }: any) => {
      const seq = (devices.size + 1).toString().padStart(12, "0");
      const id = data.id ?? `00000000-0000-0000-0000-${seq}`;
      const row: FakeDevice = {
        id,
        tenantId: data.tenantId,
        registerId: data.registerId,
        name: data.name ?? null,
        deviceTokenHash: data.deviceTokenHash,
        revokedAt: null,
        userAgent: data.userAgent ?? null,
        lastSeenAt: null,
        lastKnownIpCountry: null,
        lastEmailAlertAt: null,
        pairedAt: new Date(),
      };
      devices.set(id, row);
      return select ? { id: row.id } : row;
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      for (const d of devices.values()) {
        if (where.id && d.id !== where.id) continue;
        if (where.tenantId && d.tenantId !== where.tenantId) continue;
        return d;
      }
      return null;
    }),
    findMany: vi.fn(async () => []),
    update: vi.fn(async ({ where, data }: any) => {
      const d = devices.get(where.id);
      if (!d) throw new Error("not found");
      if (data.revokedAt) d.revokedAt = data.revokedAt;
      return d;
    }),
  },
  $transaction: vi.fn(async (fn: any) => fn(fakePrisma)),
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({}),
  shutdown: async () => undefined,
}));

vi.mock("../src/devices/alerts.js", () => ({
  evaluateDeviceAlert: async () => ({ alertSent: false }),
}));

const { registerDeviceRoutes } = await import("../src/devices/routes.js");
const { signAccessToken } = await import("../src/auth/tokens.js");

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const REGISTER_ID = "22222222-2222-2222-2222-222222222222";

function ownerBearer() {
  return `Bearer ${signAccessToken({ sub: OWNER_ID, tid: TENANT_ID, role: "OWNER" })}`;
}

beforeEach(() => {
  registers.clear();
  pairingCodes.clear();
  devices.clear();
  vi.clearAllMocks();
  registers.set(REGISTER_ID, {
    id: REGISTER_ID,
    tenantId: TENANT_ID,
    name: "Mostrador",
    storeName: "Tienda 1",
  });
});

async function buildApp() {
  const app = Fastify();
  await registerDeviceRoutes(app);
  return app;
}

describe("POST /admin/registers/:id/pairing-codes", () => {
  it("propietario genera código (201)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/admin/registers/${REGISTER_ID}/pairing-codes`,
      headers: { authorization: ownerBearer() },
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.code).toMatch(/^\d{6}$/);
    expect(body.expiresAt).toBeTruthy();
  });

  it("404 cuando register no pertenece al tenant", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/admin/registers/${"99999999-9999-9999-9999-999999999999"}/pairing-codes`,
      headers: { authorization: ownerBearer() },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /devices/pair", () => {
  it("pair con código válido → 201 + deviceToken plano", async () => {
    const app = await buildApp();
    const gen = await app.inject({
      method: "POST",
      url: `/admin/registers/${REGISTER_ID}/pairing-codes`,
      headers: { authorization: ownerBearer() },
      payload: {},
    });
    const code = gen.json().code as string;
    const res = await app.inject({
      method: "POST",
      url: "/devices/pair",
      payload: { code, deviceName: "iPad de bar" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.deviceToken).toBeTruthy();
    expect(body.registerName).toBe("Mostrador");
    expect(body.storeName).toBe("Tienda 1");
    // El código quedó consumido
    const used = Array.from(pairingCodes.values())[0]!;
    expect(used.consumedAt).not.toBeNull();
    expect(used.consumedByDeviceId).toBe(body.deviceId);
  });

  it("pair con código caducado → 404", async () => {
    const app = await buildApp();
    const gen = await app.inject({
      method: "POST",
      url: `/admin/registers/${REGISTER_ID}/pairing-codes`,
      headers: { authorization: ownerBearer() },
      payload: {},
    });
    const code = gen.json().code as string;
    // forzar caducidad
    const row = Array.from(pairingCodes.values())[0]!;
    row.expiresAt = new Date(Date.now() - 1000);
    const res = await app.inject({
      method: "POST",
      url: "/devices/pair",
      payload: { code },
    });
    expect(res.statusCode).toBe(404);
  });

  it("pair con código consumido → 404 al segundo intento", async () => {
    const app = await buildApp();
    const gen = await app.inject({
      method: "POST",
      url: `/admin/registers/${REGISTER_ID}/pairing-codes`,
      headers: { authorization: ownerBearer() },
      payload: {},
    });
    const code = gen.json().code as string;
    await app.inject({ method: "POST", url: "/devices/pair", payload: { code } });
    const second = await app.inject({
      method: "POST",
      url: "/devices/pair",
      payload: { code },
    });
    expect(second.statusCode).toBe(404);
  });

  it("pair con código inexistente → 404", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/devices/pair",
      payload: { code: "000000" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /admin/devices/:id/revoke", () => {
  it("marca revokedAt", async () => {
    const app = await buildApp();
    const gen = await app.inject({
      method: "POST",
      url: `/admin/registers/${REGISTER_ID}/pairing-codes`,
      headers: { authorization: ownerBearer() },
      payload: {},
    });
    const pair = await app.inject({
      method: "POST",
      url: "/devices/pair",
      payload: { code: gen.json().code },
    });
    const deviceId = pair.json().deviceId as string;
    const res = await app.inject({
      method: "POST",
      url: `/admin/devices/${deviceId}/revoke`,
      headers: { authorization: ownerBearer() },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(devices.get(deviceId)!.revokedAt).not.toBeNull();
  });
});
