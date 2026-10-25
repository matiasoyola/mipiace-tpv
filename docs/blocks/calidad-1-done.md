# Bloque calidad-1 · done

**El mapa único, los indicadores y las no conformidades.** Primer bloque de la Fase 1b.

AENOR puso en 2026 una **NC 01** (apartado 4.4.1, menor) porque Jardín de Gredos tiene **dos mapas
de procesos que no cuadran** —8 procesos en la pantalla de indicadores y 4 en la de riesgos— y
riesgos intrínsecos de una residencia sin proceso asignado. Y entre auditorías las no conformidades
se resuelven de palabra: el PAC se redacta en Word a los 30 días.

Lo que este bloque construye:

1. **Un solo mapa de procesos por centro, imposible de duplicar** (D-70). Indicadores, riesgos,
   objetivos y no conformidades cuelgan de él con FK `NOT NULL` y `Restrict`, y **no hay ninguna
   otra lista de procesos en el producto**. La NC 01 queda cerrada por construcción.
2. **Riesgos y oportunidades por proceso** (D-71), con los cuatro que AENOR echa en falta ya
   colgados y con fecha de revisión que vence en el panel.
3. **Siete indicadores más** (D-72), los que ya tienen dato: la cumplimentación de los registros de
   atención directa por turno y zona (R9 de la inspección), caídas, familia comunicada antes de
   cerrar, quejas, quejas en plazo, ocupación media y rotación de personal. Cada uno con su proceso
   y **abrible hasta la lista de registros que lo sostiene**.
4. **El ciclo completo de una no conformidad** (D-73), con verificación de eficacia por una persona
   distinta de quien cerró la última acción.
5. **El indicador fuera de umbral PROPONE, no crea** (D-74).
6. **El PAC y el informe de NC en PDF** (D-75).

Y no es un módulo para Jardín de Gredos: es **el módulo de calidad de un producto** que cualquier
centro certificado en ISO 9001 pueda usar con su mapa, sus indicadores y sus NC sin una consultoría
delante. Jardín de Gredos es el cliente cero y vive sólo en el sembrador.

---

## 1 · El mapa único, y por qué cierra la NC 01 por construcción

Una tabla `processes` por tenant. Las cuatro cosas que cuelgan lo hacen con **FK `NOT NULL` y
`ON DELETE RESTRICT`**:

| Cuelga | Tabla | FK |
| --- | --- | --- |
| Indicadores | `indicator_processes` | `process_id` NOT NULL · Restrict |
| Riesgos y oportunidades | `risk_opportunities` | `process_id` NOT NULL · Restrict |
| Objetivos de calidad | `quality_objectives` | `process_id` NOT NULL · Restrict |
| No conformidades | `non_conformities` | `process_id` NOT NULL · Restrict |

La diferencia con «cerrar la NC por disciplina» es que **no hay dónde escribir el segundo mapa**. No
es que la pantalla de riesgos y la de indicadores usen la misma lista por convenio: es que no existe
una segunda lista, y una fila sin proceso no entra ni por la ruta ni por SQL (el e2e lo mide en los
dos caminos).

### El mapa de referencia es del producto, el mapa es del centro

`apps/api/src/residencia/catalogo/procesos-de-serie.ts`: once procesos y cuatro riesgos. El centro
los **carga una vez y los adapta** — renombra, añade, desactiva. Es una **plantilla, no un catálogo
de serie**: no baja al encender la residencia y no se versiona, igual que las obligaciones de
dirección de residencia-5 y por lo mismo — lo que un centro ajustó en noviembre no lo puede pisar
una versión del producto de 2028.

`reference_code` guarda de dónde salió cada proceso aunque le cambien el nombre, con un índice único
`(tenant, reference_code)` que hace **idempotente** cargar el mapa: correrlo dos veces crea cero.

Y el **responsable es un ROL de cuidado, no una persona** (D-29, D-50): el dueño de un proceso es
«la DUE» o «calidad», y quien ocupa ese rol cambia en agosto.

### Los 8 + 4 de hoy, reconducidos a once

Lo que el sembrador monta para Jardín de Gredos, proceso por proceso. **Es la tabla que hay que
enseñarle a AENOR**: cada uno de los doce nombres de los dos mapas de hoy tiene su sitio en el mapa
único, y ninguno se pierde.

