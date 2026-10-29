# clinica-11 · done

Rama `clinica-11`, desde `origin/master` con pin-1 mergeado. 29-10-2026.
Vertical **clínica**. Va antes de que entre el primer paciente real de
Rosario: `cogecop-1` (el importador) corre contra producción sólo con
esto desplegado.

---

## 0 · Lo que se encontró al leer, antes de tocar nada

El prompt pedía leer cuatro cosas. Lo que dijeron, que es lo que decidió
casi todo lo demás:

1. **`@sentry/node` 10 no filtra el cuerpo «a veces»: lo manda siempre.**
   Leído en el paquete instalado y no en la documentación
   (`node_modules/.pnpm/@sentry+core@10.57.0/.../types/datacollection.d.ts`
   y `integrations/requestdata.js`):

   - `dataCollection` tiene por defecto `httpBodies` con los **cuatro**
     tipos de cuerpo, `cookies: true`, `queryParams: true`,
     `httpHeaders.request: true` y **`stackFrameVariables: true`** — las
     variables LOCALES de cada marco del stack, que en un handler clínico
     incluyen el cuerpo parseado;
   - la `requestDataIntegration` lleva `data: true` **cableado en el
     código del SDK**, con este comentario dentro:
     `// Always attach body data that's already on the scope`;
   - y `sendDefaultPii: false` **no gobierna ninguna de las dos**. En la
     v10 está marcada `@deprecated` y mira `user.*`.

   Es decir: la frase del esquema («ESTE CAMPO NO SE ESCRIBE EN NINGÚN
   LOG. Ni en el de la aplicación, ni en Sentry, ni en un mensaje de
   error») llevaba desde clinica-1 siendo una intención.

2. **El camino que de verdad filtraba en la API no era ninguna
   integración.** `lib/error-handler.ts` registra
   `extra: { url: request.url, method }` en sus **dos** `captureError`, y
   `request.url` de Fastify **incluye la query**. Una ruta clínica con
   `?nombre=…` o con el token del informe por enlace dejaba eso en Sentry
   sin pasar por nada que se pudiera apagar. Es el caso que el test de la
   API ejercita.

3. **El cajero técnico SÍ se puede provisionar sin Holded: la premisa del
   prompt es falsa, y lo destapó el e2e.** `provisionTestCashier` tiene
   **dos** llamantes, no uno:

   - `workers/initial-sync-worker.ts:56`, cuando el sync inicial termina
     OK — ése sí necesita Holded;
   - **`issueTestCashierSession`** (`superadmin/test-cashier.ts:238`),
     que corre al pulsar «Probar TPV» en la consola del super-admin y
     que **no necesita Holded**: provisiona a demanda.

   O sea que el check no estaba en rojo «para siempre»: estaba en rojo
   hasta que el implantador probaba el TPV. Era un peaje, no un callejón.
   Se implementa igual —la decisión está marcada como no re-debatible— y
   lo que se pierde queda dicho en §3.


4. **«Cobrar en caja» sobre una cita es EL cobro de una consulta.**
   `agenda/checkout.ts:232` busca el turno abierto y devuelve
   `409 SHIFT_NOT_OPEN` si no hay. Ahí es donde la caja de una clínica se
   abre sola, y no en un endpoint nuevo.

Y los `throw`, que el prompt pedía mirar. Lo contado:

| dónde | `throw new` | interpolan | con dato del paciente |
|---|---|---|---|
| `apps/api/src/clinica/*` | 24 | 9 | **0** |
| `packages/clinica-sesion`, `clinica-valoracion`, `consentimientos` | 0 | 0 | 0 |
| `apps/api/src/residencia/*` | 64 | 13 | **1** |

Los 9 de la clínica interpolan `tenantId`, `tabla.columna (filaId)` o un
tamaño en bytes — la regla que `cripto.ts` ya tenía escrita («lo que se
dice es QUÉ no cuadra, no con qué se intentó»). **Ninguno hay que
cambiarlo.**

El 1 de la residencia es `residencia/registro.ts:219`:
`«${entrante.numero} no es una lectura posible de …»` — una constante
vital rechazada por estar fuera de rango, con el número dentro del
mensaje. Se siguió hasta el final y **no llega a Sentry**:
`escribirRegistro` captura `RegistroInvalido` en su propio `try` y lo
convierte en `{estado:"rechazado", codigo, mensaje}`, así que la
excepción no sube nunca al manejador global y nadie llama a
`captureError`. El número va a la respuesta 409 y a la cola de la tablet,
que es donde sirve («38,4 o 384»). No hay nada que cambiar, y queda
escrito porque la próxima vez que alguien lea ese `throw` se va a hacer
la misma pregunta.


