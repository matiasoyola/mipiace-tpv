# Bloque v1.11 · Addendum 2 — correcciones de la review

> Contexto: el bloque está hecho en `v1-11-cierre-de-dia` (`049e9eb`), sin push. Review de Matías (2026-08-26).
> El bloque se acepta: el encuadre es correcto, la imputación por `occurredAt` está bien resuelta y los tests
> del DST son los que había que escribir. **No se toca nada de lo que ya está bien.** Esto son cuatro
> correcciones, en orden de valor, sobre la misma rama.
>
> Regla del repo: no `push`, no merge. Al terminar, actualizar `docs/blocks/v1-11-cierre-de-dia-done.md`.

---

## F1 · "Así fue el día de ayer" miente todas las semanas (BLOQUEANTE)

`App.tsx:743` pasa `title="Así fue el día de ayer"` fijo, y `GET /shift/last-closed` devuelve el último turno
cerrado sin confirmar **sin ningún límite temporal**. Dos consecuencias, las dos reales:

1. **Cualquier negocio con día de cierre.** Sole libra domingo y lunes: el martes por la mañana la tarjeta
   dirá *"el día de ayer"* sobre el sábado. No es un caso raro, pasa **cada semana** en casi todos los
   clientes.
2. **El primer arranque tras desplegar.** La migración añade `summary_ack_at` en NULL para **todas** las filas
   existentes. Cafetería Sirope tiene turnos cerrados de hace semanas: el primer login después del deploy
   enseña *"Así fue el día de ayer"* sobre un turno del 9 de julio. Es exactamente el fallo que salió en la
   validación del 2026-08-20 ("ayer" que eran 41 días).

**Qué hacer:**

- **Backfill en la migración** (todavía no ha corrido en ningún sitio, así que se edita el fichero, no se añade
  otra): al final de `20260820000000_v1_11_cierre_de_dia/migration.sql`,
  `UPDATE "shifts" SET "summary_ack_at" = "closed_at" WHERE "closed_at" IS NOT NULL;`
  Con un comentario que diga por qué: la tarjeta es para los cierres a partir de v1.11; el pasado ya no se
  confirma.
- **El título sale de `closedAt`, no de una constante.** Función pura, testeada, en `apps/tpv-web/src/lib/`
  (junto a `shiftSummary.ts`), con fecha de pared local:
  - cerrado ayer → `Así fue el día de ayer`
  - cerrado hoy → `Así fue el turno de hoy`
  - cualquier otro día → `Así fue el sábado 22 de agosto` (y con más de ~7 días, la fecha completa).
  Test de la función con los tres casos y con el cambio de hora, que ya sabéis que muerde.
- **`GET /shift/last-closed`** se queda como está una vez hecho el backfill. No metáis un filtro por días: si
  un terminal no abre en tres semanas, el resumen de su último día **sí** hay que enseñarlo — con su fecha
  bien dicha.

---

## F2 · El corte puede pisar un cierre manual (corrección real, 3 líneas)

`day-cut-run.ts` lee los turnos abiertos al principio de la pasada y luego, por cada uno, genera el PDF del Z
(segundos) antes de escribir. El `prisma.shift.update({ where: { id } })` final **no comprueba que el turno
siga abierto**. Si un cajero cierra a mano en esa ventana, el job le sobrescribe el cierre: `closedAt` movido,
`closedByUserId` a NULL, `closeReason = AUTO_DAY_CUT`, `zReportPdfPath` apuntando al PDF automático — mientras
`cashCounted` conserva el conteo de la persona. Resultado: un Z archivado que dice "teórico == contado,
descuadre 0,00 €" sobre un turno que alguien **sí** contó. El bloque va de no mentir sobre la caja; esto miente.

**Qué hacer:** cambiar el `update` por un `updateMany` con `where: { id: shift.id, closedAt: null }`. Si
`count === 0`, el turno lo cerró una persona mientras corría la pasada: no cuenta como `closed`, se registra
`log.info({ event: "shift.day_cut.raced", shiftId })` y **se descarta el PDF generado** (no se escribe la ruta;
si el fichero ya está en disco, borrarlo o dejarlo huérfano documentado, lo que sea más simple). Test contra el
prisma falso: turno que se cierra entre la lectura y la escritura → cero cambios, cero outcome.

---

## F3 · `occurredAt` del futuro (barato, evita un susto raro)

`resolveShiftForSale` se fía del `occurredAt` que manda el terminal. Un tablet con el reloj adelantado —pasa
tras quedarse sin batería— puede caer en la ventana de un turno posterior o salirse de las 50 candidatas.
Hacia atrás está acotado (`openedAt >= requested.openedAt`), hacia adelante no.

**Qué hacer:** en `POST /tickets` y `POST /refunds`, ignorar `occurredAt` si es posterior a `now + 5 min` (y
loguearlo, `event: "ticket.occurred_at_skew"`). Ignorarlo significa caer al camino de siempre, no rechazar la
venta. Un test en `shift-impute-offline.test.ts`.

---

## F4 · Dos cabos sueltos de contrato/docs

- **`imputedShiftId` no lo lee nadie.** `POST /tickets` lo devuelve y en `apps/tpv-web` no hay una sola
  referencia. O el terminal lo usa (al verlo, resincronizar su estado de turno con `/shift/current` en vez de
  seguir posteando todo el día contra un turno que el server cerró — cada venta paga dos queries extra), o se
  quita del contrato. Un campo que no lee nadie se pudre. Decidid y dejadlo escrito en el done.md.
- **El done.md dice 1132 tests; la última pasada da 1136.** Cuadra con los +4 de `outbox.test.ts`, pero la
  cifra del documento está vieja. Actualizarla.

---

## Lo que NO se toca

La imputación por ventana, el orden de prioridades del rescate, `closeReason`, `cashCounted = NULL`,
`zReportStale`, `summaryAckAt`, la inversión resumen→arqueo, el borrado de `ShiftActiveScreen`, el cron horario
con `tz`, y las once decisiones del done.md. Están bien argumentadas y revisadas.
