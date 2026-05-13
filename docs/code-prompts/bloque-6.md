# Prompt para Claude Code — Bloque 6

Pega esto en una sesión nueva de Claude Code una vez B5 esté
mergeado en GitHub.

---

Hola Code. Arrancamos B6 — el bloque que completa la operativa
admin del propietario y endurece el modo degradado, dejando el TPV
listo para piloto real (sólo falta impresión que va a un bloque
dedicado posterior).

## Contexto

B1 + B2 + B3 + B4 + B5 commiteados y pusheados (`5a43aad`,
`535b3e1`, `1027211`, `c616b93`, `7ff986c`). Lee primero:

- `docs/blocks/B1-done.md` ... `B5-done.md` — memoria persistente
  de cada bloque.
- `docs/07-nucleo-comun.md` §5 (modo degradado), §6 (venta y
  descuentos), §15 (roles y permisos), §17 (seguridad).
- `docs/04-stack-y-decisiones.md` — ADRs.
- `docs/design/tokens.md` y `reference-app.tsx` — el modal de PIN
  encargado y la pantalla de Ajustes de tienda siguen el design
  system.

Antes de tocar código, **resume lo que entiendes** y plantéa
discrepancias. Sin luz verde no empieces.

## Bloque 6 · Admin completo + endurecimiento operativo

### Resumen del alcance

Cinco frentes:

1. **MANAGER en admin** con `requireOwnerOrManager` y permisos
   limitados. Resuelve el edge case heredado de B5.
2. **Umbral de descuento por cajero con PIN encargado**.
3. **Modo degradado bloqueante 24h/48h** (núcleo §5).
4. **Pantalla de Ajustes de tienda** (configuración tenant) —
   donde el propietario controla los flags introducidos en bloques
   previos.
5. **UI ticket regalo masivo prep** — bandeja del ticket regalo
   sin impresión real todavía (la real va al bloque de impresión).

Fuera de B6 explícito:
- Impresión real ESC/POS, agente local, cajón eléctrico → bloque
  dedicado posterior.
- Bar (mesas + websockets + agrupar mesas + multi-terminal) → B7.
- Customer-facing display, datáfono, WhatsApp → v2.

### 1. MANAGER en admin

#### 1.1 Auth y guards

Nuevo middleware `requireOwnerOrManager` en
`apps/api/src/auth/middleware.ts`:

- Acepta JWT de `User.role IN ('OWNER', 'MANAGER')`.
- Decora `request.actor = { userId, role, tenantId }`.
- Rechaza CASHIER con 403.

El login del admin (`POST /auth/login`) ya acepta MANAGER
funcionalmente. Lo que falta es:

- **Bloquear acceso al admin si el usuario es CASHIER**. La PWA
  admin chequea `user.role`; si es CASHIER, mensaje "No tienes
  acceso a admin" + redirect a logout.
