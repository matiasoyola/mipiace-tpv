-- residencia-4 · **LA GRAVEDAD, EL LIBRO DE INCIDENCIAS Y EL AVISO.**
--
-- Hoy una fiebre de 38,4 se apunta en una hoja, la enfermera se entera
-- cuando pasa por la sala de terapia y la dirección reconstruye la
-- incidencia de memoria para AENOR. Lo que esta migración crea es el
-- sitio donde el sistema **declara la incidencia solo, le pone nivel y
-- hace sonar el móvil de quien esté de guardia**, y donde queda el cierre
-- y lo que se le dijo a la familia.
--
-- Diez tablas y seis cosas:
--
--   1. `severity_rules`              — LA PLANTILLA DE GRAVEDAD (D-65),
--      dato versionado del producto. Un centro no la toca.
--   2. `resident_threshold_overrides` + `resident_threshold_rules` — la
--      excepción por residente (D-22), que sólo pauta un `MEDICO`.
--   3. `incidents` + `incident_links` — el LIBRO ÚNICO (D-35, D-38).
--   4. `incident_actions`            — qué se hizo. Append-only.
--   5. `family_communications`       — comunicado / no comunicado (D-32 a
--      D-34). Append-only también: es constancia.
--   6. `guard_alerts` + `guard_shift_sessions` + `center_guard_settings`
--      — el aviso (D-19, D-66).
--
-- Más dos columnas sobre `devices` y `pairing_codes` (el canal del móvil
-- de guardia) y el CHECK `devices_register_o_habitacion` **reescrito**,
-- que es la única pieza que toca una tabla con filas de producción.
--
-- ── ADITIVA, con un CHECK reemplazado ───────────────────────────────
--
-- Diez tablas nuevas vacías, dos columnas nullable y un CHECK sustituido
-- por otro más ancho. Ni un `DROP TABLE`, ni un `DELETE`, ni un
-- `TRUNCATE`, ni un `UPDATE … SET` fuera de las funciones de los
-- triggers. Un test enumera los `ALTER TABLE` y comprueba que sólo
-- nombran las tablas de este bloque más `devices` y `pairing_codes`.
--
-- El CHECK nuevo de `devices` **es más permisivo que el que sustituye**:
-- lo que antes pasaba sigue pasando, y además pasa un `GUARD`. Por eso el
-- scan que hace al crearse no puede rechazar ninguna fila de hoy. Se dice
-- igual porque `devices` es la identidad de los terminales que facturan,
-- y por eso esta migración **se aplica primero en una copia**.
--
-- ── btree_gist ──────────────────────────────────────────────────────
--
-- `CREATE EXTENSION IF NOT EXISTS btree_gist` ya lo hizo `b_koibox_4`
-- para el anti-solape de la agenda. Se repite con `IF NOT EXISTS` porque
-- una base que arranque desde cero con las migraciones en orden la
-- necesita antes del `EXCLUDE` de abajo, y porque una migración no puede
-- dar por supuesto lo que hizo otra de hace tres meses.
--
-- ── EL `down` ───────────────────────────────────────────────────────
--
--   DROP TRIGGER "incidents_inmutable" ON "incidents";
--   DROP TRIGGER "incident_actions_append_only" ON "incident_actions";
--   DROP TRIGGER "family_communications_append_only" ON "family_communications";
--   DROP FUNCTION mipiacetpv_incidents_inmutable();
--   DROP FUNCTION mipiacetpv_incident_actions_append_only();
--   DROP FUNCTION mipiacetpv_family_communications_append_only();
--   DROP TABLE "guard_alerts", "guard_shift_sessions", "center_guard_settings",
--              "family_communications", "incident_actions", "incident_links",
--              "incidents", "resident_threshold_rules",
--              "resident_threshold_overrides", "severity_rules";
--   ALTER TABLE "pairing_codes" DROP CONSTRAINT "pairing_codes_guard_canal",
--                               DROP COLUMN "guard_channel";
--   ALTER TABLE "devices"       DROP CONSTRAINT "devices_guard_canal",
--                               DROP COLUMN "guard_channel";
--   -- y el CHECK de siempre vuelve SÓLO si no queda ningún móvil de guardia:
--   DELETE FROM "devices" WHERE "kind" = 'GUARD';
--   ALTER TABLE "devices" DROP CONSTRAINT "devices_register_o_habitacion";
--   ALTER TABLE "devices" ADD CONSTRAINT "devices_register_o_habitacion" CHECK (
--       ("kind" = 'ROOM' AND "room_id" IS NOT NULL AND "register_id" IS NULL)
--       OR ("kind" <> 'ROOM' AND "room_id" IS NULL AND "register_id" IS NOT NULL));
--   DROP TYPE "FamilyCommunicationChannel", "FamilyCommunicationKind",
--             "GuardAlertState", "GuardChannel", "IncidentActionKind",
--             "IncidentOrigin", "IncidentSubject", "SeverityRuleKind",
--             "SeverityComparator", "SeverityLevel";
--
-- Es **completo** mientras no haya una sola incidencia dentro: después,
-- el `down` es tirar el libro que la norma obliga a conservar (D-45, Ley
-- 41/2002), y eso no lo deshace una migración. El valor `GUARD` del enum
-- lo añadió la migración anterior y ése no se quita nunca.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ════════════════════════════════════════════════════════════════════
--  0 · LOS NUEVE TIPOS NUEVOS
-- ════════════════════════════════════════════════════════════════════
--
-- Todos NUEVOS, así que se crean y se usan en esta misma migración (ver
-- la cabecera de la anterior). Lo que NO es un tipo y es a propósito: el
-- **tipo de incidencia** (`FIEBRE`, `CAIDA`, `AVERIA`), que es un código
-- de texto que vive en el fichero de datos de la plantilla de gravedad.
-- D-11 llevado a la capa 4: un tipo nuevo en 2028 es una fila, no una
-- migración.

CREATE TYPE "SeverityLevel" AS ENUM ('N0', 'N1', 'N2', 'N3', 'N4');
CREATE TYPE "SeverityComparator" AS ENUM ('GTE', 'GT', 'LTE', 'LT');
CREATE TYPE "SeverityRuleKind" AS ENUM ('THRESHOLD', 'EVENT');
CREATE TYPE "IncidentSubject" AS ENUM ('RESIDENT', 'COMPLAINT', 'MAINTENANCE');
CREATE TYPE "IncidentOrigin" AS ENUM ('DECLARED', 'DERIVED_THRESHOLD', 'DERIVED_ABSENCE');
CREATE TYPE "IncidentActionKind" AS ENUM ('NOTE', 'EVIDENCE', 'SEVERITY', 'ALERT', 'CALL', 'CLOSE');
CREATE TYPE "GuardChannel" AS ENUM ('ENFERMERIA', 'RESPONSABLE');
CREATE TYPE "GuardAlertState" AS ENUM ('PENDING', 'DELIVERED', 'ACKED', 'ESCALATED', 'CANCELLED');
CREATE TYPE "FamilyCommunicationKind" AS ENUM ('COMUNICADO', 'NO_COMUNICADO');
CREATE TYPE "FamilyCommunicationChannel" AS ENUM ('TELEFONO', 'PRESENCIAL', 'EMAIL', 'OTRA');

