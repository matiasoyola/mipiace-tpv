# Bloque clinica-6 · done

Rama `clinica-6-historia-viva`, worktree
`~/Developer/Claude/Projects/mipiacetpv-clinica-6`, desde `origin/master` =
`c6192f5` (lleva clinica-5 y enlaces-publicos), más `a7b99de`, el prompt de
este bloque.

**Este bloque convierte una lista de sesiones en una respuesta.** Hasta hoy,
para saber cómo está Carmen había que abrir sus visitas una a una. Es lo
mismo que le pasa a Rosario en COGECOP, y es lo que la hace volver al papel.

La frase que resume lo que tiene que ser verdad al terminar: **al abrir la
ficha, en diez segundos se sabe qué le pasa, qué le toca hoy —y se empieza
con un toque—, cómo están sus pies zona por zona, y qué visitas ha tenido,
sin abrir ninguna.**

Y la otra mitad, la que decide la forma del bloque: **no escribe nada.** Ni
una tabla, ni una columna, ni una migración.

---

## 1 · Las funciones puras: una regla sin validar, con su test

`packages/clinica-sesion/src/historia.ts` — el paquete de clinica-3 y -5,
con un fichero nuevo. Sigue siendo PURO: ni Prisma, ni Fastify, ni React,
ni reloj.

| Qué decide | Función |
| ---------- | ------- |
| El estado de cada zona del pie y su línea de evolución | `estadoDeLasZonas` |
| Si una visita MIRÓ el pie | `exploroElPie` |
| Qué toca hoy y con qué tipo se abre | `hoyToca` |
| Cuál se recomienda en «Nueva visita» | `tipoRecomendado` |
| Qué alerta vigilar hoy, y por qué | `ojoDeHoy` |
| El último dolor y hacia dónde va | `tendenciaDelDolor` |
| Una visita en palabras, de la versión que sea | `visitaLegible` |

Están aquí y no en la API por la misma razón que clinica-5 dejó escrita:
**la pantalla no recalcula reglas clínicas por su cuenta.** Dos cálculos son
dos verdades, y en «esta zona está curada» la que vería la podóloga sería la
del navegador.

### «No explorada» no es «curada», y eso necesitó un dato nuevo

La regla que escribió Dirección dice que una zona está **curada** cuando
tuvo marca alguna vez y no la tiene «en la última sesión cerrada en la que
se exploró el pie». Fíjate en lo que esa frase NO dice: «en la última
sesión».

O sea que hacía falta poder contestar **¿esta visita miró el pie?**, y eso
no estaba escrito en ningún sitio. Se contesta con tres caminos, y el
primero es el que manda:

1. si marcó algo en el mapa, lo miró;
2. una **v1** siempre lo miró — la sesión de clinica-3 ERA el mapa del pie;
3. y si no marcó nada, se mira el tipo, contra `TIPOS_QUE_MIRAN_EL_PIE`.

El caso que esto existe para no estropear: **una visita de biomecánica a la
que nadie le quitó durezas no cura el talón.** Y el que lo hace útil: una
quiropodia en la que ya no quedaba nada que marcar SÍ lo cura, porque es la
visita en la que se vio que estaba limpio.

`TIPOS_QUE_MIRAN_EL_PIE` es **DATO y no un `if`**, por lo mismo que la regla
de niveles de clinica-5: es justo lo que Rosario va a querer mover, y con
una lista se mueve editando una línea mientras el test lo comprueba desde
fuera. Va en §8, pendiente de validar.

### Y se compara con LA ANTERIOR, no con la primera

«Mejorando» es que la gravedad **bajó respecto a la anterior**. Con un hueco
en cualquiera de las dos no se dice que bajó: «no sé si bajó» no es «bajó»,
y la diferencia es si la zona sale en ámbar o en rojo.

Esto tiene recibo: el sabotaje que cambiaba «la anterior» por «la primera»
**salió verde**. Ver §6.

### «Ojo hoy» no inventa una escala de gravedad

El prompt pide «la alerta cruzada más relevante». Inventar un orden de
gravedad clínica habría sido inventarse una escala que nadie ha validado,
así que el orden es **el de la tabla de alertas cruzadas de clinica-5** —la
única lista de la casa que ya dice qué alerta choca con lo que se hace— y la
línea de la tarjeta **es su aviso**, literal.

