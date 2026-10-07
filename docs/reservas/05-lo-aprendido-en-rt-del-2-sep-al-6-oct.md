# Lo aprendido en Raquel Torres del 2-sep al 6-oct · segunda entrega

> **Qué es esto.** La continuación de `00-koibox-ingenieria-inversa-y-modelo.md`, que llegaba hasta
> `rt-booking` 0.8.1 (bloque B8, 2-sep). Este documento recoge lo que se ha construido y medido en el
> proyecto Raquel Torres desde entonces, traducido a requisitos para la agenda de este proyecto.
>
> **Hasta dónde llega.** Repo `raqueltorres` (`~/Developer/Claude/Projects/raqueltorres`), commit
> `fc459da` del 6-oct-2026:
> - `rt-booking` de 0.9.1 a 0.17.0 (bloques B9 a B15 y JACUZZI);
> - `rt-gift-cards` de 0.10 a 0.20 (G1 a G6a, programas, saldo y señales);
> - `rt-panel` de 0.3 a 0.8 (P1 a P3, reservas web, cabinas y caja).
>
> **Cómo se ha hecho.** Se leyeron enteros los `-done.md` de cada bloque, el roadmap, las pruebas de
> apertura, las ADR, el informe de servicios fuera de carta y `horarios-personal/README.md`. Los
> cambios menores 0.16.x, que no tienen `-done`, se toman del mensaje de su commit.
>
> **Marcas, igual que en el 00:**
> - **[M]** medido contra la cuenta real o en dev con datos reales;
> - **[D]** documentado, o comportamiento de terceros;
> - **[H]** hipótesis sin verificar;
> - **[X]** decisión nuestra (de Matías o del equipo).
>
> **Cómo se trata.** Igual que el 00: es un documento de **entrada**, no la spec. Nada marcado
> **[H]** se convierte en código. Si algo choca con un ADR cerrado aquí, manda este proyecto. Se
> anota como divergencia en el §9 y se sigue.

---

## 0 · Lo que cambia respecto al 00, en una pantalla

1. **La reserva online se cobra.** B4 («señal solo en franjas protegidas») se descartó el 17-sep y
   lo sustituye B13: se paga al reservar con tarjeta, cheque o sesión de programa. La cita queda
   pendiente de pago, ocupa el hueco y vence sola a los 10 min. Ver §2.
2. **La clienta cambia o anula su cita sola**, desde un enlace con token y con política en servidor
   (B14). Ver §3.
3. **Los recursos físicos sí restan disponibilidad.** Hay overbooking de bañera **medido en la
   agenda real, sin web de por medio**. Regla de Matías (6-oct): «nunca overbooking en nuestro
   lado». Ver §5. Esto zanja a favor la duda P7 / F2 de nuestro roadmap.
4. **La identidad de cliente no es el teléfono.** El 1,7 % de los móviles del centro tienen varias
   fichas (familias). Ver §6.
5. **La matriz de competencias tiene tres estados**, no dos, y se captura con cada profesional desde
   el móvil. Ver §7.
6. **El dinero de la agenda necesita libro, bandeja de descuadres y cierre con foto.** Ver §8.

---

## 1 · Índice de bloques de origen

| Bloque RT | Versión | Fecha | Qué resolvía | Sección |
|---|---|---|---|---|
| B9 · Capacidades | rt-booking 0.9.1 | 3-sep | Quién hace qué, sacado de cada terapeuta | §7 |
| B10 · Avisos de apertura | 0.9.2 | 9-sep | Saber si el enlace circuló | §10 |
| B11 · Volcado y sonda | 0.10.0 | 12-sep | De respuestas a huecos reales | §7 |
| B12, R1, R2 · Ficha correcta | 0.11.x | 12-sep | Duplicados y familias | §6 |
| G1 a G3 · Regalos y programas | gift-cards 0.10 a 0.14 | 16 a 22-sep | Canje por partes, libro, programas con código | §4 |
| B13 · Pagar al reservar | rt-booking 0.12.0 | 22 y 23-sep | Reservas sin compromiso | §2 |
| P1 a P3 · Panel de recepción | rt-panel 0.3.0 | 27-sep | El mostrador sin entrar en WordPress | §8 |
| B14 · Mi cita | rt-booking 0.15.1 | 4-oct | Cambiar o anular sin llamar | §3 |
| JACUZZI | rt-booking 0.16.0 | 4-oct | Extra con recurso pegado al tratamiento | §5.1 |
| 0.16.2 a 0.16.7 | rt-booking | 4 a 6-oct | Ajustes de operación | §2.6 |
| Reservas web | rt-panel 0.6.x | 6-oct | Lo cobrado por la web | §8.4 |
| Señales provisionales | gift-cards 0.19.0 | 6-oct | Señal de mostrador separada de los regalos | §8.5 |
| B15 · Cabinas | rt-booking 0.17.0 | 6-oct | Huecos sin cabina libre | §5 |
| CABINAS · plano | rt-panel | 6-oct | El equipo corrige la cabina | §5.3 |
| CAJA | rt-panel 0.8.0 | 6-oct | Cierre diario con lo online | §8.3 |
| Fuera de carta | informe | 6-oct | 88 servicios de Koibox sin regla | §5.4 |

---

