# Bloque v1.9.3 · Mapa de sala visual (evolutivo bar) — DONE

**Rama:** `v1-9-3-mapa-visual`
**Spec:** `docs/mockups/mapa-sala-visual.html` (copiada, no interpretada) + `docs/code-prompts/bloque-v1-9-3-mapa-visual.md`.
**Principio de producto (Matías, 2026-07-05):** el cobro nace en la mesa; el camarero ejecuta, no piensa.
**Estado:** cerrado. Sólo `apps/tpv-web` (+ tests). Sin cambios de API/schema/eventos WS/flujo de dinero. Sin merge ni deploy (los hace Matías).

**Tests:** proyecto `tpv-web` verde — **229 passing en 20 ficheros** (antes 224); nuevo `table-map-visual.test.tsx` (5) y el `table-map-offline.test.tsx` existente (4) intacto. `tsc -b` de `apps/tpv-web` limpio.
⚠️ El resto del workspace (`@mipiacetpv/api`, 30 ficheros) **no corre en este entorno**: `Cannot find module '.prisma/client/default'` — falta `prisma generate` en la máquina, condición pre-existente ajena a este bloque (front-only). Verificar en CI/VPS donde el cliente Prisma sí está generado.

---

## Resumen

Rediseño de `TableMapScreen.tsx` de "listas de mesas por zona" a **lienzo espacial** fiel al mockup, manteniendo el data-flow actual (GET `/tpv/tables` + refresh por eventos WS + polling de respaldo). Se conserva íntegro el header/banners/drawer que dejó v1.9.2 (hamburguesa + Tickets en el mapa, Arqueo X / Cerrar turno / Sincronizar / Bloquear, banner inline de expulsión/éxito, modo degradado offline online-only).

## Ficheros

- `apps/tpv-web/src/pages/TableMapScreen.tsx` — reescrito. Componentes internos: `ZoneFrame`, `RoomGrid`, `TableCard`, `BarZone`, `BarStool`, `ZoneChips` + helpers `aliasName` / `avatarInitials` / `formatEur`.
- `apps/tpv-web/src/hooks/useElapsedTime.ts` — nuevo export `useElapsedMinutes(startIso)` (variante numérica para el umbral de mesa olvidada; mismo tick de 30 s).
- `apps/tpv-web/src/App.tsx` — pasa `registerId` a `TableMapScreen` (lo exige el modal de cobro).
- `apps/tpv-web/test/table-map-visual.test.tsx` — nuevo.

## Frentes entregados

1. **Zonas como áreas espaciales.** Marcos con borde discontinuo (`border-dashed`) y label flotante (`ZoneFrame`). Lienzo `ALL`: Salón dominante a la izquierda (`1fr`), Terraza/Reservados apilados a la derecha (columna `300px`), Barra a lo ancho abajo (`lg:col-span-2`). En handheld todo se apila (una columna, scroll vertical). Con un filtro de zona activo → un único marco a ancho completo. Zonas sin mesas no se pintan; **RESERVADOS** sólo si existen mesas en esa zona.
2. **Tarjeta de mesa** (`TableCard`): nombre grande; `N PAX` arriba-dcha; tiempo abierto bajo el pax; pie con avatar-alias del camarero (2 iniciales del alias, fallback email) + total en `tabular-nums`. Estados: libre (blanco), ocupada (coral-soft), BILLING (ámbar + badge `CUENTA`). Importes con coma decimal (`24,60 €`) como el mockup.
3. **Grupos fundidos.** La mesa absorbida (`groupedIntoTableId != null`) se pinta atenuada (`opacity-55`) con puente visual hacia la principal y texto `— unida a MX`, sin contenido; su click lleva a la principal (se le pasa la mesa principal a `onPickTable`). La principal muestra badge `+M2` (nombres de las absorbidas) y **pax sumados** (capacidad propia + absorbidas).
4. **Alerta mesa olvidada.** Mesa abierta ≥ 45 min → halo ámbar interior (`ring-2 ring-inset ring-amber-500`) y tiempo en ámbar. Umbral constante en el front (`FORGOTTEN_TABLE_MINUTES = 45`), sin setting nuevo.
5. **Cobro desde la tarjeta (SOLO BILLING).** Botón «Cobrar X €» que:
   - trae la **proyección fresca del DRAFT** con `GET /tickets/:id` (misma que usa `reloadTableDraft` de SalePage),
   - abre el **modal de cobro ACTUAL** (`CheckoutOverlay`) en modo mesa (`tableTicketId` + `tableId`), **sin pasar por SalePage** — mismo endpoint `POST /tickets/:id/checkout`, misma idempotencia (`externalId` generado en el propio modal), cero cambios de flujo de dinero.
   - Al cobrar: `onTablePaidExit` → banner de éxito de v1.9.2 sobre el mapa (con "Ver ticket") + `load()`. `onTableClosedElsewhere` (409 cobrada/absorbida en otra caja) → banner info + `load()`.
   - El `CheckoutOverlay` se importa **en diferido** (`React.lazy` + `Suspense`) para no engordar el arranque del mapa ni el grafo estático que cargan los tests existentes.
