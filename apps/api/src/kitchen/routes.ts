// kds-1-cocina · LAS RUTAS DE LA PANTALLA.
//
//   GET  /kitchen/me                        quién soy y qué secciones veo
//   GET  /kitchen/comandas                  LA VERDAD (al conectar y al reconectar)
//   GET  /kitchen/comandas/hoy              decisión 7 · «Hoy», para recuperar
//   POST /kitchen/lineas/:lineId/hecho      tachar / destachar (un toque)
//   POST /kitchen/lineas/:lineId/visto      «Visto» de un anulado o un cambio
//   POST /kitchen/comandas/:orderId/lista   el botón grande «Lista»
//   POST /kitchen/comandas/:orderId/urgente toque largo (decisión 3)
//   POST /kitchen/comandas/:orderId/recuperar  devolver una tarjeta
//   POST /kitchen/latido                    la pantalla dice que está viva
//                                           y DÓNDE ESCUCHA en la wifi (kds-2)
//   POST /kitchen/sincronizar               kds-2 · lo que marcó sin internet
//
// Todas con la misma puerta: `requireKitchenDevice`. Lo que hace que una
// pantalla no vea otra tienda ni otra sección NO es un parámetro de la
// petición: es que la tienda y las secciones salen del DISPOSITIVO y la
// petición no las puede nombrar. Un `storeId` en la URL habría sido un
// `if` que se puede olvidar; esto no se puede olvidar porque no existe.
//
// Tiene su fila en la tabla de sabotajes: «Cocina ve otra tienda u otra
// sección».

import type { FastifyInstance } from "fastify";

import {
  EDAD_MAXIMA_MS,
  PUERTO_LAN_POR_DEFECTO,
} from "@mipiacetpv/kitchen-lan";

import { getPrisma } from "../context.js";
import { requireKitchenDevice } from "./auth.js";
import {
  asegurarClaveLan,
  sincronizarDesdeLaTablet,
  type MarcaDeCocina,
} from "./lan.js";
import {
  emitirComandaLista,
  emitirPlatoHecho,
  emitirUrgente,
} from "./eventos.js";
import { construirVista, inicioDelDia } from "./vista.js";

const LINE_ID = {
  type: "object",
  required: ["lineId"],
  properties: { lineId: { type: "string", format: "uuid" } },
} as const;

const ORDER_ID = {
  type: "object",
  required: ["orderId"],
  properties: { orderId: { type: "string", format: "uuid" } },
} as const;

