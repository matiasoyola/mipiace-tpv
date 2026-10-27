// catalogo-servicios-csv · EL CAMINO DE ROSARIO, de punta a punta.
//
// `catalogo-en-alta.e2e.ts` recorre el alta de un BAR sin Holded. Éste
// recorre el alta de una CLÍNICA, que es el caso que el fichero no podía
// cargar:
//
//   el super-admin da de alta una clínica SIN Holded, con caja, CRM,
//   agenda e historia clínica → vista previa del CSV REAL de Rosario (17
//   servicios) → confirmar → los 17 nacen exentos, `kind = SERVICE` y con
//   su fila de `service_scheduling` → una venta de ensayo de la quiropodia
//   sale EXENTA y sin registro fiscal → se activa → y la dueña ve los 17
//   en el catálogo de agenda, cada uno con su duración.
//
// POR QUÉ TIENE QUE SER e2e y no un banco con un Prisma falso:
//
//   · Que un producto exento NO pueda llevar IVA lo sostiene un CHECK de
//     Postgres (`products_exencion_sin_iva`, bloque iva-exento-sanitario),
//     no la ruta. Un fake acepta lo que le digamos.
//   · Que la línea de ticket exenta tampoco pueda llevarlo lo sostiene
//     otro CHECK (`ticket_lines_exencion_sin_iva`).
//   · La fila de `service_scheduling` tiene la PK = FK al producto y un
//     `channels` jsonb con default en el SQL de la migración. Si el
//     producto y su duración no entraran en la misma transacción, lo que
//     se vería es justo lo que un fake no puede enseñar: 17 productos y 0
//     duraciones.
//   · Que `GET /services/scheduling` devuelva los 17 depende del filtro
//     `kind = SERVICE` sobre la columna real y del join con la extensión.
//   · Que la venta de ensayo NO emita registro fiscal lo sostiene un
//     trigger (verifactu-1b).
//
// Los 17 servicios salen del fichero REAL de implantación. Si Rosario
// corrige un precio o una duración, este test sigue siendo verdad.

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
vi.mock("../src/email/sender.js", () => ({
  getEmailSender: () => ({ send: async () => undefined }),
}));

const { getPrisma, shutdown } = await import("../src/context.js");
const { registerSuperAdminTenantsRoutes } = await import("../src/superadmin/tenants.js");
const { registerSuperAdminTenantCatalogRoutes } = await import(
  "../src/superadmin/tenant-catalog.js"
);
const { registerServicesRoutes } = await import("../src/services/routes.js");
const { registerTpvCatalogRoutes } = await import("../src/tpv-catalog/routes.js");
const { registerTicketRoutes } = await import("../src/tickets/routes.js");
const { registerErrorHandler } = await import("../src/lib/error-handler.js");
const { registerLenientJsonParser } = await import("../src/lib/lenient-json.js");
const { hashPassword } = await import("../src/auth/passwords.js");
const { signAccessToken } = await import("../src/auth/tokens.js");
const { SCHEDULING_DEFAULTS } = await import("../src/services/scheduling-rules.js");
const { computeOnboardingHealth } = await import("../src/superadmin/onboarding-health.js");
const jwtLib = (await import("jsonwebtoken")).default;

const CSV = readFileSync(
  new URL("../../../docs/implantaciones/rosario/catalogo-tpv.csv", import.meta.url),
  "utf8",
);
const RAZON = "Clínica de Podología Rosario SL";
// El NIF es único por tenant y esta suite corre todos los ficheros contra
// la MISMA base, así que éste no puede repetir ninguno de los de los
// demás ficheros (ver el comentario equivalente en `catalogo-en-alta`).
const NIF = "B90000001";

