# Bloque agenda-1 · la agenda que se entiende y la cita en dos toques

Rama `agenda-1-se-entiende`, desde `origin/master` (`43d0a8c`). Prompt:
`docs/code-prompts/bloque-agenda-1-se-entiende.md`. Diseño:
`docs/mockups/agenda-nueva/` (cuatro tableros `.dc.html`). Punto de partida:
`docs/qa/2026-10-27-clinica-9/PASADA.md`.

Capa **común** de agenda: lo que cambia entre la clínica de Rosario, la
peluquería de Sole y el spa de Raquel va en datos y en configuración del
centro, no en ramas por vertical.

---

## 0 · Lo que Matías dijo, y lo que se ha medido

> «No me gusta la agenda, no es nada intuitiva.»
> «Dar cita es súper tedioso… en el spa lo hemos optimizado mejor… tenemos que
> reducirlo a la mínima expresión.»

Medido en hierro el 27-10 (pasos 7 y 11 de la pasada): **~10 toques** por
«Nueva cita» y **5** tocando la rejilla.

**Medido después, en el navegador y no a ojo** (`?centro=clinica` del banco
visual; el script hace exactamente N clics y comprueba que la cita entró — si
falta uno, no entra):

| Camino | Antes (hierro, 27-10) | Ahora (medido) |
|---|---|---|
| Cita nueva a una paciente conocida | ~10 | **6** |
| La próxima cita desde «Dársela» | 5 | **3** |
| Dar cita en un hueco con la paciente ya sabida | 5 (y perdía la paciente, H8) | **3** |
| Dar cita en un hueco, en frío | 5 | **5** |

Y la cuenta que el prompt pide en sus términos —«dos toques desde Dársela, uno
si se tocó el hueco»— es la misma lista contada desde el panel ya abierto: con
«Dársela» la pantalla abre con paciente, servicio y fecha puestos y las horas
ya buscadas, así que quedan **la hora y Reservar**; y si en vez de la hora se
toca un hueco de la agenda, queda **Reservar**.

**Hay que decir lo que NO ha bajado:** el camino en frío desde un hueco sigue
siendo cinco toques, porque de esos cinco, dos son el selector de pacientes
—que es el mismo de siempre— y los otros tres son las tres cosas que nadie
puede saber por ti. Lo que ha cambiado ahí no es la cuenta: es que el hueco se
VE y dice cuánto dura y qué cabe, en vez de haber que adivinar dónde tocar en
una rejilla.

---

## 1 · D1 · una profesional es una LISTA; varias, la rejilla

Decisión de Matías, y es la que más cambia la pantalla.

**Por qué.** Con una sola columna la rejilla deja ~208 px de agenda y el resto
de la tablet en blanco (clinica-8 lo ensanchó a `flex-1`, que arreglaba el
ancho y no el fondo), y una cita de 15 minutos mide 16 px: una raya que no se
toca. En la lista una Cura de 15 minutos y una avulsión de dos horas ocupan lo
mismo —una fila de altura tocable—; se pierde la proporción del tiempo y se
gana poder tocarla, que es lo que la recepción hace con ella.

**Lo que la lista dice y la rejilla no decía** (tablero 1, captura
`docs/mockups/agenda-nueva/1-dia-una-profesional.hecho.png`):

- **el estado de cada cita** con todas las letras (Cobrada · 25 €, En sala,
  Por llegar, No vino, Valoración pendiente, Queda cobrarla), las hechas
  atenuadas y la de ahora destacada. En la rejilla el estado era un filete de
  color de 4 px;
- **los huecos libres**, con su duración y qué cabe: «Libre 20 min · cabe
  Consulta diagnóstico o Sesión papiloma · + Dar cita aquí»;
- **los que ya pasaron**: «Se fueron 25 min sin vender», visibles y NO
  tocables (tocarlos sería un 409 `BOOKING_IN_PAST` con la paciente delante);