export async function registerKitchenRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/kitchen/me",
    { preHandler: [requireKitchenDevice] },
    async (request) => {
      const k = request.kitchen!;
      const prisma = getPrisma();
      const store = await prisma.store.findUniqueOrThrow({
        where: { id: k.storeId },
        select: {
          id: true,
          name: true,
          kitchenGreenMaxMin: true,
          kitchenAmberMaxMin: true,
          kitchenReadyBeep: true,
        },
      });
      await prisma.device.update({
        where: { id: k.deviceId },
        data: { lastSeenAt: new Date() },
      });
      // kds-2-wifi · LA CLAVE DE LA TIENDA Y SU PUERTO.
      //
      // Va en `/kitchen/me` y no en una ruta aparte porque es lo primero
      // que la pantalla pide al arrancar, y sin la clave no puede abrir el
      // servidor local: una tablet que escuchara sin clave aceptaría
      // cualquier cosa de cualquiera que esté en la wifi del bar.
      //
      // Y va **la hora del servidor**: es con ella con la que la tablet
      // mide si un mensaje es demasiado viejo. El reloj de una tablet que
      // lleva horas sin internet no vale, y rechazar por un reloj
      // desviado dejaría la cocina sin comandas justo el día que importa.
      const ahora = new Date();
      return {
        device: { id: k.deviceId, name: k.deviceName },
        store: { id: store.id, name: store.name },
        sections: k.sections,
        settings: {
          greenMaxMin: store.kitchenGreenMaxMin,
          amberMaxMin: store.kitchenAmberMaxMin,
          readyBeep: store.kitchenReadyBeep,
        },
        serverTime: ahora.toISOString(),
        lan: {
          key: await asegurarClaveLan(k.storeId),
          port: PUERTO_LAN_POR_DEFECTO,
          maxAgeMs: EDAD_MAXIMA_MS,
        },
      };
    },
  );

  app.get(
    "/kitchen/comandas",
    { preHandler: [requireKitchenDevice] },
    async (request) => {
      const k = request.kitchen!;
      // El latido va pegado al GET: la pantalla pide esto cada poco y el
      // TPV necesita saber si está viva para decidir si saca el papel de
      // respaldo (decisión 9). Un latido aparte sería un segundo camino
      // que se puede caer solo.
      await getPrisma().device.update({
        where: { id: k.deviceId },
        data: { lastSeenAt: new Date() },
      });
      return construirVista({ storeId: k.storeId, sections: k.sections });
    },
  );

  app.get(
    "/kitchen/comandas/hoy",
    { preHandler: [requireKitchenDevice] },
    async (request) => {
      const k = request.kitchen!;
      return construirVista({
        storeId: k.storeId,
        sections: k.sections,
        incluirServidasDesde: inicioDelDia(new Date()),
      });
    },
  );

  // Un toque tacha el plato; otro lo destacha (decisión 4 + el dedo gordo).
  //
  // Y si quedan todos tachados, la tarjeta pasa SOLA a «Lista». Se hace
  // aquí dentro y no con un segundo toque del cocinero porque la decisión 4
  // lo dice así: «todos tachados → la tarjeta pasa sola a Lista».
  app.post(
    "/kitchen/lineas/:lineId/hecho",
    {
      preHandler: [requireKitchenDevice],
      schema: {
        params: LINE_ID,
        body: {
          type: "object",
          additionalProperties: false,
          properties: { done: { type: "boolean" } },
        },
      },
    },
    async (request, reply) => {
      const k = request.kitchen!;
      const { lineId } = request.params as { lineId: string };
      const { done } = (request.body ?? {}) as { done?: boolean };
      const prisma = getPrisma();
      const line = await prisma.kitchenOrderLine.findFirst({
        where: {
          id: lineId,
          order: { storeId: k.storeId, section: { in: k.sections } },
        },
        select: {
          id: true,
          doneAt: true,
          firedAt: true,
          order: {
            select: {
              id: true,
              ticketId: true,
              tableId: true,
              tableName: true,
              section: true,
              readyAt: true,
            },
          },
        },
      });
      if (!line) return reply.code(404).send({ error: "LINE_NOT_FOUND" });
      // Un plato EN ESPERA no se puede tachar: no ha marchado, así que no
      // se está cocinando. Tacharlo lo sacaría de la tarjeta antes de que
      // el camarero lo marchara, y entonces nadie lo haría nunca.
      if (line.firedAt == null) {
        return reply.code(409).send({
          error: "LINE_NOT_FIRED",
          message: "Este plato está en espera: todavía no ha marchado.",
        });
      }

      const now = new Date();
      const quiere = done ?? line.doneAt == null;
      await prisma.kitchenOrderLine.update({
        where: { id: lineId },
        data: quiere
          ? { doneAt: now, doneByDeviceId: k.deviceId }
          : { doneAt: null, doneByDeviceId: null },
      });
      emitirPlatoHecho({
        storeId: k.storeId,
        orderId: line.order.id,
        lineId,
        done: quiere,
        at: now,
      });

      // ¿Todos tachados? Las que están EN ESPERA no cuentan —todavía no
      // se cocinan— y las anuladas por completo tampoco: la cocina no
      // tiene que tachar lo que ya no se hace.
      let ready = line.order.readyAt != null;
      if (quiere && !ready) {
        const sinTachar = await prisma.kitchenOrderLine.findMany({
          where: { orderId: line.order.id, doneAt: null, firedAt: { not: null } },
          select: { units: true, voidedUnits: true },
        });
        // Una línea anulada POR COMPLETO no cuenta como pendiente: la
        // cocina no tiene que tachar lo que ya no se hace. La comparación
        // va aquí y no en el `where` porque Prisma no sabe comparar dos
        // columnas entre sí.
        const pendientes = sinTachar.filter(
          (l) => Number(l.units) > Number(l.voidedUnits),
        ).length;
        if (pendientes === 0) {
          ready = true;
          await marcarLista(line.order.id, k.deviceId, now);
          emitirComandaLista({
            storeId: k.storeId,
            orderId: line.order.id,
            ticketId: line.order.ticketId,
            tableId: line.order.tableId,
            tableName: line.order.tableName,
            section: line.order.section,
            at: now,
          });
        }
      }
      return { ok: true, done: quiere, ready };
    },
  );

  // «Visto»: el anulado o el cambio dejan de parpadear y el «ANULADO»
  // puede desaparecer. El plato NO se borra de la tarjeta antes de esto,
  // y eso tiene su propio sabotaje («Anulado que desaparece sin Visto»).
  app.post(
    "/kitchen/lineas/:lineId/visto",
    { preHandler: [requireKitchenDevice], schema: { params: LINE_ID } },
    async (request, reply) => {
      const k = request.kitchen!;
      const { lineId } = request.params as { lineId: string };
      const prisma = getPrisma();
      const now = new Date();
      const res = await prisma.kitchenOrderLine.updateMany({
        where: {
          id: lineId,
          order: { storeId: k.storeId, section: { in: k.sections } },
        },
        data: { voidSeenAt: now, changeSeenAt: now },
      });
      if (res.count === 0) return reply.code(404).send({ error: "LINE_NOT_FOUND" });
      return { ok: true };
    },
  );

  // El botón grande «Lista» (56 px): cierra la tarjeta de golpe sin tachar
  // plato a plato. No tacha los platos: lo que dice es «esta mesa sale».
  app.post(
    "/kitchen/comandas/:orderId/lista",
    { preHandler: [requireKitchenDevice], schema: { params: ORDER_ID } },
    async (request, reply) => {
      const k = request.kitchen!;
      const { orderId } = request.params as { orderId: string };
      const prisma = getPrisma();
      const order = await prisma.kitchenOrder.findFirst({
        where: { id: orderId, storeId: k.storeId, section: { in: k.sections } },
        select: {
          id: true,
          readyAt: true,
          ticketId: true,
          tableId: true,
          tableName: true,
          section: true,
        },
      });
      if (!order) return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
      if (order.readyAt) return { ok: true, alreadyReady: true };
      const now = new Date();
      await marcarLista(order.id, k.deviceId, now);
      emitirComandaLista({
        storeId: k.storeId,
        orderId: order.id,
        ticketId: order.ticketId,
        tableId: order.tableId,
        tableName: order.tableName,
        section: order.section,
        at: now,
      });
      return { ok: true, alreadyReady: false };
    },
  );

  // Decisión 3 · «Cocina también lo puede marcar con un toque largo» (por
  // si el camarero se lo dice a voz).
  app.post(
    "/kitchen/comandas/:orderId/urgente",
    {
      preHandler: [requireKitchenDevice],
      schema: {
        params: ORDER_ID,
        body: {
          type: "object",
          additionalProperties: false,
          properties: { urgent: { type: "boolean" } },
        },
      },
    },
    async (request, reply) => {
      const k = request.kitchen!;
      const { orderId } = request.params as { orderId: string };
      const { urgent } = (request.body ?? {}) as { urgent?: boolean };
      const prisma = getPrisma();
      const order = await prisma.kitchenOrder.findFirst({
        where: { id: orderId, storeId: k.storeId, section: { in: k.sections } },
        select: { id: true, urgent: true },
      });
      if (!order) return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
      const quiere = urgent ?? !order.urgent;
      const now = new Date();
      await prisma.kitchenOrder.update({
        where: { id: orderId },
        data: quiere
          ? { urgent: true, urgentAt: now, urgentByDeviceId: k.deviceId }
          : { urgent: false, urgentAt: null, urgentByDeviceId: null },
      });
      emitirUrgente({ storeId: k.storeId, orderId, urgent: quiere, at: now });
      return { ok: true, urgent: quiere };
    },
  );

  // Decisión 7 · «un toque devuelve una tarjeta a la pantalla (por si se
  // tachó sin querer)».
  //
  // Se borran `readyAt` y `servedAt` —la tarjeta vuelve a estar abierta—
  // y se destachan sus platos, porque lo que se deshace es precisamente
  // haberlos tachado. Lo que NO se borra es la huella: `recoveredAt` queda
  // puesto para que el informe del dueño pueda ver la anomalía, que es
  // justo el dato interesante.
  app.post(
    "/kitchen/comandas/:orderId/recuperar",
    { preHandler: [requireKitchenDevice], schema: { params: ORDER_ID } },
    async (request, reply) => {
      const k = request.kitchen!;
      const { orderId } = request.params as { orderId: string };
      const prisma = getPrisma();
      const order = await prisma.kitchenOrder.findFirst({
        where: { id: orderId, storeId: k.storeId, section: { in: k.sections } },
        select: { id: true },
      });
      if (!order) return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
      const now = new Date();
      await prisma.$transaction([
        prisma.kitchenOrder.update({
          where: { id: orderId },
          data: {
            readyAt: null,
            readyByDeviceId: null,
            servedAt: null,
            servedByUserId: null,
            recoveredAt: now,
          },
        }),
        prisma.kitchenOrderLine.updateMany({
          where: { orderId },
          data: { doneAt: null, doneByDeviceId: null },
        }),
      ]);
      return { ok: true };
    },
  );

  // Decisión 9 · el latido. El TPV pregunta por él antes de enviar: si la
  // pantalla no está viva, «Enviar» avisa «Cocina no recibe» y saca el
  // papel por la impresora USB del terminal.
  app.post(
    "/kitchen/latido",
    {
      preHandler: [requireKitchenDevice],
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            // kds-2-wifi · DÓNDE ESCUCHA ESTA PANTALLA.
            //
            // La IP no se valida de forma: es la IP privada que la tablet
            // ve de sí misma y sólo sirve para que el TPV le hable. Mismo
            // criterio que `localIp` del heartbeat de A5. Se acota el
            // tamaño y ya.
            lanIp: { type: "string", maxLength: 60 },
            lanPort: { type: "integer", minimum: 1024, maximum: 65535 },
            // `false` cuando el servidor local no arrancó (el puerto
            // estaba ocupado, la pieza nativa no está en esta APK). Se
            // borra lo anunciado: el TPV tiene que saber que ahí no hay
            // nadie escuchando, y no reintentar contra una IP muerta.
            lanListening: { type: "boolean" },
          },
        },
      },
    },
    async (request) => {
      const k = request.kitchen!;
      const body = (request.body ?? {}) as {
        lanIp?: string;
        lanPort?: number;
        lanListening?: boolean;
      };
      const now = new Date();
      const escucha = body.lanListening !== false && body.lanIp != null;
      await getPrisma().device.update({
        where: { id: k.deviceId },
        data: {
          lastSeenAt: now,
          kitchenLanIp: escucha ? body.lanIp! : null,
          kitchenLanPort: escucha
            ? body.lanPort ?? PUERTO_LAN_POR_DEFECTO
            : null,
          kitchenLanAt: escucha ? now : null,
        },
      });
      return {
        ok: true,
        serverTime: now.toISOString(),
        // La clave viaja en cada latido y no sólo al arrancar: es cómo la
        // tablet se entera de que se rotó (se revocó un aparato de la
        // tienda) sin tener que reiniciarse.
        lan: { key: await asegurarClaveLan(k.storeId) },
      };
    },
  );

  // ── kds-2-wifi · LO QUE LA COCINA MARCÓ SIN INTERNET ─────────────────
  //
  // La tablet guarda sus tachados, sus «Lista» y sus «Visto» mientras no
  // hay red, y los sube todos aquí al volver. Con ellos sube qué envíos
  // recibió por la wifi, para que esas tarjetas no se pinten como nuevas.
  //
  // Idempotente por el `markId` que genera la tablet: puede reintentar
  // tantas veces como quiera, y de hecho lo hace (manda hasta que el
  // servidor contesta 200, como el outbox del terminal).
  //
  // El cuerpo es un lote y no una marca por petición a propósito: lo que
  // vuelve es un servicio entero de golpe, y cien peticiones con el 4G del
  // bar a medio gas es cien oportunidades de que la mitad se quede sin
  // subir.
  app.post(
    "/kitchen/sincronizar",
    {
      preHandler: [requireKitchenDevice],
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            marcas: {
              type: "array",
              maxItems: 500,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["markId", "kind", "clientSendId", "section", "at"],
                properties: {
                  markId: { type: "string", format: "uuid" },
                  kind: { type: "string", enum: ["HECHO", "VISTO", "LISTA"] },
                  clientSendId: { type: "string", format: "uuid" },
                  section: {
                    type: "string",
                    enum: ["BARRA", "COCINA", "SALON"],
                  },
                  ticketLineId: {
                    type: ["string", "null"],
                    format: "uuid",
                  },
                  done: { type: ["boolean", "null"] },
                  at: { type: "string", format: "date-time" },
                },
              },
            },
            recibidas: {
              type: "array",
              maxItems: 500,
              items: { type: "string", format: "uuid" },
            },
          },
        },
      },
    },
    async (request) => {
      const k = request.kitchen!;
      const body = (request.body ?? {}) as {
        marcas?: MarcaDeCocina[];
        recibidas?: string[];
      };
      return sincronizarDesdeLaTablet({
        deviceId: k.deviceId,
        storeId: k.storeId,
        sections: k.sections,
        marcas: body.marcas ?? [],
        recibidas: body.recibidas ?? [],
      });
    },
  );
}

async function marcarLista(
  orderId: string,
  deviceId: string,
  now: Date,
): Promise<void> {
  await getPrisma().kitchenOrder.update({
    where: { id: orderId },
    data: { readyAt: now, readyByDeviceId: deviceId },
  });
}
