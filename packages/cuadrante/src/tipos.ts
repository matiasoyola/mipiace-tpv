// personal-1 · EL VOCABULARIO DEL CUADRANTE.
//
// Todo lo que `comprobarCuadrante` necesita saber, y nada más. En
// particular: **ni un id de Prisma, ni un `Decimal`, ni un `Date` de
// «ahora»**. Lo que entra son cadenas («YYYY-MM-DD», «HH:MM») y enteros, y
// lo único que se convierte a instante es lo que tiene que durar lo que
// dura cuando cambia la hora.
//
// Por qué los tipos viven aparte del fichero de las reglas: los importan
// la API, el admin y los tests de tabla, y el día que `reglas.ts` crezca
// nadie tiene que leerlo entero para saber qué forma tiene una celda.

/** Las cinco ausencias. Espejo exacto del enum `StaffAbsenceKind`. */
export type Ausencia =
  | "LIBRE"
  | "VACACIONES"
  | "IT"
  | "ASUNTOS_PROPIOS"
  | "PERMISO";

export const AUSENCIAS: readonly Ausencia[] = [
  "LIBRE",
  "VACACIONES",
  "IT",
  "ASUNTOS_PROPIOS",
  "PERMISO",
] as const;

/** Cómo se lee cada ausencia. En minúscula: se compone en frases. */
export const ETIQUETA_DE_AUSENCIA: Record<Ausencia, string> = {
  LIBRE: "libre",
  VACACIONES: "vacaciones",
  IT: "incapacidad temporal",
  ASUNTOS_PROPIOS: "asuntos propios",
  PERMISO: "permiso",
};

/**
 * Las ausencias que **cuentan como descanso**.
 *
 * `LIBRE` sí: es el día libre, y es lo que el descanso semanal mira.
 * Las otras cuatro también son días sin trabajar —de vacaciones no se
 * descansa «menos»—, así que a efectos de las dos reglas de descanso una
 * ausencia es un día sin intervalo planificado y ya está. La distinción
 * que sí importa está en la de abajo.
 */

/**
 * Las ausencias que **no cuentan como horas planificadas**.
 *
 * Es decir: todas. Una ausencia no planifica horas, por definición. La
 * constante existe para que el día que alguien quiera que `PERMISO`
 * retribuido cuente como jornada, el cambio sea una línea aquí y no un
 * `if` repartido por tres reglas.
 */
export const AUSENCIAS_QUE_NO_SUMAN_HORAS: readonly Ausencia[] = AUSENCIAS;

/** Lo que el cuadrante necesita saber de un turno del tenant. */
export interface TurnoDelCuadrante {
  id: string;
  /** `M`, `T`, `N`… Es la etiqueta de la celda. */
  code: string;
  name: string;
  /** Hora de pared «HH:MM». */
  startsAt: string;
  /** Hora de pared «HH:MM». `<= startsAt` ⇒ el turno cruza medianoche. */
  endsAt: string;
  sortOrder: number;
  /**
   * Cuántas personas de **atención directa** tiene que haber en este
   * turno. `null` = el centro no lo ha declarado, y entonces la regla de
   * cobertura **no se evalúa** para este turno.
   *
   * `null` y no 0 a propósito: con 0, la regla diría «cumple» de todos los
   * turnos de todos los días, que es peor que no decir nada.
   */
  coberturaMinima: number | null;
}

/** Y de una persona. */
export interface PersonaDelCuadrante {
  employeeId: string;
  /** Para la frase del aviso. Nunca va a un log. */
  nombre: string;
  /** Su categoría profesional cuenta como atención directa. */
  atencionDirecta: boolean;
  /**
   * Jornada contratada, en minutos a la semana. `null` = sin declarar, y
   * entonces las dos reglas de horas **no se evalúan** para esta persona
   * (no hay contra qué comparar). Eso sí lo canta
   * `datosQueFaltanDePersonal`, que es su sitio.
   */
  minutosContratados: number | null;
  /** «YYYY-MM-DD». `null` = sin declarar. */
  altaEl: string | null;
  /** «YYYY-MM-DD». Sólo los temporales. */
  finEl: string | null;
}

/**
 * Una celda: lo que esta persona tiene ese día.
 *
 * Un turno **o** una ausencia, nunca las dos (lo garantiza un CHECK en la
 * base). Y puede haber VARIAS celdas del mismo (persona, día): un turno
 * partido son dos.
 */
export interface CeldaDelCuadrante {
  employeeId: string;
  /** «YYYY-MM-DD». */
  dia: string;
  turnoId: string | null;
  ausencia: Ausencia | null;
}

/** El cuadrante entero, tal y como llega a `comprobarCuadrante`. */
export interface Cuadrante {
  /** «YYYY-MM». */
  mes: string;
  turnos: TurnoDelCuadrante[];
  personas: PersonaDelCuadrante[];
  celdas: CeldaDelCuadrante[];
  /**
   * Plazas **ocupadas** cada día: «YYYY-MM-DD» → nº de residentes.
   *
   * Sólo lo trae un tenant de residencia. Un día que no esté en el mapa
   * **no se evalúa**: la ratio de un día sin ocupación conocida no se
   * puede calcular, y suponer 0 diría «cumple» siempre.
   */
  ocupacionPorDia?: Record<string, number>;
}

