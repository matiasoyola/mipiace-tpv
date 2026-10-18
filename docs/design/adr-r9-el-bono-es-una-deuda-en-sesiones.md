# ADR-R9 · Un bono es una deuda del centro, medida en sesiones

_2026-10-18. Decide qué es un bono de sesiones en este sistema, dónde vive su saldo, cuándo se
descuenta, qué pasa con el dinero y qué queda pendiente de la asesoría. Es el ADR del bloque
**B-reservas-8** y cierra la decisión **D-2** del cruce con B-reservas-4 (`docs/reservas/01`) y la
**P2** de su tabla de pendientes._

---

## 0. Tesis en una frase

Un bono **no es dinero, es una deuda en sesiones**: el centro cobra hoy y debe cinco quiropodias.
De ahí se sigue todo lo demás — el saldo se deriva de un libro de solo inserción, el dinero vive
en el ticket y no se duplica, la sesión se **aparta** al dar la cita y se **consume** al cobrarla,
y una sesión nunca se gasta contra un servicio que el bono no cubre.

## 1. Contexto

Cuatro hechos, con fecha:

- **Siempre.** `Appointment.voucherId` existía desde B-reservas-4 como **una columna suelta**, sin
  tabla, sin FK y comentada «sólo la columna». `GET /clients/:id/vouchers` devolvía `[]` a
  propósito desde B-reservas-1, con el contrato ya publicado. Quien vende bonos —Sole, la
  podóloga, el spa— los lleva en papel o en otro programa.
- **23-09-2026.** mipiacetpv pasa a ser el SIF de las cuentas sin Holded (ADR-019). La premisa
  con la que se escribió la primera versión de este bloque —«la venta del bono se registra en
  Holded»— deja de ser verdad para justo los clientes que venden bonos.
- **07-10-2026, solape S6.** Dirección decide los **dos pasos**: apartar al citar, descontar al
  cobrar. La versión anterior del bloque descontaba al dar la cita, y eso hacía que anular una
  cita tuviera que «devolver» una sesión ya gastada.
- **18-10-2026, tercera entrega de Raquel Torres** (`docs/reservas/07`). El spa trae medido lo
  que aquí todavía no se había pagado: el libro de solo inserción, la separación entre dinero y
  deuda, el candado de primer uso de la numeración, y que «filas afectadas = 0» no es un candado.

## 2. Lo que NO se decide aquí (frontera dura)

- **Los cheques por importe, los saldos `S-` y los cheques regalo** (bloque **B-cheques**). El
  modelo los admite —`Voucher.type`, `amount_total_cents`, `amount_left_cents`— y el libro es el
  mismo, pero aquí no se construye ninguno.
- **Las señales `R-`** (pago a cuenta de una cita): B-13.
- **La venta online de bonos y el canje en la reserva online**: B-11. La puerta queda lista.
- **El IVA del bono univalente**: es **P5**, está en §6 y la respuesta la da la asesoría.
- **La devolución parcial** de un bono con sesiones usadas: exige decidir cuánto vale una sesión
  suelta de un bono vendido con descuento, que es la misma pregunta de P5.

## 3. Decisión 1 · El saldo extiende `voucher`; no hay `Program`

**Alternativas descartadas:**

| Alternativa | Por qué no |
|---|---|
| `Program` / `ProgramBalance` / `ProgramConsumption` (lo que proponía el documento de B-reservas-4) | Dos sitios donde mirar el saldo de una clienta, dos caminos fiscales y dos formas de canjear en caja. Es el error que ADR-R1 evitó con el catálogo. |
| Un contador `sessions_left` y nada más | No contesta «¿y por qué le quedan tres?». Una clienta que dice «yo tenía cinco» no se resuelve con un número. |
| Un libro **sin** columna de saldo | El decremento condicionado («no aparto si no queda libre») tendría que recalcular el libro entero con la fila bloqueada en cada cita, y la rejilla de la agenda lee el saldo cincuenta veces por pantalla. |

**Decisión:** `Voucher` + `VoucherMovement`, con `VoucherTemplate` 1:1 sobre `Product`.

- **El libro es LA VERDAD** y es de solo inserción (trigger `voucher_movements_append_only`). Se
  corrige con una línea contraria enlazada (`compensa_a`) y su motivo; nada se edita.
- `sessions_left` y `sessions_reserved` son **caché**, y hay un test que recorre 200 operaciones
  aleatorias comprobando en cada paso que
  `total − consumidas − apartadas vivas = libres` y que la caché coincide. **Si discrepan, manda
  el libro.**

### 3.1 El convenio del signo, y por qué vive en un CHECK

`sesiones` es el efecto de la línea sobre las sesiones **libres**, así que `libres = SUM(sesiones)`
es una sola suma sobre el libro del bono. La pieza que lo cierra: una `CONSUMIDA` vale **0**
exactamente cuando viene de una cita —la sesión ya salió de libres al apartarse— y **−1** cuando
no (el canje en caja sin agenda, que no pasa por `APARTADA`).

