# Prompt para Claude Code — Bloque 2

Pega esto en Claude Code dentro de la carpeta del proyecto, después de
que B1 esté validado en local (onboarding completo, sync inicial OK).

---

Hola Code. Arrancamos B2.

## Contexto

B1 quedó cerrado (commit pendiente de hacer por Matías; revisa `git log`).
38/38 tests verdes, schema validado, onboarding probado E2E con una cuenta
Holded sandbox. Lee primero `docs/blocks/B1-done.md` entero — incluye las
**8 decisiones que tomaste sin preguntar** (todas confirmadas por Matías) y
las **8 dudas** que dejaste abiertas. Mis respuestas a esas dudas viven
incrustadas en el alcance de abajo.

Vuelve a leer cuando sea necesario:

- `docs/07-nucleo-comun.md` §2 (onboarding y sync), §3 (emparejamiento —
  contexto, no se toca aquí), §17 (seguridad — sólo rate limit aquí).
- `docs/04-stack-y-decisiones.md` ADR-010 (GET-back) y ADR-005 (BullMQ).
- `docs/spike-holded.md` — añadirás una sección §08 con findings del
  mini-spike de account info.

Antes de tocar código, **resume lo que entiendes** y pide luz verde,
señalando cualquier discrepancia entre este prompt y el estado real del
repo (B1 quizás haya quedado distinto a lo que asume este doc).

## Bloque 2 · Sync catálogo completo + cuenta del propietario

### Resumen del alcance

Cuatro frentes:

1. **Mini-spike** de endpoints de account info en Holded.
2. **Sync incremental** del catálogo (cron + manual + huérfanos +
   webhooks-investigación).
3. **Sync de contactos** on-demand (lazy, sin cron).
4. **Pantalla "Mi cuenta"** en admin con edición de perfil fiscal,
   cambio de API Key, "Recuérdame", y bandeja de revisión SKU.

Fuera de B2: device pairing, login cajero, turnos (todo B3); venta y
cobro (B4-B5); rate limiting / 2FA / auto-logout del cajero (B3 con el
PIN del cajero, ahí encaja mejor).

### 1. Mini-spike — endpoint real de datos fiscales

Antes de implementar el form de "Mi cuenta", validar **qué endpoint de
Holded devuelve NIF + razón social + dirección de la cuenta del
propietario**. Hipótesis a probar:

- `GET /invoicing/v1/me`
- `GET /invoicing/v1/account`
- `GET /invoicing/v1/company`
- `GET /invoicing/v1/users/me`

Para cada una, registrar Content-Type, schema del JSON (si lo es), y si
incluye los campos fiscales. Algunos pueden devolver 200+HTML (caso del
spike §01.B) — esos se descartan.

**Entregable del spike:**

- Añadir sección §08 a `docs/spike-holded.md` con la investigación.
- Si encuentras endpoint estable: actualizar
  `packages/holded-client/src/account.ts` (hoy `tryGetAccountInfo`
  apunta a `/me` sin validar) para usar el endpoint correcto y devolver
  shape tipado.
- Si **ningún endpoint funciona** (todos 200+HTML o sin campos
  fiscales): documentarlo como "no extraible vía API" y el form de "Mi
  cuenta" se llena exclusivamente con datos del almacén default + edición
  manual.

Tiempo estimado del spike: 30-60 min. **No avances al resto de B2 sin
hacerlo primero** — el form depende del resultado.

### 2. Sync incremental

#### 2.1 Job en cron

Nuevo job BullMQ `catalog-sync-incremental` con:

- **Trigger 1: cron cada 15 min por tenant activo.** Usa
  `BullMQ.repeatable` con `{ every: 900_000 }`. Un sólo job por tenant a
  la vez (`jobId: incr-<tenantId>`).
- **Trigger 2: endpoint manual** `POST /catalog/sync-now` (auth de
  propietario o encargado). Encola el job con prioridad alta. Devuelve
  202 + jobId para que el admin haga polling de su estado.

#### 2.2 Algoritmo

1. **Llama a Holded** y baja el catálogo igual que el sync inicial
   (productos + servicios + variantes + taxes + warehouses).
2. **Upsert por `holdedProductId`** (ya está) — añade
   `lastSeenInSyncAt = now()` a cada producto tocado.
