# B-reservas-5 · Reconciliación del prompt con master (Frente 0)

_2026-09-10. Rama `reservas-5-cita-caja`, worktree `mipiacetpv-reservas-5`, base `cb468bd`._

El prompt `docs/code-prompts/bloque-reservas-5-cita-caja.md` se escribió tras B-reservas-4
(agosto), **antes** de v1.12–v1.15 y **antes** de S1. Este documento verifica el prompt contra el
código de master, no contra la memoria: cada afirmación lleva su `fichero:línea`.

**Veredicto corto:** el diagnóstico del prompt es correcto y sigue vigente palabra por palabra. Lo
que cambia no es el *qué*, es el *tamaño* de la pieza 1 (el rename no es un rename) y la aparición
de tres cosas que el prompt no podía ver: el sello de S1, la pantalla de vuelta de v1.15 y un
harness e2e contra Postgres real que en agosto no existía.

---

## 1 · El diagnóstico del prompt: verificado, intacto

| Afirmación del prompt | Estado | Prueba |
|---|---|---|
| `doCheckout()` rehidrata las líneas a mano en `CartLine[]` | **cierto** | `apps/tpv-web/src/pages/AgendaPage.tsx:281-309` |
| …y el mapeo ya ha divergido de `mapServerDraftLines` | **cierto, y peor de lo que dice** | `AgendaPage.tsx:293` pone `holdedProductId: null` — pierde el enlace a Holded que el DRAFT sí traía (`agenda/checkout.ts:180-200`) |
| El cobro sale por `POST /tickets` y crea un ticket **nuevo** | **cierto** | `SalePage.tsx:2194` mete las líneas en el carrito; `CheckoutPage.tsx:501-503` elige `/tickets` porque `tableTicketId` es `null` |
| El DRAFT enlazado queda huérfano | **cierto** | `agenda/checkout.ts:213` (`linkTicket`) y nadie lo cobra nunca |
| La cita no pasa a `COMPLETED` sin "Finalizar" | **cierto** | `agenda/checkout.ts:215-218` sólo la deja `IN_SERVICE` |
| La máquina de mesa ya existe y está probada | **cierto** | `CheckoutPage.tsx:501` · `apps/api/src/tickets/routes.ts:709` |
| `POST /tickets/:id/checkout` acepta un DRAFT **sin mesa** | **cierto y clave** | `routes.ts:1002` y `routes.ts:1083` guardan con `if (draft.tableId)`; con `tableId = null` la ruta funciona entera |
| `alreadyLinked` ya viene del server | **cierto** | `agenda/checkout.ts:83` |

Nada del §"El diagnóstico" hay que reinvestigarlo. La pieza 3 (`COMPLETED` desde el front) sigue
siendo la única forma legal: enganchar la agenda dentro de `POST /tickets/:id/checkout` metería el
módulo de reservas en el camino de cobro, y ADR-010 + ADR-R8 §5 lo prohíben — el motor **alimenta**
ese camino, no lo toca.

---

## 2 · Lo que ya NO aplica tal y como está escrito

### 2.1 "Un solo rename mecánico, sin cambio de comportamiento" — falso

El prompt (§1 del alcance) trata la generalización como un rename de `tableTicketId` →
`draftTicketId` dentro de `CheckoutPage`. En `CheckoutPage` sí lo es (8 usos:
`CheckoutPage.tsx:100,325,501,504,527,562,579,661,1153`). **Fuera de `CheckoutPage` no lo es**, y
esto es el hallazgo grande de este frente:

- `SalePage` no decide el modo por el ticket, lo decide por **la mesa entera**:
  `const isTableMode = props.tableContext != null` (`SalePage.tsx:459`), y `TableContext`
  (`SalePage.tsx:281-294`) lleva `id`, `name`, `zone`, `capacity`, `diners`, `openedAt`,
  `openedByEmail`, `openedByAlias`. Una cita no tiene nada de eso. `isTableMode` gobierna el
  carrito (`SalePage.tsx:465-466`), las mutaciones de línea, el envío a cocina, el partir cuenta y
  el override de precio (`SalePage.tsx:2007`).
