# Prompt para Claude Code — Bloque 7.5

Mini-bloque dedicado. Foco único: arreglar el sync de taxes
heredado de B1 que dejó al TPV en sandbox sin productos vendibles
tras la validación de B6.

Pega esto en una sesión nueva de Claude Code tras pushear B7.

---

Hola Code. B7.5 es un mini-bloque acotado para arreglar el bug
crítico de taxes que la validación de B6 destapó. Sin esto, el TPV
en sandbox no vende productos reales (sólo wildcards), y el riesgo
de que en producción con cliente real tampoco funcione es real
porque la implementación actual depende de un mapping de IDs que
no se está resolviendo.

## Contexto

B7 cerrado (commit `5263045`). Lee primero:

- `docs/blocks/B5-done.md` §"Frente 1.1 taxRate=0" — diseño
  original del `buildTaxRateResolver` y del gate
  `sellableViaTpv=false`.
- `docs/blocks/B7-done.md` — qué quedó hecho en B7.
- `docs/spike-holded.md` §03.A — el spike de taxes original (con
  cuenta sandbox distinta, donde funcionó con `s_iva_21`).
- `packages/holded-client/src/taxes.ts` — el código actual de
  `listTaxes` + `buildTaxRateResolver` + `parseTaxRateFromId`.
- `apps/api/src/onboarding/initial-sync.ts` y
  `apps/api/src/catalog/incremental-sync.ts` — cómo se llaman al
  resolver y cómo se persiste `Product.taxRate`.

## Datos empíricos del problema (de la validación B6)

Sobre la BD viva del piloto (cuenta sandbox actual):

- `products`: 101 total, **sólo 1 con `sellable_via_tpv=true`** (un
  wildcard).
- `tenant_taxes`: 9 filas, **TODAS con `rate IS NULL`**.
- Muestra de productos (campo `raw->'taxes'`):
  ```
  Camisa basic logo  | tax_rate 0.00 | sellable false | taxes ["tax_49_sales"]
  Gorra logo frontal | tax_rate 0.00 | sellable false | taxes ["tax_28_sales"]
  Gorra logo lateral | tax_rate 0.00 | sellable false | taxes ["tax_24_sales"]
  ```
- Muestra de `tenant_taxes`:
  ```
  holded_tax_id                      | rate | name
                                     |      | REC 0%
  69b7f6b4170c9d1c8c042921           |      | Impuesto 49
  69b7f6b5170c9d1c8c04293a           |      | Impuesto 28
  69b7f6b5170c9d1c8c042941           |      | Impuesto 24
  ```

**Dos bugs distintos visibles:**

1. **`tenant_taxes.rate` no se está poblando**. El sync inicial de
   taxes lee la respuesta de Holded `/invoicing/v1/taxes`, persiste
   `holded_tax_id` y `name`, pero NO extrae el porcentaje numérico.
   Investigar qué campo de la respuesta de Holded contiene el rate
   (`value`, `percentage`, `rate`, otro).
2. **Mismatch de identificadores entre `Product.taxes[]` y
   `tenant_taxes.holded_tax_id`**. Los productos referencian
   `tax_49_sales`, `tax_28_sales`, `tax_24_sales` (formato corto
   tipo slug). Los `tenant_taxes` tienen `holded_tax_id` como UUIDs
   largos `69b7f6b4170c9d1c8c042921`. **Son identificadores
   distintos para el mismo tax**. El `buildTaxRateResolver` actual
   busca por igualdad estricta → no encuentra → cae a regex
   `parseTaxRateFromId` (que tampoco matchea `tax_49_sales` con
   `^s_iva_(\d+)$`) → devuelve `null` → forzamos
   `sellableViaTpv=false`.

## Hipótesis del root cause

La cuenta sandbox actual tiene una configuración fiscal **atípica
con taxes custom** (nombres "Impuesto 49", "Impuesto 28" etc.),
distinto a la cuenta sandbox que usamos en el spike original
(§03.A donde sí salía `s_iva_21`). Es posible que:

- El campo `value` o equivalente del JSON de tax exista pero
  nuestra deserialización lo está perdiendo.
- Holded use dos formatos de ID: uno legacy/customId
  (`tax_49_sales`) que es el que ponen los productos, y uno
  interno UUID (`69b7f6b4...`) que devuelve `/invoicing/v1/taxes`.
- O un mapping requiere pedir el detalle individual de cada tax
  via `GET /invoicing/v1/taxes/:id` para encontrar el alias.

