// Tests del endpoint POST /tickets/:id/send-to-kitchen
// (v1.4-Bar-Operativa-MVP Lote 2).

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
const REGISTER = "00000000-0000-0000-0000-000000000003";
const DEVICE = "00000000-0000-0000-0000-000000000004";
const CASHIER = "00000000-0000-0000-0000-000000000005";
const TABLE = "00000000-0000-0000-0000-000000000006";
const TICKET = "00000000-0000-0000-0000-000000000007";
const PRODUCT_CAFE = "00000000-0000-0000-0000-00000000000a";
const PRODUCT_TAPAS = "00000000-0000-0000-0000-00000000000b";
const PRODUCT_AGUA = "00000000-0000-0000-0000-00000000000c";

interface FakeTicket {
  id: string;
  tenantId: string;
  registerId: string;
  status: "DRAFT" | "PAID";
  tableId: string | null;
  diners: number | null;
  notes: string | null;
  lastSentRevision: number;
  lastSentAt: Date | null;
  table: { id: string; name: string } | null;
  register: { storeId: string };
  lines: Array<{
    id: string;
    productId: string | null;
    nameSnapshot: string;
    units: number;
    modifiers: unknown;
  }>;
}

interface FakeProduct {
  id: string;
  tenantId: string;
  tags: string[];
}

interface FakeTagSection {
  slug: string;
  section: "BARRA" | "COCINA" | "SALON";
  tenantId: string;
}

const state = {
  tickets: new Map<string, FakeTicket>(),
  products: new Map<string, FakeProduct>(),
  tagSections: [] as FakeTagSection[],
};

const fakePrisma = {
  ticket: {
    findFirst: vi.fn(async ({ where, select: _select }: any) => {
      const t = state.tickets.get(where.id);
      if (!t) return null;
      if (where.tenantId && t.tenantId !== where.tenantId) return null;
      if (where.status && t.status !== where.status) return null;
      // El handler usa `select` que sólo lee campos planos: devolvemos
      // el ticket entero — Prisma siempre devuelve los pedidos.
      return t;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const t = state.tickets.get(where.id);
      if (!t) throw new Error("ticket not found in fake");
      if (data.lastSentAt !== undefined) t.lastSentAt = data.lastSentAt;
      if (data.lastSentRevision !== undefined) {
        t.lastSentRevision = data.lastSentRevision;
      }
      return t;
    }),
  },
  product: {
    findMany: vi.fn(async ({ where }: any) => {
      const ids: string[] = where?.id?.in ?? [];
      const out: FakeProduct[] = [];
      for (const id of ids) {
        const p = state.products.get(id);
        if (!p) continue;
        if (where.tenantId && p.tenantId !== where.tenantId) continue;
        out.push(p);
      }
      return out;
    }),
  },
  tagSection: {
    findMany: vi.fn(async ({ where }: any) => {
      return state.tagSections.filter(
        (t) => !where?.tenantId || t.tenantId === where.tenantId,
      );
    }),
  },
  user: {
    findUniqueOrThrow: vi.fn(async ({ where }: any) => {
      if (where.id !== CASHIER) throw new Error("not found");
      return { email: "barman@bar.es" };
    }),
  },
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({}) as never,
  shutdown: async () => undefined,
}));

const { registerSendToKitchenRoute } = await import(
  "../src/tickets/send-to-kitchen.js"
);
const { signCashierSession } = await import("../src/shift/cashier-session.js");

function signSession() {
  return signCashierSession(
    {
      sub: CASHIER,
      tid: TENANT,
      did: DEVICE,
      rid: REGISTER,
      role: "CASHIER",
    },
    10,
  );
}

async function buildApp() {
  const app = Fastify();
  await registerSendToKitchenRoute(app);
  return app;
}

function seedFreshTicket(overrides: Partial<FakeTicket> = {}): FakeTicket {
  const ticket: FakeTicket = {
    id: TICKET,
    tenantId: TENANT,
    registerId: REGISTER,
    status: "DRAFT",
    tableId: TABLE,
    diners: 4,
    notes: null,
    lastSentRevision: 0,
    lastSentAt: null,
    table: { id: TABLE, name: "Mesa 7" },
    register: { storeId: STORE },
    lines: [
      {
        id: "L1",
        productId: PRODUCT_CAFE,
        nameSnapshot: "Café cortado",
        units: 2,
        modifiers: null,
      },
      {
        id: "L2",
        productId: PRODUCT_TAPAS,
        nameSnapshot: "Patatas bravas",
        units: 1,
        modifiers: ["Sin pimentón"],
      },
      {
        id: "L3",
        productId: PRODUCT_AGUA,
        nameSnapshot: "Agua con gas",
        units: 1,
        modifiers: null,
      },
    ],
    ...overrides,
  };
  state.tickets.set(ticket.id, ticket);
  return ticket;
}

