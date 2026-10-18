# Bloque B-reservas-8 · done

Rama `reservas-8-bonos`, worktree `~/Developer/Claude/Projects/mipiacetpv-reservas-8`, desde
`master` = `7fecfc3` (el prompt reescrito del 18-10). Diez commits del bloque más el merge de
`master`, 76 ficheros contra `master`.

**Este bloque convierte una columna suelta en un módulo.** `Appointment.voucherId` llevaba desde
B-reservas-4 sin tabla detrás y `GET /clients/:id/vouchers` devolvía `[]` a propósito. Desde aquí
el centro vende un bono en caja, sabe en cualquier momento cuántas sesiones le quedan a cada
clienta, no puede dar más citas de bono que sesiones tiene, y el bono se gasta sólo al cobrar la
sesión.

La frase que resume lo que tiene que ser verdad al terminar: **la venta, el saldo, la cita y el
ticket son el mismo sistema, y el saldo sale de un libro que no se puede editar.**

ADR del bloque: [ADR-R9](../design/adr-r9-el-bono-es-una-deuda-en-sesiones.md).

---

## 1 · Lo que se decidió sin preguntar

Trece decisiones que el prompt no fijaba y que había que tomar para poder seguir. Cada una con su
porqué, para poder discutirla.

### 1.1 `Ticket.clientId` es una columna NUEVA, y hacía falta

Un ticket sólo sabía de `contactHoldedId`, **el contacto de Holded**. Y este módulo vive
exactamente en las cuentas que NO tienen Holded (Sole salió, la clínica y el spa no lo tienen).
Sin una ficha del CRM en el ticket no hay forma de saber a quién se le vende un bono —y «vender un
bono exige cliente en el ticket» es una decisión del prompt— ni de proponer el bono de una clienta
en un ticket suelto (el canje sin cita de la peluquería sin agenda).

Nullable y `SetNull`: la venta de siempre no lleva ficha y sigue sin llevarla.

### 1.2 Se conservan `type` y `sessions_left`, que no son invención de este bloque

`agenda/health.ts` publicó en B-reservas-9 la tarjeta «saldo vivo sin cita» con su SQL escrito
contra `vouchers.type` y `vouchers.sessions_left`, y el diseño cerrado ya los modelaba
(`reservas-modulo-kickoff.md` §4). Se respetan los nombres: **la tarjeta se enciende con la
migración** y no hubo que reescribir una consulta que ya estaba revisada.

### 1.3 El saldo se deriva del libro, PERO hay columna de caché

El prompt lo permite («si se guarda una columna de saldo… un test garantiza en todo momento»). Se
guarda, y por dos razones medidas: el decremento condicionado («no aparto si no queda libre») se
hace con un `UPDATE … WHERE sessions_left > 0` sobre la fila bloqueada, y la rejilla de la agenda
lee el saldo cincuenta veces por pantalla. El test de las 200 operaciones comprueba el invariante
**en cada paso**, no sólo al final, para que el rojo diga en qué operación se rompió.

### 1.4 El convenio del signo vive en un CHECK, no en un comentario

`sesiones` es el efecto de la línea sobre las **libres**, así que `libres = SUM(sesiones)` es una
sola suma. La pieza que lo cierra: una `CONSUMIDA` vale **0** exactamente cuando viene de una cita
—la sesión ya salió de libres al apartarse— y **−1** cuando no.

Eso está escrito en `voucher_movements_signo_por_tipo`, con la equivalencia
`("sesiones" = 0) = ("appointment_id" IS NOT NULL)`. Sin el CHECK, el invariante se desalinearía
en silencio y se vería semanas después en un informe.

### 1.5 El orden de `consultar()` se desvía del literal del prompt

El prompt lista `ok | noexiste | otro_cliente | no_cubre | agotado | caducado | anulado` y dice
«primero lo que se arregla en el momento». El orden implementado es:

1. `noexiste` — sin fila no se puede comprobar nada más.
2. `otro_cliente` — lo que recepción arregla en el mostrador.
3. `anulado` / `caducado` / `agotado` — el estado del bono.
4. `no_cubre` — lo único que depende de qué se intenta canjear.