---

## 1 · Sentry sin datos de salud, en las tres apps

### La regla vive en un sitio

`packages/sentry-limpio` — paquete nuevo, puro, sin dependencias de
ningún SDK (trabaja sobre una forma mínima declarada en él). Lo usan la
API, el TPV y el panel.

Por qué un paquete y no tres funciones: **tres copias son tres listas
blancas de cabeceras que se separan**, y lo que se ve en Sentry cuando
una se queda corta es que *falta* un dato, no que sobra. Es el mismo
argumento exacto de `cripto-campos.ts`.

### Tres capas, y las tres a propósito

| capa | qué hace | dónde |
|---|---|---|
| 1 | `dataCollection` — que **no se recoja** el cuerpo, las cookies, la query, las cabeceras ni las variables locales | `opcionesDeSentry` de cada app |
| 2 | `requestDataIntegration({include:{data:false,…}})` — que, si algo lo deja en el scope, **no se adjunte** | API |
| 3 | `beforeSend` / `beforeSendTransaction` / `beforeBreadcrumb` → `limpiarEvento` / `limpiarMiga` | las tres apps |

Las dos primeras son configuración de un SDK que ya cambió de criterio
entre versiones menores. La tercera es nuestra: si mañana la v11 mueve el
cuerpo de sitio, las capas 1 y 2 se callan y la 3 sale en rojo en
`clinica-11-sentry.test.ts`, que mira el JSON **entero** del evento.

### Qué se va, y qué se queda

Se va **siempre, sin preguntar de qué ruta viene el evento**:
`request.data`, `request.cookies`, `request.query_string`, todas las
cabeceras salvo ocho, y del `user` todo menos el id interno y el tenant.

«Sin preguntar de qué ruta viene» es deliberado y es más fuerte que
filtrar sólo lo clínico: una lista de rutas que haya que mantener es una
lista que el día que alguien añada `/pacientes` se queda corta, y ese
fallo no se ve en ninguna pantalla.

De `extra` y `contexts` se va toda clave que **nombre** a una persona o a
un dato clínico, **todo valor que no sea un primitivo** (un cuerpo de
petición o una fila clínica son objetos; un id y un contador son
primitivos) y lo que pase de 200 caracteres. Y de las claves que son una
ruta (`url`, `path`, `endpoint`, `ruta`) se va la query y cada id pasa a
`:id`.

Se **queda**, a propósito: el tipo y el mensaje de la excepción, el
stack, los tags (`component`, `tenantId`, `requestId`) y la release. Sin
eso Sentry no sirve para nada.

### El TPV y el panel: el riesgo son los breadcrumbs

No el cuerpo de la petición — eso es la API. El `message` de un
`ui.click` es el árbol del DOM pulsado, con su `aria-label` y su texto
dentro: en la agenda de una clínica eso es «Cobrar a Demetria Cobos». Y
los de consola, que nadie audita. Los dos se tiran enteros; la navegación
a una ruta clínica también; y las URLs de los que sí viajan se recortan.

**Sin Replay**, y no por omisión: la lista de integraciones se filtra por
nombre y hay un test que lo mira. Un Replay en una consulta de podología
es la historia de la paciente en vídeo.

### El criterio del test: el JSON entero

Lo que se afirma no es «`request.data` está vacío». Es que **el
centinela `PACIENTE-CENTINELA` no aparece en ningún sitio del envelope
serializado**. Un assert por campo es un assert que pasa el día que el
SDK mueve el dato, y eso ya pasó una vez dentro de la v10.

### Decisión tomada sin preguntar

**`name` está en la lista de claves prohibidas de `extra`/`contexts`.**
Eso cuesta `contexts.runtime.name` y `contexts.os.name` (las versiones
sobreviven). Se paga porque en esta casa hay `clientName`, `staffName` y
`nameSnapshot`, y las tres llevan el nombre de una persona.

---

## 2 · En una clínica no se abre turno

**Decisión de Matías (28-10), no re-debatida.** La podóloga llega,
atiende y cobra. La caja se abre sola **al primer cobro del día**, con el
fondo que dejó el último cierre, a nombre de quien cobra, y queda en la
auditoría como apertura automática. La norma de un cierre por día y por
caja se mantiene.

