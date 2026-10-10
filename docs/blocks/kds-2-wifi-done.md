# Bloque kds-2 · la cocina sigue recibiendo aunque se caiga internet — HECHO

Prompt: `docs/code-prompts/bloque-kds-2-wifi.md`.
Decisiones: `docs/kds/00-decisiones.md`, **decisión 9** (las otras nueve no se
tocan). Bloque anterior: `docs/blocks/kds-1-cocina-done.md`.
Rama `kds-2-wifi` desde `kds-1-cocina` (merge de `master` dentro, `1788f00`).
PR **contra `kds-1-cocina`** mientras kds-1 no esté en `master`.
**Ni merge, ni despliegue, ni APK publicada.**

Terminales: **D8 (AP13)** como TPV, **AP11** 1280 × 800 como pantalla de cocina.

---

## 0 · El resumen en siete líneas

- **El sobre va CIFRADO, no sólo firmado** (AES-256-GCM con la clave de la
  tienda). La etiqueta de GCM ES la firma: un primitivo en vez de dos, y la
  comanda de un celíaco deja de viajar en claro por la wifi de un bar.
- **La cabecera va en claro y autenticada** (AAD): quien recibe rechaza por
  tienda ajena o por viejo **sin descifrar nada**.
- **Un terminal de caja no escucha en ningún puerto**, y eso está dicho tres
  veces: en el front, en quién reparte la clave, y en un CHECK de Postgres que
  no se puede olvidar.
- **La clave se rota al revocar cualquier aparato**, desde un trigger. No hay
  ningún `if` del que acordarse en `POST /devices/pair`.
- **El papel sólo sale si fallan los DOS caminos.** El `needsPaperFallback` del
  servidor es la mitad: él no puede saber si la comanda está llegando por la
  wifi, porque esa conversación no pasa por él.
- **La pantalla NO se pone roja** mientras le llegan comandas: franja ámbar.
- **El `sentAt` lo sella el terminal** (§2.6b): sin eso, el «Lista» que la
  cocina marcó durante el apagón se perdía al volver la red, en silencio.
- **15 sabotajes, 15 rojos** — dos de ellos sólo después de arreglar el test,
  que es el hallazgo del bloque (§6.1). Suite: 341 ficheros, 4.400 tests.
  E2E contra Postgres: 12 nuevos.

---

## 1 · Lo que hay que saber antes de desplegar

### 1.1 · Una migración, aditiva, y nada cambia al aplicarla

`20261009000000_kds_2_wifi`. Una tabla nueva vacía, seis columnas que nacen
NULL y un trigger. Ni un DROP, ni un DELETE, ni un UPDATE masivo.

**Sin clave de tienda no hay camino directo**, y la clave sólo nace cuando una
pantalla de cocina la pide. Un cliente sin pantalla de cocina no ve ni una
diferencia: ni una consulta más, ni un byte más por la red.

### 1.2 · Emparejar un aparato deja la tienda unos segundos sin camino directo

El trigger `stores_rotate_lan_key` borra la clave al revocar cualquier
dispositivo de la tienda — y **emparejar un terminal nuevo revoca el
anterior**, así que también rota. Durante los segundos que van hasta el
siguiente `GET /kitchen/estado` (30 s) y el siguiente latido de la tablet
(25 s), el terminal y la pantalla pueden tener claves distintas y el camino
directo rechaza con `FIRMA`.

Es deliberado y es el lado bueno del compromiso: lo contrario es que un
terminal revocado siga metiendo comandas en la cocina. En la práctica cae en
el minuto de una implantación, no en mitad de un servicio. **Se dice en el
guion** y el botón de la prueba lo explica con palabras.

### 1.3 · Y lo que la rotación NO arregla, dicho en voz alta

Si se revoca un aparato **mientras el bar está sin internet**, la tablet no se
puede enterar y ese aparato sigue pudiendo hablarle hasta que vuelva la red. No
hay forma de propagar una revocación sin un camino por el que propagarla.

Lo que sí hay: el envío de ese terminal **no llega nunca a la nube**, así que
no cobra, no factura y se ve en el panel.

### 1.4 · La APK hay que reconstruirla

La pieza nativa es nueva (`KitchenLanPlugin`, `KitchenLanServer`,
`KitchenLanMensaje`, `KitchenLanProtocol`). Un bundle nuevo sobre una APK vieja
**no tiene camino directo**: `hayCaminoDirecto()` devuelve false, el TPV manda
sólo a la nube y la tablet no abre ningún puerto. Degrada a lo de kds-1 sin
romper nada, pero el bloque no está puesto hasta que se instala la APK.

---

## 2 · Las decisiones tomadas sin preguntar

El prompt nombra cuatro («sobre todo: cifrar o no, puerto, intervalo de sondeo
y tiempo máximo de un mensaje»). Están las cuatro y las demás.

### 2.1 · SE CIFRA, y sale más barato que no hacerlo

El prompt lo dejaba abierto: «cifrado si el coste es razonable». Va cifrado con
**AES-256-GCM**, y las tres razones:

- Lo que viaja lleva el plato de la silla 3 de una mesa con un celíaco. Es la
  wifi de un bar, con el móvil de cualquier cliente dentro: en claro, cualquiera
  con un sniffer lee las comandas.
