# Bloque clinica-8 · el día de Rosario funciona

Rama `clinica-8-el-dia-de-rosario`, worktree
`~/Developer/Claude/Projects/mipiacetpv-clinica-8`, desde `origin/master` = `d77a4ef`
(la auditoría en hierro del 18-10 y el prompt del bloque), con `origin/master`
= `480ce9c` mergeado al empezar la fase B.

**Las dos fases, en un documento.** La A se escribió primero y Dirección la
dio por buena el 23-10; la B va a partir de la [parte B](#parte-b--pulido-puntos-10-20).
Lo que hay que leer para desplegar es **«[Al desplegar · las dos fases
juntas](#13--al-desplegar--las-dos-fases-juntas)»**, no el §5, que es sólo el
de la A.

La frase que tiene que ser verdad: **la primera consulta de Rosario se puede
dar, firmar y cobrar sin que nadie de Mi Piace toque nada** — y las nueve
cosas que lo impedían el 18-10 están cerradas (fase A). La fase B es lo que
hace que el día no cueste un truco en cada pantalla.

---

# PARTE A · el día funciona (puntos 1-9)

---

## 0 · Lo primero, porque es lo que cambia cómo se lee el resto

**La cita que «desapareció» estaba CANCELADA.** No se perdió, no se
corrompió, no la movió un worker: su fila tenía `status = 'CANCELLED'`. Y ese
único estado explica los tres síntomas a la vez, que es lo que lo convierte
en diagnóstico y no en hipótesis:

| Síntoma del 18-10 | De dónde sale |
|---|---|
| «no sale en la agenda» | `listAppointments` filtra `status <> 'CANCELLED'` |
| «su hora vuelve a ofrecerse» | `setStatus` pone `appointment_assignments.active = false`, y el motor mira `active` |
| «sigue en Clientes → Historial» | `listForClient` **no** filtra por estado — y la pantalla la pintaba «Cita» a secas |

Se comprobó recorriéndolo (§1.1), no deduciéndolo: con la cita cancelada, las
tres superficies contestan exactamente lo que la auditoría fotografió.

**Y lo que NO se encontró, que es la parte incómoda:** ningún camino
automático que cancele una cita. El único escritor de `CANCELLED` en todo el
repo es `PATCH /agenda/appointments/:id` desde la pantalla. El worker del TTL
sólo toca `PENDING` (y la cita era `CONFIRMED`, captura 63). Así que el
único camino que queda es un toque — y hasta este bloque **«Cancelar» era UN
toque, sin confirmar, en una rejilla de cuatro botones del panel que estaba
abierto en la captura 63**, irreversible y sin rastro.

Eso es lo que se ha arreglado: cancelar pregunta, el historial dice el
estado, y hay una consulta para encontrar en producción las citas que ya
están así. Lo que no puedo afirmar es quién pulsó; lo digo aquí en vez de
inventar una causa que cuadre.

---

## 1 · Los nueve puntos, uno a uno

### 1.1 · La cita que desaparece

**Cómo se reprodujo.** Pila entera contra Postgres de verdad
(`mipiacetpv_clinica8_banco_e2e`, seed de la clínica del banco), con el
estado de partida del 18-10: una sola profesional con perfil de agenda, la
propietaria sin la marca sanitaria. Cita creada por la API del TPV con el
token de la cajera, `PRESENCIAL` → `CONFIRMED`, assignment activo.

Después, **la secuencia exacta del prompt**: `PATCH /staff/:id/clinica` con
el colegiado `45-0123`, `PUT /staff/:id` (perfil), `PUT /staff/:id/skills`
(los 17 servicios) y `POST /staff/:id/shifts` (el turno). Resultado:

```
status      = CONFIRMED
assignments = 1, active = t
GET /agenda      → la cita está, en la columna de la profesional
POST /availability → NO ofrece las 10:00
```

**La secuencia de Personal no cancela nada.** Y el colegiado `45-0123` se
guardó con un `200` (ver §1.5). Lo que sí reproduce los tres síntomas, los
tres, es cancelar:

```
PATCH /agenda/appointments/<id> {"status":"CANCELLED"}
GET /agenda                  → appointments: 0
POST /agenda/availability    → ofrece 08:00Z (10:00 de Madrid)
GET /clients/<id>/history    → la cita, sin una palabra de su estado
```

**La consulta para producción** (sólo lee; no se ejecuta desde aquí):

```sql
-- clinica-8 · citas CANCELADAS que siguen apareciendo en el historial de
-- su paciente y cuya hora volvió a ofrecerse. Lo que se busca son las
-- recientes y SIN motivo a la vista: una cancelación normal la hace alguien
-- con días de antelación; las de este caso se cancelan el mismo día o el
-- día antes, muy poco después de crearse.
SELECT t.name                                   AS comercio,
       a.id                                     AS cita,
       c.first_name || ' ' || c.last_name       AS paciente,
       lower(a.timeslot) AT TIME ZONE 'Europe/Madrid' AS cuando,
       a.created_at      AT TIME ZONE 'Europe/Madrid' AS creada,
       a.updated_at      AT TIME ZONE 'Europe/Madrid' AS cancelada,
       age(a.updated_at, a.created_at)          AS vivio,
       a.source,
       (SELECT count(*) FROM appointment_assignments x
         WHERE x.appointment_id = a.id AND NOT x.active) AS huecos_liberados
  FROM appointments a
  JOIN tenants  t ON t.id = a.tenant_id
  LEFT JOIN clients c ON c.id = a.client_id
 WHERE a.status = 'CANCELLED'
   AND t.clinical_records_enabled = true
   -- Vivió menos de un día: se creó y se canceló casi seguido.
   AND a.updated_at - a.created_at < interval '1 day'
   -- Y se canceló el mismo día de la cita o después de darla.
   AND a.updated_at >= a.created_at
 ORDER BY a.updated_at DESC
 LIMIT 100;
```

Lo que **no** hace la consulta: adivinar la intención. Devuelve las
candidatas con el tiempo que vivió cada una para poder mirarlas con la
clínica delante; una cancelación de verdad y un toque sin querer no se
distinguen en el dato, y escribir una consulta que finja distinguirlos sería
peor que no tenerla.

**Lo que se arregla.**

1. **Cancelar pregunta.** `AgendaPage` abre un diálogo que dice lo que va a
   pasar: «Sale de la agenda y su hora vuelve a ofrecerse. No se puede
   deshacer». `No-show` también, porque también libera el hueco. Las otras
   tres transiciones (confirmar, en sala, finalizar) siguen siendo un toque:
   se corrigen tocando otra.
2. **El historial dice el estado.** «Cita · cancelada» en gris, y lo mismo
   con «no vino» y «hecha». `CONFIRMED` no lleva etiqueta a propósito: es el
   estado de casi todas y escribirlo en cada línea es ruido. Lo que hay que
   poder leer de un vistazo es lo que NO es normal — y sobre todo
   «cancelada», que es el único estado en el que la cita no está en la
   agenda.

**Lo que NO se ha hecho, y por qué.** No se pintan las canceladas en la
rejilla. `listAppointments` las excluye desde B-reservas-4 y pintarlas
cambiaría la agenda de los quince comercios de hoy —una peluquería cancela
mucho— por un caso de una clínica. Lo que había que cerrar era el camino
accidental y la mentira del historial, y eso está cerrado.

### 1.2 · Una sola verdad en el cobro

Es el peor de los nueve, porque **cuadra**. La cita se dio como «Quiropodia
completa · 26 €», la sesión se cerró sin una sola línea cobrable, y «Cobrar
en caja» abrió un ticket de 26 €. Se cobró la previsión en vez del trabajo y
no hay nada en la pantalla que lo delate: los importes están bien.

La causa era una respuesta de **dos** valores. `lineasDeLaSesionCerrada`
devolvía `null` tanto para «aquí no hay nada clínico» como para «la sesión
cerrada no dejó nada que cobrar», y el cobro no podía distinguirlos: los dos
caían a los servicios reservados de la cita.

Ahora son **tres**, y cada uno tiene su dueño:

| Respuesta | Cuándo | Qué hace el cobro |
|---|---|---|
| `null` | no hay sesión, tenant sin clínica, **o la lectura falló** | los servicios de la cita, como siempre |
| `{ lineas }` | la sesión dejó líneas | **eso** es lo que se cobra |
| `{ sinNadaQueCobrar: true }` | sesión CERRADA y LEGIBLE, cero líneas | abre el borrador **vacío** y lo dice |

La diferencia entre el tercero y el primero es si el **cuerpo se pudo leer**:
un cuerpo ilegible es una lectura rota y cae al camino de siempre; un cuerpo
legible sin `tratamientos` es un hecho de esa consulta (la regla 11 de
clinica-5: una visita sin servicio asignado PASÓ y tiene que quedar escrita).

**«Cobrar siempre se puede» sigue intacto**, y esto es lo que había que
cuidar: la lectura que revienta sigue cayendo al camino de antes del bloque.
Lo que cambia es sólo el caso que el servidor SABE.

En pantalla: el TPV no se va a caja en silencio. Enseña «La sesión no tiene
nada que cobrar · En la consulta no se marcó ningún servicio cobrable, así
que el ticket sale vacío. Añade el servicio que se hizo», con el botón que
entra al borrador. El aviso va en el detalle y no en un toast: un toast de
3,5 s sobre una pantalla que se cierra sola no lo lee nadie, y lo que hay que
hacer después necesita un botón.

### 1.3 · El alta deja la clínica lista para cobrar

Dos mitades.

**a) Cuatro columnas nuevas en el CSV**, todas opcionales, en
`apps/api/src/catalog/csv-catalogo.ts`:

```
…,categoria,tipo,exencion,duracion_min,tipo_visita,primera_valoracion,tratamiento_sesion,nivel_quiropodia
POD-003,Quiropodia completa,26.00,0,quiropodia,SERVICE,E1,30,QUIROPODIA,no,si,2
```

`catalogo-servicios-csv` las dejó fuera a propósito y lo escribió: «nacen en
su default y se ponen en el panel». La auditoría midió lo que eso significa
en el hierro — catálogo cargado entero, sesión a 0,00 € — así que entran.

Tres decisiones que no son obvias:

- **`tipo_visita` es de la CATEGORÍA, no del servicio** (S5: el agrupador
  único es la categoría y los servicios heredan). Se escribe en la fila
  porque es donde está la categoría, y **todas las filas de una categoría
  tienen que decir lo mismo**: si no, se rechaza la segunda nombrando la
  línea de la primera.
- **Un nivel por nivel.** Dos servicios que digan ser «quiropodia extra»
  dejan a la sesión sin saber cuál cobrar. El índice único parcial de
  clinica-5 lo rechazaría al escribir y entonces **no entraría ninguna fila**
  (la carga es todo o nada): decirlo en la vista previa es la diferencia
  entre arreglar una celda y no saber por qué no entra nada.
- **Las cuatro son de SERVICIOS.** En una fila `PRODUCT` se rechaza la fila
  con su motivo: una crema no es el nivel de nada, y callarlo dejaría al
  implantador creyendo que ha configurado la quiropodia.

Y la puerta de siempre: **las marcas sólo entran en un comercio con la
historia clínica encendida**, igual que `E1` y por lo mismo. La fila se salta
con su motivo en vez de entrar sin marcas — un servicio que el fichero
declara «tratamiento de la sesión» y que entra sin serlo es un botón que no
sale y nadie sabe por qué.

Se escriben **dentro de la misma transacción** que el producto y su fila de
agenda, por la razón de `catalogo-servicios-csv`: en DRAFT no hay OWNER que
pueda arreglar un catálogo a medias.

El mapa `categoría → tipo` se escribe con un `upsert` que **respeta lo que ya
hubiera**: si la categoría ya tiene otro tipo, se deja el que había (la dueña
lo movió desde su panel y el fichero no manda sobre eso) y queda en el log.

**La vista previa las enseña**: una columna «Clínica» con los chips de cada
fila —sólo cuando el fichero trae marcas, para que el CSV de un bar no tenga
una columna de guiones— y una banda arriba con el mapa de tipos de visita
(«quiropodia → Quiropodia · cirugia → Cirugía · revisión»), que es lo que la
dueña repasa de un vistazo.

**b) `docs/implantaciones/rosario/catalogo-tpv.csv` actualizado** con las
cuatro columnas: cinco categorías tipadas, los tres niveles de quiropodia, y
«Consulta diagnóstico» como primera valoración. Parsea limpio: 17 filas, cero
saltadas. **Tres decisiones que son de Rosario y están escritas en su
README** para preguntárselas: la «Cura» pasa de `quiropodia` a `cirugía`, las
órtesis de silicona van como `GENERAL`, y la consulta de diagnóstico es la
primera valoración.

**c) El check de onboarding «Catálogo clínico completo»**, en
`onboarding-health.ts`, con `requires: "clinica"` — en los catorce comercios
sin historia clínica sale «No aplica · sin historia clínica» y no bloquea
nada, ni cuesta una consulta.

