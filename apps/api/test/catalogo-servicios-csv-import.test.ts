// catalogo-servicios-csv · la carga de SERVICIOS desde el fichero de alta.
//
// `catalogo-en-alta-import.test.ts` fija las cuatro promesas de la ruta
// con el fichero de un bar. Aquí se fijan las dos que añade este bloque,
// con el fichero de una clínica:
//
//   5. **La fila de agenda nace en la MISMA transacción que el producto.**
//      Sabotajes: quitar la creación de `ServiceScheduling` (los 17
//      servicios entran sin duración y la agenda no los ve), y reventar la
//      segunda escritura a mitad (no puede quedar un producto sin su
//      duración: en DRAFT no hay OWNER que lo arregle).
//   6. **Un exento sólo entra en un comercio con la clínica encendida.**
//      Sabotaje: quitar la puerta de `clinicalRecordsEnabled` — un `E1` en
//      el fichero de un bar entraría como producto exento callado.
//
// Y una tercera que es de la pantalla y se decide aquí: **la vista previa
// recibe el tipo, la duración y la etiqueta de la exención**. Es lo que la
// dueña revisa con el implantador delante, y si el servidor no lo manda la
// pantalla no puede inventárselo.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.SUPER_ADMIN_JWT_SECRET = "s".repeat(48);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import { readFileSync } from "node:fs";

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
  exemptionCause: string | null;
  kind: "PRODUCT" | "SERVICE";
  source: "HOLDED" | "LOCAL";
  tags: string[];
}

interface FakeScheduling {
  productId: string;
  tenantId: string;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  staffRequired: number;
  onlineBookable: boolean;
  family: string | null;
  channels: unknown;
}

