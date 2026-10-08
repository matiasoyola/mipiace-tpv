-- clinica-4 · el consentimiento que vale, la foto que no se pierde y la
-- entrega que queda apuntada.
--
-- Tres garantías, y las tres en el motor por la razón de clinica-1 y de
-- `s1_sello_de_la_venta`: la aplicación no es la única puerta a Postgres.
--
--   1. **Un consentimiento firmado no se edita ni se borra, y no se va
--      con la ficha del paciente.** `client_consents` pasa a ser de solo
--      inserción y su FK al cliente pasa de CASCADE a RESTRICT (S3,
--      condición 1). Revocar es una fila nueva enlazada (condición 2).
--   2. **Una foto clínica no se borra: se retira**, con autor y motivo
--      (decisión 13). La fila es inmutable salvo esa única transición, y
--      una vez retirada no se deshace — el mismo trato que la revocación
--      de un acceso en `clinical_access`.
--   3. **Toda entrega de un informe queda apuntada**: qué informe, a
--      quién, por qué canal, quién y cuándo. Tabla de solo inserción.
--
-- SQL a mano porque Prisma no expresa triggers, funciones, índices
-- parciales ni CHECKs. Mismo patrón que las cinco migraciones clínicas.
--
-- ── Una sola migración, y por fin por el motivo bueno ─────────────────
--
-- clinica-1, -2 y -3 necesitaron dos cada una porque Postgres prohíbe USAR
-- un valor de enum en la misma transacción en que se añade. Aquí **no se
-- añade ningún valor a ningún enum**: los campos nuevos de lista cerrada
-- son `VARCHAR` con CHECK, que es la decisión que tomó
-- `iva_exento_sanitario` y repitió clinica-5. `ClinicalAccessAction` ya
-- tenía `EXPORT` desde clinica-1 (su decisión 11.7, escrita para este
-- bloque), así que el informe no necesita tocar el enum tampoco.
--
-- ── Qué NO es aditivo, y qué se comprobó antes ────────────────────────
--
-- Todo es aditivo MENOS una cosa: `client_consents_client_id_fkey` se
-- recrea de CASCADE a RESTRICT. No borra ni reescribe ninguna fila, pero
-- **cambia el comportamiento de un borrado que antes pasaba**. Lo que se
-- buscó antes de hacerlo (y está en el `-done`):
--
--   · no existe ninguna ruta que borre un cliente (clinica-1 §9 lo dejó
--     buscado camino por camino, y sigue siendo verdad);
--   · el seed del banco (`TRUNCATE`) y el `DROP SCHEMA` del e2e no pasan
--     por la FK;
--   · los tests que daban de alta un consentimiento y luego borraban el
--     cliente: ninguno. `client_consents` sólo se borra hoy por cascada
--     desde `clients`, y nada borra `clients`.
--
-- Las filas que YA existen se quedan como **alta manual sin plantilla**:
-- `template_id` NULL. No se les inventa versión ni huella (S3, lado
-- agenda, punto 4) — y por eso las columnas nuevas nacen NULL en vez de
-- con un default que mentiría.
--
-- ── El `down`, pensado ────────────────────────────────────────────────
--
-- Reversible del todo mientras las tablas nuevas estén vacías. Con fotos,
-- consentimientos con plantilla o entregas dentro, el `down` ES el borrado
-- de historia clínica que esta migración existe para impedir: se hace con
-- copia delante y por decisión escrita, no encadenado en un despliegue.
--
--   DROP TRIGGER "clinical_report_deliveries_append_only" ON "clinical_report_deliveries";
--   DROP TRIGGER "clinical_photos_guard"                  ON "clinical_photos";
--   DROP TRIGGER "client_consents_append_only"            ON "client_consents";
--   DROP FUNCTION mipiacetpv_clinical_report_deliveries_append_only();
--   DROP FUNCTION mipiacetpv_clinical_photos_guard();
--   DROP FUNCTION mipiacetpv_client_consents_append_only();
--   DROP TABLE "clinical_report_deliveries";
--   DROP TABLE "clinical_photos";
--   ALTER TABLE "service_scheduling" DROP COLUMN "consentimientos";
--   ALTER TABLE "client_consents"
--       DROP CONSTRAINT "client_consents_clinica_exige_informante",
--       DROP CONSTRAINT "client_consents_plantilla_completa",
--       DROP CONSTRAINT "client_consents_firmante_valido",
--       DROP CONSTRAINT "client_consents_revoca_distinta",
--       DROP CONSTRAINT "client_consents_revokes_consent_id_fkey",
--       DROP CONSTRAINT "client_consents_informer_user_id_fkey",
--       DROP CONSTRAINT "client_consents_tenant_id_fkey",
--       DROP COLUMN "template_id", DROP COLUMN "template_version",
--       DROP COLUMN "text_sha256", DROP COLUMN "pdf_sha256",
--       DROP COLUMN "pdf_file_name", DROP COLUMN "clinical",
--       DROP COLUMN "signer", DROP COLUMN "signer_name",
--       DROP COLUMN "signer_relation", DROP COLUMN "informer_user_id",
--       DROP COLUMN "revokes_consent_id", DROP COLUMN "revoke_reason",
--       DROP COLUMN "created_by_user_id";
--   -- y la FK del cliente, de vuelta a CASCADE (que es perder la
--   -- garantía, no recuperarla):
--   ALTER TABLE "client_consents" DROP CONSTRAINT "client_consents_client_id_fkey";
--   ALTER TABLE "client_consents" ADD CONSTRAINT "client_consents_client_id_fkey"
--       FOREIGN KEY ("client_id") REFERENCES "clients"("id")
--       ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 1 · `client_consents` sostiene un consentimiento informado ────────

