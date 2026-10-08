# Bloque clinica-5 · la sesión por tipo de visita

Rama `clinica-5-sesion-por-tipos`, worktree `~/Developer/Claude/Projects/mipiacetpv-clinica-5`, desde
`origin/master` (`cf0bd91` o el que haya). Frente C. Escrito por Dirección el 07-10-2026.

Lee antes, en este orden:
1. `docs/mockups/clinica-sesion-v2.html` — **la spec visual, validada por Matías el 07-10.** Recórrela
   entera: marca y desmarca tipos, toca zonas, actos y dolor, cambia el nivel a mano, completa pie de
   riesgo, marca «Signos de infección» y pulsa «Cerrar sesión» sin y con el «Hoy toca» hecho. Se copia
   estructura, textos y estados; no se interpreta. **Las reglas y los precios del mockup son de
   ejemplo**: las reglas de verdad están abajo.
2. `docs/mockups/clinica-historia-v2.html` — el siguiente bloque (clinica-6, historia viva). Léela para
   entender de dónde viene «Hoy toca» y qué datos tiene que dejar escritos esta sesión, pero **no la
   construyas aquí**.
3. `docs/clinica/referencia-cogecop.md` — el programa que usa hoy la clínica piloto. De ahí salen los
   tipos de visita.
4. `docs/clinica/decisiones.md` y `docs/clinica/solapes-clinica-agenda.md` **S5** (la especialidad vive en la categoría del catálogo, patrón
   `TagSection`).
5. `docs/blocks/clinica-3-done.md` y `docs/blocks/iva-exento-sanitario-done.md` — la sesión actual
   (`packages/clinica-sesion`, `SesionPodologia.tsx`, `lineas-de-la-sesion.ts`) y la exención.

## Por qué existe

La sesión de clinica-3 sirve para una quiropodia. Rosario hace cinco tipos de visita (como en
COGECOP): quiropodia, pie de riesgo, cirugía, biomecánica y general, y a veces dos en la misma visita
(revisión de la uña operada + quiropodia). Además cobra la quiropodia en tres niveles (básica 25 €,
completa 26 €, extra 27 €, mismos 30 min) y hoy elige el nivel de memoria.

¿Y qué?: Rosario marca el tipo (o los tipos), toca lo que hace y el programa (1) le deja la sesión
anotada con lo de cada tipo, (2) le propone el nivel de quiropodia y el riesgo del pie diabético sin
calcular nada, (3) le avisa en el momento si lo que va a hacer choca con una alerta, (4) no le deja
cerrar sin haber hecho lo que tocaba hoy sin preguntárselo, y (5) pasa a caja todas las líneas.

## Decisiones ya tomadas (Matías, 07-10) — no se re-debaten

1. **Una visita puede tener varios tipos.** «Se anotan y se cobran.» Cada tipo marcado añade su tarjeta
   y sus líneas a caja. Como mínimo uno.
2. **Tipos de visita = lista cerrada en código**: `QUIROPODIA`, `PIE_RIESGO`, `CIRUGIA`, `BIOMECANICA`,
   `GENERAL`, todos de la especialidad `PODOLOGIA`. Cada tipo tiene su tarjeta (abajo).
3. **El tipo se asigna a la CATEGORÍA del catálogo** (S5, patrón `TagSection`: tabla `slug → tipo`), y de
   él sale la especialidad. Los servicios lo heredan. Al abrir la sesión de una cita, vienen marcados
   los tipos de los servicios de la cita; se pueden añadir o quitar.
4. **Quiropodia en niveles, propuesto por lo hecho.** La cita se da como «Quiropodia» (las tres duran
   30 min). En la sesión, la podóloga toca los **actos** (corte de uñas, deslaminado, enucleación de
   helomas, fresado de uñas gruesas, grietas, uña encarnada leve) y el programa **propone** el nivel;
   se cambia con un toque y queda escrito si se cambió («propuesto completa, cobrado extra»). El nivel
   elegido decide **qué producto** del catálogo pasa a caja (los tres niveles son tres productos).
5. **La regla de niveles no está validada con Rosario.** Va en código, versionada, como lista de datos
   (`acto → peso` o «si incluye X → nivel N»), con un test por caso, y el `-done` lo marca como
   **pendiente de validar**. Implementa esta de partida, que es la del mockup: básica = corte y/o
   deslaminado; completa = además enucleación o grietas; extra = fresado de uña gruesa, uña encarnada o
   4 actos o más.
6. **Pie de riesgo con la clasificación IWGDF**, no la del mockup. Tres comprobaciones (sensibilidad
   con monofilamento, pulsos pedios de cada pie, úlcera previa o actual) más una cuarta que el mockup
   no tiene y la guía sí pide: **deformidad** (sí/no). Riesgo: 0 muy bajo (todo normal) → revisión
   anual; 1 bajo (pérdida de sensibilidad **o** pulsos ausentes) → cada 6–12 meses; 2 moderado (pérdida
   de sensibilidad + pulsos ausentes, o una de ellas + deformidad) → cada 3–6 meses; 3 alto (pérdida de
   sensibilidad o pulsos ausentes + úlcera previa/actual) → cada 1–3 meses. **Cita la fuente en el
   código** (IWGDF Guidelines 2023, prevención) y márcalo como pendiente de validar con Rosario. El
   riesgo **propone** la próxima cita; no la crea solo.
