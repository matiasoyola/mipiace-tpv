// kds-2-wifi · LO QUE SÓLO EL MOTOR PUEDE DECIR.
//
// Dos filas de la tabla de sabotajes del bloque viven en POSTGRES, no en
// ninguna ruta, y por eso tienen que probarse aquí:
//
//   | Abrir el servidor local en un `TERMINAL` | el CHECK
//   | `devices_kitchen_lan_solo_cocina` no admite ni APUNTARLO
//   | Clave sin rotar al revocar | el trigger `stores_rotate_lan_key` la
//   | borra, y el servidor emite otra
//
// Los sabotajes van con `$executeRawUnsafe` porque así los escribiría
// alguien con acceso al VPS. Si el invariante viviera en el `if` de una
// ruta, estos UPDATE pasarían y nadie se enteraría — que es exactamente lo
// que le pasó al CHECK `devices_kitchen_sections` de kds-1 con
// `array_length`.
//
// Y lo que no es un CHECK pero sólo se puede afirmar contra Postgres: que
// una marca de cocina subida DOS VECES no mueve nada (la PK del libro), y
// que una marca que llega ANTES que su envío se aplica cuando el envío
// entra.

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
const { registerKitchenRoutes } = await import("../src/kitchen/routes.js");
const { registerKitchenTpvRoutes } = await import("../src/kitchen/tpv-routes.js");
const { registerSendToKitchenEscposRoute } = await import(
  "../src/tickets/send-to-kitchen-escpos.js"
);
const { registerErrorHandler } = await import("../src/lib/error-handler.js");
const { registerLenientJsonParser } = await import("../src/lib/lenient-json.js");
const { signCashierSession } = await import("../src/shift/cashier-session.js");
const { generateDeviceToken } = await import("../src/devices/auth.js");

