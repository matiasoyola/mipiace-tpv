-- personal-1 · EL CUADRANTE, Y QUE UN TURNO CAMBIADO DESPUÉS DE PUBLICAR
-- DEJE TRAZA.
--
-- Hoy el cuadrante del mes vive en un Excel («CUADRANTES 2026»), se reparte
-- por WhatsApp y nadie comprueba que cumple la ratio, los descansos o la
-- jornada contratada hasta que alguien se queja. Y cuando un trabajador
-- dice «me cambiaron el turno sin avisar», no hay nada que mirar.
--
-- Cuatro piezas:
--
--   1. `staff_schedules`        · la cabecera mensual: estado, origen y
--      quién lo publicó y cuándo.
--   2. `staff_schedule_cells`   · persona × día → turno o ausencia.
--   3. `staff_schedule_changes` · lo que cambió DESPUÉS de publicar, con
--      quién, cuándo y por qué. Append-only por trigger.
--   4. `set_staff_schedule_day(...)` + los triggers que hacen que 3 sea la
--      única forma de que 2 se mueva en un cuadrante publicado.
--
-- ── POR QUÉ LA TRAZA VA EN EL MOTOR Y NO EN LA RUTA ──────────────────
--
-- Por lo mismo que ADR-018 §3 y ADR-015 §1: la aplicación no es la única
-- puerta a Postgres, y «cambié un turno y escribí la traza» en dos
-- escrituras distintas deja un cambio sin traza el día que una reviente.
-- Aquí la traza y el cambio son la MISMA transacción por construcción —
-- la función escribe la fila de cambio y después toca las celdas, y el
-- trigger de las celdas no las deja moverse sin una fila de cambio de esa
-- misma `txid`.
--
-- Es el patrón de `record_time_entry_correction` con una diferencia que
-- conviene no esconder: allí la función hace un `UPDATE` de una columna;
-- aquí sustituye el CONJUNTO de filas de un (cuadrante, persona, día),
-- porque un día puede tener dos turnos (un partido) y «la celda» no es una
-- fila sola. Por eso una celda no se EDITA nunca: se sustituye, y el
-- trigger rechaza cualquier `UPDATE` sobre la tabla.
--
-- ── LO QUE ESTO NO ES ────────────────────────────────────────────────
--
-- No es el registro de jornada. `time_entries` sigue siendo inalterable por
-- su cuenta y esta migración no toca ni una línea de ADR-018: el cuadrante
-- dice lo que estaba PREVISTO, el registro dice lo que PASÓ, y la gracia
-- del bloque es poder comparar los dos.
--
-- ── EL `down` ────────────────────────────────────────────────────────
--
--   -- 1 · Un cuadrante publicado con cambios registrados es lo que se le
--   --     enseña a la Inspección cuando alguien dice que le cambiaron el
--   --     turno. Falla y lo dice.
--   DO $down$
--   DECLARE n integer;
--   BEGIN
--     SELECT count(*) INTO n FROM "staff_schedule_changes";
--     IF n > 0 THEN
--       RAISE EXCEPTION
--         'No se puede bajar el cuadrante de personal-1: hay % cambio(s) registrados sobre cuadrantes ya publicados, y son la prueba de quién cambió qué turno y por qué. Expórtalos antes y vuelve a intentarlo.', n;
--     END IF;
--   END
--   $down$;
--
--   -- 2 · Y entonces sí, en orden inverso.
--   DROP TRIGGER "staff_schedules_guard" ON "staff_schedules";
--   DROP TRIGGER "staff_schedules_delete_guard" ON "staff_schedules";
--   DROP TRIGGER "staff_schedule_cells_guard" ON "staff_schedule_cells";
--   DROP TRIGGER "staff_schedule_changes_append_only" ON "staff_schedule_changes";
--   DROP FUNCTION set_staff_schedule_day(uuid, uuid, date, uuid[], text, text, text, uuid);
--   DROP FUNCTION mipiacetpv_staff_schedule_change_exists(uuid, uuid, date);
--   DROP FUNCTION mipiacetpv_staff_schedules_guard();
--   DROP FUNCTION mipiacetpv_staff_schedules_delete_guard();
--   DROP FUNCTION mipiacetpv_staff_schedule_cells_guard();
--   DROP FUNCTION mipiacetpv_staff_schedule_changes_append_only();
--   DROP TABLE "staff_schedule_changes";
--   DROP TABLE "staff_schedule_cells";
--   DROP TABLE "staff_schedules";
--   DROP TYPE "StaffAbsenceKind";
--   DROP TYPE "StaffScheduleOrigin";
--   DROP TYPE "StaffScheduleState";
--
-- Migración ADITIVA: tres tablas vacías, tres enums, seis funciones y
-- cuatro triggers que cuelgan de tablas que nacen aquí. No toca ni una
-- fila ni una columna de lo que ya existe, así que no puede interferir con
-- nada en vuelo.

