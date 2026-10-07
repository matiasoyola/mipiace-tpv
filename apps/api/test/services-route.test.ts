// Integration test del catálogo de servicios extendido (B-reservas-2).
// Prisma en memoria; valida el join servicios + scheduling, el upsert de
// scheduling (con coerción online↔onlineBookable), el CRUD de recursos,
// las necesidades de recurso y el aislamiento por tenant.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
// Sin esto, `loadEnv()` revienta con ZodError en CI (en local lo tapa
// el .env del entorno de desarrollo). Mismo patrón que contacts-route.
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface ProductRow {
  id: string;
  tenantId: string;
  holdedProductId: string;
  name: string;
  sku: string | null;
  basePrice: number;
  taxRate: number;
  kind: "PRODUCT" | "SERVICE";
  active: boolean;
  // clinica-5 · las categorías del producto. De ellas sale el tipo de
  // visita (S5), y por eso la ruta las pide ahora.
  tags: string[];
}

interface SchedulingRow {
  productId: string;
  tenantId: string;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  staffRequired: number;
  onlineBookable: boolean;
  family: string | null;
  channels: unknown;
  // clinica-5 · «este servicio ES el nivel N de la quiropodia».
  nivelQuiropodia: number | null;
  updatedAt: Date;
}

interface ResourceRow {
  id: string;
  tenantId: string;
  name: string;
  kind: "CABIN" | "ROOM" | "DEVICE";
}

interface NeedRow {
  serviceId: string;
  tenantId: string;
  resourceKind: "CABIN" | "ROOM" | "DEVICE";
  qty: number;
}

/** clinica-5 · ¿este centro tiene la historia clínica encendida? Sólo ahí
 *  valen las dos negativas de S5. Por defecto NO: los tests de
 *  B-reservas-2 son los de un centro normal. */
let centroClinico = false;

/** clinica-5 · el mapa `categoría → tipo de visita` del centro. */
let mapaDeTipos: Array<{ slug: string; visitType: string }> = [];

const productStore = new Map<string, ProductRow>();
const schedulingStore = new Map<string, SchedulingRow>();
const resourceStore: ResourceRow[] = [];
const needStore: NeedRow[] = [];

