// hierro-sirope (A) · LA COMANDA HUÉRFANA, CONTRA POSTGRES DE VERDAD.
//
// Lo que NO puede probar el banco con un Prisma falso, y por eso está
// aquí:
//
//   | `servedAt` un ms antes que `readyAt` | el CHECK
//   | `kitchen_orders_cronologia`
//
// El CHECK de kds-1 decía dos cosas —no estar listo antes de enviado, no
// estar servido sin estar listo— y daba por supuesta la tercera. Este
// bloque se la añade (migración `20261019020000`), porque la regla de la
// huérfana escribe `served_at` a partir de `ready_at` en tres sitios y
// «se usa el mismo instante» tiene que ser una invariante del motor y no
// una costumbre del código.
//
// Y de paso el recorrido entero del 18-10 sobre la base de verdad: M5 con
// un café en BARRA, «Vaciar mesa» con motivo, «Lista» en el AP11 → la
// tarjeta sale sola de la pantalla en vez de quedarse nueve horas.

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
const { registerSendToKitchenEscposRoute } = await import(
  "../src/tickets/send-to-kitchen-escpos.js"
);
const { registerErrorHandler } = await import("../src/lib/error-handler.js");
const { registerLenientJsonParser } = await import("../src/lib/lenient-json.js");
const { signCashierSession } = await import("../src/shift/cashier-session.js");
const { generateDeviceToken } = await import("../src/devices/auth.js");
const { voidDraftTicket } = await import("../src/tables/void-draft.js");
const { runComandasHuerfanasSweep } = await import("../src/kitchen/huerfanas.js");
const { limpiarComandasHuerfanas } = await import(
  "../src/kitchen/limpieza-huerfanas.js"
);

