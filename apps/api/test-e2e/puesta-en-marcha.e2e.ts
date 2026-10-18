// puesta-en-marcha (ADR-021) · el ensayo, el reseteo, el arranque y la baja,
// contra Postgres DE VERDAD.
//
// POR QUÉ ESTE FICHERO EXISTE, y no un banco con Prisma falso. Siete cosas de
// este bloque no las decide el código de la API:
//
//   1. **Que un cobro en ensayo deje la tabla `fiscal_records` VACÍA.** Es
//      una afirmación sobre lo que hay en la base después de cobrar, no sobre
//      qué `if` se tomó.
//   2. **Que el reseteo pueda borrar lo que borra.** Los tickets de ensayo
//      están sellados (S1), tienen devoluciones con FK `RESTRICT`, comandas
//      de cocina, trabajos de email y turnos con su Z. El orden de los
//      borrados lo imponen las claves ajenas y los triggers, y eso sólo se
//      comprueba contra el motor.
//   3. **Que el reseteo NO borre nada más.** El catálogo, la sala, los
//      cajeros, los terminales y las impresoras se cuentan antes y después.
//   4. **Que la primera venta tras arrancar sea la `C1/1`.** La numeración la
//      calcula `ingestFiscalRecord` leyendo la cadena de la caja; que esté
//      vacía después del reseteo es lo que hace que empiece en 1.
//   5. **Que el append-only siga cerrado.** Se intenta borrar un registro a
//      pelo, con `$executeRawUnsafe`, como lo haría alguien con acceso al
//      VPS. Y con la marca de OTRO tenant puesta, que es el sabotaje que
//      prueba que la marca nombra al comercio y no es un interruptor.
//   6. **Que la cuenta entera se pueda eliminar.** Son ocho tablas protegidas
//      por triggers y una docena de FK `RESTRICT`. Si el orden está mal, la
//      transacción rebota: no hay forma de saberlo sin Postgres.
//   7. **Que el backfill de la migración haga lo que dice.** El SQL se LEE DE
//      LA MIGRACIÓN, no se copia: si alguien lo cambia, lo que falla aquí es
//      el despliegue de verdad.
//
// La tabla de sabotaje del done se sostiene casi entera aquí.

import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { borrarCuentasDePrueba } from "./borrar-tenant.js";
import { E2E_DATABASE_URL, e2eEnabled, SKIP_MESSAGE } from "./e2e-env.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  E2E_DATABASE_URL || "postgresql://e2e:e2e@127.0.0.1:5432/e2e";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET = "e".repeat(40);
process.env.JWT_REFRESH_SECRET = "f".repeat(40);
process.env.SUPER_ADMIN_JWT_SECRET = "g".repeat(48);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

// Lo que importa es QUÉ se encola, no que BullMQ funcione.
const encoladoSubida: string[] = [];
const encoladoEmail: string[] = [];
vi.mock("../src/queues/ticket-upload.js", () => ({
  enqueueTicketUpload: async (externalId: string) => {
    encoladoSubida.push(externalId);
  },
  getTicketUploadQueue: () => ({ name: "ticket-upload", getJobs: async () => [] }),
}));
vi.mock("../src/queues/ticket-email.js", () => ({
  enqueueTicketEmail: async (id: string) => {
    encoladoEmail.push(id);
  },
  getTicketEmailQueue: () => ({ name: "ticket-email", getJobs: async () => [] }),
}));
vi.mock("../src/queues/refund-upload.js", () => ({
  enqueueRefundUpload: async () => undefined,
  getRefundUploadQueue: () => ({ name: "refund-upload", getJobs: async () => [] }),
}));

import {
  buildRegistroAlta,
  type CabezaDeCadena,
  descripcionOperacionPorVertical,
  formatNumSerieFactura,
} from "@mipiacetpv/verifactu";

const { getPrisma, shutdown } = await import("../src/context.js");
const { registerShiftRoutes } = await import("../src/shift/routes.js");
const { registerTicketRoutes } = await import("../src/tickets/routes.js");
const { registerFiscalRoutes } = await import("../src/fiscal/routes.js");
const { registerErrorHandler } = await import("../src/lib/error-handler.js");
const { registerLenientJsonParser } = await import("../src/lib/lenient-json.js");
const { signCashierSession } = await import("../src/shift/cashier-session.js");
const {
  arrancarFacturacion,
  ArranqueBloqueadoError,
  EnsayoConVentaRealError,
  previsualizarPuestaEnMarcha,
  resetearEnsayo,
  TenantFacturandoError,
} = await import("../src/fiscal/puesta-en-marcha.js");
const {
  eliminarLaCuenta,
  EliminacionBloqueadaError,
  exportarLaCuenta,
  previsualizarEliminacion,
} = await import("../src/superadmin/eliminar-cuenta.js");

const NIF = "B45902186";
const RAZON = "CAFETERÍA SIROPE SL";

