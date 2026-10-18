# Bloque B-reservas-8 · Bonos de sesiones: libro, puerta de canje y la sesión apartada en la cita

> **Reescrito el 18-10-2026.** La versión anterior (mayo–sep) daba por hecho que la venta se
> registraba en Holded y descontaba la sesión al dar la cita. Las dos cosas ya no valen: desde el
> 23-09 mipiacetpv es el SIF, y el 07-10 Matías decidió los dos pasos (apartar al citar, descontar
> al cobrar). Manda este texto. La versión vieja está en el historial de git.

## Por qué existe este bloque

Hoy un bono de sesiones no existe en el TPV: `Appointment.voucherId` es una columna suelta y
`GET /clients/:id/vouchers` devuelve `[]` a propósito (`apps/api/src/crm/routes.ts`, «vacío hasta
B-8»). Quien vende bonos (Sole, la podóloga, el spa) los lleva en papel o en otro programa.

¿Y qué? Con este bloque, el centro **vende un bono en caja, sabe en cualquier momento cuántas
sesiones le quedan a cada clienta, no puede dar más citas de bono que sesiones tiene, y el bono se
gasta solo al cobrar la sesión**. La venta, el saldo, la cita y el ticket son el mismo sistema. En
el CRM de la competencia (Koibox) los bonos ni siquiera salen por la API.

## Leer antes (en este orden)

1. `docs/reservas/07-novedades-rt-hasta-18-oct.md` — piezas 1, 6, 8, 16, 17 y 18: son de este bloque.
2. `docs/reservas/05-lo-aprendido-en-rt-del-2-sep-al-6-oct.md` §4 entero (puerta, libro, reglas de
   valor, no-show) y §8.6 (fechas, precio único en servidor).
3. `docs/reservas/06-de-raquel-torres-al-tpv.md` §2.2 (qué se traduce y qué se tira de `rt-gift-cards`).
4. La decisión **S6** de los solapes clínica ↔ agenda, copiada abajo en «Decisiones ya tomadas». Es
   la regla de producto; no se reabre.
5. `docs/design/reservas-modulo-kickoff.md` §4 (el `voucher` ya diseñado) y
   `docs/reservas/01-cruce-con-b-reservas-4.md` §H3 / D-2: **el saldo extiende `voucher`, no se crea
   un modelo paralelo `Program`.**
6. `apps/api/src/agenda/checkout.ts` y `docs/blocks/reservas-5-done.md`: el puente cita → caja.
   Este bloque se cuelga de ahí, no lo reescribe.
7. `apps/api/src/fiscal/mode.ts` y `docs/blocks/puesta-en-marcha-done.md`: el ensayo y el reseteo.
   Un bono vendido en ensayo es de ensayo y el reseteo se lo lleva.
8. `docs/blocks/clinica-3-done.md`: la sesión clínica que pasa a caja «con lo hecho» y la «próxima
   cita» desde la sesión. Las dos tocan el bono.

## Base de rama

Worktree `~/Developer/Claude/Projects/mipiacetpv-reservas-8`, rama `reservas-8-bonos` **desde
`master`** (`6f15ed7` o posterior). `git worktree list` antes de la primera línea. PR contra `master`.

## Decisiones ya tomadas (no reabrir)

**De S6 (07-10, OK de Matías) y de su ratificación:**

- **Un solo bono para todos los centros.** Nada de «bono clínico». Sin lógica de vertical dentro.
- **Se cobra entero al venderse** (es un ticket nuestro, por el camino de cobro normal) y **las
  sesiones se descuentan al canjearlas**.
- **Dos pasos:**
  1. **Al dar la cita se aparta una sesión** (movimiento `APARTADA`), en la misma transacción que la
     cita. No descuenta: solo impide dar más citas de bono que sesiones quedan. Si no queda sesión
     libre, la cita no nace como cita de bono (puede nacer como cita normal si el cajero lo elige).
     También aparta la «próxima cita» que el sanitario da al cerrar la sesión.
  2. **Al cobrar, lo apartado pasa a consumido** (`CONSUMIDA`) contra **lo que se hizo**, con la
     línea del servicio a 0 €. Si lo hecho no lo cubre el bono, lo apartado se libera y la línea se
     cobra normal. **Nunca se consume un bono contra un servicio que no cubre.**
  - Anular la cita libera lo apartado. **No-show:** lo decide el centro (ajuste `consumir | liberar`,
    por defecto `consumir`, que es lo que hace el spa).
