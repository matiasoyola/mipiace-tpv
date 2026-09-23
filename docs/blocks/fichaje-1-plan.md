# F1 · fichar desde el móvil y cumplir la ley — PLAN (Frente 0)

Origen: el prompt de Matías del 23-09-2026. Rama `fichaje-1`, worktree
`mipiacetpv-fichaje-1`. Base: `5aa0a20` (master con **A5** `08caf79` y **catálogo
local** `41882ba` dentro — comprobado con `git merge-base --is-ancestor`).
**Sin push, sin deploy.** **Con migración** — ver §9.

Decisión estructural de este bloque: `docs/design/adr-018-el-registro-de-jornada-es-inalterable.md`
(se escribe con el código, §8).

---

## 0 · Qué compra este bloque

Un colegio de Talavera sin caja y sin Holded tiene que poder **cumplir el art. 34.9 del
Estatuto de los Trabajadores** desde el primer día: registro diario de jornada con la hora
concreta de inicio y de fin de cada trabajador, conservado 4 años, a disposición del
trabajador, de sus representantes y de la Inspección.

H1 (ADR-016) dejó que esa empresa **exista, se active y entre**. Lo que falta es el módulo.

El borrador del RD de registro digital (sin aprobar) añade tres exigencias que sí se pueden
diseñar hoy sin atarse a un formato de API que no existe:

| Exigencia del borrador | Cómo se cumple aquí |
|---|---|
| **Inalterable** | Un trigger de Postgres, no la disciplina de la aplicación (§3.4). Copia literal del patrón de S1/ADR-015. |
| **Registra cada cambio** | `time_entry_corrections`, append-only por trigger, con motivo obligatorio y autor (§3.3). |
| **Consultable en remoto** | La API del empleado está versionada (`/fichaje/v1/...`) y es la misma que consumirá la app nativa de F2. La consulta de la Inspección por API queda FUERA (no hay formato). Lo que sí entra hoy: export PDF + CSV (§7). |

---

## 1 · Qué hay hoy

### 1.1 Lo que ya sirve y se copia tal cual

| Pieza | Dónde | Qué se copia |
|---|---|---|
| Capability por tenant | `schema.prisma` `Tenant.cajaEnabled` / `crmEnabled` / `agendaEnabled` | La forma: columna booleana, no `businessType`, no jsonb (ADR-R6). |
| Gate de capability en ruta | `apps/api/src/lib/caja-gate.ts` | El `preHandler` tras la auth, 403 con error nombrado y una frase. |
| Gate de capability en UI | `apps/admin/src/CajaGate.tsx` + `capability` en `AdminShell.tsx` | Envolver la pantalla, no sólo esconder la entrada del sidebar. |
| Módulos en el alta y en el PATCH | `superadmin/tenants.ts` (`MODULE_FIELDS`, `NO_MODULES_ENABLED`) | El invariante "al menos un módulo" ya está factorizado en un array. |
| Salud del onboarding por dependencias | `superadmin/onboarding-health.ts` (`modulesOn`, `requires`/`applies`) | Añadir el módulo a `modulesOn` es una línea. |
| Emparejamiento de un solo uso | `devices/routes.ts` `POST /devices/pair` + `PairingCode` | Claim atómico con `updateMany` (el bug del 2026-05-27: dos SELECT en READ COMMITTED creaban dos devices con el mismo código). |
| Token de dispositivo | `devices/auth.ts` | 32 bytes random base64url, SHA-256, columna `@unique` para lookup O(1). Argon2id NO (B3-done). |
| Cola offline | `apps/tpv-web/src/lib/outbox.ts` | Persistir en IndexedDB **antes** del POST; la pantalla depende de la persistencia local, no de la red. Lock optimista multi-pestaña. Idempotencia por `externalId`. |
| Zona horaria | `apps/api/src/agenda/time.ts` (`CENTER_TZ`, `wallTimeToUtc`, `utcToWallDate`, `utcToWallTime`) | Guardar UTC, pintar y exportar en `Europe/Madrid`, con el refinamiento de una pasada en el borde DST. |
| Inalterabilidad en el motor | `migrations/20260909000000_s1_sello_de_la_venta/migration.sql` | La tabla append-only + su trigger, la función `record_*_correction` (SECURITY DEFINER, lee el valor anterior, escribe la traza y HACE el UPDATE en la misma transacción), y el guard que sólo abre la puerta si existe una corrección **de esta misma transacción** (`txid_current()`). |
| PDF | `pdf-lib` ya es dependencia de `apps/api` (`shift/z-report.ts`) | `PDFDocument` + `StandardFonts`, sin paquete nuevo. |

### 1.2 Lo que NO sirve y por qué

**El emparejamiento de terminales cuelga de la caja.** Las cuatro rutas
(`POST /admin/registers/:registerId/pairing-codes`, `GET /admin/devices`,
`GET /admin/pairing-codes`, `GET /devices/me`, `POST /admin/devices/:id/revoke`) llevan
`ensureCajaEnabled`, y `PairingCode`/`Device` tienen `registerId` **NOT NULL**: un
dispositivo pertenece a una caja registradora. El colegio no tiene ninguna.

