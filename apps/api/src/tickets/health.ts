// Helper de salud de la integración Holded (B6 §3).
//
// Mide la antigüedad del último sync incremental exitoso para decidir
// si el TPV opera con normalidad (ok), debe avisar al cajero (warning,
// >24h) o quedar bloqueado para operaciones que requieran Holded en el
// horizonte cercano (blocked, >48h o API Key ausente).
//
// "Blocked" sólo aplica a abrir/cerrar turno (B6 §3.2). El POST /tickets
// sigue funcionando: los cobros locales nunca se bloquean — el negocio
// debe poder cobrar aunque Holded esté caído. El banner rojo avisa al
// cajero y la dirección decide qué hacer.

import type { PrismaClient } from "@mipiacetpv/db";

export type TenantHealthLevel = "ok" | "warning" | "blocked";

export type TenantHealthReason =
  | "ok"
  | "no_sync_24h"
  | "no_sync_48h"
  | "no_api_key"
  | "no_sync_ever";

export interface TenantHealth {
  level: TenantHealthLevel;
  reason: TenantHealthReason;
  lastSuccessfulSyncAt: string | null;
  // Edad del último sync en milisegundos. `null` si nunca corrió.
  lastSyncAgeMs: number | null;
  // Marca de tiempo en la que el tenant cruzó al estado bloqueado.
  // Es el momento más antiguo entre `lastSyncAt + 48h` (si está
  // bloqueado por tiempo) y `now` (si está bloqueado por falta de
  // API key). Útil para informar al usuario "estamos bloqueados desde X".
  blockedAt: string | null;
  hasHoldedKey: boolean;
}

const WARNING_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const BLOCKED_THRESHOLD_MS = 48 * 60 * 60 * 1000;

export async function getTenantHealthStatus(
  prisma: PrismaClient,
  tenantId: string,
  now: Date = new Date(),
): Promise<TenantHealth> {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: {
      lastIncrementalSyncAt: true,
      holdedApiKeyCiphertext: true,
    },
  });

  const hasHoldedKey = !!tenant.holdedApiKeyCiphertext;
  const lastSyncAt = tenant.lastIncrementalSyncAt;
  const lastSyncAgeMs = lastSyncAt ? now.getTime() - lastSyncAt.getTime() : null;

  if (!hasHoldedKey) {
    return {
      level: "blocked",
      reason: "no_api_key",
      lastSuccessfulSyncAt: lastSyncAt?.toISOString() ?? null,
      lastSyncAgeMs,
      blockedAt: now.toISOString(),
      hasHoldedKey: false,
    };
  }

  if (!lastSyncAt) {
    // Tiene API key pero el cron nunca completó (puede ser onboarding
    // recién terminado o problema persistente). No bloqueamos hasta que
    // pasen 48h sin sync — el initial-sync deja `lastIncrementalSyncAt`
    // marcado al completar, así que un tenant correctamente onboardeado
    // ya lo tiene.
    return {
      level: "warning",
      reason: "no_sync_ever",
      lastSuccessfulSyncAt: null,
      lastSyncAgeMs: null,
      blockedAt: null,
      hasHoldedKey: true,
    };
  }

  if (lastSyncAgeMs! >= BLOCKED_THRESHOLD_MS) {
    return {
      level: "blocked",
      reason: "no_sync_48h",
      lastSuccessfulSyncAt: lastSyncAt.toISOString(),
      lastSyncAgeMs,
      blockedAt: new Date(lastSyncAt.getTime() + BLOCKED_THRESHOLD_MS).toISOString(),
      hasHoldedKey: true,
    };
  }

  if (lastSyncAgeMs! >= WARNING_THRESHOLD_MS) {
    return {
      level: "warning",
      reason: "no_sync_24h",
      lastSuccessfulSyncAt: lastSyncAt.toISOString(),
      lastSyncAgeMs,
      blockedAt: null,
      hasHoldedKey: true,
    };
  }

  return {
    level: "ok",
    reason: "ok",
    lastSuccessfulSyncAt: lastSyncAt.toISOString(),
    lastSyncAgeMs,
    blockedAt: null,
    hasHoldedKey: true,
  };
}

export const HEALTH_THRESHOLDS_MS = {
  warning: WARNING_THRESHOLD_MS,
  blocked: BLOCKED_THRESHOLD_MS,
} as const;
