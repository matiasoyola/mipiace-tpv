# Bloque auditoria-sirope · los 29 hallazgos del uso real (D8 + AP11, 18-10-2026)

## Por qué existe este bloque

El 18-10 recorrimos la cuenta real de **Cafetería Sirope** (en ensayo) en su hierro: el **D8** como
caja (1920×1080 a densidad 213 → viewport ≈ **1442×811**) y el **AP11-1006** como pantalla de cocina
(viewport **1280×800**). Venta en mostrador y en mesa, comanda a cocina, «Lista», «Servido», cobro en
efectivo y tarjeta, devolución y cierre del día. Salieron **29 hallazgos**, todos con captura y
medidos sobre el código.

¿Y qué? Dos de ellos impiden que Sirope arranque (no puede **devolver** nada y lo que se pide en
**mostrador no llega a cocina**), siete son cosas que funcionan mal y el resto es el mismo
diagnóstico que Matías dio el 07-10: *hay que poner demasiada atención para hacer cada cosa*. La
pantalla de venta la usa un humano a toda velocidad y bajo estrés (principio «venta bajo estrés»).

Matías quiere **los 29 en una sola sesión**, uno detrás de otro, en el orden de abajo.

## Leer antes

1. `docs/qa/2026-10-18-sirope-auditoria.md` (el inventario) y las capturas de
   `docs/qa/2026-10-18-sirope/` — cada hallazgo cita las suyas por número (`02-…png`).
2. `apps/tpv-web/src/pages/CheckoutPage.tsx` y `CheckoutPage.successOverlay.tsx` (cobro).
3. `apps/tpv-web/src/pages/SalePage.tsx` y `SalePage.hospitality.tsx` (venta).
4. `apps/tpv-web/src/pages/TableMapScreen.tsx` y `apps/tpv-web/src/lib/roomGrid.ts` (sala).
5. `apps/api/src/tickets/send-to-kitchen.ts`, `apps/api/src/kitchen/destinos.ts`,
   `apps/tpv-web/src/kitchen/` entero (cocina, KDS, `useAvisosListo`, `useCaminoDirecto`).
6. `apps/tpv-web/src/pages/TicketsHistoryPage.tsx`, `RefundPage.tsx` y la ruta de refund en
   `apps/api/src/tickets/routes.ts` (≈ 1985-2010).
7. `apps/tpv-web/src/pages/CloseShiftModal.tsx` (cierre; su cabecera explica v1.11).
8. `apps/tpv-web/src/hooks/useDeviceBootstrap.ts` (caché de `/devices/me`).
9. `apps/admin/src/pages/DevicesPage.tsx`, `apps/admin/src/pages/` de Comanderas (`/admin/tag-sections`)
   y `apps/admin/src/superadmin/TenantDetailPage.tsx`.

## Reglas del bloque (no reabrir)

- **Medir en los dos viewports**: 1442×811 (D8) y 1280×800 (AP11). Toda pantalla tocada se comprueba
  en los dos con el banco visual de `apps/tpv-web/visual/` y sus capturas van al `-done`.
- **Nada de texto por debajo de 15 px CSS** en venta, cobro, sala y cocina; objetivos táctiles
  ≥ 56 px de alto en lo que se toca con prisa.
- **Las hojas claras sobre la venta oscura se quedan** (decisión del 08-10). La paleta de familias
  «A2 · entre pastel y mate» también. Sin iconos ni fotos en los botones de producto.
- **Hostelería: el botón de producto va sin precio** (08-10).
- Cada hallazgo es un commit propio (o varios), con su número en el mensaje: `#07 …`.

---

## Los 29, en este orden

### A · Lo que frena a Sirope

**#17 🔴 Devoluciones imposibles en cuentas sin Holded y en ensayo** (captura 31)
`TicketsHistoryPage.tsx` 1079-1080 sólo pinta «Iniciar devolución» con `SYNCED` o con `TEST` +
`isTestModeActive()` (el modo prueba ANTIGUO, cajero técnico). Con el ensayo nuevo los tickets nacen
`TEST` sin ese modo, y en una cuenta sin Holded los tickets reales nacen `PAID`
(`holded-upload-gate.ts` 172). El servidor ya acepta `TEST`, `SYNCED` y `PAID` (routes 1996-2000).
- Una única regla «¿es devolvible?» compartida por front y back (`packages/` o un módulo común),
  que diga sí a `SYNCED`, `PAID` y `TEST` de una cuenta en ensayo.
