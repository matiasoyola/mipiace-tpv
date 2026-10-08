-- kds-1-cocina · la pantalla de comandas en cocina.
--
-- ── QUÉ GARANTIZA ESTA MIGRACIÓN ──────────────────────────────────────
--
-- Una sola cosa, de la que se deriva todo lo demás: **el servidor sabe
-- cuántas unidades de cada línea ha recibido la cocina, en qué envío y
-- cuántas se anularon después**. Hasta hoy no lo sabía —
-- `dispatchKitchenTicket` reagrupaba TODAS las líneas del DRAFT en cada
-- envío y `ticket_lines` no tenía ninguna marca— así que un segundo
-- «Enviar» reimprimía la mesa entera. v2-H1 lo esquivó en el navegador
-- con un conjunto de ids en `localStorage`
-- (`apps/tpv-web/src/lib/kitchenSentLines.ts`) y lo dejó escrito como
-- carryover. Esto es el carryover.
--
-- ── MIGRACIÓN ADITIVA ─────────────────────────────────────────────────
--
-- Cinco tablas nuevas vacías y once columnas nuevas. Ni un DROP, ni un
-- DELETE, ni un UPDATE masivo. Todas las columnas nacen con default
-- constante o NULL, así que PG 11+ no reescribe ninguna tabla:
--
--   · `tenants.kitchen_display_enabled` FALSE  → ningún tenant de hoy
--     cambia de comportamiento: ni pantalla, ni banda «LISTO», ni eventos.
--   · `ticket_lines.sent_units` 0              → ver abajo, es el único
--     backfill con consecuencia, y es el prudente.
--   · `ticket_lines.course` 1, `seat` NULL     → todo es «tiempo 1, para
--     la mesa», que es como se comportaba el TPV.
--   · `products.allergens` '{}'                → «no informado», no «sin
--     alérgenos». La capa 3 se apaga sola donde no hay dato.
--   · `stores.kitchen_*`                       → los defaults de la
--     decisión 3 (10/20 min, ESPERA, ALERGIA, pitido apagado).
--
-- EL BACKFILL DE `sent_units`, dicho claro: queda **0 en todas las líneas
-- que ya existen**, también en las de mesas abiertas cuya comanda ya está
-- en la plancha. Consecuencia: la primera vez que se pulse «Enviar» en una
-- mesa que estaba abierta durante el despliegue, la cocina recibe esa mesa
-- entera otra vez. Es exactamente lo que pasa HOY en cada envío, así que
-- no es una regresión; y la alternativa —sembrar `sent_units = units`
-- donde `last_sent_at IS NOT NULL`— tiene el fallo contrario y peor:
-- daría por recibido lo que se añadió DESPUÉS del último envío y la cocina
-- no lo vería nunca. Se elige repetir antes que perder. Se despliega entre
-- servicios y se dice en el `-done`.
--
-- ── EL `down`, PENSADO ────────────────────────────────────────────────
--
--   DROP TABLE "kitchen_order_lines", "kitchen_orders", "kitchen_dispatches",
--              "ticket_courses", "ticket_allergies";
--   ALTER TABLE "ticket_lines" DROP COLUMN "sent_units", DROP COLUMN "course",
--                              DROP COLUMN "seat";
--   ALTER TABLE "products"      DROP COLUMN "allergens";
--   ALTER TABLE "devices"       DROP COLUMN "kitchen_sections";
--   ALTER TABLE "pairing_codes" DROP COLUMN "kind", DROP COLUMN "kitchen_sections";
--   ALTER TABLE "stores"        DROP COLUMN "kitchen_green_max_min", …;
--   ALTER TABLE "tenants"       DROP COLUMN "kitchen_display_enabled";
--
-- Lo irreversible lo dejó la migración anterior (`ALTER TYPE … ADD VALUE`
-- no se deshace). Aquí no hay nada que no se pueda tirar.
--
-- ── COPIA DE LA BASE ANTES DE APLICARLA EN PRODUCCIÓN ─────────────────
-- Lo pide el prompt y lo pide el sentido común: toca `ticket_lines`, que
-- es la tabla de la venta.

-- ──────────────────────────────────────────────────────────────────────
-- 1 · La capability del módulo «Cocina»
-- ──────────────────────────────────────────────────────────────────────
--
-- Se cobra POR PANTALLA (cocina + barra = dos), así que la mueve sólo el
-- super-admin, como `caja_enabled`, `fichaje_enabled` y
-- `clinical_records_enabled`. Por eso no entra en /admin/tenant/settings.
ALTER TABLE "tenants"
    ADD COLUMN "kitchen_display_enabled" BOOLEAN NOT NULL DEFAULT false;

