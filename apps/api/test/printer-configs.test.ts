// v1.4-Impresoras-Fase-1 Lote 1 · CRUD admin de PrinterConfig.
//
// Cobertura: POST + PATCH felices, validación IP en WIFI, aislamiento
// por tenant, soft-delete con DELETE, 404 para register de otro tenant.

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "00000000-0000-0000-0000-000000000001";
const OTHER_TENANT = "00000000-0000-0000-0000-000000000002";
const OWNER_ID = "00000000-0000-0000-0000-0000000000aa";
const MANAGER_ID = "00000000-0000-0000-0000-0000000000bb";

const REGISTER_MINE = "11111111-1111-1111-1111-111111111111";
const REGISTER_OTHER = "11111111-1111-1111-1111-222222222222";

interface FakeRegister {
  id: string;
  tenantId: string;
}
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
  lastPrintOkAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorMsg: string | null;
  createdAt: Date;
}

const state = {
  registers: new Map<string, FakeRegister>(),
  printers: new Map<string, FakePrinter>(),
};

function registerMatchesTenant(
  r: FakeRegister,
  tenantFilter: string | undefined,
): boolean {
  if (!tenantFilter) return true;
  return r.tenantId === tenantFilter;
}

const fakePrisma = {
  register: {
    findFirst: vi.fn(async ({ where }: any) => {
      const r = state.registers.get(where.id);
      if (!r) return null;
      if (!registerMatchesTenant(r, where.store?.tenantId)) return null;
      return { id: r.id };
    }),
  },
  printerConfig: {
    findMany: vi.fn(async ({ where }: any) => {
      const out: FakePrinter[] = [];
      for (const p of state.printers.values()) {
        const reg = state.registers.get(p.registerId);
        if (!reg) continue;
        if (
          where.register?.store?.tenantId &&
          reg.tenantId !== where.register.store.tenantId
        )
          continue;
        if (where.registerId && p.registerId !== where.registerId) continue;
        out.push(p);
      }
      return out;
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      const p = state.printers.get(where.id);
      if (!p) return null;
      const reg = state.registers.get(p.registerId);
      if (!reg) return null;
      if (
        where.register?.store?.tenantId &&
        reg.tenantId !== where.register.store.tenantId
      )
        return null;
      return p;
    }),
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
        lastPrintOkAt: null,
        lastErrorAt: null,
        lastErrorMsg: null,
        createdAt: new Date(),
      };
      state.printers.set(id, p);
      return p;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const p = state.printers.get(where.id);
      if (!p) throw new Error("not found");
      for (const k of [
        "name",
        "mode",
        "ipAddress",
        "port",
        "timeoutMs",
        "section",
        "active",
        "lastPrintOkAt",
        "lastErrorAt",
        "lastErrorMsg",
      ] as const) {
        if (data[k] !== undefined) (p as any)[k] = data[k];
      }
      return p;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const p of state.printers.values()) {
        if (where.id && p.id !== where.id) continue;
        const reg = state.registers.get(p.registerId);
        if (!reg) continue;
        if (
          where.register?.store?.tenantId &&
          reg.tenantId !== where.register.store.tenantId
        )
          continue;
        for (const k of ["active"] as const) {
          if (data[k] !== undefined) (p as any)[k] = data[k];
        }
        count++;
      }
      return { count };
    }),
    deleteMany: vi.fn(async ({ where }: any) => {
      let count = 0;
      for (const [id, p] of [...state.printers]) {
        if (where.id && p.id !== where.id) continue;
        const reg = state.registers.get(p.registerId);
        if (!reg) continue;
        if (
          where.register?.store?.tenantId &&
          reg.tenantId !== where.register.store.tenantId
        )
          continue;
        state.printers.delete(id);
        count++;
      }
      return { count };
    }),
  },
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({}),
  shutdown: async () => undefined,
}));

const { registerAdminPrinterConfigsRoutes } = await import(
  "../src/admin/printer-configs.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");

