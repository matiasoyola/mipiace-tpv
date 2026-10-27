# Bloque clinica-10 · mínimos clics antes de Rosario

Rama `clinica-10-minimos-clics`, worktree `~/Developer/Claude/Projects/mipiacetpv-clinica-10`, desde
`origin/master`. Escrito el 27-10-2026 a partir de la pasada en hierro de clinica-9.

Lee antes, en este orden:
1. `docs/qa/2026-10-27-clinica-9/PASADA.md` — **la pasada entera, con capturas.** Este bloque cierra sus
   hallazgos salvo lo que se dice abajo que queda fuera.
2. `docs/blocks/clinica-9-done.md` y `docs/blocks/clinica-8-done.md`.
3. `docs/clinica/decisiones.md`.

## Por qué existe

La pasada del 27-10 vio en la Lenovo los 15 puntos de clinica-9. Lo que queda no rompe nada, pero
**cuesta toques o lleva a error**, y Rosario va a hacer cada gesto decenas de veces al día.

¿Y qué?: **la primera visita de una paciente nueva se cobra bien sin que nadie toque «Qué se cobra»**, y
cada pantalla que toca Rosario pide el mínimo de toques.

## Decisión de producto (Matías, 27-10) — no se re-debate

**Mínimos clics posibles.** Lo que el sistema ya sabe (el servicio reservado, la paciente, la fecha
propuesta) viene puesto; quien atiende solo toca para **quitar o cambiar**, nunca para confirmar lo obvio.

## Lo que entra

1. **El servicio de la cita viene marcado en «Qué se cobra» (H5).** Hoy una cita de «Consulta diagnóstico»
   abre la sesión con el servicio sin marcar y el pie dice «Nada que cobrar · General: no has marcado
   nada» (capturas 18, 24a). Y una cita de «Cura» abre con «Pasa a caja: Quiropodia básica 25 €» y «Cura»
   como extra sin marcar (10b). Regla: **los servicios reservados nacen marcados** en la sesión; el nivel
   de quiropodia por defecto solo se propone si lo reservado es un nivel de quiropodia o no hay nada
   reservado. Se pueden desmarcar. Esto **no** contradice clinica-8 (2): el cobro sigue saliendo de las
   líneas de la sesión cerrada, solo que ahora nacen con lo reservado y se ven.
2. **Nombres sin cortar en la venta (paso 33).** «biomecánic» en tres tarjetas y «Biomecáni…» en la barra
   (33). Que se lea la palabra entera (partir por sílaba con guion, reducir cuerpo o lo que sea), probado
   con los nombres del CSV de Rosario.
3. **Dispositivos con nombre legible (paso 38).** Hoy el user-agent crudo. Debe decir «Android 14 · TB311FU
   · app» (y algo equivalente para navegador).
4. **Guardar Personal escribe el alias aunque el nombre no cambie (H1).** `StaffPage.tsx` · `guardarTarjeta`
   se salta las secciones no `sucio()`; el perfil debe contar como sucio cuando `alias ≠ displayName`.
5. **Agenda · Catálogo no dice «no has asignado ninguna categoría» cuando sí las hay (H2).** Debe leer de
   donde lee el check «Catálogo clínico completo».
6. **Detalles de la pasada:** al firmar el
   consentimiento de fotos vuelve a Fotos (19b); el «atrás» de Android sale de la Historia (H3); Cajeros
   en una cuenta solo-propietaria no dice «crea al menos un cajero para poder entrar».

## Lo que NO entra

- **PIN elegible por el propio usuario**: su propio bloque (toca a todas las verticales). Es el siguiente.
- **Todo lo de la pantalla de agenda** (embudo de «Nueva cita», vista semanal, «Dársela ahora» que pierde la paciente
  —H8—, servicio propuesto al tocar la rejilla, cita de otro día que dice «Hoy» —H6—): se rediseña en el bloque
  común de agenda (`claude/brief-agenda-semana-y-embudo.md`). **Este bloque no toca `AgendaPage.tsx`.**
- Config de Rosario (servicio de pie de riesgo, texto del consentimiento): se decide con ella.

## Cómo se da por hecho

- Suite verde en local y CI. **Tabla de sabotajes en el `-done`**, cada test visto en rojo, fichero entero
  (no `-t`). Mínimo: la sesión de una cita nace con lo reservado marcado y cierra cobrándolo sin tocar
  nada; desmarcarlo lo quita; Personal escribe el
  alias sin cambiar el nombre; Agenda · Catálogo y el check leen lo mismo.
- **Contar toques** antes/después en el `-done` para la sesión de una primera visita (abrir sesión → cobro).
- **Pasada en hierro** corta con la «Clínica demo» y la Lenovo (adb), solo de lo que toca este bloque.
  Capturas en `docs/qa/2026-10-xx-clinica-10/`.
- `docs/blocks/clinica-10-done.md` con lo hecho, decisiones tomadas sin preguntar, sabotajes, toques y
  **«Al desplegar»** (APK nueva si cambia el front de la app).
- **Push de la rama y PR abierto: autorizados.** Ni merge ni despliegue.