beforeEach(() => {
  state.tickets.clear();
  state.products.clear();
  state.tagSections.length = 0;
  vi.clearAllMocks();

  // Catálogo: café y agua tienen tag "bebidas"; tapas tienen "comida".
  state.products.set(PRODUCT_CAFE, {
    id: PRODUCT_CAFE,
    tenantId: TENANT,
    tags: ["bebidas"],
  });
  state.products.set(PRODUCT_TAPAS, {
    id: PRODUCT_TAPAS,
    tenantId: TENANT,
    tags: ["comida"],
  });
  state.products.set(PRODUCT_AGUA, {
    id: PRODUCT_AGUA,
    tenantId: TENANT,
    tags: ["bebidas"],
  });

  // Mapeo: bebidas → BARRA, comida → COCINA.
  state.tagSections.push(
    { slug: "bebidas", section: "BARRA", tenantId: TENANT },
    { slug: "comida", section: "COCINA", tenantId: TENANT },
  );
});

describe("POST /tickets/:id/send-to-kitchen", () => {
  it("agrupa líneas por sección y devuelve un PDF por sección", async () => {
    seedFreshTicket();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/send-to-kitchen`,
      headers: { authorization: `Bearer ${signSession()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.revision).toBe(1);
    expect(body.sentAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // 2 secciones (BARRA y COCINA), no SALON.
    expect(body.sections).toHaveLength(2);
    const barra = body.sections.find(
      (s: { section: string }) => s.section === "BARRA",
    );
    const cocina = body.sections.find(
      (s: { section: string }) => s.section === "COCINA",
    );
    expect(barra).toBeDefined();
    expect(cocina).toBeDefined();
    // Café (2) + Agua (1) = 2 líneas (líneas, no unidades).
    expect(barra.lineCount).toBe(2);
    // Tapas = 1 línea.
    expect(cocina.lineCount).toBe(1);

    // Cada sección debe traer un base64 que descodifique como PDF.
    for (const sec of body.sections) {
      const bytes = Buffer.from(sec.pdfBase64, "base64");
      expect(bytes.length).toBeGreaterThan(100);
      expect(bytes.slice(0, 4).toString("ascii")).toBe("%PDF");
    }

    // El ticket se marca como enviado.
    const updated = state.tickets.get(TICKET)!;
    expect(updated.lastSentRevision).toBe(1);
    expect(updated.lastSentAt).toBeInstanceOf(Date);
  });

  it("líneas sin tag mapeado caen a SALON", async () => {
    // Mantenemos sólo la línea de café pero sin mapeo para "bebidas".
    seedFreshTicket({
      lines: [
        {
          id: "L1",
          productId: PRODUCT_CAFE,
          nameSnapshot: "Café cortado",
          units: 1,
          modifiers: null,
        },
      ],
    });
    state.tagSections.length = 0; // limpio mapeo
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/send-to-kitchen`,
      headers: { authorization: `Bearer ${signSession()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sections).toHaveLength(1);
    expect(body.sections[0].section).toBe("SALON");
    expect(body.sections[0].lineCount).toBe(1);
  });

  it("incrementa revision en envíos sucesivos", async () => {
    seedFreshTicket({ lastSentRevision: 2 });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/send-to-kitchen`,
      headers: { authorization: `Bearer ${signSession()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().revision).toBe(3);
    expect(state.tickets.get(TICKET)!.lastSentRevision).toBe(3);
  });

  it("404 si el ticket no es DRAFT", async () => {
    seedFreshTicket({ status: "PAID" });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/send-to-kitchen`,
      headers: { authorization: `Bearer ${signSession()}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("TICKET_NOT_FOUND_OR_NOT_DRAFT");
  });

  it("403 si el register del cashier no coincide con el del ticket", async () => {
    seedFreshTicket({ registerId: "ffffffff-ffff-ffff-ffff-ffffffffffff" });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/send-to-kitchen`,
      headers: { authorization: `Bearer ${signSession()}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("REGISTER_MISMATCH");
  });

  it("400 si el ticket no tiene líneas", async () => {
    seedFreshTicket({ lines: [] });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/send-to-kitchen`,
      headers: { authorization: `Bearer ${signSession()}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("EMPTY_TICKET");
  });
});
