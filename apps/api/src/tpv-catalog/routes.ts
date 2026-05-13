// Endpoints catálogo expuestos al TPV (cajero, requireCashierSession).
// Sólo lectura. Devuelven sólo lo que el TPV necesita para pintar la
// pantalla de venta (B4 §2).

import type { FastifyInstance } from "fastify";

import { requireCashierSession } from "../shift/cashier-session.js";
import { getPrisma } from "../context.js";

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
      }));
      return {
        items,
        nextCursor: hasMore ? items[items.length - 1]!.id : null,
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
  // este endpoint cada ~30 s.
  app.get(
    "/tpv/health/holded",
    { preHandler: requireCashierSession },
    async (request) => {
      const cashier = request.cashier!;
      const prisma = getPrisma();
      const [tenant, pendingCount, failedCount] = await Promise.all([
        prisma.tenant.findUniqueOrThrow({
          where: { id: cashier.tid },
          select: {
            lastIncrementalSyncAt: true,
            holdedApiKeyCiphertext: true,
          },
        }),
        prisma.ticket.count({
          where: { tenantId: cashier.tid, status: "PENDING_SYNC" },
        }),
        prisma.ticket.count({
          where: { tenantId: cashier.tid, status: "SYNC_FAILED" },
        }),
      ]);
      const lastSyncAgeMs = tenant.lastIncrementalSyncAt
        ? Date.now() - tenant.lastIncrementalSyncAt.getTime()
        : null;
      return {
        hasHoldedKey: !!tenant.holdedApiKeyCiphertext,
        lastIncrementalSyncAt: tenant.lastIncrementalSyncAt?.toISOString() ?? null,
        lastSyncAgeMs,
        pendingSyncCount: pendingCount,
        syncFailedCount: failedCount,
      };
    },
  );
}