- Corregir el mensaje `TICKET_NOT_REFUNDABLE` («sincronizado con Holded») a algo verdad.
- Recorrido completo: devolución de un ticket `PAID` y de uno `TEST` en ensayo, con su efecto en el
  efectivo esperado del cierre.

**#25 🔴 En venta rápida, «Enviar» no manda nada a cocina** (capturas 76, 77)
`SalePage.tsx` 1804-1806: `if (!tableContext?.activeTicketId) return;` — sin mesa, el envío termina
en seco y el botón sigue activo sin avisar. Sirope trabaja casi todo en mostrador.
- La venta rápida envía a cocina igual que una mesa. Si hoy su borrador no existe en el servidor, se
  crea al enviar. En la pantalla de cocina sale identificada como **«Mostrador nº N»** (número corto,
  correlativo por día y caja) en lugar del nombre de mesa; el aviso «Listo» llega a la caja igual.
- **Cobrar una venta rápida con líneas de cocina sin enviar las envía antes de cobrar** (en mostrador
  se paga primero y se prepara después). En una **mesa**, cobrar con líneas sin enviar pregunta.
- Nunca un botón que no hace nada: si no se puede enviar, el botón dice por qué.

**#2 Pasar de Efectivo a otro método arrastra el importe tecleado** (16, 17)
`pickMethod` (CheckoutPage 444-452) cambia el método «sin perder importe». Con 10 € tecleados sobre
3 €, al tocar Tarjeta sale «Sobran 7 € · baja el importe» y Cobrar gris.
- Al pasar a un método que no es efectivo, el importe vuelve al total. Al volver a efectivo, arranca
  en el total (el cajero toca el billete que le den).

**#22 Cobrar la mesa no da por servido lo que estaba «Listo»** (73, 74, 81)
Tras cobrar T6, la mesa queda libre con la etiqueta LISTO, el AP11 la sigue «esperando» y la banda
«T6 · listo para servir» persiste en otras ventas.
- Al cobrar (o vaciar) un ticket, sus comandas listas pasan a servidas en el servidor, con el mismo
  evento que «Servido» para que se apague en todos los TPV y en la tablet.

### B · Cocina

**#19 Encender Cocina sin secciones manda todo a «Salón» en silencio** (55, 56, 59, 60)
`resolverSeccion` (`kitchen/destinos.ts`) cae a `SALON` si la etiqueta no tiene sección. La primera
comanda de T6 se perdió y el D8 dijo «Comanda nº 1 enviada · SALÓN: 3 líneas».
- Comanderas (`/admin/tag-sections`): **listar las etiquetas reales del catálogo** con un selector
  Barra / Cocina / Salón al lado de cada una (hoy pide teclear «el slug de Holded»; Sirope ya no usa
  Holded). Fuera la palabra Holded de esa página.
- Al enviar, si alguna línea va a una sección **sin pantalla ni impresora**, el TPV lo dice en el
  aviso («2 líneas sin destino: …»), no «enviada».
- En el super-admin y en el panel, aviso si Cocina está encendida y hay etiquetas sin sección.
- (Sirope ya está mapeada desde el 18-10: COCINA = tostadas, desayunos, singluten, croissantysandwich,
  suplemento; BARRA = cafe, bebidas, infusiones, licores, vinos, helados, bolleria.)

**#20 La caja no se entera de que Cocina está encendida hasta reiniciar la app** (62-64, 69)
`useDeviceBootstrap` lee `/devices/me` al arrancar y lo cachea; nadie lo refresca.
- Refrescar los ajustes del tenant sin reiniciar: al volver al primer plano, cada pocos minutos y con
  un evento del bus cuando el super-admin cambie un módulo. Encender o apagar Cocina se nota en la
  caja en menos de un minuto.

