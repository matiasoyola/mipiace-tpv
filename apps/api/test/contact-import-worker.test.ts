// v1.0-pilotos · Lote 6 (#22): worker del importador de clientes.
// processContactImportJob con deps inyectadas — sin BullMQ ni red.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "00000000-0000-0000-0000-000000000001";

interface LocalContact {
  id: string;
  tenantId: string;
  holdedContactId: string;
  name: string;
  nif: string | null;
  email: string | null;
}

const state = {
  contacts: [] as LocalContact[],
  holdedCreates: [] as Array<{ name: string; code?: string; email?: string }>,
  // Si un nombre está aquí, createContact falla N veces antes de ir bien.
  failuresByName: new Map<string, number>(),
  apiKeyCiphertext: null as string | null,
  sleeps: [] as number[],
};

const fakePrisma = {
  tenant: {
    findUnique: vi.fn(async () => ({
      holdedApiKeyCiphertext: state.apiKeyCiphertext,
    })),
  },
  contact: {
    findFirst: vi.fn(async ({ where }: any) => {
      const found = state.contacts.find((c) => {
        if (c.tenantId !== where.tenantId) return false;
        if (where.nif) return c.nif === where.nif;
        if (where.email) return c.email === where.email;
        if (where.name) return c.name === where.name;
        return false;
      });
      return found ? { id: found.id } : null;
    }),
    upsert: vi.fn(async ({ where, create }: any) => {
      const existing = state.contacts.find(
        (c) => c.holdedContactId === where.tenantId_holdedContactId.holdedContactId,
      );
      if (existing) return existing;
      const row: LocalContact = {
        id: randomUUID(),
        tenantId: create.tenantId,
        holdedContactId: create.holdedContactId,
        name: create.name,
        nif: create.nif,
        email: create.email,
      };
      state.contacts.push(row);
      return row;
    }),
  },
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({}),
  shutdown: async () => undefined,
}));

const { processContactImportJob, normalizeNif } = await import(
  "../src/workers/contact-import-worker.js"
);
const { encryptSecret } = await import("../src/crypto.js");

const fakeCreateContact = vi.fn(async (_client: unknown, body: any) => {
  const pending = state.failuresByName.get(body.name) ?? 0;
  if (pending > 0) {
    state.failuresByName.set(body.name, pending - 1);
    throw new Error("Holded 500 transitorio");
  }
  state.holdedCreates.push({ name: body.name, code: body.code, email: body.email });
  return {
    id: `holded-${state.holdedCreates.length}`,
    name: body.name,
    code: body.code ?? null,
    email: body.email ?? null,
    phone: body.phone ?? null,
    mobile: null,
    type: "client",
  };
});

function deps(overrides: Record<string, unknown> = {}) {
  return {
    prisma: fakePrisma as never,
    buildClient: () => ({ request: vi.fn() }) as never,
    createContact: fakeCreateContact as never,
    sleep: vi.fn(async (ms: number) => {
      state.sleeps.push(ms);
    }),
    delayMs: 400,
    ...overrides,
  };
}

function job(rows: Array<{ name: string; nif?: string | null; email?: string | null; phone?: string | null }>) {
  return {
    tenantId: TENANT,
    requestedByUserId: "user-1",
    rows: rows.map((r) => ({
      name: r.name,
      nif: r.nif ?? null,
      email: r.email ?? null,
      phone: r.phone ?? null,
    })),
  };
}

beforeEach(() => {
  state.contacts = [];
  state.holdedCreates = [];
  state.failuresByName.clear();
  state.sleeps = [];
  state.apiKeyCiphertext = encryptSecret(
    "fake-holded-key",
    process.env.HOLDED_KEY_ENCRYPTION_SECRET!,
  );
  vi.clearAllMocks();
});

