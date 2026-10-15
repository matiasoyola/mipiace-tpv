# Bloque kds-2b · lo que encontró la pasada en el hierro del 15-10 — HECHO

Prompt: `docs/code-prompts/bloque-kds-2b-hierro.md`.
Capturas de la pasada: `docs/qa/2026-10-15-kds-hierro/`.
Bloques anteriores: `docs/blocks/kds-1-cocina-done.md`, `docs/blocks/kds-2-wifi-done.md`.
Decisiones: `docs/kds/00-decisiones.md` — **las diez se quedan como están**. Lo que este
bloque decide sin preguntar va en el §2 de aquí.

Rama `kds-2b-hierro` **desde `7f74ef1`** —lo que corre en producción y lo que lleva la
APK 1.24.0—, no desde `master`. PR contra `master`.
**Ni merge, ni despliegue, ni APK publicada.**

Terminales de la pasada: **D8 (AP13)** como TPV y **AP11** 1280 × 800 como pantalla de
cocina, los dos con internet y en la misma wifi.

---

## 0 · El resumen en ocho líneas

- **La tarjeta fantasma era el cruce mirando sólo a las abiertas.** Al tocar «Lista», la
  gemela del servidor se iba a la columna «Listas» y la copia de la wifi se quedaba sin
  pareja. Ahora el cruce mira **todo lo que el servidor conoce** y además es **monótono**:
  una tarjeta que el servidor reconoció una vez no vuelve nunca, ni cuando la sirven.
- **Y las tarjetas de la wifi no se soltaban nunca con internet puesto.** Sólo se soltaban
  «al volver la red», que en un bar con internet no pasa. Crecían todo el servicio.
- **`CLAVE_RECIBIDAS` era una bomba de relojería**: crecía un id por comanda y no se subía
  nunca, y el esquema de la ruta tiene `maxItems: 500`. Al pasar de 500, el POST habría
  contestado 400 **para siempre** — con el libro de marcas del siguiente apagón dentro.
- **Nada invalida el catálogo del TPV**, y por eso la comanda de la wifi salió sin
  «¡LLEVA GLUTEN!». Ahora los alérgenos los dice el **servidor** en el estado de cocina de
  la mesa, y sin servidor se pide el catálogo antes de mandar, acotado.
- **«ALÉRGENOS SIN INFORMAR»**, en ámbar: un plato sin informar deja de parecer comprobado.
- **El plato ya no salta al final al tacharlo**: lo arregla la pantalla (conserva el orden
  en que vio cada línea) y además el `orderBy` del servidor.
- **El `−` sobre lo enviado baja el total en el momento**, y el servidor recalcula
  `tickets.total` — que es lo que pinta la sala.
- **Y un quinto fallo que no estaba en el parte**: el plato añadido después del último GET
  de cocina **no viajaba por la wifi**. Lo encontró el banco al escribir el test del
  catálogo (§6).

**14 sabotajes, 14 rojos.** Suite: 351 ficheros, 4.644 tests. E2E contra Postgres: 34
ficheros, 592 tests, 7 nuevos.

---

## 1 · La regla de entrega: qué llega con la APK y qué necesita el servidor

El prompt la fija: **todo lo que se pueda arreglar en la pantalla se arregla ahí**, porque
llega con una APK sin desplegar nada. Esto es lo que queda de cada lado.

| Hallazgo | Con la APK 1.25.0 sola | Lo que suma el servidor |
|---|---|---|
| 1 · tarjeta fantasma | **Arreglado entero.** El cruce y el soltar son de la pantalla | `clientSendId` en la vista: el cruce pasa de «mesa + sección + nº» a exacto |
| 1b · alérgenos de la wifi | **Arreglado**: se pide el catálogo antes de mandar cuando hay una alergia en juego | Los alérgenos los dice el servidor y la caché deja de importar |
| 2 · el plato salta al tachar | **Arreglado entero** (la pantalla fija el orden) | `orderBy` estable: el orden no nace distinto en cada GET |
| 3 · el total no baja | **Arreglado en la mesa** (comanda y total, al instante) | `tickets.total` al día → **la tarjeta de la mesa en la SALA** |
| 4 · sin alérgenos informados | **En las tarjetas de la WIFI**, que las compone el TPV | En las tarjetas de la NUBE, que las compone el servidor |
| 5 · el plato añadido no viaja | **Arreglado entero** | — |

