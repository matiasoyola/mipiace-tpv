# Bloque Reservas-7 · Ventana reservable separada del turno contratado

> Hoy el motor lee la disponibilidad **directamente de `staff_shifts`**
> (`apps/api/src/agenda/store.ts:203-222`): un solo concepto haciendo dos trabajos incompatibles. Para
> abrir un hueco al público hay que **ensanchar el turno**, es decir, mentir en el dato de RRHH; y
> cualquier informe de ocupación que emitamos sale de un denominador falso. Medido en un centro real:
> 371 h-persona/semana de ficha frente a ~125 h de entrega → **34 % de ocupación** en un centro que va
> lleno (`docs/reservas/00-koibox-ingenieria-inversa-y-modelo.md` §1.5).
>
> Este bloque separa los dos conceptos y, ya que abre el cálculo de la ventana, mete las dos capas que
> hoy **no existen**: el **horario del centro** como techo y los **festivos**.
>
> Rama propia en worktree. Sin push.

## Contexto (leer antes)

- **`docs/reservas/01-cruce-con-b-reservas-4.md`** — §H2 (el hueco, con la línea que lo prueba), §1.4
  (dónde estamos **peor** que Koibox: no hay horario de centro ni festivos), **D-3** (se acepta el
  concepto, **no** se toca `StaffShift`) e invariante 13 de la Parte 4.
- **`docs/reservas/00-koibox-ingenieria-inversa-y-modelo.md` §1.2 y §1.5** — el motor de Koibox
  (horario del centro recorta al de la empleada; festivos como capa aparte, verificado) y el aviso de
  campo sobre turno ≠ ventana. **Documento de entrada; sus `[H]` no son hechos.**
- `docs/blocks/B-reservas-3-done.md` — el contrato **vivo** de personal: `StaffShift`,
  `GET /staff/:id/availability-template`. Es lo que **no se rompe**.
- `apps/api/src/agenda/store.ts:203-222` (`getTemplateSlots`, el único origen de disponibilidad) y
  `apps/api/src/agenda/engine.ts:211-247` (`staffFree`, que ya trata bloqueos `CENTER`/`STAFF`).
- `packages/db/prisma/schema.prisma:1859-1897` (`StaffShift`) y `:2001-2030` (`BookingBlock`).

## Alcance

### 1. Datos (Prisma / Postgres) — migración aditiva

Convención del repo (`id uuid @db.Uuid`, `@map` snake_case, `tenantId` por fila + índice,
`@db.Timestamptz`, backfill vacío):

- **`bookable_windows`** — la ventana en la que un profesional **acepta reservas**. Mismo patrón de
  plantilla que `StaffShift` (`rrule` RFC 5545 + `startTime`/`endTime` de pared + `validFrom`/
  `validUntil`), más:
  - `derivedFromShiftId` nullable — si apunta a un turno, la ventana **es** ese turno y se mantiene
    sola; si es `NULL`, es una desviación deliberada.
  - `reason String?` — por qué se desvía. Una desviación sin motivo es un descuido.
- **`center_hours`** — horario del centro por día de la semana, con `validFrom`/`validUntil`. Es el
  **techo**: recorta por arriba la ventana de cualquier profesional.
- **`center_holidays`** — `(tenantId, date, name)`, `@@unique([tenantId, date])`. Cierre total del
  centro ese día.

**Backfill: cero filas.** Un tenant sin ninguna de las tres tablas se comporta **exactamente como
hoy** (la ventana deriva del turno, no hay techo, no hay festivos). Este bloque no puede cambiar el
comportamiento de un centro que no lo configure.

### 2. Derivación por defecto, y desviación visible

- Al crear/editar un `StaffShift`, se **deriva** su `bookable_window` gemela
  (`derivedFromShiftId` puesto). Cambiar el turno mueve la ventana derivada.
- El operador puede **desviar** una ventana (recortarla, ensancharla, partirla) → la ventana se
  desengancha (`derivedFromShiftId = NULL`) y **queda marcada como desviación** con su motivo.
- La desviación **se ve**: en la pantalla de turnos, y como tarjeta nº 6 del panel de salud
  (B-reservas-9). No hay estado invisible que gobierne el comportamiento — es la regla nº 1 de la
  auditoría UX del documento de entrada.

### 3. El motor pasa a leer de la ventana

`store.getTemplateSlots()` deja de consultar `staff_shifts` y consulta `bookable_windows`,
recortando por `center_hours` y descontando `center_holidays`. Orden explícito y testeado:

```
ventana(profesional, fecha)
  ∩ horario_del_centro(fecha)
  ∖ festivos_del_centro(fecha)
  ∖ booking_blocks (CENTER | STAFF)      ← ya lo hace engine.ts:231-237
  ∖ assignments activos solapados        ← ya lo hace el GiST + staffFree()
```

