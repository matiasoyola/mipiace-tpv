# Bloque agenda-lista · done

Lo que faltaba para encender la agenda en casa de Sole. Rama `agenda-lista`,
worktree `~/Developer/Claude/Projects/mipiacetpv-agenda-lista`, desde `master`
= `d362c4f`.

Arregla **cuatro** de los hallazgos que dejó `agenda-banco` (🟡 1, 🟡 4, 🟡 6 y
🟡 3 + ⚪ 7) y deja el banco como red de cada uno: cada arreglo tiene su spec en
verde y su sabotaje que lo pone rojo.

---

## 1 · La agenda conoce los nombres sin pasar por Clientes (🟡 1)

**El fallo.** El nombre de cada tarjeta sale de la caché local
(`loadClientsFromCache`) y esa caché la llenaba **sólo** la pantalla Clientes.
En un dispositivo recién emparejado —el AP11 el primer día— la rejilla decía
«09:00 · Sin nombre» en todas las citas hasta que a alguien se le ocurría abrir
Clientes una vez.

**Lo que se hizo.** Al abrir la agenda, `asegurarClientesEnCache()`
(`apps/tpv-web/src/lib/clients.ts`). Reutiliza `refreshClients()` —la **misma**
función de la pantalla Clientes, con su mezcla de altas offline— en vez de
duplicar la llamada.

- La **decisión** va aparte y es pura (`necesitaRefrescoDeClientes`): caché
  vacío → siempre sí (el dispositivo recién emparejado); caché lleno sin marca
  de sincronización → sí, una vez (la marca nació en este bloque, así que un
  TPV que viene de la versión anterior tiene caché y no tiene marca); caché
  lleno y dentro de la ventana → no.
- La ventana es **15 minutos**, y conviene decir contra qué: la agenda se abre
  decenas de veces en un turno y `refreshClients()` se baja el tenant entero
  paginando. Refrescar en cada apertura castigaría al WiFi del local sin ganar
  casi nada —una ficha dada de alta en ESTE dispositivo ya entra en la caché
  por `upsertClientInCache`—; lo que la ventana cubre es la clienta que dio de
  alta otra persona desde otro mostrador hace un rato.
- Se pide **una vez al abrir**, no en cada `loadDay`: el selector de día
  dispara `loadDay` en cada toque.
- El repintado va por `refrescarCachesLocales`, que **mezcla y no reemplaza**
  (su comentario lo explica: una clienta recién elegida no puede volver a «Sin
  nombre» delante de ella).
- **Sin red** devuelve `false` y se queda con lo que haya. Una agenda que no
  abre porque no hay WiFi sería peor que algún «Sin nombre».
- Una marca de sincronización **en el futuro** (el reloj del AP12 movido hacia
  atrás) cuenta como vencida: si no, la caché se congelaría para siempre.
- `refreshClients(ahora)` recibe el instante por parámetro. Sellar con
  `Date.now()` mientras quien decide usa otro reloj hace que una caché recién
  bajada nazca vencida — pasó en el primer test.

