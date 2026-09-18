-- B-reservas-7a · El horario del centro.
--
-- El TECHO de la agenda. Hasta este bloque la disponibilidad salía SÓLO de
-- los turnos del personal (`staff_shifts` → `store.getTemplateSlots`): si
-- nadie definía turno el centro no abría, y si alguien lo definía de par en
-- par el centro abría de par en par. Un festivo había que bloquearlo a mano,
-- día a día, con un `booking_blocks scope=CENTER`.
--
-- Migración ADITIVA con backfill VACÍO. Las dos tablas nacen sin filas y la
-- columna nueva nace con su default histórico:
--
--   * center_hours          — la semana tipo del centro. Varias filas por día
--                             = horario partido. Hora de PARED, como
--                             `staff_shifts`. weekday ISO-8601 (1=lunes).
--   * center_days           — los días especiales: o cierre con nombre, o un
--                             horario propio de ese día con nombre. SUSTITUYE
--                             al horario semanal, no se suma.
--   * tenants.agenda_slot_minutes — la retícula del centro: 15 (el valor
--                             histórico de B4) o 30.
--
-- Un tenant que no toque nada de esto se comporta EXACTAMENTE como antes de
-- este bloque: cero filas ⇒ sin techo, y la retícula sigue siendo 15. Los
-- tests de B3, B4, B-5 y 6a siguen verdes SIN tocarlos, y ésa es la prueba.
--
-- NO se toca `staff_shifts` (D-3 del cruce), ni el anti-solape (los EXCLUDE
-- USING gist de `appointment_assignments`), ni nada del camino de cobro.

-- AlterTable · la retícula del centro.
-- El CHECK de los valores permitidos va AQUÍ, en la base de datos, y no sólo
-- en el schema de la ruta: es la última línea de defensa contra un 20 que
-- dejaría al front y al motor calculando inicios distintos.
ALTER TABLE "tenants"
    ADD COLUMN "agenda_slot_minutes" INTEGER NOT NULL DEFAULT 15;

ALTER TABLE "tenants"
    ADD CONSTRAINT "tenants_agenda_slot_minutes_check"
    CHECK ("agenda_slot_minutes" IN (15, 30));

-- CreateTable · la semana tipo del centro.
CREATE TABLE "center_hours" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    -- ISO-8601: 1 = lunes … 7 = domingo.
    "weekday" INTEGER NOT NULL,
    -- Hora de PARED "HH:MM" en el huso del centro (Europe/Madrid, CENTER_TZ).
    -- Mismo patrón que `staff_shifts.start_time`: sin conversión, sin huso
    -- por fila. No hay columna de huso por tenant a propósito (6a §2.2): los
    -- crons y el corte de día van con Madrid y dos verdades serían peor.
    "open_time" TEXT NOT NULL,
    "close_time" TEXT NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_until" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "center_hours_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "center_hours_weekday_check"
        CHECK ("weekday" BETWEEN 1 AND 7),
    -- Una franja que acaba antes de empezar no recorta: abre el día entero.
    -- La comparación de texto "HH:MM" es la misma que hace el motor en
    -- minutos desde medianoche mientras el formato esté fijado.
    CONSTRAINT "center_hours_range_check"
        CHECK ("open_time" < "close_time"),
    CONSTRAINT "center_hours_validity_check"
        CHECK ("valid_until" IS NULL OR "valid_until" >= "valid_from")
);

-- CreateTable · los días especiales.
CREATE TABLE "center_days" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    -- true  = cerrado ese día, con nombre ("Virgen del Prado").
    -- false = horario propio de ese día, con nombre ("boda Marta").
    "closed" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,
    "open_time" TEXT,
    "close_time" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "center_days_pkey" PRIMARY KEY ("id"),
    -- El nombre NO es opcional: es lo que la rejilla dice en voz alta
    -- ("Cerrado · Virgen del Prado"). Un festivo sin nombre deja a la
    -- cajera explicándole a la clienta un día en blanco.
    CONSTRAINT "center_days_name_check"
        CHECK (btrim("name") <> ''),
    -- Cerrado ⇒ sin horas. Abierto ⇒ con las dos y ordenadas. Un día
    -- "abierto" sin horas sería un día que no se sabe si abre.
    CONSTRAINT "center_days_shape_check"
        CHECK (
          ("closed" AND "open_time" IS NULL AND "close_time" IS NULL)
          OR (NOT "closed" AND "open_time" IS NOT NULL
              AND "close_time" IS NOT NULL AND "open_time" < "close_time")
        )
);

-- CreateIndex · multi-tenant por fila, índice por tenant en las dos.
CREATE INDEX "center_hours_tenant_id_idx" ON "center_hours"("tenant_id");
CREATE INDEX "center_hours_tenant_id_weekday_idx" ON "center_hours"("tenant_id", "weekday");
CREATE INDEX "center_days_tenant_id_idx" ON "center_days"("tenant_id");

-- Un solo día especial por fecha y centro: si hubiera dos, "sustituye al
-- horario semanal" dejaría de tener un significado único.
CREATE UNIQUE INDEX "center_days_tenant_id_date_key" ON "center_days"("tenant_id", "date");

-- AddForeignKey
ALTER TABLE "center_hours" ADD CONSTRAINT "center_hours_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "center_days" ADD CONSTRAINT "center_days_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
