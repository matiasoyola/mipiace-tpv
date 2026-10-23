// residencia-5 (bloque C §2, 07-calidad-iso §2) · **LOS INDICADORES QUE
// YA SALEN DE LO REGISTRADO.**
//
// Los 23 indicadores que Jardín de Gredos declara a AENOR dejan de ser un
// informe que alguien redacta a posteriori: son consultas sobre lo que
// las puertas registraron (D-11, tesis de la rama de controles). Pero
// **sólo los que tienen dato**: los que dependen de bloques futuros
// —úlceras por presión, Barthel, desnutrición, medicación, rotación de
// plantilla— no se pintan vacíos. Un panel con nueve indicadores a cero
// es un panel que nadie cree, y de los que faltan se da cuenta en el
// done.
//
// ── FÓRMULA DEL PRODUCTO, UMBRAL DEL CENTRO ─────────────────────────
//
// La frontera estándar/centro de la rama de controles §10, escrita en dos
// sitios a propósito: la **fórmula** está aquí, en un fichero del
// producto que un centro no puede tocar, y el **umbral objetivo** vive en
// `indicator_targets`, que es del centro. El 73,5 % de la gimnasia es el
// objetivo 2026 de Jardín de Gredos; la forma de contar la gimnasia es de
// Mi Piace.
//
// El umbral de serie que hay aquí es el del bloque C §2, y el panel
// **dice si está usando el de serie o el del centro**: un umbral que
// nadie eligió y uno que la dirección eligió no son lo mismo delante de
// un auditor.
//
// ── «SIN DATO» NO ES CERO ───────────────────────────────────────────
//
// Un indicador cuyo denominador es cero devuelve `null`, no `0`. Un
// centro que este mes no tenía ninguna gimnasia planificada no cumple el
// 0 % de participación: no hay nada que medir. Pintar `0 %` en rojo sería
// decirle a la dirección que algo va mal cuando lo que pasa es que no hay
// dato, y es el error que convierte un panel en ruido.
//
// ── calidad-1 (D-72) · CADA INDICADOR TRAE SU PROCESO ───────────────
//
// `procesoDeReferencia` es el código del proceso del **mapa de
// referencia** (`catalogo/procesos-de-serie.ts`) del que cuelga este
// indicador de serie. Al cargar el mapa, el centro se queda con una fila
// en `indicator_processes` por indicador, apuntando a SU proceso; a
// partir de ahí puede colgarlo de otro.
//
// Que viva aquí y no en una tabla es la misma frontera de siempre: de
// qué proceso cuelga «la participación en la gimnasia» en una residencia
// lo sabe el producto; qué proceso es ése en ESTE centro, lo sabe el
// centro.
//
// ── Y SIETE INDICADORES MÁS, LOS QUE YA TIENEN DATO ─────────────────
//
// Cumplimentación de los registros de atención directa (R9 de la
// inspección), caídas, incidencias con familia comunicada, quejas,
// quejas respondidas en plazo, ocupación media y rotación de personal.
// Ni uno sale de que alguien lo teclee: los siete son consultas sobre lo
// que ya está registrado.
//
// Lo que **no** se inventa: absentismo y formación en plazo siguen en la
// lista de los que se nombran, con lo que les falta. Un indicador de
// absentismo calculado sin cuadrante es un número que nadie puede
// defender delante de un auditor, y en una auditoría un número que no se
// puede defender es peor que un hueco.

/** Para qué lado se mide un indicador. Copia del enum de la base. */
export type ComparacionDeIndicador = "AT_LEAST" | "AT_MOST";

/** Cómo se pinta el valor. */
export type UnidadDeIndicador = "PORCENTAJE" | "RECUENTO";

/**
 * Los datos de un mes, ya recogidos, con los que se calculan los seis.
 *
 * Una sola forma de entrada para los seis indicadores y no una por
 * indicador: así el servidor hace **una** recogida por mes en vez de
 * seis, y añadir el séptimo es una fila de la tabla de abajo más, como
 * mucho, un campo aquí.
 */
