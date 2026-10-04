// catalogo-en-alta · la carga del catálogo desde el super-admin.
//
// Las cinco promesas de la ruta, cada una con su sabotaje (§ "Cómo se
// cierra" del prompt del bloque):
//
//   1. **La vista previa no escribe.** Sabotaje: mover la escritura por
//      encima del `if (!confirmar)`.
//   2. **Un SKU que ya existe no se pisa.** Sabotaje: cambiar el
//      `createMany` por un `upsert`, o quitar el filtro de SKUs
//      existentes.
//   3. **Todo o nada.** Sabotaje: sacar el `createMany` de la
//      transacción, o escribir la auditoría fuera.
//   4. **Un tenant con Holded recibe 409.** Sabotaje: quitar la puerta
//      de `holdedEnabled`.
//   5. **Una sola función de reglas.** Sabotaje: validar aquí a mano en
//      vez de llamar a `validateLocalProduct` — se ve en que el precio
//      deja de convertirse a neto y en que un SKU con espacios entra.
//
// La auditoría se comprueba por lo que NO lleva: el contenido del
// fichero son los precios del comercio y no van a una tabla de
// auditoría.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.SUPER_ADMIN_JWT_SECRET = "s".repeat(48);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify, { type FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SUPER_ADMIN_ID = "11111111-1111-1111-1111-111111111111";
const TENANT_ID = "22222222-2222-2222-2222-222222222222";

interface FakeProduct {
  id: string;
  tenantId: string;
  sku: string | null;
  name: string;
  basePrice: number;
  taxRate: number;
  source: "HOLDED" | "LOCAL";
  tags: string[];
  sellableViaTpv: boolean;
  needsSkuReview: boolean;
}

const productos = new Map<string, FakeProduct>();
const audits: Array<{ action: string; tenantId: string | null; metadata: any }> = [];
let tenant: {
  id: string;
  name: string;
  cajaEnabled: boolean;
  holdedEnabled: boolean;
} | null = null;
// Para el sabotaje 3: hace que el `createMany` reviente a mitad.
let createManyRevienta = false;

const fakePrisma: any = {
  tenant: {
    findUnique: vi.fn(async ({ where }: any) =>
      tenant && tenant.id === where.id ? tenant : null,
    ),
  },
  superAdminUser: {
    findUnique: vi.fn(async () => ({
      id: SUPER_ADMIN_ID,
      tokenVersion: 0,
      deletedAt: null,
      isRoot: true,
    })),
  },
  product: {
    findMany: vi.fn(async ({ where }: any) =>
      [...productos.values()].filter(
        (p) =>
          p.tenantId === where.tenantId &&
          (where.sku?.in ? where.sku.in.includes(p.sku) : true),
      ),
    ),
    count: vi.fn(async ({ where }: any) =>
      [...productos.values()].filter(
        (p) =>
          p.tenantId === where.tenantId &&
          (where.source ? p.source === where.source : true),
      ).length,
    ),
    createMany: vi.fn(async ({ data }: any) => {
      if (createManyRevienta) throw new Error("boom a mitad del createMany");
      for (const d of data) {
        const id = randomUUID();
        productos.set(id, {
          id,
          tenantId: d.tenantId,
          sku: d.sku,
          name: d.name,
          basePrice: Number(d.basePrice),
          taxRate: Number(d.taxRate),
          source: d.source,
          tags: d.tags ?? [],
          sellableViaTpv: d.sellableViaTpv,
          needsSkuReview: d.needsSkuReview,
        });
      }
      return { count: data.length };
    }),
  },
  superAdminAudit: {
    create: vi.fn(async ({ data }: any) => {
      audits.push({ action: data.action, tenantId: data.tenantId, metadata: data.metadata });
      return data;
    }),
  },
  // La transacción de verdad revierte. La falsa tiene que hacerlo
  // también, o el test de "todo o nada" pasaría sin probar nada:
  // guardamos los productos y la auditoría de antes y los restauramos si
  // el callback lanza.
  $transaction: vi.fn(async (fn: any) => {
    const snapshotProductos = new Map(productos);
    const snapshotAudits = [...audits];
    try {
      return await fn(fakePrisma);
    } catch (err) {
      productos.clear();
      for (const [k, v] of snapshotProductos) productos.set(k, v);
      audits.length = 0;
      audits.push(...snapshotAudits);
      throw err;
    }
  }),
};

