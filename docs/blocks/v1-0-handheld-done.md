# v1.0-Handheld · done

**Rama:** `v1-0-handheld` · un único commit, sin merge.
**Estado tests:** `pnpm test` 0 failed (89 files · 656 passed, 3 skipped pre-existentes de entorno Redis). `tsc -b` limpio en tpv-web, `vite build` OK.
**Objetivo:** TPV usable de verdad en handheld Android vertical (360-414px): catálogo primero, ticket como resumen compacto siempre visible que se expande a demanda. El layout de escritorio/tablet (≥1024px), validado por Sole, queda **idéntico** — todos los cambios cuelgan de `lg:`.

---

## Lote 0 · Overflow horizontal en 360px (bug visto 2026-06-12 en handheld real)

### Qué lo causaba

1. **El buscador del header no podía encoger.** El wrapper era `flex-1` SIN `min-w-0`: un flex item no encoge por debajo de su min-width intrínseco, y un `<input>` tiene ~240px de mínimo por su `size` por defecto. Con el cluster de botones fijos de la derecha (escanear 48px + refrescar 48px + Tickets + Pendientes + "+ Nueva venta", más gaps y paddings) la fila sumaba bastante más de 360px → `scrollWidth > clientWidth` y la página "rebosaba por los lados".
2. **TableMapScreen:** el botón con el email del cajero (`email.split("@")[0]`) sin truncar empujaba el header con emails largos; los chips de zona en `flex-wrap` multiplicaban filas sin límite.

### Fix

- `SalePage` header: en `<1024px` pasa a **dos filas** (`flex-wrap`): identidad + acciones arriba, buscador a ancho completo debajo (`order-last w-full`). El buscador y sus wrappers llevan `min-w-0` para poder encoger siempre. En `lg:` el header vuelve EXACTO a la fila única de 100px de siempre (`lg:flex-nowrap lg:h-[100px]`).
- Botones del cluster que no caben en estrecho: Escanear y Refrescar pasan a `hidden lg:flex`; el escáner gana un gemelo `lg:hidden` pegado al buscador (mismo handler) y el refresco en handheld vive en el drawer ("Sincronizar catálogo", que ya existía). El botón Tickets gana icono `lg:hidden` (antes en estrecho era invisible: sólo texto `hidden sm:inline`).
- `TableMapScreen`: email del cajero con `max-w-[45vw] truncate`; chips de zona en fila única con `overflow-x-auto` (+ `shrink-0` por chip) en estrecho, `lg:flex-wrap` en escritorio.
- `CheckoutPage` no necesitó cambios: su contenedor ya era `w-full h-full` en `<640px` (full-screen) sin anchos fijos.

### Criterio y verificación

jsdom **no calcula layout** (todo elemento mide 0×0), así que `scrollWidth === clientWidth` no es verificable ahí. El test `handheld-layout.test.tsx` verifica en su lugar las **guardas estructurales** que eliminan el overflow: `min-w-0` en input y wrappers, `order-last w-full` del buscador, `flex-wrap` del header. La igualdad real `documentElement.scrollWidth === clientWidth` a 360px en SalePage, TableMapScreen y CheckoutPage queda en la checklist manual de abajo (carryover: automatizarla requeriría un browser real — Playwright no está en el repo).

## Lote 1 · Layout handheld de SalePage (<1024px)

1. **Catálogo primero.** El `aside` del ticket pasa a `hidden lg:flex` — desaparece del flujo vertical en estrecho (antes iba `order-1`, encima del catálogo). Quedan arriba buscador + escáner (header) y chips de categorías + grid (sección de catálogo, sin cambios internos).
2. **Barra inferior fija** (`fixed`, `z-40`, `lg:hidden`, anclada con `bottom: var(--keyboard-offset)`): nº de líneas + total grande (`tabular-nums`) + abre el ticket. Altura total ~64px con botones `h-12` (48px ≥ 44px de target). En contexto mesa antepone "Mesa X · " y añade el botón Comanda (Lote 2). El footer informativo de página (estado online/cajero/versión) pasa a `hidden lg:grid` — su sitio lo ocupa la barra. Un spacer `h-20 lg:hidden` al final del catálogo evita que la barra tape las últimas filas del grid.
3. **Carrito como bottom-sheet.** El contenido del aside de escritorio se extrajo **tal cual** a un componente `TicketPanel` (header + chips cliente/descuento/notas + totales/Cobrar + listado con CartLineItem y steppers) que se monta en dos sitios: el aside clásico (`lg:`) y un sheet `role="dialog"` (`max-h-[88dvh]`, backdrop, asa, botón cerrar) que abre la barra inferior. Re-layout, no re-implementación: cero lógica duplicada. El estado (líneas, cliente, descuento) vive arriba en SalePage, así que abrir/cerrar el sheet **nunca** pierde nada. Los sheets de edición (LineSheet, descuento, cliente, notas) y el checkout abren con `z-50`, por encima del sheet (`z-40`).
4. **Cobrar** abre el CheckoutOverlay existente, que en `<640px` ya es pantalla completa. Sin cambios.
5. `--keyboard-offset` respetado en barra (bottom) y sheet (padding-bottom); ErrorBoundary y persistencia intactos (ninguna ruta de estado cambió).

