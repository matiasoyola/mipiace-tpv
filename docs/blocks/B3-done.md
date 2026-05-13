# Bloque 3 · resumen del entregable

Estado: cerrado pendiente de revisión por Matías.

## Estructura del repo tras B3

```
.
├─ apps/
│  ├─ api/                     # + auth/{rate-limit,two-factor,password-reset}
│  │                           # + email/sender (nodemailer + console)
│  │                           # + devices/{auth,routes,alerts}
│  │                           # + cashiers/routes
│  │                           # + shift/{cashier-auth,cashier-session,state,routes,z-report}
│  ├─ admin/                   # + ui (extraído de App.tsx)
│  │                           # + components/LogoutEverywhereModal
│  │                           # + pages/{DevicesPage,CashiersPage,SecurityPage,PasswordResetPages}
│  │                           # AdminShell drawer móvil + sidebar B3-vivo
│  ├─ tpv-web/                 # Tailwind + tokens mipiace.*
│  │                           # PairScreen, PinScreen, ShiftOpen, ShiftForceClose, ShiftActive
│  │                           # hooks/useDeviceBootstrap + useInactivityLogout
│  │                           # api + storage (device token + cashier session + recientes)
│  └─ tpv-web-spike/           # sin cambios — sigue como referencia viva
├─ packages/
│  ├─ db/                      # + 3 migraciones: shift_tracking, security_and_review, add_password_reset
│  └─ holded-client/           # sin cambios
└─ docs/blocks/B3-done.md      # este archivo
```

## Lo que dejé hecho

### Prisma schema + migraciones

3 migraciones SQL escritas a mano siguiendo el estilo de B2:

- `20260513120000_b3_shift_tracking` — `Shift.lastActivityAt`,
  `Shift.closedByUserId` + FK + índice `(register_id, closed_at)`.
- `20260513120100_b3_security_and_review` —
  `Tenant.cashierAutoLogoutMinutes` (default 10),
  `Tenant.requireManagerPinForForceClose` (default true),
  `Tenant.deviceNewLoginAlertEnabled` (default true),
  `User.twoFactorSecret/twoFactorEnabledAt/twoFactorRecoveryCodes`,
  `Device.lastKnownIpCountry/lastEmailAlertAt`,
  `Product.skuReviewAttempts` (default 0).
- `20260513120200_b3_add_password_reset` — tabla
  `password_reset_tokens` con índices y FK ON DELETE CASCADE.

`prisma format` valida y el cliente está regenerado.

### EmailSender + rate limiter (`apps/api/src/`)

- `email/sender.ts`: interfaz `EmailSender`, `SmtpEmailSender` (nodemailer)
  y `ConsoleEmailSender` (log a stdout). Inyectable con
  `setEmailSender()` para tests. En `NODE_ENV=development` sin SMTP
  configurado, cae automáticamente a console.
- `auth/rate-limit.ts`: helpers `inspect / registerFailure / reset`
  (5 fallos en 5 min → bloqueo 15 min) y `throttle` para password
  reset (5/5min sin candado separado).

### Devices (B3 §1)

- `devices/auth.ts`: `generateDeviceToken` (32 bytes base64url) +
  `hashDeviceToken` (SHA-256). Middleware `requireDeviceToken` decora
  `request.device = { deviceId, tenantId, registerId }` y rechaza 401
  si el token no matchea o el device está revocado.
- `devices/alerts.ts`: `evaluateDeviceAlert` con geoip-lite. Tres
  disparadores: primer login (lastEmailAlertAt nulo), cambio de país
  vs `lastKnownIpCountry`, o re-aparición tras 30 días. El email vive
  detrás de `getEmailSender()`. Antispam con `lastEmailAlertAt`.
