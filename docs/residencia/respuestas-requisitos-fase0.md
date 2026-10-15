# Fase 0 — Respuestas de la toma de requisitos

> **Copia en el repo** del documento fuente del proyecto «Jardin de Gredos» (`claude/respuestas-requisitos-fase0.md`),
> traída el 15-10-2026. Las decisiones vinculantes viven en `00-decisiones.md`; si discrepan, manda `00-decisiones.md`.

> Entrevista con **Matías Oyola** (Mi Piace), respondiendo por dirección de Jardín de Gredos.
> Sesión 1: 2026-08-15 · 42 preguntas. Sesión 2: 2026-08-19 · P43-P47.
> Método: pregunta a pregunta. Documento vivo — se amplía en cada sesión.
> **La sesión 2 abre rama propia: `rama-catalogo-de-controles.md`.**
> Fuentes cruzadas: `auditoria-aenor-2026-analisis.md`, `inventario-drive-residencia.md`, `concepto-software-residencia.md`.

---

## 0. Corrección de contexto

La residencia está en **Buenaventura (Toledo) — Castilla-La Mancha**, no Castilla y León.
Regulador autonómico: **Consejería de Bienestar Social de la JCCM**. Ya corregido en los docs del proyecto.

---

## 1. Bloque A — Dirección (cerrado)

### Dolores

- **Dolor nº 1: nada está digitalizado.** *"Cada vez que hay una auditoría, o hay que buscar cualquier dato,
  hay que mirar mil papeles."*
- Soportes actuales: **papel impreso** + **millones de archivos sin indexar en un único ordenador**.
  Punto único de fallo, sin índice y sin copia conocida.
- **No se toman decisiones con dato: se vive de la intuición.**
- *"Jardín de Gredos lleva 40 años funcionando y la operativa está muy interiorizada, pero no se puede valorar
  si es lo más eficaz del mundo: **cada tarea es un proceso nuevo en sí mismo, nada se retroalimenta**."*
- En auditoría: *"es un drama de buscar e incluso **crear** modelos de los que en teoría tenemos registrados
  en el sistema de calidad"*. El registro se reconstruye a posteriori en vez de producirse al trabajar.
- **Entre auditorías no hay gestión de no conformidades: todo se resuelve de palabra.**
- Frase clave del cliente: *"**el trabajo se hace bien, pero no queda la constancia que quieren los políticos**"*.
  → El sistema no viene a cambiar cómo cuidan; viene a **producir la evidencia sin que nadie la escriba**.

### Métrica de éxito (dirección)

> **"Tengo el control real de la residencia, en cualquier momento y en cualquier lugar."**

Aterrizada a la primera pantalla de dirección:

1. Si ha habido alguna **incidencia**.
2. **La tarea que toque ese día del mes**: horarios de personal, facturación, compras…

**Hallazgo de producto:** eso no es el registro de cuidados, es un **calendario de obligaciones de gestión**
con periodicidad. Son dos módulos distintos.

**Requisito derivado:** *no hay una pantalla de inicio, hay una por rol.*

### Modelo de plazas y pagadores

| Tipo | Quién paga | Notas |
|---|---|---|
| **PRIVADO** | 100 % el residente | cuota mensual |
| **CONCERTADO** | Mayor parte **Bienestar Social (JCCM)** con sus modelos de cálculo + el residente aporta una parte **según sus ingresos** | copago variable |
| **TEMPORAL** | Como la concertada, vía ayuda | **para recuperación, con fecha de caducidad** |

→ Una plaza puede tener **dos pagadores simultáneos**, con **copago calculado** y **vigencia con fecha fin**.

### Gobierno del proyecto

- **Deciden Matías y Claude.** Sin veto externo. *"La v1.0 la decidimos tú y yo, y como mucho aceptaremos correcciones."*
- **Acceso completo al personal** para observación de turno y validación ("tendremos todo lo que sea necesario").
- Riesgo asumido y dicho: si el diseño no pasa por las manos de quien va a pulsar la tablet, se construye a ciegas.

---

## 2. Bloque B — Calidad y operativa

### Estado actual del registro

- **El cuidado se ejecuta de memoria y se documenta después, en papel.**
- La hoja impresa vive en la **sala de terapia** (sala multiusos): punto único, lejos de la habitación.
  Cada anotación exige desplazamiento → se acumulan al final del turno.
- El control de calidad, tal y como está planteado, **es inviable de mantener a mano**.