**El spec.** `07 · la rejilla dice «Sin nombre» hasta que alguien abre
Clientes» pasa a decir lo contrario: `la agenda trae los nombres sin pasar por
Clientes`. Contexto nuevo (IndexedDB y localStorage vacíos, como un
emparejamiento de hace un rato) y **nadie abre Clientes en todo el test**.

---

## 2 · Mover una cita desde la agenda (🟡 6)

**El fallo.** La API lo soportaba (`PATCH /agenda/appointments/:id` con
`start`) y el cliente del TPV también (`patchAppointment`), pero la pantalla
sólo mandaba `status`. El único camino era cancelar y volver a dar la cita —
que **pierde el histórico de la original**.

**Lo que se hizo.** `MoverCita` dentro del detalle de la cita
(`AgendaPage.tsx`), con el **mismo** control que el alta: el `type="date"`
nativo para el día y «Buscar hueco» con sus chips de hora. Dos maneras de pedir
una hora en la misma pantalla serían dos cosas que aprender.

Cuatro cosas que hay que tener escritas:

- **Conserva la profesional.** La clienta cambia de HORA, no de peluquera. Ver
  §2b: es lo único de este bloque que toca el motor, y por qué no había otra.
- **El profesional NO se puede elegir al mover.** El cuerpo del PATCH sigue
  siendo `{ status?, start? }` y nada más. Cambiar de profesional al mover **va
  a la cola**, es otro bloque. No se ha inventado un selector que no tendría
  dónde ir.
- **Si falla no pasa nada.** `start` y `status` son ramas distintas del PATCH:
  un movimiento rechazado no mueve la cita ni le cambia el estado. El motivo y
  las alternativas son las que ya devuelve el motor, las mismas del alta y en
  el mismo sitio, pegadas a la hora.
- **No hay camino offline.** `patchAppointment` no encola. El botón lo dice
  («Hace falta conexión para mover una cita») en vez de prometer algo que no va
  a pasar. El motivo va en texto visible junto al botón, nunca en un `title`
  (`docs/ux-principles.md` §6).

La hoja **se pliega sola** al acabar: el trámite está hecho y lo que tiene que
verse es el detalle con su hora nueva. Lo destapó el banco — con la hoja
abierta y los chips del día viejo delante, lo que pide es mover dos veces la
misma cita.

**Arrastrar la tarjeta en la rejilla: no**, como pedía el prompt. Un detalle
claro con dedo de peluquera vale más que un arrastre que falla en el AP12.

**El spec.** `07 · mover una cita no se puede desde la agenda` se convierte en
`mover una cita: a otra hora, y de vuelta, con el mismo id`. Comprueba la
pantalla, la BD, que **el id no cambia** y que **la asignación sigue siendo de
Marta**. Más dos tests: que las horas que ofrece la hoja son las de SU
profesional, y que mover a un día cerrado da el motivo con su nombre sin tocar
la BD.

---

## 2b · Mover conserva la profesional

**Decisión de Dirección del 04-10, después de leer la primera versión de este
done.** Hasta aquí `reschedule` buscaba el hueco con `staffUserId: null`, así
que mover podía cambiar la cita de columna sin que nadie lo pidiera. En una
peluquería eso es otra cosa: la clienta cambia de hora, no de peluquera.

### El motor SE TOCA, y hay que decirlo

La regla del bloque era «`engine.ts` no se toca». Se toca, y es lo único:
`reschedule` gana un **cuarto parámetro opcional**, `staffUserId`.

No había otra forma. La firma no admitía profesional, y el fijado vive en dos
sitios dentro del motor (`AvailabilityParams.staffUserId` y el `fixed` de
`planForStart`): desde la ruta no se puede alcanzar ninguno. Lo que **no** se
hizo fue tocar esa lógica — el parámetro alimenta el mecanismo que ya usaba el
alta slot-first, y **omitirlo deja el comportamiento anterior intacto**. Es
aditivo de verdad: ningún otro llamante cambia.

Se descartó resolverlo sólo en la ruta (comprobar disponibilidad con ella antes
de llamar) porque no garantiza nada: aunque esté libre, el `planForStart` sin
fijar puede elegir a otra, y una invariante que «casi siempre» se cumple no es
una invariante.

### Dónde vive la decisión

**En la ruta, no en el motor.** El PATCH lee la asignación `STAFF` de la cita y
la pasa; el motor se limita a obedecer a quien le fijen, igual que en el alta.
El cuerpo sigue sin aceptar `staffUserId`.

### Y las alternativas son SUYAS

La fijada viaja también a `computeSlots`, así que un «no» por ocupación ofrece
**las horas de ella**. Es lo que la cajera dice por teléfono: «con Marta no
puede ser, pero a las cinco sí».

La hoja del TPV busca huecos con su profesional por el mismo motivo: con `null`
enseñaría horas en las que está libre otra, y el «no» llegaría sobre una hora
que la pantalla acababa de ofrecer.

### Qué lo prueba

| Dónde | Qué |
|---|---|
| `agenda-suelo.e2e.ts` · 17 | mover no cambia de profesional: mismo id, misma asignación, y la otra profesional no gana ninguna |
| `agenda-suelo.e2e.ts` · 18 | si ELLA no cabe → `409 NO_SLOT`, alternativas suyas (ninguna es la hora ocupada) y la cita se queda donde estaba |
| `07 · mover una cita…` | la asignación activa en BD sigue siendo de Marta después de mover |
| `07 · los huecos que ofrece mover son los de SU profesional` | a las 12:30 Marta tiene las mechas y Lucía está libre y sabe teñir: esa hora **no** se ofrece |

De los cuatro, **el que de verdad muerde es el 18**. Con el fijado quitado, el
17 sigue en verde: en ese escenario el motor elige a Sole igual aunque no se
lo pidan, así que lo que fija es la invariante, no la detecta. El 18 sí, y por
eso es el que aparece en la tabla de sabotajes (§5, fila 7b). Lo mismo que
pasa con el `07 · mover una cita…`: la cita que mueve son las mechas, que sólo
hace Marta, así que su aserción de la asignación enuncia la regla y no la
caza.

### Lo que el banco NO puede probar de esto, dicho con precisión

**El «no» por hueco OCUPADO no se puede pedir desde esta pantalla.** Los chips
sólo ofrecen huecos libres, calculados con el mismo motor que luego mueve, así
que lo que se elige siempre cabe. Es exactamente la situación del `EXCLUDE` que
el §2 del done de `agenda-banco` ya dejó dicha: la interfaz no puede provocarlo
porque el motor no la deja llegar. Decir que el banco lo cubre sería mentir.

Ese caso —dos movimientos a la vez, el segundo pierde con `409 TAKEN` y la cita
se queda donde estaba— **sí está cubierto, en la API**:
`apps/api/test-e2e/agenda-carrera.e2e.ts`, casos 4 y 5.

**Y una consecuencia del motor que conviene saber**: `reschedule` carga la
ocupación del día **sin excluir la propia cita que mueve**, así que los chips
nunca ofrecen una hora que solape con donde está ahora. Mover una cita de 30
minutos de las 12:30 a las 12:45 no se puede. Eso sí se ha dejado como estaba:
el parámetro del §2b no lo toca, y arreglarlo es cambiar la lógica del motor,
no añadirle un argumento.

---

## 3 · Sólo los servicios que la profesional sabe hacer (🟡 4)

**El fallo.** `bookableServices` sólo filtraba por «es servicio y tiene
duración»: no cruzaba con la matriz. Se podía elegir «Mechas» en la columna de
Lucía, que no las hace, y el «no» llegaba al pulsar Reservar **hablando de
huecos**. La cajera veía que no había sitio con Lucía a ninguna hora del día y
no tenía forma de saber que el problema era otro.

**Lo que se hizo.** El cruce es puro y vive al lado de la matriz de la que sale
(`apps/tpv-web/src/lib/agenda-health.ts`): `indexarMatrizPorProfesional`,
`serviciosQueSabeHacer` y `noHaceNingunServicio`. `AgendaPage` lee la matriz al
abrir la agenda y al volver de tocarla.

- **Con profesional** (alta en su columna): sólo lo que ella hace.
- **Sin profesional** (alta desde «primer hueco libre»): todos, y el motor
  elige a quien sabe. Eso no cambia.
- **Sin matriz** (no llegó, o no hay red): todos. Inventarse un «no» por una
  lectura que falló sería peor que el fallo que esto arregla, y el motor sigue
  siendo la puerta de verdad.
- El índice se construye partiendo del **personal** y no de los servicios:
  quien no da ninguno tiene que existir en el mapa con el conjunto vacío,
  porque «no sabe hacer nada» y «no sé nada de ella» son dos mensajes distintos
  en la pantalla.
- **Si no hace ninguno**, el panel lo dice con su nombre y manda a la matriz —
  con botón si esta sesión la puede tocar, y diciendo quién lo arregla si no
  (`canConfigure` exige OWNER o MANAGER: es el hallazgo 🟡 5, que sigue fuera de
  alcance).
- Una lista vacía deja de ser una frase para tres causas: no hay servicios con
  duración, no hace ninguno, o no hay ninguno que pueda hacer.

**El spec.** `06 · el no de quien no sabe` pasa de «el mensaje habla de huecos»
a `Lucía y las mechas ni se ofrecen`: en su columna las mechas no están en la
lista, y en la de Marta sí — lo que filtra es la matriz, no el catálogo. El
«no» por matriz ya no se puede producir desde la pantalla.

---

## 4 · La dueña llega a «Ajustes», y ve que se ha encendido (🟡 3 y ⚪ 7)

### La decisión sobre Ajustes

**Se miró antes de tocar, y el prompt tenía mal el origen.** `superAdminOnly`
no lo puso H1 ni «Dejar Holded»: los dos reescribieron esa línea para añadirle
la capability y por eso el `git blame` señala ahí. La historia real
(`git log -L 211,211:apps/admin/src/AdminShell.tsx`):

| Commit | Qué dejó |
|---|---|
| `bb9bb00` · B6 «ajustes tenant» | nace la entrada con `ownerOnly: true` — **la dueña sí la veía** |
| `850063e` · B-OnboardingV2 | `ownerOnly` → **`superAdminOnly`** ← aquí |
| `da3916c` · H1 | sólo añade `capability: "caja"` |

La razón, del propio mensaje de `850063e`: *«AdminShell oculta secciones
técnicas (Holded, Dispositivos, Ajustes) a OWNER/MANAGER; sólo visibles a
super-admin impersonando»*. Alta supervisada: el panel del propietario tenía
que quedar «sin complejidad técnica». Precedente importante: **esa
clasificación ya se echó atrás una vez** — `v1.3-piloto-feedback` devolvió
Dispositivos al OWNER y el comentario del código lo llama «un error histórico».

**Qué hay dentro** (`SettingsPage.tsx`, 6 secciones): Cajeros (auto-logout, TTL
de sesión, buscar contactos en Holded, fiado) · **Módulos del negocio**
(`crmEnabled`, **`agendaEnabled`** ← el interruptor) · Cierre del día (hora del
corte, obligar a cuadrar) · Seguridad (PIN de encargado, sólo OWNER cierra
caja, email de dispositivo nuevo) · Ventas (umbral de descuento) · Declaración
responsable (enlace al art. 15). Todas menos las dos últimas cuelgan de
`cajaEnabled` **dentro** de la pantalla.

**No hay nada técnico ni de super-admin ahí dentro.** Son decisiones de negocio
y el servidor ya dice de quién son: `GET /admin/tenant/settings` es
`requireOwnerOrManager` y el `POST` es **`requireOwner`**. El único campo de
verdad comercial —`cajaEnabled`— ya está protegido donde toca: es de sólo
lectura y el `POST` lo rechaza con 400 por `additionalProperties: false`
(`tenant-settings.ts:89,118`).

**Decisión: la entrada se queda SIN ninguno de los dos flags.**

```ts
{ to: "/admin/settings", label: "Ajustes", icon: Settings },
```

- **Fuera `superAdminOnly`**: no había que separar nada, porque no hay nada que
  esconder por rol. OWNER ve y edita; MANAGER ve en gris con su tooltip («Sólo
  el propietario puede modificar este valor»). Es la misma escalera que impone
  el servidor. Se descartó volver a `ownerOnly` —el B6 original— porque el
  `GET` abre a MANAGER **a propósito** y la página tiene el aviso hecho para
  ese caso: esconderlo sería la tercera capa en desacuerdo con las otras dos.
- **Fuera `capability: "caja"`**, y esto es un fallo distinto y anterior a este
  bloque. Lo dice el propio commit de H1: *«Ajustes NO va envuelto a propósito:
  dentro vive "Módulos del negocio" (CRM y agenda), que es justo lo que una
  empresa sin caja viene a tocar»*. La pantalla lo cumplía —esa sección y la
  declaración responsable quedan fuera de su gate— pero **el menú la tapaba
  entera**, así que un tenant SERVICES sin caja no llegaba a su único ajuste
  útil. A Sole no le mordía (su peluquería tiene caja), pero **esto también
  arregla el acceso de las empresas sin caja**, que es para lo que H1 se
  escribió.

El super-admin impersonando la sigue viendo igual. Riesgo de escritura:
ninguno — el único campo peligroso ya está bloqueado en el esquema del `POST`.

**El test de H1 se adapta, no se borra.** `h1-panel-sin-caja.test.tsx` no
tocaba el menú (mockea el shell entero), así que gana lo que le faltaba: que la
empresa **sin caja SÍ ve Ajustes** y que dentro sólo ve «Módulos del negocio» y
la declaración responsable, con la razón escrita en el fichero y citando el
commit de H1.

### El menú gana sus secciones sin recargar

`useTenantCapabilities` sale de `AdminShell` a `apps/admin/src/capabilities.ts`:
caché de módulo con suscriptores (`useSyncExternalStore`) y
`refrescarCapacidades()`, que llama Ajustes al guardar. La dueña enciende la
agenda y la barra lateral gana «Personal», «Agenda · Catálogo» y «Agenda ·
Horario» **sin F5**. Lo mismo al apagarla.

- De paso, el shell y sus `NavList` comparten **una** petición en vez de un par
  cada uno.
- La caché se tira al quedarse sin suscritos: al navegar entre pantallas el
  shell se desmonta y se vuelve a montar (igual que antes), y un `logout` +
  `login` con otro tenant no hereda las capacidades del anterior.
- El refresco va **sin `await`**: el «Ajustes guardados.» ya está puesto y el
  guardado no depende de que el refresco salga bien.

### El panel de salud se entera de que lo han arreglado (⚪ 7)

La última foto deja de ser estado de la pantalla y pasa a vivir con oyentes en
`apps/tpv-web/src/lib/agenda-health.ts`. La miran con `useSyncExternalStore`
tanto el panel como el badge de la agenda, así que el refresco que **ya** pedía
`AgendaPage` al cerrar la matriz mueve ahora también al panel — antes seguía
diciendo 2 hasta pulsar «Actualizar». Y el panel vuelve a preguntar **al
recuperar el foco** (`visibilitychange` + `focus`, sin polling): el AP12 se
queda abierto en la agenda todo el día.

El spec `05 · la dueña lo arregla y el panel queda limpio` deja de comprobar el
hallazgo y comprueba el arreglo: la cifra baja sola, y «Actualizar» no se toca
en todo el test.

---

## 5 · La tabla de sabotajes

Cada uno: se rompe **una línea de producción**, se siembra, se pasa el banco
parando en el primer rojo (`-x`: sin eso un sabotaje del capítulo 1 arrastra 26
timeouts de 120 s) y se devuelve la línea a su sitio. Comprobados el
04-10-2026; el repo quedó limpio detrás de los seis.

| # | Lo que se rompe | Dónde | Qué se pone rojo | Con qué mensaje |
|---|---|---|---|---|
| 1 | **La agenda vuelve a esperar a Clientes** | `lib/clients.ts` · `asegurarClientesEnCache` → `return false` | `07 · la agenda trae los nombres sin pasar por Clientes` | `expect(locator).toBeVisible() failed · Error: element(s) not found` sobre `locator('[data-columna="…202"] [data-cita]').filter({ hasText: 'Rosa' })` |
| 2 | **Mover manda `status` en vez de `start`** | `AgendaPage.tsx` · `doMove` | `07 · mover una cita: a otra hora, y de vuelta, con el mismo id` | `expect(locator).toBeVisible() failed` sobre `locator('[data-cita="b20e7dee-…"]').filter({ hasText: '18:00' })` |
| 3 | **El alta deja de cruzar la matriz** | `AgendaPage.tsx` · `bookableServices = conDuracion` | `06 · el no de quien no sabe: Lucía y las mechas ni se ofrecen` | `expect(locator).toHaveCount(expected) failed · Expected: 0 · Received: 1` |
| 4 | **«Ajustes» vuelve a ser `superAdminOnly`** | `AdminShell.tsx:240` | `01 · el interruptor «Agenda de citas»` | `expect(locator).toBeVisible() failed · element(s) not found` sobre `getByRole('link', { name: 'Ajustes' })` |
| 5 | **Guardar no refresca las capacidades** | `SettingsPage.tsx` · sin `refrescarCapacidades()` | `01 · el interruptor «Agenda de citas»` | `expect(locator).toBeVisible() failed` sobre `getByRole('link', { name: 'Personal' })` |
| 6 | **La foto de salud no se actualiza** | `lib/agenda-health.ts` · `writeHealthSnapshot` sin `ultima = snapshot` | `05 · Marta ve el aviso, pero la matriz le sale en modo mirar` | `expect(locator).toHaveText(expected) failed · Expected: "2" · element(s) not found` sobre `[data-test="badge-salud"]` |
| 7a | **La hoja de mover ofrece huecos de cualquiera** | `AgendaPage.tsx` · `searchAvailability({ staffUserId: null })` | `07 · los huecos que ofrece mover son los de SU profesional` | `expect(received).not.toContain(expected) // indexOf` (las 12:30 aparecen en la lista) |
| 7b | **El PATCH deja de fijar la profesional** | `agenda/routes.ts` · `reschedule(…, null)` | **el banco se queda VERDE** · rojo en `agenda-suelo.e2e.ts · 18 · si ELLA no cabe` | `expected 200 to be 409` |

