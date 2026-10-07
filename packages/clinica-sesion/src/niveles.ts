// clinica-5 · LOS ACTOS DE LA QUIROPODIA Y EL NIVEL QUE PROPONEN.
//
// Rosario cobra la quiropodia en tres niveles —básica, completa, extra—
// que duran los mismos 30 minutos y se diferencian en lo que se hace. Hoy
// elige el nivel de memoria, al final, y a veces se le olvida: la cita se
// da como «Quiropodia» y el nivel no está escrito en ninguna parte hasta
// que alguien lo cobra.
//
// Lo que hace este fichero es darle la vuelta: la podóloga toca LO QUE
// HACE —corte, deslaminado, enucleación, fresado, grietas, uña
// encarnada— y el nivel sale de ahí. Se cambia con un toque y queda
// escrito si se cambió («propuesto completa, cobrado extra»).
//
// ── LA REGLA NO ESTÁ VALIDADA CON ROSARIO ─────────────────────────────
//
// Decisión 5 del prompt, y va dicho aquí y no sólo en el `-done` porque
// esto es lo que un lector de este fichero tiene que saber antes de
// confiar en el número que devuelve: **los umbrales de abajo son los del
// mockup, puestos para poder construir, y los tiene que confirmar la
// podóloga.** La próxima visita a Rosario lleva esta pregunta.
//
// Por eso la regla es DATO y no un `if`: cambiarla cuando ella diga lo que
// de verdad incluye cada nivel es editar una tabla de seis entradas y un
// umbral, no releer una función. Y por eso está versionada: el día que
// cambie, lo cobrado con la versión 1 se sigue explicando con la versión
// 1 — que en una historia clínica con factura detrás no es un detalle.

/** Un acto de la quiropodia: lo que la podóloga TOCA. */
export interface ActoDeQuiropodia {
  /** Corto y estable: viaja en el `body` de la historia PARA SIEMPRE. */
  id: string;
  label: string;
  /** La aclaración pequeña del botón del mockup («durezas», «uñas
   *  gruesas»). Son las palabras del paciente al lado de las de la
   *  podóloga, igual que «Callo (heloma)» en las lesiones. */
  sub?: string;
}

export interface ListaDeActos {
  version: number;
  actos: readonly ActoDeQuiropodia[];
}

/** Los seis del mockup validado, en su orden. */
export const ACTOS_QUIROPODIA_V1: ListaDeActos = {
  version: 1,
  actos: [
    { id: "corte", label: "Corte de uñas" },
    { id: "durezas", label: "Deslaminado", sub: "durezas" },
    { id: "helomas", label: "Enucleación", sub: "helomas" },
    { id: "fresado", label: "Fresado", sub: "uñas gruesas" },
    { id: "grietas", label: "Grietas", sub: "cura" },
    { id: "onico", label: "Uña encarnada", sub: "leve" },
  ],
};

export const VERSION_DE_LOS_ACTOS = ACTOS_QUIROPODIA_V1.version;

const ACTOS_POR_VERSION: Record<number, ListaDeActos> = {
  [ACTOS_QUIROPODIA_V1.version]: ACTOS_QUIROPODIA_V1,
};

export function actosDeVersion(version: number): ListaDeActos | undefined {
  return ACTOS_POR_VERSION[version];
}

export function actoDe(
  id: string,
  version: number = VERSION_DE_LOS_ACTOS,
): ActoDeQuiropodia | undefined {
  return actosDeVersion(version)?.actos.find((a) => a.id === id);
}

/** Cómo se lee un acto. La id tal cual si la versión no se conoce: lo
 *  escrito tiene que seguir viéndose (misma regla que `nombreDeZona`). */
export function nombreDeActo(
  id: string,
  version: number = VERSION_DE_LOS_ACTOS,
): string {
  return actoDe(id, version)?.label ?? id;
}

// ── Los tres niveles ──────────────────────────────────────────────────

export const NIVELES_DE_QUIROPODIA = [1, 2, 3] as const;
export type NivelDeQuiropodia = (typeof NIVELES_DE_QUIROPODIA)[number];

export const NOMBRE_DE_NIVEL: Record<NivelDeQuiropodia, string> = {
  1: "Básica",
  2: "Completa",
  3: "Extra",
};

export function esNivelDeQuiropodia(x: unknown): x is NivelDeQuiropodia {
  return x === 1 || x === 2 || x === 3;
}

// ── LA REGLA, como lista de datos ─────────────────────────────────────

export interface ReglaDeNivel {
  version: number;
  /**
   * El nivel MÍNIMO que impone cada acto. El nivel propuesto es el mayor
   * de todos los mínimos.
   *
   * Es la forma del prompt §5 escrita como dato: «básica = corte y/o
   * deslaminado; completa = además enucleación o grietas; extra = fresado
   * de uña gruesa, uña encarnada».
   *
   * Un acto que no esté en esta tabla no sube el nivel. No es un hueco: es
   * la lectura correcta de «añadir un acto nuevo no cambia lo que se
   * cobra hasta que alguien diga a qué nivel pertenece».
   */
  minimoPorActo: Readonly<Record<string, NivelDeQuiropodia>>;
  /**
   * Y el suelo por CANTIDAD: «o 4 actos o más» → extra.
   *
   * Va aparte y no como un acto más porque no es una propiedad de ningún
   * acto: es una propiedad del conjunto. Mezclarlos habría obligado a
   * escribir el umbral dentro de un `if` para no ensuciar la tabla, y el
   * umbral es justo lo que Rosario va a querer mover.
   */
  nivelPorCantidad: readonly { desdeActos: number; nivel: NivelDeQuiropodia }[];
}