- **las horas cerradas plegadas** en una línea («Cerrado desde las 14:00»);
- la **columna izquierda**: Ahora (con «Abrir sesión»), Después, Pendiente de
  recepción y las tres cifras del día.

**Y la rejilla (tablero 4) también mejora**, porque sigue siendo el día de
Sole:

- la **escala sale de la retícula** y no de una constante: `pxPorMinuto(slot)`
  = `max(1,1 ; 44/slot)`, para que la franja más pequeña que se puede reservar
  sea tocable (44 px, el mínimo de WCAG y el del diseño). Con 30 minutos son
  1,47 px/min; con 15, 2,93;
- **los huecos libres se ven** (hasta aquí un hueco era ausencia de tarjeta) y
  se calculan con la **misma función pura** que la lista — si la rejilla
  ofreciera un hueco que la lista no, una de las dos mentiría y nadie sabría
  cuál;
- la **cabecera de cada columna dice qué está haciendo**: «Ahora: Mari Carmen ·
  tinte» o «Libre hasta las 11:00». Sale del RELOJ y no del estado «en sala»,
  que lo mueve una persona y se olvida;
- el **carril reparte el ancho que tiene**: tres profesionales dejaban 600 px
  en blanco a la derecha en la Lenovo apaisada.

«Una profesional» incluye el centro de varias con el filtro puesto en una:
«mi día» es exactamente el día de una profesional.

---

## 2 · La cabecera, y los tres controles que se van

Tablero 1: volver · ‹ fecha · Hoy › · Día | Semana · «Dar cita».

Se van, por decisión de Matías:

- **el campo de fecha** de navegar por días. Ojo: el `type="date"` **no
  desaparece del bloque** — sigue siendo el control bueno para pedir una fecha
  de CITA y vive dentro de «¿Cuándo?» → «Otra fecha». Lo que se va es el de
  NAVEGAR, que es otra cosa;
- **la tira de siete chips de día**. Su trabajo —ver y comparar varios días— lo
  hace ahora la vista de Semana, que además enseña lo que hay DENTRO de cada
  uno;
- **el selector «Todos» con una sola profesional**: una lista de un elemento no
  filtra nada.

Y dos cosas que entran para que no se pierda nada:

- **las flechas dejan de ser `hidden sm:flex`.** Eran redundantes con la tira;
  sin la tira son el único modo de moverse un día;
- **«Hoy» es un botón**, y sólo aparece cuando el día no es hoy. El rótulo lo
  dice igual («Martes 27 oct · Hoy»), así que en el caso de siempre ese botón
  no le quita píxeles a nadie — que es la lección de B-5 F8.

Lo secundario (el aviso de caché, los cobros pendientes, la salud de la agenda
y el filtro cuando hay más de una) baja a una **segunda fila que desaparece
entera cuando no tiene nada dentro**.

**El título «Agenda» sigue siendo el `<h1>`**, en `sr-only`: no se pinta —el
diseño no lo lleva y esos 66 px hacen falta a 390 px— pero para un lector de
pantalla «esto es la agenda» no es decoración.

**El ⋯ de las ausencias** sube a la cabecera cuando la columna es una: la lista
no tiene cabecera de columna, y quitarle a Rosario la forma de decir que un día
no está sería una función menos por un cambio de layout.

---

## 3 · «Dar cita» · el embudo del spa, con la mecánica y no el vocabulario

Tablero 3. Cuatro preguntas que se contestan de arriba abajo y **se pliegan en
cuanto están contestadas**, con lo que el sistema ya sabe puesto:

1. **¿Quién?** — móvil primero; si no tiene ficha, se crea con lo tecleado.
2. **¿Qué viene a hacer?** — lo de hoy, su último, o la lista entera agrupada
   por categoría y ordenada por uso (clinica-8 fase B, 17).
3. **¿Cuándo?** — la fecha propuesta, esta semana, el día que se está viendo,
   otra fecha.
4. **Mejores horas** — ordenadas por `proponer()`, no por reloj.

