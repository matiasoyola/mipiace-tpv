// F1 · el alta y el gobierno del cuarto módulo desde el super-admin.
//
// Lo que este banco fija:
//
//   1. Una empresa se da de alta con el control horario como ÚNICO módulo.
//      Es el alta del colegio de Talavera, tal cual: sin caja, sin CRM,
//      sin agenda, sin Holded.
//   2. El invariante de H1 cuenta el cuarto: cero módulos sigue siendo un
//      400, y apagarle la caja a quien sólo ficha deja de serlo.
//   3. El default del alta NO cambia: quien no diga nada sigue naciendo
//      con caja y sin control horario.
//   4. La auditoría deja dicho con qué módulos nació la empresa.
//
// Sabotajes que este fichero pone en rojo (§3 del done):
//   · dejar `fichajeEnabled` fuera de MODULE_FIELDS (el invariante dejaría
//     de contarlo y el colegio no se podría dar de alta)
//   · cambiar el default del alta a `true`

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

const tenants = new Map<string, any>();
const audits: Array<{ action: string; metadata: any }> = [];

vi.mock("@mipiacetpv/holded-client", async (orig) => {
  const real = await orig<typeof import("@mipiacetpv/holded-client")>();
  return { ...real, listWarehouses: vi.fn(async () => []) };
});
vi.mock("../src/queues/initial-sync.js", () => ({
  enqueueInitialSync: vi.fn(async () => undefined),
}));
vi.mock("../src/queues/catalog-incremental.js", () => ({
  enqueueManualSync: vi.fn(async () => ({ jobId: "x" })),
  registerTenantRepeatable: vi.fn(async () => undefined),
}));
vi.mock("../src/email/sender.js", () => ({
  getEmailSender: () => ({ send: vi.fn(async () => undefined) }),
}));

