# v1.11 · Cierre de día automático — DONE

Prompt: `docs/code-prompts/bloque-v1-11-cierre-de-dia.md` (addendum incluido).
Rama: `v1-11-cierre-de-dia`, worktree `../mipiacetpv-v1-11-cierre`. **Sin push**
— el merge lo hace Matías.

El addendum fijó el encuadre y se respetó al pie: **el resumen ya estaba
construido**. `z-breakdown.ts` calculaba desde v1.0-pilotos el desglose por
método (bruto · devoluciones · neto) y el efectivo teórico del cajón. El
bloque no era construirlo: era **invertir el orden** y **quitar el arqueo
obligatorio antes de la primera venta**.

---

## Estructura (qué se tocó)

### Backend (`apps/api`)

**Nuevo:**
- `src/shift/day-cut.ts` — funciones **puras** del corte: `lastDayCutBefore`,
  `shiftCrossedDayCut`, `previousWallDate`, `normalizeDayCutHour`. Reutiliza
  `agenda/time.ts` (`wallTimeToUtc`/`utcToWallDate`) tal y como pedía el
  prompt. Todo lo que tiene aristas de verdad vive aquí y se testea sin BD.
- `src/shift/day-cut-run.ts` — la pasada: busca turnos abiertos, compara cada
  uno con la hora de corte de **su** tenant, cierra, genera el Z. Un turno que
  falla no aborta los demás.
- `src/queues/shift-day-cut.ts` + `src/workers/shift-day-cut-worker.ts` —
  repeatable BullMQ global, cron `0 * * * *` con `tz: Europe/Madrid`. Mismo
  patrón que `agenda-hold-ttl` y `reconciliation` (ADR-005). Registrado en
  `workers/index.ts` y, embebido, en `server.ts` para poder probarlo en dev.
- `src/shift/summary.ts` — `buildShiftDaySummary`: **un solo cálculo** para los
  cuatro consumidores del resumen (previsualizar, cerrar, tarjeta de la
  mañana, log del job).
- `src/shift/impute.ts` — `pickShiftForOccurrence` (pura) y
  `resolveShiftForSale`. **La pieza delicada del bloque**; ver más abajo.
- `src/shift/breakdown-sums.ts` — `loadShiftBreakdownSums` extraída de
  `routes.ts` **sin cambios de lógica**: ahora la necesitan tres caminos (Z, X
  y el job, que corre en el worker y no puede importar el módulo de rutas).

**Modificado:**
- `src/shift/routes.ts` — cuatro rutas nuevas y un cierre que ya no exige contar:
  - `POST /shift/:id/resume` — reanudar (refresca `lastActivityAt`).
  - `GET  /shift/:id/summary` — resumen de un turno, abierto o cerrado.
  - `GET  /shift/last-closed` — último turno cerrado **sin confirmar** de la caja.
  - `POST /shift/:id/close-day` — cerrar **sin contar**. Delega en
    `executeShiftClose` (mismos guards: tenant, sync, PIN).
  - `POST /shift/:id/ack-summary` — sella `summaryAckAt`, idempotente.
  - `executeShiftClose` acepta `cashCounted: number | null`; con `null` guarda
    `cashCounted = NULL` y devuelve `descuadre: null`.
  - Guard nuevo `409 CASH_COUNT_REQUIRED` cuando el tenant exige arqueo.
  - `POST /shift/:id/cash-count` acepta `kind: "X"` sobre un turno cerrado
    **por el corte de día**: es el "cuadrar caja" a posteriori de la mañana
    siguiente. Fija `cashCounted` si nadie había contado.
- `src/tickets/routes.ts` — `occurredAt` opcional en `POST /tickets` y
  `POST /refunds`; el gate `closedAt: null` pasa a `resolveShiftForSale`.
- `src/admin/tenant-settings.ts`, `src/devices/routes.ts`,
  `src/shift/cashier-auth.ts` — exponen `dayCutHour` y
  `requireCashCountOnClose` (device-me y paquete offline, para que el TPV lo
  sepa también sin red).