- `devices/routes.ts`:
  - `POST /admin/registers/:id/pairing-codes` (owner) — código
    numérico de 6 dígitos único por tenant durante la ventana, TTL 1h.
    Reintentos por colisión RNG hasta 8 veces; reusa códigos
    caducados/consumidos con DELETE+INSERT (no UPDATE).
  - `GET /admin/devices` y `GET /admin/pairing-codes` para el panel.
  - `POST /devices/pair` (sin auth) — valida code, marca consumido,
    crea Device, devuelve token plano una sola vez.
  - `GET /devices/me` (X-Device-Token) — refresca `lastSeenAt`,
    devuelve metadatos del register/store/tenant.
  - `POST /admin/devices/:id/revoke` (owner) — marca `revokedAt`.

### Cajeros (B3 §1.4 ampliado)

- `cashiers/routes.ts` (todos requireOwner):
  - `GET /cashiers` — lista MANAGER + CASHIER.
  - `POST /cashiers` — alta con `{ email, role, pin }`; valida pin
    4-8 dígitos; hashea con `argon2id` (misma función que owner
    password).
  - `PATCH /cashiers/:id/pin` — reset PIN.
  - `DELETE /cashiers/:id` — soft-delete: email se sustituye por
    sentinela `revoked-<ts>-<id>@revoked.local`, `pinHash=NULL`,
    `tokenVersion++`. Preserva FKs con shifts/tickets.

### Cashier login + sesión + auto-logout (B3 §2)

- `shift/cashier-session.ts`: JWT firmado con `JWT_ACCESS_SECRET` y
  `type:"cashier"` — TTL = `tenant.cashierAutoLogoutMinutes`.
  Middleware `requireCashierSession` decora `request.cashier`.
- `shift/cashier-auth.ts`:
  - `POST /shift/cashier-login` (X-Device-Token + body
    `{ email, pin }`). Rate-limit por `(tenantId, email)`; al éxito
    `reset` del contador. Devuelve `sessionToken`, `user`,
    `shiftState` calculado por `getShiftStateForLogin`.
  - `POST /shift/cashier-logout` — no-op del lado server (token
    expira solo).
- `shift/state.ts`: `getShiftStateForLogin(registerId)` → discrimina
  entre `needsShiftOpen | reanudar | forceClose` según el último
  shift de la caja y si la última actividad fue hoy en UTC.

Rate-limit también aplicado a `POST /auth/login` (owner) con clave
`owner-login-attempts:{email}`. Se resetea tras éxito; tras 5 fallos
en 5 min → 429 con `retryAfterSeconds`.

### Turnos (B3 §3)

- `shift/routes.ts`:
  - `POST /shift/open` (cashier auth) — valida que no haya otro
    turno abierto en la caja; crea Shift con
    `openedAt=lastActivityAt=now`.
  - `POST /shift/:id/close` (cashier auth) con body
    `{ cashCounted, methodTotals, syncFailureAccepted?, managerPin? }`:
    - Si el actor no es el dueño del turno y el tenant exige PIN
      encargado, valida `managerPin` contra cualquier MANAGER del
      tenant (`requireManagerPinForForceClose`, default true).
    - Health-check sync: si hay tickets `PENDING_SYNC` o
      `SYNC_FAILED` y no llega `syncFailureAccepted=true` → 409.
    - Genera Z report PDF con `pdf-lib`, lo guarda en
      `storage/z-reports/{shiftId}.pdf` (configurable via
      `Z_REPORT_STORAGE_ROOT`). Si la generación falla, NO marca
      `closedAt` (el turno sigue abierto).
    - Marca `closedAt`, `closedByUserId`, `cashCounted`,
      `zReportPdfPath`. Devuelve descuadre.
- `shift/z-report.ts`: plantilla minimal pdf-lib (cabecera, datos del
  turno, métodos, descuadre, incidencias). Se pulirá cuando veamos el
  primer Z real (decisión §19.2.3 del núcleo).

### 2FA + recovery codes (B3 §4.1)