-- ──────────────────────────────────────────────────────────────────────
-- 2 · Los ajustes de cocina, POR RESTAURANTE
-- ──────────────────────────────────────────────────────────────────────
--
-- En la TIENDA y no en el tenant: una cadena con un bar y un restaurante a
-- la carta necesita los dos modos a la vez. Lo que cambia de un local a
-- otro es configuración, no desarrollo.
ALTER TABLE "stores"
    ADD COLUMN "kitchen_green_max_min" INTEGER NOT NULL DEFAULT 10,
    ADD COLUMN "kitchen_amber_max_min" INTEGER NOT NULL DEFAULT 20,
    ADD COLUMN "kitchen_course_mode" "KitchenCourseMode" NOT NULL DEFAULT 'ESPERA',
    ADD COLUMN "kitchen_seat_mode" "KitchenSeatMode" NOT NULL DEFAULT 'ALERGIA',
    ADD COLUMN "kitchen_ready_beep" BOOLEAN NOT NULL DEFAULT false;

-- El semáforo tiene que ser un semáforo: verde por debajo de ámbar y los
-- dos por encima de cero. Con los umbrales cruzados el cocinero vería
-- tarjetas rojas a los dos minutos y no volvería a mirar el color — que es
-- lo único que la decisión 3 le pide leer de un vistazo.
--
-- En el MOTOR y no en el endpoint porque hay más de una puerta de
-- escritura (el panel del restaurante, y el psql de una implantación).
ALTER TABLE "stores"
    ADD CONSTRAINT "stores_kitchen_semaforo"
    CHECK ("kitchen_green_max_min" > 0
           AND "kitchen_amber_max_min" > "kitchen_green_max_min");

-- ──────────────────────────────────────────────────────────────────────
-- 3 · La pantalla de cocina como DISPOSITIVO
-- ──────────────────────────────────────────────────────────────────────
ALTER TABLE "devices"
    ADD COLUMN "kitchen_sections" "KitchenSection"[] NOT NULL DEFAULT '{}';

-- Una pantalla de cocina SIN secciones no enseñaría nada, y el fallo se
-- vería en el servicio y no al emparejar. Y al revés: un terminal de caja
-- con secciones es un emparejamiento mal hecho que hay que ver ya.
--
-- `cardinality()` y NO `array_length(…, 1)`, y lo encontró su propio test
-- e2e: **`array_length('{}', 1)` devuelve NULL, no 0**. Así que
-- `array_length(…) >= 1` sobre un array vacío es NULL, la rama entera es
-- NULL, `NULL OR false` es NULL — y un CHECK que evalúa a NULL SE
-- CONSIDERA SATISFECHO. O sea: el CHECK estaba escrito, se veía bien, y
-- dejaba entrar exactamente la fila que existía para prohibir.
-- `cardinality()` devuelve 0 para el array vacío y la comparación es real.
ALTER TABLE "devices"
    ADD CONSTRAINT "devices_kitchen_sections"
    CHECK (
        ("kind" = 'KITCHEN' AND cardinality("kitchen_sections") >= 1)
        OR ("kind" <> 'KITCHEN' AND cardinality("kitchen_sections") = 0)
    );

-- El GET de cocina pregunta «las pantallas vivas de esta tienda» para el
-- latido del TPV (decisión 9). Parcial: las pantallas son unas pocas entre
-- todos los dispositivos del tenant.
CREATE INDEX "devices_kitchen_idx"
    ON "devices"("register_id")
    WHERE "kind" = 'KITCHEN' AND "revoked_at" IS NULL;

-- ── El código de emparejamiento dice QUÉ se empareja ──────────────────
--
-- Y lo dice el código, no el aparato. Si `POST /devices/pair` aceptase
-- `kind` del cuerpo, cualquiera con un código de caja podría emparejarse
-- como pantalla de cocina; y una pantalla de cocina no releva al terminal,
-- así que el resultado sería una caja con dos aparatos vivos donde el
-- segundo no factura y nadie se enteró. La intención vive donde la pone
-- alguien autenticado.
ALTER TABLE "pairing_codes"
    ADD COLUMN "kind" "DeviceKind" NOT NULL DEFAULT 'TERMINAL',
    ADD COLUMN "kitchen_sections" "KitchenSection"[] NOT NULL DEFAULT '{}';