**Sea como sea, hay que investigarlo empíricamente con un mini-spike**.

## Alcance B7.5

Tres frentes acotados:

### Frente 1 · Mini-spike §11 de taxes

Crear `spike/holded/src/11-taxes-detail.ts`:

- Llama `GET /invoicing/v1/taxes` y guarda la respuesta cruda en
  `spike/holded/fixtures/11-taxes-list.json`.
- Para cada tax, llama `GET /invoicing/v1/taxes/:id` (probar si
  existe el endpoint detalle) y guarda en
  `spike/holded/fixtures/11-taxes-<id>.json`.
- Si existe variante de listado con más detalle (e.g.
  `?include=details` o similar), prueba también.
- Llama `GET /invoicing/v1/products?page=1` y captura la
  estructura completa del campo `taxes[]` de varios productos.
- Documenta findings en `docs/spike-holded.md` §11:
  - Estructura completa del JSON de `/invoicing/v1/taxes`.
  - Qué campo contiene el porcentaje numérico.
  - Qué campos hay disponibles que podrían matchear con
    `Product.taxes[]` (probablemente `customId` o un alias).
  - Recomendación de mapping para `buildTaxRateResolver`.

Script `spike:11` añadido a `spike/holded/package.json`.

### Frente 2 · Fix sync de taxes

Una vez el spike confirme los campos correctos:

`packages/holded-client/src/taxes.ts`:

- Ampliar `HoldedTax` interface con los campos que el spike
  identifique (probable: `value` numérico para rate, `customId`
  para alias).
- `listTaxes` devuelve esos campos.

`apps/api/src/onboarding/initial-sync.ts`:

- Persistir `tenant_taxes.rate` desde el campo numérico
  identificado.
- Si la cuenta tiene IDs alias distintos del `id` principal,
  persistirlos en una columna nueva `tenant_taxes.holded_alias_id`
  (Migración mínima `b7_5_tenant_tax_alias`) o como parte del
  campo `raw` jsonb.

`apps/api/src/catalog/incremental-sync.ts`:

- Misma lógica para refresh.

`buildTaxRateResolver(taxes)`:

- Devolver función que busca por `holded_tax_id` primero, luego
  por `customId/alias` si existe.
- Si nada matchea, fallback `parseTaxRateFromId` regex.
- Si nada, devolver `null` (gate `sellableViaTpv=false` sigue
  funcionando).

### Frente 3 · Re-sync + validación

Tras aplicar el fix:

- Re-correr sync incremental sobre la cuenta sandbox actual.
- Validar que los productos pasan a tener `tax_rate > 0` y
  `sellable_via_tpv = true`.
- Si no pasan (porque la cuenta sandbox sigue siendo demasiado
  atípica), documentar el caso edge en `docs/blocks/B7.5-done.md`
  y dejar claro que el fix está bien diseñado pero esta cuenta
  específica tiene un formato que no permite resolver. La
  validación real llegará con una cuenta de cliente piloto con
  IVA estándar.

## Tests

- `taxes.test.ts` ampliado: mapping con nuevo formato JSON crudo
  (mock con los campos descubiertos por el spike), resolución por
  `holded_tax_id` y por alias.
- `incremental-sync.test.ts` y `initial-sync` ya tienen tests del
  resolver — actualizar fixtures con el formato real.

## Restricciones

- Bloque acotado. NO añadir features nuevas.
- NO tocar B7 ni los frentes ya cerrados.
- Si en el spike descubres que la sandbox actual es realmente
  irresolvible, documentarlo y cerrar el bloque con esa
  conclusión. No fuerces fix que no funcione.
- Si Holded no expone endpoint detalle individual de tax, queda
  como hallazgo en §11 y se cierra el bloque con el fix que sí se
  pueda hacer.

## Entregables

1. PR único con todo B7.5.
2. Commit message descriptivo.
3. `docs/spike-holded.md` §11 con findings completos.
4. `docs/blocks/B7.5-done.md` con resumen breve (mini-bloque, no
   hace falta el formato completo de B1-B7 pero sí estructura,
   decisiones, dudas).
5. Migración opcional si hace falta `holded_alias_id`.

## Lo que NO entra en B7.5

- Impresión real ESC/POS y agente local — bloque dedicado posterior.
- Cualquier feature nueva — sólo fix.
- Restaurante F2 — bloques posteriores.

Cuando termines B7.5 y Matías lo revise, abrimos el bloque
dedicado de impresión real (último gran bloque funcional antes del
piloto productivo).
