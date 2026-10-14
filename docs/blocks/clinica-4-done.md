# Bloque clinica-4 · done

Rama `clinica-4-fotos-consentimientos-informe`, worktree
`~/Developer/Claude/Projects/mipiacetpv-clinica-4`, desde `origin/master` =
`b7bc8be` (lleva clinica-5, clinica-6 y enlaces-publicos), más `bc709ee`, el
prompt de este bloque.

**Este bloque saca de la historia tres cosas que hoy viven fuera de ella.**
Las fotos de Rosario están en la galería de su móvil, junto a las de su
familia. Los consentimientos están en papel, en una carpeta. Y cuando un
paciente pide su historia, la fotocopia.

La frase que resume lo que tiene que ser verdad al terminar: **la foto de la
uña queda en la historia por zona y por fecha y se compara antes/hoy con un
toque; una cirugía no se empieza sin el consentimiento firmado, y la firma
vale —quién, qué texto, cuándo, delante de quién—; y el informe sale con un
toque y queda apuntado a quién se entregó.**

---

## 1 · Los consentimientos, sobre la tabla común

S3, decidido el 07-10: **no hay tabla clínica de consentimientos.** Todo se
construye sobre `ClientConsent` (`kind = TREATMENT`), que ya usa el spa desde
la ficha del cliente. Lo que hoy funciona ahí sigue funcionando: `POST
/clients/:id/consents` no se ha tocado, y su alta manual sin plantilla entra
igual y se enseña en la historia diciendo lo que es.

Lo que la tabla no sostenía y ahora sí, las cinco condiciones de S3:

| Condición | Cómo |
| --------- | ---- |
| No se borra | `client_id` de CASCADE a **RESTRICT** + trigger de **solo inserción** |
| Revocar sin editar | fila nueva con `revokes_consent_id` (vale igual para `DATA`) |
| Qué se firmó exactamente | plantilla + versión + **huella del texto** + **huella SHA-256 del PDF** |
| Quién firma y quién informa | firmante (paciente o representante **con su relación**) e informante `User` |
| Lo clínico se ve como historia | `clinical` copiado de la plantilla → el PDF pasa por `conHistoria` |

### Las plantillas son un paquete, y es por el spa

`packages/consentimientos` — **nuevo**, puro, sin Prisma ni React ni
`node:crypto`. Dentro: las tres plantillas versionadas en código (cirugía
ungueal, anestesia local, fotos clínicas), la cuenta de la vigencia y las
negativas del firmante y del informante.

Paquete propio y no una carpeta de `clinica-sesion` porque **esto no es
clínico**: `ClientConsent` es la tabla común y el spa la usa para
micropigmentación y láser. Lo que distingue a una plantilla clínica es su
marca, no dónde vive el código. Es el mismo argumento de los «dos relojes»
con el que clinica-3 sacó su paquete del de clinica-2.

Y `node:crypto` se queda FUERA a propósito: la huella la calcula quien tiene
el fichero delante (la API). Lo que el paquete garantiza es que **el texto
que se hashea es uno solo** (`textoCanonico`), que es la mitad que de verdad
hace falta — con dos formas de armar el texto, la huella guardada dejaría de
cuadrar con lo que la pantalla enseña y entonces no demostraría nada.

**El test de las plantillas FIJA la huella de cada una.** Cambiar una coma de
un texto ya firmado se pone rojo. Es lo que obliga a sacar una versión nueva
en vez de reescribir la vieja, que es justo lo que pasará cuando Rosario dé
sus textos (§8).

### La vigencia es una cuenta, no una columna

«Está firmado» no se lee: se cuenta sobre las filas, porque revocar es una
fila nueva. La cuenta es pura y la usan los dos lados —la API para decidir si
la sesión empieza, la pantalla para pintar el aviso— por la razón de siempre:
con una copia por lado, la podóloga vería «firmado ✓» sobre algo que el
servidor considera revocado, y entonces la pantalla estaría diciendo que una
cirugía se puede empezar.

Tres reglas que el test fija y que no son obvias:

- **un revocado cuenta como que FALTA** (es el punto del mecanismo);
- **un alta manual sin plantilla no satisface nada**: lo que no se sabe qué
  texto fue no vale como prueba de que se informó de ese texto;
- y con dos concesiones vivas manda **la más reciente**.

### La segunda puerta de la sesión