3. **Detecta huérfanos**: productos del tenant con `lastSeenInSyncAt`
   anterior a este sync → marcar `active = false`. **No borrar**: los
   tickets históricos los referencian.
4. **Detecta SKU nuevos sin SKU** entre los productos nuevos o
   modificados, y dispara el auto-SKU (lógica ya implementada en B1) sólo
   sobre ellos.
5. **Refresca taxes y warehouses** (los del catálogo del tenant pueden
   cambiar).
6. **No toca `tenant.fiscalProfile`** — eso se mantiene desde el sync
   inicial o desde la edición manual. Si el spike encuentra endpoint,
   refresca aquí también.
7. **Actualiza `tenant.lastIncrementalSyncAt`** y `tenant.lastIncrementalSyncStats`
   con productos vistos, huérfanos marcados, SKU nuevos asignados, etc.

#### 2.3 Cambios en Prisma

Añadir a `Product`:

```prisma
lastSeenInSyncAt DateTime? @map("last_seen_in_sync_at") @db.Timestamptz()
```

Añadir a `Tenant`:

```prisma
lastIncrementalSyncAt    DateTime? @map("last_incremental_sync_at") @db.Timestamptz()
lastIncrementalSyncStats Json?     @map("last_incremental_sync_stats")
```

Migración: `pnpm db:migrate` — nómbrala `add-incremental-sync`.

#### 2.4 Webhooks de Holded (investigación, no implementación obligatoria)

Investigar si Holded expone webhooks que avisen de cambios en catálogo:

- Buscar en su documentación: ¿hay `POST` para registrar webhook URL?
- ¿Qué eventos cubre? (`product.updated`, `product.created`, etc.)
- ¿Hay firma HMAC para verificar autenticidad?

**Si los expone y son fiables:**

- Añadir endpoint `POST /webhooks/holded/:tenantId` con verificación de
  firma. Al recibir, encolar un sync incremental dirigido (sólo el
  producto afectado). Documentar en `docs/spike-holded.md` §09.

**Si no los expone o son flakeys:** documentar el findings y mantener
sólo el cron de 15 min. No te empecines, los cron son suficientes para MVP.

### 3. Sync de contactos on-demand

Distinto del catálogo: los contactos del tenant pueden ser miles
(libreta histórica), no tiene sentido cachearlos todos siempre.

- **No hay sync inicial completo de contactos** (eso ya quedó así en B1).
- **Endpoint `GET /contacts/search?q=<query>`** en el API: busca primero
  en BD local; si no encuentra o `q` cambia, **llama a Holded en vivo**
  (`GET /invoicing/v1/contacts?name=<q>` o equivalente — investigar el
  endpoint correcto), y **upserta lo que llega** en una tabla `Contact`
  nueva con índice por `holdedContactId`, `email`, `nif`.
- **Endpoint `POST /contacts`** para crear contacto on-the-fly desde el
  TPV. Llama a Holded `POST /invoicing/v1/contacts` y upserta el
  resultado. GET-back para validar (ADR-010).
- Schema:

```prisma
model Contact {
  id              String   @id @default(uuid()) @db.Uuid
  tenantId        String   @map("tenant_id") @db.Uuid
  holdedContactId String   @map("holded_contact_id")
  name            String
  nif             String?
  email           String?
  phone           String?
  raw             Json?
  lastSyncedAt    DateTime @default(now()) @map("last_synced_at") @db.Timestamptz()

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, holdedContactId])
  @@index([tenantId, email])
  @@index([tenantId, nif])
  @@index([tenantId, name])
  @@map("contacts")
}
```

Tests del endpoint de search con mock del cliente Holded.

### 4. Admin · "Mi cuenta"

Pantalla nueva en `apps/admin` accesible desde menú lateral.

#### 4.1 Datos fiscales (editables)

Form con NIF, razón social, dirección, código postal, ciudad, provincia,
país. Pre-rellenado con `tenant.fiscalProfile`. Botón "Guardar" persiste
en `tenant.fiscalProfile` como JSON. **No re-sincroniza con Holded**
(estos datos pueden divergir del Holded del propietario; en el ticket
mandamos lo que dice el propietario aquí).

