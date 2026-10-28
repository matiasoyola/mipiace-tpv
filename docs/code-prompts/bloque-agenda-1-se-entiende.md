# Bloque agenda-1 · la agenda que se entiende y la cita en dos toques

Rama `agenda-1-se-entiende`, worktree `~/Developer/Claude/Projects/mipiacetpv-agenda-1`, desde `origin/master`.
Escrito el 27-10-2026. **Capa común de agenda**: sirve a Rosario (clínica, una profesional), Sole (peluquería,
tres profesionales) y Raquel Torres (spa). Nada de ramas por vertical: lo que cambia va en configuración del centro.

Lee antes, en este orden:
1. `docs/mockups/agenda-nueva/` — **los cuatro tableros del diseño** (`.dc.html`, ábrelos como HTML). Son la
   especificación visual: 1 día de una profesional, 2 semana, 3 dar cita, 4 día de varias profesionales.
2. `docs/qa/2026-10-27-clinica-9/PASADA.md` — la pasada en hierro de hoy, con capturas de la agenda actual.
3. El embudo del spa: `claude/embudo-nueva-cita.md` está resumido abajo; el mockup original vive fuera del repo
   (`raqueltorres/rt-panel/docs/mockups/nueva-cita.html`). De él se toma la mecánica, no el vocabulario de spa.
4. `apps/tpv-web/src/pages/AgendaPage.tsx`, `AgendaPage.bono.tsx`, `apps/tpv-web/src/lib/agenda.ts`,
   `lib/dia-de-la-agenda.ts`, `apps/api/src/agenda/{engine,day-view,routes,hours,center-hours}.ts`.
5. `docs/blocks/clinica-8-done.md` y `clinica-9-done.md` (lo que la agenda ya hace en clínica: sesión de hoy,
   valoración, «Dársela ahora», vuelta al día de la cita).

## Por qué existe

Matías, 27-10, con la agenda abierta en la tablet: «no me gusta la agenda, no es nada intuitiva»; «dar cita es
súper tedioso… en el spa lo hemos optimizado mejor… tenemos que reducirlo a la mínima expresión». Medido hoy:
**~10 toques** para dar una cita por «Nueva cita», 5 tocando la rejilla. Las citas de 10-20 min son rayas que no se
tocan, no se ve el estado de cada cita ni qué toca ahora, y hay tres controles para cambiar de día.

¿Y qué?: quien atiende **ve de un vistazo qué toca ahora y qué hay libre**, y **da la próxima cita en dos toques**.

## Decisiones de Matías — no se re-debaten

- **Mínimos clics posibles.** Lo que el sistema ya sabe viene puesto; se toca para quitar o cambiar.
- **D1 · Una profesional → lista; varias → rejilla.** El día de una sola profesional es una **lista** de filas de
  altura tocable con los huecos libres entre medias (con su duración y qué cabe). Con varias profesionales, rejilla
  por columnas (tablero 4) con altura mínima de toque.
- El embudo del spa es el modelo de «Dar cita»; en clínica no hay cabinas, ni «relajarse», ni €/h, ni frases de venta.

## Lo que entra

1. **Día (tablero 1).** Cabecera única: volver · ‹ fecha · Hoy › · Día | Semana · botón «Dar cita». Fuera el campo
   de fecha, los chips de días y el selector «Todos» con una profesional. Lista de citas con paciente, servicio,
   duración y **estado** (cobrada, en sala, por llegar, valoración pendiente, no vino…), las hechas atenuadas, la de
   ahora destacada. **Huecos libres tocables** («Libre 25 min · cabe una Cura · + Dar cita aquí»). Horas cerradas
   plegadas en una línea. Columna izquierda: **Ahora** (con «Abrir sesión»), **Después**, **Pendiente de recepción**
   (próxima cita sin dar → «Dársela»; test sin contestar → «Tablet»; consentimiento sin firmar…) y tres cifras del
   día (citas, cobrado, minutos libres). Lo que Matías no valide en hierro se ajusta después: hazlo fácil de mover.
2. **Semana (tablero 2).** Días en columnas (los que abra el centro), tarjetas de altura mínima tocable, huecos con su
   duración, hoy destacado, tocar un día lleva a su vista de día, tocar un hueco abre «Dar cita» con esa hora.
3. **Dar cita (tablero 3).** Panel lateral con pasos que se pliegan: paciente (móvil primero; si no hay ficha, alta con
   lo tecleado y **aviso de fichas parecidas visible con el teclado abierto**) → «¿Qué viene a hacer?» (lo propuesto por
   la sanitaria al cerrar la sesión, su último servicio, primera valoración si es nueva, «Otro…») → «¿Cuándo?» (la fecha
   propuesta, esta semana, otra) → **mejores horas** ordenadas por cómo llenan la agenda («Llena el hueco justo», «Sin
   hueco muerto») → pie fijo con el resumen y **Reservar**. Lógica de ordenar en un módulo puro
   `proponer(entrada) -> propuestas[]` con sus propios tests, sin agenda real. Desde «Dársela» y desde un hueco tocado,
   todo lo sabido viene puesto: **2 toques** (hora + Reservar) o 1 si se tocó el hueco.
4. **Día con varias profesionales (tablero 4).** Rejilla por columnas, cabecera de cada una con lo que está haciendo o
   «libre hasta las 11:00», huecos tocables, mismo panel de «Dar cita».
5. **Arreglos de la pasada que viven aquí:** H8 (tras «Dársela ahora», tocar la rejilla borraba la paciente: con el
   panel nuevo no puede pasar), H6 (una cita de otro día no dice «Sesión en curso» ni «Hoy toca», ni deja anotar nada
   «de hoy»), volver al día en que se estaba al salir de una cita, valoración o tablet.

## Lo que NO entra

- Lo de clinica-10 (cobro, venta, Dispositivos, Personal): otro bloque en paralelo que **no toca `AgendaPage.tsx`**.
  Si os cruzáis en un fichero compartido, el que mergea segundo rebasa.
- PIN elegible: su propio bloque.
- Sugerencias de venta del spa («sube el ticket») y cheques regalo en el embudo: quedan preparados en `proponer()` como
  configuración del centro, sin pantalla en este bloque.
- Reserva online.

## Cómo se da por hecho

- Suite verde en local y CI. **Tabla de sabotajes en el `-done`**, cada test visto en rojo, fichero entero (no `-t`).
  Mínimo: `proponer()` pone primero la hora que llena un hueco justo; «Dársela» abre el panel con paciente, servicio y
  fecha puestos; tocar un hueco abre el panel con la hora puesta y la paciente no se pierde; una cita de otro día no
  ofrece anotar nada de hoy; la vista de una profesional es lista y la de varias rejilla.
- **Contar toques** antes/después en el `-done`: dar una cita nueva a una paciente conocida, dar la próxima cita desde
  «Dársela», dar cita en un hueco.
- **Capturas a 1280×800** (la Lenovo apaisada) de los cuatro tableros hechos de verdad, puestas al lado del diseño.
- No hay pasada en hierro en este bloque: **la hace Matías con Claude en la Lenovo, junto con clinica-10**.
- `docs/blocks/agenda-1-done.md` con lo hecho, decisiones tomadas sin preguntar, sabotajes, toques y **«Al desplegar»**
  (APK nueva: cambia el front de la app).
- **Push de la rama y PR abierto: autorizados.** Ni merge ni despliegue.
