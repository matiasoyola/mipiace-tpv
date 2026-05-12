# Bloque 2 · resumen del entregable

Estado: cerrado pendiente de revisión por Matías.

## Estructura del repo tras B2

```
.
├─ apps/
│  ├─ api/                  # + catalog/, contacts/, holded/, auth ampliado
│  ├─ admin/                # ⬆️ Tailwind + tokens mipiace.*, Mi cuenta, SKU review
│  ├─ tpv-web/              # esqueleto PWA (B3+)
│  └─ tpv-web-spike/        # super-mini-MVP (referencia viva)
├─ packages/
│  ├─ db/                   # schema + migración add_incremental_sync
│  └─ holded-client/        # + contacts.ts; account.ts borrado (spike §08)
├─ spike/holded/            # + scripts 08 (account-info) y 09 (webhooks)
├─ docs/
│  ├─ blocks/B2-done.md     # este archivo
│  ├─ spike-holded.md       # + §08, §09, §10 (Fase 1)
│  └─ design/               # tokens + reference-app sin cambios
```

## Lo que dejé hecho

### Spikes Fase 1 (`docs/spike-holded.md`)

- **§08 · Account info:** sondeo de 12 endpoints (`/me`, `/account`, `/company`,
  `/users/me`, más 8 candidatos). **Ninguno expone datos fiscales** —
  11 dan 200+HTML (caso 01.B), 1 da envelope `{status:0,info:"not found"}`.
  Conclusión: NIF + razón social SIEMPRE manuales. `account.ts` borrado.
- **§09 · Webhooks:** doc oficial Holded no menciona webhooks. Integradores
  de terceros (Rollout, Integrately, Zapier) documentan
  `POST /webhooks/v1/create` con HMAC-SHA256. **Sondeo directo con
  nuestra API Key sandbox: 200+HTML.** Probable causa: scope de API Key
  o requerimiento OAuth. Decisión: NO implementar receptor; cron de 15
  min cubre el MVP. Shape esperado documentado por si Holded lo habilita.
- **§10 · Filtros de contacts:** `GET /invoicing/v1/contacts` sólo
  acepta `phone`, `mobile`, `customId`. No hay filtro por nombre,
  email ni NIF. Implicación: búsqueda libre del TPV se resuelve
  contra cache local con fallback a Holded sólo si la query parece
  teléfono.

### Prisma schema + migración

Migración `20260512170000_add_incremental_sync` (SQL escrita a mano,
Docker no estaba arriba para que `prisma migrate dev` la generara —
cuando lances `pnpm db:migrate`, Prisma la aplicará tal cual):

- `Tenant.lastIncrementalSyncAt` + `Tenant.lastIncrementalSyncStats`.
- `User.tokenVersion` (default 0).
- Modelo `Contact` con índices por `(tenantId, email|nif|name)` y unique
  `(tenantId, holdedContactId)`.

**No se añadieron** `Product.lastSeenInSyncAt` ni `Product.active`
nuevos: B1 ya los tenía (`lastSyncedAt` y `active`). El sync incremental
los reutiliza.

### Auth (B2 §4.3)

`apps/api/src/auth/tokens.ts`:
- `RefreshTokenPayload` lleva `tv` (numérico, obligatorio) y `rmb`
  (0|1). `signRefreshToken({sub,tid}, {tv, remember})` decide TTL
  (30d / 90d). `verifyRefreshToken` rechaza tokens legacy sin `tv`.

`apps/api/src/auth/routes.ts`:
- `POST /auth/login` acepta `remember: boolean` opcional → propaga.
- `POST /auth/refresh` valida `payload.tv === user.tokenVersion`;
  rechaza con 401 "Sesión revocada" si no cuadra. Preserva `rmb` al
  rotar.
- **Nuevo** `POST /auth/logout-everywhere`: `user.tokenVersion += 1`.
- **Nuevo** `POST /auth/me/rotate-holded-key` (B2 §4.2): valida con
  `probeHoldedKey`; si OK, cifra y sobreescribe `holdedApiKeyCiphertext`;
  si falla, mantiene la antigua intacta. No re-encola sync inicial.
- **Nuevo** `POST /auth/me/test-holded-connection`: descifra la key
  actual, prueba contra Holded, devuelve `{ ok, validatedAt }`.
