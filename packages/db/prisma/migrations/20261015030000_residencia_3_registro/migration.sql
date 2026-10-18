-- residencia-3 · **EL REGISTRO DE CUIDADOS**, la foto del residente y el
-- PIN de la puerta.
--
-- Hoy el cuidado se hace de memoria y se apunta al final del turno en una
-- hoja que vive en la sala de terapia. Lo que esta migración crea es la
-- tabla donde se apunta **en la puerta y en el momento**, firmado con
-- persona, capacidad y hora, inmutable y cifrado. De ahí sale la hoja de
-- cambios posturales que hoy se reconstruye a mano para AENOR.
--
-- Tres cosas, y las tres son de este bloque:
--
--   1. `care_records`  — la evidencia. Inmutable, cifrada, firmada.
--   2. `care_pins`     — con qué entra alguien en la tablet de la puerta.
--   3. `resident_profiles.photo_*` — la foto del residente (D-64), que
--      sólo se sirve con consentimiento de imagen.
--
-- ── ADITIVA ─────────────────────────────────────────────────────────
--
-- Dos tablas nuevas vacías y seis columnas nullable sobre
-- `resident_profiles`, que **sólo tiene filas en un centro con la
-- residencia encendida** (hoy: ninguno en producción). Ni un `DROP
-- TABLE`, ni un `DELETE`, ni un `TRUNCATE`, ni un `UPDATE … SET` fuera de
-- la función del trigger. Un test lo fija enumerando los `ALTER TABLE`.
--
-- Las dos columnas de CHECK sobre `client_consents` sí hacen un scan al
-- crearse; con unos cientos de consentimientos es instantáneo.
--
-- ── El `down` ───────────────────────────────────────────────────────
--
--   DROP TRIGGER "care_records_inmutable" ON "care_records";
--   DROP FUNCTION mipiacetpv_care_records_inmutable();
--   DROP TABLE "care_records";
--   DROP TABLE "care_pins";
--   ALTER TABLE "resident_profiles"
--       DROP CONSTRAINT "resident_profiles_foto_completa",
--       DROP COLUMN "photo_file_name",
--       DROP COLUMN "photo_sha256",
--       DROP COLUMN "photo_bytes",
--       DROP COLUMN "photo_mime_type",
--       DROP COLUMN "photo_uploaded_at",
--       DROP COLUMN "photo_uploaded_by_user_id";
--   ALTER TABLE "client_consents"
--       DROP CONSTRAINT "client_consents_imagen_no_es_clinica";
--
-- Es **completo** mientras no haya un solo registro de cuidado dentro:
-- después, el `down` es tirar la evidencia que esta tabla existe para
-- conservar cinco años (Ley 41/2002, D-45), y eso no lo deshace una
-- migración. El valor `IMAGE` del enum lo añadió la migración anterior y
-- ése no se quita nunca (ver su cabecera).
--
-- Y los ficheros del volumen clínico —las fotos de residente y las notas
-- de voz— **no los borra ningún `down`**: viven fuera de Postgres, igual
-- que las fotos clínicas de clinica-4.

