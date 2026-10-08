// kds-1-cocina · LOS AJUSTES, en el panel del restaurante.
//
//   GET /admin/stores/:storeId/kitchen      los ajustes de cocina
//   PUT /admin/stores/:storeId/kitchen      cambiarlos
//   GET /admin/kitchen/screens              las pantallas y su latido
//   PUT /admin/products/:productId/allergens  los alérgenos de un plato
//
// ── Por qué los ajustes van en la TIENDA y no en el tenant ────────────
//
// Regla de alcance de Matías, 08-10: «lo que cambia de un local a otro es
// configuración por restaurante, no otro desarrollo». Una cadena con un
// bar y un restaurante a la carta necesita los dos modos de órdenes a la
// vez, y eso no cabe en una columna del tenant.
//
// ── Por qué los alérgenos SÍ y el módulo NO ───────────────────────────
//
// Los alérgenos del producto y las alergias por silla son **de serie en
// todo TPV de hostelería** (decisión 10): es una obligación legal de
// informar, no una función que se vende. Así que esta ruta NO está detrás
// de `kitchenDisplayEnabled`. Lo que sí lo está son los ajustes de la
// pantalla, que sin pantalla no significan nada.

import type { FastifyInstance } from "fastify";

import { LISTA_ALERGENOS } from "@mipiacetpv/ticket-model";

import { requireOwnerOrManager } from "../auth/middleware.js";
import { getPrisma } from "../context.js";
import { ensureCajaEnabled } from "../lib/caja-gate.js";
import { LATIDO_VIVO_MS } from "./tpv-routes.js";

