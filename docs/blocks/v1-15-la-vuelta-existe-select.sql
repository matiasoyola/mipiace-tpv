-- v1.15-la-vuelta-existe §2 · ¿cuánto histórico lleva el error de B1?
--
-- Sólo lee. Se puede lanzar con el TPV vendiendo.
--
--   ssh root@76.13.142.28
--   docker compose exec -T postgres psql -U mipiacetpv -d mipiacetpv -f - < este_fichero.sql
--
-- o pegándolo dentro de `psql -U mipiacetpv -d mipiacetpv`.
--
-- Con el número que salga se decide si el backfill entra en la ventana
-- de este despliegue o va en una aparte:
--
--   pnpm --filter @mipiacetpv/api backfill:vuelta            # informa
--   pnpm --filter @mipiacetpv/api backfill:vuelta -- --apply # escribe
--
-- El script hace exactamente lo mismo que esta consulta (y luego resta
-- la diferencia a la fila CASH). Ver `apps/api/src/tickets/backfill-vuelta.ts`.

WITH t AS (
  SELECT
    tk.id,
    tk.tenant_id,
    tk.internal_number,
    tk.created_at,
    tk.total::numeric                                                        AS total,
    tk.cash_amount::numeric                                                  AS cash_amount,
    COALESCE(SUM(tp.amount), 0)::numeric                                     AS payments_sum,
    COALESCE(SUM(tp.amount) FILTER (WHERE tp.method = 'CASH'), 0)::numeric   AS cash_sum
  FROM tickets tk
  JOIN ticket_payments tp ON tp.ticket_id = tk.id
  WHERE tk.cash_amount IS NOT NULL
  GROUP BY tk.id
),
afectados AS (
  SELECT *, (payments_sum - total) AS exceso
  FROM t
  WHERE payments_sum > total + 0.005   -- Σ pagos por encima del total
    AND cash_sum >= payments_sum - total - 0.005  -- y el exceso sale del cajón
)

-- 1 · el número que hay que traer al bloque.
SELECT
  COUNT(*)                       AS tickets_afectados,
  ROUND(SUM(exceso), 2)          AS importe_inflado_eur,
  MIN(created_at)                AS primer_ticket,
  MAX(created_at)                AS ultimo_ticket,
  COUNT(DISTINCT tenant_id)      AS tenants
FROM afectados;

-- 2 · el mismo recuento por tenant, para saber a quién le cambia el Z.
SELECT
  tenant_id,
  COUNT(*)              AS tickets,
  ROUND(SUM(exceso), 2) AS importe_inflado_eur,
  MIN(created_at)       AS desde,
  MAX(created_at)       AS hasta
FROM afectados
GROUP BY tenant_id
ORDER BY 3 DESC;

-- 3 · los casos raros que el backfill NO va a tocar: Σ pagos > total sin
--     efectivo suficiente para explicarlo. Si sale alguno, se mira a mano
--     antes de aplicar nada.
SELECT
  tenant_id,
  internal_number,
  created_at,
  total,
  payments_sum,
  cash_sum,
  cash_amount
FROM t
WHERE payments_sum > total + 0.005
  AND cash_sum < payments_sum - total - 0.005
ORDER BY created_at;
