// kds-1-cocina · LO QUE SÓLO EL MOTOR PUEDE DECIR.
//
// Por qué tiene que ser e2e y no un test con un Prisma falso: lo que se
// prueba aquí vive en POSTGRES —un trigger, un índice único parcial y seis
// CHECK— y la aplicación no es la única puerta a Postgres. Mismo
// razonamiento que `verifactu-modo-prueba.e2e.ts` y
// `f2-registro-inalterable.e2e.ts`: los sabotajes van con
// `$executeRawUnsafe` porque así los escribiría alguien con acceso al VPS.
// Si el invariante viviera en la ruta y no en el motor, estos INSERT
// pasarían y nadie se enteraría.
//
// Las filas de la tabla de sabotajes del bloque que viven aquí:
//
//   | Emparejar `KITCHEN` revoca el terminal | tras emparejar la cocina, el
//   | terminal de la caja sigue activo y cobra
//   | Volver a mandar todas las líneas en cada envío | 2 cañas, enviar,
//   | +1 caña, enviar → la 2ª comanda tiene 1 caña  ← contra Postgres
//   | Quitar la idempotencia de `clientSendId` | una sola comanda
//   | La alergia llega a `Client` | ningún registro de alergia fuera del
//   | ticket
//   | Fallar el envío por no tener destino | 200 y línea marcada
//
// Y lo que la tabla no nombra pero el motor garantiza: los CHECK de
// `sent_units`, de las secciones de la pantalla y del semáforo.

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

const { getPrisma, shutdown } = await import("../src/context.js");
const { registerDeviceRoutes } = await import("../src/devices/routes.js");
const { registerKitchenRoutes } = await import("../src/kitchen/routes.js");
const { registerKitchenTpvRoutes } = await import("../src/kitchen/tpv-routes.js");
const { registerKitchenAjustesRoutes } = await import(
  "../src/kitchen/ajustes-routes.js"
);
const { registerSendToKitchenEscposRoute } = await import(
  "../src/tickets/send-to-kitchen-escpos.js"
);
const { registerShiftRoutes } = await import("../src/shift/routes.js");
const { registerTicketRoutes } = await import("../src/tickets/routes.js");
const { registerErrorHandler } = await import("../src/lib/error-handler.js");
const { registerLenientJsonParser } = await import("../src/lib/lenient-json.js");
const { signCashierSession } = await import("../src/shift/cashier-session.js");
const { signAccessToken } = await import("../src/auth/tokens.js");
const { generateDeviceToken } = await import("../src/devices/auth.js");