Lo único que la APK no puede arreglar sola es **el importe de la tarjeta de la mesa en la
sala** (sale de `tickets.total`, una columna de la base) y **el «ALÉRGENOS SIN INFORMAR» en
las tarjetas que llegan por la nube**. Las dos cosas están hechas en el servidor y esperan
despliegue.

### 1.1 · Nada que migrar

**Ni una migración.** El bloque no toca el esquema: lo que cambia son consultas, una
transacción y el front. Desplegar el servidor es sustituir el proceso.

### 1.2 · La APK hay que reconstruirla

Cambia `@mipiacetpv/kitchen-lan` (un campo nuevo en la línea de la comanda), `ticket-model`
y todo el front. Nada nativo: **la pieza Java no se toca**, así que la APK 1.25.0 es un
bundle nuevo sobre el mismo armazón de kds-2.

Una APK vieja contra el servidor nuevo sigue funcionando: los campos nuevos son opcionales
en los dos sentidos (§2.6).

---

## 2 · Las decisiones tomadas sin preguntar

### 2.1 · El cruce de la tarjeta de la wifi es MONÓTONO

El prompt pedía «descartar contra todo lo que el servidor conoce (abiertas + listas, y lo
servido que haya en la vista)». Eso arregla el caso del parte y **deja la mitad fuera**: una
comanda que el camarero marca «Servido» desaparece del `GET` **entera** —no está en
`orders`, ni en `ready`, ni en ningún sitio—, así que su gemela de la wifi se volvería a
quedar sin pareja al día siguiente de la corrección.

Así que el cruce no es una foto: es un **recuerdo**. `useCocinaLan` guarda las llaves de las
tarjetas que el servidor reconoció **alguna vez** (`confirmadas`) y de ahí no se sale. Lo
que pinta `sinDuplicados` es «las de la wifi que no están ni han estado».

Y las confirmadas **no se guardan en `localStorage`**, a propósito: las tarjetas de la wifi
tampoco se guardan —viven en memoria, por eso reiniciar la app quitaba la fantasma—, así
que al reiniciar no hay nada que reanimar. Guardar el recuerdo de una tarjeta que ya no
existe sería inventarse un estado nuevo.

### 2.2 · Dos llaves para cruzar, y la buena necesita servidor

- `env:<clientSendId>:<sección>` — **exacta**. El id del envío es el mismo por los dos
  caminos. Necesita que el servidor lo mande (lo manda desde este bloque).
- `mesa:<ticketId>:<sección>:<nº>` — la de kds-2, la que funciona con el servidor de hoy.
  **Se puede equivocar**: el nº de comanda de una tarjeta de la wifi lo calcula el TPV
  (`revision + 1`) con el último estado que conocía, y sin internet puede no coincidir.

Se usan las dos y basta con que coincida una. Con el servidor desplegado, el cruce deja de
depender de un número que el TPV adivina.

### 2.3 · Lo RECIBIDO se sube también con internet, y tiene tope

`CLAVE_RECIBIDAS` es la lista de `clientSendId` que la tablet recibió por la wifi. Se sube
en `POST /kitchen/sincronizar` para que el servidor apunte `lanReceivedAt` y no encienda el
«llegó tarde» de una comanda que el cocinero lleva viendo veinte minutos.

Hasta este bloque la subida sólo se disparaba **al volver la red** o **si había marcas
pendientes**. Un bar con internet no cumple ninguna de las dos, así que:

- la lista crecía un id por comanda, servicio tras servicio;
- **`lanReceivedAt` no se escribía nunca** con internet puesto — o sea que media función de
  kds-2 estaba muerta sin que nada lo dijera;
