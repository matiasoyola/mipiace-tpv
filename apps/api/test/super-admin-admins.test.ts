// B-Multi-Vertical SB4 · tests del CRUD de super-admins.
//
// Cubre:
//   - GET  /super-admin/admins                   · sólo activos.
//   - POST /super-admin/admins                   · crea + audit + email.
//   - POST /super-admin/admins · email duplicado · 409.
//   - DELETE /super-admin/admins/:id             · 200 + soft-delete.
//   - DELETE /super-admin/admins/:self           · 400 CANNOT_DELETE_SELF.
//   - DELETE /super-admin/admins/:404            · 404.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.SUPER_ADMIN_JWT_SECRET = "s".repeat(48);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
process.env.PUBLIC_ADMIN_URL = "https://admin.test";

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeSuperAdmin {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string;
  tokenVersion: number;
  totpSecret: string | null;
  totpEnabledAt: Date | null;
  recoveryCodes: unknown;
  lastLoginAt: Date | null;
  mustChangePassword: boolean;
  deletedAt: Date | null;
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

const superAdmins = new Map<string, FakeSuperAdmin>();
const audits: FakeAudit[] = [];

const fakePrisma: any = {
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
    findFirst: vi.fn(async ({ where, select }: any) => {
      for (const sa of superAdmins.values()) {
        if (where.email && sa.email !== where.email) continue;
        if (where.deletedAt === null && sa.deletedAt !== null) continue;
        if (select) {
          const out: Record<string, unknown> = {};
          for (const k of Object.keys(select)) out[k] = (sa as any)[k];
          return out;
        }
        return sa;
      }
      return null;
    }),
    findMany: vi.fn(async ({ where, orderBy, select }: any) => {
      let rows = [...superAdmins.values()];
      if (where?.deletedAt === null) {
        rows = rows.filter((sa) => sa.deletedAt === null);
      }
      if (orderBy?.createdAt === "asc") {
        rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      }
      if (select) {
        return rows.map((sa) => {
          const out: Record<string, unknown> = {};
          for (const k of Object.keys(select)) out[k] = (sa as any)[k];
          return out;
        });
      }
      return rows;
    }),
    create: vi.fn(async ({ data, select }: any) => {
      const sa: FakeSuperAdmin = {
        id: randomUUID(),
        email: data.email,
        name: data.name ?? null,
        passwordHash: data.passwordHash,
        tokenVersion: 0,
        totpSecret: null,
        totpEnabledAt: null,
        recoveryCodes: null,
        lastLoginAt: null,
        mustChangePassword: data.mustChangePassword ?? false,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      superAdmins.set(sa.id, sa);
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
      if (data.deletedAt !== undefined) sa.deletedAt = data.deletedAt;
      if (data.tokenVersion?.increment != null)
        sa.tokenVersion += data.tokenVersion.increment;
      if (select) {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(select)) out[k] = (sa as any)[k];
        return out;
      }
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
  },
};

const sentEmails: Array<{ to: string; subject: string; text: string }> = [];

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));

let throwOnSend = false;

vi.mock("../src/email/sender.js", () => ({
  getEmailSender: () => ({
    async send(args: { to: string; subject: string; text: string }) {
      if (throwOnSend) throw new Error("SMTP down");
      sentEmails.push(args);
    },
  }),
}));

const { registerSuperAdminAdminsRoutes } = await import(
  "../src/superadmin/admins.js"
);
const { signSuperAdminAccessToken } = await import(
  "../src/superadmin/tokens.js"
);

const SUPER_ADMIN_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_ID = "22222222-2222-2222-2222-222222222222";

function token(): string {
  const sa = superAdmins.get(SUPER_ADMIN_ID)!;
  return signSuperAdminAccessToken({ sub: sa.id, tv: sa.tokenVersion });
}

async function buildApp() {
  const app = Fastify();
  await registerSuperAdminAdminsRoutes(app);
  return app;
}

beforeEach(() => {
  superAdmins.clear();
  audits.length = 0;
  sentEmails.length = 0;
  throwOnSend = false;
  vi.clearAllMocks();
  superAdmins.set(SUPER_ADMIN_ID, {
    id: SUPER_ADMIN_ID,
    email: "matias@mipiace.es",
    name: "Matías",
    passwordHash: "v1:hash",
    tokenVersion: 0,
    totpSecret: null,
    totpEnabledAt: null,
    recoveryCodes: null,
    lastLoginAt: new Date("2026-05-19T08:00:00Z"),
    mustChangePassword: false,
    deletedAt: null,
    createdAt: new Date("2026-05-12T10:00:00Z"),
    updatedAt: new Date(),
  });
});