vi.mock("../src/context.js", () => ({
  initContext: vi.fn(),
  getPrisma: () => fakePrisma,
  getRedis: () => ({}),
  closeContext: vi.fn(),
  shutdown: vi.fn(),
}));

const { registerSuperAdminTenantCatalogRoutes } = await import(
  "../src/superadmin/tenant-catalog.js"
);
const { registerErrorHandler } = await import("../src/lib/error-handler.js");

function sa(): string {
  return jwt.sign(
    { sub: SUPER_ADMIN_ID, purpose: "super-admin", tv: 0, type: "access" },
    process.env.SUPER_ADMIN_JWT_SECRET!,
    { expiresIn: "1h" },
  );
}

const CABECERA = "sku,nombre,precio_con_iva,iva,categoria";
const CARTA = [
  CABECERA,
  "CAF-001,Café con leche,1.60,10,cafés",
  "CAF-002,Café solo,1.60,10,cafés",
  "RAC-001,Patatas alioli,6.00,10,raciones",
].join("\n");

let app: FastifyInstance;

async function post(body: unknown, token = sa()) {
  return app.inject({
    method: "POST",
    url: `/super-admin/tenants/${TENANT_ID}/catalog/import`,
    headers: { authorization: `Bearer ${token}` },
    payload: body as Record<string, unknown>,
  });
}

beforeEach(async () => {
  // Las llamadas de los espías, no sus implementaciones: `clearAllMocks`
  // borra el historial y deja el `vi.fn(impl)` en pie. Sin esto, el test
  // que cuenta transacciones hereda las del test anterior.
  vi.clearAllMocks();
  productos.clear();
  audits.length = 0;
  createManyRevienta = false;
  tenant = {
    id: TENANT_ID,
    name: "Bar La Maestranza SL",
    cajaEnabled: true,
    // El comercio del bloque: no usa Holded y su catálogo nace en la BD.
    holdedEnabled: false,
  };
  app = Fastify();
  registerErrorHandler(app);
  await registerSuperAdminTenantCatalogRoutes(app);
  await app.ready();
});

describe("catalogo-en-alta · la vista previa", () => {
  it("no escribe nada", async () => {
    const r = await post({ csv: CARTA });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.escrito).toBe(false);
    expect(b.entran).toHaveLength(3);
    // LO QUE IMPORTA: ni un producto, ni una entrada de auditoría, ni una
    // transacción abierta.
    expect(productos.size).toBe(0);
    expect(audits).toEqual([]);
    expect(fakePrisma.$transaction).not.toHaveBeenCalled();
  });

  it("dice el precio de la carta Y el que se guarda", async () => {
    const b = (await post({ csv: CARTA })).json();
    expect(b.entran[0]).toMatchObject({
      linea: 2,
      sku: "CAF-001",
      precioConIva: 1.6,
      precioSinIva: 1.4545,
      iva: 10,
    });
  });

  it("separa las filas que no entran, con su línea y su motivo", async () => {
    const b = (
      await post({
        csv: [CABECERA, "CAF-001,Café,1.60,10,cafés", ",Sin SKU,2.00,10,x"].join("\n"),
      })
    ).json();
    expect(b.entran).toHaveLength(1);
    expect(b.saltadas).toHaveLength(1);
    expect(b.saltadas[0]).toMatchObject({ linea: 3, motivo: "El SKU es obligatorio." });
  });

  it("cancelar no deja rastro porque no hay rastro: el fichero no se guarda", async () => {
    await post({ csv: CARTA });
    // No hay tabla de importaciones a medias, ni fichero en disco, ni
    // nada que limpiar. Es la razón de que `confirmar` sea el default
    // negativo y no un `dryRun` opcional.
    expect(productos.size).toBe(0);
  });
});

