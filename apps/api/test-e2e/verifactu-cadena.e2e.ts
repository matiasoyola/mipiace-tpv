// V1-verifactu · la cadena de una caja, contra Postgres de verdad.
//
// Por qué tiene que ser e2e: lo que se prueba aquí es que **el MOTOR**
// rechaza el cambio y que **el MOTOR** verifica la cadena recalculando las
// huellas con su propio `sha256()`. Con un Prisma falso sólo se probaría
// que la aplicación se porta bien, y la aplicación no es la única puerta a
// Postgres — la misma razón de `sello-de-la-venta.e2e.ts` (ADR-015 §1) y de
// `f2-registro-inalterable.e2e.ts`.
//
// Los registros se generan con `@mipiacetpv/verifactu`, que es literalmente
// el mismo código que corre en la tablet, y entran por `POST /tickets` como
// entrarían de verdad. Nada se inserta a mano salvo los sabotajes, que van
// por `$executeRawUnsafe` porque así los escribiría alguien con acceso al
// VPS.
//
// El criterio de hecho del bloque, punto por punto:
//   · un comercio sin Holded cobra con y sin red, y cada ticket lleva su
//     serie, su número correlativo, su QR y su leyenda;
//   · la cadena se verifica íntegra después de las dos cosas;
//   · un UPDATE o un DELETE a mano sobre un registro falla;
//   · un comercio con Holded no ve ningún cambio.

