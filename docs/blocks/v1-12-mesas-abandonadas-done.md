# v1.12 · Mesas abandonadas — DONE

Prompt: `docs/code-prompts/bloque-v1-12-mesas-abandonadas.md`.
Rama: `v1-12-b-mesas-abandonadas`, sobre la base de integración `fc508a9`
(v1.10.3 + v1.11). **Sin push** — el merge lo hace Matías.

**Dependencia.** El prompt pedía parar si v1.11 no estaba en master. No está en
master, pero **sí está en esta rama**: `v1-11-cierre-de-dia` es ancestro de HEAD
a través de la base de integración de v1.12 (`c242b94` + `fc508a9`), que es
justamente para lo que se creó esa base. El bloque **extiende el job de v1.11**,
no crea uno nuevo, así que al mergear v1.12 entra el corte de día con él.

---

## Lo que hace, en una frase

Al pasar el corte de día de su tenant, un `Ticket DRAFT` con `tableId` y **cero
líneas** se anula y su mesa queda libre. Un DRAFT **con líneas** no se toca
jamás: se lista en el admin para que lo resuelva una persona.

---

## Estructura (qué se tocó)

### BD (`packages/db`)
`migrations/20260827000000_v1_12_mesas_abandonadas/` — **aditiva**, tres
columnas nullable sobre `tickets`:

- `void_reason "TicketVoidReason"` — enum nuevo `MANUAL | AUTO_ABANDONED_EMPTY |
  MANAGER_VOID`. NULL en un ticket que no está VOIDED.
- `voided_at TIMESTAMPTZ`
- `voided_by_user_id UUID → users(id)` (ON DELETE RESTRICT)

Backfill: los VOIDED anteriores a v1.12 quedan `MANUAL` — hasta hoy el único
camino que anulaba un ticket era `DELETE /tickets/:id` con un cajero delante.
`voided_at` se queda **NULL** en esas filas a propósito: no sabemos cuándo fue, y
estampar `created_at` sería inventarse una fecha (mismo criterio que
`cashCounted = NULL` en v1.11 — lo desconocido se dice, no se rellena).

Sin índice nuevo: `(tenant_id, status)` y `(table_id, status)` ya cubren los dos
accesos que añade el bloque.

### Backend (`apps/api`)

**Nuevo:**
- `src/tables/void-draft.ts` — **el único camino que anula un DRAFT**. Reclama
  con `updateMany` condicionado, escribe la auditoría, emite `table.cleared`.
  Lo usan los tres actores: "vaciar mesa" del TPV, el barrido, y el admin.
- `src/tables/abandoned.ts` — `runAbandonedTableSweep` (la pasada) y
  `listAbandonedTables` (la lista del admin). Umbral del aviso:
  `ABANDONED_WITH_LINES_HOURS = 24`.