- y al pasar de **500** (el `maxItems` del esquema de la ruta) el POST habría empezado a
  contestar 400 **para siempre**. El día que el bar se quedara sin internet, el libro de
  marcas del cocinero no habría podido subir.

Ahora se sube también con internet (5 s después de recibir), y además hay **tope de 400**,
por debajo del `maxItems`. Lo que se cae del tope es lo más viejo, y lo que se pierde con
ello es el apunte de `lanReceivedAt` de una comanda de hace horas, no una comanda.

### 2.4 · `sincronizar` ya NO vacía las tarjetas de la wifi

Subir el libro no significa que el servidor tenga ya las tarjetas: significa que sabe qué
recibió esta tablet. Las tarjetas de la nube las crea el OUTBOX del TPV, que puede ir
detrás. Vaciarlas al sincronizar dejaba la pantalla **sin esas tarjetas hasta el siguiente
GET** —20 s— con los platos en la plancha.

Quien las suelta ahora es el cruce, y sólo cuando el `GET` trae su gemela. Es más tarde y
es la verdad.

### 2.5 · El orden de los platos lo fija LA PANTALLA, y el servidor sólo lo estabiliza

El prompt pedía las dos mitades. La del servidor es un `orderBy` y está puesta, pero **no
puede ser «el orden de la comanda en el TPV»**, y hay que decirlo:

- `KitchenOrderLine` no tiene columna de posición. `TicketLine` tampoco. La factura misma
  ordena las líneas por `id` (`tickets/build-document.ts`).
- Y el `POST /tickets/:id/send-to-kitchen/escpos` **no manda ninguna lista ordenada**: manda
  `clientSendId`, `urgent` y `sentAt`. El servidor compone la comanda del DRAFT.

O sea que **nadie guarda el orden en que el camarero tecleó**, y el servidor no tiene de
dónde sacarlo. El `orderBy` es `[{ course: "asc" }, { id: "asc" }]`: por tiempo —que es como
se lee una comanda— y luego por un id que no cambia nunca.

Lo que de verdad arregla el salto es la pantalla: `ordenEstable` (`kitchen/orden.ts`)
conserva el orden en que vio cada línea por primera vez y pone las nuevas al final, venga
como venga el GET. Es lo que llega en la APK y lo que funciona contra el servidor de
producción sin desplegar nada.

**Añadir una columna `ordinal` queda escrito como carryover**, con su precio: una migración
y un campo nuevo en el protocolo del envío, para un orden que hoy nadie echa de menos más
allá de que no se mueva.

### 2.6 · Todo lo nuevo del contrato es OPCIONAL, en los dos sentidos

`clientSendId` y `allergensUnknown` en la vista, `allergens` en el estado de cocina de la
mesa, `allergensUnknown` en la línea del sobre de la wifi. Todos opcionales:

- APK nueva contra servidor viejo → no llegan, y la pantalla se comporta como antes del
  bloque (el cruce usa la llave de kds-2, y el aviso sale sólo en las tarjetas de la wifi);
- APK vieja contra servidor nuevo → los ignora.

Es la misma regla de kds-2 y es lo que permite desplegar los dos lados por separado, que es
exactamente lo que va a pasar aquí.

### 2.7 · «ALÉRGENOS SIN INFORMAR» va en ÁMBAR, y sólo con silla

El texto es el de la decisión del prompt. Lo que se decidió aquí:

- **Ámbar `#E9A93E`, no rojo.** No se sabe que el plato lleve nada: la regla del rojo
  (decisión 7) lo reserva para lo que no puede esperar. Lo que esto dice es «hay que
  preguntar», y se distingue de un «SILLA 3 · SIN GLUTEN» rojo —que es un plato
  COMPROBADO— desde la plancha. Texto negro sobre el ámbar, por contraste.
- **Va en el mismo sitio que el «SIN GLUTEN»**: la sub-franja del recuadro del plato. Es
  una instrucción sobre ESE plato, y el sitio ya existía.
- **Sólo si el plato va a una silla con algo declarado.** Un plato sin silla no lo lleva,
  aunque la mesa entera tenga una alergia: es la misma línea que la capa 3 de kds-1 (no se
  sabe de quién es el plato), y marcar los 128 platos de una carta sin informar es una
  tarjeta que nadie lee.
