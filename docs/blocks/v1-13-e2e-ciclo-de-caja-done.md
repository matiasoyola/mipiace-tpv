# v1.13 · e2e del ciclo de caja contra Postgres de verdad — DONE

Prompt: `docs/code-prompts/bloque-v1-13-e2e-ciclo-de-caja.md`.
Rama: `v1-13-e2e-ciclo-de-caja` (sobre la integración que ya lleva v1.11 y v1.12).
**Sin push** — el merge lo hace Matías.

El carryover de v1.11 lo decía con todas las letras: *"No hay e2e del ciclo
completo contra BD real. Los tests usan prisma falso."* Un job que cierra turnos
**solo, en producción, a las cinco de la mañana** y una imputación que decide a
qué turno pertenece cada venta que llega tarde estaban fijados por tests contra
un falso, pero nadie había visto el ciclo entero correr contra Postgres.

Este bloque traduce a test los ocho pasos de *"Cómo probarlo de cero"* del
done.md de v1.11 y —desde el addendum de abajo— el barrido de mesas que v1.12-B
enganchó a esa misma pasada. De `src/` se toca **una sola cosa**, y es para que
la suite pueda cubrir la pasada entera: extraer `runDayCutPass()` (ver el
addendum). El resto del diff es la suite, dos scripts y un job de CI.

---

## Estructura (qué se añadió)

**Nuevo:**

- `apps/api/test-e2e/ciclo-de-caja.e2e.ts` — la suite. 12 tests, un solo camino:
  el que hace Sole cada día.
- `apps/api/test-e2e/global-setup.ts` — `DROP SCHEMA public` + `prisma migrate
  deploy`. Migraciones **reales**, no `db push`: así el e2e prueba también la
  migración, incluido el backfill de `summary_ack_at` del addendum de v1.11.
- `apps/api/test-e2e/e2e-env.ts` — la puerta: variable de entorno, mensaje de
  salto y el guard de "esta base es desechable".
- `apps/api/vitest.e2e.config.ts` — config separada.
- `apps/api/src/shift/day-cut-pass.ts` — **`runDayCutPass()`**: LA pasada del
  corte, corte de caja + barrido de mesas, en un solo sitio. Lo llaman el worker
  y el e2e. Ver el addendum.

**Modificado:**

- `package.json` (raíz) — `test:e2e`.
- `apps/api/package.json` — `test:e2e`.
- `apps/api/tsconfig.json` — `include` cubre `test-e2e/`.
- `.github/workflows/ci.yml` — job `e2e`.
- `apps/api/src/workers/shift-day-cut-worker.ts` — deja de componer la pasada a
  mano y llama a `runDayCutPass()`. Mismo orden, mismo aislamiento, mismo
  `returnvalue`.

---

## La suite no se puede disparar por accidente

La variable es **`E2E_DATABASE_URL`**, no `DATABASE_URL`. El prompt decía
`DATABASE_URL`; se cambió a propósito y esta es la razón: la suite hace
`DROP SCHEMA public` antes de migrar, y `DATABASE_URL` la tiene exportada
cualquiera en su shell (y vive en `apps/api/.env`). Un `pnpm test:e2e`
despistado no puede costar la base de desarrollo de nadie. La variable nueva es
explícita: quien la pone sabe lo que hace.

Encima hay un segundo cinturón: si el nombre de la base no contiene `e2e` ni
`test`, la suite se niega a correr con un mensaje que lo dice. Se salta con
`E2E_ALLOW_ANY_DB=1` — a propósito, no por accidente.

Comportamiento sin la variable:

| Dónde | Qué pasa |
|---|---|
| Local | Se **salta** con las instrucciones de cómo levantarla. `pnpm vitest run` en el portátil sigue funcionando igual que siempre. |
| CI (`CI=true`) | **Falla.** Un e2e que se salta en verde es peor que no tenerlo: miente. |

Y los archivos se llaman `*.e2e.ts`, no `*.test.ts`: el `include` por defecto de
vitest —el que usa `pnpm vitest run`— no los recoge ni queriendo. Comprobado:
`vitest list --filesOnly` sigue devolviendo 144 archivos y ninguno es de
`test-e2e/`.

---

## Qué prueba, paso a paso

Todo contra `SELECT`s. **Ninguna aserción se hace contra la respuesta del API**
más allá del código de estado: si el test pudiera pasar con la BD vacía, no
sería un e2e.

