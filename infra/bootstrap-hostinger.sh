#!/usr/bin/env bash
# bootstrap-hostinger.sh
#
# Script idempotente para desplegar mipiacetpv en un VPS Hostinger limpio
# (Ubuntu 24.04). Se puede correr varias veces sin romper nada — sólo
# aplica lo que falta.
#
# Uso (desde el VPS, como root):
#
#   curl -sSL https://raw.githubusercontent.com/matiasoyola/mipiace-tpv/master/infra/bootstrap-hostinger.sh | bash
#
# O si ya tienes el repo clonado:
#
#   cd /opt/mipiacetpv && bash infra/bootstrap-hostinger.sh
#
# El script:
#   1. Instala Docker si falta.
#   2. Clona el repo en /opt/mipiacetpv (o lo actualiza con git pull).
#   3. Verifica que infra/.env.production existe (si no, copia el example
#      y para — espera que rellenes los secretos).
#   4. Construye las imágenes Docker.
#   5. Levanta postgres + redis primero, espera a que estén healthy.
#   6. Aplica migraciones Prisma.
#   7. Levanta api + worker + caddy.
#   8. Health check final.

set -euo pipefail

REPO_URL="${MIPIACETPV_REPO_URL:-https://github.com/matiasoyola/mipiace-tpv.git}"
REPO_DIR="${MIPIACETPV_REPO_DIR:-/opt/mipiacetpv}"
BRANCH="${MIPIACETPV_BRANCH:-master}"

log() { echo -e "\033[1;32m[bootstrap]\033[0m $1"; }
warn() { echo -e "\033[1;33m[bootstrap]\033[0m $1"; }
fail() { echo -e "\033[1;31m[bootstrap]\033[0m $1" >&2; exit 1; }

# ─── 1. Docker ──────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  log "Docker no instalado. Instalando…"
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
else
  log "Docker ya presente: $(docker --version)"
fi

if ! docker compose version >/dev/null 2>&1; then
  fail "Docker compose v2 no disponible. ¿Instalación de docker antigua?"
fi

# ─── 1.5. Liberar puerto 80 si hay nginx system corriendo ────────
# El template Ubuntu 24.04 LTS de Hostinger viene con nginx pre-instalado
# y activo bindeando 0.0.0.0:80 → Caddy no puede arrancar
# (`address already in use`). Hotfix post-deploy 2026-05-18.
if systemctl is-active --quiet nginx 2>/dev/null; then
  warn "nginx system activo en puerto 80, parando para que Caddy pueda usarlo…"
  systemctl stop nginx
  systemctl disable nginx
  log "nginx system parado y deshabilitado."
fi

# ─── 2. Repo ────────────────────────────────────────────────────────
if [ ! -d "$REPO_DIR/.git" ]; then
  log "Clonando $REPO_URL en $REPO_DIR…"
  mkdir -p "$(dirname "$REPO_DIR")"
  git clone --branch "$BRANCH" "$REPO_URL" "$REPO_DIR"
else
  log "Repo ya clonado, haciendo git pull…"
  cd "$REPO_DIR"
  git fetch origin
  git checkout "$BRANCH"
  git pull --ff-only origin "$BRANCH"
fi

cd "$REPO_DIR"

# ─── 3. .env.production ─────────────────────────────────────────────
ENV_FILE="$REPO_DIR/infra/.env.production"
ENV_EXAMPLE="$REPO_DIR/infra/.env.production.example"

if [ ! -f "$ENV_FILE" ]; then
  log "No hay $ENV_FILE. Copiando del example…"
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  warn "Rellena los secretos REPLACE_ME en $ENV_FILE y vuelve a correr este script."
  warn "Genera secretos con:"
  warn "  openssl rand -base64 48  ← para JWT_*_SECRET y SUPER_ADMIN_JWT_SECRET"
  warn "  openssl rand -base64 32  ← para HOLDED_KEY_ENCRYPTION_SECRET y POSTGRES_PASSWORD"
  exit 1
fi

if grep -q "REPLACE_ME" "$ENV_FILE"; then
  fail "$ENV_FILE todavía contiene placeholders REPLACE_ME. Rellénalos antes de continuar."
fi

# ─── 4. Imágenes ────────────────────────────────────────────────────
# v1.5-consistencia-B · Lote 1: el camino normal es pull desde GHCR
# (CI publica en cada push a master; requiere `docker login ghcr.io`
# previo). Si el pull falla (registry caído, sin login, primer arranque
# sin red al registry), caemos al build local vía el override
# docker-compose.build.yml — mismo resultado, ~10 min en 1 vCPU.
log "Bajando imágenes desde GHCR…"
if ! docker compose --env-file "$ENV_FILE" -f infra/docker-compose.prod.yml pull api worker static-publish; then
  warn "Pull de GHCR falló — construyendo imágenes en local (override build)…"
  docker compose --env-file "$ENV_FILE" \
    -f infra/docker-compose.prod.yml -f infra/docker-compose.build.yml build
fi

# ─── 5. Postgres + Redis ────────────────────────────────────────────
log "Levantando postgres + redis…"
docker compose --env-file "$ENV_FILE" -f infra/docker-compose.prod.yml up -d postgres redis

log "Esperando a que postgres esté healthy…"
for i in {1..30}; do
  if docker compose --env-file "$ENV_FILE" -f infra/docker-compose.prod.yml exec -T postgres pg_isready -U mipiacetpv -d mipiacetpv >/dev/null 2>&1; then
    log "Postgres listo."
    break
  fi
  sleep 2
  if [ "$i" = "30" ]; then fail "Postgres no respondió en 60s."; fi
done

# ─── 6. Migraciones Prisma ──────────────────────────────────────────
log "Aplicando migraciones Prisma…"
docker compose --env-file "$ENV_FILE" -f infra/docker-compose.prod.yml run --rm api \
  pnpm --filter @mipiacetpv/db exec prisma migrate deploy

# ─── 7. Resto del stack ─────────────────────────────────────────────
log "Levantando api + worker + static-publish + caddy…"
docker compose --env-file "$ENV_FILE" -f infra/docker-compose.prod.yml up -d

# ─── 8. Health check ────────────────────────────────────────────────
log "Esperando a que la API arranque…"
sleep 5
for i in {1..20}; do
  if docker compose --env-file "$ENV_FILE" -f infra/docker-compose.prod.yml exec -T api wget -q --spider http://localhost:3001/health 2>/dev/null; then
    log "API healthy."
    break
  fi
  sleep 3
  if [ "$i" = "20" ]; then warn "API no respondió en 60s al health check. Revisa logs: docker compose -f infra/docker-compose.prod.yml logs api"; fi
done

log "Done. Stack levantado."
log ""
log "Próximos pasos:"
log "  1. DNS: apuntar A records de mipiacetpv.com / admin.mipiacetpv.com / api.mipiacetpv.com (canónicos) y de los .tech equivalentes (legacy 301) al IP de este VPS."
log "  2. Cuando los DNS propaguen (1-30 min), Caddy obtendrá SSL Let's Encrypt automáticamente al primer acceso."
log "  3. Crear el primer super-admin:"
log "     docker compose --env-file infra/.env.production -f infra/docker-compose.prod.yml exec api \\"
log "       pnpm --filter @mipiacetpv/api super-admin:create"
log "  4. Loguearse en https://admin.mipiacetpv.com/superadmin y dar de alta el primer tenant (Thalia)."
