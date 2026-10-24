# Bloque clinica-9 · lo que la pasada en hierro encontró antes de Rosario

Rama `clinica-9-antes-de-rosario`, desde `origin/master` (clinica-8 desplegado,
`091b67d`, APK 1.28.0). Frente C. Prompt:
`docs/code-prompts/bloque-clinica-9-antes-de-rosario.md`.

Punto de partida: `docs/qa/2026-10-24-clinica-8/PASADA.md`, el día de una
consulta recorrido entero con la Lenovo TB311FU en la cuenta «Clínica demo».
Seis bloqueantes y nueve importantes, y **los quince están hechos**.

---

## 0 · Lo primero, porque cambia cómo se lee el resto

**La sospecha del prompt sobre el bloqueante 1 era falsa, y en una dirección
que importa.**

El prompt decía: «un tipo de visita **sin servicio en su categoría** se
descarta al cerrar, y con él su tarjeta», y pedía verificarlo en el dato.
Verificado: **el servidor nunca ha descartado un tipo marcado.**
`normalizarSesionV2` escribe los tipos que llegan, cobren o no, y la regla 11
de clinica-5 se cumplía. Lo que se perdía se perdía **antes del POST, en la
pantalla**, y por un camino que no tiene nada que ver con el catálogo:

> Para hacer una foto hay que firmar el consentimiento de fotos. Firmarlo
> llama a `onFirmado`, `onFirmado` llama a `cargar()` — y `cargar()` volvía a
> **sembrar** los tipos de visita con los de los servicios de la cita. En la
> «Clínica demo» eso es sólo «General». Lo que la sanitaria había marcado
> —«Pie de riesgo» y sus cuatro comprobaciones— desaparecía sin decir nada,
> porque los bloques se derivan de `tipos`.

Encaja con las capturas hasta el último detalle: en la 25 están los dos chips
marcados; en la 32, la hoja de firmar dice «Tipo de visita: **General**»; y
**todo lo demás sobrevivió** (la lesión del pie, el dolor 3, los consejos, el
pendiente «Control de pie de riesgo»), porque `cargar()` sólo pisaba `tipos` y
`exploracion`. Entre una captura y otra está la 30: las fotos.

Qué cambia esto:

- el arreglo es de UNA línea de pantalla, no del cierre ni del catálogo;
- la garantía que el prompt quería («un tipo marcado se guarda siempre, cobre
  o no») **era verdad y no tenía sabotaje propio**. Ahora lo tiene (sabotaje 1):
  una regla sin sabotaje es una frase;
- y la **consulta de producción** que el prompt pide no puede existir tal cual.
  Ver §5.

---

## 1 · Los seis bloqueantes

### 1 · La exploración de pie de riesgo ya no se pierde

**Qué pasaba.** Lo de §0.

**Qué se ha hecho.** `SesionPodologia.cargar` siembra los tipos **la primera
vez y sólo esa** (`sembrado`, un `useRef`). Una recarga refresca lo que es del
servidor —la puerta de la valoración, los consentimientos, la última
exploración— y **no toca nada de lo que hay a medio escribir**. Es la regla que
el resto del estado de esa pantalla ya cumplía: las marcas, el dolor y los
consejos sobrevivían a la recarga; los tipos, no.

La exploración (`setExploracion`) entra en la misma regla y por lo mismo: con
media exploración tecleada, una recarga se la llevaba igual.

**Y la garantía del servidor, con sabotaje.** `packages/clinica-sesion`, cuatro
tests nuevos con el catálogo de la «Clínica demo» (una consulta `GENERAL` y
**ni un servicio de pie de riesgo**): el tipo queda escrito, su bloque entero
también, el riesgo sale congelado en «muy bajo», a caja va sólo lo del tipo que
cobra, y la lectura de la historia devuelve los dos.

**Bancos.** `apps/tpv-web/test/clinica-9-sesion.test.tsx` (recarga mediante un
consentimiento firmado), `packages/clinica-sesion/test/sesion-v2.test.ts`.

---

### 2 · La primera consulta se cobra

**Qué pasaba.** `docs/implantaciones/rosario/catalogo-tpv.csv` traía
`POD-001 · Consulta diagnóstico` con `primera_valoracion=si` y
**`tratamiento_sesion=no`**. Las dos columnas parecen la misma pregunta y no lo
son: la primera dice con qué servicio se **cita** la primera visita; la segunda,
qué botones salen **dentro** de la sesión. Con la segunda en «no», la consulta
no salía en «Qué se cobra», la sesión cerraba sin una sola línea, y la primera
visita de la paciente se firmó **a 0,00 €** sin que nada lo dijera. Y le pasa a
la primera visita de **cada** paciente nuevo.

**Qué se ha hecho.**

1. **El fichero**, con las dos marcas: `… GENERAL,si,si,`.
2. **El README** de Rosario, con una sección que explica la diferencia entre
   las dos columnas y qué hacer si el CSV ya se cargó mal (un SKU que existe no
   se pisa: se marca a mano en Catálogo de agenda).
3. **El check de onboarding** «Catálogo clínico completo» lo exige. Las dos
   preguntas van por separado para poder decir cuál falta: «ningún servicio es
   la primera valoración» y «la primera valoración no es tratamiento de sesión
   (no se podría cobrar la primera visita)» se arreglan en columnas distintas
   del fichero.

**Bancos.** `clinica-8-catalogo-clinico` (dos tests nuevos),
`clinica-8-csv-clinico` y `catalogo-servicios-csv-import` (los tratamientos de
sesión del fichero de Rosario pasan de 16 a **17**).

---

### 3 · El buscador encuentra a la paciente que ya existe

**Qué pasaba.** En «Nueva cita» se teclea «Carmen Prueba» y sale **«Sin
coincidencias»** existiendo «Carmen Prueba Demo, 600000001» (capturas 05 y 40).
La recepción hace lo único que la pantalla ofrece, «+ Nuevo cliente», y la
clínica se queda con **dos fichas de la misma persona** — o sea, dos historias
clínicas con media visita cada una.

