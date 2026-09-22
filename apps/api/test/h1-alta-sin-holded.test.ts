// H1 · dar de alta una empresa sin clave de Holded.
//
// Lo que este banco fija:
//
//   1. Sin clave no se llama a Holded, no se encola nada, el sync sale
//      NOT_APPLICABLE y el nombre se teclea.
//   2. Con clave, todo exactamente como en master: se valida contra
//      Holded, el nombre sale del almacén default, el sync sale PENDING
//      y se encola. Es la prueba de no-regresión del bloque.
//   3. Los módulos se eligen en el alta, con los defaults de hoy, y una
//      empresa sin ninguno no se crea.
//   4. El NIF se valida y su unicidad se comprueba igual con Holded y
//      sin él.
//
// Sabotajes que este fichero pone en rojo (§3 del done):
//   · dejar `holdedApiKey` como required en el alta (nº 1)
//   · encolar el sync inicial sin clave
//   · dejar `initialSyncStatus: PENDING` para la empresa sin Holded
//   · permitir crear una empresa con los tres módulos apagados

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

interface FakeTenant {
  id: string;
  name: string;
  plan: string | null;
  fiscalProfile: any;
  holdedApiKeyCiphertext: string | null;
  holdedAccountId: string | null;
  holdedAuthMode: string;
  onboardingState: string;
  businessType: string;
  initialSyncStatus: string;
  cajaEnabled: boolean;
  crmEnabled: boolean;
  agendaEnabled: boolean;
  // catalogo-local (addendum 3) · el interruptor de Holded.
  holdedEnabled: boolean;
  createdAt: Date;
}

const tenants = new Map<string, FakeTenant>();
const audits: Array<{ action: string; metadata: any }> = [];

// ── Holded: contamos las llamadas, que es media prueba del bloque ──
const listWarehousesCalls = { n: 0 };
vi.mock("@mipiacetpv/holded-client", async (orig) => {
  const real = await orig<typeof import("@mipiacetpv/holded-client")>();
  return {
    ...real,
    listWarehouses: vi.fn(async () => {
      listWarehousesCalls.n += 1;
      return [
        {
          id: "wh_default",
          name: "Thalia Eventos SL",
          default: true,
          address: { address: "C/ Mayor 10", city: "Madrid", postalCode: "28013", country: "ES" },
        },
      ];
    }),
  };
});