- **Vale por servicio o por categoría** del catálogo (S5: la categoría es la familia).
- **El bono es de una ficha.** Sin bonos compartidos en esta versión.
- **El sanitario sin caja ve sesiones, nunca euros:** «quedan 3 · 1 apartada».
- **Caducidad configurable por el centro**, por defecto sin caducidad. Se cuenta en **meses de
  calendario**. Lo caducado no se borra: queda en el libro. Prolongar la caducidad lo puede hacer el
  encargado, con motivo, y queda en el libro.
- **Bonos de papel:** se dan de alta a mano con su saldo y la marca «alta inicial», sin ticket de venta.

**De Raquel Torres (`07`, decidido el 18-10):**

- **Dinero y deuda van por separado.** El bono congela al venderse dos cifras: su **valor de carta**
  (lo que el centro debe) y **lo cobrado** (lo que entró, que vive en el ticket). Un bono vendido con
  descuento o regalado vale lo de carta en sesiones. El libro no duplica el cobro: el cobro es el
  ticket, y el libro lo enlaza.
- **El libro es de solo inserción.** Nada se edita ni se borra; se corrige con una línea contraria
  enlazada (`compensaA`) y su motivo. **El saldo se deriva del libro.** Si se guarda una columna de
  saldo para el decremento condicionado, un test garantiza en todo momento
  `total − consumidas − apartadas vivas = libres`, y si discrepan manda el libro.
- **Cada línea dice quién** (usuario, «Web» o «Migración»), **por qué canal** (`tpv | panel | web |
  migracion`), un `detalle` que lee recepción y un `motivo` cuando es una corrección.
- **La puerta de canje tiene cuatro operaciones** y es la única forma de tocar un bono desde fuera
  del módulo (agenda, caja, clínica y, mañana, la reserva online):
  - `consultar(texto, clienteId?)` → siempre las mismas claves y un `estado` de esta lista cerrada:
    `ok | noexiste | otro_cliente | no_cubre | agotado | caducado | anulado`. Primero lo que se
    arregla en el momento, luego lo que hay que mirar.
  - `apartar(bonoId, citaId)` → con la fila del bono bloqueada (`FOR UPDATE`) y volviendo a
    comprobar: lo que dijo `consultar()` medio segundo antes aquí ya no vale. **Un solo bono por cita**
    (`ya_aplicado`).
  - `consumir(citaId | ticketLineId)` y `liberar(citaId, motivo)` → **idempotentes, decididas por el
    estado del libro**, no por quién llamó primero: una anulación puede llegar por dos caminos.
- **Numeración:** código `B<n>` por centro, contador atómico sin huecos. **Se acepta el número
  suelto** (`B87`, `b 87`, `87`). El contador **se salta un número que ya exista** (el spa se lo
  encontró con un número que llegó desde dev). **Candado de primer uso:** el primer bono no se emite
  hasta que el encargado confirma en Ajustes por qué número empieza (los centros con talonario de
  papel siguen su numeración).
- **Lo de prueba se marca, no se borra** (`esPrueba` por fila). Sale de la ficha y de los informes de
  gestión. No confundir con `Tenant.esDePruebas` (cuenta entera) ni con el ensayo de
  puesta-en-marcha (ticket `TEST`): un bono vendido en un ticket `TEST` nace `esPrueba = true` y el
  reseteo de ensayo lo borra junto a su ticket.
- **Ocultar o cambiar de precio un servicio no invalida bonos ya vendidos.** Siguen canjeándose por
  lo que se vendió. La pantalla de ocultar lo dice con cifras («3 bonos siguen valiendo»).
- **Nombre:** en el código, `Voucher` / «bono». La palabra que ve el centro es un ajuste por cuenta
  (`bono` por defecto; el spa dirá `programa`).

**Decisiones de este bloque (Dirección, 18-10):**