describe.skipIf(!e2eEnabled)("e2e · una clínica carga sus 17 servicios del fichero", () => {
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

  beforeAll(async () => {
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    registerLenientJsonParser(app);
    await registerSuperAdminTenantsRoutes(app);
    await registerSuperAdminTenantCatalogRoutes(app);
    await registerServicesRoutes(app);
    await registerTpvCatalogRoutes(app);
    await registerTicketRoutes(app);
    await app.ready();

    superAdminId = randomUUID();
    await prisma.superAdminUser.create({
      data: {
        id: superAdminId,
        email: `catalogo-servicios-${superAdminId.slice(0, 8)}@mipiacetpv.tech`,
        passwordHash: await hashPassword("Irrelevante1!"),
      },
    });
  });

  afterAll(async () => {
    // El tenant NO se borra, por la misma razón que en
    // `catalogo-en-alta.e2e.ts`: `shifts.user_id` tiene FK RESTRICT y la
    // suite hace `DROP SCHEMA public CASCADE` antes de migrar.
    await app?.close();
    await shutdown();
  });

  // ── 1 · el alta de la clínica ───────────────────────────────────────

  describe("1 · la clínica se da de alta en DRAFT, sin Holded", () => {
    it("nace con caja, CRM y agenda, y sin sync que esperar", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/super-admin/tenants",
        headers: saAuth(),
        payload: {
          legalName: RAZON,
          taxId: NIF,
          businessType: "SERVICES",
          cajaEnabled: true,
          // La historia clínica cuelga del paciente (CRM) y el acceso nace
          // de la cita (agenda): los dos hacen falta para encenderla.
          crmEnabled: true,
          agendaEnabled: true,
          holdedEnabled: false,
        } as never,
      });
      expect(res.statusCode).toBe(201);
      tenantId = res.json().tenant.id;
      expect(res.json().tenant.onboardingState).toBe("DRAFT");
      expect(res.json().tenant.initialSyncStatus).toBe("NOT_APPLICABLE");
    });

    it("SIN la clínica encendida, su CSV se salta las 17 filas", async () => {
      // EL CÍRCULO, por el lado de la API. Un `E1` en un comercio sin
      // `clinicalRecordsEnabled` es una fila saltada con su motivo, así
      // que el catálogo de Rosario entero se queda fuera: sin catálogo no
      // se pasa `products-sellable` y la cuenta no se activa.
      //
      // Y el otro lado del círculo estaba en la pantalla: el interruptor
      // «Historia clínica» sólo se pintaba fuera de DRAFT, así que había
      // que activar para poder encenderlo y había que encenderlo para
      // poder activar. Lo rompe `DatosDeSaludPanel`, que se pinta en los
      // dos estados (banco: `admin/test/catalogo-servicios-csv-salud-en-draft`).
      const t = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      expect(t.clinicalRecordsEnabled).toBe(false);

      const res = await app.inject({
        method: "POST",
        url: `/super-admin/tenants/${tenantId}/catalog/import`,
        headers: saAuth(),
        payload: { csv: CSV },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().entran).toEqual([]);
      expect(res.json().saltadas).toHaveLength(17);
      expect(res.json().saltadas[0].motivo).toContain("no tiene la clínica encendida");
    });

    it("y el PATCH la enciende ESTANDO EN DRAFT, que es lo que rompe el círculo", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/super-admin/tenants/${tenantId}`,
        headers: saAuth(),
        payload: { clinicalRecordsEnabled: true },
      });
      expect(res.statusCode).toBe(200);
      const t = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      expect(t.clinicalRecordsEnabled).toBe(true);
      // LO QUE IMPORTA: la cuenta sigue en DRAFT. No ha hecho falta
      // activarla para encender la clínica, que es el orden que el alta de
      // una clínica necesita.
      expect(t.onboardingState).toBe("DRAFT");
    });

    it("la clínica exige CRM y agenda, también en DRAFT", async () => {
      // La guarda del servidor sigue siendo la de siempre: encenderla en
      // DRAFT no la relaja. Se prueba sobre OTRO tenant para no tocar el
      // del recorrido.
      const otro = await app.inject({
        method: "POST",
        url: "/super-admin/tenants",
        headers: saAuth(),
        payload: {
          legalName: "Bar sin agenda SL",
          businessType: "HOSPITALITY",
          cajaEnabled: true,
          crmEnabled: false,
          agendaEnabled: false,
          holdedEnabled: false,
        } as never,
      });
      expect(otro.statusCode).toBe(201);
      const res = await app.inject({
        method: "PATCH",
        url: `/super-admin/tenants/${otro.json().tenant.id}`,
        headers: saAuth(),
        payload: { clinicalRecordsEnabled: true },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("CLINICAL_RECORDS_NEEDS_MODULES");
    });

    it("en DRAFT no hay OWNER: el fichero es la ÚNICA puerta del catálogo", async () => {
      // El bucle del bloque anterior, con una vuelta más: aquí no sólo
      // hace falta crear 17 productos, hace falta que nazcan exentos y con
      // duración. Sin OWNER no hay panel donde ponérselas.
      expect(await prisma.user.count({ where: { tenantId } })).toBe(0);
    });
  });

  // ── 2 · la vista previa ─────────────────────────────────────────────

  describe("2 · la vista previa del fichero real de Rosario", () => {
    it("lee los 17 y no escribe NADA", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/super-admin/tenants/${tenantId}/catalog/import`,
        headers: saAuth(),
        payload: { csv: CSV },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().escrito).toBe(false);
      expect(res.json().entran).toHaveLength(17);
      expect(res.json().saltadas).toEqual([]);
      // Contra la BD, que es la única que puede desmentirlo.
      expect(await prisma.product.count({ where: { tenantId } })).toBe(0);
      expect(await prisma.serviceScheduling.count({ where: { tenantId } })).toBe(0);
    });

    it("y enseña lo que Rosario tiene que revisar: tipo, duración y exención", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/super-admin/tenants/${tenantId}/catalog/import`,
        headers: saAuth(),
        payload: { csv: CSV },
      });
      const entran = res.json().entran as Array<{
        sku: string;
        tipo: string;
        duracionMin: number | null;
        exencion: string | null;
        exencionEtiqueta: string | null;
        precioConIva: number;
        precioSinIva: number;
      }>;
      expect(entran.every((e) => e.tipo === "SERVICE")).toBe(true);
      expect(entran.every((e) => e.exencionEtiqueta === "Exento · sanitario")).toBe(true);
      const quiropodia = entran.find((e) => e.sku === "POD-002")!;
      expect(quiropodia.duracionMin).toBe(30);
      // Decisión 6 del bloque: el precio de un exento es lo que paga la
      // paciente. El de la carta y el que se guarda son el mismo número.
      expect(quiropodia.precioConIva).toBe(25);
      expect(quiropodia.precioSinIva).toBe(25);
      // La cirugía de dos bordes son 3 horas de agenda.
      expect(entran.find((e) => e.sku === "POD-016")!.duracionMin).toBe(180);
    });
  });

  // ── 3 · confirmar ──────────────────────────────────────────────────

  describe("3 · al confirmar entran los 17, exentos y con su duración", () => {
    it("17 productos y 17 filas de agenda, de una pasada", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/super-admin/tenants/${tenantId}/catalog/import`,
        headers: saAuth(),
        payload: { csv: CSV, confirmar: true },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().escrito).toBe(true);
      expect(await prisma.product.count({ where: { tenantId } })).toBe(17);
      // LA promesa del bloque: ni un servicio sin duración.
      expect(await prisma.serviceScheduling.count({ where: { tenantId } })).toBe(17);
    });

    it("cada uno nace kind = SERVICE y EXENTO, no sujeto al 0 %", async () => {
      const productos = await prisma.product.findMany({
        where: { tenantId },
        select: { sku: true, kind: true, taxRate: true, exemptionCause: true, source: true },
      });
      expect(productos).toHaveLength(17);
      for (const p of productos) {
        expect(p.kind).toBe("SERVICE");
        // Los dos valen cero euros de cuota y son DOS operaciones
        // distintas ante la AEAT: un `null` aquí sería un 0 % sujeto.
        expect(p.exemptionCause).toBe("E1");
        expect(Number(p.taxRate)).toBe(0);
        expect(p.source).toBe("LOCAL");
      }
    });

    it("la quiropodia básica son 25 € enteros y 30 minutos de agenda", async () => {
      const q = await prisma.product.findFirstOrThrow({
        where: { tenantId, sku: "POD-002" },
        include: { scheduling: true },
      });
      expect(q.name).toBe("Quiropodia básica");
      // Con IVA 0 la conversión bruto→neto divide por 1: el número que
      // Rosario tiene en su hoja es el que está en la columna.
      expect(Number(q.basePrice)).toBe(25);
      expect(q.scheduling).not.toBeNull();
      expect(q.scheduling!.durationMin).toBe(30);
      // La familia de agenda es la primera categoría de la fila.
      expect(q.scheduling!.family).toBe("quiropodia");
    });

    it("y la fila de agenda nace con los defaults del PUT del panel", async () => {
      const q = await prisma.product.findFirstOrThrow({
        where: { tenantId, sku: "POD-002" },
        include: { scheduling: true },
      });
      const s = q.scheduling!;
      expect(s.bufferBeforeMin).toBe(SCHEDULING_DEFAULTS.bufferBeforeMin);
      expect(s.bufferAfterMin).toBe(SCHEDULING_DEFAULTS.bufferAfterMin);
      expect(s.staffRequired).toBe(SCHEDULING_DEFAULTS.staffRequired);
      expect(s.onlineBookable).toBe(SCHEDULING_DEFAULTS.onlineBookable);
      // El jsonb, leído de Postgres y no del objeto que mandamos.
      expect(s.channels).toMatchObject({
        caja: true,
        ticket: true,
        agenda: true,
        online: false,
      });
      // clinica-8 · LAS MARCAS DE CLÍNICA YA ENTRAN POR EL FICHERO.
      //
      // Este bloque las dejó fuera a propósito («nacen en su default y se
      // ponen en el panel»), y la auditoría del 18-10 midió lo que eso
      // significa en el hierro: los 17 servicios cargados, el TPV
      // enseñándolos, y la primera sesión cerrando a 0,00 € con «no hay
      // servicio en su categoría». El catálogo estaba; la clínica no podía
      // cobrar. El fichero de Rosario trae ya las cuatro columnas.
      expect(s.tratamientoSesion).toBe(true);
      expect(s.nivelQuiropodia).toBe(1);
      // La primera valoración es la consulta de diagnóstico, no ésta.
      expect(s.primeraValoracion).toBe(false);
      // Los consentimientos SIGUEN fuera del fichero: se ponen en el panel
      // (son ids de plantilla de clinica-4).
      expect(s.consentimientos).toEqual([]);
    });

    it("clinica-8 · y las cinco categorías quedan con su tipo de visita", async () => {
      // Sin estas filas ningún servicio tiene tipo y la sesión no ofrece
      // una sola tarjeta: la regla de S5 sobre un catálogo sin configurar.
      const tipos = await prisma.tagVisitType.findMany({
        where: { tenantId },
        select: { slug: true, visitType: true },
        orderBy: { slug: "asc" },
      });
      expect(new Map(tipos.map((t) => [t.slug, t.visitType]))).toEqual(
        new Map([
          ["biomecánica", "BIOMECANICA"],
          ["cirugía", "CIRUGIA"],
          ["consulta", "GENERAL"],
          ["quiropodia", "QUIROPODIA"],
          ["órtesis", "GENERAL"],
        ]),
      );
    });

    it("clinica-8 · los tres niveles de quiropodia, uno por servicio", async () => {
      const niveles = await prisma.serviceScheduling.findMany({
        where: { tenantId, nivelQuiropodia: { not: null } },
        select: { nivelQuiropodia: true, product: { select: { sku: true } } },
        orderBy: { nivelQuiropodia: "asc" },
      });
      expect(niveles.map((n) => [n.product.sku, n.nivelQuiropodia])).toEqual([
        ["POD-002", 1],
        ["POD-003", 2],
        ["POD-004", 3],
      ]);
      // Y el índice único parcial de clinica-5 aguanta: no hay dos.
      expect(niveles).toHaveLength(3);
    });

    it("clinica-8 · y una primera valoración, que es con la que se cita", async () => {
      const primeras = await prisma.serviceScheduling.findMany({
        where: { tenantId, primeraValoracion: true },
        select: { product: { select: { sku: true } } },
      });
      expect(primeras.map((p) => p.product.sku)).toEqual(["POD-001"]);
    });

    it("las cirugías largas caben en la columna: 120 y 180 minutos", async () => {
      const filas = await prisma.serviceScheduling.findMany({
        where: { tenantId },
        select: { durationMin: true, product: { select: { sku: true } } },
      });
      const porSku = new Map(filas.map((f) => [f.product.sku!, f.durationMin]));
      expect(porSku.get("POD-015")).toBe(120);
      expect(porSku.get("POD-016")).toBe(180);
      // Y la más corta, la entrega de órtesis.
      expect(porSku.get("POD-011")).toBe(10);
    });

    it("cargar el mismo fichero otra vez no duplica productos ni duraciones", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/super-admin/tenants/${tenantId}/catalog/import`,
        headers: saAuth(),
        payload: { csv: CSV, confirmar: true },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("NADA_QUE_CARGAR");
      expect(await prisma.product.count({ where: { tenantId } })).toBe(17);
      expect(await prisma.serviceScheduling.count({ where: { tenantId } })).toBe(17);
    });
  });

  // ── 4 · el cobro de ensayo, exento ──────────────────────────────────

  describe("4 · una venta de ensayo de la quiropodia sale EXENTA", () => {
    it("«Probar TPV» provisiona tienda, caja y cajero técnico", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/super-admin/tenants/${tenantId}/test-cashier-token`,
        headers: saAuth(),
      });
      expect(res.statusCode).toBe(200);
      tokenPrueba = res.json().cashierSessionToken;
      shiftPrueba = res.json().shiftId;
      const stores = await prisma.store.findMany({ where: { tenantId } });
      const registers = await prisma.register.findMany({
        where: { storeId: stores[0]!.id },
        select: { id: true },
      });
      registerId = registers[0]!.id;
      expect(registerId).toBeTruthy();
    });

    it("el TPV de prueba ve los 17 servicios al precio que paga la paciente", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/tpv/catalog/products?limit=100",
        headers: { authorization: `Bearer ${tokenPrueba}` },
      });
      expect(res.statusCode).toBe(200);
      const items = res.json().items as Array<{
        sku: string;
        basePrice: number;
        priceGross: number;
        durationMin: number | null;
        primeraValoracion: boolean;
      }>;
      expect(items).toHaveLength(17);
      const q = items.find((i) => i.sku === "POD-002")!;
      // 25 € en la rejilla y 25 € en la columna: con IVA 0 no hay viaje.
      expect(q.priceGross).toBe(25);
      expect(q.basePrice).toBe(25);

      // agenda-1 · Y LA MARCA DE LA PRIMERA VALORACIÓN LLEGA AL TPV.
      //
      // El test de arriba prueba que la marca está en `service_scheduling`
      // (POD-001, la consulta de diagnóstico); éste prueba que SALE por la
      // ruta del catálogo, que es lo único que el terminal ve. Sin ella,
      // «Dar cita» no puede proponerle a una paciente nueva el servicio
      // con el que se empieza, y la única alternativa sería adivinarlo.
      const consulta = items.find((i) => i.sku === "POD-001")!;
      expect(consulta.primeraValoracion).toBe(true);
      expect(consulta.durationMin).toBe(20);
      // Y es UNA, no todas: el resto va en `false`.
      expect(items.filter((i) => i.primeraValoracion).map((i) => i.sku)).toEqual(
        ["POD-001"],
      );
    });

    it("cobra 25,00 € sin IVA, con la línea marcada E1 y sin registro fiscal", async () => {
      const q = await prisma.product.findFirstOrThrow({
        where: { tenantId, sku: "POD-002" },
      });
      const externalId = randomUUID();
      const venta = await app.inject({
        method: "POST",
        url: "/tickets",
        headers: { authorization: `Bearer ${tokenPrueba}` },
        payload: {
          externalId,
          registerId,
          shiftId: shiftPrueba,
          lines: [
            {
              productId: q.id,
              nameSnapshot: q.name,
              sku: q.sku,
              units: 1,
              unitPrice: Number(q.basePrice),
              discountPct: 0,
              taxRate: 0,
              // La causa viaja en la línea: el ticket se cobra con lo que
              // el catálogo decía en ESE momento, no con lo que diga
              // mañana (iva-exento-sanitario).
              exemptionCause: "E1",
            },
          ],
          payments: [{ method: "CARD", amount: 25 }],
        },
      });
      expect(venta.statusCode).toBe(201);

      const t = await prisma.ticket.findUniqueOrThrow({
        where: { externalId },
        include: { lines: true },
      });
      expect(Number(t.total)).toBe(25);
      // EXENTO: cero euros de cuota. El total es la base, sin nada encima.
      expect(Number(t.totalTax)).toBe(0);
      expect(Number(t.totalDiscount)).toBe(0);
      // Y la línea lo dice, que es lo que el papel y el registro leen. El
      // CHECK `ticket_lines_exencion_sin_iva` no admite otra cosa.
      expect(t.lines).toHaveLength(1);
      expect(t.lines[0]!.exemptionCause).toBe("E1");
      expect(Number(t.lines[0]!.taxRate)).toBe(0);
      // Modo prueba: ni un registro en la cadena, ni nada que subir.
      expect(t.status).toBe("TEST");
      expect(await prisma.fiscalRecord.count({ where: { registerId } })).toBe(0);
      expect(encoladoSubida).toHaveLength(0);
    });

    it("y el motor NO deja cobrar un exento con IVA: lo impide el CHECK", async () => {
      // La misma línea, con un 21 % pegado a la causa. No es un `if` del
      // handler: es Postgres. Si alguna ruta futura se olvidara de la
      // coherencia, el cobro falla antes de emitir.
      const q = await prisma.product.findFirstOrThrow({
        where: { tenantId, sku: "POD-002" },
      });
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO ticket_lines (id, ticket_id, product_id, name_snapshot, sku, units,
                                     unit_price, discount_pct, tax_rate, exemption_cause,
                                     subtotal, total)
           VALUES (gen_random_uuid(),
                   (SELECT id FROM tickets WHERE register_id = '${registerId}' LIMIT 1),
                   '${q.id}', 'Quiropodia básica', 'POD-002', 1,
                   25, 0, 21, 'E1', 25, 30.25)`,
        ),
      ).rejects.toThrow();
    });
  });

  // ── 5 · activar y la agenda de la dueña ─────────────────────────────

  describe("5 · tras activar, la dueña ve los 17 en el catálogo de agenda", () => {
    it("la salud pasa products-sellable contando SERVICIOS", async () => {
      // EL BLOQUEO QUE ESTE RECORRIDO ENCONTRÓ. `products-sellable`
      // contaba sólo `kind = PRODUCT`, así que la clínica de Rosario
      // —cuyo catálogo entero son servicios— tenía `0/0` y el check en
      // rojo por definición: con los 17 cargados y el TPV enseñándolos,
      // `activate` contestaba 400 con «≥50% de productos sellable».
      const h = await computeOnboardingHealth(prisma, tenantId);
      const check = h.readinessChecks.find((c) => c.id === "products-sellable")!;
      expect(check).toMatchObject({ applies: true, ok: true, value: "17/17 (100%)" });
      expect(h.ready).toBe(true);
    });

    it("la activación crea el OWNER y se lleva el ensayo, no el catálogo", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/super-admin/tenants/${tenantId}/activate`,
        headers: saAuth(),
        payload: {
          ownerEmail: `rosario+${randomUUID()}@clinica.e2e`,
          ownerName: "Rosario",
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().tenant.onboardingState).toBe("ACTIVE");
      ownerId = res.json().owner.id;
      // El ensayo se purga; el catálogo y sus duraciones se quedan.
      expect(await prisma.ticket.count({ where: { registerId, status: "TEST" } })).toBe(0);
      expect(await prisma.product.count({ where: { tenantId } })).toBe(17);
      expect(await prisma.serviceScheduling.count({ where: { tenantId } })).toBe(17);
    });

    it("GET /services/scheduling devuelve los 17 CON su duración", async () => {
      // Es la pantalla «Catálogo de agenda». Un servicio con
      // `scheduling: null` aparecería ahí sin duración y no se podría
      // reservar: es exactamente lo que pasaba antes de este bloque.
      const res = await app.inject({
        method: "GET",
        url: "/services/scheduling",
        headers: ownerAuth(),
      });
      expect(res.statusCode).toBe(200);
      const items = res.json().items as Array<{
        sku: string;
        name: string;
        taxRate: number;
        scheduling: { durationMin: number; family: string | null } | null;
      }>;
      expect(items).toHaveLength(17);
      expect(items.every((i) => i.scheduling !== null)).toBe(true);
      const q = items.find((i) => i.sku === "POD-002")!;
      expect(q.scheduling!.durationMin).toBe(30);
      expect(q.scheduling!.family).toBe("quiropodia");
      expect(q.taxRate).toBe(0);
      // Y las 17 duraciones son las de la hoja de Rosario, sin repasar
      // una sola ficha a mano.
      const duraciones = items
        .map((i) => i.scheduling!.durationMin)
        .sort((a, b) => a - b);
      // Las 17 de la hoja de Rosario: una entrega de 10 min, siete curas y
      // revisiones de 15, la consulta de 20, cuatro quiropodias y la
      // exploración de 30, el domicilio de 60 y las tres cirugías.
      expect(duraciones).toEqual([
        10, 15, 15, 15, 15, 15, 15, 15, 20, 30, 30, 30, 30, 60, 120, 120, 180,
      ]);
    });

    it("y la dueña puede cambiar una duración desde su panel, sin tocar el fichero", async () => {
      // La segunda puerta, la de siempre. Lo que se comprueba aquí es que
      // las dos escriben en la MISMA fila con las MISMAS reglas: el PUT
      // encuentra la fila que creó el fichero y la actualiza.
      const q = await prisma.product.findFirstOrThrow({
        where: { tenantId, sku: "POD-005" },
      });
      const res = await app.inject({
        method: "PUT",
        url: `/services/${q.id}/scheduling`,
        headers: ownerAuth(),
        payload: { durationMin: 75, family: "quiropodia" },
      });
      expect(res.statusCode).toBe(200);
      const s = await prisma.serviceScheduling.findUniqueOrThrow({
        where: { productId: q.id },
      });
      expect(s.durationMin).toBe(75);
      // Y sigue habiendo 17 filas: el PUT ha hecho `update`, no una
      // segunda fila.
      expect(await prisma.serviceScheduling.count({ where: { tenantId } })).toBe(17);
    });

    it("y el PUT rechaza una duración que el fichero tampoco aceptaría", async () => {
      // La misma regla en las dos puertas (decisión 3): 1.441 minutos no
      // entran ni por el fichero ni por el panel.
      const q = await prisma.product.findFirstOrThrow({
        where: { tenantId, sku: "POD-005" },
      });
      const res = await app.inject({
        method: "PUT",
        url: `/services/${q.id}/scheduling`,
        headers: ownerAuth(),
        payload: { durationMin: 1441 },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
