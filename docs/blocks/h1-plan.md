# H1 · la empresa sin caja (Holded opcional, nivel 1) — PLAN (Frente 0)

Origen: el prompt de Matías del 12-09-2026. Rama `holded-opcional-1-empresa-sin-caja`,
worktree `mipiacetpv-h1`, base `4078655` (S1, B-5 y B-6a dentro). **Sin push, sin deploy.**
Con migración: aditiva y con backfill (§4).

Leído entero antes de escribir esto: `apps/api/src/superadmin/tenants.ts` (1845 l),
`apps/api/src/superadmin/onboarding-health.ts`, `apps/api/src/admin/tenant-settings.ts`,
`apps/api/src/onboarding/routes.ts`, `apps/admin/src/App.tsx`,
`apps/admin/src/superadmin/CreateTenantPage.tsx`, `apps/admin/src/superadmin/TenantDetailPage.tsx`
(la salud y el panel de activación), `apps/admin/src/AdminShell.tsx`,
`apps/api/src/agenda/routes.ts:50-65`, `apps/api/src/staff/routes.ts:61-78`,
`apps/api/src/tpv-catalog/routes.ts`, `apps/tpv-web/src/lib/catalog.ts`,
`apps/tpv-web/src/hooks/useDeviceBootstrap.ts`, `apps/api/src/tickets/health.ts`,
`packages/db/prisma/schema.prisma` (modelo `Tenant`) y `docs/design/reservas-modulo-kickoff.md` §ADR-R6.

**El cliente 0 es un colegio de Talavera que tenía Holded sólo para fichar.** Este bloque no trae el
fichaje: trae que una empresa pueda **existir, activarse y entrar** sin caja y sin Holded.

---

## 1 · Qué hay hoy, medido

### 1.1 El patrón que se copia (ADR-R6)

| Pieza | Dónde |
|---|---|
| Columna booleana en `Tenant`, no jsonb ni vertical | `schema.prisma:431` (`crmEnabled`), `:439` (`agendaEnabled`) |
| Gate de ruta: `preHandler: [auth, ensureXEnabled]` → 403 `AGENDA_DISABLED` | `agenda/routes.ts:50-65` y `:102`; `staff/routes.ts:61-78` y `:197` |
| Gate de UI en el panel: `NavItem.capability` + `useAgendaEnabled()` | `AdminShell.tsx:57`, `:363-378`, `:395` |
| Gate de UI en la página (además del sidebar) | `StaffPage.tsx:106-131`, `AgendaCatalogPage.tsx:137-190` |
| El flag viaja al TPV en la **primera página** de `/tpv/catalog/products` | `tpv-catalog/routes.ts:42-50` y `:140-149` |
| El TPV lo cachea en `localStorage` y lo lee síncrono | `tpv-web/src/lib/catalog.ts:60-120`, `:245-298` |
| Dónde se encienden CRM y agenda | `admin/tenant-settings.ts` (panel del cliente, OWNER) |

**Este bloque copia ese patrón literalmente.** Única diferencia deliberada: `cajaEnabled` **no** se
toca desde `admin/tenant-settings.ts` — es decisión comercial (§2.3 del prompt).

### 1.2 El alta y la activación, hoy

| Paso | Dónde | Qué da por supuesto |
|---|---|---|
| `POST /super-admin/tenants` | `superadmin/tenants.ts:429-667` | `required: ["holdedApiKey","holdedAccountId"]` (`:437`) |
| Valida la key contra Holded (`listWarehouses`) | `:508-556` | **siempre** llama a Holded |
| Nombre y fiscal desde el almacén default | `:558-577` (`derivedLegalName`, `fiscalProfile`) | si no hay almacén con nombre → 400 `INVALID_HOLDED_FISCAL_PROFILE` |
| Unicidad de NIF por `fiscal_profile ->> 'taxId'` | `:579-601` | ok, ya es opcional |
| Crea el tenant con `initialSyncStatus: "PENDING"` | `:622` | asume que va a haber sync |
| Encola el sync inicial; si Redis cae → 503 | `:640-656` | asume cola |
| `POST …/:id/activate` | `:1421-1587` | exige `health.ready` (`:1463`), y **siempre** genera `ownerPin` (`:1491`) |
| `computeOnboardingHealth` | `onboarding-health.ts:69-217` | 5 checks, **todos** de caja+Holded |

