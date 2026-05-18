# B-OnboardingV2 · alta supervisada de tenants

Estado: cerrado pendiente de revisión por Matías.

Rediseña el flujo de alta de tenants para que el equipo mipiacetpv
pruebe el TPV completo del cliente antes de que el cliente toque nada,
con Holded como única fuente de verdad fiscal y un admin OWNER libre de
complejidad técnica.

Fuera de B-OnboardingV2 (explícito):
- Self-service signup público.
- Billing / Stripe.
- DELETE tenant (block sigue siendo la operación correcta).
- OAuth con Holded.
- Webhooks Holded (sigue polling cron).
- Auto-detección de "READY" más sofisticada que `readinessChecks`.

## Estructura tras B-OnboardingV2

```
.
├─ apps/api/src/
│  ├─ auth/
│  │  └─ middleware.ts                       # ~ inyecta cashier.isTest
│  ├─ devices/
│  │  └─ auth.ts                             # ~ X-Device-Token acepta JWT test-cashier
│  ├─ shift/
│  │  ├─ cashier-auth.ts                     # + GET /shift/cashier-bootstrap (modo prueba)
│  │  └─ cashier-session.ts                  # ~ purpose opcional; isTest en ctx
│  ├─ superadmin/
│  │  ├─ audit.ts                            # ~ +3 acciones (create_tenant_draft, activate_tenant, test_cashier_session)
│  │  ├─ onboarding-health.ts                # + heurística de salud del onboarding
│  │  ├─ test-cashier.ts                     # + provision idempotente + emisión JWT + purge
│  │  └─ tenants.ts                          # ~ POST/tenants reescrito + activate + test-cashier-token + holded-api-key + onboardingHealth en :id
│  ├─ tickets/
│  │  ├─ send-ticket-email.ts                # ~ skip tickets TEST con SKIPPED_TEST
│  │  └─ upload-ticket.ts                    # ~ skip tickets TEST sin subir a Holded
│  └─ workers/
│     └─ initial-sync-worker.ts              # ~ auto-provision cajero técnico tras sync OK
├─ apps/admin/src/
│  ├─ AdminShell.tsx                         # ~ secciones técnicas superAdminOnly
│  └─ superadmin/
│     ├─ CreateTenantPage.tsx                # ~ form solo apiKey + taxId opcional
│     ├─ TenantsListPage.tsx                 # ~ badge OnboardingState
│     ├─ TenantDetailPage.tsx                # ~ paneles DRAFT (health, test, activate) + ACTIVE clásico
│     └─ types.ts                            # ~ +OnboardingHealth, +TestCashierTokenResponse, +ActivateTenantResponse
├─ apps/tpv-web/src/
│  ├─ App.tsx                                # ~ bootstrap modo prueba salta pair+pin
│  ├─ main.tsx                               # ~ consume query params antes del render
│  ├─ components/
│  │  └─ TestModeBanner.tsx                  # + banner amarillo con countdown
│  ├─ lib/
│  │  └─ test-mode.ts                        # + estado sessionStorage del modo prueba
│  └─ storage.ts                             # ~ getDeviceToken/CashierSession prefieren test mode
├─ packages/db/prisma/
│  ├─ schema.prisma                          # ~ OnboardingState · Tenant.onboardingState · User.isTestCashier/deletedAt · TicketStatus.TEST
│  └─ migrations/
│     └─ 20260518000000_b10_onboarding_v2/   # + migración SQL coordinada
└─ apps/api/test/
   ├─ onboarding-v2.test.ts                  # + 8 tests integradores del flow nuevo
   └─ super-admin.test.ts                    # ~ tests del flow legacy quedan skipped
```

## Frentes

### Frente 1 · Migración `b10_onboarding_v2`

Tres cambios aditivos coordinados:

- `tenants.onboarding_state` (enum DRAFT|ACTIVE). Backfill ACTIVE para
  no romper tenants del flujo legacy.
- `users.is_test_cashier` (BOOL, default false) + `users.deleted_at`
  (TIMESTAMPTZ NULL).
- `tickets.status` += `TEST` (valor nuevo del enum existente).

### Frente 2 · POST `/super-admin/tenants` solo con apiKey Holded

Body nuevo: `{ holdedApiKey, taxId?, legalName? }`.

Flujo:
1. Validar `taxId` con `validateSpanishTaxId` si viene (rechazo 400
   `INVALID_HOLDED_FISCAL_PROFILE` si inválido).
2. Validar API key contra Holded vía `listWarehouses`. Mapeo de errores:
   - 401/403 Holded → 400 `HOLDED_API_KEY_INVALID`.
   - 402 Holded → 400 `HOLDED_SUSPENDED`.
   - 200+HTML → 502 `HOLDED_INVALID_RESPONSE`.