- **No sustituye a la alarma.** Si el plato chocara, no habría nada sin informar.
- **Ocupa dos líneas** en una tarjeta de 251 px (227 × 47 px, medido en el bucle visual).
  Se deja: el texto completo es lo que hace que se entienda, y un plato sin comprobar en la
  silla de un celíaco merece esas dos líneas. Se ve en
  `cocina-sin-informar-1280x800.png`.

### 2.8 · El `−` sobre lo enviado baja la unidad del carrito EN EL MOMENTO, sin API

La anulación ya tiene su propio viaje, con sus 5 s de «Deshacer». Lo que faltaba era que la
venta lo reflejara ya: el `−` baja la unidad **en el carrito local** y «Deshacer» la
devuelve. Cuando la anulación sube de verdad, se recarga el DRAFT y manda el servidor.

No se llama a `PATCH /tickets/:id/lines/:lineId` para bajarla: eso bajaría las unidades dos
veces (el `void-units` las baja después) y la cuenta acabaría en negativo.

### 2.9 · El catálogo se pide ANTES de mandar, y sólo cuando hace falta

Ver §4. Se pide si se juntan tres cosas: la mesa tiene alergias declaradas, el servidor no
ha dicho los alérgenos (o sea, API anterior a este bloque) y alguna línea por enviar no
tiene alérgenos informados. Con un segundo de paciencia como mucho: pasado eso se manda con
lo que haya —con su «ALÉRGENOS SIN INFORMAR» puesto—, porque **la comanda llega antes que el
dato perfecto**. Es la misma dirección que «cobrar siempre se puede».

### 2.10 · El `−` sin red ya no deja un `Unhandled Rejection`

`useKitchenMesa` relanzaba el error dentro de un `.catch` de una promesa lanzada con `void`.
Sin red, cada `−` sobre una línea en cocina dejaba un rechazo sin capturar: en el navegador
no se ve, en Sentry sí, y en la suite tumba el fichero entero sin nombrar ningún test —le
pasó a kds-1 con otro script (kds-2 §10.1)—. Ahora se traga y se dice por qué: la anulación
va por la wifi igual, y lo que no sube lo arregla el siguiente GET del DRAFT.

---

## 3 · Hallazgo 1 · la tarjeta fantasma

### 3.1 · Lo que pasaba, exactamente

El TPV manda **siempre por los dos caminos** (nube + wifi), también con internet. La copia
de la wifi vive en `useCocinaLan().extras`, y `sinDuplicados` la descartaba contra
`vista.orders` — **sólo las abiertas**.

Secuencia de la pasada: M5 con celíaco en la silla 3 y bravas a la silla 3 → tachar todo →
«Lista». La tarjeta del servidor pasa a `ready` y **sale de `orders`**. Su gemela de la wifi
se queda sin pareja y se pinta en el centro: sin tachados (los tachados se habían aplicado
sobre la del servidor), con el «ERAN 2 · −1» que sí había llegado por la wifi, y **sin
«¡LLEVA GLUTEN!»** (eso es el hallazgo 1b, §4). Reiniciar la app la quitaba porque `extras`
vive en memoria.

Y había una segunda puerta por la que volvía: con internet puesto, **las tarjetas de la wifi
no se soltaban nunca**. El único sitio que las soltaba era `sincronizar()`, que sólo corre
al volver la red.

### 3.2 · El arreglo, en tres piezas

1. **El cruce mira todo lo que el servidor conoce**: abiertas **y** listas
   (`conocidasPorElServidor` en `KitchenScreen`).
2. **Y es monótono**: `confirmadas` guarda las llaves que el servidor reconoció alguna vez
   (§2.1), así que servir la comanda —que la borra del GET entera— tampoco la resucita.
3. **Se suelta de memoria en cuanto el GET trae la gemela**, no al volver la red. Y también
   se sueltan las servidas. Con internet puesto, una tarjeta de la wifi vive unos cientos
   de milisegundos en vez de todo el servicio.