function ownerToken() {
  return `Bearer ${signAccessToken({ sub: OWNER_ID, tid: TENANT, role: "OWNER" })}`;
}
function managerToken() {
  return `Bearer ${signAccessToken({ sub: MANAGER_ID, tid: TENANT, role: "MANAGER" })}`;
}

async function buildApp() {
  const app = Fastify();
  await registerAdminPrinterConfigsRoutes(app);
  return app;
}

beforeEach(() => {
  state.registers.clear();
  state.printers.clear();
  state.registers.set(REGISTER_MINE, {
    id: REGISTER_MINE,
    tenantId: TENANT,
  });
  state.registers.set(REGISTER_OTHER, {
    id: REGISTER_OTHER,
    tenantId: OTHER_TENANT,
  });
  vi.clearAllMocks();
});

describe("POST /admin/printer-configs", () => {
  it("OWNER puede crear una impresora USB sin sección", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/printer-configs",
      headers: { authorization: ownerToken() },
      payload: {
        registerId: REGISTER_MINE,
        name: "Ticket caja",
        mode: "USB",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.printerConfig.name).toBe("Ticket caja");
    expect(body.printerConfig.mode).toBe("USB");
    expect(body.printerConfig.ipAddress).toBeNull();
    expect(body.printerConfig.section).toBeNull();
    expect(body.printerConfig.active).toBe(true);
  });

  it("MANAGER también puede crear (operativa del local)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/printer-configs",
      headers: { authorization: managerToken() },
      payload: {
        registerId: REGISTER_MINE,
        name: "Comanda BARRA",
        mode: "WIFI",
        ipAddress: "192.168.1.50",
        port: 9100,
        section: "BARRA",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.printerConfig.mode).toBe("WIFI");
    expect(body.printerConfig.ipAddress).toBe("192.168.1.50");
    expect(body.printerConfig.section).toBe("BARRA");
  });

  it("WIFI sin IP → 400 INVALID_IP", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/printer-configs",
      headers: { authorization: ownerToken() },
      payload: {
        registerId: REGISTER_MINE,
        name: "Barra",
        mode: "WIFI",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_IP");
  });

  it("WIFI con IP malformada → 400 INVALID_IP", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/printer-configs",
      headers: { authorization: ownerToken() },
      payload: {
        registerId: REGISTER_MINE,
        name: "Barra",
        mode: "WIFI",
        ipAddress: "no-es-una-ip",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_IP");
  });

  it("register de otro tenant → 404 sin filtrar info", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/printer-configs",
      headers: { authorization: ownerToken() },
      payload: {
        registerId: REGISTER_OTHER,
        name: "x",
        mode: "USB",
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("REGISTER_NOT_FOUND");
  });
});