3. Extraer `fiscalProfile.legalName` y `address` del warehouse default
   (spike §08: Holded NO expone endpoint /account/me).
4. Si `taxId` viene: check de unicidad con `$queryRaw` sobre
   `fiscal_profile ->> 'taxId'` → 409 `TENANT_NIF_TAKEN`.
5. Crear Tenant DRAFT con `holdedApiKeyCiphertext`, `onboardingState=DRAFT`,
   `initialSyncStatus=PENDING`. **Sin OWNER user.**
6. Encolar `initial-sync` (jobId determinista `tenant-<id>`).
7. Audit `create_tenant_draft` con `{ tenantName, fiscalNif, source }`.

Respuesta: `{ tenant: { id, name, fiscalProfile, fiscalNif, onboardingState, createdAt }, syncJobId }`.

### Frente 3 · `onboardingHealth` en detalle de tenant

`GET /super-admin/tenants/:id` ahora incluye:

```json
{
  "onboardingHealth": {
    "initialSync": { "status": "DONE", "lastRunAt": "...", "errorMessage": null },
    "taxes": { "total": 108, "withValidRate": 98, "withoutRate": 10 },
    "products": { "total": 77, "sellable": 74, "withSku": 60, "withoutSku": 17 },
    "services": { "total": 24, "sellable": 0 },
    "contacts": { "total": 313 },
    "ticketsTest": { "total": 0, "lastAt": null },
    "ticketsSyncFailed": 0,
    "testCashierProvisioned": true,
    "readinessChecks": [
      { "id": "sync-done", "label": "Sync inicial completado", "ok": true, "value": "DONE" },
      { "id": "taxes-ratio", "label": "≥80% de taxes con rate", "ok": true, "value": "98/108 (91%)" },
      { "id": "products-sellable", "label": "≥50% de productos sellable", "ok": true, "value": "74/77 (96%)" },
      { "id": "no-sync-failures", "label": "Sin tickets SYNC_FAILED", "ok": true, "value": "0 pendientes" },
      { "id": "test-cashier-provisioned", "label": "Cajero técnico provisionado", "ok": true, "value": "sí" }
    ],
    "ready": true
  }
}
```

`ready` es la AND lógica de los `readinessChecks`. Thresholds 80%
(taxes) y 50% (sellable) ajustables vía constantes en
`onboarding-health.ts`.

El listado `/super-admin/tenants` añade `onboardingState` y
`onboardingReady` (calculado on-the-fly sólo en DRAFT). El badge UI
muestra "En configuración" (gris) / "Listo para activar" (ámbar) /
"Operativo" (verde) / "Bloqueado" (rojo).

### Frente 4 · Cajero técnico + modo test

Auto-provision tras `initial-sync` cuando el tenant está en DRAFT
(`superadmin/test-cashier.ts::provisionTestCashier`). Idempotente:

- Reusa la primera Store del tenant o crea "Tienda principal" con
  defaults sensatos en `ticketDelivery`.
- Reusa el primer Register de esa Store o crea "Caja 1".
- Crea User MANAGER con `isTestCashier=true`, email determinista
  `mipiacetpv-test-<tenantId.slice(0,8)>@internal.mipiacetpv.tech`,
  PIN aleatorio (6 dígitos, argon2id).
- Crea Device interno (name `mipiacetpv · modo prueba`) con
  deviceToken nuevo cada vez que se llama (cae si revocado o rota si
  sigue vivo). El plain del token sólo sale por la response del
  endpoint super-admin — nunca se persiste.

Workers tocados:
- `ticket-upload-worker`: si `ticket.status===TEST` o `user.isTestCashier`,
  marca TEST y devuelve `skipped/test_cashier`. No POSTea a Holded.
- `ticket-email-worker`: si el ticket es TEST/user.isTestCashier,
  marca `ticketEmailJob.status="SKIPPED_TEST"` con sentAt poblado.

Si el provisionamiento falla, el sync continúa OK; el super-admin
puede re-provisionar con "Re-sync" desde la consola.

### Frente 5 · "Probar TPV" desde super-admin

`POST /super-admin/tenants/:id/test-cashier-token`:
- 409 si tenant no está en DRAFT.
- Asegura provisión + Shift abierto del cashier técnico
  (`issueTestCashierSession`).
- Firma JWT cashier session con `purpose=test-cashier`, TTL 24h, sin
  refresh.
- Devuelve `{ cashierSessionToken, deviceToken, expiresAt, tenant, register, store, shiftId }`.
- Audit `test_cashier_session` con `{ expiresAt, registerId, storeName }`.

