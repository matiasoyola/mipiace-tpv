# Prompt para Claude Code — Bloque 3

Pega esto en una nueva sesión de Claude Code una vez B2 esté validado y
mergeado.

---

Hola Code. Arrancamos B3.

## Contexto

B1 (multi-tenant + onboarding + sync inicial) y B2 (sync incremental +
contactos + Mi cuenta + bandeja SKU) están commiteados y pusheados
(commits `5a43aad` y `535b3e1`). Lee primero `docs/blocks/B1-done.md`
y `docs/blocks/B2-done.md` para entender qué tienes ya construido.

**Decisiones extras tomadas en la revisión de B2 (incorporadas a este
bloque):**

- Modal de confirmación al "Cerrar sesión en todos los dispositivos".
- Sidebar admin con drawer en móvil (< md).
- Bug fix: `AccountPage` muestra `[object Object]` cuando
  `fiscalProfile.direccion` viene como objeto del almacén default
  Holded. Hay que serializarlo a string en el render (objeto →
  `"calle, cp, ciudad, provincia, país"`; string → tal cual).
- Migración para añadir `Product.skuReviewAttempts` (Int default 0).
  Bandeja SKU muestra el contador junto a cada producto con silent
  reject ("ha fallado 3 veces, contacta soporte").
- **Password recovery del propietario** — sección nueva al núcleo
  §17.6, incluida en este bloque.

Vuelve a leer cuando sea necesario:

- `docs/07-nucleo-comun.md` §3 (emparejamiento de dispositivo), §4
  (apertura de turno con cierre forzado), §15 (roles y permisos), §17
  (seguridad — implementas las 4 medidas).
- `docs/ux-principles.md` §2.1, §2.2 (touch targets, foco automático).
- `docs/04-stack-y-decisiones.md` ADR-002 (websockets opcionales —
  aquí siguen siendo opcionales, B4 los hace obligatorios para bar).
- **`docs/design/tokens.md` — contrato visual con paleta, tipografía,
  componentes base. Lectura obligatoria antes de implementar UI.**
- **`docs/design/reference-app.tsx` — los mockups v1 de las pantallas
  que vas a implementar en este bloque ya están diseñados: emparejamiento
  (pantalla 1), login cajero PIN (2), apertura de turno (3). Copia los
  patrones literales — clases Tailwind, estructura JSX, micro-copy.**
- `docs/design/tailwind.config.reference.js` — copia la configuración
  a `apps/tpv-web/tailwind.config.js` para tener los tokens `mipiace.*`.
- `docs/design/index.reference.css` — copia a `apps/tpv-web/src/index.css`
  para cargar DM Sans y CSS variables.

Antes de tocar código, **resume lo que entiendes** y pide luz verde
con tus discrepancias / dudas.

## Bloque 3 · Identidad de dispositivo + cajero + turno + seguridad

### Resumen del alcance

Seis frentes, en este orden (hay dependencias):

1. **Emparejamiento de dispositivo** — admin genera código, PWA del
   TPV lo consume, queda device token en localStorage.
2. **Login del cajero por PIN** + auto-logout por inactividad + rate
   limiting (§17.1, §17.2).
3. **Gestión de turno** con apertura (fondo inicial), reanudación
   misma sesión, cierre forzado de turnos colgados de días previos.
4. **Capas extra de seguridad** del propietario — 2FA opcional
   (§17.3), alerta email por nuevo dispositivo (§17.4),
   **password recovery (§17.6)**.
5. **Mini-fixes y mejoras menores del review de B2** — modal logout
   everywhere, sidebar drawer en móvil, fix `[object Object]`,
   `Product.skuReviewAttempts` con UI.

Fuera de B3: venta, cobro, impresión (todo B4-B5). Location lock
(diferido a v2).

### 1. Emparejamiento de dispositivo

#### 1.1 Modelos (ya existen en schema, refrescar lo necesario)

- `Device`: `id`, `tenantId`, `registerId`, `name`, `pairedAt`,
  `lastSeenAt`, `userAgent`, `deviceTokenHash`, `revokedAt` (nullable).
- `PairingCode`: `id`, `tenantId`, `registerId`, `code` (6 dígitos),
  `createdByUserId`, `expiresAt`, `consumedAt`, `consumedByDeviceId`.

#### 1.2 Backend endpoints

