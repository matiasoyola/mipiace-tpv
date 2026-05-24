-- v1.3-Thalia Lote 4 · arqueo por denominaciones.
--
-- Antes el cierre de turno pedía un único campo "efectivo contado"
-- (free-form). Thalía pidió contar por denominaciones (500/200/.../0.01)
-- como hacen otros TPVs serios; además quería poder hacer un "X"
-- (consulta intermedia) sin tener que cerrar el turno.
--
-- Decisión schema: una sola tabla `shift_cash_counts` con un enum
-- `kind = 'X' | 'Z'`. Un shift puede tener N filas X y como mucho 1
-- Z (constraint impuesta a nivel de aplicación, no de BD — el backend
-- ya valida y devuelve 409 si se intenta crear un segundo Z). El JSON
-- `denominations` es libre porque el backend re-calcula el total: el
-- cliente no es de fiar para auditoría fiscal.

-- CreateEnum
CREATE TYPE "ShiftCashCountKind" AS ENUM ('X', 'Z');

-- CreateTable
CREATE TABLE "shift_cash_counts" (
    "id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "kind" "ShiftCashCountKind" NOT NULL,
    "denominations" JSONB NOT NULL,
    "cash_total" DECIMAL(12, 2) NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_cash_counts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shift_cash_counts_shift_id_created_at_idx"
    ON "shift_cash_counts"("shift_id", "created_at");

-- AddForeignKey
ALTER TABLE "shift_cash_counts" ADD CONSTRAINT "shift_cash_counts_shift_id_fkey"
    FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