Una alerta que todavía no cruza con nada (marcapasos) se enseña **sin
línea**, en vez de inventarle una consecuencia.

### Lo que NO se duplicó

`cuantoHace` («hace 4 semanas») ya existía en `piezas.tsx` desde clinica-5.
Se escribió una segunda versión en el paquete y se tiró antes de commitear:
la pantalla usa la de la casa, con el instante que manda el servidor.

---

## 2 · La API: una llamada, y ni un importe

`GET /clinica/clients/:clientId/historia` y
`GET /clinica/clients/:clientId/historia/visitas/:entryId`.

Las dos pasan por **`conHistoria`**, así que **cada apertura deja su línea
en `ClinicalAccessLog`** antes de hacer nada (decisión 9: que la pantalla
nueva no sea una puerta sin registro), y las dos llevan el gate del módulo,
que con la clínica apagada contesta la 404 de Fastify carácter por carácter.

Las dos exigen `SANITARIO`, que es el permiso por defecto de `conHistoria`.
**No hay una segunda forma de decidir quién ve una historia**: se hereda la
de clinica-1 entera.

### Cuelgan del PACIENTE, al revés que la sesión

Y por el motivo contrario. La sesión cuelga de la cita porque es de un día;
la historia no. Se abre desde la ficha del cliente y desde la cita, y en los
dos casos lo que se mira es la persona.

El `entryId` de una visita se comprueba **contra ese paciente**, así que
quien llama no puede elegir contra qué historia se comprueba el acceso — la
misma lección que las anotaciones de clinica-1.

### Sin importes, y sin `verImportes` que ramificar

Decisión 8 del prompt: *es historia, no caja.* Así que aquí **nadie** ve
precios, ni la dueña. No hay un camino de serialización por rol como el de
clinica-3: lo que se lee del cuerpo de cada sesión son los **nombres
congelados** (`tratamientosNombre`), que es lo que hace legible la historia
y nunca llevó precio.

Dos tests lo sostienen, y hacen trabajo distinto: uno recorre el JSON entero
buscando claves de dinero **con valor numérico**, y el otro compara **byte a
byte** la respuesta de la dueña con la del sanitario sin caja.

### El tope de visitas se declara, no se calla

`VISITAS_DE_LA_HISTORIA = 200`. No es una página: es la **ventana** sobre la
que se calcula el estado de cada zona, y por eso es generosa (doscientas
visitas son ocho años de quiropodia cada dos semanas).

Lo que no se hace es callarlo: la respuesta trae `totalDeVisitas` de un
`count()` aparte, y la pantalla dice «y N visitas más antiguas». Un tope
silencioso se lee como «esto es todo lo que hay», que en una historia
clínica es justo la clase de mentira que este bloque existe para quitar. Su
test siembra 205 visitas.

---

## 3 · La pantalla

`apps/tpv-web/src/clinica/HistoriaViva.tsx`, con las piezas del mockup en su
orden: cabecera y franja roja, «Carmen en 10 segundos» (Hoy toca · Dolor ·
Última vez · Ojo hoy), y las pestañas Pie · Visitas · Documentos.

**No calcula nada**: el estado de cada zona, «hoy toca», la tendencia, el
«ojo hoy» y la recomendada vienen ya resueltos del servidor.

### Entra donde hoy se abría la historia

- **Desde la cita** (agenda): botón «Historia del paciente», encima de
  «Valoración inicial». La valoración conserva su botón porque es donde se
  **valida**, y validar no es leer.
- **Desde la ficha del cliente**: al sanitario se le da la pestaña
  **Historia** (la valoración ya está dentro, en Documentos). A quien no
  lleva la marca sanitaria se le sigue dando la pestaña **Valoración**, y
  por la razón de clinica-2: ahí la recepcionista usa los dos botones que SÍ
  puede usar —mandar el test, abrir la tablet— sin pedir una sola respuesta,
  y por tanto sin dejar una línea `DENIED` en el registro cada vez que toca
  la pestaña. Darle la historia viva sería darle un 403 con su línea.

### El pie es EL MISMO de clinica-3

