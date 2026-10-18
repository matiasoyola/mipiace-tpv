// B-reservas-8 · EL INTERRUPTOR DEL SUPER-ADMIN y los ajustes del negocio.
//
// Lo que este banco fija:
//
//   1. **No se enciende con Holded conectado** (decisión de Dirección,
//      18-10), y el 409 lo dice con una frase que nombra el frente P5. Y
//      apagar Holded en la MISMA llamada funciona.
//   2. **No se apaga con sesiones sin usar.** Es dinero cobrado y no
//      entregado: apagarlo dejaría a las clientas con sesiones guardadas y
//      sin forma de canjearlas. 409 con el recuento, mismo criterio que
//      `RESIDENCIA_HAS_RESIDENTS`.
//   3. **`bonosEnabled` SE ACEPTA en el body schema.** Es la línea que a
//      clinica-1 se le olvidó y que nadie vio en meses, porque
//      `additionalProperties: false` con el `removeAdditional` de Fastify
//      no da 400: **borra la propiedad y contesta 200 `{noChanges:true}`**.
//      Eso se lee como «ya estaba encendido».
//   4. No entra en `MODULE_FIELDS`: una empresa no puede quedarse «sólo con
//      bonos».
//
// Sabotajes que este fichero pone en rojo:
//   · quitar la guarda de Holded (un canje a 0 € subiendo al ERP);
//   · quitar la guarda de apagado (una deuda del centro, inaccesible);
//   · volver a sacar `bonosEnabled` del schema.

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
const TENANT = "22222222-2222-2222-2222-222222222222";

const tenants = new Map<string, any>();
const audits: Array<{ action: string; metadata: any }> = [];
let bonosConSaldo = 0;

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
    findFirst: vi.fn(async () => null),
    update: vi.fn(async ({ where, data }: any) => {
      const t = tenants.get(where.id)!;
      Object.assign(t, data);
      return t;
    }),
  },
  // B-reservas-8 · lo que la guarda de apagado cuenta.
  voucher: { count: vi.fn(async () => bonosConSaldo) },
  residentProfile: { count: vi.fn(async () => 0) },
  clinicalEntry: { count: vi.fn(async () => 0) },
  device: { count: vi.fn(async () => 0) },
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
  getRedis: () => ({
    incr: async () => 1,
    expire: async () => 1,
    ttl: async () => -2,
  }),
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

function patch(app: FastifyInstance, payload: unknown) {
  return app.inject({
    method: "PATCH",
    url: `/super-admin/tenants/${TENANT}`,
    headers: { authorization: `Bearer ${sa()}` },
    payload: payload as never,
  });
}

function tenantBase(parche: Record<string, unknown> = {}) {
  return {
    id: TENANT,
    name: "Clínica del pie SL",
    plan: "pilot",
    fiscalProfile: { legalName: "Clínica del pie SL", taxId: "12345678Z" },
    holdedAccountId: null,
    holdedAuthMode: "API_KEY",
    holdedApiKeyCiphertext: null,
    // La cuenta que SALIÓ de Holded, que es donde este módulo vive.
    holdedEnabled: false,
    holdedDisconnectedAt: null,
    onboardingState: "ACTIVE",
    businessType: "SERVICES",
    initialSyncStatus: "NOT_APPLICABLE",
    cajaEnabled: true,
    crmEnabled: true,
    agendaEnabled: true,
    fichajeEnabled: false,
    clinicalRecordsEnabled: true,
    kitchenDisplayEnabled: false,
    residenciaEnabled: false,
    bonosEnabled: false,
    createdAt: new Date(),
    ...parche,
  };
}

beforeEach(() => {
  tenants.clear();
  audits.length = 0;
  bonosConSaldo = 0;
  vi.clearAllMocks();
});