| De dónde viene | Mapa de hoy | Proceso del mapa único |
| --- | --- | --- |
| Indicadores | DIRECCIÓN | Dirección y planificación (estratégico) |
| Riesgos | DIRECCIÓN-RRHH | Dirección y planificación **+ Personas** (se parte en dos) |
| Riesgos | CALIDAD | Calidad, medición y mejora (estratégico) |
| Indicadores | MEDICIÓN Y MEJORA | Calidad, medición y mejora |
| Indicadores | INFORMACIÓN PRELIMINAR | Información preliminar, admisión e ingreso |
| Indicadores | VALORACIÓN FUNCIONAL Y PAI | Valoración funcional y PAI |
| Indicadores | ATENCIÓN GERIÁTRICA | Atención geriátrica y sanitaria |
| Indicadores | ABVD | Cuidados y ABVD **+ Vida social, animación y terapias** (se parte en dos) |
| Riesgos | PRESTACIÓN DE SERVICIOS | Se reparte entre los cinco operativos (obs. 07) |
| Indicadores | LIMPIEZA Y MANTENIMIENTO | Limpieza y mantenimiento (soporte) |
| Riesgos | MANTENIMIENTO | Limpieza y mantenimiento |
| Indicadores | DOCUMENTACIÓN Y REGISTRO | Documentación, registro y protección de datos |
| *(nuevo)* | — | Alojamiento, manutención y limpieza |

**Dos procesos se parten y uno se reparte**, y las tres veces es la observación 07 de AENOR: «el
proceso único de PRESTACIÓN DEL SERVICIO junta actividades muy diversas». Separar ABVD de la vida
social es lo que permite que «la gimnasia» y «el aseo» tengan responsables distintos, que es lo que
pasa de verdad en el centro.

### Desactivar obliga a reasignar, y eso NO lo hace el motor

El borrado lo para la FK. **Desactivar es poner una columna a `false` y eso ninguna FK lo ve**, así
que esa regla sí es de la aplicación (`desactivarProceso`): si se permitiera, el riesgo de las
salidas no controladas seguiría en la base y desaparecería de la pantalla — que delante de un
auditor es peor que no haberlo tenido nunca.

La ruta contesta 409 **con la cuenta de lo que cuelga**, y la pantalla ofrece el desplegable para
moverlo de golpe. Un error que sólo dice «no puedes» obliga a la dirección a adivinar qué le sobra.

---

## 2 · Los riesgos: nivel con CHECK, bandas del producto

`nivel = probabilidad × impacto`, los dos de 1 a 3. Es una **columna con un CHECK**
(`risk_opportunities_nivel_coherente`) y no un cálculo: el panel ordena por ella, y un nivel que se
calcula en dos sitios acaba dando dos números. El e2e intenta escribirlo mentido por SQL y el motor
lo rechaza.

Las **bandas** (bajo 1-2 · medio 3-4 · alto 6-9) viven en el paquete puro y son **del producto**. Un
centro que pudiera mover la raya del «alto» tendría la tentación de moverla hasta no tener ninguno,
y eso un auditor lo ve en dos minutos. Lo que el centro sí decide es la probabilidad y el impacto,
que es donde está el juicio profesional.

### La descripción de un riesgo va EN CLARO, y está declarado

Al revés que la de una NC. Un riesgo describe **algo que puede pasar en el centro**, no algo que le
pasó a doña Carmen: «intoxicación alimentaria por rotura de la cadena de frío» no nombra a nadie. Y
en claro es consultable, que es lo que permite pintar y exportar el mapa de riesgos sin descifrar
nada. Si alguien escribe un nombre ahí, está escribiéndolo en el sitio equivocado: eso es una
incidencia del libro o una NC.

### «Revisado» es firmar, no mover una fecha

`reviewed_at` y `reviewed_by_user_id` van juntas con la fecha nueva (CHECK
`risk_opportunities_revision_completa`). Sin esto, «revisado» sería un botón que empuja la fecha seis
meses y nadie sabría quién lo pulsó. Una revisión vencida sale en el panel.

---

## 3 · Los indicadores: trece, cada uno con su proceso

Los seis de residencia-5 **dan exactamente lo mismo que antes** y van los primeros: sus aserciones
en `packages/residencia-plan/test/indicadores.test.ts` no se tocan, y el test comprueba el orden con
un `slice(0, 6)` para que meter uno delante salga rojo.

Los siete nuevos:

| Indicador | Proceso de referencia | De dónde sale | Umbral de serie |
| --- | --- | --- | --- |
| Cumplimentación de los registros de atención directa | Documentación y datos | el mismo cruce que el parte de relevo | ≥ 98 % |
| Caídas al mes | Cuidados y ABVD | libro, tipo `CAIDA` | ≤ 4 |
| Incidencias con familia comunicada antes de cerrar | Calidad y mejora | libro + `family_communications` | ≥ 90 % |
| Quejas al mes | Calidad y mejora | libro, sujeto queja | ≤ 2 |
| Quejas respondidas en plazo (15 días) | Calidad y mejora | libro, sujeto queja | ≥ 100 % |
| Ocupación media del mes | Admisión e ingreso | camas y asignaciones, día a día | ≥ 90 % |
| Rotación de personal | Personas | bajas de `employees` / plantilla | ≤ 2 % |

**R9 de la inspección** es el primero, y lleva su desglose **por turno y zona** con lo peor arriba:
el acta del 08-10-2026 habla de «anotaciones vacías puntuales» y la respuesta del centro comprometió
que la supervisora compruebe al final de cada turno. Un porcentaje del mes no sirve para eso.

### El indicador y el parte NO se pueden contradecir

Los tres de cumplimiento (gimnasia, estimulación y R9) salen de **`queToca` + `loQueNoSeHizo`**, las
mismas funciones que arman el parte de relevo. No es una coincidencia de implementación: es la razón
por la que el bloque no tiene dos fuentes para la misma pregunta. El e2e lo mide sumando el desglose
y comparándolo con el global.

### Lo que NO se inventa

El absentismo necesita el cuadrante (calidad-2) y la formación su registro (mantenimiento-1). Los
dos se **nombran** con lo que les falta, en vez de calcularse con una aproximación. Un número que no
se puede defender delante de un auditor es peor que un hueco.

La fila «rotación, absentismo y formación en plazo» de residencia-5 **se parte**: la rotación sale
de la lista porque ya se calcula con los datos de personal que mipiacetpv tiene, y las otras dos
quedan con su bloque cada una. Los que se nombran pasan de once a trece — también entra la
representatividad de las encuestas (obs. 05 de AENOR), que hasta ahora no se nombraba.

### Y cada uno se abre hasta sus registros

`GET /residencia/indicadores/:code/registros`. Devuelve **una tabla genérica** (título, nota,
columnas, filas): cada indicador sale de una tabla distinta y trece componentes de pantalla habrían
sido trece sitios donde acordarse del catorce.

Lo que se enseña en los de cumplimiento **no son las que se hicieron: son las que NO**. Un auditor
que abre «participación en la gimnasia 75 %» no quiere ver las ciento cincuenta que se hicieron.

---

## 4 · El ciclo de la no conformidad, y las dos puertas que están en el motor

`OPEN` → `CAUSE_ANALYSED` → `ACTIONS` → `ACTIONS_CLOSED` → `CLOSED`, con una vuelta: una
verificación `NOT_EFFECTIVE` devuelve a `ACTIONS`.

**Las transiciones y la frase de «qué falta» viven en el paquete puro** (`calidad.ts`,
`loQueFaltaPara`) y las ejecutan la ruta y la pantalla **con la misma función**. Por eso el botón no
puede estar encendido cuando la ruta va a contestar 409: no hay dos opiniones.

Las dos reglas duras no están en la ruta:

1. **Una NC mayor o menor no sale de `OPEN` sin causa** — CHECK
   `non_conformities_causa_antes_de_acciones`. Una observación y una oportunidad de mejora sí.
2. **No llega a `CLOSED` sin una verificación `EFFECTIVE`** — trigger
   `non_conformities_inmutable`, que **mira la otra tabla**. Es la pregunta que el prompt pedía
   contestar explícitamente: *¿lo para el motor o sólo la ruta?* **El motor.** Una regla que mira
   otra tabla no cabe en un CHECK, así que baja a un trigger; dejarla sólo en la ruta sería dejar la
   evidencia de la mejora a merced de un `UPDATE`.

### Escribir la primera acción ES pasar a acciones

No hay un botón «pasar a acciones» aparte. **Lo destapó el sembrador de este mismo bloque**: escribió
el avance de estado antes que la acción y la función lo rechazó — que es exactamente lo que le
pasaría a quien use la pantalla. Un estado que hay que empujar a mano después de haber hecho el
trabajo es un estado que se queda atrás, y entonces el panel cuenta mal.

### Quién firma, y quién no puede

Abre y trabaja una NC quien tenga categoría `DIRECTIVO` **o el rol `CALIDAD`** (D-73). Las dos, y no
sólo la primera, porque en Jardín de Gredos quien lleva la calidad es la terapeuta ocupacional con
el rol `CALIDAD`: exigir categoría directiva habría dejado fuera a la única persona que hace este
trabajo.

