# Bloque S1 · el sello de la venta

_Serie S (sello / integridad del dato). Nueva serie a propósito: v1.16, v1.17 y v1.18 ya están
comprometidos con producto, y esto no es producto — es la base sobre la que se sostiene que el
cierre de caja vale para un asesor._

## Contexto (leer antes)

- `docs/design/adr-014-sello-de-la-venta.md` — **manda este documento.** La decisión, los dos
  casos de borde ya cerrados y la frontera de lo que NO se hace.
- `docs/auditorias/2026-09-05-inalterabilidad-datos-venta.md` — los agujeros concretos, con
  fichero y línea.
- `docs/legal/posicion-verifactu.md` — por qué la frontera es donde es.

## El problema, en una frase

**Cualquiera con acceso a la base de datos puede cambiar el importe de una venta cobrada y no
queda rastro.** El TPV lo impide al cajero, y solo al cajero: no hay ni un trigger, ni un
`REVOKE`, ni una tabla de auditoría de tenant en todo el repo.

## La causa, ya localizada (no la investigues otra vez)

La integridad del dato económico es hoy **disciplina de la aplicación**, y la aplicación no es
la única puerta a Postgres. Comprobado en la auditoría:

- Cero triggers / `REVOKE` / `RULE` en `packages/db/prisma/migrations/`.
- El único modelo de traza es `SuperAdminAudit`. Lo que hace un OWNER o MANAGER no se registra.
- `apps/api/src/scripts/backfill-vuelta.ts:123` hace `ticketPayment.update` sobre ventas ya
  cobradas — es lo que se ejecutó en v1.15 sobre 12 tickets y 161,57 €.
- La "auditoría" del void (`apps/api/src/tables/void-draft.ts`) es un evento por WebSocket: se
  emite y se pierde.

**Lo que ya está bien y no hay que rehacer:** la bandeja de errores no toca importes
(`edit-line-sku` solo cambia el `sku`, y devuelve 409 si ya está `SYNCED`); el único
`ticket.deleteMany` está acotado a `status: TEST`; anular una venta cobrada se hace por
devolución, que crea un registro nuevo; y `TicketLine` **ya está diseñada como snapshot
inmutable** — sus propios comentarios lo dicen. Aquí no se cambia el modelo: **se hace cumplir**.

## Alcance

### 1 · El sello

Dos columnas nuevas en `tickets`: `sealed_hash` (SHA-256 en hex) y `sealed_at`.

Se calculan **al persistir el cobro en el servidor**, nunca en el terminal, sobre el conjunto
económico: `total`, `totalTax`, `totalDiscount`, `cashAmount`, `internalNumber`, `paidAt`, las
`TicketLine` en **orden determinista** (documenta cuál y por qué) con todos sus campos de
importe, y los `TicketPayment` de la venta.

Ojo a los **tres** caminos de entrada, no dos: venta rápida (`POST /tickets`), cobro de mesa
(`POST /tickets/:id/checkout`) y el ingreso diferido del **outbox offline**. Un ticket que llega
dos horas tarde se sella al llegar, igual que uno inmediato. El sello es **por venta, no
encadenado entre ventas** — eso es deliberado y no se cambia (ADR-014 §2).

`creditPending` **queda fuera del sello** (ADR-014 §5.1).

### 2 · El trigger, que es lo que de verdad cierra el agujero

Migración SQL manual — Prisma no expresa triggers, mismo patrón que el índice parcial de
`v1_8_fiado`.

- `BEFORE UPDATE ON tickets`: si `OLD.sealed_at IS NOT NULL` y cambia **cualquier** columna
  económica → excepción. Las operativas (`status`, `synced_at`, `sync_error`, los tres de
  Holded, `email_failed_at`, `print_intent`, `email_intent`, `gift_receipt_intent_at`,
  `credit_pending`) no las mira.
- `ticket_lines` y `ticket_payments`: `UPDATE` y `DELETE` denegados si su ticket está sellado.

La lista de columnas económicas vive **en un solo sitio** y la migración y el código leen de
ahí. Si alguien añade una columna de importe y no la mete en la lista, que se note en un test.

### 3 · La vía de corrección

Tabla `ticket_corrections`: quién, cuándo, tabla, fila, campo, valor anterior, valor nuevo y
**motivo obligatorio en texto libre**. Escribir ahí es el único camino para tocar una columna
sellada, y el trigger debe distinguirlo (rol separado, `SECURITY DEFINER`, o el mecanismo que
prefieras — decídelo y escríbelo en el `-done`).

