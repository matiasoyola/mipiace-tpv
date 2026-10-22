# Bloque residencia-6 · done

**Antes del piloto.** La v1 estaba completa (D-39) y el piloto mete datos reales de residentes y
personas reales delante de las tablets. Este bloque cierra las cinco cosas que con datos de prueba no
se notan y con datos reales sí:

1. un **PIN de cuatro cifras** que se puede sacar de una tablet robada (D-68);
2. un **dato cifrado que desaparece sin dejar rastro** (deuda de clinica-7, cuatro dones anotándola);
3. una **puerta sin red** que hace repetir trabajo a la auxiliar;
4. un **parte de relevo lleno de ruido** cuando a alguien le falta el plan;
5. **ficheros que se acumulan** en el volumen clínico sin dueño.

Más el enlace del art. 15 del pie del admin, que medía 34 px y lo arrastraban tres bloques.

Cierra los puntos **11, 13, 14, 15, 18 y 20** del §19 de `residencia-5-done.md`. El 12 lo cerró
D-69 y no se toca.

---

## 1 · El PIN por alcance (D-68) · cuatro cifras, o seis

**Cuatro para quien tiene alcance por zona; seis para quien tiene algún rol de alcance total** (DUE,
médico, calidad, dirección). Quien lleva de los dos tipos, seis. Vale para la puerta, la sala y el
móvil de guardia, porque **el PIN es uno**.

El porqué, en una frase: una tablet robada lleva el roster cacheado dentro —la huella HMAC de cada
PIN y la subclave con la que se recalcula (residencia-3 §15.2)— así que probar las diez mil
combinaciones de cuatro cifras es instantáneo y **se aprende el PIN de toda la plantilla**. Con seis,
sacar el de quien lo ve todo cuesta cien veces más. Quien entra cuarenta veces por turno sigue con
cuatro, porque su PIN sólo abre lo de su zona y el presupuesto de D-05 son dos segundos por registro.

### La regla vive en el PAQUETE PURO

`packages/residencia-plan/src/pin-por-alcance.ts`: `largoDePinRequerido`, `pinPorRenovar`,
`problemaDelPinNuevo` y la frase única. Ahí y no en la API por la razón de siempre en este paquete:
**la puerta resuelve el PIN sin red**, y dos copias de esta regla serían un PIN que entra sin red y
no entra con ella. Es el mismo criterio que `gravedadDe` (residencia-4), `queToca` (residencia-2) y
`alcanceDe` (residencia-5).

### Lo ÚNICO que se guarda del largo, y lo que NO

`care_pins.pin_length`, un entero `NOT NULL` entre 4 y 8. Hace falta porque el caso que D-68 nombra
es **a una auxiliar con PIN de cuatro se le asigna el rol de DUE**: nadie le ha tocado el PIN —la
dirección ha tocado los roles— y desde ese momento un PIN de cuatro cifras abre todo el centro. Para
saberlo hay que saber cuántas cifras tenía, y el PIN **no se puede leer**: lo que hay en la tabla es
argon2id y una huella HMAC, las dos irreversibles.

**Y no hay NADA derivado de los cuatro primeros dígitos de un PIN de seis.** Ni una huella de
prefijo, ni un índice por él, ni un «busca por los cuatro primeros y después verifica». Eso reduciría
el ataque de 1 000 000 a 10 000 + 100 combinaciones y anularía la decisión entera. El prompt pedía
parar y decirlo si hiciera falta: **no ha hecho falta**. Un test de la migración vigila que no
aparezca por «ir más rápido» en un bloque futuro (sabotaje 11).

El número de cifras tampoco acerca a nadie al PIN: quien tiene la base ya ve en claro los roles de
cada persona en `care_role_assignments`, y la regla rol → largo es pública (está en el paquete puro).

### Dónde se valida, y qué pasa con el que se quedó corto

- **Al DARLO o cambiarlo**, en `PUT /residencia/personal/:userId/pin-de-puerta`: 409
  `PIN_DEMASIADO_CORTO` con `largoRequerido` y una frase que dice qué pasa y cuánto cuesta no
  hacerlo. Se valida donde se arregla, con el teclado delante.
- **Al USARLO**, si el alcance cambió después: 403 `PIN_POR_RENOVAR` en las tres pantallas, con la
  misma frase — *«Tu PIN tiene que ser de 6 cifras: pídelo en dirección.»* Quien la lee está de pie
  en un pasillo: dice qué pasa y a dónde ir, no «PIN incorrecto», que la dejaría tecleándolo otra vez.

**El orden importa y es deliberado:** la comprobación va **después de verificar el hash**. Antes,
contestar «tu PIN tiene que ser de 6» diría que ese PIN existe, que es justo lo que la frase única de
«PIN incorrecto» evita. Y **no cuenta como intento fallido**: el rate-limit se resetea igual que en
`SIN_ROL_DE_CUIDADO`, porque dejarla sumando intentos la candaría por algo que no puede arreglar.

### Al roster viaja el BOOLEANO, no el número

El arranque de la puerta y el de la sala mandan `porRenovar: boolean` por persona y **no**
`pin_length`. Decirle a una tablet robada que el PIN de la DUE sigue siendo de cuatro es decirle a
cuál le toca probar diez mil combinaciones en vez de un millón. El booleano no da eso: cuando es
`true`, ese PIN no abre nada; cuando es `false`, no dice cuántas cifras tiene.

