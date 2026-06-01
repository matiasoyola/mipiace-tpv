// v1.3-SuperAdmin-Hub · Lote 2 · Endpoint GET /super-admin/hub.
//
// Aglutina en una sola llamada la información que el implantador necesita
// para empezar la jornada: tarjetas-resumen por tenant (sin paginación —
// tenemos pocos en el piloto), tareas comunes pre-cocinadas y estado
// del sistema (Redis, colas, último sync incremental).
//
// El payload está pensado para que el hub no tenga que cruzar más
// llamadas para el render inicial. Si más adelante crecen los
// tenants, paginamos las tarjetas aquí mismo; por ahora ordenamos
// por createdAt desc y devolvemos todas.

import type { FastifyInstance } from "fastify";

import { getPrisma, getRedis } from "../context.js";

import { requireSuperAdmin } from "./middleware.js";

interface TenantCard {
  id: string;
  name: string;
  plan: string | null;
  onboardingState: "DRAFT" | "ACTIVE";
  businessType: "HOSPITALITY" | "RETAIL" | "SERVICES";
  blocked: boolean;
  blockedReason: string | null;
  // v1.3-SuperAdmin-Hub Lote 3: si está set, el front pinta el botón
  // "Abrir en Holded" con deep-link directo al panel.
  holdedAccountId: string | null;
  holdedConnected: boolean;
  ownerEmail: string | null;
  lastIncrementalSyncAt: string | null;
  ticketsLast7d: number;
  ticketsSyncFailed: number;
  ticketsEmailFailed: number;
  activeShifts: number;
  // Estado derivado para colorear la tarjeta. "blocked" si el tenant
  // está bloqueado; "warning" si hay tickets fallando o el sync
  // incremental lleva > 1h sin correr en un ACTIVE; "ok" en el resto.
  status: "ok" | "warning" | "blocked";
  createdAt: string;
}

interface SystemStatus {
  // Ping a Redis (control de salud para BullMQ y rate-limit). Si falla,
  // significa que las colas no aceptan trabajos — bloqueante.
  redis: { ok: boolean; latencyMs: number | null; error: string | null };
  // Conteo de tenants por estado, útil para que el implantador vea de
  // un vistazo cuántos DRAFT pendientes de activar tiene.
  tenants: {
    total: number;
    active: number;
    draft: number;
    blocked: number;
  };
  // Tickets en SYNC_FAILED agregados a través de TODOS los tenants —
  // si pasa de 0, hay que mirar la bandeja de errores.
  globalTicketsSyncFailed: number;
  // Último incremental sync exitoso en cualquier tenant. NULL si nunca
  // ha corrido (entorno limpio).
  lastIncrementalSyncAt: string | null;
}

// "Tareas comunes": atajos pre-cocinados que el implantador suele
// querer al abrir el panel. No son acciones que requieran POST aquí —
// son pistas + URLs que el front sabe cómo navegar. Mantenemos el
// shape simple (id + label + hint + opcional href/target) para no
// acoplar el front a un esquema rígido.
interface CommonTask {
  id: string;
  label: string;
  hint: string;
  href: string;
  target?: "_blank" | "_self";
}