`MapaDelPie` con sus once zonas por pie y su geometría, coloreado por
estado. **No se dibuja un segundo pie** con la forma del mockup de este
bloque: dos dibujos distintos del mismo pie en el mismo producto son dos
sitios donde una zona puede caer en distinto sitio, y lo que se marca ahí es
una úlcera. Es la primera divergencia declarada (§7).

### Las tres piezas compartidas que se tocaron

1. **`MapaDelPie` gana tres estados** (activa / mejorando / curada) **y
   espeja el pie IZQUIERDO**. Ver §5: era un fallo de píxeles de clinica-3.
2. **`FranjaRoja` sale a `piezas.tsx`.** Una señal de seguridad con dos
   copias es la que un día sale en rosa pálido en una de las dos pantallas.
3. **El `resumen` de `SesionCerrada` pasa a opcional.** La historia abre esa
   misma pantalla para LEER una visita, y ahí no hay bloque de cobro. Sin
   `resumen` no se pinta; no se pinta vacío ni a cero — la misma forma que
   clinica-3 usó con las claves de precio.

### Y lo único que se le pasa a la sesión de clinica-5

Un `tiposIniciales` opcional. Nada más: no cambia lo que la sesión hace ni
lo que guarda, sólo con qué chips arranca cuando se viene de «Hoy toca» o de
«Nueva visita» — y la podóloga los puede quitar y poner igual. El pendiente
ya salía arriba solo, porque la banda de «Hoy toca» de la sesión lee los
mismos `pendientesCreados`.

---

## 4 · Decisiones tomadas sin preguntar

1. **«Hoy toca» y «Nueva visita» NO salen desde la ficha del cliente.** Una
   sesión clínica cuelga de una CITA desde clinica-3 (§8.6), y desde la
   ficha de un cliente no hay ninguna. La tarjeta se ve igual —que es lo que
   hace falta saber— y dice dónde se empieza, en vez de ofrecer un botón que
   no puede cumplir. Desde la cita sí abren, que es donde la podóloga
   trabaja.
2. **Consentimientos e informe NO aparecen en Documentos**, ni siquiera
   desactivados con «Llega pronto» (el prompt dejaba elegir). Una fila gris
   con el nombre de un documento que no existe le dice a la podóloga que hay
   algo que no encuentra, y durante las semanas que tarde clinica-4 esa fila
   es una pregunta de soporte cada vez que alguien abra la pestaña. La
   pestaña enseña lo que hay.
3. **«Respondió un familiar», y no «Respondió su hija Ana».** El
   cuestionario de clinica-2 pregunta si contesta el paciente o un familiar
   y **no pide el nombre ni el parentesco**. Escribir el del mockup sería
   inventarse quién estuvo delante de una historia clínica.
4. **Las alertas van en NEUTRO** («Diabetes», «Anticoagulación»), que es lo
   que decidió clinica-2: son etiquetas de la franja de cualquier paciente.
   El mockup las escribe en femenino porque su paciente es Carmen.
5. **El comparador de fotos no se construye.** Las fotos son de clinica-4:
   el hueco dice «Sin fotos de esta zona» y queda listo. No hay subida, ni
   deslizador, ni `input[type=file]` — y un test lo fija.
6. **La capa de sensibilidad es de LECTURA** y lo dice en pantalla, igual
   que en la sesión de clinica-5: dos sitios para escribir el monofilamento
   serían dos respuestas a «¿cuándo se le exploró?».
7. **La zona abierta de entrada es la primera**, no el hueco. Abrir el pie
   vivo y encontrarse una columna vacía al lado es la pantalla pidiendo un
   toque para enseñar lo que ya podría estar enseñando.
8. **La franja roja se enseña aunque la valoración no esté validada**, con
   una línea que lo dice. Es la decisión segura de clinica-2: una podóloga
   que ve «Anticoagulación · por validar» sabe lo que tiene delante; una que
   no ve nada porque falta un visto bueno, no.

---

## 5 · El bucle visual, y lo que encontró

`docs/qa/2026-10-08-clinica-6/` (con su `README.md`) · el mockup recorrido
en el producto real a **1366, 1024 y 390**, entrando con el PIN de la
podóloga y abriendo la historia **desde la cita**, con un paciente de
historia **mezclada v1 + v2**.

