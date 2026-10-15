# Residencia · modelo de datos (v1)

Sobre el `schema.prisma` de mipiacetpv (`origin/master` = `7f74ef1`, 14-10-2026). Decisiones en
`00-decisiones.md`. Este documento es el **mapa**: los nombres de columna exactos los fija cada bloque
con su migración. Convención del repo: modelos en inglés, comentarios y pantallas en español.

---

## 1. Lo que se reutiliza tal cual

| Concepto de residencia | Modelo de mipiacetpv | Notas |
|---|---|---|
| Centro | `Tenant` | Un centro = un tenant (D-44). Interruptores: `residenciaEnabled` (nuevo), `clinicalRecordsEnabled` = true, `cajaEnabled` = false, `holdedEnabled` opcional (D-36), `fichajeEnabled` a elección. |
| Residente | `Client` | + `ResidentProfile` 1:1 (D-49). |
| Persona del personal | `User` (+ `StaffProfile`, `Employee` si ficha) | PIN en `User.pinHash`. `isClinician = true` para todo el que registra (D-51). |
| Tablet | `Device` + emparejamiento + heartbeat + capturas | Nuevo `DeviceKind.ROOM` (D-52). |
| Historia clínica | `ClinicalEntry` + `ClinicalAddendum` | Inmutable. Nuevos `ClinicalEntryKind` cuando haga falta. |
| Quién puede ver | `ClinicalAccess` | Alcance por zona en vez de por cita (D-51): ver §3. |
| Quién ha visto | `ClinicalAccessLog` | Sin cambios. |
| Escalas 3b | `ClinicalAssessment` (+ `Correction`) | Fase 2. |
| Consentimientos | `ClientConsent` | Ingreso, imagen, cesión de datos. |
| Informes a familia | `ClinicalReportDelivery` | Constancia de entrega (Obs. 10 AENOR). |
| Fichaje | `Employee` + `TimeEntry` | Sin cambios. |
| Facturación | `Ticket` + `FiscalRecord` (Verifactu) | Fase 3. |

## 2. Entidades nuevas

### residencia-1 · cimientos

```
ResidentProfile        (1:1 con Client)
  clientId PK, tenantId
  admissionDate, dischargeDate?, dischargeReason?
  dependencyLevel        VALIDO | SEMIASISTIDO | DEPENDIENTE
  dependencyGrade?       I | II | III            (grado de la Ley de Dependencia)
  placeType              PRIVADA | CONCERTADA | TEMPORAL   (la vigencia y pagadores: Fase 3)
  responsibleRelative    nombre, teléfono, parentesco (familiar responsable del PAI)
  dni? / nss?            (identificación; nunca en logs)

Floor                  planta / zona del centro
  id, tenantId, name, sortOrder

Room                   habitación (lo que tiene puerta y tablet)
  id, tenantId, floorId, number, name?, active

Bed                    plaza física dentro de la habitación
  id, roomId, label (A/B), active

BedAssignment          qué residente ocupa qué cama, con vigencia
  id, bedId, clientId, from, to?, reason
  → una cama, un residente vigente; un residente, una cama vigente (índices parciales)

CareRole               catálogo de roles de cuidado (dato, semilla de serie)
  id, tenantId?, code, name, category OPERATIVO | SUPERVISOR | DIRECTIVO,
  isStandard, active
  semilla: AUXILIAR, DUE, MEDICO, TO, FISIO, LIMPIEZA, COCINA,
           CALIDAD (SUPERVISOR), DIRECCION (DIRECTIVO), ADMINISTRACION (OPERATIVO)

CareRoleAssignment     persona ↔ rol de cuidado, muchos a muchos con vigencia
  id, tenantId, userId, careRoleId, from, to?, grantedByUserId, revokedAt?, revokedByUserId?
  → no se borra: revocar rellena revokedAt (mismo criterio que ClinicalAccess)

CareZoneAssignment     alcance de una persona por planta (D-51)
  id, tenantId, userId, floorId?  (null = todo el centro), from, to?

CenterShift            turnos del centro (D-54)
  id, tenantId, code (M/T/N), name, startsAt (hora), endsAt (hora), sortOrder

Device.kind = ROOM  +  Device.roomId
```

### residencia-2 · catálogo y plan

```
ControlType            = TipoDeControl (D-11). Columnas: ver rama-catalogo-de-controles §1
  code, name, layer (EXEC | OBS | MEASURE | SCALE | EVENT), nature (SCHEDULED | ON_DEMAND | DERIVED),
  valueDomain (BOOL | ORDINAL | NUMERIC | SCORE | TEXT_SHORT), unit?, refRange?,
  ordinalOptions[]?, allowedCareRoles[], familyVisible, isoIndicatorCode?,
  scope (STANDARD | CENTER), version, validFrom, validTo?

CarePlan / CarePlanItem    qué controles tiene cada residente, cada cuánto y en qué turno
  clientId, controlTypeId, frequency (cada turno · diario · N veces/semana · días concretos),
  shiftIds[], from, to?, source (PROFILE_DEFAULT | MANUAL)
```

