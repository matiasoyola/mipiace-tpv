-- clinica-2 · la valoración inicial. Lo que contestó el paciente no se
-- toca, y lo hace cumplir el motor.
--
-- «Nadie trata a un diabético anticoagulado sin saberlo.» El paciente
-- contesta un test de crónicas ANTES de su primera cita, el sanitario lo
-- revisa con él delante, marca tres confirmaciones y lo valida. Sin
-- valoración validada no se registra el primer tratamiento.
--
-- ── El reparto en tres sitios, que es el eje del bloque ───────────────
--
--   · `clinical_entries` (kind = INITIAL_ASSESSMENT) · **lo que contestó el
--     paciente**. Ya existe desde clinica-1 y ya es inmutable por trigger.
--     Aquí no se toca esa tabla: se usa.
--   · `clinical_assessments` · **el estado**, que sí cambia (pendiente →
--     respondida → validada), el canal, el token del enlace, las tres
--     confirmaciones y la firma.
--   · `clinical_assessment_corrections` · **lo que corrigió el sanitario**,
--     append-only, con autor y hora, AL LADO de lo del paciente.
--
-- Si todo viviera en una tabla habría que elegir: o es inmutable (y
-- entonces el estado no puede avanzar) o es mutable (y entonces las
-- respuestas del paciente son editables). Separarlo da las dos cosas sin
-- inventar un segundo mecanismo de inmutabilidad por columnas.
--
-- ── Las garantías, y quién las sostiene ───────────────────────────────
--
--   1. Lo contestado no se borra ni se edita → el trigger de
--      `clinical_entries`, ya puesto por clinica-1.
--   2. Una corrección no se edita ni se borra → trigger append-only.
--   3. Una valoración VALIDADA no se edita → trigger de guarda.
--   4. Validar exige las TRES confirmaciones y firma → CHECK.
--   5. El estado sólo avanza → trigger de guarda.
--   6. Un paciente no tiene dos valoraciones abiertas a la vez → índice
--      único PARCIAL. Y SÍ puede tener varias validadas: la valoración se
--      repasa creando una nueva (decisión de producto 7).
--   7. Lo que la valoración llama «sus respuestas» es una entrada de
--      historia de ESTE paciente y de kind INITIAL_ASSESSMENT → trigger.
--
-- Las 2, 3, 5 y 7 son triggers porque Postgres no las expresa de otra
-- forma; la 4 y la 6 son declarativas. Ninguna es un `if` de la
-- aplicación: la aplicación no es la única puerta a Postgres (ADR-015 §1).
--
-- ── Migración ADITIVA ─────────────────────────────────────────────────
--
-- Crea tipos, dos tablas, sus índices y sus triggers. Ni un DROP, ni un
-- TRUNCATE, ni un DELETE, ni un UPDATE. Las dos tablas nacen vacías y se
-- quedan vacías para siempre en los quince tenants de hoy, que tienen
-- `clinical_records_enabled = false`.
--
-- ── El `down`, pensado ────────────────────────────────────────────────
--
-- Reversible por completo MIENTRAS LAS TABLAS ESTÉN VACÍAS, que es el
-- único momento en que tiene sentido echarla atrás — con valoraciones
-- dentro, el `down` ES el borrado de historia clínica que esta migración
-- existe para impedir:
--
--   DROP TRIGGER "clinical_assessment_corrections_append_only"
--        ON "clinical_assessment_corrections";
--   DROP TRIGGER "clinical_assessment_corrections_sobre_respondida"
--        ON "clinical_assessment_corrections";
--   DROP TRIGGER "clinical_assessments_entry_kind" ON "clinical_assessments";
--   DROP TRIGGER "clinical_assessments_guard"      ON "clinical_assessments";
--   DROP FUNCTION mipiacetpv_clinical_corrections_append_only();
--   DROP FUNCTION mipiacetpv_clinical_corrections_sobre_respondida();
--   DROP FUNCTION mipiacetpv_clinical_assessment_entry_kind();
--   DROP FUNCTION mipiacetpv_clinical_assessment_guard();
--   DROP TABLE "clinical_assessment_corrections";
--   DROP TABLE "clinical_assessments";
--   DROP TYPE "ClinicalAnswer";
--   DROP TYPE "ClinicalAnsweredBy";
--   DROP TYPE "ClinicalAssessmentChannel";
--   DROP TYPE "ClinicalAssessmentSource";
--   DROP TYPE "ClinicalAssessmentStatus";
--
-- Lo que NO se deshace está en la cabecera de la migración hermana: el
-- valor 'INITIAL_ASSESSMENT' del enum no se quita en Postgres.
--
-- Probada sobre una COPIA de la base de desarrollo con filas reales
-- dentro, no en producción (ver §«Cómo se cierra» del done).

