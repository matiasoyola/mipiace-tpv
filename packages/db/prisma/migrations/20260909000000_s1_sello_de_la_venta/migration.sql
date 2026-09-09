-- S1-sello · el sello de la venta (ADR-015).
--
-- Hasta hoy la inalterabilidad del dato económico era disciplina de la
-- aplicación, y la aplicación no es la única puerta a Postgres: no había
-- ni un trigger, ni un REVOKE, ni una regla en ninguna migración
-- (`docs/auditorias/2026-09-05-inalterabilidad-datos-venta.md`, agujero
-- nº 1). Un `UPDATE tickets SET total = ...` desde el VPS pasaba sin
-- dejar rastro. Esta migración mueve la garantía al motor.
--
-- Cuatro piezas:
--
--   1. `tickets.sealed_hash` / `tickets.sealed_at` — el sello. Lo calcula
--      el SERVIDOR al persistir el cobro (`apps/api/src/tickets/seal.ts`),
--      nunca el terminal.
--   2. `ticket_corrections` + `record_ticket_correction(...)` — la única
--      vía por la que una columna sellada puede cambiar, con motivo
--      obligatorio. Append-only.
--   3. Los triggers que hacen cumplir 1 y 2.
--   4. `shift_z_reports` — el Z congelado en base de datos, con huella y
--      con el Z anterior conservado cuando entra una venta tardía.
--
-- SQL manual porque Prisma no expresa triggers ni funciones. Mismo patrón
-- que el índice parcial de `v1_8_fiado`. Migración aditiva: no toca ni una
-- fila existente. El histórico queda `sealed_at IS NULL` a propósito
-- (ADR-015 §5.2) — no se sella retroactivamente.

-- ── 1 · el sello ───────────────────────────────────────────────────────

ALTER TABLE "tickets" ADD COLUMN "sealed_hash" TEXT;
ALTER TABLE "tickets" ADD COLUMN "sealed_at" TIMESTAMPTZ;

CREATE INDEX "tickets_tenant_id_sealed_at_idx"
    ON "tickets"("tenant_id", "sealed_at");

-- ── 2 · la vía de corrección ───────────────────────────────────────────

CREATE TABLE "ticket_corrections" (
    "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id"  UUID NOT NULL,
    "ticket_id"  UUID NOT NULL,
    "table_name" TEXT NOT NULL,
    "row_id"     UUID NOT NULL,
    "field"      TEXT NOT NULL,
    "old_value"  TEXT,
    "new_value"  TEXT,
    "reason"     TEXT NOT NULL,
    "author"     TEXT NOT NULL,
    "user_id"    UUID,
    "txid"       BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "ticket_corrections_ticket_id_fkey"
        FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- El motivo es el precio de entrada. Una corrección sin motivo no es
    -- una corrección: es la misma manipulación con otro nombre.
    CONSTRAINT "ticket_corrections_reason_not_blank"
        CHECK (btrim("reason") <> ''),
    CONSTRAINT "ticket_corrections_author_not_blank"
        CHECK (btrim("author") <> ''),
    CONSTRAINT "ticket_corrections_table_name_check"
        CHECK ("table_name" IN ('tickets', 'ticket_lines', 'ticket_payments'))
);

CREATE INDEX "ticket_corrections_ticket_id_created_at_idx"
    ON "ticket_corrections"("ticket_id", "created_at");
CREATE INDEX "ticket_corrections_tenant_id_created_at_idx"
    ON "ticket_corrections"("tenant_id", "created_at");
-- El trigger busca por aquí en CADA update de columna sellada. El nombre
-- es el que generaría Prisma para el `@@index` del modelo: si no, el
-- siguiente `migrate dev` vería el índice como sobrante y lo borraría.
CREATE INDEX "ticket_corrections_txid_table_name_row_id_field_idx"
    ON "ticket_corrections"("txid", "table_name", "row_id", "field");