export interface DatosDelMes {
  /** El mes, «YYYY-MM». Va en la respuesta, no en el cálculo. */
  mes: string;
  /** Cuántos residentes contaron de denominador: los que estuvieron en el
   *  centro alguna parte del mes. */
  residentes: number;
  /**
   * Por control programado: cuántas ocurrencias tocaban y cuántas se
   * hicieron, en todo el centro y en todo el mes. Sale de `queToca` +
   * `loQueNoSeHizo` (`no-hecho.ts`), que es la misma función que el
   * parte de relevo: así «el 73,5 % de la gimnasia» y «la gimnasia de
   * doña Carmen no se hizo el martes» no se pueden contradecir.
   */
  cumplimiento: Record<string, { tocan: number; hechas: number } | undefined>;
  /** Cuántos residentes tienen al menos UNA visita médica registrada en
   *  el mes. */
  residentesConVisitaMedica: number;
  /** Cuántas actividades socioculturales se registraron en el mes. */
  actividadesSocioculturales: number;
  /** Cuántos episodios de «más de 3 días sin deposición» se abrieron en
   *  el mes (incidencias `SIN_DEPOSICION`). */
  episodiosSinDeposicion: number;
  /** Las averías abiertas en el mes y cuánto tardaron en resolverse, en
   *  horas. `null` = sigue abierta, y **cuenta como fuera de plazo** si
   *  lleva más de 24 h: una avería sin resolver no es una avería rápida. */
  averias: Array<{ horas: number | null }>;

  // ── calidad-1 (D-72) · lo que necesitan los siete nuevos ──────────

  /**
   * **R9 de la inspección** · la cumplimentación de los registros de
   * atención directa, en todo el centro y en todo el mes: cuántas
   * ocurrencias de capa 1 tocaban y cuántas se hicieron.
   *
   * Sale del MISMO cruce que el parte de relevo (`queToca` +
   * `loQueNoSeHizo`), igual que los porcentajes de gimnasia. Es lo que
   * hace que el indicador y el parte **no se puedan contradecir para el
   * mismo turno**: si el parte dice que en la tarde del martes quedaron
   * tres sin hacer, el indicador del mes los tiene contados.
   */
  cumplimentacion: { tocan: number; hechas: number } | undefined;

  /** Cuántas caídas se registraron en el mes (incidencias de tipo
   *  `CAIDA`, declaradas o derivadas). */
  caidas: number;

  /** Las incidencias de RESIDENTE cerradas en el mes y si antes de
   *  cerrarlas alguien había comunicado a la familia. El denominador son
   *  las cerradas: una abierta todavía está a tiempo. */
  incidenciasDeResidenteCerradas: number;
  conFamiliaComunicadaAntesDeCerrar: number;

  /** Las quejas abiertas en el mes y cuántos días naturales tardaron en
   *  responderse. `null` = sigue sin respuesta, y **cuenta fuera de
   *  plazo** si lleva más de `PLAZO_DE_QUEJA_DIAS`: misma regla que una
   *  avería sin cerrar, y por lo mismo — un centro que no responde
   *  ninguna no puede salir con el mejor resultado posible. */
  quejas: Array<{ dias: number | null }>;

  /**
   * La ocupación del mes, sumada día a día: cuántas camas había y
   * cuántas estaban asignadas cada día. El indicador es el cociente de
   * las dos sumas, que es la ocupación MEDIA ponderada por día y no la
   * media de los porcentajes diarios (distintas cuando el centro cambia
   * de camas a mitad de mes, y la primera es la buena).
   */
  ocupacion: { camasDia: number; ocupadasDia: number };

  /**
   * **Observación 04 de AENOR** · la plantilla, de los datos de personal
   * que mipiacetpv ya tiene. `bajas` son los empleados desactivados en
   * el mes; `plantilla` es la media del periodo, aproximada como los
   * activos al final más las bajas del mes — y esa aproximación está
   * escrita en el `deDonde` del indicador, porque un auditor pregunta
   * por el denominador.
   */
  personal: { bajas: number; plantilla: number };
}

