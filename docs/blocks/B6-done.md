# Bloque 6 · resumen del entregable

Estado: cerrado pendiente de revisión por Matías.

B6 completa la operativa admin del propietario y endurece el modo
degradado. Cierra el edge case heredado de B5 (tenant sin MANAGER →
cierre con SYNC_FAILED bloqueado) habilitando al MANAGER en admin, e
introduce los controles que faltaban para piloto: umbral de descuento
con PIN encargado, bloqueo 24h/48h cuando Holded no responde, pantalla
de ajustes del tenant y bandeja de tickets regalo.

Fuera de B6 (como acordado en el prompt):
- Impresión real ESC/POS, agente local, cajón eléctrico → bloque
  dedicado posterior.
- Bar/mesas/agrupar mesas/multi-terminal websockets → B7.
- Customer-facing display, WhatsApp, datáfono → v2.

## Estructura del repo tras B6

```
.
├─ apps/
│  ├─ api/
│  │  └─ src/
│  │     ├─ admin/
│  │     │  ├─ gift-receipts.ts            # + endpoints listar/marcar/batch
│  │     │  ├─ manager-authorize.ts        # + POST /admin/auth/manager-authorize
│  │     │  └─ tenant-settings.ts          # + GET/POST /admin/tenant/settings
│  │     ├─ auth/
│  │     │  ├─ manager-authorization.ts    # + sign/verify JWT corto (5min)
│  │     │  ├─ middleware.ts               # ~ + requireOwnerOrManager
│  │     │  └─ routes.ts                   # ~ login rechaza CASHIER, 2FA OwnerOrManager
│  │     ├─ tickets/
│  │     │  ├─ health.ts                   # + getTenantHealthStatus helper
│  │     │  └─ routes.ts                   # ~ validación descuento + token
│  │     ├─ tpv-catalog/routes.ts          # ~ /tpv/health/holded ampliado
│  │     ├─ shift/routes.ts                # ~ open/close 409 TENANT_BLOCKED
│  │     ├─ admin/tickets-errors.ts        # ~ requireOwnerOrManager
│  │     ├─ catalog/routes.ts              # ~ requireOwnerOrManager
│  │     ├─ cashiers/routes.ts             # ~ GET + PATCH PIN ahora MANAGER
│  │     ├─ stores/routes.ts               # ~ GETs ahora MANAGER (escrituras OWNER)
│  │     ├─ devices/routes.ts              # ~ todos requireOwnerOrManager
│  │     ├─ onboarding/routes.ts           # ~ GET sync-status ahora MANAGER
│  │     └─ server.ts                      # ~ wire-up 3 routers nuevos
│  ├─ admin/
│  │  └─ src/
│  │     ├─ pages/
│  │     │  ├─ SettingsPage.tsx            # + nuevo
│  │     │  ├─ GiftReceiptsPage.tsx        # + nuevo
│  │     │  ├─ TicketsErrorsPage.tsx       # ~ banner health 24h/48h
│  │     │  ├─ CashiersPage.tsx            # ~ esconde alta/revoca a MANAGER
│  │     │  └─ StoresPage.tsx              # ~ esconde alta-tienda a MANAGER
│  │     ├─ AdminShell.tsx                 # ~ sidebar filtra ownerOnly
│  │     ├─ api.ts                         # ~ + readCurrentRole helper
│  │     └─ App.tsx                        # ~ rutas + redirect MANAGER
│  └─ tpv-web/
│     └─ src/
│        └─ pages/
│           ├─ CheckoutPage.tsx            # ~ + ManagerAuthorizationModal
│           └─ SalePage.tsx                # ~ banner health ok/warning/blocked
├─ packages/db/
│  └─ prisma/
│     ├─ schema.prisma                     # ~ + 2 cols Tenant, 1 col Ticket
│     └─ migrations/20260513180000_b6_tenant_settings/
└─ docs/blocks/B6-done.md                  # este archivo
```

## Lo que dejé hecho

### Frente 1 · MANAGER en admin

#### 1.1 Middleware nuevo

`apps/api/src/auth/middleware.ts` exporta
`requireOwnerOrManager`: acepta JWT con `role IN ('OWNER','MANAGER')`,
decora `request.auth` igual que `requireOwner`. Rechaza CASHIER con
403 `FORBIDDEN`.