Y un pie fijo con el resumen («Mar 24 nov · 09:00–09:30 · Quiropodia básica ·
30 min») y «Reservar».

**Ni cabinas, ni «relajarse», ni €/h, ni frases de venta**: eso es vocabulario
de spa y la clínica no lo quiere. Lo que se ha traído es la mecánica.

### 3.1 · Lo que se ha quitado y por qué

- **«Buscar hueco» ya no existe.** La búsqueda sale de contestar «¿Cuándo?» —y,
  mejor aún, de no contestarlo: la ventana se pone sola con lo que el sistema
  ya sabe (la que propuso la sanitaria, el día que se está viendo si es futuro,
  o esta semana si ya pasó) y el paso se queda a la vista para cambiarla. Es un
  toque menos, y era el toque que no decidía nada.
- **Cambiar de servicio ya NO borra la hora.** El panel viejo ponía
  `start: null` en cada cambio, y con el panel nuevo eso se come lo que la
  recepción acaba de hacer (tocar un hueco a las 16:30 y elegir el servicio
  dejaba el pie diciendo «Falta la hora»). Lo que sí se tira son las propuestas,
  que estaban calculadas para otra duración. Si la hora elegida no aguanta el
  servicio nuevo, **el motor contesta 409 con su frase y sus tres horas
  tocables** — que es el mecanismo que B-reservas-6a construyó justo para esto,
  y que dice la verdad en vez de adivinarla en el front.

### 3.2 · Lo que se conserva, pieza a pieza

Nada de lo que los bloques anteriores pagaron se ha perdido; está en
`AgendaPage.darCita.tsx` con sus motivos:

- «Reservar y cobrar» **sólo en una cita de hoy** (B-mostrador F1), y la ranura
  del secundario **no desaparece** aunque el botón sí: el pie está anclado abajo
  y moverlo justo cuando la recepción va a tocar es cómo se cobra lo que no se
  quería cobrar;
- **ningún botón apagado es mudo** (F4), y el motivo se dice **también con la
  hora puesta** — tocar un hueco deja la hora y no el servicio, y ése era justo
  el caso mudo;
- **sin duración no hay fin** (F4): nunca una hora de fin falsa;
- las **alternativas del 409 del suelo**, tocables y pegadas a la hora (6a);
- la lista **agrupada y ordenada por uso**, con el nombre entero en dos líneas
  (clinica-8 fase B, 17 y 19);
- las horas **traídas a la vista** y **cuántas son** (punto 25 de la auditoría),
  ahora con «N huecos · aquí los 3 mejores» cuando hay más de tres;
- el **bono** (B-reservas-8).

### 3.3 · H del paso 5 · el aviso de fichas parecidas, con el teclado abierto

Pasada del 27-10, paso 5: «Con el teclado abierto el aviso queda debajo y no se
ve». Era literal: vivía al final del formulario, detrás del email, la fecha, el
RGPD y las notas. Ahora va **justo debajo del teléfono**, que es el último de
los tres campos que alimentan el parecido — `scrollFocusIntoView` trae el campo
con el foco a la vista y el aviso es lo siguiente que hay. No es un `fixed` ni
un toast: es una caja en el flujo, en el sitio donde se mira.

Y el buscador dice **«Móvil, nombre o email…»**: en un centro de cita previa la
paciente da su móvil antes que su apellido, y `semillaDesdeLaBusqueda` ya
trataba una ristra de dígitos como teléfono. Lo que faltaba era decirlo. El
`inputMode` **no** cambia a `"tel"`: en Android eso da un teclado numérico sin
letras y el buscador también busca por nombre.

---

## 4 · `proponer()` · el orden de las mejores horas

Módulo puro con sus propios tests y **sin agenda real**:
`apps/tpv-web/src/lib/agenda-proponer.ts`.

**Por qué vive aparte.** Es la única parte de «Dar cita» que se puede equivocar
en silencio. Un panel que pinta un chip de más se ve; un orden que pone delante
la hora que parte la mañana en dos trozos inservibles no se ve nunca —
simplemente la agenda se llena peor, mes a mes.