/** Una fila del catálogo de indicadores. */
export interface DefinicionDeIndicador {
  code: string;
  /** Como lo nombra el centro, que es como lo declara a AENOR. */
  nombre: string;
  /** De qué registros sale, para que el panel pueda decirlo (07-calidad
   *  §2: «y de qué registros sale, se puede abrir»). */
  deDonde: string;
  unidad: UnidadDeIndicador;
  comparacion: ComparacionDeIndicador;
  /** El umbral objetivo 2026 del bloque C §2. El centro lo cambia. */
  umbralDeSerie: number;
  /** calidad-1 (D-72) · de qué proceso del **mapa de referencia** cuelga.
   *  Ver la cabecera. */
  procesoDeReferencia: string;
  /** `null` cuando no hay denominador. Ver la cabecera. */
  calcular: (d: DatosDelMes) => number | null;
}

/**
 * calidad-1 (R3 de la inspección) · **EL PLAZO PARA RESPONDER UNA
 * QUEJA**, en días naturales.
 *
 * Quince, y es del PRODUCTO y no del centro: lo que el centro elige es
 * qué porcentaje de quejas en plazo se da por bueno (el umbral), no
 * cuánto dura el plazo. Un centro que pudiera estirar el plazo a sesenta
 * días cumpliría el 100 % sin cambiar nada, que es justo lo que un
 * indicador no debe permitir.
 *
 * Naturales y no hábiles: es como lo cuenta la JCCM y es como lo cuenta
 * una familia.
 */
export const PLAZO_DE_QUEJA_DIAS = 15;

/** Un porcentaje con un decimal, o `null` si el denominador es cero. */
function porcentaje(parte: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((parte / total) * 1000) / 10;
}

/** El cumplimiento de un control programado, en porcentaje. */
function cumplimientoDe(d: DatosDelMes, code: string): number | null {
  const c = d.cumplimiento[code];
  if (c == null) return null;
  return porcentaje(c.hechas, c.tocan);
}

/**
 * **LOS QUE SE PUEDEN CALCULAR HOY.** Los seis de residencia-5 en el
 * orden del bloque C §2, y detrás los siete que añade calidad-1 (D-72).
 *
 * Son datos y no código (D-11 llevado al panel): un indicador nuevo en
 * 2028 es una fila de este fichero, no una migración. Por eso
 * `indicator_targets.code` es texto y no una FK.
 */
