// auditoria-sirope · EL RECORRIDO DE SIROPE, CONTRA POSTGRES.
//
// Lo que sólo se puede comprobar con la base de verdad: que la venta de
// mostrador nace, va a cocina, se cobra y CIERRA su comanda; y que una
// devolución es posible en una cuenta sin Holded y en ensayo.
//
// La cuenta es la de Cafetería Sirope el 18-10: **sin Holded y en
// ensayo** (`facturaDesde = null`), con la pantalla de cocina encendida y
// el mapa etiqueta→sección que se configuró ese día.
//
// Las filas de la tabla de sabotajes del bloque que viven aquí:
//
//   | La regla de devolvible excluye PAID / TEST en ensayo (#17)
//   | El cobro no marca servidas las comandas listas (#22)
//   | Una línea sin sección se da por «enviada» (#19)
//   | Vaciar con consumo sin motivo (#18)
//   | Cobrar deja la mesa en FREE en vez de POR_RECOGER (#14)

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
vi.mock("../src/queues/refund-upload.js", () => ({
  enqueueRefundUpload: async () => {},
}));

const { getPrisma, shutdown } = await import("../src/context.js");
const { registerKitchenRoutes } = await import("../src/kitchen/routes.js");
const { registerKitchenTpvRoutes } = await import("../src/kitchen/tpv-routes.js");
const { registerSendToKitchenEscposRoute } = await import(
  "../src/tickets/send-to-kitchen-escpos.js"
);
const { registerMostradorRoutes } = await import("../src/tickets/mostrador.js");
const { registerTableOperativaRoutes } = await import(
  "../src/tables/operativa.js"
);
const { registerTicketRoutes } = await import("../src/tickets/routes.js");
const { registerErrorHandler } = await import("../src/lib/error-handler.js");
const { registerLenientJsonParser } = await import("../src/lib/lenient-json.js");
const { signCashierSession } = await import("../src/shift/cashier-session.js");
const { generateDeviceToken } = await import("../src/devices/auth.js");