`vistaDeLaSesion` gana `consentimientos` y `cerrarSesion` una negativa nueva
(`SIN_CONSENTIMIENTO`). Va **después** de la puerta de la valoración y el
orden importa: a un paciente nuevo le falta todo, y lo primero que hay que
hacer con él es validar su valoración — ahí salen las alergias y la
medicación, que es lo que hay que saber ANTES de ponerle delante un
consentimiento de anestesia. Contestar «falta el consentimiento» primero
sería mandar a la podóloga a firmar antes de saber si puede anestesiar.

En pantalla no es un error rojo: es una banda ámbar con el título de lo que
falta y un botón **«Firmar ahora»** que lleva a su pestaña (decisión 7). El
botón de cerrar sale desactivado. **La pantalla ayuda, la ruta garantiza.**

---

## 2 · Las fotos: fuera de la galería y fuera de la base

`clinical_photos` + un volumen propio. Las tres decisiones de fondo:

**1 · La cámara es la de la app, nunca un `<input type=file>`** (decisión 9).
No es estilo: un `input file` abre la app de cámara del sistema, y lo que la
app de cámara hace es **guardar la foto en la galería del aparato** antes de
dársela a nadie. Entonces la foto de la uña de Carmen está en la galería de
la tablet, que es exactamente lo que este bloque viene a arreglar. Un test lo
fija recorriendo las tres pantallas.

**2 · El fichero vive en un volumen propio y NUNCA detrás de Caddy.** No es
`product_images`: lo que cae ahí se sirve con una URL y sin sesión. El
binario sale sólo por la API, por `conHistoria`, y **cada apertura deja su
línea en `ClinicalAccessLog`**. Lo que hace verdad esa frase es que la ruta
es la única forma de llegar al fichero.

**3 · Una foto no se borra: se RETIRA**, con autor y motivo (decisión 13).
Deja de salir en el comparador y sigue en la rejilla, marcada, y se sigue
sirviendo por su id — el paciente tiene derecho de acceso a lo que haya en su
historia. El motivo es obligatorio porque la pregunta que alguien hará dentro
de un año es «¿por qué no está la foto del 7 de septiembre?», y «la retiró
Lucía» no la contesta.

### Por qué una tabla y no un `ClinicalEntry` con su `kind`

Se pensó, y es el argumento con el que clinica-3 decidió NO crear tabla: la
inmutabilidad, la autoría y los RESTRICT ya están en `clinical_entries`.

No encaja **por la retirada**. `clinical_entries` es inmutable del todo: su
trigger rechaza cualquier `UPDATE`. Una foto tiene UNA transición legítima, y
meterla ahí habría obligado a aflojar el trigger de la tabla donde viven las
sesiones firmadas — o a inventar una «entrada de retirada» que apunta a otra,
que es un mecanismo nuevo con más piezas que una tabla propia. Tabla propia
con el patrón de `clinical_access`: inmutable salvo una transición que no se
deshace.

### Y el permiso de cámara ya estaba

**No hace falta APK nueva.** `android.permission.CAMERA` está en el
manifiesto desde A2 (lo usa el escáner de códigos de barras) y el permiso de
runtime lo pide la misma capa de plataforma (`ensureCameraPermission`), sin
que ninguna pantalla toque Capacitor. Se comprobó leyendo el manifiesto antes
de escribir la cámara.

---

## 3 · El informe: cuatro, y uno solo armado

`construirInforme` en `packages/clinica-sesion/src/informe.ts`, puro. De ahí
salen el papel que se ve en pantalla, el PDF que se imprime y el PDF que se
adjunta al email: **los tres son el mismo documento**, y por eso no hay tres
sitios donde pueda salir distinto.

**Qué lleva cada tipo es una TABLA** (`SECCIONES_POR_TIPO`), no una cadena de
`if`s, por lo mismo que la regla de niveles de clinica-5: es justo lo que
Rosario va a querer mover.

**No recalcula ninguna regla clínica** (decisión 18): lee
`vistaDeLaHistoria` —la MISMA llamada que pinta la historia viva— y le pasa
el resultado al armador. La consecuencia que vale la pena nombrar: **el
informe no puede decir que una zona está curada si la pantalla dice que está
activa.**

**Ni un importe, y no por un `if`**: `SeccionDeInforme` no tiene campo de
dinero. Lo que no cabe en el tipo no se puede filtrar mal.

### El email no lleva NI EL TIPO DE INFORME

