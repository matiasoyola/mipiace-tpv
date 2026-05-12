# UX · Principios transversales

Aplica a todos los verticales (retail, bar, peluquería v2…). Estos
principios son contrato de calidad del producto, no recomendaciones
opcionales. Code y diseño los siguen al implementar cualquier pantalla.

> **Por qué existe este doc.** El TPV de Holded es funcionalmente
> completo pero **incómodo de usar** porque está construido encima de su
> ERP: cada acción atraviesa reglas de negocio de facturación, los
> botones son tamaño-ratón (~30 px), y la UX está pensada para un
> administrativo emitiendo una factura, no para un camarero con la barra
> llena. Nuestro TPV gana o pierde en este eje. Si lo hacemos rápido y
> cómodo, los clientes lo nota desde la primera demo.

---

## 1. Principios rectores

### 1.1 Latencia percibida cero

Cualquier acción del cajero (añadir línea, cobrar, abrir mesa) **no
espera al servidor**. La venta es local, Holded se entera después en
background. El cajero nunca ve un spinner durante el servicio.

### 1.2 Touch targets pensados para dedos sudados

Mínimo **64×64 px** de área tocable. Ideal **80×80 px** en pantalla
principal de venta. Holded usa 30 px y por eso requiere acertar tres
veces; nosotros, no.

### 1.3 Confirmación visual inmediata

Cada acción tiene feedback visual claro en <100 ms: la línea aparece
animada en el carrito, el botón cambia de color, el cambio se destaca.
**No usamos toasts pequeños en la esquina** para confirmar acciones
críticas — se pierden con el rabillo del ojo en pleno servicio.

### 1.4 Errores reversibles sin pánico

Toda acción del cajero tiene **deshacer accesible durante 4 segundos**
en banner inferior. Aplica a: añadir línea, eliminar línea, aplicar
descuento, cancelar venta. Quita el miedo a tocar y elimina la mayor
fuente de stress.

### 1.5 Tipografía grande y jerarquía clara

Mínimo **16 px** en cualquier texto operativo, **18-20 px** en líneas de
producto, **48 px** en el total a cobrar y en el cambio. El bar es
oscuro y el camarero no para a entrecerrar los ojos.

### 1.6 Modo oscuro por defecto en pantalla de venta

Los bares suelen ser locales con poca luz. Texto claro sobre fondo
oscuro reduce fatiga visual durante 8 horas de turno. Admin y retail
puro pueden usar tema claro; venta-hostelería arranca oscuro.

### 1.7 Sin modales en el flujo crítico

Confirmaciones no-críticas (¿añadir modificador?, ¿confirmar línea?) NO
usan modal — usan bottom sheet o pop-over inline. El modal sólo para
operaciones destructivas que requieren autorización (anular ticket,
cerrar turno con `SYNC_FAILED`).

### 1.8 La pantalla no se inunda

Como máximo **8-12 elementos accionables** visibles a la vez en
cualquier vista. Si hace falta más, agrupar en categorías o scroll
vertical (nunca horizontal — el horizontal es ilegible en táctil).

---

## 2. Imprescindibles F1 (parte del contrato)

Estas no son "nice to have", son **must have** para que cualquier
vertical sea usable.

### 2.1 Botonera principal con top productos siempre visibles

En cualquier vertical donde haya productos top (retail con sus más
vendidos, bar con sus 15 bebidas/snacks frecuentes), el admin
configura **el orden y el contenido** de la pantalla principal de
venta. Esos 12-20 productos top ocupan la pantalla sin necesidad de
buscar nunca para el 80 % de las ventas.

### 2.2 Búsqueda fuzzy y sin sensibilidad a acentos

`caf` encuentra "café", "cafelito", "cafetera". `cafe` encuentra
"café". Tres letras encuentran cualquier producto. El input tiene
foco permanente y acepta entrada del lector de barcode sin más.

### 2.3 Deshacer último gesto

Banner inferior tras cada acción reversible: "Has añadido café solo ·
DESHACER" durante 4 s. Aplica a:

- Añadir línea.
- Eliminar línea.
- Aplicar descuento.
- Cancelar venta en curso (recupera el carrito).
- Cambiar producto de mesa.

### 2.4 Indicador permanente del estado de red

Banner persistente en el header con tres estados:

- **Verde "Conectado"**: oculto o muy discreto.
- **Ámbar "Sincronizando…"** si la cola de sync tiene jobs.
- **Rojo "Sin conexión"** si hay pérdida de red. Permanente, no
  notificación efímera. El cajero debe saber sin pensarlo.

### 2.5 Calculadora de cambio con quick keys

Pantalla de cobro con:

- Botones grandes para `+5 € +10 € +20 € +50 €` y "Importe exacto".
- Teclado numérico de 0-9 + coma para el importe libre.
- Cambio destacado en **48 px**, color de contraste alto.
- Auto-confirma el cobro si el importe es exacto y el método es
  efectivo (configurable por tienda).

### 2.6 Saltar entre tickets/mesas con un toque