Con eso la puerta llega **sin red** a la misma conclusión que el servidor, sin volver a escribir la
regla.

### El teclado: «PIN de 6 cifras», y la auxiliar no gana ni un toque

La pantalla sigue entrando sola **al cuarto dígito**. Un botón discreto cambia a seis casillas y
entonces entra sola al sexto. Es un **interruptor**, no un camino de ida: vuelve a cuatro con el
mismo toque, porque si no un roce dejaría la puerta en seis casillas para la siguiente persona — y
la siguiente es la auxiliar.

**Dónde va, y por qué no en el hueco del teclado.** El teclado 3×4 tiene un hueco libre abajo a la
derecha (borrar · 0 · nada). Era el sitio obvio y **está mal**: ese hueco está donde aterriza el
pulgar de quien teclea en una tablet de pared —es la razón por la que ahí no hay un «Entrar»
(residencia-3)— y un roce cambiaría el teclado a seis casillas en mitad de un PIN de cuatro. El
síntoma sería el peor posible: la auxiliar teclea sus cuatro cifras, no pasa nada, y no sabe por qué.

Va **debajo de los puntos**, en la columna de la izquierda: fuera del camino de la mano que teclea y
a la vista de quien lo necesita. Quien tiene PIN de seis entra una vez por turno y lee la pantalla;
quien tiene PIN de cuatro entra cuarenta veces y nunca pasa por ahí.

Cambiar de largo **vacía lo tecleado** (si no, los dos primeros dígitos se mandarían dentro de un PIN
de seis), y **un error no devuelve el teclado a cuatro**: quien se equivoca de dígito teniendo PIN de
seis no tiene que volver a pulsar el botón.

### Lo que ve la dirección

- **Personal** dice cuántas cifras le tocan **antes** de teclear («Su rol ve todo el centro: el PIN
  tiene que ser de 6 cifras»), cuántas tiene el que hay puesto, y pinta en ámbar el aviso de «está
  por renovar y ahora no entra en ningún sitio». El PIN sigue sin salir: ni entero, ni parcial, ni su
  hash, ni su huella.
- **El panel** gana una sección nueva, **«Lo que hay que arreglar»**, con los PIN por renovar (y el
  rol que los obliga) y los residentes sin plan. Va detrás del turno en curso y delante de los
  indicadores: no es una urgencia de hoy —nadie acaba en el hospital por esto— pero deja el centro a
  medio configurar. Y **no se pinta cuando no hay nada**: una tarjeta vacía con un «0» enseña a no
  mirar la sección.

### Lo que esto NO cierra, y hay que decirlo

**Un `UPDATE care_pins SET pin_length = 6` a mano deja entrar con cuatro cifras.** El PIN es
irreversible, así que la base **no puede comprobar su largo**: lo que sostiene D-68 es la ruta. El
alcance exacto está escrito en un test del e2e (§7, sabotaje «lo dice el done») para que no se
descubra en una auditoría. En contexto: quien tiene `UPDATE` sobre `care_pins` puede ponerle a
cualquiera el hash que quiera, así que esto no amplía lo que ya podía hacer.

Y **un rol de alcance total es un ROL, no una zona**: a una auxiliar con zona «todo el centro» (y sin
rol de alcance total) le siguen bastando cuatro cifras. Se decidió así a propósito — ver §9.1.

---

## 2 · Lo que no se descifra deja rastro

`configurarAvisoDeIlegible` existe desde clinica-7 y **no lo llamaba nadie**. Lo anotaron clinica-7
§18, residencia-1b §12.1, residencia-3 §15.4 y residencia-5 §19.11, cada vez con más columnas
detrás: hoy son **veinticuatro**. Mientras nadie lo cableara, un valor cifrado que no se descifra
salía como hueco en pantalla —«(este dato no se puede leer)»— y **no quedaba en ningún sitio**.

Dos líneas en `server.ts` y dos ficheros nuevos.

### Los seis campos, y ni uno más

`tenant · tabla · columna · fila · sitio · motivo`. Con esos seis se va a la fila. Sin el `sitio` se
sabría qué fila y no si había alguien delante de una pantalla; sin el `motivo` habría que abrir la
base para saber si el problema es la clave del centro o esa fila concreta.

### El motivo es un ENUM, y la razón es un agujero de verdad

**Porque `err.message` filtra el dato.** No en teoría: `leerJson` descifra y después hace
`JSON.parse`, y cuando el claro no es JSON el `SyntaxError` de V8 **trae el texto descifrado dentro
del mensaje**, truncado a diez caracteres:

```
Unexpected token 'l', "le huele r"... is not valid JSON
```

Diez caracteres de una nota de «algo no va bien» ya son un dato de salud. Registrar `err.message`
habría escrito eso en el log **en el único caso en que el cifrado funcionó**. Así que el mensaje no
se toca: se clasifica el TIPO del error en una de cuatro palabras —`SIN_CLAVE`, `NO_SE_DESCIFRA`,
`NO_ES_JSON`, `OTRO`— y el mensaje de la línea es fijo. De ahí también `SinClaveDeLaClinica` en
`cripto.ts`: distinguir «este centro no tiene clave» de «este valor no abre» por subclase y no por
el texto del mensaje.

