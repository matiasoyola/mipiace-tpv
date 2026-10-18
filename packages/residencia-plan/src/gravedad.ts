// residencia-4 (D-26, D-65) · **QUÉ NIVEL TIENE ESTO.**
//
// La función pura que convierte «38,4 °C» o «una caída con golpe en la
// cabeza» en un nivel N0-N4 y en un tipo de incidencia. Vive en el paquete
// puro —y no en `apps/api`— por la misma razón exacta que `queToca`:
//
//   · **la tablet la ejecuta** para pintar el resultado al instante y
//     también SIN RED. Una auxiliar que teclea 38,6 en una puerta sin wifi
//     tiene que ver «esto es N2, avisa a la enfermera» en el momento, no
//     cuando vuelva el router;
//   · **el servidor la ejecuta otra vez** y **manda la suya**. Lo que se
//     guarda en la incidencia es el nivel del servidor, siempre, porque es
//     quien tiene la excepción vigente del residente y quien no depende de
//     una caché de ayer.
//
// Las dos ejecuciones dan lo mismo para toda la tabla del §3 de
// `00-decisiones.md`, y eso lo fija un test de oro con sus bordes. Que den
// lo mismo NO es un detalle de implementación: si divergieran, la puerta
// diría «N1, queda apuntado» y el móvil de guardia sonaría con un N3.
//
// ── LA PLANTILLA ES DATO, NO CÓDIGO (D-65) ──────────────────────────
//
// Esta función **no sabe** que 38 °C son N2. Recibe las reglas y las
// aplica. Las reglas son filas versionadas de `severity_rules` (`scope`
// STANDARD, versión, vigencia), sembradas desde
// `residencia/catalogo/plantilla-de-gravedad.ts` igual que el catálogo de
// controles: cambiarla es una versión nueva que publica Mi Piace, no un
// despliegue y desde luego no una configuración del centro (D-21, §10 de
// la rama de controles).
//
// ── GANA LA MÁS GRAVE, Y NO LA PRIMERA ──────────────────────────────
//
// Las reglas de un control se evalúan TODAS y gana la de mayor nivel.
// Ordenarlas y quedarse con la primera que casa habría dejado el
// resultado en manos del `sortOrder` de unas filas de la base: con
// «≥ 38 → N2» antes que «≥ 39,5 → N3», una fiebre de 40 saldría N2. Y el
// día que alguien inserte una regla nueva sin pensar en el orden, el
// sistema avisaría de menos — que es el único error que este módulo no se
// puede permitir.
//
// ── Y UNA CONSTANTE SIN REGLA NO ES UN ERROR ────────────────────────
//
// Pulso, peso y tensión diastólica no tienen umbral en la plantilla del
// §3. Se registran, se guardan y **no derivan nada**: `gravedadDe`
// devuelve `null` y quien llama no abre incidencia. No es un hueco que
// haya que rellenar — es que la guía no gradúa esos tres por sí solos, y
// un umbral inventado por nosotros sería ruido que hace que la enfermera
// deje de mirar el móvil.

/** Los cinco niveles de D-26, por CONSECUENCIA y no por causa. */
export type Nivel = "N0" | "N1" | "N2" | "N3" | "N4";

/** De menor a mayor. El orden es el de la comparación, no el de pintar. */
export const NIVELES: readonly Nivel[] = ["N0", "N1", "N2", "N3", "N4"];

/** ¿Es `a` más grave que `b`? */
export function masGrave(a: Nivel, b: Nivel): boolean {
  return NIVELES.indexOf(a) > NIVELES.indexOf(b);
}

/** El mayor de dos niveles. */
export function nivelMaximo(a: Nivel, b: Nivel): Nivel {
  return masGrave(a, b) ? a : b;
}

/**
 * Cómo se compara el número con el valor de la regla.
 *
 * Cuatro y no dos: la plantilla del §3 usa los cuatro literalmente
 * («≥ 37,5», «< 92», «≤ 90», «> 300»), y traducir un «≤ 90» a un «< 91»
 * habría metido una decisión de redondeo en un sitio donde la tensión se
 * mide en enteros hoy y podría no medirse así mañana.
 */
export type Comparador = "GTE" | "GT" | "LTE" | "LT";

/**
 * Una regla de la plantilla de gravedad.
 *
 * Dos familias en la misma lista, porque la plantilla del §3 **es** una
 * sola tabla: la mitad de arriba gradúa números y la de abajo gradúa
 * cosas que pasan. Partirlas en dos tablas habría obligado a versionarlas
 * dos veces y a contestar «¿qué versión de la plantilla estaba vigente?»
 * con dos números.
 */