Mide tres cosas, y cada una es lo que la sesión necesita para poder poner una
línea en caja:

1. **cada tipo de visita DECLARADO tiene servicio.** «Declarado» es la
   palabra: lo que se mira son las categorías que el centro ha marcado, no
   los cinco tipos de la lista. Una podóloga que no hace biomecánica no tiene
   que inventarse un servicio para activarse; lo que no puede es declarar
   «cirugia → CIRUGIA» y no tener nada dentro.
2. **los tres niveles de quiropodia**, y sólo si el centro declara
   quiropodia.
3. **una primera valoración.**

Y **bloquea la activación**, igual que `tickets-before-holded` y por la misma
razón: una clínica activada con el catálogo a medias factura de verdad desde
el primer cobro, y el primer cobro es el de una paciente que ya se ha ido. Lo
que cuesta arreglarlo antes es una columna del fichero.

### 1.4 · Entrar por la agenda

Decisión de producto de Matías, no re-debatida.

- **El TPV abre en la agenda** cuando el centro tiene historia clínica. Se
  decide con la caché del catálogo —la misma que ya decide si hay mesas y si
  la cuenta está en ensayo—, así que vale sin red y está puesta antes de que
  la pantalla exista. Su default es `false`: los catorce comercios sin
  clínica abren donde abrían ayer. **Es la vista inicial, no una cárcel**:
  «Volver» cierra la agenda y deja la venta suelta debajo, entera.
- **«Sesión de hoy» pasa a ser el botón fuerte** del detalle de la cita, y
  **«Cobrar en caja» aparece cuando la sesión está cerrada**, con el ticket
  ya hecho. Antes era al revés —cobrar era el coral pleno y la sesión el
  suave—, o sea que la pantalla invitaba a cobrar la previsión antes de
  registrar la consulta.
- Mientras la sesión no esté cerrada, el hueco del botón **no se queda
  vacío**: una línea dice «El cobro sale al cerrar la sesión de hoy, con el
  ticket ya hecho. Para cobrar algo aparte, usa la venta». La salida existe y
  se nombra.

Fuera de un centro clínico el panel es exactamente el de ayer. Hay test de
las dos mitades.

### 1.5 · «Es sanitario» guarda o avisa

**El formato del colegiado no tenía nada que ver.** Se comprobó contra la API
de verdad: `PATCH /staff/:id/clinica` con `colegiado: "45-0123"` contesta
`200` y guarda `45-0123`. No hay ninguna validación de formato, ni en la
ruta, ni en el esquema, ni en un CHECK de la base (`users_clinician_license_
not_blank` sólo prohíbe el blanco).

Lo que sí había, y es lo que explica «falla en silencio»: **esta pantalla
tiene cuatro botones de guardar y ninguno decía nada.** El acierto se notaba
porque los datos se refrescaban solos; el fallo salía como un aviso rojo en
la **cabecera de la página**, lejos del botón que se acaba de pulsar y fuera
de la pantalla con la tarjeta desplegada. Con la tarjeta de Rosario
desplegada, «Guardar» de Historia clínica está a media pantalla del aviso.

Arreglado:

- **cada guardado contesta donde está el dedo**, y contesta también cuando
  sale bien: un «Guardado.» es lo que distingue «no se ha enterado» de «se ha
  guardado y se ve igual». Los cuatro: perfil, historia clínica, servicios y
  turnos;
- **el fallo de red deja de ser mudo**: antes sólo se contaba el `ApiError`;
- **el botón de Guardar ya no se desactiva** cuando falta el colegiado. Un
  botón apagado en una tablet se lee como «esto está roto»: se pulsa, no pasa
  nada y nadie sabe por qué. Ahora se pulsa y contesta qué falta **y en qué
  formatos vale el número**;
- y el campo lo dice antes de que cueste un intento: «Como lo tengas:
  45/0123, 45-0123, COL-450123… se guarda tal cual».

Lo que **no** entra aquí: el «un solo guardado por tarjeta» es el punto 16 de
la fase B.

### 1.6 · El cambio de sanitaria llega sin volver a entrar

`isClinician` se lee en el login del cajero y esa sesión dura el turno entero
(12 h por defecto), así que marcar a alguien sanitario desde el panel no le
llegaba al TPV hasta cerrar sesión y volver a entrar. Desde fuera eso se ve
como «la cita no enseña nada clínico» y no hay forma de saber por qué.

`GET /agenda` devuelve ahora `esSanitario` —la marca de quien mira, leída de
la fila— y la agenda se refresca cada vez que se abre, así que es el sitio
natural. `AgendaPage` avisa hacia arriba y `App` lo guarda en la sesión de
memoria, de donde lo leen la venta y la agenda.

Tres cosas de forma, y las tres hacen trabajo:

- **la clave viaja sólo cuando hay algo que decir**: `null` (y clave ausente)
  en los catorce comercios sin clínica, que es donde no cuesta ni una
  consulta — `clinicaIsEnabled` es la misma lectura del tenant que ya hacen
  las otras dos piezas clínicas de esa ruta;
- **falla hacia «no sé»**, nunca hacia «no es sanitaria»: una marca que no se
  pudo leer no puede quitarle los botones a quien los tenía;
- y **no abre ninguna puerta**: cada ruta clínica vuelve a comprobar la marca
  contra la base, y `resolverAccesoClinico` la lee de la fila y no del token.
  Esto decide qué BOTONES se pintan.

### 1.7 · Contrato de encargado

La v1 nombraba como encargado a «Mi Piace Software, S.L.», que no existe. La
sociedad que firma es **MI PIACE INTERNET SOLUTIONS, S.L., NIF B45902186,
domicilio en Carretera CM-5100, km 30,500, Buenaventura, 45634 Toledo**.

Entra como **v2**, no como corrección de la v1, y ésa es la decisión del
punto: la v1 **ya está aceptada y firmada** por la «Clínica demo», con su
fecha y su huella SHA-256 guardadas. Reescribirla cambiaría la huella de una
aceptación que ya ocurrió — la pantalla enseñaría un texto que la dueña no
vio. La v1 se queda intacta y para siempre en `VERSIONES`; quien la aceptó
pasa a «hay una versión nueva» y la vuelve a aceptar, que es justo para lo
que existe el versionado.

La v2 se construye **desde la v1** (`{...CONTRATO_V1, apartados: [nuevo,
...resto]}`): sólo cambia el primer apartado, y copiar los otros diez a mano
sería abrir la puerta a que una coma se moviera sin que nadie lo notara. Con
la huella metida en medio, una coma es un contrato distinto.

Las huellas, las dos fijadas por test:

```
v1  7baee64a600f5a9de15038758b7118f99185174acda455df9426b35126bd0d8a   (NO se mueve)
v2  4aab2e6f850492179d270fbce06ad71af4b11b77ddcde35fdec10c145f066de0   (cambia a propósito)
```

Sigue `pendienteDeValidar: true`: el abogado de protección de datos no lo ha
visto (tarea humana 11 de clinica-1).

### 1.8 · El cajero técnico y los revocados

En Cajeros salían tres clases de usuario que no son personal del cliente: el
**cajero técnico** de «Probar TPV» (`mipiacetpv-test-…@internal…`), el
**revocado** (`revoked-1792…@revoked.local`) y el **borrado** (`deleted_at`
puesto, que es lo que la activación le hace al técnico). Los tres con sus
tres botones.

Y no era cosmética: **la revocación deja `pin_hash = NULL`, pero «Cambiar
PIN» le pone uno nuevo.** O sea que desde esa pantalla se podía resucitar a
un cajero revocado y al cajero técnico de Mi Piace — un acceso a la caja del
cliente que nadie concedió. La auditoría del 18-10 le cambió el PIN al
técnico sin querer (captura 64: «PIN actualizado»).

Un solo `where` compartido (`PERSONAL_DE_LA_CAJA`) en las **cuatro** rutas
—listar, renombrar, cambiar el PIN y revocar—, porque esconder el botón no
cierra la ruta. Y `cashier-login` gana `deletedAt: null`: lo que cerraba la
puerta al técnico borrado era el `pin_hash` nulo, o sea un efecto lateral del
borrado y no una comprobación.

### 1.9 · La historia del paciente, siempre a pantalla completa

Desde la cita abría así desde clinica-6; desde la ficha del cliente se
pintaba **dentro del cajón lateral**, cortada y con el mapa de los dos pies
desbordándose (capturas 77–80).

No es un problema de anchos que se arregle con un `max-width`: la historia es
una pantalla entera de iPad apaisado —clinica-6 §3 hace la cuenta, 576 px
sólo para la columna de los pies—. Y **dos sitios donde la misma pantalla se
ve distinta son dos sitios donde una úlcera cae en distinto punto del pie**.

Ahora la pestaña «Historia» abre el mismo overlay que desde la cita, con
**portal a `document.body`**: el cajón de la ficha es un `fixed` con z-index
propio, y una hoja que pidiera estar encima desde dentro sólo subiría dentro
de ese peldaño — es la trampa que clinica-3 pagó con la barra de cobro (§7.1
de su done). El valor `"historia"` sale del tipo `Tab` para que no quede una
rama muerta.

---

## 2 · Decisiones tomadas sin preguntar

1. **La cita cancelada NO se pinta en la rejilla** (§1.1). Lo que se arregla
   es el camino accidental y la mentira del historial.
2. **El borrador vacío se abre y se avisa**, en vez de contestar un error
   (§1.2). Un error dejaría a quien cobra sin nada que tocar con la paciente
   delante; el borrador vacío es «añade el servicio que se hizo».
3. **En una clínica, «Cobrar» no se ofrece antes de cerrar la sesión**
   (§1.4), con la línea que dice dónde está la salida. Es la lectura literal
   del prompt; la venta suelta sigue entera en el menú.
4. **`tipo_visita` se declara por fila y se aplica a la categoría** (§1.3).
   La alternativa —un fichero aparte de categorías— es un segundo fichero que
   mantener para cinco líneas.
5. **El fichero no pisa un tipo de visita que ya existe** (§1.3): si la dueña
   lo movió desde su panel, manda ella.
6. **El check de catálogo clínico mira los tipos DECLARADOS, no los cinco**
   (§1.3). Exigir los cinco bloquearía a una fisioterapeuta.
7. **Tres asignaciones del CSV de Rosario** (la cura a cirugía, las órtesis a
   general, la consulta como primera valoración) están puestas y **escritas
   en su README para preguntárselas**. Ninguna bloquea la carga.
8. **El botón «Guardar» de la sección clínica deja de desactivarse** (§1.5).
9. **Los revocados desaparecen de la lista** en vez de salir marcados como
   revocados (§1.8). Lo que el prompt pide es que no salgan «con acciones»; y
   su histórico operativo sigue entero en turnos y tickets, que es para lo
   que la revocación es un soft-delete.

---

## 3 · Tabla de sabotajes

Cada garantía rota a propósito sobre la línea de producción, con el **fichero
de test entero** (no `-t`), restaurando con `git checkout --` después de
cada una. Los mensajes son los reales, copiados de la salida.