Tampoco va el **ciphertext**: con el AAD y el ciphertext en un log, quien tenga el log y la DEK tiene
el dato, y los logs no se guardan como se guarda una base cifrada.

### Una línea por intervalo, no una por lectura

Una historia con una entrada ilegible se pagina veinte veces en una mañana; la exportación del art.
20 la lee otra vez; el informe, otra; y la pasada del relevo recorre el turno entero cada vez que
corre. Sin freno, **una sola fila mala llena el log y tapa la siguiente**.

Ventana de quince minutos por `tenant|tabla|columna|fila`, en memoria del proceso y no en Redis: esto
tiene que funcionar también cuando Redis no está (la CI no lo tiene y la API arranca igual), y el
peor caso de perderlo es una línea de más tras un despliegue. El mapa está **acotado** a 5 000 sitios
y tira la mitad más vieja al llegar: un diccionario que crece con cada fila ilegible distinta es una
fuga de memoria en el proceso que sirve la historia clínica.

### El `sitio`, y por qué un `AsyncLocalStorage`

`lib/sitio-de-lectura.ts`: un `AsyncLocalStorage` de `node:async_hooks` —no entra una dependencia—
puesto **una sola vez** en un `onRequest` de la raíz. El sitio es `MÉTODO /la/ruta/:con/comodines`,
**el patrón y no la URL**: la URL lleva los ids dentro y eso es un dato de alguien en una línea de
log.

La alternativa era pasar la petición a `leerTexto`, y eso son ~70 llamadas repartidas por la
historia, el informe, la exportación, el libro y el relevo — y, lo que es peor, la número 71 se
escribiría sin el parámetro y nadie lo notaría.

Fuera de una petición (un worker, un script, un test) el sitio es `fuera-de-peticion`, y eso es
información: dice que el hueco lo encontró una pasada y no una persona.

### Nivel `error`, no `warn`

Un valor cifrado que no se descifra es un dato clínico que hoy no se puede leer. La petición sigue
—el hueco marcado es deliberado desde clinica-7— pero lo que queda apuntado no es un aviso de estilo.

---

## 3 · Sin red, la puerta recuerda lo suyo

residencia-3 §15.3: *«sin red, "lo que toca" sale todo como por hacer: la tablet no sabe qué se
registró desde otra pantalla ni lo que no llegó a subir»*. **La mitad que sí se puede saber es lo
propio.**

El síntoma, dicho como pasa en el pasillo: la auxiliar marca los siete cuidados de la 112 sin wifi,
pulsa «Terminar», vuelve a entrar con su PIN —porque la han llamado de la 114— y la lista le sale
**entera por hacer**. O los repite, o se queda sin saber qué le falta.

### Almacén propio, y no el outbox

El outbox **se vacía al subir**, que es su trabajo. Cinco minutos después de volver el wifi ya no hay
nada dentro, y entonces la pantalla volvería a mentir — justo cuando se vuelve a caer. Así que lo
apuntado va a un almacén propio dentro de la misma base (`mipiacetpv-puerta`, versión 2, **sin tocar
`arranque`**: una tablet que se actualiza a media noche sigue sabiendo qué toca).

Se escribe **después de la cola** y no antes: la cola es lo que no se puede perder (residencia-3 §7);
esto es para que se vea. Y se escribe aunque haya red, porque la red puede irse entre este gesto y el
siguiente.

### Qué se guarda, cuánto, y cuándo se va

Lo que la pantalla necesita para pintar «ya hecho»: la ocurrencia, la hora, el valor y quién firmó —
nada que no esté ya en la cola de esa misma tablet. Se poda por **día del centro: hoy y ayer**, que
es lo que esta pantalla puede llegar a pintar (la noche cruza medianoche). La poda ocurre al leer, no
en un temporizador: una tablet de pared lleva seis meses encendida.

Y se borra en los dos sitios que importan: **al deshacer con red** (el servidor lo anuló, así que ya
no es verdad) y **al revocar el dispositivo**, por lo mismo que no se queda con el plan — dentro hay
qué se le hizo a quién y a qué hora.

### Lo que la pantalla dice, y lo que dice que NO sabe

Lo propio sale hecho con su marca **«· en la tablet»**, porque «consta» y «consta aquí» no son lo
mismo: lo de aquí no lo ve el relevo todavía. Y arriba, una banda:

> Lo marcado «en la tablet» está apuntado aquí y sube cuando vuelva la red. Lo que se haya registrado
> desde otra pantalla sin red no se puede saber todavía.

Decirlo es la mitad de la decisión: una pantalla que se calla eso **afirma que no se hizo**.

Lo que esto quita no es un riesgo —el servidor sigue siendo idempotente por ocurrencia, así que
volver a marcar algo entra como corrección y no como un cuidado de más— sino **un viaje de más por
el pasillo**.

---

## 4 · El parte no se llena de ruido con un residente sin plan

residencia-5 §16.4 dejó dicho que «el parte de un turno sin plan sale enorme de "no hecho"». Lo que
este bloque cierra es el otro lado del mismo problema: **un residente sin plan de cuidados vigente no
genera ni una línea de «no hecho»** —no hay nada que incumplir, porque `queToca` no devuelve nada
suyo— y eso, sin más, **lo vuelve invisible**. Sale perfecto en los indicadores, no aparece en «lo
que toca» de su puerta, y nadie se entera de que a don Luis no le preparó el plan nadie.

