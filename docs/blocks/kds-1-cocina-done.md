# Bloque kds-1 · la pantalla de comandas en cocina — HECHO

Prompts: `docs/code-prompts/bloque-kds-1-cocina.md` y, la corrección visual
contra la maqueta, `docs/code-prompts/bloque-kds-1b-como-la-maqueta.md`.
Maqueta validada: `docs/kds/maqueta/` (`Main.dc.html`, `Comanda.dc.html`,
`Alergias.dc.html`).
Decisiones: `docs/kds/00-decisiones.md` (las 10, validadas una a una con Matías).
Rama `kds-1-cocina` desde `master` (con v2-H1 dentro, merge `106f0d3`). PR contra
`master`. **Ni merge, ni despliegue, ni APK publicada.**

Terminales: **D8 (AP13)** 1443 × 812 como TPV, **AP11** 1280 × 800 como pantalla
de cocina.

---

## 0 · El resumen en seis líneas

- **El servidor ya sabe qué tiene la cocina.** `TicketLine.sentUnits`: el envío
  manda la diferencia, no la mesa entera. Era el hallazgo del 08-10 y es la
  invariante de la que cuelga todo lo demás.
- La **misma APK en «modo cocina»**: un dispositivo `KITCHEN` que no cobra, no
  abre turno, no emite registro y **no releva al terminal de la caja**. Probado
  contra Postgres, no supuesto.
- **Desaparece el 409 por falta de impresora.** Una sección sin destino se marca
  como enviada: en La Maestranza, una mesa con una caña volvía a poder enviarse.
- La **alergia va por silla, no sale del ticket y no toca `Client`** — y eso
  último es una clave ajena que no existe, no una costumbre.
- El `−`/`+` vuelve a lo enviado **sólo donde hay pantalla**, con «Deshacer» de
  5 s. Es la vuelta deliberada al sabotaje 5 de v2-H1.
- **28 sabotajes, 28 rojos**, cada uno con su mensaje real abajo. Suite: 336
  ficheros, 4.285 tests. E2E contra Postgres: 25.
- **kds-1b**: la maqueta validada entró al repo (`docs/kds/maqueta/`) y la
  pantalla se corrigió contra ella. Las cinco diferencias del prompt, más lo
  que el bucle visual enseñó al volver a medir, en la §7.

---

## 1 · Lo que hay que saber antes de desplegar

### 1.1 · Dos migraciones, y la segunda toca `ticket_lines`

`20261008010000_kds_1_tipos` y `20261008020000_kds_1_cocina`. Dos porque Postgres
prohíbe **usar** un valor de enum en la misma transacción en la que se añade, y
`KITCHEN` hace falta escrito dentro de un CHECK.

**Copia de la base antes de aplicarla**: toca `ticket_lines`, que es la tabla de
la venta. La migración es aditiva —ni un DROP, ni un DELETE, ni un UPDATE
masivo— y hay un test que lo guarda.

### 1.2 · El backfill de `sent_units` repite la primera comanda de una mesa abierta

`sent_units` nace en **0** en todas las líneas que ya existen, también en las de
mesas abiertas cuya comanda ya está en la plancha. Consecuencia, dicha en voz
alta: **el primer «Enviar» de una mesa que estuviera abierta durante el
despliegue manda esa mesa entera otra vez**.

Es exactamente lo que pasa HOY en cada envío, así que no es una regresión. La
alternativa —sembrar `sent_units = units` donde `last_sent_at IS NOT NULL`—
tiene el fallo contrario y peor: daría por recibido lo que se añadió DESPUÉS del
último envío, y la cocina no lo vería nunca. **Se elige repetir antes que
perder.** Se despliega entre servicios.

### 1.3 · El módulo nace apagado

`tenants.kitchen_display_enabled` arranca en `false`. Ningún cliente de hoy
cambia de comportamiento. Lo único que sobrevive al apagado es el envío por
diferencias a la impresora, que es un arreglo.

---

## 2 · Las decisiones tomadas sin preguntar

Las diez del documento estaban cerradas. Éstas son las que hubo que tomar para
escribirlas, una a una y con su porqué.

### 2.1 · La idempotencia vive en el ENVÍO, no en la comanda

El prompt pedía «`clientSendId` (único, idempotente)» en la comanda de cocina.
Un «Enviar» puede crear dos tarjetas (cocina y barra), imprimir en una tercera
sección y marcar como enviada una cuarta sin destino. Si la llave viviera en la
tarjeta, un reintento no podría evitar la reimpresión.

Así que nace `KitchenDispatch`: una fila por envío, con la llave y con la
**respuesta guardada literal**. Las tarjetas cuelgan de ella. Mismo patrón que
`tickets.checkout_external_id`, con el cuerpo persistido porque aquí no hay un
objeto final del que reconstruirlo.

Y tres estados, no dos: *no existe* (trabaja), *existe y terminado* (devuelve su
`result`), *existe y EN CURSO* → **409 `DISPATCH_IN_FLIGHT`**. El tercero es la
respuesta honesta: no se puede devolver «el mismo resultado» de algo que todavía
no lo tiene, y lo que no se puede hacer es imprimir dos veces.

### 2.2 · Se imprime ANTES de marcar, y una impresora que falla no marca

Hoy, un fallo de impresora deja la mesa sin marcar y el camarero vuelve a pulsar
«Enviar». Con envío por diferencias, marcar y luego fallar perdería esas líneas
para siempre: la cocina no las tendría y el servidor creería que sí.

Orden: reservar el id → imprimir → una transacción con todo lo demás. Una sección
cuya impresora falla **no marca sus líneas**. Si el proceso muere entre imprimir
y marcar, la fila queda EN CURSO, el terminal recibe 409 y el camarero reenvía
con un id nuevo: la cocina puede recibir el papel dos veces. Es el único
desenlace malo que queda y es el prudente.