**La regla de orden, escrita:**

1. **Menos minutos muertos primero.** Un minuto muerto es un trozo de hueco
   libre que queda demasiado corto para que entre nada (por debajo de
   `minimoUtilMin`, 15 por defecto).
2. A igualdad, **la que se pega** a lo que ya hay: deja el rato libre de una
   pieza, que es lo que se puede vender después.
3. A igualdad, **la fecha que propuso la sanitaria**. Es lo único de este orden
   que viene de una decisión clínica y no de geometría — y **sólo desempata**:
   no sube una hora que deja huecos muertos.
4. A igualdad, **la más pronto**, y el orden de entrada como último recurso:
   dos listas iguales no pueden salir distintas.

**Manda el motor, no esto.** Los candidatos los produce `POST
/agenda/availability`, que es quien decide si un hueco existe; `proponer()` sólo
los ordena. Un candidato que la forma del día no sostiene **se devuelve al
final, no se esconde**: esconderlo sería quitarle a la recepción una hora que el
servidor sí acepta.

**Lo del spa, preparado y sin pantalla.** `ConfigDelCentro` enciende
«sugerencias de venta» y «cheque regalo», y `Propuesta.extras` los devuelve —
sólo en la primera, porque el embudo ofrece el extra una vez y no uno por hora.
**Nada de este bloque los pinta.** Es un hueco con nombre, no media pantalla.

---

## 5 · La semana (tablero 2)

Los días que **abre** el centro, en columnas, con las citas y los huecos dentro
y hoy destacado. Tocar la cabecera lleva a su día; tocar un hueco abre «Dar
cita» con ese día y esa hora.

Las tarjetas son de altura mínima tocable y **no** proporcionales al tiempo: una
semana a escala es la rejilla, y la rejilla a cinco días deja las citas de 15
minutos en rayas — el fallo que este bloque arregla, repetido cinco veces. Lo
que la semana contesta no es «cuánto dura» sino «qué día está más vacío».

**Sin red no se pinta, y lo dice.** `fetchAgendaRange` no pasa por la caché
offline: está indexada por día y guardar siete desde aquí dejaría dos escritores
del mismo registro con formas distintas. La pantalla que hay que poder mirar sin
red es la del día, y ésa sigue saliendo de la caché.

---

## 6 · Pendiente de recepción

Contesta una sola pregunta: «¿hay algo que yo tenga que hacer AHORA, con alguien
que está aquí o que acaba de irse?». Dos entradas hoy:

- **la próxima cita propuesta** (clinica-9, 9) → «Dársela»;
- **el test de salud sin contestar** (clinica-2) → «Tablet», y **sólo de quien
  viene hoy**: el de alguien que viene en tres semanas no es nada que hacer
  ahora.

La lista sale de una función pura (`lib/agenda-recepcion.ts`) y no de tres `if`
en la pantalla, porque el prompt dice «hazlo fácil de mover»: el cuarto
pendiente tiene que ser una entrada más.

**Se pinta en dos sitios según el layout**, y está dicho a propósito: en la
tarjeta de la columna izquierda cuando hay columna (tablero 1) y en la banda a
todo lo ancho cuando no la hay (la rejilla y la semana). Dos pinturas del mismo
aviso es menos malo que un aviso que desaparece al cambiar de layout. El gancho
del botón es el mismo en los dos.

---

## 7 · Los arreglos de la pasada que viven aquí

### H8 · tocar un hueco ya no borra la paciente

**Qué pasaba** (captura 29b): tras «Dársela ahora», tocar una hora en la rejilla
reabría «Nueva cita» **en blanco**. Eran dos superficies: la banda ponía un
borrador y el toque en la rejilla creaba otro desde cero (`setDraft({clientId:
null, …})`).

