-- enlaces-publicos · UNA SOLA PUERTA para todo lo que se abre sin cuenta.
--
-- Hoy hay un enlace público bien hecho —el test de la valoración de
-- clinica-2— y vienen cuatro más: leer un consentimiento antes de firmarlo,
-- «mi cita» para cambiar o anular, la encuesta post-visita y el formulario
-- del equipo. Si cada uno hace el suyo, cada uno elige sus cabeceras, sus
-- topes y su forma de caducar, y el que se equivoque expone datos.
--
-- Decisión S1 de `docs/clinica/solapes-clinica-agenda.md` (07-10, OK de
-- Matías): una tabla común, una sola puerta en el servidor, y los topes de
-- cada `purpose` declarados EN CÓDIGO.
--
-- ── Por qué `purpose` y `target_type` son TEXT y no enums ─────────────
--
-- Porque un `purpose` nuevo tiene que poder nacer en el bloque que lo
-- necesita, sin migración. Con un enum, cada uno de los cuatro que vienen
-- obligaría a un `ALTER TYPE ... ADD VALUE` — y clinica-1 y clinica-2 ya
-- pagaron dos veces la lección de que ese ALTER no puede ir en la misma
-- transacción que el código que lo usa («unsafe use of new value of enum
-- type»).
--
-- Lo que NO se pierde con TEXT: el valor de la columna no es la
-- autorización. La autorización es el registro tipado de
-- `apps/api/src/enlaces/reglas.ts`, y un `purpose` que no esté en el
-- registro resuelve a la MISMA 404 que un token inventado. Una fila con
-- `purpose = 'LO_QUE_SEA'` no abre nada: no hay reglas que la admitan.
--
-- Un CHECK con la lista de valores habría devuelto el problema del enum
-- (migración por `purpose`) sin devolver la garantía (la decide el
-- registro, no la columna).
--
-- ── Lo que SÍ garantiza el motor, y no la aplicación ─────────────────
--
--   1. **La columna sólo acepta una HUELLA.** `token_hash` tiene que ser
--      64 caracteres hex: un SHA-256. El token en claro es un base64url de
--      43 caracteres y NO cabe en esta columna. Es la diferencia con
--      `tickets.public_slug`, que se guarda en claro a propósito, y aquí
--      es un CHECK y no una convención porque lo que protege es el
--      formulario de salud de una persona.
--   2. **Los usos no pasan del tope** (CHECK) y **no bajan** (trigger).
--   3. **Un enlace revocado no se des-revoca** (trigger). Sin esto,
--      «recepción anuló este enlace» sería un UPDATE de distancia.
--   4. **La caducidad no se alarga** (trigger). Reenviar es una fila nueva
--      con la anterior revocada (decisión S1.5), no estirar la vieja: si
--      `expires_at` se pudiera mover, revivir un enlace caducado sería un
--      UPDATE.
--   5. **Un enlace no se borra** (trigger). Se revoca, y la revocación
--      queda escrita.
--   6. **Un solo enlace vivo por (`purpose`, objetivo)** (índice único
--      parcial). Es lo que convierte «reenviar revoca el anterior» en una
--      invariante: el INSERT del enlace nuevo falla si nadie revocó el
--      viejo.
--
-- ── Migración ADITIVA, con un backfill ───────────────────────────────
--
-- Crea una tabla, sus índices y su trigger, y **mueve los enlaces de
-- clinica-2** a la tabla común. Ni un DROP, ni un TRUNCATE, ni un DELETE.
--
-- Las columnas viejas de `clinical_assessments` (`link_token_hash`,
-- `link_expires_at`, `link_used_at`) **NO se borran en este bloque**: se
-- dejan de LEER —la puerta común es la única que resuelve un token— y se
-- siguen escribiendo mientras la guardia de regresión de clinica-2 las
-- mire. Se quitan en un bloque posterior, cuando esa guardia pase a
-- mirar `public_links`. Expand ahora, contract después; borrarlas en la
-- misma migración que las sustituye deja la vuelta atrás sin red.
--
-- En producción no hay ninguna clínica encendida (los quince tenants
-- tienen `clinical_records_enabled = false`), así que el backfill mueve
-- cero o unas pocas filas de prueba. La consulta que lo comprueba está en
-- el done del bloque.
--
-- ── El `down`, pensado ───────────────────────────────────────────────
--
-- Reversible por completo, y sin pérdida: lo que esta migración copia
-- sigue en `clinical_assessments`, que es justo la razón de no borrar las
-- columnas viejas todavía.
--
--   DROP TRIGGER "public_links_guard" ON "public_links";
--   DROP FUNCTION mipiacetpv_public_link_guard();
--   DROP TABLE "public_links";