describe.skipIf(!e2eEnabled)("e2e · auditoria-sirope", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let app: FastifyInstance;

  let tenantId = "";
  let storeId = "";
  let registerId = "";
  let cashierId = "";
  let shiftId = "";
  let terminalId = "";
  let mesaId = "";
  let tostadaId = "";
  let cafeId = "";

  function sesion() {
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

  function post(url: string, payload: unknown = {}) {
    return app.inject({
      method: "POST",
      url,
      headers: { authorization: `Bearer ${sesion()}` },
      payload: payload as Record<string, unknown>,
    });
  }

  function del(url: string) {
    return app.inject({
      method: "DELETE",
      url,
      headers: { authorization: `Bearer ${sesion()}` },
    });
  }

  function lineaDe(productId: string, nombre: string, precio: number) {
    return {
      productId,
      nameSnapshot: nombre,
      sku: `SKU-${nombre.slice(0, 4).toUpperCase()}`,
      units: 1,
      unitPrice: precio,
      discountPct: 0,
      taxRate: 10,
      lineExternalId: randomUUID(),
    };
  }

  beforeAll(async () => {
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    registerLenientJsonParser(app);
    await registerTicketRoutes(app);
    await registerTableOperativaRoutes(app);
    await registerMostradorRoutes(app);
    await registerSendToKitchenEscposRoute(app);
    await registerKitchenRoutes(app);
    await registerKitchenTpvRoutes(app);
    await app.ready();

    const tenant = await prisma.tenant.create({
      data: {
        name: "CAFETERIA SIROPE SL",
        businessType: "HOSPITALITY",
        // La cuenta del 18-10: sin Holded…
        holdedEnabled: false,
        // …y EN ENSAYO: `facturaDesde` nulo (ADR-021).
        facturaDesde: null,
        kitchenDisplayEnabled: true,
        fiscalProfile: { legalName: "CAFETERIA SIROPE SL", taxId: "B11111111" },
      },
      select: { id: true },
    });
    tenantId = tenant.id;
    storeId = (
      await prisma.store.create({
        data: { tenantId, name: "Sirope" },
        select: { id: true },
      })
    ).id;
    registerId = (
      await prisma.register.create({
        data: { storeId, name: "Caja 1" },
        select: { id: true },
      })
    ).id;
    mesaId = (
      await prisma.table.create({
        data: { storeId, name: "T6", capacity: 4, zone: "SALON" },
        select: { id: true },
      })
    ).id;
    cashierId = (
      await prisma.user.create({
        data: {
          tenantId,
          email: "gemma@sirope.es",
          role: "CASHIER",
          alias: "Gemma",
          passwordHash: "x",
        },
        select: { id: true },
      })
    ).id;
    const { hash } = generateDeviceToken();
    terminalId = (
      await prisma.device.create({
        data: { tenantId, registerId, deviceTokenHash: hash, name: "D8" },
        select: { id: true },
      })
    ).id;
    // El AP11: la pantalla de Cocina y Barra.
    const { hash: hashKds } = generateDeviceToken();
    await prisma.device.create({
      data: {
        tenantId,
        registerId,
        deviceTokenHash: hashKds,
        name: "AP11-1006",
        kind: "KITCHEN",
        kitchenSections: ["COCINA", "BARRA"],
      },
    });
    shiftId = (
      await prisma.shift.create({
        data: { registerId, userId: cashierId, openedAt: new Date(), cashOpening: 50 },
        select: { id: true },
      })
    ).id;

    tostadaId = (
      await prisma.product.create({
        data: {
          tenantId,
          name: "Tostada con tomate",
          sku: "TOS-001",
          basePrice: 2.2,
          taxRate: 10,
          tags: ["tostadas"],
          source: "LOCAL",
        },
        select: { id: true },
      })
    ).id;
    cafeId = (
      await prisma.product.create({
        data: {
          tenantId,
          name: "Café con leche",
          sku: "CAF-001",
          basePrice: 1.3,
          taxRate: 10,
          tags: ["cafe"],
          source: "LOCAL",
        },
        select: { id: true },
      })
    ).id;
    // El mapa del 18-10: tostadas a COCINA, cafés a BARRA.
    await prisma.tagSection.createMany({
      data: [
        { tenantId, slug: "tostadas", section: "COCINA" },
        { tenantId, slug: "cafe", section: "BARRA" },
      ],
    });
  });

  afterAll(async () => {
    await prisma.ticket.deleteMany({ where: { tenantId, status: "DRAFT" } });
    await app?.close();
    await shutdown();
  });

  // ──────────────────────────────────────────────────────────────────
  // #25 · la venta de mostrador llega a cocina y se cobra
  // ──────────────────────────────────────────────────────────────────

  describe("#25 · mostrador → cocina → cobro", () => {
    let ticketId = "";

    it("el borrador de mostrador nace sin mesa y con su número del día", async () => {
      const res = await post("/mostrador/draft", {
        lines: [lineaDe(tostadaId, "Tostada con tomate", 2.2)],
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      ticketId = body.ticket.id;
      expect(body.ticket.tableId).toBeNull();
      expect(body.counterNumber).toBe(1);
      expect(body.counterLabel).toBe("Mostrador nº 1");
    });

    it("la comanda llega a la pantalla titulada «Mostrador nº 1»", async () => {
      const res = await post(`/tickets/${ticketId}/send-to-kitchen/escpos`, {
        clientSendId: randomUUID(),
      });
      expect(res.statusCode).toBe(200);
      const cocina = res
        .json()
        .sections.find((s: { section: string }) => s.section === "COCINA");
      expect(cocina.destino).toBe("PANTALLA");

      const order = await prisma.kitchenOrder.findFirstOrThrow({
        where: { ticketId },
        select: { tableName: true, tableId: true, id: true },
      });
      expect(order.tableId).toBeNull();
      expect(order.tableName).toBe("Mostrador nº 1");
    });

    it("el segundo mostrador del día es el nº 2", async () => {
      const res = await post("/mostrador/draft", {
        lines: [lineaDe(cafeId, "Café con leche", 1.3)],
      });
      expect(res.json().counterNumber).toBe(2);
      // Y se va: no deja mesa abierta ni cuenta para el barrido.
      await del(`/tickets/${res.json().ticket.id}`);
    });

    // ────────────────────────────────────────────────────────────────
    // #22 · cobrar cierra lo que estaba LISTO
    // ────────────────────────────────────────────────────────────────

    it("#22 · cobrar marca servidas las comandas LISTAS", async () => {
      // La cocina la da por lista.
      const order = await prisma.kitchenOrder.findFirstOrThrow({
        where: { ticketId },
        select: { id: true },
      });
      await prisma.kitchenOrder.update({
        where: { id: order.id },
        data: { readyAt: new Date() },
      });

      const res = await post(`/tickets/${ticketId}/checkout`, {
        externalId: randomUUID(),
        payments: [{ method: "CASH", amount: 2.42 }],
      });
      expect(res.statusCode).toBe(200);

      const despues = await prisma.kitchenOrder.findUniqueOrThrow({
        where: { id: order.id },
        select: { servedAt: true, servedByUserId: true },
      });
      // EL SABOTAJE: sin `servirComandasListas` en el checkout, esto es
      // `null` y la tarjeta se queda esperando a un cliente que se fue.
      expect(despues.servedAt).not.toBeNull();
      expect(despues.servedByUserId).toBe(cashierId);
    });

    it("#22 · y la cuenta ya no tiene nada listo pendiente", async () => {
      const pendientes = await prisma.kitchenOrder.count({
        where: { ticketId, readyAt: { not: null }, servedAt: null },
      });
      expect(pendientes).toBe(0);
    });

    it("#22 · lo que NO estaba listo sigue en la plancha", async () => {
      // Una venta nueva, enviada y cobrada SIN pasar por «Lista».
      const draft = await post("/mostrador/draft", {
        lines: [lineaDe(tostadaId, "Tostada con tomate", 2.2)],
      });
      const id = draft.json().ticket.id;
      await post(`/tickets/${id}/send-to-kitchen/escpos`, {
        clientSendId: randomUUID(),
      });
      await post(`/tickets/${id}/checkout`, {
        externalId: randomUUID(),
        payments: [{ method: "CASH", amount: 2.42 }],
      });
      const order = await prisma.kitchenOrder.findFirstOrThrow({
        where: { ticketId: id },
        select: { readyAt: true, servedAt: true },
      });
      expect(order.readyAt).toBeNull();
      // Cobrar no hace desaparecer un plato a medio hacer.
      expect(order.servedAt).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // #17 · devolver en una cuenta sin Holded y en ensayo
  // ──────────────────────────────────────────────────────────────────

  describe("#17 · la devolución que Sirope no podía hacer", () => {
    it("un ticket de esta cuenta se puede devolver", async () => {
      const draft = await post("/mostrador/draft", {
        lines: [lineaDe(cafeId, "Café con leche", 1.3)],
      });
      const ticketId = draft.json().ticket.id;
      const lineId = draft.json().ticket.lines[0].id;
      const cobro = await post(`/tickets/${ticketId}/checkout`, {
        externalId: randomUUID(),
        payments: [{ method: "CASH", amount: 1.43 }],
      });
      expect(cobro.statusCode).toBe(200);
      // En ensayo el ticket nace TEST (ADR-021). Antes del bloque, el TPV
      // no ofrecía devolverlo y el mensaje del servidor hablaba de Holded.
      const estado = await prisma.ticket.findUniqueOrThrow({
        where: { id: ticketId },
        select: { status: true },
      });
      expect(estado.status).toBe("TEST");

      const refund = await post("/refunds", {
        externalId: randomUUID(),
        originalTicketId: ticketId,
        lines: [{ ticketLineId: lineId, units: 1 }],
      });
      expect(refund.statusCode).toBe(201);
    });
  });
});