### 2.3 · El corte de `KITCHEN` está en la puerta del TPV, no en cada ruta

`requireDeviceToken` —el preHandler de TODAS las rutas del TPV, incluido el login
de cajero— devuelve 403 a un dispositivo `KITCHEN`. Son decenas de rutas (cobro,
turno, registro, arqueo, cierre, catálogo, devoluciones) y acordarse de añadir un
`if` en cada una es la forma de que falte en la próxima. El 403 cae **antes del
PIN**, así que una pantalla nunca llega a tener sesión de cajero.

Mismo criterio que el trigger `devices_revoke_previous`, que vive en la base y no
en `POST /devices/pair`.

### 2.4 · El tipo de aparato lo decide el CÓDIGO, no el aparato

`POST /devices/pair` **no** acepta `kind` del cuerpo: lo lleva el
`PairingCode`, que lo crea alguien autenticado desde el panel. Si lo aceptara,
cualquiera con un código de caja se emparejaría como pantalla de cocina — y como
una pantalla no releva al terminal, el resultado sería una caja con dos aparatos
vivos donde el segundo no factura y nadie se enteró.

### 2.5 · La comanda COPIA en vez de leer la venta

`KitchenOrderLine` guarda nombre, unidades, modificadores, tiempo, silla y
alérgenos **del momento del envío**. Una tarjeta que se recalculase de la venta
haría desaparecer el plato anulado, que es justo el fallo que el bloque existe
para no cometer: cocina tiene que ver «ERAN 3 · −1» y tocar «Visto».

**Excepción deliberada: las alergias de la mesa se leen EN VIVO.** La decisión 3
dice que la alergia «vale para todo lo que pida esa mesa, también después». Si se
copiaran al enviar, un celíaco declarado cuando ya había una comanda en pantalla
sólo llegaría a las comandas siguientes — y justo la que está en la plancha se
cocinaría sin saberlo.

### 2.6 · La comanda del TPV se parte POR UNIDADES

Consecuencia de la decisión 6 («la línea enseña *2 en cocina + 1 sin enviar*»):
una misma línea puede estar en los dos bloques. Cada mitad se corrige distinto —
en «SIN ENVIAR» el `−` baja unidades y la cocina no se entera; en «EN COCINA»
el `−` **anula** algo que ya está en la plancha.

### 2.7 · El «Deshacer» de 5 s vive en el TPV, no en el servidor

Un deshacer que necesite red no es un deshacer: con el 4G del bar a medio gas, el
camarero tocaría «Deshacer», no pasaría nada visible y la anulación saldría
igual. Si se deshace a tiempo **no se llama a ninguna ruta**.

Y cobrar o salir de la mesa manda ya lo pendiente: lo que no puede pasar es que
un plato desaparezca de la cuenta y se quede en la plancha.

### 2.8 · La sección de cada línea la resuelve el SERVIDOR

La regla por destino (`−`/`+` sólo donde hay pantalla) es por sección, y la
sección viaja en `GET /tickets/:id/kitchen`. Resolverla en el front obligaría a
bajar el mapa `etiqueta → sección` al navegador y a repetir la regla de
`destinos.ts`. Dos copias de esa regla es como una mesa acaba ofreciendo
corregir unidades de algo que está en la plancha.

### 2.9 · La alergia por silla, y lo que NO hay

`TicketAllergy` cuelga del ticket con CASCADE, no tiene nombre de nadie y **no
tiene ninguna clave hacia `Client`**. La hoja del TPV no ofrece ningún sitio
donde escribir un nombre. No es un dato de salud de una persona identificada: es
«en la silla 3 de la mesa 5 de esta comida no puede entrar gluten».

Y los **alérgenos del producto NO están detrás del módulo**: informar de ellos es
obligación legal (Reglamento UE 1169/2011), no una función que se vende. Lo que
se cobra es la pantalla.

### 2.10 · «Toda la mesa» necesita un índice que Prisma no sabe declarar

En Postgres los NULL son distintos entre sí, así que el `@@unique(ticketId, seat,
allergen)` NO impide dos filas «toda la mesa · GLUTEN» — y dos filas pintan la
franja roja dos veces. El índice parcial `ticket_allergies_mesa_key` vive sólo en
el SQL, con su nota en el esquema y su test del contrato.

### 2.11 · Los 14 alérgenos viven en `ticket-model`

Cuatro consumidores tienen que decir lo mismo: la hoja del TPV, la ficha del
panel, la pantalla de cocina y el papel de la comanda. Dos listas acaban en que
la pantalla dice «Lácteos» y el papel «Leche», y en una alergia eso no es un
detalle de estilo. El panel pasa a depender de `@mipiacetpv/ticket-model` por
esto.

### 2.12 · `sent_units` NO entra en el sello de la venta

Es un Decimal de `ticket_lines`, así que el guardia de S1-sello lo exige
clasificado. Va a `NOT_SEALED_MONEY_COLUMNS` con su excusa escrita: **no es un
importe** —el total sale de `units`, que sí está sellado— y meterlo cambiaría la
receta del hash, dejando sin verificar todo lo sellado antes de este bloque
(ADR-015 §5.2). Protegida sigue: el trigger de `ticket_lines` bloquea cualquier
columna de una fila sellada.

### 2.13 · El modo prueba enseña la cocina

`/shift/cashier-bootstrap` lleva ahora el módulo y los ajustes de la tienda. El
modo prueba es con lo que se DEMUESTRA el producto: una demo sin la pantalla de
comandas en una cuenta que la tiene comprada es una demo que miente.

### 2.14 · El papel de respaldo lo construye el SERVIDOR

`GET /kitchen/comandas/:orderId/escpos`. Si el TPV compusiera la comanda por su
cuenta, el papel que sale cuando la wifi se cae diría cosas ligeramente distintas
del que sale cuando la impresora funciona — y la diferencia se descubriría en el
único momento en que el papel importa. Un solo constructor, un solo formato.