Los 5 checks de hoy (`onboarding-health.ts:146-176`): `sync-done`, `taxes-ratio`,
`products-sellable`, `no-sync-failures`, `test-cashier-provisioned`. `ready = checks.every(c => c.ok)`
(`:214`). Ninguno declara de qué depende.

### 1.3 La redirección del panel del cliente

`apps/admin/src/App.tsx:138-145`:

```ts
if (me.user.role === "MANAGER") { navigate("/admin/tickets-errors"); return; }
if (!me.tenant.hasHoldedKey) navigate("/onboarding", { replace: true });
else if (me.tenant.initialSyncStatus === "DONE") navigate("/admin/account");
else navigate("/onboarding/sync");
```

**Una empresa sin Holded cae siempre en `/onboarding` y no sale.** Ése es el muro del colegio.

### 1.4 El TPV sin caja, hoy

`useDeviceBootstrap.ts:64-92`: cualquier error que no sea `DEVICE_REVOKED` / `DEVICE_TOKEN_EXPIRED`
es `retry`. Sin `device-me` cacheado → `setState({kind:"loading"})` + `setTimeout(refresh, 3000)`.
Es decir: **spinner infinito**, exactamente la "pantalla en blanco" que el prompt prohíbe. Un 403
`CAJA_DISABLED` sin manejo explícito da eso.

### 1.5 El aviso rojo de Holded

`tickets/health.ts:57-67`: sin `holdedApiKeyCiphertext` → `level: "blocked", reason: "no_api_key"`.
Lo pintan `AdminShell.tsx:151-183` (banner rojo a ancho completo) y `/tpv/health/holded`.
**Una empresa sin Holded vería hoy el banner rojo "Holded está desconectado" para siempre.**

---

## 2 · La lista COMPLETA: qué da hoy por supuesto que hay caja o Holded

Ésta es parte del entregable. `[C]` = asume caja · `[H]` = asume Holded · `[C+H]` = ambas.

### 2.1 Rutas de API — caja

| Ruta(s) | Fichero | |
|---|---|---|
| `POST /devices/pair`, `GET /devices/me` | `devices/routes.ts` | `[C]` puerta de arranque del TPV |
| `POST /admin/pairing-codes`, `GET/POST /admin/devices`, `…/revoke` | `devices/routes.ts` | `[C]` |
| `POST /shift/cashier-login` · `/cashier-logout` · `GET /shift/cashier-bootstrap` · `/offline-bundle` | `shift/cashier-auth.ts` | `[C]` |
| `/shift/open` · `/current` · `/last-closed` · `/:id/close` · `/resume` · `/summary` · `/cash-count(s)` · `/close-day` · `/ack-summary` | `shift/routes.ts` | `[C]` turno |
| `POST /tickets`, `/tickets/:id` (+ lines, checkout, move, reprint, resend-email, digital, gift-receipt-intent, print/escpos, send-to-kitchen, partial-payment) | `tickets/*.ts` | `[C]` **camino de cobro — no se toca la lógica, sólo la puerta** |
| `POST /refunds`, `/credits`, `/tickets/:id/credit-*` | `tickets/refunds.ts`, `credit-routes.ts` | `[C]` |
| `GET /tpv/catalog/products` · `/modifier-groups` · `/top-sellers` · `/wildcards` | `tpv-catalog/routes.ts` | `[C]` |
| `GET /tpv/tables`, `/tables/:id/open` · `/lines` · `/group` · `/ungroup`, `/admin/stores/:id/tables*` | `tables/*.ts` | `[C]` |
| `GET/POST/PATCH/DELETE /cashiers*` | `cashiers/routes.ts` | `[C]` |
| `/admin/registers*`, `/admin/stores/:id/registers`, `/admin/warehouses` | `stores/routes.ts` | `[C]` (las **tiendas** en sí no: el dato fiscal del local vale sin caja) |
| `/admin/printer-configs*` | `admin/printer-configs.ts` | `[C]` |
| `/admin/tag-sections*` (comanderas) | `admin/tag-sections.ts` | `[C]` |
| `/admin/tag-aliases*` (categorías del catálogo) | `admin/tag-aliases.ts` | `[C]` |
| `/admin/modifier-groups*` | `admin/modifier-groups.ts` | `[C]` |
| `/admin/tickets/*` (gift-receipts, sync-errors, corrections, retry-sync…) | `admin/gift-receipts.ts`, `admin/tickets-errors.ts` | `[C+H]` |
| `/admin/stores/:id/ticket-delivery` | `admin/ticket-delivery.ts` | `[C]` |
| `POST /admin/auth/manager-authorize` | `admin/manager-authorize.ts` | `[C]` autorización de encargado en caja |
| `GET /tpv/printer-info` | `tickets/printer-info.ts` | `[C]` |
| `GET /tickets/:publicSlug/pdf` (público) | `tickets/public-pdf-route.ts` | `[C]` pero es público y por slug — **no se gatea** (no hay tickets si no hay caja) |

