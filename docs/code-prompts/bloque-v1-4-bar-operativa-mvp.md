# Bloque v1.4-Bar-Operativa-MVP · 4 lotes

Mínimo viable para empezar a activar pilotos del vertical HOSPITALITY (bar/restaurante). Master tras el merge del Hub. Crea rama `v1-4-bar-operativa-mvp` desde master, un commit por lote, sin merge.

## Contexto

El TPV ya tiene piezas básicas de bar: mapa de mesas (`TableMapScreen`), modificadores de líneas (B-Bar-Modifiers), modelo `Table` con `groupedIntoTableId` para grupos, `tableId` en `Ticket`. Lo que falta para operar un piloto bar de verdad es lo táctico día a día:

1. **WebSocket roto en producción** — el TPV intenta `wss://mipiacetpv.com/ws/store/...` y Caddy lo manda al handler de estáticos (no hay regla para `/ws/*`). Sin WS, el realtime entre dos camareros/cajas no funciona. Bloqueante para bar.
2. **Comanderas inexistentes** — al guardar una mesa, hoy no se imprime nada en cocina/barra. El camarero anota a mano y se lo lleva físicamente. Es el patrón con el que perdemos el deal frente a TPVs especializados.
3. **No se puede mover una mesa** — el cliente cambia de mesa, el ticket se queda anclado. BD soporta cambiar `tableId` pero no hay UI.
4. **No hay cuenta partida** — el grupo paga separado, hoy tenemos que rehacerlo a mano. Lo que el roadmap llama **B-3 Split bill**.

Los 4 lotes son independientes; pueden ir en cualquier orden. Recomiendo el orden listado porque cada uno desbloquea el siguiente para validar end-to-end con el piloto.

---

## Lote 1 · Bug-WS · Caddy enruta /ws/* al backend

**Motivo**: bug bloqueante. Sin esto, el realtime de Lote 4 v1.1 (`B-Realtime`) no funciona en producción aunque el código del backend esté correcto.

**Diagnóstico ya hecho** (Matías + Cowork 2026-06-01):
- El TPV en producción intenta `wss://mipiacetpv.com/ws/store/<storeId>?token=<jwt>`.
- Caddyfile (`infra/Caddyfile`) en el vhost `mipiacetpv.com`:
  - Tiene `handle_path /api/* { reverse_proxy api:3001 }` (proxea con strip prefijo).
  - Tiene `handle @publicTicketPdf { ... }` (regex para PDFs públicos).
  - Tiene `handle_path /product-images/*` (estáticos).
  - El último `handle {}` sirve la PWA estática con fallback a `index.html`.
- **No hay regla para `/ws/*`** → cae al handler PWA → devuelve `index.html` → el cliente WebSocket falla.

**Cambios**:

(1) En `infra/Caddyfile`, vhost `mipiacetpv.com`, **antes** del último `handle {}`:

```caddy
# B-Realtime: WS multi-terminal de tickets/mesas/turnos. El path no
# lleva /api porque el JWT del cashier ya identifica tenant + register
# y porque las CSP de la PWA permiten wss:// en el mismo dominio.
handle /ws/* {
    reverse_proxy api:3001
}
```

`reverse_proxy` de Caddy hace upgrade WebSocket automáticamente, no requiere config extra.

(2) Mismo bloque en `admin.mipiacetpv.com` por si en el futuro el admin abre un panel realtime.

(3) Actualizar la CSP de ambos vhost para añadir `wss://mipiacetpv.com` al `connect-src` (hoy solo está `wss://api.mipiacetpv.com`):

```
connect-src 'self' https://api.mipiacetpv.com wss://api.mipiacetpv.com wss://mipiacetpv.com;
```

(4) Tests funcionales — no se pueden hacer en el repo (es config de runtime). Documentar en el commit cómo validar tras deploy:

```
# Tras git pull + reload de caddy:
curl -i -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" https://mipiacetpv.com/ws/store/<storeId>?token=<jwt>
# Debe responder 101 Switching Protocols (no 200 HTML)
```

**Why**: cierra task #1 (Bug-WS). Desbloquea realtime entre pantallas que es base operativa de bar.

---

## Lote 2 · Comanderas separadas por sección

