# Bloque v1.9.4 · desglose de IVA cuadrado al céntimo (PDF + térmico)

## Contexto (leer antes)

- `apps/api/src/tickets/totals.ts` — `computeTicket` agrega netos por bucket de IVA y redondea UNA vez (diseño v1.4/b30, correcto fiscalmente y coincide con Holded). **NO SE TOCA.**
- Caso real (Sirope, ticket #000005): líneas 1,09 + 2,64 + 0,91 · IVA 10% s/2,00 = 0,20 · IVA 21% s/2,64 = 0,55 · Subtotal 4,64 → el desglose impreso suma 5,39 pero el TOTAL (correcto) es 5,40. El cliente que suma el papel ve un céntimo bailando.
- Renderers: `packages/ticket-pdf/src/render.ts` (PDF) y `packages/escpos-builder/src/ticket.ts` (térmico). El bug es SOLO de presentación en estos dos.

## Alcance

Método del resto mayor (largest remainder) aplicado A LA PRESENTACIÓN del desglose:

1. Helper compartido en `packages/ticket-model` (p. ej. `allocateRoundingRemainder(buckets, total)`): recibe los importes de IVA por tipo (y subtotal) sin redondear + el total ya redondeado del ticket, y devuelve los importes a IMPRIMIR de forma que `subtotal_impreso + Σ IVA_impreso == TOTAL` exacto. El céntimo de diferencia (±0,01, raramente ±0,02) se asigna al componente con mayor resto decimal (empate: al bucket de mayor importe).
2. `ticket-pdf` y `escpos-builder` consumen el helper para las líneas «IVA X% s/base» y «Subtotal». Las bases mostradas («s/2,64») no cambian.
3. Tests en ticket-model con los casos reales: (5,40 / 4,64 / buckets 10+21), ticket de un solo bucket (no cambia nada), ticket que ya cuadra (no cambia nada), caso ±2 céntimos sintético. Tests de render que verifican que la suma impresa == total impreso.

## Restricciones

- PROHIBIDO tocar `totals.ts`, checkout, worker upload (el payload a Holded NO cambia — Holded hace su propia aritmética y ya cuadramos con ella).
- Solo `packages/ticket-model`, `packages/ticket-pdf`, `packages/escpos-builder` + tests.
- El total del ticket NUNCA se recalcula aquí: es entrada.

## Entregables

Helper + 2 renderers actualizados + tests. Criterio de «funciona»: para cualquier ticket, la suma de las líneas del desglose impreso coincide exactamente con el TOTAL impreso, y el total no cambia respecto a hoy.

## Fuera de alcance (explícito)

Cambiar la aritmética de totales o el payload de Holded; el desglose en PANTALLA del TPV (subtotal/IVA del panel — decisión de producto aparte si molesta); mostrar líneas en bruto en el PDF.