-- ── 1 · la tabla ───────────────────────────────────────────────────────

CREATE TABLE "public_links" (
    "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id"  UUID NOT NULL,

    -- PARA QUÉ sirve. El nombre que el registro tipado de la aplicación
    -- busca; lo que decide topes, perfil y estado admitido son las reglas
    -- de ese registro, no esta columna (ver la cabecera).
    "purpose"    TEXT NOT NULL,

    -- A QUÉ APUNTA. Polimórfico y SIN FK a propósito: los objetivos son de
    -- tablas distintas (una valoración, una cita, un consentimiento) y una
    -- FK por tipo exigiría una columna por tipo —diez columnas nulas— o
    -- una tabla de enlaces por objetivo, que es exactamente lo que este
    -- bloque viene a quitar.
    --
    -- Lo que se pierde (que el objetivo exista lo garantice el motor) lo
    -- cubre la puerta: carga el objetivo con el `tenant_id` del enlace y,
    -- si no está, contesta la MISMA 404. Un enlace huérfano no abre nada.
    "target_type" TEXT NOT NULL,
    "target_id"   UUID NOT NULL,

    -- LA HUELLA DEL TOKEN, nunca el token. 64 hex, por CHECK.
    "token_hash" TEXT NOT NULL,

    -- CUÁNDO DEJA DE ABRIR. NOT NULL: un token sin caducidad es un token
    -- que no caduca, y el día que alguien olvidara la fecha el enlace
    -- viviría para siempre sin que nada lo dijera. Es el mismo criterio
    -- que el CHECK `clinical_assessments_enlace_caduca` de clinica-2,
    -- ahora sin la mitad opcional.
    "expires_at" TIMESTAMPTZ NOT NULL,

    -- CUÁNTAS VECES se puede gastar y cuántas se ha gastado. Van en la
    -- fila porque son estado; el número que las pone (1 para la
    -- valoración) lo declara el `purpose` en código.
    "max_uses"   INTEGER NOT NULL,
    "used_count" INTEGER NOT NULL DEFAULT 0,

    -- RECEPCIÓN LO ANULÓ. Un solo sitio para anular cualquier enlace, de
    -- cualquier purpose.
    "revoked_at" TIMESTAMPTZ,

    -- Quién lo creó. NULL cuando lo crea el sistema: el alta de una cita
    -- de primera valoración no la pide una persona, la pide el hecho de
    -- que se ha dado esa cita. Mismo criterio que
    -- `clinical_assessments.requested_by_user_id` con
    -- `source = APPOINTMENT`, y la razón es la misma: inventarse un autor
    -- sería escribir que alguien pidió algo que no pidió.
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "public_links_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    -- RESTRICT: quién creó un enlace es parte de lo que el registro puede
    -- contestar. Borrar a esa persona se niega, igual que en clinica-1.
    CONSTRAINT "public_links_created_by_user_id_fkey"
        FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,

    -- ESTA COLUMNA NO ADMITE UN TOKEN EN CLARO.
    --
    -- 64 caracteres hex es un SHA-256 y nada más. El token son 32 bytes en
    -- base64url (43 caracteres, con `-` y `_`): no pasa el CHECK. Es la
    -- garantía número uno del bloque puesta donde no se puede olvidar —
    -- «lo guardo en claro, que es más fácil de depurar» lo rechaza
    -- Postgres y no una revisión de código.
    CONSTRAINT "public_links_token_hash_es_sha256"
        CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),

    -- Un enlace que no se puede usar ni una vez no es un enlace.
    CONSTRAINT "public_links_max_uses_positivo"
        CHECK ("max_uses" >= 1),
    -- Y NO SE USA MÁS VECES DE SU TOPE. Declarativo, así que cubre también
    -- el INSERT: una fila no puede nacer gastada por encima del tope.
    CONSTRAINT "public_links_usos_dentro_del_tope"
        CHECK ("used_count" >= 0 AND "used_count" <= "max_uses"),

    -- Un `purpose` en blanco convierte «para qué sirve este enlace» en una
    -- pregunta sin respuesta. Mismo criterio que
    -- `clinical_assessment_corrections_question_not_blank`.
    CONSTRAINT "public_links_purpose_not_blank"
        CHECK (btrim("purpose") <> ''),
    CONSTRAINT "public_links_target_type_not_blank"
        CHECK (btrim("target_type") <> '')
);

