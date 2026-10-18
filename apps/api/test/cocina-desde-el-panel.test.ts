// auditoria-sirope (#23) · cambiar las SECCIONES de una pantalla de
// cocina sin revocarla.
//
// Hasta este bloque las secciones se decidían al generar el código de
// emparejamiento y no se podían tocar: para pasar una pantalla de
// «Cocina» a «Cocina + Barra» había que revocarla y volver a emparejarla
// tecleando seis dígitos en una tablet colgada de la pared.

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "00000000-0000-0000-0000-000000000001";
const OWNER = "00000000-0000-0000-0000-000000000002";
const PANTALLA = "00000000-0000-0000-0000-0000000000a1";
const TERMINAL = "00000000-0000-0000-0000-0000000000a2";

let dispositivo: {
  id: string;
  kind: string;
  revokedAt: Date | null;
  kitchenSections: string[];
} | null = null;
const guardado: Array<string[]> = [];

const fakePrisma = {
  tenant: {
    findUnique: vi.fn(async () => ({ id: TENANT, cajaEnabled: true })),
    findUniqueOrThrow: vi.fn(async () => ({ id: TENANT, cajaEnabled: true })),
  },
  device: {
    findFirst: vi.fn(async ({ where }: any) =>
      dispositivo && dispositivo.id === where.id ? dispositivo : null,
    ),
    update: vi.fn(async ({ data }: any) => {
      guardado.push(data.kitchenSections);
      return { id: PANTALLA, kitchenSections: data.kitchenSections };
    }),
  },
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));
vi.mock("../src/lib/caja-gate.js", () => ({
  ensureCajaEnabled: async () => undefined,
}));

const { registerDeviceRoutes } = await import("../src/devices/routes.js");

function ownerToken() {
  return jwt.sign(
    { sub: OWNER, tid: TENANT, role: "OWNER", type: "access" },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: "30m" },
  );
}

async function buildApp() {
  const app = Fastify({ logger: false });
  await registerDeviceRoutes(app);
  return app;
}

function patch(app: any, deviceId: string, secciones: string[]) {
  return app.inject({
    method: "PATCH",
    url: `/admin/devices/${deviceId}/kitchen-sections`,
    headers: { authorization: `Bearer ${ownerToken()}` },
    payload: { kitchenSections: secciones },
  });
}

beforeEach(() => {
  guardado.length = 0;
  dispositivo = {
    id: PANTALLA,
    kind: "KITCHEN",
    revokedAt: null,
    kitchenSections: ["COCINA"],
  };
  vi.clearAllMocks();
});

describe("PATCH /admin/devices/:id/kitchen-sections (#23)", () => {
  it("añade Barra a una pantalla de Cocina sin revocarla", async () => {
    const app = await buildApp();
    const res = await patch(app, PANTALLA, ["COCINA", "BARRA"]);

    expect(res.statusCode).toBe(200);
    expect(guardado[0]).toEqual(["COCINA", "BARRA"]);
    expect(res.json().device.kitchenSections).toEqual(["COCINA", "BARRA"]);
  });

  it("una pantalla sin secciones no se guarda: no recibiría nada", async () => {
    const app = await buildApp();
    const res = await patch(app, PANTALLA, []);
    expect(res.statusCode).toBe(400);
    expect(guardado).toHaveLength(0);
  });

  it("el terminal de la caja no tiene secciones", async () => {
    dispositivo = {
      id: TERMINAL,
      kind: "TERMINAL",
      revokedAt: null,
      kitchenSections: [],
    };
    const app = await buildApp();
    const res = await patch(app, TERMINAL, ["COCINA"]);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("NOT_A_KITCHEN_DEVICE");
  });

  it("una pantalla revocada hay que volver a emparejarla", async () => {
    dispositivo = {
      id: PANTALLA,
      kind: "KITCHEN",
      revokedAt: new Date(),
      kitchenSections: ["COCINA"],
    };
    const app = await buildApp();
    const res = await patch(app, PANTALLA, ["COCINA", "BARRA"]);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("DEVICE_REVOKED");
  });
});