**El OWNER sin rol de cuidado puede LEER pero no FIRMAR.** Lo que una NC guarda no es «lo hizo el
dueño de la cuenta» sino «lo hizo Ana Isabel como responsable de calidad», que es lo que un auditor
lee. Quien dirige el centro tiene su rol `DIRECCION` (D-61) y firma con él.

Y **la eficacia la verifica una persona distinta de quien cerró la última acción**, en el trigger
`effectiveness_verifications_otra_persona`, que además exige que haya alguna acción cerrada: no se
verifica la eficacia de lo que no se ha hecho. Aquí sí se **prohíbe** en vez de marcarse, al revés
que el autocierre de una incidencia N1: una incidencia de madrugada la cierra quien está sola en el
centro, pero una verificación de eficacia se firma con semanas de margen.

### Append-only, y la causa se escribe una vez

La clase, el origen, la descripción y quién la abrió no se cambian ni por SQL. La **causa se escribe
una sola vez**: una causa que se reescribe es una causa que se acomoda al resultado. Las acciones se
escriben y se cierran, y una cerrada no se reabre. Las evidencias y las verificaciones no admiten ni
`UPDATE` ni `DELETE`.

Lo que **sí** cambia, y es deliberado: el estado, la causa (una vez), **el proceso** —reasignar es
lo que permite desactivar un proceso sin perder nada— y el informe adjunto, que llega cuando llega.

---

## 5 · Elevar una incidencia (D-38), en los dos sentidos

`non_conformities.source_incident_id`, `Restrict`. Es **UNA fila leída desde los dos lados**, como
los `incident_links` del libro: desde la NC dice de qué incidencia salió, desde la incidencia dice en
qué NC acabó (`Incident.nonConformities`). Y la incidencia que originó una NC ya no se puede borrar.

El CHECK `non_conformities_origen_incidencia` impide un origen `INCIDENT` o `COMPLAINT` sin la
incidencia detrás: «salió de una queja» sin decir de cuál no se puede volver a mirar.

---

## 6 · La propuesta (D-74): propone, no crea

Dos meses **completos** seguidos fuera de umbral → el panel propone, con el enlace que lleva el
indicador, el mes y el proceso. La pantalla de no conformidades abre el formulario con los tres
puestos.

**Dos meses cerrados y no el que va**: el mes en curso se mide «hasta ahora» (residencia-5 §9) y eso
está bien para el panel, pero una propuesta de abrir una NC el día 2 —sobre tres días de datos— es
ruido que enseña a la dirección a ignorar las propuestas.

**Y sin dato no es estar fuera**: un centro que dos meses no tuvo gimnasia planificada no incumple
nada. Es el mismo principio que «sin dato no es cero», llevado a la propuesta.

La propuesta desaparece cuando alguien abre la NC (se busca por `origin = INDICATOR` y el mes). Si
la rechazan, vuelve a salir el mes que viene, y eso es correcto: el centro sigue fuera de umbral.

El e2e mide lo que de verdad importa: **mirar el panel no crea ni una NC**.

---

## 7 · El PAC (D-75)

`GET /residencia/calidad/pac.pdf` y `…/informe-nc.pdf`, el mismo documento con dos niveles de
detalle. Filtrables por origen, proceso y periodo, **y el filtro va impreso en el papel**: un PAC que
no dice de qué auditoría es y entre qué fechas es un papel que el año que viene nadie sabe colocar.

- El **PAC** lleva por defecto sólo las que siguen abiertas: es el plan que se manda fuera.
- El **informe** lleva todas, el recuento por clase, origen y estado, y las **verificaciones de
  eficacia** — que en el PAC estorban: un «no eficaz» en el documento que se entrega sería contar el
  final antes de llegar.

Los dos botones de la pantalla **arrastran el filtro que se está viendo**. Rellenar un segundo
formulario sería la forma de que el papel diga otra cosa que la pantalla.

El test que importa es que **lleva todas las del filtro y ninguna más**, y se lee con `pdf-parse`:
buscar la referencia en los bytes del PDF no encuentra nada porque pdf-lib comprime el flujo, y un
test que no encuentra nada pero pasa porque busca lo contrario es peor que no tenerlo.

---

## 8 · Lo que encontró el bucle visual

