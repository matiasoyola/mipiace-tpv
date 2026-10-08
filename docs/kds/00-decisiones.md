# Pantalla de comandas en cocina · ficha y decisiones

Conversación de diseño abierta el 08-10-2026 desde `claude/kds-cocina-arranque-2026-10-08.md`.
Sin código. Se rellena según se decide con Matías, una decisión por mensaje.

**Regla de alcance (Matías, 08-10):** se diseña para **todo bar y restaurante, también a la carta**,
no sólo para La Maestranza. Lo que ya se puede prever ahora se prevé, para no rehacerlo. Lo que
cambia de un local a otro es **configuración por restaurante**, no otro desarrollo.

---

## Ficha del §5 (para Dirección: si entra y qué desplaza lo decide Dirección)

```
Vertical:          Pantalla de comandas en cocina (KDS) para hostelería: las comandas que el
                   TPV envía aparecen en una pantalla en cocina, por mesa y en orden de
                   llegada, y cocina marca lo que va sacando
Familia:           Módulo (hostelería: bares y restaurantes a la carta)
¿Qué cliente lo pide? Bar La Maestranza (Salomé). Matías decidió el 08-10: comandas a pantalla,
                   no a impresora
¿Y qué?:           1) El cocinero sabe qué tiene que hacer ahora y para qué mesa, sin papeles
                   que se mojan, se pierden o se apilan.
                   2) Ve cuánto lleva esperando cada mesa (semáforo): decide qué sacar primero.
                   3) Un plato anulado o añadido después de enviar se ve en la pantalla:
                   nadie cocina lo que ya no se quiere.
                   4) El camarero se entera de que algo está listo sin ir a preguntar.
                   5) Lo que se comanda en la terraza se empieza a preparar dentro (bebidas
                   en barra) sin que el camarero entre a cantarlo.
                   6) Un restaurante a la carta saca primeros y segundos a su ritmo: el
                   segundo no se cocina hasta que el camarero lo marcha.
                   7) Alergias: la mesa con un celíaco llega a cocina en grande; se sabe en
                   qué silla está y qué plato es suyo; y si ese plato lleva gluten según la
                   carta, la pantalla lo grita. El plato llega a la silla correcta sin que
                   nadie pregunte «¿para quién era el sin gluten?». DIFERENCIADOR (Matías)
                   8) El dueño sabe cuánto tarda su cocina, por plato y por hora, y dónde se
                   le atasca el servicio (estadísticas, bloque siguiente).
                   9) Se vende a todo bar y restaurante con cocina (Sirope incluido)
Peldaño:           2 — cliente concreto esperando su implantación; la fecha depende de esto
                   (plan de fecha, puerta 11)
Primer daño:       ya: sin la pantalla no se pone fecha a la implantación de La Maestranza
¿Qué desplaza?:    los dos frentes están ocupados (B, entrega; C, clínica). Candidato natural:
                   lo que viene detrás de clinica-5 en el frente C (clinica-6, clinica-4),
                   porque la clínica no tiene fecha comprometida y La Maestranza sí espera.
                   Lo decide Dirección
Dueño:             esta conversación (diseño, maqueta y prompt); bloque de Code por nombrar
Hallazgo que pesa: el servidor NO envía por diferencias (ver abajo): el bloque lleva migración.
                   Y los alérgenos del producto no existen en el catálogo: segunda migración
```

## Hallazgos del código (master `4e34843`, 08-10)

- **No hay envío por diferencias en el servidor.** `dispatchKitchenTicket`
  (`apps/api/src/tickets/kitchen-dispatch.ts`) agrupa **todas** las líneas del DRAFT en cada envío;
  `lastSentRevision` es sólo un contador del ticket («Comanda nº N»). Un segundo envío reimprime la
  mesa entera. El arranque decía lo contrario: no es así.
- `TicketLine` no tiene marca de envío ni `createdAt`. v2-H1 lo esquiva en el front
  (`lib/kitchenSentLines.ts`, sembrado con `lastSentAt`) y deja `sentAt` por línea como carryover.
  **Una pantalla de cocina no puede apoyarse en eso**: necesita saber, en el servidor, qué línea
  salió en qué envío y qué se anuló después → **migración**.
- Sin impresora configurada para la sección, el envío devuelve 409 y **no marca nada como enviado
  ni emite el evento**. Con pantalla en vez de impresora, esa regla tiene que cambiar.