---

## 3 · El esquema final, y por qué

### 3.1 · La invariante central

```
ticket_lines.sent_units   DECIMAL(10,3) NOT NULL DEFAULT 0
  CHECK (sent_units >= 0 AND sent_units <= units)
```

Cuántas unidades de esta línea ha recibido la cocina. El envío manda
`units - sent_units` y **sube `sent_units` a `units`** — se sube, no se suma, y
eso es lo que hace el camino idempotente.

El CHECK es el que de verdad trabaja: un `sent_units > units` haría que el
siguiente envío calculase una diferencia NEGATIVA —o sea, nada— y la cocina no
vería un plato que el cliente ya pidió.

Aquí muere el apaño de v2-H1 (`lib/kitchenSentLines.ts`): un conjunto de ids en
`localStorage`, que aquel bloque documentó con el caso que no acertaba y dejó
como carryover. **Este bloque es el carryover**, y el fichero se borra.

### 3.2 · Las cinco tablas

| Tabla | Qué es | Lo que la hace así |
|---|---|---|
| `kitchen_dispatches` | un «Enviar» | la unidad de IDEMPOTENCIA: `client_send_id` único y la respuesta guardada |
| `kitchen_orders` | una TARJETA: un envío × una sección | `@@unique(dispatch_id, section)`; `store_id` copiado para que el filtro del GET sea un índice |
| `kitchen_order_lines` | un plato de la tarjeta | COPIA (nombre, unidades, modificadores, tiempo, silla, alérgenos) + `fired_at`, `done_at`, `voided_units`, `void_seen_at`, `done_before_void` |
| `ticket_courses` | si un tiempo está retenido o marchado | la AUSENCIA de fila es «retenido»; la fila guarda el instante, que es de donde cuenta el semáforo |
| `ticket_allergies` | la alergia de la mesa de ESTE servicio | CASCADE del ticket, sin ninguna clave hacia `Client` |

### 3.3 · Las columnas nuevas

| Dónde | Qué | Por qué |
|---|---|---|
| `DeviceKind` | `+ KITCHEN` | cae fuera del trigger y del índice de verifactu-1 por construcción, porque los dos filtran `TERMINAL` |
| `devices` | `kitchen_sections` + CHECK | una pantalla sin secciones no enseñaría nada y el fallo se vería en el servicio |
| `pairing_codes` | `kind` + `kitchen_sections` + CHECK | la intención la pone quien crea el código, no el aparato |
| `tenants` | `kitchen_display_enabled` | se cobra POR PANTALLA; la mueve sólo el super-admin |
| `stores` | 5 ajustes + CHECK del semáforo | por RESTAURANTE: una cadena con un bar y un asador necesita los dos modos a la vez |
| `ticket_lines` | `course`, `seat` | un solo modelo para los dos modos de órdenes; la silla es un dato de la LÍNEA, no de la alergia |
| `products` | `allergens` | vacío = «no informado», que NO es «sin alérgenos» |

### 3.4 · El CHECK que no prohibía nada

```sql
-- MAL: array_length('{}', 1) devuelve NULL, la rama entera es NULL,
--      `NULL OR false` es NULL, y un CHECK que evalúa a NULL SE
--      CONSIDERA SATISFECHO.
CHECK (kind = 'KITCHEN' AND array_length(kitchen_sections, 1) >= 1 OR …)

-- BIEN: cardinality() devuelve 0 para el array vacío.
CHECK (kind = 'KITCHEN' AND cardinality(kitchen_sections) >= 1 OR …)
```

El CHECK estaba escrito, se leía bien, y dejaba entrar exactamente la fila que
existía para prohibir. **Lo encontró el e2e**, y hay un segundo guardia en
`kds-migracion.test.ts` que prohíbe `array_length` sobre esa columna, porque ese
test corre siempre y el e2e sólo con `E2E_DATABASE_URL`.

---

## 4 · La tabla de sabotajes

Cada fila: se rompió el código, se corrió su test, se copió el mensaje real y se
restauró con `git checkout -- .`. El guion está en
`docs/blocks/kds-1-cocina-shots/sabotajes.json`.

| Sabotaje | Cayó | El mensaje real del rojo |
|---|---|---|
| Volver a mandar todas las líneas en cada envío | ✅ | `expected 3 to be 1` |
| Quitar la idempotencia de `clientSendId` | ✅ | `expected false to be true` (el 2.º envío ya no es `replayed`) |
| Emparejar `KITCHEN` revoca el terminal | ✅ e2e | cubierto contra Postgres: 3 aparatos vivos, 1 `TERMINAL`, el viejo sin revocar |
| Un `KITCHEN` cobra o abre turno | ✅ | `expected 200 to be 403` |
| Un terminal tacha en cocina | ✅ | `expected 404 to be 403` |
| Cocina ve otra tienda u otra sección | ✅ | `expected [ { …(17) } ] to have a length of +0 but got 1` |
| Fallar el envío por no tener destino | ✅ | `expected 500 to be 200` |
| Anular sin avisar a cocina | ✅ | `expected [] to include 'kitchen.line_voided'` |
| Anulado que desaparece sin «Visto» | ✅ | `expected false to be true` |
| Retener la barra | ✅ | `expected null not to be null` (el `firedAt` de la caña) |
| El semáforo cuenta desde la nota | ✅ | `expected 30 to be null` |
| Orden por columnas | ✅ | `expected [ Array(4) ] to deeply equal [ Array(4) ]` |
| Cortar una tarjeta | ✅ | `expected […(9)] to have a length of 6 but got 9` |
| Alergia sin silla que no sale en cocina | ✅ | `expected [] to deeply equal [ '⚠ TODA LA MESA · SIN GLUTEN' ]` |
| No marcar el plato de la silla que lleva su alérgeno | ✅ | `expected null to be '¡LLEVA GLUTEN!'` |
| La alergia llega a `Client` | ✅ | `expected '\n  clientId String?  @map("client_id…' not to match /client/i` |
| Parpadeo de 1 s o de pantalla entera | ✅ | `expected 1000 to be greater than or equal to 2500` |
| Sonido en cocina | ✅ | `expected "spy" to not be called at all, but actually been called 3 times` |
| `−/+` en lo enviado sin pantalla | ✅ | `expected { screen: false, printer: true, …(1) } to deeply equal { … }` |
| «Servido» que no limpia | ✅ | `expected [ { …(7) } ] to have a length of +0 but got 1` |
| Módulo apagado | ✅ | `expected false to be true` (se creó una comanda de pantalla) |
| RETAIL tocado | ✅ | cubierto en `kds-tpv-cocina.test.tsx`: en RETAIL no se monta `HospitalityWorkspace` ni nada de cocina |

