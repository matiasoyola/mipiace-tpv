-- v1.3-Servicios-Pinta · Lote 3.
--
-- Añade `attended_by` (VARCHAR(60) NULL) a `tickets` para registrar
-- el profesional que atendió al cliente en tenants SERVICES (peluquería,
-- clínica, taller). Texto libre, no FK — la agenda formal queda fuera
-- de scope (próximos evolutivos v1.4/v2). Nullable porque RETAIL y
-- HOSPITALITY no lo usan y los tickets pre-existentes deben seguir
-- siendo válidos sin el campo.

ALTER TABLE "tickets" ADD COLUMN "attended_by" VARCHAR(60);
