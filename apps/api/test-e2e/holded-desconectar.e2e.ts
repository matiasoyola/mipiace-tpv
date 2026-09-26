// holded-desconectar · un comercio vivo deja Holded, contra Postgres DE
// VERDAD. ADR-020.
//
// POR QUÉ ESTE FICHERO EXISTE, y no un banco con Prisma falso. Seis cosas de
// este bloque no las decide el código de la API y las seis se despliegan el
// mismo día:
//
//   1. **El índice único parcial pasa a gobernar el catálogo ENTERO.** Antes
//      del corte 86 fichas de Holded pueden compartir SKU sin que nada
//      proteste; después son 86 fichas LOCAL bajo
//      `UNIQUE (tenant_id, sku) WHERE source = 'LOCAL'`. Que el plan de SKU
//      cierre es una afirmación sobre Postgres, no sobre TypeScript.
//   2. **El CHECK `tenants_holded_desconectado_ck`.** Que no se pueda estar
//      «a medio dejar» sólo lo puede confirmar la base.
//   3. **El trigger `holded_uploads_no_tras_el_corte`.** Que una fila
//      forzada nazca SKIPPED en vez de PENDING es plpgsql.
//   4. **La atomicidad.** Que el catálogo no se quede convertido con la
//      clave puesta depende de la transacción de verdad.
//   5. **Que los `id` no cambien** y que la agenda, los modificadores y las
//      líneas de ticket sigan colgando de ellos: son seis claves ajenas.
//   6. **Que los demás comercios no se muevan ni un byte.**
//
// La tabla de sabotaje del done se sostiene casi entera aquí.

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

// Lo que importa es QUÉ se encola, no que BullMQ funcione.
const encoladosTicket: string[] = [];
const encoladosRefund: string[] = [];
vi.mock("../src/queues/ticket-upload.js", () => ({
  enqueueTicketUpload: async (externalId: string) => {
    encoladosTicket.push(externalId);
  },
  getTicketUploadQueue: () => ({ name: "ticket-upload", getJobs: async () => [] }),
}));
vi.mock("../src/queues/refund-upload.js", () => ({
  enqueueRefundUpload: async (externalId: string) => {
    encoladosRefund.push(externalId);
  },
  getRefundUploadQueue: () => ({ name: "refund-upload", getJobs: async () => [] }),
}));
vi.mock("../src/queues/ticket-email.js", () => ({
  enqueueTicketEmail: async () => undefined,
  getTicketEmailQueue: () => ({ name: "ticket-email", getJobs: async () => [] }),
}));
// Las colas del vaciado: falsas, y se GUARDA a quién se le quitó el
// repeatable — es lo que impide que el cron de 15 min vuelva solo.
const repeatablesQuitados: string[] = [];
vi.mock("../src/queues/catalog-incremental.js", () => ({
  getCatalogIncrementalQueue: () => ({
    name: "catalog-incremental",
    getJobs: async () => [],
  }),
  registerTenantRepeatable: async () => undefined,
  unregisterTenantRepeatable: async (t: string) => {
    repeatablesQuitados.push(t);
  },
  enqueueManualSync: async () => ({ jobId: "x" }),
}));
vi.mock("../src/queues/initial-sync.js", () => ({
  enqueueInitialSync: async () => undefined,
  getInitialSyncQueue: () => ({ name: "initial-sync", getJobs: async () => [] }),
}));
vi.mock("../src/queues/contact-import.js", () => ({
  getContactImportQueue: () => ({ name: "contact-import", getJobs: async () => [] }),
  enqueueContactImport: async () => ({ jobId: "x" }),
}));
vi.mock("../src/queues/product-image-cache.js", () => ({
  getProductImageCacheQueue: () => ({
    name: "product-image-cache",
    getJobs: async () => [],
  }),
  enqueueProductImageCache: async () => undefined,
}));

const { getPrisma, shutdown } = await import("../src/context.js");
const { registerTicketRoutes } = await import("../src/tickets/routes.js");
const { registerShiftRoutes } = await import("../src/shift/routes.js");
const { registerLocalCatalogRoutes } = await import("../src/catalog/local-products.js");
const { registerTpvCatalogRoutes } = await import("../src/tpv-catalog/routes.js");
const { registerCatalogRoutes } = await import("../src/catalog/routes.js");
const { registerDevolucionesAsesorRoutes } = await import(
  "../src/admin/devoluciones-asesor.js"
);
const { registerSuperAdminRoutes } = await import("../src/superadmin/routes.js");
const { registerAuthRoutes } = await import("../src/auth/routes.js");
const { registerErrorHandler } = await import("../src/lib/error-handler.js");
const { registerLenientJsonParser } = await import("../src/lib/lenient-json.js");
const { signCashierSession } = await import("../src/shift/cashier-session.js");
const { signAccessToken } = await import("../src/auth/tokens.js");
const { signSuperAdminAccessToken } = await import("../src/superadmin/tokens.js");
const { encryptSecret } = await import("../src/crypto.js");
const {
  buildSkuDelCorte,
  ejecutarDejarHolded,
  previsualizarDejarHolded,
  DejarHoldedBloqueadoError,
} = await import("../src/holded/dejar-holded.js");
const { vaciarColasDeHolded } = await import("../src/holded/dejar-holded-colas.js");
const { getTenantHealthStatus } = await import("../src/tickets/health.js");