-- ── 0 · los tipos ──────────────────────────────────────────────────────

-- En qué punto está. El estado sólo avanza (trigger de guarda), así que el
-- orden en que se declaran los valores ES el orden del ciclo de vida y el
-- trigger lo usa comparando posiciones del enum.
CREATE TYPE "ClinicalAssessmentStatus" AS ENUM (
    'PENDIENTE_PACIENTE',
    'RESPONDIDA',
    'VALIDADA'
);

-- De dónde salió la valoración. MISMO vocabulario y misma forma que
-- `ClinicalAccessSource` de clinica-1, y por la misma razón:
--
--   APPOINTMENT · la creó el alta de una cita de un servicio marcado
--                 «primera valoración». **No la pide una persona: la pide
--                 el hecho de que se le ha dado esa cita.**
--   MANUAL      · la pidió alguien, con el botón «Enviar el test» de la
--                 ficha o abriendo la tablet. Y queda su nombre.
--
-- La distinción no es documental. El alta de una cita pasa por
-- `agenda/store.ts`, donde NO hay sesión de la que sacar un usuario — y
-- el motor de reservas (`engine.ts`) no se toca, así que no se le puede
-- pedir que lleve uno. Inventarse un autor ahí sería escribir en una
-- historia clínica que alguien pidió algo que no pidió.
CREATE TYPE "ClinicalAssessmentSource" AS ENUM ('APPOINTMENT', 'MANUAL');

-- Por dónde. Dos canales y no tres: WhatsApp y SMS están fuera de alcance
-- (no hay proveedor), y una columna con un valor que nadie puede escribir
-- es una promesa que el sistema no cumple.
CREATE TYPE "ClinicalAssessmentChannel" AS ENUM ('EMAIL', 'TABLET');

-- Quién tecleó. Decisión de producto: puede responder un familiar y queda
-- dicho quién. La pantalla del sanitario lo escribe en cada fila
-- («Respondió un familiar») porque una respuesta de segunda mano se lee
-- distinto delante del paciente.
CREATE TYPE "ClinicalAnsweredBy" AS ENUM ('PACIENTE', 'FAMILIAR');

-- Lo que puede contestar una persona. «No lo sé» ES una respuesta y está
-- siempre disponible (decisión de producto 4): un mayor que no sabe si
-- toma anticoagulantes tiene que poder decirlo en vez de adivinar. Y es
-- justo lo que la validación obliga a resolver antes de firmar.
CREATE TYPE "ClinicalAnswer" AS ENUM ('SI', 'NO', 'NO_SE');

-- ── 1 · la valoración ──────────────────────────────────────────────────

