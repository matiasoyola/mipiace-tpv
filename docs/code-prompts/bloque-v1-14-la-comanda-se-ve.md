# Bloque v1.14 · la comanda se ve

## Contexto (leer antes)

- `docs/qa/2026-09-01-pruebas-fisicas-ap11-ronda2.md` — pruebas físicas de la ronda 2 sobre el AP11.
- **Auditoría de la pantalla de venta, 2026-09-01: nota 6,5/10.** Los hallazgos de este bloque son
  C1, M1, M2, M3, M4, m1 y m2 de ese informe.
- Capturas del terminal real en `docs/qa/2026-09-01-ap11-ronda2/` — en particular
  `25-mesa-M1-abierta.png` y `27-ticket-5eur.png`, que son el antes.
- Skill `sistema-visual-mipiace` (tokens, tipografía, componentes) y `metodologia-front-mipiace`
  (principios UX y estándar de acabado). **Mandan los tokens del proyecto.**
- `docs/blocks/v1-12-manos-de-camarero-done.md` — este bloque continúa esa línea.

**El terminal real es 1280 × 800 CSS** (AP11 a densidad 240). Ese es el viewport de diseño.

## El problema, en una frase

El panel del ticket dedica 225 px de sus 573 px a cabecera y a siete acciones que se usan una de
cada veinte veces, y deja **20 px visibles** para el desglose de artículos: al añadir un producto el
camarero **no ve confirmación de que se ha añadido**, y en hora punta eso se paga con dobles
pulsaciones y cafés cobrados de más.

## Alcance

### 1 · Panel del ticket: invertir la jerarquía (hallazgo C1, crítico)

`apps/tpv-web/src/pages/SalePage.tsx` y sus parciales.

Orden nuevo, de arriba abajo:

1. **Cabecera compacta**: nombre de mesa + meta (`ahora · N uds. · Ticket N del turno`).
   El botón **Mapa desaparece de aquí** (se va a la barra superior, punto 3).
2. **Lista de artículos**, ocupando **todo el espacio flexible** (`flex-1`, scroll vertical propio).
   Es lo que más se mira y va donde antes estaban las acciones.
3. **Zona anclada al pie** (`sticky bottom-0`, fondo sólido, borde superior): Subtotal / IVA / Total,
   "Enviar comanda" y "Cobrar". Nunca se va de la vista, con el ticket que sea.
4. Las siete acciones secundarias (Cliente, Descuento, Observaciones, Mover mesa, Partir cuenta,
   Agrupar, **Cancelar**) se recogen en un único botón **"Más"** en la cabecera, que abre un sheet.

**Feedback al añadir línea** (esto es el núcleo del bloque, no un extra): al tocar un producto, la
línea correspondiente debe **destacarse visiblemente durante ~1 s** (fondo `coral-soft` que se
desvanece) y la lista hacer scroll hasta ella. Feedback < 100 ms, sin esperar al servidor.

### 2 · Categorías: eliminar el scroll horizontal (hallazgos M1 y M2)

`apps/tpv-web/src/pages/SalePage.tsx`, fila de chips.

Hoy los ocho chips llegan hasta x=1876 de 1920 y se cortan sin ninguna señal. **No se arregla con
un gradiente**: el scroll horizontal es un anti-patrón prohibido por los principios UX del proyecto.

- Los chips **envuelven a un máximo de dos filas**. Si no caben, la última posición es un chip
  **"Más (N)"** que abre un sheet con las restantes.
- Cada chip lleva **color e icono** por categoría, usando los seis tonos ya definidos en el sistema
  visual (`amber`, `sky`, `red`, `green`, `rose`, `stone`: fondo `-50`, texto `-700`) e iconos
  Lucide stroke 2.25. La asignación tono↔categoría se persiste por tenant.
- El coral queda **reservado para la categoría seleccionada**. Hoy lo lleva "Todos" de forma fija y
  le roba la señal a la selección real (hallazgo m2 del informe de auditoría).

### 3 · Barra superior según el vertical (hallazgos M3 y M4)

Hoy la búsqueda ocupa **768 px de los 1280** (60 % del ancho) y "Mapa" está enterrado en el panel
del ticket, siendo la navegación más frecuente del turno.

La barra se ordena leyendo `businessType` del tenant, que **ya existe** (`HOSPITALITY`, `RETAIL`,
`SERVICES`) y ya se usa en superadmin:

- `HOSPITALITY`: **"Mapa" como botón primario grande a la izquierda** (≥ 64 px de alto, con icono y
  texto). La búsqueda se reduce a un botón de lupa que despliega el campo al pulsarlo.
- `RETAIL` / `SERVICES`: se mantiene la búsqueda ancha y el escáner; "Mapa" no se pinta si el tenant
  no tiene mesas.

### 4 · Estado vacío del ticket con inteligencia

Principio UX no negociable: *estado vacío siempre informativo, nunca pantalla en blanco*. Hoy una
mesa recién abierta muestra un panel vacío.

Cuando el ticket no tiene líneas, la zona de artículos muestra **los cinco productos más vendidos
del turno actual** (o los más vendidos del último mes si el turno acaba de empezar), tocables para
añadir directamente. Es el punto de mayor intención del turno y acelera el grueso de las comandas.

**Esta es la única parte del bloque que añade valor en vez de corregir un fallo.** Si hay que
recortar por tiempo, se recorta lo último.

## Restricciones

- **Los tokens del proyecto mandan** sobre cualquier propuesta estética de herramientas o plugins.
  Nada de valores hardcodeados: paleta, radios y espaciados salen de la escala existente.
- Importes siempre con `tabular-nums`. Sentence case. Sin sombras pesadas.
- **Tap targets ≥ 48 px**; la CTA primaria **64-72 px** — hoy "Cobrar" y otras están a 56 px y eso
  incumple el propio sistema visual (hallazgo m2).
- **Ningún campo de importe puede abrir el teclado de Android.** Se usa `CashPad`. Verificable con
  `adb shell dumpsys input_method | grep mInputShown` → debe ser `false`.
- El sheet de "Más" es aceptable porque son acciones secundarias. **No introducir modales en el
  flujo de cobro**, que sí es crítico.
- Puedes usar el MCP de **21st** para buscar el patrón de bottom sheet y de chips;
  **normalízalos a los tokens del proyecto antes de cerrar el bloque**.
- Usa **context7** para las APIs de React/Tailwind de la versión real del proyecto.

## Entregables

Ficheros tocados, el sheet nuevo, y la asignación tono↔categoría persistida.

**Criterio de "funciona": la tabla sabotaje → test rojo.** Suite verde no es criterio. Para cada
punto del alcance, qué se rompe a propósito y qué test se pone en rojo. Como mínimo:

| Sabotaje | Debe caer |
|---|---|
| Quitar el `flex-1` de la lista de artículos | test de que la lista ocupa el espacio flexible |
| Devolver 20 categorías del backend | test de que no aparece scroll horizontal y sale "Más (N)" |
| Poner `businessType=RETAIL` | test de que no se pinta el botón Mapa |
| Ticket con 12 líneas | test de que Total y "Cobrar" siguen visibles sin scroll |
| Añadir producto | test de que la línea se destaca y la lista hace scroll hasta ella |

Y **declara explícitamente qué NO cubre la suite** — como mínimo, el render real en el AP11.

**Bucle visual obligatorio**: levanta el dev server, hazte screenshots con Playwright a **1280×800**
(el terminal), revísalos críticamente contra las capturas del antes y contra los principios UX, e
itera hasta que la jerarquía sea la del alcance. Incluye una captura con **ticket de 12 líneas**,
que es el caso que rompe y que la ronda 2 no llegó a probar.

Cierra con `docs/blocks/v1-14-la-comanda-se-ve-done.md` según la plantilla, con la sección de
**decisiones tomadas sin preguntar** una a una.

## Fuera de alcance (explícito)

- **El bug del `CashPad` en campos pre-rellenos.** Tiene decisión de producto pendiente
  (ver `project_cashpad_campos_prerellenos`). Va en su propio bloque. **No lo toques aquí.**
- **`PairScreen` a `CashPad`.** Es otro bloque; no es la pantalla de venta.
- **Fotos de producto.** Dependen de que Holded las tenga. El color y el icono por categoría dan el
  beneficio de escaneo sin esa dependencia. No se persiguen fotos en este bloque.
- **Los nombres sucios de Holded** (`Croissantysandwich`). Es implantación, no código: se arregla
  con `TagAliasesPage`, que ya existe.
- **Cambiar el `ConfirmSheet` de "Vaciar mesa" por un deshacer de 4 s.** Los principios UX prefieren
  deshacer a confirmar, pero vaciar una mesa cobrada tiene consecuencia contable. **Duda abierta
  para producto**, no decisión de la sesión de implementación.
- Nada de tocar el flujo de cobro, el arqueo ni el cierre de turno.
