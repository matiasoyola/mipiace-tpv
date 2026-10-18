-- puesta-en-marcha · la marca de «Eliminar cuenta» es la ÚNICA puerta.
-- ADR-021 §6.3.
--
-- ── El agujero ─────────────────────────────────────────────────────────
--
-- Cuatro guardias llevaban desde el primer día esta escapatoria:
--
--     IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
--         RETURN OLD;   -- cascada del borrado del tenant
--     END IF;
--
-- La leyenda era: «si el comercio ya no existe, esto es su borrado en
-- cascada y no alguien limpiando una factura». Y la premisa que la hacía
-- parecer inocente —escrita en `20261017010000_eliminar_cuenta` y en la
-- tabla de alternativas de ADR-021 §6— era que a esa rama NO SE PUEDE
-- LLEGAR: `fiscal_records.ticket_id` y una docena más son `RESTRICT`, así
-- que un `DELETE FROM tenants` a pelo rebota contra las filas hijas.
--
-- La premisa es falsa. `fiscal_records.tenant_id` es `ON DELETE CASCADE`
-- (igual que `tickets.tenant_id` y que `employees.tenant_id`, y
-- `time_entries` cuelga de `employees`), así que un `DELETE FROM tenants`
-- de una cuenta **cuyo registro fiscal no apunta a ningún ticket** —o
-- cuyas cascadas hermanas se resuelven en el orden favorable, que no está
-- garantizado— entra por la cascada, encuentra la rama, y se lleva por
-- delante los registros de facturación, las ventas selladas y los
-- fichajes. Sin marca, sin export, sin rastro. Medido en una base migrada
-- de cero: `DELETE FROM tenants` → `DELETE 1`, `fiscal_records` a cero.
--
-- Es decir: el candado de ADR-021 §6 —la marca que NOMBRA al tenant, que
-- muere con la transacción, que exige el export descargado— estaba al lado
-- de una puerta abierta. Un candado sólo vale si es la única puerta.
--
-- ── La corrección ──────────────────────────────────────────────────────
--
-- Se quita la rama. A partir de aquí, un tenant con registros fiscales,
-- con ventas selladas no borrables o con fichajes **sólo se puede borrar
-- dentro de la transacción de «Eliminar cuenta»**, la que pone
--
--     SET LOCAL mipiacetpv.eliminar_tenant = '<uuid>';
--
-- antes de tocar una fila. Un `DELETE FROM tenants` a mano levanta
-- `REGISTRO_FISCAL_VIOLADO` (o `SELLO_VIOLADO`, o `REGISTRO_VIOLADO`) y no
-- borra nada: toda la transacción se va atrás.
--
-- Y la dirección del fallo es la correcta. `SET LOCAL` fuera de una
-- transacción no hace nada, así que el descuido deja el guardia CERRADO;
-- lo que se pierde al quitar esta rama es exactamente la posibilidad de
-- que el descuido lo deje ABIERTO.
--
-- ── Lo que NO cambia ───────────────────────────────────────────────────
--
--   · El texto de los cuatro `RAISE`. Quien intente borrar una factura de
--     una cuenta viva lee exactamente lo que leía ayer.
--   · Las demás escapatorias, que son las que tienen un motivo propio y
--     comprobable contra el estado real: un ticket sin sellar, un ticket
--     `TEST`, las tres condiciones del reseteo del ensayo (§5.1), un
--     empleado que nunca llegó a fichar.
--   · «Eliminar cuenta» (`superadmin/eliminar-cuenta.ts`), que ya ponía la
--     marca ANTES de la primera fila y termina en `DELETE FROM tenants`
--     dentro de la misma transacción. No necesita una línea.
--
-- Queda una rama de cascada viva a propósito, en
-- `mipiacetpv_tickets_fiscal_link_guard` (verifactu-1): ése trigger no
-- guarda nada que los cuatro de aquí no guarden ya —existe para que el
-- mensaje diga «este ticket tiene factura» en vez de hablar de una clave
-- ajena—, y con `fiscal_records_append_only` cerrado, un tenant con
-- facturas ya no llega a la cascada. Se deja dicho para que no se busque.
--
-- ── Y la lección de SIEMPRE, otra vez ─────────────────────────────────
--
-- `CREATE OR REPLACE` SUSTITUYE. Los cuatro cuerpos de abajo se han
-- copiado de la ÚLTIMA definición de cada función, que no es la misma
-- migración para todas:
--
--   · `fiscal_records_append_only`  → 20261017010000_eliminar_cuenta
--   · `tickets_delete_guard`        → 20261017020000_reseteo_del_ensayo
--   · `time_entries_delete_guard`   → 20261017010000_eliminar_cuenta
--   · `employees_delete_guard`      → 20261017010000_eliminar_cuenta
--
-- Partir de `verifactu-1` o de `fichaje-1` habría borrado en silencio la
-- marca de ADR-021 §6; partir de `eliminar_cuenta` para el guardián del
-- sello habría borrado las tres condiciones del reseteo del ensayo.

