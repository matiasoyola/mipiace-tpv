# Bloque v1.4-Precio-Decimales · 1 lote crítico

Ampliar la precisión decimal de todos los campos de dinero del schema, del sync de Holded, del cálculo del carrito y del payload de upload a Holded, para eliminar el desfase de céntimos detectado entre el TPV y Holded. Crea rama `v1-4-precio-decimales` desde master, un único commit, sin merge.

## Contexto

2026-06-04 con Peluquería Sole detectamos que el servicio "CORTAR UÑAS SOLO" se muestra en el TPV como **4,69 €** mientras Holded lo factura como **4,70 €**. Tras investigar:

- En Holded el precio NET interno es `3.8843` (Holded lo permite con 4 decimales). Su UI muestra `3,88` truncado.
- En la BD del TPV el campo `products.base_price` es `Decimal(10, 2)` → Prisma trunca a `3.88` al sincronizar.
- TPV calcula gross = `3.88 × 1.21 = 4.6948 → 4.69 €`.
- Holded calcula gross = `3.8843 × 1.21 = 4.70003 → 4.70 €`.

Resultado: **1 céntimo de drift por línea**. En tickets con varias unidades del mismo servicio el drift se multiplica. Esto es bug fiscal: el cliente paga lo del TPV pero la factura emite otro importe. NO es aceptable en producción.

El mismo bug afecta a TODO el catálogo (cualquier servicio o producto cuyo gross "real" termine en `.5` después del IVA), no solo a este servicio. Hay que arreglar la precisión de extremo a extremo.

## Cambios

### 1 · Schema (migración `b30_money_precision_4`)

Ampliar precisión de **todos** los campos monetarios a `Decimal(12, 4)`. Auditar exhaustivamente:

- `products.base_price` (line 619 schema.prisma).
- `ticket_lines.unit_price`, `unit_price_override`, `subtotal`, `total` (lines 910-922).
- Cualquier campo `Decimal` en `Ticket` relacionado con dinero (subtotal, total, descuentos, importes de pagos).
- `Payment.amount` si existe (mirar modelo Payment).
- `Shift.cashOpening`, `Shift.cashCounted` si tienen Decimal(10,2).
- `Refund.*` y `RefundLine.*` igual.
- Cualquier otro `Decimal(10, 2)` o `Decimal(_, 2)` en el schema relacionado con €.

NO tocar:
- `taxRate Decimal(5, 2)` — 21.00 ya cabe.
- `discountPct Decimal(5, 2)` — porcentaje.
- `units Decimal(10, 3)` — ya tiene 3 decimales.

Migración SQL:

```sql
ALTER TABLE "products"     ALTER COLUMN "base_price"          TYPE DECIMAL(12, 4);
ALTER TABLE "ticket_lines" ALTER COLUMN "unit_price"          TYPE DECIMAL(12, 4);
ALTER TABLE "ticket_lines" ALTER COLUMN "unit_price_override" TYPE DECIMAL(12, 4);
ALTER TABLE "ticket_lines" ALTER COLUMN "subtotal"            TYPE DECIMAL(12, 4);
ALTER TABLE "ticket_lines" ALTER COLUMN "total"               TYPE DECIMAL(12, 4);
-- … completar tras auditar el schema completo.
```

Idempotente: ALTER ... TYPE no destruye datos, solo amplía precisión.

### 2 · Cliente `holded-client`

Auditar `packages/holded-client/src/` (especialmente `products.ts` y `services.ts` si existe):

- Verificar que el parseo de los floats del JSON de Holded **no trunca** ni pierde decimales. Si usa `parseFloat` o `Number()` ya conserva precisión IEEE-754 suficiente (basta para 4 decimales). Si pasa por `toFixed(2)` o similar, eliminar.
- En `salesreceipt.ts` función `buildSalesreceiptPayload` (o equivalente) — asegurar que los precios enviados a Holded mantienen 4 decimales. Verificar en `docs/holded/endpoints/salesreceipt.md` qué precisión acepta el endpoint.

### 3 · Sync inicial + sync incremental

`apps/api/src/onboarding/initial-sync.ts` y cualquier worker de sync de catálogo:

