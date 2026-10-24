# Bloque residencia-cuadro-de-control · done

**«Hay demasiadas opciones, no parece un cuadro de control.»** Lo dijo Matías el 23-10-2026, el día
que Jardín de Gredos —la primera residencia real— se encendió en producción y vio el panel de
Carmen.

Lo que había era: **unas dieciocho entradas en el menú** (Tiendas, Agenda · Catálogo, Agenda ·
Horario, Edificio, Turnos, Controles, Plantillas, Guardia, Personal, Indicadores, Contrato de datos,
Mi cuenta, Seguridad, Ajustes…), de las que quince se tocan el día del alta y el día que algo cambia;
y **un panel que era una columna estrecha y larga** —`max-w-3xl`, siete secciones una debajo de
otra— donde lo urgente competía con veinte líneas de obligaciones a sesenta días y había que bajar
tres veces para saber si había algo que atender.

Una peluquería entra en el panel una vez al mes. La dirección de una residencia **vive** en él.

Este bloque deja el menú con **las cinco cosas del día a día** y pone lo demás detrás de
«Configuración»; y convierte el panel en **un cuadro de control que cabe en una pantalla de
1366×768 sin scroll**. Mockup validado por Matías el 23-10 para probarlo en uso:
`docs/mockups/residencia-cuadro-de-control.html`.

**Comercios, clínicas, bares y colegios no notan nada.** Todo se aplica sólo con `residencia`
encendida, y el banco lo fija entrada por entrada (§6).

---

## 1 · El menú de una residencia: cinco entradas y «Configuración»

`apps/admin/src/AdminShell.tsx`.

```
Panel · Residentes (12) · Incidencias (4) · Relevos (2) · Obligaciones (1)
                                                            ⋮
                                                      Configuración
```

### `NAV_ITEMS` sigue siendo el ÚNICO registro

El menú de una residencia **no es una segunda lista**: es una **proyección** de la de siempre.

- `entradasPermitidas()` es el filtro de hotfix-menu-capabilities, movido fuera de `NavList` y sin
  tocar una línea de su lógica: rol, impersonación y `capabilidadActiva` (el `switch` exhaustivo que
  no compila si falta una rama).
- `entradasDelMenu()` proyecta sobre lo que ese filtro ya dejó pasar: fuera de una residencia
  devuelve **exactamente lo de siempre**; dentro, las cinco de `MENU_DE_RESIDENCIA` en su orden y
  `Configuración` al final.
- `entradasDeConfiguracion()` devuelve **todo lo demás que pasa el filtro**, en el orden de
  `ORDEN_EN_CONFIGURACION` y lo no nombrado detrás.

Que el registro sea uno es lo que mantiene la garantía del hotfix (una entrada gateada no se puede
colar) y lo que hace que **las rutas no cambien**: cada tarjeta de «Configuración» es un `Link` al
mismo `to`, un marcador de `/admin/residencia/turnos` sigue funcionando, y una cuenta sin la clínica
tampoco ve «Contrato de datos» aquí.

### El orden es el de la mañana de la directora

Panel (qué hay), Residentes (quién vive aquí), y luego las tres cosas que se cierran: lo que ha
pasado, la firma que falta y el papel que vence.

### `FUERA_EN_RESIDENCIA` es la única forma de desaparecer

**Se probó una bandera `enConfiguracion` por línea y se descartó dentro de este mismo bloque.** La
primera sección a la que se le olvidara la bandera se quedaba sin forma de llegar, en verde y sin que
nadie lo notara. Lo encontró el banco con **«Bonos»**, que es justo una entrada que nadie pensaría en
marcar.

Así que al revés: **dentro de «Configuración» está todo lo que pasa el filtro y no es una de las
cinco**, y esconder algo cuesta escribirlo en una lista de dos elementos que se lee de un golpe. Hoy
sólo las dos pantallas de agenda (decisión 3): la capability `agenda` sigue ENCENDIDA en un centro de
residencia —la exige la clínica, y de ella cuelga «Personal», que sí está en Configuración— pero el
catálogo de citas y el horario de atención son de un centro que da citas, y una residencia tiene
residentes que viven dentro.

Y hay un test que lo guarda: **toda entrada que pase el filtro está en el menú, en «Configuración» o
nombrada en esa lista.** Con TODAS las capabilities encendidas, que es el peor caso. Encontró tres
huérfanas de verdad (§7).

