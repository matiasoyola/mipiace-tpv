// verifactu-1b · el dispositivo del modo prueba no es un terminal de caja.
//
// Por qué tiene que ser e2e, y no un test con un Prisma falso: lo que se
// prueba aquí es que **el MOTOR** distingue los dos tipos de dispositivo. El
// trigger, el índice único parcial y la precondición de la migración viven
// en Postgres, y la aplicación no es la única puerta a Postgres — la misma
// razón de `verifactu-cadena.e2e.ts` y de `f2-registro-inalterable.e2e.ts`.
//
// El fallo que este fichero impide que vuelva: activar el modo prueba desde
// el super-admin REVOCABA el terminal real del cliente, porque el trigger
// `devices_revoke_previous` trataba al dispositivo técnico como un terminal
// más. Un comercio sin poder cobrar, desde una pantalla interna.
//
// Los seis puntos del criterio de hecho, en orden:
//
//   1. Activar el modo prueba en una caja con terminal real → el terminal
//      real sigue activo.
//   2. Reactivar el modo prueba (revocado → activo) → ni 500 ni choque con
//      el índice; los dos quedan activos.
//   3. Emparejar un terminal nuevo → releva al terminal anterior y NO al
//      técnico.
//   4. Venta en modo prueba en un comercio sin Holded → cero filas nuevas
//      en `fiscal_records` y la cabeza de la serie no se mueve.
//   5. El espejo del servidor rechaza los registros de una sesión de
//      prueba.
//   6. La precondición de la migración no cuenta dispositivos técnicos, y
//      con dos TERMINAL activos en una caja sigue abortando.
//
// Los sabotajes van con `$executeRawUnsafe` porque así los escribiría
// alguien con acceso al VPS: si el invariante viviera en la ruta y no en el
// motor, estos INSERT pasarían y nadie se enteraría.

import { readFileSync } from "node:fs";
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
const { issueTestCashierSession, provisionTestCashier } = await import(
  "../src/superadmin/test-cashier.js"
);

const NIF = "B45902186";
const RAZON = "PELUQUERÍA SOLE SL";

