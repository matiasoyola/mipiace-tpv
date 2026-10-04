// catalogo-en-alta · EL CAMINO DE LA MAESTRANZA, de punta a punta.
//
// Un recorrido, el que nadie había hecho nunca (ver
// `docs/blocks/catalogo-en-alta-plan.md`):
//
//   el super-admin da de alta un bar SIN Holded y CON caja → la
//   activación está bloqueada por DOS cosas, el catálogo vacío y el
//   cajero técnico → se carga la carta real de un fichero (128 productos)
//   → la salud pasa `products-sellable` → «Probar TPV» provisiona el
//   cajero técnico y se hace una venta de ensayo que NO deja registro
//   fiscal → se activa con el email del dueño → el OWNER ve su catálogo
//   con los precios de la carta → y la primera venta real estrena la
//   cadena en `C1/1`.
//
// POR QUÉ TIENE QUE SER e2e y no un banco con un Prisma falso:
//
//   · La salud del onboarding se calcula con ocho consultas agregadas
//     sobre cuatro tablas. Un fake que las conteste dice lo que le
//     digamos.
//   · `products-sellable` depende del índice único parcial del SKU local
//     y de los defaults de la tabla `products`, que viven en el SQL de la
//     migración.
//   · Que la venta de prueba NO emita registro fiscal lo sostiene un
//     trigger de Postgres (verifactu-1b), no la ruta.
//   · Que la primera venta real salga `C1/1` lo decide el trigger que
//     reparte las series (`mipiacetpv_registers_fiscal_identity_default`).
//   · Y la activación purga los datos de prueba con un borrado en
//     cascada de verdad.
//
// Los 128 productos salen del fichero REAL de implantación. Si alguien
// corrige un precio de la carta, este test sigue siendo verdad.

import { readFileSync } from "node:fs";
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
process.env.PUBLIC_ADMIN_URL = "https://admin.mipiacetpv.com";

// Lo que importa es QUÉ se encola, no que BullMQ funcione.
const encoladoSubida: string[] = [];
vi.mock("../src/queues/ticket-upload.js", () => ({
  enqueueTicketUpload: async (externalId: string) => {
    encoladoSubida.push(externalId);
  },
}));
vi.mock("../src/queues/refund-upload.js", () => ({
  enqueueRefundUpload: async () => undefined,
}));
vi.mock("../src/queues/ticket-email.js", () => ({
  enqueueTicketEmail: async () => undefined,
}));
vi.mock("../src/queues/initial-sync.js", () => ({
  enqueueInitialSync: async () => undefined,
}));
vi.mock("../src/queues/catalog-incremental.js", () => ({
  enqueueManualSync: async () => ({ jobId: "manual-1" }),
  registerTenantRepeatable: async () => undefined,
}));
const emails: Array<{ to: string; subject: string }> = [];
vi.mock("../src/email/sender.js", () => ({
  getEmailSender: () => ({
    send: async (msg: { to: string; subject: string }) => {
      emails.push(msg);
    },
  }),
}));

import {
  buildRegistroAlta,
  type CabezaDeCadena,
  descripcionOperacionPorVertical,
  formatNumSerieFactura,
} from "@mipiacetpv/verifactu";

const { getPrisma, shutdown } = await import("../src/context.js");
const { registerSuperAdminTenantsRoutes } = await import("../src/superadmin/tenants.js");
const { registerSuperAdminTenantCatalogRoutes } = await import(
  "../src/superadmin/tenant-catalog.js"
);
const { registerLocalCatalogRoutes } = await import("../src/catalog/local-products.js");
const { registerTpvCatalogRoutes } = await import("../src/tpv-catalog/routes.js");
const { registerShiftRoutes } = await import("../src/shift/routes.js");
const { registerTicketRoutes } = await import("../src/tickets/routes.js");
const { registerFiscalRoutes } = await import("../src/fiscal/routes.js");
const { registerErrorHandler } = await import("../src/lib/error-handler.js");
const { registerLenientJsonParser } = await import("../src/lib/lenient-json.js");
const { hashPassword } = await import("../src/auth/passwords.js");
const { signAccessToken } = await import("../src/auth/tokens.js");
const { signCashierSession } = await import("../src/shift/cashier-session.js");
const { computeOnboardingHealth } = await import("../src/superadmin/onboarding-health.js");
const jwtLib = (await import("jsonwebtoken")).default;

