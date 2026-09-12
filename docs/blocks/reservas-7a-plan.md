# B-reservas-7a · El horario del centro — PLAN (frente 0)

Rama `reservas-7a-horario`, worktree `mipiacetpv-reservas-7a`, desde master
`4078655` (S1, B-5 y B-6a dentro). Línea base de la suite **antes de tocar nada**:
`181 ficheros · 1628 verdes · 3 saltados · exit 0`.

Este documento es el frente 0: **qué hay hoy, qué cambio y dónde**. Se escribe antes
de la primera línea de código para que el `-done.md` pueda contrastarse contra él.

---

## 0 · Por qué este bloque existe y B-7b no se toca

`docs/code-prompts/bloque-reservas-7-ventana-reservable.md` pasa a ser **B-7b**
(ventana reservable separada del turno + ocupación). Aquí se hace **sólo el techo**:
horario del centro, días especiales y retícula. Razón: hoy el turno lo lee **un solo
consumidor**, la agenda. No hay fichaje ni nóminas encima, así que separar
`bookable_window` de `StaffShift` no le arregla nada a nadie todavía — mientras que
el techo del centro lo pisa la rutina de Peluquería Sole **todos los días**.

De B-7b se hereda aquí, tal cual: `center_hours`, los festivos (aquí `center_days`,
más ancha) y el estado vacío que distingue causas. Se deja fuera: `bookable_windows`,
derivación/desviación, `GET /agenda/occupancy` y la pantalla de turnos y ventanas.

---

## 1 · Qué hay hoy (verificado, con la línea)

### 1.1 La disponibilidad sale sólo del turno

`store.getTemplateSlots()` (`apps/api/src/agenda/store.ts:203`) hace un
`prisma.staffShift.findMany()` y expande la `rrule` con `expandRule` (`:725`).
Devuelve `TemplateSlot[]` = `{userId, date, startTime, endTime}` en hora de pared.
**No hay ninguna otra tabla entre el contrato de trabajo y el hueco que se ofrece.**

El motor (`engine.ts`) agrupa eso en `ctx.templateByUserDate` dentro de `loadContext`
(`:186-199`) y lo consume en dos sitios y sólo dos:

- `templateCovers()` (`engine.ts:240`) — ¿la plantilla cubre `[needStart, needEnd)`?
- `candidateStarts()` (`engine.ts:451`) — los inicios gridados dentro de cada franja.

Después, `staffFree()` (`engine.ts:261`) descuenta las citas (`occByStaff`) y los
bloqueos `CENTER`/`STAFF` (`:281-297`). El anti-solape real lo hace el GiST en
`store.insertHold`.

**Consecuencia medida:** sin turno no hay agenda; con un turno de par en par, el
centro abre de par en par. Un festivo hay que bloquearlo a mano, día a día, con un
`BookingBlock scope=CENTER` (§1.4 del cruce; invariante 13 en ❌).

### 1.2 La retícula es una constante

`SLOT_MINUTES = 15` en `apps/api/src/agenda/time.ts:15`. Se usa en:

| Sitio | Línea |
|---|---|
| `candidateStarts` → `gridStarts(..., SLOT_MINUTES)` | `engine.ts:465` |
| el suelo: `currentGridStart(now, tz, SLOT_MINUTES)` | `engine.ts:593`, `:630`, `:731` |
| la guarda: `isOnGrid(startUtc, tz, SLOT_MINUTES)` | `engine.ts:566` |
| la frase: `offGridMessage(alternatives, tz, SLOT_MINUTES)` | `engine.ts:578` |
| el front: `const SLOT_MIN = 15` | `AgendaPage.tsx:47` |

Lo bueno de 6a: `floor.ts` ya acepta el paso como **parámetro** en `currentGridStart`,
`isOnGrid` y `offGridMessage`, y `time.ts::gridStarts` también. **No hay que reescribir
aritmética: hay que dejar de pasarle la constante.**

### 1.3 El motor ya tiene opciones por petición

`EngineOptions { clock?, tz? }` (`engine.ts:95`). `tz` se lee de un solo sitio
(6a §2.2). La retícula entra por ahí, al lado.

