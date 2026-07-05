# Bloque v1.9.4 · desglose de IVA cuadrado al céntimo (PDF + térmico) — DONE

**Origen:** `docs/code-prompts/bloque-v1-9-4-iva-al-centimo.md`
**Caso real:** Sirope, ticket #000005 — líneas 1,09 + 2,64 + 0,91 · IVA 10% s/2,00 = 0,20 · IVA 21% s/2,64 = 0,55 · Subtotal 4,64 → el desglose IMPRESO sumaba 5,39 pero el TOTAL (correcto) es 5,40. El cliente que sumaba el papel veía un céntimo bailando.

**Estado:** cerrado. Suites verdes en los 3 packages, `tsc --noEmit` limpio en los 3:
- `ticket-model`: **18 passing** (2 files) — +7 del helper.
- `ticket-pdf`: **7 passing** (1 file) — +1 render que cuadra.
- `escpos-builder`: **28 passing** (1 file) — +2 (con y sin desglose).

**Frontera respetada al pie de la letra.** Sólo tocados: `packages/ticket-model`, `packages/ticket-pdf`, `packages/escpos-builder` + sus tests. **Cero cambios** en `totals.ts`, checkout, worker de upload ni payload de Holded. El TOTAL del ticket es ENTRADA en los tres sitios y nunca se recalcula. Las modificaciones dirty preexistentes en `apps/**` y `docs/**` NO son de este bloque y quedan intactas.

---

## Qué se hizo

### Helper compartido — `packages/ticket-model/src/rounding.ts`

`allocateRoundingRemainder(components, total)` — método del resto mayor (Hamilton) aplicado a la PRESENTACIÓN del desglose:

- Recibe los componentes SIN redondear (subtotal + cada IVA) y el `total` ya redondeado.
- Trabaja en céntimos enteros: `floor` de cada componente, reparte el residuo `target − Σfloor` de forma que `Σ importes impresos == total` exacto.
- El céntimo (±0,01, raramente ±0,02) va al componente de **mayor resto decimal**; empate → **mayor importe**.
- Puro, sin dependencias (se importa desde Node y browser). Exportado en `index.ts`.

### PDF — `packages/ticket-pdf/src/render.ts`

El bloque «Desglose IVA» construye los componentes (`subtotal` + `tax:i` con `amount = base*rate/100`), llama al helper y pinta cada línea «IVA X% s/base» y «Subtotal» con el importe cuadrado. **Las bases mostradas («s/2,64») no cambian.** El TOTAL se pinta tal cual entra.

### Térmico — `packages/escpos-builder/src/ticket.ts`

Mismo cuadre antes de la línea TOTAL. Ver decisión D1 (el térmico NO imprimía desglose hasta hoy).

---

## Decisiones tomadas sin preguntar

- **D1 · El ticket térmico no imprimía desglose IVA — se añadió como OPCIONAL.** `buildTicketReceipt` sólo pintaba líneas → TOTAL → pagos; no había líneas «IVA X% s/base» ni «Subtotal» que cuadrar. El bloque exige explícitamente (§Alcance.2, Entregables: «2 renderers actualizados») que `escpos-builder` consuma el helper. Solución dentro de frontera: se añaden campos **opcionales** `taxBreakdown?` y `subtotal?` a `TicketReceiptInput` (+ tipo `TicketTaxBucketEscpos`). Si el caller los pasa, se imprime el desglose cuadrado antes del TOTAL; si no (todos los callers/fixtures actuales), **el ticket sale byte-idéntico a hoy** (test lo verifica). Cero regresión.
- **D2 · El wiring del caller térmico queda PENDIENTE (fuera de frontera).** `apps/api/src/tickets/print.ts::ticketToEscposInput` es quien construiría `taxBreakdown`/`subtotal` desde el ticket Prisma, pero vive en `apps/api` — fuera del alcance de este bloque. Por eso el desglose térmico es opcional y hoy no se emite en producción hasta que se cablee. **El PDF (que sí imprimía desglose) queda cuadrado y activo de inmediato** — es donde el bug de Sirope era visible. Carryover: en el bloque que toque `apps/api`, poblar esos dos campos en `ticketToEscposInput` (bases y `tax = base*rate/100` sin redondear) para activar el cuadre en papel térmico.
- **D3 · El IVA se pasa al helper SIN redondear (`base*rate/100`), no el `tax` ya redondeado del modelo.** `TicketTotals.taxBreakdown[].tax` viene redondeado a céntimos desde `build.ts` (resto decimal 0 → el helper no sabría a quién dar el céntimo). Recomputar desde la base mostrada reproduce el resto decimal real (0,5544 → resto .44 → se lleva el céntimo). La base impresa es la misma, así que no hay incoherencia visual.
- **D4 · El subtotal se alimenta con su valor neto (ya en céntimos, resto ~0).** No compite por el céntimo salvo que todos los IVAs tengan resto menor; correcto y raro. En el caso Sirope el céntimo va limpio al bucket 21%.
- **D5 · Residuo negativo (±0,02 sobrante) simétrico.** Cuando sobran céntimos se quitan a los de **menor** resto decimal (empate → menor importe), espejo del caso positivo. El bloque sólo especificaba el caso «falta un céntimo»; se eligió la regla simétrica y se cubrió con test sintético `-2`.
- **D6 · `floor` con epsilon `1e-6`.** Absorbe el error binario (20,00 llega como 19,999999 y no debe caer a 19). El resto se clampa a `≥0`.

---

## Fuera de alcance (respetado)

Sin tocar aritmética de totales (`totals.ts`) ni payload a Holded (Holded hace su propia aritmética y ya cuadramos con ella). Sin tocar el desglose en PANTALLA del TPV (decisión de producto aparte). Sin imprimir líneas en bruto.

## Criterio «funciona» — verificado

Para cualquier ticket, la suma de las líneas del desglose IMPRESO coincide exactamente con el TOTAL impreso, y el total no cambia respecto a hoy. Caso Sirope: 4,64 + 0,20 + **0,56** = **5,40**. Tests: caso real, bucket único (no cambia), desglose que ya cuadra (no cambia), ±2 céntimos sintéticos, empate por importe, lista vacía; render PDF y térmico verifican la suma impresa == total.