describe.skipIf(!e2eEnabled)(
  "e2e · kds-2 · el camino directo, contra Postgres",
  () => {
    if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

    const prisma = getPrisma();
    let app: FastifyInstance;

    let tenantId = "";
    let storeId = "";
    let registerId = "";
    let cashierId = "";
    let shiftId = "";
    let terminalId = "";
    let pantallaId = "";
    let pantallaToken = "";
    let mesaId = "";
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

    async function claveDeLaTienda(): Promise<string | null> {
      const s = await prisma.store.findUniqueOrThrow({
        where: { id: storeId },
        select: { kitchenLanKey: true },
      });
      return s.kitchenLanKey;
    }

    /** El `GET /kitchen/me` de la pantalla, que es quien emite la clave. */
    async function meDeLaPantalla() {
      return app.inject({
        method: "GET",
        url: "/kitchen/me",
        headers: { "x-device-token": pantallaToken },
      });
    }

    async function abrirMesaConBravas(units: number): Promise<string> {
      const ticket = await prisma.ticket.create({
        data: {
          tenantId,
          registerId,
          shiftId,
          userId: cashierId,
          internalNumber: `K2-${randomUUID().slice(0, 8)}`,
          externalId: randomUUID(),
          publicSlug: randomUUID().replace(/-/g, "").slice(0, 16),
          status: "DRAFT",
          tableId: mesaId,
          diners: 4,
          total: 0,
          totalTax: 0,
          totalDiscount: 0,
          lines: {
            create: [
              {
                productId: bravasId,
                sku: "RAC-004",
                nameSnapshot: "Patatas bravas",
                units,
                unitPrice: 1,
                taxRate: 10,
                subtotal: units,
                total: units,
              },
            ],
          },
        },
        select: { id: true },
      });
      return ticket.id;
    }

    beforeAll(async () => {
      app = Fastify({ logger: false });
      registerErrorHandler(app);
      registerLenientJsonParser(app);
      await registerSendToKitchenEscposRoute(app);
      await registerKitchenRoutes(app);
      await registerKitchenTpvRoutes(app);
      await app.ready();

      const tenant = await prisma.tenant.create({
        data: {
          name: "BAR KDS2 SL",
          businessType: "HOSPITALITY",
          holdedEnabled: false,
          kitchenDisplayEnabled: true,
          fiscalProfile: { legalName: "BAR KDS2 SL", taxId: "B45902186" },
        },
        select: { id: true },
      });
      tenantId = tenant.id;
      const store = await prisma.store.create({
        data: { tenantId, name: "Local kds-2" },
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
      const cajero = await prisma.user.create({
        data: {
          tenantId,
          email: `kds2-${randomUUID().slice(0, 8)}@bar.es`,
          role: "CASHIER",
          passwordHash: "x",
        },
        select: { id: true },
      });
      cashierId = cajero.id;

      const t = generateDeviceToken();
      const terminal = await prisma.device.create({
        data: {
          tenantId,
          registerId,
          deviceTokenHash: t.hash,
          name: "Caja",
        },
        select: { id: true },
      });
      terminalId = terminal.id;

      const p = generateDeviceToken();
      pantallaToken = p.plain;
      const pantalla = await prisma.device.create({
        data: {
          tenantId,
          registerId,
          deviceTokenHash: p.hash,
          kind: "KITCHEN",
          kitchenSections: ["COCINA"],
          name: "Pase",
        },
        select: { id: true },
      });
      pantallaId = pantalla.id;

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

      const bravas = await prisma.product.create({
        data: {
          tenantId,
          name: "Patatas bravas",
          sku: "RAC-004",
          basePrice: 9.09,
          taxRate: 10,
          tags: ["raciones"],
          source: "LOCAL",
          allergens: ["GLUTEN"],
        },
        select: { id: true },
      });
      bravasId = bravas.id;
      await prisma.tagSection.create({
        data: { tenantId, slug: "raciones", section: "COCINA" },
      });
    });

    afterAll(async () => {
      await app?.close();
      await shutdown();
    });

    // ──────────────────────────────────────────────────────────────────
    // 1 · UN TERMINAL NO ESCUCHA EN NINGÚN PUERTO
    // ──────────────────────────────────────────────────────────────────

    describe("SABOTAJE · abrir el servidor local en un TERMINAL", () => {
      it("la pantalla SÍ puede anunciar dónde escucha", async () => {
        const res = await app.inject({
          method: "POST",
          url: "/kitchen/latido",
          headers: { "x-device-token": pantallaToken },
          payload: { lanIp: "192.168.1.44", lanPort: 8787, lanListening: true },
        });
        expect(res.statusCode).toBe(200);
        const d = await prisma.device.findUniqueOrThrow({
          where: { id: pantallaId },
          select: { kitchenLanIp: true, kitchenLanPort: true },
        });
        expect(d.kitchenLanIp).toBe("192.168.1.44");
        expect(d.kitchenLanPort).toBe(8787);
      });

      it("y el TERMINAL no, ni escribiéndolo A MANO en la base", async () => {
        // Así lo escribiría alguien con acceso al VPS, o un `if` que falte
        // en una ruta futura. El motor lo rechaza.
        await expect(
          prisma.$executeRawUnsafe(
            `UPDATE devices SET kitchen_lan_ip = '192.168.1.9', kitchen_lan_port = 8787 WHERE id = '${terminalId}'`,
          ),
        ).rejects.toThrow(/devices_kitchen_lan_solo_cocina/);
      });

      it("ni sólo el puerto, ni sólo la hora", async () => {
        await expect(
          prisma.$executeRawUnsafe(
            `UPDATE devices SET kitchen_lan_port = 8787 WHERE id = '${terminalId}'`,
          ),
        ).rejects.toThrow(/devices_kitchen_lan_solo_cocina/);
        await expect(
          prisma.$executeRawUnsafe(
            `UPDATE devices SET kitchen_lan_at = now() WHERE id = '${terminalId}'`,
          ),
        ).rejects.toThrow(/devices_kitchen_lan_solo_cocina/);
      });

      it("y un puerto privilegiado tampoco entra, ni en la pantalla", async () => {
        await expect(
          prisma.$executeRawUnsafe(
            `UPDATE devices SET kitchen_lan_port = 80 WHERE id = '${pantallaId}'`,
          ),
        ).rejects.toThrow(/devices_kitchen_lan_port_range/);
      });
    });

    // ──────────────────────────────────────────────────────────────────
    // 2 · LA CLAVE SE ROTA AL REVOCAR
    // ──────────────────────────────────────────────────────────────────

    describe("SABOTAJE · clave sin rotar al revocar un aparato", () => {
      it("la clave la emite el servidor y queda en la tienda", async () => {
        // Ya existe: el latido del bloque anterior también la emite, y es
        // deliberado —es por donde la tablet se entera de que se rotó—.
        const res = await meDeLaPantalla();
        expect(res.statusCode).toBe(200);
        const clave = res.json().lan.key as string;
        expect(clave).toHaveLength(43);
        expect(await claveDeLaTienda()).toBe(clave);
      });

      it("y el terminal recibe LA MISMA", async () => {
        const res = await app.inject({
          method: "GET",
          url: "/kitchen/estado",
          headers: { authorization: `Bearer ${sesionCajero()}` },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().lan.key).toBe(await claveDeLaTienda());
        expect(res.json().lan.storeId).toBe(storeId);
        expect(res.json().lan.deviceId).toBe(terminalId);
      });

      it("REVOCAR un aparato la borra: lo hace el TRIGGER, no la ruta", async () => {
        const antes = await claveDeLaTienda();
        expect(antes).not.toBeNull();

        // Se revoca un terminal cualquiera de la tienda. No se llama a
        // ninguna ruta de este bloque: el trigger cuelga de `devices`.
        const otro = generateDeviceToken();
        const sobrante = await prisma.device.create({
          data: {
            tenantId,
            registerId,
            deviceTokenHash: otro.hash,
            kind: "TEST",
            name: "Laboratorio",
          },
          select: { id: true },
        });
        await prisma.device.update({
          where: { id: sobrante.id },
          data: { revokedAt: new Date(), revokedReason: "ADMIN" },
        });

        expect(await claveDeLaTienda()).toBeNull();

        // Y la siguiente vez que la pantalla pregunta, nace OTRA.
        const res = await meDeLaPantalla();
        const nueva = res.json().lan.key as string;
        expect(nueva).toHaveLength(43);
        expect(nueva).not.toBe(antes);
      });

      it("un UPDATE que no revoca NO rota la clave", async () => {
        // El `WHEN` del trigger. Sin él, cada latido rezagado de un aparato
        // ya revocado rotaría la clave y el bar se quedaría sin camino
        // directo cada 20 s.
        const clave = await claveDeLaTienda();
        await prisma.device.update({
          where: { id: pantallaId },
          data: { lastSeenAt: new Date() },
        });
        expect(await claveDeLaTienda()).toBe(clave);
      });
    });

    // ──────────────────────────────────────────────────────────────────
    // 3 · AL VOLVER INTERNET, SIN DUPLICAR
    // ──────────────────────────────────────────────────────────────────

    describe("SABOTAJE · al volver internet, duplicar", () => {
      it("el libro de marcas es idempotente por el `markId` de la tablet", async () => {
        const ticketId = await abrirMesaConBravas(2);
        const clientSendId = randomUUID();
        const envio = await app.inject({
          method: "POST",
          url: `/tickets/${ticketId}/send-to-kitchen/escpos`,
          headers: { authorization: `Bearer ${sesionCajero()}` },
          payload: { clientSendId },
        });
        expect(envio.statusCode).toBe(200);
        const orderId = envio.json().sections[0].orderId as string;
        const linea = await prisma.kitchenOrderLine.findFirstOrThrow({
          where: { orderId },
          select: { ticketLineId: true },
        });

        const marcado = new Date("2026-10-09T13:05:00.000Z");
        const marca = {
          markId: randomUUID(),
          kind: "HECHO",
          clientSendId,
          section: "COCINA",
          ticketLineId: linea.ticketLineId,
          done: true,
          at: marcado.toISOString(),
        };
        const cuerpo = { marcas: [marca], recibidas: [clientSendId] };

        const una = await app.inject({
          method: "POST",
          url: "/kitchen/sincronizar",
          headers: { "x-device-token": pantallaToken },
          payload: cuerpo,
        });
        expect(una.statusCode).toBe(200);
        expect(una.json()).toMatchObject({ guardadas: 1, aplicadas: 1 });

        // La MISMA subida otra vez: el terminal reintenta hasta que el
        // servidor contesta, y puede contestar dos veces.
        const dos = await app.inject({
          method: "POST",
          url: "/kitchen/sincronizar",
          headers: { "x-device-token": pantallaToken },
          payload: cuerpo,
        });
        expect(dos.statusCode).toBe(200);
        expect(dos.json().guardadas).toBe(0);
        expect(
          await prisma.kitchenLanMark.count({ where: { clientSendId } }),
        ).toBe(1);

        // Y la hora que queda es la de LA TABLET, no la de ahora.
        const despues = await prisma.kitchenOrderLine.findFirstOrThrow({
          where: { orderId },
          select: { doneAt: true, doneByDeviceId: true },
        });
        expect(despues.doneAt?.toISOString()).toBe(marcado.toISOString());
        expect(despues.doneByDeviceId).toBe(pantallaId);

        // Y la tarjeta queda marcada como «ya la tenía por la wifi».
        const order = await prisma.kitchenOrder.findUniqueOrThrow({
          where: { id: orderId },
          select: { lanReceivedAt: true, lateArrival: true },
        });
        expect(order.lanReceivedAt).not.toBeNull();
        expect(order.lateArrival).toBe(false);
      });

      it("una marca que llega ANTES que su envío la aplica el envío", async () => {
        const ticketId = await abrirMesaConBravas(1);
        const clientSendId = randomUUID();
        const marcado = new Date("2026-10-09T14:10:00.000Z");

        // La tablet sube antes que el terminal: pasa de verdad, porque la
        // tablet puede tener cobertura antes.
        const antes = await app.inject({
          method: "POST",
          url: "/kitchen/sincronizar",
          headers: { "x-device-token": pantallaToken },
          payload: {
            marcas: [
              {
                markId: randomUUID(),
                kind: "LISTA",
                clientSendId,
                section: "COCINA",
                at: marcado.toISOString(),
              },
            ],
          },
        });
        expect(antes.json()).toMatchObject({ guardadas: 1, aplicadas: 0 });

        const envio = await app.inject({
          method: "POST",
          url: `/tickets/${ticketId}/send-to-kitchen/escpos`,
          headers: { authorization: `Bearer ${sesionCajero()}` },
          payload: { clientSendId },
        });
        expect(envio.statusCode).toBe(200);
        const orderId = envio.json().sections[0].orderId as string;

        const order = await prisma.kitchenOrder.findUniqueOrThrow({
          where: { id: orderId },
          select: { readyAt: true, readyByDeviceId: true },
        });
        expect(order.readyAt?.toISOString()).toBe(marcado.toISOString());
        expect(order.readyByDeviceId).toBe(pantallaId);
        // La marca ya no está pendiente.
        expect(
          await prisma.kitchenLanMark.count({
            where: { clientSendId, appliedAt: null },
          }),
        ).toBe(0);
      });

      it("y el CHECK de las coordenadas no admite una marca incoherente", async () => {
        // Un `LISTA` que apunte a un plato, o un `HECHO` sin plato, serían
        // una marca que no se puede aplicar a nada.
        await expect(
          prisma.$executeRawUnsafe(
            `INSERT INTO kitchen_lan_marks (mark_id, device_id, store_id, kind, client_send_id, section, ticket_line_id, done, at)
             VALUES ('${randomUUID()}', '${pantallaId}', '${storeId}', 'LISTA', '${randomUUID()}', 'COCINA', '${randomUUID()}', NULL, now())`,
          ),
        ).rejects.toThrow(/kitchen_lan_marks_coordenadas/);
        await expect(
          prisma.$executeRawUnsafe(
            `INSERT INTO kitchen_lan_marks (mark_id, device_id, store_id, kind, client_send_id, section, ticket_line_id, done, at)
             VALUES ('${randomUUID()}', '${pantallaId}', '${storeId}', 'HECHO', '${randomUUID()}', 'COCINA', NULL, true, now())`,
          ),
        ).rejects.toThrow(/kitchen_lan_marks_coordenadas/);
      });

      it("y tampoco un tipo de marca que no existe", async () => {
        // HALLAZGO, dicho en voz alta: el que salta es
        // `kitchen_lan_marks_coordenadas`, no `kitchen_lan_marks_kind`.
        // Las tres ramas de coordenadas NOMBRAN cada una su `kind`, así que
        // un valor inventado no encaja en ninguna y cae ahí primero —
        // también con coordenadas por lo demás correctas.
        //
        // O sea: `kitchen_lan_marks_kind` es REDUNDANTE hoy y no se puede
        // poner en rojo solo. Se deja puesto a propósito: documenta los
        // tres valores en el motor y sigue cerrando la puerta si alguien
        // relaja coordenadas mañana. Lo que este test afirma es lo que
        // importa —la fila NO entra— y se ata al código 23514 de Postgres
        // («check_violation») en vez de a cuál de los dos CHECK salta.
        for (const coordenadas of [
          `NULL, NULL`,
          `'${randomUUID()}', true`,
        ]) {
          await expect(
            prisma.$executeRawUnsafe(
              `INSERT INTO kitchen_lan_marks (mark_id, device_id, store_id, kind, client_send_id, section, ticket_line_id, done, at)
               VALUES ('${randomUUID()}', '${pantallaId}', '${storeId}', 'INVENTADA', '${randomUUID()}', 'COCINA', ${coordenadas}, now())`,
            ),
          ).rejects.toThrow(/23514/);
        }
      });
    });
  },
);
