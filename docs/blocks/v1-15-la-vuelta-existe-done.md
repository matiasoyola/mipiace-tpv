# Bloque v1.15 · La vuelta existe — DONE

Origen: `docs/code-prompts/bloque-v1-15-la-vuelta-existe.md`.
Contexto: `docs/qa/2026-09-02-auditoria-por-procesos.md` (B1 y C1) y
`docs/qa/2026-09-02-backlog-ordenado.md`.

**Para el TPV, la vuelta no existía.** El importe entregado se guardaba donde el resto del sistema
lee el importe cobrado, y desde ahí el error se repartía por tres capas: el cierre de día, el ticket
térmico y la pantalla de confirmación. El bloque ataca el origen, una sola vez, y las tres víctimas
se curan solas.

Suite antes de empezar: **169 ficheros, 1495 tests**. De esos, **tres afirmaban el bug**
(`payments[].amount` = lo entregado) y se han reescrito, no borrado — están señalados abajo.
Suite al cerrar: **173 ficheros, 1534 tests** (3 skipped legacy de Redis), `tsc --noEmit` limpio en
todo el workspace y `vite build` del TPV verde.

---

## El número que cambia

El turno de la auditoría: dos tickets, **#000019 = 4,70 €** cobrado **mixto** (2,00 € en efectivo +
2,70 € en tarjeta, el reparto que describe C2) y **#000020 = 3,00 €** pagado con un billete de 5.
Fondo de caja 50,00 €. De ahí salen exactamente los cuatro números que reportó el AP11.

| | Antes (v1.14.1, medido en el AP11) | Ahora |
|---|---|---|
| Ventas del día | **9,70 €** | **7,70 €** |
| Efectivo (bruto y neto) | **7,00 €** | **5,00 €** |
| Tarjeta | 2,70 € | 2,70 € |
| Efectivo esperado en el cajón | 57,00 € | **55,00 €** |
| Contado real (fondo + 2,00 + 3,00) | 55,00 € | 55,00 € |
| **Descuadre** | **−2,00 €** | **0,00 €** |
| Línea CAMBIO en el ticket térmico | **no se imprimía nunca** | 2,00 € |
| Línea Cambio en el PDF | 2,00 € (por accidente, ver §3) | 2,00 € |
| Total / entregado / cambio en "Ticket emitido" | nada | **CAMBIO 2,00 € a 48 px** |

---

## 1 · `payments[].amount` es lo aplicado, nunca lo entregado

La regla vive en **un solo sitio**, `packages/ticket-model/src/payments.ts`, porque son cuatro los
caminos que tienen que decir lo mismo: el payload del TPV, la persistencia de la API, el cambio
impreso y el backfill del histórico.

```
applyPaymentsToTotal(rows, total) →
  · las filas que NO son efectivo conservan su importe
  · las de efectivo se recortan, en orden, a lo que queda por cubrir
  · las que quedan a cero se descartan
  · `change` = entregado − aplicado en efectivo
```

El exceso siempre sale del efectivo. Un billete de 20 sobre 14 son 6 de vuelta; 15 € en TARJETA
sobre 14 son 1 € cobrado de más al cliente y la tarjeta no devuelve cambio. Por eso el reparto deja
intacta la fila de tarjeta y recorta la de efectivo, y no al revés — que es lo que haría un tope
"goloso" por orden de fila.

**Ejemplo mixto** (4,70 € con 2,70 de tarjeta y un billete de 5):
`CASH 5,00 + CARD 2,70` → se persiste `CASH 2,00 + CARD 2,70` (Σ = 4,70) y `cashAmount = 5,00`,
vuelta 3,00 €.

**Front** (`CheckoutPage.tsx`): las filas siguen siendo lo que teclea el cajero —eso es lo que él ve
y con eso se calcula el cambio en pantalla—; lo que se topea es el payload. `cashAmount` sigue
llevando el efectivo entregado, como ya hacía.

**Servidor**: las dos puertas —venta rápida `POST /tickets` y cobro de mesa
`POST /tickets/:id/checkout`— pasan por `tickets/normalize-payments.ts` antes de persistir.