| # | Qué se rompe | Dónde | Fichero | Rojo | Mensaje real |
|---|---|---|---|---|---|
| **El cobro (§1.2)** |
| 1 | la sesión sin líneas vuelve a devolver `null` | `lineas-de-la-sesion.ts` | `clinica-sesion-rutas` | 🟢 → 🔴 1 | `expected null to deeply equal { sinNadaQueCobrar: true }` |
| 2 | el cobro ignora `sinNadaQueCobrar` | `agenda/checkout.ts` | `clinica-8-cobro-de-la-sesion` | 🔴 2 | `expected [ { id: 'line-0', …(12) } ] to deeply equal []` · `… not to contain 'SVC-COMPLETA'` |
| **La cita que desaparece (§1.1)** |
| 3 | cancelar vuelve a ser UN TOQUE | `AgendaPage.tsx` | `clinica-8-agenda` | 🔴 4 | `expected [ { …(2) } ] to deeply equal []` (el PATCH salió sin preguntar) |
| 4 | el historial vuelve a pintar «Cita» a secas | `ClientsPage.tsx` | `clinica-8-ficha-del-cliente` | 🔴 2 | `expected '…' to contain 'Cita · cancelada'` |
| **Entrar por la agenda (§1.4)** |
| 5 | el cobro se ofrece antes de cerrar la sesión | `AgendaPage.tsx` | `clinica-8-agenda` | 🔴 1 | `expected <button …(2)></button> to be null` |
| 6 | «Sesión de hoy» vuelve a ser el botón suave | `AgendaPage.tsx` | `clinica-8-agenda` | 🔴 1 | `expected 'w-full min-h-touch rounded-xl…' to contain 'bg-mipiace-coral '` |
| 7 | el TPV de una clínica vuelve a abrir en la venta | `App.tsx` | `clinica-8-entrar-por-la-agenda` | 🔴 2 | `expected false to be true` |
| **El alta deja la clínica lista (§1.3)** |
| 8 | dos servicios pueden ser el MISMO nivel | `csv-catalogo.ts` | `clinica-8-csv-clinico` | 🔴 1 | `expected [ 'A-1', 'A-2' ] to deeply equal [ 'A-1' ]` |
| 9 | la columna `tipo_visita` se ignora | `csv-catalogo.ts` | `clinica-8-csv-clinico` | 🔴 5 | `expected Map{} to deeply equal Map{ 'consulta' => 'GENERAL', …(4) }` |
| 10 | un sí/no que no se entiende se lee como «no» | `csv-catalogo.ts` | `clinica-8-csv-clinico` | 🔴 1 | `expected [ { linea: 2, …(4) } ] to deeply equal []` |
| 11 | las marcas no llegan a la fila de agenda | `tenant-catalog.ts` | `catalogo-servicios-csv-import` | 🔴 3 | `expected null to be 1` · `expected [] to deeply equal [ 'POD-001' ]` |
| 12 | **los tipos de visita se escriben FUERA de la transacción** | `tenant-catalog.ts` | `catalogo-servicios-csv-import` | 🟢 → 🔴 1 | `expected 5 to be +0` |
| 13 | las marcas entran en un comercio sin clínica | `tenant-catalog.ts` | `catalogo-servicios-csv-import` | 🟢 → 🔴 1 | `expected [ 'SVC-1', 'SVC-2' ] to deeply equal [ 'SVC-2' ]` |
| 14 | el check del catálogo clínico siempre dice que sí | `onboarding-health.ts` | `clinica-8-catalogo-clinico` | 🔴 4 | `expected true to be false` |
| 15 | el check no aplica nunca, ni en una clínica | `onboarding-health.ts` | `clinica-8-catalogo-clinico` | 🔴 3 | `expected false to be true` |
| **La historia a pantalla completa (§1.9)** |
| 16 | la historia vuelve a pintarse DENTRO del cajón | `ClientsPage.tsx` | `clinica-8-ficha-del-cliente` | 🔴 1 | `expected true to be false` (el overlay está dentro del contenedor) |
| **Los cajeros (§1.8)** |
| 17 | en Cajeros vuelven a salir el técnico y los revocados | `cashiers/routes.ts` | `clinica-8-cajeros` | 🔴 4 | `expected [ …(2) ] to deeply equal [ Array(1) ]` |
| 18 | **«Cambiar PIN» vuelve a alcanzarlos** | `cashiers/routes.ts` | `clinica-8-cajeros` | 🔴 3 | `expected 200 to be 404` |
| **El contrato (§1.7)** |
| 19 | la razón social se corrige EN LA v1 | `contrato.ts` | `contrato-encargado` | 🔴 2 | `expected '3dd72930…' to be '7baee64a…'` — la huella de una aceptación que ya ocurrió |
| **La marca sanitaria (§1.6)** |
| 20 | la marca deja de viajar con la agenda | `marca-sanitaria.ts` | `clinica-8-marca-sanitaria` | 🔴 1 | `expected null to be true` |
| 21 | **falla hacia «no es sanitaria» en vez de «no sé»** | `marca-sanitaria.ts` | `clinica-8-marca-sanitaria` | 🟢 → 🔴 1 | `expected false to be null` |
| **Personal (§1.5)** |
| 22 | el guardado de la sección clínica vuelve a ser mudo | `StaffPage.tsx` | `clinica-8-personal` | 🔴 4 | `expected [] to include 'ok: Guardado.'` |

### Los cuatro que salieron VERDES, que son los que enseñaron algo

**#1 · el banco del cobro MOCKEA la función que se saboteaba.**
`clinica-8-cobro-de-la-sesion.test.ts` mockea
`clinica/lineas-de-la-sesion.js` para poder poner los tres valores a mano,
así que romper esa función ahí no se puede ver — el fichero salió verde con
el sabotaje puesto. Lo que sí lo caza es `clinica-sesion-rutas.test.ts`, que
la ejercita de verdad contra su Prisma falso. **Un sabotaje hay que correrlo
contra el fichero que ejercita la línea, no contra el que habla del tema.**

**#12 · el test de la transacción reventaba el paso EQUIVOCADO.** «Los tipos
de visita se escriben DENTRO de la transacción» hacía reventar la fila de
**agenda**, que se escribe antes: al abortar ahí, los tipos no llegaban a
escribirse ni dentro ni fuera, y el test no distinguía las dos cosas —
pasaba en verde con la escritura sacada de la transacción. Se revienta la
**auditoría**, que va después, y entonces sí se ve: escritos dentro, la
vuelta atrás se los lleva; escritos fuera, sobreviven. Es la misma forma que
el fake del `$transaction` de `catalogo-servicios-csv` (§2 de su done), un
piso más abajo.

**#13 · la puerta se probaba con un fichero que ya se saltaba por otra
puerta.** El CSV de Rosario lleva `E1` en las 17 filas, así que en un
comercio sin clínica se saltan **por la puerta de la exención** de
`catalogo-servicios-csv`: quitar la puerta nueva no cambiaba nada. Ahora el
test usa dos filas al 21 % y sujetas, donde lo único que un bar no puede
tener son las marcas.

**#21 · la rama del `catch` era inalcanzable por donde la probaba el test.**
El caso «si la lectura revienta» hacía fallar la lectura del **tenant**, y
`clinicaIsEnabled` tiene su propio `try/catch` que devuelve `false`: el
`null` que el test veía salía de la capability, no del `catch`. Así que
cambiar el `catch` a `false` pasaba en verde. Revienta ahora la lectura del
**usuario**, que es la única que llega hasta ahí. Es la memoria de la casa —
«una escapatoria inalcanzable no está cerrada: medirla» — en el banco en vez
de en el motor.

---

## 4 · Lo que la fase A NO cubre

- **Toda la fase B** (puntos 10–20): fotos, nombre en vez de email,
  confirmación al cerrar la sesión, el tipo de visita preseleccionado, el test
  en la tablet, los consentimientos desde Fotos, el guardado único de
  Personal, la agenda, el panel, la venta y `/apk`.
- **El PIN personal y cambiable**, los roles sin probar y el importador de
  COGECOP: están fuera del bloque por decisión del prompt.
- **La pasada en hierro** con la «Clínica demo» y la Lenovo: hace falta el
  aparato y la cuenta de producción, y producción la teclea Matías. El guion
  va en el `-done` final de la fase B.
- **Quién canceló la cita del 18-10** (§0). El estado está diagnosticado y el
  camino accidental cerrado; el autor no se puede saber desde el dato.

---

## 5 · Al desplegar (fase A)

> **Esto es sólo la fase A.** La lista que hay que seguir el día del
> despliegue es la de §13, que junta las dos.

1. **NO HAY MIGRACIÓN.** Ni una tabla, ni una columna, ni un enum. Todo lo de
   la fase A escribe en columnas que ya existen (`service_scheduling`,
   `tag_visit_types`, `users`).
2. **No hay variables de entorno nuevas.** Ninguna.
3. **El contrato sube a la v2, y eso deja la clínica EN SOLO LECTURA hasta
   que la dueña lo acepte.** No es un aviso: es la garantía de clinica-7 —
   una aceptación de una versión vieja no vale, y `conHistoria` contesta
   **423** a toda escritura clínica. O sea que el día del despliegue, hasta
   que Rosario (o la «Clínica demo») acepte el contrato nuevo en Ajustes ›
   Contrato de tratamiento de datos, **no se puede cerrar una sesión ni
   escribir nada en una historia**. La agenda y la caja siguen funcionando;
   lo que además se pierde mientras tanto es la nota libre de las citas
   nuevas.

   **Lo primero del guion del día de la visita: aceptar el contrato.** Lo
   encontró este bloque porque cuatro ficheros de e2e se fueron enteros a
   423 al sacar la v2 (§7).

   La v1 se sigue pudiendo descargar en PDF: no se quita de `VERSIONES`.
4. **La «Clínica demo» necesita recargar su CSV** para quedarse con las
   marcas de clínica — o ponerlas a mano en Catálogo de agenda. Un SKU que ya
   existe **no se pisa**, así que una segunda carga del mismo fichero no
   escribe las marcas en los servicios que ya están: hay que ponerlas en el
   panel, o borrar el catálogo y volver a cargarlo en una cuenta de ensayo.
5. **APK nueva**: el front del TPV cambia (la agenda de entrada, el detalle de
   la cita, el diálogo de cancelar, la historia a pantalla completa).
6. **Ningún comercio sin historia clínica nota nada**: el TPV abre donde
   abría, el detalle de la cita es el de ayer, el check nuevo sale «No
   aplica» y el CSV de La Maestranza se carga igual (hay test con el fichero
   real).
7. **Lo que SÍ cambia para quien ya tiene la clínica encendida**: el TPV abre
   en la agenda; «Cobrar en caja» espera a la sesión; cancelar pregunta; y en
   Cajeros desaparecen el cajero técnico y los revocados.

---

## 6 · Verde

| Suite | Resultado |
|---|---|
| `npx vitest run` (workspace, desde la raíz) | **416 ficheros · 5.891 tests**, 10 saltados |
| `pnpm test:e2e` (los 46 ficheros, Postgres real) | **46 ficheros · 985 tests** — ver la nota del reloj |
| `tsc --noEmit` api · `tsc -b` admin · `tsc -b` tpv-web | limpio |

Una nota de la última corrida del workspace: `cashier-login.test.ts` salió
rojo UNA vez en el test del **rate limit** («se resetea tras un login
exitoso») y verde al volver a correrlo solo y al correr el proyecto de la
API entero (207 ficheros, 3.046 tests). Es un test que mide ventanas de
tiempo y se cae bajo carga; no toca nada de este bloque — lo que este bloque
le añadió a esa ruta (`deletedAt: null`) lo cubre `clinica-8-cajeros`.

El e2e corrió sobre una base propia de este worktree
(`mipiacetpv_clinica8_e2e2`) con las 92 migraciones reales aplicadas.

**Y se corrió dos veces, por el reloj.** La primera, lanzada a las 23:58 de
Madrid: **45 de 46 ficheros en verde**, y el único rojo era un aserto de
este bloque (`h1-empresa-sin-caja` contaba seis checks que no aplican y
ahora son siete, con el del catálogo clínico). Arreglado eso, la segunda
corrida empezó pasada la medianoche y cayeron **`f3-fichar` y `f8-colegio`**
(6 tests): son los dos ficheros que escriben «hace N horas» y cruzan el día
local, la franja mala de 00:00 a N:00 que ya está documentada en
puesta-en-marcha §8.1. La rama **no toca ni un fichero de fichaje**, y en la
corrida de las 23:58 los dos pasaron. **No se corre el e2e de madrugada.**

### Lo nuevo de este bloque

| Fichero | Qué fija |
|---|---|
| `api/test/clinica-8-cobro-de-la-sesion.test.ts` (5) | los tres valores de la respuesta y qué hace el cobro con cada uno |
| `api/test/clinica-8-csv-clinico.test.ts` (24) | el CSV real de Rosario, el de La Maestranza intacto y las ocho negativas |
| `api/test/clinica-8-catalogo-clinico.test.ts` (7) | el check que bloquea la activación, y a quién no aplica |
| `api/test/clinica-8-cajeros.test.ts` (8) | la lista y las tres rutas que escriben |
| `api/test/clinica-8-marca-sanitaria.test.ts` (5) | la marca al día, y que falla hacia «no sé» |
| `tpv-web/test/clinica-8-agenda.test.tsx` (9) | cancelar pregunta, y el orden de la cita en una clínica |
| `tpv-web/test/clinica-8-ficha-del-cliente.test.tsx` (6) | el estado en el historial y la historia a pantalla completa |
| `tpv-web/test/clinica-8-entrar-por-la-agenda.test.tsx` (3) | dónde abre el TPV, y que los catorce no cambian |
| `admin/test/clinica-8-personal.test.tsx` (10) | el colegiado con cualquier formato y los guardados que contestan |

Y ocho ficheros que ya existían, ampliados o corregidos: el import del CSV
(las marcas y los tipos en la transacción), `clinica-sesion-rutas` (el tercer
valor), el contrato (la v2 y que la v1 no se mueve), `h1-salud-modulos` y
`h1-empresa-sin-caja` (el séptimo check), `catalogo-servicios-csv.e2e` (las
marcas ya entran), `clinica-personal` (el botón que ya no se desactiva) y
cuatro e2e que sembraban la versión del contrato a mano.

---

## 7 · Lo que el bloque encontró por el camino

