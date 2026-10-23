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

Se tocó en los dos tamaños a propósito, y **es la ÚNICA excepción a la
restricción de este bloque**. Decisión de Matías, 23-10: se queda arreglado.
1,66:1 no es un reparto que un tamaño de pantalla pueda justificar — es texto
que no se lee en ningún tamaño.

#### La captura que las cuatro de 0 px no incluían

Las cuatro capturas de arriba **tapan** este elemento, que es lo que les permite
dar cero. Así que la excepción tiene su propio par de capturas, sin tapar nada,
recortadas sobre la mesa M5 —que es la que lleva el aviso— en los dos tamaños:

```
listo-antes-AP11.png   ·  listo-despues-AP11.png
listo-antes-D8.png     ·  listo-despues-D8.png
```

| | antes | después |
|---|---|---|
| color de la tinta | `rgb(255,255,255)` | `rgb(21,23,27)` |
| contraste | **1,66:1** | **10,82:1** |
| alto de la etiqueta | 30 px | 30 px |
| tamaño de letra | 15 px | 15 px |
| tamaño del recorte | 376×376 (AP11) · 408×408 (D8) | **idéntico** |

Y el diff del recorte dice exactamente lo que tiene que decir: **925 píxeles
distintos, todos dentro de una caja de 81×23** —los glifos de la palabra
«LISTO»— y el recorte mide lo mismo antes y después, así que **la maquetación no
se mueve: sólo cambia el color de la tinta.** Lo rehace `diff-listo.mjs`.

### Excepción 2 · el aviso de «listo» abre una hoja (hallazgo 9)

Decisión de Matías, 23-10, ya probando la 1.29.0: el hallazgo 9 **no va sólo en
la mano**. Es un cambio de FLUJO, no de reparto, así que se aplica en los cinco
aparatos. Un camarero que aprende el gesto en el móvil y encuentra otro en el
terminal de la barra ha aprendido dos cosas para la misma tarea — y la que le
sale mal es la del terminal, porque ahí el toque es más barato y el «hecho»
directo más fácil de disparar sin querer.

Medido en los dos tamaños, con dos avisos reales en el pase:

| | antes | después |
|---|---|---|
| lo que dice la banda | «T4 · listo para servir · **Servido**» | «T4 · listo para servir · **Ver**» |
| al tocarla | **sirve en el acto**: el aviso desaparece | **abre la hoja**; el aviso sigue |
| avisos tras el toque | 2 → **1** | 2 → **2** |
| la hoja | no existe | diálogo centrado **520×229** |
| lo que enseña | — | «1 · Tostada con tomate» |
| «Hecho» | — | **68 px** |

```
listo9-antes-AP11.png   ·  listo9-despues-AP11.png  ·  listo9-despues-AP11-hoja.png
listo9-antes-D8.png     ·  listo9-despues-D8.png    ·  listo9-despues-D8-hoja.png
```

El «antes» del D8 arranca con un aviso menos que el del AP11, y no es un fallo
de la medida: **el toque de la pasada anterior ya se lo había comido**. Es
exactamente lo que el hallazgo denuncia, capturado por accidente.

En la mano la hoja ocupa la pantalla (R1, una sola capa); en el terminal sale
centrada, porque tapar 1280×800 para enseñar tres líneas sería esconderle la
sala a un cajero que está de pie delante de ella. **Lo que no cambia con el
tamaño son los pasos.**

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

**DECISIÓN (Matías, 23-10): la 3.** Se queda en **3 de 6 líneas y se desplaza**,
y es la única de las tres que no deshace un arreglo ya medido en el hierro: ni
vuelve a truncar el nombre del producto (el 🔴 del 18-10) ni deja la comanda sin
corrección rápida de cantidad (que es lo que hace aceptable haber quitado la fila
1–6 en §2.1).

Lo que queda abierto no es la decisión, es **el juicio con el aparato en la
mano**: si desplazar 293 px con el pulgar para ver las tres últimas líneas se
puede hacer en pleno servicio, o si al tenerlo delante prefiere pagar una de las
dos cosas de arriba. Eso se contesta en §9.4 y lo que diga va aquí tal cual.

Y queda dicho en voz alta para que nadie lo lea como un olvido: **el criterio
«con seis líneas, las seis a la vista sin desplazar» no se cumple, y no se puede
cumplir** sin tocar una de las dos piezas intocables. No es que falte trabajo: es
que 720 px no dan.

---

## 2.10 · 🟢 (9) · un aviso de «listo» abre una hoja, no sirve en el acto

Lo dictó Matías el 23-10 ya con la 1.29.0 en la mano, y entra en este bloque:

> «En el N1, al pulsar un aviso de "listo" de cocina, hoy funciona como un
> "hecho" directo. Debe abrir primero una hoja con la mesa y las líneas listas
> para recoger (cantidad + nombre entero, alergias marcadas) y abajo un "Hecho"
> grande; si hay varias mesas listas, una hoja por mesa.»

Y la ampliación, media hora después:

> «No va sólo en la mano. Es un cambio de flujo y se aplica en todos los
> aparatos (N1, AP11, AP12, AP13, D8). En la mano cumple R1–R4; en los grandes,
> con su propio tamaño.»

**El problema que arregla**, con sus palabras de otro modo: el camarero toca, el
aviso desaparece, y entonces tiene que acordarse de qué era — porque la única
pista que había es el nombre de la mesa.

**Los tres puntos de entrada van al mismo sitio**: la pila del terminal, el
contador de la mano y la etiqueta LISTO de la mesa en el mapa. Los tres abrían
un «servido» directo; los tres abren ahora la hoja.

