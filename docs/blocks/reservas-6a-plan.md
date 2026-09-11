# B-reservas-6a · el suelo de la agenda — PLAN (Frente 0)

Origen: el prompt de Matías del 11-09-2026, que parte B-6 en dos.
`docs/code-prompts/bloque-reservas-6-yield.md` pasa a ser **B-6b** (las reglas del spa) y no se toca
en este bloque.
Rama `reservas-6a-suelo`, worktree `mipiacetpv-reservas-6a`, base `562458a` (S1 y B-5 dentro).
**Sin push, sin deploy, sin migración.**

Leído antes de escribir esto: `bloque-reservas-6-yield.md` (§3 y §5, que son lo que 6a hereda),
`docs/reservas/01-cruce-con-b-reservas-4.md` (§H1, §1.2 punto 6, D-4b, Parte 4),
`docs/reservas/03-que-falta-para-la-agenda-del-informe.md` §1,
`apps/api/src/agenda/engine.ts` entero, `time.ts`, `types.ts`, `store.ts`, `routes.ts`,
`apps/tpv-web/src/pages/AgendaPage.tsx`, `apps/tpv-web/visual/main.tsx` y
`docs/blocks/reservas-5-done.md`.

---

## 1 · Qué hay hoy, medido

Las líneas que citaba el prompt viejo se habían movido. Éstas son las de `562458a`.

| Pieza | Dónde (hoy) | Estado |
|---|---|---|
| El "ahora" del motor | **no existe** | `grep "new Date()\|Date.now()"` en `apps/api/src/agenda/*.ts` → **una sola aparición**, `engine.ts:512`, y es el TTL del hold. **El motor no sabe qué hora es.** |
| Retícula de 15 min | `time.ts:15` (`SLOT_MINUTES`), `time.ts:108` (`gridStarts`) | ✅ |
| Zona horaria del centro | `time.ts:12` (`CENTER_TZ = "Europe/Madrid"`), constante de módulo | ✅ una sola fuente, pero **no inyectable** |
| Inicios candidatos | `engine.ts:406` (`candidateStarts`) → `gridStarts` | alineados a la retícula, **sin suelo temporal** |
| `availability()` | `engine.ts:455` → `computeSlots` (`:429`) | ofrece **ayer** si el turno cubría ayer |
| `hold()` | `engine.ts:466`; el plan sale de `planForStart` directo en `:497` | acepta **cualquier** `start` factible: **las 10:07 y el martes pasado** |
| `reschedule()` | `engine.ts:548`; `planForStart` en `:570` | lo mismo |
| Errores del alta | `routes.ts:225-236` | `NO_REQUIREMENTS`→400, resto→409 con un `message` fijo ("El hueco ya no está disponible.") y `alternatives` |
| Errores del mover | `routes.ts:285-290` | 409 con `message` fijo ("No se pudo mover a ese hueco.") |
| Anti-solape | `migration.sql:134-142` (GiST en `appointment_assignments`) | vive **sólo** en la BD; `store.ts:53` traduce `23P01` → `ExclusionError` |
| Tests del motor | `apps/api/test/agenda-engine.test.ts` (620 líneas) | contra un **store en memoria** que *simula* el EXCLUDE |
| Tests de tz | `apps/api/test/agenda-time.test.ts` (44 líneas) | verano e invierno, **siempre bajo la TZ del proceso** |
| e2e contra Postgres | `apps/api/test-e2e/` (4 ficheros, 35 tests, de S1 y B-5) | el harness existe y sirve |
| Front · hueco vacío | `AgendaPage.tsx:355` (`openSlotFirst`) | `Math.round(min/15)*15` y abre el panel **sea la hora que sea**, incluida la de hace tres horas |
| Front · línea "ahora" | `AgendaPage.tsx:612-618` | se pinta, pero **no cambia lo que se puede tocar** |
| Front · error del alta | `AgendaPage.tsx:298-301` (`doCreate`) | `flash(res.message)` — **tira las `alternatives`** que `lib/agenda.ts:209` ya trae parseadas |
| Banco visual | `apps/tpv-web/visual/main.tsx:315` (`freezeClock`, `?at=HH:MM`) | reloj congelado ya montado por B-5 |

**Resumen en una frase:** el motor calcula la geometría de los huecos muy bien y **no tiene reloj**.

---

## 2 · Qué cambio y dónde

### F1 · El suelo, en el motor y sin configurar

**Nuevo `apps/api/src/agenda/floor.ts`** — el invariante, no una política:

```ts
export interface Clock { now(): Date }
export const systemClock: Clock;
// Comienzo de la franja EN CURSO de la retícula del centro, en hora de pared de `tz`.
export function currentGridStart(now: Date, tz: string, stepMin: number): Date;
// ¿`start` cae en un inicio de la retícula de `tz`?
export function isOnGrid(start: Date, tz: string, stepMin: number): boolean;
```

El suelo se calcula **en hora de pared** (minutos desde medianoche → suelo al múltiplo de 15 →
`wallTimeToUtc`), no sobre el epoch: es la misma aritmética que `gridStarts`, y es la que sobrevive a
husos con offset no entero.

**`engine.ts`**:

- `createCitaEngine(store, opts?: { clock?: Clock; tz?: string })`. Por defecto `systemClock` y
  `CENTER_TZ`. **Una sola fuente** del ahora y del huso; `routes.ts` no pasa nada y se comporta igual
  que hoy. Los `CENTER_TZ` sueltos de `engine.ts` (`:330`, `:421`, `:485`, `:561`) pasan a ser el
  `tz` del motor.
- `availability()`, `hold()` y `reschedule()` llaman `clock.now()` **una vez** y derivan de ahí el
  suelo. Mismo instante para listar y para reservar dentro de una petición.
- `computeSlots(..., notBefore)` descarta los inicios anteriores al suelo. Como `availability()` y
  las `alternatives` de `hold()`/`reschedule()` pasan las dos por aquí, el filtro es único.
- `hold()` y `reschedule()`, antes de `planForStart`:
  1. `start < suelo` → `BOOKING_IN_PAST`
  2. `!isOnGrid(start)` → `BOOKING_OFF_GRID`
  El pasado se mira primero: es lo que hay que decirle a la clienta.
- `HoldResult` gana los dos `reason` nuevos y un `message` opcional (la frase que se lee en voz
  alta; la escribe quien conoce el huso y las alternativas).

**`routes.ts`**: mapeo explícito de `reason` → `409 { error, code, message, alternatives }`.
`code` lleva el mismo valor que `error` a propósito: es el hueco donde B-6b pondrá la *key* de la
regla cuando llegue `POLICY_BLOCKED`, y así el front no cambia dos veces.

**La franja EN CURSO se puede reservar.** Son las 11:10 → 11:00 vale, 10:45 no. Sin excepción de
OWNER: una cita que ya ocurrió se cobra por venta rápida.

### F2 · La simetría listar ↔ reservar (invariante 6)

Test fundacional: se listan los huecos del día con `availability()`, y `hold()` de un inicio que **no
está en esa lista** falla. Las dos fugas conocidas (el pasado y el 10:07) se ejercen contra la lista
real, no contra una constante.

### F3 · La fuga de la retícula (D-4b)

Cubierta por el punto 2 de F1. **También en `reschedule()`**, no sólo en `hold()`: mover una cita a
las 10:07 es la misma fuga por la otra puerta, y el invariante 6 no distingue.

### F4 · El EXCLUDE contra Postgres real

Nuevo `apps/api/test-e2e/agenda-suelo.e2e.ts`, con el harness de S1/B-5 (`e2e-env.ts`,
`global-setup.ts`, siembra como `cita-a-caja.e2e.ts`):

- **El EXCLUDE muerde**: dos `insertHold` de la misma profesional en el mismo hueco → la **segunda la
  rechaza Postgres** (`23P01` → `ExclusionError`). Determinista, sin carrera.
- **La carrera por la API**: dos `POST /agenda/appointments` a la vez → exactamente **una** cita en
  la BD (contada por SQL).
- **El suelo por la API real**, con el reloj de verdad: pasado → 409 `BOOKING_IN_PAST` con frase y
  alternativas; fuera de retícula → 409; la franja en curso → 201.
- **Lo que el suelo NO toca** (cada punto con su test): cobrar una cita de las 10:00 a las 11:00
  (`POST /agenda/appointments/:id/checkout` + `POST /tickets/:id/checkout`), `PATCH` de estado sobre
  una cita pasada, y mover una cita pasada **hacia adelante** (eso sí se puede).

Base propia: `mipiacetpv_r6a_e2e`. Se borra al terminar.

### F5 · Invariante 14 · zona horaria

- La suite de la agenda repetida bajo **`TZ=America/New_York`**: `process.env.TZ` fijado **antes** de
  importar los módulos, con import dinámico.
- **El cambio de hora del 25-10-2026 en Europe/Madrid**: la primera semana de octubre de Sole con
  agenda puede caer ahí. Se ejercen el suelo, la alineación y el conteo de huecos ese día.

### F6 · Front (`AgendaPage.tsx`)

- **Una franja pasada no invita**: la zona anterior al suelo se pinta apagada y `openSlotFirst` no
  abre el panel ahí (dice por qué). En un día ya pasado, la columna entera.
