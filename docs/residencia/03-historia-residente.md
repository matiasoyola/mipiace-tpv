# Residencia · historia del residente (Fase 2)

Ficha clínica, PAI, escalas, lesiones, ausencias, sujeciones, ingreso y alta. Criterio de Claude con
delegación de Matías (14-10-2026). Todo lo de aquí hereda las garantías clínicas de mipiacetpv
(inmutable, no se borra, acceso por función única, todo acceso registrado: D-45).

¿Y qué?: el PAI deja de ser un Word con control de cambios de hace dos años (Obs. 08 de AENOR) y se
convierte en el plan que genera las tareas de la puerta; los indicadores de Barthel, UPP y
desnutrición que hoy se declaran sin papel detrás pasan a salir de registros reales.

---

## 1. Ficha clínica base

Lo que hoy está repartido en `FICHA DE RESIDENTES`, el PAI y la cabeza de la DUE:

- **Diagnósticos** activos y resueltos (texto + fecha + quién), antecedentes médicos y quirúrgicos.
- **Alergias e intolerancias** (medicamentosas, alimentarias, otras). Bloquean en medicación (`02`).
- **Dispositivos y ayudas**: silla de ruedas, andador, grúa, sonda, oxígeno, absorbentes, audífono,
  prótesis dental, gafas.
- **Dieta y textura**: normal · blanda · triturada · enteral; espesante (sí/no, nivel); restricciones
  (diabética, sin sal, sin gluten…). Alimenta la hoja de cocina (`06`).
- **Especialistas externos** y tarjeta sanitaria.
- **Franja de alertas**: lo marcado como riesgo (alergia grave, anticoagulado, riesgo de caída alto,
  disfagia, fuga) sale arriba en la historia. **En la puerta sólo lo accionable**: «disfagia —
  triturado y espesante», no el diagnóstico.

Cada dato con autor y fecha; corregir = nueva versión, no sobrescribir.

## 2. El PAI, versionado

- Estructura **la de la casa** (`MODELO PAI.doc`, O0201-0): objetivo de referencia, auxiliar y
  profesional de referencia, situación actual, **cinco áreas** (clínica · física · funcional ·
  cognitiva · social) con objetivos / tratamiento / revisión, fecha de revisión.
- **Versiones**: cada revisión es una versión nueva con fecha y firmas. La anterior se conserva intacta.
- **Firmas**: equipo interdisciplinar (con su PIN y capacidad) y **familiar responsable** (firma con el
  dedo → PDF, reutilizando `ClientConsent` / `packages/consentimientos`).
- **Del PAI al plan**: cada línea de «tratamiento» se enlaza a elementos del plan de cuidados
  (`CarePlanItem`) — p. ej. «hidratación cutánea diaria» → control de capa 1 diario en turno de mañana.
  **El PAI deja de ser prosa que alguien relee: el plan es su parte ejecutable.** (Cierra H-03.)
- **Revisión obligatoria**: anual como mínimo (indicador de AENOR) y **disparada** por: vuelta de un
  ingreso hospitalario, incidencia N3, caída en Barthel ≥ 15 puntos, cambio de grado de dependencia.
  El disparo crea una tarea de revisión con plazo para el profesional de referencia.
- **Comunicación a la familia** del PAI y su seguimiento: se registra (comunicado / no comunicado, D-34).
  Alimenta el indicador «familias informadas del PAI al mes» y cierra la Obs. 10.

## 3. Escalas validadas (capa 3b)

- **Barthel · Lobo (MEC) · Tinetti · Norton** (D-55), sobre el patrón de `ClinicalAssessment` de
  clinica-2: cuestionario **versionado en código** con su baremo, puntuación e interpretación
  calculadas, correcciones con autor.
- Pantalla de una pregunta por toque, la pasa el profesional autorizado (TO, DUE, médico, fisio).
- **Periodicidad por defecto**: al ingreso, en cada revisión del PAI y cada 6 meses; **Norton cada 3
  meses** y tras cualquier pérdida de movilidad. Todo configurable por residente.
