// v1.0-pilotos · Lote 2 (#9): reimprimir desde el historial fallaba
// con "body vacío". Causa raíz: el wrapper fetch del TPV manda
// `Content-Type: application/json` también en POSTs sin payload y el
// parser por defecto de Fastify los corta con FST_ERR_CTP_EMPTY_JSON_
// BODY (400) antes del handler. Reproducimos el bug y validamos el fix
// (parser tolerante registrado en server.ts) + reimpresión de ticket
// histórico de un turno YA CERRADO.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "00000000-0000-0000-0000-000000000001";
const REGISTER = "00000000-0000-0000-0000-000000000002";
const DEVICE = "00000000-0000-0000-0000-000000000003";
const CASHIER = "00000000-0000-0000-0000-000000000004";
const TICKET_PAID = "00000000-0000-0000-0000-000000000005";
const TICKET_DRAFT = "00000000-0000-0000-0000-000000000006";
const TICKET_OLD_SHIFT = "00000000-0000-0000-0000-000000000007";

const state = {
  tickets: new Map<
    string,
    { id: string; tenantId: string; status: string; internalNumber: string; shiftClosed: boolean }
  >(),
  printIntents: [] as Array<{ id: string; ticketId: string; kind: string }>,
};

const fakePrisma = {
  ticket: {
    findFirst: vi.fn(async ({ where }: any) => {
      const t = state.tickets.get(where.id);
      if (!t || t.tenantId !== where.tenantId) return null;
      return t;
    }),
  },
  printIntent: {
    create: vi.fn(async ({ data }: any) => {
      const intent = { id: randomUUID(), ticketId: data.ticketId, kind: data.kind };
      state.printIntents.push(intent);
      return { id: intent.id, createdAt: new Date() };
    }),
  },
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));
vi.mock("../src/queues/ticket-upload.js", () => ({
  enqueueTicketUpload: async () => undefined,
}));
vi.mock("../src/queues/refund-upload.js", () => ({
  enqueueRefundUpload: async () => undefined,
}));
vi.mock("../src/queues/ticket-email.js", () => ({
  enqueueTicketEmail: async () => undefined,
}));
vi.mock("../src/tickets/email-trigger.js", () => ({
  maybeEnqueueAutoEmail: async () => ({ enqueued: false }),
}));

const { registerTicketRoutes } = await import("../src/tickets/routes.js");
const { registerLenientJsonParser } = await import("../src/lib/lenient-json.js");
const { signCashierSession } = await import("../src/shift/cashier-session.js");

function auth() {
  return {
    authorization: `Bearer ${signCashierSession(
      { sub: CASHIER, tid: TENANT, did: DEVICE, rid: REGISTER, role: "CASHIER" },
      10,
    )}`,
  };
}

async function buildApp(opts: { lenientJson: boolean }) {
  const app = Fastify();
  if (opts.lenientJson) registerLenientJsonParser(app);
  await registerTicketRoutes(app);
  return app;
}

beforeEach(() => {
  state.tickets.clear();
  state.printIntents = [];
  vi.clearAllMocks();
  state.tickets.set(TICKET_PAID, {
    id: TICKET_PAID,
    tenantId: TENANT,
    status: "SYNCED",
    internalNumber: "000042",
    shiftClosed: false,
  });
  state.tickets.set(TICKET_DRAFT, {
    id: TICKET_DRAFT,
    tenantId: TENANT,
    status: "DRAFT",
    internalNumber: "D-x",
    shiftClosed: false,
  });
  state.tickets.set(TICKET_OLD_SHIFT, {
    id: TICKET_OLD_SHIFT,
    tenantId: TENANT,
    status: "SYNCED",
    internalNumber: "000007",
    shiftClosed: true,
  });
});

describe("POST /tickets/:id/reprint · bug #9 body vacío", () => {
  it("reproduce el bug: parser por defecto + Content-Type json sin body → 400 antes del handler", async () => {
    const app = await buildApp({ lenientJson: false });
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET_PAID}/reprint`,
      headers: { ...auth(), "content-type": "application/json" },
      // sin payload — exactamente lo que manda el TPV
    });
    expect(res.statusCode).toBe(400);
    expect(state.printIntents).toHaveLength(0);
  });

  it("fix: con el parser tolerante, el mismo request → 202 + PrintIntent REPRINT", async () => {
    const app = await buildApp({ lenientJson: true });
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET_PAID}/reprint`,
      headers: { ...auth(), "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().printIntentId).toBeTruthy();
    expect(state.printIntents).toHaveLength(1);
    expect(state.printIntents[0]!.kind).toBe("REPRINT");
  });

  it("sin header Content-Type (front arreglado) también funciona", async () => {
    const app = await buildApp({ lenientJson: true });
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET_PAID}/reprint`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(202);
  });

  it("el parser tolerante NO relaja endpoints con body required (JSON inválido → 400)", async () => {
    const app = await buildApp({ lenientJson: true });
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET_PAID}/reprint`,
      headers: { ...auth(), "content-type": "application/json" },
      payload: "{not json",
    });
    expect(res.statusCode).toBe(400);
  });

  it("ticket histórico de un turno YA CERRADO se reimprime igual (202)", async () => {
    const app = await buildApp({ lenientJson: true });
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET_OLD_SHIFT}/reprint`,
      headers: { ...auth(), "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(202);
    expect(state.printIntents[0]!.ticketId).toBe(TICKET_OLD_SHIFT);
  });

  it("DRAFT no reimprimible → 409 TICKET_NOT_REPRINTABLE", async () => {
    const app = await buildApp({ lenientJson: true });
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET_DRAFT}/reprint`,
      headers: { ...auth(), "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("TICKET_NOT_REPRINTABLE");
  });
});