## 2 · Pagar al reservar (B13) · para B-reservas-11 y B-reservas-13

### 2.1 El orden de operaciones [X]

Es el núcleo del bloque:

1. El **servidor** calcula el precio desde la carta. Un importe que llegue en la petición no se lee.
   [M] Un POST con `price=1` se cobró a precio de carta; con `total_cents=1`, se cobraron 101,30 €.
2. Valida el código (cheque o programa). Si no vale, para **sin escribir nada**.
3. Escribe la cita en estado pendiente de pago. **Ya ocupa el hueco.**
4. Aplica el código. Si falla porque otra persona se adelantó, anula la cita y no cobra.
5. Abre el intento de pago, o confirma directamente si el total es 0 €.
6. **Solo el webhook firmado confirma.** El navegador no.
7. A los 10 min sin pago, la cita se anula, el hueco se libera, el código se devuelve y el intento
   se cancela.

Se escribe antes de cobrar porque al revés (cobrar y después escribir) basta con que otra persona
coja la hora en medio para tener que devolver dinero.

### 2.2 Invariantes

- **Toda transición de pago es un compare-and-set** (`UPDATE … WHERE ref=? AND estado=?`). La
  carrera «pago tarde contra vencimiento» tiene un ganador determinista, y el que pierde devuelve el
  dinero o no hace nada [X]. Se descartó `SELECT FOR UPDATE`: da la misma garantía con más piezas.
- **El texto de la cita confirmada se compone al reservar y se guarda.** El webhook solo lo aplica,
  así no hay dos composiciones que puedan divergir [X].
- **La referencia pública lleva sufijo aleatorio** (`RT-12-9f3a1c02`). Con un id correlativo, el
  endpoint de estado se convierte en un directorio de citas [X].
- **Pago que llega tarde: se devuelve solo.** En el libro va la devolución y no el cobro, para no
  descuadrar la caja del día [X]. Decisión abierta a revisar.

### 2.3 Descuento online [X] (Matías, 22-sep)

El descuento por pagar online se aplica **solo a lo que se paga con tarjeta**. El cheque se gasta
contra la tarifa completa.

`resto = tarifa − código` · `total = resto − resto × %`

| Caso (tarifa 78 €, 10 %) | Paga | Le queda |
|---|---|---|
| Sin código | 70,20 € | — |
| Cheque de 50 € | 25,20 € | 0 € |
| Cheque de 120 € | 0 € | 42 € |
| Programa | 0 € (sin descuento) | una sesión menos |

La versión anterior aplicaba el descuento antes del código, y eso le regalaba al cheque parte del
descuento.

### 2.4 Lo medido [M]

En dev, con Koibox real y Stripe en modo test, 22 y 23-sep:

- el webhook confirma en 1-2 s;
- una tarjeta rechazada deja la reserva pendiente y el reintento va sobre **el mismo intento**, con
  una sola línea de cobro;
- el vencimiento a 1 min libera el hueco;
- el programa confirma a 0 € sin pasar por la pasarela;
- un cheque de 50 € deja 28 € cobrados exactos;
- cerrar la pestaña después de pagar confirma igual;
- un webhook repetido contesta `ya_estaba` y no deja segunda línea;
- firma mala, cuerpo manipulado y firma caducada dan 400 las tres.

**Bug cazado por el smoke:** un programa devuelve `cubre_cents = 0` porque gasta una sesión y no
dinero. Tomarlo literal cobraba 78 € **después** de haber quitado la sesión.

**Sin probar [D]:** 3DS, Apple Pay, Google Pay y dos personas a la misma hora.
`PRUEBAS-APERTURA.md` los deja como checklist previo a abrir, sin resultados todavía.

### 2.5 Degradación honesta [X]

- Sin pasarela configurada, el pago entero se apaga.
- Sin módulo de cheques, el campo de código no aparece: un campo que rechaza un cheque válido es
  peor que no tenerlo.
- Con el motor en solo lectura no se cobra nunca. Es el único caso en que se podría cobrar una cita
  que no existe.

### 2.6 Ajustes 0.16.x [D: mensaje del commit, sin `-done`]

- 0.16.2: el asunto del justificante dice el día y la hora de llegada. Tras anular, se pide escribir
  el código de saldo o de programa.
- 0.16.3: el teléfono es obligatorio **en el servidor**, no solo en el formulario. El título de la
  cita lleva el nombre de la carta y las observaciones dicen lo pagado, en formato corto.
- 0.16.6: el vencimiento de pagos lo hace un cron real del sistema, sin depender de visitas a la
  web.
- 0.16.7: la agenda online se abre **por meses** (mes actual + 2) en vez de una ventana móvil de 60
  días. Así las profesionales tienen margen para configurar sus horas antes de que el hueco salga a
  la venta.

### 2.7 Para este proyecto

- **Encaje con el «no Stripe» del 02-roadmap.** Lo trasladable es el **contrato de estados y el
  orden**, que vale con cualquier pasarela (Redsys, Bizum o la propia caja). Nada de lo anterior
  obliga a usar Stripe.
- **B-reservas-7 (ventana reservable).** La apertura por mes natural es un modo de ventana que
  conviene soportar junto al de N días.