describe("processContactImportJob", () => {
  it("crea en Holded y rellena la BD local vía upsert (nunca solo-local)", async () => {
    const result = await processContactImportJob(
      job([
        { name: "María García", nif: "12345678Z", email: "maria@x.es" },
        { name: "Bar Pepe SL", nif: "B12345674" },
      ]),
      deps(),
    );
    expect(result.created).toBe(2);
    expect(result.existed).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(state.holdedCreates).toHaveLength(2);
    // Upsert local con el id de Holded.
    expect(state.contacts).toHaveLength(2);
    expect(state.contacts[0]!.holdedContactId).toMatch(/^holded-/);
  });

  it("idempotencia: NIF ya en BD local → skip 'ya existía'; releer el archivo no duplica", async () => {
    const rows = [{ name: "María García", nif: "12345678Z" }];
    const first = await processContactImportJob(job(rows), deps());
    expect(first.created).toBe(1);

    const second = await processContactImportJob(job(rows), deps());
    expect(second.created).toBe(0);
    expect(second.existed).toBe(1);
    expect(state.holdedCreates).toHaveLength(1);
    expect(state.contacts).toHaveLength(1);
  });

  it("sin NIF la idempotencia cae al email", async () => {
    await processContactImportJob(
      job([{ name: "Sin Nif", email: "cliente@x.es" }]),
      deps(),
    );
    const second = await processContactImportJob(
      job([{ name: "Sin Nif renombrado", email: "CLIENTE@x.es" }]),
      deps(),
    );
    expect(second.existed).toBe(1);
    expect(state.holdedCreates).toHaveLength(1);
  });

  it("NIF inválido → fila a errores, no se crea", async () => {
    const result = await processContactImportJob(
      job([
        { name: "NIF malo", nif: "12345678A" }, // letra de control incorrecta
        { name: "NIF bueno", nif: "12345678Z" },
      ]),
      deps(),
    );
    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ row: 1, name: "NIF malo" });
    expect(result.errors[0]!.reason).toContain("NIF inválido");
  });

  it("duplicados DENTRO del archivo → la segunda aparición cuenta como existente", async () => {
    const result = await processContactImportJob(
      job([
        { name: "María", nif: "12345678Z" },
        { name: "María repetida", nif: "12345678z" }, // mismo NIF, case distinto
      ]),
      deps(),
    );
    expect(result.created).toBe(1);
    expect(result.existed).toBe(1);
    expect(state.holdedCreates).toHaveLength(1);
  });

  it("error transitorio de Holded → reintenta y la fila acaba creada", async () => {
    state.failuresByName.set("Con reintento", 2); // falla 2, entra a la 3ª
    const result = await processContactImportJob(
      job([{ name: "Con reintento", nif: "12345678Z" }]),
      deps(),
    );
    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it("fallo persistente de Holded → fila a errores tras agotar reintentos, y el resto sigue", async () => {
    state.failuresByName.set("Siempre falla", 99);
    const result = await processContactImportJob(
      job([
        { name: "Siempre falla", nif: "12345678Z" },
        { name: "Esta entra", nif: "87654321X" },
      ]),
      deps(),
    );
    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.reason).toContain("Holded 500");
  });

  it("throttle: pausa tras cada alta real; los skips no pausan", async () => {
    state.contacts.push({
      id: randomUUID(),
      tenantId: TENANT,
      holdedContactId: "h-existing",
      name: "Ya estaba",
      nif: "87654321X",
      email: null,
    });
    const d = deps();
    await processContactImportJob(
      job([
        { name: "Nueva", nif: "12345678Z" },
        { name: "Ya estaba", nif: "87654321X" },
      ]),
      d,
    );
    // Una sola pausa de throttle (la del alta); el skip no pega a Holded.
    const throttleSleeps = state.sleeps.filter((ms) => ms === 400);
    expect(throttleSleeps).toHaveLength(1);
  });

  it("progreso reportado por fila con contadores acumulados", async () => {
    const snapshots: unknown[] = [];
    await processContactImportJob(
      job([
        { name: "Uno", nif: "12345678Z" },
        { name: "NIF malo", nif: "00000000A" },
      ]),
      deps({
        onProgress: async (p: unknown) => {
          snapshots.push(p);
        },
      }),
    );
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]).toMatchObject({
      processed: 2,
      total: 2,
      created: 1,
      errors: 1,
    });
  });

  it("tenant sin API key de Holded → el job falla (no se crean contactos solo-locales)", async () => {
    state.apiKeyCiphertext = null;
    await expect(
      processContactImportJob(job([{ name: "X" }]), deps()),
    ).rejects.toThrow(/API key/);
  });
});

describe("normalizeNif", () => {
  it("mayúsculas y sin separadores", () => {
    expect(normalizeNif(" 12345678-z ")).toBe("12345678Z");
    expect(normalizeNif("b.12345674")).toBe("B12345674");
  });
});