Los sabotajes 4 y 5 ponen rojo **el mismo spec** por razones distintas, y eso
está bien: el capítulo 1 es el camino entero de encender la agenda. El 4 no
deja llegar a Ajustes; el 5 deja llegar y guardar, pero el menú no cambia.

**El 7b deja el banco entero en verde, y la razón importa.** El fijado está en
dos capas que van siempre juntas: la pantalla pide los huecos de ella y la
ruta mueve fijando a ella. Desde la interfaz las dos son indistinguibles
mientras coincidan — romper sólo la de abajo no cambia nada de lo que se ve,
porque la de arriba sigue sin ofrecer una hora en la que ella no quepa. Lo que
sí lo caza es la API, donde se puede pedir directamente una hora que la
pantalla nunca ofrecería: `agenda-suelo.e2e.ts · 18`. Decir que el banco cubre
el fijado del servidor sería mentir.

Los cuatro primeros tienen además su gemelo sin navegador, y los tres hallazgos
que se prueban en unitario también:

| Sabotaje unitario | Spec que cae | Mensaje |
|---|---|---|
| `superAdminOnly` + `capability: "caja"` de vuelta en la línea 240 | 3 de `h1-panel-sin-caja.test.tsx` | `AssertionError: expected null not to be null` |
| `writeHealthSnapshot` sin avisar a los oyentes | `agenda-lista-salud-refresco` → `al volver de la matriz…` | `expected '2' to be '0'` |

