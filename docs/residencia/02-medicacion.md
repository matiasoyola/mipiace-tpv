# Residencia · medicación (Fase 2)

Diseño funcional. Criterio de Claude con delegación de Matías (14-10-2026). Se apoya en D-10 (los
cambios de pauta se propagan en tiempo real) y en lo hablado en la sesión 1 (§3 de
`respuestas-requisitos-fase0.md`). **Es la pieza de más riesgo clínico del producto**: AENOR ya señala
«errores en el tratamiento médico» como riesgo sin asociar a proceso (NC 01).

¿Y qué?: la DUE deja de pasar a limpio ~45 fichas en Excel; la auxiliar no da una pastilla que el
médico retiró ayer; y si alguien pregunta «¿qué tomó este residente el martes por la noche y quién se
lo dio?», la respuesta sale en un toque.

---

## 1. La cadena

```
MÉDICO prescribe  →  DUE prepara (casillero semanal o recibe el SPD)  →  AUXILIAR / DUE administra
        ↑                                   ↑                                        ↑
   cambio de pauta  ───── se propaga al momento a los dos eslabones siguientes ─────┘
```

Cada eslabón firma con persona + capacidad (D-31). Ningún eslabón edita lo que firmó otro.

## 2. Prescripción

- **La hace el médico** (rol con categoría y colegiado). También puede **transcribirla la DUE** desde
  un informe externo (alta hospitalaria, especialista): queda en estado **«transcrita, pendiente de
  validar por el médico»**, se administra (no se puede dejar a un residente sin su tratamiento), y el
  panel del médico la muestra hasta que la firma.
- Campos: medicamento · dosis · vía · **tipo de pauta** · momentos · inicio · fin o duración ·
  indicación (sólo visible para DUE y médico) · instrucciones de toma (triturar, con comida, en ayunas…)
  · origen (médico del centro, especialista, hospital).
- **Tipos de pauta** (los que se ven en la residencia real):
  | Tipo | Ejemplo | Cómo se comporta |
  |---|---|---|
  | **Fija** | `1-1-0-1` | genera tomas en desayuno, comida, merienda, cena, noche u hora concreta |
  | **Calendario variable** | Sintrom según INR | dosis distinta por día, la carga la DUE tras cada control |
  | **Según medida** | insulina en escala | la dosis sale de la última glucemia registrada (capa 3a) |
  | **Si precisa** | paracetamol si dolor | sin tomas programadas; condición + dosis máxima al día |
- **Inmutable**: modificar = **suspender + nueva prescripción encadenada**. Así la historia dice qué
  pauta estaba vigente cada día.
- **Alergias**: viven en la historia del residente (ver `03-historia-residente.md`). Prescribir algo
  contra una alergia registrada **bloquea** y obliga a justificar.
- Catálogo de medicamentos: tabla del producto con nombre comercial, principio activo, forma y código
  nacional opcional. Se va llenando con el uso; marca de **alto riesgo** (anticoagulantes, insulinas,
  opioides, antiepilépticos) de serie.

## 3. Preparación

Dos modos por centro (o por residente), porque Jardín de Gredos quiere pasar del primero al segundo:

- **Casillero semanal** (hoy): la DUE prepara la semana. El sistema le da la **hoja de preparación**
  por residente y momento, y ella confirma «casillero preparado del lunes al domingo».
- **SPD de farmacia** (objetivo): la farmacia es un **actor externo** sin acceso al sistema. Recibe la
  hoja de tratamiento (PDF o envío que decida la persona, D-33) y la DUE confirma **la recepción y
  revisión** del blíster.
- **Cambio de pauta con la preparación ya hecha** → las tomas afectadas pasan a
  **«preparación desactualizada»**:
  - a la DUE le salta una tarea «reajustar casillero de X» con el detalle;
  - en la puerta, la auxiliar ve en esa toma **«pauta cambiada — no dar / dar además…»** hasta que la
    DUE confirme el reajuste.

## 4. Administración (en la puerta)

- Al tocar al residente, si hay toma en la ventana del momento aparece **la toma**, con la lista de
  fármacos **sólo en ese instante** (la auxiliar necesita saber qué da; no ve indicación ni diagnóstico, D-08).
- Un toque: **«toma dada»**. Si no: **rechazada · no dada** con motivo de un toque
  (dormido, ausente, hospital, vomitó, dificultad para tragar, falta medicación).
- **Alto riesgo**: pide confirmación de doble toque y queda marcado.
- **Si precisa**: se registra con motivo de la lista (dolor, fiebre, insomnio, agitación) y, a la
  hora configurada, el sistema pide «¿ha hecho efecto?».
- Nocturna: la auxiliar de noche, igual.
- La ventana de cada momento la fija el centro (p. ej. desayuno 08-10).

## 5. Lo que deriva solo (eventos, capa 4)

| Situación | Evento | Nivel por defecto |
|---|---|---|
| Toma no registrada pasada la ventana | toma omitida | N1 · alto riesgo → N2 |
| Rechazo de la misma prescripción 3 tomas seguidas | rechazo repetido | N2 |
| Dada con «preparación desactualizada» sin confirmar | posible error de medicación | N3 |
| Si precisa por encima de la dosis máxima | exceso de si precisa | N2 |
| Prescripción transcrita sin validar > 72 h | validación pendiente | aviso al médico |

Todo **error de medicación** es una incidencia del libro único con el proceso asociado → cierra el
riesgo de AENOR por construcción.

## 6. Panel por rol

- **Médico**: prescripciones por validar, residentes con cambios recientes, alergias.
- **DUE**: hoja de preparación de la semana, reajustes pendientes, controles de Sintrom e insulina,
  tomas omitidas del día.
- **Dirección**: indicador de tomas registradas / programadas y errores de medicación al mes.

## 7. Migración

Las ~45 `FICHA DE MEDICACIÓN <APELLIDOS>.xls` tienen la misma plantilla: **importación asistida**.
Cada ficha entra como prescripciones **transcritas pendientes de validar**; el médico las firma
residente a residente. Sin firma no se pierde nada: se administra y queda a la vista.

## 8. Fuera (declarado)

- Receta electrónica del SESCAM y Nomenclátor oficial: no hay integración abierta para centros
  privados; se revisa cuando exista.
- Stock y pedidos a farmacia: lo gestiona la farmacia del SPD.
- Libro de estupefacientes: se valora con la DUE si lo llevan.

## 9. Entidades

`Medication` (catálogo) · `Allergy` (en la historia) · `Prescription` (inmutable, encadenada:
`replacesId`, `status` ACTIVE | SUSPENDED | TRANSCRIBED_PENDING) · `PrescriptionDose` (para calendario
variable) · `MedicationPrepBatch` (casillero o SPD, periodo, confirmado por) · `ScheduledDose`
(generada) · `DoseAdministration` (append-only: dada / rechazada / no dada, motivo, persona + capacidad,
dispositivo) · `PrnAdministration` + `PrnEffectCheck`.
