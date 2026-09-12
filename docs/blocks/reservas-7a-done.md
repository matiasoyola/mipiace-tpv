# Bloque B-reservas-7a · El horario del centro — DONE

Rama `reservas-7a-horario`, worktree `mipiacetpv-reservas-7a`, desde master **`4078655`**
(S1, B-5 y B-6a dentro). **Sin push ni deploy.**

**Último commit: `9ac158e`.**

| | |
|---|---|
| **Suite antes** | `181 ficheros · 1628 verdes · 3 saltados` · exit 0 |
| **Suite después** | `187 ficheros · 1746 verdes · 3 saltados` · exit 0 |
| **Tests nuevos** | **118** en `pnpm test` (+6 ficheros): 70 de API, 28 del TPV, 20 del admin. **Más 21 casos de e2e**, que corren en su propia suite |
| **Saltados** | **los mismos 3 de antes**: `describe.skip` de `super-admin.test.ts:566` (flujo legacy B-SuperAdmin). Este bloque no salta ni un test |
| **e2e** | `21/21` contra Postgres real, base propia `mipiacetpv_r7a_e2e` (borrada al terminar) |

---

## 1 · Lo que hay ahora

Hasta este bloque la disponibilidad salía **sólo de los turnos del personal**
(`store.getTemplateSlots` → `staff_shifts`). Si nadie definía turno, el centro no abría; si
alguien lo definía de par en par, el centro abría de par en par. Un festivo había que
bloquearlo a mano, día a día, con un `BookingBlock scope=CENTER` (§1.4 del cruce; el
invariante 13 estaba en ❌). Y la retícula era una constante de 15 minutos repetida en el
servidor y en el front, con Sole trabajando en franjas de 30.

Ahora la ventana de un profesional en una fecha es:

```
turno(profesional, fecha)                       ← store.getTemplateSlots, como antes
  ∩ horario_del_centro(fecha)                   ← NUEVO, en engine.ts::loadContext
      = el DÍA ESPECIAL si lo hay, y si no la SEMANA TIPO
  ∖ booking_blocks (CENTER | STAFF)              ← ya lo hacía staffFree()
  ∖ citas activas solapadas                      ← ya lo hacían occByStaff y el GiST
```

y la retícula del centro (15 o 30) entra por `EngineOptions`, al lado de `tz`.

**Un tenant que no configure nada se comporta EXACTAMENTE como master.** Los 846 tests de
B3, B4, B-5 y 6a siguen verdes **sin tocar ni una línea de ellos**, y el sabotaje 8 lo
demuestra al revés: hacer que "sin filas" signifique otra cosa pone **49 tests en rojo**.

---

## 2 · Decisiones tomadas sin preguntar, una a una

### 2.1 El recorte se aplica en `loadContext`, no en `templateCovers` ni en `candidateStarts`

El prompt lo sugería y lo tomo tal cual, con una razón que conviene dejar escrita:
`templateCovers` y `candidateStarts` son los **dos** consumidores de la plantilla, y son
justamente las dos mitades del **invariante 6** (las reglas se aplican igual al listar que
al reservar). Recortar en uno solo abriría la puerta a que dejaran de decir lo mismo.
Recortando **antes**, en `loadContext` (`engine.ts:196`), los dos ven una plantilla que ya
viene recortada y ninguno sabe que el centro tiene horario.

Coste: una consulta más por petición (`getCenterSchedule`), que va en el mismo
`Promise.all` que la de turnos.

### 2.2 `center_days` es una tabla, y no un `BookingBlock scope=CENTER`

Un bloqueo **sólo sabe cerrar**. El sábado de la boda hay que **abrir a las 8:30**, antes de
la hora normal, y eso un bloqueo no lo puede expresar. Y el festivo necesita un **nombre**
que la rejilla pueda leer en voz alta («Cerrado · Virgen del Prado»): el `reason` de un
bloqueo no viajaba hasta la pantalla, y ahora viaja, pero para las **ausencias**, que es
otra cosa.

Una fila es **o bien** un cierre con nombre **o bien** un horario propio de ese día con
nombre. El CHECK de coherencia está en la base de datos, y el e2e lo ejerce (caso 17).

### 2.3 `weekday` es ISO-8601 (1 = lunes … 7 = domingo), no el `getUTCDay()` de JS

