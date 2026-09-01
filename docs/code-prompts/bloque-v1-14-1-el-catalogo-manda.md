# Bloque v1.14.1 · el catálogo manda

## Contexto (leer antes)

- `docs/blocks/v1-14-la-comanda-se-ve-done.md` — lo que hizo v1.14. **No se deshace nada de eso.**
- `docs/qa/2026-09-01-ap11-v1-14/07-venta-v114-mesa.png` — **el antes de este bloque**: v1.14 ya
  desplegado (`073fc94`) y corriendo en el AP11 real a 1280 × 800.
- `docs/qa/2026-09-01-auditoria-pantalla-venta.md` — la auditoría que originó v1.14.
- Skills `sistema-visual-mipiace` y `metodologia-front-mipiace`. **Mandan los tokens del proyecto.**

## El problema, en una frase

**v1.14 arregló lo que se midió y no arregló lo que se ve**: la auditoría midió el panel del ticket,
pero quien manda en la percepción de esta pantalla es **el catálogo**, que ocupa dos tercios del
ancho y hoy es un muro de tazas grises idénticas.

Medido sobre la captura del terminal real (1280 × 800 CSS):

| | Hoy | Debe quedar |
|---|---|---|
| Alto de la tarjeta de producto | ~200 px | tal que se vean **3 filas completas** sin scroll |
| De eso, icono placeholder gris | **~125 px** | **0 px** |
| Alto de la fila de categorías | ~100 px (dos filas) | **una fila** |
| Hueco vacío del desglose con 1 línea | ~220 px | ocupado con algo útil |

## Alcance

### 1 · Matar el placeholder gigante (lo primero y lo más importante)

Cada tarjeta dedica ~125 px a un icono de taza genérico **idéntico en las diez**. No informa de
nada, y se come la fila de productos que el camarero necesita ver. La tarjeta pasa a ser compacta y
tipográfica: **el nombre y el precio son el producto**.

- Sin foto (el caso normal hoy): **nada de icono grande**. Como mucho, un acento fino del tono de
  la categoría — una banda de 4-6 px o el icono a tamaño de texto junto al nombre.
- Con foto (si Holded la tiene): se usa, y entonces sí manda la imagen. El componente debe soportar
  los dos casos sin cambiar de altura.
- Nombre a **dos líneas como máximo**, con elipsis; precio con jerarquía clara.
- **Criterio de aceptación**: a 1280 × 800, con el panel del ticket abierto, se ven **3 filas
  completas** de producto. Hoy se ven 2.

### 2 · Categorías: una sola fila, y el color que signifique algo

v1.14 quitó el scroll horizontal a cambio de ~100 px de alto, y con "Más (3)" **siguen sin verse
todas**: el problema se movió de eje, no se resolvió.

- **Una fila** de chips + `Más (N)`. La segunda fila se va.
- **Los tonos de v1.14 son ruido**: hoy se asignan por orden (Bollería amarillo, Café rojo,
  Croissantysandwich verde, Infusiones amarillo otra vez) y no ayudan a escanear. El tono de
  categoría se conserva **sólo como color del icono**; el fondo del chip es neutro.
- **El chip seleccionado va en coral**, no en ink. Hoy "Todos" sale negro: rompe el sistema visual y
  compite con "Cobrar", que es la única acción que debe llevar coral pleno.

### 3 · El desglose ha pasado de 20 px a un desierto

Con una línea quedan ~220 px vacíos y el panel parece roto en vez de parecer un ticket. **No se
toca la jerarquía de v1.14** (lista `flex-1`, pie anclado): lo que se hace es **llenar el hueco con
algo útil**. Ya existe `ticket-top-sellers` para el estado vacío — muéstralo también cuando hay una
o dos líneas y sobra sitio, y ocúltalo en cuanto el ticket crece. Añadir el segundo café sin volver
a buscarlo en la rejilla es exactamente el gesto de la barra en hora punta.

### 4 · Que "Cobrar" mande en el pie

Hoy "Enviar comanda" y "Cobrar" pesan casi lo mismo, lado a lado. **Cobrar es la acción principal**:
64-72 px de alto según el sistema visual, y "Enviar comanda" claramente secundario.

### 5 · Detalle

La meta de la cabecera del ticket termina en un `·` colgando (`10 h 42 m · mipiacetpv-test-… ·`).
Se corta mal. Arréglalo.

## Verificación

Tabla **sabotaje → test rojo**, con los sabotajes aplicados de verdad sobre el código y revertidos:

| Sabotaje | Debe caer |
|---|---|
| Devolver el placeholder a 125 px | test de que caben 3 filas de producto a 1280×800 |
| Forzar 20 categorías | test de que los chips siguen en **una** fila y sale `Más (N)` |
| Pintar el chip seleccionado en ink | test de que el seleccionado es coral |
| Ticket con 1 línea | test de que se pintan los más vendidos en el hueco |
| Ticket con 8 líneas | test de que **no** se pintan y la lista se queda el espacio |

Y declara **qué NO cubre la suite**.

**Bucle visual obligatorio**: Playwright a **1280 × 800**, y compara cada captura contra
`docs/qa/2026-09-01-ap11-v1-14/07-venta-v114-mesa.png`. El listón no es "cumple el alcance": es
**que la pantalla se vea mejor que esa captura**. Si al mirarlas lado a lado no lo está, itera.

Cierra con `docs/blocks/v1-14-1-el-catalogo-manda-done.md`, con las decisiones tomadas sin
preguntar una a una.

## Fuera de alcance (explícito)

- **No deshagas la jerarquía del panel del ticket de v1.14.** Cabecera compacta, lista `flex-1`,
  pie anclado y sheet de "Más" se quedan como están.
- **No persigas fotos de producto en Holded.** El componente las soporta si están; el bloque no
  depende de que existan.
- No tocar el flujo de cobro, el arqueo ni el cierre de turno.
- No tocar el mapa de sala. Tiene sus propios problemas de densidad y va en otro bloque.
- El bloque **A4** (que la APK sirva su propio bundle) es independiente y no se toca aquí.
