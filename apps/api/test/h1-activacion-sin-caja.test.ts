// H1 · activar una empresa sin caja (ADR-016).
//
// Lo que este banco fija:
//
//   1. El OWNER se crea igual que siempre: email, password temporal,
//      cambio obligatorio en el primer login, tenant a ACTIVE.
//   2. Sin caja NO se genera PIN de cajero: ni `pinHash` en el User, ni
//      `ownerPin` en la respuesta, ni PIN en el email. Y la respuesta lo
//      DICE con `cashierPinIssued: false`, en vez de un null mudo.
//   3. Sin Holded el email no le pide al propietario que lo conecte.
//   4. Con caja, todo exactamente como en master.
//   5. La purga best-effort y la auditoría siguen sin poder revertir una
//      activación buena (v1.9.7).
//
// Sabotajes que este fichero pone en rojo (§3 del done):
//   · generar el PIN de cajero sin caja
//   · dejar de generarlo CON caja (regresión de v1.3-piloto-feedback)
//   · meter la purga otra vez dentro de la transacción

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

interface FakeUser {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string | null;
  pinHash: string | null;
  role: string;
  mustChangePasswordAt: Date | null;
  isTestCashier: boolean;
  deletedAt: Date | null;
}
interface FakeTenant {
  id: string;
  name: string;
  onboardingState: string;
  cajaEnabled: boolean;
  holdedApiKeyCiphertext: string | null;
}

const users = new Map<string, FakeUser>();
const tenants = new Map<string, FakeTenant>();
const audits: Array<{ action: string; metadata: any }> = [];
const sentEmails: Array<{ to: string; subject: string; text: string; html?: string }> = [];

// La salud la stubeamos: lo que este banco prueba es la activación, no
// los checks (eso es `h1-salud-modulos.test.ts`).
vi.mock("../src/superadmin/onboarding-health.js", () => ({
  computeOnboardingHealth: vi.fn(async () => ({
    initialSync: { status: "NOT_APPLICABLE", lastRunAt: null, errorMessage: null },
    taxes: { total: 0, withValidRate: 0, withoutRate: 0 },
    products: { total: 0, sellable: 0, withSku: 0, withoutSku: 0 },
    services: { total: 0, sellable: 0 },
    contacts: { total: 0 },
    ticketsTest: { total: 0, lastAt: null },
    ticketsSyncFailed: 0,
    testCashierProvisioned: false,
    modules: { caja: false, crm: true, agenda: false },
    usesHolded: false,
    readinessChecks: [
      { id: "modules-enabled", label: "Al menos un módulo encendido", ok: true, requires: "always", applies: true },
      { id: "sync-done", label: "Sync inicial completado", ok: false, requires: "holded", applies: false },
    ],
    ready: true,
  })),
}));

const purgeCalls = { n: 0 };
let purgeThrows = false;
vi.mock("../src/superadmin/test-cashier.js", () => ({
  purgeTestData: vi.fn(async () => {
    purgeCalls.n += 1;
    if (purgeThrows) throw new Error("la purga explotó");
    return { ticketsTestPurged: 0, emailJobsPurged: 0, cashierDeleted: false, deviceRevoked: false };
  }),
  issueTestCashierSession: vi.fn(),
}));

vi.mock("../src/email/sender.js", () => ({
  getEmailSender: () => ({
    send: vi.fn(async (msg: any) => {
      sentEmails.push(msg);
    }),
  }),
}));
vi.mock("../src/queues/initial-sync.js", () => ({
  enqueueInitialSync: vi.fn(async () => undefined),
}));
vi.mock("../src/queues/catalog-incremental.js", () => ({
  enqueueManualSync: vi.fn(async () => ({ jobId: "x" })),
  registerTenantRepeatable: vi.fn(async () => undefined),
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
    findUnique: vi.fn(async ({ where }: any) => {
      if (where.id) return users.get(where.id) ?? null;
      return [...users.values()].find((u) => u.email === where.email) ?? null;
    }),
    findFirst: vi.fn(async () => null),
    create: vi.fn(async ({ data }: any) => {
      const u: FakeUser = {
        id: randomUUID(),
        tenantId: data.tenantId,
        email: data.email,
        passwordHash: data.passwordHash ?? null,
        pinHash: data.pinHash ?? null,
        role: data.role,
        mustChangePasswordAt: data.mustChangePasswordAt ?? null,
        isTestCashier: false,
        deletedAt: null,
      };
      users.set(u.id, u);
      return { id: u.id, email: u.email };
    }),
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
  getRedis: () => ({}),
  closeContext: vi.fn(),
  shutdown: vi.fn(),
}));

const { registerSuperAdminTenantsRoutes } = await import(
  "../src/superadmin/tenants.js"
);

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerSuperAdminTenantsRoutes(app);
  await app.ready();
  return app;
}