Y los ocho de **kds-1b**, los de la corrección contra la maqueta:

| Sabotaje | Cayó | El mensaje real del rojo |
|---|---|---|
| Fondo rojo en el cuerpo de una tarjeta urgente o con alergia | ✅ | `urgente: expected 'rgb(74, 22, 16)' to be 'rgb(26, 29, 35)'` |
| Franja de alergia sin fondo rojo | ✅ | `expected 'rgb(35, 39, 46)' to be 'rgb(200, 16, 46)'` |
| Franja de alergia con menos de 21 px | ✅ | `expected 16 to be greater than or equal to 21` |
| Modificador a menos de 17 px | ✅ | `expected 13 to be greater than or equal to 17` |
| Modificador en gris | ✅ | `expected 'rgb(139, 147, 161)' to be 'rgb(246, 207, 122)'` |
| 3 columnas a 1280 px | ✅ | `expected 3 to be 4` (y la primera fila con 3 tarjetas en vez de 4) |
| «+N» en rojo sin ninguna oculta en rojo | ✅ | `expected 'rojo' to be 'verde'`, y dos veces `expected 'rojo' to be 'neutro'` |
| Coral en un botón de la comanda que no sea «Cobrar» | ✅ | `expected [ 'boton-marchar', 'comanda-cobrar' ] to deeply equal [ 'comanda-cobrar' ]` |

### 4.1 · Un sabotaje descubrió una debilidad del propio test

«La alergia llega a `Client`» NO cayó la primera vez. El test buscaba la palabra
`Client` (el tipo de la relación de Prisma) y un `clientId String?` suelto —una
columna sin `@relation`, que es exactamente como alguien «guardaría de quién es
la alergia» sin pensarlo— pasaba por debajo. Ahora se mira sin distinguir
mayúsculas y sólo sobre las líneas de CAMPO, no sobre los comentarios.

Y volvió a pasar en kds-1b, con **«modificador a menos de 17 px»**. El test
comparaba el tamaño pintado contra el token `NOTA_PX`, así que bajar el token
bajaba también el listón y el sabotaje pasaba en verde. Los números de la
maqueta —17 px y `#F6CF7A` para los modificadores, 21 px para la franja de la
alergia— van ahora **a pelo** en el test. La regla que deja esto: *un test que
protege un valor de diseño no puede leer ese valor del sitio que se sabotea*.

---

## 5 · Lo que los tests encontraron (y no eran de los tests)

1. **`useKitchenMesa` se creía un 200 con la forma incompleta** y tiraba el
   render entero de la comanda (`estado.allergies.length` sobre `undefined`).
   Pasa de verdad: un bundle nuevo contra una API vieja durante los minutos de un
   despliegue, o un proxy que contesta otra cosa. Lo encontraron dos ficheros de
   v1.12 al correr la suite completa.
2. **La pantalla de cocina se creía una medida de 0** del contenedor y mandaba
   TODAS las comandas al «+N»: la cocina se habría quedado mirando una pantalla
   vacía con un «+9» en la esquina. Una medida de 0 significa «todavía no hay
   layout», no «no cabe nada».
3. **Los alérgenos se perdían en el primer viaje de ida y vuelta de la línea**:
   `DRAFT_INCLUDE` no los traía y el TPV reconstruye el carrito desde esa
   respuesta. El aviso «¡Lleva gluten!» al asignar la silla habría dejado de
   salir EN SILENCIO.
4. **El CHECK `devices_kitchen_sections` no prohibía nada** (§3.4).
5. **El orden del anexo II pone la soja (6ª) antes que la leche (7ª)**. El test
   del importador se escribió con `LACTEOS` delante, se puso rojo, y el orden del
   enum era el correcto.

---

## 6 · El bucle visual

`docs/blocks/kds-1-cocina-shots/`. Mismo montaje que v2-H1: `playwright-core` en
el scratchpad, Chromium de `ms-playwright`, `vite` sirviendo `apps/tpv-web` y
`page.route` sobre `/api/**`. Nada se instala en el repo.

### 6.1 · La pantalla de cocina, a 1280 × 800

Las medidas son las de **después de kds-1b**, o sea contra la maqueta.

