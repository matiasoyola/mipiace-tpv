# Bloque v1.5-D · Hardening de aislamiento multi-tenant

**Rama:** `v1-5-D-seguridad-multitenant` (worktree nuevo, NO sobre master directo)
**Origen:** auditoría `docs/auditorias/2026-06-10-auditoria-tecnica-completa.md` §1 (Seguridad y multi-tenancy), punto 11 del plan de acción.
**Por qué ahora:** vamos a etiquetar v1.0 e implantar **todos los verticales a la vez** (varios tenants reales cobrando). El aislamiento multi-tenant es la prueba más valiosa de un SaaS y hoy NO existe como test. Este bloque la crea y cierra los huecos residuales.

> **Contexto importante para no duplicar trabajo:** la auditoría es del 2026-06-10 y va por detrás del código. Varias cosas que lista como ALTO/MEDIO **ya están parcialmente resueltas** (B-Hardening A · S5). Tu primer trabajo en cada frente es **verificar el estado actual** y solo cambiar lo que falte. NO asumas que está roto porque lo diga la auditoría. Donde ya esté cubierto, escríbelo en el done.md y añade el test que lo blinde.

---

## Frontera de archivos (estricta)

Este bloque toca SÓLO:

- `apps/api/src/**` (rutas, auth, realtime, middleware) — backend.
- `packages/db/prisma/schema.prisma` + nueva migración en `packages/db/prisma/migrations/**` (sólo si el Frente 5 lo requiere).
- `apps/api/test/**` o `apps/api/src/**/*.test.ts` — tests nuevos.
- `docs/blocks/v1-5-D-seguridad-done.md` (done.md de cierre).

**NO toques:** `apps/tpv-web/**`, `apps/admin/**`, `apps/tpv-android/**`, `infra/**`, ningún otro prompt. Si crees que hace falta tocar frontend, **párate y anótalo en el done.md como carryover** — no lo hagas en este bloque.

---

## Frente 1 — Suite de aislamiento multi-tenant (LO MÁS IMPORTANTE)

Crea un test parametrizado que, para cada familia de endpoints autenticados (cashier-session y admin/owner), monte **dos tenants** (A y B) con datos sembrados y verifique que un actor del tenant A **nunca** puede leer ni mutar recursos del tenant B. Resultado esperado siempre: `404` o `403`, **nunca** `200` con datos ajenos ni `409` que confirme existencia.

Endpoints mínimos a cubrir (ampliar si detectas más con datos por-tenant):

- Tickets: crear (idempotencia por `externalId`), checkout de mesa, GET por id, historial.
- Refunds: crear (idempotencia por `externalId`), GET.
- Catálogo: productos, búsqueda, contactos.
- Mesas/zonas: listar, mover líneas, agrupar/desagrupar.
- Turnos: abrir/cerrar, force-close, informe Z.
- Admin: tiendas, cajas, cajeros, settings, bandeja tickets-errors.

Patrón sugerido: tabla `[{ method, path, buildBodyForTenant }]` y un loop que ejecute cada caso con credenciales de A apuntando a IDs de B. Reutiliza los helpers de seed existentes en `apps/api/test/`.

**Criterio de aceptación del frente:** el test falla hoy en los huecos reales (al menos el del Frente 2) y pasa al cerrarlos. Deja constancia en el done.md de cuántos endpoints cubre.

---

## Frente 2 — Guardia de tenant en idempotencia por `externalId`

`Ticket.externalId` y `Refund.externalId` son **únicos globales** (no por tenant), así que los `findUnique({ where: { externalId } })` resuelven sin filtro de tenant y hay que asertar el tenant **después** del lookup.

- ✅ **Ya cubierto** (de modelo): `apps/api/src/tickets/routes.ts:~200` (creación de ticket) ya hace `if (existing.tenantId !== cashier.tid)` → `409` genérico (B-Hardening A · S5). Úsalo como patrón canónico.
- ❌ **Hueco confirmado:** `apps/api/src/tickets/routes.ts:~1267` — la idempotencia de **refund** hace `prisma.refund.findUnique({ where: { externalId } })` y devuelve `serializeRefund(existing)` con `duplicate:true` **sin comprobar `existing.tenantId === cashier.tid`**. Un `externalId` de refund de otro tenant filtraría el objeto serializado. **Aplica la misma guardia que en la ruta de ticket** (respuesta genérica que no confirme existencia cross-tenant).
- ⚠️ **Revisar (defensivo):** los `holdedUpload.upsert({ where: { externalId }, create: {...tenantId...}, update: {} })` en `routes.ts:~484, ~828, ~1422`. El `update` es no-op y el `externalId` es UUID v4, así que el riesgo práctico es nulo, pero documenta en el done.md si decides añadir una aserción de tenant tras el upsert o lo dejas como está con justificación.
- **Audita TODOS los `where: { externalId` del backend** (`apps/api/src/tickets/*.ts`, `apps/api/src/admin/tickets-errors.ts`, workers): los que corren en contexto de worker ya conocen su tenant; los expuestos por HTTP deben asertar `cashier.tid`/owner tenant. Lista en el done.md cuáles revisaste y el veredicto de cada uno.

