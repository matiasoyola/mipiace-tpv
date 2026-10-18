// B-reservas-8 · EL SANITARIO SIN CAJA y LAS PUERTAS del módulo.
//
// Dos cosas que sólo se pueden afirmar mirando lo que SALE por la API:
//
//   · **Test 12** · un sanitario sin caja ve sesiones y **ningún euro**. No
//     se oculta en el front: no se manda. El test VUELCA el JSON entero y
//     busca claves y VALORES de dinero — si algún día alguien añade un
//     `Record<string, unknown>` por el medio, se pone rojo.
//   · **Test 13** · `bonosEnabled` con `holdedEnabled` se rechaza con su
//     motivo, y un tenant sin el módulo recibe **404 en todo** (no 403: a
//     una librería no se le cuenta que esto existe).

import { randomBytes, randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { E2E_DATABASE_URL, e2eEnabled, SKIP_MESSAGE } from "./e2e-env.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  E2E_DATABASE_URL || "postgresql://e2e:e2e@127.0.0.1:5432/e2e";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET = "e".repeat(40);
process.env.JWT_REFRESH_SECRET = "f".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

vi.mock("../src/queues/ticket-upload.js", () => ({
  enqueueTicketUpload: async () => {},
}));

const { getPrisma, shutdown } = await import("../src/context.js");
const { registerVoucherRoutes } = await import("../src/vouchers/routes.js");
const { registerCrmRoutes } = await import("../src/crm/routes.js");
const { registerErrorHandler } = await import("../src/lib/error-handler.js");
const { registerLenientJsonParser } = await import("../src/lib/lenient-json.js");
const { signAccessToken } = await import("../src/auth/tokens.js");
const { sembrarEscenario, sembrarBono } = await import("./bonos-escenario.js");
const { borrarCuentasDePrueba } = await import("./borrar-tenant.js");

type Escenario = Awaited<ReturnType<typeof sembrarEscenario>>;

describe.skipIf(!e2eEnabled)("e2e · el sanitario sin caja y las puertas", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let app: FastifyInstance;
  const tenantsCreados: string[] = [];

  let e: Escenario;
  let bonoId = "";
  let bonoCode = "";
  let tokenDeLaDuena = "";
  let tokenDelSanitario = "";

  beforeAll(async () => {
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    registerLenientJsonParser(app);
    await registerVoucherRoutes(app);
    await registerCrmRoutes(app);
    await app.ready();

    e = await sembrarEscenario(prisma);
    tenantsCreados.push(e.tenantId);
    const bono = await sembrarBono(prisma, e, {
      sesiones: 5,
      valorCartaCents: 15000,
    });
    bonoId = bono.id;
    bonoCode = bono.code;

    const duena = await prisma.user.create({
      data: {
        tenantId: e.tenantId,
        email: `duena+${randomUUID()}@e2e.local`,
        role: "OWNER",
      },
      select: { id: true },
    });
    tokenDeLaDuena = signAccessToken({
      sub: duena.id,
      tid: e.tenantId,
      role: "OWNER",
    });

    // LA PODÓLOGA SIN CAJA. `CLINICIAN` es el rol que clinica-1 creó, y es
    // lo que `esSanitarioSinCaja` reconoce.
    const sanitaria = await prisma.user.create({
      data: {
        tenantId: e.tenantId,
        email: `rosario.clinica+${randomUUID()}@e2e.local`,
        role: "CLINICIAN",
        isClinician: true,
      },
      select: { id: true },
    });
    tokenDelSanitario = signAccessToken({
      sub: sanitaria.id,
      tid: e.tenantId,
      role: "CLINICIAN",
    });
  });

  afterAll(async () => {
    await app?.close();
    await borrarCuentasDePrueba(prisma, ...tenantsCreados);
    await shutdown();
  });

  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  // ══════════════════════════════════════════════════════════════════
  // TEST 12 · NI UN EURO PARA EL SANITARIO SIN CAJA
  // ══════════════════════════════════════════════════════════════════

  /** Las claves de dinero que este módulo conoce. Si aparece una nueva,
   *  añadirla aquí es parte de añadirla al contrato. */
  const CLAVES_DE_DINERO = [
    "valorCartaCents",
    "cobradoCents",
    "amountLeftCents",
    "amountTotalCents",
    "precioCents",
    "importeCents",
    "basePrice",
    "unitPrice",
    "total",
    "soldTicketId",
  ];

  /** Y los VALORES: 15000 es el precio del bono de la siembra en céntimos,
   *  150 en euros. Buscar valores además de claves es lo que pilla a quien
   *  manda el importe con otro nombre. */
  const VALORES_DE_DINERO = ["15000", "150.0", ':150', '"150"'];

  function sinDinero(json: unknown): void {
    const texto = JSON.stringify(json);
    for (const clave of CLAVES_DE_DINERO) {
      expect(texto).not.toContain(clave);
    }
    for (const valor of VALORES_DE_DINERO) {
      expect(texto).not.toContain(valor);
    }
  }

  it("12a · GET /clients/:id/vouchers · el sanitario ve sesiones, la dueña ve euros", async () => {
    const delSanitario = await app.inject({
      method: "GET",
      url: `/clients/${e.clientId}/vouchers`,
      headers: auth(tokenDelSanitario),
    });
    expect(delSanitario.statusCode).toBe(200);
    const cuerpo = delSanitario.json();
    // Lo que SÍ ve: las sesiones y la frase.
    expect(cuerpo.vouchers[0]).toMatchObject({
      code: bonoCode,
      sesionesTotal: 5,
      sesionesLibres: 5,
      resumen: "quedan 5",
    });
    // Y lo que NO: el JSON ENTERO no contiene ningún importe. Ni clave ni
    // valor. Es el sabotaje «la API del sanitario manda cobradoCents».
    //
    // `balance.amountLeftCents` tampoco: es el saldo por importe de
    // B-cheques y aquí vale 0, pero mandarlo sería mandar una clave de
    // dinero a quien no ve dinero.
    sinDinero(cuerpo.vouchers);

    // La dueña, en cambio, ve las dos cifras separadas (`07` pieza 1).
    const deLaDuena = await app.inject({
      method: "GET",
      url: `/clients/${e.clientId}/vouchers`,
      headers: auth(tokenDeLaDuena),
    });
    expect(deLaDuena.statusCode).toBe(200);
    expect(deLaDuena.json().vouchers[0]).toMatchObject({
      valorCartaCents: 15000,
      cobradoCents: 15000,
    });
  });

  it("12b · GET /bonos/:id · la traza tampoco lleva euros", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/bonos/${bonoId}`,
      headers: auth(tokenDelSanitario),
    });
    expect(res.statusCode).toBe(200);
    const cuerpo = res.json();
    expect(cuerpo.bono).toMatchObject({ code: bonoCode, sesionesLibres: 5 });
    // La traza existe y se lee.
    expect(cuerpo.traza[0]).toMatchObject({
      tipo: "ALTA_INICIAL",
      quien: "Rosario",
    });
    sinDinero(cuerpo);
  });

  it("12c · GET /bonos/consultar · lo mismo por código", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/bonos/consultar?texto=${bonoCode}&clienteId=${e.clientId}`,
      headers: auth(tokenDelSanitario),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().estado).toBe("ok");
    sinDinero(res.json());
  });

  // ══════════════════════════════════════════════════════════════════
  // TEST 13 · LAS PUERTAS
  // ══════════════════════════════════════════════════════════════════
  it("13a · un tenant SIN bonos recibe 404 en todas las rutas del módulo", async () => {
    const apagado = await sembrarEscenario(prisma, { bonosEnabled: false });
    tenantsCreados.push(apagado.tenantId);
    const duena = await prisma.user.create({
      data: {
        tenantId: apagado.tenantId,
        email: `duena2+${randomUUID()}@e2e.local`,
        role: "OWNER",
      },
      select: { id: true },
    });
    const token = signAccessToken({
      sub: duena.id,
      tid: apagado.tenantId,
      role: "OWNER",
    });

    for (const url of [
      `/bonos/consultar?texto=B1`,
      `/bonos/${randomUUID()}`,
      `/clients/${apagado.clientId}/bonos-que-cubren?serviceIds=${apagado.quiropodiaId}`,
      `/tickets/${randomUUID()}/bonos`,
    ]) {
      const res = await app.inject({ method: "GET", url, headers: auth(token) });
      // 404 y NO 403: la respuesta es literalmente la de una ruta que no
      // existe. Mismo criterio que la clínica y la residencia.
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: "Not Found", statusCode: 404 });
    }

    // Y el POST del alta inicial, lo mismo.
    const alta = await app.inject({
      method: "POST",
      url: "/bonos/alta-inicial",
      headers: auth(token),
      payload: {
        clientId: apagado.clientId,
        nombre: "Bono de papel",
        sesiones: 3,
        coversTagSlugs: ["podologia"],
      },
    });
    expect(alta.statusCode).toBe(404);

    // Pero la ruta del CRM sigue contestando su contrato de siempre: saldo
    // cero y lista vacía. No es una ruta de bonos, es la ficha.
    const ficha = await app.inject({
      method: "GET",
      url: `/clients/${apagado.clientId}/vouchers`,
      headers: auth(token),
    });
    expect(ficha.statusCode).toBe(200);
    expect(ficha.json()).toEqual({
      balance: { sessionsLeft: 0, amountLeftCents: 0 },
      vouchers: [],
    });
  });

  it("13b · bonosEnabled con holdedEnabled: lo rechaza LA BASE", async () => {
    // El 409 de la ruta del super-admin se prueba en
    // `bonos-interruptor.test.ts`. Aquí se prueba el CHECK, que es el que
    // cubre las otras tres puertas de escritura a `tenants` (el fichero del
    // implantador, el sync y el psql de una tarde).
    await expect(
      prisma.tenant.create({
        data: {
          name: "Imposible e2e",
          bonosEnabled: true,
          // `holdedEnabled` es `@default(true)`, así que no hace falta
          // ponerlo: así se prueba también que el default cuenta.
        },
      }),
    ).rejects.toThrow(/tenants_bonos_sin_holded/);

    // Y encenderlo DESPUÉS en una cuenta con Holded, tampoco.
    const conHolded = await prisma.tenant.create({
      data: { name: "Con Holded e2e" },
      select: { id: true },
    });
    tenantsCreados.push(conHolded.id);
    await expect(
      prisma.tenant.update({
        where: { id: conHolded.id },
        data: { bonosEnabled: true },
      }),
    ).rejects.toThrow(/tenants_bonos_sin_holded/);
  });
});