JS pone el domingo en 0. La pantalla del owner se lee de lunes a domingo, y «cierra el
domingo» tiene que poder escribirse sin pensar: es `weekday = 7`. El CHECK del rango va en
la base de datos. Se calcula sobre el **mediodía UTC** de la fecha, nunca sobre su
medianoche: el día de la semana de "2026-10-25" es el mismo en cualquier huso, y anclar al
mediodía lo deja fuera del alcance de cualquier offset.

### 2.4 Un horario que empieza en el futuro deja el pasado SIN TECHO, no cerrado

La vigencia (`validFrom`/`validUntil`) se mira **por fecha**, no por tenant. Un horario con
`validFrom` el 01-10 deja septiembre **sin techo** (como antes del bloque), no cerrado.

La otra lectura —«tiene filas ⇒ tiene techo siempre»— cerraría el pasado a espaldas del
operador el día que configure la temporada que viene. Es la lectura conservadora: la que no
cambia el comportamiento de nadie por haber configurado el futuro. Tiene test
(`agenda-horario.test.ts`).

### 2.5 El motor se construye POR PETICIÓN, y la retícula viaja en la request

`registerAgendaRoutes` creaba **un solo motor al arrancar**, sin tenant: imposible darle una
retícula por centro. Ahora hay un `engineFor(request)` que lo construye con
`request.agendaSlotMinutes`.

Y ese valor **no cuesta una lectura nueva**: `ensureAgendaEnabled` ya hacía un
`tenant.findUnique` por petición para el gate, y ahora selecciona la columna de al lado.
Eso es lo que el prompt pedía: *una sola lectura por petición y ninguna constante suelta*.

### 2.6 El toque de la rejilla pasa de `Math.round` a `Math.floor`

**Cambio de comportamiento del front respecto a 6a, y lo digo aquí porque el prompt no lo
pedía.** Con `round` y retícula de 30, tocar la mitad de abajo de la banda de las 11:00
abría un alta a las **11:30**: una hora distinta de la banda que el dedo ha tocado, y ahora
las bandas **se ven pintadas**. Con `floor`, se toca una banda y se coge esa banda.

No afecta al suelo: a las 11:29 con retícula de 30, `floor` da las 11:00, que es
exactamente la franja que 6a §2.1 decide que todavía se reserva.

### 2.7 La cita «fuera de horario» la calcula el FRONT, no el servidor

Un campo del servidor que dijera «esta cita está fuera» podría discrepar de lo que la
columna pinta, porque la columna pinta contra `staffOpen` y `absences`. Calculándolo en el
front contra **ese mismo dato**, lo pintado y lo dicho no pueden separarse. Y sin red sigue
funcionando, porque el dato está en la caché.

### 2.8 La ausencia no pasa por el outbox

El alta de cita sí (frente O de 6a). La ausencia **no**: un bloqueo encolado que el servidor
rechaza dejaría a la cajera creyendo que alguien no está mientras la agenda sigue ofreciendo
sus huecos. Sin red se dice y no se guarda.

### 2.9 El día entero son «00:00»–«24:00», no 24 horas

Los dos domingos del cambio de hora el día dura **23** o **25** horas. Se manda hora de
pared y la compone el servidor con `wallTimeToUtc`, que resuelve «24:00» a la medianoche de
pared del día siguiente. Restar 24 horas daría una de más o de menos justo esos dos días del
año. Medido sobre la columna `tstzrange` real en el e2e (caso 14): **25 h el 25-10-2026** y
**23 h el 28-03-2027**.

### 2.10 El simulacro de impacto está acotado a 90 días, y la pantalla lo dice

Un barrido sin cota sobre un centro con dos años de agenda no es una consulta, es un susto.
Noventa días cubren de sobra lo que hay que avisar. **El número se dice en la pantalla**
(«Revisado del … al …») y se exporta (`IMPACT_DAYS`) para que tenga test. Si algo queda
fuera del barrido, no se afirma que no exista: se dice hasta dónde se miró.

### 2.11 `agenda_slot_minutes` la posee `agenda/hours.ts`, no `tenant-settings.ts`

