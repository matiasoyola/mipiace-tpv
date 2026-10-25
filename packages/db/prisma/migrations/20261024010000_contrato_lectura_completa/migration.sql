-- contrato-lectura-completa · LA ACEPTACIÓN DICE QUE EL TEXTO SE RECORRIÓ.
--
-- Decisión 3 del prompt: la aceptación registra además que el texto
-- completo se mostró y se recorrió hasta el final, y el instante en que el
-- final llegó a la pantalla. La API rechaza con 400 una aceptación que no
-- lo traiga: la regla vive en el camino de escritura y no sólo en la
-- pantalla.
--
-- ── UNA columna, no dos ──────────────────────────────────────────────
--
-- «Se recorrió» y «cuándo se recorrió» son el MISMO hecho: `IS NOT NULL`
-- es el booleano. Dos columnas que siempre van juntas son dos columnas que
-- un día se contradicen — y esta tabla es una prueba jurídica.
--
-- ── Las aceptaciones ya guardadas NO SE TOCAN ────────────────────────
--
-- La columna nace NULL y se queda NULL en todas ellas. Un `DEFAULT false`
-- habría escrito en las catorce filas de hoy «no recorrió el texto», y eso
-- no se sabe: cuando se aceptaron, nadie lo medía. `null` es «no se midió»
-- y es la verdad.
--
-- Y por eso la columna es NULLABLE y no NOT NULL: nada en el pasado la
-- puede rellenar sin inventarse el dato.
--
-- ── Y no hace falta tocar el trigger de solo-inserción ───────────────
--
-- `clinical_processor_agreements_append_only` dispara BEFORE UPDATE OR
-- DELETE **FOR EACH ROW**. Un `ALTER TABLE ... ADD COLUMN` nullable es DDL
-- y no toca ninguna fila, así que no lo despierta — y la columna nueva
-- queda tan de-solo-inserción como las demás.

ALTER TABLE "clinical_processor_agreements"
    ADD COLUMN "texto_recorrido_en" TIMESTAMPTZ;

-- Las combinaciones imposibles, cerradas en la base.
--
-- `CASE` y `IS NULL` / `IS NOT NULL` en todas las ramas **a propósito**:
-- un CHECK que evalúa a NULL PASA, así que una condición escrita con `=`
-- sobre una columna que puede ser nula no cierra nada. Aquí no hay ni una
-- comparación que pueda dar NULL.
--
--   · una REVOCACIÓN no acepta nada: la columna en blanco;
--   · una ACEPTACIÓN del futuro trae su instante;
--   · una ACEPTACIÓN del pasado no trae nada (y es la verdad: no se
--     midió). Es la rama que deja pasar las filas de hoy, y la que un
--     `NOT NULL` habría hecho imposible.
ALTER TABLE "clinical_processor_agreements"
    ADD CONSTRAINT "clinical_processor_agreements_recorrido_coherente"
    CHECK (
        CASE
            WHEN "revokes_agreement_id" IS NOT NULL
                THEN "texto_recorrido_en" IS NULL
            ELSE TRUE
        END
    );

-- «¿De qué aceptaciones consta que se recorrió el texto?» Sin índice: son
-- media docena de filas por centro en cinco años (ver la cabecera del
-- modelo), y un índice sobre una tabla que no crece es un índice que no
-- sirve.
