# Bloque agenda-banco · done

Banco de pruebas completo de la agenda por la interfaz real + vídeo «de cero a
un día normal». Rama `agenda-banco`, desde `master` = `5e903a1`.

**Trabajo de entrega, no desarrollo nuevo**: no se ha tocado ni una línea de
producción. Lo que el banco ha destapado está abajo, con severidad, y lo
decide Dirección.

## 1 · Cómo se lanza

```bash
pnpm e2e:agenda
```

Un comando. Levanta lo que haga falta y siembra antes de empezar:

1. **Postgres y Redis** del `docker-compose.yml` (por nombre de contenedor,
   no por `docker compose up` — ver §8).
2. La base **`mipiacetpv_agenda_banco_e2e`**, si no existe.
3. Las **migraciones reales** (`prisma migrate deploy`, no `db push`): el
   banco corre contra el mismo esquema que producción, con sus `EXCLUDE`.
4. El **seed** de «Peluquería Demo».
5. La **API** (:3001), el **admin** (:5173) y el **TPV** (:5174), que Playwright
   reusa si ya están arriba.

La conexión sale de `apps/api/.env` (la misma base que la API local): si
mirara otra base, el banco no probaría nada. **Y se niega a correr si el
nombre de la base no contiene `banco`, `e2e` o `test`**: el seed vacía la base
entera, así que el guardarraíl es el mismo criterio que
`apps/api/test-e2e/e2e-env.ts`.

Variantes:

| Comando | Qué hace |
|---|---|
| `pnpm e2e:agenda` | el banco entero, rápido, sin vídeo |
| `pnpm e2e:agenda:seed` | sólo volver a sembrar |
| `pnpm --filter @mipiacetpv/e2e-ui run video` | graba el vídeo (ritmo humano) |
| `apps/e2e-ui/video/montar.sh` | monta los MP4 con ffmpeg |
| `pnpm --filter @mipiacetpv/e2e-ui run e2e:solo -- specs/06-*` | un capítulo suelto (sin sembrar) |

**NO entra en la CI**, como pedía el prompt. Se lanza a mano.

### El escenario

Tenant ficticio **«Peluquería Demo»**, `businessType = SERVICES`, **sin
Holded**, CRM encendido y **la agenda APAGADA** (encenderla es el capítulo 1).
Tres profesionales (Marta, Lucía, Irene), seis servicios, cuatro clientas —
tres sólo con nombre de pila, como las apunta una peluquera. Ningún dato real
de nadie.

**El seed deja el sustrato, no el resultado.** Duraciones, perfiles, colores,
matriz de servicios, turnos, horario del centro, festivos y citas **no** los
deja: los pone el banco por la pantalla, y son los capítulos 1 a 4. Un seed
que dejara la agenda configurada probaría la base de datos, no la interfaz.

Es **idempotente por vaciado**: `TRUNCATE` de todas las tablas menos las
migraciones, y vuelve a crear todo con los mismos ids fijos.

### El tinte va partido en dos

Decisión de Dirección del 04-10-2026. «Tinte · aplicación» (30 min) y «Tinte ·
lavado y peinado» (30 min) en vez de un tinte de 90, porque **la pausa de
exposición no se puede expresar en un servicio** (hallazgo 🟡 nº 2). La visita
de Rosa son dos citas con **45 minutos de exposición** entre medias, y en ese
hueco entra el corte de Pili: el hueco es de verdad y el motor lo ofrece solo.

45 y no 30 porque con 30 el corte encajaría al milímetro, y una cita que cabe
exacta no prueba que el motor sepa meterla. Y 45 y no 40 porque la retícula
del centro es de 15 minutos: las 10:10 no se pueden ni teclear.

## 2 · Los capítulos

Un fichero por capítulo en `apps/e2e-ui/specs/`, en orden. **Un solo worker y
sin reintentos**: los capítulos son los del vídeo y el estado se arrastra —el 6
reserva sobre el equipo que dio de alta el 3—, así que ni corren en paralelo ni
se repite uno a mitad de la cadena.

