-- B-reservas-8 · Bonos de sesiones: el libro, la puerta de canje y la
-- sesión apartada en la cita. ADR-R9.
--
-- ── Qué añade, y nada más ──────────────────────────────────────────────
--
-- Migración ADITIVA. Cuatro tablas nuevas, dos columnas en tablas vivas
-- (`tickets.client_id` y la clave ajena de `appointments.voucher_id`, que
-- existía suelta desde B4) y cinco ajustes de `tenants`. Con
-- `bonos_enabled = false` —el default, y el valor de los quince tenants de
-- hoy— **este bloque no existe**: ni una fila, ni una consulta, ni un
-- cambio de comportamiento en ninguna venta.
--
-- ── Lo que vive AQUÍ y no en el código, y por qué ──────────────────────
--
--   1. `tenants_bonos_sin_holded` — no se enciende el módulo con Holded
--      conectado. Hay cuatro puertas de escritura a `tenants` (el panel, el
--      super-admin, el fichero de implantación y el psql de una tarde) y
--      sólo el motor cubre las cuatro. Misma lección que
--      `products_exencion_sin_iva`.
--   2. `voucher_movements_signo_por_tipo` — EL CONVENIO DEL SIGNO. Es la
--      razón por la que `libres = SUM(sesiones)` no se puede escribir mal,
--      y por la que el invariante del libro no puede desalinearse sin que
--      la base rechace la fila. Ver la cabecera de `VoucherMovement` en
--      `schema.prisma`.
--   3. `voucher_movements_append_only` — el libro es de solo inserción,
--      con el mismo patrón que `fiscal_records` y `client_consents`.
--   4. `vouchers_saldo_coherente` — las columnas derivadas no pueden
--      quedar en un estado imposible (negativas, o sumando más que el
--      total). No sustituye al test del invariante: lo acota.
--
-- Los enums son TEXTO CON CHECK y no `enum` de Postgres, por la factura ya
-- pagada tres veces en clinica-1, -2 y -3: un enum sólo crece (`ALTER TYPE
-- … DROP VALUE` no existe) y **no se puede usar un valor nuevo en la misma
-- transacción en la que se añade**, así que cada valor nuevo partiría la
-- migración en dos. B-cheques y B-13 añaden tipos a este libro.
--
-- CONSECUENCIA A VIGILAR, la de siempre: `prisma migrate dev` verá los
-- CHECK y el trigger como deriva y ofrecerá borrarlos. **NO aceptar.** El
-- guardia es `apps/api/test/bonos-migracion.test.ts`, que guarda el
-- contrato de este SQL para que la pérdida salga en rojo.
--
-- ── Vuelta atrás ───────────────────────────────────────────────────────
--
-- Reversible del todo mientras las tablas nuevas estén vacías. Con bonos
-- vendidos dentro, el `down` ES el borrado de una deuda del centro con sus
-- clientas: se hace con copia delante y por decisión escrita, no encadenado
-- en un despliegue.
--
--   DROP TRIGGER "voucher_movements_append_only" ON "voucher_movements";
--   DROP FUNCTION mipiacetpv_voucher_movements_append_only();
--   DROP TABLE "voucher_movements";
--   DROP TABLE "voucher_sequence";
--   ALTER TABLE "appointments" DROP CONSTRAINT "appointments_voucher_id_fkey";
--   DROP TABLE "vouchers";
--   DROP TABLE "voucher_templates";
--   ALTER TABLE "tickets"
--       DROP CONSTRAINT "tickets_client_id_fkey",
--       DROP COLUMN "client_id";
--   ALTER TABLE "tenants"
--       DROP CONSTRAINT "tenants_bonos_sin_holded",
--       DROP CONSTRAINT "tenants_bono_no_show_valido",
--       DROP CONSTRAINT "tenants_bono_modo_canje_valido",
--       DROP CONSTRAINT "tenants_bono_caducidad_meses_valida",
--       DROP COLUMN "bonos_enabled", DROP COLUMN "bono_no_show",
--       DROP COLUMN "bono_etiqueta", DROP COLUMN "bono_modo_canje",
--       DROP COLUMN "bono_caducidad_meses";