const fakePrisma = {
  // clinica-5 · las dos lecturas que la ruta hace ahora para resolver el
  // tipo de visita de un servicio (S5). En este test el tenant NO es
  // clínico y no hay ni un mapeo de categorías, así que las dos negativas
  // de S5 no se disparan y el catálogo de un centro normal se guarda
  // exactamente como antes — que es justo lo que estos tests guardan.
  tenant: {
    findUnique: vi.fn(async () => ({
      clinicalRecordsEnabled: centroClinico,
    })),
  },
  tagVisitType: {
    findMany: vi.fn(async () => mapaDeTipos),
  },
  product: {
    findFirst: vi.fn(async ({ where }: any) => {
      for (const p of productStore.values()) {
        if (where.id && p.id !== where.id) continue;
        if (where.tenantId && p.tenantId !== where.tenantId) continue;
        if (where.kind && p.kind !== where.kind) continue;
        return { id: p.id, tags: p.tags ?? [] };
      }
      return null;
    }),
    findMany: vi.fn(async ({ where }: any) => {
      let list = [...productStore.values()].filter(
        (p) => p.tenantId === where.tenantId && p.kind === where.kind,
      );
      const needle = where.OR?.[0]?.name?.contains;
      if (typeof needle === "string" && needle.length > 0) {
        const n = needle.toLowerCase();
        list = list.filter(
          (p) =>
            p.name.toLowerCase().includes(n) ||
            (p.sku ?? "").toLowerCase().includes(n),
        );
      }
      list.sort((a, b) => a.name.localeCompare(b.name));
      return list.map((p) => {
        const s = schedulingStore.get(p.id);
        return {
          id: p.id,
          holdedProductId: p.holdedProductId,
          name: p.name,
          sku: p.sku,
          basePrice: p.basePrice,
          taxRate: p.taxRate,
          active: p.active,
          tags: p.tags ?? [],
          scheduling: s
            ? {
                productId: s.productId,
                durationMin: s.durationMin,
                bufferBeforeMin: s.bufferBeforeMin,
                bufferAfterMin: s.bufferAfterMin,
                staffRequired: s.staffRequired,
                onlineBookable: s.onlineBookable,
                family: s.family,
                channels: s.channels,
                nivelQuiropodia: s.nivelQuiropodia ?? null,
                updatedAt: s.updatedAt,
              }
            : null,
        };
      });
    }),
  },
  serviceScheduling: {
    upsert: vi.fn(async ({ where, create, update }: any) => {
      const existing = schedulingStore.get(where.productId);
      const row: SchedulingRow = existing
        ? { ...existing, ...update, updatedAt: new Date() }
        : { nivelQuiropodia: null, ...create, updatedAt: new Date() };
      schedulingStore.set(where.productId, row);
      return row;
    }),
  },
  serviceResourceNeed: {
    findMany: vi.fn(async ({ where }: any) => {
      let list = needStore.filter(
        (n) => n.serviceId === where.serviceId && n.tenantId === where.tenantId,
      );
      list.sort((a, b) => a.resourceKind.localeCompare(b.resourceKind));
      return list.map((n) => ({ resourceKind: n.resourceKind, qty: n.qty }));
    }),
    deleteMany: vi.fn(async ({ where }: any) => {
      for (let i = needStore.length - 1; i >= 0; i--) {
        if (
          needStore[i]!.serviceId === where.serviceId &&
          needStore[i]!.tenantId === where.tenantId
        ) {
          needStore.splice(i, 1);
        }
      }
      return { count: 0 };
    }),
    createMany: vi.fn(async ({ data }: any) => {
      for (const d of data) needStore.push(d);
      return { count: data.length };
    }),
  },
  resource: {
    findMany: vi.fn(async ({ where }: any) => {
      const list = resourceStore.filter((r) => r.tenantId === where.tenantId);
      list.sort(
        (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
      );
      return list.map((r) => ({ id: r.id, name: r.name, kind: r.kind }));
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      const r = resourceStore.find(
        (x) => x.id === where.id && x.tenantId === where.tenantId,
      );
      return r ? { id: r.id } : null;
    }),
    create: vi.fn(async ({ data }: any) => {
      const row: ResourceRow = {
        id: randomUUID(),
        tenantId: data.tenantId,
        name: data.name,
        kind: data.kind,
      };
      resourceStore.push(row);
      return { id: row.id, name: row.name, kind: row.kind };
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const r = resourceStore.find((x) => x.id === where.id)!;
      if (data.name !== undefined) r.name = data.name;
      if (data.kind !== undefined) r.kind = data.kind;
      return { id: r.id, name: r.name, kind: r.kind };
    }),
    delete: vi.fn(async ({ where }: any) => {
      const idx = resourceStore.findIndex((x) => x.id === where.id);
      if (idx >= 0) resourceStore.splice(idx, 1);
      return {};
    }),
  },
  $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));

const { registerServicesRoutes } = await import("../src/services/routes.js");
const { signAccessToken } = await import("../src/auth/tokens.js");

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const OTHER_TENANT = "00000000-0000-0000-0000-000000000002";
const USER_ID = "11111111-1111-1111-1111-111111111111";
const OWNER = signAccessToken({ sub: USER_ID, tid: TENANT_ID, role: "OWNER" });
const auth = { authorization: `Bearer ${OWNER}` };

function seedService(opts: Partial<ProductRow>): ProductRow {
  const id = opts.id ?? randomUUID();
  const row: ProductRow = {
    id,
    tenantId: opts.tenantId ?? TENANT_ID,
    holdedProductId: opts.holdedProductId ?? "H" + id.slice(0, 6),
    name: opts.name ?? "Servicio",
    sku: opts.sku ?? "SKU1",
    basePrice: opts.basePrice ?? 20,
    taxRate: opts.taxRate ?? 21,
    kind: opts.kind ?? "SERVICE",
    active: opts.active ?? true,
    tags: opts.tags ?? [],
  };
  productStore.set(id, row);
  return row;
}

async function buildApp() {
  const app = Fastify();
  await registerServicesRoutes(app);
  return app;
}

beforeEach(() => {
  productStore.clear();
  schedulingStore.clear();
  resourceStore.length = 0;
  needStore.length = 0;
  centroClinico = false;
  mapaDeTipos = [];
});