Viewports: **TPV = 1280×800 CSS a `deviceScaleFactor` 1,5** (el AP11/AP12 en
horizontal, medido en `reservas-mostrador-done.md` §6) · **admin = 1280** ·
**móvil = 390**.

| # | Capítulo | Qué comprueba en pantalla | Qué comprueba en la BD |
|---|---|---|---|
| 1 | **Encender** | el TPV **sin** botón de agenda, el interruptor en Ajustes, el TPV **con** botón, y el menú del admin que gana las tres secciones (tras recargar) | `tenants.agenda_enabled` pasa de `false` a `true` |
| 2 | **Servicios** | los seis pasan de «Sin datos de agenda» a su duración | una fila por servicio en `service_scheduling` con la duración y la pausa exactas |
| 3 | **Equipo** | las tres de alta **en orden y sin tocar el color**: la pantalla propone sola tres colores distintos | 3 `staff_profiles` con 3 colores distintos, las filas de `staff_skills` (el tinte **sin nadie**, a propósito) y 3 `staff_shifts` con su `rrule` |
| 4 | **Horario** | el aviso «el centro **no tiene techo**» antes de poner nada; lunes y domingo marcados «cerrado» después | 5 `center_hours` (martes a sábado 9–20) y 2 `center_days`: el festivo cerrado sin horas y el día especial con las dos |
| 5 | **Salud** | el badge del TPV cantando «2», la tarjeta con los dos tintes, la matriz en **modo mirar** para Marta, y el panel limpio tras arreglarlo la dueña | las 4 filas nuevas de `staff_skills`, y ninguna de Irene (no tiñe) |
| 6 | **Reservar** | 3 sí y 4 no, cada no con **el mensaje que ve la cajera** | la clienta nueva con el apellido vacío, las tres citas de Marta a las 09:00 / 09:30 / 10:15 (el corte **dentro** de la exposición), y en cada «no» **que la BD no se movió** (foto antes/después) |
| 7 | **El día** | las tres columnas, «mi día» con el filtro, y lo mismo a 390 | `CANCELLED` y `NO_SHOW` con su `assignment.active = false`, y **el hueco se vuelve a dar** (lo que de verdad prueba que sale del `EXCLUDE`) |
| 8 | **Cobrar** | el ticket ya poblado con el servicio de la cita, la vuelta de 20,00 €, el reparto mixto que «cuadra», y que el primario dice **«Cerrar servicio»** (es `SERVICES`) | el ticket con sus pagos (`CASH` 30 y `CASH` 10 + `CARD` 5), `cash_amount` 50 (de ahí la vuelta), la venta en el **turno abierto** y la cita `COMPLETED` con su `ticket_id` |
| 9 | **Cerrar el día** | «45,00 € · 2 tickets», «EFECTIVO 40,00 €», «TARJETA 5,00 €» y «fondo 100,00 € + efectivo neto 40,00 € = 140,00 €» | el turno cerrado con `cash_counted` **igual a lo esperado al céntimo** |
| 10 | **Sin red** | la ficha guardada con su marca «sin conexión» | que **no** está en la BD mientras no hay red, y que al volver llega con su `external_id` (la idempotencia del alta offline) |

**Los «no» del capítulo 6**, uno a uno:

| «No» | Lo que para | Lo que ve la cajera |
|---|---|---|
| **Solape** | el motor, antes de insertar | «El hueco ya no está disponible» + **tres horas alternativas** para decirlas por teléfono |
| **Festivo** | el techo del horario del centro | «El centro está cerrado ese día · **Virgen del Prado**» — con su nombre |
| **Quien no sabe** | la matriz: Lucía no tiñe ni hace mechas | el mismo «no hay hueco» (y aquí está el hallazgo 🟡 nº 4) |
| **Hora pasada** | el suelo de la agenda, en la propia pantalla | «Esa hora ya ha pasado. El primer hueco es a las HH:MM» |