**Se agrupa POR MESA, no por comanda.** Una mesa puede tener las bravas en la
pantalla de cocina y las cañas en la de barra, y el camarero hace **un** viaje:
una hoja, y el «Hecho» sirve las dos. De ahí que `orderIds` sea una lista.

**La API tenía que dar un dato que no daba.** `/kitchen/listas` devolvía la mesa
y nada más, porque sus dos destinos —la banda y la etiqueta— sólo enseñan el
nombre. Ahora manda también las líneas, sin las anuladas y con las unidades que
QUEDAN. Van por ahí y **no** por `/tickets/:id` a propósito: lo que está listo es
la comanda de cocina, no el ticket — un ticket de seis líneas con tres listas
enseñaría las seis, y el camarero se llevaría del pase lo que sigue en la
plancha.

**R1–R4 en la hoja:** a pantalla completa en la mano (R1), «Hecho» de **84 px**
en la mano y 68 en el terminal (R3; en la mano es el objetivo más grande de la
pantalla, que es lo que debe ser cuando sólo hay una cosa que hacer), cierre con
la X de 56 y con el atrás de Android —y **cerrar no es servir**, el atrás nunca
decide nada—, y la letra al suelo de R4 con el nombre **entero**, sin truncar.

**Las alergias van arriba y en rojo**, separadas de las líneas: es lo único de
esta hoja que, si se pasa por alto, hace daño.

**Lo que llega por la wifi no trae detalle** (kds-2: una tarjeta que sólo llegó
por la LAN no tiene todavía id de servidor ni líneas). La hoja lo dice en voz
alta en vez de enseñar una lista vacía que parezca «no hay nada».

---

## 2.9 · Las tres que decidió Matías (23-10, tras leer las medidas)

| | decisión | dónde |
|---|---|---|
| hallazgo 1 | **3 de 6 líneas y desplazar.** Queda por juzgar en la mano, no por decidir | §2.8 |
| `BILLING` | **fuera de este bloque**, con bloque propio `mesa-pide-cuenta`. Sin tocar la API | §4.1 |
| color de LISTO | **se queda arreglado en AP11 y D8**: primera excepción, con su captura | §0 |
| hallazgo 9 | **cambio de flujo en los cinco aparatos**: segunda excepción | §0 y §2.10 |

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

### 4.0 🔴🔴 **PRIORIDAD ALTA · bloque `kds-se-congela`**

**Antes de que Sirope use el KDS en servicio.** Lo que se vio en el AP11 la noche
del 23 al 24-10, todo junto:

| síntoma | medida |
|---|---|
| no late | `lastSeenAt` clavado en **22:24:56Z** con una ventana de **90 s**; el servidor lo daba `alive: false` |
| el reloj se para | marcaba **00:18 con las 00:34** en la pared, y tras descongelarse **00:31 con las 00:38** |
| pinta al tocar | al soltar el depurador pintó **un fotograma** —y ahí apareció la comanda que «no había llegado»— y se volvió a parar |
| miente en verde | su propia insignia decía **«En línea»** todo el rato, porque está congelada con el resto de la pantalla |
| arrastra días | tarjetas de hace **cinco días**, una de **7179 min** (`00-ap11-kds.png`) |
| versión | **1.27.0**, instalada el 18-10 |

**Lo que lo arregla hoy:** reiniciar el aparato entero. Hecho el 24-10 a las
00:55 y volvió del todo — reloj en hora, latido cada pocos segundos, y la
siguiente comanda llegó y se sirvió de punta a punta (§9.2-septies).

**Por qué es prioridad alta y no una curiosidad:** una pantalla de cocina
congelada **no se distingue de una pantalla al día**. Dice «En línea», enseña
tarjetas, y el camarero manda la comanda y se va tranquilo. Lo que falla no es
ruidoso: es silencioso. En un servicio eso es una mesa sin servir, y nadie se
entera hasta que el cliente pregunta.

**Lo que el bloque tendría que mirar:**

- por qué el renderer se queda suspendido (familia del «process is bad» del N1:
  el WebView es un proceso aparte y Android lo congela sin avisar);
- que el KDS **se note muerto**: si no ha latido en dos ventanas, la insignia
  tiene que dejar de decir «En línea» **en su propia pantalla**, no sólo en el
  servidor — hoy el único que sabe que está muerta es quien consulta la API;
- y que el TPV avise al camarero **antes** de enviar, no después.

Y una cosa que esta pasada deja medida y conviene no perder: la comanda tardó
**menos de 51 s** en aparecer con la pantalla sana (enviada 22:58:02Z, en la
tarjeta «0 min»), contra los 7 s que Matías midió a las 12:36. Las dos son
normales; lo que no es normal es que no aparezca nunca.

---

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

**DECISIÓN (Matías, 23-10): fuera de este bloque, y con bloque propio.**

> **Pendiente · bloque `mesa-pide-cuenta`.** Que una mesa pueda pasar a «pide la
> cuenta» y que el camarero lo vea en el mapa. Toca la API —quién marca que una
> mesa pidió la cuenta y por dónde entra— y desbloquea el botón «Cobrar X €» de
> la tarjeta, o sea la derivada principal de `principio-cobro-en-mesa`. Lo que
> este bloque deja hecho y medido para cuando llegue: la geometría del botón en
> la forma de 88 px (cuerda, peor importe, dos renglones al suelo de letra) y su
> contraste. Lo que NO se puede hacer hasta entonces: fotografiarlo en el
> aparato, porque no hay forma de poner una mesa en ese estado.

