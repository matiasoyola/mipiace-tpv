// calidad-1 (D-71, D-73, D-74) · **LAS REGLAS DE CALIDAD, PURAS.**
//
// Tres cosas que tienen que dar lo mismo en el servidor y en la pantalla,
// por la misma razón por la que `gravedadDe` vive aquí: si la pantalla
// dice que una NC ya puede pasar a acciones y el servidor contesta 409,
// el usuario no entiende nada y acaba llamando por teléfono.
//
//   1. **La banda de un riesgo** (bajo/medio/alto) a partir de su nivel.
//   2. **El ciclo de la NC**: qué transición es legal desde dónde, y qué
//      le falta a una NC para dar el siguiente paso.
//   3. **La propuesta de NC** (D-74): cuándo dos meses seguidos fuera de
//      umbral se convierten en una propuesta.
//
// Y una cuarta que no es una regla sino una frontera: lo que está aquí
// **no sabe de Prisma ni de fechas del sistema**. El «hoy» entra por
// parámetro, igual que en `obligaciones.ts`, para que un test pueda
// preguntar «¿esto estaba vencido el 3 de marzo?» sin tocar el reloj.

// ── 1 · LAS BANDAS DE UN RIESGO (D-71) ──────────────────────────────
//
// `nivel = probabilidad × impacto`, con los dos de 1 a 3: los valores
// posibles son 1, 2, 3, 4, 6 y 9. Las bandas parten ahí:
//
//   · **bajo**  1-2 — se vigila;
//   · **medio** 3-4 — se planifica una acción;
//   · **alto**  6-9 — se planifica una acción Y se revisa antes.
//
// Son del PRODUCTO y no del centro, y es deliberado: un centro que
// pudiera mover la raya del «alto» tendría la tentación de moverla hasta
// que no le quedara ninguno, y eso un auditor lo ve en dos minutos. Lo
// que el centro sí decide es la probabilidad y el impacto de cada
// riesgo, que es donde está el juicio profesional.

/** La banda de un riesgo, como se pinta y como se ordena. */
export type BandaDeRiesgo = "BAJO" | "MEDIO" | "ALTO";

/** El nivel de un riesgo: probabilidad × impacto, los dos de 1 a 3. */
export function nivelDeRiesgo(probabilidad: number, impacto: number): number {
  return probabilidad * impacto;
}

/** En qué banda cae un nivel. Ver la cabecera para dónde están las rayas. */
export function bandaDeRiesgo(nivel: number): BandaDeRiesgo {
  if (nivel >= 6) return "ALTO";
  if (nivel >= 3) return "MEDIO";
  return "BAJO";
}

/** Cómo se dice una banda en la pantalla y en el PDF. */
export const BANDA_EN_PALABRAS: Record<BandaDeRiesgo, string> = {
  BAJO: "bajo",
  MEDIO: "medio",
  ALTO: "alto",
};

/**
 * ¿Está vencida la revisión de este riesgo?
 *
 * Las dos fechas son de pared («YYYY-MM-DD») y se comparan como texto,
 * que para ese formato es comparar cronológicamente. Mismo truco —y
 * mismo motivo— que el `careDay` del parte de relevo: una revisión que
 * toca «el 3 de marzo» no tiene hora, y convertirla a instante sólo
 * serviría para que en la madrugada del 3 saliera vencida o no según el
 * huso.
 *
 * **Vencida es `<`, no `<=`**: el día que toca todavía se puede revisar.
 */
export function revisionVencida(reviewAt: string, hoy: string): boolean {
  return reviewAt < hoy;
}

// ── 2 · EL CICLO DE LA NO CONFORMIDAD (D-73) ────────────────────────
//
// `OPEN` → `CAUSE_ANALYSED` → `ACTIONS` → `ACTIONS_CLOSED` → `CLOSED`,
// con una vuelta atrás: una verificación `NOT_EFFECTIVE` devuelve de
// `ACTIONS_CLOSED` a `ACTIONS`.
//
// La tabla de abajo es **la misma** que miran la ruta y la pantalla. La
// alternativa —una cadena de `if` en la ruta y otra en el componente—
// es cómo se consigue que el botón «cerrar» esté encendido y el servidor
// conteste que no.

/** Copia del enum de la base. */
export type EstadoDeNc =
  | "OPEN"
  | "CAUSE_ANALYSED"
  | "ACTIONS"
  | "ACTIONS_CLOSED"
  | "CLOSED";