Decisión de Matías del 23-09: **no se toca**. Un terminal sigue perteneciendo a una caja. El
móvil del empleado copia el **patrón** (token de un solo uso, hash, revocación) con tablas y
rutas propias, colgando del empleado, y con `fichajeEnabled` como gate.

**El código de 6 dígitos tampoco sirve.** `PairingCode` usa 6 dígitos porque se teclean en un
terminal. Aquí el token viaja **en una URL** que se comparte por WhatsApp; 6 dígitos serían
enumerables (10⁶ con 7 días de validez). El token del empleado es de alta entropía, como el
`deviceToken`, y nunca se teclea.

**`StaffProfile` no es el empleado.** Es la agenda: quién atiende qué servicio, con qué
recurso y en qué franja. Un profesor no atiende citas. Decisión del prompt, confirmada al
leer el modelo: **sin enlace**. Si alguien usa la agenda y además ficha, las dos cosas
cuelgan del mismo `User`.

### 1.3 Un dato del prompt que hay que corregir (no cambia nada)

El prompt dice *"deploy.sh no recarga Caddy"*. Hoy **sí**: `infra/deploy.sh` paso 6.b compara
el sha256 del `Caddyfile` antes y después del `git pull` y hace `docker restart
mipiacetpv-caddy` si cambió. No altera el plan —**no se toca el Caddyfile igualmente**— pero
conviene que conste, porque la razón para no tocarlo pasa a ser otra: reiniciar Caddy corta
el SSL de todos los hosts, y este bloque no necesita ni una línea suya (§5.2).

---

## 2 · Frentes

| # | Frente | Commit |
|---|---|---|
| **0** | Este plan | el primero |
| **1** | El módulo: `fichajeEnabled`, migración, gate de servidor, super-admin, salud | |
| **2** | Los datos: tablas, triggers, funciones SQL, la migración inalterable | |
| **3** | La API del empleado (`/fichaje/v1/*`): emparejar, fichar, mis fichajes, corregir | |
| **4** | La API del panel (`/admin/fichaje/*`): empleados, hoy, registro, corregir, añadir | |
| **5** | La pantalla de fichar: entrada propia en `apps/admin`, PWA, cola offline | |
| **6** | El panel: Hoy, Empleados, Registro | |
| **7** | El export: PDF y CSV | |
| **8** | ADR-018 + e2e contra Postgres real | |
| **9** | Bucle visual (320 / 390 / 1280×800) | |
| **10** | `fichaje-1-done.md` | |

---

## 3 · El modelo de datos

Migración: `packages/db/prisma/migrations/20260923000000_fichaje_1/migration.sql`.
El timestamp más alto de master es `20260913000000_catalogo_local`, así que éste va detrás.
**Aditiva**: no toca ni una fila existente. Un tenant de hoy queda con `fichaje_enabled =
false` y no ve nada de esto.

SQL a mano (no `migrate dev`) por lo mismo que S1: Prisma no expresa triggers, funciones ni
índices parciales. Las tablas y columnas sí se declaran en `schema.prisma` para que el
cliente tipado las conozca; lo que Prisma no sabe expresar va en el `.sql` y se prueba contra
Postgres de verdad en el e2e.

### 3.1 El módulo

```prisma
/// F1 (ADR-018) · capability del control horario. Hermana de `cajaEnabled`
/// en forma Y en gobierno: la mueve el super-admin, no el panel del
/// cliente, porque encenderla es vender un producto.
///
/// `@default(false)` y NO true: al revés que `cajaEnabled`. La caja nace
/// encendida porque todos los tenants de hoy la tienen; el fichaje nace
/// apagado porque HOY NO LO TIENE NADIE. En los dos casos el default es
/// "déjalo como estaba".
fichajeEnabled Boolean @default(false) @map("fichaje_enabled")
```

```sql
ALTER TABLE "tenants" ADD COLUMN "fichaje_enabled" BOOLEAN NOT NULL DEFAULT false;
```

Se lee `=== true`, nunca `!== false` — es el espejo exacto del criterio de `cajaEnabled`: en
los dos casos **sólo el valor explícito contrario al default cambia el comportamiento**.

### 3.2 Empleado y su móvil