### Lo del `EXCLUDE`, dicho con precisión

El prompt pedía ver el `EXCLUDE USING gist` de Postgres rechazar una fila
**desde la interfaz**. Lo que el banco encontró, y es mejor contarlo exacto:

- **Por la pantalla no se llega al `EXCLUDE`.** Una franja ya ocupada ni
  siquiera abre un alta (la tarjeta de la cita está encima y el toque abre su
  detalle), y el solape que sí se puede pedir —una cita que se **alarga**
  sobre otra— lo para el motor con su propia comprobación antes de insertar,
  y contesta `409` con alternativas. El banco comprueba ese «no» y que la BD
  no se movió.
- **El `EXCLUDE` es la red de debajo**, para la carrera de dos altas
  simultáneas: ahí el motor pierde y Postgres gana (`store.ts` → `23P01` →
  `ExclusionError` → `TAKEN`). Eso **sigue probado por la API**, en
  `apps/api/test-e2e/agenda-suelo.e2e.ts`, no por el banco.

O sea: la interfaz no puede provocar el `EXCLUDE` porque el motor no la deja
llegar. Que es, en realidad, la buena noticia.

## 3 · Los hallazgos

Nada de esto se ha arreglado (regla del bloque). Ordenados por lo que más
importa para la visita.

### 🟡 1 · En un dispositivo recién emparejado la agenda dice «Sin nombre» en todas las citas

**Qué pasa.** La rejilla pinta «09:00 · Sin nombre», «09:30 · Sin nombre»… en
todas. Después de abrir **una vez** la pantalla Clientes, pinta «09:00 · Rosa».

**Por qué.** El nombre de la clienta sale de la caché local
(`loadClientsFromCache`), y esa caché la llena la pantalla Clientes: **la
agenda no la pide nunca**.

**Por qué importa en Sole.** Es exactamente el estado del AP11 el primer día:
emparejado hace un rato, nadie ha entrado en Clientes. La recepción abre la
agenda y no sabe de quién es la cita de las diez. Se arregla con un toque
—una vez que se sabe—, y por eso no es 🔴; pero es lo primero que se va a ver.

**Dónde sale.** `specs/07-el-dia.spec.ts` → «la rejilla dice «Sin nombre» hasta
que alguien abre Clientes» (lo deja comprobado en los dos sentidos).

### 🟡 2 · La pausa de exposición de un tinte no se puede expresar

**Qué pasa.** Un servicio tiene duración y pausas antes/después, y **las pausas
ocupan a la profesional**: el motor calcula su hueco como
`[inicio − pausaAntes, fin + pausaDespués)` (`engine.ts:417-423`). Y los
servicios de una visita se encadenan **seguidos**: `offset += durationMin`
(`engine.ts:183`), sin forma de dejar un hueco en medio.

**Por qué importa en Sole.** Un tinte de 90 minutos tiene a la profesional
ocupada 90, cuando 40-45 de esos minutos la clienta está con el tinte puesto y
la peluquera puede cortar a otra. La agenda **funciona**, pero **reserva de
menos**: es la hora que un centro factura dos veces.

**Cómo se trabaja hoy** (y es lo que graba el vídeo): partir el tinte en dos
servicios y dar dos citas con el hueco en medio. Funciona, y el hueco es real.

### 🟡 3 · Al menú de la dueña le falta el camino a «Ajustes»

**Qué pasa.** La entrada «Ajustes» está marcada `superAdminOnly`
(`AdminShell.tsx:211`), así que **la dueña no la ve en su menú**. El
interruptor de la agenda sí lo puede tocar (`canEdit` es `true` para `OWNER`):
lo que falta es llegar. El banco va por URL.

**Y además**, tras guardar, el menú **no gana** las secciones de la agenda
hasta recargar: el shell lee las capacidades una vez al montar.

**Por qué importa en Sole.** Encender la agenda lo hará Matías, no Sole. Y
quien lo haga va a pensar que no ha funcionado, porque el menú no cambia.

