# Bloque auditoria-sirope · los 29 hallazgos, uno a uno

Rama `auditoria-sirope` desde `master` (`9523a6f`). Dieciocho commits, uno o
varios por hallazgo, con su número en el mensaje.

Lo que se audita es `docs/qa/2026-10-18-sirope-auditoria.md`: el recorrido del
18-10 por la cuenta real de **Cafetería Sirope** (en ensayo) en su hierro —el
D8 como caja (viewport 1442 × 811) y el AP11-1006 como pantalla de cocina
(1280 × 800)—. Las capturas del antes están en `docs/qa/2026-10-18-sirope/`;
las del después, en `docs/qa/2026-10-18-sirope-done/`.

**Los 29 están hechos.** Lo único que no llega a su objetivo numérico es el
«≥ 6 líneas visibles» de #8: se queda en 4 enteras más una parcial, medidas.
Está explicado abajo, en su sitio.

---

## A · Lo que frena a Sirope

### #17 🔴 Devoluciones imposibles en cuentas sin Holded y en ensayo

**Qué pasaba.** La pregunta «¿se puede devolver este ticket?» se contestaba en
dos sitios con dos respuestas distintas. El servidor aceptaba `SYNCED`, `PAID`
y `TEST`; el TPV sólo pintaba el botón con `SYNCED`, o con `TEST` más el modo
prueba ANTIGUO (el cajero técnico del super-admin). Las dos formas de cobrar
que tiene una cuenta de hoy caían en el hueco: sin Holded el ticket nace
`PAID` y no pasa nunca por `SYNCED`, y en ensayo nace `TEST` sin que haya
ninguna sesión técnica detrás. El servidor habría devuelto el dinero en los
dos casos; no había forma de pedírselo. (Captura 31.)

**Qué se hizo.** `packages/ticket-model/src/devolucion.ts` (nuevo):
`esDevolvible`, `motivoNoDevolvible`, `mensajeNoDevolvible`. El contexto son
dos señales que ya existían — la cuenta en ensayo (`facturaDesde == null`) y la
sesión de prueba. La miran el servidor (`tickets/routes.ts`) y el TPV
(`TicketsHistoryPage.tsx`). Cuando dice que no, **se dice**: el motivo queda
escrito en la ficha en vez de desaparecer el botón. Y el 409 ya no dice
«sincronizado con Holded» a un comercio que no usa Holded.

**Decisión sin preguntar.** `PENDING_SYNC` sigue sin ser devolvible: es lo que
el servidor rechazaba antes del bloque, dura segundos y la devolución se
calcula sobre un documento de Holded que todavía no existe.

**Tests.** `packages/ticket-model/test/devolucion.test.ts`,
`apps/api/test/devolucion-sirope.test.ts`,
`apps/tpv-web/test/devolucion-sirope.test.tsx`, y el recorrido completo en
`apps/api/test-e2e/auditoria-sirope.e2e.ts`.

### #25 🔴 En venta rápida, «Enviar» no mandaba nada a cocina

**Qué pasaba.** `SalePage.sendToKitchen` empezaba con
`if (!tableContext?.activeTicketId) return;`. Sin mesa el envío terminaba en
seco y el botón seguía encendido, sin aviso. Sirope trabaja casi todo en
mostrador: lo que se pedía en la barra no llegaba nunca a la cocina. (Capturas
76, 77.) La causa de fondo es que una venta rápida **no existe en el
servidor** hasta que se cobra, y la comanda se manda sobre un ticket.

**Qué se hizo.**