1. **El PAC devolvía 500.** `WinAnsi cannot encode "→" (0x2192)`: pdf-lib no pinta un cuadradito ni
   se lo salta, **lanza**. El carácter venía del texto de una NC, y lo escribe quien redacta el
   hallazgo — flechas, comillas de un copiar y pegar, un emoji. Es el peor momento posible para que
   un PDF falle. Se arregla con `saneado()` en `documento-a4.ts`, aplicado **donde se mide**
   (`wrap`, que es la llamada que lanza) y donde se pinta: la flecha pasa a `->` y lo que no tiene
   equivalente sale como `?`. Un carácter que desaparece en silencio de un documento legal es peor
   que uno que se ve raro.
2. **La propuesta del panel no llevaba el origen puesto.** D-74 dice «con el origen ya rellenado» y
   el enlace iba a la lista pelada. Una propuesta que obliga a teclear lo mismo no ahorra nada.
3. **«1 indicadores», «1 objetivos», «1 NC abiertas»** en las tarjetas del mapa. No es cosmética: es
   la pantalla que la directora enseña en la auditoría.

Lo que el bucle midió y salió bien: **cero errores de consola** y **cero desbordamiento horizontal**
a 1440 px y a 390 px.

---

## 8b · Dónde vive calidad tras `residencia-cuadro-de-control`

Ese bloque dejó el menú de una residencia en **cinco entradas del día a
día más «Configuración»**, y midió el panel contra **1366×768 sin
scroll**. calidad-1 se coloca dentro de esa forma, no al lado.

### El mapa y las NC están en «Configuración», no en el menú

Y **no hace falta marcarlas**: `residencia-cuadro-de-control` descartó a
propósito una bandera `enConfiguracion` porque la primera entrada a la
que se le olvidara se quedaba sin forma de llegar, en verde y sin que
nadie lo notara (lo encontró su banco con «Bonos»). Lo que enseña
«Configuración» es **todo lo que pasa el filtro y no es una de las
cinco**, así que estas dos caen ahí por estar en `NAV_ITEMS` y no en
`MENU_DE_RESIDENCIA`.

Es además lo correcto: el mapa se ajusta una vez al año y las no
conformidades se trabajan por semanas. Van pegadas a «Indicadores» en el
orden de la página —el mapa es de dónde cuelgan, las NC es a dónde van
los que se salen del umbral dos meses— y el banco de este bloque lo fija
en los dos sentidos: que **no** están en el menú y que **sí** están en
Configuración, en ese orden.

### Y el panel: 217 px que había que devolver

Medido con la stack de verdad a 1366×768, con el centro del sembrador:

| | alto del panel |
| --- | --- |
| calidad-1 tal y como venía | **1 124 px** |
| …sin su banda de calidad | 1 047 px |
| …y con la fila de indicadores a seis | 907 px |
| **después de este arreglo** | **964 px** |

Dos cosas eran de este bloque y las dos se devuelven:

1. **140 px de la fila de indicadores.** calidad-1 los subió de 6 a 13 y
   la fila de `lg:grid-cols-6` pasó de uno a tres renglones. Es
   exactamente lo que la regla de ese bloque prohíbe: «lo que pasa de
   cuatro o cinco elementos se ve con *Ver…*, porque una sección que
   crece con el centro deja de caber». Ahora la fila son **seis**, con
   **los que piden algo primero** (fuera de umbral, después dentro, y al
   final los que no tienen dato) y el enlace diciendo cuántos hay. El
   recuento del encabezado sigue siendo sobre los trece, así que la
   cifra no miente aunque la fila esté recortada. Y el catálogo seguirá
   creciendo —quedan trece nombrados sin dato—, así que la fila no podía
   depender de él.
2. **La sección de calidad pasa a ser una banda**, la misma forma que
   `LoQueHayQueArreglar`: `null` cuando no hay nada y dos renglones como
   mucho cuando lo hay. De 77 px a **46**.

**Con el centro al día la banda no se pinta y el panel mide exactamente
lo que medía sin este bloque.**

### Lo que sobra y NO es de aquí

Quedan **139 px** de scroll, y son del panel de master con este centro
sembrado: **sin la banda y con la fila a seis, mide 907**. El sembrador
es ruidoso a propósito (cinco obligaciones vencidas, doce incidencias
abiertas, cuatro relevos sin confirmar) y el bloque que lo midió dice
«cabe en 1366×768 **con datos normales**». Queda anotado aquí porque
alguien tendrá que decidir si un centro así es «datos normales»; lo que
este bloque podía devolver, lo ha devuelto.

---

## 9 · La tabla de sabotajes

Todo contra Postgres, en `apps/api/test-e2e/calidad-1.e2e.ts`.