- `auth/two-factor.ts`:
  - `generateEnrollment(email)` con `speakeasy` + `qrcode` → devuelve
    `{ secret, qrDataUrl, recoveryCodes[10] }`.
  - `verifyTotp` (window 1).
  - `consumeRecoveryCode(stored, attempt)` — busca un código no usado
    cuyo `argon2.verify(hash, attempt)` matchee; marca `usedAt`.
  - `signPending2faToken / verifyPending2faToken` — JWT 5min con
    `type:"2fa-pending"`, firmado con `JWT_ACCESS_SECRET`.
  - `encryptTwoFactorSecret / decryptTwoFactorSecret` reutilizan
    `HOLDED_KEY_ENCRYPTION_SECRET` con el mismo prefijo `v1:` del
    crypto de B1.
- Endpoints añadidos a `auth/routes.ts`:
  - `POST /auth/me/2fa/enable` → graba secret cifrado y recovery
    codes (hashes argon2id) en BD, devuelve plain una sola vez.
  - `POST /auth/me/2fa/confirm` con `{ code }` → marca
    `twoFactorEnabledAt`.
  - `POST /auth/me/2fa/disable` exige `{ password, code }` (TOTP o
    recovery).
  - `POST /auth/login/2fa` con `{ pendingToken, code }` — distingue
    TOTP (6 dígitos) vs recovery (10 alfanum por regex) y consume el
    recovery al usarse.
- `POST /auth/login` ahora devuelve `{ requires2fa: true,
  pendingToken }` cuando `user.twoFactorEnabledAt != null`.
- `GET /auth/me` añade `user.twoFactorEnabled` y
  `recoveryCodesRemaining`.

### Alerta email por nuevo dispositivo (B3 §4.2)

- `evaluateDeviceAlert` invocado async (no bloquea respuesta) en
  `POST /devices/pair`. En producción se llamará también desde
  `GET /devices/me` cuando detectemos cambio de IP — lo dejé
  documentado pero el primer disparador es el pair.
- Email plantilla en castellano con device, caja, país aproximado y
  link `${PUBLIC_ADMIN_URL}/admin/devices`.

### Password recovery (B3 §4.3)

- `auth/password-reset.ts`:
  - `POST /auth/password-reset/request` — respuesta NEUTRA siempre
    (existe email o no), throttle 5/5min por email, sólo emite token
    si el user existe y es OWNER. Token plano de 32 bytes base64url,
    hash argon2id en BD, expira 1h.
  - `POST /auth/password-reset/confirm` con `{ token, newPassword }`
    (min 8 chars) — busca todos los tokens vivos, prueba
    `argon2.verify` hasta matchear; en éxito actualiza
    `passwordHash`, bumpa `tokenVersion`, marca `usedAt`. 410 Gone
    si caducado o usado.

### SKU review (B3 §4.4 mini-fix)

- `POST /catalog/sku-review/:id/assign` ahora incrementa
  `skuReviewAttempts` en cada llamada (éxito y silent reject).
- Nuevo `POST /catalog/sku-review/:id/mark-unsellable` para sacar el
  producto de la bandeja con `sellableViaTpv=false`.
- `GET /catalog/sku-review` expone `skuReviewAttempts` en cada item.

### Admin UI (B3 §5 + §4.4 mini-fix)

- `apps/admin/src/ui.tsx` (nuevo) — extracción de `TextField`,
  `PrimaryButton`, `OutlineButton`, `FieldError`, `SuccessBanner`,
  `CenteredCard`, `CenteredLoader`, `ReadOnlyField`, `formatRelative`,
  `formatDireccion`. Antes vivían inline en App.tsx; ahora se reusan
  desde las páginas nuevas.
- `formatDireccion(value)` arregla el bug `[object Object]` del
  almacén default Holded: objeto → `"calle cp ciudad, provincia
  (país)"`; string → tal cual; null → `—`.