### Tareas y frecuencias

- **Todas las tareas tienen frecuencia definida**, pero hay tareas **a demanda sin tope**:
  *"la higiene del residente, si se ha manchado se le limpia las veces que sean necesarias"*.
  → Dos naturalezas: **tarea programada** (se cumple o se incumple) y **cuidado a demanda** (solo se cuenta).
- ¿Dónde vive la frecuencia? *"Supongo que en los PAI"* → **verificado a medias**, ver §4.
- **"En hora" no se mide hoy**: solo importa que esté hecho, no se penaliza el retraso.

### Presupuesto de interacción

- Techo aceptado por dirección: **≤30 minutos por jornada de 8 h** (≈6 % del turno).
- Cuenta: ~8 residentes por auxiliar en turno de mañana × 12-15 registros ≈ 110 registros
  → **~15 s por registro, desplazamiento incluido**.
- **El toque cuesta 2 s; el desplazamiento cuesta 13.** De ahí la tablet en la puerta de cada dormitorio:
  si hay que ir a un sitio a registrar, se reproduce la sala de terapia con otro nombre.

### Reparto por rol (dicho por el cliente)

| Rol | Qué registra |
|---|---|
| **Auxiliar / gerocultor** | Cuidados personales · limpieza del dormitorio |
| **Enfermería (DUE)** | Medicación |
| **Médico** | Seguimiento de enfermedades |
| **Terapeutas (TO / fisio)** | Sus actividades diarias |

> *"Cada uno aporta la info del residente que le corresponde y **todo vive intercomunicado**."*
> → Historia única del residente alimentada por varios roles. Sin silos por departamento.

### Asignación del personal

Dimensión **configurable** — por zona, por residente, por turno u otras variables — y **no se cablea en el modelo**.
Lo que sí se fija ahora son los **roles de asignación y de control**.

### Relevo de turno *(sesión 2)*

**Existe una reunión de cambio de turno.** El sistema no crea una ceremonia nueva: alimenta la que ya hacen.
Detalle en `rama-catalogo-de-controles.md` §7.

---

## 3. Medicación

- **Cadena de tres roles: médico prescribe → DUE prepara → auxiliar administra.**
- Un cambio de pauta debe conocerse **en tiempo real**, tanto por la DUE al preparar como por la auxiliar al administrar.
  Conecta directamente con el riesgo *"errores en el tratamiento médico"* que AENOR señala como no asignado a proceso.
- Preparación **semanal** hoy; intención de migrar a **SPD con las farmacias** → entra un **actor externo** en el modelo.
- Cambio de pauta con blíster ya preparado: poco frecuente; se **reajusta la medicación en su casillero**.
  → Hay que representar el estado **"pauta cambiada / preparación desactualizada"**.
- Existen ya ~45 `FICHA DE MEDICACIÓN <apellidos>.xls` con plantilla homogénea: **el activo migrable de mayor valor**.

---

## 4. El PAI real (analizado del Drive)

Documento **O0201-0, Rev. 0, "Equipo M."**. Estructura de `MODELO PAI.doc`:

1. Datos personales (nombre, fecha de nacimiento, fecha de ingreso)
2. Firmas del **equipo interdisciplinar** + **firma del familiar responsable**
3. **Objetivo de referencia**
4. **Auxiliares / gerocultores de referencia**
5. Evaluación / resumen de problemas: antecedentes personales, quirúrgicos y
   **tratamiento actual** (fármaco + dosis + pauta tipo `1-1-0-0`)
6. **Valoración psicogeriátrica**: tres tablas (fecha · puntuación · interpretación) con
   **BARTHEL · LOBO y cols. · TINETTI · NORTON**
7. Situación actual
8. Cinco áreas — **clínica (médica) · física · funcional · cognitiva · social** — cada una con
   `OBJETIVOS / TRATAMIENTO / REVISIÓN`
9. Información del auxiliar de referencia
10. Profesional de referencia
11. Fecha de revisión

### Tres conclusiones

1. **Las escalas ya están elegidas por la casa** (Barthel, Lobo, Tinetti, Norton), con hueco para tres tomas
   sucesivas… **y están vacías**. El instrumento existe desde 2012; falta que alguien lo rellene.
   Coinciden con los indicadores que se declaran a AENOR (Barthel, UPP, desnutrición) y que hoy no tienen soporte.
