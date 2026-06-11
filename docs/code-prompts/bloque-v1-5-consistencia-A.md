# Bloque v1.5-Consistencia-A · CI + suite verde + integridad transaccional + errores + infra

**Rama:** `v1-5-consistencia-a` (worktree limpio desde master)
**Origen:** auditoría técnica completa `docs/auditorias/2026-06-10-auditoria-tecnica-completa.md`
**Objetivo:** cerrar las carencias operativas y de integridad señaladas en la auditoría. Este bloque NO añade features de producto. Es la base para poder defender el producto como monetizable.
**Estimación:** 2-3 días Code.
**Entrega:** un único commit, sin merge. Cerrar con `git log --oneline -1` + `pnpm test` íntegramente en verde + `docs/blocks/v1-5-consistencia-A-done.md` con findings.

**Prerequisito (lo resuelve Matías antes de crear el worktree):** master debe estar limpio — hay un merge de `v1-4-precio-decimales` a medio resolver (conflicto en `docs/errores/README.md`). No empezar hasta que `git status` esté limpio y la b30 esté commiteada.

---

## Lote 1 · Suite de tests 100% en verde (BLOQUEANTE para el Lote 2)

Hay ~16 tests fallando crónicamente en master (carryovers conocidos: pairing-route, image-cache-worker, upload-ticket, salesreceipt — causas Redis/jsdom/holded-client). Esto lleva semanas normalizando el rojo y anula el valor de la suite.

Para CADA test fallido, en este orden de preferencia:
1. **Arreglarlo** si la causa es del test (mock de Redis ausente, entorno jsdom mal configurado, fixture desfasada).
2. Si requiere infraestructura real no disponible en CI (Redis vivo), convertirlo para usar `ioredis-mock` o el patrón de inyección que ya use el resto de la suite.
3. Solo como último recurso: `it.skip` con comentario `// SKIP(v1.5): <causa> — ticket #<n>` y entrada en el done.md justificándolo. Máximo 4 skips; si necesitas más, documenta por qué y para.

**Criterio de aceptación:** `pnpm test` desde la raíz termina con 0 failed. Sin reducir cobertura real: prohibido borrar tests.

## Lote 2 · CI con GitHub Actions

Crear `.github/workflows/ci.yml`:

- Triggers: `push` a cualquier rama y `pull_request`.
- Node 20 + pnpm 9.12.0 (la versión exacta del Dockerfile, con corepack) + cache de pnpm store.
- Jobs (pueden ser steps secuenciales en un job si es más simple):
  1. `pnpm install --frozen-lockfile`
  2. `pnpm --filter @mipiacetpv/db run generate`
  3. Typecheck: `tsc --noEmit` en api, tpv-web, admin y packages con tsconfig propio (replica lo que hace el Dockerfile en build, que es donde hoy revientan los deploys).
  4. `pnpm test`
  5. Builds de Vite: `pnpm --filter @mipiacetpv/admin build && pnpm --filter @mipiacetpv/tpv-web build`
- Si algún test necesita servicios: usar `services:` de Actions (redis:7) solo si el Lote 1 no consiguió mockearlo todo; preferible que la suite no dependa de servicios.
- NO montar todavía publicación de imágenes Docker a registry (eso es v1.5-B; no lo arrastres a este bloque).

**Criterio de aceptación:** el workflow es sintácticamente válido (`actionlint` si está disponible, o revisión manual cuidadosa) y todos sus comandos pasan en local exactamente como los ejecutará el runner.

## Lote 3 · Integridad transaccional (apps/api/src/tickets/routes.ts)

### 3.a ticketCounter dentro de la transacción
Hoy el incremento `register.update({ data: { ticketCounter: { increment: 1 } } })` se ejecuta ANTES de `prisma.$transaction` en TRES sitios (POST /tickets ~línea 396, POST /tickets/:id/checkout ~724, POST /refunds ~1295). Si la transacción posterior falla, el número queda quemado → huecos de numeración interna (sensible en auditoría fiscal).

Mover el incremento DENTRO del `$transaction` en los tres sitios (usando `tx.register.update`). OJO: no hay riesgo de colisión actual (el increment es atómico) — el objetivo es solo eliminar los huecos. No cambiar el formato del número ni el constraint `@@unique([registerId, internalNumber])`.

**Tests:** simular fallo dentro de la transacción (p.ej. payload que viole un constraint) y verificar que `ticketCounter` NO avanzó.

### 3.b Sweeper de HoldedUpload huérfanos
Hoy `enqueueTicketUpload` se llama FUERA de la transacción (~línea 467) y si Redis falla en ese instante el ticket queda PENDING_SYNC para siempre (solo se loguea). Mantener ese diseño (encolar fuera de tx es correcto) pero añadir red de seguridad:

- Job repetible BullMQ (o setInterval en el worker si es más simple y robusto) cada 5 min: busca `HoldedUpload` con `status: PENDING` y `createdAt < now() - 10min` cuyo job no exista en la cola, y los re-encola. Idempotente: usar `jobId` derivado del externalId para que BullMQ deduplique.
- Mismo barrido para refunds si usan tabla/cola distinta.
- Log estructurado de cuántos rescató en cada pasada (si > 0, es señal de problema → será alertable en v1.5-B).

**Tests:** upload PENDING viejo sin job → el sweeper lo encola; upload PENDING con job ya en cola → no duplica.

### 3.c Refunds: ignorar refunds fallidos al calcular lo ya devuelto
En POST /refunds (~línea 1226), el mapa `alreadyRefunded` itera `ticket.refunds` sin filtrar por status: un refund SYNC_FAILED bloquea devoluciones legítimas de esas líneas. Filtrar para contar solo refunds en estados que representan devolución efectiva (revisa el enum real: SYNCED/DONE/PENDING_SYNC cuentan; FAILED/cancelados no — decide con el enum delante y documenta el criterio en comentario).

**Tests:** refund fallido previo no bloquea un refund nuevo de las mismas líneas; doble refund efectivo de la misma unidad sigue rechazado.

## Lote 4 · Manejo de errores global

### 4.a API: setErrorHandler de Fastify
- `app.setErrorHandler` global en `server.ts` (o plugin dedicado `apps/api/src/lib/error-handler.ts`):
  - Errores de validación zod → 400 con detalle.
  - Errores del holded-client (rate limit, 4xx de Holded) → mapear a códigos propios (502 HOLDED_UNAVAILABLE, etc.), nunca 500 genérico, y loguear con contexto (tenantId, endpoint Holded, status).
  - Resto → 500 con `requestId` en la respuesta y stack solo en logs (nunca al cliente).
- Respetar la política existente de mensajes de error en español (task #10 del backlog: si hay doc/convención en docs/errores/README.md, seguirla).

### 4.b Frontends: ErrorBoundary en React
- `ErrorBoundary` raíz en tpv-web Y admin: pantalla amable en español con botón "Recargar" y, en tpv-web, aviso de que la venta en curso del carrito local NO se pierde (verificar que el estado del carrito sobrevive a un remount — si no sobrevive, persistirlo en sessionStorage/IndexedDB como parte de este lote).
- Capturar también `window.onunhandledrejection` y loguear a consola estructurada (gancho futuro para Sentry; NO integrar Sentry en este bloque, va en v1.5-B con la cuenta creada).

**Tests:** unit del error handler de la API (zod 400, error Holded → 502 mapeado, error genérico → 500 sin stack). Para ErrorBoundary, test de render con componente que lanza.

## Lote 5 · Infra endurecida (infra/)

1. **Rotación de logs** en `docker-compose.prod.yml` y `docker-compose.yml`: `logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }` en todos los servicios.
2. **Redis con persistencia AOF**: `command: redis-server --appendonly yes` + volumen si no lo tiene. Verificar que BullMQ no necesita config extra.
3. **Healthcheck del worker**: el worker escribe heartbeat en Redis (`SET worker:heartbeat <ts> EX 120`) cada 30s; healthcheck del contenedor comprueba que la key existe. Así Docker detecta worker colgado (hoy es el único servicio sin healthcheck).
4. **backup-postgres.sh**: añadir `gzip -t` del dump (si falla → borrar + exit 1 con mensaje claro), `sha256sum` junto al archivo, y retry ×3 con sleep en la subida B2. No tocar la retención.
5. **Dockerfile**: `USER node` (o usuario no-root equivalente) en las imágenes de runtime api/worker. Verificar permisos de volúmenes que toque.

**Criterio de aceptación:** `docker compose -f infra/docker-compose.prod.yml config` valida sin errores. Documentar en el done.md cualquier cambio que requiera acción manual en el VPS al deployar (p.ej. si AOF necesita volumen nuevo).

---

## Reglas del bloque

- NO tocar: lógica de precios/decimales (acaba de entrar con b30), SalePage.tsx (hotfixes recientes), nada de apps/tpv-android, nada del flujo offline de CheckoutPage (outbox va en bloque C dedicado).
- Sin dependencias nuevas salvo justificación en done.md (ioredis-mock para tests sí está preautorizado).
- Migración de BD: este bloque NO debería necesitar ninguna. Si descubres que sí, para y documenta antes de crearla.
- Cualquier hallazgo fuera de alcance → anotarlo en done.md, no arreglarlo.

## Definición de hecho

1. `pnpm test` 0 failed (incluye los nuevos tests de los lotes 3 y 4).
2. `tsc --noEmit` limpio en todos los targets que el CI compila.
3. `.github/workflows/ci.yml` listo para que el primer push de la rama lo ejecute en verde.
4. `docs/blocks/v1-5-consistencia-A-done.md` con: resumen por lote, lista de tests skipeados y por qué, acciones manuales de deploy, hallazgos fuera de alcance.
5. Un único commit: `v1.5-consistencia-A · CI + suite verde + integridad transaccional + error handling + infra`.
