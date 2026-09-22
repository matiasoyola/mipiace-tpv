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
//
// ── catalogo-local, addendum 3 · la desambiguación ───────────────────
//
// Este fichero tenía un `usesHolded` que significaba "tiene clave". Con
// `Tenant.holdedEnabled` son DOS preguntas distintas y tenerlas
// llamándose parecido era un accidente esperando:
//
//   holdedEnabled  · ¿está PREVISTO que use Holded?   → `holded.enabled`
//   hasHoldedKey   · ¿lo tiene conectado YA?          → `holded.connected`
//
// `applies.holded` pasa a ser la PRIMERA. Un comercio que no usa Holded
// no puede salir "no listo" por no tener impuestos sincronizados de un
// ERP que no ha comprado — exactamente el mismo criterio con el que H1
// trató los checks de caja.
//
// Y eso obliga a mover `taxes-ratio` de `caja` a `holded`, que es donde
// siempre debió estar: `TenantTax` se puebla SÓLO desde el sync
// (`initial-sync.ts:129`, `incremental-sync.ts:185`), así que en un
// tenant sin Holded tiene cero filas por definición y el check no medía
// la salud de nadie, medía la existencia del sync.
//
// OJO al mover ese check, porque cambia QUIÉN bloquea a la empresa que
// está a mitad de onboarding (previsto, sin clave todavía): antes la
// bloqueaba `taxes-ratio` con sus cero taxes; ahora la bloquea
// `sync-done`, que pasa a aplicarle. Sigue sin poder activarse, que es
// lo que importa, pero por el check que lo dice de verdad. Hay test.

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
    | "fiscal-minimum"
    | "tickets-before-holded";
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
  // catalogo-local (addendum 3) · las dos preguntas, separadas y con
  // nombre propio. Sustituye al antiguo `usesHolded`, que sólo sabía
  // contestar la segunda y se leía como si contestara la primera.
  holded: {
    /** ¿Está previsto que use Holded? (`Tenant.holdedEnabled`) */
    enabled: boolean;
    /** ¿Lo tiene conectado ya? (`holdedApiKeyCiphertext != null`) */
    connected: boolean;
  };
  /**
   * Tickets cobrados que no subirán nunca: están en `PAID` y no tienen
   * fila en `holded_uploads`. En un comercio que no usa Holded es lo
   * normal y no se mira. En uno que SÍ lo usa y aún no lo ha conectado
   * es dinero que no llegará a su contabilidad.
   */
  ticketsCobradosSinSubir: number;
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
    ticketsCobradosSinSubirRows,
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
        // catalogo-local (addendum 3) · la otra mitad de la pregunta.
        holdedEnabled: true,
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
    // catalogo-local (addendum 3) · los cobros que no subirán nunca.
    //
    // `$queryRaw` y no un `count` de Prisma porque hace falta un NOT
    // EXISTS y NO hay relación entre `Ticket` y `HoldedUpload`: se casan
    // por `external_id`, pero las filas de tipo REFUND apuntan al
    // externalId del ABONO, que no es ningún ticket. Declarar la
    // relación en Prisma generaría una FK que reventaría esas filas.
    //
    // Y no vale contar `status = 'PAID'` a secas: un fiado saldado en un
    // tenant conectado pasa por PAID mientras su upload está en cola, y
    // saldría como falso positivo hasta que el worker lo subiera.
    prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n
        FROM tickets t
       WHERE t.tenant_id = ${tenantId}::uuid
         AND t.status = 'PAID'
         AND NOT EXISTS (
           SELECT 1 FROM holded_uploads u WHERE u.external_id = t.external_id
         )
    `,
  ]);
  const ticketsCobradosSinSubir = Number(
    ticketsCobradosSinSubirRows?.[0]?.n ?? 0,
  );

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
  // catalogo-local (addendum 3) · las dos preguntas, cada una con su
  // nombre. `holdedEnabled !== false` por lo mismo que `cajaEnabled`:
  // la columna es `@default(true)` y sólo un `false` explícito la apaga.
  const holdedPrevisto = tenant.holdedEnabled !== false;
  const holdedConectado = tenant.holdedApiKeyCiphertext != null;
  const hasCrm = tenant.crmEnabled === true;
  const hasAgenda = tenant.agendaEnabled === true;
  const applies: Record<CheckRequirement, boolean> = {
    always: true,
    caja: hasCaja,
    // La dependencia es "está previsto que use Holded", NO "lo tiene
    // conectado". Si fuera lo segundo, la empresa a mitad de onboarding
    // vería su `sync-done` como "No aplica" justo cuando es el único
    // check que importa.
    holded: holdedPrevisto,
  };
  // Sólo es una anomalía si Holded está previsto. En un comercio de
  // catálogo local, que sus tickets no suban es el diseño funcionando.
  const cobrosHuerfanos = holdedPrevisto ? ticketsCobradosSinSubir : 0;

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
    {
      // catalogo-local (addendum 3) · MUDADO de `caja` a `holded`.
      // `TenantTax` se puebla sólo desde el sync, así que sin Holded
      // tiene cero filas por definición: exigirlo era condenar al
      // comercio de catálogo local a no estar listo nunca.
      id: "taxes-ratio",
      label: `≥${TAXES_RATE_THRESHOLD_PCT}% de taxes con rate`,
      ok: taxes === 0 ? false : taxesPct >= TAXES_RATE_THRESHOLD_PCT,
      value: `${taxesWithRate}/${taxes} (${taxesPct}%)`,
      requires: "holded",
    },
    {
      // catalogo-local (addendum 3) · el cobro que no llegará a su
      // contabilidad. Es el hermano en pantalla del `log.warn` de
      // `holded-upload-gate.ts`: el warning sirve si alguien mira los
      // logs ese día, y esto sirve el resto de los días.
      //
      // Bloquea la activación a propósito. Si un tenant ha cobrado antes
      // de conectar Holded, activarlo sin mirar deja esas ventas
      // enterradas para siempre — nadie las va a echar de menos hasta el
      // trimestre.
      id: "tickets-before-holded",
      label: "Sin cobros anteriores a conectar Holded",
      ok: cobrosHuerfanos === 0,
      value:
        cobrosHuerfanos === 0
          ? "0"
          : `${cobrosHuerfanos} tickets cobrados antes de conectar Holded; no se subirán`,
      requires: "holded",
    },
    // ── Dependen de la caja ───────────────────────────────────────────
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
    holded: { enabled: holdedPrevisto, connected: holdedConectado },
    ticketsCobradosSinSubir,
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
