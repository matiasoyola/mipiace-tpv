# Bloque clinica-3 · done

Rama `clinica-3`, worktree `~/Developer/Claude/Projects/mipiacetpv-clinica-3`, desde
`origin/master` = `4e701c9` (el merge de `clinica-2` en el PR #9, más el mockup y el prompt de
este bloque). Nueve commits, 71 ficheros.

**Este bloque construye lo que pasa en cada visita.** La valoración ya dice quién es el paciente;
esto dice qué tiene en el pie, qué se le hizo, cuánto le duele y cuándo vuelve — y lo convierte en
un cobro sin que nadie vuelva a teclearlo.

La frase que resume lo que tiene que ser verdad al terminar: **la podóloga cierra la sesión con
unos toques y el cobro sale solo con lo que hizo**, firmado y sin poder tocarse.

---

## 1 · El mapa, las listas y las funciones puras

`packages/clinica-sesion` — paquete nuevo, compartido por la API y las pantallas.

Dentro: el mapa de los dos pies (once zonas por pie, con su geometría), las siete lesiones, las
tres gravedades, los cinco consejos, las cuatro próximas citas, las tres evoluciones, los tres
pulsos y los tres tipos de pie. Todo versionado, todo del mockup validado.

### Por qué un paquete NUEVO y no una carpeta del de clinica-2

Porque son **dos relojes distintos**. El cuestionario de la valoración y el mapa del pie cambian
por motivos diferentes y en momentos diferentes, y la versión que una sesión guarda es la del
MAPA, no la del cuestionario. Metidos juntos, sacar una versión 2 del cuestionario habría obligado
a decidir qué pasa con las sesiones que apuntaban a la versión 1 del paquete.

Lo que vive ahí es PURO: ni Prisma, ni Fastify, ni React, ni reloj. Y está ahí por la misma razón
que clinica-2 dio para el suyo: el MISMO cálculo lo necesitan los dos lados. La API decide si una
sesión se puede cerrar y qué pasa a caja; la pantalla pinta el pie de la sesión y el botón
desactivado. Con una copia por lado, la podóloga vería un botón activo que falla.

### La geometría también vive ahí, y no en el `.tsx`

Porque **una zona sin sitio en el pie no es una zona**. Si la lista de ids viviera en el paquete y
las elipses en la pantalla, el día que alguien añada `m4` a la lista tendría una zona que la API
acepta, que entra en la historia y que no se puede tocar en ninguna pantalla: una lesión
registrada en un sitio que no existe. Juntas, añadir una zona es un solo cambio y el typecheck lo
pide completo.

### Las tres funciones que el prompt nombra

- **`igualQueLaUltimaVez` SUMA y nunca borra.** Y en la colisión manda HOY: si la podóloga ya ha
  dicho que el callo del talón es severo, traer «leve» de la visita anterior sería deshacerle el
  trabajo con el botón que existe para ahorrárselo. Es idempotente: pulsarlo dos veces no cambia
  nada ni mueve el orden.
- **La gravedad sin lesión no se guarda.** Ni la gravedad ni la marca: una zona sin lesión no está
  marcada. «Moderada» sin decir moderada DE QUÉ no significa nada, y una gravedad huérfana es un
  dato que el informe PDF no puede escribir en ninguna frase. El motivo del chip desactivado lo
  redacta la función —la misma que usa la pantalla— porque dos sitios que lo redacten acabarían
  discrepando (la lección de `puedeValidarse`).
- **El resumen del pie de la sesión cambia con el rol**, y se nota en la FORMA del resultado y no
  en un 0: sin importes, `total`, `ivaTexto` y los `precio` de las líneas son `null`, y la API los
  serializa quitando las claves.

### Y la regla CONTRARIA, al lado

«La siguiente exploración parte de la última» **no suma**. Una exploración es una foto completa del
pie en un día, y sumarle la de hace un año daría una foto que nunca existió. Las dos reglas están
en el mismo paquete y testeadas la una al lado de la otra a propósito: confundirlas es el error
fácil.

---

## 2 · No hay tabla nueva, y es la decisión de fondo del bloque

La exploración y la sesión son entradas de `clinical_entries` con su `kind` (`FOOT_EXAM` y
`TREATMENT_SESSION`). Nada más.

Por qué:

- **La inmutabilidad, la autoría NOT NULL, el RESTRICT del paciente y el enlace a la cita YA
  ESTÁN** en esa tabla desde clinica-1. Una tabla propia habría tenido que volver a montar las
  cuatro garantías, y la quinta vez que se monta una garantía es la vez en que una sale distinta.