**El tercer camino, comprobado**: `tickets/partial-payment.ts` **no** materializa `TicketPayment`
(el `usePartialPayments` de su cabecera es un comentario: no existe en el código, ni en la API ni en
el TPV). Los cobros parciales viven en `ticket_partial_payments` y el checkout final manda sus
propios `payments[]`, que ya entran por la puerta nueva. Los cobros de deuda
(`tickets/credit-routes.ts`) tampoco necesitan nada: ya topean `amount` contra el pendiente desde
v1.8 y nunca escriben `cashAmount`. Ver "Hallazgos nuevos" para lo que sí apareció mirando esto.

### Decisión: el servidor NORMALIZA, y rechaza sólo lo que no puede normalizar

El prompt dejaba abierto "normaliza o rechaza". **Normaliza**, y devuelve **400
`PAYMENT_EXCEEDS_TOTAL`** únicamente cuando Σ(no efectivo) supera el total.

- **Normalizar y no rechazar** porque hay APKs 1.14.1 en la calle y el outbox del TPV puede llevar
  ventas encoladas de antes de la actualización. Un 400 dejaría clavadas ventas que ya ocurrieron
  físicamente: peor que el bug que se arregla. Al topear, esos tickets viejos entran ya correctos —
  hay un test para ese caso exacto ("cliente viejo que manda el billete SIN cashAmount").
- **Rechazar el exceso en tarjeta** porque ahí no hay vuelta que valga: es dinero cobrado de más al
  cliente y no se puede normalizar sin inventarse de dónde sale. El modal ya lo bloquea desde
  v1.10.3-addendum (`overNotRefundable`); esto es la red del servidor.

El invariante que sale de las dos puertas: **no se puede persistir un pago mayor que su parte del
total.** Σ payments == total (±1 cént.) y el sobrante entregado vive sólo en `ticket.cashAmount`.
Cuando hay que topear, queda una línea de log con el ticket, el total y la vuelta.

`PAYMENTS_MISMATCH` (Σ payments **menor** que el total) sigue igual, y `z-breakdown.ts` no se ha
tocado ni una línea: arreglado el origen, queda bien solo.

---

## 2 · Backfill del histórico

**El `SELECT` está escrito y NO se ha ejecutado.** La base de producción vive en el VPS
(`ssh root@76.13.142.28`, contraseña en hPanel, ver `docs/deploy/hostinger.md`) y desde aquí no hay
acceso; conectarse a producción es una decisión de Matías, no mía. El fichero está listo para pegar:

**`docs/blocks/v1-15-la-vuelta-existe-select.sql`** — sólo lee, se puede lanzar con el TPV vendiendo.

```sql
WITH t AS (
  SELECT tk.id, tk.tenant_id, tk.internal_number, tk.created_at,
         tk.total::numeric AS total,
         tk.cash_amount::numeric AS cash_amount,
         COALESCE(SUM(tp.amount), 0)::numeric AS payments_sum,
         COALESCE(SUM(tp.amount) FILTER (WHERE tp.method = 'CASH'), 0)::numeric AS cash_sum
  FROM tickets tk
  JOIN ticket_payments tp ON tp.ticket_id = tk.id
  WHERE tk.cash_amount IS NOT NULL
  GROUP BY tk.id
), afectados AS (
  SELECT *, (payments_sum - total) AS exceso FROM t
  WHERE payments_sum > total + 0.005
    AND cash_sum >= payments_sum - total - 0.005
)
SELECT COUNT(*) AS tickets_afectados,
       ROUND(SUM(exceso), 2) AS importe_inflado_eur,
       MIN(created_at) AS primer_ticket, MAX(created_at) AS ultimo_ticket,
       COUNT(DISTINCT tenant_id) AS tenants
FROM afectados;
```

El fichero trae además el desglose por tenant y la lista de casos raros (Σ pagos > total sin
efectivo que lo explique), que son los que el backfill **no** toca.

Cómo lanzarlo:

```
ssh root@76.13.142.28
docker compose exec -T postgres psql -U mipiacetpv -d mipiacetpv \
  -f - < docs/blocks/v1-15-la-vuelta-existe-select.sql
```

