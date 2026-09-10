# Bloque B-reservas-5 · Cita → caja unificada — DONE

Origen: `docs/code-prompts/bloque-reservas-5-cita-caja.md`.
Reconciliación previa (Frente 0): `docs/blocks/reservas-5-reconciliacion.md`.
Manda: `docs/design/adr-r8-motor-reservas-agnostico.md` §5 · `docs/design/adr-015-sello-de-la-venta.md`.
Rama `reservas-5-cita-caja`, worktree `mipiacetpv-reservas-5`. Base: `cb468bd`. **Sin push.**

**Cobrar una cita abría un ticket nuevo.** El servidor creaba un borrador pre-poblado y lo
enlazaba a la cita; el front le copiaba las líneas al carrito rápido y cobraba por
`POST /tickets`, que crea otro ticket. Cada cita cobrada dejaba un borrador huérfano, y la cita se
quedaba sin `COMPLETED` salvo que alguien pulsara "Finalizar". Ahora la cita entra en contexto de
borrador por la misma puerta que una mesa, el cobro paga **ese** borrador, y la cita se cierra sola.

Es el bloqueante que impedía encender `agendaEnabled` a Sole.

---

## 1 · Lo que hay ahora

| Pieza | Dónde |
|---|---|
| La agenda como vista, no como overlay de la venta | `apps/tpv-web/src/App.tsx` |
| **`enterDraft()`** — LA entrada al contexto de borrador (mesa y cita) | `App.tsx` |
| Contexto de borrador neutro (`draftTicketId`, `isDraftMode`) | `CheckoutPage.tsx` · `SalePage.tsx` |
| `AppointmentContext` (cita, cliente, servicios) | `SalePage.tsx` |
| `COMPLETED` automático al cobrar, degradable y con outbox | `App.tsx` · `lib/agenda.ts` · `lib/outbox.ts` |
| Una cita ya cobrada no se vuelve a cobrar (409) | `apps/api/src/agenda/checkout.ts` |
| Censo de borradores huérfanos (**sólo cuenta**) | `apps/api/src/scripts/audit-appointment-drafts.ts` |
| El camino contra Postgres real | `apps/api/test-e2e/cita-a-caja.e2e.ts` |
| El camino en el front | `apps/tpv-web/test/cita-sale-flow.test.tsx` |
| Banco visual con datos de peluquería y reloj congelado | `apps/tpv-web/visual/main.tsx` |

**Sin migración.** Este bloque no toca el esquema.

---

## 2 · Decisiones tomadas sin preguntar, una a una

### 2.1 La agenda sube a `App` en un commit propio, antes de la lógica

`isTableMode` colgaba de `tableContext` entero y el dueño de la vista es `App`, pero la agenda era
un overlay local de `SalePage`: **el sitio que sabía que había que entrar en contexto de borrador no
era el que podía cambiarlo**. La mudanza va sola, con capturas antes/después **byte a byte
idénticas** (§5), para que el commit que mueve no se confunda con el que cambia.

### 2.2 Un solo camino para abrir un borrador

`enterDraft()` es a la entrada lo que `goToMap()` es a la salida: la única función que cambia la
vista. `pickTable` pasa por ella. **Las líneas nunca se reconstruyen a mano**: o vienen ya mapeadas
del endpoint que abrió el borrador (mesa), o se piden con `GET /tickets/:id` y se mapean con
`mapServerDraftLines` (cita). El mapeo inline de `AgendaPage` se borró: era una copia que ya había
divergido — ponía `holdedProductId: null` y perdía el enlace a Holded que el borrador sí traía.

### 2.3 `isTableMode` se parte en dos preguntas que llevaban tiempo siendo una

- **`isDraftMode`** — el carrito es la proyección de un borrador del servidor (mesa **o** cita):
  las mutaciones van por la API, no hay carrito local, no hay "Nueva venta".
- **`isTableMode`** — además es una mesa: mapa de sala, comensales, comanda a cocina, mover línea.