- **B-reservas-6 (yield).** El TTL de 10 min y el compare-and-set ya existen aquí en el job de TTL
  de B4. Lo nuevo es la carrera pago-tarde contra vencimiento, que necesita reembolso automático.

---

## 3 · Cambiar o anular desde el enlace (B14) · para B-reservas-11 y P8

### 3.1 El enlace [X]

- Cada cita tiene un token propio de 256 bits, que no es ni el id ni la referencia.
- La página `/mi-cita/{token}/` va con:
  - `noindex`;
  - `Referrer-Policy: no-referrer`, para que el token no viaje al abrir WhatsApp;
  - sin caché;
  - escrituras por POST;
  - dos topes por IP: 60 peticiones/min y 10 tokens inexistentes/min.
- Una reserva pendiente o no confirmada se trata como enlace malo.
- La página sigue funcionando aunque la reserva online esté apagada: una cita pagada tiene que poder
  gestionarse.

### 3.2 La política, en el servidor y en cada escritura [X]

- La antelación mínima tiene un suelo de 24 h, y se valida **también al leer**: un 0 guardado antes
  no abre nada.
- El número de cambios por cita es configurable: 2 por defecto, 0 = no se puede cambiar.
- La anulación web tiene su propio interruptor.
- El servidor devuelve `puede_cambiar` y `puede_anular` junto con el texto de la política ya con sus
  cifras. Cambiar y anular **recalculan** la política antes de tocar nada; una llamada hecha a mano
  fuera de plazo devuelve 403.

### 3.3 Cambiar = mover la misma cita [X]

- Se ofrecen los huecos del mismo tratamiento, con cualquier profesional, con la misma lógica y la
  misma política que al reservar. Si la profesional de antes tiene ese hueco, se conserva.
- El cambio se aparta antes con `UPDATE … WHERE cambios = n`, para que dos pestañas no lleguen a la
  vez.
- Se **mueve la misma cita**, nunca se anula y se crea otra. Se anota «Cambiada por la clienta desde
  la web · antes: …».
- Si el hueco ya no está, se devuelve el contador y la cita queda como estaba.
- Si la cita tiene hijas (§5.1), se mueven con ella.

### 3.4 Anular: cada medio de pago vuelve a su sitio [X]

- La tarjeta, a la tarjeta o como saldo. El cheque, al cheque. La sesión, al programa.
- Transición `confirmada → anulando → cancelada`, en compare-and-set.
- **Con tarjeta: primero se devuelve el dinero y después se anula la cita.** Si falla la devolución,
  no se ha tocado nada. Si falla la agenda después de devolver, la clienta ya tiene su dinero y salta
  un aviso urgente. Se descartó deshacer una anulación ya hecha, porque en ese intervalo otra persona
  puede coger la hora.
- Sin dinero de por medio (saldo, cheque o programa), primero la agenda.
- Si un pago lleva más de 10 min en `anulando`, salta el aviso `anulacion_a_medias`.
- **El saldo de anulación** (`S-78-4F2K`) es un cheque por importe sin número correlativo: misma
  tabla y misma lógica de consumo por partes. Caduca a los 24 meses (el prompt decía 12; queda como
  duda).
- La hora de fin que ve la clienta sale de la duración de carta, no de la bloqueada en agenda
  (+10 min de recogida).

### 3.5 Lo medido [M]

En dev, el 4-oct:

- cambio de día sobre la misma cita;
- anulación con devolución: 78 € devueltos y el hueco vuelve a salir;
- anulación con saldo y uso posterior a 0 €;
- cheque más tarjeta;
- programa;
- interruptor apagado → 403;
- a menos de 24 h → 403;
- doble anulación → una sola devolución.

Sin medir [D]: el cambio a otra profesional, porque solo hay un empleado de pruebas.

### 3.6 Lo que en RT no tiene arreglo y aquí viene de serie

Si es **el centro** quien mueve o anula la cita en Koibox, el enlace de la clienta no se entera y
enseña la hora vieja. Tampoco cubre las citas de teléfono ni las de mostrador. En una agenda propia,
mostrador y web escriben en el mismo sitio y el problema desaparece. **Es un argumento de venta.**

---

## 4 · Programas, cheques y saldo contra una cita · para B-reservas-8

### 4.1 Contrato de la puerta de canje (G3) [X]

Es lo más directamente trasladable.

**`consultar(código)`** devuelve siempre las mismas claves, con un `estado` de esta lista:

| `estado` | Quién lo arregla |
|---|---|
| `sintel` (falta el teléfono) | la clienta, sola |
| `movil` | la clienta, sola |
| `ok` | — |
| `noexiste` | llamar al centro |
| `usado` | llamar al centro |
| `otro` | llamar al centro |
| `agotado` | llamar al centro |
| `caducado` | llamar al centro |

El orden de comprobación pone primero lo que la clienta puede arreglar sola. Un cheque comprado y
todavía no pagado responde `noexiste`.

**`aplicar(código, reserva)`**

- Va en una transacción que vuelve a comprobar con la fila bloqueada: «lo que dijo `consultar()`
  medio segundo antes aquí ya no vale».
- **Un solo código por reserva.** Un segundo código devuelve `ya_aplicado`.
- Cada aplicación deja una línea en el libro con la referencia de la reserva.

**`devolver(reserva)`**

