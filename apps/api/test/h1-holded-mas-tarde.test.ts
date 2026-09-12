// H1 · encender Holded DESPUÉS, en una empresa que nació sin él.
//
// Lo que este banco fija:
//
//   1. Guardar la clave desde NOT_APPLICABLE pasa el sync a PENDING y
//      encola el sync inicial DE VERDAD. Por las dos puertas que ya
//      existían: la del super-admin y la del propietario.
//   2. Desde cualquier otro estado la semántica de ROTACIÓN se conserva
//      intacta: ni se toca `initialSyncStatus`, ni se encola nada. Es la
//      no-regresión de `auth-holded-rotation`.
//   3. Si la cola está caída, la CLAVE queda guardada igual: el
//      implantador reintenta con "Re-sync" sin volver a teclearla.
//   4. No se duplica el flujo de onboarding: se reutiliza el camino.
//
// Sabotajes que este fichero pone en rojo (§3 del done):
//   · no mover NOT_APPLICABLE → PENDING al guardar la clave
//   · no encolar el sync inicial (la empresa se queda sin catálogo)
//   · encolar también en una rotación normal (resync sorpresa a Thalía)

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.SUPER_ADMIN_JWT_SECRET = "s".repeat(48);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify, { type FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SUPER_ADMIN_ID = "11111111-1111-1111-1111-111111111111";
const TENANT_ID = "22222222-2222-2222-2222-222222222222";
const OWNER_ID = "33333333-3333-3333-3333-333333333333";

interface FakeTenant {
  id: string;
  name: string;
  initialSyncStatus: string;
  holdedApiKeyCiphertext: string | null;
  holdedAuthMode: string;
}

const tenants = new Map<string, FakeTenant>();
const audits: Array<{ action: string; metadata: any }> = [];

const enqueued: string[] = [];
let enqueueThrows = false;
vi.mock("../src/queues/initial-sync.js", () => ({
  enqueueInitialSync: vi.fn(async (tenantId: string) => {
    if (enqueueThrows) throw new Error("redis caído");
    enqueued.push(tenantId);
  }),
}));
vi.mock("../src/queues/catalog-incremental.js", () => ({
  enqueueManualSync: vi.fn(async () => ({ jobId: "x" })),
  registerTenantRepeatable: vi.fn(async () => undefined),
}));
vi.mock("../src/email/sender.js", () => ({
  getEmailSender: () => ({ send: vi.fn(async () => undefined) }),
}));

// Holded acepta la clave: lo que se prueba aquí es el salto de estado.
vi.mock("@mipiacetpv/holded-client", async (orig) => {
  const real = await orig<typeof import("@mipiacetpv/holded-client")>();
  return { ...real, listWarehouses: vi.fn(async () => []) };
});
vi.mock("../src/holded/probe.js", () => ({
  probeHoldedKey: vi.fn(async () => ({ ok: true })),
  probeFailureToHttpStatus: vi.fn(() => 400),
}));

const fakePrisma: any = {
  tenant: {
    findUnique: vi.fn(async ({ where }: any) => tenants.get(where.id) ?? null),
    findUniqueOrThrow: vi.fn(async ({ where }: any) => tenants.get(where.id)!),
    findFirst: vi.fn(async () => null),
    update: vi.fn(async ({ where, data }: any) => {
      const t = tenants.get(where.id)!;
      Object.assign(t, data);
      return t;
    }),
  },
  user: {
    findUnique: vi.fn(async () => ({
      id: OWNER_ID,
      tenantId: TENANT_ID,
      role: "OWNER",
      tokenVersion: 0,
      deletedAt: null,
    })),
    findFirst: vi.fn(async () => null),
  },
  superAdminUser: {
    findUnique: vi.fn(async () => ({
      id: SUPER_ADMIN_ID,
      tokenVersion: 0,
      deletedAt: null,
      isRoot: true,
    })),
  },
  superAdminAudit: {
    create: vi.fn(async ({ data }: any) => {
      audits.push({ action: data.action, metadata: data.metadata });
      return { id: randomUUID(), ...data };
    }),
  },
  $transaction: vi.fn(async (fn: any) => fn(fakePrisma)),
  $queryRaw: vi.fn(async () => []),
};

vi.mock("../src/context.js", () => ({
  initContext: vi.fn(),
  getPrisma: () => fakePrisma,
  getRedis: () => ({ incr: async () => 1, expire: async () => 1, ttl: async () => -2 }),
  closeContext: vi.fn(),
  shutdown: vi.fn(),
}));

const { registerSuperAdminTenantsRoutes } = await import(
  "../src/superadmin/tenants.js"
);
const { registerAuthRoutes } = await import("../src/auth/routes.js");

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerSuperAdminTenantsRoutes(app);
  await registerAuthRoutes(app);
  await app.ready();
  return app;
}