**Qué se ha hecho.** `openSlotFirst` escribe LA HORA (y la profesional de esa
columna) en el borrador que haya, y sólo abre uno nuevo si no hay ninguno. Que
es además lo que convierte el camino en un toque. Tres tests y un sabotaje.

### H6 · la cita de otro día no habla en presente

**Qué pasaba** (paso 10): con la cita del jueves abierta desde la agenda del
martes, la pantalla ponía «Sesión en curso», decía «Hoy toca…» y dejaba teclear
el dolor, que la gráfica pintaba como el punto de hoy.

**Qué se ha hecho.** Lo decide el SERVIDOR, con la misma función que rechaza el
cierre (`dia.esHoy`):

- la chapa dice **«Sólo se puede mirar»**;
- el pendiente sigue a la vista —es lo que la sanitaria necesita leer antes de
  la visita— pero dice **«Pendiente:»** y **no se deja marcar**: marcarlo
  apuntaría en la sesión del jueves algo que se hizo (o no) el martes;
- **no se puede anotar el dolor**, y se dice dónde se anota.

La franja de clinica-9 (4) sigue explicando por qué, y el botón de cerrar sigue
apagado.

### Volver al día en el que se estaba

`lib/dia-de-la-agenda.ts` (clinica-9, 12) ya cubría la vuelta de la tablet, que
es la única navegación que se lleva el estado de React por delante. Lo que este
bloque añade es quitar el movimiento que SOBRABA:

- **«Dársela» ya no mueve la agenda al día propuesto.** clinica-9 la movía
  porque «Buscar hueco» buscaba sobre el día visible; el panel de agenda-1 lleva
  su propia ventana. Moverla tenía un precio: cerrar el panel dejaba a la
  recepción en el 24 de noviembre, con la agenda de hoy a seis toques de flecha;
- **al reservar sí se va al día de la cita.** «Dársela» y «Otra fecha» pueden
  reservar en un día que no es el que se ve, y hasta aquí la cita se guardaba y
  no se veía en ninguna parte. Es además la confirmación más barata que hay: se
  ve en su hueco.

---

## 8 · Lo cobrado de cada cita (API)

La fila dice «Cobrada · 25 €» y la columna izquierda «58 € cobrado». Sale del
**TICKET** y no del catálogo: sumar el precio de los servicios RESERVADOS es
cobrar la previsión en vez del trabajo, que es justo lo que clinica-8 cerró.

`apps/api/src/agenda/cobrado.ts` → `cobradoPorCita: Record<id, céntimos>` en
`GET /agenda`. Cuenta los cuatro estados en los que el dinero ya entró (`PAID`
y los tres de la subida a Holded: que un envío falle no devuelve el dinero) y
deja fuera `DRAFT` (eso es lo que `sesionesPorCobrar` cuenta como PENDIENTE),
`VOIDED`, `ON_CREDIT` (entregado y no cobrado) y `TEST`.

Céntimos enteros y no un decimal: el total es `Decimal(12,4)`, y un `number` con
decimales que viaja por JSON y se suma en el front es cómo se consigue
«57,999999 €» en una tarjeta.

**No viaja en la caché offline**, como sus cuatro vecinas y por la razón del
dinero: una cifra vieja de «cobrado hoy» sobre un día que ha seguido cobrando es
un número que parece bueno y no lo es. Sin red la fila dice «Hecha» y la tarjeta
enseña «—», nunca «0 €». Hay test.

Y **no sale del arqueo del turno**: el arqueo es del turno ABIERTO y esta cifra
es de un día que puede ser el martes pasado; además el arqueo incluye la venta
suelta, que no es de ninguna cita.

---

## 9 · Decisiones tomadas sin preguntar

1. **«Lo propuso Rosario» no se dice, porque nadie lo propuso.** El diseño
   enseña un chip «Control de pie de riesgo · Lo propuso Rosario · 20 min». La
   propuesta que la sanitaria deja al cerrar la sesión son SEMANAS
   (`S2`/`S4`/`S8`), **no un servicio**: ponerle su nombre a una suposición
   sería peor que no proponer nada. Lo que sí se sabe es lo que se le HIZO hoy,
   y eso es lo que se ofrece («Lo de hoy»), más «Su último» del historial que el
   CRM ya publica. **Cuando la sesión guarde el servicio propuesto, el chip
   cambia de rótulo y de origen y nada más.**
