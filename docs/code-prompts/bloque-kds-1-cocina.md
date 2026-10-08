# Bloque kds-1 · la pantalla de comandas en cocina

## Por qué existe este bloque

La Maestranza no tendrá fecha de implantación hasta que exista este bloque. Matías decidió el 08-10 que
**las comandas van a una pantalla en cocina, no a impresora**, y esa pantalla no existe. Pero el bloque
no es solo para La Maestranza: se diseña para **cualquier bar y cualquier restaurante a la carta**.
Lo que cambia de un local a otro es **configuración por restaurante**, no otro desarrollo
(Matías: «no vamos a rehacer algo que ya podemos prever ahora»).

¿Y qué? El cocinero sabe qué hacer ahora y para qué mesa, ve cuánto lleva esperando cada una, no
cocina lo que se ha anulado, y la alergia de una silla llega pegada a su plato. El camarero se entera
de que algo está listo sin ir a preguntar. El dueño, más adelante, sabe cuánto tarda su cocina.

## Leer antes

1. `claude/kds-cocina-decisiones.md` (copia en `docs/kds/00-decisiones.md`): **las 10 decisiones,
   validadas una a una con Matías**. Es la especificación. Lo que diga este prompt lo resume; si
   chocan, manda el documento de decisiones.
2. La maqueta validada, lienzo «Cocina · pantalla de comandas»
   (https://claude.ai/artifact/7tzGuSKVRHBRUWC85g4U7t): `Main` (cocina, 1280×800), `Comanda`
   (TPV D8, comanda de la M5) y `Alergias` (TPV D8, hoja por silla). **Los colores, tamaños y textos
   de la maqueta son los de la entrega.**
3. `claude/principio-venta-bajo-estres.md`: el listón. En cocina todavía más, porque se lee de pie, a
   un metro y con las manos ocupadas.
4. `docs/blocks/v2-h1-venta-y-sala-done.md`, sobre todo §3, que explica cómo sabe hoy el TPV qué está
   en cocina y por qué no basta.
5. El código actual: `apps/api/src/tickets/kitchen-dispatch.ts`, `send-to-kitchen*.ts`,
   `apps/api/src/realtime/store-events.ts`, el bus de eventos (`store-event-bus.ts`, `ws-route.ts`),
   `Device` y `DeviceKind` en el esquema, y el trigger `devices_revoke_previous`
   (migración `20260924000000_verifactu_1_registro`).

## Punto de partida (comprobado en `master` el 08-10)

- **El servidor NO envía por diferencias.** `dispatchKitchenTicket` agrupa **todas** las líneas del
  DRAFT en cada envío; `lastSentRevision` solo cuenta las comandas. **`TicketLine` no tiene marca de
  envío.** Este bloque lo arregla en el servidor, con migración.
- Sin impresora para una sección, el envío da 409, no marca nada como enviado y no emite el evento.
- `ticket.sent_to_kitchen` solo se emite con mesa y lleva recuentos, no líneas.
- `DeviceKind` = `TERMINAL | TEST`. El trigger `devices_revoke_previous` solo releva `TERMINAL`. Un
  tercer valor **no** revoca la caja, pero hay que probarlo, no suponerlo.
- `Product` no tiene alérgenos. Los de La Maestranza están por plato en
  `docs/implantaciones/maestranza/generador/maestranza_carta.py` (claves `GL`, `HU`, `LA`, `CR`,
  `MC`, `PE`…).
- `Ticket.diners` existe: de ahí salen las sillas.

**Base de rama:** `master` **después del merge de v2-H1** (`v2-h1-venta-y-sala`). Este bloque toca la
comanda que v2-H1 rehízo. Si v2-H1 no está en `master` cuando empieces, **para y dilo**.

## Decisiones ya tomadas (no reabrir)

Resumen de `00-decisiones.md`. Cada punto lo validó Matías.

1. **Aparato.** Tablet Android con **la misma APK en «modo cocina»**: nuevo `DeviceKind` **`KITCHEN`**
   al emparejar. No abre turno, no cobra, no emite registro de facturación y no releva al terminal de
   la caja. Diseño a **1280×800 horizontal** como peor caso.
2. **Secciones.** **Cada pantalla elige las suyas**: COCINA, BARRA o las dos. La sección es **por
   línea**: la misma mesa sale en barra con las cañas y en cocina con las bravas. Lo que no tiene
   destino (ni pantalla ni impresora) **se marca como enviado igualmente**; el envío no falla por eso.
3. **Qué enseña la comanda.** Mesa y minutos en grande, platos con cantidad, modificadores y notas,
   «2ª COMANDA» y alergias. **Sin precios, sin hora exacta, sin camarero ni comensales.**
   - **Semáforo por restaurante**, de serie verde < 10 min, ámbar 10–20, rojo > 20. Cambia de color
     la cabecera entera. Cuenta desde que ese grupo **marcha** a cocina.
   - **Urgente**: un toque en el TPV (botón junto a «Enviar»). En cocina, franja **roja** «⚡ URGENTE»
     arriba de la tarjeta y la tarjeta pasa la primera. Cocina también lo puede marcar con un toque
     largo.
   - **Órdenes de salida, un solo modelo**: cada línea lleva su **tiempo** (1, 2, 3…, de serie 1) y
     cada tiempo de la mesa está **retenido o marchado**. El 1 marcha al enviar; los demás salen
     «EN ESPERA» (gris, sin semáforo) hasta «Marchar 2º». Dos modos por restaurante:
     **«Todo a la vez + Espera»** (botón «Espera» en la línea = tiempo 2) y **«Por tiempos»** (fila
     1º·2º·3º·Postre que **se queda puesta**). Lo de barra no se retiene nunca.
   - **Alergias en tres capas**:
     1. En la mesa y por silla: hoja con el dibujo de la mesa y `diners` sillas numeradas, más «toda
        la mesa», y los **14 alérgenos UE**. En cocina, franja roja «⚠ SILLA 3 · CELÍACO».
     2. Plato asignado a una silla: botón «→ Silla 3» en la línea, que solo aparece si la mesa tiene
        alergia (o siempre, según el ajuste «Plato por silla»). En cocina va recuadrado en rojo,
        «SILLA 3 · SIN GLUTEN».
     3. Cruce con el catálogo: los platos de la mesa que llevan el alérgeno van marcados «lleva
        gluten». Un plato **de la silla alérgica que lleva su alérgeno** sale rojo y parpadeando,
        «¡LLEVA GLUTEN!», y el TPV avisa al asignarlo **sin bloquear**.

     La **silla es un dato de la línea** (`seat`, opcional), no algo propio de las alergias. La
     alergia vive en la mesa de ese servicio, **sin nombre de nadie**, y no se guarda en ningún
     cliente.
4. **Estados.** Un toque tacha un plato. Todos tachados, o el botón grande «Lista», ponen la tarjeta
   en **Lista**. **No hay «en preparación».** **Se guardan las marcas de tiempo desde el primer día**
   (enviado, marchado, tachado, lista, servido, y quién). El informe va en otro bloque.
5. **Aviso al camarero.** Etiqueta **«LISTO» verde** en la mesa de la sala y **banda «M4 · listo para
   servir»** en todos los TPV del local, apiladas de más antigua a más nueva. **Un toque = «Servido»**.
   El pitido es un ajuste **apagado de serie**.
6. **Cambios después de enviar.**
   - **−/+ en todas las líneas**, también en las enviadas. Esto **revierte la regla de v2-H1**: da la
     vuelta a su sabotaje 5 a propósito.
     - «+» sobre lo enviado: unidad nueva sin enviar.
     - «−» sobre lo enviado: anula una unidad **sin confirmar**. Sale «Bravas −1 · Deshacer» durante
       **5 s** y, pasados, **se manda solo a cocina**, sin esperar a «Enviar». Si se deshace a tiempo,
       cocina no ve nada.
     - El «−» de lo enviado lleva **solo el contorno rojo**.
   - **Regla por destino**: si la sección de la línea **no tiene pantalla**, se queda lo de v2-H1 (sin
     −/+ en lo enviado, «Anular» con aviso «cocina ya tiene el papel: díselo»).
   - **En cocina**: «ANULADO» tachado en rojo hasta «Visto»; cantidad bajada como «2 Croquetas · ERAN
     3 · −1» y «Visto»; nota cambiada como «CAMBIO» ámbar y «Visto».
   - **Registro**: quién anuló, cuándo y **si cocina ya lo había tachado** (merma).
7. **Orden.** Urgentes primero y después por llegada a cocina. **Orden de lectura: de izquierda a
   derecha y luego la fila de abajo** (en columnas se saltaba la segunda más antigua). Una tarjeta que
   no cabe entera **no se corta** y pasa al indicador «+N · M1 · T2» del borde, que parpadea si son
   nuevas. Columna estrecha «Listas» hasta «Servido». Botón «Hoy» para recuperar una tarjeta.
8. **Sin sonidos.** Avisa el **parpadeo**: pulso suave **cada 2,5 s** de la tarjeta o la línea, nunca la
   pantalla entera.
   - Comanda nueva: hasta el primer tachado.
   - Urgente y alergia: en rojo.
   - Anulado y cambio: hasta «Visto».
   - Al pasar a rojo en el semáforo: un solo pulso.
9. **Sin conexión.**
   - La pantalla sin red se pone **entera en rojo**: «SIN CONEXIÓN · las comandas no llegan».
   - El TPV sabe si la pantalla está viva por su **latido**. Si no lo está, «Enviar» avisa «Cocina no
     recibe» y **saca la comanda en papel por la impresora de tickets del terminal** (USB, plugin de
     A1).
   - Al volver la red, lo pendiente llega marcado «llegó tarde».
   - **El camino directo por la wifi NO va en este bloque** (es kds-2), pero el modelo **se deja
     preparado**: cada envío lleva un **id generado en el terminal e idempotente**, y la pantalla
     guarda su estado y lo sube al reconectar.
10. **Producto.**
    - **De serie en hostelería**: alérgenos del producto y alergias por silla. Sin pantalla, la
      alergia sale en el papel de la comanda.
    - **Módulo «Cocina»**: lo enciende el super-admin, como la clínica, y se cobra por pantalla.

**La regla del rojo**: solo para lo que no puede esperar (urgente, alergia, plato con el alérgeno de su
silla, anulado o cambio, semáforo pasado). Nada decorativo va en rojo.

## Alcance

### 1 · Datos (migración, con copia de la base antes de aplicarla en producción)

Los nombres son orientativos; los **invariantes** no lo son.

- `DeviceKind` += `KITCHEN`. En el dispositivo de cocina, **las secciones que muestra**.
- Módulo por tenant: `kitchenDisplayEnabled` (super-admin), hermano de `agendaEnabled`.
- **Ajustes por restaurante** (tienda): umbrales del semáforo, modo de órdenes (`ESPERA` |
  `TIEMPOS`), plato por silla (`ALERGIA` | `SIEMPRE`) y pitido de «Listo» (apagado).
- `TicketLine`: `course` (int, de serie 1) y `seat` (int, opcional).
- **Comanda de cocina** (una por envío y sección con destino pantalla): `clientSendId` (único,
  idempotente), ticket, mesa, tienda, sección, número de comanda («2ª»), `urgent`, `sentAt`,
  `readyAt`, `servedAt` y quién.
- **Línea de comanda de cocina**: copia de nombre, unidades, modificadores, tiempo, silla y alérgenos
  del producto **en ese momento**; `firedAt` (marchado), `doneAt`, `voidedUnits`, `voidedAt`,
  `voidedBy`, `voidSeenAt` y `doneBeforeVoid`.
- **Alergias de la mesa**: ticket, silla (opcional = toda la mesa) y alérgeno. Se borran con el
  ticket; **nunca** se cuelgan de `Client`.
- `Product.allergens`: lista de los **14** (enum), editable en la ficha e importable por CSV.

**Invariante central:** en el servidor siempre se sabe **cuántas unidades de cada línea ha recibido
cocina, en qué envío y cuántas se anularon después**. El envío solo manda la **diferencia**.

### 2 · API

- **El envío** calcula la diferencia por línea. Las secciones con pantalla crean comandas de cocina;
  las que tienen impresora siguen por ESC/POS como hoy, **también por diferencia** (deja de
  reimprimirse la mesa entera); las que no tienen nada se marcan como enviadas. Con `clientSendId`
  repetido, devuelve el mismo resultado sin duplicar.
- **Anular unidades** de lo enviado (lo llama el TPV pasados los 5 s), **marchar un tiempo**, marcar
  y desmarcar urgente.
- **Cocina**: comandas abiertas de su tienda y sus secciones (la verdad al conectar y al reconectar),
  tachar y destachar plato, «Lista», «Visto», «Hoy» y recuperar.
- **TPV**: «Servido».
- **Eventos** por el bus de la tienda (solo son avisos; la verdad está en el GET): comanda creada, plato
  anulado, tiempo marchado, urgente, plato hecho, lista y servida.
- **Autorización**: un dispositivo `KITCHEN` solo ve y marca lo suyo. No puede abrir turno, cobrar,
  emitir registros ni ver importes. Un terminal no puede tachar en cocina.

### 3 · Pantalla de cocina (APK en modo cocina)

Como la maqueta `Main`:
- barra superior con «En línea» y «Hoy»;
- tarjetas en orden de lectura, indicador «+N», columna «Listas»;
- parpadeo cada 2,5 s y pantalla roja sin conexión;
- pantalla siempre encendida;
- latido.

### 4 · TPV (D8)

Como `Comanda` y `Alergias`:
- −/+ en lo enviado con «Deshacer» de 5 s y la regla por destino;
- «Espera» o fila de tiempos según el modo, y «Marchar 2º»;
- «Urgente»;
- hoja de alergias por silla y «→ Silla n» en la línea, con aviso de «¡Lleva …!»;
- banda «LISTO» y etiqueta verde en la sala;
- respaldo en papel por USB si la pantalla no está viva.

### 5 · Catálogo y ajustes

- Alérgenos en la ficha del producto y en la importación CSV.
- **Script de importación de los alérgenos de La Maestranza** desde su generador de cartas: idempotente,
  con «en seco» primero.
- Ajustes de cocina en el panel del restaurante.
- Encendido del módulo en el super-admin.
- Emparejar una tablet «de cocina» y elegir sus secciones.

**Si el tiempo aprieta**, la capa 3 de las alergias (`Product.allergens`, el cruce y el script) va en
**commits aparte y al final**, para poder separarla en un bloque pegado detrás. Las capas 1 y 2 van
sí o sí.

## Restricciones

- **RETAIL y SERVICES no cambian.** Con el módulo apagado, la hostelería se comporta exactamente
  como hoy, salvo el envío por diferencias a la impresora, que es un arreglo.
- **El terminal de la caja nunca se ve afectado** por emparejar, revocar o reemparejar una tablet de
  cocina.
- Táctil: ningún objetivo por debajo de 56 px en cocina («Visto» 44 px como mínimo y solo dentro de la
  línea); «Lista» 56 px.
- WebView 101 (D8) y la tablet de cocina: nada que necesite más.
- No regresar nada de v1.22, v1.23 ni v2-H1, salvo el −/+ de lo enviado, que se cambia a propósito.
- La alergia no sale del ticket: ni en los logs, ni en Sentry, ni en el cliente.

## Verificación

Un test no vale por pasar, vale por **ponerse rojo** cuando se rompe lo que dice cubrir. Cada fila: se
rompe el código, se ve el rojo, se escribe el mensaje real en el `-done` y se restaura.

| Sabotaje | Debe caer |
|---|---|
| Volver a mandar todas las líneas en cada envío | 2 cañas, enviar, +1 caña, enviar → la 2ª comanda tiene **1** caña |
| Quitar la idempotencia de `clientSendId` | el mismo envío dos veces → una sola comanda |
| Emparejar `KITCHEN` revoca el terminal | tras emparejar la cocina, el terminal de la caja sigue activo y cobra |
| Un `KITCHEN` cobra o abre turno | 403 en cobro, turno y registro |
| Cocina ve otra tienda u otra sección | GET de cocina filtrado por tienda y secciones |
| Fallar el envío por no tener destino | sección sin pantalla ni impresora → 200 y línea marcada como enviada |
| Anular sin avisar a cocina | «−» en lo enviado → evento y línea anulada en el GET de cocina |
| Anulado que desaparece sin «Visto» | sigue en la tarjeta hasta «Visto» |
| Retener la barra | un tiempo 2 de BARRA sale marchado |
| El semáforo cuenta desde la nota | tiempo 2 marchado a los 30 min → 0 min al marchar |
| Orden por columnas | las 4 primeras en el DOM, en orden de lectura, son las 4 más antiguas (urgentes delante) |
| Cortar una tarjeta | ninguna tarjeta visible se sale del área; las que no caben van a «+N» |
| Alergia sin silla que no sale en cocina | franja «⚠ TODA LA MESA» |
| No marcar el plato de la silla que lleva su alérgeno | bravas (GL) a la silla 3 celíaca → «¡LLEVA GLUTEN!» |
| La alergia llega a `Client` | ningún registro de alergia fuera del ticket |
| Parpadeo de 1 s o de pantalla entera | la animación dura ≥ 2,5 s y está en la tarjeta o la línea |
| Sonido en cocina | la pantalla de cocina no reproduce audio |
| −/+ en lo enviado sin pantalla | sección con impresora → sin −/+ en lo enviado (regla v2-H1) |
| «Servido» que no limpia | el aviso desaparece en todos los TPV de la tienda |
| RETAIL tocado | render RETAIL idéntico |
| Módulo apagado | sin `kitchenDisplayEnabled`, ni pantalla, ni banda, ni eventos nuevos |

**Bucle visual**: capturas a 1280×800 (cocina) y 1443×812 (TPV) comparadas con la maqueta. Cada
diferencia se anota en el `-done`, diciendo si es a propósito o si queda pendiente.

### La pasada en el hierro (criterio de cierre)

Cuenta ENSAYO. **D8 (AP13) como TPV y AP11 como pantalla de cocina** (las dos por adb; procedimiento en
la memoria del proyecto). Se graba y se apunta en el `-done`:
1. Comanda de la M5: celíaco en la silla 3, magro para la silla 3, bravas para la silla 3 (aviso),
   2 croquetas y 2 cañas. Enviar. **Medir los segundos hasta que aparece en la tablet.**
2. Desde el TPV, «−» en las croquetas: en cocina, «ERAN 2 · −1» a los 5 s. Hacer lo mismo y pulsar
   «Deshacer»: en cocina no pasa nada.
3. Plato combinado en «Espera» y después «Marchar 2º».
4. Urgente en la T4: pasa la primera.
5. Tachar todo → «Lista» → banda «M5 · listo» en el D8 → «Servido».
6. Apagar la wifi de la tablet de cocina: pantalla roja; en el D8, «Cocina no recibe» y papel por USB.
   Encender: llega «llegó tarde».
7. Comprobar que el terminal del D8 sigue cobrando durante toda la pasada.

## Entregables

- Rama `kds-1-cocina` desde `master` (con v2-H1 dentro), commits pequeños en español, push y PR
  contra `master`. **Ni merge, ni despliegue, ni APK publicada**: eso lo hace Dirección.
- `docs/kds/00-decisiones.md`: copia de `claude/kds-cocina-decisiones.md` en el repo.
- `docs/blocks/kds-1-cocina-done.md`, con:
  - la estructura de la metodología;
  - **las decisiones tomadas sin preguntar, una a una**;
  - el esquema final y por qué;
  - la tabla de sabotajes con el mensaje real de cada rojo;
  - la pasada en el hierro con tiempos;
  - las diferencias con la maqueta.
- Al cerrar, la línea de La Maestranza en `claude/tablero-direccion.md` se actualiza con *Último
  avance* y *Siguiente paso*. **No se toca el orden.**

## Fuera de alcance (explícito)

- **kds-2 · camino directo por la wifi** (servidor dentro de la APK de cocina, descubrimiento, doble
  camino). Aquí solo el modelo preparado.
- **kds-3 · informe de cocina para el dueño** (tiempos por plato, por franja, rojos, merma). Aquí solo
  los datos.
- Partir la cuenta por silla, la carta digital con alérgenos, KDS en navegador, sonidos e impresión
  en cocina.
- Si ves algo de v2-H2 (hojas en claro, orden de las familias), anótalo y no lo arregles aquí.