### Al primer cobro y no al entrar

No es de estilo. Abrir el turno al teclear el PIN significa que un martes
de sólo revisiones —atiende a cuatro pacientes, no cobra a ninguna porque
van con bono— deja un turno abierto que hay que cerrar. Y al día
siguiente ese turno es de ayer, así que el login cae en `forceClose` y le
sale **otra** pantalla: habríamos cambiado una pantalla inútil por dos.

Abriéndolo al primer cobro, un día sin cobros no tiene turno. No hay nada
que cerrar porque no pasó nada por el cajón.

### En el servidor, no en el TPV

Porque es una invariante y no una pantalla. El TPV esconde la pantalla
—eso es UI— pero lo que no puede pasar es que un cobro de una clínica se
caiga con `409 SHIFT_NOT_OPEN`: **cobrar siempre se puede**, y ese 409 es
lo que el outbox clasifica como rechazo permanente, o sea una venta que
no se registra. Un terminal con la APK vieja, un outbox que sube la venta
de ayer, el cobro de una cita desde otra caja: ninguno pasa por el TPV
nuevo.

`shift/apertura-automatica.ts` lo llaman los **tres** caminos de cobro de
una clínica, y no hay un cuarto:

- `agenda/checkout.ts` — «Cobrar en caja» sobre una cita. Es EL cobro de
  una consulta;
- `POST /tickets` — la venta suelta («unas plantillas, un spray») y el
  reintento del outbox con un turno que el servidor no conoce;
- `POST /tickets/:id/checkout` — el borrador de una cita abierto ayer y
  cobrado hoy, con el turno **cerrado a mano**. `resolveShiftForSale`
  sólo rescata los cierres del corte de día, así que un cierre manual
  dejaba a la clínica con un 409 sobre una visita que ya se hizo. Va
  DENTRO de la transacción del cobro.

El cobro de una **mesa** no lo llama a propósito: en una clínica no hay
mesas, y quien encienda las dos cosas quiere el flujo de hostelería.

### Qué es una clínica

`lib/vertical-clinica.ts`, y la pregunta sube ahí porque este bloque la
necesita en un segundo sitio. Era el `applies.clinicaDePodologia` que
clinica-8 (fase B) tuvo que escribir cuando el check del catálogo clínico
bloqueó la activación de **todas** las residencias:

```
clinicalRecordsEnabled === true && residenciaEnabled !== true
```

**Una residencia no es una clínica** aunque tenga la historia clínica
encendida (`residenciaEnabled` la enciende por diseño y hay un CHECK que
lo obliga). Una residencia tiene mostrador, relevo y turno.

No es `businessType`: una clínica es `SERVICES` igual que una peluquería,
y una peluquería SÍ abre turno. Lo que cambia el flujo de caja no es el
vertical comercial, es que la consulta no tiene mostrador.

### El fondo no es `cash_counted`

O no siempre. Desde v1.11 el cierre por defecto es **sin contar**
(`close-day`), así que en una clínica `cash_counted` va a ser NULL casi
todos los días. Leerlo a secas y caer a 0 pondría el fondo a cero cada
mañana con el dinero dentro del cajón, y el descuadre del cierre
siguiente sería exactamente lo que quedó ayer. **Un descuadre diario que
no significa nada enseña a no mirar los descuadres.**

Así que: lo contado si alguien contó; el **teórico** del cierre si no
—el mismo `computeZBreakdown` que le enseñó el resumen al cerrar, no una
fórmula paralela—; y cero si no hay ningún cierre. Nunca negativo.

### El rastro: `shifts.open_reason`

Hermano exacto de `close_reason`, y por la misma razón: `user_id` dice
QUIÉN y esto dice POR QUÉ. Existe por algo concreto y no por simetría: si
al cierre hay descuadre, lo primero que hay que poder saber es **si
alguien contó el cajón esa mañana**. Sin esta columna, el Z de una
clínica y el de un bar dicen lo mismo y no es verdad.

Y es una columna y no una línea de log porque la pregunta se hace en el
cierre, meses después: un log de hace tres meses no está; la fila del
turno sí.

### El TPV

En clínica, `needsShiftOpen` → **no sale la pantalla**. La tarjeta del
resumen del día anterior **sí sigue saliendo** (el cierre del día no
cambia); lo que se va es el paso siguiente.