**Resultado: pendiente.** Con ese número se decide si el backfill entra en esta ventana o en una
aparte. Siguiendo la instrucción del bloque ("sin él, sigue con el resto del alcance"), el resto
está entero; y el backfill se ha escrito igualmente porque la tabla de sabotajes lo exige y porque
es inerte hasta que alguien escriba `--apply`:

```
pnpm --filter @mipiacetpv/api backfill:vuelta            # informa, no escribe
pnpm --filter @mipiacetpv/api backfill:vuelta -- --apply # escribe
```

El informe sale con los mismos números que el `SELECT` (tickets afectados, importe inflado, rango,
desglose por tenant, y la lista de lo que no se toca). El plan es una función pura,
`tickets/backfill-vuelta.ts`, probada sin BD; el script sólo hace la E/S, con una transacción por
ticket (`update` sobre PK de `ticket_payments`) para no tomar un lock largo sobre la tabla con el
TPV vendiendo.

**Idempotente por construcción**: después de la pasada Σ payments == total, así que el filtro de
entrada ya no los selecciona. La segunda pasada informa de 0 y no escribe.

**Lo que el backfill NO toca, a propósito:**

- Tickets sin `cashAmount` y fiados (nacen sin pagos; sus cobros ya vienen topeados).
- Tickets cuyo exceso no cabe en las filas de efectivo: se listan para mirarlos a mano, no se
  corrigen a ciegas.
- `shift.zReportStale`. Corregir un ticket de un turno ya cerrado deja el **PDF del Z archivado**
  (`shift.zReportPdfPath`) desactualizado, y existe un flag para decir justo eso. No lo marco porque
  el bloque acota el backfill a las filas de pago y porque encenderlo haría reaparecer la tarjeta de
  resumen en turnos viejos de todos los clientes a la vez. Queda escrito aquí y en "Carryovers": si
  se quiere, es un `updateMany` de una línea sobre los `shiftId` tocados.

---

## 3 · El ticket impreso dice CAMBIO

Dos capas, y no estaban igual de rotas.

**ESC/POS (`tickets/print.ts` + `escpos-builder`).** Pintaba la vuelta si `cashAmount > amount`
comparando fila a fila. Con el error de B1 dentro del ticket los dos números eran el mismo billete,
así que **la condición no se cumplía nunca y el térmico no imprimía la línea jamás**. Ahora la
vuelta se calcula una sola vez (`changeFromCash`) y se cuelga de la **última** fila de efectivo: en
un mixto con dos filas CASH la vuelta es una, no una por fila.

**PDF (`ticket-model` + `ticket-pdf`).** Aquí la línea **sí** salía… por accidente: el modelo
calculaba `Σ payments − total`, que daba 2,00 € precisamente porque el ticket llevaba dentro el
error de B1. Arreglado el origen, esa resta es siempre **cero** y el PDF habría dejado de imprimir
el cambio justo en el bloque que existe para que lo imprima. El cálculo pasa a ser entregado menos
aplicado en efectivo, igual que el térmico.

El papel queda así:

```
TOTAL              3,00 €
Efectivo           3,00 €
  Entregado        5,00 €
  Cambio           2,00 €
```

**Decisión: se añade "Entregado".** El bloque sólo pedía CAMBIO. "Efectivo 3,00 / Cambio 2,00" bajo
un "TOTAL 3,00" es aritméticamente correcto pero no se explica solo; con el billete en medio, el
papel se lee sin pensar. Es un campo opcional del modelo (`payment.received`) que sólo aparece
cuando hay vuelta, así que un cobro clavado imprime exactamente lo de antes. Está en las dos capas.

---

## 4 · "Ticket emitido" enseña lo único que hace falta en ese segundo

El bloque de la vuelta va **arriba**, justo bajo el título, y todo lo demás baja. El CAMBIO manda:
**48 px**, que es el tamaño que `docs/ux-principles.md` §1.5 reserva para el total a cobrar y para
el cambio, y es el número más grande de la pantalla — hay un test que lo comprueba barriendo todos
los tamaños declarados del overlay, no sólo los tres del bloque.

```
            CAMBIO
           2,00 €
  ─────────────────────────
  TOTAL            ENTREGADO
  3,00 €              5,00 €
```

