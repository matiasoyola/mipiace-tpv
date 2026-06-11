// Conciliación diaria TPV ↔ Holded (v1.5-consistencia-B · Lote 4).
//
// El detector definitivo de todo lo monetario: para cada tenant con
// tickets SYNCED en las últimas 48h, GET de cada documento en Holded y
// comparación de tres invariantes:
//
//   1. el documento EXISTE (404/desaparecido → mismatch "missing"),
//   2. su total coincide con `tickets.total` (el bug del céntimo de
//      Peluquería Sole lo encontró una clienta a ojo — esto lo habría
//      encontrado un cron),
//   3. está pagado (paymentsPending == 0).
//
// Resultado en `reconciliation_runs` (un run por tenant y pasada). Si
// hay mismatches: log level error (alertable por Sentry, Lote 2) +
// email a SUPER_ADMIN_FROM_EMAIL con el resumen.
//
// Rate limits de Holded: throttle entre GETs (mismo patrón que
// auto-sku, ~5 req/s con 200 ms). Inyectable a 0 en tests.

import type { PrismaClient } from "@mipiacetpv/db";
import {
  ApiKeyClient,
  HoldedApiError,
  getSalesreceipt,
  type HoldedClient,
} from "@mipiacetpv/holded-client";

import { decryptSecret } from "../crypto.js";
import { getEmailSender, type EmailSender } from "../email/sender.js";
import { loadEnv } from "../env.js";
import { captureAlert } from "../lib/sentry.js";

// Ventana de tickets a revisar y tolerancia de total. La tolerancia es
// MENOR que un céntimo: el objetivo es exactamente cazar drifts de
// céntimo como el de b30; sólo absorbe ruido de coma flotante.
const LOOKBACK_MS = 48 * 60 * 60 * 1000;
const TOTAL_TOLERANCE_EUR = 0.005;
const DEFAULT_THROTTLE_MS = 200;

export interface ReconciliationMismatch {
  // Identificación del ticket para soporte (número interno + uuid).
  ticket: string;
  internalNumber: string | null;
  holdedDocumentId: string | null;
  field: "missing" | "total" | "paymentsPending" | "fetch_error";
  expected: unknown;
  actual: unknown;
}

export interface TenantReconciliationResult {
  tenantId: string;
  ticketsChecked: number;
  mismatches: ReconciliationMismatch[];
}

interface ReconciliationLogger {
  info: (msg: string, extra?: unknown) => void;
  error: (msg: string, extra?: unknown) => void;
}

export interface ReconcileTenantOptions {
  tenantId: string;
  prisma: PrismaClient;
  // Inyectable para tests; por defecto ApiKeyClient con la key cifrada
  // del tenant.
  buildClient?: (apiKey: string) => HoldedClient;
  logger?: ReconciliationLogger;
  now?: Date;
  throttleMs?: number;
}

function consoleLogger(): ReconciliationLogger {
  return {
    info: (msg, extra) => console.log(`[reconciliation] ${msg}`, extra ?? ""),
    error: (msg, extra) => console.error(`[reconciliation] ${msg}`, extra ?? ""),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Revisa los tickets SYNCED de las últimas 48h de UN tenant contra
// Holded. No persiste nada — el caller decide (runDailyReconciliation
// guarda el run y alerta).
export async function reconcileTenant(
  options: ReconcileTenantOptions,
): Promise<TenantReconciliationResult> {
  const { tenantId, prisma } = options;
  const log = options.logger ?? consoleLogger();
  const now = options.now ?? new Date();
  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { holdedApiKeyCiphertext: true },
  });
  if (!tenant.holdedApiKeyCiphertext) {
    // Sin key no hay nada que conciliar (los tickets de este tenant no
    // pueden estar SYNCED de todos modos).
    return { tenantId, ticketsChecked: 0, mismatches: [] };
  }

  const env = loadEnv();
  const apiKey = decryptSecret(
    tenant.holdedApiKeyCiphertext,
    env.HOLDED_KEY_ENCRYPTION_SECRET,
  );
  const client = options.buildClient
    ? options.buildClient(apiKey)
    : new ApiKeyClient(apiKey, { baseUrl: env.HOLDED_BASE_URL });

  const since = new Date(now.getTime() - LOOKBACK_MS);
  const tickets = await prisma.ticket.findMany({
    where: {
      tenantId,
      status: "SYNCED",
      syncedAt: { gte: since },
      holdedDocumentId: { not: null },
    },
    select: {
      externalId: true,
      internalNumber: true,
      holdedDocumentId: true,
      total: true,
    },
    orderBy: { syncedAt: "asc" },
  });

  const mismatches: ReconciliationMismatch[] = [];
  let first = true;
  for (const ticket of tickets) {
    if (!first && throttleMs > 0) await sleep(throttleMs);
    first = false;
    const documentId = ticket.holdedDocumentId!;
    const base = {
      ticket: ticket.externalId,
      internalNumber: ticket.internalNumber,
      holdedDocumentId: documentId,
    };
    let stored;
    try {
      stored = await getSalesreceipt(client, documentId);
    } catch (err) {
      if (err instanceof HoldedApiError && err.status === 404) {
        mismatches.push({
          ...base,
          field: "missing",
          expected: "documento existente en Holded",
          actual: "404",
        });
      } else {
        // Error transitorio (red, 5xx, 429): lo reportamos como
        // fetch_error sin tirar la pasada entera — el run de mañana
        // lo reintenta porque la ventana es de 48h.
        mismatches.push({
          ...base,
          field: "fetch_error",
          expected: "GET ok",
          actual: err instanceof Error ? err.message : String(err),
        });
      }
      continue;
    }
    const expectedTotal = Number(ticket.total);
    const storedTotal = Number(stored.total ?? 0);
    if (Math.abs(storedTotal - expectedTotal) > TOTAL_TOLERANCE_EUR) {
      mismatches.push({
        ...base,
        field: "total",
        expected: expectedTotal,
        actual: storedTotal,
      });
    }
    const paymentsPending = Number(stored.paymentsPending ?? 0);
    if (Math.abs(paymentsPending) > TOTAL_TOLERANCE_EUR) {
      mismatches.push({
        ...base,
        field: "paymentsPending",
        expected: 0,
        actual: paymentsPending,
      });
    }
  }

  if (mismatches.length > 0) {
    log.error(`tenant ${tenantId}: ${mismatches.length} mismatch(es)`, {
      mismatches,
    });
  }
  return { tenantId, ticketsChecked: tickets.length, mismatches };
}