describe("catalogo-en-alta · confirmar", () => {
  it("escribe las filas válidas y las guarda en NETO", async () => {
    const r = await post({ csv: CARTA, confirmar: true });
    expect(r.statusCode).toBe(200);
    expect(r.json().escrito).toBe(true);
    expect(productos.size).toBe(3);
    const cafe = [...productos.values()].find((p) => p.sku === "CAF-001")!;
    // 1,60 de la carta → 1,4545 guardado. Si esto fuera 1.6, el TPV
    // cobraría 1,76 (ver `catalogo-en-alta-precio.test.ts`).
    expect(cafe.basePrice).toBe(1.4545);
    expect(cafe.taxRate).toBe(10);
    expect(cafe.source).toBe("LOCAL");
    // Las dos banderas que hacen que el TPV lo venda y que no caiga en la
    // bandeja de revisión de SKU. Salen de `buildLocalProductCreateData`,
    // la misma que usa el alta de una ficha.
    expect(cafe.sellableViaTpv).toBe(true);
    expect(cafe.needsSkuReview).toBe(false);
    expect(cafe.tags).toEqual(["cafés"]);
  });

  it("escribe DENTRO de una transacción, auditoría incluida", async () => {
    await post({ csv: CARTA, confirmar: true });
    expect(fakePrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(audits).toHaveLength(1);
  });

  it("todo o nada: si la escritura revienta, no queda ni un producto ni la auditoría", async () => {
    createManyRevienta = true;
    const r = await post({ csv: CARTA, confirmar: true });
    expect(r.statusCode).toBe(500);
    expect(productos.size).toBe(0);
    // Y sobre todo: NO queda una auditoría diciendo que entraron 3
    // productos que no están.
    expect(audits).toEqual([]);
  });

  it("si la AUDITORÍA falla, tampoco queda el catálogo a medias", async () => {
    // El otro lado del "todo o nada", y el que de verdad distingue una
    // auditoría dentro de la transacción de una auditoría después: si se
    // escribiera fuera, los 128 productos se quedarían puestos y nadie
    // sabría quién los cargó ni cuándo.
    fakePrisma.superAdminAudit.create.mockRejectedValueOnce(
      new Error("la tabla de auditoría no contesta"),
    );
    const r = await post({ csv: CARTA, confirmar: true });
    expect(r.statusCode).toBe(500);
    expect(productos.size).toBe(0);
    expect(audits).toEqual([]);
  });

  it("la auditoría dice cuántas, no cuáles", async () => {
    await post({
      csv: [CABECERA, "CAF-001,Café,1.60,10,cafés", ",Sin SKU,2.00,10,x"].join("\n"),
      confirmar: true,
    });
    expect(audits[0]).toMatchObject({
      action: "catalog_import",
      tenantId: TENANT_ID,
      metadata: { filasCreadas: 1, filasSaltadas: 1 },
    });
    // Ni nombres, ni precios, ni el fichero.
    const json = JSON.stringify(audits[0]!.metadata);
    expect(json).not.toContain("Café");
    expect(json).not.toContain("1.6");
    expect(json).not.toContain("CAF-001");
  });

  it("si no entra ninguna fila, no se escribe y se dice por qué", async () => {
    const r = await post({
      csv: [CABECERA, ",Sin SKU,2.00,10,x"].join("\n"),
      confirmar: true,
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("NADA_QUE_CARGAR");
    expect(productos.size).toBe(0);
    expect(audits).toEqual([]);
  });
});

describe("catalogo-en-alta · un SKU que ya existe no se pisa", () => {
  beforeEach(() => {
    productos.set("ya", {
      id: "ya",
      tenantId: TENANT_ID,
      sku: "CAF-001",
      name: "Café con leche (el de antes)",
      basePrice: 1.3,
      taxRate: 10,
      source: "LOCAL",
      tags: [],
      sellableViaTpv: true,
      needsSkuReview: false,
    });
  });

  it("se salta y se informa en la vista previa", async () => {
    const b = (await post({ csv: CARTA })).json();
    expect(b.entran.map((e: any) => e.sku)).toEqual(["CAF-002", "RAC-001"]);
    const salta = b.saltadas.find((s: any) => s.sku === "CAF-001");
    expect(salta.motivo).toContain("No se pisa su precio");
  });

  it("al confirmar, el precio viejo sigue siendo el viejo", async () => {
    await post({ csv: CARTA, confirmar: true });
    expect(productos.get("ya")!.basePrice).toBe(1.3);
    expect(productos.get("ya")!.name).toBe("Café con leche (el de antes)");
    expect(productos.size).toBe(3);
  });

  it("cargar el mismo fichero DOS veces no duplica nada", async () => {
    productos.delete("ya");
    await post({ csv: CARTA, confirmar: true });
    expect(productos.size).toBe(3);
    const segunda = await post({ csv: CARTA, confirmar: true });
    // Ninguna fila puede entrar: todas existen ya.
    expect(segunda.statusCode).toBe(400);
    expect(segunda.json().error).toBe("NADA_QUE_CARGAR");
    expect(productos.size).toBe(3);
  });

  it("un SKU que viene de Holded se nombra como tal", async () => {
    productos.get("ya")!.source = "HOLDED";
    const b = (await post({ csv: CARTA })).json();
    const salta = b.saltadas.find((s: any) => s.sku === "CAF-001");
    expect(salta.motivo).toContain("de Holded");
  });
});

describe("catalogo-en-alta · las puertas", () => {
  it("un tenant CON Holded recibe 409 (ADR-017)", async () => {
    tenant!.holdedEnabled = true;
    const r = await post({ csv: CARTA, confirmar: true });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("LOCAL_CATALOG_DISABLED");
    expect(productos.size).toBe(0);
  });

  it("también en la vista previa: no se le enseña un catálogo que no puede cargar", async () => {
    tenant!.holdedEnabled = true;
    expect((await post({ csv: CARTA })).statusCode).toBe(409);
  });

  it("un tenant SIN caja recibe 409: no tiene TPV que vender", async () => {
    tenant!.cajaEnabled = false;
    const r = await post({ csv: CARTA });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("CAJA_DISABLED");
  });

  it("un tenant que no existe es 404", async () => {
    tenant = null;
    expect((await post({ csv: CARTA })).statusCode).toBe(404);
  });

  it("sin token de super-admin es 401", async () => {
    const r = await app.inject({
      method: "POST",
      url: `/super-admin/tenants/${TENANT_ID}/catalog/import`,
      payload: { csv: CARTA },
    });
    expect(r.statusCode).toBe(401);
  });

  it("un fichero que no es el catálogo es 400 con una frase, no 128 filas malas", async () => {
    const r = await post({ csv: "nombre,nif,email\nPepe,12345678Z,p@p.es" });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("CSV_INVALIDO");
  });

  it("un fichero con más de 2.000 filas se rechaza diciendo cuántas trae", async () => {
    const filas = Array.from(
      { length: 2001 },
      (_, i) => `SKU-${i},Producto ${i},1.00,10,x`,
    );
    const r = await post({ csv: [CABECERA, ...filas].join("\n") });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("CSV_DEMASIADO_GRANDE");
    // Dice el número. Un recorte en silencio a 2.000 sería peor que el
    // rechazo: el implantador creería que ha cargado el catálogo entero.
    expect(r.json().message).toContain("2001");
  });
});

describe("catalogo-en-alta · las reglas son LAS del alta local", () => {
  it("un SKU con espacios no entra, igual que en el formulario", async () => {
    const b = (await post({ csv: [CABECERA, "CAF 001,Café,1.60,10,cafés"].join("\n") })).json();
    expect(b.entran).toEqual([]);
    expect(b.saltadas[0].motivo).toContain("no puede llevar espacios");
  });

  it("las categorías se guardan en minúsculas y sin duplicados", async () => {
    await post({
      csv: [CABECERA, "R-1,Patatas,6.00,10,Raciones;raciones;RACIONES"].join("\n"),
      confirmar: true,
    });
    expect([...productos.values()][0]!.tags).toEqual(["raciones"]);
  });

  it("el IVA admite el IGIC canario, que no está en la lista de cuatro", async () => {
    await post({
      csv: [CABECERA, "C-1,Producto canario,10.70,7,x"].join("\n"),
      confirmar: true,
    });
    const p = [...productos.values()][0]!;
    expect(p.taxRate).toBe(7);
    expect(p.basePrice).toBe(10);
  });
});
