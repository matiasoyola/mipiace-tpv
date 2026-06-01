// B-OnboardingV2 · tests integradores del flow nuevo.
//
// Cobertura:
//   - POST /super-admin/tenants con sólo apiKey → DRAFT sin OWNER.
//   - GET  /super-admin/tenants/:id devuelve onboardingHealth con
//     readinessChecks y ready=false cuando faltan datos.
//   - POST /super-admin/tenants/:id/test-cashier-token emite JWT con
//     purpose=test-cashier y deviceToken; provision idempotente.
//   - GET /shift/cashier-bootstrap acepta el JWT test-cashier.
//   - POST /super-admin/tenants/:id/activate exige health=ready, crea
//     OWNER + audita + purga TEST + transiciona a ACTIVE.
//   - state machine: ACTIVE→activate devuelve 409 TENANT_NOT_DRAFT.

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

// ── Estado mutable (idéntico patrón a super-admin.test.ts) ─────────

interface FakeUser {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string | null;
  pinHash: string | null;
  role: "OWNER" | "MANAGER" | "CASHIER";
  tokenVersion: number;
  mustChangePasswordAt: Date | null;
  isTestCashier: boolean;
  deletedAt: Date | null;
  createdAt: Date;
}
interface FakeTenant {
  id: string;
  name: string;
  plan: string | null;
  fiscalProfile: unknown;
  holdedApiKeyCiphertext: string | null;
  // v1.3-SuperAdmin-Hub Lote 3: tracking del id Holded para verificar
  // que el create lo persiste y el serializeDraftTenant lo expone.
  // Opcional para no tener que añadirlo a cada tenants.set() previo
  // — projectTenant lo normaliza a `null` al exponerlo.
  holdedAccountId?: string | null;
  onboardingState: "DRAFT" | "ACTIVE";
  blockedAt: Date | null;
  blockedReason: string | null;
  initialSyncStatus: string;
  initialSyncStartedAt: Date | null;
  initialSyncCompletedAt: Date | null;
  initialSyncStats: unknown;
  lastIncrementalSyncAt: Date | null;
  createdAt: Date;
}
interface FakeStore {
  id: string;
  tenantId: string;
  name: string;
  deletedAt: Date | null;
  createdAt: Date;
  ticketDelivery: unknown;
}
interface FakeRegister {
  id: string;
  storeId: string;
  name: string;
  deletedAt: Date | null;
  createdAt: Date;
  numSerieHolded: string | null;
}
interface FakeDevice {
  id: string;
  tenantId: string;
  registerId: string;
  name: string | null;
  deviceTokenHash: string;
  revokedAt: Date | null;
  pairedAt: Date;
}
interface FakeShift {
  id: string;
  registerId: string;
  userId: string;
  cashOpening: { toString(): string };
  openedAt: Date;
  closedAt: Date | null;
  closedByUserId: string | null;
}
interface FakeTicket {
  id: string;
  tenantId: string;
  status: "DRAFT" | "PAID" | "PENDING_SYNC" | "SYNCED" | "SYNC_FAILED" | "TEST" | "VOIDED";
  createdAt: Date;
  userId: string;
}
interface FakeSuperAdmin {
  id: string;
  email: string;
  passwordHash: string;
  tokenVersion: number;
  totpEnabledAt: Date | null;
}
interface FakeAudit {
  id: string;
  superAdminId: string;
  action: string;
  tenantId: string | null;
  metadata: unknown;
  createdAt: Date;
}

const SUPER_ADMIN_ID = "11111111-1111-1111-1111-111111111111";
const TENANT_ID = "22222222-2222-2222-2222-222222222222";

const users = new Map<string, FakeUser>();
const tenants = new Map<string, FakeTenant>();
const stores = new Map<string, FakeStore>();
const registers = new Map<string, FakeRegister>();
const devices = new Map<string, FakeDevice>();
const shifts = new Map<string, FakeShift>();
const tickets = new Map<string, FakeTicket>();
const emailJobs = new Map<string, { id: string; ticketId: string; status: string }>();
const superAdmins = new Map<string, FakeSuperAdmin>();
const audits: FakeAudit[] = [];

const sentEmails: Array<{ to: string; subject: string; text: string }> = [];

// ── Mock Holded · listWarehouses devuelve un default con dirección ──

let holdedListWarehousesShouldFail = false;
vi.mock("@mipiacetpv/holded-client", async (orig) => {
  const real = await orig<typeof import("@mipiacetpv/holded-client")>();
  return {
    ...real,
    listWarehouses: vi.fn(async () => {
      if (holdedListWarehousesShouldFail) {
        const err: any = new real.HoldedApiError(401, "/warehouses", { info: "invalid" });
        throw err;
      }
      return [
        {
          id: "wh_default",
          name: "Thalia Eventos SL",
          default: true,
          address: {
            address: "C/ Mayor 10",
            city: "Madrid",
            postalCode: "28013",
            country: "ES",
          },
        },
      ];
    }),
  };
});