- **`POST /admin/registers/:registerId/pairing-codes`** (auth propietario
  o encargado). Genera código numérico de 6 dígitos único dentro del
  tenant durante su ventana de validez (1h por defecto, configurable).
  Persiste en `PairingCode`. Devuelve `{ code, expiresAt }`.
- **`POST /devices/pair`** (sin auth). Body: `{ code, deviceName?,
  userAgent }`. Valida que `code` exista, no esté caducado ni consumido.
  Marca el `PairingCode` como consumido, crea `Device` con
  `deviceTokenHash` (token largo aleatorio, 32 bytes base64; el TPV
  recibe el token plano una sola vez, en BD se guarda sólo el hash
  argon2id). Devuelve `{ deviceToken, deviceId, tenantId, registerId,
  registerName, storeName }`.
- **`GET /devices/me`** (auth: header `X-Device-Token`). Devuelve los
  metadatos del dispositivo. Usado por la PWA al arrancar para validar
  que sigue emparejado. Si el token es inválido o el device está
  `revoked`, responde 401 → la PWA se desempareja y vuelve a la pantalla
  de emparejamiento.
- **`POST /admin/devices/:deviceId/revoke`** (auth propietario o
  encargado). Marca `revokedAt`. Útil para tablets robadas/perdidas.

#### 1.3 PWA — pantalla "Empareja este dispositivo"

En `apps/tpv-web` (que está en esqueleto desde B1):

- Al cargar, la PWA mira `localStorage["mipiacetpv-device-token"]`.
  Si existe, llama `GET /devices/me` con ese token. Si OK → entra a la
  pantalla de PIN del cajero (§2). Si 401 → muestra emparejamiento.
- Pantalla emparejamiento: input grande (6 dígitos numéricos, teclado
  numérico abierto en móvil con `inputMode="numeric"`), botón
  "Vincular". Al pulsar, hace `POST /devices/pair` con el código.
- En éxito: guarda `deviceToken` en `localStorage`, muestra "Vinculado
  a la caja {registerName} de {storeName}" y avanza a PIN.
- En error (código inválido / caducado): mensaje claro, input se borra.

#### 1.4 Admin — gestión de dispositivos

Nueva sección "Dispositivos" en el admin (sidebar):

- Tabla con todos los `Device` del tenant: nombre, caja asignada,
  última actividad, estado (activo/revocado), botón "Revocar".
- Botón "Generar código de emparejamiento" → modal con dropdown de
  cajas del tenant. Al seleccionar caja, muestra el código generado y
  cuenta atrás hasta `expiresAt` con copy-to-clipboard.

### 2. Login del cajero por PIN

#### 2.1 Backend

- **`POST /shift/cashier-login`** (auth: header `X-Device-Token`).
  Body: `{ userId, pin }` o `{ email, pin }`. El device ya conoce su
  `registerId` y `tenantId` — el cajero sólo aporta credencial.
  Devuelve `{ sessionToken, userId, role, lastShiftSummary }` (el
  resumen del último turno permite a la PWA decidir si el cajero
  reanuda turno abierto vs abre nuevo, ver §3).
- **`POST /shift/cashier-logout`** invalida el sessionToken.

#### 2.2 Rate limiting (§17.1 del núcleo)

Antes de validar el PIN, comprobar contador en Redis:

- Clave: `cashier-login-attempts:{tenantId}:{userId}` con TTL 5 min.
- Si el contador llega a 5 → bloquear 15 min (clave separada con TTL
  15 min: `cashier-login-locked:{tenantId}:{userId}`).
- Mismo patrón para `POST /auth/login` del propietario, clave
  `owner-login-attempts:{email}`.
- Mensaje claro al cajero: "Demasiados intentos. Vuelve a probar en X
  minutos."

#### 2.3 PWA — pantalla de PIN

- Mostrar lista con los **últimos N cajeros** que usaron este device
  (cacheado en `localStorage`, no expone otros cajeros). Tap en uno →
  teclado numérico para PIN.
- Si es la primera vez en el device, autocomplete del email + PIN
  numérico (o lector de QR/NFC en v2).
- Auto-blur del input tras N segundos de inactividad para evitar PIN
  visible.

#### 2.4 Auto-logout por inactividad (§17.2)

En el cliente PWA:

- Hook que escucha `pointerdown`, `keydown`, `scroll` en `document`.
  Cada evento resetea un timer de **10 min** (configurable por tienda
  vía `tenant.cashierAutoLogoutMinutes`, default 10, rango 5-60).
