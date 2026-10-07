# Principio de producto · la venta se hace a toda velocidad y bajo estrés

Matías, 07-10-2026, viendo la vista de productos en el D8 de La Maestranza: «lo tiene que leer un humano, a toda velocidad y en pleno estrés, y la única distinción es una pequeña línea de color, con el texto diminuto». Antes: «veo poca usabilidad en todo, muy poca, tienes que poner demasiada atención para marcar las cosas». Y: «si el nuestro es nuevo tiene que ser mejor» (que Toast, su referencia de «limpio y claro»).

## Lo que había (medido en el D8, 1920×1080, viewport 1443×812)

- Productos: una columna de tarjetas altas, unos 5 por pantalla. «Todos» en orden alfabético, así que lo más vendido se pierde.
- Única distinción entre categorías: una raya de color fina encima de la tarjeta. Nombre y precio en texto pequeño y gris.
- Mesas: libres y ocupadas, tarjetas blancas con borde fino; leyenda y «4 PAX» en gris claro pequeño; la barra la última.

## Reglas (versión del 07-10 noche, tras iterar maquetas con Matías)

1. **Se reconoce, no se lee.** Color de la familia en todo el botón, no una raya. Sin dibujos ni fotos por producto (probados y descartados: no ayudan a comandar y afean).
2. **Familia primero, producto después**, como todos los TPV de bar; sin vista «Todos». **Nunca paginación**: la familia entera en una pantalla; la cuadrícula se adapta (4×5 hasta 20, más a partir de ahí, mínimo 64 px de alto y nombre ≥ 20 px).
3. **«Ahora»** como primera vista: lo más pedido en esa franja horaria en ese comercio, calculado de sus ventas. Única vista que se reordena sola; dentro de cada familia, cada producto siempre en el mismo sitio (memoria de posición).
4. **Texto grande y con contraste**: escala TPV (nombre de producto ≥ 23 px, línea de comanda 20–22 px, total ≥ 44 px). Nada de gris claro para información que se usa.
5. **Fondo oscuro** en la venta y la sala de hostelería: los botones de color resaltan y la pantalla no deslumbra.
6. **La comanda dice qué está en cocina y qué no**, la cantidad se ve en el propio botón, se corrige sobre la propia línea con − y + grandes (56 px, un pulso de dedo). La fila de cantidad 1–6 va entre las familias y los productos.
7. **Sala**: mesas como formas del local; ocupada = relleno + importe grande; la barra arriba.
8. **Criterio de cierre**: medido en el hierro, toques y segundos de una comanda típica y de un cobro, antes y después. «Queda más bonito» no vale.

Maquetas: lienzo «Venta La Maestranza · botones que se reconocen» (claro y oscuro + mesas). Prompt: `docs/code-prompts/bloque-v2-hosteleria-venta-y-sala.md`.
