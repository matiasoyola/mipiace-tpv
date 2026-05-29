// B-SuperAdmin · tests integradores de la consola super-admin.
//
// Cubre:
//   - super-admin-auth: login OK + password mala + refresh + logout.
//   - super-admin-isolation: un OWNER no puede llamar /super-admin/*.
//   - super-admin-tenants: crear tenant + OWNER atómico + email mock +
//     idempotencia + tempPassword devuelta.
//   - super-admin-block: bloquear → 423 en /admin; desbloquear → vuelve.
//   - super-admin-impersonate: JWT impersonation permite GET, rechaza
//     POST/PATCH/DELETE con 403 IMPERSONATION_READONLY.
//   - super-admin-audit: cada acción registra un audit log con shape OK.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.SUPER_ADMIN_JWT_SECRET = "s".repeat(48);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Fakes de Prisma + Redis ─────────────────────────────────────────

interface FakeUser {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string | null;
  role: "OWNER" | "MANAGER" | "CASHIER";
  tokenVersion: number;
  mustChangePasswordAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  twoFactorSecret: string | null;
  twoFactorEnabledAt: Date | null;
  twoFactorRecoveryCodes: unknown;
}

interface FakeTenant {
  id: string;
  name: string;
  plan: string | null;
  fiscalProfile: unknown;
  holdedAuthMode: string;
  holdedApiKeyCiphertext: string | null;
  blockedAt: Date | null;
  blockedReason: string | null;
  createdAt: Date;
  initialSyncStatus: string;
  lastIncrementalSyncAt: Date | null;
}