El fallo era de una línea: lo tecleado se comparaba **entero** contra **cada
campo por separado**. «Carmen Prueba» no está dentro de `firstName` («Carmen»)
ni dentro de `lastName` («Prueba Demo»). Por lo mismo, «Prueba Carmen» tampoco,
y «Jose» no encontraba a «José».

**Qué se ha hecho.**

- `clienteCasaCon` · **cada palabra** de lo tecleado tiene que aparecer en
  alguna parte de la ficha (nombre + apellidos + teléfono + email), sin tildes
  y sin mayúsculas. Por palabras y no por la cadena entera porque así da igual
  el orden y da igual dónde esté el corte entre nombre y apellidos, que es lo
  que nadie sabe al teclear. Y el teléfono se compara **sólo con sus dígitos**:
  la ficha dice «600 000 001» y el mostrador teclea «600000001».
- `clientesParecidosA` + el aviso en el alta · antes de crear otra ficha, la
  pantalla enseña a quién se parece y deja elegirla de un toque: **«¿Es Carmen
  Prueba Demo, 600000001?»**. Parecido = mismo teléfono (≥ 6 dígitos), mismo
  email, o mismo nombre de pila y primer apellido. Se pregunta con lo que hay
  TECLEADO EN EL FORMULARIO, no con lo que se buscó: entre una cosa y la otra la
  recepción ha podido escribir el apellido entero.
- **No bloquea**: dos pacientes pueden llamarse igual. Lo que hace es que crear
  la segunda ficha sea una decisión y no un descuido.

El mismo criterio lo usan la lista y el aviso (`clienteCasaCon` es uno): con dos
criterios, el buscador podría no encontrar a quien el aviso sí considera
parecido.

**Banco.** `apps/tpv-web/test/clinica-9-buscador-de-pacientes.test.ts`, 14
tests con el fichero de la «Clínica demo».

---

### 4 · La sesión se firma el día de la cita

**Qué pasaba.** Desde la agenda del sábado 24 se abrió la cita del **lunes 26**
y la pantalla dijo «Cita de hoy · 10:00»; al cerrarla, la sesión quedó firmada
el sábado (capturas 22 y 33). Una historia clínica en la que la fecha de la
visita no es el día en que se hizo no es un detalle de pantalla: es el dato del
que cuelga todo lo demás.

**Qué se ha hecho.**

- **El servidor corta, y lo primero.** `cerrarSesion` contesta `409
  FUERA_DEL_DIA` **antes de leer nada** —antes que la valoración y que los
  consentimientos—, con el día de la cita escrito: «Esta cita es del lunes, 26
  de octubre. La sesión se abre el día de la cita.» Va primero a propósito: las
  dos puertas de arriba dicen «falta un trámite», y ésta dice «hoy no es el
  día»; mandar a firmar un consentimiento para una cita de la semana que viene
  sería mandar a hacer algo que todavía no toca.
- **Leer se puede siempre.** El corte está en cerrar, no en la vista: una cita
  pasada sigue siendo el sitio desde el que se revisa lo que se escribió ese
  día (clinica-2), y la sesión ya cerrada se abre cualquier día.
- **La agenda lo dice.** Fuera del día, el botón es **«Ver la sesión»** —no
  «Sesión de hoy», porque no lo es— y debajo, una línea: «La sesión se abre el
  día de la cita.» Y la cabecera de la sesión dice «Cita del 26 oct» en vez de
  «Cita de hoy».
- **La vista trae el motivo** (`dia: { delaCita, esHoy, sePuedeCerrar, mensaje }`)
  para que la pantalla no ofrezca un botón que la API va a rechazar. Lo decide
  la MISMA función que rechaza el cierre.

**Decisión tomada sin preguntar: la medianoche no cierra una consulta.** Una
visita de las 21:30 que se alarga se firma a las 00:10, y a esa hora la
sanitaria tiene la sesión **a medio escribir en la pantalla** (no hay borrador:
el estado vive en memoria hasta que se firma). Negarle el cierre ahí no protege
ninguna fecha: tira el trabajo de la visita. Así que se puede firmar el día de
la cita **y la madrugada siguiente hasta las 6**
(`HORA_LIMITE_DEL_DIA_SIGUIENTE`). Lo que la regla impide sigue impedido igual:
la cita del lunes no se firma el sábado, ni la del sábado el lunes. La fecha de
la VISITA sigue siendo la de la cita y la de la FIRMA es la de verdad, las
00:10; las dos son ciertas.

El día es el de **pared del centro** (`utcToWallDate`), no el UTC: una cita de
las 00:30 de Madrid es del 26 aunque en UTC sea del 25.

**Bancos.** `apps/api/test/clinica-9-dia-de-la-cita.test.ts` (el prisma de ese
fichero revienta a la primera consulta: que el corte no lance es la prueba de
que va antes de leer nada), `clinica-sesion-rutas` (cinco tests de ruta) y
`clinica-8-agenda` (el botón).

**Lo que esto obligó a tocar en el banco de siempre.**
`clinica-sesion-rutas.test.ts` cierra sesiones de citas del 7 de octubre de
2026: con el reloj de verdad, todas contestaban `FUERA_DEL_DIA`. Ese fichero
ahora finge `Date` (sólo `Date`: tiene rutas con `await` y un `setTimeout`
fingido las dejaría colgadas). Antes de este bloque la fecha de esas citas no
significaba nada; por eso daba igual.

---

### 5 · Un solo nombre, y que llegue a la dueña

**Qué pasaba.** `m.oyola+clinica-demo` escrito en seis superficies: cajeros
recientes del PIN, «Atiende», «Firmada por», «corregido por», la hoja de cierre
y la aceptación del contrato.

Y no es que no hubiera nombre: estaba en Personal, «Nombre en la agenda» =
**Rosario**. Lo que pasa es que hay **dos columnas** con el nombre de la misma
persona —`users.alias` (lo que pinta todo) y `staff_profiles.display_name` (lo
que la dueña teclea)— y **ningún puente**: el alias se pone desde Cajeros, y la
propietaria **no sale en Cajeros** (esa lista es de `MANAGER`/`CASHIER`/
`CLINICIAN`). La dueña de una clínica no tenía ninguna pantalla desde la que
ponerse el nombre, y el suyo era el único que no se podía arreglar.