- No añade ninguna dependencia: `crypto.subtle` está en el WebView y
  `javax.crypto` en Android.
- **Y es un primitivo MENOS.** GCM autentica además de cifrar: su etiqueta ES
  la firma que pedía el prompt. Con HMAC haría falta firmar y además decidir
  qué se firma.

Lo que **no** va cifrado es la cabecera —versión, tienda, aparato, tipo, id de
la operación, sello de tiempo y nonce— y es deliberado: quien recibe tiene que
poder rechazar por tienda ajena o por viejo sin tocar la clave. Va como AAD, o
sea **autenticada**: cambiar un byte de la cabecera invalida la etiqueta igual
que cambiar el cuerpo.

### 2.2 · Puerto 8787, configurable por aparato

Por encima de 1024 (en Android no somos root) y lejos de lo que suele haber en
la red de un bar: 8080 de cámaras y grabadores, 9100 de las térmicas de red,
5555 del adb. Si en un local hay algo ahí, se cambia en
`devices.kitchen_lan_port` sin tocar código.

### 2.3 · Sondeo cada 4 s, y SÓLO sin internet

Es lo que tarda un camarero en mirar la pantalla después de que el cocinero
cante «marchando». Más despacio, el «LISTO» llega tarde; más deprisa, se gasta
batería de la tablet y de los terminales en una pregunta que casi siempre se
contesta «nada nuevo».

**Con internet no corre**: los eventos de la nube avisan solos y en el momento,
y sondear sería pedirle a la tablet cada cuatro segundos algo que el servidor
ya cuenta.

Y el sondeo hace un segundo trabajo: es lo que mantiene viva la **franja
ámbar** en un servicio tranquilo. Entre dos comandas pueden pasar más de minuto
y medio; entre dos sondeos, cuatro segundos.

### 2.4 · Un mensaje vale 60 s, contra la hora DEL SERVIDOR

60 s tiene que dar para el viaje por la wifi (ms), un reintento y el desvío
entre los dos relojes. Y no puede dar para un mensaje grabado a media mañana y
soltado a la hora de comer.

**El desvío de reloj no se tolera: se corrige.** Las dos partes cuentan con la
hora del servidor —el `serverTime` que ya viaja en cada `GET /kitchen/comandas`
y ahora también en `/kitchen/me` y en el latido— y no con la del cacharro. Una
tablet que lleva tres horas sin internet puede tener el reloj donde sea;
rechazar por eso dejaría la cocina sin comandas justo el día que importa.

La ventana es **simétrica**: también se rechaza un mensaje del futuro. Un
terminal con el reloj adelantado es el mismo problema con otro signo.

### 2.5 · La comanda del camino directo la compone EL TPV

Contradice en la forma a la decisión 2.14 de kds-1 («el papel de respaldo lo
construye el servidor»), y hay que decirlo: **aquí no se puede**. Sin internet
no hay servidor al que preguntar y la comanda tiene que aparecer igual.

Lo que sí se conserva es el fondo de aquella decisión —un solo juego de
reglas—: `componerComandasLan` usa los MISMOS datos (`GET /tickets/:id/kitchen`
ya dice la sección de cada línea, resuelta por el servidor) y las MISMAS
funciones de `@mipiacetpv/ticket-model` para la franja de la alergia y el aviso
de choque que usa `envio.ts`.

Y la comanda del camino directo **no es la verdad**: es una tarjeta para que el
cocinero cocine AHORA. La del servidor llega cuando vuelve internet con el
mismo `clientSendId`.

**Lo que NO se puede traducir, y queda dicho**: el número de comanda. Lo calcula
el TPV (`revision + 1`) con el último estado que conocía. Si dos terminales
enviaran a la misma mesa en el mismo apagón, los dos dirían «2ª COMANDA». No
hay con qué corregirlo: sin servidor no hay quien reparta números. Lo que
importa —los platos, la mesa, la alergia y la silla— llega bien.

### 2.6 · El envío a la nube que falla se va al OUTBOX

`TicketLine.sentUnits` —qué tiene ya la cocina— vive en el servidor. Sin
internet, la tablet recibe la comanda pero el servidor no se entera, y la mesa
seguiría pareciendo «sin enviar» para siempre.

Nace el tipo `kitchen-send` en el outbox de v1.5. Al volver la red, el servidor
recibe el **mismo `clientSendId`**: no duplica la tarjeta (la idempotencia de
kds-1) y sí sube `sentUnits`.

Con un caso especial: un **409 `DISPATCH_IN_FLIGHT` no es un rechazo
permanente**. Significa que ese envío está a medio procesar en el servidor (se
murió entre imprimir y marcar). Archivarlo como rechazado dejaría `sentUnits`
sin subir y la mesa volvería a mandar la comanda entera.

### 2.6b · `sentAt` lo sella el TERMINAL, no el servidor

**Esto no estaba en la primera versión del bloque: es un fallo que encontró
el e2e contra Postgres.** Hasta kds-2, `KitchenOrder.sentAt` era siempre
«cuándo se enteró el servidor», porque coincidía con «cuándo pulsó el
camarero». Con el camino directo dejan de coincidir, y por horas.

