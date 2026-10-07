# Bloque clinica-5 · done

Rama `clinica-5-sesion-por-tipos`, worktree
`~/Developer/Claude/Projects/mipiacetpv-clinica-5`, desde `origin/master` =
`9dd8cf3` (el prompt, los dos mockups validados y las decisiones).

**Este bloque convierte «la sesión» en «la visita».** La de clinica-3
servía para una quiropodia: un mapa, unos tratamientos, un dolor. Rosario
hace cinco clases de visita y a veces dos en la misma, cobra la quiropodia
en tres niveles que elige de memoria, y tiene que acordarse de revisar la
uña que operó hace cuatro semanas.

La frase que resume lo que tiene que ser verdad al terminar: **marca el
tipo, toca lo que hace, y el programa le deja la sesión anotada, le propone
el nivel y el riesgo, le avisa en el momento de lo que choca, no le deja
cerrar sin preguntarle por lo que tocaba hoy, y pasa a caja todas las
líneas.**

---

## 1 · Las funciones puras: siete listas y cuatro reglas

`packages/clinica-sesion` — el paquete de clinica-3, con cinco ficheros
nuevos. Sigue siendo PURO: ni Prisma, ni Fastify, ni React, ni reloj.

| Fichero | Qué decide |
| ------- | ---------- |
| `tipos-de-visita.ts` | Los cinco tipos (lista cerrada), la especialidad que cuelga de cada uno y **las dos negativas de S5** al guardar un servicio. |
| `niveles.ts` | Los seis actos de la quiropodia y la regla `acto → nivel`, como DATO versionado. |
| `riesgo.ts` | La clasificación IWGDF del pie de riesgo, con las cuatro comprobaciones y el plazo de revisión. |
| `bloques.ts` | El vocabulario de los tipos que son una tarjeta de botones: herida, puntos, tipo de pie, pisada. |
| `alertas-cruzadas.ts` | La tabla `alerta × lo que se hace → aviso`. |
| `pendientes.ts` | «Hoy toca» y «Para la próxima visita», sin tabla nueva. |
| `sesion-v2.ts` | El cuerpo v2, la derivación a caja y la normalización del cierre. |

### La regla de niveles es DATO, no un `if`

```ts
minimoPorActo: { corte: 1, durezas: 1, helomas: 2, grietas: 2, fresado: 3, onico: 3 },
nivelPorCantidad: [{ desdeActos: 4, nivel: 3 }],
```

El nivel propuesto es el mayor de los mínimos de lo que se ha tocado, con
un suelo por cantidad. **El umbral se mueve editando una línea**, y el
sabotaje de la tabla lo comprueba desde fuera: con `desdeActos: 5`, los
mismos cuatro actos bajan de extra a completa sin tocar `nivelPropuesto`.

Por qué dato y no `if`: porque la regla **está sin validar** (ver §8) y lo
que Rosario va a querer mover es justo el umbral. Con `if`s, cada cambio es
una rama que hay que volver a probar.

### El riesgo es el de la guía, no el del mockup

El mockup contaba fallos y sumaba (la úlcera valía dos). La guía de verdad
—IWGDF 2023, prevención de úlceras— clasifica con **combinaciones**, y pide
una cuarta comprobación que el mockup no tenía: la **deformidad**.

| Categoría | Cuándo | Plazo |
| --------- | ------ | ----- |
| 0 · muy bajo | ni pérdida de sensibilidad ni pulsos ausentes | anual |
| 1 · bajo | pérdida de sensibilidad **o** pulsos ausentes | 6–12 meses |
| 2 · moderado | las dos, **o** una de ellas + deformidad | 3–6 meses |
| 3 · alto | una de ellas **+** úlcera previa o actual | 1–3 meses |

Dos cosas que la suma de fallos hacía mal y la tabla hace bien, las dos con
su test:

- **la úlcera sola NO es riesgo alto** (sin pérdida ni pulsos ausentes no
  hay categoría 3);
- **la deformidad sola no sube de categoría** — y la tarjeta lo dice, en
  vez de dejar a la podóloga pensando que no se ha guardado.

Los pulsos miran **el peor pie**: lo que se decide es cada cuánto se revisa
a la PERSONA, y a quien tiene el izquierdo sin pulso no se le revisa cada
año porque el derecho esté bien.