- **Una sesión se escribe UNA VEZ, al cerrar.** No hay estado que avanzar, así que no hace falta la
  pareja «entrada inmutable + tabla de estado» que clinica-2 sí necesitó para la valoración (donde
  el estado va de pendiente a respondida a validada).
- Y lo que la sesión va acumulando ANTES de cerrarse **es memoria de la pantalla**, no media sesión
  clínica. Guardarla obligaría a inventar un mecanismo de mutabilidad para algo que nadie ha
  firmado. Es la misma decisión que clinica-2 tomó con las tres confirmaciones.

Un test lo fija: si alguien añade una tabla en una migración de este bloque, se pone rojo. La
conversación que toca entonces es por qué no bastan los `kind` y los triggers que ya hay.

### Lo ÚNICO que `clinical_entries` no sabía

**Que de una cita sale UNA sola sesión.**

```sql
CREATE UNIQUE INDEX "clinical_entries_una_sesion_por_cita"
    ON "clinical_entries"("appointment_id")
    WHERE "kind" = 'TREATMENT_SESSION' AND "appointment_id" IS NOT NULL;
```

Parcial por las dos mitades, y las dos trabajan: con `kind` la misma cita admite su exploración y
sus anotaciones (un índice total las habría prohibido, y de hecho **Postgres se niega a crearlo**
con una sesión y su anotación dentro); con `appointment_id IS NOT NULL` el índice dice lo que
quiere decir, «una sesión por cita que EXISTE».

De aquí sale, sin un solo `if`, que **cerrar dos veces no crea dos cobros**.

### Por qué no hay CHECK «una sesión tiene cita»

Porque convertiría el `ON DELETE SET NULL` de la cita en un error duro con un mensaje de
constraint, en vez de dejar la sesión huérfana y legible. Lo que la ley protege es que se siga
leyendo. La regla «la sesión se abre desde la cita» vive en la ruta, que es donde nace.

---

## 3 · El cobro: reutilizar el camino de verdad

El prompt pide «reutiliza el camino que ya existe de la cita a la caja: no inventes un segundo
cobro». Reutilizarlo de verdad quiere decir que **cerrar la sesión NO crea el ticket**, y la razón
no es de gusto:

> **El ticket necesita una caja con turno abierto, y el sanitario sin caja no tiene ninguna.**
> `checkoutAppointment` exige `registerId` y un `Shift` abierto (es lo que hace que el cobro impute
> al turno correcto, `shift/impute.ts`). Un `CLINICIAN` entra al TPV **sin abrir turno a propósito**
> desde clinica-1 §7 — pedirle un arqueo de una caja que no toca. Para crear el ticket al cerrar
> habría que inventarle un turno, y un turno inventado es un cobro imputado a un arqueo que nadie
> hizo.

Así que el reparto es:

- **Cerrar** escribe la sesión firmada con sus tratamientos. **Ése ES el cobro pendiente**: desde
  ese instante la cita tiene qué cobrar y la recepción lo ve en su lista.
- **Cobrar** lo hace `POST /agenda/appointments/:id/checkout`, el endpoint de B-reservas-5, sin una
  línea nueva en su contrato. Lo llama la dueña desde «Cobrar ahora» y la recepción desde «Cobrar
  en caja»: **el mismo botón de siempre**.

### Lo único que cambia en ese camino

**De dónde salen las líneas cuando la cita tiene una sesión cerrada**: de los TRATAMIENTOS que la
podóloga marcó, en vez de de los servicios con los que se dio la cita. Ni el ticket, ni el enlace,
ni la idempotencia, ni el `/pay`, ni la imputación al turno cambian.

Y los servicios de la cita no bastan porque la cita se da para «Quiropodia» y lo que se hizo fueron
tres cosas. Cobrar el servicio de la cita sería cobrar la previsión y no el trabajo — que es
exactamente lo que la podóloga hace hoy en papel y de memoria.

**Una cita que no es clínica no nota NADA.** La capability del tenant es lo primero que se mira
(`clinica/lineas-de-la-sesion.ts`), así que los catorce tenants sin clínica no pagan ni una
consulta y recorren el mismo código con la misma lista de líneas que antes. Y la lectura **falla
hacia «no hay sesión»**: con un fallo de base se cobra como antes de este bloque. Es la memoria de
la casa — «cobrar siempre se puede».

### La idempotencia la sostienen DOS capas, y conviene saber cuáles

1. **Una sesión por cita** → el índice parcial. Cerrar dos veces devuelve 200 con la misma sesión
   firmada; un doble toque no es un error.
