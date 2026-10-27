# Bloque clinica-10 · mínimos clics antes de Rosario

Rama `clinica-10-minimos-clics`, desde `origin/master` (`43d0a8c`). Frente C.
Prompt: `docs/code-prompts/bloque-clinica-10-minimos-clics.md`.

Punto de partida: `docs/qa/2026-10-27-clinica-9/PASADA.md`, los 15 puntos de
clinica-9 vistos en la Lenovo. Lo que quedaba no rompía nada, pero **costaba
toques o llevaba a error**, y Rosario va a hacer cada gesto decenas de veces al
día.

Los seis puntos están hechos. Lo que **no** está es la pasada en hierro: hace
falta la APK de esta rama y la cuenta de producción, y el prompt deja fuera el
merge y el despliegue. El guion está en §13 para poder hacerla de un tirón.

---

## 0 · Lo primero, porque es lo que cambia cómo se lee el resto

**El fallo de la captura 10b no era «un servicio sin marcar»: era un cobro que
desde la sesión no se podía arreglar.**

La cita de «Cura» abría la sesión con «Pasa a caja: Quiropodia básica · 25 €» y
la «Cura» de 13 € al lado, sin marcar. Lo que parece es «faltan dos toques:
desmarcar una cosa y marcar otra». No lo era:

- la «Cura» de la «Clínica demo» es de la **categoría quiropodia**, así que el
  tipo de visita que la cita sugiere es `QUIROPODIA` y su chip sólo existe
  dentro de la tarjeta de quiropodia;
- con `QUIROPODIA` marcado, la línea del nivel **no se podía quitar**:
  `productoDelNivel(catalogo, nivelPropuesto(actos))` siempre devolvía uno, y
  sin actos marcados `nivelPropuesto` es «básica» (y lo es a propósito desde
  clinica-5: *«una quiropodia es siempre al menos una quiropodia»*);
- desmarcar el tipo tampoco servía: se lleva por delante el chip de la cura —y
  `faltaTipo` impide cerrar sin ningún tipo—, y marcar `GENERAL` en su lugar no
  ofrece la cura, que no es de esa categoría.

O sea: **el cobro correcto de esa visita era inalcanzable desde la sesión.**
Había que cerrar mal y arreglarlo después en el borrador de caja, en otra
pantalla, sin que nada dijera que había algo que arreglar. Es un pariente de lo
que clinica-8 §1.2 cerró («se cobró la previsión en vez del trabajo, y cuadra»).

Qué cambia esto: el punto 1 no es un «viene marcado». Es que
`BloqueQuiropodia.nivelElegido` admite ahora **`null`** —hoy no se cobra ningún
nivel— y que hay una regla, en una función, que decide cuándo.

---

## 1 · El servicio de la cita viene marcado en «Qué se cobra» (H5)

**Qué pasaba.** Dos capturas y el mismo agujero:

- **18 y 24a** · cita de «Consulta diagnóstico». La sesión abre con el servicio
  **sin marcar** y el pie dice «Nada que cobrar · General: no has marcado nada».
  El ticket de la pasada salió a 20 € **sólo porque se marcó a mano** (paso 26).
  Le pasa a la primera visita de **cada paciente nueva**.
- **10b** · lo de §0.

**Qué se ha hecho.** Dos funciones puras en `packages/clinica-sesion`, llamadas
desde la pantalla y desde el servidor —la regla de la casa: una función, dos
sitios—:

| Función | Qué contesta |
|---|---|
| `semillaDeLoReservado({reservados, catalogo})` | con qué chips nace la sesión, por tipo; y **si se propone nivel de quiropodia** |
| `nivelCobrado({actos, nivelAMano, seProponeNivel})` | qué nivel se cobra hoy, **o ninguno** |

`seProponeNivel` es `false` en un solo caso: lo reservado **de quiropodia** no
es un nivel (una cura, un papiloma, un domicilio). Con un nivel reservado, o sin
nada de quiropodia reservado, sigue valiendo lo de clinica-5.

Y `nivelCobrado` tiene tres reglas en orden: manda lo tocado a mano; **con actos
marcados siempre hay nivel** (marcar «deslaminado» es decir que hoy se ha hecho
quiropodia, y entonces el nivel vuelve solo, sin un toque más); y si no, lo que
diga la semilla.

**La siembra va dentro del `sembrado` de clinica-9 (1)**, que es lo que impide
que una recarga —firmar el consentimiento de fotos llama a `cargar()`— vuelva a
marcar lo que la podóloga acaba de desmarcar. Tiene su test y su sabotaje.

**Esto NO contradice clinica-8 §1.2.** Lo que se cobra sigue saliendo de las
líneas de la sesión **cerrada**; lo que cambia es con qué marcas nace la
pantalla, y se pueden quitar.

