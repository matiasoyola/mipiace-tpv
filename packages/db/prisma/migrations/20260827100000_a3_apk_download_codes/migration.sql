-- A3-distribución · códigos de descarga de la APK.
--
-- Migración ADITIVA: una tabla nueva que no existía y que nadie lee todavía.
-- Sin backfill (nace vacía), sin cambios en tablas existentes, sin tocar el
-- camino de cobro. El rollback de código NO necesita rollback de esquema: si
-- se revierte A3, la tabla se queda ahí sin filas y sin lectores.
--
-- Timestamp `20260827100000`: posterior a `20260827000000_v1_12_mesas_abandonadas`,
-- que entra por D2. Las dos son aditivas e independientes, así que el orden de
-- merge entre ramas da igual.
--
-- El binario de la APK NO vive aquí ni en el repo: está en RELEASES_DIR del
-- VPS (/opt/mipiacetpv/releases, montado read-only). Esta tabla sólo guarda el
-- permiso para descargarlo.

-- CreateTable
CREATE TABLE "apk_download_codes" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "version_code" INTEGER NOT NULL,
    "created_by_super_admin_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "max_downloads" INTEGER NOT NULL DEFAULT 3,
    "download_count" INTEGER NOT NULL DEFAULT 0,
    "last_download_ip" TEXT,
    "last_download_at" TIMESTAMPTZ,
    "note" TEXT,

    CONSTRAINT "apk_download_codes_pkey" PRIMARY KEY ("id")
);

-- El código es de 6 dígitos: el unique es global (no por tenant) porque la
-- página /apk es pública y no conoce ningún tenant cuando lo valida. La
-- generación reintenta ante colisión y purga los caducados, igual que
-- pairing_codes (apps/api/src/devices/routes.ts).
CREATE UNIQUE INDEX "apk_download_codes_code_key" ON "apk_download_codes"("code");

-- Barrido de caducados en la generación.
CREATE INDEX "apk_download_codes_expires_at_idx" ON "apk_download_codes"("expires_at");

-- Listado de códigos activos por versión en la consola.
CREATE INDEX "apk_download_codes_version_code_idx" ON "apk_download_codes"("version_code");

-- FK dura al super-admin emisor, pero SIN relación Prisma: no queremos una
-- back-relation en SuperAdminUser por una tabla periférica (mismo criterio que
-- `appointment_items_service_id_fkey`). RESTRICT espeja a super_admin_audits:
-- el borrado de super-admins es soft-delete precisamente para preservar el
-- histórico, así que un DELETE real debe chocar aquí igual que allí.
ALTER TABLE "apk_download_codes"
    ADD CONSTRAINT "apk_download_codes_created_by_super_admin_id_fkey"
    FOREIGN KEY ("created_by_super_admin_id") REFERENCES "super_admin_users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