CREATE TABLE "clinical_assessments" (
    "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id"            UUID NOT NULL,
    "client_id"            UUID NOT NULL,
    -- La cita de primera valoración que la disparó, si la hubo.
    "appointment_id"       UUID,
    -- CON QUÉ VERSIÓN del cuestionario se contestó. Sin esto, una
    -- valoración de hace dos años se pintaría con las preguntas de hoy —
    -- que es decir que el paciente contestó algo que no se le preguntó. En
    -- un registro legal eso no es un detalle de interfaz.
    "questionnaire_version" INTEGER NOT NULL,
    "status"               "ClinicalAssessmentStatus" NOT NULL
                               DEFAULT 'PENDIENTE_PACIENTE',
    -- Mientras está pendiente: por dónde se le ha ofrecido (y puede
    -- cambiar, si se mandó el email y luego se le abrió la tablet). Una vez
    -- contestada: por dónde contestó, y ya no cambia.
    "channel"              "ClinicalAssessmentChannel" NOT NULL,
    "source"               "ClinicalAssessmentSource" NOT NULL,
    -- Quién mandó el test o abrió la tablet. **Puede ser la
    -- recepcionista**, que no lee las respuestas pero sí manda el test — y
    -- precisamente por eso queda escrito quién fue.
    --
    -- NULL cuando `source = APPOINTMENT`: ahí no lo pide nadie. El CHECK
    -- `clinical_assessments_source_pedida_por` ata las dos cosas, igual
    -- que `clinical_access_source_grantor` en clinica-1.
    "requested_by_user_id" UUID,
    "created_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- ── El enlace ──────────────────────────────────────────────────────
    --
    -- Se guarda el SHA-256 del token, NO el token. Es la diferencia con
    -- `tickets.public_slug`, que se guarda en claro, y la razón es el dato
    -- que protege: el slug de un ticket abre un PDF que su dueño ya tiene;
    -- este enlace abre el formulario de salud de una persona. Con el hash,
    -- una copia de la base no abre ningún enlace. El token en claro existe
    -- sólo en el email y en la URL que el paciente tiene abierta.
    "link_token_hash"      TEXT,
    "link_expires_at"      TIMESTAMPTZ,
    -- Y DE UN SOLO USO: al contestar se sella y el enlace deja de abrir.
    "link_used_at"         TIMESTAMPTZ,

    -- ── Lo que contestó el paciente, que vive en la historia ───────────
    "entry_id"             UUID,
    "answered_at"          TIMESTAMPTZ,
    "answered_by"          "ClinicalAnsweredBy",

    -- ── Las tres confirmaciones y la firma ────────────────────────────
    "confirmed_allergies"  BOOLEAN NOT NULL DEFAULT false,
    "confirmed_medication" BOOLEAN NOT NULL DEFAULT false,
    "confirmed_alerts"     BOOLEAN NOT NULL DEFAULT false,
    "validated_at"         TIMESTAMPTZ,
    "validated_by_user_id" UUID,

    CONSTRAINT "clinical_assessments_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "clinical_assessments_client_id_fkey"
        FOREIGN KEY ("client_id") REFERENCES "clients"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    -- SET NULL: si la cita desapareciera, la valoración sigue siendo parte
    -- de la historia. Pierde el enlace, no el contenido. El trigger de
    -- guarda deja pasar este cambio y sólo este (ver su cabecera).
    CONSTRAINT "clinical_assessments_appointment_id_fkey"
        FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    -- RESTRICT: la entrada con las respuestas tampoco se puede borrar por
    -- su cuenta (ya lo impedía su trigger; esto lo dice también la FK).
    CONSTRAINT "clinical_assessments_entry_id_fkey"
        FOREIGN KEY ("entry_id") REFERENCES "clinical_entries"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    -- RESTRICT en los dos autores: quién mandó el test y quién firmó la
    -- validación son parte del registro. Borrar a esa persona se niega.
    CONSTRAINT "clinical_assessments_requested_by_user_id_fkey"
        FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "clinical_assessments_validated_by_user_id_fkey"
        FOREIGN KEY ("validated_by_user_id") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,

    -- Una valoración sin responder no tiene respuestas, y una respondida
    -- las tiene. Sin este CHECK cabe el estado «RESPONDIDA y sin entrada»,
    -- que es una valoración que dice que el paciente contestó y no enseña
    -- nada — y la puerta del primer tratamiento lo dejaría pasar.
    CONSTRAINT "clinical_assessments_respuestas_segun_estado"
        CHECK (
            CASE WHEN "status" = 'PENDIENTE_PACIENTE'
                 THEN "entry_id" IS NULL
                  AND "answered_at" IS NULL
                  AND "answered_by" IS NULL
                 ELSE "entry_id" IS NOT NULL
                  AND "answered_at" IS NOT NULL
                  AND "answered_by" IS NOT NULL
            END
        ),

    -- VALIDAR ES FIRMAR, Y EXIGE LAS TRES CONFIRMACIONES.
    --
    -- Decisión de producto (Matías, 05-10): tres confirmaciones antes del
    -- primer tratamiento. Están aquí y no sólo en la aplicación porque son
    -- la razón de ser del bloque: una fila VALIDADA sin las tres marcadas
    -- es exactamente el estado desde el que la puerta del primer
    -- tratamiento diría «sí» sobre algo que nadie revisó.
    CONSTRAINT "clinical_assessments_validada_firmada"
        CHECK (
            "status" <> 'VALIDADA'
            OR (
                "validated_at" IS NOT NULL
                AND "validated_by_user_id" IS NOT NULL
                AND "confirmed_allergies"
                AND "confirmed_medication"
                AND "confirmed_alerts"
            )
        ),
    -- Y al revés: no se firma sin validar. Sin esta mitad cabría una
    -- valoración RESPONDIDA con fecha y autor de validación, que es una
    -- firma que no significa nada.
    CONSTRAINT "clinical_assessments_sin_validar_sin_firma"
        CHECK ("status" = 'VALIDADA' OR "validated_at" IS NULL),
    -- Si hay fecha, hay firma. Mismo criterio que la revocación de
    -- `clinical_access`.
    CONSTRAINT "clinical_assessments_firma_completa"
        CHECK (("validated_at" IS NULL) = ("validated_by_user_id" IS NULL)),
    -- No se valida antes de que el paciente conteste.
    CONSTRAINT "clinical_assessments_validada_despues"
        CHECK (
            "validated_at" IS NULL
            OR "answered_at" IS NULL
            OR "validated_at" >= "answered_at"
        ),
    -- UN TOKEN SIN CADUCIDAD ES UN TOKEN QUE NO CADUCA. El prompt pide que
    -- el enlace caduque; si la fecha fuera opcional, el día que alguien
    -- olvidara ponerla el enlace viviría para siempre y nada lo diría.
    CONSTRAINT "clinical_assessments_enlace_caduca"
        CHECK ("link_token_hash" IS NULL OR "link_expires_at" IS NOT NULL),
    -- El enlace sólo se «usa» para contestar: si está sellado, hay
    -- respuestas y hay token con el que se entró.
    CONSTRAINT "clinical_assessments_enlace_usado_para_responder"
        CHECK (
            "link_used_at" IS NULL
            OR ("answered_at" IS NOT NULL AND "link_token_hash" IS NOT NULL)
        ),
    -- La versión del cuestionario es un número de versión, no un hueco.
    CONSTRAINT "clinical_assessments_version_positiva"
        CHECK ("questionnaire_version" >= 1),
    -- Un test que mandó alguien lleva su nombre; uno que salió de una cita
    -- no lo lleva. Sin este CHECK, «lo mandó la recepcionista» y «lo mandó
    -- la cita» serían indistinguibles en cuanto alguien olvidara el campo
    -- — y entonces el registro no podría contestar quién.
    CONSTRAINT "clinical_assessments_source_pedida_por"
        CHECK (
            ("source" = 'MANUAL'      AND "requested_by_user_id" IS NOT NULL)
         OR ("source" = 'APPOINTMENT' AND "requested_by_user_id" IS NULL)
        )
);