Sin las cuatro contestadas no hay veredicto: **`null`, y la tarjeta dice
cuál falta**. Una categoría calculada sobre tres respuestas y un hueco es
un número que parece una medida y no lo es.

### La alerta cruzada se cruza por ID, nunca por texto

La franja roja de clinica-3 dice lo que el paciente TIENE y se lee una vez
al entrar. Esto es otra cosa: el aviso que aparece **en el momento** en que
se marca el acto que choca, y **dentro de la tarjeta que lo dispara**.

La tabla cruza por el `preguntaId` del cuestionario de clinica-2 (`antic`,
`diab`) y no por el texto de la alerta. El texto lo escribe el cuestionario
y se puede reescribir mañana; una alerta que deja de dispararse porque
alguien corrigió una tilde es el peor fallo posible en una señal de
seguridad. El test lo comprueba por el lado contrario: mandar
`"Anticoagulación"` como id **no dispara nada**.

Y los avisos **se guardan en el cuerpo**, no se recalculan al leer la
historia: la pregunta que hay que poder contestar es «¿se le avisó?», y eso
es un hecho de ese día.

### Los pendientes, sin tabla nueva

Lo que el prompt pedía y por qué se puede: *los pendientes viven en el
cuerpo de la sesión que los crea y la que los cierra los nombra.*

Leer «¿qué toca hoy?» es leer `pendientesCreados` de la última sesión
cerrada — **una consulta que la pantalla ya hacía**. Y lo que hace que eso
baste es que **al cerrar, lo que sigue abierto se vuelve a crear**: la
sesión de hoy hereda lo que no se hizo y lo escribe como suyo, conservando
el `desde` original (que es lo que deja decir «apuntado hace 4 semanas»).

La alternativa era una tabla `pendientes` con estado mutable, y entonces la
historia clínica tendría una pieza que SÍ se edita — justo lo que
`clinical_entries` y su trigger existen para impedir.

Se cierra solo al **tocar esa zona** o **valorar esa herida**, o a mano. El
«solo» es literal: una quiropodia no cierra «revisar la uña operada» por el
hecho de ser una quiropodia, y tocar el talón no cierra lo del dedo gordo.

---

## 2 · El cuerpo v2, y por qué el cobro no se enteró

`VERSION_DEL_CUERPO_V2 = 2`. Dentro: `tipos[]`, `bloques` (uno por tipo),
`especialidad` congelada (S5), `avisos`, `pendientesCreados`,
`pendientesCerrados` y las siete versiones de listas nuevas, agrupadas.

**Las sesiones v1 se siguen leyendo igual que hoy.** No hay migración de
datos, no se reescribe nada, y `esCuerpoV2` es la única pregunta que hace
falta hacerse. Una sesión de clinica-3 se enseña con sus tratamientos y sin
tipos, que es lo que era — y `tiposDeLaSesion` devuelve vacío en vez de
fingir.

### `tratamientos` sigue siendo la puerta a caja

Es la decisión que más código ahorra del bloque. El prompt pide las líneas
de **todos** los tipos «con el mismo camino de cobro de siempre, sin rama
paralela». Se consigue así:

> Al cerrar, `serviciosDeLaSesion` resuelve los servicios de todos los
> tipos —para la quiropodia, el producto del **nivel elegido**; para el
> resto, los servicios tocados— y el resultado se **congela** en
> `tratamientos`, la misma clave que leía la v1.

Así que `lineas-de-la-sesion.ts` **no cambió de comportamiento**: sigue
leyendo una lista de ids y no sabe que existen los tipos, ni los niveles,
ni el riesgo. La derivación vive en UNA función pura con su test, y el
cobro lee lo que esa función dejó escrito.

### Lo que la pantalla NO manda

El cuerpo del `POST …/cerrar` lleva los **actos** y las **comprobaciones**.
No lleva el nivel propuesto, ni el producto que cobra, ni la categoría de
riesgo, ni los avisos: **los calcula el servidor** con los mismos datos y
las mismas funciones. Mandarlos habría sido dejar que la pantalla eligiera
qué se cobra y qué riesgo consta en la historia.

Lo mismo con el cierre automático de un pendiente: se recalcula con las
marcas de verdad. Un pendiente cerrado porque «ya lo marqué» sin haber
tocado la zona sería una revisión que consta hecha y no se hizo.

