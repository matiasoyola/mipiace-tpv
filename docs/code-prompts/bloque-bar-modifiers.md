# Prompt para Claude Code — B-Bar-Modifiers · modificadores de producto

Bloque dedicado (~2 días). Añade soporte para modificadores de
producto en el TPV — variantes como "café con/sin leche",
"hamburguesa sin cebolla", "tamaño grande +2€", etc. Bloqueante
para los 2 bares piloto: sin esto, el bar tiene que crear 5
productos distintos en Holded para 5 variantes del mismo café.

Pega esto en una sesión de Claude Code después de pushear los
prompts. Si Matías lanza en paralelo a otra sesión vía git worktree,
trabaja en branch propia.

---

Hola Code. B-Bar-Modifiers añade modificadores de producto al TPV
mipiacetpv. Es la pieza más crítica que falta para que los 2 bares
piloto puedan operar — sin modificadores, cada variante de un
producto se convierte en un SKU duplicado en Holded, lo cual es
inmanejable.

## Contexto

Lee primero:

- `packages/db/prisma/schema.prisma` — modelos Product, TicketLine.
- `apps/api/src/onboarding/initial-sync.ts` y
  `apps/api/src/catalog/incremental-sync.ts` — cómo se persisten
  productos desde Holded.
- `packages/holded-client/src/products.ts` — tipo HoldedProduct.
- `apps/tpv-web/src/pages/SalePage.tsx` y archivos hermanos —
  grid de productos y flujo de añadir línea.
- `apps/api/src/tickets/upload-ticket.ts` — worker que sube ticket
  a Holded.
- `apps/api/src/tickets/routes.ts` — POST /tickets crea ticket
  con líneas.
- `docs/spike-holded.md` — spikes previos de la API Holded.

## Mini-spike §14 (primer paso, obligatorio)

Investigar si Holded API expone modificadores nativamente. Si sí,
nos ahorramos crear toda la UI de admin para gestionarlos.

Crear `spike/holded/src/14-product-modifiers.ts`:

1. `GET /invoicing/v1/products?page=1` — muestra de 10 productos.
2. Inspeccionar campos candidatos:
   - `attributes[]`, `variants[]`, `options[]`, `modifiers[]`
   - `productAttributes`, `relatedProducts`
   - Cualquier campo que pinte como "variantes"
3. Probar `GET /invoicing/v1/products/:id` para un producto sandbox
   conocido por tener variantes (si hay alguno).
4. Documentar findings en `docs/spike-holded.md` §14:
   - ¿Holded expone modificadores? Sí/No.
   - Si sí: estructura JSON, qué campos tiene (label, priceDelta,
     groupId, etc.), endpoint para listarlos.
   - Si no: alternativas (productos relacionados, custom fields del
     producto, etc.).

**Según el resultado del spike, el alcance cambia:**

- **Si Holded tiene modificadores nativos**: Frente 2 = sync + uso
  directo. Sin admin CRUD propio.
- **Si Holded NO los tiene**: Frente 2 = CRUD admin propio + Frente 5
  más complejo (cómo mapear nuestros modifiers a la description del
  ticket en Holded).

Si no estás seguro tras 2 horas, asumir caso "Holded no los tiene"
(más conservador, no rompe nada).

## Alcance · 7 frentes

### Frente 1 · Schema + migración