`tenant-settings.ts` es el dueño de `agendaEnabled` y de otros diez flags. Meter ahí la
retícula habría dejado **dos sitios** escribiendo la misma columna, que es como se acaba con
dos verdades. La pantalla de ajustes de agenda es su único dueño; `tenant-settings.ts` no se
toca.

### 2.12 Sin columna de huso: sigue `CENTER_TZ`

Heredado del prompt y de 6a §2.2, y lo repito porque se sostiene: el corte de las 05:00
(`dayCutHour`) y los crons van con Madrid. Una columna que sólo leyera la agenda crearía dos
verdades. `tz` sigue entrando por `EngineOptions` desde un solo sitio.

### 2.13 Nada de Sole en el código ni en los datos

Los tests usan un centro genérico que abre de martes a sábado de 9:00 a 20:00 y cierra el
domingo. El único sitio donde aparece el nombre es el **banco visual**, que ya lo llevaba
desde B-5 y no entra en el bundle de producción.

---

## 3 · Sabotaje → test rojo

Ejecutado de verdad, uno a uno, revirtiendo entre medias. Línea base limpia:
`916 verdes | 3 saltados` (API) y `648 verdes` (TPV + admin).

| # | Qué rompo | Cómo | Qué se pone rojo |
|---|---|---|---|
| 1 | **Quitar el techo** | `clipToCenter` devuelve la plantilla sin recortar | **16 rojos**: la semántica entera (`el horario del centro RECORTA`, `día SIN fila está CERRADO`, invariante 13, `SUSTITUYE`, el horario partido) + las dos mitades del invariante 6 (`hold()` a las 20:30 y el día del festivo) + los 3 de `clipToCenter` + los 2 de la rejilla |
| 2 | **El día de la semana sin fila se trata como ABIERTO** | `open: []` → `open: null`, `closed: false` | **2 rojos**: `con semana tipo puesta, un día SIN fila está CERRADO aunque haya turno` y `el domingo sin fila cierra, pero SIN nombre` |
| 3 | **El día especial SUMA en vez de sustituir** | se concatenan los tramos de la semana tipo | **2 rojos**: `un día especial SUSTITUYE al horario semanal, no se suma` (que asserta que **no** ofrece las 15:00) y `el día especial que ABRE trae su nombre` |
| 4 | **Ignorar el festivo** | `byDate.get(date)` siempre `undefined` | **12 rojos**: invariante 13, `un festivo cierra AUNQUE el tenant no tenga semana tipo`, el sábado de boda, las dos del `hold()`, las dos de la rejilla y **dos del simulacro de impacto** |
| 5 | **Dejar el 15 fijo en el front** | `slotMin = 15` | **3 rojos**: `con 30, tocar a las 10:20 abre las 10:00`, `SIN RED la retícula sale de la CACHÉ` y `los selectores NO ofrecen y cuarto` |
| 6 | **No guardar la retícula en la caché offline** | `slotMinutes: undefined` al cachear | **los mismos 3 rojos** que el 5 — que es la prueba de que la retícula del front sale **de verdad** de la caché y no de otro sitio |
| 7 | **No calcular las citas afectadas** | `appointmentsOutside` devuelve `[]` | **6 rojos**, el bloque `qué citas quedarían fuera` entero |
| 7b | **El front guarda sin enseñarlas** | se salta el `setImpact` y guarda directo | **4 rojos** en el admin: `se enseñan ANTES de guardar`, `dice hasta dónde ha mirado`, `cancelar no guarda nada` y `confirmar SÍ guarda` |
| 8 | **Que la configuración cambie algo en un tenant SIN configurar** | «sin filas» deja de significar «sin techo» | **49 rojos**, y ésta es la importante: caen los tests de **B4** (`disponibilidad (cita)`, `aislamiento por tenant`, la carrera del GiST), los de **6a** (`availability() no ofrece el pasado`, el cambio de hora), los de **huso** (`bajo TZ=America/New_York`) y los míos (`sin techo devuelve la plantilla TAL CUAL`, `un tenant sin configurar NO tiene día cerrado nunca`). **La compatibilidad no es una promesa: está sujeta por 49 testigos** |

**Ruido observado y dicho:** en la pasada del sabotaje 4 cayó además
`POST /shift/cashier-login > rate limit se resetea tras un login exitoso` (5,7 s). Es un
flake de temporización ajeno a este bloque —la pasada limpia inmediatamente anterior y la
posterior lo pasan— y no se cuenta en los 12.