### Lo que los sabotajes enseñaron

**Dos sabotajes de siete dejan el banco entero en verde** (el 6 en su primera
versión y el 7b), y en los dos casos por lo mismo: una comprobación de la
interfaz no alcanza a una capa que otra capa ya tapa. Conviene tenerlo escrito
en vez de descubrirlo el día que alguien borre la línea.

**Quitar el aviso a los oyentes de la foto de salud deja el banco ENTERO en
verde.** Es el mismo tipo de hallazgo que la promesa de la columna en el banco
anterior, y conviene entenderlo: `writeHealthSnapshot` actualiza `ultima` antes
de avisar, y `useSyncExternalStore` relee `getSnapshot` en **cualquier**
repintado. Al cerrar la matriz hay un segundo cambio de estado
(`setSkillsPorStaff`, del punto 3) que repinta el árbol y recoge la foto nueva
de rebote. O sea: por la interfaz, el aviso es **redundante** en ese camino
concreto — lo que sí cubre es el caso sin ese segundo repintado, y eso lo fija
el test unitario, que con ese sabotaje sí se pone rojo. Por eso en la tabla el
sabotaje nº 6 rompe `ultima = snapshot`, que es la línea de la que de verdad
depende la pantalla.

Dicho de otro modo: hay dos mecanismos solapados, como el fijado de profesional
duplicado de `engine.ts:207` y `:429`. No es un fallo, pero alguien podría
borrar el `for (const fn of oyentes) fn();` un día «porque no hace falta» y
sólo se quejaría el unitario.