1. **Abrir turno con fondo.** Tenant + tienda + caja + cajero + mesas sembrados
   a mano (es lo que deja el onboarding, no parte del ciclo diario); el turno se
   abre por `POST /shift/open` y se comprueba `cash_opening`, `closed_at` y
   `close_reason` en BD.
2. **Vender.** Dos tickets: 12,10 € en efectivo y uno mixto de 22,00 €
   (12,00 efectivo + 10,00 tarjeta). Verificado con
   `SELECT method, SUM(amount) FROM ticket_payments JOIN tickets …` → exactamente
   `{ CASH: 24.10, CARD: 10.00 }`, y `COUNT(*)`/`SUM(total)` sobre `tickets`.
3. **Abrir mesas** por `POST /tables/:id/open`: M1 vacía, M2 con una caña dentro
   (`POST /tables/:id/lines`), ambas con el `created_at` retrasado a antes del
   corte. M3 se abre también pero se queda con su fecha de hoy — es la del
   test 12.
4. **La pasada del corte**: `runDayCutPass(now)` con un `now` fabricado — no se
   espera a las cinco. Es **la misma función que llama el worker**, con el corte
   de caja y el barrido de mesas dentro y en ese orden (la caja primero). El turno
   queda `closeReason = AUTO_DAY_CUT`, `cash_counted` **NULL** (no 0),
   `closed_by_user_id` NULL, `summary_ack_at` NULL, y con su Z: la columna apunta
   a un PDF que **existe en disco** (`fs.access`). También se comprueba la
   decisión 2 de v1.11: `closed_at` es el `now` de la pasada, posterior al
   instante del corte, no retroactivo.
5. **El barrido de mesas de la misma pasada** (v1.12-B). M1: `status = VOIDED`,
   `void_reason = AUTO_ABANDONED_EMPTY`, `voided_by_user_id` **NULL** (SISTEMA),
   `voided_at` sellado y **la mesa libre** —comprobado como lo pinta el mapa: no
   queda ningún DRAFT colgando de esa `table_id`—. M2, de la misma antigüedad:
   sigue `DRAFT`, sin `void_reason`, con su línea dentro y su mesa ocupada. M3,
   la de hoy: intacta — el criterio es el corte, no "mesa vacía" a secas.
6. **Abrir el turno del día siguiente.**
7. **El caso offline de ANTES del corte.** Ticket con `occurredAt` de una hora
   antes del corte y el `shiftId` del turno ya cerrado: entra (201, no se
   pierde), va **al turno de ayer**, el efectivo de ayer sube a 30,15 €, el de
   hoy sigue vacío, el turno queda `z_report_stale = true` y el PDF emitido
   **no** se reescribe (misma ruta que antes).
8. **El caso offline de DESPUÉS del corte.** Mismo `shiftId` viejo,
   `occurredAt` posterior a la apertura del turno nuevo → entra en el turno
   nuevo y el de ayer no se mueve.
9. **`GET /shift/last-closed`** devuelve el resumen del turno anterior con las
   cifras de la BD (3 tickets, teórico 130,15 € = 100 de fondo + 30,15), y
   **después de `ack-summary` ya no lo devuelve**. Confirmar dos veces no mueve
   el sello (idempotente).
10. **`close-day`** cierra sin contar: `descuadre: null`, `cash_counted` NULL en
    BD, `close_reason = MANUAL` y `closed_by_user_id` con la firma de quién.
11. **El corte no pisa un cierre manual** que llegó durante la pasada (F2 del
    addendum 2 de v1.11).
12. **El barrido no pierde la línea que entra durante la carrera**: la primera
    línea de M3 se escribe entre la lectura del barrido y su reclamación. El
    `lines: { none: {} }` del `updateMany` la salva — draft vivo, línea dentro,
    mesa ocupada, `released` vacío.

### Dos desvíos del guion de v1.11, y por qué

**El orden de los pasos 6 y 7 está invertido.** El guion pone el caso offline
antes de abrir el turno nuevo. Así el test no probaría nada: con un solo turno
vivo, "el turno de la ventana" y "el turno abierto ahora mismo" dan el mismo
resultado y las dos reglas de `resolveShiftForSale` son indistinguibles. Con el
turno de hoy ya abierto, el ticket de antes del corte **tiene** que irse al de
ayer — y eso sí es una prueba.

**El turno se abre por API y se retrasa su `opened_at` 30 horas con un UPDATE.**
Es el único viaje en el tiempo de la suite y toca un solo campo. La alternativa
—fabricar un `now` en el futuro— rompe la tolerancia de reloj de
`parseOccurredAt` (5 min), que compara contra el reloj de verdad: los tickets
"offline" quedarían descartados por skew y el test probaría otra cosa.

