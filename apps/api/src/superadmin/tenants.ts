import type { FastifyInstance } from "fastify";

import { Prisma } from "@mipiacetpv/db";
import {
  generateTemporaryPassword,
  validateSpanishTaxId,
} from "@mipiacetpv/util-validation";

import { hashPassword } from "../auth/passwords.js";
import { getPrisma } from "../context.js";
import { loadEnv } from "../env.js";
import { enqueueManualSync } from "../queues/catalog-incremental.js";

import {
  extractRequestSignals,
  writeAudit,
  type SuperAdminAction,
} from "./audit.js";
import { requireSuperAdmin } from "./middleware.js";
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
  const nif = obj.nif ?? obj.fiscalNif;
  return typeof nif === "string" ? nif : null;
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
              where: { role: "OWNER" },
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
      const ownerUser = tenant.users.find((u) => u.role === "OWNER") ?? null;
      return {
        id: tenant.id,
        name: tenant.name,
        fiscalProfile: tenant.fiscalProfile,
        fiscalNif: fiscalNifFromProfile(tenant.fiscalProfile),
        plan: tenant.plan,
        holdedConnected: tenant.holdedApiKeyCiphertext != null,
        holdedAuthMode: tenant.holdedAuthMode,
        initialSyncStatus: tenant.initialSyncStatus,
        lastIncrementalSyncAt:
          tenant.lastIncrementalSyncAt?.toISOString() ?? null,
        createdAt: tenant.createdAt.toISOString(),
        blockedAt: tenant.blockedAt?.toISOString() ?? null,
        blockedReason: tenant.blockedReason,
        ownerEmail: ownerUser?.email ?? null,
        users: tenant.users.map((u) => ({
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
      };
    },
  );

  // ── Crear tenant + OWNER en transacción + email + audit ─────────────
  app.post(
    "/super-admin/tenants",
    {
      preHandler: requireSuperAdmin,
      schema: {
        body: {
          type: "object",
          required: ["name", "fiscalNif", "ownerEmail", "ownerName"],
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 200 },
            fiscalNif: { type: "string", minLength: 1, maxLength: 32 },
            fiscalAddress: { type: "string", maxLength: 300 },
            ownerEmail: { type: "string", pattern: emailFormat, maxLength: 320 },
            ownerName: { type: "string", minLength: 1, maxLength: 200 },
            plan: { type: "string", maxLength: 32 },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        name: string;
        fiscalNif: string;
        fiscalAddress?: string;
        ownerEmail: string;
        ownerName: string;
        plan?: string;
      };
      const ctx = request.superAdmin!;
      const prisma = getPrisma();

      // 1. Validar NIF/CIF/NIE.
      const nifResult = validateSpanishTaxId(body.fiscalNif);
      if (!nifResult.valid) {
        return reply.code(400).send({
          error: "INVALID_FISCAL_NIF",
          message: "El identificador fiscal no es válido (NIF/NIE/CIF español).",
        });
      }

      const lowerEmail = body.ownerEmail.toLowerCase();

      // 2. Comprobar unicidad fuera de la transacción (rápido fallar).
      const [existingUser, existingTenant] = await Promise.all([
        prisma.user.findUnique({ where: { email: lowerEmail } }),
        prisma.tenant.findFirst({ where: { name: body.name } }),
      ]);
      if (existingUser) {
        return reply.code(409).send({
          error: "EMAIL_TAKEN",
          message: "Ya existe un usuario con ese email.",
        });
      }
      if (existingTenant) {
        return reply.code(409).send({
          error: "TENANT_NAME_TAKEN",
          message: "Ya existe un tenant con ese nombre.",
        });
      }

      // 3. Generar password temporal + hash.
      const tempPassword = generateTemporaryPassword();
      const passwordHash = await hashPassword(tempPassword);

      // 4. Transacción atómica.
      const created = await prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            name: body.name,
            holdedAuthMode: "API_KEY",
            plan: body.plan ?? "pilot",
            fiscalProfile: {
              legalName: body.name,
              nif: body.fiscalNif.toUpperCase().replace(/[-\s]/g, ""),
              address: body.fiscalAddress ?? null,
              source: "super_admin_create",
              updatedAt: new Date().toISOString(),
            } as Prisma.InputJsonValue,
          },
        });
        const owner = await tx.user.create({
          data: {
            tenantId: tenant.id,
            email: lowerEmail,
            passwordHash,
            role: "OWNER",
            mustChangePasswordAt: new Date(),
          },
        });
        const signals = extractRequestSignals(request);
        await writeAudit({
          prisma: tx,
          superAdminId: ctx.superAdminId,
          action: "create_tenant",
          tenantId: tenant.id,
          metadata: {
            ...signals,
            tenantName: tenant.name,
            ownerEmail: owner.email,
            plan: tenant.plan,
            fiscalNif: body.fiscalNif.toUpperCase().replace(/[-\s]/g, ""),
          },
        });
        return { tenant, owner };
      });

      // 5. Email al OWNER. Si falla, NO revertimos la transacción —
      //    el tenant queda creado y el front muestra la tempPassword en
      //    pantalla por si el email no llegó. Loguemos el error.
      try {
        await sendOwnerWelcomeEmail({
          ownerEmail: created.owner.email,
          ownerName: body.ownerName,
          tempPassword,
        });
      } catch (err) {
        request.log.error(
          { event: "super_admin.welcome_email_failed", tenantId: created.tenant.id, err },
          "Email de bienvenida falló — la temporal queda visible en la response",
        );
      }

      return reply.code(201).send({
        tenant: {
          id: created.tenant.id,
          name: created.tenant.name,
          plan: created.tenant.plan,
          fiscalNif: fiscalNifFromProfile(created.tenant.fiscalProfile),
        },
        ownerEmail: created.owner.email,
        tempPassword, // ← devolvemos en plano UNA vez (no se loguea)
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
                nif: { type: "string", minLength: 1, maxLength: 32 },
                address: { type: "string", maxLength: 300 },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        name?: string;
        plan?: string;
        fiscalProfile?: { legalName?: string; nif?: string; address?: string };
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

      // Validar NIF nuevo si cambia.
      if (body.fiscalProfile?.nif !== undefined) {
        const result = validateSpanishTaxId(body.fiscalProfile.nif);
        if (!result.valid) {
          return reply.code(400).send({
            error: "INVALID_FISCAL_NIF",
            message: "El identificador fiscal no es válido.",
          });
        }
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
        merged.updatedAt = new Date().toISOString();
        merged.source = "super_admin_update";
        changes.fiscalProfile = { before: current, after: merged };
        data.fiscalProfile = merged as Prisma.InputJsonValue;
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

