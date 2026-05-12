// Creación de productos comodín TPV-OTROS-{IVA} para línea libre
// (spike §06.C + docs/07-nucleo-comun.md §2.6).
//
// Sólo crea los tipos de IVA que el tenant tenga activos en su catálogo.
// Si ya existe en Holded un producto con el sku canónico, reutiliza.

import type { PrismaClient } from "@mipiacetpv/db";
import {
  createProduct,
  HoldedApiError,
  HoldedSilentRejectError,
  type HoldedClient,
} from "@mipiacetpv/holded-client";

export interface WildcardOptions {
  tenantId: string;
  prisma: PrismaClient;
  client: HoldedClient;
  logger?: { info: (msg: string, extra?: unknown) => void; warn: (msg: string, extra?: unknown) => void; error: (msg: string, extra?: unknown) => void };
  // Cap defensivo en caso de catálogo con tipos exóticos (16, 23, etc.).
  // Sólo tratamos los estándar peninsulares + 0.
  allowedRates?: number[];
}

export interface WildcardResult {
  created: number;
  reused: number;
  errors: string[];
}

const DEFAULT_ALLOWED_RATES = [0, 4, 10, 21];

export async function createTpvOtrosWildcards(
  options: WildcardOptions,
): Promise<WildcardResult> {
  const { tenantId, prisma, client } = options;
  const log = options.logger ?? consoleLogger();
  const allowed = new Set(options.allowedRates ?? DEFAULT_ALLOWED_RATES);
  const result: WildcardResult = { created: 0, reused: 0, errors: [] };

  // Detectamos los tipos de IVA en uso por el catálogo (ya sincronizado).
  const ratesInUse = await prisma.product.findMany({
    where: { tenantId, taxRate: { in: [0, 4, 10, 21] } },
    select: { taxRate: true },
    distinct: ["taxRate"],
  });
  const distinctRates = ratesInUse
    .map((r: { taxRate: unknown }) => Number(r.taxRate))
    .filter((n: number) => allowed.has(n));

  for (const rate of distinctRates) {
    const sku = `TPV-OTROS-${rate}`;
    const existing = await prisma.product.findFirst({
      where: { tenantId, sku },
      select: { id: true },
    });
    if (existing) {
      result.reused += 1;
      log.info("comodín ya existe en cache local", { sku });
      continue;
    }
    try {
      const created = await createProduct(client, {
        name: `TPV · Línea libre (${rate}% IVA)`,
        sku,
        tax: rate,
        kind: "simple",
        forSale: 1,
        desc: "Producto comodín del TPV para venta libre. No editar.",
      });
      if (!created.id) {
        result.errors.push(`No se obtuvo id al crear ${sku}`);
        continue;
      }
      await prisma.product.upsert({
        where: {
          tenantId_holdedProductId: {
            tenantId,
            holdedProductId: created.id,
          },
        },
        create: {
          tenantId,
          holdedProductId: created.id,
          name: typeof created.name === "string" ? created.name : sku,
          sku,
          basePrice: 0,
          taxRate: rate,
          kind: "PRODUCT",
          active: true,
          sellableViaTpv: true,
          raw: created as unknown as object,
        },
        update: { sku, taxRate: rate, sellableViaTpv: true },
      });
      result.created += 1;
      log.info("comodín creado", { sku, rate });
    } catch (err) {
      // Si Holded responde 4xx (p.ej. sku ya existe), interpretamos como
      // "reutiliza" si el sku ya está tomado en Holded. El sync inicial
      // posterior ya lo trajo a `product`, así que el if(existing) lo
      // habría cogido. Si llegamos aquí con duplicate, lo marcamos como
      // error porque significa que el sku está en Holded pero no en
      // nuestra cache — necesita re-sync.
      if (err instanceof HoldedApiError || err instanceof HoldedSilentRejectError) {
        result.errors.push(`${sku}: ${err.message}`);
        log.warn("comodín no creado", { sku, error: err.message });
      } else {
        result.errors.push(`${sku}: ${String(err)}`);
        log.error("comodín error inesperado", { sku, error: String(err) });
      }
    }
  }

  return result;
}

function consoleLogger() {
  return {
    info: (m: string, e?: unknown) => console.log(`[tpv-otros] ${m}`, e ?? ""),
    warn: (m: string, e?: unknown) => console.warn(`[tpv-otros] ${m}`, e ?? ""),
    error: (m: string, e?: unknown) => console.error(`[tpv-otros] ${m}`, e ?? ""),
  };
}