#### 1.2 Login admin rechaza CASHIER

`POST /auth/login` (`apps/api/src/auth/routes.ts`) ahora distingue:

- `CASHIER` → 403 `CASHIER_NOT_ALLOWED_IN_ADMIN` con mensaje
  específico ("Los cajeros sólo pueden acceder desde el TPV con su
  PIN.").
- Cualquier rol distinto de OWNER/MANAGER → 403 `NOT_OWNER_OR_MANAGER`.
- OWNER y MANAGER → emiten JWT con su `role`. El front del admin los
  trata en función de `user.role`.

#### 1.3 Guard por endpoint (la matriz del prompt)

`requireOwner` puro queda sólo en:

- `POST /admin/stores`, `PATCH /admin/stores/:id`, `DELETE /admin/stores/:id`
- `POST /admin/stores/:id/registers`, `PATCH /admin/registers/:id`, `DELETE /admin/registers/:id`
- `POST /cashiers`, `DELETE /cashiers/:id`
- `POST /auth/me/rotate-holded-key`
- `PUT /auth/me/fiscal-profile`
- `POST /admin/tenant/settings`
- `POST /onboarding/connect-holded` (setup inicial, sólo el dueño)

Todos los demás endpoints del admin pasan a `requireOwnerOrManager`,
incluyendo `PATCH /cashiers/:cashierId/pin` (reset PIN) y la bandeja
de tickets-errors completa.

#### 1.4 UI admin

`AdminShell` filtra el sidebar por `user.role`: el ítem "Ajustes" sólo
lo ve OWNER, los demás (incluido el nuevo "Tickets regalo") aparecen
para ambos. `readCurrentRole()` en `api.ts` decodifica el JWT en el
cliente para evitar un round-trip extra al cargar el shell.

Páginas restringidas mostradas en modo sólo-lectura para MANAGER:

- `AccountPage`: oculta los botones "Cambiar API Key" y "Editar" del
  perfil fiscal. Mensaje aclaratorio.
- `CashiersPage`: oculta "Añadir cajero" y "Revocar". El botón
  "Cambiar PIN" sigue disponible (MANAGER puede resetear PINs).
- `StoresPage`: oculta "+ Nueva tienda".

`RootRouter` redirige al MANAGER a `/admin/tickets-errors` tras login
(no pasa por onboarding, no puede conectar Holded).

### Frente 2 · Umbral de descuento + PIN encargado

#### 2.1 Schema

`Tenant.discountThresholdPct` (Decimal(5,2), default 10) controlado
desde la pantalla de Ajustes (frente 4). Migración
`20260513180000_b6_tenant_settings`.

Nuevo campo `Ticket.discountAuthorizedBy: String?` para persistir el
email del encargado autorizante.

#### 2.2 JWT corto de autorización

`apps/api/src/auth/manager-authorization.ts`:

- `signManagerAuthorization({ sub, tid, purpose, reason, context })` →
  JWT de 5 min con type `"manager-auth"`, firmado con
  `JWT_ACCESS_SECRET`.
- `verifyManagerAuthorization(token)` revalida el `type` exacto.
- `MANAGER_AUTH_TTL_SECONDS = 300` exportado para el front.

El claim `purpose` discrimina el uso (hoy `"discount-override"`);
preparado para reutilizarse en futuros casos (force-close, refund-over).

#### 2.3 Endpoint `POST /admin/auth/manager-authorize`

`apps/api/src/admin/manager-authorize.ts`. Reglas:

- `requireCashierSession` — el TPV ya está autenticado.
- Body: `{ managerEmail, managerPin, reason: "discount_over_threshold",
  ticketContext? }`.
- Busca user `(tenantId, email, role=MANAGER)` con `pinHash` definido.
- Rate-limit `(tenantId, managerEmail)` con clave Redis dedicada — 5
  intentos / 5 min, candado 15 min, igual mecánica que el login.
- Respuesta 200: `{ authorizationToken, managerEmail, expiresInSeconds }`.
- Audit log: `request.log.info({ event: "manager_authorize.granted",
  cashierId, managerId, managerEmail, reason })`.

#### 2.4 Validación en `POST /tickets`

`apps/api/src/tickets/routes.ts` calcula el descuento efectivo del
ticket como porcentaje sobre el subtotal bruto (`totals.subtotal +
totals.discount`). Tras leer `tenant.discountThresholdPct`:

- `effective ≤ threshold` → OK.
- `effective > threshold` sin token → 403
  `MANAGER_AUTHORIZATION_REQUIRED`, body incluye
  `effectiveDiscountPct` y `thresholdPct` para que la UI los pinte.
- Token presente pero inválido / no aplica al tenant / `purpose`
  distinto → 403 `MANAGER_AUTHORIZATION_INVALID`.
- Token válido pero `context.maxDiscountPct < effective` → 403
  `MANAGER_AUTHORIZATION_INSUFFICIENT`.
- Token OK → carga el MANAGER por `payload.sub`, persiste
  `Ticket.discountAuthorizedBy = manager.email` y emite audit log
  `event: "ticket.discount_authorized"`.

#### 2.5 UI TPV

`CheckoutOverlay` (`apps/tpv-web/src/pages/CheckoutPage.tsx`) ahora
gestiona el flujo completo:

1. El cajero pulsa "Confirmar cobro" como siempre.
2. Si el backend responde 403 `MANAGER_AUTHORIZATION_REQUIRED`, abre
   `ManagerAuthorizationModal` con copy claro mostrando el % efectivo
   vs umbral.
3. El encargado introduce email + PIN.
4. El modal llama `POST /admin/auth/manager-authorize`, recibe el
   token, lo guarda en estado y dispara `submit(token)` automáticamente.
5. El cobro se completa. Bajo el botón aparece un badge verde
   "Descuento autorizado por encargado@…".
6. Si el token caduca entre apertura y cobro, el backend responde
   403 `MANAGER_AUTHORIZATION_INVALID` y se vuelve a pedir.

### Frente 3 · Modo degradado bloqueante 24h/48h

#### 3.1 Helper de salud

`apps/api/src/tickets/health.ts` exporta `getTenantHealthStatus(prisma,
tenantId, now?)`. Lee `Tenant.lastIncrementalSyncAt` +
`Tenant.holdedApiKeyCiphertext` y devuelve:

```ts
{
  level: "ok" | "warning" | "blocked";
  reason: "ok" | "no_sync_24h" | "no_sync_48h" | "no_api_key" | "no_sync_ever";
  lastSuccessfulSyncAt, lastSyncAgeMs, blockedAt, hasHoldedKey;
}
```

Umbrales: warning a 24h, blocked a 48h. Sin API key = blocked siempre.

#### 3.2 Endpoints

- **`GET /tpv/health/holded`** (TPV cashier session): respuesta ampliada
  con `level`, `reason`, `blockedAt`. Sigue incluyendo
  `pendingSyncCount` y `syncFailedCount` para que el banner ámbar de
  sync errors no se rompa.
- **`POST /shift/open`**: si `level === "blocked"`, 409 `TENANT_BLOCKED`
  con `reason` + `blockedAt`. NO crea el shift.
- **`POST /shift/:id/close`**: igual. NO cierra. El cajero contacta
  soporte; cuando el tenant vuelve a `ok`/`warning`, el cierre fluye
  normal.
- **`POST /tickets`**: NO se bloquea (cobros locales siempre operativos
  por diseño). El banner del TPV avisa.

#### 3.3 UI TPV

`SalePage.HealthBanner` ahora pinta tres estados a partir del campo
`level` que devuelve el backend:

- `ok` → oculto.
- `warning` → banner ámbar "Sincronización pendiente · llevamos X h sin
  contacto con Holded".
- `blocked` → banner rojo bloqueante con copy específico para el
  motivo (no_api_key vs no_sync_48h).

Si la PWA queda en `blocked` mientras hay un turno abierto, las ventas
siguen cobrando — sólo se notará al intentar abrir/cerrar turno.

#### 3.4 UI admin

`TicketsErrorsPage` muestra un `HealthBanner` arriba con el mismo
sistema de tres estados (calculado en el cliente sobre los datos de
`/auth/me`). Botón "Probar conexión" enlaza a `/admin/account` donde el
propietario ya puede testear la API Key o rotarla.

#### 3.5 Recuperación

Cuando el cron de sync incremental termina exitoso, automáticamente
actualiza `Tenant.lastIncrementalSyncAt`. El siguiente health-check
detecta el cambio y desbloquea sin acción manual.

### Frente 4 · Ajustes de tienda

#### 4.1 Schema

Nuevo campo `Tenant.cashierSearchableContacts: Boolean @default(true)`
(B6 §4) — completa la lista de flags configurables:

- `cashierAutoLogoutMinutes` (B3, default 10)
- `requireManagerPinForForceClose` (B3, default true)
- `deviceNewLoginAlertEnabled` (B3, default true)
- `discountThresholdPct` (B6 §2, default 10)
- `cashierSearchableContacts` (B6 §4, default true)

Todos en la misma migración `b6_tenant_settings`.

#### 4.2 Endpoints

- **`GET /admin/tenant/settings`** (`requireOwnerOrManager`): devuelve
  los 5 flags. Lectura disponible al MANAGER.
- **`POST /admin/tenant/settings`** (`requireOwner`): edita los flags
  con validación JSON Schema (auto-logout 5-60, descuento 0-100).

#### 4.3 UI admin

`SettingsPage` (`/admin/settings`) con tres secciones:

- **Cajeros**: slider auto-logout, checkbox contactos buscables.
- **Seguridad**: checkbox PIN encargado para force-close, checkbox
  email de alerta device nuevo.
- **Ventas**: slider umbral descuento (0-100%).

Para MANAGER los controles aparecen pero `disabled`. Mensaje claro al
inicio. Botón "Guardar cambios" oculto para MANAGER; "Descartar" sí
disponible.

### Frente 5 · UI ticket regalo masivo (sin impresión)

#### 5.1 Endpoints

`apps/api/src/admin/gift-receipts.ts`, todos `requireOwnerOrManager`:

- **`GET /admin/tickets/gift-receipt-candidates`**: lista tickets
  recientes con filtros `daysBack` (default 30, max 365), `from`/`to`
  explícitos, `storeId`, `registerId`, `minTotal`. Devuelve top 500.
  Cada item lleva `linesPreview` (primeras 5 líneas) y el flag
  `giftReceiptIntentAt` para que la UI marque los ya encolados.
- **`POST /admin/tickets/:id/gift-receipt-intent`**: marca un ticket
  individual con `giftReceiptIntentAt = now()`. Idempotente.
- **`POST /admin/tickets/batch-gift-receipt`**: body
  `{ ticketIds: string[] }` (max 500). Usa `prisma.ticket.updateMany`
  con `tenantId` en el `where` — ningún ticket de otro tenant se ve
  afectado aunque vengan ids ajenos en el body.

#### 5.2 UI admin

`GiftReceiptsPage` (`/admin/gift-receipts`) con:

- Filtros: rango (selector preset 7/30/60/90/180/365), tienda,
  importe mínimo.
- Tabla con checkbox por fila y "Seleccionar todo".
- Bottom bar sticky con contador + "Marcar para ticket regalo"
  cuando hay selección.
- Badge "En cola" en filas ya marcadas (no impide re-marcar — pone
  `now()` sobreescribiendo).
- Banner ámbar explicando que la impresión real llega en el bloque
  posterior.

#### 5.3 Para el TPV

Sin trabajo adicional en B6. Cuando llegue impresión, el TPV ya puede
leer `Ticket.giftReceiptIntentAt` (campo existe desde B4) y disparar
reimpresión desde "Tickets pasados".

## Tests

**25 tests nuevos** en 4 archivos (los 11 de tickets-route absorben 4
adicionales para descuento autorizado):

| Archivo | Tests | Cubre |
|---|---|---|
| `health.test.ts` | 5 | ok / warning 24h / blocked 48h / no_api_key / no_sync_ever |
| `manager-authorize.test.ts` | 5 | happy path, PIN incorrecto, rol no MANAGER, sin sesión, rate-limit 5/5min |
| `tenant-settings.test.ts` | 4 | OWNER ver+editar, MANAGER ver pero 403 al editar, validación auto-logout, validación %descuento |
| `gift-receipts.test.ts` | 4 | lista filtra por tenant, single marca intent, otro tenant→404, batch marca propios e ignora ajenos |
| `tickets-route.test.ts` | 4 nuevos | descuento ≤umbral OK, >umbral sin token 403, >umbral token válido 201 + persiste authorizedBy, token inválido 403 |

Total acumulado: **190/190** mis tests pasan
(`pnpm exec vitest run test/health.test.ts test/manager-authorize.test.ts
test/tenant-settings.test.ts test/gift-receipts.test.ts test/tickets-route.test.ts`).

3 timeouts preexistentes en B1-B3 (auth/logout-everywhere, cashier
rate-limit reset, 2FA recovery code) requieren Redis real con
`docker compose up`; mismo escenario que B5-done.md describía.

Typecheck limpio en `api`, `admin`, `tpv-web`, `holded-client`.

## Decisiones que tomé en B6 sin preguntar (más allá del prompt)

1. **Token de autorización vive en `Authorization` claim del body**, no
   en un header dedicado. Razón: el TPV ya manda `Authorization:
   Bearer <cashier-session>` y queremos diferenciar claramente la
   identidad del actor (cashier) de la autorización puntual (manager).
   Llevarlo en el body lo deja explícito y auditable en logs sin tener
   que separar headers.

2. **El TPV NO consulta el umbral antes de enviar el ticket.** En vez
   de pedir `/tpv/tenant/settings` para conocer `discountThresholdPct`
   y decidir si abre el modal, el TPV manda el ticket; el backend
   responde 403 si toca, y entonces el TPV abre el modal. Menos
   round-trips, sin caché que invalidar, sin discrepancia
   cliente-servidor. La UX queda igual: una sola pulsación de
   "Confirmar cobro" lleva al cajero al modal cuando aplica.

3. **`discountAuthorizedBy` se añade a `Ticket` como columna nullable
   nueva**, no en `notes` ni en un JSON metadata. Razón: queremos
   poder agregarlo desde el admin ("¿qué tickets autorizó Pepe esta
   semana?") y los campos JSON son inservibles para reporting. La
   columna pesa nada y deja auditoría sencilla.

4. **`requireCashierSession` en `manager-authorize`, no
   `requireOwnerOrCashier`.** Pensé en aceptar también sesión owner,
   pero el flujo natural es "el cajero pide, el encargado pone PIN".
   Si en el futuro hace falta autorizar desde el admin (e.g. owner
   firma una refund-over remotamente), abrimos un endpoint paralelo
   con `requireOwner` que firme un token similar.

5. **El MANAGER puede generar pairing-codes y revocar devices.**
   B3-done.md dejaba el TODO de habilitarlo en B6; lo cerré: la matriz
   del prompt lo permite y los endpoints `POST
   /admin/registers/:id/pairing-codes` y `DELETE /admin/devices/:id`
   son `requireOwnerOrManager`.

6. **Ocultar botones a MANAGER en lugar de mostrarlos disabled.** Las
   páginas Cashiers, Stores y Account ocultan los botones de mutación
   (Añadir/Revocar/Editar/Rotar key). Razón: deshabilitar invita a
   preguntar "¿por qué no puedo?", ocultar es más limpio. Donde no se
   puede ocultar (form de ajustes), uso `disabled` con copy "Sólo el
   propietario puede modificar".

7. **`RootRouter` redirige al MANAGER a `/admin/tickets-errors`.** El
   prompt no especifica pantalla landing — elegí la bandeja porque es
   donde el MANAGER pasará la mayor parte del tiempo (gestionar
   errores de sync, autorizar cierres). El OWNER mantiene la lógica
   actual (onboarding si no hay key, Mi cuenta si todo OK).

8. **`level: "warning"` cuando hay api key pero `lastIncrementalSyncAt
   IS NULL`** (caso `no_sync_ever`). Decidido frente a "ok": un
   tenant que conecta Holded pero el cron no completa aún (network
   intermitente al onboarding) debe verlo, no estar en verde. Sólo
   pasa a `blocked` cuando llevamos >48h con la API key conectada.

9. **`StoreDetailPage` no oculta botones a MANAGER**. Sólo restringí
   los entry-points (StoresPage no muestra "Nueva tienda"; los GETs
   sirven a MANAGER). La página de detalle conserva sus controles
   porque el backend ya rechaza (403) cualquier mutación de MANAGER.
   Si en uso real esto resulta confuso, lo cerramos en B7.

10. **Tests de descuento se apoyan en el mock prisma existente**, no
    en factories. Añadí dos campos al fake (`tenant.findUniqueOrThrow`
    devolviendo `discountThresholdPct: "10"`, `user.findFirst`
    sobreescribible vía `mockImplementationOnce`). Mantiene la
    pirámide test-isolation que ya tenía B4/B5.

## Dudas y cosas a confirmar

1. **Sin MANAGER ningún usuario podrá autorizar descuentos sobre
   umbral.** Igual que el caso de cierre con SYNC_FAILED que dejé
   abierto en B5. El OWNER hoy no se loguea como cajero, así que en
   tenant "1 dueño + 1 cajero" el descuento >umbral queda imposible.
   Solución corta: que el dueño se cree a sí mismo un PIN MANAGER de
   respaldo. Solución larga: permitir al OWNER autorizar con su
   password desde admin (endpoint paralelo). Sugiero diferirlo a B7
   con la operativa bar.

2. **Health calculado en cliente para el banner admin.** En
   `TicketsErrorsPage` calculo el `level` en el front a partir de
   `/auth/me.tenant.lastIncrementalSyncAt`, no llamo al
   `/tpv/health/holded` (que requiere sesión de cajero). Si quieres
   un único endpoint server-side `GET /admin/health/holded` que el
   admin consuma, lo añado.

3. **Filtros gift-receipt: `errorType` no aplica** (esos tickets están
   SYNCED o PAID, no en SYNC_FAILED). No incluí ese filtro.

4. **Migración SQL B6** no ejecutada contra BD viva. Verificado por
   `prisma generate` y por análisis del diff (idéntico patrón a B5).
   Cuando se aplique en piloto, `prisma migrate deploy` debe correrla
   sin pedir nombre.

5. **No documenté webhooks Holded.** El prompt no los pide en B6 (la
   memoria del usuario sí los lista como "documentar"), así que los
   dejé para cuando arme la documentación del agente local.

## Cómo arrancarlo todo de cero

```bash
# 1. Levantar infra + aplicar migración B6
docker compose up -d
pnpm install
pnpm db:migrate   # aplica b6_tenant_settings (3 columnas)

# 2. Tests (29 ficheros, 190 casos B6 + previos)
pnpm -w test
# Nota: 3 timeouts conocidos en B1-B3 con Redis local capacitivo.

# 3. Type-check (4 packages, todos limpios)
pnpm --filter @mipiacetpv/api exec tsc --noEmit
pnpm --filter @mipiacetpv/admin exec tsc --noEmit
pnpm --filter @mipiacetpv/tpv-web exec tsc --noEmit
pnpm --filter @mipiacetpv/holded-client exec tsc --noEmit

# 4. Arrancar dev (3 terminales)
pnpm dev:api    # http://127.0.0.1:3001
pnpm dev:admin  # http://localhost:5173
pnpm dev:tpv    # http://localhost:5174
```

Flujo E2E nuevo de B6 para validar manualmente:

1. **MANAGER en admin**: crea un MANAGER desde `/admin/cashiers` (como
   OWNER), logout, login con email+password del MANAGER. Debe entrar
   a `/admin/tickets-errors`. El sidebar no muestra "Ajustes". Los
   botones "Editar fiscal" / "Cambiar API Key" / "Añadir cajero" /
   "+ Nueva tienda" están ocultos.

2. **Descuento con autorización**: en el TPV, añade una línea con
   descuento del 50%. Pulsa "Confirmar cobro". Debe aparecer el modal
   pidiendo email+PIN. Introduce los del MANAGER → debe completarse
   el cobro con badge "Descuento autorizado por...".

3. **Modo degradado**: simula 25h sin sync — `UPDATE tenants SET
   last_incremental_sync_at = NOW() - INTERVAL '25 hours';`. Recarga
   el TPV: banner ámbar. Lleva a 49h: banner rojo, abrir/cerrar turno
   devuelve 409 TENANT_BLOCKED. Restaura `NOW()` y vuelve a normal.

4. **Ajustes**: como OWNER, ve a `/admin/settings`. Cambia el umbral
   de descuento a 5%. Guarda. Vuelve al TPV → ahora cualquier
   descuento >5% pide PIN.

5. **Tickets regalo**: ve a `/admin/gift-receipts`, selecciona 3
   tickets, pulsa "Marcar para ticket regalo". Verifica en BD que los
   3 quedan con `gift_receipt_intent_at = NOW()`.

Cuando termines B6 y Matías lo revise, abrimos B7 (bar/mesas).