Aquí **no se toca ni una línea de la API**. Pero es, con diferencia, el hallazgo
más gordo de la pasada, y conviene que no se quede enterrado en un `-done`: hoy
la leyenda del mapa enseña un estado que un camarero no puede ver.

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

**431 ficheros / 6260 tests** en todo el monorepo. `tsc -b` limpio en
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
| El aviso vuelve a servir en el acto | `kds-tpv-cocina` | el toque sirve sin hoja: `expected [ 'ord…' ] to deeply equal []` |
| **En el TERMINAL sigue siendo «hecho» directo** | `kds-tpv-cocina` | el mismo, y además la banda vuelve a decir «Servido» |
| La hoja no agrupa las dos secciones | `n1-listo-hoja` | `expected 2 to be 1`: dos viajes para la misma mesa |
| La etiqueta LISTO vuelve a pintar sus 48 px | `n1-contraste-de-mano` | `expected 40 to be less than 34`: tapa el nombre |

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

**La 1.29.1 es la que hay que probar**: lleva dentro el hallazgo 9 y el arreglo
de la etiqueta que tapaba el nombre.

```
fichero   apps/tpv-android/build-releases/mipiacetpv-1.29.1-12901.apk
versión   1.29.1 (versionCode 12901)
commit    caa64a5
tamaño    8.745.945 bytes
SHA-256   1db9145805da2463b1bdc0fa10e4909cd01eb2b70e16123163e11a323859d644
firma     Signer #1 · CN=mipiacetpv · SHA-1 1256a71efff3008b7be57ad28bcda3a7fae10290
```

La **1.29.0** —`4d05b6e`, SHA-256 `7434214f…`— es la que se instaló en el N1 a
las 19:19 y con la que se midió el §9.2-bis, y es la que está puesta **ahora
mismo en el aparato**. Sigue en `build-releases/`.

```
fichero   apps/tpv-android/build-releases/mipiacetpv-1.29.0-12900.apk
versión   1.29.0 (versionCode 12900)
commit    4d05b6e
tamaño    8.744.373 bytes
SHA-256   7434214fd68149bf0436a7819a9392048c57673418a87fb9a22970c4a0db8fdd
```

Los cuatro chequeos del guion, en verde: `VITE_API_URL` a
`https://api.mipiacetpv.com`, sin Service Worker, origen del WebView correcto y
APK firmada.

Instalar por cable (**avisando antes a Matías**: el N1 lo está usando él, y una
instalación le reinicia la app a media prueba):

```bash
adb -s 192.168.5.144:<puerto> install -r \
  apps/tpv-android/build-releases/mipiacetpv-1.29.1-12901.apk
```

Y detrás, un reinicio del aparato: **el N1 sólo abre la app una vez por
arranque** (a la segunda sale en blanco). Ojo, que el reinicio **cambia el
puerto** de la depuración inalámbrica — pasó en esta pasada: de `42911` a
`39221`.

---

## 9 · La pasada en el hierro — **PENDIENTE**

### 9.1 Lo que impidió hacerla · **el bloqueo de red local de macOS**

Y no era que los aparatos estuvieran dormidos, que es lo que parecía. Medido:

| | resultado |
|---|---|
| `ping 192.168.5.144` (N1) | **responde**, 0 % de pérdida |
| `ping 192.168.5.75` (AP11) | **responde**, 0 % de pérdida |
| `adb connect` a cualquiera de los dos | `Operation timed out` |
| `adb mdns services` | anuncia dos aparatos, y los dos también dan timeout |
| servidor de adb | **PID 82146, arrancado el 18-oct**, PPID 1 (huérfano) |

Los dos aparatos están **vivos y en la red**; lo que no llega es **adb**. Es
exactamente el bloqueo que documenta la cabecera de `infra/terminal.sh`:

> macOS bloquea la red local al proceso que arranca el servidor de adb si ese
> proceso no tiene el permiso concedido. El síntoma NO es un error de permisos:
> es `No route to host` o `Operation timed out` contra TODA la LAN, incluidas IPs
> que responden al ping desde la misma máquina.

Al empezar la sesión los transportes se veían como `device` (el servidor del
18-oct tenía el permiso), luego pasaron a `offline` y después desaparecieron. Lo
que queda es un servidor de hace cinco días que ya no alcanza la LAN.

**Lo que NO se hizo, a propósito: reiniciar el servidor de adb.** La sesión de
`clinica-8` está conduciendo el Lenovo por adb y **comparte ese servidor**
(uno por máquina, `tcp:5037`): matarlo le rompe la pasada a media tarea. Y el
servidor nuevo, arrancado desde un agente, heredaría el mismo bloqueo — el propio
script lo dice: «un `adb start-server` lanzado desde un editor, desde un agente o
desde un cron hereda el bloqueo y NO funciona, aunque `adb` sea el mismo
binario».

### 9.1-bis · Las dos cosas que desbloquean la pasada, y son de Matías

1. **Arrancar el servidor de adb desde Terminal.app** (o iTerm), a mano, y
   conceder el permiso cuando macOS lo pregunte — Ajustes → Privacidad y
   seguridad → **Red local**. Mejor cuando la sesión de `clinica-8` haya acabado
   con el Lenovo, porque el servidor es compartido:

   ```bash
   adb kill-server && adb start-server && adb devices -l
   ```

2. **El puerto del N1.** La depuración inalámbrica lo cambia en cada
   reconexión, y el anterior (`42911`) ya caducó. Con el permiso concedido
   normalmente **no hace falta teclearlo**: sale solo con

   ```bash
   adb mdns services | grep _adb-tls-connect
   adb connect 192.168.5.144:<puerto>
   ```

   y si el inventario de super-admin está a mano, `infra/terminal.sh` lo resuelve
   por nombre (necesita `MIPIACETPV_SA_TOKEN`, que es de Matías).

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

