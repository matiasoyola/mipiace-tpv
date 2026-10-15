# Auditoría AENOR 2026 — extracto y lectura para el proyecto

> **Copia en el repo** del documento fuente del proyecto «Jardin de Gredos» (`claude/auditoria-aenor-2026-analisis.md`),
> traída el 15-10-2026. Las decisiones vinculantes viven en `00-decisiones.md`; si discrepan, manda `00-decisiones.md`.

> Fuente: **Informe de Auditoría AENOR nº 24, 1er Seguimiento (AS1)**, UNE-EN ISO 9001:2015.
> Jardin de Gredos, S.A. · Auditoría 2026-07-21 · Auditor jefe: Miguel de la Fuente Pastrana.
> Proyecto de certificación 2003/1571/ER/01 · Certificado expira **2028-03-18** · Próxima auditoría **2027-07-20**.
> Documento de trabajo Fase 0. Analizado: 2026-08-15.

---

## 0. Por qué este documento es el hallazgo más importante de la Fase 0

El informe **no es solo contexto: es el pliego de requisitos que el cliente ya tiene escrito por un tercero.**
Contiene el mapa de procesos, el catálogo de indicadores con umbrales, los registros que fallan,
las partes interesadas y — literalmente — **la exigencia regulatoria de un sistema informático**.

---

## 1. Correcciones a los documentos previos del proyecto

| Dato | Lo que decían nuestros docs | Realidad según auditoría |
|---|---|---|
| Comunidad autónoma | Castilla y León | **Castilla-La Mancha (Toledo)** — Buenaventura, 45634 |
| Regulador autonómico | Junta de Castilla y León | **JCCM — Consejería de Bienestar Social** |
| Plazas | 49 | **49 autorizadas históricamente; en 2026 son 48 autorizadas, 48 ocupadas (lleno)** |
| Tipo de plaza | sin detalle | **19 concertadas con Bienestar Social**, resto privadas |

Domicilio: Urbanización Buen Suceso, s/n, CR Talavera-Buenaventura km 30,500 · 45634 Buenaventura (Toledo). CIF A45080173.
Licencia municipal de apertura: 18-08-1989. Autorización como "Residencia de Tercera Edad": 01-10-1997. Edificio anterior a 1989.
Plantilla: **21 personas propias, 0 subcontratadas.**

## 2. El driver regulatorio: ya les exigen un sistema informático

> **Observación 03 (repetida de años anteriores):** «El requisito de **SISTEMA INFORMÁTICO** que solicita
> la PARTE INTERESADA de **CONSEJERÍA DE BIENESTAR SOCIAL** no está identificada ni se han planificado
> acciones para su cumplimiento.» *(Nota 2026: ya se ha identificado el RIESGO, pero sigue sin abrirse Acción / Objetivo.)*

Y en la tabla de riesgos por proceso:

> **CALIDAD — riesgo: «No se dispone de programa informatizado» → Documentación.**

Y en la declaración de conformidad del sistema:

> «El Sistema es de **PAPEL** y el requisito de SISTEMA INFORMÁTICO que solicita la PARTE INTERESADA
> de CONSEJERÍA DE BIENESTAR SOCIAL ya está identificado como RIESGO, pero no se han planificado acciones
> para su cumplimiento.»

**Lectura de negocio:** el proyecto no es un "nice to have". Es la **acción correctora pendiente** de una
observación que AENOR repite auditoría tras auditoría. Argumento de venta y de urgencia: implantar la
plataforma cierra la observación 03 y el riesgo del proceso CALIDAD antes de la auditoría de **julio 2027**.

## 3. No conformidad abierta en 2026 (única, menor)

**NC 01 — apartado 4.4.1, categoría menor.** Evolución de la NC 01 de 2025 y de la Observación 08 de 2025.

- La organización no presenta evidencia de una **única determinación de sus procesos**:
  en Indicadores hay **8 procesos** y en Riesgos y Oportunidades hay **4**.
- Siguen **sin asociarse a proceso riesgos intrínsecos** de una residencia:
  - errores en el **tratamiento médico**
  - **intoxicaciones alimentarias**
  - **datos confidenciales** (*no está definida la frecuencia de evaluación del Plan de Protección de Datos por **Mi Piace**, última evaluación 20-11-2022*)
  - **salidas no controladas**

> Nota Mi Piace: la NC nos menciona directamente. El Plan de Protección de Datos lo implantó Mi Piace
> (20-05-2022, revisión prevista 20-11-2022) y **lleva sin evaluarse desde entonces**. Acción inmediata,
> independiente del software, y encaja con la asesoría RGPD ya contratada.

