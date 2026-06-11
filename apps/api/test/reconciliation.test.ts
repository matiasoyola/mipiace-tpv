// Tests de la conciliación diaria TPV ↔ Holded (v1.5-consistencia-B
// Lote 4). Mocks de Prisma + HoldedClient — sin red ni BD:
//
//   - mismatch de total detectado,
//   - documento inexistente (404) detectado,
//   - documento sin pagar (paymentsPending > 0) detectado,
//   - run limpio: persiste el run pero NO alerta (sin email).

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import { beforeEach, describe, expect, it, vi } from "vitest";

import { HoldedApiError, type HoldedClient } from "@mipiacetpv/holded-client";

import { encryptSecret } from "../src/crypto.js";
import {
  reconcileTenant,
  runDailyReconciliation,
} from "../src/tickets/reconciliation.js";
import type { SentEmail } from "../src/email/sender.js";

const TENANT = "00000000-0000-0000-0000-000000000001";
const NOW = new Date("2026-06-11T07:00:00Z");

interface FakeTicketRow {
  externalId: string;
  internalNumber: string;
  holdedDocumentId: string;
  total: number;
  tenantId: string;
  syncedAt: Date;
  status: string;
}

const state = {
  tickets: [] as FakeTicketRow[],
  runs: [] as Array<{ tenantId: string; ticketsChecked: number; mismatches: unknown }>,
};

let tenantKeyCiphertext: string | null = null;

const fakePrisma = {
  tenant: {
    findUniqueOrThrow: vi.fn(async () => ({
      holdedApiKeyCiphertext: tenantKeyCiphertext,
    })),
    findUnique: vi.fn(async () => ({ name: "Peluquería Sole" })),
  },
  ticket: {
    findMany: vi.fn(async ({ where }: any) =>
      state.tickets
        .filter(
          (t) =>
            t.tenantId === where.tenantId &&
            t.status === "SYNCED" &&
            t.syncedAt >= where.syncedAt.gte,
        )
        .map((t) => ({
          externalId: t.externalId,
          internalNumber: t.internalNumber,
          holdedDocumentId: t.holdedDocumentId,
          total: { toString: () => String(t.total) } as any,
        })),
    ),
    groupBy: vi.fn(async () => {
      const ids = [...new Set(state.tickets.map((t) => t.tenantId))];
      return ids.map((tenantId) => ({ tenantId }));
    }),
  },
  reconciliationRun: {
    create: vi.fn(async ({ data }: any) => {
      state.runs.push(data);
      return data;
    }),
  },
} as const;

// Cliente Holded falso: mapa documentId → respuesta o Error.
function makeClient(docs: Record<string, unknown>): HoldedClient {
  return {
    request: vi.fn(async (path: string) => {
      const id = path.split("/").pop()!;
      const doc = docs[id];
      if (doc === undefined) {
        throw new HoldedApiError(404, path, { info: "not found" });
      }
      if (doc instanceof Error) throw doc;
      return doc;
    }),
  } as unknown as HoldedClient;
}

function makeEmailSender() {
  const sent: SentEmail[] = [];
  return {
    sent,
    sender: {
      send: vi.fn(async (email: SentEmail) => {
        sent.push(email);
      }),
    },
  };
}

const silentLog = { info: () => {}, error: () => {} };

function seedTicket(opts: Partial<FakeTicketRow> & { holdedDocumentId: string }) {
  state.tickets.push({
    externalId: opts.externalId ?? `ext-${opts.holdedDocumentId}`,
    internalNumber: opts.internalNumber ?? "000001",
    total: opts.total ?? 12.1,
    tenantId: opts.tenantId ?? TENANT,
    syncedAt: opts.syncedAt ?? new Date(NOW.getTime() - 3600 * 1000),
    status: opts.status ?? "SYNCED",
    holdedDocumentId: opts.holdedDocumentId,
  });
}

function storedDoc(total: number, paymentsPending = 0) {
  return { id: "x", total, paymentsPending, products: [] };
}

beforeEach(() => {
  state.tickets = [];
  state.runs = [];
  tenantKeyCiphertext = encryptSecret(
    "test-api-key",
    process.env.HOLDED_KEY_ENCRYPTION_SECRET!,
  );
  vi.clearAllMocks();
});