2. **La frecuencia de las tareas no está estructurada**: vive en prosa dentro de `TRATAMIENTO`
   ("hidratación cutánea diaria", "toma de peso según protocolo", "analítica al ingreso, una vez al año").
   **Nadie puede generar un plan de tareas de ahí sin releerlo a mano.** Aquí es donde la plataforma aporta
   más valor: convertir el PAI en prosa en un **plan de tareas ejecutable y verificable**.
3. **Incidente de protección de datos**: `MODELO PAI.doc` **no está en blanco** — contiene datos reales de un
   residente (nombre, fecha de nacimiento, diagnósticos y tratamiento completo) y está duplicado en varias
   carpetas. Limpiarlo es urgente e independiente del proyecto.

---

## 5. Incidencias

- **Definición del cliente:** *"una caída, una fiebre, un vómito, **cualquier anomalía a un descanso normal
  del residente**"*. Definición abierta y centrada en el residente, no en el proceso.
- **La gravedad dispara el protocolo**: muchas solo dejan registro; según el grado se toman decisiones distintas.
- **Los niveles de gravedad no están definidos**: hoy lo decide la dirección caso a caso y no queda registrado.
  → Rama de trabajo propia. **Sesión 2: pasa a camino crítico** — sin gravedad no hay regla de notificación.
- *(sesión 2)* Buena parte de las incidencias **no se declaran: se derivan** de una medida que cruza umbral
  o de una ausencia prolongada de registro. Ver `rama-catalogo-de-controles.md` §6.

---

## 6. Facturación y servicios

- **Catálogo de servicios extra configurable**: cualquier servicio fuera de la cuota del residente
  (peluquería, podología, gastos extras…).
- Los consumos se **acumulan durante el periodo** y llegan a **Holded en la liquidación mensual**.
- **El residente no maneja dinero en su día a día**: todo va a la liquidación mensual.
- **El consumo lo puede anotar cualquier rol con permiso** — lo importante es que se pueda registrar
  y quede firmado por quien lo hizo.

---

## 7. Requisitos no funcionales

- **Wifi**: cobertura fiable en todas las plantas y habitaciones (según cliente).
  ⚠️ *Verificar midiendo en la visita*: edificio anterior a 1989 y la auditoría habla de deterioro estructural.
- **Disponibilidad**: *"no debería quedarse sin sistema"*. Preferencia por **cloud**; abierto a valorar
  **servidor local**, aunque no le gusta. Tercera vía propuesta: **offline-first en la tablet + sync**,
  que resuelve la caída de línea sin mantener hierro en el centro. → **ADR abierto**.
- **Identificación del profesional**: **PIN** para la v1, por simplicidad.
  Contrapartida conocida: los PINs se comparten y ahí se rompe la trazabilidad. Mitigación futura: tarjeta NFC.
- **Acceso a datos clínicos**: el auxiliar ve **solo lo accionable de su tarea**, no diagnósticos ni medicación
  completa. Justificado por RGPD (minimización) **y por eficacia** — *"no se debe distraer"*.
- *(sesión 2)* **Multi-centro desde el modelo de datos**, aunque la v1 se despliegue en uno solo.
  Añadirlo después es una migración; ponerlo ahora es una columna.

---

## 8. Decisiones tomadas

| # | Decisión |
|---|---|
| D-01 | **La plataforma es la fuente de verdad del residente. Holded queda reducido a lo financiero.** Hoy Holded tiene residentes, tarifas y documentación personal. |
| D-02 | El sistema **registra la hora desde el día uno**, pero el estado "fuera de plazo" **no se activa en el arranque**. Penalizar el día 1 mata la adopción. |
| D-03 | **Una pantalla de inicio por rol**, no una única pantalla. |
| D-04 | La **asignación de personal es configurable**; solo se fijan ahora los roles de asignación y control. |
| D-05 | Presupuesto de interacción: **≤30 min/jornada** por auxiliar; objetivo **≤15 s por registro** con desplazamiento. |
| D-06 | **Historia única del residente** alimentada por todos los roles; sin silos por departamento. |
| D-07 | **Identificación por PIN** en la v1. |
| D-08 | **Mínimo necesario en pantalla**: el auxiliar solo ve lo accionable. RGPD y eficacia apuntan al mismo sitio. |
| D-09 | **Servicios extra configurables + liquidación mensual única a Holded.** El residente no maneja dinero. |
| D-10 | **Cambio de pauta de medicación se propaga en tiempo real** a DUE y auxiliar. |
| **D-11 a D-25** | **Sesión 2 — rama del catálogo de controles.** Listadas en `rama-catalogo-de-controles.md` §11. Incluyen: el catálogo es dato y no código · registro proporcional a la anomalía · el relevo como entidad con acuse de recibo · umbrales clínicos estándar de serie · **producto multi-centro con Jardín de Gredos como cliente cero**. |