Lo que pasaba con `sentAt = ahora`:

- la cocina marcaba «Lista» a las 13:20, el outbox subía el envío a las 14:00,
  y `ready_at < sent_at` **violaba el CHECK `kitchen_orders_cronologia`**. La
  marca no se podía escribir y **el «Lista» del cocinero desaparecía**, sin
  una línea de log, porque `envio.ts` se tragaba la excepción;
- y el semáforo contaba desde las 14:00: una mesa que llevaba una hora
  esperando entraba en verde a 0 min.

O sea que `ready_at < sent_at` no es un caso raro: **es el caso normal de un
servicio sin internet**. El CHECK de kds-1 daba por hecho que el servidor se
entera antes de que la cocina pueda tocar nada; era verdad en kds-1 y es
mentira en kds-2.

Así que el terminal sella cuándo pulsó «Enviar» y el sello viaja también en el
outbox — mismo patrón y mismo motivo que el `occurredAt` de v1.11. El servidor
lo acota (`acotarSentAt`): nada del futuro (un reloj adelantado haría contar al
semáforo en negativo) y nada de hace más de 24 h (un reloj a 1970, que pasa
cuando el terminal se queda sin batería, dejaría la mesa en rojo para siempre).
Dentro de la ventana se cree al terminal, y la contrapartida está dicha: un
reloj atrasado unos minutos mueve el semáforo esos minutos.

Y lo segundo, que es lo que lo escondió: **una marca que no se puede escribir
ya no se traga en silencio**. Se registra (`kitchen.lan_mark.no_aplicada`), no
se lleva por delante al resto del lote, y se queda sin aplicar en el libro para
el siguiente intento.

### 2.7 · La marca «enviado» la pone el primer acuse, y se reconstruye del outbox

Mientras el outbox no ha podido subir, la comanda del TPV pinta como «en
cocina» lo que la tablet ya tiene. Es una superposición acotada
(`Math.min(units, …)`) que se apaga sola en cuanto el servidor confirma: nunca
puede decir que la cocina tiene más de lo que la mesa pidió.

Y se **reconstruye de los `kitchen-send` pendientes** al abrir la mesa. Una
recarga del terminal en mitad del apagón —o la pantalla que se apaga a los
cinco minutos en el AP12 y vuelve— no puede hacer que la comanda vuelva a
pintar «sin enviar» lo que el cocinero está viendo en la tablet.

### 2.8 · El libro de marcas vive en `localStorage` de la tablet

Es **la excepción deliberada** a «nada se guarda en el navegador» de kds-1.
Allí la regla era sobre `sentUnits` y el motivo era que el servidor sí lo
sabía. Aquí el servidor NO lo sabe y no puede saberlo: no hay camino hasta él.

Un servicio sin internet dura horas y la tablet se puede reiniciar en medio (se
va la luz un momento, Android mata el proceso, alguien la desenchufa). Lo que
el cocinero ya tachó es, hasta que vuelve la red, lo único que existe.

### 2.9 · Un LIBRO de marcas, y no «el estado final»

La decisión 9 dice que en el tachado, «Lista» y «Visto» manda la cocina, y que
gana la marca de tiempo **del aparato que manda en ese estado**. Con el estado
final no se puede ordenar nada: dos pantallas que tachan y destachan el mismo
plato darían el resultado del que subiera último, no del que lo hiciera último.

Con el libro, cada marca lleva su `at` y se aplican en ese orden: el resultado
es el mismo suba el servicio en el orden que sea, que es lo que de verdad hace
falta cuando vuelve la red y se sube todo de golpe.

Y la llave es el **`markId` que genera la tablet**: subir dos veces el mismo
servicio no mueve nada.

### 2.10 · Las coordenadas de una marca son las del CAMINO DIRECTO

`clientSendId` + `section` + `ticketLineId`, y no los ids del servidor. Tienen
que serlo: la tablet marca sobre una tarjeta que el servidor **todavía no
conoce** (el `kitchen_orders.id` nace cuando el envío sube por la nube).

Y de ahí sale lo que no es obvio: **una marca puede llegar ANTES que su
envío**. Pasa de verdad —la tablet puede tener cobertura antes que el terminal,
o el camarero tarda en volver a la barra—. Esas marcas quedan con `applied_at`
NULL y las aplica el propio envío al entrar (`envio.ts`). Sin eso, la marca se
quedaría en el libro para siempre y el informe del dueño diría que ese plato no
se tachó nunca.

### 2.11 · El urgente de cocina NO va al libro

El toque largo de la pantalla para subir una tarjeta a urgente es una cortesía
de la decisión 3. Pero el urgente lo manda **el TPV** (decisión 9), así que sin
red se queda sin hacer y se verá al volver. Lo que no puede pasar es que la
tablet suba un estado que no le toca y pise lo que diga el camarero.

### 2.12 · La respuesta de la tablet TAMBIÉN va cifrada

No es simetría decorativa: lleva qué mesas están listas. Si el TPV no pudiera
verificarla, cualquiera en la wifi del bar le diría «la M5 está lista» y el
camarero llevaría a la mesa un plato que no existe.