```prisma
model Employee {
  id            String    @id @default(uuid()) @db.Uuid
  tenantId      String    @map("tenant_id") @db.Uuid
  name          String
  email         String?
  phone         String?
  /// Opcional y sin enlace a StaffProfile (§1.2). Un profesor que además
  /// entra al panel es el mismo User; uno que sólo ficha no tiene ninguno.
  userId        String?   @map("user_id") @db.Uuid
  /// La baja DESACTIVA. Nunca se borra: sus registros se conservan 4 años.
  active        Boolean   @default(true)
  deactivatedAt DateTime? @map("deactivated_at") @db.Timestamptz()
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt     DateTime  @updatedAt @map("updated_at") @db.Timestamptz()

  @@unique([tenantId, userId])   // NULLs múltiples permitidos en Postgres
  @@index([tenantId, active])
  @@map("employees")
}

model EmployeeDevice {
  id              String    @id @default(uuid()) @db.Uuid
  tenantId        String    @map("tenant_id") @db.Uuid
  employeeId      String    @map("employee_id") @db.Uuid
  deviceTokenHash String    @unique @map("device_token_hash")
  pairedAt        DateTime  @default(now()) @map("paired_at") @db.Timestamptz()
  lastSeenAt      DateTime? @map("last_seen_at") @db.Timestamptz()
  revokedAt       DateTime? @map("revoked_at") @db.Timestamptz()
  userAgent       String?   @map("user_agent")
  @@index([employeeId, revokedAt])
  @@map("employee_devices")
}

model EmployeePairingToken {
  id                 String    @id @default(uuid()) @db.Uuid
  tenantId           String    @map("tenant_id") @db.Uuid
  employeeId         String    @map("employee_id") @db.Uuid
  tokenHash          String    @unique @map("token_hash")
  expiresAt          DateTime  @map("expires_at") @db.Timestamptz()
  consumedAt         DateTime? @map("consumed_at") @db.Timestamptz()
  consumedByDeviceId String?   @map("consumed_by_device_id") @db.Uuid
  createdByUserId    String?   @map("created_by_user_id") @db.Uuid
  createdAt          DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  @@index([employeeId, consumedAt])
  @@map("employee_pairing_tokens")
}
```

**Un móvil activo por empleado, garantizado por la base de datos:**

```sql
CREATE UNIQUE INDEX "employee_devices_one_active_key"
    ON "employee_devices"("employee_id") WHERE "revoked_at" IS NULL;
```

Índice parcial, mismo patrón que `v1_8_fiado`. Emparejar un móvil nuevo revoca el anterior
**en la misma transacción**; si el `UPDATE` de revocación no corriera, el `INSERT` reventaría
contra este índice en vez de dejar dos móviles vivos.

**El enlace.** `POST /admin/fichaje/employees/:id/pairing-links` genera 32 bytes random
base64url, guarda su SHA-256 y devuelve la URL completa
`https://admin.mipiacetpv.com/fichar?p=<token>`. TTL 7 días. El servidor **no envía nada**:
el panel copia al portapapeles (escritorio) o abre Web Share (móvil).

Consumo de un solo uso con el claim atómico de `devices/routes.ts`:

```ts
const claimed = await prisma.employeePairingToken.updateMany({
  where: { id, consumedAt: null, expiresAt: { gt: now } },
  data: { consumedAt: now },
});
if (claimed.count === 0) → 404 INVALID_PAIRING_LINK
```

**Sin PIN.** El móvil es personal y ya es la identidad. Revisado y sin objeción: un PIN
añadiría fricción a lo único que el empleado hace, y la palanca de seguridad real (móvil
perdido) ya existe y es mejor — generar otro enlace revoca el anterior.

### 3.3 El fichaje y su corrección

```prisma
enum TimeEntrySource { MOBILE PANEL }

model TimeEntry {
  id         String   @id @default(uuid()) @db.Uuid
  tenantId   String   @map("tenant_id") @db.Uuid
  employeeId String   @map("employee_id") @db.Uuid

  /// LA HORA QUE CUENTA: la del toque. Corregible SÓLO por la función SQL.
  startedAt  DateTime  @map("started_at") @db.Timestamptz()
  endedAt    DateTime? @map("ended_at")   @db.Timestamptz()

  /// Procedencia, INMUTABLE (el trigger la congela). `*DeviceAt` es lo que
  /// marcó el reloj del móvil al tocar; NULL cuando lo metió el panel, que
  /// es cuando nadie tocó nada. `*ServerAt` es cuándo llegó al servidor.
  startedDeviceAt DateTime? @map("started_device_at") @db.Timestamptz()
  startedServerAt DateTime  @map("started_server_at") @db.Timestamptz()
  endedDeviceAt   DateTime? @map("ended_device_at")   @db.Timestamptz()
  endedServerAt   DateTime? @map("ended_server_at")   @db.Timestamptz()

  startSource TimeEntrySource  @map("start_source")
  endSource   TimeEntrySource? @map("end_source")

  /// Idempotencia de la cola offline, igual que `Ticket.checkoutExternalId`.
  startExternalId String? @unique @map("start_external_id")
  endExternalId   String? @unique @map("end_external_id")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt DateTime @updatedAt      @map("updated_at") @db.Timestamptz()

  @@index([tenantId, startedAt])
  @@index([employeeId, startedAt])
  @@map("time_entries")
}
```

**"Enviado sin conexión" se DERIVA, no se guarda.** `|startedServerAt − startedDeviceAt| >
10 min`. Un flag podría quedar desincronizado de los dos timestamps que lo justifican; una
función pura no. Vive en `apps/api/src/fichaje/offline.ts` y la usan la API, el export y el
panel.