import { randomBytes, randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { E2E_DATABASE_URL, e2eEnabled, SKIP_MESSAGE } from "./e2e-env.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  E2E_DATABASE_URL || "postgresql://e2e:e2e@127.0.0.1:5432/e2e";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET = "e".repeat(40);
process.env.JWT_REFRESH_SECRET = "f".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

vi.mock("../src/queues/ticket-upload.js", () => ({
  enqueueTicketUpload: async () => {},
}));
vi.mock("../src/queues/ticket-email.js", () => ({
  enqueueTicketEmail: async () => {},
}));

import {
  buildQrUrl,
  buildRegistroAlta,
  buildRegistroAnulacion,
  type CabezaDeCadena,
  descripcionOperacionPorVertical,
  fechaAeatDeIso,
  formatNumSerieFactura,
  importeAeat,
} from "@mipiacetpv/verifactu";

const { getPrisma, shutdown } = await import("../src/context.js");
const { registerShiftRoutes } = await import("../src/shift/routes.js");
const { registerTicketRoutes } = await import("../src/tickets/routes.js");
const { registerFiscalRoutes } = await import("../src/fiscal/routes.js");
const { registerErrorHandler } = await import("../src/lib/error-handler.js");
const { registerLenientJsonParser } = await import("../src/lib/lenient-json.js");
const { signCashierSession } = await import("../src/shift/cashier-session.js");

const NIF = "B45902186";
const RAZON = "PELUQUERÍA SOLE SL";

interface FilaVerificacion {
  chain_index: number;
  huella_ok: boolean;
  input_ok: boolean;
  enlace_ok: boolean;
  numeracion_ok: boolean;
  chain_status: string;
}

describe.skipIf(!e2eEnabled)("e2e · la cadena de facturación de una caja", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let app: FastifyInstance;

  let tenantId = "";
  let registerId = "";
  let deviceId = "";
  let shiftId = "";
  let token = "";
  let serie = "";
  let instalacion = "";

  // La cabeza de cadena del "dispositivo": exactamente el mismo estado que
  // el TPV lleva en su IndexedDB.
  let cabeza: CabezaDeCadena | null = null;

  const auth = () => ({ authorization: `Bearer ${token}` });

  async function saboteo(sql: string): Promise<string | null> {
    try {
      await prisma.$executeRawUnsafe(sql);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  function verificar(): Promise<FilaVerificacion[]> {
    return prisma.$queryRawUnsafe<FilaVerificacion[]>(
      `SELECT chain_index, huella_ok, input_ok, enlace_ok, numeracion_ok,
              chain_status::text AS chain_status
         FROM mipiacetpv_verify_fiscal_chain('${registerId}'::uuid)`,
    );
  }

  async function resumen(): Promise<{
    total: bigint;
    integra: boolean;
    primer_fallo_index: number | null;
  }> {
    const rows = await prisma.$queryRawUnsafe<
      { total: bigint; integra: boolean; primer_fallo_index: number | null }[]
    >(`SELECT * FROM mipiacetpv_fiscal_chain_summary('${registerId}'::uuid)`);
    return rows[0]!;
  }

  /** Una venta, generando el registro EXACTAMENTE como lo genera la tablet:
   *  número siguiente de la serie, huella encadenada con la cabeza local, y
   *  todo dentro del cuerpo del POST. */
  async function cobrar(args: {
    unitPrice: number;
    taxRate?: number;
    /** Simula un cobro sin red: el registro se generó hace rato y llega
     *  ahora. La `generatedAt` va atrás, la cadena sigue en orden. */
    generadoHaceMinutos?: number;
  }): Promise<{ status: number; body: any; numSerieFactura: string; qrUrl: string }> {
    const taxRate = args.taxRate ?? 21;
    const base = Math.round(args.unitPrice * 100) / 100;
    const cuota = Math.round(base * (taxRate / 100) * 100) / 100;
    const total = Math.round((base + cuota) * 100) / 100;

    const numero = (cabeza?.ultimoNumero ?? 0) + 1;
    const chainIndex = (cabeza?.chainIndex ?? 0) + 1;
    const numSerieFactura = formatNumSerieFactura(serie, numero);
    const generadoEn = new Date(
      Date.now() - (args.generadoHaceMinutos ?? 0) * 60_000,
    );
    const fechaIso = generadoEn.toISOString().slice(0, 10);
    const fechaHoraHusoGenRegistro = `${generadoEn.toISOString().slice(0, 19)}+00:00`;

    const { registro, huellaInput, huella } = await buildRegistroAlta({
      version: "e2e",
      numeroInstalacion: instalacion,
      idEmisorFactura: NIF,
      nombreRazonEmisor: RAZON,
      numSerieFactura,
      fechaExpedicion: fechaIso,
      descripcionOperacion: descripcionOperacionPorVertical("SERVICES"),
      desglose: [
        { tipoImpositivo: taxRate, baseImponible: base, cuotaRepercutida: cuota },
      ],
      cuotaTotal: cuota,
      importeTotal: total,
      cabeza,
      fechaHoraHusoGenRegistro,
    });

    const res = await app.inject({
      method: "POST",
      url: "/tickets",
      headers: auth(),
      payload: {
        externalId: randomUUID(),
        registerId,
        shiftId,
        lines: [
          {
            nameSnapshot: "Corte de pelo",
            sku: "TPV-CORTE",
            units: 1,
            unitPrice: base,
            discountPct: 0,
            taxRate,
          },
        ],
        payments: [{ method: "CASH", amount: total }],
        fiscalRecord: {
          externalId: randomUUID(),
          kind: "ALTA",
          chainIndex,
          serie,
          numero,
          generatedAt: generadoEn.toISOString(),
          huellaInput,
          payload: registro,
        },
      },
    });

    // La cabeza avanza en el dispositivo pase lo que pase con el envío.
    cabeza = {
      chainIndex,
      idEmisorFactura: NIF,
      numSerieFactura,
      fechaExpedicion: fechaIso,
      huella,
      fechaHoraHusoGenRegistro,
      huellaInput,
      ultimoNumero: numero,
      serie,
    };

    return {
      status: res.statusCode,
      body: res.json(),
      numSerieFactura,
      qrUrl: buildQrUrl({
        entorno: "PRUEBAS",
        nif: NIF,
        numSerieFactura,
        fechaExpedicion: fechaAeatDeIso(fechaIso),
        importeTotal: importeAeat(total),
      }),
    };
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
        name: RAZON,
        businessType: "SERVICES",
        // Lo que enciende todo esto: el comercio NO usa Holded.
        holdedEnabled: false,
        fiscalProfile: {
          legalName: RAZON,
          taxId: NIF,
          address: "C/ Mayor 10",
          phone: "925000000",
        },
      },
      select: { id: true },
    });
    tenantId = tenant.id;
    const store = await prisma.store.create({
      data: { tenantId, name: "Peluquería Sole" },
      select: { id: true },
    });
    const register = await prisma.register.create({
      data: { storeId: store.id, name: "Caja 1" },
      // La serie y la instalación NO se pasan: las pone la base.
      select: { id: true, fiscalSeries: true, fiscalInstallationId: true },
    });
    registerId = register.id;
    serie = register.fiscalSeries!;
    instalacion = register.fiscalInstallationId!;

    const device = await prisma.device.create({
      data: { tenantId, registerId, deviceTokenHash: randomUUID() },
      select: { id: true },
    });
    deviceId = device.id;

    const cashier = await prisma.user.create({
      data: {
        tenantId,
        email: `verifactu+${randomUUID()}@e2e.local`,
        alias: "Ana",
        role: "CASHIER",
      },
      select: { id: true },
    });
    token = signCashierSession(
      {
        sub: cashier.id,
        tid: tenantId,
        did: deviceId,
        rid: registerId,
        role: "CASHIER",
      },
      720,
    );

    const opened = await app.inject({
      method: "POST",
      url: "/shift/open",
      headers: auth(),
      payload: { registerId, cashOpening: 0 },
    });
    shiftId = opened.json().shift.id;
  });

  afterAll(async () => {
    // Se intenta limpiar por higiene y NO se hace fallar la suite si el
    // grafo de claves ajenas no deja: `shifts.user_id` es RESTRICT y los
    // guards de S1 y de este bloque impiden borrar tickets con venta
    // sellada o factura emitida. Es decir, no se puede limpiar del todo
    // precisamente porque el bloque funciona.
    //
    // La base del e2e se recrea entera en cada pasada (`global-setup` hace
    // DROP SCHEMA), así que lo que quede no ensucia la siguiente.
    await prisma
      .$executeRawUnsafe(`DELETE FROM tenants WHERE id = '${tenantId}'`)
      .catch(() => undefined);
    await shutdown();
  });

  // ── La caja nace lista ───────────────────────────────────────────────

  it("la caja nace con serie y número de instalación, sin que nadie se los ponga", () => {
    expect(serie).toMatch(/^C\d+$/);
    expect(instalacion).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("GET /tpv/fiscal/head dice que emite y con qué", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/tpv/fiscal/head",
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.emite).toBe(true);
    expect(body.nif).toBe(NIF);
    expect(body.serie).toBe(serie);
    expect(body.numeroInstalacion).toBe(instalacion);
    expect(body.entorno).toBe("PRUEBAS");
    // Y la cabecera del papel, para poder imprimir sin red.
    expect(body.cabecera.taxId).toBe(NIF);
    expect(body.cabecera.businessName).toBe("Peluquería Sole");
    // Todavía no hay cadena.
    expect(body.cabeza).toBeNull();
  });

  // ── Con red ──────────────────────────────────────────────────────────

  it("tres ventas con red: cada una con su número correlativo y su registro OK", async () => {
    for (let i = 1; i <= 3; i += 1) {
      const venta = await cobrar({ unitPrice: 10 + i });
      expect(venta.status).toBe(201);
      expect(venta.numSerieFactura).toBe(
        `${serie}/${String(i).padStart(6, "0")}`,
      );
      expect(venta.body.fiscalRecord.chainStatus).toBe("OK");
      expect(venta.body.fiscalRecord.chainError).toBeNull();
    }
  });

  it("el QR de cada factura lleva sus cuatro parámetros", async () => {
    const venta = await cobrar({ unitPrice: 20 });
    expect(venta.qrUrl).toContain("https://prewww2.aeat.es/");
    expect(venta.qrUrl).toContain(`nif=${NIF}`);
    expect(venta.qrUrl).toContain("numserie=");
    expect(venta.qrUrl).toContain("fecha=");
    expect(venta.qrUrl).toContain("importe=");
  });

  // ── Sin red ──────────────────────────────────────────────────────────

  it("dos ventas generadas SIN RED y subidas después encadenan igual", async () => {
    const a = await cobrar({ unitPrice: 5, generadoHaceMinutos: 45 });
    const b = await cobrar({ unitPrice: 7, generadoHaceMinutos: 40 });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.fiscalRecord.chainStatus).toBe("OK");
    expect(b.body.fiscalRecord.chainStatus).toBe("OK");

    // Y se ve que se generaron sin conexión: el reloj del dispositivo va
    // muy por detrás del del servidor. No hay ningún flag que lo diga —
    // se DERIVA de la distancia entre las dos marcas.
    const filas = await prisma.$queryRawUnsafe<
      { desfase_segundos: number }[]
    >(`SELECT EXTRACT(EPOCH FROM (received_at - generated_at))::int AS desfase_segundos
         FROM fiscal_records
        WHERE register_id = '${registerId}'::uuid
        ORDER BY chain_index DESC LIMIT 2`);
    expect(filas.every((f) => f.desfase_segundos > 30 * 60)).toBe(true);
  });

  // ── La cadena, verificada por el motor ───────────────────────────────

  it("la cadena se verifica ÍNTEGRA después de ventas con y sin red", async () => {
    const filas = await verificar();
    expect(filas.length).toBeGreaterThanOrEqual(6);
    for (const f of filas) {
      expect(
        {
          i: f.chain_index,
          huella: f.huella_ok,
          input: f.input_ok,
          enlace: f.enlace_ok,
          numeracion: f.numeracion_ok,
          estado: f.chain_status,
        },
        `el registro ${f.chain_index} no está íntegro`,
      ).toEqual({
        i: f.chain_index,
        huella: true,
        input: true,
        enlace: true,
        numeracion: true,
        estado: "OK",
      });
    }
    const r = await resumen();
    expect(r.integra).toBe(true);
    expect(r.primer_fallo_index).toBeNull();
  });

  // ── La anulación ─────────────────────────────────────────────────────

  it("anular una venta cobrada NO borra nada: añade un registro a la cadena", async () => {
    const venta = await cobrar({ unitPrice: 30 });
    const ticketId = venta.body.ticket.id;
    const numeroAntes = cabeza!.ultimoNumero;

    const chainIndex = cabeza!.chainIndex + 1;
    const fechaIso = cabeza!.fechaExpedicion;
    const generadoEn = new Date();
    const { registro, huellaInput, huella } = await buildRegistroAnulacion({
      version: "e2e",
      numeroInstalacion: instalacion,
      idEmisorFacturaAnulada: NIF,
      nombreRazonEmisor: RAZON,
      numSerieFacturaAnulada: venta.numSerieFactura,
      fechaExpedicionFacturaAnulada: fechaIso,
      cabeza,
      fechaHoraHusoGenRegistro: `${generadoEn.toISOString().slice(0, 19)}+00:00`,
    });

    const res = await app.inject({
      method: "POST",
      url: `/tickets/${ticketId}/fiscal-void`,
      headers: auth(),
      payload: {
        fiscalRecord: {
          externalId: randomUUID(),
          kind: "ANULACION",
          chainIndex,
          serie,
          numero: numeroAntes,
          generatedAt: generadoEn.toISOString(),
          huellaInput,
          payload: registro,
        },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().fiscalRecord.chainStatus).toBe("OK");

    cabeza = {
      ...cabeza!,
      chainIndex,
      huella,
      huellaInput,
      numSerieFactura: venta.numSerieFactura,
      fechaHoraHusoGenRegistro: `${generadoEn.toISOString().slice(0, 19)}+00:00`,
    };

    // El ticket sigue ahí. Anular no es borrar.
    const sigue = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true },
    });
    expect(sigue).not.toBeNull();

    // La cadena sigue íntegra y la anulación NO gastó número.
    const r = await resumen();
    expect(r.integra).toBe(true);
    const siguiente = await cobrar({ unitPrice: 9 });
    expect(siguiente.numSerieFactura).toBe(
      `${serie}/${String(numeroAntes + 1).padStart(6, "0")}`,
    );
  });

  it("la misma factura no se anula dos veces", async () => {
    const venta = await cobrar({ unitPrice: 12 });
    const ticketId = venta.body.ticket.id;
    const anular = async () => {
      const chainIndex = cabeza!.chainIndex + 1;
      const generadoEn = new Date();
      const fechaHora = `${generadoEn.toISOString().slice(0, 19)}+00:00`;
      const { registro, huellaInput, huella } = await buildRegistroAnulacion({
        version: "e2e",
        numeroInstalacion: instalacion,
        idEmisorFacturaAnulada: NIF,
        nombreRazonEmisor: RAZON,
        numSerieFacturaAnulada: venta.numSerieFactura,
        fechaExpedicionFacturaAnulada: cabeza!.fechaExpedicion,
        cabeza,
        fechaHoraHusoGenRegistro: fechaHora,
      });
      const res = await app.inject({
        method: "POST",
        url: `/tickets/${ticketId}/fiscal-void`,
        headers: auth(),
        payload: {
          fiscalRecord: {
            externalId: randomUUID(),
            kind: "ANULACION",
            chainIndex,
            serie,
            numero: cabeza!.ultimoNumero,
            generatedAt: generadoEn.toISOString(),
            huellaInput,
            payload: registro,
          },
        },
      });
      if (res.statusCode === 201) {
        cabeza = {
          ...cabeza!,
          chainIndex,
          huella,
          huellaInput,
          numSerieFactura: venta.numSerieFactura,
          fechaHoraHusoGenRegistro: fechaHora,
        };
      }
      return res;
    };
    expect((await anular()).statusCode).toBe(201);
    const segunda = await anular();
    expect(segunda.statusCode).toBe(409);
    expect(segunda.json().error).toBe("FACTURA_YA_ANULADA");
  });

  // ── Los sabotajes ────────────────────────────────────────────────────

  describe("sabotaje: lo que el motor tiene que rechazar", () => {
    it("un UPDATE a mano sobre un registro falla", async () => {
      const msg = await saboteo(
        `UPDATE fiscal_records SET importe_total = 0.01
          WHERE register_id = '${registerId}'::uuid AND chain_index = 1`,
      );
      expect(msg).toContain("REGISTRO_FISCAL_VIOLADO");
      expect(msg).toContain("no se modifica");
    });

    it("un DELETE a mano sobre un registro falla", async () => {
      const msg = await saboteo(
        `DELETE FROM fiscal_records
          WHERE register_id = '${registerId}'::uuid AND chain_index = 1`,
      );
      expect(msg).toContain("REGISTRO_FISCAL_VIOLADO");
      expect(msg).toContain("no se borra");
    });

    it("reescribir la huella de un registro falla igual", async () => {
      const msg = await saboteo(
        `UPDATE fiscal_records SET huella = repeat('A', 64)
          WHERE register_id = '${registerId}'::uuid AND chain_index = 2`,
      );
      expect(msg).toContain("REGISTRO_FISCAL_VIOLADO");
    });

    it("cambiar la serie de una caja que ya emitió falla", async () => {
      const msg = await saboteo(
        `UPDATE registers SET fiscal_series = 'ZZ' WHERE id = '${registerId}'::uuid`,
      );
      expect(msg).toContain("REGISTRO_FISCAL_VIOLADO");
      expect(msg).toContain("no se cambian");
    });

    it("borrar un ticket con factura emitida falla", async () => {
      const t = await prisma.fiscalRecord.findFirst({
        where: { registerId, kind: "ALTA", ticketId: { not: null } },
        select: { ticketId: true },
      });
      const msg = await saboteo(
        `DELETE FROM tickets WHERE id = '${t!.ticketId}'::uuid`,
      );
      // Quien contesta primero es el guard de S1 (`tickets_delete_guard`,
      // por orden alfabético de trigger): la venta está sellada y una venta
      // sellada no se borra. Perfecto — el ticket está protegido dos veces
      // y la primera ya basta.
      expect(msg).toContain("SELLO_VIOLADO");
      const sigue = await prisma.ticket.count({ where: { id: t!.ticketId! } });
      expect(sigue).toBe(1);
    });

    it("y el ticket TEST, que S1 sí deja borrar, lo para el guard fiscal", async () => {
      // S1 deja pasar el borrado de un ticket `TEST` a propósito (limpieza
      // de implantación). Si además tiene factura emitida, no: si se emitió
      // factura, hay factura, y da igual qué cajero la hizo. Ésa es la única
      // razón de existir de `tickets_fiscal_link_guard`.
      const t = await prisma.fiscalRecord.findFirst({
        where: { registerId, kind: "ALTA", ticketId: { not: null } },
        orderBy: { chainIndex: "desc" },
        select: { ticketId: true },
      });
      await prisma.$executeRawUnsafe(
        `UPDATE tickets SET status = 'TEST' WHERE id = '${t!.ticketId}'::uuid`,
      );
      const msg = await saboteo(
        `DELETE FROM tickets WHERE id = '${t!.ticketId}'::uuid`,
      );
      expect(msg).toContain("REGISTRO_FISCAL_VIOLADO");
      expect(msg).toContain("tiene factura emitida");
      await prisma.$executeRawUnsafe(
        `UPDATE tickets SET status = 'PAID' WHERE id = '${t!.ticketId}'::uuid`,
      );
    });

    it("emparejar un segundo terminal revoca el anterior, y queda la traza", async () => {
      // La ruta de emparejamiento NO hace nada de esto: lo hace el trigger
      // `devices_revoke_previous`. Por eso el sabotaje es un INSERT crudo —
      // si el invariante viviera en la ruta, este INSERT dejaría dos
      // terminales vivos en la misma caja y nadie se enteraría.
      const nuevo = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO devices (id, tenant_id, register_id, device_token_hash)
         VALUES ('${nuevo}'::uuid, '${tenantId}'::uuid, '${registerId}'::uuid, '${randomUUID()}')`,
      );
      const activos = await prisma.device.count({
        where: { registerId, revokedAt: null },
      });
      expect(activos).toBe(1);

      const anterior = await prisma.device.findUniqueOrThrow({
        where: { id: deviceId },
        select: { revokedAt: true, revokedReason: true, revokedByDeviceId: true },
      });
      expect(anterior.revokedAt).not.toBeNull();
      expect(anterior.revokedReason).toBe("PAIRED_NEW");
      expect(anterior.revokedByDeviceId).toBe(nuevo);
      deviceId = nuevo;
    });

    it("y si el trigger no estuviera, el índice pararía el INSERT igual", async () => {
      // Cinturón y tirantes, comprobado: se revoca a mano el trigger de una
      // transacción (se desactiva y se revierte) para ver que lo que queda
      // debajo es el índice único, no una promesa.
      let msg: string | null = null;
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `ALTER TABLE devices DISABLE TRIGGER devices_revoke_previous`,
          );
          await tx.$executeRawUnsafe(
            `INSERT INTO devices (id, tenant_id, register_id, device_token_hash)
             VALUES (gen_random_uuid(), '${tenantId}'::uuid, '${registerId}'::uuid, '${randomUUID()}')`,
          );
        });
      } catch (err) {
        // El INSERT revienta y la transacción entera se deshace: el
        // trigger vuelve a estar activo solo.
        msg = err instanceof Error ? err.message : String(err);
      }
      // Prisma convierte los 23505 en un error estructurado y se queda sin
      // mensaje; lo que importa es el código y que el INSERT no pasó.
      expect(msg).toContain("23505");
      const activos = await prisma.device.count({
        where: { registerId, revokedAt: null },
      });
      expect(activos).toBe(1);
    });

    it("dos cajas del mismo comercio con la misma serie falla", async () => {
      const store = await prisma.store.findFirstOrThrow({
        where: { tenantId },
        select: { id: true },
      });
      const msg = await saboteo(
        `INSERT INTO registers (id, store_id, name, fiscal_series)
         VALUES (gen_random_uuid(), '${store.id}'::uuid, 'Caja clon', '${serie}')`,
      );
      expect(msg).toContain("SERIE_FISCAL_DUPLICADA");
    });

    it("la cadena sigue íntegra después de todos los sabotajes", async () => {
      const r = await resumen();
      expect(r.integra).toBe(true);
      expect(r.primer_fallo_index).toBeNull();
    });
  });

  // ── Un registro que no encadena ──────────────────────────────────────

  describe("un registro que no encadena", () => {
    it("se guarda MARCADO y se ve, en vez de descartarse", async () => {
      // Segunda caja del mismo comercio, con su propia cadena. Le metemos
      // un registro que encadena con la huella de la PRIMERA caja: es tan
      // roto como no encadenar.
      const store = await prisma.store.findFirstOrThrow({
        where: { tenantId },
        select: { id: true },
      });
      const otra = await prisma.register.create({
        data: { storeId: store.id, name: "Caja 2" },
        select: { id: true, fiscalSeries: true, fiscalInstallationId: true },
      });

      const generadoEn = new Date();
      const fechaHora = `${generadoEn.toISOString().slice(0, 19)}+00:00`;
      const { registro, huellaInput } = await buildRegistroAlta({
        version: "e2e",
        numeroInstalacion: otra.fiscalInstallationId!,
        idEmisorFactura: NIF,
        nombreRazonEmisor: RAZON,
        numSerieFactura: formatNumSerieFactura(otra.fiscalSeries!, 1),
        fechaExpedicion: generadoEn.toISOString().slice(0, 10),
        descripcionOperacion: "Prestación de servicios",
        desglose: [
          { tipoImpositivo: 21, baseImponible: 10, cuotaRepercutida: 2.1 },
        ],
        cuotaTotal: 2.1,
        importeTotal: 12.1,
        // ← LA CABEZA DE LA OTRA CAJA.
        cabeza,
        fechaHoraHusoGenRegistro: fechaHora,
      });

      const { ingestFiscalRecord } = await import("../src/fiscal/ingest.js");
      const resultado = await prisma.$transaction((tx) =>
        ingestFiscalRecord({
          tx,
          tenantId,
          registerId: otra.id,
          deviceId: null,
          ticketId: null,
          body: {
            externalId: randomUUID(),
            kind: "ALTA",
            chainIndex: 1,
            serie: otra.fiscalSeries!,
            numero: 1,
            generatedAt: generadoEn.toISOString(),
            huellaInput,
            payload: registro as unknown as Record<string, unknown>,
          },
        }),
      );

      expect(resultado.chainStatus).toBe("BROKEN");
      expect(resultado.chainError).toContain("PRIMERO_SIN_DECIRLO");

      // Está guardado y sale en el listado del super-admin.
      const rotos = await prisma.fiscalRecord.findMany({
        where: { tenantId, chainStatus: "BROKEN" },
        select: { id: true },
      });
      expect(rotos.length).toBe(1);

      // Y la verificación de ESA caja lo dice.
      const filas = await prisma.$queryRawUnsafe<FilaVerificacion[]>(
        `SELECT chain_index, huella_ok, input_ok, enlace_ok, numeracion_ok,
                chain_status::text AS chain_status
           FROM mipiacetpv_verify_fiscal_chain('${otra.id}'::uuid)`,
      );
      expect(filas[0]!.enlace_ok).toBe(false);
      expect(filas[0]!.chain_status).toBe("BROKEN");
      // La huella en sí es correcta: lo que está mal es con qué encadena.
      // Que las dos preguntas se contesten por separado es lo que permite
      // saber QUÉ pasó y no sólo que algo pasó.
      expect(filas[0]!.huella_ok).toBe(true);
    });
  });

  // ── El comercio con Holded ───────────────────────────────────────────

  describe("un comercio con Holded no ve ningún cambio", () => {
    let otroTenantId = "";
    let otroToken = "";
    let otroShiftId = "";
    let otroRegisterId = "";

    beforeAll(async () => {
      const t = await prisma.tenant.create({
        data: { name: "Con Holded e2e", businessType: "RETAIL" },
        select: { id: true, holdedEnabled: true },
      });
      otroTenantId = t.id;
      // El default de la columna es `true`: un tenant de hoy.
      expect(t.holdedEnabled).toBe(true);
      const store = await prisma.store.create({
        data: { tenantId: otroTenantId, name: "Tienda" },
        select: { id: true },
      });
      const reg = await prisma.register.create({
        data: { storeId: store.id, name: "Caja" },
        select: { id: true },
      });
      otroRegisterId = reg.id;
      const dev = await prisma.device.create({
        data: {
          tenantId: otroTenantId,
          registerId: otroRegisterId,
          deviceTokenHash: randomUUID(),
        },
        select: { id: true },
      });
      const u = await prisma.user.create({
        data: {
          tenantId: otroTenantId,
          email: `holded+${randomUUID()}@e2e.local`,
          role: "CASHIER",
        },
        select: { id: true },
      });
      otroToken = signCashierSession(
        {
          sub: u.id,
          tid: otroTenantId,
          did: dev.id,
          rid: otroRegisterId,
          role: "CASHIER",
        },
        720,
      );
      const opened = await app.inject({
        method: "POST",
        url: "/shift/open",
        headers: { authorization: `Bearer ${otroToken}` },
        payload: { registerId: otroRegisterId, cashOpening: 0 },
      });
      otroShiftId = opened.json().shift.id;
    });

    afterAll(async () => {
      await prisma
        .$executeRawUnsafe(`DELETE FROM tenants WHERE id = '${otroTenantId}'`)
        .catch(() => undefined);
    });

    it("su /tpv/fiscal/head dice que no emite, y nada más", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/tpv/fiscal/head",
        headers: { authorization: `Bearer ${otroToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ emite: false });
    });

    it("cobra exactamente igual que siempre, sin registro de facturación", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/tickets",
        headers: { authorization: `Bearer ${otroToken}` },
        payload: {
          externalId: randomUUID(),
          registerId: otroRegisterId,
          shiftId: otroShiftId,
          lines: [
            {
              nameSnapshot: "Libro",
              sku: "TPV-LIBRO",
              units: 1,
              unitPrice: 10,
              discountPct: 0,
              taxRate: 4,
            },
          ],
          payments: [{ method: "CASH", amount: 10.4 }],
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().fiscalRecord).toBeNull();
      const n = await prisma.fiscalRecord.count({ where: { tenantId: otroTenantId } });
      expect(n).toBe(0);
    });

    it("SABOTAJE · si mandara un registro de facturación, se RECHAZA", async () => {
      const generadoEn = new Date();
      const { registro, huellaInput } = await buildRegistroAlta({
        version: "e2e",
        numeroInstalacion: "x",
        idEmisorFactura: NIF,
        nombreRazonEmisor: "Con Holded",
        numSerieFactura: "C1/000001",
        fechaExpedicion: generadoEn.toISOString().slice(0, 10),
        descripcionOperacion: "Venta al por menor",
        desglose: [
          { tipoImpositivo: 21, baseImponible: 10, cuotaRepercutida: 2.1 },
        ],
        cuotaTotal: 2.1,
        importeTotal: 12.1,
        cabeza: null,
        fechaHoraHusoGenRegistro: `${generadoEn.toISOString().slice(0, 19)}+00:00`,
      });
      const res = await app.inject({
        method: "POST",
        url: "/tickets",
        headers: { authorization: `Bearer ${otroToken}` },
        payload: {
          externalId: randomUUID(),
          registerId: otroRegisterId,
          shiftId: otroShiftId,
          lines: [
            {
              nameSnapshot: "Libro",
              sku: "TPV-LIBRO",
              units: 1,
              unitPrice: 10,
              discountPct: 0,
              taxRate: 21,
            },
          ],
          payments: [{ method: "CASH", amount: 12.1 }],
          fiscalRecord: {
            externalId: randomUUID(),
            kind: "ALTA",
            chainIndex: 1,
            serie: "C1",
            numero: 1,
            generatedAt: generadoEn.toISOString(),
            huellaInput,
            payload: registro,
          },
        },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("FISCAL_MODE_OFF");
      const n = await prisma.fiscalRecord.count({ where: { tenantId: otroTenantId } });
      expect(n).toBe(0);
    });
  });
});