Pero `registerAgendaRoutes` construye **un solo motor al arrancar**
(`routes.ts:92`: `createCitaEngine(store)`), sin tenant. Para una retícula por centro
hace falta construirlo **por petición**.

### 1.4 El gate ya hace una lectura de tenant por petición

`ensureAgendaEnabled` (`routes.ts:50`) hace `tenant.findUnique({select:{agendaEnabled}})`
en cada petición de agenda. Ahí cabe la retícula sin ninguna lectura extra.

### 1.5 `GET /agenda` devuelve cuatro campos

`routes.ts:99-133`: `{ from, to, staff, appointments }`. `staff` sale de
`getStaffProfiles` y `appointments` de `listAppointments`. **No dice ni a qué hora
abre el centro, ni si está cerrado, ni quién falta.** La caché offline
(`lib/agenda.ts::writeDay`, `:125`) guarda exactamente eso.

### 1.6 Los bloqueos existen pero son invisibles y anónimos

`BookingBlock` (`schema.prisma:2114`) con `scope CENTER|STAFF|RESOURCE`, puntual
(`slot`) o recurrente (`rrule`), y `reason String?`. La ruta
`POST /agenda/blocks` (`routes.ts:477`) ya acepta `scope=STAFF` + `reason` y ya la
puede llamar **el cajero** (`requireOwnerOrCashier`).

Dos agujeros:
- `BlockInterval` (`types.ts:52`) **no lleva `id` ni `reason`**, y `readBlocks`
  (`store.ts:646`) no los selecciona → no se puede pintar el motivo ni borrar la
  ausencia desde la agenda.
- `AgendaPage.tsx` **no pinta bloqueos en absoluto**. Hoy una ausencia quita huecos
  en silencio: la columna se ve igual de blanca que si estuviera libre.

### 1.7 La rejilla del front está clavada a 8:00–21:00

`dayStartMin = 8*60`, `dayEndMin = 21*60` (`AgendaPage.tsx:48-49`), `hourRows()`
(`:709`). El toque redondea con `Math.round(minutes / SLOT_MIN) * SLOT_MIN`
(`:406`) y el suelo pintado con `Math.floor(nowMin / SLOT_MIN) * SLOT_MIN` (`:437`).
El aviso de "No hay huecos ese día" está en `:936` y **es una sola frase para tres
causas distintas**.

### 1.8 El Tenant tiene sitio y no tiene huso

`Tenant.agendaEnabled` en `schema.prisma:439`. **No hay columna de huso** (6a §2.2):
sigue `CENTER_TZ`, y los crons y el corte de las 05:00 (`dayCutHour`, `:378`) van con
Madrid. Una columna que sólo leyera la agenda crearía dos verdades.

---

## 2 · Qué cambio y dónde

### 2.1 Datos · una migración aditiva, backfill vacío

`packages/db/prisma/migrations/2026091_b_reservas_7a_horario_centro/migration.sql`
más el `schema.prisma`. Convención del repo: `uuid @db.Uuid`, `@map` snake_case,
`tenant_id` por fila con índice, `@db.Timestamptz` en las marcas.

**`center_hours`** — la semana tipo del centro.

```
id · tenant_id · weekday (1=lunes … 7=domingo) · open_time "HH:MM" · close_time
valid_from DATE · valid_until DATE? · created_at · updated_at
@@index([tenant_id]) · @@index([tenant_id, weekday])
CHECK weekday BETWEEN 1 AND 7 · CHECK open_time < close_time
```

**Varias filas por día** = horario partido (10:00–14:00 y 17:00–20:30). Hora de
**pared**, como `StaffShift`: la recurrencia la da `weekday`, la hora estos campos.
ISO-8601 (lunes = 1) y no el `getUTCDay()` de JS, porque la pantalla se lee de lunes
a domingo y porque "cierra el domingo" es `weekday = 7`, no `0`.

**`center_days`** — los días especiales.