// ── Email sender mock ──

vi.mock("../src/email/sender.js", () => ({
  getEmailSender: () => ({
    send: vi.fn(async (msg: { to: string; subject: string; text: string }) => {
      sentEmails.push(msg);
    }),
  }),
}));

// ── Queue mock ──

vi.mock("../src/queues/initial-sync.js", () => ({
  enqueueInitialSync: vi.fn(async () => undefined),
}));
vi.mock("../src/queues/catalog-incremental.js", () => ({
  enqueueManualSync: vi.fn(async () => ({ jobId: "manual-sync-1" })),
  registerTenantRepeatable: vi.fn(async () => undefined),
}));

// ── crypto mock pasa por la real (encryptSecret/decryptSecret) ──

// ── fakePrisma ──

function makeFakePrisma() {
  const userModel = {
    findUnique: vi.fn(async ({ where, select }: any) => {
      const arr = [...users.values()];
      let u: FakeUser | undefined;
      if (where.id) u = users.get(where.id);
      else if (where.email) u = arr.find((x) => x.email === where.email);
      if (!u) return null;
      return projectUser(u, select);
    }),
    findFirst: vi.fn(async ({ where, orderBy, select }: any) => {
      let arr = [...users.values()];
      if (where) arr = arr.filter((u) => matchUserWhere(u, where));
      if (orderBy?.createdAt === "asc")
        arr.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const u = arr[0];
      return u ? projectUser(u, select) : null;
    }),
    findMany: vi.fn(async ({ where, orderBy }: any) => {
      let arr = [...users.values()];
      if (where) arr = arr.filter((u) => matchUserWhere(u, where));
      if (orderBy?.createdAt === "asc")
        arr.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      return arr;
    }),
    count: vi.fn(async ({ where }: any) => {
      let arr = [...users.values()];
      if (where) arr = arr.filter((u) => matchUserWhere(u, where));
      return arr.length;
    }),
    create: vi.fn(async ({ data, select }: any) => {
      const u: FakeUser = {
        id: data.id ?? randomUUID(),
        tenantId: data.tenantId,
        email: data.email,
        passwordHash: data.passwordHash ?? null,
        pinHash: data.pinHash ?? null,
        role: data.role,
        tokenVersion: 0,
        mustChangePasswordAt: data.mustChangePasswordAt ?? null,
        isTestCashier: data.isTestCashier ?? false,
        deletedAt: null,
        createdAt: new Date(),
      };
      users.set(u.id, u);
      return projectUser(u, select);
    }),
    update: vi.fn(async ({ where, data, select }: any) => {
      const u = users.get(where.id);
      if (!u) throw new Error("user not found");
      for (const k of [
        "deletedAt",
        "pinHash",
        "passwordHash",
        "isTestCashier",
        "mustChangePasswordAt",
        // v1.3-piloto-feedback · Lote 2: transfer-owner rota el email.
        "email",
      ]) {
        if ((data as any)[k] !== undefined) (u as any)[k] = (data as any)[k];
      }
      if (data.tokenVersion?.increment != null)
        u.tokenVersion += data.tokenVersion.increment;
      return projectUser(u, select);
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let n = 0;
      for (const u of users.values()) {
        if (where && !matchUserWhere(u, where)) continue;
        if (data.tokenVersion?.increment != null)
          u.tokenVersion += data.tokenVersion.increment;
        if (data.deletedAt !== undefined) u.deletedAt = data.deletedAt;
        n++;
      }
      return { count: n };
    }),
  };

  const tenantModel = {
    findUnique: vi.fn(async ({ where, select }: any) => {
      const t = tenants.get(where.id);
      return t ? projectTenant(t, select) : null;
    }),
    findUniqueOrThrow: vi.fn(async ({ where, select }: any) => {
      const t = tenants.get(where.id);
      if (!t) throw new Error("tenant not found");
      return projectTenant(t, select);
    }),
    findFirst: vi.fn(async () => null),
    create: vi.fn(async ({ data }: any) => {
      const t: FakeTenant = {
        id: randomUUID(),
        name: data.name,
        plan: data.plan ?? null,
        fiscalProfile: data.fiscalProfile,
        holdedApiKeyCiphertext: data.holdedApiKeyCiphertext ?? null,
        holdedAccountId: data.holdedAccountId ?? null,
        onboardingState: data.onboardingState ?? "DRAFT",
        blockedAt: null,
        blockedReason: null,
        initialSyncStatus: data.initialSyncStatus ?? "PENDING",
        initialSyncStartedAt: null,
        initialSyncCompletedAt: null,
        initialSyncStats: null,
        lastIncrementalSyncAt: null,
        createdAt: new Date(),
      };
      tenants.set(t.id, t);
      return t;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const t = tenants.get(where.id);
      if (!t) throw new Error("tenant not found");
      if (data.onboardingState !== undefined) t.onboardingState = data.onboardingState;
      if (data.holdedApiKeyCiphertext !== undefined)
        t.holdedApiKeyCiphertext = data.holdedApiKeyCiphertext;
      return t;
    }),
  };

  const storeModel = {
    findFirst: vi.fn(async ({ where, select }: any) => {
      let arr = [...stores.values()];
      if (where) {
        arr = arr.filter((s) => {
          if (where.tenantId && s.tenantId !== where.tenantId) return false;
          if (where.deletedAt === null && s.deletedAt != null) return false;
          return true;
        });
      }
      arr.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const s = arr[0];
      return s ? projectStore(s, select) : null;
    }),
    create: vi.fn(async ({ data, select }: any) => {
      const s: FakeStore = {
        id: randomUUID(),
        tenantId: data.tenantId,
        name: data.name,
        deletedAt: null,
        createdAt: new Date(),
        ticketDelivery: data.ticketDelivery ?? null,
      };
      stores.set(s.id, s);
      return projectStore(s, select);
    }),
    count: vi.fn(async () => stores.size),
  };

  const registerModel = {
    findFirst: vi.fn(async ({ where, select }: any) => {
      let arr = [...registers.values()];
      if (where) arr = arr.filter((r) => r.storeId === where.storeId && r.deletedAt == null);
      arr.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const r = arr[0];
      return r ? projectRegister(r, select) : null;
    }),
    findUnique: vi.fn(async ({ where, select }: any) => {
      const r = registers.get(where.id);
      return r ? projectRegister(r, select) : null;
    }),
    create: vi.fn(async ({ data, select }: any) => {
      const r: FakeRegister = {
        id: randomUUID(),
        storeId: data.storeId,
        name: data.name,
        deletedAt: null,
        createdAt: new Date(),
        numSerieHolded: null,
      };
      registers.set(r.id, r);
      return projectRegister(r, select);
    }),
  };

  const deviceModel = {
    findFirst: vi.fn(async ({ where, select }: any) => {
      const arr = [...devices.values()].filter((d) => {
        if (where.tenantId && d.tenantId !== where.tenantId) return false;
        if (where.registerId && d.registerId !== where.registerId) return false;
        if (where.name && d.name !== where.name) return false;
        return true;
      });
      const d = arr[0];
      return d ? projectDevice(d, select) : null;
    }),
    create: vi.fn(async ({ data, select }: any) => {
      const d: FakeDevice = {
        id: randomUUID(),
        tenantId: data.tenantId,
        registerId: data.registerId,
        name: data.name,
        deviceTokenHash: data.deviceTokenHash,
        revokedAt: null,
        pairedAt: new Date(),
      };
      devices.set(d.id, d);
      return projectDevice(d, select);
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const d = devices.get(where.id);
      if (!d) throw new Error("device not found");
      if (data.deviceTokenHash !== undefined) d.deviceTokenHash = data.deviceTokenHash;
      if (data.revokedAt !== undefined) d.revokedAt = data.revokedAt;
      if (data.pairedAt !== undefined) d.pairedAt = data.pairedAt;
      return d;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let n = 0;
      for (const d of devices.values()) {
        if (where.tenantId && d.tenantId !== where.tenantId) continue;
        if (where.name && d.name !== where.name) continue;
        if (where.revokedAt === null && d.revokedAt != null) continue;
        if (data.revokedAt !== undefined) d.revokedAt = data.revokedAt;
        n++;
      }
      return { count: n };
    }),
    findUnique: vi.fn(async ({ where }: any) => {
      const arr = [...devices.values()];
      const d = arr.find((x) => x.deviceTokenHash === where.deviceTokenHash);
      if (!d) return null;
      return { ...d };
    }),
  };

  const shiftModel = {
    findFirst: vi.fn(async ({ where, orderBy, select }: any) => {
      let arr = [...shifts.values()];
      if (where) {
        arr = arr.filter((s) => {
          if (where.registerId && s.registerId !== where.registerId) return false;
          if (where.userId && s.userId !== where.userId) return false;
          if (where.closedAt === null && s.closedAt != null) return false;
          return true;
        });
      }
      if (orderBy?.openedAt === "desc")
        arr.sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
      const s = arr[0];
      return s ? projectShift(s, select) : null;
    }),
    create: vi.fn(async ({ data, select }: any) => {
      const s: FakeShift = {
        id: randomUUID(),
        registerId: data.registerId,
        userId: data.userId,
        cashOpening: { toString: () => String(data.cashOpening ?? 0) },
        openedAt: new Date(),
        closedAt: null,
        closedByUserId: null,
      };
      shifts.set(s.id, s);
      return projectShift(s, select);
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let n = 0;
      for (const s of shifts.values()) {
        if (where.userId && s.userId !== where.userId) continue;
        if (where.closedAt === null && s.closedAt != null) continue;
        if (data.closedAt !== undefined) s.closedAt = data.closedAt;
        if (data.closedByUserId !== undefined) s.closedByUserId = data.closedByUserId;
        n++;
      }
      return { count: n };
    }),
    count: vi.fn(async () => 0),
  };

  const ticketModel = {
    findMany: vi.fn(async ({ where, select }: any) => {
      let arr = [...tickets.values()];
      if (where?.tenantId) arr = arr.filter((t) => t.tenantId === where.tenantId);
      if (where?.status) arr = arr.filter((t) => t.status === where.status);
      return select?.id ? arr.map((t) => ({ id: t.id })) : arr;
    }),
    findFirst: vi.fn(async () => null),
    count: vi.fn(async ({ where }: any) => {
      let arr = [...tickets.values()];
      if (where?.tenantId) arr = arr.filter((t) => t.tenantId === where.tenantId);
      if (where?.status) arr = arr.filter((t) => t.status === where.status);
      return arr.length;
    }),
    deleteMany: vi.fn(async ({ where }: any) => {
      const before = tickets.size;
      for (const [id, t] of tickets.entries()) {
        if (where.tenantId && t.tenantId !== where.tenantId) continue;
        if (where.status && t.status !== where.status) continue;
        tickets.delete(id);
      }
      return { count: before - tickets.size };
    }),
  };

  const ticketEmailJobModel = {
    deleteMany: vi.fn(async ({ where }: any) => {
      const targetIds = where.ticketId?.in ?? [];
      const before = emailJobs.size;
      for (const [id, j] of emailJobs.entries()) {
        if (targetIds.includes(j.ticketId)) emailJobs.delete(id);
      }
      return { count: before - emailJobs.size };
    }),
  };

  const tenantTaxModel = {
    count: vi.fn(async ({ where }: any) => {
      // No usamos taxes en este test — el contador 0 hace que el check
      // de "≥80% taxes con rate" devuelva ok=false (división por 0
      // tratado como "no taxes, no ok"). El test de activate fuerza
      // sobreescribir el computeOnboardingHealth con un stub.
      void where;
      return 0;
    }),
  };

  const productModel = {
    count: vi.fn(async () => 0),
  };

  const contactModel = {
    count: vi.fn(async () => 0),
  };

  const superAdminAuditModel = {
    create: vi.fn(async ({ data }: any) => {
      const a: FakeAudit = {
        id: randomUUID(),
        superAdminId: data.superAdminId,
        action: data.action,
        tenantId: data.tenantId ?? null,
        metadata: data.metadata,
        createdAt: new Date(),
      };
      audits.push(a);
      return a;
    }),
  };

  const superAdminUserModel = {
    findUnique: vi.fn(async ({ where }: any) => superAdmins.get(where.id) ?? null),
    update: vi.fn(async ({ where, data }: any) => {
      const sa = superAdmins.get(where.id);
      if (!sa) throw new Error("not found");
      if (data.lastLoginAt !== undefined) (sa as any).lastLoginAt = data.lastLoginAt;
      if (data.tokenVersion?.increment != null) sa.tokenVersion += data.tokenVersion.increment;
      return sa;
    }),
  };

  const prisma: any = {
    user: userModel,
    tenant: tenantModel,
    store: storeModel,
    register: registerModel,
    device: deviceModel,
    shift: shiftModel,
    ticket: ticketModel,
    ticketEmailJob: ticketEmailJobModel,
    tenantTax: tenantTaxModel,
    product: productModel,
    contact: contactModel,
    superAdminAudit: superAdminAuditModel,
    superAdminUser: superAdminUserModel,
    $transaction: vi.fn(async (cb: any) => {
      if (typeof cb === "function") return cb(prisma);
      return Promise.all(cb);
    }),
    $queryRaw: vi.fn(async () => []),
  };
  return prisma;
}

