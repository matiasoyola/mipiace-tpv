# Residencia · hoja de ruta completa

Criterio de Claude con delegación de Matías (14-10-2026). Cada bloque sigue la metodología de
mipiacetpv (prompt en `docs/code-prompts/`, rama y worktree propios, done-doc, PR; merges y despliegues
los hace Dirección). Cada bloque con pantallas lleva mockup antes (las de despacho del admin: D-76).

**Objetivo: el software de referencia nacional para residencias.** Jardín de Gredos es el cliente cero,
no el que marca el orden. **El orden de la hoja de ruta no se invierte por la inspección** (Matías,
22-10-2026): lo que pide la inspección se **añade** al bloque al que pertenece (columna «Inspección»,
referencias R1-R20 de `registros-exigidos-inspeccion.md`).

**Fechas:**
- **20-07-2027 · auditoría AENOR.** Para entonces tienen que estar en producción, con meses de datos
  detrás, la v1 y el mínimo de calidad. Por eso calidad va **antes** que la medicación completa.
- **30-06-2027 · compromiso ante la Junta** (informe de subsanación, punto 3.7): sistema de gestión
  electrónico de registros asistenciales y de calidad implantado en el primer semestre de 2027.

**Implantación en Jardín de Gredos:** se decide más adelante; primero se empuja el desarrollo. Cuando se
implante, regla: desplegar = migrar + dejar el papel.

---

## Estado a 23-10-2026

**En producción `2157e7d` (desplegado el 22-10-2026): residencia-1, 1b, 2, 3, 4, 5 y 6. La v1 está
completa.** Ningún tenant tiene aún la residencia encendida.

**`calidad-1` hecho y en PR contra master** (`docs/blocks/calidad-1-done.md`): el mapa único de
procesos cierra la NC 01 de AENOR por construcción, los indicadores pasan de 6 a 13 y las no
conformidades tienen su ciclo entero con verificación de eficacia y PAC en PDF.

## Mapa de documentos

| Doc | Módulo |
|---|---|
| `00-decisiones.md` | Decisiones D-01 a D-76 y v1 (D-70 a D-76: el módulo de calidad) |
| `01-modelo-datos.md` | Modelo de la v1 sobre mipiacetpv |
| `02-medicacion.md` | Medicación |
| `03-historia-residente.md` | Ficha clínica, PAI, escalas, lesiones, ausencias, sujeciones, ingreso y alta |
| `04-familias.md` | Portal, comunicación, ropa, encuestas |
| `05-plazas-facturacion.md` | Plazas, concesiones JCCM, liquidación, Verifactu, cobros |
| `06-cocina-appcc-mantenimiento.md` | Cocina, APPCC, legionela, mantenimiento, formación |
| `07-calidad-iso.md` | Procesos, indicadores, NC, auditorías, documentos, dirección y personal |
| `08-ia.md` | Capa de IA |
| `registros-exigidos-inspeccion.md` | R1-R20: registros que exige la inspección de la JCCM |

## Fases y bloques

### Fase 1 · v1: la habitación y la dirección — **hecha, en producción**

| Bloque | Contenido | Inspección | Estado |
|---|---|---|---|
| residencia-1 | Cimientos: residentes, edificio, roles de cuidado, zonas, turnos, dispositivo de puerta | — | PR #21 · prod |
| residencia-1b | Cifrado en reposo de DNI, NSS y textos libres (D-62, D-63) | — | PR #24 · prod |
| residencia-2 | Catálogo de controles como dato + plan de cuidados + `queToca` | R9 | PR #22 · prod |
| residencia-3 | La puerta: PIN, residente, lo que toca, «como siempre», registro offline | R9 | PR #27 · prod |
| residencia-4 | Constantes, umbrales, eventos derivados, libro de incidencias (residente, queja, avería), comunicación a familia, guardia | R2, R3, R8 | PR #31 · prod |
| residencia-5 | Relevo con acuse, tablet de sala, panel de dirección, obligaciones del mes | R4-R6 (como dato) | PR #34 · prod |
| residencia-6 | Antes del piloto: PIN por alcance (D-68), rastro de lo ilegible, puerta sin red, parte sin plan, barrido | — | PR #37 · prod |
| *(visita + piloto)* | `docs/residencia/visita-piloto.md`; luego una planta, 4-6 tablets, dos semanas | — | cuando se decida implantar |

Configuración del piloto: a las auxiliares no se les da la zona «todo el centro» (residencia-6 §9.1).
Lo de la inspección que en la v1 es **dato y no código** (se carga, no se programa): obligaciones del
P/10-S, certificados reglamentarios con su vencimiento, plan de autoprotección y los compromisos con
fecha del informe del 22/10/2026 (R4-R6, R17, R18, §3 y §5 del doc de registros).