- Es idempotente, y lo decide el **estado del libro**, no quién llamó antes: una cancelación puede
  llegar por dos caminos.
- Escribe la compensación enlazada con `compensa_a`.

[M] Carrera real, dos procesos por la última sesión, repetida cinco veces: siempre gana uno solo, y
no siempre el mismo. 34 pruebas contra MySQL real, porque «un `FOR UPDATE` no se puede fingir» con
una base de datos de mentira. **Aquí, contra Postgres real**, en la línea del test de integración del
EXCLUDE de B-6.

### 4.2 El libro [X]

- **Las sesiones que quedan no se guardan, se derivan** del libro: `total + SUM(movimientos)`. «No
  hay columna de usadas que pueda discrepar del libro.»
- El libro es del centro entero y solo admite inserciones.
- Cada línea lleva:
  - quién: el usuario, «Web» o «Migración»;
  - el canal: `web`, `panel` o `migracion`;
  - un `detalle` (la línea que lee recepción), distinto del `motivo` (por qué se corrige).
- **Deshacer** funciona durante 4 s **medidos en el servidor**, solo para quien escribió la línea.
  Pasado ese tiempo, se compensa con una línea de signo contrario y su motivo. Una línea ya
  compensada no se puede deshacer.
- La numeración de programas (`P<n>/<fecha>`) es atómica, sin huecos, y **no reutiliza** un número
  quemado [M].
- Los programas **no caducan**, por decisión de Raquel. Es un dato para P4 (caducidad) de nuestro
  roadmap, no una regla general.

### 4.3 Reglas de valor [X]

- Un cheque por importe vale para cualquier servicio, porque es dinero.
- Un cheque de servicio vale solo para su ficha. Si no la tiene escrita (los del papel, «1 masaje»),
  vale para toda la familia.
- **Canje por otro servicio:**
  - Si el nuevo es más barato, el resto queda como saldo en el **mismo** cheque, con el mismo código
    y la misma caducidad.
  - Si es más caro, el cheque se canjea entero y el panel dice cuánto cobrar aparte.
  - La diferencia se calcula **contra lo que se pagó**, no contra la carta de hoy.
  - [M] Un ritual de 380 € canjeado por un servicio de 33 € deja 347 € de saldo, y al deshacer vuelve
    a ser cheque de ritual.
- Por la web, un cheque caducado no se canjea. El recargo del 30 % lo decide recepción en el
  mostrador.
- En el mostrador, «qué se hace» se elige de la carta, **nunca en texto libre**. Con texto libre, el
  libro acaba con «masaje 60» y «Masaje Aromático 60 min» conviviendo.

### 4.4 No-show (lo nuevo respecto al 00) [X]

- En un programa, la sesión perdida **no es un movimiento**: sencillamente no se llama a
  `devolver()` (decisión del 17-sep).
- El operador puede saltarse la regla con justificación, y la excepción queda en el libro con quién
  y por qué.
- El texto de la política aparece en los términos, en la confirmación y en el recordatorio.

### 4.5 Aviso fiscal [D]

En RT, el cheque se trata como **bono univalente**, con el IVA al venderse (ADR-001 de
gift-cards). Pasarlo a saldo o cambiarlo de servicio exige un ajuste contable fuera del sistema. Es
el mismo frente que P5 de nuestro roadmap (asesoría) y que ADR-K3. **No se resuelve aquí.**

---

## 5 · Recursos: cabinas, bañera y aparatos (JACUZZI, B15, CABINAS) · para P7 y F2

### 5.1 Extra con recurso pegado a la cita (JACUZZI) [X]

- Un extra (bañera, 20 min, +30 €) antes o después del tratamiento son **dos citas unidas**,
  cruzadas por referencia. Cambiar mueve las dos; anular anula las dos con **una sola** devolución.
  Encaja con el `parentId`/`groupId` del delta 9 del 00.
- Los programas y cheques de servicio cubren solo el tratamiento. El extra siempre se paga aparte.
- Si el recurso se ocupa entre mirar y pagar, se reserva solo el tratamiento, no se cobra todavía y
  se ofrece la otra posición sobre el mismo intento de pago.
- Al cambiar, si el extra no cabe en la misma posición, se para sin tocar nada y se ofrece la otra
  posición o quitarlo con devolución parcial.
- Se ofrece por **lista blanca** de servicios, no por lista negra: un servicio nuevo no lo hereda.
- Al extra no se le aplican las reglas de yield, pero sí el horario del centro.

### 5.2 El hallazgo [M]

- En Koibox, el «recurso» se modela como empleada: horas-disponibles decía libre si había **una
  empleada** libre, no la bañera. Dos clientas podían coincidir en la bañera.
- El 17-oct, de 12:10 a 12:30, Koibox decía bañera libre y nuestra tabla la decía ocupada por un
  ritual real. **Dos rituales reales ya se pisaban en la bañera**: la agenda manual del centro ya hace
  overbooking de recursos, sin web de por medio.
- Al-Ándalus el 22-oct: de 10 huecos a 5, todos tumbados por regla de cabina.
- Un mes real: 288 citas, de las que 39 llevan entre 2 y 4 servicios. Hay horas fuera de rejilla
  (10:07, 13:19), que son del mostrador.

### 5.3 El modelo que salió [X]

**Datos:**

