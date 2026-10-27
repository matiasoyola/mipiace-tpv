// clinica-10 (H2) · EL MAPA `CATEGORÍA → TIPO DE VISITA` NO ES UN DATO DE
// SALUD.
//
// La pasada del 27-10: Agenda · Catálogo decía «Todavía no has asignado
// ninguna categoría» en una cuenta cuyo check «Catálogo clínico
// completo» estaba VERDE — y ese check cuenta exactamente esas filas
// (`medirCatalogoClinico` → `prisma.tagVisitType.findMany`).
//
// Dos cosas a la vez, y las dos están arregladas:
//
//   1. La pantalla pintaba un fallo de lectura como una lista vacía. Eso
//      es de `AgendaCatalogPage` y lo fija `clinica-10-panel`.
//   2. **Y había un fallo de lectura que provocar.** La ruta iba tras
//      `ensureClinicaEnabled`, que desde clinica-7 (decisión 24)
//      contesta la 404 de ruta inexistente a toda sesión de
//      impersonación del superadmin. O sea: el implantador de Mi Piace
//      —que carga el CSV de la clínica y CREA ESTAS MISMAS FILAS desde
//      super-admin (`superadmin/tenant-catalog.ts`)— no podía verlas
//      desde el panel de la cuenta.
//
// Lo que este fichero fija es lo segundo, con las dos mitades: la puerta
// de configuración deja pasar a Mi Piace, y la puerta de las historias
// **sigue sin dejarle pasar**. Si alguien cambiara la segunda por la
// primera en una ruta clínica, aquí se ve.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.SUPER_ADMIN_JWT_SECRET = "s".repeat(48);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = randomUUID();
const DUENA = randomUUID();

let clinicaEncendida = true;
let categorias: Array<{ id: string; slug: string; visitType: string }>;

const fakePrisma = {
  tenant: {
    findUnique: vi.fn(async () => ({
      clinicalRecordsEnabled: clinicaEncendida,
    })),
  },
  user: {
    findUnique: vi.fn(async () => ({
      id: DUENA,
      role: "OWNER",
      tenantId: TENANT,
      isClinician: true,
      revokedAt: null,
      tokenVersion: 0,
    })),
  },
  tagVisitType: {
    findMany: vi.fn(async () => categorias),
  },
  superAdminAudit: { create: vi.fn(async () => ({ id: randomUUID() })) },
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));

const { registerAdminTagVisitTypesRoutes } = await import(
  "../src/admin/tag-visit-types.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");
const { signImpersonationToken } = await import("../src/superadmin/tokens.js");
const { ensureClinicaConfigurable, ensureClinicaEnabled } = await import(
  "../src/clinica/gate.js"
);

const comoDuena = {
  authorization: `Bearer ${signAccessToken({
    sub: DUENA,
    tid: TENANT,
    role: "OWNER",
  })}`,
};

/** El token que firma la impersonación del superadmin: lleva el id REAL
 *  de la dueña y `role: OWNER`. */
const comoMiPiace = {
  authorization: `Bearer ${signImpersonationToken({
    sub: DUENA,
    tid: TENANT,
    tv: 0,
    by: "super-admin-1",
    mode: "full",
  })}`,
};

async function buildApp() {
  const app = Fastify();
  await registerAdminTagVisitTypesRoutes(app);
  await app.ready();
  return app;
}

beforeEach(() => {
  clinicaEncendida = true;
  categorias = [
    { id: "t1", slug: "consulta", visitType: "GENERAL" },
    { id: "t2", slug: "quiropodia", visitType: "QUIROPODIA" },
  ];
});

describe("clinica-10 (H2) · leer los tipos de visita del catálogo", () => {
  it("la dueña los ve, como siempre", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/admin/tag-visit-types",
      headers: comoDuena,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(2);
    await app.close();
  });

  it("y el implantador de Mi Piace TAMBIÉN: aquí no hay datos de salud", async () => {
    // Era la 404 que la pantalla pintaba como «no has asignado ninguna
    // categoría», y la que dejaba a quien monta la clínica sin ver lo
    // que él mismo acababa de cargar.
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/admin/tag-visit-types",
      headers: comoMiPiace,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.map((i: { slug: string }) => i.slug)).toEqual([
      "consulta",
      "quiropodia",
    ]);
    await app.close();
  });

  it("con el módulo clínico APAGADO sigue siendo una ruta que no existe", async () => {
    // Lo que la puerta de configuración NO relaja: un bar no puede saber
    // que este sistema tiene un módulo de datos de salud (clinica-1 §1).
    clinicaEncendida = false;
    const app = await buildApp();
    for (const headers of [comoDuena, comoMiPiace]) {
      const res = await app.inject({
        method: "GET",
        url: "/admin/tag-visit-types",
        headers,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: "Not Found" });
    }
    await app.close();
  });
});

describe("clinica-10 (H2) · las dos puertas, como funciones", () => {
  function respuestaFalsa() {
    const enviado: unknown[] = [];
    const respuesta = {
      code: () => respuesta,
      send: (c: unknown) => {
        enviado.push(c);
        return respuesta;
      },
    } as never;
    return { enviado, respuesta };
  }

  const deMiPiace = {
    auth: { isImpersonation: true, tenantId: TENANT, userId: DUENA },
    method: "get",
    url: "/admin/tag-visit-types",
  } as never;

  it("`ensureClinicaEnabled` sigue cortando a Mi Piace (clinica-7, decisión 24)", async () => {
    // Las historias, las valoraciones, las fotos, los consentimientos,
    // los informes y la sesión van por ésta, y tiene que seguir
    // cortando: el día que alguien cambie una de ellas por la otra, este
    // test es el que lo dice.
    const { enviado, respuesta } = respuestaFalsa();
    await ensureClinicaEnabled(deMiPiace, respuesta);
    expect(enviado).toHaveLength(1);
    expect(enviado[0]).toMatchObject({ statusCode: 404, error: "Not Found" });
  });

  it("`ensureClinicaConfigurable` no", async () => {
    const { enviado, respuesta } = respuestaFalsa();
    await ensureClinicaConfigurable(deMiPiace, respuesta);
    expect(enviado).toEqual([]);
  });

  it("pero la de configuración exige el módulo encendido igual que la otra", async () => {
    clinicaEncendida = false;
    const { enviado, respuesta } = respuestaFalsa();
    await ensureClinicaConfigurable(deMiPiace, respuesta);
    expect(enviado[0]).toMatchObject({ statusCode: 404, error: "Not Found" });
  });
});
