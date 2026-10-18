// puesta-en-marcha (ADR-021) · una cuenta en ENSAYO no emite nada.
//
// Lo que este fichero fija, y es la generalización del addendum 1b de
// verifactu: allí «prueba» era QUIÉN cobraba (un JWT con `purpose:
// test-cashier`); aquí es LA CUENTA, así que vale para cualquier cajero
// desde cualquier terminal emparejado. Eso es lo que permite ensayar en el
// hierro del cliente, que es la razón de ser del bloque.
//
//   1. `enEnsayo` y `emiteMipiacetpv`: mientras no haya fecha de arranque no
//      se emite, aunque el comercio no use Holded.
//   2. `GET /tpv/fiscal/head` contesta `emite: false, ensayo: true`, y sin
//      serie, sin instalación y sin cabeza de cadena. Ése es el corte de
//      verdad: el terminal no genera nada y no gasta número.
//   3. El gate de la venta DESCARTA el registro que llegue y la venta SIGUE.
//      Cobrar siempre se puede.
//   4. Las dos rutas de anulación rechazan con 409 `TENANT_EN_ENSAYO`, con
//      su propio código y no con el del modo prueba: lo que hay que hacer es
//      distinto (pulsar «Empezar a facturar», no salir del modo prueba).
//   5. `esCobroDeEnsayo` es UNA función para las tres decisiones que tienen
//      que coincidir siempre: en qué estado nace el ticket, si el registro
//      se descarta y si el papel sale marcado.
//
// El «cero filas en fiscal_records» de verdad —contra Postgres, con la
// cadena delante, y el ensayo → reset → arrancar → `C1/1` completo— está en
// `test-e2e/puesta-en-marcha.e2e.ts`. Aquí se fija la decisión; allí, el
// efecto.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const REGISTER_ID = "33333333-3333-3333-3333-333333333333";
const DEVICE_ID = "44444444-4444-4444-4444-444444444444";
const USER_ID = "55555555-5555-5555-5555-555555555555";

const FACTURANDO = new Date("2026-06-01T08:00:00.000Z");

// Cafetería Sirope: cuenta ACTIVE desde junio, con su catálogo, su sala y su
// terminal emparejado, y SIN una sola venta real. `facturaDesde: null` es
// todo lo que la distingue de un comercio que factura — y es el caso que
// hasta este bloque no se podía probar en un aparato.
const tenantEnEnsayo = {
  id: TENANT_ID,
  name: "CAFETERÍA SIROPE SL",
  holdedEnabled: false,
  facturaDesde: null as Date | null,
  cajaEnabled: true,
  businessType: "HOSPITALITY",
  receiptFooter: null,
  fiscalProfile: { legalName: "CAFETERÍA SIROPE SL", taxId: "B45902186" },
};

function fakePrismaCon(tenant: Record<string, unknown>) {
  const fake: Record<string, unknown> = {
    tenant: {
      findUnique: vi.fn(async () => tenant),
      findUniqueOrThrow: vi.fn(async () => tenant),
    },
    register: {
      findUnique: vi.fn(async () => ({ fiscalSeries: "C1" })),
      findUniqueOrThrow: vi.fn(async () => ({
        name: "Caja 1",
        fiscalSeries: "C1",
        fiscalInstallationId: randomUUID(),
        store: { name: "Cafetería Sirope", fiscalAddress: null },
      })),
    },
    fiscalRecord: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
  };
  fake.$transaction = vi.fn(async (fn: any) => fn(fake));
  return fake;
}

let prismaActual = fakePrismaCon(tenantEnEnsayo);

