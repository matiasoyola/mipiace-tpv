# Bloque v1.16 · el producto correcto y la comanda que llega

## Contexto (leer antes)

- `docs/qa/2026-09-02-auditoria-por-procesos.md` — la auditoría sobre el AP11 físico. **B4, B3, E4, E5.**
- `docs/qa/2026-09-02-backlog-ordenado.md` — el orden del backlog y por qué este bloque va aquí.
- `docs/blocks/v1-15-la-vuelta-existe-done.md` — el bloque anterior, ya en producción.
- `docs/ux-principles.md` y `docs/tokens.md`. Mandan sobre cualquier medida que inventes.
- Skills `sistema-visual-mipiace` y `metodologia-front-mipiace`.

## El problema, en una frase

**El TPV no distingue dos productos distintos, y no sabe si la comanda llegó a la cocina.** Lo
primero puede hacer que un celíaco coma gluten; lo segundo hace que el camarero mande la misma
comanda dos veces, o ninguna, sin forma de averiguarlo.

## Lo ya localizado (verificado en el código el 2026-09-02 · no volver a investigarlo)

### El nombre se corta en los dos únicos sitios donde se podría comprobar

- **La tarjeta del catálogo**: `apps/tpv-web/src/pages/SalePage.tsx:2592-2601` (`ProductTile`).
  El nombre va con `line-clamp-2` a 13,5 px en una caja de ~127 px. El catálogo de Sirope tiene
  **diez pares** `Desayuno N` / `Desayuno N (Sin gluten)`: las dos tarjetas leen
  `Desayuno 1 · Café + Tostada manteq…`. Y **`Desayuno 4` y `Desayuno 4 (Sin gluten)` cuestan los
  dos 3,00 €** — en pantalla son literalmente el mismo botón.
- **La línea del ticket**: `apps/tpv-web/src/pages/CartLineItem.tsx:161` usa `truncate`, o sea
  **una sola línea**. Después de pulsar tampoco se puede verificar qué se añadió.

**Restricción dura**: el alto de la tarjeta entra por `style` con `PRODUCT_CARD_MIN_HEIGHT`
(`SalePage.tsx:2559`) **a propósito**, porque es la misma constante que usa `catalogRowsVisible`
para decidir cuántas filas caben. Si creces la tarjeta, cambias cuántos productos se ven sin
desplazar. Ese trueque hay que medirlo y escribirlo, no darlo por bueno.

### El front no sabe si la comanda se envió, y el backend sí

- El servidor **persiste la verdad**: `Ticket.lastSentAt` y `Ticket.lastSentRevision`
  (`packages/db/prisma/schema.prisma:1109-1119`), escritos en `kitchen-dispatch.ts:213`. Y el
  comentario del esquema, desde v1.4, describe el comportamiento que se pretendía: *"El TPV pinta
  'Enviar comanda' cuando hay líneas más nuevas que este timestamp y 'Reenviar comanda' cuando
  coinciden con lastSentRevision"*. **Nunca se implementó en el front.** No estás inventando
  comportamiento nuevo: estás cumpliendo el contrato que la columna lleva anunciando desde que
  existe.
- El front **no la lee**. `SalePage.tsx:408` declara `kitchenRevision` como estado local que
  **arranca en 0**, y `SalePage.tsx:444-449` lo **reinicia a 0** cada vez que cambia
  `activeTicketId`. El comentario de `:441` lo dice con todas las letras: *"El backend mantiene la
  verdad (Ticket.lastSentRevision), pero como SalePage no recarga el ticket DRAFT entre
  interacciones, este state es el que decide si el botón rotula Enviar o Reenviar"*.
- **Consecuencia**: el camarero manda la comanda de la M3, atiende otra mesa, vuelve a la M3 — y el
  botón vuelve a decir "Enviar comanda". No hay nada en la pantalla que diga que la cocina ya la
  tiene. Recargar la app produce el mismo olvido.

### El error de impresora habla como un administrador y no deja rastro

- El mensaje se construye en `apps/api/src/tickets/kitchen-dispatch.ts:145`:
  `` `Falta configurar impresora WIFI para la sección ${sec} en este register.` `` — **"register"**
  sin traducir y **`${sec}`** en crudo del enum de base de datos (`SALON`, `BARRA`, `COCINA`).
- El front lo pinta en `SalePage.tsx:2237-2262` (`KitchenErrorBanner`), tapando el título del panel,
  con una única salida de 83 × 32 px, y al descartarlo **el ticket queda idéntico**.
- **El mismo fallo, en la otra ruta, se trata al revés**: al emitir el ticket de venta,
  `CheckoutPage.successOverlay.tsx` resuelve `phase: "no-printer"` y lo enseña como una nota gris
  tranquila dentro de "Ticket emitido". Dos tratamientos opuestos para la misma causa.