interface FakeSuperAdmin {
  id: string;
  email: string;
  passwordHash: string;
  tokenVersion: number;
  totpSecret: string | null;
  totpEnabledAt: Date | null;
  recoveryCodes: unknown;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface FakeAudit {
  id: string;
  superAdminId: string;
  action: string;
  tenantId: string | null;
  metadata: unknown;
  createdAt: Date;
}

const users = new Map<string, FakeUser>();
const tenants = new Map<string, FakeTenant>();
const superAdmins = new Map<string, FakeSuperAdmin>();
const audits: FakeAudit[] = [];

function matchOrder<T>(
  rows: T[],
  orderBy: Record<string, "asc" | "desc"> | undefined,
): T[] {
  if (!orderBy) return rows;
  const [field, dir] = Object.entries(orderBy)[0]!;
  return [...rows].sort((a, b) => {
    const av = (a as Record<string, unknown>)[field];
    const bv = (b as Record<string, unknown>)[field];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return dir === "asc" ? cmp : -cmp;
  });
}

const fakePrisma: any = {
  user: {
    findUnique: vi.fn(async ({ where }: any) => {
      if (where.id) return users.get(where.id) ?? null;
      if (where.email) {
        for (const u of users.values()) if (u.email === where.email) return u;
        return null;
      }
      return null;
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: any) => {
      const u = users.get(where.id);
      if (!u) throw new Error("user not found");
      return u;
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      for (const u of users.values()) {
        if (where.email && u.email === where.email) return u;
        if (where.tenantId && u.tenantId === where.tenantId) {
          if (where.role && u.role !== where.role) continue;
          return u;
        }
      }
      return null;
    }),
    create: vi.fn(async ({ data }: any) => {
      const u: FakeUser = {
        id: data.id ?? randomUUID(),
        tenantId: data.tenantId,
        email: data.email,
        passwordHash: data.passwordHash ?? null,
        role: data.role,
        tokenVersion: 0,
        mustChangePasswordAt: data.mustChangePasswordAt ?? null,
        lastLoginAt: null,
        createdAt: new Date(),
        twoFactorSecret: null,
        twoFactorEnabledAt: null,
        twoFactorRecoveryCodes: null,
      };
      users.set(u.id, u);
      return u;
    }),
    update: vi.fn(async ({ where, data, select }: any) => {
      const u = users.get(where.id);
      if (!u) throw new Error("user not found");
      if (data.passwordHash !== undefined) u.passwordHash = data.passwordHash;
      if (data.mustChangePasswordAt !== undefined)
        u.mustChangePasswordAt = data.mustChangePasswordAt;
      if (data.lastLoginAt !== undefined) u.lastLoginAt = data.lastLoginAt;
      if (data.tokenVersion?.increment != null)
        u.tokenVersion += data.tokenVersion.increment;
      if (data.twoFactorEnabledAt !== undefined)
        u.twoFactorEnabledAt = data.twoFactorEnabledAt;
      if (data.twoFactorSecret !== undefined)
        u.twoFactorSecret = data.twoFactorSecret;
      if (data.twoFactorRecoveryCodes !== undefined)
        u.twoFactorRecoveryCodes = data.twoFactorRecoveryCodes;
      return select?.tokenVersion ? { tokenVersion: u.tokenVersion } : u;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const u of users.values()) {
        if (where.tenantId && u.tenantId !== where.tenantId) continue;
        if (data.tokenVersion?.increment != null) {
          u.tokenVersion += data.tokenVersion.increment;
          count++;
        }
      }
      return { count };
    }),
    findMany: vi.fn(async ({ where, orderBy, select }: any) => {
      let rows = [...users.values()];
      if (where?.tenantId) rows = rows.filter((u) => u.tenantId === where.tenantId);
      if (where?.role) rows = rows.filter((u) => u.role === where.role);
      rows = matchOrder(rows, orderBy);
      if (select) {
        return rows.map((u) => {
          const out: Record<string, unknown> = {};
          for (const k of Object.keys(select)) out[k] = (u as any)[k];
          return out;
        });
      }
      return rows;
    }),
  },
  tenant: {
    findUnique: vi.fn(async ({ where, select, include }: any) => {
      const t = tenants.get(where.id);
      if (!t) return null;
      const enriched: any = { ...t };
      if (include?.users) {
        let rows = [...users.values()].filter((u) => u.tenantId === t.id);
        if (include.users.where?.role) {
          rows = rows.filter((u) => u.role === include.users.where.role);
        }
        rows = matchOrder(rows, include.users.orderBy);
        if (include.users.take) rows = rows.slice(0, include.users.take);
        enriched.users = rows;
      }
      if (include?.stores) enriched.stores = [];
      if (select) {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(select)) out[k] = (t as any)[k];
        return out;
      }
      return enriched;
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: any) => {
      const t = tenants.get(where.id);
      if (!t) throw new Error("tenant not found");
      return t;
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      for (const t of tenants.values()) {
        if (where.name && t.name === where.name) {
          if (where.id?.not && t.id === where.id.not) continue;
          return t;
        }
      }
      return null;
    }),
    findMany: vi.fn(async ({ where, orderBy, skip, take, include }: any) => {
      let rows = [...tenants.values()];
      if (where?.blockedAt?.not === null) rows = rows.filter((t) => t.blockedAt != null);
      else if (where?.blockedAt === null) rows = rows.filter((t) => t.blockedAt === null);
      rows = matchOrder(rows, orderBy);
      if (skip) rows = rows.slice(skip);
      if (take) rows = rows.slice(0, take);
      if (include?.users) {
        return rows.map((t) => {
          let u = [...users.values()].filter((x) => x.tenantId === t.id);
          if (include.users.where?.role) {
            u = u.filter((x) => x.role === include.users.where.role);
          }
          u = matchOrder(u, include.users.orderBy);
          if (include.users.take) u = u.slice(0, include.users.take);
          return { ...t, users: u };
        });
      }
      return rows;
    }),
    count: vi.fn(async ({ where }: any) => {
      let rows = [...tenants.values()];
      if (where?.blockedAt?.not === null)
        rows = rows.filter((t) => t.blockedAt != null);
      else if (where?.blockedAt === null)
        rows = rows.filter((t) => t.blockedAt === null);
      return rows.length;
    }),
    create: vi.fn(async ({ data }: any) => {
      const t: FakeTenant = {
        id: randomUUID(),
        name: data.name,
        plan: data.plan ?? null,
        fiscalProfile: data.fiscalProfile ?? null,
        holdedAuthMode: data.holdedAuthMode ?? "API_KEY",
        holdedApiKeyCiphertext: null,
        blockedAt: null,
        blockedReason: null,
        createdAt: new Date(),
        initialSyncStatus: "PENDING",
        lastIncrementalSyncAt: null,
      };
      tenants.set(t.id, t);
      return t;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const t = tenants.get(where.id);
      if (!t) throw new Error("tenant not found");
      if (data.name !== undefined) t.name = data.name;
      if (data.plan !== undefined) t.plan = data.plan;
      if (data.fiscalProfile !== undefined) t.fiscalProfile = data.fiscalProfile;
      if (data.blockedAt !== undefined) t.blockedAt = data.blockedAt;
      if (data.blockedReason !== undefined) t.blockedReason = data.blockedReason;
      return t;
    }),
  },
  superAdminUser: {
    findUnique: vi.fn(async ({ where, select }: any) => {
      let sa: FakeSuperAdmin | undefined;
      if (where.id) sa = superAdmins.get(where.id);
      else if (where.email) {
        for (const s of superAdmins.values()) if (s.email === where.email) sa = s;
      }
      if (!sa) return null;
      if (select) {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(select)) out[k] = (sa as any)[k];
        return out;
      }
      return sa;
    }),
    findUniqueOrThrow: vi.fn(async ({ where, select }: any) => {
      const sa = superAdmins.get(where.id);
      if (!sa) throw new Error("super-admin not found");
      if (select) {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(select)) out[k] = (sa as any)[k];
        return out;
      }
      return sa;
    }),
    update: vi.fn(async ({ where, data, select }: any) => {
      const sa = superAdmins.get(where.id);
      if (!sa) throw new Error("super-admin not found");
      if (data.tokenVersion?.increment != null)
        sa.tokenVersion += data.tokenVersion.increment;
      if (data.lastLoginAt !== undefined) sa.lastLoginAt = data.lastLoginAt;
      if (data.totpSecret !== undefined) sa.totpSecret = data.totpSecret;
      if (data.totpEnabledAt !== undefined) sa.totpEnabledAt = data.totpEnabledAt;
      if (data.recoveryCodes !== undefined) sa.recoveryCodes = data.recoveryCodes;
      if (data.passwordHash !== undefined) sa.passwordHash = data.passwordHash;
      return select?.tokenVersion ? { tokenVersion: sa.tokenVersion } : sa;
    }),
    create: vi.fn(async ({ data }: any) => {
      const sa: FakeSuperAdmin = {
        id: randomUUID(),
        email: data.email,
        passwordHash: data.passwordHash,
        tokenVersion: 0,
        totpSecret: null,
        totpEnabledAt: null,
        recoveryCodes: null,
        lastLoginAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      superAdmins.set(sa.id, sa);
      return sa;
    }),
  },
  superAdminAudit: {
    create: vi.fn(async ({ data }: any) => {
      const a: FakeAudit = {
        id: randomUUID(),
        superAdminId: data.superAdminId,
        action: data.action,
        tenantId: data.tenantId ?? null,
        metadata: data.metadata ?? null,
        createdAt: new Date(),
      };
      audits.push(a);
      return a;
    }),
    findMany: vi.fn(async ({ where, orderBy, skip, take }: any) => {
      let rows = [...audits];
      if (where?.action) rows = rows.filter((a) => a.action === where.action);
      if (where?.tenantId) rows = rows.filter((a) => a.tenantId === where.tenantId);
      if (where?.superAdminId)
        rows = rows.filter((a) => a.superAdminId === where.superAdminId);
      rows = matchOrder(rows, orderBy);
      if (skip) rows = rows.slice(skip);
      if (take) rows = rows.slice(0, take);
      return rows.map((a) => ({
        ...a,
        superAdmin: { email: superAdmins.get(a.superAdminId)?.email ?? "?" },
      }));
    }),
    count: vi.fn(async () => audits.length),
  },
  ticket: {
    count: vi.fn(async () => 0),
  },
  store: {
    count: vi.fn(async () => 0),
  },
  shift: {
    count: vi.fn(async () => 0),
  },
  $transaction: vi.fn(async (fn: any) => {
    // Pasamos el propio fakePrisma como TransactionClient.
    return fn(fakePrisma);
  }),
} as any;