-- ════════════════════════════════════════════════════════════════════
--  1 · care_records · LA EVIDENCIA
-- ════════════════════════════════════════════════════════════════════
--
-- `id` SIN DEFAULT a propósito: lo genera **la tablet** (`gen_random_uuid`
-- aquí sería un default que nadie usa y que taparía un olvido). Es las dos
-- cosas a la vez — la idempotencia del envío por lotes y el `filaId` del
-- AAD del valor cifrado.
CREATE TABLE "care_records" (
    "id"                      UUID        NOT NULL,
    "tenant_id"               UUID        NOT NULL,
    "client_id"               UUID        NOT NULL,

    -- La VERSIÓN del control con la que se registró, y su código en claro.
    "control_type_id"         UUID        NOT NULL,
    "control_code"            TEXT        NOT NULL,
    -- La línea del plan que lo pidió. NULL en lo «a demanda» y en la nota.
    "plan_item_id"            UUID,
    -- A QUÉ MOMENTO DEL PLAN responde, que es lo que hace que tres cambios
    -- posturales de un mismo turno sean tres cosas y no una repetida.
    --
    --   · lo que «toca» → el instante que devolvió `queToca`;
    --   · la observación diaria («¿cómo está hoy?») → **NULL**, porque se
    --     pregunta una vez por residente y turno y no por ocurrencia;
    --   · lo «a demanda» → el instante del propio registro, porque no
    --     cuelga de ninguna agenda y su momento es cuando ocurrió.
    --
    -- Es la pieza que sostiene `care_records_una_por_ocurrencia_key`.
    "occurrence_at"           TIMESTAMPTZ,

    -- EL VALOR, CIFRADO. NOT NULL: todo registro tiene valor, también el
    -- «a demanda» (su valor es que ocurrió) y la nota sin texto.
    "value_cifrado"           TEXT        NOT NULL,
    -- El texto corto de «algo no va bien». Columna lógica propia.
    "note_cifrado"            TEXT,

    -- La nota de VOZ, como fichero cifrado del volumen clínico.
    "voice_file_name"         VARCHAR(100),
    "voice_sha256"            CHAR(64),
    "voice_bytes"             INTEGER,
    "voice_mime_type"         VARCHAR(40),

    -- LA FIRMA: persona + capacidad + aparato (D-31).
    "recorded_by_user_id"     UUID        NOT NULL,
    "care_role_assignment_id" UUID        NOT NULL,
    "device_id"               UUID        NOT NULL,

    -- LOS DOS INSTANTES.
    "recorded_at"             TIMESTAMPTZ NOT NULL,
    "received_at"             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- EL TURNO. NULL es legítimo: los turnos del centro pueden no cubrir
    -- la hora, y un cuidado hecho se apunta siempre (residencia-1 §11.5).
    "center_shift_id"         UUID,
    -- El día del CENTRO al que se adscribe. No es la fecha de
    -- `recorded_at`: es la del día del TURNO, y la noche cruza medianoche.
    "care_day"                VARCHAR(10) NOT NULL,

    -- Corrección y anulación.
    "corrects_record_id"      UUID,
    "voided_at"               TIMESTAMPTZ,
    "voided_by_user_id"       UUID,

    "created_at"              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "care_records_pkey" PRIMARY KEY ("id")
);