Plazo formal: Plan de Acciones Correctivas (PAC) a AENOR en **30 días naturales** desde emisión del informe.

## 4. Los dos mapas de procesos que no cuadran (raíz de la NC 01)

**8 procesos con indicadores:**
DIRECCIÓN · INFORMACIÓN PRELIMINAR · ATENCIÓN GERIÁTRICA · ABVD · LIMPIEZA Y MANTENIMIENTO ·
DOCUMENTACIÓN Y REGISTRO · VALORACIÓN FUNCIONAL Y PAI · MEDICIÓN Y MEJORA

**4 procesos con riesgos y oportunidades:**
DIRECCIÓN-RRHH · CALIDAD · PRESTACIÓN DE SERVICIOS · MANTENIMIENTO

**Implicación de diseño:** el modelo de datos debe tener una entidad `Proceso` **única** de la que cuelguen
indicadores, riesgos, objetivos y no conformidades. Modelarlo bien **cierra la NC 01 por construcción**.

## 5. Catálogo de indicadores ISO con umbrales (entrada directa al modelo de datos)

| Proceso | Umbral | Indicador |
|---|---|---|
| DIRECCIÓN | 1/mes | Incidencias con proveedores |
| INFORMACIÓN PRELIMINAR | 44/48 | Nº de residentes que permanecen en la residencia mes a mes |
| INFORMACIÓN PRELIMINAR | 2 personas | Nº de personas que piden información, visitan el centro y se quedan ingresadas |
| ATENCIÓN GERIÁTRICA | 73,5 % | % residentes que participan activamente y completan la gimnasia de mantenimiento |
| ATENCIÓN GERIÁTRICA | 58,5 % | % residentes que asisten al programa de estimulación cognitiva |
| ATENCIÓN GERIÁTRICA | 50 % | % residentes semidependientes que varían su **índice de Barthel** |
| ATENCIÓN GERIÁTRICA | 2/mes | Nº actividades socio-culturales al mes con fiesta |
| ATENCIÓN GERIÁTRICA | 1/mes | Todos los residentes vistos 1 vez/mes por el médico |
| ATENCIÓN GERIÁTRICA | 3/mes | Nº infecciones en la piel |
| ATENCIÓN GERIÁTRICA | 1/mes | **UPP** (úlceras por presión) nuevas al mes |
| ATENCIÓN GERIÁTRICA | 1/mes | Residentes con desnutrición |
| ATENCIÓN GERIÁTRICA | 1/6 meses | Nº actividades socioculturales nuevas realizadas |
| ABVD | 3/mes | Nº de prendas extraviadas al mes |
| ABVD | 3/mes | Nº residentes que no hacen **deposición** en periodo superior a 3 días |
| LIMPIEZA Y MANTENIMIENTO | <10 % | Nº revisiones periódicas realizadas en el periodo establecido |
| LIMPIEZA Y MANTENIMIENTO | <10 % +24 h | Tiempo desde que surge la avería hasta que se soluciona |
| LIMPIEZA Y MANTENIMIENTO | 1/mes | Nº limpiezas extraordinarias al mes |
| DOCUMENTACIÓN Y REGISTRO | 1 al mes | Revisión anual de protocolo y procedimiento |
| VALORACIÓN FUNCIONAL Y PAI | Todos/mes | Residentes con **PAI** revisado una vez al año |
| MEDICIÓN Y MEJORA | 4 al mes | Nº de familias informadas del PAI al mes |
| ABVD | 1 semana | Nº residentes que participan en la comunidad |
| ABVD | 25 % semiasistidos | Aumentar nº de semiasistidos que participan en las transferencias |
| ABVD | 50 % | Disminuir el sedentarismo propio de la senectud |

**Casi todos son contadores de eventos que la tablet de puerta genera sola.** Es la prueba de que la tesis
del producto (el registro como subproducto de la operativa) aplica literalmente aquí.

## 6. Objetivos de calidad 2026 (fijados por la dirección)

1. Aumentar la participación de los usuarios en la comunidad (54 % de residentes válidos acudan a actividades fuera del centro).
2. Aumentar el nº de residentes semiasistidos que participan en las transferencias (25 % puedan hacerlas de forma independiente).
3. Mejorar capacidades cognitivas mediante programas individuales/colectivas (25 % mantenga o mejore puntuación en las escalas).
4. Disminuir el sedentarismo propio de la senectud (54 % de independientes y semiasistidos participen).

## 7. Auditorías internas 2025 — 12 no conformidades, casi todas de registro operativo

