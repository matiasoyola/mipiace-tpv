# Bloque alta-minima · done

**El día que la primera residencia real se encendió en producción.** El 23-10-2026 Jardín de Gredos
—cliente cero— arrancó en producción y llegó su listado: **43 residentes con nombre y tipo de plaza,
y nada más**.

Con `admissionDate`, `dependencyLevel` y `placeType` obligatorios, ese listado **no entra en el
programa**. Y un residente que no está en el programa no aparece en la puerta, no se le puede apuntar
«algo no va bien» y el relevo no lo ve. La señora ya vive allí y ya hay que atenderla: no saber su
fecha de ingreso no hace que necesite menos cuidados.

Este bloque invierte eso. **Para crear un residente basta con el nombre**, lo que falta pasa a ser
dato y el programa **no deja de recordarlo** hasta que la ficha esté completa — en los cuatro sitios
donde mira la dirección y en ninguno donde mira una auxiliar.

Va **antes de historia-1**, que construye el ingreso guiado completo (`AdmissionChecklist`, D-94) en
su propia rama. Ver §10.

---

## 1 · `datosQueFaltan`, en el paquete puro

`packages/residencia-plan/src/datos-que-faltan.ts`. Una función pura con una tabla dentro: recibe la
presencia de cada dato y devuelve la lista de lo que falta, **ordenada**, cada elemento con su
`campo` (código estable), su `etiqueta` y su `peso`.

Está en el paquete puro por lo mismo que `queToca` y `gravedadDe`: **lo ejecutan dos sitios que
tienen que decir lo mismo** — la API (la etiqueta de cada fila, la banda de la ficha, la tarjeta del
panel, la obligación del mes) y el admin (la vista previa del alta rápida). Y porque añadir un campo
mañana es **una línea de esa tabla**, que es el criterio que el bloque pide.

### La tabla

| Campo | Peso | Por qué |
|---|---|---|
| `apellidos` | imprescindible | El alta rápida los deja vacíos a propósito (§4) |
| `fechaDeIngreso` | imprescindible | |
| `nivelDeDependencia` | imprescindible | Sin él **no hay plan** (§3) |
| `tipoDePlaza` | imprescindible | |
| `dni` | imprescindible | Sin DNI el expediente no está completo para una inspección |
| `familiarResponsable` | imprescindible | A quién se llama si pasa algo |
| `telefonoDelFamiliar` | imprescindible | Sólo **cuando ya hay familiar** |
| `planDeCuidados` | imprescindible | Sin plan no le toca nada y no cuenta en los indicadores |
| `gradoReconocido` | **depende de la plaza** | Concertada: imprescindible. Privada o temporal: recomendable |
| `nss` | recomendable | |
| `fechaDeNacimiento` | recomendable | |
| `cama` | recomendable | Un ingreso pendiente es legítimo (residencia-1) |

### Las dos reglas que no son «está o no está»

1. **El grado reconocido depende de la plaza.** En concertada, **sin grado no se factura a la
   Junta**: pasa a imprescindible. Con la plaza todavía sin poner se queda en recomendable, y sube
   solo el día que la dirección ponga «concertada». Asumir lo peor habría puesto un imprescindible
   rojo en las 43 fichas del primer día por un dato que depende de otro que tampoco está.
2. **El teléfono del familiar se pide cuando hay familiar.** Sin nombre, lo que falta es el familiar
   — pedir «su teléfono» antes de saber quién es sería un aviso que no se puede cerrar.

### Lo cifrado se cuenta SIN descifrarlo

`tieneDni` y `tieneNss` entran como **booleanos de presencia**. Contar que falta un DNI no exige
abrir la clave del centro: basta con saber si la columna es NULL (decisión 8 del bloque). La función
no toca una clave en su vida, y por eso puede correr también en el navegador. Un centro con la DEK
perdida cuenta igual de bien lo que le falta.

Y la consecuencia en la API: `resident_profiles.dni_cifrado` y `.nss_cifrado` **entran en el `select`
de la lista**, donde el DNI nunca ha entrado. La regla del fichero no se rompe porque la regla es
**qué sale en la respuesta**, no qué se lee de la base: lo único que sale de ahí es un booleano. Un
e2e lo fija (`la lista no lleva DNI ni `c1:``).

### Y el resumen del centro

`resumenDeFichas(porResidente)` → `{ total, incompletas, datosPendientes, conImprescindibles }`.
Recibe listas y no residentes, así que la API lo llama con lo que ya calculó para la respuesta: no
cuesta ni una consulta más.