### Fase 1b · calidad mínima para la auditoría — objetivo: abril 2027 · **en curso**

| Bloque | Contenido | Inspección |
|---|---|---|
| calidad-1 **· hecho** | Mapa de procesos único, riesgos, indicadores calculados, NC y acciones con verificación de eficacia y PAC (`code-prompts/bloque-calidad-1.md` · `blocks/calidad-1-done.md`) | R9 (indicador de cumplimentación por turno y zona) **hecho** |
| calidad-2 | Documentos versionados con revisión obligatoria, auditorías, paquete de evidencias, revisión por la dirección, personal. **Y lo que calidad-1 deja anotado**: el PAC como obligación disparada por un hecho, el histórico de revisiones de un riesgo, el indicador de absentismo (necesita el cuadrante) y la representatividad de las encuestas | R13 (órganos de participación con acta), R14 (cuadrante), R15 (listado de personal con bajas y sustitutos), **«Paquete de inspección»** (PDF firmado por periodo, mismo patrón que el de AENOR), exportación del libro (R2) y de quejas con respuesta comunicada (R3) |

### Fase 2 · historia clínica y medicación — objetivo: verano 2027

| Bloque | Contenido | Inspección |
|---|---|---|
| historia-1 | Ficha clínica (diagnósticos, alergias, dispositivos, dieta), **ausencias**, ingreso guiado y alta | R20 |
| historia-2 | PAI versionado, firmas, enlace PAI → plan, revisiones disparadas | R20 |
| historia-3 | Escalas Barthel, Lobo, Tinetti, Norton | — |
| historia-4 | Lesiones con mapa corporal, curas y fotos | — |
| medicacion-1 | Catálogo, prescripción, transcripción pendiente de validar, preparación (casillero / SPD) | R16 |
| medicacion-2 | Administración en la puerta, cambios de pauta en tiempo real, eventos, importación de las ~45 fichas | R16 |
| historia-5 | Sujeciones (físicas y químicas): prescripción, consentimiento específico por tipo, colocación y retirada en la puerta, revisión con caducidad, listado vivo exportable | **R7**: añadir un tipo sin prescripción y consentimiento nuevos queda bloqueado. Base legal: Decreto 2/2022 CLM, art. 12.6 (prescripción facultativa, consentimiento informado, registro y protocolo obligatorios, último recurso) |

### Fase 3 · dinero y familias — objetivo: otoño 2027

| Bloque | Contenido | Depende de | Inspección |
|---|---|---|---|
| facturacion-1 | Plazas, concesiones, tarifas, estancia mensual derivada, motor (`calculo.py`) con test de oro | historia-1 | — |
| facturacion-2 | Factura a la Junta 1:1, recibos, extras, rectificativas, Verifactu, paquete PECAM | 1 | — |
| facturacion-3 | Remesa SEPA, estado de cobro y factoring, certificado anual | 2 | — |
| familias-1 | Portal: acceso sin contraseña, publicación automática, comunicados, documentos | residencia-4 | R13 (órgano de familiares) |
| familias-2 | Ropa, solicitudes, encuestas | 1 | R19 |

### Fase 3b · cocina, edificio y vida en el centro

| Bloque | Contenido | Inspección |
|---|---|---|
| cocina-1 | Menús, hoja de emplatado por dietas, cambios registrados | R11 (menú túrmix visado) |
| appcc-1 | Registros APPCC, sondas de temperatura en cámaras con alarma | — |
| mantenimiento-1 | Activos, preventivo, reglamentario con caducidades, legionela, formación obligatoria | R5 (aviso 60 días + certificado adjunto obligatorio), R10 (limpieza por zona), R17 (ventilación y humedad, sensores opcionales), R18 (llamadores) |
| actividades-1 *(nuevo)* | Planificador semanal de animación sociocultural y asistencia | R12 (suma horas y avisa por debajo de 15 h/semana) |

### Fase 4 · IA — a partir de 6 meses de datos

ia-1 (PAI → plan y notas de voz; puede adelantarse) · ia-2 (borradores) · ia-3 (línea base) ·
ia-4 (riesgo de caída y UPP).

## Fuera de producto (tareas de Jardín de Gredos, ya)

- Limpiar `MODELO PAI.doc` (datos reales de un residente).
- Congelar y restringir los dos árboles duplicados del Drive.
- Evaluar el Plan de Protección de Datos (pendiente desde 2022, lo cita la NC 01).
- Medir el wifi por plantas.
- Pedir a la médica y a la DUE que revisen la plantilla de gravedad (`00` §3).
