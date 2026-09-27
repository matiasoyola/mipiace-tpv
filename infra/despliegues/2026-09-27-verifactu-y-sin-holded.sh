#!/usr/bin/env bash
# Despliegue del 27-09-2026 · verifactu-1 + 1b + abonos-holded + holded-desconectar.
# Producción pasa de 82902fc a la imagen 6ffa72e.
#
# Es el guion de `docs/blocks/verifactu-1b-done.md` §5 hecho script, con
# puertas: si algo no coincide con lo esperado, PARA antes de tocar nada.
#   Paso 0 · login de GHCR vivo + la imagen existe
#   Paso 1 · copia de la base
#   Paso 2 · qué cajas harían abortar la migración (sólo Sirope y Cachitos)
#   Paso 3 · revocar los 6 dispositivos sobrantes, por id
#   Paso 4 · deploy.sh
#   Paso 5 · las comprobaciones de después
#
# Uso, en el VPS:  cd /opt/mipiacetpv && git pull --ff-only && bash infra/despliegues/2026-09-27-verifactu-y-sin-holded.sh

set -euo pipefail
IMAGE_TAG=6ffa72e
REPO=/opt/mipiacetpv
cd "$REPO"
POSTGRES_USER=$(grep -E '^POSTGRES_USER=' infra/.env.production | cut -d= -f2- | tr -d '"[:space:]')
POSTGRES_DB=$(grep -E '^POSTGRES_DB=' infra/.env.production | cut -d= -f2- | tr -d '"[:space:]')
[ -n "$POSTGRES_USER" ] && [ -n "$POSTGRES_DB" ] || { echo "No leo POSTGRES_USER/POSTGRES_DB de infra/.env.production" >&2; exit 1; }
PSQL=(docker exec -i mipiacetpv-postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -At)
ok()   { echo -e "\033[1;32m[✓]\033[0m $1"; }
para() { echo -e "\033[1;31m[⛔ PARA]\033[0m $1" >&2; exit 1; }

echo "== Paso 0 · GHCR"
docker pull -q "ghcr.io/matiasoyola/mipiacetpv-api:$IMAGE_TAG" >/dev/null \
  || para "No baja la imagen api:$IMAGE_TAG. Si también falla con el tag de producción, es el PAT de GHCR caducado (docker login ghcr.io -u matiasoyola)."
docker pull -q "ghcr.io/matiasoyola/mipiacetpv-static-publish:$IMAGE_TAG" >/dev/null \
  || para "No baja la imagen static-publish:$IMAGE_TAG."
ok "imágenes $IMAGE_TAG disponibles"

echo "== Paso 1 · copia"
mkdir -p ~/backups
DUMP=~/backups/pre-verifactu-1-$(date +%Y%m%d-%H%M).dump
docker exec mipiacetpv-postgres pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > "$DUMP"
BYTES=$(stat -c %s "$DUMP")
[ "$BYTES" -gt 300000 ] || para "La copia pesa $BYTES bytes (se esperaban ~650 KB). No se sigue."
ok "copia $DUMP ($BYTES bytes)"

echo "== Paso 2 · cajas con más de un terminal"
PRECOND_SQL="SELECT r.id
  FROM devices d JOIN registers r ON r.id = d.register_id
 WHERE d.revoked_at IS NULL
   AND coalesce(d.user_agent,'') <> 'internal/mipiacetpv-test'
   AND coalesce(d.name,'')       <> 'mipiacetpv · modo prueba'
 GROUP BY r.id HAVING count(*) > 1 ORDER BY r.id;"
CAJAS=$("${PSQL[@]}" -c "$PRECOND_SQL" | tr '\n' ' ' | sed 's/ $//')
ESPERADAS="446fd941-32c8-44d2-8992-e406fa8adf3e bab6c358-2a02-4c66-85b7-a422b20a0767"
if [ -n "$CAJAS" ] && [ "$CAJAS" != "$ESPERADAS" ]; then
  para "Salen otras cajas que las del ensayo (Sirope y Cachitos). Alguien ha emparejado algo desde el 24-09: hay que decidir cuál se queda."