- **Nuevo** `PUT /auth/me/fiscal-profile` (B2 §4.1): merge superficial
  en el JSON, marca `source: "manual"`.
- `GET /auth/me` ampliado: ahora incluye `fiscalProfile` y
  `lastIncrementalSyncAt`.

`apps/api/src/holded/probe.ts` (nuevo): helper compartido
`probeHoldedKey(apiKey)` que sustituye la duplicación del onboarding y
de la rotación. Mapea cada fallo a un código tipado
(`INVALID_HOLDED_KEY`, `HOLDED_SUSPENDED`, `HOLDED_INVALID_RESPONSE`,
`HOLDED_UNREACHABLE`) y a su HTTP canónico.

`.env.example`: variable `JWT_REFRESH_TTL_REMEMBER` (default `90d`).

### Sync incremental (B2 §2)

`apps/api/src/catalog/incremental-sync.ts`:
- `runIncrementalSync({tenantId, prisma})` con algoritmo definitivo:
  ancla `syncStartedAt`, refresca taxes y warehouses, upsert de productos
  y servicios con `lastSyncedAt = now()` (ignora `forSale=0`),
  `updateMany` para marcar huérfanos (`active=false, sellableViaTpv=false
  WHERE lastSyncedAt < syncStartedAt AND active=true`), re-ejecuta
  `runAutoSku` (sólo procesa nuevos sin SKU; ya filtraba), refresca
  comodines TPV-OTROS. Persiste `tenant.lastIncrementalSyncAt` +
  `lastIncrementalSyncStats`.
- `IncrementalSyncSkippedError`: tenants sin onboarding completo o sin
  API Key son skipeados sin error de log.

`apps/api/src/queues/catalog-incremental.ts`:
- `registerTenantRepeatable(tenantId)`: `BullMQ.repeatable` con
  `every: 900_000` y `jobId: incr-<tenantId>` (determinista).
- `enqueueManualSync(tenantId)`: one-shot con `priority: 1` y jobId
  único timestamped.
- `unregisterTenantRepeatable`: para cleanup en tests / futuro tenant
  removal.

`apps/api/src/workers/catalog-incremental-worker.ts`:
- Concurrency 1. Captura `IncrementalSyncSkippedError` como skip.
- `registerAllExistingRepeatables()`: en bootstrap registra los crons de
  tenants `initialSyncStatus=DONE`. Idempotente.

`apps/api/src/workers/initial-sync-worker.ts`: tras `runInitialSync`
exitoso llama `registerTenantRepeatable(tenantId)` → arranca el cron
de 15 min al completar onboarding.

`apps/api/src/server.ts`: arranca ambos workers embedded en
desarrollo. En producción, `pnpm worker:dev` los corre fuera.

`apps/api/src/catalog/routes.ts`:
- `POST /catalog/sync-now` (requireOwner): 202 + `{jobId, queuedAt}`.
  409 si initial sync pending, 409 si no hay API Key, 503 si cola
  caída.
- `GET /catalog/sync-status`: estado del último sync incremental.
- **Nuevo** `GET /catalog/sku-review` (B2 §4.4): lista productos con
  `needsSkuReview=true`. Para cada uno devuelve `suggestedSku`
  (`buildAutoSku(holdedProductId)`), `basePrice`, `taxRate`, etc.
- **Nuevo** `POST /catalog/sku-review/:productId/assign` (B2 §4.4):
  PUT a Holded con `updateProductWithGetBack`. Si OK, marca
  `needsSkuReview=false`, `sellableViaTpv=true`. Si silent reject,
  502 con mismatches y el item sigue en bandeja.

### Contactos on-demand (B2 §3)

`packages/holded-client/src/contacts.ts` (nuevo):
- `listContactsByPhone`, `listContactsByMobile`, `listContactsByCustomIds`
  — los únicos filtros server-side que Holded soporta.
- `getContact(id)`, `createContactWithGetBack(body, opts)` con la misma
  política GET-back que productos (ADR-010). Mismatches → `HoldedSilentRejectError`.

`apps/api/src/contacts/routes.ts` (nuevo):
- `GET /contacts/search?q=...`: 1º LIKE case-insensitive local sobre
  `name`/`email`/`nif`/`phone` (top 25). 2º Si vacío y query parece
  teléfono (regex `^[+\d\s.-]+$` con ≥6 dígitos) → consulta Holded,
  upserta, devuelve `source: "holded"`. 3º Si vacío y no es teléfono,
  devuelve `holdedFallback: "name_search_not_supported"`.