**Subir la versión del contrato deja la clínica en SOLO LECTURA.** Es el
diseño de clinica-7 funcionando —una aceptación de una versión vieja no
vale— pero lo descubrí porque **cuatro ficheros de e2e se fueron enteros a
423** al sacar la v2. Dicho en lo que le pasa a Rosario: el día del
despliegue, hasta que la dueña acepte el contrato nuevo en su panel, **no se
puede cerrar una sesión ni escribir nada en una historia**. La agenda y la
caja siguen; las citas nuevas pierden la nota libre. Va en §5.3 y es lo
primero del guion del día de la visita.

Los cuatro e2e sembraban `version: 1` escrito a mano; ahora siembran
`VERSION_VIGENTE`, así que la próxima versión no vuelve a costar una pasada.

---

## 8 · Estado de la rama al cerrar la fase A

- Fase A completa, con la suite y el e2e en verde y la tabla de sabotajes
  ejecutada (§3).
- **Fase B sin empezar**, como pedía el prompt.
- **Pusheada**, y el PR contra `master` es el
  [**#36**](https://github.com/matiasoyola/mipiace-tpv/pull/36).
- Ni merge ni despliegue: eso es de Dirección.

---

# PARTE B · pulido (puntos 10-20)

Dirección dio por buena la fase A el 23-10. La B se hizo sobre
`origin/master` = `480ce9c` mergeado en la rama (ver §14).

Lo que cambia de tono respecto de la A: la A arreglaba **nueve cosas que
impedían el día**; la B arregla **veinte sitios donde el día cuesta un truco**.
Ninguno de los once puntos tumba una consulta por sí solo. Juntos son la
diferencia entre «funciona» y «se puede dejar sola a Rosario con esto».

---

## 9 · Los once puntos, uno a uno

### 9.10 · Fotos · «se apunta y se dispara»

Matías, 18-10: «elegir la zona antes de disparar no es intuitivo». Y la
auditoría, en el mismo punto: «el disparador parece activo y no lo está; el
aviso queda lejos; el botón de zona no se distingue; imagen muy oscura con
poca luz; icono gigante de "play" mientras arranca la cámara». Cinco cosas en
una pantalla, y cada una tiene su arreglo.

**a) La zona viene puesta con la de la sesión de hoy.** `zonasDeHoy[0]`, que
es la zona que la podóloga acaba de tocar en el mapa del pie con el pie
delante. Lo que **no** cambia es que una foto clínica tenga zona: el
comparador antes/después es por zona y una foto sin ella no entra en él.
Cambia **quién la pone por defecto**.

**b) Y si no hay ninguna marcada, se dispara igual y se elige DESPUÉS.** El
frame se queda en la mano (`capturada`), la cámara se para —el LED encendido
mientras se elige una zona es la lección de `cameraScan` otra vez— y la
pantalla pregunta «¿De qué zona es esta foto?» **con la foto delante**. Eso
es mejor clínicamente que el camino de antes, no sólo más corto: elegir la
zona MIRANDO la foto es más fiable que elegirla de memoria antes de apuntar,
que es de donde salían las zonas equivocadas. Hay «Repetir la foto» y
«Descartarla», y hasta que se toca una zona **no se ha guardado nada**.

**c) El disparador bloqueado deja de parecer un disparador.** Era el mismo
círculo blanco pleno con `opacity-45`: un 45 % sobre negro sigue siendo un
círculo claro y grande, la única cosa redonda de la pantalla y el gesto
aprendido de cualquier cámara. Ahora, bloqueado, es un aro punteado sin
relleno con el icono de «no se puede» dentro. Y **lo que lo bloquea ya no es
que falte la zona** —eso se pregunta después— sino las tres cosas que de
verdad lo impiden: la cámara sin pintar todavía, un guardado en curso, o un
error.

**d) El póster de «play» de Android.** Un `<video>` sin frames es, para el
WebView, un vídeo parado, y lo pinta con un triángulo gigante centrado que
invita a tocarlo. `poster=""` no vale: Chrome trata un póster que no carga
como si no hubiera. Lo que hay es una **capa propia** —negro opaco, el estado
dentro, `pointer-events-none`— que se quita con el primer frame
(`onLoadedData`).

**e) La exposición con poca luz.** Dos cosas, y la segunda es la que importa:

- `frameRate: { ideal: 15 }`. El sensor de una tablet de 200 € expone en
  automático y lo que limita cuánto puede abrir el obturador es el frame
  rate: a 30 fps no puede pasar de 1/30 s. Pidiendo 15 se le deja llegar a
  1/15, que es el doble de luz, y 15 fps son de sobra para encuadrar un pie
  apoyado en un reposapiés. `ideal` y no `exact`, como la resolución.
- **Un botón de LUZ**, que es lo que de verdad arregla una consulta con la
  persiana bajada. Sólo sale si la PISTA dice que tiene flash
  (`track.getCapabilities().torch`), porque un botón de luz que no enciende
  nada es peor que no tenerlo; y si al pulsarlo el aparato dice que no, deja
  de ofrecerse en vez de quedarse mintiendo.

### 9.11 · Nombre, no email

El punto con la causa de raíz más clara de todo el bloque. La auditoría leyó
`m.oyola+clinica-demo@mipiace.es` en «Atiende», en «Firmada por», en
«Valoración pedida por», en el informe que se lleva la paciente, en los
cajeros recientes del PIN y en la barra de abajo del TPV. Y apuntó el porqué:
**«El nombre de la activación no llega a ningún sitio»**.

Eran dos mitades:

1. **El `alias` no se escribía.** El formulario de activación pide
   `ownerName`, lo manda en el email de bienvenida y lo apunta en la
   auditoría — y **no tocaba la fila del usuario**. Ahora va en el mismo
   `create`, recortado, y no en un `update` posterior: el nombre es parte de
   nacer, y un `update` best-effort fuera de la transacción dejaría cuentas
   con nombre y cuentas sin él según si falló. Lo mismo al transferir el
   OWNER, donde además dejar el `alias` de la anterior es peor que no tener
   nombre: el TPV seguiría pintando a quien ya no está.
2. **El respaldo era el email ENTERO.** Había **seis copias** de la misma
   función de tres líneas en `clinica/` —`sesion.ts`, `fotos.ts`,
   `contrato.ts`, `valoracion.ts`, `consentimientos.ts`, `informe.ts`— y las
   seis caían al email completo. El esquema lleva diciendo lo contrario desde
   v1.7 («el email queda como credencial y canal», «la API hace fallback a la
   local-part al mostrar») y `residencia/` lo hacía bien. Seis copias de la
   misma frase mal es lo que pasa cuando la regla vive en un comentario del
   esquema y no en una función: ahora es `lib/nombre-para-mostrar.ts`.

Por qué la local-part y no «—»: porque **hay que poder saber quién firmó**. Un
informe clínico firmado por «—» es un informe sin firmante y la ley pide lo
contrario. Lo que se deja fuera es el dominio, que es la parte que no dice
nada de la persona y sí de la casa.

En el TPV, `cashierDisplayLabel` hace el mismo fallback. Se repite ahí y no se
pide a la API porque **esa etiqueta se pinta sin red**, con lo que hay en la
sesión guardada: una sesión de antes del bloque no trae `alias` y el TPV de la
clínica abre con ella.

### 9.12 · Cerrar la sesión pide confirmación

«Cerrar la sesión es irreversible y se hace con un toque, sin confirmar»
(punto 13 de la auditoría). Y es literal: lo que el POST escribe es una
entrada firmada con el colegiado, cifrada, que clinica-6 no sabe editar — una
corrección se hace añadiendo.

**Lo que se enseña no es un «¿seguro?».** Un «¿seguro?» con un botón al lado
se contesta que sí sin leerlo, y lo que la auditoría pedía al pedir
confirmación no era fricción: era poder ver, antes de firmar, qué queda
escrito. Así que la hoja lleva los DATOS —el tipo de visita, cada zona con su
lesión, el dolor, la evolución, lo que pasa a caja, la próxima cita, la nota—
en el orden en que se han ido tocando, y el botón debajo. Y las dos frases que
la hacen irreversible: queda firmada con tu nombre y tu colegiado, y **ya no
se edita**.

Va **DESPUÉS** de las preguntas de los pendientes y no antes, porque esas
respuestas también se firman: un resumen anterior a las preguntas sería el
resumen de otra cosa.

### 9.13 · La sesión: diabetes, primera visita y el «10»

**a) Con diabetes se RECOMIENDA «Pie de riesgo», no se marca.** Un pie
diabético se explora distinto —monofilamento, pulsos, sensibilidad— y la
tarjeta que hace esas tres preguntas es la de «Pie de riesgo». La
recomendación sale de la MISMA alerta que la franja roja de arriba
(`alertaIds`, de la valoración), no de un cálculo propio: un segundo cálculo
es un segundo sitio desde el que la diabetes se puede decir distinta.

Y **no se marca solo**: el tipo de visita queda ESCRITO en el cuerpo de la
sesión y congela la especialidad con la que se hizo (S5). Marcarlo por el
paciente sería escribir en su historia un tipo de visita que nadie eligió —
exactamente lo que `tiposSugeridos` se negó a hacer en clinica-5 («sugerir
uno por defecto sería escribir el tipo que no se eligió»). Así que se dice,
se dice **por qué**, y se marca de un toque.

**b) En la primera visita no se pregunta «Desde la última visita».** No es
cosmética: las opciones son «mejor / igual / peor» y en una primera visita las
tres son falsas. Contestada, quedaría escrita en el cuerpo y mañana la
historia viva pintaría una evolución respecto de una visita que no existe. El
criterio es el mismo que ya usaba «↺ Igual que la última vez»: `hayAnterior`.
Un solo dato, dos controles, y no pueden contradecirse.

**c) El «10» del dolor, en la misma fila.** Era `flex-wrap` con `min-w-touch`
(48 px) y `gap-1` (4): once teclas necesitan **11×48 + 10×4 = 568 px** de
ancho de contenido para caber en una fila. Esa tarjeta vive en la columna
derecha de la rejilla de dos columnas, que a 1024 mide 424 px menos los 40 de
padding —**384**— y en una sola columna, en la tablet, el contenido ronda los
**536**. En los dos casos entran diez y el «10» se va solo abajo: la tecla del
dolor máximo, aislada, que es la que más se mira.

`flex-wrap` reparte según el ancho, así que dónde se parte la fila depende del
aparato. Una **rejilla de seis columnas** se parte siempre en el mismo sitio
—0-5 arriba, 6-10 abajo— y el «10» va siempre con el 6, el 7, el 8 y el 9.
Cada tecla mide `(ancho − 5×4)/6`: a 384 son 60 px y a 536 son 86, en los dos
casos por encima del peldaño de 48 de la casa. La rejilla deja un hueco al
final de la segunda fila y **se deja a propósito**: es el final de la escala y
se lee como tal. Rellenarlo estirando el «10» a doble ancho le daría un peso
que la escala no tiene.

### 9.14 · El test del paciente en la tablet

Cuatro cosas, y la tercera pesa más que las otras tres.

**a) El botón para devolver la tablet.** El modo paciente no tiene puerta de
vuelta **por diseño**: `main.tsx` monta SÓLO el test, para que detrás del
paciente no esté la sesión de la podóloga, y la vuelta documentada era «se
recarga la raíz y se teclea el PIN». En una tablet no hay barra de
direcciones que recargar. Así que la puerta se pinta, y es exactamente esa:
lleva a la raíz, y la raíz pide el PIN. **No abre nada**: enseña dónde está.
Va abajo, pequeña y en gris —tiene que encontrarla quien la busca, sin
competir con «Sí» y «No» para quien está contestando— y **a medias pregunta**,
porque las respuestas sólo se mandan al final y salir ahí las tira. Terminado
no pregunta: ya está todo guardado.

**b) Los textos, según la especialidad.** «La podóloga» estaba escrito cuatro
veces a pelo. Dos problemas, y los dos se arreglan:

- **la especialidad**: un centro de fisioterapia le decía a su paciente que la
  podóloga iba a revisar sus respuestas. Sale de los tipos de visita que el
  centro ha DECLARADO en su catálogo —la misma tabla que mira el check de
  «Catálogo clínico completo» de la fase A—, pasados por la función pura del
  paquete. No es un ajuste nuevo que alguien tenga que rellenar: el centro ya
  lo dijo al cargar su CSV. Sin nada declarado, la frase se queda sin
  complemento y sigue siendo correcta; inventar «podología» porque es lo que
  hay hoy sería escribirle a la paciente de un fisioterapeuta que su visita es
  de podología;
- **el género**: «la podóloga» da por hecho que quien atiende es una mujer. En
  Rosario lo es; en el siguiente centro, quién sabe. Y esto lo lee la
  paciente, sobre una persona de verdad. Así que la especialidad se nombra
  donde cae natural —«su primera visita **de podología**»— y la profesional
  deja de nombrarse: el sujeto pasa a ser la clínica («necesitamos saber»,
  «lo revisaremos con usted»), que es además quien manda el test.