**Como mucho un fichaje abierto por empleado, garantizado por la base de datos:**

```sql
CREATE UNIQUE INDEX "time_entries_one_open_key"
    ON "time_entries"("employee_id") WHERE "ended_at" IS NULL;
```

**Los motivos.** Enum cerrado en la base, no sólo en el schema de la ruta (mismo criterio que
el CHECK de `agenda_slot_minutes` en 7a):

```sql
reason_code TEXT NOT NULL CHECK (reason_code IN ('OLVIDO','ERROR_HORA','OTRO')),
reason_text TEXT,
CONSTRAINT "…_otro_needs_text"
    CHECK (reason_code <> 'OTRO' OR btrim(coalesce(reason_text,'')) <> '')
```

**La tabla de correcciones** copia `ticket_corrections` campo a campo, cambiando sólo lo que
este dominio necesita (el motivo pasa de texto libre a código + texto):

```sql
CREATE TABLE "time_entry_corrections" (
    "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id"      UUID NOT NULL,
    "time_entry_id"  UUID NOT NULL REFERENCES "time_entries"("id") ON DELETE CASCADE,
    "field"          TEXT NOT NULL CHECK ("field" IN ('started_at','ended_at')),
    "old_value"      TEXT,
    "new_value"      TEXT,
    "reason_code"    TEXT NOT NULL CHECK (...),
    "reason_text"    TEXT,
    -- QUIÉN. Uno de los dos, nunca los dos ni ninguno.
    "author_kind"    TEXT NOT NULL CHECK ("author_kind" IN ('EMPLOYEE','PANEL')),
    "author"         TEXT NOT NULL CHECK (btrim("author") <> ''),
    "employee_id"    UUID,
    "user_id"        UUID,
    "txid"           BIGINT NOT NULL,
    "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ... ON ("time_entry_id","created_at");
CREATE INDEX ... ON ("tenant_id","created_at");
CREATE INDEX "time_entry_corrections_txid_row_field_idx"
    ON ("txid","time_entry_id","field");   -- lo consulta el trigger en CADA update
```

Append-only por trigger, con la única escapatoria de S1 (la cascada del borrado del padre, en
la que la fila padre ya no existe):

```sql
CREATE TRIGGER "time_entry_corrections_append_only"
    BEFORE UPDATE OR DELETE ON "time_entry_corrections" FOR EACH ROW ...
```

### 3.4 La inalterabilidad, en el motor

Tres piezas, exactamente las de S1:

**a) `mipiacetpv_time_correction_exists(p_entry_id uuid, p_field text)`** — ¿hay una
corrección viva **de esta transacción** para esta columna de esta fila? Es lo único que abre
la puerta.

**b) `record_time_entry_correction(...) RETURNS uuid`**, `SECURITY DEFINER`, `SET search_path
= public, pg_temp`. Valida (campo corregible, motivo presente, `OTRO` con texto, autor
coherente con `author_kind`), lee el valor anterior **del propio motor**, inserta la traza con
`txid_current()` y HACE el `UPDATE`. La traza y el cambio son la misma transacción por
construcción. **El código de la aplicación no escribe nunca `started_at` ni `ended_at` en un
`UPDATE`.**

**c) El guard, `BEFORE UPDATE ON time_entries`:**

| Columna | Regla |
|---|---|
| `started_at` | Cualquier cambio exige corrección en esta txid. Se fija en el `INSERT` y no vuelve a moverse. |
| `ended_at` `NULL → valor` | **Permitido sin corrección**: es el fichaje de salida, la segunda mitad del mismo hecho, no una alteración. Exige que el mismo `UPDATE` traiga `ended_server_at` y `end_source` no nulos — un `UPDATE ... SET ended_at = ...` a pelo desde psql no los trae y se rechaza. |
| `ended_at` `valor → otro valor` | Exige corrección. |
| `ended_at` `valor → NULL` | **Prohibido siempre.** Reabrir un tramo cerrado es borrar el registro con otro nombre. |
| `id`, `tenant_id`, `employee_id`, los cuatro `*_device_at` / `*_server_at`, `start_source` | Inmutables. Sin excepción, sin vía de corrección. |

Y **`BEFORE DELETE ON time_entries`**: se rechaza siempre, con la única escapatoria de S1
(el tenant ya no existe → es la cascada de su borrado, no alguien limpiando un registro).
Así, "no se puede borrar ni por la API, ni por el panel, ni por el super-admin" deja de
depender de que las tres se porten bien.

> **Por qué el fichaje de salida no exige corrección y el clock-in tampoco deja traza.**
> El `INSERT` del tramo no escribe ninguna fila de log, y nadie lo echa en falta: la fila
> **es** el registro. Cerrar el tramo es el mismo acto, doce horas después. Exigir traza para
> la segunda mitad y no para la primera sería una asimetría sin dueño. La frontera es la
> misma que en ADR-015: el dato se sella cuando queda completo, y a partir de ahí sólo se
> corrige. Se argumenta entero en el ADR-018.