### Lo que sale del marco de una residencia (decisión 3)

| Qué | Por qué |
|---|---|
| La marca del TPV arriba | En su lugar, el nombre del centro y «Residencia · N plazas» |
| La banda de «cuenta en ensayo» | Habla de vender, cobrar, devolver, arquear y de Hacienda |
| «Declaración responsable» del pie | Es del art. 15 de Verifactu: un centro sin caja no factura |
| Agenda · Catálogo y Agenda · Horario | Una residencia no da citas |

La banda del ensayo ya estaba gateada por `caja` (primer-acceso, que tapaba a Jardín de Gredos);
ahora **también se calla en la residencia que SÍ tenga caja**: una cafetería para visitas no
convierte el panel de dirección en el panel de un bar. La declaración vuelve a salir si hay caja.

### Los contadores

Cuatro de las cinco entradas llevan su número, y **rojo si hay algo grave o vencido, ámbar si no**
(`contadorDelMenu` en `residencia-panel.ts`):

| Entrada | Cifra | Rojo cuando |
|---|---|---|
| Residentes | fichas incompletas | alguna tiene algo imprescindible |
| Incidencias | abiertas | hay alguna N3 o N4 |
| Relevos | sin confirmar | nunca (una firma que falta no es un residente en el hospital) |
| Obligaciones | **vencidas**, o las de hoy si no hay ninguna vencida | hay alguna vencida |

Lo vencido manda y no se suma con lo de hoy: sumarlas daría un número que no baja nunca a cero —hoy
siempre toca algo— y esconder lo vencido detrás de la suma es lo contrario de lo que esto existe para
conseguir. Un contador siempre rojo deja de significar nada.

**Con todo a cero no hay contadores.** Un menú tranquilo es un menú sin números: cinco ceros en la
barra lateral enseñan a no mirarla.

**Accesibilidad:** el número va `aria-hidden` y el `aria-label` lleva la frase entera — «4
incidencias abiertas». Un `4` suelto no dice de qué.

---

## 2 · Una sola petición para la barra y para la pantalla

`apps/admin/src/residencia-panel.ts`, nuevo.

El bloque pide que los contadores sean «el mismo número que el panel, **de la misma petición**». Con
dos consultas distintas —una ruta de contadores y el panel— el día que una de las dos cambie de
criterio el menú dirá 4 y la pantalla 3, y nadie sabrá cuál miente.

Mismo mecanismo que `capabilities.ts` y por la misma razón (la pantalla es el PADRE de su propio
`AdminShell`, así que un contexto no llega al revés): caché de módulo, petición en vuelo compartida,
`useSyncExternalStore`. El banco cuenta las llamadas y exige **una**.

- **Sólo donde hay residencia.** El hook recibe `activo`; en un comercio no se pide nada (la ruta
  contesta 404). El banco también lo fija.
- **La caché se tira al quedarse sin nadie mirando**, igual que las capacidades: sin eso un `logout`
  + `login` con otro centro heredaría los contadores del anterior.
- `recargarPanel()` lo usa la pantalla al tachar una obligación: la casilla se pone verde y **el
  contador del menú baja a la vez**.
- **Un panel con otra forma deja el menú sin contadores, no sin menú.** Todas las lecturas van con
  `?.`: este menú se pinta en TODAS las pantallas de una residencia, y una respuesta rara durante un
  despliegue no puede dejar a la directora sin barra lateral. Lo cazó el banco de
  hotfix-menu-capabilities, cuyo servidor de prueba contesta cualquier cosa.

### El coste, dicho

El panel es la consulta más cara de la casa y ahora **se pide en todas las pantallas de una
residencia**, no sólo en el panel. Es lo que el bloque pide explícitamente, y se asume con los ojos
abiertos: en Jardín de Gredos son ~20 consultas por índice de tenant y el presupuesto de residencia-5
(≤ 10 s) se cumple de sobra. Queda en las dudas abiertas (§9) por si con un centro de 120 plazas hay
que partirlo.

---

## 3 · Lo que el panel trajo de más en la API

`apps/api/src/residencia/panel.ts`. **Nada nuevo fuera de `panel.ts`, y sigue siendo UNA llamada**:
todo entra en el mismo `Promise.all` y nada recorre el plan dos veces.

