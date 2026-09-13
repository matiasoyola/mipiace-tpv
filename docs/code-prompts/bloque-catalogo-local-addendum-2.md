# Addendum 2 · el IVA del producto local, y dos hallazgos del inventario

Decisión de Matías, 2026-09-13, sobre `bloque-catalogo-local.md`. Concreta el campo
"tipo de IVA" del §2 (el CRUD que hoy no existe).

## El problema que el prompt no cubría

`TenantTax` se puebla **sólo desde el sync de Holded** (`initial-sync.ts:129`,
`incremental-sync.ts:185`). Un tenant sin Holded tiene **cero filas**: el formulario de
alta no tiene de dónde sacar el desplegable de IVA.

## La decisión

**Lista fija + "otro".**

- Desplegable con los tipos generales peninsulares: **21, 10, 4 y 0 %**. Preseleccionado
  el 21, que es el caso normal en los verticales de hoy.
- Una opción **"otro"** que abre un campo numérico, validado (0–100, dos decimales,
  acepta coma o punto). Con mensaje claro si se sale de rango, **nunca un 500**.
- Por qué la vía de escape y no una lista cerrada: el **IGIC canario** (7, 3, 0 %) y
  cualquier tipo que cambie por ley dejarían al cliente **parado, sin poder dar de alta
  su producto, esperando a que toquemos código y despleguemos**. La opción "otro" cuesta
  un rato de formulario hoy y cierra esa puerta para siempre.
- Por qué no sólo un campo libre: teclear `2,1` en vez de `21` se cobraría mal en todos
  los tickets hasta que alguien lo notara, y el papel no lo canta.

## Cómo se implementa

- Los cuatro tipos son una **constante del código**, comentada con el motivo. **No** se
  leen de `TenantTax`: ése es el cache del catálogo fiscal de Holded y en el tenant que
  nos ocupa está vacío por definición.
- Esto aplica **sólo al alta local**. Un producto `source = HOLDED` sigue trayendo su
  `taxRate` del sync, exactamente igual que hoy.

## Al done-doc

Decir qué pasa el día que ese tenant conecte Holded: el `taxRate` local **no se casa**
con ningún `holdedTaxId`. Es forward-only y es trabajo de otro bloque (el casamiento por
SKU). Aquí basta con que quede escrito y con que el código no lo intente.

## Dos hallazgos del inventario, para que no se pierdan

1. **`TicketLine.holdedProductId` ya es nullable** — lo era desde las líneas libres
   `TPV-OTROS-*`. El bloque **no** necesita un segundo cambio de esquema por ahí: el
   cobro de un producto local cabe tal cual. Confirmarlo con un test, no darlo por hecho.
2. **`Product.taxRate` es un decimal plano, no una FK a `TenantTax`.** Es lo que hace
   posible el alta local sin tocar nada más. Si algún día alguien convierte ese campo en
   una relación, este bloque se rompe entero: dejarlo anotado en el ADR.