2. **A una paciente nueva no se le propone una «primera valoración».** Cuál es
   el servicio de primera visita no está en ninguna parte (el catálogo no tiene
   esa marca). En vez de adivinarlo, el paso abre la lista entera y dice que es
   nueva. **Para Matías: si quiere el chip, hace falta marcar un servicio como
   «primera visita» en el catálogo del centro.**
3. **El consentimiento sin firmar no está en «Pendiente de recepción».** El
   diseño lo enseña como tercer pendiente; la respuesta de `GET /agenda` no lo
   trae, y traerlo es una consulta clínica dentro del camino que se pinta
   cincuenta veces al día. Cuando entre, es un `push` más en
   `pendientesDeRecepcion` y una fila más.
4. **Las citas sin profesional asignada entran en la lista.** La rejilla les da
   una columna propia («Sin asignar»); la lista no tiene columnas, y dejarlas
   fuera sería esconder citas del día.
5. **Con «Dar cita» abierto, la columna izquierda se aparta por debajo de
   1536 px.** El panel mide 520; a 1280 eso deja la lista en 380 px con los
   nombres partidos. Lo que hay que leer mientras se da una cita es la lista.
   Nada se pierde: los pendientes están dentro del panel y las cifras vuelven al
   cerrarlo.
6. **Los tests de rejilla que montaban UNA profesional ahora montan dos.** Lo
   que miden —el suelo, el horario, la regla de horas, el tinte, la tarjeta
   offline— es geometría de rejilla, y la rejilla es el día de VARIAS desde D1.
   Las mismas reglas sobre la LISTA tienen banco propio
   (`agenda-1-pantalla.test.tsx`) y la aritmética, el suyo.
7. **`pxPorMinuto` tiene suelo 1,1.** Para que una retícula grande no apriete la
   rejilla más de lo que estaba.

---

## 10 · Tabla de sabotajes

Cada uno visto en rojo, **uno cada vez, fichero entero y sin `-t`**.

### `agenda-1-proponer.test.ts` (14 tests)

| # | Sabotaje | Caen |
|---|---|---|
| A | quitar la regla 1 (los minutos muertos) del comparador | 2 |
| B | `muerto()` cuenta TODO lo que sobra, no sólo lo inservible | 5 |
| C | `pegada()` siempre 0 (sin la regla 2) | 2 |
| D | `fechaPropuesta` ignorada (sin la regla 3) | 1 |
| E | `extras` en todas las propuestas, no sólo en la primera | 1 |
| F | `encajar` esconde el candidato que la forma no sostiene | 1 |
| G | `nombreDelDia` con `new Date(fecha).getDay()` | 2 |

G sólo se ve con el proceso en otra zona, y así se corrió:
`TZ=America/New_York`. En Madrid el sabotaje sale VERDE — que es justo por lo
que la función no usa `Date` local.

### `agenda-1-dia-filas.test.ts` (24 tests)

| # | Sabotaje | Caen |
|---|---|---|
| H | los huecos sin recortar al suelo | 3 |
| I | sin la línea de cerrado de ENTRE dos tramos | 1 |
| J | las ausencias cuentan como hueco libre | 1 |
| K | `queCabe` ordena del más corto al más largo | 1 |
| L | `cifrasDelDia` cuenta los minutos desde que ABRE | 2 |
| M | `lunesDeLaSemana` sin el caso del domingo | 1 |
| N | `resumenDeDia` sin «casi libre» | 1 |

El fichero entero corre además en verde con `TZ=America/New_York`.

### `agenda-1-pantalla.test.tsx` (28 tests)