| Campo | Qué es |
|---|---|
| `centro.nombre` | El del tenant. Es el rótulo de la barra |
| `centro.plazas` | Las camas **activas**. Las plazas son las camas: no hay una columna que pueda discrepar del Edificio |
| `centro.dentro` | Residentes con cama vigente |
| `centro.fuera` | **`null`**, no `0` — ver abajo |
| `yo.nombre` | Alias (o el trozo de delante del correo), para el saludo |
| `turno.turno.empiezaEn` / `.terminaEn` | Las dos «HH:MM», para «turno de mañana, **hasta las 15:00**» |
| `abierto.noPuedeEsperar` | Las **cuatro** abiertas más graves, una fila cada una |

**`fuera` es `null` y no `0`.** Hoy no hay ninguna tabla que diga que doña Carmen está en el
hospital, así que un `0` **afirmaría** que no hay nadie fuera, y eso no se sabe. La pantalla lo lee
como «no lo enseñes» y deja sólo el total, que es lo que el bloque pide («ausencias, cuando existan;
mientras no, sólo el total»).

**`noPuedeEsperar` no trae descripción.** No se pide `description_cifrado`, así que no se descifra: el
título de la fila es el **tipo** (`NOMBRE_DEL_TIPO`, el mismo mapa que el libro, la guardia y el
parte) y la habitación, igual que la lista del libro y por la misma razón.

**Y manda hechos, no frases.** `sinConstanciaDeFamilia`, `esperaCierreDeOtro`, `avisosSinAcuse`: la
línea de estado la compone la pantalla, como ya hace con `GET /residencia/incidencias`. Mezclar las
dos formas dejaría dos sitios donde se decide cómo se lee una incidencia.

---

## 4 · El panel, por delante

`apps/admin/src/pages/residencia/PanelPage.tsx`, reescrito.

```
Buenos días, Carmen                              41 residentes en el centro
Sábado, 24 de octubre · turno de mañana, hasta las 15:00

[Incidencias 6]  [Relevos 2]  [Obligaciones 1]  [Fichas 3]      ← cada una se abre

┌ Ahora · turno de mañana · 12:15 ────────┐  ┌ Hoy ──── Ver obligaciones ┐
│ Primera  ▰▰▰▰▰▱▱  20 de 34              │  │ ☐ Revisión de extintores  │
│ Segunda  ▰▰▰▰▱▱▱  11 de 17              │  │ ☐ Registros APPCC         │
│ LO QUE NO PUEDE ESPERAR      Ver las 6  │  │ RELEVOS                   │
│ N3 Caída · hab. 112          10:40      │  │ Noche del 23  [Abrir]     │
└─────────────────────────────────────────┘  └───────────────────────────┘
┌ Octubre · 4 de 5 fuera de objetivo ───────────────── Ver indicadores ───┐
└─────────────────────────────────────────────────────────────────────────┘
```

- `ancho="completo"` (prop nueva de `AdminShell`): el panel usa todo el ancho. `"normal"` sigue
  siendo la columna de siempre, que es la correcta para un formulario.
- **«Vence en los próximos 60 días» se va a Obligaciones.** A sesenta días no es de hoy, y era la
  sección que más alargaba la página.
- **El panel tranquilo:** con todo a cero, una línea verde —«Nada abierto. Todo al día.»— en lugar de
  las cuatro tarjetas. Cuatro números grandes con un cero son cuatro avisos de que no pasa nada, y
  quien abre el panel los lee antes de leer que son ceros. Las cuatro secciones siguen a un toque
  desde el menú: no esconde nada, quita la alarma falsa.
- **`primer-acceso` está en master y su tarjeta vive aquí dentro**: con el centro sin un solo
  residente, el panel sigue siendo la tarjeta «Empieza dando de alta a tus residentes» y nada más. Y
  sigue DETRÁS del «esto es de dirección», para que un encargado sin rol directivo no vea una
  invitación a dar de alta residentes.

### «Hoy» tacha desde aquí, salvo si hay que adjuntar

La casilla llama a `POST /residencia/ocurrencias/:id/hecha` —la ruta que ya existía— y recarga el
panel compartido.

**No hay ninguna columna que diga «pide evidencia».** `ManagementDuty` tiene familia, periodicidad,
consecuencia y responsable; la evidencia es un adjunto opcional de la ocurrencia. Así que el proxy es
la **consecuencia `LEGAL`**, y es el proxy honesto: una obligación legal es la revisión de
extintores, la desinfección, la inspección — las que dejan un certificado que alguien va a pedir
dentro de dos años, y tacharlas sin el papel es dejar media evidencia. Las ISO y las internas se
tachan aquí, que es el caso de todos los días. Queda en las dudas abiertas (§9).

