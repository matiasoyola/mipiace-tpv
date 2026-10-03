// holded-pat · la clave de Holded se juzga en un solo sitio, y un token
// `pat_` se rechaza antes de tocar la red.
//
// Lo que este banco fija:
//
//   1. `classifyHoldedKeyFailure` es el único que sabe qué respuesta de
//      Holded significa «clave rechazada»: 401, 403 y el 400 con
//      `info: "Invalid key"` (el fallo del 13-09, medido contra Holded
//      real en `docs/blocks/holded-pat-spike.md` §1).
//   2. `HOLDED_UNREACHABLE` queda SÓLO para red, timeout y 5xx. Un 400
//      con otro `info`, o un 429, ya no se leen como «Holded no responde».
//   3. Una clave que empieza por `pat_` se rechaza en los tres puntos
//      (alta, rotación y probe) ANTES de llamar a Holded, con un mensaje
//      que dice que hace falta una API Key v1 y dónde se genera.
//   4. `patata…` NO es un `pat_`: la guarda mira el prefijo completo.
//
// Sabotajes que este fichero pone en rojo (ver §3 del done):
//   · borrar la rama del 400 "Invalid key" de `classifyHoldedKeyFailure`
//   · devolver HOLDED_UNREACHABLE para un 4xx que no es rechazo de clave
//   · quitar la guarda de `pat_` del alta, de la rotación o del probe
//   · cambiar `esTokenPat` por un `startsWith("pat")`
//   · volver a escribir el mapeo a mano en `superadmin/tenants.ts`

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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HoldedApiError,
  HoldedInvalidResponseError,
  HoldedSubscriptionSuspendedError,
} from "@mipiacetpv/holded-client";

const SUPER_ADMIN_ID = "11111111-1111-1111-1111-111111111111";
// Claves de pruebas. Ninguna es real: la de PRUEBAS nunca entra en un test.
const PAT = "pat_test_0123456789_abcdefghijklmnopqrstuvwxyz";
const V1 = "abc123abc123def456";

