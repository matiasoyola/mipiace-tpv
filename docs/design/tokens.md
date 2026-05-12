# Design tokens · mipiacetpv v1

Tokens y reglas que Code debe respetar al implementar pantallas reales del
TPV y del admin. Equivalente al contrato funcional `07-nucleo-comun.md`,
pero para lo visual.

> Cualquier divergencia respecto a estos tokens es un bug. Si una pantalla
> nueva necesita un color, tamaño o componente fuera de esta lista,
> primero se añade aquí (con justificación) y luego se implementa.

## 1. Logo y marca

El logo de mipiacetpv es:

- **Iconmark**: 4 barras verticales (alusión a gráficas de ventas / TPV /
  datos) en `mipiace.ink` con un corazón en `mipiace.coral` sobre la
  primera barra (la traducción literal de "mi piace").
- **Wordmark**: `mipiace` en charcoal + `tpv` en coral. El split de
  colores distingue **marca** (mipiace, identidad) de **producto** (tpv).

SVG canónico inline (componente `Logo`):

```tsx
<svg width="28" height="28" viewBox="0 0 28 28" fill="none">
  <path d="M5.2 4.4c-.85 0-1.55.65-1.55 1.5 0 .65 1.55 1.95 1.55 1.95s1.55-1.3 1.55-1.95c0-.85-.7-1.5-1.55-1.5z" fill="#E97058"/>
  <rect x="4" y="9.5" width="2.4" height="14.5" rx="1.2" fill="#1F2937"/>
  <rect x="8.8" y="6" width="2.4" height="18" rx="1.2" fill="#1F2937"/>
  <rect x="13.6" y="11" width="2.4" height="13" rx="1.2" fill="#1F2937"/>
  <rect x="18.4" y="8" width="2.4" height="16" rx="1.2" fill="#1F2937"/>
</svg>
```

Acompañado de `<span>mipiace</span><span class="text-mipiace-coral">tpv</span>`
con `font-weight: 600`, `letter-spacing: -0.01em`.

## 2. Paleta

| Token | Hex | Uso |
|---|---|---|
| `mipiace.coral` | `#E97058` | Acento primario. CTAs principales, iconmark del corazón, "tpv" en wordmark, precio del producto en carrito, descuentos. |
| `mipiace.coral-dark` | `#C75A45` | Hover state del coral. Texto sobre `coral-soft`. |
| `mipiace.coral-soft` | `#FDEAE3` | Fondos suaves de elementos coral (estado activo de nav, badges, mesas ocupadas). |
| `mipiace.ink` | `#1F2937` | Texto principal. Iconmark de las barras. "mipiace" en wordmark. |
| `mipiace.ink-soft` | `#374151` | Texto secundario fuerte. |
| `mipiace.stone` | `#F8F6F3` | Fondo de superficies (canvas general, inputs, botones de quick action). Cálido, no gris frío. |
| `slate-200/300/400` | tailwind | Bordes, texto deshabilitado, placeholders. |
| `emerald-500` | tailwind | Estado "conectado / OK / caja abierta". |
| `amber-50/300/700` | tailwind | Estado "atención / pidiendo cuenta / 2FA recomendado". |

**Tonos para iconos de producto** (en `toneStyles`):

| Tone | Background | Text |
|---|---|---|
| `amber` | `bg-amber-50` | `text-amber-700` |
| `sky` | `bg-sky-50` | `text-sky-700` |
| `red` | `bg-red-50` | `text-red-700` |
| `green` | `bg-emerald-50` | `text-emerald-700` |
| `rose` | `bg-rose-50` | `text-rose-700` |
| `stone` | `bg-stone-100` | `text-stone-700` |

Mapping recomendado: café/cervezas → `amber`; agua/refrescos azules →
`sky`; refrescos rojos → `red`; ensaladas/vegetales → `green`; postres →
`rose`; servicios sin almacén (peluquería) → `stone`.

## 3. Tipografía

**Familia**: **DM Sans** (Google Fonts, ya cargada en `index.css`).
Geometric sans con curvas suaves. Cálida sin ser infantil, profesional
sin ser fría. Combina con la geometría del iconmark.

```css
font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
font-feature-settings: 'cv11', 'ss01';
-webkit-font-smoothing: antialiased;
```