---

## 6 · Lo que NO cubre este bloque

Fuera de alcance, declarado en el prompt y respetado:

- **La pausa de exposición del tinte** (🟡 2): necesita motor. Sigue partido en
  dos servicios, que es como se trabaja hoy.
- **El aviso de salud que una profesional no puede arreglar** (🟡 5):
  `canConfigure` exige OWNER o MANAGER (`routes.ts:792`). El punto 3 lo roza —
  cuando una profesional no hace ningún servicio, el panel manda a la matriz
  «a quien pueda configurarla»— pero el permiso no se toca.
- **El alta sin red que no cierra el trámite** (⚪ 8) y **las etiquetas sin
  `htmlFor` / el toast sin gancho** (⚪ 9).
- **Arrastrar citas en la rejilla.**
- **El motor** (`engine.ts`): **una línea de firma y dos de uso**, contadas en
  el §2b — el parámetro opcional que fija la profesional al mover. Nada más.
  El fijado duplicado de `:207` y `:429` sigue donde estaba, y la lógica de
  `planForStart` y `computeSlots` no se ha tocado.
- **Elegir profesional al mover**: a la cola. El PATCH no acepta
  `staffUserId`; lo único que hace es conservar la que la cita ya tenía.
- **El cobro de la cita** (capítulo 8) y **el cierre** (9) no cambian.

