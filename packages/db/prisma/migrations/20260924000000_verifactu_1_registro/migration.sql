-- V1-verifactu · el registro de facturación encadenado (ADR-019).
--
-- RD 1007/2023 + Orden HAC/1177/2024. Un comercio sin Holded entrega una
-- FACTURA SIMPLIFICADA (art. 7 del RD 1619/2012), y para eso hace falta un
-- registro de facturación por cada factura, encadenado por huella y
-- conservado sin poder alterarse.
--
-- La tesis de ADR-019, en dos frases: cada CAJA es una instalación de SIF
-- con su serie, su numeración y su cadena; y el registro nace EN EL
-- DISPOSITIVO, en el momento de cobrar, porque la FAQ de desarrolladores
-- de la AEAT exige que el registro esté «íntegramente producido en el
-- momento de generar la factura y el código QR y entregarla al cliente» y
-- el TPV cobra sin red.
--
-- Cinco piezas:
--
--   1. Un dispositivo activo por caja, garantizado por la base, con traza
--      de quién revocó a quién.
--   2. La instalación SIF de la caja: su serie y su número de instalación.
--   3. `fiscal_records` · el registro, append-only.
--   4. Los triggers que lo hacen cumplir.
--   5. `mipiacetpv_verify_fiscal_chain(...)` · la verificación, DENTRO del
--      motor, que recalcula las huellas con `sha256()` de Postgres.
--
-- SQL a mano porque Prisma no expresa triggers, funciones ni índices
-- parciales. Mismo patrón que `s1_sello_de_la_venta` y `fichaje_1_registro`.
--
-- Migración ADITIVA: crea objetos nuevos y no toca ni una fila de lo que ya
-- existe. Un tenant de hoy tiene `holded_enabled = true` y estas tablas se
-- quedan vacías para siempre. Con UNA condición previa, la pieza 1: si
-- alguna caja tiene hoy dos dispositivos activos, esta migración ABORTA.

-- ── 1 · un dispositivo activo por caja ─────────────────────────────────
--
-- Hasta hoy `POST /devices/pair` creaba el device sin revocar los
-- anteriores de esa caja y nada lo impedía. Con la cadena naciendo en el
-- dispositivo eso deja de ser una preferencia: dos dispositivos sin red en
-- la misma caja producen dos registros en la MISMA posición de cadena, y
-- una cadena con dos registros en la misma posición está rota.
--
-- El chequeo va PRIMERO y ABORTA. No revoca nada por su cuenta: decidir
-- cuál de las dos tablets de un cliente se queda no es cosa de una
-- migración, y una migración que apaga un terminal en mitad de un servicio
-- es peor que una migración que no corre.

-- ── 1(a) · pero no todo lo que hay en `devices` es un terminal de caja ──
--
-- El super-admin tiene un «modo prueba» (B-OnboardingV2) que crea un
-- dispositivo TÉCNICO en la caja del cliente para validar el flujo del TPV
-- antes de activarlo. No cobra a nadie, no imprime a nadie y sus tickets se
-- purgan al activar. No es un terminal, y tratarlo como si lo fuera rompe
-- las tres piezas de abajo a la vez:
--
--   · el trigger revocaría el terminal REAL del cliente al activar el modo
--     prueba — un comercio sin poder cobrar desde el super-admin;
--   · el índice único daría un 500 al reactivarlo;
--   · esta precondición contaría dispositivos que no compiten por la
--     cadena, y abortaría la migración de un comercio que está bien.
--
-- Por eso el tipo va EN EL DATO y no en el nombre ni en el `user_agent`. Un
-- invariante que se decide comparando una cadena de texto se rompe el día
-- que alguien traduce el nombre o cambia el user-agent del arranque.
CREATE TYPE "DeviceKind" AS ENUM ('TERMINAL', 'TEST');

ALTER TABLE "devices"
    ADD COLUMN "kind" "DeviceKind" NOT NULL DEFAULT 'TERMINAL';