function matchUserWhere(u: FakeUser, where: any): boolean {
  if (where.id && u.id !== where.id) return false;
  if (where.tenantId && u.tenantId !== where.tenantId) return false;
  if (where.email && u.email !== where.email) return false;
  if (where.role && u.role !== where.role) return false;
  if (where.isTestCashier !== undefined && u.isTestCashier !== where.isTestCashier) return false;
  if (where.deletedAt === null && u.deletedAt != null) return false;
  return true;
}

function projectUser(u: FakeUser, _select?: any) {
  return { ...u };
}
function projectTenant(t: FakeTenant, _select?: any) {
  // v1.3-SuperAdmin-Hub Lote 3: si el tenants.set() del test no fijó
  // holdedAccountId, lo exponemos como null (igual que devuelve la BD
  // real cuando la columna está NULL).
  return { ...t, holdedAccountId: t.holdedAccountId ?? null };
}
function projectStore(s: FakeStore, _select?: any) {
  return { ...s };
}
function projectRegister(r: FakeRegister, select?: any) {
  if (select?.store) {
    const store = stores.get(r.storeId);
    return { ...r, store: store ? { id: store.id, name: store.name } : null };
  }
  return { ...r };
}
function projectDevice(d: FakeDevice, _select?: any) {
  return { ...d };
}
function projectShift(s: FakeShift, _select?: any) {
  return { ...s };
}