- **Sin exceso, no se pinta nada.** Es lo que dice el bloque, y además: en una venta que cierra
  clavada no hay nada que devolver y el número interno vuelve a ser lo primero.
- **No se quita ninguna acción.** QR, PDF, Ver ticket, el aviso de impresora, el badge PRUEBA y
  "Nueva venta" siguen donde estaban. Hay un test y una captura que lo enseñan.
- **El dato no depende del servidor.** Sale del propio modal de cobro y viaja al overlay como prop,
  también por el camino `PendingSaleOverlay` (venta a salvo en el outbox local, POST sin confirmar).
  El test monta el overlay con la API caída y el bloque sale igual.

### Decisión: con vuelta, el autocierre pasa de 4 s a 8 s

El overlay de venta rápida se cierra solo a los 4 s desde v1.9.2. Con una vuelta que devolver, el
camarero abre el cajón y cuenta monedas, y a los 4 s el número ya no está — que es literalmente la
queja de C1 trasladada al tiempo. Con cambio son 8 s; sin cambio se queda en 4. Ninguna de las
pausas existentes (QR, ver ticket, impresión en curso o fallida) cambia.

---

## Sabotaje → test rojo

Los ocho sabotajes se han **aplicado de verdad sobre el código y revertido**; lo que sigue es la
salida real de cada pasada.

| Sabotaje | Dónde | Test que cae |
|---|---|---|
| `payments[].amount` vuelve a ser lo entregado | `normalize-payments.ts` devuelve las filas tal cual | `la-vuelta-existe` › **ventas del día = Σ totales de ticket** (+ los 6 del fichero) |
| Lo mismo | ídem | `la-vuelta-existe` › **efectivo esperado = ventas CASH, no lo entregado** y › **descuadre 0,00 €** |
| Quitar el tope de `amount` en el servidor | se anula el rechazo por `nonCashOverflow` | `la-vuelta-existe` › **no se persiste un pago mayor que su parte del total** |
| Igualar `cashAmount` a `amount` en `print.ts` | `change = 0` | `tickets-print` › **el ticket impreso lleva Entregado y CAMBIO** y › **una sola línea de cambio** |
| Ocultar el bloque de cambio del overlay | `hasChange = false` | `success-overlay-change` › **pinta TOTAL, ENTREGADO y CAMBIO**, › **el CAMBIO manda** y › **autocierre 8 s** |
| Correr el backfill dos veces (la señal pasa a ser `cashAmount − Σcash`) | `backfill-vuelta.ts` | `backfill-vuelta` › **la segunda pasada no cambia nada** (+ 5 del fichero) |
| El front vuelve a mandar el importe entregado | tope del payload a 999999 | `cash-pad-checkout` › **el importe tecleado llega al POST** y `checkout-mixed-payment` › **la fila a 0,00 € no viaja** |
| El cambio del PDF vuelve a `Σ payments − total` | `ticket-model/build.ts` | `ticket-pdf` › **imprime Entregado y Cambio** y `ticket-model` › **desglosa IVA múltiple** |

---

## Lo que la suite NO cubre

1. **Nada corre contra Postgres.** Toda la API va con Prisma falso. La suite e2e real
   (`pnpm test:e2e`, `test-e2e/ciclo-de-caja.e2e.ts`) **no se ha ejecutado**: necesita Docker
   levantado y aquí no lo hay. El caso canónico está montado con el desglose que hace
   `breakdown-sums.ts` (Σ `TicketPayment.amount` por método) replicado en el test, no con la query
   de Prisma de verdad. Si esa query cambiara de campo, el test seguiría verde.
2. **El backfill no se ha ejecutado contra ninguna base**, ni de producción ni de desarrollo. Lo que
   está probado es el **plan** (función pura) y su idempotencia; el `update` de Prisma del script no
   lo cubre ningún test.
3. **El `SELECT` no se ha ejecutado.** No sabemos cuántos tickets de producción están afectados ni
   por cuánto importe. Es el número que pide §2 y sigue pendiente.