-- UNA VALORACIÓN ABIERTA POR PACIENTE, garantizado POR LA BASE.
--
-- De aquí salen dos comportamientos sin un solo `if`:
--
--   · «Enviar el test» dos veces (o la recepcionista y la podóloga a la
--     vez, o el alta de dos citas de primera valoración) NO crea dos
--     valoraciones: la segunda reusa la abierta y le rota el token.
--   · Y SÍ se puede tener varias VALIDADAS: el índice es parcial, así que
--     una validada no bloquea la siguiente. Que es, literal, la decisión
--     de producto 7 — la valoración se repasa creando una nueva, sin
--     sobrescribir la anterior.
--
-- Sin `tenant_id` en la clave y es correcto: `client_id` es una FK a
-- `clients`, y un cliente pertenece a un solo tenant. Mismo criterio que
-- `clinical_access_one_live_key` de clinica-1.
CREATE UNIQUE INDEX "clinical_assessments_one_open_key"
    ON "clinical_assessments"("client_id")
    WHERE "status" <> 'VALIDADA';

-- El token del enlace es único: dos valoraciones no comparten enlace.
-- Único y no sólo indexado — si dos filas tuvieran el mismo hash, la
-- búsqueda por token sería ambigua y abriría la historia equivocada.
CREATE UNIQUE INDEX "clinical_assessments_link_token_hash_key"
    ON "clinical_assessments"("link_token_hash");