---

## El criterio de "funciona": se rompió a propósito y se puso rojo

Cada pieza, una a una, con la suite entera corriendo detrás:

| Sabotaje | Resultado |
|---|---|
| Quitar el guard `closedAt: null` de la reclamación (`day-cut-run.ts`) | 🔴 **1 fallo** — test 11: `expected [ { …(9) } ] to deeply equal []`. El corte reclama un turno que ya había cerrado una persona. |
| Saltarse la regla de ventana en `resolveShiftForSale` y caer al "turno abierto ahora" | 🔴 **3 fallos** — tests 7, 8 y 9. La venta de antes del corte se va al turno de hoy, el efectivo de ayer se queda en 24,10 € y `zReportStale` no se marca. |
| Quitar el `requireEmpty` del barrido (`abandoned.ts`) | 🔴 **1 fallo** — test 12: `expected [ { …(6) } ] to deeply equal []`. La comanda que el camarero acaba de teclear se anula. |
| Quitar del barrido el `if (draft._count.lines > 0) continue` | 🔴 **1 fallo** — test 5: `expected +0 to be 1`. Se anula la mesa con consumo dentro. |
| Borrar la llamada al barrido dentro de `runDayCutPass()` | 🔴 **2 fallos** — test 5 (`expected null not to be null`) y, de rebote, test 12. La pasada cierra turnos y deja el mapa de sala lleno de mesas zombi. |

Los cuatro archivos se restauraron después: los sabotajes no dejan rastro en el
diff del bloque.

Los tests 11 y 12 merecen una nota: **las dos carreras se provocan en el borde**
—un `Proxy` sobre una sola llamada de Prisma— pero el resto es la BD de verdad y
la escritura que causa la carrera es real.

- Test 11: el `Proxy` va sobre el `findMany` del job y escribe el cierre manual
  en Postgres antes de devolver la foto vieja. Es exactamente lo que ve el job
  en producción: una lista de turnos abiertos que ya no es cierta.
- Test 12: el `Proxy` va sobre el `updateMany` de tickets e inserta la primera
  línea justo antes de que llegue la reclamación — la ventana precisa que el
  `lines: { none: {} }` tiene que cubrir. El guard de lectura de
  `voidDraftTicket` (`_count.lines > 0`) ya ha pasado a esas alturas, así que lo
  que se prueba es el WHERE y no el `if`.

Sin esos dos tests, los sabotajes correspondientes salían **verdes**: el resto
del ciclo no los toca.

---

## Cuánto tarda

Mac (M-series, Docker Desktop, Postgres 16 en contenedor):

| | Tiempo |
|---|---|
| Pasada completa (`pnpm test:e2e`) | **~7,5–9 s** de reloj |
| De eso, `DROP SCHEMA` + `prisma migrate deploy` (50 migraciones) | ~4 s |
| Los 12 tests | ~1,1 s |

En CI hay que sumar `pnpm install` y `prisma generate` — el job `e2e` viene a
costar lo mismo que el `ci` menos las builds de Vite. No bloquea `publish`.

Para referencia, la suite de siempre sigue igual: `pnpm vitest run` →
**144 archivos, 1228 pasan, 3 skipped, 0 fallos**. Typecheck de `apps/api`
limpio con `test-e2e/` dentro del `include`.

---

## Cómo correrla en local

```bash
# 1. Postgres (el compose de siempre)
docker compose up -d postgres

# 2. Una base DESECHABLE, una sola vez
docker compose exec -T postgres psql -U mipiacetpv -c "CREATE DATABASE mipiacetpv_e2e;"

# 3. Cliente de Prisma generado (si no lo está ya)
pnpm db:generate

# 4. La suite
E2E_DATABASE_URL='postgresql://mipiacetpv:mipiacetpv_dev@127.0.0.1:5432/mipiacetpv_e2e' pnpm test:e2e
```

La suite **borra el esquema** de esa base en cada pasada. No hace falta limpiar
nada entre ejecuciones ni levantar Redis: el encolado BullMQ está mockeado en el
borde, igual que en el resto de tests.

Sin la variable, `pnpm test:e2e` se salta e imprime estos mismos pasos.

---

## Decisiones tomadas sin preguntar

1. **`E2E_DATABASE_URL` en vez de `DATABASE_URL`** (ver arriba). Es el único
   punto donde el bloque se aparta de la letra del prompt, y es por seguridad.