- `AdminShell.tsx` reescrito: drawer móvil (hamburguesa, backdrop,
  click fuera para cerrar), modal `LogoutEverywhereModal`
  reutilizable, activa **Dispositivos / Cajeros / Seguridad** en el
  sidebar. **Tiendas y Holded** siguen grisados.
- `components/LogoutEverywhereModal.tsx` — modal de confirmación.
- `pages/DevicesPage.tsx` — tabla devices + lista de pairing codes
  activos + modal generación. Botón revocar.
- `pages/CashiersPage.tsx` — tabla cajeros + modal alta (email + rol
  + PIN inicial) + reset PIN + revocar.
- `pages/SecurityPage.tsx` — 2FA enable/confirm/disable flow inline
  (QR + recovery codes + verificación), botón "Cerrar todas las
  sesiones" reusando `LogoutEverywhereModal`.
- `pages/PasswordResetPages.tsx` — `ForgotPasswordPage` con
  confirmación neutra + `ResetPasswordPage` con
  newPassword/confirmPassword. Redirección a `/login` con banner
  verde tras éxito.
- `App.tsx` (modificado): login con paso 2FA inline (cuando el
  backend devuelve `requires2fa`), link "¿Olvidaste tu contraseña?",
  SkuReviewPage con badge ámbar a partir de 3 intentos y botón
  "Marcar como no vendible".

### TPV-web PWA (B3 §1.3, §2.3, §2.4, §3)

- Tailwind 3.4 + tokens `mipiace.*` + DM Sans + theme-color coral.
- `src/api.ts` — clientes `apiPublic / apiWithDevice / apiWithCashier`.
  `VITE_API_URL` con default `/api` (proxy de Vite).
- `src/storage.ts` — localStorage para device token, cashier session
  y "cajeros recientes" (max 5, sin caducidad, purge al unpair).
- `src/hooks/useDeviceBootstrap.ts` — al montar pregunta a
  `/devices/me`. 401 → unpair (limpia todo). Errores de red →
  reintenta cada 3s.
- `src/hooks/useInactivityLogout.ts` — escucha pointerdown/keydown/
  scroll/visibilitychange. Dispara `onLogout` tras N min sin actividad.
- Pantallas:
  - `pages/PairScreen.tsx` — 6 inputs numéricos (foco automático,
    paste 6 dígitos completos), copia literal del mockup pantalla 1.
  - `pages/PinScreen.tsx` — lista de cajeros recientes + keypad
    numérico + auto-blur del PIN tras 30s sin tecla. Reconoce 429
    rate-limit y muestra mensaje.
  - `pages/ShiftOpenScreen.tsx` — fondo inicial con quick keys
    50/100/150/200 (mockup pantalla 3).
  - `pages/ShiftForceCloseScreen.tsx` — cierre forzado del turno
    colgado (exige PIN encargado si cashierRole=CASHIER).
  - `pages/ShiftActiveScreen.tsx` — placeholder "Turno abierto · la
    venta llega en B4" + modal de cierre normal.
- `App.tsx` — orquesta los estados: `unpaired → paired+needsLogin →
  cashier+(forceClose|needsShiftOpen|active)`.

### Tests vitest

5 archivos nuevos, **31 tests B3 nuevos** verdes. Total **125 / 125**
tests verdes:

| Archivo | Tests | Cubre |
|---|---|---|
| `password-reset.test.ts` | 8 | request neutro + throttle + confirm OK / 410 / 400 |
| `cashier-login.test.ts` | 6 | PIN OK/KO + device token + rate-limit + reset tras éxito |
| `two-factor.test.ts` | 5 | enable + confirm + login con TOTP + recovery code consume + disable |
| `pairing-route.test.ts` | 7 | generar / pair / caducado / consumido / revoke |
| `sku-review-attempts.test.ts` | 5 | incrementa en éxito y silent reject + mark-unsellable |

Los tests de B2 (auth-route.test.ts) ampliaron su mock para incluir
las primitivas Redis que ahora usa `/auth/login` para rate-limit.