- `POST /mostrador/draft` (`apps/api/src/tickets/mostrador.ts`, nuevo): crea el
  DRAFT de la venta rápida con sus líneas. A partir de ahí la venta de
  mostrador es un borrador como el de una mesa — y el cobro va por
  `/tickets/:id/checkout`, que es lo que hace que cobrar CIERRE la comanda en
  vez de dejarla viva (#22).
- `POST /mostrador/:id/lines`: lo que se marca después del primer envío va al
  servidor, igual que en una mesa y con la misma función
  (`anadirLineaAlDraft`, extraída de `tables/operativa.ts`).
- `Ticket.counterNumber` (migración `20261018100000_mostrador_a_cocina`):
  correlativo **por día y por caja**. La tarjeta de cocina se titula «Mostrador
  nº 3» en vez de «#1». El título lo escribe una sola función
  (`apps/api/src/kitchen/titulo.ts`) para la tarjeta, el papel ESC/POS y el
  aviso de «listo para servir».
- El TPV recuerda su venta de mostrador en `sessionStorage`: una recarga no
  puede dejar un borrador abierto en el servidor y sin dueño en la pantalla.
- **Cobrar con líneas sin mandar**: en mostrador salen solas (se paga primero
  y se prepara después); en una mesa se pregunta, con tres salidas —«Enviar y
  cobrar», «Cobrar sin enviar», «Volver»—, porque el Atrás del sistema no
  puede decidir ninguna de las dos.
- **Nunca un botón mudo**: comanda vacía, cuenta sin Cocina y borrador que no
  se puede crear dicen por qué.

**Decisiones sin preguntar.** El número es por CAJA y no por tienda (dos
barras cantan «el 3» cada una con el suyo); `MAX + 1` y no `COUNT + 1` (un
borrador anulado deja su número gastado en vez de repetirlo); el contexto de
mostrador vive dentro de `SalePage` y no en `App` (subirlo obligaba a remontar
la pantalla del carrito en mitad del gesto); un precio cambiado con el lápiz
viaja como `unitPrice` del borrador.

**Lo que destapó.** El borrador nace con el propio envío, así que
`activeTicketId` pasa de `null` a un id en mitad del gesto, y el efecto que
limpia el estado de comanda al cambiar de cuenta **se llevaba por delante el
aviso de la comanda que acababa de salir**. `null → id` es la misma venta
estrenando borrador, no un cambio de cuenta.

**Tests.** `apps/tpv-web/test/mostrador-a-cocina.test.tsx`,
`apps/api/test/mostrador-a-cocina.test.ts`, y el recorrido e2e.

### #2 Pasar de Efectivo a otro método arrastraba el importe

`pickMethod` cambiaba el método «sin perder importe»: con 10 € tecleados sobre
una cuenta de 3 €, tocar Tarjeta dejaba «Sobran 7 € · baja el importe» y
«Cobrar» en gris. Un error de dedo convertido en callejón. (Capturas 16, 17.)
El importe tecleado pertenece al método con el que se tecleó, así que al
cambiar vuelve al total **en los dos sentidos** — a tarjeta porque ahí no hay
nada que entregar, y de vuelta a efectivo porque es el importe exacto con el
que empieza la hoja.

**Test.** `apps/tpv-web/test/cobro-sirope.test.tsx`.

### #22 Cobrar la mesa no daba por servido lo que estaba «Listo»

Tras cobrar la T6 la mesa quedaba libre con la etiqueta LISTO, el AP11 la
seguía esperando y la banda «T6 · listo para servir» aparecía encima de las
ventas siguientes (capturas 73, 74, 81): `servedAt` sólo lo ponía el toque del
camarero en la banda.

Ahora, cuando un ticket deja de estar vivo —se cobra o se vacía—, sus comandas
LISTAS pasan a servidas con el **mismo evento** que el toque
(`apps/api/src/kitchen/servir.ts`), para que se apague a la vez en todos los
TPV y en la tablet.

**Decisión sin preguntar.** Lo que NO está listo no se toca: un plato en la
plancha sigue en la plancha aunque la cuenta esté pagada, y la cocina tiene
que verlo. Además el CHECK `kitchen_orders_cronologia` exige
`served_at >= ready_at`.

**Test.** El e2e del bloque, contra Postgres.

---

## B · Cocina

### #19 Encender Cocina sin secciones mandaba todo a «Salón» en silencio

La primera comanda de la T6 se perdió y el D8 dijo «Comanda nº 1 enviada ·
SALÓN: 3 líneas» (capturas 55, 56, 59, 60). Tres cosas:

- **Comanderas** lista las etiquetas REALES del catálogo
  (`GET /admin/tag-sections/etiquetas`) con un selector Barra / Cocina / Salón
  al lado de cada una. Fuera el campo de texto libre —una etiqueta mal
  tecleada no daba error— y fuera la palabra Holded, que Sirope no usa.
- Al enviar, las secciones sin pantalla ni impresora se cuentan aparte: «3
  líneas sin destino: Salón. Nadie las ha visto en cocina». Si no llegó nada,
  el aviso no es verde y no dice «enviada».
- Con Cocina encendida y etiquetas sin sección, lo avisan el panel (en la
  propia sección de Cocina de la tienda) y el super-admin (#23).

**Tests.** `apps/admin/test/comanderas-sirope.test.tsx` y el caso «sin
destino» de `apps/tpv-web/test/mostrador-a-cocina.test.tsx`.

### #20 La caja no se enteraba de Cocina hasta reiniciar la app

`useDeviceBootstrap` leía `/devices/me` al arrancar y lo cacheaba. Ahora hay un
repaso silencioso: al volver al primer plano, cada minuto, y con un evento del
bus cuando el super-admin cambia un módulo (`tenant.settings_changed`, emitido
a todas las tiendas del tenant). El evento no trae el ajuste dentro: el TPV
vuelve a pedir `/devices/me`, que es la verdad.

**Decisión sin preguntar.** Silencioso de verdad: un repaso que falla deja el
terminal exactamente como estaba. Una caja no se cae porque un repaso de
ajustes no llegue.

**Test.** `apps/tpv-web/test/ajustes-al-dia.test.tsx`.

### #21 Al reiniciar la app del D8 se quedaba en blanco

**Lo que se descartó, y con qué.**

- **El bundle no es el problema.** `apps/tpv-web/vite.config.ts` no fija
  `build.target`, así que Vite emite para su objetivo por defecto
  (`chrome87`): nada de lo que compila necesita un motor posterior al 101. Y
  el código no usa ninguna API moderna de las que rompen en ese rango
  (`structuredClone`, `Object.hasOwn`, `findLast`, `toSorted`, `:has()`):
  comprobado con una pasada sobre `apps/tpv-web/src`.
- **No hay nada que pueda colgarse antes del primer pintado.** `main.tsx`
  llama a `initSentry`, `installGlobalErrorLogging`, `installLogBuffer`,
  `consumeTestModeFromUrl`, `bootstrapPrinters` y `registerSW` —todos
  síncronos— y a `runVersionCheck` sin `await`. React monta siempre, y la
  primera pantalla de `App` (el `loading` del bootstrap) pinta algo.
- **No es el Service Worker.** El build de Android no lo registra (A4), y el
  rescate nativo (`WebViewRescue`) sólo purga al cambiar de `versionCode`, así
  que no interviene en un reinicio de la misma versión.

**Lo que queda, y encaja con todo lo medido.** El proceso de render del
WebView. `Displayed +667ms` dice que la Activity pintó; logcat en silencio
dice que no hubo excepción; y que sólo lo arregle **reiniciar el aparato** —no
la app— apunta al renderer del sistema y no a nuestro código. Es el mismo
patrón que el N1 («a la segunda apertura, blanco: Android niega el renderer y
sólo lo limpia un reinicio»). Lo siguiente con el hierro delante es actualizar
el Android System WebView del D8 —el 101 es de abril de 2022— y, si vuelve a
pasar, manejar `onRenderProcessGone` en el shell nativo. **No se ha tocado el
shell nativo en este bloque**: no se puede probar sin el aparato, y un cambio
a ciegas en el arranque es peor que el fallo.

**Lo que sí se entrega, pase lo que pase: el vigilante.** Si en 8 segundos
nadie ha dicho «ya he pintado», la pantalla enseña «No ha arrancado bien ·
Reintentar». El reloj lo arranca un script **clásico en línea** dentro de
`index.html`, no un módulo: si lo que falla es el bundle, un módulo no llega a
ejecutarse nunca. El parte queda en `localStorage` y lo manda a Sentry el
primer arranque bueno, con el user-agent (que lleva la versión del WebView) y
la del bundle.

**Límite conocido.** Si lo que está muerto es el renderer, **el vigilante
tampoco pinta**: no hay nada que pueda dibujar. Cubre las otras causas —bundle
que no llega, JS que revienta antes de montar, arranque colgado—, y eso es lo
que se puede cubrir desde el WebView.

**Test.** `apps/tpv-web/test/vigilante-arranque.test.ts`, que ejecuta el script
tal cual está en `index.html` y comprueba además que sigue siendo ES5.

### #23 Cocina no se gestionaba desde el panel

Interruptor de Cocina en la ficha del super-admin, con lo que hay que saber
antes de tocarlo: al encender, cuántas etiquetas del catálogo no tienen
sección; al apagar, cuántas pantallas se quedan a oscuras. Y
`PATCH /admin/devices/:id/kitchen-sections`: cambiar las secciones de una
pantalla **sin revocarla**, con sus botones en Dispositivos. Antes, pasar de
«Cocina» a «Cocina + Barra» obligaba a revocar y teclear seis dígitos en una
tablet colgada de la pared.

**Decisión sin preguntar.** Una pantalla no se puede quedar sin ninguna
sección: no recibiría nada.

**Test.** `apps/api/test/cocina-desde-el-panel.test.ts`.

### #26 En una pantalla compartida, Cocina y Barra sólo se distinguían por una palabra

Era una palabra de 13 px dentro del eyebrow, entre «2ª COMANDA» y «LLEGÓ
TARDE» (captura 60). Ahora cada sección tiene su franja, con su nombre grande
y su color propio —violeta, cian y pizarra—, ninguno de los que ya significan
algo aquí: verde→ámbar→rojo es el semáforo y el rojo pleno es urgente y
alergia. El tiempo pasa a su pastilla con borde.

**Test.** `apps/tpv-web/test/kds-sirope.test.tsx`. Capturas: `cocina-ap11-*`.

### #24 Franja muerta en la pantalla de cocina

La franja «+N» se pintaba siempre, vacía incluida, para que la zona de
tarjetas no cambiara de ancho y el reparto no oscilara. El precio eran 90 px
muertos siempre que todo cabe, que es el caso normal (capturas 51, 60). Se le
da la vuelta: **el ancho se reserva en la cuenta, siempre**, y la franja sólo
se pinta cuando hay algo que decir. El reparto mide contra el caso estrecho,
así que cuando la franja aparece las tarjetas siguen cabiendo.

### #12 Con Cocina apagada, el TPV hablaba de cocina

«EN COCINA», «Comanda nº 1 enviada» y «Reenviar (nº 2)» sin nadie al otro lado
(captura 27). Sin destino: no hay botón «Enviar», no hay rótulos «EN COCINA»
ni «SIN ENVIAR», y la hoja de la comanda se llama «Pedido». Las líneas se
pintan igual: lo que se va es el rótulo, no el pedido.

**Decisión sin preguntar.** «Hay destino» no es «el módulo está encendido»:
una barra con térmica y sin pantalla manda comandas con el módulo apagado, y
una cuenta con el módulo encendido y nada emparejado **sí** ofrece el botón,
porque el implantador tiene que poder probar el camino y el aviso «sin
destino» de #19 ya cuenta lo que pasa.

Y «Reenviar» sólo se ofrece con líneas nuevas: reenviar lo mismo gasta número
de comanda y pinta una tarjeta vacía en la pantalla del cocinero. **Lo que se
pierde**, y conviene saberlo: ya no hay forma de reimprimir desde el TPV una
comanda de papel que se perdió. Si en una barra con impresora eso hace falta,
es un botón aparte y no éste.

---

## C · Cobro

### #1 El cambio quedaba en segundo plano

El cambio iba a 15 px coral y el TOTAL a 30 (capturas 02, 03). El cajero con
el billete en la mano no necesita el total: necesita cuánto devuelve, y antes
de pulsar Cobrar. Ahora el pie copia el recuadro de «Ticket emitido»:
**«CAMBIO A DEVOLVER» a 44 px en tinta**, con el total y lo entregado pequeños
debajo. Sin cambio, el pie se queda como estaba.

**Con el CashPad abierto** el recuadro baja a una línea: el entero mide 150 px
y empujaba «Cobrar» fuera de pantalla a 1280 × 800 (lo vio el bucle visual de
este mismo bloque). Mientras se teclea, el cambio es un número que cambia a
cada tecla; al cerrar el pad vuelve a mandar. Capturas `cobro-cashpad-*`:
«Cobrar» visible sin scroll en los dos viewports.

### #3 Los billetes sustituían en vez de sumar

v1.3 los hizo SET («el piloto se confundía al ver 10 + tap 20 = 30»). En una
barra el cliente deja varios billetes y 10 + 5 son 15. El PRIMER billete
sustituye el importe exacto que trae la hoja —que es lo que salvaba la
decisión vieja— y los siguientes suman. «C» deja a cero.

**Decisión sin preguntar.** Lo que el cajero escribe a mano también es suyo:
el billete que venga después suma encima. Para empezar de cero está «C».

### #4 En la hoja de cobro mandaba lo que no importa

Título con la cifra («Cobrar 3,00 €»); Subtotal e IVA plegados —dos números
que no se usan para cobrar— con el descuento fuera del pliegue, porque ése sí
cambia lo que se cobra; «Importe exacto» deja de ser una barra coral a ancho
completo y baja a la fila de los billetes como una tecla más; y la franja de
estado dice «Entregado 5,00 €». Lo que sobra en efectivo no es un aviso: es el
cambio, y tiene su recuadro. Sigue siendo aviso lo que NO sale del cajón
(pagar 15 con tarjeta una cuenta de 14), porque ahí «Cobrar» se queda gris.

**Tests de C.** `apps/tpv-web/test/cobro-sirope.test.tsx`. Capturas:
`cobro-*`.

---

## D · Venta

### #5 Texto de producto a la izquierda, familias centradas

El nombre va centrado, horizontal y vertical. Y el `×N` pasa a la esquina: era
un hermano del nombre en un `justify-between`, así que aparecer desplazaba el
texto y el mismo producto se leía distinto según estuviera o no en la comanda.

### #6 «Croissantysandwich» se salía del botón de familia

No había ni relleno lateral ni recorte. Relleno, recorte, hasta dos líneas y
tamaño adaptativo.

### #7 Dos botones idénticos: «Desayuno 1 · Café + Tostada…»

El `line-clamp-2` a tamaño fijo cortaba justo donde se diferencian —«…
mantequilla y mermelada» contra «… (Sin glúten)»—: dos botones iguales con dos
precios (captura 24). El tamaño lo decide ahora el NOMBRE, por peldaños hasta
que cabe, con suelo de 15 px y techo de tres líneas.

**Decisión sin preguntar.** El ajuste es una estimación por ancho de glifo y
no una medida del DOM: esto corre por producto en cada repintado de la
rejilla, y medir de verdad exige un observador por botón. Va por lo alto —
quedarse corto baja un peldaño de más y se lee igual; pasarse corta el nombre,
que es el fallo que esto cierra. `nombresQueColisionan` es la red que lo canta.

**Test.** `apps/tpv-web/test/rejilla-sirope.test.ts`, que mide el choque donde
pasó: un botón de 170 px, no uno de 300.

### #8 Cada línea de la comanda ocupaba el doble y el nombre salía cortado

El chip «Espera» y las sillas vivían en una segunda fila, y el nombre se
truncaba a una línea («Café con l…», «Café Ame…»). Capturas 11, 26.

Los chips entran en la misma fila —en compacto, 40 px— y el nombre usa hasta
dos líneas. Los `−`/`+` siguen a 56: lo que se toca con prisa no encoge. El
importe y el chip van **apilados** y no uno al lado del otro, porque lado a
lado dejaban el nombre en 55 px y lo devolvían a «Café co…».

**Lo que no llega.** El objetivo era «≥ 6 líneas visibles en 1442 × 811».
Medido en el bucle visual: la línea pasa de **~130 px a 67**, y se ven **4
enteras más una parcial** (antes, 3). Las seis no entran porque el resto de la
columna ocupa lo que ocupa: cabecera 70, barra de iconos 70, los dos
eyebrows 52, la fila «Urgente / Alergias» 60 y el pie con el TOTAL y las dos
acciones 140 — y bajar de 67 exige tocar los 56 px de los `−`/`+`, que es la
norma que el propio bloque prohíbe romper. Lo que falta para seis no está en
la línea: está en el chrome de alrededor, y eso es otro bloque.

### #9 Ocho iconos sin rótulo en la barra de venta

Un icono se reconoce cuando ya sabes lo que hace; el camarero nuevo de un
sábado no lo sabe, y la lupa, el escáner y el refresco se parecen lo bastante
para probar a ver qué pasa con el cliente delante. Rótulo corto bajo cada uno.

**Decisión sin preguntar.** Con siete botones rotulados la barra pasaba a dos
filas, 70 px que la comanda necesita. Se va de la barra **«Recargar»**, que ya
está en el menú lateral: es lo que el bloque permite cuando no caben («se
queda lo que se usa y el resto va a Más»), y es el único que tiene otra
puerta. Los 56 px de objetivo táctil no se tocan. En el TPV claro la barra no
cambia: ahí los iconos no llevan rótulo y caben de sobra.

### #10 «Más acciones → Cancelar» vaciaba la venta

En una hoja de acciones «Cancelar» se lee como «cerrar esta hoja». Pasa a
«Vaciar venta», y la confirmación habla del mismo verbo. La confirmación que
ya existía se queda.

### #11 Una venta rápida a medias no se veía desde la sala

El botón decía «Venta rápida» igual que si no hubiera nada, y la de 3 € del
18-10 sólo apareció al cerrar el turno. Ahora lleva la cifra, y mira los dos
sitios donde puede estar: el carrito persistido y el borrador de mostrador,
que desde #25 vive en el servidor.

### #18 Vaciar una mesa con consumo no pedía motivo

Se vaciaron cinco y no quedó nada: ni motivo, ni importe en el Z, ni una línea
que mirar al día siguiente (capturas 35, 38). Vaciar una mesa con platos
dentro es comida que salió de la cocina y no se cobró.

- `MotivoVaciado` (enum nuevo) en `Ticket.voidMotivo`, migración
  `20261018110000_motivo_de_vaciado`. `voidReason` ya decía por qué CAMINO se
  anuló; esto dice qué pasó en la sala.
- **El servidor lo exige** con consumo (400 `VOID_MOTIVO_REQUIRED`). No basta
  con preguntarlo en la pantalla: un rastro que depende de que el cliente se
  acuerde no es un rastro.
- Hoja de motivo con cuatro botones grandes —esto se contesta con una mesa de
  gente delante— y la auditoría de siempre (quién, cuándo).
- El informe Z dice «Mesas vaciadas: N · X €» con su desglose por motivo, en
  los dos caminos: el cierre manual y el corte de día.

**Decisión sin preguntar.** Lo vacío sigue sin preguntar: abrir una mesa por
error y cerrarla no es nada, y contarlo llenaría el informe de ruido que
esconde las cinco que importan.

---

## E · Sala

### #13 El mapa de mesas no se adaptaba a la pantalla

`TABLE_SHAPE_SIZE` era 144 fijo, calculado para el peor caso de La Maestranza
a 1280 × 800. En el D8 de Sirope dejaba ≈ 190 px muertos a la derecha (captura
23). El lado se elige ahora: el mayor con el que la sala entera sigue cabiendo
sin desplazar, entre un suelo de 120 (el dedo) y un techo de 200 (el mapa se
lee de un golpe). La regla de v1.23 no se toca —todas las mesas miden lo
mismo— y el 144 sigue saliendo en el caso que lo justificaba.

**Test.** `apps/tpv-web/test/sala-sirope.test.ts`, con la función de reparto
sola.

### #14 Faltaba el estado «pagada, por recoger»

Al cobrar, la mesa pasaba a Libre en el mismo instante: en el mapa figuraba
disponible con el servicio todavía encima (captura 29). Estado nuevo POR
RECOGER (`tables.por_recoger_desde`, migración
`20261018120000_mesa_por_recoger`), con su color, su rótulo y los minutos que
lleva. Un toque: «Dejar libre» o «Abrir cuenta nueva» —que la ocupa
directamente—. Vive en el servidor porque el que cobra y el que recoge no son
el mismo. El contador de la cabecera **no la cuenta como abierta**: ya se
cobró y no debe nada.

**Decisión sin preguntar.** Caduca sola a las seis horas: una mesa cobrada
anoche no está «por recoger» esta mañana, y así no hace falta ni un job ni un
barrido.

### #15 El aviso «Mesa cobrada» empujaba el mapa

Era una franja en el flujo: al aparecer bajaba el mapa y cortaba la leyenda
(capturas 29, 73). Ahora flota y se va solo sin mover nada debajo.

### #16 El aro de «+45 min» se confundía con «Pide la cuenta»

Eran el mismo ámbar: dos señales distintas con el mismo color son una señal
que no dice nada (captura 23). El ámbar se queda para el relleno; el aro pasa
a **rojo y discontinuo**. Va por `outline` y no por `box-shadow` —que no puede
ser discontinuo—: el `outline` sigue el `border-radius` desde Chrome 94 y el
WebView más viejo del parque es el 101. Leyenda al día, con los dos.

---

## F · Cierre del día

### #27 «Cerrar turno» sin contar era el botón principal

Lo sigue siendo —decisión de v1.11 que este bloque no cambia—, pero «Cuadrar
caja» deja de ser un enlace subrayado en gris debajo: pasa a botón secundario,
en la misma fila y al mismo alto. Es lo único que convierte el descuadre en un
número conocido: sin contar, el descuadre no es cero, es desconocido.

### #28 «Cuadrar caja» empezaba por los billetes de 500 €

Tres billetes que Sirope no ve en un mes ocupando las tres primeras filas de
una ventana de 140 px, con las monedas bajo scroll (capturas 83-87). Ahora:
las doce de todos los días en **dos columnas** y los tres grandes plegados. Y
el cuadre se dice: descuadre 0 → «Cuadra» en verde; distinto de 0 → ámbar
hasta 5 € y rojo por encima, con la cifra.

**Medido.** La rejilla de las doce mide 350 px y la caja disponible 477 (D8) /
467 (AP11): caben enteras sin scroll. Con el aviso de mesas abiertas puesto
—249 px con cinco mesas— el bloque de conteo cede y scrollea él, en vez de
empujar el total y las acciones fuera de la tarjeta.

### #29 El «Cancelar» de «Cerrar el día» asomaba por debajo

Vivía fuera de la tarjeta y a 811 px asomaba cortado por el borde inferior
(captura 82): la única salida de la pantalla era medio visible. Entra en la
hoja, con las acciones.

---

## Sabotajes

Por cada fila: se rompió la línea, se vio el rojo, se anotó el mensaje real y
se restauró. Todos ejecutados.

| Sabotaje | Qué cayó | El rojo |
|---|---|---|
| La regla de devolvible excluye `PAID` | `devolucion.test.ts`, `devolucion-sirope.test.ts` (api), `devolucion-sirope.test.tsx` | `expected false to be true` · `expected 409 to be 201` · `expected null not to be null` |
| La regla de devolvible excluye `TEST` en ensayo | los mismos tres | `expected false to be true` · `expected 409 to be 201` · `expected null not to be null` |
| Volver a poner el `return` sin mesa en `sendToKitchen` | `mostrador-a-cocina.test.tsx` (4 casos) | `expected [] to have a length of 1 but got +0` |
| Cobrar venta rápida sin enviar antes las líneas | `mostrador-a-cocina.test.tsx` | `expected [] to have a length of 1 but got +0` |
| `pickMethod` conserva el importe al pasar a Tarjeta | `cobro-sirope.test.tsx` (2 casos) | `expected 10 to be close to 3` |
| El cobro no marca servidas las comandas listas | e2e `auditoria-sirope` (2 casos) | `expected null not to be null` · `expected 1 to be +0` |
| Una línea sin sección se da por «enviada» | `mostrador-a-cocina.test.tsx` | `expected null not to be null` |
| Los ajustes del tenant no se refrescan | `ajustes-al-dia.test.tsx` (2 casos) | `expected 1 to be 2` · `expected false to be true` |
| El vigilante de arranque no salta | `vigilante-arranque.test.ts` (2 casos) | `expected null not to be null` |
| El segundo billete sustituye en vez de sumar | `cobro-sirope.test.tsx` | `expected 10 to be close to 15` |
| El cambio vuelve a 15 px | `cobro-sirope.test.tsx` | `expected 15 to be greater than or equal to 44` |
| Dos nombres distintos pintan el mismo texto | `rejilla-sirope.test.ts` (2 casos) | `expected 24 to be less than 24` · `expected false to be true` |
| El reparto de sala ignora el ancho | `sala-sirope.test.ts` (4 casos) | `expected 144 to be greater than 144` |
| Cobrar deja la mesa en FREE en vez de POR_RECOGER | e2e `auditoria-sirope` | `expected null not to be null` |
| Vaciar con consumo sin motivo | e2e `auditoria-sirope` | `expected 204 to be 400` |
| Descuadre 0 sin «Cuadra» | `shift-resume-screen.test.tsx` | `expected 'Llevas contado 170,00 €+0,00 €' to contain 'Cuadra'` |

### Lo que la suite NO cubre

- **El arranque real en un WebView 101.** El vigilante se prueba ejecutando su
  script en jsdom; que el D8 no se quede en blanco sólo se comprueba en el D8.
  Y si lo que muere es el renderer del sistema, **el vigilante tampoco pinta**.
- **El reparto del navegador.** jsdom no hace layout: que la sala entre sin
  desplazar, que las doce denominaciones quepan y que «Cobrar» se vea con el
  pad abierto se miden en el bucle visual con Chrome, y los números están
  arriba. Los tests afirman las reglas (una sola medida de mesa, el bloque de
  conteo, el alto de la línea), no los píxeles.
- **La impresora y la wifi del local.** Los envíos a la térmica y el camino
  directo se prueban con dobles; el papel que sale es del hierro.
- **La subida a Holded.** Las colas van mockeadas en el e2e (no hay Redis en
  CI).
- **El panel del super-admin y Dispositivos, pintados.** El interruptor de
  Cocina (#23) y los botones de sección tienen su test de API; la pantalla se
  mira a mano.
- **Que el correlativo de mostrador no se repita con dos cajas a la vez.** Es
  un `MAX + 1` por caja: dos ventas simultáneas en la MISMA caja no pueden
  pasar (una pantalla, un cajero), y entre cajas el número es independiente.
  No hay unicidad en la base que lo impida.

### Una nota sobre la suite

`apps/api/test/cashier-login.test.ts` («rate limit se resetea tras un login
exitoso») y un caso de `super-admin.test.ts` fallan **de vez en cuando** al
correr la suite entera, con `Test timed out in 5000ms`. Son de bcrypt bajo
carga, no de esta rama: pasan solos y pasan en master. Está medido las dos
veces que apareció.

---

## El bucle visual

Capturas en `docs/qa/2026-10-18-sirope-done/`, las mismas doce en los dos
viewports (`-d8` a 1442 × 811 y `-ap11` a 1280 × 800):

| Captura | Qué enseña |
|---|---|
| `cobro-exacto` | la hoja con el importe exacto · #4 (título con cifra, IVA plegado, «Exacto» como tecla) |
| `cobro-efectivo-cambio` | un billete de 20 sobre 14 € · #1 (CAMBIO A DEVOLVER a 44 px) y #4 («Entregado») |
| `cobro-tarjeta` | #2 · el importe vuelve al total |
| `cobro-mixto` | el reparto en dos filas, intacto |
| `cobro-cashpad` | #1 · con el pad abierto, «Cobrar» visible sin scroll |
| `venta-familias-rejilla` | #5, #6, #7, #9 · nombres centrados y enteros, «Croissantysandwich» dentro, iconos con rótulo |
| `venta-comanda-12-lineas` | #8 · la línea en una fila, nombres enteros, chip inline |
| `venta-sin-cocina` | #12 · sin destino no hay «Enviar» ni rótulos de cocina |
| `venta-rapida` | la venta de mostrador |
| `sala` | #13, #14, #16 · mesa adaptativa, leyenda con «Por recoger» y el aro rojo |
| `cocina-ap11` | #26, #24 · franjas de sección y sin franja muerta |
| `cuadrar-caja` | #28 · las de todos los días primero, en dos columnas |

Las pantallas nuevas del banco (`?screen=cocina` y
`?screen=venta-mesa&cocina=1`) quedan en `apps/tpv-web/visual/main.tsx` para el
siguiente que mire.

**Cinco cosas sólo aparecieron al mirarlas**, todas del propio bloque, y están
arregladas: el «Cobrar» que se iba con el pad abierto (#1), el título
«Mostrador nº 3» pisando la pastilla del tiempo (#25), la línea de comanda de
81 px con el nombre en 55 (#8), la barra de iconos en dos filas (#9) y la hoja
de cuadre desbordada con el aviso de mesas (#28).

---

## Lo que hay que hacer con el hierro delante

Lo de siempre, y en este orden:

1. Venta en mostrador con una tostada → llega al AP11 como «Mostrador nº 1» →
   Lista → aviso en la caja → cobro (y la tarjeta se va sola).
2. Mesa → comanda a Cocina y a Barra → Lista → cobro: la mesa queda POR
   RECOGER y sin la etiqueta LISTO.
3. Devolución de un ticket de la cuenta en ensayo.
4. Vaciar una mesa con consumo: pide motivo, y el Z lo cuenta.
5. Cuadrar caja y cerrar.
6. Reinicio de la app del D8. Antes de nada, **actualizar el Android System
   WebView** del aparato (#21).

### La APK

**No hay versión que subir en el repo**: `versionName` y `versionCode` no
viven en ningún fichero — los pone el script en la línea de comandos
(`apps/tpv-android/android/app/build.gradle` los lee de `-PversionName` /
`-PversionCode`, y la app los enseña leyéndolos del plugin nativo). Así que
«subir la versión a 1.27.0» es construir con ella:

```bash
apps/tpv-android/scripts/build-release-apk.sh 1.27.0   # → versionCode 12700
```

Lleva la banda ENSAYO, que la 1.26.0 no tiene.

---

## Los comandos (los teclea Matías)

```bash
cd /Users/matiasoyolasanchez/Developer/Claude/Projects/mipiacetpv-auditoria-sirope

# 1 · la base de datos de desarrollo, con las tres migraciones del bloque
pnpm db:migrate

# 2 · la suite entera
pnpm vitest run

# 3 · el e2e contra Postgres (base desechable propia)
docker compose exec -T postgres psql -U mipiacetpv -c \
  "CREATE DATABASE mipiacetpv_e2e_sirope;"   # sólo la primera vez
cd apps/api && E2E_DATABASE_URL='postgresql://mipiacetpv:mipiacetpv_dev@127.0.0.1:5432/mipiacetpv_e2e_sirope' \
  pnpm vitest run --config vitest.e2e.config.ts test-e2e/auditoria-sirope.e2e.ts
cd ../..

# 4 · el bucle visual, si quieres volver a mirarlo
pnpm --filter @mipiacetpv/tpv-web dev
#   → http://localhost:5173/visual/index.html?screen=cocina
#   → http://localhost:5173/visual/index.html?screen=venta-mesa&cocina=1

# 5 · empujar y abrir el PR
git push -u origin auditoria-sirope
gh pr create --base master --head auditoria-sirope \
  --title "auditoria-sirope · los 29 hallazgos del uso real (D8 + AP11, 18-10)" \
  --body-file docs/blocks/auditoria-sirope-done.md
```