- **El 409 con su frase y sus alternativas tocables**: `doCreate` deja de tirar `res.alternatives`;
  el panel de alta enseña el mensaje del servidor y hasta tres botones de hora que fijan `draft.start`.
- Bucle visual con Playwright a **1280×800, 390 y 320**, más el estado de error, contra
  `docs/design/mockups/agenda-reservas.html` y el estándar de acabado (`docs/ux-principles.md`).
  El banco (`visual/main.tsx`) gana el escenario del 409 con `?fallo=pasado`; el reloj congelado
  (`?at=`) ya está.
- Test jsdom nuevo de `AgendaPage` (hoy no hay ninguno — carryover 5 de B4, §4.8 de B-5).

---

## 3 · Decisiones que tomo sin preguntar (y por qué)

1. **La franja en curso se puede reservar.** Está en el prompt; la repito aquí porque es la que
   decide todo lo demás: "¿tienes hueco ahora?" funciona y lo que ya pasó no entra.
2. **La `tz` del tenant es hoy `CENTER_TZ`, y no pido columna.** `Tenant` no tiene columna de huso
   (verificado en `schema.prisma`), y el bloque va sin migración. El suelo la lee de **un solo
   sitio** —`opts.tz` del motor, con `CENTER_TZ` por defecto— así que el día que exista la columna se
   enchufa en una línea. Lo que sí queda cerrado hoy es lo que pedía el prompt: **no se usa la zona
   del proceso** en ningún punto del cálculo.
3. **La alineación a la retícula también en `reschedule()`**, no sólo en `hold()`. El prompt sólo
   nombra `hold()` (viene de D-4b), pero mover una cita a las 10:07 es la misma fuga y el invariante 6
   no distingue entre crear y mover.
4. **Dos códigos, no uno**: `BOOKING_IN_PAST` (pasado) y `BOOKING_OFF_GRID` (fuera de retícula). Son
   dos frases distintas al teléfono; un solo código obligaría a la cajera a adivinar cuál de las dos
   le está pasando.
5. **`code` = `error`** en el cuerpo del 409. El prompt pide `{ error, code, message, alternatives }`;
   en B-6b `code` será la *key* de la regla. Poniéndolo ya, el front lee `code` desde hoy y no se
   reescribe en 6b.
6. **Las alternativas de un `BOOKING_IN_PAST` se buscan desde el suelo, no desde la fecha pedida.**
   Si alguien pide el martes pasado, los "tres huecos siguientes" del martes pasado son cero. Se
   miran el día del suelo y el siguiente.
7. **El corte por `externalId` (idempotencia del alta offline) sigue ANTES del suelo.** Reenviar una
   cita que el servidor ya tiene no puede fallar porque haya pasado el tiempo. Lo que sí queda al
   descubierto —y va al done— es el alta que **nunca** llegó a subir y se replica cuando su hora ya
   pasó: ésa la rechaza el suelo, a propósito.

**Si aparece una decisión de producto que el prompt no cubre, paro y pregunto.** Hasta aquí no ha
aparecido ninguna: las siete de arriba son de implementación o están dictadas por el prompt.

---

## 4 · Orden de trabajo y commits (uno por frente cerrado)

| # | Frente | Commit |
|---|---|---|
| 0 | Este plan + la nota de B-6b en el prompt viejo | `docs(reservas-6a): plan del suelo y B-6b` |
| 1 | `floor.ts` + motor + rutas + tests del suelo, la simetría y la retícula | `feat(reservas-6a): el suelo temporal del motor` |
| 2 | Invariante 14 (`TZ=America/New_York` + 25-10-2026) | `test(reservas-6a): la agenda bajo otra TZ y el cambio de hora` |
| 3 | e2e contra Postgres real (EXCLUDE + suelo + lo que no toca) | `test(reservas-6a): el EXCLUDE y el suelo contra Postgres real` |
| 4 | Front + bucle visual | `feat(reservas-6a): la agenda no invita a una hora que ya pasó` |
| 5 | Tabla de sabotaje | `test(reservas-6a): tabla de sabotaje` |
| 6 | `reservas-6a-done.md` | `docs(reservas-6a): done` |

**NI PUSH NI DEPLOY.**

---

## 5 · Fuera de alcance (se respeta la valla del prompt)

Todo B-6b (registro de políticas, las siete reglas, ajustes, simulación, override auditado), el
horario del centro y los festivos (B-7), el panel de salud (B-9), bonos (B-8), Koibox (B-10), el ajv
global (D-4), `catalogDurationMin` (D-5), y los invariantes **2** (solape de recurso) y **4**
(buffers ≠ 0), que se van a 6b. El AP11 (hierro) está reservado para la pasada de B-5.
