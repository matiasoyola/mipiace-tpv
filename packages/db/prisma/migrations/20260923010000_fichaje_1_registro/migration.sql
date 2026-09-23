-- F1 · el registro de jornada es inalterable (ADR-018).
--
-- Art. 34.9 del Estatuto de los Trabajadores: registro diario de jornada
-- con la hora concreta de inicio y de fin de cada trabajador, conservado 4
-- años y a disposición del trabajador, de sus representantes y de la
-- Inspección de Trabajo. El borrador del RD de registro digital —sin
-- aprobar— añade tres cosas: que sea inalterable, que registre cada cambio
-- y que se pueda consultar en remoto.
--
-- Esta migración trae las dos primeras, y las trae DONDE TIENEN QUE ESTAR:
-- en el motor. La disciplina de la aplicación no vale, por lo mismo que no
-- valía para la venta (ADR-015 §1, y la auditoría del 2026-09-05 que lo
-- midió): la aplicación no es la única puerta a Postgres.
--
-- Cinco piezas:
--
--   1. `employees` · quien ficha. Ni `User` ni `StaffProfile` — ver el
--      comentario del modelo en schema.prisma.
--   2. `employee_devices` + `employee_pairing_tokens` · el móvil personal,
--      con el patrón de `/devices/pair` pero SIN caja de por medio.
--   3. `time_entries` · el tramo trabajado.
--   4. `time_entry_corrections` + `record_time_entry_correction(...)` · la
--      ÚNICA vía por la que una hora puede cambiar. Append-only.
--   5. Los triggers que hacen cumplir 3 y 4.
--
-- SQL a mano porque Prisma no expresa triggers, funciones ni índices
-- parciales. Mismo patrón que `s1_sello_de_la_venta` y que el índice
-- parcial de `v1_8_fiado`.
--
-- Migración ADITIVA: crea objetos nuevos y no toca ni una fila ni una
-- columna de lo que ya existe. Un tenant de hoy tiene `fichaje_enabled =
-- false` (migración hermana `20260923000000_fichaje_1_modulo`) y estas
-- tablas se quedan vacías para siempre.

-- ── 0 · los enums ──────────────────────────────────────────────────────

CREATE TYPE "TimeEntrySource" AS ENUM ('MOBILE', 'PANEL');
CREATE TYPE "TimeEntryCorrectionAuthor" AS ENUM ('EMPLOYEE', 'PANEL');
CREATE TYPE "TimeEntryCorrectionReason" AS ENUM ('OLVIDO', 'ERROR_HORA', 'OTRO');

-- ── 1 · quien ficha ────────────────────────────────────────────────────

CREATE TABLE "employees" (
    "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id"      UUID NOT NULL,
    "name"           TEXT NOT NULL,
    "email"          TEXT,
    "phone"          TEXT,
    "user_id"        UUID,
    -- La baja DESACTIVA. El borrado no existe: los registros de un
    -- empleado que se va se conservan 4 años igual que los de uno que
    -- sigue. Lo hace cumplir el trigger de la pieza 5.
    "active"         BOOLEAN NOT NULL DEFAULT true,
    "deactivated_at" TIMESTAMPTZ,
    "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "employees_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- SET NULL y no CASCADE: si alguien borra el usuario del panel, el
    -- empleado y sus fichajes siguen ahí. La identidad del registro es la
    -- fila de `employees`, no la cuenta de acceso.
    CONSTRAINT "employees_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "employees_name_not_blank" CHECK (btrim("name") <> '')
);

-- Un `User` no puede ser dos empleados del mismo tenant. Postgres permite
-- NULLs repetidos en un índice único, así que los empleados sin usuario
-- —la mayoría: un profesor no entra al panel— no chocan entre sí.
CREATE UNIQUE INDEX "employees_tenant_id_user_id_key"
    ON "employees"("tenant_id", "user_id");
CREATE INDEX "employees_tenant_id_active_idx"
    ON "employees"("tenant_id", "active");

-- ── 2 · el móvil personal ──────────────────────────────────────────────