4. **El papel de verdad.** Los tests miran los bytes ESC/POS y el texto extraído del PDF. Que la
   línea "Cambio" salga legible en la impresora térmica del AP11, con su ancho de 32 columnas y su
   fuente, sólo lo dice el papel.
5. **Los píxeles.** jsdom no hace layout: el test del overlay comprueba que 48 px es el tamaño más
   grande **declarado**, no que el bloque quepa sin empujar "Nueva venta" fuera de pantalla en un
   ticket con email enviado + aviso de impresora + las tres acciones. Eso lo mira el bucle visual, y
   sólo a 1280 × 800.
6. **Los 8 s del autocierre en la mano de un camarero.** El test mueve el reloj; si 8 s siguen sin
   llegar para dar la vuelta, lo dirá el terminal, no la suite.
7. **Concurrencia.** Que dos cajas cobren la misma mesa con exceso a la vez no se prueba aquí (eso
   lo cubre `mesas-concurrencia` / `checkout-idempotency`, y el tope es puro, sin estado).
8. **Holded.** No se ha subido nada a un Holded real. Lo que se comprueba por lectura de código es
   que `upload-ticket.ts` sigue mandando `ticket.total` exacto en `/pay` (ver "Efectos colaterales").

---

## Bucle visual

Playwright a **1280 × 800**, DPR 1. Capturas en `docs/blocks/v1-15-vuelta-shots/`. Dos pantallas
nuevas en el banco visual (`apps/tpv-web/visual/main.tsx`): `ticket-emitido` y
`ticket-emitido-sin-vuelta`.

| Captura | Qué enseña |
|---|---|
| `00-comparativa-antes-despues.png` | **El listón del bloque.** El AP11 con v1.14.1 a la izquierda y el banco con v1.15 a la derecha, el mismo ticket #000020. Izquierda: número interno, PRUEBA, aviso de impresora y cuatro acciones. Derecha: lo mismo, con CAMBIO 2,00 € arriba. |
| `ticket-emitido-1280.png` | El caso de la auditoría: 3,00 € con un billete de 5. |
| `ticket-emitido-sin-vuelta-1280.png` | El mismo cobro clavado: el bloque no aparece y la pantalla queda como estaba. |

**Lo que el bucle cambió sobre lo primero que se escribió** (los tests estaban verdes en los tres
casos):

1. **El banco mentía en la comparativa.** La primera captura salía con número fiscal Holded
   `T-000015` sobre un ticket `#000020` y sin las tres acciones, porque el stub del banco devolvía
   un ticket SYNCED genérico y un 404 en `/digital`. Puesto lado a lado con el AP11 daba a entender
   que el bloque había quitado "Mostrar QR · Descargar PDF · Ver ticket". Ahora el banco sirve el
   ticket #000020 **en modo prueba** y un payload digital completo: las dos mitades de la
   comparativa son la misma pantalla.
2. **El bloque no puede ser sólo tres números en fila.** Puestos los tres al mismo tamaño en una
   línea, como los escribe el prompt, el CAMBIO no manda: manda el que más a la derecha esté. El
   reparto final —cambio grande arriba, total y entregado como pie del panel— es lo que hace que el
   ojo caiga primero donde tiene que caer.

---

## Decisiones tomadas sin preguntar

1. **El servidor normaliza en vez de rechazar**, y rechaza sólo el exceso que no sale del cajón
   (§1). El motivo manda: hay APKs viejas en la calle con ventas encoladas.
2. **El exceso lo absorbe el efectivo, no la primera fila.** Un tope goloso por orden dejaría la
   tarjeta a 0,00 € en un mixto donde el datáfono sí cobró.
3. **La regla vive en `ticket-model`**, no duplicada en la API y el front. Es el único paquete que
   ya compartían las cuatro capas que tienen que decir lo mismo.
4. **Se añade "Entregado" al ticket impreso** (§3), campo opcional, sólo cuando hay vuelta.
5. **El bloque del overlay no se pinta sin exceso** (§4), literal como pide el prompt.
6. **Autocierre a 8 s con vuelta** (§4).
7. **El `cashAmount` que manda es el del body**; si no viene y hubo efectivo, se deriva de las filas
   CASH. Así un cliente viejo no pierde la vuelta.