### 2.2 Rutas de API — Holded

| Ruta | Fichero | |
|---|---|---|
| `POST /catalog/sync-now`, `GET /catalog/sync-status` | `catalog/routes.ts:33`, `:315` | `[H]` — ya devuelve 409 `NO_HOLDED_KEY`, pero `sync-status` sirve el `health` del banner rojo |
| `POST /onboarding/connect-holded`, `GET /onboarding/sync-status` | `onboarding/routes.ts` | `[H]` — es el camino a reutilizar en §7 |
| `POST /auth/me/rotate-holded-key`, `/test-holded-connection` | `auth/routes.ts:402`, `:465` | `[H]` — **no** mueven `initialSyncStatus` hoy |
| `PATCH /super-admin/tenants/:id/holded-api-key` | `superadmin/tenants.ts:1241` | `[H]` — **no** mueve `initialSyncStatus` ni encola |
| `POST /super-admin/tenants/:id/resync` | `superadmin/tenants.ts:1016` | `[H]` |
| `GET /tpv/health/holded` | `tpv-catalog/routes.ts:351` | `[C+H]` |
| `POST /admin/contacts/import` | `contacts/import.ts` | `[H]` — sube contactos a Holded |
| `GET /auth/me` → `hasHoldedKey`, `initialSyncStatus` | `auth/routes.ts:325-331` | `[H]` alimenta la redirección de §1.3 |

### 2.3 Pantallas — panel del cliente (`apps/admin`)

| Pantalla / elemento | Fichero | |
|---|---|---|
| Redirección a `/onboarding` / `/onboarding/sync` | `App.tsx:138-145` | `[H]` **el muro** |
| `ConnectHoldedPage`, `SyncProgressPage`, `SyncSummaryPage` | `App.tsx` (rutas `/onboarding*`) | `[H]` |
| Banner rojo "Holded está desconectado" | `AdminShell.tsx:151-183` (`useHoldedHealth`) | `[H]` |
| Badge de errores de sync en la nav | `AdminShell.tsx:188-209` (`useSyncErrorsCount`) | `[C+H]` |
| Nav "Dispositivos" | `AdminShell.tsx:72` | `[C]` |
| Nav "Impresoras" | `:77` | `[C]` |
| Nav "Cajeros" | `:78` | `[C]` |
| Nav "Productos" (`SkuReviewPage`) | `:89` | `[C+H]` |
| Nav "Etiquetas" | `:101` | `[C]` |
| Nav "Comanderas" | `:106` | `[C]` |
| Nav "Sync Holded" (`HoldedPage`) | `:110` | `[H]` |
| Nav "Tickets regalo" | `:111` | `[C]` |
| Nav "Holded" (bandeja sync-errors, super-admin) | `:113` | `[C+H]` |
| Nav "Ajustes" (super-admin) | `:114` | `[C]` en su mayoría (auto-logout, PIN de cierre, corte de día) |
| Nav "Tiendas" → registers, mesas, entrega de ticket | `StoresPage.tsx`, `StoreDetailPage.*` | parcial `[C]` |
| "Importar clientes" | `ContactImportPage.tsx` | `[H]` |

Lo que **sí** vale sin caja hoy: "Mi cuenta", "Seguridad", "Personal" y "Agenda · Catálogo"
(gateadas por `agenda`), y la ficha fiscal de la tienda.

### 2.4 Pantallas — super-admin