-- La tabla de correcciones es append-only. Si se pudiera editar o borrar,
-- la traza valdría lo mismo que no tenerla.
CREATE FUNCTION mipiacetpv_corrections_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    -- Cascada del borrado del ticket: la fila padre ya no está. No es
    -- alguien borrando la traza, es el ticket entero yéndose.
    IF TG_OP = 'DELETE'
       AND NOT EXISTS (SELECT 1 FROM tickets WHERE id = OLD.ticket_id) THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION
        'SELLO_VIOLADO: ticket_corrections es append-only (intento de % sobre la corrección %)',
        TG_OP, OLD.id
        USING ERRCODE = '23514';
END;
$fn$;

CREATE TRIGGER "ticket_corrections_append_only"
    BEFORE UPDATE OR DELETE ON "ticket_corrections"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_corrections_append_only();

-- ── GENERADO desde packages/db/src/sealed-fields.ts ─────────────────
-- No editar a mano: `sello-lista-columnas.test.ts` compara este bloque
-- con buildSealedGuardSql() y se pone rojo si difieren.
CREATE OR REPLACE FUNCTION mipiacetpv_sealed_columns(p_table text)
RETURNS text[]
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE p_table
    WHEN 'tickets' THEN ARRAY['internal_number', 'shift_id', 'total', 'total_tax', 'total_discount', 'cash_amount', 'paid_at']::text[]
    WHEN 'ticket_lines' THEN ARRAY['product_id', 'variant_id', 'holded_product_id', 'sku', 'name_snapshot', 'units', 'unit_price', 'unit_price_override', 'discount_pct', 'tax_rate', 'subtotal', 'total', 'modifiers']::text[]
    WHEN 'ticket_payments' THEN ARRAY['method', 'amount', 'meta', 'external_id', 'collected_in_shift_id']::text[]
    ELSE ARRAY[]::text[]
  END;
$fn$;
-- ── FIN GENERADO ───────────────────────────────────────────────────

-- ¿Hay una corrección viva, en ESTA transacción, para esta columna de
-- esta fila? Es lo único que abre la puerta del trigger.
CREATE FUNCTION mipiacetpv_correction_exists(p_table text, p_row_id uuid, p_field text)
RETURNS boolean
LANGUAGE sql STABLE AS $fn$
    SELECT EXISTS (
        SELECT 1 FROM ticket_corrections
         WHERE txid = txid_current()
           AND table_name = p_table
           AND row_id = p_row_id
           AND field = p_field
    );
$fn$;