### 3.5 Lo que NO entra en el modelo

Sin pausas, sin jornada teórica, sin festivos, sin ausencias, sin vacaciones, sin ubicación.
Todo eso es F2 y **ninguna columna de este bloque se diseña para acomodarlo**: si la jornada
teórica llega, llega con su tabla.

---

## 4 · La API

Dos superficies con dos autenticaciones distintas y un gate común.

### 4.1 El gate

`apps/api/src/lib/fichaje-gate.ts`, copia de `caja-gate.ts` con **una diferencia deliberada y
documentada en el propio fichero**:

```
caja-gate:    la lectura falla hacia ENCENDIDO.  Fallar hacia apagado dejaría sin
              cobrar a quien cobra (ADR-016 §6, "cobrar siempre se puede").
fichaje-gate: la lectura falla hacia APAGADO.    El default de la columna es `false`;
              nadie tiene el módulo hoy. Y una lectura que falla es la BD caída, en
              la que el POST del fichaje tampoco se iba a escribir — el toque ya está
              a salvo en la cola local del móvil, que es donde este producto lo
              protege (§5.3). Fallar hacia encendido abriría el módulo a un tenant
              que no lo ha contratado.
```

Resuelve el tenant desde `request.auth` (panel) o `request.employee` (móvil). 403
`FICHAJE_DISABLED` con frase.

**`ensureCajaEnabled` NO aparece en ninguna ruta de este bloque.** Es un caso de la tabla de
sabotaje: ponerlo pone roja a una empresa sin caja, que es justo el cliente 0.

### 4.2 La superficie del empleado — `/fichaje/v1/*`

Versionada desde el primer día porque **es la que consumirá la app nativa de F2**. Auth:
header `X-Employee-Token` → `requireEmployeeDevice` (`fichaje/auth.ts`, copia de
`devices/auth.ts`: SHA-256, lookup por columna `@unique`, 401 `EMPLOYEE_DEVICE_REVOKED`).
Decora `request.employee = { employeeId, tenantId, deviceId }`.

| Ruta | Qué hace |
|---|---|
| `POST /fichaje/v1/pair` | Sin auth. `{ token, userAgent? }` → claim atómico, revoca el móvil anterior e inserta el nuevo en una transacción, devuelve `{ employeeToken, employee, tenant }`. |
| `GET /fichaje/v1/me` | Empleado, nombre de la empresa, zona horaria, tramo abierto, **`pendingExit`** (tramo abierto de un día local anterior) con `suggestedEndAt`, y el resumen de hoy. |
| `POST /fichaje/v1/entries` | Entrada. `{ externalId, deviceAt }`. Idempotente por `externalId`. `startedAt = deviceAt`. |
| `POST /fichaje/v1/entries/:id/close` | Salida. `{ externalId, deviceAt }`. `UPDATE ... WHERE id = ? AND ended_at IS NULL` → `count === 0` es "ya cerrado", éxito idempotente. |
| `GET /fichaje/v1/entries?month=YYYY-MM` | Mis fichajes del mes, con totales por día y las marcas. |
| `POST /fichaje/v1/entries/:id/corrections` | Corrección propia. `{ field, value, reasonCode, reasonText? }`. Límite **30 días**; más atrás → 403 `CORRECTION_TOO_OLD` con la frase que manda a la empresa. |
| `GET /fichaje/v1/entries/:id/corrections` | El historial: antes → después, quién, cuándo, motivo. |

**Aislamiento.** Todas filtran por `employeeId` Y `tenantId` del token. Un token de un
empleado que pida el `:id` de otro recibe **404**, no 403: un 403 confirmaría que ese
fichaje existe.

### 4.3 La superficie del panel — `/admin/fichaje/*`

`preHandler: [requireOwnerOrManager, ensureFichajeEnabled]`.

> **Decisión sin preguntar:** `requireOwnerOrManager`, no `requireOwner`. En un colegio
> quien da de alta a un profesor y le corrige un olvido es la secretaría, no la dirección —
> el mismo reparto que ya vale para cajeros y dispositivos (B6 §1). Se dice en el `-done`.

| Ruta | Qué hace |
|---|---|
| `GET/POST /admin/fichaje/employees`, `PATCH /:id`, `POST /:id/deactivate` | Alta, edición, baja (desactiva, nunca borra). |
| `POST /admin/fichaje/employees/:id/pairing-links` | Genera el enlace. Devuelve URL + caducidad. |
| `POST /admin/fichaje/employees/:id/devices/revoke` | Revoca el móvil activo. |
| `GET /admin/fichaje/today` | Quién está dentro y desde cuándo, quién no ha fichado, y los avisos. |
| `GET /admin/fichaje/entries?month=&employeeId=` | El registro. `employeeId` ausente = todos. |
| `POST /admin/fichaje/entries` | Añadir un fichaje que falta. Origen `PANEL`, motivo obligatorio. |
| `POST /admin/fichaje/entries/:id/corrections` | Corregir desde el panel. **Misma función SQL**, `author_kind = 'PANEL'`, sin límite de 30 días. |
| `GET /admin/fichaje/export.csv` · `GET /admin/fichaje/export.pdf` | §7. |

