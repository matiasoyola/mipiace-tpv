# Bloque calidad-1 · el mapa único, los indicadores y las no conformidades

Rama `calidad-1`, worktree `~/Developer/Claude/Projects/mipiacetpv-calidad-1`, desde `origin/master`.
PR contra `master`. Escrito el 22-10-2026 desde el proyecto de Jardín de Gredos. Primer bloque de la
**Fase 1b** de `docs/residencia/09-hoja-de-ruta.md` (calidad mínima para la auditoría).

Lee antes:
1. `docs/residencia/07-calidad-iso.md` §1, §2, §3 y §9 (este bloque). §4-§8 son calidad-2: no se tocan.
2. `docs/residencia/auditoria-aenor-2026-analisis.md` §3 (NC 01), §4 (los dos mapas que no cuadran),
   §5 (catálogo de indicadores) y §8 (observaciones 04, 07 y 09).
3. `docs/blocks/residencia-5-done.md` **§9**: los seis indicadores, `indicator_targets`, «sin dato no es
   cero» y los once que se nombran. Este bloque **amplía** eso, no lo rehace.
4. `docs/blocks/residencia-4-done.md` §10: el libro único. La NC se apoya en él (D-38).
5. `docs/residencia/00-decisiones.md`: D-11, D-27/D-28, D-35, D-38, D-42, D-45, D-63.
6. `docs/residencia/registros-exigidos-inspeccion.md` R9 (si no está en el repo, el resumen va abajo).

## Por qué existe

AENOR puso en 2026 una **NC 01** porque Jardín de Gredos tiene **dos mapas de procesos** que no cuadran
(8 procesos en indicadores, 4 en riesgos) y riesgos intrínsecos de una residencia sin proceso. Y entre
auditorías las no conformidades se resuelven de palabra: el PAC se redacta en Word a los 30 días.

**Esto no es un módulo para Jardín de Gredos. Es el módulo de calidad de un producto que aspira a ser
la referencia nacional para residencias**: cualquier centro certificado en ISO 9001 (o que quiera
estarlo) tiene que poder entrar con su mapa, sus indicadores y sus NC sin una consultoría delante.
Jardín de Gredos es el cliente cero y vive **sólo en el sembrador**.

¿Y qué?: el día de la auditoría la directora no busca ni crea modelos. Abre el mapa, enseña de qué
proceso cuelga cada indicador, riesgo y NC, y saca el PAC en PDF. Y una NC no se cierra sin que alguien
haya comprobado que la acción funcionó.

## Decisiones de producto ya tomadas — no se re-debaten

Añádelas a `00-decisiones.md` como D-70 a D-76.

1. **Un solo mapa de procesos por centro, imposible de duplicar (D-70).** Entidad `Process` por
   tenant. **Todo** lo de calidad (indicador, riesgo u oportunidad, objetivo, NC) cuelga de **un**
   proceso del centro con FK `NOT NULL` y `Restrict`. No hay ninguna otra lista de procesos en ninguna
   pantalla: la NC 01 queda cerrada por construcción.
   - El producto trae un **mapa de referencia para residencias** (dato del producto, como el catálogo
     de controles): estratégicos (Dirección y planificación · Calidad y mejora), operativos
     (Admisión e ingreso · Valoración y PAI · Atención sanitaria · Cuidados y ABVD · Vida social,
     animación y terapias · Alojamiento y restauración) y de soporte (Personas · Mantenimiento e
     instalaciones · Documentación, registros y protección de datos). Separa a propósito lo que AENOR
     criticó que estuviera junto (observación 07).
   - El centro **carga el de referencia y lo adapta**: renombra, añade, desactiva (nunca borra uno con
     algo colgando). Cada proceso guarda de qué proceso de referencia viene, si viene de alguno.
   - Cada proceso tiene **responsable** (rol de cuidado, no persona: D-29/D-50) y tipo
     (estratégico/operativo/soporte).