- **Qué es un bono en el catálogo:** un producto normal (precio, IVA, categoría, exención) con una
  **plantilla de bono** 1:1 (`VoucherTemplate`: nº de sesiones, qué cubre —servicios o categorías—,
  caducidad en meses o ninguna). Venderlo es añadir ese producto al ticket. Así el precio y el IVA
  van por el camino de siempre; no hay un segundo sitio donde se fija el precio de un bono.
- **Vender un bono exige cliente en el ticket.** Si no lo hay, el TPV lo pide antes de cobrar.
- **El bono nace cuando el ticket pasa a `PAID`**, en la misma transacción, con su `soldTicketId` y
  `soldTicketLineId`. Un ticket que no se cobra no gasta número.
- **Devolver la venta de un bono** solo se puede si no tiene ninguna sesión consumida ni apartada.
  Va por el camino de devoluciones de siempre, y el bono queda `ANULADO` en el mismo paso. Con
  sesiones usadas, el botón dice por qué no y qué hacer (liberar las apartadas, devolución parcial
  fuera de alcance). **Una sola función `porQueNoDevolvible()`** para el botón y el servidor.
- **Corregir un bono** (sesiones de más o de menos, cambiar caducidad): motivo obligatorio de lista
  cerrada (`error_venta | cortesia | ajuste_alta_inicial | otro`; nota obligatoria solo con `otro`;
  **sin mínimo de caracteres oculto**), una línea en el libro con el antes y el después.
- **El método de pago `VOUCHER` que ya existe no se usa para canjear sesiones.** Una sesión no es un
  pago: es una línea a 0 €. `VOUCHER` queda para los cheques por importe (bloque B-cheques).
- **Solo en cuentas sin Holded en esta versión.** Encender `bonosEnabled` con `holdedEnabled = true`
  se rechaza con el motivo. Un ticket de canje a 0 € subido a Holded es terreno desconocido y no lo
  necesita nadie hoy: Sole sale de Holded, la clínica y el spa no lo tienen.
- **El importe de la línea al consumir (0 € o prorrateado) es fiscal (P5) y lo responde la
  asesoría.** El bloque lo deja **parametrizado** (`modoCanje = LINEA_CERO` por defecto; la
  alternativa `PRORRATEO` existe y tiene test), escribe un ADR con las dos opciones y qué cambia en
  el registro fiscal de cada una, y **`bonosEnabled` no se enciende en ninguna cuenta real hasta que
  esa respuesta esté escrita en el ADR**. Un bono de servicios exentos se vende exento: lo hace ya
  `exemptionCause` del producto, no se toca.

## Alcance

### 1. Datos — migración aditiva

- `VoucherTemplate` (1:1 con `Product`): `sessions`, `coversServiceIds[]`, `coversTagSlugs[]`,
  `expiresMonths?`.
- `Voucher`: `tenantId`, `clientId` (obligatorio), `code` (UNIQUE por tenant), `number`, `templateId?`
  (null en alta inicial), `sessionsTotal`, cobertura **congelada** (copia de la plantilla al vender),
  `valorCartaCents`, `cobradoCents`, `soldTicketId?`, `soldTicketLineId?`, `expiresAt?`, `status
  ACTIVO | AGOTADO | CADUCADO | ANULADO`, `origen VENTA | ALTA_INICIAL`, `esPrueba`.
- `VoucherMovement` (solo inserción; trigger como el de `fiscal_records`): `voucherId`, `tipo
  VENDIDO | ALTA_INICIAL | APARTADA | LIBERADA | CONSUMIDA | CORRECCION | CADUCIDAD_CAMBIADA |
  ANULADO`, `sesiones ±`, `appointmentId?`, `ticketLineId?`, `compensaA?`, `detalle`, `motivo?`,
  `canal`, `userId?`, `actor` («Web», «Migración»), `esPrueba`, `createdAt` (UTC desde el código).
- `voucher_sequence` por tenant: último número, número de arranque confirmado (`null` = candado puesto).
- FK real en `Appointment.voucherId`. Índice `(tenantId, clientId, status)`.
- `Tenant.bonosEnabled` (columna explícita, como los demás módulos), `Tenant.bonoNoShow consumir |
  liberar`, `Tenant.bonoEtiqueta` (texto, por defecto «bono»), `Tenant.bonoModoCanje`.

### 2. La puerta (servicio interno `vouchers/gate.ts`)