En verticales con múltiples ventas paralelas (bar con mesas, retail con
ventas suspendidas), una **lateral bar** o **bottom bar** muestra los
últimos 3-4 tickets que el cajero ha tocado, accesibles desde
cualquier pantalla con un toque.

### 2.7 Auto-resetear foco al input principal

Tras cualquier acción (añadir, eliminar, cobrar) el foco vuelve al
input de búsqueda/barcode. El cajero no tiene que tocar la pantalla
para que el lector funcione.

---

## 3. Diferenciadores baratos (1-2 días dev cada uno)

Generan el "wow" en demo sin inflar el alcance.

### 3.1 Iconos opcionales en botones de producto

El propietario sube una foto desde admin y el botón es identificable
de un vistazo. Si no sube foto, se queda con texto. Útil cuando hay
50+ productos top.

### 3.2 Tiempo en mesa visible en el mapa (bar)

Cada mesa abierta muestra contador "23 min" en pequeño. Permite
detectar mesas olvidadas. Holded no hace esto.

### 3.3 Memoria del último pedido por mesa o por cliente

Si la mesa B3 cerró ayer con "Juan: café solo + zumo", al abrirla hoy
ofrece botón "Repetir último (Juan)". En retail, si el contacto
Holded tiene historial, sugiere productos.

### 3.4 Atajos de teclado para terminales con QWERTY

`F1-F12` mapeables a productos top desde admin, `Enter` confirma, `Esc`
cancela, `1-9` marca cantidad. Útil para bares modernos con teclado
físico y cajeros que ya tienen velocidad teclando.

### 3.5 Sonido opcional al añadir línea

Tick corto y discreto. Reduce dudas del tipo "¿lo habré añadido?" sin
ser molesto. Configurable por tienda (volumen o off).

### 3.6 Pantalla en landscape y portrait sin reorganización manual

Detecta orientación y reorganiza columnas/botones automáticamente. El
bar puede tener iPads en horizontal sobre la barra y vertical en la
zona de cobro. Sin esto el cajero tiene que aguantar pantalla mal
aprovechada.

---

## 4. Evolutivo (v2+) — diferenciadores que cierran ventas

Estas son el pitch frente a la competencia consolidada. **No son F1.**

- **Comandar por voz.** "Café solo y dos cañas para la mesa 5" → el
  reconocimiento añade líneas. APIs de cloud (Whisper, Deepgram) o
  Web Speech API del navegador. Útil cuando el camarero tiene
  bandeja en mano.
- **Reconocimiento de cliente fiel por NFC o QR.** El cliente toca su
  móvil con su tarjeta de fidelización en el TPV y se cargan sus
  preferencias.
- **Sugerencia de upsell contextual.** "Los clientes que piden café a
  esta hora suelen llevar cruasán. ¿Añadir?". Estadística simple del
  histórico del tenant.
- **Modo "una mano" para teléfonos.** Todos los botones principales
  agrupados en la mitad inferior, accesibles con el pulgar dominante.
- **Pantalla compañera para clientes.** Tablet apuntando al cliente
  mostrando lo que el cajero va añadiendo (típico de supermercados).
- **Indicador de carga del servicio** (heatmap del local). El
  propietario ve qué mesas/zonas trabajan más en qué horas.

---

## 5. Pruebas de usabilidad — cómo validamos

Antes de cada release mayor (v1.0, v2.0…) hacemos:

- **Sesión presencial de 1 h con un camarero real** en un bar piloto.
  Le damos el TPV, no le explicamos, y observamos. Cualquier cosa que
  le frene se anota como bug.
- **Test de los 30 segundos:** un usuario nuevo tiene que entender la
  pantalla de venta sin instrucciones. Si no, la pantalla está mal.
- **Test de la hora punta simulada:** 10 ventas seguidas en 5
  minutos. Si el cajero suda o se equivoca, hay UX que arreglar.

---

## 6. Anti-patrones explícitos

Cosas que NO hacemos, aunque parezcan útiles:

- **Confirmaciones múltiples** ("¿Estás seguro?" "¿De verdad
  seguro?"). Una sola, con deshacer disponible después.
- **Menús anidados** de más de 2 niveles. Si hace falta más, la
  arquitectura de información está rota.
- **Animaciones de >300 ms** entre pantallas. Fricción percibida.
- **Iconos sin texto** en navegación principal. Ambigüedad =
  errores.
- **Drag and drop** como única forma de hacer algo crítico. Funciona
  en demos, no en hora punta.
- **Tooltips al hover.** Touch no tiene hover. Las cosas se ven o no
  existen.
- **Notificaciones push del navegador** durante la venta. Distracción.
- **Modales bloqueando todo** para algo no-crítico.

---

## 7. Referencias

- `docs/07-nucleo-comun.md` — contrato funcional. La UX vive encima.
- `docs/verticals/*.md` — cada vertical adapta estos principios a su
  realidad (bar puede priorizar mapa de mesas, retail puede priorizar
  buscador de catálogo, etc.).
