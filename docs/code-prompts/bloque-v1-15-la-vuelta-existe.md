# Bloque v1.15 · la vuelta existe

## Contexto (leer antes)

- `docs/qa/2026-09-02-auditoria-por-procesos.md` — la auditoría sobre el AP11 físico. **B1 y C1.**
- `docs/qa/2026-09-02-backlog-ordenado.md` — el orden del backlog y por qué este bloque va primero.
- Skills `sistema-visual-mipiace` y `metodologia-front-mipiace`. Mandan los tokens del proyecto.

## El problema, en una frase

**Para el TPV, la vuelta no existe.** El importe entregado se guarda como si fuera el importe
cobrado, y a partir de ahí el error se propaga al cierre de día, al ticket impreso y a la pantalla
de confirmación. El cliente cuadra su caja con un papel que le dice que le falta dinero.

## La causa, ya localizada (no hay que investigarla otra vez)

`apps/tpv-web/src/pages/CheckoutPage.tsx:201` calcula `cashAmount` como la **suma de las filas
CASH**, y `:477` manda al servidor `payments[]` con esas mismas filas **y** `cashAmount` con el mismo
número. Ticket de 3,00 € pagado con un billete de 5:

```
payments[0] = { method: CASH, amount: 5.00 }   ← debería ser 3.00
ticket.cashAmount = 5.00                        ← correcto
```

De ahí salen las tres víctimas:

1. **El cierre.** `apps/api/src/shift/breakdown-sums.ts` suma `ticketPayment.amount`, y
   `z-breakdown.ts` deriva de ahí `grossSales` y `cashTheoretical`. Ventas del día 9,70 € en lugar
   de 7,70 €, efectivo esperado 7,00 € en lugar de 5,00 €, y el arqueo escupe **descuadre −2,00 €**
   con el cajón perfectamente cuadrado. **`z-breakdown.ts` no se toca: arreglando el origen queda
   bien solo.**
2. **El ticket térmico.** `apps/api/src/tickets/print.ts:352` pinta la línea de cambio sólo si
   `cashAmount > amount`. Como valen lo mismo, **no la pinta nunca**: el cliente se lleva un papel
   con "Efectivo 5,00" bajo un "TOTAL 3,00" y ninguna vuelta.
3. **La pantalla.** `CheckoutPage.successOverlay.tsx` no dice ni total, ni entregado, ni cambio.

**El patrón correcto ya existe en el repo:** `apps/api/src/tickets/partial-payment.ts` valida
`amount` contra el pendiente y guarda `cashAmount` aparte. Copia ese modelo, no inventes otro.

## Alcance

### 1 · `payments[].amount` es lo aplicado, nunca lo entregado

El front deja de mandar el exceso dentro del pago. `amount` de cada fila se topea a lo que queda por
cubrir; el sobrante vive **sólo** en `ticket.cashAmount`. El servidor deja de aceptar
`Σ payments > total` en silencio: si llega, lo normaliza o lo rechaza — decídelo y escríbelo en el
`-done`, pero que **no se pueda persistir un pago mayor que su parte del total**.

Ojo a los dos caminos: venta rápida (`POST /tickets`) y cobro de mesa
(`POST /tickets/:id/checkout`). Y comprueba si el cierre fiscal de los cobros parciales
(`partial-payment.ts`) materializa `TicketPayment`: si lo hace, tiene que entrar por la misma puerta.

### 2 · Backfill del histórico

Los tickets ya emitidos llevan el error dentro. Migración de datos: en los tickets con
`Σ payments > total` y `cashAmount != null`, **restar la diferencia a la fila CASH**. No toca
tickets sin efectivo ni fiados. Idempotente, y con recuento de filas afectadas en el log.

**Antes de escribirla, dame el `SELECT` de cuántos tickets de producción están afectados y por
cuánto importe** — con ese número decidimos si el backfill entra en este bloque o va en una ventana
aparte. Sin él, sigue con el resto del alcance.

### 3 · El ticket impreso dice CAMBIO

Con (1) arreglado, `print.ts` vuelve a tener `cashAmount > amount` y pinta la línea. Verifica que
sale en el ESC/POS (`packages/escpos-builder/src/ticket.ts:53`) y en el PDF, no sólo en uno.

### 4 · "Ticket emitido" enseña lo único que hace falta en ese segundo

Hoy la pantalla muestra número interno, badge PRUEBA, aviso de impresora, QR/PDF/Ver ticket y Nueva
venta — y **ni total, ni entregado, ni cambio**. Cuando el pago llevó efectivo con exceso, arriba y
en grande:

```
TOTAL 3,00 €    ENTREGADO 5,00 €    CAMBIO 2,00 €
```

El **CAMBIO manda**: es el número más grande de la pantalla, por encima del total. Sin exceso, ni se
pinta la línea. Todo lo demás baja. No se quita ninguna acción existente.

## Verificación

Tabla **sabotaje → test rojo**, con los sabotajes aplicados de verdad sobre el código y revertidos:

| Sabotaje | Debe caer |
|---|---|
| Devolver `payments[].amount` al importe entregado | test de que el Z de un turno con vuelta da ventas = Σ totales de ticket |
| Lo mismo | test de que el efectivo esperado en cajón = ventas CASH, no lo entregado |
| Quitar el tope de `amount` en el servidor | test de que un pago mayor que su parte del total no se persiste |
| Igualar `cashAmount` a `amount` en `print.ts` | test de que el ticket impreso lleva línea CAMBIO |
| Ocultar el bloque de cambio del overlay | test de que con exceso en efectivo se pinta CAMBIO |
| Correr el backfill dos veces | test de que la segunda pasada no cambia nada |

El caso canónico de la suite es **el de la auditoría**: turno con dos tickets, 4,70 € y 3,00 €, el
segundo pagado con 5,00 €. Ventas 7,70 €, efectivo esperado 5,00 €, descuadre 0,00 €.

Y declara **qué NO cubre la suite**.

**Bucle visual**: Playwright a 1280 × 800 para la pantalla de "Ticket emitido" con y sin vuelta.

Cierra con `docs/blocks/v1-15-la-vuelta-existe-done.md`, con las decisiones tomadas sin preguntar
una a una, y con el `SELECT` del punto 2 y su resultado.

## Fuera de alcance (explícito)

- **No toques `z-breakdown.ts` ni la presentación del Z.** El error está aguas arriba; si arreglas la
  agregación en vez del origen, el ticket impreso y Holded se quedan mal.
- **No toques el modal de cobro.** El pre-relleno del CashPad (C2), el exceso en verde (C3) y "Más
  opciones" bajo el pie (C5) son **v1.18**. Aquí sólo cambia lo que se manda al servidor.
- No toques el cierre con mesas abiertas (B2) ni el layout del arqueo: son **v1.17**.
- No toques el catálogo, el mapa de sala ni el panel del ticket.
- Nada de lógica fiscal propia: Holded sigue recibiendo el `total` exacto en `/pay`, como hoy.