**Escala** (sentence case siempre, nunca Title Case ni ALL CAPS):

| Uso | Size | Weight | Tracking |
|---|---|---|---|
| Display (total cobro) | 36-64px | 600 | -0.025em |
| H1 página | 22-24px | 600 | -0.01em |
| H2 sección | 17-20px | 600 | -0.01em |
| H3 / subsección | 15px | 500 | normal |
| Body | 14-14.5px | 400 | normal |
| Label de input | 13px | 500 | normal |
| Caption / meta | 12-13px | 400 | normal |
| Eyebrow (UPPERCASE pequeña) | 10.5-11px | 500 | 0.06-0.12em |
| Tabular nums | siempre con `font-variant-numeric: tabular-nums` (clase Tailwind `tabular-nums`) para precios y conteos |

**Reglas:**

- Pesos permitidos: **400** (regular), **500** (medium), **600**
  (semibold). Nada de 700+ en interfaz — sólo en logo.
- Sin Title Case. Sin ALL CAPS salvo "eyebrows" (etiquetas pequeñas como
  "CARRITO · 3 LÍNEAS" o "SUBTOTAL").
- Letter-spacing negativo (`-0.01em` a `-0.025em`) sólo en headings
  grandes (≥ 18px). Cuanto más grande, más apretado.
- Importes siempre `tabular-nums` para alineación vertical.

## 4. Espaciado y radios

**Escala de radios** (consistente con `tailwind.config.reference.js`):

| Token | Valor | Uso |
|---|---|---|
| `rounded` | 4px | Atajos kbd, badges pequeños |
| `rounded-lg` | 8px | Bordes de tabla, separadores |
| `rounded-xl` | 12px | Avatares cuadrados, badges con icono |
| `rounded-2xl` | 16px | Botones, inputs, cards de producto, pills de categoría |
| `rounded-3xl` | 24px | Cards grandes (ticket panel, login card) |

**Sin esquinas tipo pill** (`rounded-full` con altura ≥ 40px) salvo en
status dots y avatares circulares. Las píldoras grandes ablandan
demasiado.

**Touch targets mínimos:**

- Mobile: **44×44 px**.
- Tablet (TPV en hostelería): **56×56 px** para botones del carrito y
  productos top.
- Botones de acción primaria (Cobrar, Confirmar): **64-72 px** alto.

**Padding interno de cards:** 16-28px según tamaño. Cards grandes
(ticket panel) 28px horizontal, 20-24px vertical.

## 5. Componentes base (inventario)

Todos los componentes implementados en `reference-app.tsx`. Lista
canónica para reutilizar:

### Botón primario
- Background `mipiace.coral`, hover `mipiace.coral-dark`.
- Texto blanco, weight 500, size 14-15px.
- Alto 48 / 56 / 64px según contexto.
- `rounded-2xl`.

### Botón secundario / outline
- Border `mipiace.coral/30`, texto `mipiace.coral-dark`.
- Hover bg `mipiace.coral-soft`.
- Mismas alturas que primario.

### Botón fantasma (quick actions)
- Background `mipiace.stone`, hover `slate-100`.
- Texto `mipiace.ink`, weight 500.
- Sin borde.

### Input
- Alto 48 / 56px.
- Background `mipiace.stone`, border transparente.
- Focus: ring 2px `coral/40`, border `coral/30`, bg blanco.
- `rounded-2xl` para inputs grandes, `rounded-xl` para inputs en
  formularios.

### Card
- Background blanco, border `slate-200` 0.5-1px, `rounded-3xl` para
  cards principales, `rounded-2xl` para cards medianos.
- Padding 24-28px.
- Sin sombras pesadas (máximo `shadow-sm` en hover).

### Badge / chip
- `rounded-xl` (no full).
- Padding 4-6px vertical, 10-12px horizontal.
- Tamaños: 11-12px texto, weight 500.
- Variantes: `coral-soft` con texto `coral-dark`, `stone` con `ink`,
  `emerald-100` con `emerald-700` (success).

### Sidebar item
- Alto 44-48px.
- Padding horizontal 16px (xl) / centered (md).
- Activo: bg `mipiace.coral-soft`, texto `coral-dark`, icon `coral`.
- Inactivo: hover `slate-50`, texto `slate-600`.