-- La API de la corrección. Nadie escribe una columna sellada a mano: se
-- llama a esto, que lee el valor anterior del propio motor, deja la fila
-- de traza y HACE el UPDATE. Así la traza y el cambio son la misma
-- transacción por construcción — si una revienta, se van las dos.
--
-- SECURITY DEFINER a propósito. Hoy el rol de la aplicación es el dueño
-- de las tablas y no cambia nada; el día que se despliegue un rol de
-- aplicación sin UPDATE sobre las tablas económicas (el REVOKE que esta
-- migración NO hace, ver el -done del bloque), lo único que hará falta es
-- un GRANT EXECUTE sobre esta función. La frontera ya está donde tiene
-- que estar.
CREATE FUNCTION record_ticket_correction(
    p_table     text,
    p_row_id    uuid,
    p_field     text,
    p_new_value text,
    p_reason    text,
    p_author    text,
    p_user_id   uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
    v_ticket_id uuid;
    v_tenant_id uuid;
    v_old       text;
    v_type      text;
    v_id        uuid;
BEGIN
    IF p_table NOT IN ('tickets', 'ticket_lines', 'ticket_payments') THEN
        RAISE EXCEPTION 'CORRECCION_INVALIDA: la tabla % no es corregible', p_table
            USING ERRCODE = '23514';
    END IF;
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'CORRECCION_SIN_MOTIVO: una corrección sin motivo no se escribe'
            USING ERRCODE = '23514';
    END IF;
    IF p_author IS NULL OR btrim(p_author) = '' THEN
        RAISE EXCEPTION 'CORRECCION_SIN_AUTOR: una corrección sin autor no se escribe'
            USING ERRCODE = '23514';
    END IF;
    -- La identidad de la fila no se corrige: se corrige lo que dice.
    IF p_field IN ('id', 'ticket_id', 'tenant_id', 'sealed_hash', 'sealed_at') THEN
        RAISE EXCEPTION 'CORRECCION_INVALIDA: la columna %.% no se corrige', p_table, p_field
            USING ERRCODE = '23514';
    END IF;
    SELECT a.atttypid::regtype::text INTO v_type
      FROM pg_attribute a
     WHERE a.attrelid = p_table::regclass
       AND a.attname = p_field
       AND a.attnum > 0
       AND NOT a.attisdropped;
    IF v_type IS NULL THEN
        RAISE EXCEPTION 'CORRECCION_INVALIDA: la columna %.% no existe', p_table, p_field
            USING ERRCODE = '23514';
    END IF;

    IF p_table = 'tickets' THEN
        v_ticket_id := p_row_id;
    ELSE
        EXECUTE format('SELECT ticket_id FROM %I WHERE id = $1', p_table)
           INTO v_ticket_id USING p_row_id;
    END IF;
    IF v_ticket_id IS NULL THEN
        RAISE EXCEPTION 'CORRECCION_INVALIDA: la fila % de % no existe', p_row_id, p_table
            USING ERRCODE = '23514';
    END IF;

    SELECT t.tenant_id INTO v_tenant_id FROM tickets t WHERE t.id = v_ticket_id;
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'CORRECCION_INVALIDA: el ticket % no existe', v_ticket_id
            USING ERRCODE = '23514';
    END IF;

    EXECUTE format('SELECT to_jsonb(x) ->> %L FROM %I x WHERE x.id = $1', p_field, p_table)
       INTO v_old USING p_row_id;

    INSERT INTO ticket_corrections
        (tenant_id, ticket_id, table_name, row_id, field,
         old_value, new_value, reason, author, user_id, txid)
    VALUES
        (v_tenant_id, v_ticket_id, p_table, p_row_id, p_field,
         v_old, p_new_value, btrim(p_reason), btrim(p_author), p_user_id, txid_current())
    RETURNING id INTO v_id;

    EXECUTE format('UPDATE %I SET %I = $1::%s WHERE id = $2', p_table, p_field, v_type)
      USING p_new_value, p_row_id;

    RETURN v_id;
END;
$fn$;

-- ── 3 · los triggers ───────────────────────────────────────────────────

-- `tickets`: la fila SIGUE VIVA después del cobro (status, synced_at, los
-- tres de Holded, email_failed_at, los intents, credit_pending…). El
-- trigger mira ÚNICAMENTE las columnas de la lista generada arriba; todo
-- lo demás se escribe con la misma libertad de siempre. Pasarse de
-- estricto aquí rompe el flujo de Holded, que es el fallo típico.
CREATE FUNCTION mipiacetpv_tickets_sealed_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
    v_col   text;
    v_old_j jsonb;
    v_new_j jsonb;
BEGIN
    IF OLD.sealed_at IS NULL THEN
        RETURN NEW;   -- pre-sello o venta todavía sin cobrar
    END IF;
    IF NEW.sealed_at IS DISTINCT FROM OLD.sealed_at
       OR NEW.sealed_hash IS DISTINCT FROM OLD.sealed_hash THEN
        RAISE EXCEPTION
            'SELLO_VIOLADO: el sello de un ticket ya sellado no se reescribe (ticket %)',
            OLD.id USING ERRCODE = '23514';
    END IF;
    v_old_j := to_jsonb(OLD);
    v_new_j := to_jsonb(NEW);
    FOREACH v_col IN ARRAY mipiacetpv_sealed_columns('tickets') LOOP
        IF (v_old_j -> v_col) IS DISTINCT FROM (v_new_j -> v_col) THEN
            IF NOT mipiacetpv_correction_exists('tickets', OLD.id, v_col) THEN
                RAISE EXCEPTION
                    'SELLO_VIOLADO: tickets.% es una columna económica de una venta sellada (ticket %). La corrección se escribe con record_ticket_correction().',
                    v_col, OLD.id USING ERRCODE = '23514';
            END IF;
        END IF;
    END LOOP;
    RETURN NEW;
END;
$fn$;

CREATE TRIGGER "tickets_sealed_guard"
    BEFORE UPDATE ON "tickets"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_tickets_sealed_guard();

-- Borrar una venta sellada no está en el alcance de ninguna vía de
-- corrección: una venta cobrada se anula por devolución, que crea un
-- registro nuevo. Dos excepciones, las dos comprobadas contra el estado
-- real y no contra una promesa:
--   · el cajero técnico TEST (limpieza de implantación, superadmin);
--   · la cascada del borrado del tenant (la fila padre ya no está).
CREATE FUNCTION mipiacetpv_tickets_delete_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF OLD.sealed_at IS NULL THEN RETURN OLD; END IF;
    IF OLD.status = 'TEST' THEN RETURN OLD; END IF;
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION
        'SELLO_VIOLADO: no se borra una venta sellada (ticket %). Una venta cobrada se anula por devolución.',
        OLD.id USING ERRCODE = '23514';
END;
$fn$;

CREATE TRIGGER "tickets_delete_guard"
    BEFORE DELETE ON "tickets"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_tickets_delete_guard();

-- `ticket_lines` y `ticket_payments`: estas filas NO tienen vida
-- operativa. Cobradas, no se tocan. Por eso el trigger es más duro que la
-- lista de columnas económicas: vigila la fila entera.
--
-- INSERT también, y no por manía: meter una línea nueva en una venta
-- sellada cambia lo vendido igual que editarla. Un fiado admite pagos
-- nuevos porque todavía NO está sellado (se sella al saldarse, que es
-- cuando se cobra de verdad).
CREATE FUNCTION mipiacetpv_ticket_children_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
    v_ticket_id uuid;
    v_sealed_at timestamptz;
    v_found     boolean;
    v_col       text;
    v_old_j     jsonb;
    v_new_j     jsonb;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_ticket_id := NEW.ticket_id;
    ELSE
        v_ticket_id := OLD.ticket_id;
    END IF;

    SELECT true, t.sealed_at INTO v_found, v_sealed_at
      FROM tickets t WHERE t.id = v_ticket_id;

    -- El ticket padre ya no existe: esto es la cascada de su borrado, no
    -- alguien vaciando una venta. (Postgres borra el padre y DESPUÉS
    -- dispara la cascada, así que aquí ya no se ve.)
    IF v_found IS NULL THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;
    IF v_sealed_at IS NULL THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    IF TG_OP = 'INSERT' THEN
        RAISE EXCEPTION
            'SELLO_VIOLADO: no se añaden filas a % de una venta sellada (ticket %)',
            TG_TABLE_NAME, v_ticket_id USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'SELLO_VIOLADO: no se borra una fila de % de una venta sellada (ticket %). Una venta cobrada se anula por devolución.',
            TG_TABLE_NAME, v_ticket_id USING ERRCODE = '23514';
    END IF;

    v_old_j := to_jsonb(OLD);
    v_new_j := to_jsonb(NEW);
    FOR v_col IN SELECT jsonb_object_keys(v_old_j) LOOP
        IF (v_old_j -> v_col) IS DISTINCT FROM (v_new_j -> v_col) THEN
            IF NOT mipiacetpv_correction_exists(TG_TABLE_NAME, OLD.id, v_col) THEN
                RAISE EXCEPTION
                    'SELLO_VIOLADO: %.% pertenece a una venta sellada (ticket %). La corrección se escribe con record_ticket_correction().',
                    TG_TABLE_NAME, v_col, v_ticket_id USING ERRCODE = '23514';
            END IF;
        END IF;
    END LOOP;
    RETURN NEW;
END;
$fn$;

CREATE TRIGGER "ticket_lines_sealed_guard"
    BEFORE INSERT OR UPDATE OR DELETE ON "ticket_lines"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_ticket_children_guard();

CREATE TRIGGER "ticket_payments_sealed_guard"
    BEFORE INSERT OR UPDATE OR DELETE ON "ticket_payments"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_ticket_children_guard();

-- ── 4 · el Z sellado ───────────────────────────────────────────────────
--
-- El Z vivía sólo como PDF en `shifts.z_report_pdf_path`: un fichero en
-- disco, sustituible sin que nada lo detecte. Y `z_report_stale` existía
-- porque entran ventas después de generarlo — un cierre que puede quedar
-- caducado no es un cierre.
--
-- Aquí el desglose queda congelado como DATO, con su huella, y una venta
-- tardía no invalida el Z anterior: emite uno nuevo y marca el viejo como
-- corregido. `shifts.z_report_stale` pasa a significar exactamente eso:
-- "existe un Z posterior que corrige a este".

CREATE TABLE "shift_z_reports" (
    "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "shift_id"          UUID NOT NULL,
    "sequence"          INTEGER NOT NULL,
    "breakdown"         JSONB NOT NULL,
    "sealed_hash"       TEXT NOT NULL,
    "sealed_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
    "pdf_path"          TEXT,
    "reason"            TEXT NOT NULL,
    "superseded_at"     TIMESTAMPTZ,
    "superseded_by_id"  UUID,

    CONSTRAINT "shift_z_reports_shift_id_fkey"
        FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "shift_z_reports_reason_check"
        CHECK ("reason" IN ('CLOSE', 'LATE_SALE'))
);

CREATE UNIQUE INDEX "shift_z_reports_shift_id_sequence_key"
    ON "shift_z_reports"("shift_id", "sequence");
CREATE INDEX "shift_z_reports_shift_id_sealed_at_idx"
    ON "shift_z_reports"("shift_id", "sealed_at");

-- Append-only con una sola puerta: marcar una fila como superada por la
-- siguiente, y una única vez. Ni el desglose ni la huella se reescriben.
CREATE FUNCTION mipiacetpv_z_reports_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF NOT EXISTS (SELECT 1 FROM shifts WHERE id = OLD.shift_id) THEN
            RETURN OLD;   -- cascada del borrado del turno
        END IF;
        RAISE EXCEPTION
            'SELLO_VIOLADO: un Z archivado no se borra (turno %, Z nº %)',
            OLD.shift_id, OLD.sequence USING ERRCODE = '23514';
    END IF;
    IF OLD.superseded_at IS NOT NULL THEN
        RAISE EXCEPTION
            'SELLO_VIOLADO: el Z nº % del turno % ya está marcado como corregido',
            OLD.sequence, OLD.shift_id USING ERRCODE = '23514';
    END IF;
    IF NEW.shift_id       IS DISTINCT FROM OLD.shift_id
       OR NEW.sequence    IS DISTINCT FROM OLD.sequence
       OR NEW.breakdown   IS DISTINCT FROM OLD.breakdown
       OR NEW.sealed_hash IS DISTINCT FROM OLD.sealed_hash
       OR NEW.sealed_at   IS DISTINCT FROM OLD.sealed_at
       OR NEW.pdf_path    IS DISTINCT FROM OLD.pdf_path
       OR NEW.reason      IS DISTINCT FROM OLD.reason THEN
        RAISE EXCEPTION
            'SELLO_VIOLADO: el contenido de un Z archivado no se reescribe (turno %, Z nº %)',
            OLD.shift_id, OLD.sequence USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$fn$;

CREATE TRIGGER "shift_z_reports_guard"
    BEFORE UPDATE OR DELETE ON "shift_z_reports"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_z_reports_guard();
