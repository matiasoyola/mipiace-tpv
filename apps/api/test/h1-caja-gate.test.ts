// H1 · la puerta de la caja (ADR-016).
//
// Lo que este banco fija:
//
//   1. Con `cajaEnabled: false` la venta, el turno, el catálogo del TPV y
//      el arranque del terminal responden 403 CAJA_DISABLED con una
//      frase, no un 500 ni un cuerpo vacío.
//   2. Con `cajaEnabled: true` —y con la columna ausente, que es como se
//      comportan los tenants de master hasta que la migración corre— la
//      puerta no existe: el request pasa igual que antes.
//   3. Cerrar sesión NO se gatea: un cajero al que le apagan la caja a
//      media jornada tiene que poder salir.
//   4. La puerta es del servidor. El gate no consulta ninguna caché ni
//      ningún flag del cliente.
//
// Sabotajes que este fichero pone en rojo (§3 del done):
//   · quitar `ensureCajaEnabled` de `/tpv/catalog/products` (nº 4)
//   · quitarlo de `/tickets` o de `/shift/open`
//   · cambiar `=== false` por `!` (rompe el caso "columna ausente")

import { randomBytes, randomUUID } from "node:crypto";

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
const USER_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const DEVICE_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const REGISTER_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

// `undefined` = la columna no existe en la fila (un tenant de master
// antes de la migración, o un banco de pruebas que no la modela).
let cajaEnabled: boolean | undefined = true;
let tenantRowExists = true;