Eso **no es documentación**: es el CHECK `voucher_movements_signo_por_tipo`, con esa equivalencia
escrita. Con el CHECK puesto, el invariante del libro no puede desalinearse sin que la base
rechace la fila; sin él, se desalinearía en silencio y se vería semanas después en un informe.

## 4. Decisión 2 · Dos pasos: apartar al citar, consumir al cobrar

| Alternativa | Por qué no |
|---|---|
| Descontar al dar la cita (lo que decía la primera versión del bloque) | Anular una cita tiene que «devolver» una sesión ya gastada, y entonces el libro cuenta un consumo que no existió. Y una cita que acaba cobrándose como otra cosa habría gastado la sesión equivocada. |
| Descontar sólo al cobrar, sin apartar | Nada impide dar seis citas de bono con cinco sesiones. El problema aparece en el mostrador, con la sexta clienta delante. |

**Decisión:**

1. **Al dar la cita se APARTA** una sesión (`APARTADA`), **en la misma transacción que la cita**.
   No descuenta: sólo impide dar más citas de bono que sesiones quedan. El apartado va DESPUÉS de
   los assignments —que son los que disparan el `EXCLUDE` del anti-solape— para no bloquear la
   fila de un bono y luego soltarla; y si el hueco se pierde, **no queda nada apartado**. Si no
   queda sesión libre, **la cita no nace como cita de bono** y el 409 lo dice con su motivo: el
   cajero puede darla normal repitiendo el alta sin bono.
2. **Al cobrar, lo apartado pasa a CONSUMIDA** contra **lo que se hizo**. Si lo hecho no lo cubre
   el bono (clinica-3: se cobra lo que se hizo, no lo que se reservó), **lo apartado se libera** y
   la línea se cobra normal. **Nunca se consume un bono contra un servicio que no cubre.**
3. **Anular libera.** **No-show**: lo decide el centro (`Tenant.bonoNoShow`, `consumir` por
   defecto, que es lo que hace el spa).

`consumir()` y `liberar()` son **idempotentes y las decide el estado del libro**, no quién llamó
primero: una anulación puede llegar por dos caminos, y «filas afectadas = 0» no distingue «no me
tocaba» de «ya estaba».

## 5. Decisión 3 · Dinero y deuda van por separado

El bono congela al venderse **dos cifras**:

- `valor_carta_cents` — **lo que el centro debe**. Es lo que vale el bono en sesiones aunque se
  vendiera con descuento o se regalara.
- `cobrado_cents` — **lo que entró**. Es un espejo del ticket (`sold_ticket_id`,
  `sold_ticket_line_id`), no una segunda contabilidad: el libro **no duplica el cobro, lo
  enlaza**.

Y el bono **nace cuando el ticket pasa a `PAID`**, en la misma transacción y justo después del
sello de S1 — el mismo sitio que el registro de facturación y por la misma razón: cuando la venta
ya es una venta. Un ticket que no se cobra no gasta número de bono.

### 5.1 El candado de primer uso NO tumba la venta

La numeración es `B<n>` por centro, atómica, sin huecos, y **se salta un número que ya exista** (el
spa se encontró uno que había llegado desde dev). Y tiene candado: hasta que el encargado confirma
por qué número empieza el talonario, no se emite ningún bono.

Si una venta incluye bonos y el candado está puesto, **la venta sigue**: el bono se queda sin
emitir, se anota en el log y la respuesta lo dice. **Cobrar siempre se puede** — tumbar el cobro
dejaría a una cajera sin poder vender nada en un centro al que nadie le configuró la numeración.

## 6. Lo que falta: P5, el IVA del bono univalente

**Esto es una pregunta abierta, no una decisión.** Está escrita aquí para poder mandarla.

Al canjear una sesión, la línea del servicio puede:

| Opción | Qué declara la línea | Qué cambia en el registro fiscal | Qué queda por decidir |
|---|---|---|---|
| **`LINEA_CERO`** (el default) | 0 €. El dinero entró al vender el bono y ahí se declaró su IVA (bono univalente, criterio de ADR-001 de `rt-gift-cards`). | El ticket de canje es una venta de 0 €: base 0, cuota 0. Con el servicio exento (art. 20), `OperacionExenta = "E1"` y base 0. | Si la AEAT admite una factura simplificada de 0 € como justificante de una prestación ya cobrada, o si hace falta otro documento. |
| **`PRORRATEO`** | `valor_carta / sesiones`. Es lo que haría falta si el IVA se devenga **al canjear** y no al vender. | La línea declara base y cuota de verdad en el momento de la prestación, y la venta del bono tendría que haber sido un **cobro anticipado** y no una venta. | **Cómo se liquida ese importe.** El dinero entró al vender el bono, así que el ticket de canje tiene un total distinto de cero que nadie paga. No con el método `VOUCHER`: una sesión no es un pago, es una línea. Esta pregunta es parte de P5 y **este bloque no la contesta**. |