### BD (`packages/db`)
`migrations/20260820000000_v1_11_cierre_de_dia/` — **aditiva**, todo con
default, backfill implícito:
- `tenants.day_cut_hour INT NOT NULL DEFAULT 5`
- `tenants.require_cash_count_on_close BOOLEAN NOT NULL DEFAULT false`
- `shifts.close_reason ShiftCloseReason NOT NULL DEFAULT 'MANUAL'`
- `shifts.summary_ack_at TIMESTAMPTZ NULL`
- `shifts.z_report_stale BOOLEAN NOT NULL DEFAULT false`

No hizo falta índice nuevo: `(register_id, closed_at)` ya cubre los dos
accesos que añade el bloque.

### Frontend TPV (`apps/tpv-web`)
- `src/pages/DaySummaryCard.tsx` — **nuevo**, la tarjeta. Es la pantalla del
  bloque.
- `src/pages/ShiftResumeScreen.tsx` — **era `ShiftForceCloseScreen`**
  (renombrado con `git mv`, historia conservada). "Reanudar turno" primario.
- `src/pages/CloseShiftModal.tsx` — reescrito en tres fases
  (`summary → count → done`). Preserva íntegro el arqueo X, el cierre offline
  de v1.10 y todo el manejo de SYNC_PENDING / PIN.
- `src/lib/shiftSummary.ts` — **nuevo**: tipos, fetchers y el resumen local
  para cuando no hay red.
- `src/lib/outbox.ts` — sella `occurredAt` al **encolar** ticket/refund.
- `src/App.tsx` — `ShiftOpenWithDaySummary`: la tarjeta de la mañana antes de
  pedir el fondo de caja del turno nuevo.
- `src/hooks/useDeviceBootstrap.ts` — `requireCashCountOnClose` en el tenant
  cacheado (opcional: un device bootstrapeado antes de v1.11 lo lee como
  `false`, que es el default nuevo).
- **Borrado `src/pages/ShiftActiveScreen.tsx`.** Código muerto desde B4 (nadie
  lo importaba) que contenía **un tercer camino de cierre** con un campo de
  efectivo a pelo. Dejar viva una tercera variante justo en el bloque que
  unifica los caminos de cierre habría sido una trampa. Está en git.

### Admin (`apps/admin`)
- `SettingsPage.tsx` — sección **"Cierre del día"**: hora del corte (slider
  0–23) y el toggle de arqueo obligatorio, con el copy explicando que está
  apagado a propósito.

### Docs
- `docs/04-stack-y-decisiones.md` — **ADR-012**.
- `docs/blocks/v1-11-cierre-shots/` — capturas del bucle visual.
- `.gitignore` — `storage/`. Los tests instancian el generador de Z de verdad
  y dejaban PDFs en el árbol de trabajo (pre-existente, no lo introduce este
  bloque; se ignora ahora que hay un test más que los genera).

---

## Lo delicado: terminal offline a la hora del corte

El prompt avisaba de que si no estaba claro había que parar y preguntar. Sí
estaba claro, y es lo siguiente.

**El problema.** A las 05:00 el servidor cierra el turno. Si el terminal está
sin red y sigue vendiendo contra ese turno, al reconectar su outbox sube
tickets con el `shiftId` de un turno **ya cerrado**. Hasta v1.10 eso era
`409 SHIFT_NOT_OPEN`, que `isPermanentRejection` clasifica como rechazo
definitivo: la venta quedaba visible en el chip de pendientes y **no se
registraba**. Cerrar solos los turnos sin resolver esto habría convertido un
peaje molesto en **ventas perdidas**.

**La solución, la del prompt:** el ticket se imputa al turno que le
corresponde **por su timestamp**, no al turno abierto en ese momento.

- El outbox sella `occurredAt` **al encolar** (cuando el cajero pulsó Cobrar),
  no al hacer el POST. Los reintentos reusan el mismo valor, igual que el
  `externalId`.