### 🟡 4 · El servicio que la profesional no sabe hacer se ofrece igual

**Qué pasa.** En el panel de alta de una cita, `bookableServices` sólo filtra
por «es servicio y tiene duración» (`AgendaPage.tsx:1756`): **no cruza con la
matriz**. Se puede elegir «Mechas» en la columna de Lucía, que no las hace, y
el «no» llega al pulsar Reservar — hablando de **huecos**, no de quién.

**Por qué importa en Sole.** La cajera no entiende el «no»: ve que no hay
hueco con Lucía a ninguna hora del día y no sabe que el problema es que Lucía
no hace mechas.

### 🟡 5 · Una profesional ve el aviso de salud pero no lo puede arreglar

**Qué pasa.** La matriz le sale en **modo mirar**: `canConfigure` exige `OWNER`
o `MANAGER` (`routes.ts:792`). El aviso, en cambio, lo ve cualquiera.

**Por qué importa en Sole.** Sole es la propietaria, así que para ella no hay
problema. Para Ana o Isa el aviso es un callejón sin salida.

### 🟡 6 · Mover una cita no se puede desde la agenda

**Qué pasa.** La API lo soporta (`PATCH /agenda/appointments/:id` acepta
`start`) y el cliente del TPV también (`patchAppointment`), pero **la pantalla
no lo ofrece**: ni arrastrar la tarjeta ni cambiar la hora en el detalle, que
sólo manda `status`.

**Por qué importa en Sole.** En una peluquería las clientas cambian de hora
todos los días. Hoy el único camino es cancelar y volver a dar la cita — lo
que pierde el histórico de la cita original.

**Es trabajo sólo de pantalla**: el motor ya sabe mover y devolver
alternativas. Queda un test en el capítulo 7 que se pondrá **rojo el día que
exista**, para que haya que venir a contarlo.

### ⚪ 7 · El panel de salud no se entera de que lo has arreglado

Al volver de la matriz, la cifra **sigue** diciendo 2. Hay que pulsar
«Actualizar». Es justo lo que hace pensar que el arreglo no ha funcionado.

### ⚪ 8 · Dos cosas del alta de una clienta sin red

- La marca «sin conexión» **no se va** cuando la ficha ya salió: la lista no
  vuelve a mirar el estado mientras la pantalla está abierta.
- Tras el alta sin red **la hoja del formulario se queda abierta** por encima
  de la lista: la pantalla se ve pero no se puede tocar (el botón «Volver»
  está visible y los clics no le llegan).

Son el mismo hallazgo contado dos veces: cuando el alta se encola, la pantalla
no cierra el trámite.

### ⚪ 9 · Dos cosas que sólo molestan a quien automatiza (y a un lector de pantalla)

- Los campos del formulario de turnos (`StaffPage.tsx:733-747`) pintan el
  `<label>` **sin `htmlFor`** y el `<input>` **sin `id`**: la etiqueta no está
  asociada a su campo, ni para `getByLabel` ni para un lector de pantalla.
- El **toast** de la agenda (`AgendaPage.tsx:1183`) no tiene gancho propio: el
  aviso que la cajera lee delante de la clienta es el único que ninguna prueba
  puede pedir por su nombre. Es la única excepción a «nunca por clase de
  Tailwind» de todo el banco.

### ⚪ 10 · Este bloque mete Playwright en el repo

Hasta hoy la regla era «Playwright vive en el scratchpad, no en el repo» (el
bucle visual de capturas). El prompt de este bloque pide lo contrario y a
propósito: `apps/e2e-ui` con `@playwright/test` de dependencia de desarrollo,
**fuera de CI**, a mano. Se ha hecho como dice el prompt; queda apuntado para
que nadie lo lea como un descuido. El bucle visual de capturas sigue en el
scratchpad.

## 4 · Qué NO cubre el banco