**20 tests de tabla** en `packages/residencia-plan/test/datos-que-faltan.test.ts`: ficha vacía (los
once datos, en orden), ficha completa (ni uno), concertada sin grado frente a privada sin grado, sin
plan, con DNI cifrado presente, el familiar sin teléfono y el centro entero sin empezar (43 × 11 =
473 datos pendientes).

---

## 2 · La migración · sólo nulabilidad, y un CHECK que se habría apagado solo

`packages/db/prisma/migrations/20261023000000_alta_minima/`. Tres `DROP NOT NULL` y nada más: ni una
tabla, ni un `DELETE`, ni un `UPDATE`. Las filas que ya estaban se quedan exactamente como estaban.

**Y lo que se encontró de paso.** `resident_profiles_alta_coherente` llevaba desde residencia-1:

```sql
("discharge_date" IS NULL OR "discharge_date" >= "admission_date")
```

Con `admission_date` a NULL esa comparación da **NULL**, y **un CHECK que da NULL pasa**. O sea: la
mitad de «una fecha de alta anterior al ingreso es un error de dedo que luego sale en un informe a la
Consejería» se habría apagado sola para todas las fichas nuevas, en verde y sin que nada se pusiera
rojo. Ahora la condición está escrita entera, con su `IS NULL` delante:

```sql
AND (
    "discharge_date" IS NULL
    OR "admission_date" IS NULL
    OR "discharge_date" >= "admission_date"
)
```

Lo que queda dicho es exactamente lo que se quiere decir: sin fecha de ingreso no hay nada que
comparar y el alta pasa (es legítimo — el residente ya estaba aquí cuando llegó el programa); con las
dos, la de alta no puede ser anterior.

**Y se parte de la ÚLTIMA definición**, la de residencia-1b (que amplió la primera mitad a la columna
cifrada), no de la de residencia-1. Un `DROP` + `ADD` desde la primera habría borrado en silencio la
mitad que mira `discharge_reason_cifrado`. El test lo ata a las dos migraciones.

El mismo `IS NOT NULL` hacía falta en el handler del alta de salida: `dischargeDate < null` compara
contra el 1 de enero de 1970 y **ninguna fecha sería anterior**, así que la comprobación seguiría
ahí, en verde, sin comprobar nada.

### El `down`

Escrito en la cabecera, como en toda la casa. **Falla con un mensaje** si hay filas a NULL en vez de
rellenarlas: inventarle una fecha de ingreso a 43 residentes es escribir un dato falso en la ficha de
una persona. El mensaje dice cuántas son y dónde completarlas.

**15 tests** en `apps/api/test/alta-minima-migracion.test.ts`: las tres columnas y ninguna más, el
`IS NULL` del CHECK, la mitad de residencia-1b conservada, el `down` escrito, que es aditiva y que no
crea ninguna tabla (es lo que promete para no pisar a historia-1).

---

## 3 · Sin nivel no se precarga plan

`aplicarPlantilla` necesita un nivel para saber **qué** plantilla aplicar. Sin él, el residente nace
sin plan, y eso no lo deja fuera de nada:

- **la puerta** lo enseña igual, con su nombre y su habitación;
- **«como siempre» y «algo no va bien» funcionan**, porque las dimensiones OBS son del centro y no
  del plan;
- **el parte lo enseña sin ruido** (residencia-6 §4): ni una línea de «no hecho», porque no hay nada
  que incumplir.

Lo que sí hace es **entrar en lo que le falta** como imprescindible. Y lo que **no** se hace es
elegirle un nivel por defecto: «válido» a quien nadie ha valorado es un dato falso en la ficha de una
persona, y además le abriría el plan equivocado.

### Al poner el nivel, la ficha lo OFRECE

`POST /residencia/residentes/:clientId/plan/plantilla` → «Cargar el plan de cuidados de
«dependiente»», un toque.

**Es una ruta y no un efecto del PATCH, y es una decisión.** Cuando esto ocurre, la dirección está
corrigiendo cuarenta y tres fichas de golpe desde la tarjeta del panel. Que teclear un dato
administrativo escriba de paso veinte líneas de plan —cada una una fila con su motivo cifrado— es una
escritura grande y silenciosa que nadie pidió, **y que no se deshace con un botón**: las líneas del
plan se cierran, no se borran. Y a quien la DUE ya le había puesto líneas a mano le cambiaría el plan
sin decírselo.

Así que el PATCH devuelve `puedeCargarPlan: { nivel }` y la ficha pinta el botón. Mientras no se
cargue, «Plan de cuidados» sigue en lo que falta: no se puede olvidar.

