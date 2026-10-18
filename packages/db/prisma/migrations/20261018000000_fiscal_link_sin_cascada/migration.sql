-- La quinta función: `mipiacetpv_tickets_fiscal_link_guard`, sin la rama de
-- cascada. ADR-021 §6.3 (el remate).
--
-- `20261017030000_eliminar_cuenta_unica_puerta` quitó la escapatoria de la
-- cascada de los CUATRO guardias que la tenían y dejó ésta viva a propósito,
-- con el argumento escrito: este trigger no guarda nada que
-- `fiscal_records_append_only` no guarde ya —existe para que el mensaje diga
-- «este ticket tiene factura» en vez de hablar de una clave ajena— y, con el
-- append-only cerrado, un tenant con facturas ya no llega a la cascada.
--
-- El argumento es correcto —la transacción se va atrás igual— pero es un
-- motivo para que quitar la rama sea BARATO, no para dejarla. Y midiéndolo
-- aparece lo que sí cambia, que es justo la razón de existir del trigger.
--
-- ── Qué pasa de verdad, medido ─────────────────────────────────────────
--
-- Un ticket `TEST` con factura emitida existe: S1 deja borrar un `TEST` a
-- propósito (limpieza de implantación) y verifactu-1 añadió este trigger
-- precisamente para que un `TEST` con factura no se vaya.
--
-- Base migrada de cero, un tenant con ese ticket y su registro, y
-- `DELETE FROM tenants` a pelo. El orden real de las cascadas es `tickets`
-- ANTES de `fiscal_records`, así que:
--
--   · Con la rama puesta: el ticket pasa los dos guardias —`TEST` en el
--     primero, «el tenant ya no está» en el segundo— y se BORRA dentro de la
--     cascada. Lo que para la transacción es el append-only cuando le llega
--     su turno a `fiscal_records`, y el mensaje que se lee habla del
--     REGISTRO:
--
--         REGISTRO_FISCAL_VIOLADO: un registro de facturación no se borra
--         (registro …, caja …, posición 1)
--
--     Es decir: lo que salva al ticket no es su guardián, es el de la tabla
--     de al lado. Y la FK `RESTRICT` de `fiscal_records.ticket_id` tampoco
--     llega a hablar: su comprobación va en la cola de AFTER y el append-only
--     levanta antes.
--
--   · Sin la rama: levanta su guardián, en su cascada, y dice lo que hay:
--
--         REGISTRO_FISCAL_VIOLADO: el ticket … tiene factura emitida y no se
--         borra. Se anula con un registro de anulación.
--
-- Las dos paran. La diferencia es que una depende del orden de las cascadas
-- hermanas y la otra no.
--
-- ── Lo que esto NO abre ────────────────────────────────────────────────
--
-- Aquí no hay rama para `mipiacetpv_eliminando_este_tenant`, y es a propósito:
-- un ticket cuya factura SIGUE VIVA no se borra ni dentro de «Eliminar
-- cuenta». No hace falta ninguna: `eliminarLaCuenta` —y la limpieza de la
-- suite, `test-e2e/borrar-tenant.ts`— borran `fiscal_records` ANTES que
-- `tickets`, así que cuando le toca al ticket ya no hay factura que mirar.
-- El `EXISTS` de abajo es la comprobación contra el estado real, que es el
-- único tipo de escapatoria que este repo acepta.
--
-- ── Y la razón de fondo ────────────────────────────────────────────────
--
-- «A esta rama no se puede llegar» es exactamente la frase que justificaba
-- las otras cuatro, y era falsa. El orden en que Postgres resuelve las
-- cascadas hermanas de una misma tabla NO es parte de ningún contrato: hoy
-- `fiscal_records` se va antes que `tickets` y por eso el que contesta es el
-- append-only; una FK nueva, un `ALTER`, un `pg_dump`/`restore` que recree
-- las claves en otro orden, y el que contesta es otro. Una invariante fiscal
-- no se apoya en eso. Ninguna de las cinco funciones vuelve a hacerlo.
--
-- Partida de la ÚNICA definición previa, `20260924000000_verifactu_1_registro`
-- (`grep -rn "FUNCTION mipiacetpv_tickets_fiscal_link_guard"
-- packages/db/prisma/migrations`). El resto del cuerpo no se toca: ni el
-- `EXISTS`, ni el texto del `RAISE`, ni el `ERRCODE`.

CREATE OR REPLACE FUNCTION mipiacetpv_tickets_fiscal_link_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF EXISTS (SELECT 1 FROM fiscal_records WHERE ticket_id = OLD.id) THEN
        RAISE EXCEPTION
            'REGISTRO_FISCAL_VIOLADO: el ticket % tiene factura emitida y no se borra. Se anula con un registro de anulación.',
            OLD.id USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
END;
$fn$;