-- ── 1 · el registro de facturación ─────────────────────────────────────
--
-- Ya no hay ninguna forma de borrar un registro de facturación que no sea
-- la transacción que elimina la cuenta entera de ese mismo tenant. Y sigue
-- siendo SÓLO borrado: un registro no se reescribe nunca.

CREATE OR REPLACE FUNCTION mipiacetpv_fiscal_records_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    -- ADR-021 §6 · la eliminación de la cuenta entera. SÓLO borrado: un
    -- registro no se reescribe nunca, ni aquí.
    IF TG_OP = 'DELETE' AND mipiacetpv_eliminando_este_tenant(OLD.tenant_id) THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION
        'REGISTRO_FISCAL_VIOLADO: un registro de facturación no se % (registro %, caja %, posición %). Una factura emitida se anula con un registro de anulación, nunca se reescribe.',
        CASE TG_OP WHEN 'DELETE' THEN 'borra' ELSE 'modifica' END,
        OLD.id, OLD.register_id, OLD.chain_index
        USING ERRCODE = '23514';
END;
$fn$;

-- ── 2 · la venta sellada ───────────────────────────────────────────────
--
-- Cuerpo de `20261017020000_reseteo_del_ensayo` menos la rama de cascada.
-- Las tres condiciones del reseteo del ensayo siguen enteras: ésas sí se
-- comprueban contra el estado real de la cuenta y del ticket.

CREATE OR REPLACE FUNCTION mipiacetpv_tickets_delete_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF OLD.sealed_at IS NULL THEN RETURN OLD; END IF;
    IF OLD.status = 'TEST' THEN RETURN OLD; END IF;
    -- ADR-021 §6 · la eliminación de la cuenta entera.
    IF mipiacetpv_eliminando_este_tenant(OLD.tenant_id) THEN
        RETURN OLD;
    END IF;
    -- ADR-021 §5.1 · el reseteo del ensayo. Las tres condiciones: la cuenta
    -- no factura, el ticket no llegó a Holded, el ticket no tiene registro
    -- fiscal.
    IF EXISTS (
          SELECT 1 FROM tenants
           WHERE id = OLD.tenant_id
             AND fiscal_go_live_at IS NULL
       )
       AND OLD.holded_document_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM fiscal_records WHERE ticket_id = OLD.id)
    THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION
        'SELLO_VIOLADO: no se borra una venta sellada (ticket %). Una venta cobrada se anula por devolución.',
        OLD.id USING ERRCODE = '23514';
END;
$fn$;

-- ── 3 · el fichaje y su empleado ───────────────────────────────────────
--
-- Los cuatro años del art. 34.9 del Estatuto de los Trabajadores los
-- conserva el TITULAR: el export se los entrega antes de eliminar la
-- cuenta. Lo que no puede seguir pasando es que un `DELETE FROM tenants`
-- a pelo se los lleve sin que nadie los haya descargado.
--
-- `time_entries` no tiene FK al tenant: cuelga de `employees`, que sí es
-- `CASCADE`. Así que ésta era la rama por la que se iban los fichajes.

CREATE OR REPLACE FUNCTION mipiacetpv_time_entries_delete_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    -- ADR-021 §6
    IF mipiacetpv_eliminando_este_tenant(OLD.tenant_id) THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION
        'REGISTRO_VIOLADO: un fichaje no se borra (fichaje %). Se conserva 4 años y se corrige, nunca se quita.',
        OLD.id USING ERRCODE = '23514';
END;
$fn$;

-- El empleado conserva su escapatoria propia —un alta equivocada que nunca
-- llegó a fichar— porque ésa se comprueba contra `time_entries` y no contra
-- «el padre ya no está».

CREATE OR REPLACE FUNCTION mipiacetpv_employees_delete_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    -- ADR-021 §6
    IF mipiacetpv_eliminando_este_tenant(OLD.tenant_id) THEN
        RETURN OLD;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM time_entries WHERE employee_id = OLD.id) THEN
        RETURN OLD;   -- un alta equivocada que nunca llegó a fichar
    END IF;
    RAISE EXCEPTION
        'REGISTRO_VIOLADO: el empleado % tiene fichajes y no se borra. La baja se da desactivándolo.',
        OLD.id USING ERRCODE = '23514';
END;
$fn$;
