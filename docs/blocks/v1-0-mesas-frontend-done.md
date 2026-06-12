# v1.0-Mesas-Frontend · done

**Rama:** `v1-0-mesas-frontend` · un único commit, sin merge.
**Estado tests:** `pnpm test` 0 failed (651 passed, 3 skipped pre-existentes de entorno Redis). Los 15 E2E de mesas y los 4 de offline siguen verdes **sin tocar**.
**Objetivo:** cablear el TPV a los endpoints de mesa (carryover B7→B8, hallazgo GRANDE de v1.0-pilotos) — desbloquea el go-live de Cafetería Sirope.

---

## Lote 1 · Ciclo de vida de mesa desde el TPV

### Arquitectura del cableado

En contexto mesa, **la verdad vive en el servidor**: el carrito que pinta SalePage es una proyección del ticket DRAFT. Cada mutación va contra la API con actualización optimista + reconciliación con el `ticket` que devuelve cada endpoint; si la API rechaza, se revierte y sale un toast con el mensaje (en español) del backend. El carrito de sessionStorage queda **SOLO para venta rápida** (clave fija `quick-sale`).

- **Tocar mesa (libre u ocupada)** → `App.tsx · pickTable()` hace `POST /tables/:id/open` ANTES de montar SalePage. Mesa libre: crea el DRAFT (las demás cajas la ven ocupada vía `table.opened`, que pilotos Lote 1 ya garantizó post-commit). Mesa ocupada: el endpoint es get-or-create y devuelve el DRAFT existente con sus líneas → **retomar carga siempre el servidor, nunca el carrito local** (cubierto por test: un carrito local "fantasma" no se filtra a la mesa). Mientras el POST está en vuelo la mesa muestra spinner; los 409 (`TABLE_GROUPED`, `SHIFT_NOT_OPEN`) y el fallo de red se pintan en el banner del mapa.
- **Líneas vía API** (`SalePage.tsx`):
  - Añadir → `POST /tables/:id/lines` con `lineExternalId` = id local de la CartLine (idempotencia; el servidor lo usa como id de la TicketLine, así proyección y BD comparten ids).
  - Mismo producto sin modifiers → PATCH de units (misma semántica de agrupado que el carrito local).
  - Editar units/descuento/notas ad-hoc → `PATCH /tickets/:tid/lines/:lid`; borrar → `DELETE`; descuento global → un PATCH por línea en secuencia (si falla a mitad, recarga del draft).
  - 403 `REGISTER_MISMATCH` (editar desde caja no propietaria) → revert del optimista + toast — cubierto por test jsdom.
- **Cobrar mesa** → CheckoutOverlay reutilizado con `tableTicketId`: el confirm va a `POST /tickets/:id/checkout` (pagos + intents + `externalId`; sin líneas — viven en el DRAFT). Al éxito (o venta-guardada offline) se limpia la proyección y se vuelve al mapa.
- **Mover ticket** (ya existía v1.4) ahora funciona de verdad: `activeTicketId` se rellena siempre al abrir. Tras mover, el padre reutiliza `pickTable()` sobre la mesa destino para traer el DRAFT con líneas (antes el remount perdía la proyección). Lo mismo desbloquea **enviar comanda** y **partir cuenta** desde mesa recién abierta.
- **Mover líneas** → botón "Mover esta línea a otra mesa" en el LineSheet → `MoveTablePicker` con `allowOccupied` (las líneas se fusionan en la cuenta destino; el endpoint no exige mesa libre) → `POST /tickets/:id/lines/move`.
- **Agrupar / Desagrupar** → chips nuevos en el panel del ticket. "Agrupar" abre `SalePage.groupPicker.tsx` (multi-select de mesas OCUPADAS con cuenta propia; la actual es la principal) → `POST /tables/:id/group`. "Desagrupar" sólo aparece si la mesa tiene absorbidas (se detecta en el fetch de `/tpv/tables` que ya hacía SalePage para el storeId, y se mantiene tras cada acción) → `POST /tables/:id/ungroup`. Los 409 (`TABLE_GROUPED`, `TABLE_ALREADY_GROUPED`) llegan con mensaje en español del backend y se muestran tal cual — cubierto por test.
- **Gate online-only intacto:** el mapa sigue bloqueando todo sin red (tests offline sin tocar). Dentro de SalePage, un fallo de red en cualquier operación de mesa revierte el optimista y avisa "Sin conexión. La operativa de mesas necesita red".

### UX en contexto mesa (decisiones)

- Header sin "Pendientes" ni "+ Nueva venta": la mesa abierta YA es la venta suspendida, y el "+" vaciaría una proyección cuyo dueño es el servidor. "Cancelar" pasa a ser **vaciar la mesa** (confirm → `DELETE /tickets/:id` → VOIDED → vuelta al mapa).
- LineSheet sin lápiz de precio (el PATCH de líneas de mesa no soporta `unitPriceOverride` — ver carryovers); el resto de la edición (units, descuento, notas ad-hoc) funciona igual que en venta rápida.
- Toast único de error de mesa (reusa el banner de comanda con título propio "Operación de mesa rechazada").

### Cambios de soporte en la API

- `serializeDraft` (operativa.ts) expone `productId/variantId/holdedProductId` por línea — el TPV los necesita para reconstruir el carrito al retomar (agrupado de unidades del mismo producto). Aditivo; la suite E2E no asserta shape exacto.