| Elemento | Fichero | |
|---|---|---|
| Alta: API key y `holdedAccountId` `required` | `CreateTenantPage.tsx:105`, `:141` | `[H]` |
| Salud: pinta cada check verde o **ámbar**, sin "no aplica" | `TenantDetailPage.tsx:875-903` | `[C+H]` |
| Botón "Re-sync" en el panel de salud | `:865-872` | `[H]` (ya `disabled` sin `holdedConnected`) |
| "Modo prueba" (cajero técnico) | `:920-963` | `[C]` |
| "Activar cuenta" bloqueado por `ready` | `:975-1000` | `[C+H]` |
| Métricas del detalle (tickets, turnos, Holded) | `:1005-1045` | `[C+H]` |

### 2.5 El TPV (`apps/tpv-web`)

| Pieza | Fichero | |
|---|---|---|
| Bootstrap: sin `device-me` y con error no-purga → spinner infinito | `useDeviceBootstrap.ts:76-92` | `[C]` |
| `decideAfterBootstrapError` no conoce 403 | `hooks/bootstrap-decision.ts:20-28` | `[C]` |
| Caché de flags del catálogo | `lib/catalog.ts:60-120`, `:245-298` | falta `cajaEnabled` |
| Banner de salud Holded del cajero | `/tpv/health/holded` → `tpv-catalog/routes.ts:351` | `[H]` |

### 2.6 Crons, workers y scripts

| Pieza | Fichero | Veredicto |
|---|---|---|
| Cron incremental de catálogo | `workers/catalog-incremental-worker.ts:71-73` | **seguro**: filtra `initialSyncStatus:"DONE"` + `holdedApiKeyCiphertext != null`. `NOT_APPLICABLE` no entra. |
| `reconcile-catalog` (script) | `scripts/reconcile-catalog.ts:75-80` | **seguro**: mismo filtro |
| Conciliación diaria de tickets | `tickets/reconciliation.ts:94-101`, `:219-224` | **seguro**: parte de `ticket.groupBy` (sin tickets no hay tenant) y aborta sin key |
| Corte de día | `shift/day-cut-run.ts:85-98` | **seguro**: parte de turnos abiertos; sin caja no hay turnos |
| Sweeper de subidas | `workers/upload-sweeper.ts:73` | **seguro**: parte de `holdedUpload` |
| Caché de imágenes | `workers/image-cache-worker.ts:93-120` | **seguro**: salta sin key |
| Importador de contactos | `workers/contact-import-worker.ts:93-99` | **seguro**: aborta sin key |
| TTL de holds de agenda | `queues/agenda-hold-ttl.ts` | no toca caja ni Holded |

**Conclusión de §2.6: ningún cron ni worker necesita cambio.** El valor `NOT_APPLICABLE` es
justamente lo que los deja quietos sin mentir — es la razón de no reutilizar `DONE` (entraría en el
cron incremental) ni dejar `PENDING` (el panel lo pintaría como sync a medias).

---

## 3 · Decisión de producto que este prompt no cubre (y que NO bloquea el bloque)

**El colegio no tiene ningún módulo de los tres.** El prompt fija "una empresa sin ningún módulo
encendido no se puede activar" y a la vez deja el fichaje fuera de alcance. Ambas cosas son
correctas: el módulo del colegio (control horario) no existe todavía, así que **hoy el colegio se da
de alta como DRAFT y no se activa hasta que exista su flag**. No pregunto, porque el propio prompt
pide que el cierre diga "qué hace falta para dar de alta al colegio" — es la respuesta. Queda en
`h1-done.md` §"Al desplegar" y en el cierre.

---

## 4 · Qué cambio y dónde

### F1 · Datos (migración aditiva + backfill)

`packages/db/prisma/schema.prisma`:

```prisma
enum InitialSyncStatus { PENDING RUNNING DONE FAILED NOT_APPLICABLE }

model Tenant {
  // hermana de crmEnabled y agendaEnabled (ADR-R6), pero comercial:
  // sólo el super-admin la mueve.
  cajaEnabled  Boolean @default(true) @map("caja_enabled")
}
```

Migración `packages/db/prisma/migrations/2026091200000_h1_caja_es_un_modulo/migration.sql`:

1. `ALTER TYPE "InitialSyncStatus" ADD VALUE IF NOT EXISTS 'NOT_APPLICABLE';`
2. `ALTER TABLE "tenants" ADD COLUMN "caja_enabled" BOOLEAN NOT NULL DEFAULT true;`

El backfill es el `DEFAULT true` del propio `ADD COLUMN`: Postgres rellena todas las filas
existentes. `NOT NULL DEFAULT true` en un solo `ALTER` es no-bloqueante en PG ≥ 11. **Un tenant de
hoy queda idéntico.** `ADD VALUE` de un enum no se puede usar en la misma transacción que lo lee →
va en su propio statement, primero, y no hay `UPDATE` que lo use en la migración.

**Ninguna tercera columna.** Nada que decida "¿usa Holded?" fuera de `holdedApiKeyCiphertext != null`
+ `initialSyncStatus`, que ya existen.

### F2 · La puerta: `ensureCajaEnabled`

Nuevo `apps/api/src/lib/caja-gate.ts` — copia exacta de `agenda/routes.ts:50-65`, con la única
diferencia de que resuelve el tenant desde `request.auth` (admin), `request.cashier` (TPV) o
`request.device` (TPV):

```ts
export async function ensureCajaEnabled(request, reply): Promise<void> {
  const tenantId = request.auth?.tenantId ?? request.cashier?.tid ?? request.device?.tenantId;
  // ...
  if (!tenant?.cajaEnabled) {
    reply.code(403).send({
      error: "CAJA_DISABLED",
      message: "Esta empresa no tiene caja. Si crees que debería tenerla, avisa a Mi Piace.",
    });
  }
}
```

Se aplica como `preHandler: [auth, ensureCajaEnabled]` en **todas** las rutas de §2.1 marcadas `[C]`
y `[C+H]`, incluidas `/devices/pair` y `/devices/me` (ahí es donde el TPV arranca, y por tanto donde
tiene que enterarse). **No se toca la lógica de `/tickets` ni de `/pay`: sólo se añade la puerta.**

**La lectura es defensiva a propósito, y el gate compara con `=== false`, no con `!`.** Medido en el
Frente 0: 29 de los bancos de pruebas de `apps/api/test` montan un Prisma falso **sin modelo
`tenant`** (`cashiers-alias`, `pairing-route`, `printer-configs`, `refunds-route`,
`admin-tickets-errors-route`, `top-sellers-route`, `cash-count`, `modifier-groups`… ). Con una
lectura ingenua, gatear sus rutas los rompería a todos, y la restricción del prompt es que los tests
existentes sigan verdes **sin tocarlos**.

La dirección del fallo es además la correcta por sí misma: `caja_enabled` es `@default(true)`, así
que **sólo un `false` explícito apaga la caja**; si la fila no se puede leer, la caja queda
ENCENDIDA. Esto es una *capability* (ADR-016), no la frontera de aislamiento —ésa la hacen
`requireCashierSession` y `requireOwner`—, y fallar hacia "apagado" dejaría sin cobrar a un cliente
que cobra. Se declara como decisión en `h1-done.md` y en "qué NO cubre la suite".

### F3 · Alta sin Holded (`POST /super-admin/tenants`)

- `required: []`; `holdedApiKey` y `holdedAccountId` pasan a opcionales.
- **Con clave:** el camino de hoy, intacto (validación, `derivedLegalName`, `PENDING`, encolado).
- **Sin clave:** no se instancia `ApiKeyClient`, no se encola nada, `initialSyncStatus:
  NOT_APPLICABLE`, `holdedAuthMode` se deja en su default. `legalName` pasa a **obligatorio**
  (hoy sale de Holded); `taxId` sigue opcional pero se valida igual con `validateSpanishTaxId` y
  se comprueba la unicidad con la misma `$queryRaw`. `fiscalProfile.source = "super_admin_manual"`.
- Body nuevo: `cajaEnabled` (default `true`), `crmEnabled` (default `false`), `agendaEnabled`
  (default `false`). Si los tres van a `false` → 400 `NO_MODULES_ENABLED`.
- Si `holdedApiKey` no viene pero `holdedAccountId` sí (o al revés) → 400 `HOLDED_PARTIAL_CONFIG`:
  media configuración de Holded es peor que ninguna.

