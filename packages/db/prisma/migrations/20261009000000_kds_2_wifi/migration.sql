-- kds-2-wifi · el camino directo por la wifi del local.
--
-- ── QUÉ GARANTIZA ESTA MIGRACIÓN ──────────────────────────────────────
--
-- Tres cosas, y las tres están en el motor porque olvidarlas en el código
-- no se vería hasta el día en que se cae internet en el bar:
--
--   1. **Un terminal de caja no escucha en ningún puerto.** El CHECK
--      `devices_kitchen_lan_solo_cocina` impide que una fila `TERMINAL`
--      tenga IP o puerto de servidor local. Es la lección A5 escrita en la
--      base: nada de laboratorio en la APK de un cliente.
--   2. **La clave de la tienda se rota al revocar un aparato.** Lo hace el
--      trigger `stores_rotate_lan_key`, no el código de ninguna ruta. Un
--      terminal revocado no puede volver a mandar comandas por la wifi, y
--      para eso no hay que acordarse de nada en `POST /devices/pair` ni en
--      el super-admin.
--   3. **Lo que la cocina marcó sin internet se sube una sola vez.**
--      `kitchen_lan_marks` es el libro de marcas: una fila por tachado,
--      «Lista» o «Visto» hecho en la tablet, con su `mark_id` del aparato
--      como llave. Subirlo dos veces no mueve nada.
--
-- ── MIGRACIÓN ADITIVA ─────────────────────────────────────────────────
--
-- Una tabla nueva vacía, seis columnas nuevas y un trigger. Ni un DROP, ni
-- un DELETE, ni un UPDATE masivo. Todas las columnas nacen NULL, así que
-- PG 11+ no reescribe ninguna tabla.
--
-- Y **nada cambia de comportamiento al aplicarla**: sin clave de tienda
-- (`kitchen_lan_key IS NULL`) no hay camino directo, y la clave sólo nace
-- cuando una pantalla de cocina la pide. Un cliente sin pantalla de cocina
-- no ve ni una diferencia.
--
-- ── EL `down`, PENSADO ────────────────────────────────────────────────
--
--   DROP TRIGGER "stores_rotate_lan_key" ON "devices";
--   DROP FUNCTION mipiacetpv_stores_rotate_lan_key();
--   DROP TABLE "kitchen_lan_marks";
--   ALTER TABLE "kitchen_orders" DROP COLUMN "lan_received_at";
--   ALTER TABLE "devices" DROP CONSTRAINT "devices_kitchen_lan_solo_cocina",
--                         DROP COLUMN "kitchen_lan_ip",
--                         DROP COLUMN "kitchen_lan_port",
--                         DROP COLUMN "kitchen_lan_at";
--   ALTER TABLE "stores"  DROP COLUMN "kitchen_lan_key",
--                         DROP COLUMN "kitchen_lan_key_at";
--
-- Reversible entera: no hay tipos nuevos.

-- ── 1 · la clave de la tienda ─────────────────────────────────────────
--
-- 32 bytes en base64url (43 caracteres sin relleno). La emite el servidor
-- la primera vez que una pantalla de cocina la pide, y se la entrega a las
-- pantallas y a los terminales de ESA tienda. Cada mensaje de la wifi va
-- cifrado y autenticado con ella (AES-256-GCM, ver
-- `packages/kitchen-lan`).
--
-- Vive en la TIENDA y no en el tenant: una cadena con dos bares tiene dos
-- wifis distintas, y la clave de un local no puede abrir la cocina del
-- otro. Es lo que hace que el sobre se pueda rechazar por «otra tienda»
-- antes de descifrarlo.
--
-- No va cifrada en reposo, y es deliberado: está al mismo nivel que
-- `devices.device_token_hash`… no, está POR DEBAJO. Es un secreto de red
-- local cuyo alcance máximo es «meter una comanda falsa en una pantalla de
-- cocina». Cifrarla en la base exigiría una clave maestra que habría que
-- guardar en otro sitio, y ese otro sitio sería el VPS. Se rota sola al
-- revocar un aparato, que es la mitigación que de verdad aplica.
ALTER TABLE "stores"
    ADD COLUMN "kitchen_lan_key"    TEXT,
    ADD COLUMN "kitchen_lan_key_at" TIMESTAMPTZ(3);

-- ── 2 · dónde escucha la pantalla, y quién NO escucha ─────────────────
--
-- La tablet anuncia su IP y su puerto en el latido que ya manda
-- (`POST /kitchen/latido`), y el TPV los lee de `GET /kitchen/estado`.
-- Si el router le cambia la IP sin internet, el TPV la redescubre por NSD
-- en la red local; estas columnas son la última conocida, que es con la
-- que se reintenta.
--
-- `kitchen_lan_at` es cuándo lo anunció. Una IP de ayer no vale para nada
-- y el TPV tiene que poder saber que es vieja.
ALTER TABLE "devices"
    ADD COLUMN "kitchen_lan_ip"   TEXT,
    ADD COLUMN "kitchen_lan_port" INTEGER,
    ADD COLUMN "kitchen_lan_at"   TIMESTAMPTZ(3);