export const REGLA_DE_NIVEL_V1: ReglaDeNivel = {
  version: 1,
  minimoPorActo: {
    corte: 1,
    durezas: 1,
    helomas: 2,
    grietas: 2,
    fresado: 3,
    onico: 3,
  },
  nivelPorCantidad: [{ desdeActos: 4, nivel: 3 }],
};

export const VERSION_DE_LA_REGLA_DE_NIVEL = REGLA_DE_NIVEL_V1.version;

export interface NivelPropuesto {
  nivel: NivelDeQuiropodia;
  /** Por qué sale ése, en la frase que pinta el mockup bajo los tres
   *  botones. Se redacta AQUÍ y no en la pantalla por la misma razón que
   *  el motivo de `gravedadDisponible`: dos sitios que lo redacten
   *  acabarían discrepando, y éste es el sitio donde se explica un
   *  cobro. */
  motivo: string;
  /** Qué acto decidió el nivel, o `null` si lo decidió la cantidad o si no
   *  hay actos marcados. Lo usa el test y lo usa el motivo. */
  porElActo: string | null;
  /** `true` si el nivel lo impuso el umbral de cantidad y no un acto
   *  concreto. */
  porLaCantidad: boolean;
}

/**
 * El nivel que el programa PROPONE por lo que se ha tocado.
 *
 * Propone: no decide. La podóloga lo cambia con un toque y la sesión deja
 * escrito que se cambió (ver `BloqueQuiropodia.nivelPropuesto` /
 * `nivelElegido`). Es la misma forma que el riesgo del pie, que propone el
 * plazo de revisión y no crea la cita.
 *
 * Sin actos marcados devuelve **básica**, que es lo que hace el mockup y
 * es lo honesto: una quiropodia es siempre al menos una quiropodia. Lo
 * que no se hace es devolver `null` y dejar el pie de la sesión sin
 * importe — eso sería que marcar «Quiropodia» no cobra nada hasta tocar
 * un botón, y lo que la podóloga marca primero es el tipo.
 */
export function nivelPropuesto(
  actos: readonly string[],
  regla: ReglaDeNivel = REGLA_DE_NIVEL_V1,
  listaDeActos: ListaDeActos = ACTOS_QUIROPODIA_V1,
): NivelPropuesto {
  // Sólo los actos que la lista conoce y sin repetidos: el umbral de
  // cantidad cuenta ACTOS DISTINTOS, y «corte» dos veces no es más
  // trabajo.
  const validos = [
    ...new Set(
      actos.filter((id) => listaDeActos.actos.some((a) => a.id === id)),
    ),
  ];

  let nivel: NivelDeQuiropodia = 1;
  let porElActo: string | null = null;
  for (const id of validos) {
    const minimo = regla.minimoPorActo[id];
    if (minimo != null && minimo > nivel) {
      nivel = minimo;
      porElActo = id;
    }
  }

  let porLaCantidad = false;
  for (const salto of regla.nivelPorCantidad) {
    if (validos.length >= salto.desdeActos && salto.nivel > nivel) {
      nivel = salto.nivel;
      porLaCantidad = true;
      porElActo = null;
    }
  }

  return {
    nivel,
    porElActo,
    porLaCantidad,
    motivo: motivoDelNivel(validos, nivel, porElActo, porLaCantidad, listaDeActos),
  };
}

function motivoDelNivel(
  actos: readonly string[],
  nivel: NivelDeQuiropodia,
  porElActo: string | null,
  porLaCantidad: boolean,
  lista: ListaDeActos,
): string {
  if (actos.length === 0) {
    return "Todavía no has marcado nada: se propone la básica.";
  }
  if (porLaCantidad) {
    return `Propuesta ${NOMBRE_DE_NIVEL[nivel].toLowerCase()} por ser ${actos.length} actos.`;
  }
  if (porElActo) {
    const acto = lista.actos.find((a) => a.id === porElActo);
    const nombre = acto
      ? acto.sub
        ? `${acto.label.toLowerCase()} (${acto.sub})`
        : acto.label.toLowerCase()
      : porElActo;
    return `Propuesta ${NOMBRE_DE_NIVEL[nivel].toLowerCase()} por el ${nombre}.`;
  }
  return `Propuesta ${NOMBRE_DE_NIVEL[nivel].toLowerCase()} por lo que has marcado.`;
}

/**
 * La frase del pie de la tarjeta cuando la podóloga cambia el nivel a
 * mano. Es la que deja constancia de «propuesto completa, cobrado extra»
 * (decisión 4), y la que el informe de clinica-4 va a poder escribir tal
 * cual.
 */
export function textoDelCambioDeNivel(
  propuesto: NivelDeQuiropodia,
  elegido: NivelDeQuiropodia,
): string | null {
  if (propuesto === elegido) return null;
  return `Cambiado a mano · lo propuesto era ${NOMBRE_DE_NIVEL[propuesto].toLowerCase()}`;
}