**El cuerpo de la historia.** `BloqueQuiropodia.nivelElegido` pasa a
`NivelDeQuiropodia | null`. Es un campo que ya existía y que ahora admite una
respuesta más; no hay migración (el `body` es JSON) y lo ya escrito se lee
igual. Los dos sitios que lo leen lo tratan: `visitaLegible` titula «Quiropodia»
a secas y `SesionCerrada` no pinta un nivel que no hubo. **Pintar «Quiropodia
básica» ahí sería decir en una historia clínica que se hizo algo que no se
hizo.**

**Y el `null` es explícito, no la ausencia de la clave.** `normalizarSesionV2`
distingue tres cosas: un nivel de los tres, un `null` escrito a propósito, y
«cualquier otra cosa, incluida la clave que no viene» → la propuesta. La tercera
rama es la de siempre y es la segura: un cuerpo malformado cobra la quiropodia
que marcar el tipo implica, en vez de dejar la visita sin línea sin que nadie lo
haya pedido.

**Lo que el servidor no se cree.** Un «sin nivel» **con actos marcados** se
corrige a la propuesta antes de escribir. Una pantalla que mandara las dos cosas
estaría cobrando de menos una visita que sí se hizo, y lo que entra en la
historia lo decide quien la escribe.

**Bancos.** `packages/clinica-sesion/test/clinica-10-reservado.test.ts` (20),
`apps/tpv-web/test/clinica-10-sesion-reservado.test.tsx` (15),
`apps/api/test/clinica-sesion-rutas.test.ts` (+2, por el esquema de Fastify: con
`additionalProperties:false` una clave no declarada no da 400, se borra en
silencio — el `null` está declarado y lo que se comprueba es que llega).

---

## 2 · Nombres sin cortar en la venta (paso 33)

**Qué pasaba.** El catálogo de Rosario en la pantalla de venta: tres tarjetas
diciendo «biomecánic» —la palabra cortada **a mitad de letra**, sin puntos
suspensivos— y el rail de categorías diciendo «Biomecáni…».

Son el mismo problema con dos remates: la tarjeta tiene `line-clamp-3` +
`overflow:hidden` y una palabra que no cabe **no se parte** (lo normal en CSS),
se sale y la caja la recorta; el rail tiene `truncate`, que sí pone los puntos.

Medido en el navegador a 1280 × 800 (la TB311FU: 1920 físicos a densidad 1,5),
que es donde la rejilla es de cinco columnas:

| | antes | la caja | después |
|---|---|---|---|
| «Exploración biomecánica» | 100 px | 95 | 95 (a 15 px) |
| «Revisión biomecánica adultos» | 100 px | 95 | 95 |
| «Revisión biomecánica niños» | 100 px | 95 | 95 |
| «Biomecánica» (rail) | 85 px | 84 | 79 (a 13 px) |

**Qué se ha hecho.** `apps/tpv-web/src/lib/ancho-del-texto.ts`, **dos capas y
cada una con su trabajo**:

1. **El cuerpo.** Se estima el ancho del texto y se baja el tamaño de letra un
   peldaño hasta que quepa. Tres clases de letra y no un ancho medio único,
   porque la diferencia que importa es ésa: «diagnóstico» y «biomecánica» tienen
   las dos once letras y la segunda ocupa un 15 % más (una `m` contra tres astas
   finas). Con un ancho medio, o se recorta la una o se encoge la otra sin
   motivo — y medido, «diagnóstico» cabía y «biomecánica» no.
2. **`break-words`, que es la garantía.** La capa 1 es una ESTIMACIÓN y se
   equivoca a lo ancho a propósito. Si se queda corta, la palabra se parte y se
   sigue leyendo entera. **Lo que no puede volver a pasar es que se recorte.**

El `16.5 px` del nombre (v1.22 §3, hallazgo N5) y el `14 px` del rail (v1.22 §4)
**no se tocan**: siguen siendo el primer peldaño y es donde se quedan todos los
nombres salvo los que no caben.

**Bancos.** `clinica-10-puras` (10 tests: los 17 servicios del CSV de Rosario y
sus cinco categorías, uno a uno), `sale-rail-categorias` (+4: que el cuerpo se
PINTE, y que `break-words` siga ahí).

**Y el bucle visual**, que es lo que jsdom no puede ver: pantalla
`venta-clinica` nueva en `apps/tpv-web/visual/main.tsx` con el catálogo de
Rosario tal cual. Capturas a 1280 × 800 en
`docs/qa/2026-10-27-clinica-10/bucle-33-venta-antes.png` y
`-despues.png`. **El banco reproduce el fallo de la captura 33 clavado** —las
mismas tres tarjetas, la misma letra perdida— y lo enseña arreglado.

---

## 3 · Dispositivos con nombre legible (paso 38)