Regla 17. El cuerpo lo escribe `informe-email.ts` con una lista cerrada de lo
que puede decir, y aquí se aparta del correo de clinica-2: «informe de
derivación» en un asunto cuenta que a esa persona la están derivando, y eso
se lee en la vista previa de la pantalla de bloqueo de un móvil, que ve quien
esté al lado. El asunto dice «un documento de su historia».

El guardián compara **palabra con palabra** contra las 53 del cuestionario y
contra los nombres de los cuatro informes. Y **sin lista de inocentes**, al
contrario que el de clinica-2: el texto se escribió esquivando las palabras
del cuestionario («para cualquier aclaración, llámenos» en vez de «si tiene
alguna duda, puede llamarnos»), así que el guardián vigila las 53 enteras.
Cada excepción habría sido una palabra menos vigilada.

### Y las dos pruebas de la entrega, que son dos preguntas

El prompt deja elegir entre la tabla propia y `ClinicalAccessLog` y pide
explicar la elección. **Se hacen las dos**, y no es indecisión:

- `clinical_access_log` contesta **«¿quién ha abierto esta historia?»**. Su
  forma es cerrada desde clinica-1 y **no tiene sitio** para el canal ni para
  el destinatario. La línea sale gratis, con `action = EXPORT` — el valor que
  clinica-1 metió en el enum sin usarlo (su decisión 11.7), escrito para hoy,
  y que es lo que distingue «abrió la historia» de «se llevó una copia».
- `clinical_report_deliveries` contesta **«¿qué se le entregó a quién?»**,
  que es la pregunta del paciente que pide su historia y la del abogado.

Ensanchar el registro con un destinatario habría sido ensanchar la tabla que
clinica-1 dejó deliberadamente estrecha; quedarse sólo con la tabla nueva
habría dejado una lectura de la historia sin su línea en el registro.

**El PDF del informe NO se guarda**, al contrario que el del consentimiento.
Un consentimiento ES el documento firmado y tiene que poder reabrirse; un
informe es una foto de la historia en un momento. Lo que queda es la prueba
de que se entregó, con la huella del PDF que se entregó.

---

## 4 · Decisiones tomadas sin preguntar

1. **El mockup es UN aparato con tres pestañas; el producto reparte las tres
   piezas donde se usan.** Fotos y consentimientos van en **la sesión** (se
   hacen y se firman con el paciente delante, decisiones 6 y 9) y el informe
   en **la historia viva** (decisión 15: se abre desde ahí, que es donde se
   tiene delante la historia entera). La historia LEE las fotos y los
   consentimientos; hacerlos es otra cosa. Es la divergencia grande con el
   mockup y está en §7.
2. **El PDF del informe no se guarda en disco** (§3).
3. **Un consentimiento ya firmado y vigente no se vuelve a firmar**: 409 con
   la fecha del que hay. Dos consentimientos idénticos del mismo día no son
   más prueba, son una pregunta.
4. **La revocación copia plantilla, versión y huella** de la fila que revoca.
   No es redundancia: es lo que hace que la lista se lea («Fotos clínicas ·
   revocado el 9 de octubre») sin cruzar dos filas para pintar una.
5. **Las filas de revocación NO salen como documentos** en la historia: lo
   que se enseña es el consentimiento, marcado como revocado. Dos líneas por
   el mismo documento se leerían como dos documentos.
6. **Al paciente se le manda AL EMAIL DE SU FICHA**, aunque se teclee otro.
   Dejar teclear el del paciente sería dejar mandar su historia a cualquier
   dirección. Al profesional sí se teclea: es el destinatario.
7. **La derivación sin motivo no se entrega** (409). Es el único texto que
   escribe el sanitario y lo primero que lee quien recibe el informe.
8. **El informe se firma con quien lo saca**, no con quien cerró la sesión:
   lo que el papel dice es quién responde de ESTE documento.
9. **El nº de colegiado se normaliza en el borde de la API** (se le quita el
   «Col.» que venga dentro). Lo encontró el bucle visual: el campo es texto
   libre y todo lo que lo imprime le pone su propio rótulo delante.
10. **Una foto retirada se sigue sirviendo por su id.** Está en la historia y
    el paciente tiene derecho de acceso a lo que haya en ella; lo que cambia
    es que no sale en el comparador.
11. **Sin consentimiento de fotos no se guarda NINGUNA**, no sólo la primera:
    si se revoca, no se hacen más (lo dice el propio texto de la plantilla).
    Las que ya están se conservan: son historia.