Más la guardia de entrada: si un mensaje de la wifi llega **después** de que el servidor ya
haya confirmado esa comanda (un reintento, un sobre repetido), no entra en memoria. Era la
fantasma por la puerta de atrás.

### 3.3 · `CLAVE_RECIBIDAS`, que es lo que el prompt mandaba revisar

No reanima ninguna fantasma: sólo guarda `clientSendId`, no tarjetas. Lo que sí tenía es lo
de §2.3 — crecimiento sin fin, `lanReceivedAt` muerto con internet y un 400 permanente
esperando en el id 501. Arreglado: se sube con internet y tiene tope.

---

## 4 · Hallazgo 1b · la comanda de la wifi llegó sin alérgenos

### 4.1 · La pregunta del prompt, contestada: NADA invalida la caché del catálogo

Se miró entero:

- **No hay sello de versión ni `updatedAt`** del catálogo en ninguna respuesta. `CatalogMeta`
  guarda `lastFetchedAt` y `count`, y no se compara con nada del servidor.
- **No hay evento de tienda**: el bus (`realtime/store-events.ts`) lleva `table.*`,
  `ticket.*` y `kitchen.*`. **No existe ningún `catalog.*`.**
- **El banner «Sincronizando» no es del catálogo**: es el del sync de tickets con Holded
  (`/tpv/health/holded`).
- Lo único que refresca el catálogo es: **montar la pantalla de venta**, el botón
  «Refrescar catálogo» y el «Sincronizar» del cajón.

O sea que un cambio de alérgenos —por script, como el 15-10 a las 13:21, o desde el panel—
**no llega a un terminal que lleva la app abierta**. Nunca. Y el camino directo componía la
comanda con esa caché.

### 4.2 · El arreglo, y por qué en ese orden

Los alérgenos de la comanda de la wifi se buscan ahora así
(`kitchen/tpv/alergenosDeEnvio.ts`):

1. **Lo que diga el servidor.** `GET /tickets/:id/kitchen` trae los alérgenos de cada línea
   desde este bloque, leídos de la MISMA fila que los del papel y los de la nube
   (`envio.ts`). Con esto el camino directo deja de depender de la caché del terminal.
   Un vacío del servidor es un vacío de verdad y no se corrige con la caché: «no informado»
   dicho por quien lo sabe vale más que una copia vieja.
2. **El catálogo recién pedido**, si hizo falta pedirlo (§2.9). Es el arreglo que llega con
   la APK sola.
3. **La copia de la línea del carrito**, que es lo de kds-2.

Y pase lo que pase, un plato sin alérgenos informados que va a una silla con alergia sale
marcado (§5). Ésa es la red de seguridad: el dato puede llegar viejo, pero la cocina no se
cree que está comprobado.

---

## 5 · Hallazgos 2 y 4 · el orden y el plato sin informar

### 5.1 · Por qué el plato saltaba al final

`vista.ts` seleccionaba `lines` **sin `orderBy`**, así que Postgres las devolvía en el orden
físico de la tabla. Un `UPDATE` —el `done_at` del tachado— reescribe la fila, y la fila
reescrita acaba al final.

**Y era intermitente**, que es lo peor que podía ser: el e2e contra Postgres lo enseña. Un
`UPDATE` suelto sobre una tabla recién escrita suele caber en la misma página (HOT update) y
la fila no se mueve; en cuanto hay varios —tachar, destachar, tachar— la fila se va al
final. Por eso en el AP11 el plato «a veces» saltaba: el cocinero no puede aprender a
defenderse de un fallo así.

El arreglo está en §2.5. La pantalla es la que lo cierra; el `orderBy` es el suelo.

### 5.2 · El plato sin alérgenos informados

`allergens = {}` en la ficha **no es «no lleva nada»: es «no lo sabemos»**. Estaba dicho
desde kds-1 —`choqueAlergenos` calla cuando el plato no tiene alérgenos informados— y hasta
el 15-10 no se veía por ningún sitio: el magro salía «SILLA 3 · SIN GLUTEN», exactamente
igual que las bravas comprobadas, y esa etiqueta se lee como una instrucción cumplida.