La respuesta lleva el `opId` **de la pregunta**: así el TPV sabe a qué sondeo
contesta y no se puede confundir con la respuesta de otro terminal.

### 2.13 · El socket encola y el JS vacía

No hay llamada síncrona de la pieza nativa al WebView. El socket **encola** lo
que llega (hasta 500, y tira la más antigua) y el JS lo vacía, avisado por un
evento y además por un barrido cada segundo. Tres cosas se ganan:

- una comanda que llega mientras el WebView repinta no se pierde;
- un sondeo se contesta **en el socket**, con la instantánea que el JS publicó,
  sin despertar al WebView: por eso el «LISTO» sin internet tarda milisegundos;
- si el WebView se recarga (el rescate de A4, un despliegue), la cola sigue en
  memoria del proceso y el JS la recoge al montar.

Por lo mismo, **el servidor NO se para al desmontar el componente**: pararlo en
cada recarga del WebView dejaría la cocina sorda unos segundos en mitad del
servicio. Lo para `handleOnDestroy`, que es cuando la app se va de verdad.

### 2.14 · Un `ServerSocket` y cuarenta líneas de HTTP, no NanoHTTPD

`com.sun.net.httpserver` no está en Android. Meter NanoHTTPD o Ktor sería
arrastrar una dependencia entera —con su superficie y sus actualizaciones— para
parsear dos cabeceras. Lo que se atiende es **una sola ruta** (`POST /kds`) con
`Content-Length`: sin `chunked`, sin keep-alive y **sin CORS** (a esto no se
llama desde ninguna página; un `Access-Control-Allow-Origin: *` abriría la
cocina a cualquier web que el móvil de un cliente tuviera abierta).

### 2.15 · `SIN_CIFRADO` existe separado de `FIRMA`

Y no es un detalle. El día que una tablet no pueda descifrar, lo que hay que
ver es «este aparato no puede descifrar», no «alguien está metiendo comandas
falsas». El primer diagnóstico manda a cambiar de tablet; el segundo manda a
mirar la wifi del bar media hora.

**Pasó en esta sesión**: el JDK 8u65 de este Mac tiene la política JCE
restringida (AES hasta 128 bits), el vector congelado no se abría, y el primer
código decía `FIRMA`. Costó un rato.

### 2.16 · Se manda a TODAS las pantallas de la tienda, no sólo a las de la sección

La tablet filtra por sus propias secciones —es lo que ya hace el
`GET /kitchen/comandas`— y decidir aquí a quién le toca obligaría a repetir en
el front la regla de qué pantalla ve qué. Una pantalla de barra que recibe una
comanda de cocina simplemente no pinta nada.

### 2.17 · El botón de la prueba vive en el TPV, no en el panel

La prueba tiene que salir **del terminal**: es el que está en la wifi del bar y
el que tiene el puente nativo. Desde el navegador del implantador no se puede
probar nada de esto. Está en el cajón ☰, y sólo con el módulo encendido.

Y `pruebaConexion.ts` **no pinta nada**: le entra lo que contestaron las
pantallas y le sale un diagnóstico. Así el caso que de verdad importa —el
router con «aislamiento de clientes»— tiene su test, y el texto que lee el
implantador no depende de que alguien se acuerde de repetirlo en el JSX.

---

## 3 · El esquema, y por qué

| Dónde | Qué | Por qué |
|---|---|---|
| `stores` | `kitchen_lan_key`, `kitchen_lan_key_at` | la clave vive en la TIENDA: una cadena con dos bares tiene dos wifis, y la clave de un local no puede abrir la cocina del otro — es lo que hace que el sobre se rechace por «otra tienda» antes de descifrarlo |
| `devices` | `kitchen_lan_ip`, `kitchen_lan_port`, `kitchen_lan_at` | la última dirección conocida, con la que el TPV prueba antes de redescubrir |
| `kitchen_orders` | `lan_received_at` | «la tablet ya tenía esto por la wifi»: ni se pinta como nueva ni se marca «llegó tarde» |
| `kitchen_lan_marks` | tabla nueva | el libro: una fila por tachado, «Lista» o «Visto» hecho sin red |

Y los dos guardias que **sólo existen en el SQL**:

```sql
-- Un terminal de caja no escucha en ningún puerto, y aquí no se puede
-- ni APUNTAR que lo haya hecho.
CONSTRAINT "devices_kitchen_lan_solo_cocina" CHECK (
    "kind" = 'KITCHEN'
    OR ("kitchen_lan_ip" IS NULL AND "kitchen_lan_port" IS NULL
        AND "kitchen_lan_at" IS NULL)
)
```

Escrito con `IS NULL` y no con `array_length`, que es lo que en kds-1 dejaba
pasar justo la fila que el CHECK existía para prohibir (`-done` de kds-1, §3.4):
un CHECK que evalúa a NULL **se considera satisfecho**.

```sql
-- La clave se rota al revocar, desde el motor y no desde ninguna ruta.
CREATE TRIGGER "stores_rotate_lan_key"
    AFTER UPDATE OF "revoked_at" ON "devices"
    FOR EACH ROW
    WHEN (OLD."revoked_at" IS NULL AND NEW."revoked_at" IS NOT NULL)
    EXECUTE FUNCTION mipiacetpv_stores_rotate_lan_key();
```