Mesa no cambia de comportamiento. Es la razón de que sus tests sigan verdes.

### 2.4 El aviso de éxito lo redacta quien llama, no el modal de cobro

`onDraftPaidExit` entregaba la frase `"Mesa cobrada · Ticket 000123"` **desde dentro del núcleo**.
Ahora entrega `internalNumber` y la frase la escribe quien sabe qué se cobró. Lo mismo con la
etiqueta del outbox, que se elegía con `draftTicketId ? "Mesa" : …` y ahora es un prop
(`draftLabel`). ADR-R8: cero vocabulario de vertical en el núcleo.

`tableId` **no** se renombró: es de mesa de verdad (etiqueta el item del outbox para bloquear la
mesa local mientras el cobro está en tránsito).

### 2.5 "Cancelar" en contexto cita **no destruye nada**

En venta rápida el botón vacía el carrito; en mesa anula el borrador y libera la mesa. En cita
ninguna de las dos vale: `clearCart()` vaciaría sólo la proyección local dejando vivo y
desincronizado el borrador del servidor, y anular el borrador dejaría la cita enlazada a un ticket
muerto. **El botón se llama "Volver a la agenda", no es destructivo, y el borrador se queda como
está** — volver a "Cobrar en caja" devuelve el mismo.

### 2.6 La cabecera del ticket dice de **quién** es la cita

"Ticket de venta" no le dice a la cajera cuál de las dos citas de la mañana está cobrando. En mesa
eso lo resuelve "Mesa M3"; aquí lo resuelve el nombre de la clienta, con los servicios debajo. Y en
compacto, donde la barra inferior es lo único visible del ticket, va también ahí.

### 2.7 Una cita ya cobrada se corta **en el servidor**

`checkoutAppointment` devolvía el ticket enlazado sin mirar su estado. Antes daba igual —ese ticket
no se cobraba nunca—; ahora **es** la venta. Devolverlo cobrado pasearía a la cajera por el modal
entero para acabar en un `409 TICKET_ALREADY_PAID`. Se corta antes, con
`409 APPOINTMENT_ALREADY_PAID` y el `ticketId` en la respuesta para poder llevar al ticket.

### 2.8 El `COMPLETED` va en el front, y el dinero manda

Engancharlo dentro de `POST /tickets/:id/checkout` metería la agenda en el camino de cobro, que es
lo que prohíben ADR-010 y ADR-R8 §5. Se dispara sobre `confirmed`, que cubre las dos salidas buenas
del cobro (servidor y outbox). Si falla:

- **4xx** — no se reintenta (daría el mismo 4xx para siempre) y se avisa. El aviso lo enseña la
  agenda **al abrirse**, que es donde está el "Finalizar" que hay que pulsar.
- **sin red / 5xx** — al outbox, y se reintenta al reconectar. `PATCH status=COMPLETED` es
  idempotente por naturaleza.

El outbox era POST-only porque todo lo que llevaba eran altas. Ahora admite `method`, y su ausencia
significa POST: los items ya persistidos en IndexedDB siguen valiendo **sin subir la versión de la
base**.

### 2.9 El censo separa dos poblaciones, y esa es toda la gracia

- **A** · borrador vivo **con un cobro que cuadra al lado** (mismo tenant, mismo turno, mismo
  importe, cobrado después de crearse el borrador). Es el bug.
- **B** · borrador vivo **sin cobro identificado**. Puede ser el bug con un cobro que no casa, o una
  cita que se abrió en caja y nadie llegó a cobrar.

Mezclarlas sería el error caro: **borrar la población B es borrar cobros pendientes de verdad**. El
emparejamiento de A es una heurística y el script lo dice en su propia cabecera. **No borra nada.**

### 2.10 Un test tocado, y sólo la línea que afirma sobre un nombre