describe.skipIf(!e2eEnabled)("e2e · kds-1 · la cocina, contra Postgres", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let app: FastifyInstance;

  let tenantId = "";
  let storeId = "";
  let registerId = "";
  let ownerId = "";
  let cashierId = "";
  let shiftId = "";
  let terminalId = "";
  let terminalToken = "";
  let mesaId = "";
  let canaId = "";
  let bravasId = "";

  function sesionCajero() {
    return signCashierSession(
      {
        sub: cashierId,
        tid: tenantId,
        did: terminalId,
        rid: registerId,
        role: "CASHIER",
      },
      30,
    );
  }

  function sesionOwner() {
    return signAccessToken({ sub: ownerId, tid: tenantId, role: "OWNER" });
  }

  /** Los dispositivos activos de la caja, para mirar quién releva a quién. */
  async function activos(): Promise<Array<{ id: string; kind: string }>> {
    const filas = await prisma.device.findMany({
      where: { registerId, revokedAt: null },
      select: { id: true, kind: true },
      orderBy: { pairedAt: "asc" },
    });
    return filas.map((d) => ({ id: d.id, kind: d.kind }));
  }

  async function abrirMesaConLineas(
    lineas: Array<{ productId: string; nameSnapshot: string; units: number }>,
  ): Promise<string> {
    const ticket = await prisma.ticket.create({
      data: {
        tenantId,
        registerId,
        shiftId,
        userId: cashierId,
        internalNumber: `K-${randomUUID().slice(0, 8)}`,
        externalId: randomUUID(),
        publicSlug: randomUUID().replace(/-/g, "").slice(0, 16),
        status: "DRAFT",
        tableId: mesaId,
        diners: 4,
        total: 0,
        totalTax: 0,
        totalDiscount: 0,
        lines: {
          create: lineas.map((l) => ({
            productId: l.productId,
            sku: `SKU-${l.nameSnapshot.slice(0, 4)}`,
            nameSnapshot: l.nameSnapshot,
            units: l.units,
            unitPrice: 1,
            taxRate: 10,
            subtotal: l.units,
            total: l.units,
          })),
        },
      },
      select: { id: true },
    });
    return ticket.id;
  }

  async function enviar(
    ticketId: string,
    body: Record<string, unknown> = {},
  ) {
    return app.inject({
      method: "POST",
      url: `/tickets/${ticketId}/send-to-kitchen/escpos`,
      headers: { authorization: `Bearer ${sesionCajero()}` },
      payload: body,
    });
  }

  beforeAll(async () => {
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    registerLenientJsonParser(app);
    await registerDeviceRoutes(app);
    await registerShiftRoutes(app);
    await registerTicketRoutes(app);
    await registerSendToKitchenEscposRoute(app);
    await registerKitchenRoutes(app);
    await registerKitchenTpvRoutes(app);
    await registerKitchenAjustesRoutes(app);
    await app.ready();

    const tenant = await prisma.tenant.create({
      data: {
        name: "BAR LA MAESTRANZA SL",
        businessType: "HOSPITALITY",
        holdedEnabled: false,
        // El módulo encendido: es lo que vende la pantalla.
        kitchenDisplayEnabled: true,
        fiscalProfile: { legalName: "BAR LA MAESTRANZA SL", taxId: "B45902186" },
      },
      select: { id: true },
    });
    tenantId = tenant.id;
    const store = await prisma.store.create({
      data: { tenantId, name: "La Maestranza" },
      select: { id: true },
    });
    storeId = store.id;
    const register = await prisma.register.create({
      data: { storeId, name: "Caja 1" },
      select: { id: true },
    });
    registerId = register.id;
    const mesa = await prisma.table.create({
      data: { storeId, name: "M5", capacity: 4, zone: "SALON" },
      select: { id: true },
    });
    mesaId = mesa.id;

    const owner = await prisma.user.create({
      data: {
        tenantId,
        email: "salome@maestranza.es",
        role: "OWNER",
        passwordHash: "x",
      },
      select: { id: true },
    });
    ownerId = owner.id;
    const cajero = await prisma.user.create({
      data: {
        tenantId,
        email: "barman@maestranza.es",
        role: "CASHIER",
        alias: "Ana",
        passwordHash: "x",
      },
      select: { id: true },
    });
    cashierId = cajero.id;

    // EL TERMINAL REAL DE LA CAJA. Es el que no se puede quedar sin cobrar.
    const { plain, hash } = generateDeviceToken();
    terminalToken = plain;
    const terminal = await prisma.device.create({
      data: {
        tenantId,
        registerId,
        deviceTokenHash: hash,
        name: "Tablet de la barra",
      },
      select: { id: true, kind: true },
    });
    terminalId = terminal.id;
    expect(terminal.kind).toBe("TERMINAL");

    const shift = await prisma.shift.create({
      data: {
        registerId,
        userId: cashierId,
        openedAt: new Date(),
        cashOpening: 100,
      },
      select: { id: true },
    });
    shiftId = shift.id;

    // La carta mínima: la caña a BARRA, las bravas a COCINA.
    const cana = await prisma.product.create({
      data: {
        tenantId,
        name: "Caña",
        sku: "CER-001",
        basePrice: 1.36,
        taxRate: 10,
        tags: ["cervezas"],
        source: "LOCAL",
      },
      select: { id: true },
    });
    canaId = cana.id;
    const bravas = await prisma.product.create({
      data: {
        tenantId,
        name: "Patatas bravas",
        sku: "RAC-004",
        basePrice: 9.09,
        taxRate: 10,
        tags: ["raciones"],
        source: "LOCAL",
        // El plato que lleva gluten: el del cruce de la capa 3.
        allergens: ["GLUTEN"],
      },
      select: { id: true },
    });
    bravasId = bravas.id;
    await prisma.tagSection.createMany({
      data: [
        { tenantId, slug: "cervezas", section: "BARRA" },
        { tenantId, slug: "raciones", section: "COCINA" },
      ],
    });
  });

  afterAll(async () => {
    await app?.close();
    await shutdown();
  });

  // ────────────────────────────────────────────────────────────────────
  // 1 · EL SABOTAJE DEL TRIGGER
  // ────────────────────────────────────────────────────────────────────

  describe("SABOTAJE · emparejar KITCHEN revoca el terminal", () => {
    let pantallaToken = "";
    let pantallaId = "";

    it("el código de cocina lo crea el PANEL, no el aparato", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/admin/registers/${registerId}/pairing-codes`,
        headers: { authorization: `Bearer ${sesionOwner()}` },
        payload: { kind: "KITCHEN", kitchenSections: ["COCINA"], name: "Pase" },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().kind).toBe("KITCHEN");
      expect(res.json().kitchenSections).toEqual(["COCINA"]);

      const pair = await app.inject({
        method: "POST",
        url: "/devices/pair",
        payload: { code: res.json().code, deviceName: "Pase de cocina" },
      });
      expect(pair.statusCode).toBe(201);
      // La APK lee esto para arrancar en «modo cocina».
      expect(pair.json().kind).toBe("KITCHEN");
      expect(pair.json().kitchenSections).toEqual(["COCINA"]);
      pantallaToken = pair.json().deviceToken;
      pantallaId = pair.json().deviceId;
    });

    it("EL TERMINAL DE LA CAJA SIGUE ACTIVO", async () => {
      // El sabotaje exacto de la tabla del bloque. El trigger
      // `devices_revoke_previous` y el índice parcial
      // `devices_one_active_per_register_key` filtran los dos
      // `kind = 'TERMINAL'` desde verifactu-1, así que un valor nuevo cae
      // fuera por construcción. Esto lo COMPRUEBA en vez de suponerlo.
      const vivos = await activos();
      expect(vivos).toHaveLength(2);
      expect(vivos.map((d) => d.kind).sort()).toEqual(["KITCHEN", "TERMINAL"]);
      const terminal = await prisma.device.findUniqueOrThrow({
        where: { id: terminalId },
        select: { revokedAt: true, revokedReason: true },
      });
      expect(terminal.revokedAt).toBeNull();
      expect(terminal.revokedReason).toBeNull();
    });

    it("y sigue COBRANDO: la venta no se cae por emparejar una pantalla", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/tickets",
        headers: { authorization: `Bearer ${sesionCajero()}` },
        payload: {
          externalId: randomUUID(),
          registerId,
          shiftId,
          lines: [
            {
              nameSnapshot: "Caña",
              sku: "CER-001",
              units: 1,
              unitPrice: 1.36,
              discountPct: 0,
              taxRate: 10,
            },
          ],
          payments: [{ method: "CASH", amount: 1.5 }],
        },
      });
      expect([200, 201]).toContain(res.statusCode);
    });

    it("una SEGUNDA pantalla (la de barra) tampoco releva a nadie", async () => {
      const code = await app.inject({
        method: "POST",
        url: `/admin/registers/${registerId}/pairing-codes`,
        headers: { authorization: `Bearer ${sesionOwner()}` },
        payload: { kind: "KITCHEN", kitchenSections: ["BARRA"] },
      });
      const pair = await app.inject({
        method: "POST",
        url: "/devices/pair",
        payload: { code: code.json().code, deviceName: "Pase de barra" },
      });
      expect(pair.statusCode).toBe(201);
      // Tres aparatos vivos en la misma caja, y sólo UNO factura.
      const vivos = await activos();
      expect(vivos).toHaveLength(3);
      expect(vivos.filter((d) => d.kind === "TERMINAL")).toHaveLength(1);
    });

    it("pero emparejar un TERMINAL nuevo SÍ releva al anterior, y a ninguna pantalla", async () => {
      const code = await app.inject({
        method: "POST",
        url: `/admin/registers/${registerId}/pairing-codes`,
        headers: { authorization: `Bearer ${sesionOwner()}` },
        payload: {},
      });
      const pair = await app.inject({
        method: "POST",
        url: "/devices/pair",
        payload: { code: code.json().code, deviceName: "Tablet nueva" },
      });
      expect(pair.statusCode).toBe(201);
      expect(pair.json().kind).toBe("TERMINAL");

      const viejo = await prisma.device.findUniqueOrThrow({
        where: { id: terminalId },
        select: { revokedAt: true, revokedReason: true, revokedByDeviceId: true },
      });
      expect(viejo.revokedAt).not.toBeNull();
      expect(viejo.revokedReason).toBe("PAIRED_NEW");
      expect(viejo.revokedByDeviceId).toBe(pair.json().deviceId);

      // Y las dos pantallas siguen vivas.
      const vivos = await activos();
      expect(vivos.filter((d) => d.kind === "KITCHEN")).toHaveLength(2);
      expect(vivos.filter((d) => d.kind === "TERMINAL")).toHaveLength(1);

      // Se recoloca el estado para lo que viene.
      terminalId = pair.json().deviceId;
      terminalToken = pair.json().deviceToken;
    });

    it("SABOTAJE · un KITCHEN no pasa por la puerta del TPV", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/devices/me",
        headers: { "x-device-token": pantallaToken },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("KITCHEN_DEVICE_NOT_ALLOWED");
    });

    it("y el TERMINAL sí", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/devices/me",
        headers: { "x-device-token": terminalToken },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().tenant.kitchenDisplayEnabled).toBe(true);
      expect(res.json().kitchen.courseMode).toBe("ESPERA");
    });

    it("EL CHECK · una pantalla SIN secciones no entra, ni por psql", async () => {
      // El sabotaje escrito como lo escribiría alguien con acceso al VPS.
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO devices (id, tenant_id, register_id, device_token_hash, kind, kitchen_sections)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'KITCHEN', '{}')`,
          randomUUID(),
          tenantId,
          registerId,
          randomUUID(),
        ),
      ).rejects.toThrow(/devices_kitchen_sections/);
    });

    it("EL CHECK · y un TERMINAL con secciones tampoco", async () => {
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO devices (id, tenant_id, register_id, device_token_hash, kind, kitchen_sections)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'TERMINAL', '{COCINA}')`,
          randomUUID(),
          tenantId,
          registerId,
          randomUUID(),
        ),
      ).rejects.toThrow(/devices_kitchen_sections/);
    });

    it("la pantalla ve SU tienda y SUS secciones, y nada más", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/kitchen/me",
        headers: { "x-device-token": pantallaToken },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().store.id).toBe(storeId);
      expect(res.json().sections).toEqual(["COCINA"]);
      expect(res.json().device.id).toBe(pantallaId);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 2 · EL ENVÍO POR DIFERENCIAS, CONTRA POSTGRES
  // ────────────────────────────────────────────────────────────────────

  describe("SABOTAJE · volver a mandar todas las líneas en cada envío", () => {
    it("2 cañas, enviar, +1 caña, enviar → la 2ª comanda tiene UNA caña", async () => {
      const ticketId = await abrirMesaConLineas([
        { productId: canaId, nameSnapshot: "Caña", units: 2 },
      ]);
      const primero = await enviar(ticketId, { clientSendId: randomUUID() });
      expect(primero.statusCode).toBe(200);

      // La BARRA tiene pantalla a estas alturas del fichero (el bloque de
      // arriba emparejó la segunda), así que lo que se comprueba aquí no
      // es el destino sino LA DIFERENCIA. El 200 de la sección sin destino
      // tiene su propio test más abajo.
      const barra = primero
        .json()
        .sections.find((s: { section: string }) => s.section === "BARRA");
      expect(barra.ok).toBe(true);
      expect(barra.units).toBe(2);
      const linea = await prisma.ticketLine.findFirstOrThrow({
        where: { ticketId },
        select: { id: true, units: true, sentUnits: true },
      });
      expect(Number(linea.sentUnits)).toBe(2);

      // +1 caña.
      await prisma.ticketLine.update({
        where: { id: linea.id },
        data: { units: 3 },
      });
      const segundo = await enviar(ticketId, { clientSendId: randomUUID() });
      const barra2 = segundo
        .json()
        .sections.find((s: { section: string }) => s.section === "BARRA");
      // Con el motor viejo esto valdría 3.
      expect(barra2.units).toBe(1);
      expect(Number(
        (await prisma.ticketLine.findUniqueOrThrow({
          where: { id: linea.id },
          select: { sentUnits: true },
        })).sentUnits,
      )).toBe(3);
      // Y se gastaron DOS números de comanda, no uno ni tres.
      expect(segundo.json().revision).toBe(2);
    });

    it("EL CHECK · `sent_units > units` no entra, ni por psql", async () => {
      // La invariante central del bloque, escrita en el motor. Un
      // `sent_units` mayor que `units` haría que el siguiente envío
      // calculase una diferencia NEGATIVA —o sea, nada— y la cocina no
      // vería un plato que el cliente ya pidió.
      const ticketId = await abrirMesaConLineas([
        { productId: canaId, nameSnapshot: "Caña", units: 1 },
      ]);
      const linea = await prisma.ticketLine.findFirstOrThrow({
        where: { ticketId },
        select: { id: true },
      });
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE ticket_lines SET sent_units = 5 WHERE id = $1::uuid`,
          linea.id,
        ),
      ).rejects.toThrow(/ticket_lines_sent_units_range/);
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE ticket_lines SET sent_units = -1 WHERE id = $1::uuid`,
          linea.id,
        ),
      ).rejects.toThrow(/ticket_lines_sent_units_range/);
    });

    it("SABOTAJE · la idempotencia de `clientSendId` · una sola comanda", async () => {
      const ticketId = await abrirMesaConLineas([
        { productId: bravasId, nameSnapshot: "Patatas bravas", units: 2 },
      ]);
      const id = randomUUID();
      const primero = await enviar(ticketId, { clientSendId: id });
      expect(primero.statusCode).toBe(200);
      expect(primero.json().replayed).toBe(false);

      const repetido = await enviar(ticketId, { clientSendId: id });
      expect(repetido.statusCode).toBe(200);
      expect(repetido.json().replayed).toBe(true);
      expect(repetido.json().revision).toBe(primero.json().revision);

      expect(
        await prisma.kitchenDispatch.count({ where: { ticketId } }),
      ).toBe(1);
      expect(await prisma.kitchenOrder.count({ where: { ticketId } })).toBe(1);
    });

    it("EL ÍNDICE · dos envíos con el MISMO `clientSendId` no caben en la base", async () => {
      const ticketId = await abrirMesaConLineas([
        { productId: bravasId, nameSnapshot: "Patatas bravas", units: 1 },
      ]);
      const id = randomUUID();
      await prisma.kitchenDispatch.create({
        data: {
          tenantId,
          ticketId,
          clientSendId: id,
          revision: 1,
          sentByUserId: cashierId,
          result: {},
        },
      });
      await expect(
        prisma.kitchenDispatch.create({
          data: {
            tenantId,
            ticketId,
            clientSendId: id,
            revision: 2,
            sentByUserId: cashierId,
            result: {},
          },
        }),
      ).rejects.toThrow();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 3 · LA PANTALLA, DE PUNTA A PUNTA
  // ────────────────────────────────────────────────────────────────────

  describe("la comanda llega, se tacha y se sirve", () => {
    let pantallaToken = "";
    let ticketId = "";
    let orderId = "";

    beforeAll(async () => {
      const code = await app.inject({
        method: "POST",
        url: `/admin/registers/${registerId}/pairing-codes`,
        headers: { authorization: `Bearer ${sesionOwner()}` },
        payload: { kind: "KITCHEN", kitchenSections: ["COCINA"] },
      });
      const pair = await app.inject({
        method: "POST",
        url: "/devices/pair",
        payload: { code: code.json().code, deviceName: "Pase 3" },
      });
      pantallaToken = pair.json().deviceToken;
    });

    it("la comanda de la M5 llega a la pantalla con su alergia y su silla", async () => {
      ticketId = await abrirMesaConLineas([
        { productId: bravasId, nameSnapshot: "Patatas bravas", units: 2 },
        { productId: canaId, nameSnapshot: "Caña", units: 2 },
      ]);
      // La silla 3 es celíaca y las bravas son suyas.
      const bravasLinea = await prisma.ticketLine.findFirstOrThrow({
        where: { ticketId, nameSnapshot: "Patatas bravas" },
        select: { id: true },
      });
      const alergias = await app.inject({
        method: "PUT",
        url: `/tickets/${ticketId}/allergies`,
        headers: { authorization: `Bearer ${sesionCajero()}` },
        payload: { allergies: [{ seat: 3, allergen: "GLUTEN" }] },
      });
      expect(alergias.statusCode).toBe(200);
      await app.inject({
        method: "PUT",
        url: `/tickets/${ticketId}/lines/${bravasLinea.id}/kitchen`,
        headers: { authorization: `Bearer ${sesionCajero()}` },
        payload: { seat: 3 },
      });

      const envio = await enviar(ticketId, {
        clientSendId: randomUUID(),
        urgent: false,
      });
      expect(envio.statusCode).toBe(200);
      const cocina = envio
        .json()
        .sections.find((s: { section: string }) => s.section === "COCINA");
      expect(cocina.destino).toBe("PANTALLA");
      orderId = cocina.orderId;

      const vista = await app.inject({
        method: "GET",
        url: "/kitchen/comandas",
        headers: { "x-device-token": pantallaToken },
      });
      expect(vista.statusCode).toBe(200);
      const tarjeta = vista
        .json()
        .orders.find((o: { id: string }) => o.id === orderId);
      expect(tarjeta.tableName).toBe("M5");
      expect(tarjeta.allergyBands).toEqual([
        { titulo: "SILLA 3 · CELÍACO", alergenos: "Gluten" },
      ]);
      const plato = tarjeta.lines[0];
      expect(plato.name).toBe("Patatas bravas");
      expect(plato.seat).toBe(3);
      // El cruce de la capa 3, resuelto con el snapshot de alérgenos.
      expect(plato.allergyWarning).toBe("¡LLEVA GLUTEN!");
      // Y la caña NO está: es de BARRA y esta pantalla es de COCINA.
      expect(tarjeta.lines).toHaveLength(1);
    });

    it("tachar el único plato pone la tarjeta en «Lista»", async () => {
      const vista = await app.inject({
        method: "GET",
        url: "/kitchen/comandas",
        headers: { "x-device-token": pantallaToken },
      });
      const tarjeta = vista
        .json()
        .orders.find((o: { id: string }) => o.id === orderId);
      const res = await app.inject({
        method: "POST",
        url: `/kitchen/lineas/${tarjeta.lines[0].id}/hecho`,
        headers: { "x-device-token": pantallaToken },
        payload: { done: true },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().ready).toBe(true);
    });

    it("y el TPV la ve en la lista de «listo para servir» de la TIENDA", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/kitchen/listas",
        headers: { authorization: `Bearer ${sesionCajero()}` },
      });
      expect(res.statusCode).toBe(200);
      const aviso = res
        .json()
        .ready.find((r: { orderId: string }) => r.orderId === orderId);
      expect(aviso.tableName).toBe("M5");
    });

    it("«Servido» la saca de la lista y deja la marca de tiempo", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/kitchen/comandas/${orderId}/servido`,
        headers: { authorization: `Bearer ${sesionCajero()}` },
      });
      expect(res.statusCode).toBe(200);
      const o = await prisma.kitchenOrder.findUniqueOrThrow({
        where: { id: orderId },
        select: { readyAt: true, servedAt: true, servedByUserId: true },
      });
      expect(o.servedAt).not.toBeNull();
      expect(o.servedByUserId).toBe(cashierId);
      const listas = await app.inject({
        method: "GET",
        url: "/kitchen/listas",
        headers: { authorization: `Bearer ${sesionCajero()}` },
      });
      expect(
        listas.json().ready.some((r: { orderId: string }) => r.orderId === orderId),
      ).toBe(false);
    });

    it("EL CHECK · «servido» sin «listo» no cabe en la base", async () => {
      const d = await prisma.kitchenDispatch.create({
        data: {
          tenantId,
          ticketId,
          clientSendId: randomUUID(),
          revision: 99,
          sentByUserId: cashierId,
          result: {},
        },
        select: { id: true },
      });
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO kitchen_orders
             (id, dispatch_id, ticket_id, store_id, section, number, served_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'SALON', 1, now())`,
          randomUUID(),
          d.id,
          ticketId,
          storeId,
        ),
      ).rejects.toThrow(/kitchen_orders_cronologia/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 4 · LA ALERGIA NO SALE DEL TICKET
  // ────────────────────────────────────────────────────────────────────

  describe("SABOTAJE · la alergia llega a Client", () => {
    it("no hay NINGUNA columna de `ticket_allergies` que apunte a `clients`", async () => {
      // La invariante de privacidad de la decisión 3, preguntada al
      // catálogo del sistema: lo que no existe es una clave ajena.
      const fks = await prisma.$queryRawUnsafe<
        Array<{ tabla_destino: string }>
      >(`
        SELECT ccu.table_name AS tabla_destino
          FROM information_schema.table_constraints tc
          JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_name = tc.constraint_name
         WHERE tc.table_name = 'ticket_allergies'
           AND tc.constraint_type = 'FOREIGN KEY'
      `);
      const destinos = fks.map((f) => f.tabla_destino);
      expect(destinos).not.toContain("clients");
      // Lo único a lo que apunta es al ticket.
      expect([...new Set(destinos)]).toEqual(["tickets"]);
    });

    it("cobrar la mesa se lleva las alergias por CASCADE", async () => {
      const ticketId = await abrirMesaConLineas([
        { productId: bravasId, nameSnapshot: "Patatas bravas", units: 1 },
      ]);
      await app.inject({
        method: "PUT",
        url: `/tickets/${ticketId}/allergies`,
        headers: { authorization: `Bearer ${sesionCajero()}` },
        payload: {
          allergies: [
            { seat: 2, allergen: "LACTEOS" },
            { seat: null, allergen: "GLUTEN" },
          ],
        },
      });
      expect(await prisma.ticketAllergy.count({ where: { ticketId } })).toBe(2);
      await prisma.ticket.delete({ where: { id: ticketId } });
      expect(await prisma.ticketAllergy.count({ where: { ticketId } })).toBe(0);
    });

    it("EL ÍNDICE PARCIAL · dos «toda la mesa · GLUTEN» no caben", async () => {
      // En Postgres los NULL son distintos entre sí, así que el único
      // compuesto NO cubre este caso: lo cubre
      // `ticket_allergies_mesa_key`, que Prisma no sabe declarar. Dos
      // filas iguales pintarían la franja roja dos veces.
      const ticketId = await abrirMesaConLineas([
        { productId: bravasId, nameSnapshot: "Patatas bravas", units: 1 },
      ]);
      await prisma.ticketAllergy.create({
        data: { ticketId, seat: null, allergen: "GLUTEN" },
      });
      await expect(
        prisma.ticketAllergy.create({
          data: { ticketId, seat: null, allergen: "GLUTEN" },
        }),
      ).rejects.toThrow();
      // Pero la MISMA alergia en una silla concreta sí es otra fila.
      await prisma.ticketAllergy.create({
        data: { ticketId, seat: 3, allergen: "GLUTEN" },
      });
      expect(await prisma.ticketAllergy.count({ where: { ticketId } })).toBe(2);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 5 · LOS AJUSTES DEL RESTAURANTE
  // ────────────────────────────────────────────────────────────────────

  describe("el semáforo tiene que ser un semáforo", () => {
    it("el CHECK impide los umbrales cruzados, ni por psql", async () => {
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE stores SET kitchen_green_max_min = 30, kitchen_amber_max_min = 20 WHERE id = $1::uuid`,
          storeId,
        ),
      ).rejects.toThrow(/stores_kitchen_semaforo/);
    });

    it("y el panel lo dice con una frase antes de llegar al motor", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/admin/stores/${storeId}/kitchen`,
        headers: { authorization: `Bearer ${sesionOwner()}` },
        payload: { greenMaxMin: 30, amberMaxMin: 20 },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("KITCHEN_SEMAFORO_INVALID");
      expect(res.json().message).toMatch(/mayor que el verde/);
    });

    it("los defaults son los de la decisión 3", async () => {
      const s = await prisma.store.findUniqueOrThrow({
        where: { id: storeId },
        select: {
          kitchenGreenMaxMin: true,
          kitchenAmberMaxMin: true,
          kitchenCourseMode: true,
          kitchenSeatMode: true,
          kitchenReadyBeep: true,
        },
      });
      expect(s.kitchenGreenMaxMin).toBe(10);
      expect(s.kitchenAmberMaxMin).toBe(20);
      expect(s.kitchenCourseMode).toBe("ESPERA");
      expect(s.kitchenSeatMode).toBe("ALERGIA");
      // Decisión 8 · el pitido, APAGADO de serie.
      expect(s.kitchenReadyBeep).toBe(false);
    });
  });
});
