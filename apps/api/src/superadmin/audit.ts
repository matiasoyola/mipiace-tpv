import { z } from "zod";

import { Prisma, type PrismaClient } from "@mipiacetpv/db";

// Contrato del campo `metadata` de SuperAdminAudit por acción.
// Todos los shapes llevan `ipAddress` y `userAgent` extraídos de la
// request del super-admin. Si la metadata no encaja con el schema, la
// escritura falla (preferimos perder la auditoría de una operación
// concreta a persistir basura).

const Base = z.object({
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
});

const CreateTenantMeta = Base.extend({
  tenantName: z.string(),
  ownerEmail: z.string(),
  plan: z.string().nullable(),
  fiscalNif: z.string(),
});

const UpdateTenantMeta = Base.extend({
  changes: z.record(
    z.object({
      before: z.unknown(),
      after: z.unknown(),
    }),
  ),
});

const BlockTenantMeta = Base.extend({
  reason: z.string(),
  blockedAt: z.string(),
});

const UnblockTenantMeta = Base.extend({
  previousReason: z.string().nullable(),
});

const ForceLogoutMeta = Base.extend({
  usersAffected: z.number().int().nonnegative(),
});

const ResyncMeta = Base.extend({
  syncJobId: z.string(),
});

const ImpersonateMeta = Base.extend({
  expiresAt: z.string(),
  asUserId: z.string(),
});

const META_SCHEMAS = {
  create_tenant: CreateTenantMeta,
  update_tenant: UpdateTenantMeta,
  block_tenant: BlockTenantMeta,
  unblock_tenant: UnblockTenantMeta,
  force_logout: ForceLogoutMeta,
  resync: ResyncMeta,
  impersonate: ImpersonateMeta,
} as const;

export type SuperAdminAction = keyof typeof META_SCHEMAS;

export type AuditMetadata<A extends SuperAdminAction> = z.infer<
  (typeof META_SCHEMAS)[A]
>;

export interface AuditWriteParams<A extends SuperAdminAction> {
  prisma: PrismaClient | Prisma.TransactionClient;
  superAdminId: string;
  action: A;
  tenantId: string | null;
  metadata: AuditMetadata<A>;
}

export async function writeAudit<A extends SuperAdminAction>(
  params: AuditWriteParams<A>,
): Promise<void> {
  const schema = META_SCHEMAS[params.action];
  const parsed = schema.safeParse(params.metadata);
  if (!parsed.success) {
    throw new Error(
      `Audit metadata inválida para ${params.action}: ${parsed.error.message}`,
    );
  }
  await params.prisma.superAdminAudit.create({
    data: {
      superAdminId: params.superAdminId,
      action: params.action,
      tenantId: params.tenantId,
      metadata: parsed.data as unknown as Prisma.InputJsonValue,
    },
  });
}

// Extrae IP / UA de la request del super-admin. Útil para construir
// metadata sin repetir el snippet en cada handler.
export interface RequestSignals {
  ipAddress: string | null;
  userAgent: string | null;
}

export function extractRequestSignals(req: {
  headers: Record<string, unknown>;
  ip?: string;
}): RequestSignals {
  const fwd = req.headers["x-forwarded-for"];
  let ip: string | null = null;
  if (typeof fwd === "string" && fwd.length > 0) {
    ip = fwd.split(",")[0]!.trim();
  } else if (req.ip) {
    ip = req.ip;
  }
  const ua = req.headers["user-agent"];
  const userAgent =
    typeof ua === "string" && ua.length > 0 ? ua.slice(0, 500) : null;
  return { ipAddress: ip, userAgent };
}
