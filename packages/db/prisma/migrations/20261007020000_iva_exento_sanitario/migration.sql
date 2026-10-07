-- iva-exento-sanitario · la causa de exención en el producto y su snapshot
-- en la línea cobrada, con la invariante «exento ⇒ sin IVA» hecha cumplir
-- por el motor.
--
-- ── Por qué UNA sola migración y no dos ───────────────────────────────
--
-- Los tres bloques de clínica partieron la migración en dos porque
-- Postgres prohíbe USAR un valor de enum en la misma transacción en la que
-- se añade, y sus índices parciales nombraban el valor nuevo. Aquí no hay
-- enum: la causa es TEXTO VALIDADO POR CHECK, y la razón de esa elección
-- es justamente ésta —
--
--   · un `enum` obligaría a un `ALTER TYPE … ADD VALUE` (y a su migración
--     partida en dos) cada vez que entrara una causa nueva de la lista
--     L10, y `ALTER TYPE … DROP VALUE` no existe en Postgres: un enum sólo
--     crece y nunca se corrige;
--   · un CHECK con los SEIS códigos de la lista escritos desde hoy admite
--     E2–E6 sin tocar el esquema. Lo que decide qué causa se puede elegir
--     es la aplicación, y eso se cambia desplegando.
--
-- Y el CHECK se escribe con la lista entera y no con `E1` a secas a
-- propósito: con `IN ('E1')` la segunda causa sería otra migración, que es
-- exactamente lo que el enunciado del bloque pedía evitar.
--
-- ── Migración ADITIVA ─────────────────────────────────────────────────
--
-- Ni un DROP, ni un TRUNCATE, ni un DELETE, ni un UPDATE. Las dos columnas
-- nacen NULL —no hay `DEFAULT` que poner: «sin causa de exención» ES el
-- NULL, y un default aquí sería declarar exenta alguna operación— así que
-- `ADD COLUMN` no reescribe ninguna de las dos tablas.
--
-- Los quince tenants de hoy no cambian de comportamiento: cero productos
-- con causa, cero líneas con causa, y los dos CHECK se cumplen
-- trivialmente en todas las filas existentes porque `NULL IS NULL`.
--
-- OJO con el coste del CHECK en `ticket_lines`: `ADD CONSTRAINT … CHECK`
-- hace un seq scan de validación con `SHARE ROW EXCLUSIVE` sobre la tabla.
-- Es la tabla más grande del esquema. Se acepta sin `NOT VALID` porque en
-- el parque de hoy son decenas de miles de filas (segundos) y porque un
-- CHECK `NOT VALID` no comprueba las filas viejas — que es justo lo que
-- aquí interesa dejar demostrado: ni una línea histórica se contradice.
--
-- ── El `down`, pensado ────────────────────────────────────────────────
--
--   ALTER TABLE "ticket_lines" DROP CONSTRAINT "ticket_lines_exencion_sin_iva";
--   ALTER TABLE "ticket_lines" DROP CONSTRAINT "ticket_lines_exencion_en_l10";
--   ALTER TABLE "ticket_lines" DROP COLUMN "exemption_cause";
--   ALTER TABLE "products" DROP CONSTRAINT "products_exencion_sin_iva";
--   ALTER TABLE "products" DROP CONSTRAINT "products_exencion_en_l10";
--   ALTER TABLE "products" DROP COLUMN "exemption_cause";
--
-- Reversible por completo: son dos columnas y cuatro constraints, sin
-- enum que no se pueda quitar y sin dato que se pierda que no sea el que
-- la columna misma guarda. Lo que NO vuelve atrás son las facturas ya
-- emitidas, y no hace falta: `fiscal_records` es append-only y el registro
-- de una venta exenta ya declaró su `OperacionExenta` el día que se cobró.
-- Echar atrás la columna deja de poder explicar un ticket viejo, así que
-- el rollback de verdad es desplegar la imagen anterior y NO tirar la
-- migración.

-- ── 1 · la causa en el PRODUCTO ────────────────────────────────────────
--
-- LA EXENCIÓN VA EN EL PRODUCTO Y NO EN EL COMERCIO (decisión 1 del
-- bloque). Una clínica vende también cremas y plantillas de serie con su
-- 21 %, y el mismo ticket mezcla los dos tramos. Con la marca en el
-- tenant, la crema del mostrador saldría exenta.
--
-- Vive en `products` y no en `service_scheduling` —donde clinica-2 y
-- clinica-3 pusieron sus marcas— porque esto NO es agenda: es el dinero.
-- `service_scheduling` es la capa de extensión local sobre el producto
-- (ADR-R1) y sus marcas deciden qué botones salen; el precio y el IVA han
-- sido siempre de `products`, y la causa de exención es del IVA.
ALTER TABLE "products"
    ADD COLUMN "exemption_cause" TEXT;

