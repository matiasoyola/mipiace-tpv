# Bloque v1.0-Handheld · TPV usable de verdad en dispositivo de mano

**Rama:** `v1-0-handheld` (worktree desde master, DESPUÉS de mergear `v1-0-mesas-frontend` — este bloque toca SalePage y el flujo de mesa)
**Contexto:** los TPV portátiles (móvil/handheld Android, 360-414px de ancho, vertical) son línea estratégica: camareros en sala en los bares y modelos con impresora integrada. Hoy el TPV en móvil "funciona" (v1.5-hotfix5 restauró el scroll) pero la UX es de escritorio apilado: ticket primero, catálogo debajo, todo a base de scroll.
**Estimación:** 1-1,5 días Code.
**Entrega:** un único commit, sin merge. `pnpm test` 0 failed, CI verde, `docs/blocks/v1-0-handheld-done.md`.

---

## Principio de diseño

En un handheld el cajero/camarero está DE PIE, con una mano, añadiendo artículos rápido. Lo primero es el catálogo y el buscador; el ticket es un resumen compacto siempre visible que se expande a demanda. Nada de esto cambia el layout de escritorio/tablet apaisada (≥1024px de ancho), que está validado por Sole y no se toca.

## Lote 0 · Matar el overflow horizontal (bug visto 2026-06-12 en handheld real)

En un Android estrecho la pantalla "rebosa por los lados": hay scroll/desborde horizontal. Antes de re-layoutar nada, encontrar y eliminar TODO lo que fuerza ancho en viewports estrechos (anchos fijos, min-width heredados, grids sin wrap, paddings que suman de más). Criterio: en 360px de ancho, `document.documentElement.scrollWidth === clientWidth` en SalePage, TableMapScreen y CheckoutPage. Test que lo verifique en jsdom donde sea posible + nota en done.md de qué lo causaba.

## Lote 1 · Layout handheld de SalePage (viewports estrechos, <1024px)

1. **Catálogo primero**: buscador + escáner + chips de categorías arriba; grid de artículos a continuación. El bloque de ticket completo desaparece del flujo vertical.
2. **Barra inferior fija** (thumb-zone): nº de líneas + total grande + botón "Ticket". Siempre visible, altura ≥56px, targets ≥44px.
3. **Carrito como bottom-sheet**: tocar la barra abre el ticket en un panel deslizante (líneas con stepper, cliente/descuento/observaciones, Cobrar). Cerrar vuelve al catálogo sin perder nada. Reutilizar los componentes existentes (CartLineItem, chips) — es re-layout, no re-implementación.
4. **Cobrar** abre el flujo de checkout existente a pantalla completa (en móvil ya casi lo es).
5. Respetar `--keyboard-offset` (teclado virtual) y el ErrorBoundary/persistencia existentes.

## Lote 2 · Mesas en handheld (camarero en sala)

1. TableMapScreen en estrecho: grid de mesas adaptado (2-3 columnas, cards táctiles grandes), zonas como tabs/chips horizontales.
2. El flujo mesa→SalePage handheld→comanda/cobro funciona entero con una mano. Enviar comanda accesible desde la barra inferior en contexto mesa.
3. El badge "cobro pendiente" (outbox de mesa) visible también en el mapa estrecho.

## Lote 3 · Tests + verificación

- jsdom: la barra inferior renderiza el total correcto; el bottom-sheet abre/cierra sin perder líneas; en ancho ≥1024 el layout clásico sigue (snapshot ligero de estructura, no píxeles).
- Los tests existentes de SalePage/mesas/outbox siguen verdes sin tocar.
- `vite build` OK. Verificación visual: capturas en 390px (el done.md las referencia con qué probar a mano).

## Frontera de archivos (en paralelo solo con `a0-android-scaffold`)

PROHIBIDO: `apps/tpv-android/**`, `apps/api/**` (este bloque es 100% frontend; si crees necesitar API, para y documenta), `infra/**`, `.github/**`, `apps/admin/**`.

## Fuera de alcance (NO hacer)

- Impresión en la impresora integrada del handheld → es A1/A2 (Android nativo), no esto.
- Rediseño visual del escritorio/tablet — ni un píxel.
- Modo apaisado del handheld: si sale gratis bien, pero el objetivo es vertical.

## Definición de hecho

1. `pnpm test` 0 failed. CI verde en el push.
2. Demostrable en un móvil real (o emulación 390px): añadir 3 artículos desde el catálogo, abrir ticket, cobrar — sin scroll forzado ni elementos cortados; y el ciclo mesa completo en estrecho.
3. `docs/blocks/v1-0-handheld-done.md` con capturas/decisiones/carryovers.
4. Un único commit: `v1.0-handheld · layout móvil de SalePage + mesas en mano · catálogo primero, barra inferior, carrito en sheet`.
