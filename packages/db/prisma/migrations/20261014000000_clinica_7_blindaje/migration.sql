-- clinica-7 · EL BLINDAJE. Que una copia filtrada no se lea.
--
-- Tres cosas nuevas en el motor, y las tres están aquí y no en la
-- aplicación por la razón de clinica-1 y de `s1_sello_de_la_venta`: **la
-- aplicación no es la única puerta a Postgres.**
--
--   1. **El contrato de encargado se acepta y queda escrito.**
--      `clinical_processor_agreements`, de SOLO INSERCIÓN: aceptar es una
--      fila, revocar es otra fila que apunta a la que revoca. Ni UPDATE ni
--      DELETE, desde la aplicación ni desde psql.
--   2. **Cada clínica tiene su clave.** `clinical_tenant_keys` guarda la
--      DEK de cada tenant **envuelta** con la KEK del entorno, y un
--      canario cifrado con ella. Borrar la DEK de una clínica deja
--      ilegibles sus datos **en todas las copias de seguridad pasadas** —
--      es la única forma real de destruir al terminar el contrato.
--   3. **El texto clínico se guarda cifrado.** Una columna nueva por cada
--      columna que pueda llevar datos de salud, con un CHECK que **solo
--      admite ciphertext**: `c1:` y base64. Un `UPDATE` que meta texto en
--      claro en una de ellas lo rechaza el motor.
--
-- SQL a mano porque Prisma no expresa triggers, funciones ni CHECKs.
-- Mismo patrón que las seis migraciones clínicas anteriores.
--
-- ── UNA sola migración ────────────────────────────────────────────────
--
-- No se añade ningún valor a ningún enum (lo que obligó a dos migraciones
-- a clinica-1, -2 y -3). Los campos de lista cerrada son `VARCHAR` con
-- CHECK, como decidió `iva_exento_sanitario`.
--
-- ── EXPAND → MIGRAR → CONTRACT, y aquí solo está el EXPAND ───────────
--
-- Las columnas en claro **NO SE BORRAN EN ESTA MIGRACIÓN**. Lo que hace
-- esta migración es añadir la columna cifrada al lado y dejar que el motor
-- permita exactamente una transición: poner el cifrado donde no lo había
-- y vaciar el claro después. El `contract` —borrar las columnas en claro—
-- es una migración posterior, dicha en el `-done`, y solo se escribe
-- cuando el script de cifrado haya corrido y verificado en producción.
--
-- Al revés —borrar el claro en la misma migración que lo cifra— deja la
-- vuelta atrás sin red: si el cifrado tuviera un fallo, la historia
-- clínica de una clínica entera sería ilegible y no habría de dónde
-- sacarla. Es el mismo criterio con el que `enlaces-publicos` dejó vivas
-- las tres columnas obsoletas de `clinical_assessments`.
--
-- ── Qué NO es aditivo ─────────────────────────────────────────────────
--
-- Dos cosas, y las dos se afinan en vez de aflojarse:
--
--   · `clinical_assessment_corrections.value` pasa a admitir NULL. Es la
--     única forma de VACIAR el claro de una corrección: `value` es un enum
--     y no tiene valor neutro, así que un centinela sería una respuesta
--     clínica falsa dentro de la historia. Lo que sostiene la columna es un
--     CHECK nuevo: **una corrección dice algo, en claro o cifrado**. Más
--     fuerte que el `NOT NULL` que sustituye, que no impedía una fila con
--     `question_id = ''`.
--   · Las tres funciones de trigger de clinica-1 y clinica-4 se
--     **reemplazan** por versiones que dejan pasar el cifrado y NADA más.
--     No se desactiva ningún trigger: el script de cifrado corre con las
--     garantías puestas, y un script con un fallo que intentara reescribir
--     un cuerpo lo rechaza el motor igual que lo rechazaría una ruta.
--
-- ── El `down`, pensado ────────────────────────────────────────────────
--
-- Reversible del todo mientras no haya corrido el script de cifrado.
-- Después NO: las columnas en claro estarán vacías y el `down` sería el
-- borrado de la historia clínica que esta migración existe para impedir.
-- Y hay una pieza que el `down` NO puede devolver: las DEK. Borrar
-- `clinical_tenant_keys` es crypto-shredding — irreversible por
-- construcción.
--
--   DROP TRIGGER "clinical_tenant_keys_guard" ON "clinical_tenant_keys";
--   DROP TRIGGER "clinical_processor_agreements_append_only"
--       ON "clinical_processor_agreements";
--   DROP FUNCTION mipiacetpv_clinical_tenant_keys_guard();
--   DROP FUNCTION mipiacetpv_clinical_processor_agreements_append_only();
--   DROP TABLE "clinical_tenant_keys";
--   DROP TABLE "clinical_processor_agreements";
--   ALTER TABLE "clinical_entries"   DROP COLUMN "body_cifrado";
--   ALTER TABLE "clinical_addenda"   DROP COLUMN "body_cifrado";
--   ALTER TABLE "clinical_photos"    DROP COLUMN "zona_cifrada",
--                                    DROP COLUMN "withdraw_reason_cifrado";
--   ALTER TABLE "client_consents"    DROP COLUMN "revoke_reason_cifrado";
--   -- y el CHECK de la retirada, a su forma de clinica-4:
--   ALTER TABLE "clinical_photos"
--       DROP CONSTRAINT "clinical_photos_retirada_completa",
--       ADD CONSTRAINT "clinical_photos_retirada_completa" CHECK (
--           ("withdrawn_at" IS NULL AND "withdrawn_by_user_id" IS NULL
--               AND "withdraw_reason" IS NULL)
--           OR ("withdrawn_at" IS NOT NULL AND "withdrawn_by_user_id" IS NOT NULL
--               AND "withdraw_reason" IS NOT NULL));
--   ALTER TABLE "clinical_assessment_corrections"
--       DROP CONSTRAINT "clinical_assessment_corrections_question_not_blank",
--       ADD CONSTRAINT "clinical_assessment_corrections_question_not_blank"
--           CHECK (btrim("question_id") <> ''),
--       DROP CONSTRAINT "clinical_assessment_corrections_dice_algo",
--       DROP COLUMN "correccion_cifrada",
--       ALTER COLUMN "value" SET NOT NULL;
--   ALTER TABLE "appointments"           DROP COLUMN "notes_cifradas";
--   ALTER TABLE "clients"                DROP COLUMN "notes_cifradas";
--   ALTER TABLE "client_technical_notes" DROP COLUMN "body_cifrado";
--   -- y las funciones de trigger, a su forma de clinica-1 / clinica-4
--   -- (el SQL literal está en sus migraciones).