**Recuento de saltados:** 3 antes y 3 después, y son **los mismos**: el `describe.skip` de
`super-admin.test.ts:566`. Ningún sabotaje los movió y este bloque no añade ninguno.

---

## 4 · Lo que la suite NO cubre

Escrito para que nadie lo confunda con lo que sí cubre. **Cada punto está cruzado con la
rutina de Peluquería Sole que describe el prompt** (tres profesionales, franjas de 30,
reserva por teléfono con semanas de antelación, cierra el domingo, festivos con nombre, el
sábado de boda a las 8:30, «Ana libre» y «ISA NO» en la celda).

1. **El `PUT /admin/agenda/hours/week` borra y reinserta en una transacción, y nadie prueba
   la carrera.** Dos owners guardando el horario a la vez es un escenario que no existe en
   Sole (un solo propietario), pero existe. *No lo pisa su rutina.*
2. **La `validUntil` de `center_hours` no la escribe ninguna pantalla.** La columna existe y
   el motor la respeta (hay test), pero el `PUT` de la semana siempre pone `validFrom`
   1970-01-01 y `validUntil` `null`: **no hay forma de programar un cambio de temporada
   desde el admin**. Sole cambia su horario de verano una vez al año y lo hará el día que
   toque, editando la tabla. *Su rutina lo pisa una vez al año, y el camino existe: se
   guarda el horario nuevo ese día.* No se arregla aquí porque el UI de temporadas es una
   pantalla entera.
3. **Los días especiales no se editan, se reescriben.** Volver a dar de alta la misma fecha
   la sustituye (`upsert`), pero el formulario no se precarga con lo que hay. Con tres
   festivos al año es teclear dos campos. *Su rutina lo pisa y el coste es un campo.*
4. **El barrido de impacto está acotado a 90 días y no dice cuántas citas quedaron fuera del
   barrido.** Sole reserva "con semanas de antelación", no con meses: 90 días la cubren. *Su
   rutina no lo pisa.* Si alguna vez lo pisara, la pantalla dice hasta dónde miró, así que
   el operador no puede confundir «no hay más» con «no miré más».
5. **La cobertura del refuerzo (`/coverage`) mira UNA hora, la de apertura.** Un día especial
   que abriera a las 8:30 con todo el personal entrando a las 8:00 pero saliendo a las 13:00
   (y el día especial cerrando a las 14:00) avisaría de la apertura y no del cierre. *Su
   rutina no lo pisa* (el caso real es abrir antes, no cerrar después).
6. **El `GET /agenda` de un RANGO (`from`/`to`) devuelve `days[]` para todo el rango, pero el
   front sólo usa `days[0]`.** La tira de semana no pinta horarios. *Su rutina no lo pisa:*
   la agenda de Sole se mira por días.
7. **Las ausencias recurrentes comparten id.** Un `BookingBlock` con `rrule` expande a varias
   ausencias con el **mismo** id: quitar una desde la agenda quitaría el bloqueo entero. No
   hay pantalla que cree bloqueos recurrentes (el alta de la agenda crea puntuales), así que
   hoy es inalcanzable. *Su rutina no lo pisa.*
8. **La ausencia de un profesional en la columna «Sin asignar» no se puede poner.** Esa
   columna no es de nadie, a propósito: no tiene el gesto. Tiene test.
9. **El front sigue llevando su propia aritmética de huso** (`AgendaPage.TZ`, heredado de
   B4). Son dos sitios que dicen lo mismo y nadie comprueba que sigan diciéndolo. Es la
   deuda nº 5 de 6a §4 y no se cierra aquí.
10. **`GET /agenda` no tiene test de ruta en jsdom.** Su forma la ejerce el e2e (casos 5, 10,
    13) contra Postgres real; la lógica que la arma (`buildAgendaDays`) tiene 18 tests. Lo
    que no hay es un test del Fastify en el harness de memoria.
11. **El bucle visual del admin usa la pantalla de verdad con la API interceptada en la capa
    de red**, no un banco en el repo. Lo bueno: no hay fixtures de admin que mantener. Lo
    que no cubre: nadie fotografía el admin contra un servidor real.