2. **Un ticket por cita** → `appointments.ticket_id` UNIQUE y el GET-back del borrador de
   B-reservas-5 F5.

Y la carrera de dos toques simultáneos cae en el `catch` del 23505, que **no es defensivo**: es la
otra mitad de la garantía. Los dos pasan la comprobación previa sin ver nada, el índice rechaza al
segundo, y lo correcto para ese segundo no es un error sino la sesión que acaba de escribir el
primero. Es la misma forma que el `ON CONFLICT DO NOTHING` del acceso por cita de clinica-1.

---

## 4 · Los importes, en UN SOLO SITIO

La regla 8, comprobada en la API y no escondida en pantalla.

`clinica/importes.ts` tiene una función, `puedeVerImportes`, y lo que decide es
`esSanitarioSinCaja` — **la misma función que decide quién cobra**. De ahí salen dos cosas que una
función nueva no habría dado: el día que cambie quién cobra cambia también quién ve importes, en un
solo sitio; y la **ventana de transición** queda cubierta gratis (una cajera que pasa a sanitaria
deja de ver importes en el mismo instante en que deja de poder cobrar, no cuando caduque su sesión
del TPV).

### Y se quita la CLAVE, no se pone 0 ni null

Porque **un 0 es un precio**. Con `precio: 0`, cualquier pantalla —la de hoy o la que alguien
escriba en dos bloques— podría pintar «0,00 €» delante de una paciente. Y un `null` invita al
`?? 0`, que es lo mismo con un paso de más. Con la clave fuera no hay nada que pintar.

Es la misma forma que clinica-1 usó con la ficha técnica escondida (`technicalNotesHidden: true` en
vez de un array vacío): **un dato que no está y un dato que vale cero no son lo mismo.**

El guardián vive en `clinica/sesion-view.ts`, un fichero propio, porque un guardián repartido por
tres handlers son tres sitios donde olvidarse. Y el test recorre el JSON entero buscando claves de
dinero **con valor numérico** — la segunda mitad es la que distingue un importe de una bandera
(`verImportes: false` lleva «importes» en el nombre y no es dinero).

### Dos puertas de dinero que la agenda nunca tuvo

`POST /agenda/appointments/:id/checkout` y el nuevo `GET /agenda/cobros-pendientes` son rutas de
AGENDA, así que nunca llevaron el gate de la caja — y un `CLINICIAN` llegaba al checkout y recibía
el ticket con sus precios. Las dos pasan ahora por `ensureNoEsSanitarioSinCaja`, que es **sólo la
mitad del usuario** y no la capability: `CLINICIAN` es un rol que no existía antes de clinica-1, así
que **ningún tenant de hoy cambia de comportamiento, ni uno**.

### La recepción no recibe nada clínico

El tipo con el que se construye su lista (`CobroPendiente`) **no tiene sitio** para llevar marcas,
dolor, evolución, consejos, nota ni alertas. No es que se filtren: es que no caben. Misma forma que
`valoracionesPendientesDe` de clinica-2, que devuelve una lista de ids y nada más — **lo que no
cabe en el tipo no se puede filtrar mal.**

---

## 5 · Las pantallas

Las cuatro piezas nuevas viven en `apps/tpv-web/src/clinica/` y se abren desde la cita de la
agenda como overlay a pantalla completa, el mismo patrón que la valoración de clinica-2: el mockup
es una pantalla entera de iPad apaisado, y meterla en el panel de 320 px del detalle sería meter el
mapa de los dos pies en una columna.

### El mapa

Un SVG con `viewBox`, el contorno del pie y once elipses por pie (el derecho espejado en bloque,
para que las zonas no se puedan desalinear del contorno ni por un píxel).

Son `<ellipse>` y no paths recortados porque **el objetivo táctil tiene que ser MEDIBLE**: un radio
en unidades del viewBox por la escala del SVG es una multiplicación, y eso es lo que permite
afirmar «ninguna zona baja de 48 px» y comprobarlo en la captura.

Y cada zona lleva `role="button"`, `tabIndex` y su nombre completo («Pie izquierdo · Dedo gordo»):
un mapa que sólo funciona con el dedo deja fuera a quien lo necesite, y aquí lo que se marca es una
úlcera.

### La franja roja es la INTENSA

Rojo pleno, icono, «Cuidado» y las alertas en cajas blancas a 16 px, con `role="alert"`. Es la
decisión de producto 7 y el prompt la subraya: *aquí no prima la estética: si es alerta, se ve*.

