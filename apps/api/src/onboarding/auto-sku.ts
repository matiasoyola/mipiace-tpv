// Script auto-SKU. Spike §07.B + docs/07-nucleo-comun.md §2.5.
//
// Detecta productos/servicios con sku vacío en la cache local y les
// asigna `AUTO-{primeros-8-chars-del-holded-id}`. Sube vía
// `PUT /products/{id}` con throttle ~5 req/s. GET-back para validar
// (ADR-010). Si Holded silencia el cambio el producto queda en
// `needs_sku_review=true` (bandeja del admin).

import type { PrismaClient } from "@mipiacetpv/db";
import {
  HoldedApiError,
  HoldedInvalidResponseError,
  HoldedSilentRejectError,
  updateProductWithGetBack,
  type HoldedClient,
} from "@mipiacetpv/holded-client";

export interface AutoSkuOptions {
  tenantId: string;
  prisma: PrismaClient;
  client: HoldedClient;
  logger?: { info: (msg: string, extra?: unknown) => void; warn: (msg: string, extra?: unknown) => void; error: (msg: string, extra?: unknown) => void };
  // Pausa entre PUTs. Default 200ms (≈5 req/s, ver §2.5).
  throttleMs?: number;
  // Inyectable para tests (vitest fake timers).
  sleep?: (ms: number) => Promise<void>;
}

export interface AutoSkuResult {
  candidatesScanned: number;
  fixed: number;
  needsReview: number;
  errors: string[];
}

const DEFAULT_THROTTLE_MS = 200;

export function buildAutoSku(holdedProductId: string): string {
  const base = holdedProductId.replace(/[^a-zA-Z0-9]/g, "");
  return `AUTO-${base.slice(0, 8)}`;
}