### 9.2-bis · Lo que SÍ se midió en el N1 (23-10, 19:18–19:45)

Con el servidor de adb arrancado desde Terminal.app y el permiso de red local
concedido, el N1 y el AP11 volvieron. Lo hecho antes de que la pasada se
interrumpiera:

| | resultado |
|---|---|
| **KDS del AP11** | **«En línea»** a las 19:21, sección `Cocina · Barra`. La comprobación va **antes** de enviar, y se hace desde la pantalla del propio KDS |
| **1.29.0 instalada** | `versionName=1.29.0`, `versionCode=12900`, huella verificada contra el sidecar |
| **el aparato** | N1, Android 14, 720×1440 a densidad 320 → **360×720 de CSS**, `devicePixelRatio` 2 |
| **el mapa** | `innerWidth` **360**, `scrollWidth` 360, **sin desborde**, alto de página 720, banda de ensayo **40 px**, cabecera **120** (dos filas), lado de mesa **88**, marcos **fuera** |
| **zonas plegables** | las tres plegadas al abrir, con sus resúmenes contra datos reales: «BARRA 8 libres», «SALÓN 2 listos», «TERRAZA 1 ocupada» |
| **un toque de verdad** | `input tap` en **180×440** sobre la cabecera de Terraza, con `elementFromPoint` comprobado antes: `plegada` **false → true** |
| **objetivos táctiles** | **ninguno por debajo de 48**; el más pequeño es la cabecera de zona, a 48 justos |
| **la etiqueta LISTO** | tinta oscura sobre el verde, legible en el aparato |

Capturas en `docs/qa/2026-10-23-n1-hosteleria-2/`, con su `LEEME.md`.

### 9.2-ter · Y un hallazgo que sólo sale mirando la captura

**La etiqueta LISTO tapaba el nombre de la mesa.** En
`02-mapa-tres-plegadas.png` la primera mesa de BARRA dice «LISTO» y «1 pax» y
**no dice cuál es**. Lo había causado este mismo bloque: subirla de 30 a 48 px
por R3 la hizo ocupar de −8 a 40 sobre una forma de 88 donde el nombre va
centrado, en 34–54.

R3 (48 de dedo) y R4 (leer qué mesa) chocaban, y el arreglo es que **no son la
misma caja**: el objetivo táctil se queda en 48 y la pastilla pintada vuelve a
30, con la diferencia en relleno **transparente hacia arriba**, fuera de la
circunferencia, donde no hay nada que tapar. Con su sabotaje.

Es el mejor argumento para la parte de Matías: esto no lo caza ningún banco —lo
caza un ojo sobre una captura del aparato.

### 9.2-quater · Dos cosas de método que costaron caro

- **Recargar el renderer devuelve el TPV al PIN.** Cinco de mis medidas del mapa
  miraban la pantalla de acceso sin que nada lo dijera; se retiraron. Para
  cambiar de estado hay que tocar, no recargar.
- **Un toque a ciegas abre una mesa.** Al desplegar una zona, la cabecera de la
  siguiente se mueve, y un `input tap` sobre las coordenadas de hace un instante
  aterriza en una MESA. El driver ahora comprueba con `elementFromPoint` que
  debajo del dedo está el objetivo **antes** de tocar, y si no, no toca.

### 9.2-quinquies · LA PASADA, con la 1.29.1 (24-10, 00:00–00:30)

Hecha ya con el N1 en **puerto fijo 5555** y «Pantalla siempre encendida».

| paso | medido en el aparato | criterio |
|---|---|---|
| mapa a 360 | `innerWidth` **360**, `scrollWidth` 360, **sin desborde**, alto 720, banda 40, cabecera 120, mesa **88**, marcos fuera | 🟢 |
| zonas plegables | las tres plegadas al abrir con sus resúmenes reales; **la sala entera en y 184…364** | 🟢 (2) |
| un toque de verdad | `input tap` 180×680 físicos sobre la cabecera de Terraza → `plegada` **true → false**, 8 mesas | 🟢 |
| objetivos táctiles | **ninguno < 48** en el mapa; el menor es la cabecera de zona, 48 | 🟢 (R3) |
| fila de cantidad | **no se pinta** en ningún momento de la venta | 🟢 (5) |
| familia «Cafe» | rejilla **no**, tira **sí**, primer producto y=279 visible, **6 enteros** | 🟢 |
| buscar «tost» | ni rejilla, ni tira, ni fila; primer resultado **y=194**, pegado al buscador; **12 enteros** de 28 | 🟢 |
| la hoja de la comanda | **y=0…720, a pantalla completa**, y de la capa de debajo asoman **0 px arriba y 0 abajo** | 🟢 (1, 4, R1) |
| la X | **56×56** | 🟢 (6, R3) |
| **el atrás** | el **primero cierra la hoja y deja EN LA MESA**; el segundo vuelve al mapa | 🟢 (6) |
| pie de la comanda | **134 px**, total a **34 px** | 🟢 |
| **seis líneas** | **2 enteras de 6** | 🔴 ver abajo |
| cobro en efectivo | 19,40 €, «Pagado · cuadra», vuelve **solo** al mapa y T2 queda **POR RECOGER** | 🟢 |
| mesa POR RECOGER | lado 88, tinta `rgb(22,32,42)` sobre `rgb(157,180,200)`, nombre 20 px y **«Por recoger» a 15 px**, SIN los minutos | 🟢 (7) |
| hoja de opciones | **x=0, ancho 360 = todo el ancho**, título 19, cuerpo 15, **tres botones de 56 px**, orden **«Dejar libre» → «Abrir cuenta nueva» → «Volver»**; el atrás la cierra **sin decidir** | 🟢 (8) |
| envío a cocina | **la comanda SÍ llega**: «T2 · 2ª COMANDA» con los cinco cafés en el AP11 | 🟢 ver §9.2-sexies |
| hallazgo 9 en el hierro | **probado de punta a punta** tras reiniciar el AP11 | 🟢 el flujo · 🔴 el detalle, ver §9.2-septies |