-- `cardinality()` por lo mismo que el de `devices`: con
-- `array_length('{}', 1)` el CHECK evalúa a NULL y Postgres lo considera
-- satisfecho.
ALTER TABLE "pairing_codes"
    ADD CONSTRAINT "pairing_codes_kitchen_sections"
    CHECK (
        ("kind" = 'KITCHEN' AND cardinality("kitchen_sections") >= 1)
        OR ("kind" <> 'KITCHEN' AND cardinality("kitchen_sections") = 0)
    );

-- ──────────────────────────────────────────────────────────────────────
-- 4 · LA INVARIANTE CENTRAL · lo que cocina ya tiene de cada línea
-- ──────────────────────────────────────────────────────────────────────
ALTER TABLE "ticket_lines"
    ADD COLUMN "sent_units" DECIMAL(10,3) NOT NULL DEFAULT 0,
    ADD COLUMN "course" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "seat" INTEGER;

-- El CHECK que de verdad trabaja. Un `sent_units > units` haría que el
-- siguiente envío calculase una diferencia NEGATIVA —o sea, nada— y la
-- cocina no vería un plato que el cliente ya pidió. Un `sent_units < 0`
-- haría lo contrario: mandar de más en cada envío.
ALTER TABLE "ticket_lines"
    ADD CONSTRAINT "ticket_lines_sent_units_range"
    CHECK ("sent_units" >= 0 AND "sent_units" <= "units");

ALTER TABLE "ticket_lines"
    ADD CONSTRAINT "ticket_lines_course_positive"
    CHECK ("course" >= 1);

-- La silla se numera desde 1. El techo (los comensales de la mesa) lo pone
-- la API y no la base: una mesa puede cambiar de comensales a mitad de
-- servicio y eso no puede invalidar filas ya escritas.
ALTER TABLE "ticket_lines"
    ADD CONSTRAINT "ticket_lines_seat_positive"
    CHECK ("seat" IS NULL OR "seat" >= 1);

-- ──────────────────────────────────────────────────────────────────────
-- 5 · Los alérgenos del producto (capa 3)
-- ──────────────────────────────────────────────────────────────────────
--
-- Vacío significa «NO INFORMADO», no «sin alérgenos». La capa 3 (el cruce
-- que grita «¡LLEVA GLUTEN!») se apaga sola donde no hay dato; las capas 1
-- y 2 —la alergia de la mesa y la silla del plato— siguen funcionando
-- igual. Un producto sin informar no puede hacer que la pantalla calle una
-- alergia que el camarero SÍ declaró.
ALTER TABLE "products"
    ADD COLUMN "allergens" "Allergen"[] NOT NULL DEFAULT '{}';