No es el `red-50` discreto que usa la pantalla de la valoración, y es a propósito: es la misma
información en dos momentos distintos. Allí se está revisando el test; aquí se está a punto de
meter un bisturí en el pie de una persona anticoagulada. (Que las dos no coincidan es una **duda
abierta**, ver §10.)

### El estado vive en memoria hasta que se cierra

No hay «guardar borrador» en el mockup y no hay estado intermedio que signifique nada. Y las listas
—mapa, lesiones, consejos— **vienen del servidor con su versión**, no se importan del paquete para
pintar: son la versión con la que se va a ESCRIBIR, y una pantalla que pintara «la que tiene
compilada» podría ofrecer una zona que el servidor va a tirar.

---

## 6 · La tabla de sabotajes

Cada sabotaje se aplicó de verdad sobre la línea de producción (o sobre el motor) y se corrió la
suite. Los mensajes son los reales.

| Garantía | Qué línea se rompe | Qué se pone rojo | Mensaje real |
| -------- | ------------------ | ---------------- | ------------ |
| **Sin valoración validada no hay sesión** | `if (!puerta.puede)` → `if (false && …)` en `sesion.ts` | `clinica-sesion-rutas.test.ts` · 2 casos | `expected 201 to be 409` |
| **De una cita sale UNA sesión** (el cobro único) | `DROP INDEX clinical_entries_una_sesion_por_cita` | `clinica-sesion.e2e.ts` · 3 casos | `El motor ACEPTÓ lo que no debía: INSERT INTO clinical_entries …` |
| **…y el índice TOTAL es imposible** | (sin sabotaje: Postgres se niega) | `clinica-sesion.e2e.ts` · «el índice TOTAL sería imposible de crear» | `Key (appointment_id)=(…) is duplicated.` |
| **…y el 23505 real, cuando el índice está** | (sin sabotaje) | el mismo fichero · «LA SEGUNDA NO» | `Code: 23505 … Key (appointment_id)=(…) already exists` |
| **Una sesión cerrada no se edita ni se borra** | `ALTER TABLE clinical_entries DISABLE TRIGGER clinical_entries_inmutable` | `clinica-sesion.e2e.ts` · **5 casos** (incluido el de la cita) | `El motor ACEPTÓ lo que no debía: UPDATE clinical_entries SET body = jsonb_set(body, '{dolor}', '0')` |
| **El sanitario sin caja no ve importes** | `return !(await esSanitarioSinCaja(request))` → `return true \|\| …` | `clinica-sesion-rutas.test.ts` · 3 casos | `expected [ '$.tratamientos[0].precio', …(5) ] to deeply equal []` |
| **«Igual que la última vez» SUMA** | `{...anterior.marcas, ...hoy.marcas}` → `{...anterior.marcas}` y `unir(hoy, anterior)` → `unir(anterior, [])` | 3 casos del paquete + 1 de la pantalla | `expected [ 'L:h', 'R:m1' ] to deeply equal [ 'L:h', 'R:m1', 'R:talon' ]` y `expected undefined to deeply equal { lesion: 'callo', gravedad: 'SEVERA' }` |
| **Nada clínico en la caja** | Añadir `nota` y `dolor` a la línea de `cobrosPendientesDe` | `clinica-sesion-rutas.test.ts` · «NI UNA PALABRA de la historia» | `«dolor» no puede estar en la lista de cobros: expected '[{"appointmentId":…' not to contain 'dolor'` |

### Lo que los sabotajes enseñaron, y no sabía antes

**1 · En una tabla inmutable, un `ON DELETE SET NULL` no degrada el dato: IMPIDE EL BORRADO DEL
PADRE.**

`clinical_entries.appointment_id` es `ON DELETE SET NULL` desde clinica-1, con la idea escrita en su
schema de que «si la cita desapareciera, la anotación sigue en la historia y pierde el enlace, no el
contenido». Pero un SET NULL **es un UPDATE sobre la fila**, y esa fila la protege el trigger de
inmutabilidad. Resultado: **una cita con sesión no se puede borrar**, con el mensaje
`HISTORIA_VIOLADA: la historia clínica no se edita`.

Es una garantía más fuerte que la que la columna declara, y no hay hoy ningún camino de aplicación
que borre una cita (igual que no hay ninguno que borre un cliente o un tenant, clinica-1 §9), así
que nadie se encuentra con esto por sorpresa. Una cita SIN sesión se borra como siempre: la negativa
es de la historia, no de la agenda.

Es la misma clase de descubrimiento que clinica-1 anotó con el `ON CONFLICT`: **lo que garantiza el
comportamiento no siempre es la línea que uno escribió pensando que lo garantizaba.**

