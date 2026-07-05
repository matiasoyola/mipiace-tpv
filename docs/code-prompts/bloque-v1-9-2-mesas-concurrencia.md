# Bloque v1.9.2 · mesas-concurrencia + navegación de bar

## Contexto (leer antes)

- `docs/auditorias/2026-07-05-mapa-simulaciones-bar.md` — mapa de simulaciones con los 4 bugs UX confirmados EN PRODUCCIÓN (modo prueba, tenant Sirope) la víspera de su implantación. Es la fuente de verdad de este bloque.
- `docs/blocks/` de v1.0-mesas-frontend y v1.7 (rider badge CUENTA) — para entender la SalePage en contexto mesa y `useStoreEventStream`.
- Principio de producto fijado por Matías (2026-07-05): **en un bar el cobro nace en la mesa, no en el catálogo; el camarero no debe pensar, solo ejecutar**. Este bloque acerca la navegación a ese principio sin rediseñar pantallas (el rediseño visual del mapa tiene mockup propio en `docs/mockups/mapa-sala-visual.html` y es OTRO bloque).

Diagnóstico común de los 4 bugs: **el estado del servidor es sano en todos los casos** (claims de cobro, agrupación, carrera de apertura — verificado por SQL). Lo roto es que la SalePage en contexto mesa no escucha los eventos de SU mesa y silencia los errores HTTP. Este bloque es frontend `apps/tpv-web` + copy; **cero cambios de schema, cero migraciones, cero lógica fiscal**.

## Alcance

### Frente 1 · La mesa abierta escucha su propia realidad
En SalePage con `tableContext` activo, suscribirse (reutilizando `useStoreEventStream`, ya conectado) a los eventos de la mesa actual:

1. **Línea añadida/quitada por otra caja** → refetch de la proyección del DRAFT y actualización del panel (líneas + totales). Sin modal, sin toast de esquina: el panel simplemente refleja la verdad (latencia percibida cero; el dato ya llega por WS).
2. **`ticket.paid` de MI mesa (cobrada por otra caja)** → salir automáticamente al mapa con banner inline en el mapa, 4 s, autocerrable: «Mesa M3 cobrada desde Caja N». Si el modal de cobro estaba abierto, cerrarlo antes de salir.
3. **Mesa absorbida por un grupo (evento de grouping)** → salir al mapa con banner «M1 se ha unido a M4». Misma mecánica.
4. Si el evento llega estando el checkout modal abierto y la cuenta CAMBIÓ (líneas nuevas), actualizar el total del modal in situ con aviso inline dentro del modal: «La cuenta ha cambiado: total actual X €».

### Frente 2 · Los errores del servidor se ven
Hoy `POST /tickets/:id/checkout` y el add-line devuelven 400/409 que el front silencia. Tratamiento:

- `PAYMENTS_MISMATCH` (400) → aviso inline DENTRO del modal de cobro (zona roja bajo el total): «La cuenta ha cambiado desde otra caja. Total actual: X €» + botón «Actualizar» que refetchea y recalcula el modal. No cerrar el modal solo.
- `TICKET_ALREADY_PAID` / duplicate (409) → cerrar modal, salir al mapa, banner: «Esta mesa ya fue cobrada desde otra caja». NUNCA dejar el modal mudo: es el escenario de doble cobro físico.
- Add-line sobre DRAFT muerto (cobrado/anulado/absorbido) → banner inline sobre el panel del ticket: «Esta mesa ya no está abierta (cobrada o unida a otra). Vuelve al mapa.» + CTA «Ir al mapa».
- Cualquier otro error de checkout no tipificado → mostrar `message` del server en la misma zona inline (nada de tragar errores).

### Frente 3 · Navegación de bar (el mapa siempre a un toque)
1. **Tras cobrar una MESA**: cerrar el flujo directo al mapa. El modal «Ticket emitido» se sustituye, solo en contexto mesa, por banner de confirmación sobre el mapa (4 s, con «Ver ticket» que abre el detalle en Tickets). En venta rápida el modal actual se mantiene pero con **autocierre a los 4 s** (las acciones QR/PDF/email siguen disponibles en Tickets).
2. **Botón «Mesas» fijo en el header** de SalePage (venta rápida) y de TicketsHistoryPage: icono + texto, mismo peso visual que «Tickets». Sustituye al chip «Mapa»/«Volver al mapa de sala» enterrado en el panel (el del panel puede quedarse, pero el header manda).
3. **Header del mapa completo**: añadir «Tickets» y el menú hamburguesa (Arqueo X, Cerrar turno, Sincronizar catálogo, Bloquear) al header del TableMapScreen. Hoy el arqueo exige pasar por venta rápida: tres saltos para una operación de caja.
4. Copy menor: en el panel del ticket, «Turno · #N» pasa a «Ticket N del turno» (es un contador de tickets, no el número de turno).

## Restricciones

- Solo `apps/tpv-web` (+ tests). PROHIBIDO tocar: API, schema, `packages/*`, `SalePage.lineSheet.tsx` en su lógica de precios, `lib/cart.ts` en su aritmética.
- Sin modales nuevos en flujo crítico: todo feedback nuevo es banner/aviso inline (principios UX Mi Piace). Banners autocerrables 4 s con cierre manual.
- Sin animaciones >300 ms; sin toasts de esquina para acciones críticas.
- Los eventos WS ya existen (bus table.* + ticket.paid de v1.0/v1.1): consumirlos, no crear eventos nuevos en el server. Si un evento necesario NO existe, anotarlo en el done como duda abierta y resolver ese caso con refetch por polling suave al recuperar foco — no tocar la API en este bloque.
- Reconexión WS: al reconectar (ya hay hook con retry 3 s), refetch de la proyección si hay mesa abierta.

## Entregables

- `apps/tpv-web/src/pages/SalePage.tsx` (+ `TableMapScreen.tsx`, `TicketsHistoryPage.tsx`, componentes de banner que hagan falta).
- Tests: (1) evento de línea remota refresca proyección; (2) `ticket.paid` remoto expulsa al mapa con banner; (3) checkout 400 PAYMENTS_MISMATCH pinta aviso y botón Actualizar recalcula; (4) checkout 409 cierra modal + banner en mapa; (5) add-line a mesa muerta pinta banner con CTA; (6) autocierre del modal de éxito; (7) header: Mesas visible en venta rápida y Tickets, hamburguesa y Tickets visibles en mapa.
- Criterio de «funciona»: re-ejecutar A1, A2, A3 y A5 del mapa de simulaciones con dos pestañas contra Sirope en modo prueba y que el camarero perdedor SIEMPRE sepa qué ha pasado sin tocar nada.

## Fuera de alcance (explícito)

- El rediseño visual del mapa (`docs/mockups/mapa-sala-visual.html`): zonas espaciales, taburetes, cobro desde tarjeta, halo de mesa olvidada. Es el siguiente bloque de bar, con decisión de producto pendiente.
- Desglose de IVA que cuadre con el total al céntimo en PDF/térmico (método del resto mayor) — mejora anotada, no urgente, toca `ticket-pdf`/`escpos-builder`.
- Devoluciones en modo prueba (gate SYNCED→SKIPPED) — decisión de producto pendiente.
- Cualquier cambio de API/eventos del servidor, partir cuenta, mover línea, fiado.
- Autofocus del buscador en hostelería (esperar a verificar OSK en AP12 mañana; si molesta, es un hotfix de una línea aparte).
