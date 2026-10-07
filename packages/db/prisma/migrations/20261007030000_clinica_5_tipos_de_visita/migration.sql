-- clinica-5 · el tipo de visita en la categoría, y el nivel de la
-- quiropodia en el servicio.
--
-- La sesión de clinica-3 servía para una quiropodia. Esto es lo que hace
-- falta en la base para que una visita pueda ser de hasta cinco clases a
-- la vez y para que cada una sepa qué cobra.
--
-- ── UNA SOLA MIGRACIÓN, y por fin ─────────────────────────────────────
--
-- clinica-1, clinica-2 y clinica-3 necesitaron DOS cada una, siempre por
-- lo mismo: Postgres prohíbe USAR un valor de enum en la misma
-- transacción en la que se añade, y Prisma corre cada migración en una
-- transacción. Tres veces pagada la misma factura.
--
-- Aquí no hay enum. El tipo de visita es `VARCHAR(20)` con CHECK —la
-- misma decisión que `products.exemption_cause` tomó en
-- iva-exento-sanitario, y por la misma razón: con los cinco códigos en el
-- CHECK, admitir un tipo nuevo es desplegar y migrar una vez, y el CHECK
-- cubre las cuatro puertas de escritura a la tabla (panel, fichero del
-- super-admin, sync de Holded y el psql de una implantación), que un `if`
-- del endpoint no cubre (ADR-015 §1).
--
-- ── Migración ADITIVA ─────────────────────────────────────────────────
--
-- Una tabla nueva, una columna nueva y dos garantías. Ni un DROP, ni un
-- TRUNCATE, ni un DELETE, ni un UPDATE masivo. La columna nace NULL (sin
-- default constante, así que PG 11+ no reescribe la tabla) y la tabla
-- nace vacía: los quince tenants de hoy no cambian de comportamiento.
-- Ningún servicio es el nivel de nada y ninguna categoría tiene tipo, así
-- que ninguna sesión y ningún cobro existentes cambian.
--
-- ── El `down`, pensado ────────────────────────────────────────────────
--
-- Reversible por completo, y de verdad — al contrario que las de
-- clinica-1/-2/-3, que dejaban valores de enum que Postgres no sabe
-- quitar:
--
--   DROP TABLE "tag_visit_types";
--   ALTER TABLE "service_scheduling" DROP COLUMN "nivel_quiropodia";
--
-- Y eso SÍ se puede ejecutar: la tabla es configuración del centro, no
-- historia clínica. Lo que no se echa atrás nunca son las sesiones ya
-- firmadas, y éstas no viven aquí: viven en `clinical_entries.body`, con
-- el tipo y el nivel CONGELADOS dentro (ver `CuerpoDeSesionV2`). Borrar
-- esta tabla deja al centro sin saber qué tipo tiene cada categoría de
-- hoy en adelante; no cambia ni una visita del pasado.

-- ── 1 · EL TIPO DE VISITA VIVE EN LA CATEGORÍA (S5) ────────────────────
--
-- Mismo patrón que `tag_sections` (v1.4-Bar-Operativa, `tag → sección de
-- cocina`): un grupo que el centro crea apuntando a un comportamiento de
-- una lista cerrada en código. S5 eligió este patrón porque ya existía y
-- resuelve exactamente esto; la alternativa —una tabla de familias
-- nueva— habría dejado al centro manteniendo DOS agrupaciones de los
-- mismos servicios, una en la caja y otra en la agenda. En RT eso pasó y
-- hubo que conciliarlas a mano.
--
-- `(tenant_id, slug)` ÚNICO: una categoría tiene un tipo. Un servicio
-- puede tener varias categorías, y de ahí sale la regla que vive en la
-- aplicación: dos categorías con tipos DISTINTOS en un servicio no se
-- guarda (S5 regla 3, `tipoDelServicio`). Esa no puede vivir en el motor
-- porque mira el array `products.tags` cruzado con esta tabla, y un
-- trigger que lo hiciera correría en cada escritura del sync de Holded.
CREATE TABLE "tag_visit_types" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "visit_type" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tag_visit_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tag_visit_types_tenant_id_slug_key"
    ON "tag_visit_types"("tenant_id", "slug");

ALTER TABLE "tag_visit_types"
    ADD CONSTRAINT "tag_visit_types_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Los cinco tipos de `TIPOS_DE_VISITA` (`@mipiacetpv/clinica-sesion`), los
-- mismos cinco que COGECOP usa desde 2013. Un sexto tipo es una línea aquí
-- y una en la lista del paquete, y el typecheck pide la segunda.
ALTER TABLE "tag_visit_types"
    ADD CONSTRAINT "tag_visit_types_tipo_valido"
    CHECK ("visit_type" IN ('QUIROPODIA', 'PIE_RIESGO', 'CIRUGIA', 'BIOMECANICA', 'GENERAL'));

-- ── 2 · EL NIVEL DE LA QUIROPODIA ──────────────────────────────────────
--
-- 1 básica (25 €) · 2 completa (26 €) · 3 extra (27 €), los mismos 30
-- minutos. La categoría dice que los tres son quiropodia; esta columna
-- dice cuál es cuál, y es lo que deja que el nivel que la sesión propone
-- se convierta en una línea de ticket.
--
-- NULL = no es ninguno de los tres, que es lo normal.
ALTER TABLE "service_scheduling"
    ADD COLUMN "nivel_quiropodia" INTEGER;

ALTER TABLE "service_scheduling"
    ADD CONSTRAINT "service_scheduling_nivel_quiropodia_valido"
    CHECK ("nivel_quiropodia" IS NULL OR "nivel_quiropodia" BETWEEN 1 AND 3);

-- UN SERVICIO POR NIVEL Y POR CENTRO, y lo hace cumplir el motor.
--
-- Dos servicios que digan ser «quiropodia extra» dejan a la sesión sin
-- saber cuál cobrar, y lo resolvería eligiendo el primero por orden de
-- nombre — o sea, cobrando a veces uno y a veces otro según cómo se
-- llamen. Es mejor que falle al configurarlo, con la dueña delante del
-- panel y sin nadie esperando, que con la paciente delante.
--
-- PARCIAL porque los NULL son la mayoría de las filas y no chocan entre
-- sí: en Postgres los NULL son distintos en un índice único, así que el
-- `WHERE` no es imprescindible — pero escrito así el índice DICE lo que
-- quiere decir, y el día que alguien ponga un default en la columna no se
-- convierte en una bomba. Misma lección que
-- `clinical_entries_una_sesion_por_cita` (clinica-3).
CREATE UNIQUE INDEX "service_scheduling_un_servicio_por_nivel"
    ON "service_scheduling"("tenant_id", "nivel_quiropodia")
    WHERE "nivel_quiropodia" IS NOT NULL;
