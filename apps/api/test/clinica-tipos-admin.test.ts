// clinica-5 · las rutas del mapa `categoría → tipo de visita`.
//
// Tres cosas que guardar, y la tercera es la que no se puede olvidar:
//
//   1. El CRUD es idempotente por slug y normaliza como la sesión lee.
//   2. El aislamiento por tenant va en la consulta, no en un `if` previo.
//   3. **Con la historia clínica apagada, estas rutas NO EXISTEN** — 404
//      carácter por carácter igual que la de una ruta inexistente
//      (clinica-1 §1). Un 403 «no tienes el módulo de historia clínica» le
//      diría a un bar que alguien guarda datos de salud en este sistema.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "00000000-0000-0000-0000-0000000000a1";
const OTRO_TENANT = "00000000-0000-0000-0000-0000000000a2";
const USER_ID = "11111111-1111-1111-1111-1111111111a1";

interface Fila {
  id: string;
  tenantId: string;
  slug: string;
  visitType: string;
}

let filas: Fila[] = [];
let clinicaEncendida = true;

const fakePrisma: any = {
  tenant: {
    findUnique: vi.fn(async () => ({
      clinicalRecordsEnabled: clinicaEncendida,
    })),
  },
  tagVisitType: {
    findMany: vi.fn(async ({ where }: any) =>
      filas
        .filter((f) => f.tenantId === where.tenantId)
        .slice()
        .sort(
          (a, b) =>
            a.visitType.localeCompare(b.visitType) ||
            a.slug.localeCompare(b.slug),
        )
        .map((f) => ({ id: f.id, slug: f.slug, visitType: f.visitType })),
    ),
    upsert: vi.fn(async ({ where, create, update }: any) => {
      const { tenantId, slug } = where.tenantId_slug;
      const existe = filas.find(
        (f) => f.tenantId === tenantId && f.slug === slug,
      );
      if (existe) {
        existe.visitType = update.visitType;
        return { id: existe.id, slug: existe.slug, visitType: existe.visitType };
      }
      const nueva: Fila = { id: randomUUID(), ...create };
      filas.push(nueva);
      return { id: nueva.id, slug: nueva.slug, visitType: nueva.visitType };
    }),
    deleteMany: vi.fn(async ({ where }: any) => {
      const antes = filas.length;
      filas = filas.filter(
        (f) => !(f.id === where.id && f.tenantId === where.tenantId),
      );
      return { count: antes - filas.length };
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

const { registerAdminTagVisitTypesRoutes } = await import(
  "../src/admin/tag-visit-types.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");

const comoDuena = {
  authorization: `Bearer ${signAccessToken({
    sub: USER_ID,
    tid: TENANT_ID,
    role: "OWNER",
  })}`,
};
const comoCajera = {
  authorization: `Bearer ${signAccessToken({
    sub: USER_ID,
    tid: TENANT_ID,
    role: "CASHIER",
  })}`,
};

async function buildApp() {
  const app = Fastify({ logger: false });
  await registerAdminTagVisitTypesRoutes(app);
  await app.ready();
  return app;
}

beforeEach(() => {
  filas = [];
  clinicaEncendida = true;
});

describe("clinica-5 · asignar un tipo de visita a una categoría", () => {
  it("lo guarda y lo devuelve", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/admin/tag-visit-types",
      headers: comoDuena,
      payload: { slug: "podologia", visitType: "QUIROPODIA" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().tagVisitType).toMatchObject({
      slug: "podologia",
      visitType: "QUIROPODIA",
    });
  });

  it("NORMALIZA el slug como la sesión lo lee", async () => {
    // Si el guardado normalizara de otra manera que la lectura,
    // «Podologia» se guardaría y nunca casaría con el tag del producto —
    // y la dueña vería su categoría configurada y sus servicios sin tipo.
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/admin/tag-visit-types",
      headers: comoDuena,
      payload: { slug: "  PODOLOGIA  ", visitType: "QUIROPODIA" },
    });
    expect(r.json().tagVisitType.slug).toBe("podologia");
  });

  it("es idempotente por slug: volver a mandarlo CAMBIA el tipo, no añade", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/admin/tag-visit-types",
      headers: comoDuena,
      payload: { slug: "podologia", visitType: "QUIROPODIA" },
    });
    await app.inject({
      method: "POST",
      url: "/admin/tag-visit-types",
      headers: comoDuena,
      payload: { slug: "podologia", visitType: "CIRUGIA" },
    });
    expect(filas).toHaveLength(1);
    expect(filas[0]!.visitType).toBe("CIRUGIA");
  });

  it("un tipo inventado no pasa el schema", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/admin/tag-visit-types",
      headers: comoDuena,
      payload: { slug: "podologia", visitType: "ORTOPEDIA" },
    });
    expect(r.statusCode).toBe(400);
    expect(filas).toEqual([]);
  });

  it("un slug vacío tampoco", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/admin/tag-visit-types",
      headers: comoDuena,
      payload: { slug: "   ", visitType: "QUIROPODIA" },
    });
    expect(r.statusCode).toBe(400);
  });
});