describe.skipIf(!e2eEnabled)(
  "e2e · hierro-sirope A · la comanda huérfana, contra Postgres",
  () => {
    if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

    const prisma = getPrisma();
    let app: FastifyInstance;

    let tenantId = "";
    let storeId = "";
    let registerId = "";
    let cashierId = "";
    let shiftId = "";
    let mesaId = "";
    let pantallaToken = "";
    let cafeId = "";

    const log = { info: () => undefined, error: () => undefined };

    function sesionCajero() {
      return signCashierSession(
        {
          sub: cashierId,
          tid: tenantId,
          did: randomUUID(),
          rid: registerId,
          role: "CASHIER",
        },
        30,
      );
    }

    /** La M5 del 18-10: un café americano. */
    async function abrirLaM5(): Promise<string> {
      const ticket = await prisma.ticket.create({
        data: {
          tenantId,
          registerId,
          shiftId,
          userId: cashierId,
          internalNumber: `HUE-${randomUUID().slice(0, 8)}`,
          externalId: randomUUID(),
          publicSlug: randomUUID().replace(/-/g, "").slice(0, 16),
          status: "DRAFT",
          tableId: mesaId,
          diners: 2,
          total: 1.5,
          totalTax: 0,
          totalDiscount: 0,
          lines: {
            create: [
              {
                productId: cafeId,
                sku: "CAF-001",
                nameSnapshot: "Café Americano",
                units: 1,
                unitPrice: 1.5,
                taxRate: 0,
                subtotal: 1.5,
                total: 1.5,
              },
            ],
          },
        },
        select: { id: true },
      });
      return ticket.id;
    }

    async function mandarABarra(ticketId: string): Promise<string> {
      const res = await app.inject({
        method: "POST",
        url: `/tickets/${ticketId}/send-to-kitchen/escpos`,
        headers: { authorization: `Bearer ${sesionCajero()}` },
        payload: { clientSendId: randomUUID() },
      });
      expect(res.statusCode).toBe(200);
      return res.json().sections[0].orderId as string;
    }

    /** «Vaciar mesa» → motivo Invitación, el camino real del 18-10. */
    async function vaciarConInvitacion(ticketId: string) {
      const r = await voidDraftTicket({
        prisma,
        ticketId,
        tenantId,
        reason: "MANUAL",
        motivo: "INVITACION",
        byUserId: cashierId,
        now: new Date(),
      });
      expect(r.ok).toBe(true);
    }

    beforeAll(async () => {
      app = Fastify({ logger: false });
      registerErrorHandler(app);
      registerLenientJsonParser(app);
      await registerSendToKitchenEscposRoute(app);
      await registerKitchenRoutes(app);
      await app.ready();

      const tenant = await prisma.tenant.create({
        data: {
          name: "CAFETERIA HUERFANA SL",
          businessType: "HOSPITALITY",
          holdedEnabled: false,
          kitchenDisplayEnabled: true,
          fiscalProfile: {
            legalName: "CAFETERIA HUERFANA SL",
            taxId: "B45902186",
          },
        },
        select: { id: true },
      });
      tenantId = tenant.id;
      const store = await prisma.store.create({
        data: { tenantId, name: "Sirope (e2e)" },
        select: { id: true },
      });
      storeId = store.id;
      const register = await prisma.register.create({
        data: { storeId, name: "Caja 2" },
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
          email: `huerfana-${randomUUID().slice(0, 8)}@bar.es`,
          role: "CASHIER",
          passwordHash: "x",
        },
        select: { id: true },
      });
      cashierId = cajero.id;

      const p = generateDeviceToken();
      pantallaToken = p.plain;
      await prisma.device.create({
        data: {
          tenantId,
          registerId,
          deviceTokenHash: p.hash,
          kind: "KITCHEN",
          kitchenSections: ["BARRA"],
          name: "Cocina · Barra",
        },
      });

      const shift = await prisma.shift.create({
        data: {
          registerId,
          userId: cashierId,
          openedAt: new Date(),
          cashOpening: 50,
        },
        select: { id: true },
      });
      shiftId = shift.id;

      const cafe = await prisma.product.create({
        data: {
          tenantId,
          name: "Café Americano",
          sku: "CAF-001",
          basePrice: 1.5,
          taxRate: 0,
          tags: ["cafe"],
          source: "LOCAL",
          allergens: [] as never,
        },
        select: { id: true },
      });
      cafeId = cafe.id;
      await prisma.tagSection.create({
        data: { tenantId, slug: "cafe", section: "BARRA" },
      });
    });

    afterAll(async () => {
      // Lo que deja este fichero se lo lleva este fichero: el barrido de
      // mesas abandonadas mira los DRAFT de TODOS los tenants y
      // `ciclo-de-caja.e2e.ts` afirma un número exacto.
      await prisma.ticket.deleteMany({ where: { tenantId, status: "DRAFT" } });
      await app?.close();
      await shutdown();
    });

    // ──────────────────────────────────────────────────────────────────
    // 1 · SABOTAJE · `servedAt` un ms antes que `readyAt`
    // ──────────────────────────────────────────────────────────────────
    describe("SABOTAJE · servir antes de estar listo", () => {
      it("el CHECK kitchen_orders_cronologia lo rechaza", async () => {
        const ticketId = await abrirLaM5();
        const orderId = await mandarABarra(ticketId);
        const listo = new Date();

        // La invariante, por el motor: un milisegundo antes y la fila no
        // entra. Sin ella, el tiempo en el pase del informe del dueño
        // sale negativo y nada se queja.
        await expect(
          prisma.$executeRaw`
            UPDATE "kitchen_orders"
               SET "ready_at" = ${listo},
                   "served_at" = ${new Date(listo.getTime() - 1)}
             WHERE "id" = ${orderId}::uuid
          `,
        ).rejects.toThrow(/kitchen_orders_cronologia/);

        // Y con el MISMO instante —que es lo que escribe la regla de la
        // huérfana— entra sin problema.
        await prisma.$executeRaw`
          UPDATE "kitchen_orders"
             SET "ready_at" = ${listo}, "served_at" = ${listo}
           WHERE "id" = ${orderId}::uuid
        `;
        const o = await prisma.kitchenOrder.findUniqueOrThrow({
          where: { id: orderId },
          select: { readyAt: true, servedAt: true },
        });
        expect(o.servedAt?.toISOString()).toBe(o.readyAt?.toISOString());
      });
    });

    // ──────────────────────────────────────────────────────────────────
    // 2 · EL RECORRIDO DEL 18-10 (capturas 37–41)
    // ──────────────────────────────────────────────────────────────────
    describe("vaciar M5 y que cocina pulse «Lista» después", () => {
      it("la tarjeta se sirve sola y sale de la pantalla", async () => {
        const ticketId = await abrirLaM5();
        const orderId = await mandarABarra(ticketId);
        await vaciarConInvitacion(ticketId);

        // La tarjeta sigue viva en la pantalla: «un plato en la plancha
        // sigue en la plancha» (auditoria-sirope #22) no se toca.
        const antes = await prisma.kitchenOrder.findUniqueOrThrow({
          where: { id: orderId },
          select: { readyAt: true, servedAt: true },
        });
        expect(antes.readyAt).toBeNull();
        expect(antes.servedAt).toBeNull();

        const res = await app.inject({
          method: "POST",
          url: `/kitchen/comandas/${orderId}/lista`,
          headers: { "x-device-token": pantallaToken },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ huerfana: true });

        const o = await prisma.kitchenOrder.findUniqueOrThrow({
          where: { id: orderId },
          select: { readyAt: true, servedAt: true, servedByUserId: true },
        });
        expect(o.readyAt).not.toBeNull();
        expect(o.servedAt?.toISOString()).toBe(o.readyAt?.toISOString());
        expect(o.servedByUserId).toBeNull();
      });

      it("y «Hoy» no la puede devolver a la pantalla", async () => {
        const ticketId = await abrirLaM5();
        const orderId = await mandarABarra(ticketId);
        await vaciarConInvitacion(ticketId);
        await app.inject({
          method: "POST",
          url: `/kitchen/comandas/${orderId}/lista`,
          headers: { "x-device-token": pantallaToken },
        });

        const res = await app.inject({
          method: "POST",
          url: `/kitchen/comandas/${orderId}/recuperar`,
          headers: { "x-device-token": pantallaToken },
        });
        expect(res.statusCode).toBe(409);
        expect(res.json().error).toBe("ORDER_TICKET_CERRADO");
      });

      it("con la mesa VIVA, «Lista» sigue sin servir nada", async () => {
        const ticketId = await abrirLaM5();
        const orderId = await mandarABarra(ticketId);

        const res = await app.inject({
          method: "POST",
          url: `/kitchen/comandas/${orderId}/lista`,
          headers: { "x-device-token": pantallaToken },
        });
        expect(res.json()).toMatchObject({ huerfana: false });
        const o = await prisma.kitchenOrder.findUniqueOrThrow({
          where: { id: orderId },
          select: { servedAt: true },
        });
        expect(o.servedAt).toBeNull();
      });
    });

    // ──────────────────────────────────────────────────────────────────
    // 3 · LA QUE NUNCA SE MARCA LISTA
    // ──────────────────────────────────────────────────────────────────
    describe("el barrido del corte de día y la limpieza única", () => {
      it("sirve la que nadie tachó, y la segunda pasada no encuentra nada", async () => {
        const ticketId = await abrirLaM5();
        const orderId = await mandarABarra(ticketId);
        await vaciarConInvitacion(ticketId);
        // Envejecida: tiene que haber cruzado el corte de las 05:00.
        const ayer = new Date(Date.now() - 36 * 60 * 60 * 1000);
        await prisma.$executeRaw`
          UPDATE "kitchen_orders" SET "sent_at" = ${ayer} WHERE "id" = ${orderId}::uuid
        `;

        const primera = await runComandasHuerfanasSweep({ prisma, log });
        expect(primera.servidas.map((s) => s.orderId)).toContain(orderId);

        const o = await prisma.kitchenOrder.findUniqueOrThrow({
          where: { id: orderId },
          select: { readyAt: true, servedAt: true, servedByUserId: true },
        });
        expect(o.readyAt).not.toBeNull();
        expect(o.servedAt).not.toBeNull();
        expect(o.servedByUserId).toBeNull();

        const segunda = await runComandasHuerfanasSweep({ prisma, log });
        expect(segunda.servidas.map((s) => s.orderId)).not.toContain(orderId);
      });

      it("SABOTAJE · el script escribe sin `--apply`", async () => {
        const ticketId = await abrirLaM5();
        const orderId = await mandarABarra(ticketId);
        await vaciarConInvitacion(ticketId);
        const ayer = new Date(Date.now() - 36 * 60 * 60 * 1000);
        await prisma.$executeRaw`
          UPDATE "kitchen_orders" SET "sent_at" = ${ayer} WHERE "id" = ${orderId}::uuid
        `;

        const seco = await limpiarComandasHuerfanas({ prisma, apply: false });
        expect(seco.aServir.map((f) => f.id)).toContain(orderId);
        expect(seco.escritas).toBe(0);
        const sinTocar = await prisma.kitchenOrder.findUniqueOrThrow({
          where: { id: orderId },
          select: { servedAt: true },
        });
        expect(sinTocar.servedAt).toBeNull();

        const r = await limpiarComandasHuerfanas({ prisma, apply: true });
        expect(r.escritas).toBeGreaterThanOrEqual(1);
        const servida = await prisma.kitchenOrder.findUniqueOrThrow({
          where: { id: orderId },
          select: { servedAt: true },
        });
        expect(servida.servedAt).not.toBeNull();
      });
    });
  },
);