| | medido | la maqueta |
|---|---|---|
| Barra superior | 1280 × **60** | 60 |
| Zona de tarjetas | **1060 × 740** (contenido: 1036 × 716) | — |
| Franja «+N» | **60** × 740 | 60 |
| Columna «Listas» | **160** × 740 | 160 |
| Tarjeta | **251,5** de ancho · **4 columnas** | 4 × `1fr` |
| Fondo del cuerpo | **`#1A1D23`** en las cuatro | `#1A1D23` |
| Cabecera del semáforo | 251,5 × **54** · verde `#8FD9A8` sobre `#15171B` | igual |
| Mesa | **34 px** · minutos **28 px** | 34 / 28 |
| Franja «URGENTE» | 251,5 × **52**, texto **26 px** blanco sobre `#C8102E` | 52 / 26 |
| Anillo de la urgente | **4 px** por `box-shadow` | 4 px |
| Franja de alergia | 251,5 × **65,6** · `#C8102E` · título **21 px**, alérgeno **15 px** | 21 / 15 |
| Sub-franja «SILLA 3 · SIN GLUTEN» | 227,5 × 27,5 · **13 px** sobre `#C8102E` | 13 |
| Línea de plato | 223,5 × **56** | ~45 (ver §7) |
| Nota / modificador | **17 px**, peso **600**, `rgb(246, 207, 122)` | 17 / 600 / `#F6CF7A` |
| «Lista» | 223,5 × **56**, neutro `#2C313A` | `#2C313A` |
| «Hoy» | 71,4 × **56** | 44 (ver §7) |
| «+N» | texto **30 px**; en rojo usa el rojo del SEMÁFORO (`#E0533F`) | 30 |
| Pastilla «Listas» | «M3 · esperando · 2 min» sobre `#8FD9A8` | igual |
| La hora en la barra | **sí**, `21:54`, del servidor | sí |
| Pulso | **2,5 s** (tarjeta, «+N» nueva, rojo y ámbar) | 2,5 s |
| Elementos `<audio>` | **0** | — |
| Desplazamiento de la página | 800 / 800 · **ninguno** | — |
| **Tarjetas cortadas** | **0** | — |

### 6.2 · Cuántas comandas caben

**Con los tokens de la maqueta entran las ocho que pide la decisión 7**, y ésa
es una diferencia que kds-1b cerró: con tres columnas de 320 px entraban seis.

- **comandas normales** (hasta tres platos de nombre corto, sin alergia): **8**
  — dos filas de cuatro. Estimadas en 336 px; dos filas son 682 ≤ 716.
- **con la comanda de alergia por silla en la primera fila**: **4**. Esa
  tarjeta mide **500,3 px** reales —franja de dos líneas, recuadro por plato de
  la silla y la pastilla «lleva gluten»— y, como cada fila mide lo que su
  tarjeta más alta (decisión 7, literal), se come la fila entera. Es lo mismo
  que dibuja `Main.dc.html`: **una fila de cuatro y un «+2» en el borde**.

Las que no caben van a la franja «+N» con las mesas debajo, que es exactamente
el mecanismo que la decisión 7 manda usar en vez de paginar, y entran según
salen las primeras. Ninguna tarjeta se corta: 0 medidas.

### 6.2.1 · La estimación, calibrada y VIGILADA

`altoTarjeta` estima en vez de medir (medir pide dos pasadas y parpadea). La
estimación tiene que ir **por lo alto**: por lo bajo, el reparto cree que una
fila cabe cuando no cabe y una tarjeta se corta.

El banco guarda ahora el alto REAL de cada tarjeta pintada **y lo bastante para
rehacerla** (el nombre de cada plato y sus marcas), y `kds-pantalla-pura.test.ts`
la rehace y comprueba la desigualdad **en cada `pnpm test`**. El bucle visual ya
no es algo que haya que acordarse de correr: su medida queda vigilada.

| tarjeta | real | estimada |
|---|---|---|
| T4 · urgente, 2 platos, 1 nota | 327,9 | 385 |
| M5 · alergia por silla, 3 platos | 500,3 | 518 |
| M1 · 3 platos | 324 | 350 |
| M2 · 2 platos, 1 nota | 275,9 | 303 |

Y las piezas, medidas: cabecera 54 · franja «URGENTE» 52 · franja de alergia
65,6 · plato 56 · plato con nota 69,9 · plato de silla con recuadro 100,3 ·
plato que choca 83,5 · plato con «lleva gluten» 73,4 · «Lista» 56.

### 6.3 · El TPV, a 1443 × 812 y a 1280 × 800

| | medido |
|---|---|
| Comanda | 420 px de ancho (sin cambios respecto a v2-H1) |
| `−` de lo enviado | **56 × 56**, sólo contorno rojo (`transparent` de fondo) |
| `+` de lo enviado | **56 × 56** |
| Chip «→ Silla 3» | 90,9 × **56** |
| Chip «Espera» | 90,3 × **56**, **sin fondo** (contorno) |
| «⚡ Urgente» | 122,2 × **56** |
| «Marchar 2º» | 124,2 × **56**, **sin fondo** (contorno), como «Enviar» |
| «⚠ Alergias · 1» | 136,4 × **56** |
| «Cobrar» | 212 × 68 · **el único botón coral de la comanda** |
| Banda «M4 · listo para servir» | 395 × **56**, texto 21 px |
| «Magro con tomate −1 · Deshacer» | 395 × **56** |
| Desborde del importe fuera de la comanda | **−21 px** (o sea, 21 px DENTRO) |
| Desplazamiento de la página | ninguno en los dos tamaños |

**El sabotaje del coral, medido**: se barre el fondo calculado de TODOS los
botones de dentro de `[data-testid="comanda"]` y se filtra por el coral
(`rgb(233, 112, 88)`). Resultado con todo encendido —chip «Espera» puesto,
«Marchar 2º» a la vista y «Urgente» activo—: `[{ testid: "comanda-cobrar" }]`.
Uno, y es el que cobra.

### 6.3.1 · «Espera» y «¡Lleva gluten!», que la primera captura no enseñaba

Existen los dos. No salían porque en el escenario del banco las cuatro líneas de
la M5 **ya estaban en cocina**, y los dos sólo viven sobre una línea PENDIENTE:
«Espera» no significa nada sobre un plato que ya marchó, y el aviso de la capa 3
salta cuando el camarero asigna la silla.

El banco deja ahora las bravas sin enviar y sin silla —que es lo que dibuja
`Comanda.dc.html`— y toca «→ Silla 3». Medido:

- los chips de la línea pendiente: `→ Silla 3Espera`;
- el aviso: **`¡LLEVA GLUTEN! · toca para cerrar`**, que avisa **sin bloquear**
  (decisión 3, capa 3: a veces la cocina tiene la versión sin gluten);