**Qué pasaba.** Panel › Dispositivos seguía enseñando el user-agent crudo
(«Mozilla/5.0 (Linux; Android 14; TB311FU…»), con el lector de clinica-8 (fase
B, 18) **ya escrito, probado y en verde**.

El lector no se llegaba a usar. `PairScreen` emparejaba mandando
`deviceName: navigator.userAgent.slice(0, 80)` — el user-agent crudo, y además
cortado por la mitad, **en la columna del NOMBRE**. Y `nombreDeDispositivo` hace
lo correcto con un nombre puesto a mano: respetarlo.

**Qué se ha hecho.**

- `PairScreen` **no manda nombre**. El nombre lo pone una persona desde el
  panel; lo que la tablet sabe de sí misma es su user-agent, y va en el campo
  del user-agent.
- Y para las tablets **que ya están emparejadas**: `nombreDeDispositivo` ignora
  un `name` que sea un user-agent (`pareceUserAgent`), y si el user-agent de
  verdad no viene, lo lee de ahí. **Nada de migración ni de `UPDATE` masivo**:
  misma decisión que el alias de clinica-9 (4), lo arregla la lectura.
- El criterio es **estrecho a propósito** —empezar por `Mozilla/` o traer dentro
  un motor de navegador— porque el coste de equivocarse es tirar un nombre que
  una persona escribió. «Caja 1», «Tablet de Rosario» o «Mostrador» no se
  parecen a eso ni por accidente, y tienen su test.

**Bancos.** `clinica-8b-panel` (+3), `clinica-10-emparejar` (2).

---

## 4 · Guardar Personal escribe el alias aunque el nombre no cambie (H1)

**Qué pasaba.** clinica-9 (5) puso el puente —guardar en Personal escribe las
dos columnas, `staff_profiles.display_name` y `users.alias`— y dejó dicho que
«para las cuentas que ya existen el primer guardado lo arregla». Ese guardado no
llegaba a salir: `guardarTarjeta` se salta las secciones que no están `sucio()`,
y en la ficha de Rosario **no hay nada que cambiar** — su nombre de agenda ya es
«Rosario». La pasada lo resolvió cambiando el nombre, guardando, y volviéndolo a
cambiar.

**Qué se ha hecho.** La pregunta correcta no es «¿has tecleado algo?», es
**«¿dicen las dos columnas lo mismo?»**. El perfil cuenta como sucio mientras
`alias ≠ displayName`, y el gesto que la dueña ya hace —entrar a su ficha y
pulsar Guardar— lo arregla a la primera.

Lo que **no** se pierde: cuando las dos ya coinciden, «Guardar» sin tocar nada
sigue sin mandar nada. Tiene su test, porque es la regla que este arreglo podía
romper.

**Banco.** `clinica-10-panel` (2 tests).

---

## 5 · Agenda · Catálogo no dice «no has asignado ninguna categoría» (H2)

Eran **dos cosas a la vez**, y las dos estaban.

**a) La pantalla pintaba un fallo de lectura como una lista vacía.** Un
`.catch(() => setItems([]))` convertía cualquier error en «Todavía no has
asignado ninguna categoría»: la pantalla contándole a la dueña que su catálogo
está sin configurar cuando lo que pasa es que no se pudo preguntar. Ahora son
tres estados y no dos (cargando / no se pudo / vacío de verdad), y el del medio
lo dice y manda a reabrir.

**b) Y había un fallo de lectura que provocar.** `GET /admin/tag-visit-types`
iba tras `ensureClinicaEnabled`, que desde clinica-7 (decisión 24) contesta la
404 de ruta inexistente **a toda sesión de impersonación del superadmin**. O
sea: el implantador de Mi Piace no podía ver las categorías desde el panel de la
cuenta.

Y eso es incoherente con lo que ya hacemos: **el superadmin ESCRIBE esa tabla**.
El importador de catálogo de una implantación (`superadmin/tenant-catalog.ts`)
crea esas filas al cargar el CSV, y el check «Catálogo clínico completo» las
cuenta. Podía crearlas y medirlas, y al abrir la pantalla donde se ven recibía
«aquí no hay nada».

**Qué se ha hecho.** `ensureClinicaConfigurable`: el módulo tiene que estar
encendido —eso no se relaja, un bar no puede saber que este sistema tiene un
módulo de datos de salud— y la impersonación **no** se corta. La usa esa ruta y
sólo esa.

**Lo que la decisión 24 protege sigue protegido entero**: historias,
valoraciones, fotos, consentimientos, informes y sesión llevan
`ensureClinicaEnabled` y le siguen contestando a Mi Piace que esa ruta no
existe. Aquí no hay un dato de un paciente: hay dos columnas de texto del
catálogo.

**Banco.** `apps/api/test/clinica-10-tipos-de-visita.test.ts` (6), con las dos
mitades: la puerta de configuración deja pasar y **la de las historias no**. Si
alguien cambiara una por otra en una ruta clínica, ahí se ve.

