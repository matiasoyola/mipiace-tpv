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
  // H1 · con qué se dio de alta la empresa. Opcionales para no invalidar
  // los audit logs escritos antes del bloque, que no los llevan.
  usesHolded: z.boolean().optional(),
  // catalogo-local (addendum 3) · si la empresa nació con el interruptor
  // de Holded apagado. Distinto de `usesHolded`, que dice si el
  // implantador pegó la clave EN EL ALTA: un tenant normal nace sin
  // clave y con el interruptor encendido. Opcional por lo mismo que su
  // vecina — los audit logs anteriores al bloque no la llevan.
  holdedEnabled: z.boolean().optional(),
  modules: z
    .object({
      caja: z.boolean(),
      crm: z.boolean(),
      agenda: z.boolean(),
      // F1 · el cuarto módulo. Opcional por lo mismo que sus vecinas: los
      // audit logs escritos antes de este bloque no lo llevan, y una
      // auditoría vieja no debe invalidarse porque el producto crezca.
      fichaje: z.boolean().optional(),
    })
    .optional(),
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
  // H1 · si el OWNER nació también como cajero del TPV. Opcional para no
  // invalidar los audit logs escritos antes del bloque.
  cashierPinIssued: z.boolean().optional(),
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

// Bloque soporte-cajeros-superadmin: el super-admin consultó la lista
// de cajeros de un tenant desde la ficha. Es lectura pura (el PIN no
// sale), pero es un acceso a datos de un cliente y se audita como tal.
// `cashiersReturned` sirve para distinguir de un vistazo la consulta de
// soporte normal del barrido masivo.
const ViewTenantCashiersMeta = Base.extend({
  cashiersReturned: z.number().int().nonnegative(),
});

// A3-distribución: super-admin emite un código de instalación de 6 dígitos
// para descargar la APK desde mipiacetpv.com/apk.
const CreateApkDownloadCodeMeta = Base.extend({
  versionCode: z.number().int().positive(),
  code: z.string().length(6),
  expiresAt: z.string(),
  maxDownloads: z.number().int().positive(),
  note: z.string().nullable(),
});

// A3-distribución: intento de descarga contra un código EXISTENTE. La traza
// se atribuye al super-admin que lo emitió (`createdBySuperAdminId`): la
// descarga no es anónima, es la consecuencia de su acto. `tenantId` es null
// — un APK no pertenece a ningún tenant.
//
// Los códigos INEXISTENTES no llegan aquí: no hay a quién atribuirlos, así
// que se quedan en log estructurado + contador del rate-limiter por IP.
const ApkDownloadMeta = Base.extend({
  versionCode: z.number().int().positive(),
  code: z.string().length(6),
  result: z.enum(["ok", "caducado", "agotado"]),
});

// A5 · comando enviado a un terminal. Se escribe ANTES de mandarlo: sin
// registro no hay comando. `motivo` es obligatorio — un comando sin motivo no
// se puede revisar seis meses después, que es cuando se revisa.
const DeviceCommandMeta = Base.extend({
  deviceId: z.string().uuid(),
  commandId: z.string().uuid(),
  accion: z.enum([
    "recargar",
    "volcar-logs",
    "captura-de-pantalla",
    "forzar-sync",
    "reiniciar-app",
    "decir-version",
  ]),
  motivo: z.string().min(1).max(300),
});

// A5 · lo que contestó el terminal. Va en su propia traza porque el resultado
// llega hasta 25 s después: con una sola escrita al final, un comando que no
// vuelve —el que hay que investigar— no dejaría rastro ninguno.
const DeviceCommandResultMeta = Base.extend({
  deviceId: z.string().uuid(),
  commandId: z.string().uuid(),
  accion: z.string(),
  resultado: z.enum(["ok", "error", "sin-respuesta"]),
});

// A5 · alguien intentó mandar algo que no está en la lista blanca. No sale del
// servidor, pero se registra: el intento es justo lo que hay que poder ver.
const DeviceCommandRejectedMeta = Base.extend({
  deviceId: z.string().uuid(),
  accionSolicitada: z.string().max(120),
  motivo: z.string(),
});

// A5 · captura de la pantalla de un terminal. Es una foto de un TPV con datos
// de clientes dentro: cada una deja traza propia, con quién la pidió, por qué,
// y cuándo se borra.
const DeviceScreenshotMeta = Base.extend({
  deviceId: z.string().uuid(),
  commandId: z.string().uuid(),
  screenshotId: z.string().uuid(),
  motivo: z.string().min(1).max(300),
  bytes: z.number().int().nonnegative(),
  expiresAt: z.string(),
});

// A5 · alguien abrió una captura guardada. Mirar la foto es un acceso nuevo a
// esos datos, distinto de haberla pedido, y se registra como tal.
const DeviceScreenshotViewedMeta = Base.extend({
  deviceId: z.string().uuid(),
  screenshotId: z.string().uuid(),
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
  view_tenant_cashiers: ViewTenantCashiersMeta,
  create_apk_download_code: CreateApkDownloadCodeMeta,
  apk_download: ApkDownloadMeta,
  device_command: DeviceCommandMeta,
  device_command_result: DeviceCommandResultMeta,
  device_command_rejected: DeviceCommandRejectedMeta,
  device_screenshot: DeviceScreenshotMeta,
  device_screenshot_viewed: DeviceScreenshotViewedMeta,
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