**Medido sobre la página**, y sólo dentro de la historia (detrás del overlay
sigue montada la agenda, con sus botones de 32 px — la misma trampa del
`getByText("30,00 €")` de clinica-3, aquí en la medición):

| Ancho | Zonas | La más pequeña | Botón más pequeño | Scroll horizontal |
| ----- | ----- | -------------- | ----------------- | ----------------- |
| 1366 | 22 | **48,4 px** | 48 px | no |
| 1024 | 22 | **48,4 px** | 48 px | no |
| 390 | 22 | **48,4 px** | 48 px | no |

### Cuatro hallazgos, los cuatro arreglados

**1 · Abrir una visita tumbaba la pantalla entera.** `Cannot read properties
of undefined (reading 'toLowerCase')` contra el ErrorBoundary: una
`proximaCita` que este despliegue no reconoce dejaba
`NOMBRE_DE_PROXIMA_CITA[prox]` en `undefined`.

Lo disparó un valor equivocado de **mi semilla** (`DOS_SEMANAS` en vez de
`S2`), y aun así el fallo es del código: la regla ya estaba escrita en
`tiposDeLaSesion` de clinica-5 — *lo que no puede pasar es que abrir una
historia reviente, es un registro legal al que el paciente tiene derecho de
acceso.* Se arregla con `esProximaCita`, con su test visto en rojo.

**2 · Los botones de capa medían 40 px.** El `height: 40px` del mockup,
copiado literal: por debajo del 44 del prompt y del 48 de la casa. **El
mockup es la spec de lo que se ve, no del peldaño táctil.** A
`min-h-touch`.

**3 · El chip repetía el nivel** que ya estaba en el título de la fila:
«Quiropodia completa», las tres barras, y otra vez «Quiropodia completa» de
chip. El filtro quitaba el nombre del TIPO y no el del nivel.

**4 · El pie se espejaba al revés, y desde clinica-3.** Los **tres** mockups
validados (clinica-3, la sesión v2 y la historia viva) espejan el pie
IZQUIERDO, para que con los dos pies uno al lado del otro **los dedos gordos
queden hacia dentro** — que es como se ve un par de pies de frente. El
código espejaba el derecho.

Se arregla en el ÚNICO sitio donde se dibuja el pie, así que lo hereda
también la sesión de clinica-5. Dos pantallas que no se pongan de acuerdo en
cuál es el pie izquierdo son peores que las dos equivocadas igual. **No lo
sostenía ningún test** —el sabotaje que lo devolvía salía verde— y ahora sí.

### Y tres cosas del banco que costaron media hora

- **El overlay de Clientes se come el clic en «Agenda»** sin decir nada:
  `elementFromPoint` sobre el botón devuelve la cabecera del overlay. Hay
  que cerrarlo con su «Volver».
- **A 390 la barra de secciones son iconos sin texto**, así que
  `getByRole("button", {name: "Clientes"})` no los encuentra; y hay DOS
  («Clientes» de la barra y el del menú lateral, montado aunque esté
  oculto), con lo que en modo estricto `isVisible()` lanza y un
  `.catch(() => false)` lo convierte en «no está». Por `title` y con
  `.first()`.
- **`page.evaluate` con una función interna muere con `__name is not
  defined`**: tsx/esbuild anota las funciones nombradas y eso no existe en
  el navegador. Va como string.

---

## 6 · Tabla de sabotajes

Cada garantía rota a propósito y **vista en rojo**, restaurando con
`git checkout --` después de cada una, y corriendo el fichero de test
**entero** (no un `-t`), que es la lección de clinica-5.