- **Login del admin debe rechazar CASHIER** explícitamente con
  mensaje claro ("Los cajeros sólo pueden acceder desde el TPV
  con su PIN").

#### 1.2 Permisos diferenciados

Mapa de acceso por endpoint y por pantalla:

| Pantalla / Endpoint | OWNER | MANAGER |
|---|---|---|
| Sidebar item Tiendas | ✓ | ✓ ver |
| Sidebar item Dispositivos | ✓ | ✓ |
| Sidebar item Cajeros | ✓ | ✓ ver + reset PIN |
| Sidebar item Productos (SKU review) | ✓ | ✓ |
| Sidebar item Mi cuenta | ✓ | ✓ propia |
| Sidebar item Seguridad | ✓ | ✓ propia (2FA suyo) |
| Sidebar item Holded (bandeja errores) | ✓ | ✓ |
| Sidebar item Ajustes tienda | ✓ | ❌ |
| Crear/editar/borrar Store | ✓ | ❌ |
| Crear/editar/borrar Register | ✓ | ❌ |
| Crear/editar/borrar Cajero | ✓ | ❌ |
| Reset PIN cajero | ✓ | ✓ |
| Generar código emparejamiento | ✓ | ✓ |
| Revocar device | ✓ | ✓ |
| Rotar API Key Holded | ✓ | ❌ |
| Cambiar fiscal profile tenant | ✓ | ❌ |
| Activar/desactivar 2FA propio | ✓ | ✓ |
| Bandeja SYNC_FAILED — ver | ✓ | ✓ |
| Bandeja SYNC_FAILED — retry / mark-resolved / edit-sku | ✓ | ✓ |
| Autorizar cierre con SYNC_FAILED | ✓ | ✓ (con PIN propio) |

#### 1.3 Implementación

En el backend, cambiar `requireOwner` por `requireOwnerOrManager`
en los endpoints que el MANAGER puede usar (la mayoría). Mantener
`requireOwner` puro sólo en:

- `POST /admin/stores*`
- `PATCH /admin/stores*`
- `DELETE /admin/stores*`
- `POST /admin/stores/:id/registers`
- `PATCH /admin/registers/:id`
- `DELETE /admin/registers/:id`
- `POST /cashiers` (alta)
- `DELETE /cashiers/:id` (borrar)
- `POST /auth/me/rotate-holded-key`
- `PUT /auth/me/fiscal-profile`
- `POST /admin/tenant/settings` (nuevo, frente 4)

`PATCH /cashiers/:id/pin` se queda `requireOwnerOrManager` (los
managers pueden resetear PINs de cajeros).

En el admin frontend:

- `AdminShell` filtra los ítems del sidebar según `user.role`.
- Páginas restringidas (StoresPage edit, CashiersPage create,
  AccountPage rotate-key) muestran botones de acción sólo si
  `user.role === 'OWNER'`. Para MANAGER son sólo de lectura.
- Si MANAGER intenta acceder a una URL restringida (e.g.
  `/admin/account` con form fiscal), muestra mensaje "Sólo el
  propietario puede modificar esto" y mantiene la vista de sólo
  lectura.

### 2. Umbral de descuento por cajero con PIN encargado

#### 2.1 Schema

Nuevo campo en `Tenant`:

```prisma
discountThresholdPct  Decimal  @default(10)  @map("discount_threshold_pct") @db.Decimal(5, 2)
```

Default 10%. Configurable por tienda en frente 4.

Migración: `b6_tenant_settings` (junto con los demás campos del
frente 4).

#### 2.2 Lógica

En el TPV, cuando el cajero aplica un descuento (global o por
línea):

- Calcula el porcentaje efectivo sobre subtotal.
- Si el descuento ≤ `discountThresholdPct`: aplica directamente.
- Si supera el umbral:
  - Modal de autorización con PIN encargado.
  - El cajero llama al encargado, éste introduce su PIN.
  - PWA llama `POST /admin/auth/manager-authorize` con
    `{ managerEmail, managerPin, reason: 'discount_over_threshold',
      ticketContext: { discountPct, total } }`.
  - Backend valida PIN, devuelve `authorizationToken` JWT corto
    (5 min, claim `purpose: "discount-override"`).
  - PWA incluye `authorizationToken` en el `POST /tickets` que se
    enviará al cobrar. Backend valida que el token es válido,
    coincide con el descuento del ticket, y persiste
    `Ticket.authorizationToken = managerEmail` + `audit log`.

#### 2.3 Endpoint

`POST /admin/auth/manager-authorize` (nuevo):

- Body: `{ managerEmail, managerPin, reason, ticketContext }`.
- Valida `managerEmail` existe en el tenant con `role=MANAGER` y
  `pinHash` definido.
- Rate-limit 5 intentos / 5 min por managerEmail.
- Si OK, firma JWT corto:
  ```ts
  {
    sub: manager.id,
    tid: tenant.id,
    purpose: 'discount-override',
    reason: 'discount_over_threshold',
    context: { maxDiscountPct: 100 },  // permite cualquier descuento
    exp: now + 5min
  }
  ```
- Devuelve `{ authorizationToken, managerEmail }`.

#### 2.4 Validación en `POST /tickets`

El handler de `POST /tickets` ahora:

- Calcula descuento efectivo del ticket.
- Si supera el umbral, exige `authorizationToken` válido en el
  body.
- Si falta el token, devuelve 403 `MANAGER_AUTHORIZATION_REQUIRED`.
- Si el token es válido pero no autoriza ese descuento (e.g.
  `context.maxDiscountPct < descuentoEfectivo`), 403.
- Si OK, persiste el ticket y guarda en metadata el manager que
  autorizó.

#### 2.5 UI TPV

- Cuando el cajero pone descuento > umbral en el sheet de línea
  o descuento global, modal aparece automáticamente.
- Modal con email + PIN del encargado, copy claro:
  "Descuento del X% supera el umbral (10%). Pide al encargado que
  introduzca su PIN para autorizar."
- Si OK, cierra modal y el descuento queda aplicado al ticket
  hasta el cobro.

### 3. Modo degradado bloqueante 24h/48h

Implementa lo que núcleo §5 define como umbral temporal.

#### 3.1 Estado del tenant

Nuevo helper `getTenantHealthStatus(tenantId)` en
`apps/api/src/tickets/health.ts`:

- Lee `Tenant.lastIncrementalSyncAt` (último cron OK) +
  `Tenant.holdedApiKeyCiphertext` (existe).
- Si la API Key falta o el último sync >48h → `level: 'blocked'`,
  `reason: 'no_sync_48h' | 'no_api_key'`.
- Si último sync >24h → `level: 'warning'`, `reason: 'no_sync_24h'`.
- Si todo OK → `level: 'ok'`.

#### 3.2 Endpoints afectados

- **`GET /tpv/health/holded`** (ya existe): amplía respuesta con
  `{ level, reason, lastSuccessfulSyncAt, blockedAt? }`.
- **`POST /shift/open`**: si `level === 'blocked'`, devuelve 409
  `TENANT_BLOCKED` con `reason` y el `blockedAt` para que el TPV
  muestre la pantalla bloqueada. NO crea el shift.
- **`POST /shift/:id/close`**: si `level === 'blocked'`, devuelve
  igual 409. NO cierra. El cajero contacta soporte.
- **`POST /tickets`**: NO se bloquea (cobros locales siguen). Pero
  el banner del TPV avisa.

#### 3.3 UI TPV

- **Banner permanente en el header** con tres estados:
  - Verde (oculto si todo OK).
  - Ámbar "Sincronización pendiente · más de 24h sin contacto con
    Holded" + link "Revisar estado".
  - Rojo bloqueante "TPV bloqueado · más de 48h sin sincronizar.
    Contacta soporte." + datos de la última sync.
- En el modo rojo, los botones de **abrir turno** y **cerrar
  turno** quedan deshabilitados con tooltip. La pantalla de PIN
  permite login (no quieres dejar al cajero sin poder identificarse)
  pero la siguiente pantalla muestra el bloqueo.

#### 3.4 UI admin

En la bandeja de Holded (`/admin/tickets-errors`):

- Banner arriba con `health` del tenant: ámbar si 24h, rojo si
  48h. Link "Probar conexión" lleva a `/admin/account` donde el
  propietario puede ejecutar `test-holded-connection` o cambiar
  la API Key.

#### 3.5 Recuperación automática

Cuando el cron de sync incremental termina exitoso, automáticamente
actualiza `Tenant.lastIncrementalSyncAt`. El siguiente `health`
detecta el cambio y desbloquea. No requiere acción manual del
propietario más que arreglar lo que sea que falle (API Key
caducada, conectividad, etc.).

### 4. Pantalla de Ajustes de tienda

Donde el propietario controla los flags introducidos en bloques
previos pero sin UI hasta ahora.

#### 4.1 Schema

Campos ya existentes en `Tenant`:

- `cashierAutoLogoutMinutes` (B3, default 10) — auto-logout PIN.
- `requireManagerPinForForceClose` (B3, default true) — PIN
  encargado para forzar cierre turno colgado.
- `deviceNewLoginAlertEnabled` (B3, default true) — email cuando
  device nuevo se vincula.
- `discountThresholdPct` (B6 §2, default 10) — umbral descuento.

Nuevo campo en `Tenant` (frente 4 de B6):

- `cashierSearchableContacts: Boolean @default(true)` — permite al
  cajero buscar contactos Holded desde TPV (si false, sólo OWNER/
  MANAGER puede asociar contacto a ticket).

Migración: `b6_tenant_settings` (incluye también
`discountThresholdPct` del frente 2).

#### 4.2 Endpoints

- **`GET /admin/tenant/settings`** (`requireOwnerOrManager`):
  devuelve los 5 campos.
- **`POST /admin/tenant/settings`** (`requireOwner`): edita los
  campos con validación (`cashierAutoLogoutMinutes` entre 5-60,
  `discountThresholdPct` entre 0-100).

#### 4.3 UI admin

Pantalla nueva `/admin/settings` accesible desde el sidebar
(activar item "Tiendas" ya estaba; este es nuevo "Ajustes" o lo
integramos como sección de "Tiendas" si prefieres).

Sugerencia: **una pantalla `/admin/settings`** con secciones:

- **Cajeros**:
  - Auto-logout (slider 5-60 min).
  - Permitir cajeros buscar contactos (checkbox).
- **Seguridad**:
  - PIN encargado obligatorio para cerrar turnos colgados
    (checkbox).
  - Alerta email cuando un dispositivo se vincula por primera
    vez (checkbox).
- **Ventas**:
  - Umbral de descuento sin autorización (slider 0-100%).

Save persiste con `POST /admin/tenant/settings`. Mensajes claros
si MANAGER intenta editar (sólo OWNER).

### 5. UI ticket regalo masivo prep

Sin impresión real (B8). Esto es la **infraestructura backend +
UI** para que cuando llegue impresión, el botón "Reimprimir ticket
regalo" funcione.

#### 5.1 Endpoints

- **`GET /admin/tickets/gift-receipt-candidates`**
  (`requireOwnerOrManager`): lista tickets recientes (default
  últimos 30 días, configurable) con datos para reimpresión:
  número interno, fecha, total, líneas resumen.
- **`POST /admin/tickets/:id/gift-receipt-intent`**
  (`requireOwnerOrManager`): marca `Ticket.giftReceiptIntentAt =
  now()` para que el sistema sepa que el propietario quiere
  reimprimir. Sin imprimir realmente.
- **`POST /admin/tickets/batch-gift-receipt`**
  (`requireOwnerOrManager`): body `{ ticketIds: string[] }`,
  marca todos con `giftReceiptIntentAt = now()`. Para el caso de
  temporada (rebajas, Navidad) donde el propietario quiere
  reimprimir tickets regalo en lote.

#### 5.2 UI admin

Pantalla `/admin/gift-receipts` (item nuevo del sidebar) con:

- Filtros: rango de fechas, tienda, mínimo importe.
- Tabla con checkbox por fila para selección múltiple.
- Botón "Marcar para ticket regalo" en el bottom bar cuando hay
  selección. Llama al endpoint batch.
- Banner explicativo: "Estos tickets quedarán marcados para
  ticket regalo. La impresión física se hará cuando el bloque de
  impresión esté disponible."

#### 5.3 Para el TPV (futuro)

Sin trabajo adicional en B6. Cuando llegue impresión, el TPV
podrá leer `giftReceiptIntentAt` y reimprimir los marcados desde
la pantalla de Tickets pasados (que ya existe desde B4).

### 6. Tests

- **Auth MANAGER**:
  - Login MANAGER OK.
  - MANAGER accede a endpoints permitidos.
  - MANAGER rechazado en endpoints sólo-OWNER.
  - CASHIER rechazado en login admin.
- **Discount authorization**:
  - Descuento ≤ umbral → ticket OK sin token.
  - Descuento > umbral sin token → 403.
  - Descuento > umbral con token válido → 201.
  - Token caducado → 403.
  - Rate-limit manager-authorize.
- **Modo degradado**:
  - Sync OK reciente → level=ok.
  - 25h sin sync → level=warning.
  - 49h sin sync → level=blocked, shift/open devuelve 409.
  - API key faltante → blocked.
- **Tenant settings**: GET/POST con validaciones, MANAGER puede
  ver pero no editar.
- **Gift receipt batch**: marca múltiples, idempotente.

### 7. Restricciones

- No regresiones en B1-B5. Todos los tests previos siguen verdes.
- NO tocar impresión real, agente local, ESC/POS — bloque
  dedicado posterior.
- NO tocar bar/mesas/websockets — B7.
- TypeScript estricto, JSON Schema en body.
- Migración Prisma versionada (`b6_tenant_settings` agrupa todo).

### 8. Entregables

1. PR único con todo B6.
2. Commit messages descriptivos.
3. `.env.example` si hay variables nuevas (no espero).
4. `docs/blocks/B6-done.md` con mismo formato que B1-B5.

### 9. Lo que NO entra en B6

- **Impresión real ESC/POS, agente local, cajón eléctrico,
  customer-facing display** → bloque dedicado de impresión
  (probablemente B8 según el orden propuesto).
- **Bar/mesas/agrupar mesas/multi-terminal websockets** → **B7**.
- **Customer-facing display, WhatsApp, datáfono, fidelización**
  → v2.
- **Audit log dedicado** (tabla aparte) → posible B8 o cuando
  haga falta para auditorías reales.
- **Conversión ticket→factura integrada** → v2.

Cuando termines B6 y Matías lo revise, te paso B7 (bar/mesas).
