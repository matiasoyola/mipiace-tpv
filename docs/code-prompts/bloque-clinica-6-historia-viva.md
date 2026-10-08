# Bloque clinica-6 · la historia viva

Rama `clinica-6-historia-viva`, worktree `~/Developer/Claude/Projects/mipiacetpv-clinica-6`, desde
`origin/master` (`c6192f5` o el que haya: lleva clinica-5 y enlaces-publicos). Frente C. Escrito por
Dirección el 08-10-2026.

Lee antes, en este orden:
1. `docs/mockups/clinica-historia-v2.html` — **la spec visual, validada por Matías el 07-10.**
   Recórrela entera: toca cada zona del pie, cambia de capa (lesiones / sensibilidad), arrastra el
   comparador, abre «Visitas» y «Documentos», pulsa «Empezar esta revisión →» y «Nueva visita». Se
   copia estructura, textos y estados; no se interpreta. **Los datos del mockup son inventados.**
2. `docs/blocks/clinica-5-done.md` — de aquí salen los datos: cuerpo v2, tipos, niveles, riesgo,
   avisos y **pendientes** (`pendientesCreados` de la última sesión cerrada = «Hoy toca»).
3. `docs/blocks/clinica-3-done.md` y `clinica-2-done.md` — la sesión v1, las marcas por zona
   (`lesion` + `gravedad`), la exploración (monofilamento, pulsos), la valoración y sus alertas.
4. `docs/clinica/decisiones.md` («Historia viva · mockup v2 validado») y
   `docs/clinica/referencia-cogecop.md`.
5. `docs/blocks/enlaces-publicos-done.md` — sólo para saber que la valoración ya va por la puerta
   común; este bloque no toca enlaces.

## Por qué existe

Hoy la historia de un paciente es una lista de sesiones. Para saber cómo está Carmen, Rosario tiene
que abrir sesiones una a una. En COGECOP pasa lo mismo, y es lo que le hace volver al papel.

¿Y qué?: al abrir la ficha, **en 10 segundos** sabe (1) qué le pasa y qué alerta tiene, (2) qué le
toca hoy, y lo empieza con un toque, (3) qué zonas del pie están activas, mejorando o curadas, y
cómo ha evolucionado cada una, y (4) qué visitas ha tenido, de qué tipo y nivel, sin abrirlas.

## Decisiones ya tomadas — no se re-debaten

1. **Es una pantalla de LECTURA.** No escribe en la historia, no crea tablas, no añade columnas.
   Todo sale de lo que ya guardan clinica-2, -3 y -5. Si algo del mockup no tiene dato, se enseña su
   estado vacío honesto (abajo), no se inventa. **Sin migración**; si crees que hace falta una,
   para y dilo en el `-done` en vez de hacerla.
2. **Cabecera**: avatar, nombre, edad, teléfono, «paciente desde», y la **franja roja de alertas**
   de la valoración validada (la misma de clinica-3, mismo origen, mismos ids).
3. **«Carmen en 10 segundos»**: cuatro tarjetas — **Hoy toca** · Dolor · Última vez · Ojo hoy.
   - **Hoy toca** es doble ancho, coral luminoso, con punto que late, y **se pulsa**: «Empezar esta
     revisión →» abre la sesión de clinica-5 con el tipo ya marcado (el del pendiente) y el
     pendiente arriba. Sale de los `pendientesCreados` de la última sesión cerrada. Sin pendientes,
     la tarjeta dice «Nada pendiente» y no late. Varios pendientes: el más antiguo grande, «+N».
   - **Dolor**: el último valor y la tendencia de las últimas visitas (la mini-gráfica de clinica-3).
   - **Última vez**: fecha, tipo(s) y nivel de la última visita.
   - **Ojo hoy**: la alerta cruzada más relevante de la valoración (anticoagulada, diabética,
     alergia), en una línea.