**#21 Al reiniciar la app del D8, se queda en blanco** (65, 66)
Dos veces (17-10 y 18-10): `am force-stop` + abrir → pantalla blanca, `Displayed +667ms`, ningún
error en logcat; sólo lo arregla reiniciar el aparato. WebView de sistema **101.0.4951.61**.
- Investigar con lo que haya (emulador con WebView 101, el arranque de Capacitor, IndexedDB/
  localStorage del offline, el bundle local de A4). Dejar en el `-done` la causa o, si no se
  reproduce, lo que se descartó.
- Pase lo que pase: **un vigilante de arranque**. Si la app no pinta su primera pantalla en N
  segundos, enseña «No ha arrancado bien · Reintentar» (recarga el WebView) y lo reporta a Sentry con
  versión de WebView y de APK. Una caja nunca se queda en blanco sin salida.

**#23 Cocina no se gestiona desde el panel**
- Interruptor de **Cocina** en la ficha del super-admin, junto a los módulos (hoy sólo por API
  `PATCH /super-admin/tenants/:id { kitchenDisplayEnabled }`), con la respuesta de «N pantallas se
  quedan a oscuras» al apagarlo.
- En Dispositivos, **editar las secciones** de una pantalla de cocina sin revocarla.

**#26 En una pantalla compartida, Cocina y Barra sólo se distinguen por una palabra pequeña** (60)
- La sección se ve sin leer: franja o cabecera con un color propio por sección (que no sea el verde→
  naranja del tiempo) y el nombre de la sección grande. El tiempo, en su propia pastilla.

**#24 Franja muerta en la pantalla de cocina** (51, 60) entre la rejilla de comandas y «Listas»
(≈ 90 px a la izquierda de la columna). Quitarla o darle uso.

**#12 Con Cocina apagada, el TPV habla de cocina** (27)
«EN COCINA», «Comanda nº 1 enviada» y «Reenviar (nº 2)» sin destino ni nada nuevo.
- Sin pantalla ni impresora, el botón «Enviar» no aparece y la lista se llama «Pedido».
- «Reenviar» sólo cuando hay líneas nuevas; sin nada nuevo no se ofrece.

### C · Cobro

**#1 ✅ El cambio queda en segundo plano** (02, 03) — validado por Matías.
En la hoja de cobro el cambio va a 15 px coral (1349-1356) y el TOTAL a 30 px (1359-1366). El cajero
lo necesita **antes** de pulsar Cobrar, con el billete en la mano.
- Con efectivo y cambio > 0, el pie de la hoja copia el recuadro de «Ticket emitido»
  (`successOverlay` 412-422): **«CAMBIO A DEVOLVER» a ≥ 44 px en tinta**, con «Total · Entregado»
  pequeños debajo. Sin cambio, el pie queda como hoy.
- Con el CashPad abierto, «Cobrar» sigue visible sin scroll en los dos viewports.

**#3 Los billetes sustituyen en vez de sumar** (16)
- El primer billete sustituye el importe exacto que viene puesto; los siguientes **suman**
  (10 + 5 = 15). «C» deja el importe a cero.

**#4 En la hoja de cobro manda lo que no importa** (01, 16)
- Título con la cifra: «Cobrar 3,00 €». Subtotal/IVA bajan a «Más opciones» o al detalle.
- «Importe exacto» deja de ser una barra coral enorme: es una tecla más junto a los billetes.
- La franja de estado dice «Entregado 5,00 €» (no «sobran»).

### D · Venta

**#5 Texto de producto alineado a la izquierda; familias centradas** (00)
`ProductButton` (`SalePage.hospitality.tsx` ≈ 807) `text-left justify-between`. Centrar el nombre en
el botón (horizontal y vertical); el `×N` pasa a una esquina sin desplazar el nombre.

**#6 La familia «Croissantysandwich» se sale del botón** (00)
`FamilyButton` no tiene relleno lateral ni recorte. Relleno, hasta dos líneas y tamaño adaptativo.
(Los nombres «Croissantysandwich», «Singluten», «Bolleria», «Cafe» son datos del catálogo: los
corregimos desde el panel, no es código.)