/** Copia del enum de la base. */
export type ClaseDeNc = "MAJOR" | "MINOR" | "OBSERVATION" | "IMPROVEMENT";

/** Copia del enum de la base. */
export type ResultadoDeVerificacion = "EFFECTIVE" | "NOT_EFFECTIVE";

/** Las transiciones legales, en el orden del ciclo. */
export const TRANSICIONES: Record<EstadoDeNc, EstadoDeNc[]> = {
  OPEN: ["CAUSE_ANALYSED"],
  // Volver a `OPEN` no existe: la causa se escribe una vez (lo impide el
  // trigger) y deshacer el análisis sería borrar por qué pasó.
  CAUSE_ANALYSED: ["ACTIONS"],
  ACTIONS: ["ACTIONS_CLOSED"],
  // Las dos salidas de aquí NO las elige nadie: las decide el resultado
  // de la verificación de eficacia.
  ACTIONS_CLOSED: ["ACTIONS", "CLOSED"],
  CLOSED: [],
};

/** Cómo se dice un estado en la pantalla y en el PAC. */
export const ESTADO_EN_PALABRAS: Record<EstadoDeNc, string> = {
  OPEN: "Abierta",
  CAUSE_ANALYSED: "Causa analizada",
  ACTIONS: "Con acciones en curso",
  ACTIONS_CLOSED: "Acciones cerradas, pendiente de verificar",
  CLOSED: "Cerrada",
};

/** Y una clase. */
export const CLASE_EN_PALABRAS: Record<ClaseDeNc, string> = {
  MAJOR: "No conformidad mayor",
  MINOR: "No conformidad menor",
  OBSERVATION: "Observación",
  IMPROVEMENT: "Oportunidad de mejora",
};

/**
 * ¿Hace falta analizar la causa para que esta clase avance?
 *
 * Obligatoria en una NC mayor o menor; opcional en una observación y en
 * una oportunidad de mejora (D-73). Es la misma condición que el CHECK
 * `non_conformities_causa_antes_de_acciones` de la migración, escrita
 * aquí para que la pantalla pueda decirlo **antes** de que el motor lo
 * rechace.
 */
export function exigeCausa(clase: ClaseDeNc): boolean {
  return clase === "MAJOR" || clase === "MINOR";
}

/** Lo que hay que saber de una NC para decidir qué puede hacer ahora. */
export interface NcParaElCiclo {
  estado: EstadoDeNc;
  clase: ClaseDeNc;
  /** ¿Tiene causa analizada? */
  tieneCausa: boolean;
  acciones: number;
  accionesAbiertas: number;
  /** ¿Hay alguna verificación con resultado `EFFECTIVE`? */
  verificadaEficaz: boolean;
}

/**
 * **QUÉ LE FALTA PARA DAR EL SIGUIENTE PASO**, o `null` si puede darlo.
 *
 * Devuelve la frase, no un código: es lo que la pantalla pinta debajo
 * del botón apagado y lo que la ruta manda en el 409. Una sola frase
 * escrita una vez — si la ruta y la pantalla escribieran la suya, la del
 * 409 sería la fea.
 */
export function loQueFaltaPara(
  nc: NcParaElCiclo,
  destino: EstadoDeNc,
): string | null {
  if (!TRANSICIONES[nc.estado].includes(destino)) {
    return `Desde «${ESTADO_EN_PALABRAS[nc.estado]}» no se puede pasar a «${ESTADO_EN_PALABRAS[destino]}».`;
  }

  if (destino === "CAUSE_ANALYSED" && !nc.tieneCausa) {
    return "Falta analizar la causa.";
  }

  if (destino === "ACTIONS") {
    // Volver de `ACTIONS_CLOSED` a `ACTIONS` es lo que hace un «no
    // eficaz», y ésa no la pide nadie a mano: la escribe la propia
    // verificación.
    if (nc.estado === "CAUSE_ANALYSED") {
      if (exigeCausa(nc.clase) && !nc.tieneCausa) {
        return "Una no conformidad mayor o menor no pasa a acciones sin la causa analizada.";
      }
      if (nc.acciones === 0) {
        return "Falta escribir al menos una acción, con responsable y plazo.";
      }
    }
    return null;
  }

  if (destino === "ACTIONS_CLOSED") {
    if (nc.acciones === 0) return "No hay ninguna acción que cerrar.";
    if (nc.accionesAbiertas > 0) {
      return nc.accionesAbiertas === 1
        ? "Queda una acción sin cerrar."
        : `Quedan ${nc.accionesAbiertas} acciones sin cerrar.`;
    }
    return null;
  }

  if (destino === "CLOSED" && !nc.verificadaEficaz) {
    return "No se cierra sin una verificación de eficacia con resultado «eficaz».";
  }

  return null;
}