CREATE TABLE "employee_devices" (
    "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id"         UUID NOT NULL,
    "employee_id"       UUID NOT NULL,
    -- SHA-256 del token, como `devices.device_token_hash`: alta entropía
    -- (32 bytes random), así que basta el hash rápido y permite el lookup
    -- O(1) por índice único. Argon2id es para PINs y contraseñas.
    "device_token_hash" TEXT NOT NULL,
    "paired_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
    "last_seen_at"      TIMESTAMPTZ,
    "revoked_at"        TIMESTAMPTZ,
    "user_agent"        TEXT,

    CONSTRAINT "employee_devices_employee_id_fkey"
        FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "employee_devices_device_token_hash_key"
    ON "employee_devices"("device_token_hash");
CREATE INDEX "employee_devices_tenant_id_idx"
    ON "employee_devices"("tenant_id");
CREATE INDEX "employee_devices_employee_id_revoked_at_idx"
    ON "employee_devices"("employee_id", "revoked_at");

-- UN móvil activo por empleado, garantizado POR LA BASE.
--
-- Emparejar uno nuevo revoca el anterior en la misma transacción. Si ese
-- UPDATE no corriera —un `if` que alguien quita, un camino nuevo que se
-- olvida—, el INSERT revienta aquí en vez de dejar dos móviles vivos. Un
-- enlace reenviado y un móvil perdido dependen de esto.
CREATE UNIQUE INDEX "employee_devices_one_active_key"
    ON "employee_devices"("employee_id") WHERE "revoked_at" IS NULL;

CREATE TABLE "employee_pairing_tokens" (
    "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id"             UUID NOT NULL,
    "employee_id"           UUID NOT NULL,
    "token_hash"            TEXT NOT NULL,
    "expires_at"            TIMESTAMPTZ NOT NULL,
    "consumed_at"           TIMESTAMPTZ,
    "consumed_by_device_id" UUID,
    "created_by_user_id"    UUID,
    "created_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "employee_pairing_tokens_employee_id_fkey"
        FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "employee_pairing_tokens_token_hash_key"
    ON "employee_pairing_tokens"("token_hash");
CREATE INDEX "employee_pairing_tokens_tenant_id_idx"
    ON "employee_pairing_tokens"("tenant_id");
CREATE INDEX "employee_pairing_tokens_employee_id_consumed_at_idx"
    ON "employee_pairing_tokens"("employee_id", "consumed_at");

-- ── 3 · el tramo trabajado ─────────────────────────────────────────────

CREATE TABLE "time_entries" (
    "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id"   UUID NOT NULL,
    "employee_id" UUID NOT NULL,

    -- LA HORA QUE CUENTA: la del toque. Sólo la mueve
    -- `record_time_entry_correction()`.
    "started_at" TIMESTAMPTZ NOT NULL,
    "ended_at"   TIMESTAMPTZ,

    -- La procedencia. INMUTABLE: el trigger la congela. `*_device_at` es
    -- lo que marcó el reloj del móvil al tocar (NULL si lo metió el panel:
    -- ahí nadie tocó nada); `*_server_at` es cuándo llegó al servidor.
    --
    -- "Enviado sin conexión" se DERIVA de estas dos y no se guarda como
    -- flag: un flag puede quedar desincronizado de lo que lo justifica.
    "started_device_at" TIMESTAMPTZ,
    "started_server_at" TIMESTAMPTZ NOT NULL,
    "ended_device_at"   TIMESTAMPTZ,
    "ended_server_at"   TIMESTAMPTZ,

    "start_source" "TimeEntrySource" NOT NULL,
    "end_source"   "TimeEntrySource",

    -- Idempotencia de la cola offline del móvil.
    "start_external_id" TEXT,
    "end_external_id"   TEXT,

    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "time_entries_employee_id_fkey"
        FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- Un tramo no puede terminar antes de empezar. Es el suelo que ninguna
    -- corrección puede saltarse: la función de corrección hace el UPDATE y
    -- este CHECK lo evalúa después, como cualquier otro.
    CONSTRAINT "time_entries_ended_after_started"
        CHECK ("ended_at" IS NULL OR "ended_at" > "started_at"),
    -- Si hay salida, tiene que haber procedencia de la salida. Sin esto,
    -- un UPDATE a mano podría cerrar un tramo sin decir de dónde sale la
    -- hora, que es la mitad de lo que la Inspección mira.
    CONSTRAINT "time_entries_end_provenance"
        CHECK (("ended_at" IS NULL) = ("end_source" IS NULL)
           AND ("ended_at" IS NULL) = ("ended_server_at" IS NULL))
);

CREATE UNIQUE INDEX "time_entries_start_external_id_key"
    ON "time_entries"("start_external_id");
CREATE UNIQUE INDEX "time_entries_end_external_id_key"
    ON "time_entries"("end_external_id");
CREATE INDEX "time_entries_tenant_id_started_at_idx"
    ON "time_entries"("tenant_id", "started_at");
CREATE INDEX "time_entries_employee_id_started_at_idx"
    ON "time_entries"("employee_id", "started_at");

-- COMO MUCHO UN TRAMO ABIERTO POR EMPLEADO, garantizado POR LA BASE.
--
-- El prompt lo pide así y tiene razón: dos tramos abiertos a la vez son
-- horas contadas dos veces, y "el código mira antes de insertar" se cae en
-- cuanto dos toques llegan a la vez desde la cola offline.
CREATE UNIQUE INDEX "time_entries_one_open_key"
    ON "time_entries"("employee_id") WHERE "ended_at" IS NULL;

-- ── 4 · la vía de corrección ───────────────────────────────────────────

CREATE TABLE "time_entry_corrections" (
    "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id"     UUID NOT NULL,
    "time_entry_id" UUID NOT NULL,
    "field"         TEXT NOT NULL,
    "old_value"     TEXT,
    "new_value"     TEXT,

    "reason_code" "TimeEntryCorrectionReason" NOT NULL,
    "reason_text" TEXT,

    "author_kind" "TimeEntryCorrectionAuthor" NOT NULL,
    -- Nombre legible, congelado aquí. Un empleado dado de baja o un
    -- usuario borrado no pueden dejar la traza muda.
    "author"      TEXT NOT NULL,
    "employee_id" UUID,
    "user_id"     UUID,

    "txid"       BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "time_entry_corrections_time_entry_id_fkey"
        FOREIGN KEY ("time_entry_id") REFERENCES "time_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- Sólo las horas se corrigen. La identidad de la fila y su procedencia
    -- no: eso no es corregir, es reescribir de dónde vino el dato.
    CONSTRAINT "time_entry_corrections_field_check"
        CHECK ("field" IN ('started_at', 'ended_at')),
    -- El motivo es el precio de entrada, igual que en S1. Una corrección
    -- sin motivo no es una corrección: es la misma manipulación con otro
    -- nombre. Aquí el motivo es un ENUM porque se contesta de un toque, y
    -- `OTRO` —el único que admite matices— exige el texto.
    CONSTRAINT "time_entry_corrections_otro_needs_text"
        CHECK ("reason_code" <> 'OTRO' OR btrim(coalesce("reason_text", '')) <> ''),
    CONSTRAINT "time_entry_corrections_author_not_blank"
        CHECK (btrim("author") <> ''),
    -- Quien firma tiene que existir como tal. Un `EMPLOYEE` sin
    -- `employee_id` sería una corrección anónima con apariencia de firmada.
    CONSTRAINT "time_entry_corrections_author_id"
        CHECK (
            ("author_kind" = 'EMPLOYEE' AND "employee_id" IS NOT NULL)
         OR ("author_kind" = 'PANEL'    AND "user_id"     IS NOT NULL)
        )
);

CREATE INDEX "time_entry_corrections_time_entry_id_created_at_idx"
    ON "time_entry_corrections"("time_entry_id", "created_at");
CREATE INDEX "time_entry_corrections_tenant_id_created_at_idx"
    ON "time_entry_corrections"("tenant_id", "created_at");
-- El trigger busca por aquí en CADA update de una columna de hora. El
-- nombre es el que generaría Prisma para el `@@index` del modelo: si no,
-- el siguiente `migrate dev` lo vería como sobrante y lo borraría. Misma
-- nota que en S1.
CREATE INDEX "time_entry_corrections_txid_time_entry_id_field_idx"
    ON "time_entry_corrections"("txid", "time_entry_id", "field");

-- La tabla de correcciones es append-only. Si se pudiera editar o borrar,
-- la traza valdría lo mismo que no tenerla — y la traza es justo lo que
-- hace defendible el registro.
CREATE FUNCTION mipiacetpv_time_corrections_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    -- Cascada del borrado del tramo padre: la fila padre ya no está. No es
    -- alguien borrando la traza. (Postgres borra el padre y DESPUÉS dispara
    -- la cascada, así que aquí ya no se ve.) Y borrar el tramo padre sólo
    -- puede pasar si el TENANT entero se va — lo impide el trigger de la
    -- pieza 5.
    IF TG_OP = 'DELETE'
       AND NOT EXISTS (SELECT 1 FROM time_entries WHERE id = OLD.time_entry_id) THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION
        'REGISTRO_VIOLADO: time_entry_corrections es append-only (intento de % sobre la corrección %)',
        TG_OP, OLD.id
        USING ERRCODE = '23514';
END;
$fn$;

CREATE TRIGGER "time_entry_corrections_append_only"
    BEFORE UPDATE OR DELETE ON "time_entry_corrections"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_time_corrections_append_only();

-- ¿Hay una corrección viva, en ESTA transacción, para esta columna de este
-- tramo? Es lo único que abre la puerta del trigger. Copia literal del
-- mecanismo de `mipiacetpv_correction_exists` de S1.
CREATE FUNCTION mipiacetpv_time_correction_exists(p_entry_id uuid, p_field text)
RETURNS boolean
LANGUAGE sql STABLE AS $fn$
    SELECT EXISTS (
        SELECT 1 FROM time_entry_corrections
         WHERE txid = txid_current()
           AND time_entry_id = p_entry_id
           AND field = p_field
    );
$fn$;

-- La API de la corrección. NADIE escribe `started_at` ni `ended_at` a
-- mano: se llama a esto, que lee el valor anterior del propio motor, deja
-- la fila de traza y HACE el UPDATE. Así la traza y el cambio son la misma
-- transacción por construcción — si una revienta, se van las dos.
--
-- SECURITY DEFINER por la misma razón que en S1: hoy el rol de la
-- aplicación es el dueño de las tablas y esto no cambia nada; el día que
-- se despliegue un rol sin UPDATE sobre `time_entries`, lo único que hará
-- falta es un GRANT EXECUTE sobre esta función. La frontera ya está donde
-- tiene que estar.
CREATE FUNCTION record_time_entry_correction(
    p_entry_id    uuid,
    p_field       text,
    p_new_value   timestamptz,
    p_reason_code text,
    p_reason_text text,
    p_author_kind text,
    p_author      text,
    p_employee_id uuid DEFAULT NULL,
    p_user_id     uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
    v_tenant_id uuid;
    v_old       text;
    v_id        uuid;
BEGIN
    IF p_field NOT IN ('started_at', 'ended_at') THEN
        RAISE EXCEPTION
            'CORRECCION_INVALIDA: la columna time_entries.% no se corrige', p_field
            USING ERRCODE = '23514';
    END IF;
    IF p_reason_code IS NULL OR p_reason_code NOT IN ('OLVIDO', 'ERROR_HORA', 'OTRO') THEN
        RAISE EXCEPTION
            'CORRECCION_SIN_MOTIVO: una corrección sin motivo no se escribe'
            USING ERRCODE = '23514';
    END IF;
    IF p_reason_code = 'OTRO' AND btrim(coalesce(p_reason_text, '')) = '' THEN
        RAISE EXCEPTION
            'CORRECCION_SIN_MOTIVO: el motivo "Otro" exige decir cuál'
            USING ERRCODE = '23514';
    END IF;
    IF p_author IS NULL OR btrim(p_author) = '' THEN
        RAISE EXCEPTION
            'CORRECCION_SIN_AUTOR: una corrección sin autor no se escribe'
            USING ERRCODE = '23514';
    END IF;
    -- Una salida no se "corrige" a NULL: eso es reabrir un tramo cerrado,
    -- que es borrar el registro con otro nombre.
    IF p_new_value IS NULL THEN
        RAISE EXCEPTION
            'CORRECCION_INVALIDA: una hora no se corrige a vacío. Un tramo cerrado no se reabre.'
            USING ERRCODE = '23514';
    END IF;

    SELECT tenant_id INTO v_tenant_id FROM time_entries WHERE id = p_entry_id;
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'CORRECCION_INVALIDA: el fichaje % no existe', p_entry_id
            USING ERRCODE = '23514';
    END IF;

    EXECUTE format('SELECT to_jsonb(x) ->> %L FROM time_entries x WHERE x.id = $1', p_field)
       INTO v_old USING p_entry_id;

    INSERT INTO time_entry_corrections
        (tenant_id, time_entry_id, field, old_value, new_value,
         reason_code, reason_text, author_kind, author, employee_id, user_id, txid)
    -- El valor nuevo se renderiza EXACTAMENTE como el anterior
    -- (`to_jsonb(...)->>`), no con `::text`. Si no, la misma hora quedaría
    -- escrita de dos formas distintas en la misma fila —
    -- `2026-09-22T06:00:00+00:00` contra `2026-09-22 06:00:00+00`— y el
    -- PDF que firma el trabajador pintaría un cambio donde no lo hay.
    VALUES
        (v_tenant_id, p_entry_id, p_field, v_old, to_jsonb(p_new_value) #>> '{}',
         p_reason_code::"TimeEntryCorrectionReason",
         nullif(btrim(coalesce(p_reason_text, '')), ''),
         p_author_kind::"TimeEntryCorrectionAuthor",
         btrim(p_author), p_employee_id, p_user_id, txid_current())
    RETURNING id INTO v_id;

    -- Cerrar por esta vía (una salida olvidada que se contesta al día
    -- siguiente) también tiene que dejar la procedencia. `PANEL` o
    -- `MOBILE` según quién firme: el que contesta la pregunta es quien
    -- pone la hora.
    IF p_field = 'ended_at' THEN
        UPDATE time_entries
           SET ended_at        = p_new_value,
               ended_server_at = coalesce(ended_server_at, now()),
               end_source      = coalesce(
                   end_source,
                   CASE WHEN p_author_kind = 'EMPLOYEE' THEN 'MOBILE' ELSE 'PANEL' END::"TimeEntrySource"
               )
         WHERE id = p_entry_id;
    ELSE
        UPDATE time_entries SET started_at = p_new_value WHERE id = p_entry_id;
    END IF;

    RETURN v_id;
END;
$fn$;

-- ── 5 · los triggers del registro ──────────────────────────────────────

-- El guard. Lo que puede y lo que no puede cambiar de un `time_entries`:
--
--   started_at            · cualquier cambio exige corrección en ESTA txid.
--   ended_at NULL→valor   · es el FICHAJE DE SALIDA, la segunda mitad del
--                           mismo hecho. Permitido sin corrección, pero
--                           sólo si el mismo UPDATE trae la procedencia
--                           (`ended_server_at` y `end_source`): un
--                           `SET ended_at = ...` a pelo desde psql no la
--                           trae y se rechaza.
--   ended_at valor→otro   · exige corrección.
--   ended_at valor→NULL   · PROHIBIDO siempre. Reabrir un tramo cerrado es
--                           borrar el registro con otro nombre.
--   id, tenant_id, employee_id, las cuatro columnas de procedencia y
--   start_source · INMUTABLES. Sin vía de corrección, sin excepción.
--
-- Por qué la salida no exige corrección y la entrada tampoco deja traza:
-- el INSERT del tramo no escribe ninguna fila de log y nadie lo echa en
-- falta, porque la fila ES el registro. Cerrar el tramo es el mismo acto,
-- ocho horas después. Exigir traza para la segunda mitad y no para la
-- primera sería una asimetría sin dueño. La frontera es la de ADR-015: el
-- dato se sella cuando queda completo, y desde ahí sólo se corrige.
CREATE FUNCTION mipiacetpv_time_entries_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF NEW.id          IS DISTINCT FROM OLD.id
       OR NEW.tenant_id   IS DISTINCT FROM OLD.tenant_id
       OR NEW.employee_id IS DISTINCT FROM OLD.employee_id THEN
        RAISE EXCEPTION
            'REGISTRO_VIOLADO: la identidad de un fichaje no se reescribe (fichaje %)',
            OLD.id USING ERRCODE = '23514';
    END IF;

    -- Reabrir va ANTES del congelado de la procedencia. Si no, quitar la
    -- salida se rechazaría igual pero con el mensaje equivocado ("la
    -- procedencia no se corrige"), porque para quitarla hay que anular
    -- también `ended_server_at`. El motivo de verdad es éste.
    IF OLD.ended_at IS NOT NULL AND NEW.ended_at IS NULL THEN
        RAISE EXCEPTION
            'REGISTRO_VIOLADO: un fichaje cerrado no se reabre (fichaje %). Se corrige la hora, no se borra la salida.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    IF NEW.started_device_at IS DISTINCT FROM OLD.started_device_at
       OR NEW.started_server_at IS DISTINCT FROM OLD.started_server_at
       OR NEW.start_source      IS DISTINCT FROM OLD.start_source
       OR (OLD.ended_device_at IS NOT NULL
           AND NEW.ended_device_at IS DISTINCT FROM OLD.ended_device_at)
       OR (OLD.ended_server_at IS NOT NULL
           AND NEW.ended_server_at IS DISTINCT FROM OLD.ended_server_at)
       OR (OLD.end_source IS NOT NULL
           AND NEW.end_source IS DISTINCT FROM OLD.end_source) THEN
        RAISE EXCEPTION
            'REGISTRO_VIOLADO: la procedencia de un fichaje no se corrige (fichaje %). Dice de dónde salió la hora.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    IF NEW.started_at IS DISTINCT FROM OLD.started_at
       AND NOT mipiacetpv_time_correction_exists(OLD.id, 'started_at') THEN
        RAISE EXCEPTION
            'REGISTRO_VIOLADO: la entrada del fichaje % sólo se cambia con record_time_entry_correction().',
            OLD.id USING ERRCODE = '23514';
    END IF;

    IF NEW.ended_at IS DISTINCT FROM OLD.ended_at THEN
        IF OLD.ended_at IS NULL THEN
            -- El fichaje de salida. Sin corrección, pero con procedencia:
            -- el UPDATE tiene que decir de dónde sale la hora.
            IF NEW.ended_at IS NULL
               OR NEW.ended_server_at IS NULL
               OR NEW.end_source IS NULL THEN
                RAISE EXCEPTION
                    'REGISTRO_VIOLADO: cerrar el fichaje % exige decir de dónde sale la hora (ended_server_at y end_source).',
                    OLD.id USING ERRCODE = '23514';
            END IF;
        -- (el caso valor→NULL ya lo ha rechazado la guarda de arriba)
        ELSIF NOT mipiacetpv_time_correction_exists(OLD.id, 'ended_at') THEN
            RAISE EXCEPTION
                'REGISTRO_VIOLADO: la salida del fichaje % sólo se cambia con record_time_entry_correction().',
                OLD.id USING ERRCODE = '23514';
        END IF;
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
END;
$fn$;

CREATE TRIGGER "time_entries_registro_guard"
    BEFORE UPDATE ON "time_entries"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_time_entries_guard();

-- Un fichaje NO SE BORRA. Ni por la API, ni por el panel, ni por el
-- super-admin, ni a mano. Se corrige.
--
-- Una sola escapatoria, comprobada contra el estado real y no contra una
-- promesa: el tenant ya no existe, así que esto es la cascada de su
-- borrado y no alguien limpiando un registro. Misma forma exacta que
-- `mipiacetpv_tickets_delete_guard` en S1 — y sin la excepción del cajero
-- TEST, porque aquí no hay datos de prueba que purgar.
CREATE FUNCTION mipiacetpv_time_entries_delete_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION
        'REGISTRO_VIOLADO: un fichaje no se borra (fichaje %). Se conserva 4 años y se corrige, nunca se quita.',
        OLD.id USING ERRCODE = '23514';
END;
$fn$;

CREATE TRIGGER "time_entries_delete_guard"
    BEFORE DELETE ON "time_entries"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_time_entries_delete_guard();

-- Y un empleado tampoco se borra mientras tenga registros: la baja
-- DESACTIVA. Si se pudiera borrar, el ON DELETE CASCADE de `time_entries`
-- se llevaría por delante los 4 años de registro por la puerta de atrás —
-- justo lo que los dos triggers de arriba impiden por la de delante.
CREATE FUNCTION mipiacetpv_employees_delete_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
        RETURN OLD;   -- cascada del borrado del tenant
    END IF;
    IF NOT EXISTS (SELECT 1 FROM time_entries WHERE employee_id = OLD.id) THEN
        RETURN OLD;   -- un alta equivocada que nunca llegó a fichar
    END IF;
    RAISE EXCEPTION
        'REGISTRO_VIOLADO: el empleado % tiene fichajes y no se borra. La baja se da desactivándolo.',
        OLD.id USING ERRCODE = '23514';
END;
$fn$;

CREATE TRIGGER "employees_delete_guard"
    BEFORE DELETE ON "employees"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_employees_delete_guard();