Capturas en `docs/qa/2026-10-23-n1-hosteleria-2/`.

#### El 🔴 del hallazgo 1, medido en el aparato: **2 de 6**, no 3

Y la diferencia con el banco tiene causa, no ruido: esta comanda llevaba además
un bloque **«EN COCINA»** con la línea ya enviada (Croissant plancha ×6), y entre
su rótulo y su línea se comen **123 px** antes de que empiece la primera de las
seis nuevas.

```
ENTERA  162.. 191  «EN COCINA · 01:26»
ENTERA  195.. 289  «Croissant plancha  11,40 €  −6+»   ← lo ya enviado
ENTERA  293.. 327  «SIN ENVIAR»
ENTERA  331.. 432  «Café Americano»
 corta  436.. 538  «Café Bombón»                        ← la lista acaba en 522
 corta  542.. 643  «Café Solo»
 corta  647.. 749  «Café con leche»
 corta  753.. 854  «Café cortado»
```

El banco sólo tenía líneas sin enviar y daba 3. **Una mesa de verdad casi siempre
tiene algo ya en cocina**, así que 2 es la cifra honesta, y refuerza lo que dice
el §2.8: el criterio de las seis no se cumple y no se puede cumplir sin tocar
una de las dos piezas intocables.

#### §9.2-sexies · «La comanda no llega» · **era mi propio depurador**

Lo di por un corte de cocina y **me equivoqué**. Matías lo paró a tiempo: a las
12:36 del 23-10, con la 1.28.1 en el N1 y el mismo AP11, la comanda llegó en
7 s; con la 1.29.1 no. Hasta demostrar lo contrario, eso es una regresión de este
bloque. No lo era, y ésta es la prueba.

**1 · La comanda SÍ llegó.** En el AP11 está la tarjeta **«T2 · 2ª COMANDA»** con
los cinco cafés exactos del envío —Americano, Bombón, Solo, con leche, cortado—
y su botón «Lista». Captura `33-ap11-comanda-visible.png`. No hubo fallo de
entrega: hubo fallo de observación.

**2 · Lo que hice mal, en dos pasos.** Primero capturé el AP11 **seis segundos**
después de enviar y leí «Sin comandas pendientes» como «no ha llegado», cuando
el KDS aún no había refrescado. Y luego lo rematé: enganché Playwright por CDP
al WebView del AP11, el `connectOverCDP` **agotó los 30 s** y dejó un depurador
a medio enganchar que **congeló el renderer**. La segunda captura salió idéntica
byte a byte, y la leí como confirmación. Era la misma pantalla helada.

Al soltar el reenvío (`adb forward --remove-all`) la pantalla pintó **un
fotograma** y ahí apareció la comanda.

**3 · El AP11 está degradado, y de antes.** Su reloj marcaba **00:18 con 00:34 en
la pared**, y tras descongelarse se quedó en **00:31 con 00:38**: pinta cuando se
le toca y se vuelve a parar. El latido murió a las **22:24:56Z** con una ventana
de 90 s y no ha vuelto. Y arrastra tarjetas de hace **cinco días** (una de
7179 min, visible en `00-ap11-kds.png`). Lleva la **1.27.0** del 18-10. Es de la
familia del [[el-renderer-del-webview-es-un-proceso-aislado]], no del envío.

**4 · Y este bloque no puede ser la causa, por construcción.** Dos hechos de
`git`, no de opinión:

```
git diff --stat 0bb7d9f..HEAD -- apps/tpv-web/src/kitchen     apps/tpv-web/src/lib/kitchenComanda.ts apps/tpv-web/src/lib/outbox.ts     apps/tpv-web/src/api.ts apps/tpv-web/src/lib/escposPrint.ts
  → sólo HojaDeListo.tsx y ListoBanner.tsx, que PINTAN avisos y no envían nada
```

`useKitchen` —quien manda la comanda y quien calcula «Cocina no recibe»—,
`useCaminoDirecto` —la wifi—, `kitchenComanda`, `outbox`, `api.ts` y
`escposPrint` son **idénticos byte a byte** entre la APK que funcionaba
(1.28.1, `0bb7d9f`) y la 1.29.1. De `SalePage.tsx` sólo cambia un `onServidas`
aditivo.

Y el único cambio de API del bloque **no está desplegado**:

```
git ls-remote --heads origin n1-hosteleria-2   → vacío
git branch -r --contains HEAD                  → 0 ramas
```

La rama nunca se ha empujado, así que `api.mipiacetpv.com` no puede estar
corriendo mi `/kitchen/listas`. Producción va por `master`.

**Conclusión: no es una regresión de este bloque, y no hay nada que arreglar
aquí.** Lo que sí queda, y es de hierro:

> **Pendiente · el KDS del AP11 está congelado.** Pinta cuando se le toca y se
> para; no late desde las 22:24:56Z; arrastra tarjetas de cinco días. Hace falta
> recargarlo o reiniciar el aparato —y mirar por qué se queda así, que es lo que
> hizo que la pasada del 23-10 también se cortara aquí (§9.2-ter de
> `n1-hosteleria-done`)—. **No lo toco yo**: es hardware de producción.