4. **Pie vivo**: los dos pies (el izquierdo en espejo, dedos gordos hacia dentro, como el mockup).
   Cada zona que ha tenido alguna marca se colorea por estado. **Regla de partida, pendiente de
   validar con Rosario**, en código como función pura con test, marcada en el `-done`:
   - **Activa**: la zona tiene marca en la última visita que la tocó y su gravedad no bajó respecto
     a la anterior.
   - **Mejorando**: tiene marca en la última visita que la tocó y su gravedad bajó.
   - **Curada**: tuvo marca alguna vez y **no** la tiene en la última sesión cerrada en la que se
     exploró el pie (si no se volvió a explorar, sigue en su último estado; no se da por curada por
     no mirarla).
   Al tocar una zona: su línea de evolución (cada visita que la marcó: fecha, lesión, gravedad,
   tipo de visita) y el comparador antes/hoy. **Las fotos son de clinica-4**: aquí el comparador
   enseña «Sin fotos de esta zona» y deja el hueco listo para cuando existan; no se construye subida.
   **Capa de sensibilidad**: la última exploración (monofilamento por punto, pulsos), de lectura.
5. **Visitas**: lista con el **tipo** en columna fija (128 px en el mockup), el **nivel** de la
   quiropodia como título + 3 barras, chips con los **actos** (nunca el tipo repetido), el dolor y
   la evolución. Una sesión v1 (clinica-3) sale como «Sesión» con sus tratamientos, sin tipo y sin
   fingirlo. Tocar una visita abre su detalle de solo lectura (`SesionCerrada.tsx`).
6. **Documentos**: la valoración (quién respondió: «Respondió su hija Ana» si lo hizo un
   representante) y su fecha. **Consentimientos e informe son de clinica-4**: aquí su fila aparece
   desactivada con «Llega pronto», o no aparece; elige y dilo.
7. **«Nueva visita»**: hoja con las cinco tarjetas de tipo, y **una recomendada**: la del pendiente
   si lo hay; si no, Pie de riesgo si es diabética; si no, la del último tipo. Abre la sesión de
   clinica-5 con ese tipo marcado.
8. **Sin importes en ningún sitio** de esta pantalla: es historia, no caja. El sanitario sin caja
   ve lo mismo que la dueña (regla de clinica-3).
9. **Cada apertura de la historia registra el acceso** (ClinicalAccessLog, como hoy). Que la
   pantalla nueva no sea una puerta sin registro: test.

## Alcance

### 1 · Datos (API, solo lectura)
- Un endpoint de resumen de historia por paciente (o el que ya exista, ampliado) que devuelva todo
  lo de arriba **ya calculado por funciones puras** del paquete `packages/clinica-sesion`: estado
  por zona, evolución por zona, hoy toca, última vez, dolor. La pantalla no recalcula reglas
  clínicas por su cuenta (misma razón que en clinica-5: dos cálculos = dos verdades).
- Mismo gate y mismo acceso por paciente que hoy (clinica-1). Mismo registro de acceso.
- Lee v1 y v2 mezcladas en la misma historia. Test con una historia real mezclada.

### 2 · Pantalla
- Donde hoy se abre la historia del paciente (ficha del cliente en el TPV y desde la cita), entra
  la historia viva. Pestañas Pie · Visitas · Documentos, como el mockup.
- iPad horizontal es la referencia (1180–1366 px). En móvil, apilado, sin scroll horizontal. Zonas
  táctiles ≥ 44 px (48 la casa) medidas en captura.
- Estados vacíos de verdad: paciente sin sesiones, sin valoración, sin pendientes, sin exploración.

## Lo que NO entra
- Fotos (subida, almacenamiento, comparador real), consentimientos, informe → clinica-4.
- Bonos, fisioterapia, dictado por voz, app iOS.
- Cambiar la sesión de clinica-5 (sólo se le pasa el tipo y el pendiente al abrirla).

## Cómo se da por hecho
- Suite verde en local y CI. **Tabla de sabotajes en el `-done`**, cada test visto en rojo, fichero
  de test entero (no `-t`): estado de zona (activa/mejorando/curada, y «no explorada ≠ curada»),
  hoy toca (sin pendientes, varios, el más antiguo), recomendada de «Nueva visita», v1 legible sin
  tipo, ningún importe en la respuesta, la apertura registra acceso, sanitario sin caja.
- Capturas del mockup recorrido en el producto real (1366, 1024, 390) en
  `docs/qa/2026-10-xx-clinica-6/`, con un paciente de demo con historia mezclada v1 + v2.
- `docs/blocks/clinica-6-done.md` con lo hecho, **lo pendiente de validar con Rosario** (regla de
  estado de zona sobre todo), sabotajes y «Al desplegar» (debería ser: sin migración, sin
  variables; si no, dilo).
- **Push de la rama y PR abierto: autorizados.** Ni merge ni despliegue: eso es de Dirección.