**Idempotente, y no por un `if`:** `aplicarPlantilla` con `nivelAnterior: null` no cierra nada y no
abre una línea de un control que ya tiene una viva, sea de plantilla o manual. Dos toques no duplican
el plan ni pisan lo que la DUE puso a mano.

**El cambio de nivel de residencia-2 no se toca:** de «válido» a «dependiente» sigue recalculando en
la misma transacción. Lo nuevo es sólo el caso `null → X`.

---

## 4 · El alta rápida de varios

`POST /residencia/residentes/varios`. Se pega una columna de nombres —uno por línea, el tipo de plaza
opcional detrás de un tabulador— y se crean.

### El parser vive en el paquete puro

`packages/residencia-plan/src/nombres.ts`: `claveDeNombre`, `enFormatoDeNombre` y `lineasPegadas`.
Ahí porque **la vista previa del admin y la idempotencia del servidor tienen que decidir lo mismo**.
Con dos normalizaciones, la pantalla diría «se crean 40» y el servidor crearía 41 — y sólo en los
casos raros, que son los que nadie prueba a mano («Mª ÁNGELES  LÓPEZ» con dos espacios).

- `claveDeNombre`: sin tildes (`NFD` + quitar diacríticos, no una tabla de `á→a` que se olvida de la
  `ü` de «Begoña Agüero»), sin mayúsculas y sin dobles espacios.
- `enFormatoDeNombre`: «ABEL RAMOS DOBLADO» → «Abel Ramos Doblado». **Sólo para enseñar.** Y sólo si
  la línea no tiene ninguna minúscula: un nombre escrito a mano («Mª Ángeles de la Torre») se deja
  como está, porque tocarlo haría «De La Torre». Las partículas se quedan en minúscula, salvo la
  primera palabra («DEL RÍO MUÑOZ» → «Del Rio Muñoz»).

**Lo que NO hace es adivinar el orden de los apellidos.** «RAMOS DOBLADO, ABEL» y «ABEL RAMOS
DOBLADO» son dos personas distintas para esta función, y es a propósito (decisión 7): un duplicado
que se cuela se arregla en la ficha; **dos residentes fusionados por un apellido parecido parten dos
historias clínicas**.

### Idempotente por nombre normalizado

Quien pega 43 nombres y ve un error de red **vuelve a darle**. Sin idempotencia, el segundo intento
crearía 43 duplicados: dos fichas de la misma señora, dos historias y dos planes — y **un residente
no se borra** (las FKs son `RESTRICT` desde residencia-1).

Y mira a **todos** los residentes del centro, también a los que se fueron: una señora dada de alta en
2019 que vuelve a ingresar no necesita una ficha nueva, necesita que le quiten la fecha de alta. El
motivo lo dice la respuesta, para que se pueda arreglar sin adivinar.

La clave se calcula sobre el **nombre completo** (`firstName` + `lastName`), no sobre `firstName`: si
no, el segundo pegado del mismo listado duplicaría justo a los que la dirección ya había completado.
Hay un e2e para eso.

### Una transacción por residente, no una para los 43

Con una sola, un fallo en el residente 40 —una carrera con otra sesión, un tipo de plaza que el enum
no conoce— dejaría al centro con **cero** residentes después de dos minutos de trabajo, y la
dirección volvería a pegar la lista sin saber qué pasó. Con una por residente, lo que no entra se
nombra y los demás están dentro.

Es la decisión **contraria** a la del alta de uno (donde el `Client` y su perfil van juntos o no van),
y por la misma razón: allí la mitad sin la otra es basura; aquí cada línea es una persona entera.

### Los nombres se guardan COMO VIENEN, y los apellidos quedan vacíos

Decisión 7 del bloque, entera: todo va a `firstName` tal cual (las mayúsculas del Excel incluidas,
porque el original es lo que coincide con el papel que la dirección tiene delante) y **«apellidos»
queda como dato que falta**, para que la dirección lo corrija una vez. Se enseñan en formato de
nombre.

### El límite: 300

No es un número redondo. La residencia más grande de la provincia tiene 180 plazas y el centro cero
tiene 43; 300 deja sitio de sobra para el listado entero de cualquiera, con sus repetidos dentro.

Lo que protege no es la base —300 altas son 300 transacciones cortas— sino **pegar la columna
equivocada**: una hoja de 2.000 filas de registros de comida convertida en 2.000 residentes es un
centro que hay que limpiar a mano fila por fila, porque un residente no se borra. El mensaje dice qué
hacer y que repetir no duplica.

---

