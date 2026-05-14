// Tests de GET/PATCH /admin/stores/:storeId/ticket-delivery
// (B-Print fase 1 · Frente 6).

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
const STORE = "00000000-0000-0000-0000-000000000002";
const OWNER = "00000000-0000-0000-0000-0000000000aa";
const MANAGER = "00000000-0000-0000-0000-0000000000bb";

interface FakeStore {
  id: string;
  tenantId: string;
  deletedAt: Date | null;
  ticketDelivery: Record<string, unknown> | null;
}

const stores = new Map<string, FakeStore>();

const fakePrisma = {
  store: {
    findFirst: vi.fn(async ({ where, select }: any) => {
      void select;
      const s = stores.get(where.id);
      if (!s) return null;
      if (s.tenantId !== where.tenantId) return null;
      if (where.deletedAt === null && s.deletedAt) return null;
      return s;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const s = stores.get(where.id);
      if (!s) throw new Error("not found");
      s.ticketDelivery = data.ticketDelivery;
      return s;
    }),
  },
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({}),
  shutdown: async () => undefined,
}));

const { registerAdminTicketDeliveryRoutes, DEFAULT_TICKET_DELIVERY } =
  await import("../src/admin/ticket-delivery.js");
const { signAccessToken } = await import("../src/auth/tokens.js");

function tokenFor(role: "OWNER" | "MANAGER", userId: string) {
  return signAccessToken({ sub: userId, tid: TENANT, role });
}

beforeEach(() => {
  stores.clear();
  vi.clearAllMocks();
  stores.set(STORE, {
    id: STORE,
    tenantId: TENANT,
    deletedAt: null,
    ticketDelivery: null,
  });
});

async function buildApp() {
  const app = Fastify();
  await registerAdminTicketDeliveryRoutes(app);
  return app;
}

describe("/admin/stores/:storeId/ticket-delivery", () => {
  it("OWNER lee defaults cuando ticketDelivery está vacío", async () => {
    const app = await buildApp();
    const owner = `Bearer ${tokenFor("OWNER", OWNER)}`;
    const res = await app.inject({
      method: "GET",
      url: `/admin/stores/${STORE}/ticket-delivery`,
      headers: { authorization: owner },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ticketDelivery).toEqual(DEFAULT_TICKET_DELIVERY);
  });

  it("MANAGER puede leer pero no editar", async () => {
    const app = await buildApp();
    const manager = `Bearer ${tokenFor("MANAGER", MANAGER)}`;
    const get = await app.inject({
      method: "GET",
      url: `/admin/stores/${STORE}/ticket-delivery`,
      headers: { authorization: manager },
    });
    expect(get.statusCode).toBe(200);

    const patch = await app.inject({
      method: "PATCH",
      url: `/admin/stores/${STORE}/ticket-delivery`,
      headers: { authorization: manager },
      payload: { showQrButton: false },
    });
    expect(patch.statusCode).toBe(403);
  });

  it("OWNER edita un subconjunto y se mergea con el actual", async () => {
    const app = await buildApp();
    const owner = `Bearer ${tokenFor("OWNER", OWNER)}`;
    const res = await app.inject({
      method: "PATCH",
      url: `/admin/stores/${STORE}/ticket-delivery`,
      headers: { authorization: owner },
      payload: {
        showQrButton: false,
        emailSubject: "Tu ticket en {tienda}",
      },
    });
    expect(res.statusCode).toBe(200);
    const settings = res.json().ticketDelivery;
    expect(settings.showQrButton).toBe(false);
    expect(settings.emailSubject).toBe("Tu ticket en {tienda}");
    // Los demás se mantienen en sus defaults.
    expect(settings.showDownloadButton).toBe(true);
  });

  it("404 si la tienda no existe o pertenece a otro tenant", async () => {
    const app = await buildApp();
    const owner = `Bearer ${tokenFor("OWNER", OWNER)}`;
    const res = await app.inject({
      method: "GET",
      url: `/admin/stores/00000000-0000-0000-0000-000000000099/ticket-delivery`,
      headers: { authorization: owner },
    });
    expect(res.statusCode).toBe(404);
  });

  it("OWNER ignora campos inesperados (additionalProperties:false elimina)", async () => {
    const app = await buildApp();
    const owner = `Bearer ${tokenFor("OWNER", OWNER)}`;
    const res = await app.inject({
      method: "PATCH",
      url: `/admin/stores/${STORE}/ticket-delivery`,
      headers: { authorization: owner },
      payload: { foo: "bar", showViewButton: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ticketDelivery.showViewButton).toBe(false);
    expect("foo" in res.json().ticketDelivery).toBe(false);
  });
});
