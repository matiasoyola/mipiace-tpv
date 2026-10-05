// clinica-1 · «ningún cobro puede nacer de un CLINICIAN».
//
// La garantía se comprueba EN LA API y no esconde botones, así que lo que
// este banco prueba es la puerta, no la pantalla. Y la prueba en el único
// sitio donde está escrita: `ensureCajaEnabled`, el `preHandler` que
// llevan las 103 rutas de caja que el guardia de cableado de
// `h1-caja-gate.test.ts` cuenta una por una.
//
// Tres cosas, y la tercera es la que casi se quedó fuera:
//
//   1. Un sanitario no vende, no abre turno, no abre cajón, no imprime.
//   2. Un cajero, una encargada y la dueña siguen pasando igual.
//   3. LA VENTANA DE TRANSICIÓN. La sesión del TPV vive el turno entero
//      (hasta 12 h) y su JWT no lleva `tokenVersion`, así que a una
//      cajera que acaba de pasar a sanitaria el token le sigue diciendo
//      `CASHIER`. Si la puerta sólo mirara el JWT, podría cobrar media
//      jornada — justo el día de la implantación, que es cuando se
//      cambian los roles.

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
const DEVICE_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const REGISTER_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

// El rol que dice el JWT, y el que dice la base. Separados a propósito:
// la ventana de transición es exactamente el caso en que no coinciden.
let rolDelToken: "OWNER" | "MANAGER" | "CASHIER" | "CLINICIAN" = "CASHIER";
let rolEnLaBase: "OWNER" | "MANAGER" | "CASHIER" | "CLINICIAN" = "CASHIER";
let lecturaDeUserRevienta = false;