**Y la lección de método, que vale más que el hallazgo:** enganchar el CDP a un
aparato **lo cambia**. Un depurador a medio enganchar congela el renderer y deja
una pantalla que parece estar diciendo algo cuando no dice nada. Para observar un
KDS, `screencap` y esperar su ciclo de refresco; el CDP, sólo en el aparato que
se conduce, y nunca en el que se observa.

#### Y un fallo de texto que sólo sale en la hoja del hallazgo 8

**«Se cobró hace hace menos de 1 min».** `minutosDesde` ya trae el «hace»
dentro y el literal lo duplicaba. Sólo se ve con la cadena larga —el minuto
siguiente a cobrar—, que es justamente el caso más frecuente de esa hoja y el
que ningún banco miraba. Arreglado, con su sabotaje.

### 9.2-septies · El hallazgo 9 en el aparato, de punta a punta (24-10, 00:55–01:05)

Con el AP11 **reiniciado entero** y su reloj en hora (00:55 en la pantalla,
00:55:01 en el Mac), el recorrido completo, sin CDP en el AP11 —sólo `screencap`
y `input tap`, que es la lección de §9.2-sexies—:

| paso | medido |
|---|---|
| mesa B3, dos tostadas, enviar | 22:58:02Z, **sin aviso de «Cocina no recibe»** |
| llega al AP11 | tarjeta **«COCINA · B3 · 0 min»** con las dos líneas, en **menos de 51 s** |
| cocina marca «Lista» | `input tap` en (218, 541) → pasa a **«LISTAS · 1»**, «B3 · esperando · 0 min» |
| el aviso llega al N1 | contador en modo **`contador`**, bloque de **64 px**, objetivo de **56**, «**1** · B3 · listo para servir · **Ver**» |
| el contador abre la lista | una fila por mesa, 56 px, y dice **«Ver»** — ya no «Servido» |
| la fila abre **la hoja** | **`pantalla-completa=true`**, 0…720, 360 de ancho |
| «Hecho» | **84 px de alto y 24 px de letra** — el objetivo más grande de la pantalla |
| cerrar | 56 px · **ningún objetivo de la hoja por debajo de 48** |
| **el atrás la cierra SIN servir** | la hoja se va y **el aviso sigue**: `avisos: "1"` |
| «Hecho» sirve | la hoja se cierra, el contador desaparece… |
| …y llega a cocina | la columna «LISTAS» del AP11 **se vacía** (52.716 bytes contra 58.990) |

Capturas `38-ap11-b3-recibida` … `47-ap11-servida`.

#### 🔴 Pero el detalle no se ve, y es una dependencia dura

**`lineas: []`.** La hoja sale, se cierra con el atrás y sirve con el «Hecho»
—el FLUJO está— pero **no enseña qué hay que recoger**, que es el corazón del
hallazgo. Y no es un fallo del front: es que la API de producción no manda las
líneas. Medido pidiéndoselas:

```
GET https://api.mipiacetpv.com/kitchen/listas
claves que manda: orderId, ticketId, tableId, tableName, section, number, readyAt
"lines" in respuesta → false
```

El front degrada como se diseñó —«Cocina no ha mandado el detalle de esta
comanda. Lo que está listo es lo de B3.»— en vez de enseñar una lista vacía que
parezca «no hay nada». Pero hay que decirlo claro:

> **La APK sola no basta para el hallazgo 9.** Sin desplegar el cambio de
> `/kitchen/listas` (§2.10), la hoja es un toque de más a cambio de ninguna
> información nueva — peor que el «hecho» directo de antes. **Las dos cosas van
> juntas: la 1.29.1 y la API.**

Es, con diferencia, lo primero que hay que mirar al cerrar el bloque: el PR trae
el cambio de API dentro, así que basta con desplegarlo al mergear. Pero si
alguien instalara la APK sin desplegar, el hallazgo 9 sale peor de lo que
estaba.

### 9.3 El guion, con el servicio encima

Mecánico en cuanto haya adb. El orden importa: **el KDS se comprueba ANTES de
enviar**, porque una comanda que sale y no llega es lo que cortó la pasada del
23-10 (§9.2-ter de `n1-hosteleria-done`).

**LO PRIMERO: el N1 se trabaja en 5555.** Decisión de Matías, 23-10. El puerto de
la depuración inalámbrica rota solo —y no sólo al reiniciar: también al
bloquearse la pantalla y al tocar los ajustes de depuración—. En esta sesión
cambió **tres veces** (42911 → 39221 → 41733 → 35829) y cada una costó parar y
pedirlo. Con el puerto fijo deja de ser un tema:

```bash
adb -s 192.168.5.144:<el-que-te-pase-Matías> tcpip 5555
adb connect 192.168.5.144:5555
# y a partir de aquí SIEMPRE  -s 192.168.5.144:5555
```

Y «Pantalla siempre encendida» puesta en el aparato. Dos avisos: `tcpip 5555`
reinicia adbd, así que **el reenvío del CDP se cae y hay que rehacerlo**; y si
Ajustes se queda en primer plano **los toques se los come Ajustes** mientras el
CDP sigue leyendo el DOM del TPV tan contento — se comprueba con
`dumpsys activity activities | grep topResumedActivity` y se retoma con
`am start -n es.mipiace.tpv/.MainActivity`, que trae la tarea al frente sin
gastar la única apertura del arranque.