**`no_cubre` baja al final.** Un bono caducado no cubre NADA, así que contestar «no vale para
quiropodia» mandaría a recepción a buscar otro servicio que tampoco va a funcionar. Lo que
necesita oír es «ese bono está caducado», que sí tiene arreglo.

### 1.6 El candado de primer uso se cierra al VENDER, no al cobrar

**Corregido respecto a la primera versión de este bloque, y es la corrección que más importa.**

Lo que había: la venta pasaba, el bono se quedaba sin emitir y la respuesta lo decía
(`bonosSinEmitir`), apoyándose en «cobrar siempre se puede». Es un error. Eso deja a la clienta
**pagada y sin bono**: el dinero entra en la caja y la deuda no queda en ningún sitio — ni en el
libro, ni en su ficha, ni en una sesión que pueda canjear. La clienta se va con 150 € menos y nada
a cambio, y lo descubre cuando vuelve.

«Cobrar siempre se puede» vale para **lo que ya se vendió**: una invariante rota no puede impedir
cerrar una venta que ya ocurrió. No vale para dejar que se venda algo que no se puede entregar.

Lo que hay ahora, en dos capas:

- **La puerta, al AÑADIR la línea.** Con el candado puesto no se puede ni meter un producto con
  plantilla de bono en el ticket (`POST /tables/:tableId/lines` → 409
  `BONO_NUMERACION_SIN_CONFIRMAR`). Es el momento en que la cajera puede hacer algo: todavía no ha
  abierto el cajón ni le ha dicho un precio a nadie. El «no» dice **qué falta y dónde**: «Antes de
  vender bonos, confirma en Ajustes por qué número empieza el talonario.»
  Y va **antes** de `getOrCreateDraftTicket`, para que tocar un bono no deje una mesa abierta con
  un borrador vacío (lo vio la pasada: «tickets en la base: 1» después de un 409).
- **La defensa, al COBRAR.** La venta rápida no pasa por el alta de línea —llega con sus líneas
  hechas en el cuerpo—, así que `prepararBonosDeLaVenta` lo comprueba antes de la transacción y
  **rechaza el cobro**. Y dentro de la transacción, si `nacerLosBonos` se encuentra el candado
  (sólo si se puso entre medias), se lanza `BonoNumeracionSinConfirmarError` y la tx se va atrás
  entera: el borrador sigue siendo borrador, no se quema número de serie y **no se cobra nada**.

**`bonosSinEmitir` ya no existe** en ninguna de las dos respuestas: no hay ningún caso en que una
venta se cobre y el bono no nazca.

**Todo lo demás se sigue cobrando igual.** El candado es de los bonos, no de la caja: en el mismo
centro y con el candado puesto, la quiropodia se añade y se cobra con normalidad. Hay test de esa
mitad, que es la que se rompería sin querer.

Y para que el TPV lo diga **en el momento de tocar el producto** y no al cobrar, el catálogo trae
dos campos nuevos: `esBono` por producto y `bonosCandadoPuesto` del centro. Son UI y se cachean
como sus hermanos: la puerta de verdad es el 409 del servidor, y el default del cacheado es
permisivo a propósito —un TPV que aún no ha refrescado no puede esconderle un bono a un centro que
SÍ lo tiene confirmado.

### 1.7 La línea canjeada va a 0 €, y NO con un descuento del 100 %

Un `discountPct = 100` entraría en `totalDiscount`, en la línea «Descuentos» del cierre y en el
umbral que pide PIN de encargado: cobrar tres sesiones de bono haría saltar la autorización del
encargado por un descuento que nadie ha dado. El bono se ve porque la línea dice con qué bono se
paga (`ticket_lines.voucher_id`), no porque su precio esté rebajado.

### 1.8 `ticket_lines.voucher_id` NO lleva clave ajena

El guardián del sello (S1) vigila la **fila entera** de una línea de venta cobrada: cualquier
columna que cambie levanta `SELLO_VIOLADO`. Una FK `ON DELETE SET NULL` sería un UPDATE sobre esa
fila, así que borrar un bono —el reseteo del ensayo se lleva el de un ticket `TEST`, y ese bono
puede haberse consumido en OTRO ticket— reventaría contra el sello. Y `RESTRICT` dejaría el
reseteo sin poder borrar nada. Lo mismo para `voucher_movements.appointment_id` y `ticket_line_id`:
un libro de solo inserción tiene que sobrevivir a lo que apunta.

