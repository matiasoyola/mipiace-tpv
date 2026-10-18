-- residencia-5 · **EL RELEVO CON ACUSE, LAS OBLIGACIONES Y EL PANEL.**
--
-- Hoy el cambio de turno se hace de palabra y con una hoja en la sala: lo
-- que no se dice se pierde y nadie puede demostrar que se dijo. Las
-- obligaciones del mes —las nóminas, los extintores, el certificado de
-- PCI que falta desde 2026— viven en la cabeza de Carmen. Y la dirección
-- se entera de lo que hay abierto preguntando.
--
-- Lo que esta migración crea es el sitio donde:
--
--   1. `handovers` + `handover_zones` + `handover_acks` +
--      `handover_ack_zones` — **EL PARTE DE RELEVO CONGELADO Y SU ACUSE**
--      (D-18, D-19, D-58, D-67). El parte lo genera el sistema con lo ya
--      registrado —nadie lo escribe— y el turno que entra lo confirma con
--      su PIN en la tablet de la sala. La confirmación es la evidencia de
--      que la información pasó de un turno a otro.
--   2. `handover_late_additions` — **«LLEGÓ DESPUÉS DEL RELEVO»**: lo que
--      una puerta sin red sube a las 15:20 de algo de las 14:50, cuando el
--      parte ya está congelado. No reescribe lo congelado.
--   3. `management_duties` + `duty_occurrences` — **LAS OBLIGACIONES DE
--      DIRECCIÓN** (D-42), con su periodicidad, su responsable y su
--      evidencia adjunta.
--   4. `indicator_targets` — **EL UMBRAL OBJETIVO** de cada indicador,
--      que es del centro aunque la fórmula sea del producto (rama de
--      controles §10).
--
-- Más los dos CHECK de `devices` y `pairing_codes` **reescritos** para
-- que quepa un `HANDOVER`, que es la única pieza que toca tablas con
-- filas de producción.
--
-- ── ADITIVA, con dos CHECK reemplazados ─────────────────────────────
--
-- Ocho tablas nuevas vacías y dos CHECK sustituidos por otros más
-- anchos. Ni un `DROP TABLE`, ni un `DELETE`, ni un `TRUNCATE`, ni un
-- `UPDATE … SET` fuera de las funciones de los triggers. Un test enumera
-- los `ALTER TABLE` y comprueba que sólo nombran las tablas de este
-- bloque más `devices` y `pairing_codes`.
--
-- Los CHECK nuevos **son más permisivos que los que sustituyen**: lo que
-- antes pasaba sigue pasando, y además pasa un `HANDOVER`. Por eso el
-- scan que hacen al crearse no puede rechazar ninguna fila de hoy. Se
-- dice igual porque `devices` es la identidad de los terminales que
-- facturan, y por eso esta migración **se aplica primero en una copia**.
--
-- ── POR QUÉ EL PARTE ES UNA COLUMNA CIFRADA Y NO UN FICHERO `MPC1` ──
--
-- El prompt dejaba la elección y la razón es de lectura. Un parte se abre
-- **en la tablet de la sala, con el turno delante**: lo que hay detrás de
-- la pantalla es una consulta, no una descarga. Con un fichero del
-- volumen clínico habría dos sitios que tienen que estar consistentes
-- —la fila y el fichero— y la copia de seguridad de uno no sirve sin la
-- del otro; un parte cuya fila existe y cuyo fichero falta es un relevo
-- que no se puede leer y que dice que sí se pudo.
--
-- Y de tamaño no hay problema: un parte de un turno de 49 plazas son unos
-- pocos kilobytes de JSON. Lo que SÍ es un fichero es la **evidencia
-- adjunta** de una obligación (el certificado en PDF), y ésa va al
-- volumen de siempre con su cabecera `MPC1`, como las fotos clínicas y la
-- nota de voz de residencia-3: no se inventa un segundo almacén.
--
-- ── EL `down` ───────────────────────────────────────────────────────
--
--   DROP TRIGGER "handovers_inmutable" ON "handovers";
--   DROP TRIGGER "handover_zones_append_only" ON "handover_zones";
--   DROP TRIGGER "handover_acks_append_only" ON "handover_acks";
--   DROP TRIGGER "handover_ack_zones_append_only" ON "handover_ack_zones";
--   DROP TRIGGER "handover_late_additions_append_only" ON "handover_late_additions";
--   DROP TRIGGER "duty_occurrences_hecha_no_vuelve" ON "duty_occurrences";
--   DROP FUNCTION mipiacetpv_handovers_inmutable();
--   DROP FUNCTION mipiacetpv_handover_append_only();
--   DROP FUNCTION mipiacetpv_duty_occurrences_hecha_no_vuelve();
--   DROP TABLE "indicator_targets", "duty_occurrences", "management_duties",
--              "handover_late_additions", "handover_ack_zones",
--              "handover_acks", "handover_zones", "handovers";
--   -- y los CHECK de siempre vuelven SÓLO si no queda ninguna tablet de sala:
--   DELETE FROM "pairing_codes" WHERE "kind" = 'HANDOVER';
--   DELETE FROM "devices"       WHERE "kind" = 'HANDOVER';
--   ALTER TABLE "devices" DROP CONSTRAINT "devices_register_o_habitacion";
--   ALTER TABLE "devices" ADD CONSTRAINT "devices_register_o_habitacion" CHECK (
--       ("kind" = 'ROOM'  AND "room_id" IS NOT NULL AND "register_id" IS NULL)
--    OR ("kind" = 'GUARD' AND "room_id" IS NULL     AND "register_id" IS NULL)
--    OR ("kind" NOT IN ('ROOM','GUARD') AND "room_id" IS NULL AND "register_id" IS NOT NULL));
--   ALTER TABLE "pairing_codes" DROP CONSTRAINT "pairing_codes_register_o_habitacion";
--   ALTER TABLE "pairing_codes" ADD CONSTRAINT "pairing_codes_register_o_habitacion" CHECK (
--       ("kind" = 'ROOM'  AND "room_id" IS NOT NULL AND "register_id" IS NULL)
--    OR ("kind" = 'GUARD' AND "room_id" IS NULL     AND "register_id" IS NULL)
--    OR ("kind" NOT IN ('ROOM','GUARD') AND "room_id" IS NULL AND "register_id" IS NOT NULL));
--   DROP TYPE "HandoverLateKind", "IndicatorComparison", "DutyConsequence",
--             "DutyPeriodicity", "DutyFamily";
--
-- Es **completo** mientras no haya un solo parte congelado dentro:
-- después, el `down` es tirar la evidencia de que la información pasó de
-- un turno a otro, y eso no lo deshace una migración (D-45, Ley 41/2002).
-- El valor `HANDOVER` del enum lo añadió la migración anterior y ése no
-- se quita nunca.