-- ── 2 · los índices ────────────────────────────────────────────────────

-- LA BÚSQUEDA DE LA PUERTA, y es única: si dos filas compartieran huella,
-- resolver un token sería ambiguo y abriría el objeto equivocado.
CREATE UNIQUE INDEX "public_links_token_hash_key"
    ON "public_links"("token_hash");

-- UN SOLO ENLACE VIVO POR (`purpose`, objetivo).
--
-- De aquí sale, sin un solo `if`, la decisión S1.5 («reenviar rota el
-- token: fila nueva, la anterior revocada»): el INSERT del enlace nuevo
-- falla con 23505 si nadie revocó el anterior. Sin el índice, reenviar
-- dos veces dejaría dos enlaces vivos del mismo test y el primero
-- seguiría abriendo — que es justo lo que «rotar» promete que no pasa.
--
-- Parcial en los dos sentidos: un enlace revocado sale del índice (ya no
-- abre) y uno GASTADO también (`used_count >= max_uses`), así que ninguno
-- de los dos bloquea al siguiente. Un enlace CADUCADO sí sigue dentro, y
-- es deliberado: el camino que da un enlace nuevo tiene que revocar el
-- viejo explícitamente, y así se ve.
CREATE UNIQUE INDEX "public_links_uno_vivo_key"
    ON "public_links"("purpose", "target_id")
    WHERE "revoked_at" IS NULL AND "used_count" < "max_uses";

-- «Los enlaces de este objeto», que es lo que lee revocar al mover o
-- anular una cita, y lo que leerá la pantalla de recepción.
CREATE INDEX "public_links_target_type_target_id_idx"
    ON "public_links"("target_type", "target_id");
-- «Los enlaces de este negocio», lo más reciente primero.
CREATE INDEX "public_links_tenant_id_created_at_idx"
    ON "public_links"("tenant_id", "created_at" DESC);
-- Los caducados, para la limpieza que vendrá.
CREATE INDEX "public_links_expires_at_idx"
    ON "public_links"("expires_at");

-- ── 3 · la guarda ──────────────────────────────────────────────────────
--
-- Cinco reglas, y cada una cierra un camino por el que un enlace volvería
-- a abrir después de haber dejado de abrir:
--
--   1. NO SE BORRA. Se revoca, y la revocación queda escrita. Borrarlo
--      sería quitar la prueba de que existió.
--   2. La identidad no se reescribe: ni para qué sirve, ni a qué apunta,
--      ni su huella, ni su tope, ni CUÁNDO CADUCA. Mover `expires_at`
--      sería revivir un caducado con un UPDATE.
--   3. NO SE DES-REVOCA. «Recepción anuló este enlace» tiene que ser
--      definitivo.
--   4. Los usos sólo SUBEN y nunca pasan del tope. El CHECK ya impide el
--      segundo; el trigger añade el primero (un `used_count = 0` sobre un
--      enlace gastado es exactamente «dejarlo usar una vez más»).
--   5. Un enlace revocado no se gasta: si se pudiera, el contador de un
--      enlace anulado seguiría moviéndose y el registro mentiría.
--
-- El prefijo `ENLACE_VIOLADO` es lo que el error-handler reconoce para
-- contestar 409 con una frase de persona en vez de «Error de base de datos
-- (P2010)». Mismo mecanismo que `HISTORIA_VIOLADA` de clinica-1.
CREATE FUNCTION mipiacetpv_public_link_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'ENLACE_VIOLADO: un enlace público no se borra (enlace %). Se revoca, y la revocación queda escrita.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    -- 2 · la identidad, y la caducidad va dentro
    IF NEW.id          IS DISTINCT FROM OLD.id
       OR NEW.tenant_id   IS DISTINCT FROM OLD.tenant_id
       OR NEW.purpose     IS DISTINCT FROM OLD.purpose
       OR NEW.target_type IS DISTINCT FROM OLD.target_type
       OR NEW.target_id   IS DISTINCT FROM OLD.target_id
       OR NEW.token_hash  IS DISTINCT FROM OLD.token_hash
       OR NEW.max_uses    IS DISTINCT FROM OLD.max_uses
       OR NEW.expires_at  IS DISTINCT FROM OLD.expires_at
       OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
       OR NEW.created_at  IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION
            'ENLACE_VIOLADO: el enlace % no se reescribe en lo que lo identifica (para qué sirve, a qué apunta, su huella, su tope, cuándo caduca). Para dar otro enlace se revoca éste y se crea uno nuevo.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    -- 3 · no se des-revoca
    IF OLD.revoked_at IS NOT NULL
       AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
        RAISE EXCEPTION
            'ENLACE_VIOLADO: el enlace % está anulado y no se des-anula. Si hace falta uno, se crea uno nuevo.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    -- 4 · los usos sólo suben, y nunca pasan del tope
    IF NEW.used_count < OLD.used_count THEN
        RAISE EXCEPTION
            'ENLACE_VIOLADO: los usos del enlace % no bajan (% → %). Bajar el contador es dejarlo usar una vez más.',
            OLD.id, OLD.used_count, NEW.used_count USING ERRCODE = '23514';
    END IF;
    IF NEW.used_count > OLD.max_uses THEN
        RAISE EXCEPTION
            'ENLACE_VIOLADO: el enlace % ya se gastó sus % usos y no admite otro.',
            OLD.id, OLD.max_uses USING ERRCODE = '23514';
    END IF;

    -- 5 · un enlace anulado no se gasta
    IF OLD.revoked_at IS NOT NULL AND NEW.used_count > OLD.used_count THEN
        RAISE EXCEPTION
            'ENLACE_VIOLADO: el enlace % está anulado y no se puede usar.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$fn$;