vi.mock("../src/context.js", () => ({
  getPrisma: () => prismaActual,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));

const { registerFiscalRoutes } = await import("../src/fiscal/routes.js");
const { signCashierSession } = await import("../src/shift/cashier-session.js");
const {
  comprobarGateFiscal,
  emiteMipiacetpv,
  enEnsayo,
  esCobroDeEnsayo,
} = await import("../src/fiscal/mode.js");

function token(purpose?: "test-cashier"): string {
  return signCashierSession(
    {
      sub: USER_ID,
      tid: TENANT_ID,
      did: DEVICE_ID,
      rid: REGISTER_ID,
      role: "CASHIER",
      ...(purpose ? { purpose } : {}),
    },
    60,
  );
}

async function buildApp(tenant: Record<string, unknown>): Promise<FastifyInstance> {
  prismaActual = fakePrismaCon(tenant);
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

describe("¿esta cuenta factura?", () => {
  it("sin fecha de arranque está en ensayo", () => {
    expect(enEnsayo({ facturaDesde: null })).toBe(true);
    expect(enEnsayo({ facturaDesde: FACTURANDO })).toBe(false);
  });

  it("en ensayo NO emite, aunque el comercio no use Holded", () => {
    // El caso peligroso: `holdedEnabled: false` es justo lo que hasta este
    // bloque significaba «emite». Si esta línea se pusiera verde al revés,
    // el primer cobro de ensayo sería la factura C1/1 de la titular.
    expect(
      emiteMipiacetpv({ holdedEnabled: false, facturaDesde: null }),
    ).toBe(false);
    expect(
      emiteMipiacetpv({ holdedEnabled: false, facturaDesde: FACTURANDO }),
    ).toBe(true);
  });

  it("y con Holded no emite ni antes ni después de arrancar", () => {
    expect(
      emiteMipiacetpv({ holdedEnabled: true, facturaDesde: null }),
    ).toBe(false);
    expect(
      emiteMipiacetpv({ holdedEnabled: true, facturaDesde: FACTURANDO }),
    ).toBe(false);
  });
});

describe("¿este cobro es un ensayo?", () => {
  it("lo es por la cuenta, por la sesión, o por las dos", () => {
    const enMarcha = { facturaDesde: FACTURANDO };
    const ensayo = { facturaDesde: null };
    expect(esCobroDeEnsayo(ensayo, { isTest: false })).toBe(true);
    expect(esCobroDeEnsayo(enMarcha, { isTest: true })).toBe(true);
    expect(esCobroDeEnsayo(ensayo, { isTest: true })).toBe(true);
    // Y el único caso que NO lo es: cuenta arrancada y cajero de verdad.
    expect(esCobroDeEnsayo(enMarcha, { isTest: false })).toBe(false);
  });

  it("sin sesión decide la cuenta sola", () => {
    expect(esCobroDeEnsayo({ facturaDesde: null })).toBe(true);
    expect(esCobroDeEnsayo({ facturaDesde: FACTURANDO })).toBe(false);
  });
});

describe("GET /tpv/fiscal/head", () => {
  it("en ensayo: no emite, lo dice, y no da serie ni cabeza", async () => {
    const app = await buildApp(tenantEnEnsayo);
    const res = await app.inject({
      method: "GET",
      url: "/tpv/fiscal/head",
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().emite).toBe(false);
    // `ensayo` es lo que distingue los DOS motivos para no emitir. El
    // terminal los necesita separados: con Holded imprime el papel de
    // siempre, en ensayo lo marca como de prueba.
    expect(res.json().ensayo).toBe(true);
    // Sin esto el terminal no puede generar nada ni gastar número. Es el
    // corte de verdad; el gate del servidor es el espejo.
    expect(res.json().serie).toBeUndefined();
    expect(res.json().numeroInstalacion).toBeUndefined();
    expect(res.json().cabeza).toBeUndefined();
    await app.close();
  });

  it("tras arrancar: emite, con su serie, y `ensayo: false`", async () => {
    const app = await buildApp({ ...tenantEnEnsayo, facturaDesde: FACTURANDO });
    const res = await app.inject({
      method: "GET",
      url: "/tpv/fiscal/head",
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().emite).toBe(true);
    expect(res.json().ensayo).toBe(false);
    expect(res.json().serie).toBe("C1");
    await app.close();
  });

  it("y un comercio con Holded no emite, pero tampoco está en ensayo", async () => {
    const app = await buildApp({
      ...tenantEnEnsayo,
      holdedEnabled: true,
      facturaDesde: FACTURANDO,
    });
    const res = await app.inject({
      method: "GET",
      url: "/tpv/fiscal/head",
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.json().emite).toBe(false);
    expect(res.json().ensayo).toBe(false);
    await app.close();
  });
});

describe("el gate de la venta en ensayo", () => {
  const sesionNormal = { isTest: false };

  it("descarta el registro que llegue y la venta SIGUE", async () => {
    const g = comprobarGateFiscal(
      { holdedEnabled: false, facturaDesde: null },
      UN_REGISTRO,
      sesionNormal,
    );
    expect(g.descartarRegistro).toBe(true);
    // Ni rechazo ni 409: el ensayo existe para validar el flujo de cobro en
    // el aparato del cliente, y un 409 lo dejaría sin poder cobrar.
    expect(g.rechazo).toBeNull();
  });

  it("una venta de ensayo sin registro no es una «falta»", () => {
    const g = comprobarGateFiscal(
      { holdedEnabled: false, facturaDesde: null },
      null,
      sesionNormal,
    );
    expect(g.faltaRegistro).toBe(false);
    expect(g.descartarRegistro).toBe(false);
  });

  it("y en una cuenta en ensayo CON Holded tampoco se ingesta", () => {
    const g = comprobarGateFiscal(
      { holdedEnabled: true, facturaDesde: null },
      UN_REGISTRO,
      sesionNormal,
    );
    expect(g.descartarRegistro).toBe(true);
    expect(g.rechazo).toBeNull();
  });

  it("tras arrancar, el mismo registro SÍ se ingesta", () => {
    const g = comprobarGateFiscal(
      { holdedEnabled: false, facturaDesde: FACTURANDO },
      UN_REGISTRO,
      sesionNormal,
    );
    expect(g.descartarRegistro).toBe(false);
    expect(g.rechazo).toBeNull();
    expect(g.faltaRegistro).toBe(false);
  });
});

describe("las rutas de anulación en ensayo", () => {
  it("POST /tickets/:id/fiscal-void contesta 409 TENANT_EN_ENSAYO", async () => {
    const app = await buildApp(tenantEnEnsayo);
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${randomUUID()}/fiscal-void`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { fiscalRecord: UN_REGISTRO },
    });
    expect(res.statusCode).toBe(409);
    // Y NO `FISCAL_MODE_OFF`: contarle «el emisor es Holded» a la cajera de
    // una cafetería que no usa Holded la manda a mirar donde no es.
    expect(res.json().error).toBe("TENANT_EN_ENSAYO");
    await app.close();
  });

  it("POST /fiscal/anulaciones también: no hay número gastado que cerrar", async () => {
    const app = await buildApp(tenantEnEnsayo);
    const res = await app.inject({
      method: "POST",
      url: "/fiscal/anulaciones",
      headers: { authorization: `Bearer ${token()}` },
      payload: { fiscalRecord: UN_REGISTRO },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("TENANT_EN_ENSAYO");
    await app.close();
  });
});