La regla vive en `ticket-model` (`avisoSinInformar`) y la llaman los dos caminos:
`vista.ts` (la nube) y `envioLan.ts` (la wifi). Un solo juego de reglas, dos sitios que lo
llaman — igual que las franjas y el aviso de choque de kds-2.

---

## 6 · Hallazgo 5 · el plato añadido no viajaba por la wifi

**No estaba en el parte: lo encontró el banco al escribir el test del catálogo.**

`componerComandasLan` recorre `estado.lines`, y el estado de cocina de la mesa viene de
`GET /tickets/:id/kitchen`, que **no se recarga al añadir un producto**: se recarga al abrir
la mesa, al poner una silla o un tiempo, al guardar las alergias, al enviar y cuando llega
un evento de cocina por el bus.

O sea que entre «toco tres platos» y «Enviar» el servidor ha cambiado y el estado del TPV
no. La comanda de la WIFI salía **sin esos platos**.

- **Con internet no se ve**: la tarjeta de la nube la compone el servidor desde el DRAFT y
  llega completa. Es lo que pasó en la pasada — y la tarjeta de la wifi del 15-10 salió con
  los platos sólo porque asignar la silla 3 recarga el estado.
- **Sin internet es una comanda que la cocina no recibe.** Que es justo el día que este
  camino existe.

Arreglo: antes de componer, si hay líneas del carrito que el estado no conoce
(`lineasQueElServidorNoConoce`), se pide el estado otra vez — una sola vez y sólo entonces.
`recargar()` devuelve ahora el estado nuevo, porque quien lo pide lo necesita en esa misma
función y no en el render siguiente.

El test exige el **ORDEN** de las llamadas (el GET entre el alta de la línea y el envío) y
no el número: después de enviar también se recarga, así que contar GETs habría pasado sin el
arreglo.

---

## 7 · La tabla de sabotajes

Cada fila se ha puesto **roja a mano** quitando su arreglo y verde al devolverlo.

| # | Sabotaje | Qué se rompe | Dónde vive el test |
|---|---|---|---|
| A | El cruce mira sólo las abiertas | La comanda del apagón, que el servidor crea **ya lista**, se pinta dos veces: en el centro y en «Listas» | `kds-2b-hierro.test.tsx` |
| B | El cruce deja de ser monótono | La secuencia EXACTA de la pasada: al servir la M5, su copia de la wifi vuelve al centro | `kds-2b-hierro.test.tsx` |
| C | Lo recibido sólo se sube con marcas pendientes | `CLAVE_RECIBIDAS` no se vacía con internet: crece hasta romper el POST por `maxItems` | `kds-2b-hierro.test.tsx` |
| D | La pantalla no fija el orden | El GET devuelve la línea tachada al final y la tarjeta la mueve | `kds-2b-hierro.test.tsx` (DOM) |
| E | El sin informar se pinta como el comprobado | El magro de la silla 3 sale «SIN GLUTEN» en rojo, igual que un plato comprobado | `kds-2b-hierro.test.tsx` |
| F | El `−` no baja la unidad del carrito | 2 croquetas → `−` → la línea dice 1 y el total sigue en 20,00 € | `kds-tpv-cocina.test.tsx` |
| G | No se recarga el DRAFT al subir la anulación | El total que queda en pantalla es una resta que el TPV se ha creído a sí mismo | `kds-tpv-cocina.test.tsx` |
| H | No se refresca el estado antes de componer | El plato recién añadido no viaja por la wifi | `kds-tpv-cocina.test.tsx` |
| I | Se quita el `orderBy` de la vista | Tachar, destachar y tachar mueve el plato al final — **en Postgres de verdad** | `kds-cocina-rutas.test.ts` + `kds-2b-hierro.e2e.ts` |
| J | `void-units` no recalcula | `tickets.total` se queda en 30 € con 20 € de consumo | `kds-cocina-rutas.test.ts` + e2e |
| K | No se avisa a la sala | El mapa y el otro terminal siguen pintando el importe de antes | `kds-cocina-rutas.test.ts` |
| L | La vista no manda `clientSendId` | El cruce vuelve a depender del nº de comanda que el TPV adivina | `kds-cocina-rutas.test.ts` |
| M | La vista no marca el sin informar | El magro de la silla 3 pasa por comprobado en la tarjeta de la nube | `kds-cocina-rutas.test.ts` + e2e |
| N | El estado de la mesa no trae los alérgenos | El camino directo vuelve a creerse el catálogo cacheado del terminal | `kds-cocina-rutas.test.ts` + e2e |