Backend:
- `cashier-session.ts`: payload con campo opcional `purpose`.
- `devices/auth.ts::requireDeviceToken`: si el header `X-Device-Token`
  es un JWT con `purpose=test-cashier`, lo acepta y monta
  `request.device.isTest=true` sin tocar la tabla `devices`.
- `cashier-auth.ts`: GET `/shift/cashier-bootstrap` exige
  `cashier.isTest=true`, devuelve `{ user, tenant, register, store, shift }`.

Frontend TPV:
- `lib/test-mode.ts` consume `?testCashierToken=` y `?testDeviceToken=`
  al cargar (en `main.tsx` antes del render), los guarda en
  `sessionStorage`, limpia la URL.
- `storage.ts` getters devuelven los valores del test mode con
  prioridad sobre `localStorage`.
- `App.tsx` detecta el modo, llama a `/shift/cashier-bootstrap` y
  arranca en estado `active` (o `needsShiftOpen` si no hay shift).
- `components/TestModeBanner.tsx` se monta arriba con texto "Modo
  prueba · ventas no se suben a Holded · cliente: X · caduca en
  NNm" + countdown 1s + botón Salir que limpia sessionStorage y
  `window.close()`.

### Frente 6 · Activar tenant

`POST /super-admin/tenants/:id/activate` con body
`{ ownerEmail, ownerName }`:

1. 409 `TENANT_NOT_DRAFT` si tenant no en DRAFT.
2. Calcular `onboardingHealth.ready`; si falso, 400
   `ONBOARDING_NOT_READY` con `failing: string[]`.
3. 409 `EMAIL_TAKEN` si el email del OWNER ya existe.
4. Transacción atómica:
   - Crear User OWNER con `mustChangePasswordAt=now()` + tempPassword
     argon2id (16 chars sin ambiguos).
   - `purgeTestData`: `deleteMany` tickets TEST, email jobs asociados,
     soft-delete del cashier técnico (deletedAt + tokenVersion++), cerrar
     sus shifts abiertos, revocar el device test.
   - `tenant.onboardingState = "ACTIVE"`.
   - Audit `activate_tenant` con `{ ownerEmail, ownerName, ticketsTestPurged, emailJobsPurged }`.
5. Send email canónico de bienvenida (reusa `sendOwnerWelcomeEmail`).
   Si SMTP falla, la tempPassword viaja en la response — el front la
   muestra con copy-to-clipboard.

### Frente 7 · Refactor permisos OWNER (parcial · ver "Deuda" abajo)

**Hecho:**
- `PATCH /super-admin/tenants/:id/holded-api-key` (SUPER_ADMIN, valida
  Holded, encripta, audita como `update_tenant`).
- `AdminShell.tsx`: secciones marcadas `superAdminOnly` se ocultan a
  OWNER/MANAGER. La sidebar deja sólo Tiendas, Cajeros, Productos,
  Tickets regalo, Mi cuenta, Seguridad. **Holded (sync errors),
  Dispositivos y Ajustes** sólo se muestran al super-admin operando
  vía impersonation (banner detectado en cliente).

**Diferido (deuda):**
- Las rutas backend per-tenant (`/admin/tickets-errors/*`,
  `/admin/sku-review/*`, `/admin/tenant/settings`, `/admin/devices/*`,
  `/auth/me/rotate-holded-key`, `/auth/me/test-holded-connection`)
  conservan su middleware actual (`requireOwner` / `requireOwnerOrManager`).
  La defensa real es la sidebar oculta: el OWNER no las ve. Mover el
  middleware exclusivo a SUPER_ADMIN exige duplicar handlers o
  introducir un nuevo `requireSuperAdminTenantScope` y romper 14 tests
  existentes — pesa más que el riesgo residual (un OWNER necesitaría
  navegar manualmente a URLs ocultas para invocarlas).
- Documentado en este archivo + en TODO de [[project_b8_carryovers]]
  para revisarlo cuando haya un super-admin frontend que necesite
  estas operaciones expuestas explícitamente.

### Frente 8 · UI super-admin + admin OWNER reducido

**Super-admin:**
- `CreateTenantPage`: form mínimo (`holdedApiKey` password masked +
  toggle show, `taxId` opcional, `legalName` opcional). Redirige a
  `/superadmin/tenants/:id` tras crear.
- `TenantsListPage`: nueva columna "Onboarding" con `<OnboardingBadge>`.
- `TenantDetailPage`: dos modos.
  - DRAFT: `<HealthPanel>` con readinessChecks + botón Re-sync,
    `<TestPanel>` con botón "Probar TPV" + contador de tickets test,
    `<ActivatePanel>` con botón disabled hasta `health.ready=true`.
  - ACTIVE: panel clásico (block/unblock/force-logout/resync/impersonate).