Consecuencias que hay que aplicar en el mismo bloque:

- `scripts/backfill-vuelta.ts` y cualquier script futuro que toque ventas cerradas pasan por
  aquí o dejan de funcionar. Que dejen de funcionar ruidosamente, no en silencio.
- `edit-line-sku` de la bandeja: **el `sku` entra en el sello** (identifica qué se vendió), así
  que ese endpoint pasa a escribir su corrección. Sigue negándose si ya está `SYNCED`.
- Vista mínima en el admin para consultar las correcciones de un ticket. Sin ella la tabla no
  sirve para lo único que existe: que alguien la mire.

### 4 · Sellar el Z

Hoy el Z se persiste como PDF en `Shift.zReportPdfPath` — un fichero en disco, sustituible sin
que nada lo detecte — y `zReportStale` existe porque entran ventas después de generarlo.

Al cerrar el turno: **congelar el desglose en la propia fila**, no solo en el PDF, y guardar
una huella del contenido. `zReportStale` deja de ser un boolean incómodo y pasa a significar
**"existe un Z posterior que corrige a este"**, con el anterior conservado.

### 5 · Convivencia con el histórico

**No se sella retroactivamente** (ADR-014 §5.2). Los tickets existentes quedan con
`sealed_at IS NULL` y el sello arranca desde el despliegue. Todo informe que agregue ventas
—arqueo, Z, listados del admin, CRM— tiene que tolerar las dos poblaciones sin romperse y sin
mentir sobre cuál es cuál.

## Verificación

Tabla **sabotaje → test rojo**, con los sabotajes aplicados de verdad sobre el código y
revertidos:

| Sabotaje | Debe caer |
|---|---|
| `UPDATE tickets SET total = total + 1` sobre un ticket sellado, por SQL directo | test de que el motor lo rechaza (no la aplicación) |
| `UPDATE ticket_lines SET unit_price = ...` de un ticket sellado | test de que el motor lo rechaza |
| `DELETE FROM ticket_payments` de un ticket sellado | test de que el motor lo rechaza |
| Actualizar `status` o `holded_doc_number` de un ticket sellado | **NO debe caer nada** — el flujo normal sigue vivo |
| Quitar una columna de importe de la lista de económicas | test de que la lista cubre todas las columnas de importe del esquema |
| Sellar en el terminal en vez de en el servidor | test de que un ticket entrado por outbox con retraso se sella igual |
| Correr `backfill-vuelta.ts` contra un ticket sellado sin motivo | test de que falla y no escribe |
| Escribir una corrección sin motivo | test de que se rechaza |
| Cobrar un fiado (baja `creditPending`) | **NO debe caer nada** — está fuera del sello |
| Cerrar turno y meter una venta después | test de que el Z anterior se conserva y el nuevo lo marca como corregido |

El caso canónico de la suite: **un ticket sellado sobrevive intacto a un intento de UPDATE por
SQL directo, y el mismo ticket acepta sin problema su transición a `SYNCED`.** Las dos cosas en
el mismo test, porque el fallo típico será pasarse de estricto y romper el flujo de Holded.

Y declara **qué NO cubre la suite**.

Cierra con `docs/blocks/s1-sello-de-la-venta-done.md`, con las decisiones tomadas sin
preguntarlas una a una, y con el mecanismo elegido para la vía de corrección y por qué.

## Fuera de alcance (explícito)

- **Nada de encadenamiento de huellas entre registros, remisión a la AEAT, certificados ni
  declaración responsable.** Esto no nos convierte en SIF y esa frontera no se cruza en este
  bloque. Si el código te pide "ya que estamos, encadenamos", la respuesta es no.
- **No partir `tickets` en dos tablas.** Se evaluó y se descartó en ADR-014 §4.
- **No sellar el histórico.**
- No toques el catálogo, el mapa de sala, el modal de cobro ni la pantalla de "Ticket emitido":
  son v1.16 / v1.17 / v1.18.
- No toques la integración con Holded. El ticket sigue subiendo exactamente igual.
- **No añadas en ninguna parte del producto ni de la documentación la frase "cumple Verifactu"**
  ni equivalentes. La única redacción admitida está en ADR-014 §2.