function saToken(): string {
  return jwt.sign(
    { sub: SUPER_ADMIN_ID, purpose: "super-admin", tv: 0, type: "access" },
    process.env.SUPER_ADMIN_JWT_SECRET!,
    { expiresIn: "1h" },
  );
}

function ownerToken(): string {
  return jwt.sign(
    { sub: OWNER_ID, tid: TENANT_ID, role: "OWNER", tv: 0, type: "access" },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: "1h" },
  );
}

function seed(initialSyncStatus: string, key: string | null = null) {
  tenants.set(TENANT_ID, {
    id: TENANT_ID,
    name: "Colegio de Talavera SL",
    initialSyncStatus,
    holdedApiKeyCiphertext: key,
    holdedAuthMode: "API_KEY",
  });
}

// Las dos puertas que ya existían y que este bloque reutiliza.
const PUERTAS = [
  {
    nombre: "super-admin · PATCH /super-admin/tenants/:id/holded-api-key",
    call: (app: FastifyInstance) =>
      app.inject({
        method: "PATCH",
        url: `/super-admin/tenants/${TENANT_ID}/holded-api-key`,
        headers: { authorization: `Bearer ${saToken()}` },
        payload: { holdedApiKey: "abc123abc123" },
      }),
  },
  {
    nombre: "propietario · POST /auth/me/rotate-holded-key",
    call: (app: FastifyInstance) =>
      app.inject({
        method: "POST",
        url: "/auth/me/rotate-holded-key",
        headers: { authorization: `Bearer ${ownerToken()}` },
        payload: { apiKey: "abc123abc123" },
      }),
  },
] as const;

beforeEach(() => {
  tenants.clear();
  audits.length = 0;
  enqueued.length = 0;
  enqueueThrows = false;
});

describe.each(PUERTAS)("H1 · estrenar Holded por $nombre", ({ call }) => {
  it("NOT_APPLICABLE → PENDING y encola el sync inicial de verdad", async () => {
    seed("NOT_APPLICABLE");
    const app = await buildApp();
    const res = await call(app);
    expect(res.statusCode).toBe(200);
    expect(res.json().initialSyncStatus).toBe("PENDING");
    expect(res.json().initialSyncQueued).toBe(true);
    expect(tenants.get(TENANT_ID)!.initialSyncStatus).toBe("PENDING");
    expect(enqueued).toEqual([TENANT_ID]);
  });

  it("la clave queda cifrada y guardada", async () => {
    seed("NOT_APPLICABLE");
    const app = await buildApp();
    await call(app);
    expect(tenants.get(TENANT_ID)!.holdedApiKeyCiphertext).toBeTruthy();
    expect(tenants.get(TENANT_ID)!.holdedApiKeyCiphertext).not.toContain("abc123");
  });

  it("con la cola caída, la clave se guarda igual y el sync queda pendiente de reintento", async () => {
    seed("NOT_APPLICABLE");
    enqueueThrows = true;
    const app = await buildApp();
    const res = await call(app);
    expect(res.statusCode).toBe(200);
    expect(res.json().initialSyncQueued).toBe(false);
    expect(tenants.get(TENANT_ID)!.holdedApiKeyCiphertext).toBeTruthy();
    expect(tenants.get(TENANT_ID)!.initialSyncStatus).toBe("PENDING");
  });

  it("ROTACIÓN (DONE): ni toca el estado ni encola — sin resync sorpresa", async () => {
    seed("DONE", "v1:vieja");
    const app = await buildApp();
    const res = await call(app);
    expect(res.statusCode).toBe(200);
    expect(tenants.get(TENANT_ID)!.initialSyncStatus).toBe("DONE");
    expect(enqueued).toEqual([]);
  });

  it("ROTACIÓN (FAILED): tampoco encola — eso es lo que hace Re-sync", async () => {
    seed("FAILED", "v1:vieja");
    const app = await buildApp();
    await call(app);
    expect(tenants.get(TENANT_ID)!.initialSyncStatus).toBe("FAILED");
    expect(enqueued).toEqual([]);
  });
});

describe("H1 · el estreno queda auditado", () => {
  it("el audit del super-admin registra el salto de estado", async () => {
    seed("NOT_APPLICABLE");
    const app = await buildApp();
    await PUERTAS[0].call(app);
    const a = audits.find((x) => x.action === "update_tenant")!;
    expect(a.metadata.changes.initialSyncStatus).toEqual({
      before: "NOT_APPLICABLE",
      after: "PENDING",
    });
  });

  it("una rotación normal NO registra salto de estado", async () => {
    seed("DONE", "v1:vieja");
    const app = await buildApp();
    await PUERTAS[0].call(app);
    const a = audits.find((x) => x.action === "update_tenant")!;
    expect(a.metadata.changes.initialSyncStatus).toBeUndefined();
  });
});