Si el spike de §1 dio endpoint válido: botón secundario "Refrescar desde
Holded" que vuelve a leerlo y sobreescribe el form (con confirmación si
hay cambios sin guardar).

#### 4.2 Cambiar API Key

Sección "Conexión con Holded" con:

- Indicador del estado: "Conectada · última validación hace 3 min".
- Botón "Cambiar API Key" → abre modal con un input + confirm. Al
  pegar la nueva, el backend la valida (igual que el onboarding inicial),
  la cifra, la persiste sobreescribiendo, e invalida cualquier cache en
  memoria. Si la nueva falla, mantiene la antigua.
- Botón "Probar conexión" → ejecuta `GET /products?limit=1` y muestra
  resultado.

Endpoint nuevo: `POST /auth/me/rotate-holded-key` con el mismo schema
de body que `/onboarding/connect-holded`.

#### 4.3 "Recuérdame" en login

Apunte de B1 (decisión 2: sessionStorage). Añadir checkbox "Recuérdame
en este dispositivo" en `/login` del admin. Si activado:

- Refresh token se guarda en `localStorage` en lugar de `sessionStorage`.
- TTL del refresh sube de 30d a 90d.
- Hay que añadir endpoint `POST /auth/logout-everywhere` que invalide
  todos los refresh tokens del usuario (con tabla `RefreshTokenRevoke`
  o equivalente). En B2 mínimo: revocación por user.

#### 4.4 Bandeja de revisión SKU

Sección "Productos pendientes de SKU" con tabla de productos donde
`needsSkuReview = true`. Columnas: nombre, SKU sugerido por auto-SKU,
campo editable, botón "Asignar y subir".

Al asignar manualmente: el backend hace `updateProductWithGetBack` con
el SKU que dio el propietario; si Holded acepta, `needsSkuReview =
false` y `sellableViaTpv = true`. Si Holded vuelve a silenciarlo, queda
en la bandeja con un contador de intentos.

### 5. Tests

- **Spike account info** — no es código, va a docs.
- **Sync incremental**: tests del job con mock del cliente Holded
  cubriendo:
  - Happy path (productos nuevos + modificados + huérfanos detectados).
  - Tenant nuevo sin sync inicial → error claro.
  - Huérfano que vuelve en el siguiente sync → vuelve a `active=true`.
- **Endpoint manual** `POST /catalog/sync-now`: 202 + jobId, polling.
- **Contactos**: search desde Holded, upsert local, creación on-the-fly
  con GET-back (Holded silencia → `HoldedSilentRejectError`).
- **Rotación de API Key**: clave válida sobreescribe, clave inválida
  mantiene la antigua, log NO contiene la clave.
- **Bandeja SKU**: assign manual happy path + silenced (counter incrementa).

### 6. Restricciones

- **No regresiones en B1.** Todos los tests del B1 siguen verdes.
- **No tocar B3-B7.** Si te tienta empezar device pairing aquí, no lo
  hagas. La superficie de B2 es la que está descrita.
- **TypeScript estricto, JSON Schema en body, NUNCA loguear API Key
  ni refresh tokens.**
- **Migrations Prisma versionadas.**

### 7. Entregables

1. PR único con todo B2.
2. Commit messages descriptivos.
3. `.env.example` actualizado si hay variables nuevas (no espero).
4. `docs/spike-holded.md` §08 (account info) y §09 (webhooks, si aplica).
5. `docs/blocks/B2-done.md` con el resumen al final, mismo formato que
   `B1-done.md`: estructura, lo que dejaste hecho, lo que dejaste fuera,
   decisiones tomadas sin preguntar, dudas para revisar antes de B3.

### 8. Lo que NO entra en B2

- Device pairing y device token largo → **B3**.
- PIN del cajero, login del cajero, turno, fondo de caja → **B3**.
- Rate limiting de login (§17.1 del núcleo), auto-logout (§17.2), 2FA
  (§17.3), alerta nuevo dispositivo (§17.4) → **B3** (encaja con el
  login del cajero, que es donde rate limit + auto-logout tienen más
  uso).
- Venta, cobro, ticket impreso, sync de tickets → **B4-B5**.
- Worker de upload de tickets a Holded → **B5**.

Cuando termines B2 y Matías lo revise, te paso el prompt de B3.