Las cuatro operaciones de arriba, más `resolverCobertura(bono, servicioId)` como función pura:
cubre por servicio o por cualquiera de sus categorías; **si dos bonos vivos de la clienta cubren el
mismo servicio, no elige: devuelve los dos** y el front pregunta. Agenda, caja y clínica llaman a la
puerta; **nadie más lee ni escribe las tablas de bonos**.

### 3. Caja

- Vender: producto con plantilla → pide cliente → al cobrar nace el bono → el ticket y el justificante
  dicen «Bono quiropodia · 5 sesiones · B87».
- Canjear con cita: al cerrar en caja una cita con bono, la línea del servicio sale **ya marcada**
  «Con bono B87 · quedan 3 → 2» y a 0 €. Se puede desmarcar (entonces se libera y se cobra normal).
- Canjear sin cita (peluquería sin agenda): al añadir un servicio a un ticket con cliente, si un bono
  suyo lo cubre, se propone igual. Consume sin pasar por `APARTADA`.
- Ningún botón gris mudo: si no se puede, dice qué falta.

### 4. Agenda

- Alta de cita: si la clienta tiene bono que cubre el servicio, se ofrece **ya marcado** con
  «quedan 3 libres → 2». Al guardar, `apartar()` en la misma transacción que la cita: **o las dos o
  ninguna** (el EXCLUDE de solape puede rechazar; entonces no se aparta nada).
- Mover la cita no toca el bono. Cambiar el servicio de la cita revalida la cobertura.
- Rejilla: distintivo sobrio (punto + «B») sin teñir el bloque.

### 5. Ficha de cliente y panel

- Ficha: cada bono con «quedan N · M apartadas», caducidad, y **la traza legible**: qué cita apartó,
  qué ticket consumió, quién corrigió y por qué. Las de prueba, ocultas tras un filtro.
- `GET /clients/:id/vouchers` relleno de verdad, **con el mismo contrato que ya publica**.
- Para el sanitario sin caja: lo mismo **sin una sola cifra en euros**, también en la API (no se
  oculta en el front: no se manda).
- Ajustes: número de arranque (el candado), etiqueta, no-show, caducidad por defecto.
- Alta inicial de bonos de papel: cliente, plantilla o servicios, sesiones que quedan, número del
  papel, fecha de caducidad si la tiene.

## Restricciones

- **No se crea `Program` ni nada paralelo** a `voucher`.
- **No se toca:** el anti-solape (el apartado entra **dentro** de la transacción de la cita), el
  camino de cobro, `/pay`, la cadena fiscal ni el trigger append-only de `fiscal_records`.
- **Nada de saldo calculado en el cliente.** El front enseña lo que devuelve el servidor.
- **El precio lo pone el servidor**, desde el producto. Del navegador solo llegan ids.
- **Fechas:** se razona en hora del centro y se guarda en UTC desde el código; nada de `now()` de
  Postgres para el negocio. «Caduca el día X» incluye el día X entero en hora local.
- **Una lista blanca de columnas descarta en silencio las nuevas:** si algún serializador o mapper
  filtra campos, cada campo nuevo lleva su test.
- **«Filas afectadas = 0» no es un candado** (no distingue «no me tocaba» de «ya estaba»): fila
  bloqueada + estado del libro.
- Gate por `bonosEnabled` en rutas y UI, independiente de `agendaEnabled` (se vende y se canjea en
  caja sin agenda). Multi-tenant por fila.
- Commits pequeños en español, en la rama. **Nunca `git add -A`. El push y el PR los hace Matías**:
  deja los comandos exactos al final del `-done`.

## Tests (contra Postgres real, como el EXCLUDE de B-6)

1. **Cita y apartado son atómicos.** Dos tests: el EXCLUDE rechaza → no queda `APARTADA`; no quedan
   sesiones libres → la cita no nace como cita de bono.
2. **Carrera por la última sesión libre:** dos procesos a la vez, repetido 5 veces → siempre gana uno
   y el otro recibe `agotado`.
3. Cobrar consume lo apartado; cobrar «con lo hecho» que no cubre → libera y cobra normal; anular
   libera; no-show con los dos ajustes.