**No hay `DELETE` en ninguna de las dos superficies.** Y aunque lo hubiera, el trigger de §3.4
lo pararía.

### 4.4 El super-admin

`fichajeEnabled` entra en `MODULE_FIELDS` de `superadmin/tenants.ts` (alta, PATCH con diff y
audit, y el invariante `NO_MODULES_ENABLED` recalculado **después** del cambio), en
`onboarding-health.ts` (`modulesOn`), y en la respuesta de `GET /super-admin/tenants/:id`.

**No entra en `POST /admin/tenant/settings`** — igual que `cajaEnabled`, y por la misma razón:
encenderlo es vender un producto. `additionalProperties: false` hace que un intento del
propietario sea un 400. El `GET` sí lo devuelve, porque el panel lo necesita para esconder lo
que no aplica.

Con esto, el colegio se activa con **fichaje como único módulo**: `modulesOn = ["fichaje"]`,
el check `modules-enabled` pasa, y `caja`/`holded` quedan en *No aplica*.

---

## 5 · Dónde vive la pantalla de fichar

### 5.1 La decisión

Ruta pública **dentro de `apps/admin`**: `admin.mipiacetpv.com/fichar`. Ni app nueva, ni
contenedor nuevo, ni entrada nueva en `docker-compose`, ni una línea de Caddy.

El enlace personal es `https://admin.mipiacetpv.com/fichar?p=<token>`.

### 5.2 Por qué NO hace falta tocar el Caddyfile

El bloque `admin.mipiacetpv.com` ya hace lo que necesitamos:

```
handle { root * /srv/static/admin ; try_files {path} /index.html ; file_server }
```

- `/fichar` y `/fichar?p=…` → `{path}` no existe como fichero → cae a `/index.html`. **Es
  exactamente cómo llega hoy `/admin/devices`.**
- `/fichar-sw.js` y `/fichar-manifest.webmanifest` → salen de `apps/admin/public/`, que Vite
  copia tal cual a `dist/`, y el `Dockerfile` copia `apps/admin/dist` entero a
  `/export/admin`. `{path}` **sí** existe → `file_server` los sirve con su MIME.
- CSP: `default-src 'self'` cubre `manifest-src`; `worker-src` cae a `child-src` → `script-src
  'self'`. El service worker es del mismo origen. **Nada que añadir.**

### 5.3 Las tres cosas que chocarían con el admin, y cómo se evitan

**a) El login.** `/fichar` **no** pasa por `RootRouter` ni por `readTokens()`. La identidad
del empleado es el token de dispositivo en `localStorage`, y es otra sesión distinta de la del
propietario. Sin `p=` y sin token guardado, la pantalla dice "Este enlace no es válido" y no
redirige a `/login`.

**b) El bundle.** `App.tsx` importa las ~30 pantallas del panel de forma estática. Servir eso
al móvil de un profesor para enseñarle un botón sería absurdo. `main.tsx` pasa a bifurcar con
**dos imports dinámicos** —uno por rama— para que Vite parta el chunk:

```tsx
const esFichar = location.pathname === "/fichar" || location.pathname.startsWith("/fichar/");
const mod = esFichar ? await import("./fichar/FicharApp.js") : await import("./App.js");
```

Es el único cambio en `main.tsx`, y el panel sigue exactamente igual (un chunk más, cargado
en la misma navegación).

**c) El service worker.** El admin **no tiene ninguno hoy**, y meterle uno de ámbito `/`
sería el bug documentado en `v1.2-Lite` Lote 3.B y en A4: bundle viejo servido para siempre,
esta vez al super-admin.

El SW vive en `apps/admin/public/fichar-sw.js` —fichero real, ámbito máximo `/`— y se
registra **sólo desde la rama de fichar** con ámbito reducido:

```js
navigator.serviceWorker.register("/fichar-sw.js", { scope: "/fichar" });
```

Un ámbito **más estrecho** que el directorio del fichero siempre está permitido, así que no
hace falta la cabecera `Service-Worker-Allowed` (que sí obligaría a tocar Caddy). El SW
**no puede controlar** `/admin/*` ni `/superadmin/*` ni aunque tuviera un bug.

Estrategia, escrita a mano (sin `vite-plugin-pwa` en el admin: sin manifiesto de precache que
mantener, 60 líneas legibles):

| Petición | Estrategia |
|---|---|
| Navegación a `/fichar*` | NetworkFirst → cae al shell cacheado. Un deploy entra en la siguiente carga con red. |
| `/assets/*` (hasheados, inmutables) | CacheFirst. |
| `/api/*` y `/version.json` | **Nunca se cachean.** |