**#7 Dos botones idénticos: «Desayuno 1 · Café + Tostada…»** (24)
El `line-clamp-2` corta justo lo que distingue «… mantequilla y mermelada» de «… (Sin glúten)».
- El nombre completo cabe: tamaño de letra adaptativo por botón (mín. 15 px, hasta 3 líneas).
- Test: dos productos de nombre distinto **nunca** pintan el mismo texto visible en la rejilla.

**#8 Cada línea de la comanda ocupa el doble y el nombre sale cortado** (11, 26)
El botón «Espera» va en una segunda fila y el nombre se trunca a «Café con l…» / «Café Ame…»; caben
3 líneas en el D8. «Espera» pasa a la misma fila (compacto) y el nombre usa hasta dos líneas.
Objetivo: ≥ 6 líneas visibles en 1442×811 sin perder los `−`/`+` de 56 px.

**#9 Ocho iconos sin rótulo en la barra de venta** (00)
Rótulo corto visible bajo cada icono (menú, buscar, escanear, recargar, tickets, más, guardar,
nueva). Si no caben, se queda lo que se usa y el resto va a «Más».

**#10 «Más acciones → Cancelar» vacía la venta** (20) — *decisión de CTO, Matías puede cambiarla*.
Renombrar a **«Vaciar venta»** (en mesas ya es «Vaciar mesa»). La confirmación que existe se queda.

**#11 Una venta rápida a medias no se ve desde la sala** (23, 24)
El botón «Venta rápida» del mapa lleva la cifra pendiente («Venta rápida · 3,00 €») cuando hay una.

**#18 Vaciar una mesa con consumo no pide motivo** (35, 38) — *decisión de CTO*.
- Si la mesa tiene líneas enviadas o importe > 0: elegir motivo (Invitación · Error de comanda ·
  Se fueron sin pagar · Otro) antes de vaciar.
- Queda en auditoría con cajero, hora, mesa e importe, y el informe Z dice «Mesas vaciadas: N ·
  X €». Lo vacío (sin consumo) sigue sin preguntar.

### E · Sala

**#13 El mapa de mesas no se adapta a la pantalla** (23, 32)
Mesa fija de 144 px (`roomGrid.ts` `TABLE_SHAPE_SIZE`): en el D8 sobran ≈ 190 px a la derecha.
- El tamaño sale del ancho disponible (con mínimo y máximo), y las mesas de una zona llenan el ancho.
  La función de reparto se testea sola (`roomGrid.ts`).

**#14 Falta el estado «pagada, por recoger»** (29) — *idea de Matías; el diseño es decisión de CTO*.
Hoy la mesa pasa a Libre en el instante del cobro (`state: FREE | OPEN | BILLING`).
- Nuevo estado **POR_RECOGER** al cobrar: color propio, rótulo «Por recoger» y minutos desde el cobro.
- Un toque: «Dejar libre» o «Abrir cuenta nueva» (abrir cuenta nueva la ocupa directamente). Vive en
  el servidor para que lo vean todas las cajas (migración: p. ej. `tables.por_recoger_desde`).
- Leyenda actualizada. El contador de la cabecera no la cuenta como abierta.

**#15 El aviso «Mesa cobrada» empuja el mapa y corta la leyenda** (29, 73)
Que flote sobre el mapa (aviso superpuesto que se va solo), sin mover el contenido.

**#16 El aro amarillo de «+45 min» se confunde con «Pide la cuenta»** (23)
Dos señales distintas que no compartan color: p. ej. «Pide la cuenta» relleno ámbar y «+45 min» aro
rojo discontinuo, con la leyenda al día.

### F · Cierre del día

**#27 «Cerrar turno» sin contar es el botón principal** (82) — *decisión de CTO*.
Es una decisión de v1.11 (cabecera de `CloseShiftModal.tsx`) y existe `requireCashCountOnClose`.
No se cambia el comportamiento por defecto: **«Cuadrar caja» pasa de enlace a botón secundario
visible**, al mismo nivel que «Cerrar turno». (Encender `requireCashCountOnClose` en Sirope lo decide
Gemma en la visita; no es código.)

**#28 «Cuadrar caja» empieza por los billetes de 500 €** (83-87)
- Lo de todos los días primero: 50 €, 20 €, 10 €, 5 € y monedas; 100/200/500 € plegados en
  «Billetes grandes».