/**
 * Los parámetros de las reglas. **Del tenant, no constantes del código**
 * (decisión 7): la ratio cambia por comunidad autónoma y por
 * acreditación, y el cómputo del descanso semanal lo permite el art. 37.1
 * del ET hasta 14 días.
 *
 * El convenio colectivo no está aquí y no es un olvido: sus límites
 * entrarán como parámetros cuando Matías los confirme.
 */
export interface ReglasDelCuadrante {
  /** Jornadas completas de atención directa por plaza ocupada. 0,20 de serie. */
  ratioAtencionDirecta: number;
  /** Qué es una jornada completa, en minutos. 480 de serie. */
  minutosDeJornadaCompleta: number;
  /** Art. 34.3 ET. 12 de serie. */
  horasDescansoDiario: number;
  /** Art. 37.1 ET: día y medio ininterrumpido = 36 h. */
  horasDescansoSemanal: number;
  /** …computable «por períodos de hasta catorce días». 7 de serie. */
  diasComputoSemanal: number;
  /**
   * La ratio **sólo se evalúa si el módulo de residencia está encendido**.
   * Un colegio no tiene plazas y no tiene ratio.
   */
  conRatioDeResidencia: boolean;
}

/** Los defaults, que son los de la base. Un centro sin fila usa éstos. */
export const REGLAS_DE_SERIE: ReglasDelCuadrante = {
  ratioAtencionDirecta: 0.2,
  minutosDeJornadaCompleta: 480,
  horasDescansoDiario: 12,
  horasDescansoSemanal: 36,
  diasComputoSemanal: 7,
  conRatioDeResidencia: false,
};

/** Las ocho reglas de serie. */
export type ReglaDelCuadrante =
  /** Personas de atención directa en un turno frente al mínimo del turno. */
  | "COBERTURA"
  /** Jornadas completas equivalentes frente a `ratio × plazas ocupadas`. */
  | "RATIO"
  /** 12 h entre el fin de una jornada y el inicio de la siguiente (34.3 ET). */
  | "DESCANSO_DIARIO"
  /** Día y medio ininterrumpido por período (37.1 ET). */
  | "DESCANSO_SEMANAL"
  /** Horas planificadas frente a la jornada contratada, por semana. */
  | "HORAS_SEMANA"
  /** …y por mes. */
  | "HORAS_MES"
  /** Dos turnos de la misma persona que se pisan. */
  | "DOS_SITIOS_A_LA_VEZ"
  /** Planificada antes de su alta o después del fin de su contrato. */
  | "FUERA_DE_CONTRATO";

/**
 * Cuánto duele.
 *
 * `ROJO` = incumple una norma (el ET, el decreto de la comunidad, el
 * contrato). `AMBAR` = se pasa de lo pactado o falta cobertura declarada:
 * hay que mirarlo, pero no es ilegal.
 *
 * **Ninguno de los dos bloquea publicar** (decisión 7). Publicar con
 * avisos pide confirmarlo y los deja apuntados.
 */
export type GravedadDeAviso = "ROJO" | "AMBAR";

/** Un aviso, tal y como lo pinta la pantalla. */
export interface AvisoDelCuadrante {
  regla: ReglaDelCuadrante;
  gravedad: GravedadDeAviso;
  /** `null` en lo que es del turno o del día y no de una persona. */
  employeeId: string | null;
  /** «YYYY-MM-DD». `null` en lo que es del mes entero. */
  dia: string | null;
  turnoId: string | null;
  /** La frase que se lee. Lleva el nombre, el día y la cifra. */
  mensaje: string;
  /**
   * Cuánto falta o cuánto se pasa, en la unidad de la regla (personas,
   * jornadas, horas). Uno de los dos, nunca los dos.
   */
  falta?: number;
  exceso?: number;
  /**
   * **LA CELDA QUE LO ARREGLA CON UN TOQUE.** Es el filtro «¿y qué?» de
   * este bloque: un aviso que sólo dice que algo está mal obliga a
   * buscarlo en una rejilla de 21 × 31.
   *
   * `null` cuando lo que lo arregla no es UNA celda sino cualquiera de una
   * columna (la cobertura de un turno, la ratio de un día): ahí la
   * pantalla lleva al día y al turno, que van en los campos de arriba.
   */
  celda: { employeeId: string; dia: string } | null;
}

/** Un intervalo planificado, ya como instantes. Lo que de verdad dura. */
export interface IntervaloPlanificado {
  employeeId: string;
  /** El día de la CELDA, que es el día en que el turno empieza. */
  dia: string;
  turnoId: string;
  code: string;
  inicioAt: Date;
  finAt: Date;
}