El banco corre en **Chromium sobre un Mac**. Queda fuera, y va a mano en la
visita (`docs/qa/agenda-banco-manual.md`):

- **la impresora**: el ticket de una cita en papel, entero y legible;
- **el teclado propio del hierro** en los importes (el pad de la app, no el
  de Android, que es el hallazgo H2 de v1.12);
- **el dedo**: un clic de Playwright es un punto exacto y un dedo son 40 px.
  Y en esta pantalla medio píxel importa — ver §8;
- **el lector de códigos** sobre el borrador de una cita;
- **el WebView real del AP11/AP12** y su rendimiento al cambiar de día;
- **la red del local**: `setOffline` corta la red de golpe; el WiFi de un
  local se degrada, que es peor;
- **imprimir la agenda del día**: hoy no existe. Si Sole lo pide, es un bloque
  nuevo.

Y dos cosas del propio banco, dichas en voz alta para que nadie las lea como
cobertura que no hay:

- **El «no» de la hora pasada depende del día y la hora en que se lance.** La
  pantalla no deja ir a un día pasado (el `min` del selector es hoy, y eso se
  comprueba siempre), pero para tocar una **hora** pasada hace falta que hoy
  el centro abra (martes a sábado) y que ya sean más de las 09:30. Cuando no
  aplica, el banco **lo dice por consola** en vez de saltárselo en silencio, y
  el `409 BOOKING_IN_PAST` del servidor sigue cubierto por
  `apps/api/test-e2e/agenda-suelo.e2e.ts`.
- **El `EXCLUDE` de Postgres no lo provoca la interfaz** — ver §2.

## 5 · La tabla de sabotajes

Cada uno: se rompe **una línea de producción**, se pasa el banco entero, se
mira qué se pone rojo y con qué mensaje, y se devuelve la línea a su sitio.
Comprobado el 04-10-2026; el repo quedó limpio detrás de los seis.

| Lo que se rompe | Dónde | Qué se pone rojo | Con qué mensaje |
|---|---|---|---|
| **La columna deja de fijar a la profesional** | `engine.ts:207` **y** `engine.ts:429` | `06 · la cita cae en la columna que se ha tocado` y `06 · el no de quien no sabe` | `Expected: …203 (Lucía) · Received: …202 (Marta)` |
| **El festivo deja de cerrar el centro** | `center-hours.ts:109` (`if (especial.closed)` → `if (false)`) | `06 · el no del festivo` | `expect(locator).toBeVisible() failed · element(s) not found` (el aviso «cerrado · Virgen del Prado» no sale) |
| **Un hueco cancelado sigue bloqueando** | `store.ts:640` (`const active = true`) | `07 · el hueco vuelve` y `07 · no-show` | `expect(received).toBe(false) · Received: true` (el `assignment.active`) |
| **La cita cobrada no se enlaza con su ticket** | `checkout.ts` (sin `store.linkTicket`) | `08 · en efectivo` y `08 · mixto` | `expect(received).toBe("COMPLETED") · Received: undefined` (no hay cita con ese `ticket_id`) |
| **A las tres se les propone el mismo color** | `StaffPage.colors.ts:51` | `03 · las tres profesionales…` | `Received: "#e8663c"` para las tres |
| **La duración guardada no es la tecleada** | `AgendaCatalogPage.tsx:468` (`+ 5`) | **13 specs**, en cascada desde el `02` | `expect(locator).toBeVisible() failed` (las horas de la rejilla dejan de existir) |

### Lo que los sabotajes enseñaron del banco, y de producción

- **La promesa de la columna no estaba cubierta.** El primer sabotaje dejó el
  banco entero en verde. Se le ha puesto un test propio
  (`06 · la cita cae en la columna que se ha tocado`), y ahora sí.
- **Y esa regla está escrita DOS VECES en producción**: `engine.ts:207` filtra
  los candidatos por el profesional fijado, y `engine.ts:429` vuelve a
  comprobarlo dentro del bucle. Romper **una sola** no cambia nada — la otra
  tapa el agujero. Hay que romper las dos para que el banco se entere. No es
  un fallo (la duplicación es defensiva y barata), pero conviene saberlo: una
  de las dos se puede borrar un día «porque es redundante» sin que nada se
  queje.
