---
title: Auditoría de inalterabilidad de los datos de venta
fecha: 2026-09-05
estado: HALLAZGOS — input del bloque "cierre sellado"
contexto: decisión de NO ser SIF; la vía es que el asesor fiscalice el cierre de caja
---

# ¿Por dónde se puede alterar hoy una venta ya cobrada?

Auditoría del repo a 2026-09-05 (master `7ce5194`). Motivada por la premisa "nuestro TPV
por definición cumple la no modificación de datos". **La premisa es cierta para el cajero
y falsa fuera de la aplicación.**

## ✅ Lo que ya está bien

1. **No hay borrado de ventas reales.** El único `ticket.deleteMany` del repo
   (`superadmin/test-cashier.ts:306`) está acotado a `status: TEST` — limpieza del cajero
   técnico tras la implantación.
2. **La bandeja de errores NO toca importes.** `POST /admin/tickets/:id/edit-line-sku`
   cambia únicamente `TicketLine.sku`, y devuelve 409 si el ticket ya está `SYNCED`.
   `mark-resolved` solo escribe `holdedDocumentId` / `holdedDocNumber` / `syncedAt`.
   Ni precio, ni unidades, ni total.
3. **Anular una venta cobrada no es una edición.** Se hace por devolución, que crea un
   registro nuevo. `VOIDED` solo aplica a DRAFT (mesa abierta) y a fiado con deuda viva —
   ninguno es una venta cerrada.
4. **Las mutaciones de `tables/` son sobre DRAFT**: mesa abierta, todavía no es venta.
   Legítimas.
5. **El Z se persiste** como PDF en `Shift.zReportPdfPath`; no se recalcula al consultarlo.

## 🔴 Los agujeros reales

### 1. Cero protección a nivel de base de datos — el agujero grande
No hay **un solo** trigger, `REVOKE`, `RULE` ni tabla append-only en ninguna migración
(comprobado sobre `packages/db/prisma/migrations/`). Un `UPDATE tickets SET total = ...`
desde el VPS pasa sin dejar rastro. Todo lo bueno de la lista anterior es **disciplina de
la aplicación**, y la aplicación no es la única puerta a la base de datos.

### 2. No existe auditoría a nivel de tenant
El único modelo de traza es `SuperAdminAudit`. Las acciones de OWNER/MANAGER
—`mark-resolved`, `edit-line-sku`, anular una mesa con consumo— **no dejan traza
persistida**. La "auditoría" del void (`tables/void-draft.ts`) es un evento de tiempo real
por WebSocket: se emite y se pierde.

### 3. Los scripts modifican ventas cerradas de forma invisible
`scripts/backfill-vuelta.ts:123` actualiza `ticketPayment` de tickets ya cobrados. Es
exactamente lo que se ejecutó en v1.15 sobre **12 tickets y 161,57 €**. Corrección
legítima de un bug, pero indistinguible después de una manipulación.

### 4. El Z no está sellado
`Shift.zReportStale` existe precisamente porque entran ventas después de generar el Z. Un
cierre que puede quedar "caducado" no es un cierre sellado. Y el PDF vive en disco sin
huella: sustituible sin que nada lo detecte.

### 5. La fila del ticket se sigue escribiendo tras el cobro
`giftReceiptIntentAt`, `emailFailedAt`, `syncedAt`, `holdedDocNumber`, `creditPending`…
Son campos de sistema, inocuos, pero implican que **un append-only literal sobre `tickets`
rompería el producto**. Hay que separar antes.

## Bloque que sale de esto · "el cierre sellado"

Ordenado por dependencia, no por tamaño:

1. **Separar lo económico de lo operativo en `Ticket`.** Importes, líneas y pagos a un
   conjunto que no se actualiza nunca; el resto donde está. **Es el prerrequisito de todo
   lo demás y condiciona el esquema: se decide primero.**
2. **Tabla de auditoría de tenant.** Quién, cuándo, qué campo, valor anterior. Cubre
   bandeja de errores, anulaciones y scripts.
3. **Append-only en base de datos.** Revocar `UPDATE`/`DELETE` sobre las tablas económicas
   al rol de la aplicación, con una vía de corrección explícita que escriba en la auditoría.
4. **Sellar el Z.** Al cerrar, congelar el desglose en la propia fila (no solo el PDF) y
   guardar una huella del contenido. `zReportStale` deja de ser un boolean incómodo y pasa
   a significar "existe un Z posterior que corrige a este".

## Lo que NO entra

Nada de encadenamiento SHA-256 entre registros, remisión a la AEAT, certificados ni
declaración responsable. Esto **no** convierte a mipiacetpv en SIF y no debe comunicarse
como "cumple Verifactu". La frase defendible es:

> Registro de ventas íntegro y no modificable, con trazabilidad de cualquier corrección.

Ver `docs/legal/posicion-verifactu.md` y la memoria `project_verifactu_y_holded_opcional`.