- captura: `tpv-comanda-espera-1443x812.png` y `-1280x800.png`.

### 6.4 · La hoja de alergias

4 sillas dibujadas alrededor del tablero (de `Ticket.diners`), 1 marcada con
alergia, los **14** alérgenos en la rejilla, silla de **56 × 56**, opción de
236,8 × **56**. Sin desplazamiento.

Lo que kds-1b le cambió: **«La barra está a este lado»** encima del tablero —la
referencia que hace que la silla 3 sea la misma silla para los dos camareros del
turno; sin ella, el que viene del otro lado cuenta la 1 donde el otro contó la
3— y **«Guardar» en claro** (`rgb(241, 243, 245)`) en vez de coral.

### 6.5 · Los defectos que el bucle enseñó

De la primera pasada (kds-1):

1. **`altoTarjeta` estimaba por debajo** (21 px en una tarjeta urgente, 82 en una
   con alergia): la dirección peligrosa, porque con la estimación corta el
   reparto cree que una fila cabe y una tarjeta se corta.
2. **El nombre del plato se truncaba** en la comanda del TPV: «Magro con…»,
   «Patatas br…». v2-H1 subió el nombre a 23 px precisamente para que se leyera.
   Ahora va en su propia fila a ancho completo cuando la línea lleva `−`/`+`.
3. **«Espera» salía en líneas que ya estaban en cocina**, donde no significa
   nada: ese plato ya marchó.
4. **El pico del pulso rojo era el rojo de la alarma**: la tarjeta entera se leía
   como «esta comanda es roja».

De la segunda, la de kds-1b contra la maqueta:

5. **Cada plato medía 72 px y no 56.** Los `8 + 8` de relleno de la maqueta
   estaban FUERA del botón, así que se sumaban al mínimo táctil en vez de vivir
   dentro de él. Tres platos por tarjeta son 48 px: justo lo que cuesta la
   segunda fila. Con `box-sizing: border-box`, el relleno va dentro y un plato
   de una línea mide 56 justos.
6. **El pulso de lo nuevo teñía la tarjeta de VERDE.** La primera captura de
   kds-1b usó el `#2B4636` de la maqueta en la tarjeta entera, y lo que se leía
   era «esta comanda es verde» —que en esta pantalla ya significa «va bien» en
   el semáforo y «ya está» en «Listas»—. Es el mismo error que el rojo del punto
   4, con otro color. El verde se queda donde la maqueta lo pone, que es la
   franja «+N» de 60 px; la tarjeta pulsa a un carbón un peldaño más claro.
7. **La franja «+N» en rojo no se leía**: texto gris sobre rojo, y «no caben»
   partido en dos palabras en 60 px de ancho. Ahora usa el rojo del SEMÁFORO
   (`#E0533F`) con su tinta oscura —lo que informa es un estado del semáforo, no
   una alarma— y sólo lleva palabra cuando son nuevas.
8. **El «Visto» estaba dentro del botón de tachar.** Un botón dentro de otro no
   es HTML válido, y en la línea anulada del todo el de fuera va `disabled`: el
   cocinero no habría podido quitar el aviso nunca.

Y un cambio de forma que sale de la propia decisión 3: la silla y el grito van en
UNA línea, «SILLA 3 · ¡LLEVA GLUTEN!». Es lo que la decisión dice literalmente.

---

## 7 · Las diferencias con la maqueta

**La maqueta ya está en el repo**: `docs/kds/maqueta/`, tres HTML con los
estilos en línea, así que cada hex y cada px de abajo se puede comprobar con un
`grep`. La sesión que escribió kds-1 no pudo abrirla —el lienzo de Design no
estaba compartido— y dedujo los valores de lo que `docs/kds/00-decisiones.md`
describe con palabras. **kds-1b es la corrección: donde la maqueta y la
deducción no coinciden, manda la maqueta.**

### 7.1 · Las cinco del prompt

| # | La diferencia | Estado | Qué se hizo |
|---|---|---|---|
| 1 | El cuerpo de la T4 (urgente) y el de la M5 (alergia) salían en rojo oscuro | **corregida** | `TARJETA_CUERPO = #1A1D23` en TODAS. El pulso rojo se ponía en el `<article>` entero; ahora una comanda nueva pulsa en neutro y el rojo vive sólo en la franja «URGENTE» (más su anillo de 4 px), la franja de la alergia, el recuadro del plato de la silla y el plato que lleva el alérgeno |
| 2 | La alergia de la mesa era una cajita oscura con «⚠ SILLA 3 · SIN GLUTEN» | **corregida** | Franja roja (`#C8102E`) de ancho completo bajo la cabecera, con icono, «SILLA 3 · CELÍACO» a 21 px / peso 700 y «Gluten» a 15 px debajo. El «SIN GLUTEN» se fue **al recuadro del plato** de esa silla, que es donde dice algo |
| 3 | Modificadores y notas en gris, pequeños y con «·» | **corregida** | Ámbar `#F6CF7A`, **17 px**, peso **600**, con «— » delante |
| 4 | Tres columnas, nombres truncados y «+N» en rojo al pie de «Listas» | **corregida** | **Cuatro columnas** a 1280 px (de «Listas» 240 → 160 y del indicador 96 → 60); el nombre **se parte en dos líneas** y nunca baja de 22 px; el «+N» pasa a una **franja vertical neutra** en el borde de las tarjetas, con las mesas debajo, que **parpadea en verde** si hay nuevas y sólo va en rojo si una de las ocultas ya pasó a rojo en el semáforo |
| 5 | Coral en «Marchar 2º» y en «Guardar» | **corregida** | «Marchar 2º» neutro con contorno, como «Enviar»; «Guardar» en claro, como el «Listo» de la maqueta. Y de paso el chip «Espera» encendido, la tecla del tiempo elegido y el contorno de la silla elegida, que también eran coral. **El único coral de la comanda es «Cobrar»**, y hay un sabotaje que barre todos sus botones |

