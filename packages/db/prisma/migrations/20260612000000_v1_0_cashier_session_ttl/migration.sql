-- v1.0-pilotos · Lote 4 (#18) · TTL de sesión del cajero configurable.
--
-- Nueva columna en tenants: el JWT de sesión del cajero se firma con
-- este TTL (default 720 min = 12 h, el turno entero). El auto-logout
-- por inactividad (cashier_auto_logout_minutes) no cambia. Aditiva.

ALTER TABLE "tenants"
  ADD COLUMN "cashier_session_ttl_minutes" INTEGER NOT NULL DEFAULT 720;