**2 · El `catch` del 23505 es la mitad de la garantía y no una red de seguridad.** La comprobación
previa («¿ya está cerrada?») es cortesía: evita que un doble toque normal deje un error de índice en
los logs. Lo que de verdad impide la segunda sesión es el índice, y el `catch` es lo que convierte
su negativa en la respuesta correcta.

**3 · Prisma no reenvía el nombre del índice en un 23505 por `$executeRawUnsafe`.** Lo que llega es
la clave que choca — que resulta decir más: «esta cita ya tiene su sesión».

---

## 7 · Lo que encontraron el banco y el bucle visual, y no la suite

Siete cosas. Ninguna la podía ver un test de la suite, que es el mismo argumento que clinica-1 y
clinica-2 dejaron escrito.

### Del bucle visual (píxeles)

**1 · La barra de cobro de la venta se pintaba ENCIMA de la sesión**, a 390 y a 320, tapando justo
el botón de cerrar.

`AgendaPage` es un `fixed inset-0 z-40`, y un z-index sobre un elemento posicionado **crea un
contexto de apilado**: la hoja clínica pedía `z-50` y ese 50 sólo valía dentro del peldaño 40. La
barra inferior de `SalePage` (`lg:hidden`, de v1.0-handheld) está también en `z-40` pero más abajo
en el DOM: empata y gana ella.

**Y no era sólo de este bloque**: la hoja de la valoración de clinica-2 lo tenía desde que nació,
por la misma razón. Se arregla sacando las tres hojas del contexto con un portal a `document.body`
(`AlFrente`), que cambia SÓLO esas tres y no el apilado de una agenda que usan quince clientes.

**2 · A 1024 los dos pies no cabían en una fila.** La rejilla estaba en `xl:` (1280), así que en el
iPad apaisado —que es el que manda— salía en una columna y sólo se veía el pie izquierdo. Pasa a
`lg:` y la columna a 584 px, que es la cuenta de dos pies de 264 con su hueco y el padding.

**3 · A 320 la zona más pequeña se quedaba en 45,1 px.** Pasaba el 44 del prompt y **no** el 48 de
la casa: con 16 de página y 20 de tarjeta a cada lado quedaban 248 para un pie de 264. Con `px-3`
quedan exactamente 264. Lo cazó la MEDICIÓN y no el test del mapa — el test calcula sobre el ancho
nominal, y el ancho nominal estaba bien.

**4 · Las once teclas del dolor medían 30 px de ancho** en el panel estrecho de 1024, menos que en
un móvil de 320. Pasan de `grid-cols-11` a `flex-wrap` con `min-w-touch`.

### Del banco (la cadena)

**5 · Detrás del overlay SIGUE MONTADA la pantalla de venta**, con sus tarjetas de producto y sus
precios. Un `getByText("30,00 €")` casa con el total del pie Y con la tarjeta de «Quiropodia». De
ahí los `data-test` del pie de la sesión, de la pantalla cerrada y del panel de cobros: los ganchos
se ponen donde el banco tiene que mirar. Es la misma lección que el `data-pregunta` del capítulo 11.

**6 · El aserto que esperaba el cobro no esperaba nada.** `getByText(QUIROPODIA.name)` casaba con
esa misma tarjeta, visible desde el primer instante, así que el capítulo salía flojo una vez de cada
tres. Ahora se espera el EFECTO EN LA BASE con `expect.poll`.

**7 · `getByRole("button", { name: "Agenda" })` casa con «Salud de la agenda».** El nombre accesible
se compara por SUBCADENA. En el TPV de una sanitaria sin caja —donde no hay botón «Agenda» porque ya
está en ella— el clic caía en el panel de salud y la hoja abierta interceptaba todo lo demás.

### Y dos de la primera pasada de los tests

**8 · No se puede fingir una valoración validada sin las respuestas del paciente.** El CHECK
`clinical_assessments_respuestas_segun_estado` de clinica-2 exige la entrada de historia, la hora y
quién contestó. Es esa garantía funcionando.

**9 · Una sesión de TPV con un `did` que no existe en `devices` hace fallar la línea del registro de
accesos**, y entonces la petición se corta con un 500 `CLINICAL_ACCESS_LOG_FAILED` — que es
exactamente lo que clinica-1 decidió que pasara.

### Y una del CI, que es la más instructiva

**10 · Un aserto mío no probaba lo que decía probar.**

Para comprobar que la sesión no guarda el precio del tratamiento había escrito:

```ts
expect(JSON.stringify(cuerpo)).not.toContain("30");
```

«30» es el precio de la quiropodia… y también aparece dentro de cualquier uuid que lo lleve. En
local pasó cuatro pasadas seguidas; en el CI falló con un `appointment_id` que empezaba por «30».

**Lo grave no es el fallo rojo: es que el aserto era inútil en las dos direcciones.** Un cuerpo que
SÍ llevara el precio habría pasado igual mientras ningún id contuviera el número, y un cuerpo
correcto fallaba cuando sí. Era un test que se sentía como cobertura y no lo era — **la misma forma
exacta del `toContain` del §10b de clinica-1**, dos bloques después y escrito por mí sabiéndolo.

Ahora se comprueba la FORMA: el juego exacto de claves del cuerpo, y un recorrido recursivo que
busca claves de dinero **con valor numérico**. Las dos mitades hacen trabajo — el nombre de la
clave es lo único que sigue valiendo cuando alguien añade un campo, y el valor numérico es lo que
distingue un importe de una bandera.

La lección, otra vez y ahora con el recibo: **un aserto sobre el texto tiene que contar, no
buscar.**

---

## 8 · Decisiones tomadas sin preguntar

1. **La exploración tiene su propio botón de guardar**, que el mockup no pinta (su pie de página
   sólo existe en la pestaña de sesión). Pero la exploración se guarda APARTE porque se puede
   registrar sin la valoración validada —que es su razón de existir, prompt §2— y una pestaña cuyo
   estado no se puede guardar es una pestaña que miente.
2. **Cerrar la sesión no crea el ticket** (§3). Es la lectura del prompt que de verdad reutiliza el
   camino existente; la literal habría exigido inventarle un turno al sanitario sin caja.
3. **El texto del IVA sale del catálogo y nunca dice «exento»**, al contrario que el mockup. Es la
   única divergencia de CONTENIDO con él, y la pide el propio prompt: el IVA exento en Verifactu
   está fuera de alcance y `registro.ts` sigue declarando `S1`. Escribir «exento» en una pantalla
   cuyo ticket va a declarar otra cosa sería escribirlo en el sitio donde más se cree.
4. **La sesión guarda el NOMBRE de cada tratamiento y nunca su precio.** El precio de hoy es un dato
   de la venta y la venta ya lo congela en `ticket_lines.unit_price`; el nombre es lo que hace
   legible la historia, y el catálogo se renombra sin avisar a nadie. Es la distinción que
   `TicketLine.nameSnapshot` ya hacía.
5. **La firma (autor + colegiado + hora) se congela en el cuerpo**, aunque el autor esté en
   `author_user_id`: el nº de colegiado vive en `users` y cambia. Lo que hay que poder enseñar
   dentro de cinco años es con qué número firmó ESE día.
6. **Las rutas cuelgan de la CITA y no del paciente.** Con la ruta colgada del paciente habría que
   mandar el `appointmentId` en el cuerpo, y nada impediría cerrar la sesión de hoy contra la cita
   de otra persona. Es la misma decisión que las anotaciones de clinica-1.
7. **La lista de cobros pendientes no pasa por `conHistoria`** y no deja línea en el registro: no se
   lee una sola respuesta de salud y la recepción pasa por ahí cincuenta veces al día. Misma
   decisión que clinica-1 con `GET /clients/:id` y clinica-2 con el aviso de la agenda.
8. **Con el módulo clínico apagado, `/agenda/cobros-pendientes` devuelve la lista VACÍA y no una
   404.** No es una ruta clínica: es de caja. La 404 existe para no contarle a un bar que este
   sistema guarda datos de salud; una lista vacía no le cuenta nada.
9. **La gráfica del dolor enseña las últimas seis sesiones.** Un paciente de hace cuatro años con
   ochenta sesiones haría una barra de un píxel por visita, que no es una gráfica: es una textura.
10. **Un tratamiento sin SKU no sale como botón.** El camino de cobro lo exige en la línea
    (`SERVICE_NOT_SELLABLE`), y es mejor que no salga el botón que un 409 con la paciente delante.
11. **Un servicio desactivado no se ofrece, pero una sesión ya firmada se cobra igual.** El cobro lo
    busca por id y sin exigir ni `active` ni la marca: desactivar un servicio no puede dejar una
    sesión firmada sin poder cobrarse.
12. **La marca del catálogo vive al lado de «primera valoración»**, en la misma pantalla y con la
    misma forma: la podóloga mantiene UNA pantalla y no dos.

---

## 9 · Lo que NO cubre este bloque