-- El backfill. Los dos marcadores que ha llevado siempre el dispositivo del
-- modo prueba (`provisionTestCashier`), con OR y no con AND: el `user_agent`
-- sólo se escribe al CREARLO, así que uno reaprovisionado por una versión
-- vieja podría llevar sólo el nombre. Marcar de menos aquí es volver al
-- fallo; marcar de más no es posible, porque ningún terminal real de un
-- cliente se llama así ni se anuncia con ese user-agent.
UPDATE devices
   SET kind = 'TEST'
 WHERE user_agent = 'internal/mipiacetpv-test'
    OR name = 'mipiacetpv · modo prueba';

DO $do$
DECLARE
    v_fila   record;
    v_lista  text := '';
    v_cuenta int  := 0;
BEGIN
    FOR v_fila IN
        SELECT s.name AS store_name, r.name AS register_name, r.id AS register_id,
               count(*) AS n
          FROM devices d
          JOIN registers r ON r.id = d.register_id
          JOIN stores    s ON s.id = r.store_id
         WHERE d.revoked_at IS NULL
           -- Sólo TERMINAL: el dispositivo del modo prueba no compite por
           -- la cadena de la caja y no puede abortar una migración.
           AND d.kind = 'TERMINAL'
         GROUP BY s.name, r.name, r.id
        HAVING count(*) > 1
         ORDER BY s.name, r.name
    LOOP
        v_cuenta := v_cuenta + 1;
        v_lista := v_lista || format(E'\n  · %s / %s (%s): %s dispositivos activos',
                                     v_fila.store_name, v_fila.register_name,
                                     v_fila.register_id, v_fila.n);
    END LOOP;

    IF v_cuenta > 0 THEN
        RAISE EXCEPTION
            E'VERIFACTU_PRECONDICION: hay % caja(s) con más de un dispositivo activo:%\n\nDecide cuál se queda y revoca el resto desde el admin ANTES de volver a lanzar la migración. Esta migración no revoca nada por su cuenta.',
            v_cuenta, v_lista
            USING ERRCODE = '23514';
    END IF;
END
$do$;

-- Por qué se revocó un dispositivo. NULL en todo lo revocado hasta hoy: no
-- sabemos por qué se hizo y no se va a inventar.
CREATE TYPE "DeviceRevokedReason" AS ENUM ('PAIRED_NEW', 'ADMIN');

ALTER TABLE "devices" ADD COLUMN "revoked_reason" "DeviceRevokedReason";
-- A favor de cuál se revocó. Con esto, un laboratorio emparejado por error
-- a la caja de un cliente se ve el mismo día en el super-admin, en vez de
-- descubrirse cuando la cadena de esa caja ya está rota.
ALTER TABLE "devices" ADD COLUMN "revoked_by_device_id" UUID;

-- DEFERRABLE INITIALLY DEFERRED, y no por gusto.
--
-- El índice único de abajo obliga a revocar el anterior ANTES de insertar
-- el nuevo; y la traza de a favor de quién se revocó apunta al nuevo, que
-- en ese momento todavía no existe. Con la FK inmediata no hay orden
-- posible: o se rompe el índice o se rompe la clave ajena.
--
-- Diferida, la transacción queda como se lee: «revoco el de esta caja a
-- favor del que voy a emparejar, y lo emparejo». Si algo falla en medio,
-- se van las dos cosas.
ALTER TABLE "devices"
    ADD CONSTRAINT "devices_revoked_by_device_id_fkey"
    FOREIGN KEY ("revoked_by_device_id") REFERENCES "devices"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "devices_revoked_by_device_id_idx"
    ON "devices"("revoked_by_device_id");

-- UN dispositivo activo por caja, garantizado POR LA BASE.
--
-- Emparejar uno nuevo revoca el anterior en la misma transacción. Si ese
-- UPDATE no corriera —un `if` que alguien quita, un camino nuevo que se
-- olvida—, el INSERT revienta aquí en vez de dejar dos dispositivos vivos
-- emitiendo en la misma cadena. Copia literal de
-- `employee_devices_one_active_key` (F1).
CREATE UNIQUE INDEX "devices_one_active_per_register_key"
    ON "devices"("register_id")
    WHERE "revoked_at" IS NULL AND "kind" = 'TERMINAL';