## Lote 2 · Mesas en handheld

1. **Grid de mesas:** ya era `grid-cols-2 sm:grid-cols-3 …` con cards `aspect-[7/6]` táctiles — válido en estrecho tal cual (sin cambios). Lo que sí rompía: zonas y email del cajero (arreglado en Lote 0). Zonas ahora son chips en fila única con scroll horizontal (patrón tabs) en estrecho.
2. **Ciclo mesa→SalePage→comanda/cobro a una mano:** la barra inferior en contexto mesa lleva el botón **Comanda/Reenviar** (mismo handler y estados busy/revision que el chip del panel) + el botón de ticket con "Mesa X · n líneas · total". Cobrar desde el sheet → checkout full-screen → vuelta al mapa (flujo de v1.0-mesas-frontend, sin tocar).
3. **Badge "cobro pendiente"** (outbox): se pinta `absolute top-2 right-2` dentro de la card, visible en cualquier ancho — nada que adaptar, verificado que no depende de breakpoints.

## Lote 3 · Tests

`apps/tpv-web/test/handheld-layout.test.tsx` (5 tests jsdom, patrón `table-sale-flow` — createRoot + act, módulos pesados mockeados):

- La barra inferior renderiza nº de líneas y total correcto al añadir productos desde el catálogo (incl. agrupado: 2 taps mismo producto → "1 línea · 3,30 €").
- El bottom-sheet abre/cierra sin perder líneas (cerrar y reabrir conserva el contenido; la barra sigue contando).
- Estructura ≥1024px intacta: snapshot ligero de clases (aside `hidden lg:flex` con Subtotal/Total dentro, barra `lg:hidden fixed`, footer `hidden lg:grid`) — no píxeles, jsdom no aplica media queries.
- Lote 0: guardas anti-overflow del header presentes (min-w-0, order-last w-full, flex-wrap).
- Mesa: "Comanda" desde la barra inferior → `POST /tickets/:id/send-to-kitchen/escpos`; tras el envío rotula "Reenviar".

Los tests existentes de SalePage/mesas/outbox (`table-sale-flow`, `table-map-offline`, `checkout-outbox`, `outbox`…) siguen verdes **sin tocar**. Suite completa: 656 passed / 0 failed.

---

## Verificación manual a 390px (qué probar con el móvil o DevTools)

Emulación 390×844 (o handheld real). Capturas de estos 4 estados al validar en dispositivo:

1. **SalePage venta rápida:** sin scroll horizontal (`document.documentElement.scrollWidth === clientWidth` en consola); header a dos filas con buscador a ancho completo; añadir 3 artículos → la barra inferior actualiza líneas y total; tocar la barra → sheet con las líneas, steppers usables con el pulgar; cerrar → catálogo intacto; Cobrar → checkout a pantalla completa.
2. **Teclado virtual:** foco en el buscador → la barra inferior sube con el teclado (`--keyboard-offset`), no queda debajo.
3. **TableMapScreen:** 2 columnas de mesas, zonas como chips deslizables, sin desborde lateral con email de cajero largo; mesa con cobro en outbox muestra el badge "cobro pendiente".
4. **Ciclo mesa entero a una mano:** tocar mesa → SalePage con "Mesa X" en la barra → añadir líneas → Comanda desde la barra → abrir ticket → Cobrar → vuelta al mapa.

En escritorio (≥1024px): ni un píxel distinto — aside a la derecha, header de una fila, footer informativo, sin barra inferior.

## Decisiones

- **Breakpoint único `lg` (1024px)** como frontera handheld/clásico, el mismo que ya usaba el grid del workspace — evita estados intermedios nuevos en tablets.
- **`TicketPanel` extraído, no duplicado:** el aside de escritorio y el sheet montan el mismo componente; cualquier cambio futuro del panel sirve a ambos layouts.
- **Refrescar catálogo fuera del header en estrecho:** ya existía "Sincronizar catálogo" en el drawer; dos iconos redundantes no caben en 360px.
- **Sheet sin animación de entrada ni gesto swipe-down** (mount/unmount directo + botón cerrar + backdrop): suficiente para v1, sin dependencia de librería de gestos.

## Acciones manuales de deploy

