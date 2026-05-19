-- B-Multi-Vertical · businessType (HOSPITALITY | RETAIL | SERVICES)
--
-- Añade el vertical operativo al tenant. El TPV usa este campo para
-- decidir: placeholder de producto (Coffee | Package | Briefcase),
-- visibilidad del mapa de mesas (solo HOSPITALITY), y disponibilidad
-- de modificadores (HOSPITALITY siempre; RETAIL opcional; SERVICES no).
--
-- Default RETAIL: el piloto inicial (Librería Thalia) es retail. Los
-- tenants existentes pasan a RETAIL automáticamente; el super-admin
-- puede corregir desde el detalle del tenant si la primera asignación
-- no es la correcta.

CREATE TYPE "BusinessType" AS ENUM ('HOSPITALITY', 'RETAIL', 'SERVICES');

ALTER TABLE "tenants"
  ADD COLUMN "business_type" "BusinessType" NOT NULL DEFAULT 'RETAIL';