4. `consumir` y `liberar` dos veces → una sola línea (idempotencia por el libro).
5. **El invariante del libro** (`total − consumidas − apartadas = libres`) tras una secuencia
   aleatoria de 200 operaciones.
6. Dos bonos que cubren lo mismo → la puerta no elige.
7. Caducado no aparta ni consume; prolongar deja línea con motivo; 6 meses de calendario
   (31-ago + 6 = 28-feb).
8. Numeración: se salta un número existente; candado puesto → no se emite; acepta `b 87`.
9. Venta: el bono nace con el ticket `PAID`; un ticket que no se cobra no gasta número; un ticket
   `TEST` → bono `esPrueba` y el reseteo de ensayo lo borra.
10. Devolver la venta con sesiones usadas → rechazado con el motivo de `porQueNoDevolvible()`.
11. Ocultar el servicio → el bono sigue canjeándose.
12. El sanitario sin caja: la respuesta de la API **no contiene** ningún importe (el test vuelca el
    JSON y busca claves y valores de dinero).
13. `bonosEnabled` con `holdedEnabled` → rechazado. Tenant sin `bonosEnabled` → 404 en todo.
14. `modoCanje = PRORRATEO` → la línea lleva el prorrateo; `LINEA_CERO` → 0 €.

### Sabotaje → rojo (criterio de cierre)

Cada fila: se rompe el código, se ve el rojo, el mensaje real va al `-done`, y se restaura.

| Sabotaje | Debe caer |
|---|---|
| Sacar `apartar()` de la transacción de la cita | test 1 |
| Quitar el `FOR UPDATE` / la recomprobación en `apartar()` | test 2 |
| `consumir()` decide por «filas afectadas» y no por el libro | test 4 |
| Permitir un `UPDATE` en `voucher_movements` | el test del trigger |
| La puerta elige el primer bono cuando hay dos | test 6 |
| Caducidad como 183 días | test 7 |
| El contador reutiliza un número existente | test 8 |
| El bono nace al crear el ticket, no al cobrarlo | test 9 |
| La API del sanitario manda `cobradoCents` | test 12 |
| Consumir contra un servicio que el bono no cubre | test 3 |

Y la otra mitad: **qué NO cubre la suite**, dicho por escrito en el `-done`.

### La pasada (criterio de «funciona»)

En una cuenta de pruebas, en ensayo, con agenda y bonos encendidos, en el navegador y en un
terminal: vender «Bono 5 quiropodias» a una clienta → `B1`, quedan 5. Darle dos citas → «quedan 3
libres · 2 apartadas». Intentar una sexta cita de bono con 0 libres → no deja, y dice por qué.
Anular una → vuelve a 4 libres. Cobrar la otra → línea a 0 €, quedan 4. Ver en la ficha qué cita
apartó y qué ticket consumió. Entrar como sanitario sin caja → sesiones, ningún euro. Resetear el
ensayo → el bono desaparece con su ticket. Capturas a 390 px y en el terminal, en el `-done`.

## Entregables

- Rama `reservas-8-bonos` con la migración, la puerta, caja, agenda, ficha, ajustes y alta inicial.
- ADR del bono: modelo, dos pasos, dinero y deuda, y **P5 con sus dos opciones** (lo que falta de la
  asesoría, dicho como pregunta lista para mandar).
- `docs/blocks/B-reservas-8-done.md` con la plantilla de siempre: decisiones tomadas sin preguntar,
  sabotajes con su rojo, lo que no cubre la suite, capturas y comandos de push/PR.

## Fuera de alcance (explícito)

- **Cheques por importe, saldos `S-` y cheques regalo** (venta en mostrador, web, envío programado,
  cofres): bloque **B-cheques**, que se monta sobre este libro. El modelo los admite; aquí no se
  construyen.
- **Señales `R-`**: pago a cuenta de una cita, B-13.
- **Venta online de bonos y canje en la reserva online**: B-11. La puerta ya queda lista para eso.
- **Ofertas y descuentos de campaña**: B-ofertas.
- Bonos compartidos entre fichas (S7), avisos de caducidad, importación desde Koibox (B-10).
- Deshacer en 4 s: aquí se corrige con línea contraria y motivo. Se valora con B-cheques.
- Devolución parcial de un bono con sesiones usadas.
