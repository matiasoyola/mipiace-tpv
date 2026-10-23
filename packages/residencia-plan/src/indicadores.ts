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
  /** `null` cuando no hay denominador. Ver la cabecera. */
  calcular: (d: DatosDelMes) => number | null;
}

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
 * **LOS SEIS QUE SE PUEDEN CALCULAR HOY**, en el orden del bloque C §2.
 *
 * Son datos y no código (D-11 llevado al panel): un indicador nuevo en
 * 2028 es una fila de este fichero, no una migración. Por eso
 * `indicator_targets.code` es texto y no una FK.
 */
export const INDICADORES: DefinicionDeIndicador[] = [
  {
    code: "SIN_DEPOSICION",
    nombre: "Residentes con más de 3 días sin deposición",
    deDonde: "incidencias derivadas por ausencia, del registro de deposiciones de la puerta",
    unidad: "RECUENTO",
    comparacion: "AT_MOST",
    umbralDeSerie: 3,
    calcular: (d) => d.episodiosSinDeposicion,
  },
  {
    code: "VISITA_MEDICA",
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
    nombre: "Participación en la gimnasia de mantenimiento",
    deDonde: "plan de cuidados y registros del control GIMNASIA",
    unidad: "PORCENTAJE",
    comparacion: "AT_LEAST",
    umbralDeSerie: 73.5,
    calcular: (d) => cumplimientoDe(d, "GIMNASIA"),
  },
  {
    code: "ESTIMULACION_COGNITIVA",
    nombre: "Asistencia a estimulación cognitiva",
    deDonde: "plan de cuidados y registros del control ESTIMULACION_COGNITIVA",
    unidad: "PORCENTAJE",
    comparacion: "AT_LEAST",
    umbralDeSerie: 58.5,
    calcular: (d) => cumplimientoDe(d, "ESTIMULACION_COGNITIVA"),
  },
  {
    code: "ACTIVIDADES_SOCIOCULTURALES",
    nombre: "Actividades socioculturales del mes",
    deDonde: "registros del control ACTIVIDAD_SOCIOCULTURAL",
    unidad: "RECUENTO",
    comparacion: "AT_LEAST",
    umbralDeSerie: 2,
    calcular: (d) => d.actividadesSocioculturales,
  },
  {
    code: "AVERIAS_24H",
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
  { nombre: "Rotación, absentismo y formación en plazo", falta: "RRHH (Obs. 04 de AENOR, calidad-1)" },
  { nombre: "Satisfacción de residentes y familias", falta: "las encuestas (calidad-1)" },
  { nombre: "Indicadores de cocina", falta: "APPCC (Obs. 06 de AENOR, cocina-1)" },
];

/** El resultado de un indicador, listo para pintar. */
export interface ValorDeIndicador {
  code: string;
  nombre: string;
  deDonde: string;
  unidad: UnidadDeIndicador;
  comparacion: ComparacionDeIndicador;
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
 * Calcula los seis contra los umbrales del centro (los que haya) y los de
 * serie para el resto.
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
      unidad: def.unidad,
      comparacion,
      valor,
      umbral,
      umbralDelCentro: propio != null,
      dentro: valor == null ? null : comparacion === "AT_LEAST" ? valor >= umbral : valor <= umbral,
    };
  });
}