---

## 6 · Los detalles de la pasada

| Qué | Dónde |
|---|---|
| **Al firmar el consentimiento de fotos se vuelve a Fotos** (19b). El botón que lo pide está EN Fotos, y firmarlo dejaba a la podóloga en Consentimientos con la cámara en la mano. Se recuerda de dónde se vino; tocar otra pestaña por el camino **cancela la vuelta** (si no, se le movería la pantalla bajo el dedo), y entrando por la pestaña firmar no mueve a nadie: ahí es el final del recado, no el medio. | `SesionPodologia.tsx` |
| **El «atrás» de Android sale de la Historia** (H3). No hacía nada: esta pantalla no registraba ninguna capa, así que el gesto caía en el guardia de fondo —que con el turno abierto se lo traga para no echar a nadie de la aplicación— y para quien tiene la tablet en la mano eso es un botón roto. Ahora son **tres capas**: la hoja de «¿qué visita es hoy?», la zona del pie abierta, y la historia entera. Desde los **dos** sitios que la montan: Clientes → ficha → Historia, y la cita de la agenda. | `HistoriaViva.tsx`, `ClientsPage.tsx`, `AgendaPage.tsx` |
| **Cajeros no pide crear uno «para poder entrar»**. Decía «Crea al menos un cajero para que pueda iniciar sesión en el TPV con su PIN», y en una clínica de una persona eso es falso y además da miedo: Rosario entra con SU PIN —sale en «Cajeros recientes», la pasada lo vio en el paso 1—. Lo que esa lista tiene es gente **distinta del propietario**; vacía significa que no la hay. | `CashiersPage.tsx` |

---

## 7 · Toques, antes y después

Contados sobre el código (la pasada en hierro los confirma). El recorrido es el
del prompt: **abrir la sesión → cobro**, primera visita de una paciente nueva,
cita de «Consulta diagnóstico», sin nada clínico más que lo obligatorio.

| # | Toque | antes | después |
|---|---|---|---|
| 1 | la cita en la agenda | ✔ | ✔ |
| 2 | «Sesión de hoy» | ✔ | ✔ |
| 3 | **bajar a «Qué se cobra» y marcar «Consulta diagnóstico»** | ✔ (+ desplazamiento) | — |
| 4 | el dolor de hoy | ✔ | ✔ |
| 5 | «Cerrar sesión y cobrar» | ✔ | ✔ |
| 6 | «Cerrar y firmar» (la hoja) | ✔ | ✔ |
| 7 | método de pago | ✔ | ✔ |
| 8 | «Cobrar» | ✔ | ✔ |
| | **total** | **8** | **7** |

Un toque de ocho no parece mucho, y **no es el número que importa**: lo que
importa es que ese toque **no estaba en ninguna lista** y que sin él la primera
visita de la paciente se firma y se cobra a 0,00 € sin que nada lo diga. La
pasada lo dio porque Matías miró el pie; Rosario, sola, con la paciente delante,
puede no mirarlo ningún día.

Y en la cita de «Cura» la cuenta no es de toques:

| | antes | después |
|---|---|---|
| lo que la sesión propone | Quiropodia básica · 25 € (no se hizo) | **Cura · 13 €** |
| toques para dejarlo bien | **no se podía desde la sesión** (§0): hay que cerrar mal y editar el borrador en caja | 0 |

---

## 8 · Decisiones tomadas sin preguntar

1. **«No hay nada reservado» se lee como «no hay nada reservado DE
   QUIROPODIA».** El prompt dice «el nivel sólo se propone si lo reservado es un
   nivel de quiropodia o no hay nada reservado». Literal, una cita de «Consulta
   diagnóstico» (GENERAL) dejaría sin nivel a la podóloga que marque quiropodia
   a mano — y marcarla a mano es ella diciendo que hoy TAMBIÉN hace quiropodia.
   Pedirle un toque más ahí sería lo contrario de este bloque. En los dos casos
   de la pasada el resultado es el mismo.
2. **Con actos marcados siempre hay nivel, y vuelve solo.** En una cita de
   «Cura», marcar un acto de quiropodia devuelve el nivel sin tocar nada más.
   La alternativa —que el «sin nivel» fuera pegajoso— cuesta un toque y, si se
   olvida, cobra de menos una quiropodia que sí se hizo. Y es la regla que el
   servidor impone al escribir, no una comodidad de la pantalla.
3. **El nivel puesto a mano no se puede quitar**, igual que antes de este
   bloque: los tres botones son un elegir-uno. No se ha añadido un cuarto
   («ninguno») porque el camino para no cobrar nivel es no marcar actos, y una
   opción más en la pantalla más llena se paga todos los días para un caso que
   ya está resuelto.