## 9. Huecos abiertos

| # | Hueco | Origen | Estado |
|---|---|---|---|
| H-01 | **Localizar el ordenador origen de los ≥100 ficheros `.lnk`**, o dar por perdidas ~30 fichas de residente de 2025. | Inventario Drive | En curso (cliente) |
| H-02 | **Tablas de la JCCM** para el cálculo de la aportación del usuario en plaza concertada y régimen de las temporales. | P16 | En curso (cliente) |
| H-03 | **Verificar si la frecuencia de tareas vive en el PAI o en los procedimientos.** | P23 | Abierto |
| H-04 | **Catálogo de tareas de gestión de dirección** con su periodicidad (personal, facturación, compras). | P14 | Abierto |
| H-05 | Qué escalas usan realmente la médica y la DUE hoy. | §4 | Abierto |
| H-06 | Ratios de personal por turno y modelo de asignación real (aparcado por el cliente). | P26 | Aparcado |
| H-07 | **Definir niveles de gravedad de incidencia** y su árbol de decisión. | P35 | **Camino crítico** |
| H-08 | Medir el wifi en planta antes de cerrar el ADR de conectividad. | P37 | Abierto |
| H-09 | **Detalle del relevo**: quién asiste, si va la DUE, por planta o de todo el centro, si queda algo escrito. | P44 | A resolver en la observación de turno |
| H-10 | **Fuente y mantenimiento del catálogo clínico estándar**: quién lo valida clínicamente y cada cuánto se revisa. | P46 | Abierto |
| H-11 | **Visibilidad para familia, control a control** — entrada del portal de familias. | Rama controles | Abierto |

## 10. Ramas aparcadas (conversaciones propias)

1. **Catálogo de controles a registrar** — capas: ejecución · observación diaria · medidas · eventos.
   El cliente marca como prioritarios los **estados de ánimo y los estados cognitivos**.
   → **En curso desde la sesión 2**: `rama-catalogo-de-controles.md`.
2. **Niveles de gravedad de incidencias** y protocolo de escalado. → **camino crítico** (H-07).
3. **Portal de familias** — qué ve y qué no. Se decide *después* de saber qué datos tenemos.
4. **Hardware y despliegue de tablets.**

## 11. Bloques de entrevista pendientes

- **Enfermería y médico** en detalle.
- **Auxiliares** — este bloque hay que hacerlo **observando un turno real**, no preguntando.
- **Contratos, altas y bajas.**
- **Retención y borrado de datos** (RGPD).

## 12. Glosario en construcción (vocabulario del cliente)

PAI · ABVD · auxiliar de referencia · objetivo de referencia · profesional de referencia · equipo interdisciplinar ·
familiar responsable · válido / semiasistido / dependiente · grado (I, II, III) · transferencias ·
cambios posturales · UPP · deposición · Barthel · Lobo y cols. · Tinetti · Norton · **casillero** (compartimento
de medicación del residente) · **SPD** · manutención · dieta enteral · plaza privada / concertada / temporal ·
registro de cesión de datos · APPCC · no conformidad · acción correctora · PAC · revisión por la dirección ·
partes interesadas · **sala de terapia** · incidencia · liquidación mensual · **relevo de turno** ·
**parte de relevo** · **línea base del residente**.

## 13. ADRs abiertos

| # | Decisión de arquitectura | Estado |
|---|---|---|
| ADR-01 | **Conectividad**: cloud puro vs servidor local vs offline-first + sync. | Abierto — depende de H-08 |
| ADR-02 | **Dónde vive la IA** y bajo qué base legal trata datos del art. 9. Incluye el tratamiento de las notas de voz (transcribir y descartar audio). | Abierto |
| ADR-03 | **Multi-tenancy**: multi-centro desde la v1 (D-25). Coste estimado +15-20 % en la v1. | **Decidido — pendiente de escribir** |
| ADR-04 | **Integración con Holded**: alcance real de la API antes de prometer facturación automática. | Abierto |
| ADR-05 | **Seguridad clínica**: cifrado, registro de accesos, retención y borrado. | Abierto |