/**
 * A qué estado lleva una verificación de eficacia.
 *
 * `EFFECTIVE` → `CLOSED`; `NOT_EFFECTIVE` → **vuelve a `ACTIONS`** y
 * queda el rastro (D-73). Es una función de una línea y existe para que
 * la vuelta atrás esté escrita en el mismo sitio que el resto del ciclo:
 * repartida entre la ruta y la pantalla, el día que cambie sólo cambiará
 * en una.
 */
export function estadoTrasVerificar(
  resultado: ResultadoDeVerificacion,
): EstadoDeNc {
  return resultado === "EFFECTIVE" ? "CLOSED" : "ACTIONS";
}

/** ¿Está vencida esta acción? Misma regla de fechas que la revisión de
 *  un riesgo: `<`, porque el día del plazo todavía cuenta. */
export function accionVencida(
  dueOn: string,
  cerrada: boolean,
  hoy: string,
): boolean {
  return !cerrada && dueOn < hoy;
}

// ── 3 · EL INDICADOR QUE PROPONE (D-74) ─────────────────────────────
//
// «Dos meses seguidos fuera de umbral → el panel propone abrir NC con el
// origen ya rellenado. La decide una persona.»
//
// ── POR QUÉ DOS MESES CERRADOS Y NO EL QUE VA ───────────────────────
//
// Los dos meses que se miran son los dos **completos** anteriores, no el
// que está en curso. El mes en curso se mide «hasta ahora»
// (residencia-5 §9) y eso está bien para el panel, pero una propuesta de
// abrir una no conformidad el día 2 —sobre tres días de datos— es ruido
// que enseña a la dirección a ignorar las propuestas. Y una propuesta
// que se ignora es peor que no tenerla.
//
// ── Y POR QUÉ NO LA ABRE SOLA ───────────────────────────────────────
//
// Porque un sistema que abre NC solo llena el registro de NC que nadie
// trabaja, y un registro de NC con treinta abiertas y ninguna cerrada es
// exactamente lo que un auditor mira primero. La propuesta es una
// pantalla con un botón; la decisión, de una persona.

/** El valor de un indicador en un mes, con lo justo para decidir. */
export interface MesDeIndicador {
  /** «YYYY-MM». */
  mes: string;
  /** `null` = sin dato. **Sin dato no cuenta como fuera de umbral**, por
   *  lo mismo que no cuenta como cero. */
  dentro: boolean | null;
}

/** Una propuesta de abrir NC, lista para pintar. */
export interface PropuestaDeNc {
  code: string;
  nombre: string;
  /** Los dos meses que están fuera, el más antiguo primero. */
  meses: [string, string];
  /** El mes que va en `sourceIndicatorMonth` si alguien la acepta: el
   *  más reciente de los dos. */
  mesDeReferencia: string;
}

/**
 * ¿Propone este indicador abrir una NC?
 *
 * `meses` llega con los dos meses completos anteriores, **el más antiguo
 * primero**. Devuelve `null` salvo que los dos estén fuera.
 *
 * Un `dentro === null` (sin dato) **no** es estar fuera: un centro que
 * este mes no tenía ninguna gimnasia planificada no incumple el umbral
 * de participación, y proponerle una NC por eso sería el mismo error que
 * pintar `0 %` en rojo.
 */
export function proponeNc(
  indicador: { code: string; nombre: string },
  meses: [MesDeIndicador, MesDeIndicador],
): PropuestaDeNc | null {
  const [anterior, ultimo] = meses;
  if (anterior.dentro !== false || ultimo.dentro !== false) return null;
  return {
    code: indicador.code,
    nombre: indicador.nombre,
    meses: [anterior.mes, ultimo.mes],
    mesDeReferencia: ultimo.mes,
  };
}

/** El mes anterior a «YYYY-MM». */
export function mesAnterior(mes: string): string {
  const anio = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  return m === 1
    ? `${anio - 1}-12`
    : `${anio}-${String(m - 1).padStart(2, "0")}`;
}