4. **`nivelElegido: null` y no un booleano nuevo al lado.** Un `sinNivel: true`
   junto a un `nivelElegido: 1` son dos campos que pueden contradecirse dentro
   de un registro inmutable. `null` dice exactamente lo que pasó.
5. **El mapa `categoría → tipo de visita` se abre a la impersonación** (§5b).
   Es relajar una puerta clínica, y por eso va con las dos mitades probadas y
   con una función aparte —`ensureClinicaConfigurable`— en vez de un `if` dentro
   de la de siempre: la que protege las historias no se ha tocado.
6. **El user-agent que ya está en la columna del nombre se ignora al leer**, no
   se migra. Misma razón que clinica-9 (4): un `UPDATE` sobre quince bases para
   arreglar lo que la lectura arregla sola no se paga. Y el criterio para
   reconocerlo es estrecho, porque equivocarse cuesta el nombre que alguien
   escribió.
7. **El ancho de la tarjeta se mide una vez, en el caso estrecho** (1280, cinco
   columnas). En handheld las tarjetas son bastante más anchas y ahí un nombre
   larguísimo sale un peldaño más pequeño de lo necesario; tener dos números
   habría sido tener dos sitios donde equivocarse, y la diferencia no se ve.
8. **La vuelta a Fotos sólo desde Fotos.** El otro camino a Consentimientos —la
   banda de «falta firmar» de la sesión— se deja como estaba: nadie se quejó, y
   ahí firmar es el final del recado.
9. **La historia no se inventa una salida.** `HistoriaViva` sólo registra la
   capa de «cerrar» si quien la monta le dice cómo cerrarse. Sin eso, el Atrás
   sigue cerrando lo de dentro y nada más — ver §11.
10. **La decisión de producto de Matías se anota en
    `docs/clinica/decisiones.md`**, no sólo aquí: «mínimos clics posibles» va a
    seguir decidiendo bloques después de éste.

---

## 9 · Tabla de sabotajes

Cada garantía rota a propósito sobre la línea de producción, con el **fichero de
test entero** (no `-t`), restaurando después de cada una. Los mensajes son los
reales, copiados de la salida.

| # | Qué se rompe | Dónde | Fichero | Rojo | Mensaje real |
|---|---|---|---|---|---|
| **1 · lo reservado nace marcado** |
| 1 | la semilla deja de marcar los servicios reservados | `clinica-sesion/src/sesion-v2.ts` | `clinica-10-reservado` + `clinica-10-sesion-reservado` | 🔴 11 | `expected {} to deeply equal { GENERAL: [ 's-pod-001' ] }` · `expected 'Nada que cobrar en esta visitaGeneral…' to contain 'Pasa a caja:'` |
| 2 | **la semilla vuelve a sembrarse en cada recarga** | `SesionPodologia.tsx` | `clinica-10-sesion-reservado` + `clinica-9-sesion` | 🔴 1 | `expected 'true' to be 'false'` (el chip desmarcado vuelve tras firmar) |
| **1 · la cita de «Cura» no cobra una quiropodia** |
| 3 | se propone nivel siempre (se ignora lo reservado) | `clinica-sesion/src/sesion-v2.ts` | `clinica-10-reservado` + `clinica-10-sesion-reservado` | 🔴 4 | `expected 'Básica25,00 €' to be null` · `… to contain 'Hoy no se cobra nivel'` |
| 4 | marcar un acto deja de devolver el nivel | `clinica-sesion/src/sesion-v2.ts` | `clinica-10-reservado` + `clinica-10-sesion-reservado` | 🔴 3 | `expected null to be 3` |
| 5 | **el `null` del cierre vuelve a ser la propuesta** | `clinica-sesion/src/sesion-v2.ts` | `clinica-10-reservado` + `clinica-sesion-rutas` | 🔴 2 | `expected 1 to be null` (y el de la ruta: el `null` cruza el esquema de Fastify) |
| 6 | el servidor se cree el «sin nivel» con actos marcados | `clinica-sesion/src/sesion-v2.ts` | `clinica-10-reservado` | 🔴 1 | `expected null to be 3` |
| **4 · Personal escribe el alias** |
| 7 | el alias deja de contar como sucio | `StaffPage.tsx` | `clinica-10-panel` + `clinica-8b-personal` | 🔴 1 | `expected [] to include 'PUT /staff/u-rosario'` |
| **5 · Agenda · Catálogo** |
| 8 | el fallo de lectura vuelve a pintarse como lista vacía | `AgendaCatalogPage.tsx` | `clinica-10-panel` | 🔴 1 | `… not to contain 'Todavía no has asignado ninguna categ…'` |
| 9 | la ruta vuelve a `ensureClinicaEnabled` | `admin/tag-visit-types.ts` | `clinica-10-tipos-de-visita` | 🔴 1 | `expected 404 to be 200` |
| 10 | **la puerta de las historias deja de cortar a Mi Piace** | `clinica/gate.ts` | `clinica-10-tipos-de-visita` + `clinica-7-contrato-rutas` | 🔴 2 | `expected [] to have a length of 1 but got +0` |
| **2 · los nombres de la venta** |
| 11 | el cuerpo no baja nunca de peldaño | `lib/ancho-del-texto.ts` | `clinica-10-puras` + `sale-rail-categorias` | 🔴 8 | `«biomecánica» (de «Exploración biomecánica») no cabe ni a 16.5 px: expected 105.76 to be less than or equal to 100` |
| 12 | la tarjeta pierde `break-words` (el suelo) | `SalePage.tsx` | `sale-rail-categorias` | 🔴 1 | `expected 'line-clamp-3 font-medium leading-tigh…' to contain 'break-words'` |
| **3 · dispositivos con nombre legible** |
| 13 | un user-agent vuelve a valer como nombre | `lib/nombre-de-dispositivo.ts` | `clinica-8b-panel` | 🔴 2 | `expected 'Mozilla/5.0 (Linux; Android 14; TB311…' to be 'Android 14 · TB311FU · app'` |
| 14 | **emparejar vuelve a mandar el user-agent como nombre** | `PairScreen.tsx` | `clinica-10-emparejar` | 🔴 2 | `expected [ [ 'deviceName', …(1) ] ] to deeply equal []` |
| **6 · los detalles** |
| 15 | la historia no registra su capa del Atrás | `HistoriaViva.tsx` | `clinica-historia-pantalla` | 🔴 2 | `expected +0 to be 1` |
| 16 | al firmar no se vuelve a Fotos | `SesionPodologia.tsx` | `clinica-10-sesion-reservado` | 🔴 1 | `expected 'Consentimientos' to be 'Fotos'` |
| 17 | Cajeros vuelve a pedir que se cree uno | `CashiersPage.tsx` | `clinica-10-panel` | 🔴 2 | `… not to contain 'Crea al menos un cajero'` |
| 18 | **la historia abierta desde la AGENDA se queda sin salida** | `AgendaPage.tsx` | `clinica-8-agenda` | 🔴 1 | `expected true to be false` (la historia sigue abierta tras el Atrás) |