-- ──────────────────────────────────────────────────────────────────────
-- 1 · EL CONTRATO DE ENCARGADO. Aceptar es una fila; revocar, otra.
-- ──────────────────────────────────────────────────────────────────────
--
-- Decisión 3 del prompt: tabla nueva, **solo de inserción**, con tenant,
-- versión, huella del texto, usuario, fecha, dispositivo, IP y user-agent.
-- Revocar **no es un UPDATE**: es una fila nueva que apunta a la
-- aceptación que revoca. Es el mecanismo de `client_consents` de
-- clinica-4, y existe por lo mismo — una aceptación editable no demuestra
-- nada sobre qué se aceptó.
CREATE TABLE "clinical_processor_agreements" (
    "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"  UUID NOT NULL,

    -- La versión del contrato (`@mipiacetpv/contrato-encargado`) y la
    -- HUELLA de su texto canónico. No se guarda el texto: el paquete
    -- versionado lo tiene, y la huella es lo que demuestra que es EL
    -- MISMO. Si un día el texto de una versión publicada cambiara, estas
    -- filas lo dirían.
    --
    -- La revocación COPIA versión y huella de la fila que revoca, igual
    -- que la revocación de un consentimiento en clinica-4: es lo que hace
    -- que la lista se lea («v1 · revocado el 14 de octubre») sin cruzar
    -- dos filas para pintar una.
    "version"     INTEGER NOT NULL,
    "text_sha256" CHAR(64) NOT NULL,

    -- QUIÉN. NOT NULL y RESTRICT: una aceptación anónima de un contrato
    -- de encargado no existe. Que ADEMÁS sea la dueña (OWNER) lo exige la
    -- API, porque cruza el rol del usuario con el tenant y no cabe en un
    -- CHECK.
    "user_id"    UUID NOT NULL,
    "at"         TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- DESDE DÓNDE. Los tres son prueba de quién estaba delante del
    -- aparato, y los tres pueden faltar (el panel no tiene device; detrás
    -- de un proxy mal configurado puede no haber IP).
    --
    -- `device_id` es RESTRICT y no SET NULL **a propósito**: esta tabla no
    -- se puede reescribir, así que un `SET NULL` sería una promesa que el
    -- trigger rechazaría al ejecutarse. Un aparato con aceptaciones no se
    -- borra — se revoca, que es lo que el producto hace con los aparatos.
    "device_id"  UUID,
    "ip"         VARCHAR(45),
    "user_agent" VARCHAR(300),

    -- La fila que esta revoca. Una fila con esto puesto NO ACEPTA NADA:
    -- es la revocación. `null` = es una aceptación.
    "revokes_agreement_id" UUID,

    CONSTRAINT "clinical_processor_agreements_pkey" PRIMARY KEY ("id"),

    CONSTRAINT "clinical_processor_agreements_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "clinical_processor_agreements_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "clinical_processor_agreements_device_id_fkey"
        FOREIGN KEY ("device_id") REFERENCES "devices"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "clinical_processor_agreements_revokes_fkey"
        FOREIGN KEY ("revokes_agreement_id")
        REFERENCES "clinical_processor_agreements"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,

    -- Una versión publicada empieza en 1.
    CONSTRAINT "clinical_processor_agreements_version_positiva"
        CHECK ("version" >= 1),
    -- 64 hex y nada más. El texto del contrato (miles de caracteres) NO
    -- CABE en esta columna: la huella es una huella.
    CONSTRAINT "clinical_processor_agreements_sha256"
        CHECK ("text_sha256" ~ '^[0-9a-f]{64}$'),
    -- Una fila no se revoca a sí misma.
    CONSTRAINT "clinical_processor_agreements_revoca_distinta"
        CHECK ("revokes_agreement_id" IS NULL OR "revokes_agreement_id" <> "id")
);

-- «El contrato de este negocio, en orden»: es la consulta de la sección
-- del panel y la que alimenta la función de estado en cada petición
-- clínica. `at DESC` porque lo que se pinta primero es lo último que pasó.
CREATE INDEX "clinical_processor_agreements_tenant_idx"
    ON "clinical_processor_agreements"("tenant_id", "at" DESC);

-- «¿Esta aceptación está revocada?» sin recorrer la tabla. Parcial: solo
-- las revocaciones tienen la columna puesta, y son las pocas.
CREATE INDEX "clinical_processor_agreements_revoca_idx"
    ON "clinical_processor_agreements"("revokes_agreement_id")
    WHERE "revokes_agreement_id" IS NOT NULL;