-- Y quien revoca al anterior es la BASE, no la ruta de emparejamiento.
--
-- La alternativa era hacerlo en `POST /devices/pair`. Se descartó por lo
-- mismo que la identidad fiscal de la caja: habría que acordarse en cada
-- camino que empareja un terminal, y olvidarse no da un error legible sino
-- un 500 contra el índice de arriba en mitad de una implantación.
--
-- Aquí el índice único no se puede violar por construcción: cuando llega el
-- INSERT, el anterior ya está revocado.
--
-- La traza de la pieza 1(b) la escribe este mismo trigger: `PAIRED_NEW` y a
-- favor de quién. Por eso la clave ajena es DEFERRABLE INITIALLY DEFERRED —
-- apunta a una fila que todavía no existe y se comprueba al hacer commit.
CREATE FUNCTION mipiacetpv_devices_revoke_previous() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF NEW.revoked_at IS NOT NULL THEN
        RETURN NEW;   -- alta de un device ya revocado: no releva a nadie
    END IF;
    IF NEW.kind <> 'TERMINAL' THEN
        RETURN NEW;   -- el modo prueba no releva al terminal del cliente
    END IF;
    UPDATE devices
       SET revoked_at           = now(),
           revoked_reason       = 'PAIRED_NEW',
           revoked_by_device_id = NEW.id
     WHERE register_id = NEW.register_id
       AND revoked_at IS NULL
       -- Y tampoco se releva a nadie que no sea un terminal: emparejar una
       -- tablet nueva no puede apagar el modo prueba del super-admin.
       AND kind = 'TERMINAL';
    RETURN NEW;
END;
$fn$;

CREATE TRIGGER "devices_revoke_previous"
    BEFORE INSERT ON "devices"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_devices_revoke_previous();

-- ── 2 · la instalación SIF de la caja ──────────────────────────────────
--
-- La instalación cuelga de la CAJA y no del dispositivo. Si colgara del
-- aparato, cambiar de tablet partiría el SIF en dos y la cadena tendría
-- que empezar de cero — justo lo contrario de lo que decide ADR-019.
--
-- La FAQ de desarrolladores lo respalda: «cada una de esas facturaciones
-- distintas (…) del mismo OEF pero de distintos centros de facturación
-- independientes, como tiendas) debe tener un nº de instalación propio y
-- distinto al resto (pasado, presente o futuro)». Una caja es una
-- facturación independiente: su serie, su numeración, su cadena.

-- La serie de la factura simplificada de esta caja: `C1`, `C2`…
-- NULL = esta caja todavía no emite. No se reutiliza `num_serie_holded`:
-- ésa es la serie de Holded, y mezclarlas es el error exacto que este
-- bloque existe para no cometer.
ALTER TABLE "registers" ADD COLUMN "fiscal_series" TEXT;

-- El `NumeroInstalacion` del diseño de registro. UUID generado UNA vez.
-- «No puede repetirse nunca: por ejemplo, incluso si se formatea el
-- ordenador donde estaba instalado un SIF y se reinstala el mismo software
-- de nuevo en ese mismo ordenador, el nuevo SIF así constituido debe llevar
-- otro nº de instalación diferente» (FAQ AEAT). Por eso es UNIQUE global y
-- no un correlativo por tenant.
ALTER TABLE "registers" ADD COLUMN "fiscal_installation_id" TEXT;

CREATE UNIQUE INDEX "registers_fiscal_installation_id_key"
    ON "registers"("fiscal_installation_id");

-- La serie tiene que caber en el QR y en el campo `NumSerieFactura`: sólo
-- ASCII imprimible (32-126) según §4 del documento del QR, y corta, porque
-- comparte los 60 caracteres del campo con el número.
ALTER TABLE "registers"
    ADD CONSTRAINT "registers_fiscal_series_format"
    CHECK ("fiscal_series" IS NULL
           OR ("fiscal_series" ~ '^[ -~]{1,20}$' AND btrim("fiscal_series") = "fiscal_series"));

-- La identidad fiscal de una caja NACE CON LA CAJA, y la pone la base.
--
-- La alternativa era ponerla en la ruta de alta de cajas y en la de
-- activación del modo emisor. Dos caminos que hay que acordarse de tocar, y
-- un tercero el día que aparezca otro — y una caja sin serie no puede
-- facturar, así que olvidarse significa un comercio encendido que no puede
-- cobrar. Aquí no hay nada que acordarse.
--
-- Se asigna SIEMPRE, también a las cajas de un comercio que factura con
-- Holded. La columna se queda sin usar en ese caso, y a cambio el día que
-- ese comercio pase a emitir ya tiene sus cajas listas. Dar la serie sólo a
-- los que emiten obligaría a repartirla después, que es el reparto que este
-- trigger existe para no tener que hacer.
CREATE FUNCTION mipiacetpv_registers_fiscal_identity_default() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
    v_tenant_id uuid;
    v_n         int := 1;
