# kds-1c · la pantalla ordena sola, y la hoja de alergias no confunde

Sigue en la **misma rama `kds-1-cocina`** (PR #18). Sale de comparar las capturas de kds-1b con la
decisión 7 y la maqueta.

## 1 · El orden está roto en la captura (grave)

En `cocina-1280x800.png` el orden es T4 (urgente) → M5 (7 min) → M1 (4 min) → **M2 (14 min)**. Y en
el «+7», en **rojo**, quedan escondidas mesas más antiguas que las que se ven: la **M4 lleva 26 min y
está oculta**, mientras la M1, con 4, se ve. Es justo lo que la decisión 7 quiere impedir. El cocinero
tiene que ver primero lo que más espera.

La causa está en `banco.mjs`: la pantalla pinta las comandas **en el orden en que le llegan**
(`COMANDAS` está escrito a mano) y no las ordena ella.

Qué hay que hacer:
- **La pantalla ordena siempre ella misma**, venga como venga la lista del servidor:
  1. primero las urgentes;
  2. después por la **misma marca de tiempo que pintan los minutos** (la de marcha), **de la más
     antigua a la más nueva**;
  3. si empatan, por el id.
- La función de ordenar es **una sola**: la usan la rejilla y el «+N». Así, lo que va al «+N» son
  siempre **las más nuevas**.
- Consecuencia: el «+N» solo se pone rojo si una oculta está en rojo, y eso **ya no puede pasar
  mientras haya una visible más nueva que ella**. Comprueba que el caso «rojo oculto» queda reservado
  a cuando de verdad hay más rojas de las que caben.
- Vuelve a sacar la captura con `COMANDAS` **en el mismo orden desordenado de ahora**. Esa es la
  prueba de que ordena la pantalla y no el banco.

| Sabotaje | Debe caer |
|---|---|
| Quitar el ordenado en la pantalla | lista barajada → las visibles son las N más antiguas (urgentes delante) y en orden de lectura |
| Ordenar por `sentAt` en vez de por la marca que pinta los minutos | un tiempo 2 marchado tarde se coloca por su marcha |
| Que «+N» use otro orden que la rejilla | los ocultos son siempre más nuevos que el último visible |

## 2 · La hoja de alergias: qué está seleccionado y qué tiene alergia (menor)

En `tpv-alergias-1443x812.png` salen en **rojo** a la vez «TODA LA MESA» y la silla 3, y la derecha
dice «Toda la mesa» sin ningún alérgeno marcado. No se sabe qué estás editando.

Qué hay que hacer:
- **El rojo significa «tiene alergia»**: la silla 3 en rojo con «gluten» debajo, como en la maqueta.
- **Lo seleccionado lleva un anillo blanco**: el anillo indica qué silla (o «toda la mesa») estás
  editando ahora, y no cambia el color.
- «Toda la mesa» va **neutra** si no tiene alérgenos y en rojo solo si los tiene.
- Al abrir la hoja, queda seleccionada la primera silla con alergia, o «toda la mesa» si no hay
  ninguna.

| Sabotaje | Debe caer |
|---|---|
| Pintar en rojo «toda la mesa» sin alérgenos | color de fondo neutro |
| Que la selección cambie el color en vez de poner el anillo | la silla seleccionada sin alergia tiene fondo neutro y anillo |

## Cierre

- Capturas de nuevo: `cocina-1280x800` y `tpv-alergias-1443x812`.
- En el `-done`, un §«kds-1c» con el mensaje real de cada rojo.
- Commits pequeños en la misma rama.
- **No hagas push**: deja el comando al final.