```
id · tenant_id · date DATE · closed BOOLEAN · name TEXT
open_time "HH:MM"? · close_time? · created_at · updated_at
@@unique([tenant_id, date]) · @@index([tenant_id])
CHECK ( (closed AND open_time IS NULL AND close_time IS NULL)
     OR (NOT closed AND open_time IS NOT NULL AND close_time IS NOT NULL
         AND open_time < close_time) )
CHECK btrim(name) <> ''
```

Un día especial **SUSTITUYE** al horario semanal de ese día, no se suma. Un rango por
día basta (un festivo no tiene horario partido; un sábado de boda tampoco).

**Por qué es tabla y no un `BookingBlock scope=CENTER`:** un bloqueo **sólo sabe
cerrar**. El sábado de la boda hay que **abrir a las 8:30**, antes de la hora normal,
y eso un bloqueo no lo puede decir. Y el festivo necesita un **nombre** que la rejilla
pueda leer en voz alta ("Cerrado · Virgen del Prado"); `reason` de un bloqueo no
viaja hoy hasta la pantalla.

**`tenants.agenda_slot_minutes`** — `INTEGER NOT NULL DEFAULT 15`, al lado de
`agenda_enabled`, con `CHECK ("agenda_slot_minutes" IN (15, 30))` **en la base de
datos**, no sólo en el schema de la ruta.

**Backfill: cero filas y el default.** Un tenant que no toque nada tiene cero
`center_hours`, cero `center_days` y `agenda_slot_minutes = 15` → se comporta
**exactamente** como master. Ésa es la prueba: B3, B4, B-5 y 6a verdes **sin
tocarlos**.

### 2.2 El motor · el techo se aplica al construir las plantillas del día

**Dónde.** En `loadContext` (`engine.ts:186`), justo después de agrupar
`templateByUserDate` y **antes** de que nadie lo mire. Así `templateCovers` y
`candidateStarts` siguen sin saber que el centro tiene horario: las dos ven una
plantilla que ya viene recortada. Es la sugerencia del prompt y la tomo tal cual —
es el único punto por el que pasan los dos consumidores.

Orden explícito y testeado, el mismo de B-7b:

```
turno(profesional, fecha)                     ← store.getTemplateSlots, hoy
  ∩ horario_del_centro(fecha)                 ← NUEVO, en loadContext
      = día especial si lo hay, si no la semana tipo
  ∖ booking_blocks (CENTER | STAFF)           ← ya lo hace staffFree, engine.ts:281
  ∖ citas activas solapadas                   ← ya lo hacen occByStaff + el GiST
```

**Nuevo método del store**, `getCenterSchedule(tenantId, fromDate, toDate)`, que
devuelve por fecha:

```ts
interface CenterDayHours {
  date: string;                                  // YYYY-MM-DD
  // null = este tenant NO tiene techo esa fecha → se comporta como hoy.
  open: Array<{ startTime: string; endTime: string }> | null;
  // El día especial que manda, si lo hay (para que la rejilla lo diga).
  specialName: string | null;
  closed: boolean;                               // día especial cerrado, o
                                                 // día de la semana sin fila
}
```

Resolución por fecha, en este orden:

1. ¿Hay fila en `center_days` para esa fecha? → **sustituye**.
   `closed` → `open: []`, `closed: true`, `specialName` = su nombre (invariante 13).
   Con horario → `open: [ese rango]`, `specialName` = su nombre.
2. ¿No? ¿Tiene el tenant **alguna** fila de `center_hours` vigente esa fecha? →
   `open` = las filas de ese `weekday` (puede ser **vacío** → `closed: true`).
3. ¿Ninguna fila vigente? → `open: null` → **sin techo**, como hoy.

Semántica, **un test por línea**:

| Regla | Qué se prueba |
|---|---|
| Sin ninguna fila de `center_hours` → **sin techo** | Idéntico a master |
| Con ≥1 fila → **CERRADO** cualquier día de la semana **sin fila**, aunque alguien tenga turno | El domingo de Sole |
| Día especial cerrado → **cero huecos** | Invariante 13 |
| Día especial con horario → **abre aunque la semana tipo cierre ese día** | El sábado de boda |
| Día especial **sustituye**, no suma | 9–20 en la semana + 8:30–14:00 el día especial ⇒ **no** ofrece las 15:00 |