6. **Cabecera de sala:** `N abiertas · M libres · X,XX € en sala`. `abiertas` = mesas no-absorbidas con estado ≠ FREE; `libres` = total − abiertas (las absorbidas caen del lado de "no abierta", como el mockup); `€ en sala` = suma de `activeTicket.total` de los DRAFTs visibles no-absorbidos — trazable a la misma respuesta de `/tpv/tables`, sin cálculo nuevo en server.
7. **Leyenda** actualizada a 4 ítems: libre / ocupada / pidiendo cuenta / +45 min sin atender.

## Decisiones tomadas (dentro de alcance)

- **La tarjeta sigue siendo `<button>`** para libre/ocupada/absorbida (el modo degradado offline y sus tests dependen de `.disabled` y de `querySelectorAll("button")`). En BILLING el botón «Cobrar» va como **botón hermano en overlay** (posicionado sobre el pie), no anidado — HTML válido y sin romper el click de retomar de la tarjeta.
- **"Nueva venta rápida"** conserva ese texto (no el "+ Venta rápida" del header del mockup) para no romper el test de venta rápida offline; se reubicó como pill coral junto a los chips de zona.
- **Barra sin botón Cobrar** en los taburetes (el mockup tampoco lo pinta; el círculo de 84px no da). El cobro rápido desde tarjeta es para las mesas de sala; en barra se cobra entrando (tap → SalePage → cobrar). Ampliar es decisión de producto.
- **Contacto/notas en el cobro-desde-tarjeta van vacíos** (`contact=null`, `notes=""`): la proyección fresca del DRAFT (`GET /tickets/:id`) trae líneas y total pero **no** contacto ni notas. El `CheckoutOverlay` permite asignar contacto dentro si hace falta (`onRequestAssignContact` no se cablea aquí → el modal simplemente no ofrece reasignar; degradación elegante). Si el negocio necesita fijar contacto antes de cobrar, se entra a la mesa como hasta ahora.
- **Layout por zona en grid auto**; `positionX/Y` siguen dormidos (schema intacto).

## Dudas abiertas / degradaciones

- **Alias por mesa:** el pie usa `activeTicket.openedByAlias ?? openedByEmail`; si ambos faltan, **se oculta el avatar** (no se inventa). La API ya los expone (`ApiTable.activeTicket`), sin tocar.
- **`registerId` es opcional en los props** (`registerId?`): si no llegara, `canCobrar` es false y la tarjeta BILLING no muestra «Cobrar» (se cae al flujo de entrar a la mesa). App lo pasa siempre en el render del mapa.
- **Sin hallazgos para `docs/spike-holded.md`:** bloque 100% front, sin interacción nueva con la API de Holded.

## Fuera de alcance (respetado)

- Editor de posiciones drag-and-drop en admin (fase 2; `positionX/Y` dormido).
- Cobro desde tarjeta en estado OCUPADA (sólo BILLING).
- Umbral de mesa olvidada configurable por tenant.
- Cualquier cambio en SalePage, checkout, API, schema o eventos WS.
- Customer-facing display, reservas, agenda.
- El **gate de vertical** (HOSPITALITY + mesas) vive en `App` y **no se tocó**; a nivel de componente, sin mesas se pinta `EmptyState` (cubierto por test).

## Carryovers para el siguiente bloque

- **Validación visual pendiente** en 1280×800, 1920×1080 y handheld ~390px real (AP12) — no hay Playwright/screenshots en este entorno; la revisión visual del lienzo espacial queda para el revisor/piloto.
- **`prisma generate`** requerido para correr la suite `@mipiacetpv/api` localmente (no es regresión de este bloque).
- **Barra: cobro rápido** y **grupos con >1 absorbida** (badge `+M2, +M3`) implementados pero sólo probados con datos sintéticos; validar con cuenta piloto (Sirope).
- **Fase 2 (evolutivo):** posiciones arrastrables desde admin sobre `positionX/Y` — el layout actual ya está aislado por zona, migrar a coordenadas libres no debería tocar el data-flow.