- Al disparar el timer → invalidar `sessionToken` local + redirigir a
  pantalla de PIN. **El turno sigue abierto** (sólo cierra sesión del
  cajero, no el turno).
- Llamar también a `POST /shift/cashier-logout` en background.

### 3. Gestión de turno

#### 3.1 Modelo (ya existe `Shift`, refrescar)

- `Shift`: `id`, `registerId`, `userId`, `openedAt`, `closedAt`,
  `cashOpening` (fondo inicial), `cashCounted` (recuento real al
  cierre), `zReportPdfPath`. Hay que añadir `lastActivityAt` y
  `closedByUserId` (puede cerrar otro cajero por el colgado).

Migración: `pnpm db:migrate`, nómbrala `b3-shift-tracking`.

#### 3.2 Lógica al hacer login cajero

Tras validar PIN, el backend evalúa el estado del último turno de
esa caja (`register`):

| Estado del último turno | Acción del backend | UI de la PWA |
|---|---|---|
| No hay turno o el último cerrado | Devuelve `{ needsShiftOpen: true }` | Pantalla "Fondo de caja inicial" |
| Último abierto y `lastActivityAt` es hoy | Devuelve `{ shift: { id, openedAt, cashOpening }, reanudar: true }` | Entra directo a "Mapa de sala" o "Venta rápida" (B4) |
| Último abierto y `lastActivityAt` anterior a hoy | Devuelve `{ shift: { id, openedAt, totals: {...} }, forceClose: true }` | Pantalla "Hay un turno colgado de ayer — debes cerrarlo" |

#### 3.3 Apertura de turno

- **`POST /shift/open`** body `{ cashOpening }`. Crea `Shift` con
  `openedAt = now`, `lastActivityAt = now`. Devuelve `shift`.

#### 3.4 Cierre de turno (normal)

- **`POST /shift/:id/close`** body `{ cashCounted, methodTotals,
  syncFailureAccepted? }`.
  - Calcula `arqueoTeorico` desde los tickets del turno por método.
  - Calcula descuadre = `cashCounted - cashCounted_teorico`.
  - Health-check de sync: si hay tickets `PENDING_SYNC` o
    `SYNC_FAILED`, requiere `syncFailureAccepted: true` con PIN de
    encargado (otro endpoint o segundo factor inline).
  - Genera Z report en PDF con plantilla mínima (puppeteer o
    `pdf-lib`). Guarda en `zReportPdfPath` (filesystem o S3 — en MVP
    filesystem en `/app/storage/z-reports/`).
  - Marca `closedAt`.

#### 3.5 Cierre forzado de turno colgado

- Cuando el backend detecta `forceClose: true`, la PWA enseña al
  cajero la pantalla de cierre del turno **del cajero anterior**.
- Mismo flujo del cierre normal, pero `closedByUserId` se rellena con
  el cajero actual (no el original).
- Requiere PIN del actual + opcionalmente PIN del encargado si el
  cajero actual no es encargado (configurable por tenant).
- Tras cerrar el colgado, automáticamente sigue al flujo de apertura
  de turno nuevo.

### 4. Seguridad del propietario (§17.3 y §17.4)

#### 4.1 2FA opcional (TOTP, RFC 6238)

- Librería: `speakeasy` o `otpauth` (npm).
- **`POST /auth/me/2fa/enable`** → genera secret + QR data URL para
  app authenticator. Devuelve `{ secret, qrDataUrl, recoveryCodes[10] }`.
  El propietario escanea, introduce código actual → confirma con
  **`POST /auth/me/2fa/confirm`**. Recovery codes se descargan como
  txt o se muestran para copiar.
- Si está activado: login del propietario tras password pide código
  TOTP (`POST /auth/login` devuelve `{ requires2fa: true,
  pendingToken }`, luego `POST /auth/login/2fa` con el código).
- **`POST /auth/me/2fa/disable`** con password + código TOTP actual
  como prerequisito.

Schema:

```prisma
model User {
  // ...
  twoFactorSecret      String?   @map("two_factor_secret")            // cifrado AES-GCM
  twoFactorEnabledAt   DateTime? @map("two_factor_enabled_at") @db.Timestamptz()
  twoFactorRecoveryCodes Json?   @map("two_factor_recovery_codes")   // array de hashes argon2id
}
```

