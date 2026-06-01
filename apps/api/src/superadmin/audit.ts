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

// B-OnboardingV2: tenant creado sólo con API key Holded, en estado
// DRAFT. Sin OWNER user todavía — el email del propietario se introduce
// más tarde al activar.
const CreateTenantDraftMeta = Base.extend({
  tenantName: z.string(),
  fiscalNif: z.string(),
  // v1.3-SuperAdmin-Hub Lote 3: persistimos el id de la cuenta Holded
  // que pasó el implantador al crear, para que el log de auditoría
  // sirva como historial cuando luego haya que reconciliar errores
  // (tenant creado con id equivocado, etc.).
  holdedAccountId: z.string(),
  source: z.enum(["holded_account", "manual"]),
});

// B-OnboardingV2: super-admin pulsó "Probar TPV", emisión del JWT
// test-cashier (24h, sin refresh).
const TestCashierSessionMeta = Base.extend({
  expiresAt: z.string(),
  registerId: z.string(),
  storeName: z.string(),
});

// B-OnboardingV2: tenant activado. Crea OWNER user, manda email, purga
// los datos de prueba. Una transición irreversible — no hay vuelta a
// DRAFT (eso es block + crear tenant nuevo).
const ActivateTenantMeta = Base.extend({
  ownerEmail: z.string(),
  ownerName: z.string(),
  ticketsTestPurged: z.number().int().nonnegative(),
  emailJobsPurged: z.number().int().nonnegative(),
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
  // v1.3-SuperAdmin-Hub Lote 1: distinguimos sesión readonly (verla)
  // de sesión full (configurarla en nombre del cliente). Opcional para
  // no romper la lectura del histórico previo al lote.
  mode: z.enum(["readonly", "full"]).optional(),
});

// v1.3-SuperAdmin-Hub Lote 1: traza por cada mutación ejecutada en
// modo impersonate=full. El middleware la escribe antes de ejecutar el
// handler — si el handler falla con 500 el audit queda igualmente, que
// es exactamente lo que queremos para investigar después.
const ImpersonateWriteMeta = Base.extend({
  route: z.string(),
  method: z.string(),
  // Resumen del body cuando sirve para entender la acción (e.g.
  // { fields: ["receiptFooter"] }). Estructura libre — preferimos un
  // hint corto antes que persistir el body en claro (puede llevar PII).
  payloadSummary: z.record(z.unknown()).nullable().optional(),
});

// B-Multi-Vertical SB4: super-admin invitado por otro super-admin.
const CreateSuperAdminMeta = Base.extend({
  targetEmail: z.string(),
  targetName: z.string(),
  targetSuperAdminId: z.string().uuid(),
});

// B-Multi-Vertical SB4: super-admin soft-deleted por otro super-admin.
const DeleteSuperAdminMeta = Base.extend({
  targetEmail: z.string(),
  targetSuperAdminId: z.string().uuid(),
});

// v1.2-Lite Lote 2: root reenvía invitación (regenera tempPassword,
// invalida tokens previos del target). Útil cuando el email original
// se pierde en spam o el SMTP cayó.
const ResendSuperAdminInviteMeta = Base.extend({
  targetEmail: z.string(),
  targetSuperAdminId: z.string().uuid(),
});

// v1.3-Operativa-Extra · Lote 3: super-admin lanzó dedupe de tags en
// products.tags (unifica "papelería"/"papeleria" al lowercase sin
// acentos). Sirve para distinguir entre cambios manuales del tenant y
// limpiezas masivas iniciadas desde la consola.
const DedupeTagsMeta = Base.extend({
  productsScanned: z.number().int().nonnegative(),
  productsUpdated: z.number().int().nonnegative(),
  duplicatesRemoved: z.number().int().nonnegative(),
});

// v1.3-piloto-feedback · Lote 2: super-admin cambió el email del OWNER
// activo de un tenant (modelo "activar con email controlado y entregar
// al cliente real luego"). previousEmail/newEmail dejan trazabilidad de
// a quién pertenecía la cuenta y a quién pasa.
const TransferOwnerMeta = Base.extend({
  previousEmail: z.string(),
  newEmail: z.string(),
  newName: z.string(),
  passwordReset: z.boolean(),
});

const META_SCHEMAS = {
  create_tenant: CreateTenantMeta,
  create_tenant_draft: CreateTenantDraftMeta,
  update_tenant: UpdateTenantMeta,
  block_tenant: BlockTenantMeta,
  unblock_tenant: UnblockTenantMeta,
  force_logout: ForceLogoutMeta,
  resync: ResyncMeta,
  impersonate: ImpersonateMeta,
  impersonate_write: ImpersonateWriteMeta,
  test_cashier_session: TestCashierSessionMeta,
  activate_tenant: ActivateTenantMeta,
  create_super_admin: CreateSuperAdminMeta,
  delete_super_admin: DeleteSuperAdminMeta,
  resend_super_admin_invite: ResendSuperAdminInviteMeta,
  dedupe_tags: DedupeTagsMeta,
  transfer_owner: TransferOwnerMeta,
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