| Sabotaje | Qué lo para | Mensaje |
| --- | --- | --- |
| `UPDATE` de la **clase** de una NC | trigger `non_conformities_inmutable` | «la clase, el origen, la descripción y quién abrió… no se cambian» |
| `UPDATE` del **origen** | el mismo trigger | igual |
| `UPDATE` de la **descripción** | el mismo trigger | igual |
| **Borrar un proceso con una NC** colgando | FK `Restrict` | `violates foreign key constraint` |
| **Texto en claro** en la descripción | CHECK `non_conformities_description_cifrado_formato` | el formato `^c[0-9]+:…` |
| **Cerrar por SQL sin verificación** | **el trigger**, que mira `effectiveness_verifications` | «no se cierra sin una verificación de eficacia con resultado EFFECTIVE» |
| **Verificar siendo quien cerró la última acción** | trigger `effectiveness_verifications_otra_persona` | «una persona DISTINTA de quien cerró la última acción» |
| **Reabrir** una NC cerrada | trigger | «una cerrada no se reabre» |
| **Borrar** una NC | trigger | «no se borra» |
| **Editar o borrar** una verificación | trigger `..._append_only` | «se añade, no se edita ni se borra» |
| **Reabrir o borrar** una acción cerrada | trigger `corrective_actions_append_only` | — |
| **Nivel de riesgo mentido** (3×3 = 1) | CHECK `risk_opportunities_nivel_coherente` | — |
| Probabilidad **4** | CHECK `risk_opportunities_probabilidad_1_3` | — |
| Riesgo **sin proceso** por SQL | `NOT NULL` (SQLSTATE 23502) | — |
| Origen `COMPLAINT` **sin incidencia** | CHECK `non_conformities_origen_incidencia` | — |

**La pregunta del prompt, contestada:** cerrar una NC sin verificación **lo para el motor**, no sólo
la ruta.

---

## 10 · Decisiones tomadas sin preguntar

1. **`indicator_processes` es una tabla aparte de `indicator_targets`.** Son dos cosas con dos
   vidas: el umbral existe **sólo cuando el centro lo cambia** —residencia-5 decidió a propósito no
   sembrarlo, para que «un umbral sembrado y nunca revisado» no se confunda con uno que la dirección
   eligió— y el proceso tiene que estar **siempre**. Juntas, colgar un proceso habría obligado a
   sembrar un umbral y a romper esa distinción.
2. **Los objetivos de calidad ENTRAN.** El prompt los condicionaba a «si caben sin pantalla nueva».
   Caben: son una sección más de la ficha del proceso, con la misma forma que los riesgos. Los
   cuatro de 2026 de Jardín de Gredos están en el sembrador. El seguimiento anual con su borrador de
   revisión por la dirección sigue siendo calidad-2.
3. **El plazo de respuesta de una queja (15 días naturales) es del producto, no del centro.** Lo que
   el centro elige es el porcentaje que da por bueno. Un centro que pudiera estirar el plazo a
   sesenta días cumpliría el 100 % sin cambiar nada.
4. **La ocupación cuenta las camas de hoy, no las de cada día.** `beds.active` es una columna, no
   una vigencia: reconstruir «cuántas camas había el 3 de marzo» sería inventárselo. Queda dicho en
   el `deDonde` del indicador y en la pantalla, porque un auditor pregunta por el denominador.
5. **La plantilla de la rotación se aproxima** como «activos al cierre + bajas del mes». La tabla de
   personal no guarda la plantilla día a día. Igual: dicho donde se lee.
6. **La referencia de una NC la pone el sistema** (`NC-<año>-<nn>`), no el usuario: una referencia
   que se teclea acaba repetida, y el PAC la usa para nombrar cada fila delante del auditor. La
   carrera entre dos personas la pierde el índice único y se reintenta una vez.
7. **El panel calcula DOS meses más de indicadores** para la propuesta, dentro del mismo
   `Promise.all`. Triplica el trabajo en la base y no el tiempo de espera. Se paga por el
   presupuesto de lectura del bloque C §1: una propuesta que hay que ir a buscar a otra pantalla es
   una propuesta que nadie ve. Como se calcula sobre meses cerrados, el resultado es el mismo todo
   el mes: es el candidato natural a una caché el día que 49 plazas sean 500. **Hoy no la tiene.**
8. **Tres índices parciales se quedaron en dos enteros.** `risk_opportunities` y
   `corrective_actions` son tablas de decenas de filas: el parcial no ahorra nada y Prisma no sabe
   declararlo, así que serían dos índices para la misma consulta y una deriva permanente en
   `migrate diff`. El de `non_conformities` sí se queda parcial porque indexa una pareja de columnas
   que ningún índice de Prisma cubre.