12. **Nada de esto se ha visto en hierro.** El AP11 sigue reservado para la pasada de B-5 y
    6a (valla del prompt).

**Y un punto que SÍ pisaba su rutina y por eso se arregló aquí, no se apuntó:** el toque de
la rejilla redondeaba al más cercano (§2.6). Con bandas de 30 minutos pintadas y Sole
tocando la banda de las 11:00 para dar las 11:00, `round` le habría abierto las 11:30 la
mitad de las veces.

---

## 5 · Bucle visual

Playwright a **1280×800, 390 y 320**, contra el banco visual del TPV (`?dia=`, `?reticula=`
nuevos) y contra la pantalla del admin **de verdad**, con la API interceptada en la capa de
red (`page.route`) — así no hay fixtures de admin que mantener en el repo. `playwright-core`
vive en el scratchpad y **no entra en el repositorio**. Capturas en
`docs/blocks/reservas-7a-shots/`.

| Captura | Qué enseña |
|---|---|
| `f7-dia-normal-1280 · -390 · -320` | El día con el centro de 9:00 a 17:00: lo de fuera **rayado y no reservable**, «Nuria libre 09:00–10:30» pintada en su columna, y la cita de las 17:00 marcada **«fuera de horario»** — se sigue viendo y se sigue cobrando |
| `f7-dia-cerrado-1280 · -390` | **«Cerrado · Virgen del Prado»** arriba, la rejilla entera rayada, y las cinco citas del día marcadas y tocables |
| `f7-sabado-boda-1280 · -390` | El día especial 08:30–14:00 con su nombre. La columna de Sole (con refuerzo) abre a las **8:30**; las otras dos, a las 9:00 — se ve la diferencia de rayado |
| `f7-reticula-30-1280 · -390` | La rejilla con **líneas cada media hora**; ni una a y cuarto |
| `f7-sin-configurar-1280` | **La captura de control**: un centro sin configurar, sin una sola banda apagada. Tiene que salir igual que las de 6a |
| `f7-ausencia-paso1-1280 · -390` · `f7-ausencia-paso2-1280` | El alta de ausencia: el ⋯ de la columna (toque 1) → «No está en todo el día» (toque 2, y guarda) o «No está a ratos» → rango prerrelleno → «Guardar» (toque 3) |
| `f7-ausencia-quitar-1280` | Tocar la ausencia pintada ofrece quitarla, con su motivo y su rango |
| `f7-fuera-de-horario-toque-1280` | Tocar a las 18:00 con el centro cerrado a las 17:00: **no se abre el panel**, y el aviso dice el horario |
| `f7-admin-horario-1280 · -390 · -320` | La pantalla del owner entera: semana con mañana y tarde, tres días especiales con fecha **y nombre**, y la retícula |
| `f7-admin-sin-configurar-1280` | Sin horario puesto, la pantalla dice que **no hay techo** y que la agenda se comporta como hasta ahora |
| `f7-admin-citas-fuera-1280 · -390` | **El aviso de las citas que quedan fuera** al acortar el horario: las tres con hora y cliente, «Se quedan como están: no se cancela ni se mueve ninguna. Avísalas tú», y hasta dónde se ha mirado |
| `f7-admin-reticula-citas-1280` | El mismo aviso al pasar a 30: «4 citas… no cae en la retícula nueva» |
| `f7-admin-refuerzo-1280` | «Nadie tiene turno a las 08:30 ese día» con el selector de profesional y **«Añadir refuerzo de 08:30 a 14:00, sólo ese día»** |

**Lo que el bucle cambió, y que ningún test habría cogido** (commit `9ac158e`):

1. **La ausencia tapaba el nombre de la profesional.** Llevaba `z-10`, y la cabecera de la
   columna es `sticky z-10`: al ir después en el DOM, ganaba la ausencia. Se quitan los
   `z-index` de la ausencia **y de la cita** (yo le había puesto `z-20`): el orden del DOM ya
   deja las bandas abajo, la ausencia encima de ellas y la cita encima de todo — y por debajo
   de la cabecera y de la línea de «ahora», que es como estaba en B4 y este bloque no lo
   cambia.