| # | Sabotaje | Caen |
|---|---|---|
| 1 | `unaSola = null` siempre (nunca hay lista) | 13 |
| 2 | `unaSola = columns[0]` siempre (nunca hay rejilla) | 3 |
| 3 | `openSlotFirst` crea un borrador nuevo — **H8 de vuelta** | 3 |
| 4 | `atenderPendiente` sin `serviceIds` | 4 |
| 5 | `atenderPendiente` sin `propuesta` | 2 |
| 6 | `proponer()` sustituido por los candidatos tal cual | 1 |
| 7 | los huecos de la lista sin `onHueco` | 2 |
| 8 | las cifras del día con `sueloMin: null` | 1 |
| 9 | `libreHastaLas` devuelve `null` siempre | 2 |
| 10 | `queHaceAhora` devuelve `null` siempre | 1 |
| 11 | la ventana por defecto no se pone sola | 4 |

### `agenda-1-cita-de-otro-dia.test.tsx` (6 tests) · H6

| # | Sabotaje | Caen |
|---|---|---|
| 1 | `citaEsDeHoy = true` fijo | 2 |
| 2 | `citaEsDeHoy = false` fijo | 2 |
| 3 | quitar `esDeHoy` de `<BandaDeHoyToca>` | 1 |
| 4 | quitar `esDeHoy` de `<ComunDeLaSesion>` | 1 |
| 5 | la chapa siempre «Sesión en curso» | 1 |
| 6 | quitar la franja de clinica-9 (4) | 1 |

Ninguno se solapa: la chapa y la franja leen `vista.dia` por su cuenta, que es
lo que se quiere — tres lecturas del MISMO dato del servidor y ninguna de un
cálculo propio.

### Lo que NO tiene sabotaje, y se dice

El guardia del punto de hoy en la gráfica de dolor
(`hoy={citaEsDeHoy ? dolor : null}`). Hoy es **inalcanzable**: `setDolor` sólo
lo llama la escala, que fuera del día no se pinta, y «Igual que la última vez»
no toca el dolor. Se deja porque `dolor` es un `useState` que cualquier control
futuro puede escribir y el guardia no cuesta nada; pero **no está cerrando nada
que hoy se pueda abrir**.

---

## 11 · Capturas

A **1280×800** (la Lenovo apaisada), hechas de verdad sobre la pantalla real
con el banco visual (`?screen=agenda&centro=clinica&at=10:40`), y puestas **al
lado del diseño** en `docs/mockups/agenda-nueva/`:

| Tablero | Diseño | Hecho |
|---|---|---|
| 1 · día de una profesional | `1-dia-una-profesional.dc.html` | `1-dia-una-profesional.hecho.png` |
| 2 · semana | `2-semana.dc.html` | `2-semana.hecho.png` |
| 3 · dar cita | `3-dar-cita.dc.html` | `3-dar-cita.hecho.png` |
| 4 · día de varias | `4-dia-varias-profesionales.dc.html` | `4-dia-varias-profesionales.hecho.png` |

(También en `docs/blocks/agenda-1-shots/`.)

**Las tres cifras del tablero 1 salen clavadas con el diseño**: 7 citas · 3
hechas, 58 € cobrado, 20 min libres. No está amañado — los 58 € son la suma de
los tres tickets del día y los 20 minutos, lo que queda libre desde el suelo.

**El bucle visual encontró cuatro cosas que ningún test veía:**

1. **las filas de la lista se pisaban** con el panel abierto: son hijas de un
   `flex-col` con `overflow-y-auto` y se comprimían por debajo de su contenido.
   `shrink-0`;
2. **tres columnas dejaban 600 px en blanco** a la derecha: el carril era
   `min-w-max` con columnas de ancho fijo;
3. **un comentario `//` suelto dentro de un fragmento JSX** se pintaba como
   texto en la rejilla (lo dejó una cirugía sobre el `return`);
4. **el panel a 520 px + la columna izquierda a 380 no caben** en 1280 — de ahí
   la decisión 5 de §9.

