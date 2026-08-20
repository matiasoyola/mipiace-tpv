# Bloque Reservas-5 · Cita → caja unificada (carryovers #1 y #2 de B4)

> Cierra el ciclo del puente cita→caja. Hoy "Cobrar en caja" **abre un ticket nuevo** y deja huérfano el DRAFT
> pre-poblado que el server ya había creado y enlazado. Este bloque hace que el cobro **pague ese DRAFT**,
> exactamente como una mesa, y que la cita pase sola a `COMPLETED`. **Es el bloqueante para encender
> `agendaEnabled` a la primera clienta (Sole).** Rama propia en worktree, sin push.

## Contexto (leer antes)

- **`docs/blocks/B-reservas-4-done.md` §"Carryovers para el siguiente bloque"** — los puntos 1 y 2 son el alcance
  literal de este bloque.
- `docs/design/adr-r8-motor-reservas-agnostico.md` §5 (cita→caja) — la spec del puente.
- `apps/api/src/agenda/checkout.ts` — la cabecera del fichero explica el contrato actual y por qué el
  `COMPLETED` se dejó al front. Es el punto de partida, no se reescribe.
- `apps/tpv-web/src/lib/tableDraft.ts` — el patrón mesa ya resuelto (`mapServerDraftLines`, `isDeadDraftError`).
- `docs/design/adr-010-*.md` y memoria `holded-pay-tolerance` — el camino de cobro que NO se toca.

## El diagnóstico (ya hecho, no hay que investigarlo)

`apps/tpv-web/src/pages/AgendaPage.tsx::doCheckout()` llama a `POST /agenda/appointments/:id/checkout`, recibe el
DRAFT enlazado… y **rehidrata sus líneas a mano en `CartLine[]` para meterlas en el carrito rápido**
(`onCheckoutLines`). El cobro sale entonces por `POST /tickets`, que crea un ticket **nuevo**. Resultado: cada cita
cobrada deja un DRAFT huérfano en la BD y la cita se queda sin `COMPLETED` salvo que el cajero pulse "Finalizar".

La máquina para hacerlo bien **ya existe** y está probada por mesas:

- `apps/tpv-web/src/pages/CheckoutPage.tsx:374` — si recibe `tableTicketId`, cobra por
  `POST /tickets/:id/checkout` mandando sólo pagos + intents (las líneas ya viven en el server), con `externalId`
  de idempotencia y persistencia previa en outbox.
- `apps/api/src/agenda/checkout.ts` ya crea el DRAFT **idéntico al de una mesa**
  (`tables/operativa.ts::getOrCreateDraftTicket`) y enlaza `appointment.ticketId` (`@unique`).

O sea: no hay que construir nada nuevo. Hay que **dejar de duplicar** y enchufar la agenda al camino que ya existe.

## Alcance

### 1. Generalizar el contexto de DRAFT en el checkout (front)

`CheckoutPage` habla hoy de `tableTicketId` — el nombre miente en cuanto lo usa la agenda. Renombrar a
**`draftTicketId`** en todo el componente y en `SalePage`, con el vocabulario neutro del motor (ADR-R8: cero
`if(businessType)`, nada de "mesa" en el núcleo). Un solo rename mecánico, sin cambio de comportamiento: los tests
de mesa existentes deben seguir verdes **sin tocarlos**.

Mismo trato para `onTablePaidExit` → `onDraftPaidExit` y para el resto de props que sólo son "estoy cobrando un
DRAFT que ya vive en el server".

### 2. La agenda entra en contexto de DRAFT, no rehidrata (front)

`doCheckout()` deja de mapear líneas. Tras el `POST /agenda/appointments/:id/checkout` navega a la venta **en
contexto del DRAFT devuelto**, igual que al entrar en una mesa: `SalePage` carga la proyección del ticket desde
`GET /tickets/:id`, el aside pinta el total real del server y "Cobrar" abre el `CheckoutPage` con
`draftTicketId`.

- Borrar el mapeo inline de `CartLine` de `AgendaPage`: es una **copia** de `mapServerDraftLines` y ya ha
  divergido. Si hace falta mapear algo, se usa el helper de `tableDraft.ts`; no se escribe un segundo.
- El cajero puede añadir líneas al DRAFT antes de cobrar (un producto de peluquería tras el servicio) por el
  camino normal de líneas sobre ticket. Sale gratis al entrar en contexto: no lo bloquees.