BEGIN
    IF NEW.fiscal_installation_id IS NULL THEN
        NEW.fiscal_installation_id := gen_random_uuid()::text;
    END IF;
    IF NEW.fiscal_series IS NULL THEN
        SELECT s.tenant_id INTO v_tenant_id FROM stores s WHERE s.id = NEW.store_id;
        -- El mismo lock que la comprobación de unicidad de abajo: dos altas
        -- simultáneas en el mismo comercio no pueden salir las dos con C1.
        PERFORM pg_advisory_xact_lock(hashtext('fiscal_series:' || v_tenant_id::text));
        WHILE EXISTS (
            SELECT 1 FROM registers r
              JOIN stores s2 ON s2.id = r.store_id
             WHERE s2.tenant_id = v_tenant_id
               AND r.deleted_at IS NULL
               AND r.fiscal_series = 'C' || v_n
        ) LOOP
            v_n := v_n + 1;
        END LOOP;
        NEW.fiscal_series := 'C' || v_n;
    END IF;
    RETURN NEW;
END;
$fn$;

CREATE TRIGGER "registers_fiscal_identity_default"
    BEFORE INSERT ON "registers"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_registers_fiscal_identity_default();

-- Y el backfill de las cajas que ya existen. Aditivo: rellena dos columnas
-- que hasta esta migración no existían, no toca ni un dato de negocio.
UPDATE registers r
   SET fiscal_installation_id = gen_random_uuid()::text,
       fiscal_series = 'C' || sub.n
  FROM (
        SELECT r2.id,
               row_number() OVER (PARTITION BY s.tenant_id ORDER BY r2.created_at, r2.id) AS n
          FROM registers r2
          JOIN stores s ON s.id = r2.store_id
         WHERE r2.deleted_at IS NULL
       ) sub
 WHERE r.id = sub.id
   AND r.fiscal_series IS NULL;

-- Dos cajas del mismo comercio no pueden compartir serie: la numeración es
-- «correlativa dentro de cada serie» (art. 7.1.a RD 1619/2012), y dos
-- cadenas escribiendo en la misma serie la parten.
--
-- Esto NO puede ser un índice único: el tenant de una caja está a dos
-- saltos (`registers → stores → tenants`) y un índice no puede llevar una
-- subconsulta. Va como trigger, y el trigger toma antes un lock de
-- transacción sobre el tenant para que dos altas simultáneas no se cuelen
-- las dos — que es exactamente lo que le pasaría a un `SELECT` + `INSERT`
-- en READ COMMITTED (el bug del pairing code del 2026-05-27).
CREATE FUNCTION mipiacetpv_registers_fiscal_series_unique() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
    v_tenant_id uuid;
    v_otra      text;
BEGIN
    IF NEW.fiscal_series IS NULL OR NEW.deleted_at IS NOT NULL THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE'
       AND NEW.fiscal_series IS NOT DISTINCT FROM OLD.fiscal_series
       AND OLD.deleted_at IS NULL THEN
        RETURN NEW;   -- no ha cambiado nada que mirar
    END IF;

    SELECT s.tenant_id INTO v_tenant_id FROM stores s WHERE s.id = NEW.store_id;
    PERFORM pg_advisory_xact_lock(hashtext('fiscal_series:' || v_tenant_id::text));

    SELECT r.name INTO v_otra
      FROM registers r
      JOIN stores s2 ON s2.id = r.store_id
     WHERE s2.tenant_id = v_tenant_id
       AND r.id <> NEW.id
       AND r.deleted_at IS NULL
       AND r.fiscal_series = NEW.fiscal_series
     LIMIT 1;

    IF v_otra IS NOT NULL THEN
        RAISE EXCEPTION
            'SERIE_FISCAL_DUPLICADA: la serie "%" ya es la de la caja "%" en este comercio. Dos cajas con la misma serie parten la numeración correlativa.',
            NEW.fiscal_series, v_otra
            -- 23514 (check_violation) y no 23505 (unique_violation), que es
            -- lo que esto es semánticamente: el cliente Prisma convierte los
            -- 23505 en un error estructurado y TIRA EL MENSAJE. Un mensaje
            -- que explica el problema y que nadie puede leer no sirve de
            -- nada; el resto de guardas de este bloque usan 23514 igual.
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$fn$;