El `WHEN` no es decoración: sin él, cada latido rezagado de un aparato ya
revocado rotaría la clave y el bar se quedaría sin camino directo cada 20 s.

Y el trigger **borra** la clave en vez de escribir una nueva: generar 32 bytes
buenos de azar desde plpgsql exigiría `pgcrypto`, que no se asume instalado.
Borrar y que el servidor la reemita es lo mismo con una dependencia menos.

### 3.1 · Un CHECK redundante, y se deja puesto

`kitchen_lan_marks_kind` **no se puede poner en rojo solo**. Las tres ramas de
`kitchen_lan_marks_coordenadas` nombran cada una su `kind`, así que un valor
inventado cae ahí primero — también con coordenadas por lo demás correctas.

Se deja a propósito: documenta los tres valores en el motor y sigue cerrando la
puerta si alguien relaja coordenadas mañana. El e2e se ata al código **23514**
de Postgres en vez de a cuál de los dos salta primero, y lo dice.

---

## 4 · El contrato entre tres implementaciones

Lo que viaja por la wifi lo escriben y lo leen **tres** piezas: el TPV
(TypeScript, dentro del WebView), la tablet (Java, en la pieza nativa) y el
servidor (que emite la clave). Que las tres digan lo mismo no se puede
garantizar leyendo.

`packages/kitchen-lan/test/vector.json` es un sobre **congelado**: una clave
fija, un nonce fijo, una cabecera fija y su ciphertext. Lo abren los dos tests:

- `packages/kitchen-lan/test/sobre.test.ts`
- `apps/tpv-android/.../KitchenLanProtocolTest.java`

Y los dos hacen lo mismo que descifrar no prueba: **vuelven a cifrar** el
cuerpo con la misma clave, el mismo nonce y la misma cabecera, y comparan el
`ct` **byte a byte**. Descifrar sólo prueba que el AAD y la etiqueta cuadran;
re-cifrar prueba además que el ORDEN de los campos de la cabecera es idéntico,
que es justo lo que alguien podría cambiar sin darse cuenta.

Si alguien toca el separador de la cabecera canónica en TypeScript, el vector
deja de abrirse y los dos tests se ponen rojos a la vez.

### 4.1 · Lo que este Mac NO pudo comprobar, y cómo se suplió

El único JDK instalado es **8u65 con la política JCE restringida** (AES hasta
128 bits). El vector es de 256, así que los cinco tests de Java que lo
descifran **se saltan solos** con un `Assume` que lo dice; los otros cinco (la
cabecera canónica, los cuatro rechazos baratos, la memoria de operaciones)
corren siempre. En Android y en cualquier JDK moderno corren los diez.

Lo que sí se comprobó en esta máquina, y es la prueba que de verdad importaba:

1. **TypeScript cierra un sobre y Java lo abre**, con clave de 128 bits (lo
   único que este JDK permite) y el MISMO `KitchenLanProtocol.cabeceraCanonica`
   del repo. Y lo re-cifra dando el mismo `ct`. Lo que no quedó cubierto en el
   Mac es el tamaño de la clave, que es simétrico.
2. **El servidor de la tablet, de verdad, por un socket de verdad**: se levantó
   `KitchenLanServer` en una JVM y un cliente en Node le mandó nueve mensajes.
   Lo que contestó, literal:

```
1 · COMANDA        → 200, encolada, y el JS la recibe con su «¡LLEVA GLUTEN!»
2 · LA MISMA otra vez → 200 REPETIDO   (y NO se encola dos veces)
3 · SONDEO         → 200 + la instantánea firmada con la M5 lista
4 · otra tienda    → 403 OTRA_TIENDA
5 · de hace 10 min → 408 VIEJO
6 · firma tocada   → 401 FIRMA
7 · otra versión   → 409 VERSION
8 · PRUEBA         → 200 + la instantánea
9 · ruta mala      → 404
```

Las cuatro clases Java compilan contra `android.jar` (API 34) y las firmas de
Capacitor. **No se ha construido la APK**: hace falta JDK 11+ para el AGP 8 y
aquí sólo hay el 8.

---

## 5 · El camino de un envío, de punta a punta

```
  CON INTERNET
  el camarero pulsa «Enviar»
    ├─ POST /tickets/:id/send-to-kitchen/escpos   (la VERDAD)
    └─ POST http://192.168.1.44:8787/kds          (refuerzo, mismo clientSendId)
                                                   la tablet descarta el 2.º por opId

  SIN INTERNET
  el camarero pulsa «Enviar»
    ├─ la nube falla → OUTBOX (`kitchen-send`, mismo clientSendId)
    └─ la wifi acusa → la comanda está en la tablet
         · el toast dice «Sin internet · ha llegado por la wifi del local»
         · NO sale papel
         · la comanda del TPV pinta esas unidades como «en cocina»

  la cocina tacha → la nube falla → al LIBRO, con la hora de la tablet
  el camarero pide el «LISTO» → SONDEO cada 4 s → la tablet contesta firmado

  VUELVE INTERNET
    ├─ el outbox sube el envío      → el servidor crea la tarjeta, sin duplicar
    └─ la tablet sube el libro      → los tachados con SU hora, sin duplicar
         · lo que llegue en el orden que sea: las marcas se aplican por `at`
         · una marca que se adelante a su envío la aplica el envío
```