### residencia-5 y residencia-6, recolocados y no perdidos

| Qué | Antes | Ahora |
|---|---|---|
| El último relevo con quién lo recibió | Tarjeta grande | **Una línea**, y sólo cuando ya está firmado |
| «Lo que hay que arreglar» (PIN, residentes sin plan) | Sección con dos tarjetas | **Banda de una o dos líneas**, arriba y sólo cuando hay algo |
| Los cinco recuentos por nivel (N4…N0) | Cinco tarjetas | El recuento de **graves** dentro de la cifra de incidencias, y el ORDEN de «lo que no puede esperar» |
| «Sin dato este mes» (residencia-5) | Texto en la ficha | **«—»** en la ficha de 167 px, y la frase entera en el `title` y en el lector de pantalla |
| La lista de nombres de fichas incompletas (alta-minima) | Cinco nombres con su enlace | **Se va**: la pasada se hace en Residentes, y «Completar» sigue abriendo la primera |
| La consecuencia de alta-minima | Cuatro renglones | **Una línea**: «3 sin DNI, grado o familiar — sin grado no se factura a la Junta» |

---

## 5 · El presupuesto de una pantalla, medido

`1366×768` menos la cabecera del admin (72 px) = **696 px**. Lo medido con Jardín de Gredos:

```
contenido 682 px · disponible 696 px · holgura 14 px
secciones [cabecera 49 · cifras 112 · Ahora/Hoy 342 · El mes 116]
```

La primera pasada daba **1010 px**: 242 de más. Lo que lo bajó, y **por qué las dos secciones más
grandes ya no pueden crecer con los datos**:

- **La tarjeta de una cifra tiene alto fijo** (`lg:h-[112px] lg:overflow-hidden`). Son cuatro en una
  fila y la fila mide lo que la más alta: un detalle de tres renglones en UNA se los cobraba a las
  cuatro, y lo que se caía por abajo era «Hoy». En la mano el alto es libre: ahí son dos filas de
  dos, la pantalla ya hace scroll, y recortar sólo serviría para partir «no se factura a la Junta» a
  media frase (lo vio el bucle visual a 390).
- **La ficha de un indicador también** (`h-[62px]`). Una sola con el nombre largo y «Sin dato este
  mes» a dos renglones subía las seis de 62 px a **97**.
- **Topes:** 4 incidencias (el bloque permite «4-5»; cinco no cabían), 5 obligaciones (permite
  «5-6»), 2 relevos. «Ahora» y «Hoy» son dos columnas de la misma fila, así que la fila mide lo que
  la más alta y los topes de las dos tienen que cuadrar.
- **Las plantas pasan a dos columnas a partir de cuatro.** Un centro de cinco se comía 78 px en una
  lista de una columna; a dos, cinco plantas cuestan lo que tres.

**Lo que queda fuera del presupuesto, dicho:** un centro que a la vez tenga más de seis plantas y los
tres topes llenos se saldrá por abajo unos píxeles. Los 14 px de holgura son los de Jardín de Gredos,
no una garantía para cualquier centro.

---

## 6 · Las pruebas

**`apps/admin/test/residencia-cuadro-de-control.test.tsx`** (29 tests), el banco del bloque:

1. El menú de una residencia es **exactamente** `[panel, residentes, incidencias, relevos,
   obligaciones, configuración]` — se compara la lista entera, no «contiene».
2. Y las de antes no están: Edificio, Turnos, Controles, Plantillas, Guardia, Indicadores, Tiendas,
   Personal, agenda, Mi cuenta, Seguridad, Ajustes.
3. **El de un comercio no cambia**: sigue con Tiendas, Mi cuenta, Seguridad, Ajustes, Dispositivos,
   Cajeros y las dos de agenda; **no** ve «Configuración»; se llama «Tiendas» y no «Centro»; conserva
   su declaración responsable; y **no se le pide el panel ni una vez**.
4. Arriba va el centro y sus plazas y **no la marca del TPV** — comprobado por `data-test`, no por
   texto: el pie imprime «mipiacetpv v1.0», que es la versión y sí se queda, así que un canario de
   subcadena pasaba en verde sin mirar nada.