const fakeRedis: any = {
  incr: vi.fn(async () => 1),
  expire: vi.fn(async () => 1),
  ttl: vi.fn(async () => -2),
  set: vi.fn(async () => "OK"),
  get: vi.fn(async () => null),
  del: vi.fn(async () => 1),
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => fakeRedis,
  shutdown: async () => undefined,
}));

// Email sender — mock para verificar que crear-tenant envía el welcome.
const sentEmails: Array<{ to: string; subject: string; text: string }> = [];
vi.mock("../src/email/sender.js", () => ({
  getEmailSender: () => ({
    send: async (e: { to: string; subject: string; text: string }) => {
      sentEmails.push(e);
    },
  }),
  setEmailSender: () => undefined,
}));

// Stub el queue de incremental-sync para no abrir BullMQ.
vi.mock("../src/queues/catalog-incremental.js", () => ({
  enqueueManualSync: vi.fn(async () => ({ jobId: "stub-job-id" })),
}));

const { registerSuperAdminRoutes, registerTenantBlockGuard } = await import(
  "../src/superadmin/routes.js"
);
const { registerAuthRoutes } = await import("../src/auth/routes.js");
const { hashPassword } = await import("../src/auth/passwords.js");
const { signAccessToken } = await import("../src/auth/tokens.js");

