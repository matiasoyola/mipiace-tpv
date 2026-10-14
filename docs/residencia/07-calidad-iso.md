# Residencia · calidad ISO 9001, dirección y personal

Criterio de Claude con delegación de Matías (14-10-2026). Base: informe AENOR 2026
(`auditoria-aenor-2026-analisis.md`). Es el módulo que **cierra la Observación 03** (sistema
informático exigido por Bienestar Social) y la **NC 01** (dos mapas de procesos).

¿Y qué?: la auditoría del 20-07-2027 deja de ser «un drama de buscar e incluso crear modelos»: el
paquete de evidencias se exporta, y entre auditorías las no conformidades se gestionan en vez de
resolverse de palabra.

---

## 1. Un solo mapa de procesos (cierra la NC 01 por construcción)

Entidad `Process` única. De ella cuelgan **indicadores, riesgos y oportunidades, objetivos, no
conformidades, procedimientos e incidencias**. Imposible tener 8 procesos en una pantalla y 4 en otra.
Semilla: los 8 procesos con indicadores de hoy; la residencia los ajusta una vez.
Riesgos de serie asociados ya a proceso: errores de medicación, intoxicación alimentaria, datos
confidenciales, salidas no controladas (los cuatro que AENOR señala sin asociar).

## 2. Indicadores

- **Fórmula del producto, umbral del centro** (frontera estándar/centro, rama de controles §10).
- Los **23 indicadores** declarados a AENOR, calculados de los registros. La mayoría son contadores
  que la puerta genera sola (deposición > 3 días, UPP nuevas, gimnasia, estimulación cognitiva, visita
  médica mensual, PAI revisado, familias informadas, prendas extraviadas, averías en < 24 h…).
- Nuevos que AENOR pide: **RRHH** (Obs. 04: rotación, absentismo, formación en plazo) y **cocina**
  (Obs. 06).
- Cada indicador: valor del periodo, umbral, tendencia y **de qué registros sale** (se puede abrir).

## 3. No conformidades y acciones

- **Origen**: auditoría interna · AENOR · inspección (Sanidad, Bienestar Social) · incidencia recurrente
  · queja · indicador fuera de umbral.
- **Flujo**: NC → análisis de causa → acción correctora con responsable y plazo → evidencias → **verificación
  de eficacia** → cierre. El **PAC** a AENOR (30 días) se genera de aquí.
- Una incidencia del libro único puede **elevarse a NC** conservando el enlace (D-38).
- Observaciones y oportunidades de mejora con el mismo flujo, más ligero.

## 4. Auditorías e inspecciones

Registro de cada una (tipo, fecha, auditor, informe adjunto) y sus hallazgos convertidos en NC u
observaciones. Plan anual de auditorías internas (las de 2025 fueron Dirección ↔ Calidad cruzadas).

## 5. Documentación del sistema

- **Procedimientos y protocolos versionados** con **fecha de revisión obligatoria** (los protocolos
  clínicos llevan sin revisarse desde 2011). Vencido → aviso a calidad. Lectura confirmada por el
  personal afectado cuando cambia uno.
- **Partes interesadas** con necesidades y expectativas separadas (Obs. 01).
- **Plan de contingencias** (lo echó en falta la inspección de 2024) como documento versionado.
- **Plan de Protección de Datos**: evaluación con periodicidad (anual por defecto) y tarea con
  responsable. La NC 01 cita su falta de evaluación desde 2022.

## 6. Revisión por la dirección y memorias

- **Revisión por la dirección** (ISO 9.3) en borrador generado con los datos del año: indicadores,
  NC, auditorías, satisfacción, quejas, objetivos. La dirección la completa y firma.
- **Memoria técnica anual de residencias** de la JCCM (`0MODELO MEMORIA TECNICA ANUAL…`): borrador
  rellenado con los datos del sistema.
- **Paquete de evidencias para la auditoría**: exportación por proceso y por cláusula, con los registros
  de muestra que pida el auditor.

## 7. Satisfacción y quejas

Encuestas (de `04` §5) con representatividad; **quejas verbales** como incidencias tipo queja
(las 19 de 2025 no tienen registro estructurado); reclamaciones formales con su plazo de respuesta.

## 8. Dirección y personal

- **Calendario de obligaciones de dirección** (D-42): crece aquí con plantillas por periodicidad
  (cuadrantes, nóminas a la gestoría, facturación, compras, seguros, impuestos municipales…).
- **Cuadrantes de turnos** sobre `StaffShift` de mipiacetpv, con **ratio de personal de atención
  directa por turno** frente al mínimo exigible (la normativa de la JCCM se verifica antes de construir).
  Alimenta el informe de plazas y personal que Matías quiere aparte.
- **Fichaje** (`TimeEntry`), ya existente.
- **Objetivos de calidad** anuales con su meta y seguimiento (los 4 de 2026).

## 9. Entidades

`Process` · `Indicator` + `IndicatorTarget` (centro) + `IndicatorValue` · `RiskOpportunity` ·
`QualityObjective` · `NonConformity` + `CorrectiveAction` + `Evidence` · `Audit` + `AuditFinding` ·
`ControlledDocument` + `DocumentVersion` + `ReadAcknowledgement` · `InterestedParty` · `Complaint`
(en el libro único) · `ManagementReview` · `ManagementDuty` (de residencia-5).
