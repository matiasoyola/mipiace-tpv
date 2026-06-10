# Dockerfile multi-stage para mipiacetpv.
#
# Produce 3 targets:
#   - api      → contenedor que sirve el API Fastify (CMD: tsx server.ts)
#   - worker   → contenedor que ejecuta los workers BullMQ (CMD: tsx workers/index.ts)
#   - static   → imagen mínima cuyo /export contiene las builds de admin y tpv-web
#                listas para que Caddy las sirva (vía volumen compartido)
#
# Layout pensado para VPS KVM 1 (4 GB RAM, 1 vCPU) — usamos --no-frozen-lockfile
# con prudencia: en CI sí pondríamos --frozen-lockfile, en VPS aceptamos que el
# lockfile del repo sea la fuente de verdad.

# ─────────────────────────────────────────────────────────────────────
# Stage 1 · deps  ·  Instala el workspace completo con pnpm
# ─────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
RUN apk add --no-cache python3 make g++ git openssl ca-certificates

WORKDIR /repo

# Copiamos primero los manifest y el lockfile para aprovechar cache de Docker
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/tpv-web/package.json apps/tpv-web/
COPY packages/db/package.json packages/db/
COPY packages/holded-client/package.json packages/holded-client/
COPY packages/ticket-model/package.json packages/ticket-model/
COPY packages/ticket-pdf/package.json packages/ticket-pdf/
COPY packages/util-validation/package.json packages/util-validation/

RUN pnpm install --frozen-lockfile

# Copiamos el resto del código
COPY . .

# Generamos el Prisma client (lo necesita la API y los tests)
RUN pnpm --filter @mipiacetpv/db run generate

# ─────────────────────────────────────────────────────────────────────
# Stage 2 · build  ·  Construye los 3 outputs (api typecheck, admin dist, tpv-web dist)
# ─────────────────────────────────────────────────────────────────────
FROM deps AS build

# B-SuperAdmin-Shortcuts: URLs canónicas de TPV y API expuestas a la
# build de admin para que conozca dónde redirigir los atajos (sidebar
# de super-admin + botón "TPV modo prueba" en TenantDetailPage). Vite
# inyecta cualquier var que empiece por VITE_ en `import.meta.env`.
# Defaults apuntan a producción `.com`; sobreescribibles desde compose
# vía `build.args` si el entorno necesita otros valores (staging,
# preview…).
ARG VITE_TPV_URL=https://mipiacetpv.com
ARG VITE_API_URL=https://api.mipiacetpv.com
ENV VITE_TPV_URL=${VITE_TPV_URL}
ENV VITE_API_URL=${VITE_API_URL}

# Builds de frontend (Vite produce apps/<x>/dist/)
RUN pnpm --filter @mipiacetpv/admin build
RUN pnpm --filter @mipiacetpv/tpv-web build

# Type-check de la API (no compilamos a JS — corremos con tsx en runtime,
# pero queremos cazar errores aquí, no en producción).
RUN pnpm --filter @mipiacetpv/api exec tsc --noEmit

# ─────────────────────────────────────────────────────────────────────
# Stage 3 · api  ·  Runtime de la API
# ─────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS api
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
RUN apk add --no-cache openssl ca-certificates tini

WORKDIR /repo

# Copiamos del stage `build` todo: node_modules (ya con prisma generado),
# código fuente (la API corre con tsx), y configs.
COPY --from=build /repo /repo

# v1.5-consistencia-A §5.5 · runtime sin root. El cache de imágenes de
# producto se crea aquí con ownership de `node` para que el named
# volume herede los permisos en su primera creación (Docker copia el
# contenido y ownership del mountpoint cuando el volumen está vacío).
# OJO deploy: si el volumen `product_images` ya existe poblado como
# root, hay que hacer chown manual en el VPS (ver done.md del bloque).
RUN mkdir -p /var/cache/mipiacetpv/product-images \
  && chown -R node:node /var/cache/mipiacetpv

ENV NODE_ENV=production
EXPOSE 3001

USER node

# tini como PID 1 para manejar señales correctamente (BullMQ + WebSockets
# necesitan SIGTERM limpio).
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pnpm", "--filter", "@mipiacetpv/api", "start"]

# ─────────────────────────────────────────────────────────────────────
# Stage 4 · worker  ·  Runtime de los workers BullMQ
# ─────────────────────────────────────────────────────────────────────
FROM api AS worker
CMD ["pnpm", "--filter", "@mipiacetpv/api", "exec", "tsx", "src/workers/index.ts"]

# ─────────────────────────────────────────────────────────────────────
# Stage 5 · static  ·  Imagen mínima con los dist de admin y tpv-web
# ─────────────────────────────────────────────────────────────────────
# Caddy monta /export desde aquí vía un servicio "static-publish" que copia
# a un named volume compartido. Ver docker-compose.prod.yml.
FROM alpine:3.20 AS static
WORKDIR /export
COPY --from=build /repo/apps/admin/dist /export/admin
COPY --from=build /repo/apps/tpv-web/dist /export/tpv
CMD ["sh", "-c", "echo 'Static layer ready. Volumen ya poblado via init container.' && tail -f /dev/null"]