El TPV abre su turno **en local** con el fondo que dice el servidor
(`GET /shift/current` → `fondoSugerido`, la misma función
`fondoDelUltimoCierre`) y se va derecho a la agenda. El id real lo adopta
después del primer cobro (`GET /shift/current` sobre el evento `sent` del
outbox, que es el único sitio por el que pasan los tres caminos de
cobro).

Se reutiliza la maquinaria de turno local de v1.10-offline tal cual: un
turno con `localId` y `serverId: null`, los tickets llevando el `localId`
como `shiftId`, y el outbox reescribiéndolos al saberse el id real. Lo
único distinto es quién avisa: allí era la respuesta del `POST
/shift/open` encolado, aquí es el `GET /shift/current` de después del
cobro, porque **no hay ningún `shift-open` que encolar** — encolarlo
sería abrir el turno al entrar, y hay un test que lo vigila.

### El día que el cobro no llega a salir

Hay un camino que no pasa por el evento `sent` del outbox: **la podóloga
abre el cobro de una cita y no lo termina** —la paciente paga otro día, o
va con bono—. Ahí el servidor SÍ tiene turno (lo abrió el borrador) y el
TPV sigue con su id local, así que «Cerrar turno» pediría
`/shift/<localId>/close-day` y recibiría un 404: no podría cerrar su
propio día.

Se cierra con una llamada en `CloseShiftModal`, que es el único sitio por
el que se entra a hablar del turno con el servidor. No hace nada —ni
red— si el turno local ya está resuelto o si nació del servidor, que es
el caso de los catorce comercios sin clínica.

Y `adoptarTurnoDelServidor` fija el `serverId` **él mismo** además de
avisar por el callback del outbox: si dependiera sólo del callback, un
remonte de `App` a destiempo dejaría el turno local sin resolver. Las dos
escrituras son idempotentes.

### Un arreglo de paso, declarado

`registerShiftResolvedCallback` llamaba sólo a `resolveLocalShift`, que
fija el `serverId` en IndexedDB. Pero el `shiftId` que `App` le pasa a la
venta, al cierre y al arqueo vive en el estado de React y se quedaba con
el `localId`. **Eso ya estaba roto antes de este bloque** en el camino
offline: abrir turno sin red, volver la red y cerrar el turno en la MISMA
sesión pedía `/shift/<localId>/close-day` y recibía un 404. En una
clínica pasaría todos los días, así que se arregla donde vive el estado.

---

## 3 · El cajero técnico sólo existe con Holded

`test-cashier-provisioned` pasa de `requires: "caja"` a
`requires: "cajaConHolded"`. Es la decisión de Matías del 28-10, de las
que el prompt marca como no re-debatibles, y está implementada tal cual.

### Pero la premisa que la justificaba no es cierta, y hay que decirlo

El prompt dice «el cajero técnico solo existe con Holded». **No es
verdad**, y lo destapó el e2e `catalogo-en-alta.e2e.ts`, que recorre
exactamente este caso: un bar sin Holded y con caja. Ahí el implantador
pulsa «Probar TPV», `issueTestCashierSession` llama a
`provisionTestCashier` y el cajero técnico aparece sin que exista Holded
por ningún sitio (§0.3).

Así que lo que se quita no es un check imposible de cumplir: es un
**peaje que obligaba al implantador a probar el TPV antes de activar un
comercio sin Holded**. Con el cambio, una cuenta de catálogo local pasa a
`ready` en cuanto tiene catálogo, y se puede activar sin que nadie haya
hecho una venta de ensayo.

Lo que sigue siendo verdad del argumento: en una cuenta **que nunca va a
pulsar «Probar TPV»** —se activa desde otro sitio, o el implantador no
sabe que existe el botón— el check se queda en rojo sin que nada lo
explique, y un check en rojo que no es un fallo enseña a desconfiar de
todos los checks.

**Qué hacer con esto:** es una decisión de producto, no de código. Si lo
que se quería era quitar el ruido pero conservar el peaje, el arreglo no
es `applies: false` sino cambiar el `label` y el `value` del check para
que digan «pulsa Probar TPV» — y eso es otro bloque. Queda aquí escrito
para que se decida con el dato delante, porque el bloque que viene
(`cogecop-1`) corre contra producción.

El cambio se hizo con el argumento con el que catalogo-local (addendum 3)
mudó `taxes-ratio` de `caja` a `holded`, y la diferencia entre los dos
casos es justo ésta: `TenantTax` **de verdad** tiene cero filas sin
Holded, por definición, y no hay botón que lo arregle.