`CreateTenantPage.tsx`: un interruptor "¿Tiene Holded?" que muestra u oculta el par de campos de
Holded; razón social pasa a `required` cuando no hay Holded; tres chips de módulo (caja encendida
por defecto) con el aviso de "al menos uno".

### F4 · La salud declara dependencias (`onboarding-health.ts`)

`ReadinessCheck` gana `requires: "caja" | "holded" | "always"` y `applies: boolean`. El check que
no aplica sale con `applies: false` y **no cuenta** para `ready`:

```ts
ready = checks.filter(c => c.applies).every(c => c.ok)
```

| Check | `requires` | Nuevo |
|---|---|---|
| `sync-done` | `holded` | |
| `taxes-ratio` | `caja` | |
| `products-sellable` | `caja` | |
| `no-sync-failures` | `caja` | |
| `test-cashier-provisioned` | `caja` | |
| `modules-enabled` — al menos un módulo encendido | `always` | **sí** |
| `fiscal-minimum` — razón social + NIF válido en `fiscalProfile` | `always` | **sí** |

`sync-done` con `holded` y no con `caja`: una empresa con caja y sin Holded (posible: caja local) no
debe quedar bloqueada por un sync que nunca va a correr. La dependencia real de ese check es la
clave, no la caja.

`TenantDetailPage.tsx`: tercer estado visual. Cumple = verde con ✓; falla = ámbar con ✗; **no aplica
= gris con “—” y la etiqueta "No aplica"**, atenuada. Se distinguen los tres sin depender del color
(icono + etiqueta), que es el estándar de acabado.

### F5 · Activación (`POST …/:id/activate`)

- Sigue exigiendo `health.ready`, que ahora ya es el correcto.
- El `ownerPin` **sólo si `cajaEnabled`**. Sin caja: no se genera `pinHash`, no se manda en el email
  de bienvenida y la respuesta lleva `ownerPin: null` + `cashierPinIssued: false`. La respuesta lo
  **dice**, no lo calla.
- Purga best-effort y auditoría: **sin tocar** (v1.9.7 — nunca revierten una activación buena).

### F6 · El panel del cliente

`GET /auth/me` gana `cajaEnabled`, `crmEnabled`, `agendaEnabled` en el bloque `tenant`.

`App.tsx:138-145` pasa a:

```ts
if (me.user.role === "MANAGER") → /admin/tickets-errors   // sin cambio
if (!me.tenant.cajaEnabled)     → primera pantalla de sus módulos  // NUEVO: nunca /onboarding
if (!me.tenant.hasHoldedKey)    → /onboarding             // sin cambio (empresa CON caja)
if (initialSyncStatus === "DONE") → /admin/account
else → /onboarding/sync
```

"La primera pantalla de sus módulos" sin caja: `/admin/agenda-catalog` si `agendaEnabled`, si no
`/admin/account`. (El CRM del cliente vive hoy en el TPV, no en el panel.)

`AdminShell.tsx`: `NavItem.capability` pasa de `"agenda"` a `"agenda" | "caja"`; el hook
`useAgendaEnabled` se generaliza a `useTenantCapabilities()` leyendo `/admin/tenant/settings` (que
gana `cajaEnabled` **sólo de lectura**). Se marcan `capability: "caja"` las entradas Dispositivos,
Impresoras, Cajeros, Productos, Etiquetas, Comanderas, Tickets regalo, la bandeja Holded y Ajustes.
`HoldedHealthBanner` y `useSyncErrorsCount` se callan cuando no hay Holded.

`/admin/tenant/settings` **no acepta** `cajaEnabled` en el `POST`. Sólo lo devuelve en el `GET`.

### F7 · El TPV

- `tpv-catalog/routes.ts`: `cajaEnabled` en el `select` y en la respuesta de la primera página,
  junto a `crmEnabled` y `agendaEnabled`. (La ruta además ya está gateada por F2, así que el flag
  llega en `false` sólo en la ventana en que el cajero tenga el catálogo cacheado.)
