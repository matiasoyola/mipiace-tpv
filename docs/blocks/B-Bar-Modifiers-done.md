# B-Bar-Modifiers · modificadores de producto para vertical bar

Estado: cerrado pendiente de revisión por Matías.

Añade soporte para modificadores de producto al TPV mipiacetpv. Los 2
bares piloto pueden ahora operar mostrando variantes ("Café con leche
desnatada y grande") sin crear 5 SKUs distintos en Holded por cada
producto. Pieza más crítica que faltaba para el vertical bar.

Fuera de B-Bar-Modifiers (explícito):
- División de cuenta (split bill) → B-Bar-Split posterior.
- Comensales por mesa → B-Bar-Comensales.
- Comanda de cocina → B-Print fase 2.
- Modificadores con stock propio (SKU separado en Holded).
- Modificadores con imagen.
- Auto-aplicación de modifiers por contexto (happy hour, etc.).

## Estructura tras B-Bar-Modifiers

```
.
├─ spike/holded/src/
│  └─ 14-product-modifiers.ts                    # + sondeo §14 (no nativos)
├─ packages/db/prisma/
│  ├─ schema.prisma                              # + ModifierGroup, Modifier, ProductModifierGroup
│  └─ migrations/
│     └─ 20260518100000_b12_modifiers/           # + 3 tablas + FKs + indexes
├─ packages/holded-client/src/
│  └─ salesreceipt.ts                            # ~ SalesreceiptItem.desc opcional
├─ apps/api/src/
│  ├─ admin/
│  │  └─ modifier-groups.ts                      # + CRUD admin per-tenant
│  ├─ tables/
│  │  └─ operativa.ts                            # ~ POST /tables/:id/lines acepta modifiers
│  ├─ tickets/
│  │  ├─ modifier-selection.ts                   # + validador + helper Holded
│  │  ├─ routes.ts                               # ~ POST /tickets + checkout aceptan modifiers
│  │  └─ upload-ticket.ts                        # ~ desc rolled-up + payload modifier
│  ├─ tpv-catalog/
│  │  └─ routes.ts                               # + GET /tpv/catalog/modifier-groups
│  └─ server.ts                                  # ~ registra admin/modifier-groups
├─ apps/tpv-web/src/
│  ├─ lib/
│  │  ├─ cart.ts                                 # ~ ModifierSelection en CartLine + computeLine
│  │  └─ modifiers.ts                            # + cliente catálogo modifiers
│  └─ pages/
│     ├─ SalePage.tsx                            # ~ modal selector + breadcrumb
│     ├─ SalePage.modifierSelector.tsx           # + componente <ModifierSelector>
│     ├─ SalePage.lineSheet.tsx                  # ~ muestra modifiers estructurados
│     ├─ CheckoutPage.tsx                        # ~ envía modifierSelections
│     └─ TicketsHistoryPage.tsx                  # ~ breadcrumb estructurado o legacy
├─ docs/
│  ├─ spike-holded.md                            # + §14
│  └─ blocks/B-Bar-Modifiers-done.md             # + (este archivo)
└─ apps/api/test/
   ├─ modifier-groups.test.ts                    # + 10 tests CRUD + permisos
   ├─ modifier-selection.test.ts                 # + 11 tests validación
   └─ upload-ticket-modifiers.test.ts            # + 5 tests payload Holded
```

## Spike §14 · ¿Holded expone modificadores nativos?

**No.** Caso B (CRUD admin propio) confirmado. Tres evidencias:

1. **Shape del producto** (fixtures Fase 0, §02.C de spike-holded.md):
   ningún campo `modifiers`, `options`, `productOptions`, `extras` o
   `addons`. Sólo `attributes[]` (KV libre, sin precio) y `variants[]`
   (SKUs separados, fuera de scope §"NO entra").
2. **Doc oficial** (`developers.holded.com/reference`): no expone
   endpoint dedicado bajo ningún namespace.
3. **UI de Holded**: no tiene pantalla para "Tamaño: Grande +0.50 €".

El script `14-product-modifiers.ts` está en `spike/holded/src/` para
correrlo contra la cuenta de cualquier cliente futuro y confirmar el
hallazgo (3 pasos: muestra de productos, detalle individual, sondeo de
paths candidatos). Crea 0 documentos, sólo lectura. Si encontrara
modifiers nativos el bloque ya tiene contemplado el caso A (sync
desde Holded en lugar de CRUD propio).

## Frentes

### Frente 1 · Schema + migración `b12_modifiers`

Tres tablas nuevas — vivienda completa del concepto en mipiacetpv:

- `modifier_groups`: `id`, `tenant_id`, `name`, `exclusive`, `required`,
  `sort_order`, `created_at`, `deleted_at`. Soft-delete para preservar
  el snapshot inmutable de `TicketLine.modifiers` (un tenant que quita
  "Tipo de leche" del menú no rompe tickets históricos).
- `modifiers`: `id`, `modifier_group_id`, `label`, `price_delta_cents`,
  `sort_order`, `is_default`, `created_at`, `deleted_at`. Soft-delete
  por la misma razón. `priceDeltaCents` en céntimos para no introducir
  floats en el modelo.
- `product_modifier_groups` (N:N): PK compuesta `(product_id,
  modifier_group_id)`, `sort_order`. ON DELETE CASCADE en ambos lados.

`ticket_lines.modifiers` ya existía como `JSONB?` desde B7 (legacy:
array de strings ad-hoc tipeados por el cajero). Se reutiliza el
campo con dos shapes que el renderer del TPV discrimina por tipo del
primer elemento:

- `string[]` legacy → ad-hoc ("Sin azúcar"). Sin precio asociado.
- `object[]` estructurado → `{ groupId, groupName, modifierId, label,
  priceDeltaCents }`. Auditoría inmutable: cambios en el catálogo no
  alteran el ticket histórico.

Migración hand-written SQL en `20260518100000_b12_modifiers/migration.sql`.
No toca `ticket_lines` — el campo ya existía nullable.

### Frente 2 · CRUD admin (`/admin/modifier-groups`)

Caso B confirmado por spike §14. Endpoints `requireOwnerOrManager` —
OWNER y MANAGER pueden ambos gestionar el menú (operativa diaria, no
infraestructura):

```
GET    /admin/modifier-groups                          # listar
POST   /admin/modifier-groups                          # crear grupo
PATCH  /admin/modifier-groups/:groupId                 # editar grupo
DELETE /admin/modifier-groups/:groupId                 # soft-delete grupo

POST   /admin/modifier-groups/:groupId/modifiers       # añadir modifier
PATCH  /admin/modifier-groups/:groupId/modifiers/:id   # editar modifier
DELETE /admin/modifier-groups/:groupId/modifiers/:id   # soft-delete modifier

POST   /admin/products/:productId/modifier-groups/:groupId  # asociar (upsert)
DELETE /admin/products/:productId/modifier-groups/:groupId  # desasociar
```

Cross-tenant fencing: cada handler verifica que `tenantId` del token
coincide con el del recurso (group o product) antes de tocar nada.
Cualquier id "ajeno" → 404 limpio, sin filtrar existencia. La asociación
de producto es upsert para que la PWA pueda reenviar sin temer al doble
click.

### Frente 3 · POST /tickets acepta modifiers

`apps/api/src/tickets/routes.ts`:

- Body de cada línea acepta opcional
  `modifierSelections: { groupId: string, modifierId: string }[]` en
  paralelo al campo legacy `modifiers: string[]` (compatible hacia atrás).
- Antes del cálculo de totales se invoca
  `resolveModifierSelectionsForLines` (helper compartido con
  `tables/operativa.ts`), que en una sola query a BD:
  1. Resuelve todos los groupIds → tenant fence + soft-delete check.
  2. Resuelve cada modifierId dentro de su grupo (filtrado soft-delete).
  3. Valida exclusivity: grupo `exclusive=true` ⇒ sólo 1 selección.
  4. Valida required: para líneas con `productId`, los grupos asociados
     al producto con `required=true` deben tener al menos 1 selección.
- El `unitPrice` efectivo para `computeTicket` es `unitPrice +
  sumDeltas/100` (por unidad, en céntimos para evitar floats).
- Snapshot persistido en `TicketLine.modifiers`:
  - Si `modifierSelections` aporta selecciones: array desnormalizado
    `{ groupId, groupName, modifierId, label, priceDeltaCents }`.
  - Else si `modifiers` legacy aporta strings: array de strings.
  - Else: `Prisma.JsonNull`.
- Códigos de error nuevos (todos 400): `MODIFIER_GROUP_NOT_FOUND`,
  `MODIFIER_NOT_FOUND`, `MODIFIER_EXCLUSIVE_VIOLATION`,
  `MODIFIER_REQUIRED_VIOLATION`. Cada uno incluye `line` (nameSnapshot
  de la línea afectada) y `groupId` para que el TPV pueda marcar el
  campo problemático.

El endpoint `POST /tickets/:id/checkout` (mesa) recalcula los totales
leyendo `TicketLine.modifiers` y aplicando los `priceDeltaCents` —
el unitPrice persistido es siempre el BASE, los deltas viven sólo en
el snapshot.

`POST /tables/:id/lines` (añadir línea a mesa abierta) tiene tratamiento
simétrico: valida modifierSelections, suma delta a unitPrice efectivo,
persiste snapshot. `recomputeTicketTotalsWithModifiers` se asegura de
que cualquier mutación posterior (PATCH unidades, DELETE línea) recalcula
totales considerando los deltas.

### Frente 4 · UI selector de modificadores

`apps/tpv-web/src/pages/SalePage.modifierSelector.tsx`:

- Modal mobile-first (`fixed inset-0`, sheet en mobile, dialog en md+).
- Cabecera: nombre del producto + precio base con IVA.
- Cuerpo: una sección por grupo (ordenadas por `sortOrder`).
  - Grupo `exclusive=true` → radios; el `isDefault` se pre-selecciona.
  - Grupo `exclusive=false` → checkboxes.
  - Cada modifier muestra label + delta formateado (`+ 0,50 €`,
    `− 0,20 €`, o nada si delta=0).
- Footer: subtotal en vivo (precio + sum deltas × IVA), botón "Añadir
  al ticket" disabled si algún grupo `required` queda sin selección
  (tooltip con el nombre del grupo problemático).

Wiring en `SalePage.tsx`:

- Al primer mount: `loadModifierGroups()` en paralelo con catalogo y
  wildcards. Si falla la descarga, el TPV sigue funcionando — los
  productos con modifiers se añadirán directamente (degradación
  graceful) y el cajero verá las líneas sin modifiers en el carrito.
- Index `groupsByProduct: Map<productId, CatalogModifierGroup[]>` en
  memoria.
- `addProduct(p)` → si `groupsByProduct.has(p.id)` abre el modal;
  si no, llama directamente a `pushProductLine` (comportamiento legacy).
- Confirmar el modal → `pushProductLine(p, { modifierSelections })`.
- Línea en el carrito muestra el desglose vía `<ModifierBreakdown>`:
  ```
  Café con leche                          1.80 €
    └ Tipo de leche · Desnatada
    └ Azúcar · Sin azúcar
    └ Tamaño · Grande              + 0.50 €
  ```

`CheckoutPage` envía `modifierSelections: { groupId, modifierId }[]`
(no envía labels/precios — el backend los re-resuelve y re-snapshotea
del catálogo para que la auditoría sea fiable).

`SalePage.lineSheet.tsx` muestra los modifiers estructurados en
read-only encima del input de strings ad-hoc. Para cambiar la
selección estructurada el cajero quita la línea y la vuelve a añadir
(simpler que un editor inline — el modal del primer add es donde la
decisión vive).

### Frente 5 · upload-ticket envía modifiers a Holded

`apps/api/src/tickets/upload-ticket.ts:buildTicketSalesreceiptPayload`:

- Para cada línea con `modifiers` no vacío:
  - Si es snapshot estructurado (`object[]`): `price` rolled-up
    (`baseUnitPrice + sum(priceDeltaCents)/100`, redondeado a 2dec) +
    `desc = "(Grupo: Label; Grupo: Label)"`.
  - Si es legacy `string[]`: `price` se mantiene (las strings ad-hoc
    no tienen precio asociado) + `desc = "(string1; string2)"`.
- Sin modifiers → `desc` ausente (comportamiento legacy intacto).

`SalesreceiptItem.desc` es campo nuevo del cliente Holded — Holded lo
persiste y lo imprime debajo del nombre del item en la factura PDF.
Confirmado en fixtures Fase 0 que Holded acepta y persiste el campo.

### Frente 6 · Mesa muestra el desglose

El detalle de mesa se renderiza dentro de `SalePage` con `tableContext`
poblado (no en `TableMapScreen`, que sólo muestra tiles agregados con
el total). La misma vista de cart que se usa en venta rápida muestra
el breadcrumb via `<ModifierBreakdown>`. No hay código adicional —
la separación de Frente 4 lo cubre.

### Frente 7 · Tests + doc

Tres archivos de test:

- `apps/api/test/modifier-groups.test.ts` (10 tests): CRUD admin
  completo, permisos OWNER/MANAGER/CASHIER, soft-delete, cross-tenant
  fencing, upsert idempotente, desasociación.
- `apps/api/test/modifier-selection.test.ts` (11 tests): validación
  pura — exclusivity, required, cross-tenant fence, soft-delete,
  multiselect, helper `formatModifierSnapshotForHolded`.
- `apps/api/test/upload-ticket-modifiers.test.ts` (5 tests): payload
  Holded — desc literal con legacy, desc desnormalizado y price
  rolled-up con structured, delta negativo correcto, sin modifiers
  no añade desc.

Total: 26 tests nuevos. Suite completa de `apps/api` corre
`238 passed | 3 skipped`.

## Restricciones respetadas

- **No tocar la PWA del admin** más allá del CRUD modifiers — Frente 2
  añade endpoints, la UI admin del CRUD se difiere (el cliente piloto
  los carga vía cURL o pequeña UI ad-hoc por ahora, lo prioritario era
  el TPV operativo).
- **No romper tickets pre-existentes** — `TicketLine.modifiers` admite
  string[] legacy y null sin cambios; los renderers (TPV, histórico,
  upload-ticket) discriminan por tipo del primer elemento.
- **No tocar el cajero técnico** — el flujo TEST sigue saltándose
  upload-ticket y email; los modifiers funcionan igual en modo prueba.
- **No tocar archivos del worktree paralelo B-ProductImages** —
  `initial-sync.ts` e `incremental-sync.ts` NO se han modificado. La
  cohabitación es limpia: Holded no expone modifiers, así que el sync
  desde Holded no necesita acompañar al CRUD propio.

## Lo que queda como carryover para B8

- **UI del admin para gestionar modifier groups** (Frente 2 deja sólo
  los endpoints REST). Pequeña pantalla CRUD para OWNER/MANAGER que
  pinta los grupos, permite editarlos y asocia productos. Los 2 bares
  piloto pueden arrancar con seed manual vía cURL mientras tanto.
- **Tests React de `<ModifierSelector>`** (spec listaba
  `SalePage.modifiers.test.tsx`). La infra de tests React en `tpv-web`
  está aún diferida (memoria del proyecto) — el día que se monte
  vitest+JSDOM en tpv-web, añadir test del modal con assertions sobre
  required, exclusive, subtotal en vivo. La lógica pura ya está
  cubierta indirectamente por `modifier-selection.test.ts` (Frente 3),
  ya que el backend re-valida y re-calcula con la misma regla.
- **PATCH /tickets/:id/lines/:lineId con modifierSelections** —
  actualmente sólo el POST inicial los toma. Si el cajero quiere
  cambiar la selección, debe quitar y volver a añadir la línea (UX
  decidida para esta versión).

## Rarezas confirmadas en este bloque

(Memorables si llega el caso A en algún cliente futuro)

- **Holded `SalesreceiptItem.desc` se persiste y se imprime** —
  observado en fixtures Fase 0. Es el vector canónico para incluir el
  desglose textual sin tocar la estructura de items.
- **`ticket_lines.modifiers` jsonb soporta múltiples shapes** — la
  ambigüedad string[]/object[] es controlada por tipo del primer
  elemento; queda documentada en el comentario del modelo y en los
  renderers. Si en un futuro se decide unificar todo en un único
  shape, basta con migrar el campo en un pase batch — el snapshot
  desnormalizado lo hace trivial.