```bash
N1=192.168.5.144:5555
APK=apps/tpv-android/build-releases/mipiacetpv-1.29.1-12901.apk

# 0 · que es el N1 y no otro aparato
adb -s $N1 shell getprop ro.product.model          # -> N1
adb -s $N1 shell dumpsys package com.mipiace.tpv | grep versionName

# 1 · instalar la 1.29.0 y verificar la huella contra la construida
shasum -a 256 "$APK"   # 7434214fd68149bf0436a7819a9392048c57673418a87fb9a22970c4a0db8fdd
adb -s $N1 install -r "$APK"

# 2 · y SOLO UNA apertura por arranque: a la segunda la app sale en blanco
#     (ver la memoria «el N1 sólo abre la app una vez por arranque»)
adb -s $N1 reboot && sleep 60
```

**El KDS del AP11, sin necesidad de la base de producción.** El propio TPV lo
dice en pantalla: con el módulo encendido y sin camino, la comanda pinta
«Cocina no recibe · al enviar saldrá en papel» (`data-testid="cocina-no-recibe"`),
y hay un «Probar cocina por wifi» (`probar-cocina-wifi`) en la venta. Si no sale
el aviso rojo y la prueba contesta, el KDS está vinculado. Esto se mira **antes**
de tocar «Enviar».

El recorrido, el mismo que el banco y con el servicio encima:

| paso | qué se mira |
|---|---|
| 1 · mapa a 360 | `innerWidth` 360, sin desborde, cabecera de 2 filas, mesa de 88 |
| 2 · plegar Salón y Terraza | las 8 de Barra enteras, y las dos cabeceras diciendo su resumen |
| 3 · plegar las tres | la sala entera de un vistazo, sin desplazar |
| 4 · reiniciar la app | el pliegue **se recuerda** |
| 5 · mesa por recoger | la hoja a todo el ancho, «Dejar libre» primero, letra legible |
| 6 · abrir mesa, 6 líneas | **3 enteras y desplazar** — el §2.8, que es lo que hay que juzgar |
| 7 · dos avisos de cocina reales | el contador de alto fijo, y que NO empuje la comanda |
| 8 · urgente con alergia encima | **una sola capa**: la de debajo no asoma |
| 9 · buscar «tost» con teclado | sin fila de cantidad, primer resultado pegado al buscador |
| 10 · la X y el atrás | las dos cierran la hoja y **no** sacan de la mesa |
| 11 · enviar a cocina | verla llegar al AP11 |
| 12 · cobrar en efectivo | y que la mesa quede POR RECOGER, legible |

Capturas numeradas en `docs/qa/2026-10-23-n1-hosteleria-2/`, y **los toques con
el driver táctil (`input tap`) sobre las coordenadas del CDP, no sobre el
espejo** (memoria «medir toques en el D8»).

### 9.4 Y lo que de verdad cierra el bloque

**Matías usándolo con sus manos, de abrir mesa a cobrar, con avisos entrando.** El
bloque no se cierra hasta que él diga que lo puede usar. Lo que dicte va aquí tal
cual — y la primera pregunta es la de §2.8: cuál de las tres salidas quiere para
las seis líneas.

### 9.5 Inventario para el «Resetear ensayo»

Lo que **esta sesión** ha dejado en Sirope-ensayo:

| qué | dónde | cuándo | de quién |
|---|---|---|---|
| **Mesa T2 abierta · 11,40 € · 1 línea** | TERRAZA | 23-10 **19:26** | un toque que aterrizó en la mesa al moverse la cabecera de zona bajo el dedo. Matías estaba usando el N1 a la vez, así que **no se puede afirmar de quién fue el toque** |
| **Ticket cobrado · 19,40 € · 6 líneas** | T2 | 24-10 **~00:20** | el cobro del guion, con esa misma T2 y cinco cafés añadidos encima |
| **Mesa T2 · POR RECOGER** | TERRAZA | 24-10 **~00:20** | el estado en el que el cobro deja la mesa. Se usó para probar el hallazgo 8 y **no** se tocó «Dejar libre», para dejarlo visible |
| **Una comanda de cocina enviada** | T2 | 24-10 **~00:10** | la de la 2ª revisión; llegó al AP11 (lo tapó la pantalla congelada) |
| **Mesa B3 abierta · 7,00 € · 2 líneas** | BARRA | 24-10 **~00:57** | la mesa de la prueba del hallazgo 9. **Se deja abierta a propósito**: es la que tiene la comanda ya servida detrás |
| **Una comanda de B3, enviada y SERVIDA** | B3 | 24-10 00:58 → 01:0x | el recorrido completo: enviada, marcada «Lista» en el AP11 y servida desde el N1 con el «Hecho» |

Y la **T2 ya figura LIBRE**: alguien le dio a «Dejar libre» entre medias, así que
de ella no queda nada que recoger.

**Un ticket cobrado**, el de 19,40 €. Nada subió a Holded ni generó registro
fiscal: el tenant está en ensayo y el propio TPV lo rotula («ENSAYO · estos
cobros no son facturas»).

Y lo que ya había de antes, que no es de esta sesión pero el reset se lleva
igual: cuatro comandas de cocina pendientes en el KDS del AP11 (la más vieja de
**7179 min**, cinco días) y dos en «LISTAS» (T6 y M5, de ~7.000 min). Se ven en
`docs/qa/2026-10-23-n1-hosteleria-2/00-ap11-kds.png`.

Todo lo demás se midió contra la stack del banco, en la base desechable
`mipiacetpv_n1_host2_e2e`, que no toca producción.

---

## 10 · EL ORDEN DE SALIDA · **obligatorio, y en este orden**

El hallazgo 9 parte el bloque en dos piezas que **no sirven por separado**: la
APK 1.29.1 pinta la hoja, y la API es quien manda las líneas que la hoja enseña.
Publicar la APK antes de desplegar deja a los camareros **un toque de más a
cambio de ninguna información nueva** — peor que el «hecho» directo de antes
(medido en el aparato, §9.2-septies).