export const INDICADORES: DefinicionDeIndicador[] = [
  {
    code: "SIN_DEPOSICION",
    procesoDeReferencia: "CUIDADOS_ABVD",
    nombre: "Residentes con más de 3 días sin deposición",
    deDonde: "incidencias derivadas por ausencia, del registro de deposiciones de la puerta",
    unidad: "RECUENTO",
    comparacion: "AT_MOST",
    umbralDeSerie: 3,
    calcular: (d) => d.episodiosSinDeposicion,
  },
  {
    code: "VISITA_MEDICA",
    procesoDeReferencia: "ATENCION_SANITARIA",
    nombre: "Residentes vistos por el médico este mes",
    deDonde: "registros del control VISITA_MEDICA",
    unidad: "PORCENTAJE",
    comparacion: "AT_LEAST",
    // «¿Todos los residentes han sido vistos por el médico este mes?» con
    // umbral «1/mes» en el bloque C. Lo que eso es, medido, es el 100 %
    // de los residentes con al menos una visita.
    umbralDeSerie: 100,
    calcular: (d) => porcentaje(d.residentesConVisitaMedica, d.residentes),
  },
  {
    code: "GIMNASIA",
    procesoDeReferencia: "VIDA_SOCIAL",
    nombre: "Participación en la gimnasia de mantenimiento",
    deDonde: "plan de cuidados y registros del control GIMNASIA",
    unidad: "PORCENTAJE",
    comparacion: "AT_LEAST",
    umbralDeSerie: 73.5,
    calcular: (d) => cumplimientoDe(d, "GIMNASIA"),
  },
  {
    code: "ESTIMULACION_COGNITIVA",
    procesoDeReferencia: "VIDA_SOCIAL",
    nombre: "Asistencia a estimulación cognitiva",
    deDonde: "plan de cuidados y registros del control ESTIMULACION_COGNITIVA",
    unidad: "PORCENTAJE",
    comparacion: "AT_LEAST",
    umbralDeSerie: 58.5,
    calcular: (d) => cumplimientoDe(d, "ESTIMULACION_COGNITIVA"),
  },
  {
    code: "ACTIVIDADES_SOCIOCULTURALES",
    procesoDeReferencia: "VIDA_SOCIAL",
    nombre: "Actividades socioculturales del mes",
    deDonde: "registros del control ACTIVIDAD_SOCIOCULTURAL",
    unidad: "RECUENTO",
    comparacion: "AT_LEAST",
    umbralDeSerie: 2,
    calcular: (d) => d.actividadesSocioculturales,
  },
  {
    code: "AVERIAS_24H",
    procesoDeReferencia: "MANTENIMIENTO_INSTALACIONES",
    nombre: "Averías que tardan más de 24 h en resolverse",
    deDonde: "libro de incidencias, sujeto «avería»",
    unidad: "PORCENTAJE",
    comparacion: "AT_MOST",
    umbralDeSerie: 10,
    calcular: (d) =>
      porcentaje(
        // Una avería **sin cerrar** cuenta como fuera de plazo. Lo
        // contrario —dejarla fuera del numerador— haría que un centro que
        // no cierra ninguna avería saliera con el 0 %, que es el mejor
        // resultado posible por no hacer nada.
        d.averias.filter((a) => a.horas == null || a.horas > 24).length,
        d.averias.length,
      ),
  },

  // ── calidad-1 (D-72) · LOS SIETE QUE YA TIENEN DATO ──────────────

  {
    code: "CUMPLIMENTACION_REGISTROS",
    nombre: "Cumplimentación de los registros de atención directa",
    deDonde:
      "el mismo cruce que el parte de relevo: las ocurrencias del plan de cuidados que tocaban frente a las registradas en la puerta",
    unidad: "PORCENTAJE",
    comparacion: "AT_LEAST",
    procesoDeReferencia: "DOCUMENTACION_DATOS",
    // **R9 de la inspección de Bienestar Social del 08-10-2026**:
    // «registros de atención directa con anotaciones vacías puntuales».
    // El 98 % y no el 100: con 49 residentes y tres turnos son unas
    // cuarenta mil ocurrencias al mes, y un umbral del 100 % sale en rojo
    // el primer día que alguien se pone malo. Lo que la inspección quiere
    // ver es que los huecos son puntuales y que alguien los mira.
    umbralDeSerie: 98,
    calcular: (d) =>
      d.cumplimentacion == null
        ? null
        : porcentaje(d.cumplimentacion.hechas, d.cumplimentacion.tocan),
  },
  {
    code: "CAIDAS",
    nombre: "Caídas al mes",
    deDonde: "libro de incidencias, sujeto «residente», tipo «caída»",
    unidad: "RECUENTO",
    comparacion: "AT_MOST",
    procesoDeReferencia: "CUIDADOS_ABVD",
    // Un RECUENTO de cero sí es un cero, al revés que un porcentaje sin
    // denominador: «este mes no se cayó nadie» es un resultado.
    umbralDeSerie: 4,
    calcular: (d) => d.caidas,
  },
  {
    code: "FAMILIA_COMUNICADA",
    nombre: "Incidencias de residente con la familia comunicada antes de cerrar",
    deDonde:
      "libro de incidencias cerradas en el mes, cruzadas con la constancia de comunicación a familia anterior al cierre",
    unidad: "PORCENTAJE",
    comparacion: "AT_LEAST",
    procesoDeReferencia: "CALIDAD_MEJORA",
    // **Observación 10 de AENOR y R8 de la inspección.** El numerador son
    // las que llevan un `COMUNICADO`; un «no comunicado: motivo» es
    // constancia válida para poder cerrar (residencia-4) pero NO cuenta
    // aquí — si contara, un centro que marcara todo «no procede» saldría
    // al 100 %. Por eso el umbral de serie no es 100 tampoco: hay
    // decisiones legítimas de no comunicar, y la pantalla deja ver cuáles
    // son y por qué.
    umbralDeSerie: 90,
    calcular: (d) =>
      porcentaje(
        d.conFamiliaComunicadaAntesDeCerrar,
        d.incidenciasDeResidenteCerradas,
      ),
  },
  {
    code: "QUEJAS",
    nombre: "Quejas al mes",
    deDonde: "libro de incidencias, sujeto «queja» (incluidas las verbales)",
    unidad: "RECUENTO",
    comparacion: "AT_MOST",
    procesoDeReferencia: "CALIDAD_MEJORA",
    // Jardín de Gredos registró 19 quejas verbales en 2025 y ninguna
    // reclamación formal: una y media al mes. El umbral de serie es 2.
    umbralDeSerie: 2,
    calcular: (d) => d.quejas.length,
  },
  {
    code: "QUEJAS_EN_PLAZO",
    nombre: `Quejas respondidas en plazo (${PLAZO_DE_QUEJA_DIAS} días naturales)`,
    deDonde:
      `libro de incidencias, sujeto «queja»: desde que se abre hasta que se cierra con su respuesta, frente al plazo de ${PLAZO_DE_QUEJA_DIAS} días naturales del producto`,
    unidad: "PORCENTAJE",
    comparacion: "AT_LEAST",
    procesoDeReferencia: "CALIDAD_MEJORA",
    // **R3 de la inspección.** Una queja sin responder cuenta fuera de
    // plazo en cuanto pasa el plazo, por lo mismo que una avería sin
    // cerrar: lo contrario premia no contestar.
    umbralDeSerie: 100,
    calcular: (d) =>
      porcentaje(
        d.quejas.filter((q) => q.dias != null && q.dias <= PLAZO_DE_QUEJA_DIAS)
          .length,
        d.quejas.length,
      ),
  },
  {
    code: "OCUPACION_MEDIA",
    nombre: "Ocupación media del mes",
    deDonde: "camas del edificio y asignaciones de cama, día a día",
    unidad: "PORCENTAJE",
    comparacion: "AT_LEAST",
    procesoDeReferencia: "ADMISION_INGRESO",
    // El indicador de INFORMACIÓN PRELIMINAR de AENOR es «44 de 48
    // residentes permanecen mes a mes», que medido es el 91,7 % de
    // ocupación. El de serie se queda en 90: es un umbral de producto,
    // no el objetivo de un centro lleno.
    umbralDeSerie: 90,
    calcular: (d) => porcentaje(d.ocupacion.ocupadasDia, d.ocupacion.camasDia),
  },
  {
    code: "ROTACION_PERSONAL",
    nombre: "Rotación de personal",
    deDonde:
      "bajas de personal del mes frente a la plantilla del periodo (activos al cierre más las bajas del mes)",
    unidad: "PORCENTAJE",
    comparacion: "AT_MOST",
    procesoDeReferencia: "PERSONAS",
    // **Observación 04 de AENOR**: «el único indicador de DIRECCIÓN no
    // mide a RRHH». Éste sí, y sale de los datos de personal que
    // mipiacetpv ya tiene — sin inventar ninguno. Un 2 % mensual es un
    // 24 % anual, que en el sector es alto pero no alarmante.
    umbralDeSerie: 2,
    calcular: (d) => porcentaje(d.personal.bajas, d.personal.plantilla),
  },
];