**El sabotaje 18 es el que `clinica-historia-pantalla` NO puede dar.** Ese
banco monta `HistoriaViva` suelta y le pasa el `onCerrar` él mismo, así que
estaría probando el test. Por eso el 18 vive en el banco de la AGENDA, que es
quien de verdad tiene que pasar la prop — y con la línea quitada sigue verde
todo lo demás, incluido el banco de la historia.

**El sabotaje 10 merece una nota**: es el que vigila que relajar la puerta de
§5b no se extienda. Puso rojo también `clinica-7-contrato-rutas`, que no es de
este bloque — y eso es exactamente lo que tenía que pasar.

**Y el 5 tiene una asimetría a propósito**: no pone rojo el banco de pantalla,
sólo el del paquete y el de la ruta. La pantalla prueba lo que MANDA; lo que el
servidor escribe con eso es de otro fichero. Si un sabotaje del servidor pusiera
rojo el banco de pantalla, uno de los dos estaría probando lo que no es suyo.

---

## 10 · Verde

- **Suite completa en local**: `480 ficheros · 6968 tests · 10 saltados`, verde.
- **e2e completo contra Postgres real** (`pnpm test:e2e`, base propia del
  worktree `mipiacetpv_clinica10_e2e`): `51 ficheros · 1198 tests`, verde. A las
  16:09 locales — ni de madrugada, que es cuando `residencia-3/4/5` dan falsos
  rojos por día de pared (clinica-9 §8).
- **Typecheck paquete a paquete** (`tsc --noEmit`): `apps/api`, `apps/tpv-web`,
  `apps/admin`, `packages/ticket-model`, `packages/clinica-sesion` — limpio.
- **18 sabotajes**, todos rojos (§9), cada uno contra el fichero que de verdad
  ejecuta la línea.
- **Bucle visual** del paso 33 a 1280 × 800, con el antes y el después medidos
  en el navegador (§2).
- Ficheros de test nuevos: `clinica-10-reservado` (paquete),
  `clinica-10-tipos-de-visita` (API), `clinica-10-sesion-reservado`,
  `clinica-10-puras`, `clinica-10-emparejar` (TPV), `clinica-10-panel` (panel).
  Ampliados: `clinica-sesion-rutas`, `clinica-historia-pantalla`,
  `clinica-8-agenda`, `sale-rail-categorias`, `clinica-8b-panel`.

---

## 11 · Lo que este bloque NO cubre

Lo del prompt, sin cambios:

- **PIN elegible por el propio usuario** (H4): su propio bloque, toca a todas
  las verticales. Es el siguiente.