describe("PATCH /admin/printer-configs/:id", () => {
  it("OWNER actualiza nombre y section", async () => {
    const id = "aaaaaaaa-aaaa-aaaa-aaaa-000000000001";
    state.printers.set(id, {
      id,
      registerId: REGISTER_MINE,
      name: "viejo",
      mode: "USB",
      ipAddress: null,
      port: null,
      timeoutMs: 5000,
      section: null,
      active: true,
      lastPrintOkAt: null,
      lastErrorAt: null,
      lastErrorMsg: null,
      createdAt: new Date(),
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/admin/printer-configs/${id}`,
      headers: { authorization: ownerToken() },
      payload: { name: "Ticket caja", section: "BARRA" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().printerConfig.name).toBe("Ticket caja");
    expect(res.json().printerConfig.section).toBe("BARRA");
  });

  it("PATCH cambia USB→WIFI exige IP válida", async () => {
    const id = "aaaaaaaa-aaaa-aaaa-aaaa-000000000002";
    state.printers.set(id, {
      id,
      registerId: REGISTER_MINE,
      name: "x",
      mode: "USB",
      ipAddress: null,
      port: null,
      timeoutMs: 5000,
      section: null,
      active: true,
      lastPrintOkAt: null,
      lastErrorAt: null,
      lastErrorMsg: null,
      createdAt: new Date(),
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/admin/printer-configs/${id}`,
      headers: { authorization: ownerToken() },
      payload: { mode: "WIFI" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_IP");
  });

  it("PATCH impresora de otro tenant → 404", async () => {
    const id = "aaaaaaaa-aaaa-aaaa-aaaa-000000000003";
    state.printers.set(id, {
      id,
      registerId: REGISTER_OTHER,
      name: "x",
      mode: "USB",
      ipAddress: null,
      port: null,
      timeoutMs: 5000,
      section: null,
      active: true,
      lastPrintOkAt: null,
      lastErrorAt: null,
      lastErrorMsg: null,
      createdAt: new Date(),
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/admin/printer-configs/${id}`,
      headers: { authorization: ownerToken() },
      payload: { name: "x" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /admin/printer-configs/:id", () => {
  // v1.0-pilotos · Lote 5 (#19): el DELETE ahora borra la fila de
  // verdad. El soft-delete dejaba residuos que hacían "reaparecer" la
  // impresora en el admin y ensuciaban la re-alta.
  it("DELETE elimina la fila de BD (borrado real)", async () => {
    const id = "aaaaaaaa-aaaa-aaaa-aaaa-000000000004";
    state.printers.set(id, {
      id,
      registerId: REGISTER_MINE,
      name: "x",
      mode: "USB",
      ipAddress: null,
      port: null,
      timeoutMs: 5000,
      section: null,
      active: true,
      lastPrintOkAt: null,
      lastErrorAt: null,
      lastErrorMsg: null,
      createdAt: new Date(),
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/admin/printer-configs/${id}`,
      headers: { authorization: ownerToken() },
    });
    expect(res.statusCode).toBe(200);
    expect(state.printers.has(id)).toBe(false);
  });

  it("DELETE de impresora de otro tenant → 404 y no borra", async () => {
    const id = "aaaaaaaa-aaaa-aaaa-aaaa-000000000005";
    state.printers.set(id, {
      id,
      registerId: REGISTER_OTHER,
      name: "ajena",
      mode: "USB",
      ipAddress: null,
      port: null,
      timeoutMs: 5000,
      section: null,
      active: true,
      lastPrintOkAt: null,
      lastErrorAt: null,
      lastErrorMsg: null,
      createdAt: new Date(),
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/admin/printer-configs/${id}`,
      headers: { authorization: ownerToken() },
    });
    expect(res.statusCode).toBe(404);
    expect(state.printers.has(id)).toBe(true);
  });

  it("ciclo alta → borrado → re-alta limpia del mismo dispositivo", async () => {
    const app = await buildApp();
    const create1 = await app.inject({
      method: "POST",
      url: "/admin/printer-configs",
      headers: { authorization: ownerToken() },
      payload: { registerId: REGISTER_MINE, name: "POS-80 caja", mode: "USB" },
    });
    expect(create1.statusCode).toBe(201);
    const firstId = create1.json().printerConfig.id;

    const del = await app.inject({
      method: "DELETE",
      url: `/admin/printer-configs/${firstId}`,
      headers: { authorization: ownerToken() },
    });
    expect(del.statusCode).toBe(200);

    // Sin residuos: el listado queda vacío tras el borrado.
    const listAfterDelete = await app.inject({
      method: "GET",
      url: `/admin/printer-configs?registerId=${REGISTER_MINE}`,
      headers: { authorization: ownerToken() },
    });
    expect(listAfterDelete.json().items).toHaveLength(0);

    // Re-alta del MISMO dispositivo (mismo nombre/modo) → 201 y el
    // listado muestra exactamente una impresora.
    const create2 = await app.inject({
      method: "POST",
      url: "/admin/printer-configs",
      headers: { authorization: ownerToken() },
      payload: { registerId: REGISTER_MINE, name: "POS-80 caja", mode: "USB" },
    });
    expect(create2.statusCode).toBe(201);

    const finalList = await app.inject({
      method: "GET",
      url: `/admin/printer-configs?registerId=${REGISTER_MINE}`,
      headers: { authorization: ownerToken() },
    });
    expect(finalList.json().items).toHaveLength(1);
    expect(finalList.json().items[0].name).toBe("POS-80 caja");
  });
});