La vigencia se mira **por fecha**, no por tenant: un horario con `valid_from` el
01-10 deja septiembre **sin techo** (como hoy), no cerrado. Decisión anotada en el
done — es la lectura conservadora, la que no cambia el comportamiento de nadie por
haber configurado el futuro.

**La retícula por `EngineOptions`.** `EngineOptions { clock?, tz?, slotMinutes? }`,
con `SLOT_MINUTES` como valor por defecto. Se sustituyen las cinco constantes
sueltas de §1.2 por `slot`. En las rutas, `ensureAgendaEnabled` pasa a leer también
`agendaSlotMinutes` y lo deja en la request (`declare module "fastify"`, el patrón de
`auth/middleware.ts:33`); el motor se construye por petición con ese valor. **Una
sola lectura de tenant por petición**, la que ya había.

### 2.3 Lo que ve la cajera · `GET /agenda` amplía sin romper

Se **añaden** campos; los cuatro de hoy siguen igual. Quien no los lea no se entera.

```ts
{
  from, to, staff, appointments,          // igual que hoy
  slotMinutes: 15 | 30,
  days: [{
    date: "2026-09-12",
    // El centro. `open: null` = sin configurar (sin techo).
    open: [{ startTime, endTime }] | null,
    closed: { name: "Virgen del Prado" } | null,
    specialName: string | null,           // "boda Marta" en un día que sí abre
    // Por profesional: turno ∩ centro. Lo que NO esté aquí no es reservable.
    staffOpen: { [userId]: [{ startTime, endTime }] },
    // Las ausencias, con id (para quitarlas) y motivo (para pintarlo).
    absences: [{ id, staffUserId: string|null, startTime, endTime, reason }],
  }]
}
```

`absences` son los `BookingBlock` `STAFF` (y los `CENTER` puntuales, con
`staffUserId: null`) expandidos a hora de pared de ese día. Para eso, `BlockInterval`
gana `id` y `reason` y `readBlocks` los selecciona — aditivo, nadie más los mira.

**Todo eso viaja en la caché offline**: `AgendaDay` gana `slotMinutes` y `days`, y
`writeDay`/`loadAgendaDayFromCache` los guardan sin cambiar de esquema (el objeto
entero se serializa; `VERSION` de IndexedDB no sube porque el `keyPath` no cambia).

Con ese dato, el front:

- **Pinta como no reservable** el tiempo fuera de los tramos de la columna, y **tocar
  ahí no abre un alta** (mismo corte que el suelo de 6a, con su frase).
- **Pinta cada ausencia con su motivo** en la columna de quien falta — el «Ana libre»
  del Excel. Tocarla ofrece quitarla.
- **El día cerrado** dice `Cerrado · nombre` y no ofrece nada.
- **Las tres causas del vacío** (`AgendaPage.tsx:936` deja de ser una frase):
  1. el centro está cerrado ese día → *«El centro está cerrado ese día · Virgen del Prado»*
  2. ese profesional no está → *«Ana no tiene turno ese día»* / *«Ana no está: libre»*
  3. no queda hueco → *«No hay huecos ese día»*
  Se arreglan de tres formas distintas, así que se dicen de tres formas distintas.
- **La cita fuera de horario** (el festivo o la ausencia se pusieron después) **se
  sigue viendo y se sigue pudiendo cobrar**, marcada «fuera de horario». Se calcula en
  el front contra `staffOpen` + `absences`: un campo del servidor que dijera lo mismo
  podría discrepar de lo pintado.
- **La franja visible** sale del horario del centro de ese día con un margen de media
  hora arriba y abajo, redondeado a la hora, **ensanchada siempre hasta cubrir toda
  cita y toda ausencia del día** (si no, una cita fuera de horario sería impintable).
  `8:00–21:00` queda como valor por defecto de un centro sin configurar. El sábado de
  boda enseña las 8:30.
- **`SLOT_MIN` desaparece.** El toque, las líneas de la regla y el suelo pintado usan
  `day.slotMinutes`; sin red, el de la caché; sin caché, 15.