### Lo que SÍ se puede cerrar sin

`resumenDeLaSesion` (v1) no dejaba cerrar sin un tratamiento. **La v2 sí
deja cerrar sin una sola línea de caja**, y es la regla 11: un control de
pie de riesgo al que el centro no le ha puesto servicio es una visita que
PASÓ y que tiene que quedar escrita. No cobrarla es un problema de
catálogo; negarse a registrarla es perder la historia por una casilla.

Lo que sigue siendo obligatorio es lo clínico: **un tipo** (decisión 1) y
**el dolor**.

---

## 3 · Los datos: una sola migración, y por fin

`20261007030000_clinica_5_tipos_de_visita`. **Una**, no dos.

clinica-1, clinica-2 y clinica-3 necesitaron dos cada una, siempre por lo
mismo: Postgres prohíbe USAR un valor de enum en la misma transacción en la
que se añade. Tres veces pagada la misma factura. Aquí el tipo de visita es
`VARCHAR(20)` con CHECK —la decisión que iva-exento-sanitario tomó para la
causa de exención— y no hay enum que partir.

| Pieza | Qué garantiza |
| ----- | ------------- |
| `tag_visit_types` (tenant, slug, visit_type) | El patrón de `TagSection` (S5): la categoría del catálogo apunta a un tipo de la lista cerrada. ÚNICO por (tenant, slug): una categoría, un tipo. |
| `tag_visit_types_tipo_valido` | CHECK con los cinco códigos. Cubre las cuatro puertas de escritura (panel, fichero del super-admin, sync de Holded, psql de una implantación), que un `if` del endpoint no cubre. |
| `service_scheduling.nivel_quiropodia` | «Este servicio ES el nivel N». Es lo que convierte el nivel propuesto en una línea de ticket. Nace NULL y **sin default**. |
| `service_scheduling_nivel_quiropodia_valido` | CHECK 1..3. |
| `service_scheduling_un_servicio_por_nivel` | Índice ÚNICO PARCIAL por (tenant, nivel). Dos servicios que digan ser «quiropodia extra» dejan a la sesión sin saber cuál cobrar — mejor que falle al configurarlo que con la paciente delante. |

**Aditiva**: ni un DROP, ni un TRUNCATE, ni un DELETE, ni un UPDATE de
datos. La tabla nace vacía y la columna NULL, así que ningún servicio de
los quince tenants de hoy es el nivel de nada y ninguna categoría tiene
tipo. No se toca `products` ni `clinical_entries`.

### Por qué hizo falta una columna para el nivel

Decisión 4: «el nivel elegido decide **qué producto** del catálogo pasa a
caja». La categoría dice que los tres son de quiropodia; no dice cuál es
«extra». Lo que NO se hizo es deducirlo del nombre del producto: sería una
regla de negocio escrita en una cadena de texto que la dueña puede
renombrar desde Holded sin enterarse.

Vive en `service_scheduling`, junto a `primeraValoracion` y
`tratamientoSesion`, por la misma razón que ellas: **la podóloga mantiene
UNA pantalla** (Catálogo de agenda) y no dos.

### Las dos negativas de S5, donde nace la mezcla

Se aplican en `PUT /services/:productId/scheduling` y con el valor **que se
va a guardar**, no con el que hay en la fila (si no, marcar la casilla por
primera vez pasaría):

- **dos categorías con tipos distintos** → 409 `DOS_TIPOS`, «Quiropodia y
  Cirugía a la vez: quita una de las dos categorías.»
- **servicio de sesión sin tipo, en centro clínico** → 409
  `SESION_SIN_TIPO`, «Ponle una categoría con tipo de visita…»

Y una tercera, de este bloque: un **nivel en un servicio que no es de
quiropodia** → 409 `NIVEL_SIN_QUIROPODIA`.

No viven en un trigger porque tendrían que mirar el array `products.tags`
cruzado con otra tabla en cada escritura de `products` — o sea, en cada
sync de Holded, y harían fallar el sync por una regla de la agenda. Lo que
sí está en el motor es lo que el motor puede garantizar sin mirar dos
tablas.

---

## 4 · La pantalla