CREATE TRIGGER "registers_fiscal_series_unique"
    BEFORE INSERT OR UPDATE ON "registers"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_registers_fiscal_series_unique();

-- ── 3 · el registro de facturación ─────────────────────────────────────

CREATE TYPE "FiscalRecordKind"   AS ENUM ('ALTA', 'ANULACION');
CREATE TYPE "FiscalChainStatus"  AS ENUM ('OK', 'BROKEN');

CREATE TABLE "fiscal_records" (
    "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id"   UUID NOT NULL,
    "register_id" UUID NOT NULL,
    -- Idempotencia del outbox: el mismo cobro reenviado no crea dos
    -- registros. Lo genera el dispositivo, igual que `tickets.external_id`.
    "external_id" UUID NOT NULL,

    "kind" "FiscalRecordKind" NOT NULL,

    -- Posición en la cadena de ESTA caja, 1-based. No es el número de la
    -- factura: una anulación ocupa posición y no gasta número.
    "chain_index" INTEGER NOT NULL,

    "serie"              TEXT    NOT NULL,
    "numero"             INTEGER NOT NULL,
    -- El literal completo `C1/000123`. Se guarda entero porque es lo que
    -- entró en la huella y lo que va en el QR: recomponerlo a trozos en
    -- otro sitio es una forma de que deje de coincidir.
    "num_serie_factura"  TEXT    NOT NULL,
    "fecha_expedicion"   DATE    NOT NULL,
    -- Lista L2. `F2` = factura simplificada.
    "tipo_factura"       TEXT    NOT NULL,

    "cuota_total"   DECIMAL(12, 2) NOT NULL,
    "importe_total" DECIMAL(12, 2) NOT NULL,

    -- TEXT y no CHAR(64): `CHAR` rellena con espacios y los ignora al
    -- comparar, así que una huella con basura al final se leería como
    -- válida. La longitud la fija el CHECK de abajo.
    "huella"           TEXT NOT NULL,
    "huella_anterior"  TEXT,
    "primer_registro"  BOOLEAN  NOT NULL,

    -- LA MARCA DE TIEMPO QUE CUENTA, como TEXTO y no como timestamptz.
    --
    -- El huso forma parte del dato («El huso horario es el que está usando
    -- el sistema informático de facturación en el momento de generar el
    -- registro», anexo). Un `timestamptz` lo normaliza a UTC, y entonces
    -- la huella —que se calculó sobre el texto con su huso— ya no se puede
    -- recalcular. El instante, cuando hace falta, se deriva.
    "fecha_hora_huso_gen" TEXT NOT NULL,

    -- La cadena EXACTA sobre la que se aplicó SHA-256. Redundante a
    -- propósito: es lo que permite verificar la huella sin volver a
    -- formatear ni un importe, dentro del propio motor (pieza 5).
    "huella_input" TEXT NOT NULL,

    -- El registro completo tal y como lo generó el dispositivo. Es lo que
    -- V2 remitirá, SIN TOCARLO. La FAQ §5 prohíbe expresamente «un
    -- reproceso posterior de los mismos (que los altere) desde el servidor
    -- Back Office central».
    "payload" JSONB NOT NULL,

    "ticket_id"       UUID,
    "anula_record_id" UUID,
    "device_id"       UUID,

    -- Reloj del dispositivo y reloj del servidor. «Generado sin conexión»
    -- se DERIVA de la distancia entre los dos y no se guarda como flag: un
    -- flag puede quedar desincronizado de lo que lo justifica (lección de
    -- F1).
    "generated_at" TIMESTAMPTZ NOT NULL,
    "received_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Lo decide el servidor AL INSERTAR y no se toca después. Si fuera
    -- actualizable, el trigger append-only tendría una puerta, y una puerta
    -- en una tabla cuyo valor entero es no tener puertas no se paga.
    "chain_status" "FiscalChainStatus" NOT NULL,
    "chain_error"  TEXT,

    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "fiscal_records_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- Restrict y no Cascade: borrar una caja no se lleva por delante las
    -- facturas que emitió. Igual que `tickets.register_id`.
    CONSTRAINT "fiscal_records_register_id_fkey"
        FOREIGN KEY ("register_id") REFERENCES "registers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fiscal_records_ticket_id_fkey"
        FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fiscal_records_anula_record_id_fkey"
        FOREIGN KEY ("anula_record_id") REFERENCES "fiscal_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fiscal_records_device_id_fkey"
        FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE,

    CONSTRAINT "fiscal_records_chain_index_positive" CHECK ("chain_index" >= 1),
    CONSTRAINT "fiscal_records_numero_positive"      CHECK ("numero" >= 1),
    CONSTRAINT "fiscal_records_serie_not_blank"      CHECK (btrim("serie") <> ''),
    -- Hexadecimal en MAYÚSCULAS, 64 caracteres (v0.1.2 §5). Lo comprueba la
    -- base: una huella en minúsculas se compara distinto y la AEAT la
    -- rechazaría con «Aceptado con errores».
    CONSTRAINT "fiscal_records_huella_format"
        CHECK ("huella" ~ '^[0-9A-F]{64}$'),
    CONSTRAINT "fiscal_records_huella_anterior_format"
        CHECK ("huella_anterior" IS NULL OR "huella_anterior" ~ '^[0-9A-F]{64}$'),
    -- El primer registro no tiene anterior, y el que tiene anterior no es
    -- el primero. Las dos cosas a la vez, o ninguna.
    CONSTRAINT "fiscal_records_primer_registro_coherente"
        CHECK ("primer_registro" = ("huella_anterior" IS NULL)),
    -- Formato del anexo: `YYYY-MM-DDThh:mm:ss±hh:mm`, al segundo.
    CONSTRAINT "fiscal_records_fecha_hora_huso_format"
        CHECK ("fecha_hora_huso_gen" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$'),
    -- Una anulación apunta a lo que anula (o declara que no existía); un
    -- alta nunca apunta a nada.
    CONSTRAINT "fiscal_records_anula_solo_anulacion"
        CHECK ("kind" = 'ANULACION' OR "anula_record_id" IS NULL),
    -- Un registro que no encadena tiene que decir por qué, y uno que
    -- encadena no tiene nada que explicar.
    CONSTRAINT "fiscal_records_chain_error_coherente"
        CHECK (("chain_status" = 'BROKEN') = ("chain_error" IS NOT NULL))
);

CREATE UNIQUE INDEX "fiscal_records_external_id_key"
    ON "fiscal_records"("external_id");

-- LA CADENA. Dos registros no pueden ocupar la misma posición.
CREATE UNIQUE INDEX "fiscal_records_register_id_chain_index_key"
    ON "fiscal_records"("register_id", "chain_index");

-- LA NUMERACIÓN. «La numeración de las facturas simplificadas dentro de
-- cada serie será correlativa» (art. 7.1.a RD 1619/2012). Los huecos los
-- detecta la verificación; los DUPLICADOS los impide la base.
CREATE UNIQUE INDEX "fiscal_records_register_serie_numero_key"
    ON "fiscal_records"("register_id", "serie", "numero")
    WHERE "kind" = 'ALTA';

-- Una factura se anula UNA vez. Sin `WHERE ... IS NOT NULL`: en Postgres un
-- índice único ya deja repetir NULLs, así que el índice parcial y el
-- completo dicen exactamente lo mismo aquí — y el completo SÍ lo expresa
-- Prisma (`@unique`), con lo que el nombre y la definición coinciden con lo
-- que generaría un `migrate dev` y no lo ve como sobrante.
CREATE UNIQUE INDEX "fiscal_records_anula_record_id_key"
    ON "fiscal_records"("anula_record_id");

CREATE INDEX "fiscal_records_tenant_id_received_at_idx"
    ON "fiscal_records"("tenant_id", "received_at");
CREATE INDEX "fiscal_records_ticket_id_idx"
    ON "fiscal_records"("ticket_id");
CREATE INDEX "fiscal_records_device_id_idx"
    ON "fiscal_records"("device_id");
-- El super-admin lista lo que no encadena. Índice parcial porque lo normal
-- es que no haya ninguno.
CREATE INDEX "fiscal_records_broken_idx"
    ON "fiscal_records"("tenant_id", "received_at")
    WHERE "chain_status" = 'BROKEN';

-- ── 4 · los triggers ───────────────────────────────────────────────────

-- El registro de facturación NO SE EDITA Y NO SE BORRA. Ni por la API, ni
-- por el panel, ni por el super-admin, ni a mano.
--
-- Aquí no hay vía de corrección, y esa ausencia es deliberada: S1 tiene
-- `record_ticket_correction` y F1 tiene `record_time_entry_correction`
-- porque un importe mal tecleado y una hora olvidada son errores humanos
-- que hay que poder arreglar dejando traza. Un registro de facturación no
-- se arregla: se anula y se emite otro. Lo dice la propia norma, y es la
-- razón de ser del registro de anulación.
--
-- Una sola escapatoria, comprobada contra el estado real y no contra una
-- promesa: el tenant ya no existe, así que esto es la cascada de su borrado.
CREATE FUNCTION mipiacetpv_fiscal_records_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
        RETURN OLD;   -- cascada del borrado del tenant
    END IF;
    RAISE EXCEPTION
        'REGISTRO_FISCAL_VIOLADO: un registro de facturación no se % (registro %, caja %, posición %). Una factura emitida se anula con un registro de anulación, nunca se reescribe.',
        CASE TG_OP WHEN 'DELETE' THEN 'borra' ELSE 'modifica' END,
        OLD.id, OLD.register_id, OLD.chain_index
        USING ERRCODE = '23514';
END;
$fn$;

CREATE TRIGGER "fiscal_records_append_only"
    BEFORE UPDATE OR DELETE ON "fiscal_records"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_fiscal_records_append_only();

-- La identidad fiscal de una caja se fija ANTES de emitir y no se mueve
-- después. Cambiar la serie con la cadena viva es cambiar el número de las
-- facturas ya emitidas; cambiar el número de instalación es decir que
-- aquellas facturas las emitió otro SIF.
CREATE FUNCTION mipiacetpv_registers_fiscal_identity_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF NEW.fiscal_series IS NOT DISTINCT FROM OLD.fiscal_series
       AND NEW.fiscal_installation_id IS NOT DISTINCT FROM OLD.fiscal_installation_id THEN
        RETURN NEW;
    END IF;
    IF EXISTS (SELECT 1 FROM fiscal_records WHERE register_id = OLD.id) THEN
        RAISE EXCEPTION
            'REGISTRO_FISCAL_VIOLADO: la caja % ya ha emitido facturas; su serie y su número de instalación no se cambian.',
            OLD.id USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$fn$;

CREATE TRIGGER "registers_fiscal_identity_guard"
    BEFORE UPDATE ON "registers"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_registers_fiscal_identity_guard();

-- Un ticket que tiene factura emitida no se borra.
--
-- S1 ya lo impide para los tickets sellados, con dos escapatorias: el
-- cajero técnico TEST y la cascada del borrado del tenant. La primera aquí
-- no puede valer: si se emitió factura, hay factura, y da igual qué cajero
-- la hizo. (La FK RESTRICT de `fiscal_records.ticket_id` ya lo pararía;
-- este trigger existe para que el mensaje diga qué ha pasado en vez de
-- hablar de una clave ajena.)
CREATE FUNCTION mipiacetpv_tickets_fiscal_link_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
        RETURN OLD;   -- cascada del borrado del tenant
    END IF;
    IF EXISTS (SELECT 1 FROM fiscal_records WHERE ticket_id = OLD.id) THEN
        RAISE EXCEPTION
            'REGISTRO_FISCAL_VIOLADO: el ticket % tiene factura emitida y no se borra. Se anula con un registro de anulación.',
            OLD.id USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
END;
$fn$;

CREATE TRIGGER "tickets_fiscal_link_guard"
    BEFORE DELETE ON "tickets"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_tickets_fiscal_link_guard();

-- ── 5 · la verificación de la cadena ───────────────────────────────────
--
-- Recorre la cadena de una caja en orden y dice, registro a registro, si
-- está íntegra. Lo hace EL MOTOR y no la aplicación: Postgres 16 trae
-- `sha256(bytea)` nativo, así que la huella se recalcula aquí mismo desde
-- `huella_input`. Es la misma tesis de ADR-015 §4.2 y de ADR-018 — la
-- garantía no puede depender de que ninguna ruta se porte bien.
--
-- Cuatro preguntas por registro, y las cuatro independientes:
--
--   huella_ok      ¿la huella declarada es la de su propio contenido?
--   input_ok       ¿la cadena de entrada dice la huella anterior que el
--                  registro declara? (detecta que alguien cambie una sin
--                  la otra)
--   enlace_ok      ¿esa huella anterior es la del registro que ocupa la
--                  posición de antes?
--   numeracion_ok  ¿el número de la factura es el siguiente de la serie,
--                  sin huecos?
--
-- No modifica nada: su salida es una consulta. Si escribiera `chain_status`
-- sería una puerta en la tabla append-only.
CREATE FUNCTION mipiacetpv_verify_fiscal_chain(p_register_id uuid)
RETURNS TABLE (
    chain_index       integer,
    record_id         uuid,
    kind              "FiscalRecordKind",
    num_serie_factura text,
    huella_ok         boolean,
    input_ok          boolean,
    enlace_ok         boolean,
    numeracion_ok     boolean,
    chain_status      "FiscalChainStatus"
)
LANGUAGE sql STABLE AS $fn$
    WITH ordenados AS (
        SELECT f.*,
               lag(f.huella)      OVER (ORDER BY f.chain_index) AS huella_previa,
               lag(f.chain_index) OVER (ORDER BY f.chain_index) AS chain_index_previo,
               -- Cuántas altas van hasta aquí incluida. Es el número que le
               -- toca a esta factura si la serie no tiene huecos.
               -- (`count(...) FILTER` sí admite ventana; `lag(...) FILTER`
               -- no: FILTER sólo existe para funciones de agregación.)
               count(*) FILTER (WHERE f.kind = 'ALTA')
                   OVER (ORDER BY f.chain_index
                         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
                   AS numero_esperado
          FROM fiscal_records f
         WHERE f.register_id = p_register_id
    )
    SELECT o.chain_index,
           o.id,
           o.kind,
           o.num_serie_factura,
           upper(encode(sha256(convert_to(o.huella_input, 'UTF8')), 'hex')) = o.huella,
           -- El primer registro lleva `Huella=&` en su cadena de entrada;
           -- el resto, la huella del anterior entre `Huella=` y `&`.
           CASE WHEN o.huella_anterior IS NULL
                THEN o.huella_input LIKE '%&Huella=&%'
                ELSE o.huella_input LIKE '%&Huella=' || o.huella_anterior || '&%'
           END,
           CASE WHEN o.chain_index = 1
                THEN o.huella_anterior IS NULL AND o.primer_registro
                ELSE o.chain_index_previo = o.chain_index - 1
                     AND o.huella_anterior = o.huella_previa
           END,
           CASE WHEN o.kind <> 'ALTA' THEN true
                ELSE o.numero = o.numero_esperado
           END,
           o.chain_status
      FROM ordenados o
     ORDER BY o.chain_index;
$fn$;

-- El resumen de una caja en una fila, para el super-admin y para el script
-- del VPS: ¿está íntegra, y si no, dónde se rompe por primera vez?
CREATE FUNCTION mipiacetpv_fiscal_chain_summary(p_register_id uuid)
RETURNS TABLE (
    total               bigint,
    integra             boolean,
    primer_fallo_index  integer,
    marcados_broken     bigint
)
LANGUAGE sql STABLE AS $fn$
    SELECT count(*),
           coalesce(bool_and(v.huella_ok AND v.input_ok AND v.enlace_ok
                             AND v.numeracion_ok AND v.chain_status = 'OK'), true),
           min(v.chain_index) FILTER (
               WHERE NOT (v.huella_ok AND v.input_ok AND v.enlace_ok AND v.numeracion_ok)
                  OR v.chain_status <> 'OK'),
           count(*) FILTER (WHERE v.chain_status = 'BROKEN')
      FROM mipiacetpv_verify_fiscal_chain(p_register_id) v;
$fn$;