### 7.1 · Dos sabotajes enseñaron una debilidad del propio test

- **El D pasó en verde la primera vez.** Los tests del orden eran puros (llamaban a
  `ordenEstable` directamente), así que desenchufar la regla de `KitchenScreen` no los
  movía: la regla estaba bien y nadie la usaba. Hizo falta un test **sobre el DOM**, que
  mira el orden de los `data-linea-id` después de un GET reordenado.
- **El G pasó en verde la primera vez.** El optimista del `−` y la verdad del servidor dan
  el mismo número, así que quitar la recarga del DRAFT no cambiaba nada de lo que se veía.
  Se cambió la aserción a lo que de verdad importa: que el DRAFT se vuelve a pedir. Sin
  eso, lo que queda en pantalla es una resta que el TPV se ha creído a sí mismo.

### 7.2 · Y el falso aprendió tres cosas

`test/helpers/fake-prisma-cocina.ts` tenía que poder ponerse rojo:

- **ordena las líneas con el `orderBy` que le pasen, y sin `orderBy` NO ordena** — si
  devolviera siempre el orden de inserción, el sabotaje I pasaría con la regla y sin ella;
- devuelve el `dispatch` en el `findMany` de comandas (antes sólo en el `findFirst`);
- sabe de precios y totales, porque el `−` ahora los recalcula.

---

## 8 · El bucle visual

`docs/blocks/kds-2b-hierro-shots/` · 1280 × 800, el peor caso de la pantalla de cocina.
`medidas.json` lleva las medidas de cada captura.

| Captura | Qué enseña |
|---|---|
| `cocina-sin-informar-1280x800.png` | La M5 de la pasada: las bravas gritan «SILLA 3 · ¡LLEVA GLUTEN!» en rojo y el magro sale «SILLA 3 · ALÉRGENOS SIN INFORMAR» en ámbar, con el recuadro ámbar. Antes los dos se pintaban igual |
| `cocina-orden-tras-tachar-1280x800.png` | Se tacha el primer plato y el servidor devuelve las líneas en otro orden: la tarjeta las sigue pintando igual, con las bravas tachadas en su sitio |
| `cocina-tras-lista-ANTES-1280x800.png` | **La fantasma**, con el arreglo quitado: la M5 está en «Listas» y además hay una M5 en el centro |
| `cocina-tras-lista-1280x800.png` | Y con el arreglo: la M5 sólo está en «Listas». El centro, limpio |

Medidas que se miraron:

- la franja ámbar: **227,5 × 47 px**, 13 px, `#E9A93E` sobre texto `#15171B`. **Dos líneas**
  (ver §2.7). La franja roja del plato comprobado: 231,5 × 27,5 px, una línea;
- `desplaza: false` en las cuatro: nada se sale de los 800 px de alto;
- el orden de los `data-linea-id` antes y después del tachado, que es lo que mide el
  hallazgo 2: `[m2-l1, l1, l2, l3]` las dos veces, con `l1` tachada.

---

## 9 · Lo que queda fuera, y dicho

1. **La columna `ordinal`** que guardaría el orden en que el camarero tecleó la comanda
   (§2.5). Hoy nadie lo guarda y el protocolo del envío no lo manda.
2. **El «ALÉRGENOS SIN INFORMAR» en el TPV.** La decisión del prompt habla de la cocina y
   ahí está. En la comanda del camarero, un plato sin informar sigue sin decir nada: si
   mañana se quiere, el sitio es `ChipsDeLinea`.