**Qué se ha hecho.** `apps/api/src/lib/un-solo-nombre.ts`: las dos columnas se
escriben juntas **desde las dos pantallas**. Guardar el nombre en Personal lo
escribe también como `alias`; renombrar en Cajeros lo escribe también como
«Nombre en la agenda» **de quien ya tenga perfil** (un cajero de barra no se
convierte en profesional de la agenda por renombrarse).

**No se fusionan las columnas.** Sería una migración de quince bases para
ahorrar una escritura, y las dos tienen sentido por separado: hay usuarios sin
perfil de agenda y puede haber recursos de agenda que no son usuarios.

**La colisión se comprueba con la misma pregunta que Cajeros** y se rechaza con
409 en vez de guardar a medias: dos personas con el mismo nombre en el TPV es la
recepcionista eligiendo a ciegas en la pantalla del PIN.

**Para las cuentas que ya existen no hace falta migración ni script**: el primer
guardado de Personal lo arregla, que es exactamente el gesto que la dueña ya
hace cuando ve su email en una pantalla. La activación ya escribía el `alias`
desde clinica-8 (fase B), así que una cuenta nueva nace con nombre.

**Bancos.** `staff-route` (tres tests nuevos: se escriben las dos columnas,
renombrar vuelve a escribir las dos, y dos personas con el mismo nombre dan
409), `clinica-9-un-solo-nombre` (el puente, con fake; y **el inventario de las
seis superficies**, cada una con el fichero y la línea que produce el nombre),
`clinica-8-cajeros` (renombrar escribe también el de la agenda).

---

### 6 · «Paciente (por enlace)» no es personal

**Qué pasaba.** `clinica/actor-paciente.ts` dice desde clinica-2: «No sale en
`GET /cashiers`, ni en `GET /staff`, ni entre los candidatos a PIN de encargado,
ni cuenta para la colisión de alias. Esas cuatro listas filtran por
`isSystemActor: false`.»

**No lo filtraba ninguna.** La pasada lo encontró en Cajeros con sus botones de
Editar, Cambiar PIN y Revocar, y en Personal. Sin agujero —el CHECK
`users_system_actor_no_credentials` prohíbe que esa fila tenga `pin_hash`, así
que «Cambiar PIN» reventaba contra la base— pero con un **500 de «error
inesperado»** donde tenía que haber un 404, y una fila de sistema ofrecida como
si fuera una persona a la que gestionar.

**Qué se ha hecho.** El filtro, en las cuatro y en una más:

| Dónde | Qué |
|---|---|
| `cashiers/routes.ts` · `PERSONAL_DE_LA_CAJA` | las CUATRO rutas: listar, renombrar, cambiar el PIN y revocar |
| `cashiers/routes.ts` · `findAliasCollision` | su nombre no bloquea el de una persona |
| `staff/routes.ts` · `GET /staff` | fuera de Personal |
| `tables/routes.ts` y `shift/routes.ts` | los candidatos a PIN de encargado |
| `lib/un-solo-nombre.ts` · `otroConEseNombre` | la colisión de la pantalla de Personal |

En los dos del PIN de encargado el CHECK ya lo dejaba fuera (`pinHash: { not:
null }` sobre una fila que no puede tener `pin_hash`) y **el filtro va igual**:
la garantía no puede depender de que nadie relaje el CHECK.

Cambiarle el PIN da ahora **404 limpio** (`CASHIER_NOT_FOUND`).

**Y el comentario del fichero dice la verdad**: lleva una sección nueva que
empieza por «esto era mentira hasta este bloque» y enumera dónde está cada
filtro. Un comentario que describe un filtro que no existe es peor que no tener
comentario: el siguiente bloque lo lee y lo da por hecho.

**Bancos.** `clinica-8-cajeros` (cinco tests), `staff-route` (uno). Los dos
fakes de prisma miran `isSystemActor`: uno que lo ignorara saldría verde con el
filtro quitado.

---

## 2 · Los nueve importantes

