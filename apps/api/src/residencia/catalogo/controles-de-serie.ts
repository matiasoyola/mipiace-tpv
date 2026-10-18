// residencia-2 (D-11, rama de controles §3 y §4) · EL CATÁLOGO DE SERIE.
//
// Los 37 controles con los que un centro de residencia arranca, en las
// tres capas que el catálogo siembra: 22 de ejecución, 8 de observación y
// 7 de medida. (residencia-2 sembró 36; residencia-3 añadió el botón
// transversal «algo no va bien», que es la octava de la capa 2 y la única
// `TEXT_SHORT` — ver su comentario.) `SCALE` (Barthel, Lobo, Tinetti, Norton) es Fase 2 (D-40,
// D-55) y `EVENT` es residencia-4: los dos están en el enum y no aquí.
//
// ── LOS TEXTOS SON EL VOCABULARIO DEL CLIENTE ────────────────────────
//
// «Gerocultora», «deposición», «hidratación cutánea», «taller de
// rehabilitación grupal». Salen de la toma de requisitos con Jardín de
// Gredos y del PAI que usan desde 2012, no de un manual. Un centro que
// llame «aseo» a la higiene personal se lo cambia en su glosario local
// (`CenterControlSetting.alias`) sin tocar esto.
//
// ── LA FUENTE DEL VOCABULARIO ORDINAL ────────────────────────────────
//
// D-59 cierra que el vocabulario de ánimo y cognición es «el propuesto en
// la rama de controles». Esa rama (`rama-catalogo-de-controles.md`) vive en
// el proyecto «Jardin de Gredos» y no está en este repo; Matías trajo su §4
// el 15-10 y **ánimo y cognición son ya literalmente los suyos** (ver el
// comentario de cada uno: lo que cambió y por qué).
//
// Las otras CINCO dimensiones —dolor, descanso nocturno, piel, ingesta del
// día y movilidad/estabilidad— **no tenían vocabulario en la rama**. Lo que
// llevan es **propuesta de producto, pendiente de validar por la médica y
// por las auxiliares**, y está así marcado en el `-done` (§11.5). No
// bloquea nada: es dato, y cambiarlo es editar esta tabla y subir la
// versión del control.
//
// ── POR QUÉ ÁNIMO Y COGNICIÓN SIGUEN EN LA VERSIÓN 1 ─────────────────
//
// La regla del bloque es que **una versión publicada no se edita**: se
// crea la siguiente. Aquí se ha editado la 1, y es correcto porque la 1
// **nunca llegó a nadie**: no hay ningún centro con la residencia
// encendida en producción y esta rama no está mergeada, así que esas filas
// no existen fuera de las bases de desarrollo. Publicar una «v2» sería
// inventar un histórico que no ocurrió.
//
// La consecuencia, dicha: quien ya haya arrancado esta rama tiene la v1
// vieja en SU base, y el seed **no la va a pisar** —avisa y no propaga,
// que es justo lo que debe hacer—. Se arregla borrando esas filas
// (`DELETE FROM control_types WHERE code IN ('ANIMO','COGNICION')`) y
// volviendo a arrancar. En producción no aplica: allí no hay ninguna.
//
// ── POR QUÉ LA TENSIÓN SON DOS CONTROLES Y NO UNO ────────────────────
//
// El prompt deja elegir. Son dos (`TA_SISTOLICA` y `TA_DIASTOLICA`) con el
// mismo `groupCode`, y las tres razones, en orden de peso:
//
//   1. **Los umbrales de residencia-4 son por valor.** La plantilla de
//      gravedad de D-56 dice «TA sistólica ≥ 180 o ≤ 90» y no menciona la
//      diastólica. Con un control compuesto, ese umbral tendría que saber
//      de qué mitad del valor habla, y `ClinicalThreshold` pasaría de ser
//      una fila a ser una fila con un selector.
//   2. **`NUMERIC` tiene UNA unidad y UN rango.** Las dos mitades
//      comparten unidad pero no rango de referencia (90–139 y 60–89), y
//      meter los dos en una fila obliga a inventar `refMin2`/`refMax2`,
//      que es la clase de columna que luego nadie sabe si rellenar.
//   3. **El indicador los cuenta por separado.** «Cuántas tomas con
//      sistólica fuera de rango» es la pregunta de AENOR.
//
// Lo que se pierde —que la pantalla abra el teclado dos veces— se arregla
// donde se tiene que arreglar: `groupCode = "TA"` dice que se piden
// juntas, y la puerta de residencia-3 pintará «120 / 80» en un solo paso.
//
// ── Y POR QUÉ LA HIGIENE SON DOS ─────────────────────────────────────
//
// El prompt pide «higiene personal (a demanda + base programada)», y eso
// no cabe en una fila: `nature` es un valor y no dos. `HIGIENE_PERSONAL`
// es `SCHEDULED` (se cumple o se incumple: el aseo de la mañana) y
// `HIGIENE_EXTRA` es `ON_DEMAND` (sólo se cuenta: se ha manchado). Con una
// sola fila habría que elegir entre que el aseo de la mañana no se pueda
// incumplir o que cada cambio de ropa de más sea un incumplimiento.

import type { ControlDeSerie } from "./tipos.js";