### 1.9 Marcar un canje en caja APARTA

Da igual si viene de una cita o no: el borrador puede estar abierto media hora y mientras lo esté,
esa sesión no puede ofrecerse en otra pantalla. Así hay **un solo camino** —`apartar()` al marcar,
`consumir()` al cobrar, `liberar()` al desmarcar— en vez de dos contabilidades que hay que
mantener de acuerdo.

### 1.10 `liberar()` borra el `voucher_id` de la cita

Si la sesión volvió a libre, esa cita ya no es una cita de bono: la fila y el libro no pueden
contar cosas distintas. **La traza de que lo fue se queda en el libro**, que es donde no se borra
nada.

### 1.11 No hay job de caducidad

La verdad es `expires_at` y la puerta la mira siempre, así que un bono caducado **nunca** se
aparta ni se consume por mucho que su columna diga `ACTIVO`. La columna `status` se pone al día
cuando alguien lee la ficha (`marcarCaducados`), que es donde ya se iba a leer. Lo que esto deja
sin cubrir está en §5.

### 1.12 El `modoCanje` se LEE en el panel, no se cambia

Cambiarlo es decidir cómo declara el IVA un comercio. Está fuera del `POST` de ajustes a
propósito (`additionalProperties: false` devuelve 400) y la pantalla dice de qué depende.

### 1.13 El borrado de una cuenta se lleva el libro ANTES del tenant

`vouchers.client_id` es `RESTRICT` —una ficha con un bono vivo no se borra— así que dejar los
bonos para la cascada del tenant los haría chocar con el borrado de `clients`, y **el orden entre
dos cascadas hermanas no está garantizado**. Se añadió el paso 6b a `eliminarLaCuenta` y al helper
de la suite.

---

## 2 · Lo que se construyó

### 2.1 `packages/bonos` — lo puro, compartido

Los estados cerrados con su mensaje, `porQueNoDevolvible()` (**la misma función para el botón y el
servidor**), el saldo derivado del libro con su invariante, la frase «quedan 3 · 1 apartada» y la
aritmética de meses de calendario. Ni base de datos, ni husos, ni Fastify.

### 2.2 La migración

Cuatro tablas (`voucher_templates`, `vouchers`, `voucher_movements`, `voucher_sequence`), dos
columnas en tablas vivas (`tickets.client_id`, `ticket_lines.voucher_id`), la FK que
`appointments.voucher_id` nunca tuvo, cinco ajustes en `tenants`, **veinticinco CHECK** y el trigger
append-only del libro con sus dos escapatorias medidas contra el estado real («Eliminar cuenta» y
lo marcado `es_prueba`) — nunca la vieja rama «el padre ya no existe».

### 2.3 La puerta (`vouchers/gate.ts`)

`consultar`, `apartar`, `consumir`, `liberar`, más `bonosQueCubren` y `resolverCobertura` como
función pura. **Nadie más lee ni escribe las tablas de bonos.**

### 2.4 Dónde se engancha

- **Agenda**: `apartar()` dentro de la transacción de `insertHold`, después de los assignments —que
  son los que disparan el `EXCLUDE`— para no bloquear la fila de un bono y luego soltarla.
- **Caja**: `nacerLosBonos()` y `canjearAlCobrar()` dentro de la transacción del cobro y después
  del sello, el mismo sitio exacto que `ingestFiscalRecord`.
- **Devoluciones**: `bonosDeLasLineas()` + `anularLosBonos()` en la transacción del abono.
- **Reseteo del ensayo**: los bonos de prueba sin ticket; los vendidos se van por la cascada.

### 2.5 Pantallas

TPV: el chip del bono en la línea (`Con bono B1 · quedan 3 → 2`, se toca para quitarlo), la fila
«Pagado con bono» del pie, el bono ofrecido al dar la cita y la ficha con su traza.
Panel: el candado de la numeración, los ajustes, las plantillas y el alta de los de papel.