export type ReglaDeGravedad =
  | {
      kind: "THRESHOLD";
      /** El control cuya medida se compara: `TEMPERATURA`, `GLUCEMIA`… */
      controlCode: string;
      comparador: Comparador;
      valor: number;
      nivel: Nivel;
      /** El tipo de incidencia que abre. Es la clave de la
       *  idempotencia: tres tomas de fiebre en un turno son UNA
       *  incidencia `FIEBRE`, no tres. */
      tipo: string;
    }
  | {
      kind: "EVENT";
      /** El tipo de evento declarado: `CAIDA`, `VOMITO`, `AVERIA`… */
      evento: string;
      /** El matiz que la pantalla pregunta con UNA pregunta: `CON_GOLPE`,
       *  `SIN_GOLPE`, `REPETIDO`, `PELIGROSA`, `SIN_RIESGO`. `null` = la
       *  regla base del evento, la que vale cuando no se pregunta nada. */
      matiz: string | null;
      nivel: Nivel;
      tipo: string;
    };

/** Lo que `gravedadDe` contesta cuando algo gradúa. */
export interface Gravedad {
  nivel: Nivel;
  /** El tipo de incidencia, que es con lo que se deduplica. */
  tipo: string;
}

/**
 * **La excepción por residente (D-22).** Sustituye a las reglas de serie
 * de ESE control mientras está vigente; caducada, vuelven las de serie sin
 * que nadie haga nada.
 *
 * Sustituye y no se suma, y es una decisión que conviene no esconder: un
 * paliativo con una temperatura basal de 37,8 tiene las reglas de su
 * médica y **ninguna** de las de serie para la temperatura. Sumarlas
 * dejaría la regla de serie disparando por debajo de la excepción, que es
 * exactamente lo que la excepción existe para evitar.
 *
 * Y sustituye **por control**: una excepción de temperatura no toca la
 * saturación del mismo residente.
 */
export interface ExcepcionDeUmbral {
  controlCode: string;
  /** Las reglas que sustituyen. Vacío = **este control no gradúa para
   *  este residente**, que es un caso legítimo y pautable: «a doña Carmen
   *  no le abráis incidencia por la tensión, la tiene así desde 2019». */
  reglas: Array<{
    comparador: Comparador;
    valor: number;
    nivel: Nivel;
    tipo: string;
  }>;
  /** Desde cuándo y hasta cuándo rige. `hasta` NULL = sin fecha de fin. */
  desde: Date;
  hasta: Date | null;
}

/** ¿Está vigente esta excepción en este instante? */
export function excepcionVigente(
  e: ExcepcionDeUmbral,
  instante: Date,
): boolean {
  if (e.desde.getTime() > instante.getTime()) return false;
  if (e.hasta != null && e.hasta.getTime() <= instante.getTime()) return false;
  return true;
}

function casa(numero: number, comparador: Comparador, valor: number): boolean {
  switch (comparador) {
    case "GTE":
      return numero >= valor;
    case "GT":
      return numero > valor;
    case "LTE":
      return numero <= valor;
    case "LT":
      return numero < valor;
  }
}

/**
 * **EL NIVEL DE UNA MEDIDA.** `null` = esta constante no gradúa nada.
 *
 * @param controlCode qué se midió (`TEMPERATURA`, `SATURACION_O2`…).
 * @param numero      el valor medido, ya validado contra `inputMin/Max`.
 * @param reglas      la plantilla vigente ENTERA. Se filtra aquí.
 * @param excepcion   la del residente para ESTE control, si la hay y
 *                    está vigente. Quien decide la vigencia es quien
 *                    llama, con `excepcionVigente` — así el borde «la
 *                    excepción caducó anoche» es una tabla y no una
 *                    espera.
 */
export function gravedadDe(
  controlCode: string,
  numero: number,
  reglas: readonly ReglaDeGravedad[],
  excepcion?: ExcepcionDeUmbral | null,
): Gravedad | null {
  if (!Number.isFinite(numero)) return null;

  const aplicables: Array<{
    comparador: Comparador;
    valor: number;
    nivel: Nivel;
    tipo: string;
  }> =
    excepcion && excepcion.controlCode === controlCode
      ? // La excepción SUSTITUYE. Ver su cabecera.
        excepcion.reglas
      : reglas
          .filter(
            (r): r is Extract<ReglaDeGravedad, { kind: "THRESHOLD" }> =>
              r.kind === "THRESHOLD" && r.controlCode === controlCode,
          )
          .map((r) => ({
            comparador: r.comparador,
            valor: r.valor,
            nivel: r.nivel,
            tipo: r.tipo,
          }));

  let ganadora: Gravedad | null = null;
  for (const r of aplicables) {
    if (!casa(numero, r.comparador, r.valor)) continue;
    if (ganadora == null || masGrave(r.nivel, ganadora.nivel)) {
      ganadora = { nivel: r.nivel, tipo: r.tipo };
    }
  }
  return ganadora;
}

/**
 * **EL NIVEL DE UN EVENTO DECLARADO.** La mitad de abajo de la tabla del
 * §3: una caída, un vómito, una queja, una avería.
 *
 * El `matiz` es lo que la pantalla pregunta con UNA pregunta —«¿se ha dado
 * en la cabeza o hay herida?»— y es opcional: sin él se aplica la regla
 * base del evento. Es D-13 escrito en una función: **declarar sin matizar
 * tiene que seguir siendo un registro completo**, y lo que pasa entonces
 * es que gradúa por lo bajo, no que se pierda.
 *
 * `null` = ese evento no está en la plantilla. Quien llama lo trata como
 * «algo no va bien a secas», que es N1 por su propia fila.
 */