- Tabla propia: servicio → cabinas válidas, **tramo** de bañera dentro del servicio («últimos
  40 min», «primeros 60») y aparato necesario.

**Antes de enseñar un hueco:**

- Un reparto con vuelta atrás contesta: ¿hay una cabina para cada cita, con la bañera y cada
  aparato usados de uno en uno? Tope de 50.000 nodos; si se agota, el hueco no se enseña.
- Se aplica en los cuatro sitios: disponibilidad, al reservar (en fresco), al cambiar (excluyendo la
  propia cita **y su hija**) y en el extra.
- Solo se miran las citas que pisan el hueco candidato, no el día entero. Riesgo aceptado: una
  cadena de tres citas con listas estrechas puede dar un falso «cabe».

**Reglas de ocupación:**

- Una cita con varios servicios ocupa **una** cabina: la intersección de sus listas.
- Un servicio sin regla cuenta como cabina individual (lo conservador) y avisa una vez por servicio
  y día.
- Un no-show **ocupa**; solo las anuladas liberan.
- El tramo se calcula con la duración de carta, no con la de agenda, que el mostrador estira.
- **El tiempo de recogida es un dato del servicio**, no una convención de +10 min. [M] Con +10 fijo,
  unas cejas de 15 min salían como 5 de trabajo y 10 de recoger.

**Sin datos y fallos:**

- **Sin datos de ocupación, cero huecos.** Es «nunca overbooking» aplicado a nuestra propia
  ignorancia.
- Cada hueco tumbado deja escrito su motivo: `cabina`, `jacuzzi`, `aparato`, `spa-cerrado` o
  `cabinas_sin_datos`.

**Plano del mostrador (CABINAS):**

- Hay dos estados de asignación: la **propuesta** del motor y la **confirmada** por una persona.
  Manda la confirmada. La propuesta es estable aunque las citas lleguen en otro orden [M].
- Un bloqueo de cabina es una cita más para el cálculo. Quitarlo es un borrado lógico, y quitarlo dos
  veces no es un error. Motivo en lista cerrada; la nota es libre y no sale nunca hacia la clienta.
- **Mover no es «¿está libre la de destino?», sino «¿sigue cuadrando el día?».** Clavar un masaje en
  Madera puede dejar sin sitio a una Osteotherapy que solo cabe en Madera o Tierra.
- Se valida al escribir, no al leer. Validar al leer haría desaparecer citas sin avisar si cambia la
  tabla.
- Un día sin reparto posible **se pinta a medias**: lo que cabe colocado, lo que sobra marcado, y un
  aviso que nombra las dos citas con hora y profesional.
- El plano **nunca** enseña datos de la clienta. Un test vuelca el día a JSON y se cae si aparece
  alguno.
- La relectura no ocurre con la pestaña oculta ni con una hoja abierta: repintar debajo de alguien
  que está eligiendo es la forma de que confirme lo que no era.

[M] Masaje Geotermal, día 14-oct: 19 huecos con la cita propuesta; 16 al confirmarla; 19 iguales al
quitar la confirmación. Osteotherapy: 28 huecos; 24 con dos cabinas bloqueadas; 28 al quitar los
bloqueos.

### 5.4 Servicios fuera de carta (informe del 6-oct) [M]

- Koibox tiene 180 servicios, frente a 45 fichas reservables más 47 de mostrador. **88 no tienen
  regla**, y sin regla quitan huecos a ciegas.
- Esas 88 se reparten así:
  - 68 se pueden desactivar;
  - 8 tienen citas puestas;
  - 9 son **conceptos de caja** (DINERO, PLUS, TIEMPO LIBRE, DESPLAZAMIENTO, «hora premium»);
  - 3 son dudosas.
- **El servicio más usado del centro se llama «aa»**: 540 citas en 6 meses, casi seguro una
  depilación de cejas renombrada.
- Hay un estado de cita (el 6) que no estaba documentado.
- Paginar por offset sobre una agenda viva dio 11 duplicados en 5.051 filas.

### 5.5 Requisitos para este proyecto

1. `Resource` con **tres tipos**: sala o cabina, recurso compartido con capacidad (bañera) y
   aparato. Cada uno con exclusión física en BD, la extensión natural del `no_resource_overlap` de
   B4.
2. `ServiceResourceNeed` con **tramo relativo** (offset y duración dentro del servicio), no solo
   «necesita X durante toda la cita».
3. Una cita multiservicio usa **una** sala para todo el bloque, con el orden interno de servicios
   explícito.
4. El tiempo de recogida va **por servicio**. Responde a P6 (buffer).
5. Asignación propuesta frente a confirmada; al mover se valida el día entero; un día imposible se
   ve, no se oculta.
6. El modelo distingue **servicio de agenda** (ocupa persona o sala), **concepto de caja** (no
   ocupa) y **bloqueo interno** (TIEMPO LIBRE, LIMPIEZA). En Koibox todo es «servicio» y eso
   contamina la capacidad.
7. Un servicio reservable sin recursos declarados lo marca el panel de salud (B-9). No se archiva un
   servicio con citas futuras.
8. **B-reservas-10 (importación Koibox)** tiene que mapear o descartar estas cuatro familias, y no
   paginar por offset.

---

## 6 · Identidad de la clienta (B12) · para `Client` y B-reservas-10