const SA_ID = "00000000-0000-0000-0000-0000000000aa";
const SA_EMAIL = "matias@mipiace.es";
const SA_PASSWORD = "superAdminSecret1234";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const OWNER_ID = "00000000-0000-0000-0000-000000000099";

beforeEach(async () => {
  users.clear();
  tenants.clear();
  superAdmins.clear();
  audits.length = 0;
  sentEmails.length = 0;
  vi.clearAllMocks();
  superAdmins.set(SA_ID, {
    id: SA_ID,
    email: SA_EMAIL,
    passwordHash: await hashPassword(SA_PASSWORD),
    tokenVersion: 0,
    totpSecret: null,
    totpEnabledAt: null,
    recoveryCodes: null,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  tenants.set(TENANT_ID, {
    id: TENANT_ID,
    name: "Existing biz",
    plan: "pilot",
    fiscalProfile: null,
    holdedAuthMode: "API_KEY",
    holdedApiKeyCiphertext: null,
    blockedAt: null,
    blockedReason: null,
    createdAt: new Date(),
    initialSyncStatus: "PENDING",
    lastIncrementalSyncAt: null,
  });
  users.set(OWNER_ID, {
    id: OWNER_ID,
    tenantId: TENANT_ID,
    email: "owner@existing.biz",
    passwordHash: await hashPassword("ownerSecret1"),
    role: "OWNER",
    tokenVersion: 0,
    mustChangePasswordAt: null,
    lastLoginAt: null,
    createdAt: new Date(),
    twoFactorSecret: null,
    twoFactorEnabledAt: null,
    twoFactorRecoveryCodes: null,
  });
});

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerTenantBlockGuard(app);
  await registerSuperAdminRoutes(app);
  await registerAuthRoutes(app);
  return app;
}

async function loginSA(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/super-admin/auth/login",
    payload: { email: SA_EMAIL, password: SA_PASSWORD },
  });
  expect(res.statusCode).toBe(200);
  return res.json().accessToken as string;
}

describe("super-admin · auth", () => {
  it("login OK devuelve access + refresh", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/super-admin/auth/login",
      payload: { email: SA_EMAIL, password: SA_PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accessToken).toBeTruthy();
    expect(res.json().refreshToken).toBeTruthy();
  });

  it("password mala devuelve 401 genérico", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/super-admin/auth/login",
      payload: { email: SA_EMAIL, password: "wrong" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("INVALID_CREDENTIALS");
  });

  it("logout incrementa tokenVersion (refresh posterior falla)", async () => {
    const app = await buildApp();
    const login = await app.inject({
      method: "POST",
      url: "/super-admin/auth/login",
      payload: { email: SA_EMAIL, password: SA_PASSWORD },
    });
    const access = login.json().accessToken;
    const refresh = login.json().refreshToken;
    await app.inject({
      method: "POST",
      url: "/super-admin/auth/logout",
      headers: { authorization: `Bearer ${access}` },
      payload: {},
    });
    const refRes = await app.inject({
      method: "POST",
      url: "/super-admin/auth/refresh",
      payload: { refreshToken: refresh },
    });
    expect(refRes.statusCode).toBe(401);
  });
});

