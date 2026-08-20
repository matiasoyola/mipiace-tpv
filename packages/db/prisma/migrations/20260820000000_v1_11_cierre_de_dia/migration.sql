-- v1.11 · Cierre de día automático.
--
-- Hallazgo (BD de producción, 2026-08-20): los quince últimos turnos de
-- Peluquería Sole se cierran entre 1 y 4 segundos antes de abrirse el
-- siguiente. No hay auto-cierre en el código: POST /shift/open devuelve
-- 409 SHIFT_ALREADY_OPEN, así que Sole hace el arqueo de ayer de pie,
-- con la tabla de 15 denominaciones, antes de su primera clienta. Los
-- turnos duran 24 h, 70 h en fin de semana, 288 h en vacaciones.
--
-- Migración ADITIVA. Todas las columnas llevan default, así que el
-- backfill es implícito y ninguna fila existente queda inconsistente.

-- ── Tenant ───────────────────────────────────────────────────────────
-- Hora LOCAL (Europe/Madrid) del corte de día. El job `shift-day-cut`
-- cierra a esa hora los turnos abiertos que vienen del día anterior.
ALTER TABLE "tenants"
    ADD COLUMN "day_cut_hour" INTEGER NOT NULL DEFAULT 5;

-- Si true, cerrar turno exige contar el efectivo por denominaciones
-- (comportamiento histórico). Default FALSE a propósito: es el único
-- flag del bloque cuyo default cambia la operativa de quien no toque
-- nada. Decisión de producto (Matías, 2026-08-20).
ALTER TABLE "tenants"
    ADD COLUMN "require_cash_count_on_close" BOOLEAN NOT NULL DEFAULT false;

-- ── Shift ────────────────────────────────────────────────────────────
CREATE TYPE "ShiftCloseReason" AS ENUM ('MANUAL', 'AUTO_DAY_CUT');

-- `closed_by_user_id` dice QUIÉN cerró (NULL cuando cierra el job);
-- esto dice POR QUÉ. Los turnos ya cerrados quedan MANUAL por default:
-- hasta hoy todos los cierres los ejecutó una persona.
ALTER TABLE "shifts"
    ADD COLUMN "close_reason" "ShiftCloseReason" NOT NULL DEFAULT 'MANUAL';

-- Cuándo el cajero confirmó el resumen del día de este turno cerrado.
-- NULL = pendiente de enseñar (la tarjeta aparece al abrir por la
-- mañana). Evita que la tarjeta reaparezca para siempre sin necesitar
-- estado en el cliente.
ALTER TABLE "shifts"
    ADD COLUMN "summary_ack_at" TIMESTAMPTZ;

-- El Z se generó y DESPUÉS entraron ventas (tickets de un outbox
-- offline imputados aquí por su timestamp). El PDF archivado ya no
-- cuadra con la BD; el resumen lo dice en vez de callarlo.
ALTER TABLE "shifts"
    ADD COLUMN "z_report_stale" BOOLEAN NOT NULL DEFAULT false;

-- El job de corte busca turnos abiertos ordenados por apertura; el
-- resumen de la mañana busca el último cerrado sin confirmar. El índice
-- (register_id, closed_at) ya existe y cubre ambos accesos.