**Octubre 2025 (Dirección → Calidad):**
Ropa guardada pero no colocada · Grúa no funciona · **Comida planificada se cambia y no se registra** ·
Fisio no está haciendo el Taller de Rehabilitación Grupal.

**Noviembre 2025 (Calidad → Dirección):**
Desorden en una habitación · Mesa con tablero suelto · **Registros diarios de FISIO faltan** ·
**Falta Hoja de Cambios Posturales de AUXILIARES** · **Falta deposición de un residente no comunicada a AUXILIARES** ·
Falta delantal en COCINERA.

**Lectura:** 4 de 12 NC internas son exactamente **"el registro no existe o no se comunicó"**.
Son los casos de uso del MVP: cambios posturales, deposiciones, registro diario de fisio, cambios de menú.

## 8. Observaciones abiertas (10) — las que tocan al software

| Nº | Observación | Impacto en el sistema |
|---|---|---|
| 01 | Debería diferenciarse necesidades vs. expectativas de partes interesadas | Modelo: `ParteInteresada` con necesidad/expectativa separadas |
| 02 | CINSA: último certificado anual de junio 2024, no han mandado el informe anual | Módulo de **mantenimiento y vencimientos** con alertas |
| 03 | **Sistema informático exigido por Bienestar Social sin acción planificada** | **Es este proyecto** |
| 04 | El único indicador de DIRECCIÓN ("incidencias con proveedores") no mide a RRHH | Faltan indicadores de RRHH |
| 05 | Se contabilizan encuestas recibidas pero no las entregadas; falta valor de representatividad | Módulo de **encuestas** con entregadas/recibidas y umbral |
| 06 | Hay indicadores trazables de alojamiento y manutención, pero **ninguno asociado a COCINA** | Falta indicador de cocina |
| 07 | El proceso único de PRESTACIÓN DEL SERVICIO junta actividades muy diversas | Refuerza rediseño del mapa de procesos |
| 08 | PAI de AFV en Word con control de cambios de 2025 habiendo actualizaciones de 2026 | **Versionado del PAI** — el sistema lo resuelve solo |
| 09 | Lo menos valorado en encuestas son las INSTALACIONES, años seguidos, sin acción abierta | Ciclo acción correctora |
| 10 | **No hay formato donde registrar las comunicaciones verbales a FAMILIA/RESIDENTE del seguimiento del PAI** | Caso de uso claro: **registro de comunicación a familia** |

## 9. Satisfacción, quejas y reclamaciones

- Encuestas **en papel**, repartidas con ayuda de la TO. Cierre 2025: **30/30 residentes y 17/17 familiares**.
- Más valorado siempre: **PERSONAL** (86,5 % residentes / 85,35 % familiares).
- Menos valorado siempre: **INSTALACIONES** (80 % / 80,5 %) — se repite año tras año.
- Reclamaciones formales: **0**. Quejas verbales 2025: **19**
  - 11 de familiares: **ropa** y **fisioterapia**
  - 8 de residentes: **falta de atención de auxiliares y enfermera**

**Punto fuerte reconocido por AENOR:** existe la figura de **"Auxiliar de Referencia"** por residente.
Vocabulario del cliente → entidad del modelo.

## 10. Inspecciones de la administración (además de ISO)

- **Bienestar Social (JCCM):** denuncia 17-01-2024 → requerimiento de documentación en 10 días (respondido el 30-01-2024).
  Acta de inspección 7-02-2024 con incidencias de infraestructuras, falta de documentación y del **plan de contingencias**.
  Sin nuevas inspecciones en el resto de 2024, 2025 ni 2026.
- **Sanidad — APPCC y Legionela:** visita 30-09-2024. Observaciones: *no se apuntan claramente los terminales que se revisan*,
  *faltaban analíticas de agua*. Plataforma NABLA para analíticas de legionela.
- **Inspección de COCINA 11-02-2025:** no se registra el control sobre materias primas refrigeradas;
  **no se registran los cambios de aceite**; limpieza a mejorar.
- **Inspección de COCINA 09-10-2025:** cambios en APPCC.

**Lectura:** hay un **segundo eje de cumplimiento** (APPCC, legionela, baja tensión, PCI) con registros y
vencimientos propios que hoy también viven en papel. Candidato natural a módulo, y refuerza el argumento
de que la plataforma no es solo ISO.

## 11. Mantenimiento reglamentario y vencimientos (datos duros)