2. **Guard de nombre de base desechable** (`e2e`/`test`), con escape explícito.
   Coste: cuatro líneas. Beneficio: nadie borra su catálogo por un shell con la
   variable puesta.
3. **Falla en CI si falta la variable.** "Se salta con un mensaje claro" es
   correcto en el portátil; en CI sería un verde que miente, y el bloque va
   justo de eso.
4. **Extensión `.e2e.ts`, no `.test.ts`.** Garantía estructural de que
   `pnpm vitest run` nunca los recoge — mejor que un `exclude` que alguien
   puede tocar sin darse cuenta.
5. **Sin Redis en el job de CI.** Los tres encolados del camino
   (`ticket-upload`, `refund-upload`, `ticket-email`) están mockeados como en el
   resto de la suite. Levantar un Redis que nadie toca es ruido; si algún día el
   e2e prueba el worker de subida, se añade entonces.
6. **La sesión de cajero se firma directa, sin pasar por `cashier-login`.** Ese
   camino (device token, PIN, rate-limit en Redis) tiene sus propios tests y no
   es el ciclo de caja. Meterlo aquí habría obligado a levantar Redis para
   probar otra cosa.
7. **El job `e2e` no entra en `needs` de `publish`.** Lo pedía el prompt: no
   bloquea el despliegue mientras se estabiliza, pero se ve rojo en el PR.
8. **Tests 11 y 12 (las dos carreras) añadidos aunque no estaban en los pasos.**
   Sin ellos, los sabotajes que el propio criterio de aceptación propone salían
   verdes. El criterio manda sobre la lista.
9. **`runDayCutPass()` extraído a `src/`** — la única línea de `src/` que toca
   el bloque, y la razón está en el addendum 2: la composición corte + barrido
   vivía dentro del handler del worker, donde ningún test podía llegar sin
   Redis. Desconectar el barrido no rompía nada y el fallo tardaba semanas en
   verse, en forma de mapa de sala con mesas zombi. Ahora la pasada es una
   función que llaman los dos.


---

## Fuera de alcance, respetado

- Playwright, navegador, cualquier cosa que toque el TPV. Esto es API + BD.
- Holded: mockeado en el borde. Aquí no se prueba el ERP.
- Reescribir tests existentes: se **añade** una suite, no se migra nada. El
  diff no toca `apps/api/test/`.

Del barrido de v1.12-B se prueba lo que corre en la pasada del corte. **NO** se
prueba aquí, y a propósito:

- `listAbandonedTables` y el botón "Anular" del admin con PIN. No corren en la
  pasada: son una pantalla y una acción de una persona. Tienen sus tests.
- El `?onlyIfEmpty=true` del `DELETE /tickets/:id` (addendum de v1.12-B). Es el
  camino del TPV al salir de una mesa, no el del corte de día.
- El evento `table.cleared` del bus in-memory. Desde el worker no llega a nadie
  —proceso distinto, el propio código lo dice— así que afirmarlo en el e2e sería
  afirmar algo que en producción no pasa.

---

## Dudas abiertas / carryover

0. **Lo que queda del worker sigue sin cubrir**: el `repeatable` de BullMQ (que
   la pasada se dispare cada hora con `tz: Europe/Madrid`) y el envío a Sentry
   del `tablesError`. Con `runDayCutPass()` extraído, lo que queda en el handler
   es encolado y reporte — pedir Redis en el e2e para probar eso no compensa.
1. **El e2e no prueba refunds ni el arqueo por denominaciones.** El ciclo del
   prompt no los incluye. `cash-count` con `kind: "X"` sobre un turno
   auto-cerrado —el "cuadrar caja" de la mañana siguiente— sigue cubierto sólo
   por tests con prisma falso.
2. **Un solo tenant y una sola caja.** La pasada del corte escanea *todos* los
   turnos abiertos; que no toque los de otro tenant con `dayCutHour` distinto no
   se prueba aquí (sí en `shift-day-cut-run.test.ts`).
3. **El DST no se prueba contra BD.** Los dos cambios de hora de 2026 están
   cubiertos por los tests puros de `day-cut.ts`, que es donde viven las
   aristas. Reproducirlos en el e2e exigiría fabricar `now` en el futuro, y eso
   choca con la tolerancia de `occurredAt` (ver arriba).