## Lote 2 · Idempotencia + outbox del checkout de mesa

- **API**: `POST /tickets/:id/checkout` acepta `externalId` (uuid, **opcional** para back-compat — las PWA cachean JS semanas). Nueva columna `Ticket.checkoutExternalId` (`@unique`, nullable; migración aditiva `20260612010000_v1_0_checkout_external_id`). GET-back como en `/tickets`: si el ticket ya no es DRAFT y su `checkoutExternalId` coincide → `200 {ticket, duplicate:true}` en vez de 409; también en el camino de carrera (claim `updateMany` devuelve 0 → re-lee y discrimina "fui yo" vs "fue otra caja"). La carrera de dos cajas sigue cerrada por el claim en tx (pilotos Lote 1); esto cubre el **reintento de red** del mismo dispositivo.
- **TPV**: el checkout de mesa pasa por `lib/outbox.ts` (mismo patrón que venta rápida/refunds): persistido ANTES del POST con lock, borrado al 2xx, `pendingLocal` si la red cae (pantalla "Venta guardada"). `OutboxItem` gana `path: string` (antes union literal) y `tableId?` opcional.
- **Mesa "cobrada en tránsito"**: mientras exista un item de outbox con `tableId` (pending **o rejected**), el `TableMapScreen` de ESTE dispositivo pinta la mesa gris con badge "cobro pendiente" y la deshabilita (no se puede reabrir/editar hasta resolverse: el flush confirma → item desaparece → polling/subscribe del outbox la libera). Cubierto por test.

## Lote 3 · Tests

- `apps/api/test/checkout-idempotency.test.ts` (5): contra el handler real con BD fake (patrón tables-e2e recortado) — persiste `checkoutExternalId`; mismo externalId → 200 duplicate con UN solo cobro (contador fiscal a 1, un payment); externalId distinto → 409; carrera con pre-check stale → GET-back sin quemar serie; back-compat sin externalId.
- `apps/tpv-web/test/table-sale-flow.test.tsx` (6, jsdom con API mockeada): añadir línea (POST con `lineExternalId` + reconciliación), retomar mesa pinta el DRAFT del servidor y NO el carrito local, 403 REGISTER_MISMATCH al editar (revert + toast), 409 TABLE_ALREADY_GROUPED al agrupar (toast), checkout → `POST /tickets/:id/checkout` con `externalId` sin `lines` + vuelta al mapa, y mapa con mesa bloqueada por checkout en outbox.
- Los 15 E2E de mesas (`tables-e2e.test.ts`) y 4 de offline (`table-map-offline.test.tsx`) **verdes sin modificar**.
- `pnpm test`: 88 files / 651 passed / 0 failed (3 skipped pre-existentes, entorno Redis). `tsc --noEmit` limpio en api y tpv-web; `vite build` de tpv-web OK.

---

## Acciones manuales de deploy

1. **Migración** `20260612010000_v1_0_checkout_external_id` (aditiva: `ALTER TABLE tickets ADD COLUMN checkout_external_id UUID` + unique index). Recordatorio: `b27` y `v1_0_cashier_session_ttl` siguen pendientes de aplicar al piloto (carryovers anteriores).
2. Nada más: sin deps nuevas, sin env vars, sin cambios de CI.

## Demostrable de punta a punta (Definición de hecho §2)

Dos pestañas del TPV (dos cajas del mismo store): caja 1 toca mesa libre → DRAFT creado al instante → caja 2 la ve ocupada en segundos (evento `table.opened` + WS, ya validado por la suite E2E de pilotos); líneas añadidas se reflejan (eventos line-level con throttle); cobro desde caja 1 → `table.paid` → mesa libre en ambas; mover/agrupar/desagrupar accesibles desde los chips del panel. Verificado por la cadena: suite E2E (endpoints + eventos post-commit) + jsdom (el TPV llama exactamente esos endpoints). Pendiente de validación manual con dos dispositivos reales en el piloto (ver carryovers).

## Fuera de alcance / carryovers

- **Override de precio puntual en líneas de mesa**: el `PATCH /tickets/:id/lines/:id` no acepta `unitPriceOverride`; el lápiz se oculta en contexto mesa. Si Sirope lo pide, añadir el campo al PATCH + persistencia (~medio día).
- **Comensales al abrir mesa**: el endpoint acepta `diners` pero el TPV abre sin preguntar (un toque = mesa abierta, decisión UX de este bloque; el backfill server-side existe si se añade el prompt).
- **Partial payments en el checkout final**: el matiz de SplitBill (descontar parciales del display del CheckoutOverlay) sigue siendo el MVP de v1.4 — sin cambios aquí.
- **WS dentro de SalePage**: si otra caja cobra/vacía la mesa que tengo abierta, no hay aviso push en la pantalla de venta (el conflicto lo corta el backend con 404/409 y el toast). Mejora futura: suscribirse a `table.paid/cleared` de la mesa activa.
- **Validación con dos dispositivos físicos** en el piloto antes del go-live de Sirope (el demostrable está verificado por tests, no en hardware real).
- Cola offline de tickets de venta rápida: sigue fuera (carryover v1.0-pilotos); el de MESA sí queda cubierto por el outbox de este bloque.