-- ── Los CHECK de formato de lo cifrado · EL CLARO NO CABE ────────────
--
-- Misma forma y misma razón que las quince columnas de clinica-7 y
-- residencia-1b: si mañana una ruta nueva escribiera el valor sin pasar
-- por `cifrarJson`, **lo rechaza el motor**. No hace falta que nadie se
-- acuerde, y el inventario de columnas cifradas de la casa pasa de quince
-- a diecisiete con su test que las cuenta.
ALTER TABLE "care_records"
    ADD CONSTRAINT "care_records_value_cifrado_formato"
    CHECK ("value_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

ALTER TABLE "care_records"
    ADD CONSTRAINT "care_records_note_cifrado_formato"
    CHECK ("note_cifrado" IS NULL
           OR "note_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

-- ── La nota de voz: las cuatro columnas o ninguna ───────────────────
--
-- Media nota de voz es una fila que dice que hay un audio y no se puede
-- servir: sin nombre no se encuentra, sin huella no se comprueba y sin
-- MIME el navegador no sabe qué hacer con él.
ALTER TABLE "care_records"
    ADD CONSTRAINT "care_records_voz_completa"
    CHECK (
        ("voice_file_name" IS NULL AND "voice_sha256" IS NULL
            AND "voice_bytes" IS NULL AND "voice_mime_type" IS NULL)
     OR ("voice_file_name" IS NOT NULL AND "voice_sha256" IS NOT NULL
            AND "voice_bytes" IS NOT NULL AND "voice_mime_type" IS NOT NULL)
    );

-- ── La anulación: autor Y hora, o nada ──────────────────────────────
--
-- Una fila anulada sin saber quién la anuló es peor que una fila sin
-- anular: dice que alguien lo deshizo y no dice quién.
ALTER TABLE "care_records"
    ADD CONSTRAINT "care_records_anulacion_completa"
    CHECK (("voided_at" IS NULL     AND "voided_by_user_id" IS NULL)
        OR ("voided_at" IS NOT NULL AND "voided_by_user_id" IS NOT NULL));

-- ── El día del centro, con su forma ─────────────────────────────────
--
-- `VARCHAR(10)` y no `DATE` porque es un día de PARED del centro y no un
-- instante, igual que `center_shifts.starts_at` es «HH:MM» y no un
-- timestamp (residencia-1 §6): guardarlo como fecha con huso obligaría a
-- elegir uno y la noche del 25 de octubre tiene 25 horas.
--
-- Y no `CHAR(10)`: `bpchar` rellena con espacios y compara ignorándolos,
-- así que `'2026-10-15'` y `'2026-10-15 '` serían el mismo valor para un
-- `=` y distintos para un `~`. En una columna que agrupa el histórico, eso
-- es un día partido en dos.
ALTER TABLE "care_records"
    ADD CONSTRAINT "care_records_dia_formato"
    CHECK ("care_day" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');

-- ── Y una fila no se corrige a sí misma ─────────────────────────────
--
-- Sin esto, `corrects_record_id = id` sería un ciclo de uno: la fila
-- estaría corregida por sí misma y «¿cuál es el valor de ahora?» no
-- tendría respuesta. La FK no lo impide (apunta a su propia tabla y la
-- fila existe).
ALTER TABLE "care_records"
    ADD CONSTRAINT "care_records_no_se_corrige_a_si_misma"
    CHECK ("corrects_record_id" IS NULL OR "corrects_record_id" <> "id");

-- ── Las FKs · RESTRICT en todo lo que dice QUÉ y QUIÉN ──────────────
--
-- Es la evidencia y se conserva cinco años (D-45). `RESTRICT` y no
-- `CASCADE` en las siete que importan; `voided_by` también, porque quien
-- deshace un registro queda escrito.
ALTER TABLE "care_records"
    ADD CONSTRAINT "care_records_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "care_records"
    ADD CONSTRAINT "care_records_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "care_records"
    ADD CONSTRAINT "care_records_control_type_id_fkey"
    FOREIGN KEY ("control_type_id") REFERENCES "control_types"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "care_records"
    ADD CONSTRAINT "care_records_plan_item_id_fkey"
    FOREIGN KEY ("plan_item_id") REFERENCES "care_plan_items"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "care_records"
    ADD CONSTRAINT "care_records_recorded_by_user_id_fkey"
    FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "care_records"
    ADD CONSTRAINT "care_records_care_role_assignment_id_fkey"
    FOREIGN KEY ("care_role_assignment_id") REFERENCES "care_role_assignments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "care_records"
    ADD CONSTRAINT "care_records_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "devices"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- residencia-1 (decisión 8 de su done) dejó escrito que «un turno se puede
-- borrar porque nada apunta todavía a un turno; lo que se le adscribe es
-- el `CareRecord` de residencia-3, que pondrá su propia FK Restrict». Ésta.
ALTER TABLE "care_records"
    ADD CONSTRAINT "care_records_center_shift_id_fkey"
    FOREIGN KEY ("center_shift_id") REFERENCES "center_shifts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "care_records"
    ADD CONSTRAINT "care_records_corrects_record_id_fkey"
    FOREIGN KEY ("corrects_record_id") REFERENCES "care_records"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "care_records"
    ADD CONSTRAINT "care_records_voided_by_user_id_fkey"
    FOREIGN KEY ("voided_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── UNA corrección por fila corregida ───────────────────────────────
--
-- Dos filas corrigiendo a la misma dejarían «cuál es el valor de ahora»
-- sin respuesta, y la puerta tendría que elegir — acabaría eligiendo el
-- orden de la base. En Postgres los NULL son distintos entre sí, así que
-- un índice único TOTAL sobre una columna nullable ya dice exactamente
-- esto: tantos NULL como se quiera, un valor repetido ninguno.
CREATE UNIQUE INDEX "care_records_una_correccion_key"
    ON "care_records"("corrects_record_id");

-- ── UNA FILA POR OCURRENCIA, y lo dice el MOTOR ─────────────────────
--
-- «Repetir el "como siempre" en el mismo turno SUSTITUYE a lo anterior por
-- la vía de la corrección, no duplica» (decisión de producto 4). Esto es
-- la mitad de esa frase que no depende de que la ruta se acuerde.
--
-- La clave es `(residente, control, día, turno, ocurrencia)`, y es PARCIAL
-- sobre `corrects_record_id IS NULL`: una corrección queda FUERA del
-- índice, así que la cadena puede crecer —el valor de las 08:20 corregido
-- a las 08:25 y otra vez a las 11:00— y lo que no puede haber es **dos
-- cabezas** para la misma ocurrencia. Con el índice total, corregir sería
-- imposible; sin el índice, «cuál es el valor de ahora» lo decidiría el
-- orden de la base. Misma lección y misma forma que
-- `bed_assignments_one_live_per_bed_key` y `care_plan_items_one_live_key`.
--
-- ── Los dos COALESCE, que no son adorno ─────────────────────────────
--
-- `center_shift_id` y `occurrence_at` son NULL legítimamente —un hueco en
-- el cuadrante, y la observación diaria que no cuelga de ninguna
-- ocurrencia— y **en Postgres los NULL son distintos entre sí**. Sin los
-- centinelas, dos «como siempre» del mismo turno serían dos claves
-- distintas y las dos entrarían: el índice existiría y no diría nada.
--
-- Es la CUARTA vez que esta lección se paga en este repo
-- (`ticket_allergies_mesa_key` en kds-1, `care_zone_assignments_one_live_
-- centro_key` en residencia-1, `control_types_una_vigente_*` en
-- residencia-2). Aquí está pagada de entrada, con su sabotaje con nombre
-- en el e2e.
--
-- El `'-infinity'` y el uuid de ceros son valores que **no pueden darse de
-- verdad**: un `occurrence_at` real sale de `queToca` o del reloj de la
-- tablet, y el uuid nulo no es el id de ningún turno.
CREATE UNIQUE INDEX "care_records_una_por_ocurrencia_key"
    ON "care_records"(
        "client_id",
        "control_code",
        "care_day",
        COALESCE("center_shift_id", '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE("occurrence_at", '-infinity'::timestamptz))
    WHERE "corrects_record_id" IS NULL;

CREATE INDEX "care_records_tenant_id_idx" ON "care_records"("tenant_id");
-- «Lo registrado hoy de este residente»: lo que la puerta pide al abrirse
-- y lo que la ficha del admin enseña.
CREATE INDEX "care_records_tenant_id_client_id_care_day_idx"
    ON "care_records"("tenant_id", "client_id", "care_day");
-- «Lo registrado hoy en el centro»: el relevo y el panel (residencia-5).
CREATE INDEX "care_records_tenant_id_care_day_idx"
    ON "care_records"("tenant_id", "care_day");
-- Y el cruce con «lo que toca», que es por control.
CREATE INDEX "care_records_client_id_control_code_care_day_idx"
    ON "care_records"("client_id", "control_code", "care_day");

-- ── INMUTABLE, con UNA transición legítima ──────────────────────────
--
-- La regla de `clinical_entries` y `clinical_addenda` en clinica-1 («la
-- historia no se edita y no se borra»), con la escapatoria que aquéllas no
-- necesitaban: **la anulación**.
--
--   · `DELETE`  — nunca. Ni con el padre borrado: las FKs son RESTRICT, así
--     que la cascada que la escapatoria de S1/F1 cubría no puede ocurrir
--     (mismo razonamiento que `clinical_access_log_append_only`).
--   · `UPDATE`  — sólo para ANULAR: `voided_at` y `voided_by_user_id` de
--     NULL a puestos, y ni una columna más. Des-anular tampoco: lo que
--     pasó queda, y para volver a registrar el cuidado se registra otra
--     vez.
--
-- Corregir NO es un `UPDATE`: es una fila nueva que apunta a la corregida.
-- Por eso esta función no tiene que saber nada de correcciones.
--
-- Las veintidós columnas se comparan **una por una y por su nombre**. Un
-- `row(NEW.*) IS DISTINCT FROM row(OLD.*)` habría sido más corto y habría
-- dejado pasar en silencio cualquier columna añadida después: el día que
-- este bloque gane una, el test de la migración que cuenta los nombres se
-- pone rojo, que es lo que se quiere.
CREATE FUNCTION mipiacetpv_care_records_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'RESIDENCIA_VIOLADA: un registro de cuidado no se borra (care_records.%). Se anula, con autor y hora, y se queda en el histórico.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    IF NEW.id                      IS DISTINCT FROM OLD.id
       OR NEW.tenant_id               IS DISTINCT FROM OLD.tenant_id
       OR NEW.client_id               IS DISTINCT FROM OLD.client_id
       OR NEW.control_type_id         IS DISTINCT FROM OLD.control_type_id
       OR NEW.control_code            IS DISTINCT FROM OLD.control_code
       OR NEW.plan_item_id            IS DISTINCT FROM OLD.plan_item_id
       OR NEW.occurrence_at           IS DISTINCT FROM OLD.occurrence_at
       OR NEW.value_cifrado           IS DISTINCT FROM OLD.value_cifrado
       OR NEW.note_cifrado            IS DISTINCT FROM OLD.note_cifrado
       OR NEW.voice_file_name         IS DISTINCT FROM OLD.voice_file_name
       OR NEW.voice_sha256            IS DISTINCT FROM OLD.voice_sha256
       OR NEW.voice_bytes             IS DISTINCT FROM OLD.voice_bytes
       OR NEW.voice_mime_type         IS DISTINCT FROM OLD.voice_mime_type
       OR NEW.recorded_by_user_id     IS DISTINCT FROM OLD.recorded_by_user_id
       OR NEW.care_role_assignment_id IS DISTINCT FROM OLD.care_role_assignment_id
       OR NEW.device_id               IS DISTINCT FROM OLD.device_id
       OR NEW.recorded_at             IS DISTINCT FROM OLD.recorded_at
       OR NEW.received_at             IS DISTINCT FROM OLD.received_at
       OR NEW.center_shift_id         IS DISTINCT FROM OLD.center_shift_id
       OR NEW.care_day                IS DISTINCT FROM OLD.care_day
       OR NEW.corrects_record_id      IS DISTINCT FROM OLD.corrects_record_id
       OR NEW.created_at              IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION
            'RESIDENCIA_VIOLADA: un registro de cuidado no se edita (care_records.%). Para corregirlo se escribe OTRA fila que apunta a ésta, con su autor y su hora.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    IF OLD.voided_at IS NOT NULL THEN
        RAISE EXCEPTION
            'RESIDENCIA_VIOLADA: el registro % ya está anulado y la anulación no se deshace ni se mueve. Para volver a registrar el cuidado se registra otra vez.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    IF NEW.voided_at IS NULL THEN
        RAISE EXCEPTION
            'RESIDENCIA_VIOLADA: lo único que se puede cambiar de un registro de cuidado (care_records.%) es anularlo. Y anular es poner la hora y el autor, no quitarlos.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$fn$;

CREATE TRIGGER "care_records_inmutable"
    BEFORE UPDATE OR DELETE ON "care_records"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_care_records_inmutable();

-- ════════════════════════════════════════════════════════════════════
--  2 · care_pins · CON QUÉ ENTRA ALGUIEN EN LA PUERTA
-- ════════════════════════════════════════════════════════════════════
--
-- Otro PIN que el del TPV (`users.pin_hash`), y a propósito: aquél abre el
-- cajón, éste **firma registros de salud**. Y en un centro sin caja —el
-- cliente cero— éste es el único, así que nadie tiene dos que recordar.
--
-- ── Por qué DOS columnas ────────────────────────────────────────────
--
-- El mockup validado (D-64) pide **sólo el PIN**: ni email, ni elegir
-- nombre de una lista. Así que con cuatro cifras hay que ENCONTRAR a la
-- persona, y buscarla probando argon2id contra los veinte de la plantilla
-- son cinco segundos y 1,3 GB de memoria por intento.
--
--   · `pin_lookup` — la huella de búsqueda: HMAC-SHA256 con una subclave
--     derivada de la **DEK del centro**, que vive envuelta por la
--     `CLINICAL_KEK` del entorno. Una consulta indexada la resuelve, y su
--     índice único por centro es lo que impide que dos personas compartan
--     PIN — sin eso, «sólo el PIN» no identificaría a nadie.
--   · `pin_hash`   — argon2id, la credencial de verdad, verificada sólo
--     contra la fila que la huella encontró.
--
-- Si la huella estuviera salada con un valor de la propia base, cuatro
-- cifras serían diez mil pruebas instantáneas sobre un volcado. Con la DEK
-- fuera, un volcado sin la KEK no la puede calcular ni invertir. Y
-- destruir la DEK del centro (art. 28.3.g) apaga el PIN de sus puertas,
-- que es lo correcto: la relación terminó.
--
-- `CASCADE` a las dos: es una CREDENCIAL, no evidencia. Lo que no se borra
-- es lo que esa persona firmó, y eso lo impide
-- `care_records_recorded_by_user_id_fkey`.
CREATE TABLE "care_pins" (
    "user_id"        UUID        NOT NULL,
    "tenant_id"      UUID        NOT NULL,
    "pin_hash"       TEXT        NOT NULL,
    "pin_lookup"     TEXT        NOT NULL,
    "set_at"         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "set_by_user_id" UUID,
    "updated_at"     TIMESTAMPTZ NOT NULL,

    CONSTRAINT "care_pins_pkey" PRIMARY KEY ("user_id")
);

ALTER TABLE "care_pins"
    ADD CONSTRAINT "care_pins_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "care_pins"
    ADD CONSTRAINT "care_pins_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "care_pins"
    ADD CONSTRAINT "care_pins_set_by_user_id_fkey"
    FOREIGN KEY ("set_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- «Un PIN, una persona» DENTRO del centro. Es lo que hace que teclear
-- cuatro cifras identifique a alguien, y por eso es un índice del motor y
-- no un `if` de la ruta que lo escribe: el día que una implantación
-- cargue los PIN con un script, la regla sigue puesta.
CREATE UNIQUE INDEX "care_pins_tenant_id_pin_lookup_key"
    ON "care_pins"("tenant_id", "pin_lookup");

CREATE INDEX "care_pins_tenant_id_idx" ON "care_pins"("tenant_id");

-- ════════════════════════════════════════════════════════════════════
--  3 · LA FOTO DEL RESIDENTE (D-64)
-- ════════════════════════════════════════════════════════════════════
--
-- El JPEG vive en el volumen clínico, cifrado con cabecera `MPC1` y con la
-- huella del claro (clinica-4 decisión 11, clinica-7 decisión 8). Aquí
-- sólo el puntero y la huella — que es exactamente el reparto de
-- `clinical_photos`.
--
-- Y **se reemplaza, no se versiona**: la cara de alguien es identidad
-- (como `clients.first_name`), no historia. Nadie tiene que poder
-- reconstruir qué foto tenía doña Carmen en marzo; lo que sí hay que poder
-- reconstruir es qué le tocaba y qué se le hizo, y eso es `care_records`.
ALTER TABLE "resident_profiles"
    ADD COLUMN "photo_file_name"          VARCHAR(100),
    ADD COLUMN "photo_sha256"             CHAR(64),
    ADD COLUMN "photo_bytes"              INTEGER,
    ADD COLUMN "photo_mime_type"          VARCHAR(40),
    ADD COLUMN "photo_uploaded_at"        TIMESTAMPTZ,
    ADD COLUMN "photo_uploaded_by_user_id" UUID;

ALTER TABLE "resident_profiles"
    ADD CONSTRAINT "resident_profiles_photo_uploaded_by_user_id_fkey"
    FOREIGN KEY ("photo_uploaded_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Las cinco primeras juntas o ninguna. `photo_uploaded_by_user_id` NO
-- entra en el grupo: es `SET NULL`, así que dar de baja a quien subió la
-- foto la dejaría a NULL y el CHECK convertiría eso en un 500 al borrar un
-- usuario. Lo que la foto necesita para servirse son las cuatro primeras;
-- la fecha va con ellas porque es lo que la ficha enseña.
ALTER TABLE "resident_profiles"
    ADD CONSTRAINT "resident_profiles_foto_completa"
    CHECK (
        ("photo_file_name" IS NULL AND "photo_sha256" IS NULL
            AND "photo_bytes" IS NULL AND "photo_mime_type" IS NULL
            AND "photo_uploaded_at" IS NULL)
     OR ("photo_file_name" IS NOT NULL AND "photo_sha256" IS NOT NULL
            AND "photo_bytes" IS NOT NULL AND "photo_mime_type" IS NOT NULL
            AND "photo_uploaded_at" IS NOT NULL)
    );

-- ── Un consentimiento de IMAGEN no es historia clínica ──────────────
--
-- La cara de alguien es su imagen, no su salud. Si `clinical` llegara a
-- `true`, el CHECK `client_consents_clinica_exige_informante` pediría un
-- sanitario que informe para poder poner la foto de un residente en la
-- puerta de su habitación — y de paso el PDF de ese consentimiento
-- entraría en la historia clínica, que es donde no va.
--
-- **Éste es el CHECK por el que la migración anterior existe**: usa el
-- literal `IMAGE`, y Postgres no deja usar un valor de enum en la misma
-- transacción en la que se añade.
ALTER TABLE "client_consents"
    ADD CONSTRAINT "client_consents_imagen_no_es_clinica"
    CHECK ("kind" <> 'IMAGE' OR "clinical" = false);