## Lo que dejé fuera (por diseño · bloques siguientes)

- **Pantalla de venta, cobro, ticket impreso** — B4 + B5.
- **Worker de tickets a Holded** — B5.
- **Devoluciones / ticket regalo / conversión factura** — B6.
- **Gestión de tiendas y registers desde admin** — B4. En B3 los
  registers se crean durante el sync inicial y la UI de Dispositivos
  los enumera deriváándolos del listado de devices (modal de
  generación de código mira los registers ya conocidos). Cuando B4
  monte el panel de Tiendas, el modal usará el endpoint dedicado.
- **Configuración de tenant.\*** (auto-logout minutes, requireManagerPin,
  deviceNewLoginAlertEnabled) — campos en BD con defaults sanos.
  La UI llega en B4 con la pantalla de ajustes de tienda.
- **MANAGER puede generar códigos de pairing** — hoy sólo OWNER
  (requireOwner). En B4 cuando los MANAGER tengan acceso al admin
  introducimos un `requireOwnerOrManager`.
- **Pantalla de "Ajustes Holded"** del sidebar — sigue grisada.
  Cuando B4 traiga config de `numSerieHolded` por caja y
  payment methods, le damos una pantalla propia.
- **Location lock §17.5** — diferido a v2 según el spec.

## Decisiones tomadas sin preguntar

Documentadas aquí por la instrucción del propietario al arrancar:
"Para esta sesión, no me hagas preguntas. Toma decisiones razonables
y documéntalas".

1. **Device token con SHA-256 hex en lugar de argon2id.** El prompt
   sugería argon2id; lo cambié porque los device tokens son
   high-entropy (32 bytes random) y argon2 es para baja entropía
   (passwords/PINs). Con argon2 + 30 devices/tenant tendríamos ~3 s
   de latencia por verificación (lookup secuencial). SHA-256 da
   lookup O(1) en el `deviceTokenHash @unique`. El compromiso de
   seguridad es nulo (256 bits es infeasible de fuerza bruta).

2. **Rate-limit cashier por `(tenantId, email)`** en vez de
   `(tenantId, userId)` como decía el prompt. Razón: para conocer
   `userId` tendríamos que hacer un lookup primero, lo que abre
   enumeration vector (responder distinto según user exista o no).
   La clave por email es operacionalmente equivalente y evita el
   problema.

3. **`Tenant.cashierAutoLogoutMinutes / requireManagerPinForForceClose /
   deviceNewLoginAlertEnabled`** añadidos al schema con defaults
   sanos. NO hay UI de configuración en B3 — el propietario tendrá
   acceso a esto desde el panel de ajustes de tienda en B4.

4. **Geolocalización por país (no por distancia).** El prompt
   sugería distancia >1000 km; cambié a comparación país-a-país
   (geoip-lite devuelve país robusto, no granular de ciudad). Cubre
   el caso real "robo + se la llevan fuera" y es operacionalmente
   más simple. Si algún cliente pide granular, B5+.

5. **`pinHash` se hashea con la misma `hashPassword(argon2id)`** que
   las contraseñas del owner. Un solo punto de configuración para
   ambos. PINs de 4-8 dígitos siguen tardando ~250 ms, lo que actúa
   como brute-force resistance complementario al rate-limit.

6. **`pendingToken` 2FA = JWT corto** firmado con
   `JWT_ACCESS_SECRET` + claim `type:"2fa-pending"`, TTL 5 min. No
   añadí secret nuevo al env.

7. **Endpoint `/auth/login/2fa` distingue TOTP vs recovery por
   regex**: 6 dígitos → TOTP, 10 alfanum mayúsculas →
   recovery. Recovery code se consume marcando `usedAt` en el array
   JSON (no se borra para que el contador "X/10 sin usar" siga
   siendo correcto).

