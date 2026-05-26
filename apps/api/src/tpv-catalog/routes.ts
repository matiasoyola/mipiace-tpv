// Endpoints catálogo expuestos al TPV (cajero, requireCashierSession).
// Sólo lectura. Devuelven sólo lo que el TPV necesita para pintar la
// pantalla de venta (B4 §2).

import type { FastifyInstance } from "fastify";

import { requireCashierSession } from "../shift/cashier-session.js";
import { getPrisma } from "../context.js";
import { getTenantHealthStatus } from "../tickets/health.js";

export async function registerTpvCatalogRoutes(app: FastifyInstance): Promise<void> {
  // Catálogo paginado. El TPV cachea el resultado en IndexedDB la primera
  // vez (B4 §2.2); refresca cuando el banner "Sincronizando" llega.
  app.get(
    "/tpv/catalog/products",
    {
      preHandler: requireCashierSession,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            cursor: { type: "string", format: "uuid" },
            limit: { type: "integer", minimum: 1, maximum: 1000 },
          },
        },
      },
    },
    async (request) => {
      const cashier = request.cashier!;
      const q = request.query as { cursor?: string; limit?: number };
      const limit = q.limit ?? 500;
      const prisma = getPrisma();
      // B-Multi-Vertical SB3: el TPV necesita saber el vertical para
      // decidir si renderiza TableMapScreen y qué icono placeholder
      // mostrar. Sólo lo leemos en la primera página (cursor vacío) para
      // no pegarle a la BD en cada cursor de paginación; el TPV cachea
      // el valor en localStorage al primer pull.
      const tenant = q.cursor
        ? null
        : await prisma.tenant.findUnique({
            where: { id: cashier.tid },
            select: { businessType: true, tpvIconPreset: true },
          });
      const products = await prisma.product.findMany({
        where: {
          tenantId: cashier.tid,
          active: true,
          sellableViaTpv: true,
          sku: { not: null },
        },
        orderBy: { name: "asc" },
        take: limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        select: {
          id: true,
          holdedProductId: true,
          name: true,
          sku: true,
          barcode: true,
          basePrice: true,
          taxRate: true,
          kind: true,
          imageMime: true,
          // B-Categorias-via-Tags: el TPV usa los tags para filtrar la
          // grid de productos con los chips de categoría. Si Holded no
          // envía tags, el campo llega como [] y los chips quedan vacíos.
          tags: true,
        },
      });
      const hasMore = products.length > limit;
      const items = (hasMore ? products.slice(0, limit) : products).map((p) => ({
        id: p.id,
        holdedProductId: p.holdedProductId,
        name: p.name,
        sku: p.sku!,
        barcode: p.barcode,
        basePrice: Number(p.basePrice),
        // Precio CON IVA — lo que se muestra en pantalla. El TPV
        // re-calcula al construir el ticket.
        priceGross:
          Math.round(
            Number(p.basePrice) * (1 + Number(p.taxRate) / 100) * 100,
          ) / 100,
        taxRate: Number(p.taxRate),
        kind: p.kind,
        // B-ProductImages: si el worker ya cacheó la imagen, devolvemos
        // el MIME. El TPV usa este campo como gate para renderizar
        // `<img>`; null → placeholder. El tenantId va en el JWT del
        // cajero, así que el front construye la URL final.
        imageMime: p.imageMime,
        tags: p.tags,
      }));
      return {
        items,
        nextCursor: hasMore ? items[items.length - 1]!.id : null,
        // tenantId aquí para que el TPV no tenga que decodificar el
        // JWT en cliente (lo hace el backend en validación).
        tenantId: cashier.tid,
        // Sólo presente en la primera página. El TPV lo cachea al primer
        // pull (cursor vacío) y lo reusa hasta el siguiente refresh
        // completo del catálogo. Si el tenant cambia de vertical desde
        // el super-admin, basta con que el cajero refresque para que el
        // valor caché se actualice.
        ...(tenant
          ? {
              businessType: tenant.businessType,
              // v1.3-hotfix6 · subvertical para que el TPV elija icono
              // placeholder (peluquería→tijeras, clínica→estetoscopio,
              // taller→llave inglesa, belleza→sparkles, etc.).
              tpvIconPreset: tenant.tpvIconPreset ?? null,
            }
          : {}),
      };
    },
  );

  // B-Bar-Modifiers · catálogo de modificadores para el TPV. El cajero
  // tap-ea un producto: si el producto tiene grupos asociados, el TPV
  // abre el modal <ModifierSelector>. Se descarga una vez por sesión y
  // se cachea en memoria — el dataset típico de un bar son <50 modifiers.
  app.get(
    "/tpv/catalog/modifier-groups",
    { preHandler: requireCashierSession },
    async (request) => {
      const cashier = request.cashier!;
      const prisma = getPrisma();
      const groups = await prisma.modifierGroup.findMany({
        where: { tenantId: cashier.tid, deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: {
          modifiers: {
            where: { deletedAt: null },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: {
              id: true,
              label: true,
              priceDeltaCents: true,
              sortOrder: true,
              isDefault: true,
            },
          },
          products: { select: { productId: true, sortOrder: true } },
        },
      });
      return {
        groups: groups.map((g) => ({
          id: g.id,
          name: g.name,
          exclusive: g.exclusive,
          required: g.required,
          sortOrder: g.sortOrder,
          productIds: g.products.map((p) => p.productId),
          modifiers: g.modifiers.map((m) => ({
            id: m.id,
            label: m.label,
            priceDeltaCents: m.priceDeltaCents,
            sortOrder: m.sortOrder,
            isDefault: m.isDefault,
          })),
        })),
      };
    },
  );

  // Comodines TPV-OTROS-{IVA} accesibles para el cajero al pulsar
  // "Línea libre" (núcleo §6.1). El front filtra por nombre que empieza
  // con "TPV-OTROS-".
  app.get(
    "/tpv/catalog/wildcards",
    { preHandler: requireCashierSession },
    async (request) => {
      const cashier = request.cashier!;
      const prisma = getPrisma();
      const items = await prisma.product.findMany({
        where: {
          tenantId: cashier.tid,
          active: true,
          sku: { startsWith: "TPV-OTROS-" },
        },
        select: {
          id: true,
          name: true,
          sku: true,
          basePrice: true,
          taxRate: true,
          holdedProductId: true,
        },
        orderBy: { taxRate: "desc" },
      });
      return {
        items: items.map((p) => ({
          id: p.id,
          holdedProductId: p.holdedProductId,
          name: p.name,
          sku: p.sku!,
          basePrice: Number(p.basePrice),
          taxRate: Number(p.taxRate),
        })),
      };
    },
  );

  // Health del sync con Holded para el banner "Sincronizando…" / "Sin
  // conexión" / "Holded no accesible" (§5 modo degradado). El TPV pollea
  // este endpoint cada ~30 s. B6 §3.1 amplía la respuesta con `level`,
  // `reason`, `lastSuccessfulSyncAt` y `blockedAt` para que el cliente
  // pinte tres estados (oculto/ámbar/rojo) sin recalcular umbrales.
  app.get(
    "/tpv/health/holded",
    { preHandler: requireCashierSession },
    async (request) => {
      const cashier = request.cashier!;
      const prisma = getPrisma();
      const [health, pendingCount, failedCount] = await Promise.all([
        getTenantHealthStatus(prisma, cashier.tid),
        prisma.ticket.count({
          where: { tenantId: cashier.tid, status: "PENDING_SYNC" },
        }),
        prisma.ticket.count({
          where: { tenantId: cashier.tid, status: "SYNC_FAILED" },
        }),
      ]);
      return {
        level: health.level,
        reason: health.reason,
        hasHoldedKey: health.hasHoldedKey,
        lastIncrementalSyncAt: health.lastSuccessfulSyncAt,
        lastSuccessfulSyncAt: health.lastSuccessfulSyncAt,
        lastSyncAgeMs: health.lastSyncAgeMs,
        blockedAt: health.blockedAt,
        pendingSyncCount: pendingCount,
        syncFailedCount: failedCount,
      };
    },
  );
}