## 5 · Avisar mucho, y que el aviso lleve al campo

El filtro «¿y qué?» de cada aviso: **tiene que llevar a completar el dato con un toque**, no sólo
decir que falta.

| Dónde | Qué |
|---|---|
| **Lista de residentes** | Etiqueta «Faltan 4 datos» por fila (**roja** si falta algún imprescindible, ámbar si no) · «2 de 3 fichas incompletas · 12 datos pendientes» arriba · filtro **«Sólo incompletas», puesto por defecto** |
| **Ficha** | Banda arriba: «A esta ficha le faltan: fecha de ingreso, DNI, familiar responsable». **Cada dato es un enlace que enfoca su campo.** Se va sola cuando está completa |
| **Panel de dirección** | Tarjeta fija y **arriba del todo** mientras quede alguna: «12 fichas de residentes incompletas · 31 datos pendientes», con «Completar» y los primeros nombres |
| **Obligaciones del mes** | Obligación viva del centro, **sin fecha de vencimiento inventada** |
| **Puerta y relevo** | **Nada.** Decisión 4 |

### El filtro puesto por defecto

Es la decisión que más se nota. Una residencia que acaba de cargar su listado tiene **43 de 43**
incompletas, y lo que la dirección va a hacer durante dos semanas es cerrarlas. Cuando no quede
ninguna, **la casilla desaparece de la pantalla** y la lista vuelve a ser la lista.

El estado nace `null` («lo que decida la pantalla») y no `true`, para poder distinguir «la dirección
lo ha quitado» de «todavía no ha tocado nada»: con `true` a secas, cada recarga se lo volvería a
poner encima.

### Los enlaces de la banda, y el orden que importa

Cada dato de la banda enfoca su campo. El mapa `campo → id del input` vive en el admin
(`ANCLA_DEL_CAMPO`), no en el paquete: es cosa de la pantalla. Y es un `Record` completo, no un `?.`,
para que el compilador avise el día que historia-1 añada un campo sin ancla.

**El foco va primero y el scroll después y protegido**, y lo encontró el banco: `scrollIntoView` no
existe en jsdom, así que ponerlo delante tiraba el handler entero y el enlace no enfocaba nada. De
las dos cosas, la que hace que el aviso sirva es el foco — y el grupo del nivel y el de la plaza
llevan `tabIndex={-1}` justo para que el borde de foco diga a qué dato ha llevado el enlace.

### El formulario está en la MISMA ficha

Y no detrás de otro botón: un «Editar» que abre un segundo modal encima del primero deja el aviso en
la pantalla de atrás, y entonces los enlaces no pueden llevar a ningún campo.

**Manda sólo lo que ha cambiado.** No es una optimización: el PATCH **recalcula el plan de cuidados**
cuando el nivel cambia, así que reenviar los doce campos con el mismo nivel es la diferencia entre no
tocar nada y abrirle veinte líneas a alguien. Y guardar sin tocar nada no manda nada: es un doble
toque.

### «Siguiente incompleta»

Recorrer cuarenta y tres fichas volviendo a la lista entre cada una son **tres toques de más por
ficha, 129 en total**. El botón abre la siguiente sin salir del modal, en el orden de la lista
(apellidos) y empezando por detrás de la que está abierta; si no queda ninguna por detrás, vuelve a
empezar por arriba. Y **no se pinta en la última**: un botón que cierra el modal sin decir por qué
deja a la dirección pensando que se ha perdido algo.

Se calcula sobre lo que se acaba de recargar y no sobre el estado viejo: la ficha que se acaba de
guardar puede haber dejado de estar incompleta.

### `?completar=<clientId>`

Por donde entra «Completar» de la tarjeta del panel. **Se consume** (se quita de la URL) al abrir la
ficha: si se quedara, cerrar el modal la volvería a abrir y la dirección no podría salir.

### El PATCH gana los cuatro campos del `Client`

`firstName`, `lastName`, `phone` y `birthdate` viven en `clients`, no en el perfil. Sin ellos, el
aviso «a esta ficha le faltan los apellidos» **no tendría dónde arreglarse** — y los apellidos quedan
vacíos a propósito en el alta rápida. Van en la **misma transacción** que el perfil: con dos
escrituras sueltas, guardar la ficha podría dejar los apellidos puestos y el nivel sin poner, y la
banda diría que falta algo que acaba de guardarse.

Recordatorio de la casa: `additionalProperties: false` **no da 400, da 200 y no hace nada**. Cada
nombre nuevo tiene su test.

---

## 6 · La obligación del mes, sin fecha inventada