export interface RunDailyReconciliationOptions {
  prisma: PrismaClient;
  buildClient?: (apiKey: string) => HoldedClient;
  emailSender?: EmailSender;
  logger?: ReconciliationLogger;
  now?: Date;
  throttleMs?: number;
}

export interface DailyReconciliationSummary {
  tenantsChecked: number;
  ticketsChecked: number;
  totalMismatches: number;
}

// Pasada diaria completa: tenants con tickets SYNCED en las últimas
// 48h → reconcileTenant → persistir run → alertar si hay mismatches.
export async function runDailyReconciliation(
  options: RunDailyReconciliationOptions,
): Promise<DailyReconciliationSummary> {
  const { prisma } = options;
  const log = options.logger ?? consoleLogger();
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - LOOKBACK_MS);

  // Sólo tenants con actividad SYNCED reciente — un tenant parado no
  // gasta cuota de rate limit de Holded.
  const tenants = await prisma.ticket.groupBy({
    by: ["tenantId"],
    where: {
      status: "SYNCED",
      syncedAt: { gte: since },
      holdedDocumentId: { not: null },
    },
  });

  const summary: DailyReconciliationSummary = {
    tenantsChecked: 0,
    ticketsChecked: 0,
    totalMismatches: 0,
  };

  for (const row of tenants) {
    const tenantId = row.tenantId;
    let result: TenantReconciliationResult;
    try {
      result = await reconcileTenant({
        tenantId,
        prisma,
        buildClient: options.buildClient,
        logger: log,
        now,
        throttleMs: options.throttleMs,
      });
    } catch (err) {
      // Un tenant roto (key corrupta, Holded 402…) no aborta el resto.
      log.error(`tenant ${tenantId}: pasada falló`, {
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    summary.tenantsChecked += 1;
    summary.ticketsChecked += result.ticketsChecked;
    summary.totalMismatches += result.mismatches.length;

    await prisma.reconciliationRun.create({
      data: {
        tenantId,
        runAt: now,
        ticketsChecked: result.ticketsChecked,
        mismatches: result.mismatches as unknown as object,
      },
    });

    if (result.mismatches.length > 0) {
      // Alertable: Sentry (no-op sin DSN) + email al equipo.
      captureAlert(
        `conciliación: ${result.mismatches.length} mismatch(es) TPV↔Holded`,
        { tenantId, extra: { mismatches: result.mismatches } },
      );
      await sendMismatchEmail(options, tenantId, result, log);
    }
  }

  log.info("pasada diaria completada", summary as unknown as Record<string, unknown>);
  return summary;
}

async function sendMismatchEmail(
  options: RunDailyReconciliationOptions,
  tenantId: string,
  result: TenantReconciliationResult,
  log: ReconciliationLogger,
): Promise<void> {
  const env = loadEnv();
  const sender = options.emailSender ?? getEmailSender();
  const tenant = await options.prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true },
  });
  const lines = result.mismatches.map(
    (m) =>
      `- ticket ${m.internalNumber ?? "?"} (${m.ticket}) · campo ${m.field} · esperado ${JSON.stringify(m.expected)} · real ${JSON.stringify(m.actual)}`,
  );
  try {
    await sender.send({
      to: env.SUPER_ADMIN_FROM_EMAIL,
      subject: `[mipiacetpv] Conciliación TPV↔Holded: ${result.mismatches.length} descuadre(s) en ${tenant?.name ?? tenantId}`,
      text: [
        `Conciliación diaria TPV ↔ Holded — tenant ${tenant?.name ?? "?"} (${tenantId}).`,
        ``,
        `Tickets revisados (48h): ${result.ticketsChecked}`,
        `Descuadres: ${result.mismatches.length}`,
        ``,
        ...lines,
        ``,
        `Detalle completo: GET /super-admin/tenants/${tenantId}/reconciliation`,
      ].join("\n"),
    });
  } catch (err) {
    // El email es best-effort: el run ya quedó persistido y Sentry ya
    // tiene el evento.
    log.error("no se pudo enviar el email de conciliación", {
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