7. **Revisión de cirugía**: estado de la herida (cicatrizada / evoluciona bien / exudado / signos de
   infección) y puntos (retirados hoy / no lleva). Se refiere a la última cirugía de la historia (fecha,
   técnica, zona), que sale en la cabecera de la tarjeta.
8. **Biomecánica y General**, en esta versión, son una tarjeta de botones sencilla (biomecánica: tipo de
   pie, pronador/supinador, plantillas a medida; general: sólo nota y servicios). No se diseña más aquí.
9. **Alertas cruzadas con lo que se hace, en el momento**: anticoagulada + un acto que corta
   (enucleación, uña encarnada, cirugía) → «Anticoagulada: más sangrado al cortar»; diabética + signos de
   infección → «Diabética: revisa antes de 48 h y valora derivar». Tabla `alerta × acto → aviso` en
   código, con test. Las alertas son las de la valoración validada (clinica-2).
10. **«Hoy toca» y los pendientes.** La sesión escribe **«Para la próxima visita»**: botones (revisar la
    uña operada, retirar puntos, revisar plantillas, control de pie de riesgo, otro con nota) y la
    zona si aplica. En la siguiente sesión sale arriba como «Hoy toca» y se marca hecho **solo** al
    tocar esa zona o valorar esa herida, o a mano. **Al cerrar con un pendiente sin hacer, pregunta**
    («¿Has revisado la uña operada?»: Sí, revisada / Todavía no). Lo que no se hizo pasa a la siguiente.
    Sin tabla nueva: los pendientes viven en el cuerpo de la sesión que los crea y la que los cierra
    los nombra.
11. **Caja**: «Pasa a caja: Quiropodia completa · 26 € + Cura · 13 € = 39 €». Un tipo sin servicio
    propio (pie de riesgo, revisión) se cobra con el servicio que el centro le asigne en su categoría;
    si no hay ninguno, la línea no sale y se ve «sin cobro». El sanitario sin caja **no ve importes**
    (regla de clinica-3), sólo los nombres.

## Alcance

### 1 · Datos
- Tabla `tag_visit_types` (o columna en la existente que mejor encaje), patrón `TagSection`:
  `tenantId + slug → tipo`. Un servicio con dos tipos distintos por sus etiquetas **no se guarda**
  (motivo legible). En un centro clínico, un servicio marcado `tratamientoSesion` sin tipo tampoco (S5).
- Cuerpo de sesión **v2** en `packages/clinica-sesion`: `tipos[]`, por tipo su bloque (actos y nivel
  propuesto/elegido; pie de riesgo: sensibilidad, pulsos, úlcera, deformidad y riesgo calculado;
  cirugía: herida y puntos; biomecánica: botones), `pendientesCreados[]`, `pendientesCerrados[]`,
  `especialidad` congelada (S5). **Las sesiones v1 se siguen leyendo** igual que hoy: test con una v1
  real de clinica-3.
- Las funciones puras nuevas (nivel, riesgo, alertas cruzadas, pendientes) en el paquete, con tests
  que se ponen rojos al romperlas.

### 2 · Pantalla
- `SesionPodologia.tsx` pasa a ser la sesión por tipos del mockup: chips de tipo multiselección, banda
  «Hoy toca», pie fijo a la izquierda (con capa de sensibilidad si hay pie de riesgo), tarjetas
  apiladas a la derecha, dolor y evolución, barra de caja y diálogo de pendiente.
- iPad horizontal es la referencia (1180–1366 px). En móvil, apilado, sin scroll horizontal. Zonas
  táctiles ≥ 44 px medidas en captura.

### 3 · Caja
- `lineas-de-la-sesion.ts` devuelve las líneas de **todos** los tipos: para quiropodia, el producto del
  nivel elegido; para el resto, los servicios tocados. Mismo camino de cobro de siempre (sin rama
  paralela). La exención (iva-exento) la heredan del producto.

## Lo que NO entra
- Historia viva (resumen, pie vivo, comparador de fotos) → clinica-6.
- Fotos, consentimientos e informe → clinica-4.
- Bonos (B-reservas-8), dictado por voz, fisioterapia.

## Cómo se da por hecho
- Suite verde en local y CI. **Tabla de sabotajes en el `-done`**: nivel (cambiar un umbral), riesgo
  (cada categoría IWGDF), alerta cruzada, pendiente que no se cierra, sesión v1 legible, servicio con
  dos tipos rechazado, líneas a caja de dos tipos. Cada test visto en rojo.
- Capturas del mockup recorrido en el producto real (1366, 1024, 390) en
  `docs/qa/2026-10-xx-clinica-5/`.
- `docs/blocks/clinica-5-done.md` con lo hecho, lo **pendiente de validar con Rosario** (regla de
  niveles, criterio de riesgo, servicio de cobro de pie de riesgo y de la revisión), sabotajes y «Al
  desplegar» (migración; variables de entorno sólo si las añades, y dilo).
- **Push de la rama y PR abierto: autorizados.** Ni merge ni despliegue: eso es de Dirección.