5. La banda del ensayo no sale aunque la cuenta esté en ensayo; la declaración responsable tampoco.
6. **Ninguna pantalla sin puerta** (§7).
7. Los contadores son los números del panel, **en una sola petición**; con su `aria-label`; rojo lo
   grave y lo vencido; sin números con todo a cero; y el menú sigue en pie con un panel deforme o con
   un 403.
8. El panel: la cabecera, las cuatro cifras y a dónde abren, el detalle de graves, el estado de cada
   incidencia en su fila, lo vencido delante, tachar desde la casilla, la casilla LEGAL que abre la
   obligación, y que «próximos 60 días» ya no está.
9. **El panel con 0 de todo**: «Nada abierto. Todo al día.», y ninguna de las cuatro tarjetas.

**Bancos que fijaban la maqueta vieja**, corregidos con su porqué escrito dentro:

- `residencia-5-pantallas.test.tsx`: el orden por gravedad es ahora el de «lo que no puede esperar»;
  los destinos de las cuatro cifras; el estado en la fila; el relevo sin confirmar con «Abrir»; el
  último firmado con quién lo recibió; lo vencido con sus días. El `PANEL` de prueba gana los campos
  nuevos.
- `alta-minima-pantallas.test.tsx`: la tarjeta es ahora la cuarta cifra. Sobrevive la cifra, «de 43»,
  los datos pendientes, «Completar» y la consecuencia; se va la lista de nombres, y hay un test que
  **afirma su ausencia con canarios que no existen en el resto de la pantalla**.
- `primer-acceso-pantallas.test.tsx`: «el panel de siempre» es ahora el cuadro de control.
- `hotfix-menu-capabilities.test.tsx`: **el recorrido pasa a `entradasDelMenu` + `entradasDeConfiguracion`
  en vez de los `href` pintados.** La garantía que fija es la misma —cada capability deja pasar sus
  entradas y sólo las suyas—; que de ahí salga un menú de cinco o de dieciocho lo fija el banco del
  cuadro de control, que es su sitio. Los dos tests que miran el menú PINTADO se hacen ahora sobre un
  comercio, que es la cuenta en la que se vio el fallo.

**`apps/api/test-e2e/residencia-5.e2e.ts`**: un test nuevo pegado al de «las cinco preguntas» — el
centro, sus plazas, `fuera` a `null`, quién mira, las horas del turno, `noPuedeEsperar` acotado,
ordenado por gravedad, sin descripción, y la caída de Carmen con sus dos banderas.

Verde: **6671 tests unitarios** (459 ficheros) y **1148 e2e** (50 ficheros).

---

## 7 · Lo que encontró el banco y el bucle visual (y no una suite)

1. **Tres pantallas sin puerta.** Con `fichaje` encendido, «Control horario», «Empleados» y «Registro
   de jornada» no estaban ni en el menú ni en Configuración. Una residencia con control horario del
   personal es exactamente el cliente que viene detrás. Lo encontró el test de §6.6 — y es lo que
   llevó a invertir la regla de pertenencia (§1).
2. **«Bonos» igual**, lo que mató la bandera `enConfiguracion`.
3. **El menú se caía con un panel deforme.** `panel.abierto.total` sobre una respuesta sin `abierto`
   lanzaba, y el menú se pinta en todas las pantallas: la directora se habría quedado sin barra
   lateral durante un despliegue a medias.
4. **Las casillas de «Hoy» medían 20×20**, por debajo del suelo táctil de 36 px del admin. Ahora el
   cuadro que se VE mide 20 y lo que se PULSA mide 36, con márgenes negativos para que la fila no
   crezca — sin ellos, seis obligaciones costaban 96 px y el panel dejaba de caber.
5. **A 390 el panel se salía por la derecha y el texto se cortaba a media palabra.** Un hijo de grid
   no baja de su `min-content` si no se le dice (`min-w-0`), y el `<main>` del shell lleva
   `overflow-y-auto`, que **recorta** el eje X en vez de hacerlo scrollable: la página decía 390/390
   tan contenta. Se arregló, y el bucle visual **mide ahora también el ancho**, buscando el primer
   elemento que se sale cuyo padre no — porque `scrollWidth` ahí no sirve.
