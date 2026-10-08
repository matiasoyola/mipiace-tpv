// kds-1-cocina · LO QUE EL TPV LE HACE A LA COCINA.
//
//   POST   /tickets/:ticketId/kitchen/void-units   anular unidades YA ENVIADAS
//   POST   /tickets/:ticketId/kitchen/fire         «Marchar 2º»
//   POST   /tickets/:ticketId/kitchen/urgent       marcar / desmarcar urgente
//   POST   /kitchen/comandas/:orderId/servido      un toque en la banda
//   GET    /tickets/:ticketId/kitchen              el estado de cocina de la mesa
//   PUT    /tickets/:ticketId/lines/:lineId/kitchen  tiempo y silla de una línea
//   GET    /tickets/:ticketId/allergies            las alergias de la mesa
//   PUT    /tickets/:ticketId/allergies            la hoja de alergias, entera
//   GET    /kitchen/listas                         lo LISTO de la tienda (banda + etiqueta)
//   GET    /kitchen/estado                         ¿hay pantalla? ¿está viva?
//   GET    /kitchen/comandas/:orderId/escpos       los bytes del papel de respaldo
//
// Todas van por la puerta del TPV (`requireCashierSession`): las firma un
// camarero, no una pantalla. Las dos puertas no se cruzan — ver
// `kitchen/auth.ts`.

import type { FastifyInstance } from "fastify";

import { Prisma, type KitchenSection } from "@mipiacetpv/db";
import { buildKitchenComanda } from "@mipiacetpv/escpos-builder";
import {
  avisoChoque,
  choqueAlergenos,
  franjaAlergia,
  LISTA_ALERGENOS,
  type Alergeno,
} from "@mipiacetpv/ticket-model";

import { getPrisma } from "../context.js";
import { ensureCajaEnabled } from "../lib/caja-gate.js";
import { requireCashierSession } from "../shift/cashier-session.js";
import { cashierLabelFrom } from "../users/display.js";
import {
  construirDestinos,
  destinoDe,
  resolverSeccion,
  SECCIONES,
} from "./destinos.js";
import { notasDeModificadores } from "./envio.js";
import {
  emitirComandaServida,
  emitirPlatoAnulado,
  emitirTiempoMarchado,
  emitirUrgente,
} from "./eventos.js";

/**
 * Cuánto puede llevar una pantalla sin dar señales antes de darla por
 * muerta (decisión 9).
 *
 * 90 s y no 30: la pantalla pide el GET cada 20 s y además manda latido,
 * así que tres ventanas perdidas son una caída de verdad y no un bache de
 * wifi. Equivocarse por abajo saca papel que nadie pidió en cada hipo de
 * la red; equivocarse por arriba deja una comanda sin papel durante minuto
 * y medio. Entre las dos, la segunda la cubre la propia pantalla cuando
 * vuelve («llegó tarde»); la primera gasta papel y confianza en cada
 * servicio.
 */
export const LATIDO_VIVO_MS = 90_000;

