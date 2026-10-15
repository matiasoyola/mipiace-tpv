// kds-2b · LO QUE SÓLO POSTGRES PUEDE DECIR DE LA PASADA DEL 15-10.
//
// Dos de los cuatro hallazgos no se pueden probar con un Prisma falso,
// porque lo que falla es el MOTOR y no la ruta:
//
//   | Tachar mueve el plato al final de la tarjeta | el hallazgo 2. Sin
//   | `orderBy`, Postgres devuelve las filas en el orden físico de la tabla
//   | y un `UPDATE` reescribe la fila al final. Un falso que devuelva el
//   | orden de inserción NUNCA reproduce esto: hace falta la tabla de
//   | verdad, con su `UPDATE` de verdad.
//   | El `−` sobre lo enviado no recalcula el total | el hallazgo 3. El
//   | recálculo va DENTRO de la transacción que baja `units`, y lo que hay
//   | que comprobar es lo que queda escrito en `tickets.total` — la columna
//   | que pinta la tarjeta de la mesa en la sala.
//
// Y de paso, contra el esquema de verdad: los alérgenos del plato que ahora
// viajan en el estado de cocina de la mesa, y el `clientSendId` de la vista.

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
  "e2e · kds-2b · el hierro del 15-10, contra Postgres",
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
    /** Bravas (GLUTEN), magro (sin informar) y calamares (GLUTEN). */
    let bravasId = "";
    let magroId = "";
    let calamaresId = "";

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

    /** La M5 de la pasada: tres platos, todos a la silla 3. */
    async function abrirLaM5(): Promise<string> {
      const ticket = await prisma.ticket.create({
        data: {
          tenantId,
          registerId,
          shiftId,
          userId: cashierId,
          internalNumber: `K2B-${randomUUID().slice(0, 8)}`,
          externalId: randomUUID(),
          publicSlug: randomUUID().replace(/-/g, "").slice(0, 16),
          status: "DRAFT",
          tableId: mesaId,
          diners: 4,
          total: 30,
          totalTax: 0,
          totalDiscount: 0,
          lines: {
            create: [
              {
                productId: bravasId,
                sku: "RAC-004",
                nameSnapshot: "Patatas bravas",
                units: 1,
                unitPrice: 10,
                taxRate: 0,
                subtotal: 10,
                total: 10,
                seat: 3,
              },
              {
                productId: magroId,
                sku: "RAC-005",
                nameSnapshot: "Magro",
                units: 1,
                unitPrice: 10,
                taxRate: 0,
                subtotal: 10,
                total: 10,
                seat: 3,
              },
              {
                productId: calamaresId,
                sku: "RAC-006",
                nameSnapshot: "Calamares",
                units: 1,
                unitPrice: 10,
                taxRate: 0,
                subtotal: 10,
                total: 10,
                seat: 3,
              },
            ],
          },
          allergies: { create: [{ seat: 3, allergen: "GLUTEN" }] },
        },
        select: { id: true },
      });
      return ticket.id;
    }

    async function mandarACocina(ticketId: string): Promise<string> {
      const res = await app.inject({
        method: "POST",
        url: `/tickets/${ticketId}/send-to-kitchen/escpos`,
        headers: { authorization: `Bearer ${sesionCajero()}` },
        payload: { clientSendId: randomUUID() },
      });
      expect(res.statusCode).toBe(200);
      return res.json().sections[0].orderId as string;
    }

    /**
     * La tarjeta de ESTA mesa, no la primera de la pantalla.
     *
     * Cada test abre su propia M5, así que la pantalla acumula tarjetas:
     * mirar `orders[0]` hacía que un test leyera la comanda de otro. Lo
     * descubrió el `−` sobre el magro, que salía sin anular porque el que
     * se miraba era el de la mesa anterior.
     */
    async function tarjetaDe(ticketId: string) {
      const v = await vistaDeCocina();
      const nuestra = (v.orders as Array<Record<string, unknown>>).find(
        (o) => o.ticketId === ticketId,
      );
      expect(nuestra).toBeDefined();
      return nuestra as {
        clientSendId: string;
        lines: Array<Record<string, unknown>>;
      };
    }

    async function vistaDeCocina() {
      const res = await app.inject({
        method: "GET",
        url: "/kitchen/comandas",
        headers: { "x-device-token": pantallaToken },
      });
      expect(res.statusCode).toBe(200);
      return res.json();
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
          name: "BAR KDS2B SL",
          businessType: "HOSPITALITY",
          holdedEnabled: false,
          kitchenDisplayEnabled: true,
          fiscalProfile: { legalName: "BAR KDS2B SL", taxId: "B45902186" },
        },
        select: { id: true },
      });
      tenantId = tenant.id;
      const store = await prisma.store.create({
        data: { tenantId, name: "Local kds-2b" },
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
          email: `kds2b-${randomUUID().slice(0, 8)}@bar.es`,
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
          kitchenSections: ["COCINA"],
          name: "Pase",
        },
      });

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

      const platos = await Promise.all(
        [
          { name: "Patatas bravas", sku: "RAC-004", allergens: ["GLUTEN"] },
          // El magro: `allergens: []` es **no informado**, y es el plato
          // del hallazgo 4.
          { name: "Magro", sku: "RAC-005", allergens: [] },
          { name: "Calamares", sku: "RAC-006", allergens: ["GLUTEN"] },
        ].map((p2) =>
          prisma.product.create({
            data: {
              tenantId,
              name: p2.name,
              sku: p2.sku,
              basePrice: 10,
              taxRate: 0,
              tags: ["raciones"],
              source: "LOCAL",
              allergens: p2.allergens as never,
            },
            select: { id: true },
          }),
        ),
      );
      bravasId = platos[0]!.id;
      magroId = platos[1]!.id;
      calamaresId = platos[2]!.id;
      await prisma.tagSection.create({
        data: { tenantId, slug: "raciones", section: "COCINA" },
      });
    });

    afterAll(async () => {
      // Misma razón que en kds-2: el barrido de mesas abandonadas mira los
      // DRAFT de TODOS los tenants y `ciclo-de-caja.e2e.ts` afirma un
      // número exacto. Lo que deja este fichero, se lo lleva este fichero.
      await prisma.ticket.deleteMany({ where: { tenantId, status: "DRAFT" } });
      await app?.close();
      await shutdown();
    });

    // ──────────────────────────────────────────────────────────────────
    // 1 · TACHAR NO MUEVE EL PLATO
    // ──────────────────────────────────────────────────────────────────

    describe("SABOTAJE · tachar mueve el plato al final de la tarjeta", () => {
      it("el orden de las líneas es el MISMO antes y después de tachar", async () => {
        const ticketId = await abrirLaM5();
        await mandarACocina(ticketId);

        const antes = (await tarjetaDe(ticketId)).lines as unknown as Array<{
          id: string;
          name: string;
        }>;
        expect(antes).toHaveLength(3);

        // Se tacha la primera. En Postgres, el `UPDATE` del `done_at`
        // reescribe esa fila y la deja al final del orden físico: sin
        // `orderBy` en el `select`, el siguiente `GET` la devolvía última.
        const tachar = await app.inject({
          method: "POST",
          url: `/kitchen/lineas/${antes[0]!.id}/hecho`,
          headers: { "x-device-token": pantallaToken },
          payload: { done: true },
        });
        expect(tachar.statusCode).toBe(200);

        const despues = (await tarjetaDe(ticketId)).lines as unknown as Array<{
          id: string;
          done: boolean;
        }>;
        expect(despues.map((l) => l.id)).toEqual(antes.map((l) => l.id));
        expect(despues[0]!.done).toBe(true);
      });

      it("y sigue siendo el mismo después de tachar, destachar y tachar", async () => {
        // Tres `UPDATE` sobre la misma fila, y **éste es el que reproduce
        // la pasada**: quitando el `orderBy` de la vista, el test de
        // arriba se queda en verde y éste se pone rojo.
        //
        // La razón está en Postgres: un `UPDATE` suelto sobre una tabla
        // recién escrita suele caber en la misma página (HOT update) y la
        // fila no se mueve. En cuanto hay varios, la fila acaba al final
        // del orden físico. De ahí que en el AP11 el plato «a veces» se
        // fuera abajo y a veces no — y un fallo intermitente en una cocina
        // es peor que uno constante, porque el cocinero no aprende a
        // defenderse de él.
        const ticketId = await abrirLaM5();
        await mandarACocina(ticketId);
        const antes = (await tarjetaDe(ticketId)).lines as unknown as Array<{
          id: string;
        }>;
        const primera = antes[0]!.id;

        for (const done of [true, false, true]) {
          const r = await app.inject({
            method: "POST",
            url: `/kitchen/lineas/${primera}/hecho`,
            headers: { "x-device-token": pantallaToken },
            payload: { done },
          });
          expect(r.statusCode).toBe(200);
        }
        const despues = (await tarjetaDe(ticketId)).lines as unknown as Array<{
          id: string;
        }>;
        expect(despues.map((l) => l.id)).toEqual(antes.map((l) => l.id));
      });
    });

    // ──────────────────────────────────────────────────────────────────
    // 2 · EL «−» SOBRE LO ENVIADO RECALCULA EL TOTAL
    // ──────────────────────────────────────────────────────────────────

    describe("SABOTAJE · el «−» sobre lo enviado no recalcula el total", () => {
      it("baja la línea y deja `tickets.total` al día, en la misma transacción", async () => {
        const ticketId = await abrirLaM5();
        await mandarACocina(ticketId);
        const linea = await prisma.ticketLine.findFirstOrThrow({
          where: { ticketId, nameSnapshot: "Patatas bravas" },
          select: { id: true },
        });

        const res = await app.inject({
          method: "POST",
          url: `/tickets/${ticketId}/kitchen/void-units`,
          headers: { authorization: `Bearer ${sesionCajero()}` },
          payload: { lineId: linea.id, units: 1 },
        });
        expect(res.statusCode).toBe(200);

        const ticket = await prisma.ticket.findUniqueOrThrow({
          where: { id: ticketId },
          select: {
            total: true,
            lines: {
              where: { id: linea.id },
              select: { units: true, sentUnits: true, total: true },
            },
          },
        });
        // La línea anulada: cero unidades y cero euros.
        expect(Number(ticket.lines[0]!.units)).toBe(0);
        expect(Number(ticket.lines[0]!.sentUnits)).toBe(0);
        expect(Number(ticket.lines[0]!.total)).toBe(0);
        // Y el total de la mesa, que es lo que pinta la sala: 30 → 20.
        expect(Number(ticket.total)).toBe(20);
      });

      it("la tarjeta de cocina sigue diciendo lo que se pidió: «ERAN 1 · −1»", async () => {
        // El total baja, pero la cocina no puede perder de vista que ese
        // plato se pidió y se anuló (decisión 6 de kds-1).
        const ticketId = await abrirLaM5();
        await mandarACocina(ticketId);
        const linea = await prisma.ticketLine.findFirstOrThrow({
          where: { ticketId, nameSnapshot: "Magro" },
          select: { id: true },
        });
        await app.inject({
          method: "POST",
          url: `/tickets/${ticketId}/kitchen/void-units`,
          headers: { authorization: `Bearer ${sesionCajero()}` },
          payload: { lineId: linea.id, units: 1 },
        });
        const magro = (await tarjetaDe(ticketId)).lines.find(
          (l) => l.name === "Magro",
        )!;
        expect(magro.units).toBe(0);
        expect(magro.unitsOriginal).toBe(1);
        expect(magro.voidPending).toBe(true);
      });
    });

    // ──────────────────────────────────────────────────────────────────
    // 3 · LOS ALÉRGENOS, CONTRA EL ESQUEMA DE VERDAD
    // ──────────────────────────────────────────────────────────────────

    describe("los alérgenos y el envío, en la vista y en el estado de la mesa", () => {
      it("el magro sale «ALÉRGENOS SIN INFORMAR» y las bravas gritan", async () => {
        const ticketId = await abrirLaM5();
        await mandarACocina(ticketId);
        const porNombre = new Map(
          (await tarjetaDe(ticketId)).lines.map((l) => [l.name as string, l]),
        );
        expect(porNombre.get("Patatas bravas")!.allergyWarning).toBe(
          "¡LLEVA GLUTEN!",
        );
        expect(porNombre.get("Patatas bravas")!.allergensUnknown).toBeNull();
        expect(porNombre.get("Magro")!.allergensUnknown).toBe(
          "ALÉRGENOS SIN INFORMAR",
        );
      });

      it("la vista dice de qué envío es cada tarjeta", async () => {
        const ticketId = await abrirLaM5();
        const res = await app.inject({
          method: "POST",
          url: `/tickets/${ticketId}/send-to-kitchen/escpos`,
          headers: { authorization: `Bearer ${sesionCajero()}` },
          payload: { clientSendId: "4b1f0c3a-0000-4000-8000-00000000beef" },
        });
        expect(res.statusCode).toBe(200);
        expect((await tarjetaDe(ticketId)).clientSendId).toBe(
          "4b1f0c3a-0000-4000-8000-00000000beef",
        );
      });

      it("y el estado de cocina de la mesa trae los alérgenos de cada plato", async () => {
        // Es lo que quita de en medio el catálogo cacheado del terminal:
        // la comanda del camino directo ya no depende de él.
        const ticketId = await abrirLaM5();
        const res = await app.inject({
          method: "GET",
          url: `/tickets/${ticketId}/kitchen`,
          headers: { authorization: `Bearer ${sesionCajero()}` },
        });
        expect(res.statusCode).toBe(200);
        const porId = new Map(
          (res.json().lines as Array<Record<string, unknown>>).map((l) => [
            l.id as string,
            l,
          ]),
        );
        const lineas = await prisma.ticketLine.findMany({
          where: { ticketId },
          select: { id: true, nameSnapshot: true },
        });
        for (const l of lineas) {
          const esperado =
            l.nameSnapshot === "Magro" ? [] : ["GLUTEN"];
          expect(porId.get(l.id)!.allergens).toEqual(esperado);
        }
      });
    });
  },
);