- **Todo lo de la pantalla de agenda** (el embudo de «Nueva cita», la vista
  semanal, «Dársela ahora» que pierde la paciente —H8—, el servicio propuesto al
  tocar la rejilla, la cita de otro día que dice «Hoy» —H6—): va al bloque común
  de agenda. **Este bloque no toca `AgendaPage.tsx`.**
- **Config de Rosario** (H9, el servicio del pie de riesgo; H10, el texto del
  consentimiento): se deciden con ella.

**Una excepción al «no toca `AgendaPage.tsx`», y es de Matías (27-10).** El
Atrás de la historia abierta desde la agenda quedó fuera por la prohibición del
prompt, y se cerró después con autorización expresa: **una línea**,
`onCerrar={() => setHistoriaDe(null)}` junto al `<HistoriaViva>` de
`AgendaPage.tsx`, más su test y su sabotaje (el 18). Es todo lo que este bloque
toca de ese fichero — ni una línea más —, y se eligió esa forma precisamente
para que el bloque común de agenda la pueda mover de sitio sin leer nada: si la
pantalla nueva monta la historia de otra manera, lo que tiene que seguir
pasando es que el Atrás tenga salida, y el sabotaje 18 lo dice.

---

## 12 · Al desplegar

**Migraciones: NINGUNA.** El bloque no toca el esquema. `nivelElegido` es un
campo del JSON del cuerpo de la sesión, y admitir `null` no es una migración: lo
ya escrito se lee igual.

**APK: SÍ, hace falta una nueva.** Casi todo lo de pantalla es del TPV: los
puntos 1 (la sesión), 2 (la venta), 6 (las fotos y el Atrás) y el emparejado del
3. Una tablet con la 1.29.0 contra la API nueva **no se rompe** —no hay campo
obligatorio nuevo en ninguna dirección— pero no arregla nada de lo suyo. Lo que
SÍ cambia sin tocar la tablet: el punto 4 (Personal), el 5 (Agenda · Catálogo y
su puerta), la lectura de Dispositivos y el texto de Cajeros, que son del panel
y de la API.

**Orden: API primero, APK después**, el de siempre. Al revés, la APK nueva
contra la API vieja se comporta igual: lo que manda de más —un `nivelElegido` en
`null`— lo trataría una API anterior como «la propuesta», que es el
comportamiento de hoy. Ninguna de las dos mitades rompe a la otra.

**Qué hay que retocar a mano en la «Clínica demo»** (arrastra el estado del
27-10):

1. **Nada del punto 4.** El alias de Rosario ya se arregló durante la pasada con
   el apaño de los dos guardados. Lo que este bloque cambia es que la PRÓXIMA
   cuenta no necesite el apaño.
2. **Las tablets ya emparejadas no hay que volver a emparejarlas**: la lectura
   del panel ignora el user-agent que tienen en la columna del nombre. Si se
   quiere un nombre de verdad («Consulta», «Mostrador»), se pone a mano desde
   Dispositivos — y entonces manda ése, como siempre.
3. **La «Cura» de la demo está en la categoría quiropodia.** Es lo que produjo la
   captura 10b y es lo que hace falta dejar como está para poder ver el punto 1
   en el aparato (paso 4 de §13). En el catálogo de Rosario la cura es de
   cirugía, y ahí el caso no se da.
4. **Los datos de prueba del 27-10 siguen**: Lucia Prueba con su sesión firmada,
   las dos fichas de Carmen, la cita del 24-11. No hay que tocarlos.

**Lo que NO hay que hacer**: ningún script de nombres de dispositivo, ninguna
reescritura de sesiones cerradas, ningún `UPDATE` de `tag_visit_types`.

---

## 13 · El guion de la pasada en hierro

**Esto NO está hecho.** Hace falta la APK de esta rama y la cuenta de
producción, y el prompt deja fuera el merge y el despliegue. Va aquí para
poder hacerlo de un tirón.

**Lo que hace falta:** la cuenta **«Clínica demo»**, la **Lenovo TB311FU** con la
APK de este bloque, y `adb` para las capturas, que van a
`docs/qa/2026-10-27-clinica-10/` junto a las dos del bucle visual que ya están.

**No de madrugada**: la sesión sólo se cierra el día de la cita (clinica-9, 4).