/**
 * Los indicadores de calidad a los que alimentan los controles (ISO 9001 /
 * AENOR). Texto y no enum a propósito: los indicadores cambian con la
 * revisión de la norma y con lo que la auditoría pida, y eso no puede ser
 * una migración. residencia-5 los cuenta.
 *
 * Salen del análisis de la auditoría de AENOR 2026
 * (`auditoria-aenor-2026-analisis.md`) y de los cuatro que el cliente cero
 * ya reporta a mano.
 */
export const INDICADORES_ISO = {
  HIGIENE: "Higiene y aseo del residente",
  UPP: "Prevención de úlceras por presión",
  NUTRICION: "Nutrición e hidratación",
  ELIMINACION: "Eliminación (deposición)",
  MEDICACION: "Dispensación de medicación",
  LIMPIEZA: "Limpieza de la habitación y del baño",
  ACTIVIDADES: "Participación en actividades y terapias",
  CAIDAS: "Prevención de caídas y movilidad",
  DESCANSO: "Descanso nocturno",
  BIENESTAR: "Bienestar emocional",
  DOLOR: "Control del dolor",
  SEGUIMIENTO_CLINICO: "Seguimiento clínico",
} as const;

/**
 * El vocabulario de las COMIDAS, compartido por los cuatro controles de
 * comida (rama de controles §3: «todo / la mitad / poco / nada»).
 *
 * **Sin `asUsual`**, y es a propósito: «todo» no es «como siempre», es
 * «hoy se lo comió todo». Un toque de «como siempre» no puede dar por
 * buena una comida que nadie ha mirado — eso es lo que D-16 permite para
 * una OBSERVACIÓN («¿cómo está hoy?») y no para una EJECUCIÓN («¿qué
 * comió?»). Si llevara `asUsual`, la ingesta del centro entero saldría
 * «todo» cada día y el indicador de nutrición no valdría nada.
 */
const COMIDA_OPCIONES = [
  { code: "TODO", label: "Todo", sortOrder: 1 },
  { code: "MITAD", label: "La mitad", sortOrder: 2 },
  { code: "POCO", label: "Poco", sortOrder: 3 },
  { code: "NADA", label: "Nada", sortOrder: 4 },
].map(({ code, label }) => ({ code, label }));

/** Las frecuencias que admite una comida: su momento, y nada más. */
const SOLO_MOMENTOS = ["MOMENTS"] as const;