let fakePrisma: any;
const fakeRedis: any = {
  incr: vi.fn(async () => 1),
  expire: vi.fn(async () => 1),
  ttl: vi.fn(async () => -2),
  set: vi.fn(async () => "OK"),
  get: vi.fn(async () => null),
  del: vi.fn(async () => 1),
};
vi.mock("../src/context.js", () => ({
  initContext: vi.fn(),
  getPrisma: () => fakePrisma,
  getRedis: () => fakeRedis,
  closeContext: vi.fn(),
  shutdown: vi.fn(),
}));

// ── Test app ──

import { registerSuperAdminRoutes } from "../src/superadmin/routes.js";
import { registerCashierAuthRoutes } from "../src/shift/cashier-auth.js";

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerSuperAdminRoutes(app);
  await registerCashierAuthRoutes(app);
  await app.ready();
  return app;
}

function signSuperAdminToken(): string {
  return jwt.sign(
    { sub: SUPER_ADMIN_ID, purpose: "super-admin", tv: 0, type: "access" },
    process.env.SUPER_ADMIN_JWT_SECRET!,
    { expiresIn: "1h" },
  );
}

beforeEach(() => {
  users.clear();
  tenants.clear();
  stores.clear();
  registers.clear();
  devices.clear();
  shifts.clear();
  tickets.clear();
  emailJobs.clear();
  superAdmins.clear();
  audits.length = 0;
  sentEmails.length = 0;
  holdedListWarehousesShouldFail = false;
  fakePrisma = makeFakePrisma();
  superAdmins.set(SUPER_ADMIN_ID, {
    id: SUPER_ADMIN_ID,
    email: "admin@mipiacetpv.tech",
    passwordHash: "x",
    tokenVersion: 0,
    totpEnabledAt: null,
  });
});