---

## 3 · Los sabotajes, con su rojo real

Los diez del prompt más uno del candado (§1.6). Cada fila: se rompió el código, se vio el
rojo, se restauró. Los mensajes son los de verdad.

| Sabotaje | Test que cayó | El rojo |
|---|---|---|
| `apartar()` FUERA y antes de la transacción de la cita | `1a` | `expected [ 'ALTA_INICIAL', 'APARTADA', 'APARTADA' ] to deeply equal [ 'ALTA_INICIAL', 'APARTADA' ]` — la que chocó contra el EXCLUDE dejó su sesión apartada para siempre |
| Quitar el `FOR UPDATE` y la recomprobación del saldo | `2` | `new row for relation "vouchers" violates check constraint "vouchers_saldo_coherente"` · `sessions_left = -1`. **El CHECK lo cazó antes que el assert** |
| `consumir()` decide por «filas afectadas» y no por el libro | `4` | `expected false to be true` en `yaEstaba`, y dos líneas `CONSUMIDA` para una cita |
| El trigger sólo vigila `DELETE` (deja pasar `UPDATE`) | trigger + `bonos-migracion` | `promise resolved "1" instead of rejecting` · y el guardia del SQL: `expected … to match /CREATE TRIGGER "voucher_movements_app…/` |
| La puerta ELIGE el primero cuando hay dos | `6` | `expected [ 'B6' ] to include 'B8'` |
| Caducidad como 30,5 días por mes | `7` | `expected '2027-03-02' to be '2027-02-28'` |
| El contador reutiliza un número existente | `8` | `expected 3 to be 4` — el B3 ya existía y se lo habría comido |
| El bono nace al añadir la línea al borrador | `9c` | `expected 1 to be +0` — el contador avanzó con un ticket sin cobrar |
| La API del sanitario manda `cobradoCents` | `12a` | `expected '[{"cobradoCents":15000,…' not to contain 'cobradoCents'`. Y antes del test, el compilador: `Type 'number' is not comparable to type 'never'` |
| `consumir()` sin la regla de cobertura | `3f` | `expected true to be false` — consumió contra un masaje que el bono de podología no cubre |
| Permitir añadir la línea del bono con el candado puesto | `9e` y `9g` | `expected 201 to be 409` — el bono entró en el ticket y de ahí habría salido cobrado |

### 3.1 Dos tests cambiaron al medirlos, y los dos por lo mismo

- **`9c` insertaba el borrador a mano**, así que un bono que naciera en la ruta de añadir línea no
  lo habría visto. Ahora abre el borrador por `POST /tables/:id/lines`, que es el camino de la
  cajera.
- **`3b` no podía caer** con «consumir contra un servicio que no cubre»: por el camino del
  borrador el servidor ni marca la línea, así que `consumir()` no llega a correr. Se añadió el
  **`3f`**, que fuerza el caso que sí llega —la línea ya marcada y lo hecho resultó otra cosa, que
  es clinica-3.

---

## 4 · La pasada

Cuenta de pruebas en ENSAYO, sin Holded, con agenda y bonos encendidos, API y TPV propios del
worktree (`:3081` / `:5188`), base `mipiacetpv_r8_pasada`. **En el terminal y en el navegador.**

### 4.1 En el terminal