Las fichas incompletas aparecen en `GET /residencia/obligaciones` como `delCentro`, **no** como una
`ManagementDuty` con sus `DutyOccurrence`. Dos razones:

1. una ocurrencia **necesita un `due_on`** (su índice único es `(duty_id, due_on)`), así que meterla
   ahí obligaría a inventarse un día de vencimiento. Un «vence el 31» que nadie ha acordado con nadie
   es un dato falso que luego sale en rojo en el panel;
2. una ocurrencia **se marca hecha con firma y evidencia**, y esto no se marca: **se apaga solo**
   cuando el último dato entra. Un botón de «hecho» sobre esto sería un botón para mentir.

Lo que sí tiene es la otra mitad de una obligación: consecuencia **LEGAL** (sin DNI, sin grado y sin
familiar localizable el expediente no cumple lo que la Consejería pide en una inspección) y un sitio
al que ir con un toque. Y sale de **la misma función** que la tarjeta del panel
(`lasFichasIncompletas`), no de una segunda cuenta: dos cuentas del mismo número acaban diciendo
cosas distintas en dos pantallas que la dirección mira seguidas.

El enlace lleva a Residentes y no a una lista propia: allí está el filtro y el formulario que las
cierra.

---

## 7 · La tarjeta del panel va ARRIBA, y es la única excepción

El panel de dirección ordena por urgencia (residencia-5). Esta tarjeta va **delante de «qué hay
abierto hoy»** aunque no sea una urgencia clínica, y es deliberado: durante las dos semanas que
duran, **esto es el trabajo** de quien abre ese panel, y detrás de cinco secciones no se mira. Cuando
no quede ninguna desaparece sola y el panel vuelve a su orden de siempre.

Y va en su propia cifra, no dentro de `porArreglar` (residencia-6) aunque tenga la misma forma:
`porArreglar` son cosas que dejan el centro a medio **configurar** y se arreglan una vez; esto es
trabajo de oficina que baja de doce a cero. Mezclarlo haría que la sección de residencia-6 no bajara
nunca a cero, y **una sección que no baja a cero enseña a no mirarla**.

`lasFichasIncompletas` entra en el `Promise.all` del panel: una consulta y una función pura, sin
mover el presupuesto de los 10 s del bloque C §1. Cuenta **sólo a los que viven aquí**: la ficha de
quien se fue en 2019 no se va a completar nunca, y contarla dejaría un contador que no se puede
llevar a cero.

---

## 8 · Y un agujero que el bloque cierra de paso

**El alta de un residente no pasaba por `negativaClinica`.** Crear un residente escribe su plan de
cuidados con los motivos cifrados —o sea historia clínica— y era la única escritura de residencia que
no miraba el contrato de encargado de clinica-7. Las demás lo miran porque pasan por `conHistoria`, y
el alta **no puede pasar**: todavía no hay `clientId` sobre el que resolver el acceso.

Desde este bloque, el alta de uno y la de varios llaman a `negativaClinica("ESCRIBIR")` y contestan
**423** con el contrato no vigente. No se crea nadie, tampoco en lote. Hay un e2e que lo revoca, lo
comprueba en las dos rutas, lo vuelve a aceptar y sigue.

---

## 9 · Lo que había que revisar porque ahora puede ser NULL

Se repasó todo lo que lee las tres columnas:

- **`plan.ts`** · `aplicarPlantilla` sólo se llama con nivel. El alta lo envuelve en un `if`.
- **`exportacion.ts`** (art. 28.3.g) · `ingreso`, `nivelDeDependencia` y `tipoDePlaza` salen `null`.
  Esto es la devolución de SUS datos a quien los puede pedir: si el centro no apuntó cuándo ingresó,
  lo que hay que devolver es que no está — poner «hoy» sería fabricar un dato en un documento que se
  entrega. La cota de los partes (`careDay: { gte: … }`) ya trataba el NULL.
- **`plan-routes.ts`** · la pantalla del plan recibe los dos `null` y dice «sin nivel de dependencia ·
  ponlo en su ficha para poder precargar el plan» en vez de «ingresó el 1/1/1970», que es lo que daba
  `new Date(null)`.
- **`semilla.ts`** e **indicadores** · no leen esas columnas del perfil (el `dependencyLevel` de
  `semilla.ts` es el de las plantillas, que no cambia).
- **`bed_assignments.from_at` sigue siendo `NOT NULL`**, y tiene que seguirlo siendo: una ocupación
  sin fecha deja «¿dónde dormía doña Carmen en marzo?» sin respuesta, que es la pregunta por la que
  esa tabla existe. Cuando no hay fecha de ingreso se usa «ahora», que no es un dato inventado de la
  ficha: es cuándo el programa supo que estaba en esa cama.