### 6.1 Lo medido [M]

En la base real del centro, el 12-sep:

- de 17.131 fichas con móvil, 17.033 lo tienen como 9 dígitos pelados;
- **143 móviles cuelgan de 289 fichas**: un 1,7 % compartidos, normalmente madre e hija;
- una tabla local con `UNIQUE(phone)` y un solo cliente por teléfono era el error de modelo.

### 6.2 Lo que se decidió [X]

- **Una sola función de normalización del teléfono**, usada para buscar, para dar de alta y como
  clave. A un número extranjero no se le inventa prefijo.
- **La identidad es el par (móvil, nombre normalizado).** El nombre de pila tiene que coincidir y
  basta un apellido cualquiera. Comparar por posición fallaba con «María José» y con quien solo
  escribe el segundo apellido. «Mª» se normaliza a «María».
- **Orden fijo para elegir ficha:**
  1. el vínculo ya conocido;
  2. la ficha única con ese móvil;
  3. varias fichas y el nombre distingue una;
  4. varias y ninguna coincide: la de más citas, **con marca**;
  5. ninguna: alta nueva, **con marca**.

  Si el nombre casa con dos fichas, no se decide: «decir la verdad: no se sabe». El email solo entra
  si el móvil no dio nada.
- El modo en que se casó (`match_mode`) se guarda y **no se pisa al actualizar**. Hace auditable la
  suposición.
- **Minimización de datos personales.** La cita guarda el vínculo, no una copia del nombre y el
  móvil.
- Abierto [H]: si el centro fusiona dos fichas, el vínculo no se invalida.

### 6.3 Lo que se marca tiene que verse sin abrir (B12-R1 y R2) [M]

- La marca «revisar ficha» vivía en observaciones, y la tarjeta de la agenda no las enseña.
- Después se puso al final del título, y la tarjeta **recorta por la derecha**: en citas de 15 min
  se perdía justo el aviso.
- Pasó a **prefijo**: `REVISAR · Reserva web · …`.

**Requisito de la rejilla:** lo que exige acción va delante, o como insignia que no dependa del
ancho. Se diseña para la cita más corta.

### 6.4 Para este proyecto

- `Client.phone` **no** puede ser `UNIQUE`. Revisar B-reservas-1. Hay que comprobar contra
  `schema.prisma` si hoy lo es: no se ha mirado al escribir esto.
- Un alta desde la web (B-11) necesita esta misma resolución y una cola «revisar ficha» en el
  mostrador.
- Fusión de fichas con redirección de referencias.

---

## 7 · Quién hace qué y los horarios reales (B9, B11, horarios) · para B-3, B-7 y B-9

### 7.1 Competencias [X]

- **Tres estados por servicio:** «lo hago», «me atrevería» y «no». Solo «lo hago» habilita la
  reserva. «Me atrevería» es un mapa de formación. **«Sin contestar» no es «no».**
- Se capturan **con cada profesional, en su móvil**, con un enlace con token. En el arnés: 111
  botones de 44 px y 1,1 ms hasta el feedback [M].
- La cobertura se calcula **sin el perfil comodín** (la dueña). Si no, «nadie lo hace» es falso, y lo
  verdadero es «solo lo haces tú»: si la web abre esa ficha, la cita cae siempre en su agenda.
- El catálogo del centro y el catálogo reservable online son **conjuntos distintos**, y los dos
  cuentan para la cobertura.
- Los rechazos de identidad no se distinguen entre sí: distinguirlos convertiría un enlace filtrado
  en un censo del centro.
- El tope de escrituras va **por token, no por IP**, porque todas contestan desde el mismo wifi.

### 7.2 Lo medido [M]

El 9-sep, en dev:

- 7 de 7 cerradas: 273 pares y 234 «lo hago».
- Caen sobre 44 de 45 servicios. El que falta es `facial-estrella`: cinco «me atrevería», dos «no» y
  ningún «lo hago». **La web lo ofrecería y no daría ni un hueco.**
- La documentación interna tenía cruzados los ids de dos empleadas: el ensayo se planificó con el
  dato malo.

### 7.3 Horarios reales [D, de las notas a mano de mayo]

- Turnos partidos (9:30-14:30 + 15:30-21:30).
- **Alternancia cada 2 semanas.**
- Sábados pagados aparte.
- Jornadas de 36 h y de 30 h.
- Una persona que quizá solo hace mostrador.
- Diseño: **149,5 h/semana** [H], frente a las 371 declaradas en Koibox (las 371 ya están en el 00).
  Con unas 125 h de entrega, la ocupación real rondaría el 84 % [H], no el 34 %.

### 7.4 Para este proyecto

- `StaffSkill` pasa de booleano a tres estados. Revisar B-reservas-3.
- `StaffShift` (rrule) tiene que soportar turno partido, **ciclos de N semanas** y excepciones por
  día. Hay que comprobar que la plantilla de B-3 lo hace.
- Un rol «solo mostrador» que no genere ventana reservable.
- Horario del centro y horario de la persona son entidades distintas, y «cerrado» se pinta distinto
  de «sin personal». Ya está en el alcance de B-7.
