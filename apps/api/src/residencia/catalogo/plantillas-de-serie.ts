// residencia-2 (alcance §5, D-53) · LAS PLANTILLAS DE SERIE POR NIVEL DE
// DEPENDENCIA.
//
// Qué lleva un válido, un semiasistido y un dependiente. Al dar de alta a
// un residente se le aplica la de su nivel; al cambiarle el nivel se
// recalcula y **las líneas manuales no se tocan**.
//
// ── La de serie vive AQUÍ y la del centro en la base ─────────────────
//
// Este fichero es el producto. Al encender el módulo se copia a
// `care_plan_template_items` del centro, que es la que el centro edita y
// la que se aplica. Los dos únicos que leen ESTE fichero son la semilla y
// el botón de «volver a la de serie».
//
// ── De dónde salen las tres listas ──────────────────────────────────
//
// Del PAI de Jardín de Gredos y de cómo trabaja el centro hoy, con una
// regla que las ordena: **lo que sube de nivel es la frecuencia, no la
// lista**. Un válido y un dependiente se asean los dos; lo que cambia es
// que al dependiente hay que girarlo cada tres horas y al válido no hay
// que girarlo nunca.
//
// Lo que un VÁLIDO no lleva y un dependiente sí, en una frase cada uno:
//
//   · cambios posturales — se levanta y se mueve solo;
//   · transferencias — no hace falta pasarlo de la cama a la silla;
//   · hidratación cutánea diaria — la lleva, pero no es prevención de
//     úlceras, así que no se agenda a diario;
//   · observación de piel cada día — se mira al asear, y su riesgo de
//     úlcera es bajo.
//
// Y lo que los TRES llevan igual, que es la mitad de la lista: las cuatro
// comidas, la higiene, la limpieza de la habitación y del baño, la
// medicación, el ánimo, la cognición, el dolor, el descanso y la visita
// médica. Una residencia no deja de mirar cómo está de ánimo alguien
// porque camine solo.

import type { PlantillasDeSerie } from "./tipos.js";

/** Lo que llevan los tres niveles, para no repetirlo tres veces. */
const COMUN = [
  // Las cuatro comidas, cada una en su momento.
  { controlCode: "DESAYUNO", frequency: { kind: "MOMENTS" as const, momentCodes: ["DESAYUNO"] } },
  { controlCode: "COMIDA", frequency: { kind: "MOMENTS" as const, momentCodes: ["COMIDA"] } },
  { controlCode: "MERIENDA", frequency: { kind: "MOMENTS" as const, momentCodes: ["MERIENDA"] } },
  { controlCode: "CENA", frequency: { kind: "MOMENTS" as const, momentCodes: ["CENA"] } },
  // La medicación, que en la v1 es sólo «dispensación hecha» (D-41).
  {
    controlCode: "MEDICACION_DIURNA",
    frequency: { kind: "MOMENTS" as const, momentCodes: ["DESAYUNO", "COMIDA", "CENA"] },
  },
  { controlCode: "MEDICACION_NOCTURNA", frequency: { kind: "MOMENTS" as const, momentCodes: ["NOCHE"] } },
  // La habitación y el baño, que los hace limpieza.
  { controlCode: "LIMPIEZA_HABITACION", frequency: { kind: "DAILY" as const, shiftCodes: ["M"] } },
  { controlCode: "LIMPIEZA_BANO", frequency: { kind: "DAILY" as const, shiftCodes: ["M"] } },
  // La observación: ánimo, cognición, dolor, descanso, ingesta.
  { controlCode: "ANIMO", frequency: { kind: "EVERY_SHIFT" as const, shiftCodes: ["M", "T"] } },
  { controlCode: "COGNICION", frequency: { kind: "DAILY" as const, shiftCodes: ["M"] } },
  { controlCode: "DOLOR", frequency: { kind: "EVERY_SHIFT" as const, shiftCodes: ["M", "T", "N"] } },
  { controlCode: "DESCANSO_NOCTURNO", frequency: { kind: "DAILY" as const, shiftCodes: ["M"] } },
  { controlCode: "INGESTA_DIA", frequency: { kind: "DAILY" as const, shiftCodes: ["T"] } },
  // El seguimiento clínico.
  { controlCode: "TOMA_DE_PESO", frequency: { kind: "MONTHLY" as const, monthDay: 1, shiftCodes: ["M"] } },
  { controlCode: "PESO", frequency: { kind: "MONTHLY" as const, monthDay: 1, shiftCodes: ["M"] } },
  { controlCode: "VISITA_MEDICA", frequency: { kind: "MONTHLY" as const, monthDay: 1, shiftCodes: ["M"] } },
  { controlCode: "ANALITICA", frequency: { kind: "EVERY_N_DAYS" as const, everyNDays: 180, shiftCodes: ["M"] } },
];