```
0 · El terminal entra y Rosario teclea su PIN
  ✓ sesión de cajero abierta con el PIN, desde el terminal emparejado

1 · El candado de primer uso
  añadir el bono al ticket → 409 BONO_NUMERACION_SIN_CONFIRMAR
  «Antes de vender bonos, confirma en Ajustes por qué número empieza el talonario.»
  ✓ no deja ni añadirlo, y dice qué falta y dónde
  venta rápida → 409 BONO_NUMERACION_SIN_CONFIRMAR
  tickets en la base: 0 · bonos: 0
  ✓ NO se cobra: ni ticket, ni bono, ni número quemado
  catálogo: candadoPuesto=true · «Bono 5 quiropodias» esBono=true
  ✓ el TPV puede decirlo en el momento de tocar el bono
  confirmar arranque → 200
  ✓ el encargado confirma por qué número empieza: B1

2 · Vender «Bono 5 quiropodias» a Carmen
  ticket 000001 (TEST) · bono B1 · 5 sesiones
  saldo en la base: {"sessions_left":5,"sessions_reserved":0,"status":"ACTIVO"}
  libro: VENDIDO

3 · Dos citas de bono
  saldo: quedan 3 · 2 apartadas

4 · Agotar el bono y pedir una más
  sexta cita de bono → 409 BONO_NO_DISPONIBLE (agotado)
  «Ese bono no tiene sesiones libres.»
  citas en la base: 5 (las 5 del bono, ni una más)

5 · Anular una cita
  → 200 · bono: {"que":"liberada", …}
  saldo: quedan 1 · 4 apartadas

6 · Cobrar la primera cita
  borrador · total 0 € · bono B1 · quedan 1 → 0
  línea: «Quiropodia» · 0 € · descuento 0 %
  libro: VENDIDO → APARTADA ×5 → LIBERADA → CONSUMIDA

7 · La ficha de Carmen
  B1 · Bono 5 quiropodias · 5 sesiones · «quedan 1 · 3 apartadas» · caduca el 2027-04-18
  vale 150 € · se cobraron 150 €
  ¿devolvible? NO · Este bono ya tiene 1 sesión consumida: devolver la venta entera
  sería devolver un trabajo ya hecho. La devolución parcial no está en esta versión.

9 · Resetear el ensayo
  tickets borrados: 2 · bonos de prueba sin ticket: 0
  bonos: 1 → 0 · líneas del libro: 0

LA PASADA PASA.
```

El paso **8 (sanitario sin caja) no se pudo correr por este camino**: `/auth/login` del panel
rechaza a un `CLINICIAN` con `403 CASHIER_NOT_ALLOWED_IN_ADMIN`, que es el comportamiento correcto
de clinica-1. Se comprueba en `bonos-sanitario-y-puertas.e2e.ts`, que firma el token directamente.

### 4.2 En el navegador, a 390 px

Capturas en [`B-reservas-8-shots/`](./B-reservas-8-shots):

1. `1-catalogo-con-el-bono-390.png` — el bono como un producto más del catálogo.
2. `2-alta-de-cita-con-bono-390.png` — «Con bono · B1 · quedan 3 → 2 · 2 apartadas», **ya marcado**,
   y la frase «Se apartará una sesión al guardar la cita. Si la anulas, vuelve.»
3. `3-cobro-linea-a-cero-390.png` — la línea a 0,00 € con el chip «Con bono B1 · quedan 3 → 2 ·
   toca para quitarlo», y el pie: «Pagado con bono · 1 sesión de bono en este ticket», Total 0,00 €.
4. `4-ficha-filtro-de-prueba-390.png` — **en una cuenta EN ENSAYO todo bono nace `es_prueba`**, así
   que la ficha los enseña detrás de su filtro («Ver 1 bono de prueba»). Es lo correcto (`07` pieza
   17) y la captura lo demuestra.
5. `5-ficha-saldo-y-traza-390.png` — «quedan 3 · 2 apartadas», las dos cifras separadas, el «por
   qué no se puede devolver» y la traza con quién hizo cada cosa.
6. `6-agenda-dos-citas-de-bono-390.png` — las dos citas del bono en la rejilla.

### 4.3 Lo que la pasada encontró y los tests no

**El borrador de una cita no llevaba la ficha de la clienta.** La línea salía a 0 € —eso lo ponía
`canjeParaElBorrador`— pero **sin el chip**, porque `GET /tickets/:id/bonos` no puede proponer nada
sin saber de quién es el ticket: la cajera veía un cero sin explicación. Y no era sólo el chip: sin
`clientId` en el borrador, el canje sin cita tampoco se puede ofrecer sobre el ticket de una cita.

Arreglado en `agenda/checkout.ts` (`clientId: appt.clientId`) y con su test: el `3a` comprueba
ahora que el ticket lleva la ficha **y** que la propuesta se puede pintar.

---

## 5 · Lo que la suite NO cubre

Dicho por escrito, que es la otra mitad del criterio de cierre.