- **El admin** · `fechaCorta(null)` ya daba «—» desde residencia-1 (era para la fecha de alta); ahora
  la de ingreso también llega `null`. Las píldoras de nivel y plaza **no se pintan** cuando no hay
  dato: un `NIVEL_LABEL[null]` es `undefined` y un hueco dentro de una píldora gris parece un fallo
  de pintado. Un test barre la pantalla buscando «Invalid Date», «1970», «NaN» y «undefined».

---

## 10 · Convivir con historia-1

historia-1 construye el **ingreso guiado** (`AdmissionChecklist`, D-94) en su propia rama: contrato
firmado, consentimientos, alergias revisadas, dieta, dispositivos, escalas iniciales y el PAI en 30
días. Este bloque es la parte mínima que hacía falta **ya**, y está preparado para que lo absorba:

- **`datosQueFaltan` es la pieza que su checklist absorbe.** Función pura, con sus tests, y con una
  forma pensada para extenderse: cada elemento tiene un `campo` **estable** (el código con el que el
  checklist lo nombrará), el `peso` ya distingue «sin esto no se factura» de «estaría bien», y la
  regla de la plaza concertada demuestra que un elemento puede cambiar de peso según otro dato — que
  es lo que el checklist necesita para «contrato firmado» o «comunicar la baja». **historia-1 tendrá
  que añadir filas, no estructura.**
- **La migración no añade ninguna tabla.** Sólo nulabilidad. Un test lo vigila.
- `ResidentesPage.tsx` no estaba tocado en `master` al abrir la rama: no hubo que rebasar.

---

## 11 · Las pruebas

| Dónde | Qué | Cuántas |
|---|---|---|
| `packages/residencia-plan/test/datos-que-faltan.test.ts` | La tabla, los dos extremos, las dos reglas condicionales, lo cifrado y el resumen | 20 |
| `packages/residencia-plan/test/nombres.test.ts` | La clave de duplicado (Ñ y Ü incluidas), el formato y el parser con sus sabotajes | 20 |
| `apps/api/test/alta-minima-migracion.test.ts` | El contrato del SQL: las tres columnas, el `IS NULL` del CHECK, el `down`, que es aditiva | 15 |
| `apps/admin/test/alta-minima-pantallas.test.tsx` | La lista, la banda y su foco, el formulario, «Añadir varios», la tarjeta del panel y el `?completar=` | 34 |
| `apps/api/test-e2e/alta-minima.e2e.ts` | Contra Postgres: NULL de verdad, el CHECK en sus dos mitades, los 43 con repetidos, la idempotencia, el 423, la puerta y el parte | 41 |

### Los sabotajes del bloque, uno por uno

| Sabotaje | Qué pasa |
|---|---|
| `dependencyLevel` inválido | 400 del esquema, y **no se crea nadie a medias** |
| Pegar 2.000 líneas | 400 `DEMASIADAS_LINEAS` con el límite y «los que ya estén no se duplican». No se crea nadie |
| Líneas vacías | **Se ignoran en silencio.** Copiar una columna arrastra la línea en blanco del final casi siempre, y delatarla enseña a no leer los avisos |
| Tabulador con plaza y sin nombre | Se delata, **con su número de línea real** (el que la dirección ve en su Excel) |
| Línea de sólo tabuladores | Se ignora: es una fila vacía de Excel con dos columnas, no una celda que alguien creyera llena |
| Quitar el nombre | 400 `FALTA_NOMBRE`. Un nombre de sólo espacios tampoco vale |
| Un tipo de plaza que no existe | **No tumba la línea**: el residente se crea sin plaza y se avisa |
| Pegar nada | 400 `NADA_QUE_CREAR`, no un 201 que no hizo nada |

### Lo que costó un rato y conviene saber

- **El síntoma engaña en la puerta.** `puedeVerHistoria` contesta `NO_SANITARIO` antes de llegar a la
  rama de la residencia, pero la puerta traduce **cualquier** negativa a
  `RESIDENTE_FUERA_DE_TU_ZONA` — o sea que el mensaje manda a pedirle una planta a dirección cuando
  la planta ya la tiene. Aquí era que la auxiliar del e2e se sembró con `is_clinician = false`: en una
  residencia **quien registra cuidados ES sanitario a efectos de acceso** (D-51), y lo pone así la
  ruta que asigna el rol — sembrando el rol con SQL en crudo hay que ponerlo a mano. No se ha tocado
  el mensaje de la puerta (no es de este bloque), pero queda anotado en §13.