2. **Riesgos y oportunidades por proceso (D-71).** `RiskOpportunity` con proceso, tipo (riesgo u
   oportunidad), descripción, probabilidad e impacto (1-3 cada uno; nivel = producto, con bandas
   bajo/medio/alto de serie), acción prevista y **fecha de revisión**. La revisión vencida sale en el
   panel. El producto trae de serie los cuatro riesgos que AENOR echa en falta, ya colgados de su
   proceso de referencia: errores de medicación → Atención sanitaria; intoxicación alimentaria →
   Alojamiento y restauración; datos confidenciales → Documentación y protección de datos (con la
   evaluación periódica del plan de protección de datos como obligación del calendario de
   residencia-5); salidas no controladas → Cuidados y ABVD.
3. **Indicadores: fórmula del producto, proceso y umbral del centro (D-72).** Se mantiene la frontera
   de residencia-5. Cada indicador del producto trae su **proceso de referencia**; el centro puede
   colgarlo de otro proceso suyo. Además de los seis que ya hay, entran **los que ya tienen dato hoy**,
   con la misma regla («sin dato» no es cero, el porcentaje sale del mismo cruce que el parte):
   - **Cumplimentación de los registros de atención directa por turno y por zona** (R9 de la
     inspección): ocurrencias de capa 1 que tocaban frente a hechas, de `queToca` + `loQueNoSeHizo`.
   - Caídas al mes (libro, sujeto residente, evento caída).
   - Incidencias de residente con **familia comunicada** antes de cerrar (libro + `family_communications`).
   - Quejas al mes y **quejas respondidas en plazo** (plazo de serie 15 días naturales, umbral del centro).
   - Ocupación media del mes (camas asignadas / camas).
   - RRHH (observación 04 de AENOR): **sólo** lo que ya sale de los datos de personal de mipiacetpv. Si
     rotación o absentismo no se pueden calcular con lo que hay, **se nombran en la lista de los que no
     se pintan con lo que les falta**, como residencia-5. No se inventa un dato.
   - Cada indicador enseña **de qué registros sale** y se puede abrir hasta la lista de esos registros.
4. **No conformidades con su ciclo completo (D-73).** Entidad propia `NonConformity` (no una fila
   más de `incidents`), siempre colgada de un proceso.
   - **Clase**: NC mayor · NC menor · observación · oportunidad de mejora.
   - **Origen** (enum): auditoría interna · auditoría externa · inspección · incidencia · queja ·
     indicador · revisión por la dirección · otro. Con referencia opcional al origen: una incidencia
     del libro (`incidents`, enlace que se conserva: **elevar a NC** desde la incidencia, D-38), un
     indicador y un mes, o un texto + informe adjunto (auditorías e inspecciones como entidad son
     calidad-2; aquí basta el origen y el documento).
   - **Flujo**: abierta → causa analizada (obligatoria para NC; opcional para observación y
     oportunidad) → acciones (`CorrectiveAction`: qué, responsable, plazo, evidencias) → acciones
     cerradas → **verificación de eficacia** (fecha, quién, resultado) → cerrada. Si la verificación
     dice «no eficaz», la NC **no se cierra**: vuelve a acciones con una nueva y queda el rastro.
   - **Quién**: abre y elige clase quien tenga categoría `DIRECTIVO` o el rol `CALIDAD`. La eficacia la
     verifica **una persona distinta de quien cerró la última acción** (misma idea que D-27/D-28 para
     N3/N4).
   - **Append-only como el libro**: la clase, el origen y quién la abrió no se cambian; las acciones,
     las evidencias y las verificaciones se añaden, no se editan. Textos libres **cifrados al nacer**
     (una NC puede nombrar a un residente: misma maquinaria y mismo CHECK de formato que residencia-1b).
   - **Una acción vencida** sale en el panel de dirección, con su responsable.
5. **El indicador fuera de umbral PROPONE, no crea (D-74).** Dos meses seguidos fuera de umbral → el
   panel propone «abrir NC» con el origen ya rellenado. La decide una persona. Un sistema que abre NC
   solo llena el registro de NC que nadie trabaja, y eso un auditor lo ve.
6. **El PAC sale del sistema (D-75).** PDF «Plan de acciones correctivas» filtrable por origen (p. ej.
   una auditoría externa con su fecha): por cada NC, clase, cláusula, descripción, causa, acciones,
   responsable, plazo y estado. Y un informe de NC por periodo. Cada NC y cada riesgo guarda la
   **cláusula ISO 9001:2015** a la que se refiere (texto corto opcional; de serie 4.4, 6.1, 9.1, 10.2
   donde aplique), que calidad-2 usará para el paquete de evidencias.