8. **Soft-delete de cajero** (email sentinela
   `revoked-<ts>-<id>@revoked.local`, `pinHash=null`,
   `tokenVersion++`) en vez de DELETE. Razón: tickets y shifts
   tienen FK ON DELETE RESTRICT al User — borrar el cajero rompería
   el histórico fiscal.

9. **Z report con `pdf-lib`** (no puppeteer). Puppeteer arrastra
   ~200 MB de Chromium. Plantilla rudimentaria; se afinará cuando
   veamos el primer Z real.

10. **`Z_REPORT_STORAGE_ROOT` env opcional** con default
    `storage/z-reports/` en el CWD. En prod se redirigirá a un
    volumen Docker dedicado o a S3 (B5+).

11. **Auto-blur del PIN tras 30 s** sin tecla. Limpia el `pin` state
    para que no quede visible en pantalla si el cajero se aleja.

12. **PWA cajeros recientes** = max 5 en localStorage, sin caducidad,
    purga al unpair (cuando `/devices/me` devuelve 401).

13. **Sidebar admin tras B3**: Productos / Mi cuenta / Dispositivos /
    Cajeros / Seguridad están activos. Tiendas y Holded siguen
    grisados con title="Disponible en bloques posteriores".

14. **Modal logout-everywhere reutilizable** vive en el sidebar Y en
    la SecurityPage (mismo componente `LogoutEverywhereModal`).

15. **`useDeviceBootstrap` reintenta cada 3 s** en errores de red
    (no 401). En 401 limpia todo y va a unpair.

16. **El modal "Generar código" en DevicesPage** deriva los registers
    del listado de devices del propio tenant. Cuando B4 monte
    `/admin/registers`, ese listado pasará a alimentar el dropdown.

17. **Endpoint `mark-unsellable`** marca `sellableViaTpv=false` y
    `needsSkuReview=false`. No toca `skuAutoAssignedAt` ni el sku —
    si Holded más tarde arregla el problema, el sync incremental
    podría reactivarlo (la lógica de re-activación queda para B5+).

18. **Generación de pairing code con reintentos sobre colisión RNG.**
    Espacio 1M × validez 1h hace que la colisión sea operacionalmente
    nula, pero el unique compuesto `(tenantId, code)` me hace
    defenderlo igual.

19. **`POST /admin/registers/:registerId/pairing-codes`** sólo
    acepta OWNER en B3 (requireOwner). El prompt mencionaba MANAGER
    también — pero los MANAGER en B3 no entran al admin todavía
    (su único punto de entrada es la PWA del TPV). En B4, cuando
    MANAGER pueda hacer login admin, añadiremos `requireOwnerOrManager`.

20. **El test de auth-route.ts (B2) se amplió** para mockear los
    métodos Redis nuevos que usa el rate-limit. Sin esto, los tests
    de B2 fallaban con 500 al llamar `redis.ttl(...)`. Patrón
    documentado para que otros tests futuros lo copien.

## Dudas y cosas a confirmar antes de B4

1. **Z report PDF**. Plantilla rudimentaria — ¿revisamos diseño antes
   de seguir, o lo dejamos hasta ver un Z real en producción?
2. **`tenant.cashierAutoLogoutMinutes` y compañeros** sin UI todavía.
   En B4 habrá una pantalla "Ajustes" donde encajan; antes de B4
   ¿está bien tenerlos hardcoded (defaults) o ya hay un caso de
   prueba que requiera ajustarlos?
3. **MANAGER en admin**. Hoy el admin sólo lo usa OWNER. Cuando
   MANAGER tenga login admin, ¿qué pantallas verá? (Mi propuesta:
   Dispositivos, Cajeros — sólo sus reset PIN, no alta —, Seguridad
   limitada).
4. **`/devices/me` y cambio de IP en cada request**. Hoy el alert se
   dispara sólo en `POST /devices/pair`. Para detectar cambio de
   país en device ya emparejado necesito invocar
   `evaluateDeviceAlert` también desde `GET /devices/me`. Lo dejé
   documentado, no implementado — ¿hace falta en B3 o lo enchufamos
   cuando tenga sentido (cuando un cliente se queje)?