- `resolveShiftForSale` busca el turno de esa caja cuya ventana
  `[openedAt, closedAt)` contiene el instante. Semiabierta por arriba: una
  venta sellada justo en el cierre pertenece al turno **siguiente**.
- Si la ventana no resuelve, en este orden: turno abierto ahora → el propio
  turno auto-cerrado. **Cero ventas perdidas gana a un Z que cuadre.**
- Un turno cerrado **a mano** no entra en ese rescate: ahí no hubo automatismo
  que sorprendiera a nadie y el 409 histórico se mantiene.
- Cuando la venta cae en un turno con Z ya archivado, el turno queda
  `zReportStale = true` y **la tarjeta lo dice**. El PDF emitido no se
  reescribe.

**Duplicar el cierre no puede pasar** y no hizo falta tocar nada: el outbox de
v1.10 ya trata `409 SHIFT_ALREADY_CLOSED` / `Z_ALREADY_EXISTS` como éxito
idempotente. El `shift-open` encolado offline tampoco choca: tras el
auto-cierre no hay turno abierto, así que abre limpio.

**El offline de v1.10 no se rompe:** sin red, `CloseShiftModal` va derecho a la
tabla de denominaciones con el resumen **local** (fondo de caja + efectivo de
la cola), etiquetado como lo que es —incompleto, sin conexión— en vez de
fingir un total del día que el dispositivo no puede conocer.

---

## Decisiones tomadas sin preguntar (una a una)

1. **`closeReason` en vez de `closedBy: AUTO_DAY_CUT`.** El prompt decía
   "`closedBy: AUTO_DAY_CUT` o equivalente"; `Shift.closedBy` ya existe como
   relación al `User` que cerró. Columna nueva `close_reason`: `closed_by_user_id`
   dice **quién** (NULL cuando cierra el job), `close_reason` dice **por qué**.

2. **El corte cierra con `closedAt = now`, no con el instante del corte.** Si
   el worker estuvo caído dos días, estampar un `closedAt` retroactivo dejaría
   tickets posteriores dentro de un turno "cerrado antes". `now` es la verdad:
   el servidor lo cerró ahora.

3. **`cashCounted = NULL`, no 0.** Un descuadre de 0,00 € que nadie ha
   verificado es una mentira cómoda. El resumen distingue "no se contó" de "se
   contó y dio cero" en el texto y en el detalle.

4. **El Z automático imprime el teórico en "cash contado".** El generador de
   PDF no sabe de nulos y cambiar su contrato quedaba fuera de alcance; con
   teórico == contado el descuadre sale 0,00 €, que no afirma ni sobrante ni
   faltante. El PDF lleva además `closedByLabel: "Cierre automático por corte
   de día"`. La distinción fina vive en el resumen del TPV, que es donde la
   lee una persona.

5. **Cron horario, no cada minuto.** `dayCutHour` es una hora entera, así que
   una pasada por hora local basta. La `tz` del repeat es lo que mantiene el
   corte local en el cambio de hora sin que el job tenga que saber nada.

6. **Arqueo a posteriori (`kind: "X"` sobre turno auto-cerrado).** Sin esto,
   "Cuadrar caja" en la tarjeta de la mañana no tendría dónde escribir y el
   descuadre de un turno auto-cerrado quedaría desconocido para siempre. Sólo
   X, sólo `AUTO_DAY_CUT`, y no pisa un conteo previo.

7. **`summaryAckAt`.** El prompt pedía "un único botón: Confirmar". Confirmar
   tiene que **significar** algo o la tarjeta reaparecería cada mañana. Sella
   en el server, así que no depende del estado del cliente.

8. **`zReportStale`.** Coste: una columna. Beneficio: no publicar un resumen
   que sabemos desfasado. El bloque va de decir la verdad sobre la caja.