| # | Qué | Dónde |
|---|---|---|
| 7 | **La valoración de quien no tiene email.** Decía «el enlace que se le mandó vale hasta el 22 de noviembre» (no se le mandó nada: no hay a dónde) y pintaba **«ALERTAS · 10 respuestas sin resolver» en rojo** sobre un test que nadie había abierto. Ahora: la vista trae `paciente.tieneEmail` (el booleano, **nunca la dirección**), la pantalla dice que no tiene email y manda a la tablet, **no ofrece el botón de mandar** —ese camino sólo puede fallar— y la franja, antes de contestar, dice «Sin alertas todavía: el test está sin contestar». | `clinica/valoracion.ts`, `ValoracionSanitario.tsx` |
| 8 | **«Devolver la tablet al centro»**, de enlace subrayado en gris claro al pie a **botón de 72 px**. Quien tiene la tablet en la mano es la paciente; devolverla es la segunda acción de esa pantalla, no una nota al pie. Sigue siendo la secundaria (blanca con borde), porque la primera es contestar. | `TestPaciente.tsx` |
| 9 | **La próxima cita propuesta.** La pantalla de cierre le promete a la sanitaria que «la recepción elige el hueco con el paciente al cobrar», y no se lo decía nadie: la propuesta se quedaba dentro de la historia clínica, el único sitio donde la recepción no mira. Ahora sale en la **agenda del día** —de quién, cuántas semanas y nada de salud— y «Dársela ahora» lleva la agenda **al día propuesto** (que es el punto de partida de «Buscar hueco») con la hoja de «Nueva cita» abierta y la paciente puesta. **Se apaga sola** en cuanto esa persona tiene una cita por delante: un recordatorio que hay que apagar a mano acaba encendido para siempre. | `clinica/proxima-cita.ts`, `agenda/routes.ts`, `AgendaPage.tsx` |
| 10 | **Fuera la nota interna.** «Pendiente de validar con Rosario» viajaba dentro de `FUENTE_DEL_RIESGO` y salía impresa en la tarjeta de pie de riesgo **y en el informe de la paciente**. Dos cosas mal a la vez: una nota del equipo en una pantalla de producto, y **el nombre de un cliente en un texto de la aplicación**. La nota sigue, donde tiene que estar: en el comentario del fichero. | `clinica-sesion/src/riesgo.ts` |
| 11 | **La hoja de firmar**, con todos los tipos marcados (eso lo arregla el punto 1: antes llegaba uno porque el otro ya se había perdido) **y la gravedad de cada lesión**. La hoja es lo último que se lee antes de firmar algo que ya no se edita, y «callo» y «callo moderado» no son la misma anotación. | `SesionPodologia.tsx` |
| 12 | **La agenda vuelve al día en el que estaba.** El camino de la tablet es una navegación de verdad (`location.replace`) y se lleva por delante todo el estado de React. El día se apunta en `sessionStorage` con un **sello de carga**: el recuerdo sólo vale si lo escribió una carga ANTERIOR, o sea si por medio hubo una recarga. Abrir y cerrar la agenda dentro de la misma pantalla sigue abriendo en HOY, como siempre. Caduca a los diez minutos y **nunca restaura un día del pasado**. | `lib/dia-de-la-agenda.ts`, `AgendaPage.tsx` |
| 13 | **Los servicios de «Nueva cita»** dejan de vivir en una caja de `max-h-52` con **scroll propio dentro de un panel que ya scrollea**: dos scrolls anidados, y el de dentro sólo se mueve si el dedo cae justo encima. La lista ocupa lo que ocupe. El orden por categoría y por uso ya era de clinica-8 (fase B, 17): con el contador vacío —un terminal recién puesto— cae a alfabético, que es lo que la pasada vio. | `AgendaPage.tsx` |
| 14 | **Poca luz.** La M11 **no tiene flash** (`android.flash.info.available = FALSE`), así que «Luz» no sale y eso está bien. Lo que faltaba era decirlo: un vistazo cada segundo y medio al frame reducido a 32×24, luminancia media (Rec. 601) y, por debajo de 55, **«Poca luz · acerca la lámpara»** encima del visor. Con histéresis (no se apaga hasta 75) para que el cartel no parpadee mientras se encuadra. **No bloquea el disparo**: una foto oscura de algo que ya no se va a poder repetir es mejor que ninguna. Y **falla hacia callarse**: lo que no se puede medir no se avisa. | `clinica/Fotos.tsx` |
| 15 | Cuatro menores: **el ticket** lleva el nombre del negocio cuando el de la tienda es el que **inventó el sistema** («Tienda principal», que es lo que `test-cashier.ts` le pone a la tienda que crea él solo) o el mismo del negocio — y el nombre que alguien SÍ escribió sigue mandando, que es para lo que está; **Catálogo de agenda** no habla de Holded en cuentas sin Holded; **«Atendido por»** del cobro viene puesto con la profesional de la cita (semilla, no valor controlado: se puede cambiar); **«Igual que la última vez»** no se pinta en la primera visita — era un botón grande, coral y apagado en lo alto de la pantalla más llena, y no se puede ni entender. | `ticket-model/src/build.ts`, `AgendaCatalogPage.tsx`, `CheckoutPage.tsx`, `SesionPodologia.tsx` |

---

## 3 · Decisiones tomadas sin preguntar

1. **La sesión se puede firmar hasta las 6 de la mañana siguiente.** El prompt
   dice «la sesión sólo se abre el día de la cita». Estricto del todo, una
   visita de las 21:30 firmada a las 00:10 se queda sin poder cerrarse **con la
   sesión a medio escribir en la pantalla y sin borrador que la salve**. Seis
   horas no llegan nunca al día siguiente de trabajo y no abren ninguna
   escapatoria. Está declarado en `HORA_LIMITE_DEL_DIA_SIGUIENTE` y tiene su
   test.
2. **Leer una sesión de otro día se puede siempre.** El corte está en cerrar.
   Lo contrario rompería lo que clinica-2 dejó escrito: una cita pasada es el
   sitio desde el que se revisa lo que se escribió ese día.
3. **El nombre duplicado se RECHAZA con 409 también desde Personal**, en vez de
   guardar el perfil y no el alias. Guardar a medias dejaría las dos columnas
   diciendo cosas distintas, que es el fallo que este punto viene a cerrar.
4. **El alias no se migra.** Ninguna cuenta existente se toca con un script: el
   primer guardado de Personal lo arregla. Un `UPDATE` masivo de nombres
   visibles sobre quince bases, para ahorrar un gesto que la dueña ya quiere
   hacer, no se paga.
5. **El aviso de la próxima cita es de CAJA.** Sale con el mismo criterio que el
   resto de lo de caja de la agenda (`puedeCobrar`), y sólo sobre citas **ya
   cobradas**: una sin cobrar ya tiene su propio aviso, y dos avisos sobre la
   misma tarjeta se leen como uno solo.
6. **El recuerdo del día de la agenda sólo se usa tras una recarga de verdad**
   (sello de carga). Sin eso, abrir y cerrar la agenda devolvería al día de
   antes, que es un cambio de comportamiento para los quince comercios y que
   nadie ha pedido. Lo encontró el banco de `agenda-mostrador`, que se puso rojo
   con la primera versión.
7. **El rótulo del ticket no cuenta tiendas.** Contar cuántas hay sería una
   consulta más en cada ticket que se imprime, y además no es la pregunta. La
   pregunta es si ese rótulo lo escribió alguien o lo inventamos nosotros, y eso
   se contesta con el nombre.
8. **El aviso de poca luz no bloquea ni corrige la foto.** Ni impedir el
   disparo (la paciente ya no está mañana) ni aclarar el JPEG, que sería
   inventar píxeles en una imagen clínica.
9. **La categoría «ordenada por uso» no se ha tocado.** Ya lo estaba desde
   clinica-8 (fase B, 17); lo que la pasada vio fue el orden alfabético de
   respaldo, que es el de un terminal con el contador a cero. Converge en una
   mañana. Lo que sí se ha arreglado es la caja de cuatro líneas.

