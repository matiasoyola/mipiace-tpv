-- puesta-en-marcha · el reseteo del ensayo se lleva TODOS los tickets.
-- ADR-021 §5.1.
--
-- ── Lo que lo pide ─────────────────────────────────────────────────────
--
-- La foto de producción del 18-10. Cafetería Sirope, en ensayo, tenía 20
-- tickets `VOIDED`: 16 del cajero de pruebas y 4 de la demostración con la
-- dueña (8,50 € y tres de 0,00 €). Ninguno llegó a Holded y ninguno tiene
-- registro fiscal. **No ha vendido nunca.**
--
-- Un reseteo que sólo se lleve los `TEST` le deja esos 20 dentro: en el
-- arqueo, en el listado de ventas y en la cara del cliente el día que
-- empieza a facturar. En una cuenta EN ENSAYO nada es real —esa es la
-- invariante del bloque entero—, así que el reseteo borra todos los tickets,
-- sea cual sea su estado.
--
-- ── Por qué hace falta tocar el guardián del sello ─────────────────────
--
-- `mipiacetpv_tickets_delete_guard` (S1) impide borrar una venta SELLADA, y
-- eso está bien: una venta cobrada se anula por devolución, no se borra.
-- Tiene desde el primer día una excepción —`status = 'TEST'`— por
-- exactamente el mismo razonamiento que esta migración extiende: un ticket
-- de prueba no es una venta.
--
-- Lo que no contemplaba es que la CUENTA ENTERA pueda no estar facturando.
-- Un ticket anulado de una cuenta en ensayo está sellado (se cobró de
-- verdad, en el ensayo) y no es `TEST` (lo anuló alguien), así que el
-- guardián lo protegía — y el reseteo se caía con `SELLO_VIOLADO`. Lo
-- encontró el e2e del bloque, no una revisión.
--
-- ── Las tres condiciones, y ninguna sobra ──────────────────────────────
--
-- La excepción NO es «la cuenta está en ensayo, borra lo que sea». Son tres,
-- y las tres se comprueban contra el estado real:
--
--   1. **La cuenta no factura** (`fiscal_go_live_at IS NULL`). Es el estado
--      que define el bloque: lo que cobra este TPV no son facturas.
--   2. **El ticket no tiene registro fiscal.** La FK `RESTRICT` de
--      `fiscal_records.ticket_id` lo pararía igual, pero entonces el mensaje
--      hablaría de una clave ajena. Y es la invariante que de verdad
--      importa: una factura emitida no se borra NUNCA.
--   3. **El ticket no llegó a Holded** (`holded_document_id IS NULL`). Si
--      está poblado, el worker de subida vio que Holded CREABA el documento:
--      existió una factura con número en la contabilidad del cliente, y
--      anular el ticket aquí no la deshace. Es la misma señal con la que el
--      backfill de la migración decide qué es una venta real (regla 3.b), y
--      por la misma razón.
--
-- La aplicación comprueba 2 y 3 ANTES de borrar nada y contesta un 409 que
-- dice QUÉ ticket mirar (`comprobarQueNadaEsReal`). Esto de aquí es la
-- última puerta: si alguien escribe el borrado a mano, la base sigue
-- diciendo que no.
--
-- ── Y por qué una migración nueva y no editar la de ayer ───────────────
--
-- Porque `CREATE OR REPLACE` SUSTITUYE: el cuerpo de abajo es el de
-- `20261017010000_eliminar_cuenta` —la última definición de esta función—
-- más la excepción nueva. Meterlo en aquélla habría sido más corto y habría
-- dejado una migración llamada «eliminar_cuenta» decidiendo sobre el
-- reseteo. Esta lleva su nombre y su motivo.

CREATE OR REPLACE FUNCTION mipiacetpv_tickets_delete_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF OLD.sealed_at IS NULL THEN RETURN OLD; END IF;
    IF OLD.status = 'TEST' THEN RETURN OLD; END IF;
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
        RETURN OLD;
    END IF;
    -- ADR-021 §5 · la eliminación de la cuenta entera.
    IF mipiacetpv_eliminando_este_tenant(OLD.tenant_id) THEN
        RETURN OLD;
    END IF;
    -- ADR-021 §5.1 · el reseteo del ensayo. Las tres condiciones de arriba.
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