- El front usa la ruta `/send-to-kitchen/escpos` (`SalePage.tsx:1464`). `send-to-kitchen.ts` es la
  legacy y **no la llama nadie desde el TPV**: no inviertas ahí, pero que no se separen.

### La jerarquía del pie ya se decidió una vez, y la auditoría la vio después

`SalePage.tsx:3748-3762` documenta la decisión de **v1.14.1**: "Cobrar" se lleva dos tercios del
ancho, `touch-lg` y el único coral pleno; "Enviar comanda" baja a `touch` (48) y pierde el borde
coral. La auditoría del 02-09 corrió **sobre v1.14.1** y aun así llamó invertida la jerarquía.

**No son dos opiniones: son dos estados distintos de la misma pantalla.** Con líneas sin enviar, lo
que toca es enviar; cobrar llega veinte minutos después. Una vez enviada, "Cobrar" manda. Y el
propio código ya lo pretendía —`SalePage.tsx:3774-3776`: *"Primer envío rotula como acción
primaria; reenvíos quedan discretos"*— pero **no puede cumplirlo**, porque no sabe si hubo primer
envío. **E4 no se puede hacer sin B3.** Por eso van en el mismo bloque.

### El deshabilitado no se lee como deshabilitado

`SalePage.tsx:3810` y `CheckoutPage.tsx:1145` pintan la CTA con `bg-mipiace-coral` +
`disabled:opacity-50`. La auditoría lo describió como "coral pleno idéntico al habilitado"; medido
en el código es coral **al 50 %**, que sobre blanco sigue siendo un coral saturado con texto blanco.
El matiz no cambia el problema: **"Cobrar 0,00 €" con el ticket vacío sigue invitando a pulsarlo**.
No hay estado deshabilitado en el sistema visual, sólo una opacidad. Eso es lo que falta.

## Alcance

### 1 · B4 · Dos productos distintos no se pueden dibujar iguales

**El criterio de aceptación es de comportamiento, no de píxeles**: dado el catálogo real de Sirope,
**no puede existir ningún par de tarjetas de producto visualmente indistinguibles**. Ni en la
rejilla, ni en la línea del ticket.

Decide tú el mecanismo y justifícalo en el `-done`. Las tres vías obvias, con su coste:

- **Truncar por el medio** en vez de por el final (`Desayuno 4 · Café + Cro… (Sin gluten)`): barato,
  no toca el alto, y salva justo el caso que importa —la coletilla que distingue vive al final.
- **Reservar una línea para el discriminante**: más caro en alto, y hay que decidir qué es
  discriminante sin inventar un campo nuevo en el catálogo.
- **Crecer la tarjeta**: paga `catalogRowsVisible`. Si vas por aquí, **da el número medido de filas
  antes y después** a 1280 × 800.

Sea cual sea, **la línea del ticket tiene que dejar de ser `truncate` de una línea**: es el único
sitio donde se verifica lo ya añadido.

**No inventes un campo `variant` ni un modelo de alérgenos.** Esto se resuelve con lo que ya hay en
`product.name`. Un modelo de variantes es un bloque propio y no es este.

### 2 · B3 · El front lee `lastSentRevision`, y el error habla en cristiano

**2.a · La verdad viene del servidor.** El endpoint que hidrata el DRAFT de mesa expone
`lastSentAt` y `lastSentRevision`, y `SalePage` los usa para inicializar `kitchenRevision` en vez
de arrancar en 0. Volver a la mesa, o recargar la app, tiene que enseñar el mismo estado.

**2.b · El ticket dice si la comanda está enviada.** Con `lastSentAt != null`, el panel lo dice —
sitio y forma los eliges tú, pero tiene que verse **sin abrir nada** y tiene que sobrevivir a salir
y volver a entrar en la mesa. Si hay líneas añadidas después del último envío, eso también se dice:
es el caso que hace que un camarero mande la comanda dos veces.

**2.c · El mensaje deja de ser de administrador.** `kitchen-dispatch.ts:145` deja de escupir
`${sec}` en crudo y la palabra "register": sección con su nombre de cara al usuario y "esta caja".
El mapa enum → etiqueta va en **un solo sitio** y compartido con el resto de la app, no un `switch`
copiado en el banner.

**2.d · Los dos fallos de impresora se tratan igual.** "No hay impresora para esa sección" no es un
error del camarero y no debe bloquear: acércalo al tratamiento tranquilo del `successOverlay`. "La
impresora falló" sí mantiene el banner con reintento (v1.10.2 decidió que un fallo de impresión no
se autocierra: **eso no se toca**). Y en los dos casos, tras descartar, **el ticket tiene que
quedar distinto que si hubiera salido bien**.

### 3 · E4 · La jerarquía del pie sigue al estado, no a una preferencia