`SesionPodologia.tsx` es el mockup validado, con sus piezas en su orden:
chips de tipo en multiselección (como mínimo uno), banda de «Hoy toca», el
pie fijo a la izquierda con su capa de sensibilidad cuando hay pie de
riesgo, las cinco tarjetas apiladas a la derecha, dolor y evolución, la
barra de caja con el «sin cobro» y el diálogo del pendiente.

Las piezas comunes salieron a `piezas.tsx` porque ahora las usan cinco
tarjetas en tres ficheros, y el peldaño táctil de 48 px de la casa no puede
tener dos copias.

**Nada se calcula dos veces**: el nivel, el riesgo, los avisos, la barra de
caja y el diálogo se pintan con las MISMAS funciones puras que decide el
servidor. Con dos cálculos, la podóloga vería «riesgo moderado» en pantalla
y la historia guardaría «bajo» — en una clasificación que decide cada
cuánto se revisa el pie de un diabético, eso no es una discrepancia de
interfaz.

### Divergencias declaradas con el mockup

1. **La pestaña de exploración de clinica-3 se queda.** El mockup de este
   bloque no la pinta porque habla de la sesión, pero la exploración es la
   pieza que se puede registrar SIN la valoración validada (su razón de
   existir) y quitarla habría sido quitar una pantalla que funciona por un
   mockup que no la menciona.
2. **La capa de sensibilidad de la sesión es de LECTURA.** El mockup pinta
   puntos que se tocan; aquí enseña la última exploración y lo dice
   («para cambiarla, haz una exploración nueva en su pestaña»). Dos sitios
   para escribir el monofilamento serían dos respuestas a «¿cuándo se le
   exploró?».
3. **El riesgo propone un plazo en MESES, no una próxima cita de las
   cuatro.** `PROXIMAS_CITAS` son 2/4/8 semanas (clinica-3) y la guía habla
   de 1–3, 3–6, 6–12 meses. Meterlo en el mismo selector habría sido
   redondear una recomendación clínica para que cupiera en un botón. El
   plazo se enseña y se guarda en el bloque; la próxima cita sigue siendo
   la propuesta de siempre.
4. **Las reglas y los precios del mockup eran de ejemplo**, y están
   sustituidos por los de §1 y por el catálogo de verdad.

---

## 5 · El panel

El mapa `categoría → tipo de visita` vive **dentro del catálogo de
agenda**, no en una sección propia de la barra lateral: lo que se configura
ahí es justo lo que se ve al abrir cada servicio de abajo, y dos pantallas
serían dos sitios a los que acordarse de ir. Sólo sale con la historia
clínica encendida.

Cada servicio enseña el tipo que **hereda** (de sólo lectura) y, si es de
quiropodia, cuál de los tres niveles es. Si dos categorías se pelean, lo
dice con el motivo — **antes** de que la dueña marque la casilla de
tratamiento de sesión y se coma el 409.

Las dos listas (los cinco tipos, los tres niveles) están **duplicadas** en
`apps/admin` por la regla de la casa: ese paquete no depende de ninguno del
monorepo, y sacar cinco códigos a uno nuevo pesa más que la duplicación. Es
lo mismo que `TAX_RATES` y la etiqueta de la exención en `CatalogoPage`. Lo
que no se puede es que las dos copias se separen: **`clinica-tipos-panel.test.ts`
lee la fuente del panel** y la ata a la del paquete, igual que
`iva-exento-sanitario.test.ts` ata la etiqueta del chip.

---

## 6 · Tabla de sabotajes

Cada garantía rota a propósito y **vista en rojo**, restaurando con
`git checkout --` después de cada una. El fichero de test **entero** y no
un `-t`: con el filtro, un sabotaje puede salir verde porque el test que lo
caza está en otro `describe` — pasó con los tres primeros del riesgo, y un
sabotaje que sale verde por el filtro es peor que no hacerlo.