const enqueueCalls = { n: 0 };
vi.mock("../src/queues/initial-sync.js", () => ({
  enqueueInitialSync: vi.fn(async () => {
    enqueueCalls.n += 1;
  }),
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
      const t: FakeTenant = {
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
        holdedEnabled: data.holdedEnabled ?? true,
        crmEnabled: data.crmEnabled ?? false,
        agendaEnabled: data.agendaEnabled ?? false,
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
  const app = Fastify({ logger: process.env.H1_DEBUG ? true : false });
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

const COLEGIO = {
  legalName: "Colegio de Talavera SL",
  taxId: "12345678Z",
  cajaEnabled: false,
  crmEnabled: true,
};

beforeEach(() => {
  tenants.clear();
  audits.length = 0;
  listWarehousesCalls.n = 0;
  enqueueCalls.n = 0;
});

describe("H1 · alta SIN Holded", () => {
  it("crea el tenant sin tocar Holded ni la cola, con el sync en NOT_APPLICABLE", async () => {
    const app = await buildApp();
    const res = await post(app, COLEGIO);
    expect(res.statusCode).toBe(201);
    const body = res.json();

    expect(body.tenant.name).toBe("Colegio de Talavera SL");
    expect(body.tenant.onboardingState).toBe("DRAFT");
    expect(body.tenant.initialSyncStatus).toBe("NOT_APPLICABLE");
    expect(body.syncJobId).toBeNull();

    // Ni una llamada a Holded, ni un job encolado.
    expect(listWarehousesCalls.n).toBe(0);
    expect(enqueueCalls.n).toBe(0);

    const t = [...tenants.values()][0]!;
    expect(t.holdedApiKeyCiphertext).toBeNull();
    expect(t.holdedAccountId).toBeNull();
    expect(t.initialSyncStatus).toBe("NOT_APPLICABLE");
  });

  it("el nombre y el NIF se teclean, y quedan en el fiscalProfile marcados como manuales", async () => {
    const app = await buildApp();
    await post(app, COLEGIO);
    const t = [...tenants.values()][0]!;
    expect(t.fiscalProfile.legalName).toBe("Colegio de Talavera SL");
    expect(t.fiscalProfile.taxId).toBe("12345678Z");
    expect(t.fiscalProfile.nif).toBe("12345678Z");
    expect(t.fiscalProfile.source).toBe("super_admin_manual");
    expect(t.fiscalProfile.warehouseHoldedId).toBeNull();
  });

  it("sin razón social no hay alta, y el mensaje habla de tecleo, no de Holded", async () => {
    const app = await buildApp();
    const res = await post(app, { cajaEnabled: false, crmEnabled: true });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_HOLDED_FISCAL_PROFILE");
    expect(res.json().message).toMatch(/a mano/i);
    expect(res.json().message).not.toMatch(/almacén/i);
  });

  it("el NIF se valida igual que con Holded", async () => {
    const app = await buildApp();
    const res = await post(app, { ...COLEGIO, taxId: "12345678A" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_HOLDED_FISCAL_PROFILE");
  });

  it("la unicidad de NIF se comprueba igual que con Holded", async () => {
    fakePrisma.$queryRaw.mockResolvedValueOnce([{ id: "otro" }]);
    const app = await buildApp();
    const res = await post(app, COLEGIO);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("TENANT_NIF_TAKEN");
  });

  it("la auditoría deja dicho que la empresa nació sin Holded y con qué módulos", async () => {
    const app = await buildApp();
    await post(app, COLEGIO);
    const a = audits.find((x) => x.action === "create_tenant_draft");
    expect(a).toBeTruthy();
    expect(a!.metadata.usesHolded).toBe(false);
    expect(a!.metadata.modules).toEqual({ caja: false, crm: true, agenda: false });
  });
});

describe("H1 · alta CON Holded: sin cambios respecto a master", () => {
  const CON_HOLDED = { holdedApiKey: "abc123abc123", holdedAccountId: "acc-001", taxId: "12345678Z" };

  it("valida contra Holded, deriva el nombre del almacén, encola y deja PENDING", async () => {
    const app = await buildApp();
    const res = await post(app, CON_HOLDED);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.tenant.name).toBe("Thalia Eventos SL");
    expect(body.tenant.initialSyncStatus).toBe("PENDING");
    expect(body.syncJobId).toBeTruthy();
    expect(listWarehousesCalls.n).toBe(1);
    expect(enqueueCalls.n).toBe(1);
    const t = [...tenants.values()][0]!;
    expect(t.holdedApiKeyCiphertext).toBeTruthy();
    expect(t.fiscalProfile.source).toBe("super_admin_draft");
  });

  it("con caja por defecto: la empresa de siempre nace con caja y sin CRM ni agenda", async () => {
    const app = await buildApp();
    const res = await post(app, CON_HOLDED);
    expect(res.json().tenant.modules).toEqual({ caja: true, crm: false, agenda: false });
  });

  it("con clave y sin id de cuenta sigue siendo 400 (media configuración es peor que ninguna)", async () => {
    const app = await buildApp();
    const res = await post(app, { holdedApiKey: "abc123abc123", taxId: "12345678Z" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("HOLDED_PARTIAL_CONFIG");
  });

  it("con id de cuenta y sin clave también es 400", async () => {
    const app = await buildApp();
    const res = await post(app, { holdedAccountId: "acc-001", legalName: "X SL" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("HOLDED_PARTIAL_CONFIG");
  });
});

describe("H1 · los módulos se eligen en el alta", () => {
  it("una empresa con los tres módulos apagados no se crea", async () => {
    const app = await buildApp();
    const res = await post(app, {
      legalName: "Nadie SL",
      cajaEnabled: false,
      crmEnabled: false,
      agendaEnabled: false,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("NO_MODULES_ENABLED");
    expect(tenants.size).toBe(0);
  });

  it("se persisten los tres tal cual se piden", async () => {
    const app = await buildApp();
    await post(app, {
      legalName: "Peluquería Sole SL",
      cajaEnabled: true,
      crmEnabled: true,
      agendaEnabled: true,
    });
    const t = [...tenants.values()][0]!;
    expect([t.cajaEnabled, t.crmEnabled, t.agendaEnabled]).toEqual([true, true, true]);
  });
});

describe("H1 · PATCH /super-admin/tenants/:id · mover módulos", () => {
  function seed(over: Partial<FakeTenant> = {}): FakeTenant {
    const t: FakeTenant = {
      id: "22222222-2222-2222-2222-222222222222",
      name: "Sole",
      plan: "pilot",
      fiscalProfile: { legalName: "Sole", taxId: "12345678Z" },
      holdedApiKeyCiphertext: null,
      holdedAccountId: null,
      holdedAuthMode: "API_KEY",
      onboardingState: "ACTIVE",
      businessType: "SERVICES",
      initialSyncStatus: "NOT_APPLICABLE",
      cajaEnabled: true,
      crmEnabled: false,
      agendaEnabled: false,
      holdedEnabled: true,
      createdAt: new Date(),
      ...over,
    };
    tenants.set(t.id, t);
    return t;
  }

  function patch(app: FastifyInstance, id: string, payload: unknown) {
    return app.inject({
      method: "PATCH",
      url: `/super-admin/tenants/${id}`,
      headers: { authorization: `Bearer ${sa()}` },
      payload: payload as never,
    });
  }

  it("el super-admin apaga la caja de una empresa existente", async () => {
    const t = seed({ agendaEnabled: true });
    const app = await buildApp();
    const res = await patch(app, t.id, { cajaEnabled: false });
    expect(res.statusCode).toBe(200);
    expect(tenants.get(t.id)!.cajaEnabled).toBe(false);
  });

  it("no puede dejar la empresa sin ningún módulo, ni apagando de uno en uno", async () => {
    const t = seed({ cajaEnabled: true, crmEnabled: false, agendaEnabled: false });
    const app = await buildApp();
    const res = await patch(app, t.id, { cajaEnabled: false });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("NO_MODULES_ENABLED");
    expect(tenants.get(t.id)!.cajaEnabled).toBe(true);
  });

  it("el cambio de módulo queda auditado con su antes y su después", async () => {
    const t = seed({ crmEnabled: false });
    const app = await buildApp();
    await patch(app, t.id, { crmEnabled: true });
    const a = audits.find((x) => x.action === "update_tenant");
    expect(a!.metadata.changes.crmEnabled).toEqual({ before: false, after: true });
  });

  // ── catalogo-local · addendum 3 · el interruptor de Holded ──────────
  //
  // Decisión de Matías: lo apaga SÓLO el super-admin. El propietario no
  // tiene ninguna salida de "trabajar sin Holded" en su onboarding,
  // porque la implantación de Holded es una decisión de venta de Mi
  // Piace y poner la salida barata a un clic en la misma pantalla donde
  // se vende es regalarla.
  describe("el interruptor de Holded", () => {
    it("el super-admin lo apaga en una empresa SIN clave conectada", async () => {
      const t = seed({ holdedEnabled: true, holdedApiKeyCiphertext: null });
      const app = await buildApp();
      const res = await patch(app, t.id, { holdedEnabled: false });
      expect(res.statusCode).toBe(200);
      expect(tenants.get(t.id)!.holdedEnabled).toBe(false);
    });

    it("EL SABOTAJE: apagarlo con la clave puesta → 409, y no lo apaga", async () => {
      // Apagar Holded en un tenant que ya está subiendo tickets dejaría
      // documentos a medias en su contabilidad y ventas sin subir sin que
      // nadie se enterara. Y como el bloque es forward-only, no habría
      // marcha atrás cómoda: lo cobrado en el periodo local no se sube.
      const t = seed({ holdedEnabled: true, holdedApiKeyCiphertext: "v1:cipher" });
      const app = await buildApp();
      const res = await patch(app, t.id, { holdedEnabled: false });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("HOLDED_ENABLED_HAS_KEY");
      expect(tenants.get(t.id)!.holdedEnabled).toBe(true);
    });

    it("ENCENDERLO con clave sí se puede: es volver al camino de siempre", async () => {
      const t = seed({ holdedEnabled: false, holdedApiKeyCiphertext: "v1:cipher" });
      const app = await buildApp();
      const res = await patch(app, t.id, { holdedEnabled: true });
      expect(res.statusCode).toBe(200);
      expect(tenants.get(t.id)!.holdedEnabled).toBe(true);
    });

    it("NO es un módulo: apagarlo no cuenta para el invariante de módulos", async () => {
      // Una empresa con caja y sin Holded es una empresa completa, no una
      // empresa vacía. Si `holdedEnabled` entrara en MODULE_FIELDS, este
      // PATCH devolvería NO_MODULES_ENABLED.
      const t = seed({ cajaEnabled: true, crmEnabled: false, agendaEnabled: false });
      const app = await buildApp();
      const res = await patch(app, t.id, { holdedEnabled: false });
      expect(res.statusCode).toBe(200);
      expect(tenants.get(t.id)!.cajaEnabled).toBe(true);
    });

    it("queda auditado con su antes y su después", async () => {
      const t = seed({ holdedEnabled: true });
      const app = await buildApp();
      await patch(app, t.id, { holdedEnabled: false });
      const a = audits.find((x) => x.action === "update_tenant");
      expect(a!.metadata.changes.holdedEnabled).toEqual({ before: true, after: false });
    });
  });
});

// ── catalogo-local · addendum 3 · el alta con tres caminos ────────────
describe("catalogo-local · POST /super-admin/tenants · el interruptor", () => {
  it("por defecto nace ENCENDIDO: el alta de siempre no cambia", async () => {
    const app = await buildApp();
    await post(app, { legalName: "Peluquería Sole SL" });
    expect([...tenants.values()][0]!.holdedEnabled).toBe(true);
  });

  it("`holdedEnabled: false` crea el comercio de catálogo local", async () => {
    const app = await buildApp();
    const res = await post(app, {
      legalName: "Colegio Santa Ana",
      holdedEnabled: false,
    });
    expect(res.statusCode).toBe(201);
    const t = [...tenants.values()][0]!;
    expect(t.holdedEnabled).toBe(false);
    expect(t.initialSyncStatus).toBe("NOT_APPLICABLE");
  });

  it("apagarlo Y pasar clave a la vez → 400: hay que decidir una", async () => {
    const app = await buildApp();
    const res = await post(app, {
      legalName: "Incoherente SL",
      holdedEnabled: false,
      holdedApiKey: "k".repeat(20),
      holdedAccountId: "acc-1",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("HOLDED_DISABLED_WITH_KEY");
    expect(tenants.size).toBe(0);
  });

  it("sin clave y con el interruptor ENCENDIDO es el alta 'lo conectará más adelante'", async () => {
    // Es el alta sin Holded de H1, que siempre quiso decir esto. Este
    // tenant SÍ verá /onboarding, y debe.
    const app = await buildApp();
    await post(app, { legalName: "Bar Nuevo SL" });
    const t = [...tenants.values()][0]!;
    expect(t.holdedEnabled).toBe(true);
    expect(t.holdedApiKeyCiphertext).toBeNull();
  });
});