7. **Pantallas de despacho sin mockup previo (D-76).** Son del admin, no de la puerta ni de la sala: se
   hacen con el sistema visual y la metodología de front de Mi Piace, con bucle visual y capturas, y
   las valida Matías sobre el done. Escritorio y 390 px.

## El sembrador

`sembrar-gredos` monta el mapa de Jardín de Gredos **adaptado del de referencia**, con los 8 + 4
procesos de hoy reconducidos a uno solo (deja escrito en el done cómo quedó cada uno), los umbrales del
centro de `auditoria-aenor-2026-analisis.md` §5 en `indicator_targets`, la **NC 01 de AENOR 2026** con
su causa y dos acciones (una cerrada con evidencia, otra en plazo), una observación de la inspección de
Bienestar Social de 08-10-2026 (origen inspección) y una queja del libro elevada a NC. Todo con datos
de prueba: ningún nombre real de residente.

## Respeta

- Tenants sin residencia no notan nada (gate de residencia). Calidad cuelga de la residencia en esta
  vertical; sacarlo como módulo para otras verticales no es de este bloque.
- Los seis indicadores de residencia-5 dan exactamente lo mismo que antes (test de no regresión).
- `UserRole` no gana valores. Nada de salud en logs, tampoco en las líneas de NC.
- Suite, `e2e` y `pnpm e2e:agenda` como estaban; la CI sin Redis.
- `.ficheros-clinicos/` fuera del repo: las evidencias del sembrador no se versionan.

## Fuera de alcance (declarado)

Todo §4-§8 de `07-calidad-iso.md`: auditorías como entidad y plan anual, documentos versionados con
lectura confirmada, partes interesadas, revisión por la dirección, memoria anual de la JCCM, paquete de
evidencias, encuestas, cuadrantes y ratio de personal → **calidad-2**. Objetivos de calidad
(`QualityObjective`) entran **sólo si caben sin pantalla nueva** colgando del proceso; si no, a
calidad-2 y se dice. Los indicadores que dependen de Fase 2 siguen nombrados, no pintados.

## Cómo se cierra

- Migraciones aditivas con su `down`, aplicadas sobre una copia con datos de residencia-1 a -6.
- Tests: no hay forma de crear un indicador, riesgo o NC sin proceso; desactivar un proceso con cosas
  colgando obliga a reasignarlas; una NC no pasa a «acciones» sin causa (y una oportunidad sí); no se
  cierra sin verificación de eficacia; quien cerró la última acción no puede verificar; «no eficaz»
  reabre; elevar una incidencia conserva el enlace en los dos sentidos; el indicador de cumplimentación
  y el parte de relevo no se contradicen para el mismo turno; dos meses fuera de umbral proponen y no
  crean; el PAC en PDF lleva todas las NC del filtro y ninguna más.
- **Tabla de sabotajes**: `UPDATE` de la clase o el origen de una NC por SQL · borrar un proceso con NC ·
  texto en claro en la descripción · cerrar por SQL una NC sin verificación (¿lo para el motor o sólo la
  ruta? dilo).
- Capturas: el mapa, un proceso abierto con todo lo que le cuelga, un indicador abierto hasta sus
  registros, una NC en cada estado, la propuesta desde un indicador, el PAC.
- CI verde; `docs/blocks/calidad-1-done.md` con la estructura de la metodología (decisiones tomadas sin
  preguntar, dudas abiertas, qué hay que hacer al desplegar) y la hoja de ruta actualizada.
- Commits pequeños en español, push y **PR contra `master`**. Ni merges ni despliegues.

## Anexo · R9 de la inspección (por si el doc no está en el repo)

Acta de la JCCM del 08-10-2026: «registros de atención directa con anotaciones vacías puntuales». La
respuesta comprometió que la supervisora compruebe al final de cada turno que no quedan casillas sin
anotar. En el producto: el indicador de cumplimentación por turno y zona de la decisión 3; el aviso en
el cierre de turno ya lo da el parte de relevo de residencia-5.
