// residencia-1 (D-48) · EL INTERRUPTOR DEL SUPER-ADMIN.
//
// Lo que este banco fija:
//
//   1. **Encenderlo exige la clínica**, y el 409 lo dice con una frase. Y
//      encender las dos en la MISMA llamada funciona.
//   2. **Apagarlo con residentes dentro, no.** 409 con el recuento, mismo
//      criterio que `CLINICAL_RECORDS_HAS_HISTORY`.
//   3. Encenderlo **siembra** los diez roles de cuidado y los tres turnos,
//      en la misma transacción. Sin la semilla, la función de acceso dice
//      «no» a todo el mundo el primer día.
//   4. **`clinicalRecordsEnabled` SE ACEPTA.** Era la línea que faltaba en
//      el body schema desde clinica-1: con `additionalProperties: false`,
//      el camino que ese bloque documenta para encender la historia
//      clínica devolvía 400.
//   5. No entra en `MODULE_FIELDS`: una empresa no puede quedarse «sólo
//      con residencia».
//
// Sabotajes que este fichero pone en rojo:
//   · quitar la guarda de la clínica (un centro con residencia y sin
//     clínica no puede leer ni la ficha de un residente);
//   · quitar la semilla (centro encendido, nadie ve a nadie);
//   · volver a sacar `clinicalRecordsEnabled` del schema.

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
let rolesSembrados: any[] = [];
let turnosSembrados: any[] = [];
let residentes = 0;
let anotacionesClinicas = 0;

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
  residentProfile: { count: vi.fn(async () => residentes) },
  clinicalEntry: { count: vi.fn(async () => anotacionesClinicas) },
  device: { count: vi.fn(async () => 0) },
  careRole: {
    createMany: vi.fn(async ({ data }: any) => {
      rolesSembrados.push(...data);
      return { count: data.length };
    }),
  },
  centerShift: {
    createMany: vi.fn(async ({ data }: any) => {
      turnosSembrados.push(...data);
      return { count: data.length };
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
    name: "Jardín de Gredos SL",
    plan: "pilot",
    fiscalProfile: { legalName: "Jardín de Gredos SL", taxId: "12345678Z" },
    holdedAccountId: null,
    holdedAuthMode: "API_KEY",
    holdedApiKeyCiphertext: null,
    holdedEnabled: false,
    holdedDisconnectedAt: null,
    onboardingState: "ACTIVE",
    businessType: "SERVICES",
    initialSyncStatus: "NOT_APPLICABLE",
    cajaEnabled: false,
    crmEnabled: true,
    agendaEnabled: true,
    fichajeEnabled: false,
    clinicalRecordsEnabled: true,
    kitchenDisplayEnabled: false,
    residenciaEnabled: false,
    createdAt: new Date(),
    ...parche,
  };
}

beforeEach(() => {
  tenants.clear();
  audits.length = 0;
  rolesSembrados = [];
  turnosSembrados = [];
  residentes = 0;
  anotacionesClinicas = 0;
  vi.clearAllMocks();
});

describe("residencia-1 · encender la residencia", () => {
  it("con la clínica encendida se enciende, y queda en la auditoría", async () => {
    tenants.set(TENANT, tenantBase());
    const app = await buildApp();
    const res = await patch(app, { residenciaEnabled: true });
    expect(res.statusCode).toBe(200);
    expect(tenants.get(TENANT).residenciaEnabled).toBe(true);
    expect(audits.at(-1)!.action).toBe("update_tenant");
    expect(audits.at(-1)!.metadata.changes.residenciaEnabled).toEqual({
      before: false,
      after: true,
    });
  });

  it("SIN la clínica, 409 y la frase dice por qué", async () => {
    tenants.set(TENANT, tenantBase({ clinicalRecordsEnabled: false }));
    const app = await buildApp();
    const res = await patch(app, { residenciaEnabled: true });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("RESIDENCIA_NEEDS_CLINICA");
    expect(res.json().message).toContain("historia clínica");
    // Y no se enciende a medias.
    expect(tenants.get(TENANT).residenciaEnabled).toBe(false);
    expect(rolesSembrados).toHaveLength(0);
  });

  it("ENCENDER LAS DOS EN LA MISMA LLAMADA funciona", async () => {
    // Es el alta real de un centro: el implantador marca las dos casillas
    // y guarda. Si la guarda sólo mirara la columna, esto sería un 409 y
    // habría que hacerlo en dos pasos sin que nada lo dijera.
    tenants.set(TENANT, tenantBase({ clinicalRecordsEnabled: false }));
    const app = await buildApp();
    const res = await patch(app, {
      clinicalRecordsEnabled: true,
      residenciaEnabled: true,
    });
    expect(res.statusCode).toBe(200);
    expect(tenants.get(TENANT).clinicalRecordsEnabled).toBe(true);
    expect(tenants.get(TENANT).residenciaEnabled).toBe(true);
  });
});

describe("residencia-1 · LA SEMILLA del centro", () => {
  it("encenderlo siembra los DIEZ roles de cuidado de serie", async () => {
    tenants.set(TENANT, tenantBase());
    const app = await buildApp();
    await patch(app, { residenciaEnabled: true });
    expect(rolesSembrados).toHaveLength(10);
    expect(rolesSembrados.map((r) => r.code)).toEqual([
      "AUXILIAR",
      "DUE",
      "MEDICO",
      "TO",
      "FISIO",
      "LIMPIEZA",
      "COCINA",
      "CALIDAD",
      "DIRECCION",
      "ADMINISTRACION",
    ]);
    // Todos de serie y todos activos.
    expect(rolesSembrados.every((r) => r.isStandard === true)).toBe(true);
    expect(rolesSembrados.every((r) => r.active === true)).toBe(true);
  });

  it("los cuatro roles de ALCANCE TOTAL son DUE, médico, calidad y dirección", async () => {
    tenants.set(TENANT, tenantBase());
    const app = await buildApp();
    await patch(app, { residenciaEnabled: true });
    const total = rolesSembrados.filter((r) => r.fullScope).map((r) => r.code);
    expect(total).toEqual(["DUE", "MEDICO", "CALIDAD", "DIRECCION"]);
  });

  it("los cuatro que EXIGEN COLEGIADO son DUE, médico, TO y fisio", async () => {
    tenants.set(TENANT, tenantBase());
    const app = await buildApp();
    await patch(app, { residenciaEnabled: true });
    const conColegio = rolesSembrados
      .filter((r) => r.requiresLicense)
      .map((r) => r.code);
    expect(conColegio).toEqual(["DUE", "MEDICO", "TO", "FISIO"]);
  });

  it("EL ÚNICO QUE NO REGISTRA es administración", async () => {
    // Lleva facturas, plazas y expedientes; no entra en las habitaciones y
    // no tiene por qué ver la salud de nadie.
    tenants.set(TENANT, tenantBase());
    const app = await buildApp();
    await patch(app, { residenciaEnabled: true });
    const sinRegistro = rolesSembrados
      .filter((r) => !r.recordsCare)
      .map((r) => r.code);
    expect(sinRegistro).toEqual(["ADMINISTRACION"]);
  });

  it("y «dirección» es el único DIRECTIVO", async () => {
    // De la categoría cuelga quién cierra una incidencia en residencia-4.
    tenants.set(TENANT, tenantBase());
    const app = await buildApp();
    await patch(app, { residenciaEnabled: true });
    const directivos = rolesSembrados
      .filter((r) => r.category === "DIRECTIVO")
      .map((r) => r.code);
    expect(directivos).toEqual(["DIRECCION"]);
  });

  it("siembra los TRES TURNOS, y la noche cruza medianoche", async () => {
    tenants.set(TENANT, tenantBase());
    const app = await buildApp();
    await patch(app, { residenciaEnabled: true });
    expect(turnosSembrados).toHaveLength(3);
    expect(
      turnosSembrados.map((t) => [t.code, t.startsAt, t.endsAt]),
    ).toEqual([
      ["M", "08:00", "15:00"],
      ["T", "15:00", "22:00"],
      ["N", "22:00", "08:00"],
    ]);
  });

  it("la semilla es IDEMPOTENTE: `skipDuplicates` en las dos", async () => {
    // Apagar y volver a encender no duplica nada y no resucita lo que el
    // centro desactivó.
    tenants.set(TENANT, tenantBase());
    const app = await buildApp();
    await patch(app, { residenciaEnabled: true });
    expect(fakePrisma.careRole.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
    expect(fakePrisma.centerShift.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });

  it("APAGARLO no siembra nada", async () => {
    tenants.set(TENANT, tenantBase({ residenciaEnabled: true }));
    const app = await buildApp();
    await patch(app, { residenciaEnabled: false });
    expect(rolesSembrados).toHaveLength(0);
    expect(turnosSembrados).toHaveLength(0);
  });
});

describe("residencia-1 · apagar la residencia", () => {
  it("SIN residentes se puede", async () => {
    tenants.set(TENANT, tenantBase({ residenciaEnabled: true }));
    const app = await buildApp();
    const res = await patch(app, { residenciaEnabled: false });
    expect(res.statusCode).toBe(200);
    expect(tenants.get(TENANT).residenciaEnabled).toBe(false);
  });

  it("CON RESIDENTES DENTRO, 409 con el recuento", async () => {
    residentes = 49;
    tenants.set(TENANT, tenantBase({ residenciaEnabled: true }));
    const app = await buildApp();
    const res = await patch(app, { residenciaEnabled: false });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("RESIDENCIA_HAS_RESIDENTS");
    expect(res.json().residentes).toBe(49);
    expect(res.json().message).toContain("49");
    expect(tenants.get(TENANT).residenciaEnabled).toBe(true);
  });
});

describe("clinica-1 · la línea que faltaba en el body schema", () => {
  it("`clinicalRecordsEnabled` SE ACEPTA (antes devolvía 400)", async () => {
    // El handler la trataba desde clinica-1 y el done de ese bloque la
    // documenta como la única forma de encender la historia clínica, pero
    // la propiedad no estaba declarada: con `additionalProperties: false`
    // eso es un 400 «body must NOT have additional properties». No lo vio
    // nadie porque ningún test la mandaba por HTTP.
    tenants.set(TENANT, tenantBase({ clinicalRecordsEnabled: false }));
    const app = await buildApp();
    const res = await patch(app, { clinicalRecordsEnabled: true });
    expect(res.statusCode).toBe(200);
    expect(tenants.get(TENANT).clinicalRecordsEnabled).toBe(true);
  });

  it("y sus dos guardas siguen en pie", async () => {
    // Sin CRM ni agenda no se enciende. (La caja queda encendida para no
    // chocar con el invariante «al menos un módulo», que es otro 400 y
    // taparía el 409 que se quiere ver.)
    tenants.set(
      TENANT,
      tenantBase({
        clinicalRecordsEnabled: false,
        cajaEnabled: true,
        crmEnabled: false,
        agendaEnabled: false,
      }),
    );
    let app = await buildApp();
    let res = await patch(app, { clinicalRecordsEnabled: true });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("CLINICAL_RECORDS_NEEDS_MODULES");

    // Y con historia dentro no se apaga.
    anotacionesClinicas = 7;
    tenants.set(TENANT, tenantBase({ clinicalRecordsEnabled: true }));
    app = await buildApp();
    res = await patch(app, { clinicalRecordsEnabled: false });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("CLINICAL_RECORDS_HAS_HISTORY");
  });

  it("y UNA PROPIEDAD DESCONOCIDA SE TIRA EN SILENCIO — por eso no se vio", async () => {
    // Aquí estaba la razón de que el olvido pasara desapercibido tres
    // bloques, y no es la que parecía: Fastify configura ajv con
    // `removeAdditional: true` por defecto, así que
    // `additionalProperties: false` **no devuelve un 400: BORRA la
    // propiedad**.
    //
    // O sea que `PATCH {"clinicalRecordsEnabled": true}` no fallaba con un
    // mensaje: contestaba **200 `{noChanges: true}`** y no hacía nada. Un
    // 400 se habría visto el primer día; un 200 que no hace nada se lee
    // como «ya estaba encendido».
    //
    // Se deja fijado con una propiedad inventada para que nadie vuelva a
    // dar por hecho que un nombre mal escrito en este PATCH se queja.
    tenants.set(TENANT, tenantBase());
    const app = await buildApp();
    const res = await patch(app, { residenciaEncendida: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ noChanges: true });
    expect(tenants.get(TENANT).residenciaEnabled).toBe(false);
  });
});

describe("residencia-1 · no es un módulo que sostenga a una empresa", () => {
  it("fuera de MODULE_FIELDS: con la residencia sola, el invariante salta", async () => {
    // Un tenant «sólo con residencia» no tendría ni pacientes ni citas, y
    // la residencia cuelga de las dos. Por eso no entra en el invariante
    // de «al menos un módulo encendido», igual que la clínica y la cocina.
    tenants.set(
      TENANT,
      tenantBase({
        residenciaEnabled: true,
        cajaEnabled: false,
        crmEnabled: true,
        agendaEnabled: true,
        fichajeEnabled: false,
      }),
    );
    const app = await buildApp();
    const res = await patch(app, { crmEnabled: false, agendaEnabled: false });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("NO_MODULES_ENABLED");
  });
});