Ninguna: sin deps nuevas, sin migraciones, sin env vars, sin cambios de CI. 100% frontend (`apps/tpv-web`), frontera de archivos respetada (cero cambios en api/admin/infra/.github/tpv-android).

## Carryovers

- **Capturas en dispositivo real pendientes:** la checklist de arriba está verificada por tests jsdom + build, pero falta la pasada visual en el handheld físico (y la igualdad `scrollWidth === clientWidth` real a 360px en las 3 pantallas). Hacerla antes de ponerlo en manos de camareros.
- **Test de overflow real no automatizable hoy:** jsdom no calcula layout; automatizar el criterio de Lote 0 pediría Playwright/browser-mode, que no está en el repo. Candidato si los regresiones de layout móvil se repiten.
- **Sheet sin gesto de arrastre ni animación** — pulir si el feedback de los camareros lo pide.
- **Modo apaisado del handheld** sin trabajo específico (fuera de alcance del bloque; el layout `lg:` cubre ≥1024px de ancho).
- **Impresión en la impresora integrada del handheld** → A1/A2 (Android nativo).

## Verificación visual (Chrome real)

Pasada post-commit con Chrome headless real (Playwright `page.route` mockeando toda la API + modo prueba `?testCashierToken`, SW bloqueado) contra el build de producción (`vite preview`). Cubre el criterio de Lote 0 — `document.documentElement.scrollWidth === clientWidth` — en las tres pantallas del bloque, en ambos anchos y con el flujo completo ejecutado de verdad (mapa → mesa → 3 artículos → sheet → checkout, y venta rápida):

| Pantalla | Ancho | scrollWidth | clientWidth | OK |
|---|---|---|---|---|
| TableMapScreen | 390 | 390 | 390 | ✅ |
| SalePage (mesa) | 390 | 390 | 390 | ✅ |
| SalePage (sheet abierto) | 390 | 390 | 390 | ✅ |
| CheckoutPage | 390 | 390 | 390 | ✅ |
| TableMapScreen | 360 | 360 | 360 | ✅ |
| SalePage (mesa) | 360 | 360 | 360 | ✅ |
| SalePage (sheet abierto) | 360 | 360 | 360 | ✅ |
| CheckoutPage | 360 | 360 | 360 | ✅ |
| SalePage (venta rápida) | 390 | 390 | 390 | ✅ |

**9/9 sin overflow horizontal.** Capturas en [`docs/blocks/handheld-shots/`](handheld-shots/):

- [`390-1-mapa-sala.png`](handheld-shots/390-1-mapa-sala.png) — mapa de sala: 2 columnas, zonas como chips, badge "cuenta".
- [`390-2-salepage-mesa.png`](handheld-shots/390-2-salepage-mesa.png) — SalePage en mesa: catálogo primero, header a dos filas.
- [`390-3-salepage-3-articulos.png`](handheld-shots/390-3-salepage-3-articulos.png) — 3 artículos añadidos: barra inferior con "Comanda · Mesa M1 · 3 líneas · 6,00 €".
- [`390-4-bottom-sheet-ticket.png`](handheld-shots/390-4-bottom-sheet-ticket.png) — bottom-sheet: chips de mesa, totales, Enviar comanda, Cobrar, líneas con stepper.
- [`390-5-checkout.png`](handheld-shots/390-5-checkout.png) — checkout a pantalla completa con teclado de atajos.
- [`390-6-venta-rapida.png`](handheld-shots/390-6-venta-rapida.png) — venta rápida sin contexto mesa.
- [`360-1-mapa-sala.png`](handheld-shots/360-1-mapa-sala.png) / [`360-2-salepage.png`](handheld-shots/360-2-salepage.png) — los mismos estados al ancho mínimo objetivo.
- [`1280-desktop-salepage.png`](handheld-shots/1280-desktop-salepage.png) — escritorio intacto: header de una fila, aside del ticket a la derecha, sin barra inferior.

Notas de la pasada:

- El banner amarillo de las capturas es el **modo prueba** del harness (no aparece en operación normal).
- Hallazgo cosmético pre-existente (también en escritorio): en `TableCard`, el badge "CUENTA"/"cobro pendiente" (absoluto, top-right) se solapa con la etiqueta "N PAX" — visible en `390-1-mapa-sala.png` (mesa M3). No se toca en este bloque (frontera "ni un píxel" del layout validado); candidato a micro-fix en el próximo bloque de mesas.
- Esto **resuelve el carryover** "igualdad scrollWidth === clientWidth real pendiente": queda verificada en Chrome real a 360 y 390px. Sigue pendiente únicamente la pasada en el handheld físico (táctil + teclado virtual real). El harness (Playwright + mocks) vive fuera del repo; si las regresiones de layout móvil se repiten, ese script es la base para automatizarlo en CI.