| # | Qué se rompe | Dónde | Resultado |
| - | ------------ | ----- | --------- |
| **El nivel** |
| 1 | umbral de cantidad: 4 → 5 actos | `niveles.ts` | 🔴 3 |
| 2 | el fresado deja de ser extra | `niveles.ts` | 🔴 4 |
| 3 | manda el ÚLTIMO acto marcado, no el mayor | `niveles.ts` | 🔴 1 |
| 4 | el umbral cuenta actos repetidos | `niveles.ts` | 🔴 1 |
| **El riesgo, categoría por categoría** |
| 5 | cat. 3 · la úlcera SOLA basta para riesgo alto | `riesgo.ts` | 🔴 1 |
| 6 | cat. 2 · la deformidad SOLA sube a moderado | `riesgo.ts` | 🔴 1 |
| 7 | cat. 1 · los pulsos miran el MEJOR pie | `riesgo.ts` | 🔴 4 |
| 8 | cat. 0 · la deformidad deja de ser obligatoria | `riesgo.ts` | 🔴 1 |
| 9 | el plazo del riesgo alto pasa a anual | `riesgo.ts` | 🔴 1 |
| **La alerta cruzada** |
| 10 | se cruza por TEXTO y no por id | `alertas-cruzadas.ts` | 🔴 1 |
| 11 | el aviso se repite una vez por regla | `alertas-cruzadas.ts` | 🔴 2 |
| 12 | la cirugía deja de disparar el de sangrado | `alertas-cruzadas.ts` | 🔴 3 |
| 13 | cualquier estado de herida avisa de las 48 h | `alertas-cruzadas.ts` | 🔴 1 |
| **El pendiente que no se cierra** |
| 14 | se cierra tocando CUALQUIER zona | `pendientes.ts` | 🔴 1 |
| 15 | «Otro» se cierra solo con cualquier cosa | `pendientes.ts` | 🔴 1 |
| 16 | el arrastre pierde la fecha de origen | `pendientes.ts` | 🔴 4 |
| 17 | el cierre NO pregunta por el pendiente sin hacer | `SesionPodologia.tsx` | 🔴 3 |
| **La sesión v1 legible** |
| 18 | una v1 se lee como v2 y finge tener tipos | `sesion-v2.ts` | 🔴 1 |
| 19 | un cuerpo roto revienta al leerse | `sesion-v2.ts` | 🔴 1 |
| **El servicio con dos tipos** |
| 20 | dos tipos distintos se guardan igual (pura) | `tipos-de-visita.ts` | 🔴 2 |
| 21 | un servicio de sesión sin tipo se guarda | `tipos-de-visita.ts` | 🔴 1 |
| 22 | y la RUTA deja pasar las dos | `services/routes.ts` | 🔴 3 |
| 23 | el nivel en un servicio que no es de quiropodia | `services/routes.ts` | 🔴 1 |
| **Las líneas a caja de dos tipos** |
| 24 | la quiropodia no pone el producto del nivel | `sesion-v2.ts` | 🔴 3 |
| 25 | sólo pasa a caja el PRIMER tipo | `sesion-v2.ts` | 🔴 2 |
| 26 | el mismo servicio en dos tipos se cobra dos veces | `sesion-v2.ts` | 🔴 1 |
| 27 | el cobro deja de leer la sesión cerrada | `lineas-de-la-sesion.ts` | 🔴 3 |
| **La migración y el panel** |
| 28 | el CHECK de los cinco tipos se cae | migración | 🔴 1 |
| 29 | dos servicios pueden ser el mismo nivel | migración | 🔴 1 |
| 30 | la columna del nivel nace con default | migración | 🔴 2 |
| 31 | el panel ofrece un tipo que la sesión no tiene | `AgendaCatalogPage.tsx` | 🔴 1 |
| 32 | el panel renombra un nivel | `AgendaCatalogPage.tsx` | 🔴 1 |
| **La regla 8 y S5, que venían de antes** |
| 33 | el precio se cuela en la barra de caja | `sesion-v2.ts` | 🔴 1 |
| 34 | y el total también | `sesion-v2.ts` | 🔴 1 |
| 35 | la sesión no congela la especialidad | `sesion-v2.ts` | 🔴 2 |
| 36 | un servicio de otro tipo entra en el bloque | `sesion-v2.ts` | 🔴 1 |
| 37 | los chips de tipo dejan quitar el último | `SesionPodologia.tsx` | 🔴 1 |

### Lo que el sabotaje encontró, y no un test

El #26 salió **VERDE** la primera vez. El test que debía cazarlo
(«el MISMO servicio tocado en dos tipos es UNA línea») pasaba por el
cierre, y el cierre ya tira el servicio que no es del tipo del bloque — así
que el `vistos` de `serviciosDeLaSesion` nunca llegaba a ejercitarse. Se
añadió un test **directo sobre la derivación**, que es lo que de verdad
guarda la regla. El caso puede darse: basta con que una etiqueta nueva de
Holded le cambie el tipo a un servicio ya marcado en dos bloques.

