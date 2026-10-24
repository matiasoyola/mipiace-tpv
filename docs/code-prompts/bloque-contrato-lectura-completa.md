# Bloque contrato-lectura-completa · no se acepta el contrato sin haber pasado por todo el texto

Rama `contrato-lectura-completa`, worktree `~/Developer/Claude/Projects/mipiacetpv-contrato-lectura`,
desde `origin/master`. PR contra `master`. Escrito el 24-10-2026 desde el proyecto de Jardín de Gredos,
al aceptar la versión 2 del contrato de encargado en la primera residencia real. **Pequeño; toca el
núcleo (clínica y residencia).**

Lee antes: `apps/admin/src/pages/ContratoTratamientoPage.tsx`, `apps/api/src/clinica/contrato.ts` y
`contrato-routes.ts`, `docs/blocks/clinica-7-done.md` (el contrato y su aceptación como prueba),
`docs/blocks/primer-acceso-done.md` (el contrato primero, con tres líneas en llano y el texto
plegado) y `docs/blocks/clinica-8-done.md` (la versión 2).

## Por qué existe

Hoy el texto completo del contrato va **plegado** detrás de «Leer el contrato completo», y se puede
marcar la casilla y pulsar «Acepto» sin haberlo abierto. Matías (24-10-2026): «no debemos dejar aceptar
el contrato sin ver todo el texto; es la forma de curarnos en salud». Es lo que hacen los servicios
serios con sus condiciones: el botón no se activa hasta que el texto ha pasado entero por la pantalla.

¿Y qué?: si un día alguien dice «yo eso no lo leí», la aceptación guardada dice que el texto completo
se mostró y se recorrió hasta el final antes de aceptar, con su huella, quién, cuándo y desde dónde.

## Decisiones de producto ya tomadas — no se re-debaten

1. **El texto completo se ve en la página**, desplegado, dentro de un recuadro con su propio scroll
   (alto razonable, que quepa la casilla y el botón debajo sin bajar la página). Las tres líneas en
   llano de primer-acceso se quedan **encima**, como resumen; ya no sustituyen al texto.
2. **La casilla y «Acepto» están desactivados hasta que el recuadro llega al final** del texto. Debajo
   del botón, mientras tanto: «Baja hasta el final del contrato para poder aceptarlo». Llegar al final
   se detecta con un elemento centinela al final del texto (IntersectionObserver), no calculando
   píxeles. Si el texto cabe entero sin scroll (pantalla grande), cuenta como visto.
3. **La prueba lo guarda**: la aceptación registra además `textoMostradoCompleto: true` y el instante
   en que se llegó al final. **La API rechaza** (400, con su código) una aceptación que no lo traiga:
   la regla vive en el camino de escritura, no sólo en la pantalla. Las aceptaciones ya guardadas no
   se tocan.
4. **«Descargar el PDF»** de la versión pendiente, disponible **antes** de aceptar, junto al recuadro.
5. **Accesibilidad**: el recuadro se recorre con teclado (foco y flechas / AvPág) y el lector de
   pantalla anuncia cuándo se habilita el botón.

## De paso, dos cosas del mismo primer acceso (encontradas el 24-10-2026)

6. **El «PIN de respaldo» del TPV** («te hemos asignado un PIN de respaldo de 4 dígitos… desde el
   TPV») **no se enseña ni se genera en una cuenta sin caja**. A la directora de una residencia le
   salió al entrar. Revisa dónde se genera (activación / primer login) y ponle el mismo gate de caja
   que el resto de cosas del TPV.
7. **«Pacientes» → «residentes»** en el contrato y en sus textos de pantalla cuando la cuenta tiene la
   residencia encendida («la historia clínica de tus pacientes», «Llevarte todas las historias», «cada
   paciente»…). **Sólo en pantalla**: el texto jurídico versionado no se cambia aquí (cambiarlo es una
   versión nueva y otra aceptación); si conviene una versión del contrato con el vocabulario de
   residencia, déjalo como duda abierta en el done.

## Cómo se cierra

- Tests: botón desactivado al cargar; se activa al llegar el centinela; texto corto que cabe → activo;
  la API rechaza una aceptación sin `textoMostradoCompleto`; una cuenta sin caja no recibe PIN de
  respaldo ni ve su pantalla; con residencia, la página dice «residentes».
- Capturas a 390 y escritorio: contrato al cargar (botón desactivado) y al final (activo).
- CI verde (`ci`, `smoke`, `e2e`).
- `docs/blocks/contrato-lectura-completa-done.md` corto, con «qué hay que hacer al desplegar» (la
  columna nueva de la aceptación, si la hay).
- Commits pequeños en español, push y **PR contra `master`**. Ni merges ni despliegues.