La lectura de la especialidad va entre `try`: si revienta, **el test se abre
igual** sin nombrarla. Lo que hay al otro lado es una persona de 78 años con
una tablet en la mano, y un 500 por un complemento del sujeto sería la peor
forma de fallar que tiene esa ruta.

**c) Nada resaltado antes de contestar.** El «Sí» llevaba borde coral de
serie. En el mockup eso era «marca de antemano el que tiene consecuencias»;
en la tablet, con una persona de 78 años delante, **lo que marca es la
respuesta que se espera**. Un cuestionario de salud que sugiere una respuesta
la consigue: quien duda toca la que parece la buena. Y de estas diez
preguntas salen las alertas con las que se coge el bisturí. Los dos botones
salen iguales; el coral sigue existiendo, pero sólo DESPUÉS — marca lo
contestado, no lo esperado.

**d) Elegir quién responde avanza solo.** Era la única pantalla del test con
dos toques. Las preguntas avanzan solas al contestar desde clinica-2, y ésta
se había quedado fuera: por eso se notaba —la persona toca, no pasa nada y
espera. El valor se guarda Y se avanza en el mismo gesto, sin leer el estado
(que no ha corrido todavía): la misma trampa que `contestar` documenta en la
sesión.

### 9.15 · El consentimiento, desde la historia y desplazable

**a) Historia → «Fotos» ya ofrece firmarlo.** La pieza `Fotos` traía el botón
desde clinica-4 y se lo pinta a quien le pase `onFirmarConsentimiento`. Desde
la SESIÓN se le pasaba; desde la HISTORIA, no. Así que con la paciente
delante, el consentimiento se podía firmar y el camino era salir, buscar su
cita y entrar por otro sitio. Ahora la historia tiene su pestaña
`consentimientos`, **que no sale en la barra**: se llega desde el botón de
Fotos y se vuelve con «Volver a las fotos». Ponerla arriba sería invitar a
firmar un consentimiento sin haber llegado a necesitarlo. Y se pide **sin
cita**: firmar no depende de una visita abierta, depende de tener a la
paciente delante.

**b) El texto se deja desplazar hasta la firma.** «El texto largo se come el
gesto de desplazar; la firma solo se alcanza arrastrando por los márgenes»
(punto 12). Con `max-h-[260px] overflow-y-auto`, el dedo que baja por encima
del texto mueve el texto DENTRO de su caja y, al llegar abajo, el navegador no
encadena el scroll a la página hasta que se levanta el dedo y se vuelve a
empezar. Para llegar a la caja de firma había que acertar en los 16 px de
margen de la tarjeta.

**Un scroll dentro de otro scroll es un problema de desplazamiento, no de
altura**, y la solución no es un `overscroll-behavior` más fino: es que no
haya dos. El texto entra en el flujo de la página y UN gesto en cualquier
sitio lleva de la primera línea a la firma. Lo que se pierde es que la caja
de firma se vea sin desplazar; lo que se gana es que leer el consentimiento
con el paciente —que es lo que la ley pide que pase ahí— no sea una pelea con
la pantalla.

### 9.16 · Personal: un solo guardado por tarjeta

La tarjeta de una profesional tenía **cuatro** botones de guardar. Lo que eso
cuesta no es estética: se cambia el nombre de la agenda, se marca «Es
sanitario», se marcan los servicios, se pulsa UN botón y los otros dos cambios
se quedan en la pantalla. **La dueña sale creyendo que guardó** — la misma
forma de fallo que la fase A arregló para el aviso, con el botón que no era.

Ahora hay **uno**, al final, y guarda las tres secciones que son un
formulario. Cada sección sigue siendo su componente con su estado —que es lo
correcto: son tres rutas distintas del servidor— y lo que sube es una pareja
`sucio()`/`guardar()` por `useImperativeHandle`. Cuatro decisiones de forma:

- **se guarda EN ORDEN**: el perfil primero, porque darla de alta como
  profesional es lo que hace existir los servicios que van después;
- **lo que no está sucio no se manda**: tres peticiones por cada toque serían
  tres sitios donde fallar sin que nadie haya tocado nada;
- **si una falla, se dice CUÁL** y las siguientes no se mandan: con un «no se
  pudo guardar» a secas, la dueña no sabe si entró el nombre y no el
  colegiado, o al revés. Y lo que falta en la PANTALLA («Falta el nº de
  colegiado…») se dice sin el nombre de la sección delante, porque ya está
  escrito para la persona (`FaltaUnDato`);
- **las dos CREACIONES se quedan aparte**, y es una decisión, no un olvido.
  «Crear turno» no edita la tarjeta: crea una fila en una lista, con su botón
  de borrar al lado. Y «Dar de alta como profesional» CREA una columna en la
  agenda: si el guardado único la creara, marcar «Es sanitario» a la
  propietaria —que es el gesto del punto 5 de la fase A, y es clínico, no de
  agenda— le pondría de paso una columna que nadie pidió. Siguen siendo **un
  guardado y dos creaciones**, que es lo que la auditoría pedía, y no cuatro
  guardados.

Y las otras dos mitades del punto:

- **«Todos los servicios»**, de un toque. En Rosario son 17 casillas y en la
  clínica de una sola profesional las 17 son suyas: el alta costaba 17 toques
  para llegar al estado por defecto de ese centro. Es un **interruptor** y no
  un botón suelto: con todo marcado dice «Ninguno», porque empezar de cero
  para marcar tres cuesta los mismos 17 toques al revés. Y debajo, «N de M
  marcados».
- **«Válido desde» nace con hoy**, en la zona del CENTRO (`Europe/Madrid`) y
  no la del navegador: `validFrom` se compara contra el calendario de la
  agenda, y en un portátil con la zona cambiada «hoy» del navegador puede ser
  otro día. La fase A puso el aviso de que faltaba; esto es que casi nunca
  haga falta.

### 9.17 · La agenda del mostrador

**a) Los servicios, por categoría y uso.** La lista del alta salía en el orden
del catálogo, que en Rosario son **diecisiete líneas seguidas** —«Consulta
diagnóstico, Quiropodia básica, Quiropodia completa, Quiropodia extra,
Quiropodia a domicilio, Cura, Sesión papiloma, Exploración biomecánica,
Revisión biomecánica adultos, Revisión biomecánica niños…»— y con la paciente
al teléfono eso se LEE entero cada vez. Ahora:

- **por categoría**, que es el agrupador del centro desde S5: cinco
  encabezados en vez de diecisiete líneas;
- **y por uso**, que aquí no son ventas: es cuántas veces se ha puesto ese
  servicio EN UNA CITA desde este mostrador. Se cuenta al reservar —no al
  tocar el chip: lo que se quiere contar son las citas que existen, no los
  botones que alguien tocó y deshizo— y se guarda por tenant en
  `localStorage`, igual que el reparto de tonos de categoría y por las mismas
  razones: vale sin red, no cuesta una ruta nueva en el camino del alta, y lo
  que se aprende es el mostrador de verdad y no un ranking de caja que mezcla
  productos.

Dos detalles que hacen el trabajo: el peso de un grupo es la **suma** de sus
usos y no su máximo (tres servicios de cinco se dan más que uno de doce), y
el orden es **estable** —dos servicios sin uso no se reordenan entre sí—
porque lo que se aprende es la posición y una lista que baila no se aprende.
El primer día, con el contador vacío, el orden es categoría alfabética (del
castellano: la «ó» de «órtesis» ordena con la «o») y el del catálogo dentro.

**b) «Buscar hueco» enseña las horas.** Los chips nacen debajo de su botón,
que en una tablet en vertical cae ya al borde de una hoja con scroll propio:
se pulsa, parece que no pasa nada, y se vuelve a pulsar. Ahora la tira se
trae a la vista en cuanto llega (`scrollIntoView({ block: "nearest" })`, que
mueve lo justo) y encima lleva **cuántas son**: «3 huecos · toca una hora»
convierte «no ha pasado nada» en «hay tres, elige», y el encabezado se ve
aunque los chips queden cortados por abajo.

**c) El estetoscopio no se le abre a la clienta.** «Salud de la agenda» enseña
SEIS tarjetas con la **consulta SQL** que produce cada cifra —y está bien que
lo haga, es el ADR-F3 de B-reservas-9—, pero es una herramienta de quien lleva
el centro y de Mi Piace, y vivía en la cabecera de la agenda del mostrador,
donde la cajera lo toca con la clienta delante. Se gatea con lo mismo que
decide quién puede ARREGLAR lo que el panel enseña: si la matriz de servicios
es de sólo lectura para esta sesión, el panel no tiene salida y no se ofrece.
Y con el botón se va el badge: una cifra que no se puede abrir es una alarma
sin puerta. El flag arranca en `null` —«todavía no se sabe»— y ya no en
`true`: la salida equivocada de ese dato es enseñar de más.

**d) Con una sola profesional, la columna se queda con la pantalla.** El ancho
es fijo (176/208 px) porque con cinco peluqueras tienen que caber una al lado
de otra y deslizarse. En una clínica de UNA podóloga —que es Rosario— eso deja
208 px de agenda y el resto de la tablet en blanco. Con una sola columna no
hay nada con lo que repartir: `flex-1`, y el mínimo se queda en el ancho de
siempre para que nada encoja.

**e) Lo tecleado en el buscador pasa al alta de cliente.** Se busca «Rosario
Ja», no sale, se pulsa «Crear» y el formulario está vacío: hay que volver a
escribirlo delante de la paciente. Se reparte por lo que es, no con una
pregunta más: con tres o más dígitos y nada más que dígitos, espacios, `+` o
guiones es un **teléfono**; con arroba no se siembra nada (el alta rápida no
tiene campo de email, vive en la ficha sin prisa, y un email en el nombre
sería peor que un hueco); lo demás es la primera palabra al nombre y el resto
a los apellidos, que es como se busca a la gente en el mostrador.

### 9.18 · El panel

**a) Con la sesión caída, al login.** «No manda al login, pinta un menú
equivocado y "No se ha podido cargar el contrato"» (punto 20). Las tres cosas
eran la misma: al caducar el refresh, lo único que pasaba era `clearTokens()`
y un error propagado a la pantalla. `RootRouter` sí manda al login, pero sólo
decide en `/`; dentro de una pantalla nadie volvía a preguntar. Ahora `api()`
va al login con una navegación dura —no es un componente y no tiene
`navigate`, y con la sesión muerta no hay nada en memoria que valga la pena
conservar: al revés, lo que hay que tirar es precisamente eso—, y es
idempotente para que un 401 del propio login no deje la página recargándose
sola. La consola de super-admin tiene su propio login y no se toca.

Y el «menú equivocado» tenía su propia causa: **las capacidades caían a su
valor POR DEFECTO**, que «asume caja y Holded» porque es el caso de casi
todos y porque un fallo de red no puede dejar el panel sin menú. Con la sesión
caída esas dos peticiones dan 401 las dos, y el resultado era una barra
lateral con «Comanderas» y con las secciones de Holded encima de una clínica
que no tiene ninguna de las dos. **Con 401 se apaga todo**; con un fallo de
red normal, el menú de siempre. La asimetría es a propósito y está escrita.

**b) Fuera «Comanderas» de una clínica.** Repartía las etiquetas del catálogo
entre las impresoras de barra y de cocina, con `capability: "caja"` — y la
«Clínica demo» tiene caja: cobra. Lo que la distingue es el **vertical**. Es
la misma corrección que el addendum 3 de catálogo-local le hizo a «Sync
Holded» («una sección cuyo único botón fuerza una sincronización que no
existe») y por el mismo motivo. El comentario que había decía «en otros
verticales queda visible pero vacío sin perjudicar la operativa»:
**perjudica**, una pantalla vacía que no se entiende es una llamada de
teléfono.

**c) Y el cobro deja de nombrar Holded sin Holded.** El caso sin Holded estaba
resuelto para `PAID` desde N4; lo que se le escapó es la rama de **prueba**, y
es justo la del recorrido: la «Clínica demo» está en ensayo y no tiene Holded,
así que cada cobro de la auditoría acabó diciéndole «No se sube a Holded».

**d) «Ver ticket» ya no se abre en blanco en Android.** No es un fallo del
ticket ni del generador: el modal pinta el PDF con `<embed
type="application/pdf">` sobre un `blob:`, y **el WebView de Android no trae
visor de PDF**. No hay plugin, no hay fallback y no hay error: el `<embed>` se
queda en un rectángulo blanco de 70vh. Lo mismo en Chrome para Android.

Se **pregunta** con `navigator.pdfViewerEnabled`, que está en el estándar HTML
y contesta exactamente esto, en vez de mirar si somos la APK: el mismo bundle
se abre desde un portátil del mostrador, desde un iPad y desde el móvil de la
dueña, y la respuesta es distinta en cada uno por motivos que no son «qué
aparato es». `undefined` se trata como que SÍ: es lo que el TPV hacía hasta
ahora y donde la pantalla funciona, y apagar el visor donde hoy va bien sería
peor que el fallo que se viene a arreglar.