- **El sabotaje de la duración se lleva 13 specs por delante** y la pasada
  tarda 14 minutos en vez de 1,6. Es la señal de que la duración es el dato
  del que cuelga todo lo demás: sin ella no hay huecos, sin huecos no hay
  citas y sin citas no hay cobro ni arqueo.

## 6 · Las trampas del banco (lo que costó una pasada cada una)

Están todas comentadas en el sitio donde muerden. Aquí juntas, porque el
siguiente que monte un banco contra esta interfaz se va a encontrar las
mismas.

**De la stack**

- `docker compose up` **desde un worktree choca**: el compose pone
  `container_name` fijo y un nombre de contenedor es único por demonio, así
  que intenta crear otro `mipiacetpv-redis` y muere con «Conflict». Y
  `-p mipiacetpv` tampoco vale: el proyecto con el que se crearon de verdad se
  llama `holded` (el directorio desde el que se levantaron hace tiempo). Se
  tocan **por nombre de contenedor**.
- El seed **no puede borrar el tenant y confiar en el `CASCADE`**: en cuanto
  el TPV abre un turno hay una fila en `shifts` apuntando al usuario, y esa FK
  no cascadea. `TRUNCATE` de todas las tablas, que además no lo puede romper
  una FK nueva mañana.
- `dotenv/config` del server lee el `.env` del **cwd**, que es `apps/api`. El
  `.env` del banco va ahí, no en la raíz.
- Prisma en consulta cruda **no infiere el tipo**: `tenant_id = $1` muere con
  `42883 operator does not exist: uuid = text`. Va `$1::uuid`.

**De la pantalla**

- **Medio píxel importa.** Pedir las 10:15 con la Y exacta del borde de la
  franja abría el alta a las **10:00**: la Y fraccionaria se redondea al
  pulsar y `openSlotFirst` redondea hacia abajo a la retícula. Se pulsa **dos
  minutos dentro** de la franja. (Y por eso el punto 3 de la pasada en hierro
  existe: con el dedo esto hay que mirarlo.)
- **Una franja ocupada no abre un alta**: la tarjeta de la cita está encima y
  el toque abre su detalle.
- **Las tarjetas y las filas no se cierran solas** al abrir otra: con dos
  abiertas hay dos botones «Guardar» y el selector se rompe.
- **El selector de día revierte** si se teclea mientras la agenda carga, y el
  `toHaveValue` llega a pasar en la ventana de antes de la reversión: el test
  seguía con la agenda en **otro día** y el fallo decía «no encuentro la
  tarjeta de las 09:00». Hay que asentarlo y volver a comprobarlo.
- **Abrir turno no son tres `if` seguidos**: el resumen del día lo trae una
  petición que todavía no ha contestado cuando se pregunta, los tres dicen
  «no» y el banco se queda mirando una tarjeta. Es un bucle de estados.
- **Buscar «Carmen» saca también a «Mari Carmen»**, y coger el primer
  resultado cuelga la cita de la clienta equivocada **sin que nada falle**.
- Tres botones dicen «Cobrar» a la vez (el de la venta, el del detalle de la
  cita y el de la hoja): el de la venta hay que pedirlo **con su importe**,
  que además comprueba que el ticket llegó poblado.
- Los importes **no se escriben**: son `AmountField` (un `div` con
  `aria-label`), y se teclean con el pad de la app. Es el hallazgo H2 de
  v1.12 — el teclado de Android tapaba el botón de cobrar.
- `getByLabel("Importe Efectivo")` casa también con **«Limpiar importe
  efectivo»**, y `/cuadra/` casa con la ayuda que dice «si no **cuadra**».

**Del propio banco**