1. **La caducidad no la pone al día ningún job.** `expires_at` es la verdad y la puerta la mira
   siempre —un bono caducado no se aparta ni se consume—, pero la columna `status` sólo se
   actualiza cuando alguien lee la ficha. Consecuencia medible: la tarjeta «saldo vivo sin cita»
   de `agenda/health.ts` **cuenta los bonos caducados que nadie haya mirado**. No hay test de eso.
2. **El `PRORRATEO` no se cobra.** El test 14 comprueba que la línea lleva el prorrateo; lo que NO
   está probado —porque no está decidido— es **cómo se liquida** ese importe, que es parte de P5.
   Con `PRORRATEO` el ticket de canje tiene un total distinto de cero y nadie lo paga.
3. **El canje SIN CITA no tiene e2e propio.** El camino existe y está escrito
   (`consumirSinCita`, idempotente por `ticket_line_id`), y lo cubre el typecheck y la ruta de
   marcar; lo que no hay es una pasada completa «peluquería sin agenda» contra Postgres.
4. **Dos bonos marcados en el MISMO ticket** (dos líneas, dos bonos) no tienen test. El código lo
   admite —`canjearAlCobrar` recorre todas las líneas— pero nadie lo ha medido.
5. **La concurrencia de `marcarLineaConBono`**: dos terminales marcando la misma línea a la vez.
   `apartar()` está bloqueado y `ya_aplicado` lo cubre, pero no hay test de carrera para esa ruta
   (sí para el alta de cita, que es donde el spa midió el caso real).
6. **El alta inicial pide el id de la ficha a mano** en el panel: el buscador de clientas vive en
   otra pantalla y traerlo entero no entraba en este bloque. Funciona, pero es incómodo.
7. **`bonoEtiqueta` no llega al justificante impreso.** El ticket y el PDF dicen el nombre del
   producto («Bono 5 quiropodias»), que ya lo lleva; lo que no se ha tocado es el renderer para
   que diga «programa» donde el spa lo diría.
8. **La agenda no revalida la cobertura al cambiar el servicio de una cita**, porque **hoy no se
   puede cambiar**: `PATCH /agenda/appointments/:id` sólo mueve la hora o el estado. La
   revalidación que sí existe —y sí está probada— es la del cobro, que es donde clinica-3 cambia lo
   que se hizo.
9. **El front no tiene tests propios de los componentes nuevos.** Lo que se ha medido de ellos es
   la pasada en el navegador y el typecheck; los bancos visuales de `apps/tpv-web/visual` no se han
   ampliado con pantallas de bono.

---

## 6 · El frente abierto: P5

**`bonosEnabled` no se enciende en ninguna cuenta real hasta que la asesoría conteste.** La
pregunta está redactada y lista para mandar en [ADR-R9 §6.1](../design/adr-r9-el-bono-es-una-deuda-en-sesiones.md).
El interruptor lo mueve sólo el super-admin, y además no se puede encender con Holded conectado
(409 en la ruta y CHECK en la base).

---

## 7 · Verde

- Suite de siempre: **389 ficheros, 5493 tests** (10 saltados).
- Suite e2e contra Postgres real: **44 ficheros, 901 tests**.
- `tsc --noEmit` limpio en `apps/api`, `apps/tpv-web` y `apps/admin`.

```bash
# desde la raíz del worktree
pnpm vitest run
docker exec -i mipiacetpv-postgres psql -U mipiacetpv -c "CREATE DATABASE mipiacetpv_e2e_r8;"
cd apps/api && E2E_DATABASE_URL='postgresql://mipiacetpv:mipiacetpv_dev@127.0.0.1:5432/mipiacetpv_e2e_r8' \
  pnpm test:e2e
```

**Ojo con los dos `.env`**: el de la raíz y el de `apps/api` tapan lo que la CI va a ver. Apártalos
antes de empujar y repite la suite.

---

## 8 · `master` se movió, y la rama ya lo lleva

Mientras corría el bloque, `master` pasó de `7fecfc3` a `9523a6f` (residencia-3, el prompt de
residencia-4, `fiscal-link-sin-cascada` y la auditoría de Sirope). **El merge está hecho en la
rama** (`ac0377b`), sin conflictos, y las dos suites y los tres `tsc` están verdes **sobre el árbol
combinado**.