-- SABOTAJE «abrir el servidor local en un TERMINAL».
--
-- Un terminal de caja no abre ningún puerto, y aquí no se puede ni
-- apuntar que lo haya hecho. El CHECK se escribe con la forma positiva
-- («o eres KITCHEN, o las tres columnas están vacías») y se comprueba con
-- `IS NULL`, no con `cardinality` ni `array_length`: el CHECK de kds-1
-- (`devices_kitchen_sections`) se escribió con `array_length` y no
-- prohibía nada, porque un CHECK que evalúa a NULL se considera
-- satisfecho. Aquí los tres `IS NULL` devuelven siempre TRUE o FALSE.
ALTER TABLE "devices"
    ADD CONSTRAINT "devices_kitchen_lan_solo_cocina" CHECK (
        "kind" = 'KITCHEN'
        OR ("kitchen_lan_ip" IS NULL
            AND "kitchen_lan_port" IS NULL
            AND "kitchen_lan_at" IS NULL)
    );

-- El puerto, si está, es un puerto. 1024 por abajo porque en Android no
-- somos root y los privilegiados no se pueden abrir.
ALTER TABLE "devices"
    ADD CONSTRAINT "devices_kitchen_lan_port_range" CHECK (
        "kitchen_lan_port" IS NULL
        OR ("kitchen_lan_port" >= 1024 AND "kitchen_lan_port" <= 65535)
    );

-- ── 3 · la comanda que llegó por la wifi ──────────────────────────────
--
-- Cuándo la tablet dice que ya tenía este envío por el camino directo. Lo
-- rellena la subida de la tablet al volver internet, y significa: «esta
-- tarjeta no hay que pintarla como nueva, el cocinero la lleva viendo
-- veinte minutos».
--
-- Es también el dato de las estadísticas del dueño que contesta «cuántos
-- servicios salieron sin internet», y lo que hace que
-- `kitchen_orders.late_arrival` (kds-1) no se ponga cuando la comanda sí
-- llegó: llegó, sólo que por el otro camino.
ALTER TABLE "kitchen_orders"
    ADD COLUMN "lan_received_at" TIMESTAMPTZ(3);

-- ── 4 · el libro de marcas ────────────────────────────────────────────
--
-- Una fila por cada cosa que la cocina marcó: un tachado (o un
-- destachado), un «Lista» o un «Visto». La tablet las guarda mientras no
-- hay internet y las sube todas al volver.
--
-- POR QUÉ UN LIBRO Y NO «SUBIR EL ESTADO FINAL»:
--
--   · **Quién manda en cada estado.** La decisión 9 dice que en el tachado,
--     «Lista» y «Visto» manda la cocina, y que gana la marca de tiempo DEL
--     APARATO QUE MANDA EN ESE ESTADO. Con el estado final no se puede
--     ordenar: dos pantallas de cocina que tachan y destachan el mismo
--     plato darían el resultado del que subiera último, no el del que lo
--     hizo último. Con el libro, se aplican por `at` y el resultado es el
--     mismo en cualquier orden de llegada.
--   · **Idempotencia de verdad.** `mark_id` lo genera la tablet. Subir dos
--     veces la misma marca no mueve nada: la PK la rechaza.
--   · **Y es el dato que kds-3 necesita** para contar cuánto tardó la
--     cocina en cada plato. Lo que no se guarda hoy no se cuenta mañana.
--
-- LAS COORDENADAS SON LAS DEL CAMINO DIRECTO, NO LAS DEL SERVIDOR:
-- `client_send_id` + `section` + `ticket_line_id`. Tienen que serlo, porque
-- la tablet marca sobre una tarjeta que el servidor **todavía no conoce**
-- (su `kitchen_orders.id` nace cuando el envío sube por la nube). Si la
-- marca llega antes que su envío, la fila queda con `applied_at` NULL y la
-- aplica el propio envío cuando entra. Ninguna marca se pierde por el
-- orden en que vuelva la red.
CREATE TABLE "kitchen_lan_marks" (
    -- UUID v4 generado EN LA TABLET. La llave de idempotencia.
    "mark_id"        UUID         NOT NULL,
    -- Quién marcó: la pantalla. De aquí sale «qué pantalla lo marcó» del
    -- informe del dueño.
    "device_id"      UUID         NOT NULL,
    "store_id"       UUID         NOT NULL,
    -- HECHO (tachar/destachar), VISTO (un anulado o un cambio) o LISTA.
    -- CHECK y no enum: son tres valores de nuestro protocolo, no de una
    -- norma, y un enum nuevo obliga a partir la migración en dos.
    "kind"           TEXT         NOT NULL,
    -- Las coordenadas del camino directo.
    "client_send_id" UUID         NOT NULL,
    "section"        "KitchenSection" NOT NULL,
    -- NULL en una marca de tarjeta (LISTA): no apunta a un plato.
    "ticket_line_id" UUID,
    -- Para HECHO: tachado o destachado. NULL en las demás.
    "done"           BOOLEAN,
    -- **La hora de la TABLET**, que es la que gana en estos tres estados.
    "at"             TIMESTAMPTZ(3) NOT NULL,
    "received_at"    TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    -- NULL = llegó antes que su envío y está esperándolo.
    "applied_at"     TIMESTAMPTZ(3),

    CONSTRAINT "kitchen_lan_marks_pkey" PRIMARY KEY ("mark_id")
);