9. **El mapa de referencia cae a `DIRECCION`** si un centro desactivó el rol que el proceso nombra.
   Fallar la carga habría dejado sin mapa a un centro por no tener fisioterapeuta.
10. **El sembrador tiene un guardia** («si ya hay una NC, no hagas nada») y es el único del fichero.
    La referencia es «la siguiente libre del año», así que correrlo dos veces abriría cinco NC más;
    y borrarlas para rehacerlas tiraría evidencia, que es justo lo que el trigger impide.

---

## 11 · Lo que NO cubre este bloque

Todo §4-§8 de `07-calidad-iso.md`, que es **calidad-2**: auditorías como entidad y plan anual,
documentos versionados con lectura confirmada, partes interesadas, revisión por la dirección,
memoria anual de la JCCM, paquete de evidencias, encuestas, cuadrantes y ratio de personal.

Y dentro de lo que sí toca:

1. **El PAC no se adjunta solo a una obligación de dirección.** El «PAC a los 30 días del informe de
   AENOR» es una obligación disparada por un HECHO, y las disparadas por hecho siguen sin existir
   (`obligaciones-de-serie.ts` lo dejó dicho). Hoy el PAC se genera a mano desde la pantalla.
2. **Una NC no abre ni cierra nada en el libro de incidencias.** Elevar conserva el enlace y nada
   más: cerrar la NC no cierra la incidencia, y es deliberado — son dos ciclos con dos dueños.
3. **Los riesgos no tienen histórico de revisiones.** `reviewed_at` y `reviewed_by_user_id` se
   sobrescriben: se sabe quién hizo la última, no las cinco anteriores. Un `RiskReview` append-only
   es calidad-2 si la auditoría lo pide.
4. **El informe adjunto de una NC no se versiona.** Subir otro pisa el anterior y el fichero viejo
   se queda huérfano en el volumen hasta que pase el barrido.
5. **Consentimiento, informe clínico y declaración responsable tienen llamadas directas a
   `drawText`** con la misma exposición al carácter no codificable. `wrap` ya los protege en el
   camino común —que es por donde va casi todo su texto— pero las directas no. Son tres líneas y no
   se tocan aquí porque son de otros bloques.

---

## 12 · Dudas abiertas

1. **¿El umbral del 98 % de cumplimentación es el bueno?** Con 49 residentes y tres turnos son unas
   cuarenta mil ocurrencias al mes: el 100 % sale en rojo el primer día que alguien se pone malo, y
   el 98 % permite ochocientos huecos. Lo tiene que mirar Ana Isabel con un mes de datos reales
   delante.
2. **¿La clase de una NC propuesta por un indicador debería venir sugerida?** Hoy el formulario la
   deja en «NC menor» y la decide la persona. No está claro que un indicador fuera de umbral dos
   meses sea siempre una NC menor y no una observación.
3. **¿Hace falta un estado «no procede» para una propuesta rechazada?** Hoy vuelve a salir el mes
   siguiente. Es correcto mientras el centro siga fuera de umbral, pero con un indicador que el
   centro ha decidido no perseguir este año es ruido mensual.
4. **La cláusula ISO es texto libre.** De serie se ponen 4.4, 6.1, 9.1.3 y 10.2 donde aplica, pero
   nadie valida que «4.4.1» exista. Un catálogo de cláusulas es trabajo de calidad-2, que es quien
   las necesita para el paquete de evidencias.
5. **¿Quién revisa los riesgos de serie?** Vienen con probabilidad e impacto del producto y una
   revisión a 3 o 6 meses. Si el centro no los toca, el panel los sacará en rojo y la dirección
   aprenderá a ignorarlo. Conviene que Matías los pase con la directora antes del piloto.

---

## 13 · Las capturas

`docs/blocks/calidad-1-shots/`, con el sembrador montado:

| Fichero | Qué enseña |
| --- | --- |
| `01-panel-con-calidad.png` | El panel entero, con el bloque de calidad y las cuatro propuestas |
| `02-mapa-de-procesos.png` | El mapa, en sus tres filas, con lo que cuelga de cada proceso |
| `03-proceso-abierto.png` | Un proceso con sus indicadores, riesgos, objetivos y NC |
| `04-registro-de-nc.png` | El registro filtrable |
| `05-nc-1…5-*.png` | **Una NC en cada uno de los cinco estados** del ciclo |
| `06-indicadores.png` | Los trece con su proceso, y la cumplimentación por turno y zona |
| `07-indicador-abierto-hasta-sus-registros.png` | Un indicador abierto hasta su lista |
| `08-propuesta-desde-un-indicador.png` | La propuesta del panel, con el origen ya relleno |
| `09-mapa-390.png` · `10-nc-390.png` | A 390 px |
| `11-pac-plan-de-acciones-correctivas.pdf` | **El PAC**, en PDF de verdad |
| `12-informe-de-no-conformidades.pdf` | Y el informe del periodo |