**Motivo**: el camarero pulsa "Enviar mesa" y la barra recibe el ticket de las bebidas, la cocina recibe el ticket de la comida. Hoy NO se imprime nada al guardar mesa.

**Diseño**:

Para MVP no asumimos infraestructura de impresoras por sección (eso es v1.5 con agente local). En vez de eso, **agrupamos las líneas por sección** y generamos **PDFs/tickets separados** que se imprimen todos en la impresora del register actual. El camarero los lleva a mano. Reduce errores y ahorra escritura.

**Cambios backend**:

(1) **Modelo `Tag` o convención**: añadir un campo `printSection: SectionType?` al modelo `ProductTag` o al `TagAlias`. Si no existe modelo de tag editable per-tenant, crear `TenantTagConfig` con `(tenantId, slug, displaySection)`.

Si el modelo no merece la pena, usar una **convención de naming**: tags que empiezan por `bar-*` → BARRA, `cocina-*` → COCINA, resto → SALON. El super-admin puede renombrar tags via `TagAlias` ya existente.

Decisión recomendada: añadir tabla `TagSection (tenantId, tagSlug, section)` con migración `b25_tag_section`. Más limpio que convención.

(2) **Endpoint nuevo** `POST /tickets/:id/send-to-kitchen` que:
- Carga el ticket con sus líneas + tags de cada product.
- Agrupa líneas por sección (BARRA, COCINA, SALON).
- Genera un PDF por sección con header (mesa, hora, nº comanda) y lista de líneas.
- Marca el ticket con `lastSentAt` y `lastSentRevision` (para detectar cambios entre envíos).
- Emite evento WS `ticket.sent_to_kitchen` con el resumen para que otras tablets se enteren.

(3) **PDF**: reusar el helper de PDF de ticket que ya tenemos. Una plantilla mínima por sección.

**Cambios frontend (TPV)**:

(4) En `SalePage` o `TableScreen`, cuando hay una mesa abierta con líneas no enviadas, mostrar un botón **"Enviar comanda"** prominente. Si todas las líneas ya están enviadas, mostrar "Reenviar comanda" en gris.

(5) Al pulsar "Enviar", llama al endpoint, abre cada PDF en una pestaña/iframe para imprimir, y notifica visualmente ("Enviado a BARRA: 3 líneas · COCINA: 2 líneas").

**Cambios admin**:

(6) En `TenantDetailPage`, sección nueva "Secciones de cocina/barra" que lista los tags del tenant y permite asignar cada uno a BARRA, COCINA o SALON (default).

**Tests**: vitest del endpoint con dos secciones, validando que devuelve 2 PDFs distintos con las líneas correctas.

**Why**: cierra el primer dolor real del bar (camarero anotando a mano). Sin esto el TPV no es competitivo con sistemas dedicados.

---

## Lote 3 · Mover ticket entre mesas

**Motivo**: el cliente se cambia de la mesa 4 a la 7. Hoy el camarero no puede mover el ticket — tendría que cobrar y rehacer.

**Cambios backend**:

(1) **Endpoint** `POST /tickets/:id/move-to-table` con body `{ newTableId: string }`. Validaciones:
- `newTableId` existe y pertenece al mismo store que el ticket.
- La mesa destino NO tiene otro ticket en `DRAFT` (si lo tiene, devolver 409 con info de cuál — el frontend puede ofrecer "fusionar" o "elegir otra mesa").
- El cashier que hace la petición tiene acceso al register correspondiente.

(2) Actualizar `ticket.tableId`. Emitir 2 eventos WS:
- `mesa.<oldTableId>.released` → la mesa origen pasa a libre.
- `mesa.<newTableId>.occupied` → la mesa destino pasa a ocupada con preview del ticket.

(3) Auditar el movimiento con `TicketEvent` (si existe el modelo) o con un log.

**Cambios frontend (TPV)**:

(4) En la vista de mesa abierta (panel del ticket), añadir un botón de overflow (3 puntos) con opción "Mover a otra mesa". Al pulsar, abre un modal con el `TableMapScreen` en modo "elegir mesa libre". Las mesas libres son tappables, las ocupadas están grises con tooltip.

(5) Al confirmar destino, llama al endpoint y, en éxito, redirige al panel de la nueva mesa.