---

## 4 · Tabla de sabotajes

Cada garantía rota a propósito sobre la línea de producción, con el **fichero
de test entero** (no `-t`), restaurando después de cada una. Los mensajes son
los reales, copiados de la salida.

| # | Qué se rompe | Dónde | Fichero | Rojo | Mensaje real |
|---|---|---|---|---|---|
| **1 · la exploración no se pierde** |
| 1 | `normalizarSesionV2` descarta los tipos sin servicio | `clinica-sesion/src/sesion-v2.ts` | `sesion-v2` | 🔴 5 | `Cannot read properties of undefined (reading 'riesgo')` (el bloque entero desaparece) |
| 2 | **la recarga vuelve a sembrar los tipos** | `SesionPodologia.tsx` | `clinica-9-sesion` | 🔴 4 | `expected 'false' to be 'true'` · `… to contain 'Riesgo muy bajo'` |
| **2 · la primera consulta se cobra** |
| 3 | el check no mira si la primera valoración se cobra en la sesión | `onboarding-health.ts` | `clinica-8-catalogo-clinico` | 🔴 1 | `expected true to be false` |
| 4 | el CSV vuelve a dejar la consulta fuera de la sesión | `rosario/catalogo-tpv.csv` | `clinica-8-csv-clinico` + `catalogo-servicios-csv-import` | 🔴 2 | `expected [ { linea: 3, …(4) }, …(15) ] to have a length of 17 but got 16` |
| **3 · el buscador encuentra a la paciente** |
| 5 | el buscador vuelve a comparar lo tecleado ENTERO contra cada campo | `lib/clients.ts` | `clinica-9-buscador-de-pacientes` | 🔴 2 | `expected [] to deeply equal [ 'Carmen Prueba Demo' ]` |
| 6 | el alta deja de avisar de las fichas parecidas | `lib/clients.ts` | `clinica-9-buscador-de-pacientes` | 🔴 3 | `expected [] to deeply equal [ 'Carmen Prueba Demo' ]` |
| **4 · la sesión se firma el día de la cita** |
| 7 | **`cerrarSesion` deja de mirar el día** | `clinica/sesion.ts` | `clinica-9-dia-de-la-cita` + `clinica-sesion-rutas` | 🔴 4 | `no se puede leer nada: la cita no es de hoy` (el prisma prohibido: se intentó leer) |
| 8 | la vista deja de traer el día | `clinica/sesion-view.ts` | `clinica-sesion-rutas` | 🔴 2 | `expected undefined to match object { delaCita: '2026-09-21', …(2) }` |
| 9 | la agenda vuelve a llamar «Sesión de hoy» a la cita de otro día | `AgendaPage.tsx` | `clinica-8-agenda` | 🔴 1 | `expected <button …(2)>…(1)</button> to be null` |
| **5 · un solo nombre** |
| 10 | **guardar en Personal deja de escribir el alias** | `staff/routes.ts` | `staff-route` | 🔴 3 | `expected 'Jefa' to be 'Rosario'` |
| **6 · el actor de sistema** |
| 11 | el actor de sistema vuelve a ser personal de la caja | `cashiers/routes.ts` | `clinica-8-cajeros` | 🔴 4 | `expected [ …(2) ] to deeply equal [ Array(1) ]` · `expected 200 to be 404` |
| 12 | el actor de sistema vuelve a salir en Personal | `staff/routes.ts` | `staff-route` | 🔴 1 | `… not to contain 'Paciente (por enlace)'` |
| 13 | su nombre vuelve a bloquear el de una persona | `cashiers/routes.ts` | `clinica-8-cajeros` | 🔴 1 | `expected 409 to be 200` |
| **Los importantes** |
| 14 | la nota interna vuelve a la cita de la guía (10) | `clinica-sesion/src/riesgo.ts` | `riesgo` + `clinica-sesion-pantalla` | 🔴 2 | `expected 'IWGDF Guidelines 2023 · prevención de…' not to match /pendiente de validar/i` |
| 15 | la franja vuelve a pintar «N respuestas sin resolver» antes de contestar (7) | `ValoracionSanitario.tsx` | `clinica-9-valoracion` | 🔴 2 | `… not to contain 'respuestas sin resolver'` |
| 16 | la pantalla vuelve a decir que se le mandó el enlace a quien no tiene email (7) | `ValoracionSanitario.tsx` | `clinica-9-valoracion` | 🔴 3 | `… not to contain 'El enlace que se le mandó'` |
| 17 | la próxima cita propuesta deja de ofrecerse (9) | `AgendaPage.tsx` | `clinica-8-agenda` | 🔴 2 | `expected null not to be null` · `no hay botón de dar la próxima cita` |
| 18 | **el día recordado se restaura también sin recarga** (12) | `lib/dia-de-la-agenda.ts` | `clinica-9-puras` + `agenda-mostrador` | 🔴 3 | `expected '2026-10-26' to be '2026-10-24'` · `… to contain 'Reservar y cobrar'` |
| 19 | el aviso de poca luz pierde la histéresis (14) | `clinica/Fotos.tsx` | `clinica-9-puras` | 🔴 1 | `expected false to be true` |
| 20 | el ticket vuelve a rotularse con el nombre que inventó el sistema (15) | `ticket-model/src/build.ts` | `clinica-9-puras` | 🔴 1 | `expected 'Tienda principal' to be 'Clínica demo'` |
| 21 | «Igual que la última vez» vuelve a pintarse apagado (15) | `SesionPodologia.tsx` | `clinica-sesion-pantalla` | 🔴 1 | `expected <button type="button" …(1)></button> to be undefined` |
| 22 | la hoja de firmar pierde la gravedad (11) | `SesionPodologia.tsx` | `clinica-9-sesion` | 🔴 1 | `… to contain 'Callo (heloma) (moderada)'` |

El sabotaje 18 merece una nota: puso rojo **`agenda-mostrador`**, que no es de
este bloque. Fue él quien enseñó que la primera versión del recuerdo del día
cambiaba el comportamiento de la agenda fuera de la vuelta de la tablet (ver
decisión 6).