// El bloque `DO $do$ … $do$;` de la migración, LEÍDO DE LA MIGRACIÓN.
//
// No se copia aquí a mano: una copia se queda vieja el día que alguien toca
// la migración, y entonces este test pasaría verificando un SQL que ya no
// es el que corre en producción. Lo que se ejecuta abajo es literalmente la
// precondición del despliegue.
const MIGRATION_SQL = readFileSync(
  new URL(
    "../../../packages/db/prisma/migrations/20260924000000_verifactu_1_registro/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

/** El `UPDATE devices SET kind = 'TEST' …` de la migración, también leído
 *  de la migración y por el mismo motivo que la precondición. */
function backfillDeLaMigracion(): string {
  const ini = MIGRATION_SQL.indexOf("UPDATE devices");
  const fin = MIGRATION_SQL.indexOf(";", ini);
  if (ini < 0 || fin < 0) {
    throw new Error("no se encuentra el backfill de devices.kind");
  }
  const bloque = MIGRATION_SQL.slice(ini, fin + 1);
  if (!bloque.includes("SET kind = 'TEST'")) {
    throw new Error("el bloque extraído no es el backfill de devices.kind");
  }
  return bloque;
}

function precondicionDeLaMigracion(): string {
  const ini = MIGRATION_SQL.indexOf("DO $do$");
  const fin = MIGRATION_SQL.indexOf("$do$;", ini);
  if (ini < 0 || fin < 0) {
    throw new Error("no se encuentra el bloque DO de la precondición");
  }
  const bloque = MIGRATION_SQL.slice(ini, fin + "$do$;".length);
  // Red de seguridad sobre la extracción: si este `slice` dejara de coger lo
  // que creemos, el test de abajo pasaría por no ejecutar nada.
  if (!bloque.includes("VERIFACTU_PRECONDICION")) {
    throw new Error("el bloque extraído no es la precondición");
  }
  return bloque;
}

describe.skipIf(!e2eEnabled)("e2e · el modo prueba no es un terminal", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let app: FastifyInstance;

  let tenantId = "";
  let storeId = "";
  let registerId = "";
  // El terminal REAL del cliente. Es el que no se puede quedar sin cobrar.
  let terminalRealId = "";
  let serie = "";
  let instalacion = "";
  let tokenReal = "";
  let shiftReal = "";

  async function activos(): Promise<{ id: string; kind: string }[]> {
    const filas = await prisma.device.findMany({
      where: { registerId, revokedAt: null },
      select: { id: true, kind: true },
      orderBy: { pairedAt: "asc" },
    });
    return filas.map((d) => ({ id: d.id, kind: d.kind }));
  }

  async function cabezaDeLaCadena(): Promise<{
    chainIndex: number;
    ultimoNumero: number;
    filas: number;
  }> {
    const filas = await prisma.fiscalRecord.count({ where: { registerId } });
    const ultimo = await prisma.fiscalRecord.findFirst({
      where: { registerId },
      orderBy: { chainIndex: "desc" },
      select: { chainIndex: true },
    });
    const ultimaAlta = await prisma.fiscalRecord.findFirst({
      where: { registerId, kind: "ALTA" },
      orderBy: { numero: "desc" },
      select: { numero: true },
    });
    return {
      chainIndex: ultimo?.chainIndex ?? 0,
      ultimoNumero: ultimaAlta?.numero ?? 0,
      filas,
    };
  }

  /** Un registro de ALTA generado EXACTAMENTE como lo genera la tablet. */
  async function registroDeVenta(cabeza: CabezaDeCadena | null, total: number) {
    const base = Math.round((total / 1.21) * 100) / 100;
    const cuota = Math.round((total - base) * 100) / 100;
    const numero = (cabeza?.ultimoNumero ?? 0) + 1;
    const chainIndex = (cabeza?.chainIndex ?? 0) + 1;
    const ahora = new Date();
    const fechaIso = ahora.toISOString().slice(0, 10);
    const { registro, huellaInput, huella } = await buildRegistroAlta({
      version: "e2e",
      numeroInstalacion: instalacion,
      idEmisorFactura: NIF,
      nombreRazonEmisor: RAZON,
      numSerieFactura: formatNumSerieFactura(serie, numero),
      fechaExpedicion: fechaIso,
      descripcionOperacion: descripcionOperacionPorVertical("SERVICES"),
      desglose: [{ tipoImpositivo: 21, baseImponible: base, cuotaRepercutida: cuota }],
      cuotaTotal: cuota,
      importeTotal: total,
      cabeza,
      fechaHoraHusoGenRegistro: `${ahora.toISOString().slice(0, 19)}+00:00`,
    });
    return {
      body: {
        externalId: randomUUID(),
        kind: "ALTA" as const,
        chainIndex,
        serie,
        numero,
        generatedAt: ahora.toISOString(),
        huellaInput,
        payload: registro,
      },
      nuevaCabeza: {
        chainIndex,
        idEmisorFactura: NIF,
        numSerieFactura: formatNumSerieFactura(serie, numero),
        fechaExpedicion: fechaIso,
        huella,
        fechaHoraHusoGenRegistro: `${ahora.toISOString().slice(0, 19)}+00:00`,
        huellaInput,
        ultimoNumero: numero,
        serie,
      } as CabezaDeCadena,
      base,
    };
  }

  async function cobrar(args: {
    token: string;
    shiftId: string;
    total: number;
    fiscalRecord?: unknown;
  }) {
    const base = Math.round((args.total / 1.21) * 100) / 100;
    return app.inject({
      method: "POST",
      url: "/tickets",
      headers: { authorization: `Bearer ${args.token}` },
      payload: {
        externalId: randomUUID(),
        registerId,
        shiftId: args.shiftId,
        lines: [
          {
            nameSnapshot: "Corte de pelo",
            sku: "TPV-CORTE",
            units: 1,
            unitPrice: base,
            discountPct: 0,
            taxRate: 21,
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
        name: RAZON,
        businessType: "SERVICES",
        // Lo que enciende la cadena: el comercio NO usa Holded.
        holdedEnabled: false,
        fiscalProfile: { legalName: RAZON, taxId: NIF },
      },
      select: { id: true },
    });
    tenantId = tenant.id;
    const store = await prisma.store.create({
      data: { tenantId, name: "Peluquería Sole" },
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

    // El terminal real del cliente, emparejado como lo empareja la ruta.
    const terminal = await prisma.device.create({
      data: { tenantId, registerId, deviceTokenHash: randomUUID(), name: "Tablet mostrador" },
      select: { id: true, kind: true },
    });
    terminalRealId = terminal.id;
    // Lo que trae el default de la columna. Si esto cambiara, nada de lo
    // que empareja un código relevaría a nadie.
    expect(terminal.kind).toBe("TERMINAL");

    const cajera = await prisma.user.create({
      data: {
        tenantId,
        email: `sole+${randomUUID()}@e2e.local`,
        alias: "Ana",
        role: "CASHIER",
      },
      select: { id: true },
    });
    tokenReal = signCashierSession(
      {
        sub: cajera.id,
        tid: tenantId,
        did: terminalRealId,
        rid: registerId,
        role: "CASHIER",
      },
      720,
    );
    const abierto = await app.inject({
      method: "POST",
      url: "/shift/open",
      headers: { authorization: `Bearer ${tokenReal}` },
      payload: { registerId, cashOpening: 0 },
    });
    shiftReal = abierto.json().shift.id;
  });

  afterAll(async () => {
    // Higiene, sin hacer fallar la suite: los guards de S1 y de verifactu-1
    // impiden borrar tickets con venta sellada, y eso es lo correcto.
    try {
      await prisma.tenant.delete({ where: { id: tenantId } });
    } catch {
      /* lo dejamos: la base del e2e es desechable */
    }
    await app.close();
    await shutdown();
  });

  // ── 1 · activar el modo prueba no apaga el terminal del cliente ──────

  describe("activar el modo prueba", () => {
    it("crea el dispositivo técnico SIN revocar el terminal real", async () => {
      const recursos = await provisionTestCashier(prisma, tenantId);
      // Se engancha a la caja que ya existe — ésa es toda la gracia del
      // fallo: el dispositivo técnico vive en la MISMA caja.
      expect(recursos.registerId).toBe(registerId);

      const vivos = await activos();
      expect(vivos).toHaveLength(2);
      expect(vivos.map((d) => d.kind).sort()).toEqual(["TERMINAL", "TEST"]);
      // Y el que sigue cobrando es el del cliente.
      const real = vivos.find((d) => d.id === terminalRealId);
      expect(real?.kind).toBe("TERMINAL");
    });

    it("el dispositivo técnico se marca en el DATO, no en el nombre", async () => {
      const tecnico = await prisma.device.findFirstOrThrow({
        where: { registerId, kind: "TEST" },
        select: { kind: true, name: true, userAgent: true },
      });
      expect(tecnico.kind).toBe("TEST");
      // El nombre y el user-agent siguen ahí porque son útiles para mirar
      // la tabla, pero ya no son lo que decide nada.
      expect(tecnico.userAgent).toBe("internal/mipiacetpv-test");
    });
  });

  // ── 2 · reactivarlo no choca con el índice único ─────────────────────

  describe("reactivar el modo prueba", () => {
    it("un técnico revocado se reactiva con el terminal real activo", async () => {
      const tecnico = await prisma.device.findFirstOrThrow({
        where: { registerId, kind: "TEST" },
        select: { id: true },
      });
      // Lo que hace `purgeTestData` al activar el comercio.
      await prisma.device.update({
        where: { id: tecnico.id },
        data: { revokedAt: new Date() },
      });
      expect(await activos()).toHaveLength(1);

      // Y ahora se vuelve a activar el modo prueba. Antes de este bloque,
      // aquí había un 500 contra `devices_one_active_per_register_key`.
      await expect(provisionTestCashier(prisma, tenantId)).resolves.toBeTruthy();

      const vivos = await activos();
      expect(vivos).toHaveLength(2);
      expect(vivos.map((d) => d.kind).sort()).toEqual(["TERMINAL", "TEST"]);
    });
  });

  // ── 3 · emparejar un terminal nuevo ──────────────────────────────────

  describe("emparejar un terminal nuevo con el modo prueba activo", () => {
    it("releva al terminal anterior y NO al técnico", async () => {
      const tecnicoAntes = await prisma.device.findFirstOrThrow({
        where: { registerId, kind: "TEST", revokedAt: null },
        select: { id: true },
      });

      // INSERT crudo a propósito: la ruta de emparejamiento no revoca nada,
      // lo hace el trigger. Si el invariante viviera en la ruta, esto
      // dejaría dos terminales vivos en la misma caja.
      const nuevo = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO devices (id, tenant_id, register_id, device_token_hash)
         VALUES ('${nuevo}'::uuid, '${tenantId}'::uuid, '${registerId}'::uuid, '${randomUUID()}')`,
      );

      const anterior = await prisma.device.findUniqueOrThrow({
        where: { id: terminalRealId },
        select: { revokedAt: true, revokedReason: true, revokedByDeviceId: true },
      });
      expect(anterior.revokedAt).not.toBeNull();
      expect(anterior.revokedReason).toBe("PAIRED_NEW");
      expect(anterior.revokedByDeviceId).toBe(nuevo);

      // El técnico NO se ha tocado: emparejar una tablet no puede apagar el
      // modo prueba del super-admin.
      const tecnico = await prisma.device.findUniqueOrThrow({
        where: { id: tecnicoAntes.id },
        select: { revokedAt: true, revokedByDeviceId: true },
      });
      expect(tecnico.revokedAt).toBeNull();
      expect(tecnico.revokedByDeviceId).toBeNull();

      const vivos = await activos();
      expect(vivos).toHaveLength(2);
      expect(vivos.map((d) => d.kind).sort()).toEqual(["TERMINAL", "TEST"]);
      terminalRealId = nuevo;
    });

    it("y dos TERMINAL activos en la misma caja los sigue parando el índice", async () => {
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
        msg = err instanceof Error ? err.message : String(err);
      }
      // Prisma convierte los 23505 en un error estructurado y se queda sin
      // mensaje; lo que importa es el código y que el INSERT no pasó.
      expect(msg).toContain("23505");
      expect((await activos()).filter((d) => d.kind === "TERMINAL")).toHaveLength(1);
    });

    it("pero DOS técnicos a la vez no los para nadie, y está bien", async () => {
      // El índice filtra `kind = 'TERMINAL'`, así que no hay unicidad sobre
      // los TEST. Es deliberado: un dispositivo que no escribe en la cadena
      // no necesita ser único, y `provisionTestCashier` ya reusa el suyo.
      const extra = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO devices (id, tenant_id, register_id, device_token_hash, kind)
         VALUES ('${extra}'::uuid, '${tenantId}'::uuid, '${registerId}'::uuid, '${randomUUID()}', 'TEST')`,
      );
      // Y el terminal real sigue vivo: el segundo técnico tampoco relevó a
      // nadie.
      const real = await prisma.device.findUniqueOrThrow({
        where: { id: terminalRealId },
        select: { revokedAt: true },
      });
      expect(real.revokedAt).toBeNull();
      await prisma.$executeRawUnsafe(`DELETE FROM devices WHERE id = '${extra}'::uuid`);
    });
  });

  // ── 4 y 5 · una venta de prueba no entra en la cadena ────────────────

  describe("una venta en modo prueba", () => {
    let tokenPrueba = "";
    let shiftPrueba = "";
    let cabezaReal: CabezaDeCadena | null = null;

    it("primero, una venta REAL: la cadena arranca", async () => {
      const reg = await registroDeVenta(null, 12.1);
      const res = await cobrar({
        token: tokenReal,
        shiftId: shiftReal,
        total: 12.1,
        fiscalRecord: reg.body,
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().fiscalRecord?.chainStatus).toBe("OK");
      cabezaReal = reg.nuevaCabeza;

      const cabeza = await cabezaDeLaCadena();
      expect(cabeza.filas).toBe(1);
      expect(cabeza.ultimoNumero).toBe(1);
    });

    it("el head del super-admin no le da serie ni cabeza al modo prueba", async () => {
      const sesion = await issueTestCashierSession(prisma, tenantId);
      tokenPrueba = sesion.cashierSessionToken;
      shiftPrueba = sesion.shiftId;

      const res = await app.inject({
        method: "GET",
        url: "/tpv/fiscal/head",
        headers: { authorization: `Bearer ${tokenPrueba}` },
      });
      expect(res.statusCode).toBe(200);
      // El comercio SÍ emite; quien no emite es la sesión.
      expect(res.json()).toEqual({ emite: false });
    });

    it("cobra, pero no gasta número ni mueve la cadena", async () => {
      const antes = await cabezaDeLaCadena();
      const res = await cobrar({
        token: tokenPrueba,
        shiftId: shiftPrueba,
        total: 30.25,
      });
      // Cobrar siempre se puede: la venta de prueba entra.
      expect(res.statusCode).toBe(201);
      expect(res.json().fiscalRecord).toBeNull();

      const despues = await cabezaDeLaCadena();
      expect(despues.filas).toBe(antes.filas);
      expect(despues.chainIndex).toBe(antes.chainIndex);
      expect(despues.ultimoNumero).toBe(antes.ultimoNumero);
    });

    it("y si un terminal de prueba manda registro igual, el espejo lo descarta", async () => {
      // La APK vieja, el outbox con cola de antes, el cliente que se salta
      // el head. El registro viene bien formado y encadenaría perfecto: lo
      // único que lo descarta es de QUIÉN viene.
      const antes = await cabezaDeLaCadena();
      const reg = await registroDeVenta(cabezaReal, 20);
      const res = await cobrar({
        token: tokenPrueba,
        shiftId: shiftPrueba,
        total: 20,
        fiscalRecord: reg.body,
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().fiscalRecord).toBeNull();

      const despues = await cabezaDeLaCadena();
      expect(despues.filas).toBe(antes.filas);
      expect(despues.ultimoNumero).toBe(antes.ultimoNumero);
      // Ni siquiera como fila marcada: descartar no es guardar en BROKEN.
      const porExternalId = await prisma.fiscalRecord.count({
        where: { externalId: reg.body.externalId },
      });
      expect(porExternalId).toBe(0);
    });

    it("las dos rutas de anulación le contestan 409", async () => {
      const alta = await prisma.fiscalRecord.findFirstOrThrow({
        where: { registerId, kind: "ALTA" },
        select: { ticketId: true },
      });
      const anulacion = {
        externalId: randomUUID(),
        kind: "ANULACION" as const,
        chainIndex: 99,
        serie,
        numero: 1,
        generatedAt: new Date().toISOString(),
        huellaInput: "no-importa",
        payload: {},
      };
      const void_ = await app.inject({
        method: "POST",
        url: `/tickets/${alta.ticketId}/fiscal-void`,
        headers: { authorization: `Bearer ${tokenPrueba}` },
        payload: { fiscalRecord: anulacion },
      });
      expect(void_.statusCode).toBe(409);
      expect(void_.json().error).toBe("FISCAL_TEST_MODE");

      const gastado = await app.inject({
        method: "POST",
        url: "/fiscal/anulaciones",
        headers: { authorization: `Bearer ${tokenPrueba}` },
        payload: { fiscalRecord: anulacion },
      });
      expect(gastado.statusCode).toBe(409);
      expect(gastado.json().error).toBe("FISCAL_TEST_MODE");
    });

    it("y la cadena del cliente sigue íntegra después de todo", async () => {
      const filas = await prisma.$queryRawUnsafe<
        { total: bigint; integra: boolean; primer_fallo_index: number | null }[]
      >(`SELECT * FROM mipiacetpv_fiscal_chain_summary('${registerId}'::uuid)`);
      expect(filas[0]!.integra).toBe(true);
      expect(filas[0]!.primer_fallo_index).toBeNull();
      expect(Number(filas[0]!.total)).toBe(1);
    });
  });

  // ── 5(b) · el backfill marca por CUALQUIERA de las dos marcas ────────

  describe("el backfill de la migración", () => {
    // Por qué el `WHERE` del backfill lleva OR y no AND.
    //
    // El dispositivo del modo prueba ha llevado siempre las dos marcas al
    // CREARSE, pero sólo el nombre sobrevive a una reaprovisión: el
    // `user_agent` se escribe en el `create` y nunca se vuelve a tocar (ver
    // `provisionTestCashier`), así que un aparato dado de alta por una
    // versión que no lo ponía se queda con el nombre y nada más. Con AND,
    // ese aparato se quedaría en TERMINAL — y volvería el fallo entero:
    // revocaría el terminal real del cliente en el siguiente emparejamiento
    // y abortaría la precondición del despliegue.
    //
    // Marcar de más no es un riesgo simétrico: ningún terminal de un cliente
    // se llama «mipiacetpv · modo prueba» ni se anuncia con ese user-agent.
    let cajas: { id: string; etiqueta: string }[] = [];

    it("una caja por caso, con la marca que le toca", async () => {
      const store = await prisma.store.create({
        data: { tenantId, name: "Tienda del backfill" },
        select: { id: true },
      });
      // Cada dispositivo en SU caja: si fueran a la misma, el trigger
      // revocaría a los anteriores y el test estaría midiendo otra cosa.
      const casos = [
        {
          etiqueta: "sólo el nombre",
          name: "mipiacetpv · modo prueba",
          userAgent: null,
          esperado: "TEST",
        },
        {
          etiqueta: "sólo el user-agent",
          name: "Tablet del equipo",
          userAgent: "internal/mipiacetpv-test",
          esperado: "TEST",
        },
        {
          etiqueta: "las dos marcas",
          name: "mipiacetpv · modo prueba",
          userAgent: "internal/mipiacetpv-test",
          esperado: "TEST",
        },
        {
          etiqueta: "un terminal de verdad",
          name: "Tablet mostrador",
          userAgent: "Mozilla/5.0 (Linux; Android 13)",
          esperado: "TERMINAL",
        },
      ];
      cajas = [];
      for (const caso of casos) {
        const caja = await prisma.register.create({
          data: { storeId: store.id, name: `Caja ${caso.etiqueta}` },
          select: { id: true },
        });
        // Nacen TERMINAL, que es lo que el DEFAULT le da a todo lo que ya
        // existía en producción antes de esta migración.
        await prisma.device.create({
          data: {
            tenantId,
            registerId: caja.id,
            name: caso.name,
            userAgent: caso.userAgent,
            deviceTokenHash: randomUUID(),
          },
        });
        cajas.push({ id: caja.id, etiqueta: caso.etiqueta });
      }
      const antes = await prisma.device.findMany({
        where: { registerId: { in: cajas.map((c) => c.id) } },
        select: { kind: true },
      });
      expect(antes.every((d) => d.kind === "TERMINAL")).toBe(true);
    });

    it("el UPDATE de la migración marca TEST con CUALQUIERA de las dos", async () => {
      // El SQL sale de la migración, no de una copia: si alguien cambiara
      // el OR por un AND, lo que falla aquí es el despliegue de verdad.
      await prisma.$executeRawUnsafe(backfillDeLaMigracion());

      const filas = await prisma.device.findMany({
        where: { registerId: { in: cajas.map((c) => c.id) } },
        select: { registerId: true, kind: true },
      });
      const porCaja = new Map(filas.map((f) => [f.registerId, f.kind]));
      const kindDe = (etiqueta: string) =>
        porCaja.get(cajas.find((c) => c.etiqueta === etiqueta)!.id);

      // Las tres marcadas, incluida la que lleva SÓLO el nombre: ésa es la
      // que el AND se dejaría fuera.
      expect(kindDe("sólo el nombre")).toBe("TEST");
      expect(kindDe("sólo el user-agent")).toBe("TEST");
      expect(kindDe("las dos marcas")).toBe("TEST");
      // Y el terminal de verdad sigue siendo un terminal.
      expect(kindDe("un terminal de verdad")).toBe("TERMINAL");
    });

    it("y es idempotente: correrlo dos veces no cambia nada", async () => {
      await prisma.$executeRawUnsafe(backfillDeLaMigracion());
      const test = await prisma.device.count({
        where: { registerId: { in: cajas.map((c) => c.id) }, kind: "TEST" },
      });
      expect(test).toBe(3);
    });
  });

  // ── 6 · la precondición de la migración ──────────────────────────────

  describe("la precondición de la migración", () => {
    it("no cuenta dispositivos técnicos: con 1 TERMINAL + 1 TEST pasa", async () => {
      const vivos = await activos();
      expect(vivos.map((d) => d.kind).sort()).toEqual(["TERMINAL", "TEST"]);
      // Se ejecuta el bloque TAL CUAL está en la migración. Si contara los
      // técnicos, esta caja abortaría el despliegue de un comercio que está
      // perfectamente bien — que es exactamente lo que pasaba con Sirope.
      await expect(
        prisma.$executeRawUnsafe(precondicionDeLaMigracion()),
      ).resolves.toBeDefined();
    });

    it("y con DOS TERMINAL activos en una caja sigue abortando", async () => {
      let msg: string | null = null;
      try {
        await prisma.$transaction(async (tx) => {
          // Para meter el segundo terminal hay que quitar de en medio a los
          // dos guardias que este bloque acaba de arreglar. Todo dentro de
          // una transacción que se deshace: el índice vuelve solo.
          await tx.$executeRawUnsafe(
            `DROP INDEX devices_one_active_per_register_key`,
          );
          await tx.$executeRawUnsafe(
            `ALTER TABLE devices DISABLE TRIGGER devices_revoke_previous`,
          );
          await tx.$executeRawUnsafe(
            `INSERT INTO devices (id, tenant_id, register_id, device_token_hash)
             VALUES (gen_random_uuid(), '${tenantId}'::uuid, '${registerId}'::uuid, '${randomUUID()}')`,
          );
          await tx.$executeRawUnsafe(precondicionDeLaMigracion());
          throw new Error("LA_PRECONDICION_NO_ABORTO");
        });
      } catch (err) {
        msg = err instanceof Error ? err.message : String(err);
      }
      expect(msg).toContain("VERIFACTU_PRECONDICION");
      expect(msg).toContain("dispositivos activos");
      // Y el índice sigue en su sitio: la transacción se deshizo entera.
      const vivos = await activos();
      expect(vivos.filter((d) => d.kind === "TERMINAL")).toHaveLength(1);
    });
  });
});