**Modificado:**
- `src/shift/day-cut.ts` — `crossedDayCut(at, now, dayCutHour, tz)` extraída;
  `shiftCrossedDayCut` ahora delega en ella. Misma pregunta ("¿esto es de antes
  del último corte?") aplicada a `Ticket.createdAt` en vez de `Shift.openedAt`.
  Cero cambios de comportamiento en v1.11.
- `src/workers/shift-day-cut-worker.ts` — el barrido corre **dentro del mismo
  job**, después del cierre de turnos y envuelto en su propio `try`: si el
  barrido peta, los turnos ya están cerrados.
- `src/tables/operativa.ts` — `DELETE /tickets/:ticketId` conserva sus guards
  (tenant, DRAFT, misma caja) y delega el efecto en `voidDraftTicket`.
- `src/tables/routes.ts` — dos rutas nuevas:
  - `GET  /admin/stores/:storeId/tables/abandoned` (OWNER o MANAGER)
  - `POST /admin/tables/abandoned/:ticketId/void` (OWNER o MANAGER **+ PIN**)

### Frontend TPV (`apps/tpv-web`)
- `src/pages/SalePage.tsx` — `backToMap`: volver al mapa **sin haber añadido
  nada** anula el DRAFT vacío por el mismo `DELETE /tickets/:id` de siempre. Es
  el punto 3 del prompt (ver abajo). Con líneas no se toca.
- El mapa **no se tocó**: la tarjeta ya marca la mesa olvidada con halo ámbar y
  pinta "43 días" desde v1.10.3. El prompt pedía no rehacer el contador y no se
  rehízo.

### Admin (`apps/admin`)
- `src/pages/StoreDetailPage.abandonedTables.tsx` — **nuevo**: sección "Cuentas
  abiertas sin cobrar". Mesa, importe, desde cuándo (+ fecha exacta), quién la
  abrió, y dos botones. **Sólo aparece si hay algo que decidir** — una sección
  vacía permanente enseña a ignorar la sección.
- `src/pages/StoresPage.tsx` — la monta encima de "Mesas y barra". El canvas del
  admin no se tocó (fuera de alcance).

---

## Las tres decisiones que había que tomar

**1. "Cobrar" desde el admin no cobra: lleva al TPV.**
El prompt pedía un botón de Cobrar. Cobrar de verdad exige asignar
`internalNumber` de la serie, imputar a un turno abierto, escribir los pagos y
encolar la subida a Holded — eso *es* `POST /tickets/:id/checkout`, y vive detrás
de una sesión de cajero. Reconstruirlo en el admin sería el segundo camino de
cobro que ADR-010 prohíbe, y el prompt prohíbe explícitamente inventar un segundo
camino. El botón se llama **"Cobrar en el TPV"** y abre `VITE_TPV_URL`: el cobro
se hace donde hay caja, turno y una persona. Lo que el admin sí resuelve por su
cuenta es la otra mitad, la que no mueve dinero: **Anular**.

**2. El PIN del admin es un segundo factor, no el login.**
La ruta ya exige JWT de OWNER/MANAGER. El PIN se compara contra todos los
OWNER/MANAGER con PIN del tenant (mismo criterio que el cierre forzado de turno,
`shift/routes.ts`), con rate-limit propio por (tenant, usuario): 5 intentos / 5
min, candado 15 min. El ganador queda en `voided_by_user_id`: la columna dice
**quién**, no "el admin". Anular 84,60 € no puede depender de una pestaña abierta.

**3. La carrera del barrido se resuelve en el WHERE, no en el código.**
El peligro real del bloque: leer un draft vacío a las 05:00:00 y anularlo a las
05:00:02, cuando un camarero acaba de teclear la primera caña. La reclamación
lleva `lines: { none: {} }` en el `where` del `updateMany` — si le entró una
línea, no casa, no se anula, y el log lo dice (`tables.abandoned.skipped`). Es el
mismo patrón que la reclamación de turno del addendum 2 de v1.11.

---

## Punto 3 del prompt · por qué pasa y qué se ha hecho

**La causa está localizada.** `App.tsx → pickTable()` hace
`POST /tables/:id/open` en cuanto el cajero toca la mesa, y ese endpoint crea el
`Ticket DRAFT` con `tableId`. Desde ese instante la mesa está ocupada. Y eso es
**deliberado**, no un descuido: el comentario del propio código lo dice — *"así
la mesa aparece ocupada en el mapa de las demás cajas desde el primer toque"*.
Es la reserva que evita que dos camareros abran la misma mesa a la vez, y sobre
ella se construyó toda la concurrencia de v1.9.2 (expulsión por cobro remoto,
absorción en grupo, `REGISTER_MISMATCH`).

**Por eso NO se ha hecho "no crear el draft hasta la primera línea".** Quitaría
el candado justo en el momento en que hace falta —los dos primeros segundos— y
tocaría el camino que v1.9.2 endureció con cuatro bugs de producción delante.
Eso es exactamente el "cambio grande" que el prompt decía no hacer.

**Sí se ha hecho la otra mitad que ofrecía el prompt:** borrarlo al salir del
detalle sin haber añadido nada. `backToMap` en `SalePage.tsx` anula el DRAFT
vacío con el `DELETE /tickets/:id` que ya existía. Con líneas no hace nada. Si
falla (sin red, o la mesa ya se cobró desde otra caja) se vuelve al mapa igual y
el barrido de madrugada la recoge: el cajero pidió ir al mapa, no gestionar un
draft que él no sabe que existe.

**Lo que queda vivo como agujero** (no se ha cerrado, y es honesto decirlo): si
el terminal se queda sin batería, se cierra la pestaña o el cajero pulsa
"Cerrar turno" desde dentro de una mesa vacía, el DRAFT sobrevive hasta el corte
de día. La red de seguridad es el barrido; el arreglo fino sería un
`navigator.sendBeacon` al salir, y no compensa por una mesa que se suelta sola
esa misma madrugada.

---

## Qué hay en producción (Cafetería Sirope)

**Mesas vacías — las que suelta el barrido:** cuatro, todas a **0,00 €**, abiertas
el **9 de julio de 2026** y nunca cerradas: **M1, M2 y M4** (abiertas por
`gemmamgc72`) y **T1**. Confirmadas el 2026-08-20 y de nuevo el 26
(`docs/qa/2026-08-20-simulacion-hora-punta-sirope.md`, §"Estado en que queda
Sirope") y en el done de v1.10.3. La primera pasada tras desplegar las anula con
`void_reason = AUTO_ABANDONED_EMPTY` y el mapa vuelve a decir la verdad.

**Cuentas con dinero dentro:** en las dos inspecciones de la BD de producción
(20 y 26 de agosto) **no había ninguna**: las cuatro mesas colgadas están a
0,00 €. Este bloque no ha podido re-consultar la BD —el entorno de desarrollo no
tiene acceso a producción— así que la cifra que queda escrita es la de esas dos
inspecciones. **Antes de desplegar**, esta consulta dice si apareció alguna entre
medias (y es la lista exacta que verá el admin):

```sql
SELECT t.id,
       tb.name              AS mesa,
       t.total,
       t.created_at         AS abierta_desde,
       now() - t.created_at AS antiguedad,
       COALESCE(u.alias, u.email) AS abierta_por,
       COUNT(l.id)          AS lineas
  FROM tickets t
  JOIN tables tb ON tb.id = t.table_id
  JOIN users  u  ON u.id  = t.user_id
  LEFT JOIN ticket_lines l ON l.ticket_id = t.id
 WHERE t.status = 'DRAFT'
   AND t.table_id IS NOT NULL
 GROUP BY t.id, tb.name, u.alias, u.email
 ORDER BY t.created_at;
```

Las filas con `lineas = 0` son las que suelta el barrido. Las que tengan
`lineas > 0` **no las toca nadie**: salen en la sección del admin.

---

## Tests

`pnpm vitest run` → **144 archivos, 1224 pasan, 3 skipped, 0 fallos.**
(Antes del bloque: 1209 + 3 skipped. El bloque añade 15.)

Nuevos:
- `apps/api/test/tables-abandoned-sweep.test.ts` (7) — la pasada contra un prisma
  falso, con los datos de Sirope: draft vacío del 9 de julio → VOIDED con
  `AUTO_ABANDONED_EMPTY`, `voidedByUserId = NULL` (SISTEMA) y mesa libre; draft
  **con líneas** intacto; draft de hoy intacto; la hora de corte de **cada**
  tenant respetada; la carrera "le meten la primera línea durante la pasada"; y
  un fallo que no arrastra a las demás mesas.
- `apps/api/test/tables-abandoned-admin.test.ts` (5) — la lista sólo trae las
  cuentas con consumo; sin PIN correcto no se anula nada; con PIN queda firmado
  quién y por qué; si la cobraron desde el TPV mientras tanto → 409; un CASHIER
  no pasa de la puerta.

Tocados:
- `apps/tpv-web/test/table-sale-flow.test.tsx` — +3: salir al mapa con la mesa
  vacía dispara el DELETE; con una línea dentro no; si el DELETE falla se sale
  al mapa igual.
- `apps/api/test/tables-e2e.test.ts` — el prisma falso aprende `_count` y
  `lines: { none: {} }`, que es lo que pide el camino de anulación compartido.
  Sin cambios en los asserts: los 15 tests de mesas siguen probando lo mismo.

Typecheck limpio en `apps/api`, `apps/tpv-web` y `apps/admin`.

---

## Qué quedó hecho vs. alcance

| Alcance del prompt | Estado |
|---|---|
| 1 · Soltar el DRAFT vacío al pasar el corte del tenant | ✅ `tables/abandoned.ts`, dentro del job de v1.11 |
| 1 · Sólo drafts vacíos; con líneas no se tocan | ✅ filtro + `lines: { none: {} }` en la reclamación |
| 1 · Reutilizar el camino de anulación existente | ✅ `void-draft.ts`, usado por los tres actores |
| 1 · Auditoría: quién (SISTEMA), cuándo y por qué | ✅ `void_reason` / `voided_at` / `voided_by_user_id` |
| 2 · El mapa ya lo marca | ✅ intacto desde v1.10.3 (halo ámbar + "43 días") |
| 2 · Lista en el admin: mesa, importe, desde cuándo, quién | ✅ `AbandonedTablesSection` |
| 2 · Botón Cobrar | ⚠️ "Cobrar en el TPV" — abre el TPV, no cobra en el admin (decisión 1) |
| 2 · Botón Anular con PIN de encargado | ✅ con rate-limit y firma de quién autorizó |
| 3 · Entender por qué se crea el draft vacío | ✅ localizado y escrito arriba |
| 3 · Evitarlo si es barato | ✅ la mitad barata (salir del detalle); la otra, no, y se explica |
| Tests contra el prisma falso | ✅ 12 nuevos + 3 en el TPV |
| Migración aditiva | ✅ |

**Fuera de alcance, respetado:** modelo de mesas/zonas/agrupaciones, canvas del
admin, cierre de turnos (es v1.11), notificaciones/emails/dashboards, y **nada
anula un ticket con importe sin que lo pulse una persona**.

---

## Notas para el despliegue

1. `pnpm db:migrate` (o `migrate:deploy`) antes de arrancar la API — el barrido
   escribe `void_reason` desde la primera pasada.
2. El cron ya existe (`shift-day-cut`, `0 * * * *`, `tz: Europe/Madrid`): no hay
   cola nueva que registrar. La primera pasada tras el arranque suelta las mesas
   de Sirope.
3. El `table.cleared` del barrido se emite por el bus **in-memory** (B7 §6), así
   que desde el proceso worker no llega a ningún device. No importa: el mapa del
   TPV repolla cada 30 s y el barrido corre de madrugada. Si algún día el bus
   pasa a Redis pub/sub, esto empieza a funcionar solo.
4. Para ver la sección del admin hace falta que `VITE_TPV_URL` apunte al TPV; si
   no está, el botón "Cobrar en el TPV" abre `/`.