// ── Holded: contamos las llamadas, que es media prueba del bloque ──
const warehouseCalls = { n: 0 };
let warehousesThrow: unknown = null;
vi.mock("@mipiacetpv/holded-client", async (orig) => {
  const real = await orig<typeof import("@mipiacetpv/holded-client")>();
  return {
    ...real,
    listWarehouses: vi.fn(async () => {
      warehouseCalls.n += 1;
      if (warehousesThrow) throw warehousesThrow;
      return [
        {
          id: "wh_default",
          name: "Bar de Pruebas SL",
          default: true,
          address: { address: "C/ Mayor 10", city: "Madrid", postalCode: "28013", country: "ES" },
        },
      ];
    }),
  };
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

interface FakeTenant {
  id: string;
  name: string;
  plan: string | null;
  fiscalProfile: any;
  holdedApiKeyCiphertext: string | null;
  holdedAccountId: string | null;
  holdedAuthMode: string;
  holdedDisconnectedAt: Date | null;
  onboardingState: string;
  businessType: string;
  initialSyncStatus: string;
  cajaEnabled: boolean;
  crmEnabled: boolean;
  agendaEnabled: boolean;
  holdedEnabled: boolean;
  createdAt: Date;
}

const tenants = new Map<string, FakeTenant>();

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
        holdedDisconnectedAt: null,
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
    create: vi.fn(async ({ data }: any) => ({ id: randomUUID(), ...data })),
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

const { classifyHoldedKeyFailure, esTokenPat } = await import(
  "../src/holded/clave-rechazada.js"
);
const { probeFailureToHttpStatus, probeHoldedKey } = await import(
  "../src/holded/probe.js"
);
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

function alta(app: FastifyInstance, holdedApiKey: string) {
  return app.inject({
    method: "POST",
    url: "/super-admin/tenants",
    headers: { authorization: `Bearer ${sa()}` },
    payload: {
      legalName: "Bar de Pruebas SL",
      taxId: "12345678Z",
      holdedApiKey,
      holdedAccountId: "acc-001",
      cajaEnabled: true,
    } as never,
  });
}

function rotacion(app: FastifyInstance, id: string, holdedApiKey: string) {
  return app.inject({
    method: "PATCH",
    url: `/super-admin/tenants/${id}/holded-api-key`,
    headers: { authorization: `Bearer ${sa()}` },
    payload: { holdedApiKey } as never,
  });
}

function sembrarTenant(): string {
  const id = randomUUID();
  tenants.set(id, {
    id,
    name: "Bar de Pruebas SL",
    plan: null,
    fiscalProfile: {},
    holdedApiKeyCiphertext: "cifrado-viejo",
    holdedAccountId: "acc-001",
    holdedAuthMode: "API_KEY",
    holdedDisconnectedAt: null,
    onboardingState: "ACTIVE",
    businessType: "RETAIL",
    initialSyncStatus: "DONE",
    cajaEnabled: true,
    crmEnabled: false,
    agendaEnabled: false,
    holdedEnabled: true,
    createdAt: new Date(),
  });
  return id;
}

// El 400 exacto que Holded devolvió el 13-09 ante un `pat_`.
function error400InvalidKey(): HoldedApiError {
  return new HoldedApiError(
    400,
    "https://api.holded.com/api/invoicing/v1/warehouses",
    { status: 0, info: "Invalid key" },
  );
}

beforeEach(() => {
  tenants.clear();
  warehouseCalls.n = 0;
  warehousesThrow = null;
});

// ─────────────────────────────────────────────────────────────────────
describe("holded-pat · una sola traducción de las respuestas de Holded", () => {
  it("el 400 con info 'Invalid key' es clave rechazada, no Holded caído", () => {
    const r = classifyHoldedKeyFailure(error400InvalidKey());
    expect(r.code).toBe("INVALID_HOLDED_KEY");
  });

  it("acepta el info con otra caja y espacios ('  invalid KEY ')", () => {
    const err = new HoldedApiError(400, "url", { status: 0, info: "  invalid KEY " });
    expect(classifyHoldedKeyFailure(err).code).toBe("INVALID_HOLDED_KEY");
  });

  it("401 y 403 siguen siendo clave rechazada", () => {
    for (const status of [401, 403]) {
      const err = new HoldedApiError(status, "url", { status: 0, info: "nope" });
      expect(classifyHoldedKeyFailure(err).code).toBe("INVALID_HOLDED_KEY");
    }
  });

  it("un 400 con otro motivo NO es clave rechazada ni Holded caído", () => {
    const err = new HoldedApiError(400, "url", { status: 0, info: "Missing param" });
    expect(classifyHoldedKeyFailure(err).code).toBe("HOLDED_UNEXPECTED_STATUS");
  });

  it("un 429 no se lee como «no hemos podido contactar con Holded»", () => {
    const err = new HoldedApiError(429, "url", "slow down");
    expect(classifyHoldedKeyFailure(err).code).toBe("HOLDED_UNEXPECTED_STATUS");
  });

  it("HOLDED_UNREACHABLE queda para 5xx y para la red", () => {
    expect(classifyHoldedKeyFailure(new HoldedApiError(500, "url", "")).code).toBe(
      "HOLDED_UNREACHABLE",
    );
    expect(classifyHoldedKeyFailure(new HoldedApiError(502, "url", "")).code).toBe(
      "HOLDED_UNREACHABLE",
    );
    expect(classifyHoldedKeyFailure(new TypeError("fetch failed")).code).toBe(
      "HOLDED_UNREACHABLE",
    );
  });

  it("suspensión y respuesta no-JSON conservan su código", () => {
    expect(
      classifyHoldedKeyFailure(new HoldedSubscriptionSuspendedError("url", {})).code,
    ).toBe("HOLDED_SUSPENDED");
    expect(
      classifyHoldedKeyFailure(
        new HoldedInvalidResponseError("GET", "url", 200, "text/html", "<html>"),
      ).code,
    ).toBe("HOLDED_INVALID_RESPONSE");
  });
});

describe("holded-pat · reconocer un token pat_", () => {
  it("reconoce el prefijo, con espacios y en mayúsculas", () => {
    expect(esTokenPat(PAT)).toBe(true);
    expect(esTokenPat("  " + PAT)).toBe(true);
    expect(esTokenPat("PAT_abc_def")).toBe(true);
  });

  it("no confunde una clave v1 ni una que empiece por 'pat'", () => {
    expect(esTokenPat(V1)).toBe(false);
    // Sabotaje: un `startsWith("pat")` pondría esto en true y rechazaría
    // claves v1 buenas sin llamar a Holded.
    expect(esTokenPat("patata1234567890")).toBe(false);
  });

  it("el rechazo del pat_ es 400, no un 502 que invite a reintentar", () => {
    expect(probeFailureToHttpStatus("HOLDED_KEY_V1_REQUIRED")).toBe(400);
  });
});

describe("holded-pat · el probe rechaza el pat_ sin tocar la red", () => {
  const fetchOriginal = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = fetchOriginal;
  });

  it("no hace ni una petición y dice qué clave hace falta y dónde", async () => {
    const espia = vi.fn(async () => {
      throw new Error("no se debe llamar a Holded con un pat_");
    });
    globalThis.fetch = espia as unknown as typeof fetch;
    const r = await probeHoldedKey(PAT);
    expect(espia).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: false, code: "HOLDED_KEY_V1_REQUIRED" });
    if (!r.ok) {
      expect(r.message).toContain("API Key v1");
      expect(r.message).toContain("Configuración → Más → Desarrolladores");
    }
  });

  it("con una clave v1 sí llama, y traduce el 400 'Invalid key'", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ status: 0, info: "Invalid key" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const r = await probeHoldedKey(V1);
    expect(r).toMatchObject({ ok: false, code: "INVALID_HOLDED_KEY" });
  });
});