- El dueño de la vista es `App`, no `SalePage`: `view = { kind: "sale", tableContext, initialTableLines }`
  (`App.tsx:517-525`), poblado en `pickTable` (`App.tsx:536-560`) y con
  `key={view.tableContext?.id ?? "quick-sale"}` (`App.tsx:690`).
- Pero **la agenda se pinta dentro de `SalePage`** como overlay local (`SalePage.tsx:2191-2198`,
  estado `showAgenda`). Es decir: el sitio que sabe que hay que entrar en contexto DRAFT no es el
  sitio que puede cambiarlo.
- En vertical `SERVICES` no hay mapa de sala: `skipTables` fuerza `{ kind:"sale", tableContext:null }`
  desde el arranque (`App.tsx:510-525`). La salida del cobro de mesa es `exitToMap`
  (`SalePage.tsx:2098-2110`) y **para una cita no hay mapa al que salir**.

Consecuencia: la pieza 1 es *introducir un `draftContext` neutro* en `SalePage`/`App` con la parte
de mesa como campo opcional, y subir la agenda a `App` (o darle a `SalePage` una vía para entrar en
contexto DRAFT). Sigue sin cambiar comportamiento de mesa y los tests de mesa siguen verdes sin
tocarse — pero es trabajo de arquitectura de vistas, no un `sed`.

### 2.2 `docs/mockups/agenda-reservas.html` no existe

El §"Bucle visual" manda revisar las capturas contra ese fichero. En `docs/mockups/` sólo hay
`mapa-sala-visual.html` y `sale-page-v1-14.html`. El contraste se hará contra
`docs/design/agenda-belleza-spec.md`, `docs/ux-principles.md` y `docs/design/tokens.md`.

### 2.3 "Tap targets ≥ 44 px" se queda corto

El estándar de la casa es **64×64 px mínimo, 80×80 ideal** en pantalla de venta
(`docs/ux-principles.md` §1.2). Manda el estándar de la casa, no el 44 del prompt.

### 2.4 "Escritorio" pasa a ser **1280×800 tablet**

El prompt pide "móvil 320, móvil 390, escritorio". El encargo de esta sesión fija 1280×800 como
tablet, que es el hierro real de un mostrador de peluquería. Se mantiene 390 y 320.

### 2.5 El e2e contra Postgres real ya no hay que inventarlo

En B-4 la excusa para el `AgendaStore` mockeable fue "el harness del repo es fake-prisma, no hay
Postgres real" (`B-reservas-4-done.md` §Decisiones 1). **Eso caducó en v1.13**: existe
`apps/api/test-e2e/` con `global-setup.ts` que hace `DROP SCHEMA` + `prisma migrate deploy` real,
`pnpm test:e2e`, y la red de seguridad de `e2e-env.ts`. El camino cita → ticket va ahí.

---

## 3 · Qué cambia por S1 (el sello de la venta)

**Titular: S1 no bloquea el camino feliz de B-5, y de hecho lo justifica.** Pero mueve tres cosas.

### 3.1 El sello llega justo por la puerta que B-5 quiere usar

`POST /tickets/:id/checkout` sella al final de su transacción (`routes.ts:1028`), después de
reescribir los pagos. Hoy la cita se cobra por `POST /tickets`, que también sella (`routes.ts:630`).
Las dos puertas sellan, así que **el cambio de puerta no cambia la protección**.

Lo que sí cambia: hoy el DRAFT huérfano de la cita **nunca se sella** (se queda en `DRAFT` para
siempre) mientras el dinero vive en otro ticket que sí está sellado. El enlace `appointment.ticketId`
apunta al ticket **sin sellar**, es decir: *el registro que la agenda dice que es la venta de esa
cita no es el registro protegido*. B-5 arregla eso de raíz. Merece decirse así en el `done.md`.

### 3.2 El orden importa, y B-5 lo respeta por construcción