12. **Las primitivas del folio A4 salieron a `documento-a4.ts`** desde
    `declaracion-responsable.ts`. Tres copias de `wrap` son tres sitios donde
    un renglón se sale del margen y sólo uno de los tres lo arregla.

---

## 5 · El bucle visual, y lo que encontró

`docs/qa/2026-10-09-clinica-4/` (con su `README.md`) · el mockup recorrido en
el producto real a **1366, 1024 y 390**, con el PIN de la podóloga, desde la
cita del día y **rehaciendo la semilla antes de cada ancho** (firmar es una
escritura que no se deshace).

Medido sobre la página y acotado a cada pantalla: **48 px el objetivo táctil
más pequeño** de las cuatro pantallas en los tres anchos, sin scroll
horizontal en ninguna, el comparador y el papel en dos columnas en iPad y
apilados en móvil, y **ni un € en el papel**.

### Cinco hallazgos, los cinco arreglados

**1 · La sesión se caía entera contra el ErrorBoundary.** `Cannot read
properties of undefined (reading 'puede')`: `serializarVista` es un allowlist
campo a campo y el campo nuevo no estaba en la lista, así que la respuesta
REAL no llevaba `consentimientos`.

Lo grave no es el fallo: es **por qué ninguna suite lo veía**. Los tests de
pantalla mockean la respuesta; los de la vista miran el objeto, no el
serializado. Entre los dos quedaba un hueco del tamaño exacto de este fallo.
Ahora hay un test sobre el JSON QUE SALE, y para los dos roles — el
serializador tiene dos caminos y un campo que sólo salga en uno es una
pantalla que se cae para la mitad del personal.

**2 · El aviso de la cámara tapaba el disparador.** Con el texto a `bottom-5`
y el botón a `bottom-4`, Playwright se negó a pulsarlo («element would
receive the click»). En la tablet eso es la podóloga tocando el disparador
sin que pase nada. Encima y con `pointer-events-none`.

**3 · Las 22 zonas dejaban el visor bajo el pliegue a 390.** Y es el caso
normal del primer día: cuando al paciente no se le ha marcado nada todavía,
se ofrecen todas. Una sola fila que se desliza.

**4 · «Col. Col. 45-0312»** en la pestaña de Documentos (§4.9).

**5 · El RESTRICT rompía el seed del banco.** `borrarClinica` borra el tenant
y con un consentimiento firmado dentro eso ya no se puede. **Es la garantía
de S3 funcionando**: lo que había que arreglar era el seed, no la garantía.
Lo cazó rehacer la semilla entre dos anchos — y el prompt lo pedía («mira
antes qué rompe el RESTRICT»): lo busqué en rutas y tests y **se me pasó el
seed del banco**.

Y una de redacción: la banda de la segunda puerta repetía «se lee con el
paciente y se firma aquí» dos veces seguidas.

---

## 6 · Tabla de sabotajes

Cada garantía rota a propósito y **vista en rojo**, con el fichero de test
**entero** (no un `-t`) y restaurando con `git checkout --` después de cada
una. Commiteado ANTES de empezar, que es la lección de clinica-6.