describe("holded-pat · alta del super-admin", () => {
  it("rechaza el pat_ con 400 y SIN llamar a Holded", async () => {
    const app = await buildApp();
    const res = await alta(app, PAT);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("HOLDED_API_KEY_V1_REQUIRED");
    expect(res.json().message).toContain("Configuración → Más → Desarrolladores");
    expect(warehouseCalls.n).toBe(0);
    expect(tenants.size).toBe(0);
  });

  it("el 400 'Invalid key' de Holded se ve como clave rechazada, no como caída", async () => {
    warehousesThrow = error400InvalidKey();
    const app = await buildApp();
    const res = await alta(app, V1);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("HOLDED_API_KEY_INVALID");
  });

  it("un 500 de Holded sí es HOLDED_UNREACHABLE", async () => {
    warehousesThrow = new HoldedApiError(500, "url", "boom");
    const app = await buildApp();
    const res = await alta(app, V1);
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe("HOLDED_UNREACHABLE");
  });

  it("con una clave v1 buena el alta sigue funcionando igual que antes", async () => {
    const app = await buildApp();
    const res = await alta(app, V1);
    expect(res.statusCode).toBe(201);
    expect(warehouseCalls.n).toBe(1);
  });
});

describe("holded-pat · rotación de clave del super-admin", () => {
  it("rechaza el pat_ con 400, sin llamar a Holded y sin pisar la clave vieja", async () => {
    const id = sembrarTenant();
    const app = await buildApp();
    const res = await rotacion(app, id, PAT);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("HOLDED_API_KEY_V1_REQUIRED");
    expect(warehouseCalls.n).toBe(0);
    expect(tenants.get(id)!.holdedApiKeyCiphertext).toBe("cifrado-viejo");
  });

  it("el 400 'Invalid key' se ve como clave rechazada", async () => {
    const id = sembrarTenant();
    warehousesThrow = error400InvalidKey();
    const app = await buildApp();
    const res = await rotacion(app, id, V1);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("HOLDED_API_KEY_INVALID");
    expect(tenants.get(id)!.holdedApiKeyCiphertext).toBe("cifrado-viejo");
  });

  it("un 429 no miente diciendo que Holded no responde", async () => {
    const id = sembrarTenant();
    warehousesThrow = new HoldedApiError(429, "url", "slow down");
    const app = await buildApp();
    const res = await rotacion(app, id, V1);
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe("HOLDED_UNEXPECTED_STATUS");
  });
});