Así que el parte lo dice **una vez**, con sus nombres y con la consecuencia:

> 1 residente sin plan de cuidados: Luis Núñez Bravo (112). No les toca nada, así que no sale nada en
> su puerta.

Clase nueva `SIN_PLAN_DE_CUIDADOS`, la última en el orden de urgencia: no es algo que haya pasado en
el turno, es algo que falta por configurar.

### Una línea POR ZONA, y no una sola en el parte

El parte **se recorta por alcance** (D-51, `recortarAlAlcance`): una auxiliar de la primera planta no
puede leer nombres de residentes de la segunda. Una única línea «3 residentes sin plan: Carmen, Luis,
Pilar» sería un dato de la segunda planta dentro del parte de la primera. Por zona, cada una ve a los
suyos — y el panel de dirección los ve todos.

Va en las **sueltas** de la zona y no colgando de cada residente: colgada de cada uno serían otra vez
N líneas, que es lo que se viene a quitar.

### Dos decisiones de borde que salieron de correrlo

1. **«Vigente» es EN EL CORTE**, no «que haya solapado el turno». A una residente a la que le
   retiraron todas las líneas a mitad del turno, lo que el turno entrante tiene que saber es que
   **ahora** no le toca nada. Con el solape, el parte del turno en que se le retiró el plan se
   callaría justo el día que hay que arreglarlo.
2. **No se le reprocha a quien todavía no estaba.** La ocupación se lee VIGENTE (es deliberado desde
   residencia-5: un cambio de habitación no mueve los partes de la semana pasada), así que el parte
   de un día anterior al ingreso lista a los residentes de hoy. Sin el filtro por `from_at` de la
   cama, el parte de un turno de hace tres meses decía «2 residentes sin plan de cuidados» — que es
   verdad y no significa nada. **Lo cazó el e2e de residencia-5**, cuyo caso «turno sin novedades» se
   puso rojo.

Y **lo que sí sigue saliendo**: si a alguien le retiran el plan a mitad del turno, los «no hecho» de
la parte en que sí lo tenía **se quedan**. Las dos cosas son verdad y las dos tienen que constar:
borrar lo primero sería tapar un incumplimiento retirando una línea del plan, que es exactamente lo
que una auditoría no puede permitir (`no-hecho.ts`, razón 1).

---

## 5 · El barrido de ficheros huérfanos

```
pnpm --filter api barrer-huerfanos            # sólo lista
pnpm --filter api barrer-huerfanos --borrar   # y borra
pnpm --filter api barrer-huerfanos --margen=120
```

Un huérfano es un binario del volumen clínico que **ya no referencia ninguna fila**. Se acumulan por
dos caminos que residencia-3 §15.5 y residencia-5 §16.5 anotaron, y **los dos son deliberados**:
cambiar la foto de un residente deja la anterior (borrar binarios dentro de la transacción que
escribe la fila es la forma de quedarse sin la foto si algo falla después, clinica-4), y deshacer una
ocurrencia hecha suelta la evidencia porque lo exige el CHECK — que alguien subió ese PDF es un
hecho. Ninguno se arregla «borrando al vuelo».

Recorre **las seis carpetas** (`FOTO`, `CONSENTIMIENTO`, `INFORME`, `RESIDENTE`, `VOZ`, `EVIDENCIA`)
y las cruza con sus seis columnas, **sobre todos los tenants**: los ficheros de todos los centros
viven en la misma carpeta (el nombre es un uuid, no lleva el tenant dentro), así que un barrido por
tenant borraría los del de al lado. Y lee las columnas sin filtrar por nada más: una fila retirada,
anulada o de un residente dado de alta sigue referenciando su fichero (D-45).

### Por defecto sólo lista, y nunca toca dos cosas

Es un script que borra binarios de una historia clínica, así que la forma es la de
`clinica:cifrar --vaciar`: la pasada normal enseña lo que haría y el borrado es una bandera que
alguien teclea después de haberlo mirado.

1. **Un fichero referenciado**, obviamente.
2. **Un fichero más reciente que el margen** (60 min por defecto, por `mtime`). Y esto no es
   prudencia de más: entre que `guardarFichero` escribe el binario y que la transacción escribe la
   fila hay un hueco —el orden es ése a propósito, «primero el fichero, después la fila»— y una
   subida de 4 MB con una wifi mala lo alarga. Un barrido corriendo en ese hueco vería un fichero sin
   fila y **lo borraría**: la foto desaparecería y la ficha quedaría apuntando a la nada. Los que
   caen en el margen se cuentan aparte (`demasiadoNuevos`): un número alto ahí dice que el margen
   está mal puesto o que algo escribe y no cierra filas.

### El log no lleva rutas

La línea de resumen son **recuentos por clase y bytes**. Los nombres (uuid + doce hex de la huella)
no dicen nada de nadie por diseño (clinica-4), pero una ruta en un log acaba en un volcado, en una
captura y en el canal de soporte, y lo que una lista de nombres de la carpeta `residentes/` sí dice
es **cuántas fotos de residentes hay en este centro**. En el listado de la pantalla sí salen, porque
quien lo ejecuta es quien va a decidir.