Las dos migraciones del 18-10 conviven: `20261018000000_fiscal_link_sin_cascada` ordena antes que
la de los bonos y no se tocan (la primera reemplaza
`mipiacetpv_tickets_fiscal_link_guard`; la segunda no lo mira).

### El segundo merge: residencia-4 (PR #31)

`master` se volvió a mover antes de que el PR #32 entrara: pasó a `7b96e81` con residencia-4 (PR
#31) y el prompt de residencia-5. El merge está hecho en la rama y toca siete ficheros.

Seis los fusionó git solo —`schema.prisma`, `apps/api/src/server.ts`,
`apps/api/src/superadmin/eliminar-cuenta.ts`, `apps/admin/src/App.tsx`,
`apps/tpv-web/src/App.tsx` y `apps/tpv-web/src/hooks/useDeviceBootstrap.ts`— y se comprobó que no
se comió nada de ningún lado por el camino corto: el diff del árbol combinado contra
`origin/master` es de **sólo inserciones**, y contra la punta de la rama (`be6c1b9`) también. Las
cuatro líneas que el diff del `schema.prisma` cuenta como borradas son realineados de espacios de
residencia-4, no relaciones.

El único conflicto de verdad es `apps/admin/src/AdminShell.tsx`, y es de **posición**: los dos
lados añaden entradas a la barra lateral en el mismo hueco. Se quedan las de los dos, cada una
donde le toca por su capability: Incidencias y Guardia dentro del grupo de residencia y detrás de
Plantillas (el orden que pide residencia-4: Incidencias primero, que es lo que la dirección abre
cada mañana), y «Bonos» después del grupo, porque su capability es `bonos` y no `residencia`. Los
tres iconos (`AlertTriangle`, `BellRing`, `Ticket`) ya venían los tres en el import fusionado.

**El orden de borrado de «Eliminar cuenta» aguanta, y había que mirarlo.** residencia-4 añade seis
tablas con FK `RESTRICT` al tenant (`incidents`, `incident_actions`, `family_communications`,
`guard_alerts`, `guard_shift_sessions`, `resident_threshold_overrides`) y dos de ellas
—`incidents` y `resident_threshold_overrides`— con `RESTRICT` también a `clients`. No hay nada que
reordenar: residencia-4 **no borra** esas tablas, las bloquea (el libro es la evidencia de las
acciones correctoras que AENOR audita, así que un centro con una avería declarada no se elimina:
se le dice por qué). El paso 6b de los bonos sigue siendo el último `deleteMany` antes del `DELETE
FROM tenants`, y por tanto sigue yendo antes de la cascada que se lleva `clients` — que es lo que
`Voucher.client` con `RESTRICT` exige. El diff de `eliminar-cuenta.ts` contra `origin/master` son
exactamente las dos líneas de bonos y su párrafo 6b de la cabecera: nada más.

**La migración se renombró.** De `20261018000000_reservas_8_bonos` a
`20261018030000_reservas_8_bonos`, para que ordene **detrás** de las dos de residencia-4
(`20261018010000_residencia_4_tipos` y `20261018020000_residencia_4_gravedad_e_incidencias`) y no
en medio de ellas. El nombre lo lee un test —`apps/api/test/bonos-migracion.test.ts`, que abre el
`.sql` por su ruta— y viaja con el renombrado.

Y ninguna de las tres se pisa: residencia-4 crea diez enums y tres triggers suyos
(`incidents_inmutable`, `incident_actions_append_only`, `family_communications_append_only`),
bonos crea el suyo (`voucher_movements_append_only`), y de `tenants` sólo tira bonos, y sólo para
añadir columnas.

Comprobado con una base **limpia**, que es la única forma de ver el orden de verdad (sobre una
base ya migrada `migrate deploy` no aplica nada y pasa en verde sin decir nada):

```bash
docker exec mipiacetpv-postgres psql -U mipiacetpv -d postgres \
  -c 'CREATE DATABASE mipiacetpv_r8merge;'
cd packages/db && DATABASE_URL='postgresql://mipiacetpv:mipiacetpv_dev@localhost:5432/mipiacetpv_r8merge?schema=public' \
  npx prisma migrate deploy
# → las 89, en orden, `20261018030000_reservas_8_bonos` la última.
#   "All migrations have been successfully applied."
```