**Tests**: vitest del endpoint — mover a mesa libre, mover a mesa ocupada (409), mover a mesa de otro store (403), mover ticket ya cobrado (400).

**Why**: caso de uso diario en cualquier bar/resto. Sin esto los camareros se frustran.

---

## Lote 4 · Cuenta partida (Split bill) — B-3

**Motivo**: la mesa pide pagar separado. Hoy el cajero tiene que cobrar el total y los comensales se reparten por fuera, o el cajero hace un "apaño" de ticket. Roto para cualquier mesa de >1 comensal.

**Diseño**:

Para MVP no llegamos a "split por persona con asignación de líneas drag-and-drop". Empezamos con **2 modos**:

**Modo A · Partir importe** (lo más usado en bares): "Cobrar 30 € del total 80 €". El ticket original mantiene 50 € pendientes. Otro cobro se hace después. Cuando llega al total se cierra.

**Modo B · Partir líneas**: "Estas 4 líneas van con este pago, estas 6 con otro". El sistema crea un sub-ticket con esas líneas, lo cobra, y mantiene las restantes en el original.

**Cambios backend**:

(1) **Endpoint** `POST /tickets/:id/partial-payment` (Modo A):
- Body: `{ amount: number, method: PaymentMethod, ... }`.
- Valida que `amount <= ticket.total - ticket.paymentsCollected`.
- Crea un registro en una tabla `TicketPartialPayment (ticketId, amount, method, paidAt, cashierId)`.
- Actualiza `ticket.paymentsCollected` (campo nuevo opcional).
- Si tras el pago `paymentsCollected === total`, mover ticket a `PAID` (mismo flujo que el cobro normal).
- Emite evento WS `ticket.partial_paid`.

(2) **Endpoint** `POST /tickets/:id/split` (Modo B):
- Body: `{ lineIds: string[], asNewTicket: boolean }`.
- Crea un nuevo ticket con las líneas indicadas, en estado DRAFT.
- Quita esas líneas del ticket original (recalcula totales).
- Mantiene ambos en la misma mesa O permite indicar `newTableId`.
- Emite evento WS.

(3) **Holded**: la sincronización a Holded se hace cuando cada ticket queda PAID. Cada ticket es un `salesreceipt` independiente.

**Cambios frontend (TPV)**:

(4) En el modal de cobro (`CheckoutPage` / `CheckoutOverlay`), añadir un botón "Partir cuenta" cerca del total. Al pulsar, modal con dos opciones: "Por importe" o "Por líneas".

(5) **Por importe**: input grande, atajos para mitad / tercios / cuartos del total restante. Al confirmar, el cobro habitual procede con ese importe; al salir, el modal de la mesa vuelve a mostrar el restante.

(6) **Por líneas**: vista de checklist de líneas del ticket. Cada línea pulsable. Al confirmar, abre el cobro habitual para esas líneas; el resto se mantiene en el ticket original.

**Tests**: cubrir los flujos de partir importe (pago final cierra ticket), partir líneas (sub-ticket independiente), y casos de error (amount > pendiente, lineIds inválidos).

**Why**: cierra B-3 del roadmap. Convierte el TPV en operable para mesas de grupo, que es el 60% de las mesas reales.

---

## Convenciones

- Un commit por lote, mensaje `Lote X · v1.4-Bar-Operativa-MVP · ...`.
- NO mergear. Espero `git merge --ff-only` desde master.
- Lote 1 (Bug-WS) es 5 minutos de cambio. Hazlo primero para desbloquear realtime.
- Lote 2 (comanderas) puede crecer; si te falta tiempo, deja el modelo + endpoint listos y la UI en `TableScreen` como botón básico, sin embellecer.
- Lote 4 (split bill) es el más complejo. Si tienes que partirlo, prioriza Modo A (partir importe) — es el 80% del uso real en bares pequeños.

## Pendientes para fases posteriores (NO entran en este bloque)

- KDS pantalla cocina dedicada.
- Agente local para impresoras térmicas en cocina/barra.
- Reasignación dinámica de mesas / arrastrar líneas entre mesas en la UI.
- Camareros con permisos por mesa.
- Análisis horarios pico / informes operativos.