/**
 * **LOS QUE NO SE PINTAN, Y POR QUÉ.** Se listan para que el panel pueda
 * decir «éstos todavía no» en vez de callarse: un indicador que falta y
 * no se nombra es un indicador que alguien da por calculado.
 */
export const INDICADORES_SIN_DATO: Array<{ nombre: string; falta: string }> = [
  { nombre: "Úlceras por presión nuevas", falta: "la entidad Lesión (Fase 2)" },
  { nombre: "Barthel y deterioro cognitivo", falta: "las escalas 3b (Fase 2)" },
  { nombre: "Riesgo de desnutrición", falta: "las escalas 3b (Fase 2)" },
  { nombre: "Errores de medicación", falta: "la cadena de medicación (Fase 2)" },
  { nombre: "Caídas con consecuencia", falta: "la entidad Lesión (Fase 2)" },
  { nombre: "PAI revisado en plazo", falta: "el PAI como entidad (historia-1)" },
  { nombre: "Familias informadas del seguimiento", falta: "el portal de familias (familias-1)" },
  { nombre: "Prendas extraviadas", falta: "lavandería, que no está en la v1" },
  // calidad-1 · **la rotación sale de esta lista y pasa a pintarse**: los
  // datos de personal de mipiacetpv (altas y bajas de `employees`) dan
  // para calcularla. El absentismo y la formación NO, y se quedan aquí
  // cada uno con lo suyo en vez de los tres juntos en una fila — que es
  // lo que hacía que «falta RRHH» pareciera una sola deuda.
  { nombre: "Absentismo", falta: "el cuadrante de turnos, para saber qué estaba planificado (calidad-2)" },
  { nombre: "Formación obligatoria en plazo", falta: "el registro de formación (mantenimiento-1)" },
  { nombre: "Satisfacción de residentes y familias", falta: "las encuestas (calidad-2)" },
  { nombre: "Indicadores de cocina", falta: "APPCC (Obs. 06 de AENOR, cocina-1)" },
  { nombre: "Representatividad de las encuestas", falta: "entregadas y recibidas (Obs. 05 de AENOR, calidad-2)" },
];