Y lo que no se ha podido hacer en esta sesión:

- **La prueba en hierro en el AP11.** No hay terminal conectado a esta máquina.
  La APK 1.20.0 está construida y comprobada **sobre el binario** (§7), pero el
  procedimiento de `project_pruebas_fisicas_ap11` —emparejar, encender la
  agenda desde el menú de la dueña, abrir la agenda sin pasar por Clientes, dar
  una cita, moverla —y ver que sigue siendo de la misma profesional— y el «no»
  de quien no sabe— **está pendiente**, y con él las capturas de `docs/qa/`.
- **La línea del frente B del tablero.** No hay ningún fichero de tablero en
  este repo (`docs/`, `docs/blocks/`, `docs/roadmap-master.md`: nada que lo
  sea). Si el tablero vive fuera del repo, lo actualiza Dirección con este
  done.

---

## 7 · La APK

**`mipiacetpv-1.20.0-12000.apk`**, construida con el procedimiento de siempre,
sin variarlo:

```bash
apps/tpv-android/scripts/build-release-apk.sh 1.20.0
```

| Dato | Valor |
|---|---|
| versionName | `1.20.0` |
| versionCode | `12000` (la fórmula del script: `MAJOR*10000 + MINOR*100 + PATCH`, igual que la 1.19.0 → 11900) |
| commit | `8692fea` (árbol limpio, sin `-dirty`) |
| tamaño | 9 160 239 bytes |
| SHA-256 | `c3ddbece75b3f20018b8c017b6d0b291649d4cbc2a1994210544139029436192` |
| sidecar | `apps/tpv-android/build-releases/mipiacetpv-1.20.0-12000.apk.sha256` |
| firma | `CN=mipiacetpv, O=mipiace, L=Madrid, C=ES` · SHA-256 del certificado `677d8620…05bfd6` |

**NO se publica**: eso lo hace Dirección tras el merge, con
`infra/publicar-apk.sh`.

### Comprobado sobre el binario, no sobre el build

El script ya aborta por su cuenta si falta la firma, si el backend de
producción no quedó embebido (A2), si hay Service Worker (A4) o si el origen
del WebView no es el bueno (A5/R5). Además, sobre el `.apk` ya construido:

| Qué | Cómo | Resultado |
|---|---|---|
| La versión que Android registra dentro | `aapt2 dump badging` | `versionCode='12000' versionName='1.20.0'`, `es.mipiace.tpv` |
| La huella coincide con su sidecar | `shasum -a 256 -c …sha256` | `OK` |
| El origen embebido | `unzip -p … assets/capacitor.config.json` | `androidScheme: https`, `hostname: mipiacetpv.com`, `allowMixedContent: false` |
| El backend de producción | `grep -F https://api.mipiacetpv.com` sobre `assets/public/assets/*.js` del APK | presente |
| Sin Service Worker (A4) | `sw.js` / `registerSW.js` dentro del APK | no están |
| El código de este bloque viaja dentro | `grep -F` de dos frases nuevas («Hace falta conexión para mover una cita», «no tiene ningún servicio asignado todavía») | presentes |

Se construyó **dos veces**: la primera salió de `271121b`, antes de que
Dirección pidiera el fijado al mover (§2b). Esa se tiró y se rehízo desde
`8692fea`, porque el bundle del TPV cambió — una APK con la versión nueva y el
comportamiento viejo dentro es exactamente el tipo de cosa que se descubre en
el bar.