**Compatibilidad:** si un profesional no tiene ninguna `bookable_window`, se usa su turno tal cual
(camino de hoy). Sin `center_hours` no hay techo. Sin festivos no se descuenta nada. Los tests de B3 y
B4 siguen verdes **sin tocarlos**.

### 4. Front

- **Pantalla de turnos y ventanas** (P9 del inventario): dos columnas por profesional —turno contratado
  y ventana reservable— con la desviación resaltada y su motivo. Editar una ventana no toca el turno,
  y la pantalla lo dice con todas las letras.
- **Horario del centro y festivos** (P10): dos tablas simples en ajustes de agenda. Alta de festivo en
  dos toques; el listado enseña la fecha **y** el nombre.
- **Estado vacío informativo**: si hoy no hay ninguna ventana abierta, la rejilla ya lo dice
  (`AgendaPage.tsx:440`); se amplía para distinguir *«hoy el centro está cerrado — festivo: Virgen del
  Prado»* de *«nadie tiene ventana reservable hoy»*. Son dos causas distintas y el arreglo es
  distinto.

### 5. Ocupación honesta (sólo la base)

Con los dos conceptos separados ya se puede calcular ocupación de verdad: **horas entregadas / horas
de turno contratado**, nunca sobre la ventana. Aquí se deja **el cálculo y su endpoint**, no la
pantalla de informes (fase 2). Cada cifra documenta la consulta que la produce.

## Restricciones

- **NO se toca `StaffShift`.** Es contrato vivo de B3 (API, tests y front). Se **añade** al lado. Los
  tests de B3 siguen verdes sin tocarlos: esa es la verificación de que no se ha roto.
- **NO se toca el anti-solape** (ADR-R4/GiST) ni el camino de cobro (ADR-010).
- **NO se implementan las reglas de yield** — son B-reservas-6. Este bloque cambia **de dónde sale la
  ventana**, no qué se filtra dentro de ella.
- Migración **aditiva**, backfill vacío, comportamiento idéntico al de hoy sin configuración.
- Vocabulario neutro (ADR-R6). Gate `agendaEnabled` en ruta y en UI. Multi-tenant por fila.
- **No commit en el worktree principal.** `git worktree list` antes de la primera línea. No push.

## Entregables

- Migración aditiva: `bookable_windows`, `center_hours`, `center_holidays` + índices por tenant.
- `store.getTemplateSlots()` reescrito sobre la ventana, con recorte de centro y festivos.
- API: CRUD de ventanas (con derivación y desviación), CRUD de horario de centro, CRUD de festivos,
  y `GET /agenda/occupancy?from=&to=` (entregado / contratado, con la consulta documentada).
- Front: pantalla de turnos y ventanas con la desviación visible; ajustes de horario y festivos;
  estado vacío que distingue festivo de "sin ventanas".
- **Tests**: la ventana deriva del turno y lo sigue · una desviación no mueve el turno · el horario
  del centro **recorta** la ventana del profesional · **invariante 13**: un festivo devuelve **cero**
  huecos · un tenant sin configurar se comporta como hoy · los tests de B3 y B4 verdes sin tocarlos.
- **Criterio de "funciona"**: con una profesional cuyo turno va de 09:00 a 22:30 y el centro abierto
  hasta 21:30, la agenda **no ofrece nada después de las 21:30**; al marcar el 8 de septiembre como
  festivo, ese día devuelve **cero** huecos y la rejilla dice *por qué*; recortar su ventana a
  10:00-14:00 **no cambia su turno**, y la desviación aparece marcada con su motivo.
- **Tabla sabotaje → test rojo** en el cierre.
- `docs/blocks/B-reservas-7-done.md` con la plantilla de la metodología.

## Fuera de alcance (explícito)

- **Las reglas de yield** (franjas protegidas, no-fragmentar, antelación) — **B-reservas-6**.
- **El panel de salud** — **B-reservas-9**; aquí sólo se deja el **dato** de la desviación disponible
  por API para que B-9 lo pinte.
- **Informes de ocupación como pantalla** — fase 2. Aquí sólo el cálculo y su endpoint.
- **Fichaje / control horario / comisiones** — no es este módulo (kickoff §7, fase 2).
- **Vacaciones y ausencias como entidad propia** — se siguen expresando con `BookingBlock scope=STAFF`.
  Si el campo pide una entidad `absence`, se anota como deuda; no se inventa aquí.
- **Los datos reales de F3** (horas contratadas del spa) — no los tenemos. El bloque se construye para
  funcionar con la ventana derivada mientras no existan (ver §7 del cruce).
- Cualquier cosa de Koibox — **B-reservas-10**.

---

*Lanzar como los bloques previos: implementar respetando alcance/restricciones/fuera-de-alcance,
escribir el `-done.md`, no commit/push. Commit selectivo después (stage → revisar → commit), NUNCA
`git add -A`.*
