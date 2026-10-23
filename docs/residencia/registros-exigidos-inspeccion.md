# Residencia · registros que exige la inspección de Bienestar Social

Origen: acta de inspección de la JCCM del 08/10/2026 y respuesta registrada el 22/10/2026. Pedido por
Matías el 22/10/2026: meter en el desarrollo del software todos los registros que la inspección marca
como imprescindibles. **No cambian el orden de la hoja de ruta**: cada uno entra en el bloque al que
pertenece (columna «Inspección» de `09-hoja-de-ruta.md`).

¿Y qué?: cada fila de esta tabla es algo que un inspector autonómico **pide en una visita** y que un
centro sin sistema no puede enseñar al momento. Si el software lo genera solo, la visita se responde
con un PDF por registro y sin requerimiento (que es lo que convierte un fallo en falta grave).

**Regla de producto**: cada registro de esta lista debe poder (1) consultarse en pantalla durante la
visita y (2) **exportarse en PDF firmado** por periodo, que es el formato que exige la JCCM.

---

## 1. Registros marcados «No» en el acta (prioridad 1)

| # | Registro | Qué mira el inspector | Dónde vive en el software | Estado del diseño |
|---|---|---|---|---|
| R1 | **Sistema de gestión en formato electrónico** | Que exista | Es el producto entero | Compromiso escrito del centro cliente cero: implantación 1.er semestre 2027 |
| R2 | **Libro de incidencias** | Libro único, fechado, con contenido mínimo que indica la JCCM | Libro único (residencia-4) | Hecho. Añadir: exportación en el formato del libro diligenciado (calidad-2) |
| R3 | **Registro de quejas y reclamaciones** (incluidas las **verbales**) | Fecha, quién, contenido, respuesta, fecha de respuesta | Incidencia tipo queja en el libro único; familias (`04`) | Hecho. Asegurar «respuesta comunicada el…» y la vía; indicador de respondidas en plazo (calidad-1) |
| R4 | **Protocolo de mantenimiento de la seguridad y uso** + su registro | Protocolo aprobado y que se cumple | Mantenimiento (`06`) + obligaciones (residencia-5) | Las revisiones del protocolo como obligaciones periódicas (§3) |
| R5 | **Certificados reglamentarios vigentes** (baja tensión, gas, PCI anual, póliza) | Vigencia en el día de la visita | Obligaciones (residencia-5) / mantenimiento-1 | Añadir aviso 60 días antes y adjunto obligatorio del certificado |
| R6 | **Plan de autoprotección** (actualización cada 3 años, inscripción, formación y simulacro anual) | Fecha de modificación e inscripción | Obligaciones + documentos versionados (`07` §5) | Obligación trianual + simulacro anual con acta |

## 2. Registros de atención y funcionamiento que el acta revisa

| # | Registro | Qué falló o qué mira | Dónde vive | Qué hay que añadir o asegurar |
|---|---|---|---|---|
| R7 | **Sujeciones**: listado de residentes con sujeción, tipo, prescripción y **consentimiento específico por tipo** | No había listado; consentimientos genéricos; sujeciones añadidas sin consentimiento nuevo | historia-5 (`03` §6) | Entidad de sujeción (tipo, pauta, prescripción, consentimiento firmado, revisión). **Añadir un tipo sin prescripción y consentimiento nuevos queda bloqueado.** Listado vivo exportable. Base legal CLM: Decreto 2/2022, art. 12.6 |
| R8 | **Registro de caídas con «familia informada»** | Sin constancia de información a la familia | Libro único + comunicación a familia (residencia-4) | Hecho: no se cierra sin «comunicado» o «no comunicado: motivo» |
| R9 | **Registros de atención directa** (aseo, alimentación, líquidos, higiene, deposiciones…) | Huecos sin anotar | Puerta (residencia-3) + parte de relevo (residencia-5) | Indicador de cumplimentación por turno y zona (calidad-1) |
| R10 | **Limpieza de zonas comunes** | Solo había de habitaciones y baños | mantenimiento-1 (`06`) | Plan de limpieza por zona y frecuencia con check y firma |
| R11 | **Menú túrmix visado** por médico o nutricionista | No existía | cocina-1 (`06`) | Menú túrmix propio con visado (firma y fecha) |
| R12 | **Animación sociocultural ≥ 15 h/semana** | No llegaba | actividades-1 | Planificador semanal que suma horas y avisa por debajo de 15; asistencia por actividad |
| R13 | **Órgano de participación de residentes y de familiares** (mín. 2 reuniones/año) | El de familiares no existía | calidad-2 + familias-1 | Dos órganos con convocatoria, asistentes y acta firmada; obligación semestral |
| R14 | **Cuadrante de turnos del mes** | Se pide siempre | calidad-2 (`07` §8) | Exportación mensual firmada |
| R15 | **Listado de personal** con categoría, jornada, bajas y sustituto | Se pide siempre | calidad-2 | Listado exportable con situación y sustituto |
| R16 | **Medicación**: hoja de tratamiento con inicio y fin; coincidencia con blíster | Se revisa siempre | medicacion-1/-2 (`02`) | Diseñado. Regla «administración sin prescripción» |
| R17 | **Ventilación y humedad** | Requerida | mantenimiento-1 | Ronda diaria con check; sensores opcionales por zona |
| R18 | **Llamadores** por habitación | Avisos que no funcionan o no se oyen | mantenimiento-1 | Revisión semanal por pulsador; ronda registrada mientras haya zonas sin aviso |
| R19 | **Inventario de ropa** y ropa marcada | Se revisa | familias-2 (`04` §4) | Diseñado |
| R20 | **Expediente del residente**: contrato, PIAP con revisión anual y auxiliar de referencia, plan de acogida | Se revisa | historia-1/-2 (`03`) | **historia-1 hecho** (23-10-2026): lista del ingreso con doce elementos, contrato en PDF y panel con lo que falta. El PIAP y su revisión anual son historia-2; el elemento ya existe con su plazo corriendo |

## 3. Revisiones de un protocolo de seguridad y uso, como obligaciones periódicas (dato)

Llamadores (semanal) · camas, barandillas y somieres (mensual y en cada ingreso) · cabeceros, barras y
puntos de luz (mensual) · sumideros, inodoros, cisternas y asideros (mensual) · radiadores y ayudas
técnicas (trimestral) · mobiliario (trimestral) · señalización y alumbrado de emergencia (mensual) ·
vías de evacuación (diaria) · extintores visual (trimestral) · suelos y patio (mensual) · ventilación
(diaria) · ventanas y puertas (trimestral). Cada una con responsable, check, foto opcional y, si falla,
incidencia con plazo (riesgo para residente = mismo día; resto = 15 días).

## 4. «Paquete de inspección» (calidad-2)

Genera en PDF firmado, por periodo, R2, R3, R7, R8, R9, R10, R11, R12, R13, R14, R15 y los certificados
de R5 y R6, con índice numerado. Mismo patrón que el paquete de evidencias de AENOR (`07` §6).