- **El rótulo del vídeo se leía a sí mismo**: un rótulo que decía «Cerrar el
  día» hacía fallar la comprobación de la pantalla que dice «Cerrar el día».
  Al esconderlo se le **borra el texto**.
- **Playwright sólo escala el vídeo hacia abajo.** Pedirle 1920×1200 para un
  viewport de 1280×800 no amplía: pinta la página en la esquina de arriba a
  la izquierda y deja el resto en negro. Cada pantalla graba a su tamaño y
  amplía `ffmpeg`.
- El `ffmpeg` de este Mac **no trae `drawtext`**. No hace falta: las portadas
  y las cortinillas las pinta el navegador dentro del vídeo, con la
  tipografía de la app.
- El `bash` de macOS es el **3.2**: no tiene `mapfile`, y su `printf '%.0f'`
  no se traga «27.680000» con la coma decimal del locale.

## 7 · El vídeo

**Dónde está**: `~/Developer/Claude/Projects/mipiacetpv-media/agenda/`. **No
entra en git**: son 12 MB el completo y 1 MB por capítulo.

| Fichero | Dura | Qué enseña |
|---|---|---|
| `01-encender.mp4` | 0:25 | el TPV sin agenda, el interruptor, el TPV con agenda |
| `02-servicios.mp4` | 0:18 | las duraciones, y el tinte partido en dos |
| `03-equipo.mp4` | 0:27 | las tres de alta, cada una con su color |
| `04-horario.mp4` | 0:18 | la semana, el festivo y el día especial |
| `05-salud.mp4` | 0:27 | el aviso del tinte sin nadie y su arreglo |
| `06-reservar.mp4` | 1:12 | los tres sí y los cuatro no |
| `07-el-dia.mp4` | 0:58 | las tres columnas, «mi día», el móvil, cancelar y no-show |
| `08-cobrar.mp4` | 0:29 | la cita cobrada en efectivo con vuelta, y mixta |
| `09-cerrar-el-dia.mp4` | 0:15 | el arqueo cuadrando |
| `10-sin-red.mp4` | 0:17 | el alta sin cobertura y su sincronización |
| **`agenda-completo.mp4`** | **5:10** | los diez seguidos, con portada |

**1080p, 25 fps**, por debajo del tope de 10 minutos.

Los **rótulos en español** los pinta un overlay que inyecta el propio spec
(`lib/rotulo.ts`): un `<div>` en el `<body>` y una hoja de estilos aparte.
**La app no se toca** — ni sabe que la están grabando, y el día que se quite
el vídeo no queda nada que limpiar en producción. La **portada** («La agenda,
de cero a un día normal») y las cortinillas de cada capítulo son el mismo
overlay a pantalla completa, así que salen con la tipografía de la app.

El **ritmo humano** (pausas entre pasos, `slowMo`) sólo existe con
`BANCO_VIDEO=1`: el banco, cuando no graba, va a toda velocidad (1,6 min
contra 5,1).

El montaje es `apps/e2e-ui/video/montar.sh`: normaliza cada trozo a 1080p con
lanczos y concatena. Los trozos de un capítulo se ordenan **por fecha de
fichero**, que es el orden en que pasaron; por nombre de carpeta el capítulo 1
contaría la película al revés.

## 8 · Cómo se cierra

- [x] **`pnpm e2e:agenda` verde de punta a punta, dos veces seguidas** — 26
      tests en 10 ficheros, ~1,6 min por pasada. El seed es idempotente
      (vacía y rehace con los mismos ids), así que la segunda pasada encuentra
      exactamente la misma base que la primera.
- [x] **El vídeo**, 10 capítulos + uno completo de 5:10, fuera de git.
- [x] **La tabla de sabotajes**, seis, con el repo limpio detrás.
- [x] **`docs/qa/agenda-banco-manual.md`** con lo que hay que mirar en hierro.
- [x] **Ni una línea de producción tocada.** Los hallazgos van arriba con su
      severidad; los arregla quien Dirección diga, en otro bloque.
