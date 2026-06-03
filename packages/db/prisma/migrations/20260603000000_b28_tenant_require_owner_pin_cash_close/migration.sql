-- v1.4-Bugs-Operativos Lote 1 · setting opcional require_owner_pin_for_cash_close.
--
-- Tras la operativa real con Peluquería Sole se detectó que el flujo
-- existente exigía PIN del OWNER/MANAGER en cualquier escenario que
-- pidiera reautenticación al cerrar caja (sync_failed, force_close),
-- impidiendo que un CASHIER cierre su propio turno sin la presencia
-- física de la propietaria. La operativa por defecto a partir de v1.4
-- es: el PIN del cajero autenticado vale.
--
-- Este flag deja opt-in la antigua política: tenants que quieran
-- mantener la capa de control "sólo OWNER/MANAGER" para cierres de
-- caja pueden activarlo y el endpoint /shift/:id/close rechazará PIN
-- de CASHIER aunque coincida con el de la sesión.

ALTER TABLE "tenants"
    ADD COLUMN "require_owner_pin_for_cash_close" BOOLEAN NOT NULL DEFAULT false;