- Gráfica de evolución por escala. Indicadores: % de semiasistidos que varían su Barthel; % que
  mantiene o mejora cognición (objetivo de calidad 2026 nº 3).
- Norton alto → riesgo de UPP en la franja de alertas y **cambios posturales** propuestos en el plan.

## 4. Lesiones (`Lesión`, D-24)

Objeto que vive semanas, no una observación del día.

- **Tipo**: UPP (categoría I-IV), herida, úlcera vascular, quemadura, lesión cutánea por humedad,
  infección cutánea.
- **Localización** en un **mapa corporal** (anterior / posterior), mismo patrón que el mapa del pie de
  clinica-3.
- **Origen**: aparecida en el centro · traída del hospital · presente al ingreso. *(Es lo que separa
  una «UPP nueva al mes» de AENOR de una que llegó de fuera.)*
- **Pauta de curas** (frecuencia, material) → genera tareas de la DUE en la puerta.
- **Seguimiento**: cada cura con estado (mejor / igual / peor), tamaño opcional y **foto** por zona con
  `ClinicalPhoto` (nunca en la galería).
- **Cierre**: cicatrizada, con fecha. La auxiliar que ve algo nuevo en la piel marca «piel» en la
  observación; **la lesión la abre la DUE**.

## 5. Ausencias

Hoy viven en la cabeza del personal y en los días de la factura de la Junta.

- **Tipos**: ingreso hospitalario · urgencias · vacaciones / salida con familia · consulta externa.
- Mientras dura: **se pausan** las tareas del plan y las tomas (no salen como omitidas).
- **Cuenta los días** (ordinarios / hospital / vacaciones) → es exactamente el dato que hoy se teclea a
  mano en `meses/AAAA-MM.json` para facturar las concertadas (`05`).
- **Al volver de un ingreso**: tareas automáticas de **conciliación de medicación** con el informe de
  alta y de **revisión del PAI**.
- **Salida no controlada** (no localizado): evento N4. Cierra otro riesgo sin asociar de la NC 01.

## 6. Sujeciones

Medida restrictiva: necesita **prescripción médica** (tipo, motivo, horario, duración),
**consentimiento** del residente o familiar (`Consentimiento sujeciones.docx` pasa a plantilla firmada),
**registro de colocación y retirada** en la puerta y **revisión periódica** con fecha de caducidad.
Sujeción vencida sin revisar → aviso a médico y dirección. *(La normativa autonómica concreta se
verifica antes de construir el bloque.)*

## 7. Ingreso y alta

- **Ingreso guiado**: datos, cama, contrato, consentimientos (tratamiento de datos, imagen, cesión de
  datos, sujeciones si aplica), ficha clínica, escalas iniciales y **PAI inicial con plazo** (30 días
  por defecto). Una lista que se ve completa o pendiente en el panel de dirección.
  *(Hoy hay 0 consentimientos individuales de datos en el Drive: el ingreso guiado lo resuelve hacia delante.)*
- **Alta**: traslado, voluntaria, fallecimiento. Cierra plan, tomas y cama; **la historia se conserva**
  (≥5 años, Ley 41/2002). Genera la comunicación de baja a la Junta si la plaza es concertada (`05`).

## 8. Entidades

`ResidentDiagnosis` · `Allergy` · `ResidentDevice` · `DietProfile` (versionado) · `CarePlanVersion` (PAI:
áreas, objetivos, firmas, enlaces a `CarePlanItem`) · `CarePlanReviewTrigger` ·
`ClinicalAssessment` (reutilizado, nuevos cuestionarios) · `Lesion` + `LesionCare` + `ClinicalPhoto`
(reutilizado) · `ResidentAbsence` · `Restraint` + `RestraintEvent` · `AdmissionChecklist` ·
`ClinicalEntry` (reutilizado: notas de evolución médica y de enfermería, visita médica mensual).