- `lib/catalog.ts`: `CAJA_ENABLED_KEY` + `get/setCachedCajaEnabled` + `lastCajaEnabled`, mismo patrón.
- `bootstrap-decision.ts`: un `BootstrapDecision` nuevo, `"caja-disabled"`, para `403 CAJA_DISABLED`.
- `useDeviceBootstrap.ts`: estado `{ kind: "cajaDisabled" }`.
- `App.tsx` (TPV): pantalla de una frase — **"Esta empresa no tiene caja. Si crees que debería
  tenerla, avisa a Mi Piace."** Sin spinner, sin volver al PIN, sin reintento en bucle.

### F8 · Encender Holded después

Sin duplicar el flujo de onboarding: las tres rutas que ya guardan una clave aprenden el mismo
salto, y sólo desde `NOT_APPLICABLE`:

| Ruta | Cambio |
|---|---|
| `PATCH /super-admin/tenants/:id/holded-api-key` (`tenants.ts:1241`) | si `initialSyncStatus === "NOT_APPLICABLE"` → `PENDING` + `enqueueInitialSync` (camino principal: sin caja el OWNER no ve Holded) |
| `POST /auth/me/rotate-holded-key` (`auth/routes.ts:402`) | igual |
| `POST /onboarding/connect-holded` | ya lo hace; sin cambio |

Desde cualquier otro estado la semántica de rotación se conserva intacta (comentario de
`auth/routes.ts:447`: rotar la clave de la MISMA cuenta no debe resincronizar).

---

## 5 · Tests

| Qué | Dónde |
|---|---|
| Alta sin Holded: `NOT_APPLICABLE`, sin llamada a Holded, sin encolado, nombre manual | `apps/api/test/h1-alta-sin-holded.test.ts` (nuevo) |
| Alta con Holded: idéntica a master (regresión) | mismo fichero |
| Sin ningún módulo → 400 `NO_MODULES_ENABLED` | mismo fichero |
| Salud: checks que no aplican no bloquean; los que aplican siguen duros | `apps/api/test/h1-salud-modulos.test.ts` (nuevo) |
| Activación sin caja: OWNER creado, sin PIN, `cashierPinIssued:false` | `apps/api/test/h1-activacion-sin-caja.test.ts` (nuevo) |
| Gate `CAJA_DISABLED` en venta, turno, catálogo y `/devices/me` | `apps/api/test/h1-caja-gate.test.ts` (nuevo) |
| `cajaEnabled` llega al TPV y se cachea | `apps/tpv-web/test/h1-caja-flag.test.ts` (nuevo) |
| El TPV pinta la frase y no entra en bucle | `apps/tpv-web/test/h1-caja-apagada.test.tsx` (nuevo) |
| La redirección del panel no manda a `/onboarding` sin caja | `apps/admin/test/h1-root-router.test.tsx` (nuevo) |
| Migración real + tenant existente intacto + Holded tardío arranca el sync | `apps/api/test-e2e/h1-empresa-sin-caja.e2e.ts` (nuevo) |

e2e contra `mipiacetpv_h1_e2e`, creada al empezar y **borrada al terminar**.

---

## 6 · Orden de trabajo (un commit por frente cerrado)

1. **F1** datos (schema + migración + `db:generate`) — se verifica que la suite sigue verde sin tocar tests.
2. **F2** la puerta + sus tests.
3. **F3** alta sin Holded (API + pantalla).
4. **F4** salud por dependencias (API + pantalla).
5. **F5** activación.
6. **F6** panel del cliente.
7. **F7** TPV.
8. **F8** Holded tardío.
9. e2e, bucle visual (1280×800 / 390 / 320), ADR-016, `h1-done.md`.

---

## 7 · Riesgos conocidos

| Riesgo | Mitigación |
|---|---|
| `ALTER TYPE … ADD VALUE` no es transaccional en PG < 12 | statement propio y primero; el repo corre PG 16 (`docker-compose.yml`) |
| ~100 sitios `preHandler` que gatear: olvidar uno | la tabla de §2.1 es la lista de verificación, y el sabotaje "olvidar el gate de una sección escondida" la prueba |
| Añadir una query por request en el camino de cobro | `tenant.findUnique` por PK, el mismo coste que el gate de agenda ya aceptado. Se declara en el done. |
| Un cajero con catálogo cacheado y caja recién apagada | el gate de ruta le corta igual: el flag cacheado es UI, la puerta es el servidor |