---

## 6 · El enlace de la declaración responsable (§19.20)

`py-2` sobre un texto de 12 px daban **34 px** de alto táctil: por debajo del mínimo de la casa (48)
y de los 44 de la WCAG. Lo arrastraban tres bloques porque en el escritorio se pulsa con el ratón y
nadie lo notaba; en la tablet de 1280×800 con la que se configura un centro, sí. `min-h-touch`, el
peldaño que ya existe, y no un `py-3` a ojo que sería un cuarto tamaño táctil en la casa.

---

## 7 · La tabla de sabotajes

Once sabotajes, uno por línea, pasando el banco con la línea rota y devolviéndola después. **Diez
salieron rojos a la primera; el noveno salió VERDE y eso encontró un fallo del test.**

| # | Sabotaje | Banco | Resultado |
|---|---|---|---|
| 1 | `pinPorRenovar` devuelve siempre `false` | unit + e2e | 🔴 |
| 2 | `problemaDelPinNuevo` deja de mirar el largo | unit + e2e | 🔴 |
| 3 | la línea de lo ilegible registra `err.message` | unit | 🔴 |
| 4 | se avisa en cada lectura, sin ventana | unit | 🔴 |
| 5 | el roster manda `pin_length` a la tablet | e2e | 🔴 |
| 6 | el barrido se salta el margen | unit | 🔴 |
| 7 | el barrido se salta las referencias | unit + e2e | 🔴 |
| 8 | el residente sin plan deja de contarse | e2e | 🔴 |
| 9 | lo apuntado en la tablet pierde su marca | front | 🟢 → **arreglado** → 🔴 |
| 10 | el teclado pierde el botón de seis cifras | front | 🔴 |
| 11 | el CHECK del largo sale de la migración | unit | 🔴 |

**El 9, que es el que enseña algo.** El test miraba `container.textContent` buscando «en la tablet»,
y **la banda de arriba también lo dice**: quitarle la marca a la línea de la ocurrencia dejaba el
banco verde. Arreglado mirando el `<li>` de la ocurrencia, no la pantalla entera. Es la lección de
siempre: hay que sabotear lo que el banco ejercita de verdad.

### Y los sabotajes contra el MOTOR

- `UPDATE care_pins SET pin_length = 2` (o 9) → **lo para el CHECK** `care_pins_pin_length_valido`.
- Un PIN de cuatro cifras a una DUE **por la ruta** → 409.
- **`UPDATE care_pins SET pin_length = 6` con un PIN de cuatro → PASA.** Es el que no se puede
  cerrar, y está escrito como test: el PIN es irreversible, así que la base no puede comprobar su
  largo. Lo sostiene la ruta. El test también comprueba el otro lado —con el `pin_length` de verdad
  no entra— para que el agujero quede acotado a ése y no a otro.
- Dos personas con el mismo PIN → 409 `PIN_YA_USADO`, **sin decir de quién es**.
- `--borrar` con un fichero referenciado → no lo toca, y la foto vigente se sigue sirviendo.

---

## 8 · Lo que encontró el bucle visual

Contra la stack de verdad (API + Postgres + las dos PWA), con Jardín de Gredos sembrado. Dos cosas
que **ningún test vio**, porque en jsdom no hay layout:

1. **Un `<button>` es inline.** «PIN de 6 cifras» y «Volver a la puerta» salían pegados en la misma
   línea —«PIN de 6 cifrasVolver a la puerta»— y se leían como uno solo. `block` en los dos. Es la
   tercera vez que esta pantalla paga lo mismo (residencia-4: el solape de las teclas a 390 px).
2. **El rótulo de las líneas sueltas mentía dentro de una planta.** Decía «Del centro, sin
   residente» en todas las zonas; en una planta, lo suelto es lo que no cuelga de un residente
   *concreto* (una avería del office, o la línea de «sin plan», que nombra a varios). Ahora depende
   de la zona, en el admin y en la tablet de la sala.

Las dos llevan su test de clase detrás, con la nota de que lo que sostienen es el mecanismo y que la
medida de verdad la da el bucle.

---

## 9 · Decisiones tomadas sin preguntar

### 9.1 · «Alcance total» es un ROL, no una zona

D-68 dice «quien tiene algún rol de alcance total». La función de acceso tiene **dos** caminos a
«ve todo el centro»: un rol con `fullScope` **o** una zona vigente de «todo el centro». Se ha
implementado **sólo el primero**, que es lo que el prompt dice literalmente.

**Por qué, y no es pereza.** Jardín de Gredos tiene 49 plazas y dos plantas; es muy posible que un
centro así le dé a todas sus auxiliares la zona «todo el centro» por comodidad. Con la otra lectura,
**todas las auxiliares pasarían a seis cifras**, que rompe lo que D-68 dice con todas las letras: «la
auxiliar no gana ni un toque». El agujero que queda —una auxiliar con zona de todo el centro y PIN de
cuatro— está en las dudas abiertas (§11.1) para que lo mire quien configure el piloto.

### 9.2 · Un PIN más largo del necesario vale