---

## 7 · El bucle visual

`docs/qa/2026-10-08-clinica-5/` · el mockup recorrido en el producto real a
**1366, 1024 y 390**, entrando con el PIN de la podóloga y con los
objetivos táctiles del mapa **medidos sobre la página**: 22 zonas, **50,0
px** la más pequeña en los tres anchos (el mínimo del prompt es 44; el de
la casa, 48).

Tres hallazgos que ninguna suite veía; los dos primeros, arreglados:

1. **La tecla «10» del dolor, sola y estirada a 790 px.** `flex-1` sin
   tope: el único elemento de la última fila se lo come todo. Con
   `max-w-[88px]` caben las once en una fila a 1366 y, donde no quepan, la
   que sobra mide lo que sus hermanas. Venía de clinica-3; allí el panel
   era más estrecho y nunca llegaban a caber diez.
2. **«Sin cobro (no hay servicio asignado)» cuando sí lo había.** La barra
   lo decía de un pie de riesgo que tenía su consulta de 20 € al lado, sin
   marcar. Son dos cosas y piden cosas distintas: una es ir al catálogo, la
   otra es tocar un botón. `resumenPorTipos` devuelve ahora el motivo
   (`SIN_SERVICIO` / `NADA_MARCADO`).
3. **«Uña encarnada» significa dos cosas en la misma pantalla** — una
   lesión del mapa y un acto de la quiropodia. **No se ha tocado**: los dos
   nombres vienen de listas validadas y renombrarlos sin preguntar sería
   inventarse el vocabulario de una podóloga. Va a §8.

---

## 8 · Pendiente de validar con Rosario

Lo que este bloque ha construido con un criterio puesto y **sin
confirmar**. Las cuatro primeras están marcadas en el propio código.

1. **La regla de niveles de la quiropodia.** Qué incluye cada nivel. Lo de
   arriba es la regla del mockup: básica = corte y/o deslaminado; completa
   = además enucleación o grietas; extra = fresado, uña encarnada o cuatro
   actos o más. **Es la pregunta más importante de la lista**: de ella sale
   lo que se cobra.
2. **El criterio de riesgo.** La tabla es la de la IWGDF 2023, citada en
   `riesgo.ts`. Lo que falta confirmar es qué hace ella con cada categoría:
   el plazo exacto dentro de la horquilla, si deriva, y si la deformidad la
   valora ella o el traumatólogo.
3. **El servicio de cobro del pie de riesgo y de la revisión de cirugía.**
   Hoy se cobran con el servicio que el centro les asigne en su categoría;
   si no hay ninguno, la línea no sale y se ve «sin cobro». Hay que saber
   si ella cobra esas dos visitas y con qué concepto.
4. **Biomecánica y General son una tarjeta de botones corta** (decisión 8),
   y lo dicen en pantalla. COGECOP tiene ahí ángulos, patomecánica y
   diagnósticos; cuando se diseñe de verdad, esa tarjeta se rehace entera.
5. **«Uña encarnada», dos veces en la misma pantalla.** Si a ella la
   confunde o le parece lo normal (ver §7.3).
6. **Los cinco tipos y los seis actos** son los de COGECOP y los del
   mockup. Conviene verlos con ella delante de su programa de hoy.

---

## 9 · Al desplegar

1. **Hay migración.** `20261007030000_clinica_5_tipos_de_visita`, aditiva:
   una tabla nueva (`tag_visit_types`), una columna nueva
   (`service_scheduling.nivel_quiropodia`), dos CHECK y un índice único
   parcial. Nace todo vacío o NULL.
   **Copia de la base antes**, como siempre.
2. **No hay variables de entorno nuevas.** Ninguna.
3. **Nadie nota nada hasta que alguien configure.** Sin filas en
   `tag_visit_types`, ningún servicio tiene tipo, la sesión no ofrece
   ninguna tarjeta y el guardado de servicios se comporta igual que antes
   (las dos negativas de S5 sólo valen en centros con la historia
   encendida). Los catorce tenants sin clínica no ven ni una ruta nueva:
   `/admin/tag-visit-types` contesta la 404 de una ruta inexistente.
