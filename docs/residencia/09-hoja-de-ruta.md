# Residencia · hoja de ruta completa

Criterio de Claude con delegación de Matías (14-10-2026). Cada bloque sigue la metodología de
mipiacetpv (prompt en `docs/code-prompts/`, rama y worktree propios, done-doc, PR; merges y despliegues
los hace Dirección). Cada bloque con pantallas lleva mockup antes.

**Fecha que ordena todo: auditoría AENOR del 20-07-2027.** Para entonces tienen que estar en
producción, con meses de datos detrás, la v1 y el mínimo de calidad. Por eso calidad va **antes** que
la medicación completa.

---

## Mapa de documentos

| Doc | Módulo |
|---|---|
| `00-decisiones.md` | Decisiones D-01 a D-60 y v1 |
| `01-modelo-datos.md` | Modelo de la v1 sobre mipiacetpv |
| `02-medicacion.md` | Medicación |
| `03-historia-residente.md` | Ficha clínica, PAI, escalas, lesiones, ausencias, sujeciones, ingreso y alta |
| `04-familias.md` | Portal, comunicación, ropa, encuestas |
| `05-plazas-facturacion.md` | Plazas, concesiones JCCM, liquidación, Verifactu, cobros |
| `06-cocina-appcc-mantenimiento.md` | Cocina, APPCC, legionela, mantenimiento, formación |
| `07-calidad-iso.md` | Procesos, indicadores, NC, auditorías, documentos, dirección y personal |
| `08-ia.md` | Capa de IA |

## Fases y bloques

### Fase 1 · v1: la habitación y la dirección — objetivo: en planta en febrero 2027

| Bloque | Contenido | Depende de |
|---|---|---|
| residencia-1 | Cimientos: residentes, edificio, roles de cuidado, zonas, turnos, dispositivo de puerta | — (**lanzado**) |
| residencia-2 | Catálogo de controles como dato + plan de cuidados | 1 |
| *(mockup + observación de turno)* | Pantalla de puerta validada con auxiliares | 2 |
| residencia-3 | La puerta: PIN, residente, lo que toca, «como siempre», registro offline | 2 + mockup |
| residencia-4 | Constantes, umbrales, eventos derivados, libro de incidencias, comunicación a familia | 3 |
| residencia-5 | Relevo con acuse, panel de dirección, obligaciones del mes | 4 |
| *(piloto)* | Una planta, 4-6 tablets, dos semanas; luego todo el centro | 5 |

### Fase 1b · calidad mínima para la auditoría — objetivo: abril 2027

| Bloque | Contenido |
|---|---|
| calidad-1 | Mapa de procesos único, indicadores calculados, NC y acciones con PAC |
| calidad-2 | Documentos versionados con revisión obligatoria, auditorías, paquete de evidencias, revisión por la dirección |

### Fase 2 · historia clínica y medicación — objetivo: verano 2027

| Bloque | Contenido |
|---|---|
| historia-1 | Ficha clínica (diagnósticos, alergias, dispositivos, dieta), **ausencias**, ingreso guiado y alta |
| historia-2 | PAI versionado, firmas, enlace PAI → plan, revisiones disparadas |
| historia-3 | Escalas Barthel, Lobo, Tinetti, Norton |
| historia-4 | Lesiones con mapa corporal, curas y fotos |
| medicacion-1 | Catálogo, prescripción, transcripción pendiente de validar, preparación (casillero / SPD) |
| medicacion-2 | Administración en la puerta, cambios de pauta en tiempo real, eventos, importación de las ~45 fichas |
| historia-5 | Sujeciones |

### Fase 3 · dinero y familias — objetivo: otoño 2027

| Bloque | Contenido | Depende de |
|---|---|---|
| facturacion-1 | Plazas, concesiones, tarifas, estancia mensual derivada, motor (`calculo.py`) con test de oro | historia-1 (ausencias) |
| facturacion-2 | Factura a la Junta 1:1, recibos, extras, rectificativas, Verifactu, paquete PECAM | 1 |
| facturacion-3 | Remesa SEPA, estado de cobro y factoring, certificado anual | 2 |
| familias-1 | Portal: acceso sin contraseña, publicación automática, comunicados, documentos | residencia-4 |
| familias-2 | Ropa, solicitudes, encuestas | 1 |

### Fase 3b · cocina y edificio

| Bloque | Contenido |
|---|---|
| cocina-1 | Menús, hoja de emplatado por dietas, cambios registrados |
| appcc-1 | Registros APPCC, sondas de temperatura en cámaras con alarma |
| mantenimiento-1 | Activos, preventivo, reglamentario con caducidades, legionela, formación obligatoria |

### Fase 4 · IA — a partir de 6 meses de datos

ia-1 (PAI → plan y notas de voz; puede adelantarse) · ia-2 (borradores) · ia-3 (línea base) ·
ia-4 (riesgo de caída y UPP).

## Fuera de producto (tareas de Jardín de Gredos, ya)

- Limpiar `MODELO PAI.doc` (datos reales de un residente).
- Congelar y restringir los dos árboles duplicados del Drive.
- Evaluar el Plan de Protección de Datos (pendiente desde 2022, lo cita la NC 01).
- Medir el wifi por plantas.
- Pedir a la médica y a la DUE que revisen la plantilla de gravedad (`00` §3).