Declarado en el prompt y respetado: fotos, consentimientos firmados, informe PDF e impresión o
email de la hoja de consejos (`clinica-4`); el IVA exento en Verifactu; editar las listas (zonas,
lesiones, consejos) desde pantalla; arrastrar en el mapa; la app iOS.

**`engine.ts` no se toca.** Una línea de diferencia: cero.

---

## 10 · Dudas abiertas

1. **La franja de alertas es INTENSA en la sesión y DISCRETA en la valoración.** Es la misma
   información sobre el mismo paciente con dos pesos visuales distintos. Aquí está así porque el
   prompt lo pide («si es alerta, se ve») y la de clinica-2 está así porque su mockup lo pedía.
   Antes de la implantación conviene que Dirección decida si la de la valoración sube también — es
   un cambio de una línea, pero toca un mockup validado.
2. **`ticket_lines` no tiene columna de orden**, ni para una cita, ni para una mesa, ni para una
   venta rápida. El orden en que la podóloga marcó los tratamientos **no se guarda** en el ticket.
   No es de este bloque y no se arregla aquí; se nota ahora porque es la primera vez que ese orden
   significa algo para alguien.
3. **La próxima cita queda como propuesta y nadie la reclama.** Si la recepción no la mira al
   cobrar, se queda escrita en la sesión y ya está. Un aviso en la agenda sería el siguiente paso,
   y no está pedido.
4. **No hay forma de anotar una sesión cerrada desde esta pantalla.** La anotación existe desde
   clinica-1 (`POST /clinica/entries/:entryId/addenda`) y la pantalla de «Sesión cerrada» dice que
   se puede, pero no ofrece el botón. Es un hueco pequeño y declarado.
5. **El `body` sigue en claro en la base** (duda 4 de clinica-1 y duda 6 de clinica-2, sin cambios).
6. **La valoración validada sigue sin caducar** (duda 1 de clinica-2). La puerta de este bloque
   hereda esa decisión tal cual.
7. **Dos sanitarios con alcance `ALL`** hacen que el acceso por paciente no se use (duda 6 de
   clinica-1). En el banco de este bloque las dos lo tienen, que es lo razonable en una clínica de
   dos personas.

---

## 11 · Cómo se cierra

### Migración · HAY MIGRACIÓN, y son dos

- `20261007000000_clinica_3_tipos` — los dos valores del enum (`FOOT_EXAM`, `TREATMENT_SESSION`) y
  `service_scheduling.tratamiento_sesion`.
- `20261007010000_clinica_3_sesion` — el índice único parcial de «una sesión por cita» y el índice
  de «la última de este kind».

**Por qué son dos:** la tercera vez, y la misma razón. Postgres prohíbe USAR un valor de enum en la
misma transacción en que se añade, y el `WHERE` del índice nombra `'TREATMENT_SESSION'`. Juntas, la
migración aborta con «unsafe use of new value of enum type». Un test lo fija.

**Las dos son ADITIVAS**: ni un DROP, ni un TRUNCATE, ni un DELETE, ni un UPDATE. La columna nueva
nace con `DEFAULT false` y desde PG 11 eso no reescribe la tabla. Y **este bloque no crea ninguna
tabla**: un test lo fija también.

El **`down`** está escrito en la cabecera de cada una. La de la sesión es reversible del todo (son
dos índices); la de los tipos no, porque un valor de enum no se quita en Postgres — y con sesiones
dentro ese `down` ES el borrado de historia clínica que la migración existe para impedir.

**Aplicadas en una COPIA** de la base de desarrollo con filas reales (`mipiacetpv_clinica3_copia`,
creada con `CREATE DATABASE … TEMPLATE mipiacetpv`). Y sobre ella se comprobaron **a mano las nueve
garantías del motor** antes de escribir una línea de API. De paso volvió a salir la precondición
pendiente de `verifactu_1_registro` (dos TERMINAL activos en la misma caja) que clinica-1 y
clinica-2 ya documentaron: **no es de este bloque** y se resolvió en la copia, como el propio
mensaje de la migración indica.

### Despliegue

1. `prisma migrate deploy` (lo hace el arranque de la imagen).
2. **Ningún tenant cambia de comportamiento**: la columna nueva nace en `false`, así que ningún
   servicio es un tratamiento de sesión y ninguna cita cambia de cobro.
3. Para que una clínica lo use: marcar sus tratamientos con **«Es un tratamiento de la sesión»** en
   Catálogo de agenda (sólo aparece con la historia clínica encendida). El precio y el IVA de cada
   uno son los que van a pasar a caja.