```prisma
model ModifierGroup {
  id          String   @id @default(uuid()) @db.Uuid
  tenantId    String   @map("tenant_id") @db.Uuid
  tenant      Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  // Nombre del grupo visible al cajero ("Tipo de leche", "Tamaño").
  name        String
  // Si true, sólo se puede seleccionar 1 modifier del grupo (radio).
  // Si false, se pueden seleccionar varios (checkbox). Default true.
  exclusive   Boolean  @default(true)
  // Si true, es obligatorio seleccionar al menos un modifier antes
  // de añadir la línea. Útil para "Tamaño" donde no hay default.
  required    Boolean  @default(false)
  // Orden de presentación en el modal del TPV (asc).
  sortOrder   Int      @default(0) @map("sort_order")
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz()
  // Soft-delete para preservar histórico de ticketLines.
  deletedAt   DateTime? @map("deleted_at") @db.Timestamptz()

  modifiers   Modifier[]
  products    ProductModifierGroup[]

  @@index([tenantId, deletedAt])
  @@map("modifier_groups")
}

model Modifier {
  id              String        @id @default(uuid()) @db.Uuid
  modifierGroupId String        @map("modifier_group_id") @db.Uuid
  modifierGroup   ModifierGroup @relation(fields: [modifierGroupId], references: [id], onDelete: Cascade)
  // Etiqueta visible ("Sin leche", "Con leche desnatada", "Grande").
  label           String
  // Suplemento o descuento al precio del producto. Puede ser
  // negativo (descuento) o cero (sin coste). En céntimos para
  // evitar floats, igual que el resto del modelo.
  priceDeltaCents Int           @default(0) @map("price_delta_cents")
  sortOrder       Int           @default(0) @map("sort_order")
  // Si true, este modifier está pre-seleccionado al abrir el grupo.
  // Sólo tiene efecto en grupos exclusive=true.
  isDefault       Boolean       @default(false) @map("is_default")
  createdAt       DateTime      @default(now()) @map("created_at") @db.Timestamptz()
  deletedAt       DateTime?     @map("deleted_at") @db.Timestamptz()

  @@index([modifierGroupId, deletedAt])
  @@map("modifiers")
}

// Tabla puente N:N entre productos y grupos de modificadores.
// Un grupo puede aplicar a varios productos ("Tipo de leche" sirve
// para café, té, chocolate, etc.) y un producto puede tener
// varios grupos ("Café" tiene "Tipo de leche" + "Tamaño" + "Azúcar").
model ProductModifierGroup {
  productId       String        @map("product_id") @db.Uuid
  product         Product       @relation(fields: [productId], references: [id], onDelete: Cascade)
  modifierGroupId String        @map("modifier_group_id") @db.Uuid
  modifierGroup   ModifierGroup @relation(fields: [modifierGroupId], references: [id], onDelete: Cascade)
  sortOrder       Int           @default(0) @map("sort_order")

  @@id([productId, modifierGroupId])
  @@map("product_modifier_groups")
}

model TicketLine {
  // ...campos existentes...
  // Snapshot de modificadores aplicados al cobrar. Estructura:
  //   [
  //     { groupId, groupName, modifierId, label, priceDeltaCents },
  //     ...
  //   ]
  // Snapshot inmutable para que cambios futuros en el catálogo no
  // alteren la auditoría fiscal del ticket.
  modifiers       Json?
}
```

Migración `b12_modifiers`. Backfill: `TicketLine.modifiers = null`
para tickets pre-existentes (el código que renderiza líneas debe
tratar null como "sin modificadores", no fallar).

### Frente 2 · Sync o CRUD admin de modificadores

**Si el spike §14 confirma que Holded los tiene** (caso A):

- `packages/holded-client/src/products.ts`: ampliar `HoldedProduct`
  con el campo identificado.
- `apps/api/src/onboarding/initial-sync.ts` y
  `incremental-sync.ts`: persistir ModifierGroup + Modifier +
  ProductModifierGroup desde la respuesta Holded.
- Sin admin CRUD propio. Source of truth = Holded.

**Si no los tiene** (caso B, asumido como conservador):

- Endpoint admin per-tenant:
  - `GET/POST/PATCH/DELETE /admin/modifier-groups` (CRUD básico).
  - `GET/POST/PATCH/DELETE /admin/modifier-groups/:id/modifiers`.
  - `POST/DELETE /admin/products/:productId/modifier-groups/:groupId`
    (asociar/desasociar).
- Permisos: `requireOwnerOrManager`. OWNER puede crear/editar,
  MANAGER también (gestión operativa de menú).

### Frente 3 · POST /tickets acepta modifiers en líneas

`apps/api/src/tickets/routes.ts` POST `/tickets`:

- Body de cada línea acepta opcional `modifiers: ModifierSelection[]`:
  ```ts
  { groupId: string, modifierId: string }[]
  ```
- Backend valida:
  - Cada `groupId` existe y pertenece al tenant.
  - Cada `modifierId` pertenece al groupId.
  - Si el grupo tiene `exclusive=true`, sólo 1 modifier de ese
    grupo seleccionado.
  - Si el grupo tiene `required=true` y aplica al producto, debe
    haber al menos 1 modifier seleccionado.
- Calcula el subtotal de la línea: `(unitPrice + sum(modifier.priceDeltaCents)/100) * units * (1 - discountPct/100)`.
- Persiste snapshot en `TicketLine.modifiers` jsonb con los datos
  desnormalizados (groupName, label, priceDeltaCents) para
  auditoría inmutable.

### Frente 4 · UI selector de modificadores al añadir línea

`apps/tpv-web/src/pages/SalePage.tsx` y archivos hermanos:

- Al pulsar un tile de producto en el grid:
  - Si el producto **NO tiene** `modifierGroups` asociados: comportamiento
    actual (añade línea directamente).
  - Si **SÍ tiene**: abre modal `<ModifierSelector>` con:
    - Cabecera: nombre del producto + precio base.
    - Por cada grupo (ordenados por sortOrder):
      - Si `exclusive`: radios. Si `isDefault` está marcado, ese
        radio aparece pre-seleccionado.
      - Si no: checkboxes.
      - Cada modifier muestra su `label` + `priceDeltaCents`
        formateado (ej. "+ 0,50 €", "- 0,20 €", o nada si es 0).
    - Footer: subtotal calculado en vivo (price + sum deltas), botón
      "Añadir al ticket" (deshabilitado si algún grupo `required`
      no tiene selección).
- Al confirmar: la línea se añade al carrito con los modifiers
  seleccionados.
- En la lista del carrito, cada línea con modifiers muestra el
  desglose visualmente:
  ```
  Café con leche                          1.80 €
    └ Tipo de leche · Desnatada
    └ Azúcar · Sin azúcar
    └ Tamaño · Grande              + 0.50 €
  ```

Mockup de referencia en `docs/design/mockups/tpv-venta-v4.html` si
existe ya algún diseño de variantes; si no, replicar el patrón
visual del resto del TPV (Tailwind + tokens canónicos).

### Frente 5 · upload-ticket envía modificadores a Holded

`apps/api/src/tickets/upload-ticket.ts`:

- Al construir la línea para Holded, si la línea tiene `modifiers`:
  - **Estrategia A** (si Holded tiene modificadores nativos según
    spike §14): mapear al formato Holded.
  - **Estrategia B** (asumida): concatenar los labels en
    `description` o en `notes` de la línea Holded. Formato:
    ```
    Café con leche
    (Tipo de leche: Desnatada; Azúcar: Sin azúcar; Tamaño: Grande)
    ```
- El `subtotal` y `total` que se envía a Holded YA incluye los
  priceDeltas (eso lo hace el frente 3 al calcular). Holded solo
  ve un precio "rolled up" y la nota descriptiva.

### Frente 6 · TableMapScreen muestra desglose

`apps/tpv-web/src/pages/TableMapScreen.tsx` y operativa de mesa:

- Cuando se muestra el detalle de una mesa abierta con líneas, cada
  línea con modifiers muestra el breadcrumb (mismo formato que
  Frente 4).
- El total de la mesa ya viene calculado por el backend (Frente 3).

### Frente 7 · Tests + doc

- `modifier-groups.test.ts`: CRUD admin (caso B), permisos.
- `tickets-modifiers.test.ts`: POST /tickets con modifiers valida
  exclusividad, required, calcula subtotal correctamente, persiste
  snapshot en `TicketLine.modifiers`.
- `upload-ticket.modifiers.test.ts`: la description de la línea
  Holded incluye los labels.
- `SalePage.modifiers.test.tsx`: modal abre con grupos, valida
  required, calcula subtotal en vivo.
- `docs/blocks/B-Bar-Modifiers-done.md` con resumen estructurado.

## Restricciones

- **NO** tocar la PWA del admin más allá del CRUD de modificadores
  (Frente 2 caso B). Mantener UI subset OWNER reducido (B-OnboardingV2
  ya lo refactorizó — respetar lo hecho).
- **NO** romper tickets pre-existentes (TicketLine.modifiers = null
  legacy = tratar como "sin modificadores").
- **NO** modificar el flujo del cajero técnico (test-cashier de
  B-OnboardingV2) — los modifiers funcionan igual en modo test.
- **NO** tocar archivos del worktree paralelo (B-ProductImages):
  evitar conflictos al mergear. En particular cuidar `initial-sync.ts`
  e `incremental-sync.ts` — si los tocas, hazlo en secciones distintas
  a las que toca B-ProductImages (que persiste `imageUrl` en cada
  upsert de producto).

## Entregables

1. PR único con los 7 frentes + spike §14.
2. Commit message descriptivo.
3. `docs/blocks/B-Bar-Modifiers-done.md`.
4. Migración `b12_modifiers`.
5. Tests verdes.

## Lo que NO entra

- División de cuenta (split bill) → bloque dedicado posterior
  B-Bar-Split.
- Comensales por mesa → bloque B-Bar-Comensales.
- Comanda de cocina → B-Print fase 2 (térmica, on-demand).
- Modificadores con stock propio (variantes con SKU separado en
  inventario) → fuera de scope, Holded no lo soporta así.
- Modificadores con imagen → mismo trato que Producto (B-ProductImages).
- Auto-aplicación de modifiers por contexto (ej. "happy hour mete
  automáticamente el modifier descuento") → v2.

Cuando este bloque cierre, los 2 bares piloto pueden operar
mostrando variantes correctamente. Sin esto, su catálogo se vuelve
inmanejable.
