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
  // clinica-8 · las marcas de clínica, que son lo que hace que la sesión
  // pueda poner una línea en caja.
  primeraValoracion: boolean;
  tratamientoSesion: boolean;
  nivelQuiropodia: number | null;
}

const productos = new Map<string, FakeProduct>();
const agendas = new Map<string, FakeScheduling>();
const audits: Array<{ action: string; tenantId: string | null; metadata: any }> = [];
// clinica-8 · `tag_visit_types` del comercio, por slug de categoría.
const tiposDeVisita = new Map<string, { slug: string; visitType: string }>();
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
// Y el otro lado del mismo «todo o nada»: la auditoría, que se escribe
// DESPUÉS de las dos tablas. Es el sabotaje que distingue «dentro de la
// transacción» de «con el mismo cliente, pero fuera».
let auditRevienta = false;

interface Pendiente {
  productos: FakeProduct[];
  agendas: FakeScheduling[];
  audits: Array<{ action: string; tenantId: string | null; metadata: any }>;
  // clinica-8 · las filas de `tag_visit_types` que la carga escribe.
  tipos: Array<{ slug: string; visitType: string }>;
}

function nuevoProducto(d: any): FakeProduct {
  return {
    id: randomUUID(),
    tenantId: d.tenantId,
    sku: d.sku,
    name: d.name,
    basePrice: Number(d.basePrice),
    taxRate: Number(d.taxRate),
    exemptionCause: d.exemptionCause ?? null,
    kind: d.kind,
    source: d.source,
    tags: d.tags ?? [],
  };
}

function nuevaAgenda(d: any): FakeScheduling {
  return {
    productId: d.productId,
    tenantId: d.tenantId,
    durationMin: d.durationMin,
    bufferBeforeMin: d.bufferBeforeMin,
    bufferAfterMin: d.bufferAfterMin,
    staffRequired: d.staffRequired,
    onlineBookable: d.onlineBookable,
    family: d.family ?? null,
    channels: d.channels,
    // Los defaults de la columna cuando el fichero no trae las marcas.
    primeraValoracion: d.primeraValoracion ?? false,
    tratamientoSesion: d.tratamientoSesion ?? false,
    nivelQuiropodia: d.nivelQuiropodia ?? null,
  };
}

function filtraProductos(
  todos: FakeProduct[],
  where: any,
): FakeProduct[] {
  return todos.filter(
    (p) =>
      p.tenantId === where.tenantId &&
      (where.sku?.in ? where.sku.in.includes(p.sku) : true) &&
      (where.source ? p.source === where.source : true),
  );
}