-- ════════════════════════════════════════════════════════════════════
--  1 · severity_rules · LA PLANTILLA DE GRAVEDAD (D-65)
-- ════════════════════════════════════════════════════════════════════
--
-- La tabla del §3 de `00-decisiones.md`, fila por fila. La siembra el
-- arranque de la API desde `residencia/catalogo/plantilla-de-gravedad.ts`,
-- igual que el catálogo de controles y por lo mismo (D-11).
--
-- **SIN `tenant_id`**, y eso no es un descuido: es D-21 escrito en el
-- esquema. Los umbrales clínicos son estándar médico y no se configuran
-- por centro; lo único que los cambia es una excepción por residente con
-- prescripción médica. El `scope` existe y el CHECK lo clava en
-- `STANDARD` para que la frontera se lea en la tabla.
CREATE TABLE "severity_rules" (
    "id"            UUID               NOT NULL DEFAULT gen_random_uuid(),
    "scope"         "ControlScope"     NOT NULL DEFAULT 'STANDARD',
    -- La versión es de la PLANTILLA ENTERA, no de la fila: «¿qué decía la
    -- plantilla el 14 de marzo?» tiene que contestarse con un número.
    "version"       INTEGER            NOT NULL,
    "kind"          "SeverityRuleKind" NOT NULL,

    -- Sólo THRESHOLD. El CÓDIGO del control y no el id de una versión de
    -- `control_types`: la plantilla gradúa la temperatura, no «la versión
    -- 1 de la temperatura».
    "control_code"  TEXT,
    "comparator"    "SeverityComparator",
    -- `NUMERIC(10,2)` como `input_min`/`ref_min`: 37,5 tiene que ser 37,5
    -- y no 37,499999, porque la diferencia entre 37,49 y 37,5 es la
    -- diferencia entre no avisar y avisar.
    "value"         DECIMAL(10,2),

    -- Sólo EVENT. `qualifier` NULL = la regla BASE del evento, la que
    -- vale cuando no se pregunta nada (D-13).
    "event_type"    TEXT,
    "qualifier"     TEXT,

    "severity"      "SeverityLevel"    NOT NULL,
    -- **La clave de la idempotencia**: tres tomas de fiebre en un turno se
    -- adjuntan a la incidencia `FIEBRE` abierta en vez de abrir tres.
    "incident_type" TEXT               NOT NULL,

    -- Para PINTAR la plantilla, no para evaluarla: `gravedadDe` mira todas
    -- las que casan y se queda con la más grave, precisamente para que el
    -- orden de estas filas no pueda cambiar un nivel.
    "sort_order"    INTEGER            NOT NULL DEFAULT 0,

    "valid_from"    TIMESTAMPTZ        NOT NULL,
    "superseded_at" TIMESTAMPTZ,
    "created_at"    TIMESTAMPTZ        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "severity_rules_pkey" PRIMARY KEY ("id")
);

-- La frontera, en el motor: un centro no tiene reglas de gravedad
-- propias. El día que algo lo justifique, lo que hay que discutir es este
-- CHECK y no un modelo entero.
ALTER TABLE "severity_rules"
    ADD CONSTRAINT "severity_rules_solo_estandar"
    CHECK ("scope" = 'STANDARD');

-- Cada familia con sus columnas y sin las de la otra. Sin esto, una
-- fila podría llevar `control_code` Y `event_type`, y `gravedadDe` la
-- evaluaría dos veces por dos caminos distintos.
ALTER TABLE "severity_rules"
    ADD CONSTRAINT "severity_rules_forma_coherente"
    CHECK (
        ("kind" = 'THRESHOLD'
            AND "control_code" IS NOT NULL AND "comparator" IS NOT NULL
            AND "value" IS NOT NULL
            AND "event_type" IS NULL AND "qualifier" IS NULL)
     OR ("kind" = 'EVENT'
            AND "event_type" IS NOT NULL
            AND "control_code" IS NULL AND "comparator" IS NULL
            AND "value" IS NULL)
    );

-- Un matiz vacío no es «sin matiz»: es un dedo que se fue. Y hace falta
-- para que el `COALESCE(qualifier, '')` del índice de abajo signifique
-- una sola cosa.
ALTER TABLE "severity_rules"
    ADD CONSTRAINT "severity_rules_textos_no_vacios"
    CHECK (
        ("control_code" IS NULL OR "control_code" <> '')
        AND ("event_type" IS NULL OR "event_type" <> '')
        AND ("qualifier" IS NULL OR "qualifier" <> '')
        AND "incident_type" <> ''
    );

ALTER TABLE "severity_rules"
    ADD CONSTRAINT "severity_rules_version_desde_uno"
    CHECK ("version" >= 1);

-- ── UNA regla vigente por clave natural ─────────────────────────────
--
-- Dos índices y no uno, por la razón de siempre en este repo: las
-- columnas de una familia son NULL en la otra, y **en Postgres los NULL
-- son distintos entre sí**, así que un índice único sobre las seis
-- columnas dejaría entrar la misma regla dos veces. Parciales por `kind`,
-- que es lo que de verdad separa las dos familias.
--
-- Son lo que hace que el seed del arranque sea idempotente sin un
-- `ON CONFLICT` que alguien tenga que acordarse de escribir.
CREATE UNIQUE INDEX "severity_rules_umbral_vigente_key"
    ON "severity_rules"("control_code", "comparator", "value")
    WHERE "kind" = 'THRESHOLD' AND "superseded_at" IS NULL;

-- El `COALESCE` aquí sí hace falta: `qualifier` es NULL en la regla base
-- de un evento y eso es legítimo. Sin el centinela, dos reglas base del
-- mismo evento serían dos claves distintas y las dos entrarían — el
-- índice existiría y no diría nada. Quinta vez que esta lección se paga
-- en este repo, y aquí está pagada de entrada.
CREATE UNIQUE INDEX "severity_rules_evento_vigente_key"
    ON "severity_rules"("event_type", COALESCE("qualifier", ''))
    WHERE "kind" = 'EVENT' AND "superseded_at" IS NULL;

CREATE INDEX "severity_rules_scope_version_idx"
    ON "severity_rules"("scope", "version");
-- «Las reglas vigentes de este control», que es lo que la derivación
-- pregunta por cada medida que entra.
CREATE INDEX "severity_rules_control_code_superseded_at_idx"
    ON "severity_rules"("control_code", "superseded_at");
CREATE INDEX "severity_rules_event_type_superseded_at_idx"
    ON "severity_rules"("event_type", "superseded_at");

-- ════════════════════════════════════════════════════════════════════
--  2 · resident_threshold_overrides · LA EXCEPCIÓN DEL RESIDENTE (D-22)
-- ════════════════════════════════════════════════════════════════════
--
-- Lo único que puede cambiar un umbral, y **sólo la pauta un rol
-- `MEDICO`**. Un hipertenso crónico, un paliativo o alguien con
-- hipotermia habitual tienen rangos propios: el mecanismo es genérico, el
-- valor distinto es un dato clínico del residente y no una configuración
-- local (rama de controles §5).
--
-- **Sustituye, no se suma.** Mientras está vigente, las reglas de serie
-- de ese control no se aplican a ese residente. Sumarlas dejaría la de
-- serie disparando por debajo de la excepción, que es exactamente lo que
-- la excepción existe para evitar.
CREATE TABLE "resident_threshold_overrides" (
    "id"           UUID        NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"    UUID        NOT NULL,
    "client_id"    UUID        NOT NULL,
    "control_code" TEXT        NOT NULL,

    -- POR QUÉ, cifrado (D-63): «paliativo, febrícula basal 37,8» es un
    -- diagnóstico con todas las letras. NOT NULL: una excepción sin
    -- motivo es un umbral cambiado sin que nadie sepa por qué, y eso es
    -- justo lo que una auditoría pregunta.
    "reason_cifrado" TEXT      NOT NULL,

    "from_at"      TIMESTAMPTZ NOT NULL,
    "to_at"        TIMESTAMPTZ,

    -- La firma: persona + CAPACIDAD (D-31). Que la capacidad sea un rol
    -- `MEDICO` vigente lo comprueba la ruta —es una regla que cruza dos
    -- tablas, igual que el colegiado de residencia-1— y tiene su fila en
    -- la tabla de sabotajes.
    "signed_by_user_id"                 UUID        NOT NULL,
    "signed_by_care_role_assignment_id" UUID        NOT NULL,
    "signed_at"                         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    "revoked_at"        TIMESTAMPTZ,
    "revoked_by_user_id" UUID,

    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resident_threshold_overrides_pkey" PRIMARY KEY ("id")
);