`table-map-visual.test.tsx:325` afirmaba sobre el **nombre** del prop (`tableTicketId`). Una
aserción de caja blanca no sobrevive a un rename y no hay forma de evitarlo. El resto de tests de
mesa siguen verdes sin tocarlos. Lo mismo con `initialTableLines` → `initialDraftLines` en 7
ficheros: `sed` puro, cero expectativas cambiadas.

### 2.11 Decisiones que **sí** se preguntaron (§6 de la reconciliación)

**P1 · "Ticket emitido" también en cita.** La condición para el patrón mesa era que el aviso
ofreciera imprimir y el ticket digital; no cabe, porque eso ya existe hecho —con los cuatro estados
de impresión honesta de v1.10.2— y meterlo en un banner sería la tercera copia. Así que en cita el
overlay se monta como en venta rápida y su salida devuelve a la agenda. **La vuelta de v1.15 se ve.**

**P2 · Una cita no se fía**, igual que una mesa. Pero si el tenant tiene `creditSalesEnabled`, el
cobro **dice por qué** no está el botón, en vez de esconderlo.

**P3 · La agenda sube a `App`** con las tres condiciones de Matías: mudanza sin reforma en commit
propio (§2.1), la agenda **no** pasa a ser la pantalla de aterrizaje de `SERVICES` (§8), y un solo
camino para abrir un borrador (§2.2).

---

## 3 · Sabotaje → test rojo

Los diez sabotajes se **aplicaron de verdad** sobre el código, se corrió la suite, y se revirtieron.

| # | Sabotaje aplicado | Qué se puso rojo |
|---|---|---|
| 1 | El puente no enlaza la cita con el borrador (`linkTicket` fuera) | e2e cita **1, 2, 3, 6, 8** — 5 rojos |
| 2 | El GET-back devuelve el ticket aunque ya esté cobrado (revertir §2.7) | e2e cita **6** + unit `agenda-checkout` |
| 3 | El cobro de borrador deja de sellar | e2e cita **4** — y **nada más** (ver §4.1) |
| 4 | La cita deja de ser contexto de borrador (`isDraftMode` = `isTableMode`) | `cita-sale-flow` **1, 2, 3** |
| 5 | El cobro no avisa para marcar `COMPLETED` | `cita-sale-flow` **2** |
| 6 | El borrador quema número de serie al crearse | e2e cita **1** — **pero sólo tras añadir la aserción** |
| 7 | La línea pierde el producto (sku ad-hoc) | e2e cita **1** |
| 8 | El censo mezcla las dos poblaciones | e2e cita **8** — **sólo tras añadir el caso de población B** |
| 9 | El outbox vuelve a POST-only | `outbox.test` — **sólo tras escribir el test** |
| 10 | El censo empareja sin mirar el importe | **NADA** — declarado en §4 |

**Tres sabotajes no pusieron nada rojo la primera vez.** Eso es el valor del ejercicio, no un
trámite:

- **6** — el test afirmaba el número de serie *después* del cobro, que lo sobrescribe. Ahora exige
  que el borrador lleve el marcador provisional `D-`.
- **8** — el escenario del e2e nunca tenía población B, así que vaciarla no rompía nada. Se añadió
  el caso que faltaba: una cita abierta en caja y nunca cobrada.
- **9** — el `method` del outbox no lo probaba nadie. Forzarlo a POST dejaba el `COMPLETED` offline
  muriendo contra una ruta que no existe: el "no puede perderse en silencio" perdiéndose en
  silencio.

---

## 4 · Lo que la suite NO cubre

Escrito para que nadie lo confunda con lo que sí cubre.

1. **El criterio de importe del censo no está ejercitado** (sabotaje 10). Quitarlo no cambia el
   resultado en el escenario porque el criterio temporal (`paid_at >= created_at`) ya excluye ese
   caso. Es una segunda guarda independiente y está sin probar.