| # | Qué se rompe | Dónde | Resultado |
| - | ------------ | ----- | --------- |
| **El estado de una zona** |
| 1 | la gravedad que SUBE también cuenta como mejoría | `historia.ts` | 🔴 2 |
| 2 | se compara con el PRIMER paso y no con el anterior | `historia.ts` | 🟢 → 🔴 1 |
| 3 | un hueco en la gravedad cuenta como bajada | `historia.ts` | 🔴 4 |
| 4 | **se cura con la última visita, mire o no el pie** | `historia.ts` | 🔴 2 |
| 5 | una visita con marcas deja de contar como que miró | `historia.ts` | 🔴 1 |
| 6 | la biomecánica entra en los que miran el pie | `historia.ts` | 🔴 2 |
| 7 | las zonas salen en el orden de las marcas | `historia.ts` | 🔴 1 |
| **«Hoy toca»** |
| 8 | pone delante el pendiente MÁS RECIENTE | `historia.ts` | 🔴 1 |
| 9 | sin pendientes no devuelve `null` | `historia.ts` | 🔴 1 |
| 10 | «Otro» propone un tipo de visita | `historia.ts` | 🔴 2 |
| **La recomendada de «Nueva visita»** |
| 11 | la diabetes manda sobre el pendiente | `historia.ts` | 🔴 1 |
| 12 | la diabetes deja de recomendar pie de riesgo | `historia.ts` | 🔴 2 |
| **La v1 legible** |
| 13 | una sesión v1 se enseña como una quiropodia | `historia.ts` | 🔴 2 |
| 14 | el chip repite el nombre del tipo | `historia.ts` | 🟢 → 🔴 1 |
| 15 | «ojo hoy» coge la primera alerta y no la que cruza | `historia.ts` | 🔴 1 |
| **Ni un importe, y el mismo JSON para los dos roles** |
| 16 | un precio se cuela en la lista de visitas | `historia.ts` | 🔴 1 |
| 17 | el detalle de una visita lleva el total | `historia.ts` | 🔴 1 |
| 18 | la dueña ve un importe que el sanitario no ve | `historia-routes.ts` | 🔴 1 |
| **La puerta y el registro** |
| 19 | **abrir la historia NO deja línea en el registro** | `historia-routes.ts` | 🔴 3 |
| 20 | la recepcionista entra en la historia | `historia-routes.ts` | 🔴 1 |
| 21 | con el módulo apagado la ruta sigue existiendo | `historia-routes.ts` | 🔴 1 |
| 22 | una visita de otro paciente se abre desde esta historia | `historia.ts` | 🔴 1 |
| **Lo que la API calcula** |
| 23 | «hoy toca» sale de la PRIMERA sesión y no de la última | `historia.ts` | 🔴 1 |
| 24 | el tope de 200 visitas se calla | `historia.ts` | 🔴 1 |
| 25 | la valoración no dice que respondió un familiar | `historia.ts` | 🔴 1 |
| 26 | aparece la fila de consentimiento de clinica-4 | `historia.ts` | 🔴 2 |
| 27 | la franja roja se queda con la primera alerta | `historia.ts` | 🔴 2 |
| **La pantalla** |
| 28 | «Empezar esta revisión» sale sin cita detrás | `HistoriaViva.tsx` | 🔴 1 |
| 29 | «hoy toca» abre la hoja con la recomendada del paciente | `HistoriaViva.tsx` | 🔴 1 |
| 30 | el detalle de una visita pinta el bloque de caja | `SesionCerrada.tsx` | 🔴 1 |
| 31 | el pie vivo pinta todas las zonas del mismo color | `HistoriaViva.tsx` | 🔴 1 |
| 32 | el hueco de las fotos deja de decir que no hay | `HistoriaViva.tsx` | 🔴 1 |
| 33 | la sensibilidad deja de decir que es de lectura | `HistoriaViva.tsx` | 🔴 1 |
| 34 | **el pie se encoge y la zona baja de 48 px** | `MapaDelPie.tsx` | 🟢 → 🔴 1 |
| 35 | un importe se cuela en la lista de visitas | `HistoriaViva.tsx` | 🔴 1 |
| 36 | la franja de alertas deja de ser `role="alert"` | `piezas.tsx` | 🔴 1 |
| 37 | **el espejo vuelve al pie derecho** | `MapaDelPie.tsx` | 🟢 → 🔴 1 |

### Los cuatro que salieron VERDES, que son los que enseñaron algo

**#2 · «la anterior» y «la primera» eran la misma marca.** Todos mis casos
tenían dos pasos, y con dos pasos las dos lecturas coinciden. Hizo falta
`leve → severa → moderada`: respecto a la anterior ha bajado, respecto a la
primera ha subido. **Lo que la podóloga necesita saber es si va mejor que la
última vez que la vio, no que el primer día.**