---

## 5 · La consulta de producción que el prompt pide, y por qué no puede ser SQL

El prompt pide «una consulta de producción que detecte sesiones cerradas a las
que les falte un tipo marcado, **si el dato lo permite**». El dato no lo
permite, por dos razones, y las dos hay que decirlas:

**1. El cuerpo de una sesión está CIFRADO.** Desde clinica-7, una entrada nueva
nace con `body = {"cifrado": true}` y el dato real en `body_cifrado`, con AAD
por tenant y por fila. **No hay SQL que lea `tipos`** — ni `jsonb_array_length`,
ni `->>`, nada. Cualquier medida pasa por descifrar con la clave del tenant, o
sea por un script que corra con la API.

**2. Y aunque se descifrara, la pérdida no deja rastro.** El tipo y su bloque se
iban JUNTOS y antes del POST (§0): lo que llegó al servidor era una sesión de un
solo tipo, perfectamente coherente. No hay hueco que encontrar.

Lo que sí se puede medir, y es lo que hay que correr si alguien quiere saber el
alcance:

**(a) Acotar el universo, esto sí en SQL.** Cuántas sesiones v2 se han cerrado
desde que clinica-8 está en producción, por tenant clínico:

```sql
-- Sólo CUÁNTAS y de quién. Nada del cuerpo: no se puede leer desde SQL.
SELECT e.tenant_id,
       count(*) AS sesiones_cerradas,
       min(e.created_at) AS primera,
       max(e.created_at) AS ultima
  FROM clinical_entries e
  JOIN tenants t ON t.id = e.tenant_id
 WHERE e.kind = 'TREATMENT_SESSION'
   AND t.clinical_records_enabled = true
   AND e.created_at >= timestamptz '2026-10-01'   -- poner la del despliegue de clinica-8
 GROUP BY e.tenant_id
 ORDER BY sesiones_cerradas DESC;
```

Hoy eso es la «Clínica demo» y poco más: Rosario todavía no ha cargado nada, que
es justo el motivo de este bloque.

**(b) Los dos rastros que un script SÍ puede buscar**, descifrando cada cuerpo
con `cuerpoDeEntrada` (el mismo camino que `clinica/exportacion.ts`) y sin
escribir nada:

| Rastro | Qué significa | Fiabilidad |
|---|---|---|
| `bloques` tiene una clave que **no está** en `tipos` | una pérdida PARCIAL: se fue el tipo y quedó el bloque | **directo**, pero no es el caso del 24-10 (se fueron los dos) |
| `pendientesCreados` incluye `control_riesgo` y `tipos` **no** incluye `PIE_RIESGO` | la sanitaria dejó apuntado «Control de pie de riesgo» para la próxima visita en una sesión que, según el cuerpo, no fue de pie de riesgo | **heurística**, y es la que habría pescado el caso del 24-10 (captura 31) |

Y una tercera lectura, de mostrador y sin script: en la «Clínica demo» las
sesiones cerradas se cuentan con los dedos —la consulta (a) dice cuántas— y se
repasan **a mano** al preparar la pasada de §6, abriendo la historia de cada
paciente. Es lo único que de verdad contesta la pregunta hoy.

**Lo que NO se hace**: reescribir ninguna sesión. Una entrada clínica es
inmutable por trigger desde clinica-1, y una corrección se añade, no se edita.
Si al repasar apareciera una sesión a la que le falta lo que se exploró, lo
correcto es una **anotación** en esa historia diciendo qué se hizo y por qué
faltaba — con la fecha de hoy, que es cuando se supo.

---

## 6 · El guion de la pasada en hierro

**Esto NO está hecho.** Hace falta el aparato y la cuenta de producción, y
producción la teclea Matías (y el prompt deja fuera el merge y el despliegue).
Va aquí para poder hacerlo de un tirón.

**Lo que hace falta:** la cuenta **«Clínica demo»** y la **Lenovo TB311FU** con
la APK de este bloque. El ordenador por `adb` para las capturas, que van a
`docs/qa/2026-10-xx-clinica-9/`, numeradas como las del 24-10 para poder
ponerlas al lado.

### 6.0 · Antes de nada

1. **Dejar la «Clínica demo» como está en §7** (la ficha duplicada de Carmen y
   la marca de la consulta). Son dos gestos y los dos hay que hacerlos **antes**
   para que la pasada mida el código y no el estado heredado.
2. **El check de onboarding** en super-admin: «Catálogo clínico completo» en
   verde. Si sale en rojo diciendo «la primera valoración no es tratamiento de
   sesión», el gesto 2 de §7 no está hecho — y eso es el punto 2 funcionando.
3. **`adb devices`**, pantalla desbloqueada, APK de este bloque instalada.
4. **No de madrugada.** Hay pasos que dependen del día de pared (4 y 12) y los
   de más abajo cruzan el cambio de día.

### 6.1 · El recorrido

Repite los pasos 1-34 de `PASADA.md` del 24-10 y añade los que quedaron sin
hacer. Entre paréntesis, el punto que cada paso prueba.