export async function registerKitchenTpvRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ── Decisión 6 · «−» sobre una línea ENVIADA ────────────────────────
  //
  // Lo llama el TPV **pasados los 5 s del «Deshacer»**, no al tocar el
  // `−`: el camarero ve «Bravas −1 · Deshacer» y, si lo deshace a tiempo,
  // esta ruta no se llama nunca y la cocina no ve ningún parpadeo. El
  // temporizador vive en el TPV a propósito — un «deshacer» que necesite
  // red no es un deshacer.
  //
  // Hace tres cosas y las tres son la misma operación:
  //   1. baja `units` y `sentUnits` de la línea de la venta (el cliente no
  //      paga lo que se anuló);
  //   2. sube `voidedUnits` de las copias que la cocina tiene, de la más
  //      reciente a la más antigua;
  //   3. apunta quién, cuándo y **si la cocina ya lo había tachado**
  //      (merma: comida hecha y tirada).
  //
  // Sin PIN y sin confirmación: el registro ES la protección (decisión 6).
  app.post(
    "/tickets/:ticketId/kitchen/void-units",
    {
      preHandler: [requireCashierSession, ensureCajaEnabled],
      schema: {
        params: {
          type: "object",
          required: ["ticketId"],
          properties: { ticketId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["lineId", "units"],
          additionalProperties: false,
          properties: {
            lineId: { type: "string", format: "uuid" },
            units: { type: "number", exclusiveMinimum: 0 },
          },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { ticketId } = request.params as { ticketId: string };
      const { lineId, units } = request.body as { lineId: string; units: number };
      const prisma = getPrisma();

      const line = await prisma.ticketLine.findFirst({
        where: {
          id: lineId,
          ticketId,
          ticket: { tenantId: cashier.tid, status: "DRAFT" },
        },
        select: {
          id: true,
          units: true,
          sentUnits: true,
          nameSnapshot: true,
          ticket: {
            select: { id: true, tableId: true, register: { select: { storeId: true } } },
          },
        },
      });
      if (!line) {
        return reply.code(404).send({
          error: "LINE_NOT_FOUND",
          message: "La línea no existe en esta comanda, o la mesa ya no está abierta.",
        });
      }
      const enviadas = Number(line.sentUnits);
      if (units > enviadas) {
        // Lo que no está en cocina se quita con el `−` normal, que baja
        // unidades sin pasar por aquí. Esta ruta anula lo YA ENVIADO.
        return reply.code(409).send({
          error: "NOT_SENT_TO_KITCHEN",
          message: `Sólo ${enviadas} unidades están en cocina.`,
        });
      }

      const now = new Date();
      const storeId = line.ticket.register.storeId;
      // De la más RECIENTE a la más antigua: lo que se anula es lo último
      // que se pidió. Anular contra la 1ª comanda cuando hay una 2ª dejaría
      // el «ERAN 3 · −1» en la tarjeta vieja —que el cocinero ya despachó—
      // en vez de en la que tiene delante.
      const copias = await prisma.kitchenOrderLine.findMany({
        where: { ticketLineId: lineId, order: { servedAt: null } },
        orderBy: { order: { sentAt: "desc" } },
        select: {
          id: true,
          units: true,
          voidedUnits: true,
          doneAt: true,
          orderId: true,
        },
      });

      let porRepartir = units;
      const tocadas: Array<{
        id: string;
        orderId: string;
        voidedUnits: number;
        doneBeforeVoid: boolean;
      }> = [];
      for (const c of copias) {
        if (porRepartir <= 0) break;
        const libre = Number(c.units) - Number(c.voidedUnits);
        if (libre <= 0) continue;
        const quita = Math.min(libre, porRepartir);
        porRepartir = Math.round((porRepartir - quita) * 1000) / 1000;
        tocadas.push({
          id: c.id,
          orderId: c.orderId,
          voidedUnits: Math.round((Number(c.voidedUnits) + quita) * 1000) / 1000,
          // MERMA. Se calcula AHORA y se guarda: `doneAt` puede cambiar
          // después (el cocinero destacha) y entonces el informe mentiría.
          doneBeforeVoid: c.doneAt != null,
        });
      }

      await prisma.$transaction(async (tx) => {
        await tx.ticketLine.update({
          where: { id: lineId },
          data: {
            units: new Prisma.Decimal(
              Math.round((Number(line.units) - units) * 1000) / 1000,
            ),
            sentUnits: new Prisma.Decimal(
              Math.round((enviadas - units) * 1000) / 1000,
            ),
          },
        });
        for (const t of tocadas) {
          await tx.kitchenOrderLine.update({
            where: { id: t.id },
            data: {
              voidedUnits: new Prisma.Decimal(t.voidedUnits),
              voidedAt: now,
              voidedByUserId: cashier.sub,
              voidSeenAt: null,
              doneBeforeVoid: t.doneBeforeVoid,
            },
          });
        }
      });

      if (tocadas.length > 0) {
        emitirPlatoAnulado({
          storeId,
          ticketId: line.ticket.id,
          ticketLineId: lineId,
          orderIds: [...new Set(tocadas.map((t) => t.orderId))],
          at: now,
        });
      }

      return {
        ok: true,
        lineId,
        voidedUnits: units,
        remainingUnits: Math.round((Number(line.units) - units) * 1000) / 1000,
        // `true` si la cocina ya lo había tachado: el TPV lo enseña como
        // «ya estaba hecho» para que el camarero lo sepa en el momento.
        wasAlreadyDone: tocadas.some((t) => t.doneBeforeVoid),
        // 0 si todo se pudo descontar de tarjetas vivas. Distinto de 0
        // significa que la comanda que lo llevaba ya se sirvió: la venta
        // baja igual, pero no hay a quién avisar.
        notInKitchen: porRepartir,
      };
    },
  );

  // ── Decisión 3 · «Marchar 2º» ───────────────────────────────────────
  //
  // Marchar un tiempo hace dos cosas: deja la fila en `ticket_courses`
  // —para que lo que se añada DESPUÉS a ese tiempo salga ya marchado— y
  // pone el `firedAt` de las líneas de ese tiempo que ya están en
  // pantalla. El semáforo de ese bloque empieza a contar AHORA, no desde
  // que se tomó la nota.
  app.post(
    "/tickets/:ticketId/kitchen/fire",
    {
      preHandler: [requireCashierSession, ensureCajaEnabled],
      schema: {
        params: {
          type: "object",
          required: ["ticketId"],
          properties: { ticketId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["course"],
          additionalProperties: false,
          properties: { course: { type: "integer", minimum: 1, maximum: 20 } },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { ticketId } = request.params as { ticketId: string };
      const { course } = request.body as { course: number };
      const prisma = getPrisma();
      const ticket = await prisma.ticket.findFirst({
        where: { id: ticketId, tenantId: cashier.tid, status: "DRAFT" },
        select: { id: true, register: { select: { storeId: true } } },
      });
      if (!ticket) return reply.code(404).send({ error: "TICKET_NOT_FOUND" });

      const now = new Date();
      const creadas = await prisma.ticketCourse.createMany({
        data: [
          { ticketId, course, firedAt: now, firedByUserId: cashier.sub },
        ],
        skipDuplicates: true,
      });
      if (creadas.count === 0) {
        // Ya estaba marchado. No se mueve el reloj: adelantar el `firedAt`
        // de un tiempo ya marchado pondría su semáforo a cero y borraría
        // los minutos que la cocina ya lleva esperando.
        return { ok: true, alreadyFired: true, course };
      }
      const res = await prisma.kitchenOrderLine.updateMany({
        where: {
          course,
          firedAt: null,
          order: { ticketId, servedAt: null },
        },
        data: { firedAt: now },
      });
      emitirTiempoMarchado({
        storeId: ticket.register.storeId,
        ticketId,
        course,
        at: now,
      });
      return { ok: true, alreadyFired: false, course, linesFired: res.count };
    },
  );

  // Marcar o desmarcar urgente desde el TPV, sobre las comandas vivas de
  // una mesa. El botón está junto a «Enviar», así que lo normal es que el
  // urgente viaje EN el envío; esto es para cuando el camarero se acuerda
  // después.
  app.post(
    "/tickets/:ticketId/kitchen/urgent",
    {
      preHandler: [requireCashierSession, ensureCajaEnabled],
      schema: {
        params: {
          type: "object",
          required: ["ticketId"],
          properties: { ticketId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["urgent"],
          additionalProperties: false,
          properties: { urgent: { type: "boolean" } },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { ticketId } = request.params as { ticketId: string };
      const { urgent } = request.body as { urgent: boolean };
      const prisma = getPrisma();
      const ticket = await prisma.ticket.findFirst({
        where: { id: ticketId, tenantId: cashier.tid, status: "DRAFT" },
        select: { id: true, register: { select: { storeId: true } } },
      });
      if (!ticket) return reply.code(404).send({ error: "TICKET_NOT_FOUND" });
      const now = new Date();
      const vivas = await prisma.kitchenOrder.findMany({
        where: { ticketId, servedAt: null },
        select: { id: true },
      });
      await prisma.kitchenOrder.updateMany({
        where: { ticketId, servedAt: null },
        data: urgent
          ? { urgent: true, urgentAt: now }
          : { urgent: false, urgentAt: null, urgentByDeviceId: null },
      });
      for (const o of vivas) {
        emitirUrgente({
          storeId: ticket.register.storeId,
          orderId: o.id,
          urgent,
          at: now,
        });
      }
      return { ok: true, urgent, orders: vivas.length };
    },
  );

  // ── Decisión 5 · «Servido» ──────────────────────────────────────────
  //
  // Un toque en la banda o en la etiqueta verde. El aviso desaparece en
  // TODOS los TPV de la tienda (de eso se encarga el evento) y queda la
  // marca de tiempo para el tiempo en el pase.
  app.post(
    "/kitchen/comandas/:orderId/servido",
    {
      preHandler: [requireCashierSession, ensureCajaEnabled],
      schema: {
        params: {
          type: "object",
          required: ["orderId"],
          properties: { orderId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { orderId } = request.params as { orderId: string };
      const prisma = getPrisma();
      const order = await prisma.kitchenOrder.findFirst({
        where: { id: orderId, ticket: { tenantId: cashier.tid } },
        select: {
          id: true,
          readyAt: true,
          servedAt: true,
          ticketId: true,
          tableId: true,
          storeId: true,
        },
      });
      if (!order) return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
      if (order.servedAt) return { ok: true, alreadyServed: true };
      if (!order.readyAt) {
        // El CHECK `kitchen_orders_cronologia` lo prohíbe en la base; aquí
        // se responde con un mensaje en vez de con un 500.
        return reply.code(409).send({
          error: "ORDER_NOT_READY",
          message: "Esta comanda todavía no está lista.",
        });
      }
      const now = new Date();
      await prisma.kitchenOrder.update({
        where: { id: orderId },
        data: { servedAt: now, servedByUserId: cashier.sub },
      });
      emitirComandaServida({
        storeId: order.storeId,
        orderId,
        ticketId: order.ticketId,
        tableId: order.tableId,
        at: now,
      });
      return { ok: true, alreadyServed: false };
    },
  );

  // El estado de cocina de UNA mesa: lo que el TPV necesita para pintar la
  // comanda (qué está en cocina, qué tiempos están retenidos, qué comandas
  // están listas) y la regla por destino de cada sección.
  app.get(
    "/tickets/:ticketId/kitchen",
    {
      preHandler: [requireCashierSession, ensureCajaEnabled],
      schema: {
        params: {
          type: "object",
          required: ["ticketId"],
          properties: { ticketId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { ticketId } = request.params as { ticketId: string };
      const prisma = getPrisma();
      const ticket = await prisma.ticket.findFirst({
        where: { id: ticketId, tenantId: cashier.tid },
        select: {
          id: true,
          diners: true,
          lastSentRevision: true,
          register: { select: { storeId: true } },
          lines: {
            select: {
              id: true,
              productId: true,
              units: true,
              sentUnits: true,
              course: true,
              seat: true,
            },
          },
          courses: { select: { course: true, firedAt: true } },
          allergies: { select: { seat: true, allergen: true } },
          kitchenOrders: {
            where: { servedAt: null },
            select: {
              id: true,
              section: true,
              number: true,
              urgent: true,
              readyAt: true,
              tableName: true,
            },
          },
        },
      });
      if (!ticket) return reply.code(404).send({ error: "TICKET_NOT_FOUND" });
      const destinos = await resolverDestinos({
        tenantId: cashier.tid,
        registerId: cashier.rid,
        storeId: ticket.register.storeId,
      });
      // El mapa `etiqueta → sección`, para resolver la sección de cada
      // línea con la MISMA función que usa el envío.
      const productIds = ticket.lines
        .map((l) => l.productId)
        .filter((x): x is string => x != null);
      const [productos, etiquetas] = await Promise.all([
        productIds.length > 0
          ? prisma.product.findMany({
              where: { id: { in: productIds }, tenantId: cashier.tid },
              select: { id: true, tags: true },
            })
          : Promise.resolve([] as Array<{ id: string; tags: string[] }>),
        prisma.tagSection.findMany({
          where: { tenantId: cashier.tid },
          select: { slug: true, section: true },
        }),
      ]);
      const etiquetasPorProducto = new Map<string, string[]>(
        productos.map((p) => [p.id, p.tags]),
      );
      const seccionPorEtiqueta = new Map<string, KitchenSection>(
        etiquetas.map((e) => [e.slug, e.section]),
      );
      return {
        diners: ticket.diners,
        revision: ticket.lastSentRevision,
        // kds-1-cocina · LA SECCIÓN VA POR LÍNEA, y la resuelve el
        // servidor.
        //
        // El TPV la necesita para la regla por destino de la decisión 6
        // (el `−`/`+` sobre lo enviado sólo donde hay pantalla), y
        // resolverla en el front obligaría a bajar el mapa
        // `etiqueta → sección` al navegador y a repetir ahí la misma regla
        // de `destinos.ts`. Dos copias de esa regla es como una mesa acaba
        // ofreciendo corregir unidades de algo que está en la plancha.
        lines: ticket.lines.map((l) => ({
          id: l.id,
          units: Number(l.units),
          sentUnits: Number(l.sentUnits),
          course: l.course,
          seat: l.seat,
          section: resolverSeccion(
            l.productId,
            etiquetasPorProducto,
            seccionPorEtiqueta,
          ),
        })),
        firedCourses: ticket.courses.map((c) => ({
          course: c.course,
          firedAt: c.firedAt.toISOString(),
        })),
        allergies: ticket.allergies,
        orders: ticket.kitchenOrders.map((o) => ({
          id: o.id,
          section: o.section,
          number: o.number,
          urgent: o.urgent,
          ready: o.readyAt != null,
          readyAt: o.readyAt ? o.readyAt.toISOString() : null,
          tableName: o.tableName,
        })),
        destinations: destinos,
      };
    },
  );

  // El tiempo y la silla de una línea. Dos cosas en una ruta porque son
  // dos toques de la misma línea en la misma pantalla.
  app.put(
    "/tickets/:ticketId/lines/:lineId/kitchen",
    {
      preHandler: [requireCashierSession, ensureCajaEnabled],
      schema: {
        params: {
          type: "object",
          required: ["ticketId", "lineId"],
          properties: {
            ticketId: { type: "string", format: "uuid" },
            lineId: { type: "string", format: "uuid" },
          },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            course: { type: "integer", minimum: 1, maximum: 20 },
            // `null` = «para la mesa», que es el caso normal.
            seat: { type: ["integer", "null"], minimum: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { ticketId, lineId } = request.params as {
        ticketId: string;
        lineId: string;
      };
      const body = (request.body ?? {}) as { course?: number; seat?: number | null };
      const prisma = getPrisma();
      const ticket = await prisma.ticket.findFirst({
        where: { id: ticketId, tenantId: cashier.tid, status: "DRAFT" },
        select: { id: true, diners: true },
      });
      if (!ticket) return reply.code(404).send({ error: "TICKET_NOT_FOUND" });
      // La silla no puede pasar de los comensales de la mesa. El techo va
      // en la API y no en la base: una mesa puede cambiar de comensales a
      // mitad de servicio y eso no puede invalidar filas ya escritas.
      if (
        body.seat != null &&
        ticket.diners != null &&
        body.seat > ticket.diners
      ) {
        return reply.code(400).send({
          error: "SEAT_OUT_OF_RANGE",
          message: `Esta mesa tiene ${ticket.diners} comensales.`,
        });
      }
      const res = await prisma.ticketLine.updateMany({
        where: { id: lineId, ticketId },
        data: {
          ...(body.course != null ? { course: body.course } : {}),
          ...("seat" in body ? { seat: body.seat ?? null } : {}),
        },
      });
      if (res.count === 0) return reply.code(404).send({ error: "LINE_NOT_FOUND" });
      return { ok: true };
    },
  );

  // ── Decisión 3, capa 1 · la hoja de alergias ────────────────────────
  //
  // Se guarda ENTERA de una vez (PUT y no POST/DELETE por alérgeno): la
  // hoja es un dibujo de la mesa donde el camarero toca sillas e iconos y
  // cierra. Mandar el estado final es lo que hace que cerrar la hoja sin
  // red y volver a abrirla no deje media alergia declarada.
  app.get(
    "/tickets/:ticketId/allergies",
    {
      preHandler: [requireCashierSession, ensureCajaEnabled],
      schema: {
        params: {
          type: "object",
          required: ["ticketId"],
          properties: { ticketId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { ticketId } = request.params as { ticketId: string };
      const prisma = getPrisma();
      const ticket = await prisma.ticket.findFirst({
        where: { id: ticketId, tenantId: cashier.tid },
        select: {
          diners: true,
          allergies: { select: { seat: true, allergen: true } },
        },
      });
      if (!ticket) return reply.code(404).send({ error: "TICKET_NOT_FOUND" });
      return { diners: ticket.diners, allergies: ticket.allergies };
    },
  );

  app.put(
    "/tickets/:ticketId/allergies",
    {
      preHandler: [requireCashierSession, ensureCajaEnabled],
      schema: {
        params: {
          type: "object",
          required: ["ticketId"],
          properties: { ticketId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["allergies"],
          additionalProperties: false,
          properties: {
            allergies: {
              type: "array",
              maxItems: 200,
              items: {
                type: "object",
                required: ["allergen"],
                additionalProperties: false,
                properties: {
                  seat: { type: ["integer", "null"], minimum: 1 },
                  allergen: { type: "string", enum: [...LISTA_ALERGENOS] },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { ticketId } = request.params as { ticketId: string };
      const { allergies } = request.body as {
        allergies: Array<{ seat?: number | null; allergen: string }>;
      };
      const prisma = getPrisma();
      const ticket = await prisma.ticket.findFirst({
        where: { id: ticketId, tenantId: cashier.tid, status: "DRAFT" },
        select: { id: true, diners: true },
      });
      if (!ticket) return reply.code(404).send({ error: "TICKET_NOT_FOUND" });
      for (const a of allergies) {
        if (a.seat != null && ticket.diners != null && a.seat > ticket.diners) {
          return reply.code(400).send({
            error: "SEAT_OUT_OF_RANGE",
            message: `Esta mesa tiene ${ticket.diners} comensales.`,
          });
        }
      }
      // Se borra y se reescribe, en una transacción. Diferencial sería más
      // listo y no haría falta: la hoja tiene como mucho catorce alérgenos
      // por silla y un puñado de sillas, y lo que importa es que lo que
      // quede sea exactamente lo que el camarero dejó en la pantalla.
      const unicas = new Map<string, { seat: number | null; allergen: string }>();
      for (const a of allergies) {
        const seat = a.seat ?? null;
        unicas.set(`${seat ?? "M"}|${a.allergen}`, { seat, allergen: a.allergen });
      }
      await prisma.$transaction([
        prisma.ticketAllergy.deleteMany({ where: { ticketId } }),
        prisma.ticketAllergy.createMany({
          data: [...unicas.values()].map((a) => ({
            ticketId,
            seat: a.seat,
            allergen: a.allergen as never,
            createdByUserId: cashier.sub,
          })),
        }),
      ]);
      return { ok: true, count: unicas.size };
    },
  );

  // ── Decisión 5 · LO QUE ESTÁ LISTO, DE TODA LA TIENDA ───────────────
  //
  //   GET /kitchen/listas
  //
  // De la TIENDA y no de una mesa, y eso es la decisión 5: la banda «M4 ·
  // listo para servir» sale en **todos los TPV del local**, para que se
  // entere cualquier camarero y también el de la terraza. Un endpoint por
  // mesa sólo avisaría al camarero que ya está mirando esa mesa, que es
  // precisamente el que no necesita el aviso.
  //
  // De aquí salen las dos señales de la decisión 5: la banda de arriba y
  // la etiqueta «LISTO» verde de la mesa en la sala.
  app.get(
    "/kitchen/listas",
    { preHandler: [requireCashierSession, ensureCajaEnabled] },
    async (request) => {
      const cashier = request.cashier!;
      const prisma = getPrisma();
      const [tenant, register] = await Promise.all([
        prisma.tenant.findUniqueOrThrow({
          where: { id: cashier.tid },
          select: { kitchenDisplayEnabled: true },
        }),
        prisma.register.findUniqueOrThrow({
          where: { id: cashier.rid },
          select: { storeId: true },
        }),
      ]);
      // Con el módulo apagado, lista vacía y no 403: la banda es una
      // función que se cobra, pero el TPV pregunta por ella en cada
      // arranque y un 403 por ciclo ensuciaría los logs del terminal de un
      // bar que nunca compró la pantalla.
      if (!tenant.kitchenDisplayEnabled) {
        return { ready: [] };
      }
      const listas = await prisma.kitchenOrder.findMany({
        where: {
          storeId: register.storeId,
          readyAt: { not: null },
          servedAt: null,
        },
        // De más ANTIGUA a más nueva (decisión 5): el camarero coge lo que
        // lleva más tiempo en el pase, así que lo primero que lee tiene que
        // ser eso.
        orderBy: { readyAt: "asc" },
        select: {
          id: true,
          ticketId: true,
          tableId: true,
          tableName: true,
          section: true,
          number: true,
          readyAt: true,
        },
      });
      return {
        ready: listas.map((o) => ({
          orderId: o.id,
          ticketId: o.ticketId,
          tableId: o.tableId,
          tableName: o.tableName,
          section: o.section,
          number: o.number,
          readyAt: o.readyAt!.toISOString(),
        })),
      };
    },
  );

  // ── Decisión 9 · EL PAPEL DE RESPALDO ───────────────────────────────
  //
  //   GET /kitchen/comandas/:orderId/escpos
  //
  // Los bytes ESC/POS de una comanda que YA existe, para que el TPV la
  // saque por la impresora USB del propio terminal cuando la pantalla de
  // esa sección no da señales.
  //
  // ── Por qué los construye el SERVIDOR ─────────────────────────────
  //
  // Porque el papel de respaldo tiene que ser EL MISMO papel. Si el TPV
  // compusiera la comanda por su cuenta con los datos que tiene a mano, el
  // papel que sale cuando la wifi se cae diría cosas ligeramente distintas
  // del que sale cuando la impresora de la sección funciona —otro orden,
  // otra franja de alergia, otra forma de escribir la silla— y la
  // diferencia se descubriría en el único momento en que el papel importa.
  //
  // Un solo constructor (`buildKitchenComanda`), un solo formato.
  app.get(
    "/kitchen/comandas/:orderId/escpos",
    {
      preHandler: [requireCashierSession, ensureCajaEnabled],
      schema: {
        params: {
          type: "object",
          required: ["orderId"],
          properties: { orderId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { orderId } = request.params as { orderId: string };
      const prisma = getPrisma();
      const order = await prisma.kitchenOrder.findFirst({
        where: { id: orderId, ticket: { tenantId: cashier.tid } },
        select: {
          section: true,
          number: true,
          tableName: true,
          sentAt: true,
          urgent: true,
          ticket: {
            select: {
              diners: true,
              notes: true,
              allergies: { select: { seat: true, allergen: true } },
            },
          },
          dispatch: {
            select: { sentBy: { select: { email: true, alias: true } } },
          },
          lines: {
            select: {
              nameSnapshot: true,
              units: true,
              voidedUnits: true,
              modifiers: true,
              course: true,
              seat: true,
              allergens: true,
            },
          },
        },
      });
      if (!order) return reply.code(404).send({ error: "ORDER_NOT_FOUND" });

      const porSilla = new Map<number | null, Alergeno[]>();
      for (const a of order.ticket.allergies) {
        const k = a.seat ?? null;
        porSilla.set(k, [...(porSilla.get(k) ?? []), a.allergen as Alergeno]);
      }
      const deLaMesa = porSilla.get(null) ?? [];
      const franjas: string[] = [];
      if (deLaMesa.length > 0) franjas.push(franjaAlergia(null, deLaMesa));
      for (const seat of [...porSilla.keys()]
        .filter((k): k is number => k != null)
        .sort((a, b) => a - b)) {
        franjas.push(franjaAlergia(seat, porSilla.get(seat)!));
      }
      const deSilla = (seat: number | null): Alergeno[] =>
        seat == null
          ? deLaMesa
          : [...new Set([...(porSilla.get(seat) ?? []), ...deLaMesa])];

      const bytes = buildKitchenComanda({
        section: order.section,
        tableName: order.tableName,
        revision: order.number,
        issuedAt: order.sentAt,
        cashierLabel: cashierLabelFrom(order.dispatch.sentBy),
        diners: order.ticket.diners,
        ticketNotes: order.ticket.notes,
        urgent: order.urgent,
        allergyBands: franjas,
        lines: order.lines
          // Lo anulado no se imprime: este papel sale DESPUÉS, cuando la
          // pantalla ya no recibió, así que lo que tiene que decir es lo
          // que hay que cocinar ahora. El «ERAN 3 · −1» es de la pantalla,
          // que es la que puede tachar en vivo.
          .filter((l) => Number(l.units) > Number(l.voidedUnits))
          .map((l) => ({
            units: Number(l.units) - Number(l.voidedUnits),
            description: l.nameSnapshot,
            notes: notasDeModificadores(l.modifiers),
            seat: l.seat,
            course: l.course,
            allergyWarning:
              l.seat != null
                ? avisoChoque(
                    choqueAlergenos(l.allergens as Alergeno[], deSilla(l.seat)),
                  )
                : null,
          })),
      });
      return {
        section: order.section,
        number: order.number,
        escposBase64: Buffer.from(bytes).toString("base64"),
      };
    },
  );

  // ── Decisión 9 · ¿hay pantalla, y está viva? ────────────────────────
  //
  // Lo pregunta el TPV ANTES de enviar. Si la sección tiene pantalla y la
  // pantalla no está viva, «Enviar» avisa «Cocina no recibe» y saca la
  // comanda en papel por la impresora USB del propio terminal.
  app.get(
    "/kitchen/estado",
    { preHandler: [requireCashierSession, ensureCajaEnabled] },
    async (request) => {
      const cashier = request.cashier!;
      const prisma = getPrisma();
      const register = await prisma.register.findUniqueOrThrow({
        where: { id: cashier.rid },
        select: { storeId: true },
      });
      const now = Date.now();
      const pantallas = await prisma.device.findMany({
        where: {
          tenantId: cashier.tid,
          kind: "KITCHEN",
          revokedAt: null,
          register: { storeId: register.storeId },
        },
        select: {
          id: true,
          name: true,
          kitchenSections: true,
          lastSeenAt: true,
        },
      });
      const destinos = await resolverDestinos({
        tenantId: cashier.tid,
        registerId: cashier.rid,
        storeId: register.storeId,
      });
      const vivasPorSeccion = new Map<KitchenSection, boolean>();
      for (const p of pantallas) {
        const viva =
          p.lastSeenAt != null && now - p.lastSeenAt.getTime() < LATIDO_VIVO_MS;
        for (const sec of p.kitchenSections) {
          vivasPorSeccion.set(sec, (vivasPorSeccion.get(sec) ?? false) || viva);
        }
      }
      return {
        heartbeatWindowMs: LATIDO_VIVO_MS,
        screens: pantallas.map((p) => ({
          id: p.id,
          name: p.name,
          sections: p.kitchenSections,
          alive:
            p.lastSeenAt != null &&
            now - p.lastSeenAt.getTime() < LATIDO_VIVO_MS,
          lastSeenAt: p.lastSeenAt ? p.lastSeenAt.toISOString() : null,
        })),
        sections: SECCIONES.map((sec) => ({
          section: sec,
          ...destinos[sec],
          // `true` cuando la sección tiene pantalla y NINGUNA de las suyas
          // da señales: es lo que dispara el papel de respaldo.
          needsPaperFallback:
            destinos[sec].screen && !(vivasPorSeccion.get(sec) ?? false),
        })),
      };
    },
  );
}

/**
 * El destino de cada sección, en la forma que el TPV entiende.
 *
 * `canCorrectSent` es la **regla por destino** de la decisión 6: el `−`/`+`
 * sobre lo enviado sólo aparece donde hay pantalla. Sin pantalla se
 * mantiene lo de v2-H1 —«Anular» con el aviso «cocina ya tiene el papel:
 * díselo»— porque el motivo por el que v2-H1 lo quitó sigue en pie.
 */
async function resolverDestinos(opts: {
  tenantId: string;
  registerId: string;
  storeId: string;
}): Promise<
  Record<KitchenSection, { screen: boolean; printer: boolean; canCorrectSent: boolean }>
> {
  const prisma = getPrisma();
  const [tenant, pantallas, impresoras] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({
      where: { id: opts.tenantId },
      select: { kitchenDisplayEnabled: true },
    }),
    prisma.device.findMany({
      where: {
        tenantId: opts.tenantId,
        kind: "KITCHEN",
        revokedAt: null,
        register: { storeId: opts.storeId },
      },
      select: { kitchenSections: true },
    }),
    prisma.printerConfig.findMany({
      where: {
        registerId: opts.registerId,
        active: true,
        mode: "WIFI",
        section: { not: null },
      },
      select: { section: true },
    }),
  ]);
  const destinos = construirDestinos({
    moduloEncendido: tenant.kitchenDisplayEnabled,
    pantallas,
    seccionesConImpresora: impresoras
      .map((p) => p.section)
      .filter((s): s is KitchenSection => s != null),
  });
  const out = {} as Record<
    KitchenSection,
    { screen: boolean; printer: boolean; canCorrectSent: boolean }
  >;
  for (const sec of SECCIONES) {
    const d = destinoDe(destinos, sec);
    out[sec] = {
      screen: d.pantalla,
      printer: d.impresora,
      canCorrectSent: d.pantalla,
    };
  }
  return out;
}