**#14 · un aserto que no probaba nada en ninguna de las dos direcciones.**
El test pasaba un servicio llamado «Cirugía» y el nombre del tipo es
«Cirugía · revisión», así que el filtro nunca llegaba a ejercitarse. Es la
forma exacta del `toContain` del §7.10 de clinica-3, dos bloques después.
Ahora el servicio se llama «Quiropodia», que es como se llama de verdad en
el catálogo de una podóloga.

**#34 · el test medía el ancho NOMINAL y no el que el SVG pide.** Encoger el
pie a 200 px dejaba la zona en 36,6 px y el test seguía verde, porque
`ANCHO_DEL_PIE_PX` seguía siendo correcto. Es la trampa del §7.3 de
clinica-3, donde la cazó la medición de la captura; aquí se cierra leyendo
el `maxWidth` del SVG pintado. (Y el selector tenía que ser el SVG DEL PIE,
no el primero del DOM: los iconos de lucide también llevan `viewBox`.)

**#37 · el arreglo del espejo no lo sostenía nada.** Un fallo de píxeles
arreglado y sin test es un fallo que vuelve.

---

## 7 · Divergencias declaradas con el mockup

1. **El pie es el de clinica-3**, con sus once zonas y su contorno, no el
   dibujo del mockup de este bloque. Un solo pie en el producto (§3).
2. **El comparador antes/hoy no existe**: todas las zonas enseñan «Sin fotos
   de esta zona». Las fotos son de clinica-4 (decisión 4 del prompt).
3. **«Respondió un familiar»**, no «su hija Ana» (§4.3).
4. **Las alertas en neutro** (§4.4).
5. **Sin fila de consentimiento ni de informe** (§4.2).
6. **El título de la cirugía es «Cirugía · revisión»**, que es el nombre del
   tipo en `NOMBRE_DE_TIPO_DE_VISITA` desde clinica-5; el mockup escribe
   «Cirugía» a secas.
7. **Los iconos de los cinco tipos** son los de la casa (lucide) con el
   mismo significado que los del mockup: tijeras, triángulo, huella, jeringa
   y reloj.
8. **En el mockup, «Cancelar» de la hoja de tipos no funciona** y las
   tarjetas tampoco: el `.sheet` lleva un `stopPropagation` que deja al
   listener de `document` sin ver los clics de dentro. En el producto los
   dos hacen lo suyo. (No es una divergencia de diseño: es un fallo del
   mockup, anotado por si alguien lo recorre y se extraña.)

---

## 8 · Pendiente de validar con Rosario

1. **LA REGLA DE ESTADO DE ZONA.** Es la más importante y la que el prompt
   marca. Lo que está puesto es la regla de partida de Dirección, y tiene
   dos piezas que confirmar por separado:
   - **activa / mejorando** se decide comparando la gravedad con la de la
     visita anterior. ¿Es así como ella lo mira, o cuenta también que la
     lesión cambie de clase (una dureza que pasa a grieta)?
   - **curada** depende de `TIPOS_QUE_MIRAN_EL_PIE`
     (`QUIROPODIA`, `PIE_RIESGO`, `CIRUGIA`). La pregunta concreta: **en una
     visita de biomecánica o en una consulta general, ¿le mira el pie
     entero?** Si la respuesta es que sí, la lista se queda con los cinco y
     es una línea. Va marcada en el propio código.
2. **El «ojo hoy» sale de la tabla de alertas cruzadas**, que hoy tiene
   cuatro filas. En cuanto ella vea la pantalla van a salir más (látex +
   guantes, inmunodepresión + cualquier corte), y cada una mejora esta
   tarjeta sin tocar código de la historia.
3. **El orden de la recomendada de «Nueva visita»**: pendiente → diabetes →
   último tipo. ¿Es el suyo? En particular, si una diabética viene a
   cortarse las uñas, ¿quiere que el programa le proponga pie de riesgo?
4. **«Y N visitas más antiguas»** a partir de 200. Nadie tiene tantas hoy;
   conviene saber cuántas visitas tiene su paciente más antiguo en COGECOP
   antes de dar el número por bueno.
5. **El pie se espejaba al revés** hasta este bloque (§5.4). Conviene
   enseñarle las dos versiones y que diga cuál lee ella sin pensar.

---

## 9 · Al desplegar