| # | Qué se rompe | Dónde | Resultado |
| - | ------------ | ----- | --------- |
| **Las plantillas y la vigencia** |
| 1 | el texto canónico deja de llevar el título | `plantillas.ts` | 🔴 2 |
| 2 | una fila de REVOCACIÓN cuenta como concesión | `vigencia.ts` | 🔴 2 |
| 3 | un revocado SIGUE valiendo | `vigencia.ts` | 🔴 2 |
| 4 | manda la concesión más antigua y no la última | `vigencia.ts` | 🔴 1 |
| 5 | un alta manual sin plantilla satisface lo que pide la cita | `vigencia.ts` | 🔴 3 |
| 6 | «fotos clínicas» se puede atar a un servicio | `plantillas.ts` | 🔴 1 |
| 7 | un representante sin relación vale | `firmante.ts` | 🔴 2 |
| 8 | un consentimiento clínico lo informa cualquiera | `firmante.ts` | 🔴 1 |
| **El informe** |
| 9 | la historia COMPLETA se recorta a 5 visitas | `informe.ts` | 🔴 1 |
| 10 | el resumen del paciente lleva la valoración entera | `informe.ts` | 🔴 1 |
| 11 | sin alertas, la sección de alertas se calla | `informe.ts` | 🔴 1 |
| 12 | la gráfica del dolor sale del revés | `informe.ts` | 🔴 1 |
| 13 | la derivación deja de llevar el motivo | `informe.ts` | 🔴 3 |
| 14 | un IMPORTE se cuela en el documento | `informe.ts` | 🔴 2 |
| **Los consentimientos en la API** |
| 15 | firmar no congela la huella del texto | `consentimientos.ts` | 🔴 1 |
| 16 | **el PDF se sirve sin comprobar su huella** | `ficheros.ts` | 🟢 → 🔴 1 |
| 17 | firmar deja pasar a la recepcionista | `consentimientos-routes.ts` | 🔴 2 |
| 18 | el informante deja de ser el sanitario que firma | `consentimientos.ts` | 🔴 2 |
| 19 | firmar dos veces crea DOS filas | `consentimientos.ts` | 🔴 1 |
| 20 | la puerta de la sesión ignora lo que pide el servicio | `consentimientos.ts` | 🔴 2 |
| 21 | el nombre del fichero lleva la plantilla dentro | `ficheros.ts` | 🔴 2 |
| 22 | el registro apunta ALLOWED aunque la ruta se niegue | `registro.ts` | 🔴 2 |
| **Las fotos** |
| 23 | la foto se guarda SIN consentimiento de fotos | `fotos.ts` | 🔴 2 |
| 24 | **la zona no se valida contra el mapa** | `fotos.ts` | 🟢 → 🔴 1 |
| 25 | la foto retirada sigue contando en el comparador | `fotos.ts` | 🔴 3 |
| 26 | retirar no guarda el motivo | `fotos.ts` | 🔴 1 |
| 27 | se retira dos veces | `fotos.ts` | 🔴 1 |
| 28 | lo que no es un JPEG entra igual | `ficheros.ts` | 🔴 1 |
| **El informe en la API** |
| 29 | el asunto del email dice QUÉ INFORME es | `informe-email.ts` | 🔴 1 |
| 30 | el cuerpo lleva una palabra del cuestionario | `informe-email.ts` | 🔴 1 |
| 31 | la entrega NO se apunta | `informe-routes.ts` | 🔴 3 |
| 32 | la entrega se apunta como READ y no como EXPORT | `informe-routes.ts` | 🔴 2 |
| 33 | al paciente se le manda al email que se teclee | `informe-routes.ts` | 🔴 2 |
| 34 | la derivación sin motivo se entrega igual | `informe-routes.ts` | 🔴 1 |
| **La migración** |
| 35 | la FK del cliente vuelve a CASCADE | migración | 🔴 2 |
| 36 | el trigger de solo inserción desaparece | migración | 🔴 1 |
| 37 | el guard de la foto deja reescribir el fichero | migración | 🔴 1 |
| 38 | los consentimientos de un servicio nacen con algo dentro | migración | 🔴 1 |
| 39 | la entrega guarda el motivo de la derivación | migración | 🔴 1 |
| **Las pantallas** |
| 40 | el botón de firmar se enciende SIN trazo | `Consentimientos.tsx` | 🔴 1 |
| 41 | la cámara dispara sin zona elegida | `Fotos.tsx` | 🔴 1 |
| 42 | con una sola foto, el comparador la enseña dos veces | `Fotos.tsx` | 🔴 1 |
| 43 | la foto retirada deja de decir que lo está | `Fotos.tsx` | 🔴 1 |
| 44 | sin consentimiento, la pantalla ofrece la cámara igual | `Fotos.tsx` | 🔴 1 |
| 45 | la banda de la segunda puerta desaparece | `SesionPodologia.tsx` | 🔴 2 |
| 46 | y el botón de cerrar deja de mirarla | `SesionPodologia.tsx` | 🔴 1 |
| **«Documentos»** |
| 47 | **esconde los consentimientos firmados** | `historia.ts` | 🟢 → 🔴 3 |
| 48 | esconde los informes entregados | `historia.ts` | 🔴 1 |
| 49 | la revocación sale como un documento aparte | `consentimientos.ts` | 🔴 2 |

### Los tres que salieron VERDES, que son los que enseñaron algo

Los tres son **la misma forma**: una regla con dos capas, y sólo la de fuera
probada.

**#16 · la huella del PDF podía ser código muerto.** Con `huellaCuadra: true`
fijo, la suite seguía verde: ningún caso ejercitaba el camino en que NO
cuadra. Ahora un test **cambia el fichero del volumen por detrás de la API** y
exige `X-Huella-Cuadra: NO`, con el documento servido igual — un PDF que no
cuadra es justo el que alguien tiene que mirar, y esconderlo borra la única
pista.