El manifest (`/fichar-manifest.webmanifest`, `start_url` y `scope` = `/fichar`, iconos
propios) y las metas de iOS se **inyectan en runtime desde la rama de fichar**, para que el
panel no se vuelva instalable como "Fichar".

### 5.4 La cola offline

`apps/admin/src/fichar/lib/outbox.ts`, copia reducida de `tpv-web/src/lib/outbox.ts`:
IndexedDB propia (`mipiacetpv-fichaje-outbox`), **persistir antes de enviar**, reenvío al
arrancar / al evento `online` / cada 15 s, lock optimista con TTL, idempotencia por
`externalId`. Se quedan fuera las piezas que aquí no existen: turnos locales, mesas
bloqueadas, `PATCH`.

**Una pieza nueva: `holdUntil`.** El "deshacer durante 4 s" (punto 4 del prompt) no puede ser
un DELETE en el servidor —los registros no se borran— así que el toque se **persiste
inmediatamente** en IndexedDB con `holdUntil = now + 4000` y el flush **salta** los items
cuyo `holdUntil` no ha vencido. Deshacer borra el item local antes de que salga.

Con eso, las dos cosas se cumplen a la vez: si el empleado mata la app dentro de esos 4 s, el
fichaje **sobrevive** y se envía al arrancar; y si pulsa "Deshacer", nunca existió en el
servidor. Pasados los 4 s el banner desaparece y cualquier cambio ya es una corrección.

---

## 6 · Las pantallas

Sistema visual Mi Piace (`docs/design/tokens.md`): DM Sans, `mipiace.coral` como acento,
`rounded-2xl`, sentence case, `tabular-nums` en horas y totales. Tap targets: la escala
cerrada es `touch` 48 / `touch-pad` 56 / `touch-lg` 64.

> **El botón de fichar se sale de la escala a propósito.** Se pulsa entrando por una puerta
> con el bolso en la otra mano. Será un círculo de ~200 px (≈23 mm), del orden de la tarjeta
> de producto del TPV, no del de un control de la escala. Es un **token nuevo**
> (`h-tap-fichar`), añadido a `tokens.md` con su justificación antes de implementarlo, como
> manda la regla de la §4 de ese documento.

### 6.1 El empleado (`/fichar`)

| Estado | Qué se ve |
|---|---|
| Fuera | El botón grande: **"Entrar"**. Nada más compitiendo. |
| Dentro | **"Salir"**, la hora de entrada y un contador vivo (`2h 14m`). Holded pone `00h00m` mientras el tramo está en curso; aquí no. |
| Al pulsar | Feedback inmediato + confirmación legible de un vistazo: **"Entrada 08:02"**. |
| 4 s | Banner "Deshacer" (§5.4). |
| Sin red | "Pendiente de enviar", discreto. El toque **ya está dado**. |
| Salida olvidada | §6.2 — sustituye al botón, es lo primero que se ve. |
| Debajo | **"Mis fichajes"**: los días del mes con entrada, salida y total. Cada día se toca para corregirlo; los corregidos llevan marca, y la marca abre el historial. |

El empleado no ve nada más. Ni otros empleados, ni ajustes, ni el nombre de la empresa más
allá de una línea de cabecera.

### 6.2 La salida olvidada, como caso principal

Con un tramo abierto de un día anterior, lo primero **no es el botón**:

> **Ayer no fichaste la salida.**
> ¿A qué hora saliste?
> `[ 17:30 ]`   ← la mediana de sus salidas de los últimos 30 días
> **Confirmar** · Elegir otra hora

Un toque. Se guarda como **corrección con motivo `OLVIDO`**, el original sigue ahí, y después
aparece su botón normal.

Sin historial, **no se propone hora**: sólo el selector. Nunca se cierra solo con una hora
inventada — sería falsear el registro, y es una fila de la tabla de sabotaje.

Mientras nadie lo resuelva, el tramo sigue abierto y la empresa lo ve marcado **"sin salida"**
en Hoy. Sin push en este bloque (en iOS no son fiables en una PWA sin instalar): el aviso sale
al abrir.

### 6.3 Corregir

Selector de hora **sin teclear** (rueda de horas y minutos en pasos de 5, `touch-pad`), y el
motivo de un toque: `Olvido` · `Error de hora` · `Otro`. Sólo "Otro" abre un campo de texto,
y entonces es obligatorio (CHECK en la base, no sólo en el formulario).

### 6.4 El panel (`/admin/fichaje*`)

Sección **"Control horario"** en el sidebar, `capability: "fichaje"`, sólo con
`fichajeEnabled`. Tres pantallas, envueltas en `<FichajeGate>` (copia de `CajaGate.tsx`:
esconder no es gatear, la URL sigue existiendo):