9. **La imputación de refunds sólo consulta la ventana si viene `occurredAt`.**
   El camino online conserva exactamente la query de una fila de antes — ni
   una query extra en el caso normal.

10. **Borrar `ShiftActiveScreen.tsx`** (ver arriba).

11. **`requireCashCountOnClose` viaja en `device-me` y en el paquete offline.**
    Si no, un terminal sin red no sabría si su negocio exige arqueo.

---

## Qué quedó hecho vs. alcance

| Alcance del prompt | Estado |
|---|---|
| 1 · El turno deja de ser un muro | ✅ `ShiftResumeScreen`, reanudar primario |
| 2 · Cierre automático por corte de día | ✅ job + `dayCutHour` + `AUTO_DAY_CUT` |
| 2 · Corte local, no UTC | ✅ reutiliza `agenda/time.ts`; test de los dos DST |
| 2 · Terminal offline sin perder ni duplicar | ✅ `impute.ts` + idempotencia v1.10 |
| 3 · Resumen del día, no arqueo a ciegas | ✅ `DaySummaryCard`, un botón |
| 3 · Cifras trazables | ✅ "Ver detalle" abre el desglose que las produce |
| 4 · `requireCashCountOnClose`, default false | ✅ + UI de admin |
| 5 · Mini-ADR | ✅ ADR-012 |
| Migración aditiva, multi-tenant por fila | ✅ |
| No tocar el camino de cobro (ADR-010) | ✅ sólo el gate de turno de `POST /tickets` |
| No inventar lógica fiscal | ✅ el Z sigue siendo gestión (ADR-008) |
| Bucle visual | ✅ 320 / 390 / 1280, error y pantalla final |

**Fuera de alcance, respetado:** cita→caja (serie R), informes multi-día,
dashboards, cambiar el modelo de turnos, notificaciones/email del resumen.

---

## Tests

`pnpm vitest run` → **135 archivos, 1132 pasan, 3 skipped, 0 fallos.**

Nuevos:
- `apps/api/test/shift-day-cut.test.ts` (14) — la conversión de hora local,
  incluidos **los dos cambios de hora de 2026**: el 29/03 (día de 23 h) y el
  25/10 (día de 25 h). Restar 24 h en vez de ir por hora de pared cerraría un
  turno vivo una hora antes de tiempo.
- `apps/api/test/shift-impute-offline.test.ts` (9) — a qué turno pertenece una
  venta que llega tarde.
- `apps/api/test/shift-day-cut-run.test.ts` (9) — la pasada y el rescate contra
  un prisma falso: `cashCounted` NULL, `closedByUserId` NULL, no toca el turno
  de hoy, un fallo no arrastra a los demás, y las cinco ramas de
  `resolveShiftForSale`.
- `apps/tpv-web/test/shift-resume-screen.test.tsx` (8) — reanudar sin cerrar,
  el resumen antes del arqueo, y **la regresión de v1.5-hotfix2 en su casa
  nueva** (SYNC_PENDING: lista, checkbox, botón bloqueado, reenvío).

Tocados:
- `apps/tpv-web/test/outbox.test.ts` — +4: el sellado de `occurredAt`.
- `apps/tpv-web/test/close-shift-reason.test.tsx` — adaptado a las fases
  nuevas; +1 caso con arqueo obligatorio.
- **Borrado** `shift-force-close-sync-pending.test.tsx` — su pantalla ya no
  existe; lo que guardaba se cubre en `shift-resume-screen.test.tsx`.

Typecheck limpio en `apps/api`, `apps/tpv-web` y `apps/admin`.

---

## Bucle visual

Chrome real (Playwright) contra `vite dev`, con un harness temporal que
renderiza las pantallas con datos fijos y un `fetch` de mentira. El harness
**no se commitea**; las capturas sí, en `docs/blocks/v1-11-cierre-shots/`.

