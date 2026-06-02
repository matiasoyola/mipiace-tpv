-- v1.4-Impresoras-Fase-1 Lote 1 · PrinterConfig.
--
-- Tras el spike 2026-06-02 (Peluquería Sole + POS-80 V6.16F) llegamos
-- a la conclusión de que la impresión real requiere ESC/POS plano
-- generado por el backend, no PDF rasterizado por RawBT. El siguiente
-- paso es modelar la(s) impresora(s) configuradas por register para
-- que el implantador pueda darlas de alta desde el panel admin.
--
-- USB:  la impresora va enchufada por OTG a la tablet del cajero. El
--       binario ESC/POS lo manda el navegador con WebUSB API. Sólo
--       guardamos `name`, `section`, `active` — la pareja vendor/product/
--       serial del USB se guarda en localStorage del navegador.
-- WIFI: la impresora vive en la LAN (típico HOSPITALITY, varias por
--       sección). Guardamos ip + port + timeout y el backend abre TCP
--       a `ip:port` (9100 ESC/POS raw).
--
-- `lastPrintOkAt` y `lastErrorAt` permiten al admin mostrar en una
-- columna de estado si la impresora va bien, ha fallado el último
-- intento o nunca se ha usado.

CREATE TYPE "PrinterMode" AS ENUM ('USB', 'WIFI');

CREATE TABLE "printer_configs" (
    "id"                UUID NOT NULL,
    "register_id"       UUID NOT NULL,
    "name"              TEXT NOT NULL,
    "mode"              "PrinterMode" NOT NULL,
    "ip_address"        TEXT,
    "port"              INTEGER DEFAULT 9100,
    "timeout_ms"        INTEGER NOT NULL DEFAULT 5000,
    "section"           "KitchenSection",
    "active"            BOOLEAN NOT NULL DEFAULT true,
    "last_print_ok_at"  TIMESTAMPTZ,
    "last_error_at"     TIMESTAMPTZ,
    "last_error_msg"    TEXT,
    "created_at"        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "printer_configs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "printer_configs_register_id_idx"
    ON "printer_configs"("register_id");

CREATE INDEX "printer_configs_section_idx"
    ON "printer_configs"("section");

ALTER TABLE "printer_configs"
    ADD CONSTRAINT "printer_configs_register_id_fkey"
    FOREIGN KEY ("register_id") REFERENCES "registers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
