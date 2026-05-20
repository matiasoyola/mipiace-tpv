# Lote 4 v1.1 · Realtime · estado y pausa
**Fecha:** 20 de mayo de 2026
**Branch:** `v1-1-thalia-feedback`
**Autor:** Claude

## Lo entregado en este lote

La infraestructura realtime **ya existía** (B7 §6: WS multi-terminal para
mapa de mesas) — sólo había que extenderla:

1. **Eventos nuevos** en `apps/api/src/realtime/store-events.ts`:
   - `ticket.paid` — emitido SIEMPRE (mesa o venta rápida) cuando un
     ticket pasa a PENDING_SYNC.
   - `ticket.refunded` — emitido cuando POST /refunds confirma.
2. **Helpers de emisión** en `apps/api/src/realtime/emit-helpers.ts`:
   resuelven storeId del register + email del cashier, broadcast
   via el bus. Defensivos (un error no tumba el handler que cobró).
3. **Throttling** en el bus (`store-event-bus.ts`): max 5 eventos/s
   por canal. Eventos 6+ dentro de la ventana se descartan (no se
   encolan).
4. **Frontend**:
   - `useStoreEventStream` amplía el `StoreEvent` union.
   - `SalePage` fetcha `storeId` vía `/tpv/tables` en mount,
     suscribe al WS, refresca contador del turno y muestra toast
     "Otra caja cobró un ticket" cuando llega `ticket.paid` ajeno.
5. **Tests** del bus: añadido caso de throttling.

## Lo que NO entró en este lote

### Cart-sharing en tiempo real entre cajas (Thalia · doble caja)

**Por qué no**: el carrito vive en `useState` local de SalePage + en
`localStorage` cuando se suspende. **No hay representación
server-side** del cart-en-progreso de un cajero. Sincronizar dos
pantallas que comparten un register exigiría:

1. **Persistir el cart** server-side en una tabla nueva
   `RegisterDraft` con `(registerId, lines JSON, contactId, ...)`.
2. **API endpoints** para PATCH cada vez que cambia algo
   (añadir línea, modificar cantidad, descuento, etc.).
3. **Resolución de conflictos**: dos cajeros añadiendo a la vez
   → last-write-wins de la línea por id, suma de unidades por SKU.
4. **Tombstones / soft-delete de línea** para que la pantalla
   peer no resurrija una línea que el otro acaba de borrar.
5. **Bus + WS**: ya tenemos. Eventos `cart.line_added`,
   `cart.line_removed`, `cart.line_modified`, `cart.cleared`.

**Coste estimado**: 2-3 días entre backend, migration, conflict
testing, y UI defensiva (debouncing del PATCH, optimistic update).

**Recomendación**: dejarlo como lote propio `B-Cart-Realtime` o
diferirlo a v1.2 si la presión real es baja. La alternativa de
v1.1 — toast cross-caja en `ticket.paid` — cubre el caso más
peligroso (cobrar dos veces un ticket) sin la complejidad de
cart-share.

### Pendientes (carritos suspendidos) cross-caja

Por la misma razón: los pendientes son `localStorage` per device.
Ver entre cajas exige moverlos a BD. Mismo razonamiento que
cart-sharing.

### Shift open/close events

No urgente. El cajero abre su propio turno; el otro no necesita
saberlo en realtime (puede ir al historial). Si Thalia lo pide
explícitamente, es 1h de trabajo (emit + UI).

## Cómo verificar manualmente tras el deploy

1. **Setup**: abre el TPV con un cajero en dos pestañas distintas
   del mismo browser (o dos dispositivos), ambos en el mismo store.
2. **ticket.paid**:
   - En pestaña A, cobra un ticket de prueba.
   - En pestaña B: ver toast "Otra caja cobró un ticket (X,XX €)"
     en menos de 3 s. Contador del turno también sube.
3. **ticket.refunded**:
   - En pestaña A, devuelve una línea del ticket recién cobrado.
   - En pestaña B: ver toast "Devolución registrada en otra caja
     (X,XX €)".
4. **Reconexión**: tira la red (DevTools → Throttling Offline) en
   B, cobra en A, vuelve la red en B en 3-10 s. El stream debe
   reconectar y los siguientes eventos llegan; los eventos
   perdidos durante la desconexión NO se replican (best-effort).
5. **Throttling**: spam de 10 cobros en <1s en A no debe enviar
   más de 5 eventos a B. (Difícil de testear sin un script — el
   test unitario en `store-event-bus.test.ts` lo cubre.)

## Decisiones de arquitectura abiertas

- **Multi-instancia**: el bus es in-memory. Si pasamos a >1 instancia
  API (hoy no, pero si escala), sustituir por Redis pub/sub
  manteniendo la firma `subscribe/broadcast` del bus.
- **Persistencia de eventos**: no guardamos historial. Si quisiéramos
  reproducir los últimos N eventos al reconectar, hay que añadir un
  buffer circular per channel. No es necesario en piloto.
- **Granularidad del canal**: actualmente `storeId`. Si en el futuro
  un store tiene 5+ registers y queremos limitar broadcast (privacy
  entre cajeros), el bus acepta string arbitrario — basta cambiar la
  clave a `${storeId}:${registerId}`.
