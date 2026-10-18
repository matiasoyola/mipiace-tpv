# Bloque C — Obligaciones de gestión y catálogo de consultas

> Copia del documento del proyecto «Jardin de Gredos» (sesión 2 de la toma de requisitos, 19-08-2026),
> traída al repo el 18-10-2026 para residencia-5. **Ojo con la numeración**: las decisiones de su §5
> (D-36 a D-45) son de la numeración antigua de la sesión 2 y **no** son las D-36 a D-45 de
> `00-decisiones.md`. Si algo no cuadra, manda `00-decisiones.md`.
> Estado original: borrador para tachar. Las periodicidades marcadas *(verificar)* se cargan igual y se
> marcan para revisar.

## 1. Presupuesto de lectura (criterio de aceptación de la v1)

> **Cualquier dato de un residente en menos de 10 segundos y 3 toques.**
> **Cero preguntas sin respuesta en una auditoría.**

Le pusimos techo al coste de escribir (30 min/jornada, 15 s por registro) y ninguno al de leer. Se puede
digitalizar todo y seguir siendo imposible de encontrar.

## 2. Catálogo de consultas (las que tocan a residencia-5)

### Lo que pregunta dirección

| Consulta | Se responde con |
|---|---|
| **¿Qué hay abierto hoy en la residencia?** | Libro único de incidencias — *la métrica de éxito* |
| **¿Qué toca este día del mes?** | Calendario de obligaciones (§3) |
| ¿Vamos dentro de umbral en los indicadores? | Consulta sobre el catálogo de controles |
| ¿Qué vencimientos caducan en los próximos 60 días? | Obligaciones con periodicidad |

### Lo que pregunta quien está trabajando

| Rol | Consulta |
|---|---|
| Auxiliar | ¿Qué me queda por hacer en esta habitación? |
| Cualquiera | ¿Qué pasó en el turno anterior? |

### Indicadores de AENOR que ya salen de lo registrado (residencia-2 a -4)

| Consulta | Umbral objetivo 2026 |
|---|---|
| ¿Qué residentes llevan más de 3 días sin deposición? | 3/mes |
| ¿Todos los residentes han sido vistos por el médico este mes? | 1/mes |
| ¿Qué porcentaje participó y completó la gimnasia de mantenimiento? | 73,5 % |
| ¿Qué porcentaje asistió a estimulación cognitiva? | 58,5 % |
| ¿Cuántas actividades socioculturales ha habido este mes? | 2/mes |
| ¿Cuánto se tarda desde que surge una avería hasta que se resuelve? | <10 % más de 24 h |
| Enséñame los cambios posturales de este residente en marzo | NC interna nov-2025 |

## 3. Catálogo base de obligaciones — cinco familias

Columna **consecuencia**: `legal` (sanción o incumplimiento normativo) · `ISO` (no conformidad en
auditoría) · `interno` (coste o desorden).

### 3.1 Personal

| Obligación | Disparador | Periodicidad | Dueño | Consecuencia |
|---|---|---|---|---|
| Cuadrante de turnos | fecha | mensual | Dirección | interno |
| Nóminas | fecha | mensual | Administración | legal |
| Registro diario de jornada | fecha | diario | Todos | legal |
| Vacaciones | fecha | anual | Dirección | interno |
| Formación obligatoria (PRL · manipulador de alimentos · protección de datos) | vigencia | según certificado *(verificar)* | Dirección | legal · ISO |
| Alta y baja en Seguridad Social | hecho | al contratar / cesar | Administración | legal |

### 3.2 Dinero

| Obligación | Disparador | Periodicidad | Dueño | Consecuencia |
|---|---|---|---|---|
| Liquidación de residentes (cuota + servicios extra) | fecha | mensual | Administración | interno |
| Facturación de las plazas concertadas a la JCCM | fecha | mensual *(verificar)* | Administración | legal |
| Pago a proveedores | fecha | mensual | Administración | interno |
| Obligaciones fiscales | fecha | trimestral / anual | Gestoría | legal |

### 3.3 Compras

| Obligación | Disparador | Periodicidad | Dueño | Consecuencia |
|---|---|---|---|---|
| Pedido de alimentación | fecha | semanal *(verificar)* | Cocina | interno |
| Pedido de farmacia / SPD | fecha | semanal | DUE | interno |
| Material sanitario y lencería | fecha | mensual *(verificar)* | Dirección | interno |
| Evaluación de proveedores | fecha | anual | Calidad | ISO |

### 3.4 Cumplimiento

| Obligación | Periodicidad | Dueño | Consecuencia | Nota |
|---|---|---|---|---|
| Informes trimestrales de extintores | trimestral | Mantenimiento | legal | defecto leve CERQUO |
| Certificado anual del mantenedor PCI | anual | Mantenimiento | legal · ISO | falta el de 2026 (obs. 02) |
| Inspección OCA de baja tensión | quinquenal | Mantenimiento | legal | vigente hasta 05-11-2029 |
| Analíticas de legionela y registro de terminales revisados | según programa | Mantenimiento | legal | Sanidad 2024 |
| Verificación metrológica del termómetro | anual *(verificar)* | Calidad | ISO | NC 03 de 2025 |
| Registros APPCC diarios | diario | Cocina | legal | dos inspecciones en 2025 |
| Plan de contingencias | anual *(verificar)* | Dirección | legal | acta JCCM 2024 |
| Declaraciones periódicas a la Consejería | *(por determinar)* | Dirección | legal | H-02 |

### 3.5 Calidad

| Obligación | Disparador | Periodicidad | Dueño | Consecuencia |
|---|---|---|---|---|
| Seguimiento de los 23 indicadores | fecha | mensual | Calidad | ISO |
| Encuestas de satisfacción (entregadas y recibidas) | fecha | anual | Calidad + TO | ISO · obs. 05 |
| Revisión por la dirección | fecha | anual | Dirección | ISO |
| Auditoría interna | fecha | anual | Calidad | ISO |
| Revisión de protocolos y procedimientos | fecha | anual | Calidad | ISO |
| Revisión del PAI de cada residente | fecha + hecho | anual + disparadores | Equipo interdisciplinar | ISO |
| Evaluación del Plan de Protección de Datos | fecha | anual *(por definir)* | Mi Piace | legal · incumplida desde 2022 |
| Plan de Acciones Correctivas a AENOR | hecho | 30 días desde el informe | Dirección | ISO |
| Preparación de la auditoría de certificación | fecha | anual — próxima 20-07-2027 | Dirección + Calidad | ISO |

## 4. Obligaciones disparadas por un hecho (fuera de residencia-5)

Ingreso · baja o fallecimiento · ingreso hospitalario y vuelta · cambio de grado o plaza · alta o baja de
trabajador · accidente laboral · reclamación formal · no conformidad. Mismo motor que las de fecha, con
otra entrada; llegan con historia-1 y calidad-1.
