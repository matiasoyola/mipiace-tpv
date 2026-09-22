// catalogo-local · el catálogo propio contra Postgres DE VERDAD.
//
// POR QUÉ ESTE FICHERO EXISTE. Cuatro cosas de este bloque no las decide
// el código de la API, y las cuatro se despliegan el mismo día:
//
//   1. **El índice único PARCIAL del SKU local.** Prisma no sabe
//      declararlo, así que vive sólo en el SQL de la migración. Que
//      rechace dos locales con el mismo SKU y a la vez DEJE convivir dos
//      de Holded con el mismo SKU es una afirmación sobre Postgres.
//   2. **`holded_product_id` nullable bajo un índice único.** Que N
//      productos locales quepan bajo `(tenant_id, holded_product_id)`
//      depende de que Postgres trate cada NULL como distinto. Sólo
//      Postgres puede confirmarlo.
//   3. **El backfill por DEFAULT.** Que las fichas de Sole, Thalía,
//      Cachitos y La Maestranza sigan siendo HOLDED el día del
//      despliegue es una afirmación sobre `attmissingval`, no sobre
//      TypeScript.
//   4. **Cobrar un producto local de punta a punta.** Criterios 1 y 2 del
//      bloque: se vende, se cobra, y NO se intenta subir nada a Holded.