-- La lista L10 del diseño de registro (`DsRegistroVeriFactu.xlsx`, hoja
-- `6)Listas`), literal y completa:
--
--   E1  Exenta por el artículo 20
--   E2  Exenta por el artículo 21
--   E3  Exenta por el artículo 22
--   E4  Exenta por los artículos 23 y 24
--   E5  Exenta por el artículo 25
--   E6  Exenta por otros
--
-- (El IGIC admite además E7 y E8 — validaciones §15.5. Este SIF no emite
-- IGIC: `Impuesto` es siempre "01".)
--
-- Los seis están aquí, no sólo el E1 que la pantalla ofrece. Con
-- `ClaveRegimen = "01"` la AEAT prohíbe E2 y E3 (§15.5) y eso lo hace
-- cumplir la aplicación, que es quien sabe con qué régimen declara; la
-- columna guarda el código tal cual lo nombra la AEAT para que no haya
-- tabla de traducción entre lo que se guarda y lo que se remite.
ALTER TABLE "products"
    ADD CONSTRAINT "products_exencion_en_l10"
    CHECK (
        "exemption_cause" IS NULL
        OR "exemption_cause" IN ('E1', 'E2', 'E3', 'E4', 'E5', 'E6')
    );

-- EXENTO ⇒ SIN IVA, Y LO GARANTIZA EL MOTOR.
--
-- Validaciones §15.5: «Si el campo OperacionExenta está cumplimentado no
-- se pueden informar ninguno de estos campos: TipoImpositivo,
-- CuotaRepercutida, TipoRecargoEquivalencia y CuotaRecargoEquivalencia.»
-- Un producto exento con `tax_rate = 21` produciría un registro imposible
-- y un papel que cobra un IVA que no existe.
--
-- Está aquí y no sólo en el front por la razón de siempre: hay tres
-- puertas de escritura a `products` (el alta del panel, la carga de
-- fichero del super-admin y el upsert del sync de Holded) y una cuarta
-- —el `psql` de una implantación— que no pasa por ninguna validación de
-- aplicación.
--
-- Y está escrito en los DOS sentidos sin querer serlo: no dice «si hay
-- causa el IVA es 0» sino que la pareja (causa, IVA≠0) es imposible, así
-- que también prohíbe el camino por el que esto se rompería de verdad —un
-- UPDATE que cambie el `tax_rate` de un producto que ya estaba marcado.
ALTER TABLE "products"
    ADD CONSTRAINT "products_exencion_sin_iva"
    CHECK ("exemption_cause" IS NULL OR "tax_rate" = 0);

-- ── 2 · el SNAPSHOT en la línea cobrada ────────────────────────────────
--
-- LO QUE SE COBRÓ NO CAMBIA SI MAÑANA SE EDITA EL PRODUCTO.
--
-- Es la misma razón por la que la línea ya guarda `name_snapshot`,
-- `holded_product_id`, `unit_price` y `tax_rate` en vez de leerlos del
-- catálogo al imprimir: una factura es de un día. Si Rosario desmarca
-- «Exento · sanitario» el mes que viene —porque se equivocó, o porque
-- cambia la ley— sus facturas de este mes tienen que seguir diciendo lo
-- que dijeron, y su registro de facturación ya declaró `OperacionExenta`.
--
-- Sin el snapshot, reimprimir un ticket de hace un año leería la causa de
-- hoy y el papel reimpreso no coincidiría con el que el cliente tiene en
-- la mano ni con el registro que la AEAT ya recibió.
ALTER TABLE "ticket_lines"
    ADD COLUMN "exemption_cause" TEXT;

ALTER TABLE "ticket_lines"
    ADD CONSTRAINT "ticket_lines_exencion_en_l10"
    CHECK (
        "exemption_cause" IS NULL
        OR "exemption_cause" IN ('E1', 'E2', 'E3', 'E4', 'E5', 'E6')
    );

-- El mismo CHECK que en `products`, y por el mismo motivo doblado: la
-- línea es lo que se declara. `POST /tickets` recibe `taxRate` y
-- `exemptionCause` del dispositivo, y un terminal con una versión vieja
-- del catálogo cacheado podría mandar la pareja incoherente. Que la
-- rechace el motor y no un `if` del handler es lo que hace que la
-- invariante valga también para el `/tickets/:id/checkout` de mesa, para
-- el borrador que abre la agenda y para la línea que nazca mañana desde
-- un bono de sesiones.
ALTER TABLE "ticket_lines"
    ADD CONSTRAINT "ticket_lines_exencion_sin_iva"
    CHECK ("exemption_cause" IS NULL OR "tax_rate" = 0);
