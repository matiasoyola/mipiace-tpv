-- A5 · acceso remoto · la última instantánea de cada terminal.
--
-- Migración ADITIVA: una tabla nueva que nace vacía y que nadie leía antes.
-- Sin backfill, sin cambios en tablas existentes, sin tocar el camino de
-- cobro. El rollback de código NO necesita rollback de esquema: si se
-- revierte A5, la tabla se queda ahí sin lectores y los terminales dejan de
-- escribirla.
--
-- Timestamp `20260904100000`: posterior a `20260827100000_a3_apk_download_codes`.
-- Es aditiva e independiente de cualquier otra rama en vuelo, así que el orden
-- de merge da igual.
--
-- UNA fila por device, sobreescrita en cada latido. No es un histórico a
-- propósito (ver el comentario del modelo en schema.prisma): lo único que hace
-- falta del pasado es `outbox_stuck_since`, que el servidor arrastra.

-- CreateTable
CREATE TABLE "device_heartbeats" (
    "device_id" UUID NOT NULL,
    "reported_at" TIMESTAMPTZ NOT NULL,
    "bundle_build_hash" TEXT,
    "bundle_target" TEXT,
    "platform" TEXT,
    "app_version_name" TEXT,
    "app_version_code" INTEGER,
    "shift_open" BOOLEAN NOT NULL DEFAULT false,
    "shift_opened_at" TIMESTAMPTZ,
    "outbox_pending" INTEGER NOT NULL DEFAULT 0,
    "outbox_rejected" INTEGER NOT NULL DEFAULT 0,
    "outbox_stuck_since" TIMESTAMPTZ,
    "network" TEXT,
    "local_ip" TEXT,
    "device_time" TIMESTAMPTZ,
    "clock_skew_seconds" INTEGER,
    "booted_at" TIMESTAMPTZ,

    CONSTRAINT "device_heartbeats_pkey" PRIMARY KEY ("device_id")
);

-- 1:1 con devices y CASCADE: un device borrado no deja instantánea huérfana.
-- La PK es la propia FK, así que no hace falta índice aparte ni unique extra.
ALTER TABLE "device_heartbeats"
    ADD CONSTRAINT "device_heartbeats_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "devices"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