-- ════════════════════════════════════════════════════════════════════
--  0 · LOS CINCO TIPOS NUEVOS
-- ════════════════════════════════════════════════════════════════════
--
-- Todos NUEVOS, así que se crean y se usan en esta misma migración. El
-- único que NO se puede crear aquí es el valor `HANDOVER` de
-- `DeviceKind`, que ya existía como tipo: ésa es la migración anterior.
--
-- Y lo que NO es un tipo, a propósito: el **código de indicador**
-- (`GIMNASIA`, `AVERIAS_24H`), que vive en el fichero de datos del
-- producto. D-11 llevado al panel: un indicador nuevo en 2028 es una fila
-- del fichero, no una migración.

CREATE TYPE "DutyFamily" AS ENUM ('PERSONAL', 'DINERO', 'COMPRAS', 'CUMPLIMIENTO', 'CALIDAD');
CREATE TYPE "DutyPeriodicity" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL', 'FIVE_YEARLY', 'VALIDITY');
CREATE TYPE "DutyConsequence" AS ENUM ('LEGAL', 'ISO', 'INTERNO');
CREATE TYPE "IndicatorComparison" AS ENUM ('AT_LEAST', 'AT_MOST');
CREATE TYPE "HandoverLateKind" AS ENUM ('CARE_RECORD', 'INCIDENT', 'GUARD_ALERT');

-- ════════════════════════════════════════════════════════════════════
--  1 · handovers · EL PARTE DE UN TURNO, CONGELADO (D-18, D-58)
-- ════════════════════════════════════════════════════════════════════
--
-- Uno por centro, turno y día. **No hay estado «en vivo»**: mientras el
-- turno está en curso el parte se CALCULA (`residencia/relevo.ts`) y no
-- hay fila; la fila nace al cerrar el turno con `frozen_at` NOT NULL y a
-- partir de ahí no se edita ni se borra.
--
-- La alternativa era una fila que naciera al abrirse el turno y se fuera
-- rellenando. Se descartó porque lo que esta tabla ES es la evidencia de
-- lo que se supo, y una fila que se edita durante ocho horas no se puede
-- distinguir de una que alguien editó después.
--
-- `id` SIN `DEFAULT`: el AAD de `content_cifrado` ata el valor a
-- `tenant|handovers|content|<id>` y el id hay que saberlo antes de
-- insertar. Misma decisión exacta que `care_records.id`.
CREATE TABLE "handovers" (
    "id"              UUID        NOT NULL,
    "tenant_id"       UUID        NOT NULL,
    "center_shift_id" UUID        NOT NULL,
    "care_day"        VARCHAR(10) NOT NULL,
    "generated_at"    TIMESTAMPTZ NOT NULL,
    "frozen_at"       TIMESTAMPTZ NOT NULL,
    "content_cifrado" TEXT        NOT NULL,
    "lineas"          INTEGER     NOT NULL DEFAULT 0,
    "sin_novedades"   BOOLEAN     NOT NULL DEFAULT false,
    "confirmed_at"    TIMESTAMPTZ,
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "handovers_pkey" PRIMARY KEY ("id")
);

