-- B7 · Vertical bar (mesas + multi-terminal).
--
-- 1. Nuevo enum TableZone (SALON/TERRAZA/BARRA/RESERVADO).
-- 2. Nuevo modelo `tables` con autorrelación para agrupación. El estado
--    (libre / ocupada / cobrando) NO se persiste — se deriva en runtime
--    de la presencia de un Ticket DRAFT apuntando a la mesa.
-- 3. Campos en `tickets` para enlazar con la mesa (`table_id`),
--    rastrear absorciones (`original_table_id`) y guardar comensales.
-- 4. Campo `original_table_id` en `ticket_lines` para reversibilidad
--    del desagrupar (cada línea recuerda de qué mesa venía).
--
-- El estado de mesa NO se persiste para evitar drift entre dos fuentes
-- de verdad. El TPV consulta `tickets` con `table_id = X AND status =
-- 'DRAFT'` para saber si la mesa X está abierta.

-- 1. Enum TableZone
CREATE TYPE "TableZone" AS ENUM ('SALON', 'TERRAZA', 'BARRA', 'RESERVADO');

-- 2. Tabla `tables`
CREATE TABLE "tables" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 2,
    "zone" "TableZone" NOT NULL DEFAULT 'SALON',
    "position_x" INTEGER,
    "position_y" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "bar_seat_index" INTEGER,
    "grouped_into_table_id" UUID,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tables_pkey" PRIMARY KEY ("id")
);

-- Nombre único por tienda (M1, B3, "Reservado 2"). Se valida también
-- al crear desde el admin para devolver 409 limpio.
CREATE UNIQUE INDEX "tables_store_id_name_key" ON "tables"("store_id", "name");
CREATE INDEX "tables_store_id_zone_idx" ON "tables"("store_id", "zone");
CREATE INDEX "tables_grouped_into_table_id_idx" ON "tables"("grouped_into_table_id");

ALTER TABLE "tables" ADD CONSTRAINT "tables_store_id_fkey"
    FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tables" ADD CONSTRAINT "tables_grouped_into_table_id_fkey"
    FOREIGN KEY ("grouped_into_table_id") REFERENCES "tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Campos en `tickets`
ALTER TABLE "tickets"
    ADD COLUMN "table_id" UUID,
    ADD COLUMN "original_table_id" UUID,
    ADD COLUMN "diners" INTEGER;

ALTER TABLE "tickets" ADD CONSTRAINT "tickets_table_id_fkey"
    FOREIGN KEY ("table_id") REFERENCES "tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Índice para resolver el estado de mesa: dado un table_id, encontrar
-- el ticket DRAFT activo. También sirve para "mostrar tickets de esta
-- mesa históricos" en el futuro.
CREATE INDEX "tickets_table_id_status_idx" ON "tickets"("table_id", "status");

-- 4. Campo en `ticket_lines` para revertir agrupaciones.
ALTER TABLE "ticket_lines"
    ADD COLUMN "original_table_id" UUID;