- **Tarjetas nuevas para el panel de salud (B-9):**
  - «se ofrece y no dará hueco nunca», nombrando quién se atrevería;
  - «solo lo hace X» y «depende de una sola persona»;
  - «servicio reservable sin recursos declarados» (§5.5);
  - «ventana reservable desproporcionada frente al turno», como el comodín de 12 h × 6 días.

---

## 8 · Recepción, caja y dinero de la agenda (rt-panel) · para el mostrador y el cierre

### 8.1 El mostrador pinta, no interpreta [X]

- Lo que cruza a la pantalla llega ya formateado (`cuando_txt`, `dinero_txt`). La UI no tiene
  reglas de negocio.
- «No puedo leer» y «no hay nada» son dos estados distintos en la API y en la pantalla. Una lista
  vacía cuando no se pudo leer diría «no hay cheques», «que es mentira y además la mentira
  peligrosa».
- El buscador de clienta (por código, móvil o nombre) va lo primero en el inicio, y los avisos
  debajo, sin poder cerrarse: «un aviso de dinero que no se ve no se atiende».
- Un usuario por persona, porque el libro tiene que decir quién hizo qué. Queda pedido el **cambio
  rápido de usuaria con PIN**: si no es rápido, acaban compartiendo usuario.

### 8.2 Bandeja de descuadres [X]

- Cada estado intermedio con dinero (cobro sin cita, devolución fallida, cobro tardío devuelto) es
  una **fila escrita en el momento del fallo**, en el mismo `catch`, no buscada después.
- Se resuelve con botones que dicen lo que se ha hecho («Ya tiene cita», «Hablado con la clienta»),
  con quién y cuándo. Nunca se descarta con una aspa.
- Un pago que venció sin cobrar **no** es un aviso: es lo normal.
- Los avisos salen de estados que pueden darse de verdad, no de los que dibujaba el mockup. Un aviso
  que no puede saltar nunca no se construye.

### 8.3 Cierre de caja con lo online (CAJA 0.8.0) [X]

- Una línea por forma de pago, con el total del mostrador separado del online.
- Las devoluciones de reservas no restan en la caja: van en «Reservas web».
- **Validar** es dar el OK a lo que se ve, sin escribir lo contado. Se guarda quién, cuándo y **qué
  totales vio**, junto con una huella de los datos. Si entra un cobro mientras se mira, se rechaza y
  pide recargar [M].
- El histórico usa tres etiquetas: «Automático · sin validar», «Validado» y «Validado · cambió
  después».
- El cierre automático **no depende de un cron**: la foto de un día terminado se saca la primera vez
  que alguien abre la caja después de medianoche. Un día sin cobros no genera cierre a 0 €.
- Un pago mixto exige el reparto, y se rechaza si no suma [M]. Los mixtos antiguos sin reparto van
  en un aviso aparte y no suman: «mejor un aviso que un número falso».
- La forma de pago vive en el **movimiento del libro**, no en el cheque ni en el programa.

**⚠️ Cruzar con `docs/normas/` y la norma de cierre de caja diario de este proyecto antes de copiar
nada.** Aquí ya hay una norma (un cierre por día de negocio y por caja). Lo de RT es un cierre
**validado** sobre totales, no un arqueo contado. No es lo mismo.

### 8.4 Informe de lo cobrado online (Reservas web 0.6.x) [X]

- Se puede ver por día, semana, mes o año, y por forma de pago: tarjeta, cheque, saldo o programa.
- El eje es **el día del pago** por defecto, con un selector para cambiar al día de la cita y las dos
  fechas en cada fila (Matías, 6-oct: «las dos cosas»).
- Entran los pagos confirmados aunque luego se anularan, como «Anulada» y con lo devuelto. Los que
  vencieron sin pagar no entran. Así **el total cuadra con la pasarela**.
- Los límites del día se calculan en la hora de Madrid y se pasan a UTC para filtrar; está probado
  con pagos a las 00:30 [M].

### 8.5 Señal de reserva (gift-cards 0.19.0) [X] (Matías, 6-oct)

- **Provisional en RT:** mientras la reserva online no está en producción, el spa cobra señales por
  teléfono o en el mostrador. Antes las apuntaba como cheques regalo, y eso mezclaba las cifras de
  regalos.
- Ahora tiene su propio código (`R-30-4F2K`: «R» de reserva, los euros con los que nace y cuatro
  caracteres al azar) y su propio canal, `senal_reserva`. Funciona como un cheque por importe, pero
  sin número del libro.
- [M] En el libro de papel, 77 apuntes «Reserva / señal» no dejaban saber si eran un cheque o un pago
  a cuenta, y se quedaron fuera de la carga.

**Requisito para B-reservas-13:** la señal es un **pago a cuenta de una cita concreta**, con su
propio tipo en el libro, desde el primer día. Si no se distingue desde el principio, el histórico se
vuelve ambiguo, como ya ha pasado en el papel.

### 8.6 Patrones transversales

- **Correos y efectos que no se pueden deshacer** salen al acabar la ventana de deshacer, no al
  pulsar. Si el correo falla, el estado se queda hecho: volver atrás «sería mentir sobre el mundo
  físico».
- **Fechas:** se pintan en la hora del centro y se guardan y calculan en UTC. [M] Con todo en UTC,
  una venta a las 00:30 salía con el día anterior. Los tests corren en UTC y se comprobó que se ponen
  rojos con el código viejo.
