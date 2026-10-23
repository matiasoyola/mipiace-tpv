// primer-acceso · «REENVIAR INVITACIÓN» DESDE EL SUPER-ADMIN.
//
// Es el botón de la llamada: el correo no ha llegado, o el enlace caducó,
// y hay que darle otro al cliente por otro canal.
//
// ── Y ES LO QUE SALVA LO QUE YA HAY EN PRODUCCIÓN ──────────────────
//
// Jardín de Gredos se activó el 23-10-2026 con el flujo viejo: su OWNER
// tiene una contraseña provisional y `mustChangePasswordAt` puesto. El
// test nº 2 es exactamente ese caso, y es lo que hace que el despliegue
// no necesite tocar la base a mano.
//
// Lo que fija:
//   1. Reenvía, anula la anterior y devuelve el enlace para copiarlo.
//   2. Con un OWNER del flujo viejo, ANULA la provisional.
//   3. A un propietario que ya eligió su contraseña se NIEGA (409) y dice
//      qué hacer en su lugar.
//   4. La auditoría queda escrita SIN el token ni el enlace.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.SUPER_ADMIN_JWT_SECRET = "s".repeat(48);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
process.env.PUBLIC_ADMIN_URL = "http://localhost:5173";

import Fastify, { type FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SUPER_ADMIN_ID = "11111111-1111-1111-1111-111111111111";
const TENANT_ID = "22222222-2222-2222-2222-222222222222";
const OWNER_ID = "33333333-3333-3333-3333-333333333333";

interface FakeUser {
  id: string;
  tenantId: string;
  email: string;
  alias: string | null;
  role: string;
  passwordHash: string | null;
  pinHash: string | null;
  mustChangePasswordAt: Date | null;
  tokenVersion: number;
  isTestCashier: boolean;
  deletedAt: Date | null;
  createdAt: Date;
}

const users = new Map<string, FakeUser>();
const tokens: any[] = [];
const audits: Array<{ action: string; metadata: any }> = [];
const sentEmails: Array<{ to: string; subject: string; text: string; html?: string }> = [];

const tenant = {
  id: TENANT_ID,
  name: "Jardín de Gredos",
  fiscalProfile: { legalName: "Jardín de Gredos, S.A." },
  residenciaEnabled: true,
  holdedApiKeyCiphertext: null as string | null,
};

vi.mock("../src/superadmin/onboarding-health.js", () => ({
  computeOnboardingHealth: vi.fn(async () => ({ ready: true, readinessChecks: [] })),
}));
vi.mock("../src/superadmin/test-cashier.js", () => ({
  purgeTestData: vi.fn(async () => ({
    ticketsTestPurged: 0,
    emailJobsPurged: 0,
    cashierDeleted: false,
    deviceRevoked: false,
  })),
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
    findUnique: vi.fn(async ({ where, select }: any) => {
      if (where.id !== TENANT_ID) return null;
      const fila: any = { ...tenant };
      if (select?.users) {
        const w = select.users.where ?? {};
        fila.users = [...users.values()].filter((u) => {
          if (w.role && u.role !== w.role) return false;
          if (w.deletedAt === null && u.deletedAt != null) return false;
          return true;
        });
      }
      return fila;
    }),
    findUniqueOrThrow: vi.fn(async () => ({ ...tenant })),
    findFirst: vi.fn(async () => null),
    update: vi.fn(async ({ data }: any) => Object.assign(tenant, data)),
  },
  user: {
    findUnique: vi.fn(async ({ where }: any) =>
      where.id
        ? users.get(where.id) ?? null
        : [...users.values()].find((u) => u.email === where.email) ?? null,
    ),
    findFirst: vi.fn(async () => null),
    create: vi.fn(async ({ data }: any) => {
      const u: FakeUser = {
        id: randomUUID(),
        tenantId: data.tenantId,
        email: data.email,
        alias: data.alias ?? null,
        role: data.role,
        passwordHash: data.passwordHash ?? null,
        pinHash: data.pinHash ?? null,
        mustChangePasswordAt: data.mustChangePasswordAt ?? null,
        tokenVersion: 0,
        isTestCashier: false,
        deletedAt: null,
        createdAt: new Date(),
      };
      users.set(u.id, u);
      return { id: u.id, email: u.email };
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const u = users.get(where.id)!;
      for (const k of ["passwordHash", "mustChangePasswordAt", "alias"]) {
        if (data[k] !== undefined) (u as any)[k] = data[k];
      }
      if (data.tokenVersion?.increment != null)
        u.tokenVersion += data.tokenVersion.increment;
      return u;
    }),
  },
  passwordResetToken: {
    create: vi.fn(async ({ data }: any) => {
      const t = { id: randomUUID(), usedAt: null, ...data };
      tokens.push(t);
      return t;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let n = 0;
      for (const t of tokens) {
        if (where.userId && t.userId !== where.userId) continue;
        if (where.type && t.type !== where.type) continue;
        if (where.usedAt === null && t.usedAt != null) continue;
        if (data.usedAt !== undefined) t.usedAt = data.usedAt;
        n++;
      }
      return { count: n };
    }),
    findFirst: vi.fn(async () => null),
    findMany: vi.fn(async () => []),
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
const { hashPassword } = await import("../src/auth/passwords.js");

const lineasDeLog: string[] = [];

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: "info",
      stream: {
        write(l: string) {
          lineasDeLog.push(l);
        },
      },
    },
  });
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

function reenviar(app: FastifyInstance) {
  return app.inject({
    method: "POST",
    url: `/super-admin/tenants/${TENANT_ID}/reenviar-invitacion`,
    headers: { authorization: `Bearer ${sa()}` },
  });
}

function sembrarOwner(over: Partial<FakeUser> = {}): void {
  users.set(OWNER_ID, {
    id: OWNER_ID,
    tenantId: TENANT_ID,
    email: "carmen@jardindegredos.es",
    alias: "Carmen",
    role: "OWNER",
    passwordHash: null,
    pinHash: null,
    mustChangePasswordAt: null,
    tokenVersion: 0,
    isTestCashier: false,
    deletedAt: null,
    createdAt: new Date(),
    ...over,
  });
}

beforeEach(() => {
  users.clear();
  tokens.length = 0;
  audits.length = 0;
  sentEmails.length = 0;
  lineasDeLog.length = 0;
});

describe("POST /super-admin/tenants/:id/reenviar-invitacion", () => {
  it("manda una nueva, anula la anterior y devuelve el enlace", async () => {
    sembrarOwner();
    tokens.push({
      id: "viejo",
      userId: OWNER_ID,
      type: "INVITE",
      tokenHash: "x",
      expiresAt: new Date(Date.now() + 86_400_000),
      usedAt: null,
    });
    const app = await buildApp();
    const res = await reenviar(app);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.invitacion.email).toBe("carmen@jardindegredos.es");
    expect(body.invitacion.enlace).toContain("/bienvenida?token=");
    expect(body.emailEnviado).toBe(true);
    // La anterior queda marcada como usada: ya no vale.
    expect(tokens.find((t) => t.id === "viejo")!.usedAt).not.toBeNull();
    // Y hay una nueva viva.
    expect(tokens.filter((t) => t.type === "INVITE" && t.usedAt == null)).toHaveLength(1);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]!.text).toContain(body.invitacion.enlace);
  });

  it("con un OWNER del flujo viejo, ANULA la contraseña provisional", async () => {
    sembrarOwner({
      passwordHash: await hashPassword("provisional-rara-16"),
      mustChangePasswordAt: new Date(),
    });
    const app = await buildApp();
    const res = await reenviar(app);
    expect(res.statusCode).toBe(200);
    expect(res.json().anulabaProvisional).toBe(true);
    const owner = users.get(OWNER_ID)!;
    // La provisional ya no sirve para entrar: `/auth/login` rechaza un
    // usuario sin hash con su 401 genérico.
    expect(owner.passwordHash).toBeNull();
    expect(owner.mustChangePasswordAt).toBeNull();
    // Y las sesiones en vuelo, invalidadas.
    expect(owner.tokenVersion).toBe(1);
  });

  it("se NIEGA con un propietario que ya eligió su contraseña", async () => {
    sembrarOwner({ passwordHash: await hashPassword("la-suya-de-siempre-1") });
    const app = await buildApp();
    const res = await reenviar(app);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("YA_TIENE_CONTRASENA");
    // Y dice qué hacer en su lugar, que es lo que necesita quien está en
    // la llamada.
    expect(res.json().message).toMatch(/Olvidaste tu contraseña/);
    // Lo importante: NO le ha quitado la contraseña.
    expect(users.get(OWNER_ID)!.passwordHash).not.toBeNull();
    expect(tokens).toHaveLength(0);
    expect(sentEmails).toHaveLength(0);
  });

  it("409 claro cuando la cuenta todavía no tiene propietario", async () => {
    const app = await buildApp();
    const res = await reenviar(app);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("SIN_PROPIETARIO");
  });

  it("la auditoría queda escrita SIN el token ni el enlace", async () => {
    sembrarOwner();
    const app = await buildApp();
    const res = await reenviar(app);
    const enlace = res.json().invitacion.enlace;
    const token = enlace.split("token=")[1];
    const a = audits.find((x) => x.action === "reenviar_invitacion")!;
    expect(a).toBeTruthy();
    expect(a.metadata.ownerEmail).toBe("carmen@jardindegredos.es");
    expect(a.metadata.anulabaProvisional).toBe(false);
    const comoTexto = JSON.stringify(a.metadata);
    expect(comoTexto).not.toContain(token);
    expect(comoTexto).not.toContain(enlace);
    // Ni en el log.
    expect(lineasDeLog.join("\n")).not.toContain(token);
  });

  it("el correo de la residencia no dice «Mipiacetpv»", async () => {
    sembrarOwner();
    const app = await buildApp();
    await reenviar(app);
    expect(sentEmails[0]!.text).not.toMatch(/Mipiacetpv/);
    expect(sentEmails[0]!.text).toContain("Jardín de Gredos, S.A.");
  });
});