const CSV = readFileSync(
  new URL("../../../docs/implantaciones/maestranza/catalogo-tpv.csv", import.meta.url),
  "utf8",
);
const RAZON = "Bar La Maestranza SL";
// El NIF es único por tenant en la base, y esta suite corre los 22
// ficheros contra la MISMA base: `B45902186` es el de Peluquería Sole en
// `verifactu-modo-prueba.e2e.ts`, así que el alta de aquí respondía 409
// y los 19 tests de este fichero caían en cascada con un `tenantId`
// vacío. Pasó exactamente así la primera vez que se corrió la suite
// entera.
const NIF = "B12345674";

describe.skipIf(!e2eEnabled)("e2e · un bar nuevo sin Holded llega a cobrar", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let app: FastifyInstance;
  let superAdminId = "";
  let tenantId = "";
  let ownerId = "";
  let registerId = "";
  let tokenPrueba = "";
  let shiftPrueba = "";

  const saAuth = () => ({
    authorization: `Bearer ${jwtLib.sign(
      { sub: superAdminId, purpose: "super-admin", tv: 0, type: "access" },
      process.env.SUPER_ADMIN_JWT_SECRET!,
      { expiresIn: "1h" },
    )}`,
  });
  const ownerAuth = () => ({
    authorization: `Bearer ${signAccessToken({ sub: ownerId, tid: tenantId, role: "OWNER" })}`,
  });

  async function salud() {
    return computeOnboardingHealth(prisma, tenantId);
  }

  function check(h: Awaited<ReturnType<typeof salud>>, id: string) {
    return h.readinessChecks.find((c) => c.id === id)!;
  }

  beforeAll(async () => {
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    registerLenientJsonParser(app);
    await registerSuperAdminTenantsRoutes(app);
    await registerSuperAdminTenantCatalogRoutes(app);
    await registerLocalCatalogRoutes(app);
    await registerTpvCatalogRoutes(app);
    await registerShiftRoutes(app);
    await registerTicketRoutes(app);
    await registerFiscalRoutes(app);
    await app.ready();

    superAdminId = randomUUID();
    await prisma.superAdminUser.create({
      data: {
        id: superAdminId,
        email: `catalogo-en-alta-${superAdminId.slice(0, 8)}@mipiacetpv.tech`,
        passwordHash: await hashPassword("Irrelevante1!"),
      },
    });
  });

  afterAll(async () => {
    // El tenant NO se borra, y es a propósito: `shifts.user_id` tiene FK
    // RESTRICT contra `users`, así que un `DELETE FROM tenants` revienta
    // en cuanto el recorrido ha abierto un turno — y éste abre dos. La
    // suite hace `DROP SCHEMA public CASCADE` antes de migrar
    // (`global-setup.ts`), así que la base queda limpia de todas formas y
    // borrar a mano aquí sólo añade una forma nueva de fallar.
    await app?.close();
    await shutdown();
  });

  // ── 1 · el alta ─────────────────────────────────────────────────────

  describe("1 · el alta del bar, sin Holded y con caja", () => {
    it("se crea en DRAFT, sin tocar la red y sin sync que esperar", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/super-admin/tenants",
        headers: saAuth(),
        payload: {
          legalName: RAZON,
          taxId: NIF,
          businessType: "HOSPITALITY",
          cajaEnabled: true,
          crmEnabled: false,
          agendaEnabled: false,
          // Lo que hace de éste el comercio del bloque.
          holdedEnabled: false,
        } as never,
      });
      expect(res.statusCode).toBe(201);
      tenantId = res.json().tenant.id;
      expect(res.json().tenant.onboardingState).toBe("DRAFT");
      expect(res.json().tenant.initialSyncStatus).toBe("NOT_APPLICABLE");
    });

    it("en DRAFT no hay OWNER, así que el catálogo no tiene por dónde entrar", async () => {
      // El primer eslabón del bucle del paso 0: la ruta del catálogo pide
      // OWNER o MANAGER y en DRAFT no existe ninguno de los dos.
      const usuarios = await prisma.user.count({ where: { tenantId } });
      expect(usuarios).toBe(0);
    });
  });

  // ── 2 · la activación está bloqueada por DOS cosas ──────────────────

  describe("2 · lo que bloquea la activación", () => {
    it("son dos checks, no uno: el catálogo vacío y el cajero técnico", async () => {
      const h = await salud();
      expect(h.ready).toBe(false);
      expect(check(h, "products-sellable")).toMatchObject({ applies: true, ok: false });
      expect(check(h, "test-cashier-provisioned")).toMatchObject({ applies: true, ok: false });
      // Y lo que NO le aplica: sin Holded, el sync y los impuestos del ERP
      // no son asunto suyo (H1 + catalogo-local addendum 3).
      expect(check(h, "sync-done").applies).toBe(false);
      expect(check(h, "taxes-ratio").applies).toBe(false);
    });

    it("activar responde 400 nombrando los dos", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/super-admin/tenants/${tenantId}/activate`,
        headers: saAuth(),
        payload: { ownerEmail: `dueno+${randomUUID()}@maestranza.e2e`, ownerName: "El dueño" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("ONBOARDING_NOT_READY");
      const fallan = res.json().failing as string[];
      expect(fallan.some((f) => f.includes("productos sellable"))).toBe(true);
      expect(fallan.some((f) => f.includes("Cajero técnico"))).toBe(true);
      // Y sigue en DRAFT: una activación que falla no deja medio tenant.
      const t = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      expect(t.onboardingState).toBe("DRAFT");
    });

    it("el re-sync, que el código sugiere como salida, no existe sin Holded", async () => {
      // Es la salida que propone el comentario de
      // `workers/initial-sync-worker.ts` para reaprovisionar el cajero
      // técnico a mano. En este comercio contesta 409.
      const res = await app.inject({
        method: "POST",
        url: `/super-admin/tenants/${tenantId}/resync`,
        headers: saAuth(),
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("HOLDED_NO_HABILITADO");
    });
  });

  // ── 3 · cargar la carta ─────────────────────────────────────────────

  describe("3 · el catálogo entra de un fichero", () => {
    it("la vista previa lee los 128 y no escribe NADA", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/super-admin/tenants/${tenantId}/catalog/import`,
        headers: saAuth(),
        payload: { csv: CSV },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().escrito).toBe(false);
      expect(res.json().entran).toHaveLength(128);
      expect(res.json().saltadas).toEqual([]);
      // Contra la BD, que es la única que puede desmentirlo.
      expect(await prisma.product.count({ where: { tenantId } })).toBe(0);
    });

    it("al confirmar entran los 128, con el precio de la carta guardado en neto", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/super-admin/tenants/${tenantId}/catalog/import`,
        headers: saAuth(),
        payload: { csv: CSV, confirmar: true },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().escrito).toBe(true);
      expect(await prisma.product.count({ where: { tenantId } })).toBe(128);

      const cafe = await prisma.product.findFirstOrThrow({
        where: { tenantId, sku: "CAF-001" },
      });
      // 1,60 € de la carta → 1,4545 netos. Es la cifra que el trigger de
      // la columna `Decimal(12,4)` tiene que admitir sin truncar.
      expect(Number(cafe.basePrice)).toBe(1.4545);
      expect(Number(cafe.taxRate)).toBe(10);
      expect(cafe.source).toBe("LOCAL");
      expect(cafe.holdedProductId).toBeNull();
      expect(cafe.sellableViaTpv).toBe(true);
      expect(cafe.tags).toEqual(["cafés"]);
    });

    it("el nombre con comas del fichero entra entero", async () => {
      // `CAF-007,"Infusión (manzanilla, poleo, tila…)",1.60,10,cafés`
      const inf = await prisma.product.findFirstOrThrow({
        where: { tenantId, sku: "CAF-007" },
      });
      expect(inf.name).toBe("Infusión (manzanilla, poleo, tila…)");
      expect(Number(inf.basePrice)).toBe(1.4545);
    });

    it("cargar el mismo fichero otra vez no duplica ni pisa precios", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/super-admin/tenants/${tenantId}/catalog/import`,
        headers: saAuth(),
        payload: { csv: CSV, confirmar: true },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("NADA_QUE_CARGAR");
      expect(await prisma.product.count({ where: { tenantId } })).toBe(128);
    });

    it("y la salud ya pasa products-sellable", async () => {
      const h = await salud();
      expect(check(h, "products-sellable")).toMatchObject({ ok: true, value: "128/128 (100%)" });
      // Pero todavía NO está lista: queda el cajero técnico.
      expect(h.ready).toBe(false);
      expect(check(h, "test-cashier-provisioned").ok).toBe(false);
    });
  });

  // ── 4 · el ensayo, sin facturas ─────────────────────────────────────

  describe("4 · «Probar TPV» y una venta de ensayo", () => {
    it("provisiona tienda, caja y cajero técnico a demanda", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/super-admin/tenants/${tenantId}/test-cashier-token`,
        headers: saAuth(),
      });
      expect(res.statusCode).toBe(200);
      tokenPrueba = res.json().cashierSessionToken;
      shiftPrueba = res.json().shiftId;
      expect(shiftPrueba).toBeTruthy();

      const stores = await prisma.store.findMany({ where: { tenantId } });
      expect(stores).toHaveLength(1);
      const registers = await prisma.register.findMany({
        where: { storeId: stores[0]!.id },
        select: { id: true, fiscalSeries: true },
      });
      expect(registers).toHaveLength(1);
      registerId = registers[0]!.id;
      // El trigger de la migración le ha dado la primera serie libre.
      expect(registers[0]!.fiscalSeries).toBe("C1");

      // El dispositivo del modo prueba NO es un terminal de caja
      // (verifactu-1b): de eso depende que la venta de ensayo no emita.
      const devices = await prisma.device.findMany({ where: { tenantId } });
      expect(devices).toHaveLength(1);
      expect(devices[0]!.kind).toBe("TEST");
    });

    it("con eso la salud queda lista: la activación ya es posible", async () => {
      const h = await salud();
      expect(check(h, "test-cashier-provisioned").ok).toBe(true);
      expect(h.ready).toBe(true);
    });

    it("el TPV de prueba ve la carta con los precios de la carta", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/tpv/catalog/products?limit=200",
        headers: { authorization: `Bearer ${tokenPrueba}` },
      });
      expect(res.statusCode).toBe(200);
      const items = res.json().items as Array<{
        sku: string;
        basePrice: number;
        priceGross: number;
      }>;
      expect(items).toHaveLength(128);
      const cafe = items.find((i) => i.sku === "CAF-001")!;
      // LO QUE VE EL CAMARERO: 1,60 €, el de la carta. Guardado 1,4545.
      expect(cafe.priceGross).toBe(1.6);
      expect(cafe.basePrice).toBe(1.4545);
    });

    it("una venta de ensayo cobra 1,60 € y NO deja registro fiscal", async () => {
      // El turno ya está abierto: `issueTestCashierSession` lo abre con
      // `cashOpening = 0` para que el TPV arranque directo en la rejilla,
      // y devuelve su id. Pedir `/shift/open` aquí sería un 409 —y es lo
      // que hizo este test la primera vez que corrió—.
      const shiftId = shiftPrueba;

      const cafe = await prisma.product.findFirstOrThrow({
        where: { tenantId, sku: "CAF-001" },
      });
      const externalId = randomUUID();
      const venta = await app.inject({
        method: "POST",
        url: "/tickets",
        headers: { authorization: `Bearer ${tokenPrueba}` },
        payload: {
          externalId,
          registerId,
          shiftId,
          lines: [
            {
              productId: cafe.id,
              nameSnapshot: cafe.name,
              sku: cafe.sku,
              units: 1,
              unitPrice: Number(cafe.basePrice),
              discountPct: 0,
              taxRate: 10,
            },
          ],
          payments: [{ method: "CASH", amount: 1.6 }],
        },
      });
      expect(venta.statusCode).toBe(201);

      const t = await prisma.ticket.findUniqueOrThrow({ where: { externalId } });
      // El precio de la carta, cobrado al céntimo desde el neto guardado.
      expect(Number(t.total)).toBe(1.6);
      expect(t.status).toBe("TEST");
      // verifactu-1b · ni una fila en la cadena, y la serie sin estrenar.
      expect(await prisma.fiscalRecord.count({ where: { registerId } })).toBe(0);
      // Y nada que subir a ningún sitio.
      expect(encoladoSubida).toHaveLength(0);
    });
  });

  // ── 5 · activar ─────────────────────────────────────────────────────

  describe("5 · la activación, con el dueño delante", () => {
    it("crea el OWNER, pasa a ACTIVE y purga el ensayo", async () => {
      const email = `dueno+${randomUUID()}@maestranza.e2e`;
      const res = await app.inject({
        method: "POST",
        url: `/super-admin/tenants/${tenantId}/activate`,
        headers: saAuth(),
        payload: { ownerEmail: email, ownerName: "El dueño" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().tenant.onboardingState).toBe("ACTIVE");
      // Con caja, el OWNER nace también como cajero (H1).
      expect(res.json().cashierPinIssued).toBe(true);
      ownerId = res.json().owner.id;

      // El ensayo se va: los tickets de prueba purgados y el cajero
      // técnico dado de baja.
      expect(res.json().purge.ticketsTestPurged).toBe(1);
      expect(await prisma.ticket.count({ where: { registerId, status: "TEST" } })).toBe(0);
      // Y el catálogo se queda: es el del comercio, no del ensayo.
      expect(await prisma.product.count({ where: { tenantId } })).toBe(128);
    });

    it("el OWNER ve su catálogo con los precios de la carta", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/catalog/products?pageSize=200",
        headers: ownerAuth(),
      });
      expect(res.statusCode).toBe(200);
      const items = res.json().items as Array<{
        sku: string;
        basePrice: number;
        priceGross: number;
        editable: boolean;
      }>;
      expect(res.json().total).toBe(128);
      const cafe = items.find((i) => i.sku === "CAF-001")!;
      expect(cafe.priceGross).toBe(1.6);
      expect(cafe.basePrice).toBe(1.4545);
      // Su catálogo es suyo: puede editarlo (no tiene Holded).
      expect(cafe.editable).toBe(true);
    });

    it("y puede corregir un precio en euros de la carta, ida y vuelta", async () => {
      const cafe = await prisma.product.findFirstOrThrow({
        where: { tenantId, sku: "CAF-001" },
      });
      const res = await app.inject({
        method: "PATCH",
        url: `/catalog/products/${cafe.id}`,
        headers: ownerAuth(),
        // Sube el café a 1,70 €. Manda el precio CON IVA, como la
        // pantalla.
        payload: { priceGross: 1.7 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().product.priceGross).toBe(1.7);
      const despues = await prisma.product.findUniqueOrThrow({ where: { id: cafe.id } });
      // 1,70 / 1,10 = 1,5455 netos. El IVA NO venía en la petición: se ha
      // usado el de la ficha.
      expect(Number(despues.basePrice)).toBe(1.5455);
      expect(Number(despues.taxRate)).toBe(10);
      // Se deja como estaba para el resto del recorrido.
      await prisma.product.update({
        where: { id: cafe.id },
        data: { basePrice: cafe.basePrice },
      });
    });
  });

  // ── 6 · la primera venta real ───────────────────────────────────────

  describe("6 · la primera venta real estrena la cadena en C1/1", () => {
    it("el ticket lleva registro fiscal C1/1 y la cadena arranca", async () => {
      // El terminal de verdad del bar y un cajero de verdad: lo que el
      // implantador empareja en la visita.
      const terminal = await prisma.device.create({
        data: {
          tenantId,
          registerId,
          deviceTokenHash: randomUUID(),
          name: "AP12 barra",
        },
        select: { id: true, kind: true },
      });
      expect(terminal.kind).toBe("TERMINAL");

      const camarero = await prisma.user.create({
        data: {
          tenantId,
          email: `camarero+${randomUUID()}@maestranza.e2e`,
          alias: "Luis",
          role: "CASHIER",
        },
        select: { id: true },
      });
      const tokenReal = signCashierSession(
        {
          sub: camarero.id,
          tid: tenantId,
          did: terminal.id,
          rid: registerId,
          role: "CASHIER",
        },
        720,
      );

      const abrir = await app.inject({
        method: "POST",
        url: "/shift/open",
        headers: { authorization: `Bearer ${tokenReal}` },
        payload: { cashOpening: 50 },
      });
      expect(abrir.statusCode).toBe(201);
      const shiftId = abrir.json().shift.id as string;

      // Un café con leche, el primero del bar. El registro de ALTA se
      // construye como lo construye la tablet.
      const cafe = await prisma.product.findFirstOrThrow({
        where: { tenantId, sku: "CAF-001" },
      });
      const neto = Number(cafe.basePrice);
      const total = 1.6;
      const base = Math.round(neto * 100) / 100;
      const cuota = Math.round((total - base) * 100) / 100;
      const ahora = new Date();
      const { registro, huellaInput } = await buildRegistroAlta({
        version: "e2e",
        numeroInstalacion: (
          await prisma.register.findUniqueOrThrow({
            where: { id: registerId },
            select: { fiscalInstallationId: true },
          })
        ).fiscalInstallationId!,
        idEmisorFactura: NIF,
        nombreRazonEmisor: RAZON,
        numSerieFactura: formatNumSerieFactura("C1", 1),
        fechaExpedicion: ahora.toISOString().slice(0, 10),
        descripcionOperacion: descripcionOperacionPorVertical("HOSPITALITY"),
        desglose: [{ tipoImpositivo: 10, baseImponible: base, cuotaRepercutida: cuota }],
        cuotaTotal: cuota,
        importeTotal: total,
        // La cabeza de la cadena es NULL: es el primer registro de este
        // bar. Es exactamente lo que este test existe para comprobar.
        cabeza: null as CabezaDeCadena | null,
        fechaHoraHusoGenRegistro: `${ahora.toISOString().slice(0, 19)}+00:00`,
      });

      const externalId = randomUUID();
      const venta = await app.inject({
        method: "POST",
        url: "/tickets",
        headers: { authorization: `Bearer ${tokenReal}` },
        payload: {
          externalId,
          registerId,
          shiftId,
          lines: [
            {
              productId: cafe.id,
              nameSnapshot: cafe.name,
              sku: cafe.sku,
              units: 1,
              unitPrice: neto,
              discountPct: 0,
              taxRate: 10,
            },
          ],
          payments: [{ method: "CASH", amount: total }],
          fiscalRecord: {
            externalId: randomUUID(),
            kind: "ALTA",
            chainIndex: 1,
            serie: "C1",
            numero: 1,
            generatedAt: ahora.toISOString(),
            huellaInput,
            payload: registro,
          },
        },
      });
      expect(venta.statusCode).toBe(201);
      expect(venta.json().fiscalRecord?.chainStatus).toBe("OK");

      const reg = await prisma.fiscalRecord.findFirstOrThrow({
        where: { registerId },
        orderBy: { chainIndex: "asc" },
      });
      expect(reg.serie).toBe("C1");
      expect(reg.numero).toBe(1);
      expect(reg.chainIndex).toBe(1);
      expect(reg.kind).toBe("ALTA");

      const t = await prisma.ticket.findUniqueOrThrow({ where: { externalId } });
      expect(t.status).not.toBe("TEST");
      expect(Number(t.total)).toBe(1.6);
    });

    it("y lo cobrado no se intenta subir a Holded, que no existe", async () => {
      expect(encoladoSubida).toHaveLength(0);
      expect(await prisma.holdedUpload.count({ where: { tenantId } })).toBe(0);
    });
  });
});