function sa(): string {
  return jwt.sign(
    { sub: SUPER_ADMIN_ID, purpose: "super-admin", tv: 0, type: "access" },
    process.env.SUPER_ADMIN_JWT_SECRET!,
    { expiresIn: "1h" },
  );
}

function seed(over: Partial<FakeTenant> = {}) {
  tenants.set(TENANT_ID, {
    id: TENANT_ID,
    name: "Colegio de Talavera SL",
    onboardingState: "DRAFT",
    cajaEnabled: false,
    holdedApiKeyCiphertext: null,
    ...over,
  });
}

function activate(app: FastifyInstance) {
  return app.inject({
    method: "POST",
    url: `/super-admin/tenants/${TENANT_ID}/activate`,
    headers: { authorization: `Bearer ${sa()}` },
    payload: { ownerEmail: "direccion@colegio.es", ownerName: "Marta" },
  });
}

beforeEach(() => {
  users.clear();
  tenants.clear();
  audits.length = 0;
  sentEmails.length = 0;
  purgeCalls.n = 0;
  purgeThrows = false;
});

describe("H1 · activar SIN caja", () => {
  it("crea el OWNER y deja el tenant ACTIVE, igual que siempre", async () => {
    seed();
    const app = await buildApp();
    const res = await activate(app);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tenant.onboardingState).toBe("ACTIVE");
    expect(body.owner.email).toBe("direccion@colegio.es");
    expect(body.tempPassword).toHaveLength(16);
    const owner = [...users.values()].find((u) => u.role === "OWNER")!;
    expect(owner.mustChangePasswordAt).not.toBeNull();
  });

  it("no genera PIN de cajero, y lo dice en la respuesta", async () => {
    seed();
    const app = await buildApp();
    const body = (await activate(app)).json();
    expect(body.ownerPin).toBeNull();
    expect(body.cashierPinIssued).toBe(false);
    const owner = [...users.values()].find((u) => u.role === "OWNER")!;
    expect(owner.pinHash).toBeNull();
  });

  it("el email no habla de PIN ni de TPV", async () => {
    seed();
    const app = await buildApp();
    await activate(app);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]!.text).not.toMatch(/PIN/);
    expect(sentEmails[0]!.text).not.toMatch(/TPV/);
  });

  it("sin Holded, el email no le pide al propietario que lo conecte", async () => {
    seed();
    const app = await buildApp();
    await activate(app);
    expect(sentEmails[0]!.text).not.toMatch(/Holded/);
    expect(sentEmails[0]!.html ?? "").not.toMatch(/Holded/);
  });

  it("la auditoría deja dicho que no se emitió PIN", async () => {
    seed();
    const app = await buildApp();
    await activate(app);
    const a = audits.find((x) => x.action === "activate_tenant")!;
    expect(a.metadata.cashierPinIssued).toBe(false);
  });
});

describe("H1 · activar CON caja: sin cambios respecto a master", () => {
  it("genera el PIN de 4 dígitos, lo persiste y lo manda por email", async () => {
    seed({ cajaEnabled: true, holdedApiKeyCiphertext: "v1:cipher" });
    const app = await buildApp();
    const body = (await activate(app)).json();
    expect(body.ownerPin).toMatch(/^\d{4}$/);
    expect(body.cashierPinIssued).toBe(true);
    const owner = [...users.values()].find((u) => u.role === "OWNER")!;
    expect(owner.pinHash).toBeTruthy();
    expect(sentEmails[0]!.text).toContain(body.ownerPin);
  });

  it("con Holded, el email sigue pidiendo conectarlo", async () => {
    seed({ cajaEnabled: true, holdedApiKeyCiphertext: "v1:cipher" });
    const app = await buildApp();
    await activate(app);
    expect(sentEmails[0]!.text).toMatch(/Holded/);
  });

  it("con caja y sin Holded (caja local) el PIN se genera igual", async () => {
    seed({ cajaEnabled: true, holdedApiKeyCiphertext: null });
    const app = await buildApp();
    const body = (await activate(app)).json();
    expect(body.ownerPin).toMatch(/^\d{4}$/);
  });
});

describe("H1 · v1.9.7 sigue en pie: la purga no revierte una activación buena", () => {
  it("si la purga explota, el tenant queda ACTIVE y el OWNER creado", async () => {
    seed();
    purgeThrows = true;
    const app = await buildApp();
    const res = await activate(app);
    expect(res.statusCode).toBe(200);
    expect(tenants.get(TENANT_ID)!.onboardingState).toBe("ACTIVE");
    expect([...users.values()].some((u) => u.role === "OWNER")).toBe(true);
    expect(purgeCalls.n).toBe(1);
  });
});