const productos = new Map<string, FakeProduct>();
const agendas = new Map<string, FakeScheduling>();
const audits: Array<{ action: string; tenantId: string | null; metadata: any }> = [];
let tenant: {
  id: string;
  name: string;
  cajaEnabled: boolean;
  holdedEnabled: boolean;
  clinicalRecordsEnabled: boolean;
} | null = null;
// Para el sabotaje de «todo o nada» en la SEGUNDA escritura: el producto
// entra y la fila de agenda revienta.
let agendaRevienta = false;

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
          (where.sku?.in ? where.sku.in.includes(p.sku) : true) &&
          (where.source ? p.source === where.source : true),
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
      for (const d of data) {
        const id = randomUUID();
        productos.set(id, {
          id,
          tenantId: d.tenantId,
          sku: d.sku,
          name: d.name,
          basePrice: Number(d.basePrice),
          taxRate: Number(d.taxRate),
          exemptionCause: d.exemptionCause ?? null,
          kind: d.kind,
          source: d.source,
          tags: d.tags ?? [],
        });
      }
      return { count: data.length };
    }),
  },
  serviceScheduling: {
    createMany: vi.fn(async ({ data }: any) => {
      if (agendaRevienta) throw new Error("boom en la fila de agenda");
      for (const d of data) {
        agendas.set(d.productId, {
          productId: d.productId,
          tenantId: d.tenantId,
          durationMin: d.durationMin,
          bufferBeforeMin: d.bufferBeforeMin,
          bufferAfterMin: d.bufferAfterMin,
          staffRequired: d.staffRequired,
          onlineBookable: d.onlineBookable,
          family: d.family ?? null,
          channels: d.channels,
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
  // La transacción de verdad revierte, y la falsa tiene que revertir LAS
  // DOS tablas: si sólo restaurara los productos, el test de «no puede
  // quedar un producto sin su duración» pasaría sin probar nada.
  $transaction: vi.fn(async (fn: any) => {
    const snapProductos = new Map(productos);
    const snapAgendas = new Map(agendas);
    const snapAudits = [...audits];
    try {
      return await fn(fakePrisma);
    } catch (err) {
      productos.clear();
      for (const [k, v] of snapProductos) productos.set(k, v);
      agendas.clear();
      for (const [k, v] of snapAgendas) agendas.set(k, v);
      audits.length = 0;
      audits.push(...snapAudits);
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
const { SCHEDULING_DEFAULTS } = await import("../src/services/scheduling-rules.js");

function sa(): string {
  return jwt.sign(
    { sub: SUPER_ADMIN_ID, purpose: "super-admin", tv: 0, type: "access" },
    process.env.SUPER_ADMIN_JWT_SECRET!,
    { expiresIn: "1h" },
  );
}

// El catálogo REAL de la clínica de Rosario, leído del fichero que el
// implantador va a subir.
const CSV_ROSARIO = readFileSync(
  new URL("../../../docs/implantaciones/rosario/catalogo-tpv.csv", import.meta.url),
  "utf8",
);

const CABECERA = "sku,nombre,precio_con_iva,iva,categoria,tipo,exencion,duracion_min";
const csv = (...filas: string[]): string => [CABECERA, ...filas].join("\n");

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
  vi.clearAllMocks();
  productos.clear();
  agendas.clear();
  audits.length = 0;
  agendaRevienta = false;
  tenant = {
    id: TENANT_ID,
    name: "Clínica de podología de Rosario",
    cajaEnabled: true,
    holdedEnabled: false,
    // El comercio de este bloque: una clínica, con la historia clínica
    // encendida. Es la capability que ampara la exención.
    clinicalRecordsEnabled: true,
  };
  app = Fastify();
  registerErrorHandler(app);
  await registerSuperAdminTenantCatalogRoutes(app);
  await app.ready();
});

describe("catalogo-servicios-csv · el catálogo de Rosario, cargado", () => {
  it("los 17 servicios entran con su producto Y su fila de agenda", async () => {
    const r = await post({ csv: CSV_ROSARIO, confirmar: true });
    expect(r.statusCode).toBe(200);
    expect(productos.size).toBe(17);
    // LA promesa de este bloque: ni un servicio sin duración.
    expect(agendas.size).toBe(17);
    for (const p of productos.values()) {
      expect(p.kind).toBe("SERVICE");
      expect(agendas.has(p.id)).toBe(true);
    }
  });

  it("y cada uno nace exento, no sujeto al 0 %", async () => {
    await post({ csv: CSV_ROSARIO, confirmar: true });
    for (const p of productos.values()) {
      expect(p.exemptionCause).toBe("E1");
      expect(p.taxRate).toBe(0);
    }
  });

  it("la quiropodia básica son 30 minutos y 25 € que la paciente paga enteros", async () => {
    await post({ csv: CSV_ROSARIO, confirmar: true });
    const q = [...productos.values()].find((p) => p.sku === "POD-002")!;
    // Decisión 6: con `iva = 0` el bruto y el neto son el mismo número.
    expect(q.basePrice).toBe(25);
    expect(agendas.get(q.id)!.durationMin).toBe(30);
  });

  it("la familia de agenda es la PRIMERA categoría de la fila", async () => {
    await post({ csv: CSV_ROSARIO, confirmar: true });
    const q = [...productos.values()].find((p) => p.sku === "POD-002")!;
    expect(agendas.get(q.id)!.family).toBe("quiropodia");
    const cirugia = [...productos.values()].find((p) => p.sku === "POD-015")!;
    expect(agendas.get(cirugia.id)!.family).toBe("cirugía");
  });

  it("los defaults de la agenda son los del PUT del panel, no otros", async () => {
    await post({ csv: CSV_ROSARIO, confirmar: true });
    const q = [...productos.values()].find((p) => p.sku === "POD-002")!;
    const a = agendas.get(q.id)!;
    expect(a.bufferBeforeMin).toBe(SCHEDULING_DEFAULTS.bufferBeforeMin);
    expect(a.bufferAfterMin).toBe(SCHEDULING_DEFAULTS.bufferAfterMin);
    expect(a.staffRequired).toBe(SCHEDULING_DEFAULTS.staffRequired);
    expect(a.onlineBookable).toBe(SCHEDULING_DEFAULTS.onlineBookable);
    // Y `online` apagado: la coherencia que el PUT aplica a mano.
    expect(a.channels).toMatchObject({ caja: true, ticket: true, agenda: true, online: false });
  });

  it("la auditoría dice cuántos servicios, no cuáles", async () => {
    await post({ csv: CSV_ROSARIO, confirmar: true });
    expect(audits[0]).toMatchObject({
      action: "catalog_import",
      metadata: { filasCreadas: 17, filasSaltadas: 0, serviciosCreados: 17 },
    });
    const json = JSON.stringify(audits[0]!.metadata);
    expect(json).not.toContain("Quiropodia");
    expect(json).not.toContain("POD-002");
  });
});

describe("catalogo-servicios-csv · todo o nada, con DOS escrituras", () => {
  it("si la fila de agenda revienta, no queda ni el producto", async () => {
    // El sabotaje importante del bloque: sin la transacción compartida
    // quedarían 17 servicios sin duración en un comercio en DRAFT, donde
    // no hay OWNER que pueda abrir el panel y ponérsela.
    agendaRevienta = true;
    const r = await post({ csv: CSV_ROSARIO, confirmar: true });
    expect(r.statusCode).toBe(500);
    expect(productos.size).toBe(0);
    expect(agendas.size).toBe(0);
    expect(audits).toEqual([]);
  });

  it("la agenda se escribe DENTRO de la misma transacción que el producto", async () => {
    await post({ csv: CSV_ROSARIO, confirmar: true });
    expect(fakePrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(fakePrisma.product.createMany).toHaveBeenCalledTimes(1);
    expect(fakePrisma.serviceScheduling.createMany).toHaveBeenCalledTimes(1);
  });

  it("la vista previa no escribe ninguna de las dos tablas", async () => {
    const r = await post({ csv: CSV_ROSARIO });
    expect(r.statusCode).toBe(200);
    expect(r.json().escrito).toBe(false);
    expect(productos.size).toBe(0);
    expect(agendas.size).toBe(0);
    expect(fakePrisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("catalogo-servicios-csv · exento SÓLO con la clínica encendida", () => {
  beforeEach(() => {
    tenant!.clinicalRecordsEnabled = false;
    tenant!.name = "Bar La Maestranza SL";
  });

  it("un E1 en el fichero de un bar se SALTA, con su motivo", async () => {
    const r = await post({
      csv: csv("POD-002,Quiropodia,25.00,0,quiropodia,SERVICE,E1,30"),
    });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.entran).toEqual([]);
    expect(b.saltadas).toHaveLength(1);
    expect(b.saltadas[0].motivo).toContain("no tiene la clínica encendida");
    expect(b.saltadas[0].linea).toBe(2);
  });

  it("y al confirmar NO entra como producto exento callado", async () => {
    const r = await post({
      csv: csv("POD-002,Quiropodia,25.00,0,quiropodia,SERVICE,E1,30"),
      confirmar: true,
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("NADA_QUE_CARGAR");
    expect(productos.size).toBe(0);
  });

  it("las filas SUJETAS del mismo fichero entran igual", async () => {
    // Lo que se salta es la exención, no el fichero: un bar que mezcle una
    // línea mal puesta sigue cargando su carta.
    const r = await post({
      csv: csv(
        "CAF-001,Café con leche,1.60,10,cafés,,,",
        "POD-002,Quiropodia,25.00,0,quiropodia,SERVICE,E1,30",
      ),
      confirmar: true,
    });
    expect(r.statusCode).toBe(200);
    expect(productos.size).toBe(1);
    expect([...productos.values()][0]!.sku).toBe("CAF-001");
    expect(agendas.size).toBe(0);
  });

  it("un SERVICIO sujeto sí entra en un comercio sin clínica: lo que se gatea es la exención", async () => {
    // Una peluquería no es una clínica y vende servicios con IVA. La
    // puerta es de la EXENCIÓN, no del tipo de producto.
    const r = await post({
      csv: csv("COR-001,Corte de pelo,15.00,21,peluquería,SERVICE,,30"),
      confirmar: true,
    });
    expect(r.statusCode).toBe(200);
    expect(productos.size).toBe(1);
    expect(agendas.size).toBe(1);
    expect([...productos.values()][0]!.kind).toBe("SERVICE");
  });
});

describe("catalogo-servicios-csv · lo que la vista previa enseña", () => {
  it("el tipo, la duración y la etiqueta de la exención, fila por fila", async () => {
    const b = (
      await post({
        csv: csv(
          "POD-002,Quiropodia básica,25.00,0,quiropodia,SERVICE,E1,30",
          "CRE-001,Crema urea 20%,12.00,21,mostrador,PRODUCT,,",
        ),
      })
    ).json();
    expect(b.entran[0]).toMatchObject({
      sku: "POD-002",
      tipo: "SERVICE",
      duracionMin: 30,
      exencion: "E1",
      // La frase la redacta el servidor, con la MISMA función que pinta el
      // chip del catálogo y la leyenda del ticket.
      exencionEtiqueta: "Exento · sanitario",
    });
    expect(b.entran[1]).toMatchObject({
      sku: "CRE-001",
      tipo: "PRODUCT",
      duracionMin: null,
      exencion: null,
      exencionEtiqueta: null,
    });
  });

  it("también en el fichero de un bar: las cuatro claves viajan siempre", async () => {
    // Un campo que aparece y desaparece obliga a la pantalla a distinguir
    // «no» de «no me lo han dicho».
    const b = (await post({ csv: "sku,nombre,precio_con_iva,iva,categoria\nCAF-001,Café,1.60,10,cafés" })).json();
    expect(b.entran[0]).toMatchObject({
      tipo: "PRODUCT",
      duracionMin: null,
      exencion: null,
      exencionEtiqueta: null,
    });
  });

  it("los 17 de Rosario salen con su duración antes de escribir nada", async () => {
    const b = (await post({ csv: CSV_ROSARIO })).json();
    expect(b.entran).toHaveLength(17);
    expect(b.entran.every((e: any) => e.tipo === "SERVICE")).toBe(true);
    expect(b.entran.every((e: any) => typeof e.duracionMin === "number")).toBe(true);
    expect(b.entran.every((e: any) => e.exencionEtiqueta === "Exento · sanitario")).toBe(true);
    expect(productos.size).toBe(0);
  });
});

describe("catalogo-servicios-csv · las promesas de siempre siguen", () => {
  it("un SKU que ya existe no se pisa, y tampoco se le crea una agenda nueva", async () => {
    productos.set("ya", {
      id: "ya",
      tenantId: TENANT_ID,
      sku: "POD-002",
      name: "Quiropodia básica (la de antes)",
      basePrice: 23,
      taxRate: 0,
      exemptionCause: "E1",
      kind: "SERVICE",
      source: "LOCAL",
      tags: ["quiropodia"],
    });
    const r = await post({ csv: CSV_ROSARIO, confirmar: true });
    expect(r.statusCode).toBe(200);
    expect(productos.get("ya")!.basePrice).toBe(23);
    // 17 - 1 que se salta.
    expect(productos.size).toBe(17);
    expect(agendas.size).toBe(16);
    expect(agendas.has("ya")).toBe(false);
  });

  it("un fichero de SÓLO productos no abre la segunda escritura", async () => {
    await post({
      csv: csv("CAF-001,Café,1.60,10,cafés,,,", "CAF-002,Café solo,1.60,10,cafés,,,"),
      confirmar: true,
    });
    expect(productos.size).toBe(2);
    expect(fakePrisma.serviceScheduling.createMany).not.toHaveBeenCalled();
    expect(audits[0]!.metadata.serviciosCreados).toBe(0);
  });

  it("un tenant CON Holded recibe 409 también con un fichero de servicios", async () => {
    tenant!.holdedEnabled = true;
    const r = await post({ csv: CSV_ROSARIO, confirmar: true });
    expect(r.statusCode).toBe(409);
    expect(productos.size).toBe(0);
    expect(agendas.size).toBe(0);
  });
});