2. **La puerta del sello.** Quitar el sello de `POST /tickets/:id/checkout` sólo tumba el test 4 de
   este bloque: el e2e de S1 cubre `POST /tickets` y el fiado, **no** el cobro de borrador. Hasta
   hoy esa puerta no tenía guardia en e2e.
3. **El `PATCH` de `COMPLETED` no se prueba de punta a punta.** El front avisa (test 5) y el
   endpoint responde (e2e 5), pero nadie prueba los dos juntos ni el camino degradado (4xx → aviso
   en la agenda) con un servidor de verdad.
4. **El reintento del outbox al reconectar no se prueba en la cita.** Se prueba que el item sale
   como `PATCH`; no que un `COMPLETED` encolado sin red acabe aplicándose.
5. **`REGISTER_MISMATCH` en cita.** El borrador se crea con la caja de quien pulsó "Cobrar en caja"
   y el checkout exige que coincida. En un centro con dos cajas, quien abre el cobro es quien lo
   cierra. Sole tiene una: no bloquea, y no hay test.
6. **La ventana larga del borrador de cita y `shift_id`.** `shift_id` es columna sellada (S1 §2.4) y
   el borrador fija su turno **al abrirse**, no al cobrarse. Si el turno se cierra en medio, la
   venta se sella en el turno viejo y ya no se corrige sin `ticket_corrections`. Con mesas pasaba
   igual; con citas la ventana es más ancha por diseño. **No lo arregla este bloque.**
7. **El orden de las líneas de un ticket no está definido en ninguna parte.** `ticketInclude()` pide
   `lines: true` sin `orderBy` y `ticket_lines` no tiene columna de orden, así que el `sortOrder`
   del visit no llega al ticket. Preexistente y de toda venta.
8. **Sigue sin haber tests de `AgendaPage` en jsdom** (carryover 5 de B4). Lo que este bloque añade
   es el test del **cobro** de la cita en `SalePage`, no el de la agenda.
9. **Nada de esto se ha visto en hierro.** Ni AP11 ni cajón ni papel. Ver §7.

---

## 5 · Bucle visual

Playwright a **1280×800 (tablet), 390 y 320**, más el estado de error. Capturas en
`docs/blocks/reservas-5-shots/`. El banco visual (`apps/tpv-web/visual/main.tsx`) gana datos de
peluquería —3 profesionales, servicios con `durationMin`, las seis situaciones que la agenda sabe
pintar— y **reloj congelado** (`?at=HH:MM`): sin eso la agenda pinta la línea de "ahora" y hace
auto-scroll hasta ella, y dos capturas de la misma pantalla nunca salen iguales.

| Captura | Qué enseña |
|---|---|
| `f1-antes-agenda-1280.png` / `f1-despues-agenda-1280.png` | **La mudanza sin reforma.** SHA-256 idéntico: `739b45e3…` |
| `f1-antes-entrada-1280.png` / `f1-despues-entrada-1280.png` | Ídem para el punto de entrada: `a2f33cbd…` |
| `f1-despues-entrada-abierta-1280.png` | El botón abre la agenda por el contrato nuevo |
| `f8-cobro-cita-1280.png` | La cita en contexto de borrador: "Rosa Marín", dos líneas, 33,00 € |
| `f8-cobro-cita-390.png` · `f8-cobro-cita-320.png` | En compacto, con la clienta en la barra inferior y en el sheet |
| `f8-agenda-390.png` · `f8-agenda-320.png` | La agenda con la barra ya cabiendo |
| `f8-error-cita-ya-cobrada-1280.png` | El 409: "Esta cita ya se cobró." |
| `f8-ticket-emitido-cita-1280.png` | **La prueba de P1**: CAMBIO 17,00 € a 48 px tras cobrar 33,00 con un billete de 50 |

Las capturas `f1-*` están congeladas en el estado de aquel commit a propósito: son el registro de
esa afirmación, no de la pantalla de hoy.

**Lo que el bucle cambió**, y que ningún test habría cogido:

1. **El botón "Volver" de la agenda medía 20 px de ancho a 390.** El flex lo aplastaba para hacerle
   sitio al título. El estándar de la casa son 64×64 (`ux-principles.md` §1.2). `shrink-0` en todo
   lo que tiene área tocable, y el título "Agenda" se va en compacto.
2. **A 320 lo que se cortaba era "Nueva cita"**, la acción principal. Las flechas de día se van en
   compacto: son redundantes con la tira de días, que hace lo mismo y con el dedo.
3. **Una cita de 30 min mide 33 px y su contenido pide 40**: el `overflow-hidden` cortaba "Corte de
   pelo" por la mitad de las letras. La segunda línea sólo se pinta si cabe entera.
4. **En compacto la barra inferior no decía de quién era la cita.** La mesa ya llevaba su nombre ahí
   por la misma razón.
5. **"Ticket emitido" ofrecía "Nuevo servicio"** cuando lo que hace en cita es volver a la agenda.

**Medido y NO arreglado:** el nombre de línea se trunca a ~90 px en el panel del ticket ("Corte de
pe…"). Es preexistente y de toda venta — en barra, "Café cortado con leche de avena" necesita 226 px
y tiene 96, y el stepper más el bloque total+papelera se comen 228 de los 318 de la fila.
Arreglarlo es rediseñar la fila del ticket (territorio v1.14), no este bloque.

**El aviso de error aparece abajo-centro de la agenda**, mientras la acción que falló vive en el
panel derecho. Es coherente con el resto de toasts de la app, pero en tablet el ojo está en el otro
lado. Anotado, no cambiado.

---

## 6 · Frontera (no se ha cruzado)

- **El camino de cobro a Holded, intacto**: GET-back, tolerancia de 5 céntimos, `/pay` idempotente
  (ADR-010). Este bloque cambia **quién** paga —un borrador que ya existe en vez de un ticket
  nuevo—, no **cómo** se paga.
- **Cero lógica fiscal propia.** Las líneas de servicio van por `serviceId` = `product.id`, nunca
  con sku ad-hoc.
- **Los triggers de S1 no se desactivan ni se esquivan.** El sello se pone donde ya se ponía y el
  e2e comprueba que el motor rechaza un `UPDATE` directo sobre el ticket de la cita.
- **El anti-solape sigue viviendo sólo en la base de datos.** De hecho mordió durante el desarrollo:
  dos citas de la misma profesional a la misma hora las rechazó el `EXCLUDE USING gist` al sembrar
  el e2e. Con el store en memoria de B4 eso no se habría visto nunca.
- **Sin migración, sin tocar el esquema.**
- No se ha borrado ni un borrador huérfano: el censo sólo cuenta.
- No se ha tocado el mapa de sala, la comanda, el cierre de turno ni el catálogo.

---

## 7 · Al desplegar / probar en hierro

1. **No se ha probado en el AP11.** Ni cajón, ni papel térmico, ni la vuelta en mano. La verificación
   en hierro (AP11 de casa, tenant Sirope, cajero de test en modo prueba) queda pendiente.
2. **Sin migración**: nada que aplicar.
3. Antes de encender `agendaEnabled` a nadie, correr el censo:
   `pnpm --filter @mipiacetpv/api audit:appointment-drafts`. Debe dar cero en las dos poblaciones —
   la agenda nunca se ha encendido.
4. El e2e nuevo depende de `E2E_DATABASE_URL` en CI, como el de S1.

---

## 8 · Propuesta aparte (no entra aquí)

**La agenda como pantalla de aterrizaje de los tenants `SERVICES`.** Hoy `SERVICES` aterriza en
`SalePage` (`App.tsx`) y la agenda se abre con un botón. Para una peluquería la agenda **es** el
producto y cobrar es un gesto dentro de ella: lo natural sería entrar en la agenda, como
`HOSPITALITY` entra en el mapa de sala — la simetría ya existe desde este bloque. Es una decisión de
producto y va en su propio bloque.

---

## 9 · Ficheros

**Nuevos**

```
docs/blocks/reservas-5-reconciliacion.md            el Frente 0
apps/api/src/scripts/audit-appointment-drafts.ts    censo de huérfanos (sólo cuenta)
apps/api/test-e2e/cita-a-caja.e2e.ts                el camino contra Postgres real (8)
apps/tpv-web/test/cita-sale-flow.test.tsx           el cobro de la cita en el front (4)
docs/blocks/reservas-5-shots/                       11 capturas
```

**Modificados**

```
apps/tpv-web/src/App.tsx                    la agenda como vista + enterDraft() + COMPLETED
apps/tpv-web/src/pages/SalePage.tsx         AppointmentContext, isDraftMode, copy de cita
apps/tpv-web/src/pages/CheckoutPage.tsx     draftTicketId, draftLabel, onPaid, doneLabel
apps/tpv-web/src/pages/CheckoutPage.successOverlay.tsx  doneLabel
apps/tpv-web/src/pages/AgendaPage.tsx       onEnterDraft (deja de rehidratar) + barra compacta
apps/tpv-web/src/pages/CartLineItem.tsx     la insignia de duración baja de línea
apps/tpv-web/src/pages/TableMapScreen.tsx   redacta su propio aviso
apps/tpv-web/src/lib/agenda.ts              completeAppointment
apps/tpv-web/src/lib/outbox.ts              OutboxItem.method (ausente = POST)
apps/tpv-web/visual/main.tsx                banco: peluquería, reloj congelado, error
apps/api/src/agenda/checkout.ts             la cita cobrada no se vuelve a cobrar
apps/api/src/agenda/routes.ts               ticketId en el 409
apps/api/package.json                       audit:appointment-drafts
```

**Tests tocados** (renames mecánicos, cero expectativas cambiadas salvo donde se dice)

```
apps/tpv-web/test/table-map-visual.test.tsx    la línea que afirma sobre el nombre del prop
apps/tpv-web/test/mesas-concurrencia.test.tsx  + 6 ficheros más: initialTableLines → initialDraftLines
apps/tpv-web/test/outbox.test.ts               + el test del method
apps/api/test/agenda-checkout.test.ts          + el test de la cita ya cobrada
```

---

## 10 · Criterio de "funciona"

| Criterio del prompt | Estado |
|---|---|
| Un solo ticket para esa cita en BD | ✅ e2e 3, por SQL |
| `paid_at` puesto | ✅ e2e 3 |
| `appointment.status = COMPLETED` | ✅ e2e 5 · `cita-sale-flow` 2 |
| Cero borradores sobrantes | ✅ e2e 3 y 7 |
| El cobro no crea un ticket nuevo | ✅ e2e 3 · `cita-sale-flow` 1 |
| Entrar dos veces lleva al mismo borrador | ✅ e2e 2 |
| Los tests de mesa siguen verdes | ✅ salvo una aserción sobre un nombre (§2.10) |
| Script de auditoría que sólo cuenta | ✅ y ejecutado de verdad dentro del e2e |
| Camino de cobro a Holded intacto | ✅ §6 |
| Bucle visual 1280/390/320 + error | ✅ §5 |
| Tabla de sabotaje con sabotajes reales | ✅ §3, 10 sabotajes, 3 huecos destapados |
| Test contra Postgres real | ✅ 8 tests |
| **Verificado en hierro** | ❌ pendiente (§7.1) |

Suite: **176/177 ficheros, 1553 tests verdes**. El único rojo es `infra/bundle-android`, y es
**preexistente** (el bundle pesa 2,1 MB y se pasa del límite de precache de workbox; comprobado con
`git stash`). e2e: **3 ficheros, 30 tests**. `tsc --noEmit` limpio en api, tpv-web y admin.

**Nota de método:** la suite de tpv-web **no está rota en este Mac**.
`pnpm --filter @mipiacetpv/tpv-web test` corre `vitest` dentro del paquete y no ve el
`environment: jsdom` que declara `vitest.workspace.ts` de la raíz — de ahí los 219 fallos con
`localStorage is not defined`. El comando bueno es `npx vitest run --project tpv-web` o `pnpm test`
en la raíz.

---

## 11 · Commits

```
33176a4  docs(reservas-5): reconciliacion del prompt con S1 y v1.15
57ab39b  refactor(reservas-5): la agenda sube a App, sin reforma
1b22cec  refactor(reservas-5): contexto de DRAFT neutro en el nucleo
3ba5cfd  feat(reservas-5): la cita entra en contexto de borrador y deja de rehidratar
aed9945  feat(reservas-5): la cita se finaliza sola al cobrarse
76724a8  fix(reservas-5): una cita ya cobrada no se vuelve a cobrar
4567beb  feat(reservas-5): censo de borradores de cita huerfanos
b648708  test(reservas-5): el camino cita -> ticket contra Postgres real
56a4486  test(reservas-5): tabla de sabotaje, y los tres huecos que destapo
aee1b70  fix(reservas-5): bucle visual · lo que las capturas destaparon
```

Último commit de código: **`aee1b70e024332fc9b248aac0cd2f93e9ac2b2cc`**
(`fix(reservas-5): bucle visual · lo que las capturas destaparon`).
Este documento va encima, en `docs(reservas-5): done · …`.

---

## 12 · El siguiente bloque para encender la agenda a Sole

El orden lo decide Matías. Mi propuesta, con el porqué:

### **B-reservas-6 · yield** — y no B-7 ni B-9

De los tres, **B-6 es el único que impide una llamada de teléfono a Sole**. Los otros dos hacen que
la agenda mienta; B-6 hace que la agenda **acepte algo imposible**:

- **Hoy se puede reservar en el pasado.** No hay antelación mínima ni ningún guardarraíl temporal
  (`docs/reservas/03-que-falta` §1). Una clienta que reserve por teléfono para "las once" cuando son
  las doce entra sin que nada chirríe. Eso no es una configuración que falte: es una cita que no
  existe, en la agenda de un centro que trabaja sobre ella.
- **El `EXCLUDE` sigue sin ejercitarse en producción** (§1 del mismo doc). B-6 lo trae consigo. Este
  bloque ya ha visto que muerde en Postgres real —y eso fue un hallazgo, no una prueba diseñada—,
  pero en producción nadie ha reservado nunca dos veces el mismo hueco.
- Y el aviso del arranque manda: **toda regla se aplica al listar la disponibilidad Y al reservar**.
  Si sólo filtra al listar, basta con adivinar la hora y llamar al endpoint. Eso también es hoy.

**Por qué no B-7 antes.** Sin horario de centro ni festivos, los huecos salen de los turnos del
personal y un festivo se bloquea a mano, día a día. Es trabajo para Sole, y es molesto — pero es
trabajo que **ella puede hacer** y que sale bien mientras lo haga. B-6 protege de un fallo que ella
no puede ver venir.

**Por qué no B-9 antes.** "Un servicio sin nadie asignado devuelve cero huecos en silencio" es un
fallo de configuración, y al spa le costó dos semanas. Pero en el arranque de Sole —3 profesionales,
un puñado de servicios, y nosotros acompañando— la matriz se revisa a mano en diez minutos. El panel
paga cuando el centro crece o cuando ya no hay acompañamiento. Además **la tarjeta 2 depende de D-5**
(§4 de `03-que-falta`), así que entra a medias.

**Ojo con la secuencia real de implantación:** encender `agendaEnabled` a Sole son cuatro pasos de
configuración y **no dependen de B-6**. Si el plan es pilotar acompañando —que es lo que dice
`03-que-falta` §1— la agenda ya se puede encender hoy, con B-5 dentro. B-6 es lo que hace falta para
**dejarla sola con ella**.