El DRAFT de la cita nace con `internalNumber: "D-<uuid>"` como placeholder (`agenda/checkout.ts:184`)
y `internal_number` **es columna sellada** (ADR-015 §3, `sealed-fields.ts`). No hay conflicto: el
número de serie de verdad se asigna dentro de la tx del checkout (`routes.ts:962-967`) y el sello se
pone después (`routes.ts:1028`). Igual que una mesa.

Lo mismo con las líneas: el trigger de `ticket_lines` deniega también el `INSERT` sobre un ticket
sellado (`s1-done` §2.6). Que el cajero añada un producto al DRAFT antes de cobrar (prompt §2) es
legal **porque el DRAFT no está sellado**; después del cobro, no. Es el comportamiento correcto y no
hay que programar nada para conseguirlo.

### 3.3 `shift_id` es columna sellada, y la cita abre el DRAFT antes que la mesa

Revisión de Cowork, `s1-done` §2.4: `shift_id` entró en el sello y en el trigger. El DRAFT de la
cita fija su `shiftId` al **abrirlo** (`agenda/checkout.ts:112-121, 180`) y `POST /tickets/:id/checkout`
**no lo reimputa** (`routes.ts:1007-1010` sólo toca `lastActivityAt`). Si el turno se cierra entre
"Cobrar en caja" y el cobro, la venta se sella en el turno viejo y ya **no se puede corregir sin la
vía de `ticket_corrections`**.

Con mesas esto ya pasaba y nadie lo notó. Con citas la ventana es más ancha por diseño: "Cobrar en
caja" puede pulsarse al empezar el servicio (marca `IN_SERVICE`) y el cobro llega una hora después.
**No lo arregla B-5** (tocarlo es entrar en la imputación de turno, que es de S1/v1.11), pero se
documenta como filo conocido y entra en la lista de "lo que la suite no cubre".

### 3.4 La limpieza de DRAFTs huérfanos (pieza 4) no choca con los triggers

Un DRAFT nunca está sellado, así que borrarlo es legal. Los tickets *cobrados* que la cita dejó
detrás sí están sellados y **no se tocan**: el script sólo cuenta. Sin cambios respecto al prompt.

### 3.5 Los tests de fake-prisma prueban lo contrario de lo que hace falta

`s1-done` §3: *"con un prisma falso se estaría probando exactamente lo contrario de lo que cierra el
bloque"*. Los tests actuales de la agenda (`agenda-checkout.test.ts`, 3 tests) corren sobre fake-prisma
con un `AgendaStore` en memoria. **Ahí los triggers no existen**. El criterio "el `ticketId` cobrado
es el mismo que el DRAFT enlazado" se puede afirmar en fake-prisma; el criterio "y está sellado, y
`appointments.ticket_id` apunta al ticket sellado" **no**. Va a `test-e2e/`.

---

## 4 · Qué cambia por v1.15 (la vuelta existe)

### 4.1 El payload de pagos ya está resuelto y B-5 lo hereda gratis

`applyPaymentsToTotal` vive en `packages/ticket-model/src/payments.ts` y las dos puertas del
servidor pasan por `tickets/normalize-payments.ts` (`v1-15-done` §1). Como B-5 sólo cambia **qué
ruta** llama el front, el tope de efectivo y `cashAmount` funcionan igual el primer día. Nada que
hacer.

### 4.2 Pero el patrón mesa **se salta "Ticket emitido"**, y ahí es donde v1.15 puso la vuelta

Éste es el choque real, y es de producto, no de código.

- v1.15 §4 convirtió "Ticket emitido" en la pantalla que enseña **TOTAL / ENTREGADO / CAMBIO con el
  CAMBIO a 48 px**, y subió el autocierre de 4 s a 8 s cuando hay vuelta.
- En contexto mesa esa pantalla **no se muestra**: `CheckoutPage.tsx:319-338` desvía a
  `onTablePaidExit` y `SalePage.tsx:2098-2110` sale directo al mapa con un banner. Se decidió así en
  v1.9.2 Frente 3.1, cuando "Ticket emitido" todavía no decía nada útil.