const fakePrisma: any = {
  tenant: {
    findUnique: vi.fn(async ({ where }: any) => {
      if (!tenantRowExists || where.id !== TENANT_ID) return null;
      return { id: TENANT_ID, cajaEnabled };
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

const { ensureCajaEnabled, CAJA_DISABLED_MESSAGE } = await import(
  "../src/lib/caja-gate.js"
);

// Los tres contextos de auth que la puerta tiene que entender. Cada uno
// se simula con un preHandler que puebla el request como lo haría el
// middleware real, sin arrastrar JWTs a este banco.
function fakeAuth(kind: "admin" | "cashier" | "device") {
  return async (request: any) => {
    if (kind === "admin") {
      request.auth = { userId: USER_ID, tenantId: TENANT_ID, role: "OWNER" };
    } else if (kind === "cashier") {
      request.cashier = {
        sub: USER_ID,
        userId: USER_ID,
        tid: TENANT_ID,
        did: DEVICE_ID,
        rid: REGISTER_ID,
        role: "CASHIER",
        type: "cashier",
      };
    } else {
      request.device = {
        deviceId: DEVICE_ID,
        tenantId: TENANT_ID,
        registerId: REGISTER_ID,
      };
    }
  };
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.post(
    "/fake/venta",
    { preHandler: [fakeAuth("cashier"), ensureCajaEnabled] },
    async () => ({ ok: "vendido" }),
  );
  app.post(
    "/fake/turno",
    { preHandler: [fakeAuth("cashier"), ensureCajaEnabled] },
    async () => ({ ok: "turno" }),
  );
  app.get(
    "/fake/catalogo",
    { preHandler: [fakeAuth("cashier"), ensureCajaEnabled] },
    async () => ({ ok: "catalogo" }),
  );
  app.get(
    "/fake/device-me",
    { preHandler: [fakeAuth("device"), ensureCajaEnabled] },
    async () => ({ ok: "device" }),
  );
  app.get(
    "/fake/panel",
    { preHandler: [fakeAuth("admin"), ensureCajaEnabled] },
    async () => ({ ok: "panel" }),
  );
  // Sin auth previa: la puerta no tiene tenant que mirar y no debe
  // inventarse uno ni reventar.
  app.get("/fake/sin-auth", { preHandler: [ensureCajaEnabled] }, async () => ({
    ok: "sin-auth",
  }));
  await app.ready();
  return app;
}

beforeEach(() => {
  cajaEnabled = true;
  tenantRowExists = true;
  fakePrisma.tenant.findUnique.mockClear();
});

describe("H1 · gate CAJA_DISABLED", () => {
  const rutas = [
    ["POST", "/fake/venta", "la venta"],
    ["POST", "/fake/turno", "el turno"],
    ["GET", "/fake/catalogo", "el catálogo"],
    ["GET", "/fake/device-me", "el arranque del terminal"],
    ["GET", "/fake/panel", "una sección del panel"],
  ] as const;

  it.each(rutas)(
    "con la caja apagada, %s %s (%s) responde 403 con frase",
    async (method, url) => {
      cajaEnabled = false;
      const app = await buildApp();
      const res = await app.inject({ method: method as any, url });
      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error).toBe("CAJA_DISABLED");
      // No basta con el código: el TPV pinta el `message` tal cual.
      expect(body.message).toBe(CAJA_DISABLED_MESSAGE);
      expect(body.message.length).toBeGreaterThan(20);
    },
  );

  it.each(rutas)("con la caja encendida, %s %s deja pasar", async (method, url) => {
    cajaEnabled = true;
    const app = await buildApp();
    const res = await app.inject({ method: method as any, url });
    expect(res.statusCode).toBe(200);
  });

  it("con la columna ausente (tenant de master) deja pasar: sólo un false explícito apaga", async () => {
    cajaEnabled = undefined;
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/fake/venta" });
    expect(res.statusCode).toBe(200);
  });

  it("si el tenant no existe, la puerta no bloquea (el handler decide el 404)", async () => {
    tenantRowExists = false;
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/fake/venta" });
    expect(res.statusCode).toBe(200);
  });

  it("sin contexto de auth no consulta la base ni bloquea", async () => {
    cajaEnabled = false;
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/fake/sin-auth" });
    expect(res.statusCode).toBe(200);
    expect(fakePrisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it("resuelve el tenant desde las tres puertas de auth", async () => {
    cajaEnabled = false;
    const app = await buildApp();
    for (const url of ["/fake/venta", "/fake/device-me", "/fake/panel"]) {
      const res = await app.inject({
        method: url === "/fake/venta" ? "POST" : "GET",
        url,
      });
      expect(res.statusCode, url).toBe(403);
    }
  });
});

describe("H1 · las rutas reales llevan la puerta puesta", () => {
  // Guardia de regresión sobre el cableado: leer el fichero y comprobar
  // que ninguna ruta de caja se quedó sin `ensureCajaEnabled`. Es el
  // sabotaje "olvidar el gate de API de una sección escondida".
  const { readFileSync } = require("node:fs") as typeof import("node:fs");

  const ESPERADAS: Array<[string, number]> = [
    ["shift/routes.ts", 10],
    ["shift/cashier-auth.ts", 3],
    ["tpv-catalog/routes.ts", 4],
    ["devices/routes.ts", 5],
    ["cashiers/routes.ts", 5],
    ["tickets/routes.ts", 8],
    ["tickets/credit-routes.ts", 4],
    ["tables/operativa.ts", 6],
    ["tables/grouping.ts", 3],
    ["tables/routes.ts", 8],
    ["catalog/routes.ts", 5],
    ["admin/tickets-errors.ts", 10],
    ["admin/gift-receipts.ts", 3],
    ["admin/printer-configs.ts", 5],
    ["admin/modifier-groups.ts", 9],
    ["admin/tag-aliases.ts", 3],
    ["admin/tag-sections.ts", 3],
    // Sole (23-09-2026) · 3 desde que "Comunicación de ticket" tiene
    // también el resumen de envíos fallidos (GET …/email-failures).
    ["admin/ticket-delivery.ts", 3],
    ["admin/manager-authorize.ts", 1],
    ["stores/routes.ts", 5],
  ];

  it.each(ESPERADAS)("%s gatea %i rutas", (rel, n) => {
    const src = readFileSync(
      new URL(`../src/${rel}`, import.meta.url),
      "utf8",
    );
    // Contamos el cierre del array del preHandler, no el nombre suelto:
    // el import y los comentarios también lo nombran.
    const hits = src.match(/, ensureCajaEnabled\]/g) ?? [];
    expect(hits.length).toBe(n);
  });

  it("/tpv/catalog/products gatea DENTRO del handler, no en el preHandler", () => {
    // La puerta va sobre el tenant que la primera página ya lee, para no
    // añadir una consulta por cada cursor de paginación (ver la nota del
    // fichero). Si alguien la mueve a un preHandler, el banco de
    // `tpv-catalog-business-type` se pone rojo por la consulta de más.
    const src = readFileSync(
      new URL("../src/tpv-catalog/routes.ts", import.meta.url),
      "utf8",
    );
    expect(src).toMatch(/cajaEnabled: true,/);
    expect(src).toMatch(/tenant\?\.cajaEnabled === false/);
  });

  it("/admin/stores (identidad fiscal del local) NO se gatea: vale sin caja", () => {
    const src = readFileSync(
      new URL("../src/stores/routes.ts", import.meta.url),
      "utf8",
    );
    // El CRUD de tiendas son cinco rutas y ninguna lleva la puerta; las
    // cinco que sí la llevan son warehouses y registers.
    expect((src.match(/preHandler: require/g) ?? []).length).toBe(5);
  });
});