/** El resultado de un indicador, listo para pintar. */
export interface ValorDeIndicador {
  code: string;
  nombre: string;
  deDonde: string;
  unidad: UnidadDeIndicador;
  comparacion: ComparacionDeIndicador;
  /** calidad-1 (D-72) · de qué proceso del mapa de referencia cuelga.
   *  De qué proceso cuelga EN ESTE CENTRO lo pone la ruta, que es la que
   *  lee `indicator_processes`: aquí no hay base de datos. */
  procesoDeReferencia: string;
  /** `null` = sin dato este mes. */
  valor: number | null;
  umbral: number;
  /** `true` si el umbral es el que el centro configuró, `false` si es el
   *  de serie del producto. El panel lo dice. */
  umbralDelCentro: boolean;
  /** `null` cuando no hay valor: sin dato no se juzga. */
  dentro: boolean | null;
}

/**
 * Calcula los TRECE contra los umbrales del centro (los que haya) y los
 * de serie para el resto.
 */
export function calcularIndicadores(
  datos: DatosDelMes,
  umbralesDelCentro: Array<{ code: string; target: number; comparison: ComparacionDeIndicador }>,
): ValorDeIndicador[] {
  const porCodigo = new Map(umbralesDelCentro.map((u) => [u.code, u]));
  return INDICADORES.map((def) => {
    const propio = porCodigo.get(def.code);
    const umbral = propio?.target ?? def.umbralDeSerie;
    // La **comparación también la puede cambiar el centro**, y es
    // deliberado: un centro que decida medir las averías como «porcentaje
    // resueltas en plazo» en vez de «porcentaje fuera de plazo» cambia el
    // lado, no la fórmula. Lo que no puede cambiar es cómo se cuenta.
    const comparacion = propio?.comparison ?? def.comparacion;
    const valor = def.calcular(datos);
    return {
      code: def.code,
      nombre: def.nombre,
      deDonde: def.deDonde,
      procesoDeReferencia: def.procesoDeReferencia,
      unidad: def.unidad,
      comparacion,
      valor,
      umbral,
      umbralDelCentro: propio != null,
      dentro: valor == null ? null : comparacion === "AT_LEAST" ? valor >= umbral : valor <= umbral,
    };
  });
}