8. **El backfill se escribe pero no se ejecuta**, y no marca `zReportStale` (§2).
9. **No se toca `z-breakdown.ts`, ni el modal de cobro, ni el cierre con mesas abiertas, ni el
   catálogo**, como pide el fuera-de-alcance.

---

## Efectos colaterales, declarados

- **Holded sigue recibiendo el `total` exacto** en `/pay` (`upload-ticket.ts` manda
  `Number(ticket.total)`, no la suma de pagos). Lo que sí cambia es la **descripción** de un cobro
  mixto: `composePayDesc` lista los importes de las filas, que ahora suman el total en lugar de lo
  entregado. Es texto, no dinero, y es más correcto que antes.
- **Reimpresión de tickets viejos sin backfill.** En un ticket anterior a v1.15 el PDF imprimía
  "Cambio" por el accidente descrito en §3; con el cálculo nuevo dejará de imprimirlo hasta que pase
  el backfill. El térmico no cambia: nunca lo imprimió. Es un argumento más para correr §2.
- **Turnos ya cerrados.** El Z que se recalcule (pantalla, arqueo X) sale corregido después del
  backfill; el PDF del Z archivado de un turno pasado se queda como está.

---

## Hallazgos nuevos (fuera de alcance, para el siguiente bloque)

1. 🔴 **Los cobros parciales no aparecen en el Z.** `ticket_partial_payments` no lo lee nadie:
   `shift/breakdown-sums.ts` sólo agrega `TicketPayment` y `Refund`. Un cobro parcial registrado
   desde "Partir cuenta" no suma en ninguna sección del cierre.
2. 🔴 **Y encima el checkout no los descuenta.** `SalePage.splitBill.tsx` registra parciales, pero
   `CheckoutOverlay` abre con `props.totals.total` completo: tras cobrar 30 € de una cuenta de 80,
   el cobro final vuelve a pedir 80. El `usePartialPayments` que describe la cabecera de
   `partial-payment.ts` **no existe en el código**. Hay que decidir si la función se completa o se
   retira de la pantalla.
3. 🟡 **`cashAmount` en `POST /credit-payments` es un campo muerto**: se acepta en el body y no se
   persiste (la columna existe en `ticket_partial_payments`, no en el cobro de deuda). Un fiado
   saldado con un billete no puede imprimir su vuelta.

---

## Tests

**Nuevos (4 ficheros, 42 tests):**

| Fichero | Qué fija |
|---|---|
| `packages/ticket-model/test/payments-applied.test.ts` | La regla pura: el caso de la auditoría, el cobro clavado, el mixto, dos filas CASH, la fila a cero, el exceso en tarjeta, la tolerancia, y que `changeFromCash` de un ticket sin arreglar dé 0. |
| `apps/api/test/la-vuelta-existe.test.ts` | Las dos puertas (venta rápida y mesa), el cliente viejo sin `cashAmount`, el rechazo del exceso en tarjeta, y **el turno de la auditoría** con su ticket mixto: ventas 7,70 €, efectivo 5,00 €, tarjeta 2,70 €, descuadre 0,00 €. |
| `apps/api/test/backfill-vuelta.test.ts` | El plan del backfill y su idempotencia. |
| `apps/tpv-web/test/success-overlay-change.test.tsx` | El bloque de la vuelta, que el CAMBIO es el número más grande, que sin exceso no se pinta, que no se quita ninguna acción y el autocierre de 8 s. |

**Ampliados:** `apps/api/test/tickets-print.test.ts` (+3: CAMBIO en el térmico, cobro clavado
limpio, una sola línea en mixto) y `packages/ticket-pdf/test/ticket-pdf.test.ts` (+2: Entregado y
Cambio en el PDF, y su ausencia sin vuelta).

**Reescritos porque afirmaban el bug** (no borrados — dicen lo mismo con el invariante nuevo):

- `apps/tpv-web/test/cash-pad-checkout.test.tsx` · "el importe tecleado con el pad llega al POST":
  5 € tecleados sobre 3,00 € ahora viajan como `amount: 3` + `cashAmount: 5`.
