// v1.4-Buscador-Contactos · test del backfill `type` sobre contactos
// preexistentes. Mockea Prisma en memoria y verifica que el script
// lee `raw.type` y poblá la columna correctamente.

import { randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";

import { beforeEach, describe, expect, it, vi } from "vitest";

type ContactType =
  | "CLIENT"
  | "SUPPLIER"
  | "LEAD"
  | "DEBTOR"
  | "CREDITOR"
  | "UNKNOWN";

interface Row {
  id: string;
  tenantId: string;
  type: ContactType | null;
  raw: { type?: unknown } | null;
}

const store = new Map<string, Row>();

const fakePrisma = {
  contact: {
    findMany: vi.fn(async ({ where, take, cursor, skip, orderBy }: any) => {
      let list = [...store.values()].filter(
        (r) => r.type === null && (!where.tenantId || r.tenantId === where.tenantId),
      );
      if (orderBy?.id === "asc") list.sort((a, b) => a.id.localeCompare(b.id));
      if (cursor?.id) {
        const idx = list.findIndex((r) => r.id === cursor.id);
        if (idx >= 0) list = list.slice(idx + (skip ?? 0));
      }
      return list.slice(0, take ?? 200);
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const row = store.get(where.id);
      if (row) row.type = data.type;
      return row;
    }),
  },
} as any;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  shutdown: async () => undefined,
}));

const { runBackfillContactType } = await import(
  "../src/scripts/backfill-contact-type.js"
);

function seed(opts: { type?: unknown; tenantId?: string }) {
  const id = randomUUID();
  const row: Row = {
    id,
    tenantId: opts.tenantId ?? "tenant-a",
    type: null,
    raw: opts.type === undefined ? {} : { type: opts.type },
  };
  store.set(id, row);
  return row;
}

beforeEach(() => {
  store.clear();
});

describe("backfill-contact-type", () => {
  it("mapea cada raw.type al enum y deja UNKNOWN para casos edge", async () => {
    const client = seed({ type: "client" });
    const supplier = seed({ type: "SUPPLIER" }); // case-insensitive
    const lead = seed({ type: "lead" });
    const debtor = seed({ type: "debtor" });
    const creditor = seed({ type: "creditor" });
    const weird = seed({ type: "partner" }); // valor que no conocemos
    const missing = seed({}); // raw sin type

    const stats = await runBackfillContactType(fakePrisma);

    expect(stats.scanned).toBe(7);
    expect(stats.updated).toBe(7);
    expect(stats.perType.CLIENT).toBe(1);
    expect(stats.perType.SUPPLIER).toBe(1);
    expect(stats.perType.LEAD).toBe(1);
    expect(stats.perType.DEBTOR).toBe(1);
    expect(stats.perType.CREDITOR).toBe(1);
    expect(stats.perType.UNKNOWN).toBe(2); // weird + missing

    expect(store.get(client.id)!.type).toBe("CLIENT");
    expect(store.get(supplier.id)!.type).toBe("SUPPLIER");
    expect(store.get(lead.id)!.type).toBe("LEAD");
    expect(store.get(debtor.id)!.type).toBe("DEBTOR");
    expect(store.get(creditor.id)!.type).toBe("CREDITOR");
    expect(store.get(weird.id)!.type).toBe("UNKNOWN");
    expect(store.get(missing.id)!.type).toBe("UNKNOWN");

    // Sólo el `missing` debería figurar en la lista de IDs con raw
    // sin `type` para que el operador revise: weird sí tenía type
    // pero era un valor desconocido.
    expect(stats.rawWithoutType).toContain(missing.id);
    expect(stats.rawWithoutType).not.toContain(weird.id);
  });

  it("es idempotente: re-ejecutar no toca filas ya pobladas", async () => {
    seed({ type: "client" });
    await runBackfillContactType(fakePrisma);
    const second = await runBackfillContactType(fakePrisma);
    expect(second.scanned).toBe(0);
    expect(second.updated).toBe(0);
  });

  it("respeta el filtro por tenantId", async () => {
    const a = seed({ type: "client", tenantId: "tenant-a" });
    const b = seed({ type: "supplier", tenantId: "tenant-b" });
    const stats = await runBackfillContactType(fakePrisma, "tenant-a");
    expect(stats.scanned).toBe(1);
    expect(store.get(a.id)!.type).toBe("CLIENT");
    expect(store.get(b.id)!.type).toBeNull();
  });
});