-- El claro NO CABE. Mismo CHECK que las veintidós columnas cifradas de la
-- casa (clinica-7 §3), y aquí es NOT NULL porque todo parte tiene
-- contenido: el de «turno sin novedades» también, y lo que dice es eso.
ALTER TABLE "handovers"
    ADD CONSTRAINT "handovers_content_cifrado_formato"
    CHECK ("content_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

-- El día del centro, «YYYY-MM-DD». Mismo CHECK que `care_records` y que
-- `incidents`, y por lo mismo: es la columna que agrupa el histórico.
ALTER TABLE "handovers"
    ADD CONSTRAINT "handovers_care_day_formato"
    CHECK ("care_day" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');

-- Congelar no puede ser antes de calcular.
ALTER TABLE "handovers"
    ADD CONSTRAINT "handovers_instantes_ordenados"
    CHECK ("frozen_at" >= "generated_at");

-- Y un recuento no es negativo. **Y el `sin_novedades` tiene que cuadrar
-- con el recuento**: un parte «sin novedades» con nueve líneas es un
-- parte que miente en la pantalla de reposo de la sala, que es donde
-- pone «Turno sin novedades».
ALTER TABLE "handovers"
    ADD CONSTRAINT "handovers_recuento_coherente"
    CHECK ("lineas" >= 0 AND ("sin_novedades" = false OR "lineas" = 0));

ALTER TABLE "handovers"
    ADD CONSTRAINT "handovers_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- `RESTRICT` al turno, igual que `care_records` y que `incidents`: el
-- turno es el vocabulario con el que está firmado el histórico (D-54).
ALTER TABLE "handovers"
    ADD CONSTRAINT "handovers_center_shift_id_fkey"
    FOREIGN KEY ("center_shift_id") REFERENCES "center_shifts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Uno por centro, turno y día (D-58). **Es la idempotencia de la tarea
-- programada**: correrla dos veces no congela dos partes, y el motor lo
-- garantiza en vez de un `if` de la ruta.
CREATE UNIQUE INDEX "handovers_tenant_id_center_shift_id_care_day_key"
    ON "handovers"("tenant_id", "center_shift_id", "care_day");
CREATE INDEX "handovers_tenant_id_idx" ON "handovers"("tenant_id");
CREATE INDEX "handovers_tenant_id_care_day_idx"
    ON "handovers"("tenant_id", "care_day");

-- «Los NO confirmados de la semana», que es la segunda fila del panel.
-- Parcial: lo confirmado es la mayoría y no hace falta en el índice.
CREATE INDEX "handovers_sin_confirmar_idx"
    ON "handovers"("tenant_id", "care_day")
    WHERE "confirmed_at" IS NULL;

-- ── EL TRIGGER DE INMUTABILIDAD ─────────────────────────────────────
--
-- Un parte congelado **no se edita y no se borra**. La única columna que
-- puede cambiar es `confirmed_at`, y sólo de NULL a puesta: es
-- contabilidad de las confirmaciones, no contenido del parte. Las once
-- columnas se comparan **una por una y por su nombre**, no con
-- `row(NEW.*) IS DISTINCT FROM row(OLD.*)`, por lo mismo que en
-- `care_records_inmutable`: el día que la tabla gane una columna, el test
-- del contrato del SQL se pone rojo y recuerda por qué.
CREATE FUNCTION mipiacetpv_handovers_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'RESIDENCIA_VIOLADA: un parte de relevo congelado no se borra (handovers.%). Es la evidencia de lo que se supo en ese turno.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    IF NEW.id              IS DISTINCT FROM OLD.id
       OR NEW.tenant_id       IS DISTINCT FROM OLD.tenant_id
       OR NEW.center_shift_id IS DISTINCT FROM OLD.center_shift_id
       OR NEW.care_day        IS DISTINCT FROM OLD.care_day
       OR NEW.generated_at    IS DISTINCT FROM OLD.generated_at
       OR NEW.frozen_at       IS DISTINCT FROM OLD.frozen_at
       OR NEW.content_cifrado IS DISTINCT FROM OLD.content_cifrado
       OR NEW.lineas          IS DISTINCT FROM OLD.lineas
       OR NEW.sin_novedades   IS DISTINCT FROM OLD.sin_novedades
       OR NEW.created_at      IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION
            'RESIDENCIA_VIOLADA: un parte congelado no se edita (handovers.%). Lo que llegó después se añade como «llegó después del relevo», con su hora.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    -- Des-confirmar tampoco. Que el relevo se confirmó a las 15:04 es un
    -- hecho, y un hecho no se quita: las confirmaciones son append-only y
    -- esta columna es su resumen.
    IF OLD.confirmed_at IS NOT NULL AND NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
        RAISE EXCEPTION
            'RESIDENCIA_VIOLADA: el parte % ya estaba confirmado y una confirmación no se retira.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$fn$;

CREATE TRIGGER "handovers_inmutable"
    BEFORE UPDATE OR DELETE ON "handovers"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_handovers_inmutable();

-- ════════════════════════════════════════════════════════════════════
--  2 · handover_zones · LAS ZONAS CON CONTENIDO
-- ════════════════════════════════════════════════════════════════════
--
-- Una fila por planta que tiene algo que contar en este parte, con
-- cuántas líneas. `floor_id` NULL es **la zona del centro**: lo que no es
-- de ninguna planta (una avería del office, una queja sin residente), y
-- sólo la cubre una confirmación de alcance total.
--
-- **Sólo se escriben las zonas CON contenido**: una planta sin nada que
-- contar no tiene fila y por tanto no necesita confirmación. Exigirla
-- dejaría el parte «sin confirmar» por una planta vacía.
CREATE TABLE "handover_zones" (
    "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"   UUID        NOT NULL,
    "handover_id" UUID        NOT NULL,
    "floor_id"    UUID,
    "lineas"      INTEGER     NOT NULL DEFAULT 0,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "handover_zones_pkey" PRIMARY KEY ("id")
);

-- Una zona sin contenido no es una zona de este parte: si está escrita,
-- tiene al menos una línea. Es lo que hace que «cada zona con contenido»
-- de la decisión 3 sea exactamente «cada fila de esta tabla».
ALTER TABLE "handover_zones"
    ADD CONSTRAINT "handover_zones_con_contenido"
    CHECK ("lineas" > 0);

ALTER TABLE "handover_zones"
    ADD CONSTRAINT "handover_zones_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "handover_zones"
    ADD CONSTRAINT "handover_zones_handover_id_fkey"
    FOREIGN KEY ("handover_id") REFERENCES "handovers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "handover_zones"
    ADD CONSTRAINT "handover_zones_floor_id_fkey"
    FOREIGN KEY ("floor_id") REFERENCES "floors"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Y HACEN FALTA DOS ÍNDICES PARA DECIR «UNA POR ZONA» ─────────────
--
-- En Postgres los NULL son distintos entre sí, así que un único
-- `UNIQUE(handover_id, floor_id)` dejaría entrar DOS filas «del centro»
-- en el mismo parte — y entonces «está confirmado» pediría dos
-- confirmaciones de alcance total para la misma cosa.
--
-- Es la **quinta vez** que esta lección se paga en este repo
-- (`ticket_allergies_mesa_key` en kds-1,
-- `care_zone_assignments_one_live_centro_key` en residencia-1,
-- `control_types_una_vigente_*` en residencia-2,
-- `care_records_una_por_ocurrencia_key` en residencia-3). Aquí está
-- pagada de entrada, con su sabotaje con nombre en el e2e.
CREATE UNIQUE INDEX "handover_zones_una_por_planta_key"
    ON "handover_zones"("handover_id", "floor_id")
    WHERE "floor_id" IS NOT NULL;
CREATE UNIQUE INDEX "handover_zones_una_del_centro_key"
    ON "handover_zones"("handover_id")
    WHERE "floor_id" IS NULL;

CREATE INDEX "handover_zones_tenant_id_idx" ON "handover_zones"("tenant_id");
CREATE INDEX "handover_zones_handover_id_idx" ON "handover_zones"("handover_id");
CREATE INDEX "handover_zones_floor_id_idx" ON "handover_zones"("floor_id");

-- ════════════════════════════════════════════════════════════════════
--  3 · handover_acks · «LEÍDO Y RECIBIDO» (D-19, D-31, D-67)
-- ════════════════════════════════════════════════════════════════════
--
-- Quien recoge el turno confirma el parte con su PIN en la tablet de la
-- sala. Firma **persona + capacidad + hora**: «lo recibió Ana Isabel» no
-- es evidencia; «lo recibió Ana Isabel, como auxiliar, a las 15:04, y
-- abarcaba la primera planta» sí lo es.
--
-- `at` y `received_at` son dos instantes por lo mismo que en
-- `care_records`: sin red la confirmación se encola y los dos se
-- separan. **El que manda es `at`**.
CREATE TABLE "handover_acks" (
    "id"                      UUID        NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"               UUID        NOT NULL,
    "handover_id"             UUID        NOT NULL,
    "user_id"                 UUID        NOT NULL,
    "care_role_assignment_id" UUID        NOT NULL,
    "device_id"               UUID        NOT NULL,
    "at"                      TIMESTAMPTZ NOT NULL,
    "received_at"             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alcance_total"           BOOLEAN     NOT NULL DEFAULT false,
    "created_at"              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "handover_acks_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "handover_acks"
    ADD CONSTRAINT "handover_acks_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "handover_acks"
    ADD CONSTRAINT "handover_acks_handover_id_fkey"
    FOREIGN KEY ("handover_id") REFERENCES "handovers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "handover_acks"
    ADD CONSTRAINT "handover_acks_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "handover_acks"
    ADD CONSTRAINT "handover_acks_care_role_assignment_id_fkey"
    FOREIGN KEY ("care_role_assignment_id") REFERENCES "care_role_assignments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- `RESTRICT` a la tablet, igual que `care_records.device_id`: la
-- confirmación es evidencia y un aparato se revoca, no se borra.
ALTER TABLE "handover_acks"
    ADD CONSTRAINT "handover_acks_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "devices"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- **CONFIRMAR DOS VECES NO DUPLICA**, y quien lo garantiza es el motor.
-- La ruta lo detecta antes y contesta la que ya había —para que una
-- tablet que reintenta sin red no reciba un error— pero si el `if` se
-- cayera, el índice lo para.
CREATE UNIQUE INDEX "handover_acks_handover_id_user_id_key"
    ON "handover_acks"("handover_id", "user_id");
CREATE INDEX "handover_acks_tenant_id_idx" ON "handover_acks"("tenant_id");
CREATE INDEX "handover_acks_handover_id_idx" ON "handover_acks"("handover_id");

-- ════════════════════════════════════════════════════════════════════
--  4 · handover_ack_zones · QUÉ ZONAS ABARCABA
-- ════════════════════════════════════════════════════════════════════
--
-- Una fila por planta que la confirmación cubre. **Vacío cuando
-- `alcance_total`**: enumerar las ocho plantas en cada confirmación de la
-- DUE sería guardar ocho veces lo que una columna booleana ya dice, y el
-- día que el centro añada una novena planta las confirmaciones viejas
-- dirían que cubrían ocho de nueve.
CREATE TABLE "handover_ack_zones" (
    "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "ack_id"    UUID NOT NULL,
    "floor_id"  UUID NOT NULL,

    CONSTRAINT "handover_ack_zones_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "handover_ack_zones"
    ADD CONSTRAINT "handover_ack_zones_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "handover_ack_zones"
    ADD CONSTRAINT "handover_ack_zones_ack_id_fkey"
    FOREIGN KEY ("ack_id") REFERENCES "handover_acks"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "handover_ack_zones"
    ADD CONSTRAINT "handover_ack_zones_floor_id_fkey"
    FOREIGN KEY ("floor_id") REFERENCES "floors"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "handover_ack_zones_ack_id_floor_id_key"
    ON "handover_ack_zones"("ack_id", "floor_id");
CREATE INDEX "handover_ack_zones_tenant_id_idx" ON "handover_ack_zones"("tenant_id");
CREATE INDEX "handover_ack_zones_floor_id_idx" ON "handover_ack_zones"("floor_id");

-- ════════════════════════════════════════════════════════════════════
--  5 · handover_late_additions · «LLEGÓ DESPUÉS DEL RELEVO»
-- ════════════════════════════════════════════════════════════════════
--
-- Una puerta sin red sube a las 15:20 algo que pasó a las 14:50, y el
-- parte de la mañana ya está congelado. No se reescribe lo congelado —eso
-- es la evidencia de lo que se supo— y tampoco se esconde: se añade aquí,
-- con su hora, y la tablet y el panel lo pintan aparte.
--
-- `occurred_at` y `arrived_at` son el bloque entero en dos columnas:
-- «pasó a las 14:50, lo supimos a las 15:20».
--
-- `id` SIN `DEFAULT`, por lo mismo que `handovers.id`: el AAD de
-- `resumen_cifrado` lo necesita antes de insertar.
CREATE TABLE "handover_late_additions" (
    "id"              UUID               NOT NULL,
    "tenant_id"       UUID               NOT NULL,
    "handover_id"     UUID               NOT NULL,
    "kind"            "HandoverLateKind" NOT NULL,
    "care_record_id"  UUID,
    "incident_id"     UUID,
    "guard_alert_id"  UUID,
    "client_id"       UUID,
    "floor_id"        UUID,
    "occurred_at"     TIMESTAMPTZ        NOT NULL,
    "arrived_at"      TIMESTAMPTZ        NOT NULL,
    "resumen_cifrado" TEXT               NOT NULL,
    "created_at"      TIMESTAMPTZ        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "handover_late_additions_pkey" PRIMARY KEY ("id")
);

-- El claro no cabe, igual que en el parte.
ALTER TABLE "handover_late_additions"
    ADD CONSTRAINT "handover_late_additions_resumen_cifrado_formato"
    CHECK ("resumen_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

-- **Exactamente UNA fuente, la que dice `kind`.** Un añadido que no
-- apunta a nada no se puede abrir, y uno que apunta a dos no se sabe qué
-- es. Misma forma que `incidents_sujeto_coherente`.
ALTER TABLE "handover_late_additions"
    ADD CONSTRAINT "handover_late_additions_fuente_coherente"
    CHECK (
        ("kind" = 'CARE_RECORD'
            AND "care_record_id" IS NOT NULL
            AND "incident_id"    IS NULL
            AND "guard_alert_id" IS NULL)
     OR ("kind" = 'INCIDENT'
            AND "incident_id"    IS NOT NULL
            AND "care_record_id" IS NULL
            AND "guard_alert_id" IS NULL)
     OR ("kind" = 'GUARD_ALERT'
            AND "guard_alert_id" IS NOT NULL
            AND "care_record_id" IS NULL
            AND "incident_id"    IS NULL)
    );

-- Un añadido tardío **llegó después de que pasara**. Al revés no es un
-- añadido tardío: es un dato mal escrito.
ALTER TABLE "handover_late_additions"
    ADD CONSTRAINT "handover_late_additions_instantes_ordenados"
    CHECK ("arrived_at" >= "occurred_at");

ALTER TABLE "handover_late_additions"
    ADD CONSTRAINT "handover_late_additions_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "handover_late_additions"
    ADD CONSTRAINT "handover_late_additions_handover_id_fkey"
    FOREIGN KEY ("handover_id") REFERENCES "handovers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "handover_late_additions"
    ADD CONSTRAINT "handover_late_additions_care_record_id_fkey"
    FOREIGN KEY ("care_record_id") REFERENCES "care_records"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "handover_late_additions"
    ADD CONSTRAINT "handover_late_additions_incident_id_fkey"
    FOREIGN KEY ("incident_id") REFERENCES "incidents"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "handover_late_additions"
    ADD CONSTRAINT "handover_late_additions_guard_alert_id_fkey"
    FOREIGN KEY ("guard_alert_id") REFERENCES "guard_alerts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "handover_late_additions"
    ADD CONSTRAINT "handover_late_additions_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "handover_late_additions"
    ADD CONSTRAINT "handover_late_additions_floor_id_fkey"
    FOREIGN KEY ("floor_id") REFERENCES "floors"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── LA IDEMPOTENCIA DE LA PASADA QUE LOS DETECTA ────────────────────
--
-- Un registro tardío se añade UNA vez a UN parte. Tres índices parciales
-- y no uno compuesto, por la razón de siempre: las tres columnas de
-- fuente son nullable y en Postgres los NULL son distintos entre sí, así
-- que un `UNIQUE(handover_id, care_record_id, incident_id,
-- guard_alert_id)` no diría nada.
CREATE UNIQUE INDEX "handover_late_additions_un_registro_key"
    ON "handover_late_additions"("handover_id", "care_record_id")
    WHERE "care_record_id" IS NOT NULL;
CREATE UNIQUE INDEX "handover_late_additions_una_incidencia_key"
    ON "handover_late_additions"("handover_id", "incident_id")
    WHERE "incident_id" IS NOT NULL;
CREATE UNIQUE INDEX "handover_late_additions_un_aviso_key"
    ON "handover_late_additions"("handover_id", "guard_alert_id")
    WHERE "guard_alert_id" IS NOT NULL;

CREATE INDEX "handover_late_additions_tenant_id_idx"
    ON "handover_late_additions"("tenant_id");
CREATE INDEX "handover_late_additions_handover_id_idx"
    ON "handover_late_additions"("handover_id");

-- ── APPEND-ONLY, LAS TRES TABLAS HIJAS ──────────────────────────────
--
-- Una función para las tres (zonas, confirmaciones, zonas de la
-- confirmación y añadidos tardíos): ni `UPDATE` ni `DELETE`, sin
-- escapatoria. `TG_TABLE_NAME` pone el nombre en el mensaje, que es lo
-- único que las distingue.
--
-- Hace falta que las ZONAS también lo sean, y no es obvio: borrar una
-- fila de `handover_zones` haría que un parte con contenido en dos
-- plantas pareciera tener contenido en una, y entonces una confirmación
-- que cubre sólo esa planta lo daría por confirmado entero. Lo mismo al
-- revés con `handover_ack_zones`: quitarle una zona a una confirmación
-- cambia lo que aquella persona dijo que había leído.
CREATE FUNCTION mipiacetpv_handover_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION
            'RESIDENCIA_VIOLADA: %.% no se edita. Lo del relevo es append-only: lo que cambia se escribe, no se reescribe.',
            TG_TABLE_NAME, OLD.id USING ERRCODE = '23514';
    END IF;
    RAISE EXCEPTION
        'RESIDENCIA_VIOLADA: %.% no se borra. Una confirmación de relevo que se puede borrar no demuestra nada.',
        TG_TABLE_NAME, OLD.id USING ERRCODE = '23514';
END;
$fn$;

CREATE TRIGGER "handover_zones_append_only"
    BEFORE UPDATE OR DELETE ON "handover_zones"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_handover_append_only();

CREATE TRIGGER "handover_acks_append_only"
    BEFORE UPDATE OR DELETE ON "handover_acks"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_handover_append_only();

CREATE TRIGGER "handover_ack_zones_append_only"
    BEFORE UPDATE OR DELETE ON "handover_ack_zones"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_handover_append_only();

CREATE TRIGGER "handover_late_additions_append_only"
    BEFORE UPDATE OR DELETE ON "handover_late_additions"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_handover_append_only();

-- ════════════════════════════════════════════════════════════════════
--  6 · management_duties · LAS OBLIGACIONES DE DIRECCIÓN (D-42)
-- ════════════════════════════════════════════════════════════════════
--
-- «¿Qué toca este día del mes?» es la mitad de la métrica de éxito de
-- dirección (bloque C §2), y hoy la respuesta vive en la cabeza de
-- Carmen.
--
-- **CON `tenant_id`**, al revés que `severity_rules` y que los
-- `control_types` de serie: las obligaciones son DEL CENTRO. El catálogo
-- del bloque C §3 es una PLANTILLA que el centro carga de una vez y luego
-- ajusta; no baja a todos los centros cuando el producto la cambie,
-- porque las nóminas de un centro no son asunto de otro.
CREATE TABLE "management_duties" (
    "tenant_id"                UUID              NOT NULL,
    "id"                       UUID              NOT NULL DEFAULT gen_random_uuid(),
    "name"                     TEXT              NOT NULL,
    "family"                   "DutyFamily"      NOT NULL,
    "notes"                    TEXT,
    "periodicity"              "DutyPeriodicity" NOT NULL,
    "weekday"                  INTEGER,
    "month_day"                INTEGER,
    "month"                    INTEGER,
    "anchor_year"              INTEGER,
    "valid_until"              VARCHAR(10),
    "periodicity_to_verify"    BOOLEAN           NOT NULL DEFAULT false,
    "consequence"              "DutyConsequence" NOT NULL,
    "responsible_care_role_id" UUID,
    "responsible_user_id"      UUID,
    "responsible_label"        TEXT,
    "starts_on"                VARCHAR(10)       NOT NULL,
    "active"                   BOOLEAN           NOT NULL DEFAULT true,
    "created_at"               TIMESTAMPTZ       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"               TIMESTAMPTZ       NOT NULL,
    "created_by_user_id"       UUID,

    CONSTRAINT "management_duties_pkey" PRIMARY KEY ("id")
);

-- ── LA PERIODICIDAD, COLUMNA POR COLUMNA ────────────────────────────
--
-- Cada periodicidad lleva las suyas y **ninguna más**. Una mensual sin
-- día del mes no sabe cuándo toca; una semanal CON día del mes es una
-- fila que alguien rellenó a medias y que el generador no sabe leer.
--
-- Y los rangos van con su `IS NOT NULL` delante, siempre: un `BETWEEN`
-- sobre una columna NULL da NULL, y un CHECK que da NULL **pasa**. Es
-- lección de la casa y aquí hay cuatro columnas nullable donde pagarla.
ALTER TABLE "management_duties"
    ADD CONSTRAINT "management_duties_periodicidad_coherente"
    CHECK (
        ("periodicity" = 'DAILY'
            AND "weekday" IS NULL AND "month_day" IS NULL
            AND "month" IS NULL AND "anchor_year" IS NULL
            AND "valid_until" IS NULL)
     OR ("periodicity" = 'WEEKLY'
            AND "weekday" IS NOT NULL AND "weekday" BETWEEN 1 AND 7
            AND "month_day" IS NULL AND "month" IS NULL
            AND "anchor_year" IS NULL AND "valid_until" IS NULL)
     OR ("periodicity" = 'MONTHLY'
            AND "month_day" IS NOT NULL AND "month_day" BETWEEN 1 AND 31
            AND "weekday" IS NULL AND "month" IS NULL
            AND "anchor_year" IS NULL AND "valid_until" IS NULL)
     OR ("periodicity" = 'QUARTERLY'
            AND "month_day" IS NOT NULL AND "month_day" BETWEEN 1 AND 31
            AND "month" IS NOT NULL AND "month" BETWEEN 1 AND 3
            AND "weekday" IS NULL AND "anchor_year" IS NULL
            AND "valid_until" IS NULL)
     OR ("periodicity" = 'ANNUAL'
            AND "month_day" IS NOT NULL AND "month_day" BETWEEN 1 AND 31
            AND "month" IS NOT NULL AND "month" BETWEEN 1 AND 12
            AND "weekday" IS NULL AND "anchor_year" IS NULL
            AND "valid_until" IS NULL)
     OR ("periodicity" = 'FIVE_YEARLY'
            AND "month_day" IS NOT NULL AND "month_day" BETWEEN 1 AND 31
            AND "month" IS NOT NULL AND "month" BETWEEN 1 AND 12
            AND "anchor_year" IS NOT NULL AND "anchor_year" BETWEEN 1900 AND 2200
            AND "weekday" IS NULL AND "valid_until" IS NULL)
     OR ("periodicity" = 'VALIDITY'
            AND "valid_until" IS NOT NULL
            AND "valid_until" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            AND "weekday" IS NULL AND "month_day" IS NULL
            AND "month" IS NULL AND "anchor_year" IS NULL)
    );

-- **EXACTAMENTE UN RESPONSABLE de los tres.** Un rol de cuidado
-- («Dirección», «Calidad»), una persona, o una etiqueta libre
-- («Gestoría», «Mi Piace», que son de fuera del centro y no tienen
-- usuario). Con dos, «¿a quién le toca?» tendría dos respuestas y la
-- pantalla elegiría una; con ninguna, la obligación no es de nadie y
-- nadie la hace.
ALTER TABLE "management_duties"
    ADD CONSTRAINT "management_duties_responsable"
    CHECK (
        (CASE WHEN "responsible_care_role_id" IS NOT NULL THEN 1 ELSE 0 END)
      + (CASE WHEN "responsible_user_id"      IS NOT NULL THEN 1 ELSE 0 END)
      + (CASE WHEN "responsible_label"        IS NOT NULL THEN 1 ELSE 0 END) = 1
    );

ALTER TABLE "management_duties"
    ADD CONSTRAINT "management_duties_starts_on_formato"
    CHECK ("starts_on" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');

ALTER TABLE "management_duties"
    ADD CONSTRAINT "management_duties_nombre_no_vacio"
    CHECK (length(btrim("name")) > 0);

ALTER TABLE "management_duties"
    ADD CONSTRAINT "management_duties_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- `RESTRICT` al rol: un rol con obligaciones a su nombre es vocabulario
-- vivo del centro — primero se le cambia el responsable, después se
-- retira el rol.
ALTER TABLE "management_duties"
    ADD CONSTRAINT "management_duties_responsible_care_role_id_fkey"
    FOREIGN KEY ("responsible_care_role_id") REFERENCES "care_roles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Y `SET NULL` a la persona… que dejaría la fila sin ningún responsable y
-- rompería el CHECK de arriba. Así que **no**: `RESTRICT` también, y la
-- pantalla obliga a reasignar antes de dar de baja a nadie. Es la clase
-- de promesa que un `SET NULL` no puede cumplir cuando hay un CHECK
-- encima (lección de `clinical_processor_agreements` en clinica-7).
ALTER TABLE "management_duties"
    ADD CONSTRAINT "management_duties_responsible_user_id_fkey"
    FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "management_duties"
    ADD CONSTRAINT "management_duties_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Un nombre por centro entre las VIVAS. Parcial sobre `active`: dos
-- «Nóminas» en la lista son dos sitios donde marcarlo hecho y uno se
-- queda sin marcar, pero una retirada y una nueva con el mismo nombre es
-- legítimo (el centro cambió de criterio).
CREATE UNIQUE INDEX "management_duties_nombre_key"
    ON "management_duties"("tenant_id", "name")
    WHERE "active";

CREATE INDEX "management_duties_tenant_id_idx" ON "management_duties"("tenant_id");
CREATE INDEX "management_duties_tenant_id_family_idx"
    ON "management_duties"("tenant_id", "family");

-- ════════════════════════════════════════════════════════════════════
--  7 · duty_occurrences · UNA VEZ QUE TOCA
-- ════════════════════════════════════════════════════════════════════
--
-- Las genera la pasada programada desde la periodicidad de su
-- obligación, con ventana por delante: el panel enseña «lo que vence en
-- 60 días» y para eso las ocurrencias tienen que existir antes de vencer.
--
-- Se marca hecha con persona + capacidad + hora (D-31) y, si se quiere,
-- una evidencia adjunta. Una vencida sale **en rojo en el panel** y **NO
-- abre incidencia**: el sujeto «proceso» del libro es de calidad-1.
CREATE TABLE "duty_occurrences" (
    "tenant_id"                       UUID        NOT NULL,
    "id"                              UUID        NOT NULL DEFAULT gen_random_uuid(),
    "duty_id"                         UUID        NOT NULL,
    "due_on"                          VARCHAR(10) NOT NULL,
    "done_at"                         TIMESTAMPTZ,
    "done_by_user_id"                 UUID,
    "done_by_care_role_assignment_id" UUID,
    "done_note"                       TEXT,
    "evidence_file_name"              VARCHAR(100),
    "evidence_sha256"                 CHAR(64),
    "evidence_bytes"                  INTEGER,
    "evidence_mime_type"              VARCHAR(80),
    "corrected_at"                    TIMESTAMPTZ,
    "corrected_by_user_id"            UUID,
    "correction_reason"               TEXT,
    "created_at"                      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "duty_occurrences_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "duty_occurrences"
    ADD CONSTRAINT "duty_occurrences_due_on_formato"
    CHECK ("due_on" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');

-- **Hecha es las tres cosas o ninguna.** Una ocurrencia hecha sin saber
-- quién la hizo es media evidencia, y la evidencia es el punto entero del
-- bloque. Misma forma que `incidents_cierre_completo`.
ALTER TABLE "duty_occurrences"
    ADD CONSTRAINT "duty_occurrences_hecha_completa"
    CHECK (
        ("done_at" IS NULL
            AND "done_by_user_id" IS NULL
            AND "done_by_care_role_assignment_id" IS NULL)
     OR ("done_at" IS NOT NULL
            AND "done_by_user_id" IS NOT NULL
            AND "done_by_care_role_assignment_id" IS NOT NULL)
    );

-- La evidencia, las cuatro juntas o ninguna. Media evidencia es una fila
-- que dice que hay un PDF que no se puede servir. Mismo CHECK que
-- `care_records_voz_completa`.
ALTER TABLE "duty_occurrences"
    ADD CONSTRAINT "duty_occurrences_evidencia_completa"
    CHECK (
        ("evidence_file_name" IS NULL AND "evidence_sha256" IS NULL
            AND "evidence_bytes" IS NULL AND "evidence_mime_type" IS NULL)
     OR ("evidence_file_name" IS NOT NULL AND "evidence_sha256" IS NOT NULL
            AND "evidence_bytes" IS NOT NULL AND "evidence_bytes" > 0
            AND "evidence_mime_type" IS NOT NULL)
    );

-- Y una evidencia sólo cuelga de algo hecho: adjuntar el certificado de
-- extintores a una ocurrencia que nadie ha marcado es decir que está y
-- que no está.
ALTER TABLE "duty_occurrences"
    ADD CONSTRAINT "duty_occurrences_evidencia_exige_hecha"
    CHECK ("evidence_file_name" IS NULL OR "done_at" IS NOT NULL);

-- La corrección, las tres juntas o ninguna.
ALTER TABLE "duty_occurrences"
    ADD CONSTRAINT "duty_occurrences_correccion_completa"
    CHECK (
        ("corrected_at" IS NULL AND "corrected_by_user_id" IS NULL
            AND "correction_reason" IS NULL)
     OR ("corrected_at" IS NOT NULL AND "corrected_by_user_id" IS NOT NULL
            AND "correction_reason" IS NOT NULL
            AND length(btrim("correction_reason")) > 0)
    );

ALTER TABLE "duty_occurrences"
    ADD CONSTRAINT "duty_occurrences_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "duty_occurrences"
    ADD CONSTRAINT "duty_occurrences_duty_id_fkey"
    FOREIGN KEY ("duty_id") REFERENCES "management_duties"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "duty_occurrences"
    ADD CONSTRAINT "duty_occurrences_done_by_user_id_fkey"
    FOREIGN KEY ("done_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "duty_occurrences"
    ADD CONSTRAINT "duty_occurrences_done_by_care_role_assignment_id_fkey"
    FOREIGN KEY ("done_by_care_role_assignment_id")
    REFERENCES "care_role_assignments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "duty_occurrences"
    ADD CONSTRAINT "duty_occurrences_corrected_by_user_id_fkey"
    FOREIGN KEY ("corrected_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Una por obligación y día. **Es la idempotencia de la pasada que las
-- genera**: correrla dos veces no crea dos nóminas del 25 de octubre.
CREATE UNIQUE INDEX "duty_occurrences_una_por_dia_key"
    ON "duty_occurrences"("duty_id", "due_on");
CREATE INDEX "duty_occurrences_tenant_id_idx" ON "duty_occurrences"("tenant_id");
CREATE INDEX "duty_occurrences_tenant_id_due_on_idx"
    ON "duty_occurrences"("tenant_id", "due_on");

-- «¿Qué toca hoy y qué está vencido?», que es la tercera fila del panel.
-- Parcial sobre lo pendiente: lo hecho es lo que crece sin parar y no
-- hace falta en este índice.
CREATE INDEX "duty_occurrences_pendientes_idx"
    ON "duty_occurrences"("tenant_id", "due_on")
    WHERE "done_at" IS NULL;

-- ── UNA HECHA NO VUELVE A PENDIENTE, SALVO CORRECCIÓN FIRMADA ───────
--
-- El trigger deja poner `done_at` a NULL **sólo** si la fila trae a la
-- vez la corrección firmada: cuándo, quién y por qué. Un «se me fue el
-- dedo» se arregla diciendo quién lo arregla — la misma regla que la
-- anulación de un `CareRecord`, que tampoco borra: deja autor y hora.
--
-- Y borrar la fila no se cierra aquí a propósito: `duty_occurrences`
-- cuelga de su obligación con `CASCADE`, y retirar una obligación con sus
-- ocurrencias es una decisión de dirección sobre SU agenda, no sobre
-- datos de salud. Lo que no se puede es mentir sobre si estaba hecha.
CREATE FUNCTION mipiacetpv_duty_occurrences_hecha_no_vuelve() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF OLD.done_at IS NOT NULL AND NEW.done_at IS NULL THEN
        IF NEW.corrected_at IS NULL
           OR NEW.corrected_by_user_id IS NULL
           OR NEW.correction_reason IS NULL THEN
            RAISE EXCEPTION
                'RESIDENCIA_VIOLADA: la obligación % estaba marcada como hecha. Para deshacerlo hace falta una corrección firmada: quién y por qué.',
                OLD.id USING ERRCODE = '23514';
        END IF;
    END IF;

    -- Y el día que toca no se mueve: cambiar `due_on` de una ocurrencia
    -- hecha sería mover la evidencia a otra fecha.
    IF NEW.duty_id IS DISTINCT FROM OLD.duty_id
       OR NEW.due_on IS DISTINCT FROM OLD.due_on
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
        RAISE EXCEPTION
            'RESIDENCIA_VIOLADA: la ocurrencia % no cambia de obligación ni de día. Si el día era otro, se genera el que toca.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$fn$;

CREATE TRIGGER "duty_occurrences_hecha_no_vuelve"
    BEFORE UPDATE ON "duty_occurrences"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_duty_occurrences_hecha_no_vuelve();

-- ════════════════════════════════════════════════════════════════════
--  8 · indicator_targets · EL UMBRAL ES DEL CENTRO
-- ════════════════════════════════════════════════════════════════════
--
-- La frontera estándar/centro, escrita en una tabla (rama de controles
-- §10): la **fórmula** de cada indicador es del producto y vive en
-- `packages/residencia-plan/src/indicadores.ts`; el **umbral** es del
-- centro y vive aquí. El 73,5 % de la gimnasia es el objetivo 2026 de
-- Jardín de Gredos, no una constante del producto.
--
-- **No se siembra una fila por centro.** Sin fila, el panel usa el umbral
-- de serie del fichero y lo dice; un umbral sembrado y nunca revisado es
-- indistinguible de uno que la dirección eligió.
CREATE TABLE "indicator_targets" (
    "tenant_id"          UUID                  NOT NULL,
    "id"                 UUID                  NOT NULL DEFAULT gen_random_uuid(),
    "code"               TEXT                  NOT NULL,
    "target"             DOUBLE PRECISION      NOT NULL,
    "comparison"         "IndicatorComparison" NOT NULL,
    "created_at"         TIMESTAMPTZ           NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMPTZ           NOT NULL,
    "updated_by_user_id" UUID,

    CONSTRAINT "indicator_targets_pkey" PRIMARY KEY ("id")
);

-- Un umbral negativo no existe en ninguno de los seis indicadores que
-- este bloque calcula (porcentajes y recuentos), y un NaN tampoco.
ALTER TABLE "indicator_targets"
    ADD CONSTRAINT "indicator_targets_umbral_sano"
    CHECK ("target" >= 0 AND "target" = "target");

ALTER TABLE "indicator_targets"
    ADD CONSTRAINT "indicator_targets_code_no_vacio"
    CHECK (length(btrim("code")) > 0);

ALTER TABLE "indicator_targets"
    ADD CONSTRAINT "indicator_targets_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "indicator_targets"
    ADD CONSTRAINT "indicator_targets_updated_by_user_id_fkey"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "indicator_targets_tenant_id_code_key"
    ON "indicator_targets"("tenant_id", "code");
CREATE INDEX "indicator_targets_tenant_id_idx" ON "indicator_targets"("tenant_id");

-- ════════════════════════════════════════════════════════════════════
--  9 · LOS DOS CHECK DE SIEMPRE, REESCRITOS PARA QUE QUEPA LA SALA
-- ════════════════════════════════════════════════════════════════════
--
-- residencia-1 los dejó en dos casos y residencia-4 en tres. La tablet de
-- la sala es el cuarto, y como el móvil de guardia **no tiene ni caja ni
-- habitación**: es del CENTRO, y el centro es el tenant, así que no hace
-- falta ninguna columna que lo diga.
--
-- Los nuevos son **más permisivos que los que sustituyen**: todo lo que
-- pasaba sigue pasando, y además pasa un `HANDOVER`. Por eso el scan que
-- hacen al crearse no puede rechazar ninguna fila de hoy. Y lo que NO se
-- relaja es lo que importaba: un terminal sigue exigiendo caja y una
-- puerta sigue exigiendo habitación.
--
-- **Y el CHECK del canal de guardia no se toca**: dice `kind = 'GUARD'`
-- exige canal y todo lo demás lo prohíbe, así que una tablet de sala con
-- canal de guardia **ya está rechazada** sin tocar nada. Se comprueba en
-- la tabla de sabotajes en vez de suponerlo (lección de la casa: una
-- escapatoria «inalcanzable» no está cerrada hasta que se mide).
ALTER TABLE "devices" DROP CONSTRAINT "devices_register_o_habitacion";
ALTER TABLE "devices"
    ADD CONSTRAINT "devices_register_o_habitacion"
    CHECK (
        ("kind" = 'ROOM'     AND "room_id" IS NOT NULL AND "register_id" IS NULL)
     OR ("kind" = 'GUARD'    AND "room_id" IS NULL     AND "register_id" IS NULL)
     OR ("kind" = 'HANDOVER' AND "room_id" IS NULL     AND "register_id" IS NULL)
     OR ("kind" NOT IN ('ROOM', 'GUARD', 'HANDOVER')
            AND "room_id" IS NULL AND "register_id" IS NOT NULL)
    );

ALTER TABLE "pairing_codes" DROP CONSTRAINT "pairing_codes_register_o_habitacion";
ALTER TABLE "pairing_codes"
    ADD CONSTRAINT "pairing_codes_register_o_habitacion"
    CHECK (
        ("kind" = 'ROOM'     AND "room_id" IS NOT NULL AND "register_id" IS NULL)
     OR ("kind" = 'GUARD'    AND "room_id" IS NULL     AND "register_id" IS NULL)
     OR ("kind" = 'HANDOVER' AND "room_id" IS NULL     AND "register_id" IS NULL)
     OR ("kind" NOT IN ('ROOM', 'GUARD', 'HANDOVER')
            AND "room_id" IS NULL AND "register_id" IS NOT NULL)
    );