---

## Frente 3 — Rate-limit en confirmación de password-reset y 2FA

Ya existe infraestructura de rate-limit: `apps/api/src/auth/rate-limit.ts` (`throttle`, `passwordResetThrottle`) y `apps/api/src/superadmin/rate-limit.ts`. Verifica que los endpoints de **confirmación** (no sólo de solicitud) están throttleados contra fuerza bruta del token/código:

- Confirmación de password-reset (consumo del token).
- Verificación de código 2FA (super-admin y, si existe, owner).

Si ya lo están, añade un test que lo demuestre. Si no, aplícales el throttle existente (clave por IP + identificador) con un test que verifique el bloqueo tras N intentos.

---

## Frente 4 — WebSocket: confirmar binding de tenant/store

`apps/api/src/realtime/ws-route.ts` ya valida que el `register` del JWT (`payload.rid`) pertenece al `storeId` solicitado (`findFirst({ where: { id: payload.rid, storeId, deletedAt: null } })`) y cierra con `4403` si no. Eso ata la suscripción al store real del cajero.

- **Verifica** que no hay forma de suscribirse a eventos de otro tenant (p. ej. que `getStoreEventBus().subscribe(storeId, ...)` no entregue eventos cross-tenant si dos tenants tuvieran storeIds colisionables — los storeId son UUID, confirma).
- Añade un test de WS: cajero de A no recibe eventos `table.*`/`ticket.*` emitidos para un store de B.
- Si el binding ya es correcto (probable), el entregable de este frente es **el test** + una línea en el done.md confirmándolo. No reescribas lo que ya funciona.

---

## Frente 5 — Email único por tenant (evaluar, no forzar)

La auditoría sugiere `@@unique([tenantId, email])` para usuarios OWNER/cajero. **Antes de migrar**, comprueba en `packages/db/prisma/schema.prisma` cómo está hoy la unicidad de email en los modelos de usuario y si el rate-limit de login ya es por `(tenant, email)` — en `apps/api/src/shift/cashier-auth.ts` la clave de rate-limit ya es `rateLimitKeyFor(tenantId, email)`, lo que sugiere que el modelo cashier ya está pensado por-tenant.

- Si el email **ya** es único por-tenant (o el cajero se identifica por register+PIN y no por email global), **no hagas migración** — sólo documenta el hallazgo.
- Si hay un `@unique` global de email que provoca colisión de OWNERs entre tenants, propón la migración `@@unique([tenantId, email])` **pero NO la apliques a ciegas**: déjala escrita + el análisis de impacto (datos existentes, login flow) en el done.md y márcala como "requiere visto bueno" — puede afectar al login y prefiero revisarla.

---

## Reglas de cierre

1. `pnpm test` (workspace API) **verde, 0 failed** antes de cerrar. Reporta el número de tests antes/después.
2. `pnpm --filter @mipiacetpv/api exec tsc --noEmit` limpio.
3. Si tocas schema: migración nueva con nombre descriptivo, `prisma migrate` aplicable, y schema y migración commiteados juntos. **No** apliques migración en VPS (eso lo hago yo).
4. Escribe `docs/blocks/v1-5-D-seguridad-done.md` con: qué estaba ya cubierto, qué huecos cerraste, qué tests añadiste (y cuántos endpoints cubre la suite de aislamiento), carryovers, y cualquier decisión que requiera mi visto bueno (Frente 5).
5. Push de la rama. **No mergees a master** — el merge y el deploy los hago yo tras revisar.
6. Marco fiscal: este bloque NO toca lógica fiscal. Holded es el SIF; nosotros sólo mandamos salesreceipts. No introduzcas numeración ni cálculo fiscal nuevo.

## Fuera de alcance (carryovers conocidos, NO en este bloque)

- Unificación de aritmética de dinero en `packages/ticket-model` (bloque propio, toca frontend).
- Rotación de la clave maestra de cifrado (`HOLDED_KEY_ENCRYPTION_SECRET`) — operativa/infra.
- `publicSlug` del PDF a 96+ bits / TTL — candidato a mini-bloque aparte.
- Revocación inmediata de impersonación super-admin (Redis) — BAJO, diferido.