- **Escribir en un input controlado por React desde el banco necesita el setter nativo.** React
  guarda el último valor que pintó y descarta el evento si el `value` del nodo coincide: la
  asignación directa se pierde en silencio y el test falla diciendo que el botón sigue
  deshabilitado.

---

## 12 · Decisiones tomadas sin preguntar

1. **El alta pasa por `negativaClinica`.** Es un agujero preexistente (§8), no algo que el bloque
   pidiera. Se ha cerrado porque el bloque dice «Respeta: `negativaClinica`: sin contrato vigente no
   se crea nadie, tampoco en lote», y el «tampoco» daba por hecho que el alta de uno ya lo miraba.
   No lo miraba. **Cambia el comportamiento de una ruta que ya existía**: un centro sin contrato
   aceptado que antes podía dar de alta residentes, ahora recibe 423. Es el lado correcto —ese centro
   tampoco puede abrirles historia ni registrar nada en la puerta— pero está dicho aquí por si en el
   despliegue aparece un centro así.
2. **La fecha de ingreso del formulario de alta nace VACÍA**, no con `hoyISO()` como antes. Una fecha
   que el formulario rellena solo es un dato que nadie ha mirado y que luego sale en un informe a la
   Consejería. Lo que se mete en un alta de hoy se teclea.
3. **El límite del lote es 300** (§4).
4. **El PATCH no auto-carga el plan** al poner el nivel por primera vez; lo ofrece (§3). El prompt lo
   decía así («la ficha ofrece») y las razones están en §3.
5. **El admin depende de `@mipiacetpv/residencia-plan`.** Es nueva: el admin ya dependía de
   `@mipiacetpv/contrato-encargado` y `@mipiacetpv/ticket-model`, pero no de este paquete —
   `frecuenciaCorta` es una copia declarada en `lib.ts` precisamente por eso. Aquí sí se añade la
   dependencia porque la vista previa y el servidor **tienen que** partir el pegado igual, y una
   copia sería la divergencia que el bloque viene a evitar. El paquete es puro y sin dependencias:
   lo que entra en el bundle es lo que se importe.
6. **`Eleccion` se MOVIÓ** de `ResidentesPage.tsx` a `ResidentesPage.completar.tsx`, para que la
   dependencia entre los dos ficheros vaya en un solo sentido. Gana `id` + `tabIndex={-1}` (para que
   la banda pueda enfocarla) y `onQuitar` (para el grado que alguien puso por error: la API ya
   aceptaba `null`, lo que no había era por dónde decírselo).
7. **El resumen de la lista y la tarjeta del panel cuentan sólo a los que viven aquí** (§7).
8. **La obligación del centro se marca como `LEGAL`**, no `INTERNO`: lo que falta es administrativo,
   la consecuencia de que falte no (§6).
9. **El nombre se enseña en formato de nombre en el admin** (`nombreVisible`), y lo guardado no se
   toca. Es la decisión 7 del bloque aplicada donde se ve: la lista, la ficha y la tarjeta del panel.
   **No se ha tocado la puerta ni el parte**: esas pantallas son de residencia-3 y -5, y la decisión
   4 dice que no se tocan.

---

## 13 · Dudas abiertas

1. **El mensaje de la puerta cuando el acceso se deniega por otra cosa.** La puerta traduce cualquier
   negativa de `puedeVerHistoria` a `RESIDENTE_FUERA_DE_TU_ZONA` («Dirección puede darle la planta»),
   así que un `NO_SANITARIO` o un `SIN_ROL_DE_CUIDADO` mandan a dirección a mirar la planta
   equivocada. Es anterior a este bloque y no se ha tocado: cambiarlo toca la ruta de registro de la
   puerta, que es el camino crítico de residencia-3. Candidato a un bloque de su cuenta.
2. **Un duplicado con los apellidos del revés.** «RAMOS DOBLADO, ABEL» y «ABEL RAMOS DOBLADO» se
   crean como dos personas, a propósito (§4). Si en el listado de algún centro vienen del revés, la
   dirección verá dos fichas de la misma señora y tendrá que arreglarlo a mano — y **no hay ruta para
   fusionar dos residentes**, porque fusionar dos historias clínicas no es una operación que deba
   existir sin pensarla despacio. Si pasa, se arregla dando de alta a una y completando la otra.