- `res.ticket.alreadyLinked` ya viene del server: entrar dos veces a "Cobrar en caja" debe llevar al **mismo**
  DRAFT, nunca crear otro.

### 3. `COMPLETED` automático al cobrar (front)

Al confirmarse el cobro de un DRAFT que venía de una cita, `PATCH /agenda/appointments/:id { status: COMPLETED }`.

**Se hace en el front, a propósito.** Engancharlo server-side dentro de `POST /tickets/:id/checkout` metería la
agenda dentro del camino de cobro, que es justo lo que ADR-010 prohíbe. El front ya sabe que está en contexto de
cita; que lo diga él.

- Si el `PATCH` falla, **el cobro es válido igual**: el dinero manda. Degradar a un aviso y dejar "Finalizar"
  manual en el detalle de la cita como red.
- Offline: el cobro ya va por outbox. El `PATCH` sigue el mismo patrón (`OutboxKind` de cita) o se reintenta al
  reconectar; lo que no puede pasar es que se pierda en silencio.

### 4. Limpieza de los DRAFTs ya huérfanos

Script en `apps/api/src/scripts/` que liste los DRAFT con `appointment.ticketId` apuntando a ellos cuya cita ya
esté cobrada por otro ticket. **Sólo listar y contar; el borrado va en un segundo paso con el conteo delante.**
Hoy en producción no hay ninguno (la agenda nunca se ha encendido), así que esto es higiene preventiva.

## Restricciones

- **NO tocar el camino de cobro a Holded**: GET-back, tolerancia de 5 céntimos, `/pay` idempotente, ADR-010. Este
  bloque cambia **quién** paga (un DRAFT existente en vez de un ticket nuevo), no **cómo** se paga.
- **No inventar lógica fiscal** (memoria `marco-legal-fiscal`). Las líneas de servicio van con `serviceId`, nunca
  con `sku` (memoria `holded-services-serviceid`).
- **Vocabulario neutro**: el núcleo no se clava a "mesa" ni a "profesional". Cero `if(businessType)`.
- Gate `agendaEnabled` intacto, en ruta y en UI.
- **No commit en el worktree principal.** Trabaja en `../mipiacetpv-reservas-5`. Verifica con `git worktree list`
  ANTES de la primera línea. En el cierre, **devuelve el hash del commit**.
- No push. El push lo lanza Matías.

## Entregables

- `apps/tpv-web/src/pages/CheckoutPage.tsx`, `SalePage.tsx`, `AgendaPage.tsx` modificados.
- Script de auditoría de DRAFTs huérfanos en `apps/api/src/scripts/`.
- Tests: uno que demuestre que **el cobro de una cita no crea un ticket nuevo** (el `ticketId` cobrado es el mismo
  que el DRAFT enlazado), y otro que la cita queda `COMPLETED`. Los tests de mesa siguen verdes sin tocarlos.
- `docs/blocks/B-reservas-5-done.md` con la plantilla de la metodología.
- **Criterio de "funciona"**: reservar una cita → "Cobrar en caja" → cobrar → en BD hay **un solo** ticket para esa
  cita, `paid_at` puesto, `appointment.status = COMPLETED` y **cero** DRAFTs sobrantes.

## Fuera de alcance (explícito)

- El rediseño del cierre de turno (va en su propio bloque, `bloque-v1-11-cierre-de-dia.md`).
- Bonos, paquetes y cualquier cosa de la serie R que no sea el puente cita→caja.
- Recurrencia de bloqueos más allá del expander de B3.
- Tests React/jsdom de `AgendaPage` diferidos en B4 por la limitación de infra: siguen diferidos.
- Borrar DRAFTs huérfanos (este bloque sólo los cuenta).

## Bucle visual (obligatorio antes de cerrar)

Levanta el dev server, entra en la agenda con `agendaEnabled`, recorre cita → cobrar → cobrado, y **hazte
screenshots con Playwright**: móvil 320 px, móvil 390 px, escritorio, el estado de error del cobro rechazado, y la
pantalla final. Revísalos contra `docs/mockups/agenda-reservas.html` y los principios UX antes de escribir el
`done.md`. Tap targets ≥ 44 px, importes con `tabular-nums`.