El `migrate diff` contra esa base marca 54 tablas con deriva, y **no es de este merge**: son el
`DEFAULT now()` que el `.sql` pone en `updated_at` frente al `@updatedAt` de Prisma (que es de
aplicación y no de base) y las FK declaradas en un solo sentido. Está en tablas de todo el
histórico del repo, desde `apk_download_codes`, no sólo en las nuevas.

### Verde sobre el árbol combinado (con residencia-4 dentro)

- Suite de siempre: **394 ficheros, 5695 tests** (10 saltados).
- Suite e2e contra Postgres real: **45 ficheros, 968 tests** — incluye el `residencia-4.e2e.ts`
  que entró con el PR #31.
- `tsc --noEmit` limpio en `apps/api`, y `tsc -b` limpio en `apps/tpv-web` y `apps/admin`.

Con base y Redis propios de la sesión, que es la lección de siempre: la suite e2e hace `DROP
SCHEMA public` y la API de dev de otro worktree se come los jobs de la de al lado.

```bash
pnpm db:generate   # el cliente de Prisma, después de mergear el schema
pnpm test
docker run -d --name mipiacetpv-r8merge-redis -p 6383:6379 redis:7-alpine
docker exec mipiacetpv-postgres psql -U mipiacetpv -d postgres \
  -c 'CREATE DATABASE mipiacetpv_e2e_r8merge;'
E2E_DATABASE_URL='postgresql://mipiacetpv:mipiacetpv_dev@127.0.0.1:5432/mipiacetpv_e2e_r8merge' \
  REDIS_URL='redis://127.0.0.1:6383' pnpm test:e2e
```

---

## 9 · Empujar y abrir el PR

El push y el PR los hace Matías. Los comandos exactos:

```bash
cd ~/Developer/Claude/Projects/mipiacetpv-reservas-8

# 1 · comprobar que no se cuela ningún .env
git status --short

# 2 · empujar la rama
git push -u origin reservas-8-bonos

# 3 · el PR contra master
gh pr create --base master --head reservas-8-bonos \
  --title "B-reservas-8 · Bonos de sesiones: el libro, la puerta de canje y la sesión apartada" \
  --body "$(cat <<'CUERPO'
El centro vende un bono en caja, sabe cuántas sesiones le quedan a cada clienta, no puede dar más
citas de bono que sesiones tiene, y el bono se gasta sólo al cobrar la sesión.

**Dos pasos** (S6): al dar la cita se APARTA una sesión, en la misma transacción que la cita; al
cobrar, lo apartado pasa a CONSUMIDA contra lo que se hizo. Nunca se consume un bono contra un
servicio que no cubre.

**El saldo sale de un libro de solo inserción.** El convenio del signo vive en un CHECK, no en un
comentario: `libres = SUM(sesiones)` y una CONSUMIDA vale 0 exactamente cuando viene de una cita.
Un test recorre 200 operaciones aleatorias comprobando el invariante en cada paso.

**Dinero y deuda van por separado**: el bono congela su valor de carta y lo cobrado, y el libro no
duplica el cobro — lo enlaza con su ticket.

**Sólo en cuentas sin Holded**, y eso está en la ruta del super-admin y en un CHECK de la base. El
importe de la línea al canjear queda parametrizado porque es el frente P5 de la asesoría:
`bonosEnabled` no se enciende en ninguna cuenta real hasta que esa respuesta esté escrita.

Los diez sabotajes del prompt más el del candado, cada uno en su rojo, y lo que la suite NO
cubre, dicho por escrito:
`docs/blocks/B-reservas-8-done.md`. ADR: `docs/design/adr-r9-el-bono-es-una-deuda-en-sesiones.md`.

Suites verdes sobre el árbol ya mergeado con `master`: 5493 unitarios y 901 e2e contra Postgres.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
CUERPO
)"
```

---

*Mi Piace Internet Solutions · B-reservas-8 · 18-oct-2026.*