// El SQL del backfill, LEÍDO DE LA MIGRACIÓN. Una copia a mano se queda vieja
// el día que alguien la toque, y entonces este test pasaría verificando un
// SQL que ya no es el que corre en producción.
const MIGRACION = readFileSync(
  new URL(
    "../../../packages/db/prisma/migrations/20261017000000_puesta_en_marcha/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

function sentenciaDeLaMigracion(desde: string, marca: string): string {
  const ini = MIGRACION.indexOf(desde);
  if (ini < 0) throw new Error(`no se encuentra «${desde}» en la migración`);
  const fin = MIGRACION.indexOf(";", ini);
  if (fin < 0) throw new Error(`«${desde}» no termina en «;»`);
  const bloque = MIGRACION.slice(ini, fin + 1);
  // Red de seguridad sobre la extracción: si este `slice` dejara de coger lo
  // que creemos, el test pasaría por no ejecutar nada.
  if (!bloque.includes(marca)) {
    throw new Error(`el bloque extraído no contiene «${marca}»:\n${bloque}`);
  }
  return bloque;
}

/** El bloque `DO $$ … END $$;` de la comprobación final, LEÍDO de la
 *  migración. No vale el extractor de arriba: lleva «;» dentro. */
function bloqueDoDeLaMigracion(): string {
  const ini = MIGRACION.indexOf("DO $$");
  if (ini < 0) throw new Error("no se encuentra el bloque DO de la migración");
  const fin = MIGRACION.indexOf("END $$;", ini);
  if (fin < 0) throw new Error("el bloque DO no termina en «END $$;»");
  const bloque = MIGRACION.slice(ini, fin + "END $$;".length);
  if (!bloque.includes("PUESTA_EN_MARCHA:")) {
    throw new Error(`el bloque extraído no es la comprobación:\n${bloque}`);
  }
  return bloque;
}

describe.skipIf(!e2eEnabled)("e2e · puesta en marcha, contra Postgres real", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let app: FastifyInstance;

  // La cuenta del bloque: Cafetería Sirope, ACTIVE desde junio, con su
  // catálogo, su sala y su terminal, y EN ENSAYO.
  let tenantId = "";
  let storeId = "";
  let registerId = "";
  let terminalId = "";
  let cajeraId = "";
  let token = "";
  let serie = "";
  let instalacion = "";
  let cafeId = "";
  let mesaId = "";

  async function cuantos(): Promise<{
    ticketsTest: number;
    borradores: number;
    anulados: number;
    ticketsTotales: number;
    registros: number;
    turnos: number;
    devoluciones: number;
    productos: number;
    cajeros: number;
    terminales: number;
    mesas: number;
    impresoras: number;
    contador: number;
  }> {
    const [
      ticketsTest,
      borradores,
      anulados,
      ticketsTotales,
      registros,
      turnos,
      devoluciones,
      productos,
      cajeros,
      terminales,
      mesas,
      impresoras,
      caja,
    ] = await Promise.all([
      prisma.ticket.count({ where: { tenantId, status: "TEST" } }),
      prisma.ticket.count({ where: { tenantId, status: "DRAFT" } }),
      prisma.ticket.count({ where: { tenantId, status: "VOIDED" } }),
      prisma.ticket.count({ where: { tenantId } }),
      prisma.fiscalRecord.count({ where: { tenantId } }),
      prisma.shift.count({ where: { registerId } }),
      prisma.refund.count({ where: { tenantId } }),
      prisma.product.count({ where: { tenantId } }),
      prisma.user.count({ where: { tenantId, deletedAt: null } }),
      prisma.device.count({ where: { tenantId, revokedAt: null } }),
      prisma.table.count({ where: { storeId } }),
      prisma.printerConfig.count({ where: { registerId } }),
      prisma.register.findUniqueOrThrow({
        where: { id: registerId },
        select: { ticketCounter: true },
      }),
    ]);
    return {
      ticketsTest,
      borradores,
      anulados,
      ticketsTotales,
      registros,
      turnos,
      devoluciones,
      productos,
      cajeros,
      terminales,
      mesas,
      impresoras,
      contador: caja.ticketCounter,
    };
  }

  async function abrirTurno(): Promise<string> {
    const r = await app.inject({
      method: "POST",
      url: "/shift/open",
      headers: { authorization: `Bearer ${token}` },
      payload: { registerId, cashOpening: 50 },
    });
    if (r.statusCode === 201) return r.json().shift.id as string;
    const abierto = await prisma.shift.findFirstOrThrow({
      where: { registerId, closedAt: null },
      select: { id: true },
    });
    return abierto.id;
  }

  /** Un registro de ALTA generado EXACTAMENTE como lo genera la tablet. */
  async function registroDeVenta(cabeza: CabezaDeCadena | null, total: number) {
    const base = Math.round((total / 1.1) * 100) / 100;
    const cuota = Math.round((total - base) * 100) / 100;
    const numero = (cabeza?.ultimoNumero ?? 0) + 1;
    const chainIndex = (cabeza?.chainIndex ?? 0) + 1;
    const ahora = new Date();
    const fechaIso = ahora.toISOString().slice(0, 10);
    const { registro, huellaInput } = await buildRegistroAlta({
      version: "e2e",
      numeroInstalacion: instalacion,
      idEmisorFactura: NIF,
      nombreRazonEmisor: RAZON,
      numSerieFactura: formatNumSerieFactura(serie, numero),
      fechaExpedicion: fechaIso,
      descripcionOperacion: descripcionOperacionPorVertical("HOSPITALITY"),
      desglose: [{ tipoImpositivo: 10, baseImponible: base, cuotaRepercutida: cuota }],
      cuotaTotal: cuota,
      importeTotal: total,
      cabeza,
      fechaHoraHusoGenRegistro: `${ahora.toISOString().slice(0, 19)}+00:00`,
    });
    return {
      externalId: randomUUID(),
      kind: "ALTA" as const,
      chainIndex,
      serie,
      numero,
      generatedAt: ahora.toISOString(),
      huellaInput,
      payload: registro,
    };
  }

  async function cobrar(args: {
    shiftId: string;
    total: number;
    fiscalRecord?: unknown;
  }) {
    const base = Math.round((args.total / 1.1) * 10000) / 10000;
    return app.inject({
      method: "POST",
      url: "/tickets",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        externalId: randomUUID(),
        registerId,
        shiftId: args.shiftId,
        lines: [
          {
            productId: cafeId,
            nameSnapshot: "Café con leche",
            sku: "CAF-001",
            units: 1,
            unitPrice: base,
            discountPct: 0,
            taxRate: 10,
          },
        ],
        payments: [{ method: "CASH", amount: args.total }],
        ...(args.fiscalRecord ? { fiscalRecord: args.fiscalRecord } : {}),
      },
    });
  }

  beforeAll(async () => {
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    registerLenientJsonParser(app);
    await registerShiftRoutes(app);
    await registerTicketRoutes(app);
    await registerFiscalRoutes(app);
    await app.ready();

    const tenant = await prisma.tenant.create({
      data: {
        name: `${RAZON} ${randomUUID().slice(0, 8)}`,
        businessType: "HOSPITALITY",
        onboardingState: "ACTIVE",
        // El comercio emite sus propias facturas… cuando arranque.
        holdedEnabled: false,
        // Y EN ENSAYO: `facturaDesde` a null, que es el default de la columna.
        fiscalProfile: { legalName: RAZON, taxId: NIF },
      },
      select: { id: true, facturaDesde: true },
    });
    tenantId = tenant.id;
    // El default de la columna, comprobado sobre una fila real: una cuenta
    // nueva NACE en ensayo.
    expect(tenant.facturaDesde).toBeNull();

    const store = await prisma.store.create({
      data: { tenantId, name: "Cafetería Sirope" },
      select: { id: true },
    });
    storeId = store.id;
    const register = await prisma.register.create({
      data: { storeId, name: "Caja 1" },
      select: { id: true, fiscalSeries: true, fiscalInstallationId: true },
    });
    registerId = register.id;
    serie = register.fiscalSeries!;
    instalacion = register.fiscalInstallationId!;
    await prisma.printerConfig.create({
      data: { registerId, name: "Impresora de barra", mode: "USB" },
    });
    const mesa = await prisma.table.create({
      data: { storeId, name: "Mesa 1", capacity: 4 },
      select: { id: true },
    });
    mesaId = mesa.id;
    const terminal = await prisma.device.create({
      data: {
        tenantId,
        registerId,
        deviceTokenHash: randomUUID(),
        name: "D8 barra",
      },
      select: { id: true },
    });
    terminalId = terminal.id;
    const cajera = await prisma.user.create({
      data: {
        tenantId,
        email: `gemma+${randomUUID()}@sirope.e2e`,
        alias: "Gemma",
        role: "CASHIER",
      },
      select: { id: true },
    });
    cajeraId = cajera.id;
    token = signCashierSession(
      { sub: cajeraId, tid: tenantId, did: terminalId, rid: registerId, role: "CASHIER" },
      720,
    );
    const cafe = await prisma.product.create({
      data: {
        tenantId,
        source: "LOCAL",
        name: "Café con leche",
        sku: "CAF-001",
        basePrice: 1.4545,
        taxRate: 10,
        kind: "PRODUCT",
        sellableViaTpv: true,
      },
      select: { id: true },
    });
    cafeId = cafe.id;
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      `DELETE FROM tenants WHERE id = '${tenantId}'`,
    ).catch(() => undefined);
    await app.close();
    await shutdown();
  });

  // ── 1 · el ensayo en el hierro del cliente ──────────────────────────

  describe("1 · se vende entero y no se factura nada", () => {
    let shiftId = "";

    it("el head le dice al terminal que no emite, y que es un ensayo", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/tpv/fiscal/head",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ emite: false, ensayo: true });
    });

    it("una venta de mostrador cobra, nace TEST y no deja registro", async () => {
      shiftId = await abrirTurno();
      const res = await cobrar({ shiftId, total: 1.6 });
      expect(res.statusCode).toBe(201);
      expect(res.json().fiscalRecord).toBeNull();

      const t = await prisma.ticket.findUniqueOrThrow({
        where: { id: res.json().ticket.id },
        select: { status: true, internalNumber: true },
      });
      // La cajera de verdad, el terminal de verdad, y el ticket nace TEST.
      // Eso es la generalización del 1b: ya no decide quién cobra.
      expect(t.status).toBe("TEST");
      expect(await prisma.fiscalRecord.count({ where: { tenantId } })).toBe(0);
      // Y no se encola nada: ni subida a Holded ni email.
      expect(encoladoSubida).toHaveLength(0);
      expect(encoladoEmail).toHaveLength(0);
    });

    it("y si el terminal manda registro igual, se descarta sin tocar la cadena", async () => {
      // La APK vieja, o el outbox con cola de antes. El registro viene bien
      // formado y encadenaría perfecto: lo único que lo descarta es que esta
      // cuenta todavía no factura.
      const reg = await registroDeVenta(null, 2.2);
      const res = await cobrar({ shiftId, total: 2.2, fiscalRecord: reg });
      expect(res.statusCode).toBe(201);
      expect(res.json().fiscalRecord).toBeNull();
      expect(await prisma.fiscalRecord.count({ where: { tenantId } })).toBe(0);
      // Ni siquiera como fila marcada: descartar no es guardar en BROKEN.
      expect(
        await prisma.fiscalRecord.count({ where: { externalId: reg.externalId } }),
      ).toBe(0);
    });

    it("la devolución del ensayo también se puede ensayar", async () => {
      const venta = await cobrar({ shiftId, total: 3.3 });
      const ticketId = venta.json().ticket.id as string;
      const linea = await prisma.ticketLine.findFirstOrThrow({
        where: { ticketId },
        select: { id: true },
      });
      const res = await app.inject({
        method: "POST",
        url: "/refunds",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          externalId: randomUUID(),
          originalTicketId: ticketId,
          lines: [{ ticketLineId: linea.id, units: 1 }],
          method: "CASH",
        },
      });
      expect(res.statusCode).toBe(201);
      // El abono nace TEST igual que su venta, así que tampoco sube a Holded.
      const r = await prisma.refund.findFirstOrThrow({
        where: { originalTicketId: ticketId },
        select: { status: true },
      });
      expect(r.status).toBe("TEST");
    });

    it("una mesa abierta se queda como borrador", async () => {
      // El borrador se escribe directo y no por la ruta de mesas: lo que mide
      // este fichero es que el RESETEO se lleva las mesas abiertas, y montar
      // el flujo entero de sala aquí sería medir la sala (que tiene su propio
      // e2e, `tables-e2e`).
      await prisma.ticket.create({
        data: {
          tenantId,
          registerId,
          shiftId,
          userId: cajeraId,
          tableId: mesaId,
          internalNumber: `D-${randomUUID().slice(0, 6)}`,
          externalId: randomUUID(),
          publicSlug: randomUUID().replace(/-/g, "").slice(0, 12),
          status: "DRAFT",
          total: 0,
          totalTax: 0,
          totalDiscount: 0,
        },
      });
      expect(
        await prisma.ticket.count({ where: { tenantId, status: "DRAFT" } }),
      ).toBeGreaterThan(0);
    });

    // La forma que tenía Cafetería Sirope en la foto de producción del
    // 18-10: 20 tickets `VOIDED` —16 del cajero de pruebas, 4 de la
    // demostración con la dueña— y ni uno en Holded. Un reseteo que sólo
    // mirara los `TEST` se los habría dejado dentro.
    it("y una venta anulada durante la demostración también se queda", async () => {
      const venta = await cobrar({ shiftId, total: 8.5 });
      expect(venta.statusCode).toBe(201);
      await prisma.ticket.update({
        where: { id: venta.json().ticket.id },
        data: { status: "VOIDED", voidedAt: new Date() },
      });
      expect(
        await prisma.ticket.count({ where: { tenantId, status: "VOIDED" } }),
      ).toBe(1);
    });

    it("el cierre del turno funciona, con su informe Z", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/shift/${shiftId}/close`,
        headers: { authorization: `Bearer ${token}` },
        payload: { cashCounted: 50, methodTotals: {} },
      });
      expect([200, 201]).toContain(res.statusCode);
      const z = await prisma.shiftZReport.count({ where: { shiftId } });
      expect(z).toBeGreaterThan(0);
    });

    it("resumen del ensayo: hay de todo y CERO facturas", async () => {
      const n = await cuantos();
      expect(n.ticketsTest).toBeGreaterThanOrEqual(3);
      expect(n.borradores).toBeGreaterThan(0);
      expect(n.anulados).toBe(1);
      expect(n.devoluciones).toBe(1);
      expect(n.turnos).toBe(1);
      expect(n.contador).toBeGreaterThan(0);
      // La frase del bloque, medida: antes de la puesta en marcha no hay
      // ningún registro fiscal. Nunca.
      expect(n.registros).toBe(0);
    });
  });

  // ── 2 · resetear el ensayo ──────────────────────────────────────────

  describe("2 · el reseteo deja la cuenta como estaba", () => {
    // La puerta nueva del 18-10: primero, que NO se pueda si algo de dentro
    // no es de ensayo. Se prueba antes de resetear de verdad porque después
    // ya no hay tickets con los que probarlo.
    it("NO se puede si un ticket llegó a Holded, y dice cuál", async () => {
      const victima = await prisma.ticket.findFirstOrThrow({
        where: { tenantId, status: "VOIDED" },
        select: { id: true, internalNumber: true },
      });
      await prisma.ticket.update({
        where: { id: victima.id },
        data: { holdedDocumentId: "6714aa0f9c3e1b0012345678" },
      });

      const antes = await cuantos();
      const err = await resetearEnsayo({ prisma, tenantId }).catch((e) => e);
      expect(err).toBeInstanceOf(EnsayoConVentaRealError);
      expect(err.message).toContain(victima.internalNumber);
      // Y NO SE BORRÓ NADA: ni los de ensayo, ni los turnos, ni el contador.
      const despues = await cuantos();
      expect(despues).toEqual(antes);

      // Se quita la marca y el camino se abre otra vez.
      await prisma.ticket.update({
        where: { id: victima.id },
        data: { holdedDocumentId: null },
      });
      const previa = await previsualizarPuestaEnMarcha(prisma, tenantId);
      expect(previa.ventasQueNoSonDeEnsayo).toEqual([]);
      expect(previa.puedeResetear).toBe(true);
    });

    it("borra TODOS los tickets y conserva todo lo demás", async () => {
      const antes = await cuantos();
      const r = await resetearEnsayo({ prisma, tenantId });

      // Todos, no sólo los de ensayo: las anuladas también se van.
      expect(r.ticketsBorrados).toBe(antes.ticketsTotales);
      expect(r.ticketsDeEnsayoBorrados).toBe(antes.ticketsTest);
      expect(r.borradoresBorrados).toBe(antes.borradores);
      expect(r.devolucionesBorradas).toBe(antes.devoluciones);
      expect(r.turnosBorrados).toBe(antes.turnos);
      // Y el desglose, que es lo único que queda de lo que había.
      expect(
        r.ticketsPorEstado.find((p) => p.estado === "VOIDED")?.cuantos,
      ).toBe(1);

      const despues = await cuantos();
      expect(despues.ticketsTotales).toBe(0);
      expect(despues.ticketsTest).toBe(0);
      expect(despues.borradores).toBe(0);
      expect(despues.anulados).toBe(0);
      expect(despues.devoluciones).toBe(0);
      expect(despues.turnos).toBe(0);
      expect(despues.contador).toBe(0);

      // Y lo que cuesta una tarde de implantación, intacto.
      expect(despues.productos).toBe(antes.productos);
      expect(despues.cajeros).toBe(antes.cajeros);
      expect(despues.terminales).toBe(antes.terminales);
      expect(despues.mesas).toBe(antes.mesas);
      expect(despues.impresoras).toBe(antes.impresoras);
    });

    it("se puede resetear otra vez sin que pase nada (es idempotente)", async () => {
      const r = await resetearEnsayo({ prisma, tenantId });
      expect(r.ticketsBorrados).toBe(0);
      expect(r.turnosBorrados).toBe(0);
    });

    it("y la cuenta sigue en ensayo, lista para volver a probar", async () => {
      const previa = await previsualizarPuestaEnMarcha(prisma, tenantId);
      expect(previa.estado).toBe("ensayo");
      expect(previa.puedeResetear).toBe(true);
      expect(previa.puedeArrancar).toBe(true);
      expect(previa.bloqueos).toEqual([]);
    });
  });

  // ── 3 · las precondiciones de arrancar ──────────────────────────────

  describe("3 · arrancar exige el suelo", () => {
    it("una cuenta de pruebas del equipo no arranca nunca", async () => {
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { esDePruebas: true },
      });
      const err = await arrancarFacturacion({ prisma, tenantId }).catch((e) => e);
      expect(err).toBeInstanceOf(ArranqueBloqueadoError);
      expect(err.bloqueos.map((b: { codigo: string }) => b.codigo)).toContain(
        "TENANT_DE_PRUEBAS",
      );
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { esDePruebas: false },
      });
    });

    it("y la BASE no la deja facturar ni a mano", async () => {
      // El CHECK `tenants_pruebas_no_facturan_ck`. El código ya lo impide;
      // esto es lo que lo impide cuando alguien escribe un UPDATE.
      let msg = "";
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE tenants SET es_de_pruebas = true, fiscal_go_live_at = now() WHERE id = '${tenantId}'`,
        );
      } catch (e) {
        msg = e instanceof Error ? e.message : String(e);
      }
      expect(msg).toContain("tenants_pruebas_no_facturan_ck");
    });

    it("sin datos fiscales no arranca", async () => {
      const antes = await prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { fiscalProfile: true },
      });
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { fiscalProfile: {} },
      });
      const err = await arrancarFacturacion({ prisma, tenantId }).catch((e) => e);
      expect(err).toBeInstanceOf(ArranqueBloqueadoError);
      expect(err.bloqueos.map((b: { codigo: string }) => b.codigo)).toContain(
        "DATOS_FISCALES",
      );
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { fiscalProfile: antes.fiscalProfile as object },
      });
    });

    it("sin terminal emparejado no arranca", async () => {
      await prisma.device.update({
        where: { id: terminalId },
        data: { revokedAt: new Date() },
      });
      const err = await arrancarFacturacion({ prisma, tenantId }).catch((e) => e);
      expect(err).toBeInstanceOf(ArranqueBloqueadoError);
      expect(err.bloqueos.map((b: { codigo: string }) => b.codigo)).toContain(
        "SIN_TERMINAL",
      );
      await prisma.device.update({
        where: { id: terminalId },
        data: { revokedAt: null },
      });
    });
  });

  // ── 4 · arrancar, y la primera factura ──────────────────────────────

  describe("4 · empezar a facturar", () => {
    let cabeza: CabezaDeCadena | null = null;

    it("fija la fecha y deja la cadena lista", async () => {
      const r = await arrancarFacturacion({ prisma, tenantId });
      expect(r.facturaDesde).toBeTruthy();
      const t = await prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { facturaDesde: true },
      });
      expect(t.facturaDesde).not.toBeNull();
    });

    it("ahora el head SÍ emite, con su serie y su instalación", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/tpv/fiscal/head",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().emite).toBe(true);
      expect(res.json().ensayo).toBe(false);
      expect(res.json().serie).toBe(serie);
      expect(res.json().cabeza).toBeNull();
    });

    it("y LA PRIMERA VENTA ES LA C1/1", async () => {
      const shiftId = await abrirTurno();
      const reg = await registroDeVenta(null, 1.6);
      const res = await cobrar({ shiftId, total: 1.6, fiscalRecord: reg });
      expect(res.statusCode).toBe(201);
      expect(res.json().fiscalRecord?.chainStatus).toBe("OK");

      const guardado = await prisma.fiscalRecord.findFirstOrThrow({
        where: { tenantId },
        orderBy: { chainIndex: "asc" },
      });
      expect(guardado.serie).toBe(serie);
      expect(guardado.numero).toBe(1);
      expect(guardado.chainIndex).toBe(1);
      expect(guardado.numSerieFactura).toBe(formatNumSerieFactura(serie, 1));
      expect(guardado.primerRegistro).toBe(true);

      // Y el ticket ya no nace TEST.
      const t = await prisma.ticket.findUniqueOrThrow({
        where: { id: res.json().ticket.id },
        select: { status: true, internalNumber: true },
      });
      expect(t.status).not.toBe("TEST");
      // El contador se reseteó, así que la referencia interna también
      // empieza por el principio.
      expect(t.internalNumber).toBe("000001");

      cabeza = {
        chainIndex: 1,
        idEmisorFactura: NIF,
        numSerieFactura: guardado.numSerieFactura,
        fechaExpedicion: guardado.fechaExpedicion.toISOString().slice(0, 10),
        huella: guardado.huella,
        fechaHoraHusoGenRegistro: guardado.fechaHoraHusoGen,
        huellaInput: guardado.huellaInput,
        ultimoNumero: 1,
        serie,
      } as CabezaDeCadena;
      expect(cabeza).toBeTruthy();
    });

    it("el reseteo ya NO se puede: su histórico es contabilidad", async () => {
      const err = await resetearEnsayo({ prisma, tenantId }).catch((e) => e);
      expect(err).toBeInstanceOf(TenantFacturandoError);
      // Y no se ha borrado nada.
      expect(await prisma.fiscalRecord.count({ where: { tenantId } })).toBe(1);
      expect(
        await prisma.ticket.count({ where: { tenantId, status: { not: "DRAFT" } } }),
      ).toBe(1);
    });

    it("ni arrancar otra vez", async () => {
      const err = await arrancarFacturacion({ prisma, tenantId }).catch((e) => e);
      expect(err).toBeInstanceOf(ArranqueBloqueadoError);
      expect(err.bloqueos.map((b: { codigo: string }) => b.codigo)).toContain(
        "YA_FACTURA",
      );
    });
  });

  // ── 5 · el append-only sigue cerrado ────────────────────────────────

  describe("5 · un registro de facturación no se borra", () => {
    it("ni con SQL a pelo", async () => {
      let msg = "";
      try {
        await prisma.$executeRawUnsafe(
          `DELETE FROM fiscal_records WHERE tenant_id = '${tenantId}'`,
        );
      } catch (e) {
        msg = e instanceof Error ? e.message : String(e);
      }
      expect(msg).toContain("REGISTRO_FISCAL_VIOLADO");
      expect(await prisma.fiscalRecord.count({ where: { tenantId } })).toBe(1);
    });

    it("ni con la marca de OTRO tenant puesta", async () => {
      // El sabotaje que prueba que la marca NOMBRA al comercio y no es un
      // interruptor de «desactiva los guardias».
      const otro = randomUUID();
      let msg = "";
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `SET LOCAL "mipiacetpv.eliminar_tenant" = '${otro}'`,
          );
          await tx.$executeRawUnsafe(
            `DELETE FROM fiscal_records WHERE tenant_id = '${tenantId}'`,
          );
        });
      } catch (e) {
        msg = e instanceof Error ? e.message : String(e);
      }
      expect(msg).toContain("REGISTRO_FISCAL_VIOLADO");
      expect(await prisma.fiscalRecord.count({ where: { tenantId } })).toBe(1);
    });

    it("y MODIFICARLO tampoco, ni con la marca de su propio tenant", async () => {
      // La marca autoriza DELETE y nada más: una huella no se reescribe en
      // ninguna circunstancia.
      let msg = "";
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `SET LOCAL "mipiacetpv.eliminar_tenant" = '${tenantId}'`,
          );
          await tx.$executeRawUnsafe(
            `UPDATE fiscal_records SET importe_total = 0 WHERE tenant_id = '${tenantId}'`,
          );
        });
      } catch (e) {
        msg = e instanceof Error ? e.message : String(e);
      }
      expect(msg).toContain("REGISTRO_FISCAL_VIOLADO");
      expect(msg).toContain("no se modifica");
    });

    // ── Y la excepción del reseteo no abre ninguna puerta ────────────
    //
    // El guardián del sello deja borrar un ticket sellado SÓLO si la cuenta
    // está en ensayo, el ticket no llegó a Holded y no tiene factura. Aquí la
    // cuenta YA FACTURA, así que las tres dejan de cumplirse por la primera.
    it("una venta de una cuenta que factura no se borra ni a pelo", async () => {
      const venta = await prisma.ticket.findFirstOrThrow({
        where: { tenantId, status: { not: "DRAFT" } },
        select: { id: true },
      });
      let msg = "";
      try {
        await prisma.$executeRawUnsafe(
          `DELETE FROM tickets WHERE id = '${venta.id}'`,
        );
      } catch (e) {
        msg = e instanceof Error ? e.message : String(e);
      }
      expect(msg).toContain("SELLO_VIOLADO");
      expect(await prisma.ticket.count({ where: { id: venta.id } })).toBe(1);
    });

    it("y en una cuenta EN ENSAYO, tampoco la que llegó a Holded", async () => {
      // La tercera condición de la excepción, sola. Cuenta en ensayo, ticket
      // sellado, sin registro fiscal… y con documento de Holded: no se borra.
      const otro = await prisma.tenant.create({
        data: {
          name: `Con documento ${randomUUID().slice(0, 8)}`,
          holdedEnabled: false,
        },
        select: { id: true },
      });
      const st = await prisma.store.create({
        data: { tenantId: otro.id, name: "T" },
        select: { id: true },
      });
      const reg = await prisma.register.create({
        data: { storeId: st.id, name: "C" },
        select: { id: true },
      });
      const u = await prisma.user.create({
        data: { tenantId: otro.id, email: `u+${randomUUID()}@e2e.local`, role: "OWNER" },
        select: { id: true },
      });
      const sh = await prisma.shift.create({
        data: { registerId: reg.id, userId: u.id, cashOpening: 0 },
        select: { id: true },
      });
      const t = await prisma.ticket.create({
        data: {
          tenantId: otro.id,
          registerId: reg.id,
          shiftId: sh.id,
          userId: u.id,
          internalNumber: "000001",
          externalId: randomUUID(),
          publicSlug: randomUUID().replace(/-/g, "").slice(0, 12),
          status: "VOIDED",
          total: 8.5,
          totalTax: 0.77,
          totalDiscount: 0,
          holdedDocumentId: "6714aa0f9c3e1b0012345678",
        },
        select: { id: true },
      });
      // Sellado a mano, que es lo que hace `sealTicket` al cobrar.
      await prisma.$executeRawUnsafe(
        `UPDATE tickets SET sealed_at = now(), sealed_hash = repeat('a', 64) WHERE id = '${t.id}'`,
      );

      let msg = "";
      try {
        await prisma.$executeRawUnsafe(`DELETE FROM tickets WHERE id = '${t.id}'`);
      } catch (e) {
        msg = e instanceof Error ? e.message : String(e);
      }
      expect(msg).toContain("SELLO_VIOLADO");
      expect(await prisma.ticket.count({ where: { id: t.id } })).toBe(1);

      // Limpieza: con la marca de la baja, que es el único camino.
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `SET LOCAL "mipiacetpv.eliminar_tenant" = '${otro.id}'`,
        );
        await tx.$executeRawUnsafe(`DELETE FROM tickets WHERE tenant_id = '${otro.id}'`);
        await tx.$executeRawUnsafe(`DELETE FROM shifts WHERE register_id = '${reg.id}'`);
        await tx.$executeRawUnsafe(`DELETE FROM tenants WHERE id = '${otro.id}'`);
      });
    });

    it("la cadena de la caja sigue íntegra después de todos los intentos", async () => {
      const filas = await prisma.$queryRawUnsafe<
        { total: bigint; integra: boolean; primer_fallo_index: number | null }[]
      >(`SELECT * FROM mipiacetpv_fiscal_chain_summary('${registerId}'::uuid)`);
      expect(filas[0]!.integra).toBe(true);
      expect(filas[0]!.primer_fallo_index).toBeNull();
      expect(Number(filas[0]!.total)).toBe(1);
    });
  });

  // ── 6 · el backfill de la migración ─────────────────────────────────

  describe("6 · el backfill, leído de la migración", () => {
    let conRegistros = "";
    let conVentas = "";
    let sinNada = "";
    // La foto de producción del 18-10: una cuenta con sólo anuladas (Sirope)
    // y otra con una anulada que SÍ llegó a Holded.
    let soloAnuladas = "";
    let anuladaEnHolded = "";
    // La regla 3.c, que el 18-10 se quedó con una sola cuenta.
    let pruebasMipiace = "";
    let ensayoMaestranza = "";

    /** Monta un comercio vacío con su tienda, su caja, su propietario y su
     *  turno, listo para colgarle tickets. */
    async function comercio(nombre: string) {
      const t = await prisma.tenant.create({
        data: { name: `${nombre} ${randomUUID().slice(0, 8)}` },
        select: { id: true },
      });
      const st = await prisma.store.create({
        data: { tenantId: t.id, name: "T" },
        select: { id: true },
      });
      const r = await prisma.register.create({
        data: { storeId: st.id, name: "C" },
        select: { id: true },
      });
      const u = await prisma.user.create({
        data: { tenantId: t.id, email: `u+${randomUUID()}@e2e.local`, role: "OWNER" },
        select: { id: true },
      });
      const sh = await prisma.shift.create({
        data: { registerId: r.id, userId: u.id, cashOpening: 0 },
        select: { id: true },
      });
      return { tenantId: t.id, registerId: r.id, userId: u.id, shiftId: sh.id };
    }

    async function ticket(
      c: { tenantId: string; registerId: string; userId: string; shiftId: string },
      datos: { status: string; paidAt?: Date; holdedDocumentId?: string },
    ) {
      await prisma.ticket.create({
        data: {
          tenantId: c.tenantId,
          registerId: c.registerId,
          shiftId: c.shiftId,
          userId: c.userId,
          internalNumber: randomUUID().slice(0, 6),
          externalId: randomUUID(),
          publicSlug: randomUUID().replace(/-/g, "").slice(0, 12),
          status: datos.status as never,
          paidAt: datos.paidAt ?? new Date("2026-03-04T10:00:00Z"),
          holdedDocumentId: datos.holdedDocumentId ?? null,
          total: 10,
          totalTax: 1,
          totalDiscount: 0,
        },
      });
    }

    it("monta las tres clases de cuenta y les quita la fecha", async () => {
      // Esta cuenta ya tiene un registro: la regla 3.a tiene que verla.
      conRegistros = tenantId;
      await prisma.$executeRawUnsafe(
        `UPDATE tenants SET fiscal_go_live_at = NULL WHERE id = '${tenantId}'`,
      );

      // Una con ventas reales y sin registros: el comercio con Holded.
      const t2 = await prisma.tenant.create({
        data: { name: `Con ventas ${randomUUID().slice(0, 8)}` },
        select: { id: true },
      });
      conVentas = t2.id;
      const s2 = await prisma.store.create({
        data: { tenantId: conVentas, name: "T" },
        select: { id: true },
      });
      const r2 = await prisma.register.create({
        data: { storeId: s2.id, name: "C" },
        select: { id: true },
      });
      const u2 = await prisma.user.create({
        data: { tenantId: conVentas, email: `u+${randomUUID()}@e2e.local`, role: "OWNER" },
        select: { id: true },
      });
      const sh2 = await prisma.shift.create({
        data: { registerId: r2.id, userId: u2.id, cashOpening: 0 },
        select: { id: true },
      });
      await prisma.ticket.create({
        data: {
          tenantId: conVentas,
          registerId: r2.id,
          shiftId: sh2.id,
          userId: u2.id,
          internalNumber: "000001",
          externalId: randomUUID(),
          publicSlug: randomUUID().replace(/-/g, "").slice(0, 12),
          status: "PAID",
          paidAt: new Date("2026-03-04T10:00:00Z"),
          total: 10,
          totalTax: 1,
          totalDiscount: 0,
        },
      });

      // Y una virgen: ni registros ni ventas reales.
      const t3 = await prisma.tenant.create({
        data: { name: `Virgen ${randomUUID().slice(0, 8)}` },
        select: { id: true },
      });
      sinNada = t3.id;

      // CAFETERÍA SIROPE, tal y como salió en la foto del 18-10: sólo
      // anuladas, ninguna en Holded. No ha vendido nunca.
      const c4 = await comercio("Sólo anuladas");
      soloAnuladas = c4.tenantId;
      for (let i = 0; i < 20; i++) {
        await ticket(c4, { status: "VOIDED" });
      }
      await ticket(c4, { status: "TEST" });
      await ticket(c4, { status: "DRAFT" });

      // Y el caso contrario: una anulada que SÍ llegó a Holded. Existió un
      // documento con número en la contabilidad del cliente, así que ese
      // comercio SÍ ha facturado.
      const c5 = await comercio("Anulada en Holded");
      anuladaEnHolded = c5.tenantId;
      await ticket(c5, {
        status: "VOIDED",
        paidAt: new Date("2026-02-02T09:00:00Z"),
        holdedDocumentId: "6714aa0f9c3e1b0012345678",
      });

      // LA CUENTA DE PRUEBAS DEL EQUIPO: se identifica por su nombre, y no
      // tiene nada dentro.
      const c6 = await prisma.tenant.create({
        data: { name: "PRUEBAS MIPIACE" },
        select: { id: true },
      });
      pruebasMipiace = c6.id;

      // Y LA DE ENSAYO DE LA MAESTRANZA, con el email que la identificaba
      // cuando estaba en la lista de 3.c… y con una factura emitida, que es
      // lo que la sacó de ella (foto de producción del 18-10: 11 registros).
      const c7 = await comercio("Ensayo Maestranza");
      ensayoMaestranza = c7.tenantId;
      await prisma.user.create({
        data: {
          tenantId: ensayoMaestranza,
          email: `m.oyola+maestranza-ensayo-${randomUUID().slice(0, 6)}@mipiace.es`,
          role: "OWNER",
        },
      });
      await prisma.$executeRawUnsafe(
        `INSERT INTO fiscal_records
           (tenant_id, register_id, external_id, kind, chain_index, serie, numero,
            num_serie_factura, fecha_expedicion, tipo_factura, cuota_total, importe_total,
            huella, primer_registro, fecha_hora_huso_gen, huella_input, payload,
            generated_at, chain_status)
         VALUES ('${ensayoMaestranza}'::uuid, '${c7.registerId}'::uuid, '${randomUUID()}'::uuid,
            'ALTA', 1, 'C1', 1, 'C1/000001', '2026-10-06', 'F2', 0.15, 1.60,
            '${"B".repeat(64)}', true, '2026-10-06T21:00:00+02:00', 'x', '{}'::jsonb,
            now(), 'OK')`,
      );
    });

    it("3.a · quien tiene facturas factura desde su primera factura", async () => {
      await prisma.$executeRawUnsafe(
        sentenciaDeLaMigracion('UPDATE "tenants" t\n   SET "fiscal_go_live_at" = sub."desde"\n  FROM (\n    SELECT "tenant_id",\n           MIN("fecha_expedicion")', "fiscal_records"),
      );
      const t = await prisma.tenant.findUniqueOrThrow({
        where: { id: conRegistros },
        select: { facturaDesde: true },
      });
      expect(t.facturaDesde).not.toBeNull();
    });

    it("3.b · quien ha vendido de verdad factura desde su primera venta", async () => {
      await prisma.$executeRawUnsafe(
        sentenciaDeLaMigracion('UPDATE "tenants" t\n   SET "fiscal_go_live_at" = sub."desde"\n  FROM (\n    SELECT "tenant_id", MIN(COALESCE("paid_at"', "tickets"),
      );
      const t = await prisma.tenant.findUniqueOrThrow({
        where: { id: conVentas },
        select: { facturaDesde: true },
      });
      // La fecha de su primera venta real, al minuto.
      expect(t.facturaDesde?.toISOString()).toBe("2026-03-04T10:00:00.000Z");
    });

    // ── Lo que arregló la foto de producción del 18-10 ───────────────
    //
    // Con la regla vieja («todo lo que no sea borrador ni ensayo»), Cafetería
    // Sirope salía por 3.b con 20 ventas y habría ARRANCADO A FACTURAR SOLA
    // en el despliegue: su siguiente cobro de ensayo habría sido su factura
    // C1/1. Las 20 eran anuladas y ninguna llegó a Holded.
    it("3.b · una cuenta con SÓLO anuladas NO ha vendido: se queda en ensayo", async () => {
      const t = await prisma.tenant.findUniqueOrThrow({
        where: { id: soloAnuladas },
        select: { facturaDesde: true },
      });
      expect(t.facturaDesde).toBeNull();
    });

    it("3.b · pero una anulada que llegó a Holded SÍ cuenta", async () => {
      // `holded_document_id` lo pone el worker cuando Holded CREA el
      // documento: existió una factura con número en la contabilidad del
      // cliente, y anular el ticket aquí no la deshace.
      const t = await prisma.tenant.findUniqueOrThrow({
        where: { id: anuladaEnHolded },
        select: { facturaDesde: true },
      });
      expect(t.facturaDesde?.toISOString()).toBe("2026-02-02T09:00:00.000Z");
    });

    // ── La regla 3.c, después de la decisión del 18-10 ───────────────
    //
    // Sólo PRUEBAS MIPIACE. La cuenta de ensayo de La Maestranza tiene 11
    // registros fiscales de la noche del 06-10, así que entra por 3.a como
    // cualquiera que ha facturado y se elimina después del despliegue desde
    // la consola. Marcarla habría sido mentir sobre una cuenta con facturas
    // emitidas — y el CHECK de la base lo rechazaría igual.
    it("3.c · la comprobación final NO para por la cuenta de ensayo de La Maestranza", async () => {
      // El bloque DO tal cual está en la migración. Antes de la decisión,
      // esto ABORTABA el despliegue con su nombre dentro.
      await expect(
        prisma.$executeRawUnsafe(bloqueDoDeLaMigracion()),
      ).resolves.toBeDefined();
    });

    it("3.c · marca PRUEBAS MIPIACE, y a la de ensayo NO", async () => {
      await prisma.$executeRawUnsafe(
        sentenciaDeLaMigracion(
          'UPDATE "tenants" t\n   SET "es_de_pruebas" = true',
          "PRUEBAS MIPIACE",
        ),
      );
      const pruebas = await prisma.tenant.findUniqueOrThrow({
        where: { id: pruebasMipiace },
        select: { esDePruebas: true, facturaDesde: true },
      });
      expect(pruebas.esDePruebas).toBe(true);
      expect(pruebas.facturaDesde).toBeNull();

      const maestranza = await prisma.tenant.findUniqueOrThrow({
        where: { id: ensayoMaestranza },
        select: { esDePruebas: true, facturaDesde: true },
      });
      expect(maestranza.esDePruebas).toBe(false);
      // Y con su fecha, la de su primera factura: entró por 3.a.
      expect(maestranza.facturaDesde?.toISOString().slice(0, 10)).toBe(
        "2026-10-05",
      );
    });

    it("3.c · pero SÍ para si PRUEBAS MIPIACE hubiera facturado", async () => {
      // La comprobación sigue ahí para lo que estaba: que nadie marque como
      // cuenta de pruebas algo que ha emitido facturas.
      await prisma.$executeRawUnsafe(
        `UPDATE tenants SET es_de_pruebas = false, fiscal_go_live_at = now() WHERE id = '${pruebasMipiace}'`,
      );
      let msg = "";
      try {
        await prisma.$executeRawUnsafe(bloqueDoDeLaMigracion());
      } catch (e) {
        msg = e instanceof Error ? e.message : String(e);
      }
      expect(msg).toContain("PUESTA_EN_MARCHA:");
      expect(msg).toContain("PRUEBAS MIPIACE");
      await prisma.$executeRawUnsafe(
        `UPDATE tenants SET fiscal_go_live_at = NULL, es_de_pruebas = true WHERE id = '${pruebasMipiace}'`,
      );
    });

    it("3.d · y quien no ha vendido nada se queda en ensayo", async () => {
      const t = await prisma.tenant.findUniqueOrThrow({
        where: { id: sinNada },
        select: { facturaDesde: true },
      });
      expect(t.facturaDesde).toBeNull();
      await prisma.tenant.delete({ where: { id: sinNada } });
      for (const id of [
        conVentas,
        soloAnuladas,
        anuladaEnHolded,
        pruebasMipiace,
        ensayoMaestranza,
      ]) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM tickets WHERE tenant_id = '${id}'`,
        ).catch(() => undefined);
        await prisma.$executeRawUnsafe(
          `DELETE FROM tenants WHERE id = '${id}'`,
        ).catch(() => undefined);
      }
    });
  });

  // ── 7 · la baja del cliente ─────────────────────────────────────────

  describe("7 · eliminar la cuenta", () => {
    it("sin el export descargado, no hay camino", async () => {
      const previa = await previsualizarEliminacion(prisma, tenantId);
      expect(previa.puedeEliminar).toBe(false);
      expect(previa.bloqueos.map((b) => b.codigo)).toContain("SIN_EXPORT");

      const err = await eliminarLaCuenta({ prisma, tenantId }).catch((e) => e);
      expect(err).toBeInstanceOf(EliminacionBloqueadaError);
      // Y la cuenta sigue ahí entera.
      expect(await prisma.fiscalRecord.count({ where: { tenantId } })).toBe(1);
    });

    it("el export lleva la factura con su huella y la comprobación de la cadena", async () => {
      const trozos: Buffer[] = [];
      const resumen = await exportarLaCuenta(
        prisma,
        { tenantId, ahora: new Date("2026-10-17T09:00:00Z") },
        (t) => {
          trozos.push(t);
        },
      );
      expect(resumen.registrosFiscales).toBe(1);
      expect(resumen.tickets).toBeGreaterThan(0);
      const zip = Buffer.concat(trozos);
      // Es un ZIP de verdad (firma PK\x03\x04) y lleva los ficheros que dice.
      expect(zip.subarray(0, 4).toString("hex")).toBe("504b0304");
      // `utf8` y no `latin1`: los nombres de dentro del ZIP van en UTF-8 (lo
      // dice la bandera 11 que pone `lib/zip.ts`) y el LEEME lleva tildes.
      const texto = zip.toString("utf8");
      expect(texto).toContain("facturas/registros.json");
      expect(texto).toContain("facturas/registros.csv");
      expect(texto).toContain("facturas/cadena.txt");
      expect(texto).toContain("ventas/tickets.json");
      expect(texto).toContain("LEEME.txt");
      // Y dentro, la huella de la factura y el veredicto del motor.
      const reg = await prisma.fiscalRecord.findFirstOrThrow({
        where: { tenantId },
        select: { huella: true },
      });
      expect(texto).toContain(reg.huella);
      expect(texto).toContain("cadena íntegra: SÍ");
    });

    it("con el apunte del export en el audit, ya se puede", async () => {
      // El apunte lo escribe la RUTA; aquí se escribe a mano porque este
      // fichero prueba el módulo, no el HTTP. Lo que importa es que la
      // precondición mira el audit y no la pantalla.
      const sa = await prisma.superAdminUser.create({
        data: {
          email: `sa+${randomUUID()}@mipiace.es`,
          name: "Matías",
          passwordHash: "x",
        },
        select: { id: true },
      });
      await prisma.superAdminAudit.create({
        data: {
          superAdminId: sa.id,
          action: "export_cuenta",
          tenantId,
          metadata: {
            ipAddress: null,
            userAgent: null,
            registrosFiscales: 1,
            tickets: 1,
            devoluciones: 0,
            fichajes: 0,
            ficheros: 6,
            bytes: 1000,
          },
        },
      });
      const previa = await previsualizarEliminacion(prisma, tenantId);
      expect(previa.exportDescargadoAt).not.toBeNull();
      expect(previa.puedeEliminar).toBe(true);
    });

    it("y la cuenta se va ENTERA, facturas incluidas", async () => {
      const r = await eliminarLaCuenta({ prisma, tenantId });
      expect(r.borrado.registrosFiscales).toBe(1);

      // Ni una fila, en ninguna de las tablas que importan.
      expect(await prisma.tenant.count({ where: { id: tenantId } })).toBe(0);
      expect(await prisma.fiscalRecord.count({ where: { tenantId } })).toBe(0);
      expect(await prisma.ticket.count({ where: { tenantId } })).toBe(0);
      expect(await prisma.product.count({ where: { tenantId } })).toBe(0);
      expect(await prisma.user.count({ where: { tenantId } })).toBe(0);
      expect(await prisma.device.count({ where: { tenantId } })).toBe(0);
      expect(await prisma.store.count({ where: { tenantId } })).toBe(0);
      expect(await prisma.register.count({ where: { id: registerId } })).toBe(0);
      expect(await prisma.shift.count({ where: { registerId } })).toBe(0);
      expect(await prisma.table.count({ where: { storeId } })).toBe(0);
    });

    it("y el append-only sigue cerrado después: la marca murió con su transacción", async () => {
      // Otra cuenta, con una factura, y el mismo DELETE a pelo. Si la marca
      // se hubiera quedado puesta de alguna forma, esto pasaría.
      const t = await prisma.tenant.create({
        data: {
          name: `Testigo ${randomUUID().slice(0, 8)}`,
          holdedEnabled: false,
          facturaDesde: new Date(),
          fiscalProfile: { legalName: "TESTIGO SL", taxId: NIF },
        },
        select: { id: true },
      });
      const s = await prisma.store.create({
        data: { tenantId: t.id, name: "T" },
        select: { id: true },
      });
      const reg = await prisma.register.create({
        data: { storeId: s.id, name: "C" },
        select: { id: true, fiscalSeries: true, fiscalInstallationId: true },
      });
      await prisma.$executeRawUnsafe(
        `INSERT INTO fiscal_records
           (tenant_id, register_id, external_id, kind, chain_index, serie, numero,
            num_serie_factura, fecha_expedicion, tipo_factura, cuota_total, importe_total,
            huella, primer_registro, fecha_hora_huso_gen, huella_input, payload,
            generated_at, chain_status)
         VALUES ('${t.id}'::uuid, '${reg.id}'::uuid, '${randomUUID()}'::uuid, 'ALTA', 1,
            'C1', 1, 'C1/000001', '2026-10-17', 'F2', 0.15, 1.60,
            '${"A".repeat(64)}', true, '2026-10-17T09:00:00+02:00', 'x', '{}'::jsonb,
            now(), 'OK')`,
      );
      let msg = "";
      try {
        await prisma.$executeRawUnsafe(
          `DELETE FROM fiscal_records WHERE tenant_id = '${t.id}'`,
        );
      } catch (e) {
        msg = e instanceof Error ? e.message : String(e);
      }
      expect(msg).toContain("REGISTRO_FISCAL_VIOLADO");
      // Y se limpia por el camino que sí existe.
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `SET LOCAL "mipiacetpv.eliminar_tenant" = '${t.id}'`,
        );
        await tx.$executeRawUnsafe(
          `DELETE FROM fiscal_records WHERE tenant_id = '${t.id}'`,
        );
        await tx.$executeRawUnsafe(`DELETE FROM tenants WHERE id = '${t.id}'`);
      });
      expect(await prisma.tenant.count({ where: { id: t.id } })).toBe(0);
    });
  });

  // ── 8 · la cascada del borrado del tenant NO es una puerta ──────────
  //
  // ADR-021 §6.3. Hasta esta migración, los cuatro guardias dejaban pasar el
  // DELETE cuando el tenant ya no existía —«esto es su borrado en cascada»—,
  // y la premisa de que a esa rama no se podía LLEGAR era falsa:
  // `fiscal_records.tenant_id` es `ON DELETE CASCADE`, así que un
  // `DELETE FROM tenants` a pelo entraba por ahí y se llevaba las facturas,
  // las ventas selladas y los fichajes sin marca, sin export y sin rastro.
  //
  // Lo que se prueba aquí es que la marca de «Eliminar cuenta» es la ÚNICA
  // puerta, y las tres formas de pasar por ella: sin marca NO, con la marca
  // de ESE tenant SÍ, con la marca de OTRO tenant NO.

  describe("8 · la cascada del borrado del tenant no es una puerta", () => {
    /** Una cuenta que factura, con un registro de facturación detrás. */
    async function cuentaConFactura(): Promise<string> {
      const t = await prisma.tenant.create({
        data: {
          name: `Cascada ${randomUUID().slice(0, 8)}`,
          holdedEnabled: false,
          facturaDesde: new Date("2026-10-17T07:00:00Z"),
          fiscalProfile: { legalName: "CASCADA SL", taxId: NIF },
        },
        select: { id: true },
      });
      const s = await prisma.store.create({
        data: { tenantId: t.id, name: "T" },
        select: { id: true },
      });
      const reg = await prisma.register.create({
        data: { storeId: s.id, name: "C" },
        select: { id: true },
      });
      // Sin `ticket_id`: así el DELETE llega al guardián del append-only y no
      // a la FK `RESTRICT` de `fiscal_records.ticket_id`. Lo que se prueba es
      // el guardián.
      await prisma.$executeRawUnsafe(
        `INSERT INTO fiscal_records
           (tenant_id, register_id, external_id, kind, chain_index, serie, numero,
            num_serie_factura, fecha_expedicion, tipo_factura, cuota_total, importe_total,
            huella, primer_registro, fecha_hora_huso_gen, huella_input, payload,
            generated_at, chain_status)
         VALUES ('${t.id}'::uuid, '${reg.id}'::uuid, '${randomUUID()}'::uuid, 'ALTA', 1,
            'C1', 1, 'C1/000001', '2026-10-17', 'F2', 0.21, 1.21,
            '${"B".repeat(64)}', true, '2026-10-17T09:00:00+02:00', 'x', '{}'::jsonb,
            now(), 'OK')`,
      );
      return t.id;
    }

    async function borrarElTenant(id: string, marca?: string): Promise<string> {
      try {
        await prisma.$transaction(async (tx) => {
          if (marca !== undefined) {
            await tx.$executeRawUnsafe(
              `SET LOCAL "mipiacetpv.eliminar_tenant" = '${marca}'`,
            );
          }
          await tx.$executeRawUnsafe(`DELETE FROM tenants WHERE id = '${id}'`);
        });
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
      return "";
    }

    it("sin la marca, el DELETE se lleva por delante REGISTRO_FISCAL_VIOLADO", async () => {
      const t = await cuentaConFactura();
      const msg = await borrarElTenant(t);
      expect(msg).toContain("REGISTRO_FISCAL_VIOLADO");
      // Y no borró NADA: la transacción entera se fue atrás.
      expect(await prisma.tenant.count({ where: { id: t } })).toBe(1);
      expect(await prisma.fiscalRecord.count({ where: { tenantId: t } })).toBe(1);

      // Limpieza por el único camino que existe.
      expect(await borrarElTenant(t, t)).toBe("");
    });

    it("con la marca de OTRO tenant, tampoco", async () => {
      const t = await cuentaConFactura();
      const msg = await borrarElTenant(t, randomUUID());
      expect(msg).toContain("REGISTRO_FISCAL_VIOLADO");
      expect(await prisma.fiscalRecord.count({ where: { tenantId: t } })).toBe(1);
      expect(await borrarElTenant(t, t)).toBe("");
    });

    it("con la marca de ESE tenant, pasa y la cuenta se va entera", async () => {
      const t = await cuentaConFactura();
      expect(await borrarElTenant(t, t)).toBe("");
      expect(await prisma.tenant.count({ where: { id: t } })).toBe(0);
      expect(await prisma.fiscalRecord.count({ where: { tenantId: t } })).toBe(0);
    });

    it("y la cascada tampoco se lleva una venta sellada", async () => {
      // Cuenta FACTURANDO: la excepción del reseteo del ensayo (§5.1) no
      // aplica, así que lo único que podía dejar pasar este DELETE era la
      // rama de cascada.
      const t = await prisma.tenant.create({
        data: {
          name: `Sellada ${randomUUID().slice(0, 8)}`,
          holdedEnabled: false,
          facturaDesde: new Date("2026-10-17T07:00:00Z"),
        },
        select: { id: true },
      });
      const s = await prisma.store.create({
        data: { tenantId: t.id, name: "T" },
        select: { id: true },
      });
      const reg = await prisma.register.create({
        data: { storeId: s.id, name: "C" },
        select: { id: true },
      });
      const u = await prisma.user.create({
        data: { tenantId: t.id, email: `u+${randomUUID()}@e2e.local`, role: "OWNER" },
        select: { id: true },
      });
      const sh = await prisma.shift.create({
        data: { registerId: reg.id, userId: u.id, cashOpening: 0 },
        select: { id: true },
      });
      const tk = await prisma.ticket.create({
        data: {
          tenantId: t.id,
          registerId: reg.id,
          shiftId: sh.id,
          userId: u.id,
          internalNumber: "000001",
          externalId: randomUUID(),
          publicSlug: randomUUID().replace(/-/g, "").slice(0, 12),
          status: "PAID",
          total: 8.5,
          totalTax: 0.77,
          totalDiscount: 0,
        },
        select: { id: true },
      });
      await prisma.$executeRawUnsafe(
        `UPDATE tickets SET sealed_at = now(), sealed_hash = repeat('a', 64) WHERE id = '${tk.id}'`,
      );

      expect(await borrarElTenant(t.id)).toContain("SELLO_VIOLADO");
      expect(await prisma.ticket.count({ where: { id: tk.id } })).toBe(1);
      // Y se va por la puerta, que aquí tiene que borrar el turno antes que
      // el usuario: `shifts_user_id_fkey` es RESTRICT y la cascada del tenant
      // se lleva los usuarios. Es el mismo orden de `eliminarLaCuenta`.
      await borrarCuentasDePrueba(prisma, t.id);
      expect(await prisma.ticket.count({ where: { id: tk.id } })).toBe(0);
      expect(await prisma.tenant.count({ where: { id: t.id } })).toBe(0);
    });

    it("ni un fichaje, que cuelga del empleado y no del tenant", async () => {
      // `time_entries` no tiene FK al tenant: la cascada le llegaba por
      // `employees.tenant_id`, que sí es CASCADE. Dos guardias en el mismo
      // DELETE, y el que levanta primero da igual: los dos dicen REGISTRO.
      const t = await prisma.tenant.create({
        data: {
          name: `Fichaje ${randomUUID().slice(0, 8)}`,
          holdedEnabled: false,
          fichajeEnabled: true,
        },
        select: { id: true },
      });
      const emp = await prisma.employee.create({
        data: { tenantId: t.id, name: "Ana" },
        select: { id: true },
      });
      const fichaje = await prisma.timeEntry.create({
        data: {
          tenantId: t.id,
          employeeId: emp.id,
          startedAt: new Date("2026-10-16T07:00:00Z"),
          startedServerAt: new Date("2026-10-16T07:00:00Z"),
          startSource: "PANEL",
          endedAt: new Date("2026-10-16T15:00:00Z"),
          endedServerAt: new Date("2026-10-16T15:00:00Z"),
          endSource: "PANEL",
        },
        select: { id: true },
      });

      expect(await borrarElTenant(t.id)).toContain("REGISTRO_VIOLADO");
      expect(await prisma.timeEntry.count({ where: { id: fichaje.id } })).toBe(1);
      expect(await borrarElTenant(t.id, t.id)).toBe("");
      expect(await prisma.timeEntry.count({ where: { id: fichaje.id } })).toBe(0);
      expect(await prisma.employee.count({ where: { id: emp.id } })).toBe(0);
    });
  });

});