**Una cosa que sale y no es un fallo**: el bundle contiene el literal
`http://localhost:3001`. Es el fallback de SSR de
`useStoreEventStream.ts:153` (`typeof window !== "undefined" ?
window.location.origin : "http://localhost:3001"`), código muerto dentro del
WebView, donde `window` existe siempre. **Ya estaba en la 1.19.0** (comprobado
descomprimiendo aquel APK), así que no es una regresión ni configuración de
laboratorio. Se deja apuntado para que nadie lo lea como el incidente del
04-09.

---

## 8 · Cómo se cierra

- [x] **`pnpm e2e:agenda` entero en verde dos veces seguidas** — 28 tests,
      ~2,0 min por pasada, en puertos propios (§9) y contra
      `mipiacetpv_agenda_banco_e2e`.
- [x] **La suite normal, verde** — 269 ficheros, 2 931 tests, 3 saltados.
- [x] **Lo que corre el job `ci`**, replicado en local: typecheck de la API, de
      los seis paquetes de su lista, de `tpv-web` y del admin (`tsc -b`),
      `pnpm test`, y las dos builds de Vite. El test de manifests de
      `infra/test` en verde (51 tests): este bloque **no añade paquete ni
      manifest nuevo**, así que no hace falta ningún `COPY` nuevo en
      `infra/Dockerfile`.
- [x] **El job `e2e`** — `E2E_DATABASE_URL=…/mipiacetpv_agenda_lista_e2e pnpm
      test:e2e`: 21 ficheros, 333 tests verdes (los dos nuevos del fijado al
      mover, §2b). Base **propia de esta sesión**:
      la suite hace `DROP SCHEMA public`.
- [x] **Tests unitarios de lo que se puede probar sin navegador**: la decisión
      de refrescar la caché de clientes y el rellenado
      (`agenda-lista-clientes-cache`, 10), el filtro por matriz
      (`agenda-lista-matriz-filtro`, 10), el refresco de capacidades del menú
      (`agenda-lista-menu-capacidades`, 6), el refresco del panel de salud
      (`agenda-lista-salud-refresco`, 4) y los 6 nuevos de
      `h1-panel-sin-caja`.
- [x] **La tabla de sabotajes** (§5), seis, con el repo limpio detrás.
- [x] **La APK 1.20.0** construida y comprobada sobre el binario (§7), **sin
      publicar**.
- [x] **El vídeo de mover una cita** (§10), fuera de git.
- [ ] **La prueba en hierro en el AP11** y sus capturas en `docs/qa/`:
      pendiente, no hay terminal en esta máquina (§6).

### Despliegue

**No hay migración.** Todo el bloque es de pantalla y de caché: ni una columna
nueva, ni un cambio de esquema, ni una ruta de API nueva. `packages/db/prisma`
está intacto.

Lo que sí hace falta para que Sole lo vea: **la APK 1.20.0 en el AP12** (el
bundle viaja dentro, A4) y un despliegue normal del admin para que la dueña
tenga la entrada de Ajustes en su menú.

---

## 9 · El banco, y por qué ahora tiene puertos

Esto no estaba en el prompt y salió al ir a lanzar el banco: **`:3001` y
`:5173` estaban ocupados por el worktree `mipiacetpv-catalogo-en-alta`**. Con
`reuseExistingServer: true` y los puertos clavados, Playwright habría
reutilizado esa API y ese admin, y el banco habría probado el código de otro
árbol contra la base de otro árbol — y puede salir **verde**. Antes de eso, el
seed habría hecho `TRUNCATE` de la base a la que apuntara el `.env` que
hubiera.

Tres redes, y ninguna cambia el camino de siempre:

1. **La guarda del seed se aprieta**: el nombre de la base tiene que
   **terminar** en `_e2e`, no sólo contener `banco`, `e2e` o `test` en alguna
   parte. La regla vieja dejaba pasar nombres de desarrollo normales
   (`mipiacetpv_test_cliente`, cualquier base de un piloto con «test» dentro).
   La misma guarda está ahora en `seed/stack.ts`, **antes** de crear la base y
   de migrarla: el seed ya se negaba, pero para entonces ya le habíamos hecho
   un `migrate deploy` a la base equivocada.
2. **Puertos propios**: `BANCO_API_PORT`, `BANCO_ADMIN_PORT`,
   `BANCO_TPV_PORT`. Con cualquiera de ellas puesta, `reuseExistingServer` pasa
   a `false` en los tres: el banco levanta los suyos o se cae con el conflicto
   en la cara. El proxy `/api` (y el `/ws` del TPV) del admin y del TPV sale de
   `MIPIACETPV_API_PROXY`, que la config del banco pone sola — estaba clavado a
   `127.0.0.1:3001`, y mover la API sin mover el proxy es la misma trampa por
   el otro lado.
3. **`seed/comprobar-stack.ts` como `globalSetup`**, que cubre el caso cómodo
   (puertos por defecto, reutilizando tu `pnpm dev`): entra con la dueña
   sembrada y exige que el tenant que contesta sea el del escenario. Un tenant
   con ese id sólo existe en la base del banco.