1. **NO HAY MIGRACIÓN.** Ni una tabla, ni una columna, ni un índice, ni un
   enum. Este bloque sólo lee. Un test de clinica-3 ya fija que el bloque no
   crea tablas; aquí no había ni migración que escribir.
2. **No hay variables de entorno nuevas.** Ninguna.
3. **No hay `COPY` nuevo en `infra/Dockerfile`**: no nace ningún paquete,
   `historia.ts` vive dentro de `clinica-sesion`, que ya está.
   `infra/test/dockerfile-manifiestos.test.ts` pasa sin tocarlo.
4. **Nadie que no tenga la clínica encendida nota nada.** Las dos rutas
   nuevas contestan la 404 de una ruta inexistente, y la pestaña de la ficha
   del cliente sólo sale con el módulo encendido — como la de la valoración
   desde clinica-2.
5. **Lo que SÍ cambia para quien ya la tiene encendida**, y conviene
   decírselo a Rosario antes de que lo vea:
   - desde la cita hay un botón nuevo, **«Historia del paciente»**, encima
     de «Valoración inicial»;
   - en la ficha del cliente, al sanitario la pestaña **«Valoración» pasa a
     llamarse «Historia»** (la valoración está dentro, en Documentos). A la
     recepción no le cambia nada;
   - **el mapa del pie espeja el otro pie** — también en la sesión de
     clinica-5. Es el arreglo de §5.4 y es lo único de este bloque que
     cambia una pantalla que ya estaba.
6. **Una historia con sesiones v1 y v2 mezcladas se lee entera**, y es lo
   que el bucle visual recorrió. No hay nada que migrar en
   `clinical_entries`.

### Lo que NO se despliega con esto

Fotos, consentimientos e informe (clinica-4); bonos, dictado por voz,
fisioterapia y la app iOS. Fuera de alcance declarado.

---

## 10 · Verde

- **Suite de unidad: verde.** 329 ficheros, **4.071 tests**, 3 skipped
  (desde 312 / 3.819 en clinica-5). Se corre desde la raíz (`pnpm test`).
- **e2e contra Postgres de verdad: verde.** 30 ficheros, **521 tests**,
  sobre una base propia de este worktree (`mipiacetpv_clinica6_e2e`), con
  las migraciones reales aplicadas. Incluidos `f3-fichar` y `f8-colegio`,
  que son los dos que dependen del reloj de pared (clinica-5 §10): se
  corrió a las 13:31 de Madrid, fuera de su franja mala.
- `tsc` de API (con sus tests y su e2e), tpv-web, admin, e2e-ui y el
  paquete · limpio. También con los comandos de la CI (`tsc -b` en los dos
  frontends).

### Lo nuevo de este bloque

- `packages/clinica-sesion/test/historia.test.ts` (41) · el estado de cada
  zona, «no explorada ≠ curada», hoy toca, la recomendada, la v1 legible y
  el «ojo hoy».
- `apps/api/test/clinica-historia-rutas.test.ts` (25) · el registro de
  accesos, ni un importe para nadie, la historia mezclada, el gate y el
  aislamiento.
- `apps/tpv-web/test/clinica-historia-pantalla.test.tsx` (21) · la pantalla
  montada: los diez segundos, «hoy toca» con y sin cita, el pie vivo con sus
  22 zonas medidas sobre el SVG pintado, el espejo, el hueco de las fotos y
  el detalle sin caja.

---

## 11 · Commits

```
e98b614 feat(clinica-6): las funciones puras de la historia viva
bed80ef feat(clinica-6): la historia viva en la API, con su registro de accesos
3a4887a feat(clinica-6): la historia viva en pantalla, desde la cita y desde la ficha
241f298 test(clinica-6): el tope de 200 visitas se declara y no se calla
9a5efc7 test(clinica-6): el estado de zona se compara con LA ANTERIOR
4af5acb test(clinica-6): el chip que repite el tipo se prueba con el nombre real
47c6e26 test(clinica-6): el mínimo táctil se mide sobre el SVG pintado
f156d88 test(clinica-6): queda atado qué pie se espeja
e4ee7c6 fix(clinica-6): el bucle visual, y tres fallos que ninguna suite veía
<este>  docs(clinica-6): el done del bloque
```
