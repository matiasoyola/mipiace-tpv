// verifactu-1b · el modo prueba no factura.
//
// Lo que este fichero fija, del lado del servidor:
//
//   1. `GET /tpv/fiscal/head` le contesta `emite: false` a una sesión de
//      prueba AUNQUE el comercio emita. Sin serie, sin instalación y sin
//      cabeza de cadena el terminal no puede generar nada — ése es el corte
//      de verdad, y por eso va primero.
//   2. El gate de la venta DESCARTA un `fiscalRecord` que llegue de una
//      sesión de prueba, y la venta sigue. Es el espejo del servidor: la
//      APK vieja, el outbox con cola de antes, el cliente que se salta el
//      head.
//   3. Las dos rutas de ANULACIÓN sí rechazan con 409. No hay venta que
//      proteger y lo que un ingest silencioso metería es un registro de
//      prueba en la cadena REAL de la caja.
//
// El «cero filas en fiscal_records» de verdad —contra Postgres, con la
// cadena delante— está en `test-e2e/verifactu-modo-prueba.e2e.ts`. Aquí se
// fija la decisión; allí, el efecto.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const REGISTER_ID = "33333333-3333-3333-3333-333333333333";
const DEVICE_ID = "44444444-4444-4444-4444-444444444444";
const USER_ID = "55555555-5555-5555-5555-555555555555";

// Un comercio que SÍ emite: `holdedEnabled: false`. Es el caso peligroso —
// el que hoy metería una factura de prueba en la cadena del cliente.
const tenantRow = {
  id: TENANT_ID,
  name: "PELUQUERÍA SOLE SL",
  holdedEnabled: false,
  cajaEnabled: true,
  businessType: "SERVICES",
  receiptFooter: null,
  fiscalProfile: { legalName: "PELUQUERÍA SOLE SL", taxId: "B45902186" },
};

const fiscalRecordFindFirst = vi.fn(async () => null);

const fakePrisma = {
  tenant: {
    findUnique: vi.fn(async () => tenantRow),
    findUniqueOrThrow: vi.fn(async () => tenantRow),
  },
  register: {
    findUnique: vi.fn(async () => ({ fiscalSeries: "C1" })),
    findUniqueOrThrow: vi.fn(async () => ({
      name: "Caja 1",
      fiscalSeries: "C1",
      fiscalInstallationId: randomUUID(),
      store: { name: "Peluquería Sole", fiscalAddress: null },
    })),
  },
  fiscalRecord: {
    findFirst: fiscalRecordFindFirst,
    findMany: vi.fn(async () => []),
  },
  $transaction: vi.fn(async (fn: any) => fn(fakePrisma)),
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));

const { registerFiscalRoutes } = await import("../src/fiscal/routes.js");
const { signCashierSession } = await import("../src/shift/cashier-session.js");
const {
  comprobarGateFiscal,
  RECHAZO_ANULACION_DE_PRUEBA,
} = await import("../src/fiscal/mode.js");

function token(purpose?: "test-cashier"): string {
  return signCashierSession(
    {
      sub: USER_ID,
      tid: TENANT_ID,
      did: DEVICE_ID,
      rid: REGISTER_ID,
      role: "MANAGER",
      ...(purpose ? { purpose } : {}),
    },
    60,
  );
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerFiscalRoutes(app);
  await app.ready();
  return app;
}

const UN_REGISTRO = {
  externalId: randomUUID(),
  kind: "ANULACION" as const,
  chainIndex: 1,
  serie: "C1",
  numero: 1,
  generatedAt: new Date().toISOString(),
  huellaInput: "IDEmisorFactura=B45902186&…&Huella=&",
  payload: {},
};

beforeEach(() => {
  fiscalRecordFindFirst.mockClear();
});

describe("GET /tpv/fiscal/head", () => {
  it("le dice a un cajero normal de un comercio que emite que SÍ emite", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/tpv/fiscal/head",
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().emite).toBe(true);
    expect(res.json().serie).toBe("C1");
    await app.close();
  });

  it("le dice al MODO PRUEBA que no emite, aunque el comercio emita", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/tpv/fiscal/head",
      headers: { authorization: `Bearer ${token("test-cashier")}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().emite).toBe(false);
    // Y no le da ni la serie ni la cabeza: sin eso no hay registro que
    // generar y no hay número que gastar.
    expect(res.json().serie).toBeUndefined();
    expect(res.json().cabeza).toBeUndefined();
    await app.close();
  });
});

describe("el gate de la venta", () => {
  const sesionNormal = { isTest: false };
  const sesionDePrueba = { isTest: true };

  it("un comercio que emite y una venta con registro: se ingesta", () => {
    const g = comprobarGateFiscal({ holdedEnabled: false }, UN_REGISTRO, sesionNormal);
    expect(g.rechazo).toBeNull();
    expect(g.descartarRegistro).toBe(false);
    expect(g.faltaRegistro).toBe(false);
  });

  it("una venta de PRUEBA con registro: se descarta y la venta sigue", () => {
    const g = comprobarGateFiscal({ holdedEnabled: false }, UN_REGISTRO, sesionDePrueba);
    expect(g.descartarRegistro).toBe(true);
    // Y NO se rechaza la petición: el modo prueba existe para validar el
    // flujo de cobro, y un 409 lo dejaría sin poder cobrar.
    expect(g.rechazo).toBeNull();
  });

  it("una venta de PRUEBA sin registro no es una «falta»", () => {
    const g = comprobarGateFiscal({ holdedEnabled: false }, null, sesionDePrueba);
    expect(g.faltaRegistro).toBe(false);
    expect(g.descartarRegistro).toBe(false);
  });

  it("el modo prueba de un comercio CON Holded tampoco ingesta", () => {
    const g = comprobarGateFiscal({ holdedEnabled: true }, UN_REGISTRO, sesionDePrueba);
    expect(g.descartarRegistro).toBe(true);
  });

  it("y un comercio con Holded que manda registro sigue siendo un 409", () => {
    const g = comprobarGateFiscal({ holdedEnabled: true }, UN_REGISTRO, sesionNormal);
    expect(g.rechazo?.error).toBe("FISCAL_MODE_OFF");
  });

  it("sin sesión, el gate se comporta como antes de este bloque", () => {
    expect(comprobarGateFiscal({ holdedEnabled: false }, null).faltaRegistro).toBe(true);
    expect(comprobarGateFiscal({ holdedEnabled: true }, UN_REGISTRO).rechazo).not.toBeNull();
  });
});

describe("las rutas de anulación", () => {
  it("POST /tickets/:id/fiscal-void rechaza al modo prueba con 409", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${randomUUID()}/fiscal-void`,
      headers: { authorization: `Bearer ${token("test-cashier")}` },
      payload: { fiscalRecord: UN_REGISTRO },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe(RECHAZO_ANULACION_DE_PRUEBA.error);
    // Y se corta ANTES de mirar la cadena: no llega a tocar la tabla.
    expect(fiscalRecordFindFirst).not.toHaveBeenCalled();
    await app.close();
  });

  it("POST /fiscal/anulaciones rechaza al modo prueba con 409", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/fiscal/anulaciones",
      headers: { authorization: `Bearer ${token("test-cashier")}` },
      payload: { fiscalRecord: UN_REGISTRO },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe(RECHAZO_ANULACION_DE_PRUEBA.error);
    await app.close();
  });
});