- `390-1-reanudar.png` · la pantalla que sustituye al muro.
- `390-2-resumen-manana.png` · la tarjeta del día auto-cerrado.
- `390-3-cerrar-el-dia.png` · el cierre desde el menú, ya invertido.
- `390-4-cuadrar-caja.png` · la tabla de siempre, con el esperado delante.
- `390-5-error-sync-pending.png` · estado de error.
- `390-6-turno-cerrado.png` · pantalla final.
- `320-1..3` · el ancho tacaño.
- `1280-1-cerrar-el-dia.png`, `1280-2-ver-detalle.png` · escritorio y
  auditabilidad.

Verificado en el navegador, no a ojo:
- `documentElement.scrollWidth === clientWidth` a **320 px** en la tarjeta y en
  la tabla de arqueo (sin scroll horizontal de página; la tabla scrollea
  dentro de su contenedor).
- Ningún `button` ni `input` por debajo de **44 px** de alto a 320 px. Los
  inputs de denominación subieron de `h-9` (36 px) a `h-11` (44 px).
- Todos los importes con `tabular-nums`.

**Arreglo salido del bucle:** a 320 px, "Efectivo esperado en el cajón ·
362,40 €" partía el importe y dejaba el "€" solo en la línea siguiente — se
lee como otra cifra. Corregido con `whitespace-nowrap` + `shrink-0` en los
importes y `min-w-0` en las etiquetas. Sin el bucle visual no se ve.

---

## Dudas abiertas / carryover

1. **El Z automático no distingue "no contado" en el PDF** (decisión 4). Si al
   ver el primer Z real de un corte automático el PDF resulta confuso, tocar
   `ZReportInput.cashCounted` para aceptar `null` es un cambio pequeño.
2. **`dayCutHour` es por tenant, la tz es global** (`Europe/Madrid`,
   `CENTER_TZ`). Correcto hoy; el día que haya un cliente en Canarias hace
   falta `Tenant.timezone` — y entonces también lo necesita la agenda.
3. **El job escanea todos los turnos abiertos cada hora.** Con el volumen
   actual sobra. Si crece, el filtro por `openedAt` se puede empujar a la
   query, pero requiere resolver la hora de corte por tenant en SQL.
4. **No hay e2e del ciclo completo contra BD real.** Los tests usan prisma
   falso. La pasada contra Postgres queda en la checklist manual de abajo.
5. **`GET /shift/last-closed` se consulta en cada apertura de turno.** Una
   query indexada; si molesta, cabe en el propio `cashier-login`.

---

## Cómo probarlo de cero

1. `pnpm install && pnpm db:generate && pnpm db:migrate`.
2. Arrancar api (`pnpm dev:api`) y TPV (`pnpm dev:tpv`). En dev el worker del
   corte va embebido.
3. **El muro:** con un turno abierto de ayer, entrar con PIN. Sale *Tienes el
   turno de ayer abierto*. Pulsar **Reanudar turno** → a vender. **Este es el
   criterio principal del bloque: se vende sin arquear.**
4. **El corte:** poner `dayCutHour` a la hora siguiente desde Ajustes (o
   encolar el job a mano), esperar a la pasada en punto. El turno aparece
   cerrado con su Z y `closeReason = AUTO_DAY_CUT`.
5. **El resumen:** volver a entrar. Antes de pedir el fondo de caja sale *Así
   fue el día de ayer* con el desglose. Comprobar contra la BD:
   `SELECT method, SUM(amount) FROM ticket_payments ...`.
6. **Contar es opcional:** *Cuadrar caja* abre la tabla de 15 denominaciones
   con el esperado delante; registra el descuadre. Y *Confirmar* sin contar
   también cierra.
7. **El arqueo obligatorio:** encender `requireCashCountOnClose` en Ajustes →
   el cierre entra directo por la tabla y `close-day` responde 409.
8. **Offline:** modo avión, vender, forzar el corte en el server, recuperar
   red. Las ventas de antes del corte aparecen en el turno de ayer, las de
   después en el nuevo, ninguna rechazada, y el turno afectado enseña el aviso
   de Z desfasado.