-- ── 0 · los enums ──────────────────────────────────────────────────────

CREATE TYPE "StaffScheduleState"  AS ENUM ('BORRADOR', 'PUBLICADO');

-- `GENERADO` no lo escribe nada todavía: es personal-2, que generará
-- borradores con IA y los dejará para que una persona los publique. La
-- columna nace ahora porque el día que exista hará falta distinguirlos, y
-- añadir un valor a un enum después obliga a repasar quién lo compara.
CREATE TYPE "StaffScheduleOrigin" AS ENUM ('MANUAL', 'GENERADO');

-- Las cinco ausencias, cerradas. Cada una significa algo DISTINTO para las
-- reglas —`LIBRE` cuenta como descanso semanal, `VACACIONES` e `IT` no
-- cuentan como horas planificadas— así que un tipo inventado por un centro
-- no tendría semántica en `comprobarCuadrante` y el aviso saldría mal. Es
-- el mismo criterio de `TimeEntryCorrectionReason`: un desplegable de cinco
-- opciones se contesta de un toque.
CREATE TYPE "StaffAbsenceKind"    AS ENUM
    ('LIBRE', 'VACACIONES', 'IT', 'ASUNTOS_PROPIOS', 'PERMISO');

-- ── 1 · la cabecera mensual ────────────────────────────────────────────