### 2.4 Las ausencias se ponen desde la agenda

Donde Sole las escribe hoy: en la columna, no en el admin. **Por debajo es un
`BookingBlock STAFF` por la API que ya existe** (`POST /agenda/blocks`); no se crea
ninguna entidad de ausencias (eso sigue siendo deuda de B-7b/fase 2).

Tres toques como máximo:

```
1. ⋯ en la cabecera de la columna     → hoja "Ana"
2. "No está en todo el día"           → hecho            (2 toques)
   o "No está a ratos"                → rango prerrelleno
3. "Guardar"                                             (3 toques)
```

Motivo opcional en la misma hoja. Se quita **desde la propia ausencia pintada**
(tocar → "Quitar" → `DELETE /agenda/blocks/:id`). La ruta ya la puede llamar el
cajero y el owner; no se toca su auth.

**El día entero son 23 o 25 horas.** Se manda `startTime: "00:00"`,
`endTime: "24:00"` y la ruta compone con `wallTimeToUtc`, que resuelve a la
medianoche de pared del día siguiente. El 25-10-2026 eso son **25 horas** y el
29-03-2026, **23**. Con test en los dos.

### 2.5 Pantallas del owner · ajustes de agenda

Página nueva `apps/admin/src/pages/AgendaHorarioPage.tsx` en `/admin/agenda-hours`,
entrada de sidebar «Agenda · Horario» con `capability: "agenda"` (el patrón de
`AdminShell.tsx:85`). Cuatro bloques:

1. **El horario semanal** — siete filas L→D, cada una con **mañana** y **tarde**
   (dos rangos = dos filas de `center_hours`; vacío = cerrado).
2. **Los días especiales** — fecha, cerrado u horario, nombre. Alta de un festivo en
   **dos toques** (fecha + Guardar, con "cerrado" por defecto); el listado enseña la
   **fecha y el nombre**.
3. **La retícula** — 15 o 30, con la frase de qué cambia.
4. **El aviso del refuerzo** — al guardar un día especial que abre **antes que el
   turno de todo el personal**, la pantalla lo dice (*«nadie tiene turno a las 8:30
   ese día»*) y ofrece **añadir un refuerzo de un día** a una profesional con la API
   de turnos de B3 que ya existe: `kind: REINFORCEMENT`, `validFrom = validUntil` =
   ese día. **No se toca el contrato de `StaffShift`** (D-3).

API nueva, `apps/api/src/agenda/hours.ts`, montada como el resto del admin:

```
GET    /admin/agenda/hours              → { slotMinutes, week[], days[] }   (owner|manager)
PUT    /admin/agenda/hours/week         → reemplaza la semana tipo          (owner)
PUT    /admin/agenda/hours/slot         → la retícula                       (owner)
POST   /admin/agenda/hours/days         → alta/edición de un día especial   (owner)
DELETE /admin/agenda/hours/days/:id     → quitar un día especial            (owner)
POST   /admin/agenda/hours/impact       → simulacro: qué citas quedan fuera (owner|manager)
```

Gate `agendaEnabled` en **ruta** además de en UI. `agenda_slot_minutes` lo posee esta
ruta; **no se toca `tenant-settings.ts`** para no tener dos dueños de la columna.

### 2.6 Las citas ya dadas no se mueven

**Ni un día especial, ni una ausencia, ni un horario más corto, ni un cambio de
retícula cancelan o mueven nada.** El `POST /admin/agenda/hours/impact` recibe el
cambio **propuesto** y devuelve las citas **vivas** (`PENDING`, `CONFIRMED`,
`IN_SERVICE`) que quedarían fuera:

```json
{ "count": 3, "appointments": [
  { "id": "…", "start": "…", "wallTime": "10:00", "date": "2026-09-12",
    "clientName": "Cristina", "staffName": "SOLE" } ] }
```

El front las enseña **antes de confirmar**:

> *«Ese día hay 3 citas: 10:00 Cristina, 11:30 Manoli, 12:00 Rocío. Se quedan como
> están, avísalas.»*

y al cambiar la retícula:

> *«Hay 4 citas a y cuarto. Se quedan como están.»*

Una cita fuera de la retícula **sigue siendo válida y cobrable**; sólo **al MOVERLA**
se le exige un inicio en la retícula nueva — que es lo que ya hace `reschedule` con
`isOnGrid` (6a §2.3), ahora con el paso del tenant.

**Cota del barrido:** de ahora a **+90 días**. Se dice en el done y se dice en la
pantalla; un barrido sin cota sobre un centro con dos años de agenda no es una
consulta, es un susto.

---

## 3 · Tests que se escriben

**API (`apps/api/test/agenda-horario.test.ts`, sobre el fake store):**
la tabla de §2.2 entera · el techo recorta (centro 9–20, turno 9–22:30 → nada
después de las 20:00) · domingo sin fila = cero huecos con turno · festivo con nombre
= cero huecos · sábado de boda 8:30–14:00 ofrece las 8:30 · **tenant sin configurar =
idéntico a hoy**.

**Retícula (`apps/api/test/agenda-reticula.test.ts`):** con 30 no hay ningún inicio a
y cuarto al listar · `hold` a las 10:15 → `409 BOOKING_OFF_GRID` con *«las citas
empiezan cada media hora»* · el **suelo a 30** en sus dos bordes (11:29 sí da las
11:00; 11:30 ya no) · el **cambio de hora del 25-10 con retícula de 30** · el alta sin
red que redondeó con otro paso la rechaza el servidor al volver.

**Ausencias / bloqueos (`apps/api/test/agenda-ausencias.test.ts`):** la ausencia de
Isa 9:00–10:30 quita esos huecos · el día entero cubre **25 h** el 25-10 y **23 h** el
29-03 · `GET /agenda` devuelve `id` y `reason` de cada ausencia.

**Impacto (`apps/api/test/agenda-impacto.test.ts`):** las citas vivas que quedan
fuera se listan · las canceladas y las no-show **no** · nada se cancela ni se mueve.

**Front (`apps/tpv-web/test/agenda-horario.test.tsx`):** la rejilla a 30 no produce
inicios a y cuarto al tocar · la retícula sale de la **caché** sin red · el día
cerrado dice `Cerrado · nombre` · la ausencia se pinta con su motivo · el alta de
ausencia en **tres toques** · el vacío distingue las tres causas · la cita fuera de
horario se sigue viendo y marcada.

**E2E (`apps/api/test-e2e/agenda-horario.e2e.ts`):** contra **base propia**
(`mipiacetpv_r7a_e2e`), nunca la compartida — la suite hace `DROP SCHEMA`. Se borra al
terminar.

---

## 4 · Lo que NO se toca

`StaffShift` (contrato vivo de B3, D-3) · el anti-solape, que sigue viviendo **sólo**
en la base de datos · el camino de cobro (GET-back de Holded, los 5 céntimos, `/pay`
idempotente) · los triggers de S1 · la imputación de turno del frente T de B-5 · el
suelo de 6a más allá de pasarle la retícula · `CENTER_TZ` (sin columna de huso) ·
`tenant-settings.ts`.

Cero `if (businessType)`. Vocabulario neutro (ADR-R6). Gate `agendaEnabled` en ruta y
en UI. Multi-tenant por fila. **Nada de Sole en el código ni en la semilla**: los
tests usan un centro genérico que cierra el domingo.

---

## 5 · Orden de los frentes

| Frente | Qué cierra | Commit |
|---|---|---|
| **A** | Migración + schema + `getCenterSchedule` en el store | uno |
| **B** | El motor: techo en `loadContext` + retícula por `EngineOptions` + tests | uno |
| **C** | `GET /agenda` ampliado, `BlockInterval` con `id`/`reason`, caché offline | uno |
| **D** | El front: rejilla, tramos, ausencias, las tres frases, el alta en 3 toques | uno |
| **E** | Admin: horario semanal, días especiales, retícula, refuerzo, impacto | uno |
| **F** | Bucle visual, e2e, `-done.md` | uno |

Si aparece una decisión de producto que el prompt no cubre, **paro y pregunto**.