// ── Tests ──

describe("B-OnboardingV2 · POST /super-admin/tenants (apiKey-only DRAFT)", () => {
  it("crea tenant DRAFT con fiscalProfile extraído de Holded; sin OWNER", async () => {
    const app = await buildApp();
    const sa = signSuperAdminToken();
    const res = await app.inject({
      method: "POST",
      url: "/super-admin/tenants",
      headers: { authorization: `Bearer ${sa}` },
      payload: {
        holdedApiKey: "abc123abc123",
        taxId: "12345678Z",
        // v1.3-SuperAdmin-Hub Lote 3: holdedAccountId pasó a required.
        holdedAccountId: "acc-thalia-001",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.tenant.onboardingState).toBe("DRAFT");
    expect(body.tenant.fiscalNif).toBe("12345678Z");
    expect(body.tenant.name).toBe("Thalia Eventos SL");
    expect(body.tenant.holdedAccountId).toBe("acc-thalia-001");
    expect(body.syncJobId).toBeTruthy();
    // No se crea OWNER user.
    expect([...users.values()].some((u) => u.role === "OWNER")).toBe(false);
    // Audit log create_tenant_draft.
    expect(audits.some((a) => a.action === "create_tenant_draft")).toBe(true);
  });

  it("rechaza taxId inválido con INVALID_HOLDED_FISCAL_PROFILE", async () => {
    const app = await buildApp();
    const sa = signSuperAdminToken();
    const res = await app.inject({
      method: "POST",
      url: "/super-admin/tenants",
      headers: { authorization: `Bearer ${sa}` },
      payload: {
        holdedApiKey: "abc123abc123",
        taxId: "12345678A",
        holdedAccountId: "acc-thalia-001",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_HOLDED_FISCAL_PROFILE");
  });

  it("rechaza apiKey inválida con HOLDED_API_KEY_INVALID", async () => {
    holdedListWarehousesShouldFail = true;
    const app = await buildApp();
    const sa = signSuperAdminToken();
    const res = await app.inject({
      method: "POST",
      url: "/super-admin/tenants",
      headers: { authorization: `Bearer ${sa}` },
      payload: {
        holdedApiKey: "bad-key-xxxxx",
        holdedAccountId: "acc-thalia-001",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("HOLDED_API_KEY_INVALID");
  });

  // v1.3-SuperAdmin-Hub Lote 3: omitir holdedAccountId debe devolver 400.
  it("rechaza sin holdedAccountId con 400", async () => {
    const app = await buildApp();
    const sa = signSuperAdminToken();
    const res = await app.inject({
      method: "POST",
      url: "/super-admin/tenants",
      headers: { authorization: `Bearer ${sa}` },
      payload: { holdedApiKey: "abc123abc123", taxId: "12345678Z" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("B-OnboardingV2 · test-cashier session", () => {
  it("POST /super-admin/tenants/:id/test-cashier-token emite JWT y deviceToken; estado DRAFT", async () => {
    const app = await buildApp();
    const sa = signSuperAdminToken();
    tenants.set(TENANT_ID, {
      id: TENANT_ID,
      name: "Thalia",
      plan: "pilot",
      fiscalProfile: { legalName: "Thalia" },
      holdedApiKeyCiphertext: "v1:cipher",
      onboardingState: "DRAFT",
      blockedAt: null,
      blockedReason: null,
      initialSyncStatus: "DONE",
      initialSyncStartedAt: null,
      initialSyncCompletedAt: new Date(),
      initialSyncStats: null,
      lastIncrementalSyncAt: null,
      createdAt: new Date(),
    });
    const res = await app.inject({
      method: "POST",
      url: `/super-admin/tenants/${TENANT_ID}/test-cashier-token`,
      headers: { authorization: `Bearer ${sa}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cashierSessionToken).toBeTruthy();
    expect(body.deviceToken).toBeTruthy();
    expect(body.shiftId).toBeTruthy();

    // Decodificar el JWT y verificar purpose=test-cashier.
    const payload = jwt.verify(
      body.cashierSessionToken,
      process.env.JWT_ACCESS_SECRET!,
    ) as any;
    expect(payload.purpose).toBe("test-cashier");
    expect(payload.type).toBe("cashier");
    expect(payload.role).toBe("MANAGER");

    // Cashier técnico creado con isTestCashier=true.
    const cashier = [...users.values()].find((u) => u.isTestCashier);
    expect(cashier).toBeTruthy();
    expect(audits.some((a) => a.action === "test_cashier_session")).toBe(true);
  });

  it("rechaza si el tenant ya está ACTIVE", async () => {
    const app = await buildApp();
    const sa = signSuperAdminToken();
    tenants.set(TENANT_ID, {
      id: TENANT_ID,
      name: "Thalia",
      plan: "pilot",
      fiscalProfile: null,
      holdedApiKeyCiphertext: null,
      onboardingState: "ACTIVE",
      blockedAt: null,
      blockedReason: null,
      initialSyncStatus: "DONE",
      initialSyncStartedAt: null,
      initialSyncCompletedAt: null,
      initialSyncStats: null,
      lastIncrementalSyncAt: null,
      createdAt: new Date(),
    });
    const res = await app.inject({
      method: "POST",
      url: `/super-admin/tenants/${TENANT_ID}/test-cashier-token`,
      headers: { authorization: `Bearer ${sa}` },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("TENANT_NOT_DRAFT");
  });

  it("GET /shift/cashier-bootstrap acepta el JWT y devuelve shift+user", async () => {
    const app = await buildApp();
    const sa = signSuperAdminToken();
    tenants.set(TENANT_ID, {
      id: TENANT_ID,
      name: "Thalia",
      plan: "pilot",
      fiscalProfile: null,
      holdedApiKeyCiphertext: null,
      onboardingState: "DRAFT",
      blockedAt: null,
      blockedReason: null,
      initialSyncStatus: "DONE",
      initialSyncStartedAt: null,
      initialSyncCompletedAt: null,
      initialSyncStats: null,
      lastIncrementalSyncAt: null,
      createdAt: new Date(),
    });
    const issue = await app.inject({
      method: "POST",
      url: `/super-admin/tenants/${TENANT_ID}/test-cashier-token`,
      headers: { authorization: `Bearer ${sa}` },
    });
    const cashierToken = issue.json().cashierSessionToken as string;
    const boot = await app.inject({
      method: "GET",
      url: "/shift/cashier-bootstrap",
      headers: { authorization: `Bearer ${cashierToken}` },
    });
    expect(boot.statusCode).toBe(200);
    const bootBody = boot.json();
    expect(bootBody.user.role).toBe("MANAGER");
    expect(bootBody.tenant.id).toBe(TENANT_ID);
    expect(bootBody.shift).not.toBeNull();
  });
});

describe("B-OnboardingV2 · POST /super-admin/tenants/:id/activate", () => {
  it("activa DRAFT cuando health=ready: crea OWNER, manda email, purga tickets TEST", async () => {
    // Setup: tenant DRAFT con health-ready. Para hacer ready=true sin
    // simular taxes/products/contacts reales, stub computeOnboardingHealth.
    vi.doMock("../src/superadmin/onboarding-health.js", () => ({
      computeOnboardingHealth: vi.fn(async () => ({
        initialSync: { status: "DONE", lastRunAt: null, errorMessage: null },
        taxes: { total: 10, withValidRate: 10, withoutRate: 0 },
        products: { total: 10, sellable: 10, withSku: 10, withoutSku: 0 },
        services: { total: 0, sellable: 0 },
        contacts: { total: 5 },
        ticketsTest: { total: 0, lastAt: null },
        ticketsSyncFailed: 0,
        testCashierProvisioned: true,
        readinessChecks: [
          { id: "sync-done", label: "Sync inicial completado", ok: true },
        ],
        ready: true,
      })),
    }));
    // Re-importar el módulo super-admin con el mock cargado.
    vi.resetModules();
    const { registerSuperAdminRoutes: register2 } = await import(
      "../src/superadmin/routes.js"
    );
    const app = Fastify({ logger: false });
    await register2(app);
    await app.ready();

    const sa = signSuperAdminToken();
    tenants.set(TENANT_ID, {
      id: TENANT_ID,
      name: "Thalia",
      plan: "pilot",
      fiscalProfile: { legalName: "Thalia", taxId: "12345678Z" },
      holdedApiKeyCiphertext: "v1:cipher",
      onboardingState: "DRAFT",
      blockedAt: null,
      blockedReason: null,
      initialSyncStatus: "DONE",
      initialSyncStartedAt: null,
      initialSyncCompletedAt: new Date(),
      initialSyncStats: null,
      lastIncrementalSyncAt: null,
      createdAt: new Date(),
    });
    // Crear un ticket TEST que debe ser purgado.
    tickets.set("t1", {
      id: "t1",
      tenantId: TENANT_ID,
      status: "TEST",
      createdAt: new Date(),
      userId: "u-test",
    });
    // Crear cashier técnico que debe ser soft-deleted.
    users.set("u-test", {
      id: "u-test",
      tenantId: TENANT_ID,
      email: "mipiacetpv-test-aa@internal.mipiacetpv.tech",
      passwordHash: null,
      pinHash: "x",
      role: "MANAGER",
      tokenVersion: 0,
      mustChangePasswordAt: null,
      isTestCashier: true,
      deletedAt: null,
      createdAt: new Date(),
    });

    const res = await app.inject({
      method: "POST",
      url: `/super-admin/tenants/${TENANT_ID}/activate`,
      headers: { authorization: `Bearer ${sa}` },
      payload: { ownerEmail: "owner@thalia.es", ownerName: "María" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tenant.onboardingState).toBe("ACTIVE");
    expect(body.owner.email).toBe("owner@thalia.es");
    expect(body.tempPassword).toHaveLength(16);
    // v1.3-piloto-feedback · Lote 1: PIN del OWNER en la respuesta y
    // pinHash persistido. 4 dígitos numéricos.
    expect(body.ownerPin).toMatch(/^\d{4}$/);

    // Tenant transicionado.
    expect(tenants.get(TENANT_ID)!.onboardingState).toBe("ACTIVE");
    // OWNER creado.
    const owner = [...users.values()].find((u) => u.email === "owner@thalia.es");
    expect(owner).toBeTruthy();
    expect(owner!.role).toBe("OWNER");
    expect(owner!.mustChangePasswordAt).not.toBeNull();
    // v1.3-piloto-feedback · Lote 1: el OWNER nace con pinHash ya
    // poblado, así que puede entrar al TPV sin pasar por la pantalla
    // admin antes.
    expect(owner!.pinHash).toBeTruthy();
    // Ticket TEST purgado.
    expect(tickets.size).toBe(0);
    // Cashier técnico soft-deleted.
    expect(users.get("u-test")!.deletedAt).not.toBeNull();
    // Email enviado con password Y PIN.
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]!.text).toContain(body.tempPassword);
    expect(sentEmails[0]!.text).toContain(body.ownerPin);
    // Audit log activate_tenant.
    expect(audits.some((a) => a.action === "activate_tenant")).toBe(true);

    vi.doUnmock("../src/superadmin/onboarding-health.js");
  });

  it("rechaza activate si tenant ya ACTIVE con 409 TENANT_NOT_DRAFT", async () => {
    const app = await buildApp();
    const sa = signSuperAdminToken();
    tenants.set(TENANT_ID, {
      id: TENANT_ID,
      name: "Thalia",
      plan: "pilot",
      fiscalProfile: null,
      holdedApiKeyCiphertext: null,
      onboardingState: "ACTIVE",
      blockedAt: null,
      blockedReason: null,
      initialSyncStatus: "DONE",
      initialSyncStartedAt: null,
      initialSyncCompletedAt: null,
      initialSyncStats: null,
      lastIncrementalSyncAt: null,
      createdAt: new Date(),
    });
    const res = await app.inject({
      method: "POST",
      url: `/super-admin/tenants/${TENANT_ID}/activate`,
      headers: { authorization: `Bearer ${sa}` },
      payload: { ownerEmail: "x@y.es", ownerName: "X" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("TENANT_NOT_DRAFT");
  });
});

// v1.3-piloto-feedback · Lote 2: transferir OWNER de un tenant activo.
describe("v1.3-piloto-feedback · POST /super-admin/tenants/:id/transfer-owner", () => {
  function seedActiveTenantWithOwner(ownerEmail: string, ownerId = "owner-1") {
    tenants.set(TENANT_ID, {
      id: TENANT_ID,
      name: "Thalia",
      plan: "pilot",
      fiscalProfile: null,
      holdedApiKeyCiphertext: null,
      onboardingState: "ACTIVE",
      blockedAt: null,
      blockedReason: null,
      initialSyncStatus: "DONE",
      initialSyncStartedAt: null,
      initialSyncCompletedAt: null,
      initialSyncStats: null,
      lastIncrementalSyncAt: null,
      createdAt: new Date(),
    });
    users.set(ownerId, {
      id: ownerId,
      tenantId: TENANT_ID,
      email: ownerEmail,
      passwordHash: "old-hash",
      pinHash: "old-pin-hash",
      role: "OWNER",
      tokenVersion: 0,
      mustChangePasswordAt: null,
      isTestCashier: false,
      deletedAt: null,
      createdAt: new Date(),
    });
  }

  it("cambia email del OWNER, bumpa tokenVersion y devuelve tempPassword", async () => {
    const app = await buildApp();
    const sa = signSuperAdminToken();
    seedActiveTenantWithOwner("m.oyola+thalia@mipiace.es");

    const res = await app.inject({
      method: "POST",
      url: `/super-admin/tenants/${TENANT_ID}/transfer-owner`,
      headers: { authorization: `Bearer ${sa}` },
      payload: {
        newOwnerEmail: "sole@peluqueria.es",
        newOwnerName: "Sole",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ownerEmail).toBe("sole@peluqueria.es");
    expect(body.tempPassword).toHaveLength(16);

    // User actualizado.
    const owner = users.get("owner-1")!;
    expect(owner.email).toBe("sole@peluqueria.es");
    expect(owner.tokenVersion).toBe(1);
    expect(owner.passwordHash).not.toBe("old-hash");
    expect(owner.mustChangePasswordAt).not.toBeNull();
    // Email enviado al nuevo destinatario con la nueva tempPassword.
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]!.to).toBe("sole@peluqueria.es");
    expect(sentEmails[0]!.text).toContain(body.tempPassword);
    // Audit log con before/after.
    const a = audits.find((x) => x.action === "transfer_owner");
    expect(a).toBeTruthy();
    expect((a!.metadata as any).previousEmail).toBe("m.oyola+thalia@mipiace.es");
    expect((a!.metadata as any).newEmail).toBe("sole@peluqueria.es");
  });

  it("rechaza si tenant en DRAFT con 409 TENANT_NOT_ACTIVE", async () => {
    const app = await buildApp();
    const sa = signSuperAdminToken();
    tenants.set(TENANT_ID, {
      id: TENANT_ID,
      name: "Thalia",
      plan: "pilot",
      fiscalProfile: null,
      holdedApiKeyCiphertext: null,
      onboardingState: "DRAFT",
      blockedAt: null,
      blockedReason: null,
      initialSyncStatus: "DONE",
      initialSyncStartedAt: null,
      initialSyncCompletedAt: null,
      initialSyncStats: null,
      lastIncrementalSyncAt: null,
      createdAt: new Date(),
    });
    const res = await app.inject({
      method: "POST",
      url: `/super-admin/tenants/${TENANT_ID}/transfer-owner`,
      headers: { authorization: `Bearer ${sa}` },
      payload: { newOwnerEmail: "a@b.es", newOwnerName: "A" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("TENANT_NOT_ACTIVE");
  });

  it("rechaza con 409 EMAIL_TAKEN si otro User ya usa el email", async () => {
    const app = await buildApp();
    const sa = signSuperAdminToken();
    seedActiveTenantWithOwner("owner@thalia.es");
    // Otro user con el email que vamos a intentar usar.
    users.set("other-user", {
      id: "other-user",
      tenantId: "44444444-4444-4444-4444-444444444444",
      email: "ya@usado.es",
      passwordHash: null,
      pinHash: null,
      role: "OWNER",
      tokenVersion: 0,
      mustChangePasswordAt: null,
      isTestCashier: false,
      deletedAt: null,
      createdAt: new Date(),
    });
    const res = await app.inject({
      method: "POST",
      url: `/super-admin/tenants/${TENANT_ID}/transfer-owner`,
      headers: { authorization: `Bearer ${sa}` },
      payload: { newOwnerEmail: "ya@usado.es", newOwnerName: "Z" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("EMAIL_TAKEN");
  });

  it("resetPassword=false no manda email ni cambia passwordHash", async () => {
    const app = await buildApp();
    const sa = signSuperAdminToken();
    seedActiveTenantWithOwner("owner@thalia.es");
    const res = await app.inject({
      method: "POST",
      url: `/super-admin/tenants/${TENANT_ID}/transfer-owner`,
      headers: { authorization: `Bearer ${sa}` },
      payload: {
        newOwnerEmail: "owner-v2@thalia.es",
        newOwnerName: "Same Owner",
        resetPassword: false,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tempPassword).toBeUndefined();
    expect(users.get("owner-1")!.passwordHash).toBe("old-hash");
    expect(sentEmails).toHaveLength(0);
    // tokenVersion sigue incrementándose: invalidar sesiones es el
    // objetivo principal, independientemente de si rotamos password.
    expect(users.get("owner-1")!.tokenVersion).toBe(1);
  });
});
