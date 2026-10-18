-- puesta-en-marcha (parte C) · eliminar la cuenta de un cliente que se va.
-- ADR-021 §5.
--
-- El problema: hoy no existe «dar de baja». Un cliente que se marcha deja su
-- cuenta entera —su catálogo, sus ventas, sus facturas— viva en nuestra base
-- para siempre, y nosotros seguimos siendo responsables de unos datos que ya
-- no tenemos por qué tener. El art. 17 del RGPD dice lo contrario.
--
-- Y la dificultad: media base está protegida por triggers que impiden borrar
-- —`fiscal_records` es append-only, una venta sellada no se borra, un fichaje
-- se conserva cuatro años, un enlace público no se borra— y esos triggers
-- están bien. Lo que esta migración hace NO es quitarlos: es darles una
-- escapatoria más, del mismo tipo que la que ya tenían.
--
-- ── La escapatoria que ya existía, y por qué no bastaba ────────────────
--
-- Cuatro de estos triggers llevan desde el primer día la misma excepción:
--
--     IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
--         RETURN OLD;   -- cascada del borrado del tenant
--     END IF;
--
-- Es decir: «si el comercio ya no existe, esto es su borrado en cascada y no
-- alguien limpiando una factura». Es correcta y es la que esta parte usa como
-- modelo. Lo que no se puede es LLEGAR a ella, y el motivo son las claves
-- ajenas: `fiscal_records.ticket_id` y una docena más son `RESTRICT`, así que
-- `DELETE FROM tenants` no puede ir primero —rebota contra las filas hijas— y
-- las filas hijas no se pueden borrar antes porque el tenant todavía existe.
-- Un círculo.
--
-- ── Lo que se añade ───────────────────────────────────────────────────
--
-- Una marca de TRANSACCIÓN que nombra al tenant que se está eliminando:
--
--     SET LOCAL mipiacetpv.eliminar_tenant = '<uuid>';
--
-- y los cinco triggers que hacen falta la miran. Cinco propiedades, y las
-- cinco son el motivo de que esto no sea «una puerta para borrar facturas»:
--
--   1. **Nombra al tenant.** No es un interruptor de «desactiva los
--      guardias»: autoriza el borrado de las filas DE ESE comercio y de
--      ningún otro. Una fila de otro tenant en la misma transacción rebota
--      igual que siempre.
--   2. **Es `SET LOCAL`.** Muere con la transacción. No hay forma de dejarla
--      puesta: ni una variable de entorno, ni una columna, ni un `ALTER
--      DATABASE`. Fuera de una transacción, `SET LOCAL` no hace nada —así que
--      el fallo por descuido deja el guardia CERRADO, que es la dirección
--      correcta.
--   3. **Sólo DELETE.** Ni un UPDATE. Un registro de facturación sigue sin
--      poder reescribirse en ninguna circunstancia, y eso es lo que de verdad
--      protege el art. 29.2.e de la Ley Antifraude: la numeración y la
--      huella de las facturas que SIGUEN existiendo.
--   4. **Es todo o nada.** La operación que la usa borra el tenant entero y
--      termina con `DELETE FROM tenants`. No existe ningún camino que borre
--      un registro y deje la cuenta viva: el reseteo del ensayo
--      (`fiscal/puesta-en-marcha.ts`) no toca `fiscal_records` y no puede,
--      porque en una cuenta en ensayo está vacía.
--   5. **Deja rastro antes de empezar.** La ruta exige haber descargado el
--      export —el ZIP con los registros, su huella y su encadenamiento, que
--      es lo que el titular tiene que conservar cuatro años— y lo comprueba
--      contra el registro de auditoría del super-admin.
--
-- Lo que esta migración NO abre, y queda dicho aquí para que no se busque:
-- la historia clínica. `clinical_entries`, `clinical_addenda`,
-- `clinical_access_log` y sus hermanas no tienen escapatoria ninguna
-- (clinica-1 §1) y NO se les añade. Una historia clínica se conserva por la
-- Ley 41/2002 y su destrucción es una decisión con su propio marco legal y su
-- propio bloque. La eliminación de cuenta se BLOQUEA en una cuenta con
-- historia clínica o con residentes, y lo dice.

-- ── 1 · la marca, en un solo sitio ─────────────────────────────────────
--
-- Los cinco triggers la leen llamando aquí. Si la regla viviera copiada en
-- cada uno, el día que haya que endurecerla habría que acordarse de cinco
-- sitios — y el que se olvide es el que deja la puerta abierta.
--
-- `current_setting(..., true)` devuelve NULL si nadie la puso; el `COALESCE`
-- lo convierte en una cadena que no puede ser un UUID. Sin él la comparación
-- daría NULL, y un `IF NULL THEN` no entra —funcionaría igual, por
-- casualidad—. Se escribe explícito: la misma lección que el CHECK de la
-- parte A (un predicado que evalúa a NULL no comprueba nada).