| Elemento | Estado | Vigencia |
|---|---|---|
| Protección contra incendios (CERQUO, 29-10-2024) | Favorable con defectos leves (cartelería, informes trimestrales de extintores) | hasta 29-10-2034 |
| Mantenedor PCI (CINSA, autorización 06-04-2021) | ISO 9001 propio vigente | hasta 2028 · **falta informe anual 2026** |
| Baja tensión (OCA, 08-11-2024) | Favorable sin defectos | hasta 05-11-2029 |
| Legionela (NABLA) | Plataforma con resultados de analíticas | — |
| Termómetro TESTO 735 + sonda | Verificación metrológica por NABLA, desviación <1 ºC | NC 03 de 2025 cerrada |

## 12. Personas y roles reales (interlocutores para la Fase 0)

| Persona | Rol |
|---|---|
| José Oyola Álvarez | Propietario |
| **Carmen Oyola Sánchez** | **Directora** (representante de la organización ante AENOR) |
| Ana Isabel Barco Casasola | **Terapia Ocupacional + Calidad** (y contacto de facturación) |
| Inmaculada Durán Arce | **DUE** (enfermería) — interlocutora en toda la auditoría |
| Jackeline Vásquez Michel | Médico |
| Rosa Domínguez Martín | Cocina |
| Jorge Benítez Gutiérrez | Mantenimiento |

Contacto centro: 925 597 137 · jardindegredos@gmail.com

## 13. Vocabulario del cliente (glosario en bruto, tal cual lo usan)

PAI · ABVD · Auxiliar de Referencia · residente **válido / semiasistido / dependiente** · **grado** (I, II, III) ·
**transferencias** · **cambios posturales** · **UPP** · **deposición** · **índice de Barthel** ·
escalas cognitivas · estimulación cognitiva · gimnasia de mantenimiento · Taller de Rehabilitación Grupal ·
manutención · dieta enteral · **plaza privada / plaza concertada** · **registro de cesión de datos** ·
APPCC · no conformidad · acción correctora · PAC · revisión por la dirección · partes interesadas.

## 14. Datos clínicos reales vistos en el muestreo (nivel de detalle que el sistema deberá soportar)

Muestreo de 2 residentes en la auditoría. Contenido manejado por residente:
fecha de ingreso, contrato, **registro de cesión de datos** (fechado), grado de dependencia,
diagnósticos (hemiplejia por trombo, arritmia ventricular, hipertensión, deterioro cognitivo),
tratamiento farmacológico (p. ej. **Sintrom**), dispositivos (silla de ruedas, sonda nasogástrica),
dieta (enteral, batidos de complemento), especialistas externos y traslado de tarjeta sanitaria,
situación familiar, y **PAI fechado y versionado** (uno de 10-06-2026, otro de 17-05-2026 pendiente de revisar tras ingreso hospitalario).

Confirma: **categoría especial de datos (RGPD art. 9)** desde el día uno, y **PAI como entidad versionada**
con disparadores de revisión (ingreso hospitalario, cambio de situación).

## 15. Qué se lleva la Fase 0 de aquí

**Requisitos que ya podemos dar por elicitados (a validar, no a preguntar de cero):**

1. Mapa de procesos único (cierra NC 01) con procesos, riesgos, indicadores y objetivos colgando de él.
2. Catálogo de 23 indicadores con umbral y periodicidad (§5).
3. Registros diarios que hoy fallan: cambios posturales, deposiciones, registro de fisio, cambios de menú.
4. PAI versionado, con revisión anual obligatoria y disparadores de revisión.
5. Registro de comunicación a familia del seguimiento del PAI (observación 10).
6. Encuestas de satisfacción: entregadas vs. recibidas, representatividad, series anuales.
7. Quejas verbales: hoy no hay canal formal; 19 en 2025 sin registro estructurado.
8. Gestión de no conformidades y acciones correctivas (internas + AENOR) con PAC y evidencias.
9. Vencimientos de mantenimiento reglamentario y APPCC con alertas.
10. Plazas: 48 autorizadas, 19 concertadas con JCCM → facturación distinta por tipo de plaza.

**ADRs que este documento añade:**

- ¿El sistema cubre **solo ISO/operativa** o también el eje **APPCC + reglamentario**? (alcance v1)
- ¿La plataforma debe poder **exportar el paquete de evidencias de auditoría** en el formato que AENOR pide?
- Frecuencia de evaluación del **Plan de Protección de Datos** (obligación ya incumplida desde 2022).

**Riesgo/oportunidad de calendario:** próxima auditoría **20-07-2027**. Un MVP en producción antes de esa
fecha convierte la observación 03 en acción cerrada con evidencia. Es la métrica de éxito más defendible
que se le puede ofrecer a dirección.