export function gravedadDeEvento(
  evento: string,
  matiz: string | null,
  reglas: readonly ReglaDeGravedad[],
): Gravedad | null {
  const suyas = reglas.filter(
    (r): r is Extract<ReglaDeGravedad, { kind: "EVENT" }> =>
      r.kind === "EVENT" && r.evento === evento,
  );
  if (suyas.length === 0) return null;
  // Con matiz, **manda la regla de ese matiz** aunque sea menos grave que
  // la base: «caída sin golpe» es N1 y «caída» a secas también, pero
  // «avería sin riesgo» es N0 y la base de avería no existe. Lo que no se
  // hace es coger la más grave de las dos — eso convertiría responder «no
  // se ha dado en la cabeza» en no responder.
  if (matiz != null) {
    const conMatiz = suyas.filter((r) => r.matiz === matiz);
    if (conMatiz.length > 0) {
      return conMatiz.reduce<Gravedad>(
        (mejor, r) =>
          masGrave(r.nivel, mejor.nivel) ? { nivel: r.nivel, tipo: r.tipo } : mejor,
        { nivel: conMatiz[0]!.nivel, tipo: conMatiz[0]!.tipo },
      );
    }
    // Un matiz que la plantilla no conoce —una versión nueva de la tablet
    // contra una plantilla vieja— cae a la base en vez de perderse.
  }
  const base = suyas.filter((r) => r.matiz == null);
  if (base.length === 0) {
    // Un evento que SÓLO tiene matices y llega sin ninguno. Gana el más
    // grave de los suyos: preguntar no es opcional en la pantalla, así
    // que esto es un cliente roto o viejo, y avisar de más es el lado
    // correcto del error.
    return suyas.reduce<Gravedad>(
      (mejor, r) =>
        masGrave(r.nivel, mejor.nivel) ? { nivel: r.nivel, tipo: r.tipo } : mejor,
      { nivel: suyas[0]!.nivel, tipo: suyas[0]!.tipo },
    );
  }
  return base.reduce<Gravedad>(
    (mejor, r) =>
      masGrave(r.nivel, mejor.nivel) ? { nivel: r.nivel, tipo: r.tipo } : mejor,
    { nivel: base[0]!.nivel, tipo: base[0]!.tipo },
  );
}

/**
 * **«No puede esperar: avisar a la enfermera»** (alcance 7).
 *
 * Fuerza COMO MÍNIMO N2 sobre lo que se esté apuntando. No pone N2: pone
 * «al menos N2». Si lo que se apunta ya es un N3 —una caída con golpe—,
 * pulsarlo no puede bajarlo, y escribir `nivel = N2` lo habría bajado.
 */
export const NIVEL_MINIMO_AL_AVISAR: Nivel = "N2";

export function conAvisoForzado(nivel: Nivel | null): Nivel {
  return nivel == null ? NIVEL_MINIMO_AL_AVISAR : nivelMaximo(nivel, NIVEL_MINIMO_AL_AVISAR);
}

// ── A quién le suena (D-66) ──────────────────────────────────────────

/** Los dos canales del móvil de guardia. */
export type CanalDeGuardia = "ENFERMERIA" | "RESPONSABLE";

/** Los destinatarios por nivel, por defecto (D-66). Configurables por el
 *  centro (§10 de la rama de controles: «destinatarios de cada nivel»). */
export const DESTINATARIOS_DE_SERIE: Record<Nivel, CanalDeGuardia[]> = {
  N0: [],
  // N1 va al relevo (residencia-5), no al móvil: es la velocidad lenta de
  // D-19 y encenderla aquí convertiría el móvil de guardia en un aparato
  // que suena ochenta veces por turno y que nadie mira.
  N1: [],
  N2: ["ENFERMERIA"],
  N3: ["ENFERMERIA", "RESPONSABLE"],
  N4: ["ENFERMERIA", "RESPONSABLE"],
};

/** Y los minutos que se esperan a que alguien acuse antes de escalar. */
export const MINUTOS_DE_ESCALADO_DE_SERIE = 5;

/**
 * ¿A qué canales suena este nivel?
 *
 * `config` es lo que el centro tenga configurado; lo que no configure cae
 * a lo de serie. Un centro que vacíe los destinatarios de un nivel lo deja
 * sin aviso **a propósito**, y eso se pinta en su pantalla de
 * configuración: no es lo mismo que no haber configurado nada.
 */
export function canalesDe(
  nivel: Nivel,
  config?: Partial<Record<Nivel, CanalDeGuardia[]>> | null,
): CanalDeGuardia[] {
  const propio = config?.[nivel];
  return propio ?? DESTINATARIOS_DE_SERIE[nivel];
}