### 7.2 · Lo que se miró y se anota

| Lo observado | Estado | El porqué |
|---|---|---|
| «Listas» era gris y decía «1 plato»; la maqueta la pinta verde con «esperando · 3 min» | **corregida** | Cuántos platos lleva no es asunto de nadie una vez están hechos; lo que hace falta saber es **cuánto lleva en el pase enfriándose**. Pastilla `#8FD9A8` con «esperando · N min» |
| La barra superior no llevaba la hora | **corregida** | En una cocina sin reloj de pared, «14 min» no dice a qué hora entró la comanda. Es la hora del SERVIDOR, igual que los minutos del semáforo |
| En la hoja de alergias faltaba la referencia de dónde queda la barra | **corregida** | Es lo que hace que la numeración de las sillas sea siempre la misma: sin punto de partida, el camarero que viene del otro lado cuenta la 1 donde el otro contó la 3, y «silla 3 · celíaco» deja de nombrar a nadie |
| No se veían «Espera» ni «¡Lleva gluten!» en la captura de la comanda | **existen, y ya salen** | Sólo viven sobre una línea PENDIENTE, y en el escenario del banco las cuatro estaban ya en cocina. Ver §6.3.1 y `tpv-comanda-espera-*.png` |

### 7.3 · Lo que se corrigió además, porque la maqueta lo dice

El prompt lista cinco; la maqueta dice más cosas, y la instrucción es que **sus
colores, tamaños y textos son los de entrega**. Lo que cambió por eso, con su
razón:

| | antes (deducido del texto) | ahora (la maqueta) |
|---|---|---|
| Tonos del semáforo | oscurecidos: `#2E6B4A` / `#9A6B12` / `#A33124`, texto claro | **claros con tinta oscura**: `#8FD9A8` / `#E9A93E` / `#E0533F` sobre `#15171B`. La decisión 3 decía «el ámbar y el rojo, oscurecidos»; la maqueta que Matías validó los pinta claros, y una cabecera clara sobre el carbón del fondo se reconoce de un metro sin leerla |
| Rojo de la alarma | `#C2301F` / `#B82B1C` | **`#C8102E`**, uno solo para el urgente y la alergia |
| Pico del pulso rojo | `#4A1610` (rojo → carbón) | **`#C8102E` ↔ `#7A0A1C`**: de rojo a rojo, así lo que parpadea sigue siendo rojo todo el rato |
| Escala | mesa 40, minutos 36, plato 26, nota 19 | **34 / 28 / 22 / 17**. Bajan porque con cuatro columnas la tarjeta mide 251 px y un plato a 26 px se parte en tres líneas |
| El eyebrow («2ª COMANDA») | debajo de la cabecera, en gris | **dentro de la cabecera**, bajo la mesa. Son 19 px por tarjeta, y 19 × 2 filas es lo que separa «caben ocho» de «caben cuatro» |
| Botón «Lista» | verde `#2F8F5B` | **neutro `#2C313A`**. El verde de esta pantalla significa «ya está», y «Lista» es el botón que hay que tocar para que lo esté |
| «⚡ URGENTE» | el emoji | **un SVG de rayo** y la palabra «URGENTE», con tracking `0.12em` |
| «lleva gluten» informativo | texto ámbar separado por «·» | **pastilla con contorno `#FF8A99`** a 14 px, una por alérgeno |
| «EN ESPERA» | dos palabras | **«EN ESPERA · SALE CUANDO LO MARCHEN»**, con filete de puntos encima |
| Plato tachado | fondo distinto | **`opacity: 0.42`** y tachado |
| «Visto» | gris sobre la línea | **en claro**: sobre la caja roja de un anulado, un botón gris no se ve |
| «En línea» | «EN LÍNEA» | **«En línea»**, en pastilla `#16241C` con punto verde |

### 7.4 · Lo que NO se ha puesto como la maqueta, y a propósito

| | la maqueta | la entrega | el porqué |
|---|---|---|---|
| Alto de una línea de plato | ~45 px | **56 px** | «Ningún objetivo por debajo de 56 px en cocina» es una **restricción del bloque**, no una decisión de estilo, y el prompt dice que no se reabren decisiones. La línea entera es lo que se toca para tachar. **Cuesta una fila de tarjetas** cuando hay una comanda de alergia en pantalla (§6.2), y es el precio que se paga a sabiendas |
| Botón «Hoy» | 44 px | **56 px** | Lo mismo |
| «Visto» | 44 px | **44 px** | Es la única excepción de esa restricción y ya estaba acotada: vive DENTRO de una línea que ya es de 56 |
| Nombre del alérgeno en la rejilla de los 14 | «Gluten», «Huevos» | **«Cereales con gluten», «Huevo»** | `etiqueta` es el nombre LEGAL del anexo II y es el que tiene que cuadrar con la carta y con la ficha del producto en el panel. El nombre corto —«Gluten»— sí se usa donde la maqueta lo usa: la segunda línea de la franja de cocina |
| «Toda la mesa» en la hoja de alergias | botón tenue al pie, «No sé la silla · toda la mesa» | botón rojo arriba, «TODA LA MESA» | Es de v2-H1/kds-1 y no estaba en las cinco. **Pendiente del visto bueno de Matías**: la maqueta lo quiere más discreto |
| La rejilla de los 14 | 4 × 4 llenando el alto | rejilla fija arriba, con hueco debajo | Lo mismo: no estaba en las cinco. Se ve en `tpv-alergias-1443x812.png` |
| La pastilla del cobro en la barra inferior compacta | — | sigue en coral | Es de v2-H1 y NO es un botón de la comanda: es el resumen que la abre. Se deja, y por eso el sabotaje del coral mira sólo dentro de `[data-testid="comanda"]` |