- Si B-5 hace que la cita herede el patrón mesa entero, **una peluquería que cobra en efectivo deja
  de ver la vuelta en pantalla** justo después de que v1.15 la pusiera ahí. Sería una regresión
  introducida por un bloque que sólo venía a cambiar de ruta.

Ver §6, pregunta P1.

### 4.3 El fiado desaparece del cobro de una cita

`CheckoutPage.tsx:1153`: el botón "Fiado" se pinta con `props.creditSalesEnabled && !props.tableTicketId`.
Hoy la cita se cobra por venta rápida, así que **el fiado está disponible**. Al entrar en contexto
DRAFT, con el rename mecánico, desaparece. Ver §6, pregunta P2.

---

## 5 · Lo que el prompt no vio (hallazgos del repo, no del prompt)

1. **Volver a "Cobrar en caja" sobre una cita YA COBRADA devuelve un ticket que no es un DRAFT.**
   `agenda/checkout.ts:81-84` devuelve el ticket enlazado con `alreadyLinked:true` **sin mirar su
   `status`**. Hoy da igual (el ticket enlazado nunca se cobra). Después de B-5 el ticket enlazado
   **es** la venta: entrar otra vez llevaría al cajero a un contexto de cobro sobre un ticket
   `PENDING_SYNC`/`SYNCED` y sellado, y el `POST /tickets/:id/checkout` respondería
   `409 TICKET_ALREADY_PAID` (`routes.ts:1046-1049`). Hay que cerrarlo en el server: si el ticket
   enlazado ya está cobrado, la cita no se vuelve a cobrar, se enseña. **Esto entra en B-5**, es
   consecuencia directa de su propio cambio.

2. **`goToMap` borra DRAFTs vacíos con `onlyIfEmpty=true` (`App.tsx:592-605`).** No afecta al DRAFT
   de una cita (nunca está vacío: nace con las líneas de servicio), pero si en algún momento lo
   estuviera, `Appointment.ticket` es `onDelete: SetNull` (`schema.prisma`, modelo `Appointment`):
   la cita se desenlaza sola y no queda basura. Comprobado, no hay que hacer nada.

3. **`REGISTER_MISMATCH`.** El DRAFT de la cita se crea con el `registerId` del cajero que pulsó
   "Cobrar en caja" (`agenda/checkout.ts:179`) y `POST /tickets/:id/checkout` exige que la caja
   coincida (`routes.ts:781-786`). En un centro con dos cajas, quien abre el cobro es quien lo
   cierra. Hoy no se nota porque el cobro sale por `POST /tickets` con la caja de quien cobra.
   Sole tiene una caja: no bloquea. Se documenta.

4. **El drift de Prisma en `appointments` es anterior a S1 y sigue ahí** (`s1-done` §2.10). B-5 no
   toca el esquema, así que no lo empeora ni lo arregla.

---

## 6 · Decisiones de producto — preguntadas y decididas (Matías, 2026-09-10)

Las tres salían de §4.2, §4.3 y §2.1. Ninguna estaba en el prompt ni en los docs.

### P1 · Tras cobrar una cita se muestra **"Ticket emitido"**, y al cerrarse se vuelve a la agenda

La condición de Matías para el patrón mesa (volver directo a la agenda) era que el aviso de "cita
cobrada" ofreciera **"Imprimir ticket"** y el ticket digital. **No cabe en este bloque**, y el motivo
es que ya existe hecho en otro sitio:

- `CheckoutPage.successOverlay.tsx` **es** la superficie de entrega: imprimir por
  `platform/printer/printJob.ts` con los cuatro estados que impuso v1.10.2-impresión-honesta
  (`idle` / `printing` / `error` / `no-printer`), QR, descargar PDF, ver PDF, badge de email
  enviado — y encima el CAMBIO a 48 px y el autocierre de 8 s de v1.15.
- El aviso de mesa sólo lleva texto y "Ver ticket", que aterriza en `TicketsHistoryPage` (ahí sí hay
  reimprimir, `TicketsHistoryPage.tsx:586`).
- Ponerlo en el banner sería la **tercera copia** de esa superficie, y la impresión honesta no es un
  botón: son cuatro estados que existen precisamente porque el TPV mentía.