| # | Qué se hace | Qué hay que ver | Punto |
|---|---|---|---|
| 1 | Entrar al TPV con el PIN | en «Cajeros recientes», **«Rosario»** y el email debajo; **NO** sale «Paciente (por enlace)» | 5, 6 |
| 2 | — | el TPV abre en la agenda | — |
| 3 | «Nueva cita» → teclear **«Carmen Prueba»** | **sale «Carmen Prueba Demo»** · ya no «Sin coincidencias» | **3** |
| 4 | Teclear «Prueba Carmen», y «600000001» | sale la misma | 3 |
| 5 | «+ Nuevo cliente» con nombre «Carmen» y apellido «Prueba» | **«¿Es Carmen Prueba Demo, 600000001?»** antes de crear nada, y tocarlo elige esa ficha | **3** |
| 6 | Elegir servicios | la lista **ocupa el alto, sin su propia barra de scroll**; se recorre con el panel | 13 |
| 7 | «Buscar hueco» y reservar para **PASADO MAÑANA** | la cita en su hueco | — |
| 8 | Volver a HOY y abrir esa cita (desde su día) | — | — |
| 9 | Abrir el detalle de la cita de **pasado mañana** | el botón dice **«Ver la sesión»**, no «Sesión de hoy», y debajo **«La sesión se abre el día de la cita.»** | **4** |
| 10 | Entrar igual y pulsar cerrar | **409 con «Esta cita es del …»**; la cabecera dice «Cita del …», no «Cita de hoy» | **4** |
| 11 | Dar otra cita a Carmen **para HOY** | — | — |
| 12 | Abrir la valoración de una paciente **sin email en su ficha** | **no dice «el enlace que se le mandó»**; dice que no tiene email, ofrece **sólo** la tablet, y la franja dice «Sin alertas todavía» en gris | **7** |
| 13 | «Test en la tablet», con la tablet en la mano | **«Devolver la tablet al centro» es un botón grande**, no un enlace | 8 |
| 14 | Devolver la tablet | **la agenda vuelve al día en el que estaba**, no a «Hoy» | **12** |
| 15 | Validar la valoración | «corregido por» con **el nombre**, no el email | 5 |
| 16 | Abrir «Sesión de hoy» de la cita de hoy | «Atiende: **Rosario**»; en la primera visita, **NO sale «Igual que la última vez»** | 5, 15 |
| 17 | Marcar «Pie de riesgo» desde la banda de la diabetes y contestar las cuatro | «Riesgo muy bajo» | — |
| 18 | Marcar una zona con lesión **y gravedad** | la lista lo dice | — |
| 19 | **Pestaña Fotos → firmar el consentimiento de fotos** | se firma y vuelve | — |
| 20 | **Volver a «Sesión de hoy»** | **los DOS chips siguen marcados** y las cuatro comprobaciones del pie siguen puestas | **1** |
| 21 | Hacer una foto con la lámpara apartada | **«Poca luz · acerca la lámpara»** encima del visor; acercar la lámpara y ver que **se va** | 14 |
| 22 | — | **NO hay botón «Luz»** (la M11 no tiene flash): está bien | 14 |
| 23 | Mirar la tarjeta de pie de riesgo | la cita de la IWGDF **sin «pendiente de validar con Rosario»** | 10 |
| 24 | Marcar «Próxima cita: 4 semanas» y cerrar | **la hoja dice los DOS tipos y la gravedad de la lesión** | **1**, 11 |
| 25 | «Cerrar y firmar» | firmada por **Rosario** (y su colegiado); la sesión cerrada **dice los dos tipos** | 5, 1 |
| 26 | «Cobrar en caja» | el ticket con **«Consulta diagnóstico · 20,00 €»** — **no a 0 €** | **2** |
| 27 | Mirar «Atendido por» en el cobro | **ya viene puesto** con la profesional de la cita | 15 |
| 28 | Cobrar y volver a la agenda | **la banda «… se va sin la próxima cita · la sanitaria propuso 4 semanas» con «Dársela ahora»** | **9** |
| 29 | «Dársela ahora» | la agenda salta al día propuesto con la ficha puesta y «Buscar hueco» a mano | 9 |
| 30 | Reservar esa cita y volver | **la banda desaparece** | 9 |
| 31 | «Ver ticket» en la tablet | arriba, **«Clínica demo»** y no «Tienda principal» | 15 |
| 32 | Informe (37 del guion anterior) | el nombre de quien firma, no el email | 5 |
| 33 | Venta suelta a fondo (38) | iconos de clínica; los nombres largos se leen enteros | — |
| 34 | Panel › Personal (39-40) | **NO sale «Paciente (por enlace)»**; cambiar el nombre y guardar | **6**, 5 |
| 35 | Volver al TPV y mirar «Cajeros recientes» | **el nombre nuevo**, sin re-entrar en el panel | **5** |
| 36 | Panel › Cajeros | **NO sale «Paciente (por enlace)»** con sus tres botones | **6** |
| 37 | Panel › Catálogo de agenda | **no se nombra Holded** en ningún sitio | 15 |
| 38 | Panel › Dispositivos (41) | la tablet como «Android 14 · TB311FU · app» | — |
| 39 | Panel de la clínica, barra lateral (42) | NO hay «Comanderas» | — |
| 40 | Dejar caducar la sesión del panel y tocar algo (43) | va al login | — |

### 6.2 · Lo que hay que apuntar aunque salga bien

- **El paso 20 es el bloqueante 1**, y es el único que no se puede dar por
  cerrado sin verlo en el aparato: el banco lo fija con un consentimiento
  fingido, y lo que la pasada mide es el camino de verdad.
- **El paso 21** (poca luz) está medido con un umbral elegido a ojo sobre una
  cuenta de luminancia. Si en la consulta de verdad el aviso sale con el flexo
  puesto, o no sale con la persiana bajada, **el número es `LUZ_BAJA` y se
  ajusta ahí**, en un sitio.
- **Cuántos toques cuesta el día entero**, otra vez. Es el número que dice si
  clinica-8 y clinica-9 han servido.
- **La altura de las citas cortas** (`PX_PER_MIN`): sigue sin tocarse, y se
  decide con Rosario delante.

---

## 7 · Al desplegar

**Migraciones: NINGUNA.** El bloque no toca el esquema. No hay `prisma migrate`
que correr y no hay ventana de despliegue que coordinar: la API nueva funciona
con la base de hoy y la de hoy con la API nueva.

**APK: SÍ, hace falta una nueva.** Casi todo lo de pantalla está en el TPV (los
puntos 1, 3, 4, 7, 8, 11, 12, 13, 14, 15). Una tablet con la 1.28.0 contra la
API nueva **no se rompe** —todo lo que la API añade es opcional (`dia`,
`proximasCitas`, `paciente.tieneEmail`) y el front viejo lo ignora— pero no
arregla nada de lo suyo. Lo que SÍ cambia sin tocar la tablet: el 409 del día de
la cita, el nombre, el actor de sistema y el check del catálogo.