fi
ok "sólo Sirope y Cachitos (o ya limpias)"

echo "== Paso 3 · revocar los sobrantes"
"${PSQL[@]}" <<'SQL'
BEGIN;
UPDATE devices SET revoked_at = now()
 WHERE revoked_at IS NULL
   AND id IN (
     '11250e41-d67d-4eb2-8f5b-f1cb5cfb0b1d'::uuid,  -- Sirope · se queda 94ffd0dd (AP11 de laboratorio)
     '96574fee-e162-439c-8c1c-7d9ebacde7a5'::uuid,
     '5e0fd499-b992-448a-9673-26337323ccb3'::uuid,
     '96019c0d-25ec-41cb-b05b-5420d8e78e88'::uuid,
     '70e0e35e-c9b8-41bb-9f27-5939f833c071'::uuid,  -- Cachitos · se queda f0845535
     '338b65d3-b615-4154-ab02-dd36828802a6'::uuid
   );
COMMIT;
SQL
QUEDAN=$("${PSQL[@]}" -c "$PRECOND_SQL")
[ -z "$QUEDAN" ] || para "Tras revocar sigue habiendo cajas con más de un terminal. Los last_seen han cambiado desde el ensayo: hay que volver a decidir."
ok "ninguna caja con más de un terminal"

echo "== Paso 4 · deploy"
IMAGE_TAG=$IMAGE_TAG bash infra/deploy.sh

echo "== Paso 5 · después"
DOBLES=$("${PSQL[@]}" -c "SELECT count(*) FROM (SELECT r.id FROM devices d JOIN registers r ON r.id=d.register_id WHERE d.revoked_at IS NULL AND d.kind='TERMINAL' GROUP BY r.id HAVING count(*)>1) x;")
EMITEN=$("${PSQL[@]}" -c "SELECT count(*) FILTER (WHERE NOT holded_enabled) FROM tenants;")
SIN_SERIE=$("${PSQL[@]}" -c "SELECT count(*) FILTER (WHERE fiscal_series IS NULL) || ' / ' || count(*) FILTER (WHERE fiscal_installation_id IS NULL) FROM registers WHERE deleted_at IS NULL;")
CORTADOS=$("${PSQL[@]}" -c "SELECT count(*) FROM tenants WHERE holded_disconnected_at IS NOT NULL;")
echo "  cajas con >1 terminal : $DOBLES   (esperado 0)"
echo "  comercios que emiten  : $EMITEN   (esperado 0)"
echo "  cajas sin serie / inst: $SIN_SERIE   (esperado 0 / 0)"
echo "  comercios sin Holded  : $CORTADOS   (esperado 0)"
echo "  dispositivos por tipo :"; "${PSQL[@]}" -c "SELECT '    '||kind||' '||count(*) FROM devices WHERE revoked_at IS NULL GROUP BY kind ORDER BY kind;"
echo "  tickets / suma        : $("${PSQL[@]}" -c "SELECT count(*)||' / '||coalesce(sum(total),0)::numeric(14,2) FROM tickets;")   (antes 338 / 9162.43 + lo cobrado desde el 24-09)"
[ "$DOBLES" = "0" ] && [ "$EMITEN" = "0" ] && [ "$SIN_SERIE" = "0 / 0" ] && [ "$CORTADOS" = "0" ] \
  || para "Alguna comprobación no da lo esperado. Rollback: IMAGE_TAG=82902fc bash infra/deploy.sh (sin usar el modo prueba en la versión vieja)."
echo "  /health: $(curl -s https://api.mipiacetpv.com/health)"
ok "DESPLEGADO $IMAGE_TAG · copia en $DUMP"