**Mientras P5 no esté contestado aquí por escrito, `bonosEnabled` no se enciende en ninguna
cuenta real.** La alternativa `PRORRATEO` existe, es un ajuste (`Tenant.bonoModoCanje`) y tiene
test por los dos lados: cambiarla el día que llegue la respuesta es un `UPDATE`, no un despliegue.

### 6.1 La pregunta, lista para mandar a la asesoría

> Un centro vende un «bono de 5 quiropodias» por 150 €. La quiropodia está exenta de IVA por el
> artículo 20 (servicio sanitario prestado por profesional titulado). La clienta paga los 150 € el
> día 1 y va gastando las cinco sesiones a lo largo de seis meses.
>
> 1. ¿El devengo es el día 1 (venta del bono, importe 150 €) o cada vez que se presta una sesión?
> 2. Si es el día 1: cuando la clienta viene a su tercera sesión, ¿hay que entregarle algún
>    documento? ¿Vale una factura simplificada de 0 € que diga «quiropodia · pagada con el bono
>    B87»?
> 3. Si es en cada sesión: la venta del bono deja de ser una venta y pasa a ser un cobro
>    anticipado. ¿Qué documento se entrega el día 1, y cómo se liquida el importe de cada sesión
>    en el ticket de canje, si el dinero ya entró?
> 4. ¿Cambia alguna de las tres respuestas si el servicio NO es exento (un bono de 5 masajes al
>    21 %)?

## 7. Decisión 4 · Sólo en cuentas sin Holded, por ahora

Un ticket de canje a 0 € subido a Holded es terreno desconocido —qué documento es, qué declara,
cómo cuadra con la venta del bono— y no lo necesita nadie hoy: Sole salió de Holded, y la clínica
y el spa no lo tienen.

**`bonos_enabled` no se puede encender con Holded conectado**, y eso vive en **dos sitios**: el
409 de la ruta del super-admin y el CHECK `tenants_bonos_sin_holded` de la base. Hay cuatro
puertas de escritura a `tenants` —el panel, el super-admin, el fichero de una implantación y el
psql de una tarde— y sólo el motor cubre las cuatro.

Y **apagarlo con sesiones sin usar tampoco**: eso es dinero cobrado y no entregado, y apagar el
módulo lo dejaría guardado y sin forma de canjearlo.

## 8. Decisión 5 · La puerta no elige, y el sanitario no ve euros

- **La puerta de canje** (`vouchers/gate.ts`) es la única forma de tocar un bono desde fuera del
  módulo. Si dos bonos vivos de la clienta cubren el mismo servicio, **devuelve los dos** y el
  front pregunta. Elegir el primero por fecha sería gastar el de 10 sesiones en vez del de 1 que
  caduca el viernes, y no se notaría hasta que el de 1 caducara con una sesión dentro.
- **El sanitario sin caja ve sesiones y ningún euro**, y no porque se oculten: `BonoSinDinero` **no
  tiene** esas propiedades, así que un campo de euros no se puede colar sin que el compilador se
  queje. Un test vuelca el JSON entero y busca claves **y valores** de dinero.

## 9. Consecuencias

**A favor:**

- La venta, el saldo, la cita y el ticket son **el mismo sistema**. En Koibox los bonos no salen
  ni por la API; aquí el diferencial comercial es que sí.
- **B-cheques es aditivo**, no un rediseño: el libro es el mismo y el CHECK
  `vouchers_tipo_coherente` garantiza que un bono de sesiones y un cheque por importe no se
  mezclen.
- La traza legible («qué cita apartó, qué ticket consumió, quién corrigió y por qué») contesta en
  el mostrador la conversación que hoy se resuelve de memoria.

**En contra, y asumido:**

- **Una columna de caché** (`sessions_left`) que puede discrepar del libro. Se asume por lo que
  cuesta no tenerla, y se acota con un CHECK en la base y un test de 200 operaciones.
- **No hay job de caducidad.** La verdad es `expires_at` y la puerta la mira siempre, así que un
  bono caducado nunca se aparta ni se consume; la columna `status` se pone al día cuando alguien
  lee la ficha. Un bono caducado que nadie mire sigue diciendo `ACTIVO` en su fila, y el informe
  de «saldo vivo sin cita» de `agenda/health.ts` lo cuenta. Dicho en el `-done`.
- **`modoCanje` parametrizado** es una rama que no se usa en producción hasta que P5 se conteste.
  Es el precio de no inventarse una respuesta fiscal.

---

_Mi Piace Internet Solutions · ADR-R9 · 18-oct-2026._