**#24 · la zona sólo la probaba el `enum` del schema.** La negativa de
`guardarFoto` no se ejercitaba desde la ruta, y hace falta: el `enum` se arma
con el mapa VIGENTE, y el día que el mapa gane una versión la ruta podría
aceptar una zona que `guardarFoto` tiene que seguir rechazando. Es la forma
exacta del #26 de clinica-5.

**#47 · «Documentos» podía esconderlo todo y nadie lo veía.** El fichero de
clinica-6 trae el paciente SIN consentimientos y SIN informes, así que el
bucle nunca corría. Cuatro casos nuevos con datos dentro.

---

## 7 · Divergencias declaradas con el mockup

1. **El mockup es un aparato con tres pestañas (Fotos · Consentimientos ·
   Informe) y el producto no.** Las tres piezas van donde se usan: fotos y
   consentimientos en la SESIÓN (con el paciente delante), el informe en la
   HISTORIA. El mockup es una maqueta para enseñar las tres de un vistazo;
   meterlas en una pantalla propia habría sido una cuarta pantalla que la
   podóloga tiene que ir a buscar. Ver §4.1.
2. **Los textos de los consentimientos son otros.** Los del mockup son tres
   frases; los del paquete llevan los contenidos mínimos del art. 10 de la
   Ley 41/2002 (consecuencias, riesgos, alternativas) y la revocabilidad del
   art. 8.5. Siguen siendo **de ejemplo** y marcados como tales (§8).
3. **El informe no lleva la lista de tratamientos con su precio** — el mockup
   tampoco los pinta, pero su tabla de sesiones se parece a una de caja. Aquí
   la columna de la derecha es el dolor.
4. **La cámara enseña las zonas en UNA FILA que se desliza** cuando hay
   muchas, no en varias filas (§5.3).
5. **El comparador se apila a 390**, como los dos pies de clinica-6 y por lo
   mismo: lado a lado serían 163 px por foto.
6. **La firma del mockup no valida nada**; aquí sin trazo no se firma, y el
   servidor lo rechaza igual.
7. **«Otra zona…» del mockup no hace nada**; aquí abre las 22 del mapa.
8. El mockup escribe **«Col. 45-0312»** como nº de colegiado. Aquí el número
   es el número y el rótulo lo pone cada documento (§4.9).

---

## 8 · Pendiente de Rosario

1. **LOS TEXTOS DE LOS TRES CONSENTIMIENTOS.** Es lo más importante de la
   lista. Lo que hay son textos de ejemplo escritos con los contenidos
   mínimos de la ley, **marcados como pendientes** (`pendienteDeValidar`) y la
   pantalla lo dice en un aviso ámbar. Ella ya usa los suyos en papel: lo que
   toca es pasarlos a una **versión 2** de cada plantilla, no reescribir la
   1 — hay un test que fija la huella de cada versión justamente para eso.
2. **QUÉ SERVICIOS PIDEN QUÉ.** Hoy no lo pide ninguno (la columna nace
   vacía). Lo marca ella en Catálogo de agenda. La pregunta concreta: ¿la
   anestesia local se firma aparte de la cirugía, o va dentro?
3. **Si el consentimiento de fotos lo quiere pedir una vez o por tratamiento.**
   Hoy se pide una vez por paciente y vale hasta que se revoque.
4. **Qué informe entrega de verdad y con qué nombre.** Los cuatro salen del
   mockup; el de «historia completa» es el del derecho de acceso y los otros
   tres son decisión suya.
5. **Si quiere su membrete o le vale el del perfil fiscal.** Hoy la cabecera
   del papel es la del ticket (razón social, NIF, dirección, teléfono).
6. **El título profesional** del pie del informe dice «Podología». Si en su
   colegio consta de otra forma, es una constante.

## Pendiente del abogado (tarea humana 11)

1. **CIFRAR LAS FOTOS EN DISCO.** Fuera de alcance por el prompt y **no se ha
   construido**: se decide con la evaluación de impacto. Hoy el JPEG está en
   claro en el volumen, como el `body` de las entradas está en claro en la
   base (duda 4 de clinica-1). Lo que ya está hecho y ayuda: el volumen no lo
   sirve nadie más que la API, el nombre del fichero no dice nada del
   paciente y cada apertura queda registrada.
