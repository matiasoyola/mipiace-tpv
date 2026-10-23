// hotfix-menu-capabilities · ESCONDER NO ES GATEAR.
//
// El hotfix quita «Bonos» del menú de las cuentas que no tienen el módulo.
// Eso es cosmética, y lo que de verdad protege los datos es la puerta del
// servidor. Este fichero es el banco de que sigue ahí, y de que contesta
// la MISMA 404 que una ruta que no existe —carácter por carácter—, porque
// un 403 le confirmaría a una librería que este módulo existe.
//
// Se monta `registerVoucherAdminRoutes` de verdad, no una ruta de
// mentira: lo que se prueba es que las rutas REALES llevan el gate. Si
// alguien quita `ensureBonosEnabled` de una de ellas, esto se pone rojo.
//
// La puerta de la clínica —la del «Contrato de datos», la otra entrada que
// el hotfix esconde— ya tiene su banco en `clinica-7-contrato-rutas.test.ts`
// («con el módulo APAGADO, la ruta del contrato NO EXISTE»).

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PRODUCT_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

// `undefined` = la columna no está en la fila (una base anterior a la
// migración de bonos). Tiene que leerse como APAGADO.
let bonosEnabled: boolean | undefined = true;

const fakePrisma: any = {
  tenant: {
    findUnique: vi.fn(async ({ where }: any) =>
      where.id === TENANT_ID ? { id: TENANT_ID, bonosEnabled } : null,
    ),
    findUniqueOrThrow: vi.fn(async () => ({
      bonoEtiqueta: "bono",
      bonoNoShow: "consumir",
      bonoCaducidadMeses: null,
      bonoModoCanje: "LINEA_CERO",
    })),
  },
  voucherSequence: { findUnique: vi.fn(async () => null) },
  voucher: { count: vi.fn(async () => 0) },
  voucherTemplate: { findMany: vi.fn(async () => []) },
};

vi.mock("../src/context.js", () => ({
  initContext: vi.fn(),
  getPrisma: () => fakePrisma,
  getRedis: () => ({}),
  closeContext: vi.fn(),
  shutdown: vi.fn(),
}));

// La puerta de auth, puesta a mano: este banco es de la puerta del
// MÓDULO, y arrastrar JWTs aquí sólo añadiría formas de fallar que ya
// tienen su propio fichero.
vi.mock("../src/auth/middleware.js", () => {
  const comoDuena = async (request: any) => {
    request.auth = { userId: USER_ID, tenantId: TENANT_ID, role: "OWNER" };
  };
  return {
    requireOwner: comoDuena,
    requireOwnerOrManager: comoDuena,
    requireOwnerOrCashier: comoDuena,
  };
});

const { registerVoucherAdminRoutes } = await import(
  "../src/vouchers/routes-admin.js"
);

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerVoucherAdminRoutes(app);
  await app.ready();
  return app;
}

/** La 404 de Fastify para una ruta que no existe, tal cual. */
const la404 = (method: string, url: string) => ({
  statusCode: 404,
  error: "Not Found",
  message: `Route ${method}:${url} not found`,
});

// Todas las rutas del módulo. Los cuerpos son VÁLIDOS a propósito:
// Fastify valida el esquema ANTES de los `preHandler`, así que un cuerpo
// mal formado daría 400 y este banco estaría midiendo el validador en vez
// de la puerta.
interface Ruta {
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  payload?: Record<string, unknown>;
}

const RUTAS: Ruta[] = [
  { method: "GET", url: "/admin/bonos/ajustes" },
  { method: "POST", url: "/admin/bonos/ajustes", payload: { etiqueta: "bono" } },
  { method: "POST", url: "/admin/bonos/arranque", payload: { numero: "B231" } },
  { method: "GET", url: "/admin/bonos/plantillas" },
  {
    method: "PUT",
    url: `/admin/bonos/plantillas/${PRODUCT_ID}`,
    payload: { sessions: 10 },
  },
  { method: "DELETE", url: `/admin/bonos/plantillas/${PRODUCT_ID}` },
];

beforeEach(() => {
  bonosEnabled = true;
});

describe("hotfix-menu-capabilities · la puerta del módulo de bonos", () => {
  it.each(RUTAS)(
    "$method $url contesta la 404 de una ruta inexistente con el módulo apagado",
    async ({ method, url, payload }) => {
      bonosEnabled = false;
      const app = await buildApp();
      const res = await app.inject({ method, url, payload });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual(la404(method, url));
      await app.close();
    },
  );

  it("y con la columna ausente también: se lee como apagado", async () => {
    // Una base anterior a la migración de bonos. Fallar hacia encendido
    // enseñaría saldos de una clienta a una cuenta que no contrató nada.
    bonosEnabled = undefined;
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/admin/bonos/ajustes" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("con el módulo encendido la ruta existe y contesta", async () => {
    // El control. Sin esto, un 404 por cualquier otra razón —una ruta mal
    // escrita en la lista de arriba— dejaría el fichero verde sin probar
    // nada.
    const app = await buildApp();
    const ajustes = await app.inject({
      method: "GET",
      url: "/admin/bonos/ajustes",
    });
    expect(ajustes.statusCode).toBe(200);
    expect(ajustes.json().ajustes.etiqueta).toBe("bono");
    const plantillas = await app.inject({
      method: "GET",
      url: "/admin/bonos/plantillas",
    });
    expect(plantillas.statusCode).toBe(200);
    expect(plantillas.json().plantillas).toEqual([]);
    await app.close();
  });
});