export async function registerKitchenAjustesRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/admin/stores/:storeId/kitchen",
    {
      preHandler: [requireOwnerOrManager, ensureCajaEnabled],
      schema: {
        params: {
          type: "object",
          required: ["storeId"],
          properties: { storeId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { storeId } = request.params as { storeId: string };
      const prisma = getPrisma();
      const store = await prisma.store.findFirst({
        where: { id: storeId, tenantId: auth.tenantId, deletedAt: null },
        select: {
          id: true,
          name: true,
          kitchenGreenMaxMin: true,
          kitchenAmberMaxMin: true,
          kitchenCourseMode: true,
          kitchenSeatMode: true,
          kitchenReadyBeep: true,
          tenant: { select: { kitchenDisplayEnabled: true } },
        },
      });
      if (!store) {
        return reply
          .code(404)
          .send({ error: "STORE_NOT_FOUND", message: "Tienda no encontrada" });
      }
      return {
        storeId: store.id,
        storeName: store.name,
        moduleEnabled: store.tenant.kitchenDisplayEnabled,
        settings: {
          greenMaxMin: store.kitchenGreenMaxMin,
          amberMaxMin: store.kitchenAmberMaxMin,
          courseMode: store.kitchenCourseMode,
          seatMode: store.kitchenSeatMode,
          readyBeep: store.kitchenReadyBeep,
        },
      };
    },
  );

  app.put(
    "/admin/stores/:storeId/kitchen",
    {
      preHandler: [requireOwnerOrManager, ensureCajaEnabled],
      schema: {
        params: {
          type: "object",
          required: ["storeId"],
          properties: { storeId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            // El tope de 240 min no es arbitrario: por encima de cuatro
            // horas el semáforo deja de medir un servicio y empieza a
            // medir un olvido.
            greenMaxMin: { type: "integer", minimum: 1, maximum: 240 },
            amberMaxMin: { type: "integer", minimum: 2, maximum: 240 },
            courseMode: { type: "string", enum: ["ESPERA", "TIEMPOS"] },
            seatMode: { type: "string", enum: ["ALERGIA", "SIEMPRE"] },
            readyBeep: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { storeId } = request.params as { storeId: string };
      const body = (request.body ?? {}) as {
        greenMaxMin?: number;
        amberMaxMin?: number;
        courseMode?: "ESPERA" | "TIEMPOS";
        seatMode?: "ALERGIA" | "SIEMPRE";
        readyBeep?: boolean;
      };
      const prisma = getPrisma();
      const store = await prisma.store.findFirst({
        where: { id: storeId, tenantId: auth.tenantId, deletedAt: null },
        select: { id: true, kitchenGreenMaxMin: true, kitchenAmberMaxMin: true },
      });
      if (!store) {
        return reply
          .code(404)
          .send({ error: "STORE_NOT_FOUND", message: "Tienda no encontrada" });
      }
      const verde = body.greenMaxMin ?? store.kitchenGreenMaxMin;
      const ambar = body.amberMaxMin ?? store.kitchenAmberMaxMin;
      // El CHECK `stores_kitchen_semaforo` de la base lo impide igual.
      // Esto es para que la pantalla del propietario diga una frase y no
      // un error de constraint — misma pareja que en `exemptionCause`.
      if (ambar <= verde) {
        return reply.code(400).send({
          error: "KITCHEN_SEMAFORO_INVALID",
          message:
            `El umbral ámbar (${ambar} min) tiene que ser mayor que el verde (${verde} min): ` +
            "con los dos cruzados, el cocinero vería tarjetas rojas a los dos minutos y dejaría de mirar el color.",
        });
      }
      const updated = await prisma.store.update({
        where: { id: storeId },
        data: {
          ...(body.greenMaxMin != null ? { kitchenGreenMaxMin: body.greenMaxMin } : {}),
          ...(body.amberMaxMin != null ? { kitchenAmberMaxMin: body.amberMaxMin } : {}),
          ...(body.courseMode ? { kitchenCourseMode: body.courseMode } : {}),
          ...(body.seatMode ? { kitchenSeatMode: body.seatMode } : {}),
          ...(body.readyBeep != null ? { kitchenReadyBeep: body.readyBeep } : {}),
        },
        select: {
          kitchenGreenMaxMin: true,
          kitchenAmberMaxMin: true,
          kitchenCourseMode: true,
          kitchenSeatMode: true,
          kitchenReadyBeep: true,
        },
      });
      return {
        settings: {
          greenMaxMin: updated.kitchenGreenMaxMin,
          amberMaxMin: updated.kitchenAmberMaxMin,
          courseMode: updated.kitchenCourseMode,
          seatMode: updated.kitchenSeatMode,
          readyBeep: updated.kitchenReadyBeep,
        },
      };
    },
  );

  // Las pantallas emparejadas y si dan señales. Es lo que el propietario
  // mira cuando el cocinero dice «no me llega nada».
  app.get(
    "/admin/kitchen/screens",
    { preHandler: [requireOwnerOrManager, ensureCajaEnabled] },
    async (request) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const now = Date.now();
      const screens = await prisma.device.findMany({
        where: { tenantId: auth.tenantId, kind: "KITCHEN", revokedAt: null },
        select: {
          id: true,
          name: true,
          kitchenSections: true,
          pairedAt: true,
          lastSeenAt: true,
          register: {
            select: { id: true, name: true, store: { select: { id: true, name: true } } },
          },
        },
        orderBy: { pairedAt: "asc" },
      });
      return {
        heartbeatWindowMs: LATIDO_VIVO_MS,
        screens: screens.map((s) => ({
          id: s.id,
          name: s.name,
          sections: s.kitchenSections,
          pairedAt: s.pairedAt.toISOString(),
          lastSeenAt: s.lastSeenAt ? s.lastSeenAt.toISOString() : null,
          alive:
            s.lastSeenAt != null && now - s.lastSeenAt.getTime() < LATIDO_VIVO_MS,
          registerId: s.register.id,
          registerName: s.register.name,
          storeId: s.register.store.id,
          storeName: s.register.store.name,
        })),
      };
    },
  );

  // ── Los alérgenos de un plato ───────────────────────────────────────
  //
  // Ruta propia y no un campo del PATCH del producto local, porque aplica
  // también a los productos que vienen de HOLDED: los alérgenos son una
  // extensión LOCAL sobre la ficha del ERP (igual que `ServiceScheduling`
  // lo es para la agenda), y el sync de Holded no los toca porque no sabe
  // que existen.
  //
  // Se manda la lista ENTERA, no un diff: lo que queda es exactamente lo
  // que el propietario dejó marcado en la pantalla. Una lista vacía
  // significa «no informado» y es un estado válido — no es lo mismo que
  // «sin alérgenos», y el cruce de la capa 3 se apaga solo donde no hay
  // dato.
  app.put(
    "/admin/products/:productId/allergens",
    {
      preHandler: [requireOwnerOrManager, ensureCajaEnabled],
      schema: {
        params: {
          type: "object",
          required: ["productId"],
          properties: { productId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["allergens"],
          additionalProperties: false,
          properties: {
            allergens: {
              type: "array",
              maxItems: 14,
              uniqueItems: true,
              items: { type: "string", enum: [...LISTA_ALERGENOS] },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { productId } = request.params as { productId: string };
      const { allergens } = request.body as { allergens: string[] };
      const prisma = getPrisma();
      const product = await prisma.product.findFirst({
        where: { id: productId, tenantId: auth.tenantId },
        select: { id: true },
      });
      if (!product) {
        return reply
          .code(404)
          .send({ error: "PRODUCT_NOT_FOUND", message: "Producto no encontrado" });
      }
      // En el orden del anexo II, no en el que llegaron: es el de la
      // rejilla del TPV y el de la leyenda del papel.
      const ordenados = LISTA_ALERGENOS.filter((a) => allergens.includes(a));
      const updated = await prisma.product.update({
        where: { id: productId },
        data: { allergens: ordenados },
        select: { id: true, name: true, allergens: true },
      });
      return { product: updated };
    },
  );
}