---

## 6 · La tabla de sabotajes

Cada fila: se rompió el código, se corrió su test, se copió el mensaje real y
se restauró con `git checkout -- .`. El log entero está en
`docs/blocks/kds-2-wifi-shots/sabotajes.txt`.

| Sabotaje | Cayó | El mensaje real del rojo |
|---|---|---|
| Quitar el descarte por id | ✅ | `expected { ok: true, …(2) } to deeply equal { ok: false, motivo: 'REPETIDO' }` |
| Aceptar un mensaje sin firma o con la clave de otra tienda | ✅ | `expected { ok: true, …(2) } to deeply equal { ok: false, motivo: 'FIRMA' }` |
| Aceptar un mensaje firmado de hace 10 min | ✅ | `expected { ok: true, …(2) } to deeply equal { ok: false, motivo: 'VIEJO' }` |
| Abrir el servidor local sin clave de tienda (el front) | ✅ | `expected 1 to be +0` (se arrancó una vez) |
| Quitar el CHECK `devices_kitchen_lan_solo_cocina` | ✅ + e2e | `expected '…' to contain 'devices_kitchen_lan_solo_cocina'`; y contra Postgres: `promise resolved "1" instead of rejecting` |
| Sin internet, el TPV no manda por la wifi | ✅ | `expected [] to have a length of 1 but got +0` |
| Al volver internet, duplicar (la pantalla) | ✅ | `expected [ { id: 'lan:x:COCINA', …(16) } ] to deeply equal []` |
| Al volver internet, duplicar (el libro del servidor) | ✅ | `expected 1 to be +0` (dos filas de la misma marca) |
| Pisar la hora de cocina con la del servidor en un tachado | ✅ | `expected '2026-10-08T23:31:04.549Z' to be '2026-10-09T13:05:00.000Z'` |
| Papel con la wifi funcionando | ✅ (2.ª) | `expected true to be false` — ver §6.1 |
| Pantalla roja con la wifi funcionando | ✅ | `expected <div …(3)>…(2)</div> to be null` |
| Quitar la franja ámbar | ✅ | `expected null not to be null` |
| La IP de la tablet cambia y no se redescubre | ✅ | `expected false to be true` (`alguna`) |
| Clave sin rotar al revocar (quitar el trigger) | ✅ + e2e | `expected '…' to contain 'CREATE TRIGGER "stores_rotate_lan_key"'`; y contra Postgres: `expected 'dFtsPNuv…' to be null` |
| Aceptar en el libro una marca que NO es de cocina | ✅ (2.ª) | `expected 200 to be 400` — ver §6.1 |
| La comanda y la alergia viajan EN CLARO | ✅ | `expected false to be 'cocina'` (el sobre deja de abrirse) |
| La pantalla no vacía la cola de la pieza nativa | ✅ | `expected null not to be null` (no hay tarjeta) |
| El libro no sobrevive a un reinicio de la tablet | ✅ | `expected [] to have a length of 1 but got +0` |

Y los del lado Java, que corren con `./gradlew :app:testDebugUnitTest`: el
vector se abre, se re-cifra idéntico, y los cinco rechazos
(`FIRMA`, `OTRA_TIENDA`, `VIEJO`, `VERSION`, `REPETIDO`) con su código HTTP.

### 6.1 · DOS sabotajes pasaron en VERDE la primera vez

Es el hallazgo del bloque, y es la lección del §4.1 de kds-1 otra vez.

**«Papel con la wifi funcionando».** La regla era una línea dentro de
`useCaminoDirecto` y el test **reimplementaba la resta**:

```ts
// MAL: el test lleva su propia copia de la regla.
const papel = (servidorDice: boolean, wifiViva: boolean) =>
  servidorDice && !wifiViva;
```

Quitar el `&& !wifiViva` de producción no rompía nada. La regla salió a
`saleElPapel()`, exportada, y el test la llama. **Regla que deja esto: un test
que protege una regla no puede llevar su propia copia de la regla** — es la
hermana de la de kds-1 («un test que protege un valor de diseño no puede leer
ese valor del sitio que se sabotea»).

**«Aceptar en el libro una marca que no es de cocina».** La única puerta era el
CHECK del motor, así que el rojo tardaba un e2e. Se pinchó el enum en el
esquema de la ruta (`HECHO`/`VISTO`/`LISTA`) y su test. Importa: si la ruta
aceptara un `kind` cualquiera, una tablet podría subir un «URGENTE» con su hora
y pisar lo que dijo el camarero, que es justo lo que la decisión 9 reparte.

### 6.2 · Y un tercero, que sólo vio Postgres

Los dos de arriba los encontró el sabotaje. El tercero no lo encontró ningún
test escrito a propósito: lo encontró **el e2e contra Postgres el día que el
calendario pasó por encima de una fecha clavada en el fixture**.

