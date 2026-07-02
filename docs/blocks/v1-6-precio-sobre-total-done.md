# v1.6 · Edición de precio de línea sobre el TOTAL (IVA incluido) — DONE

**Rama:** `v1-6-precio-sobre-total`
**Origen:** Frutos Secos Cachictos (implantación 2026-06/07). El tendero piensa en
precio final de venta: al editar el precio de una línea con el lápiz, el importe
que teclea es el **bruto con IVA**, no la base imponible.
**Verificado sobre:** `1786cc7`.

---

## Qué cambió

### `apps/tpv-web/src/lib/cart.ts` — helpers puros nuevos
Añadidos `netToGross` y `grossToNet`. **NO** se tocó `CartLine`, `computeLine` ni
`computeCart` — el modelo interno y el contrato con la API **siguen en neto**.

- `netToGross(net, taxRate) = round2(net · (1 + iva/100))` → bruto a céntimo.
- `grossToNet(gross, taxRate)` → neto con **4 decimales** (precisión
  `Decimal(12,4)` de b30), con **garantía de round-trip**:
  `netToGross(grossToNet(g)) === round2(g)`.

Sobre el round-trip: 4 decimales bastan **siempre** para los tipos españoles.
El neto redondeado a 4 dec tiene error ≤ 0,00005 €, que multiplicado por el
factor de IVA (≤ 1,21) da ≤ 0,00006 € de error en bruto — muy lejos del umbral
de medio céntimo. Como el bruto objetivo es un múltiplo exacto de céntimo, el
`round2` final siempre reconstruye el céntimo tecleado. Se dejó una **corrección
defensiva ±0,0001** en `grossToNet` por si el punto flotante desvía un borde,
pero **en la matriz de pruebas ningún caso la necesitó** (incluido el barrido
exhaustivo de 0,01–50,00 € a 21% y 10%, 10 000 importes).

### `apps/tpv-web/src/pages/SalePage.lineSheet.tsx` — el editor (lápiz T-5)
El input ahora **se teclea y se muestra en BRUTO** (IVA incl., sin modifiers),
coherente con el "X € ud." del header del sheet.

- **Prellenado:** `netToGross(override ?? unitPrice, taxRate)`.
- **Preview en vivo:** el bruto del input se convierte a neto con `grossToNet`
  **antes** de pasarlo a `computeLine` — nunca entran brutos al modelo.
- **Al aplicar (`commit`):** `override neto = grossToNet(brutoTecleado)`.
- **Regla catálogo:** si `round2(brutoTecleado) === netToGross(unitPrice)`
  (comparación **en céntimos de bruto**, no `!==` de floats de neto) → override
  `null`. Se mantiene la regla de no persistir overrides iguales al catálogo.
- **Restaurar:** limpia el override y repone el bruto de catálogo en el input.
- **Etiqueta:** "Precio unitario (IVA incl.)". Texto de ayuda actualizado y
  precio de catálogo mostrado en bruto.
- **Display colapsado:** el override (ámbar) y el tachado de catálogo ahora se
  pintan en **bruto** (antes mostraban neto pelado — esa era la incoherencia).
- `taxRate = 0` → bruto = neto, sin caso especial (factor 1).

### Tests
- **`apps/tpv-web/test/price-override-gross.test.ts`** (nuevo, 143 tests):
  matriz round-trip + barrido exhaustivo. Ver tabla abajo.
- `cart-precision.test.ts` sin cambios (sigue verde; el override sigue viajando
  en neto con 4 dec).

---

## Tabla de casos de round-trip probados

`net = grossToNet(gross, iva)`; se exige `netToGross(net, iva) === round2(gross)`
y `net` con ≤ 4 decimales.

| Tipo IVA | Cobertura | Corrección ±0,0001 usada |
|----------|-----------|--------------------------|
| 21 % (general)        | 28 importes puñeteros + barrido 0,01–50,00 € (5000) | No |
| 10 % (reducido)       | 28 importes puñeteros + barrido 0,01–50,00 € (5000) | No |
| 5,2 % (eléctrico)     | 28 importes puñeteros | No |
| 4 % (superreducido)   | 28 importes puñeteros | No |
| 0 % (exento)          | 28 importes puñeteros (bruto === neto) | No |

Importes puñeteros probados: céntimos impares (0,01/0,07/0,09/0,13…),
terminaciones `x,x5` (borde de redondeo: 0,15/0,25/1,05/1,25/1,15/5,55…),
valores pequeños y redondos (0,99/1,00/4,70/9,95/10,05/99,95/100,00/123,45).

**Resultado:** 148/148 verde (incluye `cart-precision`). Ningún caso requirió la
corrección defensiva.

---

## Verificación de cierre

- `pnpm test` (workspace completo): **93 files, 813 passed, 3 skipped**. Los 3
  skips son los timeouts Redis de entorno ya conocidos (carryover B7), no
  regresión.
- `tsc` limpio en `tpv-web`.
- Nota de entorno: el worktree arrancó sin `node_modules` ni Prisma Client
  generado; se corrió `pnpm install --frozen-lockfile` y `prisma generate
  --schema packages/db/prisma/schema.prisma`. Sin esto, los 28 test files de
  `apps/api` fallan con `Cannot find module '.prisma/client/default'` (falso
  negativo de entorno, no de código).

---

## Auditoría de coherencia visual

- **`CartLineItem.tsx`**: ya pintaba el override en **bruto**
  (`unitPriceOverride · (1 + iva/100)` con tachado de `priceGross`). Coherente
  con el nuevo criterio — **no requirió cambios**. El cajero no ve netos pelados.
- **`SalePage.tsx`**: no renderiza precios de override directamente; delega en
  `CartLineItem`. Sin cambios.

---

## Carryovers

1. **Contexto mesa:** el override de precio en línea de mesa usa otro camino
   (`allowPriceOverride={false}` oculta el lápiz; el PATCH de `/tables/:id/lines`
   no admite override puntual — ver `v1.0-mesas-frontend`). Este bloque **no lo
   toca**. Si en el futuro se habilita edición de precio en mesa, deberá aplicar
   la misma conversión bruto↔neto de este componente.
2. **`CartLineItem` línea ~173** multiplica `override · (1+iva)` inline en vez de
   usar `netToGross`. Funcionalmente idéntico (el `toFixed(2)` del formateo
   redondea igual); se dejó para no ampliar la frontera de archivos. Candidato a
   unificar con `netToGross` en un futuro barrido de limpieza.
3. **Sin cambios** en descuentos (`discountPct` sigue sobre neto), modifiers,
   payload API ni nombre `unitPriceOverride`.

---

## NO hacer aquí

Merge y deploy los hace Matías (CI → GHCR → `bash infra/deploy.sh`).