describe("reconcileTenant", () => {
  it("total distinto en Holded → mismatch field=total (el bug del céntimo)", async () => {
    seedTicket({ holdedDocumentId: "doc-1", total: 4.69, internalNumber: "000022" });
    const result = await reconcileTenant({
      tenantId: TENANT,
      prisma: fakePrisma as any,
      buildClient: () => makeClient({ "doc-1": storedDoc(4.7) }),
      logger: silentLog,
      now: NOW,
      throttleMs: 0,
    });
    expect(result.ticketsChecked).toBe(1);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]).toMatchObject({
      field: "total",
      expected: 4.69,
      actual: 4.7,
      internalNumber: "000022",
    });
  });

  it("documento inexistente (404) → mismatch field=missing", async () => {
    seedTicket({ holdedDocumentId: "doc-gone" });
    const result = await reconcileTenant({
      tenantId: TENANT,
      prisma: fakePrisma as any,
      buildClient: () => makeClient({}),
      logger: silentLog,
      now: NOW,
      throttleMs: 0,
    });
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]!.field).toBe("missing");
  });

  it("documento sin pagar → mismatch field=paymentsPending", async () => {
    seedTicket({ holdedDocumentId: "doc-1", total: 10 });
    const result = await reconcileTenant({
      tenantId: TENANT,
      prisma: fakePrisma as any,
      buildClient: () => makeClient({ "doc-1": storedDoc(10, 10) }),
      logger: silentLog,
      now: NOW,
      throttleMs: 0,
    });
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]).toMatchObject({
      field: "paymentsPending",
      expected: 0,
      actual: 10,
    });
  });

  it("error transitorio (500) → fetch_error sin abortar el resto", async () => {
    seedTicket({ holdedDocumentId: "doc-err" });
    seedTicket({ holdedDocumentId: "doc-ok", total: 10 });
    const result = await reconcileTenant({
      tenantId: TENANT,
      prisma: fakePrisma as any,
      buildClient: () =>
        makeClient({
          "doc-err": new HoldedApiError(500, "/x", null),
          "doc-ok": storedDoc(10),
        }),
      logger: silentLog,
      now: NOW,
      throttleMs: 0,
    });
    expect(result.ticketsChecked).toBe(2);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]!.field).toBe("fetch_error");
  });

  it("run limpio → 0 mismatches", async () => {
    seedTicket({ holdedDocumentId: "doc-1", total: 12.1 });
    const result = await reconcileTenant({
      tenantId: TENANT,
      prisma: fakePrisma as any,
      buildClient: () => makeClient({ "doc-1": storedDoc(12.1) }),
      logger: silentLog,
      now: NOW,
      throttleMs: 0,
    });
    expect(result.mismatches).toHaveLength(0);
  });
});

describe("runDailyReconciliation", () => {
  it("mismatches > 0 → persiste el run y envía email de alerta", async () => {
    seedTicket({ holdedDocumentId: "doc-1", total: 4.69 });
    const email = makeEmailSender();
    const summary = await runDailyReconciliation({
      prisma: fakePrisma as any,
      buildClient: () => makeClient({ "doc-1": storedDoc(4.7) }),
      emailSender: email.sender,
      logger: silentLog,
      now: NOW,
      throttleMs: 0,
    });
    expect(summary).toEqual({
      tenantsChecked: 1,
      ticketsChecked: 1,
      totalMismatches: 1,
    });
    expect(state.runs).toHaveLength(1);
    expect(state.runs[0]).toMatchObject({ tenantId: TENANT, ticketsChecked: 1 });
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.subject).toContain("1 descuadre(s)");
    expect(email.sent[0]!.text).toContain("total");
  });

  it("run limpio → persiste el run pero NO alerta (sin email)", async () => {
    seedTicket({ holdedDocumentId: "doc-1", total: 12.1 });
    const email = makeEmailSender();
    const summary = await runDailyReconciliation({
      prisma: fakePrisma as any,
      buildClient: () => makeClient({ "doc-1": storedDoc(12.1) }),
      emailSender: email.sender,
      logger: silentLog,
      now: NOW,
      throttleMs: 0,
    });
    expect(summary.totalMismatches).toBe(0);
    expect(state.runs).toHaveLength(1);
    expect(email.sent).toHaveLength(0);
  });

  it("sin tenants con actividad → no hace nada", async () => {
    const email = makeEmailSender();
    const summary = await runDailyReconciliation({
      prisma: fakePrisma as any,
      emailSender: email.sender,
      logger: silentLog,
      now: NOW,
      throttleMs: 0,
    });
    expect(summary).toEqual({
      tenantsChecked: 0,
      ticketsChecked: 0,
      totalMismatches: 0,
    });
    expect(state.runs).toHaveLength(0);
  });
});