A la auxiliar que se puso seis cifras no se le obliga a volver a cuatro, y a quien le quitan el rol
de DUE su PIN de seis le sigue valiendo. `pinPorRenovar` sólo mira hacia abajo. Obligar a acortarlo
sería pedirle a alguien que se baje la seguridad.

El techo sigue en ocho (residencia-3: «un centro puede alargarlo sin una migración»). **Consecuencia
dicha:** el teclado de la puerta ofrece cuatro y seis, así que un PIN de cinco, siete u ocho sólo se
teclea donde haya teclado completo. Es exactamente lo que ya pasaba antes de este bloque, cuando la
pantalla sólo enviaba a los cuatro dígitos.

### 9.3 · Las filas que ya existían se quedan en `pin_length = 4`

Es el `DEFAULT` de la migración, y **es la decisión**: esos PIN se pusieron cuando el único largo era
cuatro, así que a una DUE que ya tuviera PIN le queda «por renovar» y no entra hasta que dirección se
lo ponga de seis. Si alguno ya era de seis, se le vuelve a poner y se tarda un minuto.

El otro lado —asumir que estaban bien— es dejar entrar con cuatro cifras a quien lo ve todo, que es
lo que este bloque viene a cerrar. Y hoy no hay ningún centro en producción con la residencia
encendida: el piloto es lo que viene después de este bloque.

### 9.4 · El sembrador de Gredos pone los largos de verdad

Rosa (DUE), Pilar (dirección) y la Dra. Soto pasan a PIN de seis cifras: `918256`, `334455` y
`556677`. Ana y Mari siguen con los suyos de cuatro. Un sembrador que montara un centro con tres PIN
rechazados no serviría para enseñar nada. Los e2e de residencia-4 y -5 van con los mismos.

### 9.5 · El rastro de lo ilegible es `error` y no `warn`, y el `sitio` es el patrón de la ruta

Ver §2. Lo primero porque es un dato clínico que no se puede leer; lo segundo porque la URL lleva
ids de personas dentro y una línea de log no es sitio para eso.

### 9.6 · `--margen` de 60 minutos por defecto

Sale del peor caso realista: una evidencia de 4 MB subiendo por una wifi mala mientras la
transacción espera. Se puede subir por bandera. Bajarlo a 0 sólo tiene sentido en un test.

### 9.7 · Un arreglo fuera de alcance, declarado

`apps/api/test-e2e/residencia-5.e2e.ts` usaba `new Date().toISOString().slice(0, 10)` —el día de
UTC— donde la API usa la hora de pared del centro. Entre las 00:00 y las 02:00 de aquí ésos son dos
días distintos, y el test de las obligaciones se ponía rojo **sólo de madrugada**, que es cuando se
corrió este bloque. En la CI no se ve nunca porque corre en UTC. Es una línea de test, de otro
bloque, y se arregla aquí porque si no no se podía verificar nada a esa hora.

---

## 10 · Lo que NO cubre este bloque

Declarado en el prompt y respetado:

- **lo que sólo se puede comprobar en la residencia** (§19 A y B del done de residencia-5: el timbre
  del Android, la batería, el wifi por plantas, la tablet de sala, el turno observado) → va en
  `docs/residencia/visita-piloto.md`;
- **los puntos 16, 17, 19 y 21** del §19, que esperan a más centros o más datos;
- **`control_code`**, que D-69 deja en claro y deja de ser deuda.

Y lo que el prompt pedía respetar, comprobado:

- **un tenant sin residencia no nota nada**: ni una ruta nueva, ni un campo nuevo en lo que ya
  devolvían las suyas. `porArreglar` cuelga del panel de residencia, que ya era 404 para ellos;
- **el PIN del TPV no cambia**: `User.pinHash` sigue siendo otro PIN y sigue aceptando de 4 a 8
  cifras (`cashiers/routes.ts`), como desde v1.7. Lo que cambia es `care_pins`, que es otra tabla y
  otra credencial (residencia-3 §2);
- **`UserRole` no gana valores**;
- **nada de salud en logs**, tampoco en las líneas nuevas: el §2 entero es esa garantía, con su test;
- el **sistema visual** y la metodología de front de Mi Piace;
- **`.ficheros-clinicos/` sigue fuera del repo**: el sembrador de este bloque escribe ahí y `git
  status` queda limpio.

---

## 11 · Dudas abiertas

1. **Una auxiliar con zona «todo el centro» sigue con cuatro cifras** (§9.1). Ve lo mismo que la DUE
   y le cuesta cien veces menos sacarle el PIN. La forma de cerrarlo sin romper D-68 es que la
   dirección no reparta zonas de centro a quien no las necesita — que es configuración, no código— y
   la de cerrarlo del todo sería mirar el alcance efectivo y no el rol. **Se mira en el piloto, con
   las zonas de Gredos ya repartidas.**
2. **Nadie ha tecleado un PIN de seis en una tablet de pared.** Los dos segundos de D-05 son para
   cuatro cifras; seis son dos toques más para quien entra una vez por turno. Es poco, y no está
   medido con una DUE delante.
3. **Lo apuntado en la tablet no sabe de correcciones ajenas.** Si la DUE corrige desde su pantalla
   un registro que la auxiliar hizo sin red, la tablet sigue enseñando el suyo como vigente hasta que
   vuelva la red. Es lo prudente (lo suyo consta), pero la pantalla no puede decir «esto lo
   corrigieron».