- Persistir `basePrice` con 4 decimales (no `toFixed(2)`).
- Si hay tests, actualizarlos con valores tipo `3.8843`.

### 4 · Cálculo del carrito en el TPV

`apps/tpv-web/src/lib/cart.ts` función `computeLine`:

- Operar internamente con 4 decimales.
- Solo redondear a 2 decimales para el DISPLAY del importe gross final.
- Subtotal por línea = `units × unitPrice (4 dec)` — sin redondear.
- Gross línea = `subtotalNet × (1 + taxRate/100)` — redondear a 2 al final del CÁLCULO de display.
- Total del ticket: agregar netos primero, aplicar IVA al total agregado, redondear UNA VEZ al final (esquema fiscal correcto).

### 5 · Upload a Holded

`apps/api/src/tickets/upload-ticket.ts` (o `build-document.ts`):

- Cuando construyas `items[]` para el salesreceipt, enviar `price` con 4 decimales (el campo NET del producto).
- Si Holded prefiere otro shape, documentarlo y mandarlo coherente.
- El total esperado para validación `expectedTotal` debe calcularse con la misma fórmula que Holded (agregar netos por tipo de IVA, aplicar IVA, redondear al final).

### 6 · Backfill / Re-sync

Script `apps/api/src/scripts/resync-catalog.ts`:

- Forzar re-pull del catálogo de productos+servicios desde Holded para repoblar `basePrice` con 4 decimales.
- Idempotente: si la migración b30 ya pasó, la columna acepta los 4 decimales.
- Filtrable por tenantId.
- Para correr en VPS: `pnpm --filter @mipiacetpv/api tsx src/scripts/resync-catalog.ts --tenantId=...`.

### 7 · Tests

`apps/api/test/cart-compute.test.ts` (o el más cercano):

- Caso 1: producto net `3.8843` × 1 unidad × IVA 21% → gross display `4.70`, gross stored `4.7000`.
- Caso 2: producto net `3.8843` × 2 unidades × IVA 21% → total ticket `9.39`, NO `9.38`.
- Caso 3: agregación por tipo de IVA cuando hay líneas con net distinto (4%, 10%, 21%) → cada bucket se calcula y redondea independientemente.
- Caso 4: con `unitPriceOverride = 4.50` (manual del cajero) → preservar 4 decimales internamente y display 2.

`apps/api/test/holded-upload-precision.test.ts`:

- Build payload salesreceipt con un item de net `3.8843` × 2 unidades. Verificar que el `price` enviado es `3.8843` (no `3.88`).
- Mock GET-back del doc con `total: 9.39` y validar que invariantes pasan (no salta silent_reject por desfase).

### 8 · Documentación

- `docs/holded/patrones/tolerancias.md` — añadir nota: "Precios NET se guardan con 4 decimales; el cálculo del gross redondea AL FINAL, no por línea".
- `docs/errores/README.md` — añadir entrada ✅: "Desfase 1 céntimo TPV vs Holded en líneas con cantidad ≥ 2". Causa: precisión `Decimal(10, 2)` insuficiente. Fix: b30.
- `docs/holded/endpoints/products.md` — anotar precisión real del campo `price` en Holded (4 decimales).

## Convenciones

- Un único commit, mensaje `v1.4-Precio-Decimales · 4 decimales en NET para alinear con Holded`.
- NO mergear. Espero merge `--ff-only` desde master.
- Tests obligatorios (4-6 casos al menos). Si algún test pre-existente se rompe por el cambio de precisión, arreglarlo en el mismo commit.
- Migración b30 backward-compatible (ALTER TYPE no destruye datos).
- Backfill se ejecuta MANUALMENTE en VPS tras deploy; no en migración automática.

## Out of scope

- Refactor del modelo Tax (sigue con sus 2 decimales para porcentajes).
- Soporte multi-divisa (sigue siendo solo EUR).
- Internacionalización del separador decimal (sigue "," español).
- Recalcular tickets HISTÓRICOS ya emitidos (esos quedan como están; el bug afecta a tickets futuros tras el deploy).
