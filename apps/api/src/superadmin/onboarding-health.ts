// B-OnboardingV2 · Frente 3 · Métricas de salud del onboarding.
// H1 · reescrito para que cada check declare de qué depende (ADR-016).
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
//
// ── H1 · qué cambia ──────────────────────────────────────────────────
//
// Hasta hoy los cinco checks daban por hecho que el tenant tenía caja y
// Holded, y `ready` era `checks.every(ok)`. Una empresa sin caja no
// pasaba ninguno y no se podía activar nunca.
//
// Ahora cada check declara su dependencia (`requires`) y trae un
// `applies`. Los que no aplican salen como tales y NO cuentan para
// `ready`; los que aplican siguen exactamente igual de duros:
//
//   ready = checks.filter(applies).every(ok)
//
// `sync-done` depende de HOLDED y no de la caja, a propósito: una
// empresa con caja y sin Holded (caja local) no debe quedar bloqueada
// por un sync que nunca va a correr. La dependencia real de ese check
// es la clave, no la caja.
//
// Y se añaden dos que valen para CUALQUIER empresa, tenga lo que tenga:
// al menos un módulo encendido, y datos fiscales mínimos.

import { TicketStatus, type PrismaClient } from "@mipiacetpv/db";

const TAXES_RATE_THRESHOLD_PCT = 80;
const PRODUCTS_SELLABLE_THRESHOLD_PCT = 50;

/**
 * De qué depende un check. `always` = vale para cualquier empresa.
 */
export type CheckRequirement = "always" | "caja" | "holded";

export interface ReadinessCheck {
  id:
    | "sync-done"
    | "taxes-ratio"
    | "products-sellable"
    | "no-sync-failures"
    | "test-cashier-provisioned"
    | "modules-enabled"
    | "fiscal-minimum";
  label: string;
  ok: boolean;
  value?: string;
  // H1 · de qué depende, y si el tenant lo tiene. Un check con
  // `applies: false` no bloquea la activación y la pantalla lo pinta
  // como "No aplica", que es distinto de cumplir y de fallar.
  requires: CheckRequirement;
  applies: boolean;
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
  // H1 · en qué empresa estamos. La pantalla lo necesita para explicar
  // por qué la mitad de los checks dicen "No aplica" sin que el
  // implantador tenga que deducirlo.
  modules: { caja: boolean; crm: boolean; agenda: boolean };
  usesHolded: boolean;
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
        // H1 · de qué depende cada check.
        cajaEnabled: true,
        crmEnabled: true,
        agendaEnabled: true,
        holdedApiKeyCiphertext: true,
        fiscalProfile: true,
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

  // H1 · las dos dependencias. `cajaEnabled !== false` y no `!`: la
  // columna es `@default(true)` y sólo un `false` explícito la apaga
  // (mismo criterio que `lib/caja-gate.ts`).
  const hasCaja = tenant.cajaEnabled !== false;
  const usesHolded = tenant.holdedApiKeyCiphertext != null;
  const hasCrm = tenant.crmEnabled === true;
  const hasAgenda = tenant.agendaEnabled === true;
  const applies: Record<CheckRequirement, boolean> = {
    always: true,
    caja: hasCaja,
    holded: usesHolded,
  };

  // Datos fiscales mínimos: razón social y NIF válido en forma. No
  // validamos el dígito de control aquí — eso lo hace el alta con
  // `validateSpanishTaxId`; esto detecta el hueco, que es el fallo real
  // (el implantador no lo sabía y lo dejó vacío).
  const legalName = fiscalString(tenant.fiscalProfile, ["legalName", "businessName"]);
  const taxId = fiscalString(tenant.fiscalProfile, ["taxId", "nif", "fiscalNif"]);
  const fiscalOk = legalName != null && taxId != null;

  const modulesOn = [
    hasCaja ? "caja" : null,
    hasCrm ? "CRM" : null,
    hasAgenda ? "agenda" : null,
  ].filter((x): x is string => x != null);

  const declared: Array<Omit<ReadinessCheck, "applies">> = [
    // ── Valen para cualquier empresa ──────────────────────────────────
    {
      id: "modules-enabled",
      label: "Al menos un módulo encendido",
      ok: modulesOn.length > 0,
      value: modulesOn.length > 0 ? modulesOn.join(" · ") : "ninguno",
      requires: "always",
    },
    {
      id: "fiscal-minimum",
      label: "Datos fiscales mínimos (razón social y NIF)",
      ok: fiscalOk,
      value: fiscalOk
        ? `${legalName} · ${taxId}`
        : legalName == null
          ? "falta la razón social"
          : "falta el NIF",
      requires: "always",
    },
    // ── Dependen de Holded ────────────────────────────────────────────
    {
      id: "sync-done",
      label: "Sync inicial completado",
      ok: tenant.initialSyncStatus === "DONE",
      value: tenant.initialSyncStatus,
      requires: "holded",
    },
    // ── Dependen de la caja ───────────────────────────────────────────
    {
      id: "taxes-ratio",
      label: `≥${TAXES_RATE_THRESHOLD_PCT}% de taxes con rate`,
      ok: taxes === 0 ? false : taxesPct >= TAXES_RATE_THRESHOLD_PCT,
      value: `${taxesWithRate}/${taxes} (${taxesPct}%)`,
      requires: "caja",
    },
    {
      id: "products-sellable",
      label: `≥${PRODUCTS_SELLABLE_THRESHOLD_PCT}% de productos sellable`,
      ok:
        productsTotal === 0
          ? false
          : sellablePct >= PRODUCTS_SELLABLE_THRESHOLD_PCT,
      value: `${productsSellable}/${productsTotal} (${sellablePct}%)`,
      requires: "caja",
    },
    {
      id: "no-sync-failures",
      label: "Sin tickets SYNC_FAILED",
      ok: ticketsSyncFailed === 0,
      value: `${ticketsSyncFailed} pendientes`,
      requires: "caja",
    },
    {
      id: "test-cashier-provisioned",
      label: "Cajero técnico provisionado",
      ok: cashierTest != null,
      value: cashierTest != null ? "sí" : "no",
      requires: "caja",
    },
  ];

  const checks: ReadinessCheck[] = declared.map((c) => ({
    ...c,
    applies: applies[c.requires],
  }));

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
    modules: { caja: hasCaja, crm: hasCrm, agenda: hasAgenda },
    usesHolded,
    readinessChecks: checks,
    // H1 · sólo cuenta lo que aplica. Los que aplican siguen igual de
    // duros que antes: ni un umbral se ha relajado.
    ready: checks.filter((c) => c.applies).every((c) => c.ok),
  };
}

// Lee la primera clave presente de un `fiscalProfile` (Json libre) y la
// devuelve trimeada, o null si no hay nada utilizable. Los alias vienen
// de la historia del campo: `legalName`/`businessName`, `taxId`/`nif`/
// `fiscalNif` (ver `superadmin/tenants.ts`).
function fiscalString(profile: unknown, keys: string[]): string | null {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return null;
  const obj = profile as Record<string, unknown>;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}