const fakePrisma: any = {
  tenant: {
    findUnique: vi.fn(async () => ({ id: TENANT_ID, cajaEnabled: true })),
  },
  user: {
    findUnique: vi.fn(async () => {
      if (lecturaDeUserRevienta) throw new Error("db down");
      return { role: rolEnLaBase };
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

const { ensureCajaEnabled, CLINICIAN_NO_CAJA_MESSAGE } = await import(
  "../src/lib/caja-gate.js"
);

function fakeAuth(kind: "cashier" | "admin") {
  return async (request: any) => {
    if (kind === "cashier") {
      request.cashier = {
        sub: USER_ID,
        userId: USER_ID,
        tid: TENANT_ID,
        did: DEVICE_ID,
        rid: REGISTER_ID,
        role: rolDelToken,
        type: "cashier",
      };
    } else {
      request.auth = {
        userId: USER_ID,
        tenantId: TENANT_ID,
        role: rolDelToken,
      };
    }
  };
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  // Los cuatro de la lista del prompt: venta, turno, cajón e informe.
  for (const ruta of ["venta", "turno", "cajon", "informe-z"]) {
    app.post(
      `/fake/${ruta}`,
      { preHandler: [fakeAuth("cashier"), ensureCajaEnabled] },
      async () => ({ ok: ruta }),
    );
  }
  app.get(
    "/fake/panel",
    { preHandler: [fakeAuth("admin"), ensureCajaEnabled] },
    async () => ({ ok: "panel" }),
  );
  await app.ready();
  return app;
}

beforeEach(() => {
  rolDelToken = "CASHIER";
  rolEnLaBase = "CASHIER";
  lecturaDeUserRevienta = false;
  fakePrisma.user.findUnique.mockClear();
});

describe("clinica-1 · el sanitario no toca la caja", () => {
  const RUTAS = ["venta", "turno", "cajon", "informe-z"] as const;

  it.each(RUTAS)("un CLINICIAN no puede %s: 403 con frase", async (ruta) => {
    rolDelToken = "CLINICIAN";
    rolEnLaBase = "CLINICIAN";
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/fake/${ruta}` });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("CLINICIAN_NO_CAJA");
    // El TPV pinta el `message` tal cual, y tiene que decir qué hacer.
    expect(res.json().message).toBe(CLINICIAN_NO_CAJA_MESSAGE);
    await app.close();
  });

  it("con el JWT de CLINICIAN no hace falta ir a la base", async () => {
    // La comprobación 1 no tiene I/O, así que no puede fallar por una
    // lectura. Es la que cubre a todo sanitario real.
    rolDelToken = "CLINICIAN";
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/fake/venta" });
    expect(fakePrisma.user.findUnique).not.toHaveBeenCalled();
    await app.close();
  });

  it.each(["CASHIER", "MANAGER", "OWNER"] as const)(
    "un %s sigue cobrando exactamente igual",
    async (rol) => {
      rolDelToken = rol;
      rolEnLaBase = rol;
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url: "/fake/venta" });
      expect(res.statusCode).toBe(200);
      await app.close();
    },
  );

  it("un OWNER o MANAGER no gasta la consulta extra", async () => {
    // El puesto de la propietaria no se cambia a CLINICIAN desde ninguna
    // pantalla, así que preguntarlo en cada cobro sería pagar por nada —
    // y la dueña es la que cobra todo el día en el piloto.
    for (const rol of ["OWNER", "MANAGER"] as const) {
      rolDelToken = rol;
      const app = await buildApp();
      await app.inject({ method: "POST", url: "/fake/venta" });
      await app.close();
    }
    expect(fakePrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("LA VENTANA: el token dice CASHIER y la base dice CLINICIAN → no cobra", async () => {
    rolDelToken = "CASHIER";
    rolEnLaBase = "CLINICIAN";
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/fake/venta" });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("CLINICIAN_NO_CAJA");
    expect(fakePrisma.user.findUnique).toHaveBeenCalled();
    await app.close();
  });

  it("si la lectura revienta, la caja queda ABIERTA — una venta no se cae por esto", async () => {
    // Misma dirección de fallo que `cajaIsDisabled` (ADR-016 §6) y la
    // misma razón: una lectura que revienta no puede ser el motivo de que
    // un cliente no pueda pagar. Lo que se pierde al fallar es la
    // ventana de transición; lo que no se pierde nunca es la
    // comprobación del JWT, que no depende de nada.
    rolDelToken = "CASHIER";
    rolEnLaBase = "CLINICIAN";
    lecturaDeUserRevienta = true;
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/fake/venta" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("y tampoco entra por la puerta del panel", async () => {
    rolDelToken = "CLINICIAN";
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/fake/panel" });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe("clinica-1 · las dos rutas que NO llevan el gate siguen sin llevarlo", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");

  it("cerrar sesión no se gatea: un sanitario tiene que poder salir", () => {
    const src = readFileSync(
      new URL("../src/shift/cashier-auth.ts", import.meta.url),
      "utf8",
    );
    const logout = src.slice(src.indexOf('"/shift/cashier-logout"'));
    const hasta = logout.slice(0, logout.indexOf("async () =>"));
    expect(hasta).toContain("requireCashierSession");
    expect(hasta).not.toContain("ensureCajaEnabled");
  });

  it("EL SANITARIO ENTRA AL TPV: las DOS listas de rol lo incluyen", () => {
    // `/shift/cashier-login` SÍ lleva el gate de la caja, pero cuando
    // corre todavía no hay sesión ni rol que mirar (sólo el device
    // token), así que el sanitario pasa. Lo que decide si entra es el
    // `role: { in: [...] }` del `findFirst`.
    //
    // SON DOS LISTAS Y HAY QUE CONTARLAS, no comprobar que el nombre
    // aparece «alguna vez» en el fichero: una es el LOGIN y la otra el
    // ROSTER OFFLINE. Este test nació contando una sola vez — y pasaba
    // en verde con el login SIN `CLINICIAN`, o sea con un sanitario que
    // no podía entrar al TPV de ninguna manera. Lo destapó el banco de
    // la agenda, no la suite.
    const src = readFileSync(
      new URL("../src/shift/cashier-auth.ts", import.meta.url),
      "utf8",
    );
    const conSanitario = src.match(
      /role: \{ in: \["OWNER", "MANAGER", "CASHIER", "CLINICIAN"\] \}/g,
    );
    expect(conSanitario).toHaveLength(2);
    // Y ninguna se ha quedado con la lista corta.
    expect(src).not.toMatch(/role: \{ in: \["OWNER", "MANAGER", "CASHIER"\] \}/);
  });
});