### Lo que cambia en el e2e

`catalogo-en-alta.e2e.ts` era el fichero que documentaba el peaje («la
activación está bloqueada por DOS cosas»). Se actualiza a lo que ahora
pasa —bloquea una, el catálogo— y se deja escrito dentro por qué, con el
assert que demuestra que el cajero técnico se provisiona sin Holded.


### Decisión tomada sin preguntar

El prompt dice «ni verde ni rojo: no sale». Se usa `applies: false`, que
es el mecanismo que H1 montó y que clinica-8 ya usa: la fila sale en gris
con **«No aplica · sólo con caja y Holded»** y no cuenta para `ready`.
No desaparece del listado, y es a propósito: una fila que se esfuma deja
al implantador preguntándose dónde está el check del cajero técnico.
«Ni verde ni rojo» se cumple; el motivo se dice.

---

## 4 · La barra de la agenda a 390 px

pin-1 dejó medido que no cabía y no lo arregló. Medido otra vez el 29-10
**en el navegador y no a ojo** (banco visual + Chromium, script en el
scratchpad):

| pantalla | ancho | contenido | qué se salía |
|---|---|---|---|
| `agenda` | 390 | **547** | Vista (Día\|Semana) **y** Dar cita |
| `agenda-sanitaria` | 390 | **599** | Vista **y** Dar cita |

Lo que el prompt no sabía: **lo que se salía no era sólo «Dar cita»**.
Detrás se iba el conmutador Día | Semana, que es el único modo de llegar
a la vista de semana.

### Por qué envuelve y no se encoge

Hacerlo caber en una fila pedía recortar 157 px de cinco controles a la
vez: el rótulo de la fecha a «jue 29», el conmutador a dos iconos y los
botones a 36 px. Tres cosas ilegibles para que quepa una.

Lo que se hace es dejar que exista una **segunda fila** por debajo de
`md`: la barra pasa a `flex-wrap`, el rótulo de la fecha se queda entero
en la primera y lo que no cabe baja a la segunda, donde sobran píxeles.

### Y a 1280×800 no cambia nada

Condición del prompt, y comprobada midiendo **antes y después** con el
mismo script (`git stash` de por medio):

```
diff antes.json despues.json (sólo las entradas de 1280×800)
→ IDÉNTICO
```

`md:flex-nowrap` devuelve la fila única, `md:h-[72px]` la altura exacta y
el separador elástico (`hidden md:block md:flex-1`) vuelve a ser el que
empuja «Dar cita» a la derecha. La Lenovo del mostrador ve la misma barra
que ayer.

### Un solo DOM

Nada se pinta dos veces con un `hidden` encima. Eso dejaría dos nodos con
`data-test="dar-cita"` y el primero que encontrase el banco —y el
`querySelector` del bucle visual— sería el invisible. Hay un test que
cuenta que sólo hay uno.

### Lo medido después

| pantalla | ancho | barra | fuera | overflow del body |
|---|---|---|---|---|
| `agenda` | 390×844 | 141 px alto, 2 filas | — | no |
| `agenda-sanitaria` | 390×844 | 141 px alto, 2 filas | — | no |
| `agenda` | 1280×800 | 72 px, 1 fila | — | no |
| `agenda-sanitaria` | 1280×800 | 72 px, 1 fila | — | no |

Lo que cuesta: 77 px de alto a 390. La rejilla del día pasa de 780 a 703
y **scrollea**, así que no se pierde nada; lo que se gana es que los
cinco controles se puedan tocar.

Capturas en `docs/blocks/clinica-11-shots/`.

---

## 5 · Tabla de sabotajes

Cada uno aplicado al código, el **fichero entero** corrido (nunca `-t`),
visto en rojo y restaurado con `git checkout --`.