### residencia-3 · la puerta

```
CareRecord             el registro sellado (append-only)
  id, tenantId, clientId, controlTypeId, value (JSON), status (DONE | NOT_DONE | AS_USUAL)
  userId, careRoleId (persona + capacidad, D-31), deviceId, roomId, shiftId
  occurredAt (la tablet), receivedAt (el servidor), externalId (idempotencia offline)
```

### residencia-4 · eventos e incidencias

```
ClinicalThreshold      umbral de serie (versionado) + ResidentThresholdOverride (prescripción médica, firmada, con vigencia)
Incident               libro único (D-35): subjectType (RESIDENT | COMPLAINT | MAINTENANCE), subjectId?,
                       origin (DECLARED | DERIVED_THRESHOLD | DERIVED_ABSENCE), severity N0-N4,
                       openedBy (persona + capacidad), closedBy?, selfClosed, linkedIncidentIds
IncidentAction         qué se hizo (append-only)
FamilyCommunication    comunicado / no comunicado, autor, vía, motivo (D-32 a D-34)
```

### residencia-5 · relevo y dirección

```
Handover               parte de relevo por turno (D-18): generado, confirmaciones con PIN
HandoverAck            quién lo leyó y cuándo
ManagementDuty / DutyOccurrence   obligaciones de dirección con periodicidad (D-42)
```

## 3. Reglas de acceso de la residencia

Una sola función decide, igual que en clinica-1 (`apps/api/src/clinica/acceso.ts`), ampliada:

- Tenant con `residenciaEnabled` + usuario con rol de cuidado **vigente** + (rol con alcance total
  — DUE, MÉDICO, CALIDAD, DIRECCIÓN — **o** el residente ocupa una cama de una planta de su zona vigente).
- Lo que ve cada rol dentro de lo que puede ver lo decide la pantalla por rol (D-03, D-08): la auxiliar,
  sólo lo accionable.
- Todo pasa por `ClinicalAccessLog`.

## 4. Qué va CIFRADO en reposo (D-62, D-63 · residencia-1b)

Con la maquinaria de `clinica-7` y sin un segundo esquema de cifrado: una DEK por centro
envuelta por la `CLINICAL_KEK` del entorno, AAD `tenant|tabla|columna|fila`, y un CHECK de formato
en el motor (`~ '^c[0-9]+:…'`) que hace que **el claro no quepa** en la columna cifrada. La columna
clara se queda al lado y vacía (expand → migrar → contract): es para las filas que ya estaban
escritas, no para las nuevas.

| Tabla | Columna | Dónde vive cifrada |
|---|---|---|
| `resident_profiles` | `dni` | `dni_cifrado` |
| `resident_profiles` | `nss` | `nss_cifrado` |
| `resident_profiles` | `discharge_reason` | `discharge_reason_cifrado` |
| `care_plan_items` | `reason` | `reason_cifrado` |
| `care_plan_items` | `close_reason` | `close_reason_cifrado` |
| `bed_assignments` | `reason` | `reason_cifrado` |

Y lo que se queda **en claro, declarado**:

| Qué | Por qué |
|---|---|
| `care_plan_items.control_code` y las siete columnas de frecuencia | sostienen `care_plan_items_one_live_key` (una línea viva por residente y control) y el cifrado es **no determinista**: una columna cifrada no puede sostener un índice único |
| `resident_profiles.dependency_level` y `dependency_grade` | los usan las plantillas del plan y la lista de residentes |
| Fechas de ingreso y alta, tipo de plaza, familiar responsable | identidad y estancia, no salud — igual que `clients.first_name` en la clínica |
| `floors.name`, `rooms.name`, `beds.label` | son del centro, no de nadie: una DEK por tenant atada a una fila no los cubriría |
| `ClinicalAccessLog` entero | es la prueba de quién miró |

`CareRecord` y todo lo que traiga `residencia-3` **nace cifrado en su bloque**, con su `sitio*` en
`apps/api/src/clinica/cripto-campos.ts` y su CHECK de formato en la migración.

## 5. Lo que no se borra

`ResidentProfile`, `BedAssignment`, `CareRoleAssignment`, `CareRecord`, `Incident` y todo lo clínico:
`onDelete: Restrict`. Un residente con registros no se borra; se le da de alta (`dischargeDate`).
