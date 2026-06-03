# Bloque v1.4-Checkout-Redesign · 1 lote grande

Rediseño responsivo completo del modal de cobro (CheckoutPage / CheckoutOverlay). Crea rama `v1-4-checkout-redesign` desde master, un commit, sin merge.

## Contexto

Feedback Matías 2026-06-02 con captura del modal actual en Mac (~2000px ancho):

- El modal actual asume viewport gigante y desperdicia mucho espacio.
- En tablet apaisado / vertical / phone NO se reorganiza.
- Hay duplicidades visuales (botón Efectivo arriba + tab Efectivo abajo).
- El "0,00 €" gigante del panel derecho del ticket confunde cuando ya estás cobrando.
- El botón "Cobrar" queda oculto bajo el scroll si el teclado virtual sube.
- El listado de líneas del ticket no es visible desde el modal.

Decisión Matías 2026-06-03 sobre la estructura nueva:
- **Cabecera fija**: subtotal + IVA arriba (NO scrollable).
- **Listado de líneas**: zona scrollable independiente (con scroll vertical si hay muchas).
- **Footer fijo**: total grande + métodos de pago + botón Cobrar (NO scrollable; sticky bottom respetando teclado).

## Cambios técnicos

### Estructura del CheckoutPage / CheckoutOverlay

```
┌──────────────────────────────────────────────┐
│  ← Volver        Total a cobrar              │  ← header sticky top
│  ┌──────────────────────────┐                │
│  │ Subtotal       42,15 €   │                │  ← bloque resumen (fixed)
│  │ IVA             8,85 €   │                │
│  └──────────────────────────┘                │
├──────────────────────────────────────────────┤
│  Artículos                                   │  ← zona scrollable
│  · BIOPLASTIA HIDRT   x1   51,00 €           │
│  · CORTAR             x1   12,00 €           │
│  · TINTE              x2   84,00 €           │
│  ...                                          │
│  (scroll si rebasa)                          │
├──────────────────────────────────────────────┤
│  Recibido                                    │  ← footer fixed bottom
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐         │
│  │  5 │ │ 10 │ │ 20 │ │ 50 │ │100 │         │  ← atajos pill (1 fila)
│  └────┘ └────┘ └────┘ └────┘ └────┘         │
│  ┌──────────────────────────┐                │
│  │ Efectivo  Tarjeta  Bizum │                │  ← métodos como tabs
│  └──────────────────────────┘                │
│                                              │
│  TOTAL                       147,00 €        │  ← total grande
│  ┌──────────────────────────────────┐        │
│  │           COBRAR                 │        │  ← botón sticky bottom
│  └──────────────────────────────────┘        │
└──────────────────────────────────────────────┘
```

### Reglas de diseño

(1) **Cabecera (subtotal + IVA)**: bloque fijo `flex-shrink-0` arriba. Tipografía media.

(2) **Listado de artículos**: `flex-1 min-h-0 overflow-y-auto`. Cada línea con nombre + cantidad + total. NO permitimos editar cantidad ni borrar desde el cobro (esas acciones se hacen en SalePage antes de cobrar). El listado es informativo, solo lectura.

(3) **Footer**: bloque fijo `flex-shrink-0` abajo con `padding-bottom: var(--keyboard-offset, 0px)` para que respete el teclado virtual (el helper `visualViewportSync` del Lote 2 v1.3-UX-Iteración ya inyecta esa variable).

(4) **Atajos efectivo**: pills compactas en 1 sola fila horizontal. Valores típicos: 5, 10, 20, 50, 100 + botón "C" (limpiar). Cada pill ~50px alto. `SET` (no SUM, ya arreglado en hotfix Fix 4).

(5) **Métodos de pago**: tabs/pills horizontales (Efectivo, Tarjeta, Bizum, Vale, +Mixto). NO cards grandes verticales. Tab activo en coral.

(6) **Eliminar redundancias**:
- El botón grande "Efectivo · 51,00" arriba del modal ACTUAL → eliminar. Sobra con el tab + el campo del importe.
- El panel derecho con "0,00 €" gigante → eliminar. El total ya está dentro del modal.

(7) **Responsive**:
- **Phone vertical 360×800**: 1 columna, modal a pantalla completa, footer sticky bottom.
- **Tablet vertical 768×1024**: igual que phone, modal centrado max-width 600px.
- **Tablet apaisado 1024×768**: igual, max-width 700px.
- **Desktop 1440×900**: max-width 700px, modal centrado.

(8) **Max height**: 90vh. Si el contenido (sobre todo listado de artículos) no cabe, scroll interno del listado, header y footer siempre visibles.

### Archivos a tocar

- `apps/tpv-web/src/pages/CheckoutPage.tsx` — vista principal del cobro.
- `apps/tpv-web/src/pages/CheckoutOverlay.tsx` — versión overlay (si existe separada).
- `apps/tpv-web/src/components/CashQuickKeys.tsx` (o similar) — atajos efectivo. Ya está en pills, verificar 1 fila.

### Mantener funcionalidades existentes

- Cobro mixto (partir entre métodos).
- Importe exacto (botón coral grande).
- Atendido por (input opcional).
- Imprimir ticket / Enviar email / Ticket regalo.
- Notas del ticket.
- **NO romper** integración con SplitBillSheet (Modo A, partir importe — del Lote 4 v1.4-Bar-Operativa-MVP).
- Mantener compatibilidad con `--keyboard-offset` del Lote 2 v1.3-UX-Iteración.

### Tests / QA

Como no hay infra vitest en `apps/tpv-web`, los tests son visuales:

- Validar en Chrome del Mac con DevTools en modos 360×800, 768×1024, 1024×768 y 1440×900.
- Probar con 1 línea, con 15 líneas (que el scroll del listado funcione), con teclado virtual abierto (que el footer no se oculte).

## Convenciones

- Un único commit, mensaje `v1.4-Checkout-Redesign · modal responsive con cabecera fija + listado scroll + footer sticky`.
- NO mergear. Espero `git merge --ff-only`.
- Si encuentras que el rediseño requiere más de un commit (ej. separar CheckoutPage del CheckoutOverlay), parte el commit pero deja la rama coherente.

## Out of scope

- Cambios en SalePage (eso es task #11 ya arreglada).
- Cambios en SuccessOverlay (tras cobro).
- Cambios en el flujo de impresión (eso es bloque #8 separado).