-- El claro NO CABE. Misma forma y misma razón que las diecisiete columnas
-- cifradas que ya hay en la casa.
ALTER TABLE "resident_threshold_overrides"
    ADD CONSTRAINT "resident_threshold_overrides_reason_cifrado_formato"
    CHECK ("reason_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

-- La vigencia, ordenada. **Con su `IS NULL` delante**, porque un CHECK
-- que da NULL pasa y ésa es la forma en la que esto se rompería sin que
-- se viera (residencia-1b §3).
ALTER TABLE "resident_threshold_overrides"
    ADD CONSTRAINT "resident_threshold_overrides_vigencia_ordenada"
    CHECK ("to_at" IS NULL OR "to_at" > "from_at");

ALTER TABLE "resident_threshold_overrides"
    ADD CONSTRAINT "resident_threshold_overrides_revocacion_completa"
    CHECK (("revoked_at" IS NULL     AND "revoked_by_user_id" IS NULL)
        OR ("revoked_at" IS NOT NULL AND "revoked_by_user_id" IS NOT NULL));

ALTER TABLE "resident_threshold_overrides"
    ADD CONSTRAINT "resident_threshold_overrides_control_no_vacio"
    CHECK ("control_code" <> '');

ALTER TABLE "resident_threshold_overrides"
    ADD CONSTRAINT "resident_threshold_overrides_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "resident_threshold_overrides"
    ADD CONSTRAINT "resident_threshold_overrides_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "resident_threshold_overrides"
    ADD CONSTRAINT "resident_threshold_overrides_signed_by_user_id_fkey"
    FOREIGN KEY ("signed_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "resident_threshold_overrides"
    ADD CONSTRAINT "resident_threshold_overrides_signed_by_care_role_assignment_id_fkey"
    FOREIGN KEY ("signed_by_care_role_assignment_id") REFERENCES "care_role_assignments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "resident_threshold_overrides"
    ADD CONSTRAINT "resident_threshold_overrides_revoked_by_user_id_fkey"
    FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ── DOS EXCEPCIONES DEL MISMO CONTROL NO SE SOLAPAN ─────────────────
--
-- Un **EXCLUDE USING gist**, no un índice parcial, y la diferencia
-- importa: con `UNIQUE (client_id, control_code) WHERE revoked_at IS
-- NULL`, una excepción que caducó en marzo bloquearía otra en junio. Lo
-- que de verdad no puede pasar es que dos se SOLAPEN, porque entonces
-- «¿qué umbral rige hoy para doña Carmen?» lo decidiría el orden de la
-- base — y es la pregunta de la que depende si suena un móvil.
--
-- Mismo mecanismo exacto que el anti-solape de la agenda
-- (`b_koibox_4`), y por eso `btree_gist`: hace falta para el `=` sobre
-- uuid y sobre texto dentro del EXCLUDE.
--
-- `tstzrange(from_at, to_at)` con `to_at` NULL es un rango **sin fin**,
-- que es exactamente lo que «sin fecha de fin prevista» significa.
ALTER TABLE "resident_threshold_overrides"
    ADD CONSTRAINT "resident_threshold_overrides_sin_solape"
    EXCLUDE USING gist (
        "client_id" WITH =,
        "control_code" WITH =,
        tstzrange("from_at", "to_at") WITH &&
    ) WHERE ("revoked_at" IS NULL);

CREATE INDEX "resident_threshold_overrides_tenant_id_idx"
    ON "resident_threshold_overrides"("tenant_id");
CREATE INDEX "resident_threshold_overrides_client_id_control_code_idx"
    ON "resident_threshold_overrides"("client_id", "control_code");

-- ── Las reglas de la excepción ──────────────────────────────────────
--
-- Tabla y no tres columnas (`warn_min`, `alert_max`…) por lo mismo que
-- las opciones de un control son tabla y no un JSON: el número de bandas
-- lo decide la pauta y no el esquema. Un paliativo puede llevar dos y un
-- diabético cuatro.
--
-- Y **cero reglas es legítimo**: «a doña Carmen no le abráis incidencia
-- por la tensión, la tiene así desde 2019» es una pauta médica válida y
-- se escribe con una cabecera sin filas.
CREATE TABLE "resident_threshold_rules" (
    "id"            UUID                 NOT NULL DEFAULT gen_random_uuid(),
    "override_id"   UUID                 NOT NULL,
    "comparator"    "SeverityComparator" NOT NULL,
    "value"         DECIMAL(10,2)        NOT NULL,
    "severity"      "SeverityLevel"      NOT NULL,
    -- Normalmente el mismo que el de serie (`FIEBRE`), para que la
    -- idempotencia siga agrupando bien: si la excepción abriera un tipo
    -- distinto, la segunda toma del turno abriría una incidencia nueva.
    "incident_type" TEXT                 NOT NULL,
    "sort_order"    INTEGER              NOT NULL DEFAULT 0,

    CONSTRAINT "resident_threshold_rules_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "resident_threshold_rules"
    ADD CONSTRAINT "resident_threshold_rules_tipo_no_vacio"
    CHECK ("incident_type" <> '');

-- `CASCADE` a la cabecera, al revés que casi todo en este bloque: una
-- regla no significa nada sin el motivo, la vigencia y la firma que
-- viven arriba. Lo que no se borra es la cabecera, y eso lo impide su
-- propio `RESTRICT` al residente.
ALTER TABLE "resident_threshold_rules"
    ADD CONSTRAINT "resident_threshold_rules_override_id_fkey"
    FOREIGN KEY ("override_id") REFERENCES "resident_threshold_overrides"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "resident_threshold_rules_override_id_idx"
    ON "resident_threshold_rules"("override_id");

-- ════════════════════════════════════════════════════════════════════
--  3 · incidents · EL LIBRO ÚNICO (D-35, D-38)
-- ════════════════════════════════════════════════════════════════════
--
-- Una tabla con el SUJETO como atributo, no cuatro tablas separadas. Los
-- campos son idénticos para una caída, una queja y una avería: qué ha
-- pasado, cuándo, quién lo vio, gravedad, a quién avisar, qué se hizo,
-- quién cierra. Lo único que cambia es el sujeto — y por eso cada sujeto
-- tiene su pantalla, pero el mismo libro por detrás.
--
-- Y de ahí sale lo que de verdad lo justifica: **los casos cruzados**. Un
-- residente se cae porque el asidero estaba suelto → incidencia + avería
-- enlazadas. Con libros separados, la relación causa-efecto se pierde, y
-- es justo lo que AENOR busca en las acciones correctoras.
CREATE TABLE "incidents" (
    "id"               UUID              NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"        UUID              NOT NULL,

    "subject"          "IncidentSubject" NOT NULL,
    -- El residente. Obligatorio en `RESIDENT`, prohibido en
    -- `MAINTENANCE`, OPCIONAL en `COMPLAINT`: una queja puede ser de la
    -- familia de alguien (y entonces es suya y sale en su ficha) o del
    -- comedor en general (y entonces no es de nadie).
    "client_id"        UUID,

    "origin"           "IncidentOrigin"  NOT NULL,
    -- El tipo, en CÓDIGO y no en enum. Ver la cabecera de
    -- `plantilla-de-gravedad.ts`.
    "incident_type"    TEXT              NOT NULL,
    "severity"         "SeverityLevel"   NOT NULL,
    -- Con qué versión de la plantilla se graduó. El equivalente de
    -- `care_records.control_type_id`: «¿por qué esto fue N2?» se contesta
    -- tres años después.
    "template_version" INTEGER,

    -- `true` mientras esté abierta. Columna y no derivada de `closed_at`
    -- porque es lo que filtra «qué hay abierto hoy» —la métrica de éxito
    -- de dirección— y el índice parcial sobre ella es lo que la hace
    -- instantánea.
    "open"             BOOLEAN           NOT NULL DEFAULT true,

    -- QUÉ HA PASADO, cifrado (D-63). Opcional: una incidencia derivada
    -- por umbral no la escribe nadie, y la evidencia es la medida.
    "description_cifrado" TEXT,

    -- DE DÓNDE SALIÓ: la medida que la abrió, la puerta y la habitación.
    "source_record_id" UUID,
    "device_id"        UUID,
    "room_id"          UUID,

    -- CUÁNDO Y QUIÉN (D-31).
    "opened_at"                         TIMESTAMPTZ NOT NULL,
    "opened_by_user_id"                 UUID        NOT NULL,
    "opened_by_care_role_assignment_id" UUID        NOT NULL,

    -- El turno y el día del CENTRO, como en `care_records` y por lo
    -- mismo: la noche cruza medianoche.
    "center_shift_id"  UUID,
    "care_day"         VARCHAR(10)       NOT NULL,

    -- EL CIERRE (D-27, D-28).
    "closed_at"                         TIMESTAMPTZ,
    "closed_by_user_id"                 UUID,
    "closed_by_care_role_assignment_id" UUID,
    -- Se MARCA, no se prohíbe, en N1 y N2: en el turno de noche hay una
    -- auxiliar y nadie más, y exigir una segunda persona dejaría el libro
    -- lleno de abiertas que nadie puede cerrar.
    "self_closed"                       BOOLEAN     NOT NULL DEFAULT false,

    -- Cuándo salió el primer aviso. Contabilidad del aviso, no contenido:
    -- por eso el trigger de inmutabilidad la deja cambiar.
    "alerted_at"       TIMESTAMPTZ,

    "created_at"       TIMESTAMPTZ       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "incidents"
    ADD CONSTRAINT "incidents_description_cifrado_formato"
    CHECK ("description_cifrado" IS NULL
           OR "description_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

-- El sujeto manda sobre el residente. Ver el comentario de `client_id`.
ALTER TABLE "incidents"
    ADD CONSTRAINT "incidents_sujeto_coherente"
    CHECK (
        ("subject" = 'RESIDENT' AND "client_id" IS NOT NULL)
     OR ("subject" = 'COMPLAINT')
     OR ("subject" = 'MAINTENANCE' AND "client_id" IS NULL)
    );

-- Una incidencia cerrada sin saber quién la cerró es media evidencia. Las
-- tres juntas o ninguna.
ALTER TABLE "incidents"
    ADD CONSTRAINT "incidents_cierre_completo"
    CHECK (
        ("closed_at" IS NULL AND "closed_by_user_id" IS NULL
            AND "closed_by_care_role_assignment_id" IS NULL)
     OR ("closed_at" IS NOT NULL AND "closed_by_user_id" IS NOT NULL
            AND "closed_by_care_role_assignment_id" IS NOT NULL)
    );

-- `open` es la negación de «tiene cierre». Son dos columnas que dicen lo
-- mismo y la segunda existe por el índice; que no se puedan contradecir
-- lo dice el motor y no la ruta.
ALTER TABLE "incidents"
    ADD CONSTRAINT "incidents_abierta_coherente"
    CHECK (("open" = true AND "closed_at" IS NULL)
        OR ("open" = false AND "closed_at" IS NOT NULL));

-- Una derivada por umbral SIN la medida que la abrió es una incidencia
-- que no se puede leer: «fiebre» sin decir a cuánto.
ALTER TABLE "incidents"
    ADD CONSTRAINT "incidents_origen_coherente"
    CHECK ("origin" <> 'DERIVED_THRESHOLD' OR "source_record_id" IS NOT NULL);

-- El día del centro, con su forma. Mismo CHECK y mismas razones que
-- `care_records_dia_formato`.
ALTER TABLE "incidents"
    ADD CONSTRAINT "incidents_dia_formato"
    CHECK ("care_day" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');

ALTER TABLE "incidents"
    ADD CONSTRAINT "incidents_tipo_no_vacio"
    CHECK ("incident_type" <> '');

-- ── Las FKs · RESTRICT en todo lo que dice QUÉ y QUIÉN ──────────────
ALTER TABLE "incidents"
    ADD CONSTRAINT "incidents_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "incidents"
    ADD CONSTRAINT "incidents_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "incidents"
    ADD CONSTRAINT "incidents_source_record_id_fkey"
    FOREIGN KEY ("source_record_id") REFERENCES "care_records"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "incidents"
    ADD CONSTRAINT "incidents_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "devices"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- `SET NULL` y no `RESTRICT`, al revés que el resto: retirar una
-- habitación del edificio no puede quedar bloqueado por lo que pasó
-- dentro hace tres años, y lo que importa de la incidencia —el residente,
-- el tipo, quién la abrió— no está en esta columna.
ALTER TABLE "incidents"
    ADD CONSTRAINT "incidents_room_id_fkey"
    FOREIGN KEY ("room_id") REFERENCES "rooms"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "incidents"
    ADD CONSTRAINT "incidents_opened_by_user_id_fkey"
    FOREIGN KEY ("opened_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "incidents"
    ADD CONSTRAINT "incidents_opened_by_care_role_assignment_id_fkey"
    FOREIGN KEY ("opened_by_care_role_assignment_id") REFERENCES "care_role_assignments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "incidents"
    ADD CONSTRAINT "incidents_closed_by_user_id_fkey"
    FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "incidents"
    ADD CONSTRAINT "incidents_closed_by_care_role_assignment_id_fkey"
    FOREIGN KEY ("closed_by_care_role_assignment_id") REFERENCES "care_role_assignments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "incidents"
    ADD CONSTRAINT "incidents_center_shift_id_fkey"
    FOREIGN KEY ("center_shift_id") REFERENCES "center_shifts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "incidents_tenant_id_idx" ON "incidents"("tenant_id");
-- **«Qué hay abierto hoy»**, que es literalmente la métrica de éxito de
-- dirección (rama §6.3). Parcial: la lista de abiertas es siempre corta y
-- el libro crece para siempre.
CREATE INDEX "incidents_abiertas_key"
    ON "incidents"("tenant_id", "severity", "opened_at")
    WHERE "open" = true;
CREATE INDEX "incidents_tenant_id_open_severity_idx"
    ON "incidents"("tenant_id", "open", "severity");
CREATE INDEX "incidents_tenant_id_subject_opened_at_idx"
    ON "incidents"("tenant_id", "subject", "opened_at");
CREATE INDEX "incidents_tenant_id_care_day_idx"
    ON "incidents"("tenant_id", "care_day");
-- La IDEMPOTENCIA de la derivación: «¿tiene este residente una incidencia
-- abierta de este tipo?» se pregunta por cada medida que entra.
CREATE INDEX "incidents_client_id_incident_type_open_idx"
    ON "incidents"("client_id", "incident_type", "open");

-- ── INMUTABLE, con TRES transiciones legítimas ──────────────────────
--
-- La regla de `care_records` otra vez, con sus escapatorias propias.
-- Lo que pasó no se edita; lo que cambia es lo que se DECIDE después:
--
--   1. **el nivel** (`severity`), que escribe su acción de tipo
--      `SEVERITY` con el de antes y el de después;
--   2. **el cierre** (`closed_at`, `closed_by_*`, `self_closed`, `open`);
--   3. **que ya se avisó** (`alerted_at`), que es contabilidad del aviso.
--
-- Y una cuarta regla que no es una columna: **una incidencia cerrada no
-- se vuelve a tocar**. Ni se reabre ni se le cambia el nivel. Si llega
-- otra medida del mismo tipo, la derivación abre una NUEVA —busca por
-- `open = true`— y eso es correcto: una fiebre que vuelve dos días
-- después es otra fiebre.
--
-- Las diecisiete columnas inmutables se comparan **una por una y por su
-- nombre**. Un `row(NEW.*) IS DISTINCT FROM row(OLD.*)` habría sido más
-- corto y habría dejado pasar en silencio cualquier columna añadida
-- después; con esto, el día que la tabla gane una, el test del contrato
-- del SQL se pone rojo y recuerda por qué.
CREATE FUNCTION mipiacetpv_incidents_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'RESIDENCIA_VIOLADA: una incidencia no se borra (incidents.%). Se cierra, con autor y hora, y se queda en el libro.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    IF NEW.id                                 IS DISTINCT FROM OLD.id
       OR NEW.tenant_id                          IS DISTINCT FROM OLD.tenant_id
       OR NEW.subject                            IS DISTINCT FROM OLD.subject
       OR NEW.client_id                          IS DISTINCT FROM OLD.client_id
       OR NEW.origin                             IS DISTINCT FROM OLD.origin
       OR NEW.incident_type                      IS DISTINCT FROM OLD.incident_type
       OR NEW.template_version                   IS DISTINCT FROM OLD.template_version
       OR NEW.description_cifrado                IS DISTINCT FROM OLD.description_cifrado
       OR NEW.source_record_id                   IS DISTINCT FROM OLD.source_record_id
       OR NEW.device_id                          IS DISTINCT FROM OLD.device_id
       OR NEW.room_id                            IS DISTINCT FROM OLD.room_id
       OR NEW.opened_at                          IS DISTINCT FROM OLD.opened_at
       OR NEW.opened_by_user_id                  IS DISTINCT FROM OLD.opened_by_user_id
       OR NEW.opened_by_care_role_assignment_id  IS DISTINCT FROM OLD.opened_by_care_role_assignment_id
       OR NEW.center_shift_id                    IS DISTINCT FROM OLD.center_shift_id
       OR NEW.care_day                           IS DISTINCT FROM OLD.care_day
       OR NEW.created_at                         IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION
            'RESIDENCIA_VIOLADA: una incidencia no se edita (incidents.%). Lo que se hizo después se escribe como ACCIÓN, con su autor y su hora.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    IF OLD.open = false THEN
        RAISE EXCEPTION
            'RESIDENCIA_VIOLADA: la incidencia % está cerrada y una incidencia cerrada no se reabre ni cambia de nivel. Si vuelve a pasar, se abre otra.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    -- Cerrar es poner las cuatro cosas, no quitarlas. El CHECK
    -- `incidents_abierta_coherente` ya impide `open = false` sin cierre;
    -- esto impide lo contrario, que es `closed_at` sin bajar `open`.
    IF NEW.closed_at IS NOT NULL AND NEW.open = true THEN
        RAISE EXCEPTION
            'RESIDENCIA_VIOLADA: la incidencia % no puede estar cerrada y abierta a la vez.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$fn$;

CREATE TRIGGER "incidents_inmutable"
    BEFORE UPDATE OR DELETE ON "incidents"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_incidents_inmutable();

-- ════════════════════════════════════════════════════════════════════
--  4 · incident_links · DOS INCIDENCIAS ENLAZADAS (D-35)
-- ════════════════════════════════════════════════════════════════════
--
-- La caída de la 112 y el asidero suelto de la 112. Es el caso que
-- justifica el libro único.
--
-- **El par se guarda UNA vez y ORDENADO** (`a_id < b_id`). La
-- alternativa —dos filas simétricas— deja la puerta abierta a que una se
-- borre y la otra no, y entonces la caída enlaza con la avería y la
-- avería no enlaza con nada.
CREATE TABLE "incident_links" (
    "id"                 UUID        NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"          UUID        NOT NULL,
    "a_id"               UUID        NOT NULL,
    "b_id"               UUID        NOT NULL,
    "created_at"         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "incident_links_pkey" PRIMARY KEY ("id")
);

-- Ordenado y sin reflexivos. El orden es lo que hace que el `UNIQUE` de
-- abajo signifique «este par, una vez» y no «este par en este sentido».
ALTER TABLE "incident_links"
    ADD CONSTRAINT "incident_links_ordenado"
    CHECK ("a_id" < "b_id");

ALTER TABLE "incident_links"
    ADD CONSTRAINT "incident_links_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- `CASCADE` a las dos incidencias, al revés que el resto del bloque: un
-- enlace **sí se puede deshacer** (enlazar mal dos incidencias es un
-- error de dedo del admin y deshacerlo no borra ninguna evidencia: las
-- dos incidencias siguen enteras). Y una incidencia no se borra nunca, así
-- que la cascada no se dispara en la práctica.
ALTER TABLE "incident_links"
    ADD CONSTRAINT "incident_links_a_id_fkey"
    FOREIGN KEY ("a_id") REFERENCES "incidents"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "incident_links"
    ADD CONSTRAINT "incident_links_b_id_fkey"
    FOREIGN KEY ("b_id") REFERENCES "incidents"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "incident_links"
    ADD CONSTRAINT "incident_links_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "incident_links_a_id_b_id_key"
    ON "incident_links"("a_id", "b_id");
CREATE INDEX "incident_links_tenant_id_idx" ON "incident_links"("tenant_id");
CREATE INDEX "incident_links_b_id_idx" ON "incident_links"("b_id");

-- ════════════════════════════════════════════════════════════════════
--  5 · incident_actions · QUÉ SE HIZO (append-only)
-- ════════════════════════════════════════════════════════════════════
--
-- El histórico de una incidencia es la evidencia de la acción correctora,
-- y una evidencia que se edita no es evidencia. Misma regla que
-- `clinical_addenda` y que `clinical_access_log`: **ni UPDATE ni
-- DELETE**, sin escapatorias. Una acción mal escrita se corrige
-- escribiendo otra que lo diga.
--
-- Y es donde se adjunta la EVIDENCIA: cuando una segunda toma de fiebre
-- llega y el residente ya tiene una incidencia `FIEBRE` abierta, no se
-- abre otra — se escribe una acción `EVIDENCE` apuntando a ese
-- `care_record`. Tres tomas en un turno son UNA incidencia con tres
-- líneas.
CREATE TABLE "incident_actions" (
    "id"             UUID                 NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"      UUID                 NOT NULL,
    "incident_id"    UUID                 NOT NULL,
    "kind"           "IncidentActionKind" NOT NULL,

    -- El texto, cifrado (D-63). Opcional: una acción `EVIDENCE` o
    -- `SEVERITY` no necesita que nadie escriba nada.
    "text_cifrado"   TEXT,

    -- Sólo `SEVERITY`: de qué nivel a qué nivel.
    "severity_from"  "SeverityLevel",
    "severity_to"    "SeverityLevel",

    -- Sólo `EVIDENCE`: qué medida se adjuntó.
    "care_record_id" UUID,

    -- Sólo `CALL` (D-33): si se llamó o no al servicio sanitario de
    -- guardia. El sistema no llama a nadie; lo que se apunta es qué
    -- decidió la persona.
    "called"         BOOLEAN,

    "at"                         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "by_user_id"                 UUID        NOT NULL,
    "by_care_role_assignment_id" UUID        NOT NULL,

    CONSTRAINT "incident_actions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "incident_actions"
    ADD CONSTRAINT "incident_actions_text_cifrado_formato"
    CHECK ("text_cifrado" IS NULL
           OR "text_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

-- Un cambio de nivel sin decir de cuál a cuál no se puede leer.
ALTER TABLE "incident_actions"
    ADD CONSTRAINT "incident_actions_nivel_completo"
    CHECK (
        ("kind" = 'SEVERITY' AND "severity_from" IS NOT NULL AND "severity_to" IS NOT NULL)
     OR ("kind" <> 'SEVERITY' AND "severity_from" IS NULL AND "severity_to" IS NULL)
    );

ALTER TABLE "incident_actions"
    ADD CONSTRAINT "incident_actions_evidencia_con_medida"
    CHECK (
        ("kind" = 'EVIDENCE' AND "care_record_id" IS NOT NULL)
     OR ("kind" <> 'EVIDENCE' AND "care_record_id" IS NULL)
    );

ALTER TABLE "incident_actions"
    ADD CONSTRAINT "incident_actions_llamada_decidida"
    CHECK (
        ("kind" = 'CALL' AND "called" IS NOT NULL)
     OR ("kind" <> 'CALL' AND "called" IS NULL)
    );

-- Una nota sin texto es una línea en la cronología que no dice nada.
ALTER TABLE "incident_actions"
    ADD CONSTRAINT "incident_actions_nota_con_texto"
    CHECK ("kind" <> 'NOTE' OR "text_cifrado" IS NOT NULL);

ALTER TABLE "incident_actions"
    ADD CONSTRAINT "incident_actions_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "incident_actions"
    ADD CONSTRAINT "incident_actions_incident_id_fkey"
    FOREIGN KEY ("incident_id") REFERENCES "incidents"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "incident_actions"
    ADD CONSTRAINT "incident_actions_care_record_id_fkey"
    FOREIGN KEY ("care_record_id") REFERENCES "care_records"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "incident_actions"
    ADD CONSTRAINT "incident_actions_by_user_id_fkey"
    FOREIGN KEY ("by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "incident_actions"
    ADD CONSTRAINT "incident_actions_by_care_role_assignment_id_fkey"
    FOREIGN KEY ("by_care_role_assignment_id") REFERENCES "care_role_assignments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "incident_actions_tenant_id_idx" ON "incident_actions"("tenant_id");
CREATE INDEX "incident_actions_incident_id_at_idx"
    ON "incident_actions"("incident_id", "at");

-- Sin escapatoria del «padre borrado»: las FKs son RESTRICT, así que la
-- cascada que esa escapatoria cubre en S1 y F1 no puede ocurrir aquí.
-- Mismo razonamiento que `clinical_access_log_append_only` y que
-- `care_records_inmutable`.
CREATE FUNCTION mipiacetpv_incident_actions_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'RESIDENCIA_VIOLADA: lo que se hizo en una incidencia no se borra (incident_actions.%). Si está mal, se escribe otra acción que lo diga.',
            OLD.id USING ERRCODE = '23514';
    END IF;
    RAISE EXCEPTION
        'RESIDENCIA_VIOLADA: lo que se hizo en una incidencia no se edita (incident_actions.%). Si está mal, se escribe otra acción que lo diga.',
        OLD.id USING ERRCODE = '23514';
END;
$fn$;

CREATE TRIGGER "incident_actions_append_only"
    BEFORE UPDATE OR DELETE ON "incident_actions"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_incident_actions_append_only();

-- ════════════════════════════════════════════════════════════════════
--  6 · family_communications · LO QUE SE LE DIJO A LA FAMILIA (D-32/34)
-- ════════════════════════════════════════════════════════════════════
--
-- Dimensión APARTE del nivel (rama §9): una caída sin consecuencias es N1
-- y la familia quiere saberlo el mismo día; un hallazgo N3 puede convenir
-- no comunicarlo hasta tener diagnóstico.
--
-- **Las dos son constancia.** `NO_COMUNICADO` con autor y motivo es un
-- registro tan válido como `COMUNICADO`, por la misma lógica de
-- denominador que el «como siempre» (D-15): sin la segunda no se
-- distingue «se decidió no llamar» de «nadie se acordó». Y **una
-- incidencia de residente no se cierra sin una de las dos** — lo
-- comprueba la ruta de cierre y tiene su fila en la tabla de sabotajes.
--
-- Append-only, igual que las acciones: es constancia de una conversación
-- que ocurrió.
--
-- Y el sistema **no envía nada** (D-33): esto registra una llamada que
-- hizo una persona. El portal de familias es `familias-1`.
CREATE TABLE "family_communications" (
    "id"               UUID                        NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"        UUID                        NOT NULL,
    "incident_id"      UUID                        NOT NULL,

    "kind"             "FamilyCommunicationKind"   NOT NULL,
    "channel"          "FamilyCommunicationChannel",

    -- A quién. Texto y no FK: se llamó a la hija y contestó el yerno, y
    -- lo que se guarda es lo que pasó. En claro, como el resto de la
    -- identidad (residencia-1b §2).
    "contact_name"     TEXT,
    "contact_relation" TEXT,

    -- QUÉ SE DIJO y QUÉ CONTESTARON, cifrados (D-63). En un
    -- `NO_COMUNICADO`, `content_cifrado` es el MOTIVO. NOT NULL: una
    -- constancia sin contenido no es constancia.
    "content_cifrado"  TEXT                        NOT NULL,
    "response_cifrado" TEXT,

    "at"                         TIMESTAMPTZ NOT NULL,
    "by_user_id"                 UUID        NOT NULL,
    "by_care_role_assignment_id" UUID        NOT NULL,
    "created_at"                 TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "family_communications_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "family_communications"
    ADD CONSTRAINT "family_communications_content_cifrado_formato"
    CHECK ("content_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

ALTER TABLE "family_communications"
    ADD CONSTRAINT "family_communications_response_cifrado_formato"
    CHECK ("response_cifrado" IS NULL
           OR "response_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

-- Un «no comunicado» con vía y con respuesta de la familia es una
-- contradicción: si contestaron, se comunicó.
ALTER TABLE "family_communications"
    ADD CONSTRAINT "family_communications_via_coherente"
    CHECK (
        ("kind" = 'COMUNICADO' AND "channel" IS NOT NULL)
     OR ("kind" = 'NO_COMUNICADO' AND "channel" IS NULL
            AND "response_cifrado" IS NULL)
    );

ALTER TABLE "family_communications"
    ADD CONSTRAINT "family_communications_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "family_communications"
    ADD CONSTRAINT "family_communications_incident_id_fkey"
    FOREIGN KEY ("incident_id") REFERENCES "incidents"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "family_communications"
    ADD CONSTRAINT "family_communications_by_user_id_fkey"
    FOREIGN KEY ("by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "family_communications"
    ADD CONSTRAINT "family_communications_by_care_role_assignment_id_fkey"
    FOREIGN KEY ("by_care_role_assignment_id") REFERENCES "care_role_assignments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "family_communications_tenant_id_idx"
    ON "family_communications"("tenant_id");
CREATE INDEX "family_communications_incident_id_at_idx"
    ON "family_communications"("incident_id", "at");

CREATE FUNCTION mipiacetpv_family_communications_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'RESIDENCIA_VIOLADA: lo que se le dijo a la familia no se borra (family_communications.%). Si hubo otra llamada, se escribe otra.',
            OLD.id USING ERRCODE = '23514';
    END IF;
    RAISE EXCEPTION
        'RESIDENCIA_VIOLADA: lo que se le dijo a la familia no se edita (family_communications.%). Si hubo otra llamada, se escribe otra.',
        OLD.id USING ERRCODE = '23514';
END;
$fn$;

CREATE TRIGGER "family_communications_append_only"
    BEFORE UPDATE OR DELETE ON "family_communications"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_family_communications_append_only();

-- ════════════════════════════════════════════════════════════════════
--  7 · guard_alerts · EL AVISO QUE TIENE QUE SONAR (D-19, D-66)
-- ════════════════════════════════════════════════════════════════════
--
-- Una fila por (incidencia, canal). N2 abre una de `ENFERMERIA`; N3 y N4
-- abren las dos a la vez; y si la de enfermería se agota sin acuse, se
-- abre la de `RESPONSABLE` **sin cancelar la primera** — el aviso no se
-- mueve de sitio, se suma uno.
--
-- ── «SIN RED NO SE FINGE» ───────────────────────────────────────────
--
-- Es el peor fallo posible de este bloque y por eso tiene columna:
-- `queued_at` es cuándo lo apuntó la TABLET y `created_at` cuándo llegó
-- al servidor, igual que los dos instantes de `care_records`. Un aviso
-- que sale con dos horas de retraso suena igual, con su hora original y
-- su retraso a la vista; y la puerta nunca dice «avisado» hasta que el
-- servidor lo confirma.
--
-- ── EL ESCALADO NO LO DECIDE UN `setTimeout` ────────────────────────
--
-- `escalate_at` es una columna con su índice parcial. La pasada pregunta
-- «¿qué avisos sin acusar tienen la hora pasada?» — un temporizador en
-- memoria se pierde al reiniciar la API, y un aviso que no escala porque
-- alguien desplegó es exactamente lo que este bloque existe para evitar.
CREATE TABLE "guard_alerts" (
    "id"           UUID              NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"    UUID              NOT NULL,
    "incident_id"  UUID              NOT NULL,

    "channel"      "GuardChannel"    NOT NULL,
    "severity"     "SeverityLevel"   NOT NULL,
    "state"        "GuardAlertState" NOT NULL DEFAULT 'PENDING',

    "queued_at"    TIMESTAMPTZ       NOT NULL,
    "created_at"   TIMESTAMPTZ       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- NULL = este aviso no escala: el de `RESPONSABLE`, que es el último
    -- eslabón, y los de N3/N4 que ya salieron a los dos canales.
    "escalate_at"  TIMESTAMPTZ,
    "escalated_from_id" UUID,

    -- Cuándo un móvil de ese canal lo tuvo delante. **No es el acuse**:
    -- es que llegó. Sirve para contestar «¿sonó?» cuando nadie lo acusó.
    "delivered_at" TIMESTAMPTZ,

    -- EL ACUSE. «Voy» se pulsa con PIN: persona + capacidad + hora
    -- (D-31). No es un botón de «leído»: es quien se hace cargo.
    "acked_at"                         TIMESTAMPTZ,
    "acked_by_user_id"                 UUID,
    "acked_by_care_role_assignment_id" UUID,
    "acked_by_device_id"               UUID,

    CONSTRAINT "guard_alerts_pkey" PRIMARY KEY ("id")
);

-- Las cuatro juntas o ninguna. Un aviso acusado sin saber quién lo acusó
-- es exactamente lo que no vale: «alguien va» no es «va Lucía».
ALTER TABLE "guard_alerts"
    ADD CONSTRAINT "guard_alerts_acuse_completo"
    CHECK (
        ("acked_at" IS NULL AND "acked_by_user_id" IS NULL
            AND "acked_by_care_role_assignment_id" IS NULL
            AND "acked_by_device_id" IS NULL)
     OR ("acked_at" IS NOT NULL AND "acked_by_user_id" IS NOT NULL
            AND "acked_by_care_role_assignment_id" IS NOT NULL
            AND "acked_by_device_id" IS NOT NULL)
    );

-- El estado y el acuse dicen lo mismo y no se pueden contradecir.
ALTER TABLE "guard_alerts"
    ADD CONSTRAINT "guard_alerts_estado_coherente"
    CHECK (("state" = 'ACKED') = ("acked_at" IS NOT NULL));

ALTER TABLE "guard_alerts"
    ADD CONSTRAINT "guard_alerts_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "guard_alerts"
    ADD CONSTRAINT "guard_alerts_incident_id_fkey"
    FOREIGN KEY ("incident_id") REFERENCES "incidents"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "guard_alerts"
    ADD CONSTRAINT "guard_alerts_escalated_from_id_fkey"
    FOREIGN KEY ("escalated_from_id") REFERENCES "guard_alerts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "guard_alerts"
    ADD CONSTRAINT "guard_alerts_acked_by_user_id_fkey"
    FOREIGN KEY ("acked_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "guard_alerts"
    ADD CONSTRAINT "guard_alerts_acked_by_care_role_assignment_id_fkey"
    FOREIGN KEY ("acked_by_care_role_assignment_id") REFERENCES "care_role_assignments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "guard_alerts"
    ADD CONSTRAINT "guard_alerts_acked_by_device_id_fkey"
    FOREIGN KEY ("acked_by_device_id") REFERENCES "devices"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- **UN AVISO POR (INCIDENCIA, CANAL), y lo dice el motor.** Reenviar el
-- mismo lote o derivar dos veces la misma medida no hace sonar dos veces.
-- Es la idempotencia del aviso, y vive aquí y no en un `if` por lo mismo
-- que el índice de ocurrencia de `care_records`: un `if` se olvida en la
-- siguiente ruta que escriba.
CREATE UNIQUE INDEX "guard_alerts_incident_id_channel_key"
    ON "guard_alerts"("incident_id", "channel");

CREATE INDEX "guard_alerts_tenant_id_idx" ON "guard_alerts"("tenant_id");
-- La pasada del escalado: «sin acusar y con la hora pasada». Parcial,
-- porque lo acusado y lo cancelado son la inmensa mayoría de la tabla a
-- los cinco minutos de existir.
CREATE INDEX "guard_alerts_por_escalar_key"
    ON "guard_alerts"("escalate_at")
    WHERE "state" IN ('PENDING', 'DELIVERED');
CREATE INDEX "guard_alerts_tenant_id_channel_state_idx"
    ON "guard_alerts"("tenant_id", "channel", "state");

-- ════════════════════════════════════════════════════════════════════
--  8 · guard_shift_sessions · QUIÉN LLEVA EL MÓVIL (D-66)
-- ════════════════════════════════════════════════════════════════════
--
-- «Al empezar el turno, quien coge el móvil entra con su PIN». Eso hace
-- tres cosas de una vez, y por eso **no hace falta cuadrante**:
--
--   1. deja la línea en el registro de accesos;
--   2. le dice al sistema si hay enfermera de guardia en este turno, que
--      es lo que decide si un N2 escala al momento o a los 5 minutos;
--   3. pone el nombre en la pantalla en reposo del móvil, que es lo que
--      hace que quien lo coja sepa que está cogido.
CREATE TABLE "guard_shift_sessions" (
    "id"                      UUID           NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"               UUID           NOT NULL,
    "device_id"               UUID           NOT NULL,
    -- Copiado del dispositivo al empezar. Redundante a propósito: el
    -- canal de un móvil se puede cambiar en el admin, y «quién estaba de
    -- guardia en enfermería el martes» tiene que seguir contestándose.
    "channel"                 "GuardChannel" NOT NULL,

    "user_id"                 UUID           NOT NULL,
    "care_role_assignment_id" UUID           NOT NULL,

    "started_at"              TIMESTAMPTZ    NOT NULL,
    "ended_at"                TIMESTAMPTZ,
    "ended_by_user_id"        UUID,

    "center_shift_id"         UUID,
    "care_day"                VARCHAR(10)    NOT NULL,
    "created_at"              TIMESTAMPTZ    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guard_shift_sessions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "guard_shift_sessions"
    ADD CONSTRAINT "guard_shift_sessions_vigencia_ordenada"
    CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at");

ALTER TABLE "guard_shift_sessions"
    ADD CONSTRAINT "guard_shift_sessions_dia_formato"
    CHECK ("care_day" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');

ALTER TABLE "guard_shift_sessions"
    ADD CONSTRAINT "guard_shift_sessions_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "guard_shift_sessions"
    ADD CONSTRAINT "guard_shift_sessions_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "devices"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "guard_shift_sessions"
    ADD CONSTRAINT "guard_shift_sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "guard_shift_sessions"
    ADD CONSTRAINT "guard_shift_sessions_care_role_assignment_id_fkey"
    FOREIGN KEY ("care_role_assignment_id") REFERENCES "care_role_assignments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "guard_shift_sessions"
    ADD CONSTRAINT "guard_shift_sessions_ended_by_user_id_fkey"
    FOREIGN KEY ("ended_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "guard_shift_sessions"
    ADD CONSTRAINT "guard_shift_sessions_center_shift_id_fkey"
    FOREIGN KEY ("center_shift_id") REFERENCES "center_shifts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- **UNA guardia viva por MÓVIL**, no por canal. Coger el móvil cierra la
-- guardia anterior de ESE móvil, en la misma transacción; si ese UPDATE
-- no corriera, el INSERT revienta aquí en vez de dejar dos personas
-- «de guardia» en el mismo aparato.
--
-- Por móvil y no por canal porque un centro puede tener dos enfermeras de
-- guardia con dos móviles, y las dos están de guardia: las dos tienen que
-- sonar.
CREATE UNIQUE INDEX "guard_shift_sessions_una_viva_key"
    ON "guard_shift_sessions"("device_id")
    WHERE "ended_at" IS NULL;

CREATE INDEX "guard_shift_sessions_tenant_id_idx"
    ON "guard_shift_sessions"("tenant_id");
-- «¿Hay alguien de guardia en este canal ahora?», que es la pregunta que
-- decide el escalado inmediato de un N2.
CREATE INDEX "guard_shift_sessions_tenant_id_channel_ended_at_idx"
    ON "guard_shift_sessions"("tenant_id", "channel", "ended_at");
CREATE INDEX "guard_shift_sessions_device_id_started_at_idx"
    ON "guard_shift_sessions"("device_id", "started_at");

-- ════════════════════════════════════════════════════════════════════
--  9 · center_guard_settings · LO QUE EL CENTRO CONFIGURA (§10)
-- ════════════════════════════════════════════════════════════════════
--
-- La frontera, otra vez: el MOTOR de gravedad y de escalado es del
-- producto; los **destinatarios de cada nivel** y los minutos de espera
-- son del centro (rama de controles §10). Y el servicio sanitario de
-- guardia es suyo por definición: el centro de salud de Buenaventura no
-- es el de nadie más.
--
-- Una fila por tenant, **sin sembrar al encender el módulo**: «no
-- configurado» y «configurado con los valores de serie» son lo mismo para
-- el motor, y sembrarla sería una fila por centro que mantener a cambio
-- de nada.
CREATE TABLE "center_guard_settings" (
    "tenant_id"           UUID           NOT NULL,

    -- 5 por defecto (D-66). CHECK 1..60: menos de un minuto no da tiempo
    -- a sacar el móvil del bolsillo, y más de una hora no es un escalado.
    "escalation_minutes"  INTEGER        NOT NULL DEFAULT 5,

    -- A qué canales suena cada nivel. **Vacío = ese nivel no suena**, que
    -- es una decisión legítima del centro y se pinta como tal.
    --
    -- N0 y N1 no tienen columna: N0 no abre nada (D-27) y N1 va al relevo
    -- (D-19, la velocidad lenta). Dárselas al centro sería dejarle
    -- convertir el móvil de guardia en un aparato que suena ochenta veces
    -- por turno y que nadie mira.
    "level_n2_channels"   "GuardChannel"[] NOT NULL DEFAULT ARRAY['ENFERMERIA']::"GuardChannel"[],
    "level_n3_channels"   "GuardChannel"[] NOT NULL DEFAULT ARRAY['ENFERMERIA','RESPONSABLE']::"GuardChannel"[],
    "level_n4_channels"   "GuardChannel"[] NOT NULL DEFAULT ARRAY['ENFERMERIA','RESPONSABLE']::"GuardChannel"[],

    -- EL SERVICIO SANITARIO DE GUARDIA, COMO RECOMENDACIÓN (D-33). El
    -- móvil muestra «Recomendado: llamar a …» con un botón que abre el
    -- marcador; la llamada la hace la persona.
    "health_service_name"  TEXT,
    "health_service_phone" TEXT,

    "created_at"          TIMESTAMPTZ    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMPTZ    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "center_guard_settings_pkey" PRIMARY KEY ("tenant_id")
);

ALTER TABLE "center_guard_settings"
    ADD CONSTRAINT "center_guard_settings_minutos"
    CHECK ("escalation_minutes" >= 1 AND "escalation_minutes" <= 60);

-- Un nombre sin teléfono es un botón que no marca, y un teléfono sin
-- nombre es un número que nadie sabe de quién es.
ALTER TABLE "center_guard_settings"
    ADD CONSTRAINT "center_guard_settings_servicio"
    CHECK (
        ("health_service_name" IS NULL AND "health_service_phone" IS NULL)
     OR ("health_service_name" IS NOT NULL AND "health_service_name" <> ''
            AND "health_service_phone" IS NOT NULL AND "health_service_phone" <> '')
    );

ALTER TABLE "center_guard_settings"
    ADD CONSTRAINT "center_guard_settings_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ════════════════════════════════════════════════════════════════════
-- 10 · devices y pairing_codes · EL CANAL DEL MÓVIL DE GUARDIA
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE "devices"     ADD COLUMN "guard_channel" "GuardChannel";
ALTER TABLE "pairing_codes" ADD COLUMN "guard_channel" "GuardChannel";

-- Un móvil de guardia sin canal no recibiría ningún aviso, y el fallo se
-- vería la noche que alguien tenga 38,6 — no al emparejarlo. Misma forma
-- exacta que `devices_kitchen_sections` en kds-1 y que
-- `devices_kitchen_lan_solo_cocina`: **lo que no es de este tipo no puede
-- ni apuntarlo**.
ALTER TABLE "devices"
    ADD CONSTRAINT "devices_guard_canal"
    CHECK (("kind" = 'GUARD' AND "guard_channel" IS NOT NULL)
        OR ("kind" <> 'GUARD' AND "guard_channel" IS NULL));

ALTER TABLE "pairing_codes"
    ADD CONSTRAINT "pairing_codes_guard_canal"
    CHECK (("kind" = 'GUARD' AND "guard_channel" IS NOT NULL)
        OR ("kind" <> 'GUARD' AND "guard_channel" IS NULL));

-- ── Y el CHECK de siempre, REESCRITO para que quepa un tercer caso ──
--
-- residencia-1 lo dejó en dos: «un `ROOM` tiene habitación y NO caja, y
-- todo lo demás tiene caja y NO habitación». Un `GUARD` no tiene ninguna
-- de las dos —no es de una caja ni de una habitación, es de quien lo
-- lleve ese turno— así que el CHECK de residencia-1 lo rechazaría.
--
-- El nuevo es **más permisivo que el que sustituye**: todo lo que pasaba
-- sigue pasando, y además pasa un `GUARD`. Por eso el scan que hace al
-- crearse no puede rechazar ninguna fila de hoy. Y lo que NO se relaja es
-- lo que importaba: un terminal sigue exigiendo caja, una puerta sigue
-- exigiendo habitación, y ninguno de los dos puede tener la del otro.
ALTER TABLE "devices" DROP CONSTRAINT "devices_register_o_habitacion";
ALTER TABLE "devices"
    ADD CONSTRAINT "devices_register_o_habitacion"
    CHECK (
        ("kind" = 'ROOM'  AND "room_id" IS NOT NULL AND "register_id" IS NULL)
     OR ("kind" = 'GUARD' AND "room_id" IS NULL     AND "register_id" IS NULL)
     OR ("kind" NOT IN ('ROOM', 'GUARD')
            AND "room_id" IS NULL AND "register_id" IS NOT NULL)
    );

ALTER TABLE "pairing_codes" DROP CONSTRAINT "pairing_codes_register_o_habitacion";
ALTER TABLE "pairing_codes"
    ADD CONSTRAINT "pairing_codes_register_o_habitacion"
    CHECK (
        ("kind" = 'ROOM'  AND "room_id" IS NOT NULL AND "register_id" IS NULL)
     OR ("kind" = 'GUARD' AND "room_id" IS NULL     AND "register_id" IS NULL)
     OR ("kind" NOT IN ('ROOM', 'GUARD')
            AND "room_id" IS NULL AND "register_id" IS NOT NULL)
    );