**Decisión:** en contexto cita **no** se pasa `onDraftPaidExit`; el overlay se monta como en venta
rápida, y su `onDone` devuelve a la agenda con la cita ya en `COMPLETED`. Cero duplicación, y la
vuelta se ve. El patrón mesa se queda intacto para mesa.

### P2 · Una cita **no se fía** en este bloque, pero no se esconde en silencio

**Decisión:** el contexto DRAFT no ofrece "Fiado", igual que la mesa. Pero si el tenant tiene
`creditSalesEnabled`, el cobro de una cita **dice por qué no está**: una línea explicando que las
citas todavía no se pueden fiar. Un botón que desaparece sin explicación es el fallo que v1.10.2
vino a corregir en otro sitio.

**Deuda declarada** (va al `done.md`): fiar un borrador ya existente. El camino de fiado de v1.8 sólo
sabe cobrar por `POST /tickets`; enseñarle a saldar un DRAFT es un bloque propio, y se abre si un
cliente lo pide.

### P3 · La agenda **sube a `App`** como vista hermana del mapa de sala, con tres condiciones

**Decisión:** sí, sube. Condiciones de Matías, que son parte del criterio de hecho de este bloque:

**(a) Mudanza sin reforma.** Mismo componente, mismo aspecto, **commit propio ANTES** de la lógica
cita→caja, con capturas de Playwright **antes/después** que demuestren que no cambia nada visible.

**(b) La agenda NO pasa a ser la pantalla de aterrizaje de los tenants `SERVICES`.** Eso es otra
decisión y va como **propuesta** en el `done.md`, no como cambio de este bloque. Hoy `SERVICES`
aterriza en `SalePage` (`App.tsx:510-525`) y así se queda.

**(c) Un solo camino para abrir un DRAFT: el que ya usa la mesa.** No se escribe un segundo
`pickTable`. La cita entra por la misma puerta con `tableContext` a `null` y su parte de cita
rellena.

## 7 · Alcance de B-5 tras la reconciliación

Sin cambios de fondo respecto al prompt. La pieza 1 crece, aparece la 5, y el orden de commits lo
fija la condición P3(a).

| Frente | Commit | Qué | vs prompt |
|---|---|---|---|
| 0 | 1 | Este documento | nuevo |
| 1 | 2 | **Mudanza sin reforma**: la agenda sube a `App` como vista hermana del mapa. Mismo componente, mismo aspecto, capturas antes/después | nuevo (P3a) |
| 2 | 3 | Contexto de DRAFT neutro en `CheckoutPage` + `SalePage` + `App`, con la parte de mesa como campo opcional | **crece**: no es un rename (§2.1) |
| 3 | 4 | La agenda entra en contexto DRAFT por la puerta de la mesa y deja de rehidratar líneas | igual |
| 4 | 5 | `COMPLETED` automático al cobrar, desde el front, degradable a aviso + "Finalizar" | igual |
| 5 | 6 | La cita ya cobrada no se vuelve a cobrar: se enseña | **nuevo** (§5.1) |
| 6 | 7 | Script que **cuenta** DRAFTs huérfanos (no borra) | igual |
| 7 | 8 | Test del camino cita → ticket en `test-e2e/` contra Postgres real + tabla de sabotaje | **cambia de sitio** (§3.5) |
| 8 | 9 | Bucle visual 1280×800 / 390 / 320 + estado de error, contra el estándar de la casa | reencuadrado (§2.2–2.4) |

**Fuera de alcance, confirmado:** el camino de cobro a Holded (GET-back, tolerancia de 5 céntimos,
`/pay` idempotente), la lógica fiscal, los triggers de S1 (no se desactivan ni se esquivan), el
anti-solape (vive sólo en la BD), la reimputación de turno del DRAFT largo (§3.3), el borrado de
huérfanos, fiar una cita (P2), la agenda como pantalla de aterrizaje de `SERVICES` (P3b), y todo lo
de la serie R que no sea el puente cita→caja.
