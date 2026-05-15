-- B-SuperAdmin · panel multi-tenant operativo
--
-- Crea:
--   - super_admin_users: identidad super-admin ortogonal a `users`.
--   - super_admin_audits: auditoría de cada acción super-admin.
-- Y añade al modelo per-tenant existente, sin afectar sesiones vivas:
--   - users.must_change_password_at: fuerza el cambio de password en
--     el primer login de OWNERs creados desde la consola super-admin.
--   - tenants.blocked_at / blocked_reason: bloqueo global de tenant.
--     Cuando blocked_at NOT NULL, todas las requests per-tenant
--     reciben 423 Locked (middleware requireTenantNotBlocked).
--   - tenants.plan: string libre, gestionado a mano por super-admin.
--
-- Sin backfill: las columnas nuevas nacen NULL y el flujo existente
-- se mantiene exactamente igual hasta que un super-admin las cambie.

-- ── Per-tenant: cambios aditivos en columnas existentes ────────────
ALTER TABLE "users" ADD COLUMN "must_change_password_at" TIMESTAMPTZ;

ALTER TABLE "tenants" ADD COLUMN "blocked_at" TIMESTAMPTZ;
ALTER TABLE "tenants" ADD COLUMN "blocked_reason" TEXT;
ALTER TABLE "tenants" ADD COLUMN "plan" TEXT;

-- ── Super-admin: tablas nuevas ─────────────────────────────────────
CREATE TABLE "super_admin_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "totp_secret" TEXT,
    "totp_enabled_at" TIMESTAMPTZ,
    "recovery_codes" JSONB,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "super_admin_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "super_admin_users_email_key" ON "super_admin_users"("email");

CREATE TABLE "super_admin_audits" (
    "id" UUID NOT NULL,
    "super_admin_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "tenant_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "super_admin_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "super_admin_audits_super_admin_id_created_at_idx"
    ON "super_admin_audits"("super_admin_id", "created_at");
CREATE INDEX "super_admin_audits_tenant_id_created_at_idx"
    ON "super_admin_audits"("tenant_id", "created_at");
CREATE INDEX "super_admin_audits_action_created_at_idx"
    ON "super_admin_audits"("action", "created_at");

-- onDelete: Restrict. La auditoría es histórico legal — no se borra
-- al borrar un super-admin (que tampoco se contempla por ahora).
ALTER TABLE "super_admin_audits"
    ADD CONSTRAINT "super_admin_audits_super_admin_id_fkey"
    FOREIGN KEY ("super_admin_id") REFERENCES "super_admin_users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