#### 4.2 Alerta email por nuevo dispositivo (§17.4)

- Cuando un device hace `GET /devices/me` por primera vez (o tras N
  días sin actividad — defínelo: 30d), o cuando un device conocido
  cambia de geolocalización IP (heurística: distancia >1000 km vs
  `device.lastKnownIpCountry`), enviar email al propietario.
- Servicio de email: dejar interfaz `EmailSender` con
  implementación SMTP via `nodemailer`. Variables de entorno:
  `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.
  En `NODE_ENV=development` log a consola en vez de SMTP real (no
  bloquees el dev por no tener SMTP).
- IP → país: librería `geoip-lite` (offline, base de datos
  embebida). No es preciso a nivel ciudad pero país es robusto.
- Schema: `Device.lastKnownIpCountry`, `Device.lastEmailAlertAt`
  (para no spamear si la IP fluctúa de provincia).

### 5. UI admin de seguridad

Nueva sección "Seguridad" en el menú del admin:

- **2FA**: estado actual, botón activar/desactivar con el flujo
  descrito.
- **Sesiones**: lista de devices admin del propietario (no TPV) con
  IP, ubicación aproximada, última actividad. Botón "Cerrar todas las
  sesiones" → `POST /auth/logout-everywhere` (ya existe desde B2).
- **Notificaciones**: checkbox "Enviar email cuando un dispositivo
  nuevo se vincule" (default on).

### 4.3 Password recovery del propietario (§17.6 del núcleo)

Implementación completa del flujo de recuperación de contraseña.

**Schema (migración nueva `add-password-reset`):**

```prisma
model PasswordResetToken {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  tokenHash String   @map("token_hash")
  expiresAt DateTime @map("expires_at") @db.Timestamptz()
  usedAt    DateTime? @map("used_at") @db.Timestamptz()
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz()
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@index([expiresAt])
  @@map("password_reset_tokens")
}
```

Y añadir a `User`: `passwordResetTokens PasswordResetToken[]`.

**Backend endpoints:**

- **`POST /auth/password-reset/request`** — body `{ email }`. Rate
  limit 5 intentos / 5 min por email (clave Redis
  `pwd-reset-req:{email}`).
  - Si el email existe: genera token plano de 32 bytes base64, hash
    argon2id en BD, expira en 1 hora, envía email con
    `https://<PUBLIC_URL>/admin/reset?token=<plain>`.
  - **Respuesta SIEMPRE neutra** (200 OK con mensaje genérico):
    `{ message: "Si el email existe, te hemos enviado un enlace." }`.
    Nunca revelar si el email existe.
  - Si el email NO existe: misma respuesta neutra, no envía nada.

- **`POST /auth/password-reset/confirm`** — body `{ token, newPassword }`.
  - Busca todos los `PasswordResetToken` no caducados, no usados.
    Compara `argon2.verify(tokenHash, token)` con cada uno hasta
    matchear. Si ninguno → 410 Gone.
  - Si match: valida `newPassword.length >= 8`. Actualiza
    `user.passwordHash` (argon2id), bumpa `user.tokenVersion`
    (invalida todas las sesiones), marca el token como
    `usedAt = now()`.
  - Devuelve `{ ok: true }` para que el front redirija a `/login`.

**Email sender** — reutiliza el `EmailSender` interface de §17.4:
- Plantilla mínima en HTML + texto plano.
- Castellano. Logo de mipiacetpv como inline SVG o data-uri.
- Link directo al reset con disclaimer "Si no has solicitado este
  cambio, ignora este email."

**Frontend admin (3 pantallas nuevas):**

- **`/forgot-password`** — accesible desde el link "¿Olvidaste tu
  contraseña?" del login actual (que hoy es placeholder sin
  funcionalidad). Form con un único input email + botón "Enviar
  enlace". Tras submit, redirige a pantalla de confirmación.
- **Pantalla de confirmación** — "Revisa tu email" con instrucciones.
  Mensaje genérico independientemente de si el email existía.
- **`/admin/reset?token=...`** — form con `newPassword` y
  `confirmPassword`. Valida coincidencia + longitud ≥ 8 chars en
  cliente. Botón "Actualizar contraseña". Manejo de errores:
  - Token inválido / caducado → mensaje "Enlace caducado o ya usado.
    Solicita un nuevo enlace." + link a `/forgot-password`.
  - Éxito → redirige a `/login` con banner verde "Contraseña
    actualizada · inicia sesión de nuevo".