2. **El «fuera de horario» salía cortado por la mitad** en las tarjetas de 30 minutos. Lo
   había puesto como segunda línea en una tarjeta que sólo da para una: **el mismo fallo que
   B-5 F8 arregló** con `CARD_TWO_LINE_MIN_H`, reintroducido. Ahora la marca va en la primera
   línea cuando la tarjeta no da para dos, y trunca limpio.
3. **A 320 px el nombre del día especial desaparecía** del listado del admin: el
   `flex-1 truncate` lo aplastaba a cero ancho y «Quitar» se salía de la tarjeta. La fila
   quedaba en «2026-09-15 · cerrado · Quitar» — **sin el nombre, que es justo lo que este
   bloque existe para poder decir**.

**Medido y NO arreglado:** la línea roja de «ahora» sigue pintándose encima de las tarjetas
y tacha el texto de una cita que la cruce. Es la deuda que 6a §5 dejó apuntada (la solución
buena es el `nowtag` del mockup) y sigue fuera de alcance.

**Medido y NO arreglado:** a 320 px la agenda sigue haciendo scroll horizontal (las columnas
son de 176 px fijos). Es comportamiento de B4 y no lo toca este bloque.

---

## 6 · Frontera (no se ha cruzado)

- **`StaffShift` no se toca** (D-3). El refuerzo del día especial se crea con la API de
  turnos de B3 **tal cual** (`POST /staff/:id/shifts`, `kind: REINFORCEMENT`,
  `validFrom = validUntil`). Los 0 tests de B3 tocados.
- **El anti-solape sigue viviendo sólo en la base de datos.** Ni un `EXCLUDE` ni un GiST
  tocado.
- **El camino de cobro no se toca.** Ni el GET-back de Holded, ni los 5 céntimos, ni el
  `/pay` idempotente, ni los triggers de S1, ni la imputación de turno del frente T de B-5.
  Una cita **fuera de horario se sigue cobrando**: es media captura de este bloque.
- **El suelo de 6a no se toca más allá de pasarle la retícula.** `floor.ts` no cambia ni una
  línea: ya aceptaba el paso como parámetro. Lo que cambia es que se le deja de pasar la
  constante.
- **Cero `if (businessType)`.** Vocabulario neutro (ADR-R6). Gate `agendaEnabled` en ruta y
  en UI, en las seis rutas nuevas. Multi-tenant por fila, con su test en el e2e (caso 20).
- **B-7b entero fuera**: `bookable_windows`, derivación y desviación,
  `GET /agenda/occupancy`, la pantalla P9 de turnos y ventanas. El prompt viejo lleva una
  nota al principio que lo dice.
- **Fuera también**: las reglas de B-6b, el panel de salud (B-9), la entidad propia de
  ausencias y vacaciones, el huso por tenant, un layout de solape de verdad, los servicios en
  paralelo, Koibox (B-10) y los bonos (B-8).
- **El AP11 no se ha tocado**: sigue reservado para la pasada en hierro de B-5 y 6a.

---

## 7 · Al desplegar

**Primero.** La migración `20260911000000_b_reservas_7a_horario_centro` **viaja en el mismo
despliegue de servidor que S1**, en ventana con **la caja parada**. Es aditiva y con backfill
vacío —dos tablas nuevas y una columna con default— así que por sí sola no necesitaría
ventana; la necesita porque S1 va delante y S1 sí la pide. No se despliega una sin la otra.

**Segundo.** La retícula de 30 de un centro se cambia **DESPUÉS de instalar su APK nueva**.
Antes, su front viejo seguiría redondeando a 15, ofrecería inicios a y cuarto, y el servidor
los rechazaría con `409 BOOKING_OFF_GRID` delante de la clienta. El orden correcto es:
despliegue de servidor → APK nueva en el AP12 → y **entonces** tocar la retícula en el admin.
**La propia pantalla lo dice** debajo del selector, y hay test de que lo dice.

*(Y una tercera que no es del despliegue pero se le parece: el horario del centro se puede
poner **antes** de la APK sin ningún riesgo. El techo lo aplica el servidor; un front viejo
simplemente no pintará las bandas apagadas ni el día cerrado, pero no ofrecerá nada que el
servidor vaya a rechazar, porque `availability()` ya viene recortado.)*

---

## 8 · Criterio de «funciona»