export const CONTROLES_DE_SERIE: ControlDeSerie[] = [
  // ══ CAPA 1 · EJECUCIÓN (`EXEC`) · ¿se hizo? ═════════════════════════
  //
  // Es el 80 % de lo que una auxiliar registra en un turno, y de aquí sale
  // el presupuesto del producto: ≤15 s por registro con el desplazamiento
  // incluido (D-05).
  {
    code: "HIGIENE_PERSONAL",
    version: 1,
    name: "Higiene personal",
    layer: "EXEC",
    nature: "SCHEDULED",
    valueDomain: "BOOL",
    allowedFrequencies: ["DAILY", "EVERY_SHIFT", "MOMENTS", "WEEKDAYS"],
    defaultFrequency: { kind: "DAILY", shiftCodes: ["M"] },
    allowedCareRoleCodes: ["AUXILIAR", "DUE"],
    isoIndicatorCode: "HIGIENE",
    sortOrder: 10,
  },
  {
    code: "HIGIENE_EXTRA",
    version: 1,
    name: "Higiene extra (se ha manchado)",
    layer: "EXEC",
    // `ON_DEMAND`: sólo se CUENTA. Que no haya ninguna en un turno no es
    // un incumplimiento de nadie — y que haya cuatro al día sí es un dato
    // clínico, que es para lo que se cuenta.
    nature: "ON_DEMAND",
    valueDomain: "BOOL",
    allowedFrequencies: ["ON_DEMAND"],
    defaultFrequency: { kind: "ON_DEMAND" },
    allowedCareRoleCodes: ["AUXILIAR", "DUE"],
    isoIndicatorCode: "HIGIENE",
    sortOrder: 20,
  },
  {
    code: "CAMBIO_POSTURAL",
    version: 1,
    name: "Cambio postural",
    layer: "EXEC",
    nature: "SCHEDULED",
    valueDomain: "BOOL",
    // La única frecuencia del catálogo que no se deja describir con
    // turnos: cada 2–3 h, también de noche. De aquí sale que
    // `EVERY_N_HOURS` exista.
    allowedFrequencies: ["EVERY_N_HOURS", "EVERY_SHIFT", "ON_DEMAND"],
    defaultFrequency: { kind: "EVERY_N_HOURS", everyNHours: 3 },
    allowedCareRoleCodes: ["AUXILIAR", "DUE"],
    isoIndicatorCode: "UPP",
    sortOrder: 30,
  },
  {
    code: "DESAYUNO",
    version: 1,
    name: "Desayuno",
    layer: "EXEC",
    nature: "SCHEDULED",
    valueDomain: "ORDINAL",
    options: COMIDA_OPCIONES,
    allowedFrequencies: [...SOLO_MOMENTOS],
    defaultFrequency: { kind: "MOMENTS", momentCodes: ["DESAYUNO"] },
    allowedCareRoleCodes: ["AUXILIAR", "COCINA", "DUE"],
    isoIndicatorCode: "NUTRICION",
    sortOrder: 40,
  },
  {
    code: "COMIDA",
    version: 1,
    name: "Comida",
    layer: "EXEC",
    nature: "SCHEDULED",
    valueDomain: "ORDINAL",
    options: COMIDA_OPCIONES,
    allowedFrequencies: [...SOLO_MOMENTOS],
    defaultFrequency: { kind: "MOMENTS", momentCodes: ["COMIDA"] },
    allowedCareRoleCodes: ["AUXILIAR", "COCINA", "DUE"],
    isoIndicatorCode: "NUTRICION",
    sortOrder: 50,
  },
  {
    code: "MERIENDA",
    version: 1,
    name: "Merienda",
    layer: "EXEC",
    nature: "SCHEDULED",
    valueDomain: "ORDINAL",
    options: COMIDA_OPCIONES,
    allowedFrequencies: [...SOLO_MOMENTOS],
    defaultFrequency: { kind: "MOMENTS", momentCodes: ["MERIENDA"] },
    allowedCareRoleCodes: ["AUXILIAR", "COCINA", "DUE"],
    isoIndicatorCode: "NUTRICION",
    sortOrder: 60,
  },
  {
    code: "CENA",
    version: 1,
    name: "Cena",
    layer: "EXEC",
    nature: "SCHEDULED",
    valueDomain: "ORDINAL",
    options: COMIDA_OPCIONES,
    allowedFrequencies: [...SOLO_MOMENTOS],
    defaultFrequency: { kind: "MOMENTS", momentCodes: ["CENA"] },
    allowedCareRoleCodes: ["AUXILIAR", "COCINA", "DUE"],
    isoIndicatorCode: "NUTRICION",
    sortOrder: 70,
  },
  {
    code: "SIESTA",
    version: 1,
    name: "Siesta / descanso",
    layer: "EXEC",
    nature: "SCHEDULED",
    valueDomain: "BOOL",
    allowedFrequencies: ["DAILY", "ON_DEMAND"],
    defaultFrequency: { kind: "DAILY", shiftCodes: ["T"] },
    allowedCareRoleCodes: ["AUXILIAR"],
    isoIndicatorCode: "DESCANSO",
    sortOrder: 80,
  },
  {
    code: "DEPOSICION",
    version: 1,
    name: "Deposición",
    layer: "EXEC",
    // A demanda y CONTADA: de aquí sale el evento por ausencia de D-20
    // («sin deposición > 3 días»), que es residencia-4. Aquí sólo se
    // declara que se cuenta.
    nature: "ON_DEMAND",
    valueDomain: "BOOL",
    allowedFrequencies: ["ON_DEMAND"],
    defaultFrequency: { kind: "ON_DEMAND" },
    allowedCareRoleCodes: ["AUXILIAR", "DUE"],
    isoIndicatorCode: "ELIMINACION",
    sortOrder: 90,
  },
  {
    code: "MEDICACION_DIURNA",
    version: 1,
    name: "Dispensación de medicación diurna",
    layer: "EXEC",
    nature: "SCHEDULED",
    valueDomain: "BOOL",
    allowedFrequencies: ["MOMENTS", "EVERY_SHIFT", "DAILY"],
    defaultFrequency: { kind: "MOMENTS", momentCodes: ["DESAYUNO", "COMIDA", "CENA"] },
    // D-41: en la v1 la medicación sólo existe como tarea de capa 1
    // («dispensación hecha»). La cadena prescribe → prepara → administra
    // con propagación en tiempo real (D-10) es Fase 2. La DUE primero en
    // la lista porque es quien la prepara.
    allowedCareRoleCodes: ["DUE", "AUXILIAR", "MEDICO"],
    isoIndicatorCode: "MEDICACION",
    sortOrder: 100,
  },
  {
    code: "MEDICACION_NOCTURNA",
    version: 1,
    name: "Dispensación de medicación nocturna",
    layer: "EXEC",
    nature: "SCHEDULED",
    valueDomain: "BOOL",
    allowedFrequencies: ["MOMENTS", "DAILY"],
    defaultFrequency: { kind: "MOMENTS", momentCodes: ["NOCHE"] },
    allowedCareRoleCodes: ["DUE", "AUXILIAR", "MEDICO"],
    isoIndicatorCode: "MEDICACION",
    sortOrder: 110,
  },
  {
    code: "LIMPIEZA_HABITACION",
    version: 1,
    name: "Limpieza de habitación",
    layer: "EXEC",
    nature: "SCHEDULED",
    valueDomain: "BOOL",
    allowedFrequencies: ["DAILY", "WEEKDAYS", "EVERY_N_DAYS"],
    defaultFrequency: { kind: "DAILY", shiftCodes: ["M"] },
    // La limpiadora registra, y es la decisión de residencia-1 §4: apunta
    // «habitación hecha» y eso entra en la historia del residente.
    allowedCareRoleCodes: ["LIMPIEZA", "AUXILIAR"],
    isoIndicatorCode: "LIMPIEZA",
    sortOrder: 120,
  },
  {
    code: "LIMPIEZA_BANO",
    version: 1,
    name: "Limpieza de baño",
    layer: "EXEC",
    nature: "SCHEDULED",
    valueDomain: "BOOL",
    allowedFrequencies: ["DAILY", "WEEKDAYS", "EVERY_N_DAYS"],
    defaultFrequency: { kind: "DAILY", shiftCodes: ["M"] },
    allowedCareRoleCodes: ["LIMPIEZA", "AUXILIAR"],
    isoIndicatorCode: "LIMPIEZA",
    sortOrder: 130,
  },
  {
    code: "HIDRATACION_CUTANEA",
    version: 1,
    name: "Hidratación cutánea",
    layer: "EXEC",
    nature: "SCHEDULED",
    valueDomain: "BOOL",
    allowedFrequencies: ["DAILY", "EVERY_SHIFT", "WEEKDAYS"],
    defaultFrequency: { kind: "DAILY", shiftCodes: ["T"] },
    allowedCareRoleCodes: ["AUXILIAR", "DUE"],
    isoIndicatorCode: "UPP",
    sortOrder: 140,
  },
  {
    code: "TOMA_DE_PESO",
    version: 1,
    // El control de la TAREA («¿se le pesó?»), que es distinto de `PESO`
    // («¿cuánto pesa?», capa de medida). Los dos están en la lista del
    // prompt y los dos hacen falta: el indicador de nutrición cuenta
    // cuántas tomas tocaban y cuántas se hicieron, y la curva de peso la
    // lee la médica del valor.
    name: "Toma de peso",
    layer: "EXEC",
    nature: "SCHEDULED",
    valueDomain: "BOOL",
    allowedFrequencies: ["MONTHLY", "EVERY_N_DAYS", "WEEKDAYS"],
    defaultFrequency: { kind: "MONTHLY", monthDay: 1, shiftCodes: ["M"] },
    allowedCareRoleCodes: ["AUXILIAR", "DUE"],
    isoIndicatorCode: "NUTRICION",
    sortOrder: 150,
  },
  {
    code: "GIMNASIA",
    version: 1,
    name: "Gimnasia de mantenimiento",
    layer: "EXEC",
    nature: "SCHEDULED",
    valueDomain: "BOOL",
    allowedFrequencies: ["WEEKDAYS", "DAILY", "EVERY_N_DAYS"],
    defaultFrequency: { kind: "WEEKDAYS", weekdays: [1, 3, 5], shiftCodes: ["M"] },
    allowedCareRoleCodes: ["FISIO", "TO"],
    isoIndicatorCode: "ACTIVIDADES",
    sortOrder: 160,
  },
  {
    code: "ESTIMULACION_COGNITIVA",
    version: 1,
    name: "Estimulación cognitiva",
    layer: "EXEC",
    nature: "SCHEDULED",
    valueDomain: "BOOL",
    allowedFrequencies: ["WEEKDAYS", "DAILY", "EVERY_N_DAYS"],
    defaultFrequency: { kind: "WEEKDAYS", weekdays: [2, 4], shiftCodes: ["M"] },
    allowedCareRoleCodes: ["TO"],
    isoIndicatorCode: "ACTIVIDADES",
    sortOrder: 170,
  },
  {
    code: "REHABILITACION_GRUPAL",
    version: 1,
    name: "Taller de rehabilitación grupal",
    layer: "EXEC",
    nature: "SCHEDULED",
    valueDomain: "BOOL",
    allowedFrequencies: ["WEEKDAYS", "EVERY_N_DAYS"],
    defaultFrequency: { kind: "WEEKDAYS", weekdays: [1, 3, 5], shiftCodes: ["T"] },
    allowedCareRoleCodes: ["FISIO", "TO"],
    isoIndicatorCode: "ACTIVIDADES",
    sortOrder: 180,
  },
  {
    code: "ACTIVIDAD_SOCIOCULTURAL",
    version: 1,
    name: "Actividad sociocultural",
    layer: "EXEC",
    nature: "SCHEDULED",
    valueDomain: "BOOL",
    allowedFrequencies: ["WEEKDAYS", "EVERY_N_DAYS", "ON_DEMAND"],
    defaultFrequency: { kind: "WEEKDAYS", weekdays: [2, 4], shiftCodes: ["T"] },
    allowedCareRoleCodes: ["TO", "AUXILIAR"],
    isoIndicatorCode: "ACTIVIDADES",
    sortOrder: 190,
  },
  {
    code: "TRANSFERENCIAS",
    version: 1,
    name: "Transferencias",
    layer: "EXEC",
    nature: "SCHEDULED",
    valueDomain: "BOOL",
    allowedFrequencies: ["EVERY_SHIFT", "DAILY", "ON_DEMAND"],
    defaultFrequency: { kind: "EVERY_SHIFT", shiftCodes: ["M", "T", "N"] },
    allowedCareRoleCodes: ["AUXILIAR", "FISIO", "DUE"],
    isoIndicatorCode: "CAIDAS",
    sortOrder: 200,
  },
  {
    code: "ANALITICA",
    version: 1,
    name: "Analítica",
    layer: "EXEC",
    nature: "SCHEDULED",
    valueDomain: "BOOL",
    allowedFrequencies: ["EVERY_N_DAYS", "MONTHLY", "ON_DEMAND"],
    // Semestral, que es lo que hace el cliente cero.
    defaultFrequency: { kind: "EVERY_N_DAYS", everyNDays: 180, shiftCodes: ["M"] },
    allowedCareRoleCodes: ["DUE", "MEDICO"],
    isoIndicatorCode: "SEGUIMIENTO_CLINICO",
    sortOrder: 210,
  },
  {
    code: "VISITA_MEDICA",
    version: 1,
    name: "Visita médica",
    layer: "EXEC",
    nature: "SCHEDULED",
    valueDomain: "BOOL",
    allowedFrequencies: ["MONTHLY", "WEEKDAYS", "EVERY_N_DAYS", "ON_DEMAND"],
    defaultFrequency: { kind: "MONTHLY", monthDay: 1, shiftCodes: ["M"] },
    allowedCareRoleCodes: ["MEDICO", "DUE"],
    isoIndicatorCode: "SEGUIMIENTO_CLINICO",
    sortOrder: 220,
  },

  // ══ CAPA 2 · OBSERVACIÓN (`OBS`) · ¿cómo está hoy? ══════════════════
  //
  // ── LAS TRES REGLAS DE LA CAPA (rama de controles §4) ─────────────
  //
  //   1. **El registro no exige DIAGNOSTICAR.** Quien contesta es una
  //      auxiliar en treinta segundos, no la médica. De ahí que las
  //      opciones se FUNDAN en vez de partirse: «apagado / triste» es una
  //      sola, porque distinguirlas es un juicio clínico que no se le
  //      puede pedir a quien pasa a hacer la cama.
  //   2. **Todo es relativo a la LÍNEA BASE del residente.** «Como
  //      siempre» no es «bien»: hay personas cuyo «como siempre» es estar
  //      desorientado, y marcar su normalidad no es decir que esté bien.
  //      Por eso ninguna etiqueta de esta capa emite un juicio absoluto.
  //   3. **«Como siempre» SE REGISTRA SIEMPRE.** No es la ausencia de
  //      registro: es un registro con valor. Lo implementa residencia-3
  //      (escribe el `CareRecord` con el valor `asUsual` de cada dimensión
  //      activa, no se salta la fila), y lo que este bloque deja listo es
  //      justamente de dónde sale ese valor: la marca de abajo.
  //
  // Siete dimensiones, cada una con su vocabulario ordinal corto y su
  // valor «COMO SIEMPRE» (D-16, D-59). La observación se pregunta POR
  // RESIDENTE y no por dimensión: un toque en «como siempre» da por buenas
  // todas las activas, y sólo se despliega lo que se desvía. Este bloque
  // deja el modelo listo para eso —el orden y la marca— y la pantalla que
  // lo explota es residencia-3.
  //
  // El orden (`sortOrder`) es el orden en que se despliegan, y es el orden
  // en que el personal las nombra: primero cómo está de ánimo y de cabeza,
  // luego si le duele algo, luego cómo ha dormido, y al final el cuerpo.
  {
    code: "ANIMO",
    version: 1,
    name: "Ánimo",
    layer: "OBS",
    nature: "SCHEDULED",
    valueDomain: "ORDINAL",
    // El vocabulario de la rama de controles §4, literal. Lo que cambió
    // respecto a lo que este bloque sembró primero —y por qué, que es lo
    // que importa—:
    //
    //   · «apagado» y «triste» eran DOS opciones y son UNA. Partirlas
    //     obliga a la auxiliar a distinguir si está apagada o triste, que
    //     es DIAGNOSTICAR — y esta capa no lo pide. Y «no quiere
    //     levantarse» es como lo dice el personal.
    //   · «agresivo» pasa a «irritable / agresivo»: el escalón que de
    //     verdad se ve es el primero, y con sólo «agresivo» una auxiliar
    //     no marcaría nada en el caso frecuente.
    //   · el «como siempre» ya no dice «bien». «Bien» es un juicio; esta
    //     capa es RELATIVA A LA LÍNEA BASE del residente, y hay personas
    //     cuyo «como siempre» no es estar bien.
    options: [
      { code: "COMO_SIEMPRE", label: "Como siempre", asUsual: true },
      { code: "APAGADO", label: "Apagado / triste / no quiere levantarse" },
      { code: "INQUIETO", label: "Inquieto / ansioso" },
      { code: "IRRITABLE", label: "Irritable / agresivo" },
    ],
    allowedFrequencies: ["EVERY_SHIFT", "DAILY", "ON_DEMAND"],
    defaultFrequency: { kind: "EVERY_SHIFT", shiftCodes: ["M", "T"] },
    allowedCareRoleCodes: ["AUXILIAR", "DUE", "MEDICO", "TO"],
    isoIndicatorCode: "BIENESTAR",
    sortOrder: 300,
  },
  {
    code: "COGNICION",
    version: 1,
    name: "Cognición",
    layer: "OBS",
    nature: "SCHEDULED",
    valueDomain: "ORDINAL",
    // La rama §4, literal. Dos cambios respecto a lo primero que se
    // sembró, y el segundo es un AGUJERO que esto tapa:
    //
    //   · «desorientado» y «no reconoce» eran dos opciones y son una
    //     («Confuso — no reconoce, no se ubica»), otra vez porque
    //     separarlas es diagnosticar.
    //   · **faltaba «Ausente — no responde»**, que es el escalón MÁS
    //     GRAVE de la dimensión. Sin él, una auxiliar que se encuentra a
    //     alguien que no responde no tenía dónde apuntarlo y acabaría
    //     marcando «confuso» — justo el dato que hay que ver primero.
    options: [
      { code: "COMO_SIEMPRE", label: "Como siempre", asUsual: true },
      { code: "MAS_DESPISTADO", label: "Más despistado de lo habitual" },
      { code: "CONFUSO", label: "Confuso — no reconoce, no se ubica" },
      { code: "AUSENTE", label: "Ausente — no responde" },
    ],
    allowedFrequencies: ["DAILY", "EVERY_SHIFT", "ON_DEMAND"],
    defaultFrequency: { kind: "DAILY", shiftCodes: ["M"] },
    allowedCareRoleCodes: ["AUXILIAR", "DUE", "MEDICO", "TO"],
    isoIndicatorCode: "SEGUIMIENTO_CLINICO",
    sortOrder: 310,
  },
  {
    code: "DOLOR",
    version: 1,
    name: "Dolor",
    layer: "OBS",
    nature: "SCHEDULED",
    valueDomain: "ORDINAL",
    // Propuesta de producto: la rama §4 no traía vocabulario para esta
    // dimensión. Pendiente de validar por la médica y las auxiliares.
    options: [
      { code: "SIN_DOLOR", label: "Sin dolor", asUsual: true },
      { code: "MOLESTIA", label: "Molestia leve" },
      { code: "DOLOR", label: "Dolor, lo dice" },
      { code: "DOLOR_FUERTE", label: "Dolor fuerte, no se calma" },
    ],
    allowedFrequencies: ["EVERY_SHIFT", "DAILY", "ON_DEMAND"],
    defaultFrequency: { kind: "EVERY_SHIFT", shiftCodes: ["M", "T", "N"] },
    allowedCareRoleCodes: ["AUXILIAR", "DUE", "MEDICO", "FISIO"],
    isoIndicatorCode: "DOLOR",
    sortOrder: 320,
  },
  {
    code: "DESCANSO_NOCTURNO",
    version: 1,
    name: "Descanso nocturno",
    layer: "OBS",
    nature: "SCHEDULED",
    valueDomain: "ORDINAL",
    // Propuesta de producto: la rama §4 no traía vocabulario para esta
    // dimensión. Pendiente de validar por la médica y las auxiliares.
    options: [
      { code: "BIEN", label: "Ha dormido bien", asUsual: true },
      { code: "INTERRUPCIONES", label: "Se ha despertado alguna vez" },
      { code: "MAL", label: "Ha pasado mala noche" },
      { code: "SIN_DORMIR", label: "No ha dormido" },
    ],
    // Se pregunta por la MAÑANA y no de noche: quien contesta «¿cómo ha
    // dormido?» es quien la ha visto despertarse, y de noche la respuesta
    // todavía no existe.
    allowedFrequencies: ["DAILY", "ON_DEMAND"],
    defaultFrequency: { kind: "DAILY", shiftCodes: ["M"] },
    allowedCareRoleCodes: ["AUXILIAR", "DUE"],
    isoIndicatorCode: "DESCANSO",
    sortOrder: 330,
  },
  {
    code: "PIEL",
    version: 1,
    name: "Piel",
    layer: "OBS",
    nature: "SCHEDULED",
    valueDomain: "ORDINAL",
    // Propuesta de producto: la rama §4 no traía vocabulario para esta
    // dimensión. Pendiente de validar por la médica y las auxiliares.
    options: [
      { code: "BIEN", label: "Piel bien", asUsual: true },
      { code: "ENROJECIMIENTO", label: "Enrojecimiento que no cede" },
      { code: "HERIDA", label: "Herida o ampolla" },
      { code: "ULCERA", label: "Úlcera abierta" },
    ],
    // Se mira al asear, o sea una vez al día: pedirlo cada turno sería
    // pedir que alguien desvista a un residente tres veces para mirarle
    // la espalda. La `Lesión` —medir, fotografiar y seguir una úlcera— es
    // Fase 2 (D-40); aquí sólo se declara si hay algo.
    allowedFrequencies: ["DAILY", "EVERY_SHIFT", "ON_DEMAND"],
    defaultFrequency: { kind: "DAILY", shiftCodes: ["M"] },
    allowedCareRoleCodes: ["AUXILIAR", "DUE"],
    isoIndicatorCode: "UPP",
    sortOrder: 340,
  },
  {
    code: "INGESTA_DIA",
    version: 1,
    name: "Ingesta del día",
    layer: "OBS",
    nature: "SCHEDULED",
    valueDomain: "ORDINAL",
    // Propuesta de producto: la rama §4 no traía vocabulario para esta
    // dimensión. Pendiente de validar por la médica y las auxiliares.
    options: [
      { code: "COMO_SIEMPRE", label: "Como siempre", asUsual: true },
      { code: "MENOS", label: "Ha comido menos" },
      { code: "MUY_POCO", label: "Muy poco" },
      { code: "NADA", label: "No ha comido nada" },
    ],
    // Es el RESUMEN del día, no las cuatro comidas: ésas son capa 1 y se
    // cuentan una por una. Esta dimensión existe porque «ha comido menos
    // de lo normal» es un dato clínico que no sale de sumar «mitad» cuatro
    // veces — el «normal» es de cada residente.
    allowedFrequencies: ["DAILY", "ON_DEMAND"],
    defaultFrequency: { kind: "DAILY", shiftCodes: ["T"] },
    allowedCareRoleCodes: ["AUXILIAR", "DUE", "COCINA"],
    isoIndicatorCode: "NUTRICION",
    sortOrder: 350,
  },
  {
    code: "MOVILIDAD",
    version: 1,
    name: "Movilidad / estabilidad",
    layer: "OBS",
    nature: "SCHEDULED",
    valueDomain: "ORDINAL",
    // Propuesta de producto: la rama §4 no traía vocabulario para esta
    // dimensión. Pendiente de validar por la médica y las auxiliares.
    options: [
      { code: "COMO_SIEMPRE", label: "Como siempre", asUsual: true },
      { code: "MAS_INSEGURO", label: "Más inseguro al andar" },
      { code: "NECESITA_AYUDA", label: "Necesita ayuda que antes no necesitaba" },
      { code: "NO_SE_LEVANTA", label: "No se levanta" },
    ],
    allowedFrequencies: ["DAILY", "EVERY_SHIFT", "ON_DEMAND"],
    defaultFrequency: { kind: "DAILY", shiftCodes: ["M"] },
    allowedCareRoleCodes: ["AUXILIAR", "DUE", "FISIO"],
    isoIndicatorCode: "CAIDAS",
    sortOrder: 360,
  },

  // ── residencia-3 · EL BOTÓN TRANSVERSAL «ALGO NO VA BIEN» ─────────
  //
  // La rama de controles §4 lo pide junto a las siete dimensiones: «más un
  // botón transversal "algo no va bien", con nota de voz o texto corto
  // alternativo (ambos opcionales)». residencia-2 dejó el dominio
  // `TEXT_SHORT` en el enum y ningún control que lo usara; éste lo usa, y
  // entra como un INSERT en este fichero y no como un despliegue, que es
  // la decisión entera del catálogo (D-11).
  //
  // ── Las tres cosas que lo hacen distinto de las siete ─────────────
  //
  //   1. **`ON_DEMAND`**: no tiene agenda. `queToca` no devuelve ni una
  //      ocurrencia suya y nadie lo incumple. Que no haya ninguno en un
  //      turno no es un fallo de nadie.
  //   2. **Sin opciones y sin `asUsual`**, y eso no es un hueco: es la
  //      regla 1 de la capa llevada al final. «No hace falta saber qué es.
  //      Con decirlo basta» (D-13). Si tuviera opciones, la pantalla
  //      obligaría a categorizar y la auxiliar no registraría — que es el
  //      fallo que la rama avisa en su primera regla de diseño.
  //   3. **No entra en el toque de «como siempre»**, justo porque no tiene
  //      `asUsual`. Ese toque escribe una fila por cada dimensión `OBS`
  //      **que declara su valor «como siempre»**, y ésta no declara
  //      ninguno: «como siempre» no puede significar «no me ha parecido
  //      que pase nada», porque entonces el día que SÍ pasa algo no se
  //      distinguiría de los otros 84. Tiene su test.
  //
  // Va en la capa 2 y no en la 4 porque la capa 4 son EVENTOS con
  // gravedad, protocolo y escalado, y eso es residencia-4. Esto es una
  // observación que alguien hace y que el relevo lee.
  {
    code: "ALGO_NO_VA_BIEN",
    version: 1,
    name: "Algo no va bien",
    layer: "OBS",
    nature: "ON_DEMAND",
    valueDomain: "TEXT_SHORT",
    allowedFrequencies: ["ON_DEMAND"],
    defaultFrequency: { kind: "ON_DEMAND" },
    // Todos los que registran. Es el botón que existe para que quien ve
    // algo pueda decirlo, y la limpiadora que entra a la habitación a las
    // nueve ve tanto como la auxiliar.
    allowedCareRoleCodes: [
      "AUXILIAR",
      "DUE",
      "MEDICO",
      "TO",
      "FISIO",
      "LIMPIEZA",
      "COCINA",
      "CALIDAD",
      "DIRECCION",
    ],
    isoIndicatorCode: "SEGUIMIENTO_CLINICO",
    sortOrder: 390,
  },

  // ══ CAPA 3a · MEDIDA (`MEASURE`) · ¿cuánto? ═════════════════════════
  //
  // Las constantes, con unidad, rango de entrada y rango de referencia.
  //
  // **`refMin`/`refMax` NO SON UMBRALES.** Son «lo normal», para pintar el
  // número en gris o en ámbar. Los umbrales que disparan un evento son
  // residencia-4: van en `ClinicalThreshold`, versionados aparte, y
  // admiten excepción por residente con prescripción médica firmada (D-21,
  // D-22) — un rango de referencia no. La plantilla de gravedad de D-56 es
  // de ese bloque y no de éste, y si los números se parecen es porque
  // vienen de la misma guía, no porque sean la misma columna.
  //
  // El rango de ENTRADA es lo que la pantalla deja teclear. Una
  // temperatura de 3,65 °C es un dedo que se saltó una tecla, y atajarlo
  // en el teclado cuesta cero y evita un evento falso.
  //
  // Todas nacen `ON_DEMAND` salvo el peso: una constante se toma cuando la
  // DUE la pide o cuando el plan de un residente la agenda, no «cada
  // turno» por defecto a 49 personas.
  {
    code: "TEMPERATURA",
    version: 1,
    name: "Temperatura",
    layer: "MEASURE",
    nature: "ON_DEMAND",
    valueDomain: "NUMERIC",
    unit: "°C",
    inputMin: 30,
    inputMax: 45,
    refMin: 36,
    refMax: 37.4,
    allowedFrequencies: ["ON_DEMAND", "EVERY_SHIFT", "DAILY", "WEEKDAYS", "EVERY_N_DAYS"],
    defaultFrequency: { kind: "ON_DEMAND" },
    allowedCareRoleCodes: ["AUXILIAR", "DUE", "MEDICO"],
    isoIndicatorCode: "SEGUIMIENTO_CLINICO",
    sortOrder: 400,
  },
  {
    code: "TA_SISTOLICA",
    version: 1,
    name: "Tensión sistólica",
    layer: "MEASURE",
    nature: "ON_DEMAND",
    valueDomain: "NUMERIC",
    unit: "mmHg",
    inputMin: 50,
    inputMax: 300,
    refMin: 90,
    refMax: 139,
    // Las dos mitades de la tensión se piden juntas: ver la cabecera del
    // fichero para las tres razones por las que son dos controles.
    groupCode: "TA",
    allowedFrequencies: ["ON_DEMAND", "EVERY_SHIFT", "DAILY", "WEEKDAYS", "EVERY_N_DAYS", "MONTHLY"],
    defaultFrequency: { kind: "ON_DEMAND" },
    allowedCareRoleCodes: ["AUXILIAR", "DUE", "MEDICO"],
    isoIndicatorCode: "SEGUIMIENTO_CLINICO",
    sortOrder: 410,
  },
  {
    code: "TA_DIASTOLICA",
    version: 1,
    name: "Tensión diastólica",
    layer: "MEASURE",
    nature: "ON_DEMAND",
    valueDomain: "NUMERIC",
    unit: "mmHg",
    inputMin: 30,
    inputMax: 200,
    refMin: 60,
    refMax: 89,
    groupCode: "TA",
    allowedFrequencies: ["ON_DEMAND", "EVERY_SHIFT", "DAILY", "WEEKDAYS", "EVERY_N_DAYS", "MONTHLY"],
    defaultFrequency: { kind: "ON_DEMAND" },
    allowedCareRoleCodes: ["AUXILIAR", "DUE", "MEDICO"],
    isoIndicatorCode: "SEGUIMIENTO_CLINICO",
    sortOrder: 420,
  },
  {
    code: "PULSO",
    version: 1,
    name: "Pulso",
    layer: "MEASURE",
    nature: "ON_DEMAND",
    valueDomain: "NUMERIC",
    unit: "lpm",
    inputMin: 20,
    inputMax: 250,
    refMin: 50,
    refMax: 100,
    allowedFrequencies: ["ON_DEMAND", "EVERY_SHIFT", "DAILY", "WEEKDAYS", "EVERY_N_DAYS"],
    defaultFrequency: { kind: "ON_DEMAND" },
    allowedCareRoleCodes: ["AUXILIAR", "DUE", "MEDICO"],
    isoIndicatorCode: "SEGUIMIENTO_CLINICO",
    sortOrder: 430,
  },
  {
    code: "SATURACION_O2",
    version: 1,
    name: "Saturación de oxígeno",
    layer: "MEASURE",
    nature: "ON_DEMAND",
    valueDomain: "NUMERIC",
    unit: "%",
    inputMin: 50,
    inputMax: 100,
    refMin: 92,
    refMax: 100,
    allowedFrequencies: ["ON_DEMAND", "EVERY_SHIFT", "DAILY", "WEEKDAYS", "EVERY_N_DAYS"],
    defaultFrequency: { kind: "ON_DEMAND" },
    allowedCareRoleCodes: ["AUXILIAR", "DUE", "MEDICO"],
    isoIndicatorCode: "SEGUIMIENTO_CLINICO",
    sortOrder: 440,
  },
  {
    code: "GLUCEMIA",
    version: 1,
    name: "Glucemia capilar",
    layer: "MEASURE",
    nature: "ON_DEMAND",
    valueDomain: "NUMERIC",
    unit: "mg/dl",
    inputMin: 20,
    inputMax: 600,
    refMin: 70,
    refMax: 180,
    // Un diabético insulinodependiente la lleva en los momentos de las
    // comidas, de ahí que `MOMENTS` esté permitido aquí y no en el resto.
    allowedFrequencies: ["ON_DEMAND", "MOMENTS", "EVERY_SHIFT", "DAILY", "WEEKDAYS"],
    defaultFrequency: { kind: "ON_DEMAND" },
    allowedCareRoleCodes: ["AUXILIAR", "DUE", "MEDICO"],
    isoIndicatorCode: "SEGUIMIENTO_CLINICO",
    sortOrder: 450,
  },
  {
    code: "PESO",
    version: 1,
    name: "Peso",
    layer: "MEASURE",
    nature: "SCHEDULED",
    valueDomain: "NUMERIC",
    unit: "kg",
    inputMin: 25,
    inputMax: 200,
    // **Sin rango de referencia a propósito.** No hay un peso «normal»
    // universal: lo que importa es la CURVA de cada residente, y eso lo
    // mira la médica. Un rango 50–90 pintaría en ámbar a media residencia
    // sin decir nada.
    allowedFrequencies: ["MONTHLY", "EVERY_N_DAYS", "WEEKDAYS", "ON_DEMAND"],
    defaultFrequency: { kind: "MONTHLY", monthDay: 1, shiftCodes: ["M"] },
    allowedCareRoleCodes: ["AUXILIAR", "DUE"],
    isoIndicatorCode: "NUTRICION",
    sortOrder: 460,
  },
];