- `apps/tpv-web/test/checkout-mixed-payment.test.tsx` · "la fila a 0,00 € no viaja": el CASH pasa de
  20 a 14 y se comprueba `cashAmount: 20`.
- `packages/ticket-model/test/ticket-model.test.ts` · el fixture llevaba `payments: [{CASH, 10}]`
  sobre un total de 6,93, que es justo B1; ahora lleva 6,93 con `cashAmount: 10` y el cambio sigue
  siendo 3,07.

---

## Ficheros

```
NUEVO  packages/ticket-model/src/payments.ts            la regla única (aplicado vs entregado)
NUEVO  apps/api/src/tickets/normalize-payments.ts       la puerta del servidor
NUEVO  apps/api/src/tickets/backfill-vuelta.ts          el plan del backfill (puro)
NUEVO  apps/api/src/scripts/backfill-vuelta.ts          el CLI (informe / --apply)
NUEVO  docs/blocks/v1-15-la-vuelta-existe-select.sql    el SELECT de §2
NUEVO  docs/blocks/v1-15-vuelta-shots/*.png             3 capturas, con la comparativa

  MOD  packages/ticket-model/src/{index,types,schema}.ts   `payment.received`
  MOD  packages/ticket-model/src/build.ts                  el cambio sale del efectivo
  MOD  packages/ticket-pdf/src/render.ts                   Entregado + Cambio
  MOD  packages/escpos-builder/src/ticket.ts               `cashReceived` en la fila CASH
  MOD  apps/api/src/tickets/routes.ts                      normalización en las dos rutas
  MOD  apps/api/src/tickets/print.ts                       la vuelta, una vez, en la última fila CASH
  MOD  apps/api/package.json                               script `backfill:vuelta`
  MOD  apps/tpv-web/src/pages/CheckoutPage.tsx             payload topeado + resumen al overlay
  MOD  apps/tpv-web/src/pages/CheckoutPage.successOverlay.tsx  el bloque de la vuelta
  MOD  apps/tpv-web/visual/main.tsx                        2 pantallas nuevas del banco
```

---

## Criterios de aceptación

| Criterio | Estado |
|---|---|
| `payments[].amount` topeado a su parte del total, en las dos rutas | ✅ |
| El sobrante vive sólo en `ticket.cashAmount` | ✅ |
| El servidor no puede persistir un pago mayor que su parte del total | ✅ (normaliza; rechaza el exceso no reembolsable) |
| El tercer camino (`partial-payment.ts`) comprobado | ✅ no materializa `TicketPayment`; declarado |
| `SELECT` de tickets de producción afectados | ✅ escrito · ⏳ **sin ejecutar** (sin acceso a producción) |
| Backfill idempotente, sin tocar tickets sin efectivo ni fiados, con recuento en el log | ✅ escrito y probado · ⏳ sin ejecutar |
| Línea CAMBIO en el ESC/POS | ✅ |
| Línea Cambio en el PDF | ✅ |
| TOTAL / ENTREGADO / CAMBIO en "Ticket emitido", con el CAMBIO mandando | ✅ |
| Sin exceso, el bloque no se pinta | ✅ |
| Ninguna acción existente eliminada | ✅ |
| `z-breakdown.ts` intacto | ✅ |
| Modal de cobro intacto | ✅ (sólo cambia lo que se manda al servidor) |
| Tabla sabotaje → test rojo, con los sabotajes aplicados de verdad | ✅ 8 sabotajes |
| Bucle visual a 1280 × 800, con y sin vuelta | ✅ |
| Suite verde y `tsc --noEmit` limpio | ✅ 173 ficheros / 1534 tests |

---

## Carryovers

1. **Ejecutar el `SELECT`** y decidir si el backfill entra en esta ventana. Es el único punto del
   alcance que queda abierto.
2. **`zReportStale`** en los turnos tocados por el backfill, si se quiere que el resumen avise de que
   el Z archivado ya no cuadra.
3. Los tres hallazgos nuevos de arriba (parciales invisibles en el Z, parciales no descontados del
   checkout, `cashAmount` muerto en el cobro de deuda).
4. **Verificación en el AP11**: el papel térmico con la línea Cambio, y los 8 s del autocierre en
   mano.