| Ruta | Pantalla |
|---|---|
| `/admin/fichaje` | **Hoy** — la entrada de la sección. Quién está dentro y desde qué hora, quién no ha fichado, y los avisos: *sin salida*, *corregido*, *enviado sin conexión*. |
| `/admin/fichaje/empleados` | **Empleados** — alta, edición, baja, estado del móvil (emparejado y desde cuándo), generar enlace, revocar. |
| `/admin/fichaje/registro` | **Registro** — por mes, por empleado o de todos: entrada, salida, total diario, total del mes y las marcas. Se corrige y se añade desde aquí. Y se exporta. |

`landingSinCaja()` en `App.tsx` gana una rama: una empresa con fichaje y sin caja aterriza en
`/admin/fichaje`. El colegio entra a su panel y lo primero que ve es quién está dentro.

---

## 7 · Lo que se le enseña a la Inspección

Desde **Registro**: un mes, de un empleado o de todos, en **PDF** y en **CSV**.

**Contenido, idéntico en los dos formatos:**

1. Datos de la empresa: nombre y NIF (de `fiscalProfile`, que existe desde H1 y es un check
   duro de la activación).
2. Empleado.
3. Por día: entrada, salida y total. Total del mes.
4. **Las correcciones del periodo, al final**: valor anterior, valor nuevo, motivo, autor y
   fecha.
5. Horas en **hora local con la zona indicada** ("Europe/Madrid (CEST)").
6. Pie con fecha de generación.
7. En el PDF, **hueco para la firma del trabajador** — en la práctica se firma en papel.

PDF con `pdf-lib` (ya es dependencia de `apps/api`), A4 vertical, `StandardFonts.Helvetica`.
CSV con `;` y BOM UTF-8, porque lo abre Excel en español.

**El cambio de hora.** El 25-10-2026 a las 03:00 CEST el reloj vuelve a las 02:00 CET. Un
tramo que lo cruce dura **una hora más** que la diferencia de sus horas de pared. El total se
calcula **siempre sobre los instantes UTC** —nunca restando horas de pared— y el e2e lo prueba
a los dos lados con `agenda/time.ts`.

---

## 8 · ADR-018

`docs/design/adr-018-el-registro-de-jornada-es-inalterable.md` (017 es el más alto de master:
catálogo local).

Tesis: *el registro de jornada lo hace inalterable el motor de base de datos, y toda
corrección legítima deja traza con motivo y autor.*

Alternativas descartadas, con su porqué:

| Alternativa | Por qué no |
|---|---|
| **Sobrescribir, como Holded** | Un registro que se puede editar sin traza no es un registro de jornada: el art. 34.9 lo quiere a disposición de la Inspección, y el borrador del RD exige inalterabilidad y traza de cada cambio. Es exactamente el agujero nº 1 que S1 cerró para la venta. |
| **Circuito de aprobación** (el empleado propone, la empresa aprueba) | Mete a un tercero en el camino de algo que el trabajador tiene derecho a hacer, y crea un estado "pendiente" en el que el registro no dice la verdad ni antes ni después. La traza inalterable ya da la garantía sin la fricción. |
| **Cierre automático de la salida olvidada** | Inventarse una hora y firmarla como registro de jornada es falsear un documento con valor legal. Se pregunta. |

Consecuencias, incluida la que se paga: cualquier código futuro que intente un `UPDATE` sobre
`started_at`/`ended_at` **fallará en producción, no en revisión** (la misma que ADR-015 §6).

---

## 9 · Migración, tests y despliegue

- Migración `20260923000000_fichaje_1`, **aditiva**. Un tenant de hoy queda
  `fichaje_enabled = false` y su comportamiento es idéntico al de master. Los tests
  existentes siguen verdes **sin tocarlos**.
- Antes de `pnpm test`, `pnpm db:generate`. La suite se corre con `pnpm test` **desde la
  raíz** y se mira el recuento de **saltados**, no sólo el de rojos (master: 3 saltados,
  `super-admin.test.ts:566`).
- e2e contra base **propia**: `mipiacetpv_fichaje_e2e`, nunca la compartida (la suite hace
  `DROP SCHEMA` y hay otras sesiones vivas). Se borra al terminar.
- Bucle visual con Playwright a **320 / 390 / 1280×800**, con captura y revisión crítica de
  cada pantalla contra `tokens.md`.
- Antes de cerrar: `git log HEAD..master` por si master se ha movido.

**Al desplegar** (se cierra en el `-done` con lo que se mida): la migración es aditiva y sólo
crea objetos nuevos más una columna con `DEFAULT` constante —que desde PG 11 no reescribe la
tabla—, así que **viaja sola, sin ventana**. Se confirma tras correrla contra el e2e.

---

## 10 · Lo que queda fuera (F2 y siguientes)

Jornada teórica y cuadre contra ella, festivos, ausencias y vacaciones, pausas, ubicación,
notificaciones push, la app nativa de la fase 2, la consulta remota de la Inspección por API,
la facturación del módulo (`plan` sigue siendo texto libre), terminales sin caja, y cualquier
cosa de la agenda, la caja o Holded.