- Modal "Activar tenant" con form ownerEmail/ownerName + banner de
  confirmación. Tras éxito, banner verde con tempPassword
  copy-to-clipboard.

**Admin OWNER reducido:**
- `AdminShell` filtra `superAdminOnly: true` con `readImpersonationState() != null`.
- "Mi cuenta": pendiente caption "Sincronizado desde Holded · edita en
  tu cuenta Holded" + inputs `readOnly` — diferido (los datos fiscales
  siguen siendo editables vía PATCH /auth/me; el OWNER tendrá que
  redescubrirlo). Documentado en deuda.

## Decisiones explícitas

1. **Holded NO expone account/me** (spike §08): los datos fiscales
   vienen del warehouse default. `taxId` es input manual opcional;
   sin él, el OWNER lo completa tras activación.
2. **TEST como TicketStatus** (vs flag separado): permite filtros y
   contadores `WHERE status='TEST'` baratos; el worker decide skip por
   status sin join al user.
3. **Device test compartido**: un único `Device` por tenant con name
   canónico `mipiacetpv · modo prueba`. Se rota el token en cada
   `issueTestCashierSession` para evitar leak entre super-admins.
4. **Cashier técnico es MANAGER** (no CASHIER): MANAGER tiene los
   permisos de abrir/cerrar shift + autorizar descuentos, que el test
   necesita.
5. **JWT test-cashier vale también como X-Device-Token**: evita
   pre-emparejar un device físico. El middleware
   `requireDeviceToken` lo detecta por el formato JWT (tres segmentos)
   y purpose, sin caer al lookup por hash.
6. **OnboardingState DRAFT|ACTIVE** (sin READY persistido): READY se
   deriva de `onboardingHealth.ready`. La columna persiste sólo dos
   estados terminales — DRAFT (sin OWNER) y ACTIVE (con OWNER y datos
   purgados). Simplifica la state machine.
7. **Tests del flow legacy quedan `skip`**: el nuevo
   `onboarding-v2.test.ts` cubre el flow reemplazante. El test viejo
   se mantiene en el árbol como referencia.

## Cómo probarlo end-to-end

1. `pnpm install` y `pnpm db:migrate` (aplica `b10_onboarding_v2`).
2. `pnpm dev:api` + `pnpm dev:worker` (procesos separados) + `pnpm dev:admin` + `pnpm dev:tpv`.
3. Login super-admin → "Crear tenant" → pega una API key Holded de
   sandbox + taxId válido (e.g. `12345678Z`) → Crear conexión.
4. Esperar a que `initialSyncStatus=DONE` (polling cada 10s en el
   panel de health). El cashier técnico se auto-provision al cerrar
   el sync.
5. "Probar TPV" → abre pestaña con TPV en modo prueba (banner
   amarillo). Crear un ticket de prueba. Verificar que NO sube a
   Holded (`ticket.status=TEST`) y NO manda email (`status=SKIPPED_TEST`).
6. Volver al super-admin, refrescar el detalle → "Tickets prueba: 1".
   Cuando todos los checks estén verdes, "Activar tenant" con email
   del propietario real. Recibir banner verde con tempPassword.
7. Abrir el admin per-tenant con la tempPassword → forzado a cambiar
   password en primer login (B-SuperAdmin Frente 2).
8. Verificar que el OWNER NO ve "Holded", "Dispositivos", "Ajustes" en
   su sidebar.

## Lo que NO entra

- Self-service signup público.
- Billing / Stripe.
- DELETE tenant.
- OAuth con Holded.
- Webhooks Holded para sync continuo.
- Auto-detección de READY más sofisticada.

## Deuda futura

1. **Frente 7 backend**: migrar formalmente
   `/admin/tickets-errors/*`, `/admin/sku-review/*`,
   `/admin/tenant/settings`, `/admin/devices/*`,
   `/auth/me/rotate-holded-key`, `/auth/me/test-holded-connection`
   a `requireSuperAdmin` (con tenantId en path), refactorizando tests.
   Hoy la defensa es la sidebar oculta.
2. **"Mi cuenta" del OWNER read-only**: el fiscalProfile se sigue
   pudiendo editar vía PATCH /auth/me. Añadir caption +
   `disabled` cuando `tenant.holdedAuthMode==='API_KEY'`.
3. **Frontend super-admin para SKU review + sync errors**: actualmente
   sólo accesibles via impersonation (read-only). Cuando se complete
   el Frente 7 backend, exponerlos en `/superadmin/tenants/:id/...`.
4. **Spike §08 endpoint `/account/me`**: revisar si en una versión
   futura de Holded aparece — entonces volver a hidratar fiscalProfile
   en tiempo real.