### Producto card (TPV)
- Aspect ratio 5/4 para imagen, info debajo.
- Imagen = icon de Lucide en fondo de color soft.
- Hover: border `coral/50`, sombra suave.

### Mesa card (mapa de sala)
- Aspect 7/6, `rounded-2xl`, border 2px.
- Estados: free (white + slate-200), open (coral-soft + coral/40),
  billing (amber-50 + amber-300/60).
- Layout interno: ID arriba izquierda, capacidad arriba derecha, info
  (tiempo, comensales, camarero, total) abajo.

### Línea de carrito
- Avatar cuadrado (`rounded-xl`) con cantidad en stone.
- Nombre + meta (precio unitario o modificador) en columna.
- Total línea a la derecha, weight 500, tabular-nums.
- Botón eliminar `opacity-0 group-hover:opacity-100`.

## 6. Breakpoints

Tailwind estándar:

| Breakpoint | Min-width | Uso típico |
|---|---|---|
| `sm` | 640px | móvil grande, tablet portrait pequeña |
| `md` | 768px | tablet portrait, mostrar sidebar compacto en TPV |
| `lg` | 1024px | tablet landscape, desktop pequeño, mostrar ticket panel |
| `xl` | 1280px | desktop, sidebar TPV expandido |
| `2xl` | 1536px | desktop grande |

**Reglas por pantalla:**

- **TPV venta / mesa / mapa**: prioritario tablet landscape (≥ 1024px).
  En tablet portrait (768-1023) el ticket panel se apila debajo de los
  productos. En móvil (< 768) sidebar oculto, productos en grid 2 col,
  ticket apilado.
- **TPV emparejamiento / PIN / apertura turno / cobro**: mobile-first,
  centered, max-w-md o max-w-lg.
- **Admin**: prioritario desktop. Sidebar oculto < md, completo ≥ md.

## 7. Iconografía

**Librería**: [Lucide React](https://lucide.dev) (`lucide-react@0.383+`).
Coherente, líneas finas, geometric. Combina con DM Sans.

**Reglas de uso:**

- Stroke width `2.25` en iconos de interfaz general (botones, tabs).
- Stroke width `1.4` en iconos grandes decorativos (productos en grid).
- Tamaños: 16px (inline texto), 18px (botones), 20px (acciones
  destacadas), 48px (iconos de producto).
- Iconos de status (`Wifi`, `Bell`, dots) en colores semánticos
  (`emerald-500`, `coral`).

**No usar emojis** en interfaz. Sólo iconos vectoriales.

## 8. Animación

- Transiciones suaves de 150-200ms en hover (`transition-colors`,
  `transition-all`).
- Sin animaciones de entrada de página complejas.
- Sin parallax, sin scroll-driven animations, sin lottie.
- El feedback de "deshacer" del carrito es la única animación
  permitida con timing visible (banner desliza 200ms in, 200ms out,
  4000ms visible).

## 9. Modo oscuro (futuro)

**En F1 no se implementa modo oscuro** automático. La UI por defecto es
clara (cream/stone backgrounds). En B4+ cuando lleguen pantallas para
hostelería oscura, evaluaremos un toggle manual de tema (no system-pref)
porque cada local tiene iluminación propia.

Cuando llegue: el coral se mantiene (`#E97058` luce bien sobre fondo
oscuro), el ink se invierte (`#F8F6F3` → texto), el stone se hace
profundo (`#1F2937` → background). Conservar las pruebas en mockups
antes de implementar.

## 10. Referencias

- `docs/design/reference-app.tsx` — código fuente de las 9 pantallas v1.
  Code lo lee para copiar patrones literales al implementar B3/B4.
- `docs/design/tailwind.config.reference.js` — configuración Tailwind
  con los tokens `mipiace.*`. Copiar a `apps/admin/` y `apps/tpv-web/`.
- `docs/design/index.reference.css` — CSS variables + import de DM Sans.
- `docs/design/mockups/tpv-v1-pantallas.html` — bundle navegable con las
  9 pantallas para revisión visual.
- `docs/ux-principles.md` — principios transversales (densidad,
  latencia percibida, anti-patrones).
