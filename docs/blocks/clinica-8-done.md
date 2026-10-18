# Bloque clinica-8 · el día de Rosario funciona — FASE A

Rama `clinica-8-el-dia-de-rosario`, worktree
`~/Developer/Claude/Projects/mipiacetpv-clinica-8`, desde `origin/master` = `d77a4ef`
(la auditoría en hierro del 18-10 y el prompt del bloque).

**Este `-done` es PARCIAL: cubre la fase A entera y nada de la B.** El prompt
pide parar al terminarla para que Dirección la revise antes de seguir.

La frase que tiene que ser verdad al terminar la fase A: **la primera consulta
de Rosario se puede dar, firmar y cobrar sin que nadie de Mi Piace toque
nada** — y las nueve cosas que lo impedían el 18-10 están cerradas.

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

## 8 · Estado de la rama

- Fase A completa, con la suite y el e2e en verde y la tabla de sabotajes
  ejecutada (§3).
- **Fase B sin empezar**, como pide el prompt.
- Push y PR: autorizados por el prompt. Ni merge ni despliegue.
