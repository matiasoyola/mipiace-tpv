// v1.4-Bugs-Operativos Lote 2 · super-admin impersonando en modo full
// debe poder crear una PrinterConfig — sin esto, Matías no puede
// configurar el panel del cliente desde la consola super-admin sin
// pedirle credenciales.
//
// Verifica: handleImpersonationMutation deja pasar el POST cuando el
// JWT impersonation lleva mode=full y rechaza con IMPERSONATION_READONLY
// cuando mode=readonly. Mock superAdminAudit.create para que el audit
// no falle.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
process.env.SUPER_ADMIN_JWT_SECRET = "s".repeat(40);

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "00000000-0000-0000-0000-000000000001";
const REGISTER = "11111111-1111-1111-1111-111111111111";
const OWNER_USER = "00000000-0000-0000-0000-0000000000aa";
const SUPER_ADMIN = "00000000-0000-0000-0000-0000000000ff";

interface FakePrinter {
  id: string;
  registerId: string;
  name: string;
  mode: "USB" | "WIFI";
  ipAddress: string | null;
  port: number | null;
  timeoutMs: number;
  section: "BARRA" | "COCINA" | "SALON" | null;
  active: boolean;
}

const state = {
  printers: new Map<string, FakePrinter>(),
  audits: [] as Array<{ action: string; tenantId: string | null }>,
};

const fakePrisma = {
  register: {
    findFirst: vi.fn(async ({ where }: any) => {
      if (where.id !== REGISTER) return null;
      if (where.store?.tenantId && where.store.tenantId !== TENANT) return null;
      return { id: REGISTER };
    }),
  },
  printerConfig: {
    findMany: vi.fn(async () => [...state.printers.values()]),
    findFirst: vi.fn(async ({ where }: any) => state.printers.get(where.id) ?? null),
    create: vi.fn(async ({ data }: any) => {
      const id =
        "aaaaaaaa-aaaa-aaaa-aaaa-" +
        String(state.printers.size + 1).padStart(12, "0");
      const p: FakePrinter = {
        id,
        registerId: data.registerId,
        name: data.name,
        mode: data.mode,
        ipAddress: data.ipAddress ?? null,
        port: data.port ?? null,
        timeoutMs: data.timeoutMs ?? 5000,
        section: data.section ?? null,
        active: data.active ?? true,
      };
      state.printers.set(id, p);
      return p;
    }),
  },
  superAdminAudit: {
    create: vi.fn(async ({ data }: any) => {
      state.audits.push({
        action: data.action,
        tenantId: data.tenantId ?? null,
      });
      return { id: randomUUID(), ...data, createdAt: new Date() };
    }),
  },
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({}) as never,
  shutdown: async () => undefined,
}));

const { registerAdminPrinterConfigsRoutes } = await import(
  "../src/admin/printer-configs.js"
);
const { signImpersonationToken } = await import(
  "../src/superadmin/tokens.js"
);

function impToken(mode: "full" | "readonly") {
  return `Bearer ${signImpersonationToken({
    sub: OWNER_USER,
    tid: TENANT,
    tv: 0,
    by: SUPER_ADMIN,
    mode,
  })}`;
}

async function buildApp() {
  const app = Fastify();
  await registerAdminPrinterConfigsRoutes(app);
  return app;
}

beforeEach(() => {
  state.printers.clear();
  state.audits = [];
  vi.clearAllMocks();
});

describe("Impersonation · POST /admin/printer-configs", () => {
  it("mode=full crea PrinterConfig + registra audit impersonate_write", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/printer-configs",
      headers: { authorization: impToken("full") },
      payload: {
        registerId: REGISTER,
        name: "Ticket caja (super-admin)",
        mode: "USB",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().printerConfig.name).toBe("Ticket caja (super-admin)");
    // El middleware escribió exactamente un audit por la mutación.
    const writes = state.audits.filter((a) => a.action === "impersonate_write");
    expect(writes).toHaveLength(1);
    expect(writes[0]!.tenantId).toBe(TENANT);
  });

  it("mode=readonly rechaza con IMPERSONATION_READONLY (sin audit ni create)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/printer-configs",
      headers: { authorization: impToken("readonly") },
      payload: {
        registerId: REGISTER,
        name: "Ticket caja",
        mode: "USB",
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("IMPERSONATION_READONLY");
    expect(state.printers.size).toBe(0);
    expect(state.audits.filter((a) => a.action === "impersonate_write")).toHaveLength(0);
  });

  it("mode=full lista PrinterConfigs sin tocar audit (GET no muta)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/admin/printer-configs",
      headers: { authorization: impToken("full") },
    });
    expect(res.statusCode).toBe(200);
    expect(state.audits.filter((a) => a.action === "impersonate_write")).toHaveLength(0);
  });
});
