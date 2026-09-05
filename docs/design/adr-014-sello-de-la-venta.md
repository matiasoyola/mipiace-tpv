# ADR-014 · Sello de inalterabilidad de la venta

_2026-09-05. Decide cómo se hace inalterable el dato económico de una venta cobrada, sin
convertir a mipiacetpv en SIF y sin partir la tabla `tickets`. Precede al bloque S1._

---

## 0. Tesis en una frase

El dato económico de una venta se **sella** en el momento del cobro y a partir de ahí el
**motor de base de datos** —no la disciplina de la aplicación— impide modificarlo; los campos
operativos siguen escribiéndose con normalidad, y toda corrección legítima pasa por una vía
explícita que deja traza.

## 1. Contexto

Decidido con Matías el 2026-09-05: **Mi Piace no entra en la parte ERP** (como mucho CRM) y
**no será SIF**. Quien necesite ERP activa Holded. Para el segmento pequeño —la peluquería—
la vía es que **el asesor fiscalice el cierre de caja**.

Eso solo funciona si el cierre es fiable. La auditoría
`docs/auditorias/2026-09-05-inalterabilidad-datos-venta.md` encontró que la premisa "nuestro
TPV por definición no permite modificar los datos" es **cierta para el cajero y falsa fuera de
la aplicación**:

- No hay **un solo** trigger, `REVOKE` ni regla en ninguna migración.
- No existe auditoría a nivel de tenant (solo `SuperAdminAudit`).
- `scripts/backfill-vuelta.ts` modifica pagos de ventas cerradas sin dejar rastro — se ejecutó
  sobre 12 tickets y 161,57 € en v1.15.
- El Z puede quedar obsoleto (`zReportStale`) y su PDF vive en disco sin huella.

## 2. Lo que NO se hace (frontera dura)

Nada de encadenamiento de huellas **entre** registros, remisión a la AEAT, certificados
cualificados ni declaración responsable. Esto **no** convierte a mipiacetpv en SIF y **no se
comunica como "cumple Verifactu"** — decir eso sin ser SIF es justo el terreno donde alcanza
la responsabilidad del fabricante (en vigor desde 29-jul-2025, hasta 150.000 € por ejercicio
y programa; ver `docs/legal/posicion-verifactu.md`).

La frase defendible, y la única que se usa:

> Registro de ventas íntegro y no modificable, con trazabilidad de cualquier corrección.

## 3. Las tres vidas de la fila `Ticket`

Hoy conviven en la misma fila, y esa mezcla es la raíz del problema:

| Vida | Campos | Mutabilidad |
|---|---|---|
| **Económica** | `total`, `totalTax`, `totalDiscount`, `cashAmount`, `internalNumber`, `paidAt`, toda `TicketLine`, los `TicketPayment` de la venta | **Nunca** tras el cobro |
| **Operativa posterior** | `status`, `syncedAt`, `syncError`, `holdedDocumentId`, `holdedDocNumber`, `holdedPdfUrl`, `emailFailedAt`, `printIntent`, `emailIntent`, `giftReceiptIntentAt`, `creditPending` | Libre |
| **De borrador** | `tableId`, `originalTableId`, `checkoutExternalId`, `lastSentAt`, `lastSentRevision`, `voidReason`, `voidedAt`, `voidedByUserId` | Solo antes del cobro |

## 4. Decisión: sellar por columnas, no partir la tabla

**Alternativa descartada:** partir `tickets` en una tabla operativa y otra económica
append-only. Rompe consultas por todo el repo, obliga a una migración grande y `TicketLine` ya
cuelga de `tickets`. Mucho coste para lo que compra.

**Decisión:**

1. **Sello al cobrar.** Al persistir el cobro **en el servidor** se calcula un SHA-256 del
   conjunto económico (totales, líneas ordenadas de forma determinista, pagos) y se guarda en
   `sealed_hash` + `sealed_at`.
2. **Trigger en Postgres.** `BEFORE UPDATE ON tickets` rechaza cualquier cambio en columnas
   económicas si `sealed_at IS NOT NULL`. En `ticket_lines` y `ticket_payments`,
   `UPDATE`/`DELETE` denegados si su ticket está sellado. Los campos operativos no los mira el
   trigger: siguen escribiéndose libremente.
3. **Vía de corrección explícita.** Tabla `ticket_corrections` (quién, cuándo, tabla, fila,
   campo, valor anterior, valor nuevo, motivo). Una corrección legítima escribe ahí **antes**
   de poder tocar nada. Un backfill como el de v1.15 pasa por ahí o no pasa.

### 4.1 Por qué esto sale casi gratis

`TicketLine` **ya está diseñada como snapshot inmutable**: `nameSnapshot` es "copia del nombre
en el momento del cobro", `holdedProductId` es un snapshot explícito, y los `modifiers` están
desnormalizados a propósito "para que cambios futuros en el catálogo no alteren el ticket
histórico (auditoría fiscal inmutable)". **No hay que cambiar el modelo: hay que hacerlo
cumplir.**

### 4.2 El offline no estorba

El sello se calcula **al persistir el cobro en el servidor**, nunca en el terminal. Un ticket
que llega dos horas tarde por el outbox se sella al llegar, igual que uno inmediato. No hay
orden que respetar entre tickets: el sello es por venta, no encadenado — que es justo lo que
nos mantiene fuera del ámbito SIF.

## 5. Los dos casos de borde, decididos (Matías, 2026-09-05)

1. **`creditPending` queda FUERA del sello.** Es un campo derivado que baja con cada cobro de
   deuda. La verdad son los `TicketPayment`, que se crean como **registros nuevos**, no como
   ediciones. El `total` del fiado sí queda sellado.
2. **No se sella retroactivamente.** Los tickets ya en producción quedan como **pre-sello**
   (`sealed_at IS NULL`) y el sello arranca desde la fecha de despliegue. Sellar el histórico
   sería afirmar algo que no podemos verificar.

## 6. Consecuencias

**A favor**
- El agujero número 1 de la auditoría (cero protección en BD) se cierra de raíz: ya no depende
  de que ninguna ruta se porte bien.
- El cierre de caja pasa a ser algo que un asesor puede firmar. Es la propuesta de valor del
  caso peluquería.
- Se mantiene intacta la posición de no ser SIF.

**En contra / a vigilar**
- Cualquier código futuro que intente actualizar una columna económica **fallará en
  producción**, no en revisión. Los tests tienen que cubrir esa frontera.
- La vía de corrección es una puerta: si se usa a la ligera, la garantía vale lo que valga la
  disciplina de quien la abre. El motivo debe ser obligatorio y la tabla, consultable desde el
  admin.
- Convivencia pre-sello / sellado durante la vida del histórico. Todo informe que agregue
  ventas debe tolerar ambas.

## 7. Pendiente aguas abajo

- Sellado del Z (pieza 4 del bloque): congelar el desglose en la fila, no solo el PDF.
- Validación por asesor fiscal de la posición OFF-A (que el justificante no es factura
  simplificada). Pendiente en `docs/legal/posicion-verifactu.md` desde 2026-06.

## Relación con otros documentos

- `docs/auditorias/2026-09-05-inalterabilidad-datos-venta.md` — los hallazgos que lo motivan.
- `docs/legal/posicion-verifactu.md` — la frontera fiscal.
- `docs/code-prompts/bloque-s1-sello-de-la-venta.md` — la implementación.