export async function registerSuperAdminHubRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/super-admin/hub",
    {
      preHandler: requireSuperAdmin,
    },
    async () => {
      const prisma = getPrisma();
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      // Bajamos todos los tenants en una sola query y luego cruzamos
      // las métricas con queries agregadas por tenantId. Con N
      // pequeño (<50) es preferible a N+1 selects per tenant.
      const tenants = await prisma.tenant.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          users: {
            // Cogemos OWNER real (no test cashier) para mostrar email.
            where: { role: "OWNER", deletedAt: null, isTestCashier: false },
            orderBy: { createdAt: "asc" },
            take: 1,
            select: { email: true },
          },
        },
      });

      // Pre-cruce de métricas por tenant. Hacemos counts agrupados con
      // raw filters para no disparar 5N queries (uno por contador).
      const tenantIds = tenants.map((t) => t.id);
      const [
        ticketsLast7dGrouped,
        ticketsSyncFailedGrouped,
        ticketsEmailFailedGrouped,
        activeShiftsGrouped,
      ] = await Promise.all([
        prisma.ticket.groupBy({
          by: ["tenantId"],
          where: { tenantId: { in: tenantIds }, createdAt: { gte: sevenDaysAgo } },
          _count: { _all: true },
        }),
        prisma.ticket.groupBy({
          by: ["tenantId"],
          where: { tenantId: { in: tenantIds }, status: "SYNC_FAILED" },
          _count: { _all: true },
        }),
        prisma.ticket.groupBy({
          by: ["tenantId"],
          where: { tenantId: { in: tenantIds }, emailFailedAt: { not: null } },
          _count: { _all: true },
        }),
        // Shift no tiene tenantId directo (va vía Register → Store).
        // Cruzamos con raw para evitar group-by sobre relación anidada.
        prisma.$queryRaw<Array<{ tenant_id: string; count: bigint }>>`
          SELECT s.tenant_id, COUNT(sh.id)::bigint AS count
          FROM shifts sh
          JOIN registers r ON sh.register_id = r.id
          JOIN stores s ON r.store_id = s.id
          WHERE sh.closed_at IS NULL
            AND s.tenant_id = ANY(${tenantIds}::uuid[])
          GROUP BY s.tenant_id
        `,
      ]);

      function lookupCount<T extends { tenantId: string; _count: { _all: number } }>(
        rows: T[],
        tenantId: string,
      ): number {
        return rows.find((r) => r.tenantId === tenantId)?._count._all ?? 0;
      }
      const activeShiftsByTenant = new Map<string, number>();
      for (const row of activeShiftsGrouped) {
        activeShiftsByTenant.set(row.tenant_id, Number(row.count));
      }

      const cards: TenantCard[] = tenants.map((t) => {
        const ticketsLast7d = lookupCount(ticketsLast7dGrouped, t.id);
        const ticketsSyncFailed = lookupCount(ticketsSyncFailedGrouped, t.id);
        const ticketsEmailFailed = lookupCount(ticketsEmailFailedGrouped, t.id);
        const activeShifts = activeShiftsByTenant.get(t.id) ?? 0;
        const lastIncrementalSyncAt =
          t.lastIncrementalSyncAt?.toISOString() ?? null;
        let status: "ok" | "warning" | "blocked" = "ok";
        if (t.blockedAt != null) {
          status = "blocked";
        } else if (
          ticketsSyncFailed > 0 ||
          ticketsEmailFailed > 0 ||
          // Sólo flagueamos sync atrasado en ACTIVE — DRAFT puede no
          // haber arrancado nunca el incremental (el inicial sí).
          (t.onboardingState === "ACTIVE" &&
            t.holdedApiKeyCiphertext != null &&
            (t.lastIncrementalSyncAt == null ||
              t.lastIncrementalSyncAt < oneHourAgo))
        ) {
          status = "warning";
        }
        return {
          id: t.id,
          name: t.name,
          plan: t.plan,
          onboardingState: t.onboardingState,
          businessType: t.businessType,
          blocked: t.blockedAt != null,
          blockedReason: t.blockedReason,
          holdedAccountId: t.holdedAccountId,
          holdedConnected: t.holdedApiKeyCiphertext != null,
          ownerEmail: t.users[0]?.email ?? null,
          lastIncrementalSyncAt,
          ticketsLast7d,
          ticketsSyncFailed,
          ticketsEmailFailed,
          activeShifts,
          status,
          createdAt: t.createdAt.toISOString(),
        };
      });

      // ── Estado del sistema ─────────────────────────────────────────
      const redisStatus = await pingRedis();

      const tenantsCount = {
        total: tenants.length,
        active: tenants.filter((t) => t.onboardingState === "ACTIVE" && t.blockedAt == null).length,
        draft: tenants.filter((t) => t.onboardingState === "DRAFT" && t.blockedAt == null).length,
        blocked: tenants.filter((t) => t.blockedAt != null).length,
      };

      const globalTicketsSyncFailed = ticketsSyncFailedGrouped.reduce(
        (acc, r) => acc + r._count._all,
        0,
      );

      // Último incremental sync globalmente — el max de
      // tenants.lastIncrementalSyncAt. Más fiable como prueba de vida
      // del cron que cualquier otro flag.
      const lastIncrementalSyncAt =
        tenants
          .map((t) => t.lastIncrementalSyncAt)
          .filter((d): d is Date => d != null)
          .sort((a, b) => b.getTime() - a.getTime())[0]
          ?.toISOString() ?? null;

      const system: SystemStatus = {
        redis: redisStatus,
        tenants: tenantsCount,
        globalTicketsSyncFailed,
        lastIncrementalSyncAt,
      };

      // ── Tareas comunes ─────────────────────────────────────────────
      //
      // Ordenadas por relevancia operativa: lo que el implantador
      // hace al inicio del día (revisar errores, activar drafts) va
      // primero; lo que hace al final (crear cuenta nueva) va al
      // final. El front respeta este orden.
      const tasks: CommonTask[] = [];
      if (globalTicketsSyncFailed > 0) {
        tasks.push({
          id: "review_sync_failures",
          label: `Revisar ${globalTicketsSyncFailed} ticket(s) en SYNC_FAILED`,
          hint: "Hay tickets que Holded no aceptó. Entra al detalle del tenant afectado.",
          href: "/superadmin/audit?action=resync",
          target: "_self",
        });
      }
      if (tenantsCount.draft > 0) {
        tasks.push({
          id: "activate_drafts",
          label: `Activar ${tenantsCount.draft} cuenta(s) DRAFT pendientes`,
          hint: "Tenants creados pero sin OWNER definitivo. Abre cada uno desde Cuentas.",
          href: "/superadmin/tenants?status=ok",
          target: "_self",
        });
      }
      tasks.push({
        id: "new_tenant",
        label: "Crear nueva cuenta",
        hint: "Conecta una nueva cuenta Holded y arranca el onboarding supervisado.",
        href: "/superadmin/tenants/new",
        target: "_self",
      });
      tasks.push({
        id: "open_audit",
        label: "Ver auditoría",
        hint: "Log inmutable de todas las acciones super-admin.",
        href: "/superadmin/audit",
        target: "_self",
      });

      return {
        cards,
        system,
        tasks,
        // Mismo timestamp que `Date.now()` para que el front muestre
        // "actualizado hace X" sin depender de su propio reloj.
        generatedAt: new Date().toISOString(),
      };
    },
  );
}

async function pingRedis(): Promise<{
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
}> {
  try {
    const redis = getRedis();
    const t0 = performance.now();
    const r = await redis.ping();
    const latencyMs = Math.round(performance.now() - t0);
    return { ok: r === "PONG", latencyMs, error: null };
  } catch (err) {
    return {
      ok: false,
      latencyMs: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