- El evento `ticket.sent_to_kitchen` sólo se emite si hay mesa (`tableId`), y lleva recuentos, no
  líneas.
- Secciones: BARRA · COCINA · SALON, por etiqueta del producto (`tagSection`); sin etiqueta → SALON.
- Carta de La Maestranza (128): lo de cocina, a priori, es raciones (14), bocadillos (7), platos (3)
  y parte de desayunos (21: tostadas, sándwiches, pincho, arepas).
- **Alérgenos: el producto del TPV no los tiene** (`Product` sin campo; lo único en el esquema es
  la casilla `confirmedAllergies` de la clínica). Pero **los alérgenos de La Maestranza ya existen**:
  los lleva, por plato, el generador de sus cartas
  (`docs/implantaciones/maestranza/generador/maestranza_carta.py`, la leyenda de iconos). Se pueden
  importar al catálogo en la implantación.
- El ticket ya guarda **comensales** (`Ticket.diners`): de ahí salen las sillas de la mesa.

## Configuración por restaurante (se va llenando)

| Ajuste | Opciones | La Maestranza |
|---|---|---|
| Secciones de cada pantalla | COCINA · BARRA · las dos | solo COCINA |
| Semáforo | dos umbrales en minutos (defecto 10 / 20) | 10 / 20 |
| Órdenes de salida | «Todo a la vez + Espera» · «Por tiempos» | Todo a la vez + Espera |
| Plato por silla | sólo con alergia · siempre visible | sólo con alergia |

## Decisiones (§3 del arranque)

