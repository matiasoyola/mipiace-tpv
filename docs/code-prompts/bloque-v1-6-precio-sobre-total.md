# Bloque v1.6 · Edición de precio de línea sobre el TOTAL (IVA incluido)

**Rama:** `v1-6-precio-sobre-total` (worktree nuevo, NO sobre master directo)
**Origen:** pedido de Frutos Secos Cachictos durante su implantación (2026-06/07). El tendero piensa en precio final de venta: cuando edita el precio de una línea ya añadida al cobro, el importe que teclea debe ser el **bruto con IVA**, no la base imponible.
**Tamaño:** bloque pequeño y quirúrgico. Un archivo de UI + helper puro + tests. Si te descubres tocando más, párate.

---

## Frontera de archivos (estricta)

Este bloque toca SÓLO:

- `apps/tpv-web/src/pages/SalePage.lineSheet.tsx` — el editor de línea (lápiz T-5).
- `apps/tpv-web/src/lib/cart.ts` — SOLO para añadir helpers puros `netToGross` / `grossToNet` si no existen (NO cambies el modelo `CartLine` ni `computeLine`).
- `apps/tpv-web/test/**` — tests nuevos (sugerido: `price-override-gross.test.tsx` y/o ampliar `cart-precision.test.ts`).
- `docs/blocks/v1-6-precio-sobre-total-done.md` (done.md de cierre).

**NO toques:** `apps/api/**`, `apps/admin/**`, `apps/tpv-android/**`, `packages/**`, schema/migraciones, ningún otro prompt. El contrato con la API y el modelo interno del carrito **siguen en neto** — este bloque es exclusivamente capa de entrada/presentación.

---

## Estado actual (verificado 2026-07-02 sobre `1786cc7`)

- `SalePage.lineSheet.tsx` edita `unitPriceOverride`, que es precio **neto** sin IVA. El input se prellena con `line.unitPriceOverride ?? line.unitPrice` (netos ambos) y `commit()` persiste el parseado tal cual como override neto.
- `cart.ts` define `priceGross = unitPrice * (1 + taxRate/100)` (sin modifiers) y `computeLine` consume neto. El header del sheet ya muestra `formatEur(line.priceGross)` ud. — el cajero VE bruto pero EDITA neto: esa es la incoherencia a matar.
- Precisión: desde b30 (v1.4-precio-decimales) los precios viajan y se guardan con `Decimal(12,4)` — el override neto derivado puede y debe guardarse con 4 decimales.

## Comportamiento objetivo

1. El input del editor de precio se interpreta como **precio unitario bruto (IVA incluido), sin modifiers** — coherente con el "X € ud." del header del sheet.
2. Prellenado: bruto efectivo actual = `round2(effectiveNet * (1 + taxRate/100))` (con override si lo hay; si no, `line.priceGross`).
3. Al aplicar: `override neto = bruto / (1 + taxRate/100)` redondeado a **4 decimales**, de forma que `round2(neto4 * (1 + taxRate/100)) === bruto tecleado` — el total que ve el cajero debe re-redondear EXACTO a lo que tecleó. Añade test que lo asegure para los tipos españoles reales (21, 10, 5.2, 4, 0) y para importes puñeteros (céntimos impares, x,x5). Si encuentras un caso donde 4 decimales no bastan para el round-trip, documéntalo en el done.md con el ajuste elegido (p. ej. corregir el neto en ±0,0001).
4. Si el bruto tecleado equivale al bruto de catálogo (`round2(unitPrice * (1+tax))`), el override queda `null` — se mantiene la regla actual de no persistir overrides iguales al catálogo. Compara en céntimos de bruto, NO con `!==` de floats sobre netos.
5. "Restaurar" sigue limpiando el override; el precio de catálogo que muestre debe ser el bruto.
6. Etiqueta del campo explícita: "Precio (IVA incl.)" o similar; el desglose del preview (`computeLine`) no cambia de lógica, solo verifica que lo que se muestre como precio unitario editado sea bruto.
7. `taxRate = 0` → bruto = neto, debe funcionar sin caso especial visible.
8. El preview en vivo del sheet (`previewUnitPrice` → `computeLine`) debe seguir funcionando: convierte el bruto del input a neto ANTES de pasarlo a `computeLine`, no metas brutos en el modelo.

## Qué NO es este bloque

- NO cambia descuentos (`discountPct` sigue aplicando sobre neto como hoy).
- NO cambia modifiers ni su aritmética.
- NO toca el override de precio en contexto mesa más allá de lo que comparta este mismo componente (si el flujo mesa usa otro camino de edición, anótalo como carryover, no lo arregles aquí).
- NO renombra `unitPriceOverride` ni altera el payload hacia la API.

## Auditoría de coherencia visual (mismo bloque, alcance mínimo)

Revisa `CartLineItem.tsx` y las zonas de `SalePage.tsx` que pinten el precio unitario de una línea con override: el cajero no debe ver un neto "pelado" donde acaba de teclear un bruto. Si el arreglo es trivial (formatear con el bruto derivado), hazlo; si descubres algo estructural, carryover al done.md.

## Cierre

- Suite completa verde (`pnpm test` del workspace) + `tsc` limpio.
- `docs/blocks/v1-6-precio-sobre-total-done.md`: qué cambió, tabla de casos de round-trip probados, carryovers.
- NO mergees ni despliegues — lo hace Matías (CI → GHCR → `bash infra/deploy.sh`).
