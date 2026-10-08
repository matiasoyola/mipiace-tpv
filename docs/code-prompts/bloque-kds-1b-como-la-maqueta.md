# kds-1b · que la pantalla se parezca a la maqueta validada

Sigue en la **misma rama `kds-1-cocina`** (PR #18). No reabre ninguna decisión. Es la corrección
visual que salió al comparar tus capturas (`docs/blocks/kds-1-cocina-shots/`) con la maqueta que
Matías validó.

## La maqueta, ahora en el repo

No pudiste abrir el lienzo, así que ahora va como fichero: `docs/kds/maqueta/`.
- `Main.dc.html` es la cocina a 1280×800.
- `Comanda.dc.html` es la comanda de la M5 en el TPV a 1443×812.
- `Alergias.dc.html` es la hoja por silla en el TPV a 1443×812.

Son HTML con estilos en línea. Los **colores, tamaños y textos que hay en ellos son los de entrega**:
léelos de ahí, no los aproximes.

## Las cinco diferencias que hay que corregir

1. **Las tarjetas no se tiñen de rojo.** Ahora el cuerpo de la T4 (urgente) y el de la M5 (alergia)
   salen en rojo oscuro, y eso rompe la *regla del rojo* (decisiones §3).
   - El cuerpo de todas las tarjetas va **neutro**, `#1A1D23`.
   - El rojo va solo en la franja «⚡ URGENTE» (más el borde de 4 px), en la franja de la alergia,
     en el recuadro del plato de la silla y en el plato que lleva el alérgeno.
2. **La alergia de la mesa es una franja roja ancha.** Ahora es una cajita oscura con «⚠ SILLA 3 ·
   SIN GLUTEN». Tiene que quedar así:
   - fondo `#C8102E` y texto blanco;
   - icono de aviso;
   - **«SILLA 3 · CELÍACO»** a 21 px en negrita y debajo el alérgeno, «Gluten», a 15 px;
   - justo debajo de la cabecera de la mesa.

   «SIN GLUTEN» va **en el recuadro del plato** de esa silla, no en la franja.
3. **Los modificadores y las notas se leen.** Ahora salen en gris, pequeños y con «·». Tienen que ir
   en ámbar `#F6CF7A`, a **17 px y en negrita 600**, con «— ».

   El cocinero que no lee «sin limón» lo pone.
4. **Cuatro columnas, y el «+N» sin rojo.**
   - Con 3 columnas solo caben 3 comandas y se esconden mesas que cabrían. Ponlo a **4 columnas en
     1280 px**, quitando ancho a «Listas», como en la maqueta: ~160 px de «Listas» y ~60 px de
     indicador.
   - Un nombre largo **pasa a dos líneas**; no se corta ni baja de 22 px.
   - El indicador de lo que no cabe va en una **franja vertical neutra** en el borde derecho de las
     tarjetas, no al pie de «Listas». Dice «+N» y debajo las mesas, y **parpadea en verde solo si hay
     nuevas**.
   - **Nunca en rojo**, salvo que una de las ocultas haya pasado a rojo en el semáforo.
5. **En el TPV, el coral es solo para «Cobrar»** (principio de venta bajo estrés, regla 1). Ahora
   «Marchar 2º» y «Guardar» (la hoja de alergias) van en coral.
   - «Marchar 2º» pasa a neutro con contorno, como «Enviar».
   - «Guardar» pasa a claro, como el «Listo» de la maqueta.

## De paso, mira y anota (no hace falta arreglarlo si es a propósito)

- En la maqueta, «Listas» es una pastilla verde con «esperando · 3 min». En la captura es gris, con
  «1 plato».
- En la maqueta, la barra superior lleva la hora. En la captura no la lleva.
- En la hoja de alergias falta la referencia de dónde queda la barra, que es la que hace que la
  numeración de las sillas sea siempre la misma.
- En la captura de la comanda no se ven ni «Espera» ni «¡Lleva gluten!». Comprueba que existen y
  sácalos en una captura.

## Sabotajes nuevos (cada uno debe ponerse rojo; el mensaje real va al `-done`)

| Sabotaje | Debe caer |
|---|---|
| Fondo rojo en el cuerpo de una tarjeta urgente o con alergia | el color calculado del cuerpo es `#1A1D23` |
| Franja de alergia sin fondo rojo o con menos de 21 px | color y tamaño calculados de la franja |
| Modificador a menos de 17 px o en gris | tamaño y color calculados |
| 3 columnas a 1280 px | 4 tarjetas en la primera fila con 4 comandas normales |
| «+N» en rojo sin ninguna oculta en rojo | color del indicador |
| Coral en cualquier botón de la comanda que no sea «Cobrar» | color de fondo de todos los botones |

## Cierre

- Vuelve a sacar **las mismas capturas** y añade la de la comanda con «Espera» y «¡Lleva gluten!».
- En el `-done`, §diferencias con la maqueta: una tabla con cada diferencia, si está corregida o si se
  deja a propósito, y el porqué.
- Commits pequeños en la misma rama. **El push lo hace Matías**: deja el comando exacto al final.