4. **El barrido no sabe de los ficheros del TPV.** `device_screenshots` vive en otro directorio y no
   entra; si algún día se le añade un volumen a otra cosa, hay que acordarse de meterla en
   `CARPETA_DE_LA_CLASE`. El test de las seis clases falla si alguien añade una clase y no la cubre,
   pero no si alguien añade un almacén nuevo entero.
5. **El barrido es manual.** No hay tarea programada: se lanza a mano cuando haga falta. Con un solo
   centro es correcto; con quince, alguien tiene que acordarse. Ponerlo en el `shiftDayCut` o en un
   repeatable de BullMQ es media hora el día que haga falta.
6. **La ventana de dedupe es por proceso.** Con dos instancias de la API detrás de Caddy, la misma
   fila ilegible deja una línea por instancia y por cuarto de hora. Hoy hay una sola instancia.
7. **Un parte con incidencias abiertas de varios días repite la hora y no el día.** Dos incidencias
   abiertas de martes y miércoles a la misma hora salen como dos líneas idénticas. Se vio en las
   capturas; viene de residencia-5 y no se toca aquí.
8. **El banco de la agenda (`pnpm e2e:agenda`) lleva cuatro capítulos rojos desde antes de este
   bloque** (§13 «Verde»). Dos son una frase que cambió en v1.15 y no se actualizó en el spec, uno
   cae detrás de ésos y el cuarto es un locator ambiguo. Son veinte minutos de otro bloque, y
   mientras tanto el banco no sirve de semáforo.
9. **Los dos ficheros de fichaje del e2e fallan si la suite corre entre las 00:00 y las 02:00 de
   Madrid** (`f3-fichar`, `f8-colegio`). El caso ficha una entrada «hace cuatro horas» y la cierra
   «ahora»; a la 01:40 esos son dos días locales distintos, y `fichaje/routes.ts` contesta
   **409 `PENDING_EXIT_REQUIRES_REASON`** a propósito: *«Cerrar un tramo de ayer con el toque de hoy
   dejaría en el registro una jornada de veinte horas sin que nadie diga por qué»*. O sea, **el
   producto está bien y el test depende de la hora**. Es la misma trampa que §9.7 arregla en
   residencia-5, en otro bloque y en código que este bloque no toca. **Queda anotado, no arreglado.**

---

## 12 · Las capturas

En `docs/blocks/residencia-6-shots/`, contra la stack de verdad:

| Fichero | Qué enseña |
|---|---|
| `puerta-pin-4.png` | el teclado como estaba: cuatro casillas y el botón discreto debajo |
| `puerta-pin-6.png` | pulsado el botón: seis casillas, tres tecleadas, y «PIN de 4 cifras» para volver |
| `puerta-pin-6-390.png` | el mismo, a 390 px (el móvil de guardia usa esta pantalla) |
| `personal-pin-por-renovar.png` | el aviso ámbar de Mari Carmen, con el rol que la obliga |
| `panel-por-arreglar.png` | «Lo que hay que arreglar»: 1 PIN por renovar y 1 residente sin plan |
| `relevo-sin-plan.png` | el parte con la línea de «Sin plan de cuidados» en su zona |
| `puerta-apuntado.png` | la pantalla 6 tras registrar «como siempre» |
| `puerta-sin-red-en-la-tablet.png` | **la que prueba la costura entera**: la red caída, se vuelve a entrar con el PIN y lo propio sale hecho «· en la tablet», con la banda que dice lo que no se puede saber |

La última es la que cubre lo que los tests unitarios no pueden: el pegamento de `PuertaApp` entre el
almacén local y `queToca`.

---

## 13 · Cómo se cierra

### La migración · UNA, y aditiva

`20261020000000_residencia_6_pin_por_alcance`: una columna con `DEFAULT` y un CHECK. Ni un `DROP`,
ni un `DELETE`, ni un `UPDATE … SET` sobre datos. El único `ALTER TABLE` nombra `care_pins`.

El CHECK lleva su `IS NOT NULL` delante del `BETWEEN`, aunque la columna sea `NOT NULL`: es la forma
de la casa y lo que hace que siga siendo verdad si alguien la hace opcional (la lección de
`care_plan_items` en residencia-2).

**El `down`** va comentado en la cabecera y son dos líneas (quitar el CHECK y la columna). Se probó
de verdad, no sólo escrito: después de aplicarlo, `migrate diff` contra el schema devuelve
exactamente `ADD COLUMN "pin_length"` y nada más.

**Sobre una copia con datos de residencia-1 a -5.** Se copió `mipiacetpv_residencia5` (5 PIN, 108
registros de cuidado, 5 partes congelados, 3 residentes) y se le aplicó `migrate deploy`:

| quién | rol | `pin_length` | ¿por renovar? |
|---|---|---|---|
| Ana López | AUXILIAR | 4 | no |
| Mari Carmen | AUXILIAR | 4 | no |
| Rosa (DUE) | DUE | 4 | **sí** |
| Pilar | DIRECCION | 4 | **sí** |
| Dra. Soto | MEDICO | 4 | **sí** |

Exactamente lo diseñado: las dos auxiliares siguen entrando y las tres de alcance total quedan por
renovar. Recuentos de filas intactos.

