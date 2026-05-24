import type { FastifyInstance } from "fastify";

import { Prisma } from "@mipiacetpv/db";
import {
  ApiKeyClient,
  HoldedApiError,
  HoldedInvalidResponseError,
  HoldedSubscriptionSuspendedError,
  listWarehouses,
  type HoldedWarehouse,
} from "@mipiacetpv/holded-client";
import {
  generateTemporaryPassword,
  validateSpanishTaxId,
} from "@mipiacetpv/util-validation";

import { hashPassword } from "../auth/passwords.js";
import { getPrisma } from "../context.js";
import { encryptSecret } from "../crypto.js";
import { loadEnv } from "../env.js";
import { enqueueInitialSync } from "../queues/initial-sync.js";
import { enqueueManualSync } from "../queues/catalog-incremental.js";

import {
  extractRequestSignals,
  writeAudit,
  type SuperAdminAction,
} from "./audit.js";
import { requireSuperAdmin } from "./middleware.js";
import { computeOnboardingHealth } from "./onboarding-health.js";
import { issueTestCashierSession, purgeTestData } from "./test-cashier.js";
import { signImpersonationToken } from "./tokens.js";
import { sendOwnerWelcomeEmail } from "./welcome-email.js";

const emailFormat = "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$";

// Estado derivado del tenant para la lista. "warning" cuando hay errores
// pero opera; "blocked" cuando blockedAt != null; "ok" en el resto.
type DegradedState = "ok" | "warning" | "blocked";

interface TenantMetrics {
  ticketsLast7d: number;
  ticketsSyncFailed: number;
  ticketsEmailFailed: number;
  degraded: { state: DegradedState; lastIncrementalSyncAt: string | null };
  storesCount: number;
  activeShifts: number;
}

function fiscalNifFromProfile(profile: Prisma.JsonValue | null): string | null {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return null;
  const obj = profile as Record<string, unknown>;
  const nif = obj.taxId ?? obj.nif ?? obj.fiscalNif;
  return typeof nif === "string" ? nif : null;
}

function serializeDraftTenant(t: {
  id: string;
  name: string;
  plan: string | null;
  fiscalProfile: Prisma.JsonValue;
  onboardingState: "DRAFT" | "ACTIVE";
  businessType: "HOSPITALITY" | "RETAIL" | "SERVICES";
  createdAt: Date;
}) {
  return {
    id: t.id,
    name: t.name,
    plan: t.plan,
    fiscalProfile: t.fiscalProfile,
    fiscalNif: fiscalNifFromProfile(t.fiscalProfile),
    onboardingState: t.onboardingState,
    businessType: t.businessType,
    createdAt: t.createdAt.toISOString(),
  };
}

function fiscalLegalName(profile: Prisma.JsonValue | null): string | null {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return null;
  const obj = profile as Record<string, unknown>;
  const name = obj.legalName ?? obj.businessName;
  return typeof name === "string" ? name : null;
}

function fiscalAddressString(profile: Prisma.JsonValue | null): string | null {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return null;
  const obj = profile as Record<string, unknown>;
  const addr = obj.address;
  return typeof addr === "string" ? addr : null;
}

async function computeMetrics(
  prisma: Prisma.TransactionClient | ReturnType<typeof getPrisma>,
  tenantId: string,
): Promise<TenantMetrics> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [
    ticketsLast7d,
    ticketsSyncFailed,
    ticketsEmailFailed,
    storesCount,
    activeShifts,
    tenant,
  ] = await Promise.all([
    prisma.ticket.count({
      where: { tenantId, createdAt: { gte: sevenDaysAgo } },
    }),
    prisma.ticket.count({
      where: { tenantId, status: "SYNC_FAILED" },
    }),
    prisma.ticket.count({
      where: { tenantId, emailFailedAt: { not: null } },
    }),
    prisma.store.count({
      where: { tenantId, deletedAt: null },
    }),
    prisma.shift.count({
      where: { register: { store: { tenantId } }, closedAt: null },
    }),
    prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { lastIncrementalSyncAt: true, blockedAt: true },
    }),
  ]);
  let state: DegradedState = "ok";
  if (tenant.blockedAt != null) state = "blocked";
  else if (ticketsSyncFailed > 0 || ticketsEmailFailed > 0) state = "warning";
  return {
    ticketsLast7d,
    ticketsSyncFailed,
    ticketsEmailFailed,
    storesCount,
    activeShifts,
    degraded: {
      state,
      lastIncrementalSyncAt: tenant.lastIncrementalSyncAt?.toISOString() ?? null,
    },
  };
}

export async function registerSuperAdminTenantsRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ── Lista de tenants con métricas ────────────────────────────────────
  app.get(
    "/super-admin/tenants",
    {
      preHandler: requireSuperAdmin,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            q: { type: "string", maxLength: 200 },
            status: { type: "string", enum: ["ok", "warning", "blocked"] },
            sort: { type: "string", enum: ["createdAt", "name", "ticketsLast7d"] },
            order: { type: "string", enum: ["asc", "desc"], default: "desc" },
            page: { type: "integer", minimum: 1, default: 1 },
            pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    async (request) => {
      const query = request.query as {
        q?: string;
        status?: DegradedState;
        sort?: "createdAt" | "name" | "ticketsLast7d";
        order?: "asc" | "desc";
        page?: number;
        pageSize?: number;
      };
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 20;
      const sort = query.sort ?? "createdAt";
      const order = query.order ?? "desc";

      const prisma = getPrisma();

      const where: Prisma.TenantWhereInput = {};
      if (query.q && query.q.trim().length > 0) {
        const q = query.q.trim();
        where.OR = [
          { name: { contains: q, mode: "insensitive" } },
          {
            users: {
              some: { email: { contains: q.toLowerCase() } },
            },
          },
        ];
      }
      if (query.status === "blocked") {
        where.blockedAt = { not: null };
      } else if (query.status === "ok" || query.status === "warning") {
        where.blockedAt = null;
      }

      const orderBy: Prisma.TenantOrderByWithRelationInput =
        sort === "createdAt"
          ? { createdAt: order }
          : sort === "name"
            ? { name: order }
            : { createdAt: order }; // ticketsLast7d se computa, se ordena en cliente.

      const [total, rows] = await Promise.all([
        prisma.tenant.count({ where }),
        prisma.tenant.findMany({
          where,
          orderBy,
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            users: {
              // El cajero técnico es MANAGER — descartamos por flag.
              where: { role: "OWNER", deletedAt: null, isTestCashier: false },
              orderBy: { createdAt: "asc" },
              take: 1,
              select: { email: true, lastLoginAt: true },
            },
          },
        }),
      ]);

      const items = await Promise.all(
        rows.map(async (t) => {
          const metrics = await computeMetrics(prisma, t.id);
          // En listado calculamos `ready` para que la UI pinte el badge
          // "Listo para activar" en los DRAFT que ya pasan la heurística.
          const onboardingReady =
            t.onboardingState === "DRAFT"
              ? (await computeOnboardingHealth(prisma, t.id)).ready
              : null;
          return {
            id: t.id,
            name: t.name,
            fiscalNif: fiscalNifFromProfile(t.fiscalProfile),
            ownerEmail: t.users[0]?.email ?? null,
            ownerLastLoginAt: t.users[0]?.lastLoginAt?.toISOString() ?? null,
            holdedConnected: t.holdedApiKeyCiphertext != null,
            createdAt: t.createdAt.toISOString(),
            blockedAt: t.blockedAt?.toISOString() ?? null,
            blockedReason: t.blockedReason,
            plan: t.plan,
            onboardingState: t.onboardingState,
            onboardingReady,
            businessType: t.businessType,
            metrics,
          };
        }),
      );

      // Filtrado post-cómputo por warning (no se puede en SQL sin un join
      // costoso): si status==='warning' filtramos por el estado computado.
      const filtered =
        query.status === "warning"
          ? items.filter((i) => i.metrics.degraded.state === "warning")
          : items;

      return {
        items: filtered,
        page,
        pageSize,
        total,
      };
    },
  );

  // ── Detalle de tenant ────────────────────────────────────────────────
  app.get(
    "/super-admin/tenants/:id",
    {
      preHandler: requireSuperAdmin,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const prisma = getPrisma();
      const tenant = await prisma.tenant.findUnique({
        where: { id },
        include: {
          users: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              email: true,
              role: true,
              lastLoginAt: true,
              twoFactorEnabledAt: true,
              mustChangePasswordAt: true,
              isTestCashier: true,
              deletedAt: true,
            },
          },
          stores: {
            where: { deletedAt: null },
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              name: true,
              fiscalAddress: true,
              ticketDelivery: true,
            },
          },
        },
      });
      if (!tenant) {
        return reply.code(404).send({
          error: "TENANT_NOT_FOUND",
          message: "Tenant no existe",
        });
      }
      const metrics = await computeMetrics(prisma, tenant.id);
      // B-OnboardingV2: la salud del onboarding sólo tiene sentido en
      // tenants DRAFT — un ACTIVE ya pasó el filtro. Calculamos en
      // ambos pero el front sólo lo pinta en DRAFT.
      const onboardingHealth = await computeOnboardingHealth(prisma, tenant.id);
      const ownerUser = tenant.users.find((u) => u.role === "OWNER") ?? null;
      return {
        id: tenant.id,
        name: tenant.name,
        fiscalProfile: tenant.fiscalProfile,
        fiscalNif: fiscalNifFromProfile(tenant.fiscalProfile),
        plan: tenant.plan,
        onboardingState: tenant.onboardingState,
        businessType: tenant.businessType,
        // v1.3-Thalia Lote 6 · pie de ticket libre para mostrarlo en el
        // modal de edición. NULL = sin pie custom (default).
        receiptFooter: tenant.receiptFooter,
        holdedConnected: tenant.holdedApiKeyCiphertext != null,
        holdedAuthMode: tenant.holdedAuthMode,
        initialSyncStatus: tenant.initialSyncStatus,
        lastIncrementalSyncAt:
          tenant.lastIncrementalSyncAt?.toISOString() ?? null,
        createdAt: tenant.createdAt.toISOString(),
        blockedAt: tenant.blockedAt?.toISOString() ?? null,
        blockedReason: tenant.blockedReason,
        ownerEmail: ownerUser?.email ?? null,
        users: tenant.users
          // No exponer al cajero técnico al super-admin como si fuera
          // un usuario real — sale en el panel de modo prueba aparte.
          .filter((u) => !u.isTestCashier && u.deletedAt == null)
          .map((u) => ({
            id: u.id,
            email: u.email,
            role: u.role,
            lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
            twoFactorEnabled: u.twoFactorEnabledAt != null,
            mustChangePassword: u.mustChangePasswordAt != null,
          })),
        stores: tenant.stores.map((s) => ({
          id: s.id,
          name: s.name,
          fiscalAddress: s.fiscalAddress,
          ticketDelivery: s.ticketDelivery,
        })),
        metrics,
        onboardingHealth,
      };
    },
  );

  // ── Crear tenant DRAFT sólo con API key Holded (B-OnboardingV2) ─────
  //
  // Reemplaza al POST viejo que pedía razón social/NIF/dirección a mano.
  // Ahora el super-admin sólo introduce la API key + (opcionalmente)
  // taxId. Validamos la key contra Holded (GET /invoicing/v1/warehouses),
  // extraemos los datos fiscales del almacén default y persistimos un
  // Tenant DRAFT sin OWNER user. Encolamos el sync inicial.
  //
  // Nota: Holded NO expone endpoint público de "account info" (spike
  // §08). Caemos al fallback documentado: leer el warehouse default
  // para razón social/dirección y, si el super-admin lo conoce, pedir
  // el taxId como input mínimo.
  app.post(
    "/super-admin/tenants",
    {
      preHandler: requireSuperAdmin,
      schema: {
        body: {
          type: "object",
          required: ["holdedApiKey"],
          additionalProperties: false,
          properties: {
            holdedApiKey: { type: "string", minLength: 10, maxLength: 512 },
            // Opcional: si el super-admin lo conoce, lo introduce
            // manualmente para arrancar la operativa fiscal completa.
            // Si no se pasa, fiscalProfile.taxId queda null y el
            // propietario lo completará tras activar.
            taxId: { type: "string", minLength: 1, maxLength: 32 },
            // Opcional: forzar razón social si la del almacén default
            // no coincide con la legal.
            legalName: { type: "string", minLength: 1, maxLength: 200 },
            plan: { type: "string", maxLength: 32 },
            // B-Multi-Vertical: vertical operativo del tenant. Si no se
            // pasa, default RETAIL (ver schema.prisma). El super-admin
            // puede editarlo después desde el detalle.
            businessType: {
              type: "string",
              enum: ["HOSPITALITY", "RETAIL", "SERVICES"],
            },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        holdedApiKey: string;
        taxId?: string;
        legalName?: string;
        plan?: string;
        businessType?: "HOSPITALITY" | "RETAIL" | "SERVICES";
      };
      const ctx = request.superAdmin!;
      const env = loadEnv();
      const prisma = getPrisma();

      // 1. Validar taxId si viene.
      let normalizedTaxId: string | null = null;
      if (body.taxId !== undefined) {
        const result = validateSpanishTaxId(body.taxId);
        if (!result.valid) {
          return reply.code(400).send({
            error: "INVALID_HOLDED_FISCAL_PROFILE",
            message:
              "El identificador fiscal introducido no es un NIF/NIE/CIF válido.",
          });
        }
        normalizedTaxId = body.taxId.toUpperCase().replace(/[-\s]/g, "");
      }

      // 2. Validar la API key contra Holded vía /warehouses. El spike
      //    §08 confirmó que NO existe endpoint de "account info"; el
      //    almacén default es la mejor fuente de datos fiscales que
      //    la API por API Key ofrece (legalName desde `name`, address
      //    estructurada). Lo usamos también como prueba de vida de la
      //    key (igual que el probe legacy hace contra /products).
      const client = new ApiKeyClient(body.holdedApiKey, {
        baseUrl: env.HOLDED_BASE_URL,
      });
      let warehouses: HoldedWarehouse[];
      try {
        warehouses = await listWarehouses(client);
      } catch (err) {
        if (
          err instanceof HoldedApiError &&
          (err.status === 401 || err.status === 403)
        ) {
          return reply.code(400).send({
            error: "HOLDED_API_KEY_INVALID",
            message: "Holded rechaza la API Key. Genera una nueva y reintenta.",
          });
        }
        if (err instanceof HoldedSubscriptionSuspendedError) {
          return reply.code(400).send({
            error: "HOLDED_SUSPENDED",
            message:
              "La cuenta Holded está suspendida por impago. Regulariza el pago y reintenta.",
          });
        }
        if (err instanceof HoldedInvalidResponseError) {
          return reply.code(502).send({
            error: "HOLDED_INVALID_RESPONSE",
            message:
              "Holded ha devuelto una respuesta no-JSON. Es posible que estén con incidencia.",
          });
        }
        request.log.error(
          { event: "super_admin.create_tenant_holded_failed", err },
          "Validación de API Holded falló en POST /super-admin/tenants",
        );
        return reply.code(502).send({
          error: "HOLDED_UNREACHABLE",
          message: "No hemos podido contactar con Holded. Reintenta en unos minutos.",
        });
      }

      // 3. Construir fiscalProfile desde el warehouse default (ver spike §08).
      const def = warehouses.find((w) => w.default) ?? warehouses[0] ?? null;
      const derivedLegalName =
        body.legalName ?? (def?.name && def.name.trim().length > 0 ? def.name : null);
      if (!derivedLegalName) {
        return reply.code(400).send({
          error: "INVALID_HOLDED_FISCAL_PROFILE",
          message:
            "No hemos podido extraer una razón social de Holded. Crea un almacén con nombre en la cuenta Holded del cliente o introduce `legalName` manualmente.",
        });
      }
      const fiscalProfile: Record<string, unknown> = {
        legalName: derivedLegalName,
        nif: normalizedTaxId,
        taxId: normalizedTaxId,
        address: def?.address ?? null,
        source: "super_admin_draft",
        warehouseHoldedId: def?.id ?? null,
        updatedAt: new Date().toISOString(),
      };

      // 4. Unicidad opcional por taxId (sólo si lo conocemos). El campo
      //    `fiscalProfile` es Json — usamos $queryRaw para chequear sin
      //    arrastrar un index nuevo. Best-effort; si falla por entorno
      //    (sqlite en tests), lo capturamos y seguimos.
      if (normalizedTaxId) {
        try {
          const collisions = await prisma.$queryRaw<Array<{ id: string }>>`
            SELECT id::text AS id FROM tenants
            WHERE fiscal_profile ->> 'taxId' = ${normalizedTaxId}
            LIMIT 1
          `;
          if (collisions.length > 0) {
            return reply.code(409).send({
              error: "TENANT_NIF_TAKEN",
              message: "Ya existe un tenant con ese identificador fiscal.",
            });
          }
        } catch (err) {
          request.log.warn(
            { event: "super_admin.create_tenant_nif_check_skipped", err },
            "comprobación de unicidad por taxId omitida (entorno sin JSON path)",
          );
        }
      }

      // 5. Crear Tenant DRAFT + cifrar API key + audit.
      const ciphertext = encryptSecret(
        body.holdedApiKey,
        env.HOLDED_KEY_ENCRYPTION_SECRET,
      );
      const created = await prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            name: derivedLegalName,
            holdedAuthMode: "API_KEY",
            holdedApiKeyCiphertext: ciphertext,
            plan: body.plan ?? "pilot",
            fiscalProfile: fiscalProfile as Prisma.InputJsonValue,
            onboardingState: "DRAFT",
            initialSyncStatus: "PENDING",
            // B-Multi-Vertical: si no viene en el body, el default
            // del schema (RETAIL) se aplica automáticamente.
            ...(body.businessType ? { businessType: body.businessType } : {}),
          },
        });
        const signals = extractRequestSignals(request);
        await writeAudit({
          prisma: tx,
          superAdminId: ctx.superAdminId,
          action: "create_tenant_draft",
          tenantId: tenant.id,
          metadata: {
            ...signals,
            tenantName: tenant.name,
            fiscalNif: normalizedTaxId ?? "",
            source: def ? "holded_account" : "manual",
          },
        });
        return tenant;
      });

      // 6. Encolar sync inicial. Si Redis está caído, devolvemos 503 —
      //    el tenant queda creado y el super-admin puede reintentar
      //    desde la consola con "Re-sync".
      try {
        await enqueueInitialSync(created.id);
      } catch (err) {
        request.log.error(
          { event: "super_admin.create_tenant_enqueue_failed", tenantId: created.id, err },
          "no se pudo encolar initial-sync tras crear el tenant",
        );
        return reply.code(503).send({
          error: "QUEUE_UNAVAILABLE",
          message: "Tenant creado pero el sync no se pudo programar. Reintenta desde Re-sync.",
          tenant: serializeDraftTenant(created),
        });
      }

      return reply.code(201).send({
        tenant: serializeDraftTenant(created),
        syncJobId: `tenant-${created.id}`,
      });
    },
  );

  // ── Editar tenant (datos básicos y/o plan) ──────────────────────────
  app.patch(
    "/super-admin/tenants/:id",
    {
      preHandler: requireSuperAdmin,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 200 },
            plan: { type: "string", maxLength: 32 },
            fiscalProfile: {
              type: "object",
              additionalProperties: true,
              properties: {
                legalName: { type: "string", maxLength: 200 },
                // T-6a (v1.1 Thalia): acepta `nif` (legacy) y `taxId`
                // (alias, lo que build.ts mira al construir el ticket).
                // Si llega `taxId`, lo persistimos en AMBAS claves para
                // que el ticket y el listado coincidan.
                nif: { type: "string", minLength: 1, maxLength: 32 },
                taxId: { type: "string", minLength: 1, maxLength: 32 },
                address: { type: "string", maxLength: 300 },
                phone: { type: "string", maxLength: 32 },
              },
            },
            // B-Multi-Vertical: el super-admin puede cambiar el
            // vertical de un tenant existente (p. ej. si Thalia
            // se creó como RETAIL pero quisiéramos forzar HOSPITALITY).
            businessType: {
              type: "string",
              enum: ["HOSPITALITY", "RETAIL", "SERVICES"],
            },
            // v1.3-Thalia Lote 6 · pie de ticket libre. 200 caracteres
            // máx para no descuajeringar el ticket 80mm (~5 líneas).
            // Aceptamos string vacío y lo persistimos como NULL para
            // que "limpiar el pie" desde la UI funcione sin endpoint
            // adicional.
            receiptFooter: { type: "string", maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        name?: string;
        plan?: string;
        fiscalProfile?: {
          legalName?: string;
          nif?: string;
          taxId?: string;
          address?: string;
          phone?: string;
        };
        businessType?: "HOSPITALITY" | "RETAIL" | "SERVICES";
        receiptFooter?: string;
      };
      const ctx = request.superAdmin!;
      const prisma = getPrisma();

      const tenant = await prisma.tenant.findUnique({ where: { id } });
      if (!tenant) {
        return reply.code(404).send({
          error: "TENANT_NOT_FOUND",
          message: "Tenant no existe",
        });
      }

      // Validar NIF/taxId nuevo si cambia (T-6a: aceptamos cualquiera
      // de los dos nombres; tras validar, normalizamos a uppercase y
      // persistimos en ambos para coherencia ticket↔listado).
      const incomingTaxId =
        body.fiscalProfile?.taxId ?? body.fiscalProfile?.nif;
      let normalizedTaxId: string | undefined;
      if (incomingTaxId !== undefined) {
        const result = validateSpanishTaxId(incomingTaxId);
        if (!result.valid) {
          return reply.code(400).send({
            error: "INVALID_FISCAL_NIF",
            message: "El identificador fiscal no es válido.",
          });
        }
        normalizedTaxId = incomingTaxId.toUpperCase().replace(/[-\s]/g, "");
      }

      // Validar name unique si cambia.
      if (body.name && body.name !== tenant.name) {
        const exists = await prisma.tenant.findFirst({
          where: { name: body.name, id: { not: id } },
        });
        if (exists) {
          return reply.code(409).send({
            error: "TENANT_NAME_TAKEN",
            message: "Ya existe otro tenant con ese nombre.",
          });
        }
      }

      // Construir diff para audit.
      const changes: Record<string, { before: unknown; after: unknown }> = {};
      const data: Prisma.TenantUpdateInput = {};
      if (body.name !== undefined && body.name !== tenant.name) {
        changes.name = { before: tenant.name, after: body.name };
        data.name = body.name;
      }
      if (body.plan !== undefined && body.plan !== tenant.plan) {
        changes.plan = { before: tenant.plan, after: body.plan };
        data.plan = body.plan;
      }
      if (body.fiscalProfile !== undefined) {
        const current =
          tenant.fiscalProfile && typeof tenant.fiscalProfile === "object" && !Array.isArray(tenant.fiscalProfile)
            ? (tenant.fiscalProfile as Record<string, unknown>)
            : {};
        const merged: Record<string, unknown> = { ...current };
        for (const [k, v] of Object.entries(body.fiscalProfile)) {
          if (v !== undefined) merged[k] = v;
        }
        // T-6a: si llegó taxId o nif validado, lo persistimos en ambas
        // claves. Razón: fiscalNifFromProfile lee `taxId ?? nif ?? fiscalNif`
        // y build.ts del ticket lee `taxId`. Tener ambos evita pintar el
        // NIF en el listado pero NO en el ticket por una discrepancia
        // entre quien guardó qué nombre.
        if (normalizedTaxId !== undefined) {
          merged.taxId = normalizedTaxId;
          merged.nif = normalizedTaxId;
        }
        merged.updatedAt = new Date().toISOString();
        merged.source = "super_admin_update";
        changes.fiscalProfile = { before: current, after: merged };
        data.fiscalProfile = merged as Prisma.InputJsonValue;
      }
      if (body.businessType !== undefined && body.businessType !== tenant.businessType) {
        changes.businessType = { before: tenant.businessType, after: body.businessType };
        data.businessType = body.businessType;
      }
      if (body.receiptFooter !== undefined) {
        // String vacío → NULL (limpiar el pie). Trim para evitar guardar
        // espacios accidentales que el cajero notaría como línea muda.
        const trimmed = body.receiptFooter.trim();
        const nextValue = trimmed === "" ? null : trimmed;
        if (nextValue !== tenant.receiptFooter) {
          changes.receiptFooter = { before: tenant.receiptFooter, after: nextValue };
          data.receiptFooter = nextValue;
        }
      }

      if (Object.keys(changes).length === 0) {
        return reply.code(200).send({ noChanges: true });
      }

      const updated = await prisma.$transaction(async (tx) => {
        const u = await tx.tenant.update({ where: { id }, data });
        const signals = extractRequestSignals(request);
        await writeAudit({
          prisma: tx,
          superAdminId: ctx.superAdminId,
          action: "update_tenant",
          tenantId: id,
          metadata: { ...signals, changes },
        });
        return u;
      });

      return reply.code(200).send({
        tenant: {
          id: updated.id,
          name: updated.name,
          plan: updated.plan,
          fiscalProfile: updated.fiscalProfile,
        },
      });
    },
  );

  // ── Bloquear / desbloquear tenant ──────────────────────────────────
  app.patch(
    "/super-admin/tenants/:id/status",
    {
      preHandler: requireSuperAdmin,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["blocked"],
          additionalProperties: false,
          properties: {
            blocked: { type: "boolean" },
            reason: { type: "string", maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { blocked, reason } = request.body as { blocked: boolean; reason?: string };
      const ctx = request.superAdmin!;
      const prisma = getPrisma();
      const tenant = await prisma.tenant.findUnique({ where: { id } });
      if (!tenant) {
        return reply.code(404).send({
          error: "TENANT_NOT_FOUND",
          message: "Tenant no existe",
        });
      }
      const signals = extractRequestSignals(request);

      if (blocked) {
        if (!reason || reason.trim().length === 0) {
          return reply.code(400).send({
            error: "REASON_REQUIRED",
            message: "Bloquear un tenant requiere indicar la razón.",
          });
        }
        const updated = await prisma.$transaction(async (tx) => {
          const u = await tx.tenant.update({
            where: { id },
            data: { blockedAt: new Date(), blockedReason: reason },
          });
          await writeAudit({
            prisma: tx,
            superAdminId: ctx.superAdminId,
            action: "block_tenant",
            tenantId: id,
            metadata: {
              ...signals,
              reason,
              blockedAt: u.blockedAt!.toISOString(),
            },
          });
          return u;
        });
        return reply.code(200).send({
          blocked: true,
          blockedAt: updated.blockedAt?.toISOString(),
          blockedReason: updated.blockedReason,
        });
      }

      // Desbloquear: preserva la razón previa en el audit log.
      const previousReason = tenant.blockedReason;
      await prisma.$transaction(async (tx) => {
        await tx.tenant.update({
          where: { id },
          data: { blockedAt: null, blockedReason: null },
        });
        await writeAudit({
          prisma: tx,
          superAdminId: ctx.superAdminId,
          action: "unblock_tenant",
          tenantId: id,
          metadata: { ...signals, previousReason },
        });
      });
      return reply.code(200).send({ blocked: false });
    },
  );

  // ── Force logout: bumpea tokenVersion de TODOS los users del tenant ─
  app.post(
    "/super-admin/tenants/:id/force-logout",
    {
      preHandler: requireSuperAdmin,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const ctx = request.superAdmin!;
      const prisma = getPrisma();
      const tenant = await prisma.tenant.findUnique({ where: { id } });
      if (!tenant) {
        return reply.code(404).send({
          error: "TENANT_NOT_FOUND",
          message: "Tenant no existe",
        });
      }
      const signals = extractRequestSignals(request);
      const result = await prisma.$transaction(async (tx) => {
        const r = await tx.user.updateMany({
          where: { tenantId: id },
          data: { tokenVersion: { increment: 1 } },
        });
        await writeAudit({
          prisma: tx,
          superAdminId: ctx.superAdminId,
          action: "force_logout",
          tenantId: id,
          metadata: { ...signals, usersAffected: r.count },
        });
        return r;
      });
      return reply.code(200).send({ usersAffected: result.count });
    },
  );

  // ── Resync manual ────────────────────────────────────────────────────
  app.post(
    "/super-admin/tenants/:id/resync",
    {
      preHandler: requireSuperAdmin,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const ctx = request.superAdmin!;
      const prisma = getPrisma();
      const tenant = await prisma.tenant.findUnique({
        where: { id },
        select: { id: true, holdedApiKeyCiphertext: true },
      });
      if (!tenant) {
        return reply.code(404).send({
          error: "TENANT_NOT_FOUND",
          message: "Tenant no existe",
        });
      }
      if (!tenant.holdedApiKeyCiphertext) {
        return reply.code(409).send({
          error: "NO_HOLDED_KEY",
          message: "Este tenant aún no ha conectado Holded.",
        });
      }
      const job = await enqueueManualSync(id);
      const signals = extractRequestSignals(request);
      await writeAudit({
        prisma,
        superAdminId: ctx.superAdminId,
        action: "resync",
        tenantId: id,
        metadata: { ...signals, syncJobId: job.jobId },
      });
      return reply.code(202).send({ syncJobId: job.jobId });
    },
  );

  // ── Impersonate read-only ────────────────────────────────────────────
  app.post(
    "/super-admin/tenants/:id/impersonate",
    {
      preHandler: requireSuperAdmin,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const ctx = request.superAdmin!;
      const prisma = getPrisma();
      const tenant = await prisma.tenant.findUnique({
        where: { id },
        include: {
          users: {
            where: { role: "OWNER" },
            orderBy: { createdAt: "asc" },
            take: 1,
          },
        },
      });
      if (!tenant) {
        return reply.code(404).send({
          error: "TENANT_NOT_FOUND",
          message: "Tenant no existe",
        });
      }
      const owner = tenant.users[0];
      if (!owner) {
        return reply.code(409).send({
          error: "NO_OWNER",
          message: "El tenant no tiene OWNER al que impersonar.",
        });
      }
      const env = loadEnv();
      // Parsear TTL para construir expiresAt accurate para audit.
      const ttlStr = env.SUPER_ADMIN_IMPERSONATION_TTL;
      const ttlSec = parseTtl(ttlStr);
      const expiresAt = new Date(Date.now() + ttlSec * 1000);

      const token = signImpersonationToken({
        sub: owner.id,
        tid: tenant.id,
        tv: owner.tokenVersion,
        by: ctx.superAdminId,
      });
      const signals = extractRequestSignals(request);
      await writeAudit({
        prisma,
        superAdminId: ctx.superAdminId,
        action: "impersonate",
        tenantId: tenant.id,
        metadata: {
          ...signals,
          expiresAt: expiresAt.toISOString(),
          asUserId: owner.id,
        },
      });
      return reply.code(200).send({
        impersonationToken: token,
        expiresAt: expiresAt.toISOString(),
        tenant: { id: tenant.id, name: tenant.name },
        owner: { id: owner.id, email: owner.email },
      });
    },
  );

  // ── Rotar API key Holded del tenant (B-OnboardingV2 · Frente 7) ─────
  //
  // Antes B2: PATCH /auth/me/rotate-holded-key (OWNER per-tenant).
  // Tras B-OnboardingV2: la rotación es responsabilidad del super-admin
  // — el propietario no ve la API key, ni la gestión técnica de la
  // integración. Esta ruta valida la key contra Holded antes de
  // sobreescribir el ciphertext; si falla, la antigua se mantiene
  // intacta.
  app.patch(
    "/super-admin/tenants/:id/holded-api-key",
    {
      preHandler: requireSuperAdmin,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["holdedApiKey"],
          additionalProperties: false,
          properties: {
            holdedApiKey: { type: "string", minLength: 10, maxLength: 512 },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { holdedApiKey } = request.body as { holdedApiKey: string };
      const ctx = request.superAdmin!;
      const env = loadEnv();
      const prisma = getPrisma();
      const tenant = await prisma.tenant.findUnique({
        where: { id },
        select: { id: true, name: true },
      });
      if (!tenant) {
        return reply.code(404).send({
          error: "TENANT_NOT_FOUND",
          message: "Tenant no existe",
        });
      }
      const client = new ApiKeyClient(holdedApiKey, {
        baseUrl: env.HOLDED_BASE_URL,
      });
      try {
        await listWarehouses(client);
      } catch (err) {
        if (
          err instanceof HoldedApiError &&
          (err.status === 401 || err.status === 403)
        ) {
          return reply.code(400).send({
            error: "HOLDED_API_KEY_INVALID",
            message: "Holded rechaza la API Key. Genera una nueva y reintenta.",
          });
        }
        if (err instanceof HoldedSubscriptionSuspendedError) {
          return reply.code(400).send({
            error: "HOLDED_SUSPENDED",
            message: "La cuenta Holded está suspendida por impago.",
          });
        }
        if (err instanceof HoldedInvalidResponseError) {
          return reply.code(502).send({
            error: "HOLDED_INVALID_RESPONSE",
            message: "Holded ha devuelto una respuesta no-JSON.",
          });
        }
        request.log.error(
          { event: "super_admin.rotate_holded_key_failed", tenantId: id, err },
          "Rotación de API key Holded falló",
        );
        return reply.code(502).send({
          error: "HOLDED_UNREACHABLE",
          message: "No hemos podido contactar con Holded.",
        });
      }
      const ciphertext = encryptSecret(holdedApiKey, env.HOLDED_KEY_ENCRYPTION_SECRET);
      await prisma.tenant.update({
        where: { id },
        data: {
          holdedApiKeyCiphertext: ciphertext,
          holdedAuthMode: "API_KEY",
        },
      });
      const signals = extractRequestSignals(request);
      // Audit como "update_tenant" con el campo `holdedApiKey: rotated`
      // (no persistimos la clave en metadata, sólo señalamos la rotación).
      await writeAudit({
        prisma,
        superAdminId: ctx.superAdminId,
        action: "update_tenant",
        tenantId: id,
        metadata: {
          ...signals,
          changes: {
            holdedApiKey: { before: "<redacted>", after: "<rotated>" },
          },
        },
      });
      return reply.code(200).send({ ok: true, validatedAt: new Date().toISOString() });
    },
  );

  // ── Probar TPV: emitir JWT cashier técnico + device token ───────────
  //
  // Frente 5 del prompt B-OnboardingV2. Disponible sólo para tenants
  // DRAFT (un tenant ACTIVE ya tiene OWNER y operación real — no
  // queremos contaminar). El token viene en pareja: el JWT cashier
  // session (purpose=test-cashier) y el deviceToken del device interno
  // que provisionamos en el sync inicial. El TPV los recibe en query
  // params, los guarda en sessionStorage y arranca directo en modo
  // logged-in con shift abierto.
  app.post(
    "/super-admin/tenants/:id/test-cashier-token",
    {
      preHandler: requireSuperAdmin,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const ctx = request.superAdmin!;
      const prisma = getPrisma();
      const tenant = await prisma.tenant.findUnique({
        where: { id },
        select: { id: true, onboardingState: true, name: true },
      });
      if (!tenant) {
        return reply.code(404).send({
          error: "TENANT_NOT_FOUND",
          message: "Tenant no existe",
        });
      }
      if (tenant.onboardingState !== "DRAFT") {
        return reply.code(409).send({
          error: "TENANT_NOT_DRAFT",
          message:
            "Sólo se puede probar el TPV mientras el tenant está en DRAFT.",
        });
      }
      const result = await issueTestCashierSession(prisma, id);
      const signals = extractRequestSignals(request);
      await writeAudit({
        prisma,
        superAdminId: ctx.superAdminId,
        action: "test_cashier_session",
        tenantId: id,
        metadata: {
          ...signals,
          expiresAt: result.expiresAt.toISOString(),
          registerId: result.resources.registerId,
          storeName: result.resources.storeName,
        },
      });
      return reply.code(200).send({
        cashierSessionToken: result.cashierSessionToken,
        deviceToken: result.deviceToken,
        expiresAt: result.expiresAt.toISOString(),
        tenant: { id: tenant.id, name: tenant.name },
        register: {
          id: result.resources.registerId,
          name: result.resources.registerName,
        },
        store: {
          id: result.resources.storeId,
          name: result.resources.storeName,
        },
        shiftId: result.shiftId,
      });
    },
  );

  // ── Activar tenant: crear OWNER, mandar email, purgar pruebas ───────
  //
  // Frente 6 del prompt B-OnboardingV2. Valida health=ready, crea el
  // OWNER user con password temporal, transiciona el tenant a ACTIVE y
  // borra los rastros del modo prueba. Devolvemos la tempPassword una
  // sola vez para que el super-admin la copie al cliente offline si el
  // email no llegara.
  app.post(
    "/super-admin/tenants/:id/activate",
    {
      preHandler: requireSuperAdmin,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["ownerEmail", "ownerName"],
          additionalProperties: false,
          properties: {
            ownerEmail: { type: "string", pattern: emailFormat, maxLength: 320 },
            ownerName: { type: "string", minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { ownerEmail: string; ownerName: string };
      const ctx = request.superAdmin!;
      const prisma = getPrisma();

      const tenant = await prisma.tenant.findUnique({
        where: { id },
        select: { id: true, onboardingState: true, name: true },
      });
      if (!tenant) {
        return reply.code(404).send({
          error: "TENANT_NOT_FOUND",
          message: "Tenant no existe",
        });
      }
      if (tenant.onboardingState !== "DRAFT") {
        return reply.code(409).send({
          error: "TENANT_NOT_DRAFT",
          message: "Sólo los tenants DRAFT pueden activarse.",
        });
      }
      const health = await computeOnboardingHealth(prisma, id);
      if (!health.ready) {
        const failing = health.readinessChecks
          .filter((c) => !c.ok)
          .map((c) => c.label);
        return reply.code(400).send({
          error: "ONBOARDING_NOT_READY",
          message: "El tenant no pasa las comprobaciones de salud.",
          failing,
        });
      }
      const lowerEmail = body.ownerEmail.toLowerCase();
      const emailTaken = await prisma.user.findUnique({
        where: { email: lowerEmail },
        select: { id: true },
      });
      if (emailTaken) {
        return reply.code(409).send({
          error: "EMAIL_TAKEN",
          message: "Ya existe un usuario con ese email.",
        });
      }

      const tempPassword = generateTemporaryPassword();
      const passwordHash = await hashPassword(tempPassword);
      const signals = extractRequestSignals(request);

      const activated = await prisma.$transaction(async (tx) => {
        const owner = await tx.user.create({
          data: {
            tenantId: id,
            email: lowerEmail,
            passwordHash,
            role: "OWNER",
            mustChangePasswordAt: new Date(),
          },
          select: { id: true, email: true },
        });
        const purge = await purgeTestData(tx, id);
        const t = await tx.tenant.update({
          where: { id },
          data: { onboardingState: "ACTIVE" },
        });
        await writeAudit({
          prisma: tx,
          superAdminId: ctx.superAdminId,
          action: "activate_tenant",
          tenantId: id,
          metadata: {
            ...signals,
            ownerEmail: owner.email,
            ownerName: body.ownerName,
            ticketsTestPurged: purge.ticketsTestPurged,
            emailJobsPurged: purge.emailJobsPurged,
          },
        });
        return { owner, tenant: t, purge };
      });

      try {
        await sendOwnerWelcomeEmail({
          ownerEmail: activated.owner.email,
          ownerName: body.ownerName,
          tempPassword,
        });
      } catch (err) {
        request.log.error(
          { event: "super_admin.activate_email_failed", tenantId: id, err },
          "Email de bienvenida falló al activar — temporal visible en response",
        );
      }

      return reply.code(200).send({
        tenant: {
          id: activated.tenant.id,
          name: activated.tenant.name,
          onboardingState: activated.tenant.onboardingState,
        },
        owner: {
          id: activated.owner.id,
          email: activated.owner.email,
          name: body.ownerName,
        },
        tempPassword,
        purge: activated.purge,
      });
    },
  );

  // ── Audit log global ─────────────────────────────────────────────────
  app.get(
    "/super-admin/audit",
    {
      preHandler: requireSuperAdmin,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            action: { type: "string", maxLength: 40 },
            superAdminId: { type: "string", format: "uuid" },
            tenantId: { type: "string", format: "uuid" },
            from: { type: "string", format: "date-time" },
            to: { type: "string", format: "date-time" },
            page: { type: "integer", minimum: 1, default: 1 },
            pageSize: { type: "integer", minimum: 1, maximum: 200, default: 50 },
          },
        },
      },
    },
    async (request) => {
      const q = request.query as {
        action?: SuperAdminAction;
        superAdminId?: string;
        tenantId?: string;
        from?: string;
        to?: string;
        page?: number;
        pageSize?: number;
      };
      const page = q.page ?? 1;
      const pageSize = q.pageSize ?? 50;
      const prisma = getPrisma();
      const where: Prisma.SuperAdminAuditWhereInput = {};
      if (q.action) where.action = q.action;
      if (q.superAdminId) where.superAdminId = q.superAdminId;
      if (q.tenantId) where.tenantId = q.tenantId;
      if (q.from || q.to) {
        where.createdAt = {};
        if (q.from) where.createdAt.gte = new Date(q.from);
        if (q.to) where.createdAt.lte = new Date(q.to);
      }
      const [total, rows] = await Promise.all([
        prisma.superAdminAudit.count({ where }),
        prisma.superAdminAudit.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            superAdmin: { select: { email: true } },
          },
        }),
      ]);
      return {
        items: rows.map((r) => ({
          id: r.id,
          action: r.action,
          tenantId: r.tenantId,
          superAdminId: r.superAdminId,
          superAdminEmail: r.superAdmin.email,
          metadata: r.metadata,
          createdAt: r.createdAt.toISOString(),
        })),
        page,
        pageSize,
        total,
      };
    },
  );
}

// Parsea un TTL estilo JWT ("15m", "30m", "1h") a segundos. Defensivo:
// si no parsea, devuelve 30 min.
function parseTtl(ttl: string): number {
  const m = ttl.match(/^(\d+)([smhd])$/);
  if (!m) return 30 * 60;
  const n = parseInt(m[1]!, 10);
  const u = m[2]!;
  if (u === "s") return n;
  if (u === "m") return n * 60;
  if (u === "h") return n * 60 * 60;
  if (u === "d") return n * 24 * 60 * 60;
  return 30 * 60;
}