- Que las denominaciones habituales quepan **sin scroll** en los dos viewports (dos columnas si hace
  falta) y que el teclado no deje medio panel vacío.
- Descuadre 0 → «Cuadra» en verde; distinto de 0 → ámbar/rojo con la cifra.

**#29 El «Cancelar» de «Cerrar el día» asoma por debajo de la hoja** (82)
Botón secundario dentro de la hoja.

---

## Criterio de cierre

### Sabotajes (obligatorio)

Por cada fila: se rompe la línea, se ve el rojo, el mensaje real va al `-done`, y se restaura.
Como mínimo:

| Sabotaje | Debe caer |
|---|---|
| La regla de devolvible excluye `PAID` | test de devolución en cuenta sin Holded (#17) |
| La regla de devolvible excluye `TEST` en ensayo | test de devolución en ensayo (#17) |
| Volver a poner el `return` sin mesa en `sendToKitchen` | test de envío desde venta rápida (#25) |
| Cobrar venta rápida sin enviar antes las líneas de cocina | test de cobro con cocina pendiente (#25) |
| `pickMethod` conserva el importe al pasar a Tarjeta | test del cambio de método (#2) |
| El cobro no marca servidas las comandas listas | test de cobro → listas a 0 (#22) |
| Una línea sin sección se da por «enviada» | test del aviso «sin destino» (#19) |
| Los ajustes del tenant no se refrescan tras el cambio | test de refresco de `kitchenDisplayEnabled` (#20) |
| El vigilante de arranque no salta | test del vigilante (#21) |
| El segundo billete sustituye en vez de sumar | test de billetes (#3) |
| El cambio vuelve a 15 px | test/visual del pie con cambio (#1) |
| Dos nombres distintos pintan el mismo texto | test de la rejilla (#7) |
| El reparto de sala ignora el ancho | test de `roomGrid` (#13) |
| Cobrar deja la mesa en FREE en vez de POR_RECOGER | test de estados de mesa (#14) |
| Vaciar con consumo sin motivo | test de vaciar mesa (#18) |
| Descuadre 0 sin «Cuadra» | test del cierre (#28) |

Y la lista contraria: **qué NO cubre la suite** (p. ej. el arranque real en un WebView 101).

### Visual

Capturas antes/después en **1442×811 y 1280×800** de: hoja de cobro (efectivo con cambio, tarjeta,
mixto, CashPad abierto), venta (familias, rejilla, comanda con 6+ líneas, barra de iconos), sala
(con LISTO, POR_RECOGER, pide cuenta y +45 min), KDS con Cocina y Barra, cuadrar caja.

### En el hierro (lo hace Claude con Matías después)

D8 + AP11 con Sirope en ensayo: venta en mostrador con tostada → llega al AP11 como «Mostrador nº N»
→ Lista → aviso en caja → cobro; mesa → comanda Cocina/Barra → Lista → cobro (queda POR_RECOGER y
sin LISTO); devolución de un ticket; cuadrar caja y cierre. Reinicio de la app del D8 sin pantalla
blanca. Para eso hace falta **APK nueva**: subir la versión a **1.27.0** (lleva también la banda
ENSAYO que la 1.26.0 no tiene).

## Entregables

- Rama `auditoria-sirope` desde `master` actualizado; commits pequeños en español con `#NN`.
- Migración(es) mínimas (#14, #18) con su `down` razonado.
- `docs/blocks/auditoria-sirope-done.md`: los 29 uno a uno (qué se hizo, dónde, captura), las
  decisiones tomadas sin preguntar, la tabla de sabotajes con su rojo y lo que no cubre la suite.
- APK 1.27.0 lista para compilar (versión subida en `apps/tpv-android`).
- **El push y el PR los hace Matías**: deja los comandos exactos al final.

## Fuera de alcance

- Rediseñar la paleta o la estructura de la pantalla de venta (v2-H1/H2 ya decidieron).
- La carta/pedido por QR, combinados con ingrediente extra (#v2-H2), talleres, clínica.
- Partir un combinado (Desayuno café + tostada) entre Barra y Cocina: se anota, no se hace.
