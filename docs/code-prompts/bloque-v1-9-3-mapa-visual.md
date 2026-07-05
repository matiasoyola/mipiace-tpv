# Bloque v1.9.3 · mapa de sala visual (evolutivo bar)

## Contexto (leer antes)

- **`docs/mockups/mapa-sala-visual.html` — ES LA SPEC.** No interpretar: copiar estructura, jerarquía y estilos de ese HTML. Datos de ejemplo reales de Cafetería Sirope.
- `docs/code-prompts/bloque-v1-9-2-mesas-concurrencia.md` y su `v1-9-2-done.md` — PRERREQUISITO mergeado. Este bloque reescribe el layout de `TableMapScreen.tsx` sobre el header/banners que v1.9.2 dejó (Tickets + hamburguesa en el mapa, banners de concurrencia). Conservarlos.
- Principio de producto (Matías, 2026-07-05): el cobro nace en la mesa; el camarero ejecuta, no piensa.
- Principios UX Mi Piace (`docs/design/` / ux-principles): sin sombras pesadas, sin animaciones >300 ms, tabular-nums en importes, scroll vertical.

## Alcance

Rediseño de `TableMapScreen.tsx` según el mockup, manteniendo el data-flow actual (GET /tpv/tables + eventos WS). Frentes:

1. **Zonas como áreas espaciales**: SALÓN (grid 2 col dentro de su marco), TERRAZA (marco propio), BARRA (mostrador dibujado + taburetes circulares con `barSeatIndex`). Marcos con borde discontinuo y label flotante como el mockup. Zonas vacías de mesas no se pintan. RESERVADOS solo si existen mesas en esa zona.
2. **Tarjeta de mesa** (estados y contenido exactos del mockup): nombre grande; pax arriba-dcha; tiempo abierto bajo pax; pie con avatar-alias del camarero (2 iniciales del alias, fallback email) + total en tabular-nums. Estados: libre (blanco), ocupada (coral-soft), BILLING (ámbar + badge CUENTA).
3. **Grupos fundidos**: la mesa absorbida se pinta atenuada (opacity ~.55) con puente visual hacia la principal y sin contenido; la principal muestra badge «+M2» y pax sumados. Mantener el click de la absorbida → llevar a la principal.
4. **Alerta mesa olvidada**: mesa abierta >45 min sin cambios → halo ámbar interior (`inset ring`) y tiempo en ámbar. Umbral constante en el front (45 min), sin setting nuevo.
5. **Cobro desde la tarjeta** (SOLO estado BILLING, como el mockup): botón «Cobrar X €» en la tarjeta que abre el modal de cobro ACTUAL con la proyección fresca del DRAFT, sin pasar por SalePage. Mismo endpoint, mismo modal, misma idempotencia — cero cambios de flujo de dinero. Al cobrar: banner de confirmación de v1.9.2 sobre el mapa.
6. **Cabecera de sala**: «N abiertas · M libres · X,XX € en sala» (suma de totales de DRAFTs visibles — trazable a la misma respuesta de /tpv/tables; nada de cálculos nuevos en server).
7. Leyenda actualizada (libre / ocupada / pidiendo cuenta / +45 min).

## Restricciones

- Solo `apps/tpv-web` (+ tests). Sin cambios de API/schema. Los datos ya llegan; si algo falta en la respuesta de /tpv/tables (p.ej. alias del cajero por mesa), anotar como duda abierta y degradar con elegancia (ocultar avatar) — NO tocar la API.
- Tokens mipiace: coral #E97058 / ink #1F2937 / DM Sans / radios 18-22 / sin sombras (máx shadow-sm hover). Nada de emojis ni iconos sin texto en acciones.
- Responsive: impecable en 1280×800 y 1920×1080 (AP12) y usable en handheld (~390px: zonas apiladas, taburetes en fila con wrap, tarjetas 2 col). Scroll SIEMPRE vertical.
- Posiciones libres (`positionX/Y`) NO se usan todavía: layout por zona en grid auto. El schema queda como está.
- Fase de transición: si el tenant no es HOSPITALITY o no tiene mesas, nada de esto se monta (gate actual intacto).

## Entregables

- `apps/tpv-web/src/pages/TableMapScreen.tsx` reescrito + componentes extraídos si conviene (TableCard, BarStool, ZoneFrame).
- Tests: render por estados (libre/ocupada/billing/olvidada/absorbida), suma de cabecera, botón Cobrar solo en BILLING y abriendo el modal con el total fresco, gate de vertical intacto, barra ordenada por barSeatIndex.
- Criterio de «funciona»: test de los 30 segundos — un camarero que no ha visto nunca el TPV entiende el estado de la sala y qué mesa reclama atención sin que nadie le explique nada; y el flujo BILLING→Cobrar→banner sin entrar a la mesa.

## Fuera de alcance (explícito)

- Editor de posiciones drag-and-drop en admin (fase 2; `positionX/Y` sigue dormido).
- Cobro desde tarjeta en estado OCUPADA (solo BILLING; ampliar es decisión de producto posterior).
- Umbral de mesa olvidada configurable por tenant.
- Cualquier cambio en SalePage, checkout, API, eventos WS.
- Customer-facing display, reservas, agenda.