### 7.5 · Lo que la maqueta dibuja y la pantalla no puede dibujar igual

En `Main.dc.html` caben cuatro tarjetas en una fila y sobra medio lienzo, con un
«+2» en el borde. **La entrega sale igual**: una fila de cuatro, el resto a la
franja. No es un fallo del reparto — es lo que mide una tarjeta de alergia por
silla (500 px) cuando cada fila mide lo que su tarjeta más alta.

Con cuatro comandas normales, las ocho entran en dos filas (§6.2), que es lo que
pedía la decisión 7 y lo que la versión de tres columnas no conseguía.

---

## 8 · La pasada en el hierro

**NO SE HA HECHO.** Es el criterio de cierre del prompt y está sin cumplir.

Lo que hace falta y esta sesión no tiene: el **D8 (AP13)** y el **AP11**
conectados por adb. No es algo que se pueda sustituir por otra cosa — los siete
puntos del guion miden el aparato real (los segundos hasta que la comanda aparece
en la tablet, el papel por USB, la wifi apagada).

Lo que SÍ está preparado para esa pasada:

| Punto del guion | Qué lo sostiene hoy |
|---|---|
| 1 · comanda de la M5 con celíaco en la silla 3 | e2e de punta a punta contra Postgres, con el «¡LLEVA GLUTEN!» y la caña de BARRA que NO sale en la pantalla de COCINA |
| 2 · «−» en las croquetas y el «Deshacer» | `kds-tpv-cocina.test.tsx`, con los 5 s de verdad (sin temporizadores falsos) |
| 3 · «Espera» y «Marchar 2º» | `kds-tpv-cocina.test.tsx` + `kds-cocina-rutas.test.ts` (el semáforo desde cero al marchar) |
| 4 · urgente que pasa la primera | `kds-pantalla.test.tsx` (orden del DOM) |
| 5 · tachar → «Lista» → banda → «Servido» | e2e completo, incluida la lista de la TIENDA |
| 6 · wifi apagada: rojo, «Cocina no recibe», papel por USB | `kds-pantalla.test.tsx` y `kds-tpv-cocina.test.tsx`; **los segundos reales no** |
| 7 · el terminal sigue cobrando | e2e: cobro real después de emparejar dos pantallas |

**Lo que la pasada tiene que medir y nadie ha medido**: los segundos entre
«Enviar» y la tarjeta en la tablet, que el `svc power stayon` aguanta el
servicio, y que el papel por USB sale de verdad por la impresora del D8.

---

## 9 · Lo que queda fuera, y dicho

- **kds-2 · el camino directo por la wifi.** Aquí sólo el modelo preparado:
  `clientSendId` idempotente generado en el terminal y el estado de la pantalla
  en el servidor. No hay servidor dentro de la APK ni descubrimiento.
- **kds-3 · el informe de cocina.** Los datos se guardan desde hoy (enviado,
  marchado, tachado, lista, servido, quién, y la merma); el informe no existe.
- **El interruptor del módulo en la UI del super-admin.** Se mueve por
  `PATCH /super-admin/tenants/:id` con `kitchenDisplayEnabled`, igual que la
  historia clínica — que tampoco tiene interruptor en pantalla. El detalle SÍ
  pinta «Cocina» en los módulos para que el implantador sepa si está comprado.
- **`?fallback=pdf`** sigue vivo y ahora también va por diferencias, pero no crea
  tarjetas de pantalla: es un respaldo de papel para un piloto sin impresoras, y
  un piloto sin impresoras no tiene pantalla de cocina.
- Nada de v2-H2 (hojas en claro, orden de las familias) se ha tocado.

---

## 10 · Cómo probarlo a mano

```bash
# 1 · la base
docker compose up -d postgres
docker compose exec -T postgres psql -U mipiacetpv -c "CREATE DATABASE mipiacetpv_kds1;"
DATABASE_URL='postgresql://mipiacetpv:mipiacetpv_dev@localhost:5432/mipiacetpv_kds1' \
  pnpm --filter @mipiacetpv/db exec prisma migrate deploy

# 2 · la suite
pnpm vitest run                       # 336 ficheros · 4.285 tests

# 3 · el e2e contra Postgres (lo único que prueba el trigger y los CHECK)
docker compose exec -T postgres psql -U mipiacetpv -c "CREATE DATABASE mipiacetpv_e2e_kds1;"
E2E_DATABASE_URL='postgresql://mipiacetpv:mipiacetpv_dev@127.0.0.1:5432/mipiacetpv_e2e_kds1' \
  pnpm --filter @mipiacetpv/api test:e2e

# 4 · el bucle visual
#     `playwright-core` NO está en el repo: se instala en el scratchpad y el
#     banco se corre desde ahí (si no, `ERR_MODULE_NOT_FOUND`).
pnpm --filter @mipiacetpv/tpv-web dev --port 5281   # en otra terminal
mkdir -p /tmp/banco && cd /tmp/banco && npm i playwright-core@1.49
cp docs/blocks/kds-1-cocina-shots/banco.mjs /tmp/banco/
BANCO_URL=http://localhost:5281 \
  BANCO_OUT=$PWD/docs/blocks/kds-1-cocina-shots node /tmp/banco/banco.mjs

# 5 · los alérgenos de La Maestranza (EN SECO por defecto)
pnpm --filter @mipiacetpv/api alergenos:maestranza -- <tenantId>
pnpm --filter @mipiacetpv/api alergenos:maestranza -- <tenantId> --aplicar
```

Y para encender el módulo en una cuenta:

```
PATCH /super-admin/tenants/:id   { "kitchenDisplayEnabled": true }
```

Después, en el panel del cliente: **Dispositivos → Generar código → «Pantalla de
cocina» → secciones**, y **Tiendas → (la tienda) → Cocina** para los umbrales y
el modo de órdenes.