| Criterio del prompt | Dónde se prueba | ✔ |
|---|---|---|
| Centro martes–sábado 9:00–20:00, profesional 9:00–22:30 → **nada después de las 20:00** | `agenda-horario.test.ts` · e2e caso 1 | ✔ |
| **El domingo, cero huecos** aunque tenga turno | `agenda-horario.test.ts` · e2e caso 2 | ✔ |
| **Un festivo con nombre da cero huecos** y la rejilla dice «Cerrado · ese nombre» | `agenda-horario.test.ts` · `agenda-ausencias.test.ts` · e2e casos 4 y 5 · `f7-dia-cerrado-*` | ✔ |
| **Sábado de boda 8:30–14:00, con refuerzo, ofrece las 8:30** | `agenda-horario.test.ts` · e2e caso 7 · `f7-sabado-boda-*` | ✔ |
| **La ausencia de 9:00 a 10:30, puesta desde la agenda**, se pinta en su columna y quita esos huecos | `agenda-ausencias.test.ts` · `agenda-horario.test.tsx` · e2e casos 12 y 13 · `f7-dia-normal-*` | ✔ |
| **Con la retícula a 30 no hay ningún inicio a y cuarto**, ni al listar, ni al tocar, ni sin red | `agenda-reticula.test.ts` · `agenda-horario.test.tsx` · e2e casos 8 y 9 · `f7-reticula-30-*` | ✔ |
| **Un tenant sin configurar da exactamente lo mismo que master** | 846 tests de B3/B4/B-5/6a sin tocar · e2e casos 3 y 20 · sabotaje 8 (49 rojos) · `f7-sin-configurar-1280` | ✔ |
| **Tabla de sabotaje**, con los ocho mínimos + el recuento de saltados | §3 | ✔ |

Y los dos bordes del suelo con retícula de 30 que pedía el prompt: **a las 11:29 todavía se
pueden dar las 11:00; a las 11:30 ya no** (`agenda-reticula.test.ts`, con el borde exacto a
las 11:29:59 y el cambio de hora del 25-10 con retícula de 30).

---

## 9 · Ficheros

**Datos**
`packages/db/prisma/schema.prisma` (+86) · `migrations/20260911000000_b_reservas_7a_horario_centro/migration.sql` (nuevo, 114)

**Motor y API**
`apps/api/src/agenda/center-hours.ts` (nuevo, 184 — la aritmética pura del techo) ·
`day-view.ts` (nuevo, 206 — lo que la rejilla necesita) · `hours.ts` (nuevo, 711 — los
ajustes del owner y el simulacro) · `engine.ts` (+72) · `store.ts` (+99) · `routes.ts` (+83)
· `types.ts` (+40) · `server.ts` (+2)

**Front TPV**
`apps/tpv-web/src/pages/AgendaPage.tsx` (+728) · `src/lib/agenda.ts` (+134) ·
`visual/main.tsx` (+110)

**Front admin**
`apps/admin/src/pages/AgendaHorarioPage.tsx` (nuevo, 954) · `AdminShell.tsx` (+9) ·
`App.tsx` (+2)

**Tests**
`apps/api/test/agenda-horario.test.ts` (20) · `agenda-reticula.test.ts` (16) ·
`agenda-ausencias.test.ts` (18) · `agenda-impacto.test.ts` (16) ·
`test/helpers/agenda-fake-store.ts` (+23) · `apps/api/test-e2e/agenda-horario.e2e.ts` (21) ·
`apps/tpv-web/test/agenda-horario.test.tsx` (28) ·
`apps/admin/test/agenda-horario-page.test.tsx` (20)

**Docs**
`docs/blocks/reservas-7a-plan.md` (el frente 0) · este documento ·
`docs/blocks/reservas-7a-shots/` (23 capturas) ·
`docs/code-prompts/bloque-reservas-7-ventana-reservable.md` (+23: la nota de que es B-7b)

---

## 10 · Commits

```
1d7085e feat(reservas-7a): el techo del centro y la retícula por tenant
609fbbf feat(reservas-7a): GET /agenda deja de ser ciego al horario
ea4d651 feat(reservas-7a): la rejilla deja de ser de 8 a 21 y de 15 en 15
1ea3e6b feat(reservas-7a): los ajustes de agenda del propietario
9ac158e fix(reservas-7a): el bucle visual · tres cosas que ningún test cogió
```