-- SOLO INSERCIÓN. Ni UPDATE ni DELETE, ni desde la aplicación ni desde
-- psql. Mismo trato que `client_consents` y `clinical_access_log`, y por
-- lo mismo: la fila es la prueba de que alguien aceptó un texto concreto
-- un día concreto. Una prueba editable no es una prueba.
CREATE FUNCTION mipiacetpv_clinical_processor_agreements_append_only()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'CONTRATO_VIOLADO: una aceptación del contrato de tratamiento no se borra (clinical_processor_agreements.%). Para retirarla se inserta una revocación, que también queda escrita.',
            OLD.id USING ERRCODE = '23514';
    END IF;
    RAISE EXCEPTION
        'CONTRATO_VIOLADO: una aceptación del contrato de tratamiento no se edita (clinical_processor_agreements.%). Dice qué texto aceptó quién y cuándo; para cambiarlo se revoca y se acepta la versión nueva.',
        OLD.id USING ERRCODE = '23514';
END;
$fn$;

CREATE TRIGGER "clinical_processor_agreements_append_only"
    BEFORE UPDATE OR DELETE ON "clinical_processor_agreements"
    FOR EACH ROW
    EXECUTE FUNCTION mipiacetpv_clinical_processor_agreements_append_only();

-- ──────────────────────────────────────────────────────────────────────
-- 2 · LAS CLAVES. Una DEK por clínica, envuelta con la KEK del entorno.
-- ──────────────────────────────────────────────────────────────────────
--
-- Decisión 14, y es la decisión de fondo del bloque entero:
--
--   · Cada tenant clínico tiene su **DEK** aleatoria de 32 bytes. Con ella
--     se cifra todo su texto clínico y todos sus ficheros.
--   · La DEK **no está nunca en claro en la base**: se guarda envuelta
--     (cifrada) con la **KEK**, que vive en una variable de entorno
--     (`CLINICAL_KEK`) y nunca en la base ni en el repo.
--   · **Por qué así y no una sola clave**: borrar la DEK de una clínica
--     deja ilegibles sus datos en TODAS las copias de seguridad pasadas,
--     también las de hace meses. Es la única forma real de «destruir» al
--     terminar el contrato (art. 28.3.g) — un `DELETE` no llega a las
--     copias, y las copias son justo donde la historia sigue viva.
--
-- Una fila por tenant: la DEK es de la clínica, no de la tabla ni de la
-- columna. El AAD (`tenant|tabla|columna|fila`) es lo que impide mover un
-- valor cifrado de un sitio a otro dentro de la misma clínica.
CREATE TABLE "clinical_tenant_keys" (
    "tenant_id" UUID NOT NULL,

    -- QUÉ KEK la envuelve. Con id porque la KEK rota: re-envolver las DEK
    -- con una KEK nueva es un script del repo, y mientras la rotación
    -- corre conviven filas de las dos. Sin el id habría que probar las
    -- dos a ciegas, y «probar claves» es justo lo que no se hace con
    -- claves.
    "kek_id"      VARCHAR(40) NOT NULL,
    -- LA DEK, ENVUELTA. Formato `v1:` de `crypto.ts` con AAD
    -- `tenant|kek`, así que una DEK envuelta no se puede mover a otro
    -- tenant. `NULL` = destruida (crypto-shredding).
    "dek_wrapped" TEXT,

    -- EL CANARIO. Un texto conocido cifrado con ESTA DEK y su AAD. Al
    -- arrancar, la API lo descifra: si no cuadra, la KEK no es la que
    -- envolvió estas DEK y **la API no arranca** (decisión 17). Fallar al
    -- arrancar es mejor que escribir algo que no se puede leer.
    "canary"      TEXT,

    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Cuándo se re-envolvió por última vez. La DEK no cambia al rotar la
    -- KEK: lo que cambia es con qué está envuelta, y por eso las filas no
    -- se re-cifran (decisión 16).
    "rewrapped_at" TIMESTAMPTZ,
    -- CUÁNDO SE DESTRUYÓ. La fila se queda con la clave borrada en vez de
    -- desaparecer, y eso es deliberado: así el sistema puede decir «los
    -- datos de esta clínica se destruyeron el 3 de marzo» en lugar de
    -- parecer una clave que falta por un fallo. Un hueco no es una
    -- respuesta cuando la pregunta la hace un abogado.
    "destroyed_at" TIMESTAMPTZ,
    "destroyed_reason" VARCHAR(200),

    CONSTRAINT "clinical_tenant_keys_pkey" PRIMARY KEY ("tenant_id"),
    CONSTRAINT "clinical_tenant_keys_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,

    -- La clave envuelta lleva el prefijo de formato de `crypto.ts`. El
    -- CHECK es lo que impide que una DEK EN CLARO acabe en esta columna
    -- por un fallo de un script: 32 bytes en base64 no empiezan por `v1:`.
    CONSTRAINT "clinical_tenant_keys_envuelta"
        CHECK ("dek_wrapped" IS NULL OR "dek_wrapped" ~ '^v[0-9]+:'),
    -- El canario es ciphertext clínico, con el mismo formato que todo lo
    -- demás.
    CONSTRAINT "clinical_tenant_keys_canario"
        CHECK ("canary" IS NULL OR "canary" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$'),
    -- Destruida es destruida: sin clave y sin canario, con fecha. Las tres
    -- cosas juntas o ninguna — media destrucción (la fecha puesta y la
    -- clave todavía ahí) sería un sistema diciendo que destruyó algo que
    -- no destruyó.
    CONSTRAINT "clinical_tenant_keys_destruida_entera"
        CHECK (
            ("destroyed_at" IS NULL AND "dek_wrapped" IS NOT NULL
                                    AND "canary" IS NOT NULL)
            OR
            ("destroyed_at" IS NOT NULL AND "dek_wrapped" IS NULL
                                        AND "canary" IS NULL)
        )
);

-- «Qué DEK están envueltas con la KEK vieja»: la consulta del script de
-- rotación.
CREATE INDEX "clinical_tenant_keys_kek_idx"
    ON "clinical_tenant_keys"("kek_id");

-- LA CLAVE NO SE BORRA Y NO SE REESCRIBE: se RE-ENVUELVE o se DESTRUYE.
--
-- Mismo patrón que `clinical_photos_guard`: la fila es inmutable salvo dos
-- transiciones, y ninguna de las dos se deshace.
--
--   · **Re-envolver** (rotación de KEK): cambia `kek_id`, `dek_wrapped` y
--     `rewrapped_at`. El canario NO cambia, porque la DEK no cambia — y
--     eso es lo que hace que las filas no haya que re-cifrarlas. Si el
--     canario cambiara, la DEK sería otra y la historia de esa clínica
--     habría quedado ilegible.
--   · **Destruir**: `dek_wrapped` y `canary` a NULL con `destroyed_at`.
--     Irreversible por construcción — no hay nada que devolver.
--
-- Y el `DELETE` se prohíbe por una razón que no es la de las otras tablas:
-- borrar la fila **también** destruye los datos, pero en silencio y sin
-- fecha. La destrucción tiene que dejar dicho cuándo se hizo.
CREATE FUNCTION mipiacetpv_clinical_tenant_keys_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'CLAVE_VIOLADA: la clave de una clínica no se borra con un DELETE (clinical_tenant_keys.%). Destruirla es ponerla a NULL con su fecha, y así queda dicho cuándo se destruyó.',
            OLD.tenant_id USING ERRCODE = '23514';
    END IF;

    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION
            'CLAVE_VIOLADA: la clave de la clínica % no cambia de dueño ni de fecha de nacimiento.',
            OLD.tenant_id USING ERRCODE = '23514';
    END IF;

    -- Una clave destruida no vuelve.
    IF OLD.destroyed_at IS NOT NULL THEN
        RAISE EXCEPTION
            'CLAVE_VIOLADA: la clave de la clínica % se destruyó el % y eso no se deshace. Sus datos son ilegibles, también en las copias de seguridad.',
            OLD.tenant_id, OLD.destroyed_at USING ERRCODE = '23514';
    END IF;

    -- Destruir: la clave y el canario fuera, con fecha.
    IF NEW.destroyed_at IS NOT NULL THEN
        IF NEW.dek_wrapped IS NOT NULL OR NEW.canary IS NOT NULL THEN
            RAISE EXCEPTION
                'CLAVE_VIOLADA: destruir la clave de la clínica % es borrar la clave Y el canario. Media destrucción diría que se destruyó algo que sigue ahí.',
                OLD.tenant_id USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    -- Re-envolver: EL CANARIO NO CAMBIA. Si cambiara, la DEK sería otra y
    -- lo escrito con la anterior quedaría ilegible.
    IF NEW.canary IS DISTINCT FROM OLD.canary THEN
        RAISE EXCEPTION
            'CLAVE_VIOLADA: re-envolver la clave de la clínica % no cambia el canario. La DEK es la misma; lo que cambia es con qué está envuelta.',
            OLD.tenant_id USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$fn$;

CREATE TRIGGER "clinical_tenant_keys_guard"
    BEFORE UPDATE OR DELETE ON "clinical_tenant_keys"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_clinical_tenant_keys_guard();

-- ──────────────────────────────────────────────────────────────────────
-- 3 · LAS COLUMNAS CIFRADAS. Expand: la cifrada al lado de la clara.
-- ──────────────────────────────────────────────────────────────────────
--
-- El inventario completo, con la decisión de cada columna, está en
-- `docs/blocks/clinica-7-done.md`. Aquí van las nueve que se cifran, y
-- cada una con su CHECK de formato — que es la pieza que convierte «la
-- aplicación cifra» en «la base solo admite cifrado»:
--
--     CHECK (col IS NULL OR col ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$')
--
-- Un `UPDATE` desde psql que metiera «diabetes tipo 2» en una de estas
-- columnas lo rechaza el motor. Es el mismo movimiento que
-- `public_links_token_hash_es_sha256` de `enlaces-publicos`: el formato en
-- el motor, para que el valor equivocado no quepa.

-- El cuerpo de una entrada de historia y de una anotación. Son JSONB en
-- claro y TEXT cifrados: lo que se cifra es el JSON serializado, y la
-- estructura vuelve al descifrar. Cifrar campo a campo dentro del JSON
-- habría dejado las CLAVES del objeto en claro, y «alergias» como clave es
-- un dato de salud.
ALTER TABLE "clinical_entries"
    ADD COLUMN "body_cifrado" TEXT,
    ADD CONSTRAINT "clinical_entries_body_cifrado_formato"
        CHECK ("body_cifrado" IS NULL
               OR "body_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

ALTER TABLE "clinical_addenda"
    ADD COLUMN "body_cifrado" TEXT,
    ADD CONSTRAINT "clinical_addenda_body_cifrado_formato"
        CHECK ("body_cifrado" IS NULL
               OR "body_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

-- La zona de una foto («L:h» = dedo gordo del pie izquierdo) y el motivo
-- de su retirada. La zona dice DÓNDE tiene el problema el paciente, y eso
-- es un dato de salud aunque quepa en cuatro caracteres.
--
-- Se puede cifrar sin romper nada porque el comparador ya agrupa por zona
-- EN MEMORIA (`comparadorDeZonas`): ninguna consulta filtra por zona en
-- SQL. `mapa_version` se queda en claro — es el número de versión del mapa
-- del pie, no dice de qué paciente ni de qué zona.
ALTER TABLE "clinical_photos"
    ADD COLUMN "zona_cifrada" TEXT,
    ADD COLUMN "withdraw_reason_cifrado" TEXT,
    ADD CONSTRAINT "clinical_photos_zona_cifrada_formato"
        CHECK ("zona_cifrada" IS NULL
               OR "zona_cifrada" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$'),
    ADD CONSTRAINT "clinical_photos_withdraw_reason_cifrado_formato"
        CHECK ("withdraw_reason_cifrado" IS NULL
               OR "withdraw_reason_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

-- Y el CHECK de la retirada, afinado: **una foto retirada lleva motivo, en
-- claro o cifrado.** Antes exigía el motivo EN CLARO, así que una retirada
-- nueva —que ya nace cifrada— no cabía. Lo encontró la comprobación a mano
-- de las garantías del motor, antes de escribir una línea de API: el
-- trigger dejaba pasar la retirada y el CHECK la paraba.
--
-- Es la misma forma que `clinical_assessment_corrections_dice_algo`: la
-- fila dice algo, y da igual en cuál de las dos columnas lo diga.
ALTER TABLE "clinical_photos"
    DROP CONSTRAINT "clinical_photos_retirada_completa";

ALTER TABLE "clinical_photos"
    ADD CONSTRAINT "clinical_photos_retirada_completa"
        CHECK (
            ("withdrawn_at" IS NULL AND "withdrawn_by_user_id" IS NULL
                AND "withdraw_reason" IS NULL
                AND "withdraw_reason_cifrado" IS NULL)
            OR
            ("withdrawn_at" IS NOT NULL AND "withdrawn_by_user_id" IS NOT NULL
                AND ("withdraw_reason" IS NOT NULL
                     OR "withdraw_reason_cifrado" IS NOT NULL))
        );

-- El motivo de revocar un consentimiento. Se cifra **siempre**, no solo
-- cuando `clinical = true`: la columna es la misma para el spa y para la
-- clínica, y un `if` por fila sería un sitio donde equivocarse. Lo que
-- cuesta cifrar el motivo de una revocación de micropigmentación es nada.
ALTER TABLE "client_consents"
    ADD COLUMN "revoke_reason_cifrado" TEXT,
    ADD CONSTRAINT "client_consents_revoke_reason_cifrado_formato"
        CHECK ("revoke_reason_cifrado" IS NULL
               OR "revoke_reason_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

-- LA CORRECCIÓN DEL SANITARIO, entera. `question_id` + `value` juntos son
-- una respuesta clínica («diab = SI»), así que se cifran como un solo
-- valor: `{"preguntaId":"diab","valor":"SI"}`. Separados, `question_id` en
-- claro ya diría de qué está hablando la fila.
--
-- Se puede porque las correcciones **se leen todas juntas** y se ordenan
-- por `created_at` (`cargarCorrecciones`): ninguna consulta filtra por
-- `question_id`.
ALTER TABLE "clinical_assessment_corrections"
    ADD COLUMN "correccion_cifrada" TEXT,
    ADD CONSTRAINT "clinical_assessment_corrections_cifrada_formato"
        CHECK ("correccion_cifrada" IS NULL
               OR "correccion_cifrada" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

-- `value` admite NULL para que el claro se pueda VACIAR. Ver la cabecera:
-- el enum no tiene valor neutro, y un centinela sería una respuesta
-- clínica falsa dentro de la historia.
ALTER TABLE "clinical_assessment_corrections"
    ALTER COLUMN "value" DROP NOT NULL;

-- Y lo que sostiene la columna en su lugar: **una corrección dice algo**,
-- en claro o cifrado. Es más fuerte que el `NOT NULL` que sustituye, que
-- no impedía una fila con `question_id = ''` y un valor cualquiera.
ALTER TABLE "clinical_assessment_corrections"
    ADD CONSTRAINT "clinical_assessment_corrections_dice_algo"
        CHECK ("correccion_cifrada" IS NOT NULL
               OR ("value" IS NOT NULL AND "question_id" <> ''));

-- Y el CHECK de clinica-2 que exigía la pregunta no vacía, afinado por lo
-- mismo que el de la retirada de la foto: una corrección ya cifrada tiene
-- la pregunta en el ciphertext, así que `question_id` vacío es
-- exactamente lo que se busca. Lo que no se afloja es la garantía — la
-- sostiene `..._dice_algo`, que exige la pregunta no vacía CUANDO no hay
-- cifrado.
--
-- También lo encontró la comprobación a mano: el trigger dejaba pasar el
-- vaciado y el CHECK lo paraba.
ALTER TABLE "clinical_assessment_corrections"
    DROP CONSTRAINT "clinical_assessment_corrections_question_not_blank";

ALTER TABLE "clinical_assessment_corrections"
    ADD CONSTRAINT "clinical_assessment_corrections_question_not_blank"
        CHECK (btrim("question_id") <> ''
               OR "correccion_cifrada" IS NOT NULL);

-- ── Las dos columnas que NO son de una tabla clínica ─────────────────
--
-- `appointments.notes` y `clients.notes` existen desde B1 y las usa el spa.
-- Se cifran **en los tenants con la clínica encendida** (decisión 10): en
-- una clínica, «viene por lo del dedo infectado» acaba en la nota de la
-- cita, y eso es un dato de salud en una tabla que nadie trataba como
-- clínica.
--
-- La columna cifrada está en la tabla para TODOS los tenants, y quién la
-- usa lo decide la aplicación según la capability. Dos columnas por tabla
-- y no dos tablas: una cita es una cita, y partirla por tipo de negocio
-- habría metido un `if` en la agenda, que es el módulo que menos tiene que
-- saber de esto.
ALTER TABLE "appointments"
    ADD COLUMN "notes_cifradas" TEXT,
    ADD CONSTRAINT "appointments_notes_cifradas_formato"
        CHECK ("notes_cifradas" IS NULL
               OR "notes_cifradas" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

ALTER TABLE "clients"
    ADD COLUMN "notes_cifradas" TEXT,
    ADD CONSTRAINT "clients_notes_cifradas_formato"
        CHECK ("notes_cifradas" IS NULL
               OR "notes_cifradas" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

-- La ficha técnica por servicio. En peluquería es la fórmula del color; en
-- una clínica son «los parámetros del tratamiento», que es exactamente un
-- dato de salud. Misma regla que las dos de arriba: se cifra en los
-- tenants clínicos.
--
-- Esta columna NO estaba en la lista del prompt y entra por la regla «si
-- dudas, se cifra». Aparece en el inventario del `-done` con esa nota.
ALTER TABLE "client_technical_notes"
    ADD COLUMN "body_cifrado" TEXT,
    ADD CONSTRAINT "client_technical_notes_body_cifrado_formato"
        CHECK ("body_cifrado" IS NULL
               OR "body_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

-- ──────────────────────────────────────────────────────────────────────
-- 4 · LOS TRIGGERS DEJAN PASAR EL CIFRADO, Y NADA MÁS.
-- ──────────────────────────────────────────────────────────────────────
--
-- El script de cifrado tiene que hacer un `UPDATE` sobre tablas que son
-- inmutables por trigger. Había dos formas:
--
--   a) desactivar los triggers mientras el script corre
--      (`ALTER TABLE ... DISABLE TRIGGER`), o
--   b) **enseñarle al trigger cuál es la transición legítima.**
--
-- Se hace (b). Con (a), durante los minutos del script la historia clínica
-- no tiene ninguna garantía puesta y un fallo del script podría reescribir
-- un cuerpo sin que nada lo frene — y los fallos de los scripts de
-- migración se descubren después. Con (b) el script corre con las
-- garantías puestas: puede poner el cifrado y vaciar el claro, y si
-- intentara cambiar un cuerpo, un autor o una fecha, el motor lo rechaza
-- igual que rechazaría a una ruta.
--
-- La transición permitida, dicha una sola vez:
--
--   1. el cifrado aparece donde no estaba (y después no cambia);
--   2. el claro sigue igual, o se vacía al centinela;
--   3. **todo lo demás, idéntico.**
--
-- El punto 3 se escribe comparando la fila entera menos las dos columnas
-- (`to_jsonb(NEW) - 'body' - 'body_cifrado'`), y no listando columnas: una
-- lista es un sitio donde olvidarse de la columna que se añada dentro de
-- dos bloques, y el olvido abriría la fila a reescrituras.

-- El centinela del claro vaciado. Un objeto, porque el CHECK
-- `clinical_entries_body_object` exige objeto no vacío — y porque un
-- `{"cifrado": true}` se lee en un `SELECT` y dice qué pasó, que es más de
-- lo que diría un `{}`.
CREATE OR REPLACE FUNCTION mipiacetpv_clinical_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'HISTORIA_VIOLADA: la historia clínica no se borra (%.%). Se conserva y se le añaden anotaciones.',
            TG_TABLE_NAME, OLD.id USING ERRCODE = '23514';
    END IF;

    -- clinica-7 · LA ÚNICA transición permitida: cifrar el cuerpo.
    IF (to_jsonb(NEW) - 'body' - 'body_cifrado')
         = (to_jsonb(OLD) - 'body' - 'body_cifrado')
       AND NEW.body_cifrado IS NOT NULL
       AND (OLD.body_cifrado IS NULL
            OR NEW.body_cifrado = OLD.body_cifrado)
       AND (NEW.body = OLD.body
            OR NEW.body = '{"cifrado": true}'::jsonb)
    THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION
        'HISTORIA_VIOLADA: la historia clínica no se edita (%.%). Lo escrito queda; para corregirlo se añade una anotación con su autor y su fecha. (Lo único que se puede hacer sobre una fila escrita es cifrar su cuerpo.)',
        TG_TABLE_NAME, OLD.id USING ERRCODE = '23514';
END;
$fn$;

-- La foto: la misma idea, sobre un guard que ya dejaba pasar UNA
-- transición (la retirada). Ahora deja pasar dos, y las dos acotadas.
--
-- Nota sobre el orden: la retirada escribe `withdraw_reason_cifrado`
-- directamente (la aplicación ya cifra), así que la retirada de una foto
-- nueva no pasa por aquí como «cifrado»: pasa como retirada, con las dos
-- columnas del motivo puestas de una vez.
CREATE OR REPLACE FUNCTION mipiacetpv_clinical_photos_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'HISTORIA_VIOLADA: una foto clínica no se borra (clinical_photos.%). Se retira con autor y motivo, y sigue en la historia.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    -- clinica-7 · cifrar la zona y el motivo. Todo lo demás idéntico,
    -- comparado sobre la fila entera menos las cuatro columnas en juego.
    IF (to_jsonb(NEW) - 'zona' - 'zona_cifrada'
                      - 'withdraw_reason' - 'withdraw_reason_cifrado')
         = (to_jsonb(OLD) - 'zona' - 'zona_cifrada'
                          - 'withdraw_reason' - 'withdraw_reason_cifrado')
       AND NEW.zona_cifrada IS NOT NULL
       AND (OLD.zona_cifrada IS NULL OR NEW.zona_cifrada = OLD.zona_cifrada)
       AND (NEW.zona = OLD.zona OR NEW.zona = '')
       -- el motivo solo se cifra si lo hay, y solo una vez
       AND (OLD.withdraw_reason_cifrado IS NULL
            OR NEW.withdraw_reason_cifrado = OLD.withdraw_reason_cifrado)
       AND (NEW.withdraw_reason IS NOT DISTINCT FROM OLD.withdraw_reason
            OR (NEW.withdraw_reason = ''
                AND NEW.withdraw_reason_cifrado IS NOT NULL))
    THEN
        RETURN NEW;
    END IF;

    IF NEW.tenant_id      IS DISTINCT FROM OLD.tenant_id
       OR NEW.client_id      IS DISTINCT FROM OLD.client_id
       OR NEW.appointment_id IS DISTINCT FROM OLD.appointment_id
       OR NEW.zona           IS DISTINCT FROM OLD.zona
       OR NEW.zona_cifrada   IS DISTINCT FROM OLD.zona_cifrada
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
            OR NEW.withdraw_reason IS DISTINCT FROM OLD.withdraw_reason
            OR NEW.withdraw_reason_cifrado
                 IS DISTINCT FROM OLD.withdraw_reason_cifrado) THEN
        RAISE EXCEPTION
            'HISTORIA_VIOLADA: la foto % ya está retirada y la retirada no se deshace ni se reescribe.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$fn$;

-- El consentimiento: solo inserción, con la misma rendija para su motivo
-- de revocación.
CREATE OR REPLACE FUNCTION mipiacetpv_client_consents_append_only()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'HISTORIA_VIOLADA: un consentimiento firmado no se borra (client_consents.%). Para retirarlo se firma una revocación, que también queda escrita.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    -- clinica-7 · cifrar el motivo de la revocación, y nada más.
    IF (to_jsonb(NEW) - 'revoke_reason' - 'revoke_reason_cifrado')
         = (to_jsonb(OLD) - 'revoke_reason' - 'revoke_reason_cifrado')
       AND NEW.revoke_reason_cifrado IS NOT NULL
       AND (OLD.revoke_reason_cifrado IS NULL
            OR NEW.revoke_reason_cifrado = OLD.revoke_reason_cifrado)
       AND (NEW.revoke_reason = OLD.revoke_reason OR NEW.revoke_reason = '')
    THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION
        'HISTORIA_VIOLADA: un consentimiento firmado no se edita (client_consents.%). Dice qué texto leyó y firmó una persona; para cambiarlo se firma otro.',
        OLD.id USING ERRCODE = '23514';
END;
$fn$;

-- Y las correcciones de la valoración. Aquí el claro se vacía de verdad:
-- `question_id` a cadena vacía y `value` a NULL, que es lo que el CHECK
-- `clinical_assessment_corrections_dice_algo` sostiene.
CREATE OR REPLACE FUNCTION mipiacetpv_clinical_corrections_append_only()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'HISTORIA_VIOLADA: una corrección de la valoración no se borra (clinical_assessment_corrections.%). Corregir una corrección es otra fila.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    -- clinica-7 · cifrar la corrección (pregunta y valor juntos).
    IF (to_jsonb(NEW) - 'question_id' - 'value' - 'correccion_cifrada')
         = (to_jsonb(OLD) - 'question_id' - 'value' - 'correccion_cifrada')
       AND NEW.correccion_cifrada IS NOT NULL
       AND (OLD.correccion_cifrada IS NULL
            OR NEW.correccion_cifrada = OLD.correccion_cifrada)
       AND (
            (NEW.question_id = OLD.question_id
             AND NEW.value IS NOT DISTINCT FROM OLD.value)
            OR (NEW.question_id = '' AND NEW.value IS NULL)
       )
    THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION
        'HISTORIA_VIOLADA: una corrección de la valoración no se edita (clinical_assessment_corrections.%). Lleva su autor y su hora al lado de lo que contestó el paciente.',
        OLD.id USING ERRCODE = '23514';
END;
$fn$;

-- ──────────────────────────────────────────────────────────────────────
-- 5 · EL INFORME POR ENLACE. Fuera los adjuntos.
-- ──────────────────────────────────────────────────────────────────────
--
-- Decisión 21: el informe por email deja de llevar adjunto. El correo lleva
-- un enlace por la puerta común, y **para abrirlo hay que teclear un código
-- de 6 cifras** que se enseña UNA vez en pantalla a quien lo envía, para
-- darlo por otro canal (en mano o por teléfono).
--
-- ── Dos columnas en `public_links`, y no una tabla nueva ────────────
--
-- `code_hash` y `code_failures`. En la fila del enlace y no en una tabla
-- aparte porque son del enlace: caducan con él, se anulan con él y no
-- tienen vida propia. Una tabla con una fila por enlace habría sido un JOIN
-- en el camino más caliente de la puerta.
--
-- **Se guarda la HUELLA del código, nunca el código.** El CHECK solo admite
-- 64 hex, igual que `token_hash`: un código de 6 cifras no cabe en esta
-- columna. Es la misma garantía puesta en el motor, no en una revisión.
--
-- Y `code_failures` SOLO SUBE, como `used_count`: bajarlo es regalar
-- intentos. Lo garantiza el guard, abajo.
ALTER TABLE "public_links"
    ADD COLUMN "code_hash"     CHAR(64),
    ADD COLUMN "code_failures" INTEGER NOT NULL DEFAULT 0,
    -- 64 hex y nada más. El código en claro (6 cifras) NO CABE.
    ADD CONSTRAINT "public_links_code_hash_es_sha256"
        CHECK ("code_hash" IS NULL OR "code_hash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "public_links_code_failures_no_negativo"
        CHECK ("code_failures" >= 0);

-- El guard de `enlaces-publicos` es una LISTA de lo que no cambia, así que
-- una columna nueva nace mutable. Las dos tienen que entrar en él:
--
--   · `code_hash` es identidad: el código de un enlace no cambia. Si hace
--     falta otro código, es otro enlace (y el anterior se anula). Un código
--     que se puede reescribir es un enlace que alguien reabre cambiándole
--     la cerradura.
--   · `code_failures` solo sube, por lo mismo que `used_count`.
CREATE OR REPLACE FUNCTION mipiacetpv_public_link_guard() RETURNS trigger
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
       -- clinica-7 · el código es parte de la cerradura.
       OR NEW.code_hash   IS DISTINCT FROM OLD.code_hash
       OR NEW.max_uses    IS DISTINCT FROM OLD.max_uses
       OR NEW.expires_at  IS DISTINCT FROM OLD.expires_at
       OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
       OR NEW.created_at  IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION
            'ENLACE_VIOLADO: el enlace % no se reescribe en lo que lo identifica (para qué sirve, a qué apunta, su huella, su código, su tope, cuándo caduca). Para dar otro enlace se revoca éste y se crea uno nuevo.',
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

    -- clinica-7 · 4bis · los intentos fallidos del código SOLO SUBEN.
    -- Bajarlos es regalarle intentos a quien está probando códigos de seis
    -- cifras sobre la historia clínica de alguien.
    IF NEW.code_failures < OLD.code_failures THEN
        RAISE EXCEPTION
            'ENLACE_VIOLADO: los intentos fallidos del código del enlace % no bajan (% → %). Bajarlos es regalar intentos.',
            OLD.id, OLD.code_failures, NEW.code_failures USING ERRCODE = '23514';
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

-- ── El PDF del informe entregado POR ENLACE sí se guarda ────────────
--
-- Y es una divergencia declarada con clinica-4 §3, que decidió que **el PDF
-- del informe NO se guarda**: «un informe es una foto de la historia en un
-- momento; se arma, se entrega, y lo que queda es la prueba de que se
-- entregó».
--
-- Eso vale para imprimir y para el adjunto: en los dos casos el documento
-- se lo lleva alguien en el mismo acto. **Con un enlace no se lo lleva
-- nadie**: el documento tiene que existir cuando el destinatario lo abra,
-- tres días después. Y no se puede volver a armar en ese momento —
-- `armarInforme` lee la historia VIVA, así que una visita nueva cambiaría
-- el documento y el `pdf_sha256` que la entrega guardó dejaría de cuadrar.
-- Serviría un documento que nadie decidió mandar.
--
-- Así que la entrega por enlace guarda su PDF en el volumen clínico
-- (cifrado, como todo lo demás), y `pdf_file_name` apunta a él. `NULL` en
-- las entregas por impresión y en las de email con adjunto de antes de este
-- bloque: ahí no hay fichero y no lo había.
--
-- Lo que esto NO es: un archivo de informes. Son 7 días de vida por enlace.
-- Purgar los de los enlaces caducados es del bloque de supresión RGPD, y
-- queda dicho en el `-done`.
ALTER TABLE "clinical_report_deliveries"
    ADD COLUMN "pdf_file_name" VARCHAR(100),
    -- El enlace por el que se entregó, cuando el canal es LINK. Sin FK
    -- dura: `public_links` se anula y se queda, así que la referencia no
    -- se rompe — pero si un día se purgaran, una FK impediría purgarlos.
    ADD COLUMN "public_link_id" UUID;

-- «La entrega de este enlace», que es lo que la ruta pública resuelve para
-- saber qué documento servir.
CREATE INDEX "clinical_report_deliveries_enlace_idx"
    ON "clinical_report_deliveries"("public_link_id")
    WHERE "public_link_id" IS NOT NULL;

-- Y las dos columnas van JUNTAS o ninguna, y solo con canal EMAIL: una
-- entrega con enlace y sin fichero sería un enlace que no abre nada, y un
-- fichero sin enlace sería un PDF de salud guardado que nadie va a leer.
--
-- No se añade un canal `LINK` al CHECK: el canal sigue siendo EMAIL porque
-- lo que sale de aquí es un correo. Lo que cambia es QUÉ lleva el correo, y
-- eso lo dice `public_link_id`.
ALTER TABLE "clinical_report_deliveries"
    ADD CONSTRAINT "clinical_report_deliveries_enlace_completo"
        CHECK (
            ("public_link_id" IS NULL AND "pdf_file_name" IS NULL)
            OR ("public_link_id" IS NOT NULL
                AND "pdf_file_name" IS NOT NULL
                AND "channel" = 'EMAIL')
        );

-- La tabla sigue siendo de SOLO INSERCIÓN: el trigger
-- `clinical_report_deliveries_append_only` no se toca. Las dos columnas se
-- escriben en el INSERT y no cambian nunca — el enlace se anula en
-- `public_links`, no aquí.