Donde no sabe, se **LEE el mismo `TicketDocument`** en DOM. Importa lo que NO
es: no es otro documento ni otro cálculo. Los importes que salen son los
campos que el renderer del PDF imprime —`totalGross` por línea,
`totals.total` abajo—, no una suma que la pantalla haga: dos sitios sumando
serían dos tickets. Y lo dice: es una lectura, el PDF sigue siendo el
documento, y se abre desde el histórico en un ordenador. Un tramo **exento**
se dice exento y no «IVA 0 %» — no es lo mismo, el papel tampoco lo dice
igual, y en Rosario los 17 servicios son `E1`. Si no se va a poder enseñar, el
PDF **no se genera**: en una tablet de 200 € armarlo cuesta casi un segundo de
CPU para no pintar nada.

**e) Dispositivos con nombre legible.** La lista pintaba `device.name ??
device.userAgent`, y el `name` lo pone quien empareja —casi nadie—, así que lo
que la dueña veía era `Mozilla/5.0 (Linux; Android 14; TB311FU Build/…`. Y lo
tiene que leer para decidir cuál revocar: con dos tablets iguales, imposible.
Ahora sale **«Android 14 · TB311FU · app»**: el modelo, el sistema, y si es
nuestra APK (`; wv`) o el Chrome del aparato — que es la distinción que hace
falta cuando alguien emparejó desde el navegador por error, porque ese
terminal no recibe las actualizaciones de la APK. El user-agent crudo **no se
pierde**: queda en el `title`. Y lo que no reconoce lo dice devolviendo `null`,
para que la lista enseñe lo que ya enseñaba.

### 9.19 · La venta

**a) Iconos de clínica, no tazas.** Las tazas no eran una errata del catálogo:
ninguna categoría de Rosario casa con las palabras de hostelería, así que
todas caían al icono POR TONO, y el tono del primer reparto es ámbar →
`Coffee`. Ahora hay seis iconos clínicos (pie, estetoscopio, jeringa,
apósito, actividad, pulso) con sus palabras, **puestas después de las de
hostelería** para no mover el reparto de los quince comercios de hoy: el icono
de una categoría se aprende y cambiarlo cuesta un segundo por toque durante
días. Y el **respaldo** de una categoría que no casa deja de ser la taza en un
comercio con historia clínica: `iconNameForTag` acepta un icono por defecto
que la pantalla le pasa, porque el módulo es puro y no sabe de qué negocio es
el catálogo que le dan.

**b) Nombres sin cortar lo que los distingue.** El catálogo de Rosario tiene
pares cuya última palabra es lo único que los separa: «Revisión biomecánica
adultos» / «… niños», «Órtesis de silicona pequeña / mediana / grande». A
16,5 px en una tarjeta de ~150 px entran dos palabras por línea, así que con
`line-clamp-2` los dos primeros se leían «Revisión biomecánica…» — el mismo
botón dos veces. Pasan a **tres líneas**, y la tarjeta NO cambia de alto:
`PRODUCT_CARD_MIN_HEIGHT` son 104 px y el reparto que v1.22 §3 dejó escrito
usa 81 (dos líneas de 16,5 con `leading-tight` = 41, el precio 18, los
paddings 22); la tercera línea son ~20 px más, 101 de 104. Lo mismo en la
lista de servicios del alta de la cita, donde era `truncate` y cortaba en seco.

### 9.20 · `/apk` avisa antes de descargar

Quien instala la APK en la clínica es la dueña, sola, con un código de seis
dígitos que le ha dado el implantador por teléfono. Ver «este tipo de archivo
puede dañar tu dispositivo» sin esperarlo es donde se para y llama. El aviso
nombra **los dos** —el de Chrome al descargar, con el botón que hay que tocar,
y el del sistema al instalar— y dice por qué pasa («con cualquier app que no
viene de Google Play»), que es lo que lo convierte en normal. Va ANTES del
botón: leerlo después de pulsar no sirve de nada. En ámbar y no en rojo: no es
un error, es lo que va a pasar.

---

## 10 · Decisiones de la fase B tomadas sin preguntar

1. **Sin zona marcada se dispara igual y la zona se pregunta DESPUÉS**
   (§9.10). La alternativa literal al prompt —«la zona viene puesta»— no
   cubre la primera visita, donde no hay nada marcado. Lo que no se hace es
   guardar sin zona.
2. **La diabetes recomienda, no marca** (§9.13). El tipo de visita queda
   escrito en el cuerpo y congela la especialidad.
3. **Los textos del test dejan de nombrar a la profesional** en vez de
   nombrarla en masculino o femenino según nada (§9.14). La especialidad se
   nombra donde cae natural.
4. **El guardado único de Personal NO da de alta** (§9.16): un guardado y dos
   creaciones.
5. **El «uso» de los servicios se cuenta en el terminal**, no con una ruta
   nueva (§9.17). Vale sin red y lo que aprende es ese mostrador.
6. **El estetoscopio se gatea con `matrizEditable`** y no con el rol
   (§9.17): es quien puede arreglar lo que el panel enseña.
7. **La lectura del ticket en Android es una LECTURA**, no un segundo
   documento (§9.18), y lo dice en pantalla.
8. **Las palabras de clínica van al final de las listas de pistas** (§9.19),
   para no mover el reparto de iconos y tonos de los quince comercios de hoy.
9. **La rejilla del dolor deja un hueco al final** en vez de estirar el «10»
   (§9.13).

---

## 11 · Tabla de sabotajes (fase B)

Cada garantía rota a propósito sobre la línea de producción, con el **fichero
de test entero** (no `-t`), restaurando con `git checkout --` después de cada
una. Los mensajes son los reales, copiados de la salida.