// ── EL `tx` ES OTRO OBJETO QUE EL CLIENTE DE FUERA ───────────────────
//
// Y es la pieza que hace que el sabotaje importante de este bloque se
// pueda ver en rojo. Un fake que devuelva el MISMO cliente dentro de
// `$transaction` no puede distinguir `tx.serviceScheduling.createMany` de
// `prisma.serviceScheduling.createMany`: las dos escriben en el mismo
// mapa y las dos se deshacen con el mismo `snapshot`. Así que escribir la
// fila de agenda FUERA de la transacción pasaría en verde, que es
// exactamente el fallo que no puede pasar —un servicio sin duración en un
// comercio en DRAFT, donde no hay OWNER que pueda ponérsela—.
//
// Aquí el `tx` acumula en una zona aparte y sólo se aplica si el callback
// termina. Lo que se escriba con el cliente de fuera entra directo y
// SOBREVIVE a la vuelta atrás, igual que en Postgres.
function abrirTx(): { tx: any; aplicar: () => void } {
  const pendiente: Pendiente = {
    productos: [],
    agendas: [],
    audits: [],
    tipos: [],
  };
  const tx = {
    product: {
      // Ve lo que esta misma transacción acaba de crear, que es lo que
      // hace un `findMany` de verdad dentro de una transacción — y es de
      // donde la ruta saca los ids para las filas de agenda.
      findMany: async ({ where }: any) =>
        filtraProductos([...productos.values(), ...pendiente.productos], where),
      count: async ({ where }: any) =>
        filtraProductos([...productos.values(), ...pendiente.productos], where).length,
      createMany: async ({ data }: any) => {
        for (const d of data) pendiente.productos.push(nuevoProducto(d));
        return { count: data.length };
      },
    },
    serviceScheduling: {
      createMany: async ({ data }: any) => {
        if (agendaRevienta) throw new Error("boom en la fila de agenda");
        for (const d of data) pendiente.agendas.push(nuevaAgenda(d));
        return { count: data.length };
      },
    },
    // clinica-8 · el mapa `categoría → tipo de visita`, que se escribe en
    // la MISMA transacción y por la misma razón que la fila de agenda: un
    // servicio de sesión sin tipo no lo ofrece ninguna tarjeta, y en DRAFT
    // no hay OWNER que lo arregle.
    tagVisitType: {
      findUnique: async ({ where }: any) =>
        tiposDeVisita.get(where.tenantId_slug.slug) ?? null,
      create: async ({ data }: any) => {
        pendiente.tipos.push({ slug: data.slug, visitType: data.visitType });
        return data;
      },
    },
    superAdminAudit: {
      create: async ({ data }: any) => {
        if (auditRevienta) throw new Error("la tabla de auditoría no contesta");
        pendiente.audits.push({
          action: data.action,
          tenantId: data.tenantId,
          metadata: data.metadata,
        });
        return data;
      },
    },
  };
  return {
    tx,
    aplicar: () => {
      for (const p of pendiente.productos) productos.set(p.id, p);
      for (const a of pendiente.agendas) agendas.set(a.productId, a);
      for (const t of pendiente.tipos) tiposDeVisita.set(t.slug, t);
      audits.push(...pendiente.audits);
    },
  };
}

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
      filtraProductos([...productos.values()], where),
    ),
    count: vi.fn(async ({ where }: any) =>
      filtraProductos([...productos.values()], where).length,
    ),
    createMany: vi.fn(async ({ data }: any) => {
      for (const d of data) {
        const p = nuevoProducto(d);
        productos.set(p.id, p);
      }
      return { count: data.length };
    }),
  },
  serviceScheduling: {
    // Escribe DIRECTO, sin pasar por el `pendiente`: lo que se escriba con
    // este cliente sobrevive a la vuelta atrás de la transacción.
    createMany: vi.fn(async ({ data }: any) => {
      if (agendaRevienta) throw new Error("boom en la fila de agenda");
      for (const d of data) {
        const a = nuevaAgenda(d);
        agendas.set(a.productId, a);
      }
      return { count: data.length };
    }),
  },
  // clinica-8 · igual que `serviceScheduling`: escribe DIRECTO, sin pasar
  // por el `pendiente`, para que sacar esta escritura de la transacción se
  // vea en rojo.
  tagVisitType: {
    findUnique: vi.fn(
      async ({ where }: any) => tiposDeVisita.get(where.tenantId_slug.slug) ?? null,
    ),
    create: vi.fn(async ({ data }: any) => {
      tiposDeVisita.set(data.slug, { slug: data.slug, visitType: data.visitType });
      return data;
    }),
  },
  superAdminAudit: {
    create: vi.fn(async ({ data }: any) => {
      if (auditRevienta) throw new Error("la tabla de auditoría no contesta");
      audits.push({ action: data.action, tenantId: data.tenantId, metadata: data.metadata });
      return data;
    }),
  },
  $transaction: vi.fn(async (fn: any) => {
    const { tx, aplicar } = abrirTx();
    // Si el callback lanza, `aplicar` no se llama: nada de lo que el `tx`
    // acumuló llega a los mapas. No hay snapshot que restaurar porque no
    // se ha escrito nada todavía.
    const r = await fn(tx);
    aplicar();
    return r;
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
  tiposDeVisita.clear();
  audits.length = 0;
  agendaRevienta = false;
  auditRevienta = false;
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
    // Los números LITERALES, no `SCHEDULING_DEFAULTS`: comparar la
    // constante contra sí misma pasaría en verde con cualquier valor, y
    // entonces cambiar los defaults no se vería en ningún rojo. Lo que
    // ata estos cuatro al panel es el test de abajo.
    expect(a.bufferBeforeMin).toBe(0);
    expect(a.bufferAfterMin).toBe(0);
    expect(a.staffRequired).toBe(1);
    expect(a.onlineBookable).toBe(false);
    // Y `online` apagado: un servicio que no es reservable online no
    // puede tener el canal online encendido (contrato para B4/B6).
    expect(a.channels).toMatchObject({ caja: true, ticket: true, agenda: true, online: false });
  });

  it("y son LOS MISMOS que el PUT del panel aplica cuando no se los mandan", async () => {
    // La decisión 3 del bloque: la misma regla en las dos puertas. El PUT
    // de `services/routes.ts` ya no lleva sus propios literales —usa esta
    // misma constante—, así que si alguien los cambia, cambian a la vez en
    // el panel y en el fichero, y este test lo dice.
    expect(SCHEDULING_DEFAULTS).toEqual({
      bufferBeforeMin: 0,
      bufferAfterMin: 0,
      staffRequired: 1,
      onlineBookable: false,
      channels: { caja: true, ticket: true, agenda: true, online: false },
    });
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
    // Con el cliente de FUERA no se ha escrito nada: las dos escrituras
    // han ido por el `tx`. Si alguna hubiera usado `prisma` en vez de
    // `tx`, este espía la habría visto.
    expect(fakePrisma.product.createMany).not.toHaveBeenCalled();
    expect(fakePrisma.serviceScheduling.createMany).not.toHaveBeenCalled();
    expect(productos.size).toBe(17);
    expect(agendas.size).toBe(17);
  });

  it("si la AUDITORÍA falla, tampoco queda la fila de agenda", async () => {
    // El otro lado del «todo o nada», y el que distingue «dentro de la
    // transacción» de «con el mismo cliente, pero fuera»: la auditoría se
    // escribe DESPUÉS de las dos tablas, así que si la fila de agenda se
    // hubiera escrito fuera de la transacción, sobreviviría a esta vuelta
    // atrás y quedarían 17 duraciones sin su producto.
    auditRevienta = true;
    const r = await post({ csv: CSV_ROSARIO, confirmar: true });
    expect(r.statusCode).toBe(500);
    expect(productos.size).toBe(0);
    expect(agendas.size).toBe(0);
    expect(audits).toEqual([]);
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
    expect(agendas.size).toBe(0);
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

// ── clinica-8 · LAS MARCAS DE CLÍNICA, POR EL FICHERO ───────────────
//
// `catalogo-servicios-csv` las dejó fuera a propósito. La auditoría del
// 18-10 midió lo que eso significa: con los 17 servicios cargados y el TPV
// enseñándolos, la primera sesión cerró con «sin servicio» y 0,00 €. El
// catálogo estaba; la clínica no podía cobrar.
describe("clinica-8 · el fichero deja la clínica lista para cobrar", () => {
  it("los tres niveles de quiropodia quedan puestos, uno por servicio", async () => {
    await post({ csv: CSV_ROSARIO, confirmar: true });
    const nivelDe = (sku: string) => {
      const p = [...productos.values()].find((x) => x.sku === sku)!;
      return agendas.get(p.id)!.nivelQuiropodia;
    };
    expect(nivelDe("POD-002")).toBe(1);
    expect(nivelDe("POD-003")).toBe(2);
    expect(nivelDe("POD-004")).toBe(3);
  });

  it("la primera valoración queda marcada, y sólo ella", async () => {
    await post({ csv: CSV_ROSARIO, confirmar: true });
    const primeras = [...productos.values()]
      .filter((p) => agendas.get(p.id)!.primeraValoracion)
      .map((p) => p.sku);
    expect(primeras).toEqual(["POD-001"]);
  });

  // clinica-9 (2) · los 17, valoración incluida: con la «Consulta
  // diagnóstico» fuera de la sesión, la primera visita de cada paciente
  // nuevo cerraba a 0 € (pasada en hierro del 24-10).
  it("y los tratamientos de la sesión son los 17: la valoración también", async () => {
    await post({ csv: CSV_ROSARIO, confirmar: true });
    const marcados = [...productos.values()].filter(
      (p) => agendas.get(p.id)!.tratamientoSesion,
    );
    expect(marcados).toHaveLength(17);
    const consulta = [...productos.values()].find((p) => p.sku === "POD-001")!;
    expect(agendas.get(consulta.id)!.primeraValoracion).toBe(true);
    expect(agendas.get(consulta.id)!.tratamientoSesion).toBe(true);
  });

  it("las cinco categorías quedan con su tipo de visita", async () => {
    // Sin estas filas, ningún servicio tiene tipo y la sesión no ofrece
    // una sola tarjeta: es la regla de S5 funcionando sobre un catálogo
    // sin configurar.
    await post({ csv: CSV_ROSARIO, confirmar: true });
    expect(
      new Map([...tiposDeVisita.values()].map((t) => [t.slug, t.visitType])),
    ).toEqual(
      new Map([
        ["consulta", "GENERAL"],
        ["quiropodia", "QUIROPODIA"],
        ["cirugía", "CIRUGIA"],
        ["biomecánica", "BIOMECANICA"],
        ["órtesis", "GENERAL"],
      ]),
    );
  });

  it("los tipos de visita se escriben DENTRO de la transacción", async () => {
    // Misma promesa que la fila de agenda, y por lo mismo: un catálogo
    // configurado a medias en un comercio sin OWNER no lo arregla nadie.
    //
    // Y revienta la AUDITORÍA, no la fila de agenda. La primera versión de
    // este test usaba `agendaRevienta` y **salía verde con el sabotaje
    // puesto**: la agenda se escribe ANTES que los tipos, así que al
    // reventar ahí los tipos no llegaban a escribirse ni dentro ni fuera, y
    // el test no distinguía las dos cosas. La auditoría va DESPUÉS, así que
    // con ella se ve: escritos dentro, la vuelta atrás se los lleva;
    // escritos fuera, sobreviven.
    auditRevienta = true;
    const r = await post({ csv: CSV_ROSARIO, confirmar: true });
    expect(r.statusCode).toBe(500);
    expect(productos.size).toBe(0);
    expect(agendas.size).toBe(0);
    expect(tiposDeVisita.size).toBe(0);
  });

  it("la vista previa las ENSEÑA, y no escribe ninguna", async () => {
    const r = await post({ csv: CSV_ROSARIO });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.escrito).toBe(false);
    expect(body.tiposDeVisita).toHaveLength(5);
    const completa = body.entran.find((e: any) => e.sku === "POD-003");
    expect(completa.nivelQuiropodia).toBe(2);
    expect(completa.tratamientoSesion).toBe(true);
    expect(completa.tipoVisita).toBe("QUIROPODIA");
    // Y nada escrito: ni productos, ni agendas, ni tipos.
    expect(productos.size).toBe(0);
    expect(agendas.size).toBe(0);
    expect(tiposDeVisita.size).toBe(0);
  });

  it("en un comercio SIN historia clínica, las filas con marcas se SALTAN", async () => {
    // La misma puerta que la exención, y por lo mismo: la capability es
    // del comercio y el parser no habla con la base.
    //
    // SIN `E1` en el fichero, a propósito: con la exención puesta las
    // filas se saltarían por la puerta de `catalogo-servicios-csv` y este
    // test saldría verde con la puerta nueva quitada. Lo enseñó su
    // sabotaje. Las dos filas son IVA 21 y sujetas; lo único que un bar no
    // puede tener aquí son las marcas de clínica.
    tenant = { ...tenant!, clinicalRecordsEnabled: false };
    const csv =
      "sku,nombre,precio_con_iva,iva,categoria,tipo,exencion,duracion_min,tipo_visita,primera_valoracion,tratamiento_sesion,nivel_quiropodia\n" +
      "SVC-1,Quiropodia,25.00,21,quiropodia,SERVICE,,30,QUIROPODIA,no,si,1\n" +
      "SVC-2,Corte,18.00,21,peluqueria,SERVICE,,30,,,,";
    const r = await post({ csv, confirmar: true });
    expect(r.statusCode).toBe(200);
    // La de las marcas, fuera con su motivo; la normal, dentro.
    expect([...productos.values()].map((p) => p.sku)).toEqual(["SVC-2"]);
    expect(
      r.json().saltadas.find((x: any) => x.sku === "SVC-1").motivo,
    ).toContain("no tiene la historia clínica encendida");
    expect(tiposDeVisita.size).toBe(0);
  });

  it("un fichero SIN las columnas deja la fila de agenda como la dejaba ayer", async () => {
    // La Maestranza: `false`, `false` y `null`, que son los defaults de la
    // base. El sabotaje que esto caza es escribir marcas inventadas.
    const csv =
      "sku,nombre,precio_con_iva,iva,categoria,tipo,exencion,duracion_min\n" +
      "SVC-1,Corte,18.00,21,peluqueria,SERVICE,,30";
    await post({ csv, confirmar: true });
    const a = [...agendas.values()][0]!;
    expect(a.primeraValoracion).toBe(false);
    expect(a.tratamientoSesion).toBe(false);
    expect(a.nivelQuiropodia).toBeNull();
    expect(tiposDeVisita.size).toBe(0);
  });
});