Así se lanzó este bloque:

```bash
BANCO_API_PORT=3101 BANCO_ADMIN_PORT=5273 BANCO_TPV_PORT=5274 pnpm e2e:agenda
```

### Dos trampas más, de esta pasada

- **`pnpm --filter X dev -- --port N` no cambia el puerto de Vite.** pnpm le
  pasa el `--` literal y Vite lo trata como argumento: «Port 5173 is in use,
  trying another one…» y el banco esperando 120 s en una URL vacía. El puerto
  va por `MIPIACETPV_DEV_PORT`, que lee el `vite.config.ts`, con `strictPort`
  para que no se deslice en silencio.
- **El Redis es compartido y la API de dev embebe los workers.** Con el
  `REDIS_URL` por defecto (db 0), esta API se puso a procesar los repeatables
  encolados por la otra sesión y los falló contra su propia base
  (`[catalog-incremental] … falló: No Tenant found`). El `apps/api/.env` de
  este worktree usa `redis://localhost:6379/4`. Las dos últimas pasadas del
  banco salieron sin una sola línea de ese ruido.

El `apps/api/.env` de este worktree **no se commitea** (`apps/api/.gitignore`
lo cubre; comprobado con `git check-ignore`).

---

## 10 · El vídeo

`agenda-mover-cita.mp4` — **11 s, 1080p a 25 fps, 661 KB**. Mover la cita de
Carmen de hora y devolverla a su sitio: es lo que se le va a enseñar a Sole.

Rodado con el banco (`BANCO_VIDEO=1`), con sus rótulos en español pintados por
el propio spec (la app no se toca). Son los capítulos 1 a 7 en modo vídeo —los
que hacen falta para llegar al estado del 7— y de ahí se saca el trozo del test
de mover, normalizado a 1080p con el mismo filtro lanczos de
`video/montar.sh`. Esa pasada en modo vídeo salió **24 tests verdes**, que de
paso es una tercera confirmación del banco a otro ritmo.

Se grabó dos veces, por lo mismo que la APK: el primer rodaje era de antes del
§2b y la hoja de mover enseñaba huecos de cualquiera. Un vídeo que enseña a
Sole algo que la app ya no hace es peor que no tener vídeo.

**No entra en git**, como el resto: vive en
`~/Developer/Claude/Projects/mipiacetpv-media/agenda/`.

De paso: el script `video` que este README y el done del banco ya citaban
**no existía** en el `package.json` de `apps/e2e-ui` (había que exportar
`BANCO_VIDEO=1` a mano). Se añade.

---

## 11 · Commits

| Hash | Qué |
|---|---|
| `a43ebf7` | Punto 4: la dueña llega a Ajustes (los dos flags fuera, con su razón), el menú gana sus secciones sin recargar, y el panel de salud se entera |
| `97cac76` | Punto 1, la librería: `asegurarClientesEnCache` y la decisión pura de refrescar |
| `c77b7b1` | Punto 3, la librería: el cruce con la matriz, puro y al lado de la matriz |
| `b2d8ac7` | Puntos 1, 2 y 3 en la pantalla, y los capítulos 6 y 7 del banco adaptados |
| `59f1c23` | El banco no puede correr contra la stack de otra sesión (guardas, puertos, comprobación) |
| `271121b` | La hoja de mover se pliega al acabar, y el banco en verde |
| `82c9a44` | El done del bloque |
| `8a88b5b` | Mover conserva la profesional (§2b): el parámetro del motor, el fijado en la ruta, y los dos casos de la API |
| `b0a08f1` | La sonda del test de «los huecos son los suyos» pasa a las 12:30 (a las 09:00 Lucía ni había entrado) |
| `8692fea` | El done cuenta el fijado y sus dos sabotajes |
| `d330af5` | La APK se rehace con el fijado dentro |

---

## 12 · La rama

Rama `agenda-lista` **pusheada**, y **PR #5 contra `master`**, abierto:
<https://github.com/matiasoyola/mipiace-tpv/pull/5>. El cuerpo del PR es este
mismo documento.

Ni merges, ni despliegues, ni publicar la APK: eso lo hace Dirección.

Lo que Dirección tiene delante para decidir, en una línea cada uno:

- **El motor se tocó** (§2b), con un parámetro opcional y aditivo. La regla
  del bloque decía que no; ahí está el porqué y lo que se descartó.
- **La APK 1.20.0 no está publicada** (§7) y su huella es
  `c3ddbece…436192`. `infra/publicar-apk.sh` la sube cuando toque.
- **Falta la pasada en hierro** en el AP11 (§6): ninguna máquina de esta
  sesión tenía terminal conectado (`adb devices`, vacío).
- **No hay fichero de tablero** en el repo ni en los proyectos hermanos — se
  buscó por `agenda-lista` en todo `~/Developer/Claude/Projects` y sólo
  aparece el prompt. La línea del frente B la pone Dirección donde viva el
  tablero.