6. **«Ver las 10» encima de «No hay ninguna incidencia abierta».** Con un panel de una API anterior
   (sin `noPuedeEsperar`), lista vacía y total 10 se contradecían. Vacío no es lo mismo que ausente:
   ahora dice lo que sí se sabe.
7. **`line-clamp-2` de Tailwind no recortaba** la etiqueta de un indicador en el servidor de
   desarrollo. Se pasó a un alto fijo con el clamp en estilo en línea, que además hace la ficha
   independiente de los datos.
8. **«1 indicadores dentro de objetivo».**

---

## 8 · Decisiones tomadas sin preguntar

1. **`consequence === "LEGAL"` como «pide evidencia»** (§4). No hay columna.
2. **4 incidencias, 5 obligaciones, 2 relevos** (§5). El bloque da rangos; se tomó el extremo que
   cabe.
3. **La lista de nombres sale de la cifra de fichas**, y la consecuencia de alta-minima se queda en
   una línea. El bloque pide «fichas incompletas (de alta-minima, con "Completar")», que es una
   tarjeta de cuatro, no la de quince renglones.
4. **El último relevo firmado se queda, en una línea.** El mockup lo enseña y es la evidencia que la
   dirección busca cuando algo sale mal; reducirlo a nada habría perdido una garantía de
   residencia-5 sin que el bloque lo pidiera.
5. **«Lo que hay que arreglar» (residencia-6) pasa a banda.** El bloque no lo nombra; borrarlo habría
   escondido que un PIN no abre nada.
6. **La banda del ensayo también se calla en una residencia CON caja** (§1).
7. **«Configuración» va a todo el ancho**, tres columnas: en la columna estrecha dejaba media
   pantalla en blanco y seis filas de alto.
8. **`centro.fuera` es `null`** y no `0` (§3).
9. **Se añadió `data-test="marca-tpv"` al `Logo`** para poder afirmar su ausencia sin canarios de
   subcadena.

---

## 9 · Dudas abiertas

1. **El panel se pide en todas las pantallas de una residencia** (§2). En Jardín de Gredos no se nota.
   Con 120 plazas puede que haya que partir los contadores a una consulta ligera — y entonces hará
   falta un test que compruebe que los dos números siguen cuadrando, que es lo que hoy regala la
   petición única.
2. **«Pide evidencia» no existe como dato.** Si Carmen echa de menos tachar una legal desde el panel,
   lo que falta es la columna, no el botón.
3. **El panel de roles que no son dirección** (la DUE, calidad) sigue fuera de alcance: se valora
   cuando Carmen use éste.
4. **Las ausencias.** El día que existan, `centro.fuera` deja de ser `null` y la cabecera enseña «2
   fuera (hospital, familia)» sin tocar la pantalla.
5. **Los 14 px de holgura** son los de un centro de dos plantas (§5).

---

## 10 · Qué hay que hacer al desplegar

**Nada.** Sin migración, sin variables nuevas y sin cambios de ruta. El panel admite respuestas de
una API anterior (todo lo nuevo es opcional en el tipo del cliente) y el menú admite un panel que no
llegue.

---

## 11 · Las capturas y lo medido

`docs/qa/2026-10-24-cuadro-de-control/`, junto al mockup. El guion vive en el repo:
`apps/e2e-ui/capturas-cuadro-de-control.ts`, sobre el producto de verdad con Jardín de Gredos
sembrado.

| Captura | Qué enseña |
|---|---|
| `01-panel-1366x768.png` | El cuadro de control entero, **sin scroll** |
| `02-configuracion-1366x768.png` | Las doce secciones de «Configuración» |
| `03-panel-tranquilo-1366x768.png` | «Nada abierto. Todo al día.» y el menú sin números |
| `04-panel-390.png` / `05-panel-390-abajo.png` | En la mano: dos filas de dos, «Ahora» y «Hoy» uno debajo de otro |
| `06-menu-390.png` | El menú plegado, con el centro arriba y «Configuración» abajo |
| `07-configuracion-390.png` | «Configuración» en la mano |

`MEDIDO.txt` lleva lo medido: el alto contra el presupuesto, las entradas del menú con sus
contadores, los objetivos táctiles y lo que se sale por la derecha.

---

## 12 · Estado de la rama

- Rama `residencia-cuadro-de-control`, desde `origin/master`. **Pusheada.**
- **PR contra `master`.** Ni merges ni despliegues.
- CI: `ci`, `smoke`, `e2e`.