4. **El orden de la implantación de Rosario**, cuando toque:
   1. marcar las categorías en Catálogo de agenda → Tipos de visita por
      categoría (`podologia → Quiropodia`, `cirugia → Cirugía`…);
   2. dar de alta los tres servicios de quiropodia (básica, completa,
      extra) y marcar su nivel en cada uno;
   3. marcar «es un tratamiento de la sesión» en los que salen como botón.
   Si se hace al revés, el paso 3 contesta `SESION_SIN_TIPO` — que es la
   regla funcionando y no un fallo.
5. **Una sesión v1 ya firmada se sigue leyendo y se sigue cobrando.** No
   hay nada que migrar en `clinical_entries`.

### Lo que NO se despliega con esto

Historia viva (clinica-6), fotos, consentimientos e informe (clinica-4),
bonos, dictado por voz y fisioterapia. Fuera de alcance declarado.

---

## 10 · Estado de la suite, y lo que queda abierto

- **Suite de unidad: verde.** 312 ficheros, 3.819 tests (desde 303 / 3.572).
  Se corre desde la raíz (`pnpm test`).
- **e2e contra Postgres de verdad: los de clinica pasan.** Se corrió sobre
  una base propia de este worktree (`mipiacetpv_e2e_clinica5`), con las
  migraciones reales aplicadas. `clinica-sesion-cobro.e2e.ts` está
  actualizado al cuerpo v2 —incluida la lista exacta de claves del cuerpo,
  que es la que caza un importe colado en la historia— y
  `clinica-sesion.e2e.ts` se queda con su cuerpo v1 **a propósito**: lo que
  prueba son las garantías del motor, y de paso queda como guardia de que
  una v1 sigue entrando después de este bloque.
- **Dos ficheros de e2e fallan por EL RELOJ, no por la rama**: `f3-fichar`
  y `f8-colegio`. Abren un fichaje «hace cuatro horas» y lo cierran ahora;
  si las dos marcas caen en días **locales** distintos, el cierre da 409.

  Pasa entre las **00:00 y las ~04:00 de Madrid** (22:00–02:00 UTC), y pasó
  las dos veces: en local a las 00:06 y en la CI del PR a las 01:21 de
  Madrid. La prueba de que es el reloj y no la rama son las dos puntas:

  | Dónde | Hora de Madrid | e2e |
  | ----- | -------------- | --- |
  | `master`, último verde | 23:25 | ✅ |
  | esta rama, en la CI | 01:21 | ❌ los mismos 6 |
  | esta rama, en local | 00:06 | ❌ los mismos 6 |

  Y la rama **no toca ni un fichero de fichaje**
  (`git diff --name-only master` no devuelve ninguno). Los 27 ficheros
  restantes —los 29 menos esos dos— pasan, incluidos los tres de clinica.

  **Se arregla relanzando el job fuera de esa franja.** Lo que lo
  arreglaría de verdad es que esos dos e2e no usen el reloj de pared, y eso
  es de su bloque, no de éste.

### Lo que queda abierto, y por qué no se ha hecho

**El capítulo 12 del banco de la agenda (`apps/e2e-ui/specs/12-clinica-sesion.spec.ts`)
hay que rehacerlo.** No está en CI (`"No entra en la CI"`, su propio
README) y **ya estaba desfasado antes de este bloque**: espera 30 € y «no
dice exento» de un servicio que `iva-exento-sanitario` dejó en 35 € y
exento.

Con la pantalla por tipos, lo que cambia no es un selector: cambia **qué
hace la podóloga en el capítulo**. Antes marcaba dos tratamientos sueltos;
ahora marca tipos, toca actos y el nivel elige el producto, así que las
líneas, el total y el ticket del capítulo son otros. Eso es una decisión
del guion del capítulo, no un parche mecánico — y parchearlo a ciegas
habría dejado un fichero que afirma cosas que no he podido ejecutar (el
capítulo sólo corre encadenado desde el 1 al 11). Lo que hace falta:

- el seed ya está listo: trae los tres niveles, la cura, la consulta de pie
  de riesgo y el mapa de categorías del centro;
- hay que reescribir el recorrido del capítulo con el nuevo guion y
  actualizar los importes a los de `iva-exento-sanitario`;
- y correrlo entero (`pnpm e2e:agenda`), que es lo único que lo valida.