Los dos últimos son PDF y no PNG a propósito: **un PDF es el entregable**, y una foto de un visor de
PDF no lo es.

---

## 14 · Cómo se cierra

- **Migración aditiva del todo**, con su `down` escrito y probado: ocho tablas, siete tipos y **ni
  un `ALTER TABLE` sobre una tabla con filas de producción** — la primera de residencia que lo
  consigue. Aplicada, revertida y vuelta a aplicar **sobre una copia con datos de residencia-1 a
  -6** (`mipiacetpv_calidad1_copia`), con los 3 residentes, las 12 incidencias y los 108 registros
  intactos. Y `migrate diff` contra el esquema **no añade ni una línea** de este bloque: la única
  deriva que queda es la que los padres ya traían.
- **Suite entera: 428 ficheros, 6 254 tests verdes** (eran 6 168). Dos inventarios crecen con el
  bloque y los dos han hecho su trabajo: las columnas cifradas con CHECK pasan de 24 a 30
  (`residencia-1b-cifrado` y `clinica-7.e2e`) y los indicadores de 6 a 13 (`residencia-5.e2e`, con
  la aserción cambiada a `slice(0, 6)` para que siga diciendo lo que decía).
- **e2e contra Postgres: 49 ficheros, 1 127 tests verdes**, con `calidad-1.e2e.ts` (49 tests)
  dentro.
- **`pnpm e2e:agenda`**: **31 verdes y 4 rojos**, y los cuatro son exactamente los que
  `residencia-6-done.md` §13 ya documenta como rojos en master (capítulo 8 ×2 por el título que
  cambió en v1.15, el 9 que cae detrás y el 12 por un locator ambiguo). Está **como estaba**.
- **Bucle visual** con la stack de verdad (API, Postgres y el admin), once capturas y los dos PDF.
- `.ficheros-clinicos/` sigue fuera del repo; el sembrador no escribe ningún fichero (sus evidencias
  son notas).
- `UserRole` no gana valores. Nada de salud en logs.

### Qué hay que hacer al desplegar

1. **Aplicar la migración** `20261022000000_calidad_1_mapa_riesgos_y_nc`. Es aditiva: no toca
   ninguna tabla con filas y no necesita ventana.
2. **Nada se enciende solo.** Un centro con la residencia encendida ve dos entradas nuevas en la
   barra (Procesos y No conformidades) y, al abrir la primera, el botón de cargar el mapa. Hasta que
   alguien lo pulse, el bloque de calidad del panel no aparece y los indicadores dicen «sin
   proceso».
3. **El orden importa**: primero el mapa, después las NC. Una NC cuelga de un proceso, y la pantalla
   de no conformidades no deja abrir ninguna sin mapa (manda a cargarlo).
4. **El barrido de huérfanos ya cuenta las dos tablas nuevas.** Si se despliega el barrido sin este
   cambio, borraría los informes adjuntos de las NC y las evidencias de las acciones por no
   encontrarlos referenciados. Van juntos.
5. Revisar con la dirección los **cuatro riesgos de serie** y los **umbrales** antes de que la
   primera revisión venza (duda abierta 5).

---

## 15 · Commits

| Commit | Qué |
| --- | --- |
| `0db219c` | D-70 a D-76 en `00-decisiones.md` |
| `544f1cb` | El mapa, los riesgos y el ciclo de la NC: migración y esquema |
| `d111789` | Las reglas puras: bandas, ciclo y los siete indicadores |
| `0135fe0` | La API: mapa, riesgos, NC, indicadores y PAC |
| `e1946bc` | El sembrador con el escenario de la auditoría 2026 |
| `a95a129` | Las cuatro pantallas y el panel |
| `ac28a71` | El contrato del SQL, el e2e del ciclo y las pantallas |
| `e83f813` | Los dos inventarios que crecen con el bloque |
| `9779ed5` | Lo que encontró el bucle visual, y las capturas |
| `457375d` | El PDF no revienta con un carácter que la fuente no sabe escribir |