| # | sabotaje | fichero que se pone rojo | caen |
|---|---|---|---|
| 1 | `limpiarEvento` deja de borrar `request.data` | `sentry-limpio.test.ts` · `clinica-11-sentry.test.ts` (api) | 2 · 1 |
| 2 | la lista blanca de cabeceras deja pasar todas | `sentry-limpio.test.ts` | 2 |
| 3 | `limpiarUsuario` devuelve el usuario entero | `sentry-limpio.test.ts` | 3 |
| 4 | `limpiarMapa` deja pasar los objetos | `sentry-limpio.test.ts` | 2 |
| 5 | las claves de ruta no se recortan | `sentry-limpio.test.ts` · `clinica-11-sentry.test.ts` (api) | 4 · 1 |
| 6 | API · se quita `beforeSend` | `clinica-11-sentry.test.ts` | 2 |
| 7 | API · se quita `dataCollection` entero | `clinica-11-sentry.test.ts` | 1 |
| 8 | API · se quita la `requestDataIntegration` declarada | `clinica-11-sentry.test.ts` | 2 |
| 9 | API · `initSentry` deja de usar `opcionesDeSentry` | `clinica-11-sentry.test.ts` | 1 |
| 10 | TPV · se quita `beforeSend` | `clinica-11-sentry.test.tsx` (tpv) | 1 |
| 11 | TPV · se quita `beforeBreadcrumb` | `clinica-11-sentry.test.tsx` (tpv) | 1 |
| 12 | TPV · el filtro de Replay deja de filtrar | `clinica-11-sentry.test.tsx` (tpv) | 1 |
| 13 | panel · se quita `beforeSend` | `clinica-11-sentry.test.tsx` (admin) | 1 |
| 14 | panel · se quita `beforeBreadcrumb` | `clinica-11-sentry.test.tsx` (admin) | 1 |
| 15 | panel · el filtro de Replay deja de filtrar | `clinica-11-sentry.test.tsx` (admin) | 1 |
| 16 | `esVerticalClinica` sin el `residenciaEnabled !== true` | `clinica-11-turno-automatico` · `tickets-route` · `clinica-8-catalogo-clinico` | 2 · 1 · 1 |
| 17 | se quita el `openReason: "AUTO_CLINICA"` | `clinica-11-turno-automatico` · `tickets-route` | 2 · 1 |
| 18 | el fondo pasa a ser `cashCounted ?? 0` | `clinica-11-turno-automatico` | 1 |
| 19 | el fondo puede ser negativo | `clinica-11-turno-automatico` | 1 |
| 20 | la apertura deja de ser idempotente | `clinica-11-turno-automatico` | 1 |
| 21 | `agenda/checkout` vuelve al 409 para todos | `clinica-11-turno-automatico` | 1 |
| 22 | `POST /tickets` pierde la rama de la clínica | `tickets-route` | 1 |
| 23 | el check del cajero vuelve a `requires: "caja"` | `h1-salud-modulos` | 2 |
| 24 | TPV · el flag de clínica se ignora y sale «Abrir turno» | `clinica-11-sin-abrir-turno` | 2 |
| 25 | TPV · la clínica encola un `POST /shift/open` | `clinica-11-sin-abrir-turno` | 1 |
| 26 | la barra pierde `flex-wrap` | `pin-1-agenda-mi-pin` | 1 |
| 27 | la barra pierde `md:flex-nowrap` | `pin-1-agenda-mi-pin` | 1 |
| 28 | el separador elástico vuelve a las dos filas | `pin-1-agenda-mi-pin` | 1 |
| 29 | «Dar cita» se pinta dos veces (una por fila) | `pin-1-agenda-mi-pin` | 1 |
| 30 | la migración deja la columna sin `DEFAULT` | `clinica-11-migracion` | 1 |
| 31 | `adoptarTurnoDelServidor` no resuelve el turno local | `clinica-11-sin-abrir-turno` | 1 |
| 32 | `adoptarTurnoDelServidor` pregunta aunque el turno esté resuelto | `clinica-11-sin-abrir-turno` | 2 |

Los mínimos que pedía el prompt, y dónde están:

- el centinela no llega a Sentry desde la API por el **cuerpo** (#1, #4,
  #6, #7, #8), por la **query** (#5, #6) ni por el **error** (el mensaje
  sí llega, y es a propósito — ver §7);