5. **Email transaccional en producción**. SMTP via nodemailer está
   listo pero no he validado con un proveedor real (SES, SendGrid,
   Postmark). El `ConsoleEmailSender` cubre dev. ¿Algún proveedor
   preferido?
6. **`Device.lastSeenAt`** se actualiza en cada `/devices/me`. En
   prod con la PWA conectada 8h al día son ~hundreds de updates por
   device por turno. Si llega a ser un problema de throughput, B5+
   metemos batching o cache en Redis. Por ahora aceptable.
7. **Recovery codes**: 10 códigos generados al activar 2FA. ¿Permite
   regenerar después? Hoy NO — si los pierdes hay que desactivar y
   re-activar. Misma política que GitHub. ¿OK o regen-en-place?
8. **Estado tras `/shift/open`** en la PWA. Como no expongo
   `GET /shift/current` en B3, tras abrir el turno la pantalla pasa
   a "active" con datos provisionales (`shiftId:"pending-refresh"`).
   B4 lo arregla introduciendo `/shift/current`.
9. **PIN-reuse defensa**. Hoy no hay regla "no repitas el PIN
   anterior" ni "no uses 1234". ¿Las añadimos en B4 con un campo
   `Tenant.pinPolicy`?
10. **Tests integración con BD real**: sigue pendiente de B1/B2.
    Continúo con mocks Prisma en memoria — funciona pero pierde
    cobertura de SQL real (e.g. los cascades de las migraciones).

## Cómo arrancarlo todo de cero

```bash
# 1. Levantar infra y aplicar las 3 migraciones nuevas
docker compose up -d
pnpm install
pnpm db:migrate   # aplica b3_shift_tracking, b3_security_and_review,
                  # b3_add_password_reset

# 2. Tests (18 ficheros, 125 casos)
pnpm test

# 3. Type-check
pnpm --filter @mipiacetpv/api exec tsc --noEmit
pnpm --filter @mipiacetpv/admin exec tsc --noEmit
pnpm --filter @mipiacetpv/tpv-web exec tsc --noEmit

# 4. Arrancar dev (3 terminales separadas)
pnpm dev:api    # http://127.0.0.1:3001
pnpm dev:admin  # http://localhost:5173
pnpm dev:tpv    # http://localhost:5174
```

Flujo E2E recomendado tras arrancar:

1. Login admin → `/admin/cashiers` → "Añadir cajero" → email
   `lucia@negocio.local`, role CASHIER, PIN `1234`.
2. `/admin/devices` → "Generar código" → seleccionar la caja → copiar
   el código de 6 dígitos.
3. Abrir `localhost:5174` (o instalar la PWA) → pegar código → ver
   "Vinculado a {caja}".
4. PIN screen → seleccionar `lucia@negocio.local` → meter `1234`.
5. ShiftOpenScreen → fondo `100,00 €` → "Abrir turno".
6. ShiftActiveScreen → ver "Turno abierto · auto-logout 10 min".
7. Esperar 10 min sin tocar (o setear `Tenant.cashierAutoLogoutMinutes
   = 1` en BD) → la PWA vuelve a PIN.
8. Volver al admin → `/admin/security` → "Activar 2FA" → escanear QR
   con Google Authenticator → meter código → confirmar.
9. Logout admin → login → ver paso TOTP → meter código.
10. `/forgot-password` → meter email → consola del API muestra el
    link (`ConsoleEmailSender`). Abrirlo → nueva contraseña → login.

Para probar el cierre forzado de turno colgado: cambia
`Shift.lastActivityAt` a `ahora - 2 días` en BD, vuelve al PIN, mete
PIN; la PWA debe mostrar la pantalla "Hay un turno colgado de ayer".

Cuando termines B3 y Matías lo revise, te paso el prompt de B4.