2. **MANDAR UN PDF DE SALUD POR EMAIL.** El cuerpo no lleva datos de salud y
   el PDF va adjunto, pero el adjunto viaja por servidores que no son
   nuestros y sin cifrar. Hay que decidir si eso vale para un informe de
   derivación o si hace falta otra vía (enlace con caducidad, entrega en
   mano). Hoy la podóloga elige; el sistema no se lo impide.
3. **La supresión RGPD** (bloquear y anonimizar al vencer el plazo) sigue
   siendo de su bloque, y el RESTRICT de este la empuja un paso más: ahora un
   cliente con un consentimiento firmado tampoco se borra.

---

## 9 · Al desplegar

1. **HAY MIGRACIÓN, y es UNA**:
   `20261008010000_clinica_4_consentimientos_fotos_informe`. **Copia de la
   base antes**, como siempre. Aplicada en una copia de la base de desarrollo
   con filas reales (`mipiacetpv_clinica4_copia`) y con **las 25 garantías
   del motor comprobadas a mano** antes de escribir una línea de API.
   - Todo es aditivo **menos una cosa**: `client_consents_client_id_fkey` se
     recrea de CASCADE a RESTRICT. No toca ninguna fila, pero **cambia el
     comportamiento de un borrado que antes pasaba**.
   - El `down` está escrito, incluido que volver a CASCADE **es perder la
     garantía**, no recuperarla.
2. **HAY VOLUMEN NUEVO**: `clinical_files`, montado sólo en la API y
   **nunca en Caddy**. Sin él, la primera firma falla al escribir el disco.
3. **LA COPIA DE SEGURIDAD SE AMPLÍA**, y es parte del despliegue, no un
   extra: `infra/backup-postgres.sh` empaqueta ahora el volumen clínico en el
   MISMO script y el mismo instante que el dump. Con dos crons, una
   restauración acaba con filas de las 04:00 y ficheros de las 05:00 — o sea,
   con consentimientos firmados cuyo PDF no existe todavía. **Una historia
   cuyas fotos no se pueden recuperar no se conserva cinco años.**
4. **UNA VARIABLE DE ENTORNO NUEVA**, con valor por defecto:
   `CLINICAL_FILES_DIR` (`/var/lib/mipiacetpv/clinical-files`). Ya va puesta
   en `docker-compose.prod.yml`. Y `CLINICAL_PHOTO_MAX_BYTES` (4 MB), que no
   hace falta tocar.
5. **NO HACE FALTA APK NUEVA.** El permiso `CAMERA` está en el manifiesto
   desde A2 y la cámara usa `getUserMedia` dentro del WebView, como el
   escáner. Ni una línea de `apps/tpv-android`.
6. **Sí hay `COPY` nuevo en `infra/Dockerfile`**: nace el paquete
   `consentimientos`. Lo vigila `infra/test/dockerfile-manifiestos.test.ts`.
7. **Nadie que no tenga la clínica encendida nota nada.** Las nueve rutas
   nuevas contestan la 404 de una ruta inexistente, la columna de los
   servicios nace vacía y el alta manual de consentimientos del spa se
   comporta igual que ayer.
8. **Lo que SÍ cambia para quien ya la tiene encendida**, y conviene decírselo
   a Rosario antes de que lo vea:
   - la sesión tiene **dos pestañas más** (Fotos y Consentimientos);
   - la historia tiene **dos más** (Fotos e Informe), y «Documentos» ya
     enseña consentimientos e informes;
   - **un servicio al que se le marquen consentimientos bloquea el cierre de
     su sesión** hasta firmarlos. Mientras no marque ninguno, nada cambia.

### Lo que NO se despliega con esto

Enlaces públicos para leer el consentimiento antes y la supresión RGPD
(bloques propios), el editor de plantillas para el centro, el cifrado de las
fotos en disco, la app iOS, los bonos y el dictado por voz. Fuera de alcance
declarado.

---

## 10 · Verde

- **Suite de unidad: verde.** 338 ficheros, **4.318 tests**, 3 skipped (desde
  329 / 4.073 en clinica-6). Se corre desde la raíz (`pnpm test`).
- **e2e contra Postgres de verdad: los de clinica pasan.** Base propia de este
  worktree (`mipiacetpv_clinica4_e2e`), con las migraciones reales:
  **134 tests** de los seis ficheros clínicos, los 25 de este bloque
  incluidos.