- ni desde el TPV por **breadcrumb** (#11) ni por **URL** (#10);
- el primer cobro del día en clínica abre turno solo (#21, #22) y en
  hostelería no (los dos sabotajes caen por el lado contrario: el test
  tiene las dos mitades en el mismo fichero);
- el check no sale sin Holded (#23).

---

## 6 · Cómo queda la suite

```
pnpm test   →  508 ficheros · 7.567 tests · 10 saltados · 0 rojos
                (base de partida: 501 · 7.493)
```

Ficheros nuevos:

| fichero | tests |
|---|---|
| `packages/sentry-limpio/test/sentry-limpio.test.ts` | 22 |
| `apps/api/test/clinica-11-sentry.test.ts` | 8 |
| `apps/api/test/clinica-11-turno-automatico.test.ts` | 16 |
| `apps/api/test/clinica-11-migracion.test.ts` | 7 |
| `apps/tpv-web/test/clinica-11-sentry.test.tsx` | 4 |
| `apps/tpv-web/test/clinica-11-sin-abrir-turno.test.tsx` | 4 |
| `apps/admin/test/clinica-11-sentry.test.tsx` | 3 |

Y bancos que crecen en vez de nacer, porque el arnés ya estaba y la
pregunta es la misma: `tickets-route` (+2, el cobro de una clínica y el
de una residencia por la ruta de verdad), `h1-salud-modulos` (+4, el
cajero técnico) y `pin-1-agenda-mi-pin` (+3, la barra que ese mismo
fichero dejó medida y sin arreglar).

### Dos inventarios que había que ampliar

1. **`infra/test/dockerfile-manifiestos.test.ts`** se puso rojo solo al
   añadir el paquete: sin `COPY packages/sentry-limpio/package.json` el
   `pnpm install --frozen-lockfile` de la imagen falla antes de empezar.
   Mismo olvido que escpos-builder en v1.9.4 y verifactu en verifactu-1.
   El test existe justo para esto y funcionó.
2. **`vitest.workspace.ts`** — el proyecto del paquete nuevo.

### El e2e

```
E2E_DATABASE_URL=…/mipiacetpv_e2e_clinica11 pnpm test:e2e
   →  53 ficheros · 1.249 tests · 0 rojos
```

Corre contra Postgres de verdad, así que **la migración se aplicó de
verdad** (`prisma migrate deploy` desde cero, con las 105 de la casa).

Un fichero cambia: `catalogo-en-alta.e2e.ts`, por lo del §3. Es el que
destapó que la premisa del prompt sobre el cajero técnico no era cierta,
y el que documentaba el peaje que se quita. Se actualiza con el porqué
dentro y con un assert nuevo que deja escrito que **«Probar TPV»
provisiona el cajero sin Holded**.

### Un doble de Prisma que había que ampliar

`tickets-route.test.ts` daba 500 en vez de 409 porque `POST /tickets`
pasa a preguntar `tenant.findUnique` en el camino del turno que no está
abierto, y ese doble sólo tenía `findUniqueOrThrow`. Se le añade el
método declarando lo que describe: **el comercio de siempre, sin historia
clínica**, para que el 409 que ese fichero guarda siga significando lo
mismo.

---

## 7 · Límites conocidos, dichos

1. **El mensaje de una excepción NO se filtra, y es deliberado.** No hay
   forma de saber qué trozo de una cadena es un nombre, y recortarlo
   dejaría Sentry sin servir para nada. Lo que lo arregla es no
   concatenar valores al lanzar, y eso se auditó (§0). Hay un caso
   conocido en el que un mensaje de V8 sí trae el claro dentro: el
   `SyntaxError` de `JSON.parse` sobre un valor clínico descifrado. Ese
   error **se captura y no se propaga** (`leerJson` de
   `cripto-campos.ts`), y `aviso-de-ilegible.ts` clasifica por TIPO y
   nunca por `err.message` — residencia-6 ya lo dejó escrito. Si alguna
   vez un camino nuevo lo dejara subir, este bloque no lo pararía.
2. **La ventana de carrera de la apertura automática.** Entre el
   `findFirst` y el `create` caben dos cobros EXACTAMENTE simultáneos
   desde dos cajas sobre el mismo `register`. Se acepta declarada: es la
   MISMA ventana que `POST /shift/open` tiene desde B3, y en una consulta
   hay un terminal y una persona. Cerrarla costaría un índice único
   parcial sobre `(register_id) WHERE closed_at IS NULL`, que rompería el
   caso legítimo de dos turnos abiertos que la casa ya tiene (el colgado
   de ayer mientras se abre el de hoy).
3. **Los tests de la barra son de clases, no de píxeles.** jsdom no hace
   layout. Las medidas de verdad son las de §4 y las capturas.
4. **El `fondoSugerido` sin red.** Si el TPV de una clínica arranca sin
   conexión, el turno local nace con el fondo del turno local anterior (o
   0). El servidor pone el bueno cuando abre el turno de verdad; lo único
   que puede quedar corto es el teórico de un arqueo **offline** de ese
   día.
5. **El implantador ya no está obligado a probar el TPV** antes de
   activar un comercio sin Holded (§3). Es la consecuencia de la decisión
   del prompt, no un efecto que se nos haya escapado, y está escrita aquí
   y dentro del e2e para que se pueda revertir en una línea
   (`requires: "caja"`) el día que se decida lo contrario.

---

## 8 · Lo que NO entra (del prompt, y se respeta)

- Pie de riesgo (H9), textos de consentimiento (H10) y niveles de
  quiropodia: dependen de lo que conteste Rosario.
- La lista de lesiones y el importador: van en `cogecop-1`.
- Cambiar de proveedor de errores o autoalojarlo.

Y una que no estaba en el prompt y tampoco entra: **no se toca el cobro
de mesa** (`tables/operativa.ts`). En una clínica no hay mesas.

---

## 9 · Al desplegar

### Migración

**Una, y aditiva.**
`packages/db/prisma/migrations/20261029000000_clinica_11_apertura_automatica`

```sql
CREATE TYPE "ShiftOpenReason" AS ENUM ('MANUAL', 'AUTO_CLINICA');
ALTER TABLE "shifts"
  ADD COLUMN "open_reason" "ShiftOpenReason" NOT NULL DEFAULT 'MANUAL';
```

- `ADD COLUMN … DEFAULT` en Postgres 11+ **no reescribe la tabla**: no
  hay ventana de bloqueo sobre `shifts`.
- Los turnos que ya existen se quedan en `MANUAL`, que es la verdad:
  todos los abrió una persona declarando un fondo de caja.
- No hay backfill, ni DROP, ni UPDATE, ni triggers que apagar. Hay un
  test que lo guarda (`clinica-11-migracion.test.ts`).

### APK

**Sí, hace falta una nueva.** El TPV cambia en tres sitios (el `init` de
Sentry, el turno de la clínica y la barra de la agenda) y la APK lleva el
bundle dentro (`infra/test/bundle-android.test.ts`). La web del TPV se
actualiza sola con el despliegue; las tablets no.

Mientras no se instale, un terminal con la APK vieja en una clínica
**sigue cobrando**: le sale la pantalla de «Abrir turno» de siempre y el
turno lo abre él. La invariante del servidor no le estorba.

### Qué comprobar en Sentry después de desplegar

Con un error provocado a propósito en PRUEBAS (no en la cuenta de
Rosario), mirando el evento en la interfaz de Sentry:

1. **No hay sección «Request Body»** en el evento. Si la hay, la capa 1
   no se aplicó (mirar que el proceso arrancó con el código nuevo:
   `release` = sha del despliegue).
2. **«Request Headers» tiene ocho entradas como mucho** y ninguna es
   `authorization`, `cookie` ni `x-device-token`.
3. **La URL del evento lleva `:id`** donde iba un uuid, y **no lleva
   query**. Es la comprobación que cubre el camino que de verdad
   filtraba (§0.2): mirar también `extra.url`.
4. **«User» tiene `id` y `tenantId` y nada más** — ni email, ni
   `ip_address`.
5. En un evento del **TPV**: la lista de breadcrumbs **no tiene ninguno
   de categoría `ui.click`, `ui.input` ni `console`**, y los de `fetch`
   llevan la ruta con `:id`.
6. En **Settings → Integrations** del proyecto, o en el propio evento
   (`sdk.integrations`): **`Replay` no está** en el TPV ni en el panel.

### Y qué mirar en el log de la API

La primera mañana de la clínica, buscar la línea:

```
event: shift.auto_open_clinica
```

Trae `shiftId`, `registerId`, `userId` y `cashOpening`. Debe aparecer
**una vez al día y sólo el día que se cobra**. Si aparece dos veces el
mismo día es la carrera del §7.2 y hay dos turnos abiertos: se cierra uno
a mano.

Y en la base, el día después del primer cierre:

```sql
SELECT open_reason, close_reason, cash_opening, cash_counted
FROM shifts WHERE register_id = '<la caja de Rosario>'
ORDER BY opened_at DESC LIMIT 3;
```

El de hoy tiene que llevar `open_reason = AUTO_CLINICA` y un
`cash_opening` igual a lo que dejó el cierre anterior.

### Orden

1. Migrar (aditiva: se puede aplicar con la versión vieja corriendo).
2. Desplegar API + panel + web del TPV.
3. Comprobar los seis puntos de Sentry.
4. Publicar la APK e instalarla en el terminal de Rosario.
5. **Sólo entonces** correr `cogecop-1` contra producción.