**Orden: API primero, APK después.** Al revés, la APK nueva contra la API vieja
pinta la agenda sin la banda de próxima cita y la sesión sin el bloque `dia`
—los dos opcionales— y se comporta como antes. Ninguna de las dos mitades rompe
a la otra; es el orden de siempre.

**Qué hay que retocar a mano en la «Clínica demo»**, y esto es importante
porque la cuenta arrastra el estado del 24-10:

1. **La ficha duplicada de «Carmen Prueba».** La pasada creó una segunda ficha
   porque el buscador no encontró la primera. Hay **dos clientas** con el mismo
   nombre y **dos historias clínicas**, cada una con media visita. Hay que
   mirarlas y dejar una: las entradas clínicas son inmutables y **no se
   fusionan**, así que lo que se hace es quedarse con la que tiene la sesión
   firmada, y en la otra no escribir nada más. Si las dos tienen algo, se dejan
   las dos y se apunta cuál es la buena — es una cuenta de demo, y la lección
   (no fusionar historias) vale más que la limpieza.
2. **«Consulta diagnóstico» ya está marcada a mano** como tratamiento de sesión
   (se corrigió durante la pasada). Comprobarlo en Catálogo de agenda, no darlo
   por hecho: si no lo estuviera, el check de onboarding lo dirá.
3. **El nombre de la propietaria.** Entrar a Panel › Personal y **guardar** la
   ficha de Rosario una vez, aunque no se cambie nada: ése es el gesto que
   escribe el `alias` y hace que las seis superficies dejen de pintar
   `m.oyola+clinica-demo`. **Sin ese guardado, el punto 5 no se ve.**
4. **El actor «Paciente (por enlace)» sigue existiendo** y tiene que seguir
   existiendo: es quien firma la respuesta del test que la paciente contestó por
   el enlace. Lo que cambia es que ya no sale en Cajeros ni en Personal.

**Lo que NO hay que hacer:** ningún script de migración de nombres, ninguna
reescritura de sesiones, ningún borrado de la fila del actor de sistema.

---

## 8 · Verde

- **Suite completa en local**: `463 ficheros · 6689 tests · 10 saltados`, verde.
- **e2e completo contra Postgres real** (`pnpm test:e2e`, base propia del
  worktree `mipiacetpv_clinica9_e2e`): `50 ficheros · 1141 tests`, verde.
  Incluye `clinica-sesion-cobro.e2e.ts`, que este bloque amplió para citar
  HOY y no en septiembre.
  - **OJO con la hora.** La CI de este mismo commit (`08bf518`) corrió a las
    01:08 UTC y dio `e2e` rojo con tres fallos —`residencia-3` (el
    `porTurno` del residente vuelve vacío), `residencia-4` (la pasada de
    ausencias D-20) y `residencia-5` (`REGISTRO_EN_EL_FUTURO`: 409 donde
    espera 200)—. Ninguno es de este bloque: la rama no toca esos tres
    ficheros (último cambio, `bcc63d2`, de clinica-8). Son los falsos rojos
    por día de pared ya conocidos, los mismos que el §6 evita pidiendo que
    la pasada en hierro no se haga de madrugada. A las 09:08 UTC, en verde.
    Lo que esto deja pendiente para otro bloque: la CI corre a la hora que
    le toca, y esos tres ficheros no pueden depender de ella.
- **Typecheck paquete a paquete** (`tsc --noEmit`): `apps/api`, `apps/tpv-web`,
  `apps/admin`, `packages/ticket-model`, `packages/clinica-sesion` — limpio.
- **22 sabotajes**, todos rojos (§4), cada uno contra el fichero que de verdad
  ejecuta la línea.
- Ficheros de test nuevos: `clinica-9-dia-de-la-cita`,
  `clinica-9-un-solo-nombre` (API), `clinica-9-sesion`,
  `clinica-9-buscador-de-pacientes`, `clinica-9-valoracion`, `clinica-9-puras`
  (TPV). Ampliados: `sesion-v2`, `riesgo`, `clinica-8-catalogo-clinico`,
  `clinica-8-csv-clinico`, `catalogo-servicios-csv-import`, `clinica-8-cajeros`,
  `clinica-8-agenda`, `staff-route`, `cashiers-alias`, `clinica-sesion-rutas`,
  `clinica-sesion-pantalla`.

---

## 9 · Lo que el bloque encontró por el camino

- **Un comentario que describía un filtro inexistente** sobrevivió siete
  bloques (`actor-paciente.ts`, clinica-2 → clinica-9). Nadie lo comprobó
  porque estaba escrito con seguridad y con sus razones. El arreglo lleva la
  frase «esto era mentira hasta este bloque» a propósito: lo que no se puede
  evitar es que alguien escriba una promesa sin cumplirla; lo que sí se puede
  es que el siguiente que la lea sepa que esta vez tiene test.
- **La sospecha de un prompt es una hipótesis, no un hallazgo.** La del punto 1
  era razonable, encajaba con el síntoma y era falsa. Lo que la descartó fue
  leer las capturas intermedias —qué sobrevivió y qué no— antes que el código.
- **Tres bancos de este repo daban por supuesto que la fecha de una cita no
  significaba nada** (`clinica-sesion-rutas`). No era un descuido: hasta este
  bloque, de verdad no significaba nada.

---

## 10 · Lo que este bloque NO cubre

Lo del prompt, sin cambios:

- **«Abrir turno» con fondo de caja antes de la agenda en una clínica.**
  Decisión de producto de Matías.
- **La altura de las citas cortas en la agenda** (`PX_PER_MIN`): con Rosario
  delante.
- **PIN personal y cambiable, roles, importador de COGECOP**: sus propios
  bloques.

Y lo que este bloque ha decidido dejar fuera:

- **Fusionar historias clínicas duplicadas.** La «Clínica demo» tiene dos
  fichas de Carmen y el bloque no las junta: una entrada clínica es inmutable y
  juntar dos historias es inventar una tercera. Lo que el bloque hace es que no
  vuelva a pasar.
- **Un script que repase las sesiones ya cerradas.** Ver §5: el dato no permite
  encontrar la pérdida, y lo que sí se puede mirar son dos sesiones a mano.
