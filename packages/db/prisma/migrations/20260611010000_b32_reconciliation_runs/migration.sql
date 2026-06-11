-- v1.5-consistencia-B · Lote 4 · conciliación diaria TPV ↔ Holded.
--
-- Tabla de resultados del cron diario: un run por tenant y pasada.
-- `mismatches` JSON: [{ticket, field, expected, actual}] — vacío en
-- run limpio. Aditiva.

CREATE TABLE "reconciliation_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "run_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tickets_checked" INTEGER NOT NULL,
    "mismatches" JSONB NOT NULL,

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reconciliation_runs_tenant_id_run_at_idx"
    ON "reconciliation_runs"("tenant_id", "run_at");

ALTER TABLE "reconciliation_runs"
    ADD CONSTRAINT "reconciliation_runs_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