describe("clinica-5 · listar y quitar", () => {
  beforeEach(() => {
    filas = [
      { id: randomUUID(), tenantId: TENANT_ID, slug: "podologia", visitType: "QUIROPODIA" },
      { id: randomUUID(), tenantId: TENANT_ID, slug: "cirugia", visitType: "CIRUGIA" },
      { id: randomUUID(), tenantId: OTRO_TENANT, slug: "fisio", visitType: "GENERAL" },
    ];
  });

  it("lista SÓLO las del tenant", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/admin/tag-visit-types",
      headers: comoDuena,
    });
    expect(r.json().items.map((i: any) => i.slug)).toEqual([
      "cirugia",
      "podologia",
    ]);
  });

  it("quita una por id", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "DELETE",
      url: `/admin/tag-visit-types/${filas[0]!.id}`,
      headers: comoDuena,
    });
    expect(r.statusCode).toBe(200);
    expect(filas.map((f) => f.slug)).toEqual(["cirugia", "fisio"]);
  });

  it("y NO puede quitar la de otro tenant: el aislamiento va en la consulta", async () => {
    const deOtro = filas[2]!.id;
    const app = await buildApp();
    const r = await app.inject({
      method: "DELETE",
      url: `/admin/tag-visit-types/${deOtro}`,
      headers: comoDuena,
    });
    expect(r.statusCode).toBe(404);
    expect(filas.some((f) => f.id === deOtro)).toBe(true);
  });
});

describe("clinica-5 · quién entra", () => {
  it("una cajera no configura el catálogo clínico", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/admin/tag-visit-types",
      headers: comoCajera,
    });
    expect(r.statusCode).toBe(403);
  });

  it("sin token, 401", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/admin/tag-visit-types",
    });
    expect(r.statusCode).toBe(401);
  });
});

describe("clinica-5 · con la historia clínica apagada, las rutas no existen", () => {
  const RUTAS = [
    ["GET", "/admin/tag-visit-types", undefined],
    [
      "POST",
      "/admin/tag-visit-types",
      { slug: "podologia", visitType: "QUIROPODIA" },
    ],
    ["DELETE", `/admin/tag-visit-types/${randomUUID()}`, undefined],
  ] as const;

  it.each(RUTAS)("%s %s → 404 indistinguible de una ruta inexistente", async (
    method,
    url,
    payload,
  ) => {
    clinicaEncendida = false;
    const app = await buildApp();
    const r = await app.inject({ method, url, headers: comoDuena, payload });
    expect(r.statusCode).toBe(404);
    // La 404 de Fastify, CARÁCTER POR CARÁCTER. Si este cuerpo se separa
    // del de una ruta inexistente, el módulo deja de estar escondido:
    // basta comparar dos respuestas para saber que existe.
    // La comparación se hace contra una ruta que de verdad NO EXISTE, y
    // no contra esta misma con un sufijo: con un sufijo, el `format: uuid`
    // del parámetro contesta 400 antes de llegar a ningún sitio y la
    // comparación no probaría nada.
    const inexistente = await app.inject({
      method,
      url: "/admin/ruta-que-no-existe",
      headers: comoDuena,
      payload,
    });
    expect(r.json()).toEqual({
      message: `Route ${method}:${url} not found`,
      error: "Not Found",
      statusCode: 404,
    });
    expect(inexistente.statusCode).toBe(404);
    expect(Object.keys(r.json()).sort()).toEqual(
      Object.keys(inexistente.json()).sort(),
    );
    expect(filas).toEqual([]);
  });
});