-- Una entrada de historia es de UNA valoración.
CREATE UNIQUE INDEX "clinical_assessments_entry_id_key"
    ON "clinical_assessments"("entry_id");

-- El orden de «las valoraciones de este paciente», lo más reciente
-- primero: es lo que lee la pantalla del sanitario y la puerta del primer
-- tratamiento.
CREATE INDEX "clinical_assessments_tenant_id_client_id_created_at_idx"
    ON "clinical_assessments"("tenant_id", "client_id", "created_at" DESC);
CREATE INDEX "clinical_assessments_appointment_id_idx"
    ON "clinical_assessments"("appointment_id");

-- ── 2 · las correcciones del sanitario ─────────────────────────────────
--
-- APPEND-ONLY. Lo que el sanitario corrige NO sobrescribe lo que contestó
-- el paciente: se añade al lado, con su autor y su hora. En pantalla se
-- ven las dos cosas a la vez (la del paciente en naranja, la corrección en
-- oscuro), y la razón no es estética:
--
--   · Si un paciente dijo «no tomo anticoagulantes» y resultó que sí, lo
--     que hay que poder demostrar es que lo dijo. Borrarlo convierte un
--     malentendido del paciente en un error de la clínica.
--   · Y una corrección sin autor es una respuesta que nadie firmó. En una
--     historia clínica eso no existe.
CREATE TABLE "clinical_assessment_corrections" (
    "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id"      UUID NOT NULL,
    "assessment_id"  UUID NOT NULL,
    -- El id de la pregunta del cuestionario (`diab`, `insul`, …). Texto y
    -- no FK: el cuestionario es dato del módulo (en código, versionado), no
    -- una tabla. El id es corto y ESTABLE a propósito — viaja dentro de la
    -- historia para siempre.
    "question_id"    TEXT NOT NULL,
    "value"          "ClinicalAnswer" NOT NULL,
    -- LA FIRMA.
    "author_user_id" UUID NOT NULL,
    "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "clinical_assessment_corrections_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "clinical_assessment_corrections_assessment_id_fkey"
        FOREIGN KEY ("assessment_id") REFERENCES "clinical_assessments"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "clinical_assessment_corrections_author_user_id_fkey"
        FOREIGN KEY ("author_user_id") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,

    -- Un id de pregunta en blanco convierte «esta corrección es de la
    -- pregunta X» en una comprobación que miente. Mismo criterio que
    -- `users_clinician_license_not_blank`.
    CONSTRAINT "clinical_assessment_corrections_question_not_blank"
        CHECK (btrim("question_id") <> '')
);

CREATE INDEX "clinical_assessment_corrections_assessment_id_created_at_idx"
    ON "clinical_assessment_corrections"("assessment_id", "created_at");
CREATE INDEX "clinical_assessment_corrections_tenant_id_idx"
    ON "clinical_assessment_corrections"("tenant_id");

-- ── 3 · los triggers ───────────────────────────────────────────────────

