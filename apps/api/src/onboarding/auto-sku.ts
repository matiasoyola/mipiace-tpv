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
  const candidates = await prisma.product.findMany({
    where: {
      tenantId,
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
      } else if (err instanceof HoldedApiError || err instanceof HoldedInvalidResponseError) {
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
