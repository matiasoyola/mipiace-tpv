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
      }));
      return {
        items,
        nextCursor: hasMore ? items[items.length - 1]!.id : null,
        // tenantId aquí para que el TPV no tenga que decodificar el
        // JWT en cliente (lo hace el backend en validación).
        tenantId: cashier.tid,
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