---

## 12 · El banco visual

`?centro=clinica` cambia el centro entero: UNA profesional (Rosario), el
catálogo de podología y el día del tablero 1. Es lo que hace falta para
fotografiar D1 sin un segundo banco — el mismo `AgendaPage` con otros datos. Con
`?at=10:40`, Antonia está en sala y quedan los dos huecos del diseño.

El `/agenda` del banco pasó de la tabla de rutas al despachador, porque la
semana y las «Mejores horas» piden un RANGO (`from`+`to`) y la respuesta depende
de él. Y hay `POST /agenda/appointments`: con un `{}` el panel se cerraba y la
pantalla reventaba al mirar el día de la cita.

---

## 13 · Verde

- **Suite entera desde la raíz**: `pnpm vitest run` → **478 ficheros, 6968
  tests, 10 saltados, 0 rojos.**
- **`tsc` paquete a paquete**: `apps/tpv-web` y `apps/api`, los dos limpios.
- Los dos ficheros puros, además, con `TZ=America/New_York`.

### Lo que se tocó de bancos existentes, y por qué

| Fichero | Qué cambia |
|---|---|
| `agenda-horario.test.tsx` | dos profesionales (mide la rejilla); la escala se importa; «Dar cita» en vez de «Nueva cita»; «¿Cuándo?» en vez de «Buscar hueco» |
| `agenda-suelo.test.tsx` | dos profesionales; la escala se importa; el resumen del pie |
| `agenda-offline.test.tsx` | dos profesionales; el alto de la tarjeta sale de `pxPorMinuto` |
| `agenda-mostrador.test.tsx` | dos profesionales; `irAlDia` por las flechas; el pie nuevo; F4 reescrito sobre la superficie nueva; la navegación a tres semanas por la Semana |
| `clinica-8-agenda.test.tsx` | la flecha en vez del chip; la tarjeta de pendientes; «Dársela» ya no mueve el día |
| `clinica-8b-agenda.test.tsx` | «Dar cita»; «¿Cuándo?»; con UNA profesional ya no hay columna, hay lista |

Ninguno pierde lo que medía: lo que era de la rejilla se sigue midiendo en la
rejilla, y lo que es de la lista tiene banco nuevo.

---

## 14 · Al desplegar

**APK nueva: este bloque cambia el front de la app.** Y también el servidor,
pero el orden no importa:

- **El APK contra un servidor viejo** funciona: `cobradoPorCita` es opcional y
  ausente se lee como «no se sabe» — la fila dice «Hecha» y la tarjeta «—», que
  es exactamente el comportamiento sin red.
- **Un APK viejo contra el servidor nuevo** también: `cobradoPorCita` es una
  clave más que nadie lee.

La migración de BD es **ninguna**: `cobrado.ts` sólo lee `appointments` y
`tickets`.

Qué mirar en hierro, en este orden:

1. la agenda de Rosario abre en **lista** y las tres cifras cuadran con el día;
2. «Dársela» abre el panel con todo puesto y la cita entra en **dos toques**;
3. tocar un hueco con el panel abierto **no pierde la paciente** (H8);
4. la cita del jueves abierta el martes **no deja anotar el dolor** (H6);
5. la peluquería (si hay una a mano) sigue abriendo en **rejilla**, y las
   tarjetas de 15 minutos ahora se tocan.

---

## 15 · Lo que este bloque NO cubre

- **PIN elegible (H4).** Su propio bloque. Sigue sin hacerse y Matías lo olvidó
  dos veces en la misma mañana.
- **H5** (el servicio reservado no llega al cobro), **H1**, **H2**, **H3**,
  **H9**, **H10** y los dos fallos del guion (33 y 38): son de clinica-10.
- **Reserva online**, y las sugerencias de venta y el cheque regalo del spa:
  preparados en `proponer()` como configuración del centro, sin pantalla.
- **La pasada en hierro.** La hace Matías con Claude en la Lenovo, junto con
  clinica-10.