3. **Una anulación sin internet no llega a la nube.** Va por la wifi —la cocina se entera—
   pero `void-units` no tiene outbox, así que la unidad no baja en el servidor hasta que
   alguien la repita. Es de kds-2 y no se toca aquí; lo que sí se arregló es que ya no deja
   un rechazo sin capturar (§2.10).
4. **Un plato sin silla en una mesa con alergia de «toda la mesa»** no lleva el aviso de sin
   informar (§2.7). Es deliberado y es discutible: si La Maestranza lo pide, es una línea.
5. **El catálogo sigue sin invalidarse** (§4.1). Lo que se ha hecho es que la comanda de
   cocina no dependa de él. Una ficha de producto abierta en el TPV sigue pudiendo enseñar
   alérgenos viejos hasta el siguiente refresco: eso es catálogo, no cocina, y tiene su
   propio bloque pendiente.

---

## 10 · Cómo probarlo a mano

```bash
# 1 · la suite entera (desde la RAÍZ, si no tpv-web corre sin jsdom)
pnpm db:generate          # worktree nuevo: antes de la suite
npx vitest run            # 351 ficheros · 4.644 tests

# 2 · sólo lo de este bloque
npx vitest run apps/tpv-web/test/kds-2b-hierro.test.tsx \
               apps/tpv-web/test/kds-2b-alergenos-envio.test.ts \
               apps/tpv-web/test/kds-tpv-cocina.test.tsx \
               apps/api/test/kds-cocina-rutas.test.ts

# 3 · el e2e contra Postgres (lo único que reproduce el salto del plato)
docker compose exec -T postgres psql -U mipiacetpv -c "CREATE DATABASE mipiacetpv_kds2b_e2e;"
DATABASE_URL='postgresql://mipiacetpv:mipiacetpv_dev@localhost:5432/mipiacetpv_kds2b_e2e' \
  pnpm --filter @mipiacetpv/db exec prisma migrate deploy
cd apps/api && E2E_DATABASE_URL='postgresql://mipiacetpv:mipiacetpv_dev@localhost:5432/mipiacetpv_kds2b_e2e' \
  npx vitest run --config vitest.e2e.config.ts test-e2e/kds-2b-hierro.e2e.ts

# 4 · el bucle visual
pnpm --filter @mipiacetpv/tpv-web dev --port 5283     # en otra terminal
#   `playwright-core` va en el scratchpad y el script se corre DESDE ALLÍ
#   (la resolución de ESM es relativa al fichero, no al cwd).
BANCO_URL=http://localhost:5283 BANCO_OUT=docs/blocks/kds-2b-hierro-shots \
  node docs/blocks/kds-2b-hierro-shots/banco.mjs
```

---

## 11 · Qué hay que mirar en la revisión

1. **El cruce monótono y la memoria.** `confirmadas` crece durante el servicio (dos llaves
   por tarjeta). Un servicio de 300 comandas son 600 cadenas cortas: nada. Pero si alguien
   lo persistiera en `localStorage`, dejaría de ser verdad — ver §2.1.
2. **El segundo de espera del catálogo** (`ESPERA_CATALOGO_MS`). Es una pausa en el gesto
   más caliente del TPV («Enviar»), acotada a las mesas con alergia declarada y a un
   servidor sin desplegar. Con el servidor nuevo no se pide nunca.
3. **El `−` optimista y la recarga del DRAFT.** Si la recarga fallara siempre (sin red), el
   carrito se queda con la resta local hasta la siguiente recarga buena. Es lo mismo que ya
   hacía el estado de cocina y va en la dirección de la casa: la venta sigue.
4. **Que el `orderBy` no es el orden del TPV** (§2.5). Si alguien lo lee como que sí, la
   próxima vez que la pantalla no fije el orden volverá el salto.
5. **La franja ámbar a dos líneas** (§2.7). Es la única cosa de este bloque que cambia
   cuánto ocupa una tarjeta, y por tanto cuántas caben (kds-1 §6.2).