describe("GET /super-admin/admins", () => {
  it("devuelve sólo super-admins activos", async () => {
    superAdmins.set(OTHER_ID, {
      ...superAdmins.get(SUPER_ADMIN_ID)!,
      id: OTHER_ID,
      email: "deleted@mipiace.es",
      name: "Borrado",
      deletedAt: new Date(),
      createdAt: new Date("2026-05-14T10:00:00Z"),
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/super-admin/admins",
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].email).toBe("matias@mipiace.es");
    expect(body.items[0].name).toBe("Matías");
    expect(body.items[0].twoFactorEnabled).toBe(false);
    await app.close();
  });

  it("rechaza sin auth → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/super-admin/admins",
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe("POST /super-admin/admins", () => {
  it("crea + audit log + email encolado + devuelve tempPassword", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/super-admin/admins",
      headers: { authorization: `Bearer ${token()}` },
      payload: { email: "nuevo@holded.com", name: "Nuevo Admin" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.admin.email).toBe("nuevo@holded.com");
    expect(body.admin.name).toBe("Nuevo Admin");
    // tempPassword viene de generateTemporaryPassword: 16 chars,
    // alfabeto sin caracteres ambiguos + algunos símbolos.
    expect(typeof body.tempPassword).toBe("string");
    expect(body.tempPassword).toHaveLength(16);
    // Audit log:
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe("create_super_admin");
    expect((audits[0]!.metadata as any).targetEmail).toBe("nuevo@holded.com");
    expect((audits[0]!.metadata as any).targetName).toBe("Nuevo Admin");
    // Email encolado al ConsoleEmailSender mock:
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]!.to).toBe("nuevo@holded.com");
    expect(sentEmails[0]!.text).toContain(body.tempPassword);
    await app.close();
  });

  it("normaliza email a lower-case", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/super-admin/admins",
      headers: { authorization: `Bearer ${token()}` },
      payload: { email: "Mixed.Case@HOLDED.com", name: "Mix" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().admin.email).toBe("mixed.case@holded.com");
    await app.close();
  });

  it("email duplicado entre activos → 409 SUPER_ADMIN_EMAIL_TAKEN", async () => {
    const app = await buildApp();
    const first = await app.inject({
      method: "POST",
      url: "/super-admin/admins",
      headers: { authorization: `Bearer ${token()}` },
      payload: { email: "dup@holded.com", name: "Dup" },
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: "POST",
      url: "/super-admin/admins",
      headers: { authorization: `Bearer ${token()}` },
      payload: { email: "dup@holded.com", name: "Dup 2" },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe("SUPER_ADMIN_EMAIL_TAKEN");
    await app.close();
  });

  it("no falla si el sender lanza — sólo loguea warn", async () => {
    throwOnSend = true;
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/super-admin/admins",
      headers: { authorization: `Bearer ${token()}` },
      payload: { email: "smtpdown@holded.com", name: "X" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().tempPassword).toHaveLength(16);
    expect(sentEmails).toHaveLength(0);
    expect(audits).toHaveLength(1);
    await app.close();
  });
});

describe("DELETE /super-admin/admins/:id", () => {
  it("soft-delete OK + audit + tokenVersion bumpea", async () => {
    superAdmins.set(OTHER_ID, {
      ...superAdmins.get(SUPER_ADMIN_ID)!,
      id: OTHER_ID,
      email: "delete-me@holded.com",
      name: "Delete Me",
      deletedAt: null,
      tokenVersion: 0,
      createdAt: new Date("2026-05-14T10:00:00Z"),
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/super-admin/admins/${OTHER_ID}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
    const after = superAdmins.get(OTHER_ID)!;
    expect(after.deletedAt).not.toBeNull();
    expect(after.tokenVersion).toBe(1);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe("delete_super_admin");
    await app.close();
  });

  it("auto-eliminarse → 400 CANNOT_DELETE_SELF", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/super-admin/admins/${SUPER_ADMIN_ID}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("CANNOT_DELETE_SELF");
    expect(superAdmins.get(SUPER_ADMIN_ID)!.deletedAt).toBeNull();
    expect(audits).toHaveLength(0);
    await app.close();
  });

  it("super-admin inexistente → 404", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/super-admin/admins/${OTHER_ID}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("SUPER_ADMIN_NOT_FOUND");
    await app.close();
  });

  it("super-admin ya soft-deleted → 404", async () => {
    superAdmins.set(OTHER_ID, {
      ...superAdmins.get(SUPER_ADMIN_ID)!,
      id: OTHER_ID,
      email: "ghost@holded.com",
      name: "Ghost",
      deletedAt: new Date("2026-05-15T00:00:00Z"),
      createdAt: new Date("2026-05-14T10:00:00Z"),
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/super-admin/admins/${OTHER_ID}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("rechaza sin auth → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/super-admin/admins/${OTHER_ID}`,
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