CREATE TABLE "staff_schedules" (
    "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id"            UUID NOT NULL,
    -- «YYYY-MM» de pared del centro. Texto y no `date` por lo mismo que
    -- `center_shifts.starts_at` es texto: un mes no es un instante, y
    -- guardarlo como el día 1 a las 00:00 obligaría a elegir un huso cada
    -- vez que se lee.
    "month"                TEXT NOT NULL,
    "state"                "StaffScheduleState"  NOT NULL DEFAULT 'BORRADOR',
    "origin"               "StaffScheduleOrigin" NOT NULL DEFAULT 'MANUAL',

    "published_at"         TIMESTAMPTZ,
    "published_by_user_id" UUID,
    -- El nombre congelado, como en `time_entry_corrections.author`: un
    -- usuario que se borra no puede dejar muda la firma de un cuadrante.
    "published_by"         TEXT,
    -- Cuántos avisos tenía al publicarse y CUÁLES. «Publicar con avisos
    -- pide confirmarlo y los deja apuntados»: sin esto, a los seis meses
    -- «¿se publicó sabiendo que el sábado faltaba una auxiliar?» no se
    -- puede contestar.
    "warnings_at_publish"  INTEGER,
    "warnings_snapshot"    JSONB,

    "created_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
    "created_by_user_id"   UUID,

    CONSTRAINT "staff_schedules_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
    CONSTRAINT "staff_schedules_published_by_user_id_fkey"
        FOREIGN KEY ("published_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
    CONSTRAINT "staff_schedules_created_by_user_id_fkey"
        FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL,

    CONSTRAINT "staff_schedules_month_formato"
        CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    -- Publicado y sin fecha de publicación, o con fecha y en borrador, son
    -- los dos estados imposibles. Escrito como una equivalencia
    -- (`=` entre dos booleanos) y no como dos ramas: así no hay forma de
    -- arreglar una mitad y olvidar la otra.
    CONSTRAINT "staff_schedules_publicado_entero"
        CHECK (("state" = 'PUBLICADO') = ("published_at" IS NOT NULL)),
    CONSTRAINT "staff_schedules_firma_entera"
        CHECK ("published_at" IS NULL OR btrim(coalesce("published_by", '')) <> '')
);

CREATE UNIQUE INDEX "staff_schedules_tenant_id_month_key"
    ON "staff_schedules"("tenant_id", "month");
CREATE INDEX "staff_schedules_tenant_id_state_idx"
    ON "staff_schedules"("tenant_id", "state");

-- ── 2 · la celda: persona × día → turno o ausencia ─────────────────────
--
-- UNA FILA POR TURNO, no una por celda. Una persona puede tener un turno
-- partido o dos turnos un día (raro, pero existe), y con una columna
-- `shift_id` por celda eso no caben. La pantalla puede dejar el partido
-- para más adelante; el modelo no puede.
CREATE TABLE "staff_schedule_cells" (
    "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id"       UUID NOT NULL,
    "schedule_id"     UUID NOT NULL,
    "employee_id"     UUID NOT NULL,
    "day"             DATE NOT NULL,
    "center_shift_id" UUID,
    "absence_kind"    "StaffAbsenceKind",
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "staff_schedule_cells_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
    CONSTRAINT "staff_schedule_cells_schedule_id_fkey"
        FOREIGN KEY ("schedule_id") REFERENCES "staff_schedules"("id") ON DELETE CASCADE,
    -- `RESTRICT` al empleado: un cuadrante publicado dice quién tenía qué
    -- turno, y una baja DESACTIVA (F1). Si se pudiera borrar al empleado,
    -- la cascada se llevaría su cuadrante.
    CONSTRAINT "staff_schedule_cells_employee_id_fkey"
        FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT,
    -- Y `RESTRICT` al turno, por lo mismo que `care_records`: borrar «la
    -- noche» dejaría un cuadrante publicado apuntando a nada.
    CONSTRAINT "staff_schedule_cells_center_shift_id_fkey"
        FOREIGN KEY ("center_shift_id") REFERENCES "center_shifts"("id") ON DELETE RESTRICT,

    -- Un turno O una ausencia, nunca las dos ni ninguna. `<>` entre dos
    -- `IS NULL` es un XOR y ninguna de las dos mitades puede dar NULL, así
    -- que este CHECK no se puede apagar solo.
    CONSTRAINT "staff_schedule_cells_turno_o_ausencia"
        CHECK (("center_shift_id" IS NULL) <> ("absence_kind" IS NULL))
);

-- El mismo turno dos veces el mismo día a la misma persona es un doble
-- toque, no un turno partido. Con `center_shift_id` a NULL (las filas de
-- ausencia) Postgres considera los NULL distintos y este índice no las
-- toca — de eso se encarga el siguiente.
CREATE UNIQUE INDEX "staff_schedule_cells_un_turno_por_dia_key"
    ON "staff_schedule_cells"("schedule_id", "employee_id", "day", "center_shift_id");

-- Y UNA sola ausencia por persona y día. Parcial y no total: es la mitad
-- que el índice de arriba no puede cubrir, exactamente el caso de
-- `care_zone_assignments_one_live_centro_key` en residencia-1.
CREATE UNIQUE INDEX "staff_schedule_cells_una_ausencia_por_dia_key"
    ON "staff_schedule_cells"("schedule_id", "employee_id", "day")
    WHERE "absence_kind" IS NOT NULL;

CREATE INDEX "staff_schedule_cells_schedule_id_day_idx"
    ON "staff_schedule_cells"("schedule_id", "day");
CREATE INDEX "staff_schedule_cells_employee_id_day_idx"
    ON "staff_schedule_cells"("employee_id", "day");
CREATE INDEX "staff_schedule_cells_tenant_id_day_idx"
    ON "staff_schedule_cells"("tenant_id", "day");

-- ── 3 · el registro de cambios tras publicar ───────────────────────────

CREATE TABLE "staff_schedule_changes" (
    "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id"      UUID NOT NULL,
    "schedule_id"    UUID NOT NULL,
    "employee_id"    UUID NOT NULL,
    "day"            DATE NOT NULL,
    -- Las ETIQUETAS, no los ids: «N» y «VACACIONES», unidas por `+` cuando
    -- el día lleva dos turnos. Un id de turno borrado deja la traza muda,
    -- y la traza es lo que se le enseña a quien dice que le cambiaron el
    -- turno. Mismo criterio que `author` congelado en
    -- `time_entry_corrections`.
    "before_label"   TEXT,
    "after_label"    TEXT,
    -- OBLIGATORIO, y en la base. «Editar una celda publicada sin motivo»
    -- es el sabotaje que esta columna cierra.
    "reason"         TEXT NOT NULL,
    "author"         TEXT NOT NULL,
    "author_user_id" UUID,
    "txid"           BIGINT NOT NULL,
    "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "staff_schedule_changes_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
    CONSTRAINT "staff_schedule_changes_schedule_id_fkey"
        FOREIGN KEY ("schedule_id") REFERENCES "staff_schedules"("id") ON DELETE CASCADE,
    CONSTRAINT "staff_schedule_changes_employee_id_fkey"
        FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT,
    CONSTRAINT "staff_schedule_changes_author_user_id_fkey"
        FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL,

    CONSTRAINT "staff_schedule_changes_con_motivo"
        CHECK (btrim("reason") <> '' AND btrim("author") <> ''),
    -- Un cambio en el que nada había y nada queda no es un cambio.
    CONSTRAINT "staff_schedule_changes_algo_cambia"
        CHECK ("before_label" IS NOT NULL OR "after_label" IS NOT NULL)
);

CREATE INDEX "staff_schedule_changes_schedule_id_created_at_idx"
    ON "staff_schedule_changes"("schedule_id", "created_at");
CREATE INDEX "staff_schedule_changes_tenant_id_created_at_idx"
    ON "staff_schedule_changes"("tenant_id", "created_at");
-- Lo consulta el trigger en CADA escritura de celda de un cuadrante
-- publicado. El nombre es el que generaría Prisma para el `@@index`
-- equivalente: si no, el siguiente `migrate dev` lo vería como sobrante.
CREATE INDEX "staff_schedule_changes_txid_schedule_id_employee_id_day_idx"
    ON "staff_schedule_changes"("txid", "schedule_id", "employee_id", "day");

-- ── 4 · append-only ────────────────────────────────────────────────────

CREATE FUNCTION mipiacetpv_staff_schedule_changes_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    -- Cascada del borrado del cuadrante padre (que sólo puede pasar si el
    -- tenant entero se va: `staff_schedules_delete_guard` lo impide en
    -- cualquier otro caso). La fila padre ya no está, así que esto no es
    -- alguien borrando la traza.
    IF TG_OP = 'DELETE'
       AND NOT EXISTS (SELECT 1 FROM staff_schedules WHERE id = OLD.schedule_id) THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION
        'CUADRANTE_VIOLADO: staff_schedule_changes es append-only (intento de % sobre el cambio %)',
        TG_OP, OLD.id
        USING ERRCODE = '23514';
END;
$fn$;

CREATE TRIGGER "staff_schedule_changes_append_only"
    BEFORE UPDATE OR DELETE ON "staff_schedule_changes"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_staff_schedule_changes_append_only();

-- ¿Hay un cambio registrado, en ESTA transacción, para este (cuadrante,
-- persona, día)? Es lo único que abre la puerta del trigger de las celdas.
-- Copia literal del mecanismo de `mipiacetpv_time_correction_exists`.
CREATE FUNCTION mipiacetpv_staff_schedule_change_exists(
    p_schedule_id uuid,
    p_employee_id uuid,
    p_day         date
) RETURNS boolean
LANGUAGE sql STABLE AS $fn$
    SELECT EXISTS (
        SELECT 1 FROM staff_schedule_changes
         WHERE txid = txid_current()
           AND schedule_id = p_schedule_id
           AND employee_id = p_employee_id
           AND day = p_day
    );
$fn$;

-- ── 5 · la ÚNICA vía para pintar una celda ─────────────────────────────
--
-- Sustituye el conjunto de filas de un (cuadrante, persona, día) por el que
-- se le pasa, y —si el cuadrante está PUBLICADO— deja antes la fila de
-- cambio con quién, cuándo y por qué.
--
-- `SECURITY DEFINER` por la misma razón que `record_time_entry_correction`:
-- hoy el rol de la aplicación es el dueño de las tablas y esto no cambia
-- nada; el día que haya un rol sin escritura sobre `staff_schedule_cells`,
-- lo único que hará falta es un `GRANT EXECUTE` sobre esta función.
--
-- Se usa TAMBIÉN en borrador, donde no escribe traza. Dos caminos (uno
-- directo para el borrador y éste para el publicado) habrían dejado la
-- pregunta «¿cuál de los dos valida el día?» con dos respuestas.
--
-- Y es IDEMPOTENTE: si lo que ya hay es exactamente lo que se pide, no
-- toca nada y no escribe cambio. Es lo que permite que «copiar la semana
-- anterior» se pueda repetir sin inundar el registro de cambios con filas
-- que no cambian nada.
CREATE FUNCTION set_staff_schedule_day(
    p_schedule_id    uuid,
    p_employee_id    uuid,
    p_day            date,
    p_shift_ids      uuid[],
    p_absence        text,
    p_reason         text DEFAULT NULL,
    p_author         text DEFAULT NULL,
    p_author_user_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
    v_tenant_id uuid;
    v_month     text;
    v_state     text;
    v_before    text;
    v_after     text;
    v_change_id uuid;
    v_shift     uuid;
    v_n         integer;
BEGIN
    SELECT tenant_id, month, state::text
      INTO v_tenant_id, v_month, v_state
      FROM staff_schedules WHERE id = p_schedule_id;
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'CUADRANTE_INVALIDO: el cuadrante % no existe', p_schedule_id
            USING ERRCODE = '23514';
    END IF;

    -- El día tiene que ser del mes del cuadrante. Un CHECK no puede
    -- decirlo (está en otra tabla), así que lo dice esto y lo repite el
    -- trigger de las celdas para quien entre por otra puerta.
    IF to_char(p_day, 'YYYY-MM') <> v_month THEN
        RAISE EXCEPTION
            'CUADRANTE_INVALIDO: el día % no es del mes % de este cuadrante', p_day, v_month
            USING ERRCODE = '23514';
    END IF;

    IF p_absence IS NOT NULL AND coalesce(array_length(p_shift_ids, 1), 0) > 0 THEN
        RAISE EXCEPTION
            'CUADRANTE_INVALIDO: un día es turno O ausencia, no las dos cosas'
            USING ERRCODE = '23514';
    END IF;

    IF p_employee_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM employees
                       WHERE id = p_employee_id AND tenant_id = v_tenant_id) THEN
        RAISE EXCEPTION
            'CUADRANTE_INVALIDO: la persona % no es de esta empresa', p_employee_id
            USING ERRCODE = '23514';
    END IF;

    -- Los turnos, uno por uno y del mismo tenant. Sin esto, el cuadrante
    -- de una empresa podría pintar el turno de otra: el aislamiento por
    -- fila no lo da la FK, que sólo mira que el turno exista.
    IF p_shift_ids IS NOT NULL THEN
        FOREACH v_shift IN ARRAY p_shift_ids LOOP
            IF NOT EXISTS (SELECT 1 FROM center_shifts
                            WHERE id = v_shift AND tenant_id = v_tenant_id) THEN
                RAISE EXCEPTION
                    'CUADRANTE_INVALIDO: el turno % no es de esta empresa', v_shift
                    USING ERRCODE = '23514';
            END IF;
        END LOOP;
    END IF;

    -- ── lo que había y lo que queda, como etiqueta ──────────────────
    --
    -- Ordenado por el orden del turno y después por su código, para que
    -- «M+T» y «T+M» no sean dos etiquetas distintas del mismo día.
    SELECT string_agg(etiqueta, '+' ORDER BY orden, etiqueta) INTO v_before
      FROM (
        SELECT coalesce(cs.code, c.absence_kind::text) AS etiqueta,
               coalesce(cs.sort_order, 999)            AS orden
          FROM staff_schedule_cells c
          LEFT JOIN center_shifts cs ON cs.id = c.center_shift_id
         WHERE c.schedule_id = p_schedule_id
           AND c.employee_id = p_employee_id
           AND c.day = p_day
      ) x;

    IF p_absence IS NOT NULL THEN
        v_after := p_absence;
    ELSE
        SELECT string_agg(cs.code, '+' ORDER BY cs.sort_order, cs.code) INTO v_after
          FROM center_shifts cs
         WHERE cs.id = ANY (coalesce(p_shift_ids, ARRAY[]::uuid[]));
    END IF;

    -- Idempotencia. `IS NOT DISTINCT FROM` y no `=`: los dos pueden ser
    -- NULL («el día estaba y sigue vacío») y con `=` eso daría NULL y la
    -- rama no se tomaría.
    IF v_before IS NOT DISTINCT FROM v_after THEN
        RETURN NULL;
    END IF;

    -- ── la traza, ANTES de tocar nada ──────────────────────────────
    IF v_state = 'PUBLICADO' THEN
        IF p_reason IS NULL OR btrim(p_reason) = '' THEN
            RAISE EXCEPTION
                'CUADRANTE_SIN_MOTIVO: un cuadrante publicado no se cambia sin decir por qué'
                USING ERRCODE = '23514';
        END IF;
        IF p_author IS NULL OR btrim(p_author) = '' THEN
            RAISE EXCEPTION
                'CUADRANTE_SIN_AUTOR: un cambio sin autor no se escribe'
                USING ERRCODE = '23514';
        END IF;
        INSERT INTO staff_schedule_changes
            (tenant_id, schedule_id, employee_id, day,
             before_label, after_label, reason, author, author_user_id, txid)
        VALUES
            (v_tenant_id, p_schedule_id, p_employee_id, p_day,
             v_before, v_after, btrim(p_reason), btrim(p_author),
             p_author_user_id, txid_current())
        RETURNING id INTO v_change_id;
    END IF;

    DELETE FROM staff_schedule_cells
     WHERE schedule_id = p_schedule_id
       AND employee_id = p_employee_id
       AND day = p_day;

    IF p_absence IS NOT NULL THEN
        INSERT INTO staff_schedule_cells
            (tenant_id, schedule_id, employee_id, day, absence_kind)
        VALUES
            (v_tenant_id, p_schedule_id, p_employee_id, p_day,
             p_absence::"StaffAbsenceKind");
    ELSIF coalesce(array_length(p_shift_ids, 1), 0) > 0 THEN
        INSERT INTO staff_schedule_cells
            (tenant_id, schedule_id, employee_id, day, center_shift_id)
        SELECT v_tenant_id, p_schedule_id, p_employee_id, p_day, s
          FROM unnest(p_shift_ids) AS s
         GROUP BY s;
    END IF;

    UPDATE staff_schedules SET updated_at = now() WHERE id = p_schedule_id;
    RETURN v_change_id;
END;
$fn$;

-- ── 6 · los triggers ───────────────────────────────────────────────────

-- El guard de las celdas. Tres cosas:
--
--   1. una celda NO se edita nunca: se sustituye. Un `UPDATE` sobre esta
--      tabla se rechaza siempre, también en borrador, porque «la celda» no
--      es una fila (un día partido son dos) y mover una de las dos dejaría
--      una etiqueta a medias en el registro de cambios.
--   2. el día tiene que ser del mes del cuadrante, y un día no puede tener
--      turno y ausencia a la vez. Lo dice la función, y lo repite aquí
--      para quien entre por psql.
--   3. en un cuadrante PUBLICADO, nada se mueve sin una fila de cambio de
--      ESTA transacción. Es lo que hace que «cambiar un turno publicado
--      sin motivo» sea imposible y no sólo mala costumbre.
CREATE FUNCTION mipiacetpv_staff_schedule_cells_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
    v_month       text;
    v_state       text;
    v_schedule_id uuid;
    v_employee_id uuid;
    v_day         date;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION
            'CUADRANTE_VIOLADO: una celda del cuadrante no se edita, se sustituye (set_staff_schedule_day)'
            USING ERRCODE = '23514';
    END IF;

    -- Las tres columnas que identifican la celda, de la fila que toque.
    -- Tres variables y no una de tipo `staff_schedule_cells`: un `CASE`
    -- sobre `OLD`/`NEW` depende de cómo plpgsql resuelva el rowtype, y
    -- esto se lee igual.
    IF TG_OP = 'DELETE' THEN
        v_schedule_id := OLD.schedule_id;
        v_employee_id := OLD.employee_id;
        v_day         := OLD.day;
    ELSE
        v_schedule_id := NEW.schedule_id;
        v_employee_id := NEW.employee_id;
        v_day         := NEW.day;
    END IF;

    SELECT month, state::text INTO v_month, v_state
      FROM staff_schedules WHERE id = v_schedule_id;

    -- Cascada del borrado del cuadrante (o del tenant): el padre ya no
    -- está. Comprobado contra el estado real y no contra una promesa.
    IF v_month IS NULL THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RAISE EXCEPTION
            'CUADRANTE_INVALIDO: el cuadrante % no existe', v_schedule_id
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF to_char(NEW.day, 'YYYY-MM') <> v_month THEN
            RAISE EXCEPTION
                'CUADRANTE_INVALIDO: el día % no es del mes % de este cuadrante', NEW.day, v_month
                USING ERRCODE = '23514';
        END IF;
        -- Turno y ausencia el mismo día a la misma persona. Los dos índices
        -- únicos no lo cubren —uno mira los turnos y el otro las
        -- ausencias— y «de vacaciones y de turno de noche» es justo el
        -- estado del que después nadie se fía.
        IF EXISTS (
            SELECT 1 FROM staff_schedule_cells
             WHERE schedule_id = NEW.schedule_id
               AND employee_id = NEW.employee_id
               AND day = NEW.day
               AND (NEW.absence_kind IS NOT NULL) = (center_shift_id IS NOT NULL)
        ) THEN
            RAISE EXCEPTION
                'CUADRANTE_INVALIDO: ese día ya tiene turno o ausencia de la otra clase; un turno y una ausencia no caben juntos'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF v_state = 'PUBLICADO'
       AND NOT mipiacetpv_staff_schedule_change_exists(
                   v_schedule_id, v_employee_id, v_day) THEN
        RAISE EXCEPTION
            'CUADRANTE_SIN_MOTIVO: el cuadrante % está publicado; un turno suyo sólo se mueve por set_staff_schedule_day, con motivo y autor',
            v_schedule_id
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$fn$;

CREATE TRIGGER "staff_schedule_cells_guard"
    BEFORE INSERT OR UPDATE OR DELETE ON "staff_schedule_cells"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_staff_schedule_cells_guard();

-- Publicar FIJA. Lo que no puede cambiar de una cabecera publicada: el
-- estado (no se despublica), el mes, el tenant, la firma y el origen.
--
-- Despublicar sería la forma elegante de borrar el registro de cambios:
-- bajas a borrador, mueves lo que quieras sin traza y vuelves a publicar.
-- Por eso no hay ruta y por eso además lo impide el motor.
CREATE FUNCTION mipiacetpv_staff_schedules_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF OLD.month <> NEW.month OR OLD.tenant_id <> NEW.tenant_id THEN
        RAISE EXCEPTION
            'CUADRANTE_VIOLADO: el mes y la empresa de un cuadrante no se cambian (cuadrante %)', OLD.id
            USING ERRCODE = '23514';
    END IF;
    IF OLD.state = 'PUBLICADO' THEN
        IF NEW.state <> 'PUBLICADO' THEN
            RAISE EXCEPTION
                'CUADRANTE_VIOLADO: un cuadrante publicado no vuelve a borrador (cuadrante %). Los cambios se hacen sobre el publicado, con motivo.', OLD.id
                USING ERRCODE = '23514';
        END IF;
        IF OLD.published_at <> NEW.published_at
           OR OLD.published_by IS DISTINCT FROM NEW.published_by
           OR OLD.published_by_user_id IS DISTINCT FROM NEW.published_by_user_id
           OR OLD.origin <> NEW.origin THEN
            RAISE EXCEPTION
                'CUADRANTE_VIOLADO: la firma y el origen de un cuadrante publicado no se mueven (cuadrante %)', OLD.id
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$fn$;

CREATE TRIGGER "staff_schedules_guard"
    BEFORE UPDATE ON "staff_schedules"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_staff_schedules_guard();

-- Y un cuadrante publicado no se borra. La única escapatoria es la de
-- siempre, comprobada contra el estado real: el tenant ya no existe, así
-- que esto es la cascada de su borrado.
CREATE FUNCTION mipiacetpv_staff_schedules_delete_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
        RETURN OLD;
    END IF;
    IF OLD.state <> 'PUBLICADO' THEN
        RETURN OLD;   -- un borrador se tira; no se le ha enseñado a nadie
    END IF;
    RAISE EXCEPTION
        'CUADRANTE_VIOLADO: el cuadrante % está publicado y no se borra. Es lo que su gente vio en el móvil.', OLD.id
        USING ERRCODE = '23514';
END;
$fn$;

CREATE TRIGGER "staff_schedules_delete_guard"
    BEFORE DELETE ON "staff_schedules"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_staff_schedules_delete_guard();