-- Lo que la fila congela (S3, condición 3): la plantilla, su versión, la
-- huella del TEXTO que se leyó y la huella SHA-256 del PDF que se firmó.
-- `doc_ref` sigue siendo el puntero al documento y no se toca.
ALTER TABLE "client_consents"
    ADD COLUMN "template_id"        VARCHAR(40),
    ADD COLUMN "template_version"   INTEGER,
    -- Huella del texto canónico de la plantilla (`textoCanonico`), 64
    -- caracteres hex. No se guarda el texto: la plantilla versionada lo
    -- tiene, y la huella es lo que demuestra que es EL MISMO.
    ADD COLUMN "text_sha256"        CHAR(64),
    -- Huella del PDF firmado. Es la que se vuelve a calcular sobre el
    -- fichero del disco para comprobar que nadie lo ha cambiado.
    ADD COLUMN "pdf_sha256"         CHAR(64),
    -- El fichero, en el volumen de ficheros clínicos. Sin datos del
    -- paciente en el nombre: los nombres de fichero acaban en listados,
    -- logs y capturas de pantalla de quien está depurando.
    ADD COLUMN "pdf_file_name"      VARCHAR(100),
    -- Copia de la marca «clínica» de la plantilla. Se COPIA y no se
    -- consulta cada vez: si mañana una plantilla deja de ser clínica, lo
    -- firmado ayer siguió siendo contenido de una historia clínica.
    ADD COLUMN "clinical"           BOOLEAN NOT NULL DEFAULT false,
    -- Quién firma: el paciente o un representante, con su relación
    -- (S3, condición 4; Ley 41/2002 art. 9.3).
    ADD COLUMN "signer"             VARCHAR(20),
    ADD COLUMN "signer_name"        VARCHAR(120),
    ADD COLUMN "signer_relation"    VARCHAR(60),
    -- Y quién informó. Un `User` cualquiera; que sea sanitario cuando la
    -- plantilla es clínica lo exige la API, porque la condición cruza
    -- `users.is_clinician` con la plantilla y no cabe en un CHECK.
    ADD COLUMN "informer_user_id"   UUID,
    -- LA REVOCACIÓN: una fila nueva que apunta a la que revoca. Nunca un
    -- UPDATE (Ley 41/2002 art. 8.5). Vale igual para `DATA` (RGPD).
    ADD COLUMN "revokes_consent_id" UUID,
    ADD COLUMN "revoke_reason"      VARCHAR(200),
    -- Quién tecleó la fila. En el alta manual del spa es la cajera; en
    -- una firma clínica es el sanitario, que suele ser el informante.
    ADD COLUMN "created_by_user_id" UUID;

-- La FK al tenant no existía: `tenant_id` era un Uuid suelto. Se añade
-- RESTRICT, igual que las cuatro tablas de clinica-1: un tenant con
-- consentimientos firmados no se borra.
ALTER TABLE "client_consents"
    ADD CONSTRAINT "client_consents_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- EL CAMBIO QUE NO ES ADITIVO: CASCADE → RESTRICT.
