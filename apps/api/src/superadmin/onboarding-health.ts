// B-OnboardingV2 · Frente 3 · Métricas de salud del onboarding.
//
// El super-admin necesita una vista clara de "¿está listo para activar
// al propietario?". Esta función agrega las señales que importan en
// piloto: sync inicial OK, productos sellable, taxes con rate, ausencia
// de tickets SYNC_FAILED (no debería haber — el cajero técnico no sube
// nada — pero defensivo) y, opcionalmente, evidencia de que el equipo
// ha probado el TPV (tickets TEST > 0).
//
// Los thresholds (≥80% taxes con rate, ≥50% productos sellable) son
// arbitrarios y conservadores. Si el catálogo del cliente es mínimo
// (negocio nuevo con 5 productos) los porcentajes son frágiles, pero
// los pilotos esperados tienen catálogos grandes, así que vale la pena
// detectar "muchos productos sin SKU" como red flag.

import { TicketStatus, type PrismaClient } from "@mipiacetpv/db";

const TAXES_RATE_THRESHOLD_PCT = 80;
const PRODUCTS_SELLABLE_THRESHOLD_PCT = 50;

export interface ReadinessCheck {
  id:
    | "sync-done"
    | "taxes-ratio"
    | "products-sellable"
    | "no-sync-failures"
    | "test-cashier-provisioned";
  label: string;
  ok: boolean;
  value?: string;
}

export interface OnboardingHealth {
  initialSync: {
    status: string;
    lastRunAt: string | null;
    errorMessage: string | null;
  };
  taxes: {
    total: number;
    withValidRate: number;
    withoutRate: number;
  };
  products: {
    total: number;
    sellable: number;
    withSku: number;
    withoutSku: number;
  };
  services: {
    total: number;
    sellable: number;
  };
  contacts: {
    total: number;
  };
  ticketsTest: {
    total: number;
    lastAt: string | null;
  };
  ticketsSyncFailed: number;
  testCashierProvisioned: boolean;
  readinessChecks: ReadinessCheck[];
  ready: boolean;
}

function pct(n: number, d: number): number {
  if (d === 0) return 100;
  return Math.round((n / d) * 100);
}

export async function computeOnboardingHealth(
  prisma: PrismaClient,
  tenantId: string,
): Promise<OnboardingHealth> {
  const [
    tenant,
    taxes,
    taxesWithRate,
    productsTotal,
    productsSellable,
    productsWithSku,
    servicesTotal,
    servicesSellable,
    contactsTotal,
    ticketsTestTotal,
    ticketsTestLast,
    ticketsSyncFailed,
    cashierTest,
  ] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: {
        initialSyncStatus: true,
        initialSyncCompletedAt: true,
        initialSyncStartedAt: true,
        initialSyncStats: true,
      },
    }),
    prisma.tenantTax.count({ where: { tenantId } }),
    prisma.tenantTax.count({ where: { tenantId, rate: { not: null } } }),
    prisma.product.count({ where: { tenantId, kind: "PRODUCT" } }),
    prisma.product.count({
      where: { tenantId, kind: "PRODUCT", sellableViaTpv: true },
    }),
    prisma.product.count({
      where: { tenantId, kind: "PRODUCT", sku: { not: null } },
    }),
    prisma.product.count({ where: { tenantId, kind: "SERVICE" } }),
    prisma.product.count({
      where: { tenantId, kind: "SERVICE", sellableViaTpv: true },
    }),
    prisma.contact.count({ where: { tenantId, active: true } }),
    prisma.ticket.count({ where: { tenantId, status: TicketStatus.TEST } }),
    prisma.ticket.findFirst({
      where: { tenantId, status: TicketStatus.TEST },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.ticket.count({ where: { tenantId, status: TicketStatus.SYNC_FAILED } }),
    prisma.user.findFirst({
      where: { tenantId, isTestCashier: true, deletedAt: null },
      select: { id: true },
    }),
  ]);

  // Mensaje de error del sync extraído de los stats (si hay).
  const stats =
    tenant.initialSyncStats &&
    typeof tenant.initialSyncStats === "object" &&
    !Array.isArray(tenant.initialSyncStats)
      ? (tenant.initialSyncStats as Record<string, unknown>)
      : null;
  let errorMessage: string | null = null;
  if (stats && Array.isArray(stats.errors) && stats.errors.length > 0) {
    const first = stats.errors[0];
    if (first && typeof first === "object" && "message" in first) {
      const m = (first as { message?: unknown }).message;
      errorMessage = typeof m === "string" ? m : null;
    }
  }

  const taxesPct = pct(taxesWithRate, taxes);
  const sellablePct = pct(productsSellable, productsTotal);
  const lastRunAt =
    tenant.initialSyncCompletedAt ?? tenant.initialSyncStartedAt ?? null;

  const checks: ReadinessCheck[] = [
    {
      id: "sync-done",
      label: "Sync inicial completado",
      ok: tenant.initialSyncStatus === "DONE",
      value: tenant.initialSyncStatus,
    },
    {
      id: "taxes-ratio",
      label: `≥${TAXES_RATE_THRESHOLD_PCT}% de taxes con rate`,
      ok: taxes === 0 ? false : taxesPct >= TAXES_RATE_THRESHOLD_PCT,
      value: `${taxesWithRate}/${taxes} (${taxesPct}%)`,
    },
    {
      id: "products-sellable",
      label: `≥${PRODUCTS_SELLABLE_THRESHOLD_PCT}% de productos sellable`,
      ok:
        productsTotal === 0
          ? false
          : sellablePct >= PRODUCTS_SELLABLE_THRESHOLD_PCT,
      value: `${productsSellable}/${productsTotal} (${sellablePct}%)`,
    },
    {
      id: "no-sync-failures",
      label: "Sin tickets SYNC_FAILED",
      ok: ticketsSyncFailed === 0,
      value: `${ticketsSyncFailed} pendientes`,
    },
    {
      id: "test-cashier-provisioned",
      label: "Cajero técnico provisionado",
      ok: cashierTest != null,
      value: cashierTest != null ? "sí" : "no",
    },
  ];

  return {
    initialSync: {
      status: tenant.initialSyncStatus,
      lastRunAt: lastRunAt?.toISOString() ?? null,
      errorMessage,
    },
    taxes: {
      total: taxes,
      withValidRate: taxesWithRate,
      withoutRate: taxes - taxesWithRate,
    },
    products: {
      total: productsTotal,
      sellable: productsSellable,
      withSku: productsWithSku,
      withoutSku: productsTotal - productsWithSku,
    },
    services: {
      total: servicesTotal,
      sellable: servicesSellable,
    },
    contacts: {
      total: contactsTotal,
    },
    ticketsTest: {
      total: ticketsTestTotal,
      lastAt: ticketsTestLast?.createdAt.toISOString() ?? null,
    },
    ticketsSyncFailed,
    testCashierProvisioned: cashierTest != null,
    readinessChecks: checks,
    ready: checks.every((c) => c.ok),
  };
}