describe("B-reservas-8 · encender los bonos", () => {
  it("en una cuenta SIN Holded se enciende, y queda en la auditoría", async () => {
    tenants.set(TENANT, tenantBase());
    const app = await buildApp();
    const res = await patch(app, { bonosEnabled: true });
    expect(res.statusCode).toBe(200);
    expect(tenants.get(TENANT).bonosEnabled).toBe(true);
    expect(audits.at(-1)!.metadata.changes.bonosEnabled).toEqual({
      before: false,
      after: true,
    });
  });

  it("CON Holded, 409 — y la frase nombra el frente P5", async () => {
    tenants.set(TENANT, tenantBase({ holdedEnabled: true }));
    const app = await buildApp();
    const res = await patch(app, { bonosEnabled: true });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("BONOS_CON_HOLDED");
    expect(res.json().message).toMatch(/P5/);
    expect(res.json().message).toMatch(/apágalo primero/i);
    // Y no se encendió nada.
    expect(tenants.get(TENANT).bonosEnabled).toBe(false);
  });

  it("apagar Holded en la MISMA llamada funciona", async () => {
    tenants.set(TENANT, tenantBase({ holdedEnabled: true }));
    const app = await buildApp();
    const res = await patch(app, {
      holdedEnabled: false,
      bonosEnabled: true,
    });
    expect(res.statusCode).toBe(200);
    expect(tenants.get(TENANT).bonosEnabled).toBe(true);
    expect(tenants.get(TENANT).holdedEnabled).toBe(false);
  });

  it("`holdedEnabled` se lee `!== false`: una cuenta de hoy no se cuela", async () => {
    // `holded_enabled` es `@default(true)`. Una cuenta que nunca lo tocó
    // tiene `true` y NO puede encender bonos. Es el criterio que el propio
    // schema documenta para esa columna, y leerlo como `!holdedEnabled`
    // habría dejado pasar un `undefined` de un `select` incompleto.
    tenants.set(TENANT, tenantBase({ holdedEnabled: true }));
    const app = await buildApp();
    expect((await patch(app, { bonosEnabled: true })).statusCode).toBe(409);
  });
});

describe("B-reservas-8 · apagar los bonos", () => {
  it("sin sesiones vivas se apaga", async () => {
    tenants.set(TENANT, tenantBase({ bonosEnabled: true }));
    bonosConSaldo = 0;
    const app = await buildApp();
    const res = await patch(app, { bonosEnabled: false });
    expect(res.statusCode).toBe(200);
    expect(tenants.get(TENANT).bonosEnabled).toBe(false);
  });

  it("con sesiones SIN USAR, 409 con el recuento", async () => {
    tenants.set(TENANT, tenantBase({ bonosEnabled: true }));
    bonosConSaldo = 3;
    const app = await buildApp();
    const res = await patch(app, { bonosEnabled: false });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: "BONOS_CON_SALDO_VIVO",
      bonosVivos: 3,
    });
    // La frase dice QUÉ es lo que se quedaría dentro.
    expect(res.json().message).toMatch(/dinero cobrado y no entregado/i);
    expect(tenants.get(TENANT).bonosEnabled).toBe(true);
  });

  it("y el recuento NO cuenta los de prueba ni los muertos", async () => {
    tenants.set(TENANT, tenantBase({ bonosEnabled: true }));
    bonosConSaldo = 1;
    const app = await buildApp();
    await patch(app, { bonosEnabled: false });
    // `07` pieza 17 · lo de prueba sale de los informes de gestión, y un
    // bono anulado o caducado no es una deuda viva.
    expect(fakePrisma.voucher.count).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT,
        esPrueba: false,
        status: { in: ["ACTIVO", "AGOTADO"] },
        sessionsLeft: { gt: 0 },
      },
    });
  });
});

describe("B-reservas-8 · el schema del PATCH acepta la propiedad", () => {
  it("y una propiedad DESCONOCIDA se tira en silencio (el fallo de clinica-1)", async () => {
    tenants.set(TENANT, tenantBase());
    const app = await buildApp();
    // `additionalProperties: false` con el `removeAdditional` de Fastify
    // NO da 400: borra la propiedad. Por eso `bonosEnabled` tiene que
    // estar DECLARADO, y por eso este test comprueba las dos caras.
    const res = await patch(app, { bonosHabilitados: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ noChanges: true });
    expect(tenants.get(TENANT).bonosEnabled).toBe(false);
  });

  it("el interruptor NO entra en `modules`: nadie se queda «sólo con bonos»", async () => {
    // `MODULE_FIELDS` son los CUATRO que sostienen a una empresa (caja,
    // CRM, agenda, control horario), y el invariante «al menos uno
    // encendido» los cuenta. Los bonos están FUERA a propósito, igual que
    // `holdedEnabled`, `kitchenDisplayEnabled` y los dos de salud: son un
    // añadido vendible a la caja.
    //
    // Se comprueba por su consecuencia: con los bonos encendidos y los
    // cuatro módulos apagados, el PATCH sigue dando 400. Si alguien metiera
    // `bonosEnabled` en la lista, este 400 se convertiría en un 200 y
    // existiría una empresa «sólo con bonos»: un negocio que vende bonos y
    // no tiene caja para cobrarlos.
    tenants.set(TENANT, tenantBase({ bonosEnabled: true }));
    const app = await buildApp();
    const res = await patch(app, {
      cajaEnabled: false,
      crmEnabled: false,
      agendaEnabled: false,
      fichajeEnabled: false,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("NO_MODULES_ENABLED");
  });
});