**Sin push ni deploy.** Eso lo hace Matías.

---

## 11 · Un rojo que NO es de este bloque, y hay que decirlo

`apps/api/test-e2e/agenda-suelo.e2e.ts` **caso 14** («un `occurredAt` del FUTURO se ignora y
vale "ahora"») **falla si la suite se corre después de las ~13:29 hora de Madrid**, y es
**preexistente**.

**La causa.** El caso reserva en `desdeSuelo(600)` —diez horas por delante del suelo— y el
turno sembrado va de `00:00` a `23:59`. Pasadas las 13:29, `suelo + 600 min` cae a las 23:30
o después, y el servicio de 30 minutos termina a las 00:00: fuera del turno. El motor
responde `NO_SLOT` (409) donde el test espera 201.

**Comprobado, no supuesto.** Monté un worktree efímero en `4078655` (master, sin una línea de
este bloque), con su propia base e2e, y **falla exactamente igual**: mismo caso, misma línea,
mismo 409. Worktree y base borrados después.

**No lo he arreglado** porque el prompt cierra explícitamente sobre 6a («el suelo de 6a más
allá de pasarle la retícula» está fuera) y porque tocar sus tests emborrona la prueba de que
siguen verdes sin tocarlos. El arreglo es de una línea en el test —bajar el offset, o sembrar
el turno hasta `24:00`— y es de quien lleve 6a.

Los otros cinco ficheros de e2e y los 21 casos nuevos de éste pasan: `71 verdes | 1 rojo`.

---

## 12 · Qué falta para encender la agenda a Sole, y en qué orden lo haría

**El orden lo decide Matías.** Mi propuesta, con el porqué.

### 0º · Sigue siendo un despliegue, no un interruptor

Lo que dijo 6a §11 no ha cambiado y este bloque lo empeora un poco: producción sigue en
`8197e4e`, ahora **33 commits por detrás**. Hace falta el despliegue de servidor que arrastra
S1 **más** esta migración (misma ventana, caja parada) y la **APK nueva en el AP12**. Y el
orden del §7 importa: la retícula se toca la última.

### 1º · La pasada en hierro de B-5 y 6a (AP11 / AP12)

Sin cambios respecto a 6a: es la única parte del ciclo que **nadie ha visto funcionar en una
máquina de verdad**. Y ahora hay una prueba de hierro más barata que ninguna: apagar la
pantalla del AP12, quitarle la wifi, escribir una cita y ver qué pasa al volver.

### 2º · Configurar el centro de Sole, que ya se puede

Cuatro pasos y ninguno es código: interruptor de agenda → catálogo → personal y turnos → **el
horario del centro, sus festivos y la retícula a 30**. Esto último es lo que este bloque
añade, y es lo que convierte la agenda de «funciona» en «es la suya»: cierra el domingo,
tiene festivos con nombre, y el sábado de boda abre a las 8:30.

### 3º · **B-6b · las reglas del centro**

Ahora sí, y por encima de un horario que no miente. Las siete reglas
(`MIN_LEAD_MINUTES`, `NO_FRAGMENT` y compañía) se apoyan en algo real, y ya no llevan el
guardarraíl dentro: el suelo lo cubre. Dentro van los invariantes **2** (solape de recurso) y
**4** (buffers ≠ 0), que 6a dejó fuera.

### 4º · **B-7b · la ventana reservable separada del turno**

Baja al cuarto puesto, y por lo mismo que justificó partir el bloque: hoy el turno lo lee
**un solo consumidor**. B-7b paga cuando haya un segundo —fichaje, nóminas, un informe de
ocupación que alguien mire—, no antes. Lo que sí deja este bloque listo para él: el techo, el
recorte en un solo punto (`loadContext`) y el dato de las citas afectadas por API.

### 5º · **B-9 · el panel de salud**

El último de los cinco, y por lo mismo que decían B-5 y 6a. Con 6b dentro, además, tendrá
algo que pintar: la traza de qué regla descartó qué hueco. Y con este bloque, una tarjeta
nueva y barata: **«tienes horario puesto y hay N citas fuera de él»** — el dato ya está
calculado y expuesto (`/admin/agenda/hours/impact`), sólo falta quien lo pinte.
