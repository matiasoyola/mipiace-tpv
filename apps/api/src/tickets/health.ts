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
import { motivoSilencio } from "../holded/silencio.js";

export type TenantHealthLevel = "ok" | "warning" | "blocked";

export type TenantHealthReason =
  | "ok"
  | "no_sync_24h"
  | "no_sync_48h"
  | "no_api_key"
  | "no_sync_ever"
  // holded-desconectar (ADR-020) · el comercio no usa Holded: ni lo dejó
  // pendiente ni lo perdió. No hay salud que medir porque no hay
  // integración. Ver la nota larga abajo.
  | "no_aplica";

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
      // holded-desconectar (ADR-020) · las dos columnas que distinguen «no
      // lo ha conectado todavía» de «no lo usa».
      holdedEnabled: true,
      holdedDisconnectedAt: true,
    },
  });

  const hasHoldedKey = !!tenant.holdedApiKeyCiphertext;
  const lastSyncAt = tenant.lastIncrementalSyncAt;
  const lastSyncAgeMs = lastSyncAt ? now.getTime() - lastSyncAt.getTime() : null;

  // holded-desconectar (ADR-020) · LA MENTIRA QUE QUEDABA VIVA.
  //
  // `catalogo-local` gateó el banner rojo del ADMIN
  // (`AdminShell.tsx::HoldedHealthBanner`) porque «Holded está desconectado»
  // es una alarma para quien depende de Holded y una mentira para quien no.
  // El banner del TPV —`SalePage.tsx::HealthBanner`— se quedó sin gatear, y
  // es el que ve la cajera todo el día:
  //
  //   «Holded desconectado · La cuenta de Holded no está conectada. Puedes
  //    seguir cobrando: los tickets se guardan y se subirán solos cuando el
  //    propietario la reconecte. Avísale cuanto antes.»
  //
  // A Ana, el día después del corte y todos los siguientes. Cada palabra de
  // esa frase es falsa en su comercio: no hay nada que reconectar, no hay
  // tickets esperando y no hay a quién avisar.
  //
  // Se arregla AQUÍ y no en el componente a propósito. El endpoint lo
  // consumen el TPV y el panel, y arreglar sólo el TPV dejaría la misma
  // pregunta contestada de dos maneras según quién preguntara. Y el sitio
  // donde vive «¿de quién es esta salud?» es la función que la calcula.
  //
  // `level: "ok"` y no un cuarto nivel: los tres niveles significan
  // «opera con normalidad / avisa / alarma», y este comercio opera con
  // normalidad. El motivo lleva la diferencia para quien la necesite.
  const motivo = motivoSilencio(tenant);
  if (motivo === "desconectado" || motivo === "no_lo_usa") {
    return {
      level: "ok",
      reason: "no_aplica",
      lastSuccessfulSyncAt: lastSyncAt?.toISOString() ?? null,
      lastSyncAgeMs,
      blockedAt: null,
      hasHoldedKey: false,
    };
  }

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