Con `tableContext` y **comanda sin enviar** (o con líneas nuevas desde el último envío), "Enviar
comanda" es la acción primaria de la pantalla. Con la comanda al día, manda "Cobrar" y "Enviar"
queda discreto, exactamente como hoy.

**Restricciones**: `docs/tokens.md` §4 cierra la escala táctil en 64 px — no aparece ningún
`h-[72px]`. Sólo un coral pleno a la vez en la pantalla. El pie no crece: sigue siendo la rejilla
`grid-cols-[1fr_1.6fr]` en una fila, porque apilarlo se come el desglose que v1.14 vino a
recuperar. Lo que cambia con el estado es **cuál de las dos columnas se lleva el peso**.

### 4 · E5 · Un botón deshabilitado se ve deshabilitado

Estado deshabilitado de verdad para la CTA primaria, **como token del sistema visual**, no como una
clase suelta en dos ficheros: sin coral saturado, sin texto blanco sobre coral. Aplícalo en los dos
sitios (`SalePage.tsx:3810` y `CheckoutPage.tsx:1145`) y en cualquier otro que tenga el mismo
`disabled:opacity-50` sobre `bg-mipiace-coral`. Contraste **AA sobre el fondo real**, medido.

Si tocas `tokens.md`, dilo en el `-done` con el antes y el después.

## Verificación

Tabla **sabotaje → test rojo**, con los sabotajes aplicados de verdad sobre el código y revertidos:

| Sabotaje | Debe caer |
|---|---|
| Volver el nombre de la tarjeta a `line-clamp-2` por el final | test de que dos productos del catálogo de Sirope con el mismo precio no rinden el mismo texto visible |
| Volver la línea del ticket a `truncate` de una línea | test de que la línea distingue `Desayuno 4` de `Desayuno 4 (Sin gluten)` |
| Inicializar `kitchenRevision` a 0 ignorando `lastSentRevision` | test de que al remontar la mesa el botón sigue diciendo "Reenviar" |
| Quitar la marca de "comanda enviada" del panel | test de que un DRAFT con `lastSentAt` la enseña |
| Añadir una línea sin marcar la comanda como desactualizada | test de que tras añadir línea el ticket avisa de que la cocina no la tiene |
| Devolver `${sec}` en crudo en el mensaje de impresora | test de que el mensaje no contiene `SALON` ni la palabra "register" |
| Hacer que "no hay impresora" bloquee como "la impresora falló" | test de que los dos casos tienen tratamiento distinto |
| Fijar la jerarquía del pie a la de v1.14.1 | test de que con comanda sin enviar la acción primaria es "Enviar comanda" |
| Lo mismo, al revés | test de que con la comanda al día la acción primaria vuelve a ser "Cobrar" |
| Devolver la CTA deshabilitada a `disabled:opacity-50` sobre coral | test de contraste / de que el deshabilitado no usa el color de la acción |

**El caso canónico de la suite** es el de la auditoría: mesa M3 del tenant Sirope, dos `Desayuno 4`
—uno normal y uno sin gluten—, comanda enviada, se añade una tercera línea, se sale de la mesa y se
vuelve a entrar.

Y declara **qué NO cubre la suite**.

**Bucle visual**: Playwright a 1280 × 800 para (a) la rejilla del catálogo con los diez pares de
Sirope, (b) el panel del ticket con comanda enviada y con líneas nuevas después, (c) el pie en sus
dos estados, (d) la CTA deshabilitada.

Cierra con `docs/blocks/v1-16-el-producto-correcto-done.md`, con las decisiones tomadas sin
preguntarlas una a una, y con el número medido de filas de catálogo antes y después si tocaste el
alto de la tarjeta.

## Fuera de alcance (explícito)

- **No toques el modal de cobro.** El pre-relleno del CashPad (C2), el exceso en verde (C3), "Más
  opciones" bajo el pie (C5) y el teclado del sistema en "últ. 4" (C4) son **v1.18**, junto con los
  cobros parciales. Aquí de `CheckoutPage.tsx` sólo se toca el estado deshabilitado del botón.
- **No toques "Partir cuenta"** (`SalePage.splitBill.tsx`). Puede cobrar dos veces y **eso se
  arregla en v1.18**, con el modal delante. Aquí ni se mira.
- No toques el cierre de día ni el arqueo (B2, C9, C10, C11): son **v1.17**.
- No toques el orden del catálogo (C6), el hueco del panel (C7) ni la densidad (C8, C12): son
  **v1.20**.
- **No toques `z-breakdown.ts`, `payments.ts` ni nada de v1.15.** Acaba de desplegarse.
- No inventes un modelo de variantes, de alérgenos ni de modificadores nuevo.
- Nada de tocar `send-to-kitchen.ts` (legacy) más allá de que no se separe de `kitchen-dispatch.ts`.