| # | Qué se hace | Qué hay que ver | Punto |
|---|---|---|---|
| 1 | Dar una cita de HOY de **«Consulta diagnóstico»** a una paciente nueva y abrir «Sesión de hoy» | el chip **«Consulta diagnóstico · 20,00 €» YA MARCADO** y el pie diciendo **«Pasa a caja: Consulta diagnóstico · 20,00 €»** — ni «Nada que cobrar» ni «no has marcado nada» | **1** |
| 2 | Poner el dolor y cerrar **sin tocar nada más** | la hoja de firmar con el servicio, y el ticket a **20,00 €** | **1** |
| 3 | Repetir, y esta vez **desmarcar** el chip antes de cerrar | el pie vuelve a «Nada que cobrar» y el ticket sale vacío con su aviso (clinica-8 §1.2) | **1** |
| 4 | Dar una cita de HOY de **«Cura»** y abrir la sesión | **«Cura · 13,00 €» marcada**, el recuadro del nivel **sin ningún botón encendido** y la frase «Hoy no se cobra nivel…». **NO** «Pasa a caja: Quiropodia básica · 25 €» | **1** |
| 5 | Tocar «Deslaminado» | aparece **«Básica»** encendida y el pie dice «Quiropodia básica · 25,00 € + Cura · 13,00 €» | **1** |
| 6 | Quitar «Deslaminado» | el nivel se va otra vez y queda sólo la cura | **1** |
| 7 | Venta suelta, catálogo entero | **«Exploración biomecánica», «Revisión biomecánica adultos» y «… niños» se leen ENTERAS**, y el rail dice **«Biomecánica»** sin puntos | **2** |
| 8 | Panel › Dispositivos | la tablet como **«Android 14 · TB311FU · app»**, no «Mozilla/5.0…» | **3** |
| 9 | Emparejar una tablet de cero (si hay una a mano) | la fila nace ya con el nombre legible | 3 |
| 10 | Panel › Personal, abrir una ficha y **Guardar sin cambiar nada** | se guarda (y en una cuenta con el alias sin escribir, las seis superficies dejan de pintar el email al siguiente login) | **4** |
| 11 | Panel › Agenda · Catálogo, **desde super-admin** («configurar» sobre la cuenta) | **se ven las categorías con su tipo de visita**; ya no dice «Todavía no has asignado ninguna categoría» | **5** |
| 12 | Lo mismo entrando con la cuenta de la dueña | igual | 5 |
| 13 | Panel › Cajeros, en la cuenta de una sola persona | **no** dice «Crea al menos un cajero para que pueda iniciar sesión» | 6 |
| 14 | En la sesión: pestaña Fotos → «Firmar consentimiento de fotos» → firmar | **vuelve solo a Fotos**, con la cámara a un toque | 6 |
| 15 | Abrir Clientes → una ficha → Historia, y pulsar el **Atrás de Android** | **sale de la historia** | 6 |
| 15b | Lo mismo desde una **cita de la agenda** («Historia del paciente» → Atrás) | **sale de la historia y deja la agenda donde estaba** — no se sale del TPV | 6 |
| 16 | **Contar los toques** de la primera visita, de abrir la sesión al cobro | el número de §7 | — |

### Lo que hay que apuntar aunque salga bien

- **El paso 4 es el de §0** y es el único que no se puede dar por cerrado sin
  verlo en el aparato: depende de cómo esté la «Cura» en el catálogo de la demo.
  Si la cura estuviera en la categoría «cirugía», lo que se vería es la tarjeta
  de cirugía con la cura marcada y **ninguna tarjeta de quiropodia** — que
  también está bien, pero no prueba el punto.
- **El paso 7** está medido en el navegador a 1280 × 800 (§2). Si en la tablet
  siguiera cortando, el número es `ANCHO_UTIL_TARJETA` y se ajusta ahí, en un
  sitio.
- **Cuántos toques cuesta el día entero**, otra vez. Es el número que dice si
  clinica-8, 9 y 10 han servido.

---

## 14 · Lo que el bloque encontró por el camino

- **Una pieza probada y en verde que no se llegaba a usar.** El lector de
  user-agents de clinica-8 (fase B, 18) tenía seis tests y funcionaba; lo que no
  tenía era un test de que algo lo LLAMARA. `PairScreen` escribía el user-agent
  en la columna del nombre y el lector quedaba siempre detrás de un `if`. El
  sabotaje 14 es el que faltaba.
- **«Está mal el texto» era «está mal la puerta».** H2 parecía un mensaje
  desafortunado y eran dos fallos encadenados: una pantalla que pinta un error
  como un vacío, y un error que de verdad pasaba. Arreglar sólo el texto habría
  dejado la pantalla en blanco diciendo la verdad a medias.
- **Un número medido una vez envejece.** `CATEGORY_RAIL_WIDTH` (144) lleva desde
  v1.22 con un comentario que explica que la etiqueta más larga pide 92 px… y el
  hueco real que deja son 88. Nadie mintió: se midió con la carta de un bar y
  llegó un catálogo de clínica. Por eso el arreglo no es «subir el rail a 160»
  —que le quita ancho a la rejilla— sino que la etiqueta sepa encogerse.
- **El bucle visual cazó lo que jsdom no puede.** Las tres tarjetas cortadas se
  reproducen en el banco al píxel (100 px de texto en 95 de caja). Un test de
  clases habría pasado en verde con el fallo delante.