export const PLANTILLAS_DE_SERIE: PlantillasDeSerie = {
  // ── VÁLIDO ─────────────────────────────────────────────────────────
  //
  // Se vale solo: se asea, come y se mueve. Lo que lleva es la vida del
  // centro y el seguimiento, no el cuidado del cuerpo. **Nada de cambios
  // posturales ni de transferencias.**
  VALIDO: [
    ...COMUN,
    { controlCode: "HIGIENE_PERSONAL", frequency: { kind: "DAILY", shiftCodes: ["M"] } },
    { controlCode: "MOVILIDAD", frequency: { kind: "DAILY", shiftCodes: ["M"] } },
    // Las actividades, que son lo que un válido sí hace y un dependiente
    // casi no: gimnasia, estimulación y lo sociocultural.
    { controlCode: "GIMNASIA", frequency: { kind: "WEEKDAYS", weekdays: [1, 3, 5], shiftCodes: ["M"] } },
    { controlCode: "ESTIMULACION_COGNITIVA", frequency: { kind: "WEEKDAYS", weekdays: [2, 4], shiftCodes: ["M"] } },
    { controlCode: "ACTIVIDAD_SOCIOCULTURAL", frequency: { kind: "WEEKDAYS", weekdays: [2, 4], shiftCodes: ["T"] } },
  ],

  // ── SEMIASISTIDO ───────────────────────────────────────────────────
  //
  // Necesita ayuda para algunas cosas. Entra la piel (se le mira al
  // asear), la hidratación cutánea, la siesta y las transferencias —pero
  // sólo una vez al día y no en cada turno—, y la rehabilitación. Los
  // cambios posturales todavía no: se mueve en la cama.
  SEMIASISTIDO: [
    ...COMUN,
    { controlCode: "HIGIENE_PERSONAL", frequency: { kind: "DAILY", shiftCodes: ["M"] } },
    { controlCode: "HIDRATACION_CUTANEA", frequency: { kind: "DAILY", shiftCodes: ["T"] } },
    { controlCode: "PIEL", frequency: { kind: "DAILY", shiftCodes: ["M"] } },
    { controlCode: "MOVILIDAD", frequency: { kind: "DAILY", shiftCodes: ["M"] } },
    { controlCode: "SIESTA", frequency: { kind: "DAILY", shiftCodes: ["T"] } },
    { controlCode: "TRANSFERENCIAS", frequency: { kind: "DAILY", shiftCodes: ["M"] } },
    { controlCode: "GIMNASIA", frequency: { kind: "WEEKDAYS", weekdays: [1, 3, 5], shiftCodes: ["M"] } },
    { controlCode: "REHABILITACION_GRUPAL", frequency: { kind: "WEEKDAYS", weekdays: [1, 3, 5], shiftCodes: ["T"] } },
    { controlCode: "ESTIMULACION_COGNITIVA", frequency: { kind: "WEEKDAYS", weekdays: [2, 4], shiftCodes: ["M"] } },
  ],

  // ── DEPENDIENTE ────────────────────────────────────────────────────
  //
  // El ejemplo que el prompt pone: **cambios posturales cada 3 h**, que es
  // la línea que distingue esta plantilla de las otras dos y la que más
  // trabajo genera (ocho rondas al día por residente). La fisioterapia de
  // grupo sale —no puede ir— y entra la individual a través de las
  // transferencias en cada turno.
  DEPENDIENTE: [
    ...COMUN,
    { controlCode: "HIGIENE_PERSONAL", frequency: { kind: "DAILY", shiftCodes: ["M"] } },
    { controlCode: "CAMBIO_POSTURAL", frequency: { kind: "EVERY_N_HOURS", everyNHours: 3 } },
    { controlCode: "HIDRATACION_CUTANEA", frequency: { kind: "EVERY_SHIFT", shiftCodes: ["M", "T"] } },
    { controlCode: "PIEL", frequency: { kind: "DAILY", shiftCodes: ["M"] } },
    { controlCode: "MOVILIDAD", frequency: { kind: "DAILY", shiftCodes: ["M"] } },
    { controlCode: "SIESTA", frequency: { kind: "DAILY", shiftCodes: ["T"] } },
    { controlCode: "TRANSFERENCIAS", frequency: { kind: "EVERY_SHIFT", shiftCodes: ["M", "T", "N"] } },
    { controlCode: "ESTIMULACION_COGNITIVA", frequency: { kind: "WEEKDAYS", weekdays: [2, 4], shiftCodes: ["M"] } },
  ],
};