- **Las rutas de estado de pago y de cita no se cachean.** [M] La pantalla final no llegaba nunca
  porque la caché del servidor y la del CDN servían la respuesta vieja.
- **El dinero nace solo con el webhook.** Cerrar la pestaña no gasta número ni deja nada en vigor
  [M].
- **Errores honestos:** un fallo nuestro no se presenta como «el banco no ha aceptado la tarjeta».
- **Un único resolver de precio en el servidor.** [M] El precio de un ritual vivía en tres sitios:
  «enseñar 58 € y cobrar 55». Ocultar un servicio cierra la reserva, pero lo ya vendido sigue
  valiendo, y la confirmación lo dice con cifras («7 cheques y 2 programas siguen valiendo»).

---

## 9 · Divergencias con lo que ya hay aquí

Anotadas, no resueltas. Manda este proyecto.

| # | En RT | Aquí | Qué hacer |
|---|---|---|---|
| D-A | La granularidad la da el servicio. La rejilla de 15 min es una limitación de Koibox que obligó a trucos (§5.1) [M] | El kickoff hereda «retícula 15 min sin cambios» | Revisar al tocar el motor en B-6. No reabrir sin motivo |
| D-B | Pasarela Stripe | «No Stripe», pasarela por decidir (B-13) | Lo trasladable es el contrato de estados (§2), no la pasarela |
| D-C | `is_disponible_online` como posible segundo interruptor (B11) [H] | El 00 §1.2 dice [M] que no gobierna | Solo afecta a B-10. Medirlo con las sondas K2 |
| D-D | Cierre validado sobre totales con foto y huella | Norma de cierre diario, por día de negocio y caja | Cruzar antes del bloque de cierre de caja |
| D-E | Un fallo al anotar en el libro **no** tumba el canje | Aquí el libro fiscal es append-only y manda | No copiar sin decidirlo |
| D-F | Caducidad del saldo: 24 meses (el prompt decía 12) | P4 abierto | Lo decide P4 |

---

## 10 · Proceso: lo aprendido sobre cómo se trabaja

- **El mockup del repo era una copia vieja**, y a partir de él se inventó una «decisión de producto»
  que no existía (B9). Antes de tratar una diferencia como decisión, comprobar que el mockup es el
  vigente.
- **`build.sh` empaquetaba de menos** y así estaba desplegado (B10). Las listas de «lo esperado» se
  derivan del código, y el build falla si falta algo.
- **Las marcas operativas viven en datos editables**, no en constantes: «se quita en una línea» era
  falso, porque implicaba pruebas, empaquetar y redesplegar. Al leer registros viejos, distinguir
  **clave ausente** de **clave vacía**.
- **Los recuentos se validan por un camino independiente.** Ya hubo desajustes de 2 entre cierres
  (536 frente a 534, 696 frente a 694).
- **Avisos automáticos (B10), aplicable a los recordatorios de B-12:** primero se marca y después se
  envía; se prefiere perder un aviso a mandarlo dos veces. El fallo queda visible con su motivo, y
  hay un botón «Probar aviso».
- **Las pruebas de UI** se hacen con capturas a 320 y 390 px, con pulsables de 44 px o más y sin
  scroll lateral, medidas sobre la página renderizada.
- Un `array_merge` que renumeraba claves perdía el segundo guardado en silencio. Solo lo cazó la
  prueba de punta a punta, no el smoke.

---

## 11 · Qué toca en el roadmap (propuesta, no aplicada a `02-roadmap-agenda.md`)

| Bloque de aquí | Qué añade esta entrega |
|---|---|
| **B-reservas-1 · CRM** (cerrado) | Deuda: el teléfono no es único; resolución (móvil, nombre) con `match_mode`; fusión de fichas (§6) |
| **B-reservas-3 · Personal** (cerrado) | Deuda: `StaffSkill` con tres estados; ciclos de N semanas y turno partido; rol solo mostrador (§7) |
| **B-reservas-6 · Yield** | Carrera pago-tarde contra vencimiento con reembolso (§2.2) |
| **B-reservas-7 · Ventana** | Modo de apertura por mes natural (§2.6) |
| **B-reservas-8 · Programa** | El contrato `consultar` / `aplicar` / `devolver`, el saldo derivado del libro, el deshacer de 4 s en servidor y los canjes cruzados (§4) |
| **B-reservas-9 · Salud** | Cuatro tarjetas nuevas (§7.4) |
| **B-reservas-10 · Importación** | Las cuatro familias de «servicio», sin paginar por offset, y la identidad (§5.4, §6) |
| **B-reservas-11 · Online** | Pago al reservar (§2), enlace de autogestión (§3) y extras con recurso (§5.1) |
| **B-reservas-12 · Recordatorios** | Marcar y después enviar, fallo visible y botón de prueba (§10) |
| **B-reservas-13 · Señal** | La señal es un pago a cuenta con tipo propio (§8.5) |
| **P7 / F2 · Recursos** | **Entran en v1**: hay overbooking medido (§5) |
| **Nuevo · Recepción** | Bandeja de descuadres, informe online con eje pago/cita y cierre con foto (§8) |

*Mi Piace Internet Solutions · segunda entrega desde Raquel Torres · 7-oct-2026.*