- **La suite e2e entera: 540 de 546.** Los 6 que fallan son **f3-fichar y
  f8-colegio, y es EL RELOJ, no la rama** — el problema que clinica-5 dejó
  documentado en su §10: abren un fichaje «hace N horas» y lo cierran ahora,
  y si las dos marcas caen en días locales distintos el cierre da 409. Se
  corrió a las **01:00 y a las 02:14 de Madrid**, dentro de la franja mala de
  los dos (00:00–04:00 para `f3`, 00:00–06:00 para `f8`). La rama **no toca
  ni un fichero de fichaje** (`git diff --name-only master | grep -i fichaje`
  no devuelve nada). Se arregla relanzando el job pasadas las 06:00.
- `tsc` de API (con sus tests y su e2e), tpv-web, admin y el paquete nuevo ·
  limpio.

### Lo nuevo de este bloque

- `packages/consentimientos/test/consentimientos.test.ts` (28) · las
  plantillas con su huella fijada, la vigencia, el firmante y el informante.
- `packages/clinica-sesion/test/informe.test.ts` (18) · qué lleva cada tipo,
  las 5 últimas, y ni un importe.
- `apps/api/test/clinica-consentimientos-rutas.test.ts` (37) · firmar,
  revocar, la puerta de la sesión, el PDF con su huella y «Documentos».
- `apps/api/test/clinica-fotos-rutas.test.ts` (23) · la puerta de las fotos,
  la zona, el registro, la retirada y el comparador.
- `apps/api/test/clinica-informe-rutas.test.ts` (17) · ni un importe, el
  email sin datos de salud y la entrega apuntada dos veces.
- `apps/api/test/clinica-4-migracion.test.ts` (32) · el contrato del SQL.
- `apps/api/test-e2e/clinica-4.e2e.ts` (25) · los triggers, los CHECK y los
  RESTRICT contra Postgres.
- `apps/tpv-web/test/clinica-4-pantallas.test.tsx` (22) · las tres pantallas
  montadas: la firma, la cámara sin `input[type=file]`, el comparador y el
  papel sin importes.
- Y 5 casos nuevos en `clinica-sesion-pantalla.test.tsx`, 2 en
  `clinica-sesion-rutas.test.ts` y 5 en `clinica-tipos-panel.test.ts`.

---

## 11 · Commits

```
6f386f6 feat(clinica-4): las plantillas de consentimiento y el informe, puros
3f9195c feat(clinica-4): el consentimiento no se borra, la foto se retira
1494327 feat(clinica-4): la API de consentimientos, fotos e informe
7008811 feat(clinica-4): las pantallas, el panel y la copia de seguridad
b494192 test(clinica-4): los tres sabotajes que salieron VERDES
cfe0463 fix(clinica-4): el bucle visual, y cinco fallos que ninguna suite veía
<este>  docs(clinica-4): el done del bloque
```

## 12 · La CI

**`ci: success` · `smoke: success` · `e2e: failure`** sobre `01f882b`
([run 37864167997](https://github.com/matiasoyola/mipiace-tpv/actions/runs/37864167997)).
`publish` se salta, como toca fuera de master.

El `e2e` falla con **2 ficheros de 31** y son `f3-fichar` y `f8-colegio`:
**el reloj, no la rama.** Es el problema que clinica-5 dejó documentado en
su §10 — abren un fichaje «hace N horas» y lo cierran ahora, y si las dos
marcas caen en días locales distintos el cierre da 409. La CI corrió a las
**02:19 de Madrid**, dentro de la franja mala de los dos (00:00–04:00 para
`f3`, 00:00–06:00 para `f8`).

Lo que lo sostiene:

- los otros **29 ficheros pasan**, incluidos los seis clínicos y los 25
  casos de este bloque;
- la rama **no toca ni un fichero de fichaje**:
  `git diff --name-only master | grep -i fichaje` no devuelve nada;
- en local pasó lo mismo a la 01:00 y a las 02:14, y los mismos seis casos.

**Se arregla relanzando el job pasadas las 06:00 de Madrid**, que es lo que
clinica-5 hizo. Lo que lo arreglaría de verdad es que esos dos e2e no usen
el reloj de pared, y eso es de su bloque.

## 13 · La rama

**Ni merge ni despliegue: eso es de Dirección.** Y al desplegar hay tres
cosas que acordarse de hacer, no una: la migración, el volumen nuevo y la
copia de seguridad ampliada (§9).