ALTER TABLE "kitchen_lan_marks"
    ADD CONSTRAINT "kitchen_lan_marks_kind" CHECK (
        "kind" IN ('HECHO', 'VISTO', 'LISTA')
    ),
    -- Una marca de plato apunta a un plato; una de tarjeta, no. Escrito
    -- con `IS NULL` por lo mismo que el CHECK de arriba.
    ADD CONSTRAINT "kitchen_lan_marks_coordenadas" CHECK (
        ("kind" = 'LISTA' AND "ticket_line_id" IS NULL AND "done" IS NULL)
        OR ("kind" = 'VISTO' AND "ticket_line_id" IS NOT NULL AND "done" IS NULL)
        OR ("kind" = 'HECHO' AND "ticket_line_id" IS NOT NULL AND "done" IS NOT NULL)
    );

ALTER TABLE "kitchen_lan_marks"
    ADD CONSTRAINT "kitchen_lan_marks_device_id_fkey"
        FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE,
    ADD CONSTRAINT "kitchen_lan_marks_store_id_fkey"
        FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE;

-- Lo que el envío pregunta al entrar: «¿hay marcas esperándome?».
CREATE INDEX "kitchen_lan_marks_pendientes_idx"
    ON "kitchen_lan_marks" ("client_send_id")
    WHERE "applied_at" IS NULL;
CREATE INDEX "kitchen_lan_marks_store_idx"
    ON "kitchen_lan_marks" ("store_id", "at");

-- ── 5 · la rotación de la clave, en el motor ───────────────────────────
--
-- SABOTAJE «clave sin rotar al revocar»: un terminal que se revoca (o que
-- se releva al emparejar otro en su caja) tiene todavía la clave de la
-- tienda guardada. Si la clave no cambiara, ese aparato podría seguir
-- metiendo comandas en la pantalla de cocina por la wifi mientras siga
-- encendido, sin pasar por el servidor que lo revocó.
--
-- Se borra la clave y la pantalla pide una nueva en su siguiente latido.
-- Mismo criterio que `devices_revoke_previous`: vive en la base y no en
-- `POST /devices/pair`, porque los caminos que revocan son varios (el
-- super-admin, el relevo al emparejar, el panel) y acordarse en cada uno
-- es la forma de que falte en el próximo.
--
-- LO QUE ESTO NO ARREGLA, Y ESTÁ DICHO EN EL `-done`: si la rotación pasa
-- mientras el bar está SIN INTERNET, la tablet no puede enterarse, así que
-- el aparato revocado sigue pudiendo hablarle hasta que vuelva la red. No
-- hay forma de propagar una revocación sin un camino por el que
-- propagarla; lo que sí hay es que el envío de ese terminal no llega nunca
-- a la nube, así que no cobra, no factura y se ve en el panel.
CREATE FUNCTION mipiacetpv_stores_rotate_lan_key() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    UPDATE stores
       SET kitchen_lan_key    = NULL,
           kitchen_lan_key_at = NULL
     WHERE id = (SELECT store_id FROM registers WHERE id = NEW.register_id);
    RETURN NEW;
END;
$fn$;

-- `AFTER UPDATE` y con `WHEN`: sólo en la transición de vivo a revocado.
-- Un `UPDATE` que toca `last_seen_at` de un aparato ya revocado —que pasa
-- en cada latido rezagado— no puede rotar la clave de la tienda cada vez.
CREATE TRIGGER "stores_rotate_lan_key"
    AFTER UPDATE OF "revoked_at" ON "devices"
    FOR EACH ROW
    WHEN (OLD."revoked_at" IS NULL AND NEW."revoked_at" IS NOT NULL)
    EXECUTE FUNCTION mipiacetpv_stores_rotate_lan_key();