export async function runAutoSku(options: AutoSkuOptions): Promise<AutoSkuResult> {
  const { tenantId, prisma, client } = options;
  const log = options.logger ?? consoleLogger();
  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
  const sleep = options.sleep ?? defaultSleep;

  const result: AutoSkuResult = {
    candidatesScanned: 0,
    fixed: 0,
    needsReview: 0,
    errors: [],
  };

  // Idempotencia: pillamos productos con sku NULL o "" y SIN haber sido
  // marcados como needs_sku_review (esos ya pasaron por aquí y Holded
  // silenció — no merece la pena reintentar sin intervención manual).
  //
  // v1.3-hotfix4 · SÓLO PRODUCT. Los servicios no tienen stock ni
  // necesitan SKU en Holded — y su endpoint vive en `/invoicing/v1/
  // services`, no `/products`. Si pasáramos un servicio por aquí
  // Holded devolvería 404 al PUT `/products/{id}` y la rama 404 de
  // abajo marcaría el servicio como `active=false + sellableViaTpv=
  // false` (regresión que dejó invisibles 54 servicios de Peluquería
  // Sole 2026-05-25). Para SERVICE asignamos un SKU local sintético
  // tras este bucle, sin tocar Holded.
  const candidates = await prisma.product.findMany({
    where: {
      tenantId,
      kind: "PRODUCT",
      OR: [{ sku: null }, { sku: "" }],
      needsSkuReview: false,
    },
    select: { id: true, holdedProductId: true, name: true, kind: true },
  });
  result.candidatesScanned = candidates.length;

  for (const product of candidates) {
    const newSku = buildAutoSku(product.holdedProductId);
    try {
      await updateProductWithGetBack(
        client,
        product.holdedProductId,
        { sku: newSku },
        { expect: { sku: newSku } },
      );
      await prisma.product.update({
        where: { id: product.id },
        data: {
          sku: newSku,
          skuAutoAssignedAt: new Date(),
          sellableViaTpv: true,
          needsSkuReview: false,
        },
      });
      result.fixed += 1;
      log.info("auto-sku ok", { holdedProductId: product.holdedProductId, newSku });
    } catch (err) {
      if (err instanceof HoldedSilentRejectError) {
        await prisma.product.update({
          where: { id: product.id },
          data: { needsSkuReview: true, sellableViaTpv: false },
        });
        result.needsReview += 1;
        log.warn("auto-sku silenciado por Holded", {
          holdedProductId: product.holdedProductId,
          newSku,
          mismatches: err.mismatches,
        });
      } else if (err instanceof HoldedApiError && err.status === 404) {
        // B5 §1.2 + v1.9 Frente 2: el producto existía cuando lo
        // bajamos pero fue borrado en Holded. Soft-archive inmediato
        // (con timestamp) para que el siguiente sync incremental NO lo
        // procese y dejemos de generar errores cada 15 min. Si
        // reaparece en Holded, el upsert del sync lo reactiva
        // automáticamente y limpia archivedFromHoldedAt.
        await prisma.product.update({
          where: { id: product.id },
          data: {
            active: false,
            sellableViaTpv: false,
            archivedFromHoldedAt: new Date(),
          },
        });
        log.warn("auto-sku producto huérfano en Holded (404), archivado", {
          holdedProductId: product.holdedProductId,
        });
      } else if (
        err instanceof HoldedApiError &&
        err.status >= 400 &&
        err.status < 500 &&
        err.status !== 429
      ) {
        // v1.9 Frente 2: un 4xx distinto de 404/429 (caso TALONARIO
        // CAJA: 400 persistente por ficha corrupta/duplicada) no se
        // arregla reintentando — antes el producto seguía siendo
        // candidato y se reintentaba cada 15 min para siempre. Lo
        // mandamos a la bandeja de revisión (needsSkuReview=true saca
        // al producto de los candidatos) y el propietario decide desde
        // el admin (asignar SKU a mano o marcar no-vendible). El 429
        // (rate limit) sí es transitorio y cae a la rama de reintento.
        await prisma.product.update({
          where: { id: product.id },
          data: { needsSkuReview: true, sellableViaTpv: false },
        });
        result.needsReview += 1;
        log.error(
          "auto-sku 4xx persistente de Holded, movido a bandeja de revisión (sin más reintentos)",
          {
            holdedProductId: product.holdedProductId,
            name: product.name,
            status: err.status,
            error: err.message,
          },
        );
      } else if (err instanceof HoldedApiError || err instanceof HoldedInvalidResponseError) {
        // 5xx o respuesta no-JSON: transitorio o de configuración — el
        // producto sigue siendo candidato y se reintenta en el próximo
        // sync.
        result.errors.push(
          `${product.holdedProductId} (${product.name}): ${err.message}`,
        );
        log.error("auto-sku error de API", {
          holdedProductId: product.holdedProductId,
          error: err.message,
        });
      } else {
        result.errors.push(
          `${product.holdedProductId} (${product.name}): ${String(err)}`,
        );
        log.error("auto-sku error inesperado", {
          holdedProductId: product.holdedProductId,
          error: String(err),
        });
      }
    }
    await sleep(throttleMs);
  }

  // v1.3-hotfix4 · pasada separada para SERVICE: asignamos SKU local
  // sintético sin tocar Holded. Los servicios no tienen stock y su
  // endpoint vive en `/services` (no `/products`), así que pasarlos
  // por el PUT remoto provocaba 404 y los marcaba como inactivos.
  // El SKU local es estable (deriva de holdedProductId), suficiente
  // para que el endpoint /tpv/catalog/products los devuelva y para
  // identificarlos a nivel de mipiacetpv.
  const serviceCandidates = await prisma.product.findMany({
    where: {
      tenantId,
      kind: "SERVICE",
      OR: [{ sku: null }, { sku: "" }],
      needsSkuReview: false,
    },
    select: { id: true, holdedProductId: true, name: true },
  });
  for (const svc of serviceCandidates) {
    const newSku = buildAutoSku(svc.holdedProductId);
    try {
      await prisma.product.update({
        where: { id: svc.id },
        data: {
          sku: newSku,
          skuAutoAssignedAt: new Date(),
          sellableViaTpv: true,
          needsSkuReview: false,
        },
      });
      result.fixed += 1;
      log.info("auto-sku SERVICE local", {
        holdedProductId: svc.holdedProductId,
        newSku,
      });
    } catch (err) {
      result.errors.push(
        `${svc.holdedProductId} (${svc.name}, SERVICE): ${String(err)}`,
      );
      log.error("auto-sku SERVICE error local", {
        holdedProductId: svc.holdedProductId,
        error: String(err),
      });
    }
  }

  return result;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function consoleLogger() {
  return {
    info: (m: string, e?: unknown) => console.log(`[auto-sku] ${m}`, e ?? ""),
    warn: (m: string, e?: unknown) => console.warn(`[auto-sku] ${m}`, e ?? ""),
    error: (m: string, e?: unknown) => console.error(`[auto-sku] ${m}`, e ?? ""),
  };
}