-- ──────────────────────────────────────────────────────────────────────
-- 6 · El envío · la unidad de IDEMPOTENCIA
-- ──────────────────────────────────────────────────────────────────────
--
-- Un «Enviar» puede crear dos tarjetas (cocina y barra), imprimir en una
-- tercera sección y marcar como enviada una cuarta sin destino. Si el
-- terminal pierde la respuesta y reintenta, las cuatro cosas tienen que
-- volver a pasar CERO veces y la respuesta tiene que ser la misma. Por eso
-- la llave está aquí y no en `kitchen_orders`: cubre el envío completo,
-- impresión incluida.
--
-- `result` guarda la respuesta literal que se dio. Mismo patrón que
-- `tickets.checkout_external_id`, con la respuesta persistida porque aquí
-- no hay un objeto final del que reconstruirla.
CREATE TABLE "kitchen_dispatches" (
    "id"              UUID PRIMARY KEY,
    "tenant_id"       UUID NOT NULL,
    "ticket_id"       UUID NOT NULL,
    "client_send_id"  UUID NOT NULL,
    "revision"        INTEGER NOT NULL,
    "urgent"          BOOLEAN NOT NULL DEFAULT false,
    "sent_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
    "sent_by_user_id" UUID NOT NULL,
    "result"          JSONB NOT NULL,

    CONSTRAINT "kitchen_dispatches_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
    CONSTRAINT "kitchen_dispatches_ticket_id_fkey"
        FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE,
    CONSTRAINT "kitchen_dispatches_sent_by_user_id_fkey"
        FOREIGN KEY ("sent_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "kitchen_dispatches_client_send_id_key"
    ON "kitchen_dispatches"("client_send_id");
CREATE INDEX "kitchen_dispatches_ticket_id_sent_at_idx"
    ON "kitchen_dispatches"("ticket_id", "sent_at");
CREATE INDEX "kitchen_dispatches_tenant_id_sent_at_idx"
    ON "kitchen_dispatches"("tenant_id", "sent_at");

-- ──────────────────────────────────────────────────────────────────────
-- 7 · La TARJETA de la pantalla · un envío × una sección
-- ──────────────────────────────────────────────────────────────────────
--
-- Sólo nacen para las secciones cuyo destino es una PANTALLA. Las de
-- impresora siguen por ESC/POS (ahora por diferencia) y las que no tienen
-- destino se marcan como enviadas sin más: el envío NO falla por falta de
-- destino (decisión 2). Eso es lo que hoy devuelve un 409 y no marca nada.
CREATE TABLE "kitchen_orders" (
    "id"                  UUID PRIMARY KEY,
    "dispatch_id"         UUID NOT NULL,
    "ticket_id"           UUID NOT NULL,
    -- La tienda manda en el GET de cocina: una pantalla ve lo de SU tienda
    -- y SUS secciones. Copiada para que el filtro sea un índice y no un
    -- `join` por la caja.
    "store_id"            UUID NOT NULL,
    "table_id"            UUID,
    -- «M5», copiado al enviar: renombrar la mesa en el panel no puede
    -- reescribir lo que la cocina está leyendo.
    "table_name"          TEXT,
    "section"             "KitchenSection" NOT NULL,
    "number"              INTEGER NOT NULL,
    "urgent"              BOOLEAN NOT NULL DEFAULT false,
    "urgent_at"           TIMESTAMPTZ,
    "urgent_by_device_id" UUID,
    "sent_at"             TIMESTAMPTZ NOT NULL DEFAULT now(),
    "late_arrival"        BOOLEAN NOT NULL DEFAULT false,
    "ready_at"            TIMESTAMPTZ,
    "ready_by_device_id"  UUID,
    "served_at"           TIMESTAMPTZ,
    "served_by_user_id"   UUID,
    "recovered_at"        TIMESTAMPTZ,

    CONSTRAINT "kitchen_orders_dispatch_id_fkey"
        FOREIGN KEY ("dispatch_id") REFERENCES "kitchen_dispatches"("id") ON DELETE CASCADE,
    CONSTRAINT "kitchen_orders_ticket_id_fkey"
        FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE,
    CONSTRAINT "kitchen_orders_store_id_fkey"
        FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE,
    CONSTRAINT "kitchen_orders_table_id_fkey"
        FOREIGN KEY ("table_id") REFERENCES "tables"("id") ON DELETE SET NULL,
    CONSTRAINT "kitchen_orders_urgent_by_device_id_fkey"
        FOREIGN KEY ("urgent_by_device_id") REFERENCES "devices"("id") ON DELETE SET NULL,
    CONSTRAINT "kitchen_orders_ready_by_device_id_fkey"
        FOREIGN KEY ("ready_by_device_id") REFERENCES "devices"("id") ON DELETE SET NULL,
    CONSTRAINT "kitchen_orders_served_by_user_id_fkey"
        FOREIGN KEY ("served_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
);

-- Un envío produce COMO MUCHO UNA tarjeta por sección. Es la mitad de la
-- idempotencia que cabe en la base; la otra —no reimprimir, no remarcar—
-- la da `kitchen_dispatches.client_send_id`.
CREATE UNIQUE INDEX "kitchen_orders_dispatch_id_section_key"
    ON "kitchen_orders"("dispatch_id", "section");
-- El GET de cocina: «las comandas abiertas de mi tienda y mis secciones».
CREATE INDEX "kitchen_orders_store_id_section_served_at_idx"
    ON "kitchen_orders"("store_id", "section", "served_at");
CREATE INDEX "kitchen_orders_ticket_id_idx"
    ON "kitchen_orders"("ticket_id");

-- No se puede estar servido sin estar listo, ni listo antes de enviado.
-- Un «Servido» sin «Lista» dejaría al informe del dueño midiendo el tiempo
-- en el pase contra una marca que no existe.
ALTER TABLE "kitchen_orders"
    ADD CONSTRAINT "kitchen_orders_cronologia"
    CHECK (
        ("ready_at"  IS NULL OR "ready_at"  >= "sent_at")
        AND ("served_at" IS NULL OR "ready_at" IS NOT NULL)
    );

-- ──────────────────────────────────────────────────────────────────────
-- 8 · El PLATO de una tarjeta
-- ──────────────────────────────────────────────────────────────────────
--
-- Por qué COPIA en vez de leer la venta: la pantalla tiene que seguir
-- diciendo lo que dijo. Si el camarero baja unidades o anula, la tarjeta
-- no puede reescribirse en silencio — cocina tiene que ver «ERAN 3 · −1» y
-- tocar «Visto» (decisión 6). Una tarjeta que se recalculase de la venta
-- haría desaparecer el plato anulado, que es justo el fallo que el bloque
-- existe para no cometer.
CREATE TABLE "kitchen_order_lines" (
    "id"                UUID PRIMARY KEY,
    "order_id"          UUID NOT NULL,
    -- `SET NULL`: borrar la línea de la venta no borra lo que la cocina
    -- vio, y la tarjeta tiene que poder decir «ANULADO» después.
    "ticket_line_id"    UUID,
    "name_snapshot"     TEXT NOT NULL,
    -- Unidades de ESTE envío (la diferencia), no las de la mesa.
    "units"             DECIMAL(10,3) NOT NULL,
    "modifiers"         JSONB,
    "course"            INTEGER NOT NULL DEFAULT 1,
    "seat"              INTEGER,
    -- Los alérgenos del producto EN ESE MOMENTO. Copiados y no leídos: un
    -- plato que salió marcado «lleva gluten» tiene que seguir marcándolo
    -- aunque alguien corrija la ficha a media mañana.
    "allergens"         "Allergen"[] NOT NULL DEFAULT '{}',
    -- El instante desde el que cuenta el semáforo. El tiempo 1 marcha al
    -- enviar; los demás quedan NULL («EN ESPERA», gris, sin semáforo)
    -- hasta «Marchar 2º». Lo de BARRA no se retiene nunca.
    "fired_at"          TIMESTAMPTZ,
    "done_at"           TIMESTAMPTZ,
    "done_by_device_id" UUID,
    -- Cuántas de las `units` de esta tarjeta se anularon después. NO se
    -- descuenta de `units`: la tarjeta tiene que decir «2 Croquetas · ERAN
    -- 3 · −1», y para eso hace falta el antes y el después.
    "voided_units"      DECIMAL(10,3) NOT NULL DEFAULT 0,
    "voided_at"         TIMESTAMPTZ,
    "voided_by_user_id" UUID,
    "void_seen_at"      TIMESTAMPTZ,
    -- MERMA: la cocina ya lo había tachado al anularse. Se calcula al
    -- anular y se GUARDA, porque `done_at` puede cambiar después
    -- (destachar) y entonces el informe del dueño mentiría.
    "done_before_void"  BOOLEAN NOT NULL DEFAULT false,
    "changed_at"        TIMESTAMPTZ,
    "change_note"       TEXT,
    "change_seen_at"    TIMESTAMPTZ,

    CONSTRAINT "kitchen_order_lines_order_id_fkey"
        FOREIGN KEY ("order_id") REFERENCES "kitchen_orders"("id") ON DELETE CASCADE,
    CONSTRAINT "kitchen_order_lines_ticket_line_id_fkey"
        FOREIGN KEY ("ticket_line_id") REFERENCES "ticket_lines"("id") ON DELETE SET NULL,
    CONSTRAINT "kitchen_order_lines_done_by_device_id_fkey"
        FOREIGN KEY ("done_by_device_id") REFERENCES "devices"("id") ON DELETE SET NULL,
    CONSTRAINT "kitchen_order_lines_voided_by_user_id_fkey"
        FOREIGN KEY ("voided_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
);

CREATE INDEX "kitchen_order_lines_order_id_idx"
    ON "kitchen_order_lines"("order_id");
-- «Qué ve la cocina de esta línea de la venta»: lo pregunta cada anulación.
CREATE INDEX "kitchen_order_lines_ticket_line_id_idx"
    ON "kitchen_order_lines"("ticket_line_id");

-- No se pueden anular más unidades de las que se mandaron. Sin esto, dos
-- «−» seguidos sobre una tarjeta de una unidad dejarían «ERAN 1 · −2» en
-- la pantalla del cocinero.
ALTER TABLE "kitchen_order_lines"
    ADD CONSTRAINT "kitchen_order_lines_voided_range"
    CHECK ("voided_units" >= 0 AND "voided_units" <= "units");

ALTER TABLE "kitchen_order_lines"
    ADD CONSTRAINT "kitchen_order_lines_course_positive"
    CHECK ("course" >= 1);

ALTER TABLE "kitchen_order_lines"
    ADD CONSTRAINT "kitchen_order_lines_seat_positive"
    CHECK ("seat" IS NULL OR "seat" >= 1);

-- ──────────────────────────────────────────────────────────────────────
-- 9 · Si un TIEMPO de esta mesa está retenido o marchado
-- ──────────────────────────────────────────────────────────────────────
--
-- Una fila por (ticket, tiempo) y SÓLO cuando el tiempo ya marchó: la
-- ausencia de fila es «retenido». Así y no con un booleano porque lo que
-- hace falta guardar es el INSTANTE del marchado —de ahí cuenta el
-- semáforo— y un booleano no lo lleva.
CREATE TABLE "ticket_courses" (
    "id"               UUID PRIMARY KEY,
    "ticket_id"        UUID NOT NULL,
    "course"           INTEGER NOT NULL,
    "fired_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
    "fired_by_user_id" UUID NOT NULL,

    CONSTRAINT "ticket_courses_ticket_id_fkey"
        FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE,
    CONSTRAINT "ticket_courses_fired_by_user_id_fkey"
        FOREIGN KEY ("fired_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
    CONSTRAINT "ticket_courses_course_positive" CHECK ("course" >= 1)
);

-- Marchar dos veces el mismo tiempo no adelanta el reloj del semáforo.
CREATE UNIQUE INDEX "ticket_courses_ticket_id_course_key"
    ON "ticket_courses"("ticket_id", "course");

-- ──────────────────────────────────────────────────────────────────────
-- 10 · Las alergias de LA MESA DE ESTE SERVICIO, por silla
-- ──────────────────────────────────────────────────────────────────────
--
-- LO QUE ESTA TABLA GARANTIZA, y es la mitad de por qué existe: **la
-- alergia no sale del ticket**. Cuelga del `tickets` con CASCADE, no tiene
-- nombre de nadie y **no hay ninguna clave hacia `clients`**. Cobrar o
-- anular la mesa se la lleva. No es un dato de salud de una persona
-- identificada: es «en la silla 3 de la mesa 5 de esta comida no puede
-- entrar gluten».
--
-- Que no haya FK a `clients` no es una omisión: es la invariante, y tiene
-- su propio sabotaje en la tabla del bloque («La alergia llega a Client»).
--
-- `seat` NULL = «toda la mesa», lo que se marca cuando el camarero no sabe
-- quién es. Vale igual: en cocina sale la franja «⚠ TODA LA MESA».
CREATE TABLE "ticket_allergies" (
    "id"                 UUID PRIMARY KEY,
    "ticket_id"          UUID NOT NULL,
    "seat"               INTEGER,
    "allergen"           "Allergen" NOT NULL,
    "created_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
    "created_by_user_id" UUID,

    CONSTRAINT "ticket_allergies_ticket_id_fkey"
        FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE,
    CONSTRAINT "ticket_allergies_seat_positive"
        CHECK ("seat" IS NULL OR "seat" >= 1)
);

CREATE INDEX "ticket_allergies_ticket_id_idx"
    ON "ticket_allergies"("ticket_id");

-- Marcar dos veces el mismo alérgeno en la misma silla no crea dos filas.
CREATE UNIQUE INDEX "ticket_allergies_ticket_id_seat_allergen_key"
    ON "ticket_allergies"("ticket_id", "seat", "allergen");

-- ÍNDICE QUE PRISMA NO PUEDE DECLARAR, y por qué hace falta: en Postgres
-- los NULL son distintos entre sí, así que el único de arriba NO impide
-- dos filas «toda la mesa · GLUTEN». Y dos filas iguales pintan la franja
-- roja dos veces. Mismo caso que `products_tenant_id_sku_local_key` de
-- catalogo-local y que `public_links_uno_vivo_key` de enlaces-publicos.
--
-- CONSECUENCIA A VIGILAR: `prisma migrate dev` verá este índice como
-- deriva y ofrecerá borrarlo. NO aceptar. El test
-- `apps/api/test/kds-migracion.test.ts` guarda el contrato del SQL para
-- que la pérdida salga en rojo.
CREATE UNIQUE INDEX "ticket_allergies_mesa_key"
    ON "ticket_allergies"("ticket_id", "allergen")
    WHERE "seat" IS NULL;
