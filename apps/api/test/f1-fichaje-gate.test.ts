// F1 · la puerta del control horario (ADR-018).
//
// Lo que este banco fija:
//
//   1. Con `fichajeEnabled: false` —y con la columna AUSENTE, que es como
//      se comporta un tenant de master antes de la migración— la puerta se
//      cierra con 403 FICHAJE_DISABLED y una frase.
//   2. Con `fichajeEnabled: true` la puerta no existe: el request pasa.
//   3. La puerta entiende las DOS identidades desde las que se cruza el
//      módulo: el panel (`request.auth`) y el móvil del empleado
//      (`request.employee`). Y ninguna otra: un cajero o un device del TPV
//      no traen tenant para esta puerta.
//   4. La lectura falla hacia APAGADO, al revés que la de la caja. Es la
//      diferencia deliberada de `lib/fichaje-gate.ts`, nota 2.
//   5. Sin auth previa no se inventa un 403 que taparía el 401 de verdad.
//
// Sabotajes que este fichero pone en rojo (§3 del done):
//   · quitar `ensureFichajeEnabled` de una ruta del módulo (nº 9)
//   · cambiar `=== true` por `!== false` (rompe "columna ausente" y
//     "tenant existente tras la migración")
//   · hacer que la lectura falle hacia encendido

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.CASHIER_SESSION_SECRET = "c".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTRO_TENANT = "99999999-9999-9999-9999-999999999999";
const USER_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const EMPLOYEE_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const EMPLOYEE_DEVICE_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";

// `undefined` = la columna no existe en la fila: un tenant de master antes
// de que la migración corra, o un banco de pruebas que no la modela.
let fichajeEnabled: boolean | undefined = true;
let tenantRowExists = true;
let lecturaRevienta = false;

const fakePrisma: any = {
  tenant: {
    findUnique: vi.fn(async ({ where }: any) => {
      if (lecturaRevienta) throw new Error("BD caída");
      if (!tenantRowExists || where.id !== TENANT_ID) return null;
      return { id: TENANT_ID, fichajeEnabled };
    }),
  },
};

vi.mock("../src/context.js", () => ({
  initContext: vi.fn(),
  getPrisma: () => fakePrisma,
  getRedis: () => ({}),
  closeContext: vi.fn(),
  shutdown: vi.fn(),
}));

const { ensureFichajeEnabled, FICHAJE_DISABLED_MESSAGE } = await import(
  "../src/lib/fichaje-gate.js"
);

function fakeAuth(kind: "panel" | "empleado" | "cajero") {
  return async (request: any) => {
    if (kind === "panel") {
      request.auth = { userId: USER_ID, tenantId: TENANT_ID, role: "OWNER" };
    } else if (kind === "empleado") {
      request.employee = {
        employeeId: EMPLOYEE_ID,
        tenantId: TENANT_ID,
        deviceId: EMPLOYEE_DEVICE_ID,
      };
    } else {
      // El TPV. No es una puerta de este módulo: la función no debe
      // encontrar tenant por aquí.
      request.cashier = { tid: OTRO_TENANT };
      request.device = { tenantId: OTRO_TENANT };
    }
  };
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.get(
    "/fake/panel-hoy",
    { preHandler: [fakeAuth("panel"), ensureFichajeEnabled] },
    async () => ({ ok: "hoy" }),
  );
  app.post(
    "/fake/fichar",
    { preHandler: [fakeAuth("empleado"), ensureFichajeEnabled] },
    async () => ({ ok: "fichado" }),
  );
  app.get(
    "/fake/tpv",
    { preHandler: [fakeAuth("cajero"), ensureFichajeEnabled] },
    async () => ({ ok: "tpv" }),
  );
  app.get(
    "/fake/sin-auth",
    { preHandler: [ensureFichajeEnabled] },
    async () => ({ ok: "sin-auth" }),
  );
  await app.ready();
  return app;
}

beforeEach(() => {
  fichajeEnabled = true;
  tenantRowExists = true;
  lecturaRevienta = false;
  fakePrisma.tenant.findUnique.mockClear();
});

describe("F1 · gate FICHAJE_DISABLED", () => {
  const rutas: Array<[string, string, string]> = [
    ["GET", "/fake/panel-hoy", "el panel de la empresa"],
    ["POST", "/fake/fichar", "el móvil del empleado"],
  ];

  for (const [method, url, quien] of rutas) {
    it(`cierra ${quien} con 403 y una frase cuando el módulo está apagado`, async () => {
      fichajeEnabled = false;
      const app = await buildApp();
      const res = await app.inject({ method: method as any, url });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({
        error: "FICHAJE_DISABLED",
        message: FICHAJE_DISABLED_MESSAGE,
      });
      await app.close();
    });

    it(`deja pasar ${quien} cuando el módulo está encendido`, async () => {
      fichajeEnabled = true;
      const app = await buildApp();
      const res = await app.inject({ method: method as any, url });
      expect(res.statusCode).toBe(200);
      await app.close();
    });

    // El caso que protege a TODOS los tenants de hoy: la columna no
    // existe en su fila hasta que la migración corre, y aun después el
    // backfill la deja en false. Las dos situaciones son la misma puerta.
    it(`cierra ${quien} cuando la columna no existe (tenant de master)`, async () => {
      fichajeEnabled = undefined;
      const app = await buildApp();
      const res = await app.inject({ method: method as any, url });
      expect(res.statusCode).toBe(403);
      await app.close();
    });
  }

  it("el TPV no es una puerta de este módulo: no encuentra tenant y no gatea", async () => {
    fichajeEnabled = false;
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/fake/tpv" });
    // No 403: la función no resuelve tenant desde `cashier` ni `device`.
    // Lo que protege esas rutas es que no existen en este módulo.
    expect(res.statusCode).toBe(200);
    expect(fakePrisma.tenant.findUnique).not.toHaveBeenCalled();
    await app.close();
  });

  it("sin auth previa no responde: el 401 del middleware de auth manda", async () => {
    fichajeEnabled = false;
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/fake/sin-auth" });
    expect(res.statusCode).toBe(200);
    expect(fakePrisma.tenant.findUnique).not.toHaveBeenCalled();
    await app.close();
  });

  // La diferencia deliberada con `caja-gate.ts`, que falla hacia
  // ENCENDIDA. Aquí el default de la columna es `false` y abrir el módulo
  // a quien no lo ha contratado es el fallo que no queremos.
  it("una lectura que revienta deja el módulo APAGADO", async () => {
    lecturaRevienta = true;
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/fake/panel-hoy" });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("un tenant que no existe deja el módulo APAGADO", async () => {
    tenantRowExists = false;
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/fake/panel-hoy" });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
