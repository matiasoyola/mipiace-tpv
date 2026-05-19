-- B-Multi-Vertical SB4 · campo `name` en SuperAdminUser
--
-- Necesario para que el panel de gestión de super-admins liste y
-- muestre nombres legibles en vez de sólo el local-part del email.
-- Nullable temporalmente para no romper rows existentes (el único
-- super-admin actual es m.oyola@mipiace.es). El backfill defensivo
-- usa split_part(email, '@', 1) para que el listado no muestre "—".
-- Cuando un super-admin invita a otro vía POST /super-admin/admins,
-- `name` se introduce obligatoriamente.

ALTER TABLE "super_admin_users" ADD COLUMN "name" VARCHAR(100);

UPDATE "super_admin_users"
SET "name" = split_part("email", '@', 1)
WHERE "name" IS NULL;

-- Soft-delete: para conservar histórico de auditoría sin perder la
-- referencia, no borramos rows — marcamos `deleted_at`. El listado
-- de super-admins filtra por `deleted_at IS NULL`.
ALTER TABLE "super_admin_users" ADD COLUMN "deleted_at" TIMESTAMPTZ;

-- Marca `must_change_password` para los super-admins recién invitados
-- (creados con password temporal). Cuando el invitado entra por primera
-- vez, el front fuerza el cambio antes de emitir sesión real.
ALTER TABLE "super_admin_users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
