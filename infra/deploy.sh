#!/usr/bin/env bash
# deploy.sh · despliegue por pull desde GHCR (v1.5-consistencia-B · Lote 1).
#
# Sustituye el rebuild en el VPS (~140 s en 1 vCPU) por un pull de las
# imágenes que CI ya publicó en GHCR. Idempotente: correrlo dos veces
# con el mismo tag no rompe nada.
#
# Uso (desde el VPS, como root):
#
#   cd /opt/mipiacetpv && bash infra/deploy.sh           # deploy de :latest
#   IMAGE_TAG=a1b2c3d bash infra/deploy.sh               # versión concreta
#
# ROLLBACK: deploy de un sha anterior publicado por CI:
#
#   IMAGE_TAG=<sha-anterior> bash infra/deploy.sh
#
# (los tags por sha son inmutables; `docker image ls ghcr.io/matiasoyola/...`
# o la página de packages de GitHub listan los disponibles).
#
# Requiere `docker login ghcr.io` previo en el VPS (una sola vez, con un
# token classic `read:packages` — ver docs/deploy/hostinger.md §9).
#
# Pasos: git pull (compose/Caddyfile) → pull imágenes → migraciones →
# recreate api/worker/static-publish → espera healthchecks → /health.

set -euo pipefail

REPO_DIR="${MIPIACETPV_REPO_DIR:-/opt/mipiacetpv}"
ENV_FILE="$REPO_DIR/infra/.env.production"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$REPO_DIR/infra/docker-compose.prod.yml")
IMAGE_TAG="${IMAGE_TAG:-latest}"
export IMAGE_TAG

log() { echo -e "\033[1;32m[deploy]\033[0m $1"; }
warn() { echo -e "\033[1;33m[deploy]\033[0m $1"; }
fail() { echo -e "\033[1;31m[deploy]\033[0m $1" >&2; exit 1; }

[ -f "$ENV_FILE" ] || fail "No existe $ENV_FILE. ¿Bootstrap hecho? (infra/bootstrap-hostinger.sh)"

cd "$REPO_DIR"

# ─── 1. Repo: compose, Caddyfile y migraciones vienen de git ─────────
log "git pull --ff-only (compose/Caddyfile/migraciones)…"
git pull --ff-only

# ─── 2. Pull de imágenes ─────────────────────────────────────────────
# Si el pull falla (sin login, registry caído) pero las imágenes ya
# existen en local (build vía docker-compose.build.yml), seguimos con
# ellas — la vía local no se rompe.
log "Pull de imágenes GHCR (IMAGE_TAG=$IMAGE_TAG)…"
if ! "${COMPOSE[@]}" pull api worker static-publish; then
  warn "Pull falló — comprobando imágenes locales…"
  docker image inspect "ghcr.io/matiasoyola/mipiacetpv-api:$IMAGE_TAG" >/dev/null 2>&1 \
    || fail "Sin imagen api:$IMAGE_TAG ni acceso a GHCR. ¿docker login ghcr.io? (docs/deploy/hostinger.md §9)"
  docker image inspect "ghcr.io/matiasoyola/mipiacetpv-static-publish:$IMAGE_TAG" >/dev/null 2>&1 \
    || fail "Sin imagen static-publish:$IMAGE_TAG ni acceso a GHCR."
  warn "Usando imágenes locales existentes (tag $IMAGE_TAG)."
fi

# ─── 3. Migraciones Prisma (aditivas — seguras antes del recreate) ──
log "Aplicando migraciones Prisma…"
"${COMPOSE[@]}" run --rm --no-deps api \
  pnpm --filter @mipiacetpv/db exec prisma migrate deploy

# ─── 4. Recreate de los servicios de aplicación ─────────────────────
# --no-deps: postgres/redis/caddy no se tocan (sin corte de SSL ni BD).
log "Recreando api + worker + static-publish…"
"${COMPOSE[@]}" up -d --force-recreate --no-deps api worker static-publish

# ─── 5. Espera healthchecks Docker ──────────────────────────────────
wait_healthy() {
  local container="$1" tries="${2:-30}"
  for i in $(seq 1 "$tries"); do
    local status
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container" 2>/dev/null || echo missing)"
    case "$status" in
      healthy) log "$container healthy."; return 0 ;;
      none)    log "$container sin healthcheck — corriendo."; return 0 ;;
    esac
    sleep 5
  done
  fail "$container no llegó a healthy en $((tries * 5))s. Logs: docker logs $container --tail=100"
}

log "Esperando healthchecks…"
wait_healthy mipiacetpv-api 36     # start_period 30s + margen
wait_healthy mipiacetpv-worker 36  # start_period 60s + margen

# ─── 6. Health HTTP end-to-end ──────────────────────────────────────
log "Probando /health…"
if "${COMPOSE[@]}" exec -T api wget -q --spider http://127.0.0.1:3001/health; then
  log "/health OK."
else
  fail "/health no responde. Logs: ${COMPOSE[*]} logs api --tail=100"
fi

# ─── 7. Resumen ─────────────────────────────────────────────────────
log "Deploy completado."
log "  IMAGE_TAG : $IMAGE_TAG"
log "  api       : $(docker inspect --format '{{.Config.Image}}' mipiacetpv-api 2>/dev/null || echo '?')"
log "  worker    : $(docker inspect --format '{{.Config.Image}}' mipiacetpv-worker 2>/dev/null || echo '?')"
log ""
log "Rollback: IMAGE_TAG=<sha-anterior> bash infra/deploy.sh"