describe("super-admin · isolation", () => {
  it("OWNER no puede llamar /super-admin/tenants (401)", async () => {
    const app = await buildApp();
    const ownerToken = signAccessToken({
      sub: OWNER_ID,
      tid: TENANT_ID,
      role: "OWNER",
    });
    const res = await app.inject({
      method: "GET",
      url: "/super-admin/tenants",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("super-admin sin Bearer recibe 401", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/super-admin/tenants",
    });
    expect(res.statusCode).toBe(401);
  });
});

// B-OnboardingV2 refactorizó POST /super-admin/tenants (apiKey-only DRAFT
// + activate aparte). Los tests del flow legacy quedan skipped — su
// cobertura se traslada a `onboarding-v2.test.ts` con mocks de
// listWarehouses y del computeOnboardingHealth.
describe.skip("super-admin · crear tenant (legacy flow B-SuperAdmin)", () => {
  it("rechaza NIF inválido con 400", async () => {
    const app = await buildApp();
    const sa = await loginSA(app);
    const res = await app.inject({
      method: "POST",
      url: "/super-admin/tenants",
      headers: { authorization: `Bearer ${sa}` },
      payload: {
        name: "Test SL",
        fiscalNif: "12345678A", // letra incorrecta
        ownerEmail: "new@test.com",
        ownerName: "Test",
        plan: "pilot",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_FISCAL_NIF");
  });

  it("crea tenant + OWNER atómico, envía email, devuelve tempPassword", async () => {
    const app = await buildApp();
    const sa = await loginSA(app);
    const res = await app.inject({
      method: "POST",
      url: "/super-admin/tenants",
      headers: { authorization: `Bearer ${sa}` },
      payload: {
        name: "Thalia SL",
        fiscalNif: "12345678Z", // válido
        ownerEmail: "thalia@example.com",
        ownerName: "Maria",
        plan: "pilot",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.tempPassword).toBeTruthy();
    expect(body.tempPassword).toHaveLength(16);
    expect(body.ownerEmail).toBe("thalia@example.com");
    // Email enviado
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]!.to).toBe("thalia@example.com");
    expect(sentEmails[0]!.text).toContain(body.tempPassword);
    // OWNER creado con mustChangePasswordAt
    const owner = [...users.values()].find((u) => u.email === "thalia@example.com");
    expect(owner).toBeTruthy();
    expect(owner!.mustChangePasswordAt).not.toBeNull();
    // Audit log create_tenant
    expect(audits.some((a) => a.action === "create_tenant")).toBe(true);
  });

  it("email duplicado devuelve 409", async () => {
    const app = await buildApp();
    const sa = await loginSA(app);
    const payload = {
      name: "Distinto SL",
      fiscalNif: "12345678Z",
      ownerEmail: "owner@existing.biz", // ya existe en seed
      ownerName: "Test",
      plan: "pilot",
    };
    const res = await app.inject({
      method: "POST",
      url: "/super-admin/tenants",
      headers: { authorization: `Bearer ${sa}` },
      payload,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("EMAIL_TAKEN");
  });
});

describe("super-admin · bloqueo / desbloqueo", () => {
  it("bloquear sin reason devuelve 400", async () => {
    const app = await buildApp();
    const sa = await loginSA(app);
    const res = await app.inject({
      method: "PATCH",
      url: `/super-admin/tenants/${TENANT_ID}/status`,
      headers: { authorization: `Bearer ${sa}` },
      payload: { blocked: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it("bloquear → OWNER recibe 423 en su próxima request; desbloquear → vuelve a funcionar", async () => {
    const app = await buildApp();
    const sa = await loginSA(app);

    // Owner /auth/me funciona antes de bloquear.
    const ownerToken = signAccessToken({
      sub: OWNER_ID,
      tid: TENANT_ID,
      role: "OWNER",
    });
    const okBefore = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(okBefore.statusCode).toBe(200);

    // Bloquear.
    const block = await app.inject({
      method: "PATCH",
      url: `/super-admin/tenants/${TENANT_ID}/status`,
      headers: { authorization: `Bearer ${sa}` },
      payload: { blocked: true, reason: "Cliente dejó de pagar" },
    });
    expect(block.statusCode).toBe(200);
    expect(block.json().blocked).toBe(true);

    // Ahora 423.
    const blocked = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(blocked.statusCode).toBe(423);
    expect(blocked.json().code).toBe("TENANT_BLOCKED");
    expect(blocked.json().reason).toBe("Cliente dejó de pagar");

    // Audit block_tenant grabado.
    expect(audits.some((a) => a.action === "block_tenant")).toBe(true);

    // Desbloquear.
    const unblock = await app.inject({
      method: "PATCH",
      url: `/super-admin/tenants/${TENANT_ID}/status`,
      headers: { authorization: `Bearer ${sa}` },
      payload: { blocked: false },
    });
    expect(unblock.statusCode).toBe(200);

    // Owner vuelve a 200.
    const okAfter = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(okAfter.statusCode).toBe(200);
    expect(audits.some((a) => a.action === "unblock_tenant")).toBe(true);
  });
});

describe("super-admin · force-logout", () => {
  it("incrementa tokenVersion de todos los users del tenant + audit", async () => {
    const app = await buildApp();
    const sa = await loginSA(app);
    const before = users.get(OWNER_ID)!.tokenVersion;
    const res = await app.inject({
      method: "POST",
      url: `/super-admin/tenants/${TENANT_ID}/force-logout`,
      headers: { authorization: `Bearer ${sa}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().usersAffected).toBeGreaterThanOrEqual(1);
    expect(users.get(OWNER_ID)!.tokenVersion).toBe(before + 1);
    expect(audits.some((a) => a.action === "force_logout")).toBe(true);
  });
});

describe("super-admin · impersonation read-only", () => {
  it("GET con JWT impersonation pasa; POST/PATCH/DELETE devuelven 403 IMPERSONATION_READONLY", async () => {
    const app = await buildApp();
    const sa = await loginSA(app);
    const imp = await app.inject({
      method: "POST",
      url: `/super-admin/tenants/${TENANT_ID}/impersonate`,
      headers: { authorization: `Bearer ${sa}` },
    });
    expect(imp.statusCode).toBe(200);
    const token = imp.json().impersonationToken as string;
    expect(token).toBeTruthy();
    // Mode default = readonly (compat con clientes sin body).
    expect(imp.json().mode).toBe("readonly");

    // GET /auth/me funciona con el JWT impersonation.
    const get = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(get.statusCode).toBe(200);

    // POST → 403 IMPERSONATION_READONLY.
    const post = await app.inject({
      method: "POST",
      url: "/auth/logout-everywhere",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(post.statusCode).toBe(403);
    expect(post.json().code).toBe("IMPERSONATION_READONLY");

    // Audit impersonate grabado.
    expect(audits.some((a) => a.action === "impersonate")).toBe(true);
  });
});

// v1.3-SuperAdmin-Hub Lote 1 · 3 casos del modo "full". Cubre el
// guard que ahora vive en handleImpersonationMutation: readonly+write
// rebota, full+write registra impersonate_write y deja pasar, full+read
// no genera ruido en el log.
describe("super-admin · impersonate mode=full (Lote 1)", () => {
  async function mintFullToken(app: FastifyInstance): Promise<string> {
    const sa = await loginSA(app);
    const imp = await app.inject({
      method: "POST",
      url: `/super-admin/tenants/${TENANT_ID}/impersonate`,
      headers: { authorization: `Bearer ${sa}` },
      payload: { mode: "full" },
    });
    expect(imp.statusCode).toBe(200);
    expect(imp.json().mode).toBe("full");
    return imp.json().impersonationToken as string;
  }

  it("(caso 1) readonly + mutación → 403 IMPERSONATION_READONLY", async () => {
    const app = await buildApp();
    const sa = await loginSA(app);
    const readonly = await app.inject({
      method: "POST",
      url: `/super-admin/tenants/${TENANT_ID}/impersonate`,
      headers: { authorization: `Bearer ${sa}` },
      payload: { mode: "readonly" },
    });
    expect(readonly.statusCode).toBe(200);
    const token = readonly.json().impersonationToken as string;

    const post = await app.inject({
      method: "POST",
      url: "/auth/logout-everywhere",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(post.statusCode).toBe(403);
    expect(post.json().code).toBe("IMPERSONATION_READONLY");
    // El intento bloqueado NO genera impersonate_write.
    expect(audits.some((a) => a.action === "impersonate_write")).toBe(false);
  });

  it("(caso 2) full + mutación → 200 + audit impersonate_write", async () => {
    const app = await buildApp();
    const token = await mintFullToken(app);

    const post = await app.inject({
      method: "POST",
      url: "/auth/logout-everywhere",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(post.statusCode).toBe(200);

    const write = audits.find((a) => a.action === "impersonate_write");
    expect(write).toBeTruthy();
    expect(write!.tenantId).toBe(TENANT_ID);
    expect(write!.superAdminId).toBe(SA_ID);
    const md = write!.metadata as {
      route: string;
      method: string;
    };
    expect(md.route).toBe("/auth/logout-everywhere");
    expect(md.method).toBe("POST");

    // El audit `impersonate` original también lleva mode=full.
    const issue = audits.find((a) => a.action === "impersonate");
    expect((issue!.metadata as { mode?: string }).mode).toBe("full");
  });

  it("(caso 3) full + lectura → 200 sin audit impersonate_write", async () => {
    const app = await buildApp();
    const token = await mintFullToken(app);

    const get = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(get.statusCode).toBe(200);
    // Las lecturas NO ensucian el log con impersonate_write — sólo se
    // registra el primer "impersonate" al abrir la sesión.
    expect(audits.some((a) => a.action === "impersonate_write")).toBe(false);
    expect(audits.some((a) => a.action === "impersonate")).toBe(true);
  });
});

describe("super-admin · auditoría", () => {
  it("GET /super-admin/audit lista las acciones; filtra por action", async () => {
    const app = await buildApp();
    const sa = await loginSA(app);

    // Genera 2 acciones: force-logout + block.
    await app.inject({
      method: "POST",
      url: `/super-admin/tenants/${TENANT_ID}/force-logout`,
      headers: { authorization: `Bearer ${sa}` },
    });
    await app.inject({
      method: "PATCH",
      url: `/super-admin/tenants/${TENANT_ID}/status`,
      headers: { authorization: `Bearer ${sa}` },
      payload: { blocked: true, reason: "x" },
    });

    const all = await app.inject({
      method: "GET",
      url: "/super-admin/audit",
      headers: { authorization: `Bearer ${sa}` },
    });
    expect(all.statusCode).toBe(200);
    const items = all.json().items as Array<{ action: string }>;
    expect(items.length).toBeGreaterThanOrEqual(2);

    const filtered = await app.inject({
      method: "GET",
      url: "/super-admin/audit?action=block_tenant",
      headers: { authorization: `Bearer ${sa}` },
    });
    const filteredItems = filtered.json().items as Array<{ action: string }>;
    expect(filteredItems.every((i) => i.action === "block_tenant")).toBe(true);
  });
});

describe("super-admin · must-change-password en login del OWNER", () => {
  it("OWNER con mustChangePasswordAt: login devuelve pendingPasswordChangeToken; tras cambiar emite tokens normales", async () => {
    const app = await buildApp();
    // B-OnboardingV2: el OWNER ya no se crea en POST /super-admin/tenants
    // (ahora DRAFT sin OWNER). Lo creamos directamente en el seed con
    // mustChangePasswordAt poblado — el flow real lo crea en
    // POST /super-admin/tenants/:id/activate y el resto del comportamiento
    // (login → pending → change) es idéntico, así que con este fixture
    // cubrimos la lógica de auth.
    const tempPassword = "TempPw-Init-2026!";
    const { hashPassword } = await import("../src/auth/passwords.js");
    const passwordHash = await hashPassword(tempPassword);
    users.set("user-change", {
      id: "user-change",
      tenantId: TENANT_ID,
      email: "change@me.com",
      passwordHash,
      role: "OWNER",
      tokenVersion: 0,
      mustChangePasswordAt: new Date(),
      lastLoginAt: null,
      createdAt: new Date(),
      twoFactorSecret: null,
      twoFactorEnabledAt: null,
      twoFactorRecoveryCodes: null,
    });

    // Login con temporal → mustChangePassword.
    const step1 = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "change@me.com", password: tempPassword },
    });
    expect(step1.statusCode).toBe(200);
    expect(step1.json().mustChangePassword).toBe(true);
    const pending = step1.json().pendingPasswordChangeToken as string;
    expect(pending).toBeTruthy();

    // Cambiar contraseña inicial.
    const step2 = await app.inject({
      method: "POST",
      url: "/auth/change-password-initial",
      payload: { pendingPasswordChangeToken: pending, newPassword: "NuevaPwSegura2026" },
    });
    expect(step2.statusCode).toBe(200);
    expect(step2.json().accessToken).toBeTruthy();
    expect(step2.json().refreshToken).toBeTruthy();

    // Login con la nueva password ahora emite tokens normales.
    const step3 = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "change@me.com", password: "NuevaPwSegura2026" },
    });
    expect(step3.statusCode).toBe(200);
    expect(step3.json().accessToken).toBeTruthy();
  });
});