El test de «una marca que llega ANTES que su envío» usaba
`2026-10-09T14:10:00Z` a pelo. Mientras «hoy» fue el 9, la marca caía en el
futuro y pasaba; el día 10 cayó en el pasado y se puso roja, con el mensaje
menos informativo posible (`expected undefined to be …`). Debajo había un
fallo de producción de verdad: el de la §2.6b.

**La regla que deja esto: un fixture con una fecha absoluta prueba una cosa
distinta cada día.** Los instantes de ese fichero son ahora relativos a
`Date.now()`, que además es lo que produce una tablet de verdad.

---

## 7 · El bucle visual

`docs/blocks/kds-2-wifi-shots/` (`banco.mjs`, dos PNG y `medidas.json`). Mismo
montaje que kds-1: `playwright-core` en el scratchpad, nada en el repo. El
plugin nativo se finge inyectando el global `Capacitor`, que es **lo que lee
`platform/index.ts`**: lo que se pinta es el camino de producción.

| | `cocina-solo-wifi-1280x800.png` | `cocina-ni-wifi-1280x800.png` |
|---|---|---|
| franja ámbar | 1280 × **44 px**, 18 px, `#8A6410` | — |
| pantalla roja | — | 1280 × 800, `#8E1D11` |
| pastilla | «POR LA WIFI», ámbar | «SIN CONEXIÓN», roja |
| tarjetas | 1 (la que entró por la wifi) | 0 |
| desplaza | no | no |

La segunda captura es **el control**: si las dos salieran iguales, el bloque no
habría hecho nada.

Y la comanda que entró por el camino directo se pinta **igual que una del
servidor**: la franja roja «SILLA 3 · CELÍACO / Gluten», el recuadro rojo del
plato de la silla, el «SILLA 3 · ¡LLEVA GLUTEN!» sobre las bravas, la pastilla
«GLUTEN» de la capa 3 en las croquetas y el «— Sin picante» en ámbar. Es la
prueba de que `componerComandasLan` usa las mismas funciones que `envio.ts`.

---

## 8 · La pasada en el hierro

**NO SE HA HECHO.** Es el criterio de cierre del prompt y está sin cumplir, por
lo mismo que en kds-1: hacen falta el **D8 (AP13)** y el **AP11** conectados, y
**una APK construida** (aquí no hay JDK 11+ para el AGP 8). Y hace falta
desenchufar el cable de internet de un router de verdad dejando la wifi
encendida, que no se puede sustituir por nada.

Lo que SÍ está preparado para esa pasada:

| Punto del guion | Qué lo sostiene hoy |
|---|---|
| 1 · comanda de la M5 con el celíaco en la silla 3, **sin internet** | la captura `cocina-solo-wifi` la pinta entera; el camino TS→socket→Java se corrió de verdad en esta máquina (§4.1) |
| 2 · «−» y «Deshacer», «Marchar 2º» y urgente sin internet | los tres salen por los dos caminos con su `opId` (`useKitchenMesa`); el «Deshacer» de 5 s no toca la red, como en kds-1 |
| 3 · «Lista» en la tablet → «LISTO» en el D8 → «Servido» | el libro de marcas + el `SONDEO` cada 4 s + el `SERVIDO` por los dos caminos |
| 4 · botón «Probar conexión directa» en verde | `pruebaConexion.ts` con sus ocho tests, incluido el del router que aísla |
| 5 · vuelve internet → cada comanda UNA vez y los tiempos buenos | e2e contra Postgres: el libro idempotente, la hora de la tablet, la marca que se adelanta |
| 6 · router apagado → papel por USB y pantalla roja | `saleElPapel` y la captura `cocina-ni-wifi` |
| 7 · el D8 cobra durante toda la pasada | no se ha tocado nada del cobro, del turno ni del offline de v1.10 |

**Lo que la pasada tiene que medir y nadie ha medido**: los segundos entre
«Enviar» y la tarjeta en la tablet **con el cable fuera**; si el router de La
Maestranza aísla los aparatos de la wifi; cuánto tarda el redescubrimiento por
NSD en esa red; y que la tablet aguanta un servicio entero con el servidor
local abierto sin que Android le mate el proceso.

---

## 9 · Lo que queda fuera, y dicho

- **El número de comanda en un apagón con dos terminales** (§2.5). Sin servidor
  no hay quien reparta números.
- **Varias cajas sincronizándose entre sí sin internet**: descartado
  (`project_offline_scope`), y este bloque no lo acerca — las cajas no se hablan
  entre ellas, sólo hablan con la cocina.
- **Abrir una mesa o añadir líneas sin internet.** En contexto mesa la verdad es
  el DRAFT del servidor (v1.0-mesas-frontend). Lo que este bloque arregla es
  **enviar a cocina lo que ya está en la pantalla del camarero**; lo que no
  puede hacer es crear la mesa. En la pasada hay que abrir la M5 **antes** de
  desenchufar el cable.
- **El informe de cocina (kds-3).** Los datos siguen guardándose, y ahora
  también los de los servicios sin internet (`kitchen_lan_marks`,
  `lan_received_at`).
- **Cocina en navegador** y **impresoras de cocina por la wifi**: fuera del
  prompt.