4. **Ninguna variable de entorno nueva.** Ni `Caddyfile`.
5. **Sí hay `COPY` nuevo en `infra/Dockerfile`**: nace el paquete `clinica-sesion`. Lo cantó
   `infra/test/dockerfile-manifiestos.test.ts` en la primera pasada de la suite. **Tres de tres.**

### Verde

- `pnpm test` · **293 ficheros, 3427 tests, 3 skipped.** Verde.
- `pnpm test:e2e` · **28 ficheros, 472 tests.** Verde, sobre `mipiacetpv_clinica3_e2e`.
- `pnpm e2e:agenda` · **40 passed**, sobre `mipiacetpv_clinica3_banco_e2e` y Redis propio (6396),
  incluidos los diez capítulos de la peluquería **sin tocar una línea de sus specs**. Dos pasadas
  seguidas en verde.
- `tsc` de API (con sus tests y su e2e), tpv-web, admin y e2e-ui · limpio.

### Lo nuevo de este bloque

- `packages/clinica-sesion/test/sesion.test.ts` (37) · el mapa, la gravedad, «igual que la última
  vez» y el resumen por rol.
- `packages/clinica-sesion/test/exploracion.test.ts` (14) · «la siguiente parte de la última», y que
  NO suma.
- `clinica-sesion-migracion.test.ts` (20) · el contrato del SQL, y que no nace ninguna tabla.
- `clinica-sesion-rutas.test.ts` (54) · la puerta, el cobro único, los precios por rol, la lista de
  la recepción y el registro de accesos.
- `clinica-sesion.e2e.ts` (23) · el índice y los triggers, contra Postgres.
- `clinica-sesion-cobro.e2e.ts` (12) · el cobro de verdad: lo que se hizo y no lo que se reservó.
- `clinica-sesion-pantalla.test.tsx` (25) · la pantalla montada, con las 22 zonas medidas.
- `specs/12-clinica-sesion.spec.ts` (6) · el viaje entero por las pantallas de verdad.

### Capturas

`docs/qa/2026-10-07-clinica-3/`, con su `README.md`: la sesión vacía, con la gravedad desactivada y
con marcas; la exploración; «Sesión cerrada» en sus dos variantes de rol; la sesión sin importes; y
la lista de cobros de la recepción. A **1024 apaisado, 390 y 320**.

Y `medidas-del-mapa.json` con **los 22 objetivos táctiles medidos sobre la página**: 48,4 px en los
tres anchos, 48,0 en el peor caso. El prompt pide ≥ 44; el mínimo de la casa es 48.

---

## 12 · Commits

```
41a97ee feat(clinica-3): el mapa del pie y las listas de la sesión, versionados
c71c683 feat(clinica-3): los kind de la exploración y la sesión, y «una sesión por cita»
3be7170 feat(clinica-3): la sesión en la API, la puerta, los importes por rol y el cobro
5939e43 test(clinica-3): la puerta, el cobro único, los precios ocultos y los sabotajes
22ed7f1 feat(clinica-3): la sesión, el mapa del pie y los cobros pendientes en pantalla
ccde34b test(clinica-3): el capítulo 12 del banco, y el viaje entero por la interfaz
ab33a4f docs(clinica-3): el bucle visual contra el mockup, y cuatro fallos de píxeles
49167a8 docs(clinica-3): el done del bloque
3035698 fix(clinica-3): el aserto del precio buscaba texto en vez de contar
<este>  docs(clinica-3): el hallazgo del CI y el resultado de la CI
```

## 13 · La rama

**Pusheada**, y el PR contra `master` es el
[**#11**](https://github.com/matiasoyola/mipiace-tpv/pull/11).

**`master` no se movió** mientras el bloque estaba en vuelo: `origin/master` seguía en `4e701c9`
al pushear, que es la base. Sin merge y sin conflictos.

**CI verde** sobre `3035698`, los tres jobs:
[run 37525491001](https://github.com/matiasoyola/mipiace-tpv/actions/runs/37525491001) —
`ci: pass` (4m0s), `smoke: pass`, `e2e: pass` (1m19s). `publish` se salta, como toca fuera de
master.

La primera pasada ([run 37524246051](https://github.com/matiasoyola/mipiace-tpv/actions/runs/37524246051))
salió con el `e2e` en rojo, y el fallo era **mío y de un aserto**, no del código: ver §7.10. El
arreglo es `3035698`.

**Ni merge ni despliegue: eso lo hace Dirección.** Y al desplegar no hay nada que acordarse de
poner en el `.env`: este bloque no añade ninguna variable.
