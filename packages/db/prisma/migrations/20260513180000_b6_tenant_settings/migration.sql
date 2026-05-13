-- B6 · Settings de tenant que el propietario controla desde
-- `/admin/settings` (B6 §4). Añade dos columnas:
--
-- 1. `discount_threshold_pct` (B6 §2): umbral de descuento permitido al
--    cajero sin autorización del encargado. Default 10%. Si el ticket
--    supera este porcentaje, `POST /tickets` exige `authorizationToken`
--    emitido por `/admin/auth/manager-authorize`.
-- 2. `cashier_searchable_contacts` (B6 §4): permite a los cajeros buscar
--    contactos Holded desde el TPV. Default true para mantener el flujo
--    actual; ponerlo a false oculta el botón "Asociar contacto" para
--    cajeros (sólo OWNER/MANAGER puede asociar).
--
-- El campo `gift_receipt_intent_at` (Ticket) ya existe desde B4 — se
-- reutiliza para el frente 5 de B6 sin migración adicional.

ALTER TABLE "tenants"
  ADD COLUMN "discount_threshold_pct" DECIMAL(5, 2) NOT NULL DEFAULT 10,
  ADD COLUMN "cashier_searchable_contacts" BOOLEAN NOT NULL DEFAULT true;

-- Auditoría del descuento autorizado por encargado (B6 §2.4): si el
-- ticket supera el umbral, el handler de POST /tickets persiste aquí
-- el email del MANAGER que validó el PIN.
ALTER TABLE "tickets"
  ADD COLUMN "discount_authorized_by" TEXT;