- **La APK**: no se construye aquí. Las clases compilan contra `android.jar`,
  pero el AGP 8 pide JDK 11+ y este Mac tiene el 8.

---

## 10 · Cómo probarlo a mano

```bash
# 1 · la base
docker compose up -d postgres
docker compose exec -T postgres psql -U mipiacetpv -c "CREATE DATABASE mipiacetpv_kds2;"
DATABASE_URL='postgresql://mipiacetpv:mipiacetpv_dev@localhost:5432/mipiacetpv_kds2' \
  pnpm --filter @mipiacetpv/db exec prisma migrate deploy

# 2 · la suite entera (desde la RAÍZ, si no tpv-web corre sin jsdom)
pnpm db:generate          # worktree nuevo: antes de la suite
npx vitest run            # 341 ficheros · 4.400 tests

# 3 · el e2e contra Postgres (lo único que prueba el trigger y los CHECK)
docker compose exec -T postgres psql -U mipiacetpv -c "CREATE DATABASE mipiacetpv_e2e_kds2;"
E2E_DATABASE_URL='postgresql://mipiacetpv:mipiacetpv_dev@localhost:5432/mipiacetpv_e2e_kds2' \
  pnpm --filter @mipiacetpv/api exec vitest run --config vitest.e2e.config.ts \
  test-e2e/kds-2-wifi.e2e.ts

# 4 · el lado Java (necesita un JDK moderno para los 10; con el 8u65 del Mac,
#     5 se saltan solos y lo dicen)
(cd apps/tpv-android/android && ./gradlew :app:testDebugUnitTest)

# 5 · el bucle visual
pnpm --filter @mipiacetpv/tpv-web dev --port 5282     # en otra terminal
#   `playwright-core` va en el scratchpad, y el script se corre DESDE ALLÍ
#   (la resolución de ESM es relativa al fichero, no al cwd).
BANCO_URL=http://localhost:5282 BANCO_OUT=docs/blocks/kds-2-wifi-shots \
  node docs/blocks/kds-2-wifi-shots/banco.mjs
```

### 10.1 · Lo que la suite e2e decía, y la corrección

**La primera versión de este `-done` decía que los 7 rojos de la suite e2e
eran preexistentes. Era falso en dos de ellos, y la comprobación estaba mal
hecha**: se quitó `kds-2-wifi.e2e.ts`, siguió en rojo, y de ahí se concluyó
«no es del bloque». Lo que faltaba mirar es que el otro fichero nuevo
—`kds-1-cocina.e2e.ts`— era el que más contaminaba.

Lo que de verdad pasaba, medido:

| | ficheros | tests |
|---|---|---|
| `origin/master`, suite e2e entera | 31 | **546 verdes** |
| esta rama, antes del arreglo | 32 | 2 rojos |
| esta rama, ahora | 32 | **560 verdes** |

- **El barrido de mesas** (`ciclo-de-caja`, «expected 9 to be 3») **sí era de
  esta rama.** `tables/abandoned.ts` mira los DRAFT con mesa de **todos los
  tenants** —es una pasada de plataforma y así tiene que ser—, y la suite e2e
  comparte una sola base. Los dos ficheros nuevos dejaban mesas abiertas
  detrás: 6 el de kds-1 y 2 el de kds-2, más los 3 suyos = 9. El arreglo es
  **aislar los datos nuevos** (`deleteMany` de sus DRAFT en el `afterAll`), no
  relajar el número exacto del test viejo: ese número es lo que lo hace valer.
- **Los 5 de fichaje** (`f3-fichar`, `f8-colegio`) sí son ajenos y dependen de
  la hora: a las 00:06 de Madrid, «hace tres horas» cruza el día local y el
  servidor contesta 409. A las 11:20 pasan, y pasan también en `master`.
- Y el **`Unhandled Rejection`** de la suite normal (`process.exit` desde
  `importar-alergenos-maestranza.ts`) era de kds-1 y **estaba tirando el CI de
  las dos ramas**: 341 ficheros en verde y vitest cortando igual, sin nombrar
  ningún test. Arreglado con la guardia de ejecución directa, y con un test que
  se la exige a todo script que un test importe.

## 11 · Qué hay que mirar en la revisión

1. **La `EDAD_MAXIMA_MS` y el reloj.** Si el desvío que la tablet guarda se
   quedara viejo de verdad (días sin internet), empezaría a rechazar todo por
   `VIEJO`. Hoy el desvío se remide en cada latido con red; sin red se conserva
   el último. Un bar que esté una semana sin internet es otro problema.
2. **El techo de la cola de la pieza nativa** (500) y el de la memoria de
   operaciones (2.000). Son muy superiores a un servicio real, pero no hay
   medida de hierro detrás.
3. **`notasDeLineaLan` en `SalePage` y `notasDeModificadores` en `envio.ts`**
   son dos implementaciones de la misma regla, y está dicho en el código: una
   parte de `CartLine` y la otra de `TicketLine.modifiers`. Si divergen, la
   comanda de la wifi diría algo distinto de la de la nube.
4. **El `WHEN` del trigger** y el `AFTER UPDATE OF revoked_at`: si alguien lo
   cambia a `AFTER UPDATE` a secas, el bar pierde el camino directo cada 20 s.