const fakePrisma: any = {
  tenant: {
    findUnique: vi.fn(async ({ where }: any) => tenants.get(where.id) ?? null),
    findUniqueOrThrow: vi.fn(async ({ where }: any) => {
      const t = tenants.get(where.id);
      if (!t) throw new Error("not found");
      return t;
    }),
    findFirst: vi.fn(async () => null),
    create: vi.fn(async ({ data }: any) => {
      const t = {
        id: randomUUID(),
        name: data.name,
        plan: data.plan ?? null,
        fiscalProfile: data.fiscalProfile,
        holdedApiKeyCiphertext: data.holdedApiKeyCiphertext ?? null,
        holdedAccountId: data.holdedAccountId ?? null,
        holdedAuthMode: data.holdedAuthMode ?? "API_KEY",
        onboardingState: data.onboardingState ?? "DRAFT",
        businessType: data.businessType ?? "RETAIL",
        initialSyncStatus: data.initialSyncStatus ?? "PENDING",
        cajaEnabled: data.cajaEnabled ?? true,
        crmEnabled: data.crmEnabled ?? false,
        agendaEnabled: data.agendaEnabled ?? false,
        fichajeEnabled: data.fichajeEnabled ?? false,
        holdedEnabled: data.holdedEnabled ?? true,
        createdAt: new Date(),
      };
      tenants.set(t.id, t);
      return t;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const t = tenants.get(where.id)!;
      Object.assign(t, data);
      return t;
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
  $queryRaw: vi.fn(async () => [] as Array<{ id: string }>),
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

function post(app: FastifyInstance, payload: unknown) {
  return app.inject({
    method: "POST",
    url: "/super-admin/tenants",
    headers: { authorization: `Bearer ${sa()}` },
    payload: payload as never,
  });
}

function patch(app: FastifyInstance, id: string, payload: unknown) {
  return app.inject({
    method: "PATCH",
    url: `/super-admin/tenants/${id}`,
    headers: { authorization: `Bearer ${sa()}` },
    payload: payload as never,
  });
}

// El alta del colegio, literal: lo único que tiene es el control horario.
const COLEGIO = {
  legalName: "Colegio de Talavera SL",
  taxId: "12345678Z",
  cajaEnabled: false,
  crmEnabled: false,
  agendaEnabled: false,
  fichajeEnabled: true,
  holdedEnabled: false,
};

beforeEach(() => {
  tenants.clear();
  audits.length = 0;
  vi.clearAllMocks();
});

describe("F1 · alta con el control horario como único módulo", () => {
  it("se crea, sin caja y sin Holded", async () => {
    const app = await buildApp();
    const res = await post(app, COLEGIO);
    expect(res.statusCode).toBe(201);
    expect(res.json().tenant.modules).toEqual({
      caja: false,
      crm: false,
      agenda: false,
      fichaje: true,
    });
    const t = [...tenants.values()][0]!;
    expect(t.fichajeEnabled).toBe(true);
    expect(t.cajaEnabled).toBe(false);
    expect(t.initialSyncStatus).toBe("NOT_APPLICABLE");
    await app.close();
  });

  it("la auditoría del alta lo deja dicho", async () => {
    const app = await buildApp();
    await post(app, COLEGIO);
    const a = audits.find((x) => x.action === "create_tenant_draft")!;
    expect(a.metadata.modules.fichaje).toBe(true);
    await app.close();
  });

  // El default no cambia para nadie: quien no diga nada sigue naciendo
  // con caja y SIN control horario.
  it("el default del alta sigue siendo caja y nada más", async () => {
    const app = await buildApp();
    const res = await post(app, {
      legalName: "Bar de siempre SL",
      taxId: "12345678Z",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().tenant.modules).toEqual({
      caja: true,
      crm: false,
      agenda: false,
      fichaje: false,
    });
    await app.close();
  });

  it("cero módulos sigue siendo un 400, y el mensaje nombra el cuarto", async () => {
    const app = await buildApp();
    const res = await post(app, {
      legalName: "Empresa vacía SL",
      taxId: "12345678Z",
      cajaEnabled: false,
      fichajeEnabled: false,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("NO_MODULES_ENABLED");
    expect(res.json().message).toMatch(/control horario/i);
    await app.close();
  });
});

describe("F1 · el módulo se mueve después del alta", () => {
  async function crearColegio(app: FastifyInstance): Promise<string> {
    const res = await post(app, COLEGIO);
    return res.json().tenant.id;
  }

  it("el super-admin lo enciende y lo apaga", async () => {
    const app = await buildApp();
    const res = await post(app, {
      legalName: "Peluquería Sole SL",
      taxId: "12345678Z",
    });
    const id = res.json().tenant.id;
    const on = await patch(app, id, { fichajeEnabled: true });
    expect(on.statusCode).toBe(200);
    expect(tenants.get(id).fichajeEnabled).toBe(true);
    const off = await patch(app, id, { fichajeEnabled: false });
    expect(off.statusCode).toBe(200);
    expect(tenants.get(id).fichajeEnabled).toBe(false);
    await app.close();
  });

  // La razón de meterlo en MODULE_FIELDS y no en un `if` propio: el
  // invariante lo cuenta solo.
  it("apagarle el control horario a quien SÓLO ficha es un 400", async () => {
    const app = await buildApp();
    const id = await crearColegio(app);
    const res = await patch(app, id, { fichajeEnabled: false });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("NO_MODULES_ENABLED");
    expect(tenants.get(id).fichajeEnabled).toBe(true);
    await app.close();
  });

  it("apagarle la CAJA a quien ya ficha deja de ser un 400", async () => {
    const app = await buildApp();
    const res = await post(app, {
      legalName: "Bar con fichaje SL",
      taxId: "12345678Z",
      fichajeEnabled: true,
    });
    const id = res.json().tenant.id;
    const off = await patch(app, id, { cajaEnabled: false });
    expect(off.statusCode).toBe(200);
    expect(tenants.get(id).cajaEnabled).toBe(false);
    expect(tenants.get(id).fichajeEnabled).toBe(true);
    await app.close();
  });

  it("apagar los dos a la vez sigue siendo un 400", async () => {
    const app = await buildApp();
    const res = await post(app, {
      legalName: "Bar con fichaje SL",
      taxId: "12345678Z",
      fichajeEnabled: true,
    });
    const id = res.json().tenant.id;
    const off = await patch(app, id, {
      cajaEnabled: false,
      fichajeEnabled: false,
    });
    expect(off.statusCode).toBe(400);
    expect(tenants.get(id).cajaEnabled).toBe(true);
    await app.close();
  });
});