### 4.4 Mini-fixes del review de B2

**Bug `[object Object]` en `AccountPage`:** cuando
`fiscalProfile.direccion` viene como objeto del almacén default
(estructura `{ calle, cp, ciudad, provincia, país }`), el render lo
pinta como `[object Object]`. Fix: helper `formatDireccion(value)`
que si es objeto lo concatena como `"calle, cp ciudad, provincia
(país)"`; si es string lo devuelve tal cual; si es null muestra "—".

**Modal de confirmación logout-everywhere:** hoy el botón "Cerrar
sesión en todos los dispositivos" del sidebar dispara la acción
directamente. Cambiar a modal con:
- Título: "¿Cerrar sesión en todos los dispositivos?"
- Cuerpo: "Esto cerrará tu sesión en este dispositivo y en cualquier
  otro donde hayas iniciado sesión. Tendrás que volver a entrar."
- Botones: "Cancelar" (outline) + "Sí, cerrar todas" (coral primary).

**Sidebar móvil drawer:** hoy en `< md` el sidebar está
`hidden md:flex`. Añadir botón hamburguesa en la cabecera del admin
que abre un drawer slide-in desde la izquierda con la misma
navegación. Backdrop semi-transparente, swipe-to-close o click fuera
para cerrar. Mantener desktop `md+` con sidebar persistente.

**`Product.skuReviewAttempts`:** migración mini con `Int @default(0)`.
El endpoint `POST /catalog/sku-review/:productId/assign` incrementa
en cada intento, ya sea éxito o silent reject. La bandeja
`/admin/products` muestra el contador junto a cada producto. Si
`skuReviewAttempts >= 3`, badge ámbar "Necesita atención de soporte"
y se muestra un botón secundario "Marcar como no vendible" que pone
`sellableViaTpv = false` permanentemente (para sacarlo de la
bandeja sin asignar SKU manual).

### 6. Tests

- **Emparejamiento**: código válido, código caducado, código consumido,
  código de otro tenant rechazado, revocación de device.
- **Login cajero**: PIN correcto, PIN incorrecto, rate limit dispara
  tras 5 intentos.
- **Turno**: apertura, reanudación mismo día, cierre forzado de
  turno colgado, descuadre calculado, health-check de sync.
- **2FA**: enable + confirm flow, login con TOTP correcto/incorrecto,
  recovery code valida y se consume, disable requiere TOTP actual.
- **Alerta email**: mock del `EmailSender`, primer login dispara email,
  cambio de país dispara email, IP en mismo país no dispara.
- **Password recovery**:
  - request con email existente envía email (verificado vía mock
    EmailSender).
  - request con email inexistente NO envía pero devuelve misma
    respuesta neutra.
  - rate limit dispara tras 5 intentos en 5 min.
  - confirm con token válido actualiza password + bumpa
    tokenVersion + marca usedAt.
  - confirm con token caducado → 410.
  - confirm con token ya usado → 410.
  - confirm con newPassword < 8 chars → 400.
- **Mini-fixes**:
  - `formatDireccion` con objeto / string / null.
  - skuReviewAttempts incrementa en cada intento (éxito o fallo).

### 7. Restricciones

- **No regresiones en B1+B2.** Todos los tests previos siguen verdes.
- **No tocar B4-B7.** Venta, cobro y print agent siguen fuera.
- **TypeScript estricto, JSON Schema en body, NUNCA loguear PINs,
  device tokens, secrets 2FA ni códigos recovery.**
- **Migraciones Prisma versionadas.**

### 8. Entregables

1. PR único con todo B3.
2. Commit messages descriptivos.
3. `.env.example` actualizado con SMTP_* y nuevas variables.
4. `docs/blocks/B3-done.md` con mismo formato que B1/B2-done: lo
   hecho, lo fuera, decisiones tomadas, dudas para revisar antes de
   B4.

### 9. Lo que NO entra en B3

- Pantalla de venta y cobro → **B4**.
- Print agent local ESC/POS y motor de impresión → **B5**.
- Devoluciones, ticket regalo, conversión factura → **B6**.
- Worker de upload de tickets a Holded → **B7** (junto con el ciclo
  completo TPV → Holded en producción).
- Location lock (§17.5) → v2.

Cuando termines B3 y Matías lo revise, te paso el prompt de B4.
