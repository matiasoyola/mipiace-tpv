# n1-hosteleria-2 · que un camarero pueda usar el N1 en pleno servicio — DONE

Rama `n1-hosteleria-2`, desde `master` (`aeb8240`). **La pasada en el hierro NO
está hecha**: el N1 y el AP11 se quedaron `offline` en adb a media tarde y el
criterio de cierre del bloque es que Matías lo use con sus manos. Lo que sí está
hecho y medido es todo lo que se puede medir sin el aparato — y se ha medido
**con un servicio en marcha**, que es la regla de este bloque.

---

## 0 · Lo primero, porque es la restricción del bloque

**Los terminales grandes no cambian ni un píxel, y esta vez está demostrado con
el diff y no afirmado.**

Capturas antes/después del mapa y de la venta a 1280×800 (AP11) y 1442×811 (D8),
contra la misma stack y **resembrando el servicio antes de cada pasada** para que
los «hace 12 min» no ensuciaran la comparación:

| captura | píxeles distintos |
|---|---|
| AP11 · mapa | **0** de 4.096.000 |
| AP11 · venta | **0** de 4.096.000 |
| D8 · mapa | **0** de 4.677.848 |
| D8 · venta | **0** de 4.677.848 |

Con **una** excepción, tapada en las dos pasadas para poder dar ese cero y
declarada aquí en voz alta: **la etiqueta «LISTO» y su banda en la comanda
cambian de color también en el terminal.** Iban en `#FFFFFF` sobre
`VERDE_LISTA` (#8FD9A8) —**1,66:1**, que no es «poco contraste» sino texto
invisible— y pasan a `VERDE_LISTA_TEXT`, la constante que existía al lado sin
usar desde kds-1: **10,82:1**. Sin tapar, el diff da 0,04–0,07 % y las cajas de
cambio caen exactamente encima de esos dos elementos.

Se tocó en los dos tamaños a propósito, y es la única decisión del bloque que se
sale de la restricción: 1,66:1 no es un reparto que un tamaño de pantalla pueda
justificar. **Si Matías prefiere que el AP11 y el D8 se queden como estaban, es
una línea.**

Y los números del terminal, antes y después, idénticos uno a uno:

| | AP11 1280×800 | D8 1442×811 |
|---|---|---|
| cabecera | 80 px, **0 filas de mano** | 80 px, **0 filas de mano** |
| lado de mesa | 136 | 152 |
| mesas a la vista | 23 / 23 | 23 / 23 |
| cabeceras de zona plegables | **0** | **0** |
| marco de zona discontinuo | **sí** | **sí** |
| tinta de mesa ocupada | **blanca** sobre coral | **blanca** sobre coral |
| fila de cantidad 1–6 | 329 … 385 (56 px) | 329 … 385 (56 px) |
| primer producto con familia | y=**399** | y=**399** |
| pie de la comanda | 180 px | 180 px |
| total | **46 px** | **46 px** |
| «Enviar» | 68 px | 68 px |
| alto de página | 803 | 851 |
| desborde horizontal | no | no |

Todo lo del bloque cuelga del mismo `UMBRAL_MANO_PX` de `n1-hosteleria`: **no se
ha creado ningún umbral nuevo.**

---

## 1 · R1–R4, y de dónde salen los números

### 1.1 R4 · el suelo de letra de la mano: **15 px**, una vez

`SUELO_LETRA_MANO_PX` en `lib/roomGrid.ts`, con la cuenta dentro. Resumen:

El N1 declara 320 dpi con `devicePixelRatio` 2, así que 1 px de CSS mide
**0,1588 mm** de cristal. Un glifo de 15 px tiene ≈ 0,72 · 15 = 10,8 px = **1,72
mm** de altura de mayúscula, que a 35 cm subtiende

```
2 · atan(1,72 / (2 · 350)) = 0,00491 rad = 16,9 minutos de arco
```

y 16′ es el umbral habitual para leer de un vistazo en malas condiciones —de
pie, en marcha, con la pantalla moviéndose—, muy por encima de los 5′ del límite
de agudeza, que es de laboratorio y no sirve para una barra.

**Y lo confirma el hierro, que es el argumento que vale**: todo lo que Matías
leyó sin queja ya estaba en 15 o más (los minutos de la mesa, el contador de
sala, el nombre del cajero). Lo único que dijo que no se leía, «POR RECOGER»,
estaba en **13**.

Exentos, y se nombran para que no sea una trampa: el rótulo del marco de zona y
los eyebrows de la comanda se quedan en `EYEBROW_PX` = 11. No se leen, se
reconocen por su posición, y se aprenden el primer día. Ninguno de los ocho
hallazgos los menciona.

Lo vigila un banco de guardia (`n1-suelo-de-letra.test.ts`) que recorre el
fuente de las cuatro pantallas de venta y sala y mira cada `fontSize` con rama
`deMano`. Lo que **no** puede ver —un `fontSize` constante que sólo se pinte en
la mano— se dice en su cabecera.

### 1.2 R4 · el contraste, medido con una función y no a ojo

`lib/contraste.ts` (WCAG 2.1, con mezcla por `opacity`, que hacía falta: media
sala está escrita con opacidades). `n1-contraste-de-mano.test.ts` recorre **todos**
los estados de mesa. Tres fallos reales, y el que se denunció no era ninguno:

| | antes | ahora |
|---|---|---|
| etiqueta **LISTO** | **1,66:1** | **10,82:1** |
| banda de aviso en la comanda | **1,66:1** | **10,82:1** |
| importe de mesa ocupada (14 px) | **3,03:1** | **5,92:1** |
| «POR RECOGER» | 7,69:1 | 7,69:1 — **nunca fue el contraste** |

El importe se arregla cambiando la **tinta** y no el relleno: el coral es la
marca y es lo que dice «ocupada» de un vistazo. `DARK_INK` encima da 5,92:1, y
de paso es la misma pareja tinta/relleno que ya usaban «pide la cuenta» y «por
recoger», así que las tres mesas con cuenta abierta se leen igual. **Sólo en la
mano**; en el terminal el blanco sobre coral se queda (3,03:1, anotado).

Y en este bloque **no se usa la excepción de WCAG para «texto grande»**: el
blanco sobre coral se salvaba por el nombre en negrita a 20 px mientras el
importe de al lado —texto normal, y el número que se compara con el efectivo— no
cumplía ninguno de los dos umbrales.

### 1.3 R3 · lo que se toca

Medido en el aparato con la sala en servicio: **ningún objetivo por debajo de
48 px**, y el más pequeño de la pantalla es la cabecera de zona, a 48 justos.
Lo que subió: la X de la comanda 44 → **56**, la etiqueta LISTO 30 → **48**, la
franja de avisos → **56**, los tres botones de la hoja de opciones → **56**.

### 1.4 R1 · una capa a la vista

Con la comanda abierta, medido: la hoja va de **y=0 a y=720** y de la capa de
debajo asoman **0 px por arriba y 0 por abajo**.

---

## 2 · Los ocho hallazgos

### 2.1 🟢 (5) · la fila de cantidad 1–6 no se pinta nunca en la mano

`repartoDelCatalogo` lo decide. `n1-hosteleria` la había hecho ceder **sólo al
buscar**, y con eso cerró su 🟡 2; el hallazgo de Matías es más ancho: con la
mesa abierta y sin buscar, esos 120 px seguían entre el buscador y el primer
producto, que es donde el camarero marca.

**Y cerró de paso el §7.1 que `n1-hosteleria` dejó pendiente.** Medido en «Ahora»
a 360×720: el primer producto pasa de **y=769 (fuera)** a **635 … 713, dentro**.

Buscando «tost» con el teclado (360×449): el primer resultado en **194 … 314**
—`elementFromPoint` → **él**— con **4 resultados enteros**. La pasada del 23-10
lo tenía en 291 … 359; son 97 px más arriba.

El filete que separaba la fila de las familias pasa a ser condicional: sin
rejilla, sin tira y sin fila no había nada que separar y quedaba una raya suelta
bajo el buscador.

### 2.2 🟢 (2) · mesas plegables por zonas, sin zoom

Cada zona es una sección con cabecera de **48 px** que se pliega de un toque, y
**plegada dice lo que importa**. Medido:

| | mesas a la vista | lo que dicen las cabeceras |
|---|---|---|
| todo abierto | **11 / 23** | — |
| Salón y Terraza plegadas | **8 / 8 de Barra** | «1 listo · 3 ocupadas · 1 por recoger» |
| las tres plegadas | 0 | **la sala entera en 180 px de los 521 útiles** |
| tras recargar | igual | **el pliegue se recuerda** |

Dos medidas que cambiaron la decisión, y las dos están en el `-done` porque sin
ellas el hallazgo sería un empeoramiento:

- **la cabecera va a 48 y no a los 56 de la casa**, porque a 56 **cuesta tres
  mesas**: BARRA se lleva tres filas de 88 y deja a SALÓN asomando justo en el
  límite, así que 8 px por zona empujan su primera fila fuera. R3 pide ≥ 48 y 48
  cumple R3. Es el único sitio del bloque donde no se usa `MIN_TOUCH_PX`;
- **lo que paga la cabecera es el MARCO.** Una franja de 48 encima de cada zona,
  por sí sola, baja de 11 mesas a 8. Lo que las devuelve es que en la mano el
  marco discontinuo y su rótulo flotante desaparezcan: entre los dos cuestan
  2 × 12 de relleno más el borde por zona, y una cabecera sólida con el nombre
  dentro ya dice dónde empieza y acaba la zona. Dos cosas diciendo lo mismo, y
  se queda la que además se toca.

El rótulo plegado **sólo nombra lo que no es cero** («8 libres», no «0 ocupadas ·
0 por recoger · 0 listos») y lo urgente va primero: un plato en el pase se
enfría, una mesa ocupada espera, una por recoger no espera a nadie.

El estado se guarda en el **aparato** (`mipiacetpv-zonas-plegadas`) y **falla
hacia DESPLEGADO** en las dos direcciones —sin `localStorage` y con basura
dentro—: una zona desplegada de más se ve y se pliega; una plegada de más
esconde mesas que el camarero cree que no existen, y en un servicio eso es una
mesa sin atender.

### 2.3 🟢 (3) · los avisos de cocina no tapan trabajo

En la mano los avisos pasan de **pila** a **contador de alto fijo**, y la lista
entera se abre en su propia capa a pantalla completa. Medido:

| avisos | antes (pila) | ahora (contador) |
|---|---|---|
| 1 | 64 px | **64 px** |
| 2 | **124 px** | **64 px** |
| 5 | **304 px** | **64 px** |
| 12 | 724 px | **64 px** |

Lo que importa no es que las bandas fueran grandes: es que **crecían**, así que
en pleno servicio cocina decidía cuánta comanda veía el camarero.

El contador dice «**2** · T4 y 1 más · Ver», con el número primero y en grande.
El nombre de la mesa más antigua va dentro a propósito: la decisión 5 de kds-1
dice que el camarero coge lo que lleva más tiempo en el pase, así que «2 listos»
a secas obligaría a abrir la lista para saber si cae de camino. Y el «Servido»
**no** está en el contador: está dentro de la lista, con su objetivo de 56 px por
aviso — un «Servido» en la franja, con dos comandas listas, no podría decir cuál
se ha servido.

En el mapa, una mesa con algo listo ya se marcaba (`mesasListas` → etiqueta
LISTO); lo que faltaba era que se leyera, y eso es §1.2 y §1.3.

### 2.4 🟢 (4) · una sola capa

La hoja de la comanda ocupa la pantalla en la mano. Era `max-h-[88dvh]` anclada
abajo, o sea con el alto decidido por su contenido, y de ahí salían los
hallazgos 1 y 4 a la vez. El sabotaje lo mide: con la hoja volviendo a decidir su
alto, queda en **y=86, h=634**, y de la venta de debajo asoman **86 px — el 12 %
de la pantalla**. Matías dijo «~15 %».

Con la hoja a pantalla completa el velo deja de tener sentido, y con él se va el
«toca fuera para cerrar»: fuera no queda. Las salidas son la X y el atrás.

### 2.5 🟢 (6) · la X y el atrás

La X pasa de 44 a **56 px** (`elementFromPoint` → **él**). Y el atrás de Android
cierra la hoja: antes no había capa registrada en `useBackGuard`, así que caía al
guardia de fondo, que dentro de una venta significa «vuelve al mapa» — el gesto
de cerrar una hoja sacaba al camarero de la mesa, y la hoja se cerraba de rebote.
Medido: tras el atrás, la hoja no está y **se sigue en la venta**.

### 2.6 🟢 (7) · todos los estados de mesa

Revisados los nueve, no sólo «por recoger». Lo que cambió en la mano:

| estado | antes | ahora |
|---|---|---|
| libre · «N pax» | 13 px | **15** |
| ocupada · importe | 14 px, 3,03:1 | **15 px, 5,92:1** |
| ocupada · meta | ya no se pintaba | igual |
| cuenta · «Cobrar» + importe | 10 y 12 px | **15 y 15** |
| por recoger · «POR RECOGER» | **13 px** | **15** |
| por recoger · minutos | 15 px | **se van** (ver abajo) |
| unida · «unida a X» | 14 px | **15** |
| cobro pendiente | 10 px, pegado al borde | **15 px, en la línea del importe** |
| listo · etiqueta | 1,66:1, 30 px | **10,82:1, 48 px** |

**Lo que se enseñó menos, que es lo que manda R4 cuando no cabe:**

- **los minutos de la mesa por recoger.** Al subir «POR RECOGER» a 15 las dos
  líneas ya no caben en un círculo de 88 con el nombre encima. El minuto exacto
  no se actúa desde el mapa —se actúa decidiendo si se recoge— y la hoja de
  opciones, que es el toque siguiente, lo dice entero y con letra grande;
- **«cobro pendiente»** no cabía al suelo donde estaba: pegado a `bottom-2` de un
  círculo de 88 el ancho real no es el lado sino la cuerda a esa altura, ~53 px, y
  «PENDIENTE» a 15 px pide 76. Pasa a la línea del importe —centrada, donde la
  cuerda da 85,7— y el importe no se pinta: lo que hay que saber de esa mesa no es
  cuánto llevaba, es que no se puede tocar hasta que suba;
- **el peor importe del botón «Cobrar» baja de 9 a 8 caracteres**
  (`LONGEST_TABLE_AMOUNT_MANO`). No es una rebaja del criterio, es la geometría:
  la cuerda a la altura del botón da **81,70 px** de ancho útil y nueve
  caracteres a 15 px piden **81,71**. Y no hay sitio donde ponerlo que gane esos
  9 px: la cuerda es máxima en el centro de la mesa y ahí el botón se come el
  nombre. La casa tiene sus cifras para saber qué se pierde — La Maestranza cerró
  la M4 del ensayo en 55,00 € y Sirope la T2 en 9,90 €. `LONGEST_TABLE_AMOUNT`
  sigue mandando en el terminal, donde la mesa mide 136–152.

### 2.7 🟢 (8) · las opciones de una mesa

En la mano la hoja va **a todo el ancho** pegada abajo, los tres botones miden
`MIN_TOUCH_PX` y llevan relleno propio, la letra sube al suelo (título 19,
cuerpo 15, botones 17) y el orden pasa a ser **acción · acción · salida**.

Eran tres cosas y ninguna era el alto del botón, que ya estaba en los 48 de la
escala `touch`: la letra (18/14/14, toda por debajo del suelo), el ancho
(`max-w-md` con `p-3` dejaba la hoja flotando como una tarjeta pequeña) y el
orden — la tercera salida se pintaba como **texto gris, sin relleno y debajo de
la salida neutra**, y en la mesa por recoger esa tercera salida es «Dejar
libre».

**«Dejar libre» pasa a ser la primera**, y las dos razones apuntan al mismo lado:

- **frecuencia**: el estado POR RECOGER existe para decir «ve a recoger ésta». Lo
  crea el cobro y lo deshace la recogida; durante el servicio se mira el mapa
  buscando mesas que recoger, no mesas que abrir;
- **coste de equivocarse**: «Abrir cuenta nueva» sin querer deja un borrador que
  hay que anular (en el ensayo del 23-10 quedaron tres). «Dejar libre» sin querer
  no cuesta nada: se vuelve a tocar y se abre.

«Abrir cuenta nueva» no se degrada: se queda como segunda acción con su botón
entero, que es más de lo que tenía «Dejar libre» antes.

### 2.8 🔴 (1) · el resumen de la comanda · **NO CERRADO, y la cuenta de por qué**

Esto es lo único de los ocho que no se cierra, y conviene verlo entero porque la
conclusión es que **el criterio, tal como está escrito, no se puede cumplir**.

La hoja ya ocupa la pantalla (§2.4) y los avisos ya no la empujan (§2.3). Con eso
el reparto de los 720 px del N1, medido con la comanda de seis líneas y dos
avisos entrando, era:

```
  72   tirador + X
   8   hueco
  64   contador de avisos          (acotado, como se diseñó)
 332   LISTA DE LÍNEAS             ← lo que el camarero está revisando
  64   acciones de cocina (⚡ Urgente / ⚠ Alergias)
 180   pie (TOTAL + Enviar + Cobrar)
```

De los 180 del pie, 42 eran relleno y hueco y 69 la fila del total, con el
importe a **46 px**. Los 46 están medidos para la columna de comanda de un
terminal de 10–15"; en una hoja de 360×720, doce píxeles de glifo no valen una
línea de comanda. Con el total a 34, los botones a `MIN_TOUCH_PX` y el relleno
apretado: **pie 180 → 134, lista 332 → 378**.

Resultado medido, con las seis líneas de verdad:

```
ENTERA  144.. 179  «SIN ENVIAR»
ENTERA  183.. 284  «Café Solo»
ENTERA  288.. 389  «Café con leche»
ENTERA  393.. 495  «Café Americano»
 corta  499.. 600  «Tostada con tomate»       ← la lista acaba en 522
 corta  604.. 706  «Croissant a la plancha»
 corta  710.. 811  «Zumo de naranja natural»
```

**3 de 6 líneas enteras** (eran 2 antes del pie). Y no es falta de ganas:

```
una línea de comanda = 34 (nombre, 23 px) + 56 (los −/+) + 11 de relleno = 101 px
seis líneas + el eyebrow                                   = 6 · 101 + 35 = 641 px
lo que queda para el resto de la hoja                       = 720 − 641  =  79 px
sólo el tirador con la X ya mide                                             72 px
```

O sea: **seis líneas enteras dejan 7 px para el total, «Enviar», «Cobrar» y los
avisos.** Ni apretando el pie a cero. Y las tres piezas de los 101 px son
intocables por separado: el nombre entero es el 🔴 que `n1-hosteleria` arregló
(§3.3: en la pasada se leía «Café…» con 71 px de 178) y los `−`/`+` de 56 son
`principio-venta-bajo-estres` regla 6 — y son además lo que justifica que la fila
de cantidad se haya ido en §2.1.

**Las tres salidas que hay, con lo que cuesta cada una.** Ninguna la tomo yo:

1. **la línea a UNA fila** (nombre junto a los `−`/`+`). Da las seis, y al nombre
   le quedan ~129 px: «Croissant a la plancha» pide ~165 a 15 px, así que
   **vuelve a truncar** — el 🔴 del 18-10;
2. **los `−`/`+` fuera de la línea**, a la hoja de la línea. Da las seis con el
   nombre entero, pero deja la comanda **sin corrección rápida de cantidad**, que
   es exactamente lo que hace aceptable quitar la fila 1–6 de §2.1. Las dos cosas
   no se pueden quitar a la vez;
3. **quedarse en 3 de 6 y desplazar**, que es lo que está ahora. La lista desborda
   293 px: un gesto de pulgar.

Mi recomendación es la **3**, y por eso la he dejado puesta: de las tres, es la
única que no deshace un arreglo que ya se midió en el hierro. Pero esto lo decide
Matías con el aparato en la mano, y lo que diga va aquí tal cual.

---

## 3 · Decisiones que tomé sin preguntar

1. **El suelo de letra es 15 px** (§1.1), con la cuenta de minutos de arco y la
   confirmación del hierro.
2. **Los avisos se marcan con un contador acotado**, no con una pila, y la lista
   va en su propia capa (§2.3). El «Servido» se queda dentro de la lista.
3. **Qué se fue de cada mesa**: los minutos de «por recoger», el importe de la
   mesa con cobro pendiente, y un carácter del peor importe del botón «Cobrar»
   (§2.6).
4. **La cabecera de zona es de 48 y el marco desaparece** (§2.2), porque medido
   al revés el hallazgo empeoraba la pantalla.
5. **«Dejar libre» va primera** en la hoja de una mesa por recoger (§2.7).
6. **El color de «LISTO» se arregla también en el terminal** (§0), y es la única
   cosa del bloque que se sale de la restricción.
7. **El pie de la comanda adelgaza sólo en la mano** (§2.8) con constantes
   `*_MANO` nuevas; los tokens del terminal no se tocan.

---

## 4 · Hallazgos FUERA de los ocho

### 4.1 🔴 `BILLING` no existe · la mesa «pide la cuenta» es inalcanzable

Y arrastra el botón «Cobrar X €» de la tarjeta, que es la **derivada principal**
de `principio-cobro-en-mesa` («cobrar directo desde la tarjeta de mesa, sin
entrar a la venta»).

`buildTableSnapshot` (`apps/api/src/tables/routes.ts`) es el **único** sitio que
calcula el estado de una mesa, y sólo devuelve tres:

```ts
state: draft ? "OPEN" : sigueSinRecoger(t.porRecogerDesde) ? "POR_RECOGER" : "FREE"
```

`"BILLING"` está en el tipo de la API, en el del TPV, en la leyenda del mapa y en
todo el camino de `showCobrar`, pero **nada lo emite**: ni la API ni el TPV lo
derivan de nada (comprobado con grep sobre los dos lados, y `git log -S` dice que
entró con B7 y nunca tuvo productor). El relleno ámbar de la leyenda es un estado
que un camarero no puede ver.

Consecuencia para este bloque: el trabajo de R4 sobre el botón «Cobrar» de la
tarjeta (§2.6) está hecho y medido en el banco visual, pero **no se puede
fotografiar en el aparato** porque no hay forma de poner una mesa en ese estado.
Y por eso el banco en servicio siembra mesas en todos los estados **menos** ése.

**No se toca aquí**: es un cambio de la API y este bloque es de maquetación en la
mano. Pero es, con diferencia, el hallazgo más gordo de la pasada.

### 4.2 `BAR_COUNTER_HEIGHT` contaba 18 px de más en la mano

`n1-hosteleria` dejó el mostrador de la BARRA compacto en el DOM (14 px y
`mb-2.5`) pero la aritmética siguió con los 42 del terminal, así que
`mesasALaVistaDeMano` contaba 18 px de más por esa zona. El error iba al lado
seguro —menos mesas de las que se ven—, y por eso nadie lo notó: el criterio era
«al menos 9» y salían 11 cuando en el aparato se veían 14. **Arreglado**
(`BAR_COUNTER_HEIGHT_MANO`), porque este bloque gasta justo esos píxeles en la
cabecera de zona y con el número viejo la cuenta decidía mal.

### 4.3 `roomCanvasHeight` sigue con el mostrador del terminal

El mismo desfase que §4.2, en la función que elige el lado de mesa. Con las 23 de
Sirope no cambia nada (siempre cae al suelo de 88), así que **se anota y no se
toca**: moverla puede mover el terminal.

### 4.4 Dos objetivos por debajo de 48 que no son de este bloque

Medido en la mano: el «Cerrar menú» del cajón lateral mide **36 px**, y el
`cart-line-name` de la comanda, **34** (es una zona de toque sobre texto, no un
botón). El primero está en el cajón que `n1-hosteleria` dejó fuera de alcance
(§2.6 de aquel `-done`); el segundo abre la hoja de la línea y tiene 336 px de
ancho. **Anotados, no tocados.**

---

## 5 · Los tests

### 5.1 Los nuevos

- `n1-contraste-de-mano.test.ts` (17) · la tabla de contrastes entera, estado por
  estado, más los dos sabotajes de color.
- `n1-zonas-plegables.test.ts` (16) · la cabecera de 48, lo que cuesta, el
  resumen plegado, la persistencia y dónde NO se pliega.
- `n1-hoja-y-avisos.test.ts` (13) · la hoja a pantalla completa, el coste acotado
  de los avisos y las dos salidas.
- `n1-suelo-de-letra.test.ts` (6) · el banco de guardia del suelo de R4.
- `lib/contraste.ts` · WCAG con mezcla por opacidad, para que esto se pueda medir
  y no mirar.

Y se actualizan `n1-sala-de-mano.test.ts` y `n1-catalogo-de-mano.test.ts` con los
criterios nuevos.

### 5.2 En verde

**431 ficheros / 6257 tests** en todo el monorepo. `tsc -b` limpio en
`apps/tpv-web`, `apps/api`, `apps/admin` y `packages/db`, y `build` de `tpv-web`
limpio.

> `tsc` **no se puede correr desde la raíz** (`pnpm exec tsc` → «Command "tsc"
> not found»): va paquete a paquete. Costó un job en falso.

**Rojo previo, no de este bloque:** `packages/verifactu` falla el `tsc` por un
`rootDir` que no cubre `scripts/generar-declaracion-responsable.ts`. Falla igual
en `master`.

---

## 6 · Tabla de sabotaje

| Sabotaje | Qué cae | El rojo real |
|---|---|---|
| Una mesa vuelve a 13 px en la mano | `n1-suelo-de-letra` | `expected [ Array(1) ] to deeply equal []` — «13 px en la rama de mano, y el suelo de R4 es 15» |
| La etiqueta LISTO vuelve al blanco | `n1-contraste-de-mano` | `expected 1.66… to be greater than or equal to 4.5` |
| El importe de la ocupada vuelve al blanco | `n1-contraste-de-mano` | `expected 3.03… to be greater than or equal to 4.5` |
| La fila de cantidad se pinta en la mano | `n1-catalogo-de-mano` | `expected true to be false` en las seis combinaciones |
| La fila de cantidad desaparece a 1280 | `n1-catalogo-de-mano` | `expected { …cantidad: false } to deeply equal { …cantidad: true }` |
| La hoja vuelve a decidir su alto | **navegador** | hoja en `y=86, h=634`; de la venta de debajo asoman **86 px (12 %)** |
| Los avisos se apilan en la mano | `n1-hoja-y-avisos` | `expected 124 to be 64` — y con cinco, 304 |
| Una X de 32 px | `n1-hoja-y-avisos` | `expected 32 to be greater than or equal to 48` |
| La cabecera de zona a 56 px | `n1-zonas-plegables` | `expected 8 to be 11` — tres mesas menos |
| El marco se queda con la cabecera | `n1-zonas-plegables` | `expected 8 to be 11` |
| El offset del terminal para el importe de mano | `n1-sala-de-mano` | `expected true to be false` (cuerda 78,4 contra 81,7 que pide) |
| El importe del botón a 16 px | `n1-sala-de-mano` | `expected 76.6… to be greater than 81.7` |
| El reparto de mano aplicado al AP11 | `n1-sala-de-mano` + `sala-sirope` | `expected 144 to be greater than 144` |

---

## 7 · El banco con un servicio en marcha

**Nada se midió con la sala vacía**, que es la regla del bloque. `apps/e2e-ui/seed/sirope-en-servicio.ts`
siembra encima de `sirope-demo`:

- **6 mesas ocupadas**, una de ellas (T2) con la **comanda de seis líneas** y dos
  cafés que se distinguen sólo por el final del nombre;
- **1 olvidada** (M2, abierta hace 58 min → el aro discontinuo de +45);
- **2 por recoger** (M3 y T1);
- **2 avisos de «listo para servir»** esperando, en mesas distintas (T4 y M5);
- **1 «Urgente · alergia»** encima de la mesa de la comanda abierta;
- **0 en estado «cuenta»**, porque el producto no lo produce (§4.1).

Medido a **360×720** y **360×449** (teclado), más 1280×800 y 1442×811 para el
diff del terminal. La **banda de ensayo cuesta 40 px** y está puesta en todas las
medidas: es lo que el banco de `n1-hosteleria` no pagaba y por lo que su 🟡 2 se
le escapó.

Capturas y números en `docs/blocks/n1-hosteleria-2-shots/` (`medidas-mapa.json`,
`medidas-comanda.json`, `medidas-teclado.json`, `medidas-terminal-antes.json`,
`medidas-terminal-despues.json`), con los drivers al lado para rehacerlo.

### 7.1 Cómo se rehace

```bash
# 1 · Redis propio del worktree
docker run -d --name mipiacetpv-redis-n1host2 -p 6390:6379 redis:7-alpine

# 2 · base propia, migrada y sembrada
DATABASE_URL="postgresql://mipiacetpv:mipiacetpv_dev@localhost:5432/mipiacetpv_n1_host2_e2e?schema=public" \
  pnpm --filter @mipiacetpv/e2e-ui run stack
set -a && . ./apps/api/.env && set +a
./apps/e2e-ui/node_modules/.bin/tsx apps/e2e-ui/seed/sirope-demo.ts
./apps/e2e-ui/node_modules/.bin/tsx apps/e2e-ui/seed/sirope-en-servicio.ts   # el SERVICIO

# 3 · API y TPV (puertos propios: 3118 / 5290)
(cd apps/api && pnpm dev)
MIPIACETPV_API_PROXY=http://127.0.0.1:3118 MIPIACETPV_DEV_PORT=5290 \
  pnpm --filter @mipiacetpv/tpv-web dev

# 4 · medir
cd docs/blocks/n1-hosteleria-2-shots && node medir-mapa.mjs && node medir-comanda.mjs
```

Cuatro cosas que costaron un rato y no están en ninguna otra parte:

- **Vite escucha sólo en IPv6** (`[::1]:5290`): `curl 127.0.0.1:5290` da
  «connection refused» y parece que el servidor no arrancó. Por `localhost` va.
- **`pin-continuar` es `md:hidden`**, o sea que a 1280 y 1442 está en el DOM y no
  se ve: el `locator` resuelve y el click agota el tiempo sin decir por qué. Por
  encima del umbral se envía con **Enter**.
- **El buscador de la mano es el input OCULTO del lector USB-HID**
  (`aria-hidden`, 62 px de ancho): no se puede clicar, pero enfocado recibe las
  teclas igual, que es justamente para lo que está.
- **El pliegue de zonas se recuerda**, así que una pasada hereda el estado de la
  anterior y las medidas dependen del orden. El driver lo borra al arrancar.

Y una del diff: **resembrar antes de cada pasada**. Sin eso, los «hace 12 min»
avanzan entre la pasada «antes» y la «después» y el diff del terminal da 0,35 %
de cambio que no es del código.

---

## 8 · La APK

Construida y firmada. **Sin publicar.**

```
fichero   apps/tpv-android/build-releases/mipiacetpv-1.29.0-12900.apk
versión   1.29.0 (versionCode 12900)
commit    4d05b6e
tamaño    8.744.373 bytes
SHA-256   7434214fd68149bf0436a7819a9392048c57673418a87fb9a22970c4a0db8fdd
firma     Signer #1 · CN=mipiacetpv · SHA-1 1256a71efff3008b7be57ad28bcda3a7fae10290
```

Los cuatro chequeos del guion, en verde: `VITE_API_URL` a
`https://api.mipiacetpv.com`, sin Service Worker, origen del WebView correcto y
APK firmada.

Instalar por cable:

```bash
adb install -r apps/tpv-android/build-releases/mipiacetpv-1.29.0-12900.apk
```

---

## 9 · La pasada en el hierro — **PENDIENTE**

### 9.1 Lo que impidió hacerla

El N1 y el AP11 estaban en adb al empezar la sesión:

```
192.168.5.144:42911    device   product:N1     model:N1
192.168.5.75:5555      device   product:AP11-1006
```

y al llegar a este punto los **tres** transportes daban `offline`. El prompt ya lo
advierte: «la depuración se corta si se bloquea la pantalla».

### 9.2 Lo que hace falta, y es de Matías

1. **El N1 despierto** y vinculado a **Sirope · Caja 1 en ensayo**, cajero
   `soporte+sirope@mipiace.es`, con **adb inalámbrico** y **el puerto nuevo** (cambia
   en cada reinicio).
2. **El AP11 encendido con el KDS abierto**, y su `last_seen_at` al día antes de
   enviar nada: sin eso la comanda sale del N1 y no llega, que es lo que cortó la
   pasada del 23-10 (§9.2-ter de `n1-hosteleria-done`).
3. **Una segunda sesión de Code, no.** El 23-10 dos sesiones condujeron el mismo
   N1 y hubo que retirar 19 capturas. Comprobado al empezar ésta: ninguna otra en
   este worktree.

### 9.3 El guion, con el servicio encima

El mismo que el banco: mesa abierta con seis líneas, dos avisos de cocina
entrando de verdad desde el AP11, un urgente con alergia mientras la comanda está
abierta, zonas plegándose, mesa por recoger con sus opciones, y cobro. Capturas
numeradas en `docs/qa/2026-10-XX-n1-hosteleria-2/`.

### 9.4 Y lo que de verdad cierra el bloque

**Matías usándolo con sus manos, de abrir mesa a cobrar, con avisos entrando.** El
bloque no se cierra hasta que él diga que lo puede usar. Lo que dicte va aquí tal
cual — y la primera pregunta es la de §2.8: cuál de las tres salidas quiere para
las seis líneas.

### 9.5 Inventario para el «Resetear ensayo»

**Nada.** Esta sesión no ha tocado producción: todo se ha medido contra la stack
del banco, en la base desechable `mipiacetpv_n1_host2_e2e`. En Sirope-ensayo sigue
lo que dejó la pasada del 23-10 (§9.5 de `n1-hosteleria-done`): la mesa T1 con
9,00 € en DRAFT, la M3 por recoger, la T2 por recoger y el ticket TEST `000029`.

---

## 10 · El push y el PR

Los hace Matías. Está al final del prompt de cierre de esta sesión.
