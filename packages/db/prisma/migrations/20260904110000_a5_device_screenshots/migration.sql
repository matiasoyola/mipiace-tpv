-- A5 · metadatos de las capturas de pantalla de un terminal.
--
-- Migración ADITIVA: tabla nueva, nace vacía, nadie la leía antes. El rollback
-- de código no necesita rollback de esquema.
--
-- El PNG no está aquí: vive en DEVICE_SCREENSHOT_DIR (un volumen del VPS),
-- igual que los informes Z. Aquí está lo que hace defendible tomarlo: quién lo
-- pidió, por qué, y hasta cuándo existe.
--
-- `expires_at` son 24 h. Es una foto de la pantalla de un TPV con datos de
-- clientes: si hace falta otra, se pide otra.

-- CreateTable
CREATE TABLE "device_screenshots" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "requested_by_super_admin_id" UUID NOT NULL,
    "command_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "device_screenshots_pkey" PRIMARY KEY ("id")
);

-- Listado por terminal en el panel.
CREATE INDEX "device_screenshots_device_id_created_at_idx"
    ON "device_screenshots"("device_id", "created_at");

-- El barrido del worker: busca por caducidad y borra fichero + fila.
CREATE INDEX "device_screenshots_expires_at_idx" ON "device_screenshots"("expires_at");

-- CASCADE: un terminal borrado no deja capturas suyas colgando. El fichero lo
-- barre el worker por caducidad de todos modos.
ALTER TABLE "device_screenshots"
    ADD CONSTRAINT "device_screenshots_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "devices"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- FK dura al super-admin que la pidió, sin back-relation en Prisma (mismo
-- criterio que apk_download_codes). RESTRICT espeja a super_admin_audits: el
-- borrado de super-admins es soft-delete para preservar el histórico.
ALTER TABLE "device_screenshots"
    ADD CONSTRAINT "device_screenshots_requested_by_super_admin_id_fkey"
    FOREIGN KEY ("requested_by_super_admin_id") REFERENCES "super_admin_users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