### Deriva de Prisma · ninguna nueva

`migrate diff` (migraciones → schema) sobre base limpia da **489 líneas de residuo**, y son
**byte a byte las mismas** que da `origin/master`: `diff` entre los dos ficheros, vacío. Ni una
mención de `care_pins` en el residuo.

### Verde

- **Suite unitaria desde la raíz**: 425 ficheros, **6 168 tests** (10 saltados).
- **Typecheck de la CI**, paso a paso: API, los seis paquetes, `tsc -b` de tpv-web y de admin.
- **Builds de Vite**: admin y tpv-web.
- **e2e contra Postgres de verdad**, con el `.env` apartado y `REDIS_URL` a un puerto muerto (como la
  CI): **48 ficheros, 1 078 tests**. Los seis rojos son de `f3-fichar` y `f8-colegio` por la hora a
  la que se corrió (§11.8); los 46 ficheros restantes, verdes, incluidos los seis de residencia.
- **`pnpm e2e:agenda`** con base y puertos propios (`BANCO_API_PORT=3116`): **31 verdes y 4 rojos**,
  y los cuatro **ya estaban rojos en master**, en código que este bloque no toca:
  - el capítulo 8 (×2) espera el texto «Importe del servicio» en la hoja de cobro, y v1.15 le cambió
    el título a «Cobrar el servicio · 30,00 €» (`17c4e09`, que está en master). La captura del fallo
    enseña la hoja abierta y correcta;
  - el capítulo 9 cae detrás del 8: sin esos dos cobros, el arqueo no cuadra;
  - el capítulo 12 tiene un locator ambiguo («Uña encarnada» resuelve a dos botones).

  Se deja anotado y no se arregla: es el banco de la agenda y de la clínica, de otros bloques.

### Lo nuevo de este bloque

| Fichero | Qué es |
|---|---|
| `packages/residencia-plan/src/pin-por-alcance.ts` | la regla de D-68, pura |
| `packages/residencia-plan/test/pin-por-alcance.test.ts` | su tabla (21 casos) |
| `apps/api/src/clinica/aviso-de-ilegible.ts` | el cable, el enum de motivos y la ventana de dedupe |
| `apps/api/src/lib/sitio-de-lectura.ts` | el `AsyncLocalStorage` del «desde dónde se leía» |
| `apps/api/src/scripts/barrer-huerfanos.ts` | el barrido |
| `apps/api/test/residencia-6-ilegible.test.ts` | las 24 columnas (60 casos) |
| `apps/api/test/residencia-6-barrido.test.ts` | el barrido sin Postgres (9 casos) |
| `apps/api/test/residencia-6-migracion.test.ts` | el contrato del SQL (8 casos) |
| `apps/api/test-e2e/residencia-6.e2e.ts` | el bloque entero contra Postgres (26 casos) |
| `apps/tpv-web/test/puerta-recuerda-lo-suyo.test.ts` | el almacén de lo propio (7 casos) |
| `packages/db/prisma/migrations/20261020000000_…` | la columna |

### Cómo arrancarlo de cero

```bash
pnpm install --frozen-lockfile
pnpm --filter @mipiacetpv/db run generate
docker start mipiacetpv-postgres          # o `docker compose up -d` en una máquina limpia

# una base propia por sesión, y un Redis propio por worktree
createdb mipiacetpv_residencia6_banco
DATABASE_URL=…/mipiacetpv_residencia6_banco pnpm --filter @mipiacetpv/db run migrate:deploy

# apps/api/.env con esa base, su Redis y una CLINICAL_KEK nueva
cd apps/api && set -a && . ./.env && set +a && npx tsx src/scripts/sembrar-gredos.ts

pnpm --filter @mipiacetpv/api dev          # API
MIPIACETPV_API_PROXY=http://127.0.0.1:3016 npx vite --port 5291   # en apps/tpv-web
MIPIACETPV_API_PROXY=http://127.0.0.1:3016 npx vite --port 5292   # en apps/admin

# el barrido
pnpm --filter api barrer-huerfanos
```

El e2e:

```bash
E2E_DATABASE_URL=postgresql://…/mipiacetpv_residencia6_e2e \
REDIS_URL=redis://127.0.0.1:6399 \
pnpm --filter api run test:e2e          # con apps/api/.env apartado, como la CI
```

---

## 14 · Commits

```
fix(admin): el enlace de la declaración responsable mide 48 px, no 34
feat(clinica): lo que no se descifra deja rastro · se cablea configurarAvisoDeIlegible
feat(residencia): PIN de cuidado por alcance · 4 por zona, 6 quien lo ve todo (D-68)
feat(residencia): sin red, la puerta recuerda lo que ELLA apuntó
feat(residencia): el parte dice una vez «N residentes sin plan de cuidados»
feat(api): barrido de ficheros huérfanos del volumen clínico
test(residencia-6): el e2e del PIN por alcance, el parte sin plan, el rastro y el barrido
fix(residencia): lo que encontró el bucle visual · el botón pegado y el rótulo de lo suelto
test(residencia-6): la marca «en la tablet» se mira en la LÍNEA, no en la pantalla
docs(residencia): el done del bloque residencia-6 y el §19 de residencia-5 actualizado
```