-- ── 1 · los ajustes del centro ─────────────────────────────────────────

ALTER TABLE "tenants"
    ADD COLUMN "bonos_enabled"        BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "bono_no_show"         TEXT    NOT NULL DEFAULT 'consumir',
    ADD COLUMN "bono_etiqueta"        VARCHAR(20) NOT NULL DEFAULT 'bono',
    ADD COLUMN "bono_modo_canje"      TEXT    NOT NULL DEFAULT 'LINEA_CERO',
    ADD COLUMN "bono_caducidad_meses" INTEGER;

-- Decisión de Dirección (18-10): sólo en cuentas SIN Holded en esta
-- versión. Un ticket de canje a 0 € subido a Holded es terreno desconocido
-- y no lo necesita nadie hoy.
--
-- `holded_enabled` es `DEFAULT true` y se lee `= false`, nunca
-- `NOT holded_enabled` (criterio del propio schema para esa columna). Aquí
-- el CHECK dice lo mismo en positivo: o el módulo está apagado, o Holded lo
-- está. Ninguno de los dos lados es NULL (las dos columnas son NOT NULL),
-- así que este CHECK no puede evaluar a NULL y colarse —que es exactamente
-- el fallo de `check-null-pasa`.
ALTER TABLE "tenants"
    ADD CONSTRAINT "tenants_bonos_sin_holded"
    CHECK ("bonos_enabled" = false OR "holded_enabled" = false);

ALTER TABLE "tenants"
    ADD CONSTRAINT "tenants_bono_no_show_valido"
    CHECK ("bono_no_show" IN ('consumir', 'liberar'));

ALTER TABLE "tenants"
    ADD CONSTRAINT "tenants_bono_modo_canje_valido"
    CHECK ("bono_modo_canje" IN ('LINEA_CERO', 'PRORRATEO'));

-- Meses de CALENDARIO. NULL = sin caducidad (el default del bloque).
-- `IS NULL OR` delante del rango: un CHECK que evalúa a NULL PASA, así que
-- el rango nunca se escribe suelto en esta casa.
ALTER TABLE "tenants"
    ADD CONSTRAINT "tenants_bono_caducidad_meses_valida"
    CHECK ("bono_caducidad_meses" IS NULL
           OR ("bono_caducidad_meses" >= 1 AND "bono_caducidad_meses" <= 120));

-- ── 2 · la ficha del CRM en la venta ───────────────────────────────────
--
-- Hasta hoy un ticket sólo sabía de `contact_holded_id`, el contacto de
-- HOLDED, y este módulo vive exactamente en las cuentas que NO tienen
-- Holded. Sin esta columna no hay forma de saber a quién se le vende un
-- bono ni de proponer el bono de una clienta en un ticket suelto (el canje
-- sin cita de la peluquería sin agenda).

ALTER TABLE "tickets" ADD COLUMN "client_id" UUID;

ALTER TABLE "tickets"
    ADD CONSTRAINT "tickets_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- «Las ventas de esta clienta», que es la consulta de la ficha. Nombre
-- según la convención de Prisma para que el schema lo pueda declarar y no
-- quede como deriva.
CREATE INDEX "tickets_tenant_id_client_id_idx" ON "tickets" ("tenant_id", "client_id");

-- ── 3 · la plantilla de bono de un producto ────────────────────────────