El guion de los sabotajes vive en el scratchpad de la sesión, no en el repo:
`sabotajes.json` + `correr.sh`, uno por número. Y la lección de la casa
—«commitear antes de sabotear»— se pagó otra vez en el #40: el `git checkout
-- .` del guion se llevó un arreglo del banco que no estaba commiteado.

| # | Qué se rompe | Dónde | Fichero | Rojo | Mensaje real |
|---|---|---|---|---|---|
| **Fotos (§9.10)** |
| 1 | la zona vuelve a nacer en `null` | `Fotos.tsx` | `clinica-8b-fotos` | 🔴 3 | `expected 'Nueva foto¿De qué zona es? Elígela y …' to contain 'Zona: Pie izq. · Dedo gordo'` |
| 2 | el disparador vuelve a bloquearse por falta de zona | `Fotos.tsx` | `clinica-8b-fotos` | 🔴 5 | `expected true to be false` |
| 3 | fuera la capa que tapa el póster de «play» | `Fotos.tsx` | `clinica-8b-fotos` | 🔴 1 | `expected null not to be null` |
| 4 | **sin zona se guarda igual, sin preguntar** | `Fotos.tsx` | `clinica-8b-fotos` | 🔴 3 | `expected [ { zona: null, …(1) } ] to deeply equal []` |
| **Nombre, no email (§9.11)** |
| 5 | el respaldo vuelve a ser el email ENTERO | `nombre-para-mostrar.ts` | `clinica-8b-nombre` | 🔴 2 | `expected 'm.oyola+clinica-demo@mipiace.es' to be 'm.oyola+clinica-demo'` |
| 6 | **la activación deja de escribir el `alias`** | `superadmin/tenants.ts` | `h1-activacion-sin-caja` | 🔴 1 | `expected null to be 'Rosa Martín'` |
| 7 | la barra del TPV vuelve al email entero | `storage.ts` | `clinica-8b-puras` | 🔴 1 | `expected 'm.oyola+clinica-demo@mipiace.es' to be 'm.oyola+clinica-demo'` |
| **Cerrar la sesión (§9.12)** |
| 8 | cerrar vuelve a ser UN TOQUE | `SesionPodologia.tsx` | `clinica-sesion-pantalla` | 🔴 5 | `expected [ { …(2) } ] to have a length of +0 but got 1` |
| 9 | la hoja se pinta ANTES de los pendientes | `SesionPodologia.tsx` | `clinica-sesion-pantalla` | 🔴 1 | `expected <div …(5)>…</div> to be null` |
| **La sesión (§9.13)** |
| 10 | la recomendación de pie de riesgo desaparece | `SesionPodologia.tsx` | `clinica-sesion-pantalla` | 🔴 2 | `expected null not to be null` |
| 11 | la primera visita vuelve a preguntar la evolución | `SesionPodologia.tsx` | `clinica-sesion-pantalla` | 🔴 1 | `expected '…' not to contain 'Desde la última visita'` |
| 12 | el dolor vuelve a repartirse por el ancho | `SesionPodologia.tsx` | `clinica-sesion-pantalla` | 🔴 1 | `expected 'flex flex-wrap gap-1' to contain 'grid-cols-6'` |
| **El test en la tablet (§9.14)** |
| 13 | el test vuelve a decir «la podóloga» | `TestPaciente.tsx` | `clinica-8b-tablet` | 🔴 3 | `expected '…' to contain 'su primera visita de podología'` |
| 14 | el «Sí» vuelve a venir resaltado | `TestPaciente.tsx` | `clinica-8b-tablet` | 🔴 1 | `expected 'min-h-tap-valoracion-sm …' to contain 'border-slate-200'` |
| 15 | elegir quién responde vuelve a pedir dos toques | `TestPaciente.tsx` | `clinica-8b-tablet` | 🔴 5 | `expected '…' to contain 'Pregunta 1 de'` |
| 16 | **devolver la tablet a medias ya no pregunta** | `TestPaciente.tsx` | `clinica-8b-tablet` | 🔴 2 | `expected 1 to be +0` |
| 17 | la especialidad deja de viajar con el test | `valoracion-publica.ts` | `clinica-valoracion-rutas` | 🔴 2 | `expected [ 'canal', 'clinica', …(2) ] to deeply equal [ …(3) ]` |
| **El consentimiento (§9.15)** |
| 18 | Historia → Fotos vuelve a no ofrecer firmar | `HistoriaViva.tsx` | `clinica-historia-pantalla` | 🔴 4 | `expected null not to be null` |
| 19 | el texto recupera su scroll propio | `Consentimientos.tsx` | `clinica-4-pantallas` | 🔴 1 | `expected 'mt-3 bg-mipiace-stone …' not to contain 'overflow-y-auto'` |
| **Personal (§9.16)** |
| 20 | se mandan las TRES secciones aunque no se toque nada | `StaffPage.tsx` | `clinica-8b-personal` | 🔴 5 | `expected [ 'PUT /staff/u-rosa', …(2) ] to deeply equal [ 'PUT /staff/u-rosa/skills' ]` |
| 21 | **el guardado único vuelve a DAR DE ALTA de paso** | `StaffPage.tsx` | `clinica-8b-personal` | 🔴 1 | `expected [ 'PUT /staff/u-marta', …(1) ] to deeply equal [ 'PATCH /staff/u-marta/clinica' ]` |
| 22 | «Válido desde» vuelve a nacer vacío | `StaffPage.tsx` | `clinica-8b-personal` | 🔴 1 | `expected '' to be '2026-10-23'` |
| 23 | **la fecha de hoy se toma del NAVEGADOR y no del centro** | `StaffPage.tsx` | `clinica-8b-personal` | 🔴 1 | `expected '2026-10-19' to be '2026-10-20'` |
| **La agenda (§9.17)** |
| 24 | los servicios vuelven a la lista plana | `AgendaPage.tsx` | `clinica-8b-agenda` | 🔴 1 | `expected 'biomecánica' to be 'cirugía'` |
| 25 | el peso de un grupo pasa a ser el MÁXIMO | `servicios-de-la-cita.ts` | `clinica-8b-puras` | 🔴 1 | `expected 'cirugía' to be 'quiropodia'` |
| 26 | las horas del hueco no se traen a la vista | `AgendaPage.tsx` | `clinica-8b-agenda` | 🔴 1 | `expected 0 to be greater than 0` |
| 27 | el estetoscopio vuelve a estar para todos | `AgendaPage.tsx` | `clinica-8b-agenda` | 🔴 1 | `expected <button …(3)>…(1)</button> to be null` |
| 28 | la columna única vuelve al ancho fijo | `AgendaPage.tsx` | `clinica-8b-agenda` | 🔴 1 | `expected 'w-44 md:w-52 shrink-0 …' to contain 'flex-1'` |
| 29 | el buscador deja de sembrar el alta | `useClientPicker.tsx` | `clinica-8b-puras` | 🔴 3 | `expected {} to deeply equal { firstName: 'Rosario', …(1) }` |
| **El panel (§9.18)** |
| 30 | con la sesión caída NO se va al login | `admin/api.ts` | `clinica-8b-panel` | 🔴 1 | `expected [] to deeply equal [ '/login' ]` |
| 31 | **un 401 vuelve a caer al menú POR DEFECTO** | `capabilities.ts` | `clinica-8b-menu` | 🔴 1 | `expected <a …(2)>…(2)</a> to be null` |
| 32 | «Comanderas» vuelve a ser de CAJA | `AdminShell.tsx` | `clinica-8b-menu` | 🔴 3 | `expected <a …(2)>…(2)</a> to be null` |
| 33 | el ticket de prueba vuelve a nombrar Holded | `CheckoutPage.successOverlay.tsx` | `sin-holded-nada-que-sincronizar` | 🔴 1 | `expected '…' to contain 'No se emite nada ni se envía email'` |
| 34 | el PDF se incrusta siempre, también en Android | `pdf-en-pantalla.ts` | `clinica-8b-puras` | 🔴 1 | `expected true to be false` |
| 35 | el dispositivo vuelve a llamarse «Mozilla/5.0…» | `nombre-de-dispositivo.ts` | `clinica-8b-panel` | 🔴 7 | `expected 'Mozilla/5.0 (Linux; Android 14; TB311…' to be 'Android 14 · TB311FU · app'` |
| **La venta (§9.19)** |
| 36 | fuera los iconos de clínica: vuelven las tazas | `categoryTones.ts` | `clinica-8b-venta` | 🔴 2 | `expected 'Coffee' to be 'Footprints'` |
| 37 | **una palabra de dos letras vuelve a casar por subcadena** | `categoryTones.ts` | `clinica-8b-venta` | 🔴 5 | `órtesis: expected 'Coffee' not to be 'Coffee'` |
| 38 | el nombre del producto vuelve a dos líneas | `SalePage.tsx` | `sale-catalog-grid` | 🔴 1 | `expected 'line-clamp-2 …' to contain 'line-clamp-3'` |
| **`/apk` (§9.20)** |
| 39 | fuera el aviso de los dos avisos de Android | `releases/page.ts` | `apk-releases` | 🔴 1 | `expected '…' to contain 'puede dañar tu dispositivo'` |
| 40 | **el aviso se queda en el HTML pero OCULTO** | `releases/page.ts` | `apk-releases` | 🟢 → 🔴 1 | `expected '…' to contain '<p class="aviso">'` |

### Los que enseñaron algo

**#40 · el banco miraba la CADENA, no si se ve.** Con `hidden` en el párrafo,
el aviso sigue en el HTML y `apk-releases` pasaba en verde: estaba
comprobando que la frase existe, no que la dueña la lea. La página no lleva
JavaScript —lo fija el primer test de su describe—, así que lo único que puede
esconder el aviso es su propia etiqueta, y eso es lo que el test mira ahora.
El primer intento de este sabotaje salió verde **por otro motivo todavía
peor**: el razonamiento del aviso estaba escrito dentro del literal del CSS,
que VIAJA AL NAVEGADOR, y contenía la frase. O sea que la página decía
«puede dañar tu dispositivo» incluso cuando el aviso no se pintaba, y el test
lo encontraba ahí. El comentario se sacó del CSS.

**#37 · la pista «te» del té se comía media lista.** `ICON_HINTS` casa por
`includes`, y la palabra «te» (del té) está desde v1.14: «orTEsis» → taza de
café, y «corTEs» de la peluquería también. No lo encontró el sabotaje: lo
encontró el banco nuevo al escribirlo, porque «órtesis» es una de las cinco
categorías de Rosario. Una palabra de dos o tres letras tiene que ser el slug
ENTERO; de cuatro para arriba las palabras de la lista son raíces de verdad y
acertar por subcadena es lo que hace que «panaderia» y «panes» caigan en la
misma.

**#23 · la fecha de «hoy» y la zona del centro.** Sabotear
`Europe/Madrid` → `UTC` pone el test en rojo con `expected '2026-10-19' to be
'2026-10-20'`, que es exactamente el turno creado de madrugada rigiendo desde
ayer. Es la misma familia que la nota de «no correr el e2e de madrugada» de la
fase A, un piso más arriba.

**#4 y #21 · los dos sabotajes que había que saber escribir.** Los dos
rompen una NEGATIVA —«sin zona no se guarda», «el guardado no da de alta»— y
las negativas son las que un test flojo no ve. Los dos salieron en rojo a la
primera, y es porque los bancos miran la petición que sale, no la pantalla:
`subidas` y `escrituras()`.

---

## 12 · Verde (las dos fases)

| Suite | Resultado |
|---|---|
| `npx vitest run` (workspace, desde la raíz) | **444 ficheros · 6.382 tests**, 10 saltados |
| `pnpm test:e2e` (Postgres real, base propia de esta sesión) | ver la nota de abajo |
| `tsc --noEmit` api · `tsc -b` admin · `tsc -b` tpv-web | limpio |

El e2e corrió sobre `mipiacetpv_clinica8_e2eb`, una base propia de esta
sesión: la suite hace `DROP SCHEMA`, así que compartirla con otro worktree es
tirarle la base a la sesión de al lado. Y **no de madrugada**: la primera
pasada de la fase B se lanzó a las 14:31 de Madrid, lejos de la franja mala de
00:00 a N:00 que documenta puesta-en-marcha §8.1.

**Lo que el e2e encontró al mergear master.** Seis tests rojos en
`residencia-5.e2e.ts` y `residencia-6.e2e.ts`, los dos con el mismo
`CONTRATO_ENCARGADO_NO_VIGENTE` → **423**. Es la v2 del contrato de la fase A
funcionando: una aceptación de la versión vieja deja el módulo clínico en
solo lectura. Los dos bancos nacieron en master DESPUÉS de la fase A —
residencia-6 entró con el merge— así que no estaban entre los cuatro que ella
arregló. Siembran `VERSION_VIGENTE` y no un `1` escrito a mano, como los
otros.

### Lo nuevo de la fase B

| Fichero | Qué fija |
|---|---|
| `api/test/clinica-8b-nombre.test.ts` (5) | el nombre con el que se pinta a alguien, y que nunca lleva el dominio dentro |
| `tpv-web/test/clinica-8b-puras.test.ts` (17) | el orden de los servicios y su contador, el reparto del buscador, si el aparato sabe enseñar un PDF, el nombre del cajero |
| `tpv-web/test/clinica-8b-fotos.test.tsx` (11) | la zona de hoy, disparar sin zona, el disparador que no finge y la capa del póster |
| `tpv-web/test/clinica-8b-tablet.test.tsx` (14) | los cuatro del test en la tablet |
| `tpv-web/test/clinica-8b-agenda.test.tsx` (10) | los servicios por categoría, las horas a la vista, el estetoscopio y la columna |
| `tpv-web/test/clinica-8b-venta.test.ts` (6) | los iconos de clínica, y que el reparto de hostelería no se mueve |
| `tpv-web/test/clinica-8b-ticket-android.test.tsx` (6) | la lectura del ticket, con el tramo exento |
| `admin/test/clinica-8b-personal.test.tsx` (13) | un guardado, dos creaciones, «Todos los servicios» y la fecha del centro |
| `admin/test/clinica-8b-panel.test.ts` (10) | el nombre legible de un dispositivo y a dónde va el panel con la sesión caída |
| `admin/test/clinica-8b-menu.test.tsx` (7) | «Comanderas» por vertical, y el 401 que no miente |

Y seis que ya existían, ampliados: `clinica-sesion-pantalla` (la
confirmación del cierre, la diabetes, la primera visita y el dolor),
`clinica-historia-pantalla` (el consentimiento desde Fotos),
`clinica-4-pantallas` (el texto sin scroll propio y la zona que ya viene
puesta), `h1-activacion-sin-caja` (el `alias`), `apk-releases` (el aviso, y
que se vea) y `sin-holded-nada-que-sincronizar` (la rama de prueba).

**Por qué esos seis se amplían en vez de tener su fichero.** Porque necesitan
una vista que ya está montada ahí: las trescientas líneas de `vista()` de la
sesión, o la de la historia. Una segunda copia sería un segundo sitio donde
mantenerla al día, y la primera que se quedara vieja probaría otra pantalla.

---

## 13 · Al desplegar · las dos fases juntas

**Esta es la lista.** El §5 es la de la fase A sola y se queda como
histórico.

### 13.1 · Migraciones y variables

1. **NO HAY MIGRACIÓN DE ESTE BLOQUE.** Ni en la fase A ni en la B: ni una
   tabla, ni una columna, ni un enum. Todo escribe en columnas que ya existen
   (`service_scheduling`, `tag_visit_types`, `users.alias`,
   `clinical_processor_agreements`).
2. **Sí hay migraciones de MASTER**, que entraron con el merge de la fase B
   (residencia-5 y residencia-6): `20261019000000_residencia_5_tipos`,
   `20261019010000_residencia_5_relevo_y_obligaciones` y
   `20261020000000_residencia_6_pin_por_alcance`. No son de este bloque; se
   dicen porque van en el mismo despliegue.
3. **No hay variables de entorno nuevas.** Ninguna, en ninguna de las dos
   fases.

### 13.2 · Lo primero del día: el contrato

**El contrato sube a la v2, y eso deja la clínica EN SOLO LECTURA hasta que
la dueña lo acepte.** No es un aviso: es la garantía de clinica-7 — una
aceptación de una versión vieja no vale, y `conHistoria` contesta **423** a
toda escritura clínica.

O sea que el día del despliegue, hasta que Rosario (o la «Clínica demo»)
acepte el contrato nuevo en **Ajustes › Contrato de tratamiento de datos**,
**no se puede cerrar una sesión ni escribir nada en una historia**. La agenda
y la caja siguen funcionando; lo que además se pierde mientras tanto es la
nota libre de las citas nuevas.

La v1 se sigue pudiendo descargar en PDF: no se quita de `VERSIONES`.

### 13.3 · El catálogo clínico de la «Clínica demo»

**Necesita recargar su CSV** para quedarse con las marcas de clínica (la
especialidad en la categoría, `primeraValoracion`, `tratamientoSesion`, el
nivel de quiropodia) — o ponerlas a mano en Catálogo de agenda.

Y el detalle que decide cómo hacerlo: **un SKU que ya existe no se pisa**, así
que una segunda carga del mismo fichero **no escribe las marcas en los
servicios que ya están**. Hay que ponerlas en el panel, o borrar el catálogo y
volver a cargarlo en una cuenta de ensayo.

Sin esas marcas, el check de onboarding «Catálogo clínico completo» de la fase
A **bloquea la activación** de una clínica nueva, que es para lo que existe.

### 13.4 · APK nueva: SÍ

El front del TPV cambia en las dos fases, y en la B bastante:

- fase A: la agenda de entrada, el detalle de la cita, el diálogo de cancelar,
  la historia a pantalla completa;
- fase B: la cámara (zona de hoy, zona después de la foto, el disparador, la
  capa del póster, la luz), la confirmación del cierre de sesión, la escala de
  dolor, el test del paciente entero, el consentimiento, la agenda del
  mostrador, la lectura del ticket y los iconos de la venta.

### 13.5 · Qué nota el resto de los comercios

**Los catorce sin historia clínica:**

- el TPV abre donde abría (la agenda de entrada se decide con la caché del
  catálogo, default `false`);
- el detalle de la cita es el de ayer;
- el check nuevo sale «No aplica» y no cuesta ni una consulta;
- el CSV de La Maestranza se carga igual (hay test con el fichero real);
- los iconos de su catálogo **no se mueven** (las palabras de clínica van al
  final de las listas de pistas, y hay test de los de hostelería);
- el nombre del producto pasa a tres líneas en la tarjeta, sin cambiar su
  alto.

**Lo que cambia para TODOS, clínica o no:**

- la barra de abajo y los cajeros recientes pintan la **local-part** del email
  cuando no hay `alias`, en vez del email entero;
- en **Dispositivos**, el user-agent crudo deja de ser el nombre (queda en el
  `title`);
- con la **sesión del panel caída** se va al login en vez de quedarse en una
  pantalla con un menú por defecto;
- el ticket **de prueba** de un comercio sin Holded deja de nombrar Holded;
- **«Ver ticket» en Android** enseña la lectura del ticket en vez de un
  rectángulo blanco. Esto lo nota La Maestranza y lo notan los AP11: es el
  arreglo de la fase B que más gente va a ver;
- «Comanderas» **desaparece** del menú de quien no es hostelería. En RETAIL
  (Thalía) también: ahí tampoco había comanda que repartir. Si alguien la
  estaba usando en una tienda, esto se lo quita — es la única retirada del
  bloque y va dicha aquí a propósito;
- `/apk` lleva el aviso de los dos avisos de Android.

**Lo que cambia para quien ya tiene la clínica encendida**, además de todo lo
anterior: el TPV abre en la agenda, «Cobrar en caja» espera a la sesión,
cancelar pregunta, cerrar la sesión pregunta, en Cajeros desaparecen el cajero
técnico y los revocados, y Personal tiene un botón de guardar en vez de
cuatro.

### 13.6 · Orden del despliegue

1. `prisma migrate deploy` (las tres de master, ninguna de este bloque).
2. API y paneles.
3. APK nueva a `/apk`, y el código de instalación al implantador.
4. **La dueña acepta el contrato v2** (§13.2). Hasta aquí, la clínica está en
   solo lectura.
5. La «Clínica demo» recarga su CSV o marca su catálogo a mano (§13.3).

---

## 14 · El merge de master, y qué había que mirar

La fase B empezó mergeando `origin/master` = `480ce9c` en la rama (29 commits,
255 ficheros). **Sin conflictos** — y eso no basta, porque residencias tocó
`App.tsx` y `AgendaPage.tsx`, que son dos de las tres piezas que la fase A
cambió. Un merge automático limpio puede dejar el código semánticamente mal.

Lo que se comprobó, uno a uno:

| Lo de la fase A | Donde está | Cómo quedó |
|---|---|---|
| el TPV de una clínica abre en la AGENDA | `App.tsx` · `showAgenda` nace de `getCachedClinicaEnabled()` | intacto |
| la marca sanitaria del servidor se guarda en la sesión | `App.tsx` · `onMarcaSanitaria` | intacto |
| «Sesión de hoy» es el botón fuerte | `AgendaPage.tsx` | intacto |
| «Cobrar en caja» espera a la sesión cerrada | `AgendaPage.tsx` | intacto |
| cancelar una cita pregunta | `AgendaPage.tsx` · el diálogo | intacto |
| el aviso de «la sesión no tiene nada que cobrar» | `AgendaPage.tsx` · `doCheckout` | intacto |

Y la suite entera + los tres `tsc` en verde ANTES de tocar nada de la fase B:
434 ficheros, 6.257 tests. Lo único que hizo falta después del merge fue
`prisma generate` — el esquema de residencias trae 850 líneas nuevas y el
cliente viejo no las conoce (es la memoria de la casa: «Prisma tras mergear
master»).

---

## 15 · El guion de la pasada en hierro

**Esto NO está hecho.** Hace falta el aparato y la cuenta de producción, y
producción la teclea Matías (y el prompt deja fuera el merge y el despliegue).
Va aquí para poder hacerlo de un tirón, sin pensar.

**Lo que hace falta:** la cuenta **«Clínica demo»** (NIF de Mi Piace, sin
Holded, historia clínica encendida, los 17 servicios de Rosario) y la
**Lenovo Tab M11** (TB311FU, Android 14) con la APK de este bloque instalada
desde `/apk`. El ordenador, por `adb`, para las capturas.

Las capturas van a `docs/qa/2026-10-xx-clinica-8/`, numeradas como en la
auditoría del 18-10 para poder ponerlas al lado.

### 15.0 · Antes de nada (y es lo primero por un motivo)

**1. Aceptar el contrato v2.** En el panel, Ajustes › Contrato de
tratamiento de datos. Hasta que esté aceptado, **toda escritura clínica
contesta 423** y el recorrido se para en el paso 6 sin decir por qué. Lo
encontró este bloque porque cuatro ficheros de e2e se fueron enteros a 423 al
sacar la v2 (y dos más al mergear master en la fase B).

→ captura: el aviso de «hay una versión nueva», y el acuse después de
aceptar.

**2. El catálogo clínico.** Dos caminos, y hay que elegir uno:

- **recargar el CSV** `docs/implantaciones/rosario/catalogo-tpv.csv` en una
  cuenta de ensayo donde el catálogo se pueda borrar antes — porque un SKU que
  ya existe **no se pisa** y una segunda carga no escribiría las marcas;
- o **marcarlo a mano** en Catálogo de agenda: la especialidad en cada
  categoría, los tres niveles de quiropodia, y «Consulta diagnóstico» como
  primera valoración.

→ captura: la vista previa del CSV con la columna «Clínica» y la banda de
tipos de visita; o el panel con las marcas puestas.

**3. Comprobar el check de onboarding** en super-admin: «Catálogo clínico
completo» en verde. Si sale en rojo, el paso 2 no está hecho.

**4. Preparar el aparato.** `adb devices`, pantalla desbloqueada, y la APK de
este bloque instalada (la de `/apk`; si hay una anterior, desinstalar y
volver a instalar para ver de paso el aviso del punto 20).

### 15.1 · El recorrido, en el orden del día de Rosario

Entre paréntesis, el punto del bloque que cada paso prueba.

| # | Qué se hace | Qué hay que ver | Punto |
|---|---|---|---|
| 1 | `/apk` desde la tablet, con el código de 6 dígitos | **el aviso de los dos avisos de Android, antes del botón**; después, los dos avisos de verdad y la instalación | 20 |
| 2 | Vincular con el código del propietario | entra a la primera | — |
| 3 | Entrar al TPV con el PIN | en «Cajeros recientes», **el NOMBRE** (no el email) y el email debajo; en la barra de abajo, el nombre | 11 |
| 4 | — | **el TPV abre en la AGENDA**, no en la venta | A·4 |
| 5 | Mirar la cabecera de la agenda | **NO hay estetoscopio** si se ha entrado como cajera; sí como dueña | 17 |
| 6 | «Nueva cita» → buscar «Rosario Ja» → «Crear cliente» | **el nombre y el apellido ya puestos** en el formulario | 17 |
| 7 | Elegir servicios | **agrupados por categoría**, no 17 líneas seguidas | 17 |
| 8 | «Buscar hueco» | **las horas se ven sin desplazar**, y arriba «N huecos · toca una hora» | 17 |
| 9 | Reservar | la cita en su hueco. Con una sola profesional, **la columna ocupa la pantalla** | 17 |
| 10 | Mandar la valoración a la tablet | el test, a pantalla completa | — |
| 11 | El test, con la tablet en la mano | «Antes de su primera visita **de podología**»; **«Sí» y «No» iguales** antes de contestar; **«¿Quién responde?» avanza solo**; abajo, **«Devolver la tablet al centro»** | 14 |
| 12 | Tocar «Devolver la tablet» a mitad | **pregunta** y dice que el test se queda a medias | 14 |
| 13 | Terminar el test y devolver la tablet | lleva al PIN | 14 |
| 14 | Validar la valoración (sanitaria) | las correcciones con autor, como el 18-10 | — |
| 15 | Abrir «Sesión de hoy» desde la cita | **es el botón fuerte**; «Cobrar en caja» todavía no está | A·4 |
| 16 | Mirar los chips de tipo | con diabetes, **la banda que RECOMIENDA «Pie de riesgo»**, y el botón que lo marca | 13 |
| 17 | Mirar «Atiende» en la cabecera | el **nombre**, no el email | 11 |
| 18 | La escala de dolor | **el «10» en la misma fila que el 6-9** | 13 |
| 19 | Si es la primera visita del paciente | **NO aparece «Desde la última visita»** | 13 |
| 20 | Tocar una zona del pie y marcar la lesión | el mapa, como el 18-10 | — |
| 21 | Pestaña «Fotos» → «Hacer foto» | **la zona YA viene puesta** con la de la sesión, y lo dice | 10 |
| 22 | Mirar el visor mientras arranca | **negro con «Iniciando cámara…»**, sin el triángulo de «play»; el disparador, **aro punteado** y no círculo blanco | 10 |
| 23 | Con el visor ya pintando | el disparador, círculo blanco, se pulsa | 10 |
| 24 | Si la cámara tiene flash | **el botón «Luz»**, y la foto con y sin él | 10 |
| 25 | Hacer una foto de un pie con poca luz | juzgar la exposición con el flash y sin él | 10 |
| 26 | Sin zona marcada, disparar | la foto hecha, **la pregunta «¿De qué zona es esta foto?» con la foto delante**, y «Repetir» | 10 |
| 27 | Cerrar la sesión | **la hoja con el resumen de lo que se va a firmar**: tipo, zonas, dolor, lo que pasa a caja; y «ya no se edita» | 12 |
| 28 | «Seguir en la sesión» y volver a cerrar | no se ha mandado nada, y lo tocado sigue | 12 |
| 29 | «Cerrar y firmar» | la sesión cerrada, firmada, con el **nombre** y el colegiado | 11 |
| 30 | «Cobrar en caja» | el ticket **hecho con lo de la sesión** | A·2 |
| 31 | Cobrar | el acuse. En una cuenta en ensayo y sin Holded: **«No se emite nada ni se envía email»**, sin nombrar Holded | 18 |
| 32 | «Ver ticket» **en la tablet** | **la lectura del ticket**, con las líneas, «Exento (E1)» y el total — no un rectángulo blanco | 18 |
| 33 | Volver a la agenda → segunda cita del mismo paciente | la sesión con «Hoy toca» | — |
| 34 | Historia del paciente (desde la ficha del cliente) | **a pantalla completa** | A·9 |
| 35 | Historia → «Fotos» sin consentimiento firmado | **el botón «Firmar consentimiento de fotos»** | 15 |
| 36 | Firmarlo ahí | el texto; **desplazar con el dedo POR ENCIMA DEL TEXTO** hasta la caja de firma, de un gesto; firmar; vuelve a Fotos | 15 |
| 37 | Informe | el nombre de quien firma, **no el email** | 11 |
| 38 | Venta suelta (desde el menú) | **iconos de clínica, no tazas**; «Revisión biomecánica adultos» y «… niños» **se leen enteros** | 19 |
| 39 | Panel › Personal, ficha de la profesional | **UN botón «Guardar»**; «Todos los servicios»; «+ Añadir turno» con **«Válido desde» puesto a hoy** | 16 |
| 40 | Cambiar el nombre, marcar sanitaria y marcar servicios, y guardar UNA vez | **las tres cosas guardadas**, y «Guardado.» al lado del botón | 16 |
| 41 | Panel › Dispositivos | la tablet como **«Android 14 · TB311FU · app»** | 18 |
| 42 | Panel de una clínica, barra lateral | **NO hay «Comanderas»** | 18 |
| 43 | Dejar el panel abierto hasta que caduque la sesión (o borrar el token) y tocar algo | **va al login**, no a un menú equivocado | 18 |

### 15.2 · Lo que hay que apuntar aunque salga bien

- **La exposición con poca luz** (pasos 24-25). Es lo único del bloque que no
  se puede dar por cerrado sin mirarlo: el frame rate ayuda y el flash
  resuelve, pero si la M11 no expone bien ni con flash, hace falta otra cosa
  (y entonces es un bloque, no un arreglo).
- **Si la pista de la M11 NO tiene `torch`**, el botón «Luz» no sale. Apuntarlo:
  es la diferencia entre «no hay flash en este aparato» y «el botón no
  funciona».
- **Cuántos toques cuesta el día entero**, de la cita al cobro. La auditoría
  del 18-10 no lo contó y es el número que dice si la fase B ha servido.
- **La altura de las citas cortas en la agenda** (§16): no se ha tocado, y hay
  que medir si con la columna ancha ya se tocan bien o si hace falta su
  propio arreglo.

---

## 16 · Lo que la fase B NO cubre

- **La ALTURA de las citas cortas en la agenda.** El punto 29 de la auditoría
  decía «columna estrecha, citas cortas difíciles de tocar» y el prompt pide
  sólo el ancho, que es lo que se ha hecho. La altura es aritmética:
  `PX_PER_MIN` es **1,1**, así que una «Cura» de 15 minutos mide **16,5 px** y
  una «Entrega de órtesis» de 10 mide **11**, los dos muy por debajo del
  peldaño de 48. Subir `PX_PER_MIN` haría el día **el doble de alto en los
  quince comercios**, así que no se toca en un bloque de clínica. Queda
  medido aquí y en el guion de hierro (§15.2) para decidirlo con el aparato
  delante.
- **El PIN personal y cambiable por el usuario**, los roles sin probar
  (sanitaria sin caja, recepcionista) y el importador de COGECOP: fuera del
  bloque por decisión del prompt.
- **El cajero revocado en Dispositivos.** La auditoría (punto 32) dice «el de
  prueba revocado sigue listado»; el prompt pide sólo el nombre legible. Un
  dispositivo revocado sigue en la lista **a propósito**, con su badge
  «revocado» y sin acciones: es el histórico de qué aparato estuvo emparejado.
  Los **cajeros** revocados sí se fueron, en la fase A, porque ahí lo que
  había era un camino para resucitarlos.
- **La pasada en hierro.** El guion es §15; hace falta el aparato y la cuenta
  de producción.
- **El bucle visual.** No lo pide el prompt y no se ha corrido. Las dos
  afirmaciones de layout del bloque —la rejilla del dolor y las tres líneas de
  la tarjeta— están sostenidas por **aritmética escrita** (§9.13c y §9.19b) y
  por test de las clases, no por una captura. El banco visual del TPV existe
  (`apps/tpv-web/visual/`) y añadir estas dos pantallas cuesta minutos si
  Dirección lo quiere antes de la pasada en hierro.