1. **El aparato de cocina — DECIDIDO 08-10.** Tablet Android de 10–13" en soporte de pared,
   táctil, con la **misma APK en «modo cocina»**. Consecuencias: nace un **tipo de dispositivo
   «cocina»** al emparejar (hoy todo dispositivo es una caja; la cocina no abre turno ni cobra);
   pantalla siempre encendida (`svc power stayon`, ya probado en el D8); la maqueta se diseña para
   **1280×800 en horizontal** (el peor caso, 10"). Modelo concreto: se compra aparte.
2. **Qué secciones van a la pantalla — DECIDIDO 08-10.** **Cada pantalla elige qué secciones
   muestra**: COCINA, BARRA o las dos. En La Maestranza arranca con **solo COCINA**. La BARRA se
   enciende cuando haga falta, p. ej. si se comanda desde una tablet en la terraza y alguien dentro
   prepara las bebidas (Matías: «ya que nos ponemos chulos»). Consecuencias:
   - la sección vive **por línea** en la pantalla, no por comanda: una mesa con cañas y bravas
     aparece en la pantalla de barra con las cañas y en la de cocina con las bravas;
   - una comanda sin nada de las secciones de una pantalla **no aparece** en ella;
   - lo que no va a ninguna pantalla ni impresora (BARRA hoy en La Maestranza) se marca igualmente
     como enviado: el envío no falla por falta de destino;
   - en la implantación hay que **etiquetar la carta por sección** (los desayunos se reparten:
     bollería a BARRA, plancha a COCINA). Es configuración, no código.
3. **Qué enseña cada comanda — DECIDIDO 08-10** (con lo que añadió Matías, visto en otros TPV).
   - **Sí**, por tamaño: **mesa** (grande) · **minutos esperando** (grande) · **platos con
     cantidad** · **modificadores y notas** bajo cada plato, bien visibles · marca **«2ª comanda»**
     cuando la mesa añade · **alergias y silla** (abajo).
   - **No**: precios, hora exacta (la sustituyen los minutos), camarero, comensales.
   - **Semáforo de tiempos** (Matías): **configurable por restaurante**, por defecto **verde
     < 10 min · ámbar 10–20 · rojo > 20**. Cambia de color la **cabecera entera** de la tarjeta,
     no un puntito (se reconoce, no se lee). Cuenta desde que ese grupo **marcha** a cocina (el
     envío, o el «Marchar» de un tiempo retenido), no desde que se tomó la nota.
   - **Urgencia y prioridad = una sola cosa** (decisión de diseño de Claude: dos conceptos para lo
     mismo obligan a pensar). El camarero marca **«Urgente»** al enviar (un toque en el TPV); en
     cocina la tarjeta **salta al principio** y lleva un **borde/etiqueta URGENTE**. Cocina también
     puede subir una tarjeta a urgente con un toque largo (por si el camarero se lo dice a voz).
   - **Órdenes de salida — DECIDIDO 08-10: las dos formas, elegibles por restaurante, sobre un
     mismo modelo.** Matías: «no pienses solo en La Maestranza, piensa también en bares a la
     carta; no vamos a rehacer algo que ya podemos prever ahora».
     - **Un solo modelo por debajo**: cada línea lleva su **tiempo** (1, 2, 3…; por defecto 1) y
       cada tiempo de la mesa está **retenido o marchado**. El tiempo 1 marcha al enviar; los
       demás quedan **EN ESPERA** (gris en cocina, sin semáforo) hasta que el camarero pulsa
       **«Marchar 2º»** en la mesa.
     - **Modo «Todo a la vez + Espera»** (bares, La Maestranza): el TPV sólo enseña un botón
       **«Espera»** en la línea; por debajo es «tiempo 2». Cero toques más en el caso normal.
     - **Modo «Por tiempos»** (a la carta): fila **1º · 2º · 3º · Postre** junto a la fila de
       cantidad, y **se queda puesta**: los productos que se pulsen después van a ese tiempo hasta
       que se cambie. Comandar una mesa de cuatro cuesta 2–3 toques más, no uno por plato.
     - Cocina ve cada mesa con sus tiempos en bloques: lo marchado arriba, con semáforo; lo
       retenido abajo, en gris. Lo que va a la pantalla de barra no se retiene nunca (la bebida
       sale ya).
     - El paso de un modo a otro es un ajuste: los datos son los mismos.
   - **Alergias — DECIDIDO 08-10: de la mesa, de la SILLA y del plato.** Matías: «si la mesa tiene
     un comensal celíaco, que venga en grande en la comanda, y si el comensal no quiere compartir,
     que su plato elegido venga marcado… esto creo que es diferenciador». Y luego: «iría un paso
     más allá, que se pueda marcar en qué silla está el celíaco». Tres capas:
     1. **La mesa y la silla.** En el TPV, botón **«Alergias»** en la mesa. Se abre el **dibujo de
        la mesa con sus sillas alrededor** (tantas como comensales, `Ticket.diners`; con la forma
        de la mesa de la sala) → toque en la silla → rejilla de los **14 alérgenos de declaración
        obligatoria** (Reglamento UE 1169/2011), iconos grandes → toque. Dos o tres toques en
        total. Varias sillas pueden tener alergias distintas. Si no se sabe la silla, se marca «la
        mesa» y vale igual. En cocina, **franja roja ancha** en la tarjeta: «⚠ SILLA 3 · CELÍACO».
        Vale para todo lo que pida esa mesa, también después.
     2. **El plato de esa silla.** Si la mesa tiene alergia declarada, cada línea de la comanda
        enseña un botón con la silla: **«→ Silla 3»** (un toque; si hay dos sillas con alergia, sale
        uno por silla). En cocina ese plato va **recuadrado en rojo** con «SILLA 3 · SIN GLUTEN». El
        camarero sabe dónde dejarlo sin preguntar. El plato hereda las alergias de su silla.
     3. **El cruce con la carta.** Si los productos tienen sus alérgenos en el catálogo, cocina ve
        además, en la tarjeta de esa mesa, **qué platos llevan el alérgeno** («lleva gluten»). Y si
        un plato **asignado a la silla alérgica lleva el alérgeno**, la pantalla lo grita: el plato
        entero en rojo, «¡LLEVA GLUTEN!», y el TPV ya avisa al camarero al asignarlo (sin
        bloquear: a veces la cocina tiene la versión sin gluten). Sin alérgenos en el catálogo, las
        capas 1 y 2 funcionan igual.
     - **Por debajo, la silla es un dato de la línea** (`seat`, opcional), no algo propio de las
       alergias. Ajuste por restaurante **«Plato por silla»**: en bares, el botón de silla sólo
       aparece cuando hay alergia; en restaurantes a la carta se puede tener **siempre visible**, y
       entonces cocina y camarero saben de quién es cada plato (y mañana se puede partir la cuenta
       por silla). Mismo dato, otro ajuste: no se rehace.
     - **Numeración de las sillas**: la pone cada local por costumbre (p. ej. la silla 1 es la que
       mira a la barra, y luego en el sentido de las agujas del reloj). Es formación del camarero,
       no código; en el dibujo de la mesa se ven numeradas.
     - **Producto**: nace el campo **alérgenos del producto** (los 14) en el catálogo, editable en
       la ficha del producto e importable por CSV. Para La Maestranza se importan del generador de
       sus cartas. Sirve también, más adelante, para enseñar alérgenos en la carta digital o al
       cliente.
     - **Privacidad**: la alergia vive **en la silla de ese servicio**, sin nombre de nadie; no se
       guarda en un cliente. No es un dato de salud de una persona identificada.
     - Si la fecha aprieta, la **capa 3** (campo de alérgenos en el catálogo + cruce) es lo que se
       puede separar en un bloque pegado detrás; las capas 1 y 2 van sí o sí.
4. **Estados y quién los marca — DECIDIDO 08-10.**
   - **Cada plato se tacha con un toque** al sacarlo.
   - Todos tachados → la tarjeta pasa sola a **«Lista»**; también hay un botón grande **«Lista»**
     para cerrarla de golpe.
   - **«Lista» es lo que avisa al camarero** (decisión 5).
   - **Sin «en preparación»** de salida: un toque más en plena faena que al camarero no le
     resuelve nada. Si un restaurante con varios cocineros lo pide, entra como ajuste sin tocar
     lo demás.
   - **Estadísticas para el dueño** (Matías: «de aquí salen estadísticas buenísimas»). Decisión de
     Claude: **los datos se guardan desde el primer día**, en este bloque — por cada línea, cuándo
     se envió, cuándo marchó, cuándo se tachó, cuándo se puso «Lista» la tarjeta y cuándo se
     marcó «Servido»; y quién lo marcó (qué pantalla o qué camarero). **El informe** (tiempo medio
     por plato, por franja horaria, por día de la semana; mesas que pasaron a rojo; platos que más
     atascan; cuánto espera un plato listo en el pase) **va en un bloque siguiente**, para no
     retrasar la fecha de La Maestranza. Lo que no se guarda hoy no se puede contar mañana; lo que
     se guarda se puede enseñar cuando se quiera.
5. **El aviso al camarero — DECIDIDO 08-10.**
   - En la **sala** del TPV, la mesa lleva una etiqueta **«LISTO» en verde** (el coral queda para
     ocupada y Cobrar).
   - En **todos los TPV del local**, banda arriba **«M4 · listo para servir»** con un **pitido
     corto**: se entera cualquier camarero, también el de la terraza.
   - **Un toque** en la banda o en la etiqueta = **«Servido»**: el aviso desaparece en todos los
     TPV y queda la marca de tiempo para las estadísticas (tiempo en el pase).
   - Si hay varias listas a la vez, la banda las apila por orden (la más antigua primero).
6. **Cambios después de enviar — DECIDIDO 08-10.** Matías: «lo anula el camarero, y pondría el
   +/− para ser más rápido».
   - **En el TPV, −/+ en TODAS las líneas, enviadas o no** (revierte la regla de v2-H1 de que «En
     cocina» no lleva −/+; su test de sabotaje 5 hay que darlo la vuelta en el bloque).
     - **«+» sobre una línea enviada** = una unidad nueva **sin enviar** (sale con el siguiente
       «Enviar», como «2ª comanda»). La línea enseña «2 en cocina + 1 sin enviar».
     - **«−» sobre una línea enviada** = **anular una unidad**. Sin confirmación ni PIN: en su lugar,
       aviso **«Bravas −1 · Deshacer»** durante **5 s**. Pasados los 5 s sale a cocina solo, sin
       esperar al siguiente «Enviar» (el cocinero tiene que saberlo ya). Deshacer dentro de los 5 s
       = no ha pasado nada y cocina no ve parpadeos.
     - Decisión de Claude: **deshacer en vez de confirmar** — un «¿Seguro?» cuesta un toque siempre;
       el deshacer sólo cuesta cuando hay error.
   - **En cocina:**
     - **Anulado**: no desaparece; queda **tachado en rojo, «ANULADO»**, con un pitido distinto al de
       comanda nueva, hasta que el cocinero toca **«Visto»**.
     - **Cantidad que baja**: «**2** Patatas bravas (eran 3)», con el −1 en rojo, y «Visto».
     - **Añadido**: llega como «2ª comanda» de esa mesa, con su semáforo.
     - **Nota cambiada**: «**CAMBIO**» en ámbar sobre el plato, y «Visto».
   - **¿Empeora la usabilidad respecto a v2-H1? (pregunta de Matías, 08-10).** No, con pantalla.
     v2-H1 quitó el −/+ de lo enviado porque **sin pantalla** un «−» quitaba el plato de la cuenta
     mientras el papel seguía en la plancha: cocina nunca se enteraba. Con pantalla la anulación
     llega a cocina, así que ese motivo desaparece y queda sólo el riesgo del dedo gordo, que
     cubre el «Deshacer». Para que no se confunda, el − de una línea enviada se pinta distinto
     (contorno rojo, no relleno). **Regla por destino**: si la sección de esa línea **no tiene
     pantalla** (impresora o nada), se mantiene lo de v2-H1 — sin −/+ en lo enviado, «Anular» con
     aviso «cocina ya tiene el papel: díselo».
   - **Registro**: queda quién anuló, cuándo y **si cocina ya lo había tachado** (eso es merma,
     comida tirada). Va a las estadísticas del dueño. Sin PIN, el registro es la protección contra
     anular lo enviado para quedarse con el dinero.
7. **Orden y limpieza — DECIDIDO 08-10.**
   - **Orden**: urgentes primero; después por **orden de llegada a cocina** (el momento en que
     marcha), la más antigua a la izquierda. Tarjetas en columnas.
   - **Orden de LECTURA, no por columnas** (corrección al ver la maqueta, 08-10): las tarjetas
     se colocan **como se lee un libro**, de izquierda a derecha y después la fila de abajo. En
     columnas el ojo saltaba la segunda más antigua. Cada fila mide lo que su tarjeta más alta.
     Lo que no cabe entero no se corta: pasa al indicador de la derecha, que nombra las mesas
     («+2 nuevas · M1 · T2») y parpadea si son nuevas.
   - **Urgente** (Matías: «que se vea el mensaje de urgente o prioritario»): franja **roja**
     ancha arriba de la tarjeta, «⚡ URGENTE» a 26 px en blanco, y borde rojo. (Primero se probó en
     blanco; Matías: «¿no debería ir en rojo? El rojo sólo para cosas importantes».)
   - **Regla del rojo**: el rojo se reserva para lo que **no puede esperar**: urgente, alergia,
     plato que lleva el alérgeno de su silla, anulado/cambio y el semáforo pasado de tiempo. Nada
     decorativo ni informativo va en rojo. Urgente y alergia se distinguen por el texto y el icono
     (⚡ URGENTE arriba de la tarjeta; ⚠ SILLA n · ALERGIA debajo de la mesa).
   - **Cuántas se ven**: unas **8 comandas normales** en 1280×800 sin desplazar. Si hay más, **nunca
     paginación**: indicador grande **«+3 más»** en el borde derecho; van entrando según salen las
     primeras.
   - **Lo terminado**: al pasar a «Lista» sale del centro a una **columna estrecha «Listas»** a la
     derecha, hasta que el camarero marca «Servido»; entonces desaparece.
   - **Recuperar**: botón **«Hoy»** con lo terminado del día; un toque devuelve una tarjeta a la
     pantalla (por si se tachó sin querer).
8. **Sonido — DECIDIDO 08-10: SIN SONIDOS; avisa el parpadeo.** Matías: «sin sonidos, un parpadeo
   de la comanda creo que es más eficaz». Lo que antes eran sonidos pasa a ser movimiento:
   - **Ritmo (Matías, al ver la maqueta): «más lento, para no volvernos locos»** → **un pulso cada
     2,5 s**, suave (sube y baja el fondo, sin destello seco).
   - **Comanda nueva**: la tarjeta entra **parpadeando** (pulso lento del fondo) y
     sigue así hasta que se tacha su primer plato; luego lleva la etiqueta «NUEVA» hasta entonces.
     Sin toque extra.
   - **Urgente / con alergia**: parpadeo en **rojo**, mismo ritmo, hasta el primer toque.
   - **Anulado / cambio**: la línea afectada parpadea en rojo/ámbar hasta «Visto».
   - **Pasa a rojo en el semáforo**: un solo pulso de la cabecera.
   - Ritmo **lento a propósito** (≤ 2 destellos por segundo; por debajo del umbral de 3/s de las
     pautas de fotosensibilidad), y nunca la pantalla entera: sólo la tarjeta o la línea.
   - **En el TPV** (el «LISTO» de la decisión 5): el pitido queda como **ajuste por restaurante,
     apagado por defecto**, por coherencia con esta decisión; la banda y la etiqueta verde avisan
     igual.
9. **Si se cae la red o la pantalla — EN DISCUSIÓN 08-10.**
   - **Base propuesta**: la pantalla sin conexión se pone **entera en rojo, «SIN CONEXIÓN · las
     comandas no llegan»**; el TPV sabe si la pantalla está viva (latido) y, si no, «Enviar» avisa
     «Cocina no recibe» y **saca la comanda en papel por la impresora de tickets** de la barra; al
     volver, lo pendiente llega marcado «llegó tarde».
   - **Pregunta de Matías: «¿y si están en la misma wifi?»** Sí se puede: con internet caído, la
     wifi del local sigue funcionando, y el TPV puede hablar con la tablet de cocina directamente.
     - **No es lo que se descartó** (`project_offline_scope`): aquello era varias cajas cobrando sin
       internet y cuadrando dinero entre sí. Esto es estrecho: comandas que van a cocina y «Lista»
       que vuelve; sin dinero y sin conflictos.
     - **Cómo**: **doble camino**. El TPV manda cada envío **a la nube y, a la vez, directo a la
       tablet de cocina por la wifi**. La cocina descarta duplicados (cada envío lleva su id). Sin
       internet funciona el camino directo; la tablet guarda lo que marca y lo sube a la nube al
       volver (las estadísticas no se pierden).
     - **Lo que cuesta**: la tablet de cocina necesita un pequeño servidor dentro de la APK (pieza
       nativa de Android) y el TPV encontrarla en la red (se fija al emparejar, con
       redescubrimiento automático si el router le cambia la IP). Del lado del TPV, el envío por
       la wifi va por el puente nativo (una página https no puede llamar a una IP local por http).
     - **Lo que no arregla**: si se cae la wifi o el router, ni esto ni la nube llegan → sigue
       haciendo falta el papel de respaldo. Y routers con «aislamiento de clientes» (redes de
       invitados) lo bloquean: se comprueba en la implantación.
     - **DECIDIDO 08-10 (Matías: «sí»)**: **el modelo se deja preparado en este bloque** (ids de
       envío idempotentes, estado guardado en la tablet y subido después) y **el camino directo por
       la wifi va en el bloque siguiente**, pegado a éste, para no mover la fecha de La Maestranza.
       Mientras tanto cubre el respaldo en papel.
10. **Producto — DECIDIDO 08-10.**
    - **De serie en todo TPV de hostelería**: **alérgenos del producto** y **alergias por silla** al
      comandar (obligación legal de informar de alérgenos + lo que luce en una demo). Sin pantalla
      de cocina, la alergia sale igual en el papel de la comanda.
    - **Módulo aparte «Cocina»**: pantalla de comandas, órdenes de salida, semáforo, aviso de
      «Listo», estadísticas de cocina. **Se cobra por pantalla** (cocina + barra = dos). Lo enciende
      el **super-admin**, como la clínica.
    - **La tablet** se puede vender con la instalación, con el 20 % de Mi Piace sobre el precio de
      compra.
    - **El precio del módulo** lo pone Matías; no bloquea el prompt.

## Maqueta

Lienzo «Cocina · pantalla de comandas» (Design, privado):
https://claude.ai/artifact/7tzGuSKVRHBRUWC85g4U7t

- `Main.dc.html` · **Cocina, tablet 10" en servicio — VALIDADA por Matías el 08-10 a las 15:15**
  («me vale esta versión»), tras: parpadeo cada 2,5 s, orden de lectura por filas, urgente en
  rojo, ámbar y rojo del semáforo oscurecidos.
- `Comanda.dc.html` · TPV D8, comanda de M5 — **VALIDADA por Matías el 08-10 (15:16)**.
- `Alergias.dc.html` · TPV D8, hoja de alergias por silla — pendiente de validar.

## Siguiente paso

Maqueta con la carta real de La Maestranza (1280×800, oscuro, servicio a media mañana con mesas
en verde/ámbar/rojo, una urgente, una alergia por silla con cruce, un anulado, un tiempo en espera,
columna «Listas») + el lado del TPV (alergias por silla, −/+ en lo enviado, banda «LISTO»).