CREATE OR REPLACE FUNCTION mipiacetpv_eliminando_este_tenant(p_tenant uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $fn$
BEGIN
    RETURN COALESCE(current_setting('mipiacetpv.eliminar_tenant', true), '') = p_tenant::text;
END;
$fn$;

COMMENT ON FUNCTION mipiacetpv_eliminando_este_tenant(uuid) IS
  'puesta-en-marcha/ADR-021 §5 · ¿estamos DENTRO de la transacción que elimina la cuenta entera de ESTE tenant? Sólo autoriza DELETE, sólo de ese tenant, y muere con la transacción (SET LOCAL).';

-- ── 2 · el registro de facturación ─────────────────────────────────────
--
-- MISMO texto y mismo comportamiento que en verifactu-1, con una línea más.
-- El `RAISE` de abajo no cambia ni una palabra: lo que lee quien intente
-- borrar una factura de una cuenta viva es exactamente lo que leía ayer.

CREATE OR REPLACE FUNCTION mipiacetpv_fiscal_records_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
        RETURN OLD;   -- cascada del borrado del tenant
    END IF;
    -- ADR-021 §5 · la eliminación de la cuenta entera. SÓLO borrado: un
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

-- ── 3 · la venta sellada ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION mipiacetpv_tickets_delete_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF OLD.sealed_at IS NULL THEN RETURN OLD; END IF;
    IF OLD.status = 'TEST' THEN RETURN OLD; END IF;
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
        RETURN OLD;
    END IF;
    -- ADR-021 §5
    IF mipiacetpv_eliminando_este_tenant(OLD.tenant_id) THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION
        'SELLO_VIOLADO: no se borra una venta sellada (ticket %). Una venta cobrada se anula por devolución.',
        OLD.id USING ERRCODE = '23514';
END;
$fn$;

-- ── 4 · el fichaje y su empleado ───────────────────────────────────────
--
-- Los cuatro años del art. 34.9 del Estatuto de los Trabajadores los
-- conserva el TITULAR, igual que las facturas: el export se los entrega. Lo
-- que no tiene sentido es que los sigamos guardando nosotros de una empresa
-- que ya no es cliente.

CREATE OR REPLACE FUNCTION mipiacetpv_time_entries_delete_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
        RETURN OLD;
    END IF;
    -- ADR-021 §5
    IF mipiacetpv_eliminando_este_tenant(OLD.tenant_id) THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION
        'REGISTRO_VIOLADO: un fichaje no se borra (fichaje %). Se conserva 4 años y se corrige, nunca se quita.',
        OLD.id USING ERRCODE = '23514';
END;
$fn$;

CREATE OR REPLACE FUNCTION mipiacetpv_employees_delete_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
        RETURN OLD;   -- cascada del borrado del tenant
    END IF;
    -- ADR-021 §5
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

-- ── 5 · el enlace público ──────────────────────────────────────────────
--
-- Éste no tenía NINGUNA escapatoria: su `DELETE` siempre levantaba. Y su FK
-- al tenant es `RESTRICT`, así que sin esto la eliminación de cuenta se para
-- en seco en cualquier comercio que haya mandado un consentimiento por
-- enlace. El resto del trigger —toda la parte de UPDATE— no se toca.
--
-- ── Y LA LECCIÓN DE ESTE BLOQUE, en voz alta ──────────────────────────
--
-- El cuerpo de abajo se ha copiado de `clinica_7_blindaje`, que es la ÚLTIMA
-- migración que reemplazó esta función, y NO de `enlaces_publicos`, que es la
-- que la creó. Partir de la primera versión costó dos tests rojos en el e2e
-- (`clinica-7 · el código del enlace no se reescribe` y `· sus fallos no
-- bajan`): un `CREATE OR REPLACE` no mezcla nada, SUSTITUYE, así que las dos
-- reglas que clinica-7 añadió —el código del enlace es parte de la cerradura
-- y los intentos fallidos sólo suben— se habrían perdido en silencio. Las
-- habría echado de menos la siguiente auditoría, no el despliegue.
--
-- Regla para la próxima vez: antes de reemplazar un trigger ajeno,
-- `grep -rn "CREATE OR REPLACE FUNCTION <nombre>" packages/db/prisma/migrations`
-- y copiar el cuerpo de la fecha más alta.

CREATE OR REPLACE FUNCTION mipiacetpv_public_link_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        -- ADR-021 §5
        IF mipiacetpv_eliminando_este_tenant(OLD.tenant_id) THEN
            RETURN OLD;
        END IF;
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