describe("GET /services/scheduling", () => {
  it("lista servicios con su scheduling (null si no tiene)", async () => {
    const s1 = seedService({ name: "Corte" });
    seedService({ name: "Tinte" });
    schedulingStore.set(s1.id, {
      productId: s1.id,
      tenantId: TENANT_ID,
      durationMin: 45,
      bufferBeforeMin: 0,
      bufferAfterMin: 10,
      staffRequired: 1,
      onlineBookable: true,
      family: "Peluquería",
      channels: { caja: true, ticket: true, agenda: true, online: true },
      updatedAt: new Date(),
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/services/scheduling",
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(2);
    const corte = body.items.find((i: any) => i.name === "Corte");
    const tinte = body.items.find((i: any) => i.name === "Tinte");
    expect(corte.scheduling.durationMin).toBe(45);
    expect(corte.scheduling.channels.online).toBe(true);
    expect(tinte.scheduling).toBeNull();
    await app.close();
  });

  it("no incluye productos (kind=PRODUCT) ni servicios de otro tenant", async () => {
    seedService({ name: "Producto", kind: "PRODUCT" });
    seedService({ name: "Ajeno", tenantId: OTHER_TENANT });
    seedService({ name: "Mío" });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/services/scheduling",
      headers: auth,
    });
    const names = res.json().items.map((i: any) => i.name);
    expect(names).toEqual(["Mío"]);
    await app.close();
  });

  it("rechaza sin auth → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/services/scheduling" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe("PUT /services/:productId/scheduling", () => {
  it("crea el overlay de agenda de un servicio → 200", async () => {
    const s = seedService({ name: "Facial" });
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/services/${s.id}/scheduling`,
      headers: auth,
      payload: { durationMin: 60, staffRequired: 2, family: "Faciales" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.scheduling.durationMin).toBe(60);
    expect(body.scheduling.staffRequired).toBe(2);
    expect(body.scheduling.onlineBookable).toBe(false);
    await app.close();
  });

  it("fuerza channels.online=false si onlineBookable es false", async () => {
    const s = seedService({ name: "Ritual" });
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/services/${s.id}/scheduling`,
      headers: auth,
      payload: {
        durationMin: 90,
        onlineBookable: false,
        channels: { caja: true, ticket: true, agenda: true, online: true },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().scheduling.channels.online).toBe(false);
    await app.close();
  });

  it("404 si el producto es de otro tenant o no es servicio", async () => {
    const other = seedService({ name: "Ajeno", tenantId: OTHER_TENANT });
    const product = seedService({ name: "Prod", kind: "PRODUCT" });
    const app = await buildApp();
    for (const id of [other.id, product.id]) {
      const res = await app.inject({
        method: "PUT",
        url: `/services/${id}/scheduling`,
        headers: auth,
        payload: { durationMin: 30 },
      });
      expect(res.statusCode).toBe(404);
    }
    await app.close();
  });

  it("rechaza durationMin fuera de rango (0) → 400", async () => {
    const s = seedService({ name: "X" });
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/services/${s.id}/scheduling`,
      headers: auth,
      payload: { durationMin: 0 },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("recursos CRUD", () => {
  it("crea, lista, edita y borra un recurso", async () => {
    const app = await buildApp();
    const create = await app.inject({
      method: "POST",
      url: "/resources",
      headers: auth,
      payload: { name: "Cabina 1", kind: "CABIN" },
    });
    expect(create.statusCode).toBe(201);
    const id = create.json().resource.id;

    const list = await app.inject({
      method: "GET",
      url: "/resources",
      headers: auth,
    });
    expect(list.json().resources).toHaveLength(1);

    const patch = await app.inject({
      method: "PATCH",
      url: `/resources/${id}`,
      headers: auth,
      payload: { name: "Cabina VIP" },
    });
    expect(patch.json().resource.name).toBe("Cabina VIP");

    const del = await app.inject({
      method: "DELETE",
      url: `/resources/${id}`,
      headers: auth,
    });
    expect(del.statusCode).toBe(200);
    const after = await app.inject({
      method: "GET",
      url: "/resources",
      headers: auth,
    });
    expect(after.json().resources).toHaveLength(0);
    await app.close();
  });

  it("no ve recursos de otro tenant y 404 al editarlos", async () => {
    resourceStore.push({
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      tenantId: OTHER_TENANT,
      name: "Ajena",
      kind: "ROOM",
    });
    const app = await buildApp();
    const list = await app.inject({
      method: "GET",
      url: "/resources",
      headers: auth,
    });
    expect(list.json().resources).toHaveLength(0);
    const patch = await app.inject({
      method: "PATCH",
      url: `/resources/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`,
      headers: auth,
      payload: { name: "Hack" },
    });
    expect(patch.statusCode).toBe(404);
    await app.close();
  });
});

describe("necesidades de recurso", () => {
  it("reemplaza el set (PUT idempotente) y lo devuelve ordenado", async () => {
    const s = seedService({ name: "Depilación" });
    const app = await buildApp();
    const put1 = await app.inject({
      method: "PUT",
      url: `/services/${s.id}/resource-needs`,
      headers: auth,
      payload: {
        needs: [
          { resourceKind: "ROOM", qty: 1 },
          { resourceKind: "CABIN", qty: 2 },
        ],
      },
    });
    expect(put1.statusCode).toBe(200);
    expect(put1.json().needs.map((n: any) => n.resourceKind)).toEqual([
      "CABIN",
      "ROOM",
    ]);

    // Reemplazo: sólo DEVICE queda.
    const put2 = await app.inject({
      method: "PUT",
      url: `/services/${s.id}/resource-needs`,
      headers: auth,
      payload: { needs: [{ resourceKind: "DEVICE" }] },
    });
    expect(put2.json().needs).toEqual([{ resourceKind: "DEVICE", qty: 1 }]);

    const get = await app.inject({
      method: "GET",
      url: `/services/${s.id}/resource-needs`,
      headers: auth,
    });
    expect(get.json().needs).toEqual([{ resourceKind: "DEVICE", qty: 1 }]);
    await app.close();
  });

  it("404 al tocar needs de un servicio de otro tenant", async () => {
    const other = seedService({ name: "Ajeno", tenantId: OTHER_TENANT });
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/services/${other.id}/resource-needs`,
      headers: auth,
      payload: { needs: [] },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// clinica-5 · EL TIPO DE VISITA DEL SERVICIO (S5) y el nivel de quiropodia
// ═══════════════════════════════════════════════════════════════════════
//
// Las dos negativas de S5 se aplican aquí porque aquí nace la mezcla: es
// el único sitio desde el que la dueña puede marcar un servicio como
// tratamiento de sesión.
//
// Y los tests de arriba siguen pasando sin tocar nada, que es la mitad del
// punto: en un centro sin historia clínica (los catorce de hoy) ninguna de
// las dos reglas se dispara.

/** Pone el centro en modo clínico con el mapa de Rosario. */
function clinicaDeRosario() {
  centroClinico = true;
  mapaDeTipos = [
    { slug: "podologia", visitType: "QUIROPODIA" },
    { slug: "cirugia", visitType: "CIRUGIA" },
    { slug: "promocion", visitType: "" as never },
  ].filter((m) => m.visitType !== "");
}

const SCHEDULING_BASE = { durationMin: 30 };

async function guardar(
  productId: string,
  body: Record<string, unknown>,
): Promise<ReturnType<Awaited<ReturnType<typeof buildApp>>["inject"]>> {
  const app = await buildApp();
  return app.inject({
    method: "PUT",
    url: `/services/${productId}/scheduling`,
    headers: auth,
    payload: { ...SCHEDULING_BASE, ...body },
  });
}

describe("clinica-5 · el tipo de visita sale de la categoría", () => {
  it("el GET lo enseña, heredado y de sólo lectura", async () => {
    clinicaDeRosario();
    seedService({ name: "Quiropodia básica", tags: ["podologia"] });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/services/scheduling",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().items[0]).toMatchObject({
      tipoDeVisita: "QUIROPODIA",
      tipoDeVisitaMotivo: null,
    });
  });

  it("una etiqueta transversal no estorba", async () => {
    clinicaDeRosario();
    seedService({ name: "Quiropodia", tags: ["promocion", "podologia"] });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/services/scheduling",
      headers: auth,
    });
    expect(r.json().items[0].tipoDeVisita).toBe("QUIROPODIA");
  });

  it("DOS TIPOS DISTINTOS: el GET lo dice con su motivo…", async () => {
    clinicaDeRosario();
    seedService({ name: "Mezcla", tags: ["podologia", "cirugia"] });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/services/scheduling",
      headers: auth,
    });
    expect(r.json().items[0].tipoDeVisita).toBeNull();
    expect(r.json().items[0].tipoDeVisitaMotivo).toMatch(/quita una/i);
  });

  it("…y GUARDARLO SE RECHAZA, con el motivo que la dueña puede usar", async () => {
    clinicaDeRosario();
    const s = seedService({ name: "Mezcla", tags: ["podologia", "cirugia"] });
    const r = await guardar(s.id, { tratamientoSesion: true });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("DOS_TIPOS");
    expect(r.json().message).toContain("Quiropodia");
    expect(r.json().message).toContain("Cirugía");
    // Y no se guardó a medias.
    expect(schedulingStore.has(s.id)).toBe(false);
  });

  it("y se rechaza TAMBIÉN sin marcar «tratamiento de sesión»", async () => {
    // La regla es del servicio, no de la marca: dos categorías con tipos
    // distintos es un servicio que no se sabe de qué es.
    clinicaDeRosario();
    const s = seedService({ name: "Mezcla", tags: ["podologia", "cirugia"] });
    const r = await guardar(s.id, {});
    expect(r.statusCode).toBe(409);
  });

  it("SERVICIO DE SESIÓN SIN TIPO: tampoco se guarda", async () => {
    clinicaDeRosario();
    const s = seedService({ name: "Suelto", tags: ["promocion"] });
    const r = await guardar(s.id, { tratamientoSesion: true });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("SESION_SIN_TIPO");
    expect(r.json().message).toMatch(/categoría/i);
  });

  it("pero el mismo servicio SIN la marca se guarda sin problema", async () => {
    clinicaDeRosario();
    const s = seedService({ name: "Suelto", tags: ["promocion"] });
    const r = await guardar(s.id, {});
    expect(r.statusCode).toBe(200);
  });

  it("y en un centro SIN historia clínica, ninguna de las dos se dispara", async () => {
    // Los catorce tenants de hoy. `centroClinico` es false y el mapa está
    // vacío, así que un servicio marcado (que ahí no significa nada) se
    // guarda igual que antes de este bloque.
    const s = seedService({ name: "Corte de pelo", tags: ["cortes"] });
    const r = await guardar(s.id, { tratamientoSesion: true });
    expect(r.statusCode).toBe(200);
    expect(r.json().scheduling.tratamientoSesion).toBe(true);
  });
});

describe("clinica-5 · el nivel de quiropodia", () => {
  it("se guarda en un servicio de la categoría de quiropodia", async () => {
    clinicaDeRosario();
    const s = seedService({ name: "Quiropodia extra", tags: ["podologia"] });
    const r = await guardar(s.id, {
      tratamientoSesion: true,
      nivelQuiropodia: 3,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().scheduling.nivelQuiropodia).toBe(3);
  });

  it("en un servicio que NO es de quiropodia, se rechaza", async () => {
    // «Quiropodia extra» marcado sobre una cura sería una línea de ticket
    // que el nivel de la quiropodia elige y que no es una quiropodia.
    clinicaDeRosario();
    const s = seedService({ name: "Cura", tags: ["cirugia"] });
    const r = await guardar(s.id, {
      tratamientoSesion: true,
      nivelQuiropodia: 2,
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("NIVEL_SIN_QUIROPODIA");
  });

  it("un nivel que no es 1, 2 ni 3 no pasa el schema", async () => {
    clinicaDeRosario();
    const s = seedService({ name: "Quiropodia", tags: ["podologia"] });
    // `"2"` NO está en la lista: el ajv de Fastify coacciona tipos
    // (`coerceTypes`, la configuración de la casa) y una cadena numérica
    // entra como número. No es un agujero —el CHECK de la base sigue
    // siendo 1..3— pero conviene que esté dicho y no que alguien lo
    // descubra añadiéndolo aquí.
    for (const nivel of [0, 4, 2.5]) {
      const r = await guardar(s.id, {
        tratamientoSesion: true,
        nivelQuiropodia: nivel,
      });
      expect(r.statusCode, `nivel ${nivel}`).toBe(400);
    }
  });

  it("null lo quita, y ausente también: esta ruta es un upsert completo", async () => {
    clinicaDeRosario();
    const s = seedService({ name: "Quiropodia", tags: ["podologia"] });
    await guardar(s.id, { tratamientoSesion: true, nivelQuiropodia: 1 });
    expect(schedulingStore.get(s.id)!.nivelQuiropodia).toBe(1);
    await guardar(s.id, { tratamientoSesion: true, nivelQuiropodia: null });
    expect(schedulingStore.get(s.id)!.nivelQuiropodia).toBeNull();
    await guardar(s.id, { tratamientoSesion: true, nivelQuiropodia: 1 });
    await guardar(s.id, { tratamientoSesion: true });
    expect(schedulingStore.get(s.id)!.nivelQuiropodia).toBeNull();
  });
});