--
-- Antes, un paciente con sólo un consentimiento firmado (sin sesiones,
-- que sí son RESTRICT desde clinica-1) se podía borrar y se llevaba el
-- documento por delante. Eso es exactamente lo que S3 vino a cerrar.
ALTER TABLE "client_consents" DROP CONSTRAINT "client_consents_client_id_fkey";
ALTER TABLE "client_consents"
    ADD CONSTRAINT "client_consents_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- El informante y el autor: RESTRICT también. Una fila firmada sin autor
-- no es una prueba de nada, así que borrar al profesional se niega — la
-- misma decisión que la autoría NOT NULL de `clinical_entries`.
ALTER TABLE "client_consents"
    ADD CONSTRAINT "client_consents_informer_user_id_fkey"
    FOREIGN KEY ("informer_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Y la fila que se revoca. RESTRICT: la revocación no puede quedarse
-- apuntando al vacío.
ALTER TABLE "client_consents"
    ADD CONSTRAINT "client_consents_revokes_consent_id_fkey"
    FOREIGN KEY ("revokes_consent_id") REFERENCES "client_consents"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Una fila no se revoca a sí misma.
ALTER TABLE "client_consents"
    ADD CONSTRAINT "client_consents_revoca_distinta"
    CHECK ("revokes_consent_id" IS NULL OR "revokes_consent_id" <> "id");

-- Con plantilla, el juego completo: id, versión y huella del texto. Sin
-- plantilla, ninguno de los tres. Un alta manual con media plantilla
-- dentro sería una fila que dice que se informó de un texto que no se
-- sabe cuál fue.
ALTER TABLE "client_consents"
    ADD CONSTRAINT "client_consents_plantilla_completa"
    CHECK (
        ("template_id" IS NULL AND "template_version" IS NULL AND "text_sha256" IS NULL)
        OR ("template_id" IS NOT NULL AND "template_version" IS NOT NULL AND "text_sha256" IS NOT NULL)
    );

-- El firmante: o es el paciente (y entonces no hay nombre ni relación: el
-- suyo ya está en la ficha), o es un representante con las dos cosas.
-- NULL es el alta manual de antes de este bloque.
ALTER TABLE "client_consents"
    ADD CONSTRAINT "client_consents_firmante_valido"
    CHECK (
        "signer" IS NULL
        OR ("signer" = 'PACIENTE' AND "signer_name" IS NULL AND "signer_relation" IS NULL)
        OR ("signer" = 'REPRESENTANTE' AND "signer_name" IS NOT NULL AND "signer_relation" IS NOT NULL)
    );

-- Una plantilla clínica exige informante. Que ADEMÁS sea sanitario lo
-- comprueba la API (cruza dos tablas); que NO SE QUEDE EN BLANCO lo
-- garantiza el motor, que es lo que el motor puede garantizar.
ALTER TABLE "client_consents"
    ADD CONSTRAINT "client_consents_clinica_exige_informante"
    CHECK ("clinical" = false OR "informer_user_id" IS NOT NULL);

-- Para la lista de la ficha y la de la historia: los de un paciente, por
-- plantilla, de la más reciente a la más antigua.
CREATE INDEX "client_consents_tenant_client_template_idx"
    ON "client_consents"("tenant_id", "client_id", "template_id", "granted_at" DESC);

-- Y para la cuenta de la vigencia: quién revoca a quién.
CREATE INDEX "client_consents_revokes_idx"
    ON "client_consents"("revokes_consent_id")
    WHERE "revokes_consent_id" IS NOT NULL;

-- TABLA DE SOLO INSERCIÓN.
--
-- Sin escapatoria «el padre ya no existe», igual que
-- `clinical_access_log` de clinica-1 y por el mismo motivo: con las FKs en
-- RESTRICT la cascada que esa escapatoria cubría no puede ocurrir, y una
-- puerta abierta sin nadie que la use es una puerta abierta.
CREATE FUNCTION mipiacetpv_client_consents_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'HISTORIA_VIOLADA: un consentimiento firmado no se borra (client_consents.%). Para retirarlo se firma una revocación, que también queda escrita.',
            OLD.id USING ERRCODE = '23514';
    END IF;
    RAISE EXCEPTION
        'HISTORIA_VIOLADA: un consentimiento firmado no se edita (client_consents.%). Dice qué texto leyó y firmó una persona; para cambiarlo se firma otro.',
        OLD.id USING ERRCODE = '23514';
END;
$fn$;

CREATE TRIGGER "client_consents_append_only"
    BEFORE UPDATE OR DELETE ON "client_consents"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_client_consents_append_only();

-- ── 2 · qué consentimientos pide un servicio ──────────────────────────

-- Decisión 4: la dueña marca en el SERVICIO qué consentimientos pide, en
-- el sitio donde hoy se configura el servicio (Catálogo de agenda), junto
-- a `primera_valoracion`, `tratamiento_sesion` y `nivel_quiropodia`. La
-- podóloga mantiene UNA pantalla y no dos.
--
-- Un array de ids de plantilla y no una tabla de cruce: son como mucho
-- tres ids por servicio, de una lista cerrada en código, y una tabla de
-- cruce habría traído su FK a una tabla de plantillas que no existe —
-- porque las plantillas están en código, que es la decisión 3.
--
-- Nace en `{}`, así que ningún servicio de los quince tenants de hoy pide
-- ningún consentimiento y ninguna sesión cambia de comportamiento.
ALTER TABLE "service_scheduling"
    ADD COLUMN "consentimientos" VARCHAR(40)[] NOT NULL DEFAULT '{}';

-- Y el tope, que es la lista de plantillas atables de hoy. No valida los
-- ids (eso lo hace la ruta contra el paquete, que es quien los sabe): lo
-- que impide es que alguien meta cincuenta por psql.
ALTER TABLE "service_scheduling"
    ADD CONSTRAINT "service_scheduling_consentimientos_tope"
    CHECK (array_length("consentimientos", 1) IS NULL OR array_length("consentimientos", 1) <= 5);

-- ── 3 · las fotos clínicas ────────────────────────────────────────────

-- El fichero vive en un volumen propio, NO en la base y NO en nada que se
-- sirva en estático (decisión 11). Aquí vive lo que hace falta para
-- encontrarlo, saber de qué zona es y de qué día, y demostrar que no se ha
-- cambiado.
CREATE TABLE "clinical_photos" (
    "id"              UUID        NOT NULL,
    "tenant_id"       UUID        NOT NULL,
    "client_id"       UUID        NOT NULL,
    -- La cita de la que salió. `SET NULL` como en `clinical_entries`: si
    -- la cita desapareciera, la foto sigue en la historia y pierde el
    -- enlace, no el contenido. (Y como la fila es casi inmutable, ese SET
    -- NULL lo rechaza el guard: una cita con fotos no se borra. Es la
    -- misma garantía más fuerte que clinica-3 §6.1 descubrió.)
    "appointment_id"  UUID,
    -- La zona del mapa (`"L:h"`) y la VERSIÓN del mapa con la que se
    -- eligió: lo mismo que guarda una sesión, y por lo mismo. Una foto
    -- apuntada a «arco» que se pinte con la geometría de otra versión es
    -- una foto de otro sitio.
    "zona"            VARCHAR(40) NOT NULL,
    "mapa_version"    INTEGER     NOT NULL,
    "file_name"       VARCHAR(100) NOT NULL,
    "sha256"          CHAR(64)    NOT NULL,
    "bytes"           INTEGER     NOT NULL,
    "mime_type"       VARCHAR(40) NOT NULL,
    -- Quién la hizo. NOT NULL: una foto de la historia sin autor no es
    -- historia clínica.
    "author_user_id"  UUID        NOT NULL,
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- LA RETIRADA (decisión 13). Una foto no se borra: se retira, con
    -- autor y motivo. Deja de verse en el comparador y sigue en la
    -- historia y en el registro.
    "withdrawn_at"      TIMESTAMPTZ,
    "withdrawn_by_user_id" UUID,
    "withdraw_reason"   VARCHAR(200),

    CONSTRAINT "clinical_photos_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "clinical_photos"
    ADD CONSTRAINT "clinical_photos_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "clinical_photos"
    ADD CONSTRAINT "clinical_photos_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "clinical_photos"
    ADD CONSTRAINT "clinical_photos_appointment_id_fkey"
    FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "clinical_photos"
    ADD CONSTRAINT "clinical_photos_author_user_id_fkey"
    FOREIGN KEY ("author_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "clinical_photos"
    ADD CONSTRAINT "clinical_photos_withdrawn_by_user_id_fkey"
    FOREIGN KEY ("withdrawn_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Retirada completa o nada: fecha, autor y motivo van juntos. Una foto
-- «retirada» sin motivo no se puede explicar a nadie.
ALTER TABLE "clinical_photos"
    ADD CONSTRAINT "clinical_photos_retirada_completa"
    CHECK (
        ("withdrawn_at" IS NULL AND "withdrawn_by_user_id" IS NULL AND "withdraw_reason" IS NULL)
        OR ("withdrawn_at" IS NOT NULL AND "withdrawn_by_user_id" IS NOT NULL AND "withdraw_reason" IS NOT NULL)
    );

ALTER TABLE "clinical_photos"
    ADD CONSTRAINT "clinical_photos_bytes_positivos"
    CHECK ("bytes" > 0);

-- El comparador de una zona pide la más antigua y la última DE LAS QUE NO
-- están retiradas. Índice parcial: las retiradas no entran en esa consulta
-- y no tienen por qué ocupar el índice.
CREATE INDEX "clinical_photos_zona_idx"
    ON "clinical_photos"("tenant_id", "client_id", "zona", "created_at")
    WHERE "withdrawn_at" IS NULL;

-- Y la rejilla de «Todas», que SÍ enseña las retiradas marcadas.
CREATE INDEX "clinical_photos_cliente_idx"
    ON "clinical_photos"("tenant_id", "client_id", "created_at" DESC);

-- Un fichero, una fila. Si dos filas apuntaran al mismo fichero, retirar
-- una dejaría la otra sirviendo el mismo JPEG.
CREATE UNIQUE INDEX "clinical_photos_file_name_key"
    ON "clinical_photos"("file_name");

-- LA FOTO NO SE EDITA NI SE BORRA, Y SÓLO SE RETIRA UNA VEZ.
--
-- Mismo patrón que `clinical_access_guard` de clinica-1: la fila es
-- inmutable salvo UNA transición, y esa transición no se deshace. Lo que
-- se deja pasar es exactamente `withdrawn_at IS NULL` → retirada, y nada
-- más: ni cambiar el fichero, ni la zona, ni el autor, ni la huella.
CREATE FUNCTION mipiacetpv_clinical_photos_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'HISTORIA_VIOLADA: una foto clínica no se borra (clinical_photos.%). Se retira con autor y motivo, y sigue en la historia.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    IF NEW.tenant_id      IS DISTINCT FROM OLD.tenant_id
       OR NEW.client_id      IS DISTINCT FROM OLD.client_id
       OR NEW.appointment_id IS DISTINCT FROM OLD.appointment_id
       OR NEW.zona           IS DISTINCT FROM OLD.zona
       OR NEW.mapa_version   IS DISTINCT FROM OLD.mapa_version
       OR NEW.file_name      IS DISTINCT FROM OLD.file_name
       OR NEW.sha256         IS DISTINCT FROM OLD.sha256
       OR NEW.bytes          IS DISTINCT FROM OLD.bytes
       OR NEW.mime_type      IS DISTINCT FROM OLD.mime_type
       OR NEW.author_user_id IS DISTINCT FROM OLD.author_user_id
       OR NEW.created_at     IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION
            'HISTORIA_VIOLADA: la foto clínica % no se reescribe. Dice de qué zona es, de qué día y quién la hizo.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    IF OLD.withdrawn_at IS NOT NULL
       AND (NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at
            OR NEW.withdrawn_by_user_id IS DISTINCT FROM OLD.withdrawn_by_user_id
            OR NEW.withdraw_reason IS DISTINCT FROM OLD.withdraw_reason) THEN
        RAISE EXCEPTION
            'HISTORIA_VIOLADA: la foto % ya está retirada y la retirada no se deshace ni se reescribe.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$fn$;

CREATE TRIGGER "clinical_photos_guard"
    BEFORE UPDATE OR DELETE ON "clinical_photos"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_clinical_photos_guard();

-- ── 4 · las entregas del informe ──────────────────────────────────────

-- Regla 17: toda entrega queda apuntada — qué informe, a quién, por qué
-- canal, quién y cuándo.
--
-- ── Por qué una tabla propia Y la línea de `ClinicalAccessLog` ────────
--
-- El prompt deja elegir entre las dos y pide explicar la elección. Se
-- hacen LAS DOS, y no es indecisión: contestan preguntas distintas y
-- ninguna de las dos puede contestar la de la otra.
--
--   · `clinical_access_log` contesta **«¿quién ha abierto esta
--     historia?»**. Su forma es cerrada desde clinica-1 (quién, a quién,
--     cuándo, aparato, ruta, permitido o no) y **no tiene sitio** para el
--     canal ni para el destinatario. La línea sale gratis, porque la ruta
--     del informe pasa por `conHistoria` con `action = EXPORT` — el valor
--     que clinica-1 metió en el enum sin usarlo, escrito para hoy.
--   · esta tabla contesta **«¿qué se le entregó a quién?»**, que es la
--     pregunta del paciente que pide su historia y la del abogado. Para
--     eso hace falta el tipo de informe, el canal y el destinatario.
--
-- Meter el destinatario en el registro de accesos habría sido ensanchar
-- la tabla que clinica-1 dejó deliberadamente estrecha («nada de salud
-- entra aquí»); y quedarse sólo con la tabla nueva habría dejado una
-- lectura de la historia sin su línea en el registro.
--
-- ── Y qué NO entra aquí ───────────────────────────────────────────────
--
-- Ni un dato de salud: no se guarda el PDF, ni su contenido, ni el motivo
-- de la derivación. El tipo de informe, sí — «derivación» no dice nada de
-- la salud de nadie, y sin él la tabla no contesta su pregunta.
CREATE TABLE "clinical_report_deliveries" (
    "id"          UUID        NOT NULL,
    "tenant_id"   UUID        NOT NULL,
    "client_id"   UUID        NOT NULL,
    -- RESUMEN | SESIONES | DERIVACION | COMPLETA. VARCHAR con CHECK y no
    -- enum: la decisión de `iva_exento_sanitario` y de clinica-5 — un
    -- valor nuevo en un enum obliga a partir la migración en dos.
    "report"      VARCHAR(20) NOT NULL,
    -- PRINT | EMAIL.
    "channel"     VARCHAR(20) NOT NULL,
    -- PACIENTE | PROFESIONAL: para quién era.
    "recipient"   VARCHAR(20) NOT NULL,
    -- El email al que se mandó, cuando el canal es EMAIL. NULL al
    -- imprimir: en papel no hay dirección, se entrega en mano.
    "recipient_email" VARCHAR(200),
    -- Huella del PDF entregado. Es lo que permite decir «esto es lo que
    -- se le dio» y no «se le dio un informe».
    "pdf_sha256"  CHAR(64)    NOT NULL,
    "user_id"     UUID        NOT NULL,
    "at"          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinical_report_deliveries_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "clinical_report_deliveries"
    ADD CONSTRAINT "clinical_report_deliveries_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "clinical_report_deliveries"
    ADD CONSTRAINT "clinical_report_deliveries_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "clinical_report_deliveries"
    ADD CONSTRAINT "clinical_report_deliveries_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "clinical_report_deliveries"
    ADD CONSTRAINT "clinical_report_deliveries_report_valido"
    CHECK ("report" IN ('RESUMEN', 'SESIONES', 'DERIVACION', 'COMPLETA'));

ALTER TABLE "clinical_report_deliveries"
    ADD CONSTRAINT "clinical_report_deliveries_channel_valido"
    CHECK ("channel" IN ('PRINT', 'EMAIL'));

ALTER TABLE "clinical_report_deliveries"
    ADD CONSTRAINT "clinical_report_deliveries_recipient_valido"
    CHECK ("recipient" IN ('PACIENTE', 'PROFESIONAL'));

-- Por email hace falta la dirección; en papel no la hay. Las dos mitades
-- trabajan: una entrega por email sin destinatario no se puede auditar, y
-- una impresión con un email dentro cuenta algo que no pasó.
ALTER TABLE "clinical_report_deliveries"
    ADD CONSTRAINT "clinical_report_deliveries_email_segun_canal"
    CHECK (
        ("channel" = 'EMAIL' AND "recipient_email" IS NOT NULL)
        OR ("channel" = 'PRINT' AND "recipient_email" IS NULL)
    );

CREATE INDEX "clinical_report_deliveries_cliente_idx"
    ON "clinical_report_deliveries"("tenant_id", "client_id", "at" DESC);

CREATE FUNCTION mipiacetpv_clinical_report_deliveries_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    RAISE EXCEPTION
        'HISTORIA_VIOLADA: clinical_report_deliveries es sólo inserciones (intento de % sobre la entrega %). Es la prueba de qué informe se entregó y a quién.',
        TG_OP, OLD.id
        USING ERRCODE = '23514';
END;
$fn$;

CREATE TRIGGER "clinical_report_deliveries_append_only"
    BEFORE UPDATE OR DELETE ON "clinical_report_deliveries"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_clinical_report_deliveries_append_only();
