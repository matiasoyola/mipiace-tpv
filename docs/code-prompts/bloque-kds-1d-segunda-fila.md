# kds-1d · la segunda fila enseña lo que cabe

Se trabaja en la **misma rama `kds-1-cocina`** (PR #18). Sale de mirar la captura de kds-1c
(`cocina-1280x800.png`).

## Qué pasa

En la primera fila salen T4, M4, M2 y M6, y por debajo queda **casi media pantalla vacía**: unos
390 px de alto. El «+7» esconde la T2 y la M7, que son tarjetas cortas y caben en ese hueco. Las
esconde porque hoy la fila se trata entera: su alto es el de la tarjeta más alta, y como la M5 (la del
celíaco, ~486 px) no cabe, cae la fila completa.

En un día fuerte el cocinero vería 4 comandas teniendo sitio para 6.

## Qué hay que hacer

**Se llena por orden y se corta en la primera tarjeta que no cabe entera:**
- Se recorren las comandas **en el orden de `ordenarParaLaPantalla`**, sin tocarlo.
- Cada tarjeta se coloca en la siguiente casilla en orden de lectura (izquierda → derecha, y luego la
  fila de abajo).
- La fila de abajo empieza **donde termina la tarjeta más alta de la fila de arriba**, igual que hoy.
  Así una fila se sigue leyendo como una fila.
- Si una tarjeta **no cabe entera** en el alto que queda, se para ahí: **esa tarjeta y todas las
  siguientes** van al «+N». No se salta a una más corta que vaya detrás, porque eso rompería el orden.
- Nada se corta a medias, y no hay desplazamiento.

Con los datos del banco salen **T4 · M4 · M2 · M6** en la primera fila y **T2 · M7** en la segunda. La
M5 no cabe, así que el «+N» empieza en la M5, con sus mesas.

## Sabotajes (cada uno debe ponerse rojo; el mensaje real va al `-done`)

| Sabotaje | Debe caer |
|---|---|
| Volver a esconder la fila entera si una de sus tarjetas no cabe | banco actual → 6 visibles: T4, M4, M2, M6, T2, M7 |
| Saltar a una más corta posterior cuando una no cabe | con [corta, ALTA, corta] en la fila 2 → solo se ve la primera corta; la ALTA y la siguiente van al «+N» |
| Cortar una tarjeta a medias | ninguna tarjeta visible se sale del área |
| Que el «+N» no empiece en la primera que no cupo | el primer nombre del «+N» es la M5 |

## Cierre

- Repite la captura `cocina-1280x800` con el mismo banco y anota cuántas comandas se ven antes y
  después.
- Añade al `-done` un §«kds-1d» con el mensaje real de cada rojo.
- Commits pequeños en la misma rama. **No hagas push**: deja el comando al final.