4. **El job `e2e` reinstala dependencias.** Comparte la cache de pnpm con `ci`,
   pero no su `node_modules`. Si el minuto extra molesta, cabe fusionarlo con
   `ci` añadiéndole el servicio de Postgres — a costa de que un e2e inestable
   bloquee `publish`, que es justo lo que el prompt pedía evitar.
5. **El PDF del Z sólo se comprueba que existe**, no su contenido. Verificar que
   el Z de un corte automático dice lo que tiene que decir sigue siendo la duda
   1 del carryover de v1.11 y necesita ver un Z real primero.

---

# Addendum · el barrido de mesas de v1.12-B (review de Matías)

**Lo que faltaba.** La primera entrega cubría el corte de día de v1.11 y ni
tocaba ni declaraba el barrido de mesas abandonadas de v1.12-B, que corre en
**la misma pasada**: `shift-day-cut-worker.ts` encadena `runShiftDayCut` y
`runAbandonedTableSweep` dentro del mismo job. La suite ejecutaba la primera
mitad de la pasada y llamaba a eso "el ciclo entero". Cero aserciones sobre
mesas y cero líneas en "fuera de alcance": el peor de los dos mundos, porque
leyendo el done.md parecía cubierto.

**Lo que se añadió** (`+3` tests, 9 → 12):

- **Test 3** — dos mesas abiertas por `POST /tables/:id/open` antes del corte:
  M1 vacía y M2 con una caña. Más M3, que se queda con fecha de hoy.
- **Test 5** — el barrido de la misma pasada: M1 anulada
  (`AUTO_ABANDONED_EMPTY`, `voided_by_user_id` NULL, mesa libre), M2 intacta con
  su línea y su mesa ocupada, M3 sin tocar.
- **Test 12** — la carrera del `lines: { none: {} }`: la primera línea entra
  entre la lectura del barrido y su reclamación, y la comanda sobrevive.

**Criterio de "funciona", aplicado igual que a los otros dos:** quitar el
`requireEmpty` del barrido pone **rojo el test 12**; quitar además el
`if (draft._count.lines > 0) continue` pone **rojo el test 5**. Los dos
sabotajes se ejecutaron y `abandoned.ts` se restauró después (ver la tabla de
sabotajes arriba).

**Lo que sigue sin cubrirse, ahora sí escrito:** la lista del admin, el
`onlyIfEmpty` del DELETE y el evento del bus quedan en "fuera de alcance" con su
motivo.

---

# Addendum 2 · `runDayCutPass()` (review de Matías, antes del commit)

El addendum 1 dejaba un hueco declarado como carryover: el e2e encadenaba
`runShiftDayCut` y `runAbandonedTableSweep` a mano porque la composición sólo
existía dentro del handler de `shift-day-cut-worker.ts`, y llegar ahí exige
Redis y BullMQ. Se cierra ahora, y el motivo es que **el fallo que ese hueco no
detecta es el invisible**: si alguien desconecta el barrido del worker, la suite
sigue verde y te enteras semanas después con un bar lleno de mesas zombi — que
es literalmente lo que pasó en Sirope (cuatro mesas ocupadas desde el 9 de
julio, encontradas el 20 de agosto mirando la BD a mano).

**`apps/api/src/shift/day-cut-pass.ts`** — nuevo. `runDayCutPass({ prisma, log,
now })`: cierra los turnos que cruzaron el corte y, detrás, suelta las mesas
abandonadas. Devuelve `{ shifts, tables, tablesError }`. Es mover código: el
orden (la caja primero) y el aislamiento (si el barrido peta, los turnos ya
están cerrados) son los de v1.12-B sin tocar. Lo único que cambia de forma es
que el error del barrido se **devuelve** en vez de reportarse ahí mismo — Sentry
es cosa del worker, no de la pasada.

- `shift-day-cut-worker.ts` ya no compone nada: llama a `runDayCutPass()` y
  manda `tablesError` a Sentry si viene. El `returnvalue` del job no cambia.
- El e2e (test 4) llama a **esa misma función** en vez de reconstruir la
  cadena.

**Cierre del criterio:** borrar la llamada al barrido dentro de
`runDayCutPass()` pone **rojo el test 5** (`expected null not to be null`) y, de
rebote, el 12. El hueco ya no existe. Es la tercera fila de la tabla de
sabotajes.

**Puertas tras el refactor:** e2e 12/12, `pnpm test` 144 archivos / 1228 pasan /
3 skipped / 0 fallos, `tsc --noEmit` limpio. Y el sabotaje del test 5 (quitar el
guard de líneas del barrido) sigue poniéndose rojo igual que antes.