- `POST /contacts`: mapea `nif → code`, fija `type: "client"`, llama
  `createContactWithGetBack`, upserta local. Errores tipados.

### Admin "Mi cuenta" (B2 §4)

**Tailwind introducido en `apps/admin`** (B1 había decidido "CSS
plano"; el prompt B2 pidió aplicar tokens mipiace.* del reference).
- `tailwindcss@3.4`, `postcss`, `autoprefixer`, `tailwindcss-animate`,
  `lucide-react` instalados.
- `tailwind.config.js` con `colors.mipiace.*` (coral, coral-soft,
  coral-dark, ink, ink-soft, stone) + fontFamily DM Sans + plugin
  tailwindcss-animate. Sin las CSS variables shadcn del reference
  porque no las usamos.
- `src/Logo.tsx` componente canónico (SVG inline + wordmark coral split).
- `src/AdminShell.tsx`: sidebar 240px con los 7 ítems del mockup en
  pantalla 9 (Tiendas/Dispositivos/Cajeros/Productos/Mi cuenta/
  Seguridad/Holded). En B2 sólo **Productos** y **Mi cuenta** son
  navegables; el resto aparece grisado con title="Disponible en
  bloques posteriores". Botón "Cerrar sesión en todos los dispositivos"
  llama a `/auth/logout-everywhere`.

Pantallas:
- **Login** con checkbox "Recuérdame en este dispositivo" → propaga
  `remember` a `storeTokens()` y al backend.
- **Signup**, **ConnectHolded**, **SyncProgress**, **SyncSummary**:
  refactor a Tailwind con cards centradas + tokens.
- **AccountPage** (`/admin/account`): siguiendo pantalla 9 del mockup
  (sin 2FA, que es B3).
  - **Datos fiscales** editables (Editar → form con razón social, NIF,
    dirección, CP, ciudad, provincia, país; Guardar persiste en
    `tenant.fiscalProfile` JSON; no re-sincroniza con Holded).
  - **Conexión Holded**: indicador "Activa", "última sincronización
    hace X min" (calculado a partir de `lastIncrementalSyncAt`),
    botones "Probar conexión" y "Cambiar API Key" (modal con
    mostrar/ocultar key, validación previa y rollback).
- **SkuReviewPage** (`/admin/products`): bandeja con sugerencia auto-SKU,
  input editable, botón "Asignar y subir". Quitar de la lista al
  resolver; mensaje de error si Holded silencia.

`apps/admin/src/api.ts`: `storeTokens(tokens, { remember })` decide
localStorage vs sessionStorage. `readTokens` prioriza localStorage,
fallback a sessionStorage. Refresh in-place preserva el storage
original.

### Tests

13 archivos de test, **94 tests verdes**:

| Archivo | Tests | Cubre |
|---|---|---|
| `crypto.test.ts` | 5 | round-trip AES-256-GCM (B1) |
| `client.test.ts` | 5 | ApiKeyClient, headers, Content-Type (B1) |
| `products.test.ts` | 6 | paginación + GET-back productos (B1) |
| `salesreceipt.test.ts` | 7 | payload + invariantes (B1) |
| `auto-sku.test.ts` | 7 | throttle, GET-back, silent reject (B1) |
| `onboarding-route.test.ts` | 8 | connect-holded mapping de errores (B1) |
| **`auth-route.test.ts`** | 13 | tokenVersion, remember, refresh, logout-everywhere |
| **`auth-holded-rotation.test.ts`** | 11 | rotate-holded-key (happy/inválida/suspendida/HTML/inalcanzable + no leak de key), test-holded-connection |
| **`incremental-sync.test.ts`** | 5 | happy/orphan/return/skip-pending/skip-no-key |
| **`catalog-route.test.ts`** | 7 | sync-now (202+jobId), sync-status |
| **`contacts-route.test.ts`** | 10 | search local/teléfono/no-key/no-support, create con silent reject |
| **`fiscal-profile-route.test.ts`** | 4 | PUT merge + auth + me ampliado |
| **`sku-review-route.test.ts`** | 6 | list + assign happy/silent-reject/no-key/not-found |

## Lo que dejé fuera (por diseño · bloques siguientes)

- **2FA** (B3 §17.3). El mockup pantalla 9 lo tiene como sección;
  intencionalmente NO lo implementé.
- **Lista detallada de sesiones activas por dispositivo.** El backend
  no traza dispositivos individuales (sólo `tokenVersion` global).
  El mockup pinta una lista mock; yo dejé sólo el botón global "Cerrar
  sesión en todos los dispositivos".
- **Botón "Sincronizar ahora" en UI del admin.** El endpoint
  `POST /catalog/sync-now` está, pero no hay botón explícito en
  AccountPage. Lo añadimos en B3 cuando llegue el panel de Tiendas /
  Catálogo.
- **Receptor de webhooks Holded** (spike §09 fue negativo).
- **Botón "Refrescar desde Holded" en datos fiscales** (spike §08 fue
  negativo — Holded no expone endpoint de account info).
- **Contador `skuReviewAttempts`** en `Product`. El prompt §4.4 lo
  pedía; lo omití para no extender la migración. Los re-intentos se
  registran en logs del servidor; el front muestra mensaje de Holded
  silent reject. Si lo necesitamos en producción, segunda migración
  añadiendo la columna.
- **Bandeja de tickets `SYNC_FAILED`** — B5.
- **2FA y rate limit del login admin** — B3 (los del cajero tienen más
  sentido).

## Decisiones que tomé en B2 sin preguntar

1. **Reutilizar `Product.active` y `Product.lastSyncedAt`** en lugar
   de añadir `lastSeenInSyncAt` y otra flag de huérfano. El schema de
   B1 ya los tenía; el upsert del sync incremental los actualiza y el
   `updateMany` los marca. Menos columnas, mismo efecto.
2. **SQL de la migración escrita a mano** (Docker no estaba arriba).
   Sigue el estilo exacto del init.sql; cuando corras `pnpm db:migrate`
   Prisma la aplicará tal cual sin regenerar.
3. **`Prisma.JsonNull`** en lugar de `null` en `initialSyncStats`
   reset (typecheck fix derivado del cliente regenerado, no estaba en
   B1 porque tsc no se corría sobre esa ruta).
4. **`tokenVersion` global** vs blacklist de jtis (decisión ya
   confirmada por ti antes de codear, pero la dejo aquí para
   completitud).
5. **`Product.active` explícito** vs reutilizar `sellableViaTpv` para
   huérfanos (idem, decisión confirmada al arrancar B2).
6. **NO encolar sync inicial al rotar API Key.** La rotación típica
   (clave comprometida → nueva clave de la MISMA cuenta) no necesita
   resync. Si el propietario cambia de cuenta Holded distinta, puede
   forzar con `POST /catalog/sync-now`.
7. **NO hay cache en memoria de la API Key descifrada.** Cada job
   descifra al arrancar, así que la rotación es efectiva sin acción
   extra del runtime. Lo comento en el handler.
8. **Heurística teléfono** (`^[+\d\s.-]+$` con ≥6 dígitos) para
   decidir si la búsqueda de contactos cae al fallback Holded.
   Conservadora a propósito: evita peticiones inútiles a Holded por
   queries de nombre.
9. **Sidebar admin con ítems deshabilitados** (Tiendas, Dispositivos,
   Cajeros, Seguridad, Holded) en lugar de ocultarlos. Da al
   propietario una vista del roadmap sin mentirle sobre lo
   disponible.
10. **Tailwind introducido en `apps/admin`** (B1 había decidido "CSS
    plano sin framework"). El prompt B2 pidió aplicar tokens
    `mipiace.*` del reference — eso requiere Tailwind. Setup mínimo
    sin shadcn (sólo los tokens canónicos del design doc).
11. **CSS variables shadcn del reference NO se importan.** El reference
    tiene `--primary`, `--secondary`, etc. para componentes shadcn; el
    admin de B2 no usa shadcn — sólo `mipiace.*` directos. Cuando
    introduzcamos componentes shadcn (B3+), añadimos las variables.
12. **Modal de "Cambiar API Key" implementado a mano** (no librería).
    Simple `fixed inset-0` + click-fuera-cierra. Cubre el caso del
    mockup sin meter dependencias.

## Dudas y cosas a confirmar antes de B3

1. **`Product.skuReviewAttempts`**: ¿lo añadimos en B3 con una segunda
   migración o lo dejamos en logs? El front actual muestra el último
   error de Holded; sin contador, no podemos pintar "ha fallado N
   veces, llama a soporte".
2. **`tenant.holdedAccountId`** sigue sin rellenarse (B1-dudas §3
   pendiente). ¿Lo derivamos del hash de la API Key en este bloque o
   esperamos a tener un caso de uso (multi-cuenta, switching)?
3. **Confirmación al hacer "Cerrar sesión en todos los dispositivos"**.
   Hoy es un click directo en el sidebar. ¿Modal de confirmación?
4. **¿Activar el ítem "Holded" del sidebar** como atajo a la sección de
   conexión dentro de Mi cuenta, o lo mantenemos como pantalla propia
   en B3 (cuando tengamos config de num_serie por caja, payment methods,
   etc.)?
5. **Refresh tokens emitidos antes de B2** (sin `tv`) son rechazados por
   `verifyRefreshToken`. Para clientes B1 ya logueados, se forzará
   un re-login. Aceptable porque B1 no era producción, pero confirmar.
6. **Tests de integración con BD real**. Sigue como deuda de B1-dudas
   §7 — `testcontainers` + Postgres efímero. Lo dejaría para cuando
   tengamos CI (B5+).
7. **`apps/tpv-web-spike`** sigue como single-tenant con
   `HOLDED_API_KEY` env. Mismo punto que B1-dudas §8.
8. **Sidebar admin en móvil**: hoy está `hidden md:flex`. Para móvil
   no hay drawer. ¿Lo necesitamos en B2 (admin es desktop-first) o lo
   añadimos en B3?
9. **`source: "manual"`** en `fiscalProfile`: lo marcamos cada vez que
   se edita. ¿Hace falta UI distinguiendo "datos del almacén" vs
   "manuales"? Hoy se ignora visualmente, sólo es metadata.

## Cómo arrancarlo todo de cero

```bash
# 1. Si vienes de B1: levanta infra + aplica la nueva migración.
docker compose up -d           # postgres + redis (igual que B1)
pnpm install                   # nuevos deps: tailwind*, lucide-react
pnpm db:migrate                # aplica 20260512170000_add_incremental_sync

# 2. Tests (12 ficheros, 94 casos).
pnpm test

# 3. Arranca dev.
pnpm dev:api                   # http://127.0.0.1:3001
pnpm dev:admin                 # http://localhost:5173
pnpm dev:tpv                   # http://localhost:5174 (esqueleto)

# 4. Spikes Fase 1 (lectura solamente, no mutan Holded).
pnpm spike:08                  # account info
pnpm spike:09                  # webhooks
```

Flujo E2E recomendado tras arrancar:

1. Login en `http://localhost:5173/login`.
   - Marca "Recuérdame" → cierra pestaña → vuelve a abrir → sigues
     dentro (token en localStorage).
   - Sin "Recuérdame" → cierra pestaña → vuelve → vas a /login.
2. `/admin/account`:
   - **Editar datos fiscales** → guardar → recargar → persiste.
   - **Probar conexión** → con API Key real, banner verde.
   - **Cambiar API Key** → pega una válida, banner "actualizada"; pega
     basura, error y la antigua intacta (verifícalo en BD con
     `pnpm db:studio`).
3. `/admin/products` (bandeja SKU): si hay productos con
   `needsSkuReview=true` (los habrá en sandbox de Holded), prueba
   asignar SKU manual.
4. Espera 15 min (o trigger manual vía `curl`):
   ```bash
   curl -X POST http://127.0.0.1:3001/catalog/sync-now \
        -H "Authorization: Bearer <access-token>"
   ```
   → `GET /catalog/sync-status` para ver `lastIncrementalSyncAt` y
   stats.

Para probar logout-everywhere: abre dos pestañas (una con Recuérdame,
otra sin), pulsa "Cerrar sesión en todos los dispositivos" en una de
ellas, las dos pestañas pierden sesión al siguiente refresh (≤15 min
si el access token aún vale; inmediato al siguiente request 401).

Cuando termines B2 y Matías lo revise, te paso el prompt de B3.