import { randomBytes, randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { E2E_DATABASE_URL, e2eEnabled, SKIP_MESSAGE } from "./e2e-env.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = E2E_DATABASE_URL || "postgresql://e2e:e2e@127.0.0.1:5432/e2e";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET = "e".repeat(40);
process.env.JWT_REFRESH_SECRET = "f".repeat(40);
process.env.SUPER_ADMIN_JWT_SECRET = "g".repeat(48);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

// Lo que importa es QUÉ se encola, no que BullMQ funcione. Se guarda.
const enqueuedTicketUploads: string[] = [];
vi.mock("../src/queues/ticket-upload.js", () => ({
  enqueueTicketUpload: async (externalId: string) => {
    enqueuedTicketUploads.push(externalId);
  },
}));
vi.mock("../src/queues/refund-upload.js", () => ({
  enqueueRefundUpload: async () => undefined,
}));
vi.mock("../src/queues/ticket-email.js", () => ({
  enqueueTicketEmail: async () => undefined,
}));

const { getPrisma, shutdown } = await import("../src/context.js");
const { registerTicketRoutes } = await import("../src/tickets/routes.js");
const { registerShiftRoutes } = await import("../src/shift/routes.js");
const { registerLocalCatalogRoutes } = await import("../src/catalog/local-products.js");
const { registerTpvCatalogRoutes } = await import("../src/tpv-catalog/routes.js");
const { registerErrorHandler } = await import("../src/lib/error-handler.js");
const { registerLenientJsonParser } = await import("../src/lib/lenient-json.js");
const { signCashierSession } = await import("../src/shift/cashier-session.js");
const { signAccessToken } = await import("../src/auth/tokens.js");
const { encryptSecret } = await import("../src/crypto.js");
const { computeOnboardingHealth } = await import(
  "../src/superadmin/onboarding-health.js"
);

describe.skipIf(!e2eEnabled)("e2e · el catálogo local contra Postgres real", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let app: FastifyInstance;

  // El comercio del bloque: CON caja y SIN Holded.
  let sinHolded = "";
  let ownerSinHolded = "";
  let registerSinHolded = "";
  let cashierSinHolded = "";
  // El comercio de hoy: con Holded. Sirve para el criterio 4.
  let conHolded = "";
  let ownerConHolded = "";

  const ownerAuth = (tenantId: string, userId: string) => ({
    authorization: `Bearer ${signAccessToken({ sub: userId, tid: tenantId, role: "OWNER" })}`,
  });

  let cashierToken = "";
  const cashierAuth = () => ({ authorization: `Bearer ${cashierToken}` });

  beforeAll(async () => {
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    registerLenientJsonParser(app);
    await registerLocalCatalogRoutes(app);
    await registerTpvCatalogRoutes(app);
    await registerShiftRoutes(app);
    await registerTicketRoutes(app);
    await app.ready();

    // ── el comercio sin Holded ──────────────────────────────────────
    const t1 = await prisma.tenant.create({
      data: {
        name: `Peluquería local ${randomUUID().slice(0, 8)}`,
        initialSyncStatus: "NOT_APPLICABLE",
        // catalogo-local (addendum 3) · lo que hace de éste el comercio
        // del bloque no es la ausencia de clave —eso lo comparte con el
        // que la conectará mañana— sino el interruptor apagado. Es lo
        // único que le abre el alta local y lo único que lo saca del
        // muro de /onboarding.
        holdedEnabled: false,
      },
      select: { id: true },
    });
    sinHolded = t1.id;
    const o1 = await prisma.user.create({
      data: { tenantId: sinHolded, email: `o1+${randomUUID()}@e2e.local`, role: "OWNER" },
      select: { id: true },
    });
    ownerSinHolded = o1.id;
    const s1 = await prisma.store.create({
      data: { tenantId: sinHolded, name: "Local" },
      select: { id: true },
    });
    const r1 = await prisma.register.create({
      data: { storeId: s1.id, name: "Caja 1" },
      select: { id: true },
    });
    registerSinHolded = r1.id;
    const c1 = await prisma.user.create({
      data: { tenantId: sinHolded, email: `c1+${randomUUID()}@e2e.local`, alias: "Ana", role: "CASHIER" },
      select: { id: true },
    });
    cashierSinHolded = c1.id;
    cashierToken = signCashierSession(
      {
        sub: cashierSinHolded,
        tid: sinHolded,
        did: randomUUID(),
        rid: registerSinHolded,
        role: "CASHIER",
      },
      720,
    );

    // ── el comercio con Holded ──────────────────────────────────────
    const t2 = await prisma.tenant.create({
      data: {
        name: `Peluquería Holded ${randomUUID().slice(0, 8)}`,
        initialSyncStatus: "DONE",
        // Previsto y conectado: el tenant de hoy, sin nada nuevo.
        holdedEnabled: true,
        holdedApiKeyCiphertext: encryptSecret("k", process.env.HOLDED_KEY_ENCRYPTION_SECRET!),
      },
      select: { id: true },
    });
    conHolded = t2.id;
    const o2 = await prisma.user.create({
      data: { tenantId: conHolded, email: `o2+${randomUUID()}@e2e.local`, role: "OWNER" },
      select: { id: true },
    });
    ownerConHolded = o2.id;
  });

  afterAll(async () => {
    await app?.close();
    await shutdown();
  });

  // ── 1 · la migración, sobre filas ──────────────────────────────────

  describe("la migración", () => {
    it("un producto insertado SIN nombrar source sale HOLDED: el backfill es el DEFAULT", async () => {
      // La prueba de que las fichas de Sole, Thalía, Cachitos y La
      // Maestranza no cambian de bando el día del despliegue. El INSERT
      // va por SQL y NO menciona la columna, igual que una fila escrita
      // antes de que existiera.
      const id = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO products
           (id, tenant_id, holded_product_id, name, base_price, tax_rate, last_synced_at)
         VALUES ($1::uuid, $2::uuid, $3, 'Champú legado', 10.0, 21.0, now())`,
        id,
        conHolded,
        `legacy-${id.slice(0, 8)}`,
      );
      const rows = await prisma.$queryRawUnsafe<Array<{ source: string }>>(
        `SELECT source FROM products WHERE id = $1::uuid`,
        id,
      );
      expect(rows[0]!.source).toBe("HOLDED");
    });

    it("holded_product_id admite NULL: el enlace deja de ser obligatorio", async () => {
      const id = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO products
           (id, tenant_id, holded_product_id, source, name, sku, base_price, tax_rate, last_synced_at)
         VALUES ($1::uuid, $2::uuid, NULL, 'LOCAL', 'Local suelto', $3, 10.0, 21.0, now())`,
        id,
        sinHolded,
        `E2E-NULL-${id.slice(0, 8)}`,
      );
      const p = await prisma.product.findUniqueOrThrow({ where: { id } });
      expect(p.holdedProductId).toBeNull();
      expect(p.source).toBe("LOCAL");
    });

    it("VARIOS locales conviven con holded_product_id NULL bajo el unique del sync", async () => {
      // En Postgres cada NULL es distinto de todos los demás dentro de un
      // índice único. Es lo que permite NO rediseñar
      // `(tenant_id, holded_product_id)`, que sigue siendo la clave del
      // sync. Si esto fallara, el bloque entero necesitaría otro esquema.
      for (let i = 0; i < 5; i += 1) {
        await prisma.product.create({
          data: {
            tenantId: sinHolded,
            source: "LOCAL",
            holdedProductId: null,
            name: `Convive ${i}`,
            sku: `E2E-CONV-${i}-${randomUUID().slice(0, 4)}`,
            basePrice: 1,
            taxRate: 21,
          },
        });
      }
      const n = await prisma.product.count({
        where: { tenantId: sinHolded, holdedProductId: null },
      });
      expect(n).toBeGreaterThanOrEqual(5);
    });

    it("el índice PARCIAL rechaza dos SKU locales iguales en el mismo tenant", async () => {
      const sku = `E2E-DUP-${randomUUID().slice(0, 8)}`;
      await prisma.product.create({
        data: { tenantId: sinHolded, source: "LOCAL", name: "Uno", sku, basePrice: 1, taxRate: 21 },
      });
      await expect(
        prisma.product.create({
          data: { tenantId: sinHolded, source: "LOCAL", name: "Dos", sku, basePrice: 1, taxRate: 21 },
        }),
      ).rejects.toThrow();
    });

    it("...y a la vez DEJA convivir dos SKU iguales de HOLDED", async () => {
      // Los SKU que llegan de Holded llegan como llegan. Un unique global
      // haría que el sync reventara al traer un catálogo con duplicados,
      // que es cosa del cliente en su ERP y no nuestra.
      const sku = `E2E-HDUP-${randomUUID().slice(0, 8)}`;
      await prisma.product.create({
        data: {
          tenantId: conHolded,
          source: "HOLDED",
          holdedProductId: randomUUID(),
          name: "Holded uno",
          sku,
          basePrice: 1,
          taxRate: 21,
        },
      });
      await expect(
        prisma.product.create({
          data: {
            tenantId: conHolded,
            source: "HOLDED",
            holdedProductId: randomUUID(),
            name: "Holded dos",
            sku,
            basePrice: 1,
            taxRate: 21,
          },
        }),
      ).resolves.toBeTruthy();
    });

    it("el mismo SKU local en OTRO tenant sí se puede: el índice es por tenant", async () => {
      const sku = `E2E-XT-${randomUUID().slice(0, 8)}`;
      await prisma.product.create({
        data: { tenantId: sinHolded, source: "LOCAL", name: "A", sku, basePrice: 1, taxRate: 21 },
      });
      await expect(
        prisma.product.create({
          data: { tenantId: conHolded, source: "LOCAL", name: "B", sku, basePrice: 1, taxRate: 21 },
        }),
      ).resolves.toBeTruthy();
    });
  });

  // ── 2 · criterio 1 — alta, TPV y cobro ─────────────────────────────

  describe("criterio 1 · un comercio sin Holded da de alta, ve en el TPV y cobra", () => {
    const creados: string[] = [];
    const skus = ["E2E-CORTE", "E2E-TINTE", "E2E-CHAMPU"];

    it("da de alta TRES productos con SKU desde el panel", async () => {
      for (const [i, sku] of skus.entries()) {
        const res = await app.inject({
          method: "POST",
          url: "/catalog/products",
          headers: ownerAuth(sinHolded, ownerSinHolded),
          payload: {
            name: ["Corte de pelo", "Tinte", "Champú"][i],
            sku,
            basePrice: [18.5, 42, 9.9][i],
            taxRate: 21,
            kind: i === 2 ? "PRODUCT" : "SERVICE",
          },
        });
        expect(res.statusCode).toBe(201);
        creados.push(res.json().product.id);
      }
      // Y están en la base como LOCAL sin enlace.
      const rows = await prisma.product.findMany({
        where: { id: { in: creados } },
        select: { source: true, holdedProductId: true, sku: true, sellableViaTpv: true },
      });
      expect(rows).toHaveLength(3);
      for (const r of rows) {
        expect(r.source).toBe("LOCAL");
        expect(r.holdedProductId).toBeNull();
        expect(r.sellableViaTpv).toBe(true);
      }
    });

    it("los TRES salen en el catálogo del TPV", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/tpv/catalog/products?limit=200",
        headers: cashierAuth(),
      });
      expect(res.statusCode).toBe(200);
      const devueltos = res.json().items.map((p: { sku: string }) => p.sku);
      for (const sku of skus) expect(devueltos).toContain(sku);
    });

    it("cobra un ticket con ellos", async () => {
      const open = await app.inject({
        method: "POST",
        url: "/shift/open",
        headers: cashierAuth(),
        payload: { cashOpening: 0 },
      });
      expect(open.statusCode).toBe(201);
      const shiftId = open.json().shift.id as string;

      enqueuedTicketUploads.length = 0;
      const externalId = randomUUID();
      const res = await app.inject({
        method: "POST",
        url: "/tickets",
        headers: cashierAuth(),
        payload: {
          externalId,
          registerId: registerSinHolded,
          shiftId,
          lines: [
            {
              productId: creados[0],
              nameSnapshot: "Corte de pelo",
              sku: "E2E-CORTE",
              units: 1,
              unitPrice: 18.5,
              discountPct: 0,
              taxRate: 21,
            },
            {
              productId: creados[2],
              nameSnapshot: "Champú",
              sku: "E2E-CHAMPU",
              units: 1,
              unitPrice: 9.9,
              discountPct: 0,
              taxRate: 21,
            },
          ],
          // 18,50 + 9,90 = 28,40 netos; +21% = 34,36.
          payments: [{ method: "CASH", amount: 34.36 }],
        },
      });
      expect(res.statusCode).toBe(201);

      // Contra la BD, no contra la respuesta.
      const t = await prisma.ticket.findUniqueOrThrow({
        where: { externalId },
        include: { lines: { select: { holdedProductId: true, sku: true } } },
      });
      expect(Number(t.total)).toBeCloseTo(34.36, 2);
      // Hallazgo 1 del addendum 2, COMPROBADO y no supuesto: la línea
      // viaja sin enlace con Holded porque su columna ya era nullable.
      for (const l of t.lines) expect(l.holdedProductId).toBeNull();
    });
  });

  // ── 3 · criterio 2 — no se intenta subir nada ──────────────────────

  describe("criterio 2 · ese ticket no intenta subir nada a Holded", () => {
    it("no se encoló ningún job de subida", () => {
      expect(enqueuedTicketUploads).toHaveLength(0);
    });

    it("no se creó ni la fila de HoldedUpload: no queda nada que barrer", async () => {
      // Es lo que sostiene el forward-only del §4 del bloque: si un día
      // conectan Holded, no hay filas PENDING que un sweeper pueda subir
      // con fecha pasada.
      const n = await prisma.holdedUpload.count({ where: { tenantId: sinHolded } });
      expect(n).toBe(0);
    });

    it("el ticket queda PAID, no PENDING_SYNC ni SYNC_FAILED", async () => {
      const tickets = await prisma.ticket.findMany({
        where: { tenantId: sinHolded },
        select: { status: true },
      });
      expect(tickets.length).toBeGreaterThan(0);
      for (const t of tickets) expect(t.status).toBe("PAID");
    });

    it("no hay ni un ticket en la bandeja de errores del panel", async () => {
      // Antes del bloque, TODOS acababan aquí.
      const n = await prisma.ticket.count({
        where: { tenantId: sinHolded, status: "SYNC_FAILED" },
      });
      expect(n).toBe(0);
    });
  });

  // ── 4 · criterio 3 — el sync deja lo local intacto ─────────────────

  describe("criterio 3 · la conciliación no toca el catálogo local", () => {
    it("un catálogo mixto sobrevive a una conciliación que archiva de Holded", async () => {
      const { archiveMissingProducts } = await import("../src/catalog/reconcile.js");

      // Cuatro de Holded, uno de ellos ya borrado allí. Y dos locales.
      const vivos: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const p = await prisma.product.create({
          data: {
            tenantId: conHolded,
            source: "HOLDED",
            holdedProductId: `e2e-live-${i}-${randomUUID().slice(0, 6)}`,
            name: `Vivo ${i}`,
            sku: `E2E-LIVE-${i}-${randomUUID().slice(0, 4)}`,
            basePrice: 1,
            taxRate: 21,
          },
          select: { holdedProductId: true },
        });
        vivos.push(p.holdedProductId!);
      }
      const borrado = await prisma.product.create({
        data: {
          tenantId: conHolded,
          source: "HOLDED",
          holdedProductId: `e2e-dead-${randomUUID().slice(0, 6)}`,
          name: "Borrado en Holded",
          sku: `E2E-DEAD-${randomUUID().slice(0, 4)}`,
          basePrice: 1,
          taxRate: 21,
        },
        select: { id: true },
      });
      const locales: string[] = [];
      for (let i = 0; i < 2; i += 1) {
        const p = await prisma.product.create({
          data: {
            tenantId: conHolded,
            source: "LOCAL",
            holdedProductId: null,
            name: `Local mixto ${i}`,
            sku: `E2E-MIX-${i}-${randomUUID().slice(0, 4)}`,
            basePrice: 1,
            taxRate: 21,
          },
          select: { id: true },
        });
        locales.push(p.id);
      }

      // Se le pasa el set vivo SIN los locales (que es lo que Holded
      // devuelve: los locales no están allí) y sin el borrado.
      const activosDeHolded = await prisma.product.findMany({
        where: { tenantId: conHolded, source: "HOLDED", active: true },
        select: { holdedProductId: true },
      });
      const liveIds = new Set(
        activosDeHolded
          .map((p) => p.holdedProductId!)
          .filter((id) => !id.startsWith("e2e-dead-")),
      );

      const res = await archiveMissingProducts(prisma, conHolded, liveIds, { force: true });

      // El borrado se archiva.
      const b = await prisma.product.findUniqueOrThrow({ where: { id: borrado.id } });
      expect(b.active).toBe(false);
      expect(b.archivedFromHoldedAt).not.toBeNull();
      expect(res.archived).toBeGreaterThanOrEqual(1);

      // LOS LOCALES, INTACTOS. Ni archivados, ni marcados.
      for (const id of locales) {
        const p = await prisma.product.findUniqueOrThrow({ where: { id } });
        expect(p.active).toBe(true);
        expect(p.sellableViaTpv).toBe(true);
        expect(p.archivedFromHoldedAt).toBeNull();
      }
      for (const hid of vivos) void hid;
    });

    it("un catálogo SÓLO local no se archiva ni pasándole un set vivo vacío", async () => {
      const { archiveMissingProducts } = await import("../src/catalog/reconcile.js");
      const antes = await prisma.product.count({
        where: { tenantId: sinHolded, source: "LOCAL", active: true },
      });
      expect(antes).toBeGreaterThan(0);

      await archiveMissingProducts(prisma, sinHolded, new Set(), { force: true });

      const despues = await prisma.product.count({
        where: { tenantId: sinHolded, source: "LOCAL", active: true },
      });
      expect(despues).toBe(antes);
    });
  });

  // ── 5 · criterio 4 — el tenant con Holded, igual que antes ─────────

  describe("criterio 4 · el comercio con Holded se comporta igual que antes", () => {
    it("sus productos siguen siendo HOLDED y con su enlace", async () => {
      const rows = await prisma.product.findMany({
        where: { tenantId: conHolded, source: "HOLDED" },
        select: { holdedProductId: true },
      });
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(r.holdedProductId).not.toBeNull();
    });

    it("el alta local está CERRADA con 403, probado contra la clave real", async () => {
      // Addendum 1: demostrado contra un tenant con Holded conectado, no
      // asumido por el botón que la pantalla no pinta.
      const res = await app.inject({
        method: "POST",
        url: "/catalog/products",
        headers: ownerAuth(conHolded, ownerConHolded),
        payload: { name: "No debería", sku: "E2E-NOPE", basePrice: 1, taxRate: 21 },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("LOCAL_CATALOG_DISABLED");
      const n = await prisma.product.count({
        where: { tenantId: conHolded, sku: "E2E-NOPE" },
      });
      expect(n).toBe(0);
    });

    it("pero el LISTADO sí le funciona: es su pantalla de diagnóstico", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/catalog/products?includeInactive=true&pageSize=200",
        headers: ownerAuth(conHolded, ownerConHolded),
      });
      expect(res.statusCode).toBe(200);
      const items = res.json().items;
      expect(items.length).toBeGreaterThan(0);
      // Y los de Holded vienen marcados como no editables.
      const deHolded = items.filter((i: { source: string }) => i.source === "HOLDED");
      expect(deHolded.length).toBeGreaterThan(0);
      for (const i of deHolded) expect(i.editable).toBe(false);
    });
  });

  // ── 6 · criterio 5 — sin SKU es imposible ──────────────────────────

  describe("criterio 5 · dar de alta sin SKU es imposible por la API", () => {
    it.each([
      ["sin el campo", {}],
      ["vacío", { sku: "" }],
      ["sólo espacios", { sku: "   " }],
    ])("%s → rechazado, y no queda fila", async (_label, extra) => {
      const antes = await prisma.product.count({ where: { tenantId: sinHolded } });
      const res = await app.inject({
        method: "POST",
        url: "/catalog/products",
        headers: ownerAuth(sinHolded, ownerSinHolded),
        payload: { name: "Sin referencia", basePrice: 1, taxRate: 21, ...extra },
      });
      expect(res.statusCode).toBe(400);
      const despues = await prisma.product.count({ where: { tenantId: sinHolded } });
      expect(despues).toBe(antes);
    });
  });

  // ── 7 · addendum 3 — la fila de en medio de la tabla ────────────────
  //
  // El comercio que COMPRÓ Holded y todavía no lo ha conectado. Hace lo
  // mismo que el de catálogo local —no encola, nace PAID— y no significa
  // lo mismo: sus ventas no llegarán nunca a su contabilidad. Aquí se
  // comprueba contra Postgres de verdad, porque el check que lo canta es
  // un `NOT EXISTS` en SQL crudo y en la suite unitaria sólo lo ve un
  // prisma falso.

  describe("addendum 3 · el que compró Holded y aún no lo ha conectado", () => {
    let sinConectar = "";
    let registerSinConectar = "";
    let cashierSinConectarToken = "";
    let externalIdCobrado = "";

    beforeAll(async () => {
      const t = await prisma.tenant.create({
        data: {
          name: `Bar recién vendido ${randomUUID().slice(0, 8)}`,
          // Previsto (el default) y SIN clave: está a mitad de su alta.
          initialSyncStatus: "NOT_APPLICABLE",
        },
        select: { id: true, holdedEnabled: true },
      });
      // El default de la migración, comprobado sobre una fila real.
      expect(t.holdedEnabled).toBe(true);
      sinConectar = t.id;
      const st = await prisma.store.create({
        data: { tenantId: sinConectar, name: "Barra" },
        select: { id: true },
      });
      const r = await prisma.register.create({
        data: { storeId: st.id, name: "Caja 1" },
        select: { id: true },
      });
      registerSinConectar = r.id;
      const c = await prisma.user.create({
        data: {
          tenantId: sinConectar,
          email: `c3+${randomUUID()}@e2e.local`,
          alias: "Luis",
          role: "CASHIER",
        },
        select: { id: true },
      });
      cashierSinConectarToken = signCashierSession(
        {
          sub: c.id,
          tid: sinConectar,
          did: randomUUID(),
          rid: registerSinConectar,
          role: "CASHIER",
        },
        720,
      );
    });

    it("cobra, y el ticket nace PAID sin encolar ni dejar fila", async () => {
      const open = await app.inject({
        method: "POST",
        url: "/shift/open",
        headers: { authorization: `Bearer ${cashierSinConectarToken}` },
        payload: { cashOpening: 0 },
      });
      expect(open.statusCode).toBe(201);

      enqueuedTicketUploads.length = 0;
      externalIdCobrado = randomUUID();
      const res = await app.inject({
        method: "POST",
        url: "/tickets",
        headers: { authorization: `Bearer ${cashierSinConectarToken}` },
        payload: {
          externalId: externalIdCobrado,
          registerId: registerSinConectar,
          shiftId: open.json().shift.id,
          lines: [
            {
              nameSnapshot: "Caña",
              sku: "TPV-OTROS-BEBIDA",
              units: 1,
              unitPrice: 2,
              discountPct: 0,
              taxRate: 21,
            },
          ],
          payments: [{ method: "CASH", amount: 2.42 }],
        },
      });
      expect(res.statusCode).toBe(201);

      const t = await prisma.ticket.findUniqueOrThrow({
        where: { externalId: externalIdCobrado },
        select: { status: true },
      });
      // NO PENDING_SYNC: no hay sweeper que lo recoja y se quedaría sin
      // poder devolverse y contando como incidencia en el corte, cada día.
      expect(t.status).toBe("PAID");
      expect(enqueuedTicketUploads).toHaveLength(0);
      expect(
        await prisma.holdedUpload.count({ where: { tenantId: sinConectar } }),
      ).toBe(0);
    });

    it("la salud del onboarding LO CANTA, y lo deja sin activar", async () => {
      // El `NOT EXISTS` contra `holded_uploads`, ejecutado de verdad.
      const h = await computeOnboardingHealth(prisma, sinConectar);
      expect(h.holded).toEqual({ enabled: true, connected: false });
      expect(h.ticketsCobradosSinSubir).toBe(1);
      const check = h.readinessChecks.find((c) => c.id === "tickets-before-holded")!;
      expect(check.applies).toBe(true);
      expect(check.ok).toBe(false);
      expect(check.value).toContain("1");
      expect(h.ready).toBe(false);
    });

    it("al comercio de catálogo local esos mismos cobros no le dicen nada", async () => {
      // Mismo hecho en la base —tickets PAID sin fila de upload— y
      // lectura opuesta: aquí es el diseño funcionando. Si este check le
      // aplicara, no podría activarse nunca en cuanto cobrara.
      const h = await computeOnboardingHealth(prisma, sinHolded);
      expect(h.holded).toEqual({ enabled: false, connected: false });
      const check = h.readinessChecks.find((c) => c.id === "tickets-before-holded")!;
      expect(check.applies).toBe(false);
    });

    it("el falso positivo que el NOT EXISTS evita: un PAID CON fila de upload", async () => {
      // Un fiado saldado en un tenant conectado pasa por PAID mientras su
      // upload está en cola. Contar `status = 'PAID'` a secas lo daría
      // como cobro huérfano hasta que el worker lo subiera.
      const externalId = randomUUID();
      const st = await prisma.store.findFirstOrThrow({
        where: { tenantId: sinConectar },
        select: { id: true },
      });
      const reg = await prisma.register.findFirstOrThrow({
        where: { storeId: st.id },
        select: { id: true },
      });
      const shift = await prisma.shift.findFirstOrThrow({
        where: { registerId: reg.id },
        select: { id: true, userId: true },
      });
      await prisma.ticket.create({
        data: {
          tenantId: sinConectar,
          registerId: reg.id,
          shiftId: shift.id,
          userId: shift.userId,
          internalNumber: `E2E-${randomUUID().slice(0, 8)}`,
          externalId,
          publicSlug: randomUUID(),
          status: "PAID",
          total: 5,
          totalTax: 0.87,
          totalDiscount: 0,
        },
      });
      const antes = (await computeOnboardingHealth(prisma, sinConectar))
        .ticketsCobradosSinSubir;
      expect(antes).toBe(2);

      await prisma.holdedUpload.create({
        data: { externalId, tenantId: sinConectar, kind: "TICKET", status: "PENDING" },
      });
      const despues = (await computeOnboardingHealth(prisma, sinConectar))
        .ticketsCobradosSinSubir;
      expect(despues).toBe(1);
    });
  });
});