CREATE TABLE "voucher_templates" (
    "id"                 UUID NOT NULL,
    "tenant_id"          UUID NOT NULL,
    "product_id"         UUID NOT NULL,
    "sessions"           INTEGER NOT NULL,
    "covers_service_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "covers_tag_slugs"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "expires_months"     INTEGER,
    "created_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "voucher_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "voucher_templates_product_id_key"
    ON "voucher_templates" ("product_id");
CREATE INDEX "voucher_templates_tenant_id_idx"
    ON "voucher_templates" ("tenant_id");

ALTER TABLE "voucher_templates"
    ADD CONSTRAINT "voucher_templates_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "voucher_templates"
    ADD CONSTRAINT "voucher_templates_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Un bono de cero sesiones no es un bono. Y la caducidad, en meses de
-- calendario, con su `IS NULL OR` delante.
ALTER TABLE "voucher_templates"
    ADD CONSTRAINT "voucher_templates_sessions_positivo"
    CHECK ("sessions" >= 1);

ALTER TABLE "voucher_templates"
    ADD CONSTRAINT "voucher_templates_expires_months_valido"
    CHECK ("expires_months" IS NULL
           OR ("expires_months" >= 1 AND "expires_months" <= 120));

-- Una plantilla que no cubre NADA no se puede canjear nunca: es un bono que
-- la clienta paga y no sirve para ningún servicio. O servicios, o
-- categorías, o las dos — pero algo.
ALTER TABLE "voucher_templates"
    ADD CONSTRAINT "voucher_templates_cubre_algo"
    CHECK (cardinality("covers_service_ids") > 0
           OR cardinality("covers_tag_slugs") > 0);

-- ── 4 · el bono ────────────────────────────────────────────────────────

CREATE TABLE "vouchers" (
    "id"                  UUID NOT NULL,
    "tenant_id"           UUID NOT NULL,
    "client_id"           UUID NOT NULL,
    "code"                TEXT NOT NULL,
    "number"              INTEGER NOT NULL,
    "template_id"         UUID,
    "type"                TEXT NOT NULL DEFAULT 'SESSIONS',
    "sessions_total"      INTEGER NOT NULL,
    "sessions_left"       INTEGER NOT NULL,
    "sessions_reserved"   INTEGER NOT NULL DEFAULT 0,
    "amount_total_cents"  INTEGER,
    "amount_left_cents"   INTEGER,
    "covers_service_ids"  UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "covers_tag_slugs"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "name_snapshot"       TEXT NOT NULL,
    "valor_carta_cents"   INTEGER NOT NULL,
    "cobrado_cents"       INTEGER NOT NULL,
    "sold_ticket_id"      UUID,
    "sold_ticket_line_id" UUID,
    "expires_at"          TIMESTAMPTZ,
    "status"              TEXT NOT NULL DEFAULT 'ACTIVO',
    "origen"              TEXT NOT NULL,
    "es_prueba"           BOOLEAN NOT NULL DEFAULT false,
    "created_at"          TIMESTAMPTZ NOT NULL,
    "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vouchers_tenant_id_code_key"
    ON "vouchers" ("tenant_id", "code");
CREATE UNIQUE INDEX "vouchers_tenant_id_number_key"
    ON "vouchers" ("tenant_id", "number");
CREATE INDEX "vouchers_tenant_id_client_id_status_idx"
    ON "vouchers" ("tenant_id", "client_id", "status");
CREATE INDEX "vouchers_tenant_id_status_idx"
    ON "vouchers" ("tenant_id", "status");

ALTER TABLE "vouchers"
    ADD CONSTRAINT "vouchers_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- `RESTRICT` y no `CASCADE`: una ficha con un bono vivo NO se borra. El
-- bono es una deuda del centro con ESA persona, y borrar la ficha sería
-- perder a quién se le deben las sesiones.
ALTER TABLE "vouchers"
    ADD CONSTRAINT "vouchers_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vouchers"
    ADD CONSTRAINT "vouchers_template_id_fkey"
    FOREIGN KEY ("template_id") REFERENCES "voucher_templates"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- `CASCADE`: el bono vendido en un ticket `TEST` se va con su ticket en el
-- reseteo del ensayo (ADR-021 §5.1), sin una línea de código que lo busque.
-- Un ticket SELLADO no se puede borrar (trigger `tickets_delete_guard`), así
-- que esta cascada sólo se dispara donde debe.
ALTER TABLE "vouchers"
    ADD CONSTRAINT "vouchers_sold_ticket_id_fkey"
    FOREIGN KEY ("sold_ticket_id") REFERENCES "tickets"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- FK dura SIN relación Prisma (mismo criterio que
-- `appointment_items_service_id_fkey`): es un puntero de auditoría y no
-- merece una back-ref en `TicketLine`.
ALTER TABLE "vouchers"
    ADD CONSTRAINT "vouchers_sold_ticket_line_id_fkey"
    FOREIGN KEY ("sold_ticket_line_id") REFERENCES "ticket_lines"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "vouchers"
    ADD CONSTRAINT "vouchers_status_valido"
    CHECK ("status" IN ('ACTIVO', 'AGOTADO', 'CADUCADO', 'ANULADO'));

ALTER TABLE "vouchers"
    ADD CONSTRAINT "vouchers_origen_valido"
    CHECK ("origen" IN ('VENTA', 'ALTA_INICIAL'));

ALTER TABLE "vouchers"
    ADD CONSTRAINT "vouchers_type_valido"
    CHECK ("type" IN ('SESSIONS', 'AMOUNT'));

-- B-cheques es ADITIVO sobre esta tabla, no un rediseño: un bono de
-- sesiones no lleva importes de saldo y un cheque por importe no lleva
-- sesiones. Mientras `type = 'SESSIONS'` sea lo único que se escribe, las
-- dos columnas de importe se quedan NULL y nadie las lee.
ALTER TABLE "vouchers"
    ADD CONSTRAINT "vouchers_tipo_coherente"
    CHECK (
      ("type" = 'SESSIONS'
         AND "amount_total_cents" IS NULL
         AND "amount_left_cents"  IS NULL)
      OR
      ("type" = 'AMOUNT'
         AND "sessions_total" = 0
         AND "sessions_left" = 0
         AND "sessions_reserved" = 0
         AND "amount_total_cents" IS NOT NULL
         AND "amount_left_cents"  IS NOT NULL)
    );

-- Las columnas derivadas no pueden quedar en un estado imposible. NO
-- sustituye al test del invariante contra el libro (ése recorre 200
-- operaciones aleatorias): lo acota, para que un error de aritmética muera
-- en la escritura y no tres semanas después en un informe.
ALTER TABLE "vouchers"
    ADD CONSTRAINT "vouchers_saldo_coherente"
    CHECK ("sessions_total" >= 0
           AND "sessions_left" >= 0
           AND "sessions_reserved" >= 0
           AND "sessions_left" + "sessions_reserved" <= "sessions_total");

-- Dinero y deuda, los dos en céntimos y ninguno negativo. `cobrado_cents`
-- puede ser 0 (un bono regalado) y `valor_carta_cents` no: un bono que no
-- vale nada no es una deuda.
ALTER TABLE "vouchers"
    ADD CONSTRAINT "vouchers_dinero_valido"
    CHECK ("valor_carta_cents" >= 0 AND "cobrado_cents" >= 0);

-- Un bono de VENTA tiene ticket; uno de ALTA_INICIAL (el de papel) no lo
-- tiene nunca —y por eso no se le inventa uno.
ALTER TABLE "vouchers"
    ADD CONSTRAINT "vouchers_origen_coherente"
    CHECK (("origen" = 'VENTA' AND "sold_ticket_id" IS NOT NULL)
           OR ("origen" = 'ALTA_INICIAL' AND "sold_ticket_id" IS NULL));

-- La cobertura CONGELADA tiene que cubrir algo, por lo mismo que la
-- plantilla.
ALTER TABLE "vouchers"
    ADD CONSTRAINT "vouchers_cubre_algo"
    CHECK ("type" <> 'SESSIONS'
           OR cardinality("covers_service_ids") > 0
           OR cardinality("covers_tag_slugs") > 0);

-- ── 5 · la clave ajena que `appointments.voucher_id` nunca tuvo ────────
--
-- La columna existe desde B4 («sólo la columna»). Desde hoy apunta de
-- verdad. `SET NULL`: si el bono desaparece —y el único caso real es el
-- reseteo del ensayo— la cita se queda como una cita normal, que es la
-- verdad. No se borra la cita.

ALTER TABLE "appointments"
    ADD CONSTRAINT "appointments_voucher_id_fkey"
    FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- «¿Qué citas apartaron de este bono?», que es la traza de la ficha. Sin
-- `WHERE voucher_id IS NOT NULL`: un índice parcial sería más pequeño pero
-- Prisma 5 no lo expresa, y esta casa ya arrastra dos índices parciales que
-- `migrate dev` ofrece borrar en cada despliegue. No se añade un tercero
-- por unos kilobytes.
CREATE INDEX "appointments_tenant_id_voucher_id_idx"
    ON "appointments" ("tenant_id", "voucher_id");

-- ── 6 · el libro ───────────────────────────────────────────────────────

CREATE TABLE "voucher_movements" (
    "id"             UUID NOT NULL,
    "tenant_id"      UUID NOT NULL,
    "voucher_id"     UUID NOT NULL,
    "tipo"           TEXT NOT NULL,
    "sesiones"       INTEGER NOT NULL,
    "appointment_id" UUID,
    "ticket_line_id" UUID,
    "compensa_a"     UUID,
    "detalle"        TEXT NOT NULL,
    "motivo"         TEXT,
    "canal"          TEXT NOT NULL,
    "user_id"        UUID,
    "actor"          TEXT,
    "es_prueba"      BOOLEAN NOT NULL DEFAULT false,
    "created_at"     TIMESTAMPTZ NOT NULL,

    CONSTRAINT "voucher_movements_pkey" PRIMARY KEY ("id")
);

-- El libro de un bono, en orden. `id` desempata: apartar y consumir pueden
-- caer en el mismo milisegundo y tienen que salir siempre igual ordenados.
CREATE INDEX "voucher_movements_voucher_id_created_at_id_idx"
    ON "voucher_movements" ("voucher_id", "created_at", "id");
CREATE INDEX "voucher_movements_tenant_id_created_at_idx"
    ON "voucher_movements" ("tenant_id", "created_at");
-- La idempotencia de `consumir` / `liberar` se decide leyendo el libro por
-- cita, así que esta consulta corre en cada cobro y en cada anulación.
CREATE INDEX "voucher_movements_tenant_id_appointment_id_idx"
    ON "voucher_movements" ("tenant_id", "appointment_id");

ALTER TABLE "voucher_movements"
    ADD CONSTRAINT "voucher_movements_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "voucher_movements"
    ADD CONSTRAINT "voucher_movements_voucher_id_fkey"
    FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- La compensación apunta a una línea del MISMO libro.
ALTER TABLE "voucher_movements"
    ADD CONSTRAINT "voucher_movements_compensa_a_fkey"
    FOREIGN KEY ("compensa_a") REFERENCES "voucher_movements"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- `appointment_id` y `ticket_line_id` NO llevan clave ajena, y es una
-- decisión. Un libro de solo inserción tiene que sobrevivir a lo que
-- apunta: un `ON DELETE SET NULL` sería un UPDATE sobre la fila y el propio
-- trigger de abajo lo rechazaría, y un `RESTRICT` dejaría el borrado del
-- tenant dependiendo del orden en que se resuelvan las cascadas. Son
-- punteros de auditoría y el único que los escribe es la puerta
-- (`apps/api/src/vouchers/gate.ts`).

ALTER TABLE "voucher_movements"
    ADD CONSTRAINT "voucher_movements_tipo_valido"
    CHECK ("tipo" IN ('VENDIDO', 'ALTA_INICIAL', 'APARTADA', 'LIBERADA',
                      'CONSUMIDA', 'CORRECCION', 'CADUCIDAD_CAMBIADA',
                      'ANULADO'));

ALTER TABLE "voucher_movements"
    ADD CONSTRAINT "voucher_movements_canal_valido"
    CHECK ("canal" IN ('tpv', 'panel', 'web', 'migracion'));

-- EL CONVENIO DEL SIGNO, en la base.
--
-- `sesiones` es el efecto de la línea sobre las sesiones LIBRES, así que
-- `libres = SUM(sesiones)` es una sola suma sobre el libro del bono y no se
-- puede escribir mal. La última rama es la que lo cierra: una `CONSUMIDA`
-- vale 0 **exactamente cuando** viene de una cita (la sesión ya salió de
-- libres al apartarse) y -1 cuando no (el canje en caja sin agenda, que no
-- pasa por APARTADA). Las dos partes de esa equivalencia son NOT NULL o
-- `IS NOT NULL`, así que ninguna rama puede evaluar a NULL y colarse.
ALTER TABLE "voucher_movements"
    ADD CONSTRAINT "voucher_movements_signo_por_tipo"
    CHECK (
      CASE "tipo"
        WHEN 'VENDIDO'            THEN "sesiones" > 0
        WHEN 'ALTA_INICIAL'       THEN "sesiones" > 0
        WHEN 'APARTADA'           THEN "sesiones" = -1
        WHEN 'LIBERADA'           THEN "sesiones" = 1
        WHEN 'CORRECCION'         THEN "sesiones" <> 0
        WHEN 'ANULADO'            THEN "sesiones" <= 0
        WHEN 'CADUCIDAD_CAMBIADA' THEN "sesiones" = 0
        WHEN 'CONSUMIDA'          THEN
          ("sesiones" = 0) = ("appointment_id" IS NOT NULL)
          AND "sesiones" IN (0, -1)
        ELSE false
      END
    );

-- Una APARTADA, una LIBERADA y una CONSUMIDA de cita SIEMPRE dicen de qué
-- cita hablan: es lo que hace idempotentes a `consumir()` y `liberar()`
-- —se deciden por el estado del libro, no por quién llamó primero— y lo que
-- deja la traza legible en la ficha.
ALTER TABLE "voucher_movements"
    ADD CONSTRAINT "voucher_movements_cita_cuando_toca"
    CHECK ("tipo" NOT IN ('APARTADA', 'LIBERADA')
           OR "appointment_id" IS NOT NULL);

-- El `motivo` es obligatorio cuando la línea CORRIGE, y es de lista
-- cerrada. Con `otro`, la nota va en `detalle` y es obligatoria — **sin
-- mínimo de caracteres oculto** (`07` pieza 5: un mínimo escondido bloqueó
-- una invitación real en el spa).
ALTER TABLE "voucher_movements"
    ADD CONSTRAINT "voucher_movements_motivo_valido"
    CHECK ("motivo" IS NULL
           OR "motivo" IN ('error_venta', 'cortesia', 'ajuste_alta_inicial', 'otro'));

ALTER TABLE "voucher_movements"
    ADD CONSTRAINT "voucher_movements_motivo_cuando_corrige"
    CHECK ("tipo" NOT IN ('CORRECCION', 'CADUCIDAD_CAMBIADA')
           OR "motivo" IS NOT NULL);

-- El `detalle` es la frase que lee recepción. Nunca vacía: un libro con
-- líneas sin texto es un libro que no se puede leer.
ALTER TABLE "voucher_movements"
    ADD CONSTRAINT "voucher_movements_detalle_no_vacio"
    CHECK (length(btrim("detalle")) > 0);

-- QUIÉN, siempre: una persona del centro (`user_id`) o un actor del sistema
-- («Web», «Migración»). Nunca las dos a la vez y nunca ninguna.
ALTER TABLE "voucher_movements"
    ADD CONSTRAINT "voucher_movements_quien"
    CHECK (("user_id" IS NOT NULL AND "actor" IS NULL)
           OR ("user_id" IS NULL AND "actor" IS NOT NULL));

-- ── 7 · el libro es de SOLO INSERCIÓN ──────────────────────────────────
--
-- Mismo patrón que `fiscal_records` (verifactu-1) y `client_consents`
-- (clinica-4), y con las escapatorias MEDIDAS CONTRA EL ESTADO REAL, no
-- contra «el padre ya no existe» —la rama que `20261017030000` tuvo que
-- quitar de cuatro guardias porque era una puerta abierta al lado del
-- candado.
--
-- Dos escapatorias, las dos de borrado y ninguna de edición:
--
--   1. **«Eliminar cuenta»** (ADR-021 §6): la transacción que pone
--      `SET LOCAL mipiacetpv.eliminar_tenant`. Es la única puerta.
--   2. **El reseteo del ensayo** (ADR-021 §5.1): una línea marcada
--      `es_prueba` se va con su bono y con su ticket. Es comprobable contra
--      el estado de la propia fila y es justo lo que `07` pieza 17 pide —lo
--      de prueba se marca, y lo marcado como prueba no es histórico de
--      nadie.
--
-- Un UPDATE no pasa NUNCA, por ningún camino. Para corregir una línea se
-- escribe otra contraria con `compensa_a` y su motivo.

CREATE FUNCTION mipiacetpv_voucher_movements_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        -- ADR-021 §6 · la eliminación de la cuenta entera.
        IF mipiacetpv_eliminando_este_tenant(OLD.tenant_id) THEN
            RETURN OLD;
        END IF;
        -- ADR-021 §5.1 · el reseteo del ensayo se lleva lo de prueba.
        IF OLD.es_prueba THEN
            RETURN OLD;
        END IF;
        RAISE EXCEPTION
            'LIBRO_VIOLADO: una línea del libro de bonos no se borra (movimiento %, bono %). Se corrige escribiendo una línea contraria con su motivo.',
            OLD.id, OLD.voucher_id USING ERRCODE = '23514';
    END IF;
    RAISE EXCEPTION
        'LIBRO_VIOLADO: una línea del libro de bonos no se edita (movimiento %, bono %). Dice qué pasó con una sesión y cuándo; para cambiarlo se escribe otra línea.',
        OLD.id, OLD.voucher_id USING ERRCODE = '23514';
END;
$fn$;

CREATE TRIGGER "voucher_movements_append_only"
    BEFORE UPDATE OR DELETE ON "voucher_movements"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_voucher_movements_append_only();

COMMENT ON TRIGGER "voucher_movements_append_only" ON "voucher_movements" IS
  'B-reservas-8 · el libro de bonos es de solo inserción. Se corrige con una línea contraria enlazada por compensa_a, nunca con un UPDATE.';

-- ── 8 · el contador de la numeración ───────────────────────────────────
--
-- Una fila por tenant. `arranque` a NULL es el CANDADO DE PRIMER USO: no se
-- emite ningún bono hasta que el encargado confirma en Ajustes por qué
-- número empieza el talonario (los centros con talonario de papel siguen su
-- numeración). El spa lo pagó al encontrarse un número que había llegado
-- desde dev.

CREATE TABLE "voucher_sequence" (
    "tenant_id"              UUID NOT NULL,
    "ultimo"                 INTEGER NOT NULL DEFAULT 0,
    "arranque"               INTEGER,
    "arranque_confirmado_at" TIMESTAMPTZ,
    "arranque_confirmado_by" UUID,
    "updated_at"             TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "voucher_sequence_pkey" PRIMARY KEY ("tenant_id")
);

ALTER TABLE "voucher_sequence"
    ADD CONSTRAINT "voucher_sequence_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "voucher_sequence"
    ADD CONSTRAINT "voucher_sequence_arranque_confirmado_by_fkey"
    FOREIGN KEY ("arranque_confirmado_by") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "voucher_sequence"
    ADD CONSTRAINT "voucher_sequence_ultimo_no_negativo"
    CHECK ("ultimo" >= 0);

-- El candado, en la base: o no hay arranque (candado puesto) o hay arranque
-- Y consta cuándo se confirmó. Un arranque sin fecha sería un candado que
-- alguien abrió sin dejar rastro.
ALTER TABLE "voucher_sequence"
    ADD CONSTRAINT "voucher_sequence_arranque_coherente"
    CHECK (("arranque" IS NULL AND "arranque_confirmado_at" IS NULL)
           OR ("arranque" IS NOT NULL AND "arranque_confirmado_at" IS NOT NULL
               AND "arranque" >= 1));