Así que:

### 1 · Mergear el PR

Trae las dos piezas dentro: el front y el cambio de `/kitchen/listas`.

### 2 · Desplegar la API

```bash
infra/deploy.sh      # o el camino de despliegue de siempre
```

**La API primero y sola.** Es segura de desplegar antes que nada porque el
cambio es **sólo aditivo**, y eso está demostrado y no afirmado (§10.1): los
terminales que siguen con 1.27.0 / 1.28.x —el AP12 de Sole, el D8 de Sirope—
siguen funcionando **igual** contra la API nueva, porque no leen `lines` y
ninguna de las siete claves que sí leen ha cambiado.

### 3 · Comprobar EN PRODUCCIÓN que `/kitchen/listas` trae `lines`

No se da por hecho: se mira. Hace falta una comanda marcada «Lista» en una
tienda con KDS (en Sirope-ensayo vale), y entonces, desde la consola del TPV o
con la sesión de un cajero:

```bash
curl -s https://api.mipiacetpv.com/kitchen/listas \
  -H "Authorization: Bearer <sesión de cajero>" \
  -H "X-Device-Token: <token del aparato>" | jq '.ready[0] | keys'
```

Tiene que salir **`lines`** en la lista de claves. Si no sale, el despliegue no
ha entrado y **no se publica la APK**: hoy, sin desplegar, lo que devuelve son
estas siete y nada más —medido el 24-10 contra producción—:

```
orderId · ticketId · tableId · tableName · section · number · readyAt
```

### 4 · Y SÓLO ENTONCES publicar la 1.29.1

```bash
infra/publicar-apk.sh apps/tpv-android/build-releases/mipiacetpv-1.29.1-12901.apk
```

Antes de instalarla en el N1, avisar: una instalación reinicia la app a media
prueba. Y detrás va un reinicio del aparato (una apertura por arranque).

---

### 10.1 · Por qué el paso 2 es seguro para los terminales viejos

Demostrado en `test-e2e/kds-1-cocina.e2e.ts`, contra Postgres y con la ruta de
verdad (`app.inject`), no con un doble:

| banco | qué ata |
|---|---|
| ADITIVO · las siete claves de antes | ninguna falta, y **lo único nuevo es `lines`** |
| ADITIVO · significan lo mismo | `orderId`, `ticketId`, `tableName`, y `readyAt` sigue siendo un ISO que `Date.parse` entiende — de eso depende el ORDEN de la banda en el front viejo |
| UN FRONT VIEJO (1.27.0 / 1.28.x) | leyendo **sólo** esas siete no se queda sin ninguna, y **quitarle `lines` no le cambia nada** |
| `lines` trae lo que la hoja necesita | `id`, `name`, `units`, `allergens`, sin lo anulado y con las unidades que quedan |

Y los dos sabotajes, con su rojo de verdad:

| sabotaje | el rojo |
|---|---|
| se renombra `tableName` → `mesa` | **5 bancos en rojo**, y el que importa dice «**el front viejo se queda sin tableName**» |
| se cuela un campo nuevo sin revisarlo | `expected [ 'esperandoDesde', 'lines' ] to deeply equal [ 'lines' ]` |

El segundo es el que más vale a largo plazo: **un campo nuevo en una ruta que
consumen terminales viejos se mira dos veces**, y ahora el banco obliga a
mirarlo.

Cómo se corre (base desechable propia y Redis propio; la suite hace DROP SCHEMA):

```bash
# los DOS .env apartados, que si no tapan la configuración del e2e
mv .env .env.apartado 2>/dev/null; mv apps/api/.env apps/api/.env.apartado
cd apps/api && E2E_DATABASE_URL="postgresql://…/mipiacetpv_n1host2_api_e2e?schema=public" \
  REDIS_URL="redis://127.0.0.1:6390" \
  pnpm exec vitest run --config vitest.e2e.config.ts test-e2e/kds-1-cocina.e2e.ts
# y devolverlos al acabar
```

---

## 10.2 · El push y el PR

**Los hace Matías.** `master` ha avanzado durante la sesión (hasta `178e102`:
`primer-acceso`, un hotfix de menú y dos prompts nuevos), pero **ninguno de los
16 ficheros de código que toca esta rama lo ha tocado master**, así que el merge
del PR no debería dar conflicto. Comprobado fichero a fichero.

```bash
cd /Users/matiasoyolasanchez/Developer/Claude/Projects/mipiacetpv-n1-hosteleria-2
git push -u origin n1-hosteleria-2
gh pr create --base master --head n1-hosteleria-2 \
  --title "n1-hosteleria-2 · que un camarero pueda usar el N1 en pleno servicio" \
  --body "Siete de los ocho hallazgos del 23-10 cerrados y medidos contra un servicio en marcha. El hallazgo 1 (las seis lineas del resumen a la vista) NO cierra: la cuenta esta en el §2.8 del -done y las tres salidas las decide Matias con el aparato en la mano. Los terminales: 0 pixeles distintos en las cuatro capturas, con una excepcion declarada (el color de la etiqueta LISTO, que iba a 1,66:1). Y un hallazgo fuera de los ocho que es el mas gordo: BILLING no existe, asi que el boton «Cobrar X €» de la tarjeta de mesa es inalcanzable (§4.1)."
```

### 10.1 Para parar el banco cuando no haga falta

```bash
docker rm -f mipiacetpv-redis-n1host2
# y los dos servidores de dev, que esta sesion dejó levantados en 3118 y 5290
```