CREATE TRIGGER "public_links_guard"
    BEFORE UPDATE OR DELETE ON "public_links"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_public_link_guard();

-- ── 4 · el backfill de clinica-2 ───────────────────────────────────────
--
-- Los enlaces del test de la valoración pasan a la tabla común. Uno por
-- valoración con huella: clinica-2 rotaba el token SOBRE la misma fila
-- (sobrescribía `link_token_hash`), así que no hay historia de tokens que
-- traer — hay el que está vivo.
--
-- Qué se mapea, y de dónde sale cada cosa:
--
--   · `purpose`     · 'VALORACION', el único que este bloque da de alta.
--   · `target_*`    · la VALORACIÓN, no la cita (precisión de clínica en
--                     el S1: mover o anular la cita no toca este enlace).
--   · `token_hash`  · la MISMA huella. El token en claro no existe en
--                     ningún sitio del que se pudiera recuperar, así que
--                     los enlaces que hay en algún buzón siguen abriendo
--                     después de la migración. Eso es el requisito.
--   · `expires_at`  · la misma fecha. El CHECK
--                     `clinical_assessments_enlace_caduca` garantiza que
--                     no es NULL cuando hay huella.
--   · `max_uses`    · 1. El enlace de la valoración es de un solo uso
--                     (clinica-2), y ese 1 lo declara el `purpose` en
--                     código; aquí se escribe el mismo número.
--   · `used_count`  · 1 si estaba sellado (`link_used_at`), 0 si no. Un
--                     enlace ya gastado tiene que seguir gastado.
--   · `revoked_at`  · NULL. clinica-2 no tenía revocación: rotaba.
--   · `created_by`  · quien pidió el test, y NULL cuando lo pidió la cita.
--
-- Idempotente por el único de `token_hash`: `ON CONFLICT DO NOTHING` deja
-- que la migración se pueda volver a correr sobre una base donde ya se
-- corrió (una copia, un entorno a medio migrar) sin reventar.
INSERT INTO "public_links" (
    "tenant_id", "purpose", "target_type", "target_id",
    "token_hash", "expires_at", "max_uses", "used_count",
    "revoked_at", "created_by_user_id", "created_at"
)
SELECT
    a."tenant_id",
    'VALORACION',
    'CLINICAL_ASSESSMENT',
    a."id",
    a."link_token_hash",
    a."link_expires_at",
    1,
    CASE WHEN a."link_used_at" IS NOT NULL THEN 1 ELSE 0 END,
    NULL,
    a."requested_by_user_id",
    a."created_at"
  FROM "clinical_assessments" a
 WHERE a."link_token_hash" IS NOT NULL
   AND a."link_expires_at" IS NOT NULL
ON CONFLICT ("token_hash") DO NOTHING;