-- La guarda de la valoración.
--
-- Cuatro reglas, y cada una cierra un estado que la aplicación podría
-- alcanzar por descuido:
--
--   1. NO SE BORRA. Es historia clínica.
--   2. La identidad no se reescribe: ni de qué paciente es, ni con qué
--      versión se contestó, ni quién lo mandó, ni cuándo se creó.
--   3. EL ESTADO SÓLO AVANZA. Volver de VALIDADA a RESPONDIDA sería
--      des-validar: quitarle efecto a una firma sin que quede rastro.
--   4. Y una vez VALIDADA, la fila queda CONGELADA. Decisión de producto
--      7: una valoración validada no se edita, se repasa con una nueva.
--
-- La ÚNICA excepción, y es la del `ON DELETE SET NULL` de la cita:
-- `appointment_id` puede pasar a NULL. Sin esa rendija, borrar una cita
-- con valoración fallaría con un mensaje de trigger en vez de dejar la
-- valoración huérfana y entera, que es lo que la FK quiere. Sólo hacia
-- NULL: reasignar la valoración a otra cita sí sería reescribir historia.
CREATE FUNCTION mipiacetpv_clinical_assessment_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
    orden_old INT;
    orden_new INT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'HISTORIA_VIOLADA: una valoración inicial no se borra (valoración %). Se conserva; si algo cambia, se repasa con una valoración nueva.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    -- 2 · la identidad
    IF NEW.id                   IS DISTINCT FROM OLD.id
       OR NEW.tenant_id             IS DISTINCT FROM OLD.tenant_id
       OR NEW.client_id             IS DISTINCT FROM OLD.client_id
       OR NEW.questionnaire_version IS DISTINCT FROM OLD.questionnaire_version
       OR NEW.source                IS DISTINCT FROM OLD.source
       OR NEW.requested_by_user_id  IS DISTINCT FROM OLD.requested_by_user_id
       OR NEW.created_at            IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION
            'HISTORIA_VIOLADA: la valoración % no se edita en lo que la identifica (paciente, versión del cuestionario, quién la pidió, cuándo).',
            OLD.id USING ERRCODE = '23514';
    END IF;

    -- La rendija del SET NULL de la cita, y sólo hacia NULL.
    IF NEW.appointment_id IS DISTINCT FROM OLD.appointment_id
       AND NEW.appointment_id IS NOT NULL THEN
        RAISE EXCEPTION
            'HISTORIA_VIOLADA: la valoración % no se mueve de cita. Lo escrito queda donde se escribió.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    -- 4 · una vez validada, congelada. Va ANTES de la 3 porque es la más
    -- fuerte: si la fila ya está firmada, no hay cambio que discutir.
    IF OLD.status = 'VALIDADA' THEN
        RAISE EXCEPTION
            'HISTORIA_VIOLADA: la valoración % ya está validada y no se edita. Si algo ha cambiado, se repasa con una valoración nueva.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    -- 3 · el estado sólo avanza
    orden_old := array_position(
        ARRAY['PENDIENTE_PACIENTE', 'RESPONDIDA', 'VALIDADA'],
        OLD.status::TEXT
    );
    orden_new := array_position(
        ARRAY['PENDIENTE_PACIENTE', 'RESPONDIDA', 'VALIDADA'],
        NEW.status::TEXT
    );
    IF orden_new < orden_old THEN
        RAISE EXCEPTION
            'HISTORIA_VIOLADA: la valoración % no vuelve atrás (% → %). Des-validar o des-responder sería quitarle efecto a lo escrito sin dejar rastro.',
            OLD.id, OLD.status, NEW.status USING ERRCODE = '23514';
    END IF;

    -- Lo que el paciente contestó se escribe UNA vez. Las tres columnas
    -- van juntas porque son un solo hecho: contestó, con esto, así.
    IF OLD.answered_at IS NOT NULL
       AND (NEW.entry_id    IS DISTINCT FROM OLD.entry_id
            OR NEW.answered_at IS DISTINCT FROM OLD.answered_at
            OR NEW.answered_by IS DISTINCT FROM OLD.answered_by
            OR NEW.channel     IS DISTINCT FROM OLD.channel) THEN
        RAISE EXCEPTION
            'HISTORIA_VIOLADA: lo que el paciente contestó en la valoración % no se reescribe. Para corregirlo se añade una corrección con su autor.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    -- El enlace se sella UNA vez. Es lo que lo hace de un solo uso: sin
    -- esto, bastaría un UPDATE para revivir un enlace ya usado.
    IF OLD.link_used_at IS NOT NULL
       AND NEW.link_used_at IS DISTINCT FROM OLD.link_used_at THEN
        RAISE EXCEPTION
            'HISTORIA_VIOLADA: el enlace de la valoración % ya se usó y no se reabre. Para volver a preguntarle se le manda una valoración nueva.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$fn$;

CREATE TRIGGER "clinical_assessments_guard"
    BEFORE UPDATE OR DELETE ON "clinical_assessments"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_clinical_assessment_guard();

-- Lo que la valoración llama «sus respuestas» tiene que ser una entrada de
-- historia DE ESTE PACIENTE y de la clase que dice.
--
-- Es la comprobación que una FK no puede hacer: la FK garantiza que la
-- entrada existe, no que sea del paciente correcto ni que sea una
-- valoración. Sin esto, un `entry_id` equivocado haría que la pantalla
-- pintara las respuestas de otra persona como si fueran de ésta, y eso en
-- una historia clínica no es un bug de interfaz.
CREATE FUNCTION mipiacetpv_clinical_assessment_entry_kind() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
    e RECORD;