describe.skipIf(!e2eEnabled)("e2e · dejar Holded, contra Postgres real", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let app: FastifyInstance;

  // El comercio del bloque: Peluquería Sole, con Holded conectado y
  // vendiendo. Los números son los de la copia real del 24-09-2026.
  let sole = "";
  let ownerSole = "";
  let registerSole = "";
  let cashierSoleId = "";
  let cashierSole = "";
  let servicioCorte = "";
  let productoChampu = "";
  let ticketAntesDelCorte = "";
  let externalAntesDelCorte = "";

  // El vecino, que no se puede mover ni un byte.
  let vecino = "";
  let productoVecino = "";

  const ownerAuth = (tenantId: string, userId: string) => ({
    authorization: `Bearer ${signAccessToken({ sub: userId, tid: tenantId, role: "OWNER" })}`,
  });
  const cashierAuth = () => ({ authorization: `Bearer ${cashierSole}` });
  let superAdminToken = "";
  const superAuth = () => ({ authorization: `Bearer ${superAdminToken}` });

  const CLAVE = () => encryptSecret("clave-de-sole", process.env.HOLDED_KEY_ENCRYPTION_SECRET!);

  async function montarComercio(nombre: string, conClave: boolean) {
    const t = await prisma.tenant.create({
      data: {
        name: `${nombre} ${randomUUID().slice(0, 8)}`,
        initialSyncStatus: "DONE",
        holdedEnabled: true,
        ...(conClave ? { holdedApiKeyCiphertext: CLAVE() } : {}),
        // El suelo fiscal, que la acción exige: sin NIF ni razón social no
        // se puede emitir factura simplificada y la acción no arranca.
        fiscalProfile: { taxId: "04165994G", legalName: "Peluquería Sole" },
        // La agenda encendida en el comercio de prueba aunque Sole la tenga
        // apagada en producción: es lo que permite comprobar el criterio 6
        // («la agenda sigue viendo sus servicios») de verdad y no de boca.
        agendaEnabled: true,
        crmEnabled: true,
      },
      select: { id: true },
    });
    const owner = await prisma.user.create({
      data: { tenantId: t.id, email: `o+${randomUUID()}@e2e.local`, role: "OWNER" },
      select: { id: true },
    });
    const store = await prisma.store.create({
      data: { tenantId: t.id, name: "Tienda" },
      select: { id: true },
    });
    const reg = await prisma.register.create({
      data: { storeId: store.id, name: "Caja 1" },
      select: { id: true },
    });
    const cashier = await prisma.user.create({
      data: {
        tenantId: t.id,
        email: `c+${randomUUID()}@e2e.local`,
        alias: "Ana",
        role: "CASHIER",
      },
      select: { id: true },
    });
    return { tenantId: t.id, ownerId: owner.id, registerId: reg.id, cashierId: cashier.id };
  }

  /** Una ficha tal cual la deja el sync de Holded. */
  async function fichaDeHolded(
    tenantId: string,
    p: {
      name: string;
      sku: string | null;
      kind?: "PRODUCT" | "SERVICE";
      taxRate?: number;
      basePrice?: number;
      holdedProductId?: string;
      skuAutoAssignedAt?: Date | null;
      sellableViaTpv?: boolean;
      archivedFromHoldedAt?: Date | null;
    },
  ) {
    return await prisma.product.create({
      data: {
        tenantId,
        source: "HOLDED",
        holdedProductId: p.holdedProductId ?? `68d665f5${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        name: p.name,
        sku: p.sku,
        basePrice: p.basePrice ?? 10,
        taxRate: p.taxRate ?? 21,
        kind: p.kind ?? "PRODUCT",
        tags: ["peluqueria"],
        imageUrl: "https://cdn.holded.com/foto.jpg",
        skuAutoAssignedAt:
          p.skuAutoAssignedAt === undefined ? new Date("2026-05-26T08:00:00Z") : p.skuAutoAssignedAt,
        sellableViaTpv: p.sellableViaTpv ?? true,
        archivedFromHoldedAt: p.archivedFromHoldedAt ?? null,
      },
      select: { id: true, holdedProductId: true, sku: true },
    });
  }

  /**
   * Abre turno, o devuelve el que ya esté abierto en esa caja.
   *
   * Una caja tiene UN turno abierto y `POST /shift/open` contesta 409 si ya
   * hay uno — es correcto y es lo que impide dos arqueos a la vez. El e2e
   * cobra varias veces sobre la misma caja a lo largo del fichero, así que
   * lo que necesita es "tener turno", no "abrir turno".
   */
  async function abrirTurno(token: string, registerId: string): Promise<string> {
    const r = await app.inject({
      method: "POST",
      url: "/shift/open",
      headers: { authorization: `Bearer ${token}` },
      payload: { cashOpening: 0 },
    });
    if (r.statusCode === 201) return r.json().shift.id as string;
    const abierto = await prisma.shift.findFirstOrThrow({
      where: { registerId, closedAt: null },
      select: { id: true },
    });
    return abierto.id;
  }

  beforeAll(async () => {
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    registerLenientJsonParser(app);
    await registerLocalCatalogRoutes(app);
    await registerCatalogRoutes(app);
    await registerTpvCatalogRoutes(app);
    await registerShiftRoutes(app);
    await registerTicketRoutes(app);
    await registerDevolucionesAsesorRoutes(app);
    await registerSuperAdminRoutes(app);
    await registerAuthRoutes(app);
    await app.ready();

    // Un super-admin de verdad en la base: las rutas de `/super-admin` leen
    // `token_version` de la fila, así que un JWT firmado contra un id que no
    // existe no pasa el middleware.
    const sa = await prisma.superAdminUser.create({
      data: {
        email: `sa+${randomUUID()}@e2e.local`,
        passwordHash: "x",
        name: "Ensayo",
      },
      select: { id: true, tokenVersion: true },
    });
    superAdminToken = signSuperAdminAccessToken({ sub: sa.id, tv: sa.tokenVersion });

    const s = await montarComercio("Peluquería Sole", true);
    sole = s.tenantId;
    ownerSole = s.ownerId;
    registerSole = s.registerId;
    cashierSoleId = s.cashierId;
    cashierSole = signCashierSession(
      { sub: cashierSoleId, tid: sole, did: randomUUID(), rid: registerSole, role: "CASHIER" },
      720,
    );

    // El catálogo de Sole: un servicio y un producto, como los suyos.
    const svc = await fichaDeHolded(sole, {
      name: "Corte de pelo",
      sku: "AUTO-6819b3c3",
      kind: "SERVICE",
      basePrice: 15.2893,
    });
    servicioCorte = svc.id;
    const ch = await fichaDeHolded(sole, { name: "Champú Biokera", sku: "AUTO-6819b470" });
    productoChampu = ch.id;

    // La agenda cuelga del servicio: es lo que el criterio 6 protege.
    await prisma.serviceScheduling.create({
      data: { productId: servicioCorte, tenantId: sole, durationMin: 30 },
    });
    // Y un modificador, y un contacto espejo de Holded.
    const grupo = await prisma.modifierGroup.create({
      data: { tenantId: sole, name: "Extras" },
      select: { id: true },
    });
    await prisma.productModifierGroup.create({
      data: { productId: servicioCorte, modifierGroupId: grupo.id, sortOrder: 0 },
    });
    await prisma.contact.create({
      data: {
        tenantId: sole,
        holdedContactId: `hc-${randomUUID().slice(0, 8)}`,
        name: "Clienta de siempre",
        email: "clienta@example.com",
        type: "CLIENT",
      },
    });

    // ── una venta ANTES del corte, con Holded ya conectado ───────────
    const shiftId = await abrirTurno(cashierSole, registerSole);
    externalAntesDelCorte = randomUUID();
    const venta = await app.inject({
      method: "POST",
      url: "/tickets",
      headers: cashierAuth(),
      payload: {
        externalId: externalAntesDelCorte,
        registerId: registerSole,
        shiftId,
        lines: [
          {
            productId: servicioCorte,
            nameSnapshot: "Corte de pelo",
            sku: "AUTO-6819b3c3",
            units: 1,
            unitPrice: 15.2893,
            discountPct: 0,
            taxRate: 21,
          },
        ],
        payments: [{ method: "CASH", amount: 18.5 }],
      },
    });
    expect(venta.statusCode).toBe(201);
    ticketAntesDelCorte = venta.json().ticket.id as string;
    // Con Holded conectado nace PENDING_SYNC y se encola. Es lo que hace
    // de éste un comercio "vivo" y no un montaje.
    const t = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticketAntesDelCorte },
      select: { status: true },
    });
    expect(t.status).toBe("PENDING_SYNC");
    expect(encoladosTicket).toContain(externalAntesDelCorte);

    // Lo cerramos como lo cerraría el worker: SYNCED con su documento de
    // Holded. Es el ticket que después se devolverá (criterio 5.a).
    await prisma.ticket.update({
      where: { id: ticketAntesDelCorte },
      data: {
        status: "SYNCED",
        holdedDocumentId: "hd-antes-del-corte",
        holdedDocNumber: "SR-000123",
        syncedAt: new Date(),
      },
    });
    await prisma.holdedUpload.update({
      where: { externalId: externalAntesDelCorte },
      data: { status: "DONE", holdedDocumentId: "hd-antes-del-corte" },
    });

    // ── el vecino ────────────────────────────────────────────────────
    const v = await montarComercio("Cafetería Sirope", true);
    vecino = v.tenantId;
    const pv = await fichaDeHolded(vecino, { name: "Café solo", sku: "CAF-001" });
    productoVecino = pv.id;
  });

  afterAll(async () => {
    await app?.close();
    await shutdown();
  });

  // ══════════════════════════════════════════════════════════════════
  // 1 · LA PREVISUALIZACIÓN ES LA VERDAD (criterio 7)
  // ══════════════════════════════════════════════════════════════════

  describe("la previsualización", () => {
    it("cuenta lo que hay, de consultas reales", async () => {
      const p = await previsualizarDejarHolded(prisma, sole);
      expect(p.catalogo.seConvierten).toBe(2);
      expect(p.catalogo.productos).toBe(1);
      expect(p.catalogo.servicios).toBe(1);
      expect(p.catalogo.conservanEnlace).toBe(2);
      // Lo que cuelga de los `id` que NO van a cambiar.
      expect(p.catalogo.cuelgan.lineasDeTicket).toBe(1);
      expect(p.catalogo.cuelgan.conAgenda).toBe(1);
      expect(p.catalogo.cuelgan.conModificadores).toBe(1);
      expect(p.contactosYCrm.contactos).toBe(1);
      expect(p.devoluciones.ticketsFacturadosPorHolded).toBe(1);
      expect(p.puedeArrancar).toBe(true);
      expect(p.bloqueos).toEqual([]);
    });

    it("avisa del APK y enseña la serie de cada caja", async () => {
      const p = await previsualizarDejarHolded(prisma, sole);
      expect(p.fiscal.avisoApk).toContain("VERI*FACTU");
      expect(p.fiscal.cajas).toHaveLength(1);
      // La serie y el nº de instalación los pone la BASE al crear la caja
      // (trigger `registers_fiscal_identity_default`, verifactu-1 §2.5).
      expect(p.fiscal.cajas[0]!.serie).not.toBeNull();
      expect(p.fiscal.cajas[0]!.numeroInstalacion).not.toBeNull();
    });

    it("no arranca sin NIF ni razón social (suelo fiscal)", async () => {
      const t = await montarComercio("Sin datos fiscales", true);
      await prisma.tenant.update({
        where: { id: t.tenantId },
        data: { fiscalProfile: {} },
      });
      const p = await previsualizarDejarHolded(prisma, t.tenantId);
      expect(p.puedeArrancar).toBe(false);
      expect(p.bloqueos.map((b) => b.codigo)).toContain("SUELO_FISCAL_INCOMPLETO");
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 2 · LO QUE IMPIDE ARRANCAR
  // ══════════════════════════════════════════════════════════════════

  describe("las ventas en vuelo (sabotaje nº 2)", () => {
    it("un ticket en PENDING_SYNC bloquea la acción", async () => {
      const t = await montarComercio("Con venta en vuelo", true);
      await fichaDeHolded(t.tenantId, { name: "Algo", sku: "SKU-1" });
      const token = signCashierSession(
        { sub: t.cashierId, tid: t.tenantId, did: randomUUID(), rid: t.registerId, role: "CASHIER" },
        720,
      );
      const shiftId = await abrirTurno(token, t.registerId);
      const res = await app.inject({
        method: "POST",
        url: "/tickets",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          externalId: randomUUID(),
          registerId: t.registerId,
          shiftId,
          lines: [
            {
              nameSnapshot: "Algo",
              sku: "SKU-1",
              units: 1,
              unitPrice: 10,
              discountPct: 0,
              taxRate: 21,
            },
          ],
          payments: [{ method: "CASH", amount: 12.1 }],
        },
      });
      expect(res.statusCode).toBe(201);

      const p = await previsualizarDejarHolded(prisma, t.tenantId);
      expect(p.puedeArrancar).toBe(false);
      expect(p.bloqueos.map((b) => b.codigo)).toContain("VENTAS_EN_VUELO");
      expect(p.ventasEnVuelo.ticketsPendingSync).toHaveLength(1);

      // Y la ejecución lo rechaza con LOS MISMOS bloqueos, no con un 409
      // genérico: el que pulsó tiene que leer lo mismo que le enseñó la
      // pantalla.
      await expect(
        ejecutarDejarHolded({ prisma, tenantId: t.tenantId }),
      ).rejects.toBeInstanceOf(DejarHoldedBloqueadoError);
      // Y no ha tocado nada.
      const after = await prisma.tenant.findUniqueOrThrow({
        where: { id: t.tenantId },
        select: { holdedEnabled: true, holdedApiKeyCiphertext: true, holdedDisconnectedAt: true },
      });
      expect(after.holdedEnabled).toBe(true);
      expect(after.holdedApiKeyCiphertext).not.toBeNull();
      expect(after.holdedDisconnectedAt).toBeNull();
      const sigueHolded = await prisma.product.count({
        where: { tenantId: t.tenantId, source: "HOLDED" },
      });
      expect(sigueHolded).toBe(1);
    });

    it("un abono en SYNC_FAILED bloquea (los 6 de Sole del 10-09)", async () => {
      // Medido en la copia real: Sole arrastra SEIS devoluciones en
      // SYNC_FAILED, todas del 10-09 y todas con `silent_reject` y total 0
      // contra el negativo esperado. El dinero ya salió del cajón, así que
      // el abono TIENE que existir en su contabilidad antes del corte.
      const t = await montarComercio("Con abono roto", true);
      const token = signCashierSession(
        { sub: t.cashierId, tid: t.tenantId, did: randomUUID(), rid: t.registerId, role: "CASHIER" },
        720,
      );
      const shiftId = await abrirTurno(token, t.registerId);
      await prisma.refund.create({
        data: {
          tenantId: t.tenantId,
          originalTicketId: (
            await prisma.ticket.create({
              data: {
                tenantId: t.tenantId,
                registerId: t.registerId,
                userId: t.cashierId,
                shiftId,
                internalNumber: "000900",
                externalId: randomUUID(),
                publicSlug: randomUUID(),
                status: "SYNCED",
                total: 9.6,
                totalTax: 1.67,
                totalDiscount: 0,
                holdedDocumentId: "hd-x",
              },
              select: { id: true },
            })
          ).id,
          userId: t.cashierId,
          registerId: t.registerId,
          shiftId,
          internalNumber: "R-000900",
          externalId: randomUUID(),
          status: "SYNC_FAILED",
          total: 9.6,
          totalTax: 1.67,
          syncError: { reason: "silent_reject" },
        },
      });
      const p = await previsualizarDejarHolded(prisma, t.tenantId);
      expect(p.bloqueos.map((b) => b.codigo)).toContain("ABONOS_EN_VUELO");
      expect(p.bloqueos.find((b) => b.codigo === "ABONOS_EN_VUELO")!.mensaje).toContain(
        "Marcar resuelto",
      );
    });

    it("un fiado con deuda viva bloquea", async () => {
      // No está en la lista del prompt y tiene la MISMA consecuencia: un
      // fiado no sube a Holded hasta que se salda (variante B), así que si
      // se saldara después del corte su factura no llegaría nunca.
      const t = await montarComercio("Con fiado vivo", true);
      const token = signCashierSession(
        { sub: t.cashierId, tid: t.tenantId, did: randomUUID(), rid: t.registerId, role: "CASHIER" },
        720,
      );
      const shiftId = await abrirTurno(token, t.registerId);
      await prisma.ticket.create({
        data: {
          tenantId: t.tenantId,
          registerId: t.registerId,
          userId: t.cashierId,
          shiftId,
          internalNumber: "000901",
          externalId: randomUUID(),
          publicSlug: randomUUID(),
          status: "ON_CREDIT",
          total: 20,
          totalTax: 3.47,
          totalDiscount: 0,
          creditPending: 20,
          contactHoldedId: "hc-deudor",
        },
      });
      const p = await previsualizarDejarHolded(prisma, t.tenantId);
      expect(p.bloqueos.map((b) => b.codigo)).toContain("FIADO_VIVO");
      expect(p.contactosYCrm.fiadosVivosConDeudor).toBe(1);
      expect(p.contactosYCrm.deudaVivaTotal).toBe("20.00");
    });
  });

  describe("el SKU (sabotaje nº 4)", () => {
    it("un duplicado DEL CLIENTE se lista y la acción no arranca", async () => {
      const t = await montarComercio("Con SKU del cliente repetido", true);
      await fichaDeHolded(t.tenantId, {
        name: "Coca cola",
        sku: "SKU215",
        skuAutoAssignedAt: null,
      });
      await fichaDeHolded(t.tenantId, {
        name: "Coca cola zero",
        sku: "SKU215",
        skuAutoAssignedAt: null,
      });
      const p = await previsualizarDejarHolded(prisma, t.tenantId);
      expect(p.puedeArrancar).toBe(false);
      expect(p.bloqueos.map((b) => b.codigo)).toContain("SKU_SIN_RESOLVER");
      expect(p.sku.choques[0]!.codigo).toBe("SKU_DUPLICADO_DEL_CLIENTE");
      await expect(
        ejecutarDejarHolded({ prisma, tenantId: t.tenantId }),
      ).rejects.toBeInstanceOf(DejarHoldedBloqueadoError);
    });

    it("y si alguien se salta el chequeo, el ÍNDICE PARCIAL lo para", async () => {
      // El sabotaje nº 4 del done: quitar el chequeo del plan no deja pasar
      // el corte, lo convierte en un P2002 del índice. Se demuestra a mano
      // porque el sabotaje de verdad se hace editando el código.
      const t = await montarComercio("Para el índice", true);
      const a = await fichaDeHolded(t.tenantId, { name: "A", sku: "MISMO" });
      const b = await fichaDeHolded(t.tenantId, { name: "B", sku: "MISMO" });
      // Antes del corte conviven: el índice es PARCIAL sobre source=LOCAL.
      expect(a.sku).toBe(b.sku);
      await expect(
        prisma.product.updateMany({
          where: { tenantId: t.tenantId, source: "HOLDED" },
          data: { source: "LOCAL" },
        }),
      ).rejects.toThrow();
    });

    it("la ficha sin SKU gana uno Y con él la visibilidad en el TPV", async () => {
      // Thalía, `TALONARIO CAJA`: IVA 21, SKU a NULL, `sellable_via_tpv`
      // false. Sin recalcular se quedaría invisible en la rejilla PARA
      // SIEMPRE justo después de que la acción le diera un SKU, y desde el
      // panel no hay forma de arreglarlo: `sellableViaTpv` no está entre los
      // campos que acepta `PATCH /catalog/products/:id`.
      const t = await montarComercio("Con ficha sin SKU", true);
      const sinSku = await fichaDeHolded(t.tenantId, {
        name: "TALONARIO CAJA",
        sku: null,
        taxRate: 21,
        sellableViaTpv: false,
      });
      // Y su vecina, la que NO tiene que ganar visibilidad: IVA sin resolver.
      // La firma la deja `upsertCatalogEntry` cuando `resolveTaxRate`
      // devuelve null — `taxRate = 0` Y `sellable_via_tpv = false`. Ponerla a
      // la venta cobraría de menos en cada ticket.
      const ivaRoto = await fichaDeHolded(t.tenantId, {
        name: "Busca y encuentra en la ciudad",
        sku: "AUTO-690394b5",
        taxRate: 0,
        sellableViaTpv: false,
      });
      // Y un exento REAL, que sí se queda vendible.
      const exento = await fichaDeHolded(t.tenantId, {
        name: "Libro de texto",
        sku: "AUTO-EXENTO1",
        taxRate: 0,
        sellableViaTpv: true,
      });

      await ejecutarDejarHolded({ prisma, tenantId: t.tenantId });

      const despues = await prisma.product.findMany({
        where: { tenantId: t.tenantId },
        select: { id: true, sku: true, sellableViaTpv: true, needsSkuReview: true },
      });
      const byId = new Map(despues.map((p) => [p.id, p]));
      expect(byId.get(sinSku.id)!.sku).not.toBeNull();
      expect(byId.get(sinSku.id)!.sellableViaTpv).toBe(true);
      expect(byId.get(ivaRoto.id)!.sellableViaTpv).toBe(false);
      expect(byId.get(exento.id)!.sellableViaTpv).toBe(true);
      // Y la previsualización lo había dicho antes de tocar nada.
    });

    it("re-acuña los AUTO- repetidos y deja el catálogo limpio", async () => {
      // El caso de Thalía: trece fichas creadas el mismo rato comparten
      // `AUTO-<8>` porque esos ocho hex son el timestamp del ObjectId.
      const t = await montarComercio("Thalía", true);
      const ids: string[] = [];
      for (let i = 0; i < 13; i += 1) {
        const f = await fichaDeHolded(t.tenantId, {
          name: `EDDING 1200 color ${i}`,
          sku: "AUTO-68d665f5",
          holdedProductId: `68d665f5aaaabbbbcccc${String(i).padStart(4, "0")}`,
        });
        ids.push(f.id);
      }
      const previa = await previsualizarDejarHolded(prisma, t.tenantId);
      expect(previa.puedeArrancar).toBe(true);
      expect(previa.sku.cambios).toHaveLength(13);

      const r = await ejecutarDejarHolded({ prisma, tenantId: t.tenantId });
      expect(r.cortado).toBe(true);
      expect(r.skuAcunados).toHaveLength(13);

      const despues = await prisma.product.findMany({
        where: { tenantId: t.tenantId },
        select: { id: true, sku: true, source: true, holdedProductId: true },
      });
      expect(despues.every((p) => p.source === "LOCAL")).toBe(true);
      // Trece SKU distintos: es lo que el índice parcial exige.
      expect(new Set(despues.map((p) => p.sku)).size).toBe(13);
      // Y los MISMOS trece `id`: nada se ha recreado.
      expect(new Set(despues.map((p) => p.id))).toEqual(new Set(ids));
      // Cada SKU deriva de SU enlace, que sigue ahí.
      for (const p of despues) {
        expect(p.sku).toBe(buildSkuDelCorte(p.holdedProductId!));
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 3 · EL CORTE DE SOLE
  // ══════════════════════════════════════════════════════════════════

  describe("el corte", () => {
    let fotoVecino: unknown;

    it("se ejecuta y deja el comercio sin Holded", async () => {
      fotoVecino = await prisma.product.findUniqueOrThrow({
        where: { id: productoVecino },
      });

      const r = await ejecutarDejarHolded({ prisma, tenantId: sole });
      expect(r.cortado).toBe(true);
      expect(r.productosConvertidos).toBe(2);
      // Los SKU de Sole ya eran únicos: no se toca ninguno. 86 de 86 en la
      // copia real.
      expect(r.skuAcunados).toEqual([]);

      const t = await prisma.tenant.findUniqueOrThrow({
        where: { id: sole },
        select: {
          holdedEnabled: true,
          holdedApiKeyCiphertext: true,
          holdedOauthAccess: true,
          holdedDisconnectedAt: true,
          initialSyncStatus: true,
        },
      });
      expect(t.holdedEnabled).toBe(false);
      expect(t.holdedApiKeyCiphertext).toBeNull();
      expect(t.holdedOauthAccess).toBeNull();
      expect(t.holdedDisconnectedAt).not.toBeNull();
      expect(t.initialSyncStatus).toBe("NOT_APPLICABLE");
    });

    it("sabotaje nº 5 · `holdedProductId` se CONSERVA", async () => {
      // Es el hilo de la vuelta a Holded en 2027. Si esto se pusiera a
      // null, la vuelta habría que hacerla a mano, ficha a ficha.
      const ps = await prisma.product.findMany({
        where: { tenantId: sole },
        select: { holdedProductId: true, source: true },
      });
      expect(ps).toHaveLength(2);
      expect(ps.every((p) => p.source === "LOCAL")).toBe(true);
      expect(ps.every((p) => p.holdedProductId != null)).toBe(true);
    });

    it("sabotaje nº 6 · ningún `id` cambia y la agenda sigue viendo su servicio", async () => {
      const svc = await prisma.product.findUniqueOrThrow({
        where: { id: servicioCorte },
        include: {
          scheduling: true,
          modifierGroups: true,
          lines: true,
        },
      });
      expect(svc.source).toBe("LOCAL");
      // Nombre, precio, IVA, tags, imagen y SKU intactos.
      expect(svc.name).toBe("Corte de pelo");
      expect(Number(svc.taxRate)).toBe(21);
      expect(Number(svc.basePrice)).toBeCloseTo(15.2893, 4);
      expect(svc.tags).toEqual(["peluqueria"]);
      expect(svc.imageUrl).toBe("https://cdn.holded.com/foto.jpg");
      expect(svc.sku).toBe("AUTO-6819b3c3");
      // Y las tres cosas que cuelgan de su `id` siguen colgando.
      expect(svc.scheduling?.durationMin).toBe(30);
      expect(svc.modifierGroups).toHaveLength(1);
      expect(svc.lines).toHaveLength(1);
      // La línea del ticket de antes del corte sigue apuntando al producto:
      // la FK es ON DELETE SET NULL, así que recrear la ficha habría dejado
      // el histórico sin poder decir qué se vendió.
      const linea = await prisma.ticketLine.findFirstOrThrow({
        where: { ticketId: ticketAntesDelCorte },
        select: { productId: true },
      });
      expect(linea.productId).toBe(servicioCorte);
    });

    it("sabotaje nº 8 · el vecino no se ha movido ni un byte", async () => {
      const ahora = await prisma.product.findUniqueOrThrow({
        where: { id: productoVecino },
      });
      expect(ahora).toEqual(fotoVecino);
      const tv = await prisma.tenant.findUniqueOrThrow({
        where: { id: vecino },
        select: {
          holdedEnabled: true,
          holdedApiKeyCiphertext: true,
          holdedDisconnectedAt: true,
          initialSyncStatus: true,
        },
      });
      expect(tv.holdedEnabled).toBe(true);
      expect(tv.holdedApiKeyCiphertext).not.toBeNull();
      expect(tv.holdedDisconnectedAt).toBeNull();
      expect(tv.initialSyncStatus).toBe("DONE");
    });

    it("el CHECK de la base impide estar «a medio dejar»", async () => {
      // Con la fecha puesta no puede haber clave ni interruptor encendido.
      // Es lo que convierte «Holded se calla» en una invariante del dato y
      // no en una lista de `if` que alguien tiene que recordar.
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE tenants SET holded_api_key_ciphertext = 'x' WHERE id = $1::uuid`,
          sole,
        ),
      ).rejects.toThrow(/tenants_holded_desconectado_ck/);
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE tenants SET holded_enabled = true WHERE id = $1::uuid`,
          sole,
        ),
      ).rejects.toThrow(/tenants_holded_desconectado_ck/);
    });

    it("LA PUERTA DE LA VUELTA · reencender el interruptor es 409, no un 500", async () => {
      // ADR-017 §4.1 decía que encender Holded «no tiene guarda: es volver al
      // camino de siempre». Con este bloque deja de ser cierto para el
      // comercio que lo DEJÓ: sus fichas son LOCAL y conservan
      // `holded_product_id`, así que el upsert del sync entraría por la rama
      // `update` y les pisaría nombre, precio, IVA y tags.
      //
      // El CHECK de la base lo impediría igual, pero como un 500 de Prisma
      // que nadie sabría leer. La guarda existe para que sea un 409 con la
      // razón escrita, y este test afirma el CÓDIGO y el MENSAJE, no sólo
      // "no pasó".
      const res = await app.inject({
        method: "PATCH",
        url: `/super-admin/tenants/${sole}`,
        headers: superAuth(),
        payload: { holdedEnabled: true },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("HOLDED_DESCONECTADO");
      expect(res.json().message).toContain("aparte");
      // Y sigue apagado.
      const t = await prisma.tenant.findUniqueOrThrow({
        where: { id: sole },
        select: { holdedEnabled: true, holdedDisconnectedAt: true },
      });
      expect(t.holdedEnabled).toBe(false);
      expect(t.holdedDisconnectedAt).not.toBeNull();
    });

    it("...y pegarle una clave nueva, también", async () => {
      // El otro camino de la vuelta: `PATCH …/holded-api-key`. Se comprueba
      // ANTES de validar la clave contra Holded, así que no se gasta ni una
      // llamada — es lo que el ensayo general vio en el centinela.
      const res = await app.inject({
        method: "PATCH",
        url: `/super-admin/tenants/${sole}/holded-api-key`,
        headers: superAuth(),
        payload: { holdedApiKey: "clave-inventada-1234567890" },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("HOLDED_DESCONECTADO");
      const t = await prisma.tenant.findUniqueOrThrow({
        where: { id: sole },
        select: { holdedApiKeyCiphertext: true },
      });
      expect(t.holdedApiKeyCiphertext).toBeNull();
    });

    it("...y el propietario tampoco puede resucitarlo desde su panel", async () => {
      // `POST /auth/me/rotate-holded-key` es `requireOwner` y no tenía
      // ninguna guarda: Ana podía pegar una clave ella sola y el sync le
      // desharía los precios que acababa de poner.
      const res = await app.inject({
        method: "POST",
        url: "/auth/me/rotate-holded-key",
        headers: ownerAuth(sole, ownerSole),
        payload: { apiKey: "clave-inventada-1234567890" },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("HOLDED_DESCONECTADO");
    });

    it("la salud de Holded deja de pintar la barra roja en el TPV", async () => {
      const h = await getTenantHealthStatus(prisma, sole);
      expect(h.level).toBe("ok");
      expect(h.reason).toBe("no_aplica");
    });

    it("sabotaje nº 9 · relanzarla remata sin duplicar nada", async () => {
      const antes = await prisma.tenant.findUniqueOrThrow({
        where: { id: sole },
        select: { holdedDisconnectedAt: true },
      });
      repeatablesQuitados.length = 0;
      const r = await ejecutarDejarHolded({ prisma, tenantId: sole });
      // `cortado: false` — esta llamada no ha cortado nada, ha rematado.
      expect(r.cortado).toBe(false);
      expect(r.productosConvertidos).toBe(0);
      expect(r.skuAcunados).toEqual([]);
      const despues = await prisma.tenant.findUniqueOrThrow({
        where: { id: sole },
        select: { holdedDisconnectedAt: true },
      });
      // La fecha del corte NO se mueve: es la frontera del abono y del
      // listado del asesor.
      expect(despues.holdedDisconnectedAt).toEqual(antes.holdedDisconnectedAt);
      // Y la parte que SÍ puede haber quedado a medias se vuelve a hacer.
      await vaciarColasDeHolded({ tenantId: sole, log: () => undefined });
      expect(repeatablesQuitados).toContain(sole);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 4 · CRITERIO 1 — ANA EDITA UN PRECIO Y LLEGA AL TPV
  // ══════════════════════════════════════════════════════════════════

  describe("criterio 1 · el servicio se edita y el precio llega al TPV", () => {
    it("antes del corte el PATCH era 403 del gate y 409 de la ficha", async () => {
      // El control. El vecino sigue con Holded: su catálogo manda desde allí
      // y la puerta del alta local está cerrada.
      const r = await app.inject({
        method: "PATCH",
        url: `/catalog/products/${productoVecino}`,
        headers: ownerAuth(vecino, (await prisma.user.findFirstOrThrow({ where: { tenantId: vecino, role: "OWNER" } })).id),
        payload: { basePrice: 99 },
      });
      expect(r.statusCode).toBe(403);
      expect(r.json().error).toBe("LOCAL_CATALOG_DISABLED");
    });

    it("sabotaje nº 1 · Ana cambia el precio y el TPV lo ve", async () => {
      const editar = await app.inject({
        method: "PATCH",
        url: `/catalog/products/${servicioCorte}`,
        headers: ownerAuth(sole, ownerSole),
        payload: { basePrice: 20 },
      });
      expect(editar.statusCode).toBe(200);
      expect(editar.json().product.editable).toBe(true);

      // Y el TPV lo ve, que es lo que Ana quería el 25-09.
      const catalogo = await app.inject({
        method: "GET",
        url: "/tpv/catalog/products",
        headers: cashierAuth(),
      });
      expect(catalogo.statusCode).toBe(200);
      const item = (catalogo.json().items as Array<{ id: string; priceGross: number }>).find(
        (p) => p.id === servicioCorte,
      );
      expect(item).toBeDefined();
      // 20 € de base al 21 % = 24,20 € en la rejilla.
      expect(item!.priceGross).toBeCloseTo(24.2, 2);
    });

    it("y el listado del panel ya no lo marca «De Holded»", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/catalog/products",
        headers: ownerAuth(sole, ownerSole),
      });
      expect(r.statusCode).toBe(200);
      const items = r.json().items as Array<{ source: string; editable: boolean }>;
      expect(items).toHaveLength(2);
      expect(items.every((p) => p.source === "LOCAL")).toBe(true);
      expect(items.every((p) => p.editable)).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 5 · DESPUÉS DEL CORTE: COBRAR Y DEVOLVER
  // ══════════════════════════════════════════════════════════════════

  describe("cobrar después del corte", () => {
    let externalDespues = "";
    let ticketDespues = "";

    it("nace PAID, no se encola y no crea fila de subida", async () => {
      encoladosTicket.length = 0;
      const shiftId = await abrirTurno(cashierSole, registerSole);
      externalDespues = randomUUID();
      const r = await app.inject({
        method: "POST",
        url: "/tickets",
        headers: cashierAuth(),
        payload: {
          externalId: externalDespues,
          registerId: registerSole,
          shiftId,
          lines: [
            {
              productId: servicioCorte,
              nameSnapshot: "Corte de pelo",
              sku: "AUTO-6819b3c3",
              units: 1,
              unitPrice: 20,
              discountPct: 0,
              taxRate: 21,
            },
          ],
          payments: [{ method: "CASH", amount: 24.2 }],
        },
      });
      expect(r.statusCode).toBe(201);
      ticketDespues = r.json().ticket.id as string;
      const t = await prisma.ticket.findUniqueOrThrow({
        where: { id: ticketDespues },
        select: { status: true },
      });
      expect(t.status).toBe("PAID");
      expect(encoladosTicket).toEqual([]);
      const subida = await prisma.holdedUpload.findUnique({
        where: { externalId: externalDespues },
      });
      expect(subida).toBeNull();
    });

    it("el TRIGGER hace que una subida forzada nazca SKIPPED", async () => {
      // La segunda puerta. Si alguien añadiera un quinto camino de cobro y
      // se olvidara del gate —ya pasó: `catalogo-local` encontró que mesa y
      // devolución no pasaban por él—, la fila existiría pero no subiría
      // nunca. Y NO lanza: `holded_uploads` se escribe dentro de la
      // transacción que cobra, y una invariante nuestra no tumba una venta.
      const forzado = randomUUID();
      await prisma.holdedUpload.create({
        data: { externalId: forzado, tenantId: sole, kind: "TICKET", status: "PENDING" },
      });
      const fila = await prisma.holdedUpload.findUniqueOrThrow({
        where: { externalId: forzado },
      });
      expect(fila.status).toBe("SKIPPED");
      expect(JSON.stringify(fila.lastError)).toContain("holded_desconectado");
    });

    it("y el vecino sigue naciendo PENDING para subir (control del trigger)", async () => {
      const forzado = randomUUID();
      await prisma.holdedUpload.create({
        data: { externalId: forzado, tenantId: vecino, kind: "TICKET", status: "PENDING" },
      });
      const fila = await prisma.holdedUpload.findUniqueOrThrow({
        where: { externalId: forzado },
      });
      expect(fila.status).toBe("PENDING");
    });

    it("sabotaje nº 7 · devolver un ticket ANTERIOR al corte: sin subida y con el dinero fuera", async () => {
      encoladosRefund.length = 0;
      const linea = await prisma.ticketLine.findFirstOrThrow({
        where: { ticketId: ticketAntesDelCorte },
        select: { id: true },
      });
      const externalAbono = randomUUID();
      const r = await app.inject({
        method: "POST",
        url: "/refunds",
        headers: cashierAuth(),
        payload: {
          externalId: externalAbono,
          originalTicketId: ticketAntesDelCorte,
          lines: [{ ticketLineId: linea.id, units: 1 }],
          method: "CASH",
        },
      });
      // Ni 500 ni 409: el ticket es SYNCED y sigue siendo devolvible.
      expect(r.statusCode).toBe(201);
      const abono = await prisma.refund.findUniqueOrThrow({
        where: { externalId: externalAbono },
        select: { status: true, total: true, method: true, shiftId: true },
      });
      // PAID y no PENDING_SYNC: no hay nada esperando a subir. Y nunca
      // SYNC_FAILED, que es lo que pasaría sin el gate.
      expect(abono.status).toBe("PAID");
      // El dinero sale del cajón: método y turno puestos, que es lo que el
      // arqueo lee.
      expect(abono.method).toBe("CASH");
      expect(abono.shiftId).not.toBeNull();
      expect(Number(abono.total)).toBeCloseTo(18.5, 2);
      // Y NO se encola ni se crea fila de subida.
      expect(encoladosRefund).toEqual([]);
      expect(
        await prisma.holdedUpload.findUnique({ where: { externalId: externalAbono } }),
      ).toBeNull();
    });

    it("devolver un ticket POSTERIOR al corte tampoco se cae", async () => {
      const linea = await prisma.ticketLine.findFirstOrThrow({
        where: { ticketId: ticketDespues },
        select: { id: true },
      });
      const r = await app.inject({
        method: "POST",
        url: "/refunds",
        headers: cashierAuth(),
        payload: {
          externalId: randomUUID(),
          originalTicketId: ticketDespues,
          lines: [{ ticketLineId: linea.id, units: 1 }],
          method: "CASH",
        },
      });
      // El ticket está en PAID, que `POST /refunds` acepta. La
      // rectificativa es V3 y no existe: el abono sale sin documento
      // fiscal, y eso es lo que el listado del asesor recoge.
      expect(r.statusCode).toBe(201);
    });

    it("el listado del asesor separa los dos casos", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/admin/devoluciones/para-el-asesor",
        headers: ownerAuth(sole, ownerSole),
      });
      expect(r.statusCode).toBe(200);
      const body = r.json();
      expect(body.aplica).toBe(true);
      expect(body.devoluciones).toHaveLength(2);
      const origenes = (body.devoluciones as Array<{ origen: string }>)
        .map((d) => d.origen)
        .sort();
      // Uno de una factura de Holded (el de antes del corte) y uno de una
      // venta nuestra. Ésta se cobró desde la suite sin `fiscalRecord`, así
      // que sale como `sin_registro`: es el tercer caso, el del terminal con
      // APK vieja, y el asesor tiene que verlo COMO LO QUE ES.
      expect(origenes).toEqual(["holded", "sin_registro"]);
      const deHolded = (body.devoluciones as Array<{ origen: string; ticket: { holdedDocNumber: string } }>)
        .find((d) => d.origen === "holded")!;
      expect(deHolded.ticket.holdedDocNumber).toBe("SR-000123");
      expect(body.resumen.holded).toBe(1);
    });

    it("...y devuelve vacío en un comercio que no dejó Holded", async () => {
      const ownerVecino = await prisma.user.findFirstOrThrow({
        where: { tenantId: vecino, role: "OWNER" },
        select: { id: true },
      });
      const r = await app.inject({
        method: "GET",
        url: "/admin/devoluciones/para-el-asesor",
        headers: ownerAuth(vecino, ownerVecino.id),
      });
      expect(r.statusCode).toBe(200);
      expect(r.json().aplica).toBe(false);
      expect(r.json().devoluciones).toEqual([]);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 6 · LAS RUTAS QUE HABLABAN CON HOLDED
  // ══════════════════════════════════════════════════════════════════

  describe("criterio 3 · las rutas se callan con el motivo puesto", () => {
    it("POST /catalog/sync-now contesta 409 HOLDED_DESCONECTADO", async () => {
      const r = await app.inject({
        method: "POST",
        url: "/catalog/sync-now",
        headers: ownerAuth(sole, ownerSole),
        payload: {},
      });
      expect(r.statusCode).toBe(409);
      expect(r.json().error).toBe("HOLDED_DESCONECTADO");
      // Y NO el «conecta tu cuenta de Holded» de antes, que en este
      // comercio es una invitación a deshacer el corte.
      expect(r.json().message).not.toContain("Conecta");
    });

    it("la revisión de SKU también, que escribe EN Holded", async () => {
      const r = await app.inject({
        method: "POST",
        url: `/catalog/sku-review/${productoChampu}/assign`,
        headers: ownerAuth(sole, ownerSole),
        payload: { sku: "NUEVO-1" },
      });
      expect(r.statusCode).toBe(409);
      expect(r.json().error).toBe("HOLDED_DESCONECTADO");
    });

    it("y el vecino sigue pudiendo sincronizar (control)", async () => {
      const ownerVecino = await prisma.user.findFirstOrThrow({
        where: { tenantId: vecino, role: "OWNER" },
        select: { id: true },
      });
      const r = await app.inject({
        method: "POST",
        url: "/catalog/sync-now",
        headers: ownerAuth(vecino, ownerVecino.id),
        payload: {},
      });
      expect(r.statusCode).toBe(202);
    });
  });
});
