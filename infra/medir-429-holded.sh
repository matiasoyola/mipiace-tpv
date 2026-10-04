#!/usr/bin/env bash
# medir-429-holded.sh · ¿Holded nos está cortando por cuota? (handoff 04-10, paso 3)
#
# Se corre EN EL VPS (desde el Mac: ssh root@<vps> 'bash -s' < infra/medir-429-holded.sh).
# Sólo lee: no toca colas, ni BD, ni contenedores.
#
# Por qué mira aquí y no en `docker logs`:
#   - deploy.sh recrea api y worker, y con ellos se van sus logs: tras un
#     despliegue sólo queda lo escrito desde que arrancó la versión nueva.
#   - el cliente de Holded reintenta los 429 en silencio (retry.ts): un 429
#     que se recupera no deja rastro en ningún sitio.
#   Lo que SÍ sobrevive: los jobs fallidos que BullMQ guarda en Redis (AOF,
#   volumen propio) con su failedReason ("Holded API 429 on …"), y el
#   last_error de holded_uploads que no han llegado a DONE.
#   O sea: esto ve los 429 que AGOTARON los reintentos. Un cero aquí no
#   prueba que no haya 429; uno o más prueba que ya hay daño.
set -u
cd /opt/mipiacetpv
PGU=$(grep -E '^POSTGRES_USER=' infra/.env.production | cut -d= -f2-)
PGD=$(grep -E '^POSTGRES_DB=' infra/.env.production | cut -d= -f2-)
psql_q() { docker exec -i mipiacetpv-postgres psql -U "$PGU" -d "$PGD" -At -F '|' -c "$1"; }

read -r -d '' LUA <<'EOF'
local out = {}
for _, q in ipairs(ARGV) do
  local ids = redis.call('ZRANGE', 'bull:' .. q .. ':failed', 0, -1)
  local n429, oldest = 0, nil
  for _, id in ipairs(ids) do
    local k = 'bull:' .. q .. ':' .. id
    local f = tonumber(redis.call('HGET', k, 'finishedOn') or '') or 0
    if f > 0 and (oldest == nil or f < oldest) then oldest = f end
    local r = redis.call('HGET', k, 'failedReason') or ''
    if string.find(r, '429', 1, true) then
      n429 = n429 + 1
      local d = redis.call('HGET', k, 'data') or ''
      local t = string.match(d, '"tenantId":"([^"]+)"') or '?'
      table.insert(out, 'J|' .. q .. '|' .. f .. '|' .. t .. '|' .. string.sub(r, 1, 90))
    end
  end
  table.insert(out, 'Q|' .. q .. '|' .. #ids .. '|' .. n429 .. '|' .. tostring(oldest or 0))
end
return out
EOF

psql_q "select id, name from tenants" > /tmp/m429-tenants.txt
docker exec mipiacetpv-redis redis-cli EVAL "$LUA" 0 \
  catalog-incremental ticket-upload refund-upload initial-sync \
  reconciliation-daily product-image-cache > /tmp/m429-redis.txt

echo "== 1 · Colas de BullMQ (jobs fallidos que Redis conserva)"
awk -F'|' '$1=="Q"{ o = ($5>0) ? strftime("%Y-%m-%d", int($5/1000)) : "—";
  printf "  %-22s fallidos=%-4s con429=%-4s más antiguo=%s\n", $2, $3, $4, o }' /tmp/m429-redis.txt

echo "== 2 · 429 por cliente y día (sólo los que agotaron reintentos)"
awk -F'|' 'NR==FNR { n[$1]=$2; next }
  $1=="J" { k = (($4 in n) ? n[$4] : $4) " · " $2 " · " strftime("%Y-%m-%d", int($3/1000)); c[k]++ }
  END { if (length(c)==0) print "  (ninguno)"; for (k in c) printf "  %4d  %s\n", c[k], k }' \
  /tmp/m429-tenants.txt /tmp/m429-redis.txt | sort -k3

echo "== 3 · holded_uploads con un 429 en last_error (no llegaron a DONE)"
psql_q "select t.name, u.kind, u.status, count(*), to_char(max(u.last_attempt_at),'YYYY-MM-DD HH24:MI')
        from holded_uploads u join tenants t on t.id = u.tenant_id
        where u.last_error::text ilike '%429%' group by 1,2,3 order by 1" \
  | sed 's/^/  /;' | grep . || echo "  (ninguno)"

echo "== 4 · Último sync de catálogo por cliente con Holded (cada 15 min si va bien)"
psql_q "select name, to_char(last_incremental_sync_at,'YYYY-MM-DD HH24:MI'),
               coalesce(left(last_incremental_sync_stats->'errors'->0->>'message', 90), 'ok')
        from tenants where holded_api_key_ciphertext is not null order by 2 desc nulls last" \
  | sed 's/^/  /'

rm -f /tmp/m429-tenants.txt /tmp/m429-redis.txt