BEGIN
    IF NEW.entry_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT "tenant_id", "client_id", "kind" INTO e
      FROM "clinical_entries" WHERE "id" = NEW.entry_id;
    IF e.kind <> 'INITIAL_ASSESSMENT' THEN
        RAISE EXCEPTION
            'HISTORIA_VIOLADA: la entrada % no es una valoración inicial (es %), así que la valoración % no puede decir que son sus respuestas.',
            NEW.entry_id, e.kind, NEW.id USING ERRCODE = '23514';
    END IF;
    IF e.client_id <> NEW.client_id OR e.tenant_id <> NEW.tenant_id THEN
        RAISE EXCEPTION
            'HISTORIA_VIOLADA: la entrada % es de otro paciente y no puede ser la respuesta de la valoración %.',
            NEW.entry_id, NEW.id USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$fn$;

CREATE TRIGGER "clinical_assessments_entry_kind"
    BEFORE INSERT OR UPDATE ON "clinical_assessments"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_clinical_assessment_entry_kind();

-- Las correcciones son SÓLO INSERCIONES.
--
-- Sin la escapatoria «el padre ya no existe» que llevan los triggers de S1
-- y de F1, por la misma razón que el registro de accesos de clinica-1: la
-- FK a `clinical_assessments` es RESTRICT, así que la cascada que esa
-- escapatoria cubría no puede ocurrir.
CREATE FUNCTION mipiacetpv_clinical_corrections_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'HISTORIA_VIOLADA: una corrección de la valoración no se borra (corrección %). Queda con su autor y su hora.',
            OLD.id USING ERRCODE = '23514';
    END IF;
    RAISE EXCEPTION
        'HISTORIA_VIOLADA: una corrección de la valoración no se edita (corrección %). Para cambiarla se añade otra corrección, y manda la última.',
        OLD.id USING ERRCODE = '23514';
END;
$fn$;

CREATE TRIGGER "clinical_assessment_corrections_append_only"
    BEFORE UPDATE OR DELETE ON "clinical_assessment_corrections"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_clinical_corrections_append_only();

-- Y no se corrige lo que nadie contestó, ni lo que ya está firmado.
--
-- Las dos mitades importan por motivos distintos:
--
--   · Una corrección sobre una valoración PENDIENTE sería una respuesta
--     puesta por la clínica en nombre del paciente. El paciente contesta;
--     el sanitario corrige lo contestado.
--   · Una corrección sobre una valoración VALIDADA cambiaría las alertas
--     de algo que alguien ya firmó. La fila de la valoración está
--     congelada por su guarda, y sin este trigger la lista de correcciones
--     —que es la que decide qué vale hoy— seguiría siendo editable: la
--     firma protegería la cáscara y no el contenido.
CREATE FUNCTION mipiacetpv_clinical_corrections_sobre_respondida()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
    v RECORD;
BEGIN
    SELECT "status", "tenant_id" INTO v
      FROM "clinical_assessments" WHERE "id" = NEW.assessment_id;
    IF v.status = 'PENDIENTE_PACIENTE' THEN
        RAISE EXCEPTION
            'HISTORIA_VIOLADA: la valoración % todavía no la ha contestado el paciente, así que no hay nada que corregir.',
            NEW.assessment_id USING ERRCODE = '23514';
    END IF;
    IF v.status = 'VALIDADA' THEN
        RAISE EXCEPTION
            'HISTORIA_VIOLADA: la valoración % ya está validada y no se corrige. Si algo ha cambiado, se repasa con una valoración nueva.',
            NEW.assessment_id USING ERRCODE = '23514';
    END IF;
    IF v.tenant_id <> NEW.tenant_id THEN
        RAISE EXCEPTION
            'HISTORIA_VIOLADA: la corrección y la valoración % no son del mismo negocio.',
            NEW.assessment_id USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$fn$;

CREATE TRIGGER "clinical_assessment_corrections_sobre_respondida"
    BEFORE INSERT ON "clinical_assessment_corrections"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_clinical_corrections_sobre_respondida();