3. **El importador con columnas** (fechas, DNI, grado) está declarado fuera de alcance: el pegado de
   nombres cubre el caso de hoy y el importador se valora cuando llegue el segundo centro.
4. **Si historia-1 cambia el `AdmissionChecklist` a su propia tabla**, habrá que decidir si la tarjeta
   del panel y la obligación del mes pasan a leer de ella o se quedan leyendo `datosQueFaltan`. Lo
   segundo es más barato y sigue siendo correcto: el checklist es un superconjunto.

---

## 14 · Qué hay que hacer al desplegar

1. **La migración es aditiva y se aplica sola** con `prisma migrate deploy`. No bloquea: tres
   `DROP NOT NULL` y un CHECK que se reemplaza sobre una tabla de 43 filas.
2. **Nada que sembrar, nada que rellenar.** Las fichas que ya existen no se tocan: siguen teniendo
   sus tres columnas puestas y por tanto **no salen como incompletas** por eso. Lo que sí puede pasar
   es que salgan como incompletas por lo demás (sin DNI, sin familiar, sin NSS) — y eso es el bloque
   funcionando.
3. **Avisar a la dirección de Jardín de Gredos de que la tarjeta va a aparecer con un número alto.**
   Con 43 fichas a medias, el panel va a abrir con «43 fichas de residentes incompletas» en rojo. Es
   lo que se pidió, pero conviene que no lo lea por primera vez sin contexto.
4. **Comprobar el contrato de encargado antes de dar de alta a nadie** (§8): ahora el alta contesta
   423 sin él. En Gredos está aceptado.
5. **Y el camino real del primer día**, que es lo que hay que enseñarle a la dirección:
   Residentes → «Añadir varios» → pegar la columna del Excel → «Crear N residentes». Después, el
   panel abre con la tarjeta y «Completar» recorre las fichas una por una.

---

## 15 · Las capturas y lo medido

En `docs/qa/2026-10-23-alta-minima/`, a **escritorio (1280×800)** y a **390**, contra la stack de
verdad con Jardín de Gredos sembrado:

| Fichero | Qué |
|---|---|
| `1-panel-tarjeta-*` | El panel con la tarjeta de fichas incompletas arriba |
| `2-lista-incompletas-*` | La lista con el contador, el filtro puesto y las etiquetas |
| `3-ficha-banda-*` | La ficha con la banda de lo que falta |
| `3b-ficha-formulario-*` | Y el formulario que la apaga |
| `4-anadir-varios-vista-previa-*` | «Añadir varios» con la vista previa y los repetidos |
| `5-anadir-varios-hecho-escritorio` | El resultado: 40 creados, 3 saltados |
| `6-obligaciones-del-centro-*` | La obligación viva del centro, sin fecha |
| `MEDIDO.txt` | Lo medido |

### Lo medido

- **Cargar 43 nombres pegados** (40 nuevos + 3 que ya estaban): **859 ms** desde el toque en «Crear
  40 residentes». En total son **3 toques y un pegado**: Residentes → «Añadir varios» → pegar →
  «Crear 40 residentes».
- **Completar un dato de una ficha desde la tarjeta del panel**: **3 toques** (Completar → el dato de
  la banda → Guardar) y 1,5 s.
- **Pasar a la siguiente incompleta**: **1 toque**. Sin ese botón serían 3 toques más por ficha —
  **129 en las 43**.

### Y lo que el bucle encontró (los dos cambios que salieron de aquí)

1. **La banda de la ficha era intocable a 390.** Con los datos enlazados dentro de una frase separada
   por comas, «DNI» era un objetivo de **21×20 px** pegado a «tipo de plaza» y a «familiar
   responsable». A esa altura se toca el de al lado, y el aviso que existe para llevar al campo con
   un toque acaba llevando al campo equivocado. Ahora cada dato es una pastilla de 36 px.
2. **Los nombres salían como se guardan** (en mayúsculas) y **la tarjeta del panel listaba los datos
   de cada residente**: con once por persona y cinco personas, quince renglones de texto corrido que
   nadie lee. Lo primero es la decisión 7 sin aplicar; lo segundo, una tarjeta que no se mira.

Los avisos que quedan en `MEDIDO.txt` son **enlaces en línea del panel y de las obligaciones** (17-20
px de alto) que vienen de residencia-5 y no son de este bloque, más los `input[type=checkbox]` de
16×16, que son los de siempre en el admin.

---

## 16 · Estado de la rama

- Rama `alta-minima`, desde `origin/master`.
- **Pusheada** y con **PR contra `master`**. Ni merges ni despliegues.
- CI: `ci`, `smoke` y `e2e`.
